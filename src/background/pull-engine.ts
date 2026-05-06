/**
 * Pull Engine — remote change detection and delivery.
 *
 * This module handles chrome.storage.onChanged events for the sync area.
 * When a remote registry update arrives, it:
 *  1. Guards against non-sync areas and changes that don't touch the registry.
 *  2. Merges the remote registry into local via applyRemote() (registry.ts).
 *  3. Reconstructs live instructions via reconstructInstructions() (registry.ts).
 *  4. Updates LAST_PUSHED_KEY (D-04 infinite loop guard) — prevents diffAndAccumulate
 *     from treating the pull-triggered LS_CHANGED as a new push.
 *  5. Delivers to the active AI Studio tab via APPLY_REMOTE message, or falls
 *     through to the PENDING_REMOTE_KEY queue if no tab is available (Pitfall 2).
 *
 * T-04-03-02 (D-04 loop guard): writeLastPushed is called after delivery so that
 * a subsequent LS_CHANGED from applying the remote data has hasChanges=false in
 * diffAndAccumulate — no flush alarm is scheduled.
 *
 * T-04-03-04: console.log emits only item counts — never titles or text.
 */

import {
  REGISTRY_KEY,
  PENDING_REMOTE_KEY,
} from '../shared/constants';
import type {
  SyncRegistry,
  RawInstruction,
  ApplyRemoteMessage,
  PendingRemoteState,
  LastPushedSnapshot,
  LastPushedEntry,
} from '../shared/types';
import { applyRemote, reconstructInstructions } from './registry';
import { LAST_PUSHED_KEY, writeSyncStatus } from './sync-state';
import { shortHash } from './hash';

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Handle a chrome.storage.onChanged event for the sync area.
 *
 * Guards:
 * - areaName !== 'sync' → no-op (T-04-03-02)
 * - REGISTRY_KEY not in changes → no-op
 * - changes[REGISTRY_KEY].newValue === undefined → no-op (T-04-03-01)
 *
 * On valid trigger:
 * 1. applyRemote(remoteRegistry) — merge into local registry (registry.ts)
 * 2. reconstructInstructions() — build live payload (tombstones excluded)
 * 3. Update LAST_PUSHED_KEY snapshot (D-04 infinite loop guard)
 * 4. deliverToTab(payload) — send to active tab or queue in pendingRemote
 */
export async function handleRemoteChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): Promise<void> {
  // Guard 1: only process sync-area changes
  if (areaName !== 'sync') return;

  // Guard 2: only process registry key changes
  if (!(REGISTRY_KEY in changes)) return;

  const remoteRegistry = changes[REGISTRY_KEY]?.newValue as SyncRegistry | undefined;

  // Guard 3: skip deletions (newValue undefined means key was removed)
  if (remoteRegistry === undefined) return;

  // Step 1: merge remote into local registry (tombstone-wins + last-write-wins)
  await applyRemote(remoteRegistry);

  // Step 2: reconstruct live instruction array (tombstones excluded, sorted by updatedAt desc)
  const merged = await reconstructInstructions();

  // Step 3: update LAST_PUSHED_KEY snapshot (D-04: prevents pull-triggered LS_CHANGED
  // from scheduling a spurious push flush via diffAndAccumulate's hasChanges check)
  await updateLastPushed(merged);

  // Step 4: deliver to active tab or enqueue for when a tab opens
  const payload: RawInstruction[] = merged.map(({ title, text }) => ({ title, text }));

  console.log('[sysins] pull-engine: applied', payload.length, 'item(s) from remote');

  await deliverToTab(payload);

  // Phase 5: clear badge to healthy empty state after successful pull (D-06)
  // Mirrors the setBadgeText({ text: '' }) call in alarm-flush.ts flushPendingWrite success path.
  const now = Date.now();
  await writeSyncStatus({ state: 'idle', lastSyncAt: now });
  await chrome.action.setBadgeText({ text: '' });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Deliver the merged payload to the active AI Studio tab.
 * Falls through to pendingRemote queue if:
 * - No active AI Studio tab is found, OR
 * - tabs.sendMessage throws (e.g., content script not ready — Pitfall 2)
 *
 * T-04-03-03: URL filter `*://aistudio.google.com/*` ensures we only target
 * the correct origin — no cross-origin delivery risk.
 */
export async function deliverToTab(payload: RawInstruction[]): Promise<void> {
  const tabs = await chrome.tabs.query({ url: '*://aistudio.google.com/*', active: true });
  const tab = tabs[0];

  if (tab?.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_REMOTE',
        payload,
      } satisfies ApplyRemoteMessage);
      return; // delivered successfully
    } catch {
      // Pitfall 2: content script not injected yet, tab navigating, etc.
      // Fall through to pendingRemote queue.
    }
  }

  // No tab or sendMessage failed — queue for when a tab becomes active
  await chrome.storage.local.set({
    [PENDING_REMOTE_KEY]: {
      payload,
      enqueuedAt: Date.now(),
    } satisfies PendingRemoteState,
  });
}

/**
 * Build and persist the LAST_PUSHED_KEY snapshot from the post-merge instruction array.
 *
 * D-04: After a pull, we update lastPushed so that the synthetic StorageEvent
 * that re-applies the merged data to AI Studio does NOT trigger a push cycle.
 * diffAndAccumulate checks hashes against lastPushed — if they match, hasChanges=false
 * and no flush alarm is scheduled.
 *
 * Only live items (included in merged array) are hashed — tombstoned items are
 * excluded from the payload before this call.
 */
async function updateLastPushed(
  merged: Array<{ uuid: string; title: string; text: string }>,
): Promise<void> {
  const entries = await Promise.all(
    merged.map(async ({ uuid, title, text }) => {
      // Body JSON must match push-engine's format for hash consistency (D-12)
      const bodyJson = JSON.stringify({ text });
      const [titleHash, bodyHash] = await Promise.all([shortHash(title), shortHash(bodyJson)]);
      const entry: LastPushedEntry = { titleHash, bodyHash, updatedAt: Date.now() };
      return [uuid, entry] as [string, LastPushedEntry];
    }),
  );

  const snapshot: LastPushedSnapshot = {};
  for (const [uuid, entry] of entries) {
    snapshot[uuid] = entry;
  }
  await chrome.storage.local.set({ [LAST_PUSHED_KEY]: snapshot });
}

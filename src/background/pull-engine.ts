/**
 * Pull Engine — Drive poll-based remote change detection and delivery.
 *
 * Replaces chrome.storage.onChanged listener with pollAndPull(), called from the
 * 30s alarm alongside flushPendingWrite(). When Drive has newer data than the local
 * cache, reconstructs live instructions and delivers them to the active AI Studio tab.
 *
 * D-04 loop guard preserved: updateLastPushed() after delivery so a pull-triggered
 * LS_CHANGED from AI Studio does NOT schedule a spurious push flush.
 */

import type {
  RawInstruction,
  ApplyRemoteMessage,
  PendingRemoteState,
  LastPushedSnapshot,
  LastPushedEntry,
  SyncRegistry,
} from '../shared/types';
import { PENDING_REMOTE_KEY, REGISTRY_KEY } from '../shared/constants';
import { reconstructInstructions } from './registry';
import { LAST_PUSHED_KEY, writeSyncStatus } from './sync-state';
import { shortHash } from './hash';
import { pollDriveForChanges } from './drive-client';

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Poll Drive for changes. If Drive has newer data than the local cache:
 * 1. Cache is already updated by pollDriveForChanges().
 * 2. Reconstruct live instructions from the new cache.
 * 3. Update LAST_PUSHED_KEY (D-04 loop guard).
 * 4. Deliver to active AI Studio tab (or queue in pendingRemote).
 */
export async function pollAndPull(): Promise<void> {
  const newCache = await pollDriveForChanges(false);
  if (newCache === null) return; // no change or network error

  const remoteRegistry = (newCache.data[REGISTRY_KEY] as SyncRegistry | undefined) ?? {};
  const itemCount = Object.values(remoteRegistry).filter((r) => r.deletedAt === null).length;

  const merged = await reconstructInstructions();
  await updateLastPushed(merged);

  const payload: RawInstruction[] = merged.map(({ title, text }) => ({ title, text }));
  console.log('[sysins] pull-engine: applied', payload.length, 'item(s) from remote');

  await deliverToTab(payload);

  const now = Date.now();
  await writeSyncStatus({ state: 'idle', lastSyncAt: now });
  await chrome.action.setBadgeText({ text: '' });

  void itemCount; // used for logging only
}

/**
 * Re-run pull from the current Drive cache (no network call).
 * Used by PULL_NOW button to force re-delivery of already-cached data.
 */
export async function pullFromCache(): Promise<void> {
  const merged = await reconstructInstructions();
  if (merged.length === 0) return;

  await updateLastPushed(merged);
  const payload: RawInstruction[] = merged.map(({ title, text }) => ({ title, text }));
  console.log('[sysins] pull-engine: re-delivered', payload.length, 'item(s) from cache');
  await deliverToTab(payload);

  const now = Date.now();
  await writeSyncStatus({ state: 'idle', lastSyncAt: now });
  await chrome.action.setBadgeText({ text: '' });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

export async function deliverToTab(payload: RawInstruction[]): Promise<void> {
  const tabs = await chrome.tabs.query({ url: '*://aistudio.google.com/*' });
  const tab = tabs[0];

  if (tab?.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_REMOTE',
        payload,
      } satisfies ApplyRemoteMessage);
      return;
    } catch {
      // Content script not ready — fall through to queue
    }
  }

  await chrome.storage.local.set({
    [PENDING_REMOTE_KEY]: {
      payload,
      enqueuedAt: Date.now(),
    } satisfies PendingRemoteState,
  });
}

async function updateLastPushed(
  merged: Array<{ uuid: string; title: string; text: string }>,
): Promise<void> {
  const entries = await Promise.all(
    merged.map(async ({ uuid, title, text }) => {
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

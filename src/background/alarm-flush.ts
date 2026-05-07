/**
 * Alarm Flush — debounce scheduling and batched sync write.
 *
 * This module owns:
 * - PUSH-07: 30-second debounce via chrome.alarms (SW-kill safe — no setTimeout)
 * - PUSH-03: single batched chrome.storage.sync.set (never a per-item write loop)
 * - D-12: lastPushed snapshot written on success (diff baseline for next cycle)
 * - Error surfacing: badge + setErrorState on rate-limit, quota-exceeded, or other failure
 *
 * Hard Rule 3 (PUSH-07): debounce via alarms, not setTimeout (SW-kill unsafe).
 * Hard Rule 3 (PUSH-03): every chrome.storage.sync write is a single batched set().
 * Hard Rule 9: all sync state persisted to chrome.storage.local; SW globals are ephemeral.
 *
 * T-03-03-c: single set() call enforced by design — no per-item write loop anywhere here.
 * T-03-03-d: writeLastPushed is only called after sync.set resolves (linear success path).
 * T-03-03-e: removeStaleBodyKeys reads old registry and removes stale chunk keys before set.
 */

import {
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
  FLUSH_ALARM_NAME,
} from '../shared/constants';
import type { SyncRegistry, LastPushedSnapshot, LastPushedEntry } from '../shared/types';
import {
  LAST_PUSHED_KEY,
  PUSH_BASELINE_KEY,
  writeSyncStatus,
  setErrorState,
} from './sync-state';
import { shortHash } from './hash';
import { drainPendingWrite, clearPendingWrite } from './push-engine';

// ---------------------------------------------------------------------------
// Export: scheduleFlush
// ---------------------------------------------------------------------------

/**
 * Debounce-schedule the flush alarm.
 *
 * Clears then recreates the alarm so rapid LS_CHANGED events collapse to one
 * alarm. Chrome will fire it after ~30s (delayInMinutes: 0.5 is the MV3 minimum
 * in Chrome 120+).
 *
 * PUSH-07: debounce via alarms, not setTimeout — SW-kill safe.
 */
export function scheduleFlush(): void {
  // Clear resets the 30s window — a flurry of LS_CHANGED calls collapses to one alarm.
  // Use Promise pattern (not callback) because WXT/fakeBrowser alarms.clear returns a Promise
  // and does not invoke legacy callbacks.
  void chrome.alarms.clear(FLUSH_ALARM_NAME).then(() => {
    chrome.alarms.create(FLUSH_ALARM_NAME, { delayInMinutes: 0.5 });
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Build a LastPushedEntry for one UUID.
 * Hashes title and bodyJson for the diff baseline (D-12 / Recipe 6).
 */
async function buildLastPushedEntry(
  uuid: string,
  title: string,
  updatedAt: number,
  bodyJson: string,
): Promise<[string, LastPushedEntry]> {
  const [titleHash, bodyHash] = await Promise.all([shortHash(title), shortHash(bodyJson)]);
  return [uuid, { titleHash, bodyHash, updatedAt }];
}

/**
 * Build and persist the lastPushed snapshot from the flushed batch.
 * Only live (non-tombstoned) items are included.
 *
 * T-03-03-d: only called after sync.set resolves successfully.
 */
async function writeLastPushed(batch: Record<string, unknown>): Promise<void> {
  const registry = batch[REGISTRY_KEY] as SyncRegistry | undefined;
  if (registry === undefined) return;

  const entries = await Promise.all(
    Object.entries(registry)
      .filter(([, rec]) => rec.deletedAt === null)
      .map(([uuid, rec]) => {
        // Reconstruct bodyJson from chunk keys in the batch for this UUID.
        const chunkKeys: string[] = [];
        for (let i = 0; i < rec.chunks; i++) {
          chunkKeys.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
        }
        const bodyJson = chunkKeys.map((k) => (batch[k] as string | undefined) ?? '').join('');
        return buildLastPushedEntry(uuid, rec.title, rec.updatedAt, bodyJson);
      }),
  );

  const snapshot: LastPushedSnapshot = {};
  for (const [uuid, entry] of entries) {
    snapshot[uuid] = entry;
  }
  await chrome.storage.local.set({
    [LAST_PUSHED_KEY]: snapshot,
    [PUSH_BASELINE_KEY]: snapshot,
  });
}

/**
 * Remove stale body chunk keys when the chunk count for a UUID decreased.
 * Reads the old registry from sync BEFORE the new set() to determine which
 * chunk indices are now obsolete.
 *
 * T-03-03-e: prevents ghost chunks confusing reassembly on the pull side.
 */
async function removeStaleBodyKeys(batch: Record<string, unknown>): Promise<void> {
  const registry = batch[REGISTRY_KEY] as SyncRegistry | undefined;
  if (registry === undefined) return;

  // Read the current (pre-flush) registry from sync storage.
  const r = await chrome.storage.sync.get(REGISTRY_KEY);
  const oldRegistry = (r[REGISTRY_KEY] as SyncRegistry | undefined) ?? {};

  const stale: string[] = [];
  for (const [uuid, newRec] of Object.entries(registry)) {
    const oldRec = oldRegistry[uuid];
    if (newRec.deletedAt !== null && (oldRec === undefined || oldRec.deletedAt === null)) {
      // Newly tombstoned: remove all body keys for this uuid.
      const chunkCount = oldRec?.chunks ?? newRec.chunks;
      for (let i = 0; i < chunkCount; i++) {
        stale.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
      }
    } else if (oldRec !== undefined && oldRec.chunks > newRec.chunks) {
      // Chunk count decreased: remove orphaned tail chunks.
      for (let i = newRec.chunks; i < oldRec.chunks; i++) {
        stale.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
      }
    }
  }
  if (stale.length > 0) {
    await chrome.storage.sync.remove(stale);
  }
}

// ---------------------------------------------------------------------------
// Export: flushPendingWrite
// ---------------------------------------------------------------------------

/**
 * Flush the pending write batch to chrome.storage.sync.
 *
 * Called by the onAlarm listener in index.ts when the 'sysins-flush' alarm fires.
 *
 * Steps:
 * 1. Drain pendingWrite from chrome.storage.local. If empty → no-op.
 * 2. Set syncStatus to 'syncing'.
 * 3. Remove stale body keys (chunk count decreased) — must happen BEFORE set().
 * 4. Single batched chrome.storage.sync.set(batch) — PUSH-03.
 * 5. On success: writeLastPushed, clearPendingWrite, set status idle, clear badge.
 * 6. On rate-limit: amber badge, RATE_LIMITED, retry alarm at 1 min. Preserve pendingWrite.
 * 7. On quota-exceeded: red badge, QUOTA_EXCEEDED. No retry. Preserve pendingWrite.
 * 8. On other error: red badge, STRICT_VALIDATION_FAIL. No retry. Preserve pendingWrite.
 */
export async function flushPendingWrite(): Promise<void> {
  const batch = await drainPendingWrite();
  if (batch === null || Object.keys(batch).length === 0) return; // no-op

  await writeSyncStatus({ state: 'syncing', lastSyncAt: 0 });

  // T-03-03-e: remove stale body keys BEFORE writing new registry (avoids ghost chunks).
  await removeStaleBodyKeys(batch);

  try {
    // PUSH-03 / T-03-03-c: single batched set — never a per-item loop.
    await chrome.storage.sync.set(batch);

    const now = Date.now();
    await writeLastPushed(batch);   // D-12: snapshot for next diff cycle (after set)
    await clearPendingWrite();       // clear sentinel
    await writeSyncStatus({ state: 'idle', lastSyncAt: now });
    await chrome.action.setBadgeText({ text: '' }); // clear any prior error badge
  } catch (err) {
    const msg = String(err);
    if (msg.includes('MAX_WRITE_OPERATIONS_PER_MINUTE') || msg.includes('RATE_LIMIT')) {
      // T-03-03-a: rate limit — retry in 60s, preserve pendingWrite, amber badge.
      await setErrorState('RATE_LIMITED', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' }); // amber
      chrome.alarms.create(FLUSH_ALARM_NAME, { delayInMinutes: 1 });
    } else if (msg.includes('QUOTA_BYTES')) {
      // T-03-03-b: quota exceeded — no retry, red badge, user action required.
      await setErrorState('QUOTA_EXCEEDED', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red
    } else {
      // Other failure — red badge, strict validation fail.
      await setErrorState('STRICT_VALIDATION_FAIL', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red
    }
    // pendingWrite intentionally NOT cleared on failure — preserved for retry/inspection.
  }
}

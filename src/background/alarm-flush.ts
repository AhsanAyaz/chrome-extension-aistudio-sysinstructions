/**
 * Alarm Flush — debounce scheduling and Drive write.
 *
 * Replaces chrome.storage.sync.set() with flushToDrive() (Google Drive AppData).
 * All other semantics preserved: 30s debounce, single batched write, lastPushed snapshot,
 * error surfacing via badge + setErrorState.
 */

import {
  FLUSH_ALARM_NAME,
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
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
import { flushToDrive } from './drive-client';

// ---------------------------------------------------------------------------
// Export: scheduleFlush
// ---------------------------------------------------------------------------

export function scheduleFlush(): void {
  void chrome.alarms.clear(FLUSH_ALARM_NAME).then(() => {
    chrome.alarms.create(FLUSH_ALARM_NAME, { delayInMinutes: 0.5 });
  });
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function buildLastPushedEntry(
  uuid: string,
  title: string,
  updatedAt: number,
  bodyJson: string,
): Promise<[string, LastPushedEntry]> {
  const [titleHash, bodyHash] = await Promise.all([shortHash(title), shortHash(bodyJson)]);
  return [uuid, { titleHash, bodyHash, updatedAt }];
}

async function writeLastPushed(batch: Record<string, unknown>): Promise<void> {
  const registry = batch[REGISTRY_KEY] as SyncRegistry | undefined;
  if (registry === undefined) return;

  const entries = await Promise.all(
    Object.entries(registry)
      .filter(([, rec]) => rec.deletedAt === null)
      .map(([uuid, rec]) => {
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

// ---------------------------------------------------------------------------
// Export: flushPendingWrite
// ---------------------------------------------------------------------------

export async function flushPendingWrite(): Promise<void> {
  const batch = await drainPendingWrite();
  if (batch === null || Object.keys(batch).length === 0) return;

  await writeSyncStatus({ state: 'syncing', lastSyncAt: 0 });

  try {
    await flushToDrive(batch, true);

    const now = Date.now();
    await writeLastPushed(batch);
    await clearPendingWrite();
    await writeSyncStatus({ state: 'idle', lastSyncAt: now });
    await chrome.action.setBadgeText({ text: '' });
  } catch (err) {
    const msg = String(err);
    if (msg.includes('429') || msg.includes('RATE_LIMIT') || msg.includes('userRateLimitExceeded')) {
      await setErrorState('RATE_LIMITED', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
      chrome.alarms.create(FLUSH_ALARM_NAME, { delayInMinutes: 1 });
    } else if (msg.includes('storageQuota') || msg.includes('QUOTA')) {
      await setErrorState('QUOTA_EXCEEDED', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
    } else {
      await setErrorState('STRICT_VALIDATION_FAIL', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
    }
  }
}

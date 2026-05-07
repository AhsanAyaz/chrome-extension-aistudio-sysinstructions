import { META_LOCAL_KEY, SCHEMA_VERSION } from '../shared/constants';
import type { SyncMeta } from '../shared/types';

/**
 * Bootstrap sysins:meta into chrome.storage.local on onInstalled.
 * Moved from chrome.storage.sync — meta is device-informational only
 * (lastPushAt, lastPullAt), not needed for cross-device sync.
 */
export async function initializeMeta(): Promise<void> {
  const existing = await chrome.storage.local.get(META_LOCAL_KEY);
  if (existing[META_LOCAL_KEY] === undefined) {
    const meta: SyncMeta = {
      schemaVersion: SCHEMA_VERSION,
      lastPushAt: 0,
      lastPullAt: 0,
    };
    await chrome.storage.local.set({ [META_LOCAL_KEY]: meta });
  }
}

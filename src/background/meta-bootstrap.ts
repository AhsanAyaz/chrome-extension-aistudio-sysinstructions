import { META_KEY, SCHEMA_VERSION } from '../shared/constants';
import type { SyncMeta } from '../shared/types';

/**
 * Bootstrap sysins:meta on chrome.runtime.onInstalled (D-10, Recipe 4).
 * Write-if-absent: another device may have already populated meta with
 * the identical value, in which case we leave it alone. Per D-10 the
 * race is benign (the value is identical).
 *
 * If a non-1 schemaVersion is already present, do NOT overwrite — the
 * meta-guard (Recipe 7) at the next sync entrypoint will refuse I/O and
 * surface SCHEMA_AHEAD or SCHEMA_UNKNOWN.
 */
export async function initializeMeta(): Promise<void> {
  const existing = await chrome.storage.sync.get(META_KEY);
  if (existing[META_KEY] === undefined) {
    const meta: SyncMeta = {
      schemaVersion: SCHEMA_VERSION,
      lastPushAt: 0,
      lastPullAt: 0,
    };
    await chrome.storage.sync.set({ [META_KEY]: meta });
  }
  // else: leave existing in place. Schema-guard catches mismatches at next sync entry.
}

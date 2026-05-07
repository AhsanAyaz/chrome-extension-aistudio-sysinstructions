import { META_LOCAL_KEY, SCHEMA_VERSION } from './constants';
import type { SyncMeta } from './types';

export type GuardResult =
  | { ok: true; meta: SyncMeta }
  | { ok: false; tag: 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' };

/**
 * Schema-version reader guard (D-09, Recipe 7).
 * Reads from chrome.storage.local (meta moved from sync — device-informational only).
 */
export async function loadAndAssertMeta(): Promise<GuardResult> {
  const r = await chrome.storage.local.get(META_LOCAL_KEY);
  const meta = r[META_LOCAL_KEY] as SyncMeta | undefined;

  if (meta === undefined) {
    return { ok: false, tag: 'MALFORMED_REMOTE' };
  }
  if (typeof meta.schemaVersion !== 'number') {
    return { ok: false, tag: 'MALFORMED_REMOTE' };
  }
  if (meta.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, tag: 'SCHEMA_AHEAD' };
  }
  if (meta.schemaVersion < SCHEMA_VERSION) {
    return { ok: false, tag: 'SCHEMA_UNKNOWN' };
  }
  return { ok: true, meta };
}

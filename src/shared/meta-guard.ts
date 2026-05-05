import { META_KEY, SCHEMA_VERSION } from './constants';
import type { SyncMeta } from './types';

export type GuardResult =
  | { ok: true; meta: SyncMeta }
  | { ok: false; tag: 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' };

/**
 * Schema-version reader guard (D-09, Recipe 7).
 * Every sync entrypoint must pass through this before reading sysins:* keys.
 * Refuse-on-mismatch is the v1 contract (D-11 locks schemaVersion=1 for all of v1.x).
 *
 * OQ-3 decision: "meta absent" is folded into MALFORMED_REMOTE rather than a dedicated
 * 'NO_META' tag. Practical impact is identical (refuse all I/O). Phase 1 keeps ErrorState
 * to the 9 already-locked members. A future Phase 2+ extension can add a clearer signal
 * if the distinction between "no meta ever written" vs "meta corrupted" becomes meaningful.
 */
export async function loadAndAssertMeta(): Promise<GuardResult> {
  const r = await chrome.storage.sync.get(META_KEY);
  const meta = r[META_KEY] as SyncMeta | undefined;

  if (meta === undefined) {
    // First read on a freshly-installed device before initializeMeta() ran,
    // OR remote state is genuinely absent. Caller may treat as a recoverable
    // "no remote yet" state OR as MALFORMED_REMOTE depending on context.
    // Phase 1 folds both into MALFORMED_REMOTE per Recipe 7 default.
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

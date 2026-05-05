import { defineBackground } from 'wxt/utils/define-background';
import { initializeMeta } from './meta-bootstrap';
import {
  readSyncPending,
  clearSyncPending,
} from './sync-state';
import { PENDING_BATCH_TTL_MS } from '../shared/constants';

/**
 * Module-level ephemeral state. Lost on real SW kill (which is the entire
 * reason FND-06 / D-12-D-15 mirror sync state to chrome.storage.local).
 * The `_resetForTesting` export simulates that loss for FND-06's restart test.
 */
let inMemoryState: { initialized: boolean } = { initialized: false };

/**
 * SW-wake recovery. Idempotent — safe to call from multiple entrypoints.
 *
 * Phase 1 responsibility:
 *   - Detect an orphaned `sysins:local:syncPending` sentinel (startedAt
 *     older than PENDING_BATCH_TTL_MS = 60s) and clear it (D-13).
 *
 * Phase 3+ extends this to:
 *   - Re-derive sync state from registry on orphan detected
 *   - Drain `sysins:local:pendingMerges` if non-empty
 *
 * Decision: orphan recovery does NOT call setErrorState — it's an expected
 * recovery path on SW restart, not a user-facing error. Phase 3 may add a
 * recovery-log surface if visibility is needed.
 */
export async function ensureInitialized(): Promise<void> {
  if (inMemoryState.initialized) return;

  const pending = await readSyncPending();
  if (pending !== undefined) {
    const ageMs = Date.now() - pending.startedAt;
    if (ageMs > PENDING_BATCH_TTL_MS) {
      // Orphaned: another SW instance died mid-write more than 60s ago.
      // Clear the sentinel; Phase 3 will redrive any necessary push from
      // a fresh registry read.
      await clearSyncPending();
    }
    // else: a sibling SW instance may still be writing — back off.
    // Phase 3 will add the back-off retry; Phase 1 just observes.
  }

  inMemoryState.initialized = true;
}

/**
 * @internal Testing seam (Pattern S-4) — clears module-level state to
 * simulate a real service-worker kill. Tests call this before re-running
 * `ensureInitialized()` to verify FND-06's restart-resume contract.
 */
export function _resetForTesting(): void {
  inMemoryState = { initialized: false };
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await initializeMeta();
    await ensureInitialized();
  });

  // Phase 1 boundary discipline:
  //   - No chrome.runtime.onMessage listener (Phase 2)
  //   - No chrome.storage.onChanged listener (Phase 3)
  //   - No chrome.alarms (Phase 3)
  //   - No chrome.tabs.sendMessage (Phase 4)
  // Adding these now would entangle scopes and break the phase boundary.
});

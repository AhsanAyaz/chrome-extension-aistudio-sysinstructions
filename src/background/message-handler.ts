import { LAST_OBSERVED_KEY } from '../shared/constants';
import type { RawInstruction, LastObservedSnapshot } from '../shared/types';

/**
 * Phase 2 SW stub for LS_CHANGED messages.
 *
 * D-01 (SW stub behavior): logs payload to SW console AND writes a snapshot
 * to chrome.storage.local so DevTools storage inspector can verify receipt.
 *
 * D-02 (snapshot key): writes under sysins:local:lastObserved.
 * Phase 3 reads this key as the initial diff baseline before the first push.
 *
 * Note: payload items are stored verbatim — no field stripping (D-08 / PUSH-06).
 */
export async function handleLsChanged(
  payload: RawInstruction[],
): Promise<void> {
  console.log('[sysins] LS_CHANGED received:', payload.length, 'items');

  const snapshot: LastObservedSnapshot = {
    lastObservedAt: Date.now(),
    itemCount: payload.length,
    items: payload,
  };
  await chrome.storage.local.set({ [LAST_OBSERVED_KEY]: snapshot });
}

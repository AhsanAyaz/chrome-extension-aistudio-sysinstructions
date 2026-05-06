import type { RawInstruction } from '../shared/types';
import { diffAndAccumulate } from './push-engine';
import { scheduleFlush } from './alarm-flush';

// Serialization lock: ensures concurrent LS_CHANGED messages are processed
// one at a time. AI Studio fires multiple setItem calls during a single edit
// (autosave intermediate states), and concurrent diffAndAccumulate calls race
// to overwrite pendingWrite — the last writer can clobber a valid tombstone.
let diffQueue: Promise<void> = Promise.resolve();

/**
 * Phase 3 handler for LS_CHANGED messages.
 *
 * Delegates to push-engine (diff + UUID assignment + pendingWrite accumulation)
 * and schedules the 30-second debounced alarm flush (PUSH-07).
 *
 * Security: log UUID count only — never log .text content (RESEARCH security domain).
 */
export async function handleLsChanged(payload: RawInstruction[], pageEmail?: string): Promise<void> {
  console.log('[sysins] push: received', payload.length, 'item(s)');
  // Chain onto the existing queue so each diff runs after the previous one
  // completes — prevents intermediate AI Studio states from overwriting
  // tombstones written by later (final-state) events.
  diffQueue = diffQueue
    .then(() => diffAndAccumulate(payload))
    .catch(() => {/* swallow to keep queue alive on error */});
  await diffQueue;
  if (payload.length > 0) {
    scheduleFlush();
  }
}

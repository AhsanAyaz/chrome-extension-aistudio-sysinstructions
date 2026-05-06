import type { RawInstruction } from '../shared/types';
import { diffAndAccumulate } from './push-engine';
import { scheduleFlush } from './alarm-flush';

/**
 * Phase 3 handler for LS_CHANGED messages.
 *
 * Delegates to push-engine (diff + UUID assignment + pendingWrite accumulation)
 * and schedules the 30-second debounced alarm flush (PUSH-07).
 *
 * Security: log UUID count only — never log .text content (RESEARCH security domain).
 */
export async function handleLsChanged(payload: RawInstruction[]): Promise<void> {
  console.log('[sysins] push: received', payload.length, 'item(s)');
  await diffAndAccumulate(payload);
  if (payload.length > 0) {
    scheduleFlush();
  }
}

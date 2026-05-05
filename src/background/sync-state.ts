import {
  LOCAL_KEY_PREFIX,
  PENDING_MERGE_QUEUE_CAP,
} from '../shared/constants';
import type {
  SyncStatus,
  SyncPendingSentinel,
  PendingMerge,
  LastPushedSnapshot,
  ErrorState,
} from '../shared/types';

// The four sysins:local:* resume keys (D-12, D-13, D-14, D-15).
// Constructed from LOCAL_KEY_PREFIX so the namespace stays disciplined.
export const SYNC_STATUS_KEY = `${LOCAL_KEY_PREFIX}syncStatus`;
export const SYNC_PENDING_KEY = `${LOCAL_KEY_PREFIX}syncPending`;
export const LAST_PUSHED_KEY = `${LOCAL_KEY_PREFIX}lastPushed`;
export const PENDING_MERGES_KEY = `${LOCAL_KEY_PREFIX}pendingMerges`;

const DEFAULT_STATUS: SyncStatus = { state: 'idle', lastSyncAt: 0 };

// ---- syncStatus (D-15) ----------------------------------------------------

export async function readSyncStatus(): Promise<SyncStatus> {
  const r = await chrome.storage.local.get(SYNC_STATUS_KEY);
  return (r[SYNC_STATUS_KEY] as SyncStatus | undefined) ?? DEFAULT_STATUS;
}

export async function writeSyncStatus(status: SyncStatus): Promise<void> {
  // Discipline: under exactOptionalPropertyTypes, never write errorState: undefined.
  // Build a clean object instead.
  const clean: SyncStatus = { state: status.state, lastSyncAt: status.lastSyncAt };
  if (status.errorState !== undefined) clean.errorState = status.errorState;
  if (status.errorDetail !== undefined) clean.errorDetail = status.errorDetail;
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: clean });
}

export async function setErrorState(tag: ErrorState, detail?: string): Promise<void> {
  const current = await readSyncStatus();
  const next: SyncStatus = {
    state: 'error',
    lastSyncAt: current.lastSyncAt,
    errorState: tag,
  };
  if (detail !== undefined) next.errorDetail = detail;
  await writeSyncStatus(next);
}

// ---- syncPending sentinel (D-13) ------------------------------------------

export async function readSyncPending(): Promise<SyncPendingSentinel | undefined> {
  const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
  return r[SYNC_PENDING_KEY] as SyncPendingSentinel | undefined;
}

export async function clearSyncPending(): Promise<void> {
  await chrome.storage.local.remove(SYNC_PENDING_KEY);
}

// ---- lastPushed snapshot (D-12) -------------------------------------------

export async function readLastPushed(): Promise<LastPushedSnapshot> {
  const r = await chrome.storage.local.get(LAST_PUSHED_KEY);
  return (r[LAST_PUSHED_KEY] as LastPushedSnapshot | undefined) ?? {};
}

// ---- pendingMerges queue (D-14) -------------------------------------------

export async function readPendingMerges(): Promise<PendingMerge[]> {
  const r = await chrome.storage.local.get(PENDING_MERGES_KEY);
  return (r[PENDING_MERGES_KEY] as PendingMerge[] | undefined) ?? [];
}

/**
 * Append a pending merge. If the queue would exceed PENDING_MERGE_QUEUE_CAP
 * (10), drop the oldest entries and flag PENDING_MERGE_OVERFLOW in syncStatus
 * (D-14, OQ-1 widening).
 */
export async function enqueuePendingMerge(merge: PendingMerge): Promise<void> {
  const queue = await readPendingMerges();
  queue.push(merge);
  if (queue.length > PENDING_MERGE_QUEUE_CAP) {
    const dropped = queue.length - PENDING_MERGE_QUEUE_CAP;
    queue.splice(0, dropped); // drop oldest
    await setErrorState('PENDING_MERGE_OVERFLOW', `dropped ${dropped} oldest events`);
  }
  await chrome.storage.local.set({ [PENDING_MERGES_KEY]: queue });
}

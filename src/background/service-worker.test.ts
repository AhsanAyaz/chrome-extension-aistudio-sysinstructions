import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { initializeMeta } from './meta-bootstrap';
import { ensureInitialized, _resetForTesting } from './index';
import {
  readSyncStatus,
  enqueuePendingMerge,
  SYNC_PENDING_KEY,
  PENDING_MERGES_KEY,
} from './sync-state';
import { META_LOCAL_KEY, PENDING_MERGE_QUEUE_CAP } from '../shared/constants';
import type { SyncMeta, SyncPendingSentinel, PendingMerge } from '../shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
});

describe('initializeMeta (FND-04, D-10 write-if-absent)', () => {
  it('writes default meta on first install when sysins:meta is absent', async () => {
    await initializeMeta();

    const r = await chrome.storage.local.get(META_LOCAL_KEY);
    const meta = r[META_LOCAL_KEY] as SyncMeta;
    expect(meta).toEqual({ schemaVersion: 1, lastPushAt: 0, lastPullAt: 0 });
  });

  it('does NOT overwrite existing meta with non-default lastPushAt', async () => {
    const preExisting: SyncMeta = { schemaVersion: 1, lastPushAt: 12345, lastPullAt: 67890 };
    await chrome.storage.local.set({ [META_LOCAL_KEY]: preExisting });

    await initializeMeta();

    const r = await chrome.storage.local.get(META_LOCAL_KEY);
    expect(r[META_LOCAL_KEY]).toEqual(preExisting); // unchanged — D-10
  });

  it('does NOT overwrite an ahead-version meta (schemaVersion: 2)', async () => {
    const ahead = { schemaVersion: 2, lastPushAt: 0, lastPullAt: 0 };
    await chrome.storage.local.set({ [META_LOCAL_KEY]: ahead });

    await initializeMeta();

    const r = await chrome.storage.local.get(META_LOCAL_KEY);
    expect(r[META_LOCAL_KEY]).toEqual(ahead); // unchanged — schema-guard handles at next read
  });
});

describe('ensureInitialized (FND-06, D-13 orphan recovery)', () => {
  it('clears an orphaned syncPending sentinel (startedAt > 60s ago)', async () => {
    const sentinel: SyncPendingSentinel = {
      batchId: 'orphan-1',
      keys: ['sysins:body:abc:c0'],
      startedAt: Date.now() - 90_000, // 90s ago — orphaned
    };
    await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

    await ensureInitialized();

    const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
    expect(r[SYNC_PENDING_KEY]).toBeUndefined();
  });

  it('does NOT clear a recent syncPending sentinel (startedAt within TTL)', async () => {
    const sentinel: SyncPendingSentinel = {
      batchId: 'recent-1',
      keys: ['sysins:body:abc:c0'],
      startedAt: Date.now() - 5_000, // 5s ago — still in flight
    };
    await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

    await ensureInitialized();

    const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
    expect(r[SYNC_PENDING_KEY]).toEqual(sentinel); // preserved
  });

  it('is idempotent within a SW lifetime — second call is a no-op', async () => {
    // First call: clears nothing (no sentinel)
    await ensureInitialized();

    // Now plant an orphaned sentinel
    const sentinel: SyncPendingSentinel = {
      batchId: 'planted-after',
      keys: [],
      startedAt: Date.now() - 90_000,
    };
    await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

    // Second call: no-op because inMemoryState.initialized === true
    await ensureInitialized();

    const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
    expect(r[SYNC_PENDING_KEY]).toEqual(sentinel); // NOT cleared
  });

  it('_resetForTesting re-arms the orphan check (simulates real SW kill+wake)', async () => {
    await ensureInitialized();

    // Plant an orphan after first init
    const sentinel: SyncPendingSentinel = {
      batchId: 'after-reset',
      keys: [],
      startedAt: Date.now() - 90_000,
    };
    await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

    // Simulate SW kill+wake
    _resetForTesting();
    await ensureInitialized();

    const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
    expect(r[SYNC_PENDING_KEY]).toBeUndefined(); // cleared after reset+re-init
  });
});

describe('enqueuePendingMerge cap enforcement (D-14, OQ-1)', () => {
  it('drops oldest and flags PENDING_MERGE_OVERFLOW when queue exceeds cap', async () => {
    // Pre-populate with PENDING_MERGE_QUEUE_CAP (10) entries
    const initial: PendingMerge[] = Array.from({ length: PENDING_MERGE_QUEUE_CAP }, (_, i) => ({
      changes: `event-${i}`,
      receivedAt: i,
    }));
    await chrome.storage.local.set({ [PENDING_MERGES_KEY]: initial });

    // Add the 11th — should drop oldest (event-0)
    await enqueuePendingMerge({ changes: 'event-new', receivedAt: 1000 });

    const r = await chrome.storage.local.get(PENDING_MERGES_KEY);
    const queue = r[PENDING_MERGES_KEY] as PendingMerge[];
    expect(queue).toHaveLength(PENDING_MERGE_QUEUE_CAP);
    expect(queue[0]?.changes).toBe('event-1'); // oldest dropped
    expect(queue[queue.length - 1]?.changes).toBe('event-new');

    const status = await readSyncStatus();
    expect(status.state).toBe('error');
    expect(status.errorState).toBe('PENDING_MERGE_OVERFLOW');
    expect(status.errorDetail).toMatch(/dropped 1/);
  });
});

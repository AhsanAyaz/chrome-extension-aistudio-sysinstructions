import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { _resetForTesting, ensureInitialized } from './index';
import { handleLsChanged } from './message-handler';
import { SYNC_PENDING_KEY } from './sync-state';
import type { RawInstruction } from '../shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
  // fakeBrowser does not implement chrome.action badge methods — stub them out
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});

describe('handleLsChanged Phase 3 wiring (PUSH-02, PUSH-03, PUSH-07)', () => {
  it('schedules sysins-flush alarm after non-empty payload', async () => {
    await handleLsChanged([{ title: 'Test', text: 'hello' }]);
    const alarm = await fakeBrowser.alarms.get('sysins-flush');
    expect(alarm).toBeDefined();
  });

  it('does not schedule alarm for empty payload', async () => {
    await handleLsChanged([]);
    const alarm = await fakeBrowser.alarms.get('sysins-flush');
    expect(alarm).toBeUndefined();
  });

  it('writes pendingWrite to chrome.storage.local after non-empty payload', async () => {
    await handleLsChanged([{ title: 'T', text: 'A' }]);
    const r = await chrome.storage.local.get('sysins:local:pendingWrite');
    expect(r['sysins:local:pendingWrite']).toBeDefined();
  });
});

describe('D-03: ensureInitialized runs on LS_CHANGED wake', () => {
  it('replaces orphaned syncPending with a fresh sentinel after ensureInitialized + handleLsChanged', async () => {
    const orphanBatchId = 'orphan-batch-id';
    // Plant an orphaned sentinel (mimics a SW that died mid-write > 60s ago)
    await chrome.storage.local.set({
      [SYNC_PENDING_KEY]: {
        batchId: orphanBatchId,
        keys: ['sysins:body:abc:c0'],
        startedAt: Date.now() - 90_000,
      },
    });

    // D-03: index.ts onMessage handler chains ensureInitialized → handleLsChanged
    // ensureInitialized clears the orphan; handleLsChanged (Phase 3) writes a fresh one.
    await ensureInitialized();
    await handleLsChanged([{ title: 'T', text: 'A' }]);

    const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
    const sentinel = r[SYNC_PENDING_KEY] as { batchId: string; startedAt: number } | undefined;
    // Phase 3: a fresh sentinel exists (written by diffAndAccumulate via persistPendingWrite)
    expect(sentinel).toBeDefined();
    // The new sentinel must not be the orphan — batchId is a fresh UUID
    expect(sentinel!.batchId).not.toBe(orphanBatchId);
    // The new sentinel's startedAt is recent (not 90s ago)
    expect(sentinel!.startedAt).toBeGreaterThan(Date.now() - 5_000);
  });
});

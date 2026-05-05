import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { _resetForTesting, ensureInitialized } from './index';
import { handleLsChanged } from './message-handler';
import { LAST_OBSERVED_KEY } from '../shared/constants';
import { SYNC_PENDING_KEY } from './sync-state';
import type { LastObservedSnapshot, RawInstruction } from '../shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
});

describe('handleLsChanged (D-01, D-02)', () => {
  it('writes lastObserved snapshot to chrome.storage.local with correct shape', async () => {
    const payload: RawInstruction[] = [{ title: 'T', text: 'A' }];
    await handleLsChanged(payload);

    const r = await chrome.storage.local.get(LAST_OBSERVED_KEY);
    const snap = r[LAST_OBSERVED_KEY] as LastObservedSnapshot;
    expect(snap.itemCount).toBe(1);
    expect(snap.items).toHaveLength(1);
    expect(snap.lastObservedAt).toBeGreaterThan(0);
  });

  it('preserves unknown fields on instruction items verbatim in snapshot (PUSH-06)', async () => {
    const payload: RawInstruction[] = [
      { title: 'T', text: 'A', extraField: 'preserved', nestedExtra: { deep: true } },
    ];
    await handleLsChanged(payload);

    const r = await chrome.storage.local.get(LAST_OBSERVED_KEY);
    const snap = r[LAST_OBSERVED_KEY] as LastObservedSnapshot;
    expect(snap.items[0]!.extraField).toBe('preserved');
    expect(snap.items[0]!.nestedExtra).toEqual({ deep: true });
  });
});

describe('D-03: ensureInitialized runs on LS_CHANGED wake', () => {
  it('clears orphaned syncPending when ensureInitialized + handleLsChanged run in sequence', async () => {
    // Plant an orphaned sentinel (mimics a SW that died mid-write > 60s ago)
    await chrome.storage.local.set({
      [SYNC_PENDING_KEY]: {
        batchId: 'orphan',
        keys: ['sysins:body:abc:c0'],
        startedAt: Date.now() - 90_000,
      },
    });

    // D-03: index.ts onMessage handler chains ensureInitialized → handleLsChanged
    await ensureInitialized();
    await handleLsChanged([{ title: 'T', text: 'A' }]);

    const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
    expect(r[SYNC_PENDING_KEY]).toBeUndefined(); // orphan cleared
  });
});

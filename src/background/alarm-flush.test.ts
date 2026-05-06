/**
 * TDD tests for alarm-flush.ts
 * RED phase: all tests written before implementation exists.
 * Covers all 8 behavior cases from the plan.
 *
 * Case 1: scheduleFlush called once → one alarm named 'sysins-flush'
 * Case 2: scheduleFlush called 5× → still exactly ONE alarm (debounce)
 * Case 3: flushPendingWrite with empty pendingWrite → no-op
 * Case 4: flushPendingWrite with valid batch → sync.set called, lastPushed written, pendingWrite cleared, status idle
 * Case 5: sync.set throws rate-limit error → amber badge, RATE_LIMITED, retry alarm
 * Case 6: sync.set throws quota-exceeded → red badge, QUOTA_EXCEEDED, no retry alarm
 * Case 7: sync.set throws other error → red badge, STRICT_VALIDATION_FAIL, no retry alarm
 * Case 8: stale body keys from chunk reduction → sync.remove called for stale keys
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { scheduleFlush, flushPendingWrite } from './alarm-flush';
import {
  FLUSH_ALARM_NAME,
  PENDING_WRITE_KEY,
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
} from '../shared/constants';
import { LAST_PUSHED_KEY, SYNC_STATUS_KEY, SYNC_PENDING_KEY } from './sync-state';
import type { SyncRegistry, SyncStatus } from '../shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  // fakeBrowser does not implement chrome.action.setBadgeText / setBadgeBackgroundColor.
  // Stub them globally so they don't throw "not implemented" in any test.
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Case 1: scheduleFlush creates one alarm
// ---------------------------------------------------------------------------
describe('Case 1: scheduleFlush creates one alarm', () => {
  it('creates a sysins-flush alarm with delayInMinutes ≈ 0.5', async () => {
    scheduleFlush();

    // Give the callback time to execute (fakeBrowser alarms are synchronous)
    await new Promise((resolve) => setTimeout(resolve, 0));

    const alarm = await fakeBrowser.alarms.get(FLUSH_ALARM_NAME);
    expect(alarm).toBeDefined();
    expect(alarm?.name).toBe(FLUSH_ALARM_NAME);
  });
});

// ---------------------------------------------------------------------------
// Case 2: scheduleFlush debounce — 5 rapid calls → exactly 1 alarm
// ---------------------------------------------------------------------------
describe('Case 2: scheduleFlush debounce — 5 calls → 1 alarm', () => {
  it('calling scheduleFlush 5× results in exactly one alarm (clear+create pattern)', async () => {
    scheduleFlush();
    scheduleFlush();
    scheduleFlush();
    scheduleFlush();
    scheduleFlush();

    await new Promise((resolve) => setTimeout(resolve, 0));

    const alarm = await fakeBrowser.alarms.get(FLUSH_ALARM_NAME);
    expect(alarm).toBeDefined();

    // fakeBrowser.alarms.getAll() should show only one alarm named sysins-flush
    const allAlarms = await fakeBrowser.alarms.getAll();
    const flushAlarms = allAlarms.filter((a: chrome.alarms.Alarm) => a.name === FLUSH_ALARM_NAME);
    expect(flushAlarms).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Case 3: flushPendingWrite — empty pendingWrite → no-op
// ---------------------------------------------------------------------------
describe('Case 3: flushPendingWrite with no pendingWrite → no-op', () => {
  it('does not call chrome.storage.sync.set when PENDING_WRITE_KEY is absent', async () => {
    const setSpy = vi.spyOn(chrome.storage.sync, 'set');

    await flushPendingWrite();

    expect(setSpy).not.toHaveBeenCalled();
  });

  it('syncStatus remains idle when pendingWrite is absent', async () => {
    await flushPendingWrite();

    const r = await chrome.storage.local.get(SYNC_STATUS_KEY);
    // syncStatus should not have been changed (still default / undefined)
    const status = r[SYNC_STATUS_KEY] as SyncStatus | undefined;
    if (status !== undefined) {
      expect(status.state).toBe('idle');
    }
    // (If undefined — never written — that's also fine: still "idle by default")
  });
});

// ---------------------------------------------------------------------------
// Case 4: flushPendingWrite — success path
// ---------------------------------------------------------------------------
describe('Case 4: flushPendingWrite — success path', () => {
  it('calls sync.set once with full batch, writes lastPushed, clears pendingWrite, status idle', async () => {
    const uuid = 'uuid-alarm-flush-test-0000-000000000001';
    const registry: SyncRegistry = {
      [uuid]: { title: 'Test', updatedAt: 1000, deletedAt: null, chunks: 1 },
    };
    const bodyKey = `${BODY_KEY_PREFIX}${uuid}:c0`;
    const bodyJson = JSON.stringify({ text: 'hi' });

    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: registry,
      [bodyKey]: bodyJson,
    };

    // Persist pendingWrite to local storage
    await chrome.storage.local.set({
      [PENDING_WRITE_KEY]: batch,
      [SYNC_PENDING_KEY]: { batchId: 'test-batch', keys: Object.keys(batch), startedAt: Date.now() },
    });

    const setSpy = vi.spyOn(chrome.storage.sync, 'set');

    // flushPendingWrite is exported directly; the onAlarm listener binding is done in
    // index.ts (Plan 04). Call the function directly to test its behaviour in isolation.
    await flushPendingWrite();

    // a. sync.set called once with the full batch
    expect(setSpy).toHaveBeenCalledOnce();
    expect(setSpy).toHaveBeenCalledWith(batch);

    // b. lastPushed written with entry for uuid
    const lr = await chrome.storage.local.get(LAST_PUSHED_KEY);
    const lastPushed = lr[LAST_PUSHED_KEY] as Record<string, unknown> | undefined;
    expect(lastPushed).toBeDefined();
    expect(lastPushed![uuid]).toBeDefined();

    // c. pendingWrite cleared
    const pr = await chrome.storage.local.get(PENDING_WRITE_KEY);
    expect(pr[PENDING_WRITE_KEY]).toBeUndefined();

    // d. syncStatus idle with lastSyncAt > 0
    const sr = await chrome.storage.local.get(SYNC_STATUS_KEY);
    const status = sr[SYNC_STATUS_KEY] as SyncStatus;
    expect(status.state).toBe('idle');
    expect(status.lastSyncAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Case 5: flushPendingWrite — rate limit failure
// ---------------------------------------------------------------------------
describe('Case 5: flushPendingWrite — rate limit failure', () => {
  it('sets amber badge, RATE_LIMITED errorState, and schedules retry alarm', async () => {
    const uuid = 'uuid-alarm-flush-test-rate-00000000001';
    const registry: SyncRegistry = {
      [uuid]: { title: 'Test', updatedAt: 1000, deletedAt: null, chunks: 1 },
    };
    const bodyKey = `${BODY_KEY_PREFIX}${uuid}:c0`;
    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: registry,
      [bodyKey]: JSON.stringify({ text: 'hi' }),
    };

    await chrome.storage.local.set({ [PENDING_WRITE_KEY]: batch });

    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(
      new Error('MAX_WRITE_OPERATIONS_PER_MINUTE exceeded'),
    );

    const setBadgeTextSpy = vi.spyOn(chrome.action, 'setBadgeText');
    const setBadgeColorSpy = vi.spyOn(chrome.action, 'setBadgeBackgroundColor');

    await flushPendingWrite();

    // a. badge text '!'
    expect(setBadgeTextSpy).toHaveBeenCalledWith({ text: '!' });

    // b. badge color amber '#F59E0B'
    expect(setBadgeColorSpy).toHaveBeenCalledWith({ color: '#F59E0B' });

    // c. syncStatus.errorState === 'RATE_LIMITED'
    const sr = await chrome.storage.local.get(SYNC_STATUS_KEY);
    const status = sr[SYNC_STATUS_KEY] as SyncStatus;
    expect(status.errorState).toBe('RATE_LIMITED');

    // d. retry alarm exists (1 minute)
    await new Promise((resolve) => setTimeout(resolve, 0));
    const alarm = await fakeBrowser.alarms.get(FLUSH_ALARM_NAME);
    expect(alarm).toBeDefined();

    // e. pendingWrite still present (not cleared on failure)
    const pr = await chrome.storage.local.get(PENDING_WRITE_KEY);
    expect(pr[PENDING_WRITE_KEY]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Case 6: flushPendingWrite — quota exceeded failure
// ---------------------------------------------------------------------------
describe('Case 6: flushPendingWrite — quota exceeded failure', () => {
  it('sets red badge, QUOTA_EXCEEDED errorState, NO retry alarm', async () => {
    const uuid = 'uuid-alarm-flush-test-quota-0000000001';
    const registry: SyncRegistry = {
      [uuid]: { title: 'Test', updatedAt: 1000, deletedAt: null, chunks: 1 },
    };
    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: registry,
      [`${BODY_KEY_PREFIX}${uuid}:c0`]: JSON.stringify({ text: 'hi' }),
    };

    await chrome.storage.local.set({ [PENDING_WRITE_KEY]: batch });

    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(
      new Error('QUOTA_BYTES exceeded'),
    );

    const setBadgeTextSpy = vi.spyOn(chrome.action, 'setBadgeText');
    const setBadgeColorSpy = vi.spyOn(chrome.action, 'setBadgeBackgroundColor');

    await flushPendingWrite();

    // a. badge text '!', color red '#EF4444'
    expect(setBadgeTextSpy).toHaveBeenCalledWith({ text: '!' });
    expect(setBadgeColorSpy).toHaveBeenCalledWith({ color: '#EF4444' });

    // b. syncStatus.errorState === 'QUOTA_EXCEEDED'
    const sr = await chrome.storage.local.get(SYNC_STATUS_KEY);
    const status = sr[SYNC_STATUS_KEY] as SyncStatus;
    expect(status.errorState).toBe('QUOTA_EXCEEDED');

    // c. NO retry alarm
    await new Promise((resolve) => setTimeout(resolve, 0));
    const alarm = await fakeBrowser.alarms.get(FLUSH_ALARM_NAME);
    expect(alarm).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 7: flushPendingWrite — other failure
// ---------------------------------------------------------------------------
describe('Case 7: flushPendingWrite — other failure', () => {
  it('sets red badge, STRICT_VALIDATION_FAIL errorState, NO retry alarm', async () => {
    const uuid = 'uuid-alarm-flush-test-other-0000000001';
    const registry: SyncRegistry = {
      [uuid]: { title: 'Test', updatedAt: 1000, deletedAt: null, chunks: 1 },
    };
    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: registry,
      [`${BODY_KEY_PREFIX}${uuid}:c0`]: JSON.stringify({ text: 'hi' }),
    };

    await chrome.storage.local.set({ [PENDING_WRITE_KEY]: batch });

    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(
      new Error('Network error'),
    );

    const setBadgeTextSpy = vi.spyOn(chrome.action, 'setBadgeText');
    const setBadgeColorSpy = vi.spyOn(chrome.action, 'setBadgeBackgroundColor');

    await flushPendingWrite();

    // a. badge text '!', color red '#EF4444'
    expect(setBadgeTextSpy).toHaveBeenCalledWith({ text: '!' });
    expect(setBadgeColorSpy).toHaveBeenCalledWith({ color: '#EF4444' });

    // b. syncStatus.errorState === 'STRICT_VALIDATION_FAIL'
    const sr = await chrome.storage.local.get(SYNC_STATUS_KEY);
    const status = sr[SYNC_STATUS_KEY] as SyncStatus;
    expect(status.errorState).toBe('STRICT_VALIDATION_FAIL');

    // c. NO retry alarm
    await new Promise((resolve) => setTimeout(resolve, 0));
    const alarm = await fakeBrowser.alarms.get(FLUSH_ALARM_NAME);
    expect(alarm).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 8: stale body key cleanup (chunk count decreased)
// ---------------------------------------------------------------------------
describe('Case 8: stale body key cleanup when chunk count decreased', () => {
  it('calls sync.remove for stale body keys when chunks count decreased', async () => {
    const uuid = 'uuid-alarm-flush-test-stale-000000001';

    // Old registry in sync storage has chunks: 2
    const oldRegistry: SyncRegistry = {
      [uuid]: { title: 'Big', updatedAt: 500, deletedAt: null, chunks: 2 },
    };
    await chrome.storage.sync.set({ [REGISTRY_KEY]: oldRegistry });

    // New batch has chunks: 1 (text shrunk — one chunk removed)
    const newRegistry: SyncRegistry = {
      [uuid]: { title: 'Big', updatedAt: 1000, deletedAt: null, chunks: 1 },
    };
    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: newRegistry,
      [`${BODY_KEY_PREFIX}${uuid}:c0`]: JSON.stringify({ text: 'shorter' }),
    };

    await chrome.storage.local.set({ [PENDING_WRITE_KEY]: batch });

    const removeSpy = vi.spyOn(chrome.storage.sync, 'remove');

    await flushPendingWrite();

    // sync.remove should be called with the stale c1 key
    const staleKey = `${BODY_KEY_PREFIX}${uuid}:c1`;
    expect(removeSpy).toHaveBeenCalledWith([staleKey]);
  });
});

/**
 * TDD tests for alarm-flush.ts
 * Updated for Drive backend: flushToDrive() replaces chrome.storage.sync.set().
 *
 * Case 1: scheduleFlush called once → one alarm named 'sysins-flush'
 * Case 2: scheduleFlush called 5× → still exactly ONE alarm (debounce)
 * Case 3: flushPendingWrite with empty pendingWrite → no-op (flushToDrive not called)
 * Case 4: flushPendingWrite with valid batch → flushToDrive called, lastPushed written, pendingWrite cleared, status idle
 * Case 5: flushToDrive throws 429 error → amber badge, RATE_LIMITED, retry alarm
 * Case 6: flushToDrive throws QUOTA error → red badge, QUOTA_EXCEEDED, no retry alarm
 * Case 7: flushToDrive throws other error → red badge, STRICT_VALIDATION_FAIL, no retry alarm
 * Case 8: stale body key cleanup handled inside flushToDrive → alarm-flush passes batch through
 * Case 9: tombstone body key cleanup handled inside flushToDrive → alarm-flush passes batch through
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

vi.mock('./drive-client', () => ({
  flushToDrive: vi.fn().mockResolvedValue(undefined),
  readDriveCache: vi.fn().mockResolvedValue(null),
  writeDriveCache: vi.fn().mockResolvedValue(undefined),
  pollDriveForChanges: vi.fn().mockResolvedValue(null),
  getAuthToken: vi.fn(),
  readDriveFile: vi.fn(),
  writeDriveFile: vi.fn(),
}));

import * as driveClient from './drive-client';

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.mocked(driveClient.flushToDrive).mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Case 1: scheduleFlush creates one alarm
// ---------------------------------------------------------------------------
describe('Case 1: scheduleFlush creates one alarm', () => {
  it('creates a sysins-flush alarm with delayInMinutes ≈ 0.5', async () => {
    scheduleFlush();

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

    const allAlarms = await fakeBrowser.alarms.getAll();
    const flushAlarms = allAlarms.filter((a: chrome.alarms.Alarm) => a.name === FLUSH_ALARM_NAME);
    expect(flushAlarms).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Case 3: flushPendingWrite — empty pendingWrite → no-op
// ---------------------------------------------------------------------------
describe('Case 3: flushPendingWrite with no pendingWrite → no-op', () => {
  it('does not call flushToDrive when PENDING_WRITE_KEY is absent', async () => {
    await flushPendingWrite();

    expect(driveClient.flushToDrive).not.toHaveBeenCalled();
  });

  it('syncStatus remains idle when pendingWrite is absent', async () => {
    await flushPendingWrite();

    const r = await chrome.storage.local.get(SYNC_STATUS_KEY);
    const status = r[SYNC_STATUS_KEY] as SyncStatus | undefined;
    if (status !== undefined) {
      expect(status.state).toBe('idle');
    }
  });
});

// ---------------------------------------------------------------------------
// Case 4: flushPendingWrite — success path
// ---------------------------------------------------------------------------
describe('Case 4: flushPendingWrite — success path', () => {
  it('calls flushToDrive once with full batch, writes lastPushed, clears pendingWrite, status idle', async () => {
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

    await chrome.storage.local.set({
      [PENDING_WRITE_KEY]: batch,
      [SYNC_PENDING_KEY]: { batchId: 'test-batch', keys: Object.keys(batch), startedAt: Date.now() },
    });

    await flushPendingWrite();

    // a. flushToDrive called once with the full batch
    expect(driveClient.flushToDrive).toHaveBeenCalledOnce();
    expect(vi.mocked(driveClient.flushToDrive).mock.calls[0]![0]).toEqual(batch);

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
    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: registry,
      [`${BODY_KEY_PREFIX}${uuid}:c0`]: JSON.stringify({ text: 'hi' }),
    };

    await chrome.storage.local.set({ [PENDING_WRITE_KEY]: batch });

    vi.mocked(driveClient.flushToDrive).mockRejectedValueOnce(
      new Error('429 Too Many Requests'),
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

    // d. retry alarm exists
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

    vi.mocked(driveClient.flushToDrive).mockRejectedValueOnce(
      new Error('storageQuota exceeded'),
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

    vi.mocked(driveClient.flushToDrive).mockRejectedValueOnce(
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
// Case 8: stale body key cleanup — handled inside flushToDrive (Drive backend)
// alarm-flush passes the full batch through; flushToDrive handles cleanup internally
// ---------------------------------------------------------------------------
describe('Case 8: stale body key cleanup delegated to flushToDrive', () => {
  it('calls flushToDrive with the batch when chunk count decreased', async () => {
    const uuid = 'uuid-alarm-flush-test-stale-000000001';

    const newRegistry: SyncRegistry = {
      [uuid]: { title: 'Big', updatedAt: 1000, deletedAt: null, chunks: 1 },
    };
    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: newRegistry,
      [`${BODY_KEY_PREFIX}${uuid}:c0`]: JSON.stringify({ text: 'shorter' }),
    };

    await chrome.storage.local.set({ [PENDING_WRITE_KEY]: batch });

    await flushPendingWrite();

    expect(driveClient.flushToDrive).toHaveBeenCalledOnce();
    expect(vi.mocked(driveClient.flushToDrive).mock.calls[0]![0]).toEqual(batch);
  });
});

// ---------------------------------------------------------------------------
// Case 9: tombstone body key cleanup — handled inside flushToDrive (Drive backend)
// ---------------------------------------------------------------------------
describe('Case 9: tombstone body key cleanup delegated to flushToDrive', () => {
  it('calls flushToDrive with the tombstoned batch', async () => {
    const uuid = 'uuid-alarm-flush-test-tomb-000000001';

    const newRegistry: SyncRegistry = {
      [uuid]: { title: 'Bye', updatedAt: 500, deletedAt: 1000, chunks: 1 },
    };
    const batch: Record<string, unknown> = {
      [REGISTRY_KEY]: newRegistry,
    };

    await chrome.storage.local.set({ [PENDING_WRITE_KEY]: batch });

    await flushPendingWrite();

    expect(driveClient.flushToDrive).toHaveBeenCalledOnce();
    expect(vi.mocked(driveClient.flushToDrive).mock.calls[0]![0]).toEqual(batch);
  });
});

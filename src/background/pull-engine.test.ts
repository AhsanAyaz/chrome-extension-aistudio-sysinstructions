/**
 * Tests for pull-engine.ts (Drive-based polling).
 *
 * pollAndPull() is the core function: calls pollDriveForChanges(), and if Drive
 * has newer data, reconstructs + delivers to the active AI Studio tab.
 *
 * drive-client is vi.mock'd so no real Drive API calls happen.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { pollAndPull, pullFromCache, deliverToTab } from './pull-engine';
import {
  REGISTRY_KEY,
  PENDING_REMOTE_KEY,
  DRIVE_CACHE_KEY,
} from '../shared/constants';
import { LAST_PUSHED_KEY } from './sync-state';
import { _resetForTesting } from './index';
import type { SyncRegistry, RawInstruction, DriveCache } from '../shared/types';

vi.mock('./drive-client', () => ({
  pollDriveForChanges: vi.fn(),
  readDriveCache: vi.fn(),
  writeDriveCache: vi.fn(),
  getAuthToken: vi.fn(),
  readDriveFile: vi.fn(),
  writeDriveFile: vi.fn(),
  flushToDrive: vi.fn(),
}));

import * as driveClient from './drive-client';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
  _resetForTesting();
});

function mockTabsQuery(tabs: chrome.tabs.Tab[]): void {
  vi.spyOn(chrome.tabs, 'query').mockImplementation(
    (() => Promise.resolve(tabs)) as never,
  );
}

function makeDriveCache(registry: SyncRegistry, bodies: Record<string, string> = {}): DriveCache {
  return {
    fileId: 'file-id-123',
    modifiedTime: new Date().toISOString(),
    data: { [REGISTRY_KEY]: registry, ...bodies },
  };
}

// ---------------------------------------------------------------------------
// Case 1: no Drive change → no-op
// ---------------------------------------------------------------------------
describe('Case 1: pollDriveForChanges returns null → no-op', () => {
  it('returns without delivering when Drive has no new data', async () => {
    vi.mocked(driveClient.pollDriveForChanges).mockResolvedValue(null);
    const sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage');

    await pollAndPull();

    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Case 2: Drive has new data, active tab present → APPLY_REMOTE sent
// ---------------------------------------------------------------------------
describe('Case 2: Drive has new data → APPLY_REMOTE sent to active tab', () => {
  it('sends APPLY_REMOTE with live instructions when Drive cache is newer', async () => {
    const registry: SyncRegistry = {
      'uuid-0001': { title: 'Item A', updatedAt: 2000, deletedAt: null, chunks: 1 },
    };
    const cache = makeDriveCache(registry, {
      'sysins:body:uuid-0001:c0': JSON.stringify({ text: 'body A' }),
    });

    vi.mocked(driveClient.pollDriveForChanges).mockResolvedValue(cache);
    vi.mocked(driveClient.readDriveCache).mockResolvedValue(cache);

    const tabId = 42;
    mockTabsQuery([{ id: tabId, url: 'https://aistudio.google.com/' } as chrome.tabs.Tab]);
    const sendSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined);

    await pollAndPull();

    expect(sendSpy).toHaveBeenCalledOnce();
    const [calledId, msg] = sendSpy.mock.calls[0]!;
    expect(calledId).toBe(tabId);
    expect((msg as { type: string }).type).toBe('APPLY_REMOTE');
    const payload = (msg as { payload: RawInstruction[] }).payload;
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]?.title).toBe('Item A');
  });
});

// ---------------------------------------------------------------------------
// Case 3: no active tab → PENDING_REMOTE_KEY written
// ---------------------------------------------------------------------------
describe('Case 3: no active tab → pendingRemote queued', () => {
  it('writes PENDING_REMOTE_KEY when no AI Studio tab is open', async () => {
    const registry: SyncRegistry = {
      'uuid-0002': { title: 'Item B', updatedAt: 3000, deletedAt: null, chunks: 1 },
    };
    const cache = makeDriveCache(registry, {
      'sysins:body:uuid-0002:c0': JSON.stringify({ text: 'body B' }),
    });

    vi.mocked(driveClient.pollDriveForChanges).mockResolvedValue(cache);
    vi.mocked(driveClient.readDriveCache).mockResolvedValue(cache);
    mockTabsQuery([]);

    await pollAndPull();

    const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    const pending = r[PENDING_REMOTE_KEY] as { payload: RawInstruction[]; enqueuedAt: number };
    expect(pending).toBeDefined();
    expect(Array.isArray(pending.payload)).toBe(true);
    expect(pending.payload.length).toBeGreaterThan(0);
    expect(typeof pending.enqueuedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Case 4: sendMessage throws → falls through to pendingRemote
// ---------------------------------------------------------------------------
describe('Case 4: sendMessage throws → pendingRemote queued', () => {
  it('writes PENDING_REMOTE_KEY when sendMessage rejects', async () => {
    const registry: SyncRegistry = {
      'uuid-0003': { title: 'Item C', updatedAt: 4000, deletedAt: null, chunks: 1 },
    };
    const cache = makeDriveCache(registry, {
      'sysins:body:uuid-0003:c0': JSON.stringify({ text: 'body C' }),
    });

    vi.mocked(driveClient.pollDriveForChanges).mockResolvedValue(cache);
    vi.mocked(driveClient.readDriveCache).mockResolvedValue(cache);

    mockTabsQuery([{ id: 99, url: 'https://aistudio.google.com/' } as chrome.tabs.Tab]);
    vi.spyOn(chrome.tabs, 'sendMessage').mockRejectedValue(
      new Error('Could not establish connection.'),
    );

    await pollAndPull();

    const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    const pending = r[PENDING_REMOTE_KEY] as { payload: RawInstruction[] };
    expect(pending).toBeDefined();
    expect(Array.isArray(pending.payload)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 5: D-04 loop guard — LAST_PUSHED_KEY written after delivery
// ---------------------------------------------------------------------------
describe('Case 5: D-04 loop guard — LAST_PUSHED_KEY updated after delivery', () => {
  it('writes LAST_PUSHED_KEY to chrome.storage.local after successful pull', async () => {
    const registry: SyncRegistry = {
      'uuid-0004': { title: 'Item D', updatedAt: 5000, deletedAt: null, chunks: 1 },
    };
    const cache = makeDriveCache(registry, {
      'sysins:body:uuid-0004:c0': JSON.stringify({ text: 'body D' }),
    });

    vi.mocked(driveClient.pollDriveForChanges).mockResolvedValue(cache);
    vi.mocked(driveClient.readDriveCache).mockResolvedValue(cache);

    mockTabsQuery([{ id: 11, url: 'https://aistudio.google.com/' } as chrome.tabs.Tab]);
    vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined);

    await pollAndPull();

    const r = await chrome.storage.local.get(LAST_PUSHED_KEY);
    const snapshot = r[LAST_PUSHED_KEY] as Record<string, { titleHash: string; bodyHash: string }>;
    expect(snapshot).toBeDefined();
    expect(Object.keys(snapshot).length).toBeGreaterThan(0);
    const entry = snapshot[Object.keys(snapshot)[0]!]!;
    expect(typeof entry.titleHash).toBe('string');
    expect(typeof entry.bodyHash).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Case 6: tombstoned items excluded from APPLY_REMOTE payload
// ---------------------------------------------------------------------------
describe('Case 6: tombstoned items excluded from payload', () => {
  it('does not include tombstoned items in APPLY_REMOTE payload', async () => {
    const registry: SyncRegistry = {
      'uuid-live': { title: 'Live', updatedAt: 6000, deletedAt: null, chunks: 1 },
      'uuid-dead': { title: 'Dead', updatedAt: 5000, deletedAt: 5500, chunks: 0 },
    };
    const cache = makeDriveCache(registry, {
      'sysins:body:uuid-live:c0': JSON.stringify({ text: 'live body' }),
    });

    vi.mocked(driveClient.pollDriveForChanges).mockResolvedValue(cache);
    vi.mocked(driveClient.readDriveCache).mockResolvedValue(cache);

    mockTabsQuery([{ id: 77, url: 'https://aistudio.google.com/' } as chrome.tabs.Tab]);
    const sendSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined);

    await pollAndPull();

    const payload = (sendSpy.mock.calls[0]![1] as { payload: RawInstruction[] }).payload;
    expect(payload.every((item) => item.title !== 'Dead')).toBe(true);
    expect(payload.some((item) => item.title === 'Live')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 8: pull merges — local-only items survive a remote pull
// ---------------------------------------------------------------------------
describe('Case 8: local-only items preserved during pull (merge not replace)', () => {
  it('includes local-only items in the delivered payload when remote lacks them', async () => {
    const localOnlyUuid = 'uuid-local-only-000-0000-000000000001';
    const remoteUuid = 'uuid-remote-only-00-0000-000000000001';

    const localCache = makeDriveCache(
      {
        [localOnlyUuid]: { title: 'Local Only', updatedAt: 1000, deletedAt: null, chunks: 1 },
      },
      { [`sysins:body:${localOnlyUuid}:c0`]: JSON.stringify({ text: 'local body' }) },
    );

    const remoteCache = makeDriveCache(
      {
        [remoteUuid]: { title: 'Remote Only', updatedAt: 2000, deletedAt: null, chunks: 1 },
      },
      { [`sysins:body:${remoteUuid}:c0`]: JSON.stringify({ text: 'remote body' }) },
    );

    // readDriveCache returns local state (pre-poll), pollDriveForChanges returns remote
    vi.mocked(driveClient.readDriveCache).mockResolvedValue(localCache);
    vi.mocked(driveClient.pollDriveForChanges).mockResolvedValue(remoteCache);
    // writeDriveCache captures the merged cache so reconstructInstructions sees it
    vi.mocked(driveClient.writeDriveCache).mockImplementation(async (c) => {
      vi.mocked(driveClient.readDriveCache).mockResolvedValue(c);
    });

    mockTabsQuery([{ id: 55, url: 'https://aistudio.google.com/' } as chrome.tabs.Tab]);
    const sendSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined);

    await pollAndPull();

    const payload = (sendSpy.mock.calls[0]![1] as { payload: RawInstruction[] }).payload;
    expect(payload.some((i) => i.title === 'Local Only')).toBe(true);
    expect(payload.some((i) => i.title === 'Remote Only')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 7: deliverToTab — standalone delivery helper
// ---------------------------------------------------------------------------
describe('Case 7: deliverToTab standalone', () => {
  it('sends APPLY_REMOTE when tab is available', async () => {
    const payload: RawInstruction[] = [{ title: 'T', text: 'B' }];
    mockTabsQuery([{ id: 5, url: 'https://aistudio.google.com/' } as chrome.tabs.Tab]);
    const sendSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue(undefined);

    await deliverToTab(payload);

    expect(sendSpy).toHaveBeenCalledOnce();
    expect((sendSpy.mock.calls[0]![1] as { type: string }).type).toBe('APPLY_REMOTE');
  });
});

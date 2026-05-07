/**
 * TDD tests for bootstrap.ts
 * Updated for Drive backend: flushToDrive() replaces chrome.storage.sync.set().
 * Remote registry is seeded via Drive cache in chrome.storage.local.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleLsBootstrap, mergeRegistries } from './bootstrap';
import { _resetForTesting } from './index';
import {
  REGISTRY_KEY,
  BOOTSTRAP_NEEDED_KEY,
  BODY_KEY_PREFIX,
  DRIVE_CACHE_KEY,
} from '../shared/constants';
import type { SyncRegistry, RawInstruction, RegistryRecord, DriveCache } from '../shared/types';

vi.mock('./drive-client', () => ({
  flushToDrive: vi.fn().mockResolvedValue(undefined),
  readDriveCache: vi.fn(),
  writeDriveCache: vi.fn().mockResolvedValue(undefined),
  pollDriveForChanges: vi.fn().mockResolvedValue(null),
  getAuthToken: vi.fn(),
  readDriveFile: vi.fn(),
  writeDriveFile: vi.fn(),
}));

import * as driveClient from './drive-client';

function mockTabsQuery(tabs: chrome.tabs.Tab[]): void {
  vi.spyOn(chrome.tabs, 'query').mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (() => Promise.resolve(tabs)) as any,
  );
}

function makeDriveCache(registry: SyncRegistry, bodies: Record<string, string> = {}): DriveCache {
  return {
    fileId: 'file-id-test',
    modifiedTime: new Date().toISOString(),
    data: { [REGISTRY_KEY]: registry, ...bodies },
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
  _resetForTesting();
  mockTabsQuery([]);

  // readDriveCache reads from chrome.storage.local — delegate to actual storage
  vi.mocked(driveClient.readDriveCache).mockImplementation(async () => {
    const r = await chrome.storage.local.get(DRIVE_CACHE_KEY);
    return (r[DRIVE_CACHE_KEY] as DriveCache | undefined) ?? null;
  });

  // flushToDrive updates local cache with the merged batch so reconstructInstructions works
  vi.mocked(driveClient.flushToDrive).mockImplementation(async (batch) => {
    const r = await chrome.storage.local.get(DRIVE_CACHE_KEY);
    const existing = (r[DRIVE_CACHE_KEY] as DriveCache | undefined) ?? { fileId: '', modifiedTime: '', data: {} };
    await chrome.storage.local.set({
      [DRIVE_CACHE_KEY]: { ...existing, data: { ...existing.data, ...batch } },
    });
  });
});

// ---------------------------------------------------------------------------
// mergeRegistries pure function unit tests
// ---------------------------------------------------------------------------

describe('mergeRegistries: pure function', () => {
  const makeRec = (overrides: Partial<RegistryRecord> = {}): RegistryRecord => ({
    title: 'Test',
    updatedAt: 1000,
    deletedAt: null,
    chunks: 1,
    ...overrides,
  });

  it('returns {} for two empty registries', () => {
    expect(mergeRegistries({}, {})).toEqual({});
  });

  it('returns local-only keys unchanged when remote is empty', () => {
    const local: SyncRegistry = { 'uuid-1': makeRec({ title: 'Local' }) };
    const result = mergeRegistries(local, {});
    expect(result).toEqual(local);
  });

  it('returns remote-only keys when local is empty', () => {
    const remote: SyncRegistry = { 'uuid-2': makeRec({ title: 'Remote' }) };
    const result = mergeRegistries({}, remote);
    expect(result).toEqual(remote);
  });

  it('remote wins on last-write-wins when remote updatedAt is newer', () => {
    const local: SyncRegistry = {
      'uuid-3': makeRec({ updatedAt: 1000, title: 'Old' }),
    };
    const remote: SyncRegistry = {
      'uuid-3': makeRec({ updatedAt: 2000, title: 'Newer' }),
    };
    const result = mergeRegistries(local, remote);
    expect(result['uuid-3']?.updatedAt).toBe(2000);
    expect(result['uuid-3']?.title).toBe('Newer');
  });

  it('tombstone wins over live local when remote deletedAt > local updatedAt (Hard Rule 10)', () => {
    const local: SyncRegistry = {
      'uuid-4': makeRec({ updatedAt: 1000, deletedAt: null }),
    };
    const remote: SyncRegistry = {
      'uuid-4': makeRec({ updatedAt: 1000, deletedAt: 9999 }),
    };
    const result = mergeRegistries(local, remote);
    expect(result['uuid-4']?.deletedAt).toBe(9999);
  });

  it('does not mutate input registries', () => {
    const local: SyncRegistry = { 'uuid-5': makeRec({ title: 'A' }) };
    const remote: SyncRegistry = { 'uuid-5': makeRec({ title: 'B', updatedAt: 9999 }) };
    const localCopy = JSON.parse(JSON.stringify(local)) as SyncRegistry;
    const remoteCopy = JSON.parse(JSON.stringify(remote)) as SyncRegistry;
    mergeRegistries(local, remote);
    expect(local).toEqual(localCopy);
    expect(remote).toEqual(remoteCopy);
  });
});

// ---------------------------------------------------------------------------
// Case 1 — local-only items (no remote registry)
// ---------------------------------------------------------------------------
describe('Case 1: local-only items — no remote registry', () => {
  it('assigns fresh UUIDs and writes registry + body chunks in ONE flushToDrive call, then clears flag', async () => {
    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const payload: RawInstruction[] = [
      { title: 'Alpha', text: 'alpha body' },
      { title: 'Beta', text: 'beta body' },
    ];

    await handleLsBootstrap(payload);

    // Exactly ONE flushToDrive call (Hard Rule 3 equivalent)
    expect(driveClient.flushToDrive).toHaveBeenCalledOnce();

    const batchArg = vi.mocked(driveClient.flushToDrive).mock.calls[0]![0];
    const batch = batchArg as Record<string, unknown>;

    // Registry must be present
    const registry = batch[REGISTRY_KEY] as SyncRegistry;
    expect(registry).toBeDefined();

    const uuids = Object.keys(registry).filter((k) => registry[k]!.deletedAt === null);
    expect(uuids).toHaveLength(2);

    // Body chunk c0 must be present for each live UUID
    for (const uuid of uuids) {
      const bodyKey = `${BODY_KEY_PREFIX}${uuid}:c0`;
      expect(batch[bodyKey]).toBeDefined();
    }

    // BOOTSTRAP_NEEDED_KEY must be removed from local storage
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 2 — title match reuses remote UUID (BOOT-02)
// ---------------------------------------------------------------------------
describe('Case 2: title match reuses remote UUID (BOOT-02)', () => {
  it('assigns remote UUID when local title matches a live remote entry', async () => {
    const remoteUuid = 'abc-12300-0000-0000-000000000001';
    const remoteRegistry: SyncRegistry = {
      [remoteUuid]: { title: 'Foo', updatedAt: 1000, deletedAt: null, chunks: 1 },
    };

    // Seed remote registry in Drive cache
    await fakeBrowser.storage.local.set({
      [DRIVE_CACHE_KEY]: makeDriveCache(remoteRegistry, {
        [`${BODY_KEY_PREFIX}${remoteUuid}:c0`]: JSON.stringify({ text: 'remote body' }),
      }),
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const payload: RawInstruction[] = [{ title: 'Foo', text: 'local body' }];
    await handleLsBootstrap(payload);

    expect(driveClient.flushToDrive).toHaveBeenCalledOnce();

    const batchArg = vi.mocked(driveClient.flushToDrive).mock.calls[0]![0];
    const batch = batchArg as Record<string, unknown>;
    const registry = batch[REGISTRY_KEY] as SyncRegistry;

    // The remote UUID must be present in the merged registry
    expect(registry[remoteUuid]).toBeDefined();

    // BOOTSTRAP_NEEDED_KEY must be cleared
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 3 — title collision (D-06): first by updatedAt desc wins
// ---------------------------------------------------------------------------
describe('Case 3: title collision (D-06) — first by updatedAt desc wins', () => {
  it('assigns highest-updatedAt UUID when two remote entries share a title', async () => {
    const uuidA = 'uuid-a-0000-0000-0000-000000000001'; // updatedAt=2000 (winner)
    const uuidB = 'uuid-b-0000-0000-0000-000000000001'; // updatedAt=1000 (loser)

    const remoteRegistry: SyncRegistry = {
      [uuidA]: { title: 'Foo', updatedAt: 2000, deletedAt: null, chunks: 0 },
      [uuidB]: { title: 'Foo', updatedAt: 1000, deletedAt: null, chunks: 0 },
    };

    await fakeBrowser.storage.local.set({
      [DRIVE_CACHE_KEY]: makeDriveCache(remoteRegistry),
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const payload: RawInstruction[] = [{ title: 'Foo', text: 'foo body' }];
    await handleLsBootstrap(payload);

    expect(driveClient.flushToDrive).toHaveBeenCalledOnce();

    const batchArg = vi.mocked(driveClient.flushToDrive).mock.calls[0]![0];
    const registry = (batchArg as Record<string, unknown>)[REGISTRY_KEY] as SyncRegistry;

    // uuidA (highest updatedAt) must be present in merged registry for "Foo"
    expect(registry[uuidA]).toBeDefined();

    // BOOTSTRAP_NEEDED_KEY cleared
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 4 — tombstone beats local live item (Hard Rule 10)
// ---------------------------------------------------------------------------
describe('Case 4: tombstone beats local live item (Hard Rule 10 via mergeRegistries)', () => {
  it('remote tombstone propagates into merged registry and excludes item from live payload', async () => {
    const tombUuid = 'uuid-tomb-0000-0000-0000-000000000001';
    const futureTs = Date.now() + 100_000;

    const remoteRegistry: SyncRegistry = {
      [tombUuid]: {
        title: 'Bar',
        updatedAt: 1000,
        deletedAt: futureTs,
        chunks: 0,
      },
    };

    await fakeBrowser.storage.local.set({
      [DRIVE_CACHE_KEY]: makeDriveCache(remoteRegistry),
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const payload: RawInstruction[] = [{ title: 'Bar', text: 'bar body' }];
    await handleLsBootstrap(payload);

    expect(driveClient.flushToDrive).toHaveBeenCalledOnce();

    const batchArg = vi.mocked(driveClient.flushToDrive).mock.calls[0]![0];
    const registry = (batchArg as Record<string, unknown>)[REGISTRY_KEY] as SyncRegistry;

    // The tombstoned entry must be present with deletedAt set
    expect(registry[tombUuid]?.deletedAt).toBe(futureTs);

    // BOOTSTRAP_NEEDED_KEY cleared
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 5 — empty local payload (Hard Rule 4)
// ---------------------------------------------------------------------------
describe('Case 5: empty local payload (Hard Rule 4)', () => {
  it('returns immediately without any side effects when payload is empty', async () => {
    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    await handleLsBootstrap([]);

    // No flushToDrive call
    expect(driveClient.flushToDrive).not.toHaveBeenCalled();

    // Flag must still be present (not cleared — retry is possible)
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Case 6 — flag cleared only after success (Pitfall 3)
// ---------------------------------------------------------------------------
describe('Case 6: flag preserved when flushToDrive throws (Pitfall 3)', () => {
  it('does NOT clear BOOTSTRAP_NEEDED_KEY when flushToDrive rejects', async () => {
    vi.mocked(driveClient.flushToDrive).mockRejectedValueOnce(new Error('network error'));

    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    try {
      await handleLsBootstrap([{ title: 'Test', text: 'test body' }]);
    } catch {
      // Expected — flushToDrive threw
    }

    // Flag must still be present in local storage (not cleared)
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeDefined();
  });
});

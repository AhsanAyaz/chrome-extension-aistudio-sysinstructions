/**
 * TDD tests for bootstrap.ts
 * RED phase: all tests written before implementation exists.
 * Covers 6 behavior cases for handleLsBootstrap (BOOT-01, BOOT-02)
 * plus mergeRegistries pure function unit tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleLsBootstrap, mergeRegistries } from './bootstrap';
import { _resetForTesting } from './index';
import {
  REGISTRY_KEY,
  BOOTSTRAP_NEEDED_KEY,
  BODY_KEY_PREFIX,
} from '../shared/constants';
import type { SyncRegistry, RawInstruction, RegistryRecord } from '../shared/types';

// ---------------------------------------------------------------------------
// Test setup — mirrors pull-engine.test.ts pattern
// ---------------------------------------------------------------------------

// Typed helper to mock chrome.tabs.query — avoids overload ambiguity.
function mockTabsQuery(tabs: chrome.tabs.Tab[]): void {
  vi.spyOn(chrome.tabs, 'query').mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (() => Promise.resolve(tabs)) as any,
  );
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
  _resetForTesting();

  // Default: no active tab (bootstrap tests focus on sync write, not tab delivery)
  mockTabsQuery([]);
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
// handleLsBootstrap assigns UUIDs, writes ONE batched sync.set, clears BOOTSTRAP_NEEDED_KEY
// ---------------------------------------------------------------------------
describe('Case 1: local-only items — no remote registry', () => {
  it('assigns fresh UUIDs and writes registry + body chunks in ONE sync.set, then clears flag', async () => {
    const syncSetSpy = vi.spyOn(chrome.storage.sync, 'set').mockResolvedValue(undefined);

    // Pre-plant the bootstrap flag (would be written by onInstalled)
    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const payload: RawInstruction[] = [
      { title: 'Alpha', text: 'alpha body' },
      { title: 'Beta', text: 'beta body' },
    ];

    await handleLsBootstrap(payload);

    // Exactly ONE chrome.storage.sync.set call (Hard Rule 3)
    expect(syncSetSpy).toHaveBeenCalledOnce();

    const [[batchArg]] = syncSetSpy.mock.calls;
    const batch = batchArg as Record<string, unknown>;

    // Registry must be present
    const registry = batch[REGISTRY_KEY] as SyncRegistry;
    expect(registry).toBeDefined();

    const uuids = Object.keys(registry);
    expect(uuids).toHaveLength(2);

    // Both entries must be live (no tombstone)
    for (const uuid of uuids) {
      expect(registry[uuid]?.deletedAt).toBeNull();
    }

    // Body chunk c0 must be present for each UUID
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
// Local item title="Foo" matches remote live entry uuid="abc-123" title="Foo"
// ---------------------------------------------------------------------------
describe('Case 2: title match reuses remote UUID (BOOT-02)', () => {
  it('assigns remote UUID when local title matches a live remote entry', async () => {
    const remoteUuid = 'abc-12300-0000-0000-000000000001';
    const remoteRegistry: SyncRegistry = {
      [remoteUuid]: {
        title: 'Foo',
        updatedAt: 1000,
        deletedAt: null,
        chunks: 1,
      },
    };

    // Seed remote registry in sync storage
    await fakeBrowser.storage.sync.set({ [REGISTRY_KEY]: remoteRegistry });
    // Seed the body chunk for reconstructInstructions
    await fakeBrowser.storage.sync.set({
      [`${BODY_KEY_PREFIX}${remoteUuid}:c0`]: JSON.stringify({ text: 'remote body' }),
    });

    const syncSetSpy = vi.spyOn(chrome.storage.sync, 'set').mockResolvedValue(undefined);

    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const payload: RawInstruction[] = [{ title: 'Foo', text: 'local body' }];
    await handleLsBootstrap(payload);

    expect(syncSetSpy).toHaveBeenCalledOnce();

    const [[batchArg]] = syncSetSpy.mock.calls;
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
// Remote has two live entries both with title="Foo"; highest updatedAt wins
// ---------------------------------------------------------------------------
describe('Case 3: title collision (D-06) — first by updatedAt desc wins', () => {
  it('assigns highest-updatedAt UUID when two remote entries share a title', async () => {
    const uuidA = 'uuid-a-0000-0000-0000-000000000001'; // updatedAt=2000 (winner)
    const uuidB = 'uuid-b-0000-0000-0000-000000000001'; // updatedAt=1000 (loser)

    const remoteRegistry: SyncRegistry = {
      [uuidA]: { title: 'Foo', updatedAt: 2000, deletedAt: null, chunks: 0 },
      [uuidB]: { title: 'Foo', updatedAt: 1000, deletedAt: null, chunks: 0 },
    };

    await fakeBrowser.storage.sync.set({ [REGISTRY_KEY]: remoteRegistry });

    const syncSetSpy = vi.spyOn(chrome.storage.sync, 'set').mockResolvedValue(undefined);

    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const payload: RawInstruction[] = [{ title: 'Foo', text: 'foo body' }];
    await handleLsBootstrap(payload);

    expect(syncSetSpy).toHaveBeenCalledOnce();

    const [[batchArg]] = syncSetSpy.mock.calls;
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
// Remote tombstoned entry wins; reconstructInstructions excludes "Bar"
// ---------------------------------------------------------------------------
describe('Case 4: tombstone beats local live item (Hard Rule 10 via mergeRegistries)', () => {
  it('remote tombstone propagates into merged registry and excludes item from live payload', async () => {
    const tombUuid = 'uuid-tomb-0000-0000-0000-000000000001';
    const futureTs = Date.now() + 100_000; // deletedAt far in future > local updatedAt

    const remoteRegistry: SyncRegistry = {
      [tombUuid]: {
        title: 'Bar',
        updatedAt: 1000,
        deletedAt: futureTs, // tombstone wins — deletedAt > any local updatedAt
        chunks: 0,
      },
    };

    await fakeBrowser.storage.sync.set({ [REGISTRY_KEY]: remoteRegistry });

    const syncSetSpy = vi.spyOn(chrome.storage.sync, 'set').mockResolvedValue(undefined);

    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    // Local has a live item with title="Bar" — tombstone should win
    const payload: RawInstruction[] = [{ title: 'Bar', text: 'bar body' }];
    await handleLsBootstrap(payload);

    expect(syncSetSpy).toHaveBeenCalledOnce();

    const [[batchArg]] = syncSetSpy.mock.calls;
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
// handleLsBootstrap([]) → returns immediately, no sync.set, flag NOT cleared
// ---------------------------------------------------------------------------
describe('Case 5: empty local payload (Hard Rule 4)', () => {
  it('returns immediately without any side effects when payload is empty', async () => {
    const syncSetSpy = vi.spyOn(chrome.storage.sync, 'set').mockResolvedValue(undefined);

    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    await handleLsBootstrap([]);

    // No sync.set call
    expect(syncSetSpy).not.toHaveBeenCalled();

    // Flag must still be present (not cleared — retry is possible)
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Case 6 — flag cleared only after success (Pitfall 3)
// When chrome.storage.sync.set throws, BOOTSTRAP_NEEDED_KEY stays in local storage
// ---------------------------------------------------------------------------
describe('Case 6: flag preserved when sync.set throws (Pitfall 3)', () => {
  it('does NOT clear BOOTSTRAP_NEEDED_KEY when chrome.storage.sync.set rejects', async () => {
    vi.spyOn(chrome.storage.sync, 'set').mockRejectedValueOnce(new Error('quota exceeded'));

    await fakeBrowser.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    // handleLsBootstrap should propagate the error (or swallow it); either way flag stays
    try {
      await handleLsBootstrap([{ title: 'Test', text: 'test body' }]);
    } catch {
      // Expected — sync.set threw
    }

    // Flag must still be present in local storage (not cleared)
    const localR = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(localR[BOOTSTRAP_NEEDED_KEY]).toBeDefined();
  });
});

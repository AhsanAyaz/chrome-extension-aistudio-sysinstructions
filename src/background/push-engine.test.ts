/**
 * TDD tests for push-engine.ts
 * RED phase: all tests written before implementation exists.
 * Covers all 8 behavior cases from the plan.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  diffAndAccumulate,
  persistPendingWrite,
  drainPendingWrite,
  clearPendingWrite,
} from './push-engine';
import {
  PENDING_WRITE_KEY,
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
  LAST_OBSERVED_KEY,
} from '../shared/constants';
import { LAST_PUSHED_KEY, SYNC_PENDING_KEY } from './sync-state';
import { shortHash } from './hash';
import type { RawInstruction, SyncRegistry, LastPushedSnapshot } from '../shared/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  fakeBrowser.reset();
});

// ---------------------------------------------------------------------------
// Case 1: New item — assigns UUID, writes registry + body to pendingWrite
// ---------------------------------------------------------------------------
describe('Case 1: new item (not in registry, not in lastPushed)', () => {
  it('assigns a fresh UUID and writes registry + body chunk to PENDING_WRITE_KEY', async () => {
    const payload: RawInstruction[] = [{ title: 'A', text: 'hello' }];

    await diffAndAccumulate(payload);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch = r[PENDING_WRITE_KEY] as Record<string, unknown>;
    expect(batch).toBeDefined();

    const registry = batch[REGISTRY_KEY] as SyncRegistry;
    expect(registry).toBeDefined();

    const uuids = Object.keys(registry);
    expect(uuids).toHaveLength(1);
    const uuid = uuids[0]!;
    expect(uuid).toMatch(UUID_RE);

    const record = registry[uuid]!;
    expect(record.title).toBe('A');
    expect(record.deletedAt).toBeNull();
    expect(record.chunks).toBe(1);
    expect(record.updatedAt).toBeGreaterThan(0);

    // Body chunk c0 must be present in the batch
    const bodyKey = `${BODY_KEY_PREFIX}${uuid}:c0`;
    expect(batch[bodyKey]).toBeDefined();
    const bodyParsed = JSON.parse(batch[bodyKey] as string);
    expect(bodyParsed.text).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Case 2: Existing item, unchanged — no pendingWrite written
// ---------------------------------------------------------------------------
describe('Case 2: existing item, unchanged (titleHash + bodyHash match lastPushed)', () => {
  it('writes nothing to PENDING_WRITE_KEY when nothing changed', async () => {
    const uuid = 'uuid-unchanged-test-0001-000000000001';
    const bodyJson = JSON.stringify({ text: 'hello' });
    const titleHash = await shortHash('A');
    const bodyHash = await shortHash(bodyJson);

    // Pre-populate registry in sync storage
    const registry: SyncRegistry = {
      [uuid]: { title: 'A', updatedAt: 100, deletedAt: null, chunks: 1 },
    };
    await chrome.storage.sync.set({ [REGISTRY_KEY]: registry });

    // Pre-populate lastPushed in local storage
    const lastPushed: LastPushedSnapshot = {
      [uuid]: { titleHash, bodyHash, updatedAt: 100 },
    };
    await chrome.storage.local.set({ [LAST_PUSHED_KEY]: lastPushed });

    const payload: RawInstruction[] = [{ title: 'A', text: 'hello' }];
    await diffAndAccumulate(payload);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    expect(r[PENDING_WRITE_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 3: Existing item, text changed — writes updated body + registry
// ---------------------------------------------------------------------------
describe('Case 3: existing item, text changed', () => {
  it('writes updated registry entry and new body chunk when text changed', async () => {
    const uuid = 'uuid-changed-text-test-00000000000001';
    const oldBodyJson = JSON.stringify({ text: 'old text' });
    const titleHash = await shortHash('A');
    const oldBodyHash = await shortHash(oldBodyJson);

    const registry: SyncRegistry = {
      [uuid]: { title: 'A', updatedAt: 100, deletedAt: null, chunks: 1 },
    };
    await chrome.storage.sync.set({ [REGISTRY_KEY]: registry });

    const lastPushed: LastPushedSnapshot = {
      [uuid]: { titleHash, bodyHash: oldBodyHash, updatedAt: 100 },
    };
    await chrome.storage.local.set({ [LAST_PUSHED_KEY]: lastPushed });

    const payload: RawInstruction[] = [{ title: 'A', text: 'world' }];
    await diffAndAccumulate(payload);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch = r[PENDING_WRITE_KEY] as Record<string, unknown>;
    expect(batch).toBeDefined();

    const newRegistry = batch[REGISTRY_KEY] as SyncRegistry;
    expect(newRegistry[uuid]?.title).toBe('A');
    expect(newRegistry[uuid]?.updatedAt).toBeGreaterThan(100);

    const bodyKey = `${BODY_KEY_PREFIX}${uuid}:c0`;
    expect(batch[bodyKey]).toBeDefined();
    const bodyParsed = JSON.parse(batch[bodyKey] as string);
    expect(bodyParsed.text).toBe('world');
  });
});

// ---------------------------------------------------------------------------
// Case 4: Item deleted — tombstone written for item absent from payload
// ---------------------------------------------------------------------------
describe('Case 4: item absent from payload gets tombstoned', () => {
  it('tombstones registry entries absent from the incoming payload', async () => {
    const uuidA = 'uuid-to-tombstone-0000-000000000001';
    const uuidB = 'uuid-to-keep-000000-0000-000000000001';

    const registry: SyncRegistry = {
      [uuidA]: { title: 'A', updatedAt: 100, deletedAt: null, chunks: 1 },
      [uuidB]: { title: 'B', updatedAt: 100, deletedAt: null, chunks: 1 },
    };
    await chrome.storage.sync.set({ [REGISTRY_KEY]: registry });

    // Payload only has B — A should be tombstoned
    const payload: RawInstruction[] = [{ title: 'B', text: 'b text' }];
    await diffAndAccumulate(payload);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch = r[PENDING_WRITE_KEY] as Record<string, unknown>;
    expect(batch).toBeDefined();

    const nextRegistry = batch[REGISTRY_KEY] as SyncRegistry;
    // A should be tombstoned
    expect(nextRegistry[uuidA]?.deletedAt).toBeGreaterThan(0);
    // B should still be live
    expect(nextRegistry[uuidB]?.deletedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Case 5: Item > 7 KB — splits into multiple body chunks
// ---------------------------------------------------------------------------
describe('Case 5: item with > 7KB text gets chunked', () => {
  it('produces c0 and c1 body keys and sets chunks = 2 in registry', async () => {
    // 10000 'x' chars = 10000 bytes — exceeds 7000 byte budget → 2 chunks
    const bigText = 'x'.repeat(10_000);
    const payload: RawInstruction[] = [{ title: 'Big', text: bigText }];

    await diffAndAccumulate(payload);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch = r[PENDING_WRITE_KEY] as Record<string, unknown>;
    expect(batch).toBeDefined();

    const reg = batch[REGISTRY_KEY] as SyncRegistry;
    const uuids = Object.keys(reg);
    expect(uuids).toHaveLength(1);
    const uuid = uuids[0]!;
    expect(reg[uuid]?.chunks).toBe(2);

    const c0Key = `${BODY_KEY_PREFIX}${uuid}:c0`;
    const c1Key = `${BODY_KEY_PREFIX}${uuid}:c1`;
    expect(batch[c0Key]).toBeDefined();
    expect(batch[c1Key]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Case 6: Empty payload guard (Hard Rule 4 / PUSH-05)
// ---------------------------------------------------------------------------
describe('Case 6: empty payload guard', () => {
  it('returns early without writing PENDING_WRITE_KEY when payload is empty', async () => {
    // Plant a registry entry to ensure tombstone logic would normally fire
    await chrome.storage.sync.set({
      [REGISTRY_KEY]: {
        'some-uuid-0000-0000-0000-000000000001': {
          title: 'X',
          updatedAt: 100,
          deletedAt: null,
          chunks: 1,
        },
      } as SyncRegistry,
    });

    await diffAndAccumulate([]);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    expect(r[PENDING_WRITE_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 7: Already-tombstoned item stays tombstoned (tombstone win)
// ---------------------------------------------------------------------------
describe('Case 7: tombstoned item gets fresh UUID, not resurrected', () => {
  it('a title matching a tombstoned registry entry receives a new UUID', async () => {
    const tombUuid = 'uuid-tombstoned-00000-0000-000000000001';

    const registry: SyncRegistry = {
      [tombUuid]: { title: 'A', updatedAt: 100, deletedAt: 200, chunks: 0 },
    };
    await chrome.storage.sync.set({ [REGISTRY_KEY]: registry });

    // Payload has item with same title 'A' — should NOT revive the tombstone
    const payload: RawInstruction[] = [{ title: 'A', text: 'new content' }];
    await diffAndAccumulate(payload);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch = r[PENDING_WRITE_KEY] as Record<string, unknown>;
    expect(batch).toBeDefined();

    const nextRegistry = batch[REGISTRY_KEY] as SyncRegistry;

    // Tombstone must still be tombstoned
    expect(nextRegistry[tombUuid]?.deletedAt).toBeGreaterThan(0);

    // There should be a NEW uuid for title 'A' (fresh UUID, not tombUuid)
    const liveEntries = Object.entries(nextRegistry).filter(
      ([, rec]) => rec.deletedAt === null && rec.title === 'A',
    );
    expect(liveEntries).toHaveLength(1);
    expect(liveEntries[0]![0]).not.toBe(tombUuid);
    expect(liveEntries[0]![0]).toMatch(UUID_RE);
  });
});

// ---------------------------------------------------------------------------
// Case 8: Unknown fields on RawInstruction preserved in body chunk
// ---------------------------------------------------------------------------
describe('Case 8: unknown fields on RawInstruction are preserved in body chunk', () => {
  it('body chunk JSON contains unknown fields from the instruction', async () => {
    const payload: RawInstruction[] = [
      { title: 'A', text: 'hi', customField: 42, nested: { deep: true } },
    ];

    await diffAndAccumulate(payload);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch = r[PENDING_WRITE_KEY] as Record<string, unknown>;
    const reg = batch[REGISTRY_KEY] as SyncRegistry;
    const uuid = Object.keys(reg)[0]!;
    const bodyKey = `${BODY_KEY_PREFIX}${uuid}:c0`;
    const bodyParsed = JSON.parse(batch[bodyKey] as string);

    expect(bodyParsed.customField).toBe(42);
    expect(bodyParsed.nested).toEqual({ deep: true });
    expect(bodyParsed.text).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// persistPendingWrite / drainPendingWrite / clearPendingWrite
// ---------------------------------------------------------------------------
describe('persistPendingWrite / drainPendingWrite / clearPendingWrite', () => {
  it('persistPendingWrite writes batch to PENDING_WRITE_KEY', async () => {
    const batch = { 'sysins:registry': { foo: 'bar' } };
    await persistPendingWrite(batch);

    const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
    expect(r[PENDING_WRITE_KEY]).toEqual(batch);
  });

  it('persistPendingWrite also writes SYNC_PENDING_KEY sentinel', async () => {
    const batch = { 'sysins:registry': { foo: 'bar' } };
    await persistPendingWrite(batch);

    const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
    const sentinel = r[SYNC_PENDING_KEY] as Record<string, unknown>;
    expect(sentinel).toBeDefined();
    expect(typeof sentinel.batchId).toBe('string');
    expect(Array.isArray(sentinel.keys)).toBe(true);
    expect(typeof sentinel.startedAt).toBe('number');
  });

  it('drainPendingWrite returns the persisted batch', async () => {
    const batch = { 'sysins:registry': { hello: 'world' } };
    await persistPendingWrite(batch);

    const drained = await drainPendingWrite();
    expect(drained).toEqual(batch);
  });

  it('drainPendingWrite returns null when nothing is persisted', async () => {
    const result = await drainPendingWrite();
    expect(result).toBeNull();
  });

  it('clearPendingWrite removes both PENDING_WRITE_KEY and SYNC_PENDING_KEY', async () => {
    const batch = { 'sysins:registry': { foo: 'bar' } };
    await persistPendingWrite(batch);

    await clearPendingWrite();

    const r = await chrome.storage.local.get([PENDING_WRITE_KEY, SYNC_PENDING_KEY]);
    expect(r[PENDING_WRITE_KEY]).toBeUndefined();
    expect(r[SYNC_PENDING_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// UUID stability: same title → same UUID across multiple diffAndAccumulate calls
// ---------------------------------------------------------------------------
describe('UUID stability', () => {
  it('same title gets the same UUID on a second diffAndAccumulate call', async () => {
    const payload: RawInstruction[] = [{ title: 'Stable', text: 'v1' }];
    await diffAndAccumulate(payload);

    const r1 = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch1 = r1[PENDING_WRITE_KEY] as Record<string, unknown>;
    const reg1 = batch1[REGISTRY_KEY] as SyncRegistry;
    const uuid1 = Object.keys(reg1).find((k) => reg1[k]!.title === 'Stable')!;

    // Simulate alarm-flush: write the registry into sync storage and clear pending
    await chrome.storage.sync.set({ [REGISTRY_KEY]: reg1 });
    await chrome.storage.local.remove(PENDING_WRITE_KEY);

    // Second call with same title, changed text → should reuse uuid1
    const payload2: RawInstruction[] = [{ title: 'Stable', text: 'v2' }];
    await diffAndAccumulate(payload2);

    const r2 = await chrome.storage.local.get(PENDING_WRITE_KEY);
    const batch2 = r2[PENDING_WRITE_KEY] as Record<string, unknown>;
    const reg2 = batch2[REGISTRY_KEY] as SyncRegistry;

    expect(reg2[uuid1]).toBeDefined();
    expect(reg2[uuid1]?.title).toBe('Stable');
  });
});

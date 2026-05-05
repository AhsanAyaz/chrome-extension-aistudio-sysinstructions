import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getRegistry,
  createItem,
  updateItem,
  deleteItem,
  applyRemote,
  reconstructInstructions,
} from './registry';
import { REGISTRY_KEY, BODY_KEY_PREFIX } from '../shared/constants';
import type { SyncRegistry } from '../shared/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  fakeBrowser.reset();
});

describe('createItem (FND-01: UUID identity, D-17: crypto.randomUUID)', () => {
  it('returns a v4-shaped UUID and writes a registry record + body chunks', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });

    expect(uuid).toMatch(UUID_RE);

    const reg = await getRegistry();
    expect(reg[uuid]).toBeDefined();
    expect(reg[uuid]?.title).toBe('A');
    expect(reg[uuid]?.deletedAt).toBeNull();
    expect(reg[uuid]?.chunks).toBeGreaterThanOrEqual(1);
    expect(reg[uuid]?.updatedAt).toBeGreaterThan(0);

    // Body chunk c0 was written
    const body = await chrome.storage.sync.get(`${BODY_KEY_PREFIX}${uuid}:c0`);
    expect(body[`${BODY_KEY_PREFIX}${uuid}:c0`]).toBeDefined();
  });
});

describe('updateItem (FND-01: rename preserves UUID, FND-02: updatedAt bump)', () => {
  it('rename does NOT change the UUID; title is updated; updatedAt is bumped', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    const beforeReg = await getRegistry();
    const beforeUpdatedAt = beforeReg[uuid]!.updatedAt;

    // Wait at least 1ms to guarantee a strict timestamp increase
    await new Promise((r) => setTimeout(r, 2));
    await updateItem(uuid, { title: 'B' });

    const afterReg = await getRegistry();
    expect(afterReg[uuid]).toBeDefined(); // same UUID still present
    expect(afterReg[uuid]?.title).toBe('B');
    expect(afterReg[uuid]?.updatedAt).toBeGreaterThan(beforeUpdatedAt);
  });

  it('throws when updating a non-existent UUID', async () => {
    await expect(updateItem('nope', { title: 'X' })).rejects.toThrow(/no such uuid/);
  });

  it('throws when updating a tombstoned item', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid);
    await expect(updateItem(uuid, { title: 'B' })).rejects.toThrow(/tombstoned/);
  });
});

describe('deleteItem + reconstructInstructions (FND-03 / D-18 tombstone semantics)', () => {
  it('delete sets deletedAt > 0 and >= updatedAt', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid);

    const reg = await getRegistry();
    expect(reg[uuid]).toBeDefined(); // entry stays in place
    expect(reg[uuid]?.deletedAt).toBeGreaterThan(0);
    expect(reg[uuid]?.deletedAt).toBeGreaterThanOrEqual(reg[uuid]!.updatedAt);
  });

  it('reconstructInstructions excludes tombstoned records', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid);

    const arr = await reconstructInstructions();
    expect(arr.find((i) => i.uuid === uuid)).toBeUndefined();
  });

  it('tie case (deletedAt === updatedAt) → excluded (D-06)', async () => {
    // Manually construct a tied registry record
    const uuid = crypto.randomUUID();
    const t = 1000;
    const reg: SyncRegistry = {
      [uuid]: { title: 'A', updatedAt: t, deletedAt: t, chunks: 0 },
    };
    await chrome.storage.sync.set({ [REGISTRY_KEY]: reg });

    const arr = await reconstructInstructions();
    expect(arr.find((i) => i.uuid === uuid)).toBeUndefined();
  });
});

describe('applyRemote (Recipe 9: tombstone resurrection rejection)', () => {
  it('older live remote updatedAt does NOT resurrect a newer local tombstone', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid); // local has deletedAt = ~now

    const remote: SyncRegistry = {
      [uuid]: { title: 'A', updatedAt: 0, deletedAt: null, chunks: 1 },
    };
    await applyRemote(remote);

    const reg = await getRegistry();
    expect(reg[uuid]?.deletedAt).toBeGreaterThan(0); // tombstone preserved
    const arr = await reconstructInstructions();
    expect(arr.find((i) => i.uuid === uuid)).toBeUndefined();
  });

  it('newer live remote updatedAt DOES override an older local tombstone (legitimate revival)', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid);

    const localReg = await getRegistry();
    const remoteUpdatedAt = (localReg[uuid]?.deletedAt ?? 0) + 60_000;

    // For revival, we also need the remote to provide chunks for the body.
    // Pre-populate the body keys for the remote scenario.
    const newUuid = uuid;
    await chrome.storage.sync.set({
      [`${BODY_KEY_PREFIX}${newUuid}:c0`]: JSON.stringify({ text: 'revived' }),
    });

    const remote: SyncRegistry = {
      [newUuid]: { title: 'A', updatedAt: remoteUpdatedAt, deletedAt: null, chunks: 1 },
    };
    await applyRemote(remote);

    const reg = await getRegistry();
    expect(reg[newUuid]?.deletedAt).toBeNull(); // overridden — alive again
    expect(reg[newUuid]?.updatedAt).toBe(remoteUpdatedAt);
    const arr = await reconstructInstructions();
    expect(arr.find((i) => i.uuid === newUuid)).toBeDefined();
  });

  it('remote with newer tombstone wins over local live record', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    const localReg = await getRegistry();
    const tombAt = localReg[uuid]!.updatedAt + 1000;

    const remote: SyncRegistry = {
      [uuid]: { title: 'A', updatedAt: localReg[uuid]!.updatedAt, deletedAt: tombAt, chunks: 0 },
    };
    await applyRemote(remote);

    const reg = await getRegistry();
    expect(reg[uuid]?.deletedAt).toBe(tombAt);
    const arr = await reconstructInstructions();
    expect(arr.find((i) => i.uuid === uuid)).toBeUndefined();
  });
});

describe('reconstructInstructions body round-trip (FND-05)', () => {
  it('round-trips a > 7KB body through chunking + reassembly', async () => {
    const longText = 'x'.repeat(15_000);
    const uuid = await createItem({ title: 'Long', text: longText });

    const arr = await reconstructInstructions();
    const found = arr.find((i) => i.uuid === uuid);
    expect(found).toBeDefined();
    expect(found?.text).toBe(longText); // bit-exact recovery
  });
});

describe('updateItem stale-chunk cleanup', () => {
  it('removes body chunks beyond the new chunk count when shrinking', async () => {
    const longText = 'x'.repeat(15_000); // ~3 chunks
    const uuid = await createItem({ title: 'A', text: longText });
    const beforeReg = await getRegistry();
    const beforeChunks = beforeReg[uuid]!.chunks;
    expect(beforeChunks).toBeGreaterThan(1);

    await updateItem(uuid, { text: 'small' });

    const afterReg = await getRegistry();
    expect(afterReg[uuid]?.chunks).toBe(1);

    // Stale chunks beyond c0 should be removed
    for (let i = 1; i < beforeChunks; i++) {
      const key = `${BODY_KEY_PREFIX}${uuid}:c${i}`;
      const r = await chrome.storage.sync.get(key);
      expect(r[key]).toBeUndefined();
    }
  });
});

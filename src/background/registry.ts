import {
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
} from '../shared/constants';
import type {
  SyncRegistry,
  RegistryRecord,
  BodyPayload,
} from '../shared/types';
import { splitIntoChunks, joinChunks } from './storage-layout';
import { readDriveCache, writeDriveCache } from './drive-client';

/**
 * Read the current registry from the local Drive cache.
 * Returns an empty object if the cache is absent (fresh install, no Drive file yet).
 */
export async function getRegistry(): Promise<SyncRegistry> {
  const cache = await readDriveCache();
  return (cache?.data[REGISTRY_KEY] as SyncRegistry | undefined) ?? {};
}

function bodyKeys(uuid: string, chunks: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < chunks; i++) keys.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
  return keys;
}

function bodyWriteMap(uuid: string, chunkStrings: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < chunkStrings.length; i++) {
    map[`${BODY_KEY_PREFIX}${uuid}:c${i}`] = chunkStrings[i]!;
  }
  return map;
}

/**
 * Apply a remote registry slice with last-write-wins + tombstone-priority semantics.
 *
 * Used by pull-engine after polling Drive. Merges remote registry into the local
 * Drive cache's registry — pure in-memory merge, no Drive write (caller handles that).
 *
 * Tombstone resurrection rejection (CLAUDE.md hard rule 10, D-18, Recipe 9):
 * an older live updatedAt does NOT revive a newer deletedAt.
 */
export function mergeRemoteRegistry(local: SyncRegistry, remote: SyncRegistry): { merged: SyncRegistry; changed: boolean } {
  const merged: SyncRegistry = { ...local };
  let changed = false;

  for (const [uuid, remoteRec] of Object.entries(remote)) {
    const localRec = merged[uuid];
    if (localRec === undefined) {
      merged[uuid] = remoteRec;
      changed = true;
      continue;
    }

    const localTomb = localRec.deletedAt;
    const remoteTomb = remoteRec.deletedAt;
    const localAuthority = Math.max(localRec.updatedAt, localTomb ?? 0);
    const remoteAuthority = Math.max(remoteRec.updatedAt, remoteTomb ?? 0);

    if (remoteAuthority > localAuthority) {
      merged[uuid] = remoteRec;
      changed = true;
    } else if (remoteAuthority === localAuthority) {
      if (remoteTomb !== null && localTomb === null) {
        merged[uuid] = remoteRec;
        changed = true;
      }
    }
  }

  return { merged, changed };
}

/**
 * Reassemble live instructions from the Drive cache (registry + body chunks).
 * Excludes tombstoned records. Sorted by updatedAt descending.
 */
export async function reconstructInstructions(): Promise<
  Array<{ uuid: string; title: string; text: string }>
> {
  const cache = await readDriveCache();
  const data = cache?.data ?? {};
  const registry = (data[REGISTRY_KEY] as SyncRegistry | undefined) ?? {};

  const live = Object.entries(registry)
    .filter(([, rec]) => rec.deletedAt === null || rec.deletedAt < rec.updatedAt)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);

  const result: Array<{ uuid: string; title: string; text: string }> = [];

  for (const [uuid, rec] of live) {
    const keys = bodyKeys(uuid, rec.chunks);
    const chunkStrings = keys.map((k) => (data[k] as string | undefined) ?? '');
    const bodyJson = joinChunks(chunkStrings);
    let parsed: BodyPayload;
    try {
      parsed = JSON.parse(bodyJson) as BodyPayload;
    } catch {
      continue;
    }
    result.push({ uuid, title: rec.title, text: parsed.text });
  }

  return result;
}

// ---------------------------------------------------------------------------
// CRUD helpers (used by registry.test.ts; not used by the push/pull engine flow).
// These write pendingWrite batches — caller must flush to Drive separately.
// ---------------------------------------------------------------------------

export async function createItem(input: { title: string; text: string }): Promise<string> {
  const uuid = crypto.randomUUID();
  const now = Date.now();
  const payload: BodyPayload = { text: input.text };
  const chunkStrings = splitIntoChunks(JSON.stringify(payload));

  const registry = await getRegistry();
  const next: SyncRegistry = {
    ...registry,
    [uuid]: {
      title: input.title,
      updatedAt: now,
      deletedAt: null,
      chunks: chunkStrings.length,
    },
  };

  const cache = await readDriveCache() ?? { fileId: '', modifiedTime: '', data: {} };
  const newData = { ...cache.data, [REGISTRY_KEY]: next, ...bodyWriteMap(uuid, chunkStrings) };
  await writeDriveCache({ ...cache, data: newData });
  return uuid;
}

export async function updateItem(
  uuid: string,
  patch: Partial<{ title: string; text: string }>,
): Promise<void> {
  const registry = await getRegistry();
  const existing = registry[uuid];
  if (existing === undefined) throw new Error(`updateItem: no such uuid ${uuid}`);
  if (existing.deletedAt !== null) throw new Error(`updateItem: ${uuid} is tombstoned`);

  const now = Date.now();
  const nextRecord: RegistryRecord = {
    title: patch.title ?? existing.title,
    updatedAt: now,
    deletedAt: null,
    chunks: existing.chunks,
  };

  const newBodyWrites: Record<string, string> = {};
  if (patch.text !== undefined) {
    const payload: BodyPayload = { text: patch.text };
    const chunkStrings = splitIntoChunks(JSON.stringify(payload));
    nextRecord.chunks = chunkStrings.length;
    Object.assign(newBodyWrites, bodyWriteMap(uuid, chunkStrings));
  }

  const nextRegistry: SyncRegistry = { ...registry, [uuid]: nextRecord };
  const cache = await readDriveCache() ?? { fileId: '', modifiedTime: '', data: {} };
  const newData: Record<string, unknown> = { ...cache.data, [REGISTRY_KEY]: nextRegistry, ...newBodyWrites };

  // Remove stale body chunks if chunk count decreased
  if (patch.text !== undefined && existing.chunks > nextRecord.chunks) {
    for (let i = nextRecord.chunks; i < existing.chunks; i++) {
      delete newData[`${BODY_KEY_PREFIX}${uuid}:c${i}`];
    }
  }

  await writeDriveCache({ ...cache, data: newData });
}

export async function deleteItem(uuid: string): Promise<void> {
  const registry = await getRegistry();
  const existing = registry[uuid];
  if (existing === undefined) throw new Error(`deleteItem: no such uuid ${uuid}`);

  const now = Date.now();
  const nextRecord: RegistryRecord = {
    title: existing.title,
    updatedAt: existing.updatedAt,
    deletedAt: now,
    chunks: 0,
  };
  const nextRegistry: SyncRegistry = { ...registry, [uuid]: nextRecord };

  const cache = await readDriveCache() ?? { fileId: '', modifiedTime: '', data: {} };
  const newData: Record<string, unknown> = { ...cache.data, [REGISTRY_KEY]: nextRegistry };
  for (let i = 0; i < existing.chunks; i++) {
    delete newData[`${BODY_KEY_PREFIX}${uuid}:c${i}`];
  }
  await writeDriveCache({ ...cache, data: newData });
}

/**
 * Apply a remote registry to the local Drive cache (no Drive write).
 * Used by pull-engine to update the cache after polling.
 * Returns true if anything changed.
 */
export async function applyRemote(remote: SyncRegistry): Promise<boolean> {
  const cache = await readDriveCache();
  const local = (cache?.data[REGISTRY_KEY] as SyncRegistry | undefined) ?? {};
  const { merged, changed } = mergeRemoteRegistry(local, remote);
  if (changed && cache) {
    await writeDriveCache({ ...cache, data: { ...cache.data, [REGISTRY_KEY]: merged } });
  }
  return changed;
}

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

/**
 * Read the current registry from chrome.storage.sync.
 * Returns an empty object if the key is absent (e.g., fresh device pre-bootstrap).
 */
export async function getRegistry(): Promise<SyncRegistry> {
  const r = await chrome.storage.sync.get(REGISTRY_KEY);
  return (r[REGISTRY_KEY] as SyncRegistry | undefined) ?? {};
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
 * Create a new instruction. Assigns a fresh UUID via crypto.randomUUID() (D-17).
 * Writes registry + body in a single batched set() call (CLAUDE.md hard rule 3).
 * Returns the UUID — caller stores it as the permanent identity (FND-01 / D-16).
 */
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

  await chrome.storage.sync.set({
    [REGISTRY_KEY]: next,
    ...bodyWriteMap(uuid, chunkStrings),
  });
  return uuid;
}

/**
 * Update an existing instruction. UUID is NEVER changed (FND-01 / D-16: rename
 * preserves identity). Bumps updatedAt. If `text` is provided, body keys are
 * rewritten with the new chunk count.
 */
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

  const writes: Record<string, unknown> = {};

  if (patch.text !== undefined) {
    // Re-chunk and rewrite body keys. Existing body keys beyond the new
    // chunk count must be removed to avoid stale chunks polluting reassembly.
    const payload: BodyPayload = { text: patch.text };
    const chunkStrings = splitIntoChunks(JSON.stringify(payload));
    nextRecord.chunks = chunkStrings.length;

    Object.assign(writes, bodyWriteMap(uuid, chunkStrings));
    // Stale-chunk cleanup: remove old chunk keys beyond new count.
    if (existing.chunks > chunkStrings.length) {
      const stale: string[] = [];
      for (let i = chunkStrings.length; i < existing.chunks; i++) {
        stale.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
      }
      await chrome.storage.sync.remove(stale);
    }
  }

  const nextRegistry: SyncRegistry = { ...registry, [uuid]: nextRecord };
  writes[REGISTRY_KEY] = nextRegistry;
  await chrome.storage.sync.set(writes);
}

/**
 * Soft-delete an instruction. Sets deletedAt = Date.now() and clears the body keys.
 * The registry entry stays in place to mark the tombstone (D-18 / FND-03).
 */
export async function deleteItem(uuid: string): Promise<void> {
  const registry = await getRegistry();
  const existing = registry[uuid];
  if (existing === undefined) throw new Error(`deleteItem: no such uuid ${uuid}`);

  const now = Date.now();
  const nextRecord: RegistryRecord = {
    title: existing.title,
    updatedAt: existing.updatedAt,
    deletedAt: now,
    chunks: 0, // body cleared
  };
  const nextRegistry: SyncRegistry = { ...registry, [uuid]: nextRecord };

  await chrome.storage.sync.set({ [REGISTRY_KEY]: nextRegistry });
  // Clear body keys — they are no longer needed once the tombstone is set.
  // Saves quota for live items. Tombstone GC (TTL purge of the registry entry
  // itself) is Phase 4 / v1.x.
  if (existing.chunks > 0) {
    await chrome.storage.sync.remove(bodyKeys(uuid, existing.chunks));
  }
}

/**
 * Apply a remote registry slice with last-write-wins + tombstone-priority semantics.
 *
 * Tombstone resurrection rejection (CLAUDE.md hard rule 10, D-18, Recipe 9):
 * an older live updatedAt does NOT revive a newer deletedAt. Tie (deletedAt
 * === updatedAt) goes to the tombstone (D-06 / D-18).
 *
 * Phase 1 ships ONLY the tombstone-resurrection-rejection slice. The full
 * merge engine (multi-tab coordination, infinite-loop guard, body-fetch path)
 * is Phase 4 / BOOT-01 work.
 */
export async function applyRemote(remote: SyncRegistry): Promise<void> {
  const local = await getRegistry();
  const merged: SyncRegistry = { ...local };

  for (const [uuid, remoteRec] of Object.entries(remote)) {
    const localRec = merged[uuid];
    if (localRec === undefined) {
      merged[uuid] = remoteRec;
      continue;
    }

    // Tombstone resurrection rejection: if local has an active tombstone
    // (deletedAt !== null) and remote's updatedAt does NOT exceed local.deletedAt,
    // the local tombstone wins.
    const localTomb = localRec.deletedAt;
    const remoteTomb = remoteRec.deletedAt;

    // Take whichever side has the newest authoritative timestamp.
    // "authoritative timestamp" = max(updatedAt, deletedAt ?? 0) for each side.
    const localAuthority = Math.max(localRec.updatedAt, localTomb ?? 0);
    const remoteAuthority = Math.max(remoteRec.updatedAt, remoteTomb ?? 0);

    if (remoteAuthority > localAuthority) {
      merged[uuid] = remoteRec;
    } else if (remoteAuthority === localAuthority) {
      // Tie: tombstone wins per D-06 / D-18.
      if (remoteTomb !== null && localTomb === null) {
        merged[uuid] = remoteRec;
      }
      // else: local stays (either both tombstoned, or both alive and equal)
    }
    // else: local has newer authority — keep local
  }

  await chrome.storage.sync.set({ [REGISTRY_KEY]: merged });
}

/**
 * Reassemble live instructions from the registry + body chunks.
 * Excludes tombstoned records (D-06 / D-18: deletedAt >= updatedAt).
 * Sorted by updatedAt descending (D-06).
 */
export async function reconstructInstructions(): Promise<
  Array<{ uuid: string; title: string; text: string }>
> {
  const registry = await getRegistry();
  const live = Object.entries(registry)
    .filter(([, rec]) => rec.deletedAt === null || rec.deletedAt < rec.updatedAt)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);

  const result: Array<{ uuid: string; title: string; text: string }> = [];

  for (const [uuid, rec] of live) {
    const keys = bodyKeys(uuid, rec.chunks);
    const r = await chrome.storage.sync.get(keys);
    const chunkStrings = keys.map((k) => (r[k] as string | undefined) ?? '');
    const bodyJson = joinChunks(chunkStrings);
    let parsed: BodyPayload;
    try {
      parsed = JSON.parse(bodyJson) as BodyPayload;
    } catch {
      // Malformed body — skip. Phase 3 will surface MALFORMED_REMOTE; Phase 1
      // just ensures reconstruction doesn't crash.
      continue;
    }
    result.push({ uuid, title: rec.title, text: parsed.text });
  }

  return result;
}

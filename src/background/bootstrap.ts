/**
 * Bootstrap Union Merge (BOOT-01, BOOT-02).
 *
 * First-install flow: content script sends LS_BOOTSTRAP with raw localStorage snapshot.
 * SW assigns UUIDs to local-only items (BOOT-02 title-match), merges with remote via
 * pure mergeRegistries(), writes ONE batched sync.set() (Hard Rule 3), delivers to tab.
 *
 * Hard Rule 3 compliance: Does NOT call applyRemote() (which writes to sync internally).
 * Uses mergeRegistries() — a pure function — then issues one batched chrome.storage.sync.set().
 * All merge logic stays in the SW (Hard Rule 6).
 */

import { getRegistry, reconstructInstructions } from './registry';
import { splitIntoChunks } from './storage-layout';
import { deliverToTab } from './pull-engine';
import { REGISTRY_KEY, BOOTSTRAP_NEEDED_KEY, BODY_KEY_PREFIX } from '../shared/constants';
import type { SyncRegistry, RegistryRecord, RawInstruction } from '../shared/types';

/**
 * Pure function: merge two SyncRegistry objects with last-write-wins + tombstone-wins.
 * Replicates applyRemote() logic without chrome API side effects (Hard Rule 3).
 * Exported for testing.
 *
 * Rules (same as applyRemote — Hard Rule 10):
 *   - For each UUID in remote: if remote.deletedAt is set AND remote.deletedAt > local.updatedAt → tombstone wins
 *   - For each UUID in both: last-write-wins on updatedAt
 *   - Local-only keys: kept as-is
 *   - Remote-only keys: kept as-is
 */
export function mergeRegistries(
  local: SyncRegistry,
  remote: SyncRegistry,
): SyncRegistry {
  const merged: SyncRegistry = { ...local };

  for (const [uuid, remoteRec] of Object.entries(remote)) {
    const localRec = merged[uuid];

    if (localRec === undefined) {
      // Remote-only — keep it
      merged[uuid] = remoteRec;
      continue;
    }

    // Both sides have this UUID — apply last-write-wins + tombstone-wins (Hard Rule 10)
    const remoteDeletedAt = remoteRec.deletedAt ?? 0;
    const localUpdatedAt = localRec.updatedAt ?? 0;

    if (remoteDeletedAt > 0 && remoteDeletedAt > localUpdatedAt) {
      // Tombstone wins unconditionally when deletedAt > local updatedAt
      merged[uuid] = remoteRec;
    } else if (remoteRec.updatedAt > localRec.updatedAt) {
      // Remote is newer — last-write-wins
      merged[uuid] = remoteRec;
    }
    // else: local is newer or equal — keep local (already in merged)
  }

  return merged;
}

/** Build a map of body chunk keys for a single UUID. */
function buildBodyWriteMap(uuid: string, chunkStrings: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < chunkStrings.length; i++) {
    map[`${BODY_KEY_PREFIX}${uuid}:c${i}`] = chunkStrings[i]!;
  }
  return map;
}

/**
 * Handle an LS_BOOTSTRAP message from the content script.
 * Performs union merge: assigns UUIDs to local-only items, merges with remote,
 * writes ONE batched sync.set(), delivers merged array to tab.
 *
 * @param payload - raw localStorage snapshot (RawInstruction[]) from content script
 */
export async function handleLsBootstrap(payload: RawInstruction[]): Promise<void> {
  // Hard Rule 4: never treat empty localStorage as "nothing to bootstrap"
  if (payload.length === 0) return;

  const remoteRegistry = await getRegistry();

  // Build titleToUuid map from LIVE remote entries only (D-06: first by updatedAt desc wins)
  const sortedRemote = Object.entries(remoteRegistry)
    .filter(([, rec]) => rec.deletedAt === null)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  const titleToUuid = new Map<string, string>();
  for (const [uuid, rec] of sortedRemote) {
    if (!titleToUuid.has(rec.title)) {
      titleToUuid.set(rec.title, uuid); // first match (highest updatedAt) wins — D-06
    }
  }

  // Assign UUIDs to local items and build local registry + body writes
  const now = Date.now();
  const localRegistry: SyncRegistry = {};
  const bodyWrites: Record<string, string> = {};

  for (const item of payload) {
    const matchedUuid = titleToUuid.get(item.title);
    let uuid = matchedUuid ?? crypto.randomUUID(); // D-17: fresh UUID for unmatched

    if (localRegistry[uuid] !== undefined) {
      // Collision guard (D-06): second local item with same matched UUID gets a fresh UUID
      uuid = crypto.randomUUID();
    }

    const bodyJson = JSON.stringify({ text: item.text });
    const chunks = splitIntoChunks(bodyJson);
    const rec: RegistryRecord = {
      title: item.title,
      updatedAt: now,
      deletedAt: null,
      chunks: chunks.length,
    };
    localRegistry[uuid] = rec;
    Object.assign(bodyWrites, buildBodyWriteMap(uuid, chunks));
  }

  // Pure in-memory merge: localRegistry wins over remote for new items;
  // mergeRegistries applies last-write-wins + tombstone-wins for collisions.
  const merged = mergeRegistries(localRegistry, remoteRegistry);

  // Hard Rule 3: single batched sync write (registry + all body chunks together).
  // This is the ONLY chrome.storage.sync.set() call in bootstrap — no applyRemote() call.
  await chrome.storage.sync.set({
    [REGISTRY_KEY]: merged,
    ...bodyWrites,
  });

  // Reconstruct live array from merged state and deliver to tab
  const liveItems = await reconstructInstructions();
  const mergedPayload: RawInstruction[] = liveItems.map(({ title, text }) => ({ title, text }));

  await deliverToTab(mergedPayload);

  // Clear bootstrap flag ONLY after successful completion (Pitfall 3: CS never clears this)
  await chrome.storage.local.remove(BOOTSTRAP_NEEDED_KEY);

  console.log(
    '[sysins] bootstrap: merged',
    payload.length,
    'local +',
    Object.keys(remoteRegistry).length,
    'remote item(s)',
  );
}

/**
 * Bootstrap Union Merge (BOOT-01, BOOT-02).
 *
 * First-install flow: content script sends LS_BOOTSTRAP with raw localStorage snapshot.
 * SW assigns UUIDs to local-only items, merges with Drive remote state, writes to Drive,
 * delivers merged array to tab.
 *
 * Drive replaces chrome.storage.sync: single flushToDrive() call instead of sync.set().
 */

import { getRegistry, reconstructInstructions } from './registry';
import { splitIntoChunks } from './storage-layout';
import { deliverToTab } from './pull-engine';
import { REGISTRY_KEY, BOOTSTRAP_NEEDED_KEY, BODY_KEY_PREFIX } from '../shared/constants';
import type { SyncRegistry, RegistryRecord, RawInstruction } from '../shared/types';
import { flushToDrive, readDriveCache, writeDriveCache } from './drive-client';

/**
 * Pure function: merge two SyncRegistry objects with last-write-wins + tombstone-wins.
 * Exported for testing.
 */
export function mergeRegistries(local: SyncRegistry, remote: SyncRegistry): SyncRegistry {
  const merged: SyncRegistry = { ...local };

  for (const [uuid, remoteRec] of Object.entries(remote)) {
    const localRec = merged[uuid];

    if (localRec === undefined) {
      merged[uuid] = remoteRec;
      continue;
    }

    const remoteDeletedAt = remoteRec.deletedAt ?? 0;
    const localUpdatedAt = localRec.updatedAt ?? 0;

    if (remoteDeletedAt > 0 && remoteDeletedAt > localUpdatedAt) {
      merged[uuid] = remoteRec;
    } else if (remoteRec.updatedAt > localRec.updatedAt) {
      merged[uuid] = remoteRec;
    }
  }

  return merged;
}

function buildBodyWriteMap(uuid: string, chunkStrings: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < chunkStrings.length; i++) {
    map[`${BODY_KEY_PREFIX}${uuid}:c${i}`] = chunkStrings[i]!;
  }
  return map;
}

/**
 * Handle an LS_BOOTSTRAP message from the content script.
 * Performs union merge: assigns UUIDs to local-only items, merges with Drive remote,
 * writes to Drive, delivers merged array to tab.
 */
export async function handleLsBootstrap(payload: RawInstruction[]): Promise<void> {
  if (payload.length === 0) return;

  const remoteRegistry = await getRegistry();

  const sortedRemote = Object.entries(remoteRegistry)
    .filter(([, rec]) => rec.deletedAt === null)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
  const titleToUuid = new Map<string, string>();
  for (const [uuid, rec] of sortedRemote) {
    if (!titleToUuid.has(rec.title)) {
      titleToUuid.set(rec.title, uuid);
    }
  }

  const now = Date.now();
  const localRegistry: SyncRegistry = {};
  const bodyWrites: Record<string, string> = {};

  for (const item of payload) {
    const matchedUuid = titleToUuid.get(item.title);
    let uuid = matchedUuid ?? crypto.randomUUID();

    if (localRegistry[uuid] !== undefined) {
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

  const merged = mergeRegistries(localRegistry, remoteRegistry);

  // Build the full Drive batch: merged registry + all body writes from local payload
  const batch: Record<string, unknown> = {
    [REGISTRY_KEY]: merged,
    ...bodyWrites,
  };

  // flushToDrive reads-modify-writes: existing Drive body chunks preserved for
  // remote-only items not in `bodyWrites` (they stay in Drive data as-is).
  await flushToDrive(batch, true);

  // After flush, Drive cache is updated. Reconstruct from it for delivery.
  const liveItems = await reconstructInstructions();
  const mergedPayload: RawInstruction[] = liveItems.map(({ title, text }) => ({ title, text }));

  await deliverToTab(mergedPayload);
  await chrome.storage.local.remove(BOOTSTRAP_NEEDED_KEY);

  console.log(
    '[sysins] bootstrap: merged',
    payload.length,
    'local +',
    Object.keys(remoteRegistry).length,
    'remote item(s)',
  );
}

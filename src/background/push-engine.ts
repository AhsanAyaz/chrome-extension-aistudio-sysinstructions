/**
 * Push Engine — diff algorithm, UUID assignment, and pending-write accumulation.
 *
 * This is the heart of Phase 3. It takes an incoming RawInstruction[] payload,
 * computes what changed against the last-pushed snapshot, assigns UUIDs, builds
 * the full chrome.storage.sync batch (registry + body chunks), and persists that
 * batch to chrome.storage.local so it survives a service-worker kill.
 *
 * No sync write happens here — that is alarm-flush's responsibility (Plan 03-03).
 *
 * Hard Rule 4 / PUSH-05: an empty payload is never treated as "delete everything".
 * It signals a detection failure, not a user intent.
 *
 * T-03-02-b: logging only emits item counts — never instruction text content.
 */

import {
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
  PENDING_WRITE_KEY,
} from '../shared/constants';
import type {
  SyncRegistry,
  RegistryRecord,
  LastPushedSnapshot,
  RawInstruction,
} from '../shared/types';
import { splitIntoChunks } from './storage-layout';
import { shortHash } from './hash';
import { getRegistry } from './registry';
import { readLastPushed, SYNC_PENDING_KEY } from './sync-state';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Build a body write map for a single uuid + its chunk strings.
 * Keys are `sysins:body:<uuid>:c<N>`.
 */
function bodyWriteMap(uuid: string, chunkStrings: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < chunkStrings.length; i++) {
    map[`${BODY_KEY_PREFIX}${uuid}:c${i}`] = chunkStrings[i]!;
  }
  return map;
}

/**
 * Extract fields beyond title and text from a RawInstruction.
 * These unknown fields are preserved verbatim in the body chunk (PUSH-06 / D-08).
 */
function getUnknownFields(item: RawInstruction): Record<string, unknown> {
  const { title: _t, text: _b, ...rest } = item;
  return rest as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Compute a diff between the incoming payload and the last-pushed snapshot,
 * then accumulate the resulting chrome.storage.sync batch into
 * chrome.storage.local under PENDING_WRITE_KEY.
 *
 * Design decisions:
 * - Empty payload returns immediately without writing (Hard Rule 4 / PUSH-05).
 * - Tombstoned items are excluded from the live title→uuid lookup. A title
 *   reappearing after deletion gets a fresh UUID (T-03-02-c).
 * - If nothing changed (all hashes match, no tombstones needed) no write occurs.
 */
export async function diffAndAccumulate(payload: RawInstruction[]): Promise<void> {
  // Hard Rule 4 / PUSH-05: empty payload is a detection failure, never a delete signal.
  if (payload.length === 0) return;

  const [registry, lastPushed, existingPending] = await Promise.all([
    getRegistry(),       // chrome.storage.sync — last committed state
    readLastPushed(),    // chrome.storage.local — hash snapshot from last flush
    drainPendingWrite(), // chrome.storage.local — in-flight intent (may be newer than sync)
  ]);

  // Prefer the in-flight pending registry over sync as the base. When multiple
  // LS_CHANGED events fire in rapid succession (AI Studio autosave intermediate
  // states), each call builds on the previous call's intent rather than the stale
  // sync state. This preserves tombstones set by earlier events in the same burst.
  const pendingRegistry = existingPending
    ? (existingPending[REGISTRY_KEY] as SyncRegistry | undefined) ?? null
    : null;
  const baseRegistry: SyncRegistry = pendingRegistry ?? registry;

  // Build reverse lookup: title → uuid for LIVE base-registry entries only.
  // Tombstoned entries are excluded — a title reappearing after deletion
  // gets a fresh UUID (T-03-02-c: rename = delete + create; accept disposition).
  const titleToUuid = new Map<string, string>();
  for (const [uuid, rec] of Object.entries(baseRegistry)) {
    if (rec.deletedAt === null) {
      titleToUuid.set(rec.title, uuid);
    }
  }

  const now = Date.now();
  const nextRegistry: SyncRegistry = { ...baseRegistry };
  const bodyWrites: Record<string, string> = {};
  const seenUuids = new Set<string>();

  for (const item of payload) {
    const existingUuid = titleToUuid.get(item.title);
    const uuid = existingUuid ?? crypto.randomUUID(); // D-17: assign UUID on first sight

    const titleHash = await shortHash(item.title);
    const unknownFields = getUnknownFields(item);
    const bodyJson = JSON.stringify({ text: item.text, ...unknownFields });
    const bodyHash = await shortHash(bodyJson);

    const pushed = lastPushed[uuid];
    const unchanged =
      pushed !== undefined &&
      pushed.titleHash === titleHash &&
      pushed.bodyHash === bodyHash;

    if (!unchanged) {
      const chunks = splitIntoChunks(bodyJson);
      const nextRecord: RegistryRecord = {
        title: item.title,
        updatedAt: now,
        deletedAt: null,
        chunks: chunks.length,
      };
      nextRegistry[uuid] = nextRecord;
      Object.assign(bodyWrites, bodyWriteMap(uuid, chunks));
    }
    seenUuids.add(uuid);
  }

  // Tombstone items that disappeared from the payload.
  // Guard (D-18): only tombstone items this device locally knows about — either
  // previously flushed (in lastPushed) or accumulated earlier in this burst
  // (in pendingRegistry). Items that arrived via remote pull only (in sync registry
  // but absent from both lastPushed and pendingRegistry) must not be tombstoned —
  // doing so would wipe the other device's data on the next push cycle.
  let hasChanges = Object.keys(bodyWrites).length > 0;
  for (const [uuid, rec] of Object.entries(baseRegistry)) {
    const wasLocallyKnown =
      lastPushed[uuid] !== undefined ||
      (pendingRegistry !== null && uuid in pendingRegistry);
    if (!seenUuids.has(uuid) && rec.deletedAt === null && wasLocallyKnown) {
      nextRegistry[uuid] = { ...rec, deletedAt: now };
      hasChanges = true;
    }
  }

  // If nothing changed at all (all items match lastPushed, no deletions), skip write.
  if (!hasChanges) return;

  const pendingWrite: Record<string, unknown> = {
    [REGISTRY_KEY]: nextRegistry,
    ...bodyWrites,
  };

  // T-03-02-b: log only counts, never instruction text
  console.log(
    `[sysins] push-engine: ${payload.length} items, ${Object.keys(bodyWrites).length} body chunks changed`,
  );

  await persistPendingWrite(pendingWrite);
}

/**
 * Persist the batch to chrome.storage.local under PENDING_WRITE_KEY.
 * Also writes the SYNC_PENDING_KEY sentinel so ensureInitialized can
 * detect and recover from orphaned in-progress writes on SW restart (D-13).
 *
 * CLAUDE.md hard rule 3: every chrome.storage write is a single batched set().
 */
export async function persistPendingWrite(batch: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set({
    [PENDING_WRITE_KEY]: batch,
    [SYNC_PENDING_KEY]: {
      batchId: crypto.randomUUID(),
      keys: Object.keys(batch),
      startedAt: Date.now(),
    },
  });
}

/**
 * Read the persisted pending-write batch from chrome.storage.local.
 * Returns null if nothing is pending.
 * Called by alarm-flush (Plan 03-03) before issuing the chrome.storage.sync write.
 */
export async function drainPendingWrite(): Promise<Record<string, unknown> | null> {
  const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
  return (r[PENDING_WRITE_KEY] as Record<string, unknown> | undefined) ?? null;
}

/**
 * Remove the pending-write batch AND the sync-pending sentinel from
 * chrome.storage.local. Called by alarm-flush after a successful sync write.
 */
export async function clearPendingWrite(): Promise<void> {
  await chrome.storage.local.remove([PENDING_WRITE_KEY, SYNC_PENDING_KEY]);
}

/**
 * Import instructions with union-merge semantics — existing items are NEVER tombstoned.
 *
 * Hard Rule 5: import is additive only. Items in the current registry absent from the
 * imported payload stay live. This differs from diffAndAccumulate which tombstones
 * absent items (correct for LS_CHANGED observation but wrong for user-initiated import).
 */
export async function importItems(imported: RawInstruction[]): Promise<void> {
  if (imported.length === 0) return;

  const [registry, lastPushed, existingPending] = await Promise.all([
    getRegistry(),
    readLastPushed(),
    drainPendingWrite(),
  ]);

  const pendingRegistry = existingPending
    ? (existingPending[REGISTRY_KEY] as SyncRegistry | undefined) ?? null
    : null;
  const baseRegistry: SyncRegistry = pendingRegistry ?? registry;

  const titleToUuid = new Map<string, string>();
  for (const [uuid, rec] of Object.entries(baseRegistry)) {
    if (rec.deletedAt === null) {
      titleToUuid.set(rec.title, uuid);
    }
  }

  const now = Date.now();
  const nextRegistry: SyncRegistry = { ...baseRegistry }; // preserve all existing items
  const bodyWrites: Record<string, string> = {};
  let hasChanges = false;

  for (const item of imported) {
    const existingUuid = titleToUuid.get(item.title);
    const uuid = existingUuid ?? crypto.randomUUID();

    const titleHash = await shortHash(item.title);
    const unknownFields = getUnknownFields(item);
    const bodyJson = JSON.stringify({ text: item.text, ...unknownFields });
    const bodyHash = await shortHash(bodyJson);

    const pushed = lastPushed[uuid];
    const unchanged =
      pushed !== undefined &&
      pushed.titleHash === titleHash &&
      pushed.bodyHash === bodyHash;

    if (!unchanged) {
      const chunks = splitIntoChunks(bodyJson);
      nextRegistry[uuid] = { title: item.title, updatedAt: now, deletedAt: null, chunks: chunks.length };
      Object.assign(bodyWrites, bodyWriteMap(uuid, chunks));
      hasChanges = true;
    }
    // No tombstone loop — absent items remain alive (Hard Rule 5)
  }

  if (!hasChanges) return;

  console.log(
    `[sysins] push-engine: import ${imported.length} item(s), ${Object.keys(bodyWrites).length} body chunks changed`,
  );

  await persistPendingWrite({ [REGISTRY_KEY]: nextRegistry, ...bodyWrites });
}

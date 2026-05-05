// All Phase 1 storage shape type declarations.
// D-03 / D-12 / D-13 / D-14 / D-15 — type shape lock.
// OQ-1: 'PENDING_MERGE_OVERFLOW' widened into ErrorState per RESEARCH recommendation.

// sysins:meta — D-03 / D-09 / D-11
export interface SyncMeta {
  schemaVersion: 1; // literal type — locks D-11 v1 schema for the entire v1.x line
  lastPushAt: number;
  lastPullAt: number;
}

// sysins:registry — D-03 (note: `chunks` widening over ARCHITECTURE.md's original 3-field shape)
export interface RegistryRecord {
  title: string;
  updatedAt: number; // epoch ms
  deletedAt: number | null; // epoch ms tombstone; null = alive
  chunks: number; // D-03: body chunk count, avoids extra round-trip
}
export type SyncRegistry = Record<string, RegistryRecord>;

// sysins:body:<uuid>:c<N> — D-01: JSON.stringify({text, ...rest})
// BodyPayload describes the parsed JSON, not the chunk strings themselves.
export interface BodyPayload {
  text: string;
  [unknownAiStudioField: string]: unknown; // ...rest spread per D-01 (PUSH-06 forward-compat)
}

// sysins:local:lastPushed — D-12
export interface LastPushedEntry {
  titleHash: string; // SHA-256 truncated to 16 hex chars (Recipe 6)
  bodyHash: string;
  updatedAt: number;
}
export type LastPushedSnapshot = Record<string, LastPushedEntry>;

// sysins:local:syncPending — D-13
export interface SyncPendingSentinel {
  batchId: string;
  keys: string[]; // serialized as array (Set is not chrome.storage-cloneable per Recipe 6)
  startedAt: number; // epoch ms; orphaned if older than PENDING_BATCH_TTL_MS
}

// sysins:local:pendingMerges — D-14
export interface PendingMerge {
  changes: unknown; // shape locked in Phase 3 when consumer exists
  receivedAt: number;
}

// sysins:local:syncStatus — D-15 (with OQ-1 widening)
export type ErrorState =
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SCHEMA_AHEAD'
  | 'SCHEMA_UNKNOWN'
  | 'MALFORMED_REMOTE'
  | 'ACCOUNT_MISMATCH'
  | 'OVERSIZED_ITEM'
  | 'STRICT_VALIDATION_FAIL'
  | 'PENDING_MERGE_OVERFLOW'; // OQ-1: widening of D-15 enum (D-15 explicitly says "Phase 1 defines the shape")

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  lastSyncAt: number;
  errorState?: ErrorState;
  errorDetail?: string;
}

// Shape of one item as AI Studio writes it to localStorage.
// Index signature preserves unknown fields verbatim — D-08 / PUSH-06.
// title and text are the only currently known fields.
export interface RawInstruction {
  title: string;
  text: string;
  [unknownAiStudioField: string]: unknown;
}

// sysins:local:lastObserved — D-02
// Written by Phase 2's onMessage stub; read by Phase 3's push engine
// as the starting snapshot for the first diff cycle.
// Phase 3 transition: superseded by sysins:local:lastPushed (D-12)
// once Phase 3 runs a successful push.
export interface LastObservedSnapshot {
  lastObservedAt: number; // epoch ms
  itemCount: number;
  items: RawInstruction[];
}

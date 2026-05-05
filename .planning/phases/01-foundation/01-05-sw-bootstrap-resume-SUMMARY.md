---
phase: 01-foundation
plan: 05
subsystem: service-worker
tags: [typescript, chrome-storage, service-worker, vitest, fakeBrowser, onInstalled, orphan-recovery, FND-04, FND-06]
dependency_graph:
  requires: [01-02, 01-03]
  provides: [meta-bootstrap, sync-state, sw-entrypoint]
  affects: [Phase 2 onMessage, Phase 3 push-engine, Phase 5 popup]
tech_stack:
  added: []
  patterns:
    - Pattern S-4 (_resetForTesting seam for SW-restart simulation)
    - D-10 write-if-absent (read-then-conditionally-set)
    - D-13 orphaned syncPending recovery on SW wake
    - exactOptionalPropertyTypes discipline in writeSyncStatus
key_files:
  created:
    - src/background/meta-bootstrap.ts
    - src/background/sync-state.ts
    - src/background/service-worker.test.ts
  modified:
    - src/background/index.ts
decisions:
  - "Orphan recovery is silent (no setErrorState): clearing a stale syncPending sentinel is an expected SW-restart path, not a user-facing error. Phase 3 may add a dedicated error tag if visibility is needed."
  - "The 4 sysins:local:* key constants (SYNC_STATUS_KEY etc.) are colocated in sync-state.ts rather than constants.ts — they are derived from LOCAL_KEY_PREFIX and consumed only by sync-state.ts in Phase 1. Phase 5 may move them to constants.ts when the popup needs them."
  - "Phase 1 index.ts boundary: only onInstalled listener registered. No onMessage (Phase 2), no onChanged/alarms (Phase 3), no sendMessage (Phase 4)."
metrics:
  duration: "2 min"
  completed: "2026-05-05T21:37:07Z"
  tasks_completed: 3
  files_created: 3
  files_modified: 1
---

# Phase 01 Plan 05: SW Bootstrap + Resume Summary

**One-liner:** Service worker entrypoint wired with write-if-absent meta bootstrap (FND-04) and orphaned-syncPending recovery on SW wake (FND-06), backed by 8 passing tests.

## What Was Built

### src/background/meta-bootstrap.ts

```typescript
export async function initializeMeta(): Promise<void>
```

Read-then-conditionally-set for `sysins:meta` (D-10, Recipe 4). Only writes `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}` if the key is absent. Leaves any existing meta (including ahead-version schema) in place — the meta-guard handles mismatch at the next sync entry.

### src/background/sync-state.ts

Exported key constants:
```typescript
export const SYNC_STATUS_KEY   = 'sysins:local:syncStatus';
export const SYNC_PENDING_KEY  = 'sysins:local:syncPending';
export const LAST_PUSHED_KEY   = 'sysins:local:lastPushed';
export const PENDING_MERGES_KEY = 'sysins:local:pendingMerges';
```

Exported helper functions:
```typescript
export async function readSyncStatus(): Promise<SyncStatus>
export async function writeSyncStatus(status: SyncStatus): Promise<void>
export async function setErrorState(tag: ErrorState, detail?: string): Promise<void>
export async function readSyncPending(): Promise<SyncPendingSentinel | undefined>
export async function clearSyncPending(): Promise<void>
export async function readLastPushed(): Promise<LastPushedSnapshot>
export async function readPendingMerges(): Promise<PendingMerge[]>
export async function enqueuePendingMerge(merge: PendingMerge): Promise<void>
```

All functions touch only `chrome.storage.local` (CLAUDE.md hard rule 9 discipline). `writeSyncStatus` builds a clean object to avoid writing `errorState: undefined` under exactOptionalPropertyTypes.

### src/background/index.ts (replaced Plan 01 stub)

```typescript
export async function ensureInitialized(): Promise<void>  // SW-wake recovery, idempotent
export function _resetForTesting(): void                   // @internal testing seam (Pattern S-4)
export default defineBackground(...)                       // registers onInstalled handler only
```

`ensureInitialized()` checks `inMemoryState.initialized` for idempotency, then reads `sysins:local:syncPending`. If the sentinel is older than `PENDING_BATCH_TTL_MS` (60s), it is cleared silently (orphan recovery, D-13). Sets `initialized = true` on completion.

## Tests: service-worker.test.ts

8 tests, all passing. Coverage by D-25 requirement:

| Test | D-25 Case | Requirement |
|------|-----------|-------------|
| writes default meta on first install | FND-04 bootstrap | D-10 write-if-absent |
| does NOT overwrite existing meta (lastPushAt: 12345) | FND-04 idempotency | D-10 |
| does NOT overwrite ahead-version meta (schemaVersion: 2) | Schema-version non-regression | T-01-20 |
| clears orphaned syncPending (90s old) | FND-06 restart recovery | D-13 |
| preserves recent syncPending (5s old) | FND-06 non-orphan | D-13, T-01-22 |
| ensureInitialized is idempotent (second call no-op) | FND-06 idempotency | D-13 |
| _resetForTesting re-arms orphan check | FND-06 SW restart simulation | Pattern S-4 |
| enqueuePendingMerge overflow at cap+1 | D-14, OQ-1 | PENDING_MERGE_OVERFLOW |

## Decisions Made

1. **Orphan recovery is silent.** Clearing a `syncPending` sentinel on SW wake is a normal, expected recovery event (the SW was killed mid-write by the browser). Surfacing this as a red badge would be noisy. Phase 3 may add a dedicated `errorState` tag (e.g., `'ORPHAN_RECOVERED'`) if debug visibility becomes necessary — that is a D-15 widening analogous to OQ-1.

2. **sysins:local:* key constants stay in sync-state.ts.** Moving them to `constants.ts` now would expose them globally before any consumer needs them. Phase 5's popup will read `SYNC_STATUS_KEY` — at that point we can re-evaluate. Keeping the surface minimal in Phase 1 is correct.

3. **Phase 1 boundary discipline.** `src/background/index.ts` registers only the `onInstalled` listener. Phase 2 adds `onMessage`, Phase 3 adds `onChanged` and `alarms`, Phase 4 adds tab messaging. This keeps each phase's scope clean and reviewable.

## Pattern S-4: _resetForTesting Canonical SW-Restart Seam

The `_resetForTesting()` export is now the canonical pattern for simulating SW kill+wake in Vitest. Phase 2/3/4 plans should follow the same pattern for any module that holds in-memory state:

```typescript
let inMemoryState = { ...initial };

export function _resetForTesting(): void {
  inMemoryState = { ...initial };
}
```

Call `_resetForTesting()` (and `fakeBrowser.reset()`) in `beforeEach` to guarantee isolated test state. Never use `vi.resetModules()` — it invalidates the `fakeBrowser` polyfill.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/background/meta-bootstrap.ts | FOUND |
| src/background/sync-state.ts | FOUND |
| src/background/index.ts | FOUND |
| src/background/service-worker.test.ts | FOUND |
| Commit 871a220 (feat meta-bootstrap + sync-state) | FOUND |
| Commit 0185012 (feat index.ts) | FOUND |
| Commit 019359b (test service-worker) | FOUND |
| npx tsc --noEmit | PASS |
| npx vitest run service-worker.test.ts | 8/8 PASS |

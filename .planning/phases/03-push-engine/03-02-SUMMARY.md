---
phase: 03-push-engine
plan: "02"
subsystem: push-engine
tags: [tdd, diff-algorithm, uuid-assignment, chunking, pending-write]
dependency_graph:
  requires:
    - 03-01 (PENDING_WRITE_KEY, FLUSH_ALARM_NAME constants)
    - src/background/registry.ts (getRegistry)
    - src/background/sync-state.ts (readLastPushed, SYNC_PENDING_KEY)
    - src/background/hash.ts (shortHash)
    - src/background/storage-layout.ts (splitIntoChunks)
  provides:
    - diffAndAccumulate (consumed by message-handler.ts in Plan 03-04)
    - drainPendingWrite, clearPendingWrite (consumed by alarm-flush.ts in Plan 03-03)
    - persistPendingWrite (internal + available for Plan 03-03)
  affects:
    - chrome.storage.local (PENDING_WRITE_KEY, SYNC_PENDING_KEY writes)
tech_stack:
  added: []
  patterns:
    - TDD RED→GREEN cycle with fakeBrowser
    - Batched chrome.storage.local.set() (Hard Rule 3)
    - Title→UUID reverse lookup (live entries only)
    - Unknown-field preservation via rest spread (PUSH-06)
key_files:
  created:
    - src/background/push-engine.ts
    - src/background/push-engine.test.ts
  modified: []
decisions:
  - Tombstoned items excluded from title→uuid lookup; reappearing title gets fresh UUID (T-03-02-c accept disposition)
  - Empty payload returns immediately without writing — Hard Rule 4 / PUSH-05
  - logging only emits item counts, never instruction text (T-03-02-b mitigation)
  - bodyWriteMap duplicated from registry.ts as per plan pattern — extraction deferred
metrics:
  duration: "~2 min"
  completed_date: "2026-05-06"
  tasks: 1
  files: 2
---

# Phase 03 Plan 02: Push Engine Diff Algorithm Summary

Push engine implemented via TDD: `diffAndAccumulate` diffs incoming `RawInstruction[]` against the live registry and last-pushed snapshot, assigns UUIDs, chunks bodies > 7 KB, and accumulates the full `chrome.storage.sync` batch into `chrome.storage.local` for survival across service-worker kills.

## What Was Built

**`src/background/push-engine.ts`** — 4 exported functions:

- `diffAndAccumulate(payload)` — core diff engine; detects new/changed/deleted/unchanged items, assigns UUIDs, builds pendingWrite batch
- `persistPendingWrite(batch)` — batched `chrome.storage.local.set` of PENDING_WRITE_KEY + SYNC_PENDING_KEY sentinel
- `drainPendingWrite()` — reads pending batch from local storage, returns null if absent
- `clearPendingWrite()` — removes PENDING_WRITE_KEY + SYNC_PENDING_KEY after successful flush

**`src/background/push-engine.test.ts`** — 14 tests covering all 8 behavior cases:
1. New item: fresh UUID assigned, registry + body written to pendingWrite
2. Unchanged item: no pendingWrite written when titleHash + bodyHash match
3. Text changed: updated registry + new body chunk written
4. Tombstone: items absent from payload get `deletedAt = now`
5. Chunked body: 10 KB text produces c0 + c1 chunks, registry.chunks = 2
6. Empty payload guard: returns immediately, no writes, no tombstones
7. Tombstoned stability: title matching tombstone gets fresh UUID, tombstone preserved
8. Unknown fields: rest-spread preserves `customField`, `nested` in body JSON

Plus: persistPendingWrite/drain/clear helper tests and UUID stability test.

## TDD Gate Compliance

- RED gate: commit `f8d2815` — `test(03-02): add failing tests for push-engine TDD RED`
- GREEN gate: commit `c93a2d4` — `feat(03-02): implement push-engine diffAndAccumulate TDD GREEN`
- REFACTOR: no changes needed — code was clean on GREEN

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `src/background/push-engine.ts` exists and exports 4 functions
- [x] `src/background/push-engine.test.ts` exists with 14 tests
- [x] All 69 tests pass (55 prior + 14 new)
- [x] `tsc --noEmit` exits 0
- [x] RED commit exists: `f8d2815`
- [x] GREEN commit exists: `c93a2d4`

## Self-Check: PASSED

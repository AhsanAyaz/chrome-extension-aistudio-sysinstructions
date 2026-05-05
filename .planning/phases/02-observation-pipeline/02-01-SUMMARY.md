---
phase: 02-observation-pipeline
plan: "01"
subsystem: shared
tags: [types, constants, guard, tdd, pure-function]
dependency_graph:
  requires: [01-foundation]
  provides: [RawInstruction, LastObservedSnapshot, LAST_OBSERVED_KEY, WATCHED_LS_KEY, isValidPayload]
  affects: [02-02-message-handler, 02-03-injector-content-script, 03-push-engine]
tech_stack:
  added: []
  patterns: [pure-function-guard, explicit-vitest-imports, tdd-red-green]
key_files:
  created:
    - src/shared/guard.ts
    - src/shared/guard.test.ts
  modified:
    - src/shared/types.ts
    - src/shared/constants.ts
decisions:
  - isValidPayload extracted as shared pure function (OQ-2 resolution) — testable without DOM setup, reusable by Phase 3 push engine
  - LAST_OBSERVED_KEY uses string literal form not template literal — matches META_KEY style, value visible at a glance
  - RawInstruction follows BodyPayload index-signature convention — [unknownAiStudioField: string]: unknown preserves unknown fields verbatim
metrics:
  duration_min: 3
  completed_date: "2026-05-05"
  tasks_completed: 2
  files_changed: 4
---

# Phase 2 Plan 01: Shared Types, Constants, and isValidPayload Guard — Summary

**One-liner:** Pure-function `isValidPayload` guard (PUSH-05/D-07) plus `RawInstruction`, `LastObservedSnapshot` types and `LAST_OBSERVED_KEY`, `WATCHED_LS_KEY` constants for the observation pipeline.

## What Was Built

Four files were created or modified to provide the shared foundation that Phase 2 Plans 02 and 03 depend on:

1. **`src/shared/guard.ts`** — `isValidPayload(value: string): boolean` pure function. Wraps `JSON.parse` in try/catch, returns `true` only for non-empty JSON arrays. Enforces Hard Rule #4 (D-07/PUSH-05): null/missing/empty localStorage reads are detection failures, never forwarded as `LS_CHANGED`.

2. **`src/shared/guard.test.ts`** — 6 Vitest unit tests covering: null JSON, empty array, non-array object, bare string JSON value, invalid JSON, valid non-empty array. All 6 pass.

3. **`src/shared/types.ts`** — Added `RawInstruction` (title, text, index signature) and `LastObservedSnapshot` (lastObservedAt, itemCount, items) interfaces.

4. **`src/shared/constants.ts`** — Added `LAST_OBSERVED_KEY = 'sysins:local:lastObserved'` and `WATCHED_LS_KEY = 'aistudio_all_system_instructions'`.

## TDD Gate Compliance

- RED commit: `60cac86` — `test(02-01): add failing tests for isValidPayload guard (TDD RED)`
- GREEN commit: `d1d4386` — `feat(02-01): implement isValidPayload guard function (TDD GREEN)`
- No REFACTOR needed — implementation is minimal and clean.

## Commits

| Hash | Message |
|------|---------|
| db4b322 | feat(02-01): add RawInstruction, LastObservedSnapshot types and LAST_OBSERVED_KEY, WATCHED_LS_KEY constants |
| 60cac86 | test(02-01): add failing tests for isValidPayload guard (TDD RED) |
| d1d4386 | feat(02-01): implement isValidPayload guard function (TDD GREEN) |

## Decisions Made

1. **isValidPayload extracted as shared pure function (OQ-2 resolution):** Inlining the guard in the content script would require DOM test setup. A shared pure function is testable with plain Vitest and reusable by the Phase 3 push engine (same null/empty guard applies to the polling path).

2. **LAST_OBSERVED_KEY uses string literal form:** `'sysins:local:lastObserved'` not a template literal like `sync-state.ts` uses. Matches the `META_KEY = 'sysins:meta'` style — value visible at a glance without evaluation.

3. **RawInstruction follows BodyPayload index-signature convention:** `[unknownAiStudioField: string]: unknown` is the established pattern in this codebase (BodyPayload line 25). Preserves unknown AI Studio fields verbatim per D-08/PUSH-06.

## Phase 3 Note

`LAST_OBSERVED_KEY` is the Phase 2/3 transition artifact. Phase 2's `onMessage` stub writes to this key; Phase 3's push engine reads it as the initial diff baseline. Once Phase 3 runs a successful push, `sysins:local:lastPushed` (D-12) supersedes it.

## Verification Results

- `npm run test -- --run`: **52/52 tests pass** (6 new guard tests + 46 Phase 1 tests, no regressions)
- `npx tsc --noEmit`: **exits 0, no errors**

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — all exports are fully implemented and tested.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes were introduced. The `isValidPayload` guard addresses threat T-02-01 (Tampering via malformed JSON) as specified in the plan's threat model: `JSON.parse` is wrapped in try/catch, malformed input returns `false` without throwing.

## Self-Check: PASSED

- src/shared/guard.ts: FOUND
- src/shared/guard.test.ts: FOUND
- src/shared/types.ts (RawInstruction): FOUND
- src/shared/constants.ts (LAST_OBSERVED_KEY): FOUND
- Commit db4b322: FOUND
- Commit 60cac86: FOUND
- Commit d1d4386: FOUND

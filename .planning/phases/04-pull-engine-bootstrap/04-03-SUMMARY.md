---
phase: "04"
plan: "03"
subsystem: background/pull-engine
tags: [pull-engine, tdd, chrome.storage.onChanged, APPLY_REMOTE, pendingRemote, D-04]
dependency_graph:
  requires: ["04-02"]
  provides: ["handleRemoteChanged", "deliverToTab"]
  affects: ["04-04", "04-05", "04-06"]
tech_stack:
  added: []
  patterns:
    - "TDD RED/GREEN/REFACTOR cycle"
    - "chrome.storage.onChanged guard pattern (areaName + key presence)"
    - "deliverToTab with pendingRemote fallback (Pitfall 2)"
    - "D-04 infinite loop guard via updateLastPushed after delivery"
    - "mockImplementation as any for chrome.tabs overload disambiguation"
key_files:
  created:
    - src/background/pull-engine.ts
    - src/background/pull-engine.test.ts
decisions:
  - "updateLastPushed implemented inline in pull-engine.ts using chrome.storage.local.set directly — no export needed from alarm-flush.ts (simplest approach from plan)"
  - "mockTabsQuery() helper extracted in test file to handle chrome.tabs.query overload ambiguity (void vs Promise overload) — uses mockImplementation with 'as any' cast"
  - "T-04-03-04: console.log emits item count only, never instruction titles or text — consistent with push-engine pattern"
metrics:
  duration: "~5 min"
  completed: "2026-05-06T10:54:04Z"
  tasks_completed: 3
  files_modified: 2
---

# Phase 4 Plan 03: Pull Engine (handleRemoteChanged) Summary

**One-liner:** Pull engine TDD — handleRemoteChanged merges remote registry via applyRemote, updates D-04 lastPushed guard, and delivers APPLY_REMOTE to active AI Studio tab or enqueues in pendingRemote.

## What Was Built

### src/background/pull-engine.ts

Exported `handleRemoteChanged(changes, areaName)` — the handler wired to `chrome.storage.onChanged` in the next plan (04-04/index.ts wiring):

1. **Guard layer:** returns early on `areaName !== 'sync'` or `REGISTRY_KEY` absent from changes or `newValue === undefined`
2. **applyRemote(remoteRegistry)** — delegates to registry.ts for tombstone-wins + last-write-wins merge
3. **reconstructInstructions()** — retrieves live (non-tombstoned) items sorted by `updatedAt` desc
4. **updateLastPushed(merged)** — private helper that builds `LastPushedSnapshot` hashes and writes `LAST_PUSHED_KEY` to `chrome.storage.local` (D-04 infinite loop guard)
5. **deliverToTab(payload)** — queries active aistudio.google.com tabs; on success sends `APPLY_REMOTE` message; on no-tab or sendMessage throw writes `PENDING_REMOTE_KEY` to local storage

### src/background/pull-engine.test.ts

6 test cases covering PULL-01 through PULL-05:

| Case | Behavior | Result |
|------|----------|--------|
| 1 | areaName='local' guard | no-op, applyRemote not called |
| 2 | REGISTRY_KEY absent guard | no-op |
| 3 | Happy path — active tab | APPLY_REMOTE sent, PENDING_REMOTE_KEY not written |
| 4 | No active tab | PENDING_REMOTE_KEY written with payload + enqueuedAt |
| 5 | sendMessage throws | falls through to PENDING_REMOTE_KEY path |
| 6 | D-04 loop guard | LAST_PUSHED_KEY written after delivery |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (`test(...)`) | eb7dca5 | Confirmed — tests failed (pull-engine.ts absent) |
| GREEN (`feat(...)`) | a994b31 | Confirmed — all 6 tests passed |
| REFACTOR (`refactor(...)`) | 3908aa3 | Confirmed — TS errors fixed, tests still pass |

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| RED | Failing test cases for pull-engine | eb7dca5 | src/background/pull-engine.test.ts |
| GREEN | pull-engine.ts implementation | a994b31 | src/background/pull-engine.ts |
| REFACTOR | Fix chrome.tabs overload TS errors in tests | 3908aa3 | src/background/pull-engine.test.ts |

## Verification

- `npx vitest run src/background/pull-engine.test.ts` → 6 passed
- `npx vitest run` → 86 passed (11 test files, no regressions)
- `npx tsc --noEmit` → exit 0 (clean)
- `grep "handleRemoteChanged" src/background/pull-engine.ts` → exported function present
- `grep "PENDING_REMOTE_KEY" src/background/pull-engine.ts` → usage in deliverToTab confirmed
- `grep "LAST_PUSHED_KEY" src/background/pull-engine.ts` → usage in updateLastPushed confirmed
- `grep "fakeBrowser.storage.sync.set" src/background/pull-engine.test.ts` → 4 occurrences (correct pull simulation pattern)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript overload ambiguity on chrome.tabs.query mock**
- **Found during:** REFACTOR (after GREEN)
- **Issue:** `chrome.tabs.query` has a `void`-returning callback overload; `mockResolvedValue(tabs)` triggered TS2345 on all 4 test cases using it
- **Fix:** Extracted `mockTabsQuery()` helper using `mockImplementation(() => Promise.resolve(tabs)) as any`; same pattern applied to `sendMessage` spies
- **Files modified:** src/background/pull-engine.test.ts
- **Commit:** 3908aa3

## Known Stubs

None — pull-engine.ts has full runtime behavior. PENDING_REMOTE_KEY is written for real; content script consumption is implemented in plan 04-05 (content script wiring).

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries beyond what the plan's threat model already covers (T-04-03-01 through T-04-03-05 all addressed in implementation).

## Self-Check: PASSED

- src/background/pull-engine.ts exists with exported `handleRemoteChanged`
- src/background/pull-engine.test.ts exists with 6 test cases
- Commits eb7dca5, a994b31, 3908aa3 confirmed in git log
- `npx tsc --noEmit` exits 0
- 86 tests pass across full suite

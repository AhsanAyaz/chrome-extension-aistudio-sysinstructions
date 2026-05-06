---
phase: "03-push-engine"
plan: "04"
subsystem: "service-worker"
tags: ["push-engine", "alarm-flush", "wiring", "message-handler", "tdd"]
dependency_graph:
  requires: ["03-02", "03-03"]
  provides: ["full-push-pipeline"]
  affects: ["src/background/message-handler.ts", "src/background/index.ts"]
tech_stack:
  added: []
  patterns: ["alarm-debounce-listener", "guard-on-alarm-name", "empty-payload-guard"]
key_files:
  created: []
  modified:
    - src/background/message-handler.ts
    - src/background/index.ts
    - src/background/message-handler.test.ts
decisions:
  - "D-03 enforcement: ensureInitialized chain confirmed correct — handleLsChanged Phase 3 writes a fresh SYNC_PENDING_KEY sentinel, so D-03 test updated to verify orphan is replaced (not absent)"
  - "payload.length > 0 guard placed around scheduleFlush — diffAndAccumulate returns early on empty; no alarm needed"
  - "T-03-04-b: alarm.name !== FLUSH_ALARM_NAME guard in onAlarm listener — spurious alarms are a no-op"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-05-06"
  tasks_completed: 1
  files_modified: 3
---

# Phase 3 Plan 04: Wire Push Engine into Service Worker Summary

**One-liner:** Wired LS_CHANGED → diffAndAccumulate → scheduleFlush → onAlarm → flushPendingWrite completing the full push pipeline with alarm-gated debounce.

## What Was Built

Replaced the Phase 2 `handleLsChanged` stub with a Phase 3 implementation that delegates to `diffAndAccumulate` (push-engine) and `scheduleFlush` (alarm-flush). Registered the `chrome.alarms.onAlarm` listener inside `defineBackground` in `index.ts` to close the pipeline — when the 'sysins-flush' alarm fires, `flushPendingWrite` runs the batched `chrome.storage.sync.set`.

The full push path is now live end-to-end:

```
AI Studio edit → localStorage.setItem patch (MAIN-world)
  → postMessage → content script relay → chrome.runtime.sendMessage
  → SW onMessage → ensureInitialized → handleLsChanged
  → diffAndAccumulate (build pendingWrite batch, persist to local)
  → scheduleFlush (30s debounce alarm)
  → onAlarm('sysins-flush') → flushPendingWrite → chrome.storage.sync.set
```

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Replace handleLsChanged stub; register onAlarm listener | 4c71c12 | message-handler.ts, index.ts, message-handler.test.ts |

## Verification

- `npx tsc --noEmit` exits 0 (clean)
- `npm run test -- --run` exits 0 — 79/79 tests pass
- `npx wxt build` exits 0 — 13.96 kB output
- All acceptance criteria grep checks pass:
  - `diffAndAccumulate` present in message-handler.ts (import + body)
  - `scheduleFlush` present in message-handler.ts (import + body)
  - `onAlarm` present in index.ts (listener registered)
  - `flushPendingWrite` present in index.ts (inside onAlarm handler)
  - `FLUSH_ALARM_NAME` present in index.ts (guard condition)
  - No `.text` field access in message-handler.ts executable code (T-03-04-a)
  - `LAST_OBSERVED_KEY` absent from message-handler.ts (Phase 2 stub fully replaced)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated D-03 test to match Phase 3 pendingWrite behavior**
- **Found during:** Task 1 GREEN phase
- **Issue:** The Phase 2 D-03 test expected `SYNC_PENDING_KEY` to be undefined after `handleLsChanged`. In Phase 3, `diffAndAccumulate → persistPendingWrite` legitimately writes a fresh `SYNC_PENDING_KEY` sentinel. The test expectation was wrong for Phase 3.
- **Fix:** Updated D-03 test to assert that the orphan sentinel is *replaced* by a fresh non-orphan sentinel (different batchId, recent startedAt). This correctly verifies orphan recovery while accommodating Phase 3 pendingWrite behavior.
- **Files modified:** `src/background/message-handler.test.ts`
- **Commit:** 4c71c12

**2. [Rule 2 - Missing] Removed Phase 2 snapshot tests that no longer apply**
- **Found during:** Task 1 — Phase 2 tests checked `LAST_OBSERVED_KEY` writes and `LastObservedSnapshot` shape. The Phase 3 implementation no longer writes that key.
- **Fix:** Replaced Phase 2 tests with Phase 3 wiring tests (alarm scheduling, pendingWrite presence, empty-payload guard). The Phase 2 behavior is superseded by Phase 3 design.
- **Files modified:** `src/background/message-handler.test.ts`
- **Commit:** 4c71c12

## Known Stubs

None — the pipeline is fully wired. No placeholder data sources.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes beyond what the plan's threat model covers.

## Self-Check: PASSED

- `src/background/message-handler.ts` exists with `diffAndAccumulate` and `scheduleFlush`
- `src/background/index.ts` exists with `onAlarm` listener and `FLUSH_ALARM_NAME` guard
- `src/background/message-handler.test.ts` exists with Phase 3 wiring tests
- Commit `4c71c12` exists in git log

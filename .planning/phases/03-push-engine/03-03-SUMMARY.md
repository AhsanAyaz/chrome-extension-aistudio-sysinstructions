---
phase: 03-push-engine
plan: "03"
subsystem: alarm-flush
tags: [tdd, alarms, debounce, sync-write, badge, error-surfacing]
dependency_graph:
  requires:
    - 03-01 (FLUSH_ALARM_NAME, PENDING_WRITE_KEY constants)
    - 03-02 (drainPendingWrite, clearPendingWrite from push-engine)
    - 01-foundation (sync-state: writeSyncStatus, setErrorState, LAST_PUSHED_KEY)
  provides:
    - scheduleFlush (debounce alarm scheduling — used by index.ts Plan 04)
    - flushPendingWrite (onAlarm handler — wired in index.ts Plan 04)
  affects:
    - chrome.storage.sync (single batched write — PUSH-03)
    - chrome.storage.local (lastPushed, syncStatus, pendingWrite cleared on success)
    - chrome.action badge (amber on rate-limit, red on quota/other, cleared on success)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN cycle
    - chrome.alarms debounce (clear().then(create)) — Promise pattern, not callback
    - Single batched chrome.storage.sync.set (Hard Rule 3 / PUSH-03)
    - fakeBrowser vi.spyOn mock for chrome.action (not implemented in fake-browser)
key_files:
  created:
    - src/background/alarm-flush.ts
    - src/background/alarm-flush.test.ts
  modified: []
decisions:
  - "Promise pattern for alarms.clear() — fakeBrowser alarms.clear() returns a Promise and does not invoke legacy callbacks; void clear().then(create) is the correct pattern"
  - "flushPendingWrite called directly in tests — onAlarm listener binding is index.ts responsibility (Plan 04); unit tests call the exported function directly"
  - "chrome.action stubbed with vi.spyOn().mockResolvedValue(undefined) — fakeBrowser does not implement setBadgeText/setBadgeBackgroundColor; explicit mock required"
metrics:
  duration: "~7 minutes"
  completed_date: "2026-05-06"
  tasks_completed: 3
  files_created: 2
  files_modified: 0
---

# Phase 03 Plan 03: Alarm Flush Summary

**One-liner:** Alarm debounce + single batched chrome.storage.sync.set with amber/red badge error surfacing via TDD RED/GREEN cycle.

## What Was Built

`alarm-flush.ts` implements two exported functions:

- **`scheduleFlush()`** — debounce-schedules the `sysins-flush` alarm. Each call clears the existing alarm then recreates it (30s window), so a burst of LS_CHANGED events collapses to a single flush. Uses `chrome.alarms.clear().then(create)` Promise pattern (SW-kill safe per PUSH-07).

- **`flushPendingWrite()`** — called by the `onAlarm` listener (wired in Plan 04). Drains the pending batch from `chrome.storage.local`, removes stale body chunks (T-03-03-e), issues a single `chrome.storage.sync.set(batch)` (PUSH-03), then writes the `lastPushed` snapshot, clears `pendingWrite`, and sets `syncStatus` to idle. On failure: sets amber badge + `RATE_LIMITED` + retry alarm (rate-limit), or red badge + `QUOTA_EXCEEDED`/`STRICT_VALIDATION_FAIL` (no retry).

## TDD Gate Compliance

- RED commit: `57949dd` — `test(03-03): add failing tests for alarm-flush TDD RED`
- GREEN commit: `8ef0c9b` — `feat(03-03): implement alarm-flush scheduleFlush and flushPendingWrite TDD GREEN`
- REFACTOR: not needed — implementation was clean at GREEN

All 8 behavior cases covered by tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Promise pattern for alarms.clear() instead of callback**
- **Found during:** Task GREEN (tests failing — alarm not created)
- **Issue:** Plan specified `chrome.alarms.clear(name, callback)` but fakeBrowser's `alarms.clear` returns a Promise and ignores the legacy callback argument. The alarm was never created in tests (or in production Chrome MV3 which also prefers Promise API).
- **Fix:** Changed to `void chrome.alarms.clear(FLUSH_ALARM_NAME).then(() => { chrome.alarms.create(...) })`
- **Files modified:** `src/background/alarm-flush.ts`
- **Commit:** `8ef0c9b`

**2. [Rule 1 - Bug] Test Case 4 used alarm trigger instead of direct function call**
- **Found during:** Task GREEN (Case 4 failing — sync.set not called)
- **Issue:** Test triggered `fakeBrowser.alarms.onAlarm.trigger(...)` but `flushPendingWrite` is not registered as an alarm listener in this module — that wiring is Plan 04's responsibility (index.ts). The trigger fired with no listeners attached.
- **Fix:** Changed Case 4 to call `await flushPendingWrite()` directly.
- **Files modified:** `src/background/alarm-flush.test.ts`
- **Commit:** `8ef0c9b`

**3. [Rule 1 - Bug] Implicit `any` type on alarms.getAll() filter callback**
- **Found during:** `tsc --noEmit` after GREEN
- **Issue:** `allAlarms.filter((a) => ...)` — TypeScript inferred `a` as `any` in strict mode.
- **Fix:** Added explicit type annotation `(a: chrome.alarms.Alarm)`.
- **Files modified:** `src/background/alarm-flush.test.ts`
- **Commit:** `8ef0c9b`

**4. [Rule 2 - Missing] chrome.action stubs required for all test cases**
- **Found during:** Task GREEN (Cases 5-8 throwing "not implemented")
- **Issue:** `fakeBrowser` does not implement `chrome.action.setBadgeText` / `setBadgeBackgroundColor`. They throw on any call. Plan mentioned `vi.spyOn` but did not note the need for `.mockResolvedValue(undefined)` to prevent the throw.
- **Fix:** Added global `beforeEach` stubs for both action methods with `mockResolvedValue(undefined)`.
- **Files modified:** `src/background/alarm-flush.test.ts`
- **Commit:** `8ef0c9b`

## Known Stubs

None — all behavior is fully wired and tested.

## Threat Flags

No new network endpoints, auth paths, or trust boundaries introduced beyond those enumerated in the plan's threat model.

## Self-Check: PASSED

- `src/background/alarm-flush.ts` — FOUND
- `src/background/alarm-flush.test.ts` — FOUND
- RED commit `57949dd` — FOUND
- GREEN commit `8ef0c9b` — FOUND
- All 78 tests pass
- `tsc --noEmit` exits 0

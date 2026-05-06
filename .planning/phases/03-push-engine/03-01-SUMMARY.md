---
phase: 03-push-engine
plan: "01"
subsystem: constants
tags: [constants, permissions, alarms, phase3]
dependency_graph:
  requires: []
  provides: [PENDING_WRITE_KEY, FLUSH_ALARM_NAME, alarms-permission]
  affects: [src/background/push-engine.ts, src/background/alarm-flush.ts]
tech_stack:
  added: []
  patterns: [single-source-of-truth constants, D-24]
key_files:
  created: []
  modified:
    - src/shared/constants.ts
    - wxt.config.ts
    - src/build.test.ts
decisions:
  - PENDING_WRITE_KEY uses template literal `${LOCAL_KEY_PREFIX}pendingWrite` to stay DRY with LOCAL_KEY_PREFIX
  - FLUSH_ALARM_NAME is a plain string literal (not a template literal) — alarm names are not namespaced keys
  - build.test.ts permissions assertion updated from ['scripting','storage'] to ['alarms','scripting','storage']
metrics:
  duration: "~3 min"
  completed: "2026-05-06"
  tasks_completed: 1
  files_modified: 3
---

# Phase 03 Plan 01: Constants and Alarms Permission Summary

**One-liner:** Added `PENDING_WRITE_KEY` (`sysins:local:pendingWrite`) and `FLUSH_ALARM_NAME` (`sysins-flush`) to `constants.ts`; added `"alarms"` to manifest permissions to enable `chrome.alarms.create` for push-engine debounce.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add PENDING_WRITE_KEY and FLUSH_ALARM_NAME constants; add alarms permission | dd0aa57 | src/shared/constants.ts, wxt.config.ts, src/build.test.ts |

## Verification

All acceptance criteria met:
- `grep "PENDING_WRITE_KEY" src/shared/constants.ts` → line with `sysins:local:pendingWrite`
- `grep "FLUSH_ALARM_NAME" src/shared/constants.ts` → line with `sysins-flush`
- `grep "alarms" wxt.config.ts` → `permissions: ['storage', 'scripting', 'alarms']`
- `npx tsc --noEmit` → exits 0
- `npm run test -- --run` → 55/55 tests pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated build.test.ts permissions assertion to include 'alarms'**
- **Found during:** Task 1 — running `npm run test -- --run` after the manifest change
- **Issue:** `src/build.test.ts` asserted permissions was exactly `['scripting', 'storage']`; adding `'alarms'` caused this test to fail
- **Fix:** Updated the test description and assertion to expect `['alarms', 'scripting', 'storage']` with a comment referencing PUSH-07
- **Files modified:** src/build.test.ts
- **Commit:** dd0aa57 (included in same commit as the feature changes)

## Known Stubs

None.

## Threat Flags

No new security surface introduced beyond what is documented in the plan's threat model. The `"alarms"` permission grants only timer/scheduling capability — no new data access or network capability.

## Self-Check: PASSED

- [x] `src/shared/constants.ts` exists and contains both new exports
- [x] `wxt.config.ts` contains `'alarms'` in permissions
- [x] Commit dd0aa57 exists in git log
- [x] All 55 tests pass; tsc clean

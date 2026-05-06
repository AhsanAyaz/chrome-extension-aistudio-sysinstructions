---
phase: "04"
plan: "02"
subsystem: shared
tags: [constants, types, phase4, contracts]
dependency_graph:
  requires: ["04-01"]
  provides: ["BOOTSTRAP_NEEDED_KEY", "PENDING_REMOTE_KEY", "ApplyRemoteMessage", "BootstrapMessage", "PendingRemoteState", "BootstrapNeededFlag"]
  affects: ["04-03", "04-04"]
tech_stack:
  added: []
  patterns: ["template-literal storage keys", "typed message contracts"]
key_files:
  modified:
    - src/shared/constants.ts
    - src/shared/types.ts
decisions:
  - "BOOTSTRAP_NEEDED_KEY and PENDING_REMOTE_KEY use template-literal pattern (${LOCAL_KEY_PREFIX}...) consistent with PENDING_WRITE_KEY"
  - "BootstrapNeededFlag is an object with triggeredAt (not boolean) to enable stale-flag detection"
  - "PendingRemoteState.enqueuedAt uses epoch ms to allow age-based pruning"
metrics:
  duration: "~1 min"
  completed: "2026-05-06T10:49:00Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 4 Plan 02: Shared Constants and Types Summary

**One-liner:** Phase 4 storage key constants and message/state type contracts added to the shared layer ahead of TDD implementation plans.

## What Was Built

Two files extended with Phase 4 additions:

**src/shared/constants.ts** — two new exported constants:
- `BOOTSTRAP_NEEDED_KEY = \`${LOCAL_KEY_PREFIX}bootstrapNeeded\`` (D-05) — bootstrap trigger flag key
- `PENDING_REMOTE_KEY = \`${LOCAL_KEY_PREFIX}pendingRemote\`` (D-08) — deferred remote payload key

**src/shared/types.ts** — four new exported interfaces:
- `ApplyRemoteMessage` — SW→CS message carrying merged live `RawInstruction[]`
- `BootstrapMessage` — CS→SW message carrying raw localStorage snapshot
- `PendingRemoteState` — shape of `sysins:local:pendingRemote` storage value
- `BootstrapNeededFlag` — object (not boolean) shape for `sysins:local:bootstrapNeeded`

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Phase 4 constants | 6955e2d | src/shared/constants.ts |
| 2 | Add Phase 4 types | 82ee8cf | src/shared/types.ts |

## Verification

- `grep -c "BOOTSTRAP_NEEDED_KEY\|PENDING_REMOTE_KEY" src/shared/constants.ts` → 2
- `grep -c "ApplyRemoteMessage\|BootstrapMessage\|PendingRemoteState\|BootstrapNeededFlag" src/shared/types.ts` → 4
- `npx tsc --noEmit` → exit 0 (clean)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan adds pure type/constant declarations with no runtime behavior.

## Threat Flags

None — pure type layer, no runtime behavior, no new attack surface.

## Self-Check: PASSED

- src/shared/constants.ts exists and contains BOOTSTRAP_NEEDED_KEY and PENDING_REMOTE_KEY
- src/shared/types.ts exists and contains all four Phase 4 interfaces
- Commits 6955e2d and 82ee8cf verified in git log

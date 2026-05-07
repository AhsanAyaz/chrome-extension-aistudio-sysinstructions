---
quick_id: 260507-b8k
type: quick-fix
completed: "2026-05-07"
duration_min: ~10
tasks_completed: 3
files_changed: 4
commits:
  - 2239ea5
  - edb5bd2
  - 45c9266
---

# Quick Task 260507-b8k: Fix cross-device tombstone on separate push

**One-liner:** Separate push-flush baseline (PUSH_BASELINE_KEY) from the pull loop-guard (LAST_PUSHED_KEY) so pulled remote items are never tombstoned on device A's next push.

## Root Cause

`LAST_PUSHED_KEY` was written by both push flush and pull update. After a pull, device A's `LAST_PUSHED_KEY` contained device B's items. On the next push, `diffAndAccumulate` saw those items in `lastPushed` but absent from the local payload → tombstoned them, wiping device B's data.

## Fix

Introduced `PUSH_BASELINE_KEY = 'sysins:local:pushBaseline'` written **only** by `writeLastPushed` in alarm-flush.ts. `diffAndAccumulate` now uses `pushBaseline` (not `lastPushed`) for tombstone eligibility. `lastPushed` (LAST_PUSHED_KEY) continues to serve as the unchanged-hash dedup check, which the pull engine also writes to.

## Invariant After Fix

- `LAST_PUSHED_KEY` — written by push flush AND pull update → loop guard / unchanged dedup only
- `PUSH_BASELINE_KEY` — written ONLY by push flush → tombstone eligibility baseline
- `pendingRegistry` — current burst accumulation → also tombstone-eligible

## Tasks

| Task | Files | Commit |
|------|-------|--------|
| 1: Add PUSH_BASELINE_KEY constant and readPushBaseline | src/shared/constants.ts, src/background/sync-state.ts | 2239ea5 |
| 2: Write PUSH_BASELINE_KEY on flush (batched with LAST_PUSHED_KEY) | src/background/alarm-flush.ts | edb5bd2 |
| 3: Use pushBaseline for tombstone eligibility; update Case 4 test | src/background/push-engine.ts, src/background/push-engine.test.ts | 45c9266 |

## Verification

- All 126 tests pass
- TypeScript compiles clean (npx tsc --noEmit exits 0)
- Case 4 seeds PUSH_BASELINE_KEY alongside LAST_PUSHED_KEY
- Items that arrived via pull only are no longer tombstone-eligible on next push

## Deviations

None — plan executed exactly as written.

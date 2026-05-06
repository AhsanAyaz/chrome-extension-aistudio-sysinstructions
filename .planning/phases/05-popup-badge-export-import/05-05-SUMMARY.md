---
phase: "05"
plan: "05"
subsystem: sw-message-handlers
tags: [service-worker, message-handlers, badge, push-now, pull-now, import-items]
dependency_graph:
  requires: [05-02, 05-03, 05-04]
  provides: [PUSH_NOW-handler, PULL_NOW-handler, IMPORT_ITEMS-handler, pull-success-badge-clear]
  affects: [src/background/index.ts, src/background/pull-engine.ts]
tech_stack:
  added: []
  patterns: [fire-and-forget-onMessage, fake-onChanged-for-pull-now, badge-clear-on-pull-success]
key_files:
  created: []
  modified:
    - src/background/index.ts
    - src/background/pull-engine.ts
decisions:
  - "IMPORT_ITEMS handler calls flushPendingWrite directly (not scheduleFlush) — import is a user-explicit action, should flush immediately per RESEARCH.md OQ-2 recommendation"
  - "Badge clear on pull success added to pull-engine.ts (not alarm-flush.ts) — mirrors the flushPendingWrite success path; writeSyncStatus also added for state consistency"
  - "pull-engine.ts also calls writeSyncStatus({ state: 'idle' }) after successful pull — pull path had no idle writeback previously, leaving syncStatus stale after PULL_NOW"
metrics:
  duration: "~2 min"
  completed: "2026-05-06"
  tasks_completed: 2
  files_changed: 2
---

# Phase 05 Plan 05: SW Message Handlers + Badge Clear Summary

Wire PUSH_NOW, PULL_NOW, and IMPORT_ITEMS message handlers into the existing onMessage listener in index.ts, and add the healthy-state badge clear to pull-engine.ts for the pull success path.

## What Was Built

**src/background/index.ts** — Three new Phase 5 message handlers added inside the `chrome.runtime.onMessage.addListener` callback:

1. **PUSH_NOW** (UI-03): Fire-and-forget. Chains `ensureInitialized().then(() => flushPendingWrite())`. Bypasses the 30s debounce alarm — direct flush on user demand. Returns `false` (D-04).

2. **PULL_NOW** (UI-04): Fire-and-forget. Reads current `sysins:registry` from `chrome.storage.sync`, constructs a fake `onChanged` changes object with that value as `newValue`, then calls `handleRemoteChanged(fakeChanges, 'sync')` — re-triggering the full pull path including `applyRemote`, `reconstructInstructions`, `updateLastPushed`, and `deliverToTab`. Returns `false` (D-04).

3. **IMPORT_ITEMS** (EXPORT-02): Fire-and-forget. Validates `Array.isArray(message.payload)` (T-05-05-01 mitigation), then chains `ensureInitialized() → diffAndAccumulate(payload) → flushPendingWrite()`. Routes imported items through the standard merge path — UUID assignment, conflict resolution, and chunking all happen in `diffAndAccumulate`. Returns `false` (D-04).

**New import:** `diffAndAccumulate` from `./push-engine` added at the top of `index.ts`.

**src/background/pull-engine.ts** — Two additions to `handleRemoteChanged` success path (after `deliverToTab`):

- `writeSyncStatus({ state: 'idle', lastSyncAt: now })` — previously the pull engine never wrote idle status; popup's `chrome.storage.onChanged` subscription would never see a state transition after PULL_NOW completed.
- `chrome.action.setBadgeText({ text: '' })` + `setBadgeBackgroundColor({ color: '#000000' })` — clears any prior error badge to the healthy empty state (D-06). Mirrors the same calls in `alarm-flush.ts` `flushPendingWrite` success path.

**Import added:** `writeSyncStatus` imported alongside the existing `LAST_PUSHED_KEY` import from `./sync-state`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] writeSyncStatus not called on pull success path**
- **Found during:** Task 2
- **Issue:** Plan specified adding `setBadgeText({ text: '' })` to pull-engine. On inspection, `handleRemoteChanged` also never called `writeSyncStatus({ state: 'idle', ... })` — the popup's live `chrome.storage.onChanged` subscription would never receive a state transition after PULL_NOW completed successfully. This is a missing correctness requirement for popup reactivity (D-05).
- **Fix:** Added both `writeSyncStatus({ state: 'idle', lastSyncAt: now })` and badge clear calls together on the pull success path.
- **Files modified:** `src/background/pull-engine.ts`
- **Commit:** 924c280

**Note on files_modified:** Plan listed only `src/background/alarm-flush.ts` and `src/background/index.ts`. Task 2 required modifying `src/background/pull-engine.ts` instead (as anticipated in the plan's note: "This task may also modify pull-engine.ts if the badge clear is missing"). The alarm-flush.ts already had `setBadgeText({ text: '' })` on its own success path and needed no changes.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The IMPORT_ITEMS handler includes the `Array.isArray(message.payload)` guard as specified in threat T-05-05-01.

## Known Stubs

None — all handlers are fully wired to live engine functions.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/background/index.ts has PUSH_NOW handler | FOUND (line 109) |
| src/background/index.ts has PULL_NOW handler | FOUND (line 117) |
| src/background/index.ts has IMPORT_ITEMS handler | FOUND (line 132) |
| diffAndAccumulate imported in index.ts | FOUND (line 12) |
| All three handlers return false | FOUND (lines 111, 125, 133, 137) |
| pull-engine.ts has setBadgeText({ text: '' }) | FOUND (line 91) |
| Task 1 commit 238aad1 exists | FOUND |
| Task 2 commit 924c280 exists | FOUND |
| npx tsc --noEmit exits 0 | PASS |
| npx vitest run: 126 tests pass | PASS |

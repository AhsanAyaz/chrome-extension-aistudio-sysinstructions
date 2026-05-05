---
phase: 02-observation-pipeline
plan: "02"
subsystem: background/service-worker
tags: [message-handler, onMessage, tdd, snapshot, chrome-storage-local]
dependency_graph:
  requires: [02-01-shared-types-constants-guard]
  provides: [handleLsChanged, LS_CHANGED-onMessage-listener, sysins:local:lastObserved]
  affects: [02-03-injector-content-script, 03-push-engine]
tech_stack:
  added: []
  patterns: [fakeBrowser-unit-tests, return-true-async-onMessage, ensureInitialized-chain]
key_files:
  created:
    - src/background/message-handler.ts
    - src/background/message-handler.test.ts
  modified:
    - src/background/index.ts
decisions:
  - "OQ-3 resolved: return true + sendResponse({ ok }) pattern chosen — closes port cleanly, no console warnings about closed message ports"
  - "D-03 enforcement: ensureInitialized() chained before handleLsChanged on every LS_CHANGED wake — orphan recovery guaranteed on SW restart"
  - "Payload stored verbatim in snapshot (D-08 / PUSH-06) — no field stripping at observation layer; Phase 3 ingest validation guards the sync boundary"
metrics:
  duration_min: 2
  completed_date: "2026-05-05"
  tasks_completed: 2
  files_changed: 3
---

# Phase 2 Plan 02: SW onMessage Stub and lastObserved Snapshot — Summary

**One-liner:** `handleLsChanged` writes `sysins:local:lastObserved` snapshots verbatim (PUSH-06); `chrome.runtime.onMessage` listener chains `ensureInitialized` + `handleLsChanged` with `return true` for async port discipline.

## What Was Built

Three files were created or modified to complete the Phase 2 SW observation endpoint:

1. **`src/background/message-handler.ts`** — `handleLsChanged(payload: RawInstruction[]): Promise<void>`. Logs receipt to SW console, builds a `LastObservedSnapshot` with `Date.now()`, and writes it to `chrome.storage.local` under `sysins:local:lastObserved`. Items are stored verbatim — no field stripping (D-08/PUSH-06).

2. **`src/background/message-handler.test.ts`** — 3 fakeBrowser unit tests:
   - Snapshot shape: `itemCount`, `items` length, and `lastObservedAt > 0` verified (D-01, D-02)
   - Unknown-field passthrough: `extraField` and `nestedExtra` preserved verbatim (PUSH-06)
   - D-03 sequence: planting an orphaned `syncPending` sentinel, running `ensureInitialized()` then `handleLsChanged()`, confirming the sentinel is cleared

3. **`src/background/index.ts`** — Phase 1 boundary comment replaced with Phase 2 `chrome.runtime.onMessage.addListener`. The listener guards on `message?.type === 'LS_CHANGED'`, chains `ensureInitialized().then(handleLsChanged).then(sendResponse({ ok: true }))`, and returns `true` to keep the async port open.

## TDD Gate Compliance

- RED commit: `665daec` — `test(02-02): add failing tests for handleLsChanged (TDD RED)`
- GREEN commit: `6a75f1f` — `feat(02-02): implement handleLsChanged (TDD GREEN)`
- No REFACTOR needed — implementation is minimal and clean.

## Commits

| Hash | Message |
|------|---------|
| 665daec | test(02-02): add failing tests for handleLsChanged (TDD RED) |
| 6a75f1f | feat(02-02): implement handleLsChanged (TDD GREEN) |
| f5e063c | feat(02-02): wire chrome.runtime.onMessage listener in service worker |

## Decisions Made

1. **OQ-3 resolved — return true + sendResponse({ ok }) pattern:** The `onMessage` handler returns `true` inside the `if (message?.type === 'LS_CHANGED')` block to signal an async response is pending. `sendResponse({ ok: true })` is called after the promise chain resolves; `sendResponse({ ok: false, error })` is called on rejection. Unknown message types fall through without calling `sendResponse`, allowing Chrome to close the port immediately (correct behavior per Chrome extension docs).

2. **D-03 enforcement via chain:** `ensureInitialized()` is called before `handleLsChanged()` on every `LS_CHANGED` wake. This guarantees orphan recovery runs whenever the SW is woken by an incoming message — the content script's message is the real-world trigger for a SW wake, so this is the correct insertion point.

3. **Verbatim payload storage:** Items are written to the snapshot without any field stripping. This matches Hard Rule #8 (D-08/PUSH-06) and the `RawInstruction` index signature design. Phase 3's push engine applies `isValidPayload` and ingest validation before any `chrome.storage.sync` write — not here.

## Phase 3 Note

`sysins:local:lastObserved` (written by this plan) is Phase 3's initial diff baseline. When Phase 3's push engine runs its first successful push, it writes `sysins:local:lastPushed` (D-12) and that key supersedes `lastObserved` for subsequent diff cycles.

## Verification Results

- `npm run test -- --run`: **55/55 tests pass** (3 new message-handler tests + 52 prior tests, no regressions)
- `npx tsc --noEmit`: **exits 0, no errors**
- Spot-check: `onMessage.addListener`, `return true`, and `handleLsChanged` all present in `index.ts`

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — `handleLsChanged` is fully implemented and tested. The snapshot written here is intentionally a Phase 2 observation stub; Phase 3 replaces the read path with push logic, but the write itself is complete.

## Threat Surface Scan

The `chrome.runtime.onMessage` listener introduced here crosses the content script → SW trust boundary. The `message?.type === 'LS_CHANGED'` guard (T-02-03) is implemented: unknown message types fall through without processing. T-02-04 (payload stored verbatim) is accepted per plan — no merge decisions are made in Phase 2. No new network endpoints or auth paths introduced.

## Self-Check: PASSED

- src/background/message-handler.ts: FOUND
- src/background/message-handler.test.ts: FOUND
- src/background/index.ts (onMessage.addListener): FOUND
- Commit 665daec: FOUND
- Commit 6a75f1f: FOUND
- Commit f5e063c: FOUND

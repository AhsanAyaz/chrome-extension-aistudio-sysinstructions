---
phase: "04"
plan: "05"
subsystem: wiring
tags: [wiring, content-script, account-preflight, bootstrap, pull-engine, identity]
dependency_graph:
  requires: [04-03, 04-04]
  provides: [full-pull-bootstrap-wiring, account-mismatch-preflight, apply-remote-content-script]
  affects: [src/background/index.ts, src/background/message-handler.ts, src/content/index.ts, wxt.config.ts]
tech_stack:
  added: [chrome.identity.getProfileUserInfo, chrome.storage.onChanged, synthetic StorageEvent]
  patterns: [account-preflight, applyRemoteLocally, visibilitychange-deferred-apply, pageEmail-piggyback]
key_files:
  created:
    - src/background/account-preflight.ts
    - src/background/account-preflight.test.ts
    - src/background/index-phase4.test.ts
    - src/content/content-phase4.test.ts
    - src/shared/types.test.ts
  modified:
    - src/background/index.ts
    - src/background/message-handler.ts
    - src/content/index.ts
    - src/shared/types.ts
    - wxt.config.ts
    - src/build.test.ts
decisions:
  - "identity stub on globalThis used in tests — fakeBrowser does not implement chrome.identity"
  - "extractPageEmail defined locally in content/index.ts to avoid cross-entrypoint import from background/"
  - "handleLsChanged signature extended with optional pageEmail parameter for BOOT-03 pass-through"
  - "build.test.ts permissions assertions updated to include identity + identity.email (D-03 enforcement)"
metrics:
  duration: "~10 min"
  completed: "2026-05-06"
  tasks_completed: 4
  files_changed: 11
---

# Phase 04 Plan 05: Wiring — Pull Engine + Bootstrap + Account Preflight Summary

Phase 4 Plans 03 and 04 built the engines in isolation. Plan 05 connects them all to Chrome's event system, wires the content script delivery paths, and fully delivers BOOT-03 — the account mismatch pre-flight that pauses sync when the Chrome profile differs from the AI Studio signed-in account.

## What Was Built

**account-preflight.ts** — New module with two exports:
- `extractPageEmail(attributeValue)`: parses email from AI Studio's aria-label DOM attribute using the regex confirmed by the BOOT-03 spike (`/\(([^)]+)\)$/`).
- `checkAccountMismatch(pageEmail)`: calls `chrome.identity.getProfileUserInfo`, compares Chrome profile email to page email, calls `setErrorState('ACCOUNT_MISMATCH')` on diff, clears error when emails match. Returns false (skip check) when either side is unavailable.

**src/background/index.ts** — Three Phase 4 additions:
1. `chrome.storage.onChanged` listener: guards `areaName === 'sync'` AND `REGISTRY_KEY in changes`, then chains `ensureInitialized() → handleRemoteChanged()`. Prevents re-pull on own push writes (Pitfall 1 guard).
2. `onInstalled` extended: writes `BOOTSTRAP_NEEDED_KEY: { triggeredAt: Date.now() }` on `reason === 'install'` only (not on update — would re-trigger bootstrap every extension update).
3. `LS_BOOTSTRAP` message case: validates `Array.isArray(payload)`, chains `ensureInitialized() → handleLsBootstrap()`, async response pattern consistent with LS_CHANGED.

**src/background/message-handler.ts** — `handleLsChanged` gains:
- Optional `pageEmail?: string` parameter.
- BOOT-03 guard at top: `checkAccountMismatch(pageEmail)` → early return on mismatch. Existing diff/flush logic unchanged.

**src/content/index.ts** — Five Phase 4 additions:
1. `extractPageEmail` — local copy of the DOM email parser (avoids cross-entrypoint import).
2. `pageEmail` — DOM-scraped once per CS load, cached, piggybacked on all LS_CHANGED and LS_BOOTSTRAP messages.
3. `applyRemoteLocally(instructions)` — writes localStorage + dispatches synthetic `StorageEvent` with `storageArea: localStorage`. Logs count (never content). Hard Rule 8 compliant.
4. `APPLY_REMOTE` handler — synchronous `chrome.runtime.onMessage` listener calling `applyRemoteLocally`.
5. Bootstrap check — reads `BOOTSTRAP_NEEDED_KEY`, sends `LS_BOOTSTRAP` if valid local data present. CS never clears flag.
6. `visibilitychange` handler — reads `PENDING_REMOTE_KEY` on tab focus, applies deferred payload, removes key.
7. Replaced literal `'aistudio_all_system_instructions'` strings with `WATCHED_LS_KEY` constant.

**wxt.config.ts** — Added `'identity'` and `'identity.email'` permissions (both required per SKILL.md Finding 1 — `identity` alone returns empty email; `identity.email` alone leaves `chrome.identity` undefined).

**src/shared/types.ts** — Added `LsChangedMessage` interface (was missing); added `pageEmail?: string` to `LsChangedMessage` and `BootstrapMessage`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing type] LsChangedMessage was absent from types.ts**
- **Found during:** Task 1
- **Issue:** Plan referenced `LsChangedMessage` but the type didn't exist in `types.ts`.
- **Fix:** Added `LsChangedMessage` interface alongside the `pageEmail` addition.
- **Files modified:** `src/shared/types.ts`
- **Commit:** 25cc340

**2. [Rule 1 - Bug] handleLsChanged signature mismatch — index.ts was passing full message**
- **Found during:** Task 2
- **Issue:** During index.ts wiring, the call was accidentally changed to pass `message` instead of `message.payload`. The signature only accepted `RawInstruction[]`.
- **Fix:** Updated `handleLsChanged` signature to accept optional `pageEmail` parameter, passed from index.ts as `(message.payload, message.pageEmail)`.
- **Files modified:** `src/background/message-handler.ts`, `src/background/index.ts`
- **Commit:** 9723c3a

**3. [Rule 1 - Test] build.test.ts permissions assertions failed post-Task 4**
- **Found during:** Final verification
- **Issue:** `build.test.ts` had `identity` in the forbidden permissions list and exact permissions array `['alarms', 'scripting', 'storage']` — both broke when `identity` + `identity.email` were added.
- **Fix:** Updated exact permissions assertion; removed `identity` from forbidden list with comment referencing D-03.
- **Files modified:** `src/build.test.ts`
- **Commit:** 1fb3b29

**4. [Rule 2 - Test infra] fakeBrowser doesn't implement chrome.identity — globalThis stub needed**
- **Found during:** Task 3 test writing
- **Issue:** `vi.spyOn(chrome.identity, 'getProfileUserInfo')` threw "property not defined" because `fakeBrowser` doesn't provide `chrome.identity`.
- **Fix:** Installed a `vi.fn()` stub on `globalThis.chrome.identity` in `beforeEach`. Pattern documented in test file.
- **Files modified:** `src/background/account-preflight.test.ts`
- **Commit:** ab765b3

**5. [Rule 2 - Design] extractPageEmail defined locally in content script**
- **Found during:** Task 4 implementation
- **Issue:** Plan suggested importing `extractPageEmail` from `account-preflight.ts` but noted cross-entrypoint import might fail. WXT bundles each entrypoint independently — importing background/ from content/ would work at build time but is architecturally incorrect (CS should not import SW modules).
- **Fix:** Local copy in `content/index.ts` with comment pointing to SKILL.md. Identical logic.
- **Files modified:** `src/content/index.ts`
- **Commit:** 55a9d1e

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/background/account-preflight.ts exists | FOUND |
| src/content/index.ts updated | FOUND |
| src/background/index.ts updated | FOUND |
| src/background/message-handler.ts updated | FOUND |
| wxt.config.ts updated | FOUND |
| All task commits exist (9 commits) | FOUND |
| npx tsc --noEmit exits 0 | PASS |
| npx vitest run — 125 tests pass | PASS |
| npx wxt build exits 0 | PASS |

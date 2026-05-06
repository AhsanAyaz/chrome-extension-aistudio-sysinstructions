---
phase: 02-observation-pipeline
fixed_at: 2026-05-06T00:00:00Z
review_path: .planning/phases/02-observation-pipeline/02-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-06T00:00:00Z
**Source review:** .planning/phases/02-observation-pipeline/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (1 Critical, 3 Warning)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Missing payload guard before handleLsChanged in onMessage listener

**Files modified:** `src/background/index.ts`
**Commit:** 045d21c
**Applied fix:** Added `Array.isArray(message.payload)` guard at the top of the `LS_CHANGED` branch. If `payload` is absent or not an array, `sendResponse({ ok: false, error: 'invalid payload' })` is called immediately and `return true` keeps the port clean. The happy path is unchanged.

---

### WR-01: Unhandled chrome.runtime.sendMessage promise rejection in content script

**Files modified:** `src/content/index.ts`
**Commit:** 10b06f0
**Applied fix:** Added a `fireAndForget(payload: object): void` helper above the `defineContentScript` call that calls `chrome.runtime.sendMessage` and attaches a `.catch(() => {})` to suppress unhandled-rejection noise when the SW is inactive. Both `sendMessage` call sites in the postMessage listener and the polling interval were replaced with `fireAndForget(...)`.

---

### WR-02: postMessage uses targetOrigin '*' — leaks data to cross-origin iframes

**Files modified:** `src/injected/ls-observer.js`, `public/injected/ls-observer.js`
**Commit:** a0df1d2
**Applied fix:** Replaced the `'*'` targetOrigin with `window.location.origin` in both copies of `ls-observer.js`. Added an inline comment explaining the intent. Both files were committed atomically in a single commit.

---

### WR-03: Polling fallback lastSnapshot initialized to null — spurious first-poll duplicate

**Files modified:** `src/content/index.ts`
**Commit:** 0651f22
**Applied fix:** Changed `let lastSnapshot: string | null = null` to `let lastSnapshot: string | null = localStorage.getItem('aistudio_all_system_instructions')`. This ensures the first poll tick does not treat a pre-existing localStorage value as a new change, preventing a duplicate `LS_CHANGED` message that the injector's `setItem` patch would already have sent. Added an inline comment referencing WR-03.

---

_Fixed: 2026-05-06T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

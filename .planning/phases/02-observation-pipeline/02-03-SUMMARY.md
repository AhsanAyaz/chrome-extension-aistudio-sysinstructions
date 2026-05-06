---
phase: 02-observation-pipeline
plan: "03"
subsystem: content-script
tags: [injector, content-script, postMessage, polling, web_accessible_resources, main-world]

dependency_graph:
  requires:
    - phase: 02-01-shared-types-constants-guard
      provides: isValidPayload, RawInstruction, WATCHED_LS_KEY
    - phase: 02-02-message-handler
      provides: handleLsChanged, LS_CHANGED onMessage listener
  provides:
    - MAIN-world Storage.prototype.setItem patch (src/injected/ls-observer.js + public/injected/ls-observer.js)
    - ISOLATED-world relay content script with postMessage bridge and 2s polling fallback (src/content/index.ts)
    - web_accessible_resources wiring in wxt.config.ts scoped to aistudio.google.com
    - Full Phase 2 observation pipeline end-to-end (injector -> content script -> SW)
  affects: [03-push-engine, 04-pull-engine-bootstrap]

tech-stack:
  added: []
  patterns:
    - MAIN-world injector via public/ static copy (WXT static-copy pattern)
    - injectScript('/injected/ls-observer.js', { keepInDom: false }) for MAIN-world injection
    - event.source !== window guard before event.data checks (iframe spoof prevention)
    - lastSnapshot diff guard in polling interval to prevent duplicate LS_CHANGED fires
    - isValidPayload applied on both postMessage path and polling path (D-07 dual-gate)

key-files:
  created:
    - public/injected/ls-observer.js
    - src/injected/ls-observer.js
    - src/content/index.ts
  modified:
    - wxt.config.ts

key-decisions:
  - "public/injected/ is the authoritative copy of ls-observer.js — WXT ignores plain .js files in src/ entrypoints dir; public/ is the correct static-copy path (Rule 3 auto-fix during execution)"
  - "injectScript with web_accessible_resources approach used (not world: MAIN on content script) — correct WXT v0.20 pattern per PATTERNS.md"
  - "polling uses setInterval at 2000ms — simpler than requestIdleCallback and correct for v1 belt-and-suspenders fallback"
  - "keepInDom: false chosen — removes <script> tag after injection; prototype patch survives as JS closure (Pitfall 5)"
  - "wxt import sub-paths: wxt/utils/define-content-script and wxt/utils/inject-script — granular sub-path pattern matches existing background/index.ts (Rule 1 bug fix)"

patterns-established:
  - "Pattern WXT-STATIC: Plain .js files for MAIN-world must live in public/ — WXT's entrypoints scanner is TS-only"
  - "Pattern GUARD-DUAL: isValidPayload applied on both postMessage AND polling paths — guards every entry point into the relay, not just one"
  - "Pattern SPOOF-GUARD: event.source !== window checked BEFORE event.data.source — outer identity before payload inspection"

requirements-completed: [PUSH-01, PUSH-05, PUSH-06]

duration: 8min
completed: "2026-05-06"
---

# Phase 2 Plan 03: MAIN-world Injector, Relay Content Script, and web_accessible_resources — Summary

**`Storage.prototype.setItem` patch in the MAIN world plus ISOLATED-world relay with postMessage bridge, 2s polling fallback, and dual-path null/empty guard — completing the full Phase 2 observation pipeline verified end-to-end in DevTools.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-05-06
- **Tasks:** 1 auto + 1 checkpoint (human-verify, approved)
- **Files modified:** 4

## Accomplishments

- MAIN-world injector (`public/injected/ls-observer.js`) patches `Storage.prototype.setItem` and posts `{ source: 'sysins-injected', type: 'LS_SET', value }` verbatim — no parsing, no filtering (D-04/D-05/D-06)
- Relay content script (`src/content/index.ts`) bridges MAIN-to-ISOLATED via `window.addEventListener('message')` with `event.source !== window` iframe spoof guard, applies `isValidPayload` on both postMessage and polling paths, and has a 2s `setInterval` fallback with `lastSnapshot` diff guard
- `wxt.config.ts` updated with `web_accessible_resources` scoped to `https://aistudio.google.com/*`
- Full end-to-end pipeline verified in Chrome DevTools: injector fires → content script relays → SW logs `[sysins] LS_CHANGED received: N items` → `sysins:local:lastObserved` written to `chrome.storage.local`

## Task Commits

1. **Task 1: MAIN-world injector, relay content script, web_accessible_resources** - `f6690bb` (feat)
2. **[Rule 3 - Blocking] Fix ls-observer.js placement (public/injected/)** - `0ff3c3d` (fix)

## Files Created/Modified

- `public/injected/ls-observer.js` — authoritative MAIN-world copy; WXT static-copies to `.output/chrome-mv3/injected/ls-observer.js`
- `src/injected/ls-observer.js` — source reference copy (same content); kept for code navigation
- `src/content/index.ts` — ISOLATED-world relay: `defineContentScript`, `runAt: 'document_start'`, `injectScript` call, postMessage bridge with spoof guard, isValidPayload dual-gate, 2s polling fallback
- `wxt.config.ts` — added `web_accessible_resources: [{ resources: ['injected/ls-observer.js'], matches: ['https://aistudio.google.com/*'] }]`

## Decisions Made

1. **public/injected/ is authoritative (Rule 3 auto-fix):** WXT's entrypoints scanner only processes `.ts` files. The plain `.js` injector was silently missing from the build output when placed in `src/injected/`. Moving it to `public/injected/` causes WXT to copy it verbatim to `.output/chrome-mv3/injected/` — the correct MV3 static-asset pattern.

2. **injectScript + web_accessible_resources (not world: MAIN):** Using WXT's `injectScript()` utility with a `web_accessible_resources` entry is the correct WXT v0.20 MAIN-world injection pattern. Setting `world: 'MAIN'` on the content script itself is a WXT anti-pattern (PATTERNS.md §Anti-patterns).

3. **setInterval at 2000ms:** `requestIdleCallback` was considered but `setInterval` is simpler, more predictable, and correct for a belt-and-suspenders fallback. No visibility gating in v1 (T-02-09 accepted per threat model).

4. **keepInDom: false:** Removes the injected `<script>` tag from the DOM after execution. The `Storage.prototype` patch survives as a JS closure. Avoids leaving a detectable fingerprint in the DOM (Pitfall 5).

5. **Granular wxt import sub-paths:** `wxt/utils/define-content-script` and `wxt/utils/inject-script` — matches the sub-path import pattern used in `src/background/index.ts`. Barrel `wxt/utils` import caused a type error.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ls-observer.js missing from build output (wrong directory)**
- **Found during:** Task 1 verification (`ls .output/chrome-mv3/`)
- **Issue:** WXT's entrypoints scanner only picks up `.ts` files; a plain `.js` file in `src/injected/` is ignored and never copied to the build output. `injectScript('/injected/ls-observer.js')` would fail at runtime with a 404.
- **Fix:** Created `public/injected/ls-observer.js` as the authoritative copy. WXT's `public/` directory is copied verbatim to `.output/chrome-mv3/` — standard MV3 static-asset pattern. `src/injected/ls-observer.js` kept as a source-navigation reference.
- **Files modified:** `public/injected/ls-observer.js` (created)
- **Verification:** `ls .output/chrome-mv3/injected/` confirms `ls-observer.js` present after build; DevTools checkpoint passed
- **Committed in:** `0ff3c3d` (fix commit)

**2. [Rule 1 - Bug] wxt import sub-paths required**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `import { defineContentScript, injectScript } from 'wxt/utils'` produced a TypeScript resolution error. WXT v0.20 requires granular sub-path imports.
- **Fix:** Changed to `import { defineContentScript } from 'wxt/utils/define-content-script'` and `import { injectScript } from 'wxt/utils/inject-script'` — matching the pattern in `src/background/index.ts`.
- **Files modified:** `src/content/index.ts`
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** `f6690bb` (part of Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes were necessary for the build to produce a working extension. No scope creep — both are direct consequences of WXT v0.20 constraints documented in PITFALLS.md.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## Manual Verification (DevTools Checkpoint)

**Result: APPROVED — all 9 verification steps passed.**

| Step | Verification | Result |
|------|-------------|--------|
| 6 | `[sysins] LS_CHANGED received: 1 items` in SW console after AI Studio edit | PASS |
| 7 | `sysins:local:lastObserved` in `chrome.storage.local` with `itemCount`, `items`, `lastObservedAt` | PASS |
| 8 | Setting `localStorage` to `'null'` — NO `LS_CHANGED` fired (null guard works) | PASS |
| 9 | Polling fallback — `sysins:local:lastObserved` updated to `Poll Test` item within 3 seconds | PASS |

All Phase 2 success criteria are met:
- SC-1: AI Studio writes detected within 1 second (PUSH-01) — confirmed
- SC-2: Polling fallback detects missed writes within 3 seconds (PUSH-06) — confirmed
- SC-3: Null/empty reads do NOT trigger LS_CHANGED (PUSH-05) — confirmed
- SC-4: Unknown fields forwarded verbatim (PUSH-06) — confirmed via 02-02 test + verbatim payload in content script

## Next Phase Readiness

Phase 2 is **complete**. The full observation pipeline is live:

1. AI Studio `localStorage` write → MAIN-world patch fires → `postMessage` → ISOLATED-world relay → `isValidPayload` guard → `chrome.runtime.sendMessage(LS_CHANGED)` → SW `handleLsChanged` → `sysins:local:lastObserved` snapshot
2. Polling fallback covers edge cases missed by the injector (2s interval, lastSnapshot diff guard)

**Phase 3 notes:**
- `sysins:local:lastObserved` (written by Plan 02) is Phase 3's initial diff baseline. Phase 3 reads it to detect what changed since the last observation and writes `sysins:local:lastPushed` (D-12) after the first successful push.
- Pitfall 4 (duplicate `LS_CHANGED` from injector + polling on same write) is benign in Phase 2 — `handleLsChanged` is idempotent (snapshot overwrite). Phase 3's push engine MUST deduplicate via diff-against-`lastPushed` to avoid double pushes on the same change.
- Phase 3 blocker (from STATE.md): Phase 4 (BOOT-03/AISTUDIO-4) requires a live-page spike before planning — `chrome.identity.getProfileUserInfo()` availability and AI Studio DOM account identifier location must be confirmed.

## Known Stubs

None — the observation pipeline is fully wired and verified.

## Threat Surface Scan

All threats in the plan's threat register are mitigated as specified:

| Threat | Status |
|--------|--------|
| T-02-06: Spoofing via window.postMessage | Mitigated — `event.source !== window` guard in `src/content/index.ts` line 15 |
| T-02-07: Tampering via postMessage value | Accepted — raw string accessible to all page JS; `isValidPayload` re-validates in relay |
| T-02-08: EoP via injector footprint | Mitigated — 20-line injector, no imports, no state, no chrome.* APIs; `_setItem.apply` before postMessage |
| T-02-09: DoS via polling interval | Accepted — 2s interval, low overhead; no visibility gating in v1 |

No new security-relevant surfaces beyond the plan's threat model.

## Self-Check: PASSED

- public/injected/ls-observer.js: FOUND
- src/injected/ls-observer.js: FOUND
- src/content/index.ts: FOUND
- wxt.config.ts (web_accessible_resources): FOUND
- Commit f6690bb: FOUND
- Commit 0ff3c3d: FOUND

---
*Phase: 02-observation-pipeline*
*Completed: 2026-05-06*

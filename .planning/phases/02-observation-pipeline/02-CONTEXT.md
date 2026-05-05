# Phase 2: Observation Pipeline - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the MAIN-world localStorage injector and content script relay that prove AI Studio writes are detected and forwarded to the service worker. No sync logic exists yet — Phase 2 ends when `LS_CHANGED` reliably arrives at the SW with the raw payload.

Out of phase: UUID assignment, merge diff, chunking, any `chrome.storage.sync` I/O (Phase 3+), pull path (Phase 4), popup (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Service Worker onMessage Stub (Phase 2)

- **D-01 (SW stub behavior):** The SW's `chrome.runtime.onMessage` handler for `LS_CHANGED` messages in Phase 2 does two things: `console.log` the raw payload AND writes a snapshot to `chrome.storage.local`. This enables DevTools-panel verification (storage inspector) in addition to SW console inspection.

- **D-02 (Snapshot key):** The Phase 2 snapshot is written under `sysins:local:lastObserved` — within the established `sysins:local:*` namespace (D-24 from Phase 1). Shape: `{ lastObservedAt: number, itemCount: number, items: RawInstruction[] }`. Phase 3 reads and replaces this key with full push-engine logic.

- **D-03 (ensureInitialized in onMessage):** The `onMessage` handler calls `ensureInitialized()` before processing `LS_CHANGED`. This ensures orphan-recovery (D-13 syncPending cleanup) runs on any SW wake triggered by content script messages — consistent with Phase 1's design and eliminates Phase 3 rework.

### MAIN-World Injector

- **D-04 (Injector file):** `src/injected/ls-observer.js` — plain JavaScript (not TypeScript). MAIN-world scripts cannot use ES module imports, and the injector must be self-contained. The file patches `Storage.prototype.setItem`, checks `key === WATCHED_KEY && this === window.localStorage`, and posts `{ source: 'sysins-injected', type: 'LS_SET', value }` via `window.postMessage`.

- **D-05 (Watched key):** The injector watches the hardcoded string `'aistudio_all_system_instructions'`. This cannot be imported from `constants.ts` (MAIN world, no module system), so it is a literal in the injector with a comment citing the constants file as the canonical definition.

- **D-06 (Injector minimalism):** The injector does NO parsing, NO filtering, NO validation. It posts the raw string value verbatim. All null-guard and validation logic lives in the content script (PUSH-05) and SW (D-07). This minimizes MAIN-world attack surface per PITFALLS.md §MV3-3.

### Content Script

- **D-07 (Null/empty guard — PUSH-05):** Before forwarding to the SW, the content script checks: if `JSON.parse(value)` is `null`, not an array, or an empty array, do NOT send `LS_CHANGED`. Log silently to content script console. This implements Hard Rule #4 (null reads are detection failures, not user deletes).

- **D-08 (Unknown field passthrough — PUSH-06):** The content script forwards `JSON.parse(event.data.value)` verbatim to the SW — no field stripping, no normalization. The SW stub (Phase 2) and push engine (Phase 3) receive the raw array as AI Studio wrote it.

- **D-09 (Polling fallback):** The content script polls `localStorage.getItem('aistudio_all_system_instructions')` every 2 seconds on `document_idle` as belt-and-suspenders. Polling is continuous (always-on, no visibility gating) — simplest and correct given the low cost. Same null/empty guard (D-07) applies to poll-triggered messages.

- **D-10 (Message filter):** The content script listens for `window.postMessage` events and filters on `event.data?.source === 'sysins-injected'` before processing. This prevents other page scripts from injecting fake `LS_CHANGED` messages.

### Claude's Discretion

- Polling implementation details: `setInterval` vs `requestIdleCallback` interval chaining — both acceptable, planner decides.
- WXT entrypoint registration for the MAIN-world script and content script — follow WXT 0.20.25 conventions per research docs (file-based entrypoints or manifest override).
- Exact shape of the `LS_CHANGED` chrome.runtime.sendMessage message beyond `{ type: 'LS_CHANGED', payload: RawInstruction[] }`.
- Test coverage strategy: unit test the SW `onMessage` handler (fakeBrowser) and content script relay logic (happy-dom simulation). MAIN-world injector is untestable in Vitest — verify manually via DevTools. Planner decides exact test file layout.
- Whether `sysins:local:lastObserved` needs a TypeScript type in `shared/types.ts` (likely yes — planner decides the shape and whether it's a Phase 2 or Phase 3 type).
- `LAST_OBSERVED_KEY` constant — add to `shared/constants.ts` alongside existing `sysins:local:*` keys.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Charter & Requirements
- `.planning/PROJECT.md` — vision, core value, hard rules (esp. Rule #4 null-read guard, Rule #6 content script is relay only)
- `.planning/REQUIREMENTS.md` — PUSH-01, PUSH-05, PUSH-06 are Phase 2's scope
- `.planning/ROADMAP.md` §"Phase 2: Observation Pipeline" — goal, success criteria, 4 verifiable truths
- `CLAUDE.md` — Hard Rules #4, #6, #8 directly constrain this phase

### Phase 1 Context (locked decisions)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-07 (strict validation), D-19 (permissions), D-23 (module layout), D-24 (constants source-of-truth), the full `sysins:local:*` schema

### Research (architecture and pitfalls)
- `.planning/research/ARCHITECTURE.md` §"localStorage Observation Strategy" — canonical MAIN-world patch pattern, postMessage bridge, polling fallback spec, message flow diagrams
- `.planning/research/ARCHITECTURE.md` §"Component Responsibilities" — injector/content/SW responsibility boundaries
- `.planning/research/PITFALLS.md` §MV3-1, MV3-3, AISTUDIO-1, AISTUDIO-2 — MV3 content script gotchas, MAIN-world injection footprint, AI Studio React reactivity
- `.planning/phases/01-foundation/01-RESEARCH.md` §"Recipe 2" — fakeBrowser test pattern (reuse for SW handler tests)
- `.planning/phases/01-foundation/01-RESEARCH.md` §"Recipe 3" — WXT manifest configuration (how content scripts are declared)

### Existing Phase 1 Code
- `src/background/index.ts` — SW entrypoint; Phase 2 adds `chrome.runtime.onMessage` listener here (the file already has a comment marking this boundary)
- `src/shared/constants.ts` — Phase 2 adds `LAST_OBSERVED_KEY` and `WATCHED_LS_KEY` constants here
- `src/shared/types.ts` — Phase 2 adds `RawInstruction`, `LastObservedSnapshot` types here
- `wxt.config.ts` — Phase 2 registers the content script + injected script entrypoints here (or via file-based WXT convention)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/background/index.ts`: `ensureInitialized()` is already exported and tested — call it at the top of the new `onMessage` handler (D-03).
- `src/shared/constants.ts`: `LOCAL_KEY_PREFIX = 'sysins:local:'` — append `lastObserved` to form the snapshot key without a new prefix.
- `src/shared/types.ts`: `SyncStatus`, `ErrorState` etc. already exist — add `RawInstruction` and `LastObservedSnapshot` alongside them.
- `fakeBrowser` pattern from `src/background/service-worker.test.ts` — import, `beforeEach(fakeBrowser.reset)`, then test `chrome.storage.local.get` after dispatching a fake `onMessage`.

### Established Patterns
- All `sysins:local:*` keys are constants in `shared/constants.ts` (D-24) — `LAST_OBSERVED_KEY` must live there, not inline.
- Phase 1's test files use `fakeBrowser` from `wxt/testing/fake-browser` with `globals: false` imports — follow the same pattern in Phase 2 SW handler tests.
- `wxt.config.ts` already has an `entrypoints:found` hook filtering out `*.test.ts` files — the injected script and content script entrypoints must be allowed through (or follow WXT's file-based convention so no hook change is needed).

### Integration Points
- `src/background/index.ts` `defineBackground()` body: add `chrome.runtime.onMessage.addListener(handleLsChanged)` alongside the existing `onInstalled` listener.
- `wxt.config.ts` `manifest.content_scripts` (or WXT file-based content script): declare both the MAIN-world injector (`src/injected/ls-observer.js`, `world: 'MAIN'`, `run_at: 'document_start'`) and the relay content script (`src/content/content.ts`, `run_at: 'document_idle'`).
- No changes needed to `src/shared/constants.ts` structure — just additions.

</code_context>

<specifics>
## Specific Ideas

- The user picked the recommended option for all SW stub decisions, confirming the research-backed defaults are acceptable.
- The Phase 2 snapshot at `sysins:local:lastObserved` is explicitly a Phase 3 transition artifact — Phase 3's push engine reads this key to get the first snapshot to diff against. It is NOT a permanent schema key and may be superseded by `sysins:local:lastPushed` (D-12) once Phase 3 runs a successful push. Planner should note this transition in the Phase 2 plan so Phase 3 handles it cleanly.
- Hard Rule #4 (null-read guard) is the most important correctness property in Phase 2 — it must be tested, not just implemented. A test that simulates `localStorage.setItem(key, 'null')` or `localStorage.setItem(key, '[]')` and asserts no `LS_CHANGED` message is sent is a must-have.

</specifics>

<deferred>
## Deferred Ideas

- Polling visibility-gating (tab-background throttle to 10s) — raised as a gray area but not discussed; left to Claude's discretion. If the planner judges it worthwhile, it can be included; it is not a user requirement.
- Content script test strategy (happy-dom integration test for the relay logic) — planner decides level of coverage needed.
- `sysins:local:lastObserved` TypeScript shape in types.ts — planner decides whether this is a Phase 2 or Phase 3 type definition responsibility.

### Reviewed Todos (not folded)

(None — todo registry had 0 matches for Phase 2.)

</deferred>

---

*Phase: 02-observation-pipeline*
*Context gathered: 2026-05-06*

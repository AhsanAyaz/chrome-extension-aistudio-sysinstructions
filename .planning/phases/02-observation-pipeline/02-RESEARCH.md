# Phase 2: Observation Pipeline - Research

**Researched:** 2026-05-06
**Domain:** Chrome MV3 MAIN-world localStorage observation, content script relay, WXT entrypoint registration, postMessage bridge
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Service Worker onMessage Stub (Phase 2):**
- **D-01 (SW stub behavior):** The SW's `chrome.runtime.onMessage` handler for `LS_CHANGED` messages in Phase 2 does two things: `console.log` the raw payload AND writes a snapshot to `chrome.storage.local`. This enables DevTools-panel verification (storage inspector) in addition to SW console inspection.
- **D-02 (Snapshot key):** The Phase 2 snapshot is written under `sysins:local:lastObserved` — within the established `sysins:local:*` namespace. Shape: `{ lastObservedAt: number, itemCount: number, items: RawInstruction[] }`. Phase 3 reads and replaces this key with full push-engine logic.
- **D-03 (ensureInitialized in onMessage):** The `onMessage` handler calls `ensureInitialized()` before processing `LS_CHANGED`. This ensures orphan-recovery runs on any SW wake triggered by content script messages — consistent with Phase 1's design.

**MAIN-World Injector:**
- **D-04 (Injector file):** `src/injected/ls-observer.js` — plain JavaScript (not TypeScript). MAIN-world scripts cannot use ES module imports, and the injector must be self-contained. The file patches `Storage.prototype.setItem`, checks `key === WATCHED_KEY && this === window.localStorage`, and posts `{ source: 'sysins-injected', type: 'LS_SET', value }` via `window.postMessage`.
- **D-05 (Watched key):** The injector watches the hardcoded string `'aistudio_all_system_instructions'`. This cannot be imported from `constants.ts` (MAIN world, no module system), so it is a literal in the injector with a comment citing the constants file as the canonical definition.
- **D-06 (Injector minimalism):** The injector does NO parsing, NO filtering, NO validation. It posts the raw string value verbatim. All null-guard and validation logic lives in the content script (PUSH-05) and SW.

**Content Script:**
- **D-07 (Null/empty guard — PUSH-05):** Before forwarding to the SW, the content script checks: if `JSON.parse(value)` is `null`, not an array, or an empty array, do NOT send `LS_CHANGED`. Log silently to content script console.
- **D-08 (Unknown field passthrough — PUSH-06):** The content script forwards `JSON.parse(event.data.value)` verbatim to the SW — no field stripping, no normalization.
- **D-09 (Polling fallback):** The content script polls `localStorage.getItem('aistudio_all_system_instructions')` every 2 seconds on `document_idle` as belt-and-suspenders. Polling is continuous (always-on). Same null/empty guard (D-07) applies.
- **D-10 (Message filter):** The content script listens for `window.postMessage` events and filters on `event.data?.source === 'sysins-injected'` before processing.

### Claude's Discretion

- Polling implementation details: `setInterval` vs `requestIdleCallback` interval chaining — both acceptable, planner decides.
- WXT entrypoint registration for the MAIN-world script and content script — follow WXT 0.20.25 conventions per research docs (file-based entrypoints or manifest override).
- Exact shape of the `LS_CHANGED` chrome.runtime.sendMessage message beyond `{ type: 'LS_CHANGED', payload: RawInstruction[] }`.
- Test coverage strategy: unit test the SW `onMessage` handler (fakeBrowser) and content script relay logic (happy-dom simulation). MAIN-world injector is untestable in Vitest — verify manually via DevTools. Planner decides exact test file layout.
- Whether `sysins:local:lastObserved` needs a TypeScript type in `shared/types.ts` (likely yes — planner decides the shape and whether it's a Phase 2 or Phase 3 type).
- `LAST_OBSERVED_KEY` constant — add to `shared/constants.ts` alongside existing `sysins:local:*` keys.

### Deferred Ideas (OUT OF SCOPE)

- Polling visibility-gating (tab-background throttle to 10s) — not a user requirement; Claude's discretion if worthwhile.
- Content script test strategy (happy-dom integration test for the relay logic) — planner decides level of coverage needed.
- `sysins:local:lastObserved` TypeScript shape in types.ts — planner decides whether this is a Phase 2 or Phase 3 type definition responsibility.
- UUID assignment, merge diff, chunking, any `chrome.storage.sync` I/O — Phase 3+.
- Pull path, popup — Phases 4–5.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PUSH-01 | When AI Studio writes to `localStorage["aistudio_all_system_instructions"]`, the extension detects the change without requiring a page reload. | §"WXT Entrypoint Registration" — MAIN-world script via `defineUnlistedScript` + `injectScript()` at `document_start` in relay content script guarantees the patch is in place before any page JS. §"Recipe 1: Injector Pattern" — `Storage.prototype.setItem` patch posts `LS_SET` message synchronously on every write. |
| PUSH-05 | A `null`, missing, or empty-array localStorage read is never auto-propagated as "user deleted everything." | §"Recipe 2: Content Script Guard" — `JSON.parse(value)` null/not-array/empty-array check in content script. §"Pitfall: Hard Rule #4" — D-07 is the enforcement point for this rule. Must be tested (see §"Test Map"). |
| PUSH-06 | Unknown fields on instruction items are preserved end-to-end so future AI Studio schema additions are not silently dropped. | §"Recipe 2: Content Script Guard" — verbatim `JSON.parse(event.data.value)` forward without field stripping. `RawInstruction` type uses index signature `[key: string]: unknown` to model the verbatim passthrough. |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

CLAUDE.md mandates these directives. Every plan and task must comply.

1. Storage namespace `sysins:*` frozen in Phase 1 — Phase 2 adds `sysins:local:lastObserved` key only.
2. Hard Rule #4: `null`/empty `localStorage` reads are NEVER auto-propagated as a delete. Content script guard (D-07) is the Phase 2 enforcement point.
3. Hard Rule #6: All merge logic lives in the service worker. Content script is a relay — does NOT implement any logic beyond the null/empty guard and verbatim JSON forwarding.
4. Hard Rule #8: Live update via synthetic `StorageEvent` is best-effort by design. Phase 2 does NOT implement the pull path; this is Phase 4.
5. All sync state persisted to `chrome.storage.local` — Phase 2 writes `sysins:local:lastObserved` snapshot there.
6. DIST-04: No third-party network calls. Phase 2 adds no network code.
7. D-23 (Module layout): `src/content/` and `src/injected/` directories per the established layout — no deviation.
8. D-24 (Constants): `LAST_OBSERVED_KEY` and `WATCHED_LS_KEY` must be added to `src/shared/constants.ts`, not inlined.

---

## Summary

Phase 2 builds the observation pipeline: a MAIN-world script that patches `Storage.prototype.setItem`, a content script relay that guards null/empty payloads and forwards to the service worker, a 2-second polling fallback, and a SW `onMessage` stub that logs and persists a `sysins:local:lastObserved` snapshot. No sync logic runs in this phase — Phase 2 ends when `LS_CHANGED` reliably arrives at the SW with the raw payload.

**WXT convention resolution (critical):** WXT 0.20.25 strongly recommends against `world: 'MAIN'` on a content script and instead recommends the `defineUnlistedScript` + `injectScript()` pattern. In MV3, `injectScript()` is *synchronous* with the calling content script's `run_at` — so a relay content script with `runAt: 'document_start'` calling `injectScript('/injected/ls-observer.js')` ensures the Storage.prototype patch is in place at `document_start`. The unlisted script at `src/injected/ls-observer.js` is NOT written with `defineUnlistedScript` (because D-04 mandates plain JS, not TypeScript with ES module exports). It is instead registered as a `web_accessible_resources` entry in `wxt.config.ts` and referenced by path from the relay content script. This is the approach that bridges D-04's "plain JS, self-contained" requirement with WXT's recommended injection pattern.

**Alternatively (two-content-script approach):** WXT does support `world: 'MAIN'` directly on a content script typed as `defineContentScript({ world: 'MAIN', runAt: 'document_start' })`. The CONTEXT.md docs say WXT "doesn't recommend" this for MV2-compat reasons, but this project targets MV3/Chrome only (DIST-02). This is a valid fallback if the `injectScript()` approach produces WXT build issues. See Open Questions OQ-1.

**Primary recommendation:** Use the two-file approach: (1) `src/injected/ls-observer.js` as a plain JS unlisted/web-accessible resource, (2) `src/content/index.ts` as an ISOLATED-world relay content script with `runAt: 'document_start'` that calls `injectScript('/injected/ls-observer.js')` synchronously before registering its `window.message` listener.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `Storage.prototype.setItem` interception | MAIN World (injected script) | — | Only code in the MAIN world can patch the page's Storage prototype. No chrome.* APIs available here. |
| postMessage bridge (MAIN → ISOLATED) | Content Script (ISOLATED) | — | Content script receives `window.message` events from the MAIN world. Filters on `event.data.source`. |
| Null/empty guard (PUSH-05) | Content Script (ISOLATED) | — | Guard must be in ISOLATED world — the only place where chrome.* APIs are available to decide whether to send. |
| 2-second polling fallback | Content Script (ISOLATED) | — | `localStorage.getItem` + `setInterval` in the content script. |
| `LS_CHANGED` forwarding to SW | Content Script (ISOLATED) | — | `chrome.runtime.sendMessage` is available only in ISOLATED world, not MAIN. |
| `sysins:local:lastObserved` write | Service Worker | — | All `chrome.storage.local` I/O lives in the SW per Hard Rule #6. |
| `LS_CHANGED` handler stub (Phase 2) | Service Worker | — | SW owns all state decisions; this stub is the Phase 3 push-engine entry point. |
| Unknown-field passthrough (PUSH-06) | Content Script (ISOLATED) | — | Forward verbatim — no type narrowing that could drop fields. SW receives the full object. |

---

## Standard Stack

### Core (Phase 2 additions — no new packages required)

| Component | Version | Purpose | Why |
|-----------|---------|---------|-----|
| WXT `defineContentScript` | 0.20.25 (already installed) | Declares the ISOLATED-world relay content script | WXT file-based auto-detection via `src/content/index.ts` [VERIFIED: WXT docs] |
| WXT `injectScript()` | 0.20.25 (already installed) | Injects plain JS into MAIN world from content script | WXT-recommended pattern for MAIN-world injection in MV3; synchronous in MV3 [VERIFIED: WXT docs] |
| WXT `defineUnlistedScript` | 0.20.25 (already installed) | Optional wrapper for the injected JS file (if TypeScript is used) | If D-04 plain JS is kept, `defineUnlistedScript` is omitted; file is a raw `.js` resource [VERIFIED: WXT docs] |
| `chrome.runtime.sendMessage` / `onMessage` | MV3 (already in manifest) | CS → SW one-way message for `LS_CHANGED` | Correct choice per ARCHITECTURE.md — single request, no port needed |
| `chrome.storage.local` | MV3 (already in manifest) | SW persists `sysins:local:lastObserved` snapshot | `sysins:local:*` namespace established in Phase 1 |
| Vitest 4.1.5 + fakeBrowser | 4.1.5 (already installed) | SW onMessage handler tests | Identical pattern to Phase 1 `service-worker.test.ts` |
| happy-dom | 15.x (already installed) | Content script guard logic tests | DOM environment for simulating window.localStorage |

### No New Dependencies

Phase 2 installs zero new npm packages. All required libraries are present from Phase 1.

**Verification:**
```bash
npm view wxt version        # 0.20.25 ✓ [VERIFIED: npm registry]
npm view vitest version     # 4.1.5 ✓ [VERIFIED: npm registry]
```

---

## Architecture Patterns

### System Architecture Diagram

```
aistudio.google.com page load
         │
         ▼ (document_start)
┌────────────────────────────────────────────────────┐
│  RELAY CONTENT SCRIPT (src/content/index.ts)        │
│  runAt: document_start, world: ISOLATED             │
│                                                      │
│  1. injectScript('/injected/ls-observer.js')  ◄──── │── web_accessible_resources
│     (synchronous in MV3 — patch in place at         │
│      document_start before any page JS)             │
│                                                      │
│  2. window.addEventListener('message', handler)     │
│     → filter: event.source === window               │
│              && event.data?.source === 'sysins-injected'
│     → guard: JSON.parse(value) is valid non-empty array
│     → send:  chrome.runtime.sendMessage(LS_CHANGED) │
│                                                      │
│  3. setInterval(pollFn, 2000)  ← polling fallback   │
│     (document_idle equivalent — runs after inject)  │
└──────────────────────────────┬─────────────────────┘
         │                     │
         │ (window.postMessage) │ (chrome.runtime.sendMessage)
         ▼                     ▼
┌──────────────────┐   ┌─────────────────────────────┐
│ INJECTED SCRIPT  │   │ SERVICE WORKER               │
│ ls-observer.js   │   │ src/background/index.ts      │
│ (MAIN world)     │   │                              │
│                  │   │ onMessage('LS_CHANGED')       │
│ Storage.prototype│   │   1. ensureInitialized()     │
│   .setItem patch │   │   2. console.log(payload)    │
│                  │   │   3. write lastObserved       │
│ → postMessage    │   │      chrome.storage.local    │
│   {source, type, │   │                              │
│    value}        │   └─────────────────────────────┘
└──────────────────┘
```

### Recommended Project Structure (Phase 2 additions)

```
src/
├── background/
│   ├── index.ts             # Phase 1 — adds onMessage handler (Phase 2)
│   ├── message-handler.ts   # NEW: handleLsChanged(), writes lastObserved
│   └── [Phase 1 files...]
├── content/
│   └── index.ts             # NEW: relay content script (ISOLATED world)
├── injected/
│   └── ls-observer.js       # NEW: MAIN-world plain JS injector
└── shared/
    ├── constants.ts         # adds LAST_OBSERVED_KEY, WATCHED_LS_KEY
    └── types.ts             # adds RawInstruction, LastObservedSnapshot
```

### Pattern 1: WXT MAIN-World Injection via `injectScript()`

**What:** A relay content script at `document_start` calls `injectScript()` to load the plain JS injector into the MAIN world synchronously, then listens for postMessage events.

**When to use:** Any time you need to patch page-global APIs (localStorage, fetch, etc.) in MV3. WXT's recommended approach.

**Why not `world: 'MAIN'` on a content script:** WXT explicitly does not recommend this because it lacks MV2 support and has other drawbacks. For this Chrome-only MV3 extension the drawbacks are irrelevant — but the `injectScript()` approach works identically and is the WXT-canonical path. [VERIFIED: wxt.dev/guide/essentials/content-scripts]

**Example:**
```typescript
// src/content/index.ts  — Source: wxt.dev/guide/essentials/content-scripts
import { defineContentScript, injectScript } from 'wxt/utils';

export default defineContentScript({
  matches: ['https://aistudio.google.com/*'],
  runAt: 'document_start',
  // world defaults to ISOLATED — do NOT set world: 'MAIN' here

  async main(ctx) {
    // Step 1: Inject the MAIN-world patch synchronously
    // MV3: injectScript is synchronous at document_start — patch is in place
    // before any page JS executes.
    await injectScript('/injected/ls-observer.js', {
      keepInDom: false,  // remove script tag after execution (lower page footprint)
    });

    // Step 2: Listen for postMessage events from the MAIN-world injector
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== 'sysins-injected') return;
      if (event.data.type !== 'LS_SET') return;

      const value: string = event.data.value;

      // D-07: null/empty guard
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return; // malformed JSON — silently ignore
      }
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      // D-08: verbatim forward — no field stripping
      chrome.runtime.sendMessage({
        type: 'LS_CHANGED',
        payload: parsed as RawInstruction[],
      });
    });

    // Step 3: 2-second polling fallback (D-09)
    let lastSnapshot: string | null = null;
    setInterval(() => {
      const value = localStorage.getItem('aistudio_all_system_instructions');
      if (value === lastSnapshot) return;
      lastSnapshot = value;
      if (value === null) return;

      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { return; }
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      chrome.runtime.sendMessage({
        type: 'LS_CHANGED',
        payload: parsed as RawInstruction[],
      });
    }, 2000);
  },
});
```

**Note on `keepInDom: false`:** Removing the `<script>` tag after execution keeps the page DOM clean. The patch survives as a closure — `Storage.prototype.setItem` remains patched even after the tag is removed. [ASSUMED — standard JS behavior: prototype patch outlives the script element]

### Pattern 2: MAIN-World Injector (Plain JS)

**What:** A minimal, self-contained plain JS file that patches `Storage.prototype.setItem` and posts a message when the watched key is written.

**Why plain JS, not TypeScript:** D-04 mandates plain JS. The injector runs in the MAIN world and has no access to chrome.* APIs or ES module imports. TypeScript would transpile fine but adds unnecessary complexity — this file is ~15 lines and intentionally simple.

**Example:**
```javascript
// src/injected/ls-observer.js
// Source: ARCHITECTURE.md §"Recommended approach: MAIN-world Storage.prototype patch"
// WATCHED_KEY cannot be imported from constants.ts (MAIN world: no module system).
// Canonical definition is in src/shared/constants.ts.
const WATCHED_KEY = 'aistudio_all_system_instructions';
const _setItem = Storage.prototype.setItem;

Storage.prototype.setItem = function (key, value) {
  _setItem.apply(this, arguments);
  if (key === WATCHED_KEY && this === window.localStorage) {
    window.postMessage(
      { source: 'sysins-injected', type: 'LS_SET', value: value },
      '*'
    );
  }
};
```

**Note on `postMessage` target origin `'*'`:** Posting to `'*'` is intentional — the content script receives on the same page, and the payload (raw localStorage string) is not a secret. Restricting the origin to `window.location.origin` would work too but `'*'` is simpler for this case. The ARCHITECTURE.md pattern uses `'*'`. [CITED: ARCHITECTURE.md §"localStorage Observation Strategy" Step 2]

### Pattern 3: `web_accessible_resources` Registration

**What:** The injected script must be declared in `web_accessible_resources` in `wxt.config.ts` so that `injectScript()` can load it. [VERIFIED: wxt.dev — "Make sure to add the injected script to your manifest's web_accessible_resources."]

**Example:**
```typescript
// wxt.config.ts — add to existing manifest block
manifest: {
  // ... existing fields ...
  web_accessible_resources: [
    {
      resources: ['injected/ls-observer.js'],
      matches: ['https://aistudio.google.com/*'],
    },
  ],
},
```

**Scoping the match:** Use `https://aistudio.google.com/*` (not `*://*/*`) per DIST-02 — minimum host exposure. [CITED: DIST-02 requirement]

### Pattern 4: SW `onMessage` Handler Stub

**What:** The service worker receives `LS_CHANGED`, calls `ensureInitialized()` (D-03), logs the payload, and writes `sysins:local:lastObserved`.

**Example:**
```typescript
// src/background/message-handler.ts
import { LAST_OBSERVED_KEY } from '../shared/constants';
import type { RawInstruction, LastObservedSnapshot } from '../shared/types';

export async function handleLsChanged(
  payload: RawInstruction[],
): Promise<void> {
  console.log('[sysins] LS_CHANGED received:', payload.length, 'items');

  const snapshot: LastObservedSnapshot = {
    lastObservedAt: Date.now(),
    itemCount: payload.length,
    items: payload,
  };
  await chrome.storage.local.set({ [LAST_OBSERVED_KEY]: snapshot });
}
```

```typescript
// src/background/index.ts — add inside defineBackground()
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LS_CHANGED') {
    // D-03: ensureInitialized on every SW wake from a CS message
    ensureInitialized()
      .then(() => handleLsChanged(message.payload))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep message channel open for async response
  }
});
```

**Why `return true`:** In Chrome MV3, returning `true` from an `onMessage` listener keeps the message port open until `sendResponse` is called. Required when the handler is async. [CITED: developer.chrome.com/docs/extensions/reference/api/runtime#event-onMessage]

### Pattern 5: Type Additions to `shared/types.ts`

**What:** `RawInstruction` and `LastObservedSnapshot` types to add to existing `src/shared/types.ts`.

**Example:**
```typescript
// src/shared/types.ts — additions

// Shape of one item as AI Studio writes it to localStorage.
// Uses index signature to preserve unknown fields verbatim (D-08 / PUSH-06).
// title and text are the only fields currently known; future AI Studio fields
// are preserved through the index signature without field stripping.
export interface RawInstruction {
  title: string;
  text: string;
  [unknownAiStudioField: string]: unknown;
}

// sysins:local:lastObserved — D-02
// Written by Phase 2's onMessage stub; read by Phase 3's push engine
// as the starting snapshot for the first diff cycle.
// This key is a Phase 2/3 transition artifact and may be superseded by
// sysins:local:lastPushed (D-12) once Phase 3 runs a successful push.
export interface LastObservedSnapshot {
  lastObservedAt: number;   // epoch ms
  itemCount: number;
  items: RawInstruction[];
}
```

### Pattern 6: Constant Additions to `shared/constants.ts`

**What:** Two new constants to add alongside existing Phase 1 constants.

**Example:**
```typescript
// src/shared/constants.ts — additions (D-24: no magic numbers inline)

// Key under sysins:local:* for the Phase 2 observed snapshot.
// Phase 3 reads this key as the initial diff baseline.
export const LAST_OBSERVED_KEY = 'sysins:local:lastObserved';

// The localStorage key AI Studio uses for system instructions.
// Cannot be imported by the MAIN-world injector (no module system there) —
// that file uses a hardcoded literal with a comment pointing here.
export const WATCHED_LS_KEY = 'aistudio_all_system_instructions';
```

### Anti-Patterns to Avoid

- **`world: 'MAIN'` on a content script:** WXT does not recommend this pattern. Use `injectScript()` from an ISOLATED-world content script instead. [CITED: wxt.dev docs]
- **TypeScript in `src/injected/ls-observer.js`:** D-04 mandates plain JS. Even if TypeScript compiles correctly, using TS would require a `defineUnlistedScript` wrapper and export syntax that ES-module-aware bundlers would handle — but D-04's intent is a minimal, self-contained file with no toolchain surprises in the MAIN world.
- **`event.source !== window` check omission:** The postMessage filter `event.source !== window` is required to prevent same-page iframes from triggering the listener. Never rely on `event.data.source` alone — an iframe on the page could post a spoofed message. [CITED: ARCHITECTURE.md §"Content script listens to window.message events"]
- **Calling `sendMessage` without `return true` in the listener:** If the `onMessage` handler is async, not returning `true` closes the port before `sendResponse` is called, producing a "message port closed before response was received" error. Always `return true` for async handlers. [CITED: Chrome extension docs]
- **`setInterval` without a `lastSnapshot` guard:** Polling without tracking the previous value fires `LS_CHANGED` on every 2-second tick regardless of whether the value changed. The poll must diff against a `lastSnapshot` variable.
- **Stripping fields on the forwarded payload:** Any TypeScript type narrowing that only preserves `title` and `text` violates PUSH-06. Use `RawInstruction[]` with the index signature — never map to `{title, text}` only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MAIN-world script injection | Custom `<script>` element append logic | `injectScript()` from `wxt/utils` | WXT handles web_accessible_resources path resolution and provides MV3 synchronous timing guarantee [VERIFIED: WXT docs] |
| Message type narrowing | Ad-hoc `message.type === 'LS_CHANGED'` checks everywhere | A single `handleLsChanged` function + typed message interface in `shared/types.ts` | Prevents scattered null-checks and ensures the guard runs in one tested place |
| Duplicate localStorage guard logic | Separate null-guard implementations in injector, content script, and SW | Single guard in the content script (D-07) | The injector intentionally does zero filtering (D-06); SW receives only valid arrays; guard is only in CS |

**Key insight:** The injector's entire correctness contract is "post everything, decide nothing." All intelligence lives in the content script and service worker. This division makes each component independently testable and the attack surface in MAIN world minimal.

---

## Common Pitfalls

### Pitfall 1: `injectScript()` Timing in the Content Script

**What goes wrong:** Developer calls `injectScript()` inside a `document_idle` content script expecting the MAIN-world patch to be in place before AI Studio writes to localStorage. AI Studio may write to localStorage during initial page load — before `document_idle` fires.

**Why it happens:** WXT docs show `injectScript()` examples with `document_idle` (default) content scripts. The AI Studio write happens before `document_idle`.

**How to avoid:** Set `runAt: 'document_start'` on the relay content script. In MV3, `injectScript()` is synchronous at `document_start`, meaning the Storage.prototype patch is installed before any page JS runs. [VERIFIED: WXT docs — "For MV3, injectScript is synchronous, executing the injected script at the same time as the content script's run_at setting."]

**Warning signs:** Polling fallback catches writes that the injector misses on fresh page loads.

---

### Pitfall 2: `return true` Omission in `onMessage` Listener

**What goes wrong:** The SW `onMessage` handler calls `ensureInitialized()` and `handleLsChanged()` (both async), but does not return `true` from the synchronous listener. Chrome closes the message port immediately. `sendResponse` is called after the port closes, producing "The message port closed before a response was received" in the SW log.

**Why it happens:** `onMessage` listeners are synchronous by design — Chrome sees no `return true` and closes the port assuming the response was synchronous.

**How to avoid:** The synchronous `onMessage` callback must `return true` to signal to Chrome that it will respond asynchronously. Use the pattern in Recipe Pattern 4 above.

**Warning signs:** Content script console shows "Error: Could not establish connection. Receiving end does not exist" or "The message port closed before a response was received."

---

### Pitfall 3: postMessage `event.source` Filter Omission

**What goes wrong:** Content script listens for `window.message` events filtering only on `event.data?.source === 'sysins-injected'`. A page-level iframe, a third-party script, or a malicious extension injects a spoofed message with `source: 'sysins-injected'` and triggers `LS_CHANGED` with attacker-controlled data.

**Why it happens:** Developers test with only the injector and forget that `window.postMessage` messages arrive from any origin.

**How to avoid:** Filter on `event.source !== window` first (ensures message came from the same window, not an iframe or external source). Then filter on `event.data?.source === 'sysins-injected'`. [CITED: ARCHITECTURE.md §"Content script listens to window.message events"]

**Warning signs:** `LS_CHANGED` messages arriving when no AI Studio write occurred; unexpected payloads in SW logs.

---

### Pitfall 4: Duplicate `LS_CHANGED` from Injector + Polling

**What goes wrong:** AI Studio writes localStorage. The injector fires → content script sends `LS_CHANGED`. Two seconds later, the polling loop also detects the (same) changed value → content script sends a second `LS_CHANGED`. Phase 2's stub handles this fine (just two console logs), but Phase 3's push engine must not double-push.

**Why it happens:** The polling fallback intentionally catches writes the injector missed, but it also re-fires for writes the injector already handled.

**How to avoid:** Phase 2 is immune (stub only). Phase 3 handles this via the diff-against-last-pushed logic (D-12). The planner should note this deduplication requirement as a Phase 3 entry condition — Phase 2's polling implementation does not need to prevent duplicate messages to the SW.

**Warning signs:** Phase 3 pushing the same instructions twice in quick succession.

---

### Pitfall 5: `keepInDom: false` vs `keepInDom: true` — Patch Survival

**What goes wrong:** Developer sets `keepInDom: false` (or omits it, using the default) and assumes the `Storage.prototype` patch is removed when the `<script>` tag is removed from DOM.

**Why it happens:** JS closures are not associated with DOM elements. Removing the `<script>` tag does not revoke the prototype patch — the patch survives in the JavaScript engine's prototype chain indefinitely.

**How to avoid:** `keepInDom: false` is the correct choice — it cleans up the DOM without undoing the patch. This is the desired behavior. Document it explicitly in the injector file's comments to prevent a future developer from incorrectly adding cleanup code.

---

### Pitfall 6: The `entrypoints:found` Hook Must Not Filter the New Entrypoints

**What goes wrong:** The existing `wxt.config.ts` `entrypoints:found` hook filters out `*.test.ts` files. If this hook is accidentally tightened (e.g., allowlist only `background/`, `popup/`), the `content/` and `injected/` entrypoints are dropped from the build silently.

**Why it happens:** Hook logic changes when other developers add allowlist conditions.

**How to avoid:** The current hook is a denylist (`!info.inputPath.endsWith('.test.ts')`), which passes ALL non-test entrypoints through. Phase 2 does not need to change the hook — `content/index.ts` and `injected/ls-observer.js` pass through automatically. Verify with `wxt build` after adding the new files. [VERIFIED: existing `wxt.config.ts` hook logic]

---

## Code Examples

Verified patterns from official sources and existing codebase:

### Full `wxt.config.ts` update (add `web_accessible_resources`)
```typescript
// Source: wxt.dev/guide/essentials/content-scripts (web_accessible_resources pattern)
// Existing manifest block — add web_accessible_resources only:
manifest: {
  name: 'AI Studio Instructions Sync',
  description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
  version: '0.1.0',
  minimum_chrome_version: '116',
  permissions: ['storage', 'scripting'],
  host_permissions: ['https://aistudio.google.com/*'],
  web_accessible_resources: [
    {
      resources: ['injected/ls-observer.js'],
      matches: ['https://aistudio.google.com/*'],
    },
  ],
},
```

### SW `onMessage` listener in `defineBackground`
```typescript
// Source: existing src/background/index.ts pattern + Chrome docs return-true requirement
export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await initializeMeta();
    await ensureInitialized();
  });

  // Phase 2: LS_CHANGED handler
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'LS_CHANGED') {
      ensureInitialized()
        .then(() => handleLsChanged(message.payload))
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // keep port open for async response
    }
    // return undefined for unhandled message types (Chrome closes port immediately)
  });
});
```

### fakeBrowser test pattern for SW `onMessage` (adapts Phase 1 pattern)
```typescript
// Source: existing src/background/service-worker.test.ts pattern (Phase 1)
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { _resetForTesting } from './index';
import { handleLsChanged } from './message-handler';
import { LAST_OBSERVED_KEY } from '../shared/constants';

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
});

describe('handleLsChanged (D-01, D-02, PUSH-06)', () => {
  it('writes lastObserved snapshot to chrome.storage.local', async () => {
    const payload = [{ title: 'T', text: 'A', extraField: 'preserved' }];
    await handleLsChanged(payload);

    const r = await chrome.storage.local.get(LAST_OBSERVED_KEY);
    const snap = r[LAST_OBSERVED_KEY];
    expect(snap.itemCount).toBe(1);
    expect(snap.items[0].extraField).toBe('preserved'); // PUSH-06
    expect(snap.lastObservedAt).toBeGreaterThan(0);
  });
});
```

### Content script guard logic unit test (no DOM required)
```typescript
// Tests for the guard function extracted from the content script
// (extract guard logic to a pure function in shared/ for testability)
describe('null/empty guard (PUSH-05, D-07)', () => {
  it('returns false for null JSON', () => {
    expect(isValidPayload('null')).toBe(false);
  });
  it('returns false for empty array', () => {
    expect(isValidPayload('[]')).toBe(false);
  });
  it('returns false for non-array JSON', () => {
    expect(isValidPayload('"string"')).toBe(false);
    expect(isValidPayload('{"key":"val"}')).toBe(false);
  });
  it('returns true for non-empty array', () => {
    expect(isValidPayload('[{"title":"T","text":"A"}]')).toBe(true);
  });
  it('returns false for invalid JSON', () => {
    expect(isValidPayload('not-json')).toBe(false);
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `window.addEventListener('storage', ...)` to detect writes | `Storage.prototype.setItem` patch in MAIN world | MV3 era (same-window storage events were always excluded by spec) | The `storage` event never fires for same-window writes — MAIN-world patch is the only reliable synchronous observer |
| `world: 'MAIN'` in manifest content_scripts (raw manifest) | WXT `defineContentScript({ world: 'MAIN' })` or `injectScript()` | WXT 0.19+ | WXT now recommends `injectScript()` as the canonical MAIN-world injection method |
| `webextension-polyfill` for chrome.* APIs | `@wxt-dev/browser` (WXT 0.20+) | WXT 0.20 | Already adopted in Phase 1; content script uses `chrome.runtime.sendMessage` directly (native MV3 API) |

---

## WXT Entrypoint Registration Summary

**Critical finding confirmed by WXT docs [VERIFIED: wxt.dev/guide/essentials/content-scripts]:**

| Approach | WXT Support | Timing | Recommendation |
|----------|-------------|--------|----------------|
| `defineContentScript({ world: 'MAIN', runAt: 'document_start' })` | Supported but not recommended | Synchronous | Falls back to this if `injectScript()` causes issues |
| `injectScript('/injected/ls-observer.js')` from `document_start` content script | Recommended by WXT | Synchronous in MV3 | **Preferred approach** |
| `chrome.scripting.executeScript()` (dynamic) | Supported | Requires explicit trigger | Rejected — can't guarantee document_start timing |

**File placement with current `wxt.config.ts` (`srcDir: 'src'`, `entrypointsDir: '.'`):**

| File | WXT Auto-Detection | Entrypoint Type |
|------|-------------------|-----------------|
| `src/background/index.ts` | YES — `background/` folder | Service worker |
| `src/content/index.ts` | YES — `content/` folder | Content script |
| `src/injected/ls-observer.js` | YES — becomes unlisted script / web-accessible resource | Unlisted script |

WXT detects `content/` folder as a content script and `injected/` folder as an unlisted entrypoint. The `entrypoints:found` hook (existing denylist on `.test.ts`) will allow both through. [VERIFIED: WXT docs on entrypoint naming conventions]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `injectScript()` in MV3 is synchronous — patch is in place at `document_start` before any page JS | Architecture Patterns, Pitfall 1 | HIGH if wrong. Mitigation: polling fallback (D-09) catches misses. WXT docs explicitly state "For MV3, injectScript is synchronous" [CITED: wxt.dev]. |
| A2 | Removing `<script>` tag after `injectScript()` (`keepInDom: false`) does NOT revert the `Storage.prototype.setItem` patch — patch survives as a JS prototype chain mutation | Pitfall 5, Anti-Patterns | LOW risk — standard JS behavior. If wrong, set `keepInDom: true`. |
| A3 | `src/content/index.ts` is auto-detected by WXT as a content-script entrypoint with `srcDir: 'src'` + `entrypointsDir: '.'` | WXT Entrypoint Registration Summary | MEDIUM risk. Phase 1 verification was done for `background/`; `content/` follows the same pattern but should be confirmed with a `wxt build` smoke test in Wave 0. |
| A4 | WXT naming: `src/injected/` folder is auto-detected as an unlisted-script entrypoint | WXT Entrypoint Registration Summary | MEDIUM risk. If WXT does not auto-detect it as an unlisted-script, it may need to be referenced only via `web_accessible_resources` without WXT bundling it. In that case, keep it as a raw `.js` file copied into the output by a `public/` directory placement instead. |
| A5 | `postMessage` with target origin `'*'` does not create a meaningful security risk for this use case | Pattern 2 (Injector) | LOW risk. The payload is the raw localStorage string, which is accessible to any page JS already. Tightening to `window.location.origin` is the alternative. |

---

## Open Questions (RESOLVED)

1. **OQ-1: `injectScript()` vs `world: 'MAIN'` content script — which to use?**
   - RESOLVED: Use `injectScript()` with the raw `.js` file (honoring D-04) + `web_accessible_resources` registration in `wxt.config.ts`. Plan 02-03 implements this approach.

2. **OQ-2: Guard logic — inline in content script vs extracted pure function**
   - RESOLVED: Extracted to `src/shared/guard.ts` as `isValidPayload(value: string): boolean` — trivially testable with plain Vitest (no DOM needed) and reusable by Phase 3's push engine. Plan 02-01 implements this.

3. **OQ-3: `sendResponse` vs fire-and-forget for `LS_CHANGED`**
   - RESOLVED: Use `return true` + `sendResponse({ ok: true })` pattern. Closes the port cleanly, produces no Chrome console warnings, and establishes the pattern Phase 3 will use for actual error surfacing. Plan 02-02 implements this.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| WXT | Build / entrypoint registration | ✓ | 0.20.25 | — |
| Vitest | Unit tests | ✓ | 4.1.5 | — |
| happy-dom | Content script guard tests | ✓ | 15.x | — |
| Node.js | Build toolchain | ✓ | v22.13.1 | — |
| Chrome (for manual DevTools verification) | MAIN-world injector testing | Not verified | — | DevTools console in loaded extension |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

> `workflow.nyquist_validation: false` in config.json. Included as a coverage target table for the plan-checker.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 with `WxtVitest()` plugin and `fakeBrowser` |
| Config file | `vitest.config.ts` (existing from Phase 1) |
| Quick run command | `npm run test -- --run src/background/message-handler.test.ts` |
| Full suite command | `npm run test -- --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| PUSH-01 | Storage.prototype.setItem patch fires → content script receives → SW receives `LS_CHANGED` | manual (DevTools) | Load extension, open aistudio.google.com, edit instruction, check SW console and `chrome.storage.local` | MAIN-world injector untestable in Vitest per CONTEXT.md; manual DevTools verification is the gate |
| PUSH-05 (null) | `null` localStorage value does NOT trigger `LS_CHANGED` | unit | `vitest run src/shared/guard.test.ts -t "null"` | Extract `isValidPayload` to shared helper |
| PUSH-05 (empty array) | `[]` localStorage value does NOT trigger `LS_CHANGED` | unit | `vitest run src/shared/guard.test.ts -t "empty array"` | Same helper |
| PUSH-05 (non-array) | Non-array JSON does NOT trigger `LS_CHANGED` | unit | `vitest run src/shared/guard.test.ts -t "non-array"` | Same helper |
| PUSH-06 | Unknown fields on payload items are forwarded verbatim in `lastObserved.items` | unit | `vitest run src/background/message-handler.test.ts -t "unknown fields"` | See Recipe code example |
| D-02 | `lastObserved` snapshot written to `sysins:local:lastObserved` with correct shape | unit | `vitest run src/background/message-handler.test.ts -t "lastObserved"` | fakeBrowser |
| D-03 | `ensureInitialized()` called before `handleLsChanged()` — orphan recovery runs on LS_CHANGED messages | unit | `vitest run src/background/message-handler.test.ts -t "ensureInitialized"` | Set orphaned sentinel, fire LS_CHANGED, assert cleared |
| D-09 | 2-second polling fallback detects a write missed by the injector | manual | Open aistudio.google.com, disable MAIN-world injector temporarily, verify polling fires within 3s | Not automatable in Vitest |

### Wave 0 Gaps

- [ ] `src/shared/guard.ts` — `isValidPayload(value: string): boolean` helper
- [ ] `src/shared/guard.test.ts` — tests for null/empty/non-array/invalid-JSON cases (PUSH-05)
- [ ] `src/background/message-handler.ts` — `handleLsChanged()` function
- [ ] `src/background/message-handler.test.ts` — fakeBrowser tests for D-01/D-02/D-03/PUSH-06
- [ ] `src/content/index.ts` — relay content script (no test file needed beyond guard.test.ts)
- [ ] `src/injected/ls-observer.js` — plain JS injector (no automated test; DevTools verification)
- [ ] `wxt.config.ts` — add `web_accessible_resources` block

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `isValidPayload()` guard — JSON.parse in try/catch, Array.isArray check, non-empty check |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Spoofed `window.postMessage` from iframe or third-party script | Spoofing | `event.source !== window` filter before `event.data.source` filter |
| Malformed JSON in localStorage value (via XSS on aistudio.google.com) | Tampering | `JSON.parse()` in `try/catch` in the null/empty guard; malformed → silent skip |
| Oversized localStorage value crashing JSON parse | DoS | Implicit — the guard discards malformed JSON; SW's per-item oversized rejection (D-08, already in Phase 1) handles body-level size limits in Phase 3 |
| MAIN-world code exposure surface | Elevation of Privilege | Injector is ~15 lines of plain JS with no imports and no state — minimal attack surface per PITFALLS.md §MV3-3 |

---

## Sources

### Primary (HIGH confidence)
- [WXT docs — Content Scripts: Isolated World vs Main World](https://wxt.dev/guide/essentials/content-scripts) — `injectScript()` pattern, synchronous MV3 behavior, `world: 'MAIN'` caveat
- [WXT docs — injectScript() API](https://wxt.dev/api/reference/wxt/utils/inject-script/functions/injectscript) — function signature, `keepInDom` option, web_accessible_resources requirement
- [WXT docs — defineContentScript](https://wxt.dev/guide/essentials/entrypoints) — `runAt`, `world`, `registration` options
- [WXT docs — defineUnlistedScript](https://wxt.dev/guide/essentials/content-scripts) — unlisted script entrypoint pattern
- [Chrome runtime.onMessage API](https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onMessage) — `return true` requirement for async handlers
- Existing `.planning/research/ARCHITECTURE.md` — MAIN-world patch pattern, postMessage bridge, polling fallback spec, component responsibility boundaries [CITED directly throughout]
- Existing `.planning/research/PITFALLS.md` — AISTUDIO-2 (null guard), AISTUDIO-1 (unknown field stripping), MV3-3 (MAIN-world footprint) [CITED]
- Existing Phase 1 code — `src/background/index.ts`, `src/background/service-worker.test.ts`, `src/shared/constants.ts`, `src/shared/types.ts` [VERIFIED: file contents read]

### Secondary (MEDIUM confidence)
- WXT docs — web_accessible_resources configuration example [VERIFIED: wxt.dev]
- WXT API reference — `InjectScriptOptions.keepInDom` [VERIFIED: wxt.dev]
- WXT API reference — `EntrypointInfo.type` enum values including `"unlisted-script"` [VERIFIED: wxt.dev]

---

## Metadata

**Confidence breakdown:**
- WXT entrypoint registration (injectScript pattern): HIGH — verified against official WXT docs
- MAIN-world injection timing (document_start synchronous): HIGH — WXT docs explicitly state "For MV3, injectScript is synchronous"
- Content script guard pattern: HIGH — well-established, matches ARCHITECTURE.md and CONTEXT.md decisions
- SW onMessage handler pattern: HIGH — Chrome extension docs + existing Phase 1 test pattern
- `keepInDom: false` patch survival: MEDIUM (A2) — standard JS behavior but not explicitly confirmed in this session

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (30 days — WXT 0.20.x is stable; Chrome MV3 APIs are stable)

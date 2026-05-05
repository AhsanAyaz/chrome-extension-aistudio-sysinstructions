# Phase 2: Observation Pipeline - Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 9
**Analogs found:** 7 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/injected/ls-observer.js` | injector (MAIN-world) | event-driven | none in codebase | no-analog |
| `src/content/index.ts` | content-script relay | event-driven → request-response | none in codebase | no-analog |
| `src/shared/guard.ts` | utility (pure function) | transform | `src/background/storage-layout.ts` | role-match |
| `src/shared/types.ts` (modify) | type declarations | — | `src/shared/types.ts` (self) | exact |
| `src/shared/constants.ts` (modify) | constants | — | `src/shared/constants.ts` (self) | exact |
| `src/background/message-handler.ts` | service (SW sub-module) | request-response → CRUD | `src/background/sync-state.ts` | role-match |
| `src/background/index.ts` (modify) | service worker entrypoint | request-response | `src/background/index.ts` (self) | exact |
| `wxt.config.ts` (modify) | config | — | `wxt.config.ts` (self) | exact |
| `src/background/message-handler.test.ts` | test | — | `src/background/service-worker.test.ts` | exact |
| `src/shared/guard.test.ts` | test | — | `src/background/storage-layout.test.ts` | exact |

---

## Pattern Assignments

### `src/injected/ls-observer.js` (injector, MAIN-world, event-driven)

**Analog:** none — no existing MAIN-world scripts in the codebase.

**Use RESEARCH.md Pattern 2 directly.** This is a 15-line, self-contained plain JS file with no imports, no TypeScript, no WXT wrappers.

**Core pattern** (from 02-RESEARCH.md lines 272–284):
```javascript
// src/injected/ls-observer.js
// WATCHED_KEY cannot be imported from constants.ts (MAIN world: no module system).
// Canonical definition is in src/shared/constants.ts (WATCHED_LS_KEY).
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

**Rules to enforce:**
- D-06: NO parsing, NO validation, NO filtering. Post raw string verbatim.
- D-05: Literal `'aistudio_all_system_instructions'` with comment citing `src/shared/constants.ts`.
- `_setItem.apply(this, arguments)` must run BEFORE the postMessage so the real write always completes, even if the postMessage side-effects throw.

---

### `src/content/index.ts` (content-script relay, ISOLATED-world, event-driven)

**Analog:** none — no existing content scripts in the codebase.

**Use RESEARCH.md Pattern 1 as the template.** Key structural decisions to embed:

**Imports pattern** (from 02-RESEARCH.md lines 198–200):
```typescript
import { defineContentScript, injectScript } from 'wxt/utils';
import type { RawInstruction } from '../shared/types';
import { isValidPayload } from '../shared/guard';
```

**WXT entrypoint wrapper** — mirrors the `defineBackground` wrapper in `src/background/index.ts` lines 59–71:
```typescript
export default defineContentScript({
  matches: ['https://aistudio.google.com/*'],
  runAt: 'document_start',
  async main() {
    // ...
  },
});
```

**Inject + listen core pattern** (from 02-RESEARCH.md lines 208–235):
```typescript
async main() {
  // Step 1: synchronous MAIN-world patch (must precede any page JS)
  await injectScript('/injected/ls-observer.js', { keepInDom: false });

  // Step 2: postMessage bridge
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;                          // D-10: iframe spoof guard
    if (event.data?.source !== 'sysins-injected') return;        // D-10: source filter
    if (event.data.type !== 'LS_SET') return;

    if (!isValidPayload(event.data.value as string)) return;     // D-07: null/empty guard

    chrome.runtime.sendMessage({
      type: 'LS_CHANGED',
      payload: JSON.parse(event.data.value as string) as RawInstruction[],
    });
  });

  // Step 3: 2-second polling fallback (D-09)
  let lastSnapshot: string | null = null;
  setInterval(() => {
    const value = localStorage.getItem('aistudio_all_system_instructions');
    if (value === lastSnapshot) return;       // diff guard — no duplicate fires
    lastSnapshot = value;
    if (value === null) return;
    if (!isValidPayload(value)) return;       // D-07 applies to polling path too

    chrome.runtime.sendMessage({
      type: 'LS_CHANGED',
      payload: JSON.parse(value) as RawInstruction[],
    });
  }, 2000);
},
```

**Rules to enforce:**
- D-07: `isValidPayload` must gate BOTH the postMessage path and the polling path.
- D-08: `JSON.parse(value)` forwarded verbatim — no field stripping.
- D-09: `lastSnapshot` diff guard prevents firing on every tick.
- `event.source !== window` filter MUST appear before `event.data?.source` check (Pitfall 3).
- `runAt: 'document_start'` is mandatory (Pitfall 1 — AI Studio writes happen before `document_idle`).
- `keepInDom: false` — removes the `<script>` tag after execution; prototype patch survives (Pitfall 5).

---

### `src/shared/guard.ts` (utility, pure function, transform)

**Analog:** `src/background/storage-layout.ts` — same pure-function utility pattern with no chrome.* I/O, no side effects.

**Imports pattern** (from `src/background/storage-layout.ts` — no imports needed for guard; it is dependency-free):
```typescript
// No imports required — guard is a pure function over a string argument.
```

**Core pattern** — extract from RESEARCH.md OQ-2 recommendation:
```typescript
/**
 * Returns true iff `value` is a valid, non-empty JSON array.
 * Used by the content script relay to enforce Hard Rule #4 (D-07 / PUSH-05):
 * null/missing/empty reads are never forwarded as LS_CHANGED.
 *
 * Also reusable by the Phase 3 push engine.
 */
export function isValidPayload(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  return Array.isArray(parsed) && parsed.length > 0;
}
```

**Why extracted (not inlined in content script):**
- Testable with plain Vitest, no DOM setup required (OQ-2 recommendation).
- Reusable by Phase 3 push engine without content-script import.

---

### `src/shared/types.ts` (modify — add RawInstruction, LastObservedSnapshot)

**Analog:** `src/shared/types.ts` (self) — additions follow the established pattern of interface blocks with doc-comment lines citing decision IDs.

**Existing pattern to match** (lines 1–3, 5–10 of `src/shared/types.ts`):
```typescript
// All Phase 1 storage shape type declarations.
// D-03 / D-12 / D-13 / D-14 / D-15 — type shape lock.

// sysins:meta — D-03 / D-09 / D-11
export interface SyncMeta {
  schemaVersion: 1;
  lastPushAt: number;
  lastPullAt: number;
}
```

**Additions to append** (from 02-RESEARCH.md lines 354–376):
```typescript
// Shape of one item as AI Studio writes it to localStorage.
// Index signature preserves unknown fields verbatim — D-08 / PUSH-06.
// title and text are the only currently known fields.
export interface RawInstruction {
  title: string;
  text: string;
  [unknownAiStudioField: string]: unknown;
}

// sysins:local:lastObserved — D-02
// Written by Phase 2's onMessage stub; read by Phase 3's push engine
// as the starting snapshot for the first diff cycle.
// Phase 3 transition: superseded by sysins:local:lastPushed (D-12)
// once Phase 3 runs a successful push.
export interface LastObservedSnapshot {
  lastObservedAt: number;  // epoch ms
  itemCount: number;
  items: RawInstruction[];
}
```

**Note:** `BodyPayload` in the existing file already uses `[unknownAiStudioField: string]: unknown` (line 25) — `RawInstruction` follows the identical index-signature convention.

---

### `src/shared/constants.ts` (modify — add LAST_OBSERVED_KEY, WATCHED_LS_KEY)

**Analog:** `src/shared/constants.ts` (self) — additions follow the pattern of single-line exports at the bottom of the file.

**Existing pattern to match** (lines 1–14 of `src/shared/constants.ts`):
```typescript
// Single source of truth for all sysins:* storage key names and numeric constants.
// D-24: Magic numbers are forbidden inline anywhere in src/.

export const KEY_PREFIX = 'sysins:';
export const LOCAL_KEY_PREFIX = 'sysins:local:';
// ... etc
```

**Pattern for key construction** (from `src/background/sync-state.ts` lines 15–18 — how existing `sysins:local:*` keys are formed):
```typescript
// sync-state.ts constructs keys from LOCAL_KEY_PREFIX:
export const SYNC_STATUS_KEY  = `${LOCAL_KEY_PREFIX}syncStatus`;
export const SYNC_PENDING_KEY = `${LOCAL_KEY_PREFIX}syncPending`;
export const LAST_PUSHED_KEY  = `${LOCAL_KEY_PREFIX}lastPushed`;
```

**Additions to append to constants.ts** (from 02-RESEARCH.md lines 386–394):
```typescript
// Key under sysins:local:* for the Phase 2 observed snapshot.
// Phase 3 reads this key as the initial diff baseline.
export const LAST_OBSERVED_KEY = 'sysins:local:lastObserved';

// The localStorage key AI Studio uses for system instructions.
// Cannot be imported by the MAIN-world injector (no module system there) —
// that file uses a hardcoded literal with a comment pointing here.
export const WATCHED_LS_KEY = 'aistudio_all_system_instructions';
```

**Consistency note:** `LAST_OBSERVED_KEY` uses the string literal form `'sysins:local:lastObserved'` (same style as `META_KEY = 'sysins:meta'`), NOT a template literal like sync-state.ts does. Both styles are present; for exported constants the literal form is preferred here so the value is visible at a glance.

---

### `src/background/message-handler.ts` (service, request-response → CRUD)

**Analog:** `src/background/sync-state.ts` — same pattern: a service sub-module that owns all `chrome.storage.local` I/O for a specific concern, imported by `index.ts`.

**Imports pattern** (mirrors `src/background/sync-state.ts` lines 1–11):
```typescript
import { LAST_OBSERVED_KEY } from '../shared/constants';
import type { RawInstruction, LastObservedSnapshot } from '../shared/types';
```

**Core pattern** (from 02-RESEARCH.md lines 315–329):
```typescript
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

**Write pattern** — copy the single-key `chrome.storage.local.set` idiom from `src/background/sync-state.ts` line 35:
```typescript
await chrome.storage.local.set({ [SYNC_STATUS_KEY]: clean });
// → becomes:
await chrome.storage.local.set({ [LAST_OBSERVED_KEY]: snapshot });
```

---

### `src/background/index.ts` (modify — add onMessage listener)

**Analog:** `src/background/index.ts` (self) — addition follows the `chrome.runtime.onInstalled.addListener` pattern established at lines 60–63.

**Existing entrypoint pattern to extend** (lines 59–71 of `src/background/index.ts`):
```typescript
export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await initializeMeta();
    await ensureInitialized();
  });

  // Phase 1 boundary discipline:
  //   - No chrome.runtime.onMessage listener (Phase 2)   ← REPLACE THIS COMMENT
  //   ...
});
```

**New listener to add** (from 02-RESEARCH.md lines 333–343):
```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LS_CHANGED') {
    // D-03: ensureInitialized on every SW wake from a CS message
    ensureInitialized()
      .then(() => handleLsChanged(message.payload as RawInstruction[]))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep port open for async response (Pitfall 2)
  }
  // return undefined for unhandled types — Chrome closes port immediately
});
```

**New import to add** at top of file:
```typescript
import { handleLsChanged } from './message-handler';
import type { RawInstruction } from '../shared/types';
```

**Critical:** `return true` inside the `if` block — not at the end of the function. Unhandled message types must NOT return `true` (that would keep the port open forever for unknown messages).

---

### `wxt.config.ts` (modify — add web_accessible_resources)

**Analog:** `wxt.config.ts` (self) — addition to the existing `manifest` block.

**Existing manifest block to extend** (lines 7–15 of `wxt.config.ts`):
```typescript
manifest: {
  name: 'AI Studio Instructions Sync',
  description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
  version: '0.1.0',
  minimum_chrome_version: '116',
  permissions: ['storage', 'scripting'],
  host_permissions: ['https://aistudio.google.com/*'],
  // No <all_urls>, no identity, no tabs, no notifications. Matches D-19 verbatim.
},
```

**Addition** (from 02-RESEARCH.md lines 295–305):
```typescript
web_accessible_resources: [
  {
    resources: ['injected/ls-observer.js'],
    matches: ['https://aistudio.google.com/*'],
  },
],
```

**Host scope discipline:** Use `https://aistudio.google.com/*` (not `*://*/*`) — consistent with `host_permissions` already in the manifest.

**Entrypoints hook:** No change needed. The existing denylist hook (lines 17–26) filters only `*.test.ts` — `content/index.ts` and `injected/ls-observer.js` pass through automatically (confirmed: hook is a denylist, not an allowlist).

---

### `src/background/message-handler.test.ts` (test, fakeBrowser pattern)

**Analog:** `src/background/service-worker.test.ts` — exact pattern match for `fakeBrowser`-based SW sub-module tests.

**Imports pattern** (mirrors `src/background/service-worker.test.ts` lines 1–12):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { _resetForTesting } from './index';
import { handleLsChanged } from './message-handler';
import { LAST_OBSERVED_KEY } from '../shared/constants';
import type { LastObservedSnapshot } from '../shared/types';
```

**beforeEach reset pattern** (mirrors lines 14–17 of `service-worker.test.ts`):
```typescript
beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
});
```

**Test structure** (from 02-RESEARCH.md lines 550–561):
```typescript
describe('handleLsChanged (D-01, D-02, PUSH-06)', () => {
  it('writes lastObserved snapshot to chrome.storage.local', async () => {
    const payload = [{ title: 'T', text: 'A', extraField: 'preserved' }];
    await handleLsChanged(payload);

    const r = await chrome.storage.local.get(LAST_OBSERVED_KEY);
    const snap = r[LAST_OBSERVED_KEY] as LastObservedSnapshot;
    expect(snap.itemCount).toBe(1);
    expect(snap.items[0]!.extraField).toBe('preserved'); // PUSH-06 unknown field preserved
    expect(snap.lastObservedAt).toBeGreaterThan(0);
  });
});
```

**D-03 test pattern** (assert ensureInitialized runs — set orphaned sentinel, fire handler, assert cleared):
```typescript
it('ensureInitialized clears orphaned sentinel when called via LS_CHANGED (D-03)', async () => {
  const { SYNC_PENDING_KEY } = await import('./sync-state');
  await chrome.storage.local.set({
    [SYNC_PENDING_KEY]: { batchId: 'orphan', keys: [], startedAt: Date.now() - 90_000 },
  });
  // D-03: ensureInitialized must be called by the onMessage handler before handleLsChanged
  // Test this by calling ensureInitialized + handleLsChanged in sequence (mirrors index.ts chain)
  const { ensureInitialized } = await import('./index');
  await ensureInitialized();
  await handleLsChanged([{ title: 'T', text: 'A' }]);

  const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
  expect(r[SYNC_PENDING_KEY]).toBeUndefined(); // orphan cleared
});
```

---

### `src/shared/guard.test.ts` (test, pure function)

**Analog:** `src/background/storage-layout.test.ts` — pure-function tests with no `fakeBrowser`, no `beforeEach`, no async. Straightforward `describe` + `it` + `expect`.

**Imports pattern** (mirrors `src/background/storage-layout.test.ts` lines 1–3):
```typescript
import { describe, it, expect } from 'vitest';
import { isValidPayload } from './guard';
```

**Test structure** (from 02-RESEARCH.md lines 568–586 — these are must-have per the CONTEXT.md §Specifics):
```typescript
describe('isValidPayload (PUSH-05, D-07)', () => {
  it('returns false for null JSON', () => {
    expect(isValidPayload('null')).toBe(false);
  });
  it('returns false for empty array', () => {
    expect(isValidPayload('[]')).toBe(false);
  });
  it('returns false for non-array object', () => {
    expect(isValidPayload('{"key":"val"}')).toBe(false);
  });
  it('returns false for a bare string JSON value', () => {
    expect(isValidPayload('"string"')).toBe(false);
  });
  it('returns false for invalid JSON', () => {
    expect(isValidPayload('not-json')).toBe(false);
  });
  it('returns true for a non-empty array', () => {
    expect(isValidPayload('[{"title":"T","text":"A"}]')).toBe(true);
  });
});
```

---

## Shared Patterns

### WXT Entrypoint Wrapper
**Source:** `src/background/index.ts` lines 1, 59
**Apply to:** `src/content/index.ts`
```typescript
import { defineContentScript } from 'wxt/utils';
export default defineContentScript({ ... });
```
All WXT entrypoints follow this `define*` wrapper export pattern — it is required for WXT to recognize the file as a typed entrypoint.

---

### chrome.storage.local Single-Key Read Pattern
**Source:** `src/background/sync-state.ts` lines 24–27
**Apply to:** `src/background/message-handler.ts` (write), any future reader of `LAST_OBSERVED_KEY`
```typescript
const r = await chrome.storage.local.get(KEY);
return (r[KEY] as ExpectedType | undefined) ?? defaultValue;
```
Always cast the result with `as Type | undefined` — `chrome.storage.local.get` returns `Record<string, unknown>`.

---

### chrome.storage.local Single-Key Write Pattern
**Source:** `src/background/sync-state.ts` line 35
**Apply to:** `src/background/message-handler.ts`
```typescript
await chrome.storage.local.set({ [KEY]: value });
```
Single batched `set({...})` call — Hard Rule #3 forbids per-item write loops.

---

### Import from Shared Constants (D-24)
**Source:** `src/background/sync-state.ts` lines 1–4, `src/background/index.ts` line 7
**Apply to:** `src/background/message-handler.ts`, `src/content/index.ts`
```typescript
import { LAST_OBSERVED_KEY, WATCHED_LS_KEY } from '../shared/constants';
import type { RawInstruction, LastObservedSnapshot } from '../shared/types';
```
D-24: No magic strings or numbers inline — all keys and constants come from `src/shared/constants.ts`.

---

### fakeBrowser Test Setup
**Source:** `src/background/service-worker.test.ts` lines 14–17
**Apply to:** `src/background/message-handler.test.ts`
```typescript
beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
});
```
`fakeBrowser.reset()` clears all simulated chrome.storage state between tests. `_resetForTesting()` resets the SW module's `inMemoryState`. Both must be called — omitting either causes test pollution.

---

### vitest.config.ts — globals: false
**Source:** `vitest.config.ts` lines 8–9
**Apply to:** All test files
```typescript
globals: false,
```
All test imports must be explicit: `import { describe, it, expect, beforeEach } from 'vitest'`. Do NOT rely on global `describe`/`it`/`expect`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/injected/ls-observer.js` | MAIN-world injector | event-driven | No MAIN-world scripts exist in the codebase. Use RESEARCH.md Pattern 2 directly. |
| `src/content/index.ts` | content-script relay | event-driven → request-response | No content scripts exist in the codebase. Use RESEARCH.md Pattern 1 directly. |

---

## Metadata

**Analog search scope:** `src/background/`, `src/shared/`, `wxt.config.ts`, `vitest.config.ts`
**Files scanned:** 9 (index.ts, sync-state.ts, meta-bootstrap.ts, constants.ts, types.ts, storage-layout.ts, service-worker.test.ts, storage-layout.test.ts, wxt.config.ts)
**Pattern extraction date:** 2026-05-06

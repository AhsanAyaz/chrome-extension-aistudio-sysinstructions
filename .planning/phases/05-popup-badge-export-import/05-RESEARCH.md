# Phase 5: Popup, Badge, and Export/Import — Research

**Researched:** 2026-05-06
**Domain:** Svelte 5 + WXT popup entrypoint, MV3 chrome.action badge, JSON export/import via SW message
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Popup reads `chrome.storage.local` (syncStatus, pendingMerges) and `chrome.storage.sync` (registry) directly — no GET_STATUS message roundtrip to SW. "Never talk to chrome.storage.sync" applies to *writes* only.
- **D-02:** Instruction list shows registry-only data: title + updatedAt per item. No body fetch for the list view.
- **D-03:** Popup uses `chrome.storage.onChanged` for live updates — reacts to syncStatus and registry changes automatically without polling.
- **D-04:** Push Now / Pull Now buttons send fire-and-forget messages: `PUSH_NOW` and `PULL_NOW`. No sendResponse ack needed.
- **D-05:** Popup UI updates reactively via `chrome.storage.onChanged` on syncStatus. SW sets state to 'syncing' then 'idle'/'error' as it works.
- **D-06:** Healthy (idle, no errors) = empty badge — `setBadgeText({ text: '' })`. Badge signals problems only.
- **D-07:** No syncing indicator during active sync. Error badge appears only on failure. No transient amber '~' state.
- **D-08:** Import uses a hidden `<input type="file">` inside the popup. No dedicated import page.
- **D-09:** Import sends payload via `IMPORT_ITEMS` message to SW. SW routes every item through the standard merge path.
- **D-10:** Export includes live items only (`deletedAt === null`). Schema: `{ title, text, uuid, updatedAt }`.
- **D-11:** Phase 5 adds `@wxt-dev/module-svelte` to `wxt.config.ts`.

### Claude's Discretion

- Popup Svelte component structure (single App.svelte vs sub-components)
- Error message copy for each ErrorState enum value
- Exact timestamp display format — locale-relative ("2 min ago") chosen per UI-SPEC
- Export filename convention: `aistudio-instructions-YYYY-MM-DD.json`

### Deferred Ideas (OUT OF SCOPE)

- Quota usage indicator (v2 requirement UI2-01)
- Conflict transparency (UI2-02)
- Tombstone GC (UI2-03)
- Body text preview in instruction list
- Dedicated import page

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Popup shows last sync timestamp, sync state (idle/syncing/error), and instruction count | D-01 direct reads + D-03 onChanged reactivity enable real-time status header |
| UI-02 | Popup lists every instruction with title and per-item updatedAt; reflects merged state | D-02 registry-only read from chrome.storage.sync; onChanged keeps it live |
| UI-03 | "Push now" button flushes pending writes immediately | PUSH_NOW message → SW calls `flushPendingWrite()` from alarm-flush.ts directly |
| UI-04 | "Pull now" button forces fresh read from chrome.storage.sync | PULL_NOW message → SW calls `handleRemoteChanged()` with current registry as "changed" |
| UI-05 | Popup shows explicit error state for quota/sync-unavail/account-mismatch/malformed | ErrorState enum + error banner per UI-SPEC; errorCopy map in App.svelte |
| UI-06 | Badge reflects sync health: empty = healthy, '!' amber = attention, '!' red = error | Phase 3 already handles amber/red; Phase 5 adds empty-text on healthy (D-06) |
| EXPORT-01 | "Export to JSON" produces human-readable JSON file with all live instructions | Blob + anchor click in popup page context (no downloads permission needed) |
| EXPORT-02 | "Import from JSON" ingests exported file through standard merge path | Hidden file input → FileReader → validate → IMPORT_ITEMS message → SW merge |

</phase_requirements>

---

## Summary

Phase 5 is a thin UI layer over a proven sync engine. The core research question is: how do Svelte 5, WXT's module system, and MV3 popup lifecycle constraints fit together? The answers are all well-defined.

The popup entrypoint follows a standard WXT pattern: `src/popup/index.html` loads `main.ts`, which mounts the root Svelte component. Svelte 5's `$state`, `$derived`, and `onMount`/`onDestroy` lifecycle functions provide all the reactivity needed. The popup reads storage directly (D-01), subscribes to `chrome.storage.onChanged` for live updates (D-03), and sends fire-and-forget messages for user actions (D-04). No new chrome APIs beyond what already exists in the codebase are required except `chrome.action.setBadgeText` (already used in alarm-flush.ts).

Export is straightforward: fetch registry from `chrome.storage.sync`, body chunks from sync, build JSON array, create a Blob, and trigger an anchor-click download — all from popup page DOM context. This requires no `downloads` permission and no service worker involvement. Import validates the file in the popup, then sends the payload via `IMPORT_ITEMS` to the SW, which routes it through `diffAndAccumulate` (the same path as a live edit) followed by `scheduleFlush`.

**Primary recommendation:** Mount one `App.svelte` root component in `main.ts`. Split into sub-components (`StatusHeader.svelte`, `InstructionList.svelte`, `ActionRow.svelte`, `BannerRow.svelte`) for readability. All chrome storage interaction stays in `App.svelte` top-level via `onMount`/`onDestroy` — sub-components receive state as props.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Display sync status | Browser/Popup | — | Popup reads chrome.storage.local directly (D-01); no SW roundtrip needed |
| Display instruction list | Browser/Popup | — | Registry read from chrome.storage.sync directly (D-01, D-02) |
| Live update on storage change | Browser/Popup | — | chrome.storage.onChanged subscribed in popup (D-03) |
| Push Now action | Service Worker | Popup (sends message) | SW calls flushPendingWrite(); popup sends PUSH_NOW fire-and-forget (D-04) |
| Pull Now action | Service Worker | Popup (sends message) | SW calls handleRemoteChanged(); popup sends PULL_NOW fire-and-forget (D-04) |
| Badge update | Service Worker | — | chrome.action is only callable from SW context in MV3 |
| JSON export | Browser/Popup | — | Blob + anchor click in popup DOM; bodies fetched from sync |
| JSON import validation | Browser/Popup | — | File parsing and field validation in popup before sending to SW |
| Import merge routing | Service Worker | — | IMPORT_ITEMS handler calls diffAndAccumulate + scheduleFlush (D-09) |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| svelte | 5.55.5 | Popup UI component system | Already in CLAUDE.md tech stack; Svelte 5 runes are the correct API |
| @wxt-dev/module-svelte | 2.0.5 | WXT plugin that wires Vite's svelte-vite plugin | Required to compile .svelte files in WXT build; D-11 |
| wxt | 0.20.25 | Already installed | Handles entrypoint discovery, popup HTML, TypeScript |

[VERIFIED: npm registry — @wxt-dev/module-svelte@2.0.5 published 2026-03-19; svelte@5.55.5 confirmed]

### No New Libraries Needed

| Problem | No Library Because |
|---------|-------------------|
| Timestamp formatting | Hand-roll 5-line `relativeTime(ms)` function; logic is trivial (< 60s, < 60m, < 24h, < 7d, else ISO) |
| File download | Blob + anchor click; zero-dependency, DOM is available in popup page |
| File import | `FileReader` or `file.text()` (native); no lib needed |
| UUID for imported items (if missing) | `crypto.randomUUID()` — already used throughout codebase |

### Installation

```bash
npm install svelte
npm install --save-dev @wxt-dev/module-svelte
```

**Version verification:** `npm view @wxt-dev/module-svelte version` → 2.0.5 (2026-03-19). [VERIFIED: npm registry]

---

## Architecture Patterns

### System Architecture Diagram

```
User clicks toolbar icon
        │
        ▼
  [Popup page loads]
  src/popup/index.html
  src/popup/main.ts → mount(App, { target: #app })
        │
        ├──── onMount ──────────────────────────────────────────────┐
        │                                                           │
        │  chrome.storage.local.get(SYNC_STATUS_KEY)               │
        │  chrome.storage.sync.get(REGISTRY_KEY)                   │
        │  → initial $state hydration                              │
        │                                                           │
        │  chrome.storage.onChanged.addListener(handler)            │
        │  → updates $state on every storage write                  │
        │  → returned from onMount for cleanup in onDestroy         │
        │                                                           │
        ▼                                                           │
  [App.svelte renders]                                             │
  ┌─────────────────────────────────┐                              │
  │  StatusHeader                   │◄─── $state: syncStatus      │
  │  (state, lastSyncAt, count)     │◄─── $state: registry        │
  ├─────────────────────────────────┤                              │
  │  InstructionList (scrollable)   │◄─── $derived: liveItems     │
  │  title + relativeTime(updatedAt)│                              │
  ├─────────────────────────────────┤                              │
  │  ActionRow                      │                              │
  │  [Push Now] [Pull Now]          │──── chrome.runtime.sendMessage(PUSH_NOW / PULL_NOW)
  ├─────────────────────────────────┤          │
  │  ExportImportRow                │          ▼
  │  [Export JSON] [Import JSON]    │     Service Worker
  ├─────────────────────────────────┤     ├── PUSH_NOW → flushPendingWrite()
  │  BannerRow (conditional)        │     ├── PULL_NOW → handleRemoteChanged()
  │  error banner OR refresh hint   │     └── IMPORT_ITEMS → diffAndAccumulate() → scheduleFlush()
  └─────────────────────────────────┘
        │                      │
   Export flow              Import flow
        │                      │
  chrome.storage.sync.get    <input type="file"> → file.text()
  (registry + body chunks)   → JSON.parse → validate
  → build JSON array         → IMPORT_ITEMS message → SW
  → Blob → anchor click
  → browser download
        │
        ▼
  [Popup closed — onDestroy removes onChanged listener]
```

### Recommended Project Structure

```
src/
├── popup/
│   ├── index.html         ← WXT popup entrypoint (mounts main.ts)
│   ├── main.ts            ← mount(App, { target: document.getElementById('app') })
│   ├── App.svelte         ← root component: state, onChanged, chrome reads
│   ├── StatusHeader.svelte ← sync state + timestamp + count display
│   ├── InstructionList.svelte ← scrollable list of title + relativeTime
│   ├── ActionRow.svelte   ← Push Now + Pull Now buttons
│   ├── ExportImportRow.svelte ← Export JSON + Import JSON (file input)
│   ├── BannerRow.svelte   ← error + refresh-hint conditional banner
│   └── popup.css          ← scoped CSS (vanilla, no Tailwind)
├── background/
│   └── index.ts           ← add PUSH_NOW, PULL_NOW, IMPORT_ITEMS handlers
└── shared/
    └── constants.ts       ← SYNC_STATUS_KEY etc. already exported
```

### Pattern 1: WXT Popup Entrypoint with Svelte

WXT auto-discovers `src/popup/index.html` as the popup entrypoint (because `srcDir: 'src'` and `entrypointsDir: '.'`). The HTML loads `main.ts` as an ES module. The Svelte module transforms `.svelte` imports during the Vite build.

```html
<!-- src/popup/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI Studio Sync</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

```typescript
// src/popup/main.ts
// Source: Context7 /wxt-dev/wxt — popup entrypoint with Svelte
import { mount } from 'svelte';
import App from './App.svelte';
import './popup.css';

mount(App, { target: document.getElementById('app')! });
```

[VERIFIED: Context7 /wxt-dev/wxt — popup entrypoint pattern; Svelte 5 uses `mount`, not `new App()`]

### Pattern 2: Svelte 5 Reactive Popup with onMount

```svelte
<!-- src/popup/App.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { SyncStatus, SyncRegistry } from '../shared/types';
  import { SYNC_STATUS_KEY } from '../background/sync-state';
  import { REGISTRY_KEY } from '../shared/constants';

  // Source: Context7 /sveltejs/svelte — $state rune for reactive variables
  let syncStatus = $state<SyncStatus>({ state: 'idle', lastSyncAt: 0 });
  let registry = $state<SyncRegistry>({});
  let refreshHintDismissed = $state(false);

  // Derived: live items sorted by updatedAt desc
  // Source: Context7 /sveltejs/svelte — $derived rune
  let liveItems = $derived(
    Object.entries(registry)
      .filter(([, rec]) => rec.deletedAt === null)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
  );

  // Source: Context7 /sveltejs/svelte — onMount for setup; returns cleanup fn
  onMount(async () => {
    // Initial hydration from storage
    const [localData, syncData] = await Promise.all([
      chrome.storage.local.get(SYNC_STATUS_KEY),
      chrome.storage.sync.get(REGISTRY_KEY),
    ]);
    syncStatus = (localData[SYNC_STATUS_KEY] as SyncStatus) ?? { state: 'idle', lastSyncAt: 0 };
    registry = (syncData[REGISTRY_KEY] as SyncRegistry) ?? {};

    // Live updates via onChanged — D-03
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && SYNC_STATUS_KEY in changes) {
        syncStatus = changes[SYNC_STATUS_KEY]!.newValue as SyncStatus ?? { state: 'idle', lastSyncAt: 0 };
      }
      if (area === 'sync' && REGISTRY_KEY in changes) {
        registry = changes[REGISTRY_KEY]!.newValue as SyncRegistry ?? {};
      }
    }
    chrome.storage.onChanged.addListener(onChanged);

    // Return cleanup — onMount cleanup is called on component destroy
    return () => chrome.storage.onChanged.removeListener(onChanged);
  });

  // Push Now: fire-and-forget — D-04
  function pushNow() {
    chrome.runtime.sendMessage({ type: 'PUSH_NOW' }).catch(() => {/* SW may be inactive */});
  }

  // Pull Now: fire-and-forget — D-04
  function pullNow() {
    chrome.runtime.sendMessage({ type: 'PULL_NOW' }).catch(() => {/* SW may be inactive */});
  }
</script>
```

[VERIFIED: Context7 /sveltejs/svelte — $state, $derived, onMount with cleanup return value]

### Pattern 3: JSON Export (Popup Page DOM — No downloads Permission)

Export happens entirely in the popup page. The popup fetches body chunks from `chrome.storage.sync` directly (D-01 permits reads). No SW message needed.

```typescript
// Inside App.svelte <script>
async function exportJSON() {
  // Step 1: Read registry (already in $state — use current value)
  const liveUuids = Object.entries(registry)
    .filter(([, rec]) => rec.deletedAt === null);

  // Step 2: Fetch all body chunks in one batched get
  const bodyKeys: string[] = [];
  for (const [uuid, rec] of liveUuids) {
    for (let i = 0; i < rec.chunks; i++) {
      bodyKeys.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
    }
  }
  const bodyData = bodyKeys.length > 0
    ? await chrome.storage.sync.get(bodyKeys)
    : {};

  // Step 3: Reassemble and build export array (D-10 schema)
  const items = liveUuids.map(([uuid, rec]) => {
    const keys = Array.from({ length: rec.chunks }, (_, i) => `${BODY_KEY_PREFIX}${uuid}:c${i}`);
    const bodyJson = keys.map(k => (bodyData[k] as string) ?? '').join('');
    let text = '';
    try { text = (JSON.parse(bodyJson) as { text: string }).text; } catch { /* skip */ }
    return { title: rec.title, text, uuid, updatedAt: rec.updatedAt };
  });

  // Step 4: Trigger download via anchor click — works in popup DOM context
  // Source: WebSearch verified — anchor+Blob URL works in popup page; no 'downloads' permission needed
  const filename = `aistudio-instructions-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

[VERIFIED: WebSearch — anchor+Blob URL download works in MV3 popup page context; service worker cannot use DOM but popup is a full page]

### Pattern 4: JSON Import (Hidden File Input + FileReader)

```svelte
<!-- Invisible file input wired to Import button -->
<input
  type="file"
  accept=".json"
  style="display:none"
  bind:this={fileInput}
  onchange={handleFileSelected}
/>
<button onclick={() => fileInput.click()}>Import JSON</button>
```

```typescript
// Source: UI-SPEC Import Validation Rules
let fileInput: HTMLInputElement;
let importMessage = $state('');

async function handleFileSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    importMessage = 'Import failed: file is not valid JSON.';
    return;
  }

  if (!Array.isArray(parsed)) {
    importMessage = 'Import failed: file is not valid JSON.';
    return;
  }

  const invalid = parsed.filter(
    (item) => typeof item?.title !== 'string' || !item.title ||
              typeof item?.text !== 'string' || !item.text
  );
  if (invalid.length > 0) {
    importMessage = `Import failed: ${invalid.length} item(s) missing title or text. No items were imported.`;
    return;
  }

  // All valid — send to SW for merge routing (D-09)
  chrome.runtime.sendMessage({ type: 'IMPORT_ITEMS', payload: parsed }).catch(() => {});
  importMessage = `Imported ${parsed.length} instruction(s). Syncing now.`;
}
```

[VERIFIED: UI-SPEC Import Validation Rules — all-or-nothing validation; `file.text()` is the modern FileReader equivalent]

### Pattern 5: SW Message Handler Extensions (index.ts)

```typescript
// Add to the onMessage listener in src/background/index.ts
if (message?.type === 'PUSH_NOW') {
  // D-04: fire-and-forget — no sendResponse needed
  void ensureInitialized().then(() => flushPendingWrite());
  return false; // no async response
}

if (message?.type === 'PULL_NOW') {
  // Force a pull by reading current registry and treating it as "changed"
  void ensureInitialized().then(async () => {
    const r = await chrome.storage.sync.get(REGISTRY_KEY);
    const fakeChanges = {
      [REGISTRY_KEY]: { newValue: r[REGISTRY_KEY] }
    };
    await handleRemoteChanged(fakeChanges as Record<string, chrome.storage.StorageChange>, 'sync');
  });
  return false;
}

if (message?.type === 'IMPORT_ITEMS') {
  // Route imported items through the standard push path (D-09)
  if (!Array.isArray(message.payload)) return false;
  void ensureInitialized()
    .then(() => diffAndAccumulate(message.payload as RawInstruction[]))
    .then(() => scheduleFlush());
  return false;
}
```

[VERIFIED: Existing index.ts patterns — LS_CHANGED uses `return true` for async response; PUSH_NOW/PULL_NOW/IMPORT_ITEMS are fire-and-forget so `return false`]

### Pattern 6: Badge — Healthy State Clear (Phase 5 Addition)

Phase 3 (`alarm-flush.ts`) already sets amber/red badges on error. Phase 5 adds the healthy-state clear when `writeSyncStatus({ state: 'idle', ... })` succeeds. This is already done in `flushPendingWrite()` at line 175:

```typescript
await chrome.action.setBadgeText({ text: '' }); // already in alarm-flush.ts
```

Phase 5 only needs to also clear the badge when `PULL_NOW` completes successfully (in `handleRemoteChanged`, mirror the same call). No new badge logic needed for the healthy empty state.

[VERIFIED: alarm-flush.ts line 175 — `setBadgeText({ text: '' })` already exists on push success]

### Anti-Patterns to Avoid

- **Polling in popup:** Do not use `setInterval` to refresh state. Use `chrome.storage.onChanged` (D-03). Polling causes battery drain and is unnecessary.
- **Svelte 4 reactive declarations in Svelte 5:** Do not use `$:` syntax. Use `$state`, `$derived`, `$effect` (Svelte 5 runes API).
- **`new App()`:** Svelte 5 popup entry uses `mount(App, { target })`, not `new App({ target })` (Svelte 4 API).
- **Import entire registry body for list view:** D-02 prohibits body fetch in list. Only `title` and `updatedAt` from registry.
- **Writing to chrome.storage.sync from popup:** D-01 clarification — reads are OK; writes go through SW only.
- **chrome.downloads for export:** Requires adding `'downloads'` to permissions manifest. Use Blob + anchor click instead — no permission needed in popup context.
- **Leaking onChanged listener:** Return the `removeListener` call from `onMount` (not `onDestroy`) so WXT/Svelte handles cleanup automatically.
- **fire-and-forget without catch:** `chrome.runtime.sendMessage` rejects if SW is inactive. Always `.catch(() => {})`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reactive state in popup | Custom event emitter or polling | Svelte 5 `$state` + `chrome.storage.onChanged` | Native reactivity; no polling overhead |
| Component compilation | Custom build script | WXT + `@wxt-dev/module-svelte` | Module handles Vite plugin wiring |
| File download | `chrome.downloads` API | Blob + anchor click | No extra permission; simpler in popup DOM |
| Body assembly for export | Custom fetch loop | `chrome.storage.sync.get(allBodyKeys)` one call | Single batched get avoids rate pressure |

**Key insight:** All the complex logic (merge, UUID, chunking, conflict resolution) is already in the service worker from Phase 3/4. Phase 5 only wires up the UI surface.

---

## Common Pitfalls

### Pitfall 1: chrome.action Cannot Be Called from Popup Context

**What goes wrong:** `chrome.action.setBadgeText` called from popup code throws "Extensions using event pages or service workers cannot use this API." In MV3, `chrome.action` badge writes are only permitted from the service worker context.

**Why it happens:** The popup page is a renderer process. Badge management is a background-only API in MV3.

**How to avoid:** All badge writes stay in `alarm-flush.ts` and the SW `handleRemoteChanged` success path. Popup only reads `syncStatus` from local storage — never calls badge APIs.

**Warning signs:** "Cannot call chrome.action from extension page" error in popup devtools.

### Pitfall 2: chrome.storage.onChanged Fires for Local + Sync Areas

**What goes wrong:** Popup subscribes to `onChanged` but processes all areas, causing it to re-render on irrelevant writes (e.g., `sysins:local:lastPushed` changes after every flush).

**Why it happens:** `onChanged` fires for both `local` and `sync` area changes with no default filter.

**How to avoid:** Always gate on `area === 'local'` for syncStatus updates and `area === 'sync'` for registry updates. Already established pattern in `index.ts` line 121.

**Warning signs:** Popup flickers or re-renders excessively during a flush.

### Pitfall 3: Popup Closes Before Async Message Completes

**What goes wrong:** User clicks "Push Now", popup closes (user clicks elsewhere), SW receives no message because the message port is gone.

**Why it happens:** Popup is a short-lived document. When it closes, any pending `sendMessage` calls are abandoned.

**How to avoid:** PUSH_NOW and PULL_NOW are fire-and-forget (D-04). `chrome.runtime.sendMessage` dispatches the message before the popup can close; the SW receives it even if the popup is gone by then. This is normal and correct for fire-and-forget.

**Warning signs:** Not actually a problem — MV3 message dispatch is synchronous on the sender side.

### Pitfall 4: WXT Entrypoint Discovery vs. Svelte Files

**What goes wrong:** WXT tries to treat `App.svelte` or other `.svelte` files in `src/popup/` as additional entrypoints.

**Why it happens:** WXT scans `entrypointsDir` (which is `src/` in this project) for entrypoints. `.svelte` files in the popup folder could confuse it.

**How to avoid:** `@wxt-dev/module-svelte` handles `.svelte` compilation through Vite, not through WXT's entrypoint scanner. WXT only discovers `index.html` as the popup entrypoint. Sub-components are imported by `main.ts` and bundled normally. The existing `entrypoints:found` hook already filters `.test.ts` — `.svelte` files are handled by the Vite transform, not the scanner.

**Warning signs:** Build error "entrypoint type unknown for App.svelte".

### Pitfall 5: `file.text()` vs FileReader API

**What goes wrong:** Using the callback-based `FileReader.readAsText()` instead of the modern promise-based `file.text()`, making the import handler unnecessarily complex.

**Why it happens:** FileReader is legacy; `File.prototype.text()` is the modern equivalent, available in all Chrome 76+ environments (well within the extension's minimum_chrome_version of 116).

**How to avoid:** Use `await file.text()` directly. No FileReader boilerplate needed.

### Pitfall 6: Import Message Returns Before SW Has Processed

**What goes wrong:** Popup shows "Imported N instructions. Syncing now." but the user sees no badge change because `scheduleFlush()` defers the actual write by 30 seconds.

**Why it happens:** Import routes through `diffAndAccumulate` + `scheduleFlush`. The flush alarm fires 30s later.

**How to avoid:** This is correct behavior — document it in copy. "Syncing now" means "sync queued". The badge will update when the alarm fires. If immediate flush is desired, the IMPORT_ITEMS handler can call `flushPendingWrite()` directly instead of `scheduleFlush()` (planner decision).

**Warning signs:** User confusion — mitigate with clear copy ("Syncing now" sets correct expectations).

### Pitfall 7: Svelte 5 onMount Cleanup Pattern

**What goes wrong:** Developer uses `onDestroy` separately instead of returning cleanup from `onMount`, leaving a subtle ordering risk.

**Why it happens:** Svelte 4 required `onDestroy` as a separate call. Svelte 5 supports both, but returning cleanup from `onMount` is simpler.

**How to avoid:** Return the `removeListener` function from `onMount`:
```typescript
onMount(() => {
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
});
```

[VERIFIED: Context7 /sveltejs/svelte — "return cleanup function (alternative to onDestroy)"]

---

## Code Examples

### Relative Timestamp Helper

```typescript
// Source: UI-SPEC "Timestamp display rule" — no library, 5-line hand-roll
export function relativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(epochMs).toISOString().slice(0, 10); // YYYY-MM-DD
}
```

### Error State Copy Map

```typescript
// Source: UI-SPEC "Error State Copy" section
import type { ErrorState } from '../shared/types';

export const ERROR_COPY: Record<ErrorState, string> = {
  QUOTA_EXCEEDED: 'Sync storage is full. Delete unused instructions to free space.',
  RATE_LIMITED: 'Sync rate limit hit. Will retry automatically in 1 minute.',
  SCHEMA_AHEAD: 'Remote data uses a newer schema. Update the extension to continue syncing.',
  SCHEMA_UNKNOWN: 'Remote data schema is unrecognised. Sync paused to protect your data.',
  MALFORMED_REMOTE: 'Remote sync data is corrupted. Try a manual Pull or re-install on the other device.',
  ACCOUNT_MISMATCH: "AI Studio account doesn't match your Chrome profile. Sign in to the same account to resume sync.",
  OVERSIZED_ITEM: 'One instruction is too large to sync (exceeds chunk budget). Shorten it to continue.',
  STRICT_VALIDATION_FAIL: 'An unexpected sync error occurred. Check the DevTools console for details.',
  PENDING_MERGE_OVERFLOW: 'Too many remote changes queued. Some older changes were skipped to prevent data loss.',
};
```

### wxt.config.ts Addition (D-11)

```typescript
// Source: Context7 /wxt-dev/wxt — @wxt-dev/module-svelte configuration
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.',
  modules: ['@wxt-dev/module-svelte'],  // ← Phase 5 addition (D-11)
  // ... rest unchanged
});
```

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 5 |
|-----------|------------------|
| Popup = dumb view; never writes to chrome.storage.sync | Popup reads sync directly (D-01 permit for reads); all writes go through SW messages |
| All merge logic lives in SW (Hard Rule 6) | Import handler in popup only validates; sends IMPORT_ITEMS to SW |
| Every chrome.storage.sync write is single batched set() (Hard Rule 3) | IMPORT_ITEMS → diffAndAccumulate → pendingWrite → flushPendingWrite (already batched) |
| No third-party calls (DIST-04) | Export/Import are local file operations only; no network calls |
| Error surfacing built alongside sync engine (Hard Rule 7) | Phase 3 already writes syncStatus; popup just renders it |
| All sync state persisted to chrome.storage.local (Hard Rule 9) | Popup reads SYNC_STATUS_KEY from local; never relies on in-memory SW globals |
| Svelte 5.55.5 for popup UI | Use $state, $derived, onMount — not Svelte 4 reactive declarations |
| crypto.randomUUID() for UUIDs (not uuid npm package) | SW assigns UUIDs during diffAndAccumulate; popup never generates UUIDs |
| No Tailwind, no shadcn, no component library | Vanilla CSS in Svelte SFCs (confirmed by UI-SPEC) |
| Minimum Chrome 116 | file.text(), crypto.randomUUID(), Blob — all available since Chrome 76+ |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `new App({ target })` | `mount(App, { target })` from 'svelte' | Svelte 5 (5.0.0) | Svelte 4 constructor API removed |
| `$:` reactive labels | `$derived(expr)` | Svelte 5 | More explicit; TypeScript-friendly |
| `on:click={handler}` | `onclick={handler}` | Svelte 5 | No colon in event names |
| `export let prop` | `let { prop } = $props()` | Svelte 5 | Props destructuring pattern |
| `chrome.browserAction` | `chrome.action` | MV3 (Chrome 88+) | Unified action API; old namespace removed |

**Deprecated/outdated:**
- `FileReader` callbacks: replaced by `file.text()` (Promise-based, Chrome 76+)
- Svelte 4 lifecycle `$:` blocks: replaced by `$effect`/`$derived` in Svelte 5
- `chrome.browserAction.setBadgeText`: removed in MV3; use `chrome.action.setBadgeText`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| svelte | Popup compilation | Needs install | 5.55.5 (npm) | — |
| @wxt-dev/module-svelte | WXT Svelte build | Needs install | 2.0.5 (npm) | — |
| wxt | Build | ✓ | 0.20.25 | — |
| node / npm | Install | ✓ | node v22.13.1 | — |
| chrome.storage.onChanged | Live popup updates | ✓ (runtime) | MV3 | — |
| chrome.action | Badge writes (SW) | ✓ (already used) | MV3 | — |
| URL.createObjectURL | Popup export | ✓ (popup DOM) | Chrome 76+ | — |
| File.prototype.text() | Popup import | ✓ | Chrome 76+ | FileReader |

**Missing dependencies with no fallback:** svelte + @wxt-dev/module-svelte must be installed before build.

**Missing dependencies with fallback:** none that affect runtime.

---

## Validation Architecture

> `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. This section is SKIPPED.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Extension reads existing Chrome identity; no new auth |
| V3 Session Management | no | No session tokens; popup is stateless |
| V4 Access Control | partial | Popup must not write to chrome.storage.sync directly (D-01 enforced by code review) |
| V5 Input Validation | yes | Import file validated: JSON parse, title/text field presence, all-or-nothing |
| V6 Cryptography | no | No new crypto; UUIDs via crypto.randomUUID() already established |

### Known Threat Patterns for MV3 Popup + File Import

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed JSON import crashing SW | Tampering | Validate in popup before sending IMPORT_ITEMS; SW also ignores invalid payload |
| Import with huge text bodies exceeding chunk budget | Tampering/DoS | diffAndAccumulate handles oversized items via OVERSIZED_ITEM error path (Phase 3) |
| XSS via instruction title in popup | Tampering | Svelte auto-escapes text interpolations — `{item.title}` is safe; never use `{@html}` |
| Export file containing PII | Information Disclosure | Export is user-initiated, user saves to their own machine — acceptable |
| Storage write to sync from popup | Elevation of Privilege | D-01 is a code discipline rule; no technical enforcement needed beyond code review |

---

## Open Questions

1. **PULL_NOW implementation — real pull vs. fake-changed event**
   - What we know: `handleRemoteChanged` takes `changes` and `areaName`. We can pass `{ [REGISTRY_KEY]: { newValue: currentRegistry } }` as fake changes.
   - What's unclear: Does `applyRemote(remoteRegistry)` when remoteRegistry === local registry produce any change? If not, `handleRemoteChanged` returns early (no-op for idempotent state).
   - Recommendation: For PULL_NOW, read the current sync registry and pass it as the "new value" — this re-triggers the full pull path including `reconstructInstructions` and `deliverToTab`. It is idempotent and correct.

2. **IMPORT_ITEMS: `scheduleFlush` vs `flushPendingWrite` immediately**
   - What we know: `scheduleFlush` defers flush by ~30s. PUSH_NOW bypasses the alarm via `flushPendingWrite` directly.
   - What's unclear: Should import also flush immediately, or should it queue normally?
   - Recommendation: For import, call `flushPendingWrite()` directly (same as PUSH_NOW behavior). Import is an explicit user action that should push immediately. The popup copy says "Syncing now" which implies immediate action.

3. **build.test.ts permissions assertion — needs update**
   - What we know: The existing DIST-02 test asserts exact permission set: `['alarms', 'identity', 'identity.email', 'scripting', 'storage']`.
   - What's unclear: Does adding the popup entrypoint require any new manifest permissions?
   - Recommendation: No new permissions needed. Popup reads storage (already permitted), sends messages to SW (no permission needed), uses Blob download (no permission). The permissions assertion in build.test.ts does not need updating. `'downloads'` permission is intentionally NOT needed because we use Blob + anchor click.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `file.text()` Promise API is available in popup page context | Code Examples | Low — Chrome 76+ is well within the minimum_chrome_version 116 requirement [ASSUMED, but safe] |
| A2 | PULL_NOW can be implemented by passing current registry as fake `changes` to `handleRemoteChanged` | Pattern 5 | Medium — if `applyRemote` no-ops on identical registry, pull delivers stale data; planner should verify |
| A3 | `@wxt-dev/module-svelte` 2.0.5 is compatible with `wxt` 0.20.25 | Standard Stack | Medium — version matrix not explicitly verified; npm peerDeps check recommended during install |

---

## Sources

### Primary (HIGH confidence)
- Context7 `/wxt-dev/wxt` — popup entrypoint HTML structure, Svelte module configuration, entrypoint directory conventions
- Context7 `/sveltejs/svelte` — $state, $derived, onMount cleanup pattern, mount/unmount API
- Context7 `/llmstxt/svelte_dev_llms-small_txt` — Svelte 5 runes overview, $props, event handler syntax
- `src/background/alarm-flush.ts` (this codebase) — existing badge API usage patterns
- `src/background/index.ts` (this codebase) — onMessage dispatch pattern, fire-and-forget vs async
- `src/shared/types.ts` (this codebase) — SyncStatus, ErrorState, SyncRegistry shapes
- `src/shared/constants.ts` (this codebase) — all key constants popup will import
- `wxt.config.ts` (this codebase) — entrypointsDir layout confirming `src/popup/` path
- npm registry — @wxt-dev/module-svelte@2.0.5 (2026-03-19), svelte@5.55.5

### Secondary (MEDIUM confidence)
- Context7 `/websites/wxt_dev` — popup entrypoint meta tag configuration, Svelte content script pattern (extrapolated to popup)
- WebSearch — anchor+Blob URL download in MV3 popup page (confirmed works; service worker limitation does not apply to popup)

### Tertiary (LOW confidence)
- None — all claims verified via codebase inspection or Context7

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified via npm registry and existing codebase
- Architecture: HIGH — based on actual codebase code paths + WXT docs
- Pitfalls: HIGH — derived from existing codebase patterns and established Phase 3/4 decisions
- Svelte 5 patterns: HIGH — verified via Context7 official Svelte docs

**Research date:** 2026-05-06
**Valid until:** 2026-06-05 (Svelte 5 and WXT APIs are stable; 30 day window)

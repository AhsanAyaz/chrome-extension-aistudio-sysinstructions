# Phase 5: Popup, Badge, and Export/Import — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 10 new/modified files
**Analogs found:** 9 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/popup/index.html` | config | request-response | `wxt.config.ts` (WXT structure) | partial |
| `src/popup/main.ts` | utility | request-response | `src/content/index.ts` (WXT entrypoint mount) | role-match |
| `src/popup/App.svelte` | component | request-response | `src/content/index.ts` (storage + onChanged pattern) | partial |
| `src/popup/StatusHeader.svelte` | component | request-response | none — new pattern | no-analog |
| `src/popup/InstructionList.svelte` | component | request-response | none — new pattern | no-analog |
| `src/popup/ActionRow.svelte` | component | request-response | `src/content/index.ts` (fireAndForget messaging) | partial |
| `src/popup/ExportImportRow.svelte` | component | file-I/O | `src/background/alarm-flush.ts` (storage.sync.get batched read) | partial |
| `src/popup/BannerRow.svelte` | component | request-response | `src/shared/types.ts` (ErrorState enum source) | partial |
| `src/popup/popup.css` | config | — | none — hand-rolled per UI-SPEC | no-analog |
| `src/background/index.ts` | middleware | request-response | `src/background/index.ts` (existing onMessage switch) | exact |
| `wxt.config.ts` | config | — | `wxt.config.ts` (itself — add modules line) | exact |

---

## Pattern Assignments

### `src/popup/index.html` (config, popup entrypoint)

**Analog:** `wxt.config.ts` (WXT conventions) + RESEARCH.md Pattern 1

WXT auto-discovers `src/popup/index.html` as the popup entrypoint because `entrypointsDir: '.'` and `srcDir: 'src'` are set. The HTML structure must load `main.ts` as an ES module.

**Entrypoint HTML pattern** (from RESEARCH.md Pattern 1, verified against wxt.config.ts line 5):
```html
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

**WXT entrypoint filter hook** (wxt.config.ts lines 26-32 — already filters `.test.ts`; Svelte files handled by Vite transform, not scanner):
```typescript
'entrypoints:found': (_wxt, infos) => {
  const before = infos.length;
  infos.splice(
    0,
    before,
    ...infos.filter((info) => !info.inputPath.endsWith('.test.ts')),
  );
},
```

---

### `src/popup/main.ts` (utility, Svelte mount)

**Analog:** `src/content/index.ts` (WXT defineContentScript entrypoint pattern)

Content script uses `defineContentScript` with an `async main()`. Popup uses bare `mount()` instead — simpler because popup is a full page, not an isolated content script.

**WXT entrypoint mount pattern** (from RESEARCH.md Pattern 1, Svelte 5 API):
```typescript
import { mount } from 'svelte';
import App from './App.svelte';
import './popup.css';

mount(App, { target: document.getElementById('app')! });
```

Note: Svelte 5 uses `mount(App, { target })` — NOT `new App({ target })` (Svelte 4 API removed).

---

### `src/popup/App.svelte` (component, request-response + storage reads)

**Analog:** `src/content/index.ts` + `src/background/sync-state.ts`

The content script's `chrome.storage.local.get` + `chrome.storage.onChanged.addListener` pattern (lines 151-184) is the closest analog for the popup's storage read + live update subscription. The popup reads both `local` and `sync` areas on mount, then subscribes for changes.

**Imports pattern** — following the codebase's import discipline (constants from shared, types from shared):
```typescript
import { onMount } from 'svelte';
import type { SyncStatus, SyncRegistry } from '../shared/types';
import { SYNC_STATUS_KEY } from '../background/sync-state';
import { REGISTRY_KEY, BODY_KEY_PREFIX } from '../shared/constants';
```

**Storage initialization pattern** (analog: content/index.ts lines 151-157, adapted for two storage areas):
```typescript
onMount(async () => {
  const [localData, syncData] = await Promise.all([
    chrome.storage.local.get(SYNC_STATUS_KEY),
    chrome.storage.sync.get(REGISTRY_KEY),
  ]);
  syncStatus = (localData[SYNC_STATUS_KEY] as SyncStatus) ?? { state: 'idle', lastSyncAt: 0 };
  registry = (syncData[REGISTRY_KEY] as SyncRegistry) ?? {};

  function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area === 'local' && SYNC_STATUS_KEY in changes) {
      syncStatus = changes[SYNC_STATUS_KEY]!.newValue as SyncStatus ?? { state: 'idle', lastSyncAt: 0 };
    }
    if (area === 'sync' && REGISTRY_KEY in changes) {
      registry = changes[REGISTRY_KEY]!.newValue as SyncRegistry ?? {};
    }
  }
  chrome.storage.onChanged.addListener(onChanged);
  return () => chrome.storage.onChanged.removeListener(onChanged);
});
```

**Area guard pattern** (analog: index.ts lines 121-126 — areaName gate on onChanged):
```typescript
// src/background/index.ts line 122-126
chrome.storage.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'sync') return;
    if (!(REGISTRY_KEY in changes)) return;
    void ensureInitialized().then(() => handleRemoteChanged(changes, areaName));
  }
);
```
Popup mirrors this area-guard discipline — gate on `area === 'local'` for syncStatus, `area === 'sync'` for registry.

**Fire-and-forget sendMessage pattern** (analog: content/index.ts lines 34-38):
```typescript
function fireAndForget(payload: object): void {
  if (!isContextValid()) return;
  chrome.runtime.sendMessage(payload).catch(() => {
    // SW may be inactive; message dropped intentionally.
  });
}
```
Popup version (D-04, no isContextValid check needed — popup is always in a valid context):
```typescript
function pushNow() {
  chrome.runtime.sendMessage({ type: 'PUSH_NOW' }).catch(() => {/* SW may be inactive */});
}
function pullNow() {
  chrome.runtime.sendMessage({ type: 'PULL_NOW' }).catch(() => {/* SW may be inactive */});
}
```

**Svelte 5 reactive state declarations** (Svelte 5 runes — not Svelte 4 `$:` syntax):
```typescript
let syncStatus = $state<SyncStatus>({ state: 'idle', lastSyncAt: 0 });
let registry = $state<SyncRegistry>({});
let refreshHintDismissed = $state(false);
let importMessage = $state('');

let liveItems = $derived(
  Object.entries(registry)
    .filter(([, rec]) => rec.deletedAt === null)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
);
```

**Export function pattern** (analog: alarm-flush.ts lines 87-101 — batched sync.get for body chunks):
```typescript
async function exportJSON() {
  const liveUuids = Object.entries(registry)
    .filter(([, rec]) => rec.deletedAt === null);

  const bodyKeys: string[] = [];
  for (const [uuid, rec] of liveUuids) {
    for (let i = 0; i < rec.chunks; i++) {
      bodyKeys.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
    }
  }
  const bodyData = bodyKeys.length > 0
    ? await chrome.storage.sync.get(bodyKeys)
    : {};

  const items = liveUuids.map(([uuid, rec]) => {
    const keys = Array.from({ length: rec.chunks }, (_, i) => `${BODY_KEY_PREFIX}${uuid}:c${i}`);
    const bodyJson = keys.map(k => (bodyData[k] as string) ?? '').join('');
    let text = '';
    try { text = (JSON.parse(bodyJson) as { text: string }).text; } catch { /* skip */ }
    return { title: rec.title, text, uuid, updatedAt: rec.updatedAt };
  });

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

**Import validation and send pattern** (D-09 all-or-nothing):
```typescript
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

  chrome.runtime.sendMessage({ type: 'IMPORT_ITEMS', payload: parsed }).catch(() => {});
  importMessage = `Imported ${parsed.length} instruction(s). Syncing now.`;
}
```

---

### `src/popup/StatusHeader.svelte` (component, display)

**Analog:** none — new Svelte sub-component pattern. Receives props from App.svelte.

**Svelte 5 props pattern** (`$props()` destructuring — not Svelte 4 `export let`):
```svelte
<script lang="ts">
  import type { SyncStatus } from '../shared/types';
  let { syncStatus, itemCount }: { syncStatus: SyncStatus; itemCount: number } = $props();
</script>
```

**relativeTime utility** (hand-rolled per RESEARCH.md Code Examples):
```typescript
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
  return new Date(epochMs).toISOString().slice(0, 10);
}
```

---

### `src/popup/InstructionList.svelte` (component, display)

**Analog:** none — new Svelte sub-component. Receives `liveItems` (derived array from App.svelte) as prop.

**Svelte 5 props + each block pattern**:
```svelte
<script lang="ts">
  import type { RegistryRecord } from '../shared/types';
  let { items }: { items: Array<[string, RegistryRecord]> } = $props();
</script>

{#each items as [uuid, rec] (uuid)}
  <div class="row">
    <span class="title">{rec.title}</span>
    <span class="timestamp">{relativeTime(rec.updatedAt)}</span>
  </div>
{:else}
  <div class="empty">No instructions yet</div>
{/each}
```

Note: Svelte 5 event handlers use `onclick={handler}` not `on:click={handler}`.

---

### `src/popup/ActionRow.svelte` (component, request-response)

**Analog:** `src/content/index.ts` lines 34-38 (fireAndForget pattern)

Receives `pushNow` and `pullNow` callbacks as props from App.svelte. Sends fire-and-forget messages. Disabled state during `syncStatus.state === 'syncing'`.

**Svelte 5 event handler syntax** (Svelte 5 — no colon):
```svelte
<button onclick={pushNow} disabled={isSyncing}>Push Now</button>
<button onclick={pullNow} disabled={isSyncing}>Pull Now</button>
```

---

### `src/popup/ExportImportRow.svelte` (component, file-I/O)

**Analog:** `src/background/alarm-flush.ts` (batched sync.get read pattern, lines 116-118)

Hidden file input pattern — clicking the Import button programmatically triggers the hidden input:
```svelte
<input
  type="file"
  accept=".json"
  style="display:none"
  bind:this={fileInput}
  onchange={handleFileSelected}
/>
<button onclick={() => fileInput.click()}>Import JSON</button>
<button onclick={exportJSON}>Export JSON</button>
```

---

### `src/popup/BannerRow.svelte` (component, conditional display)

**Analog:** `src/shared/types.ts` (ErrorState union type, lines 51-59)

**Error copy map** (from RESEARCH.md Code Examples, matches UI-SPEC Error State Copy table):
```typescript
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

Conditional rendering (Svelte 5 — `{#if}` unchanged from Svelte 4):
```svelte
{#if syncStatus.state === 'error' && syncStatus.errorState}
  <div class="banner banner-error">
    {ERROR_COPY[syncStatus.errorState]}
  </div>
{:else if showRefreshHint}
  <div class="banner banner-hint">
    Pull applied — refresh AI Studio to see changes.
    <button onclick={dismissHint}>×</button>
  </div>
{/if}
```

---

### `src/background/index.ts` — Add PUSH_NOW / PULL_NOW / IMPORT_ITEMS handlers (middleware, request-response)

**Analog:** `src/background/index.ts` itself — exact match. Phase 5 extends the existing `onMessage.addListener` switch.

**Existing onMessage pattern** (index.ts lines 80-107):
```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LS_CHANGED') {
    if (!Array.isArray(message.payload)) {
      sendResponse({ ok: false, error: 'invalid payload' });
      return true;
    }
    ensureInitialized()
      .then(() => handleLsChanged(message.payload as RawInstruction[], message.pageEmail as string | undefined))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep port open for async response
  }
  // return undefined for unhandled message types — Chrome closes port immediately
});
```

**New handlers to add** — fire-and-forget, `return false` (no async response needed):
```typescript
if (message?.type === 'PUSH_NOW') {
  void ensureInitialized().then(() => flushPendingWrite());
  return false; // no async response
}

if (message?.type === 'PULL_NOW') {
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
  if (!Array.isArray(message.payload)) return false;
  void ensureInitialized()
    .then(() => diffAndAccumulate(message.payload as RawInstruction[]))
    .then(() => flushPendingWrite()); // immediate flush (user-explicit action)
  return false;
}
```

**Required new imports** to add at top of index.ts:
```typescript
import { flushPendingWrite } from './alarm-flush';       // already imported
import { handleRemoteChanged } from './pull-engine';     // already imported
import { diffAndAccumulate } from './push-engine';        // NEW — add this import
```

**Placement** — add the three new `if` blocks before the final `// return undefined` comment at line 107, after the existing LS_BOOTSTRAP block (line 106).

---

### `wxt.config.ts` — Add Svelte module (config)

**Analog:** `wxt.config.ts` itself — exact match (add one line).

**Current state** (wxt.config.ts line 6 comment):
```typescript
// No `modules: ['@wxt-dev/module-svelte']` in Phase 1 — Svelte is Phase 5.
```

**Phase 5 change** (D-11) — replace the comment with the modules declaration:
```typescript
export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.',
  modules: ['@wxt-dev/module-svelte'],  // Phase 5 addition (D-11)
  manifest: {
    // ... rest unchanged
  },
});
```

---

## Shared Patterns

### chrome.storage Key Discipline
**Source:** `src/shared/constants.ts` lines 6-41
**Apply to:** All popup files that read storage

All storage key names come from `src/shared/constants.ts` or `src/background/sync-state.ts`. Never use string literals for key names. Pattern:
```typescript
import { REGISTRY_KEY, BODY_KEY_PREFIX } from '../shared/constants';
import { SYNC_STATUS_KEY } from '../background/sync-state';
```

### chrome.storage.onChanged Area Guard
**Source:** `src/background/index.ts` lines 121-127
**Apply to:** `App.svelte` onChanged handler

Always gate on `area` before processing changes — `onChanged` fires for both `local` and `sync` writes:
```typescript
function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area === 'local' && SYNC_STATUS_KEY in changes) { /* ... */ }
  if (area === 'sync' && REGISTRY_KEY in changes) { /* ... */ }
}
```

### Fire-and-Forget sendMessage with .catch()
**Source:** `src/content/index.ts` lines 34-38
**Apply to:** `App.svelte` (pushNow, pullNow, handleFileSelected), `ActionRow.svelte`

```typescript
chrome.runtime.sendMessage({ type: 'PUSH_NOW' }).catch(() => {/* SW may be inactive */});
```
Never omit `.catch()` — sendMessage rejects when SW is inactive.

### Batched chrome.storage.sync.get (single call)
**Source:** `src/background/alarm-flush.ts` lines 116-118 and push-engine.ts lines 77-80
**Apply to:** `App.svelte` exportJSON function

```typescript
const bodyData = bodyKeys.length > 0
  ? await chrome.storage.sync.get(bodyKeys)
  : {};
```
Collect all keys first, then call `.get()` once — never loop with individual `.get()` calls.

### onMessage Return Value Convention
**Source:** `src/background/index.ts` lines 90-106
**Apply to:** New PUSH_NOW / PULL_NOW / IMPORT_ITEMS handlers in index.ts

- `return true` — keep port open for async sendResponse (used by LS_CHANGED, LS_BOOTSTRAP)
- `return false` — fire-and-forget, no sendResponse (used by PUSH_NOW, PULL_NOW, IMPORT_ITEMS)
- `return undefined` (implicit) — unhandled message type, Chrome closes port

### Error Handling in SW Handlers
**Source:** `src/background/index.ts` lines 86-90 and 100-104
**Apply to:** New handlers in index.ts

Existing handlers use `.catch((err) => sendResponse(...))` pattern. Fire-and-forget handlers swallow errors with `void`:
```typescript
void ensureInitialized()
  .then(() => flushPendingWrite())
  // No .catch needed — flushPendingWrite has its own try/catch with badge writes
```

### TypeScript Import Style
**Source:** All background files — `import type` for type-only imports
**Apply to:** All new `.svelte` and `.ts` files

```typescript
import type { SyncStatus, SyncRegistry, ErrorState } from '../shared/types';
import { REGISTRY_KEY } from '../shared/constants';
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/popup/popup.css` | config | — | No existing CSS files in project; hand-roll per UI-SPEC spacing/color tokens |
| `src/popup/StatusHeader.svelte` | component | display | No existing Svelte components in project |
| `src/popup/InstructionList.svelte` | component | display | No existing Svelte components in project |

For these files, use RESEARCH.md patterns + UI-SPEC design tokens directly. The UI-SPEC section "Spacing Scale" and "Color" are the authoritative sources for CSS values.

---

## Test Pattern Reference

For any Phase 5 unit tests, copy the test setup pattern from `src/background/alarm-flush.test.ts` lines 1-34:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  // fakeBrowser does not implement chrome.action badge methods — stub them
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});
```

For index.ts message handler tests, also call `_resetForTesting()` in `beforeEach` (see `src/background/message-handler.test.ts` line 10).

---

## Metadata

**Analog search scope:** `src/background/`, `src/content/`, `src/shared/`, `wxt.config.ts`
**Files scanned:** 12 source files read in full
**Pattern extraction date:** 2026-05-06

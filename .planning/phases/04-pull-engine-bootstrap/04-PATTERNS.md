# Phase 4: Pull Engine + Bootstrap - Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/background/pull-engine.ts` | service | event-driven | `src/background/push-engine.ts` | role-match |
| `src/background/bootstrap.ts` | service | CRUD | `src/background/message-handler.ts` + `src/background/registry.ts` | role-match |
| `src/background/index.ts` | config/entrypoint | event-driven | `src/background/index.ts` (self) | exact |
| `src/content/index.ts` | middleware/relay | event-driven | `src/content/index.ts` (self) | exact |
| `src/shared/constants.ts` | config | — | `src/shared/constants.ts` (self) | exact |
| `src/shared/types.ts` | model | — | `src/shared/types.ts` (self) | exact |
| `wxt.config.ts` | config | — | `wxt.config.ts` (self) | exact |
| `src/background/pull-engine.test.ts` | test | event-driven | `src/background/push-engine.test.ts` | exact |
| `src/background/bootstrap.test.ts` | test | CRUD | `src/background/push-engine.test.ts` | role-match |

---

## Pattern Assignments

### `src/background/pull-engine.ts` (service, event-driven)

**Analog:** `src/background/push-engine.ts` (overall module structure) + `src/background/alarm-flush.ts` (chrome.storage write + error patterns)

**Imports pattern** (push-engine.ts lines 17-31):
```typescript
import {
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
  PENDING_WRITE_KEY,
} from '../shared/constants';
import type {
  SyncRegistry,
  RegistryRecord,
  LastPushedSnapshot,
  RawInstruction,
} from '../shared/types';
import { splitIntoChunks } from './storage-layout';
import { shortHash } from './hash';
import { getRegistry } from './registry';
import { readLastPushed, SYNC_PENDING_KEY } from './sync-state';
```

Phase 4 pull-engine imports pattern — derive from analog; replace push-specific imports:
```typescript
// src/background/pull-engine.ts — Phase 4 imports
import {
  REGISTRY_KEY,
  PENDING_REMOTE_KEY,
} from '../shared/constants';
import type {
  SyncRegistry,
  RawInstruction,
  ApplyRemoteMessage,
  PendingRemoteState,
} from '../shared/types';
import { applyRemote, reconstructInstructions } from './registry';
import { LAST_PUSHED_KEY, writeSyncStatus, setErrorState } from './sync-state';
```

**Core pattern — chrome.storage.onChanged handler (RESEARCH.md Pattern 1):**
```typescript
// No "tabs" permission needed — host_permissions covers URL-matching query
// Register at module top-level in index.ts (not inside defineBackground)
chrome.storage.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'sync') return;
    if (!(REGISTRY_KEY in changes)) return;
    void handleRemoteChanged(changes);
  }
);
```

**Core pattern — async handler function body:**
```typescript
export async function handleRemoteChanged(
  changes: Record<string, chrome.storage.StorageChange>,
): Promise<void> {
  const registryChange = changes[REGISTRY_KEY];
  if (registryChange === undefined) return;

  const remoteRegistry = registryChange.newValue as SyncRegistry | undefined;
  if (remoteRegistry === undefined) return; // key deleted — shouldn't happen

  await applyRemote(remoteRegistry);
  const merged = await reconstructInstructions();
  const mergedPayload: RawInstruction[] = merged.map(({ title, text }) => ({ title, text }));

  // D-04: update lastPushed to reflect merged state — prevents spurious push alarm
  // (call writeLastPushed from alarm-flush.ts or replicate the same local.set pattern)

  await deliverToTab(mergedPayload);
}
```

**deliverToTab with D-07/D-08 fallback (RESEARCH.md Pattern 2+3):**
```typescript
// host_permissions for aistudio.google.com/* makes "tabs" permission unnecessary
async function deliverToTab(payload: RawInstruction[]): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: '*://aistudio.google.com/*',
    active: true,
  });
  const tab = tabs[0];

  if (tab?.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_REMOTE',
        payload,
      } satisfies ApplyRemoteMessage);
      return;
    } catch {
      // Content script not ready — fall through to pendingRemote (D-08)
    }
  }

  // D-08: no active tab or sendMessage failed → persist for visibilitychange pickup
  const state: PendingRemoteState = { payload, enqueuedAt: Date.now() };
  await chrome.storage.local.set({ [PENDING_REMOTE_KEY]: state });
}
```

**Error handling pattern** — copy from alarm-flush.ts lines 162-189:
```typescript
// Error reporting uses setErrorState() from sync-state.ts — same as alarm-flush.ts
// badge colors: amber '#F59E0B' for retryable, red '#EF4444' for fatal
try {
  await chrome.storage.sync.set(batch);
  // ...
} catch (err) {
  const msg = String(err);
  if (msg.includes('MAX_WRITE_OPERATIONS_PER_MINUTE') || msg.includes('RATE_LIMIT')) {
    await setErrorState('RATE_LIMITED', msg);
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
  } else {
    await setErrorState('STRICT_VALIDATION_FAIL', msg);
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  }
}
```

**Logging pattern** — copy from push-engine.ts lines 155-158:
```typescript
// T-03-02-b applies to pull too: log only counts, never instruction text content
console.log('[sysins] pull-engine: applied', mergedPayload.length, 'item(s) from remote');
```

---

### `src/background/bootstrap.ts` (service, CRUD)

**Analog:** `src/background/message-handler.ts` (handler dispatch pattern) + `src/background/registry.ts` (applyRemote, UUID assignment pattern)

**Imports pattern** (message-handler.ts lines 1-3):
```typescript
import type { RawInstruction } from '../shared/types';
import { diffAndAccumulate } from './push-engine';
import { scheduleFlush } from './alarm-flush';
```

Phase 4 bootstrap imports — derive from analog:
```typescript
// src/background/bootstrap.ts — Phase 4 imports
import {
  REGISTRY_KEY,
  BOOTSTRAP_NEEDED_KEY,
} from '../shared/constants';
import type {
  SyncRegistry,
  RawInstruction,
  ApplyRemoteMessage,
} from '../shared/types';
import { getRegistry, applyRemote, reconstructInstructions } from './registry';
```

**Core pattern — handler (mirrors handleLsChanged in message-handler.ts lines 19-31):**
```typescript
export async function handleLsBootstrap(payload: RawInstruction[]): Promise<void> {
  console.log('[sysins] bootstrap: received', payload.length, 'local item(s)');

  // 1. Assign UUIDs to local-only items, build a local registry slice
  // 2. applyRemote(localRegistry) — union merge (Hard Rule 5)
  // 3. reconstructInstructions() — rebuild live array
  // 4. Send APPLY_REMOTE back to the tab (same deliverToTab as pull-engine)
  // 5. Clear BOOTSTRAP_NEEDED_KEY atomically after success
  await chrome.storage.local.remove(BOOTSTRAP_NEEDED_KEY);
}
```

**UUID assignment pattern — copy structure from push-engine.ts lines 96-109:**
```typescript
// Build reverse lookup: title → uuid for live remote entries only (D-06)
// IDENTICAL pattern to diffAndAccumulate in push-engine.ts lines 95-99
const titleToUuid = new Map<string, string>();
for (const [uuid, rec] of Object.entries(remoteRegistry)) {
  if (rec.deletedAt === null) {
    titleToUuid.set(rec.title, uuid);
  }
}

// For each local item: find a remote match by title, or assign fresh UUID (D-17)
const now = Date.now();
const localRegistry: SyncRegistry = {};
for (const item of localItems) {
  const existingUuid = titleToUuid.get(item.title);
  const uuid = existingUuid ?? crypto.randomUUID();
  if (localRegistry[uuid] === undefined) { // first-match wins (D-06 collision rule)
    localRegistry[uuid] = {
      title: item.title,
      updatedAt: now,
      deletedAt: null,
      chunks: 1, // placeholder; body written in the batch set
    };
  }
}
```

**Flag-clear pattern — copy from alarm-flush.ts lines 166-168 (clearPendingWrite pattern):**
```typescript
// SW clears BOOTSTRAP_NEEDED_KEY after successful union merge (D-05 / Pitfall 3)
// CS never clears it — if SW fails, flag persists for retry on next page load
await chrome.storage.local.remove(BOOTSTRAP_NEEDED_KEY);
```

**Batched local write pattern — copy from push-engine.ts lines 169-177:**
```typescript
// Hard Rule 3 applies to local writes too — single batched set(), no per-key loops
await chrome.storage.local.set({
  [PENDING_WRITE_KEY]: batch,
  [SYNC_PENDING_KEY]: { batchId: crypto.randomUUID(), keys: Object.keys(batch), startedAt: Date.now() },
});
```

---

### `src/background/index.ts` (config/entrypoint, event-driven) — MODIFIED

**Analog:** `src/background/index.ts` (self — add to existing Phase 3+ boundary block)

**Existing listener registration pattern** (index.ts lines 62-97) — Phase 4 adds to the same `defineBackground` callback:
```typescript
export default defineBackground(() => {
  // ... existing Phase 2/3 listeners ...

  // Phase 4: chrome.storage.onChanged — pull engine wake
  // Registered at top-level (synchronous) so SW receives the event even on cold wake
  chrome.storage.onChanged.addListener(
    (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync') return;
      if (!(REGISTRY_KEY in changes)) return;
      void ensureInitialized().then(() => handleRemoteChanged(changes));
    }
  );

  // Phase 4: onInstalled — write bootstrapNeeded flag (D-05)
  // The existing onInstalled already calls initializeMeta + ensureInitialized;
  // Phase 4 extends it with the bootstrapNeeded write.
});
```

**onInstalled pattern extension** (index.ts lines 63-66):
```typescript
chrome.runtime.onInstalled.addListener(async (details) => {
  await initializeMeta();
  await ensureInitialized();
  // Phase 4 addition:
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });
  }
});
```

**LS_BOOTSTRAP message handler — copy async-response pattern from index.ts lines 71-83:**
```typescript
// In the existing onMessage listener, add LS_BOOTSTRAP as a second case
// following the same structure as LS_CHANGED (return true for async response)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LS_CHANGED') {
    // ... existing Phase 3 handler ...
    return true;
  }
  if (message?.type === 'LS_BOOTSTRAP') {
    if (!Array.isArray(message.payload)) {
      sendResponse({ ok: false, error: 'invalid payload' });
      return true;
    }
    ensureInitialized()
      .then(() => handleLsBootstrap(message.payload as RawInstruction[]))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep port open for async response
  }
  // return undefined for unhandled message types
});
```

**_resetForTesting seam** (index.ts lines 58-60) — no change; pull-engine tests use the same seam:
```typescript
export function _resetForTesting(): void {
  inMemoryState = { initialized: false };
}
```

---

### `src/content/index.ts` (middleware/relay, event-driven) — MODIFIED

**Analog:** `src/content/index.ts` (self — add to existing `main()` after polling setup)

**Bootstrap check pattern — add after existing polling setInterval (content/index.ts lines 61-74, Pattern 5 from RESEARCH.md):**
```typescript
// Phase 4: bootstrap flag check on first load (D-05)
// Uses same isValidPayload guard as the postMessage bridge and polling paths
const flagResult = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
if (flagResult[BOOTSTRAP_NEEDED_KEY] !== undefined) {
  const raw = localStorage.getItem('aistudio_all_system_instructions');
  if (raw !== null && isValidPayload(raw)) {
    chrome.runtime.sendMessage({
      type: 'LS_BOOTSTRAP',
      payload: JSON.parse(raw) as RawInstruction[],
    }).catch(() => {
      // SW may be inactive; bootstrap will retry on next page load (flag still set)
      // Same catch pattern as fireAndForget() in content/index.ts line 18-20
    });
  }
}
```

**visibilitychange handler — add to main() (Pattern 6 from RESEARCH.md):**
```typescript
// Phase 4: pendingRemote polling on tab regain focus (D-08)
// document.addEventListener mirrors existing window.addEventListener pattern in content script
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
  const pending = r[PENDING_REMOTE_KEY] as PendingRemoteState | undefined;
  if (pending !== undefined) {
    applyRemoteLocally(pending.payload);
    await chrome.storage.local.remove(PENDING_REMOTE_KEY);
  }
});
```

**APPLY_REMOTE handler — add to main() (Pattern 4 from RESEARCH.md):**
```typescript
// Phase 4: APPLY_REMOTE message from SW — write localStorage + dispatch synthetic StorageEvent
// Synchronous handler — do NOT return true (no async response needed)
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'APPLY_REMOTE') {
    const instructions = message.payload as RawInstruction[];
    applyRemoteLocally(instructions);
    // No sendResponse — fire-and-forget delivery (Hard Rule 8)
  }
  // return undefined for unhandled types
});
```

**applyRemoteLocally helper — new function inside content/index.ts:**
```typescript
// Extracted as a named function so both APPLY_REMOTE handler and
// visibilitychange handler can call it without duplication
function applyRemoteLocally(instructions: RawInstruction[]): void {
  const serialized = JSON.stringify(instructions);
  const oldValue = localStorage.getItem('aistudio_all_system_instructions');
  localStorage.setItem('aistudio_all_system_instructions', serialized);
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'aistudio_all_system_instructions',
    oldValue,
    newValue: serialized,
    storageArea: localStorage, // must be the actual object — not a reference copy
    url: window.location.href,
  }));
  // Hard Rule 8: best-effort only. React may not respond. "Refresh AI Studio" is the fallback.
}
```

**fireAndForget pattern (existing, copy for LS_BOOTSTRAP send)** (content/index.ts lines 17-21):
```typescript
function fireAndForget(payload: object): void {
  chrome.runtime.sendMessage(payload).catch(() => {
    // SW may be inactive; message dropped intentionally.
  });
}
```

---

### `src/shared/constants.ts` (config) — MODIFIED

**Analog:** `src/shared/constants.ts` (self — append after existing Phase 3 constants)

**Existing pattern** (constants.ts lines 1-32) — Phase 4 adds two keys following the same `${LOCAL_KEY_PREFIX}` pattern:
```typescript
// Phase 4: bootstrap trigger flag (D-05)
// Written by SW onInstalled(reason='install'); cleared by SW after union merge.
// CS reads this key on first page load — never clears it (Pitfall 3 guard).
export const BOOTSTRAP_NEEDED_KEY = `${LOCAL_KEY_PREFIX}bootstrapNeeded`;

// Phase 4: deferred remote payload for no-active-tab fallback (D-08)
// Written by SW when no active AI Studio tab is found after a remote pull.
// CS reads and clears on visibilitychange when tab regains focus.
export const PENDING_REMOTE_KEY = `${LOCAL_KEY_PREFIX}pendingRemote`;
```

---

### `src/shared/types.ts` (model) — MODIFIED

**Analog:** `src/shared/types.ts` (self — append after existing Phase 3 types)

**Existing type declaration pattern** (types.ts lines 1-87) — Phase 4 appends four new interfaces following the same JSDoc + interface style:
```typescript
// Phase 4 message types — content script → SW (LS_BOOTSTRAP)
// and SW → content script (APPLY_REMOTE)
export interface ApplyRemoteMessage {
  type: 'APPLY_REMOTE';
  payload: RawInstruction[]; // merged live array (tombstoned items excluded)
}

export interface BootstrapMessage {
  type: 'LS_BOOTSTRAP';
  payload: RawInstruction[]; // raw localStorage snapshot from content script
}

// sysins:local:pendingRemote — D-08
// Written by SW when no active AI Studio tab found after pull.
// CS reads and clears on visibilitychange.
export interface PendingRemoteState {
  payload: RawInstruction[];
  enqueuedAt: number; // epoch ms
}

// sysins:local:bootstrapNeeded — D-05
// Written by SW on onInstalled(reason='install'). Cleared by SW after union merge.
// Shape is { triggeredAt: number } (Claude's Discretion — planner chose object over boolean
// so stale-flag detection is possible: flag written but never consumed).
export interface BootstrapNeededFlag {
  triggeredAt: number; // epoch ms
}
```

---

### `wxt.config.ts` (config) — MODIFIED

**Analog:** `wxt.config.ts` (self — modify permissions array)

**Existing permissions line** (wxt.config.ts line 12):
```typescript
permissions: ['storage', 'scripting', 'alarms'],
```

**Phase 4 change — add `identity.email` (D-03 confirmed by RESEARCH.md BOOT-03 spike section):**
```typescript
// identity.email is required (not just 'identity') for chrome.identity.getProfileUserInfo()
// DIST-02 exception: account safety is strictly required for a sync extension
permissions: ['storage', 'scripting', 'alarms', 'identity.email'],
```

Note: `tabs` permission is NOT needed — `host_permissions: ['https://aistudio.google.com/*']` already in place, which is sufficient for URL-based `chrome.tabs.query` filtering (RESEARCH.md Pattern 2, verified).

---

### `src/background/pull-engine.test.ts` (test, event-driven)

**Analog:** `src/background/push-engine.test.ts` — copy structure exactly

**Test file header pattern** (push-engine.test.ts lines 1-28):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  // ... module under test exports ...
} from './pull-engine';
import {
  REGISTRY_KEY,
  PENDING_REMOTE_KEY,
} from '../shared/constants';
import type { SyncRegistry, RawInstruction } from '../shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  // _resetForTesting() also called here — same Pattern S-4 as push-engine.test.ts
});
```

**Critical fakeBrowser pattern for pull tests** (RESEARCH.md Pattern 7):
```typescript
// Use fakeBrowser.storage.sync.set() (NOT chrome.storage.sync.set()) to simulate
// a remote write arriving. Using chrome.storage.sync.set() simulates a push write,
// which is the wrong event direction.
await fakeBrowser.storage.sync.set({ [REGISTRY_KEY]: remoteRegistry });

// fakeBrowser.storage.sync.set() triggers onChanged listeners synchronously
// — the listener fires before the await resolves.
```

**vi.spyOn badge stubs** (alarm-flush.test.ts lines 32-34) — apply to pull-engine tests too:
```typescript
beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  // fakeBrowser does not implement chrome.action.* — stub to prevent "not implemented"
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});
```

**Test case structure to cover (mirror push-engine.test.ts case numbering):**
- Case 1: `handleRemoteChanged` with new remote item → merged registry written to sync, APPLY_REMOTE sent to active tab
- Case 2: `handleRemoteChanged` with data identical to lastPushed → `diffAndAccumulate` returns `hasChanges=false`, no flush alarm scheduled
- Case 3: `handleRemoteChanged` with no active AI Studio tab → `PENDING_REMOTE_KEY` written to local storage
- Case 4: `handleRemoteChanged` when `tabs.sendMessage` throws → falls through to `pendingRemote` path (Pitfall 2)
- Case 5: `handleRemoteChanged` — `areaName !== 'sync'` guard → returns early, no merge
- Case 6: `handleRemoteChanged` — `REGISTRY_KEY` not in changes → returns early, no merge

---

### `src/background/bootstrap.test.ts` (test, CRUD)

**Analog:** `src/background/push-engine.test.ts` — copy structure; adapt for bootstrap-specific cases

**Test file header pattern** — same as pull-engine.test.ts above; replace imports for bootstrap module.

**Test case structure to cover:**
- Case 1: `handleLsBootstrap` with local-only items → UUIDs assigned, union merged, `APPLY_REMOTE` sent to tab, `BOOTSTRAP_NEEDED_KEY` cleared
- Case 2: `handleLsBootstrap` with items matching remote by title → remote UUIDs reused (no new UUIDs), D-06 title-match
- Case 3: `handleLsBootstrap` title-collision (multiple remote entries same title) → first by `updatedAt` desc wins, rest get fresh UUIDs (D-06)
- Case 4: `handleLsBootstrap` with empty local payload → no bootstrap message sent (Hard Rule 4 / `isValidPayload` guard)
- Case 5: `handleLsBootstrap` with remote tombstone + local live item of same title → tombstone wins per Hard Rule 10 / `applyRemote()`
- Case 6: `BOOTSTRAP_NEEDED_KEY` cleared only after successful merge — if merge throws, flag persists for retry (Pitfall 3)

---

## Shared Patterns

### ensureInitialized() call at every async entry point

**Source:** `src/background/index.ts` lines 77-78
**Apply to:** `handleRemoteChanged` in `pull-engine.ts`, `handleLsBootstrap` in `bootstrap.ts`
```typescript
// Pattern: call ensureInitialized() at top of every SW-wake handler before business logic
await ensureInitialized();
```
This is already delegated from `index.ts` via the listener registration — `pull-engine.ts` and `bootstrap.ts` exported functions receive it from the index entrypoint (same structure as `handleLsChanged` in `message-handler.ts` line 19).

### Single batched chrome.storage write (Hard Rule 3)

**Source:** `src/background/push-engine.ts` lines 169-177, `src/background/registry.ts` lines 57-61
**Apply to:** All writes in `pull-engine.ts`, `bootstrap.ts`, and `index.ts` Phase 4 additions
```typescript
// CORRECT: single batched set
await chrome.storage.local.set({
  [KEY_A]: valueA,
  [KEY_B]: valueB,
});

// FORBIDDEN: per-key write loop
for (const [k, v] of entries) {
  await chrome.storage.local.set({ [k]: v }); // violates Hard Rule 3
}
```

### isValidPayload guard for all LS reads

**Source:** `src/content/index.ts` lines 46-47, `src/shared/guard.ts`
**Apply to:** `LS_BOOTSTRAP` send path in `content/index.ts`
```typescript
import { isValidPayload } from '../shared/guard';

// Guard runs on every localStorage read before forwarding to SW
// Hard Rule 4: empty/null results are detection failures, not user deletes
if (!isValidPayload(value)) return;
```

### crypto.randomUUID() for UUID assignment

**Source:** `src/background/push-engine.ts` line 109
**Apply to:** `bootstrap.ts` UUID assignment for local-only items
```typescript
const uuid = existingUuid ?? crypto.randomUUID(); // D-17: built-in, no npm package
```

### setErrorState() + badge for all sync errors

**Source:** `src/background/alarm-flush.ts` lines 173-188, `src/background/sync-state.ts` lines 38-47
**Apply to:** `pull-engine.ts` error handling, `bootstrap.ts` error handling
```typescript
// ACCOUNT_MISMATCH is already defined in ErrorState union (types.ts line 56)
await setErrorState('ACCOUNT_MISMATCH');
// For pull errors reuse the same pattern as alarm-flush.ts
await setErrorState('RATE_LIMITED', msg);
await chrome.action.setBadgeText({ text: '!' });
await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
```

### Logging: counts only, never content

**Source:** `src/background/push-engine.ts` lines 155-157, `src/background/message-handler.ts` line 20
**Apply to:** All `console.log` calls in Phase 4 implementation files
```typescript
// T-03-02-b applies to pull path: log only item counts, never instruction text
console.log('[sysins] pull-engine: applied', mergedPayload.length, 'item(s) from remote');
console.log('[sysins] bootstrap: merged', localItems.length, 'local +', remoteCount, 'remote item(s)');
```

### fakeBrowser test setup seam (Pattern S-4)

**Source:** `src/background/index.ts` lines 58-60, `src/background/push-engine.test.ts` line 27
**Apply to:** `pull-engine.test.ts`, `bootstrap.test.ts`
```typescript
// All Phase 4 tests follow the same setup pattern as push-engine.test.ts
beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting(); // imported from background/index.ts — simulates SW kill
});
```

---

## No Analog Found

None — all Phase 4 files have close analogs in the Phase 2/3 codebase.

| File | Resolution |
|---|---|
| `src/background/account-preflight.ts` (spike) | SPIKE-GATED — no analog needed until spike confirms DOM selector and identity.email behavior; RESEARCH.md Pattern 8 provides the Chrome API pattern |

---

## Metadata

**Analog search scope:** `src/background/`, `src/content/`, `src/shared/`, `wxt.config.ts`
**Files read:** push-engine.ts, push-engine.test.ts, alarm-flush.ts, alarm-flush.test.ts (partial), index.ts (background), index.ts (content), registry.ts, sync-state.ts, message-handler.ts, constants.ts, types.ts, wxt.config.ts
**Pattern extraction date:** 2026-05-06

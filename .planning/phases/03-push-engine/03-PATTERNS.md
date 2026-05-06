# Phase 3: Push Engine - Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 4 new/modified files
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/background/push-engine.ts` | service | CRUD + event-driven | `src/background/registry.ts` | role-match (same SW service layer, same batched sync.set pattern) |
| `src/background/alarm-flush.ts` | service | event-driven | `src/background/sync-state.ts` | role-match (same SW service layer, same chrome.storage.local pattern) |
| `src/background/index.ts` | config / entrypoint | event-driven | `src/background/index.ts` (self — modify) | exact (extend existing onMessage + add onAlarm listener) |
| `src/background/message-handler.ts` | service | request-response | `src/background/message-handler.ts` (self — modify) | exact (replace stub body) |

---

## Pattern Assignments

### `src/background/push-engine.ts` (service, CRUD + event-driven)

**Analog:** `src/background/registry.ts`

**Imports pattern** (`src/background/registry.ts` lines 1–10):
```typescript
import {
  REGISTRY_KEY,
  BODY_KEY_PREFIX,
} from '../shared/constants';
import type {
  SyncRegistry,
  RegistryRecord,
  BodyPayload,
} from '../shared/types';
import { splitIntoChunks, joinChunks } from './storage-layout';
```

`push-engine.ts` will extend this with:
```typescript
import { REGISTRY_KEY, BODY_KEY_PREFIX, LOCAL_KEY_PREFIX } from '../shared/constants';
import type { SyncRegistry, LastPushedSnapshot, RawInstruction } from '../shared/types';
import { splitIntoChunks } from './storage-layout';
import { shortHash } from './hash';
import { getRegistry } from './registry';
import { readLastPushed } from './sync-state';
```

**Core bodyWriteMap helper** (`src/background/registry.ts` lines 27–33):
```typescript
function bodyWriteMap(uuid: string, chunkStrings: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < chunkStrings.length; i++) {
    map[`${BODY_KEY_PREFIX}${uuid}:c${i}`] = chunkStrings[i]!;
  }
  return map;
}
```
Copy this helper into `push-engine.ts` verbatim — it is the standard body-key map builder used by `createItem` and `updateItem`.

**Core batch-build pattern** (`src/background/registry.ts` lines 41–61):
```typescript
export async function createItem(input: { title: string; text: string }): Promise<string> {
  const uuid = crypto.randomUUID();
  const now = Date.now();
  const payload: BodyPayload = { text: input.text };
  const chunkStrings = splitIntoChunks(JSON.stringify(payload));

  const registry = await getRegistry();
  const next: SyncRegistry = {
    ...registry,
    [uuid]: {
      title: input.title,
      updatedAt: now,
      deletedAt: null,
      chunks: chunkStrings.length,
    },
  };

  await chrome.storage.sync.set({
    [REGISTRY_KEY]: next,
    ...bodyWriteMap(uuid, chunkStrings),
  });
  return uuid;
}
```
`push-engine.ts` reproduces this spread pattern inside `diffAndAccumulate` — building `nextRegistry` and `bodyWrites` maps then merging them into `pendingWrite`. The critical invariant: registry + all body keys go into **one object** passed to a single `chrome.storage.sync.set()` — never looped.

**Tombstone pattern** (`src/background/registry.ts` lines 115–136):
```typescript
export async function deleteItem(uuid: string): Promise<void> {
  const registry = await getRegistry();
  const existing = registry[uuid];
  if (existing === undefined) throw new Error(`deleteItem: no such uuid ${uuid}`);

  const now = Date.now();
  const nextRecord: RegistryRecord = {
    title: existing.title,
    updatedAt: existing.updatedAt,
    deletedAt: now,
    chunks: 0, // body cleared
  };
  const nextRegistry: SyncRegistry = { ...registry, [uuid]: nextRecord };
  await chrome.storage.sync.set({ [REGISTRY_KEY]: nextRegistry });
  if (existing.chunks > 0) {
    await chrome.storage.sync.remove(bodyKeys(uuid, existing.chunks));
  }
}
```
In `push-engine.ts`, tombstoning is done inline during diff: set `deletedAt: now` on records whose UUID is absent from the incoming `payload`. The `chunks: 0` field and separate `remove()` call for stale body keys follow the same pattern as `deleteItem`.

**pendingWrite persistence pattern** — new in Phase 3, no direct analog. Follows the `chrome.storage.local.set` pattern from `sync-state.ts` lines 34–36:
```typescript
await chrome.storage.local.set({ [SYNC_STATUS_KEY]: clean });
```
Applied to `PENDING_WRITE_KEY` (new constant to add to `constants.ts`) alongside the existing `SYNC_PENDING_KEY` sentinel.

---

### `src/background/alarm-flush.ts` (service, event-driven)

**Analog:** `src/background/sync-state.ts`

**Imports pattern** (`src/background/sync-state.ts` lines 1–11):
```typescript
import {
  LOCAL_KEY_PREFIX,
  PENDING_MERGE_QUEUE_CAP,
} from '../shared/constants';
import type {
  SyncStatus,
  SyncPendingSentinel,
  PendingMerge,
  LastPushedSnapshot,
  ErrorState,
} from '../shared/types';
```

`alarm-flush.ts` will import:
```typescript
import { REGISTRY_KEY } from '../shared/constants';
import type { SyncRegistry, LastPushedSnapshot } from '../shared/types';
import { SYNC_PENDING_KEY, LAST_PUSHED_KEY, writeSyncStatus, setErrorState, readLastPushed } from './sync-state';
import { shortHash } from './hash';
import { drainPendingWrite, clearPendingWrite } from './push-engine';
```

**Storage read pattern** (`src/background/sync-state.ts` lines 62–65):
```typescript
export async function readLastPushed(): Promise<LastPushedSnapshot> {
  const r = await chrome.storage.local.get(LAST_PUSHED_KEY);
  return (r[LAST_PUSHED_KEY] as LastPushedSnapshot | undefined) ?? {};
}
```
`alarm-flush.ts`'s `drainPendingWrite` follows the identical pattern — `chrome.storage.local.get(PENDING_WRITE_KEY)` with `?? null` fallback.

**setErrorState usage pattern** (`src/background/sync-state.ts` lines 38–47):
```typescript
export async function setErrorState(tag: ErrorState, detail?: string): Promise<void> {
  const current = await readSyncStatus();
  const next: SyncStatus = {
    state: 'error',
    lastSyncAt: current.lastSyncAt,
    errorState: tag,
  };
  if (detail !== undefined) next.errorDetail = detail;
  await writeSyncStatus(next);
}
```
`flushPendingWrite` in `alarm-flush.ts` calls `setErrorState('RATE_LIMITED', msg)`, `setErrorState('QUOTA_EXCEEDED', msg)`, and `setErrorState('STRICT_VALIDATION_FAIL', msg)` — reusing this exact function. Do NOT inline equivalent logic.

**writeSyncStatus pattern** (`src/background/sync-state.ts` lines 29–36):
```typescript
export async function writeSyncStatus(status: SyncStatus): Promise<void> {
  const clean: SyncStatus = { state: status.state, lastSyncAt: status.lastSyncAt };
  if (status.errorState !== undefined) clean.errorState = status.errorState;
  if (status.errorDetail !== undefined) clean.errorDetail = status.errorDetail;
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: clean });
}
```
Called in the flush success path: `await writeSyncStatus({ state: 'idle', lastSyncAt: Date.now() })`.

**Error handling + badge pattern** — no direct codebase analog (first badge usage). Follows the try/catch structure from `registry.ts` updateItem (lines 69–108) but adds `chrome.action` badge calls in the catch branches. Structure:
```typescript
try {
  await chrome.storage.sync.set(batch);
  // success path: writeLastPushed, clearPendingWrite, writeSyncStatus, clear badge
} catch (err) {
  const msg = String(err);
  if (msg.includes('MAX_WRITE_OPERATIONS_PER_MINUTE') || msg.includes('RATE_LIMIT')) {
    await setErrorState('RATE_LIMITED', msg);
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' }); // amber
    chrome.alarms.create(FLUSH_ALARM_NAME, { delayInMinutes: 1 }); // retry
  } else if (msg.includes('QUOTA_BYTES')) {
    await setErrorState('QUOTA_EXCEEDED', msg);
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red
  } else {
    await setErrorState('STRICT_VALIDATION_FAIL', msg);
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red
  }
}
```

---

### `src/background/index.ts` (entrypoint, event-driven — modify)

**Analog:** `src/background/index.ts` (self)

**Existing onMessage wiring** (`src/background/index.ts` lines 70–83):
```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LS_CHANGED') {
    if (!Array.isArray(message.payload)) {
      sendResponse({ ok: false, error: 'invalid payload' });
      return true;
    }
    ensureInitialized()
      .then(() => handleLsChanged(message.payload as RawInstruction[]))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep port open for async response
  }
});
```
Phase 3 adds an `onAlarm` listener **below** this block, following the same `.addListener` registration style:
```typescript
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== FLUSH_ALARM_NAME) return;
  await flushPendingWrite();
});
```

**Comment boundary to replace** (`src/background/index.ts` lines 86–89):
```typescript
// Phase 3+ boundary:
//   - No chrome.storage.onChanged listener (Phase 3)
//   - No chrome.alarms (Phase 3)
//   - No chrome.tabs.sendMessage (Phase 4)
```
Update these comments when wiring Phase 3 listeners.

**defineBackground wrapper** (`src/background/index.ts` lines 61–89):
```typescript
export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => { ... });
  chrome.runtime.onMessage.addListener(...);
  // Phase 3: add chrome.alarms.onAlarm.addListener here
});
```
All new listeners go **inside** the `defineBackground(() => { ... })` callback — not at module scope.

---

### `src/background/message-handler.ts` (service, request-response — modify)

**Analog:** `src/background/message-handler.ts` (self)

**Current stub** (lines 1–26 — full file):
```typescript
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
Phase 3 replaces the body of `handleLsChanged` with a call to `diffAndAccumulate` (from `push-engine.ts`) and `scheduleFlush` (from `alarm-flush.ts`). The function signature `(payload: RawInstruction[]): Promise<void>` is unchanged — `index.ts` calls it without modification.

Keep the `console.log` for observability but change content to log UUID count not instruction text (security: never log `.text` per RESEARCH security domain).

---

## Shared Patterns

### Storage Key Constant Declaration
**Source:** `src/shared/constants.ts` lines 1–24
**Apply to:** `push-engine.ts`, `alarm-flush.ts`
```typescript
// Single source of truth for all sysins:* storage key names and numeric constants.
// D-24: Magic numbers are forbidden inline anywhere in src/. Every other module imports from here.
export const PENDING_WRITE_KEY = `${LOCAL_KEY_PREFIX}pendingWrite`; // new Phase 3 key
```
Add `PENDING_WRITE_KEY` and `FLUSH_ALARM_NAME` as exports in `constants.ts`. Do not declare these as module-level literals inside `push-engine.ts` or `alarm-flush.ts`.

### chrome.storage.local Read Pattern
**Source:** `src/background/sync-state.ts` lines 24–27, 51–54, 62–65
**Apply to:** `push-engine.ts` (`drainPendingWrite`), `alarm-flush.ts` (any local reads)
```typescript
export async function readSyncStatus(): Promise<SyncStatus> {
  const r = await chrome.storage.local.get(SYNC_STATUS_KEY);
  return (r[SYNC_STATUS_KEY] as SyncStatus | undefined) ?? DEFAULT_STATUS;
}
```
Pattern: one `get(KEY)` call, cast result as `T | undefined`, return with `?? default`. Never use `get(null)` for single-key reads.

### Batched chrome.storage.sync.set
**Source:** `src/background/registry.ts` lines 56–60 (createItem), lines 106–108 (updateItem), line 129 (deleteItem), line 183 (applyRemote)
**Apply to:** `alarm-flush.ts` (`flushPendingWrite`)
```typescript
await chrome.storage.sync.set({
  [REGISTRY_KEY]: next,
  ...bodyWriteMap(uuid, chunkStrings),
});
```
All sync keys for a push cycle go into **one object literal** passed to a **single** `chrome.storage.sync.set()` call. Phase 3 builds the entire `pendingWrite` batch in `push-engine.ts`, persists it to local storage, then passes it to a single `chrome.storage.sync.set(pendingWrite)` in `alarm-flush.ts`.

### Test File Structure
**Source:** `src/background/message-handler.test.ts` lines 1–12, `src/background/registry.test.ts` lines 1–15
**Apply to:** `src/background/push-engine.test.ts`, `src/background/alarm-flush.test.ts`
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
// ... module imports ...

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting(); // if module has ephemeral state
});
```
Every test file starts with `fakeBrowser.reset()` in `beforeEach`. This resets `chrome.storage.sync`, `chrome.storage.local`, and `chrome.alarms` to empty state between tests. Never skip this.

### fakeBrowser Alarm Trigger Pattern
**Source:** `src/background/service-worker.test.ts` pattern (fakeBrowser.reset resets alarms); `RESEARCH.md` Pattern 5
**Apply to:** `src/background/alarm-flush.test.ts`
```typescript
// Trigger the alarm listener directly — no real 30s wait needed
await fakeBrowser.alarms.onAlarm.trigger({ name: 'sysins-flush', scheduledTime: Date.now() });
```
Use `fakeBrowser.alarms.onAlarm.trigger(alarm)` to fire the alarm synchronously in tests. Never use `setTimeout` or fake timers for alarm tests.

### TypeScript Strict null / optional property pattern
**Source:** `src/background/sync-state.ts` lines 30–35
**Apply to:** `push-engine.ts`, `alarm-flush.ts` (anywhere building objects with optional fields)
```typescript
const clean: SyncStatus = { state: status.state, lastSyncAt: status.lastSyncAt };
if (status.errorState !== undefined) clean.errorState = status.errorState;
if (status.errorDetail !== undefined) clean.errorDetail = status.errorDetail;
```
Never write `{ field: undefined }` — build a clean object and conditionally assign optional fields.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `wxt.config.ts` (manifest `permissions` update) | config | N/A | Manifest permission declaration — no existing pattern for adding permissions; add `"alarms"` to the `permissions` array alongside existing `"storage"` and `"scripting"` |

---

## Metadata

**Analog search scope:** `src/background/`, `src/shared/`
**Files scanned:** 10 source files + 4 test files
**Pattern extraction date:** 2026-05-06

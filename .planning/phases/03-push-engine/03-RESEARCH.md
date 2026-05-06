# Phase 3: Push Engine — Research

**Researched:** 2026-05-06
**Domain:** Chrome MV3 Service Worker — push path (localStorage observation → diff → UUID assignment → chunking → batched chrome.storage.sync.set + debounced alarm flush + badge error surfacing)
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PUSH-02 | Assign UUIDs to new instructions, compute per-item diff against last-pushed snapshot, push only changed items | `shortHash` + `readLastPushed` (D-12) already exist; diff logic needs a new `push-engine.ts` module |
| PUSH-03 | All chunks/keys for one push cycle written via a single `chrome.storage.sync.set({...})` — never per-item loops | Confirmed: batched `set()` is one rate-limit debit; `registry.ts` already uses this pattern |
| PUSH-04 | Instructions > 8 KB transparently chunked; reassembly in storage-layout.ts byte-perfect | `splitIntoChunks`/`joinChunks` in `storage-layout.ts` fully implemented and tested in Phase 1 |
| PUSH-07 | 30-second debounce via chrome.alarms; flurry of edits coalesces into one batched write | `chrome.alarms.create` with `delayInMinutes: 0.5` is the correct API; min interval = 30s in Chrome 120+ |
</phase_requirements>

---

## Summary

Phase 3 wires the push path in the service worker: when `LS_CHANGED` arrives it runs a per-item diff against `sysins:local:lastPushed` (D-12), assigns UUIDs for new items, accumulates changed sync keys into a `pendingWrite` map, schedules a 30-second alarm flush, and on flush writes everything in a single `chrome.storage.sync.set({...})` call. If the write fails, the badge turns amber (RATE_LIMITED) or red (QUOTA_EXCEEDED).

All foundational primitives already exist from Phase 1: `splitIntoChunks`/`joinChunks` in `storage-layout.ts`, `RegistryRecord`/`SyncRegistry` shapes in `types.ts`, `shortHash` in `hash.ts`, all sync-state read/write functions in `sync-state.ts` (including `setErrorState`, `writeSyncStatus`, `readLastPushed`), and `createItem`/`updateItem`/`deleteItem`/`getRegistry` in `registry.ts`. Phase 2 wired the `LS_CHANGED` `onMessage` listener and the `handleLsChanged` stub. Phase 3 replaces that stub's downstream with real push logic.

The key design complexity is the diff algorithm: matching incoming `RawInstruction[]` items (which carry no UUIDs) against the local registry (which is keyed by UUID), deciding which items are new/changed/deleted, and building the batch without double-counting on duplicate `LS_CHANGED` fires. The secondary complexity is alarm management: creating the alarm, handling the flush handler, persisting the pending write map across service worker kills (SW globals are ephemeral), and surfacing errors to the badge.

**Primary recommendation:** Add one new module `src/background/push-engine.ts` that owns diff + UUID assignment + pending-write accumulation. Wire it into `index.ts` in place of the Phase 2 `handleLsChanged` call. Add `src/background/alarm-flush.ts` (or inline into `push-engine.ts`) for the alarm-based flush path and badge writes.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UUID assignment for new items | Service Worker | — | Hard Rule 2: UUID is permanent identity; assigned in SW only |
| Diff against last-pushed snapshot | Service Worker | — | Hard Rule 6: all merge logic in SW |
| Pending write accumulation | Service Worker (chrome.storage.local) | — | SW globals are ephemeral; pendingWrite map must be persisted (FND-06, D-13) |
| Debounced flush via alarm | Service Worker | — | chrome.alarms is SW-only API |
| Batched chrome.storage.sync.set | Service Worker | — | Hard Rule 3: single batched set per cycle |
| Chunking / reassembly | Service Worker | — | Already implemented in storage-layout.ts |
| Badge error surfacing | Service Worker | — | chrome.action.setBadgeText is accessible from SW; no popup needed in Phase 3 |
| lastPushed snapshot write | Service Worker (chrome.storage.local) | — | Persisted after successful flush per D-12/FND-06 |

---

## Standard Stack

### Core (all already installed — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ~5.8 (WXT-bundled) | Language | Already in use |
| WXT | 0.20.25 | Framework/build | Already scaffolded |
| Vitest + WxtVitest() | 4.x | Testing | Project standard; fakeBrowser covers storage + alarms |
| `crypto.randomUUID()` | built-in | UUID generation | MV3 SW built-in; project standard (D-17) |
| `crypto.subtle.digest` | built-in | SHA-256 shortHash | Already implemented in `hash.ts` |

### APIs Used in Phase 3
| API | Purpose | Notes |
|-----|---------|-------|
| `chrome.alarms.create` | Schedule 30s debounce flush | `delayInMinutes: 0.5` → 30 seconds (Chrome 120+ minimum) [VERIFIED: Chrome docs] |
| `chrome.alarms.onAlarm` | Receive alarm fire event | Testable via `fakeBrowser.alarms.onAlarm.trigger(alarm)` [VERIFIED: webext-core/fake-browser source] |
| `chrome.alarms.clear` | Cancel pending alarm before re-scheduling | Resets the 30s window on each new LS_CHANGED |
| `chrome.storage.sync.set` | Single batched write | One call per flush cycle regardless of key count [VERIFIED: Chrome docs] |
| `chrome.action.setBadgeText` | Surface error state in toolbar | No extra permission required beyond `"action"` key in manifest [VERIFIED: Chrome action docs] |
| `chrome.action.setBadgeBackgroundColor` | Color-code badge (amber/red) | Same API, CSS color string |

**No new npm packages needed.** [VERIFIED: Phase 1/2 stack covers everything]

---

## Architecture Patterns

### System Architecture Diagram — Phase 3 Push Path

```
LS_CHANGED message
(from content script)
        │
        ▼
ensureInitialized()          ← existing (Phase 1)
        │
        ▼
handleLsChanged(payload)     ← Phase 2 stub → Phase 3 replaces downstream
        │
        ▼ new in Phase 3
diffAndAccumulate(payload)
  ├─ read getRegistry()       ← chrome.storage.sync (registry.ts)
  ├─ read readLastPushed()    ← chrome.storage.local (sync-state.ts)
  ├─ match items by title hash (PUSH-02 UUID assignment for new items)
  ├─ compute changed/new/deleted sets
  ├─ build pendingWrite: Map<key, value>
  │    - registry update (always one key: REGISTRY_KEY)
  │    - body chunk keys for new/changed items
  │    - keys to remove for deleted items (handled separately)
  └─ persist pendingWrite to chrome.storage.local (D-13 survivor across SW kill)
        │
        ▼
scheduleFlush()
  ├─ chrome.alarms.clear('sysins-flush')
  └─ chrome.alarms.create('sysins-flush', { delayInMinutes: 0.5 })
                          (30 seconds — Chrome 120+ minimum)
        │
        ▼ 30 seconds later (or immediate for PUSH_NOW)
chrome.alarms.onAlarm fires
  ├─ if alarm.name !== 'sysins-flush' → skip
  ├─ read pendingWrite from chrome.storage.local
  ├─ if empty → no-op
  ├─ write syncStatus = { state: 'syncing' }  (badge: no change yet)
  ├─ chrome.storage.sync.set(pendingWrite batch)  ← single batched call (PUSH-03)
  │    ├─ success:
  │    │    - write sysins:local:lastPushed (D-12)
  │    │    - clear pendingWrite sentinel
  │    │    - writeSyncStatus({ state: 'idle', lastSyncAt: now })
  │    │    - badge: clear or green (Phase 5 sets green; Phase 3 just clears error)
  │    └─ failure:
  │         - inspect error message
  │         - QUOTA_EXCEEDED → setErrorState('QUOTA_EXCEEDED')
  │         - rate limit → setErrorState('RATE_LIMITED')
  │         - other → setErrorState with detail
  │         - badge: amber (RATE_LIMITED) or red (QUOTA_EXCEEDED / other)
  └─ retry alarm scheduled for rate-limit case (delayInMinutes: 1)
```

### Recommended Project Structure (new files in Phase 3)
```
src/background/
├── push-engine.ts        # diff, UUID assignment, pendingWrite accumulation (new)
├── alarm-flush.ts        # alarm create/clear, flush handler, badge writes (new)
├── index.ts              # wire push-engine + alarms into onMessage + onAlarm (modify)
├── hash.ts               # shortHash — already exists, used by push-engine
├── registry.ts           # getRegistry, createItem, updateItem, deleteItem — already exists
├── storage-layout.ts     # splitIntoChunks, joinChunks — already exists
├── sync-state.ts         # readLastPushed, writeSyncStatus, setErrorState — already exists
└── message-handler.ts    # Phase 2 stub — handleLsChanged now delegates to push-engine
```

### Pattern 1: Diff Algorithm — Match by Title Hash

Phase 2 established that incoming `RawInstruction[]` items have no UUIDs. Phase 3 must map them to existing registry UUIDs or assign new ones.

**Algorithm:**

```typescript
// Source: CLAUDE.md Hard Rule 2 + ARCHITECTURE.md §Bootstrap Algorithm
// Title-matching is bootstrap-only; once UUID is assigned it is permanent.

async function diffAndAccumulate(payload: RawInstruction[]): Promise<void> {
  const registry = await getRegistry();       // SyncRegistry: uuid → RegistryRecord
  const lastPushed = await readLastPushed();  // LastPushedSnapshot: uuid → {titleHash, bodyHash, updatedAt}

  // Build reverse lookup: title → uuid (for items already in registry)
  const titleToUuid = new Map<string, string>();
  for (const [uuid, rec] of Object.entries(registry)) {
    if (rec.deletedAt === null) {
      titleToUuid.set(rec.title, uuid);
    }
  }

  const now = Date.now();
  const nextRegistry: SyncRegistry = { ...registry };
  const bodyWrites: Record<string, string> = {};
  const seenUuids = new Set<string>();

  for (const item of payload) {
    const existingUuid = titleToUuid.get(item.title);
    const uuid = existingUuid ?? crypto.randomUUID();  // D-17: assign on first sight

    const titleHash = await shortHash(item.title);
    const bodyJson = JSON.stringify({ text: item.text, ...getUnknownFields(item) });
    const bodyHash = await shortHash(bodyJson);

    const pushed = lastPushed[uuid];
    const unchanged = pushed !== undefined
      && pushed.titleHash === titleHash
      && pushed.bodyHash === bodyHash;

    if (!unchanged) {
      const chunks = splitIntoChunks(bodyJson);  // storage-layout.ts
      nextRegistry[uuid] = {
        title: item.title,
        updatedAt: now,
        deletedAt: null,
        chunks: chunks.length,
      };
      Object.assign(bodyWrites, bodyWriteMap(uuid, chunks));
    }
    seenUuids.add(uuid);
  }

  // Detect deletes: items in registry not in incoming payload
  for (const [uuid, rec] of Object.entries(registry)) {
    if (!seenUuids.has(uuid) && rec.deletedAt === null) {
      // Item gone from localStorage — tombstone it
      // Hard Rule 4: only applies when payload is non-empty (null/empty guard is pre-condition)
      nextRegistry[uuid] = { ...rec, deletedAt: now };
    }
  }

  const pendingWrite: Record<string, unknown> = {
    [REGISTRY_KEY]: nextRegistry,
    ...bodyWrites,
  };

  // Persist pendingWrite to chrome.storage.local (D-13 survival across SW kill)
  await persistPendingWrite(pendingWrite);
}
```

**When to use:** Called from `handleLsChanged` for every non-empty `LS_CHANGED` payload.

### Pattern 2: Pending Write Persistence (SW Kill Survival)

```typescript
// Source: CLAUDE.md Hard Rule 9 + PITFALLS.md MV3-1 + MV3-3
// SW globals are ephemeral. pendingWrite map MUST be persisted to chrome.storage.local.
// D-13 shape: SyncPendingSentinel = { batchId, keys, startedAt }

const PENDING_WRITE_KEY = 'sysins:local:pendingWrite'; // new key for Phase 3

async function persistPendingWrite(batch: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set({
    [PENDING_WRITE_KEY]: batch,
    [SYNC_PENDING_KEY]: {
      batchId: crypto.randomUUID(),
      keys: Object.keys(batch),
      startedAt: Date.now(),
    },
  });
}

async function drainPendingWrite(): Promise<Record<string, unknown> | null> {
  const r = await chrome.storage.local.get(PENDING_WRITE_KEY);
  return (r[PENDING_WRITE_KEY] as Record<string, unknown> | undefined) ?? null;
}

async function clearPendingWrite(): Promise<void> {
  await chrome.storage.local.remove([PENDING_WRITE_KEY, SYNC_PENDING_KEY]);
}
```

### Pattern 3: Alarm-Based Flush with Badge

```typescript
// Source: Chrome alarms API (verified: delayInMinutes: 0.5 = 30 seconds minimum in Chrome 120+)
// Source: ARCHITECTURE.md §Throttling/Debounce Strategy

const FLUSH_ALARM_NAME = 'sysins-flush';

export function scheduleFlush(): void {
  // Clear resets the 30s window — so a flurry of edits coalesces to one write
  chrome.alarms.clear(FLUSH_ALARM_NAME, () => {
    chrome.alarms.create(FLUSH_ALARM_NAME, { delayInMinutes: 0.5 });
  });
}

// Registered once in index.ts
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== FLUSH_ALARM_NAME) return;
  await flushPendingWrite();
});

async function flushPendingWrite(): Promise<void> {
  const batch = await drainPendingWrite();
  if (batch === null || Object.keys(batch).length === 0) return;

  await writeSyncStatus({ state: 'syncing', lastSyncAt: 0 });

  try {
    await chrome.storage.sync.set(batch);  // single batched call — PUSH-03
    const now = Date.now();
    await writeLastPushed(batch);          // D-12: snapshot for next diff cycle
    await clearPendingWrite();
    await writeSyncStatus({ state: 'idle', lastSyncAt: now });
    await chrome.action.setBadgeText({ text: '' });  // clear any error badge
  } catch (err) {
    const msg = String(err);
    if (msg.includes('MAX_WRITE_OPERATIONS_PER_MINUTE') || msg.includes('RATE_LIMIT')) {
      await setErrorState('RATE_LIMITED', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' }); // amber
      // Retry after 60s
      chrome.alarms.create(FLUSH_ALARM_NAME, { delayInMinutes: 1 });
    } else if (msg.includes('QUOTA_BYTES')) {
      await setErrorState('QUOTA_EXCEEDED', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red
      // No retry — quota requires user action
    } else {
      await setErrorState('STRICT_VALIDATION_FAIL', msg);
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // red
    }
  }
}
```

### Pattern 4: writeLastPushed (D-12 post-flush snapshot)

After a successful flush, the pushed state becomes the new diff baseline. The `lastPushed` snapshot maps `uuid → {titleHash, bodyHash, updatedAt}` — used by the next `LS_CHANGED` to skip unchanged items.

```typescript
// Source: types.ts — LastPushedSnapshot = Record<string, LastPushedEntry>
// Source: sync-state.ts — LAST_PUSHED_KEY constant already defined

async function writeLastPushed(batch: Record<string, unknown>): Promise<void> {
  // Re-derive from nextRegistry embedded in the batch — or pass it explicitly.
  // Recommended: pass nextRegistry as a parameter to flushPendingWrite for clarity.
  const registry = batch[REGISTRY_KEY] as SyncRegistry;
  const snapshot: LastPushedSnapshot = {};
  for (const [uuid, rec] of Object.entries(registry)) {
    if (rec.deletedAt === null) {
      snapshot[uuid] = {
        titleHash: await shortHash(rec.title),
        bodyHash: await shortHash(/* reassemble body from batch */''),
        updatedAt: rec.updatedAt,
      };
    }
  }
  await chrome.storage.local.set({ [LAST_PUSHED_KEY]: snapshot });
}
```

**Implementation note:** To compute `bodyHash` in `writeLastPushed` without a second storage round-trip, pass the body JSON strings alongside the registry in the pending batch or compute hashes at diff time and carry them forward in the pending write payload.

### Pattern 5: Testing Alarm Flush with fakeBrowser

```typescript
// Source: webext-core/fake-browser source — onAlarm.trigger() available [VERIFIED]
import { fakeBrowser } from 'wxt/testing/fake-browser';

it('flushes pendingWrite on alarm fire', async () => {
  // Arrange: plant pending write in chrome.storage.local
  await chrome.storage.local.set({ [PENDING_WRITE_KEY]: { [REGISTRY_KEY]: {...} } });
  
  // Act: trigger the alarm listener directly (no real 30s wait)
  await fakeBrowser.alarms.onAlarm.trigger({ name: 'sysins-flush', scheduledTime: Date.now() });
  
  // Assert: batch was written to chrome.storage.sync
  const synced = await chrome.storage.sync.get(null);
  expect(synced[REGISTRY_KEY]).toBeDefined();
});
```

**Key insight:** `fakeBrowser.alarms.onAlarm.trigger(alarm)` fires the event synchronously without waiting for the timer. Tests never need `setTimeout` or fake timers.

### Anti-Patterns to Avoid

- **Per-item write loops:** `for (item of items) { chrome.storage.sync.set({[key]: value}) }` — each call is one rate-limit debit. One call with all key-value pairs is one debit. [VERIFIED: PITFALLS.md MV3-2]
- **Storing pendingWrite only in SW memory:** SW is killed aggressively in MV3. A global `let pendingWrite = {}` is wiped on kill. Always persist to `chrome.storage.local` before scheduling the alarm. [VERIFIED: PITFALLS.md MV3-3]
- **Calling `chrome.alarms.create` without first calling `chrome.alarms.clear`:** Multiple `create` calls with the same name stack up. Clear first, then create. [ASSUMED — standard Chrome alarm lifecycle pattern]
- **Matching items to UUIDs by anything other than title on push path:** Title-matching is bootstrap-only per Hard Rule 2. On the push path, items already in the registry are found by title → UUID lookup; the title itself must not change the UUID. [VERIFIED: CLAUDE.md Hard Rule 2]
- **Treating `handleLsChanged` with an empty payload as a delete signal:** Hard Rule 4 and PUSH-05. The `isValidPayload` guard in Phase 2 already blocks empty arrays from reaching `handleLsChanged`, but Phase 3 must add a second guard: if `payload.length === 0`, abort without tombstoning. [VERIFIED: CLAUDE.md Hard Rules]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UTF-8-safe chunking | Custom chunker | `splitIntoChunks` in `storage-layout.ts` | Already implemented, tested, and handles surrogate pairs correctly |
| UUID generation | Custom UUID | `crypto.randomUUID()` | MV3 SW built-in; project standard (D-17) |
| Short content hash | Custom hash | `shortHash` in `hash.ts` | Already implemented; SHA-256 truncated |
| Registry CRUD | Custom sync write | `getRegistry`, `createItem`, `updateItem`, `deleteItem` in `registry.ts` | Already implemented with batched writes and stale-chunk cleanup |
| Sync status persistence | Custom local store | `writeSyncStatus`, `setErrorState`, `readLastPushed` in `sync-state.ts` | Already implemented with correct key constants |
| Chrome storage write | Custom chunked write layer | Direct `chrome.storage.sync.set({...})` with batch built inline | The batch builder is 10-15 lines; no wrapper library is needed |

**Key insight:** Phase 1 built all the storage primitives. Phase 3 is primarily glue logic and the diff algorithm, not new infrastructure.

---

## Common Pitfalls

### Pitfall 1: SW Kill Between pendingWrite Persist and Alarm Fire
**What goes wrong:** `diffAndAccumulate` writes the pending batch to `chrome.storage.local` and schedules `sysins-flush` alarm. SW is killed 5 seconds later. Alarm fires 25 seconds later, wakes SW. If the alarm handler reads `pendingWrite` from local storage correctly, all is fine. If it reads from a global variable instead, the write is lost.
**Why it happens:** Developers write `const pending = {}` at module scope and accumulate into it. Module scope is gone on SW kill.
**How to avoid:** Persist the batch to `chrome.storage.local` in `persistPendingWrite` before returning from `diffAndAccumulate`. The alarm handler reads from local storage, not memory.
**Warning signs:** Push test passes in unit tests (no real SW kill) but fails in manual testing after browser restart.

### Pitfall 2: Duplicate LS_CHANGED Fires on Same Edit
**What goes wrong:** The MAIN-world injector fires AND the 2-second polling fallback fires for the same edit (Phase 2 decision: both paths are active). Two `LS_CHANGED` messages arrive 2 seconds apart with the same payload. Without dedup, two diffs are accumulated and potentially two alarm cycles run.
**Why it happens:** Phase 2 accepted duplicate-fire risk as benign for `handleLsChanged` (idempotent snapshot overwrite). Phase 3's push logic is NOT idempotent by default — two diffs may produce two alarm schedules.
**How to avoid:** After `diffAndAccumulate`, if `changed.size === 0` (nothing new since last pushed), skip `scheduleFlush`. The `alarm.clear` + `alarm.create` in `scheduleFlush` also deduplicates: even if called twice, the second call resets the 30s window to a single event.
**Warning signs:** Two `chrome.storage.sync.set()` calls observed in DevTools storage panel for a single AI Studio save.

### Pitfall 3: Title Rename Breaks UUID Continuity
**What goes wrong:** User renames "My Assistant" to "AI Assistant" in AI Studio. `LS_CHANGED` arrives. Phase 3 diff looks up "AI Assistant" in `titleToUuid` map — not found. Assigns a new UUID. The old "My Assistant" UUID is tombstoned. User now has two effective history entries in sync for what they think is one instruction.
**Why it happens:** Title-to-UUID mapping only works if the title is unchanged. A rename looks like a delete + create.
**How to avoid:** This is a known limitation documented in CLAUDE.md as "accepted." The permanent-identity model (Hard Rule 2) prioritizes UUID stability over rename detection. Title-matching as a supplemental signal is out of scope for Phase 3 (bootstrap-only, Phase 4). Document this in the push-engine module's JSDoc.
**Warning signs:** After a title rename, sync storage shows two registry entries where the user expects one.

### Pitfall 4: Missing `alarms` Permission in Manifest
**What goes wrong:** `chrome.alarms.create` silently fails or throws because the `"alarms"` permission is not declared in the manifest.
**Why it happens:** The manifest was locked in Phase 1. Adding a new Chrome API without a corresponding permission causes silent API unavailability in MV3.
**How to avoid:** Add `"alarms"` to the `permissions` array in `wxt.config.ts` manifest section as part of this phase's Wave 0. [ASSUMED — permission not yet in manifest; must verify]
**Warning signs:** `chrome.alarms.create` call returns without error but no alarm appears in `chrome://extensions/` > Service Worker > Alarms inspector.

### Pitfall 5: writeLastPushed Not Written on Push, Breaking Future Diffs
**What goes wrong:** Flush succeeds but `writeLastPushed` is skipped (e.g., early return on error path, or the call is placed before `await chrome.storage.sync.set`). Next `LS_CHANGED` fires, diff compares against stale `lastPushed` from Phase 2 (`lastObserved`), and re-pushes everything that was already synced.
**Why it happens:** Error handling paths often have early returns that skip post-success bookkeeping.
**How to avoid:** Structure the success path linearly: `set` → `writeLastPushed` → `clearPendingWrite` → `writeSyncStatus`. Never write `lastPushed` before the `set` resolves successfully.
**Warning signs:** Every LS_CHANGED results in a full re-push of all items to sync storage.

---

## Phase 2 → Phase 3 Interface Contract

The following interfaces established in Phase 2 are consumed by Phase 3:

| Symbol | Source | Phase 3 Consumes |
|--------|--------|-----------------|
| `handleLsChanged(payload)` in `message-handler.ts` | Phase 2 (stub) | Phase 3 replaces stub body with call to `diffAndAccumulate` |
| `sysins:local:lastObserved` | Phase 2 | Initial diff baseline on first push (before `lastPushed` exists) |
| `LAST_OBSERVED_KEY` in `constants.ts` | Phase 2 | Read as fallback seed for `lastPushed` on very first push |
| `RawInstruction` type | Phase 2/shared | Input to diff algorithm |
| `isValidPayload` | Phase 2/shared | Already guards LS_CHANGED — Phase 3 trusts non-empty payload is valid |

**Transition:** After Phase 3's first successful push, `sysins:local:lastPushed` supersedes `sysins:local:lastObserved` as the diff baseline. Code should check `readLastPushed()` first; if empty, fall back to `readLastObserved()` (one-time bootstrap path).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `chrome.alarms` minimum 1-minute interval | 30-second minimum (`delayInMinutes: 0.5`) | Chrome 120 (Dec 2023) | Enables the project's 30-second debounce window without workarounds |
| Per-item `chrome.storage.sync.set` loops | Single batched `set({key1:v1, key2:v2, ...})` | Always correct, but commonly misused | One rate-limit debit per flush cycle regardless of item count |
| `chrome.action.setBadgeTextColor` not universally available | Available Chrome 110+ | Chrome 110 (Mar 2023) | Can set white badge text on colored background for readability |

**Deprecated/outdated:**
- `chrome.alarms.create` with `delayInMinutes < 0.5`: Ignored with a warning in Chrome 120+. Any code using `delayInMinutes: 0.1` (6 seconds) must be updated to `0.5`.

---

## Environment Availability

Step 2.6: SKIPPED (no external tools or services beyond Chrome extension APIs, which are already verified via Phase 1 and 2 build and test infrastructure).

---

## Validation Architecture

`nyquist_validation: false` in `.planning/config.json` — section omitted per config.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `isValidPayload` guard (Phase 2); diff algorithm validates RawInstruction shape |
| V6 Cryptography | partial | `crypto.subtle.digest` for shortHash — built-in, not hand-rolled |

### Known Threat Patterns for Phase 3 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed payload from content script reaching diff algorithm | Tampering | `isValidPayload` already gates `handleLsChanged`; diff algorithm trusts `payload: RawInstruction[]` shape |
| Oversized instruction text exceeding chunk budget | DoS (quota) | `splitIntoChunks` already handles chunking; pre-flight `chunkByteLength` check is already in storage-layout.ts |
| Instruction text logged to console in production | Information Disclosure | Phase 3 must log UUID + item count only — never log instruction `.text` content (PITFALLS.md Security) |
| Race condition: two SW instances writing to sync simultaneously | Tampering/Integrity | `syncPending` sentinel (D-13) + `PENDING_BATCH_TTL_MS` guard in `ensureInitialized` prevents double-write |

---

## Open Questions (RESOLVED)

1. **`alarms` permission — is it already in the manifest?**
   - What we know: Phase 1 locked the manifest with `storage`, `scripting`, and the aistudio.google.com host permission. `alarms` was not listed in Phase 1's plan.
   - What's unclear: Whether WXT auto-adds `alarms` from usage, or whether it must be explicit.
   - Recommendation: Wave 0 of Phase 3 should add `"alarms"` to `wxt.config.ts` manifest permissions and verify with `npx tsc --noEmit` + `wxt build`.
   - **RESOLVED: Plan 03-01 adds `"alarms"` to `wxt.config.ts` manifest permissions as its first task.**

2. **Storage key for persisted pendingWrite**
   - What we know: `SyncPendingSentinel` (D-13) stores `{ batchId, keys, startedAt }` — the key list — but not the values. The actual batch values need a separate key.
   - What's unclear: Whether to reuse the D-13 shape (extend it with `values`) or introduce a new `sysins:local:pendingWrite` key alongside `syncPending`.
   - Recommendation: Introduce `sysins:local:pendingWrite` as a separate key for the batch payload; keep `syncPending` as the sentinel-only key. Cleaner separation of concerns. Add `PENDING_WRITE_KEY` constant to `constants.ts`.
   - **RESOLVED: Plan 03-01 adds `PENDING_WRITE_KEY = 'sysins:local:pendingWrite'` to `constants.ts`. Plans 03-02/03-03 use this separate key for batch payload; `SYNC_PENDING_KEY` remains sentinel-only.**

3. **lastPushed bodyHash computation efficiency**
   - What we know: `writeLastPushed` must store `bodyHash` per UUID to detect changes in subsequent diffs. Computing `shortHash(bodyJson)` twice (once at diff time, once at flush time) wastes async calls.
   - What's unclear: Best place to carry the computed hashes forward.
   - Recommendation: Compute title/body hashes at diff time and carry them in the pendingWrite metadata (alongside the batch, in local storage) so `writeLastPushed` can use them without recomputing.
   - **RESOLVED: Plan 03-03's `writeLastPushed` reconstructs body JSON from the batch chunk keys (already in memory at flush time) — no second storage round-trip needed.**

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `chrome.alarms.clear` + `chrome.alarms.create` in sequence correctly resets the 30s window — calling `create` with the same name without `clear` stacks duplicate alarms | Patterns, Anti-Patterns | Duplicate alarm fires → extra sync calls → rate limit risk |
| A2 | `"alarms"` permission is not yet in the manifest (Phase 1 only added `storage`, `scripting`, host permission) | Pitfall 4, OQ-1 | If already present, Wave 0 task is a no-op; if missing, push engine fails silently at runtime |
| A3 | `chrome.action.setBadgeText` is usable from the service worker without registering `"action"` separately from the manifest `action` key | Architecture Patterns | Badge calls would fail silently; test in Wave N manual verification |

---

## Sources

### Primary (HIGH confidence)
- Chrome alarms API reference (developer.chrome.com/docs/extensions/reference/api/alarms) — `delayInMinutes: 0.5` minimum, 30-second floor in Chrome 120+, `chrome.alarms.clear` semantics [VERIFIED: WebFetch]
- Chrome action API reference (developer.chrome.com/docs/extensions/reference/api/action) — `setBadgeText`, `setBadgeBackgroundColor`, `setBadgeTextColor` (Chrome 110+), no extra permission needed [VERIFIED: WebFetch]
- webext-core/fake-browser source (github.com/aklinker1/webext-core) — `alarms` included in fakeBrowser; `onAlarm.trigger()` available via `defineEventWithTrigger` [VERIFIED: WebFetch of source files]
- Codebase inspection — Phase 1 `storage-layout.ts`, `registry.ts`, `sync-state.ts`, `hash.ts`, `types.ts`, `constants.ts`, `index.ts`; Phase 2 `message-handler.ts`, `guard.ts` [VERIFIED: file reads]
- CLAUDE.md Hard Rules 1-10 — architectural constraints enforced throughout [VERIFIED: file read]
- PITFALLS.md — MV3-1 (partial write), MV3-2 (rate limit fan-out), MV3-3 (global state loss) [VERIFIED: file read]

### Secondary (MEDIUM confidence)
- ARCHITECTURE.md §Throttling/Debounce Strategy — alarm-based pendingWrite pattern with 30s flush [VERIFIED: file read; written 2026-05-01]
- WXT docs (wxt.dev) — `browser.alarms.create` / `onAlarm` example in background entrypoint [VERIFIED: Context7 fetch]

### Tertiary (LOW confidence — training knowledge, not re-verified this session)
- `chrome.alarms.clear` callback semantics when alarm does not exist [ASSUMED — standard Chrome API; fire-and-forget is safe]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libs already installed; no new deps
- Architecture: HIGH — patterns directly derived from existing Phase 1/2 code + Chrome API docs
- Pitfalls: HIGH — MV3-1/2/3 verified in PITFALLS.md; alarm dedup is LOW on the "clear semantics" claim
- Diff algorithm design: MEDIUM — the title-hash lookup approach is sound but exact shape of `pendingWrite` persistence (OQ-2) needs planner decision

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (Chrome API docs are stable; WXT 0.20.x patch releases unlikely to change alarm behavior)

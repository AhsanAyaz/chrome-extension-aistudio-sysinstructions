# Architecture Research

**Domain:** Chrome MV3 Extension — localStorage-to-chrome.storage.sync bridge
**Researched:** 2026-05-01
**Confidence:** HIGH (Chrome extension APIs are well-documented and stable; specific behavioral claims verified against official docs)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                   aistudio.google.com tab                            │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  PAGE MAIN WORLD (page's own JS + React app)                  │   │
│  │  localStorage["aistudio_all_system_instructions"] = [...]     │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │  Storage.prototype.setItem patch      │
│                              │  (injected via world: "MAIN")         │
│  ┌──────────────────────────▼───────────────────────────────────┐   │
│  │  CONTENT SCRIPT (ISOLATED WORLD)                              │   │
│  │  - Receives postMessage from MAIN world on LS mutations       │   │
│  │  - Reads localStorage on demand (can cross isolated→page LS)  │   │
│  │  - Writes localStorage + dispatches synthetic StorageEvent    │   │
│  │  - Forwards changes to service worker via sendMessage         │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ chrome.runtime.sendMessage / Port
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│                      SERVICE WORKER                                   │
│                                                                       │
│  - ALL merge / conflict-resolution logic lives here                   │
│  - Reads/writes chrome.storage.sync                                   │
│  - Listens to chrome.storage.onChanged (wakes on remote sync)         │
│  - Manages UUID registry + updated_at + tombstones                    │
│  - Throttles/debounces writes via pending-set + chrome.alarms         │
│  - Pushes pull results back to content script via tabs.sendMessage    │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ chrome.runtime.sendMessage
                       │
┌──────────────────────▼──────────────────────────────────────────────┐
│                        POPUP                                          │
│                                                                       │
│  - Reads status / list via sendMessage to service worker              │
│  - Push Now / Pull Now buttons → sendMessage to service worker        │
│  - JSON export → service worker returns full payload                  │
│  - JSON import → service worker ingests + merges                      │
│  - Badge update via chrome.action.setBadgeText                        │
└─────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
              chrome.storage.sync
              (remote, per-Chrome-account)
```

---

## Component Responsibilities

| Component | Owns | Must NOT |
|-----------|------|----------|
| **Page injector** (MAIN world script) | Intercept `localStorage.setItem` calls for the watched key; post to content script | Touch chrome.* APIs (not available in MAIN world) |
| **Content script** (ISOLATED world) | Read/write page's `localStorage`; relay messages between page injector and service worker; dispatch synthetic `StorageEvent` on pull | Implement merge logic; maintain UUID state |
| **Service worker** | All sync logic: merge, conflict resolution, UUID assignment, tombstones, chunking, rate limiting, chrome.storage.sync I/O | Access `localStorage` (not available in SW context) |
| **Popup** | UI surface only — display status, list, trigger manual ops, export/import | Implement business logic; talk to chrome.storage.sync directly |

**Single-source-of-truth principle:** merge and conflict-resolution logic lives exclusively in the service worker. The content script is a dumb relay and I/O adapter. The popup is a dumb view.

---

## Message-Passing Topology

### Which side initiates which flow

```
PUSH FLOW (localStorage changed on this device)
  Page injector   --postMessage-->  Content script
  Content script  --sendMessage-->  Service worker  (type: "LS_CHANGED", payload: raw array)
  Service worker  (merges, writes chrome.storage.sync, nothing sent back to CS)

PULL FLOW (chrome.storage.onChanged fires — remote update arrived)
  chrome.storage.sync  --onChanged event-->  Service worker  (wakes SW if sleeping)
  Service worker  --tabs.sendMessage-->  Content script  (type: "APPLY_REMOTE", payload: merged array)
  Content script  (writes localStorage, dispatches StorageEvent)
  Content script  (optional ack back to SW via sendMessage if React picked it up)

POPUP QUERY FLOW
  Popup  --sendMessage-->  Service worker  (type: "GET_STATUS" | "GET_LIST")
  Service worker  --response-->  Popup  (status object | instruction list)

POPUP ACTION FLOW
  Popup  --sendMessage-->  Service worker  (type: "PUSH_NOW" | "PULL_NOW" | "EXPORT" | "IMPORT")
  Service worker  (executes, responds with result or error)

BOOTSTRAP FLOW (extension installs / tab first loads)
  Content script  --sendMessage-->  Service worker  (type: "BOOTSTRAP", payload: current LS snapshot)
  Service worker  (executes bootstrap algorithm, may reply with array to apply)
  Service worker  --tabs.sendMessage (if needed)-->  Content script  ("APPLY_REMOTE")
```

### Message vs Port decision

Use **`chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`** for all flows. Rationale: every exchange here is a single request + optional response. Ports are warranted for stateful streaming conversations; we have none. The 5-minute port disconnection bug in MV3 adds reconnection complexity that is not worth it for this use case.

---

## Where Merge Logic Lives

**Service worker only.** This is the irreversible architectural decision. Reasons:

1. The service worker is the only component that is alive on all devices (woken by `chrome.storage.onChanged`) and has access to full sync state.
2. Content scripts die when the tab closes. If merge were in the CS, a pull on one device while AI Studio is closed would be lost.
3. Keeping merge in one place makes the conflict algorithm auditable and testable in isolation.

The content script's merge role is zero: it hands the raw `localStorage` array to the SW, and blindly applies whatever array the SW hands back.

---

## Storage Layout in chrome.storage.sync

### Key namespace

```
sysins:meta              → { schemaVersion: 1, lastPush: <timestamp>, lastPull: <timestamp> }
sysins:registry          → { [uuid]: { title: string, updatedAt: number, deletedAt: number|null } }
sysins:body:<uuid>       → string  (the full instruction text, up to 8KB per key)
sysins:body:<uuid>:c0    → string  (chunk 0, if text > ~7KB)
sysins:body:<uuid>:c1    → string  (chunk 1)
...
sysins:body:<uuid>:cN    → string  (chunk N)
```

### Why this split

- **Registry key** holds only lightweight metadata (UUID, timestamps, tombstones). A registry for 100 instructions fits well under 8KB — typical title is ~50 bytes, timestamps ~20 bytes each → ~100 × 100 bytes = ~10KB. Split into `sysins:registry:0`, `sysins:registry:1` etc. if >8KB (unlikely for typical use).
- **Body keys** are per-UUID so a single large instruction does not block storage of other instructions.
- **Chunking per body:** chunk at 7,000 bytes (conservative, leaving ~1KB headroom for key name and JSON overhead). If `text.length * 3 <= 7000` (worst-case UTF-8), store as `sysins:body:<uuid>`. Otherwise split into `sysins:body:<uuid>:c0` … `sysins:body:<uuid>:cN` and write `sysins:body:<uuid>:chunks = N` so reassembly knows how many pieces to fetch.

### Concrete schema types

```typescript
// sysins:meta
interface SyncMeta {
  schemaVersion: 1;
  lastPushAt: number;   // epoch ms
  lastPullAt: number;
}

// sysins:registry  (may be sharded: sysins:registry:0, :1 if >8KB)
interface SyncRegistry {
  [uuid: string]: {
    title: string;
    updatedAt: number;   // epoch ms, set by this extension on any write
    deletedAt: number | null;  // epoch ms tombstone; null = alive
  };
}

// sysins:body:<uuid>  — single key, text fits in 7KB
// sysins:body:<uuid>:chunks  — number, how many chunks exist
// sysins:body:<uuid>:c0 … cN  — string chunks
```

### Quota math

- 8,192 bytes per item (QUOTA_BYTES_PER_ITEM, confirmed in official docs)
- 102,400 bytes total (QUOTA_BYTES)
- 512 max items (MAX_ITEMS)
- With 7KB body chunks: 102,400 / 7,000 ≈ 14 large instructions at max size before hitting total quota
- For typical instructions (500–2000 chars), 100+ instructions fit easily
- 512 items supports: 1 meta + ~5 registry shards + up to ~506 body/chunk keys → up to ~250 instructions with 2 chunks each

### Tombstone expiry

Tombstones in the registry have a TTL. Purge tombstones where `deletedAt < (now - 30 days)` on each successful sync round. This keeps the registry lean and prevents the deleted-at clock from piling up forever.

---

## localStorage Observation Strategy

### The problem

- `window.addEventListener('storage', ...)` does NOT fire in the same window that calls `localStorage.setItem`. It only fires in *other* tabs of the same origin.
- Content scripts run in an ISOLATED world and share the same `localStorage` object as the page — but they get no event either.
- MutationObserver watches DOM, not storage. It is not applicable here.

### Recommended approach: MAIN-world Storage.prototype patch + postMessage bridge

**Step 1 — Inject a MAIN-world script at `document_start`**

Declare in `manifest.json`:

```json
{
  "content_scripts": [
    {
      "matches": ["https://aistudio.google.com/*"],
      "js": ["src/injected/ls-observer.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://aistudio.google.com/*"],
      "js": ["src/content/content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

**Step 2 — Patch `Storage.prototype.setItem` in the MAIN-world script**

```javascript
// src/injected/ls-observer.js  — runs in MAIN world
const WATCHED_KEY = 'aistudio_all_system_instructions';
const _setItem = Storage.prototype.setItem;

Storage.prototype.setItem = function(key, value) {
  _setItem.apply(this, arguments);
  if (key === WATCHED_KEY && this === window.localStorage) {
    window.postMessage({ source: 'sysins-injected', type: 'LS_SET', value }, '*');
  }
};
```

**Step 3 — Content script listens to `window.message` events**

```javascript
// src/content/content.js  — runs in ISOLATED world
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'sysins-injected') return;
  if (event.data.type === 'LS_SET') {
    chrome.runtime.sendMessage({ type: 'LS_CHANGED', payload: JSON.parse(event.data.value) });
  }
});
```

### Why this approach over alternatives

| Approach | Verdict | Reason |
|----------|---------|--------|
| `Storage.prototype.setItem` patch (MAIN world) | **USE THIS** | Fires synchronously on every write; no polling delay |
| `window.addEventListener('storage')` | Reject | Does not fire for same-window writes |
| `MutationObserver` | Reject | Watches DOM, not storage |
| Polling (`setInterval` snapshot diff) | Fallback only | Acceptable 1-2 second latency for edge cases (e.g., page writes LS before injected script loads); use as belt-and-suspenders on `document_idle` |
| `chrome.scripting.executeScript` dynamically | Reject for observation | Requires a trigger; can't be the observer itself |

**Belt-and-suspenders poll:** In the content script, also poll `localStorage.getItem(WATCHED_KEY)` every 2 seconds on `document_idle`, compare to last-known snapshot, and fire `LS_CHANGED` if different. This catches writes that happen before the injected script is in place (rare with `document_start` but possible in race conditions during extension install).

---

## Live-Update Path (Pull to React)

When the service worker pushes a new merged array to the content script:

```javascript
// content.js — applied when SW sends "APPLY_REMOTE"
function applyRemoteArray(newArray) {
  const serialized = JSON.stringify(newArray);
  const oldValue = localStorage.getItem('aistudio_all_system_instructions');

  // 1. Write to localStorage directly (CS can do this — same origin)
  localStorage.setItem('aistudio_all_system_instructions', serialized);

  // 2. Dispatch a synthetic StorageEvent  
  //    NOTE: Must use window.dispatchEvent, not document.dispatchEvent
  //    storageArea must be the actual localStorage object for React's listener to match
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'aistudio_all_system_instructions',
    oldValue: oldValue,
    newValue: serialized,
    storageArea: localStorage,
    url: window.location.href,
  }));
}
```

**Why this works (and when it doesn't):**

- The browser's native `storage` event fires for *other* tabs. A manually dispatched `StorageEvent` fires in *this* tab. React's `useEffect(() => window.addEventListener('storage', ...), [])` pattern (if AI Studio uses it) will respond.
- If AI Studio reads localStorage during render rather than subscribing to `storage` events, the synthetic event does nothing. This is the "fallback: prompt reload" path.
- Do NOT try to update React fiber state directly — AI Studio internals change, and this would be a maintenance nightmare.
- After dispatching, wait 200ms and check whether `localStorage` value matches what was written. If AI Studio has overwritten it (e.g., by flushing its own state), that's a conflict; re-run the merge cycle.

**Popup hint logic:** If the content script fires `APPLY_REMOTE` but AI Studio rewrites the same key within 500ms (detected by the MAIN-world patch firing with different content), surface "Refresh AI Studio to see latest" via badge and popup message.

---

## Bootstrap Algorithm (First Install on a New Machine)

```
onInstalled event fires
  │
  ├─► Read chrome.storage.sync  (has remote data?)
  │     │
  │     ├─ YES: remote has entries with updatedAt timestamps
  │     │         │
  │     │         ├─► Read localStorage from active aistudio.google.com tab (if open)
  │     │         │     │
  │     │         │     ├─ Tab open + LS has data: RUN MERGE ALGORITHM
  │     │         │     │   (same merge as normal sync — per-item last-write-wins)
  │     │         │     │   → Write merged result to LS via content script
  │     │         │     │   → Write merged result to sync
  │     │         │     │
  │     │         │     └─ Tab not open or LS empty: PULL ONLY
  │     │         │         → Store remote state as authoritative
  │     │         │         → Write to LS next time aistudio.google.com opens
  │     │         │
  │     │         └─ No local data: PULL ONLY (remote wins trivially)
  │     │
  │     └─ NO: remote is empty
  │           │
  │           ├─► Read localStorage from active tab (if open)
  │           │     │
  │           │     ├─ Has data: PUSH (assign UUIDs, push to sync)
  │           │     └─ Empty: No-op, wait for user to create instructions in AI Studio
  │           │
  │           └─ No active tab: No-op, defer to next tab open event
  │
  └─► Register chrome.tabs.onUpdated listener to bootstrap when
      aistudio.google.com first loads if tab was not open at install time
```

**UUID assignment on first sight:**

When the service worker sees a `{ title, text }` pair it has not tracked before, it computes a stable fingerprint:

```javascript
// Fingerprint = SHA-256 of normalized title (trimmed, lowercased)
// Used only to detect "same instruction" across rename-free devices
// Once UUID is assigned, UUID is the stable identity going forward
const uuid = crypto.randomUUID();
registry[uuid] = { title: item.title, updatedAt: Date.now(), deletedAt: null };
```

Identity matching on bootstrap: match by `title` (exact string) to detect that the same instruction exists on both local and remote without a UUID yet. Assign the remote UUID if remote has one. First-device wins on UUID assignment.

---

## Throttling / Debounce Strategy

### The constraints

- 1,800 writes/hour = 1 write per 2 seconds sustained
- 120 writes/minute = 2 writes/second burst
- Each `chrome.storage.sync.set({key: value})` call counts as 1 write per key written

### Strategy: pending-set flush with chrome.alarms

```
On LS_CHANGED received in service worker:
  1. Run merge algorithm → compute new sync state (set of changed keys)
  2. Accumulate changed keys into a pendingWrite: Map<key, value>
  3. Clear any existing "sync-flush" alarm
  4. Schedule chrome.alarms.create("sync-flush", { delayInMinutes: 0.5 })
     (30 seconds — matches minimum alarm period in Chrome 120+)

On alarm "sync-flush" fires:
  1. Drain pendingWrite map
  2. Call chrome.storage.sync.set(pendingWrite) in one batched call
     (counts as N writes, where N = number of keys changed, but all in one round-trip)
  3. Clear pendingWrite

For PUSH_NOW (manual): bypass the alarm, flush immediately
```

**Batching effect:** If the user rapidly adds 5 instructions in AI Studio within a 30-second window, only 1 alarm fires and 1 batched write happens. Without this, 5 rapid edits would each trigger individual writes.

**Rate limit error handling:**

```javascript
try {
  await chrome.storage.sync.set(batch);
} catch (err) {
  if (err.message?.includes('MAX_WRITE_OPERATIONS_PER_MINUTE')) {
    // Back off 60 seconds, re-queue
    chrome.alarms.create("sync-flush-retry", { delayInMinutes: 1 });
  } else if (err.message?.includes('QUOTA_BYTES')) {
    // Surface quota error to popup via chrome.storage.local flag
    await chrome.storage.local.set({ errorState: 'QUOTA_EXCEEDED' });
  }
}
```

---

## Architectural Patterns

### Pattern 1: Relay-only Content Script

**What:** Content script holds zero business logic. It reads/writes localStorage and forwards payloads verbatim. All decisions are made in the service worker.

**Why:** Content scripts are ephemeral (die with the tab). Service workers are the correct place for state that outlives any single tab session. Distributing merge logic into the CS creates two sources of truth and makes it impossible to run merge when the user is not on the AI Studio tab.

**Trade-off:** Every sync operation requires a message round-trip CS→SW. This adds ~1ms latency, which is imperceptible.

### Pattern 2: MAIN-world Script as a Thin Sensor

**What:** The only code in MAIN world is the `Storage.prototype.setItem` patch. It does exactly one thing: posts a message when the watched key changes. It holds no state, does no logic.

**Why:** MAIN world injection is a security footprint. The less code in MAIN world, the smaller the attack surface. If AI Studio changes how it writes localStorage, the patch still fires.

**Trade-off:** MAIN-world scripts cannot use chrome.* APIs. postMessage to ISOLATED world is the only bridge. This is correct — it is the intended pattern.

### Pattern 3: Registry + Body Separation in Storage

**What:** Metadata (UUID, timestamps, tombstones) is stored in a separate registry key from instruction text. Merge operates on the registry first, then fetches body keys only as needed.

**Why:** Reading all body chunks just to check timestamps is wasteful and slow. The registry is small and cheap to read in full. Most sync operations only need registry-level decisions.

**Trade-off:** Two reads (registry + body) instead of one when applying a pull. Acceptable.

### Pattern 4: Last-Write-Wins per UUID with Tombstones

**What:** Each UUID has `updatedAt`. On conflict, higher `updatedAt` wins. Deletes write a tombstone (`deletedAt: <timestamp>`) rather than removing the UUID from the registry.

**Why:** Without tombstones, deleting on device A and not yet syncing to device B means the next push from B resurrects the deleted item. Tombstones propagate the intent to delete.

**Trade-off:** Registry grows over time. Tombstone expiry (purge entries >30 days old) manages this.

---

## Data Flow Diagrams

### Push Flow (user edits an instruction in AI Studio)

```
AI Studio React → localStorage.setItem('aistudio_all_system_instructions', newArray)
       │
       ▼ (Storage.prototype.setItem patch fires)
MAIN world script → window.postMessage({ type: 'LS_SET', value: newArray })
       │
       ▼ (content script message listener)
Content script → chrome.runtime.sendMessage({ type: 'LS_CHANGED', payload: parsed })
       │
       ▼
Service worker:
  1. Diff incoming array against current registry
  2. For new titles: assign UUID, set updatedAt = now()
  3. For changed text: update body, bump updatedAt
  4. For missing UUIDs (deleted): set deletedAt = now() (tombstone)
  5. Add changed keys to pendingWrite
  6. Schedule/reset 30s flush alarm
       │
       ▼ (30 seconds later, or on PUSH_NOW)
Service worker → chrome.storage.sync.set(pendingWrite batch)
       │
       ▼ (chrome.storage.sync propagates to other devices)
[other devices' service workers wake via chrome.storage.onChanged]
```

### Pull Flow (remote change arrives from another device)

```
chrome.storage.sync (remote) → [Chrome sync infrastructure syncs]
       │
       ▼ (chrome.storage.onChanged event — wakes service worker)
Service worker:
  1. Read changed keys from onChanged event
  2. For each changed UUID in registry: compare updatedAt with local registry
  3. Apply remote entry if remote.updatedAt > local.updatedAt
  4. Apply remote tombstone if remote.deletedAt > local record
  5. Reconstruct merged array (alive entries only, sorted by updatedAt desc)
  6. Write merged registry back to sync (if local entries won any conflicts)
       │
       ▼
Service worker → chrome.tabs.sendMessage(aistudioTabId, { type: 'APPLY_REMOTE', payload: mergedArray })
       │
       ▼ (content script receives)
Content script:
  1. localStorage.setItem('aistudio_all_system_instructions', JSON.stringify(mergedArray))
  2. window.dispatchEvent(new StorageEvent('storage', { key: ..., newValue: ..., storageArea: localStorage }))
       │
       ▼
AI Studio React (if it listens to 'storage' event): re-reads localStorage, updates UI
       │ (if React does not respond)
       ▼
Content script → sendMessage({ type: 'REACT_IGNORED' }) → Service worker → set badge "↻"
```

### Conflict Flow (both devices edit the same instruction offline)

```
Device A: instruction X, updatedAt = T+10
Device B: instruction X, updatedAt = T+20  (wins)

Service worker on Device A (when it syncs):
  remote X.updatedAt (T+20) > local X.updatedAt (T+10)
  → Accept remote body, update local registry
  → Overwrite local LS with merged array including remote X

Device A user sees Device B's version. No notification needed (silent LWW).
```

### Bootstrap Flow

```
chrome.runtime.onInstalled fires
       │
       ▼
Service worker reads chrome.storage.sync:
  ├─ Remote has data? → getAistudioTab() → request LS snapshot via content script
  │     ├─ LS has data → run merge algorithm → write both sync and LS
  │     └─ LS empty → pull remote → apply to LS when tab next loads
  └─ Remote empty?
        ├─ AI Studio tab open → request LS snapshot → push to sync
        └─ No tab → register tabs.onUpdated listener, defer
```

---

## Project Structure

```
src/
├── injected/
│   └── ls-observer.js        # MAIN world: Storage.prototype.setItem patch
├── content/
│   └── content.ts            # ISOLATED world: postMessage bridge + LS read/write + StorageEvent dispatch
├── background/
│   ├── service-worker.ts     # Entry point — registers all event listeners
│   ├── sync-engine.ts        # Merge algorithm, conflict resolution, LWW logic
│   ├── storage-layout.ts     # chrome.storage.sync read/write helpers, chunking/reassembly
│   ├── registry.ts           # UUID assignment, updatedAt/deletedAt management
│   ├── throttle.ts           # pendingWrite map + alarm-based flush logic
│   └── bootstrap.ts          # First-install algorithm
├── popup/
│   ├── popup.html
│   ├── popup.ts              # UI logic: sendMessage to SW, render list/status
│   └── popup.css
├── shared/
│   ├── types.ts              # SyncMeta, SyncRegistry, Instruction, Message types
│   └── constants.ts          # Key prefixes, quota constants, TTL values
└── manifest.json
```

---

## Suggested Build Order

Build in this order because each component unblocks the next:

### Phase 1: Storage foundation (service worker + storage-layout)
Build `storage-layout.ts` with chunking/reassembly first. Write unit tests against it. This is the most quota-sensitive code and bugs here cause data loss. It does not depend on any other component.

**Proves:** you can store and retrieve a full instruction set through the quota-respecting layer.

### Phase 2: Content script + MAIN world injector
Build `ls-observer.js` + `content.ts`. Wire up the postMessage bridge and confirm the patch fires on AI Studio. This is buildable without the SW being complete — log to console.

**Proves:** the observation pipeline works end-to-end before any sync logic.

### Phase 3: Service worker — push path only
Implement `sync-engine.ts`, `registry.ts`, and `throttle.ts` for the push direction only (LS_CHANGED → merge → chrome.storage.sync.set). No pull yet.

**Proves:** changes on one device land in sync storage correctly.

### Phase 4: Service worker — pull path
Add `chrome.storage.onChanged` handler, merge on pull, push merged array back to content script for LS write + StorageEvent dispatch.

**Proves:** full bidirectional sync between two machines.

### Phase 5: Bootstrap algorithm
Implement `bootstrap.ts`. Test the four bootstrap scenarios (remote data / no remote data) × (tab open / no tab).

**Proves:** new-machine install works correctly.

### Phase 6: Popup
Build the popup last. All the underlying messages exist; the popup just calls them. Popup is easily replaceable; the sync engine is not.

**Proves:** user has visibility and manual escape hatches.

---

## Anti-Patterns

### Anti-Pattern 1: Merge logic in the content script

**What people do:** Put conflict-resolution code in content.ts because "it's closer to localStorage."

**Why it's wrong:** The content script does not exist when AI Studio is not open. A pull from another device would require AI Studio to be open on both devices simultaneously. The merge would fail silently otherwise.

**Do this instead:** Service worker owns merge. Content script is a relay.

### Anti-Pattern 2: Storing the full instruction array in one chrome.storage.sync key

**What people do:** `chrome.storage.sync.set({ instructions: JSON.stringify(allInstructions) })`.

**Why it's wrong:** One large instruction can push the serialized array over 8KB. The entire collection fails to write. Worse, `onChanged` fires for the entire key on any change, even a single character edit.

**Do this instead:** Per-UUID body keys with chunking. Registry is separate from bodies.

### Anti-Pattern 3: Using `window.localStorage.setItem` from the content script to trigger the page's storage listener

**What people do:** Write to LS from ISOLATED world, expect a `storage` event the page will catch.

**Why it's wrong:** Writes from the ISOLATED world's LS access do write to the actual page's localStorage (they share the origin). But `storage` events don't fire for same-window writes regardless of world. The manual `StorageEvent` dispatch is the only path.

**Do this instead:** Write LS, then `window.dispatchEvent(new StorageEvent(...))` explicitly.

### Anti-Pattern 4: Polling chrome.storage.sync in the content script

**What people do:** Content script polls `chrome.storage.sync.get` every N seconds to detect remote changes.

**Why it's wrong:** Content scripts can access `chrome.storage.sync`, but `chrome.storage.onChanged` in the service worker is the correct event-driven mechanism. Polling from CS burns CPU, doesn't work when the tab is closed, and duplicates logic.

**Do this instead:** Service worker registers `chrome.storage.onChanged`. When a remote change arrives, SW pushes to the CS via `tabs.sendMessage`.

### Anti-Pattern 5: Using chrome.scripting.executeScript for the observation hook

**What people do:** Dynamically inject the Storage.prototype patch via `executeScript` at runtime.

**Why it's wrong:** `executeScript` runs after the fact. If AI Studio writes localStorage during initial page load (e.g., loading saved instructions), the write happens before the patch is installed.

**Do this instead:** Declare the MAIN-world content script in `manifest.json` with `run_at: "document_start"` so it runs before any page JS.

---

## Integration Points

### Internal Boundaries

| Boundary | Channel | Direction | Notes |
|----------|---------|-----------|-------|
| MAIN world → ISOLATED world (CS) | `window.postMessage` | page → CS | Filter by `event.data.source === 'sysins-injected'` |
| Content script → Service worker | `chrome.runtime.sendMessage` | CS → SW | One-way push; no response needed for LS_CHANGED |
| Service worker → Content script | `chrome.tabs.sendMessage(tabId, ...)` | SW → CS | Requires SW to find the aistudio tab ID first |
| Popup → Service worker | `chrome.runtime.sendMessage` | popup → SW | Response expected; use `async/await` |
| Service worker → chrome.storage.sync | Direct API | SW ↔ sync | Only the SW touches sync directly |

### External Services

| Service | Pattern | Notes |
|---------|---------|-------|
| chrome.storage.sync (Google Sync) | Read/write via Chrome API | No direct network call; Chrome handles sync transport |
| aistudio.google.com localStorage | Read/write via content script | Must have host permission in manifest |

---

## Reversibility Assessment

| Decision | Reversible? | Notes |
|----------|-------------|-------|
| Merge logic in service worker | Hard to reverse | Changing this requires rewriting both CS and SW |
| Storage key namespace (`sysins:*`) | Reversible with migration | Bump `schemaVersion` in meta key, run migration on startup |
| Chunking strategy (7KB chunks) | Reversible with migration | schemaVersion + rewrite |
| MAIN-world patch approach for observation | Reversible | Could swap for polling with no other component changes |
| sendMessage vs Port | Reversible | Isolated to CS↔SW communication layer |
| UUID as identity (not title hash) | Irreversible once deployed | Changing identity scheme loses history for existing users |
| LWW per-item conflict resolution | Hard to reverse | Users would expect consistent behavior; changing mid-deployment causes data divergence |
| 30-second debounce window | Trivially reversible | Change constant |

---

## Sources

- [Chrome Extension Message Passing — Official Docs](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [chrome.storage API Reference — Official Docs](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.scripting API — world parameter](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Extension Service Worker Lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Window: storage event — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
- [chrome-storage-largeSync — chunking reference implementation](https://github.com/dtuit/chrome-storage-largeSync)
- [chrome.storage.sync quota best practices — Chromium Extensions Group](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/ACVyerzOjus)

---
*Architecture research for: Chrome MV3 Extension — AI Studio system instructions sync*
*Researched: 2026-05-01*

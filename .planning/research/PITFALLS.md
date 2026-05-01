# Pitfalls Research

**Domain:** Chrome MV3 extension — bidirectional localStorage/chrome.storage.sync sync against a third-party React app
**Researched:** 2026-05-01
**Confidence:** HIGH (MV3 lifecycle, storage API quotas, StorageEvent spec) / MEDIUM (AI Studio internals, sync conflict patterns)

---

## Critical Pitfalls

### MV3-1: Service Worker Killed Mid-Chunked-Write

**What goes wrong:**
A sync operation requires writing N keys to `chrome.storage.sync` (because the payload is chunked across multiple items). The service worker is terminated after 30 seconds of inactivity or after 5 minutes of processing. If the worker dies between key writes, only a partial set of chunks lands in sync storage. On the next read, the chunk manifest references chunk keys that do not exist, producing corrupted data.

**Why it happens:**
MV3 service workers are aggressively terminated. The 30-second idle timer resets only when an extension API is called. A sequence of `chrome.storage.sync.set()` calls is non-blocking; the worker can idle out between them. Developers assume that because they dispatched the writes, the writes are "in flight" and will complete — but termination cancels pending microtasks and any in-memory orchestration state.

**How to avoid:**
1. Write all chunks for a single logical item in a single `chrome.storage.sync.set({key1: chunk1, key2: chunk2, ...})` call — this is one atomic operation at the Chrome API level, not multiple. The multi-key overload of `set()` is the correct primitive.
2. Before any multi-key write, store a "pending write" sentinel key (e.g., `sync_pending: {version, timestamp}`) and remove it only after the full set resolves. On service worker startup (the `install` / `activate` / alarm wake), check for a stale `sync_pending` key and trigger a repair read.
3. Use `chrome.alarms.create()` to schedule periodic consistency checks — alarms survive worker termination and re-wake the worker.

**Warning signs:**
- Popup shows "N instructions" but AI Studio shows a different count after a pull.
- `chrome.storage.sync.get()` returns a chunk manifest but one or more referenced chunk keys are missing.
- `chrome.runtime.lastError` fires during `set()` — indicates quota or connectivity issue that partially blocked the write.

**Phase to address:** Phase implementing chunked sync write path (whichever phase builds the sync engine core).

---

### MV3-2: Write Rate Limit Triggered by Naively Fanning Out Per-Item Writes

**What goes wrong:**
Each item gets its own metadata key plus up to N chunk keys. A user with 30 instructions, syncing after a bulk import, fires 30 metadata writes + up to 30 × N chunk writes in rapid succession. At 120 writes/minute (2/sec), 60 writes exhaust the per-minute budget in 30 seconds. Chrome rejects further writes immediately with a `QUOTA_EXCEEDED` error. If this isn't caught, the extension silently believes the sync succeeded while half the data is missing on the remote.

**Why it happens:**
The rate limit counts individual `set()` / `remove()` / `clear()` calls — not individual keys. Developers who loop `chrome.storage.sync.set({[key]: value})` per item turn O(items) operations into O(items) API calls instead of batching them.

**How to avoid:**
1. Always batch: collect all key/value pairs for a sync cycle and issue a single `chrome.storage.sync.set(allPairs)` call. One call = one operation against the rate limiter, regardless of how many keys are in the object.
2. Wrap every `set()`/`remove()` in a rate-aware queue that catches `QUOTA_EXCEEDED` (check `chrome.runtime.lastError`), backs off with exponential delay, and retries. Surface this state via the badge (e.g., amber "⏳ syncing").
3. Throttle content-script-initiated syncs with a debounce (e.g., 2-second debounce on `localStorage` change detection) to avoid rapid consecutive writes during a user's editing session.

**Warning signs:**
- `chrome.runtime.lastError` with `"QUOTA_EXCEEDED"` in write callbacks.
- Sync falls behind during bulk edits.
- Popup shows "Last sync: 3 minutes ago" when the user just saved.

**Phase to address:** Phase implementing the sync engine core; revisit in any phase that adds bulk import/export.

---

### MV3-3: In-Memory State Lost on Worker Restart — Sync State Machine Corruption

**What goes wrong:**
The extension tracks sync state (last-synced version, in-progress flag, pending-merge queue) in service worker global variables. Chrome kills the worker. On re-wake, all globals are undefined. The next sync cycle reads stale or absent state, re-processes already-synced items, or skips pending merges entirely.

**Why it happens:**
MV3 service workers have no persistent memory. Developers from MV2 background page background carried over the mental model that globals survive. In MV3 they don't.

**How to avoid:**
1. Treat all sync state as ephemeral in-memory cache only. Persist everything that matters — last synced vector/timestamp per item, pending-merge queue, in-progress flag — to `chrome.storage.local` (not sync, to avoid circular dependency).
2. On every worker wake (handle all API events with an async init guard), read state from `chrome.storage.local` before doing any sync work.
3. Use a simple write-ahead pattern: write `local.sync_state = {status: "in_progress", started_at: ...}` before beginning; update to `"idle"` on completion. Detect stale `in_progress` states (older than, say, 10 minutes) and reset them on startup.

**Warning signs:**
- Sync runs multiple times for the same data after the popup is closed and re-opened.
- Duplicate entries appear in AI Studio localStorage after a browser restart.
- "Last sync" timestamp resets to "never" after Chrome is restarted.

**Phase to address:** Phase 1 / service worker architecture design. This must be correct from the start — retrofitting later is high-risk.

---

### MV3-4: `storage` Event NOT Fired in the Writing Window — React State Not Updated Live

**What goes wrong:**
The content script writes updated instructions to `window.localStorage` and then dispatches a synthetic `new StorageEvent('storage', {...})` on `window`. The intent is to trigger AI Studio's React components to re-render with the new data. However, by spec (MDN Web Storage API), `window.storage` events are only fired in **other** browsing contexts (other tabs/windows on the same origin), not in the same window that performed the write. The dispatch call appears to succeed, but AI Studio's listener (if any) never fires.

**Why it happens:**
The Web Storage spec explicitly excludes the initiating window from receiving storage events — this is a 15+ year-old intentional design. Developers test by opening two tabs and seeing events fire, then assume the single-tab case works the same way.

**How to avoid:**
1. Do not rely on `window.dispatchEvent(new StorageEvent(...))` for in-tab notification. This only works cross-tab.
2. For same-tab notification, use `window.dispatchEvent(new CustomEvent('aistudio-sync-updated', {detail: ...}))` after the localStorage write. AI Studio is unlikely to listen to a custom event name, so this is only useful if the extension's own injected code also listens.
3. Accept that live same-tab React update is best-effort and unreliable. The reliable fallback is the popup badge hint: "AI Studio is open — refresh to see the latest instructions." Set the badge text/color via `chrome.action.setBadgeText()` from the service worker when a remote pull updates data while an aistudio.google.com tab is open.
4. Alternatively, after writing to localStorage, query `window.__REACT_FIBER__` or similar React internals to trigger a re-render — but this is extremely brittle and explicitly out of scope per PROJECT.md.

**Warning signs:**
- User reports instructions updated in popup but AI Studio still shows old list until page refresh.
- Content script logs show localStorage write succeeded but no visible React state change.

**Phase to address:** Phase implementing pull-from-sync → write-to-localStorage path.

---

## Sync/Merge Pitfalls

### SYNC-1: Infinite Sync Loop — Write Triggers onChanged Triggers Write

**What goes wrong:**
The content script listens to `chrome.storage.onChanged` (or the service worker listens and messages back). When remote changes arrive, the content script writes to `localStorage`. The `localStorage` mutation observer (polling or `MutationObserver` on the DOM) detects a change and triggers a push back to `chrome.storage.sync`. This push fires `onChanged` again. The loop continues until rate limits are hit.

**Why it happens:**
`chrome.storage.onChanged` fires in every extension context that registered a listener, including the same content script that initiated a write in some cases. Even when write and read are in different contexts (service worker writes sync, content script reads sync), if the content script then writes localStorage, and localStorage polling triggers another push, the loop is formed through two hops.

**How to avoid:**
1. Track the "source" of each sync cycle. Before the content script writes to localStorage in response to a pull, set a flag (e.g., `window.__aistudio_sync_writing = true`) and clear it after the write. The localStorage change observer must check this flag and skip push if it is set.
2. In the push path, diff the current localStorage value against the last-pushed value (cached in `chrome.storage.local`). Only push if the diff is non-empty. This is the most reliable guard.
3. Add a minimum push interval (e.g., 3 seconds) enforced in the service worker; repeated identical pushes within this window are deduplicated.

**Warning signs:**
- Write operations climb rapidly in the service worker logs.
- Rate limit errors appear shortly after any sync event.
- CPU usage on the aistudio.google.com tab spikes during sync.

**Phase to address:** Phase implementing the sync engine core, specifically the pull→localStorage write path.

---

### SYNC-2: Tombstone Graveyard Growth — Deleted Items Accumulate Forever

**What goes wrong:**
When a user deletes an instruction, the extension writes a tombstone: `{uuid: "...", deleted_at: 1234567890, is_deleted: true}` to `chrome.storage.sync`. Tombstones must be retained long enough for all devices to see the deletion. But there is no GC mechanism. Over months of use, deleted items accumulate. Each tombstone costs quota bytes. With 512 items maximum in `chrome.storage.sync` and both live items and their metadata keys, tombstones can consume a significant fraction of the item count limit.

**Why it happens:**
Tombstone GC requires knowing that "all devices have seen this deletion." Without a server arbiter, there is no reliable way to know this. The common shortcut is: never GC tombstones. This works at first but degrades over time.

**How to avoid:**
1. Implement time-based tombstone GC: any tombstone older than a configurable threshold (e.g., 90 days) is safe to delete, on the assumption that any device offline for 90+ days has missed the deletion but also hasn't been used for 90 days. This mirrors Cassandra's `gc_grace_seconds` pattern.
2. Track tombstones separately from live metadata in a dedicated key (e.g., `tombstones: [{uuid, deleted_at}, ...]`) and age them out in a single atomic rewrite when the oldest tombstone exceeds the threshold.
3. Surface a warning in the popup if tombstone count exceeds, say, 50: "Cleaning up N deleted items…" and trigger GC immediately.

**Warning signs:**
- `chrome.storage.sync` item count approaches 512 even though the user has fewer active instructions.
- `getBytesInUse()` is high relative to the number of visible instructions.
- Sync slows down noticeably (more keys to read/write per cycle).

**Phase to address:** Phase implementing the delete/tombstone path; GC must be designed in at the same time, not retrofitted.

---

### SYNC-3: Clock Skew Corrupts Last-Write-Wins Resolution

**What goes wrong:**
The extension uses `Date.now()` on each device to generate `updated_at` timestamps. Device A has its system clock drifted forward by 5 minutes (common after suspend/resume, NTP drift, DST transition). Device A writes an old version of an instruction but the timestamp is in the "future" from the perspective of Device B. Device B's newer edit is discarded because it has a smaller `Date.now()` value. The user loses their most recent edit with no indication.

**Why it happens:**
Physical clocks are not reliable across devices in a distributed system. The gap between two consumer machines can exceed 100ms–500ms routinely, and can be minutes after laptop sleep/wake or time zone changes. LWW on physical timestamps is a known fragile pattern in distributed systems literature.

**How to avoid:**
1. Use a **Hybrid Logical Clock (HLC)** pattern: each device tracks `{physical: Date.now(), logical: counter}`. On read, advance `logical` if the remote timestamp's physical component is greater than local `Date.now()`. This preserves causal ordering even under moderate clock skew.
2. For a simpler but more conservative approach: include a monotonic per-device edit counter alongside `updated_at`. When two items have timestamps within a configurable skew window (e.g., 60 seconds), treat them as concurrent and prefer the device counter rather than the wall clock.
3. Never rely on `updated_at` alone as the only conflict signal. Pair it with a content hash: if `updated_at` favors the remote but the local content also changed (hash differs), surface a visible conflict in the popup rather than silently discarding.

**Warning signs:**
- A user reports an edit "disappearing" after they synced from a second machine.
- `updated_at` timestamps in storage are in the future relative to the current machine's clock.

**Phase to address:** Phase designing the per-item metadata schema (must be designed before the first sync cycle is implemented).

---

### SYNC-4: Delete Resurrection — Offline Device B Revives Item Deleted by Device A

**What goes wrong:**
Device A deletes an instruction and writes a tombstone. Device B is offline for a week, then reconnects. Device B pushes its live item (because from B's perspective the item exists and is newer than any remote state it has seen). The tombstone's `deleted_at` timestamp is older than B's `updated_at` for the item. The LWW merge picks "live wins" because `updated_at > deleted_at`. The deleted item is resurrected.

**Why it happens:**
Simple LWW timestamp comparison between `updated_at` and `deleted_at` breaks when the delete and the last live edit are causally unordered — i.e., both happened without knowledge of each other.

**How to avoid:**
1. Treat delete as a special class: a tombstone with `deleted_at` should win over any `updated_at` that is older than `deleted_at`, regardless of device. The rule is: **if we have a tombstone and `deleted_at > updated_at`, the item is deleted. Period.** The only override is if the item was explicitly re-created (a new UUID is assigned) after the delete.
2. Since AI Studio does not assign IDs, re-creation of a deleted item will always get a new UUID from the extension (because the old UUID is tombstoned and the new item has no UUID yet). This naturally breaks the resurrection cycle if UUID assignment is gated on "not in tombstone set."
3. During merge: before assigning a new UUID to an incoming item from localStorage, check the tombstone set for a content match (title + text hash). If found and the tombstone is recent (within the GC window), surface a warning: "An item matching a recently deleted instruction appeared — was this intentional?"

**Warning signs:**
- Instructions re-appear on Device A that the user deleted weeks ago.
- The sync log shows a push from Device B containing items that exist as tombstones in Device A's sync store.

**Phase to address:** Same phase as tombstone/delete design. Resurrection prevention requires coordinated design of UUID assignment, tombstone matching, and merge logic.

---

### SYNC-5: Initial Pull Overwrites Richer Local State on New Device

**What goes wrong:**
User signs into Chrome on a new machine. The extension installs. On first run, it pulls from `chrome.storage.sync` and writes to `localStorage`. However, the user had already been using AI Studio on this machine before installing the extension — they have a meaningful local set of instructions in `localStorage` that is not in sync yet. The initial pull overwrites `localStorage` with the (potentially smaller or older) synced set. Local instructions that were never pushed are lost.

**Why it happens:**
The extension assumes sync storage is authoritative on first install. This is wrong: on first install there is no "authoritative" source — both the local `localStorage` and the remote `chrome.storage.sync` may have data that the other doesn't.

**How to avoid:**
1. On `chrome.runtime.onInstalled` with `reason === "install"`, perform a **merge, not an overwrite**: read both `localStorage` and `chrome.storage.sync`, union the two sets (assigning UUIDs to local items not yet in sync), then write the merged set back to both.
2. Surface an "Initial sync complete: X instructions merged from this device, Y pulled from your other devices" message in the popup on first run.
3. Never issue a blind `localStorage.setItem(key, remoteValue)` without first checking if there is local data that is newer (no `updated_at` yet → treat as "just created," i.e., very high priority in merge).

**Warning signs:**
- User reports "all my instructions disappeared" after installing on a machine they've used AI Studio on before.
- The instruction count in the popup after first install is lower than what was in AI Studio before install.

**Phase to address:** Phase implementing initial install / onboarding flow.

---

## AI Studio Integration Pitfalls

### AISTUDIO-1: AI Studio Adds Unknown Fields — Forward Compatibility Breakage

**What goes wrong:**
AI Studio currently stores `{ title: string, text: string }` per instruction. A future AI Studio update adds a field: `{ title, text, category: string, pinned: boolean }`. The extension reads from `localStorage`, strips the known fields to build its internal model, and writes back only `{ title, text }`. The new fields are silently lost on every sync cycle. Users with the new AI Studio version lose data that AI Studio depended on.

**Why it happens:**
Extensions that own a schema naturally map remote data to their own types. The omission of "pass-through unknown fields" is a default when destructuring or mapping objects in TypeScript/JS.

**How to avoid:**
1. Use a spread-first pattern when reading from localStorage: `const {title, text, ...rest} = item`. Store `rest` opaquely in the extension metadata keyed by UUID. When writing back to `localStorage`, reconstruct as `{title, text, ...rest}`.
2. Schema-version the stored representation. If the reconstructed item differs structurally from what was read (e.g., new keys appeared in the live item), log a `schema_evolution_detected` event and skip the write-back for that item until the extension can handle it.
3. Add a startup check: compare the structural shape of the first item in `localStorage` against the known schema version. If unknown keys are detected, set a `schema_unknown` flag and surface a popup warning: "AI Studio may have updated. Sync is read-only until you update the extension."

**Warning signs:**
- AI Studio instructions lose formatting options or metadata after a sync.
- `localStorage` inspection shows fields present that are absent from the extension's stored copies.

**Phase to address:** Phase designing the internal data model and localStorage read/write adapter. Must be built with forward-compatibility as a first-class constraint.

---

### AISTUDIO-2: AI Studio Renames the localStorage Key

**What goes wrong:**
`aistudio_all_system_instructions` is an undocumented internal implementation detail of AI Studio. A future refactor renames it to `aiStudioSystemInstructions` or moves the data to IndexedDB / a server-side store. The extension's content script reads a non-existent key, gets `null`, and interprets this as "user has no instructions." If auto-sync is bidirectional, it pushes an empty array to sync storage and deletes the user's entire instruction library on all devices.

**Why it happens:**
The extension depends on an internal API it cannot control and has no contract with.

**How to avoid:**
1. Add a key-discovery step at content script startup: check `localStorage` for the known key; if absent, scan for keys matching a heuristic (e.g., keys containing "system_instructions" or "instructions", values that are JSON arrays of objects with `title` and `text`). If found under a different name, log and use it; surface a "Key changed — please update extension" warning if nothing is found.
2. Treat `null` / empty-array reads as **absence of data**, not as "user deleted everything." The distinction: if the extension has previously found N items and now reads 0 items, treat this as a **detection failure** (the key moved or is temporarily unavailable), not as a user-initiated mass delete. Require an explicit user action (the "Push now" button) to propagate a zero-item state.
3. Write a dead man's switch: if the key has been missing for X consecutive sync cycles, disable auto-push and alert the user.

**Warning signs:**
- Content script read returns `null` or `[]` on a machine where instructions were previously present.
- AI Studio version update correlates temporally with sync failure.
- User reports "all instructions gone on all devices simultaneously."

**Phase to address:** Phase implementing the content script localStorage adapter. The null/empty distinguisher must be in place before any push logic is wired up.

---

### AISTUDIO-3: Multi-Tab Interference — Two AI Studio Tabs Competing for localStorage

**What goes wrong:**
User opens AI Studio in Tab 1 and Tab 2. They edit an instruction in Tab 1. The content script in Tab 1 detects the change and pushes to sync. The service worker pulls the update and writes back to localStorage. The content script in Tab 2 also receives `chrome.storage.onChanged` and writes to Tab 2's `localStorage`. Now both tabs have written to the same `localStorage` origin. `localStorage` is shared per origin across tabs — the writes race. The last tab to write wins at the localStorage level, regardless of the merge logic.

**Why it happens:**
`localStorage` is a shared mutable store for all tabs on the same origin. When multiple content script instances exist (one per tab), each instance independently observes changes and independently writes, without coordination with sibling instances.

**How to avoid:**
1. Implement a tab-level leader election: only one content script instance should perform writes to `localStorage` at a time. A simple approach: the first tab to set `chrome.storage.session.set({leader_tab_id: tabId})` becomes the leader. Other tabs observe changes via `chrome.storage.session.onChanged` and skip writes if they are not the leader. Leader is re-elected when the leader tab closes.
2. For the MVP (single-user, likely single AI Studio tab in practice), add a write debounce and check if another write to the same localStorage key occurred within the last 500ms. If so, skip the write and log a "multi-tab contention detected" warning.
3. Serialize content-script-to-service-worker communication: use `chrome.runtime.sendMessage` per tab, and have the service worker serialize merge decisions and reply with the canonical write payload, rather than having each tab independently decide what to write.

**Warning signs:**
- Instructions appear in inconsistent states when more than one AI Studio tab is open.
- Rapid successive sync events in logs correlated with multiple aistudio.google.com tabs being open.

**Phase to address:** Phase implementing content script ↔ service worker messaging protocol.

---

### AISTUDIO-4: Account Mismatch — Different Google Account in AI Studio vs. Chrome Profile

**What goes wrong:**
`chrome.storage.sync` is scoped to the Chrome profile's signed-in Google account. `localStorage` at `aistudio.google.com` stores instructions for whatever Google account the user is signed into AI Studio. These two accounts can differ: the user may be signed into Chrome with account A but use AI Studio with account B (signed in via the AI Studio UI, or via a different incognito session). The extension silently syncs account B's instructions into account A's sync storage, and vice versa.

**Why it happens:**
The extension has no way to detect which Google account is active in AI Studio at runtime without additional permissions (`identity` API, which requires justification for store submission). It assumes the accounts match.

**How to avoid:**
1. At minimum, detect the mismatch without solving it: use `chrome.identity.getProfileUserInfo()` (available without extra manifest permissions for extensions) to get the Chrome profile email. Compare it against any user identifier visible on the AI Studio page (e.g., the account avatar tooltip, which can be read from DOM). If they differ, surface a banner: "Warning: AI Studio is signed in as X, Chrome sync is signed in as Y. Sync is paused."
2. Do not attempt cross-account merge. Disable auto-sync when account mismatch is detected; require explicit user confirmation via the popup.
3. Namespace sync keys by a hash of the AI Studio account identifier if readable, so that multiple accounts' data does not collide in the same Chrome profile's sync storage.

**Warning signs:**
- User reports instructions appearing that they didn't create (they belong to a different account).
- Sync keys in `chrome.storage.sync` contain instructions that the user doesn't recognize.

**Phase to address:** Phase implementing the sync engine; account mismatch detection should be a pre-flight check before any sync cycle.

---

## Ops / UX Pitfalls

### OPS-1: Silent Failure — User Believes Sync Worked When It Didn't

**What goes wrong:**
A quota-exceeded error, network blip, or service worker termination causes a sync cycle to fail. The extension catches the error internally but does not update the popup UI or badge. The user believes their instructions are synced. They edit the same instruction on a second device. Data diverges without the user knowing. When sync eventually resumes, one version is silently discarded.

**Why it happens:**
Error handling is implemented as a `console.error` log and a silent `return`. The developer tested the happy path and the error path is invisible in production.

**How to avoid:**
1. Every sync attempt must conclude with exactly one of three visible states: success (green badge, "Last sync: X ago"), in-progress (amber badge, spinner), or failed (red badge, error message). There is no silent fourth state.
2. Wrap all `chrome.storage.sync` operations in a result type (`{ok: true, data} | {ok: false, error, retryAt}`). The service worker maintains a `syncStatus` object in `chrome.storage.local` that the popup reads on open.
3. Set a staleness threshold: if `last_sync_success_at` is more than 10 minutes ago and the extension is active, proactively set the badge to amber with "Sync delayed" — do not wait for the user to open the popup.

**Warning signs:**
- No badge updates despite sync activity in logs.
- Popup always shows the same "last sync" time.
- Users report data divergence that they couldn't have caused manually.

**Phase to address:** Phase implementing the popup UI and badge; must be designed alongside (not after) the sync engine.

---

### OPS-2: Extension Update Wipes or Mis-Migrates Stored State

**What goes wrong:**
A new version of the extension changes the schema of the sync metadata (e.g., renames a key, changes the chunk structure). The `onInstalled` handler runs with `reason === "update"` but does not migrate old data. Old chunk keys are orphaned. New code attempts to read a new schema and finds nothing — defaulting to "no data" — and proceeds to overwrite sync storage with a fresh empty state.

**Why it happens:**
Developers focus on the happy path of new installs. Upgrades are tested manually but the schema migration is forgotten, or is written as a one-time patch that doesn't handle all prior schema versions.

**How to avoid:**
1. Store a `schema_version` key in `chrome.storage.local`. On `onInstalled` with `reason === "update"`, read the version and run the appropriate migration sequence before any sync logic executes.
2. Write migrations as idempotent functions that can be re-run safely: `migrateV1toV2(storage)` reads old keys, writes new keys, removes old keys — all in one atomic `set()` + `remove()` pair.
3. Never remove old keys before new keys are confirmed written. Write new schema → verify read-back → remove old schema.
4. Add a `dry_run` mode for migrations in development: log what would change without writing.

**Warning signs:**
- After an extension update, `chrome.storage.sync.getBytesInUse()` drops to near-zero unexpectedly.
- The popup shows an empty instruction list immediately after update.
- Orphaned chunk keys appear in storage (keys matching the old naming pattern with no corresponding manifest entry).

**Phase to address:** Ongoing — every phase that changes the storage schema must include a migration. A schema versioning convention must be established in Phase 1.

---

### OPS-3: chrome.storage.sync Disabled by Policy or Sync Paused — Invisible Degraded Mode

**What goes wrong:**
Enterprise Chrome policies (`SyncDisabled`) or a paused sync state (expired session cookie, privacy extension cleared cookies) causes `chrome.storage.sync` to operate locally only — writes succeed but data never reaches other devices. The extension has no way to detect this from the API alone (writes don't fail, reads return local data). The user on their second machine never receives updates.

**Why it happens:**
`chrome.storage.sync` silently falls back to local behavior when sync is unavailable. There is no callback or event that notifies the extension that sync propagation has stopped.

**How to avoid:**
1. Use `chrome.storage.sync.getBytesInUse()` and compare against a known-good baseline at each sync cycle. While not definitive, a persistent zero across multiple cycles after a known write is a signal.
2. More reliably: write a "heartbeat" key with the current timestamp and device ID to sync. On a second machine, verify that the heartbeat from the primary machine has propagated within a reasonable window (e.g., 5 minutes). If not, surface "Sync may not be reaching your other devices — check Chrome sync status."
3. Surface a direct link to `chrome://settings/syncSetup` in the popup's error state: "Chrome Sync appears to be paused. Click here to check."

**Warning signs:**
- Sync appears to work (no errors) but the second device never receives updates.
- `chrome://sync-internals` shows the extension's data store as empty or stale.
- User has a privacy extension (e.g., Cookie AutoDelete) that clears session cookies on exit.

**Phase to address:** Phase implementing the popup UI and health monitoring.

---

### OPS-4: No Conflict Visibility — User Cannot Tell What "Won"

**What goes wrong:**
Device A edits instruction "Tax Assistant" to version 2. Device B, which was offline, also edits it to version 3 (different content). Sync merges on a LWW basis — device B wins because its `updated_at` is slightly higher. Device A's edit is silently discarded. The user on Device A never knows their edit was overwritten.

**Why it happens:**
LWW sync systems prioritize simplicity over observability. Conflict detection exists internally but is never surfaced to the user.

**How to avoid:**
1. In the popup's instruction list, mark items that were overwritten by a remote write in the last sync cycle with a visual indicator (e.g., "↓ Updated from another device: 2 minutes ago").
2. Persist the last N (e.g., 3) versions of each instruction's text in `chrome.storage.local` (not sync — local is not quota-sensitive in the same way). Allow the user to click "Undo last sync for this item" from the popup.
3. For the MVP, at minimum: log to `chrome.storage.local` any "remote won" conflict events with a timestamp, so the popup can show a "1 conflict resolved this session" badge count and link to a simple log view.

**Warning signs:**
- Users report edits "disappearing" without explanation.
- The popup shows "synced" but the instruction content has changed without user action.

**Phase to address:** Phase implementing conflict resolution and the popup list view.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `Date.now()` only for timestamps (no HLC) | Simpler code, no extra state | Clock skew silently discards valid edits | Never — implement HLC tie-breaking from day one |
| Issue one `chrome.storage.sync.set()` per item instead of batching | Simpler loop | Hits 120/min rate limit with >30 items; failures in burst scenarios | Never — batching is trivially easy and must be the default |
| Skip tombstone GC initially | Ship faster | Tombstone graveyard fills the 512-item quota; sync degrades silently over months | Acceptable for Phase 1 if GC is added in the immediately following phase |
| Store all metadata + data in the same sync key | Fewer keys, simpler schema | Single key rapidly hits 8KB limit; schema evolution requires coordinated rewrite | Never — separate metadata (tiny, version-stable) from content (large, mutable) from day one |
| Skip schema_version key | One less key to manage | Impossible to safely migrate storage layout in future updates | Never — costs 1 key, saves unbounded pain |
| Trust `localStorage` read returning `[]` as "user deleted everything" | Simpler push logic | One missed key read nukes all instructions on all synced devices | Never — distinguish "read failure / key missing" from "user emptied the list" explicitly |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `chrome.storage.sync` chunked writes | Multiple `set()` calls in a loop (each call = one rate-limit debit) | Single `set({key1: v1, key2: v2, ...})` call — all keys in one API operation |
| `window.localStorage` write → React re-render | Dispatching `new StorageEvent('storage')` on the writing window | Accept it won't re-render in the same window; use a custom event for own listeners; rely on badge/popup hint for cross-tab refresh prompt |
| `chrome.storage.onChanged` in content scripts | Assuming the event fires only for changes made by other contexts | Guard all onChanged handlers with a diff check (`newValue !== oldValue` and compare against last-known-good local cache) to prevent acting on own writes |
| `chrome.storage.sync` on enterprise Chrome | Assuming writes propagate to other devices | Implement heartbeat key propagation check; detect `SyncDisabled` policy via `chrome.storage.sync.get()` call succeeding locally but never propagating |
| AI Studio localStorage key | Hard-coding `aistudio_all_system_instructions` as permanent | Wrap in a key-discovery function; treat null reads as detection failures, not empty-list confirmations |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Polling `localStorage` every second from content script | High CPU on AI Studio tab; battery drain on laptops | Use `MutationObserver` on the specific element AI Studio renders instructions into, or observe `localStorage` via a proxied `setItem` override | Immediately noticeable; never acceptable |
| Reading all sync keys on every wake of service worker | Slow sync startup; unnecessary quota reads | Cache last-known-good state in `chrome.storage.local`; only full-read sync on explicit "Pull now" or first install | Noticeable with 50+ instructions and frequent wakes |
| Chunking at a fixed size without accounting for JSON serialization overhead | Chunks silently exceed `QUOTA_BYTES_PER_ITEM` (8192 bytes) after stringification adds escape characters | Measure chunk size with `new Blob([JSON.stringify(chunk)]).size` before storing; leave a 10% buffer (target max 7372 bytes per chunk) | Breaks with any instruction text containing double-quotes, backslashes, or non-ASCII characters that expand on serialization |
| Writing to `chrome.storage.sync` on every keystroke in AI Studio | Rate limit hit within 30 seconds of active editing | Debounce all push triggers to minimum 2–3 seconds after last detected change | Breaks immediately for any user who types fast |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Parsing `localStorage` value without validation | A malformed or maliciously injected localStorage value crashes the content script or corrupts sync storage | Always `JSON.parse()` in a try/catch; validate the parsed shape (must be array of `{title: string, text: string}`); reject and log malformed payloads without writing to sync |
| Storing raw instruction text in sync without size checks | A very long instruction text (> 8KB after serialization) causes a quota error and orphans the write | Pre-flight size check before any write; if an item exceeds the chunk budget, skip and surface a "Instruction too large to sync" warning in popup |
| Requesting `scripting` permission without justification | Chrome Web Store review rejection or user trust concerns | Evaluate whether content scripts declared in manifest (no `scripting` permission needed) suffice for all use cases before adding `scripting` |
| Logging instruction text to `console.log` in production | System instructions may be sensitive (proprietary prompts, business logic); logs are visible to any devtools user on the page | Strip all instruction content from production logs; log UUIDs and byte counts only |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No onboarding state for "first install on machine with existing AI Studio data" | User loses local instructions that were never synced | Detect existing localStorage data on first install; merge-first, never overwrite-first; show "X instructions found on this device, Y found in sync — merged" |
| Showing "Sync status: OK" when sync is paused | User assumes instructions are safe; edits on second device are lost | Status must reflect actual propagation (heartbeat check), not just last-write success |
| Manual "Push now" / "Pull now" with no confirmation for destructive pull | User clicks "Pull now" expecting to see the latest from another device; gets an older version that overwrites newer local work | Before a pull, compare remote vs. local; if remote is older than local for any item, warn "Remote has older data for X items — pull anyway?" |
| No count/diff summary after sync | User has no idea what changed | After each sync cycle, persist a brief diff summary (`chrome.storage.local`): "+2 instructions, 1 updated, 0 deleted" — show in popup until dismissed |

---

## "Looks Done But Isn't" Checklist

- [ ] **Chunked write**: Often missing atomic multi-key-set — verify all chunks for one item are passed in a single `chrome.storage.sync.set({})` call, not a loop of individual calls.
- [ ] **Error surfacing**: Often missing badge update on quota/rate-limit error — verify every `chrome.runtime.lastError` path updates `syncStatus` in `chrome.storage.local` and triggers a badge color change.
- [ ] **Initial install merge**: Often missing the "union not overwrite" logic — verify that on `onInstalled` with `reason === "install"`, both localStorage and sync are read and merged before any write occurs.
- [ ] **Tombstone win condition**: Often missing the `deleted_at > updated_at` guard — verify that a tombstone with a newer timestamp than the live item's `updated_at` wins unconditionally, regardless of which device holds which state.
- [ ] **StorageEvent same-window behavior**: Often assumed to work cross-tab by default — verify with a two-tab test that the synthetic event actually triggers AI Studio's listener (if any), and implement the popup hint as the reliable fallback.
- [ ] **Schema version key**: Often missing on first shipping — verify `chrome.storage.local` includes a `schema_version` key written on `onInstalled` with `reason === "install"`.
- [ ] **Null read guard**: Often missing the "key moved" detection — verify that `localStorage.getItem('aistudio_all_system_instructions') === null` does NOT trigger a push of an empty array to sync.
- [ ] **Service worker state persistence**: Often relies on global variables — verify that all sync state required across wake cycles is read from `chrome.storage.local` at the top of every event handler.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Partial chunk write corruption | MEDIUM | 1. Detect via chunk manifest integrity check on read. 2. Mark affected UUID as `sync_corrupted`. 3. Re-read from localStorage as source of truth. 4. Re-write complete chunk set. 5. Surface "X instructions repaired" in popup. |
| Rate limit exhaustion | LOW | 1. Stop all writes immediately. 2. Set badge to amber "⏳ Rate limited". 3. Queue pending writes. 4. Use `chrome.alarms` to retry after 60 seconds. 5. Drain queue with batched single-call writes. |
| Tombstone graveyard fills quota | MEDIUM | 1. Read all tombstones, sort by `deleted_at`. 2. Delete tombstones older than 90 days in a single `chrome.storage.sync.remove([...keys])` call. 3. Re-run sync cycle. 4. If still over quota, surface "Too many instructions to sync — consider exporting and pruning." |
| Extension update schema mismatch | HIGH | 1. Read `schema_version` from `chrome.storage.local`. 2. Run migration chain from detected version to current. 3. If migration fails, export current raw sync storage to a JSON download before any writes. 4. Notify user: "Extension updated — sync paused until migration completes." |
| User initiated "Pull now" overwrote newer local data | MEDIUM | 1. If previous-version cache exists in `chrome.storage.local`, offer "Undo last pull" in popup for 10 minutes. 2. If not, the JSON export feature is the recovery path — prompt user to check their most recent export file. |
| chrome.storage.sync disabled / sync paused | LOW | 1. Detect via heartbeat check. 2. Surface link to Chrome sync settings. 3. Fall back to local-only mode: all data remains in `chrome.storage.local`, sync resumes when Chrome sync is re-enabled. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| MV3-1: Service worker killed mid-write | Core sync engine phase | Simulate worker kill during chunked write; verify repair detects and heals the orphaned chunk |
| MV3-2: Write rate limit fan-out | Core sync engine phase | Bulk-import 50 items; verify single batched set() call, no rate limit errors |
| MV3-3: Global state lost on worker restart | Phase 1 (architecture) | Kill and restart worker; verify sync cycle resumes without duplicate pushes or missed merges |
| MV3-4: StorageEvent not fired in writing window | Pull-to-localStorage phase | Manually verify in a single AI Studio tab that the synthetic event does/doesn't trigger React re-render; implement badge fallback |
| SYNC-1: Infinite sync loop | Core sync engine phase | Inject a pull; verify push is not triggered; check write counters remain stable |
| SYNC-2: Tombstone graveyard | Delete/tombstone phase | Create and delete 100 items; verify GC runs and item count returns to expected baseline |
| SYNC-3: Clock skew | Metadata schema design (Phase 1) | Artificially skew system clock; verify earlier-physical-time edit does not win over later-causal-time edit |
| SYNC-4: Delete resurrection | Delete/tombstone phase | Simulate offline device B; delete on A; reconnect B; verify item stays deleted |
| SYNC-5: Initial pull overwrites local | Install/onboarding phase | Install on a machine with existing AI Studio data; verify count never decreases post-install |
| AISTUDIO-1: Unknown field stripping | Data model / localStorage adapter phase | Add a synthetic field to the localStorage array; verify it survives a sync round-trip |
| AISTUDIO-2: localStorage key rename | Data model / localStorage adapter phase | Rename the key manually; verify extension detects the absence gracefully without pushing empty array |
| AISTUDIO-3: Multi-tab interference | Content script messaging phase | Open two AI Studio tabs; edit in one; verify the other does not produce a conflicting write |
| AISTUDIO-4: Account mismatch | Pre-sync health check phase | Sign into AI Studio with a different account than Chrome profile; verify sync pauses with a warning |
| OPS-1: Silent failure | Popup + badge phase (alongside sync engine) | Force a quota-exceeded error; verify badge turns red and popup shows error message |
| OPS-2: Extension update schema wipe | Every schema-changing phase | Install old version, create data, install new version; verify all data survives |
| OPS-3: Sync disabled/paused | Popup health monitoring phase | Disable Chrome sync via flags; verify heartbeat detection and user-visible warning |
| OPS-4: No conflict visibility | Popup list view phase | Create a conflict; verify the winning item is marked with a "remote update" indicator |

---

## Sources

- [Chrome Extension Service Worker Lifecycle — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [chrome.storage API Reference — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.storage.sync quota best practices — Chromium Extensions Google Group](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/ACVyerzOjus)
- [Window: storage event — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
- [chrome-storage-largeSync — GitHub (dtuit)](https://github.com/dtuit/chrome-storage-largeSync)
- [SyncDisabled Enterprise Policy — Chrome Enterprise](https://chromeenterprise.google/intl/en_uk/policies/sync-disabled/)
- [The Clock Skew Conflict: When Time Lies in Distributed Systems](https://systemdr.substack.com/p/the-clock-skew-conflict-when-time)
- [Tombstone (data store) — Wikipedia](https://en.wikipedia.org/wiki/Tombstone_(data_store))
- [Preventing Data Resurrection with Repair Based Tombstone GC — ScyllaDB](https://www.scylladb.com/2022/06/30/preventing-data-resurrection-with-repair-based-tombstone-garbage-collection/)
- [Managing Concurrency in Chrome Extensions — Taboola Engineering](https://www.taboola.com/engineering/managing-concurrency-in-chrome-extensions/)
- [Data Synchronization in Chrome Extensions — Medium (Serhii Kokhan)](https://medium.com/@serhiikokhan/data-synchronization-in-chrome-extensions-f0b174d4414d)
- [MV3 Service Worker Keepalive — Medium (Dzianis Vashchuk)](https://medium.com/@dzianisv/vibe-engineering-mv3-service-worker-keepalive-how-chrome-keeps-killing-our-ai-agent-9fba3bebdc5b)

---
*Pitfalls research for: Chrome MV3 extension — aistudio.google.com localStorage ↔ chrome.storage.sync bidirectional sync*
*Researched: 2026-05-01*

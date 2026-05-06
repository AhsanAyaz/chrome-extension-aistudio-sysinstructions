# Phase 5: Popup, Badge, and Export/Import - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 delivers the user-visible surface over a proven sync engine. Scope: Svelte popup (status, instruction list, Push Now, Pull Now, Export, Import), badge healthy/error states, and JSON export/import through the push/pull merge path. No instruction editing, no body preview in list, no dedicated import page.

</domain>

<decisions>
## Implementation Decisions

### Popup Data Access
- **D-01:** Popup reads `chrome.storage.local` (syncStatus, pendingMerges) and `chrome.storage.sync` (registry) **directly** — no GET_STATUS message roundtrip to SW. CLAUDE.md's "never talk to chrome.storage.sync directly" applies to *writes* only; reads from the popup are fine for a thin view.
- **D-02:** Instruction list shows **registry-only** data: title + updatedAt per item. No body fetch for the list view. Bodies are only fetched at export time.
- **D-03:** Popup uses `chrome.storage.onChanged` for live updates — reacts to syncStatus and registry changes automatically without polling.

### Push Now / Pull Now UX
- **D-04:** Buttons send **fire-and-forget** messages to SW — `PUSH_NOW` and `PULL_NOW` message types. No sendResponse ack needed.
- **D-05:** Popup UI updates reactively via `chrome.storage.onChanged` on syncStatus. The SW sets state to 'syncing' then 'idle'/'error' as it works; popup renders each transition. No explicit ack protocol.

### Badge
- **D-06:** Healthy (idle, no errors) = **empty badge** — no text, no color. Badge signals problems only; the toolbar icon alone conveys presence when everything is fine. (Consistent with Phase 3's `setBadgeText({ text: '' })` on flush success.)
- **D-07:** **No syncing indicator** during active sync. Badge stays as-is during the 30s debounce window. Error badge appears only on failure. No transient amber '~' state.

### Import / Export
- **D-08:** Import uses a **hidden `<input type="file">` inside the popup**. No dedicated import page / WXT entrypoint needed. User clicks Import button → native file picker opens → Svelte popup reads the File, validates JSON, sends payload to SW.
- **D-09:** Import sends payload via a new **`IMPORT_ITEMS`** message to SW. SW routes every item through the standard merge path (same logic as handleRemoteChanged). Conflicts resolve via last-write-wins; tombstones respected.
- **D-10:** Export includes **live items only** (where `deletedAt === null`). No tombstones in the export file. Export schema per EXPORT-01: `{ title, text, uuid, updatedAt }` per item.

### WXT Config
- **D-11:** Phase 5 adds `@wxt-dev/module-svelte` to `wxt.config.ts`. The comment in Phase 1's wxt.config.ts explicitly deferred Svelte to Phase 5 — this is the planned addition.

### Claude's Discretion
- Popup Svelte component structure (single App.svelte vs sub-components) — organise as makes sense for readability.
- Error message copy for each ErrorState enum value — write human-readable strings for QUOTA_EXCEEDED, RATE_LIMITED, SCHEMA_AHEAD, SCHEMA_UNKNOWN, MALFORMED_REMOTE, ACCOUNT_MISMATCH, OVERSIZED_ITEM, STRICT_VALIDATION_FAIL, PENDING_MERGE_OVERFLOW.
- Exact timestamp display format for lastSyncAt and per-item updatedAt — use locale-relative (e.g. "2 min ago") or ISO string, whichever reads best in the popup width.
- Export filename convention — e.g. `aistudio-instructions-2026-05-06.json`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01..06, EXPORT-01, EXPORT-02 (the 8 Phase 5 requirements with full acceptance criteria)
- `CLAUDE.md` — Hard Rules (especially Rules 3, 6, 8, 9, 10), tech stack, architecture constraints, popup = dumb view

### Storage Shape
- `src/shared/types.ts` — SyncStatus, ErrorState, RegistryRecord, SyncRegistry, BodyPayload, RawInstruction type shapes
- `src/background/sync-state.ts` — SYNC_STATUS_KEY, readSyncStatus, writeSyncStatus, setErrorState — popup reads these keys directly

### Existing Badge / Flush Patterns
- `src/background/alarm-flush.ts` — badge update patterns (amber #F59E0B, red #EF4444), scheduleFlush, flushPendingWrite — PUSH_NOW bypasses debounce by calling flushPendingWrite directly or scheduling an immediate alarm
- `src/background/index.ts` — SW message dispatcher — Phase 5 adds PUSH_NOW, PULL_NOW, IMPORT_ITEMS handlers here

### Pull / Push Engine (for action handlers)
- `src/background/pull-engine.ts` — handleRemoteChanged — PULL_NOW path calls this
- `src/background/push-engine.ts` — diffAndAccumulate / drainPendingWrite — PUSH_NOW path

### WXT Config
- `wxt.config.ts` — needs `modules: ['@wxt-dev/module-svelte']` added; popup entrypoint lives at `src/popup/index.html` per WXT conventions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `readSyncStatus()` in `sync-state.ts` — popup can import this or read SYNC_STATUS_KEY directly from chrome.storage.local
- `SYNC_STATUS_KEY`, `REGISTRY_KEY`, `BODY_KEY_PREFIX` constants from `src/shared/constants.ts` — popup uses these as storage keys
- `flushPendingWrite()` from `alarm-flush.ts` — PUSH_NOW handler calls this directly (bypasses 30s alarm, immediate flush)
- `handleRemoteChanged()` from `pull-engine.ts` — PULL_NOW handler calls this (pass current sync registry as the "changed" payload)

### Established Patterns
- SW message dispatch: `chrome.runtime.onMessage.addListener` in `index.ts` — Phase 5 adds PUSH_NOW, PULL_NOW, IMPORT_ITEMS cases to the existing switch
- Badge writes: `chrome.action.setBadgeText` / `setBadgeBackgroundColor` — Phase 5 only adds the green/empty path on healthy state (Phase 3 already handles amber/red)
- Storage key discipline: all local keys use `${LOCAL_KEY_PREFIX}...` template literal (from `src/shared/constants.ts`)

### Integration Points
- `src/background/index.ts` onMessage listener — add PUSH_NOW, PULL_NOW, IMPORT_ITEMS cases
- `wxt.config.ts` — add Svelte module; popup entrypoint auto-discovered by WXT at `src/popup/`
- `src/shared/constants.ts` — may need BOOTSTRAP_NEEDED_KEY exposed if popup shows account-mismatch state

</code_context>

<specifics>
## Specific Ideas

- "Refresh AI Studio to see latest" hint (PULL-03) should be surfaced as a dismissable amber state in the popup — not just a badge. Text: "Pull applied — refresh AI Studio to see changes."
- Export should produce prettified JSON (2-space indent) for human readability.
- Import validation should reject files missing `title` or `text` fields per item and show an error in the popup (not silently drop items).

</specifics>

<deferred>
## Deferred Ideas

- Quota usage indicator (v2 requirement UI2-01: "23 KB of ~100 KB used") — deferred to v2.
- Conflict transparency (UI2-02) — deferred to v2.
- Tombstone GC (UI2-03) — deferred to v2.
- Body text preview in instruction list — decided against; registry-only for Phase 5.
- Dedicated import page (chrome-extension://.../import.html) — decided against; in-popup file input is sufficient for v1.

</deferred>

---

*Phase: 05-popup-badge-export-import*
*Context gathered: 2026-05-06*

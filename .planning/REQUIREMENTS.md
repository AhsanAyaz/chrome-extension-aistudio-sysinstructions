# Requirements: AI Studio Instructions Sync

**Defined:** 2026-05-01
**Core Value:** Open AI Studio on any signed-in Chrome and see the same up-to-date library of system instructions — automatically, with no clicks.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation (Storage Schema & Identity)

- [x] **FND-01
**: Extension assigns a stable UUID to each instruction on first sight; UUID becomes that instruction's permanent identity (renames do not break identity).
- [x] **FND-02
**: Each instruction has an `updated_at` timestamp recorded with every change so per-item conflicts can be resolved by last-write-wins.
- [x] **FND-03
**: Deleted instructions are recorded as soft-delete tombstones with a `deleted_at` timestamp so deletes propagate across devices without being resurrected by stale data on another device.
- [x] **FND-04
**: Storage uses a versioned schema (`schema_version` key) and namespaced keys (`sysins:*`) so future migrations are possible without ambiguity.
- [x] **FND-05
**: Storage layout separates a small registry (UUID → `{title, updated_at, deleted_at}`) from instruction body keys, so merge decisions can be made without fetching every body.
- [x] **FND-06
**: All sync state required to resume work (last-pushed snapshot, in-progress flag, pending-merge queue) is persisted in `chrome.storage.local`, never only in service-worker memory.

### Sync Engine — Push (localStorage → chrome.storage.sync)

- [ ] **PUSH-01**: When AI Studio writes to `localStorage["aistudio_all_system_instructions"]`, the extension detects the change without requiring a page reload.
- [ ] **PUSH-02**: The extension assigns UUIDs to any instructions that do not yet have one, computes a per-item diff against the last-pushed snapshot, and pushes only the changed items.
- [ ] **PUSH-03**: All chunks/keys for one push cycle are written via a single `chrome.storage.sync.set({...})` call — never per-item loops — so writes stay under the 120/min and 1800/hr rate limits.
- [ ] **PUSH-04**: Single instructions larger than the 8KB-per-item quota are transparently chunked across multiple `sysins:body:<uuid>:cN` keys; reassembly is deterministic and does not require user action.
- [ ] **PUSH-05**: A `null`, missing, or empty-array localStorage read is never auto-propagated as "user deleted everything" — empty results are treated as a detection failure unless the user explicitly clicks Push Now.
- [ ] **PUSH-06**: Unknown fields on instruction items (anything beyond `title` and `text`) are preserved end-to-end so future AI Studio schema additions are not silently dropped.
- [ ] **PUSH-07**: Pushes are debounced/throttled (target: 30-second alarm flush) so a flurry of edits in AI Studio coalesces into one batched write.

### Sync Engine — Pull (chrome.storage.sync → localStorage)

- [ ] **PULL-01**: When `chrome.storage.sync` reports a change from another device, the service worker wakes, computes the merged registry, and applies the result via the content script.
- [ ] **PULL-02**: Per-item conflicts are resolved by last-write-wins on `updated_at`; tombstones (`deleted_at > updated_at`) win unconditionally over live items so a delete on one device cannot be resurrected by an older live copy elsewhere.
- [ ] **PULL-03**: Pulls dispatched into an open AI Studio tab write `localStorage` and dispatch a synthetic `StorageEvent`; if AI Studio's React does not pick it up, the popup/badge surfaces a "Refresh AI Studio to see latest" hint instead of failing silently.
- [ ] **PULL-04**: Pull-initiated writes do not trigger another push (no infinite sync loop) — implemented via a write-suppression flag during apply, plus diff-against-last-pushed.
- [ ] **PULL-05**: When two AI Studio tabs are open, only one applies a remote update so concurrent writes do not race.

### Bootstrap & Account Safety

- [ ] **BOOT-01**: First-install on a device is a union merge between local AI Studio data and remote sync data, never a pull-overwrite — instructions present on either side survive.
- [ ] **BOOT-02**: Items found in `localStorage` without a UUID are matched to remote items by title at bootstrap only; once UUIDs are assigned, title-matching is never used again.
- [ ] **BOOT-03**: Before auto-sync runs, the extension performs an account-mismatch pre-flight check: if the Chrome profile's signed-in account differs from the AI Studio account on the page, auto-sync is paused and the popup surfaces a warning.

### Popup UI

- [ ] **UI-01**: The toolbar icon opens a popup that shows the last successful sync timestamp, current sync state (idle / syncing / error), and a count of synced instructions.
- [ ] **UI-02**: The popup lists every instruction with its title and per-item `updated_at` timestamp; the list reflects the merged state, not the raw localStorage view.
- [ ] **UI-03**: The popup exposes a "Push now" button that flushes pending writes immediately, bypassing the debounce.
- [ ] **UI-04**: The popup exposes a "Pull now" button that forces a fresh read from `chrome.storage.sync` and re-applies the merged result.
- [ ] **UI-05**: The popup shows an explicit error state (badge color + human-readable message) for: quota exceeded, sync unavailable, account mismatch, malformed remote payload — no error is silently swallowed.
- [ ] **UI-06**: The toolbar badge reflects sync health at a glance: green = healthy, amber = needs attention (e.g. refresh hint, pending writes), red = error.

### Export / Import

- [ ] **EXPORT-01**: The popup provides a "Export to JSON" action that produces a single human-readable JSON file containing every instruction (title, text, UUID, `updated_at`).
- [ ] **EXPORT-02**: The popup provides an "Import from JSON" action that ingests a previously exported file and routes every item through the standard merge path — imported items get UUIDs assigned, conflicts resolve via last-write-wins, tombstones are respected.

### Distribution & Hygiene

- [x] **DIST-01**: The extension is sideloadable as an unpacked build for personal use on the author's machines.
- [x] **DIST-02**: The manifest requests only the minimum permissions required: `storage`, host permission for `https://aistudio.google.com/*`, and (if needed) `scripting`. No `<all_urls>`, no broad host access, no `identity` permission unless strictly required.
- [x] **DIST-03**: The codebase, manifest, and build output are kept Chrome-Web-Store-clean (no debug-only flags, no test telemetry, no dev-only host permissions) so a future store submission requires no rework.
- [ ] **DIST-04**: No instruction data leaves the user's own Google Chrome sync — the extension makes zero third-party network calls.

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### UI Enhancements

- **UI2-01**: Popup shows quota usage (e.g. "23 KB of ~100 KB used") with proximity warning.
- **UI2-02**: Popup surfaces conflict transparency — when last-write-wins resolved a conflict, show which instruction was overwritten and from which device/time.
- **UI2-03**: Tombstone GC: stale tombstones older than a threshold are pruned automatically.

### Distribution

- **DIST2-01**: Public listing on the Chrome Web Store with privacy policy, screenshots, and store assets.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| In-extension instruction editor | Creates a second source of truth and a dual-edit conflict surface; AI Studio is the editor in v1 |
| Aggressive React fiber injection to force AI Studio re-render | Brittle — breaks every time AI Studio updates internals; we accept best-effort live update with reload fallback |
| Search / filter / tags / folders | Not needed for typical library sizes; adds UI scope without proportional value |
| Per-instruction version history / undo | Storage-heavy and out of scope for "sync" charter |
| Interactive conflict-merge UI (let user choose which version wins) | Overkill for a single-user tool; last-write-wins is correct for this threat model |
| Encryption at rest with user passphrase | `chrome.storage.sync` is already encrypted by Google; passphrase loss = permanent data loss; net negative trust |
| Telemetry, crash reporting, analytics | No third-party calls — privacy-first; debug via devtools |
| Sync history / audit log | Grows unbounded, rarely consulted; devtools is sufficient |
| Sharing / publishing instructions to other users | Single-user sync only; not a marketplace |
| Server-side backend (custom API, auth, hosting) | Chrome sync is the only backend; keeps trust model simple |
| Firefox / Safari / non-Chromium browser support | Different storage-sync APIs; out of scope for v1 |
| Edge / Brave own-sync-backend integration | We rely on Google's chrome.storage.sync; cross-browser sync is not promised |
| Multi-account orchestration within one Chrome profile | `chrome.storage.sync` is per-profile; we don't try to merge across profiles |
| Public Chrome Web Store launch in v1 | Sideload-first; store submission deliberately deferred until v1 sync model is proven |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Pending |
| FND-04 | Phase 1 | Pending |
| FND-05 | Phase 1 | Pending |
| FND-06 | Phase 1 | Pending |
| PUSH-01 | Phase 2 | Pending |
| PUSH-02 | Phase 3 | Pending |
| PUSH-03 | Phase 3 | Pending |
| PUSH-04 | Phase 3 | Pending |
| PUSH-05 | Phase 2 | Pending |
| PUSH-06 | Phase 2 | Pending |
| PUSH-07 | Phase 3 | Pending |
| PULL-01 | Phase 4 | Pending |
| PULL-02 | Phase 4 | Pending |
| PULL-03 | Phase 4 | Pending |
| PULL-04 | Phase 4 | Pending |
| PULL-05 | Phase 4 | Pending |
| BOOT-01 | Phase 4 | Pending |
| BOOT-02 | Phase 4 | Pending |
| BOOT-03 | Phase 4 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |
| UI-03 | Phase 5 | Pending |
| UI-04 | Phase 5 | Pending |
| UI-05 | Phase 5 | Pending |
| UI-06 | Phase 5 | Pending |
| EXPORT-01 | Phase 5 | Pending |
| EXPORT-02 | Phase 5 | Pending |
| DIST-01 | Phase 1 | Complete (01-01) |
| DIST-02 | Phase 1 | Complete (01-01) |
| DIST-03 | Phase 1 | Complete (01-01) |
| DIST-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0

---
*Requirements defined: 2026-05-01*
*Last updated: 2026-05-01 after roadmap creation*

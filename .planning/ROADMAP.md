# Roadmap: AI Studio Instructions Sync

## Overview

This extension is a sync bridge: it lifts AI Studio's per-device localStorage instruction library into `chrome.storage.sync` so the same set of system prompts is available on every signed-in Chrome. The build order is driven by irreversibility — the storage schema and identity model are frozen in Phase 1 because they cannot be migrated safely once real user data is in sync. Observation and push precede pull because push-only sync is testable in isolation. The popup is built last because it is a thin view over a proven sync engine, not a driver of it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Storage schema, identity model, project scaffold, and distribution hygiene — the irreversible decisions locked before any real user data is written
- [x] **Phase 2: Observation Pipeline** - MAIN-world injector + content script relay — proves AI Studio writes are detected before any sync logic exists
- [ ] **Phase 3: Push Engine** - Service worker push path (localStorage → chrome.storage.sync) with UUID assignment, merge diff, chunking, and debounced batched writes
- [ ] **Phase 4: Pull Engine + Bootstrap** - Bidirectional sync complete: pull path, infinite-loop guard, multi-tab coordination, account mismatch pre-flight, and first-install union merge
- [ ] **Phase 5: Popup, Badge, and Export/Import** - User-visible surface over a proven sync engine: status, instruction list, Push/Pull buttons, error states, JSON export/import

## Phase Details

### Phase 1: Foundation
**Goal**: The storage schema, identity model, and project scaffold are locked and fully unit-tested before any real user data is written to `chrome.storage.sync`
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, DIST-01, DIST-02, DIST-03, DIST-04
**Success Criteria** (what must be TRUE):
  1. Vitest unit tests covering `storage-layout.ts` pass: a full instruction set round-trips through chunking and reassembly (including items > 7 KB) without data loss or quota-key overflow
  2. Vitest unit tests covering `registry.ts` pass: UUID assignment, `updatedAt` tracking, and tombstone creation (`deletedAt`) are correct across all edit/delete/rename scenarios using `fakeBrowser`
  3. The extension loads as an unpacked build in Chrome with no manifest errors; only the minimum permissions (`storage`, `scripting`, host permission for `https://aistudio.google.com/*`) are declared
  4. `sysins:meta` (with `schemaVersion: 1`) is written to `chrome.storage.sync` on `onInstalled`; all keys use the `sysins:*` namespace; no data is written outside that namespace
  5. All sync state required to resume after a service worker kill (last-pushed snapshot, in-progress flag, pending-merge queue) is persisted in `chrome.storage.local` — verified by unit test that simulates worker restart
**Plans**: 6 plans
  - [x] 01-01-scaffold-PLAN.md — WXT scaffold, locked manifest (D-19), tsconfig/vitest/eslint configs, SW entrypoint stub, smoke build (Wave 0)
  - [x] 01-02-shared-primitives-PLAN.md — `shared/constants.ts` (D-24), `shared/types.ts` (registry/body/local/error shapes), `shared/meta-guard.ts` reader guard (Recipe 7) (Wave 1)
  - [x] 01-03-storage-layout-PLAN.md — `storage-layout.ts` UTF-8 codepoint-aware chunk/reassemble (Recipe 1, FND-05) (Wave 2)
  - [x] 01-04-registry-PLAN.md — `registry.ts` UUID identity, updatedAt tracking, tombstone semantics with resurrection rejection (FND-01..03, Recipe 9) (Wave 2)
  - [x] 01-05-sw-bootstrap-resume-PLAN.md — `meta-bootstrap.ts` D-10 write-if-absent + `sync-state.ts` local resume schema + SW `onInstalled` wiring + restart simulation tests (FND-04, FND-06) (Wave 3)
  - [x] 01-06-dist04-manifest-snapshot-PLAN.md — Vitest static-scan for forbidden network APIs (Recipe 8 layer 2) + manifest snapshot byte-exact assertion (DIST-04, DIST-02) (Wave 4)

### Phase 2: Observation Pipeline
**Goal**: AI Studio's localStorage writes are reliably detected and forwarded to the service worker before any sync logic is wired up
**Depends on**: Phase 1
**Requirements**: PUSH-01, PUSH-05, PUSH-06
**Success Criteria** (what must be TRUE):
  1. Opening aistudio.google.com and editing a system instruction causes a `LS_CHANGED` message to arrive at the service worker (verified via `console.log` or DevTools service worker inspector) within 1 second of the AI Studio save
  2. The 2-second polling fallback in the content script detects a write that was missed by the injector (simulated by disabling the MAIN-world patch) and fires `LS_CHANGED` within 3 seconds
  3. A `null` or empty-array read from `localStorage` (simulated by clearing the key in DevTools) does NOT trigger a `LS_CHANGED` message; the null-read guard absorbs it silently
  4. Unknown fields on instruction items (fields beyond `title` and `text`) are forwarded to the service worker verbatim — no field stripping occurs in the content script
**Plans**: 3 plans
  - [x] 02-01-PLAN.md — Shared primitives: `RawInstruction`/`LastObservedSnapshot` types, `LAST_OBSERVED_KEY`/`WATCHED_LS_KEY` constants, `isValidPayload` guard + 6 unit tests (Wave 1)
  - [x] 02-02-PLAN.md — SW message handler: `message-handler.ts` + `message-handler.test.ts` (3 fakeBrowser tests), `onMessage` listener wired in `index.ts` (Wave 2, parallel with 02-03)
  - [x] 02-03-PLAN.md — Observation pipeline files: `ls-observer.js` injector, `content/index.ts` relay, `wxt.config.ts` web_accessible_resources, DevTools checkpoint (Wave 2, parallel with 02-02)

### Phase 3: Push Engine
**Goal**: Edits made in AI Studio on one device land correctly in `chrome.storage.sync` with per-item UUIDs, timestamps, and quota-respecting batched writes
**Depends on**: Phase 2
**Requirements**: PUSH-02, PUSH-03, PUSH-04, PUSH-07
**Success Criteria** (what must be TRUE):
  1. After editing an instruction in AI Studio, the change appears in `chrome.storage.sync` (inspectable via `chrome.storage.sync.get(null)` in the service worker DevTools console) within 35 seconds (30-second debounce + propagation)
  2. Each instruction in `chrome.storage.sync` carries a stable UUID and an `updated_at` timestamp; editing a title does not change the instruction's UUID
  3. An instruction whose text exceeds 7 KB is transparently chunked across `sysins:body:<uuid>:c0`, `:c1`, etc.; reassembly in `storage-layout.ts` returns the original text byte-for-byte
  4. A flurry of 5 rapid AI Studio saves within 10 seconds results in exactly one batched `chrome.storage.sync.set()` call (verifiable via DevTools network/storage panel showing a single sync write round-trip)
  5. The badge is set to amber or red (never left empty) if any push write fails (quota exceeded, rate limit, connectivity) — the error state is observable in the toolbar icon within 5 seconds of the failure
**Plans**: TBD

### Phase 4: Pull Engine + Bootstrap
**Goal**: Full bidirectional sync works across two machines, first-install on a new device performs a union merge (not an overwrite), and auto-sync pauses when the Chrome profile account and AI Studio account do not match
**Depends on**: Phase 3
**Requirements**: PULL-01, PULL-02, PULL-03, PULL-04, PULL-05, BOOT-01, BOOT-02, BOOT-03
**Success Criteria** (what must be TRUE):
  1. An instruction created on Device A appears in AI Studio on Device B (when the tab is open) within 60 seconds of Device A's push completing — with no user action on Device B
  2. When Device A deletes an instruction and Device B has an older live copy of that same instruction, the tombstone from Device A wins and the instruction disappears from Device B's AI Studio after the next pull — it is not resurrected
  3. Installing the extension on a new machine that has both local AI Studio instructions and remote sync data results in a union merge: no instruction present on either side is lost
  4. Making a push-triggered `localStorage` write does not cause a second push cycle (no infinite sync loop) — verified by observing that only one `chrome.storage.sync.set()` fires per edit session via the service worker console
  5. When two AI Studio tabs are open simultaneously and a remote pull arrives, only one tab applies the update — the other tab receives no duplicate `APPLY_REMOTE` message
  6. (Research-gated) If the Chrome profile email differs from the AI Studio account shown on the page, auto-sync is paused and the popup surface shows a human-readable account-mismatch warning — auto-sync does not run silently across mismatched accounts
**Plans**: TBD
**Research note**: Criterion 6 (BOOT-03/AISTUDIO-4) requires a live-page spike to confirm `chrome.identity.getProfileUserInfo()` availability without the `identity` permission and to identify where the AI Studio page exposes the signed-in account identifier in the DOM. This spike must complete before Phase 4 plan is finalized.

### Phase 5: Popup, Badge, and Export/Import
**Goal**: The user has full visibility into sync state and manual escape hatches through a thin popup over the proven sync engine
**Depends on**: Phase 4
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, EXPORT-01, EXPORT-02
**Success Criteria** (what must be TRUE):
  1. Opening the toolbar popup shows the last successful sync timestamp, current sync state (idle / syncing / error), a count of synced instructions, and a per-instruction list with title and `updated_at` — all reflecting the merged state, not raw localStorage
  2. Clicking "Push now" in the popup bypasses the 30-second debounce and triggers an immediate sync; the sync state in the popup updates to reflect the result within 5 seconds
  3. Clicking "Pull now" fetches the latest `chrome.storage.sync` state and re-applies the merged result; if AI Studio's React does not respond to the synthetic `StorageEvent`, the popup and badge surface the "Refresh AI Studio to see latest" hint
  4. The toolbar badge is green when sync is healthy, amber when attention is needed (pending writes, refresh hint), and red when an error state exists (quota exceeded, sync unavailable, account mismatch, malformed payload) — no error is silently swallowed
  5. Clicking "Export to JSON" downloads a human-readable JSON file containing every instruction with title, text, UUID, and `updated_at`; clicking "Import from JSON" ingests a previously exported file, routes every item through the merge path, and the imported instructions appear in AI Studio within 35 seconds
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete | 2026-05-05 |
| 2. Observation Pipeline | 3/3 | Complete | 2026-05-06 |
| 3. Push Engine | 0/TBD | Not started | - |
| 4. Pull Engine + Bootstrap | 0/TBD | Not started | - |
| 5. Popup, Badge, and Export/Import | 0/TBD | Not started | - |

# Project Research Summary

**Project:** AI Studio Instructions Sync — Chrome MV3 Extension
**Domain:** Chrome extension, bidirectional localStorage/chrome.storage.sync bridge, CRDT-lite sync
**Researched:** 2026-05-01
**Confidence:** HIGH

---

## Executive Summary

This is a MV3 Chrome extension that acts as a sync bridge: it reads an undocumented localStorage key from a third-party React app (AI Studio), maps the data through an extension-owned identity and metadata model, and propagates changes bidirectionally across devices via `chrome.storage.sync`. The core technical challenge is not the sync logic itself — per-item LWW with tombstones is a well-understood pattern — but the hostile environment: an ephemeral service worker that can be killed mid-write, a third-party page whose internal schema is uncontrolled, a storage backend with hard per-item and total quotas, and a React app that does not respond predictably to external localStorage mutations.

The recommended approach is a strict layered architecture where all business logic (merge, UUID assignment, tombstones, chunking, rate limiting) lives exclusively in the service worker, and the content script is a dumb I/O relay with no decision-making. This is not just a preference — it is structurally required because merge logic in a content script fails silently whenever AI Studio is not open. The MAIN-world injector must be declared in the manifest with `run_at: document_start` (not injected dynamically) to intercept writes before they happen. The storage layout must separate the metadata registry from instruction bodies from the first commit, because retrofitting the schema after deployment is the single highest-cost failure mode.

The top risk is quiet data destruction: an empty localStorage read treated as "user deleted everything" can silently nuke the instruction library on all devices. A rate-limit fan-out can leave sync half-written. A service worker killed mid-chunked-write can corrupt a body. None of these fail loudly by default. Every sync operation must conclude in an explicit visible state — green, amber, or red — with no silent fourth path. Build the error-surfacing infrastructure alongside the sync engine, not after it.

---

## Key Findings

### Recommended Stack

WXT 0.20.25 (Vite-based, MV3-native, ships `fakeBrowser` for unit tests) is the clear build framework choice. Its file-based entrypoints auto-generate the manifest, its typed storage API wraps `chrome.storage.sync` correctly, and it has active maintenance. Svelte 5 is appropriate for the popup — compiled-away reactivity, ~2-3 KB runtime, and `$state` runes that map naturally to `storage.watch()` callbacks. Vanilla TypeScript is an equally valid popup choice if Svelte adds ceremony. Vitest with WXT's `WxtVitest()` plugin and `fakeBrowser` is mandatory for the chunking and merge logic — these modules are too quota-sensitive to rely on manual testing alone.

**Core technologies:**
- **WXT 0.20.25:** Extension framework — MV3 scaffolding, manifest generation, typed storage, `fakeBrowser` for unit tests
- **TypeScript 5.8:** Language — `@types/chrome` catches storage API misuse and quota constant errors at author time
- **Svelte 5.55.5:** Popup UI — compiled reactivity, minimal runtime, natural fit for `storage.watch()` callbacks
- **Vitest 4.1.5 + WxtVitest():** Testing — in-memory `browser.storage` with no manual Chrome API mocking
- **`crypto.randomUUID()`:** UUID generation — built into all MV3 contexts since Chrome 92; do not install the `uuid` package

Do not use: Plasmo (maintenance mode, 2x bundle size), React (45 KB runtime for a popup), `chrome-storage-largeSync` (dormant), or `webextension-polyfill` (replaced by WXT's `@wxt-dev/browser`).

### Expected Features

The v1 feature set is already well-defined in PROJECT.md and validated by the feature research. Every item is either table stakes (absence causes data loss or loss of trust) or a cheap differentiator.

**Must have — v1:**
- Auto bidirectional sync — the core value; manual sync defeats the purpose
- UUID + `updated_at` + tombstone metadata model — foundational; every other feature depends on this being correct
- Quota-respecting chunking (registry separate from bodies, 7KB chunk budget) — required by storage constraints
- Popup: last sync time, badge state (green/amber/red), instruction list with timestamps, Push/Pull buttons
- Error states surfaced visibly — quota exceeded, sync unavailable, malformed payload; never silently swallowed
- JSON export + import — cheap data escape hatch; import must go through the full merge path, not an overwrite
- Best-effort live update via synthetic `StorageEvent` + "Refresh AI Studio" popup hint

**Add after validation — v1.x:**
- Quota usage indicator in popup
- Conflict transparency (show which items were overwritten by a remote win)
- Tombstone TTL GC (acceptable to defer from v1 for typical library sizes < 50 items)

**Defer to v2+:**
- Instruction editing in popup (makes the extension a second editor — keep AI Studio as sole author)
- Search/filter (only needed at > 100 instructions)
- Chrome Web Store public distribution
- Encryption at rest (Google account encryption is sufficient for personal use)

**Anti-features to actively resist:** In-extension editor, interactive conflict merge UI, sync history/audit log, folder/tag organization, sharing/publishing. These are scope creep vectors dressed as features.

### Architecture Approach

Four components with a strict hierarchy. The service worker owns everything: merge, conflict resolution, UUID assignment, tombstones, chunking, rate limiting, all `chrome.storage.sync` I/O. The content script is a relay only: read/write localStorage, bridge the MAIN-world postMessage, dispatch the synthetic `StorageEvent`. The MAIN-world injector patches `Storage.prototype.setItem` at `document_start` and does nothing else. The popup is a dumb view that queries the service worker for status and dispatches action messages. No business logic crosses these boundaries.

**Major components:**
1. **MAIN-world injector** (`src/injected/ls-observer.js`) — patches `Storage.prototype.setItem` to detect AI Studio writes; posts to content script via `window.postMessage`; no chrome APIs, no state
2. **Content script** (`src/content/content.ts`) — relays changes to service worker; writes localStorage on pull; dispatches synthetic `StorageEvent`; 2-second polling fallback catches writes before injector is active
3. **Service worker** — `sync-engine.ts` (merge/LWW/tombstones), `storage-layout.ts` (chunking/reassembly), `registry.ts` (UUID/timestamps), `throttle.ts` (30s alarm-based flush), `bootstrap.ts` (first-install union merge)
4. **Popup** (`src/popup/`) — reads state via sendMessage; renders status + instruction list; triggers Push/Pull/Export/Import; never talks to `chrome.storage.sync` directly

**Storage layout (irreversible once deployed):**
- `sysins:meta` — schema version, last push/pull timestamps
- `sysins:registry` — all UUIDs with title, `updatedAt`, `deletedAt` (sharded if > 8KB)
- `sysins:body:<uuid>` — instruction text (chunked at 7KB if needed: `sysins:body:<uuid>:c0`, `:c1`, etc.)

**Identity (irreversible once deployed):** UUID assigned by the extension on first sight; title-based matching used only at bootstrap to unify pre-UUID local and remote items; once assigned, UUID is the stable identity forever.

### Critical Pitfalls

The full list has 16 named pitfalls across MV3 lifecycle, sync/merge, AI Studio integration, and ops. These six are the ones that cause silent, unrecoverable data loss if not addressed from Phase 1:

1. **Service worker killed mid-chunked-write (MV3-1)** — pass all chunks for one item in a single `chrome.storage.sync.set({k1:v1, k2:v2, ...})` call; write a `sync_pending` sentinel before multi-key writes and check it on every worker wake.

2. **Empty localStorage read treated as "user deleted everything" (AISTUDIO-2)** — `null`/`[]` from `localStorage.getItem` is a detection failure (key moved or unavailable), not a user-initiated mass delete. Require explicit Push Now to propagate a zero-item state. This is the highest-consequence single-line bug in the project.

3. **Service worker global state not persisted (MV3-3)** — all sync state (last-synced timestamps, in-progress flag, pending-merge queue) lives in `chrome.storage.local`, not globals. Read from `chrome.storage.local` at the top of every event handler. Must be correct from Phase 1.

4. **Infinite sync loop via pull→LS write→push→onChanged (SYNC-1)** — push path diffs incoming localStorage against last-pushed value cached in `chrome.storage.local`; skip push if diff is empty. Content script sets `window.__aistudio_sync_writing = true` during pull-initiated LS writes.

5. **Initial install overwrites richer local state (SYNC-5)** — on `onInstalled` with `reason === "install"`, union-merge localStorage and sync storage; never overwrite. Items with no UUID are treated as "just created" — highest merge priority.

6. **Forward-compat field stripping (AISTUDIO-1)** — use `const {title, text, ...rest} = item` and round-trip `rest` opaquely. A future AI Studio field addition must not be silently dropped on write-back.

---

## Implications for Roadmap

The architecture research provides an explicit build order that is technically motivated by component dependencies. Each phase proves a testable invariant before the next builds on it. The roadmap should follow this order.

### Phase 1: Foundation — Storage Layout + Service Worker State Model

**Rationale:** The storage schema (registry/body separation, chunking, key namespace, schema_version key) and the service worker state persistence model are both irreversible once any data lands in users' `chrome.storage.sync`. Get them wrong and migration is painful; there is no "just reset and resync" that doesn't risk data loss. This phase has no UI dependencies and is entirely testable in Vitest with `fakeBrowser`.

**Delivers:** `storage-layout.ts` (chunking/reassembly with Blob-based byte measurement), `registry.ts` (UUID assignment, `updatedAt`/`deletedAt`), `shared/types.ts` and `shared/constants.ts`, `schema_version` key written on install, `sync_pending` sentinel pattern. Full unit test coverage.

**Must address from day one:** MV3-3 (SW state persistence in `chrome.storage.local`), OPS-2 (schema versioning), key namespace design (`sysins:*`), 7KB-with-10%-buffer chunk sizing, single-`set()` write pattern.

**Research flag:** Standard patterns, well-documented. No additional research needed.

---

### Phase 2: Content Script + MAIN-World Injector

**Rationale:** The localStorage observation pipeline can be built and verified against the live AI Studio page before any sync logic exists. Logging to console is sufficient to prove it works. This phase is independent of the service worker merge logic.

**Delivers:** `ls-observer.js` (MAIN-world `Storage.prototype.setItem` patch declared in manifest at `document_start`), `content.ts` (postMessage bridge, 2-second polling fallback, localStorage read/write, `StorageEvent` dispatch), forward-compat spread-first pattern for unknown AI Studio fields, null-read guard.

**Must address:** AISTUDIO-1 (field stripping), AISTUDIO-2 (null read guard), MV3-4 (`StorageEvent` same-window limitation documented and popup hint pre-wired).

**Research flag:** Standard MV3 patterns. No additional research needed.

---

### Phase 3: Sync Engine — Push Path

**Rationale:** Push-only (localStorage → sync) is the simpler half of bidirectional sync. Proving it works in isolation — with correct UUID assignment, merge diffing, tombstone creation, rate-limit-safe batched writes, and 30-second alarm flush — before adding the pull path reduces the debugging surface significantly.

**Delivers:** `sync-engine.ts` (merge/LWW logic), `throttle.ts` (pendingWrite map + alarm-based flush), push flow end-to-end from `LS_CHANGED` to `chrome.storage.sync.set`. All writes batched in a single `set()` call. Rate-limit error handling with exponential backoff.

**Must address:** MV3-1 (atomic multi-key set), MV3-2 (batched writes, not per-item loops), SYNC-3 (clock skew — HLC or 60s skew window + content hash), SYNC-4 (delete resurrection — tombstone with `deletedAt > updatedAt` wins unconditionally).

**Research flag:** SYNC-3 (HLC implementation) may benefit from a quick research pass if unfamiliar. Otherwise standard distributed systems patterns.

---

### Phase 4: Sync Engine — Pull Path + Bootstrap

**Rationale:** The pull path completes bidirectional sync. Bootstrap (first-install union merge) is included here because it uses the same merge algorithm and must be proven before the extension can be used on a real machine with existing AI Studio data.

**Delivers:** `chrome.storage.onChanged` handler, pull-side merge (apply remote registry wins, reconstruct merged array), `tabs.sendMessage` to content script with `APPLY_REMOTE` payload, `bootstrap.ts` (four-scenario first-install logic: remote data × tab open), SYNC-1 infinite loop guard.

**Must address:** SYNC-1 (infinite sync loop), SYNC-5 (first-install union merge, not overwrite), AISTUDIO-3 (multi-tab leader election or write debounce), AISTUDIO-4 (account mismatch pre-flight check).

**Research flag:** AISTUDIO-4 — verify that `chrome.identity.getProfileUserInfo()` returns the Chrome profile email without the `identity` permission, and that the AI Studio page exposes the signed-in account identifier in DOM. Needs a live-page spike before Phase 4 design is finalized.

---

### Phase 5: Popup + Badge + Error Surfacing

**Rationale:** The popup is built last because all underlying service worker messages exist and are proven. A broken popup does not lose data; a broken sync engine or storage layout does. Building UI last means the popup is a thin view of already-working state, not a driver of sync behavior.

**Delivers:** Popup with sync status (last sync time, badge state), instruction list with per-item `updatedAt`, Push Now / Pull Now buttons, JSON export and import (import goes through full merge path — not an overwrite), visible error states for quota/sync-unavailable/malformed payload, "Refresh AI Studio" hint for live-update failures, sync diff summary persisted in `chrome.storage.local`.

**Must address:** OPS-1 (every sync ends in explicit green/amber/red badge — no silent state), OPS-3 (heartbeat propagation check, link to `chrome://settings/syncSetup`), OPS-4 (conflict visibility — mark items overwritten by remote win), SYNC-2 (tombstone GC designed here; implementation may defer to v1.x).

**Research flag:** Standard patterns. No additional research needed.

---

### Phase Ordering Rationale

- Storage layout and SW state model precede all sync logic because the schema is irreversible once deployed.
- Content script can overlap with Phase 1 in parallel but must complete before Phase 3.
- Push before pull reduces debugging surface — bidirectional sync bugs are harder to isolate.
- Popup last — it is a view of proven state.
- Error-surfacing infrastructure (badge states, `syncStatus` in `chrome.storage.local`) must be built alongside Phase 3/4, not after Phase 5, so sync engine failures are visible during development.

### Research Flags

Needs a targeted research spike during planning:
- **Phase 4 (AISTUDIO-4):** Live-page spike on `chrome.identity.getProfileUserInfo()` availability and AI Studio account identifier in DOM.
- **Phase 3 (SYNC-3, optional):** HLC implementation in TypeScript if the team is unfamiliar.

Standard patterns, skip research phase:
- **Phase 1:** Chrome storage API quotas and schema versioning are officially documented and stable.
- **Phase 2:** MAIN-world injection and postMessage bridge are standard MV3 patterns with official docs.
- **Phase 5:** Popup patterns and badge API are standard.

---

## What to Lock in the Roadmap

Ordered by consequence of getting wrong. These are the decisions and phase boundaries the roadmap must encode — not suggestions.

1. **Storage schema and key namespace are frozen in Phase 1.** `sysins:*` prefix, registry/body separation, chunk sizing at 7KB (Blob-measured), `schema_version` key, `sync_pending` sentinel — all must be correct before a single byte of real user data is written to `chrome.storage.sync`.

2. **UUID is the identity; title-matching is bootstrap-only.** Once deployed, the UUID assigned to an instruction is its permanent identity. The roadmap must not allow any phase to "simplify" by using title as a persistent key.

3. **All `chrome.storage.sync` writes are a single `set({...})` call per sync cycle.** Per-item `set()` loops are prohibited. This constraint must be enforced in code review from Phase 3 onward.

4. **`null`/`[]` localStorage read never auto-propagates as a delete.** The null-read guard is a Phase 2 deliverable and is a precondition for Phase 3 going live.

5. **First-install is a union merge, not a pull.** The bootstrap algorithm is a Phase 4 deliverable. The roadmap must not allow any earlier phase to write a "simple" install path that overwrites localStorage.

6. **Merge logic lives only in the service worker.** No business logic in the content script. This boundary must be explicit in the architecture docs and enforced in code review from Phase 2 onward.

7. **Error surfacing is built alongside the sync engine (Phase 3/4), not after the popup (Phase 5).** The `syncStatus` object in `chrome.storage.local` and badge update paths are Phase 3 deliverables.

8. **Phase 4 cannot ship without the AISTUDIO-4 account-mismatch pre-flight check.** Auto-sync must not run if the Chrome profile account and the AI Studio account differ.

9. **Tombstone GC must be designed in Phase 4 (delete/tombstone phase), even if implementation defers to v1.x.** The schema for tombstone records must support GC from day one — retrofitting GC into a non-GC-aware schema requires a migration.

10. **Popup is built last (Phase 5).** No earlier phase should drive design decisions based on popup requirements. The popup is a consumer of the sync engine, not a co-designer of it.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Official docs and WXT comparison page; all package versions verified at research date |
| Features | HIGH (table stakes) / MEDIUM (sizing) | Table stakes validated against Chrome extension UX patterns; personal-tool sizing is reasoned inference, not user testing |
| Architecture | HIGH | Chrome extension APIs are stable and well-documented; all behavioral claims verified against official sources |
| Pitfalls | HIGH (MV3/storage API) / MEDIUM (AI Studio internals) | AI Studio localStorage key and React behavior are uncontrolled third-party details |

**Overall confidence:** HIGH for technical implementation; MEDIUM for AI Studio integration durability.

### Gaps to Address

- **AI Studio schema durability:** The extension depends on `aistudio_all_system_instructions` being a JSON array of `{title, text, ...}`. The key-discovery heuristic and field-spread pattern are mitigations, not solutions. Monitor for AI Studio updates.
- **Account mismatch detection (AISTUDIO-4):** Needs a live-page spike before Phase 4 design is finalized to confirm `chrome.identity.getProfileUserInfo()` and DOM account identifier availability.
- **AI Studio `storage` event listener:** Whether AI Studio's React app responds to the synthetic `StorageEvent` is unknown without inspecting the live app. The popup hint fallback is already designed; this is a "nice to have" confirmation.
- **Clock skew severity in practice (SYNC-3):** For a single user on personal machines with NTP, severe skew is unlikely. HLC is the correct design; a 60-second skew window + content hash may be a pragmatic substitute. Decide at Phase 3.

---

## Sources

### Primary (HIGH confidence)
- Chrome for Developers — extension messaging, storage API reference, service worker lifecycle, scripting API world parameter
- MDN Web Docs — Window: storage event (same-window behavior), Crypto.randomUUID browser availability
- WXT official documentation (wxt.dev) — framework comparison, storage API, testing setup, v0.20 breaking changes
- Chromium Extensions Google Group — chrome.storage.sync quota best practices
- npm package pages — WXT 0.20.25, @wxt-dev/module-svelte 2.0.5, Svelte 5.55.5, Vitest 4.1.5 (version currency verified at research date)
- Context7 `/wxt-dev/wxt` — WXT storage API, fakeBrowser, entrypoint definitions

### Secondary (MEDIUM confidence)
- Sentry Engineering: Preact or Svelte — bundle size comparison
- redreamality.com: 2025 State of Browser Extension Frameworks — Plasmo maintenance mode (corroborated by WXT comparison page)
- Medium (Serhii Kokhan): Data Synchronization in Chrome Extensions
- Medium (Dzianis Vashchuk): MV3 Service Worker keepalive patterns
- ScyllaDB: Tombstone GC patterns (Cassandra gc_grace_seconds analogy)
- systemdr.substack.com: Clock skew in distributed systems

### Tertiary (LOW confidence)
- EverSync Chrome Web Store reviews — competitive feature gap analysis; anecdotal
- TabMark blog: Bookmark Sync Across Devices — category survey; single source

---

*Research completed: 2026-05-01*
*Ready for roadmap: yes*

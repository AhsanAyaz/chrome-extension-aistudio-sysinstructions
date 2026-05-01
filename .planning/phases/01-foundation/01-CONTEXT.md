# Phase 1: Foundation - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Lock the storage schema, identity model, project scaffold, and distribution hygiene. After Phase 1 ships, real user data starts hitting `chrome.storage.sync` — every decision in this CONTEXT.md is irreversible without a schema migration. Phase 1 delivers fully unit-tested `storage-layout.ts`, `registry.ts`, the `sysins:meta` initializer, the `chrome.storage.local` resume schema, the WXT scaffold, and a manifest with the minimum permission set.

Out of phase: any localStorage observation (Phase 2), any push/pull merge logic (Phases 3–4), bootstrap union merge (Phase 4), popup UI (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Storage Layout (chrome.storage.sync, `sysins:*` namespace)

- **D-01 (Body shape):** Each body is `JSON.stringify({text, ...rest})` per UUID. Unknown AI Studio fields beyond `title` and `text` round-trip via the `...rest` spread. Body is the canonical payload; registry is the canonical metadata.
- **D-02 (Title placement):** Title lives in the registry record only — never duplicated in the body. Cleanest registry/body separation; popup list rendering reads only the registry.
- **D-03 (Registry record):** Each registry entry is `{title: string, updatedAt: number, deletedAt: number | null, chunks: number}` keyed by UUID. The `chunks` field is the body chunk count — read alongside title/timestamps so reassembly knows how many keys to fetch without an extra round-trip.
- **D-04 (Always-chunked body layout):** Body is always written as `sysins:body:<uuid>:c0`, `…:c1`, … `:cN-1` — even when `N=1`. No special "small body" code path. One read/write algorithm, fewer bugs.
- **D-05 (Chunk byte budget):** Chunks are split by UTF-8 byte length measured via `new Blob([s]).size`, with a 7000-byte budget per chunk. Leaves ~1192 bytes headroom under the 8192 per-item quota for the key name and JSON-string overhead. Handles non-ASCII (emoji, accented characters) correctly.
- **D-06 (Reconstruct ordering):** When the SW reconstructs the merged instruction array to write back to localStorage, items are sorted by `updatedAt` descending. Stable across devices given the same registry. Tombstoned items (`deletedAt` ≥ `updatedAt`) are excluded from the reconstructed array.

### Validation & Error Boundary

- **D-07 (Strict ingest validation):** On the `LS_CHANGED` boundary in the SW, items missing `title` or `text` are rejected. The rejection is logged to `chrome.storage.local` under `sysins:local:syncStatus.errorState` for the popup (Phase 5) to surface. The non-rejected items in the batch still proceed.
- **D-08 (Per-item oversized rejection):** If a single instruction's body would exceed the per-item or total chunked-key budget (e.g. a >100KB instruction blowing the ~100KB total quota), that item is rejected individually with a structured error written to `chrome.storage.local`. The other items in the same batch still push. No silent truncation.

### Schema Versioning (FND-04)

- **D-09 (Phase 1 versioning depth):** Ship the version stamp + reader guard pattern only — no upgrader framework. Every read of `sysins:meta` asserts `schemaVersion === 1`. Mismatch → refuse all I/O, set `errorState: 'SCHEMA_AHEAD'` (or `'SCHEMA_UNKNOWN'`), red badge in Phase 5. YAGNI-correct: no v2 exists yet, so no upgrader pairs to register.
- **D-10 (sysins:meta bootstrap contract):** On `chrome.runtime.onInstalled`, write `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}` to `sysins:meta` **only if the key is absent**. If another device already populated `sysins:meta`, do NOT overwrite — read it, validate version, proceed. Aligns with FND-04 and the SUMMARY.md item 5 "first-install is a union merge, never a pull-overwrite" charter (the schema-meta version of the same principle).
- **D-11 (v1 schema lock):** `schemaVersion: 1` is locked for the entire v1 release line. Any v1.x release that needs a schema change either (a) avoids the bump because the change is purely additive and old readers tolerate the missing field, or (b) is held back to v2. No schema-version drift within v1.

### chrome.storage.local Resume Schema (FND-06)

All sync state required to resume after a service worker kill is persisted in `chrome.storage.local`, never only in service-worker memory. Keys live under the **`sysins:local:*`** prefix — distinct from sync's `sysins:*` so DevTools inspection is unambiguous.

- **D-12 (Last-pushed snapshot):** `sysins:local:lastPushed` is a hash map: `{[uuid]: {titleHash, bodyHash, updatedAt}}`. `titleHash` and `bodyHash` are short content hashes (SHA-256 truncated, or similar). Rationale: detecting changes against incoming localStorage doesn't need full bodies — hashes suffice and keep local storage roughly an order of magnitude smaller than mirroring the full payload.
- **D-13 (Sync-pending sentinel):** `sysins:local:syncPending` is `{batchId: string, keys: string[], startedAt: number}` written immediately before any multi-key `chrome.storage.sync.set()`. On SW wake, the recovery handler reads this; if `startedAt > 60_000ms ago`, treat as orphaned and re-derive sync state via a fresh registry read. If `startedAt` is recent and `batchId` is unfamiliar, it means another tab/SW instance is actively writing — back off.
- **D-14 (Pending-merge queue):** `sysins:local:pendingMerges` is an array `[{changes, receivedAt}, ...]` of `chrome.storage.onChanged` events that arrived while a merge was already in flight. FIFO drain when the current merge completes. **Capped at N=10** — additional events trigger a "drop oldest" log + flag in `syncStatus.errorState` so flapping syncs are visible.
- **D-15 (Sync status record):** `sysins:local:syncStatus` is `{state: 'idle' | 'syncing' | 'error', lastSyncAt: number, errorState?: 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' | 'ACCOUNT_MISMATCH' | 'OVERSIZED_ITEM' | 'STRICT_VALIDATION_FAIL', errorDetail?: string}`. Phase 1 defines the shape and the error enum; Phase 5 popup consumes it.

### Identity (carries to all later phases)

- **D-16 (UUID is permanent identity):** `crypto.randomUUID()` assigned on first sight of a `{title, text}` pair. Once assigned, the UUID is the instruction's identity forever. Renames bump `updatedAt` but never change the UUID. Title-matching is **bootstrap-only** (Phase 4) — once a UUID exists for an item, title-matching is never used again to resolve identity.
- **D-17 (UUID source):** `crypto.randomUUID()` from the global `Crypto` interface — available in MV3 service workers since Chrome 92. Do NOT install the `uuid` npm package (research/STACK.md).

### Tombstones (FND-03)

- **D-18 (Tombstone semantics):** A delete sets `deletedAt = Date.now()` on the registry record while leaving the registry entry in place. Reconstruction excludes any record where `deletedAt >= updatedAt`. Phase 1 writes the schema and respects the field; tombstone GC (TTL purge) is designed in Phase 4 and may defer implementation to v1.x — the schema must support it from day one (the `deletedAt` field is sufficient; no separate `tombstoneTtlAt` is needed since GC reads `Date.now() - deletedAt`).

### Distribution Hygiene (DIST-01–04)

- **D-19 (Permissions):** Manifest declares exactly `storage`, `scripting`, and host permission `https://aistudio.google.com/*`. No `<all_urls>`, no `identity`, no `tabs`, no `notifications`. The popup uses `chrome.action`, which does not require an extra permission.
- **D-20 (Sideloadable build):** WXT's default unpacked dev build is the v1 distribution channel. The build output is structurally Chrome-Web-Store-clean — no debug-only host permissions, no telemetry, no third-party hosts in CSP, no `<all_urls>` shortcuts. A future store submission requires no rework.
- **D-21 (No third-party network):** Phase 1 verifies in code review that nothing in the build imports a network call (no `fetch`, no `XMLHttpRequest`, no SDKs that phone home). DIST-04 is a structural property of the codebase, not a runtime check.

### Project Scaffold

- **D-22 (Stack lock):** WXT 0.20.25, TypeScript 5.8 (strict mode), Vitest 4.1.5 with `WxtVitest()` plugin and `fakeBrowser`. `crypto.randomUUID()` for IDs (no `uuid` package). Svelte 5.55.5 reserved for Phase 5 popup — Phase 1 does not write any popup code. (See research/STACK.md for the full rejected-alternatives list.)
- **D-23 (Module layout):** Mirror research/ARCHITECTURE.md §"Project Structure":
  ```
  src/
    background/  service-worker.ts, sync-engine.ts, storage-layout.ts, registry.ts, throttle.ts, bootstrap.ts
    content/     content.ts
    injected/    ls-observer.js
    popup/       popup.html, popup.ts, popup.css     ← Phase 5
    shared/      types.ts, constants.ts
  ```
  Phase 1 implements `storage-layout.ts`, `registry.ts`, `shared/types.ts`, `shared/constants.ts`, and the `service-worker.ts` `onInstalled` handler. Other files are stubs or absent until their phase.
- **D-24 (Constants in shared/constants.ts):** Define and export from a single source: `KEY_PREFIX = 'sysins:'`, `LOCAL_KEY_PREFIX = 'sysins:local:'`, `META_KEY = 'sysins:meta'`, `REGISTRY_KEY = 'sysins:registry'`, `BODY_KEY_PREFIX = 'sysins:body:'`, `CHUNK_BUDGET_BYTES = 7000`, `SCHEMA_VERSION = 1`, `PENDING_BATCH_TTL_MS = 60_000`, `PENDING_MERGE_QUEUE_CAP = 10`, `TOMBSTONE_GC_TTL_MS = 30 * 24 * 60 * 60 * 1000`. Magic numbers are forbidden inline.
- **D-25 (Test coverage scope):** Phase 1 unit tests run against `fakeBrowser`. Coverage required: chunking + reassembly round-trip including bodies > 7KB and edge cases (empty body string, body exactly at 7000 bytes, body with multi-byte UTF-8, oversized rejection); registry CRUD including UUID assignment, `updatedAt` on rename, tombstone creation, tombstone resurrection rejection (older `updatedAt` does not revive a newer `deletedAt`); schema-version mismatch refusal; SW restart simulation that verifies `sysins:local:syncPending` recovery is correct.

### Claude's Discretion

- File-level naming inside `background/` and `shared/` (concrete export names, function signatures, internal helpers).
- Specific hashing algorithm for `titleHash` / `bodyHash` (SHA-256 truncated, FNV-1a, or a Crypto SubtleDigest call) — pick at planning time based on synchronicity needs and bundle impact.
- Exact Vitest test-file layout (`*.test.ts` colocated vs. `tests/` directory).
- ESLint / Prettier / TypeScript strict-mode flag set within reason — Phase 1 picks reasonable defaults; the user has not signaled a preference.
- Whether `bootstrap.ts` is written as an empty stub in Phase 1 or only created in Phase 4 (planner decides — both are fine).

### Folded Todos

(None — `gsd-sdk query todo.match-phase 1` returned 0 matches.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Charter & Requirements
- `.planning/PROJECT.md` — vision, core value, out-of-scope list, key decisions table
- `.planning/REQUIREMENTS.md` — FND-01–06 and DIST-01–04 are this phase's scope; full traceability table at the bottom
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — goal, success criteria, and the irreversible-decisions framing
- `CLAUDE.md` — 10 hard rules (storage namespace, UUID identity, batched single-`set()`, null-read guard, union-merge bootstrap, SW-only merge, error-surfacing-with-engine, best-effort live update, local-state persistence, tombstone precedence)

### Research (locked decisions)
- `.planning/research/STACK.md` — WXT/TypeScript/Vitest/Svelte versions and rejected alternatives
- `.planning/research/ARCHITECTURE.md` — component boundaries, message topology, storage layout, MAIN-world injector pattern, project structure
- `.planning/research/PITFALLS.md` — 16 named pitfalls; MV3-1, MV3-3, AISTUDIO-1, AISTUDIO-2 are all addressed in this phase
- `.planning/research/SUMMARY.md` §"What to Lock in the Roadmap" — the 10 lock-in items, items 1–6 are Phase 1's responsibility
- `.planning/research/FEATURES.md` — table-stakes vs differentiators vs anti-features (informs scope checks)

### External (read-only references)
- Chrome Extensions docs — `chrome.storage` API quotas (8192 bytes/item, 102400 bytes total, 512 items, 120 writes/min, 1800/hr) — https://developer.chrome.com/docs/extensions/reference/api/storage
- Chrome Extensions docs — Service Worker lifecycle (the reason FND-06 exists) — https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- WXT docs — `fakeBrowser` testing utilities — https://wxt.dev/guide/testing.html
- MDN — `Crypto.randomUUID()` browser availability (Chrome 92+) — https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

(None — this is a greenfield Phase 1. The project root currently contains only the `.planning/` directory and `CLAUDE.md`. Every file in `src/` is created by Phase 1.)

### Established Patterns

(No existing source code patterns to honor. The patterns ARE established by Phase 1; later phases consume them.)

### Integration Points

- Phase 1 produces the storage primitives that Phase 2 (content script) calls into via the SW message bus only — content script never touches `chrome.storage.sync` directly (research/ARCHITECTURE.md §"Component Responsibilities").
- Phase 1's `chrome.storage.local` schema (`sysins:local:syncStatus.errorState`) is the wire that Phase 3+ sync-engine error states flow through, and Phase 5 popup reads to render the badge color and human-readable message.
- Phase 1's `sysins:meta.schemaVersion` is the gate that every later-phase read passes through — a Phase 4 bootstrap that encounters a mismatched version refuses to run.

</code_context>

<specifics>
## Specific Ideas

- The user picked the "Recommended" option in every Phase 1 question, signaling alignment with the research-backed defaults — research outputs should continue to be treated as load-bearing for downstream phases unless explicitly contradicted.
- The user explicitly chose to NEVER bump `schemaVersion` during v1 (D-11). This is a hard contract: any v1.x feature work that would require a schema bump must instead be deferred to v2 or redesigned to be additive-only.
- The user explicitly chose strict ingest validation (D-07) over forward-compat-leaning leniency. This means downstream Phase 2 and Phase 3 work should treat malformed AI Studio writes as bugs to surface, not as inputs to absorb.

</specifics>

<deferred>
## Deferred Ideas

(None raised during discussion — all four areas stayed within Phase 1 scope. The discussion revisited several items already covered by other phases per ROADMAP.md traceability:)

- Tombstone GC implementation → already designed-in-Phase-4, may defer execution to v1.x (per SUMMARY.md item 9).
- Account mismatch pre-flight (BOOT-03) → already scoped to Phase 4 with a research spike (per ROADMAP.md Phase 4 Research note).
- Quota usage indicator in popup → already in v2 backlog (UI2-01 in REQUIREMENTS.md).

### Reviewed Todos (not folded)

(None — todo registry was empty for Phase 1.)

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-05-01*

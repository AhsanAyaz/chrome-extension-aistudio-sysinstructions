# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 01-foundation
**Areas discussed:** Extra-fields placement, Chunking algorithm, chrome.storage.local schema, Schema migration depth

---

## Extra-fields placement

### Q1: Where do unknown AI Studio fields (anything beyond title/text) live in storage.sync?

| Option | Description | Selected |
|--------|-------------|----------|
| Inside body JSON (Recommended) | Body chunks store `JSON.stringify({text, ...rest})` per UUID. Single body key per item. Forward-compat is automatic via JSON round-trip. Body is the canonical payload; registry stays lightweight. | ✓ |
| Separate `sysins:extras:<uuid>` key | Body chunks stay as raw text only; extras stored in a separate key, only created when extras exist. Three storage primitives per item instead of two. | |
| Inside the registry | Flatten extras into the registry record per UUID. Bloats registry, makes it shard sooner, defeats the registry/body separation principle. | |

**User's choice:** Inside body JSON
**Notes:** Aligns with research/PITFALLS.md AISTUDIO-1 "forward-compat field stripping" mitigation. JSON round-trip is the simplest mechanism that preserves any future AI Studio fields without code changes.

### Q2: Where does the instruction title live?

| Option | Description | Selected |
|--------|-------------|----------|
| Registry only (Recommended) | Registry owns `{title, updatedAt, deletedAt}`; body owns `{text, ...rest}`. Cleanest separation. Registry alone is enough to render the popup list. | ✓ |
| Registry AND body | Body also stores title (~50 bytes/item). Self-heals if registry corrupts; small storage cost. | |

**User's choice:** Registry only
**Notes:** Cleaner separation — registry as canonical metadata, body as canonical payload, no overlap.

### Q3: What does the SW reject on the incoming `LS_CHANGED` boundary?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict (Recommended) | Reject items missing `title` or `text`; log structured error to `chrome.storage.local`. Catches AI Studio schema regressions early. | ✓ |
| Lenient | Only reject obviously malformed payloads (non-array, non-object items, null). Keep partials. More forgiving of AI Studio future changes. | |
| Pass-through | Store whatever AI Studio writes; never reject. Maximum forward-compat but masks bugs. | |

**User's choice:** Strict
**Notes:** Charter alignment — "no error is silently swallowed" (PROJECT.md, REQUIREMENTS.md UI-05).

### Q4: When the SW reconstructs the merged array to write back to localStorage, what order do items get?

| Option | Description | Selected |
|--------|-------------|----------|
| Sort by `updatedAt` desc (Recommended) | Recently-edited items first. Matches research/ARCHITECTURE.md §Pull Flow. Stable: any device produces the same order from the same registry. | ✓ |
| Preserve incoming order | Round-trip whatever order AI Studio's array had. Per-device order may diverge — a pull from another device may reorder items. | |
| Sort alphabetically by title | Stable ordering, but unrelated to recency. Renames cause reorders. | |

**User's choice:** Sort by `updatedAt` desc
**Notes:** Stable, deterministic, matches research recommendation.

---

## Chunking algorithm

### Q1: How is the 7KB chunk budget measured when splitting a body?

| Option | Description | Selected |
|--------|-------------|----------|
| Blob byte length, 7000 bytes (Recommended) | `new Blob([s]).size` for UTF-8 byte length. 7000-byte budget leaves ~1192 bytes headroom under 8192 per-item quota for JSON-string overhead and key name. Handles emoji/non-ASCII correctly. | ✓ |
| String char count × 3 | Worst-case 3 bytes/char, 2333 chars/chunk. Conservative but wastes ~50% of capacity on ASCII-heavy bodies. | |
| `TextEncoder.encode(s).length` | Same accuracy as Blob, slightly more code. Fine technically; Blob is shorter and well-supported in service workers. | |

**User's choice:** Blob byte length, 7000 bytes
**Notes:** Precise byte measurement matters because chrome.storage.sync's QUOTA_BYTES_PER_ITEM is byte-counted, not char-counted.

### Q2: How does reassembly know how many chunks to fetch?

| Option | Description | Selected |
|--------|-------------|----------|
| Store on registry record (Recommended) | Registry record gains a `chunks: N` field per UUID. One fewer storage key per item; chunk count is read with the registry which is already loaded for merge decisions. | ✓ |
| Separate `sysins:body:<uuid>:chunks` key | Per research/ARCHITECTURE.md §"Chunking per body". Extra storage key per item (counts toward 512-item ceiling). Decouples body metadata from registry. | |
| Encoded into chunk-0 prefix | First chunk starts with header like `[N]` then content. Saves a key but couples reassembly to chunk-0 being readable; awkward. | |

**User's choice:** Store on registry record
**Notes:** Saves one item-quota slot per instruction, keeps reassembly metadata adjacent to merge metadata.

### Q3: When the body fits under the 7KB budget, does it still get the chunked layout?

| Option | Description | Selected |
|--------|-------------|----------|
| Always chunked, even if N=1 (Recommended) | Always write `sysins:body:<uuid>:c0`, `chunks=1` in registry. Single code path. Costs one extra key vs option B but keeps layout uniform. | ✓ |
| Single key when small, chunked when large | Body ≤ budget → `sysins:body:<uuid>` (no `:cN` suffix); else chunked. Saves keys for small items but creates two read/write paths. | |

**User's choice:** Always chunked, even if N=1
**Notes:** Single code path eliminates a class of edge-case bugs.

### Q4: What happens if a single instruction's body would require more chunks than the per-instruction budget allows?

| Option | Description | Selected |
|--------|-------------|----------|
| Reject + surface error (Recommended) | Push fails for that item; registry tombstone NOT created; error state surfaces via `chrome.storage.local` + badge red. Other items in the batch still push successfully. | ✓ |
| Truncate body and log | Cut body to fit. Silently destroys user content — violates "no silent failures" charter. | |
| Reject the whole batch | If any item exceeds budget, the entire push fails. Coupling unrelated items punishes the user. | |

**User's choice:** Reject + surface error
**Notes:** Charter-aligned — surface errors loudly, never silently destroy content.

---

## chrome.storage.local schema

### Q1: What does `last-pushed snapshot` (the diff baseline) hold in chrome.storage.local?

| Option | Description | Selected |
|--------|-------------|----------|
| Body content hashes per UUID (Recommended) | `{[uuid]: {titleHash, bodyHash, updatedAt}}` — short hashes, ~80 bytes/item. Avoids duplicating bodies into local. | ✓ |
| Full bodies + registry | Mirror the full registry + body strings in local. Simplest comparison; doubles disk usage. | |
| Just UUIDs + updatedAt | Lightweight but misses local-edits-not-yet-flushed: a body changed twice in 30s could be lost if updatedAt got bumped without us seeing the prior content. | |

**User's choice:** Body content hashes per UUID
**Notes:** Hash comparison is sufficient for diff purposes; avoids storing redundant payload data.

### Q2: What shape does the `sync_pending` sentinel take?

| Option | Description | Selected |
|--------|-------------|----------|
| Object with batch ID + keys + start time (Recommended) | `{batchId, keys, startedAt}`. On SW wake, if `startedAt > 60s ago`, treat as orphaned. Bounded recovery window. | ✓ |
| Boolean flag | `{syncPending: true}` — lightweight but no info on which keys were mid-flight; recovery has to inspect everything. | |
| Full pending batch payload | Replay the batch on recovery. Largest local-storage cost; doubles write cost. | |

**User's choice:** Object with batch ID + keys + start time
**Notes:** 60-second TTL bounds recovery cost; batch ID detects concurrent SW instances writing.

### Q3: When `chrome.storage.onChanged` fires while another merge is mid-flight, how is the pending-merge queue stored?

| Option | Description | Selected |
|--------|-------------|----------|
| Array of changeset events with timestamps (Recommended) | `{pendingMerges: [{changes, receivedAt}, ...]}` — FIFO, drained when current merge finishes. Bounded to N=10 to prevent unbounded growth. | ✓ |
| Single coalesced "dirty" flag | Simplest; loses event-level info that may help debug merge bugs. | |
| Map of changed keys to latest values | Coalesces multiple events; loses ordering. | |

**User's choice:** Array of changeset events with timestamps (capped N=10)
**Notes:** Cap prevents unbounded growth from sync flapping; oldest-drop is logged to `syncStatus.errorState`.

### Q4: How are chrome.storage.local keys namespaced relative to chrome.storage.sync's `sysins:*`?

| Option | Description | Selected |
|--------|-------------|----------|
| `sysins:local:*` prefix (Recommended) | Local-only keys: `sysins:local:lastPushed`, `sysins:local:syncPending`, `sysins:local:syncStatus`, `sysins:local:pendingMerges`. Distinct from sync namespace. | ✓ |
| Same `sysins:*` prefix | Local and sync share the namespace. Ambiguous on inspection. | |
| Separate top-level prefix | `sysinslocal:*` (no colon split). Different feel; harder to scan. | |

**User's choice:** `sysins:local:*` prefix
**Notes:** Same `sysins` family for grep-ability; `:local:` infix makes the storage area unambiguous.

---

## Schema migration depth

### Q1: What does Phase 1 ship for schema versioning?

| Option | Description | Selected |
|--------|-------------|----------|
| Version stamp + reader guard (Recommended) | Write `schemaVersion: 1` on install. On every read, assert version === 1; mismatch → refuse to operate, red badge, error message. No upgraders yet. | ✓ |
| Versioned reader registry | Build `readers: {1: parseV1, 2: parseV2}` map; dispatch by version. Adds infrastructure with no v2. YAGNI. | |
| Full migration framework | Register upgrader functions per (from, to); auto-run on mismatch. Heavyweight; meaningful only when v2 is in flight. | |

**User's choice:** Version stamp + reader guard
**Notes:** YAGNI-correct: no v2 exists, so no upgrader pairs to register. Reader-guard mismatch behavior is enough for v1.

### Q2: What happens if a Chrome on another device with an OLDER extension version reads sysins:meta written by a NEWER schema?

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse + red badge + chrome.storage.local error (Recommended) | Older extension sees `schemaVersion > understood`. Aborts I/O, sets `errorState='SCHEMA_AHEAD'`. Popup explains 'update extension on this device'. No data loss. | ✓ |
| Best-effort read | Try to read what we can, ignore unknown fields. Risks silent data divergence. | |
| Auto-downgrade | Older device rewrites meta to its version, drops new fields. Loses data; violates "no silent failures". | |

**User's choice:** Refuse + red badge + chrome.storage.local error
**Notes:** Preserves data integrity at the cost of pausing sync on the older device until it updates.

### Q3: On first install, what is the precise contract for writing sysins:meta?

| Option | Description | Selected |
|--------|-------------|----------|
| On `chrome.runtime.onInstalled`, only if absent (Recommended) | If `sysins:meta` missing, write `{schemaVersion:1, lastPushAt:0, lastPullAt:0}`. If already exists (another device populated sync first), DO NOT overwrite — read it, validate, proceed. | ✓ |
| Always write on install | Overwrite on every install/update. Resets timestamps every install. | |
| Write lazily on first push | Defer until first sync write. Means a fresh-install reader might see no meta key. | |

**User's choice:** On `chrome.runtime.onInstalled`, only if absent
**Notes:** Aligns with FND-04 and the union-merge first-install charter (SUMMARY.md item 5 — applies to schema metadata too).

### Q4: When (if ever) is schemaVersion bumped during v1?

| Option | Description | Selected |
|--------|-------------|----------|
| Never — v1 ships with schemaVersion:1, locked (Recommended) | Any v1.x release that needs a schema change either avoids the bump (additive-only fields) or is held until v2. Treats schema as a hard contract within v1. | ✓ |
| Bump for additive fields | Each new field bumps the version. Aggressive — forces older devices to update for benign changes. | |
| Bump only for breaking changes | Pragmatic but requires per-change judgment. | |

**User's choice:** Never — v1 ships with schemaVersion:1, locked
**Notes:** Hard contract simplifies cross-device compatibility within the v1 line.

---

## Claude's Discretion

- File-level naming inside `background/` and `shared/` (concrete export names, function signatures).
- Specific hashing algorithm for `titleHash`/`bodyHash` (planner picks at planning time).
- Vitest test-file layout (colocated `*.test.ts` vs `tests/` directory).
- ESLint/Prettier/TypeScript strict-mode flag set within reason.
- Whether `bootstrap.ts` is empty stub in Phase 1 or only created in Phase 4.

## Deferred Ideas

(None raised during this discussion — all four areas stayed within Phase 1 scope.)

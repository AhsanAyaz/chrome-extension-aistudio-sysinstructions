---
phase: 01-foundation
plan: 04
subsystem: database
tags: [chrome-storage-sync, registry, tombstone, uuid, crud, chunking]

# Dependency graph
requires:
  - phase: 01-foundation/01-02
    provides: shared types (RegistryRecord, SyncRegistry, BodyPayload) and constants (REGISTRY_KEY, BODY_KEY_PREFIX)
  - phase: 01-foundation/01-03
    provides: splitIntoChunks, joinChunks from storage-layout.ts

provides:
  - Registry CRUD with UUID-as-permanent-identity (FND-01)
  - Per-item updatedAt tracking (FND-02)
  - Tombstone semantics with resurrection rejection (FND-03)
  - Short SHA-256 content hash helper for Phase 3 push engine (D-12)
  - 12 passing tests covering D-25 registry CRUD + Recipe 9 tombstone resurrection cases

affects:
  - Phase 2 (content script / AI Studio bridge) — consumes createItem, updateItem
  - Phase 3 (push engine) — consumes createItem, updateItem, deleteItem, shortHash, reconstructInstructions
  - Phase 4 (pull / bootstrap) — inherits applyRemote tombstone contract, extends merge engine

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Authoritative timestamp model: max(updatedAt, deletedAt??0) per side — newer authority wins, tie goes to tombstone"
    - "Single batched chrome.storage.sync.set() for all multi-key writes (CLAUDE.md hard rule 3)"
    - "Soft-delete tombstones: deletedAt set, body keys cleared, registry entry preserved"
    - "fakeBrowser.reset() in beforeEach for isolated chrome.storage.sync unit tests"

key-files:
  created:
    - src/background/hash.ts
    - src/background/registry.ts
    - src/background/registry.test.ts
  modified: []

key-decisions:
  - "Body keys cleared on deleteItem: saves quota immediately; tombstone registry entry stays for merge semantics (D-18)"
  - "updateItem throws on tombstoned item: defensive guard — no un-delete-via-update path; revival only via applyRemote with newer updatedAt"
  - "applyRemote uses authoritative timestamp model: max(updatedAt, deletedAt??0); generalizes Recipe 9's 4 cases into 1 rule"
  - "Stale-chunk cleanup in updateItem: removes body keys beyond new chunk count to prevent stale reassembly"
  - "shortHash: SHA-256 not FNV-1a — crypto.subtle.digest built-in, zero bundle cost, async overhead < storage round-trip"

patterns-established:
  - "Tombstone resurrection rejection: older live updatedAt cannot revive newer deletedAt; tie excluded from live set"
  - "UUID permanence: crypto.randomUUID() on createItem only; never re-assigned on rename or any subsequent operation"
  - "Single batched set: all registry + body key writes in one chrome.storage.sync.set() call"

requirements-completed: [FND-01, FND-02, FND-03]

# Metrics
duration: 2min
completed: 2026-05-05
---

# Phase 01 Plan 04: Registry CRUD Summary

**Registry CRUD with UUID-permanent-identity, per-item updatedAt tracking, tombstone resurrection rejection, and shortHash helper — all locked by 12 passing fakeBrowser tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-05T21:35:01Z
- **Completed:** 2026-05-05T21:37:01Z
- **Tasks:** 3
- **Files modified:** 3 created

## Accomplishments

- Shipped `hash.ts` with `shortHash()` — SHA-256 truncated to 16 hex chars, built-in crypto.subtle, zero bundle cost
- Shipped `registry.ts` with 6 exported functions implementing UUID identity, tombstone semantics, and resurrection rejection
- 12 unit tests passing under fakeBrowser covering all D-25 CRUD cases and Recipe 9 tombstone cases

## Task Commits

Each task was committed atomically:

1. **Task 1: hash.ts** - `3b381ce` (feat)
2. **Task 2: registry.ts** - `d7bb047` (feat)
3. **Task 3: registry.test.ts** - `b2383c6` (test)

## Files Created/Modified

- `/Users/amu1o5/personal/chrome-extension-aistudio-sysinstructions/src/background/hash.ts` — shortHash(input): SHA-256 truncated to 8 bytes (16 hex chars)
- `/Users/amu1o5/personal/chrome-extension-aistudio-sysinstructions/src/background/registry.ts` — getRegistry, createItem, updateItem, deleteItem, applyRemote, reconstructInstructions
- `/Users/amu1o5/personal/chrome-extension-aistudio-sysinstructions/src/background/registry.test.ts` — 12 tests covering FND-01/02/03 + Recipe 9 tombstone cases

## Exported Function Signatures

```typescript
// src/background/registry.ts
export async function getRegistry(): Promise<SyncRegistry>;
export async function createItem(input: { title: string; text: string }): Promise<string /* uuid */>;
export async function updateItem(uuid: string, patch: Partial<{ title: string; text: string }>): Promise<void>;
export async function deleteItem(uuid: string): Promise<void>;
export async function applyRemote(remote: SyncRegistry): Promise<void>;
export async function reconstructInstructions(): Promise<Array<{ uuid: string; title: string; text: string }>>;

// src/background/hash.ts
export async function shortHash(input: string): Promise<string>; // 16-char hex
```

## Decisions Made

- **Body keys cleared on deleteItem**: Phase 1 clears body chunks when tombstone is set (saves quota immediately). Only the registry entry is required to stay in place per D-18. Tombstone GC (TTL purge of the registry entry) is deferred to Phase 4 / v1.x.
- **updateItem throws on tombstoned item**: Defensive guard. There is no un-delete-via-update path; legitimate revival happens only via `applyRemote` with a newer `updatedAt` (Recipe 9 case 4).
- **applyRemote authoritative timestamp model**: `max(updatedAt, deletedAt ?? 0)` per side. The newer authority wins; on tie, tombstone wins (D-06 / D-18). This single rule generalizes all 4 Recipe 9 cases.
- **Stale-chunk cleanup in updateItem**: When text is updated to a smaller payload, chunk keys beyond the new count are removed via `chrome.storage.sync.remove` to prevent stale chunk data from polluting future reassembly.
- **Phase 1 applyRemote is a slice**: Does NOT fetch remote bodies, does not handle multi-tab races, does not run loop-guard. Those are Phase 4 / BOOT-01 work. Phase 1 ships only enough merge logic to exercise the Recipe 9 tombstone tests.

## Test Coverage

12 `it()` calls across 6 describe blocks:

| # | Test | Covers |
|---|------|--------|
| 1 | v4-shaped UUID returned + registry + body written | FND-01, D-17 |
| 2 | rename preserves UUID; title updated; updatedAt bumped | FND-01, FND-02 |
| 3 | throws on update of non-existent UUID | Error guard |
| 4 | throws on update of tombstoned item | Error guard |
| 5 | deleteItem sets deletedAt >= updatedAt; entry stays | FND-03, D-18 |
| 6 | reconstructInstructions excludes tombstoned records | D-06 |
| 7 | tie case (deletedAt === updatedAt) excluded | D-06, D-18 |
| 8 | older live remote does NOT resurrect newer tombstone | Recipe 9 case 3 |
| 9 | newer live remote DOES override older tombstone | Recipe 9 case 4 |
| 10 | remote newer tombstone wins over local live record | Recipe 9 case 2 |
| 11 | round-trip > 7KB body through chunking + reassembly | FND-05, D-04 |
| 12 | stale chunks removed when updateItem shrinks body | D-04 |

## Deviations from Plan

None - plan executed exactly as written. The plan provided verbatim implementation for all three files; the code was applied directly and all tests pass.

## Issues Encountered

None.

## Next Phase Readiness

- Registry contract is locked and tested. Phase 2 (content script / AI Studio bridge) can call `createItem`, `updateItem` safely.
- Phase 3 (push engine) inherits the full registry API and `shortHash` for `sysins:local:lastPushed` diff tracking.
- Phase 4 (pull / bootstrap) extends `applyRemote` with the full merge engine — the tombstone resurrection rejection rule is now established as a tested contract.
- The "authoritative timestamp" merge rule (`max(updatedAt, deletedAt ?? 0)`) is documented here so Phase 4 can extend without re-deriving the math.

---
*Phase: 01-foundation*
*Completed: 2026-05-05*

## Self-Check: PASSED

- [x] `src/background/hash.ts` exists
- [x] `src/background/registry.ts` exists
- [x] `src/background/registry.test.ts` exists
- [x] Commit `3b381ce` exists (hash.ts)
- [x] Commit `d7bb047` exists (registry.ts)
- [x] Commit `b2383c6` exists (registry.test.ts)
- [x] `npx tsc --noEmit` passes
- [x] `npx vitest run src/background/registry.test.ts` exits 0 with 12 passing tests

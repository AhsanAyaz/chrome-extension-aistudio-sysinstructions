---
phase: 01-foundation
plan: 02
subsystem: shared
tags: [typescript, chrome-storage, schema-versioning, constants, types, vitest, fakeBrowser]

# Dependency graph
requires:
  - phase: 01-foundation plan 01
    provides: WXT scaffold, tsconfig strict mode, vitest config with WxtVitest() + fakeBrowser

provides:
  - src/shared/constants.ts — all 10 D-24 storage key names and numeric constants (single source of truth)
  - src/shared/types.ts — all Phase 1 type declarations (SyncMeta, RegistryRecord, SyncRegistry, BodyPayload, LastPushedEntry/Snapshot, SyncPendingSentinel, PendingMerge, ErrorState, SyncStatus)
  - src/shared/meta-guard.ts — loadAndAssertMeta() schema-version reader guard (Recipe 7, D-09)
  - src/shared/meta-guard.test.ts — 6 passing unit tests covering all 4 GuardResult outcomes

affects:
  - 01-03-storage-layout (imports CHUNK_BUDGET_BYTES, BODY_KEY_PREFIX, REGISTRY_KEY, RegistryRecord, BodyPayload)
  - 01-04-registry (imports REGISTRY_KEY, BODY_KEY_PREFIX, SyncRegistry, RegistryRecord)
  - 01-05-sw-bootstrap-resume (imports META_KEY, SCHEMA_VERSION, SyncMeta, loadAndAssertMeta, all local types)
  - all later phases (the constants and types are the shared contract)

# Tech tracking
tech-stack:
  added:
    - "@types/chrome ^0.1.40 — chrome global type declarations required for tsc --noEmit with chrome.* API usage"
  patterns:
    - "Single source of truth: all sysins:* and sysins:local:* key names exported only from constants.ts"
    - "Literal type lock: SyncMeta.schemaVersion typed as literal 1 (not number) — enforces D-11 at compile time"
    - "Discriminated union return type: GuardResult for schema-mismatch refusal (Recipe 7)"
    - "fakeBrowser.reset() in beforeEach — guarantees clean storage state between tests"

key-files:
  created:
    - src/shared/constants.ts
    - src/shared/types.ts
    - src/shared/meta-guard.ts
    - src/shared/meta-guard.test.ts
  modified:
    - package.json (added @types/chrome dev dependency)
    - package-lock.json

key-decisions:
  - "OQ-1: 'PENDING_MERGE_OVERFLOW' added to ErrorState union (D-15 explicitly says Phase 1 defines the shape; widening at design time avoids a future schema change)"
  - "OQ-3: 'meta absent' case folds into MALFORMED_REMOTE — no dedicated 'NO_META' tag; comment in meta-guard.ts documents the choice for Phase 2+ extension if needed"
  - "Rule 3 auto-fix: installed @types/chrome to satisfy tsc --noEmit with chrome.* global usage (WXT 0.20 dropped webextension-polyfill and uses @types/chrome per RESEARCH line 382)"

patterns-established:
  - "Pattern S-2: sysins: namespace discipline — all storage keys imported from constants.ts, never inline string literals"
  - "Pattern S-3: schema-guard at every sync entrypoint — loadAndAssertMeta() returns GuardResult; callers refuse I/O on ok=false"
  - "fakeBrowser test pattern: import fakeBrowser from 'wxt/testing/fake-browser', call fakeBrowser.reset() in beforeEach, use chrome.* APIs directly"

requirements-completed: [FND-04]

# Metrics
duration: 4min
completed: 2026-05-05
---

# Phase 01 Plan 02: Shared Primitives Summary

**Storage key constants (D-24), all Phase 1 type shapes (D-03/D-12-D-15 + OQ-1 ErrorState widening), and schema-version reader guard with 6 passing branch-coverage tests — the contracts Plans 03/04/05 import.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-05T21:25:36Z
- **Completed:** 2026-05-05T21:29:29Z
- **Tasks:** 2 completed
- **Files modified:** 6

## Accomplishments

- `constants.ts` exports exactly the 10 D-24 constants with their locked values; no inline magic numbers exist in `src/`
- `types.ts` defines all Phase 1 storage shapes under strict TypeScript (including `exactOptionalPropertyTypes`); `SyncMeta.schemaVersion` is literal type `1`; `ErrorState` includes `'PENDING_MERGE_OVERFLOW'` (OQ-1)
- `meta-guard.ts` implements Recipe 7 verbatim: `loadAndAssertMeta()` → `{ok:true, meta}` | `{ok:false, tag:'SCHEMA_AHEAD'|'SCHEMA_UNKNOWN'|'MALFORMED_REMOTE'}`; the guard is read-only (no writes)
- 6 unit tests pass via `npx vitest run src/shared/meta-guard.test.ts` (all 4 GuardResult branches + null schemaVersion case)
- `npx tsc --noEmit` exits 0 under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes

## Task Commits

1. **Task 1: src/shared/constants.ts and src/shared/types.ts** - `96b4534` (feat)
2. **Task 2: src/shared/meta-guard.ts and colocated tests** - `47e997c` (feat, includes @types/chrome fix)

## Files Created/Modified

- `src/shared/constants.ts` — 10 exported constants (KEY_PREFIX, LOCAL_KEY_PREFIX, META_KEY, REGISTRY_KEY, BODY_KEY_PREFIX, CHUNK_BUDGET_BYTES, SCHEMA_VERSION, PENDING_BATCH_TTL_MS, PENDING_MERGE_QUEUE_CAP, TOMBSTONE_GC_TTL_MS)
- `src/shared/types.ts` — SyncMeta, RegistryRecord (with chunks), SyncRegistry, BodyPayload, LastPushedEntry, LastPushedSnapshot, SyncPendingSentinel, PendingMerge, ErrorState (9 members), SyncStatus
- `src/shared/meta-guard.ts` — GuardResult type + loadAndAssertMeta() async function
- `src/shared/meta-guard.test.ts` — 6 unit tests covering all guard outcomes
- `package.json` — added @types/chrome ^0.1.40 dev dependency
- `package-lock.json` — updated lockfile

## Constants Exported (D-24 audit trail)

| Constant | Value | Purpose |
|----------|-------|---------|
| `KEY_PREFIX` | `'sysins:'` | sync storage namespace prefix |
| `LOCAL_KEY_PREFIX` | `'sysins:local:'` | local storage namespace prefix |
| `META_KEY` | `'sysins:meta'` | schema meta record key |
| `REGISTRY_KEY` | `'sysins:registry'` | instruction registry key |
| `BODY_KEY_PREFIX` | `'sysins:body:'` | body chunk key prefix |
| `CHUNK_BUDGET_BYTES` | `7000` | per-chunk byte budget (D-05) |
| `SCHEMA_VERSION` | `1` | locked v1 schema version (D-11) |
| `PENDING_BATCH_TTL_MS` | `60_000` | orphaned-sentinel TTL (D-13) |
| `PENDING_MERGE_QUEUE_CAP` | `10` | pending merge queue cap (D-14) |
| `TOMBSTONE_GC_TTL_MS` | `2592000000` | 30-day tombstone GC TTL (D-18) |

## OQ-1: ErrorState Widening Decision

Added `'PENDING_MERGE_OVERFLOW'` to `ErrorState` (D-15 Phase 1 union). Rationale: D-15 explicitly says "Phase 1 defines the shape." RESEARCH line 800 recommends YES. Adding it now avoids a future type-only change that could require reviewing all ErrorState consumers.

## OQ-3: NO_META Tag Decision

Folded "meta absent" into `MALFORMED_REMOTE` rather than introducing a dedicated `'NO_META'` tag. Practical impact is identical (refuse all I/O). A comment in `meta-guard.ts` documents the choice for Phase 2+ extension. Phase 1 ErrorState union stays at 9 locked members.

## Test Results

```
Tests  6 passed (6)
```

Tests cover:
1. `ok=true` when schemaVersion matches SCHEMA_VERSION (1)
2. `SCHEMA_AHEAD` when schemaVersion is 2 (greater)
3. `SCHEMA_UNKNOWN` when schemaVersion is 0 (lesser, D-11 v1 lock)
4. `MALFORMED_REMOTE` when key absent (empty storage)
5. `MALFORMED_REMOTE` when schemaVersion is string `"1"` (non-numeric)
6. `MALFORMED_REMOTE` when schemaVersion is `null`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added @types/chrome dev dependency for tsc --noEmit**
- **Found during:** Task 2 verification (`npx tsc --noEmit`)
- **Issue:** `meta-guard.ts` and `meta-guard.test.ts` use `chrome.storage.sync.*` which is a global Chrome Extension API. The WXT scaffold's `.wxt/tsconfig.json` and `wxt.d.ts` do not directly expose `@types/chrome` for standalone `tsc` invocations (WXT's own build pipeline handles this internally). Without `@types/chrome`, tsc reported `TS2304: Cannot find name 'chrome'` on 6 lines.
- **Fix:** `npm install --save-dev @types/chrome` (per RESEARCH line 382: "WXT 0.20 dropped webextension-polyfill and uses @types/chrome directly via @wxt-dev/browser"). This is consistent with WXT 0.20's documented approach.
- **Files modified:** `package.json`, `package-lock.json`
- **Commit:** `47e997c` (included in Task 2 commit)

## Known Stubs

None — all exports are complete and functional. No placeholder data, no TODO/FIXME markers.

## Threat Flags

None — this plan creates pure type declarations and constants. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond the locked `sysins:*` namespace constants already in the plan's threat model.

## Self-Check: PASSED

- `src/shared/constants.ts` — FOUND
- `src/shared/types.ts` — FOUND
- `src/shared/meta-guard.ts` — FOUND
- `src/shared/meta-guard.test.ts` — FOUND
- Commit `96b4534` — FOUND
- Commit `47e997c` — FOUND
- `npx tsc --noEmit` — exits 0
- `npx vitest run src/shared/meta-guard.test.ts` — 6 passed

---
phase: 01-foundation
plan: 02
type: execute
wave: 1
depends_on: [01]
files_modified:
  - src/shared/constants.ts
  - src/shared/types.ts
  - src/shared/meta-guard.ts
  - src/shared/meta-guard.test.ts
autonomous: true
requirements: [FND-04]
must_haves:
  truths:
    - "All `sysins:*` and `sysins:local:*` key names are exported from a single source-of-truth module"
    - "Schema version is locked at `1` (D-11) and exported as `SCHEMA_VERSION` constant"
    - "TypeScript types for SyncMeta, SyncRegistry, RegistryRecord, BodyPayload, LastPushedSnapshot, SyncPendingSentinel, PendingMerge, SyncStatus, ErrorState are available for import"
    - "`loadAndAssertMeta()` returns a discriminated union: `{ok: true, meta}` for schemaVersion === 1, `{ok: false, tag: 'SCHEMA_AHEAD'}` for higher, `{ok: false, tag: 'SCHEMA_UNKNOWN'}` for lower, `{ok: false, tag: 'MALFORMED_REMOTE'}` for missing/non-numeric"
    - "`vitest run src/shared/meta-guard.test.ts` exits 0 with at least 5 passing tests covering all guard branches"
  artifacts:
    - path: "src/shared/constants.ts"
      provides: "All storage key prefixes, byte budgets, schema version, TTL caps"
      contains: "export const SCHEMA_VERSION = 1"
    - path: "src/shared/types.ts"
      provides: "All Phase 1 type declarations (SyncMeta, RegistryRecord, BodyPayload, ErrorState, etc.)"
      contains: "export interface SyncMeta"
    - path: "src/shared/meta-guard.ts"
      provides: "Schema-version reader guard (Recipe 7); single point for schema-mismatch refusal"
      contains: "export async function loadAndAssertMeta"
    - path: "src/shared/meta-guard.test.ts"
      provides: "Unit tests for all 4 guard branches (ok, SCHEMA_AHEAD, SCHEMA_UNKNOWN, MALFORMED_REMOTE)"
      min_lines: 50
  key_links:
    - from: "src/shared/meta-guard.ts"
      to: "src/shared/constants.ts"
      via: "import { META_KEY, SCHEMA_VERSION }"
      pattern: "import .* from ['\"]./constants['\"]"
    - from: "src/shared/meta-guard.ts"
      to: "src/shared/types.ts"
      via: "import type { SyncMeta }"
      pattern: "import type .* SyncMeta .* from ['\"]./types['\"]"
    - from: "src/shared/meta-guard.test.ts"
      to: "fakeBrowser via wxt/testing/fake-browser"
      via: "browser.storage.sync state seeding"
      pattern: "fakeBrowser\\.reset\\(\\)"
---

<objective>
Establish the single-source-of-truth shared layer: storage key constants (D-24, exhaustive list), TypeScript type declarations for every Phase 1 storage shape (D-03 / D-12-D-15 plus the OQ-1 widening of `ErrorState` to include `'PENDING_MERGE_OVERFLOW'`), and the schema-version reader guard (Recipe 7) with full branch coverage. This plan lands FND-04 (versioned schema, namespaced keys, refusal-on-mismatch) and provides the contracts Plans 03/04/05 import.

Purpose: Lock the namespace (`sysins:*` / `sysins:local:*`), the schema version (1, frozen for v1.x per D-11), and the malformed/ahead/unknown error tags. Future phases must NEVER add a new storage key without updating `constants.ts`, NEVER add a new error state without updating the `ErrorState` union, and NEVER read `chrome.storage.sync` without going through `loadAndAssertMeta()`.
Output: `src/shared/{constants,types,meta-guard}.ts` plus colocated meta-guard tests covering the 4 guard outcomes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-PATTERNS.md
@CLAUDE.md
@.planning/phases/01-foundation/01-01-SUMMARY.md

<interfaces>
<!-- Plan 01 produced: -->
<!--   - tsconfig.json with strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes -->
<!--   - vitest.config.ts with WxtVitest() + happy-dom -->
<!--   - src/background/index.ts (3-line stub - DO NOT modify in this plan) -->

<!-- This plan ESTABLISHES the following contracts for Plans 03/04/05/06 to consume: -->

From src/shared/constants.ts (this plan creates):
```typescript
export const KEY_PREFIX: 'sysins:';
export const LOCAL_KEY_PREFIX: 'sysins:local:';
export const META_KEY: 'sysins:meta';
export const REGISTRY_KEY: 'sysins:registry';
export const BODY_KEY_PREFIX: 'sysins:body:';
export const CHUNK_BUDGET_BYTES: 7000;
export const SCHEMA_VERSION: 1;
export const PENDING_BATCH_TTL_MS: 60000;
export const PENDING_MERGE_QUEUE_CAP: 10;
export const TOMBSTONE_GC_TTL_MS: 2592000000;
```

From src/shared/types.ts (this plan creates):
```typescript
export interface SyncMeta { schemaVersion: 1; lastPushAt: number; lastPullAt: number }
export interface RegistryRecord { title: string; updatedAt: number; deletedAt: number | null; chunks: number }
export type SyncRegistry = Record<string, RegistryRecord>;
export interface BodyPayload { text: string; [k: string]: unknown }
export interface LastPushedEntry { titleHash: string; bodyHash: string; updatedAt: number }
export type LastPushedSnapshot = Record<string, LastPushedEntry>;
export interface SyncPendingSentinel { batchId: string; keys: string[]; startedAt: number }
export interface PendingMerge { changes: unknown; receivedAt: number }
export type ErrorState = 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' | 'ACCOUNT_MISMATCH' | 'OVERSIZED_ITEM' | 'STRICT_VALIDATION_FAIL' | 'PENDING_MERGE_OVERFLOW';
export interface SyncStatus { state: 'idle' | 'syncing' | 'error'; lastSyncAt: number; errorState?: ErrorState; errorDetail?: string }
```

From src/shared/meta-guard.ts (this plan creates):
```typescript
export type GuardResult =
  | { ok: true; meta: SyncMeta }
  | { ok: false; tag: 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' };
export async function loadAndAssertMeta(): Promise<GuardResult>;
```

<!-- Plans 03 (storage-layout) and 04 (registry) import CHUNK_BUDGET_BYTES, BODY_KEY_PREFIX, REGISTRY_KEY -->
<!-- Plan 05 (SW + bootstrap) imports META_KEY, SCHEMA_VERSION, SyncMeta, loadAndAssertMeta -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write src/shared/constants.ts and src/shared/types.ts</name>
  <files>src/shared/constants.ts, src/shared/types.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-24 line 75) — verbatim list of constants
    - .planning/phases/01-foundation/01-CONTEXT.md (D-03, D-12, D-13, D-14, D-15) — type shape lock
    - .planning/phases/01-foundation/01-PATTERNS.md (lines 82-173) — copy-verbatim references for both files
    - .planning/phases/01-foundation/01-RESEARCH.md (lines 798-805, OQ-1) — `'PENDING_MERGE_OVERFLOW'` widening recommendation
    - .planning/research/ARCHITECTURE.md (lines 142-163) — original schema types (now widened by D-03's `chunks` field)
  </read_first>
  <behavior>
    - constants.ts exports all 10 names from D-24 with EXACT values; importing the module surfaces no other exports.
    - types.ts exports SyncMeta, RegistryRecord, SyncRegistry, BodyPayload, LastPushedEntry, LastPushedSnapshot, SyncPendingSentinel, PendingMerge, SyncStatus, ErrorState. All types compile under strict mode (including `exactOptionalPropertyTypes`).
    - `RegistryRecord.chunks` field is present (D-03 widening over ARCHITECTURE.md's original shape).
    - `ErrorState` includes `'PENDING_MERGE_OVERFLOW'` (OQ-1 widening, recommended yes per RESEARCH line 800; planner is folding it in directly per Recipe 6 line 530).
    - `SyncMeta.schemaVersion` is the literal type `1` (not `number`) — locks D-11 ("v1 schema lock") at the type level.
  </behavior>
  <action>
    **1. Create `src/shared/constants.ts`** with the verbatim D-24 list (CONTEXT.md line 75). Each value MUST match exactly:
    ```typescript
    export const KEY_PREFIX = 'sysins:';
    export const LOCAL_KEY_PREFIX = 'sysins:local:';
    export const META_KEY = 'sysins:meta';
    export const REGISTRY_KEY = 'sysins:registry';
    export const BODY_KEY_PREFIX = 'sysins:body:';
    export const CHUNK_BUDGET_BYTES = 7000;
    export const SCHEMA_VERSION = 1;
    export const PENDING_BATCH_TTL_MS = 60_000;
    export const PENDING_MERGE_QUEUE_CAP = 10;
    export const TOMBSTONE_GC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    ```
    No additional exports. No type annotations beyond what TypeScript infers (the literal types are what we want — `SCHEMA_VERSION` as `1`, not `number`). `as const` is unnecessary; literal `const` declarations infer literal types when assigned a primitive literal.

    **2. Create `src/shared/types.ts`** with the shape lock from D-03 / D-12-D-15 plus OQ-1 widening:
    ```typescript
    // sysins:meta — D-03 / D-09 / D-11
    export interface SyncMeta {
      schemaVersion: 1; // literal type — locks D-11 v1 schema for the entire v1.x line
      lastPushAt: number;
      lastPullAt: number;
    }

    // sysins:registry — D-03 (note: `chunks` widening over ARCHITECTURE.md's original 3-field shape)
    export interface RegistryRecord {
      title: string;
      updatedAt: number; // epoch ms
      deletedAt: number | null; // epoch ms tombstone; null = alive
      chunks: number; // D-03: body chunk count, avoids extra round-trip
    }
    export type SyncRegistry = Record<string, RegistryRecord>;

    // sysins:body:<uuid>:c<N> — D-01: JSON.stringify({text, ...rest})
    // BodyPayload describes the parsed JSON, not the chunk strings themselves.
    export interface BodyPayload {
      text: string;
      [unknownAiStudioField: string]: unknown; // ...rest spread per D-01 (PUSH-06 forward-compat)
    }

    // sysins:local:lastPushed — D-12
    export interface LastPushedEntry {
      titleHash: string; // SHA-256 truncated to 16 hex chars (Recipe 6)
      bodyHash: string;
      updatedAt: number;
    }
    export type LastPushedSnapshot = Record<string, LastPushedEntry>;

    // sysins:local:syncPending — D-13
    export interface SyncPendingSentinel {
      batchId: string;
      keys: string[]; // serialized as array (Set is not chrome.storage-cloneable per Recipe 6)
      startedAt: number; // epoch ms; orphaned if older than PENDING_BATCH_TTL_MS
    }

    // sysins:local:pendingMerges — D-14
    export interface PendingMerge {
      changes: unknown; // shape locked in Phase 3 when consumer exists
      receivedAt: number;
    }

    // sysins:local:syncStatus — D-15 (with OQ-1 widening)
    export type ErrorState =
      | 'QUOTA_EXCEEDED'
      | 'RATE_LIMITED'
      | 'SCHEMA_AHEAD'
      | 'SCHEMA_UNKNOWN'
      | 'MALFORMED_REMOTE'
      | 'ACCOUNT_MISMATCH'
      | 'OVERSIZED_ITEM'
      | 'STRICT_VALIDATION_FAIL'
      | 'PENDING_MERGE_OVERFLOW'; // OQ-1: widening of D-15 enum (D-15 explicitly says "Phase 1 defines the shape")

    export interface SyncStatus {
      state: 'idle' | 'syncing' | 'error';
      lastSyncAt: number;
      errorState?: ErrorState;
      errorDetail?: string;
    }
    ```
    Decision lock per OQ-1: `'PENDING_MERGE_OVERFLOW'` is added to `ErrorState`. RESEARCH line 800 recommends YES; D-15 says "Phase 1 defines the shape," so widening at design time is in scope.

    Note `exactOptionalPropertyTypes: true` (Plan 01 tsconfig) is in effect — that means `errorState?: ErrorState` is strict tag-or-omit. Future writers must NOT pass `errorState: undefined` explicitly; either the property is set to a tag or the key is absent.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `src/shared/constants.ts` exists
    - `src/shared/constants.ts` contains literal substring `export const KEY_PREFIX = 'sysins:'`
    - `src/shared/constants.ts` contains literal substring `export const LOCAL_KEY_PREFIX = 'sysins:local:'`
    - `src/shared/constants.ts` contains literal substring `export const META_KEY = 'sysins:meta'`
    - `src/shared/constants.ts` contains literal substring `export const REGISTRY_KEY = 'sysins:registry'`
    - `src/shared/constants.ts` contains literal substring `export const BODY_KEY_PREFIX = 'sysins:body:'`
    - `src/shared/constants.ts` contains literal substring `export const CHUNK_BUDGET_BYTES = 7000`
    - `src/shared/constants.ts` contains literal substring `export const SCHEMA_VERSION = 1`
    - `src/shared/constants.ts` contains literal substring `export const PENDING_BATCH_TTL_MS = 60_000` (or `60000`)
    - `src/shared/constants.ts` contains literal substring `export const PENDING_MERGE_QUEUE_CAP = 10`
    - `src/shared/constants.ts` contains literal substring `export const TOMBSTONE_GC_TTL_MS`
    - File `src/shared/types.ts` exists
    - `src/shared/types.ts` contains `export interface SyncMeta`
    - `src/shared/types.ts` declares `schemaVersion: 1` (literal type, not `number`) within `SyncMeta`
    - `src/shared/types.ts` contains `export interface RegistryRecord`
    - `src/shared/types.ts` declares `chunks: number` within `RegistryRecord` (D-03 widening)
    - `src/shared/types.ts` contains `export type SyncRegistry = Record&lt;string, RegistryRecord&gt;`
    - `src/shared/types.ts` contains `export interface BodyPayload` with `text: string`
    - `src/shared/types.ts` contains `export interface LastPushedEntry` with `titleHash`, `bodyHash`, `updatedAt`
    - `src/shared/types.ts` contains `export type LastPushedSnapshot`
    - `src/shared/types.ts` contains `export interface SyncPendingSentinel` with `batchId`, `keys`, `startedAt`
    - `src/shared/types.ts` contains `export interface PendingMerge`
    - `src/shared/types.ts` contains `export type ErrorState` with all 9 string literal members including `'PENDING_MERGE_OVERFLOW'` (OQ-1)
    - `src/shared/types.ts` contains `export interface SyncStatus`
    - Command `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Both files exist with the exact constant values and type shapes from D-24 / D-03 / D-12-D-15. `npx tsc --noEmit` passes under strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. The `'PENDING_MERGE_OVERFLOW'` widening is in place.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Write src/shared/meta-guard.ts and colocated tests</name>
  <files>src/shared/meta-guard.ts, src/shared/meta-guard.test.ts</files>
  <read_first>
    - src/shared/constants.ts (Task 1 output) — to import META_KEY and SCHEMA_VERSION
    - src/shared/types.ts (Task 1 output) — to import SyncMeta type
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 7, lines 536-592) — copy-verbatim guard implementation
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 2, lines 265-352) — fakeBrowser test pattern
    - .planning/phases/01-foundation/01-PATTERNS.md (lines 177-203) — meta-guard pattern reference
    - .planning/phases/01-foundation/01-CONTEXT.md (D-09, D-10, D-11) — guard semantics lock
  </read_first>
  <behavior>
    - **GuardResult.ok=true case:** when `chrome.storage.sync.get(META_KEY)` returns `{[META_KEY]: {schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}}`, `loadAndAssertMeta()` returns `{ok: true, meta}` with the same meta object.
    - **SCHEMA_AHEAD case:** when meta has `schemaVersion: 2`, returns `{ok: false, tag: 'SCHEMA_AHEAD'}`.
    - **SCHEMA_UNKNOWN case:** when meta has `schemaVersion: 0`, returns `{ok: false, tag: 'SCHEMA_UNKNOWN'}` (per D-11: nothing < 1 is valid in v1.x).
    - **MALFORMED_REMOTE — meta absent:** when `chrome.storage.sync.get(META_KEY)` returns `{}`, returns `{ok: false, tag: 'MALFORMED_REMOTE'}`.
    - **MALFORMED_REMOTE — meta has non-numeric schemaVersion:** when `meta.schemaVersion` is a string `"1"` or `null`, returns `{ok: false, tag: 'MALFORMED_REMOTE'}`.
    - The guard does NOT write anywhere — it is read-only. Callers handle the error tag (e.g., set `syncStatus.errorState`).
  </behavior>
  <action>
    **1. Create `src/shared/meta-guard.ts`** copying the Recipe 7 pattern verbatim (RESEARCH lines 540-569):
    ```typescript
    import { META_KEY, SCHEMA_VERSION } from './constants';
    import type { SyncMeta } from './types';

    export type GuardResult =
      | { ok: true; meta: SyncMeta }
      | { ok: false; tag: 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' };

    /**
     * Schema-version reader guard (D-09, Recipe 7).
     * Every sync entrypoint must pass through this before reading sysins:* keys.
     * Refuse-on-mismatch is the v1 contract (D-11 locks schemaVersion=1 for all of v1.x).
     */
    export async function loadAndAssertMeta(): Promise<GuardResult> {
      const r = await chrome.storage.sync.get(META_KEY);
      const meta = r[META_KEY] as SyncMeta | undefined;

      if (meta === undefined) {
        // First read on a freshly-installed device before initializeMeta() ran,
        // OR remote state is genuinely absent. Caller may treat as a recoverable
        // "no remote yet" state OR as MALFORMED_REMOTE depending on context.
        // Phase 1 folds both into MALFORMED_REMOTE per Recipe 7 default.
        return { ok: false, tag: 'MALFORMED_REMOTE' };
      }
      if (typeof meta.schemaVersion !== 'number') {
        return { ok: false, tag: 'MALFORMED_REMOTE' };
      }
      if (meta.schemaVersion > SCHEMA_VERSION) {
        return { ok: false, tag: 'SCHEMA_AHEAD' };
      }
      if (meta.schemaVersion < SCHEMA_VERSION) {
        return { ok: false, tag: 'SCHEMA_UNKNOWN' };
      }
      return { ok: true, meta };
    }
    ```
    Decision lock per OQ-3 (RESEARCH line 802): we fold "meta absent" into `MALFORMED_REMOTE` rather than introducing a dedicated `'NO_META'` tag. Practical impact is identical (refuse I/O), and Phase 1 keeps the `ErrorState` union to the 9 already-locked members. Comment in the code documents this choice so Phase 2+ can extend if a clearer signal is needed.

    **2. Create `src/shared/meta-guard.test.ts`** with the 5 branch tests (one per outcome plus an exact-tie ok case):
    ```typescript
    import { describe, it, expect, beforeEach } from 'vitest';
    import { fakeBrowser } from 'wxt/testing/fake-browser';
    import { loadAndAssertMeta } from './meta-guard';
    import { META_KEY, SCHEMA_VERSION } from './constants';
    import type { SyncMeta } from './types';

    beforeEach(() => {
      fakeBrowser.reset();
    });

    describe('loadAndAssertMeta (Recipe 7, D-09)', () => {
      it('returns ok=true when schemaVersion matches SCHEMA_VERSION', async () => {
        const meta: SyncMeta = { schemaVersion: 1, lastPushAt: 0, lastPullAt: 0 };
        await chrome.storage.sync.set({ [META_KEY]: meta });

        const result = await loadAndAssertMeta();

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.meta).toEqual(meta);
          expect(result.meta.schemaVersion).toBe(SCHEMA_VERSION);
        }
      });

      it('returns SCHEMA_AHEAD when remote schemaVersion is greater than SCHEMA_VERSION', async () => {
        await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: 2, lastPushAt: 0, lastPullAt: 0 } });

        const result = await loadAndAssertMeta();

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.tag).toBe('SCHEMA_AHEAD');
      });

      it('returns SCHEMA_UNKNOWN when remote schemaVersion is less than SCHEMA_VERSION (D-11 v1 lock)', async () => {
        await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: 0, lastPushAt: 0, lastPullAt: 0 } });

        const result = await loadAndAssertMeta();

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.tag).toBe('SCHEMA_UNKNOWN');
      });

      it('returns MALFORMED_REMOTE when meta is absent (key not present in storage)', async () => {
        // fakeBrowser.reset() in beforeEach guarantees an empty store

        const result = await loadAndAssertMeta();

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.tag).toBe('MALFORMED_REMOTE');
      });

      it('returns MALFORMED_REMOTE when schemaVersion is non-numeric', async () => {
        await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: '1', lastPushAt: 0, lastPullAt: 0 } });

        const result = await loadAndAssertMeta();

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.tag).toBe('MALFORMED_REMOTE');
      });

      it('returns MALFORMED_REMOTE when schemaVersion is null', async () => {
        await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: null, lastPushAt: 0, lastPullAt: 0 } });

        const result = await loadAndAssertMeta();

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.tag).toBe('MALFORMED_REMOTE');
      });
    });
    ```
    Note: `fakeBrowser` polyfills `chrome.storage.sync` per RESEARCH lines 304-306. `fakeBrowser.reset()` clears storage state between tests (RESEARCH line 306). Use `chrome.*` (not `browser.*`) — WXT 0.20 ships `@wxt-dev/browser` which re-exports `chrome` natively (RESEARCH line 382-383).
  </action>
  <verify>
    <automated>npx vitest run src/shared/meta-guard.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `src/shared/meta-guard.ts` exists
    - `src/shared/meta-guard.ts` imports `META_KEY` and `SCHEMA_VERSION` from `./constants`
    - `src/shared/meta-guard.ts` imports type `SyncMeta` from `./types`
    - `src/shared/meta-guard.ts` exports type `GuardResult` as a discriminated union with `ok: true \| false`
    - `src/shared/meta-guard.ts` exports async function `loadAndAssertMeta` returning `Promise&lt;GuardResult&gt;`
    - `src/shared/meta-guard.ts` reads via `chrome.storage.sync.get(META_KEY)` (uses the constant, not a string literal)
    - `src/shared/meta-guard.ts` does NOT call `chrome.storage.sync.set` or `chrome.storage.local.set` (read-only guard)
    - File `src/shared/meta-guard.test.ts` exists
    - `src/shared/meta-guard.test.ts` imports `fakeBrowser` from `'wxt/testing/fake-browser'`
    - `src/shared/meta-guard.test.ts` calls `fakeBrowser.reset()` in `beforeEach`
    - `src/shared/meta-guard.test.ts` contains at least 5 `it(...)` calls
    - `src/shared/meta-guard.test.ts` contains test descriptions matching `/ok=true/i`, `/SCHEMA_AHEAD/`, `/SCHEMA_UNKNOWN/`, `/MALFORMED_REMOTE/` (covering all 4 GuardResult outcomes)
    - Command `npx vitest run src/shared/meta-guard.test.ts` exits 0
    - Test output reports `Tests 6 passed` (or higher; minimum 5 passing tests)
  </acceptance_criteria>
  <done>
    `meta-guard.ts` and its tests exist. All 4 guard branches (ok, SCHEMA_AHEAD, SCHEMA_UNKNOWN, MALFORMED_REMOTE) are covered with passing tests. The guard is the only place that reads `sysins:meta` for version validation in Phase 1+.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `chrome.storage.sync` (remote) → SW (local) | Untrusted serialized data crosses here. Another device on a future v2 schema could land malformed or ahead-of-version meta in our store. |
| Constant strings → all storage call sites | If a single inline `'sysins:'` string typo appears anywhere in `src/`, it would write outside the namespace (CLAUDE.md hard rule 1 violation). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-05 | T (Tampering) | `sysins:meta.schemaVersion` from another device | mitigate | `loadAndAssertMeta()` rejects any meta where `schemaVersion !== 1` — `SCHEMA_AHEAD` for greater, `SCHEMA_UNKNOWN` for lesser, `MALFORMED_REMOTE` for non-numeric. Per D-09, callers refuse all I/O on a non-ok result. The 6th test (`schemaVersion is null`) covers a deliberately-corrupted remote payload. |
| T-01-06 | T (Tampering) | `sysins:meta` shape (extra/missing fields beyond `schemaVersion`) | accept | The guard only validates `schemaVersion` — it does not type-check `lastPushAt` / `lastPullAt`. Phase 3 (push engine) is responsible for treating bad timestamp shapes as `MALFORMED_REMOTE`. Phase 1's contract is narrower: schema-version refusal only. |
| T-01-07 | I (Information Disclosure) | Type-level `BodyPayload` with `[k: string]: unknown` index signature | accept | The signature is required by D-01 / PUSH-06 (preserve unknown AI Studio fields end-to-end). It does not introduce a runtime risk; the data is already in the user's own `chrome.storage.sync`. |
| T-01-08 | E (Elevation of Privilege) | Inline storage-key string literals bypassing `constants.ts` | mitigate | Plan 06's DIST-04 static-scan pattern can be extended later (Phase 2+) to grep for `'sysins:'` outside `constants.ts` — Phase 1 enforces this by code review and the `S-2 sysins: namespace discipline` pattern (PATTERNS.md line 526). For Phase 1 the surface is small (5 files in plans 03/04/05) and inspectable. |
</threat_model>

<verification>
1. `npx tsc --noEmit` passes — types compile under strict mode.
2. `npx vitest run src/shared/meta-guard.test.ts` exits 0 with at least 5 passing tests.
3. Every storage key referenced anywhere in Plans 03/04/05 must be imported from `src/shared/constants.ts` — verified at code-review time and structurally enforced by the per-plan acceptance criteria.
4. `RegistryRecord.chunks: number` is present (D-03 widening over ARCHITECTURE.md's original 3-field shape).
5. `ErrorState` includes `'PENDING_MERGE_OVERFLOW'` (OQ-1 widening).
</verification>

<success_criteria>
- ROADMAP success criterion #4 (FND-04 partial): the `sysins:*` namespace constants are locked in a single source-of-truth module — `src/shared/constants.ts`. Every later phase writes only via these constants.
- Schema-version refusal (D-09) is implemented: `loadAndAssertMeta()` returns one of 4 well-defined outcomes. The 5+ branch tests prove it.
- Type contracts for the `chrome.storage.local` resume schema (D-12 / D-13 / D-14 / D-15) are defined. Plan 05 implements the runtime side; Plan 03 / 04 import the registry/body types.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-02-SUMMARY.md` documenting:
- Final exported names from `constants.ts` (the audit trail of D-24's 10-constant lock)
- Final type members from `types.ts` (especially the OQ-1 `'PENDING_MERGE_OVERFLOW'` widening of D-15)
- Decision on OQ-3 (NO_META tag): folded into `MALFORMED_REMOTE` per Recipe 7 default; comment in code documents the choice
- Total passing tests in `meta-guard.test.ts`
</output>

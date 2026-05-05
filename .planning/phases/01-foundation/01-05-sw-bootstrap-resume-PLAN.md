---
phase: 01-foundation
plan: 05
type: execute
wave: 3
depends_on: [02, 03]
files_modified:
  - src/background/meta-bootstrap.ts
  - src/background/sync-state.ts
  - src/background/index.ts
  - src/background/service-worker.test.ts
autonomous: true
requirements: [FND-04, FND-06]
must_haves:
  truths:
    - "On `chrome.runtime.onInstalled`, `chrome.storage.sync.get(META_KEY)` is read FIRST; `set` is called ONLY if the key was absent (D-10 write-if-absent)"
    - "After `onInstalled`, `chrome.storage.sync.get('sysins:meta')` returns `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}`"
    - "Re-running the `onInstalled` handler with a pre-existing meta containing `lastPushAt: 12345` does NOT overwrite — the existing meta survives"
    - "All 4 `sysins:local:*` resume keys are typed in src/shared/types.ts and have zero-init helper writers in sync-state.ts"
    - "An orphaned `sysins:local:syncPending` (startedAt > 60_000ms ago) is detected and cleared on SW init (D-13)"
    - "`vitest run src/background/service-worker.test.ts` exits 0 with at least 6 passing tests covering FND-04 + FND-06"
  artifacts:
    - path: "src/background/meta-bootstrap.ts"
      provides: "initializeMeta() — write-if-absent for sysins:meta (Recipe 4)"
      contains: "export async function initializeMeta"
    - path: "src/background/sync-state.ts"
      provides: "Read/write helpers for the 4 sysins:local:* resume keys"
      contains: "export async function readSyncStatus"
    - path: "src/background/index.ts"
      provides: "SW entrypoint — onInstalled handler + syncPending recovery + _resetForTesting seam"
      contains: "chrome.runtime.onInstalled.addListener"
    - path: "src/background/service-worker.test.ts"
      provides: "Tests for write-if-absent semantics + SW restart recovery"
      min_lines: 80
  key_links:
    - from: "src/background/meta-bootstrap.ts"
      to: "src/shared/constants.ts + types.ts"
      via: "import { META_KEY, SCHEMA_VERSION } / type { SyncMeta }"
      pattern: "import .* (META_KEY|SCHEMA_VERSION) .* from ['\"]\\.\\./shared/constants['\"]"
    - from: "src/background/index.ts"
      to: "src/background/meta-bootstrap.ts"
      via: "chrome.runtime.onInstalled → initializeMeta()"
      pattern: "initializeMeta\\(\\)"
    - from: "src/background/index.ts"
      to: "src/background/sync-state.ts"
      via: "ensureInitialized → recoverOrphanedSyncPending"
      pattern: "recoverOrphanedSyncPending|ensureInitialized"
---

<objective>
Wire the service worker entrypoint: register `chrome.runtime.onInstalled` to call `initializeMeta()` (write-if-absent per D-10 / Recipe 4), implement the `chrome.storage.local` resume schema writers (D-12 / D-13 / D-14 / D-15), add the SW-restart-recovery handler that detects orphaned `syncPending` sentinels (D-13 / Recipe 2), and ship the `_resetForTesting()` seam (Pattern S-4) so the FND-06 restart test can simulate worker kill/wake. Lands FND-04 (meta bootstrap) + FND-06 (resume schema persisted to local).

Purpose: This plan closes the Phase 1 service-worker contract. After this lands, Phase 2's `LS_CHANGED` listener and Phase 3's push engine plug into a fully-initialized SW with: (a) a guaranteed-present `sysins:meta` after `onInstalled`, (b) helper functions to read/write each resume-state key, and (c) a recovery pass at SW wake that clears stale `syncPending` sentinels.
Output: 4 source/test files. The SW entrypoint goes from the 3-line stub (Plan 01) to the full Phase 1 wiring.
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
@.planning/phases/01-foundation/01-02-SUMMARY.md
@src/shared/constants.ts
@src/shared/types.ts
@src/shared/meta-guard.ts
@src/background/index.ts

<interfaces>
<!-- Plan 01 produced (consumed by this plan): -->

From src/background/index.ts (Plan 01 stub — this plan REPLACES the body):
```typescript
import { defineBackground } from 'wxt/utils/define-background';
export default defineBackground(() => {
  // Phase 1 Plan 05 wires onInstalled -> initializeMeta() here.
});
```

<!-- Plan 02 produced (consumed by this plan): -->

From src/shared/constants.ts:
```typescript
export const META_KEY = 'sysins:meta';
export const LOCAL_KEY_PREFIX = 'sysins:local:';
export const SCHEMA_VERSION = 1;
export const PENDING_BATCH_TTL_MS = 60_000;
export const PENDING_MERGE_QUEUE_CAP = 10;
```

From src/shared/types.ts:
```typescript
export interface SyncMeta { schemaVersion: 1; lastPushAt: number; lastPullAt: number }
export interface SyncPendingSentinel { batchId: string; keys: string[]; startedAt: number }
export interface PendingMerge { changes: unknown; receivedAt: number }
export type LastPushedSnapshot = Record<string, LastPushedEntry>;
export interface SyncStatus { state: 'idle'|'syncing'|'error'; lastSyncAt: number; errorState?: ErrorState; errorDetail?: string }
export type ErrorState = '...' | 'PENDING_MERGE_OVERFLOW';
```

<!-- This plan is Wave 3. It declares depends_on: [02, 03] — -->
<!-- Plan 02 supplies the constants/types/meta-guard contracts it actually imports; -->
<!-- Plan 03 (storage-layout) is named as a conservative staging dep so this plan -->
<!-- runs after the storage-layout module has settled, even though it does NOT -->
<!-- import from registry.ts or storage-layout.ts. The wave-graph rule is satisfied -->
<!-- because max(wave_of_deps) + 1 = max(1, 2) + 1 = 3. -->

<!-- This plan ESTABLISHES these contracts for Phase 2-4: -->
```typescript
// src/background/meta-bootstrap.ts
export async function initializeMeta(): Promise<void>;

// src/background/sync-state.ts (the 4 resume-state helpers, D-12/D-13/D-14/D-15)
export async function readSyncStatus(): Promise<SyncStatus>;
export async function writeSyncStatus(status: SyncStatus): Promise<void>;
export async function setErrorState(tag: ErrorState, detail?: string): Promise<void>;
export async function readSyncPending(): Promise<SyncPendingSentinel | undefined>;
export async function clearSyncPending(): Promise<void>;
export async function readLastPushed(): Promise<LastPushedSnapshot>;
export async function readPendingMerges(): Promise<PendingMerge[]>;
export async function enqueuePendingMerge(merge: PendingMerge): Promise<void>;

// src/background/index.ts
export async function ensureInitialized(): Promise<void>; // SW-wake recovery (clears orphaned syncPending)
export function _resetForTesting(): void; // testing seam, @internal
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement meta-bootstrap.ts and sync-state.ts</name>
  <files>src/background/meta-bootstrap.ts, src/background/sync-state.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 4, lines 402-449) — meta-bootstrap pattern
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 6, lines 474-532) — sync-state schema, including pendingMerges cap behavior
    - .planning/phases/01-foundation/01-PATTERNS.md (lines 318-344) — meta-bootstrap copy-verbatim reference
    - .planning/phases/01-foundation/01-CONTEXT.md (D-10, D-12, D-13, D-14, D-15) — locked semantics
    - src/shared/constants.ts (Plan 02) — for META_KEY, LOCAL_KEY_PREFIX, SCHEMA_VERSION, PENDING_BATCH_TTL_MS, PENDING_MERGE_QUEUE_CAP
    - src/shared/types.ts (Plan 02) — for SyncMeta, SyncPendingSentinel, PendingMerge, SyncStatus, ErrorState, LastPushedSnapshot
  </read_first>
  <behavior>
    **meta-bootstrap.ts:**
    - `initializeMeta()`:
      1. Reads `chrome.storage.sync.get(META_KEY)`.
      2. If `result[META_KEY] === undefined`: writes `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}` via single `chrome.storage.sync.set({[META_KEY]: meta})`.
      3. Otherwise: returns without writing. Per D-10, this is a benign race even if another device set the same value.

    **sync-state.ts** — the 8 helpers:
    - `readSyncStatus()`: returns `chrome.storage.local`'s `sysins:local:syncStatus` or a default `{state:'idle', lastSyncAt:0}` if absent.
    - `writeSyncStatus(status)`: writes the status. Uses `exactOptionalPropertyTypes` discipline — if `status.errorState === undefined`, it MUST be omitted from the written object (not included as `errorState: undefined`).
    - `setErrorState(tag, detail?)`: convenience — reads current status, sets `state: 'error'`, `errorState: tag`, `errorDetail: detail`, writes back.
    - `readSyncPending()`: returns the sentinel or `undefined`.
    - `clearSyncPending()`: removes the key.
    - `readLastPushed()`: returns the snapshot or `{}`.
    - `readPendingMerges()`: returns the queue or `[]`.
    - `enqueuePendingMerge(merge)`: appends; if queue length > `PENDING_MERGE_QUEUE_CAP` (10), drops oldest and calls `setErrorState('PENDING_MERGE_OVERFLOW', 'dropped N oldest events')`.

    Resume-state key naming (constructed from `LOCAL_KEY_PREFIX = 'sysins:local:'`): `sysins:local:syncStatus`, `sysins:local:syncPending`, `sysins:local:lastPushed`, `sysins:local:pendingMerges`. These names are NOT yet in `constants.ts` (D-24 defines only the prefix). This plan adds them as named exports in sync-state.ts to keep them inspectable from one place.

    No reads/writes to `chrome.storage.sync` (other keys) from sync-state.ts — it ONLY touches `chrome.storage.local`. Discipline lock per CLAUDE.md hard rule 9.
  </behavior>
  <action>
    **1. Create `src/background/meta-bootstrap.ts`** copying Recipe 4 verbatim:
    ```typescript
    import { META_KEY, SCHEMA_VERSION } from '../shared/constants';
    import type { SyncMeta } from '../shared/types';

    /**
     * Bootstrap sysins:meta on chrome.runtime.onInstalled (D-10, Recipe 4).
     * Write-if-absent: another device may have already populated meta with
     * the identical value, in which case we leave it alone. Per D-10 the
     * race is benign (the value is identical).
     *
     * If a non-1 schemaVersion is already present, do NOT overwrite — the
     * meta-guard (Recipe 7) at the next sync entrypoint will refuse I/O and
     * surface SCHEMA_AHEAD or SCHEMA_UNKNOWN.
     */
    export async function initializeMeta(): Promise<void> {
      const existing = await chrome.storage.sync.get(META_KEY);
      if (existing[META_KEY] === undefined) {
        const meta: SyncMeta = {
          schemaVersion: SCHEMA_VERSION,
          lastPushAt: 0,
          lastPullAt: 0,
        };
        await chrome.storage.sync.set({ [META_KEY]: meta });
      }
      // else: leave existing in place. Schema-guard catches mismatches at next sync entry.
    }
    ```

    **2. Create `src/background/sync-state.ts`** with all 8 helpers + the 4 named-export resume keys:
    ```typescript
    import {
      LOCAL_KEY_PREFIX,
      PENDING_MERGE_QUEUE_CAP,
    } from '../shared/constants';
    import type {
      SyncStatus,
      SyncPendingSentinel,
      PendingMerge,
      LastPushedSnapshot,
      ErrorState,
    } from '../shared/types';

    // The four sysins:local:* resume keys (D-12, D-13, D-14, D-15).
    // Constructed from LOCAL_KEY_PREFIX so the namespace stays disciplined.
    export const SYNC_STATUS_KEY = `${LOCAL_KEY_PREFIX}syncStatus`;
    export const SYNC_PENDING_KEY = `${LOCAL_KEY_PREFIX}syncPending`;
    export const LAST_PUSHED_KEY = `${LOCAL_KEY_PREFIX}lastPushed`;
    export const PENDING_MERGES_KEY = `${LOCAL_KEY_PREFIX}pendingMerges`;

    const DEFAULT_STATUS: SyncStatus = { state: 'idle', lastSyncAt: 0 };

    // ---- syncStatus (D-15) ----------------------------------------------------

    export async function readSyncStatus(): Promise<SyncStatus> {
      const r = await chrome.storage.local.get(SYNC_STATUS_KEY);
      return (r[SYNC_STATUS_KEY] as SyncStatus | undefined) ?? DEFAULT_STATUS;
    }

    export async function writeSyncStatus(status: SyncStatus): Promise<void> {
      // Discipline: under exactOptionalPropertyTypes, never write errorState: undefined.
      // Build a clean object instead.
      const clean: SyncStatus = { state: status.state, lastSyncAt: status.lastSyncAt };
      if (status.errorState !== undefined) clean.errorState = status.errorState;
      if (status.errorDetail !== undefined) clean.errorDetail = status.errorDetail;
      await chrome.storage.local.set({ [SYNC_STATUS_KEY]: clean });
    }

    export async function setErrorState(tag: ErrorState, detail?: string): Promise<void> {
      const current = await readSyncStatus();
      const next: SyncStatus = {
        state: 'error',
        lastSyncAt: current.lastSyncAt,
        errorState: tag,
      };
      if (detail !== undefined) next.errorDetail = detail;
      await writeSyncStatus(next);
    }

    // ---- syncPending sentinel (D-13) ------------------------------------------

    export async function readSyncPending(): Promise<SyncPendingSentinel | undefined> {
      const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
      return r[SYNC_PENDING_KEY] as SyncPendingSentinel | undefined;
    }

    export async function clearSyncPending(): Promise<void> {
      await chrome.storage.local.remove(SYNC_PENDING_KEY);
    }

    // ---- lastPushed snapshot (D-12) -------------------------------------------

    export async function readLastPushed(): Promise<LastPushedSnapshot> {
      const r = await chrome.storage.local.get(LAST_PUSHED_KEY);
      return (r[LAST_PUSHED_KEY] as LastPushedSnapshot | undefined) ?? {};
    }

    // ---- pendingMerges queue (D-14) -------------------------------------------

    export async function readPendingMerges(): Promise<PendingMerge[]> {
      const r = await chrome.storage.local.get(PENDING_MERGES_KEY);
      return (r[PENDING_MERGES_KEY] as PendingMerge[] | undefined) ?? [];
    }

    /**
     * Append a pending merge. If the queue would exceed PENDING_MERGE_QUEUE_CAP
     * (10), drop the oldest entries and flag PENDING_MERGE_OVERFLOW in syncStatus
     * (D-14, OQ-1 widening).
     */
    export async function enqueuePendingMerge(merge: PendingMerge): Promise<void> {
      const queue = await readPendingMerges();
      queue.push(merge);
      if (queue.length > PENDING_MERGE_QUEUE_CAP) {
        const dropped = queue.length - PENDING_MERGE_QUEUE_CAP;
        queue.splice(0, dropped); // drop oldest
        await setErrorState('PENDING_MERGE_OVERFLOW', `dropped ${dropped} oldest events`);
      }
      await chrome.storage.local.set({ [PENDING_MERGES_KEY]: queue });
    }
    ```

    Decision lock: the four named exports `SYNC_STATUS_KEY` etc. are colocated with sync-state.ts (rather than being added to `src/shared/constants.ts`) because they are derived from `LOCAL_KEY_PREFIX` and only sync-state.ts consumes them in Phase 1. Phase 5's popup will read `SYNC_STATUS_KEY` — at that point we may move it to `constants.ts` or have the popup import from sync-state.ts. Either is fine. Phase 1 keeps the surface minimal.

    No `import type` for value-only consumers — `verbatimModuleSyntax: true` (Plan 01 tsconfig) enforces this; type-only imports must use `import type`. The implementation uses `import type { ... }` for `SyncStatus`, `SyncPendingSentinel`, etc., and regular `import` for `LOCAL_KEY_PREFIX`, `PENDING_MERGE_QUEUE_CAP`.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `src/background/meta-bootstrap.ts` exists
    - `src/background/meta-bootstrap.ts` imports `META_KEY` and `SCHEMA_VERSION` from `'../shared/constants'`
    - `src/background/meta-bootstrap.ts` imports type `SyncMeta` from `'../shared/types'` (using `import type`)
    - `src/background/meta-bootstrap.ts` exports async function `initializeMeta(): Promise&lt;void&gt;`
    - `src/background/meta-bootstrap.ts` calls `chrome.storage.sync.get(META_KEY)` BEFORE `chrome.storage.sync.set` (read-then-conditionally-set pattern, D-10)
    - `src/background/meta-bootstrap.ts` contains literal substring `existing[META_KEY] === undefined` (the gate condition)
    - File `src/background/sync-state.ts` exists
    - `src/background/sync-state.ts` imports `LOCAL_KEY_PREFIX` and `PENDING_MERGE_QUEUE_CAP` from `'../shared/constants'`
    - `src/background/sync-state.ts` exports `SYNC_STATUS_KEY`, `SYNC_PENDING_KEY`, `LAST_PUSHED_KEY`, `PENDING_MERGES_KEY` as named string constants
    - `src/background/sync-state.ts` exports async functions: `readSyncStatus`, `writeSyncStatus`, `setErrorState`, `readSyncPending`, `clearSyncPending`, `readLastPushed`, `readPendingMerges`, `enqueuePendingMerge`
    - `src/background/sync-state.ts` does NOT call `chrome.storage.sync.*` (touches only `chrome.storage.local` — CLAUDE.md hard rule 9 discipline)
    - `src/background/sync-state.ts` `enqueuePendingMerge` calls `setErrorState('PENDING_MERGE_OVERFLOW', ...)` when queue length exceeds `PENDING_MERGE_QUEUE_CAP`
    - Command `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Both files exist with the locked semantics. `initializeMeta` is read-then-conditionally-set. `sync-state.ts` provides typed helpers for all 4 resume keys. TypeScript compiles cleanly.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire SW entrypoint (index.ts) with onInstalled + ensureInitialized + _resetForTesting</name>
  <files>src/background/index.ts</files>
  <read_first>
    - src/background/index.ts (current 3-line Plan 01 stub) — to confirm what we're replacing
    - src/background/meta-bootstrap.ts (Task 1 output) — to import initializeMeta
    - src/background/sync-state.ts (Task 1 output) — to import readSyncPending, clearSyncPending, setErrorState
    - src/shared/constants.ts (Plan 02) — to import PENDING_BATCH_TTL_MS
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 4, lines 408-420) — onInstalled handler shape
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 2, lines 308-323) — _resetForTesting + ensureInitialized pattern for SW-restart simulation
    - .planning/phases/01-foundation/01-PATTERNS.md (lines 348-366, 543-549) — phase boundary discipline + S-4 pattern
    - .planning/phases/01-foundation/01-CONTEXT.md (D-13) — orphaned syncPending recovery rule (startedAt > 60s ago)
  </read_first>
  <behavior>
    - Module-level state: an `inMemoryState: { initialized: boolean }` object that is reset by `_resetForTesting()`.
    - `defineBackground` body registers `chrome.runtime.onInstalled.addListener(async () => { await initializeMeta(); await ensureInitialized(); })`.
    - `ensureInitialized()`:
      1. Idempotent: if `inMemoryState.initialized === true`, return immediately.
      2. Reads `sysins:local:syncPending` via `readSyncPending()`.
      3. If sentinel exists AND `Date.now() - sentinel.startedAt > PENDING_BATCH_TTL_MS` (60s, D-13): orphaned — clear it via `clearSyncPending()` and call `setErrorState('STRICT_VALIDATION_FAIL', 'orphaned sync-pending sentinel cleared on SW restart')`. Phase 3 may want a more specific error tag — for Phase 1, surfacing the recovery via the existing enum is sufficient. Actually: per RESEARCH line 530, `'PENDING_MERGE_OVERFLOW'` is the only widening we did to D-15; an orphaned syncPending is more of an info than an error. **Decision: do NOT call setErrorState on orphan recovery** — just clear the sentinel silently. Phase 3 may add a dedicated tag or recovery log. (See decision lock below.)
      4. Sets `inMemoryState.initialized = true`.
    - `_resetForTesting()`: sets `inMemoryState.initialized = false`. JSDoc-marked `@internal`.
    - Phase boundary discipline (PATTERNS.md line 366): NO `chrome.runtime.onMessage`, NO `chrome.storage.onChanged`, NO `chrome.alarms`, NO `chrome.tabs.sendMessage` listeners. Those are Phase 2/3/4. The file is intentionally tiny.
  </behavior>
  <action>
    Replace `src/background/index.ts` (the 3-line Plan 01 stub) with:
    ```typescript
    import { defineBackground } from 'wxt/utils/define-background';
    import { initializeMeta } from './meta-bootstrap';
    import {
      readSyncPending,
      clearSyncPending,
    } from './sync-state';
    import { PENDING_BATCH_TTL_MS } from '../shared/constants';

    /**
     * Module-level ephemeral state. Lost on real SW kill (which is the entire
     * reason FND-06 / D-12-D-15 mirror sync state to chrome.storage.local).
     * The `_resetForTesting` export simulates that loss for FND-06's restart test.
     */
    let inMemoryState: { initialized: boolean } = { initialized: false };

    /**
     * SW-wake recovery. Idempotent — safe to call from multiple entrypoints.
     *
     * Phase 1 responsibility:
     *   - Detect an orphaned `sysins:local:syncPending` sentinel (startedAt
     *     older than PENDING_BATCH_TTL_MS = 60s) and clear it (D-13).
     *
     * Phase 3+ extends this to:
     *   - Re-derive sync state from registry on orphan detected
     *   - Drain `sysins:local:pendingMerges` if non-empty
     *
     * Decision: orphan recovery does NOT call setErrorState — it's an expected
     * recovery path on SW restart, not a user-facing error. Phase 3 may add a
     * recovery-log surface if visibility is needed.
     */
    export async function ensureInitialized(): Promise<void> {
      if (inMemoryState.initialized) return;

      const pending = await readSyncPending();
      if (pending !== undefined) {
        const ageMs = Date.now() - pending.startedAt;
        if (ageMs > PENDING_BATCH_TTL_MS) {
          // Orphaned: another SW instance died mid-write more than 60s ago.
          // Clear the sentinel; Phase 3 will redrive any necessary push from
          // a fresh registry read.
          await clearSyncPending();
        }
        // else: a sibling SW instance may still be writing — back off.
        // Phase 3 will add the back-off retry; Phase 1 just observes.
      }

      inMemoryState.initialized = true;
    }

    /**
     * @internal Testing seam (Pattern S-4) — clears module-level state to
     * simulate a real service-worker kill. Tests call this before re-running
     * `ensureInitialized()` to verify FND-06's restart-resume contract.
     */
    export function _resetForTesting(): void {
      inMemoryState = { initialized: false };
    }

    export default defineBackground(() => {
      chrome.runtime.onInstalled.addListener(async () => {
        await initializeMeta();
        await ensureInitialized();
      });

      // Phase 1 boundary discipline:
      //   - No chrome.runtime.onMessage listener (Phase 2)
      //   - No chrome.storage.onChanged listener (Phase 3)
      //   - No chrome.alarms (Phase 3)
      //   - No chrome.tabs.sendMessage (Phase 4)
      // Adding these now would entangle scopes and break the phase boundary.
    });
    ```

    Decision lock on orphan recovery surfacing:
    - Plan 05 chose to clear the orphaned sentinel SILENTLY rather than call `setErrorState('STRICT_VALIDATION_FAIL', ...)` or similar.
    - Rationale: an orphaned sentinel is an EXPECTED recovery path on SW restart (the SW was killed mid-write through no fault of the user). It's not an error in the user-visible sense. Surfacing it as a red badge would be noisy.
    - Phase 3 may add a dedicated `errorState` tag (e.g. `'ORPHAN_RECOVERED'`) if visibility is needed for debugging — that's a D-15 widening like OQ-1. Document the choice in this plan's SUMMARY.

    Phase boundary lock per PATTERNS.md line 366: this file ends at the `defineBackground` body. No additional listeners. Phase 2's plan will RE-OPEN this file and add `chrome.runtime.onMessage`; Phase 3 adds `chrome.storage.onChanged` and `chrome.alarms`; Phase 4 adds the rest. Phase 1 STOPS HERE.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `src/background/index.ts` exists and is non-empty (REPLACES the Plan 01 stub)
    - `src/background/index.ts` imports `defineBackground` from `'wxt/utils/define-background'`
    - `src/background/index.ts` imports `initializeMeta` from `'./meta-bootstrap'`
    - `src/background/index.ts` imports `readSyncPending` and `clearSyncPending` from `'./sync-state'`
    - `src/background/index.ts` imports `PENDING_BATCH_TTL_MS` from `'../shared/constants'`
    - `src/background/index.ts` exports async function `ensureInitialized()` (named export, not default)
    - `src/background/index.ts` exports function `_resetForTesting()` (named export)
    - `src/background/index.ts` `defineBackground` body contains `chrome.runtime.onInstalled.addListener`
    - `src/background/index.ts` `onInstalled` handler calls `initializeMeta()` AND `ensureInitialized()`
    - `src/background/index.ts` `ensureInitialized` body checks `Date.now() - pending.startedAt > PENDING_BATCH_TTL_MS` (D-13 orphan detection)
    - `src/background/index.ts` does NOT contain `chrome.runtime.onMessage` (Phase 2 boundary)
    - `src/background/index.ts` does NOT contain `chrome.storage.onChanged` (Phase 3 boundary)
    - `src/background/index.ts` does NOT contain `chrome.alarms` (Phase 3 boundary)
    - `src/background/index.ts` does NOT contain `chrome.tabs.sendMessage` (Phase 4 boundary)
    - Command `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    `src/background/index.ts` wires `onInstalled` → `initializeMeta` + `ensureInitialized`. The orphan-recovery branch fires when `syncPending.startedAt` is older than 60s. The `_resetForTesting` seam exists. Phase 1 boundary discipline is preserved (no extra listeners).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Write service-worker.test.ts covering FND-04 + FND-06</name>
  <files>src/background/service-worker.test.ts</files>
  <read_first>
    - src/background/index.ts (Task 2 output) — to import ensureInitialized + _resetForTesting
    - src/background/meta-bootstrap.ts (Task 1 output) — to invoke initializeMeta directly in tests
    - src/background/sync-state.ts (Task 1 output) — to use SYNC_PENDING_KEY for test fixtures
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 2, lines 311-352) — SW-restart simulation pattern, including the warning against vi.resetModules()
    - .planning/phases/01-foundation/01-CONTEXT.md (D-25) — required test list ("schema-version mismatch refusal; SW restart simulation that verifies sysins:local:syncPending recovery is correct")
    - src/shared/constants.ts (Plan 02) — PENDING_BATCH_TTL_MS, META_KEY
  </read_first>
  <behavior>
    Tests (one `it()` each, minimum 6):
    1. **`initializeMeta` writes meta on first install (FND-04)**: starting from empty fakeBrowser, call `initializeMeta()`. Assert `chrome.storage.sync.get(META_KEY)` returns `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}`.
    2. **`initializeMeta` does NOT overwrite existing meta (D-10 write-if-absent)**: pre-populate `sysins:meta` with `{schemaVersion: 1, lastPushAt: 12345, lastPullAt: 67890}`. Call `initializeMeta()`. Assert the stored value is UNCHANGED (`lastPushAt: 12345`, NOT 0).
    3. **`initializeMeta` does NOT overwrite ahead-version meta**: pre-populate with `{schemaVersion: 2, ...}`. Call `initializeMeta()`. Assert stored `schemaVersion` is still 2 (we don't downgrade — schema-guard handles it at next read).
    4. **Orphaned syncPending is cleared on SW restart (FND-06, D-13, Recipe 2)**: pre-populate `sysins:local:syncPending` with `{batchId: 'b1', keys: [...], startedAt: Date.now() - 90_000}` (90s ago > 60s TTL). Call `_resetForTesting()` then `ensureInitialized()`. Assert `chrome.storage.local.get(SYNC_PENDING_KEY)` is now `undefined` (cleared).
    5. **Recent syncPending is NOT cleared (D-13 not-orphaned)**: pre-populate with `startedAt: Date.now() - 5_000` (5s ago, well within TTL). Call `_resetForTesting()` then `ensureInitialized()`. Assert the sentinel is STILL present.
    6. **`ensureInitialized` is idempotent**: call it twice; the second call is a no-op (does not re-read syncPending). Verify by setting up an orphaned sentinel, calling `ensureInitialized()` once (clears it), then setting up a NEW orphaned sentinel, calling `ensureInitialized()` again — the second call should NOT clear the new sentinel because the in-memory `initialized` flag is true. (This is the "idempotent within a SW lifetime" contract.)
    7. **`_resetForTesting` re-arms the orphan check**: continuing from #6 — call `_resetForTesting()`, set up an orphaned sentinel, call `ensureInitialized()`. The orphan IS cleared (because reset re-armed the in-memory flag).
    8. **`enqueuePendingMerge` flips to overflow at queue length 11 (D-14, OQ-1)**: pre-populate `sysins:local:pendingMerges` with 10 entries. Call `enqueuePendingMerge({changes: 'x', receivedAt: Date.now()})`. Assert (a) queue length is 10 (oldest dropped), (b) `readSyncStatus()` returns `state: 'error', errorState: 'PENDING_MERGE_OVERFLOW'`.
  </behavior>
  <action>
    Create `src/background/service-worker.test.ts` covering all 8 cases:
    ```typescript
    import { describe, it, expect, beforeEach } from 'vitest';
    import { fakeBrowser } from 'wxt/testing/fake-browser';
    import { initializeMeta } from './meta-bootstrap';
    import { ensureInitialized, _resetForTesting } from './index';
    import {
      readSyncStatus,
      enqueuePendingMerge,
      SYNC_PENDING_KEY,
      PENDING_MERGES_KEY,
    } from './sync-state';
    import { META_KEY, PENDING_MERGE_QUEUE_CAP } from '../shared/constants';
    import type { SyncMeta, SyncPendingSentinel, PendingMerge } from '../shared/types';

    beforeEach(() => {
      fakeBrowser.reset();
      _resetForTesting();
    });

    describe('initializeMeta (FND-04, D-10 write-if-absent)', () => {
      it('writes default meta on first install when sysins:meta is absent', async () => {
        await initializeMeta();

        const r = await chrome.storage.sync.get(META_KEY);
        const meta = r[META_KEY] as SyncMeta;
        expect(meta).toEqual({ schemaVersion: 1, lastPushAt: 0, lastPullAt: 0 });
      });

      it('does NOT overwrite existing meta with non-default lastPushAt', async () => {
        const preExisting: SyncMeta = { schemaVersion: 1, lastPushAt: 12345, lastPullAt: 67890 };
        await chrome.storage.sync.set({ [META_KEY]: preExisting });

        await initializeMeta();

        const r = await chrome.storage.sync.get(META_KEY);
        expect(r[META_KEY]).toEqual(preExisting); // unchanged — D-10
      });

      it('does NOT overwrite an ahead-version meta (schemaVersion: 2)', async () => {
        const ahead = { schemaVersion: 2, lastPushAt: 0, lastPullAt: 0 };
        await chrome.storage.sync.set({ [META_KEY]: ahead });

        await initializeMeta();

        const r = await chrome.storage.sync.get(META_KEY);
        expect(r[META_KEY]).toEqual(ahead); // unchanged — schema-guard handles at next read
      });
    });

    describe('ensureInitialized (FND-06, D-13 orphan recovery)', () => {
      it('clears an orphaned syncPending sentinel (startedAt > 60s ago)', async () => {
        const sentinel: SyncPendingSentinel = {
          batchId: 'orphan-1',
          keys: ['sysins:body:abc:c0'],
          startedAt: Date.now() - 90_000, // 90s ago — orphaned
        };
        await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

        await ensureInitialized();

        const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
        expect(r[SYNC_PENDING_KEY]).toBeUndefined();
      });

      it('does NOT clear a recent syncPending sentinel (startedAt within TTL)', async () => {
        const sentinel: SyncPendingSentinel = {
          batchId: 'recent-1',
          keys: ['sysins:body:abc:c0'],
          startedAt: Date.now() - 5_000, // 5s ago — still in flight
        };
        await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

        await ensureInitialized();

        const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
        expect(r[SYNC_PENDING_KEY]).toEqual(sentinel); // preserved
      });

      it('is idempotent within a SW lifetime — second call is a no-op', async () => {
        // First call: clears nothing (no sentinel)
        await ensureInitialized();

        // Now plant an orphaned sentinel
        const sentinel: SyncPendingSentinel = {
          batchId: 'planted-after',
          keys: [],
          startedAt: Date.now() - 90_000,
        };
        await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

        // Second call: no-op because inMemoryState.initialized === true
        await ensureInitialized();

        const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
        expect(r[SYNC_PENDING_KEY]).toEqual(sentinel); // NOT cleared
      });

      it('_resetForTesting re-arms the orphan check (simulates real SW kill+wake)', async () => {
        await ensureInitialized();

        // Plant an orphan after first init
        const sentinel: SyncPendingSentinel = {
          batchId: 'after-reset',
          keys: [],
          startedAt: Date.now() - 90_000,
        };
        await chrome.storage.local.set({ [SYNC_PENDING_KEY]: sentinel });

        // Simulate SW kill+wake
        _resetForTesting();
        await ensureInitialized();

        const r = await chrome.storage.local.get(SYNC_PENDING_KEY);
        expect(r[SYNC_PENDING_KEY]).toBeUndefined(); // cleared after reset+re-init
      });
    });

    describe('enqueuePendingMerge cap enforcement (D-14, OQ-1)', () => {
      it('drops oldest and flags PENDING_MERGE_OVERFLOW when queue exceeds cap', async () => {
        // Pre-populate with PENDING_MERGE_QUEUE_CAP (10) entries
        const initial: PendingMerge[] = Array.from({ length: PENDING_MERGE_QUEUE_CAP }, (_, i) => ({
          changes: `event-${i}`,
          receivedAt: i,
        }));
        await chrome.storage.local.set({ [PENDING_MERGES_KEY]: initial });

        // Add the 11th — should drop oldest (event-0)
        await enqueuePendingMerge({ changes: 'event-new', receivedAt: 1000 });

        const r = await chrome.storage.local.get(PENDING_MERGES_KEY);
        const queue = r[PENDING_MERGES_KEY] as PendingMerge[];
        expect(queue).toHaveLength(PENDING_MERGE_QUEUE_CAP);
        expect(queue[0]?.changes).toBe('event-1'); // oldest dropped
        expect(queue[queue.length - 1]?.changes).toBe('event-new');

        const status = await readSyncStatus();
        expect(status.state).toBe('error');
        expect(status.errorState).toBe('PENDING_MERGE_OVERFLOW');
        expect(status.errorDetail).toMatch(/dropped 1/);
      });
    });
    ```

    Test count: 8 `it()` calls (above 6 minimum). All cover D-25's "schema-version mismatch refusal" (via the D-10 idempotency test — refusal is the meta-guard's job, but D-10 testing here proves the bootstrap doesn't accidentally reset a v2 meta) and "SW restart simulation that verifies sysins:local:syncPending recovery is correct" (cases 4, 5, 6, 7).

    Note on D-25 "schema-version mismatch refusal": that's primarily Plan 02's `meta-guard.test.ts` (covered there). Plan 05's responsibility is the COMPLEMENTARY contract — that the bootstrap doesn't OVERWRITE a mismatched meta. Test case 3 covers that.

    The `_resetForTesting()` call in `beforeEach` (combined with `fakeBrowser.reset()`) ensures every test starts with a fresh in-memory state and empty storage.
  </action>
  <verify>
    <automated>npx vitest run src/background/service-worker.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `src/background/service-worker.test.ts` exists
    - `src/background/service-worker.test.ts` imports `fakeBrowser` from `'wxt/testing/fake-browser'`
    - `src/background/service-worker.test.ts` imports `initializeMeta` from `'./meta-bootstrap'`
    - `src/background/service-worker.test.ts` imports `ensureInitialized` and `_resetForTesting` from `'./index'`
    - `src/background/service-worker.test.ts` calls `fakeBrowser.reset()` AND `_resetForTesting()` in `beforeEach`
    - `src/background/service-worker.test.ts` contains at least 6 `it(...)` calls
    - `src/background/service-worker.test.ts` contains test descriptions matching: `/first install/i`, `/overwrite/i`, `/orphan/i`, `/idempotent/i`, `/PENDING_MERGE_OVERFLOW/`
    - `src/background/service-worker.test.ts` contains literal substring `Date.now() - 90_000` (orphaned-sentinel age — 90s > 60s TTL)
    - `src/background/service-worker.test.ts` contains literal substring `Date.now() - 5_000` (recent-sentinel age — 5s < TTL)
    - `src/background/service-worker.test.ts` does NOT call `vi.resetModules()` (RESEARCH line 348 anti-pattern — use `_resetForTesting` instead)
    - Command `npx vitest run src/background/service-worker.test.ts` exits 0
    - Test output reports `Tests 8 passed` (or higher; minimum 6)
  </acceptance_criteria>
  <done>
    `service-worker.test.ts` covers FND-04 (write-if-absent) and FND-06 (orphan recovery + restart resume). All 8 tests pass. The `_resetForTesting` seam is the canonical SW-restart-simulation pattern for Phase 2/3/4 to inherit.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `chrome.runtime.onInstalled` event source → SW handler | The browser fires this event with limited spoofability inside an extension context. Per Recipe 4, multiple devices may race here (benign per D-10). |
| `chrome.storage.local` (resume-state mirror) | Survives SW restart but is per-device. Could be tampered with via DevTools by the user, but we trust the user — the threat model is sync-state-correctness, not adversarial-user. |
| In-memory `inMemoryState.initialized` flag | Lost on every SW kill (CLAUDE.md hard rule 9). Re-derived from `chrome.storage.local` state at next wake. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-19 | T (Tampering) | Concurrent `initializeMeta` from two devices racing | accept | Per D-10, the value `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}` is identical, so last-write-wins on this key produces the same state. The 2-step read-then-set is non-atomic but benign (Recipe 4 line 442). |
| T-01-20 | E (Elevation of Privilege) | A pre-existing `sysins:meta` with `schemaVersion: 2` from a future client | mitigate | `initializeMeta` does NOT overwrite. The meta-guard (Plan 02) refuses I/O at the next sync entrypoint with `SCHEMA_AHEAD`. Test 3 verifies bootstrap leaves the v2 meta in place. |
| T-01-21 | D (Denial of Service) | Stuck `sysins:local:syncPending` sentinel from a crashed SW | mitigate | `ensureInitialized` clears sentinels older than `PENDING_BATCH_TTL_MS` (60s). Test 4 verifies. |
| T-01-22 | T (Tampering) | A non-orphan sentinel cleared incorrectly | mitigate | Test 5 verifies a 5s-old sentinel is preserved. The 60s TTL is a deliberate safety margin per D-13. |
| T-01-23 | I (Information Disclosure) | `sync-state.ts` writing `errorState: undefined` (the exactOptionalPropertyTypes anti-pattern) | mitigate | `writeSyncStatus` builds a clean object: `if (status.errorState !== undefined) clean.errorState = status.errorState`. Prevents accidental "errorState=undefined" writes that look identical to no-error in DevTools (RESEARCH line 783). |
| T-01-24 | D (Denial of Service) | Unbounded `pendingMerges` queue growing past memory bounds | mitigate | `enqueuePendingMerge` caps at 10 (D-14 / OQ-1). Test 8 verifies. The overflow is surfaced as `PENDING_MERGE_OVERFLOW` so flapping syncs are visible (Phase 5 popup will show the red badge). |
</threat_model>

<verification>
1. `npx tsc --noEmit` passes — all files compile.
2. `npx vitest run src/background/service-worker.test.ts` exits 0 with all 8 tests passing.
3. `chrome.storage.sync.get(META_KEY)` after the onInstalled handler returns `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}` (FND-04).
4. `sysins:local:syncPending` orphans (>60s) are cleared on SW init (FND-06 / D-13).
5. The SW entrypoint does NOT contain Phase 2/3/4 listeners (`onMessage`, `onChanged`, `alarms`, `tabs.sendMessage`) — phase boundary preserved.
</verification>

<success_criteria>
- ROADMAP success criterion #4 (FND-04): `sysins:meta` (with `schemaVersion: 1`) is written on `onInstalled`, only-if-absent. All keys are `sysins:*`. Verified by tests 1, 2, 3.
- ROADMAP success criterion #5 (FND-06): all sync state required to resume after SW kill is persisted in `chrome.storage.local`; restart simulation passes. The `_resetForTesting` + orphan-recovery test (4, 7) proves it.
- The phase-boundary discipline is documented and tested — Phase 2 plans will know to add `onMessage` to this file, not in a new SW entrypoint.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-05-SUMMARY.md` documenting:
- Final exported function signatures from `meta-bootstrap.ts`, `sync-state.ts`, `index.ts`
- Decision log: orphan recovery is silent (no setErrorState) — Phase 3 may extend
- Decision log: the 4 `sysins:local:*` key constants are colocated in sync-state.ts (not constants.ts) — may move in Phase 5 when popup consumes
- Total passing tests in `service-worker.test.ts` and which D-25 cases each covers
- The `_resetForTesting()` testing seam pattern (S-4) is now the canonical SW-restart-simulation pattern — Phase 2/3/4 plans should re-export `_resetForTesting` from any module that holds in-memory state
</output>
</output>

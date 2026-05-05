---
phase: 01-foundation
reviewed: 2026-05-05T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - src/background/hash.ts
  - src/background/index.ts
  - src/background/meta-bootstrap.ts
  - src/background/registry.ts
  - src/background/registry.test.ts
  - src/background/service-worker.test.ts
  - src/background/storage-layout.ts
  - src/background/storage-layout.test.ts
  - src/background/sync-state.ts
  - src/build.test.ts
  - src/dist-04.test.ts
  - src/shared/constants.ts
  - src/shared/meta-guard.ts
  - src/shared/meta-guard.test.ts
  - src/shared/types.ts
  - wxt.config.ts
  - tsconfig.json
  - vitest.config.ts
  - eslint.config.mjs
  - package.json
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-05T00:00:00Z
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

All 19 source files were reviewed. The foundation layer is well-structured: constants are centralized, types are precise (literal `schemaVersion: 1`, `exactOptionalPropertyTypes`), the chunking algorithm correctly handles surrogate pairs, and the tombstone merge logic aligns with the D-06/D-18 spec. Test coverage is thorough and the fakeBrowser pattern is applied consistently.

Four warnings were found, all in `src/background/registry.ts` and `src/background/sync-state.ts`. Two are direct violations of CLAUDE.md hard rules (batched writes and key naming discipline). Two are correctness hazards around non-atomic multi-step storage sequences that could leave orphaned state on mid-operation failure.

No security vulnerabilities, hardcoded secrets, or DIST-04 violations were found.

---

## Warnings

### WR-01: `updateItem` splits stale-chunk removal into a separate `remove()` call, violating the single-batched-write rule

**File:** `src/background/registry.ts:102-108`

**Issue:** CLAUDE.md hard rule 3 states "every `chrome.storage.sync` write is a single batched `set({...})`". In `updateItem`, when the text shrinks and old chunks need pruning, the code issues `chrome.storage.sync.remove(stale)` on line 102 and then `chrome.storage.sync.set(writes)` on line 108 — two separate sync operations. Beyond the rule violation, this creates a non-atomic sequence: if the service worker is killed between the `remove` and the `set`, the registry still records the old chunk count but the stale chunk keys are already gone, leaving a corrupt body (missing chunks that the registry count still references for a moment) or quota waste. Additionally, each call against `chrome.storage.sync` counts independently toward the 120 ops/min limit.

**Fix:** `chrome.storage.sync.remove` has no equivalent in `set`. The correct pattern is to write the new chunks and the updated registry in one `set`, and separately accept that stale keys will be orphaned until a GC pass — or use a two-phase approach where the registry is written first (with the new chunk count) before the old chunks are removed, so any failure leaves a consistent count:

```typescript
// Phase 1 safe approach: write registry + new body chunks atomically first,
// then remove stale chunks in a follow-up (orphaned stale chunks are inert
// once registry.chunks is updated to the new count — reconstructInstructions
// only reads up to registry.chunks keys).
writes[REGISTRY_KEY] = nextRegistry;
await chrome.storage.sync.set(writes); // atomic: new chunks + new registry count

// Non-atomic cleanup: safe because stale keys are unreachable post-set
if (existing.chunks > chunkStrings.length) {
  const stale: string[] = [];
  for (let i = chunkStrings.length; i < existing.chunks; i++) {
    stale.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
  }
  await chrome.storage.sync.remove(stale); // quota reclaim only, not correctness-critical
}
```

This makes the `set` the sole correctness-critical write. The `remove` becomes a quota-reclaim best-effort step that can fail without corrupting state (since `reconstructInstructions` reads exactly `registry.chunks` keys).

---

### WR-02: `updateItem` remove-before-set ordering risks body corruption on mid-sequence failure

**File:** `src/background/registry.ts:97-108`

**Issue:** The current execution order is: (1) `remove(stale)` at line 102, then (2) `set(writes)` at line 108. If the service worker is killed after step 1 but before step 2, the registry still contains the old `chunks` count but those chunk keys have been deleted. When the SW wakes, `reconstructInstructions` will call `chrome.storage.sync.get(bodyKeys(uuid, oldChunks))` and receive `undefined` for the removed keys, which `joinChunks` will reassemble as an empty-string gap, producing a silently corrupt body read (partial text with missing segments substituted by `''`).

Note: this is a distinct concern from WR-01. Even if the batched-write rule is addressed, the remove must happen **after** the registry is committed with the new chunk count, not before. The fix in WR-01 also resolves this issue: write the updated registry first, then remove stale keys.

**Fix:** See WR-01. Reorder to `set` (registry + new chunks) first, `remove` (stale) second.

---

### WR-03: Storage key constants for `sysins:local:*` are constructed inline in `sync-state.ts` rather than declared in `constants.ts`

**File:** `src/background/sync-state.ts:15-18`

**Issue:** CLAUDE.md hard rule states "Storage keys only from `constants.ts` (never inline strings)". The four keys `SYNC_STATUS_KEY`, `SYNC_PENDING_KEY`, `LAST_PUSHED_KEY`, and `PENDING_MERGES_KEY` are assembled at module level in `sync-state.ts` via template literal interpolation of `LOCAL_KEY_PREFIX`:

```typescript
export const SYNC_STATUS_KEY = `${LOCAL_KEY_PREFIX}syncStatus`;
export const SYNC_PENDING_KEY = `${LOCAL_KEY_PREFIX}syncPending`;
export const LAST_PUSHED_KEY  = `${LOCAL_KEY_PREFIX}lastPushed`;
export const PENDING_MERGES_KEY = `${LOCAL_KEY_PREFIX}pendingMerges`;
```

These are runtime-constructed strings that live outside `constants.ts`. Any typo in the suffix (`syncStatus`, `syncPending`, etc.) would produce a silently wrong key with no compile-time detection. They are also not visible to the future CLAUDE.md-mandated key audit in `constants.ts`.

**Fix:** Move the four constants — fully-resolved string literals — to `src/shared/constants.ts` and import them in `sync-state.ts`:

```typescript
// In src/shared/constants.ts:
export const SYNC_STATUS_KEY    = 'sysins:local:syncStatus';
export const SYNC_PENDING_KEY   = 'sysins:local:syncPending';
export const LAST_PUSHED_KEY    = 'sysins:local:lastPushed';
export const PENDING_MERGES_KEY = 'sysins:local:pendingMerges';

// In src/background/sync-state.ts — remove the local declarations and import instead:
import {
  LOCAL_KEY_PREFIX,
  PENDING_MERGE_QUEUE_CAP,
  SYNC_STATUS_KEY,
  SYNC_PENDING_KEY,
  LAST_PUSHED_KEY,
  PENDING_MERGES_KEY,
} from '../shared/constants';
```

---

### WR-04: `applyRemote` always writes the merged registry even when nothing changed, consuming rate-limit budget unnecessarily

**File:** `src/background/registry.ts:183`

**Issue:** `applyRemote` always ends with `chrome.storage.sync.set({ [REGISTRY_KEY]: merged })` regardless of whether the merged result differs from the local registry. When the remote snapshot is a subset of or identical to local state, every call still consumes one write operation against the 120/min, 1800/hr `chrome.storage.sync` rate limit. In Phase 3 this function will be called on every `chrome.storage.onChanged` event, making the unconditional write a rate-limit amplifier.

**Fix:** Compare the merged registry to the local registry before writing. A shallow JSON comparison is sufficient because registry values are plain objects:

```typescript
const localJson = JSON.stringify(local);
const mergedJson = JSON.stringify(merged);
if (mergedJson !== localJson) {
  await chrome.storage.sync.set({ [REGISTRY_KEY]: merged });
}
```

Alternatively, track a boolean `changed` flag inside the merge loop and skip the write if it never becomes `true`. The flag approach avoids the double serialization cost:

```typescript
let changed = false;
for (const [uuid, remoteRec] of Object.entries(remote)) {
  // ... existing merge logic ...
  // set changed = true whenever merged[uuid] is assigned remoteRec
}
if (changed) {
  await chrome.storage.sync.set({ [REGISTRY_KEY]: merged });
}
```

---

## Info

### IN-01: `deleteItem` body-key removal happens after the tombstone registry write — a failure leaves orphaned body chunks consuming sync quota

**File:** `src/background/registry.ts:129-135`

**Issue:** The delete sequence is: (1) write the tombstone registry entry at line 129, then (2) remove body keys at lines 133-135. If the service worker dies after step 1 but before step 2, the tombstone is durable but the body keys remain in `chrome.storage.sync`, consuming quota permanently until tombstone GC (planned for Phase 4). This is the mirror of WR-01/WR-02 but in the correct direction for correctness: the tombstone is committed first (good), and the orphaned body keys are inert (they will never be read once `registry.chunks === 0`). The quota leak is the only consequence.

This is acceptable as a Phase 1 design trade-off (Phase 4 GC is planned), but it should be documented as a known gap so Phase 3's rate-limit accounting doesn't assume these quota bytes are always reclaimed.

**Suggestion:** Add an inline comment at line 131 noting that this cleanup is best-effort and that an orphaned body left by SW kill between step 1 and step 2 will be recovered by Phase 4's tombstone GC TTL sweep.

---

### IN-02: `build.test.ts` uses `execSync('npx wxt build')` in `beforeAll` — a broken build environment will produce an opaque test failure rather than a clear build error

**File:** `src/build.test.ts:29-33`

**Issue:** If `wxt build` fails (e.g., TypeScript compile error, missing dependency), `execSync` throws synchronously inside `beforeAll`. Vitest will surface this as a setup error rather than a clean build failure message. The 120-second timeout is long enough that CI pipelines may appear hung.

**Suggestion:** Wrap the `execSync` in a try/catch and re-throw with a message that includes the build output, or use `execSync(..., { stdio: 'pipe' })` and attach stdout/stderr to the thrown error. This is a test ergonomics improvement, not a correctness issue.

---

_Reviewed: 2026-05-05T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

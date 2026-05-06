---
phase: 03-push-engine
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/background/alarm-flush.test.ts
  - src/background/alarm-flush.ts
  - src/background/index.ts
  - src/background/message-handler.test.ts
  - src/background/message-handler.ts
  - src/background/push-engine.test.ts
  - src/background/push-engine.ts
  - src/build.test.ts
  - src/shared/constants.ts
  - wxt.config.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 3 delivers the push engine: diff-and-accumulate logic, debounced alarm flush, and the service-worker wiring. The architecture is sound and faithfully implements the hard rules from CLAUDE.md (single-batch sync writes, no setTimeout debounce, empty-payload guard, pendingWrite persistence across SW kill). No critical issues were found. The four warnings are real logic bugs or error-handling gaps that could cause incorrect behavior at runtime; the three info items are minor quality concerns.

## Warnings

### WR-01: `removeStaleBodyKeys` runs before the new registry is written, but uses the OLD sync registry — can miss stale keys when pendingWrite was already queued

**File:** `src/background/alarm-flush.ts:111-131`

**Issue:** `removeStaleBodyKeys` compares the incoming `batch[REGISTRY_KEY]` (new registry) against `chrome.storage.sync.get(REGISTRY_KEY)` (last committed state). However, `diffAndAccumulate` accumulates changes into a `pendingWrite` that may have been written in a prior burst — the "old" registry in sync may already have been superseded by a pending registry that was never flushed (e.g., after a SW kill mid-flush). When the pending registry has `chunks: 2` for a UUID but sync still shows `chunks: 3`, the stale chunk `c2` will not be caught by this comparison, leaving a ghost chunk in `chrome.storage.sync`.

In practice the gap is narrow (it requires a flush that wrote more chunks than the one being flushed now AND a mid-flush SW kill), but it violates the correctness goal of T-03-03-e and can produce reassembly corruption on the pull side.

**Fix:** Pass the base registry from `existingPending` (the pending batch's own registry) as the "old" comparison baseline when it is available, falling back to the sync registry when no pending batch existed:

```typescript
async function removeStaleBodyKeys(
  batch: Record<string, unknown>,
  priorPendingRegistry?: SyncRegistry,
): Promise<void> {
  const registry = batch[REGISTRY_KEY] as SyncRegistry | undefined;
  if (registry === undefined) return;

  // Prefer the prior pending registry as the authoritative "before" state,
  // because it may have a higher chunk count than what sync last committed.
  let oldRegistry: SyncRegistry;
  if (priorPendingRegistry !== undefined) {
    oldRegistry = priorPendingRegistry;
  } else {
    const r = await chrome.storage.sync.get(REGISTRY_KEY);
    oldRegistry = (r[REGISTRY_KEY] as SyncRegistry | undefined) ?? {};
  }
  // ... rest unchanged
}
```

---

### WR-02: Silent error swallowing in `handleLsChanged` hides bugs in `diffAndAccumulate` and breaks the serialization queue invariant

**File:** `src/background/message-handler.ts:25-26`

**Issue:** The serialization queue uses `.catch(() => {/* swallow */})` to keep the queue alive on error. This means any thrown error from `diffAndAccumulate` is silently dropped — it will never surface to the SW badge, never update syncStatus to `'error'`, and never appear in devtools unless the developer has already been watching. More importantly, `diffQueue` is reassigned to the resolved `.catch()` promise BEFORE `await diffQueue` is reached, so a subsequent `scheduleFlush()` call may fire for a payload that was never actually processed. The comment "swallow to keep queue alive" describes the mechanism but not the trade-off.

The real risk: if `diffAndAccumulate` throws on item N (e.g., an unhandled rejection from `chrome.storage.sync.get`), item N's tombstones are never written, but the alarm flush still fires for the state written by item N-1.

**Fix:** Log the error and set an error badge rather than swallowing silently:

```typescript
diffQueue = diffQueue
  .then(() => diffAndAccumulate(payload))
  .catch((err) => {
    console.error('[sysins] diffAndAccumulate failed:', err);
    // Propagate badge error so the user sees an amber state
    void chrome.action.setBadgeText({ text: '!' });
    void chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
  });
```

Also conditionally skip `scheduleFlush()` when the queue threw:

```typescript
// Track whether the last queue item resolved cleanly
let lastDiffOk = true;
diffQueue = diffQueue
  .then(() => diffAndAccumulate(payload))
  .then(() => { lastDiffOk = true; })
  .catch((err) => { lastDiffOk = false; /* log + badge */ });
await diffQueue;
if (payload.length > 0 && lastDiffOk) {
  scheduleFlush();
}
```

---

### WR-03: `flushPendingWrite` sets syncStatus to `{ state: 'syncing', lastSyncAt: 0 }` before the write, overwriting a non-zero `lastSyncAt` on retry

**File:** `src/background/alarm-flush.ts:156`

**Issue:** On the success path (Case 4), `writeSyncStatus({ state: 'idle', lastSyncAt: now })` correctly stamps the time. But if a previous flush succeeded (setting `lastSyncAt = T`), and a later flush is retried after a rate-limit, the next flush entry sets `lastSyncAt: 0` while `state: 'syncing'`. If the popup reads syncStatus during the `syncing` window it sees `lastSyncAt = 0`, erasing the knowledge that a successful sync happened at time T. The popup UI planned for Phase 5 depends on `lastSyncAt` to show "Last synced X minutes ago".

**Fix:** Read the existing syncStatus and preserve its `lastSyncAt` when transitioning to `'syncing'`:

```typescript
const current = await readSyncStatus();
await writeSyncStatus({ state: 'syncing', lastSyncAt: current.lastSyncAt });
```

---

### WR-04: `diffAndAccumulate` computes hashes for every item even when the item is unchanged, then discards the result — but the `unchanged` check can produce a false negative when `lastPushed` is populated but the pending registry disagrees

**File:** `src/background/push-engine.ts:116-133`

**Issue:** `lastPushed` is keyed by UUID from the last successful flush. `baseRegistry` may be the `pendingRegistry` (from a prior `diffAndAccumulate` call that was not yet flushed). When `baseRegistry` is the pending registry, `existingUuid = titleToUuid.get(item.title)` resolves to a UUID that was assigned by the previous burst — which is correct. However, `pushed = lastPushed[uuid]` then looks up that UUID in `lastPushed`. If the UUID was assigned in the current burst (i.e., it is new since the last flush), `pushed` is `undefined`, and `unchanged` is always `false` — this is correct and expected.

The real bug is the inverse: if the existing pending registry has a modified record for a UUID (e.g., `updatedAt` was bumped by an earlier burst call in the same alarm window), and the new payload has the same content as what `lastPushed` recorded for that UUID, `unchanged` evaluates to `true` and the item is skipped. But the pending batch from the earlier burst already has an updated body chunk for that UUID. When the alarm fires and flushes, the stale (no-change skipped) UUID won't have its body written — so the flush pushes the stale `lastPushed` version of that item's body, not the intermediate-burst version.

This means an intermediate LS_CHANGED that was "the same as lastPushed" can silently cause a burst's earlier changes (from the very first burst call) to be discarded when a later burst call matches `lastPushed` exactly.

**Fix:** The `unchanged` check should also compare against the pending registry's `updatedAt` to detect that a prior burst already marked the item as changed:

```typescript
const baseRecord = baseRegistry[uuid];
const unchanged =
  pushed !== undefined &&
  pushed.titleHash === titleHash &&
  pushed.bodyHash === bodyHash &&
  // If the base record was already updated in this burst, don't skip it.
  (baseRecord === undefined || baseRecord.updatedAt === pushed.updatedAt);
```

## Info

### IN-01: `console.log` statements in production service-worker code

**File:** `src/background/message-handler.ts:20`, `src/background/push-engine.ts:155-157`

**Issue:** Two `console.log` calls remain in production code paths. While CLAUDE.md's security note correctly limits logging to counts (never instruction text), these log calls will appear in end-users' devtools service-worker console and may be unexpected in a published extension.

**Fix:** Guard behind a `__DEV__` build flag or remove. WXT exposes `import.meta.env.DEV` for this purpose:

```typescript
if (import.meta.env.DEV) {
  console.log('[sysins] push: received', payload.length, 'item(s)');
}
```

---

### IN-02: `LAST_OBSERVED_KEY` exported from `constants.ts` but unused in the reviewed files

**File:** `src/shared/constants.ts:18`

**Issue:** `LAST_OBSERVED_KEY` (`sysins:local:lastObserved`) is described as a Phase 2 key that "Phase 3 reads … as the initial diff baseline". However none of the Phase 3 files reviewed import or use it. If Phase 3 intentionally dropped the `lastObserved` baseline in favour of `lastPushed` + `pendingWrite`, the constant and its comment are now misleading.

**Fix:** If `lastObserved` is superseded by `lastPushed` in Phase 3, update the comment to reflect that and add a note that this key was a Phase 2 artifact that Phase 3 replaced. If it is still planned for use in a later phase, annotate it with the target phase number.

---

### IN-03: `bodyWriteMap` is defined independently in both `registry.ts` and `push-engine.ts`

**File:** `src/background/push-engine.ts:41-47` and `src/background/registry.ts:27-33`

**Issue:** The same 7-line helper is duplicated verbatim in two modules. This is not directly in scope (registry.ts is not a reviewed file), but `push-engine.ts` is. A future maintenance change to the key format would need to be made in two places.

**Fix:** Extract `bodyWriteMap` to `storage-layout.ts` (already the home of `splitIntoChunks` and other storage primitives) and import it from both callers.

---

_Reviewed: 2026-05-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

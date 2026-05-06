---
phase: 04-pull-engine-bootstrap
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/background/account-preflight.test.ts
  - src/background/account-preflight.ts
  - src/background/index-phase4.test.ts
  - src/background/index.ts
  - src/background/message-handler.ts
  - src/background/pull-engine.test.ts
  - src/background/pull-engine.ts
  - src/build.test.ts
  - src/content/content-phase4.test.ts
  - src/content/index.ts
  - src/shared/constants.ts
  - src/shared/types.test.ts
  - src/shared/types.ts
  - wxt.config.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 4 adds the pull engine (remote-change detection via `chrome.storage.onChanged`), first-install union-merge bootstrap, account-mismatch pre-flight (`chrome.identity`), multi-tab coordination via `PENDING_REMOTE_KEY`, and the D-04 infinite-loop guard. The overall architecture is sound and the hard rules from CLAUDE.md are followed. All storage keys are within the `sysins:*` namespace. No security vulnerabilities or data-loss bugs were found.

Three warnings were identified: the `LS_BOOTSTRAP` path silently drops the `pageEmail` field that the content script sends, bypassing the account mismatch check during bootstrap; the D-04 loop guard stores `Date.now()` instead of registry `updatedAt` values, creating a narrow timing window where a round-trip push could be triggered; and unhandled errors in the `onChanged` listener are swallowed silently. Three info-level items cover duplicated logic, a stale-payload risk, and a minor logging concern.

---

## Warnings

### WR-01: LS_BOOTSTRAP handler drops `pageEmail` — account mismatch check is bypassed during bootstrap

**File:** `src/background/index.ts:101`

**Issue:** The `LS_CHANGED` handler correctly extracts and forwards `pageEmail` to `handleLsChanged`, which then runs `checkAccountMismatch`. The `LS_BOOTSTRAP` handler, however, does not pass `pageEmail` to `handleLsBootstrap`, and `handleLsBootstrap` does not call `checkAccountMismatch` at all. The content script sends `pageEmail` in the bootstrap message (see `content/index.ts:158-160` and `types.ts:111-116`), but the field is silently discarded.

On a first install where the Chrome profile account does not match the AI Studio account, bootstrap will proceed and write the local instructions to `chrome.storage.sync` before the mismatch is detected on the first subsequent `LS_CHANGED`. This violates the intent of BOOT-03 and Hard Rule 10 (account safety).

**Fix:** Forward `pageEmail` from the message to `handleLsBootstrap` and add the pre-flight check at the top of that function, mirroring `handleLsChanged`:

```typescript
// index.ts — extract pageEmail before calling handleLsBootstrap
ensureInitialized()
  .then(() => handleLsBootstrap(
      message.payload as RawInstruction[],
      message.pageEmail as string | undefined,   // <-- add this
  ))
  .then(() => sendResponse({ ok: true }))
  .catch((err) => sendResponse({ ok: false, error: String(err) }));

// bootstrap.ts — add parameter and pre-flight at top of handleLsBootstrap
import { checkAccountMismatch } from './account-preflight';

export async function handleLsBootstrap(
  payload: RawInstruction[],
  pageEmail?: string,         // <-- add parameter
): Promise<void> {
  if (payload.length === 0) return;

  const isMismatch = await checkAccountMismatch(pageEmail);  // <-- add pre-flight
  if (isMismatch) return;

  // ... rest unchanged
}
```

---

### WR-02: D-04 loop guard uses `Date.now()` instead of registry `updatedAt` — may miss hash matches under fast round-trips

**File:** `src/background/pull-engine.ts:147`

**Issue:** `updateLastPushed` stamps each `LastPushedEntry` with `updatedAt: Date.now()` (the current wall-clock time at pull delivery). The push engine's `diffAndAccumulate` compares the incoming `LS_CHANGED` payload against the `lastPushed` snapshot. It checks both content hashes and the `updatedAt` field. If a synthetic `StorageEvent` from `applyRemoteLocally` fires the content-script polling path within the same event loop turn as `updateLastPushed`, and the polling picks up the change before the `LAST_PUSHED_KEY` write completes, `diffAndAccumulate` may see a snapshot whose `updatedAt` does not match the registry's `updatedAt`, causing `hasChanges=true` and scheduling a spurious push alarm.

More concretely: `updateLastPushed` is called before `deliverToTab`, so `LAST_PUSHED_KEY` is written with timestamp T1. The content script applies the change, fires `LS_CHANGED` with the same data, and `diffAndAccumulate` reads `lastPushed`. If the registry `updatedAt` for the same item is different from T1 (it will be, since the local items were given `updatedAt: now` during bootstrap or push), the hash comparison passes but the `updatedAt` field differs, and a push may be scheduled.

**Fix:** Use the registry's own `updatedAt` values rather than `Date.now()`:

```typescript
async function updateLastPushed(
  merged: Array<{ uuid: string; title: string; text: string; updatedAt: number }>,
  //                                                             ^^^^^^^^^^^^^ add field
): Promise<void> {
  const entries = await Promise.all(
    merged.map(async ({ uuid, title, text, updatedAt }) => {
      const bodyJson = JSON.stringify({ text });
      const [titleHash, bodyHash] = await Promise.all([shortHash(title), shortHash(bodyJson)]);
      const entry: LastPushedEntry = { titleHash, bodyHash, updatedAt };  // use registry value
      return [uuid, entry] as [string, LastPushedEntry];
    }),
  );
  // ...
}
```

Since `reconstructInstructions()` returns `{ uuid, title, text }` without `updatedAt`, you will also need to extend `registry.ts`'s return type or read the registry a second time to get `updatedAt`. The cleaner fix is to extend the `reconstructInstructions` return type to include `updatedAt`.

---

### WR-03: `onChanged` listener swallows `handleRemoteChanged` errors silently

**File:** `src/background/index.ts:125`

**Issue:** The `chrome.storage.onChanged` listener calls `void ensureInitialized().then(() => handleRemoteChanged(...))`. If `handleRemoteChanged` rejects (e.g., a transient `chrome.storage.sync.get` failure inside `applyRemote` or `reconstructInstructions`), the error is discarded silently because there is no `.catch()` on the promise chain and `void` prevents the unhandled-rejection warning from surfacing.

This contrasts with the `LS_CHANGED` and `LS_BOOTSTRAP` handlers, which both have `.catch((err) => sendResponse({ ok: false, error: String(err) }))`. The sync engine could fail to deliver pulled data without any badge update or error state being written.

**Fix:** Add a `.catch` that sets an error badge so the user sees amber rather than a silent failure:

```typescript
chrome.storage.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'sync') return;
    if (!(REGISTRY_KEY in changes)) return;
    void ensureInitialized()
      .then(() => handleRemoteChanged(changes, areaName))
      .catch((err) => {
        console.error('[sysins] pull-engine: unhandled error in handleRemoteChanged', err);
        // Surface via error badge so the user sees amber (Hard Rule 7)
        setErrorState('MALFORMED_REMOTE', String(err)).catch(() => undefined);
      });
  }
);
```

---

## Info

### IN-01: `extractPageEmail` is duplicated between `account-preflight.ts` and `content/index.ts`

**File:** `src/content/index.ts:49` and `src/background/account-preflight.ts:26`

**Issue:** The same regex-based email-extraction function is implemented independently in both files. The comment in `content/index.ts` acknowledges this ("Local copy — avoids cross-entrypoint import from background/"). While the architectural constraint (content scripts cannot import from background) is real, the duplication means a future regex change must be made in both places. Currently both implementations are identical, but they could diverge.

**Fix:** Extract the function into `src/shared/email-utils.ts` (or add it to a new `src/shared/parse.ts`). Both `content/index.ts` and `account-preflight.ts` can import from `src/shared/` without violating the content/background boundary. This is the same pattern used for `src/shared/guard.ts`.

---

### IN-02: `PENDING_REMOTE_KEY` payload is applied without staleness check

**File:** `src/content/index.ts:171-183`

**Issue:** The `visibilitychange` handler reads `PENDING_REMOTE_KEY` and applies the payload unconditionally. The `PendingRemoteState` interface includes `enqueuedAt: number` specifically to allow age-based pruning (the type comment says "allows age-based pruning if desired"), but no pruning is implemented. A payload enqueued days ago due to an unresponsive tab could be applied to a fresh AI Studio session, replacing the user's current instructions with stale data.

This is a low-urgency risk because the payload represents the merged state from the last sync event, but in a scenario where the user manually edited AI Studio instructions offline and then regains connectivity, the stale payload could overwrite those edits.

**Fix:** Add a staleness check before applying. A reasonable threshold is `PENDING_BATCH_TTL_MS` (60 seconds) or a dedicated constant (e.g., `PENDING_REMOTE_TTL_MS = 5 * 60 * 1000`):

```typescript
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
if (pending !== undefined) {
  const ageMs = Date.now() - pending.enqueuedAt;
  if (ageMs < STALE_THRESHOLD_MS) {
    applyRemoteLocally(pending.payload);
  } else {
    console.log('[sysins] content: discarding stale pendingRemote (age:', ageMs, 'ms)');
  }
  await chrome.storage.local.remove(PENDING_REMOTE_KEY); // always clear regardless
}
```

---

### IN-03: `applyRemoteLocally` logs instruction count on every invocation

**File:** `src/content/index.ts:79`

**Issue:** `console.log('[sysins] applyRemoteLocally called', instructions.length)` runs every time instructions are applied, including on every `visibilitychange` event where pending data exists and on every `APPLY_REMOTE` message. This is noise in the browser console visible to end users inspecting the extension. The count itself is safe (no titles or content), but the project's security comment in `message-handler.ts` ("log UUID count only — never log .text content") suggests logging discipline is intentional.

**Fix:** Remove the log line or gate it behind a debug flag. The pull engine already logs counts at the SW level (`[sysins] pull-engine: applied N item(s) from remote`), so the content-script log is redundant.

```typescript
function applyRemoteLocally(instructions: RawInstruction[]): void {
  // Remove: console.log('[sysins] applyRemoteLocally called', instructions.length);
  const serialized = JSON.stringify(instructions);
  // ...
}
```

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

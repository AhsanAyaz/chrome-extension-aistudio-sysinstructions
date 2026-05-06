---
phase: 05-popup-badge-export-import
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/popup/index.html
  - src/popup/main.ts
  - src/popup/App.svelte
  - src/popup/popup.css
  - src/popup/relativeTime.ts
  - src/popup/StatusHeader.svelte
  - src/popup/InstructionList.svelte
  - src/popup/ActionRow.svelte
  - src/popup/ExportImportRow.svelte
  - src/popup/BannerRow.svelte
  - src/background/index.ts
  - src/background/pull-engine.ts
findings:
  critical: 1
  high: 3
  medium: 2
  low: 1
  total: 7
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

The popup, badge, export, and import surface is well-structured and correctly observes the
strict layering rules (popup never writes chrome.storage.sync, badge writes only in SW context,
area guards on onChanged). The Svelte 5 runes syntax is applied consistently throughout.

Six bugs were found, ranging from a listener leak that will grow unboundedly across popup
opens (critical) to a destructive import behavior that will silently tombstone existing
instructions (high), a broken export download in some browsers (high), and a silent no-op
on PULL_NOW when the registry is empty (high). Two medium issues cover an incorrect plural
string and a dead prop. No security vulnerabilities were found.

---

## Critical Issues

### CR-01: `onMount` async callback silently swallows the cleanup — listener leak

**File:** `src/popup/App.svelte:28`

**Issue:** `onMount` receives an `async` callback. An `async` function always returns a
`Promise`, never a bare function. Svelte's `onMount` checks `typeof returnValue === 'function'`
to decide whether to call cleanup on unmount. Because the return type is
`Promise<() => void>` — not `() => void` — Svelte discards it and the
`chrome.storage.onChanged.removeListener(onChanged)` line is **never executed**.

Every popup open registers a new `onChanged` listener that is never removed. Over the
lifetime of a browser session each popup open stacks another live listener. This causes
spurious re-renders and, over many opens, memory growth in the extension's event-listener
registry.

**Fix:** Split the `async` hydration out of `onMount`'s return path. Register the listener
synchronously and return the cleanup synchronously:

```ts
onMount(() => {
  // kick off async hydration — fire and forget inside onMount
  (async () => {
    const [localData, syncData] = await Promise.all([
      chrome.storage.local.get(SYNC_STATUS_KEY),
      chrome.storage.sync.get(REGISTRY_KEY),
    ]);
    syncStatus = (localData[SYNC_STATUS_KEY] as SyncStatus) ?? { state: 'idle', lastSyncAt: 0 };
    registry = (syncData[REGISTRY_KEY] as SyncRegistry) ?? {};
  })();

  function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area === 'local' && SYNC_STATUS_KEY in changes) {
      syncStatus =
        (changes[SYNC_STATUS_KEY]!.newValue as SyncStatus) ?? { state: 'idle', lastSyncAt: 0 };
    }
    if (area === 'sync' && REGISTRY_KEY in changes) {
      registry = (changes[REGISTRY_KEY]!.newValue as SyncRegistry) ?? {};
    }
  }
  chrome.storage.onChanged.addListener(onChanged);

  // onMount callback is now synchronous — return value is the cleanup function
  return () => chrome.storage.onChanged.removeListener(onChanged);
});
```

---

## High Issues

### HR-01: `IMPORT_ITEMS` tombstones all existing instructions not present in the imported file

**File:** `src/background/index.ts:135` / `src/background/push-engine.ts:139-143`

**Issue:** The IMPORT_ITEMS handler routes through `diffAndAccumulate(message.payload)`.
`diffAndAccumulate` tombstones every live registry entry whose UUID is absent from the
incoming payload (push-engine.ts lines 139-143). A user importing a 3-item export while
they have 20 existing instructions will have 17 instructions silently deleted — tombstoned
and eventually GC'd.

This contradicts the Hard Rule 5 "union merge" contract and is especially dangerous because
the import validation in the popup (App.svelte lines 130-139) only checks structural validity,
not whether the import is intended as a full replacement vs. an additive merge.

**Fix:** Do not route IMPORT_ITEMS through `diffAndAccumulate`. Instead add a dedicated
`importItems(items: RawInstruction[])` function in push-engine or registry.ts that performs
a **union merge** (add/update items present in the payload, never tombstone items absent from
it). The simplest correct implementation:

```ts
// In push-engine.ts (new export)
export async function importItems(payload: RawInstruction[]): Promise<void> {
  if (payload.length === 0) return;
  const [registry, lastPushed, existingPending] = await Promise.all([
    getRegistry(),
    readLastPushed(),
    drainPendingWrite(),
  ]);
  const pendingRegistry = existingPending
    ? (existingPending[REGISTRY_KEY] as SyncRegistry | undefined) ?? null
    : null;
  const baseRegistry: SyncRegistry = pendingRegistry ?? registry;

  const titleToUuid = new Map<string, string>();
  for (const [uuid, rec] of Object.entries(baseRegistry)) {
    if (rec.deletedAt === null) titleToUuid.set(rec.title, uuid);
  }

  const now = Date.now();
  const nextRegistry: SyncRegistry = { ...baseRegistry };
  const bodyWrites: Record<string, string> = {};

  for (const item of payload) {
    const uuid = titleToUuid.get(item.title) ?? crypto.randomUUID();
    const bodyJson = JSON.stringify({ text: item.text });
    const [titleHash, bodyHash] = await Promise.all([shortHash(item.title), shortHash(bodyJson)]);
    const pushed = lastPushed[uuid];
    const unchanged =
      pushed !== undefined &&
      pushed.titleHash === titleHash &&
      pushed.bodyHash === bodyHash;
    if (!unchanged) {
      const chunks = splitIntoChunks(bodyJson);
      nextRegistry[uuid] = { title: item.title, updatedAt: now, deletedAt: null, chunks: chunks.length };
      Object.assign(bodyWrites, bodyWriteMap(uuid, chunks));
    }
  }
  // NOTE: no tombstone loop — import is additive only
  if (Object.keys(bodyWrites).length === 0) return;
  await persistPendingWrite({ [REGISTRY_KEY]: nextRegistry, ...bodyWrites });
}
```

Then in `index.ts` replace:
```ts
.then(() => diffAndAccumulate(message.payload as RawInstruction[]))
```
with:
```ts
.then(() => importItems(message.payload as RawInstruction[]))
```

### HR-02: `URL.revokeObjectURL` called synchronously — breaks export download in some browsers

**File:** `src/popup/App.svelte:103-108`

**Issue:** `URL.revokeObjectURL(url)` is called in the same synchronous execution frame
immediately after `a.click()`. `a.click()` is not awaited — it schedules the download
asynchronously. In Chrome extensions running in the popup context the blob URL can be
revoked before the browser has read the blob data, causing a failed/empty download.

```ts
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = filename;
a.click();
URL.revokeObjectURL(url); // ← revoked before browser reads the blob
```

**Fix:** Defer revocation with a `setTimeout` to allow the download to start:

```ts
a.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
```

Alternatively append `a` to the document body, dispatch a real click, then remove it —
but the `setTimeout` approach is the conventional pattern for popup-initiated downloads.

### HR-03: PULL_NOW silently no-ops when sync registry key is absent

**File:** `src/background/index.ts:117-126`

**Issue:** The PULL_NOW handler reads `chrome.storage.sync.get(REGISTRY_KEY)` and
constructs a fake `onChanged` event. If `r[REGISTRY_KEY]` is `undefined` (first install
before any push, or account switch), `fakeChanges[REGISTRY_KEY].newValue` is `undefined`.
`handleRemoteChanged` guard at pull-engine.ts line 68 then returns early:
`if (remoteRegistry === undefined) return;` — the pull silently does nothing, with no
badge update or error surfaced to the user.

The user sees the "Pull Now" button appear to succeed (no spinner, no error banner) while
nothing actually happened.

**Fix:** Check whether the registry key is present before constructing the fake event,
and if absent, either skip (and write a brief `writeSyncStatus` to surface the no-op) or
treat an empty remote as a valid `{}` registry:

```ts
if (message?.type === 'PULL_NOW') {
  void ensureInitialized().then(async () => {
    const r = await chrome.storage.sync.get(REGISTRY_KEY);
    // If registry key is absent the remote is empty — treat as empty registry,
    // which is valid and will result in a no-op merge.
    const remoteRegistry = r[REGISTRY_KEY] ?? {};
    const fakeChanges: Record<string, chrome.storage.StorageChange> = {
      [REGISTRY_KEY]: { newValue: remoteRegistry } as chrome.storage.StorageChange,
    };
    await handleRemoteChanged(fakeChanges, 'sync');
  });
  return false;
}
```

---

## Medium Issues

### MD-01: `importMessage` prop passed to `BannerRow` but not declared in its `$props()`

**File:** `src/popup/App.svelte:168` / `src/popup/BannerRow.svelte:4-8`

**Issue:** `App.svelte` passes `{importMessage}` to `BannerRow` on line 168:

```svelte
<BannerRow
  {syncStatus}
  showRefreshHint={showRefreshHint && !refreshHintDismissed}
  {dismissHint}
  {importMessage}   <!-- passed but not consumed -->
/>
```

`BannerRow.$props()` only destructures `syncStatus`, `showRefreshHint`, and `dismissHint`.
The `importMessage` prop is silently dropped and never rendered inside the banner. The
import message is instead shown by a separate `div` at App.svelte lines 171-173 — but only
when `syncStatus.state !== 'error'`. If an error occurs immediately after an import, the
import confirmation message is suppressed.

Additionally, if the design intent was to show the import message inside the error/hint
banner, the implementation is incomplete.

**Fix:** Either remove `{importMessage}` from the `BannerRow` call site (the standalone
`div` at line 171 already handles it), or add `importMessage` to `BannerRow.$props()` and
render it in the banner template. Choose one display path and remove the dead prop.

### MD-02: `relativeTime` returns `"1 days ago"` for exactly one day elapsed

**File:** `src/popup/relativeTime.ts:21`

**Issue:** The plural `"days ago"` suffix is used unconditionally:

```ts
if (diffDay < 7) return `${diffDay} days ago`;
```

When `diffDay === 1` this produces `"1 days ago"` instead of `"1 day ago"`.

**Fix:**

```ts
if (diffDay < 7) return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
```

---

## Low Issues

### LW-01: Badge color reset to `#000000` (black) after pull success is incorrect

**File:** `src/background/pull-engine.ts:92`

**Issue:** After a successful pull, the badge text is cleared and the background color
is reset to `#000000`:

```ts
await chrome.action.setBadgeText({ text: '' });
await chrome.action.setBadgeBackgroundColor({ color: '#000000' }); // reset color
```

When badge text is empty, Chrome hides the badge entirely — the background color is
irrelevant. However, if a subsequent error state sets the badge text again (e.g., `"!"`)
it will inherit the last-set background color. The Phase 3 error-badge code in
`alarm-flush.ts` presumably sets its own color when writing an error badge, so this is
unlikely to cause a visible bug in practice. But resetting to black rather than a neutral
color (or not resetting at all when text is empty) is misleading and could cause a flash
of a black badge if timing is adverse.

**Fix:** Either omit the `setBadgeBackgroundColor` call when clearing the badge text
(since the color doesn't matter when text is `''`), or reset to the same neutral color
used by `alarm-flush.ts` on success.

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---
phase: 02-observation-pipeline
reviewed: 2026-05-06T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/shared/guard.ts
  - src/shared/guard.test.ts
  - src/shared/types.ts
  - src/shared/constants.ts
  - src/background/message-handler.ts
  - src/background/message-handler.test.ts
  - src/background/index.ts
  - public/injected/ls-observer.js
  - src/injected/ls-observer.js
  - src/content/index.ts
  - wxt.config.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-06T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This phase implements the observation pipeline: a MAIN-world `localStorage` patch (`ls-observer.js`), an ISOLATED-world content script relay, a payload guard, shared types and constants, and a service-worker message handler stub. The architecture is sound and the layering matches the CLAUDE.md hard rules. The critical issue is a missing `sendResponse` call on unhandled message types in the service worker, which can cause runtime errors in Chrome's message-passing layer. Three warnings cover a missing `chrome.runtime.sendMessage` error handler in the content script's postMessage path, a postMessage `targetOrigin` that is set to `'*'`, and a logic gap in the polling fallback. Three info items round out the review.

## Critical Issues

### CR-01: Missing `return false` / `sendResponse` path for non-LS_CHANGED messages in onMessage listener

**File:** `src/background/index.ts:70-79`
**Issue:** The `chrome.runtime.onMessage` listener returns `true` (keeps port open) only inside the `LS_CHANGED` branch. For every other message type the listener falls through and returns `undefined`, which is correct — but since the function body has an explicit `return true` inside the `if` block and nothing outside it, this is fine for unhandled types. However, the LS_CHANGED branch calls `sendResponse` inside `.then()` and `.catch()` callbacks. If `ensureInitialized()` or `handleLsChanged()` throws synchronously before the promise chain is set up (e.g. a thrown non-Promise exception in those functions), neither `.then()` nor `.catch()` will fire and `sendResponse` is never called, leaving the message port open until Chrome times it out. More critically: the cast `message.payload as RawInstruction[]` is entirely unchecked — a malformed or missing `payload` field (e.g. `undefined`) is forwarded verbatim to `handleLsChanged`, which uses `payload.length` without any null guard. If a tab sends `{ type: 'LS_CHANGED' }` without a `payload` field, `handleLsChanged` will read `undefined.length` and throw, causing the `.catch` path to fire but also indicating that the guard that is supposed to sit at the content-script boundary (D-07) can be bypassed by any other extension or page that sends a matching message type to the service worker.

**Fix:** Add a runtime guard on `message.payload` before passing it to `handleLsChanged`, and ensure `sendResponse` is always called:

```typescript
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LS_CHANGED') {
    if (!Array.isArray(message.payload)) {
      sendResponse({ ok: false, error: 'invalid payload' });
      return true;
    }
    ensureInitialized()
      .then(() => handleLsChanged(message.payload as RawInstruction[]))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});
```

## Warnings

### WR-01: Unhandled `chrome.runtime.sendMessage` promise rejection in content script postMessage path

**File:** `src/content/index.ts:38-41`
**Issue:** `chrome.runtime.sendMessage(...)` is called without awaiting or attaching a `.catch()` handler. In Chrome MV3, calling `sendMessage` when the service worker is inactive (not yet awake) or when the background page rejects returns a rejected promise. Without a catch, this becomes an unhandled promise rejection. In content scripts Chrome logs these as errors and may also emit `runtime.lastError`. The polling path at line 59 has the same issue.

**Fix:** Wrap both `sendMessage` calls in a shared fire-and-forget helper that suppresses expected rejection noise:

```typescript
function fireAndForget(payload: object): void {
  chrome.runtime.sendMessage(payload).catch(() => {
    // SW may be inactive; message dropped intentionally. SW will catch up via polling.
  });
}
```

Then replace both `chrome.runtime.sendMessage(...)` calls with `fireAndForget(...)`.

---

### WR-02: `postMessage` uses `targetOrigin: '*'` — value leaks to cross-origin iframes if any exist

**File:** `src/injected/ls-observer.js:17` and `public/injected/ls-observer.js:17`
**Issue:** `window.postMessage(..., '*')` broadcasts to any frame on the page regardless of origin. While the content script filters on `event.source !== window` (D-10) to block cross-frame receipt, the message is still *sent* to all frames. If AI Studio ever embeds a third-party iframe (ads, embeds, OAuth flows), the raw localStorage value — which contains all user system instructions — is broadcast to that frame. The content script's guard only prevents the content script from acting on spoofed messages; it does not prevent the injected script from leaking data outward.

**Fix:** Restrict the target origin to the page's own origin in the injector:

```javascript
window.postMessage(
  { source: 'sysins-injected', type: 'LS_SET', value: value },
  window.location.origin  // only this origin's frames receive it
);
```

The content script needs no change — `event.source === window` already filters correctly.

---

### WR-03: Polling fallback does not send `sendResponse`; polling fires even when tab is hidden

**File:** `src/content/index.ts:49-61`
**Issue:** The polling interval runs unconditionally at 2 s forever, including when the tab is backgrounded or hidden. This is a minor concern in isolation but the more important issue is a logic gap: the polling `lastSnapshot` diff guard compares the raw string from `localStorage.getItem` against the previous value. If `localStorage.getItem` returns `null` (key absent) and then the key is written, the first non-null value will be caught both by the `setItem` patch *and* by the polling interval the next time it fires, producing a duplicate `LS_CHANGED` message. The service worker's `handleLsChanged` stub currently has no deduplication so the snapshot will be overwritten with an identical value — harmless now but could cause double-push in Phase 3.

**Fix (correctness):** Initialize `lastSnapshot` to the current value of `localStorage.getItem(WATCHED_LS_KEY)` at content-script startup rather than `null`, so the first poll does not fire spuriously if the key was already set before the content script loaded:

```typescript
let lastSnapshot: string | null =
  localStorage.getItem('aistudio_all_system_instructions');
```

## Info

### IN-01: `public/injected/ls-observer.js` and `src/injected/ls-observer.js` are byte-for-byte duplicates

**File:** `public/injected/ls-observer.js` and `src/injected/ls-observer.js`
**Issue:** Both files are identical. The CLAUDE.md architecture describes the MAIN-world injector as living at `src/injected/ls-observer.js` (WXT source tree), but a second copy exists at `public/injected/ls-observer.js` (WXT's public/ directory, which is copied verbatim into the build output). If WXT is configured to use the `src/` version via `injectScript('/injected/ls-observer.js', ...)`, only one copy should exist. Having two means any future edit must be made in both places; they will inevitably diverge.

**Fix:** Determine which copy WXT resolves for `injectScript('/injected/ls-observer.js', ...)` at build time, keep only that one, and delete the other. Add a comment in the surviving file pointing to the canonical source location.

---

### IN-02: `isValidPayload` does not validate that array elements have the expected shape

**File:** `src/shared/guard.ts:9-17`
**Issue:** `isValidPayload` checks that the JSON is a non-empty array but does not check that elements are objects with at least a `title` and `text` field. An array like `[1, 2, 3]` or `[null]` passes the guard and is cast to `RawInstruction[]` in the content script, which could surface as a runtime type error in Phase 3's push engine. This is an info item because the current Phase 2 stub is tolerant, but the gap should be plugged before Phase 3 consumes the payload.

**Fix:** Add a shallow structural check:

```typescript
return (
  Array.isArray(parsed) &&
  parsed.length > 0 &&
  parsed.every(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).title === 'string' &&
      typeof (item as Record<string, unknown>).text === 'string',
  )
);
```

---

### IN-03: `message-handler.test.ts` imports `SYNC_PENDING_KEY` from `./sync-state` but does not import `LAST_OBSERVED_KEY` from constants — minor import hygiene

**File:** `src/background/message-handler.test.ts:6`
**Issue:** The test file imports `SYNC_PENDING_KEY` from `./sync-state` (correct) and `LAST_OBSERVED_KEY` from `../shared/constants` (correct). However it also imports `ensureInitialized` and `_resetForTesting` from `./index` — which means the test is integrating through the `index.ts` default export while only testing `handleLsChanged` in isolation in the first two describes. The test file is logically split between unit tests (`handleLsChanged`) and integration tests (`ensureInitialized` + `handleLsChanged` combined), which is fine, but the two logical groups belong in separate `describe` blocks with clearly different titles to make the scope obvious. This is already partially done (two describe blocks exist), but the second describe title `'D-03: ensureInitialized runs on LS_CHANGED wake'` does not mention that it is an integration test. Minor clarity issue only.

**Fix:** Rename the second describe to `'D-03 (integration): ensureInitialized + handleLsChanged — orphan sentinel cleared on LS_CHANGED wake'` to communicate test scope at a glance.

---

_Reviewed: 2026-05-06T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

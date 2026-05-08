# Phase 4: Pull Engine + Bootstrap - Research

**Researched:** 2026-05-06
**Domain:** Chrome MV3 extension — pull path, bootstrap union merge, account mismatch pre-flight
**Confidence:** HIGH (Chrome APIs, existing codebase); MEDIUM (AI Studio DOM identifier — spike required)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Spike-first order):** Phase 4 plan 1 is the BOOT-03 spike. No pull-engine or bootstrap code is written until the spike confirms: (a) whether `chrome.identity.getProfileUserInfo()` is callable without adding the `identity` manifest permission, and (b) where the AI Studio page exposes the signed-in account identifier in the DOM.
- **D-02 (Happy path — identity available without permission):** If confirmed available without extra permission, use `chrome.identity.getProfileUserInfo()` for Chrome profile email; scrape AI Studio DOM for account identifier; on mismatch, set `errorState = 'ACCOUNT_MISMATCH'` and pause auto-sync.
- **D-03 (Fallback — identity permission required):** If the spike finds `identity` permission required, add it. DIST-02 permits this — account safety is strictly required.
- **D-04 (Diff-only infinite loop guard):** No `window.__sysins_applying` suppression flag. Phase 3's `diffAndAccumulate` returns `hasChanges = false` when pulled data matches the last-pushed snapshot. If stale-`lastPushed` edge case surfaces in testing, fix `lastPushed` durability — not add a flag.
- **D-05 (Bootstrap trigger):** `chrome.runtime.onInstalled` (reason `"install"`) writes `sysins:local:bootstrapNeeded: true`. Content script checks this flag on first page load, reads `localStorage`, sends `LS_BOOTSTRAP` to SW. SW runs union merge, clears flag.
- **D-06 (BOOT-02 title-match collision):** Multiple remote entries sharing a local title — first remote entry by `updatedAt` descending wins the title match; remaining get fresh UUIDs.
- **D-07 (SW picks active tab):** SW queries `chrome.tabs.query({ url: '*://aistudio.google.com/*', active: true })`. Sends `APPLY_REMOTE` to first result.
- **D-08 (No-active-tab fallback):** SW writes merged array to `sysins:local:pendingRemote`. Content script polls on `visibilitychange`, applies, clears.

### Claude's Discretion

- Exact shape of `sysins:local:bootstrapNeeded` (boolean vs `{ triggeredAt: number }`)
- Exact shape of `sysins:local:pendingRemote`
- Whether `LS_BOOTSTRAP` reuses the `LS_CHANGED` handler or is a separate handler
- Tombstone GC: Phase 4 or v1.x
- Exact BOOT-03 spike plan structure

### Deferred Ideas (OUT OF SCOPE)

- Visual merge-result notification ("N instructions merged, M pulled") — popup phase
- `tabs` vs `activeTab` permission — spike confirms (host_permissions research below narrows this)
- Tombstone GC — designed in Phase 1 schema; may defer to v1.x

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PULL-01 | When `chrome.storage.sync` reports a change from another device, SW wakes, computes merged registry, applies via content script | `onChanged` fires in SW for remote sync changes (MEDIUM-verified); `areaName === 'sync'` guard; `ensureInitialized` pattern carries over |
| PULL-02 | Per-item conflicts resolved by last-write-wins on `updatedAt`; tombstones win unconditionally when `deletedAt > updatedAt` | `applyRemote()` in `registry.ts` already implements this; pull engine calls it then fetches changed bodies |
| PULL-03 | Pulls write `localStorage` and dispatch synthetic `StorageEvent`; if React ignores it, popup/badge surfaces "Refresh AI Studio" hint | `window.dispatchEvent(new StorageEvent(...))` correct pattern (MV3-4 pitfall); storageArea must be the actual `localStorage` object |
| PULL-04 | Pull-initiated writes do not trigger another push (no infinite loop) | D-04: `diffAndAccumulate` returns `hasChanges = false` when pulled data matches lastPushed snapshot; no suppression flag needed |
| PULL-05 | When two AI Studio tabs are open, only one applies a remote update | D-07: SW picks single active tab; content script in non-selected tab never receives `APPLY_REMOTE` |
| BOOT-01 | First-install is union merge (never pull-overwrite) | D-05 `LS_BOOTSTRAP` flow; union merge algorithm using `applyRemote()` + UUID assignment for local-only items |
| BOOT-02 | Items without UUID matched to remote by title at bootstrap only | D-06 title-match first-by-updatedAt; `titleToUuid` lookup same pattern as `diffAndAccumulate`; UUID identity thereafter |
| BOOT-03 | Account mismatch pre-flight: if Chrome profile account ≠ AI Studio account, pause auto-sync + surface warning | SPIKE-GATED: `identity.email` permission required (confirmed); DOM identifier location TBD by spike |

</phase_requirements>

---

## Summary

Phase 4 completes the bidirectional sync loop. The pull path is the mirror of push: `chrome.storage.onChanged` fires in the service worker when remote sync data arrives, the SW runs the merge algorithm (already built in `applyRemote()`), reconstructs the live instruction array, and delivers it to the content script via `chrome.tabs.sendMessage`. The content script writes `localStorage` and dispatches a synthetic `StorageEvent`. The infinite-loop guard is provided for free by Phase 3's `diffAndAccumulate` — an APPLY_REMOTE write that lands data identical to the last-pushed snapshot returns `hasChanges = false` and schedules no flush.

The bootstrap flow uses a deferred trigger: `onInstalled` writes a `bootstrapNeeded` flag to `chrome.storage.local`, and the content script picks it up on first page load, reads `localStorage`, and sends an `LS_BOOTSTRAP` message. This works whether or not AI Studio was open at install time. The union merge algorithm assigns UUIDs to untracked local items, applies `applyRemote()` to reconcile the two sides, and writes the merged registry to sync and the merged array to localStorage.

The single open question that cannot be resolved without a live browser is the BOOT-03 account-mismatch pre-flight: the research confirms that `chrome.identity.getProfileUserInfo()` requires the `identity.email` manifest permission (not just `identity`), and returns an empty string without it. Where AI Studio exposes the signed-in account email in the DOM must be confirmed by the spike — the most likely candidates are the account avatar button's `aria-label` attribute and the page's account-switcher component.

**Primary recommendation:** Plan 04-01 is the BOOT-03 spike. Plans 04-02 through 04-N follow its findings. No implementation code before the spike completes.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detect remote sync change | Service Worker | — | `chrome.storage.onChanged` only fires in extension contexts; SW is the correct owner |
| Merge remote + local registry | Service Worker | — | Hard Rule 6: all merge logic in SW; content script is relay only |
| Fetch remote body chunks | Service Worker | — | Only SW reads `chrome.storage.sync` directly |
| Deliver merged array to page | Content Script | — | CS owns `localStorage` read/write; SW cannot access `localStorage` |
| Dispatch synthetic StorageEvent | Content Script | — | Must be dispatched in the page's browsing context |
| Infinite loop guard (diff) | Service Worker | — | `diffAndAccumulate` in push-engine runs the same diff for outgoing pushes |
| Active tab selection | Service Worker | — | `chrome.tabs.query` is a SW/background capability |
| Pending remote queue | Service Worker (write) | Content Script (read) | SW writes on no-active-tab; CS reads on visibilitychange |
| Bootstrap trigger | Service Worker (write flag) | Content Script (read+send) | `onInstalled` is SW-only; CS reads flag and sends LS snapshot |
| Union merge on bootstrap | Service Worker | — | Same merge engine; BOOT-01 is a special invocation of `applyRemote()` |
| Account mismatch pre-flight | Service Worker | — | `chrome.identity` is a SW API; DOM scrape is CS responsibility (spike gates this) |

---

## Standard Stack

### Core (Phase 4 uses no new third-party libraries)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| WXT | 0.20.25 | Extension scaffold, WxtVitest plugin, fakeBrowser | Already locked in project |
| TypeScript | ~5.8 | Type safety | Already locked |
| Vitest | 4.1.5 | Unit tests | Already locked |
| `@types/chrome` | 0.1.40 | Chrome API types | Already installed (confirmed via `npm view`) |

**No new npm packages are needed for Phase 4.** All pull engine, bootstrap, and account-mismatch logic is implemented using Chrome built-in APIs and the existing codebase.

[VERIFIED: npm registry — `@types/chrome@0.1.40`, `wxt@0.20.25`, `vitest@4.1.5`]

### New Constants (in `src/shared/constants.ts` per D-24)

```typescript
// Phase 4 additions — must go into constants.ts (D-24: magic numbers forbidden inline)
export const BOOTSTRAP_NEEDED_KEY = `${LOCAL_KEY_PREFIX}bootstrapNeeded`;
export const PENDING_REMOTE_KEY   = `${LOCAL_KEY_PREFIX}pendingRemote`;
```

### New Types (in `src/shared/types.ts`)

```typescript
// Phase 4 message types
export interface ApplyRemoteMessage {
  type: 'APPLY_REMOTE';
  payload: RawInstruction[]; // merged live array (tombstoned items excluded)
}

export interface BootstrapMessage {
  type: 'LS_BOOTSTRAP';
  payload: RawInstruction[]; // raw localStorage snapshot from content script
}

// sysins:local:pendingRemote — D-08
export interface PendingRemoteState {
  payload: RawInstruction[]; // merged array waiting for a tab to apply
  enqueuedAt: number;        // epoch ms
}

// sysins:local:bootstrapNeeded
export interface BootstrapNeededFlag {
  triggeredAt: number; // epoch ms — lets us detect if it was written but never consumed
}
```

---

## Architecture Patterns

### System Architecture Diagram

```
PULL FLOW (remote change from another device):

chrome.storage.sync (remote device pushed) ──── [Chrome sync infrastructure] ────►
                                                                                   │
                    chrome.storage.onChanged (areaName === 'sync') fires          │
                    ◄──────────────────────────────────────────────────────────────┘
                    │
                    ▼
Service Worker (wakes):
  1. ensureInitialized()
  2. Guard: is areaName === 'sync' AND changed keys include REGISTRY_KEY? If not → return
  3. Read updated REGISTRY_KEY from changes.newValue
  4. applyRemote(remoteRegistry) → merged local+remote registry written to sync
  5. reconstructInstructions() → live merged RawInstruction[]
  6. chrome.tabs.query({ url: '*://aistudio.google.com/*', active: true }) → activeTab
  7a. activeTab found → chrome.tabs.sendMessage(tabId, { type: 'APPLY_REMOTE', payload })
  7b. no active tab → chrome.storage.local.set({ PENDING_REMOTE_KEY: { payload, enqueuedAt } })
                    │
                    ▼ (content script receives APPLY_REMOTE)
Content Script:
  1. Write localStorage.setItem(WATCHED_LS_KEY, JSON.stringify(payload))
  2. window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }))
  3. (React may or may not respond — best-effort per Hard Rule 8)

BOOTSTRAP FLOW (first install):

SW onInstalled(reason='install'):
  → chrome.storage.local.set({ BOOTSTRAP_NEEDED_KEY: { triggeredAt: Date.now() } })

Content Script first load on aistudio.google.com:
  → chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY)
  → if present AND isValidPayload(localStorage value):
       sendMessage({ type: 'LS_BOOTSTRAP', payload: JSON.parse(localStorage value) })
  → SW clears BOOTSTRAP_NEEDED_KEY after union merge

SW handles LS_BOOTSTRAP:
  1. ensureInitialized()
  2. Assign UUIDs to local-only items (title-match vs remote, D-06)
  3. applyRemote(localRegistry) — merge local+remote; tombstones handled by applyRemote
  4. Write merged registry to sync
  5. Reconstruct merged array → send APPLY_REMOTE back to tab
  6. Clear BOOTSTRAP_NEEDED_KEY

PENDING REMOTE APPLY (tab becomes active):

Content Script visibilitychange handler:
  → if document.visibilityState === 'visible':
       chrome.storage.local.get(PENDING_REMOTE_KEY)
       → if present: applyRemoteLocally(payload); clearPendingRemote()

ACCOUNT MISMATCH PRE-FLIGHT (BOOT-03 spike result gates this):

SW, before any sync cycle:
  → chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }) → { email, id }
  → Content script reads DOM for AI Studio account identifier
  → If emails differ: setErrorState('ACCOUNT_MISMATCH'); return (skip sync)
```

### Recommended Project Structure Additions

```
src/
├── background/
│   ├── pull-engine.ts          # NEW: handleRemoteChanged, applyToTab, enqueuePendingRemote
│   ├── bootstrap.ts            # NEW: handleLsBootstrap, unionMerge
│   ├── account-preflight.ts    # NEW: checkAccountMismatch (spike result determines impl)
│   ├── pull-engine.test.ts     # NEW
│   ├── bootstrap.test.ts       # NEW
│   └── account-preflight.test.ts  # NEW
├── content/
│   └── index.ts                # MODIFY: add bootstrapNeeded check + visibilitychange handler
├── shared/
│   ├── constants.ts            # MODIFY: add BOOTSTRAP_NEEDED_KEY, PENDING_REMOTE_KEY
│   └── types.ts                # MODIFY: add ApplyRemoteMessage, BootstrapMessage, PendingRemoteState, BootstrapNeededFlag
└── background/index.ts         # MODIFY: add chrome.storage.onChanged listener, handle LS_BOOTSTRAP
```

### Pattern 1: chrome.storage.onChanged handler

**What:** Service worker registers a `chrome.storage.onChanged` listener at top-level (synchronous, before any async) to receive remote sync events.

**When to use:** Always — this is the event that wakes the SW when remote data arrives.

**Handler signature:**
```typescript
// Source: developer.chrome.com/docs/extensions/reference/api/storage (CITED)
chrome.storage.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== 'sync') return;          // only react to sync-area changes
    if (!(REGISTRY_KEY in changes)) return;   // only act when registry changed
    void handleRemoteChanged(changes);        // fire-and-forget; SW stays alive for API calls
  }
);
```

**Key detail — StorageChange shape:**
```typescript
interface StorageChange {
  oldValue?: unknown;  // absent if key was newly created
  newValue?: unknown;  // absent if key was deleted
}
```

**When it fires for remote changes:** `chrome.storage.onChanged` fires in the SW when Chrome's sync infrastructure delivers data from another device. This is the standard MV3 pattern for sync-triggered SW wakes. [ASSUMED — confirmed by community reports and architecture docs, but official docs do not state "remote device" explicitly]

### Pattern 2: chrome.tabs.query with host_permissions (no "tabs" permission)

**What:** Query for active AI Studio tabs without adding the broad `"tabs"` permission.

**Why this works:** The extension already has `host_permissions: ['https://aistudio.google.com/*']`. Chrome allows `tabs.query()` URL filtering when the extension has matching host permissions, even without the `"tabs"` permission. [VERIFIED: GitHub issue #655 on GoogleChrome/developer.chrome.com — confirmed host permissions substitute for "tabs" permission for URL-based query filtering]

```typescript
// No "tabs" permission needed — host_permissions for aistudio.google.com/* suffices
const tabs = await chrome.tabs.query({
  url: '*://aistudio.google.com/*',
  active: true,
  currentWindow: true,  // optional: restrict to focused window
});
const activeTab = tabs[0]; // SW picks first result (D-07)
```

**Manifest impact:** No new permission declaration required. Current `wxt.config.ts` already has the necessary host permission.

### Pattern 3: chrome.tabs.sendMessage to deliver APPLY_REMOTE

**What:** SW sends the merged instruction array to the content script in a specific tab.

```typescript
// Source: developer.chrome.com/docs/extensions/develop/concepts/messaging (CITED)
if (activeTab?.id !== undefined) {
  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: 'APPLY_REMOTE',
      payload: mergedInstructions,
    } satisfies ApplyRemoteMessage);
  } catch {
    // Content script not yet loaded in tab — fall through to D-08 pendingRemote path
    await enqueuePendingRemote(mergedInstructions);
  }
}
```

**Race condition:** If `tabs.sendMessage` throws (e.g., content script not yet loaded on the page), fall through to the `pendingRemote` path. This is the correct MV3 error handling pattern.

### Pattern 4: Synthetic StorageEvent dispatch in content script

**What:** Content script writes `localStorage` and dispatches a synthetic `StorageEvent` so AI Studio's React (if it listens) picks up the change in the same tab.

**Critical details:**
- `window.dispatchEvent` is required (not `document.dispatchEvent`)
- `storageArea` must be the actual `localStorage` object for React's listener to match
- Same-window `storage` events are **not** fired by the browser natively — the synthetic dispatch is the only mechanism [VERIFIED: MDN Web Storage API spec, ARCHITECTURE.md §Live-Update Path]

```typescript
// Source: ARCHITECTURE.md §Live-Update Path + MDN (CITED)
function applyRemoteLocally(instructions: RawInstruction[]): void {
  const serialized = JSON.stringify(instructions);
  const oldValue = localStorage.getItem(WATCHED_LS_KEY);
  localStorage.setItem(WATCHED_LS_KEY, serialized);
  window.dispatchEvent(new StorageEvent('storage', {
    key: WATCHED_LS_KEY,
    oldValue,
    newValue: serialized,
    storageArea: localStorage,   // must be the actual object, not a reference copy
    url: window.location.href,
  }));
}
```

**Best-effort by design (Hard Rule 8):** If AI Studio doesn't respond to the StorageEvent, the "Refresh AI Studio" hint is the correct fallback. Do not attempt React fiber injection.

### Pattern 5: Bootstrap flag read in content script

**What:** Content script checks for `BOOTSTRAP_NEEDED_KEY` on first load and sends `LS_BOOTSTRAP` if the flag exists and localStorage has valid data.

```typescript
// In content/index.ts main() — after existing polling setup
const flagResult = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
if (flagResult[BOOTSTRAP_NEEDED_KEY] !== undefined) {
  const raw = localStorage.getItem(WATCHED_LS_KEY);
  if (raw !== null && isValidPayload(raw)) {
    // reuse same sendMessage pattern as LS_CHANGED
    chrome.runtime.sendMessage({
      type: 'LS_BOOTSTRAP',
      payload: JSON.parse(raw) as RawInstruction[],
    }).catch(() => {
      // SW may be inactive; bootstrap will retry on next page load (flag still set)
    });
  }
  // If no valid local data: SW checks remote on install; nothing to send
}
```

**Why not clear the flag in the CS:** The SW clears the flag after a successful union merge. If the CS cleared it, a failed SW merge would leave the system in a non-retryable state.

### Pattern 6: visibilitychange poller for pendingRemote

**What:** Content script listens for `visibilitychange` to apply deferred `APPLY_REMOTE` payloads.

```typescript
// In content/index.ts main()
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
  const pending = r[PENDING_REMOTE_KEY] as PendingRemoteState | undefined;
  if (pending !== undefined) {
    applyRemoteLocally(pending.payload);
    await chrome.storage.local.remove(PENDING_REMOTE_KEY);
  }
});
```

### Pattern 7: fakeBrowser for chrome.storage.onChanged tests

**What:** `@webext-core/fake-browser` fires `storage.onChanged` listeners when `fakeBrowser.storage.sync.set()` is called in tests.

```typescript
// Source: WXT unit testing docs + @webext-core/fake-browser behavior (VERIFIED: search results)
import { fakeBrowser } from 'wxt/testing/fake-browser';

beforeEach(() => {
  fakeBrowser.reset();
});

it('fires onChanged when sync storage changes', async () => {
  const listener = vi.fn();
  chrome.storage.onChanged.addListener(listener);

  // Writing via fakeBrowser triggers onChanged synchronously
  await fakeBrowser.storage.sync.set({ [REGISTRY_KEY]: newRegistry });

  expect(listener).toHaveBeenCalledWith(
    expect.objectContaining({ [REGISTRY_KEY]: expect.any(Object) }),
    'sync',
  );
});
```

**Important:** `fakeBrowser.storage.sync.set()` (not `chrome.storage.sync.set()`) must be used to simulate a remote change arriving — calling `chrome.storage.sync.set()` in the test IS the SW writing to sync, which is a push, not a pull. Use `fakeBrowser.storage.sync.set()` to bypass the SW and simulate a remote device having written.

### Pattern 8: Account mismatch pre-flight (spike-gated)

**What:** Confirmed by research: `chrome.identity.getProfileUserInfo()` requires the `identity.email` manifest permission. Without it, returns `{ email: '', id: '' }`.

```typescript
// Source: developer.chrome.com/docs/extensions/reference/api/identity (CITED)
// Requires: permissions: ['identity.email'] in manifest (or 'identity' does NOT suffice)
const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
// userInfo.email is '' if permission absent or user not signed in
```

**Spike task:** Confirm (a) the Chrome profile email via the above API call in a test extension with `identity.email` permission, and (b) the AI Studio DOM element containing the signed-in account email (avatar aria-label is the primary candidate — Google apps consistently expose `aria-label="Google Account: user@example.com (user@example.com)"` or similar on the account button).

**DOM candidates for AI Studio account identifier (LOW confidence — spike required):**
- `document.querySelector('[aria-label*="Google Account"]')?.getAttribute('aria-label')` — standard Google app pattern [ASSUMED]
- The page `<title>` element (unlikely for email, but sometimes used in Google products)
- `document.querySelector('a[href*="accounts.google.com"]')` — account management links

### Anti-Patterns to Avoid

- **Broadcast to all tabs:** D-07 specifies single active tab, not all open AI Studio tabs. Broadcasting causes PULL-05 violation.
- **CS reads chrome.storage.sync directly for pull:** Anti-Pattern 4 from ARCHITECTURE.md — the SW is the only sync reader. Content script receives only the already-merged payload.
- **Setting window.__sysins_applying flag:** D-04 explicitly rejects this. The diff guard in `diffAndAccumulate` is sufficient.
- **Clearing bootstrapNeeded in the content script:** Race condition — if the SW message fails (SW inactive), the flag must survive to retry on next page load.
- **Using `chrome.storage.sync.set()` in pull-engine tests to simulate remote data:** Calls `onChanged` as a local write, not a remote arrival. Must use `fakeBrowser.storage.sync.set()` in tests to correctly simulate the pull event.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Last-write-wins + tombstone merge | Custom merge loop | `applyRemote()` in `registry.ts` | Already implemented, tested, and correct per D-18/Recipe 9 |
| UUID assignment for new items | Custom ID generator | `crypto.randomUUID()` (built-in) | D-17: locked decision |
| Chunk reassembly after pull | Custom string concat | `joinChunks()` in `storage-layout.ts` | Already handles multi-chunk reassembly |
| Instruction array reconstruction | Custom filter + fetch | `reconstructInstructions()` in `registry.ts` | Already implemented, handles tombstone exclusion |
| Sync state error surfacing | Custom badge update | `setErrorState()` + `writeSyncStatus()` in `sync-state.ts` | Already wired; ACCOUNT_MISMATCH is already in the ErrorState union |
| Live array from merged registry | Custom loop | `reconstructInstructions()` — returns `{ uuid, title, text }[]` | Handles chunk fetch + tombstone filter |

**Key insight:** The Phase 4 pull engine's job is primarily orchestration — wire together `applyRemote()`, `reconstructInstructions()`, `tabs.query`, and `tabs.sendMessage`. The heavy lifting is already done.

---

## BOOT-03 Spike: Critical Research Findings

### chrome.identity.getProfileUserInfo permission requirement

**CONFIRMED:** `chrome.identity.getProfileUserInfo()` requires the `identity.email` manifest permission. The `identity` permission alone returns `{ email: '', id: '' }`. [CITED: developer.chrome.com/docs/extensions/reference/api/identity#method-getProfileUserInfo]

**Impact on D-02/D-03:** D-03 applies — the `identity.email` permission must be added to the manifest. This is a new permission addition. The DIST-02 constraint ("unless strictly required") is satisfied by account safety being strictly required.

**Manifest change required:**
```typescript
// In wxt.config.ts manifest section:
permissions: ['storage', 'scripting', 'alarms', 'identity.email'],
```

**Release note:** This permission addition must be documented. The permission dialog shown to users will display identity-related permission.

**Note on `accountStatus: 'ANY'`:** The `{ accountStatus: 'ANY' }` parameter returns the primary signed-in profile, even if it's a managed account. Without this parameter, it may return empty for managed accounts. [ASSUMED — spike should verify behavior for the author's account type]

### AI Studio DOM identifier — SPIKE REQUIRED

The AI Studio page's signed-in account identifier location cannot be confirmed from search results or documentation. It must be determined by opening AI Studio in Chrome with DevTools.

**Most likely candidates (LOW confidence):**
1. `document.querySelector('[aria-label*="Google Account"]')` — used by Gmail, Google Docs, and other Google properties for the account avatar button. Typically contains `"Google Account: Name (email@example.com)"`.
2. `document.querySelector('[data-email]')` or similar data attributes — some Google apps embed the email as a data attribute on the avatar element.
3. `document.querySelector('.account-button')` or equivalent class — varies by app.

**Spike procedure:**
1. Add `identity.email` to test extension permissions.
2. Call `chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' })` in SW DevTools console.
3. In AI Studio tab, inspect the account avatar element in the top-right corner via DevTools.
4. Find a stable selector that exposes the email address.
5. Document the confirmed selector and attribute name.

---

## Common Pitfalls

### Pitfall 1: onChanged fires for local writes too
**What goes wrong:** `chrome.storage.onChanged` fires for ALL writes to sync storage — including the SW's own push writes. If the pull handler runs on every `onChanged` event without filtering, it will re-pull after every push, wasting quota reads and potentially causing subtle bugs.

**Why it happens:** `onChanged` does not distinguish "local write" from "remote arrival."

**How to avoid:** Two defenses:
1. Guard: only process `onChanged` events where `areaName === 'sync'` AND `changes[REGISTRY_KEY]` exists.
2. The diff guard in `diffAndAccumulate` handles the loop case: if pull-applied data is identical to `lastPushed`, `hasChanges = false` and no flush alarm is scheduled. D-04 locked this design.

**Warning signs:** Write counter in SW logs climbs after every push.

### Pitfall 2: tabs.sendMessage throws when content script not yet loaded
**What goes wrong:** The SW finds an active AI Studio tab via `tabs.query` but `tabs.sendMessage` throws because the content script hasn't fully loaded yet (e.g., the tab just navigated to aistudio.google.com and is still initializing).

**Why it happens:** `tabs.query` returns the tab as soon as Chrome registers it; the content script may still be running `document_start` setup.

**How to avoid:** Wrap `tabs.sendMessage` in try/catch. On failure, fall through to the D-08 `pendingRemote` path. The content script's `visibilitychange` handler will pick it up when the page is fully loaded.

### Pitfall 3: LS_BOOTSTRAP sent on every page load (not just first-install)
**What goes wrong:** If `bootstrapNeeded` is never cleared (or if the clearing logic is wrong), every time the content script loads it sends `LS_BOOTSTRAP` and the SW runs the union merge — introducing repeated merges and potential false tombstoning.

**Why it happens:** Race condition between CS sending `LS_BOOTSTRAP` and SW clearing the flag.

**How to avoid:** SW clears `bootstrapNeeded` atomically after a successful union merge. The CS never clears it. If SW fails (exception during merge), the flag persists for retry on next page load — acceptable.

### Pitfall 4: Union merge assigns new UUIDs to remote items
**What goes wrong:** Bootstrap assigns a fresh UUID to a remote registry entry because the local title doesn't match. The item gets two UUIDs — one in remote, one in the new local write.

**Why it happens:** Mixing up "local item without UUID" (needs UUID assigned) vs "remote item with UUID" (already has UUID — use it).

**How to avoid:** The union merge algorithm must iterate the remote registry and assign remote UUIDs to matching local items (matched by title, D-06). Only local items with NO matching remote title get fresh UUIDs. The `applyRemote()` function handles the remote side; the bootstrap function handles the local-only side.

### Pitfall 5: reconstructInstructions() fetches sync on every pull
**What goes wrong:** `reconstructInstructions()` reads body chunks from `chrome.storage.sync` for every live item. If the pull just applied the merged registry, this immediately reads back what was just written.

**Why it happens:** `reconstructInstructions()` always reads from sync. For pull, the body chunks may already be in `changes.newValue` from `onChanged`.

**How to avoid:** The `onChanged` event provides `newValue` for each changed key. The pull engine can assemble the body map from `changes` directly for new/updated items, falling back to `chrome.storage.sync.get()` only for unchanged items. This is an optimization — correctness is maintained either way. For Phase 4 initial implementation, calling `reconstructInstructions()` is simpler and correct; optimize if performance is a concern.

### Pitfall 6: Stale lastPushed after APPLY_REMOTE
**What goes wrong:** Content script writes localStorage via APPLY_REMOTE. The MAIN-world injector fires, the CS forwards an `LS_CHANGED` to the SW. `diffAndAccumulate` computes the diff against `lastPushed`. If `lastPushed` is stale (reflects the pre-pull state), the diff shows all pulled items as "changed" and schedules a redundant flush.

**Why it happens:** `lastPushed` is updated only after a successful `flushPendingWrite`. If APPLY_REMOTE writes data that differs from `lastPushed`, `diffAndAccumulate` sees it as new work.

**How to avoid (D-04 implementation detail):** After a successful pull application, update `lastPushed` to reflect the merged state. This prevents the redundant flush. The pull engine should call `writeLastPushed(mergedBatch)` — the same helper used by `alarm-flush.ts` — after delivering the payload to the tab.

---

## Code Examples

### Pull engine onChanged handler skeleton

```typescript
// Source: derived from existing Phase 3 patterns in codebase + Chrome API docs (CITED)
// src/background/pull-engine.ts

export async function handleRemoteChanged(
  changes: Record<string, chrome.storage.StorageChange>,
): Promise<void> {
  const registryChange = changes[REGISTRY_KEY];
  if (registryChange === undefined) return;

  const remoteRegistry = registryChange.newValue as SyncRegistry | undefined;
  if (remoteRegistry === undefined) return; // key deleted — shouldn't happen

  // Merge remote registry into local (applyRemote writes merged result to sync)
  await applyRemote(remoteRegistry);

  // Reconstruct live instructions from merged state
  const merged = await reconstructInstructions();
  const mergedPayload: RawInstruction[] = merged.map(({ title, text }) => ({ title, text }));

  // Update lastPushed to reflect merged state (D-04 loop guard: prevents spurious push)
  // Phase 4 adds this as an explicit step after pull delivery.

  // Deliver to active tab or queue for deferred apply
  await deliverToTab(mergedPayload);
}
```

### deliverToTab with fallback

```typescript
// Source: CONTEXT.md D-07/D-08 + chrome.tabs API (CITED)
async function deliverToTab(payload: RawInstruction[]): Promise<void> {
  const tabs = await chrome.tabs.query({
    url: '*://aistudio.google.com/*',
    active: true,
  });
  const tab = tabs[0];

  if (tab?.id !== undefined) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'APPLY_REMOTE',
        payload,
      } satisfies ApplyRemoteMessage);
      return;
    } catch {
      // Content script not ready — fall through to pendingRemote
    }
  }

  // D-08: no active tab (or sendMessage failed) → persist for visibilitychange pickup
  const state: PendingRemoteState = { payload, enqueuedAt: Date.now() };
  await chrome.storage.local.set({ [PENDING_REMOTE_KEY]: state });
}
```

### Content script APPLY_REMOTE handler

```typescript
// Source: ARCHITECTURE.md §Live-Update Path (CITED)
// In content/index.ts — chrome.runtime.onMessage listener
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'APPLY_REMOTE') {
    const instructions = message.payload as RawInstruction[];
    const serialized = JSON.stringify(instructions);
    const oldValue = localStorage.getItem(WATCHED_LS_KEY);
    localStorage.setItem(WATCHED_LS_KEY, serialized);
    window.dispatchEvent(new StorageEvent('storage', {
      key: WATCHED_LS_KEY,
      oldValue,
      newValue: serialized,
      storageArea: localStorage,
      url: window.location.href,
    }));
    // No sendResponse needed — fire-and-forget delivery
  }
  // Do NOT return true here — synchronous handler, no async response
});
```

### fakeBrowser test for pull engine

```typescript
// Source: existing Phase 3 test patterns (registry.test.ts, push-engine.test.ts) (CITED)
import { fakeBrowser } from 'wxt/testing/fake-browser';

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
});

it('handleRemoteChanged applies remote registry and calls reconstructInstructions', async () => {
  // Pre-seed sync with some local state
  await chrome.storage.sync.set({ [REGISTRY_KEY]: localRegistry });

  // Simulate remote write arriving (NOT chrome.storage.sync.set — that's a push)
  // fakeBrowser.storage.sync.set() triggers onChanged listeners
  await fakeBrowser.storage.sync.set({ [REGISTRY_KEY]: remoteRegistry });

  // Listener should have been triggered — pull engine should have merged
  const merged = await getRegistry();
  expect(merged).toMatchObject(expectedMergedRegistry);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `identity` permission for getProfileUserInfo | `identity.email` permission specifically required | Chrome extension docs (current) | Must add `identity.email` to manifest, not just `identity` |
| `"tabs"` permission for chrome.tabs.query URL filter | Host permissions suffice for URL-matching queries | Chrome 50+ / docs updated 2024 | No `"tabs"` permission needed; `host_permissions` already declared |
| `chrome.storage.onChanged` callback-style | Promise/async available in MV3 | MV3 launch | Listener callbacks are still the standard for event-driven patterns; async body inside listener is fine |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `chrome.storage.onChanged` fires in the SW when remote sync data arrives from another device | Architecture Patterns §Pattern 1 | If wrong, the entire pull engine event source is invalid; would need polling fallback |
| A2 | AI Studio exposes the signed-in account email in an `aria-label` attribute on the account avatar button | BOOT-03 Spike section | Spike will confirm or disprove; alternative DOM attributes noted |
| A3 | `{ accountStatus: 'ANY' }` parameter returns the primary profile email for non-managed accounts | BOOT-03 Spike section | Spike confirms; without parameter, managed accounts return empty |
| A4 | `fakeBrowser.storage.sync.set()` (not `chrome.storage.sync.set()`) is needed to trigger `onChanged` in tests | Pattern 7 | If wrong, tests fire `onChanged` on push-side writes — incorrect simulation |
| A5 | `reconstructInstructions()` reading from sync after `applyRemote()` sees the freshly merged registry | Common Pitfalls §5 | If sync write is not immediately readable, reconstruction returns stale state; but Chrome's storage API is synchronous per local cache |

**A1 risk mitigation:** Every architectural document, community source, and the existing Phase 3 architecture research confirms `onChanged` wakes the SW for remote sync changes. The official docs don't call it out explicitly, but the behavior is universally relied upon in MV3 extension sync patterns. Treat as HIGH confidence.

---

## Open Questions (RESOLVED)

1. **BOOT-03 spike: `identity.email` permission + AI Studio DOM identifier**
   - What we know: `identity.email` permission is required (confirmed). DOM identifier unknown.
   - What's unclear: Exact CSS selector and attribute for AI Studio's signed-in account email.
   - Recommendation: Spike is Plan 04-01. No other Phase 4 code until resolved.
   - **RESOLVED:** `identity.email` permission is required (D-03 confirmed). DOM selector for AI Studio account is confirmed by spike Plan 04-01 and written to `.claude/skills/spike-findings-boot03/SKILL.md`.

2. **Should pull engine update `lastPushed` after APPLY_REMOTE delivery?**
   - What we know: D-04 relies on diff-against-lastPushed to prevent infinite loop. If `lastPushed` is stale post-pull, `diffAndAccumulate` may see all pulled items as "changed" and schedule a redundant flush.
   - What's unclear: Whether this edge case manifests in practice or whether the alarm-flush diff eliminates it.
   - Recommendation: Planner should include `writeLastPushed` call in the pull path to be explicit. Cheaper than debugging a spurious flush.
   - **RESOLVED:** pull-engine.ts calls `writeLastPushed` (via `chrome.storage.local.set({ [LAST_PUSHED_KEY]: snapshot })`) after APPLY_REMOTE delivery — implemented in Plan 04-03.

3. **Tombstone GC: Phase 4 or v1.x?**
   - What we know: `TOMBSTONE_GC_TTL_MS = 30 * 24 * 60 * 60 * 1000` is already in `constants.ts`. Schema supports it. The constant suggests Phase 1 anticipated GC.
   - What's unclear: Whether Phase 4's pull path is the natural place to trigger GC (after a successful merge).
   - Recommendation: Planner decides. GC is a single `chrome.storage.sync.remove()` call on tombstones older than TTL; it fits naturally after the pull merge. Including it in Phase 4 keeps the constant used and prevents deferred-forever syndrome.
   - **RESOLVED:** Deferred to v1.x per CONTEXT.md Deferred section. `TOMBSTONE_GC_TTL_MS` constant already exists in `constants.ts` as a placeholder for when GC is implemented.

---

## Environment Availability

> Phase 4 is code/config-only changes. No external tools beyond Chrome and the existing toolchain.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Chrome (with sync enabled) | PULL-01, BOOT-03 spike | ✓ | Any | — |
| `@types/chrome` | TypeScript compilation | ✓ | 0.1.40 | — |
| `wxt` | Build + fakeBrowser | ✓ | 0.20.25 | — |
| `vitest` | Unit tests | ✓ | 4.1.5 | — |

[VERIFIED: npm view for all packages above]

---

## Project Constraints (from CLAUDE.md)

All CLAUDE.md hard rules remain in force. Phase 4-specific applicability:

| Hard Rule | Phase 4 Application |
|-----------|---------------------|
| **Rule 4** (null/empty LS never auto-propagated) | `LS_BOOTSTRAP` must use the same `isValidPayload()` guard before sending. An empty localStorage on first-install should NOT trigger a bootstrap send. |
| **Rule 5** (first-install is union merge, not pull-overwrite) | BOOT-01. The union merge algorithm must call `applyRemote()` rather than overwriting. |
| **Rule 6** (all merge logic in SW) | `handleLsBootstrap` and `handleRemoteChanged` live in `src/background/`. Content script calls `applyRemoteLocally()` which has no merge logic — it just writes and dispatches. |
| **Rule 8** (synthetic StorageEvent is best-effort) | `applyRemoteLocally()` dispatches the event but does not assert React responds. The "Refresh AI Studio" hint is the designed fallback. |
| **Rule 10** (tombstones win) | Enforced by `applyRemote()` which already implements `deletedAt > updatedAt` win condition. Pull engine calls `applyRemote()` — no custom merge needed. |
| **Hard Rule 3** (single batched set) | Pull engine writes to `chrome.storage.local` (for pendingRemote, bootstrapNeeded clear) and `chrome.storage.sync` (merged registry) in single batched calls. |
| **No telemetry/third-party calls** (DIST-04) | Account preflight uses only `chrome.identity` (Chrome built-in) and DOM inspection. No external calls. |

**D-24 enforcement:** `BOOTSTRAP_NEEDED_KEY` and `PENDING_REMOTE_KEY` must be added to `src/shared/constants.ts`. No inline string literals for these keys anywhere in Phase 4 implementation files.

---

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json` — this section is SKIPPED.

---

## Security Domain

> No new attack surfaces introduced in Phase 4 beyond what Phase 3 established. The APPLY_REMOTE message is consumed only by the content script (not the page MAIN world). The synthetic StorageEvent writes to `localStorage` but carries only data the SW has already validated via the existing registry schema.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes — for remote registry payload | `applyRemote()` already validates shape; pull engine should guard `remoteRegistry` is a valid `SyncRegistry` before calling `applyRemote()` |
| V6 Cryptography | no — no new crypto operations | `crypto.randomUUID()` for any new UUIDs assigned during bootstrap |
| V4 Access Control | minimal — `chrome.tabs.sendMessage` is scoped to a specific tab ID | No new risks |

---

## Sources

### Primary (HIGH confidence)
- `developer.chrome.com/docs/extensions/reference/api/storage#event-onChanged` — `onChanged` handler signature, `StorageChange` type
- `developer.chrome.com/docs/extensions/reference/api/identity#method-getProfileUserInfo` — `identity.email` permission requirement confirmed
- `developer.chrome.com/docs/extensions/reference/api/tabs` — `tabs.query` URL filtering behavior
- `github.com/GoogleChrome/developer.chrome.com/issues/655` — confirmed host_permissions substitute for "tabs" permission in URL-based `tabs.query`
- Existing codebase: `registry.ts`, `push-engine.ts`, `alarm-flush.ts`, `sync-state.ts`, `content/index.ts`, `shared/constants.ts`, `shared/types.ts` — Phase 3 patterns and existing APIs

### Secondary (MEDIUM confidence)
- `ARCHITECTURE.md` (project research) — synthetic StorageEvent pattern, message topology, bootstrap algorithm
- `PITFALLS.md` (project research) — SYNC-1 (infinite loop), SYNC-3 (first-install overwrite), AISTUDIO-3 (multi-tab), AISTUDIO-4 (account mismatch), MV3-4 (StorageEvent same-window)
- WXT unit testing docs / `@webext-core/fake-browser` — `fakeBrowser.storage.sync.set()` triggers `onChanged` in tests

### Tertiary (LOW confidence — spike required)
- AI Studio DOM identifier for signed-in account email — cannot be confirmed without live page inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new npm packages; all tools confirmed at known versions
- Architecture: HIGH — pull path, bootstrap flow, and account preflight all confirmed from Chrome API docs + existing codebase patterns
- BOOT-03 spike: LOW for DOM identifier (requires live inspection), HIGH for permission requirement
- Pitfalls: HIGH — verified against existing Phase 3 patterns and official Chrome API behavior

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (Chrome API references are stable; AI Studio DOM structure may change)

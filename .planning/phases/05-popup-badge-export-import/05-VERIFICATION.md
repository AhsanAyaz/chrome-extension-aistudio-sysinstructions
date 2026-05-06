---
phase: 05-popup-badge-export-import
verified: 2026-05-06T22:00:00Z
status: passed
score: 11/11 automated must-haves verified
overrides_applied: 0
human_verification:
  - test: "Popup opens and shows sync state, instruction count, last sync time"
    expected: "Status header visible with Idle/Syncing/Error label, relative timestamp or 'Never synced', instruction count"
    why_human: "Visual rendering of Svelte 5 popup in real Chrome cannot be verified by grep/static analysis"
  - test: "Instruction list reflects merged state from chrome.storage.sync registry"
    expected: "List shows title + relative updatedAt per item, empty state copy when no instructions"
    why_human: "Live data dependency — requires extension loaded in Chrome with real storage state"
  - test: "Push Now button triggers an immediate sync, bypassing 30s debounce"
    expected: "Edited instruction appears in chrome.storage.sync within 5 seconds after clicking Push Now"
    why_human: "Requires real Chrome environment; DevTools service worker console needed to confirm sync write"
  - test: "Pull Now button triggers a fresh pull and refresh hint appears"
    expected: "Amber banner 'Pull applied — refresh AI Studio to see changes.' displays; no infinite loop"
    why_human: "Requires real Chrome environment to verify badge state change and banner render"
  - test: "Error states display correct human-readable copy in the banner"
    expected: "Each of the 9 ErrorState values maps to its UI-SPEC copy string in the banner"
    why_human: "Requires injecting error state into chrome.storage.local in real Chrome to trigger render"
  - test: "Export JSON downloads a valid JSON file with live instructions only"
    expected: "File named aistudio-instructions-YYYY-MM-DD.json; array of {title, text, uuid, updatedAt}; no tombstoned items"
    why_human: "Browser file download cannot be triggered or verified without real Chrome interaction"
  - test: "Import JSON ingests an exported file and items appear within 35 seconds"
    expected: "Popup shows 'Imported N instruction(s). Syncing now.'; instructions appear in AI Studio within 35 seconds"
    why_human: "Requires real Chrome with AI Studio tab open to verify end-to-end import → merge → localStorage delivery"
  - test: "Badge is empty when sync is healthy; shows non-empty on error states"
    expected: "Badge text empty string during idle; error badge set on error states (amber/red per error type)"
    why_human: "Toolbar badge state requires real Chrome to observe visually; cannot inspect chrome.action state programmatically in tests"
---

# Phase 5: Popup, Badge, and Export/Import Verification Report

**Phase Goal:** The user has full visibility into sync state and manual escape hatches through a thin popup over the proven sync engine
**Verified:** 2026-05-06T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Opening the toolbar popup shows last sync timestamp, sync state, instruction count, and per-instruction list reflecting merged state | ✓ VERIFIED (code) / ? HUMAN (runtime) | StatusHeader renders STATE_LABEL + countLabel + lastSyncLabel(relativeTime); InstructionList {#each} over liveItems derived from chrome.storage.sync registry |
| 2 | "Push now" bypasses 30s debounce, triggers immediate sync; popup updates within 5 seconds | ✓ VERIFIED (code) / ? HUMAN (runtime) | PUSH_NOW handler in index.ts chains ensureInitialized().then(() => flushPendingWrite()); fire-and-forget, returns false; popup's onChanged listener updates syncStatus live |
| 3 | "Pull now" re-applies merged result; refresh hint surfaces if AI Studio React doesn't respond | ✓ VERIFIED (code) / ? HUMAN (runtime) | PULL_NOW handler constructs fake changes from current registry, calls handleRemoteChanged; pull-engine.ts writes writeSyncStatus({state:'idle'}); BannerRow shows amber hint |
| 4 | Badge is green (empty) when healthy, amber when attention needed, red on error — no silent error | ✓ VERIFIED (code) / ? HUMAN (runtime) | pull-engine.ts: setBadgeText({text:''}); alarm-flush.ts has badge error surfacing; BannerRow renders ERROR_COPY for all 9 ErrorState values |
| 5 | Export downloads valid JSON; Import ingests file, routes through merge path, instructions appear within 35 seconds | ✓ VERIFIED (code) / ? HUMAN (runtime) | exportJSON(): batched sync.get + Blob/anchor click; IMPORT_ITEMS: importItems() (union-merge, no tombstoning) + flushPendingWrite(); all-or-nothing validation in handleFileSelected |

**Score:** 5/5 truths have complete code-level support verified. All 5 require human runtime confirmation per ROADMAP success criteria wording.

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | svelte + @wxt-dev/module-svelte | ✓ VERIFIED | svelte@^5.55.5, @wxt-dev/module-svelte@^2.0.5 |
| `wxt.config.ts` | modules: ['@wxt-dev/module-svelte'] | ✓ VERIFIED | Line 6: modules: ['@wxt-dev/module-svelte'] |
| `src/popup/index.html` | WXT popup entrypoint with #app div | ✓ VERIFIED | id="app" div + script type="module" src="./main.ts" |
| `src/popup/main.ts` | Svelte 5 mount() call | ✓ VERIFIED | mount(App, { target: document.getElementById('app')! }) |
| `src/popup/App.svelte` | Root component: state, onMount, actions, export/import | ✓ VERIFIED | $state, $derived, onMount with area-guarded onChanged; pushNow/pullNow/exportJSON/handleFileSelected implemented |
| `src/popup/popup.css` | 360px width layout | ✓ VERIFIED | body { width: 360px } and .popup { width: 360px } |
| `src/popup/relativeTime.ts` | Exported relativeTime(epochMs) | ✓ VERIFIED | 5-branch time logic: just now / N min ago / N hr ago / N days ago / YYYY-MM-DD |
| `src/popup/StatusHeader.svelte` | Svelte 5 status + count + lastSync display | ✓ VERIFIED | $props(), STATE_LABEL map, countLabel(), lastSyncLabel(relativeTime(lastSyncAt)) |
| `src/popup/InstructionList.svelte` | Svelte 5 scrollable list with empty state | ✓ VERIFIED | {#each items as [uuid, rec] (uuid)} with {:else} empty state "No instructions yet" |
| `src/popup/ActionRow.svelte` | Push Now + Pull Now, disabled during sync | ✓ VERIFIED | onclick={pushNow/pullNow}, disabled={isSyncing}, btn-primary #1a73e8, btn-secondary outlined |
| `src/popup/ExportImportRow.svelte` | Export + Import; hidden file input | ✓ VERIFIED | bind:this={fileInput}, onclick={() => fileInput.click()}, accept=".json" |
| `src/popup/BannerRow.svelte` | Error banner + refresh hint; all 9 ErrorState values | ✓ VERIFIED | ERROR_COPY Record<ErrorState, string> with all 9 values; amber hint + dismiss button |
| `src/background/index.ts` | PUSH_NOW, PULL_NOW, IMPORT_ITEMS handlers | ✓ VERIFIED | All 3 handlers present (lines 109, 117, 132); all return false; importItems import added |
| `src/background/pull-engine.ts` | Badge clear on pull success | ✓ VERIFIED | Line 91: chrome.action.setBadgeText({ text: '' }); writeSyncStatus({state:'idle'}) also added |
| `.output/chrome-mv3/popup.html` | Build output with popup entrypoint | ✓ VERIFIED | File exists in .output/chrome-mv3/ |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| wxt.config.ts | @wxt-dev/module-svelte | modules array | ✓ WIRED | modules: ['@wxt-dev/module-svelte'] at line 6 |
| src/popup/main.ts | src/popup/App.svelte | mount(App, {target}) | ✓ WIRED | mount(App, { target: document.getElementById('app')! }) |
| src/popup/App.svelte | chrome.storage.local | SYNC_STATUS_KEY | ✓ WIRED | chrome.storage.local.get(SYNC_STATUS_KEY) in async IIFE; onChanged area='local' guard |
| src/popup/App.svelte | chrome.storage.sync | REGISTRY_KEY | ✓ WIRED | chrome.storage.sync.get(REGISTRY_KEY) in async IIFE; onChanged area='sync' guard |
| src/popup/StatusHeader.svelte | src/popup/relativeTime.ts | import { relativeTime } | ✓ WIRED | Line 3: import { relativeTime } from './relativeTime'; used in lastSyncLabel() |
| src/popup/InstructionList.svelte | src/popup/relativeTime.ts | import { relativeTime } | ✓ WIRED | Line 3: import { relativeTime } from './relativeTime'; used in {relativeTime(rec.updatedAt)} |
| src/popup/ActionRow.svelte | App.svelte pushNow/pullNow | $props() destructuring | ✓ WIRED | let { pushNow, pullNow, isSyncing } = $props(); onclick={pushNow/pullNow} |
| src/popup/BannerRow.svelte | src/shared/types.ts ErrorState | import type { ErrorState } | ✓ WIRED | ERROR_COPY: Record<ErrorState, string> covers all 9 values exhaustively |
| index.ts PUSH_NOW handler | alarm-flush.ts flushPendingWrite | ensureInitialized().then(() => flushPendingWrite()) | ✓ WIRED | Line 110: void ensureInitialized().then(() => flushPendingWrite()) |
| index.ts PULL_NOW handler | pull-engine.ts handleRemoteChanged | fakeChanges + await handleRemoteChanged | ✓ WIRED | Lines 118-125: reads registry, constructs fake StorageChange, calls handleRemoteChanged |
| index.ts IMPORT_ITEMS handler | push-engine.ts importItems | importItems() + flushPendingWrite() | ✓ WIRED | Lines 134-136: importItems(payload) chained with flushPendingWrite(); union-merge semantics |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| App.svelte | syncStatus | chrome.storage.local.get(SYNC_STATUS_KEY) | Yes — reads actual SW-written sync status | ✓ FLOWING |
| App.svelte | registry | chrome.storage.sync.get(REGISTRY_KEY) | Yes — reads actual chrome.storage.sync registry | ✓ FLOWING |
| App.svelte | liveItems | $derived from registry | Yes — filters deletedAt===null, sorts by updatedAt | ✓ FLOWING |
| StatusHeader.svelte | syncStatus, itemCount | Props from App.svelte | Yes — receives live state from parent | ✓ FLOWING |
| InstructionList.svelte | items | Props from App.svelte (liveItems) | Yes — real registry entries, not hardcoded | ✓ FLOWING |
| App.svelte exportJSON | bodyData | chrome.storage.sync.get(bodyKeys) batched | Yes — single batched get of all body chunk keys | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| relativeTime < 60s | node -e "const {relativeTime}=require('./src/popup/relativeTime.ts')" | N/A — TypeScript, not runnable directly | ? SKIP |
| popup.html in build | ls .output/chrome-mv3/popup.html | File exists | ✓ PASS |
| PUSH_NOW in index.ts | grep "PUSH_NOW" src/background/index.ts | Found at line 109 | ✓ PASS |
| importItems import | grep "importItems" src/background/index.ts | Found at lines 12 and 135 | ✓ PASS |
| No Svelte 4 patterns | grep "on:click\|export let" src/popup/*.svelte | No matches | ✓ PASS |
| No chrome.action in popup | grep "chrome.action" src/popup/*.svelte | No matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| UI-01 | 05-01, 05-02, 05-03 | Popup shows last sync timestamp, sync state, instruction count | ✓ SATISFIED | StatusHeader renders STATE_LABEL[state], relativeTime(lastSyncAt), countLabel(itemCount) |
| UI-02 | 05-02, 05-03 | Popup lists instructions with title and updatedAt; reflects merged state | ✓ SATISFIED | InstructionList {#each liveItems} from registry (chrome.storage.sync), not raw localStorage |
| UI-03 | 05-02, 05-05 | "Push now" flushes pending writes immediately, bypassing debounce | ✓ SATISFIED | PUSH_NOW → ensureInitialized().then(flushPendingWrite) in index.ts |
| UI-04 | 05-02, 05-05 | "Pull now" forces fresh read from chrome.storage.sync, re-applies merged result | ✓ SATISFIED | PULL_NOW → fake onChanged → handleRemoteChanged in index.ts; writeSyncStatus on success |
| UI-05 | 05-04 | Explicit error state for quota exceeded, sync unavailable, account mismatch, malformed remote | ✓ SATISFIED | BannerRow ERROR_COPY covers all 9 ErrorState values; bannerVisible derived from syncStatus.state==='error' |
| UI-06 | 05-05 | Badge reflects sync health; green=healthy, amber=attention, red=error | ✓ SATISFIED (code) / ? HUMAN (runtime) | alarm-flush.ts handles error badge; pull-engine.ts clears badge on success; badge colors set by alarm-flush |
| EXPORT-01 | 05-02 | "Export to JSON" produces human-readable JSON file with title, text, UUID, updatedAt | ✓ SATISFIED | exportJSON() in App.svelte: batched body chunk fetch + Blob/anchor click; schema {title,text,uuid,updatedAt} |
| EXPORT-02 | 05-02, 05-05 | "Import from JSON" routes items through merge path; conflicts resolved; items appear within 35s | ✓ SATISFIED | handleFileSelected() validates then sends IMPORT_ITEMS; importItems() uses union-merge; flushPendingWrite() called immediately |

All 8 phase requirements satisfied at code level. UI-06 requires human runtime confirmation for badge color behavior.

### Notable Deviation: importItems vs diffAndAccumulate

Plan 05-05 specified using `diffAndAccumulate` for IMPORT_ITEMS. The implementation uses `importItems` — a separate function added to push-engine.ts with union-merge semantics (no tombstoning of items absent from import payload). This is a correct improvement: `diffAndAccumulate` tombstones items missing from the payload, which would wrongly delete existing instructions during import. The `importItems` function is explicitly additive-only (Hard Rule 5). The 05-05 SUMMARY documents this as an intentional decision. The goal of EXPORT-02 is fully met — items route through the merge path, get UUIDs assigned, conflicts resolve.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODOs, FIXMEs, placeholder returns, hardcoded empty data, or Svelte 4 patterns found in any popup file. All sub-components receive typed props from App.svelte and render real data.

### Human Verification Required

#### 1. Full Popup Visual Render

**Test:** Load the extension in Chrome (chrome://extensions → Load unpacked → .output/chrome-mv3/). Click the toolbar icon. Confirm the popup opens with: sync state label (Idle/Syncing/Error), "Never synced" or relative timestamp, instruction count, and instruction list or empty state copy.
**Expected:** Popup renders at 360px width, all sections visible, no layout overflow, correct copy per UI-SPEC.
**Why human:** Svelte 5 compilation, WXT entrypoint discovery, and CSS layout correctness require real Chrome rendering.

#### 2. Push Now Immediate Flush

**Test:** Edit a system instruction in AI Studio. Immediately click "Push Now" in the popup (before 30s debounce fires). In DevTools Service Worker console: `chrome.storage.sync.get(null, console.log)`.
**Expected:** The edited instruction appears in chrome.storage.sync within 5 seconds — not the 30s alarm window.
**Why human:** Requires live SW interaction and DevTools inspection to verify the debounce bypass.

#### 3. Pull Now and Refresh Hint

**Test:** Click "Pull Now" in the popup. Confirm the amber banner "Pull applied — refresh AI Studio to see changes." appears. Verify badge state in the toolbar.
**Expected:** Amber hint banner visible and dismissable; badge clears to empty after pull completes; no repeated sync.set calls (no infinite loop).
**Why human:** Banner render and badge state require real Chrome environment.

#### 4. Error Banner with Correct Copy

**Test:** In DevTools SW console: `chrome.storage.local.set({'sysins:local:syncStatus': {state:'error', lastSyncAt: Date.now(), errorState:'QUOTA_EXCEEDED'}})`. Open popup.
**Expected:** Red banner displays "Sync storage is full. Delete unused instructions to free space."
**Why human:** Requires injecting error state into real Chrome storage to trigger the reactive update path.

#### 5. Export JSON File Content

**Test:** Click "Export JSON" in popup. Open the downloaded aistudio-instructions-YYYY-MM-DD.json file.
**Expected:** Valid JSON array; each item has title (string), text (string), uuid (string), updatedAt (epoch ms number); no items with deletedAt !== null.
**Why human:** Browser download trigger cannot be verified without real Chrome UI interaction.

#### 6. Import JSON End-to-End

**Test:** Take the exported file, add a new item `{"title":"Test Import","text":"test text"}`. Click "Import JSON" and select the file. Wait up to 35 seconds.
**Expected:** Popup shows "Imported N instruction(s). Syncing now."; "Test Import" appears in AI Studio's instruction list or is visible in `chrome.storage.sync.get(null)` in SW DevTools.
**Why human:** Full import pipeline (file picker → validation → IMPORT_ITEMS message → importItems → flushPendingWrite → sync.set → deliverToTab → AI Studio update) requires real Chrome.

#### 7. Badge Behavior at Glance

**Test:** Observe toolbar badge in healthy state (idle, no errors). Simulate an error (see test 4 above). Observe badge color change.
**Expected:** Badge text empty when healthy; badge shows colored indicator on error; clears back to empty after resolution.
**Why human:** chrome.action badge state is a visual property only inspectable in real Chrome.

### Gaps Summary

No automated gaps found. All 11 plan must-haves are verified. All 8 requirements have code-level evidence. The phase is architecturally complete.

The 8 human verification items are standard visual/behavioral tests that cannot be verified by static analysis. They were acknowledged in Plan 05-06 as the DevTools E2E checkpoint (the plan's Task 2 was a `type="checkpoint:human-verify"` gate). The 05-06 SUMMARY claims all 5 roadmap success criteria were confirmed by human verifier — this verification report surfaces those confirmations for the record and marks them for the developer to re-confirm if needed.

---

_Verified: 2026-05-06T22:00:00Z_
_Verifier: Claude (gsd-verifier)_

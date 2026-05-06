---
phase: 05-popup-badge-export-import
plan: 02
subsystem: popup-ui
tags: [svelte-5, popup, chrome-storage, export, import, state-management]
dependency_graph:
  requires: [05-01]
  provides: [popup-scaffold, app-svelte-root, popup-css]
  affects: [05-03, 05-04, 05-05]
tech_stack:
  added: []
  patterns:
    - Svelte 5 runes ($state, $derived, onMount with cleanup return)
    - chrome.storage.onChanged area-guard pattern (local vs sync)
    - Batched chrome.storage.sync.get for export body chunks
    - Fire-and-forget chrome.runtime.sendMessage with .catch()
    - Blob + anchor-click download (no downloads permission)
    - All-or-nothing import validation before SW dispatch
key_files:
  created:
    - src/popup/index.html
    - src/popup/main.ts
    - src/popup/App.svelte
    - src/popup/popup.css
  modified: []
decisions:
  - "Svelte 5 mount(App, { target }) used — not Svelte 4 new App({ target }) (removed API)"
  - "onMount returns cleanup function — no separate onDestroy (Svelte 5 pattern)"
  - "Area guards on both local and sync in onChanged — prevents spurious re-renders on cross-area writes"
  - "exportJSON fetches all body chunks in a single batched .get() — Hard Rule 3 compliance"
  - "handleFileSelected resets input.value after import — allows re-importing same file"
  - "Sub-component imports included in App.svelte; stub files deferred to Plans 03 and 04"
metrics:
  duration: "~2 min"
  completed: "2026-05-06T18:56:52Z"
  tasks_completed: 2
  files_modified: 4
---

# Phase 05 Plan 02: Popup Scaffold and Root App Component Summary

Popup entrypoint (index.html + main.ts) and root App.svelte component with complete Chrome storage data layer — Svelte 5 runes for reactive state, onMount hydration from two storage areas, onChanged subscriptions with area guards, and all action functions (push/pull/export/import).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create popup scaffold — index.html and main.ts | c1b4191 | src/popup/index.html, src/popup/main.ts |
| 2 | Create App.svelte root component and popup.css | 82d18dc | src/popup/App.svelte, src/popup/popup.css |

## Verification Results

| Check | Result |
|-------|--------|
| `grep "width: 360px" src/popup/popup.css` | Two matches (body + .popup) — PASS |
| `grep "mount(App" src/popup/main.ts` | Line 5 — PASS |
| `grep "SYNC_STATUS_KEY" src/popup/App.svelte` | 5 matches (import + 4 usages) — PASS |
| `grep "REGISTRY_KEY" src/popup/App.svelte` | 5 matches (import + 4 usages) — PASS |
| `grep "PUSH_NOW\|PULL_NOW\|IMPORT_ITEMS" src/popup/App.svelte` | All three message types present — PASS |
| `grep "area === 'local'\|area === 'sync'" src/popup/App.svelte` | Both area guards present — PASS |
| `grep "URL.createObjectURL" src/popup/App.svelte` | Line present — PASS |
| `grep "chrome.action" src/popup/App.svelte` | No matches — PASS (MV3 Pitfall 1 respected) |
| `grep "\$state\|\$derived\|onMount" src/popup/App.svelte` | Svelte 5 runes confirmed — PASS |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

App.svelte imports five sub-components (StatusHeader, InstructionList, ActionRow, ExportImportRow, BannerRow) that do not yet exist on disk. These are intentional plan-level stubs — Plans 03 and 04 create these files. The build will not be runnable until those plans complete.

## Threat Surface Scan

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-05-02-01 (Import file tampering) | MITIGATED — JSON.parse in try/catch + all-or-nothing field validation; malformed files set importMessage and return early before any sendMessage call |
| T-05-02-02 (XSS via title) | ACCEPTED — Svelte auto-escapes interpolations; no `{@html}` used anywhere |
| T-05-02-03 (Popup writing chrome.storage.sync) | MITIGATED — exportJSON only calls chrome.storage.sync.get; no .set in popup; PUSH_NOW/PULL_NOW/IMPORT_ITEMS route all writes through SW |
| T-05-02-04 (Export disclosure) | ACCEPTED — user-initiated, saves to user's own machine; no third-party calls |

## Self-Check: PASSED

- src/popup/index.html exists with #app div: CONFIRMED
- src/popup/main.ts exists with mount(App, ...): CONFIRMED
- src/popup/App.svelte exists with $state declarations: CONFIRMED
- src/popup/popup.css exists with width: 360px: CONFIRMED
- Commits c1b4191 and 82d18dc exist: CONFIRMED

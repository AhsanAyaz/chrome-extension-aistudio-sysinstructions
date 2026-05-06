---
phase: 05-popup-badge-export-import
plan: 04
subsystem: popup-components
tags: [svelte-5, popup, action-row, export-import, banner, error-copy, ui-03, ui-04, ui-05, ui-06, export-01, export-02]
dependency_graph:
  requires: [05-01]
  provides: [ActionRow.svelte, ExportImportRow.svelte, BannerRow.svelte]
  affects: [05-02, 05-03]
tech_stack:
  added: []
  patterns:
    - Svelte 5 $props() destructuring for component props
    - Svelte 5 $derived() rune for reactive derived state
    - onclick= handler syntax (no on:click — Svelte 5)
    - Record<ErrorState, string> exhaustive map for all 9 error states
    - Hidden file input pattern (display:none, bind:this, programmatic .click())
key_files:
  created:
    - src/popup/ActionRow.svelte
    - src/popup/ExportImportRow.svelte
    - src/popup/BannerRow.svelte
  modified: []
decisions:
  - "ERROR_COPY defined as Record<ErrorState, string> — TypeScript ensures exhaustive coverage of all 9 ErrorState values at compile time"
  - "BannerRow uses $derived() for isError and errorCopy — avoids template-level ternary complexity"
  - "dismiss-btn uses onclick={dismissHint} per Svelte 5 event handler syntax — no on:click"
metrics:
  duration: "~1 min"
  completed: "2026-05-06T18:57:07Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 05 Plan 04: ActionRow, ExportImportRow, BannerRow Svelte 5 Components Summary

Three popup sub-components with Push Now / Pull Now buttons (disabled during sync), Export JSON / Import JSON with hidden file input wiring, and an error/hint banner with exhaustive ERROR_COPY map covering all 9 ErrorState values.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create ActionRow.svelte and ExportImportRow.svelte | 2250553 | src/popup/ActionRow.svelte, src/popup/ExportImportRow.svelte |
| 2 | Create BannerRow.svelte with ERROR_COPY map | f9928de | src/popup/BannerRow.svelte |

## Verification Results

| Check | Result |
|-------|--------|
| `grep "disabled={isSyncing}" ActionRow.svelte` | 2 matches (Push Now + Pull Now) |
| `grep "fileInput.click()" ExportImportRow.svelte` | 1 match |
| All 9 ErrorState values in ERROR_COPY | 9 matches |
| `grep "dismiss-btn" BannerRow.svelte` | Present |
| `grep "$props()" all 3 files` | 3 matches |
| `grep "export let" all 3 files` | NONE (correct) |
| `grep "on:click" all 3 files` | NONE (correct) |
| accent color `#1a73e8` in ActionRow | Present (Push Now) |
| "Pull applied" refresh hint copy | Present in BannerRow |
| Post-commit file deletions | None |
| Untracked files | None |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All components are wired to receive real props from App.svelte. ERROR_COPY values are the production copy strings from UI-SPEC.

## Threat Flags

None. Banner text comes exclusively from the closed `Record<ErrorState, string>` constant — not from user or remote data. No injection surface (T-05-04-01 accept as planned). Import button triggers OS-level file picker — no extension privilege boundary (T-05-04-02 accept as planned).

## Self-Check: PASSED

- `src/popup/ActionRow.svelte` exists with `disabled={isSyncing}`: CONFIRMED
- `src/popup/ExportImportRow.svelte` exists with `fileInput.click()`: CONFIRMED
- `src/popup/BannerRow.svelte` exists with all 9 ERROR_COPY keys: CONFIRMED
- Commit 2250553 exists: CONFIRMED
- Commit f9928de exists: CONFIRMED

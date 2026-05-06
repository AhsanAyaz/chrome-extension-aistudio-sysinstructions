---
phase: 05-popup-badge-export-import
plan: 03
subsystem: popup-display-components
tags: [svelte5, popup, relativeTime, ui-01, ui-02]
dependency_graph:
  requires: [05-01]
  provides: [relativeTime-utility, StatusHeader-component, InstructionList-component]
  affects: [05-02, 05-04, 05-05]
tech_stack:
  added: []
  patterns:
    - "Svelte 5 $props() destructuring for sub-components (no export let)"
    - "hand-rolled relativeTime with 5 time buckets per UI-SPEC"
    - "{#each items as [uuid, rec] (uuid)} keyed iteration pattern"
key_files:
  created:
    - src/popup/relativeTime.ts
    - src/popup/StatusHeader.svelte
    - src/popup/InstructionList.svelte
  modified: []
decisions:
  - "relativeTime hand-rolled with 5 branches per UI-SPEC Timestamp display rule — no library"
  - "StatusHeader uses dynamic class state-{syncStatus.state} for CSS color binding — no JS conditionals"
  - "InstructionList uses {:else} block on {#each} for zero-items empty state — idiomatic Svelte"
  - "title truncation uses max-width 280px + white-space nowrap + text-overflow ellipsis per UI-SPEC"
metrics:
  duration: "~1 min"
  completed: "2026-05-06T21:15:40Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 05 Plan 03: relativeTime Utility + StatusHeader + InstructionList Summary

Hand-rolled relativeTime(epochMs) with 5 time buckets, Svelte 5 StatusHeader showing sync state/lastSyncAt/count, and Svelte 5 InstructionList with keyed {#each} and {:else} empty state — all stateless display components receiving props from App.svelte.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create relativeTime utility | b708d30 | src/popup/relativeTime.ts |
| 2 | Create StatusHeader.svelte and InstructionList.svelte | 5767df6 | src/popup/StatusHeader.svelte, src/popup/InstructionList.svelte |

## Verification Results

| Check | Result |
|-------|--------|
| `grep "export function relativeTime" src/popup/relativeTime.ts` | 1 match — line 12 |
| `grep "just now" src/popup/relativeTime.ts` | 2 matches — comment + code |
| `grep "min ago" src/popup/relativeTime.ts` | 2 matches — comment + code |
| `grep "\$props()" src/popup/StatusHeader.svelte` | 1 match — line 6 |
| `grep "\$props()" src/popup/InstructionList.svelte` | 1 match — line 7 |
| `grep "each items" src/popup/InstructionList.svelte` | 1 match — line 11 |
| `grep "No instructions yet" src/popup/InstructionList.svelte` | 1 match — line 19 |
| `grep "^  export let" src/popup/StatusHeader.svelte src/popup/InstructionList.svelte` | PASS — no matches |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Components are stateless display components receiving real-typed props from App.svelte (plan 05-02). No hardcoded data, no placeholder text in the render paths.

## Threat Flags

None. Svelte auto-escapes all `{rec.title}` and `{relativeTime(...)}` template interpolations. `{@html}` is not used anywhere in these components (T-05-03-01 accept disposition honored).

## Self-Check: PASSED

- `src/popup/relativeTime.ts` exists: CONFIRMED
- `src/popup/StatusHeader.svelte` exists: CONFIRMED
- `src/popup/InstructionList.svelte` exists: CONFIRMED
- Commit b708d30 exists: CONFIRMED
- Commit 5767df6 exists: CONFIRMED

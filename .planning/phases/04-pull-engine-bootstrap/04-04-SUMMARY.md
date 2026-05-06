---
phase: "04"
plan: "04"
status: complete
completed: "2026-05-06"
tdd_gates: [RED, GREEN]
---

# Plan 04-04: Bootstrap Union Merge (TDD)

## What Was Built

`src/background/bootstrap.ts` — bootstrap union merge handler for first-install flow.
`src/background/bootstrap.test.ts` — 12 test cases (6 handleLsBootstrap + 6 mergeRegistries unit tests).

## TDD Gate Sequence

- **RED** (`dd79e46`): 12 failing tests — bootstrap.ts did not exist
- **GREEN** (`5f96e5b`): all 12 tests pass — full implementation

## Key Decisions

- `mergeRegistries()` is a pure function — testable in isolation, no chrome API calls
- Single batched `chrome.storage.sync.set({ [REGISTRY_KEY]: merged, ...bodyWrites })` — Hard Rule 3 (no per-item write loop)
- BOOT-02 title-match: `titleToUuid` map built from remote registry; local items matched before UUID assignment
- Title collision (D-06): sort by `updatedAt` descending, first match wins, rest get fresh UUIDs
- Hard Rule 10 enforced: tombstone wins when `deletedAt > updatedAt` (pure comparison in `mergeRegistries`)
- BOOTSTRAP_NEEDED_KEY cleared only after successful `sync.set()` — Pitfall 3 guard
- Empty payload guard at top of `handleLsBootstrap` — Hard Rule 4
- `deliverToTab` reused from pull-engine (shared delivery path, no duplication)

## Must-Haves

- [x] `handleLsBootstrap` assigns UUIDs, union merge, single batched sync write, delivers APPLY_REMOTE, clears flag
- [x] Title-match reuses remote UUID (BOOT-02)
- [x] Title collision: first-by-updatedAt-desc wins (D-06)
- [x] Remote tombstone beats live local item (Hard Rule 10)
- [x] BOOTSTRAP_NEEDED_KEY cleared only after successful merge (Pitfall 3)
- [x] Empty payload guard (Hard Rule 4)
- [x] All 12 tests pass (98 total in full suite)

## Self-Check: PASSED

All must-haves verified. `tsc --noEmit` clean. Full suite 98/98 pass.

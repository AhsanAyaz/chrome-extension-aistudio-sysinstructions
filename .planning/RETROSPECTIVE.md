# Retrospective

## Milestone: v1.0 — MVP

**Shipped:** 2026-05-06
**Phases:** 5 | **Plans:** 26 | **Timeline:** 6 days

### What Was Built

- Storage schema + UUID identity model locked before any real data written
- MAIN-world localStorage observation pipeline with null-read guard
- Push engine: UUID assignment, per-item diff, 30s alarm-debounced batched sync writes
- Pull engine: bidirectional sync, tombstone-wins conflict resolution, multi-tab coordination
- Union-merge first-install bootstrap + account mismatch pre-flight
- Svelte 5 popup: sync status, instruction list, Push/Pull controls, 9-state error coverage, JSON export/import
- Dark-theme UI redesign post-milestone: Rubik font, WCAG AA contrast, pulsing status dot

### What Worked

- **Wave-based parallel execution** — independent plans ran in parallel git worktrees; most phases completed in under an hour
- **TDD-first for engine modules** — push-engine.ts and pull-engine.ts written test-first with fakeBrowser; caught 4 post-merge bugs before any Chrome testing
- **Hard Rules enforced from Phase 1** — no exceptions to single batched set(), no per-item write loops, tombstone semantics correct from day one
- **Popup last** — building the sync engine first meant Phase 5 was genuinely thin; no popup requirements bled into engine design
- **Post-execution code review** — caught CR-01 (listener leak), HR-01 (destructive import), HR-02 (revokeObjectURL race), HR-03 (PULL_NOW default) before shipping

### What Was Inefficient

- **STATE.md Accumulated Context grew unbounded** — by Phase 4 the decisions list was 40+ entries; hard to scan; should cap at ~20 recent + pointer to PROJECT.md
- **SUMMARY.md one_liner field not populated** — gsd-sdk summary-extract returned undefined for all 26 summaries; means progress tooling can't auto-extract accomplishments
- **Phase 02/03 VERIFICATION.md left as human_needed** — documentation artifact not updated after live DevTools verification; creates audit noise at milestone close

### Patterns Established

- `importItems()` vs `diffAndAccumulate()` separation — import is additive; observe is full-replacement; never conflate
- Svelte 5 onMount cleanup pattern: synchronous return `() => void`; async work as `void (async () => {...})()` IIFE inside
- `mockTabsQuery()` helper for chrome.tabs.query overload disambiguation in tests
- `_resetForTesting()` seam (Pattern S-4) as canonical SW-restart simulation — never use vi.resetModules()
- WXT-STATIC pattern: MAIN-world .js lives in `public/injected/`, not `src/`

### Key Lessons

1. **Read the hard rules before writing code in each phase** — HR-01 (destructive import) was missed because diffAndAccumulate was written for observation, then reused for import without checking semantics
2. **Update VERIFICATION.md status after live testing** — human_needed status left open creates false audit noise; takes 30 seconds to update
3. **Keep STATE.md decisions lean** — decisions belong in PROJECT.md Key Decisions table; STATE.md should hold only decisions affecting the current phase

### Cost Observations

- Model: Sonnet 4.6 (balanced profile)
- Sessions: ~6 (one per day, some intra-day)
- Notable: parallel wave execution kept per-phase time under 60 minutes; Phase 3 push engine completed in ~7 minutes wall time for the core TDD plans

---

## Cross-Milestone Trends

*(Populated after multiple milestones)*

| Metric | v1.0 |
|--------|------|
| Phases | 5 |
| Plans | 26 |
| Days | 6 |
| Tests | 126 |
| Source LOC | ~5,100 |
| Bugs caught pre-ship | 4 (code review) |

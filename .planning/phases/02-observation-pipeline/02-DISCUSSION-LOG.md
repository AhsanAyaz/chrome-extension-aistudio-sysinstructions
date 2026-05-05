# Phase 2: Observation Pipeline — Discussion Log

**Session:** 2026-05-05
**Outcome:** CONTEXT.md written, all decisions locked

## Gray Areas Presented

The following gray areas were identified for Phase 2:

1. **SW stub behavior** — What should the Phase 2 SW `onMessage` handler do when it receives an `LS_CHANGED` message?
2. Content script polling: `setInterval` vs `requestIdleCallback` interval chaining
3. WXT entrypoint registration approach for MAIN-world injector and content script
4. Test coverage strategy for SW handler, content script relay, MAIN-world injector
5. TypeScript type for `sysins:local:lastObserved` snapshot

## Discussion

### SW Stub Behavior (selected for discussion)

**Options presented:**
- A) Log only (`console.log` to SW console)
- B) Log + store snapshot to `chrome.storage.local` under `sysins:local:lastObserved`

**Decision:** Option B — Log + store snapshot. Rationale: enables DevTools panel verification via storage inspector in addition to SW console inspection. Also pre-positions Phase 3 to read the `lastObserved` key as the initial snapshot for diff computation.

**Follow-up decisions:**
- Snapshot key: `sysins:local:lastObserved` (within established `sysins:local:*` namespace, D-24 from Phase 1)
- Snapshot shape: `{ lastObservedAt: number, itemCount: number, items: RawInstruction[] }`
- Call `ensureInitialized()` in the onMessage handler (consistent with Phase 1 SW design, prevents Phase 3 rework)

### Remaining Gray Areas

All remaining gray areas (polling implementation, WXT entrypoints, test strategy, TS type placement) were deferred to Claude's discretion in CONTEXT.md. The user indicated readiness to proceed after the SW stub decision was resolved.

## Final Decisions Summary

| ID | Decision |
|----|----------|
| D-01 | SW stub: `console.log` + write `sysins:local:lastObserved` snapshot |
| D-02 | Snapshot shape: `{ lastObservedAt, itemCount, items: RawInstruction[] }` |
| D-03 | Call `ensureInitialized()` in `onMessage` handler |
| D-04 | `src/injected/ls-observer.js` — plain JS, self-contained, no module system |
| D-05 | Watched key: literal `'aistudio_all_system_instructions'` in injector |
| D-06 | Injector does NO parsing/filtering — raw value only (MAIN-world footprint minimization) |
| D-07 | Null/empty guard in content script — no LS_CHANGED if parse is null/not-array/empty-array |
| D-08 | Unknown fields forwarded verbatim — no field stripping in content script |
| D-09 | 2-second always-on polling fallback in content script |
| D-10 | postMessage filter: `event.data?.source === 'sysins-injected'` |

## Next Step

`/gsd-plan-phase 2`

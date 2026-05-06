# Phase 4: Pull Engine + Bootstrap - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver full bidirectional sync: the pull path (`chrome.storage.onChanged` → merge → content script → `localStorage`), the infinite-loop guard, multi-tab coordination, and the first-install union merge with account-mismatch pre-flight.

Out of phase: popup UI (Phase 5), export/import (Phase 5), tombstone GC (v1.x), any push-path changes (Phase 3 is locked).

</domain>

<decisions>
## Implementation Decisions

### BOOT-03: Account Mismatch Pre-flight (Spike-Gated)

- **D-01 (Spike-first order):** The first plan in Phase 4 is the BOOT-03 spike. No pull-engine or bootstrap code is written until the spike confirms: (a) whether `chrome.identity.getProfileUserInfo()` is callable without adding the `identity` manifest permission, and (b) where the AI Studio page exposes the signed-in account identifier in the DOM (avatar aria-label, page title, or similar). All remaining Phase 4 plans depend on this spike's findings.

- **D-02 (Happy path — identity available without permission):** If the spike confirms `chrome.identity.getProfileUserInfo()` is available without the `identity` permission, use it for the Chrome profile email. Scrape AI Studio's DOM for the signed-in account identifier. If they differ, set `sysins:local:syncStatus.errorState = 'ACCOUNT_MISMATCH'` and pause auto-sync. No sync cycle runs silently across mismatched accounts.

- **D-03 (Fallback — identity permission required):** If the spike finds the `identity` permission is required, add it to the manifest. DIST-02 permits this — "unless strictly required" — and account safety is strictly required for a sync extension. Record this in the Phase 4 plan as a new permission addition with a release-note entry.

### Infinite Loop Guard

- **D-04 (Diff-only, no suppression flag):** Phase 4 does NOT add a write-suppression flag to the content script. Phase 3's `diffAndAccumulate` already returns `hasChanges = false` when pull-applied data is identical to the last-pushed snapshot, so no flush alarm is scheduled. Adding a `window.__sysins_applying` flag is additional complexity for a case the diff already handles. If the stale-`lastPushed` edge case surfaces in testing, the fix is improving `lastPushed` durability — not adding a flag.

### Bootstrap Union Merge

- **D-05 (Trigger: content script on first page load):** `chrome.runtime.onInstalled` (reason `"install"`) writes `sysins:local:bootstrapNeeded: true` to `chrome.storage.local`. When the content script first loads on `https://aistudio.google.com/*` after install, it checks for this flag, reads `localStorage["aistudio_all_system_instructions"]`, and sends an `LS_BOOTSTRAP` message to the SW. The SW runs the union merge, then clears the `bootstrapNeeded` flag. This pattern works whether or not an AI Studio tab was open at install time.

- **D-06 (BOOT-02 title-match collision):** If multiple remote registry entries share the same title as a local item, the first remote entry (sorted by `updatedAt` descending) wins the title-match. Remaining remote entries with the same title receive fresh UUIDs. Title uniqueness is the user's responsibility in AI Studio; ambiguous matches are handled gracefully, not rejected.

### Multi-Tab Deduplication

- **D-07 (SW picks active tab):** When a remote pull arrives, the SW queries `chrome.tabs.query({ url: '*://aistudio.google.com/*', active: true })`. It sends `APPLY_REMOTE` to the first result (the focused AI Studio tab). No broadcast, no coordination protocol. If no tab is marked active, fall through to D-08.

- **D-08 (No-active-tab fallback — pending remote queue):** If no active AI Studio tab is found, the SW writes the merged instruction array to `sysins:local:pendingRemote` in `chrome.storage.local`. The content script polls this key on `visibilitychange` (tab regains focus) and applies it, then clears the key. Pull is never lost — only deferred until the user returns to the AI Studio tab.

### Claude's Discretion

- Exact shape of `sysins:local:bootstrapNeeded` (boolean vs. `{triggeredAt: number}`) — planner decides.
- Exact shape of `sysins:local:pendingRemote` — planner designs the key alongside `APPLY_REMOTE` message type.
- Whether `LS_BOOTSTRAP` reuses the same message handler as `LS_CHANGED` (with a `type` discriminator) or is a separate handler.
- Tombstone GC design is in-scope per Phase 1's schema (the `deletedAt` field is sufficient); implementation may be deferred to v1.x per ROADMAP.md Phase 1 note — planner decides if GC belongs in Phase 4 or v1.x.
- Exact BOOT-03 spike plan structure — one plan before the rest, or a spike sub-task within Plan 04-01.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Charter & Requirements
- `.planning/PROJECT.md` — vision, hard rules (Rule #4 null-read guard, Rule #5 union merge, Rule #6 SW-only merge, Rule #8 best-effort StorageEvent, Rule #10 tombstone precedence)
- `.planning/REQUIREMENTS.md` — PULL-01 through PULL-05, BOOT-01 through BOOT-03 are Phase 4's scope
- `.planning/ROADMAP.md` §"Phase 4: Pull Engine + Bootstrap" — goal, 6 success criteria (note: criterion 6 is BOOT-03, spike-gated)
- `CLAUDE.md` — Hard Rules #4, #5, #6, #8, #10 directly constrain this phase

### Prior Phase Context (locked decisions)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-06 (reconstruct order), D-13 (syncPending sentinel), D-14 (pendingMerges queue, cap=10), D-15 (syncStatus schema + ACCOUNT_MISMATCH error tag), D-16 (UUID identity), D-17 (UUID source), D-18 (tombstone semantics), D-19 (no identity permission default), D-24 (constants source-of-truth)
- `.planning/phases/02-observation-pipeline/02-CONTEXT.md` — D-07 (null-read guard), D-09 (polling fallback)

### Research (architecture and pitfalls)
- `.planning/research/ARCHITECTURE.md` §"Storage Layout" — registry/body separation, chunk reassembly
- `.planning/research/PITFALLS.md` §SYNC-1 — infinite sync loop mechanics and avoidance
- `.planning/research/PITFALLS.md` §SYNC-3 — first-install overwrite pitfall (motivates BOOT-01 union merge)
- `.planning/research/PITFALLS.md` §AISTUDIO-3 — synthetic StorageEvent unreliability; "Refresh AI Studio" hint is the correct fallback (PULL-03)
- `.planning/research/PITFALLS.md` §AISTUDIO-4 — account mismatch: `chrome.identity.getProfileUserInfo()` pattern, DOM identifier location (to be confirmed by spike)

### Existing Phase 3 Code
- `src/background/push-engine.ts` — `diffAndAccumulate`, `drainPendingWrite`, `clearPendingWrite`; Phase 4 pull engine reuses this diff for loop guard (D-04)
- `src/background/alarm-flush.ts` — `flushPendingWrite`, `removeStaleBodyKeys`, `writeLastPushed`; pull engine reads the same `LAST_PUSHED_KEY` baseline
- `src/background/index.ts` — `ensureInitialized`, `onMessage`, `onAlarm`; Phase 4 adds `chrome.storage.onChanged` and `chrome.tabs.sendMessage` listeners here (see Phase 4 boundary comment at bottom of file)
- `src/background/sync-state.ts` — `LAST_PUSHED_KEY`, `writeSyncStatus`, `setErrorState`; pull engine uses these directly
- `src/background/registry.ts` — `getRegistry`, `applyRemote`; Phase 4 pull merge logic builds on these
- `src/shared/constants.ts` — Phase 4 adds `BOOTSTRAP_NEEDED_KEY`, `PENDING_REMOTE_KEY` constants here
- `src/shared/types.ts` — Phase 4 adds `ApplyRemoteMessage`, `BootstrapMessage`, `PendingRemoteState` types here

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `diffAndAccumulate` in `push-engine.ts`: Phase 4 pull path runs incoming remote items through the same diff to detect what actually changed vs. last-pushed — loop guard by design (D-04).
- `applyRemote` in `registry.ts`: already implements last-write-wins + tombstone-wins logic per D-06/D-18. Pull engine calls this to merge remote registry with local registry.
- `ensureInitialized` in `index.ts`: call at top of `chrome.storage.onChanged` handler, same as `onMessage` — consistent orphan-recovery pattern.
- `setErrorState` in `sync-state.ts`: Phase 4 calls this with `'ACCOUNT_MISMATCH'` when the BOOT-03 pre-flight check fails. The error shape is already defined in D-15.
- `isValidPayload` in `content/index.ts` (or `shared/guard.ts`): content script already has the null/empty guard — `LS_BOOTSTRAP` message should reuse the same guard before sending.

### Established Patterns
- All `sysins:local:*` keys are constants in `shared/constants.ts` (D-24) — `BOOTSTRAP_NEEDED_KEY` and `PENDING_REMOTE_KEY` must live there.
- Single batched `chrome.storage.local.set({...})` — Hard Rule 3 applies to local writes too; no per-key loops.
- `_resetForTesting()` seam (Pattern S-4) in `index.ts` — pull-engine tests simulate SW restart the same way Phase 3 tests do.
- `fakeBrowser` from `wxt/testing/fake-browser` with `globals: false` — all Phase 4 unit tests follow the same import pattern.

### Integration Points
- `src/background/index.ts`: add `chrome.storage.onChanged.addListener(handleRemoteChanged)` and the tab-focus `chrome.tabs.onActivated` listener (or content script visibility polling) to Phase 4 boundary comment block.
- `src/content/index.ts`: add `bootstrapNeeded` check on first load + `visibilitychange` listener for `pendingRemote` polling.
- `wxt.config.ts`: may need `tabs` permission added if `chrome.tabs.query` is used (confirm during spike/planning — `tabs` permission is broader than desired; `activeTab` may suffice or `tabs` may not be needed if query is by URL pattern).

</code_context>

<specifics>
## Specific Ideas

- The user chose the recommended option for every decision in Phase 4, consistent with Phases 1 and 2 behavior. Research-backed defaults continue to be treated as load-bearing.
- The BOOT-03 spike is a hard gate: no Phase 4 implementation plans should be written until the spike result is known. The spike resolves D-02 vs. D-03 (identity permission) and locates the AI Studio DOM identifier.
- The `sysins:local:pendingRemote` key (D-08) is a new local schema key that Phase 1 did not anticipate. It must be added to `constants.ts` and its shape defined in `types.ts` — but it does NOT change `schemaVersion` (it is a `sysins:local:*` key, not a `sysins:*` sync key, and is purely additive).
- The `LS_BOOTSTRAP` message type is a new discriminant on the content script → SW message bus. It shares the same port-keeping `return true` async pattern as `LS_CHANGED`.

</specifics>

<deferred>
## Deferred Ideas

- Tombstone GC implementation — designed in Phase 1 schema (deletedAt field is sufficient); execution may be v1.x per ROADMAP.md Phase 1 note. Planner decides if Phase 4 is the right time.
- Visual merge-result notification ("N instructions merged from this device, M pulled from other") — a popup-phase concern, not Phase 4.
- `tabs` vs. `activeTab` permission analysis for `chrome.tabs.query` — flag for spike to confirm so wxt.config.ts permission addition is minimal.

### Reviewed Todos (not folded)

(None — `gsd-sdk query todo.match-phase 4` returned 0 matches.)

</deferred>

---

*Phase: 04-pull-engine-bootstrap*
*Context gathered: 2026-05-06*

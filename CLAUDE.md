# CLAUDE.md — AI Studio Instructions Sync

This file orients Claude (and other agents) to this project. Read it first.

## Project

**AI Studio Instructions Sync** — a Chrome Manifest V3 extension that syncs Google AI Studio's `localStorage["aistudio_all_system_instructions"]` across the user's signed-in Chrome devices via `chrome.storage.sync`.

**Core value:** Open AI Studio on any signed-in Chrome and see the same up-to-date library of system instructions — automatically, with no clicks.

See `.planning/PROJECT.md` for the full project context, requirements, constraints, and key decisions.

## Planning Artifacts

| Artifact | Purpose |
|----------|---------|
| `.planning/PROJECT.md` | Project context, core value, requirements (Validated/Active/OOS), key decisions |
| `.planning/REQUIREMENTS.md` | 33 v1 requirements with REQ-IDs, mapped to phases |
| `.planning/ROADMAP.md` | 5 phases, dependencies, success criteria |
| `.planning/STATE.md` | Project memory — current phase, last action |
| `.planning/research/` | STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md, SUMMARY.md |
| `.planning/config.json` | Workflow preferences (mode, granularity, models, agents) |

## Tech Stack (from research/STACK.md)

- **Framework:** WXT 0.20.25 (Vite-based MV3 scaffold, typed storage, `fakeBrowser` for unit tests)
- **Language:** TypeScript ~5.8
- **Popup UI:** Svelte 5.55.5 (compiled reactivity, ~2-3 KB runtime) — vanilla TS is acceptable if Svelte feels heavy for the popup scope
- **Testing:** Vitest 4.x with WXT's `WxtVitest()` plugin and `fakeBrowser`
- **UUIDs:** `crypto.randomUUID()` (built-in; do not install the `uuid` npm package)
- **Chunking:** roll-your-own (~100 lines); no library is actively maintained for this

**Do not use:** Plasmo (maintenance mode), React for the popup (45 KB runtime overkill), `webextension-polyfill` (replaced by WXT's `@wxt-dev/browser`), `chrome-storage-largeSync` (dormant).

## Architecture (from research/ARCHITECTURE.md)

Strict layering:

- **MAIN-world injector** (`src/injected/ls-observer.js`) — patches `Storage.prototype.setItem` at `document_start`. No chrome APIs, no state. Posts to content script via `window.postMessage`.
- **Content script** (`src/content/content.ts`) — relay only. Reads/writes `localStorage`, dispatches synthetic `StorageEvent`. No business logic.
- **Service worker** — owns *everything*: merge, conflict resolution, UUID assignment, tombstones, chunking, rate limiting, all `chrome.storage.sync` I/O.
- **Popup** — dumb view. Queries the SW for status; never talks to `chrome.storage.sync` directly.

**Storage layout (irreversible once deployed — Phase 1):**
- `sysins:meta` → `{ schemaVersion: 1, lastPushAt, lastPullAt }`
- `sysins:registry` → `{ uuid → { title, updatedAt, deletedAt } }` (sharded if >8KB)
- `sysins:body:<uuid>` → instruction text (chunked at 7KB if needed: `:c0`, `:c1`, …)

## Hard Rules (from research/SUMMARY.md "What to lock in roadmap")

1. **Storage schema is frozen in Phase 1.** Never write to `chrome.storage.sync` outside the `sysins:*` namespace. Keep the `schema_version` key from day one.
2. **UUID is the permanent identity.** Title-matching is bootstrap-only — used once to unify pre-UUID local items with remote, then never again.
3. **Every `chrome.storage.sync` write is a single batched `set({...})`.** Per-item write loops are prohibited (they blow the 120/min, 1800/hr rate limits).
4. **A `null`/empty `localStorage` read is never auto-propagated as a delete.** Empty results are a detection failure unless the user explicitly clicks Push Now.
5. **First-install is a union merge, not a pull-overwrite.** Items present on either side survive.
6. **All merge logic lives in the service worker.** The content script is a relay.
7. **Error surfacing is built alongside the sync engine (Phase 3+), not bolted on at Phase 5.** Every sync ends in an explicit green/amber/red badge — no silent fourth state.
8. **Live update via synthetic `StorageEvent` is best-effort by design.** The "Refresh AI Studio" hint is the documented fallback, not a bug.
9. **All sync state is persisted to `chrome.storage.local`** (last-pushed snapshot, in-progress flag, pending-merge queue). Service worker globals are ephemeral — never trust them.
10. **Tombstones win over live items** when `deleted_at > updated_at`. Naive last-write-wins on a single `updated_at` field would let an old live copy resurrect a delete.

## GSD Workflow

This project uses GSD (Get Shit Done) for planning and execution.

| Phase | Command |
|-------|---------|
| Discuss / refine a phase | `/gsd-discuss-phase <N>` |
| Generate UI contract (frontend phases) | `/gsd-ui-phase <N>` |
| Plan a phase | `/gsd-plan-phase <N>` |
| Execute the plan | `/gsd-execute-phase <N>` |
| Verify a phase against goal | `/gsd-verify-work <N>` |
| Phase status / next step | `/gsd-progress`, `/gsd-next` |
| Project state and resume | `/gsd-resume-work` |

**Config (`.planning/config.json`):**
- Mode: `yolo` — auto-approve, just execute
- Granularity: `coarse` — 5 phases for this project (architecture-driven, not arbitrary)
- Parallel execution enabled
- Research, plan-check, and verifier agents are all enabled
- Model profile: `balanced` (Sonnet)

## Working Conventions

- **Commit early, commit often.** GSD commits atomically per artifact during planning. Code commits should be small and reversible.
- **Update `.planning/STATE.md`** when you finish a unit of work or change phase.
- **Don't change locked decisions silently.** If you discover a Phase-1 decision (storage schema, identity model) needs to change, that's a project-level decision and belongs in `/gsd-discuss-phase` with the user, not a stealth refactor.
- **No telemetry, no third-party calls.** This is one of the project's hard constraints (DIST-04). Don't add error reporting SDKs, analytics, or "phone home" code.

## Next Step

Run `/gsd-discuss-phase 1` to refine and plan Phase 1 (Foundation — storage schema, identity model, scaffold, distribution hygiene).

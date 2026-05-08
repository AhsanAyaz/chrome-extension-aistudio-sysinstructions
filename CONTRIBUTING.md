# Contributing

## Architecture

Strict layering — never cross these boundaries:

```
MAIN-world injector (ls-observer.js)
        ↓  window.postMessage
Content script (content/index.ts)       ← relay only; no business logic
        ↓  chrome.runtime.sendMessage
Service worker (background/)            ← owns ALL merge, sync, and storage logic
        ↑  chrome.runtime.sendMessage
Popup (popup/)                          ← dumb view; reads local storage, sends commands
        ↓  REST API
Google Drive AppData                    ← cross-device sync backend
```

**The content script is a relay.** It reads/writes `localStorage` and forwards messages. It never does merge logic or sync decisions.

**The popup is a thin view.** It reads `chrome.storage.local` for status and the Drive cache for the registry. It does not write to Drive directly.

**The service worker owns everything.** UUID assignment, merge logic, Drive reads/writes, conflict resolution, tombstones, chunking, error surfacing — all of it lives in `background/`.

**`drive-client.ts` is the only file allowed to call `fetch()`.** The `dist-04.test.ts` static scan enforces this. Do not add `fetch` calls anywhere else.

## Hard Rules

These rules enforce storage and sync correctness. Violating them causes subtle data loss or sync storms.

1. **`sysins:*` namespace only.** All Drive data keys and all `chrome.storage.local` keys must be under `sysins:*` / `sysins:local:*`. Never write outside this prefix.

2. **UUID is permanent.** Title-matching is bootstrap-only (first install). Once a UUID is assigned, it never changes — renames are not new items.

3. **Single batched Drive write per flush cycle.** All pending changes accumulate in `pendingWrite` and are written to Drive in one read-modify-write call (`flushToDrive`). Never loop calling Drive write per item.

4. **Null/empty `localStorage` read is not a delete.** An empty or missing `localStorage["aistudio_all_system_instructions"]` means the observation failed, not that the user deleted everything. Hard Rule 4 / PUSH-05: `diffAndAccumulate([])` is a no-op.

5. **First-install is a union merge.** New device = preserve instructions from both local and remote. The bootstrap polls Drive before building the merge so it sees the current remote state.

6. **Merge logic lives in the service worker.** Full stop.

7. **Error states are visible.** Every sync outcome must resolve to green/amber/red badge. No silent fourth state.

8. **`importItems()` ≠ `diffAndAccumulate()`.** Import is additive (union merge — never tombstone absent items). `diffAndAccumulate` is full-replacement semantics (for observing all of localStorage). Never use `diffAndAccumulate` for import.

9. **Tombstone resurrection rejection.** An older live `updatedAt` does NOT revive a newer `deletedAt`. `mergeRemoteRegistry` enforces this: `max(updatedAt, deletedAt ?? 0)` is the authority timestamp.

10. **Bootstrap must poll Drive before reading registry.** `handleLsBootstrap` calls `pollDriveForChanges(true)` before `getRegistry()` to prime the local cache. Without this, a fresh device with an empty cache would overwrite Drive with only its local instructions.

11. **Pull merges, never replaces.** `pollAndPull` snapshots the local cache before calling `pollDriveForChanges`, then merges remote into local using `mergeRemoteRegistry`. Local-only items are preserved.

## Dev Setup

```bash
git clone https://github.com/ahsan-ubitian/aistudio-instructions-sync.git
cd aistudio-instructions-sync
npm install
npm run build
```

Load the unpacked extension from `.output/chrome-mv3/` in `chrome://extensions` (Developer mode on).

For live development:

```bash
npm run dev
```

WXT rebuilds on file save. Click the reload icon on the extension card in `chrome://extensions` after each rebuild to pick up service worker changes.

## Tests

```bash
npm run test          # Run all tests once
npm run test:watch    # Watch mode
npm run compile       # TypeScript type-check without emitting
```

Tests use [Vitest](https://vitest.dev/) with WXT's `fakeBrowser` for Chrome API mocks. Unit tests live alongside source files (`*.test.ts`).

**Key test patterns:**

- `fakeBrowser.reset()` in `beforeEach` — clears all fake Chrome storage between tests.
- `_resetForTesting()` from `index.ts` — simulates a service worker kill+wake. Use this to test resume-after-kill scenarios. Never use `vi.resetModules()`.
- `fakeBrowser` does not implement `setBadgeText`/`setBadgeBackgroundColor` — mock these explicitly with `vi.spyOn(chrome.action, ...).mockResolvedValue(undefined)`.
- Drive calls (`flushToDrive`, `pollDriveForChanges`, `readDriveFile`, `writeDriveFile`) must be mocked via `vi.mock('./drive-client', ...)`. `readDriveCache` and `writeDriveCache` read/write `chrome.storage.local` and can use `fakeBrowser` directly without mocking.
- `vi.clearAllMocks()` before `vi.restoreAllMocks()` in `beforeEach` when using `vi.mock` — `vi.restoreAllMocks()` does not reset call counts on module-level mocks.

**Test file overview:**

| File | What it covers |
|------|---------------|
| `registry.test.ts` | CRUD, mergeRemoteRegistry, reconstructInstructions, tombstone semantics |
| `push-engine.test.ts` | diffAndAccumulate, UUID assignment, tombstoning, chunking |
| `alarm-flush.test.ts` | scheduleFlush debounce, flushPendingWrite success/error paths |
| `pull-engine.test.ts` | pollAndPull cases, merge-not-replace, deliverToTab |
| `bootstrap.test.ts` | mergeRegistries pure function, handleLsBootstrap union merge |
| `service-worker.test.ts` | initializeMeta, ensureInitialized orphan recovery |
| `build.test.ts` | Manifest permissions, host_permissions, minimum_chrome_version |
| `dist-04.test.ts` | Static scan: no forbidden network calls outside drive-client.ts |

## Key Files to Read First

| File | Why |
|------|-----|
| `src/shared/constants.ts` | All storage key names — single source of truth |
| `src/shared/types.ts` | SyncRegistry, DriveCache, SyncStatus, ErrorState |
| `src/background/drive-client.ts` | Drive auth, read/write, poll, flush — the sync backbone |
| `src/background/registry.ts` | UUID identity, mergeRemoteRegistry, reconstructInstructions |
| `src/background/push-engine.ts` | diffAndAccumulate — how edits become pending writes |
| `src/background/alarm-flush.ts` | flushPendingWrite — the batched Drive write path |
| `src/background/pull-engine.ts` | pollAndPull — the merge-on-pull path |
| `src/background/index.ts` | All message handlers and alarm wiring |

## Making Changes

1. **Unit test first** for any service worker changes. The `fakeBrowser` environment is reliable; real Chrome DevTools testing is for integration verification only.
2. **Keep the content script as a relay.** If you are adding logic to `content/index.ts` beyond reading/writing localStorage and forwarding messages, it belongs in the service worker instead.
3. **Check the Hard Rules above** before touching storage keys, merge logic, or Drive write paths.
4. **Run the full test suite before opening a PR:** `npm run test && npm run compile`.
5. **`drive-client.ts` is the only authorized `fetch()` caller.** The `dist-04.test.ts` scan will fail if `fetch(` appears in any other source file.
6. **Storage schema changes are irreversible.** The `sysins:registry` key structure and the Drive file format are frozen. Changing them requires a schema migration plan and a bumped `schemaVersion`.

## Submitting Changes

1. Fork and create a branch from `main`
2. Make atomic commits with clear messages
3. Ensure `npm run test` and `npm run compile` pass clean
4. Open a PR with a description of what changed and why

For larger changes (new sync behaviors, storage schema changes, Drive write strategy changes), open an issue first. Storage schema and Drive file format changes are irreversible once deployed to multiple devices.

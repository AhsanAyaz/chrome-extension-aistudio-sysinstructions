# Contributing

## Architecture

Strict layering — never cross these boundaries:

```
MAIN-world injector (ls-observer.js)
        ↓  window.postMessage
Content script (content/index.ts)   ← relay only, no business logic
        ↓  chrome.runtime.sendMessage
Service worker (background/)        ← owns ALL merge, sync, and storage logic
        ↑  chrome.runtime.sendMessage
Popup (popup/)                      ← dumb view, reads storage, sends commands
```

The content script is a relay. It reads/writes `localStorage` and forwards messages. It never does merge logic or sync decisions — those belong exclusively in the service worker.

The popup is a thin view. It reads `chrome.storage.local` for status and `chrome.storage.sync` for the registry. It does not write to sync directly.

## Hard Rules

These rules enforce the storage and sync correctness guarantees. Violating them causes subtle data loss or sync storms.

1. **`sysins:*` namespace only.** Never write to `chrome.storage.sync` outside the `sysins:*` prefix.
2. **UUID is permanent.** Title-matching is bootstrap-only (first-install). Once a UUID is assigned, it never changes — renames are not new items.
3. **Single batched `set()` per push cycle.** Never loop over items calling `sync.set()` per item. Rate limits are 120 writes/min. One `set({...all changed keys})` per flush.
4. **Null/empty localStorage is not a delete.** An empty or missing `localStorage["aistudio_all_system_instructions"]` read means the observation failed, not that the user deleted everything.
5. **First-install is a union merge.** New device = preserve instructions from both local and remote. Never overwrite.
6. **Merge logic lives in the service worker.** Full stop.
7. **Error states are visible.** Every sync outcome must resolve to green/amber/red badge. No silent fourth state.
8. **`importItems()` ≠ `diffAndAccumulate()`.** Import is additive (union merge — never tombstone absent items). `diffAndAccumulate` is full-replacement semantics (for observing all of localStorage). Never use `diffAndAccumulate` for import.

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

WXT rebuilds on file save. Reload the extension card in `chrome://extensions` after each rebuild to pick up service worker changes.

## Tests

```bash
npm run test          # Run all tests once
npm run test:watch    # Watch mode
npm run compile       # TypeScript type-check without emitting
```

Tests use [Vitest](https://vitest.dev/) with WXT's `fakeBrowser` for chrome API mocks. Unit tests live alongside source files (`*.test.ts`).

Key test patterns:
- `_resetForTesting()` exported from `sync-state.ts` — canonical SW-restart simulation. Use this to test resume-after-kill scenarios. Never use `vi.resetModules()`.
- `fakeBrowser` does not implement `setBadgeText`/`setBadgeBackgroundColor` — mock these explicitly with `vi.spyOn().mockResolvedValue()`.
- `chrome.identity` is not in `fakeBrowser` — stub via `globalThis`.

## Key Files to Read First

| File | Why |
|------|-----|
| `src/shared/constants.ts` | All storage key names |
| `src/shared/types.ts` | SyncRegistry, RegistryRecord, SyncStatus, ErrorState |
| `src/background/registry.ts` | UUID identity, applyRemote merge logic |
| `src/background/push-engine.ts` | diffAndAccumulate, importItems |
| `src/background/alarm-flush.ts` | flushPendingWrite — the batched sync write path |
| `src/background/index.ts` | All message handlers wired together |

## Making Changes

1. **Unit test first** for any service worker changes. The `fakeBrowser` environment is reliable; real Chrome DevTools testing is for integration verification.
2. **Keep the content script as a relay.** If you're tempted to add logic to `content/index.ts` beyond reading/writing localStorage and forwarding messages, it probably belongs in the service worker.
3. **Check the Hard Rules above** before touching storage keys or merge logic.
4. **Run the full test suite** before opening a PR: `npm run test && npm run compile`.
5. **No third-party network calls.** The `dist-04.test.ts` static scan will catch `fetch`, `XMLHttpRequest`, and `WebSocket` in source files.

## Submitting Changes

1. Fork and create a branch from `main`
2. Make your changes with atomic commits
3. Ensure `npm run test` and `npm run compile` pass clean
4. Open a PR with a clear description of what and why

For larger changes (new sync behaviors, storage schema changes), open an issue first to discuss the approach. Storage schema changes are irreversible once deployed.

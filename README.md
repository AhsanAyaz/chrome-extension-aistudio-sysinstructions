# AI Studio Sync

A Chrome extension that syncs your [Google AI Studio](https://aistudio.google.com) system instructions across every device where you're signed into Chrome — automatically, with no clicks.

AI Studio stores your saved system instructions in `localStorage`, which is per-device and per-browser-profile only. This extension lifts that data into `chrome.storage.sync` so your entire library follows you everywhere your Google account goes.

## Why This Exists

If you use AI Studio on multiple machines, you know the frustration: prompts you crafted on your work machine aren't available on your laptop, and vice versa. Chrome syncs bookmarks and passwords automatically — your system instructions should too.

This extension makes that happen using the same Chrome sync infrastructure, with no custom server and no third-party services. Your data never leaves your own Google account.

## Features

- **Automatic bidirectional sync** — edits on any machine propagate everywhere within ~30 seconds
- **Conflict-free merges** — per-instruction timestamps, last-write-wins, soft-delete tombstones
- **First-install union merge** — installing on a new machine preserves instructions from both sides
- **Account safety** — auto-sync pauses if your Chrome profile and AI Studio account don't match
- **Toolbar popup** — sync status, instruction list, manual Push Now / Pull Now controls
- **JSON export / import** — full backup and restore from a single file
- **Zero infra** — no backend, no telemetry, no third-party calls; Chrome sync is the only backend

## Prerequisites

- Chrome (or any Chromium browser that uses a Google account for `chrome.storage.sync`)
- Node.js 18+ and npm (for building from source)

## Install (Sideload)

```bash
git clone https://github.com/ahsan-ubitian/aistudio-instructions-sync.git
cd aistudio-instructions-sync
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3/` directory

The extension icon appears in your toolbar. Open AI Studio and your instructions will start syncing.

## Cross-Device Sync Setup

> **This step is required for sync to work.** Chrome scopes `chrome.storage.sync` by
> extension ID. If two devices load the extension with different IDs, they will never
> share data — even with the same Google account.

This extension pins its ID using a manifest `key` field. The expected ID on every device is
**`kacgdabapihhffejhjlmpmjnpchlknfe`**. Follow these steps on **every device**:

### First-time setup (or after updating the key)

1. Build: `npm run build`
2. If the extension was previously sideloaded, **remove it completely** from `chrome://extensions`
   (click the trash icon — do **not** just click the reload icon; reload keeps the old random ID).
3. Click **Load unpacked** and select the `.output/chrome-mv3/` directory.
4. In `chrome://extensions`, confirm the ID shown is `kacgdabapihhffejhjlmpmjnpchlknfe`.

### Verify Chrome sync is configured

5. Open `chrome://settings/syncSetup` on both devices.
6. Confirm Chrome sync is **on** (not paused).
7. Confirm the **Extensions** category is included in sync.

### Confirm both devices share the same namespace

Open the DevTools console on the service worker (`chrome://extensions` → the extension card → "Inspect" link) and run:

```js
chrome.runtime.id          // must print the same ID on both devices
chrome.storage.sync.get(null, console.log)   // must show the same data after a push
```

The extension also logs its ID on every service-worker startup: look for `[sysins] extension ID:` in the console.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| IDs differ between devices | Remove + re-add the extension on the device with the wrong ID |
| IDs match but data differs | Wait 30–60 s; use Push Now / Pull Now |
| Pull Now sees nothing on the other device | Rebuild on the pushing device; verify same Google account |
| Sync never arrives | Check `chrome://settings/syncSetup` — Extensions category must be checked |

## Dev Commands

```bash
npm run dev        # Start WXT in watch mode (auto-rebuilds)
npm run build      # Production build → .output/chrome-mv3/
npm run test       # Run Vitest unit tests (126 tests)
npm run compile    # TypeScript type-check only
npm run lint       # ESLint
npm run zip        # Build + zip for distribution
```

After any `build` or `dev` rebuild, go to `chrome://extensions` and click the refresh icon on the extension card to reload it.

## Project Structure

```
src/
├── background/           # Service worker — owns ALL sync logic
│   ├── index.ts          # SW entrypoint, message router, alarm/event wiring
│   ├── push-engine.ts    # Diff, UUID assignment, pendingWrite accumulation
│   ├── alarm-flush.ts    # 30s debounced batched chrome.storage.sync.set()
│   ├── pull-engine.ts    # handleRemoteChanged, deliverToTab
│   ├── bootstrap.ts      # First-install union merge, title-match UUID assignment
│   ├── account-preflight.ts  # Chrome identity vs AI Studio DOM mismatch check
│   ├── registry.ts       # UUID identity, updatedAt, tombstone semantics
│   ├── storage-layout.ts # Chunking / reassembly for instructions > 7KB
│   ├── meta-bootstrap.ts # sysins:meta write-if-absent on onInstalled
│   └── sync-state.ts     # chrome.storage.local resume schema
├── content/
│   └── index.ts          # Content script — relay only; no business logic
├── injected/
│   └── ls-observer.js    # MAIN-world Storage.prototype.setItem patch
├── popup/
│   ├── App.svelte        # Root component, state, export/import
│   ├── StatusHeader.svelte
│   ├── InstructionList.svelte
│   ├── ActionRow.svelte
│   ├── ExportImportRow.svelte
│   ├── BannerRow.svelte
│   ├── relativeTime.ts
│   ├── popup.css
│   └── index.html
├── shared/
│   ├── constants.ts      # All sysins:* key constants
│   ├── types.ts          # SyncRegistry, RegistryRecord, SyncStatus, ErrorState…
│   └── meta-guard.ts     # Runtime guard for sysins:meta reads
public/
└── injected/
    └── ls-observer.js    # Static copy (WXT copies plain .js from public/, not src/)
```

## Storage Layout

All data lives under the `sysins:*` namespace in `chrome.storage.sync`:

| Key | Contents |
|-----|----------|
| `sysins:meta` | `{ schemaVersion: 1, lastPushAt, lastPullAt }` |
| `sysins:registry` | `{ [uuid]: { title, updatedAt, deletedAt, chunks } }` |
| `sysins:body:<uuid>:c0` | Instruction text chunk 0 (≤ 7KB each) |
| `sysins:body:<uuid>:c1` | Instruction text chunk 1 (if needed) |

Local state lives in `chrome.storage.local` under `sysins:local:*` (last-pushed snapshot, pending writes, sync status, bootstrap flags).

## Privacy

- All instruction data stays inside your own Google Chrome sync
- Zero third-party network calls (enforced by a static code scan in the test suite)
- No analytics, no telemetry, no crash reporting

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Personal use. Not yet published to the Chrome Web Store.

# Privacy Policy — AI Studio Instructions Sync

**Last updated:** 2026-05-08

## What this extension does

AI Studio Instructions Sync reads your system instructions from Google AI Studio's `localStorage` and syncs them across your signed-in Chrome devices using your own Google Drive AppData folder.

## Data collected

This extension does **not** collect, transmit, or store any data on external servers.

The only data processed is your AI Studio system instructions (titles and text). This data is:

- Read from `localStorage` on `aistudio.google.com`
- Stored exclusively in your own Google Drive AppData folder (`drive.appdata` scope)
- Cached locally in `chrome.storage.local` on each device for performance

## Where your data goes

**Your Google Drive AppData folder only.** This is a private folder created by the extension in your own Google account. It is:

- Not visible in the Google Drive UI
- Not accessible to any other application or person
- Not shared with the extension developer or any third party

## Network calls

The extension makes network calls to **Google APIs only**:

- `https://www.googleapis.com/` — Drive REST API for reading and writing the sync file

No other domains are contacted. This is enforced by a static code scan in the test suite (`dist-04.test.ts`).

## Permissions used

| Permission | Why |
|------------|-----|
| `storage` | Cache sync state locally (`chrome.storage.local`) |
| `identity`, `identity.email` | Obtain an OAuth token for Drive API access |
| `alarms` | 30-second background poll for remote changes |
| `scripting` | Inject the localStorage observer into AI Studio tabs |
| `https://aistudio.google.com/*` | Read and write AI Studio's localStorage |
| `https://www.googleapis.com/*` | Drive REST API calls |

The OAuth token is obtained via `chrome.identity.getAuthToken()` using your existing Chrome sign-in. The extension requests only the `drive.appdata` scope — it cannot read, modify, or delete any other files in your Google Drive.

## Analytics and telemetry

None. The extension contains no analytics, crash reporting, or any form of usage tracking.

## Data deletion

To delete all synced data: open Google Drive settings → Manage Apps → find "AI Studio Instructions Sync" → click "Delete hidden app data". Uninstalling the extension does not automatically delete the Drive AppData file.

## Contact

For questions or concerns, open an issue at https://github.com/AhsanAyaz/aistudio-instructions-sync/issues.

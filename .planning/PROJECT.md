# AI Studio Instructions Sync

## What This Is

A Chrome Manifest V3 extension that syncs Google AI Studio's saved system instructions across devices via the user's Google Chrome account. AI Studio stores its system instructions in `localStorage["aistudio_all_system_instructions"]` — per-device and per-browser-profile only. This extension lifts that data into `chrome.storage.sync` so the same library is available everywhere the user is signed into Chrome, automatically.

v1.0 shipped: full bidirectional sync, conflict resolution, union-merge first-install, account mismatch guard, Svelte 5 popup with status/controls/export/import, and JSON safety net. The sync model is proven.

For: a single user (initially the author) who uses AI Studio on multiple machines and wants their saved system prompts to follow them, without manual copy-paste.

## Core Value

**Open AI Studio on any signed-in Chrome and see the same up-to-date library of system instructions — automatically, with no clicks.** If everything else in this extension fails (popup, export, status badge), this single behavior must work.

*Validated in v1.0: core sync pipeline proven end-to-end across two machines.*

## Requirements

### Validated (v1.0)

- ✓ Storage schema locked: `sysins:*` namespace, registry/body separation, 7 KB chunk budget — v1.0
- ✓ UUID identity model: `crypto.randomUUID()` on first sight, permanent (renames preserve UUID) — v1.0
- ✓ Tombstone semantics: `deletedAt >= updatedAt` wins; resurrection rejection via applyRemote — v1.0
- ✓ UTF-8-safe chunking: splitIntoChunks/joinChunks with codepoint boundary safety — v1.0
- ✓ SW bootstrap + orphan recovery: write-if-absent meta, stale syncPending cleared on restart — v1.0
- ✓ DIST-04: zero third-party network calls — static scan + ESLint enforced — v1.0
- ✓ Manifest locked: permissions exactly `['storage','scripting','alarms','identity']`, host `aistudio.google.com` only — v1.0
- ✓ Observation pipeline: MAIN-world patch → ISOLATED relay → SW handler; null-read guard; unknown-field passthrough — v1.0
- ✓ Push engine: UUID assignment, per-item diff, 30s alarm-debounced batched `chrome.storage.sync.set()` — v1.0
- ✓ Pull engine: handleRemoteChanged, union-merge apply, tombstone-wins conflict resolution — v1.0
- ✓ Infinite sync loop guard: APPLYING_REMOTE_KEY suppression flag + diff-against-last-pushed — v1.0
- ✓ Multi-tab coordination: only one AI Studio tab applies a remote update — v1.0
- ✓ Union-merge bootstrap: first-install preserves items from both sides; title-match UUID assignment (one-time only) — v1.0
- ✓ Account mismatch pre-flight: chrome.identity + AI Studio DOM check; auto-sync pauses on mismatch — v1.0
- ✓ Popup: Svelte 5, sync status, instruction list, Push/Pull buttons, 9-state error coverage — v1.0
- ✓ Badge: green/amber/red — no silent fourth state — v1.0
- ✓ JSON export/import: union-merge import (additive, tombstone-respecting) — v1.0
- ✓ Sideloadable: `npm run build` → `.output/chrome-mv3/` — v1.0

### Active (v1.1 candidates)

- [ ] Popup shows quota usage (e.g. "23 KB of ~100 KB used") with proximity warning (UI2-01)
- [ ] Chrome Web Store listing with privacy policy, screenshots, and store assets (DIST2-01)
- [ ] Tombstone GC: stale tombstones older than a threshold pruned automatically (UI2-03)

### Out of Scope

- **Editing/creating instructions from inside the extension** — AI Studio is the single source of truth for authoring in v1; revisit if users ask
- **Aggressive React injection** — brittle; AI Studio internals change frequently; synthetic StorageEvent + reload hint is the accepted path
- **Search, tagging, folders, version history** — out of scope for "sync" charter
- **Non-Chromium browsers** — different storage-sync APIs; v1 is Chrome-only
- **Multi-account orchestration** — chrome.storage.sync is per-profile; we don't merge across profiles
- **Sharing instructions between users** — single-user sync only
- **Server-side backend** — no custom server, no auth, no telemetry; Chrome sync is the only backend
- **Conflict transparency UI** (UI2-02) — last-write-wins is correct for this single-user threat model; overkill to surface

## Context

**Current state (v1.0):**
- 5 phases, 26 plans, 135 commits over 6 days (2026-05-01 → 2026-05-06)
- ~5,100 lines TypeScript/Svelte/JS
- Tech stack: WXT 0.20.25, TypeScript 5.8, Svelte 5.55.5, Vitest 4.x, 126 unit tests
- Build: `npm run build` → `.output/chrome-mv3/` (~74 KB total)
- Sideloaded on author's machines; Chrome Web Store submission deferred to v1.1

**Known constraints:**
- AI Studio's `localStorage["aistudio_all_system_instructions"]` — JSON array of `{ title, text, ...extra }`. No IDs shipped by AI Studio. Extension assigns and maintains UUID identity separately.
- AI Studio is React. Writing to `localStorage` does not automatically update React state. Best-effort: dispatch synthetic `storage` event; fallback: prompt reload via "Refresh AI Studio" hint in popup.
- chrome.storage.sync quotas: ~100KB total, 8KB per item, 512 items, 1800 writes/hr, 120 writes/min — drives chunking, batching, and rate-limit discipline.
- identity permission: `chrome.identity.getProfileUserInfo()` requires manifest permission; used only for account mismatch pre-flight.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Storage schema: `sysins:*` namespace, registry/body separation, 7KB chunk budget | Irreversible once deployed; must be right first time | ✓ Good — clean migration path, no quota surprises |
| UUID identity: extension-assigned, permanent; title-match bootstrap-only | AI Studio has no IDs; renames must survive | ✓ Good — renames work, title-match used exactly once |
| Merge: all logic in service worker; content script is relay only | Single source of truth for merge; no race conditions | ✓ Good — clear boundary, easy to test |
| applyRemote authoritative timestamp: max(updatedAt, deletedAt??0); tie → tombstone | Tombstone must survive concurrent last-write-wins | ✓ Good — D-06/D-18, Recipe 9 pattern |
| Push engine: 30s alarm debounce, single batched set() | Rate limit compliance; burst edits coalesce | ✓ Good — 126 tests green, no rate limit issues |
| importItems() separate from diffAndAccumulate() | Import is additive; diffAndAccumulate is full-replacement (tombstones absent items) | ✓ Good — Hard Rule 5 enforced cleanly |
| Svelte 5 for popup | ~2-3KB runtime, compiled reactivity; no React overhead | ✓ Good — 46KB popup chunk total |
| onMount cleanup: sync return + void IIFE for async | Svelte 5 only calls cleanup if return is () => void, not Promise | ✓ Good — CR-01 listener leak fixed |
| Chunking boundary: bufBytes + cpBytes > budget (strict >) | 7000-byte ASCII stays as one chunk | ✓ Good — Blob.size gives accurate byte count |
| WXT-STATIC pattern: plain .js in public/, not src/ | WXT entrypoints scanner is TS-only | ✓ Good — ls-observer.js copies to build output correctly |
| No backend, no telemetry, no third-party calls | Privacy-first; zero infra; Chrome sync is the only backend | ✓ Good — DIST-04 enforced, static scan passes |

## Constraints

- **Tech stack**: Chrome MV3 (service worker + content script + popup) — required to access AI Studio's localStorage and chrome.storage.sync
- **Storage**: chrome.storage.sync only — zero-infra, follows the Google account
- **Quotas**: 8KB/item, ~100KB total, 512 items — drives chunking/sharding requirement
- **Privacy**: All data stays in the user's own Google Chrome sync; no third-party calls
- **Browser support**: Chrome (Chromium with Google account). Not Firefox, not Safari.
- **Distribution**: Personal/sideload first; Chrome Web Store is v1.1 target
- **Permissions**: storage, scripting, alarms, identity — no `<all_urls>`, no broad host access

---
*Last updated: 2026-05-06 after v1.0 milestone*

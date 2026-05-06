# AI Studio Instructions Sync

## What This Is

A Chrome extension (Manifest V3) that syncs Google AI Studio's saved system instructions across devices via the user's Google Chrome account. AI Studio currently stores its system instructions in `localStorage` under the key `aistudio_all_system_instructions`, which is per-device and per-browser-profile only. This extension lifts that data into `chrome.storage.sync` so the same library of instructions is available everywhere the user is signed into Chrome.

For: a single user (initially the author) who uses AI Studio on multiple machines and wants their saved system prompts to follow them, without manual copy-paste.

## Core Value

**Open AI Studio on any signed-in Chrome and see the same up-to-date library of system instructions — automatically, with no clicks.** If everything else in this extension fails (popup, export, status badge), this single behavior must work.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship v1 to validate)

### Implemented (Phase 1 + Phase 2 complete)

- [x] Storage schema locked: `sysins:*` namespace, registry/body separation, 7 KB chunk budget (validated in Phase 1)
- [x] UUID identity model: `crypto.randomUUID()` on createItem, permanent — rename preserves UUID (validated in Phase 1)
- [x] Tombstone semantics: deletedAt >= updatedAt wins; resurrection rejection via applyRemote (validated in Phase 1)
- [x] UTF-8-safe chunking: splitIntoChunks/joinChunks with emoji codepoint boundary safety (validated in Phase 1)
- [x] SW bootstrap: initializeMeta write-if-absent (D-10), orphan syncPending recovery (D-13) (validated in Phase 1)
- [x] DIST-04: no third-party network calls — static scan + ESLint layer 1 enforced (validated in Phase 1)
- [x] Manifest locked: permissions exactly ['storage','scripting'], host exactly ['https://aistudio.google.com/*'] (validated in Phase 1)
- [x] Observation pipeline: MAIN-world Storage.prototype.setItem patch → ISOLATED-world relay → SW onMessage handler (validated in Phase 2)
- [x] Null/empty guard (PUSH-05): isValidPayload gates both postMessage and polling paths — empty reads never propagate as LS_CHANGED (validated in Phase 2)
- [x] Unknown-field passthrough (PUSH-06): RawInstruction index signature preserves all AI Studio fields verbatim through the pipeline (validated in Phase 2)
- [x] Observation snapshot: sysins:local:lastObserved written to chrome.storage.local on every LS_CHANGED; Phase 3 reads it as initial diff baseline (validated in Phase 2)
- [x] WXT-STATIC pattern established: plain .js MAIN-world files live in public/ (not src/) for WXT static copy to build output (validated in Phase 2)

### Active

<!-- Current scope. Building toward these. v1 hypotheses. -->

- [ ] Read `aistudio_all_system_instructions` from `localStorage` on `aistudio.google.com` and mirror it into `chrome.storage.sync`
- [ ] Write back changes from `chrome.storage.sync` into `localStorage` on `aistudio.google.com`
- [ ] Sync runs automatically in both directions — no user action required for normal operation
- [ ] Each instruction has a stable UUID assigned by the extension on first sight (kept in extension storage, not in AI Studio's array)
- [ ] Each instruction has a per-item `updated_at` timestamp; on conflict, the later write wins per item
- [ ] Deletes use tombstones (soft-delete entries with timestamps) so a delete on device A propagates to device B without resurrection
- [ ] Quota handling: instructions and timestamp metadata are chunked/sharded across `chrome.storage.sync` slots so single items >8KB and total payloads up to the 100KB sync cap are accommodated
- [ ] Toolbar popup shows: sync status (last sync, ✓/⚠️/⟳), list of instructions with their `updated_at`, and manual `Push now` / `Pull now` buttons
- [ ] When a remote update is pulled while AI Studio is open, write to `localStorage` and dispatch a synthetic `storage` event to give the page a chance to update live; if it doesn't, surface a "Refresh AI Studio to see latest" hint in the popup/badge
- [ ] JSON export and JSON import from the popup (manual safety net + migration path)
- [ ] Error states are visible: quota exceeded, sync unavailable, malformed remote payload — surfaced via badge + popup, not silently swallowed

### Out of Scope

<!-- Explicit boundaries with reasoning to prevent re-adding. -->

- **Editing/creating instructions from inside the extension** — keep AI Studio as the single source of truth for authoring in v1; revisit if users ask for it
- **Aggressive React injection to force AI Studio to re-render** — too brittle; AI Studio internals change frequently. We do best-effort via the synthetic `storage` event and otherwise prompt a reload
- **Search, tagging, folders, version history** — pure sync first; these can layer on later if useful
- **Non-Chromium browsers (Safari, Firefox)** — Firefox uses a different storage-sync model; Safari requires its own extension build. Out of scope for v1
- **Edge / Brave / other Chromium browsers' own sync backends** — we use `chrome.storage.sync` which only works against the user's Google account in Chrome. Cross-browser sync is not promised
- **Multi-account orchestration within a single profile** — `chrome.storage.sync` is scoped to the active Chrome profile; that's the unit of sync. We don't try to merge across profiles
- **Sharing instructions between users / public catalog** — single-user sync only; not a marketplace
- **Public Chrome Web Store launch in v1** — we ship sideloadable for personal use first; store launch is a deliberate later step (after the sync model has been proven)
- **Server-side backend** — no custom server, no auth, no telemetry. Chrome sync is the only backend

## Context

**Technical environment:**
- Target page: `https://aistudio.google.com/*`
- Source-of-truth in AI Studio: `localStorage["aistudio_all_system_instructions"]` — JSON array of `{ title: string, text: string }` (and possibly other fields not yet inspected; see screenshot showing entries like "Swedish Companies tax & accounting assistant", "Software architect…", etc.)
- Sync backend: `chrome.storage.sync` — quotas: ~100KB total, 8KB per item, 512 items, 1800 writes/hour, 120 writes/minute
- Manifest V3 only. Service worker for background sync coordination, content script for `localStorage` access (since `chrome.storage` cannot be reached from the page's `localStorage` without injection)

**Why this exists:**
- AI Studio's instructions library is per-localStorage, so power users with curated prompts (tax assistants, code reviewers, content writers, etc.) lose them when switching machines or even Chrome profiles. This extension makes the library portable in the same effortless way Chrome syncs bookmarks and passwords.

**Known constraints from AI Studio's shape:**
- AI Studio doesn't ship IDs in the instructions array — only `title` + `text`. We must assign and maintain our own stable identity. Our extension's per-item metadata (UUID, `updated_at`, `deleted_at`) lives in `chrome.storage.sync` separately from the user-visible array we write back to `localStorage`
- AI Studio is React. Writing to `localStorage` doesn't automatically update React state. Best-effort: dispatch synthetic `storage` event; fallback: prompt reload

**Prior art / inspiration:**
- Chrome's own bookmark/password sync — invisible, automatic, conflict-tolerant
- Standard CRDT-lite patterns: per-item timestamps, soft-delete tombstones, last-write-wins per key

## Constraints

- **Tech stack**: Chrome Manifest V3 extension (service worker + content script + popup) — required to access AI Studio's `localStorage` and `chrome.storage.sync`
- **Storage**: `chrome.storage.sync` only (no custom server) — keeps the project zero-infra and aligned with "follows the Google account"
- **Quotas**: 8KB per item / ~100KB total / 512 items in `chrome.storage.sync` — drives the chunking/sharding requirement
- **Privacy**: All data stays in the user's own Google Chrome sync; the extension does not send instructions to any third party
- **Browser support**: Chrome (and Chromium browsers that ship `chrome.storage.sync` against a Google account, which in practice means Chrome). Not Firefox, not Safari in v1
- **Distribution**: Personal/sideload first; cleanly publishable to Chrome Web Store later (so code, manifest, and permissions stay store-friendly from day one)
- **Permissions**: minimum viable set — `storage`, host permission for `https://aistudio.google.com/*`, and `scripting` if needed for content script injection. No `<all_urls>`, no broad host access

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Sync model: automatic, bidirectional | Core value depends on zero-click sync; manual sync defeats the purpose | — Pending |
| Conflict resolution: per-instruction `updated_at`, last-write-wins per item, with tombstones for deletes | True merge across devices when different items are edited; tombstones prevent resurrected deletes | — Pending |
| Identity: extension-assigned UUID per instruction, kept in extension's own metadata (not injected into AI Studio's `localStorage` array) | AI Studio's array has no IDs and we don't want to pollute its schema; renames must survive as the same item | — Pending |
| Storage backend: `chrome.storage.sync` with automatic chunk + shard | Aligns with "syncs across the Chrome account" without infra; chunking absorbs the 8KB-per-item / 100KB-total ceiling for normal use | — Pending |
| UI: toolbar popup with status + list + manual Push/Pull; no in-extension editing | Visibility into what's happening + manual escape hatches, without expanding scope to becoming a second editor | — Pending |
| Live update strategy: write `localStorage` + dispatch synthetic `storage` event; fallback to "Refresh AI Studio" hint | Pragmatic best-effort — avoids brittle React fiber injection while still feeling fluid most of the time | — Pending |
| Distribution path: personal/sideload first, Chrome Web Store later | Lets v1 ship fast; keeping the code/manifest store-clean preserves the option | — Pending |
| Export/import JSON in v1 | Cheap insurance + migration path off the extension if `chrome.storage.sync` ever misbehaves | — Pending |
| No backend, no telemetry, no third-party calls | Keeps trust model simple and matches "follows the Google account" framing | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-06 — Phase 2 (Observation Pipeline) complete*

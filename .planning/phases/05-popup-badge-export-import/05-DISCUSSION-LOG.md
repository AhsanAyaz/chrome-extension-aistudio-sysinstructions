# Phase 5: Popup, Badge, and Export/Import - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 05-popup-badge-export-import
**Areas discussed:** Popup data access, Push/Pull UX, Badge healthy state, Import UX

---

## Popup Data Access

| Option | Description | Selected |
|--------|-------------|----------|
| Read storage directly | Popup reads chrome.storage.local + chrome.storage.sync directly; no SW message roundtrip; onChanged for live updates | ✓ |
| Message the SW | GET_STATUS message → SW assembles response; stricter dumb-view pattern; adds message protocol; MV3 SW kill risk | |

**User's choice:** Read storage directly
**Notes:** Follow-up confirmed registry-only (title + updatedAt) for the instruction list — no body fetch during display.

| Sub-option | Description | Selected |
|------------|-------------|----------|
| Registry only | title + updatedAt per item; bodies fetched only at export time | ✓ |
| Full bodies too | Also reads sysins:body chunk keys; enables text preview; more reads, slower with chunked items | |

---

## Push/Pull UX

| Option | Description | Selected |
|--------|-------------|----------|
| Fire-and-forget + storage polling | Button sends message, popup reacts to syncStatus via onChanged | ✓ |
| Optimistic + await ack | Show 'Syncing…' immediately; wait for sendResponse; MV3 port complexity; timeout risk | |

**User's choice:** Fire-and-forget + storage polling
**Notes:** No ack protocol needed. SW transitions syncStatus idle→syncing→idle/error; popup renders each state via onChanged.

---

## Badge Healthy State

| Option | Description | Selected |
|--------|-------------|----------|
| Empty badge / no badge | Clear badge text on healthy state; badge signals problems only; consistent with Phase 3 flush-success path | ✓ |
| Green filled badge | Green color always visible; 'all good' confirmation; one more setBadgeBackgroundColor call | |

**User's choice:** Empty badge / no badge

| Sub-option | Description | Selected |
|------------|-------------|----------|
| No syncing indicator | Badge stays as-is during 30s debounce; error badge appears only on failure | ✓ |
| Show amber during sync | Amber '~' while syncing; flickers on every keystroke if debounce is short | |

**Notes:** Badge is an error signal only. Healthy = invisible.

---

## Import UX

| Option | Description | Selected |
|--------|-------------|----------|
| In-popup file input | Hidden `<input type="file">` in Svelte popup; no extra WXT entrypoint | ✓ |
| Dedicated import page | chrome-extension://.../import.html; more space; second Svelte entrypoint | |

**User's choice:** In-popup file input

| Sub-option | Description | Selected |
|------------|-------------|----------|
| Live items only in export | deletedAt === null; clean portable backup; no tombstones exposed to user | ✓ |
| Include tombstones | Full round-trip restore; adds deletedAt to export schema; confusing to users | |

**User's choice:** Live items only
**Notes:** Import sends IMPORT_ITEMS message to SW. SW runs standard merge path. Validation rejects items missing title or text.

---

## Claude's Discretion

- Popup Svelte component structure
- Error message copy for each ErrorState value
- Timestamp display format (locale-relative vs ISO)
- Export filename convention

## Deferred Ideas

- Quota usage indicator (v2 UI2-01)
- Conflict transparency (v2 UI2-02)
- Tombstone GC (v2 UI2-03)
- Body preview in instruction list
- Dedicated import page

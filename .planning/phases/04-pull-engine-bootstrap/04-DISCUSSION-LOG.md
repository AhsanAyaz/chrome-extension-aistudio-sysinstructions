# Phase 4: Pull Engine + Bootstrap - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 04-pull-engine-bootstrap
**Areas discussed:** BOOT-03 account mismatch, Infinite loop guard, Bootstrap merge timing, Multi-tab deduplication

---

## BOOT-03: Account Mismatch

| Option | Description | Selected |
|--------|-------------|----------|
| Spike first in Phase 4 | Make the spike Plan 04-01; verify chrome.identity availability + DOM identifier before writing any pull/bootstrap code | ✓ |
| Implement best-effort, no spike | DOM-scraping without spike; accept brittleness | |
| Defer BOOT-03 to v2 | Remove from Phase 4 scope entirely | |

**User's choice:** Spike first  
**Notes:** Spike is a hard gate — no implementation plans proceed until spike findings are known.

---

| Option | Description | Selected |
|--------|-------------|----------|
| Use chrome.identity + DOM check | chrome.identity.getProfileUserInfo() for Chrome profile; DOM for AI Studio account; mismatch → pause sync | ✓ |
| DOM-only (no chrome.identity) | Compare two DOM-scraped sources; brittle | |

**User's choice:** Use chrome.identity + DOM check (if available without permission)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Add the identity permission | DIST-02 allows "if strictly required" — account safety qualifies | ✓ |
| Fall back to DOM-only | If chrome.identity unusable, scrape both from DOM | |
| Defer BOOT-03 | If spike reveals significant friction, defer to v2 | |

**User's choice:** Add the identity permission if required by spike findings

---

## Infinite Loop Guard

| Option | Description | Selected |
|--------|-------------|----------|
| Diff only — no extra flag | Phase 3 diffAndAccumulate returns hasChanges=false for identical re-pushed data; no additional mechanism needed | ✓ |
| Diff + window suppression flag | window.__sysins_applying = true before localStorage write | |
| Diff + chrome.storage.local lock | applyInProgress flag in local storage; more robust but extra async I/O | |

**User's choice:** Diff only  
**Notes:** If stale-lastPushed edge case surfaces in testing, fix lastPushed durability rather than adding a flag.

---

## Bootstrap Merge Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Content script on first page load | onInstalled sets bootstrapNeeded flag; content script sends LS_BOOTSTRAP on first aistudio.google.com load after install | ✓ |
| onInstalled via scripting.executeScript | Two code paths — tab-open vs. no-tab-open; more complex | |
| Pull-first on first sync cycle | Treat first pull as union merge implicitly | |

**User's choice:** Content script on first page load  
**Notes:** Works regardless of whether a tab was open at install time.

---

| Option | Description | Selected |
|--------|-------------|----------|
| First match wins, rest are new UUIDs | Title-match collision: first remote entry (by updatedAt desc) wins; others get fresh UUIDs | ✓ |
| Reject all ambiguous matches | All ambiguous titles get fresh UUIDs; risks duplicate instructions | |

**User's choice:** First match wins, rest are new UUIDs

---

## Multi-Tab Deduplication

| Option | Description | Selected |
|--------|-------------|----------|
| SW picks active tab only | chrome.tabs.query active:true; send APPLY_REMOTE to focused tab only | ✓ |
| SW broadcasts + content script first-responder lock | Broadcast + chrome.storage.local race for lock; winner applies | |
| SW broadcasts + versionId dedup | Broadcast with versionId; duplicate APPLY_REMOTE for same id are no-ops | |

**User's choice:** SW picks active tab only

---

| Option | Description | Selected |
|--------|-------------|----------|
| Queue the pull, apply on next tab focus | Write to sysins:local:pendingRemote; content script applies on visibilitychange | ✓ |
| Apply to first tab in list regardless | Pick tabs[0] regardless of active state | |
| Skip; wait for next onChanged | Do nothing; retry on next remote change event | |

**User's choice:** Queue the pull, apply on next tab focus  
**Notes:** Pull is never lost — only deferred until the user returns to the AI Studio tab.

---

## Claude's Discretion

- Exact shape of `sysins:local:bootstrapNeeded`
- Exact shape of `sysins:local:pendingRemote`
- Whether `LS_BOOTSTRAP` reuses `LS_CHANGED` handler or is separate
- Tombstone GC timing (Phase 4 or v1.x)
- BOOT-03 spike structure (standalone plan vs. sub-task)

## Deferred Ideas

- Tombstone GC implementation — v1.x candidate, designed in Phase 1 schema
- Visual merge-result notification — popup phase concern
- `tabs` vs. `activeTab` permission analysis — flag for spike to confirm

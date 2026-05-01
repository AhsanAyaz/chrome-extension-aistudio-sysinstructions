# Feature Research

**Domain:** Chrome MV3 extension — sync/backup/restore of browser-local data (specifically AI Studio system instructions via chrome.storage.sync)
**Researched:** 2026-05-01
**Confidence:** HIGH for core sync UX patterns; MEDIUM for personal-tool sizing opinions (derived from category analysis, not direct user testing)

---

## Feature Landscape

### Table Stakes (Users Expect These)

These features define "it works" for a sync tool. Absence causes users to distrust the extension or abandon it. Note: for a **personal-first, single-user** tool, "user" is largely the author — so the bar is calibrated to a technically capable power user, not an average consumer. Still, these are non-negotiable because they protect the author's own data.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Auto bidirectional sync (no manual trigger) | Core value prop — if you have to click "Sync" it's just a fancy copy-paste. Chrome's own bookmark sync sets the mental model | S (pattern is known; wiring is fiddly) | Already decided. Content script + service worker + `chrome.storage.onChanged` listener is the architecture |
| Visible sync status (last sync time, success/error badge) | User research (Chrome's own team) consistently shows that invisible sync = user thinks it's broken. Badge + last-sync timestamp is the minimum trust signal | S | `chrome.action.setBadgeText` + popup timestamp. Already decided. Without this, the author can't tell if sync is working |
| Clear error states surfaced to UI (not silently swallowed) | If quota is hit, network is offline, or remote payload is corrupt, the user must know. Silent failures lead to data loss discovery at the worst moment | S | Badge color change (red/amber) + popup error message. Already decided |
| Per-item conflict resolution with last-write-wins | Without this, whichever device syncs last wins the whole set — you lose edits on device A when device B syncs. Last-write-wins per item is the minimum safe model | M | UUID + `updated_at` per instruction. Already decided. The complexity is in the merge logic and tombstones |
| Tombstone-based deletes | Without tombstones, deleting on device A gets resurrected by device B on next sync. This is the #1 data integrity bug in naive sync tools | M | Already decided. Tombstones need a TTL cleanup strategy or they accumulate; defer TTL to v2 |
| Manual escape hatch (Push / Pull buttons) | When auto-sync misbehaves or user wants to force a known-good state, they need a manual override. This is table stakes for any sync tool because automatic systems occasionally get into bad states | S | Already decided. Popup Push/Pull. Without this, any sync bug requires uninstalling the extension to recover |
| Quota handling that doesn't silently fail | `chrome.storage.sync` has a hard 100KB / 8KB-per-item limit. Hit it silently = data loss. Handling it visibly (chunking + error when hard limit is hit) is non-negotiable | M | Already decided. Chunking/sharding is the implementation. The error surface (badge + popup message) is the UX |
| JSON export as data escape hatch | Users (including the author) need a way to get their data out if the extension breaks or if they want to migrate. Without this, all instructions are trapped in opaque extension storage | S | Already decided. JSON import/export in v1. This is insurance, not a feature users actively celebrate |

**Honest sizing note for personal-first tool:** The "user leaving if missing" language in table stakes is generic. For a personal tool, the real risk is the author losing confidence in the tool and stopping using it, or worse, silently losing instructions data. Every table stake above maps to a specific failure mode that would cause that outcome.

---

### Differentiators (Competitive Advantage)

These separate "it works" from "it's great." For a personal-first v1, the bar is: does this meaningfully reduce friction or increase trust? Listed from most to least impactful for this specific use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Live update to AI Studio without page reload | When sync fires while AI Studio is open, writing to localStorage + dispatching synthetic `storage` event gives a chance to update live. Without it, user has to manually reload | S | Already decided as best-effort. If AI Studio's React doesn't respond to the event, popup shows "Refresh to see latest." Acceptable tradeoff |
| Instruction list in popup with per-item timestamps | Makes sync visible at a glance — user can see each instruction and when it was last updated. Gives confidence that the right items are syncing | S | Already decided. Key differentiator vs. black-box sync. Dependency: needs per-item metadata model (UUID + timestamps) |
| Item count + quota usage indicator | Shows "12 instructions / ~18KB of 100KB used." Prevents surprise quota hits and surfaces growth trajectory | S | Low-effort addition to popup. Dependency: chunking metadata must track sizes |
| Conflict transparency (show when last-write-wins resolved a conflict) | Instead of silently picking a winner, show in popup "Instruction 'X' was updated on 2 devices; kept newer version (Device B, 14:32)." Rare event but builds trust when it happens | M | Requires persisting conflict events in local storage. Dep: per-item metadata model. Flag as v1.x candidate — only add if conflicts are actually observed |
| Refresh hint when live update doesn't work | Popup/badge shows "AI Studio open — refresh to see latest changes" when a pull happened during an active session and the live-update event didn't trigger a visible React re-render | S | Already decided. Closes the feedback loop. Dependency: content script must report whether page update was observed |

**Features that look like differentiators but aren't (for this tool):**

- **Multi-device dashboard** — showing "Device A last synced at 10:32, Device B at 10:35" requires a server or writing device metadata to shared sync storage. For a single user who checks their popup when something feels off, the last-sync-time in the popup is sufficient. The multi-device dashboard is a feature for team products.
- **Change notifications (OS-level push)** — Chrome OS notifications for "sync completed" would be intrusive for a background operation that should be invisible when working. The badge + popup is the right ambient signal.
- **Per-item version history / undo** — Would be genuinely useful but requires significant storage (version snapshots hit quota fast) and UI for browsing history. Explicitly out of scope for v1.

---

### Anti-Features (Commonly Requested, Often Problematic)

These are features that seem obviously useful, surface in feature-request discussions for sync tools, but quietly introduce scope, fragility, or trust problems. Flag these to prevent scope creep in roadmap phases.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| In-extension instruction editor | "I want to edit prompts without switching to AI Studio" | Makes the extension a second editor with its own save state, conflict between extension edit and AI Studio edit, and doubles the surface to debug. AI Studio is the authoritative editor — keep it that way | AI Studio is the editor. Extension is the sync layer. If editing becomes needed, revisit after v1 validates the sync model |
| Encryption at rest (user-supplied passphrase) | "My prompts contain sensitive IP / internal processes" | Web Crypto API is available, but: (1) passphrase management is a UX problem — forget it and your data is permanently inaccessible; (2) chrome.storage.sync is already encrypted by Google in transit and at rest; (3) adds significant complexity to export/import (encrypted JSON is not human-readable); (4) for a personal tool where you're the only user, the threat model doesn't justify the complexity | Document the existing Google account encryption. For genuinely sensitive instructions, note that Google's sync passphrase option adds an independent encryption layer without extension code |
| Telemetry / crash reporting | "I want to know when something breaks in production" | No users except the author in v1. Any telemetry requires a backend, adds a permissions surface area, and violates the "no third-party calls" constraint. Even a lightweight analytics call introduces trust surface when the extension touches sensitive prompts | Use browser devtools and extension error console for debugging. If this goes to the Chrome Web Store, revisit with a privacy-safe local-only crash log |
| Sync history / audit log | "Show me everything that's been synced, when, from which device" | Grows unbounded in storage, requires a schema for log entries, and is never actually consulted except during debugging. Debugging sessions warrant opening devtools, not a popup log UI | Popup shows last sync time and current state. Devtools console logging in debug mode is sufficient for the author |
| Search / filter inside popup | "Find instruction by name" | For a personal library that's typically < 50 instructions, a search UI adds complexity (input, debounce, filter logic, keyboard navigation) for a problem that doesn't exist at this scale | Alphabetically sorted list is sufficient. Defer search until instruction count makes scanning impractical |
| Conflict resolution UI (interactive merge) | "Let me choose which version to keep when there's a conflict" | Last-write-wins per item is correct for this use case (single user, rarely editing same instruction simultaneously on two devices). An interactive merge UI is a collaborative editing feature. Building it would be weeks of work for an edge case that may never occur | Last-write-wins + show "kept newer version" in popup if conflict occurred. User can always pull the other device's version via AI Studio edit |
| Folder / tag / label organization | "Group my instructions by project or type" | AI Studio doesn't have folders — they would exist only in the extension, creating an organizational layer that breaks when AI Studio changes its schema or when the user manages instructions directly in AI Studio | Alphabetical list in popup is enough. If AI Studio adds folders, follow their schema |
| Sharing / publishing instructions | "Let me share a system prompt with a colleague" | Requires a server, auth, user management, and privacy controls. Completely outside the scope of a personal sync tool | Out of scope. Users who want to share can export JSON and send the file |
| Auto-pause sync when quota is near | "Stop syncing before I hit the limit" | Partial sync is worse than no sync — user ends up with an inconsistent state, wondering which instructions are synced and which aren't. Better to sync fully or fail visibly | Surface quota usage in popup. When quota is exceeded, show a clear error (badge + popup) and let user decide what to do (export and prune) |

---

## Feature Dependencies

```
[UUID + updated_at metadata model]
    └──requires──> [per-item conflict resolution (last-write-wins)]
    └──requires──> [tombstone deletes]
    └──enables──>  [instruction list in popup with timestamps]
    └──enables──>  [conflict transparency (v1.x)]

[Chunking / sharding for quota]
    └──requires──> [UUID + metadata model]
    └──enables──>  [quota usage indicator in popup]

[Popup: status + list + Push/Pull]
    └──requires──> [auto bidirectional sync working]
    └──requires──> [UUID + metadata model]
    └──requires──> [error states surfaced]

[JSON export]
    └──requires──> [can read full instruction set from chrome.storage.sync]
    └──enables──>  [JSON import]

[JSON import]
    └──requires──> [UUID assignment logic] (import must assign UUIDs to imported items)
    └──requires──> [conflict resolution model] (import is a write that must merge correctly)

[Live update to AI Studio without reload]
    └──requires──> [content script with localStorage write]
    └──enables──>  [refresh hint in popup]

[Refresh hint in popup]
    └──requires──> [live update attempt + result feedback from content script]
    └──requires──> [popup status display]
```

### Dependency Notes

- **UUID + metadata model is the foundation**: Almost every other feature builds on per-item identity. It must be correct before any UI features are built on top of it.
- **Conflict resolution requires tombstones**: They are a coupled pair — implementing last-write-wins without tombstones causes delete resurrection bugs. Build them together.
- **JSON import requires the full merge model**: Import is not a "restore from backup" overwrite. It must go through the same UUID assignment + conflict resolution path, or it will create duplicates or resurrect deletes. This is easy to get wrong.
- **Quota indicator requires chunking metadata**: Can't show "18KB of 100KB used" without tracking sizes during the chunking process.

---

## MVP Definition

### Launch With (v1)

These are the requirements already decided in PROJECT.md, validated against the table stakes analysis above. No additions.

- [ ] Auto bidirectional sync — core value, non-negotiable
- [ ] UUID + `updated_at` + tombstone model — foundational, everything else depends on this
- [ ] Quota handling with chunking — required by the storage constraints
- [ ] Popup: last sync time, badge, instruction list with timestamps, Push/Pull buttons — table stakes visibility
- [ ] Error states surfaced via badge + popup (quota exceeded, sync unavailable, malformed payload)
- [ ] JSON export + import — data escape hatch, insurance against bugs
- [ ] Best-effort live update via synthetic `storage` event + "Refresh AI Studio" hint — differentiator that costs little

### Add After Validation (v1.x)

Add only if real usage reveals the gap.

- [ ] Quota usage indicator in popup — add when instructions library grows large enough to matter
- [ ] Conflict transparency in popup — add only if conflicts are actually observed during real multi-device use
- [ ] Tombstone TTL cleanup — deferred from v1 because tombstone accumulation is negligible at typical library sizes (< 50 instructions); revisit after 3 months of use

### Future Consideration (v2+)

Defer until sync model is proven and there is a genuine user need.

- [ ] Instruction editing in popup — only if the author finds AI Studio switching friction high enough to justify a second editor
- [ ] Search / filter in popup — only if instruction count makes scrolling impractical (likely > 100 instructions)
- [ ] Chrome Web Store public distribution — revisit after v1 is stable and quota/conflict model is validated
- [ ] Encryption at rest — only if the Google account threat model becomes insufficient for the author's use case

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Auto bidirectional sync | HIGH | MEDIUM | P1 |
| UUID + metadata + tombstones | HIGH | MEDIUM | P1 |
| Quota chunking | HIGH | MEDIUM | P1 |
| Error states (badge + popup) | HIGH | LOW | P1 |
| Popup: status + instruction list + Push/Pull | HIGH | LOW | P1 |
| JSON export | MEDIUM | LOW | P1 |
| JSON import | MEDIUM | LOW | P1 |
| Live update + refresh hint | MEDIUM | LOW | P1 |
| Quota usage indicator in popup | LOW | LOW | P2 |
| Conflict transparency | LOW | MEDIUM | P2 |
| Tombstone TTL cleanup | LOW | LOW | P2 |
| Instruction editor in popup | MEDIUM | HIGH | P3 |
| Search / filter | LOW | MEDIUM | P3 |
| Encryption at rest | LOW | HIGH | P3 |
| Multi-device dashboard | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1 launch
- P2: Add after validation (v1.x), low risk
- P3: Future consideration (v2+), requires new scope decision

---

## Competitor Feature Analysis

The direct competitors are sync/backup extensions in the same category: bookmark syncers (EverSync, XMarks), notes extensions (Roam Research extension, Obsidian Web Clipper), snippet managers (Snippet Manager, Kiktab Code).

| Feature | EverSync (bookmarks) | Snippet Manager extensions | Our Approach |
|---------|---------------------|---------------------------|--------------|
| Auto sync | Yes, cloud-backend | Varies; most are chrome.storage.sync | Yes, chrome.storage.sync — no custom backend |
| Conflict handling | Basic (server wins or last-write); users report duplicate issues | Often no conflict handling — last write wins whole set | Per-item last-write-wins with tombstones — more granular than competitors |
| Status visibility | Minimal; users complain of no feedback during sync | Minimal or none | Badge + popup with last sync time and per-item list |
| Export | Yes (HTML bookmark file) | Varies; few do JSON | JSON (human-readable, portable) |
| Import | Yes | Rare | JSON import with full merge semantics |
| Error handling | Poor; users report silent failures | Often silent | Explicit: badge + popup message for quota, network, parse errors |
| Editing | Dedicated bookmark manager | Full snippet editor built in | Deliberately none — AI Studio is the editor |
| Server dependency | Yes (EverHelper cloud) | Varies | None — chrome.storage.sync only |

**Key takeaway**: The competition either has a server dependency (EverSync) or silently fails on conflicts and quota. This extension's per-item conflict model and explicit error surfaces are genuine differentiators, not table stakes that competitors already have.

---

## Sources

- [Data Synchronization in Chrome Extensions — Medium/Serhii Kokhan](https://medium.com/@serhiikokhan/data-synchronization-in-chrome-extensions-f0b174d4414d)
- [chrome.storage API — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.storage.sync: Best practices for quotas — Chromium Extensions Group](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/ACVyerzOjus)
- [EverSync Chrome Web Store reviews](https://chromewebstore.google.com/detail/eversync-sync-bookmarks-b/iohcojnlgnfbmjfjfkbhahhmppcggdog/reviews)
- [Chrome extension best practices (UX) — DeepFocusTools](https://deepfocustools.com/chrome-extension-best-practices/)
- [Chrome Extensions: Adding a badge — DEV Community](https://dev.to/paulasantamaria/chrome-extensions-adding-a-badge-644)
- [Local vs Sync vs Session: Which Chrome Extension Storage Should You Use? — DEV Community](https://dev.to/notearthian/local-vs-sync-vs-session-which-chrome-extension-storage-should-you-use-5ec8)
- [How to Encrypt Data for Chrome Storage — codestudy.net](https://www.codestudy.net/blog/chrome-extension-encrypting-data-to-be-stored-in-chrome-storage/)
- [Bookmark Sync Across Devices: Complete 2026 Guide — TabMark Blog](https://tabmark.dev/blog/bookmark-sync-devices/)

---
*Feature research for: Chrome MV3 extension — AI Studio system instructions sync*
*Researched: 2026-05-01*

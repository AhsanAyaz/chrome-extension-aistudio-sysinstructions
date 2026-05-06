---
quick_id: 260506-r4d
slug: add-readme-contributing
status: complete
date: 2026-05-06
---

# Summary: Add README and CONTRIBUTING

## What Was Built

**README.md** — Full project README covering:
- What it is and why it was created (per-device localStorage pain point)
- Feature list (bidirectional sync, conflict resolution, account safety, export/import)
- Prerequisites and sideload install instructions
- All dev commands (dev, build, test, compile, lint, zip)
- Project structure with file-level annotations
- Storage layout table (sysins:* key schema)
- Privacy statement

**CONTRIBUTING.md** — Contributor guide covering:
- Architecture diagram (injector → content script → SW → popup layers)
- 8 Hard Rules (storage namespace, UUID permanence, batched writes, null guard, union merge, etc.)
- Dev setup and live development workflow
- Test patterns (fakeBrowser, _resetForTesting, identity stubs)
- Key files to read first (with annotations)
- PR submission guidelines

## Commits

- `docs: add README.md and CONTRIBUTING.md`

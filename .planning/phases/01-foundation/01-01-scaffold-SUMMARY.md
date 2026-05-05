---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [wxt, typescript, vitest, eslint, chrome-mv3, manifest]

# Dependency graph
requires: []
provides:
  - WXT 0.20.25 build pipeline producing .output/chrome-mv3/
  - Manifest locked to D-19: permissions=['storage','scripting'], host_permissions=['https://aistudio.google.com/*'], minimum_chrome_version='116'
  - TypeScript 5.8 strict mode config extending .wxt/tsconfig.json
  - Vitest 4.1.5 test harness with WxtVitest() plugin and happy-dom
  - ESLint 9 DIST-04 layer 1 config banning fetch/XHR/WebSocket/EventSource
  - SW entrypoint stub at src/background/index.ts
affects: [01-02-storage-layout, 01-03-chunking, 01-04-registry, 01-05-sw-bootstrap-resume, 01-06-dist04-manifest-snapshot]

# Tech tracking
tech-stack:
  added: [wxt@0.20.25, typescript@~5.8.0, vitest@4.1.5, happy-dom@^15, eslint@^9, typescript-eslint@^8]
  patterns:
    - "WXT entrypoint discovery via srcDir:'src' + entrypointsDir:'.' in wxt.config.ts"
    - "tsconfig.json extends ./.wxt/tsconfig.json (note ./ prefix required by TS 5.8)"
    - "WxtVitest() plugin + fakeBrowser for unit tests"
    - "DIST-04 layer 1: no-restricted-globals ESLint rule banning network APIs"

key-files:
  created:
    - package.json
    - wxt.config.ts
    - tsconfig.json
    - vitest.config.ts
    - eslint.config.mjs
    - .gitignore
    - src/background/index.ts
  modified: []

key-decisions:
  - "tsconfig.json extends must use './.wxt/tsconfig.json' (with ./ prefix) — TypeScript 5.8 cannot resolve dot-directory relative paths without explicit ./ prefix"
  - "vitest.config.ts requires passWithNoTests:true — Vitest 4.x exits code 1 with zero test files without this flag"
  - "OQ-4 resolved: wxt build succeeds with only src/background/index.ts — no content/popup/injected stubs needed in Phase 1"
  - "wxt.config.ts entrypointsDir:'.' resolves relative to srcDir:'src', so WXT discovers entrypoints in src/background/, src/content/, etc."

patterns-established:
  - "All later plans must run against this scaffold; Wave 1+ imports from .wxt/tsconfig.json via the tsconfig.json extends chain"
  - "ESLint DIST-04 layer 1 is in effect from line one — any network API usage in src/ is a lint error"
  - "SW entrypoint is src/background/index.ts exporting defineBackground() from wxt/utils/define-background"

requirements-completed: [DIST-01, DIST-02, DIST-03]

# Metrics
duration: 5min
completed: 2026-05-05
---

# Phase 1 Plan 01: Scaffold Summary

**WXT 0.20.25 build pipeline with locked D-19 manifest (storage+scripting only), TypeScript 5.8 strict mode, Vitest 4.1.5 + WxtVitest() harness, and ESLint DIST-04 network-call ban**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-05T21:17:04Z
- **Completed:** 2026-05-05T21:22:29Z
- **Tasks:** 2
- **Files modified:** 7 created + 1 updated (vitest.config.ts)

## Accomplishments

- WXT 0.20.25 scaffold installed and building: `npx wxt build` exits 0, produces `.output/chrome-mv3/manifest.json` and `background.js`
- D-19 manifest locked: generated manifest has exactly `permissions: ["storage","scripting"]` and `host_permissions: ["https://aistudio.google.com/*"]` — verified bit-exact
- TypeScript 5.8 strict mode enabled with noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax
- Vitest 4.1.5 harness wired with WxtVitest() + happy-dom; `vitest run` exits 0

## Task Commits

1. **Task 1: Initialize WXT project + write package.json + configs** - `aed27c8` (feat)
2. **Task 2: Smoke-test the WXT build and lock the manifest output** - `69cb7a5` (fix)

## Files Created/Modified

- `/package.json` — WXT 0.20.25, TypeScript ~5.8.0, Vitest 4.1.5, happy-dom, eslint 9 devDependencies; postinstall: wxt prepare
- `/wxt.config.ts` — D-19 manifest source-of-truth: permissions, host_permissions, minimum_chrome_version locked
- `/tsconfig.json` — Strict TS config extending ./.wxt/tsconfig.json; all strict flags per D-22/Recipe 10
- `/vitest.config.ts` — WxtVitest() + happy-dom + passWithNoTests:true
- `/eslint.config.mjs` — DIST-04 layer 1: no-restricted-globals (fetch, XMLHttpRequest, WebSocket, EventSource) + no-restricted-properties (navigator.sendBeacon, window.fetch)
- `/.gitignore` — ignores node_modules/, .wxt/, .output/, dist/, *.log, .DS_Store
- `/src/background/index.ts` — Minimal SW stub; Plan 05 wires onInstalled -> initializeMeta()

## Decisions Made

- TypeScript 5.8 requires `./` prefix in `extends` for dot-directory paths: `.wxt/tsconfig.json` fails, `./.wxt/tsconfig.json` works. This is a TypeScript 5.x resolution behavior change — relative paths to dot-prefixed directories must use explicit `./`.
- OQ-4 (RESEARCH line 803) resolved YES — `wxt build` succeeds with only `src/background/index.ts`. No placeholder stubs for content/popup/injected required.
- `passWithNoTests: true` added to vitest config — Vitest 4.x exits with code 1 when no test files are found; this flag restores "vacuous pass" behavior needed for Wave 0 scaffold state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript 5.8 requires explicit `./` prefix for dot-directory extends paths**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `"extends": ".wxt/tsconfig.json"` — TypeScript 5.8 cannot resolve the extends path for dot-prefixed directories without an explicit `./` prefix. `tsc` reported `TS6053: File '.wxt/tsconfig.json' not found` even though the file exists on disk. Root cause: TypeScript 5.x changed resolution logic for relative paths; `.foo/bar` is not treated as a relative path without the explicit `./` prefix.
- **Fix:** Changed `"extends": ".wxt/tsconfig.json"` to `"extends": "./.wxt/tsconfig.json"` in tsconfig.json.
- **Files modified:** tsconfig.json
- **Verification:** `npx tsc --noEmit` exits 0 cleanly after the fix.
- **Committed in:** aed27c8 (Task 1 commit — fix applied before commit)

**2. [Rule 1 - Bug] Vitest 4.x exits code 1 with zero test files**
- **Found during:** Task 2 verification (`npx vitest run`)
- **Issue:** `npx vitest run` exited code 1 with "No test files found, exiting with code 1". Plan acceptance criteria requires exit 0 vacuously with zero tests. Vitest 4.x changed this default behavior.
- **Fix:** Added `passWithNoTests: true` to the `test` block in vitest.config.ts.
- **Files modified:** vitest.config.ts
- **Verification:** `npx vitest run` exits 0 with "No test files found, exiting with code 0".
- **Committed in:** 69cb7a5 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes required for acceptance criteria compliance. No scope creep. The `./.wxt/` prefix deviation is load-bearing for all later phases that run `tsc --noEmit`.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Build pipeline is live: `wxt build` → `.output/chrome-mv3/` sideloadable
- TypeScript strict mode enforced from line one — all Phase 1 Wave 1+ plans compile against this config
- Vitest harness ready for Wave 1 unit tests
- ESLint DIST-04 layer 1 active — network API usage blocked at edit time
- OQ-4 closed: WXT 0.20.25 auto-discovers entrypoints from named subdirectories; no stubs needed until Phase 2+

## wxt.config.ts Audit Trail (D-19 lock)

```typescript
export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.',
  manifest: {
    name: 'AI Studio Instructions Sync',
    description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://aistudio.google.com/*'],
  },
});
```

## Generated Manifest (full JSON)

```json
{
  "manifest_version": 3,
  "name": "AI Studio Instructions Sync",
  "description": "Sync AI Studio system instructions across signed-in Chrome devices.",
  "version": "0.1.0",
  "minimum_chrome_version": "116",
  "permissions": ["storage", "scripting"],
  "host_permissions": ["https://aistudio.google.com/*"],
  "background": { "service_worker": "background.js" }
}
```

## OQ-4 Resolution

**NO stubs needed.** `wxt build` succeeds with only `src/background/index.ts`. WXT 0.20.25 does not error on absent `src/content/`, `src/popup/`, or `src/injected/` directories.

## TypeScript Flags Active

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`, `verbatimModuleSyntax` — all enabled, `tsc --noEmit` exits 0.

## Self-Check: PASSED

All files verified present on disk and all commits verified in git history:

- FOUND: package.json
- FOUND: wxt.config.ts
- FOUND: tsconfig.json
- FOUND: vitest.config.ts
- FOUND: eslint.config.mjs
- FOUND: .gitignore
- FOUND: src/background/index.ts
- FOUND: .wxt/tsconfig.json
- FOUND: .output/chrome-mv3/manifest.json
- FOUND: .output/chrome-mv3/background.js
- FOUND commit: aed27c8
- FOUND commit: 69cb7a5

---
*Phase: 01-foundation*
*Completed: 2026-05-05*

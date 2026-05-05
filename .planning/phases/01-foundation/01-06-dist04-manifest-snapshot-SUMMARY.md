---
phase: 01-foundation
plan: "06"
subsystem: testing/ci-gates
tags: [dist-04, dist-02, vitest, static-scan, manifest-snapshot, ci-enforcement]
dependency_graph:
  requires: [01-01, 01-02, 01-03, 01-04, 01-05]
  provides: [DIST-04-ci-gate, DIST-02-ci-gate]
  affects: [wxt.config.ts, src/dist-04.test.ts, src/build.test.ts]
tech_stack:
  added: []
  patterns:
    - Recipe 8 two-layer DIST-04 enforcement (ESLint layer 1 + Vitest static scan layer 2)
    - Manifest snapshot testing via wxt build + readFileSync + JSON.parse
    - WXT entrypoints:found hook to exclude *.test.ts from unlisted-script discovery
key_files:
  created:
    - src/dist-04.test.ts
    - src/build.test.ts
  modified:
    - wxt.config.ts
decisions:
  - "WXT entrypoints:found hook used to exclude *.test.ts files — WXT's glob pattern *.[jt]s?(x) matches any .ts file in entrypointsDir root, treating test files as unlisted-script entrypoints; hook is the official WXT API for this exclusion"
  - "dist-04.test.ts placed in src/ root per plan spec; WXT hook fix applied to allow this without breaking wxt build"
metrics:
  duration: "4 min"
  completed: "2026-05-05"
  tasks: 2
  files: 3
---

# Phase 1 Plan 06: DIST-04 Static Scan + DIST-02 Manifest Snapshot Summary

DIST-04 no-telemetry and DIST-02 manifest-permissions are now automated CI gates via two Vitest test files — a static regex scan of all src/ source files and a manifest snapshot assertion against the actual wxt build output.

## What Was Built

### src/dist-04.test.ts — DIST-04 Static Scan (Recipe 8 Layer 2)

Implements the Vitest half of Recipe 8's two-layer DIST-04 enforcement. The test walks `src/**/*.{ts,js,svelte,tsx,jsx}` (excluding `*.test.ts`) with a generator-based `walk()` function and applies 11 forbidden-pattern regexes:

- Network APIs: `fetch(`, `XMLHttpRequest`, `WebSocket(`, `EventSource(`, `navigator.sendBeacon`
- Analytics SDK markers: `google-analytics.com`, `gtag(`, `sentry.io`, `/datadog/i`, `/mixpanel/i`, `/amplitude/i`

The `*.test.ts` exclusion prevents self-flagging: the test file itself contains the literal `fetch\s*\(` regex string, which would trip the scan without the exclusion. Negation test confirmed: adding `fetch('https://example.com');` to a temp src file causes the test to fail immediately.

### src/build.test.ts — DIST-02 Manifest Snapshot (D-19 byte-exact)

Runs `wxt build` once in `beforeAll` (only when `.output/chrome-mv3/manifest.json` is missing or older than 5 minutes) then asserts 9 properties of the generated manifest:

1. Manifest file exists at `.output/chrome-mv3/manifest.json`
2. `manifest_version === 3`
3. `permissions` sorted equals `['scripting', 'storage']` (order-insensitive)
4. `host_permissions === ['https://aistudio.google.com/*']`
5. Raw manifest JSON does not contain `<all_urls>` substring
6. Forbidden permissions absent: `identity`, `tabs`, `notifications`, `cookies`, `webRequest`, `webRequestBlocking`
7. Forbidden host patterns absent: `<all_urls>`, `*://*/*`, `http://*/*`, `https://*/*`
8. `minimum_chrome_version >= 116` (numeric comparison)
9. CSP (if present) does not contain known telemetry hostnames (DIST-03 sanity check)

## Two-Layer DIST-04 Model

Plans 01 and 06 together realize the Recipe 8 two-layer guarantee per D-21:

| Layer | Mechanism | Timing | Location |
|-------|-----------|--------|----------|
| 1 | ESLint `no-restricted-globals` rule in `eslint.config.mjs` | Edit-time, pre-commit | Plan 01 |
| 2 | Vitest static scan in `src/dist-04.test.ts` | CI gate, `npm run test` | Plan 06 |

A bypass requires defeating both layers: a `// eslint-disable-line` comment AND removing the regex from `FORBIDDEN_PATTERNS` — both visible in the diff.

## Byte-Exact Manifest Contract (D-19)

`src/build.test.ts` validates the manifest WXT *actually produces*, not just what `wxt.config.ts` declares. The contract is now automated:

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "scripting"],
  "host_permissions": ["https://aistudio.google.com/*"],
  "minimum_chrome_version": "116"
}
```

A future `wxt.config.ts` edit that adds `"identity"` to permissions, widens host permissions to `*://*/*`, or lowers `minimum_chrome_version` to 115 will fail CI immediately.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WXT entrypoint collision for src/*.test.ts files**

- **Found during:** Task 2 (wxt build triggered by build.test.ts beforeAll)
- **Issue:** WXT's entrypoint discovery glob `*.[jt]s?(x)` matches any `.ts` file in the `entrypointsDir` root (`src/`). When `dist-04.test.ts` was placed in `src/` per plan spec, WXT treated it as an "unlisted-script" entrypoint and loaded it via `vite-node` during the build analysis phase. The top-level `describe()` call crashed with `Cannot read properties of undefined (reading 'config')` because Vitest's runner context is not available in WXT's build environment. This broke `wxt build` entirely.
- **Fix:** Added a `hooks['entrypoints:found']` callback in `wxt.config.ts` that filters out any entrypoint whose `inputPath` ends with `.test.ts`. This is the official WXT API for post-discovery entrypoint filtering and does not affect Vitest (which discovers test files independently via its own glob config).
- **Files modified:** `wxt.config.ts`
- **Commit:** cf42557
- **Note:** The pre-existing test files in `src/background/*.test.ts` and `src/shared/*.test.ts` were not affected because they reside in subdirectories — WXT's `*/index.[jt]s?(x)` subdirectory pattern only matches `index.ts`, not arbitrary test files. Only `src/*.ts` root files match the unlisted-script glob.

## Acknowledged Limitations

- **Scan scope:** `src/dist-04.test.ts` scans `src/` only, not `node_modules/`. A malicious transitive dependency that phone-homes via a bundled fetch would not be detected by this test. Phase 1 has no third-party runtime libraries (WXT and Svelte are build-time only), so this limitation is acceptable. When Phase 5 adds `@wxt-dev/module-svelte`, the module should be audited once and the verification documented.
- **CSP check:** `src/build.test.ts`'s DIST-03 CSP sanity check is a substring scan for known telemetry hostnames — it is not a full CSP policy parser. This is sufficient for Phase 1 (no CSP requirement in `wxt.config.ts`).
- **Manifest freshness:** The 5-minute staleness budget means a developer who edits `wxt.config.ts` and runs tests within 5 minutes of the last build may not catch the change. This is an acceptable trade-off for keeping the CI gate fast on warm runs.

## Suite Timing

- Cold run (wxt build triggered): ~3-5s (dominated by WXT build at ~300ms + Vite setup)
- Warm run (manifest fresh): ~270ms total for both test files
- Combined with the 4 prior plan test files: 46 tests pass in ~400ms total

## Self-Check

Checking created files exist and commits are in git log.

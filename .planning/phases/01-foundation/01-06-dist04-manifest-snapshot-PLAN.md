---
phase: 01-foundation
plan: 06
type: execute
wave: 3
depends_on: [01]
files_modified:
  - src/dist-04.test.ts
  - src/build.test.ts
autonomous: true
requirements: [DIST-02, DIST-04]
must_haves:
  truths:
    - "Vitest static-scan fails the suite if any src/ file (excluding *.test.ts) contains fetch/XMLHttpRequest/WebSocket/EventSource/navigator.sendBeacon or analytics SDK markers (google-analytics, gtag, sentry.io, datadog, mixpanel, amplitude)"
    - "Manifest snapshot test fails the suite if generated manifest.json permissions array is not exactly ['storage', 'scripting']"
    - "Manifest snapshot test fails the suite if generated manifest.json host_permissions is not exactly ['https://aistudio.google.com/*']"
    - "Manifest snapshot test fails the suite if manifest.json contains forbidden keys: <all_urls>, identity, tabs, notifications"
    - "Both tests run as part of `npm run test -- --run` and complete in <2s combined"
  artifacts:
    - path: "src/dist-04.test.ts"
      provides: "DIST-04 structural verification — static scan of src/ for forbidden network APIs (Recipe 8 layer 2)"
      contains: "FORBIDDEN_PATTERNS, walk(), describe('DIST-04: no third-party network calls'"
    - path: "src/build.test.ts"
      provides: "DIST-02 manifest snapshot — asserts permission set matches D-19 byte-exact"
      contains: "describe('DIST-02: manifest permissions', expect(manifest.permissions).toEqual(['storage', 'scripting'])"
  key_links:
    - from: "src/dist-04.test.ts"
      to: "src/**/*.{ts,js} (excluding *.test.ts)"
      via: "node:fs readdirSync + readFileSync regex scan"
      pattern: "walk\\('src'\\)"
    - from: "src/build.test.ts"
      to: ".output/chrome-mv3/manifest.json"
      via: "readFileSync + JSON.parse after `wxt build`"
      pattern: "\\.output/chrome-mv3/manifest\\.json"
    - from: "Plan 01 ESLint config (eslint.config.mjs no-restricted-globals)"
      to: "Plan 06 Vitest static-scan (this plan, src/dist-04.test.ts)"
      via: "Two-layer DIST-04 enforcement — ESLint at edit-time + Vitest at CI gate"
      pattern: "DIST-04"
---

<objective>
Add the structural verification layer that turns DIST-04 (no third-party network calls) and DIST-02 (minimum permissions) from review-time conventions into automated CI gates.

Purpose: After Plan 01 wires ESLint `no-restricted-globals` (Recipe 8 layer 1, edit-time feedback), the codebase still has no enforcement at CI. A future contributor can disable the rule line-locally, use raw string concatenation to build a `fetch` call, or import an analytics SDK that ESLint cannot statically resolve. Plan 06 closes both gaps with two Vitest tests that fail the suite at CI gate. Combined with Plan 01's ESLint config, this realizes Recipe 8's "two-layer" guarantee per D-21.

Output:
- `src/dist-04.test.ts` — Vitest static scan of `src/**/*.{ts,js}` excluding `*.test.ts` for 11 forbidden patterns (Recipe 8 layer 2 verbatim).
- `src/build.test.ts` — Vitest snapshot test that runs (or reads pre-built) `.output/chrome-mv3/manifest.json` and asserts `permissions === ['storage', 'scripting']`, `host_permissions === ['https://aistudio.google.com/*']`, and explicit absence of forbidden keys (`<all_urls>`, `identity`, `tabs`, `notifications`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-PATTERNS.md
@.planning/phases/01-foundation/01-01-PLAN.md

<interfaces>
<!-- Both files are net-new; there are no internal interfaces to import.
     Test files use only Node built-ins (node:fs, node:path) and Vitest globals. -->

Vitest globals (from `vitest`):
```typescript
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare const expect: <T>(actual: T) => Matchers<T>;
```

Node built-ins used:
```typescript
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
```

D-19 (locked manifest contract — byte-exact target):
```json
{
  "manifest_version": 3,
  "permissions": ["storage", "scripting"],
  "host_permissions": ["https://aistudio.google.com/*"],
  "minimum_chrome_version": "116"
}
```
Forbidden keys (must NOT appear at any nesting level):
- `"<all_urls>"` (anywhere as a value)
- `"identity"` in `permissions`
- `"tabs"` in `permissions`
- `"notifications"` in `permissions`

Plan 01 outputs this plan depends on (already produced in Wave 0):
- `package.json` with `"test": "vitest"` script
- `vitest.config.ts` with `WxtVitest()` plugin
- `wxt.config.ts` declaring the manifest above
- `src/background/index.ts` (so `walk('src')` finds at least one source file)
- A `npm run build` script that produces `.output/chrome-mv3/manifest.json`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write src/dist-04.test.ts (Vitest static scan, Recipe 8 layer 2)</name>
  <files>src/dist-04.test.ts</files>

  <read_first>
    1. `.planning/phases/01-foundation/01-RESEARCH.md` lines 596-682 (Recipe 8 — both ESLint and Vitest layers, including the "Why both layers" rationale).
    2. `.planning/phases/01-foundation/01-CONTEXT.md` D-21 (line 60) — DIST-04 is a structural property of the codebase.
    3. `.planning/REQUIREMENTS.md` DIST-04 row.
    4. The current `package.json` and `vitest.config.ts` produced by Plan 01 — confirm Vitest 4.1.5 + `WxtVitest()` are wired and `npm run test -- --run` is the suite command. If not, that is a Plan 01 defect to flag, not a Plan 06 task.
    5. `tsconfig.json` from Plan 01 — confirm `node` is in `compilerOptions.types` so `node:fs`, `node:path` imports type-check. If `@types/node` is not yet a devDependency, add it as part of this task (it is required for the test file to type-check; Plan 01 may have omitted it).
  </read_first>

  <action>
Create `src/dist-04.test.ts` implementing Recipe 8 layer 2 verbatim, with the following structure:

```typescript
// src/dist-04.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Forbidden patterns per D-21 / Recipe 8 layer 2. The list intentionally
// matches the RESEARCH.md Recipe 8 verbatim — DO NOT trim entries without
// updating the recipe.
const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\s*\(/,
  /\bEventSource\s*\(/,
  /\bnavigator\.sendBeacon\b/,
  // analytics SDK markers
  /\bgoogle-analytics\.com\b/,
  /\bgtag\s*\(/,
  /\bsentry\.io\b/,
  /\bdatadog/i,
  /\bmixpanel/i,
  /\bamplitude/i,
];

// File-extension allowlist matches RESEARCH.md Recipe 8: .ts, .js, .svelte,
// .tsx, .jsx. Test files (*.test.ts) are excluded so this test file itself
// — and the literal `fetch(` regex it contains — does not trigger violations.
const SCAN_EXTENSIONS = /\.(ts|js|svelte|tsx|jsx)$/;
const TEST_FILE_SUFFIX = '.test.ts';

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCAN_EXTENSIONS.test(name) && !name.endsWith(TEST_FILE_SUFFIX)) {
      yield path;
    }
  }
}

describe('DIST-04: no third-party network calls', () => {
  it('src/ contains no forbidden network APIs or analytics SDKs', () => {
    const violations: string[] = [];
    for (const file of walk('src')) {
      const content = readFileSync(file, 'utf8');
      for (const pat of FORBIDDEN_PATTERNS) {
        if (pat.test(content)) {
          violations.push(`${file}: ${pat}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

Notes:
- The test runs from the repo root (Vitest's default `cwd`); `walk('src')` is a relative path resolved against `cwd`. Plan 01's `vitest.config.ts` does not override `root`, so this works.
- The exclusion `!name.endsWith('.test.ts')` is what prevents this test file from flagging itself (its source contains the literal regex `\bfetch\s*\(`).
- Using `.test.ts` suffix (not a directory exclusion) is intentional per D-25 colocation discretion — a future `src/foo/__tests__/` layout would also need updating here.
- Do NOT add custom Vitest config, custom timeouts, or a `setupFiles` entry — the test is a single synchronous IO scan and finishes in <200ms per Recipe 8 footer.
- Do NOT widen the pattern list with project-specific additions in this task; the RESEARCH-locked list is the v1 contract. Future widening goes through a research update, not an opportunistic test edit.
- If `@types/node` is missing from `package.json` devDependencies, add it (`@types/node@^20`) and run `npm install`. The `node:fs` and `node:path` imports require it for typechecking under TypeScript 5.8 strict mode.
  </action>

  <acceptance_criteria>
- `src/dist-04.test.ts` exists.
- File contains the literal substring `'DIST-04: no third-party network calls'` (the `describe` block name).
- File contains the literal substring `FORBIDDEN_PATTERNS` (declared as `ReadonlyArray<RegExp>`).
- File contains all 11 patterns from Recipe 8: greppable as `\bfetch\\s*\\(`, `\bXMLHttpRequest\\b`, `\bWebSocket\\s*\\(`, `\bEventSource\\s*\\(`, `\bnavigator\\.sendBeacon\\b`, `\bgoogle-analytics\\.com\\b`, `\bgtag\\s*\\(`, `\bsentry\\.io\\b`, `\bdatadog`, `\bmixpanel`, `\bamplitude`.
- File contains `function* walk(dir: string): Generator<string>` (verbatim recipe).
- File contains `!name.endsWith('.test.ts')` so the test file does not flag itself.
- File does NOT import from `'fetch'` or any HTTP library; the only imports are `vitest`, `node:fs`, `node:path`.
- `npx tsc --noEmit` passes (file type-checks under strict mode).
- `npx vitest run src/dist-04.test.ts` exits 0 (no violations in current src/).
- The test takes <500ms wall time.
  </acceptance_criteria>

  <verify>
    <automated>npx vitest run src/dist-04.test.ts && npx tsc --noEmit && grep -F "DIST-04: no third-party network calls" src/dist-04.test.ts && grep -cF "FORBIDDEN_PATTERNS" src/dist-04.test.ts | grep -qE '^[1-9]' && grep -F "!name.endsWith('.test.ts')" src/dist-04.test.ts</automated>
  </verify>

  <done>
The DIST-04 static scan exists and passes against the current Plan 01–05 codebase. A future commit that adds `fetch(...)` to any non-test src/ file fails this test. The literal regex strings inside the test file itself do not cause self-flagging because of the `.test.ts` suffix exclusion.
  </done>
</task>

<task type="auto">
  <name>Task 2: Write src/build.test.ts (manifest snapshot, DIST-02)</name>
  <files>src/build.test.ts</files>

  <read_first>
    1. `.planning/phases/01-foundation/01-CONTEXT.md` D-19 (line 58) — the byte-exact permission set: `storage`, `scripting`, host `https://aistudio.google.com/*`, no `<all_urls>`, no `identity`, no `tabs`, no `notifications`.
    2. `.planning/phases/01-foundation/01-CONTEXT.md` D-20 — sideloadable build is the v1 distribution channel; this test guards the manifest from drift.
    3. `.planning/phases/01-foundation/01-RESEARCH.md` line 175 (validation table row for DIST-02) — `vitest run src/build.test.ts -t "manifest permissions"`.
    4. `wxt.config.ts` from Plan 01 — confirm the manifest declaration is the locked target. If it disagrees with D-19, that is a Plan 01 defect to flag (but this test must still assert D-19 — the test is the contract, the config follows).
    5. `package.json` from Plan 01 — confirm `"build": "wxt build"` script exists.
    6. The behavior of `wxt build` output: by default WXT emits `.output/chrome-mv3/manifest.json` for the `chrome` target. The default target is chrome, so no `--mode` flag is needed.
  </read_first>

  <action>
Create `src/build.test.ts` that runs `wxt build` once (or reads a pre-built manifest if `.output/chrome-mv3/manifest.json` exists and is recent) and asserts the generated manifest's permission set is byte-exact with D-19.

Implementation:

```typescript
// src/build.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const MANIFEST_PATH = join('.output', 'chrome-mv3', 'manifest.json');
const STALENESS_BUDGET_MS = 5 * 60 * 1000; // 5 minutes

interface ChromeManifest {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  minimum_chrome_version?: string;
  [key: string]: unknown;
}

function loadManifest(): ChromeManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ChromeManifest;
}

function manifestIsFresh(): boolean {
  if (!existsSync(MANIFEST_PATH)) return false;
  const ageMs = Date.now() - statSync(MANIFEST_PATH).mtimeMs;
  return ageMs < STALENESS_BUDGET_MS;
}

beforeAll(() => {
  if (!manifestIsFresh()) {
    // Build once. WXT's default target is chrome-mv3.
    execSync('npx wxt build', { stdio: 'inherit' });
  }
}, 120_000);

describe('DIST-02: manifest permissions', () => {
  it('manifest exists at .output/chrome-mv3/manifest.json', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it('manifest_version is 3', () => {
    const m = loadManifest();
    expect(m.manifest_version).toBe(3);
  });

  it('permissions is exactly ["storage", "scripting"]', () => {
    const m = loadManifest();
    // Order-insensitive equality with cardinality check.
    const perms = (m.permissions ?? []).slice().sort();
    expect(perms).toEqual(['scripting', 'storage']);
  });

  it('host_permissions is exactly ["https://aistudio.google.com/*"]', () => {
    const m = loadManifest();
    expect(m.host_permissions).toEqual(['https://aistudio.google.com/*']);
  });

  it('manifest does not declare <all_urls> anywhere', () => {
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    expect(raw.includes('<all_urls>')).toBe(false);
  });

  it('forbidden permissions are absent', () => {
    const m = loadManifest();
    const perms = m.permissions ?? [];
    for (const forbidden of ['identity', 'tabs', 'notifications', 'cookies', 'webRequest', 'webRequestBlocking']) {
      expect(perms).not.toContain(forbidden);
    }
  });

  it('forbidden host_permissions are absent', () => {
    const m = loadManifest();
    const hosts = m.host_permissions ?? [];
    expect(hosts).not.toContain('<all_urls>');
    expect(hosts).not.toContain('*://*/*');
    expect(hosts).not.toContain('http://*/*');
    expect(hosts).not.toContain('https://*/*');
  });

  it('minimum_chrome_version is "116" (or higher numeric)', () => {
    const m = loadManifest();
    // OQ-2 resolved: D-19 minimum is 116 to ensure crypto.randomUUID + chrome.scripting.
    expect(m.minimum_chrome_version).toBeDefined();
    expect(parseInt(m.minimum_chrome_version!, 10)).toBeGreaterThanOrEqual(116);
  });

  it('no telemetry hosts in CSP (DIST-03 sanity check)', () => {
    const m = loadManifest();
    const csp = m['content_security_policy'];
    if (csp == null) return; // CSP absence is acceptable in MV3 — Chrome applies defaults.
    const cspString = JSON.stringify(csp);
    for (const host of ['google-analytics.com', 'sentry.io', 'datadog', 'mixpanel.com', 'amplitude.com']) {
      expect(cspString).not.toContain(host);
    }
  });
});
```

Notes:
- The `beforeAll` builds `.output/chrome-mv3/manifest.json` only if missing or older than 5 minutes — keeps the test fast on repeated local runs while still rebuilding in CI (where `.output/` is gitignored and absent on cold start).
- `expect(perms.sort()).toEqual(['scripting', 'storage'])` is order-insensitive; WXT may emit permissions in either order, both are correct.
- The `<all_urls>` raw-string check (`raw.includes('<all_urls>')`) is intentionally a substring scan of the JSON text. This catches the token in any field — `permissions`, `host_permissions`, `content_scripts[].matches`, `web_accessible_resources[].matches` — without needing to enumerate every nesting site.
- The DIST-03 CSP sanity check is not a hard DIST-03 verification (DIST-03 is the broader "output bundle clean of debug flags" requirement), but checking telemetry hostnames in CSP is cheap and aligns with D-21.
- `execSync('npx wxt build')` runs synchronously inside `beforeAll`. Set the Vitest timeout to 120s to allow for cold builds. Do NOT add a `--mode production` flag; WXT's default `wxt build` target is the production-style chrome MV3 build.
- `.output/` MUST be in `.gitignore` (Plan 01 already does this). If not, add it as part of this task.
- Do NOT spawn `wxt build` per-test; one build per test file is enough — `beforeAll` covers it.
- The test does NOT set environment variables or override WXT config; it asserts what `wxt build` *actually* produces, not what config files claim.
  </action>

  <acceptance_criteria>
- `src/build.test.ts` exists.
- File contains `describe('DIST-02: manifest permissions'`.
- File contains assertion `expect(perms).toEqual(['scripting', 'storage'])` or equivalent order-insensitive form.
- File contains assertion `expect(m.host_permissions).toEqual(['https://aistudio.google.com/*'])`.
- File contains assertion that rejects `<all_urls>` substring in raw manifest.
- File contains assertion that `permissions` does not contain `identity`, `tabs`, `notifications`.
- File contains assertion `expect(m.manifest_version).toBe(3)`.
- File contains assertion that `minimum_chrome_version` is `>= 116`.
- File uses `beforeAll` with `120_000` timeout to invoke `wxt build` only when manifest is stale.
- `npx tsc --noEmit` passes.
- `npx vitest run src/build.test.ts` exits 0 against Plan 01's `wxt.config.ts`.
- After test run, `.output/chrome-mv3/manifest.json` exists and is parseable JSON.
- The full Phase 1 suite (`npm run test -- --run`) completes green: all of Plans 02/03/04/05 plus this plan's two test files.
  </acceptance_criteria>

  <verify>
    <automated>npx vitest run src/build.test.ts && npx tsc --noEmit && grep -F "DIST-02: manifest permissions" src/build.test.ts && grep -F "https://aistudio.google.com/*" src/build.test.ts && grep -F "<all_urls>" src/build.test.ts && test -f .output/chrome-mv3/manifest.json && node -e "const m=JSON.parse(require('fs').readFileSync('.output/chrome-mv3/manifest.json','utf8')); if(JSON.stringify((m.permissions||[]).slice().sort())!==JSON.stringify(['scripting','storage'])) process.exit(1); if(JSON.stringify(m.host_permissions)!==JSON.stringify(['https://aistudio.google.com/*'])) process.exit(2);"</automated>
  </verify>

  <done>
A future PR that adds `"identity"` to permissions, swaps the host glob to `<all_urls>`, or drops `minimum_chrome_version` below 116 fails CI on this file. The test rebuilds when the artifact is stale and is fast (<200ms) on warm runs. Combined with Plan 01's manifest declaration, DIST-02 is now contract-tested rather than convention-tested.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Source repo → installed extension | Code committed to src/ becomes the runtime extension after `wxt build`; any forbidden API call inside src/ becomes a runtime capability of the published extension |
| `wxt.config.ts` declarations → generated manifest.json | WXT translates config to manifest; if the config silently grows a permission, the manifest grows it; if the manifest grows it, the installed extension gains that capability |
| External contributor → repo (PR/commit) | Untrusted code change crosses into the build pipeline |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-25 | Tampering | Supply chain — a future commit (own or third-party) inserts a `fetch()`, `XMLHttpRequest`, `WebSocket`, `EventSource`, or `navigator.sendBeacon` call that exfiltrates user instructions to an external host, violating DIST-04 and the project's no-telemetry charter (CLAUDE.md hard rule "no telemetry, no third-party calls") | mitigate | Two-layer enforcement per Recipe 8: (a) Plan 01's ESLint `no-restricted-globals` rule fails edit-time and pre-commit (fast feedback). (b) This plan's `src/dist-04.test.ts` runs at every CI gate via `npm run test -- --run`, scanning all `src/**/*.{ts,js,svelte,tsx,jsx}` (excluding `*.test.ts`) for 11 forbidden patterns. A bypass requires defeating both layers — disabling ESLint inline AND removing the pattern from the Vitest test file, both of which are visible in the diff |
| T-01-26 | Elevation of Privilege | Manifest permission scope creep — a future `wxt.config.ts` edit adds `identity`, `tabs`, `notifications`, `cookies`, `webRequest`, `<all_urls>`, or any wider host pattern, granting the extension access to data outside its stated AI Studio scope | mitigate | `src/build.test.ts` runs `wxt build` and asserts the generated `manifest.json` permission arrays are byte-exact with D-19: `permissions === ['storage', 'scripting']`, `host_permissions === ['https://aistudio.google.com/*']`, plus explicit blocks on `identity`, `tabs`, `notifications`, `<all_urls>`, `*://*/*`. A drift fails CI immediately, before the build artifact is sideloaded |
| T-01-27 | Information Disclosure | Analytics SDK accidentally imported via dependency — a future devDependency or transient upgrade pulls in google-analytics, gtag, sentry, datadog, mixpanel, or amplitude, surfacing in src/ via a usage call | mitigate | The Recipe 8 pattern list includes 6 SDK markers (`google-analytics.com`, `gtag(`, `sentry.io`, `/datadog/i`, `/mixpanel/i`, `/amplitude/i`). Any usage in src/ trips the test. Acknowledged limitation per Recipe 8: the test does NOT scan `node_modules/`, only `src/`. Phase 1 has no third-party runtime libs (only WXT, build-time only). When Phase 5 adds Svelte, audit `@wxt-dev/module-svelte` once and add to a verified-clean list |
| T-01-28 | Repudiation | Subtle CSP drift admits a telemetry host — `wxt.config.ts` adds `content_security_policy` with a third-party host, allowing future code to phone home undetected | accept (with sanity check) | Plan 06 Task 2 includes a CSP sanity check that scans the generated manifest's CSP for known telemetry hostnames (`google-analytics.com`, `sentry.io`, `datadog`, `mixpanel.com`, `amplitude.com`). This is a defense-in-depth check, not a complete CSP policy enforcement (which would require a CSP parser). Full CSP analysis is deferred — Phase 1 has no CSP requirement, so the sanity check is sufficient |
| T-01-29 | Denial of Service | Static scan regex catastrophic backtracking on a large generated file — a future code-gen step produces a multi-megabyte file that triggers exponential regex evaluation | accept | All Recipe 8 patterns are linear (no nested quantifiers, no overlapping alternations); ReDoS-safe by construction. `src/` is hand-written, no codegen in Phase 1. Re-evaluate if codegen ever lands in src/ |

**Why all mitigations name specific files and lines, not generic advice:** per planner protocol, every "mitigate" entry above points to a concrete enforcement site (Plan 01's `eslint.config.mjs` `no-restricted-globals` rule + Plan 06 Task 1's `src/dist-04.test.ts` regex list + Plan 06 Task 2's `src/build.test.ts` permission assertions). A reviewer can grep the plan to verify each disposition is backed by a real test or rule.
</threat_model>

<verification>
After both tasks complete:

```bash
# Full Phase 1 suite — all six plans' tests pass.
npm run test -- --run

# Build artifact is correct.
npx wxt build
test -f .output/chrome-mv3/manifest.json
node -e "const m=JSON.parse(require('fs').readFileSync('.output/chrome-mv3/manifest.json','utf8')); console.log(JSON.stringify({permissions:m.permissions, host_permissions:m.host_permissions, manifest_version:m.manifest_version, minimum_chrome_version:m.minimum_chrome_version}, null, 2));"

# Negative-test the static scan: a deliberate violation should fail CI.
# (Only run as a one-off sanity check; revert before commit.)
echo "fetch('https://example.com');" > src/_violation_check.ts
npx vitest run src/dist-04.test.ts && echo "FAIL: scan missed violation" || echo "OK: scan caught violation"
rm src/_violation_check.ts
```

Smoke-build for the full DIST-01..04 chain (RESEARCH.md validation table, lines 174-177):
- DIST-01: `npm run build && ls .output/chrome-mv3/manifest.json` → file exists.
- DIST-02: `npx vitest run src/build.test.ts -t "manifest permissions"` → green.
- DIST-03: `jq '.content_security_policy' .output/chrome-mv3/manifest.json` → no telemetry hosts (CSP sanity).
- DIST-04: `npx vitest run src/dist-04.test.ts` → green.
</verification>

<success_criteria>
- `src/dist-04.test.ts` exists, type-checks, passes.
- `src/build.test.ts` exists, type-checks, passes; asserts D-19 byte-exact.
- `npm run test -- --run` exits 0 across all six Phase 1 plan test files.
- `wxt build` produces `.output/chrome-mv3/manifest.json` with `permissions: ['storage', 'scripting']` and `host_permissions: ['https://aistudio.google.com/*']` only.
- A grep for `<all_urls>`, `identity`, `tabs`, `notifications` against the generated manifest returns no matches.
- A grep for `fetch(`, `XMLHttpRequest`, `WebSocket(`, `EventSource(`, `navigator.sendBeacon`, `gtag(`, `sentry.io`, `datadog`, `mixpanel`, `amplitude`, `google-analytics.com` against `src/**/*.{ts,js}` (excluding `*.test.ts`) returns no matches.
- DIST-02 and DIST-04 are now contract-tested at CI gate, not review-time conventions.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-06-SUMMARY.md` documenting:
- The two test files created and what they enforce.
- The two-layer DIST-04 model (ESLint + Vitest) realized in Plans 01+06.
- The byte-exact manifest contract (D-19) now backed by automated assertion.
- Acknowledged limitations: scan covers `src/` only, not `node_modules/`; CSP check is a sanity scan, not a full policy parse.
- Suite timing: combined cold time ~3-5s (driven by `wxt build`), warm time <500ms.
</output>

# Phase 1: Foundation — Pattern Map

**Mapped:** 2026-05-01
**Status:** Greenfield — no internal analogs exist. Phase 1 ESTABLISHES the patterns that all later phases mirror.
**Files analyzed:** 16 (4 build/tooling configs, 5 source modules, 1 SW entrypoint, 6 test files)
**Internal analogs found:** 0 / 16 (expected — repo currently contains only `.planning/` and `CLAUDE.md`)

---

## Reading Posture for the Planner

Because this is a greenfield phase, every "analog" reference points to one of three external sources:

1. **RESEARCH.md recipes** (`.planning/phases/01-foundation/01-RESEARCH.md`) — load-bearing; the recipes contain executable sketches of the exact files Phase 1 builds. Treat each recipe as the "closest analog" for its corresponding file.
2. **WXT official docs and examples** — `wxt-dev/examples/vitest-unit-testing` (test harness), `wxt.dev/guide/essentials/config/manifest`, `wxt.dev/guide/essentials/entrypoints.html`, `wxt.dev/guide/essentials/unit-testing`.
3. **Chrome Extensions / MDN docs** — `developer.chrome.com/docs/extensions/reference/api/storage`, `developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled`, `developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID`.

The local research/ARCHITECTURE.md `Project Structure` block (lines 514–537) is the canonical layout target.

---

## File Classification

| File to Create | Role | Data Flow | Closest External Analog | Local Reference |
|---|---|---|---|---|
| `package.json` | Build config | — | WXT `init` template scaffolds | RESEARCH §"Stack lock" + §"Recipe 3" |
| `wxt.config.ts` | Build/manifest config | manifest generation | `wxt.dev/guide/essentials/config/manifest`; turbostarter/extro `wxt.config.ts` | RESEARCH §"Recipe 3" |
| `tsconfig.json` | Compiler config | — | TS 5.x "modern strict" baseline | RESEARCH §"Recipe 10" |
| `vitest.config.ts` | Test harness config | — | `wxt-dev/examples/vitest-unit-testing` | RESEARCH §"Recipe 2" |
| `eslint.config.mjs` | Lint config (DIST-04 layer 1) | — | ESLint `no-restricted-globals` docs | RESEARCH §"Recipe 8" |
| `src/shared/constants.ts` | Magic numbers / keys | — (pure exports) | — (greenfield) | CONTEXT D-24 (verbatim list) |
| `src/shared/types.ts` | Type declarations | — (pure exports) | — (greenfield) | CONTEXT D-03, D-12, D-13, D-14, D-15; ARCHITECTURE.md lines 142–163 |
| `src/shared/meta-guard.ts` | Schema-version reader guard | request-response (returns GuardResult) | — (greenfield, established here) | RESEARCH §"Recipe 7" |
| `src/background/storage-layout.ts` | Storage primitives (chunking) | CRUD + transform | — (greenfield) | RESEARCH §"Recipe 1" |
| `src/background/registry.ts` | Registry CRUD + UUID + tombstones | CRUD | — (greenfield) | RESEARCH §"Recipe 9"; CONTEXT D-03, D-16, D-18 |
| `src/background/hash.ts` | Short content hashes (SHA-256 truncated) | transform | MDN `SubtleCrypto.digest` | RESEARCH §"Recipe 6" (sketch) |
| `src/background/meta-bootstrap.ts` | `sysins:meta` write-if-absent | request-response | Chrome `runtime.onInstalled` docs | RESEARCH §"Recipe 4" |
| `src/background/index.ts` | SW entrypoint (Phase 1 = `onInstalled` only) | event-driven | `wxt-dev/examples` background entry; `wxt/utils/define-background` | RESEARCH §"Recipe 4" |
| `src/background/storage-layout.test.ts` | Unit tests (chunking round-trip + UTF-8 boundaries) | test | `wxt-dev/examples/vitest-unit-testing` | RESEARCH §"Recipe 1" edge-case table + §"Recipe 2" |
| `src/background/registry.test.ts` | Unit tests (UUID, updatedAt, tombstone) | test | `wxt-dev/examples/vitest-unit-testing` | RESEARCH §"Recipe 9" |
| `src/background/service-worker.test.ts` | Unit tests (`onInstalled` + SW-restart resume) | test | `wxt-dev/examples/vitest-unit-testing` | RESEARCH §"Recipe 2" + §"Recipe 4" |
| `src/dist-04.test.ts` | Static-scan test (no `fetch` etc.) | test | — (project-specific) | RESEARCH §"Recipe 8" layer 2 |
| `src/build.test.ts` (optional) | Manifest snapshot (DIST-02) | test | — (project-specific) | RESEARCH validation table line 175 |

**No hand-written `manifest.json`.** WXT generates `manifest.json` at build time from `wxt.config.ts`'s `manifest:` block. (RESEARCH §"Recipe 3", confirms ARCHITECTURE.md's example manifest snippet at lines 192–211 is illustrative only.)

---

## Pattern Assignments

### `wxt.config.ts` (build/manifest config)

**Reference:** RESEARCH §"Recipe 3: WXT 0.20.25 Manifest Configuration"

**Imports pattern (RESEARCH lines 362–363):**
```typescript
import { defineConfig } from 'wxt';
```

**Core pattern — manifest declaration verbatim (RESEARCH lines 364–378):**
```typescript
export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.', // matches D-23 layout under src/
  // No `modules: ['@wxt-dev/module-svelte']` in Phase 1 — Svelte is Phase 5.
  manifest: {
    name: 'AI Studio Instructions Sync',
    description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
    version: '0.1.0',
    minimum_chrome_version: '116', // OQ-2 recommendation; Claude-discretion
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://aistudio.google.com/*'],
    // No <all_urls>, no identity, no tabs, no notifications. D-19 verbatim.
  },
});
```

**D-19 lock:** Permissions list is exhaustive — `storage` + `scripting` + host `https://aistudio.google.com/*`. No additions. `chrome.action` (popup, Phase 5) does NOT require its own permission entry (RESEARCH line 384, citing developer.chrome.com).

---

### `src/shared/constants.ts` (magic-number registry)

**Reference:** CONTEXT D-24 (the locked list).

**Core pattern — single-source-of-truth exports (CONTEXT line 75):**
```typescript
export const KEY_PREFIX = 'sysins:';
export const LOCAL_KEY_PREFIX = 'sysins:local:';
export const META_KEY = 'sysins:meta';
export const REGISTRY_KEY = 'sysins:registry';
export const BODY_KEY_PREFIX = 'sysins:body:';
export const CHUNK_BUDGET_BYTES = 7000;
export const SCHEMA_VERSION = 1;
export const PENDING_BATCH_TTL_MS = 60_000;
export const PENDING_MERGE_QUEUE_CAP = 10;
export const TOMBSTONE_GC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
```

**Hard rule:** Inline magic numbers are forbidden anywhere in `src/`. Every other module imports from here. The planner should add an ESLint rule (`no-magic-numbers` with the literal-allow-list `[0, 1, -1]`) to enforce.

---

### `src/shared/types.ts` (type declarations)

**Reference:** CONTEXT D-03, D-12, D-13, D-14, D-15; ARCHITECTURE.md lines 142–163.

**Core types to define (CONTEXT D-03 + D-15):**
```typescript
// sysins:meta
export interface SyncMeta {
  schemaVersion: 1;
  lastPushAt: number;
  lastPullAt: number;
}

// sysins:registry — keyed by UUID
export interface RegistryRecord {
  title: string;
  updatedAt: number;
  deletedAt: number | null;
  chunks: number; // D-03: body chunk count, avoids extra round-trip
}
export type SyncRegistry = Record<string, RegistryRecord>;

// sysins:body:<uuid> — JSON.stringify({text, ...rest}) per D-01
export interface BodyPayload {
  text: string;
  [unknownAiStudioField: string]: unknown; // ...rest spread per D-01
}

// sysins:local:lastPushed (D-12)
export interface LastPushedEntry {
  titleHash: string;
  bodyHash: string;
  updatedAt: number;
}
export type LastPushedSnapshot = Record<string, LastPushedEntry>;

// sysins:local:syncPending (D-13)
export interface SyncPendingSentinel {
  batchId: string;
  keys: string[];
  startedAt: number;
}

// sysins:local:pendingMerges (D-14)
export interface PendingMerge {
  changes: unknown; // shape locked in Phase 3 when consumer exists
  receivedAt: number;
}

// sysins:local:syncStatus (D-15)
export type ErrorState =
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SCHEMA_AHEAD'
  | 'SCHEMA_UNKNOWN'
  | 'MALFORMED_REMOTE'
  | 'ACCOUNT_MISMATCH'
  | 'OVERSIZED_ITEM'
  | 'STRICT_VALIDATION_FAIL'
  | 'PENDING_MERGE_OVERFLOW'; // OQ-1 recommendation: widen D-15 enum

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  lastSyncAt: number;
  errorState?: ErrorState;
  errorDetail?: string;
}
```

**Note for planner:** OQ-1 (RESEARCH line 800) recommends adding `'PENDING_MERGE_OVERFLOW'` to the enum — D-15 explicitly says "Phase 1 defines the shape," so widening at design time is in scope. Confirm during plan-check or fold in directly.

---

### `src/shared/meta-guard.ts` (schema-version reader guard)

**Reference:** RESEARCH §"Recipe 7: Schema-Version Reader Guard"

**Core pattern (RESEARCH lines 541–569) — copy verbatim:**
```typescript
import { META_KEY, SCHEMA_VERSION } from './constants';
import type { SyncMeta } from './types';

export type GuardResult =
  | { ok: true; meta: SyncMeta }
  | { ok: false; tag: 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' };

export async function loadAndAssertMeta(): Promise<GuardResult> {
  const r = await chrome.storage.sync.get(META_KEY);
  const meta = r[META_KEY] as SyncMeta | undefined;

  if (meta === undefined) return { ok: false, tag: 'MALFORMED_REMOTE' };
  if (typeof meta.schemaVersion !== 'number') return { ok: false, tag: 'MALFORMED_REMOTE' };
  if (meta.schemaVersion > SCHEMA_VERSION) return { ok: false, tag: 'SCHEMA_AHEAD' };
  if (meta.schemaVersion < SCHEMA_VERSION) return { ok: false, tag: 'SCHEMA_UNKNOWN' };
  return { ok: true, meta };
}
```

**Why it lives in `shared/`, not `background/` (RESEARCH lines 572–576):** A single test surface; one place to extend on schema v2; per-consumer drift kills correctness over time. Phase 1 has only one caller (the SW), but Phase 2+ adds many — establishing the wrapper now is cheap.

---

### `src/background/storage-layout.ts` (chunking primitives)

**Reference:** RESEARCH §"Recipe 1: Chunking Math"

**Core algorithm — codepoint-walk splitter (RESEARCH lines 204–245):**
```typescript
import { CHUNK_BUDGET_BYTES } from '../shared/constants';

const encoder = new TextEncoder();

export function splitIntoChunks(body: string, budget = CHUNK_BUDGET_BYTES): string[] {
  if (body.length === 0) return ['']; // D-04: always-chunked, even empty
  const chunks: string[] = [];
  let buf = '';
  let bufBytes = 0;

  for (const codepoint of body) { // for-of is codepoint-aware
    const cpBytes = encoder.encode(codepoint).byteLength;
    if (cpBytes > budget) {
      throw new Error(`Codepoint exceeds chunk budget: ${cpBytes} > ${budget}`);
    }
    if (bufBytes + cpBytes > budget) {
      chunks.push(buf);
      buf = codepoint;
      bufBytes = cpBytes;
    } else {
      buf += codepoint;
      bufBytes += cpBytes;
    }
  }
  chunks.push(buf);
  return chunks;
}

export function joinChunks(chunks: string[]): string {
  return chunks.join('');
}

export function chunkByteLength(chunk: string): number {
  return new Blob([chunk]).size; // D-05 measurement primitive
}
```

**Boundary lock-in (RESEARCH line 259):** When a multi-byte codepoint lands at the boundary, it goes entirely into the next chunk (asymmetric split). Reassembly is `chunks.join('')` — always recovers original.

**Edge cases (the test file MUST exercise all of these — RESEARCH lines 247–257):**

| Case | Expected |
|---|---|
| `""` | `[""]` (D-04 always-chunked) |
| ASCII length 7000 | one chunk |
| ASCII length 7001 | two chunks (7000 + 1) |
| `🌍` at byte 6998 | chunk 1 ends at 6998, chunk 2 starts with `🌍` |
| `🌍` at byte 7000 | chunk 1 = 7000, emoji starts chunk 2 |
| 100KB pure emoji | ~14 chunks; round-trip identical |
| body > total quota (~100KB) | reject per D-08, `errorState: 'OVERSIZED_ITEM'` |

---

### `src/background/registry.ts` (registry CRUD + UUID + tombstones)

**Reference:** RESEARCH §"Recipe 9: Tombstone Semantics"; CONTEXT D-03, D-16, D-17, D-18.

**Identity rule (CONTEXT D-16, D-17):**
- `crypto.randomUUID()` from global `Crypto` — available in MV3 SW since Chrome 92.
- Renames bump `updatedAt`; never the UUID.
- Title-matching is bootstrap-only (Phase 4) — registry.ts in Phase 1 does NOT contain title-match logic.

**Tombstone rule (CONTEXT D-18, RESEARCH lines 698–746):**
- Delete sets `deletedAt = Date.now()`. Registry entry stays.
- Reconstruction excludes `deletedAt >= updatedAt` (D-06: tie → tombstone wins).
- Resurrection rejection: a remote write with older `updatedAt` MUST NOT revive a newer `deletedAt`.

**Required exports (planner discretion on names; suggestions):**
```typescript
export async function getRegistry(): Promise<SyncRegistry>;
export async function createItem(input: { title: string; text: string }): Promise<string /* uuid */>;
export async function updateItem(uuid: string, patch: Partial<{ title: string; text: string }>): Promise<void>;
export async function deleteItem(uuid: string): Promise<void>; // sets deletedAt
export async function applyRemote(remote: SyncRegistry): Promise<void>; // for tombstone-resurrection test
export async function reconstructInstructions(): Promise<Array<{ uuid: string; title: string; text: string }>>;
```

**Test cases (RESEARCH lines 698–746) — required by D-25:**
1. delete creates tombstone with `deletedAt > 0` and `deletedAt >= updatedAt`
2. reconstruct excludes tombstoned records
3. older live `updatedAt` does NOT resurrect a newer `deletedAt`
4. newer live `updatedAt` DOES override an older `deletedAt`
5. tie case (`deletedAt === updatedAt`) — excluded (RESEARCH line 749)

---

### `src/background/hash.ts` (short content hashes)

**Reference:** RESEARCH §"Recipe 6", lines 498–509 (sketch).

**Core pattern:**
```typescript
const encoder = new TextEncoder();

export async function shortHash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  const bytes = new Uint8Array(buf, 0, 8); // first 8 bytes = 16 hex chars
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
```

**Why SHA-256 truncated over FNV-1a (RESEARCH line 509):** `crypto.subtle` is built-in (zero bundle cost), avoids a bespoke hash impl that needs its own tests, async overhead (~µs) is dominated by storage round-trip (~ms). Collision probability for ≤ 512 items ≈ 4 × 10⁻¹⁵.

---

### `src/background/meta-bootstrap.ts` (`sysins:meta` initializer)

**Reference:** RESEARCH §"Recipe 4: Service-Worker `onInstalled` Bootstrap"

**Core pattern (RESEARCH lines 422–437) — copy verbatim:**
```typescript
import { META_KEY, SCHEMA_VERSION } from '../shared/constants';
import type { SyncMeta } from '../shared/types';

export async function initializeMeta(): Promise<void> {
  // D-10: write only if absent. Read first, then conditionally set.
  const existing = await chrome.storage.sync.get(META_KEY);
  if (existing[META_KEY] === undefined) {
    const meta: SyncMeta = {
      schemaVersion: SCHEMA_VERSION,
      lastPushAt: 0,
      lastPullAt: 0,
    };
    await chrome.storage.sync.set({ [META_KEY]: meta });
  }
  // If present, do nothing — schema-guard catches mismatches at next sync entry.
}
```

**Anti-patterns to avoid (RESEARCH lines 444–446):**
- Do NOT unconditionally `set()` the meta — generates noise on every install.
- Do NOT use `chrome.storage.session` for schema version — lost on every SW restart.

---

### `src/background/index.ts` (SW entrypoint — Phase 1 minimal)

**Reference:** RESEARCH §"Recipe 4", lines 408–420.

**Core pattern (Phase 1 ONLY registers `onInstalled`):**
```typescript
import { defineBackground } from 'wxt/utils/define-background';
import { initializeMeta } from './meta-bootstrap';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await initializeMeta();
  });
  // Note: onInstalled fires on install/update only — not every SW wake.
  // Schema-version validation runs at the top of every sync entrypoint.
  // Sync engine, message listeners, alarms — all Phases 2+.
});
```

**Phase boundary discipline:** Phase 1's `index.ts` MUST NOT contain `chrome.runtime.onMessage`, `chrome.storage.onChanged`, `chrome.alarms`, or `chrome.tabs.sendMessage` listeners. Those are Phase 2/3/4 territory. The file is intentionally tiny in Phase 1.

---

### `vitest.config.ts` + test files

**Reference:** RESEARCH §"Recipe 2", lines 270–352.

**Vitest config (RESEARCH lines 270–281):**
```typescript
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom', // RESEARCH §"Recipe 2": required, not jsdom
    globals: false,
  },
});
```

**Test boilerplate pattern (RESEARCH lines 284–301):**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

beforeEach(() => {
  fakeBrowser.reset();
});
```

**SW-restart simulation pattern (RESEARCH lines 311–343) — required for D-25 resume test:**
- Export an `_resetForTesting()` from the SW module to clear in-memory state.
- The test populates `chrome.storage.local` with stale `syncPending`, calls `_resetForTesting()`, calls the init function, asserts the orphaned sentinel was detected and cleared.
- Do NOT use `vi.resetModules()` — it invalidates the `fakeBrowser` polyfill mid-test.

**Test file colocation (OQ-5 / RESEARCH line 804):** Recommended colocated (`src/background/storage-layout.test.ts` next to `storage-layout.ts`). Matches Vitest 4.x default.

---

### `src/dist-04.test.ts` (DIST-04 static-network-call ban)

**Reference:** RESEARCH §"Recipe 8", lines 627–669.

**Core pattern — copy verbatim from RESEARCH:**
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\s*\(/,
  /\bEventSource\s*\(/,
  /\bnavigator\.sendBeacon\b/,
  /\bgoogle-analytics\.com\b/,
  /\bgtag\s*\(/,
  /\bsentry\.io\b/,
  /\bdatadog/i,
  /\bmixpanel/i,
  /\bamplitude/i,
];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|js|svelte|tsx|jsx)$/.test(name) && !name.endsWith('.test.ts')) {
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
        if (pat.test(content)) violations.push(`${file}: ${pat}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
```

**Note:** This test must EXCLUDE itself (the regex pattern strings would otherwise match). The `!name.endsWith('.test.ts')` filter handles it.

---

### `eslint.config.mjs` (DIST-04 layer 1)

**Reference:** RESEARCH §"Recipe 8", lines 602–623.

**Core rules — copy verbatim:**
```javascript
export default [
  {
    files: ['src/**/*.{ts,js,svelte}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'DIST-04: no third-party network calls.' },
        { name: 'XMLHttpRequest', message: 'DIST-04: no third-party network calls.' },
        { name: 'WebSocket', message: 'DIST-04: no third-party network calls.' },
        { name: 'EventSource', message: 'DIST-04: no third-party network calls.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: 'DIST-04.' },
        { object: 'window', property: 'fetch', message: 'DIST-04.' },
      ],
    },
  },
];
```

---

### `tsconfig.json` (TypeScript strict baseline)

**Reference:** RESEARCH §"Recipe 10", lines 759–793.

**Core config:**
```jsonc
{
  "extends": ".wxt/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

**Rationale (RESEARCH lines 778–786):**
- `noUncheckedIndexedAccess` is critical: `chrome.storage.sync.get(META_KEY)[META_KEY]` is typed `SyncMeta | undefined`, enforcing the meta-guard's existence check at compile time.
- `exactOptionalPropertyTypes` makes `errorState?: ErrorState` strict tag-or-omit, preventing accidental `errorState: undefined` writes that look identical to no-error in DevTools.

---

## Shared Patterns (Cross-Cutting)

### Pattern S-1: Storage-tier discipline

**Source:** ARCHITECTURE.md lines 60–69; CLAUDE.md hard rule 6.
**Apply to:** Every Phase 1 file that references storage.

- ALL `chrome.storage.sync` I/O lives in `src/background/`. Phase 1 has no other tier yet, but enforce the constraint structurally so Phase 2+ does not regress.
- Every `chrome.storage.sync` write is a single batched `set({...})`. Per-item write loops are forbidden (CLAUDE.md hard rule 3).
- All sync state is mirrored to `chrome.storage.local` under the `sysins:local:*` prefix (CLAUDE.md hard rule 9). Phase 1 establishes the schema; Phase 2+ writes through it.

### Pattern S-2: `sysins:` namespace discipline

**Source:** CLAUDE.md hard rule 1; CONTEXT D-24.
**Apply to:** Every storage call in every file.

- `chrome.storage.sync` keys: `sysins:meta`, `sysins:registry`, `sysins:body:<uuid>:c<N>`. Nothing else. Ever.
- `chrome.storage.local` keys: `sysins:local:lastPushed`, `sysins:local:syncPending`, `sysins:local:pendingMerges`, `sysins:local:syncStatus`. Nothing else.
- Constants from `src/shared/constants.ts` are the only way to reference these — no inline string literals.

### Pattern S-3: Schema-guard at every sync entrypoint

**Source:** RESEARCH §"Recipe 7"; CONTEXT D-09.
**Apply to:** Every async function in `src/background/` that reads `chrome.storage.sync`.

- Top of function: `const guard = await loadAndAssertMeta(); if (!guard.ok) { await setErrorState(guard.tag, ...); return; }`
- Phase 1 has exactly one such entrypoint candidate (`initializeMeta` itself, which is exempt because it CREATES meta). Phase 2+ multiplies usage; the wrapper is established now.

### Pattern S-4: `_resetForTesting()` testing seam

**Source:** RESEARCH §"Recipe 2", lines 314–316.
**Apply to:** Any module that holds in-memory ephemeral state (`src/background/index.ts` and any future SW module).

- Export `_resetForTesting()` to clear module-level state. Mark `@internal` in JSDoc.
- Tests call it before re-running init to simulate SW kill/wake.

### Pattern S-5: D-08 oversized-item rejection

**Source:** CONTEXT D-08; RESEARCH §"Recipe 1" oversized case.
**Apply to:** `storage-layout.ts` and any caller that writes a body.

- A single instruction whose chunked body exceeds the per-item or total quota is rejected individually.
- Rejection writes a structured error to `chrome.storage.local` under `sysins:local:syncStatus.errorState = 'OVERSIZED_ITEM'`.
- Other items in the same batch still push. No silent truncation.

---

## Out-of-Scope — Explicitly NOT Phase 1

Per CONTEXT.md `<domain>` (lines 6–13) and RESEARCH.md §"Deferred Ideas" (lines 64–73). Listed here so the planner's `read_first` blocks do NOT pull these in:

| File / concern | Phase | Reason |
|---|---|---|
| `src/injected/ls-observer.js` | Phase 2 | MAIN-world injector + `Storage.prototype.setItem` patch is Phase 2 |
| `src/content/content.ts` (full body — beyond an empty stub if WXT requires it) | Phase 2 | Relay logic is Phase 2 |
| `src/popup/*` (all popup files) | Phase 5 | Svelte popup deferred; no popup code in Phase 1 |
| `src/background/sync-engine.ts` | Phases 3–4 | Push/pull merge logic |
| `src/background/throttle.ts` | Phase 3 | Alarm-based debouncer |
| `src/background/bootstrap.ts` | Phase 4 | Bootstrap union merge — may exist as empty stub in Phase 1 (planner discretion per CONTEXT D-22 "Claude's Discretion") |
| Any `chrome.runtime.onMessage` handler | Phase 2+ | Phase 1 SW only registers `onInstalled` |
| Any `chrome.storage.onChanged` handler | Phase 3+ | Pull path is Phase 3+ |
| Any `chrome.alarms` use | Phase 3 | Throttling is Phase 3 |
| Tombstone GC (TTL purge implementation) | Phase 4 → may defer to v1.x | Schema supports it via `deletedAt` field; execution deferred (CONTEXT D-18) |

---

## No-Analog Files (no internal match exists)

ALL Phase 1 files. The repo is greenfield. Each file is a new pattern that later phases will mirror.

| File | RESEARCH section that defines the pattern |
|---|---|
| `wxt.config.ts` | §"Recipe 3" |
| `src/shared/constants.ts` | CONTEXT D-24 |
| `src/shared/types.ts` | CONTEXT D-03/D-12-D-15 + ARCHITECTURE.md lines 142–163 |
| `src/shared/meta-guard.ts` | §"Recipe 7" |
| `src/background/storage-layout.ts` | §"Recipe 1" |
| `src/background/registry.ts` | §"Recipe 9" + CONTEXT D-03/D-16/D-18 |
| `src/background/hash.ts` | §"Recipe 6" |
| `src/background/meta-bootstrap.ts` | §"Recipe 4" |
| `src/background/index.ts` | §"Recipe 4" |
| `vitest.config.ts` | §"Recipe 2" |
| `eslint.config.mjs` | §"Recipe 8" layer 1 |
| `tsconfig.json` | §"Recipe 10" |
| Test files | §"Recipe 2" + §"Recipe 9" + per-module recipe |
| `src/dist-04.test.ts` | §"Recipe 8" layer 2 |

---

## Notes for Planner

1. **`service-worker.ts` is intentionally minimal in Phase 1.** Only `onInstalled` calls `initializeMeta()`. No message listeners, no `onChanged` handler, no alarms. Adding these in Phase 1 would entangle scopes and break the phase boundary. The full sync engine wires up in Phases 2–4.

2. **`read_first` material for downstream tasks (suggested groupings):**
   - **Storage-layout task** → read `src/shared/constants.ts`, RESEARCH §"Recipe 1", CONTEXT D-04/D-05/D-08.
   - **Registry task** → read `src/shared/types.ts` (especially `RegistryRecord`), RESEARCH §"Recipe 9", CONTEXT D-03/D-16/D-18.
   - **Meta-guard + bootstrap task** → read `src/shared/types.ts` (`SyncMeta`), RESEARCH §"Recipe 4" + §"Recipe 7", CONTEXT D-09/D-10/D-11.
   - **Hash task** → read RESEARCH §"Recipe 6" lines 498–509.
   - **SW entrypoint task** → depends on meta-bootstrap; read RESEARCH §"Recipe 4" lines 408–420.
   - **Test harness task** → read RESEARCH §"Recipe 2" + `wxt-dev/examples/vitest-unit-testing` (linked in §Sources).
   - **Tooling task (wxt.config.ts, tsconfig.json, vitest.config.ts, eslint.config.mjs, package.json)** → read RESEARCH §"Recipe 3" + §"Recipe 10" + §"Recipe 8" + STACK.md.

3. **Out-of-Phase-1 confirmed (per CONTEXT `<domain>` block):**
   - `src/popup/*` — Phase 5 only.
   - `src/injected/ls-observer.js` — Phase 2 only.
   - Full `src/content/content.ts` body — Phase 2 only. (An empty stub may exist in Phase 1 if `wxt build` requires it for entrypoint discovery — this is OQ-4 in RESEARCH and gets resolved during Wave 0 by smoke-testing `wxt build` with only `src/background/index.ts` present.)
   - `src/background/sync-engine.ts`, `throttle.ts` — Phases 3+.
   - `src/background/bootstrap.ts` — Phase 4 (Phase 1 planner may write an empty stub, per CONTEXT D-22 Claude's Discretion).

4. **Open Questions for the planner to resolve at plan-check time** (full detail in RESEARCH lines 798–805):
   - **OQ-1**: Add `'PENDING_MERGE_OVERFLOW'` to D-15 enum? — RECOMMEND YES.
   - **OQ-2**: Set `minimum_chrome_version: "116"` in manifest? — RECOMMEND YES.
   - **OQ-3**: Dedicated `'NO_META'` tag vs reusing `'MALFORMED_REMOTE'`? — Either is fine; planner taste.
   - **OQ-4**: Empty stubs for `src/content/`, `src/popup/`, `src/injected/`? — VERIFY via `wxt build` smoke test in Wave 0.
   - **OQ-5**: Test colocation? — RECOMMEND colocated.

5. **Hard rules from CLAUDE.md that bind every Phase 1 plan** (the relevant subset of the 10):
   - Rule 1: Storage namespace `sysins:*` is frozen — Phase 1 establishes it; never write outside.
   - Rule 2: UUID is permanent identity. (Established by `registry.ts`.)
   - Rule 3: Single batched `chrome.storage.sync.set()` per write — no per-item loops.
   - Rule 9: All sync state in `chrome.storage.local` — SW globals are ephemeral. (Schema established by `src/shared/types.ts` and the `sysins:local:*` constants.)
   - Rule 10: Tombstones win on tie (`deletedAt >= updatedAt`). (Established by `registry.ts` reconstruction logic.)

6. **Phase-1 success means later phases inherit a clean, locked, tested foundation.** Every shortcut here is permanent. Treat the storage schema, identity model, and error-state enum as immutable contracts.

---

## Metadata

**Analog search scope:** `.planning/`, `CLAUDE.md` (only files in repo).
**Files scanned:** 2 (CONTEXT.md, RESEARCH.md) + ARCHITECTURE.md.
**Internal analogs found:** 0 (greenfield).
**External analogs cited:** WXT docs (config, manifest, entrypoints, unit-testing), `wxt-dev/examples/vitest-unit-testing`, Chrome Extensions docs (`storage`, `runtime#onInstalled`, MV3 service workers), MDN (`Crypto.randomUUID`, `SubtleCrypto.digest`, `TextEncoder`, `Blob`), ESLint `no-restricted-globals` docs.
**Pattern extraction date:** 2026-05-01.

## PATTERN MAPPING COMPLETE

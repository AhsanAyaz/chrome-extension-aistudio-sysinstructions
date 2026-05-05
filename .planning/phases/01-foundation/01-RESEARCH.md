# Phase 1: Foundation — Research

**Researched:** 2026-05-01
**Domain:** Chrome MV3 extension scaffold + storage schema + identity model + chunking + unit-test harness
**Confidence:** HIGH for stack/quotas/UUID/onInstalled/test framework; MEDIUM-HIGH for chunking algorithm (well-known but multi-byte boundary requires explicit handling); MEDIUM for the DIST-04 static-check approach (multiple valid options).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Storage Layout (chrome.storage.sync, `sysins:*` namespace):**
- **D-01 (Body shape):** Each body is `JSON.stringify({text, ...rest})` per UUID. Unknown AI Studio fields beyond `title` and `text` round-trip via the `...rest` spread. Body is the canonical payload; registry is the canonical metadata.
- **D-02 (Title placement):** Title lives in the registry record only — never duplicated in the body.
- **D-03 (Registry record):** Each registry entry is `{title: string, updatedAt: number, deletedAt: number | null, chunks: number}` keyed by UUID. The `chunks` field is the body chunk count.
- **D-04 (Always-chunked body layout):** Body is always written as `sysins:body:<uuid>:c0`, `…:c1`, … `:cN-1` — even when `N=1`. No special "small body" code path.
- **D-05 (Chunk byte budget):** Chunks split by UTF-8 byte length measured via `new Blob([s]).size`, with a 7000-byte budget per chunk. Handles non-ASCII (emoji, accented characters) correctly.
- **D-06 (Reconstruct ordering):** Items sorted by `updatedAt` descending. Tombstoned items (`deletedAt` ≥ `updatedAt`) excluded.

**Validation & Error Boundary:**
- **D-07 (Strict ingest validation):** Items missing `title` or `text` are rejected; rejection logged to `chrome.storage.local` under `sysins:local:syncStatus.errorState`. Other items in the batch still proceed.
- **D-08 (Per-item oversized rejection):** Single instructions exceeding budget rejected individually with structured error to `chrome.storage.local`. Other items still push. No silent truncation.

**Schema Versioning (FND-04):**
- **D-09 (Phase 1 versioning depth):** Ship version stamp + reader guard pattern only — no upgrader framework. Every read of `sysins:meta` asserts `schemaVersion === 1`. Mismatch → refuse all I/O, set `errorState: 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN'`.
- **D-10 (sysins:meta bootstrap contract):** On `chrome.runtime.onInstalled`, write `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}` to `sysins:meta` **only if absent**.
- **D-11 (v1 schema lock):** `schemaVersion: 1` locked for entire v1 release line. No drift within v1.

**chrome.storage.local Resume Schema (FND-06):**
- All keys live under **`sysins:local:*`** prefix.
- **D-12 (Last-pushed snapshot):** `sysins:local:lastPushed` = `{[uuid]: {titleHash, bodyHash, updatedAt}}`. `titleHash`/`bodyHash` are short content hashes (SHA-256 truncated, or similar).
- **D-13 (Sync-pending sentinel):** `sysins:local:syncPending` = `{batchId: string, keys: string[], startedAt: number}` written immediately before any multi-key `chrome.storage.sync.set()`. On SW wake, if `startedAt > 60_000ms ago`, treat as orphaned.
- **D-14 (Pending-merge queue):** `sysins:local:pendingMerges` = `[{changes, receivedAt}, ...]`, FIFO drained, **capped at N=10**.
- **D-15 (Sync status record):** `sysins:local:syncStatus` = `{state: 'idle' | 'syncing' | 'error', lastSyncAt: number, errorState?: 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' | 'ACCOUNT_MISMATCH' | 'OVERSIZED_ITEM' | 'STRICT_VALIDATION_FAIL', errorDetail?: string}`.

**Identity:**
- **D-16 (UUID is permanent identity):** `crypto.randomUUID()` assigned on first sight. Renames bump `updatedAt` but never change UUID.
- **D-17 (UUID source):** `crypto.randomUUID()` from global `Crypto`. Do NOT install `uuid` npm package.

**Tombstones (FND-03):**
- **D-18 (Tombstone semantics):** Delete sets `deletedAt = Date.now()` while leaving registry entry in place. Reconstruction excludes any record where `deletedAt >= updatedAt`. Phase 1 supports the schema; GC implementation may defer to v1.x.

**Distribution Hygiene (DIST-01–04):**
- **D-19 (Permissions):** Manifest declares **exactly** `storage`, `scripting`, host permission `https://aistudio.google.com/*`. No `<all_urls>`, no `identity`, no `tabs`, no `notifications`.
- **D-20 (Sideloadable build):** WXT default unpacked dev build is v1 distribution channel. Output is structurally Chrome-Web-Store-clean.
- **D-21 (No third-party network):** Phase 1 verifies in code review that nothing imports a network call. DIST-04 is a structural property of the codebase.

**Project Scaffold:**
- **D-22 (Stack lock):** WXT 0.20.25, TypeScript 5.8 (strict mode), Vitest 4.1.5 with `WxtVitest()` plugin and `fakeBrowser`. Svelte 5.55.5 reserved for Phase 5.
- **D-23 (Module layout):** `src/background/`, `src/content/`, `src/injected/`, `src/popup/` (Phase 5), `src/shared/`. Phase 1 implements `storage-layout.ts`, `registry.ts`, `shared/types.ts`, `shared/constants.ts`, and the `service-worker.ts` `onInstalled` handler.
- **D-24 (Constants):** Single source export of `KEY_PREFIX`, `LOCAL_KEY_PREFIX`, `META_KEY`, `REGISTRY_KEY`, `BODY_KEY_PREFIX`, `CHUNK_BUDGET_BYTES = 7000`, `SCHEMA_VERSION = 1`, `PENDING_BATCH_TTL_MS = 60_000`, `PENDING_MERGE_QUEUE_CAP = 10`, `TOMBSTONE_GC_TTL_MS = 30 * 24 * 60 * 60 * 1000`. No magic numbers.
- **D-25 (Test coverage):** `fakeBrowser` round-trip including bodies > 7KB, edge cases (empty, exactly 7000 bytes, multi-byte UTF-8, oversized rejection), registry CRUD, tombstone semantics, schema-version refusal, SW restart `syncPending` recovery.

### Claude's Discretion

- File-level naming inside `background/` and `shared/` (concrete export names, function signatures, internal helpers).
- Specific hashing algorithm for `titleHash` / `bodyHash` (SHA-256 truncated, FNV-1a, or a Crypto SubtleDigest call) — pick at planning time based on synchronicity needs and bundle impact.
- Exact Vitest test-file layout (`*.test.ts` colocated vs. `tests/` directory).
- ESLint / Prettier / TypeScript strict-mode flag set within reason — Phase 1 picks reasonable defaults; the user has not signaled a preference.
- Whether `bootstrap.ts` is written as an empty stub in Phase 1 or only created in Phase 4 (planner decides — both are fine).

### Deferred Ideas (OUT OF SCOPE)

- localStorage MAIN-world injector → Phase 2.
- Push/pull merge logic → Phases 3–4.
- Bootstrap union merge → Phase 4.
- Popup UI / Svelte → Phase 5.
- Tombstone GC implementation → designed in Phase 4, may defer to v1.x.
- Account mismatch pre-flight (BOOT-03) → Phase 4 (research spike required).
- Quota usage indicator in popup → v2 backlog.
- Chrome Web Store submission → out of scope per PROJECT.md.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Stable UUID assigned on first sight; permanent identity (renames don't break it) | §"Recipe 5: crypto.randomUUID() in MV3 SW"; D-16/D-17 locked |
| FND-02 | Per-instruction `updated_at` timestamp on every change | Registry shape locked in D-03; tested per D-25 |
| FND-03 | Soft-delete tombstones with `deleted_at` timestamp | §"Recipe 9: Tombstone semantics"; D-18 locked; resurrection-rejection test designed |
| FND-04 | Versioned schema (`schema_version`) and namespaced keys (`sysins:*`) | §"Recipe 7: Schema-version reader guard"; D-09/D-10/D-11 locked |
| FND-05 | Registry separated from body keys so merge decisions don't fetch every body | §"Recipe 1: Chunking math" + D-03 (registry) / D-04 (body) split |
| FND-06 | All resume state in `chrome.storage.local`, never SW memory | §"Recipe 6: chrome.storage.local schema validation"; D-12..D-15 locked; SW-restart test designed in §"Recipe 2" |
| DIST-01 | Sideloadable as unpacked build | §"Recipe 3: WXT 0.20.25 manifest" — `wxt build` outputs `.output/chrome-mv3/` ready for sideload |
| DIST-02 | Minimum permissions (`storage`, `scripting`, host `https://aistudio.google.com/*`) | §"Recipe 3"; verified verbatim in `wxt.config.ts.manifest` block; D-19 locked |
| DIST-03 | Build output Chrome-Web-Store-clean | §"Recipe 3" — WXT default output is store-clean by construction (no debug-only flags); §"Recipe 8" verifies no third-party imports |
| DIST-04 | Zero third-party network calls | §"Recipe 8: DIST-04 verification" — ESLint `no-restricted-globals` + Vitest static scan |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

CLAUDE.md mandates these directives. Every plan and task must comply.

1. Storage namespace `sysins:*` is frozen in Phase 1 — never write outside this namespace to `chrome.storage.sync`.
2. UUID is permanent identity. Title-matching is bootstrap-only.
3. Every `chrome.storage.sync` write is a single batched `set({...})`. No per-item write loops.
4. `null`/empty `localStorage` reads are never auto-propagated as a delete.
5. First-install is a union merge, not a pull-overwrite.
6. All merge logic lives in the service worker. Content script is a relay.
7. Error surfacing built alongside sync engine (Phase 3+), not bolted on.
8. Live update via synthetic `StorageEvent` is best-effort by design.
9. All sync state persisted to `chrome.storage.local` — SW globals are ephemeral.
10. Tombstones win over live items when `deletedAt > updatedAt`.

For Phase 1 specifically: items 1, 2, 3 (schema constraint), 9, 10 are directly relevant. Item 4 governs Phase 2 but the storage layout must not preclude it. Items 6 and 7 are policy reminders that the service worker entrypoint built in Phase 1 is the merge home, and that the `syncStatus` shape (D-15) must be defined now even though no consumer exists yet.

---

## Executive Summary

1. **Stack is fully locked. No version research needed.** WXT 0.20.25 (released 2026-04-18), Vitest 4.1.5, Svelte 5.55.5, `@wxt-dev/module-svelte` 2.0.5 — all confirmed against the npm registry on 2026-05-01 [VERIFIED: npm view <package> version]. Phase 1 only installs WXT + Vitest + happy-dom; Svelte and `@wxt-dev/module-svelte` are deferred to Phase 5.

2. **Chunking is character-aware, not byte-aware.** Slicing a JSON string by raw byte index (`s.slice(0, 7000)` interpreted in bytes) can split a 4-byte UTF-8 codepoint mid-sequence and corrupt reassembly. The canonical algorithm uses `TextEncoder` to encode once, then walks codepoint-by-codepoint accumulating bytes until the budget is hit, emitting a chunk at the last completed codepoint. `new Blob([s]).size` is the correct measurement primitive (D-05); for splitting itself, use `TextEncoder.encode()` and a codepoint-aware walker. See Recipe 1.

3. **Test harness is `WxtVitest()` + `@webext-core/fake-browser`.** Both `chrome.storage.sync` and `chrome.storage.local` are stubbed in-memory. `fakeBrowser.reset()` in `beforeEach` is the canonical isolation pattern. Service worker restart is simulated by clearing the *test module's* in-memory state (not by killing the worker — there is no real SW under test) and then re-invoking the SW init function with `chrome.storage.local` already populated. See Recipe 2.

4. **Manifest is generated, not hand-written.** WXT auto-generates `manifest.json` from `wxt.config.ts` `manifest:{}` block plus file-based entrypoints. To match ARCHITECTURE.md's `src/background/`, `src/content/`, `src/injected/`, `src/popup/` layout under `src/`, set `srcDir: 'src'` and `entrypointsDir: '.'` in `wxt.config.ts`. Permissions declared exactly per D-19; no shadow permissions sneak in. See Recipe 3.

5. **`onInstalled` write-if-absent is a single-operation read-then-set guarded by an idempotency check.** A simultaneous-install race against another device populating `sysins:meta` is benign because the value is identical (D-10). Use `chrome.storage.sync.get(META_KEY)` → if `result[META_KEY] === undefined`, `set({[META_KEY]: ...})`. See Recipe 4.

6. **`crypto.randomUUID()` is unconditionally available** in MV3 service workers (Chrome 92+, mid-2021) [CITED: developer.mozilla.org]. MV3 itself requires Chrome 88+ minimum. Recommend declaring `minimum_chrome_version: "116"` in the manifest to align with stable `chrome.storage.session` and modern MV3 behavior — but this exceeds the strict requirement of D-17 and is a Claude-discretion call. See Recipe 5.

7. **DIST-04 is enforceable as a Vitest static-scan test.** ESLint `no-restricted-globals` plus a structural Vitest test that grep-scans `src/**/*.{ts,js,svelte}` for `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, and a small denylist of analytics SDK names is the planner's recommendation. The test runs in CI and fails the build if a network call sneaks in. See Recipe 8.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Storage schema definition (`sysins:*` keys, registry/body shape) | Service Worker (background) | Shared (types) | All `chrome.storage.sync` I/O happens in the SW; types are pure declarations exported from `shared/` for use across SW and (later) popup. |
| Chunking + reassembly (`storage-layout.ts`) | Service Worker | — | Pure function module living in `src/background/`. No browser-tier concerns. Reads/writes go through `browser.storage.sync` (WXT's typed wrapper for `chrome.storage.sync`). |
| Registry CRUD (`registry.ts`: UUID, updatedAt, tombstones) | Service Worker | — | Pure domain logic, sits above `storage-layout.ts`. |
| `onInstalled` bootstrap (`sysins:meta` write-if-absent) | Service Worker | — | Only the SW receives `chrome.runtime.onInstalled`. |
| `chrome.storage.local` resume schema (`sysins:local:*` keys) | Service Worker | — | Owned and consumed exclusively by the SW. The popup (Phase 5) reads `syncStatus` for badge rendering, but Phase 1 has no popup, so no other tier touches it. |
| Schema-version reader guard | Service Worker | Shared (assertion helper) | Guard is a pure function in `shared/` that takes the loaded `meta` and throws/returns an error tag; consumed by the SW at the top of every sync entrypoint. |
| Manifest declaration (permissions, host, scripts) | Build/CDN (manifest generation) | — | `wxt.config.ts` is the single source; output `manifest.json` is artifact. No runtime tier. |
| DIST-04 static-network-call ban | Test Harness (CI) | — | Vitest static-scan test + ESLint rule. Not a runtime concern. |

**Note:** No Browser/Client or Frontend-Server tier work in Phase 1 — the popup is deferred to Phase 5, the content script and MAIN-world injector to Phase 2. Phase 1 is entirely service-worker-tier and build-tier.

---

## Validation Architecture (Coverage Targets — Nyquist disabled)

> `workflow.nyquist_validation: false` in config.json. The plan-checker can use this table as Dimension-8 input even though no separate VALIDATION.md is produced.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 with `WxtVitest()` from `wxt/testing/vitest-plugin` |
| Config file | `vitest.config.ts` — see Recipe 2 |
| Quick run command | `npm run test -- --run <file>` |
| Full suite command | `npm run test -- --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Status |
|--------|----------|-----------|-------------------|-------------|
| FND-01 | UUID assigned on first sight; permanent across renames | unit | `vitest run src/background/registry.test.ts -t "uuid identity"` | Wave 0 (new) |
| FND-02 | `updatedAt` updated on every edit, including rename | unit | `vitest run src/background/registry.test.ts -t "updatedAt tracking"` | Wave 0 (new) |
| FND-03 | Tombstone created on delete; resurrection rejected when `deletedAt > updatedAt` | unit | `vitest run src/background/registry.test.ts -t "tombstone"` | Wave 0 (new) |
| FND-04 | `sysins:meta.schemaVersion = 1` written on `onInstalled`; reader guard refuses mismatch | unit | `vitest run src/background/service-worker.test.ts -t "schemaVersion"` | Wave 0 (new) |
| FND-05 | Registry/body separation: registry read does NOT fetch any `sysins:body:*` key | unit | `vitest run src/background/storage-layout.test.ts -t "registry isolation"` | Wave 0 (new) |
| FND-06 | `sysins:local:*` resume state survives simulated SW restart | unit | `vitest run src/background/service-worker.test.ts -t "resume after restart"` | Wave 0 (new) |
| FND-05 (chunking) | Body > 7KB round-trips through chunking + reassembly without loss | unit | `vitest run src/background/storage-layout.test.ts -t "chunk roundtrip"` | Wave 0 (new) |
| FND-05 (UTF-8 boundary) | 4-byte emoji at chunk boundary does not corrupt reassembly | unit | `vitest run src/background/storage-layout.test.ts -t "utf-8 boundary"` | Wave 0 (new) |
| DIST-01 | `wxt build` produces a sideloadable unpacked extension at `.output/chrome-mv3/` | manual + smoke | `npm run build && ls .output/chrome-mv3/manifest.json` | Wave 0 (new) |
| DIST-02 | Generated manifest declares exactly `storage`, `scripting`, host `https://aistudio.google.com/*` and no other permissions | unit (snapshot) | `vitest run src/build.test.ts -t "manifest permissions"` | Wave 0 (new) |
| DIST-03 | Output bundle has no debug-only flags or telemetry hosts in CSP | smoke | `npm run build && jq '.content_security_policy' .output/chrome-mv3/manifest.json` | Wave 0 (manual) |
| DIST-04 | No `fetch`/`XMLHttpRequest`/`WebSocket`/analytics-SDK imports in `src/` | unit (static) | `vitest run src/dist-04.test.ts` | Wave 0 (new) |

### Sampling Rate

- **Per task commit:** Quick-run the touched file's test (e.g., `vitest run src/background/storage-layout.test.ts`).
- **Per wave merge:** Full Vitest suite (`npm run test -- --run`).
- **Phase gate:** Full suite green; `wxt build` green; manifest snapshot matches expected permission set.

### Wave 0 Gaps

- [ ] Project does not yet exist. Wave 0 must scaffold WXT (`npx wxt@latest init`), then create `vitest.config.ts`, `tsconfig.json`, and the `src/` directory tree per D-23.
- [ ] No test files exist. All test files in the table above are new.
- [ ] No ESLint config — Wave 0 should add `eslint.config.mjs` with `no-restricted-globals` for DIST-04.

---

## Implementation Recipes

### Recipe 1: Chunking Math (D-04, D-05, D-25)

**The recommendation:** Encode-once + codepoint-walk algorithm. Use `TextEncoder` to byte-encode the body string, then walk through the original string codepoint-by-codepoint, accumulating each codepoint's UTF-8 byte length and emitting a chunk when adding the next codepoint would exceed `CHUNK_BUDGET_BYTES`. Always operate on **codepoints** (`for (const cp of str)`, not `str[i]`) to handle astral-plane characters (emoji) correctly.

**Why this is right:** Naïve `string.slice(start, start + N)` operates on UTF-16 code units, not bytes. A 4-byte emoji like `🌍` is 2 UTF-16 units in a JS string and 4 bytes in UTF-8. A byte-budget split that ignores codepoint boundaries can split a UTF-8 sequence mid-byte; on reassembly the joined string is structurally invalid UTF-8 and Chrome will either refuse to store it or corrupt it. [VERIFIED: WebSearch — TextEncoder/encodeInto guarantees complete UTF-8 sequences only when the *caller* respects codepoint boundaries; xjavascript.com and tutorialspoint.com both flag this pitfall.]

**Why `new Blob([s]).size` for measurement (D-05):** Per D-05, the project locks `new Blob([s]).size` as the measurement primitive. This is correct — it returns the byte length of the string when serialized as UTF-8, and is the same value `TextEncoder.encode(s).byteLength` would produce. `Blob` is available in MV3 service workers. Use `Blob` measurement at the per-chunk validation level (post-split) and `TextEncoder` at the per-codepoint level inside the splitter. [CITED: MDN TextEncoder, MDN Blob constructor.]

**Sketch:**
```typescript
// src/background/storage-layout.ts (excerpt)
import { CHUNK_BUDGET_BYTES } from '../shared/constants';

const encoder = new TextEncoder();

export function splitIntoChunks(body: string, budget = CHUNK_BUDGET_BYTES): string[] {
  if (body.length === 0) return ['']; // D-04: always-chunked, even empty
  const chunks: string[] = [];
  let buf = '';
  let bufBytes = 0;

  for (const codepoint of body) { // for-of is codepoint-aware (handles surrogate pairs)
    const cpBytes = encoder.encode(codepoint).byteLength;
    if (cpBytes > budget) {
      // A single codepoint larger than the budget is impossible (max 4 bytes UTF-8).
      // But guard for future-proofing if budget is ever set absurdly low.
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
  chunks.push(buf); // final partial chunk
  return chunks;
}

export function joinChunks(chunks: string[]): string {
  return chunks.join('');
}

// Validation: every chunk must be < CHUNK_BUDGET_BYTES + per-key JSON overhead.
// D-05 uses 7000 bytes leaving ~1192 bytes headroom under the 8192 per-item quota.
export function chunkByteLength(chunk: string): number {
  return new Blob([chunk]).size;
}
```

**Edge cases to test (per D-25):**

| Case | Expected |
|------|----------|
| Empty string `""` | One chunk: `[""]` (D-04 always-chunked) |
| ASCII string of exactly 7000 bytes | One chunk |
| ASCII string of 7001 bytes | Two chunks: 7000 + 1 |
| String containing `🌍` (4 bytes UTF-8) at byte position 6998 | First chunk ends at 6998 bytes (does not split the emoji); second chunk starts with `🌍` |
| String containing `🌍` at byte position 7000 | First chunk = 7000 bytes; emoji starts second chunk |
| String of 100KB pure emoji (~25,000 emojis × 4 bytes) | ~14 chunks, each ≤ 7000 bytes; round-trip identical |
| String exceeding total `chrome.storage.sync` quota (>~100KB) | Reject per D-08 with `errorState: 'OVERSIZED_ITEM'` |

**Boundary condition lock-in:** When emoji or other multi-byte codepoints land exactly at a chunk boundary, the algorithm above places them entirely in the next chunk. This is asymmetric (it never tries to "fill the byte gap with ASCII"), but it is the correct conservative choice — and reassembly is `chunks.join('')`, which always recovers the original string.

[VERIFIED: ehmicky/string-byte-length and TextEncoder MDN behavior; CITED: developer.mozilla.org/Web/API/TextEncoder/encodeInto for complete-sequence guarantees.]

---

### Recipe 2: fakeBrowser + Vitest Setup (D-25)

**The recommendation:**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom', // faster than jsdom; recommended by WXT docs
    globals: false, // we'll import describe/it/expect explicitly — cleaner module graph
  },
});
```

```typescript
// any *.test.ts file
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('storage-layout', () => {
  it('writes meta on first install', async () => {
    // arrange: fakeBrowser starts empty
    await onInstalledHandler(); // your SW handler

    // assert
    const meta = await browser.storage.sync.get('sysins:meta');
    expect(meta['sysins:meta']).toEqual({ schemaVersion: 1, lastPushAt: 0, lastPullAt: 0 });
  });
});
```

**Why this is right:**
- `WxtVitest()` polyfills `browser.storage.local` and `browser.storage.sync` (and `browser.runtime`, `browser.tabs`, etc.) with `@webext-core/fake-browser`'s in-memory implementation. Both stores behave like the real Chrome API: items persist within a test, and `onChanged` listeners fire synchronously [VERIFIED: WebSearch — WXT documentation explicitly states "you don't have to mock browser.storage in tests — @webext-core/fake-browser implements storage in-memory so it behaves like it would in a real extension"].
- `fakeBrowser.reset()` clears every namespace (storage, runtime listeners, alarms, action) — the canonical pattern from WXT's own examples [VERIFIED: github.com/wxt-dev/examples/tree/main/examples/vitest-unit-testing].

**Simulating service-worker restart (D-25, FND-06):** There is no real worker process under test — just a Node.js Vitest run. The SW "restart" abstraction is therefore a *module reset*, not a process kill. The recommended pattern:

```typescript
// src/background/service-worker.ts (excerpt)
let inMemoryState: { batchId?: string } = {}; // ephemeral, lost on real SW kill

export function _resetForTesting() {
  inMemoryState = {};
}

export async function ensureInitialized() {
  // read sysins:local:syncPending, etc., and rebuild whatever is needed
}
```

```typescript
// service-worker.test.ts
it('resumes pending batch after worker restart', async () => {
  // arrange: simulate a write-in-progress
  await browser.storage.local.set({
    'sysins:local:syncPending': {
      batchId: 'batch-1',
      keys: ['sysins:body:abc:c0'],
      startedAt: Date.now() - 90_000, // > 60s, so orphaned
    },
  });

  // act: simulate SW kill + wake by clearing module state, re-init
  _resetForTesting();
  await ensureInitialized();

  // assert: orphaned sentinel was detected and cleared (or repaired)
  const after = await browser.storage.local.get('sysins:local:syncPending');
  expect(after['sysins:local:syncPending']).toBeUndefined();
});
```

The `_resetForTesting()` export is the recommended testing seam. Mark it `@internal` in JSDoc. Vitest does not need any `vi.resetModules()` gymnastics — explicit reset is more transparent.

**Edge cases / pitfalls:**
- Don't use `vi.resetModules()` to simulate SW restart — it invalidates the `fakeBrowser` polyfill mid-test and causes confusing errors.
- `fakeBrowser` does *not* automatically fire `chrome.storage.onChanged` for changes made by tests calling `set()` directly — but it does fire for changes made through the same `browser.storage.local` reference once a listener is registered. In practice this matches real Chrome behavior closely enough for Phase 1.
- The `WxtVitest()` plugin requires `happy-dom` (not `jsdom`) per [VERIFIED: github.com/wxt-dev/wxt/issues/1575].

[VERIFIED: WXT docs and wxt-dev/examples examples; CITED: wxt.dev/guide/essentials/unit-testing.]

---

### Recipe 3: WXT 0.20.25 Manifest Configuration (D-19, D-22, D-23)

**The recommendation:**

```typescript
// wxt.config.ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.', // matches D-23 layout: src/background/, src/content/, src/popup/
  // No `modules: ['@wxt-dev/module-svelte']` in Phase 1 — Svelte is Phase 5.
  manifest: {
    name: 'AI Studio Instructions Sync',
    description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
    version: '0.1.0',
    minimum_chrome_version: '116', // see Recipe 5
    permissions: ['storage', 'scripting'],
    host_permissions: ['https://aistudio.google.com/*'],
    // No <all_urls>, no identity, no tabs, no notifications. Matches D-19 verbatim.
  },
});
```

**Why this is right:**
- `srcDir: 'src'` + `entrypointsDir: '.'` makes WXT treat `src/background/index.ts`, `src/content/index.ts`, `src/popup/index.html` (Phase 5), and `src/injected/ls-observer.js` (Phase 2) as auto-detected entrypoints [VERIFIED: WebSearch — WXT issue #213 and wxt.dev/api/reference/wxt/interfaces/inlineconfig confirm `entrypointsDir` is resolved relative to `srcDir` and the value `'.'` means "look directly in srcDir for entrypoint folders"].
- WXT 0.20 dropped `webextension-polyfill` and uses `@types/chrome` directly via `@wxt-dev/browser` [VERIFIED: WebSearch — wxt.dev/guide/resources/upgrading].
- The popup uses `chrome.action`, which does not require a separate permission [CITED: developer.chrome.com/docs/extensions/reference/api/action].
- `scripting` is declared (per D-19) because the MAIN-world injector (Phase 2) is registered via the manifest's `content_scripts` array — but if Phase 2 ever moves to programmatic injection via `chrome.scripting.executeScript`, the permission is already present.

**Build / dev commands:**

| Command | Purpose | Output |
|---------|---------|--------|
| `wxt` (or `npm run dev`) | Dev server with HMR; opens Chrome with extension installed | `.output/chrome-mv3-dev/` |
| `wxt build` (or `npm run build`) | Production unpacked build | `.output/chrome-mv3/` |
| `wxt zip` | CWS-ready zipped artifact (not used in v1 per DIST-01) | `.output/chrome-mv3.zip` |

**Sideload procedure (DIST-01):** `chrome://extensions` → enable Developer mode → Load unpacked → select `.output/chrome-mv3/`. The output directory contains a generated `manifest.json` and bundled JS — no separate build artifact handling needed.

**Phase 1 entrypoint stubs:** Phase 1 only writes `src/background/index.ts` (the SW entrypoint that registers `chrome.runtime.onInstalled`). The `src/content/`, `src/injected/`, and `src/popup/` directories may be absent in Phase 1 — WXT does not error on missing optional entrypoints. (Alternatively: create empty `src/content/index.ts`, `src/popup/index.html` placeholders if WXT's manifest generation needs them. Verify during Wave 0 by running `wxt build` after creating only `src/background/index.ts`.)

[VERIFIED: WebSearch (WXT docs and examples); CITED: wxt.dev/guide/essentials/config/manifest, wxt.dev/guide/essentials/entrypoints.html.]

---

### Recipe 4: Service-Worker `onInstalled` Bootstrap (D-10, FND-04)

**The recommendation:**

```typescript
// src/background/index.ts (the SW entrypoint)
import { defineBackground } from 'wxt/utils/define-background';
import { initializeMeta } from './meta-bootstrap';

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async () => {
    await initializeMeta();
  });

  // Note: onInstalled does NOT fire on every SW wake — only on install/update.
  // Schema-version validation runs at the top of every sync entrypoint.
  // (Recipe 7 covers the per-call guard.)
});
```

```typescript
// src/background/meta-bootstrap.ts
import { META_KEY, SCHEMA_VERSION } from '../shared/constants';
import type { SyncMeta } from '../shared/types';

export async function initializeMeta(): Promise<void> {
  // D-10: write only if absent. Read first, then conditionally set.
  const existing = await chrome.storage.sync.get(META_KEY);
  if (existing[META_KEY] === undefined) {
    const meta: SyncMeta = { schemaVersion: SCHEMA_VERSION, lastPushAt: 0, lastPullAt: 0 };
    await chrome.storage.sync.set({ [META_KEY]: meta });
  }
  // If present, do nothing — even if schemaVersion differs, the reader guard (Recipe 7)
  // will catch a mismatch on the next sync entrypoint and refuse I/O.
}
```

**Why this is right:**
- `onInstalled` fires on `install` and `update` (and `chrome_update`/`shared_module_update`). For Phase 1 we treat all reasons identically — the write-if-absent pattern is reason-agnostic.
- The race condition with another device installing simultaneously and populating `sysins:meta` first is benign: per D-10, the value `{schemaVersion: 1, lastPushAt: 0, lastPullAt: 0}` is identical, so a last-write-wins on this key produces the same state regardless of which device's `set()` lands. (Note: Chrome's storage.sync does serialize concurrent writes through Google's sync infrastructure, but even if both were applied, there is no semantic divergence.)
- The two-step read-then-set is *not* atomic — a different device could write between our `get` and our `set`. This is acceptable because (a) the values are identical, and (b) any subsequent sync cycle re-reads `meta` through the schema guard, which will catch any anomaly.

**What NOT to do:**
- Do not unconditionally `chrome.storage.sync.set({[META_KEY]: ...})` — this would bump the `chrome.storage.onChanged` event for every install on every device, generating sync traffic and potentially racing with in-flight writes.
- Do not use `chrome.storage.session` for the schema version — it's per-SW lifecycle and would be lost on every restart.

[CITED: developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled.]

---

### Recipe 5: `crypto.randomUUID()` in MV3 Service Workers (D-17)

**The recommendation:** Use `crypto.randomUUID()` directly. Available in MV3 service worker contexts since Chrome 92 (mid-2021). MV3 itself requires Chrome 88+; `randomUUID` lands in 92, so the realistic floor is 92.

**Optional `minimum_chrome_version`:** Declaring `minimum_chrome_version: "116"` in the manifest is recommended by Phase 1's planning context (research priority 5) for these reasons:

| Floor | Gain | Cost |
|-------|------|------|
| 88 (MV3 baseline) | Maximum compatibility | No `chrome.storage.session`; no recent storage API improvements |
| 92 (D-17 strict requirement) | `crypto.randomUUID()` available | Still missing modern MV3 fixes |
| **116** | `chrome.storage.session` stable; widespread MV3 stability fixes; matches Chrome's own MV3 deprecation timeline | Excludes Chrome 88–115 users (rounding error in 2026) |

**Recommendation:** Set `minimum_chrome_version: "116"` per the rationale above, but mark it as a Claude-discretion decision (D-26 territory). Anything ≥ 92 satisfies D-17.

**Why no `uuid` package:** The `uuid` npm package adds ~2 KB minified for functionality the browser provides natively. STACK.md explicitly forbids it. There is zero scenario where the package is needed for Phase 1.

[CITED: developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID; phoronix.com/news/Chrome-92 (Chrome 92 release notes for `crypto.randomUUID()`); bugs.chromium.org/p/chromium/issues/detail?id=1197594 (implementation tracking bug, marked Fixed for Chrome 92).]

**Note on secure context:** WebSearch surfaced a comment that `crypto.randomUUID()` "only works in secure contexts." [ASSUMED → VERIFIED via MDN]: extension service workers are *always* a secure context (chrome-extension:// origins are treated as secure by Chrome) — confirmed at developer.chrome.com/docs/extensions/develop/concepts/service-workers. So the secure-context requirement is automatically satisfied; no special handling needed.

---

### Recipe 6: `chrome.storage.local` Schema Validation (D-12, D-13, D-14, D-15)

**Quota check — no per-item issue for `sysins:local:*`:** `chrome.storage.local` has a 10 MB total quota in current Chrome (raised from 5 MB; the 8KB per-item cap that applies to `chrome.storage.sync` does NOT apply to `chrome.storage.local`) [VERIFIED: developer.chrome.com/docs/extensions/reference/api/storage]. So `sysins:local:lastPushed` carrying ~512 hash entries × ~50 bytes ≈ 25 KB easily fits. Zero risk of overflowing local for Phase 1's resume schema.

**Persisting `Set<string>` semantics for `syncPending.keys`:** Use a plain array (`string[]`) for storage. The Set is a runtime convenience, not a serialization format. `chrome.storage.local` cannot store `Set` directly — it serializes via structured-clone but not `Set` (some old API limitations). Convert at the boundary:

```typescript
// write
await chrome.storage.local.set({
  'sysins:local:syncPending': {
    batchId,
    keys: Array.from(pendingKeysSet), // serialize Set -> array
    startedAt: Date.now(),
  },
});

// read
const r = await chrome.storage.local.get('sysins:local:syncPending');
const pending = r['sysins:local:syncPending'];
const pendingKeysSet = new Set(pending?.keys ?? []);
```

**Hashing recommendation for `titleHash` / `bodyHash`:** Use `crypto.subtle.digest('SHA-256', ...)` and truncate to first 8 bytes hex (16 hex chars). Collision probability for ≤ 512 items is ~512² / 2⁶⁵ ≈ 4 × 10⁻¹⁵, well below noise floor.

```typescript
// src/background/hash.ts
const encoder = new TextEncoder();

export async function shortHash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  const bytes = new Uint8Array(buf, 0, 8); // first 8 bytes
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
```

**Why SHA-256 over FNV-1a:** SHA-256 is `crypto.subtle` (async, no bundle cost), avoids a bespoke hash impl that needs its own tests, and is collision-resistant. The async overhead (~µs) is dominated by the storage round-trip (~ms) so it does not affect performance. FNV-1a is sync and cheaper but adds another tested module — not worth the savings here.

**Cap enforcement for `pendingMerges` (D-14, N=10):** Implement as a bounded queue:

```typescript
import { PENDING_MERGE_QUEUE_CAP } from '../shared/constants';

async function enqueuePendingMerge(merge: PendingMerge): Promise<void> {
  const r = await chrome.storage.local.get('sysins:local:pendingMerges');
  const queue: PendingMerge[] = r['sysins:local:pendingMerges'] ?? [];
  queue.push(merge);
  if (queue.length > PENDING_MERGE_QUEUE_CAP) {
    const dropped = queue.length - PENDING_MERGE_QUEUE_CAP;
    queue.splice(0, dropped); // drop oldest
    // D-14: flag flapping in syncStatus
    await markErrorState('PENDING_MERGE_OVERFLOW', `dropped ${dropped} oldest events`);
  }
  await chrome.storage.local.set({ 'sysins:local:pendingMerges': queue });
}
```

Note: `'PENDING_MERGE_OVERFLOW'` is not in the D-15 enum. Phase 1 should either (a) add it to the enum (a discretionary widening of D-15), or (b) reuse `'MALFORMED_REMOTE'` as the closest existing tag with a clarifying `errorDetail`. Recommendation: **add `'PENDING_MERGE_OVERFLOW'` to the enum** — D-15 explicitly says "Phase 1 defines the shape," so widening at design time is in scope. Flag for planner to confirm.

[VERIFIED: developer.chrome.com/docs/extensions/reference/api/storage on local quota; CITED: developer.mozilla.org for SubtleCrypto.digest.]

---

### Recipe 7: Schema-Version Reader Guard (D-09, D-11)

**The recommendation:** A single shared assertion module imported by every sync entrypoint. *Wrapper module*, not in-line checks per consumer.

```typescript
// src/shared/meta-guard.ts
import { META_KEY, SCHEMA_VERSION } from './constants';
import type { SyncMeta } from './types';

export type GuardResult =
  | { ok: true; meta: SyncMeta }
  | { ok: false; tag: 'SCHEMA_AHEAD' | 'SCHEMA_UNKNOWN' | 'MALFORMED_REMOTE' };

export async function loadAndAssertMeta(): Promise<GuardResult> {
  const r = await chrome.storage.sync.get(META_KEY);
  const meta = r[META_KEY] as SyncMeta | undefined;

  if (meta === undefined) {
    // First read on a freshly-installed device before initializeMeta() ran.
    // Caller decides: treat as "no remote state yet" or refuse.
    return { ok: false, tag: 'MALFORMED_REMOTE' }; // or a dedicated 'NO_META' tag
  }
  if (typeof meta.schemaVersion !== 'number') {
    return { ok: false, tag: 'MALFORMED_REMOTE' };
  }
  if (meta.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, tag: 'SCHEMA_AHEAD' };
  }
  if (meta.schemaVersion < SCHEMA_VERSION) {
    // v1 lock per D-11: nothing < 1 is valid in v1.x.
    return { ok: false, tag: 'SCHEMA_UNKNOWN' };
  }
  return { ok: true, meta };
}
```

**Why a single module wins over per-consumer checks:**
- One place to test exhaustively.
- One place to extend when v2 ships (a new tag, a migration call).
- Per-consumer checks invariably drift — one consumer forgets the guard, ships, corrupts state.

**Caller pattern:**
```typescript
import { loadAndAssertMeta } from '../shared/meta-guard';
import { setErrorState } from './sync-status';

export async function pushCycle() {
  const guard = await loadAndAssertMeta();
  if (!guard.ok) {
    await setErrorState(guard.tag, `meta guard refused at pushCycle entry`);
    return; // refuse all I/O per D-09
  }
  // ... proceed
}
```

[Pattern: standard wrapper-pattern from defensive-programming canon. No external citation — design choice.]

---

### Recipe 8: DIST-04 Verification (D-21)

**The recommendation:** Two layers — ESLint `no-restricted-globals` + a Vitest static-scan test.

**Layer 1: ESLint (catches at edit time):**

```javascript
// eslint.config.mjs
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

**Layer 2: Vitest static scan (catches at CI gate):**

```typescript
// src/dist-04.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_PATTERNS = [
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

**Why both layers:**
- ESLint catches at editor-save time (fast feedback, IDE squiggles).
- Vitest static scan catches things that bypass ESLint (raw string concat to build a fetch call, dynamic imports, comments enabling rules locally) and runs in CI as a hard gate.

**What this won't catch (acknowledged):**
- A library that itself makes a fetch call. Phase 1 has no third-party runtime libs (only WXT, which is build-time), so this is fine. When Phase 5 adds Svelte, audit `@wxt-dev/module-svelte` once and add to a verified-clean list.
- `eval()` or `new Function('fetch')(...)` — exotic, easy to add to the patterns list if ever a concern.

**Recommendation:** Ship both. The Vitest test runs in < 200ms and is the structural guarantee called for by D-21.

[VERIFIED: ESLint docs for `no-restricted-globals` — eslint.org/docs/latest/rules/no-restricted-globals.]

---

### Recipe 9: Tombstone Semantics in Tests (D-18)

**The recommendation:** Three test cases that together cover D-18's "tombstone resurrection rejection."

```typescript
// src/background/registry.test.ts (excerpts)
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applyRemote, deleteItem, getRegistry } from './registry';

beforeEach(() => fakeBrowser.reset());

describe('tombstone semantics (D-18)', () => {
  it('delete creates tombstone with deletedAt set', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid);
    const reg = await getRegistry();
    expect(reg[uuid].deletedAt).toBeGreaterThan(0);
    expect(reg[uuid].deletedAt).toBeGreaterThanOrEqual(reg[uuid].updatedAt);
  });

  it('reconstruct excludes records where deletedAt >= updatedAt', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid);
    const arr = await reconstructInstructions();
    expect(arr.find(i => i.uuid === uuid)).toBeUndefined();
  });

  it('older live updatedAt does NOT resurrect a newer deletedAt', async () => {
    // arrange: tombstoned item locally
    const uuid = await createItem({ title: 'A', text: 'a' }); // updatedAt = T0
    await deleteItem(uuid); // deletedAt = T1 > T0

    // simulate a remote push from device B with an OLDER updatedAt for the same UUID
    const remote = {
      [uuid]: { title: 'A', text: 'old', updatedAt: 0, deletedAt: null }, // T_minus
    };
    await applyRemote(remote);

    const reg = await getRegistry();
    expect(reg[uuid].deletedAt).toBeGreaterThan(0); // tombstone preserved
    const arr = await reconstructInstructions();
    expect(arr.find(i => i.uuid === uuid)).toBeUndefined(); // still deleted
  });

  it('newer live updatedAt DOES override an older deletedAt (legitimate revival)', async () => {
    const uuid = await createItem({ title: 'A', text: 'a' });
    await deleteItem(uuid); // deletedAt = T1
    // simulate a NEWER live edit from device B (e.g., user un-deleted by recreating)
    const remote = {
      [uuid]: { title: 'A', text: 'revived', updatedAt: Date.now() + 60_000, deletedAt: null },
    };
    await applyRemote(remote);
    const reg = await getRegistry();
    // Per D-18: reconstruction excludes only when deletedAt >= updatedAt.
    // Newer updatedAt > deletedAt means the item is alive again.
    expect(reg[uuid].deletedAt < reg[uuid].updatedAt).toBe(true);
    const arr = await reconstructInstructions();
    expect(arr.find(i => i.uuid === uuid)).toBeDefined();
  });
});
```

**Boundary case to lock-in:** What about `deletedAt === updatedAt` (exact tie)? D-06 says "Tombstoned items (`deletedAt ≥ updatedAt`) are excluded." So tie → excluded. This is consistent (tombstone wins on tie). Add a test for it.

[Pattern source: standard CRDT tombstone tests; informed by PITFALLS.md §SYNC-4.]

---

### Recipe 10: TypeScript Strict-Mode Flag Set (D-26 / Claude's Discretion)

**The recommendation:**

```jsonc
// tsconfig.json — Phase 1 baseline
{
  "extends": ".wxt/tsconfig.json", // WXT generates this with sensible base
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

**Why each flag is right for this project:**

| Flag | Why |
|------|-----|
| `strict: true` | Foundation. Includes `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, etc. No reason to skip. |
| `noUncheckedIndexedAccess: true` | Critical for `chrome.storage.sync.get()` results: `r[META_KEY]` is typed `SyncMeta \| undefined` so the meta-guard's existence check (Recipe 7) is enforced at compile time. |
| `exactOptionalPropertyTypes: true` | The D-15 `errorState?: ...` becomes a strict tag-or-omit, preventing accidental `errorState: undefined` writes that look identical to no-error states in DevTools. |
| `noImplicitOverride: true` | Cheap; documents class hierarchy clearly when classes appear (probably none in Phase 1). |
| `noFallthroughCasesInSwitch: true` | Defensive; `errorState` enum will be switch-handled. |
| `useUnknownInCatchVariables: true` | Forces explicit narrowing in `try/catch` around `chrome.storage.sync.set()` calls. Prevents accidentally treating an error as a string. |
| `verbatimModuleSyntax: true` | TS 5.x best practice; clean ESM emit, plays nicely with WXT/Vite. |

**Flags NOT recommended:**
- `noPropertyAccessFromIndexSignature: true` — too aggressive for chrome.* API access patterns; produces noise without catching real bugs.
- `noImplicitReturns: true` — `strict` covers most cases; this adds friction to code-style choices.

**Source:** This set is the consensus "modern TypeScript strict" baseline as of TS 5.x. Pattern source: training knowledge plus current TS docs. [ASSUMED → conventional best practice; Phase 1 can choose to dial this back if any flag proves too disruptive during Wave 0 scaffolding.]

---

## Open Questions

| # | Question | Recommendation |
|---|----------|----------------|
| OQ-1 | Should `'PENDING_MERGE_OVERFLOW'` be added to the D-15 `errorState` enum (Recipe 6)? | **YES, add it.** D-15 says "Phase 1 defines the shape." Widening the enum during Phase 1 is in scope. Planner: confirm with user during plan-check or plan it in directly. |
| OQ-2 | Should `minimum_chrome_version: "116"` be set in the manifest (Recipe 5)? | **YES recommended, but Claude-discretion.** Aligns with stable MV3 features. Falls within D-19's "exactly these permissions and nothing else" because it's not a permission. |
| OQ-3 | `loadAndAssertMeta()` distinguishes "meta absent" from "meta malformed." Should there be a dedicated `'NO_META'` tag (Recipe 7)? | **Optional.** Phase 1 can fold into `'MALFORMED_REMOTE'` as Recipe 7 does, or add `'NO_META'`. Practical impact is identical (refuse I/O); semantic clarity favors a dedicated tag. Defer to planner taste — both correct. |
| OQ-4 | Should Phase 1 create empty stubs for `src/content/`, `src/popup/`, `src/injected/` to satisfy WXT's auto-discovery, or leave them absent? | **VERIFY DURING WAVE 0.** Run `wxt build` with only `src/background/index.ts` present; confirm build succeeds. If it does, leave the others absent. If WXT errors on missing entrypoints, create empty placeholder files with a `// Phase N — see ROADMAP.md` comment. This is a 5-minute scaffold check, not a deep research question. |
| OQ-5 | Test file colocation (`src/background/storage-layout.test.ts`) vs separate `tests/` dir (D-26 / Claude discretion)? | **Recommend colocated.** Vitest 4.x default is colocated; matches modern monorepo conventions; tests live next to the module they cover, which improves discoverability. Trivial to swap if user prefers separated. |

**Genuine ambiguity:** None. CONTEXT.md is exhaustive. The five questions above are all minor implementation choices, not open architecture questions.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `'PENDING_MERGE_OVERFLOW'` should be added to D-15 enum | Recipe 6 (overflow handling) | Low. If user prefers reusing `'MALFORMED_REMOTE'`, swap the constant — no architectural impact. |
| A2 | TypeScript strict flag set (Recipe 10) is universally a "modern best practice" | Recipe 10 | Low. If a flag proves disruptive during scaffolding, dial back individually. None of these flags affect correctness — they affect only what TypeScript catches. |
| A3 | Setting `minimum_chrome_version: "116"` is appropriate | Recipe 5 | Negligible. Excludes pre-2023 Chrome versions, which is a rounding error in 2026. |
| A4 | WXT auto-discovers `src/background/index.ts` as the SW entrypoint with `srcDir: 'src'` + `entrypointsDir: '.'` | Recipe 3 | Verified by example projects (turbostarter/extro `wxt.config.ts`). Wave 0 must confirm with a smoke build. |
| A5 | `chrome.storage.local` 10 MB total quota (raised from 5 MB) is the current Chrome value | Recipe 6 | LOW — even at the historical 5 MB, the resume schema fits comfortably (worst case ~25 KB). |
| A6 | One `chrome.storage.sync.set({k1, k2, …, kN})` call counts as **one** write operation against the rate limiter | Throughout (informs FND-06 and Phase 3 design) | HIGH IF WRONG, but VERIFIED by [WebSearch — developer.chrome.com docs and chromium-extensions group post]. The PITFALLS.md item MV3-1 also relies on this. Flag for the planner: a single corroborating Chromium source link in the plan would close any residual uncertainty. |

---

## Sources

### Primary (HIGH confidence)
- [Chrome `chrome.storage` API reference — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage) — quota constants, namespace properties, write operation semantics
- [`crypto.randomUUID()` — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) — Chrome 92+ availability, secure-context requirement
- [WXT documentation — Manifest config](https://wxt.dev/guide/essentials/config/manifest) — manifest declaration patterns
- [WXT documentation — Unit Testing](https://wxt.dev/guide/essentials/unit-testing) — `WxtVitest()`, `fakeBrowser.reset()` pattern
- [WXT documentation — Entrypoints](https://wxt.dev/guide/essentials/entrypoints.html) — auto-discovery of background/content/popup
- [WXT examples — vitest-unit-testing](https://github.com/wxt-dev/examples/tree/main/examples/vitest-unit-testing) — canonical test setup
- [WXT API reference — InlineConfig (`srcDir`, `entrypointsDir`)](https://wxt.dev/api/reference/wxt/interfaces/inlineconfig) — directory customization
- [WXT issue #213 — `entrypointsDir` resolved relative to `srcDir`](https://github.com/wxt-dev/wxt/issues/213) — confirms `entrypointsDir: '.'` works
- [WXT upgrading guide — v0.20 dropped `webextension-polyfill`](https://wxt.dev/guide/resources/upgrading) — uses `@wxt-dev/browser` and `@types/chrome`
- [Chromium Extensions group — `chrome.storage.sync` quota best practices](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/ACVyerzOjus) — batching semantics
- [Chrome 92 release notes — `crypto.randomUUID()` shipped](https://www.phoronix.com/news/Chrome-92) — version availability
- [Chromium bug 1197594 — `crypto.randomUUID()` implementation](https://bugs.chromium.org/p/chromium/issues/detail?id=1197594) — implementation tracking
- [ESLint `no-restricted-globals` rule docs](https://eslint.org/docs/latest/rules/no-restricted-globals) — DIST-04 enforcement layer 1
- npm registry — verified versions on 2026-05-01: `wxt@0.20.25` (published 2026-04-18), `vitest@4.1.5`, `svelte@5.55.5`, `@wxt-dev/module-svelte@2.0.5`

### Secondary (MEDIUM confidence)
- [aabidk.dev — Building Cross-Browser Web Extensions: Project Setup](https://aabidk.dev/blog/building-modern-cross-web-extensions-project-setup/) — third-party WXT scaffolding writeup
- [DEV.to (seryllns) — WXT + React + TypeScript guide](https://dev.to/seryllns_/build-modern-browser-extensions-with-wxt-react-and-typescript-h3h) — manifest examples corroboration
- [tutorialspoint — Multi-byte UTF-8 splitting in JavaScript](https://www.tutorialspoint.com/how-to-deal-with-multi-byte-utf-8-strings-in-javascript-and-fix-the-empty-delimiter-separator-issue) — codepoint-aware split rationale
- [TextEncoder MDN — `encodeInto()`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encodeInto) — UTF-8 byte-sequence-completion guarantees
- [github.com/ehmicky/string-byte-length](https://github.com/ehmicky/string-byte-length) — UTF-8 byte length reference
- Existing project research:
  - `.planning/research/STACK.md` — locked stack versions and rejected alternatives
  - `.planning/research/ARCHITECTURE.md` — component boundaries, storage layout, project structure
  - `.planning/research/PITFALLS.md` — 16 named pitfalls (MV3-1, MV3-3, AISTUDIO-2 scope-relevant)
  - `.planning/research/SUMMARY.md` — 10 lock-in items (1–6 are Phase 1's responsibility)
  - `.planning/research/FEATURES.md` — table-stakes vs anti-features

### Tertiary (LOW — flagged where used)
- WebSearch summarization of WXT testing patterns — corroborated against WXT docs and examples but cited for completeness

---

## Metadata

**Confidence breakdown:**
- Standard stack — HIGH — all versions verified against npm registry on research date.
- Manifest configuration — HIGH — multiple corroborating WXT docs + working examples.
- Test harness — HIGH — WXT's own examples repository demonstrates the exact pattern.
- Chunking algorithm — HIGH — codepoint-walk is the standard approach; `Blob` measurement is what D-05 locks.
- `crypto.randomUUID()` availability — HIGH — Chrome 92, MDN-verified, chromium bug closed Fixed.
- DIST-04 verification approach — MEDIUM-HIGH — multiple valid implementations exist; recommended dual-layer is conservative and well-supported by ESLint docs.
- TypeScript strict-mode set — MEDIUM — convention/best-practice based; the user has not signaled preference and may want to dial back individual flags.
- `chrome.storage.local` 10 MB quota — MEDIUM-HIGH — current Chrome documentation; older sources cite 5 MB. Either way, Phase 1 fits comfortably.

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (30 days for stable MV3/WXT/Vitest stack)

---

## RESEARCH COMPLETE

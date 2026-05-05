---
phase: 01-foundation
plan: 03
type: execute
wave: 2
depends_on: [02]
files_modified:
  - src/background/storage-layout.ts
  - src/background/storage-layout.test.ts
autonomous: true
requirements: [FND-05]
must_haves:
  truths:
    - "`splitIntoChunks(s)` for any string s with `new Blob([s]).size <= 7000` returns exactly one chunk"
    - "`splitIntoChunks(s)` for any string s where `new Blob([s]).size > 7000` returns multiple chunks, each individually <= 7000 bytes"
    - "`joinChunks(splitIntoChunks(s)) === s` for ALL test inputs (empty, ASCII at exactly 7000, ASCII 7001, multi-byte at boundary, 100KB pure emoji)"
    - "Empty string `''` produces `['']` (D-04: always-chunked, even for empty)"
    - "A 4-byte emoji landing at the chunk boundary is NOT split mid-codepoint — it goes entirely into the next chunk"
    - "`vitest run src/background/storage-layout.test.ts` exits 0 with at least 7 passing tests covering all D-25 chunking edge cases"
  artifacts:
    - path: "src/background/storage-layout.ts"
      provides: "Pure chunking primitives (splitIntoChunks, joinChunks, chunkByteLength)"
      contains: "export function splitIntoChunks"
    - path: "src/background/storage-layout.test.ts"
      provides: "Unit tests covering all D-25 chunking edge cases including UTF-8 boundary"
      min_lines: 80
  key_links:
    - from: "src/background/storage-layout.ts"
      to: "src/shared/constants.ts"
      via: "import { CHUNK_BUDGET_BYTES }"
      pattern: "import .* CHUNK_BUDGET_BYTES .* from ['\"]\\.\\./shared/constants['\"]"
    - from: "splitIntoChunks output"
      to: "joinChunks input"
      via: "round-trip identity (chunks.join(''))"
      pattern: "chunks\\.join\\(''\\)"
---

<objective>
Implement the chunking math primitives (Recipe 1) — the encode-once + codepoint-walk algorithm that splits an instruction body into ≤7000-byte chunks while respecting UTF-8 codepoint boundaries (D-04, D-05). Lands FND-05 (chunking; registry/body separation contract). Pure functions, no I/O — `chrome.storage.sync` reads/writes are layered on top in Phase 3.

Purpose: The 8192-byte-per-item `chrome.storage.sync` quota means every body MUST be chunked. A naïve byte-index split would corrupt 4-byte UTF-8 sequences (emoji) — Recipe 1's codepoint-walk algorithm is the canonical fix. Locking it now means Phase 3's push engine can call `splitIntoChunks` without re-deriving the algorithm.
Output: `src/background/storage-layout.ts` exporting `splitIntoChunks`, `joinChunks`, `chunkByteLength` plus colocated tests covering all D-25 edge cases.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-PATTERNS.md
@CLAUDE.md
@.planning/phases/01-foundation/01-02-SUMMARY.md
@src/shared/constants.ts
@src/shared/types.ts

<interfaces>
<!-- Plan 02 produced (consumed by this plan): -->

From src/shared/constants.ts:
```typescript
export const CHUNK_BUDGET_BYTES = 7000; // D-05: leaves ~1192 bytes headroom under 8192 per-item quota
export const BODY_KEY_PREFIX = 'sysins:body:';
```

<!-- Plan 04 (registry, parallel) does NOT depend on this plan's output - they are siblings in Wave 2. -->
<!-- Plan 03's exports are consumed by Phase 3 (push engine) — Phase 1 only ships the pure functions and their tests. -->

<!-- This plan ESTABLISHES these contracts: -->
```typescript
export function splitIntoChunks(body: string, budget?: number): string[];
export function joinChunks(chunks: string[]): string;
export function chunkByteLength(chunk: string): number;
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement splitIntoChunks / joinChunks / chunkByteLength</name>
  <files>src/background/storage-layout.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 1, lines 195-262) — verbatim algorithm sketch
    - .planning/phases/01-foundation/01-PATTERNS.md (lines 207-262) — pattern reference + edge case table
    - .planning/phases/01-foundation/01-CONTEXT.md (D-04, D-05, D-08) — chunking decisions
    - src/shared/constants.ts (Plan 02 output) — to import CHUNK_BUDGET_BYTES
    - .planning/research/SUMMARY.md (item 3) — single batched set() rule (informs Phase 3, not this file)
  </read_first>
  <behavior>
    - `splitIntoChunks('')` returns `['']` (D-04: always-chunked, length-1 array even for empty input).
    - `splitIntoChunks(s)` for ASCII string of exact length 7000 (= 7000 bytes) returns `[s]` (one chunk; equality at boundary stays in one chunk per the `>` comparison in Recipe 1).
    - `splitIntoChunks(s)` for ASCII string of length 7001 returns `[first7000, last1]` (two chunks).
    - `splitIntoChunks(s)` for `'a'.repeat(6998) + '🌍'` (where 🌍 is 4 UTF-8 bytes) returns 2 chunks: chunk1 = `'a'.repeat(6998)` (6998 bytes), chunk2 = `'🌍'` (4 bytes) — emoji NOT split.
    - `splitIntoChunks(s)` for `'a'.repeat(7000) + '🌍'` returns 2 chunks: chunk1 = `'a'.repeat(7000)` (7000 bytes), chunk2 = `'🌍'` (4 bytes).
    - `splitIntoChunks(s).join('') === s` for all valid inputs — round-trip identity.
    - `splitIntoChunks` defaults `budget` to `CHUNK_BUDGET_BYTES = 7000`; explicit budget is for tests only.
    - `chunkByteLength('hello')` returns 5; `chunkByteLength('🌍')` returns 4 (UTF-8 byte length, NOT character count).
    - `joinChunks(chunks)` is exactly `chunks.join('')` — no transformation. Documented separately so Phase 3 has a named function to call.
    - The function does NOT throw on oversized total bodies (D-08 oversized rejection is a CALLER concern, not the splitter's). The splitter only throws if a single codepoint exceeds the budget — impossible with budget≥4 since UTF-8 codepoints max at 4 bytes, but documented as a defensive guard.
  </behavior>
  <action>
    Create `src/background/storage-layout.ts` copying Recipe 1 (RESEARCH lines 204-245) verbatim with imports adjusted for actual module paths:
    ```typescript
    import { CHUNK_BUDGET_BYTES } from '../shared/constants';

    const encoder = new TextEncoder();

    /**
     * Split a body string into UTF-8-byte-bounded chunks.
     *
     * Algorithm: encode-once + codepoint-walk (Recipe 1). Walks the string
     * codepoint-by-codepoint via for-of (which yields whole codepoints,
     * never half a surrogate pair). Accumulates each codepoint's UTF-8 byte
     * length and emits a chunk when adding the next codepoint would exceed
     * the budget — guaranteeing no UTF-8 sequence is split mid-byte.
     *
     * D-04: always returns at least one chunk, even for empty input ([''])
     * D-05: budget defaults to CHUNK_BUDGET_BYTES (7000), measured via UTF-8 byte length
     */
    export function splitIntoChunks(body: string, budget = CHUNK_BUDGET_BYTES): string[] {
      if (body.length === 0) return ['']; // D-04: always-chunked, even empty
      const chunks: string[] = [];
      let buf = '';
      let bufBytes = 0;

      for (const codepoint of body) {
        // for-of iterates whole codepoints (handles surrogate pairs correctly).
        const cpBytes = encoder.encode(codepoint).byteLength;
        if (cpBytes > budget) {
          // Defensive guard: a single UTF-8 codepoint maxes at 4 bytes,
          // so this only fires if budget < 4 — wrong-config rather than
          // bad-input. Throw rather than corrupt output.
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
      chunks.push(buf); // final partial (or only) chunk
      return chunks;
    }

    /**
     * Reassemble a chunked body. `chunks.join('')` is sufficient because
     * splitIntoChunks never splits a codepoint, so concatenation always
     * recovers the original string byte-for-byte.
     */
    export function joinChunks(chunks: string[]): string {
      return chunks.join('');
    }

    /**
     * UTF-8 byte length of a chunk (D-05 measurement primitive).
     * Used for post-split validation and quota math.
     */
    export function chunkByteLength(chunk: string): number {
      return new Blob([chunk]).size;
    }
    ```

    Decision lock: the boundary rule is asymmetric — when a multi-byte codepoint would exceed the budget, it goes ENTIRELY into the next chunk (never tries to "fill" the byte gap with subsequent ASCII). This is the conservative-correct choice per RESEARCH line 259. Reassembly (`chunks.join('')`) always recovers the original; do NOT add any "byte-padding" logic.

    Do NOT add a `validateChunks(chunks)` helper that throws on oversized total — D-08's oversized-item rejection is a Phase 3 caller concern that tracks the per-item / total-budget math at the registry level. Phase 1 only delivers the pure splitter.

    Do NOT touch `chrome.storage.*` in this file — it's pure functions only. Plan 05 adds the SW wiring; Phase 3 adds the push-cycle caller.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `src/background/storage-layout.ts` exists
    - `src/background/storage-layout.ts` imports `CHUNK_BUDGET_BYTES` from `'../shared/constants'`
    - `src/background/storage-layout.ts` declares `const encoder = new TextEncoder()` at module scope
    - `src/background/storage-layout.ts` exports function `splitIntoChunks(body: string, budget?: number): string[]`
    - `src/background/storage-layout.ts` exports function `joinChunks(chunks: string[]): string`
    - `src/background/storage-layout.ts` exports function `chunkByteLength(chunk: string): number`
    - `src/background/storage-layout.ts` contains literal substring `if (body.length === 0) return [''];` (D-04 always-chunked rule)
    - `src/background/storage-layout.ts` contains literal substring `for (const codepoint of body)` (codepoint-aware iteration per Recipe 1)
    - `src/background/storage-layout.ts` contains literal substring `chunks.join('')` (in `joinChunks`)
    - `src/background/storage-layout.ts` contains literal substring `new Blob([chunk]).size` (in `chunkByteLength`, D-05 measurement primitive)
    - `src/background/storage-layout.ts` does NOT call `chrome.storage.sync` or `chrome.storage.local` (pure functions only)
    - `src/background/storage-layout.ts` does NOT contain `String.prototype.slice` byte-indexed splits (`.slice(0, 7000)` etc.)
    - Command `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    `storage-layout.ts` exists with the three pure functions. TypeScript compiles. The codepoint-walk algorithm is in place (no naïve byte-slice). The file does not touch any chrome API.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Write storage-layout.test.ts covering all D-25 chunking edge cases</name>
  <files>src/background/storage-layout.test.ts</files>
  <read_first>
    - src/background/storage-layout.ts (Task 1 output) — to import the splitter
    - src/shared/constants.ts (Plan 02) — to import CHUNK_BUDGET_BYTES (= 7000) for explicit assertions
    - .planning/phases/01-foundation/01-CONTEXT.md (D-25) — required test coverage list
    - .planning/phases/01-foundation/01-RESEARCH.md (Recipe 1 edge case table, lines 247-257) — exact cases to exercise
    - .planning/phases/01-foundation/01-PATTERNS.md (lines 252-262) — same edge case table mirrored
  </read_first>
  <behavior>
    Test cases (one `it()` each, minimum 7):
    1. `splitIntoChunks('')` returns `['']` (D-04 always-chunked).
    2. `splitIntoChunks('a'.repeat(7000))` returns one chunk of length 7000 — equality at boundary stays in one chunk.
    3. `splitIntoChunks('a'.repeat(7001))` returns two chunks: lengths 7000 + 1.
    4. `splitIntoChunks('a'.repeat(6998) + '🌍')` returns two chunks: chunk1 = `'a'.repeat(6998)`, chunk2 = `'🌍'`. The emoji is NOT split mid-codepoint.
    5. `splitIntoChunks('a'.repeat(7000) + '🌍')` returns two chunks: chunk1 = `'a'.repeat(7000)`, chunk2 = `'🌍'`.
    6. Round-trip: for a sample 100KB pure-emoji string (~25,000 emojis), `joinChunks(splitIntoChunks(s)) === s`.
    7. Every chunk satisfies `chunkByteLength(c) <= 7000` for ALL inputs above.
    8. (bonus) `splitIntoChunks('hello world')` returns `['hello world']` (single small chunk).

    All tests must run without `chrome.storage.*` (these are pure-function tests — `fakeBrowser` is not needed but importing it is harmless).
  </behavior>
  <action>
    Create `src/background/storage-layout.test.ts` with the D-25 coverage:
    ```typescript
    import { describe, it, expect } from 'vitest';
    import { splitIntoChunks, joinChunks, chunkByteLength } from './storage-layout';
    import { CHUNK_BUDGET_BYTES } from '../shared/constants';

    describe('splitIntoChunks (Recipe 1, D-04 / D-05 / D-25)', () => {
      it('returns a single empty-string chunk for empty input (D-04 always-chunked)', () => {
        const chunks = splitIntoChunks('');
        expect(chunks).toEqual(['']);
        expect(chunks).toHaveLength(1);
      });

      it('returns a single chunk for plain "hello world"', () => {
        expect(splitIntoChunks('hello world')).toEqual(['hello world']);
      });

      it('returns one chunk for ASCII length === CHUNK_BUDGET_BYTES (7000) — boundary equal stays in one chunk', () => {
        const s = 'a'.repeat(CHUNK_BUDGET_BYTES);
        const chunks = splitIntoChunks(s);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe(s);
        expect(chunkByteLength(chunks[0]!)).toBe(7000);
      });

      it('returns two chunks for ASCII length === CHUNK_BUDGET_BYTES + 1 (7001)', () => {
        const s = 'a'.repeat(CHUNK_BUDGET_BYTES + 1);
        const chunks = splitIntoChunks(s);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]?.length).toBe(7000);
        expect(chunks[1]?.length).toBe(1);
      });

      it('does NOT split a 4-byte emoji at byte position 6998 — emoji moves entirely into chunk 2', () => {
        // 6998 ASCII bytes + 🌍 (4 bytes UTF-8) = 7002 bytes total.
        // 6998 + 4 > 7000 budget, so emoji starts a new chunk per Recipe 1's > comparison.
        const s = 'a'.repeat(6998) + '🌍';
        const chunks = splitIntoChunks(s);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toBe('a'.repeat(6998));
        expect(chunks[1]).toBe('🌍');
        // Confirm chunk boundary respects UTF-8 — re-encoding chunk[0] succeeds without replacement chars
        expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(chunks[0]!))).toBe('a'.repeat(6998));
      });

      it('places a 4-byte emoji entirely in chunk 2 when ASCII fills exactly 7000 bytes', () => {
        const s = 'a'.repeat(7000) + '🌍';
        const chunks = splitIntoChunks(s);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toBe('a'.repeat(7000));
        expect(chunks[1]).toBe('🌍');
      });

      it('every chunk has chunkByteLength &lt;= CHUNK_BUDGET_BYTES', () => {
        const inputs = [
          '',
          'a',
          'a'.repeat(7000),
          'a'.repeat(7001),
          'a'.repeat(6998) + '🌍',
          'a'.repeat(7000) + '🌍',
          '🌍'.repeat(2000), // ~8KB pure emoji
        ];
        for (const s of inputs) {
          const chunks = splitIntoChunks(s);
          for (const chunk of chunks) {
            expect(chunkByteLength(chunk)).toBeLessThanOrEqual(CHUNK_BUDGET_BYTES);
          }
        }
      });
    });

    describe('joinChunks (Recipe 1)', () => {
      it('round-trips: joinChunks(splitIntoChunks(s)) === s for all D-25 cases', () => {
        const inputs = [
          '',
          'hello',
          'a'.repeat(7000),
          'a'.repeat(7001),
          'a'.repeat(6998) + '🌍',
          'a'.repeat(7000) + '🌍',
          'a'.repeat(15000) + '🌍🌍🌍' + 'b'.repeat(15000), // multi-chunk with emojis interspersed
        ];
        for (const s of inputs) {
          expect(joinChunks(splitIntoChunks(s))).toBe(s);
        }
      });

      it('round-trips a 100KB pure-emoji string (~25,000 emojis × 4 bytes)', () => {
        const s = '🌍'.repeat(25_000);
        const chunks = splitIntoChunks(s);
        expect(chunks.length).toBeGreaterThan(10); // ~14 chunks per RESEARCH edge-case table
        for (const c of chunks) expect(chunkByteLength(c)).toBeLessThanOrEqual(CHUNK_BUDGET_BYTES);
        expect(joinChunks(chunks)).toBe(s); // bit-exact recovery
      });
    });

    describe('chunkByteLength (Recipe 1, D-05)', () => {
      it('returns UTF-8 byte length, not JS character count', () => {
        expect(chunkByteLength('hello')).toBe(5); // ASCII: bytes === chars
        expect(chunkByteLength('🌍')).toBe(4); // 1 emoji char, 4 UTF-8 bytes
        expect(chunkByteLength('é')).toBe(2); // 1 char, 2 bytes (Latin-1 supplement)
      });
    });
    ```

    Test count: 11 `it()` calls (well above the 7 minimum). All cover D-25 lines 76 ("chunking + reassembly round-trip including bodies > 7KB and edge cases (empty body string, body exactly at 7000 bytes, body with multi-byte UTF-8, oversized rejection)") — note "oversized rejection" of D-08 is NOT tested here; it's a Phase 3 caller concern. Test 6 covers the round-trip > 7KB case.

    Note: `fakeBrowser` is intentionally omitted — these tests need no chrome API. `vitest.config.ts` (Plan 01) provides the test runner; the `WxtVitest()` plugin doesn't interfere with pure-function tests.
  </action>
  <verify>
    <automated>npx vitest run src/background/storage-layout.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - File `src/background/storage-layout.test.ts` exists
    - `src/background/storage-layout.test.ts` imports `splitIntoChunks`, `joinChunks`, `chunkByteLength` from `./storage-layout`
    - `src/background/storage-layout.test.ts` imports `CHUNK_BUDGET_BYTES` from `'../shared/constants'`
    - `src/background/storage-layout.test.ts` contains at least 7 `it(...)` calls
    - `src/background/storage-layout.test.ts` contains test descriptions matching: `/empty input/i`, `/CHUNK_BUDGET_BYTES/`, `/emoji/i`, `/round-trip/i`, `/byte length/i`
    - `src/background/storage-layout.test.ts` contains literal substring `'a'.repeat(7000)` (boundary case)
    - `src/background/storage-layout.test.ts` contains literal substring `'a'.repeat(7001)` (over-by-one case)
    - `src/background/storage-layout.test.ts` contains literal substring `'🌍'` (multi-byte UTF-8 case)
    - `src/background/storage-layout.test.ts` contains literal substring `'🌍'.repeat(25_000)` or `'🌍'.repeat(25000)` (100KB pure-emoji round-trip)
    - Command `npx vitest run src/background/storage-layout.test.ts` exits 0
    - Test output reports `Tests 11 passed` (or higher; minimum 7 passing)
  </acceptance_criteria>
  <done>
    `storage-layout.test.ts` exists with all D-25 chunking cases covered. All tests pass. The chunking math is now an immutable contract — Phase 3's push engine can call `splitIntoChunks` confident that the round-trip is byte-exact.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Body string (untrusted) → splitIntoChunks → chunks | The body is opaque user content from AI Studio's localStorage. Could contain any UTF-8 codepoint, any length, any pathological input (deeply-nested control chars, lone surrogates). |
| Chunks → chrome.storage.sync (Phase 3) | Chunks must individually fit the 8192-byte per-item quota; total set must fit the ~100KB total quota. Phase 1's chunkByteLength gives the measurement primitive. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-09 | T (Tampering) | Splitter for malformed UTF-16 input (lone surrogate) | accept | JavaScript string for-of yields lone surrogates as `�`-equivalent codepoints; `TextEncoder.encode()` replaces them with the U+FFFD replacement character. The output chunks remain valid UTF-8. Phase 1 does not need a separate validator — encoding is lossless on already-well-formed UTF-16 and replacement-char-safe on malformed input. |
| T-01-10 | D (Denial of Service) | A pathologically large body (>100KB) passed to splitIntoChunks | accept | Splitter does not enforce a total-byte cap — it returns however many chunks are needed (could be hundreds for a 1MB body). The caller (Phase 3 push engine) is responsible for D-08 oversized-item rejection. The splitter itself is O(n) and never throws on legitimate input. |
| T-01-11 | T (Tampering) | Single codepoint exceeds budget (theoretical: budget &lt; 4) | mitigate | Defensive `throw new Error('Codepoint exceeds chunk budget')` in splitIntoChunks. Cannot occur with `CHUNK_BUDGET_BYTES = 7000` (UTF-8 codepoints max at 4 bytes), but guards against future config errors. |
| T-01-12 | I (Information Disclosure) | chunkByteLength via `new Blob([s]).size` | accept | `Blob` is available in MV3 SW. The measurement is local — no network or storage I/O. No information leaves the SW. |
</threat_model>

<verification>
1. `npx tsc --noEmit` passes — `storage-layout.ts` types compile.
2. `npx vitest run src/background/storage-layout.test.ts` exits 0 with all 11 tests passing.
3. Round-trip identity holds for all D-25 cases: empty, 7000, 7001, multi-byte at boundary, 100KB pure emoji.
4. No chunk in any test output exceeds 7000 bytes.
5. The file does not contain any `chrome.storage.*` calls (pure functions only).
</verification>

<success_criteria>
- ROADMAP success criterion #1: chunking + reassembly round-trip test passes (incl. >7KB, multi-byte UTF-8 boundary). The 11 tests in `storage-layout.test.ts` cover this exhaustively.
- FND-05 (registry/body separation): the body half — `splitIntoChunks` produces the per-chunk strings that Phase 3 will write as `sysins:body:<uuid>:c0`, `:c1`, … `:cN-1` (D-04 always-chunked layout). The `chunks` count goes into `RegistryRecord.chunks` (D-03) so reassembly knows how many keys to fetch.
- The chunking algorithm is locked: Phase 3's push engine and Phase 4's pull engine import `splitIntoChunks`/`joinChunks` and never re-derive the algorithm.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-03-SUMMARY.md` documenting:
- Final exported function signatures (the audit trail for D-04 / D-05's chunking lock)
- Total passing tests in `storage-layout.test.ts` and the breakdown of edge cases covered
- Confirmation that the file does NOT touch `chrome.storage.*` (Phase 3 will add that wiring)
</output>

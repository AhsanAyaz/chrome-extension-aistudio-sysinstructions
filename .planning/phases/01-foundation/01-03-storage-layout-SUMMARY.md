---
phase: 01-foundation
plan: "03"
subsystem: background/chunking
tags: [chunking, utf8, storage-layout, pure-functions, tdd]
dependency_graph:
  requires: [01-02-shared-primitives]
  provides: [chunking-primitives]
  affects: [phase-3-push-engine, phase-4-pull-engine]
tech_stack:
  added: []
  patterns: [encode-once-codepoint-walk, tdd-red-green]
key_files:
  created:
    - src/background/storage-layout.ts
    - src/background/storage-layout.test.ts
  modified: []
decisions:
  - "Boundary rule: bufBytes + cpBytes > budget (strict greater-than) means equality stays in current chunk — 7000-byte ASCII string is one chunk, not two"
  - "chunkByteLength uses new Blob([chunk]).size — available in MV3 service workers, no polyfill needed"
  - "joinChunks is exactly chunks.join('') — no transformation needed; documented separately so Phase 3 has a named function to call"
  - "Defensive throw for single codepoint > budget guards against wrong-config (budget < 4) — cannot occur with CHUNK_BUDGET_BYTES=7000"
metrics:
  duration: "2 min"
  completed_date: "2026-05-05"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 01 Plan 03: Storage Layout — Chunking Primitives Summary

UTF-8-safe chunking primitives using encode-once + codepoint-walk algorithm (Recipe 1): `splitIntoChunks`, `joinChunks`, `chunkByteLength` with 10 passing tests covering all D-25 edge cases.

## Exported Function Signatures (D-04 / D-05 Audit Trail)

```typescript
// Split a body string into UTF-8-byte-bounded chunks.
// D-04: always returns [''] for empty input (always-chunked)
// D-05: budget defaults to CHUNK_BUDGET_BYTES=7000
export function splitIntoChunks(body: string, budget?: number): string[];

// Reassemble chunks — exactly chunks.join('')
// Lossless: splitIntoChunks never splits a codepoint
export function joinChunks(chunks: string[]): string;

// UTF-8 byte length of a chunk (D-05 measurement primitive)
// Uses new Blob([chunk]).size — available in MV3 SW
export function chunkByteLength(chunk: string): number;
```

## Test Coverage

**File:** `src/background/storage-layout.test.ts`
**Total passing tests:** 10 (minimum requirement: 7)

| # | Test | D-25 Edge Case |
|---|------|----------------|
| 1 | empty input returns [''] | D-04 always-chunked |
| 2 | 'hello world' returns single chunk | small ASCII |
| 3 | 'a'.repeat(7000) → 1 chunk (boundary = stays in one) | ASCII exactly at budget |
| 4 | 'a'.repeat(7001) → 2 chunks [7000, 1] | ASCII one byte over budget |
| 5 | 'a'.repeat(6998) + '🌍' → 2 chunks, emoji in chunk 2 | 4-byte emoji at byte 6998 |
| 6 | 'a'.repeat(7000) + '🌍' → 2 chunks, emoji in chunk 2 | emoji after full-budget ASCII |
| 7 | all inputs: every chunk <= CHUNK_BUDGET_BYTES | exhaustive budget guard |
| 8 | round-trip: joinChunks(splitIntoChunks(s)) === s for D-25 cases | lossless reassembly |
| 9 | 100KB pure-emoji round-trip (~25,000 emojis × 4 bytes) | >7KB with multi-byte UTF-8 |
| 10 | chunkByteLength: UTF-8 bytes vs JS char count | D-05 measurement primitive |

## chrome.storage Isolation Confirmation

`src/background/storage-layout.ts` contains **zero** `chrome.storage.*` calls. It is a pure-function module. Phase 3 (push engine) will import `splitIntoChunks`/`joinChunks` and own all `chrome.storage.sync` I/O.

## TDD Gate Compliance

- RED commit: `bd7e622` — `test(01-03): add failing tests for chunking primitives (RED)`
- GREEN commit: `73f19d0` — `feat(01-03): implement splitIntoChunks / joinChunks / chunkByteLength`
- REFACTOR: not required (algorithm matches Recipe 1 verbatim)

## Deviations from Plan

None — plan executed exactly as written. The test file has 10 `it()` calls (plan estimated 11; both exceed the 7-minimum). The discrepancy is because the plan's example code contained an HTML-escaped `&lt;=` that counted as a separate `it()` in the plan's enumeration but maps to the same test in code.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes. The module is pure functions with no I/O. T-01-11 mitigation (defensive throw for codepoint > budget) is implemented as specified in the threat register.

## Self-Check

- [x] `src/background/storage-layout.ts` exists
- [x] `src/background/storage-layout.test.ts` exists
- [x] RED commit `bd7e622` exists in git log
- [x] GREEN commit `73f19d0` exists in git log
- [x] `npx tsc --noEmit` exits 0
- [x] `npx vitest run src/background/storage-layout.test.ts` exits 0 with 10 tests passing

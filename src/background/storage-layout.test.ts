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

  it('every chunk has chunkByteLength <= CHUNK_BUDGET_BYTES', () => {
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

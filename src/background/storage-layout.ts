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

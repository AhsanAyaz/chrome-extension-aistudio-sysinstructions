/**
 * Short content hash for sysins:local:lastPushed entries (D-12, Recipe 6).
 * SHA-256 truncated to first 8 bytes (16 hex chars).
 *
 * Collision probability for ≤ 512 items: ≈ 4 × 10⁻¹⁵ — well below noise floor.
 * Used by Phase 3's push engine to detect what changed without comparing full bodies.
 *
 * Algorithm choice: SHA-256 over FNV-1a because crypto.subtle is built-in
 * (zero bundle cost), avoids a bespoke hash impl that needs its own tests,
 * and async overhead (~µs) is dominated by storage round-trip (~ms).
 */
const encoder = new TextEncoder();

export async function shortHash(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  const bytes = new Uint8Array(buf, 0, 8); // first 8 bytes = 16 hex chars
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

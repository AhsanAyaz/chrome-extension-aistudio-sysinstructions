/**
 * Returns true iff `value` is a valid, non-empty JSON array.
 *
 * Enforces Hard Rule #4 (D-07 / PUSH-05): null/missing/empty localStorage
 * reads are NEVER forwarded as LS_CHANGED — they are detection failures.
 *
 * Reusable by Phase 3's push engine (same guard applies to polling path).
 */
export function isValidPayload(value: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  return Array.isArray(parsed) && parsed.length > 0;
}

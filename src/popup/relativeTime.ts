/**
 * Locale-relative timestamp display.
 * UI-SPEC Timestamp display rule:
 *   < 60 seconds ago → "just now"
 *   1–59 minutes ago → "{N} min ago"
 *   1–23 hours ago   → "{N} hr ago"
 *   1–6 days ago     → "{N} days ago"
 *   >= 7 days        → ISO date string YYYY-MM-DD
 *
 * No library — hand-rolled per RESEARCH.md "Don't Hand-Roll > Timestamp formatting".
 */
export function relativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
  return new Date(epochMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

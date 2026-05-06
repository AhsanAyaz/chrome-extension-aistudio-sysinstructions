/**
 * Account Mismatch Pre-flight (BOOT-03).
 *
 * Compares the Chrome profile email (from chrome.identity.getProfileUserInfo)
 * with the AI Studio signed-in account email (scraped from DOM by content script).
 *
 * If emails differ: setErrorState('ACCOUNT_MISMATCH') — auto-sync pauses.
 * DIST-02 exception: identity + identity.email permissions strictly required for account safety.
 *
 * Spike findings: .claude/skills/spike-findings-boot03/SKILL.md
 * - Confirmed selector: document.querySelector('[aria-label*="Google Account"]')
 * - Raw attribute value: "Google Account: Full Name (email@example.com)"
 * - Email extraction regex: /\(([^)]+)\)$/ — last parenthesised group
 * - BOTH "identity" AND "identity.email" permissions required (not just "identity.email")
 */

import { setErrorState, writeSyncStatus, readSyncStatus } from './sync-state';

/**
 * Parse the signed-in email from the AI Studio DOM attribute value.
 * Attribute format confirmed by spike (see SKILL.md Finding 2).
 *
 * Example input: "Google Account: Muhammad Ahsan Ayaz (Ahsan.ubitian@gmail.com)"
 * Returns: "Ahsan.ubitian@gmail.com"
 */
export function extractPageEmail(attributeValue: string): string | null {
  // Regex confirmed by .claude/skills/spike-findings-boot03/SKILL.md Finding 2.
  // Matches the last parenthesised group which contains the email.
  const match = attributeValue.match(/\(([^)]+)\)$/);
  return match?.[1] ?? null;
}

/**
 * Check whether the Chrome profile account matches the AI Studio page account.
 *
 * @param pageEmail - email scraped from AI Studio DOM by the content script.
 *   Optional — if undefined or empty, the check is skipped (not treated as mismatch).
 * @returns true if a mismatch was detected and sync should be aborted; false if OK to proceed.
 */
export async function checkAccountMismatch(
  pageEmail: string | undefined,
): Promise<boolean> {
  if (!pageEmail) {
    // Cannot compare — page email not available. Skip check, allow sync to proceed.
    return false;
  }

  // Requires both "identity" AND "identity.email" permissions (D-03, confirmed by spike).
  const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
  const chromeEmail = userInfo.email;

  if (chromeEmail === '') {
    // Identity API unavailable (e.g. not signed in, or permissions insufficient).
    // Skip check, allow sync to proceed — do not block on identity failure.
    console.log('[sysins] account-preflight: identity check skipped (empty chrome email)');
    return false;
  }

  if (chromeEmail !== pageEmail) {
    console.log('[sysins] account-preflight: ACCOUNT_MISMATCH detected');
    await setErrorState('ACCOUNT_MISMATCH');
    return true; // caller must abort sync
  }

  // Emails match — clear any previous ACCOUNT_MISMATCH error so badge returns to idle.
  const current = await readSyncStatus();
  if (current.errorState === 'ACCOUNT_MISMATCH') {
    await writeSyncStatus({ state: 'idle', lastSyncAt: current.lastSyncAt });
  }
  return false;
}

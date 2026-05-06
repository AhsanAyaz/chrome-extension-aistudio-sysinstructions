// src/content/index.ts
// ISOLATED-world relay content script.
// runAt: 'document_start' — injectScript() must run before any AI Studio JS.
// This file is the ONLY place the null/empty guard (D-07) runs. The injector
// (D-06) does no filtering; the SW stub (Phase 2) receives only valid arrays.

import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';
import type { RawInstruction, PendingRemoteState } from '../shared/types';
import { isValidPayload } from '../shared/guard';
import {
  BOOTSTRAP_NEEDED_KEY,
  PENDING_REMOTE_KEY,
  WATCHED_LS_KEY,
} from '../shared/constants';

/**
 * Fire-and-forget wrapper for chrome.runtime.sendMessage.
 * Suppresses unhandled-rejection noise when the SW is inactive; the SW will
 * catch up via the polling fallback (D-09).
 */
function fireAndForget(payload: object): void {
  chrome.runtime.sendMessage(payload).catch(() => {
    // SW may be inactive; message dropped intentionally. SW will catch up via polling.
  });
}

/**
 * Parse the signed-in email from the AI Studio DOM attribute value.
 * Local copy — avoids cross-entrypoint import from background/.
 * Selector and regex confirmed by .claude/skills/spike-findings-boot03/SKILL.md Finding 2.
 *
 * Example input: "Google Account: Muhammad Ahsan Ayaz (Ahsan.ubitian@gmail.com)"
 * Returns: "Ahsan.ubitian@gmail.com" or null if format is unrecognised.
 */
function extractPageEmail(attributeValue: string): string | null {
  const match = attributeValue.match(/\(([^)]+)\)$/);
  return match?.[1] ?? null;
}

export default defineContentScript({
  matches: ['https://aistudio.google.com/*'],
  runAt: 'document_start',
  // world defaults to ISOLATED — do NOT set world: 'MAIN' here (WXT anti-pattern)

  async main() {
    // Step 1: Inject MAIN-world patch synchronously at document_start.
    // MV3: injectScript is synchronous — patch is in place before any page JS.
    // keepInDom: false removes the <script> tag; prototype patch survives (Pitfall 5).
    await injectScript('/injected/ls-observer.js', { keepInDom: false });

    // Phase 4 BOOT-03: read signed-in account email from AI Studio DOM once on page load.
    // Selector confirmed by .claude/skills/spike-findings-boot03/SKILL.md Finding 2.
    // pageEmail is undefined if the DOM element is not found (SW skips mismatch check).
    const accountEl = document.querySelector('[aria-label*="Google Account"]');
    const pageEmail = accountEl
      ? (extractPageEmail(accountEl.getAttribute('aria-label') ?? '') ?? undefined)
      : undefined;

    // Phase 4: write merged instructions to localStorage and dispatch a synthetic StorageEvent
    // so AI Studio's React picks up the change in this tab.
    // Hard Rule 8: best-effort — React may or may not respond. "Refresh AI Studio" is the
    // documented fallback. Do NOT attempt React fiber injection.
    function applyRemoteLocally(instructions: RawInstruction[]): void {
      console.log('[sysins] applyRemoteLocally called', instructions.length);
      const serialized = JSON.stringify(instructions);
      const oldValue = localStorage.getItem(WATCHED_LS_KEY);
      localStorage.setItem(WATCHED_LS_KEY, serialized);
      window.dispatchEvent(new StorageEvent('storage', {
        key: WATCHED_LS_KEY,
        oldValue,
        newValue: serialized,
        storageArea: localStorage, // must be the actual localStorage object — not a copy
        url: window.location.href,
      }));
    }

    // Step 2: postMessage bridge — MAIN world → ISOLATED world.
    // D-10: filter on event.source === window FIRST (iframe spoof guard, Pitfall 3),
    //        THEN filter on event.data.source === 'sysins-injected'.
    window.addEventListener('message', (event) => {
      if (event.source !== window) return; // D-10: iframe/cross-frame spoof guard
      if (event.data?.source !== 'sysins-injected') return; // D-10: source filter
      if (event.data.type !== 'LS_SET') return;

      const value = event.data.value as string;

      // D-07 / PUSH-05: null/empty guard — never forward a null or empty read.
      // Implements Hard Rule #4: empty results are detection failures, not user deletes.
      if (!isValidPayload(value)) return;

      // D-08 / PUSH-06: forward verbatim — no field stripping.
      // Phase 4 BOOT-03: piggyback pageEmail (one DOM read per CS load, already cached).
      fireAndForget({
        type: 'LS_CHANGED',
        payload: JSON.parse(value) as RawInstruction[],
        pageEmail, // BOOT-03: optional — SW skips mismatch check if undefined
      });
    });

    // Step 3: 2-second polling fallback (D-09).
    // Belt-and-suspenders: catches writes missed by the injector (e.g. writes that
    // occurred before document_start or in edge cases). Continuous, not visibility-gated.
    // lastSnapshot diff guard prevents duplicate LS_CHANGED fires for unchanged values.
    // Initialize to current value so the first poll does not spuriously fire for
    // a key that was already set before the content script loaded (WR-03).
    let lastSnapshot: string | null = localStorage.getItem(WATCHED_LS_KEY);
    setInterval(() => {
      const value = localStorage.getItem(WATCHED_LS_KEY);
      if (value === lastSnapshot) return; // no change — skip
      lastSnapshot = value;
      if (value === null) return; // D-07 applies to polling path too
      if (!isValidPayload(value)) return; // D-07 / PUSH-05

      // D-08 / PUSH-06: forward verbatim
      // Phase 4 BOOT-03: piggyback pageEmail on polling path too.
      fireAndForget({
        type: 'LS_CHANGED',
        payload: JSON.parse(value) as RawInstruction[],
        pageEmail, // BOOT-03: optional
      });
    }, 2000);

    // Phase 4: receive merged instruction array from the service worker (PULL-01, PULL-03).
    // Synchronous handler — do NOT return true (no async response needed).
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'APPLY_REMOTE') {
        applyRemoteLocally(message.payload as RawInstruction[]);
        // No sendResponse — fire-and-forget delivery (Hard Rule 8)
      }
      // Return undefined for unhandled types — Chrome closes the port immediately.
    });

    // Phase 4: check for first-install bootstrap flag (D-05, BOOT-01/BOOT-02).
    // SW writes BOOTSTRAP_NEEDED_KEY on onInstalled(reason='install').
    // CS reads flag, sends LS_BOOTSTRAP if valid data is present.
    // CS NEVER clears the flag — only SW clears it after successful union merge (Pitfall 3 guard).
    const flagResult = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    if (flagResult[BOOTSTRAP_NEEDED_KEY] !== undefined) {
      const raw = localStorage.getItem(WATCHED_LS_KEY);
      if (raw !== null && isValidPayload(raw)) {
        fireAndForget({
          type: 'LS_BOOTSTRAP',
          payload: JSON.parse(raw) as RawInstruction[],
          pageEmail, // BOOT-03: optional — SW skips mismatch check if undefined
        });
      }
      // If no valid local data: SW will pull from remote on its next wake.
      // Hard Rule 4: empty localStorage is NOT propagated as "nothing to bootstrap".
    }

    // Phase 4: apply deferred remote payload when this tab regains focus (D-08, PULL-05).
    // SW writes PENDING_REMOTE_KEY when no active tab is found after a pull.
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
      const pending = r[PENDING_REMOTE_KEY] as PendingRemoteState | undefined;
      if (pending !== undefined) {
        applyRemoteLocally(pending.payload);
        await chrome.storage.local.remove(PENDING_REMOTE_KEY);
      }
    });
  },
});

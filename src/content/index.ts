// src/content/index.ts
// ISOLATED-world relay content script.
// runAt: 'document_start' — injectScript() must run before any AI Studio JS.
// This file is the ONLY place the null/empty guard (D-07) runs. The injector
// (D-06) does no filtering; the SW stub (Phase 2) receives only valid arrays.

import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';
import type { RawInstruction } from '../shared/types';
import { isValidPayload } from '../shared/guard';

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

export default defineContentScript({
  matches: ['https://aistudio.google.com/*'],
  runAt: 'document_start',
  // world defaults to ISOLATED — do NOT set world: 'MAIN' here (WXT anti-pattern)

  async main() {
    // Step 1: Inject MAIN-world patch synchronously at document_start.
    // MV3: injectScript is synchronous — patch is in place before any page JS.
    // keepInDom: false removes the <script> tag; prototype patch survives (Pitfall 5).
    await injectScript('/injected/ls-observer.js', { keepInDom: false });

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
      fireAndForget({
        type: 'LS_CHANGED',
        payload: JSON.parse(value) as RawInstruction[],
      });
    });

    // Step 3: 2-second polling fallback (D-09).
    // Belt-and-suspenders: catches writes missed by the injector (e.g. writes that
    // occurred before document_start or in edge cases). Continuous, not visibility-gated.
    // lastSnapshot diff guard prevents duplicate LS_CHANGED fires for unchanged values.
    let lastSnapshot: string | null = null;
    setInterval(() => {
      const value = localStorage.getItem('aistudio_all_system_instructions');
      if (value === lastSnapshot) return; // no change — skip
      lastSnapshot = value;
      if (value === null) return; // D-07 applies to polling path too
      if (!isValidPayload(value)) return; // D-07 / PUSH-05

      // D-08 / PUSH-06: forward verbatim
      fireAndForget({
        type: 'LS_CHANGED',
        payload: JSON.parse(value) as RawInstruction[],
      });
    }, 2000);
  },
});

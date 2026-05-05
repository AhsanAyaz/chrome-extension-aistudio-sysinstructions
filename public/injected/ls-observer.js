// src/injected/ls-observer.js
// MAIN-world script: patches Storage.prototype.setItem to observe AI Studio localStorage writes.
// D-04: plain JavaScript (not TypeScript) — MAIN world has no ES module system.
// D-05: WATCHED_KEY is a literal; canonical definition is src/shared/constants.ts (WATCHED_LS_KEY).
// D-06: NO parsing, NO filtering, NO validation — post raw string verbatim. All logic in content script.
// keepInDom: false in the caller removes the <script> tag; prototype patch survives as a JS closure.

const WATCHED_KEY = 'aistudio_all_system_instructions';
const _setItem = Storage.prototype.setItem;

Storage.prototype.setItem = function (key, value) {
  // Always call the original first — real write must complete even if postMessage throws.
  _setItem.apply(this, arguments);
  if (key === WATCHED_KEY && this === window.localStorage) {
    window.postMessage(
      { source: 'sysins-injected', type: 'LS_SET', value: value },
      '*'
    );
  }
};

import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.', // matches D-23 layout: src/background/, src/content/, src/popup/
  modules: ['@wxt-dev/module-svelte'],  // Phase 5 addition (D-11)
  manifest: {
    name: 'AI Studio Instructions Sync',
    description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['storage', 'scripting', 'alarms', 'identity', 'identity.email'],
    action: {}, // required for chrome.action API (setBadgeText, setBadgeBackgroundColor) in service worker
    host_permissions: ['https://aistudio.google.com/*'],
    // No <all_urls>, no tabs, no notifications. identity + identity.email added in Phase 4 (D-03 / BOOT-03).
    web_accessible_resources: [
      {
        resources: ['injected/ls-observer.js'],
        matches: ['https://aistudio.google.com/*'],
      },
    ],
  },
  hooks: {
    // WXT treats *.ts files in entrypointsDir root as "unlisted-script" entrypoints.
    // Exclude Vitest test files so `wxt build` does not try to bundle them.
    'entrypoints:found': (_wxt, infos) => {
      const before = infos.length;
      infos.splice(
        0,
        before,
        ...infos.filter((info) => !info.inputPath.endsWith('.test.ts')),
      );
    },
  },
});

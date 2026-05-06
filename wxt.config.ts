import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.', // matches D-23 layout: src/background/, src/content/, src/popup/
  // No `modules: ['@wxt-dev/module-svelte']` in Phase 1 — Svelte is Phase 5.
  manifest: {
    name: 'AI Studio Instructions Sync',
    description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['storage', 'scripting', 'alarms'],
    host_permissions: ['https://aistudio.google.com/*'],
    // No <all_urls>, no identity, no tabs, no notifications. Matches D-19 verbatim.
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

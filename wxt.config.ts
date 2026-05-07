import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.', // matches D-23 layout: src/background/, src/content/, src/popup/
  modules: ['@wxt-dev/module-svelte'],  // Phase 5 addition (D-11)
  manifest: {
    // Pinned RSA public key — fixes extension ID across all sideloaded installs.
    // Without this, each device gets a random ID and chrome.storage.sync namespaces never overlap.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0YaECQY0yZNwfiXIjn+b02Ao/xvTqBY80wr6yzjra7ciPMjGL9wML6H1vmQUIJ/fQ3/MhzmWNWZJjWj/I+/wdrfdlztiFoFDhWVDB4T5f458XjirZUcoL5MzWFg9+qB8OPFhTM2EIDmC8DvniFR3uaGWRD4t/QXD72cG8K4fdIfkYiWc7f8/vSCGsz53rP0Trl+Boo8+GGgJAAMIMRq5pMFkf1C8GmIWwg+W+AztKZLnzoWlMjpKK44k92VxYlz9jiZWAY2YDVyB7B1LOoIbgNilEldy5cahUl6hhBgvAX5UiExz/mZm/4SlinDq+lEhFWhUWFJ7OLGwQqzAoJogpQIDAQAB',
    name: 'AI Studio Instructions Sync',
    description: 'Sync AI Studio system instructions across signed-in Chrome devices.',
    version: '0.1.0',
    minimum_chrome_version: '116',
    permissions: ['storage', 'scripting', 'alarms', 'identity', 'identity.email'],
    action: {}, // required for chrome.action API (setBadgeText, setBadgeBackgroundColor) in service worker
    oauth2: {
      client_id: '673314351848-atvo7sibd5ef405bktlcitidc36cc1g8.apps.googleusercontent.com',
      scopes: ['https://www.googleapis.com/auth/drive.appdata'],
    },
    host_permissions: ['https://aistudio.google.com/*', 'https://www.googleapis.com/*'],
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

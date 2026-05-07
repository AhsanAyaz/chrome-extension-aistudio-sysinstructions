import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  entrypointsDir: '.', // matches D-23 layout: src/background/, src/content/, src/popup/
  modules: ['@wxt-dev/module-svelte'],  // Phase 5 addition (D-11)
  manifest: {
    // Pinned RSA public key — fixes extension ID across all sideloaded installs.
    // Without this, each device gets a random ID and chrome.storage.sync namespaces never overlap.
    key: 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDNkbIIyKKCUPZofL/Xlfmv90MOroaNtKal7+670IeuAbr46DBj/AQfD2u5s2v/VUhDrirNgs2VflGuaz3AifigEsOLkOxZWPriF/wrr40t8ha0FTSE+A18tkOYqniGzCmcZ7/ECGdJK5hAAnPKzMueNtt+eHLwjza8uoN2jGVPLZE0rxiyn43IkinhRFvpuxgJAAM3rYC0rVa4T84W4ChzvIJGXYcpxEqULuaLKnWMtpoYjGDeVj8zOUgASSU6Brv6OdkECVtGNA1GVLQjeBbUVpzqeqG/jM3gwGj9YgreLa7ahMkXaEqJdHC+a6NKrItwzvFu2TN7sbu4Ua+r5/afAgMBAAECggEAW+bd1AV2eZIehxn2XjhDV0LQrNijeOihdB/u9/JDJizJ3QtYzupVIVmwjGXFS3JiCzfrFNN8e2/srnBtPA2ypEWfPF7++vbHupqEdzdVg4vuUHYGc8e9p9qIH9Febs0JcU4EsmwbWN/vgfZWs/yYr1PRDxpkMF2mV/t+WFpt1FY6lyO4M6hZOcd5m8748zo3dNyRdPbTolExXavp8UWodSeLS2U60dtb98b7rse45r4m5ZcYuAAIit2XpXWPiEAanEgPn8j2p/UKhs+ogwyO4ayF/ZdmaSZ0G06YuJI6onnTanpvhh2t7NtbIHv4YpHcjCKIdpxa2BzMGKFkYcZGoQKBgQDsMeyRo0dIoU0//i+pCNH0zXoD3OzmzLMQDsgO3RVeo9PaOF8xHrUhhdyn/RevDFzoqP8z/7/m7oCR48f+JIX47E6scL6EoOAc17Wo+MAP+BWdBHTx0aQWN80gAe8lqrPR25sJuHS0FYWkn4M1v7gbQdo5YJpJCMAO4klvGgayEQKBgQDezl37cKz9bRfZ166cpgtxna4m+XL2md2sFptUwfg1TXDBrqmtNS5fTBHRmbVJdHeGrTrCroq8laWmgXbpktq0+88F0TFATyBZSIzknGApwYN8dZWsJmF1bE5SIz1k0Jk0o5KS0EZtdeevZudxE6ae+0OhfoG6PXlDB6prjFNtrwKBgHXNxK8y38fi47OqJL1LL+TIYzXwB5xptlmo9bEsJY9paK2rdhb6uN66dD65JgnhwaktOPQHeABHLosVL9ebAdMQkYDCTtO5pW3dTLa1Mp4EX0tMQMOniw6l0EJJlKyVwlBGFsK3ZEW5gkmEYZ36PGoj4yLBAtKwcZI63ONz+KjxAoGBAK1z4t54XXP9le/VZO42pfoRUx6sW793EYeDIfHd/6kfXISrwRRCrpMp2UVfcC57KQIDohclYoRly8vQRg6YcQMsdYKF1N3Hu9tGC8l9o69eI0qlD5wxVPXhFygCnyz46Ax+uwDoe6uDepamec8iCTkDSydSIRQn/1sbgKSxXdGpAoGANfNc2qc488I8Z5mOoagMtb75C4lvcBgcvh8BYHm1cy2pmhsIQ3KdBGFuOBcSOEgU+zsNtEIGRSeXf/8EI+KF3Eai8lRLNk6JM+7+h2R09+BRrYcF+hmSnsN8IG07+gEWbRXhnWiZuJjuqOeX1MNkgigChpex4Gb26iOpvGJwaX8=',
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

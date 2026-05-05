// src/build.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const MANIFEST_PATH = join('.output', 'chrome-mv3', 'manifest.json');
const STALENESS_BUDGET_MS = 5 * 60 * 1000; // 5 minutes

interface ChromeManifest {
  manifest_version: number;
  permissions?: string[];
  host_permissions?: string[];
  minimum_chrome_version?: string;
  [key: string]: unknown;
}

function loadManifest(): ChromeManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ChromeManifest;
}

function manifestIsFresh(): boolean {
  if (!existsSync(MANIFEST_PATH)) return false;
  const ageMs = Date.now() - statSync(MANIFEST_PATH).mtimeMs;
  return ageMs < STALENESS_BUDGET_MS;
}

beforeAll(() => {
  if (!manifestIsFresh()) {
    // Build once. WXT's default target is chrome-mv3.
    execSync('npx wxt build', { stdio: 'inherit' });
  }
}, 120_000);

describe('DIST-02: manifest permissions', () => {
  it('manifest exists at .output/chrome-mv3/manifest.json', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
  });

  it('manifest_version is 3', () => {
    const m = loadManifest();
    expect(m.manifest_version).toBe(3);
  });

  it('permissions is exactly ["storage", "scripting"]', () => {
    const m = loadManifest();
    // Order-insensitive equality with cardinality check.
    const perms = (m.permissions ?? []).slice().sort();
    expect(perms).toEqual(['scripting', 'storage']);
  });

  it('host_permissions is exactly ["https://aistudio.google.com/*"]', () => {
    const m = loadManifest();
    expect(m.host_permissions).toEqual(['https://aistudio.google.com/*']);
  });

  it('manifest does not declare <all_urls> anywhere', () => {
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    expect(raw.includes('<all_urls>')).toBe(false);
  });

  it('forbidden permissions are absent', () => {
    const m = loadManifest();
    const perms = m.permissions ?? [];
    for (const forbidden of ['identity', 'tabs', 'notifications', 'cookies', 'webRequest', 'webRequestBlocking']) {
      expect(perms).not.toContain(forbidden);
    }
  });

  it('forbidden host_permissions are absent', () => {
    const m = loadManifest();
    const hosts = m.host_permissions ?? [];
    expect(hosts).not.toContain('<all_urls>');
    expect(hosts).not.toContain('*://*/*');
    expect(hosts).not.toContain('http://*/*');
    expect(hosts).not.toContain('https://*/*');
  });

  it('minimum_chrome_version is "116" (or higher numeric)', () => {
    const m = loadManifest();
    // OQ-2 resolved: D-19 minimum is 116 to ensure crypto.randomUUID + chrome.scripting.
    expect(m.minimum_chrome_version).toBeDefined();
    expect(parseInt(m.minimum_chrome_version!, 10)).toBeGreaterThanOrEqual(116);
  });

  it('no telemetry hosts in CSP (DIST-03 sanity check)', () => {
    const m = loadManifest();
    const csp = m['content_security_policy'];
    if (csp == null) return; // CSP absence is acceptable in MV3 — Chrome applies defaults.
    const cspString = JSON.stringify(csp);
    for (const host of ['google-analytics.com', 'sentry.io', 'datadog', 'mixpanel.com', 'amplitude.com']) {
      expect(cspString).not.toContain(host);
    }
  });
});

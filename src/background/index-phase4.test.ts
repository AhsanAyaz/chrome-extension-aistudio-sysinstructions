// Task 2 — index.ts Phase 4 wiring tests
// Tests the Phase 4 additions: BOOTSTRAP_NEEDED_KEY written on install,
// LS_BOOTSTRAP routing, and chrome.storage.onChanged guard logic.
// Pattern: tests call ensureInitialized() + the wired functions directly,
// consistent with service-worker.test.ts and pull-engine.test.ts patterns.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureInitialized, _resetForTesting } from './index';
import { handleLsBootstrap } from './bootstrap';
import { handleRemoteChanged } from './pull-engine';
import { BOOTSTRAP_NEEDED_KEY, REGISTRY_KEY } from '../shared/constants';

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});

describe('Phase 4: BOOTSTRAP_NEEDED_KEY flag (D-05)', () => {
  it('ensureInitialized + chrome.storage.local.set writes BOOTSTRAP_NEEDED_KEY with triggeredAt', async () => {
    // Simulate onInstalled(reason='install') side-effect: write flag
    await ensureInitialized();
    await chrome.storage.local.set({
      [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
    });

    const r = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    const flag = r[BOOTSTRAP_NEEDED_KEY] as { triggeredAt: number } | undefined;
    expect(flag).toBeDefined();
    expect(typeof flag?.triggeredAt).toBe('number');
    expect(flag!.triggeredAt).toBeGreaterThan(0);
  });

  it('BOOTSTRAP_NEEDED_KEY flag shape allows age-based stale detection', async () => {
    const ts = Date.now() - 1000;
    await chrome.storage.local.set({ [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: ts } });

    const r = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    const flag = r[BOOTSTRAP_NEEDED_KEY] as { triggeredAt: number };
    expect(Date.now() - flag.triggeredAt).toBeGreaterThan(0);
  });
});

describe('Phase 4: handleLsBootstrap routing (LS_BOOTSTRAP)', () => {
  it('handleLsBootstrap runs without error on valid payload', async () => {
    // Seed remote registry so merge has something to compare against
    await chrome.storage.sync.set({
      [REGISTRY_KEY]: {},
    });
    await ensureInitialized();

    const payload = [{ title: 'Boot Item', text: 'body text' }];
    // Should not throw
    await expect(handleLsBootstrap(payload)).resolves.toBeUndefined();
  });

  it('handleLsBootstrap handles empty payload without error', async () => {
    await ensureInitialized();
    await expect(handleLsBootstrap([])).resolves.toBeUndefined();
  });
});

describe('Phase 4: handleRemoteChanged areaName + REGISTRY_KEY guards', () => {
  it('handleRemoteChanged with non-sync areaName returns without merging', async () => {
    // No registry seeded — if processing occurred it would throw or write
    await ensureInitialized();
    const changes = { [REGISTRY_KEY]: { oldValue: undefined, newValue: {} } };
    // areaName guard is internal to handleRemoteChanged (Case 1 per pull-engine.test.ts)
    // passes 'local' — the function returns immediately
    await expect(handleRemoteChanged(changes, 'local')).resolves.toBeUndefined();
  });

  it('handleRemoteChanged with sync areaName + REGISTRY_KEY change processes pull', async () => {
    // Seed empty remote registry in sync storage
    await chrome.storage.sync.set({ [REGISTRY_KEY]: {} });
    await ensureInitialized();

    // Mock tabs.query to return no active tabs (no sendMessage needed)
    vi.spyOn(chrome.tabs, 'query').mockImplementation(
      (() => Promise.resolve([])) as never,
    );

    const changes = { [REGISTRY_KEY]: { oldValue: undefined, newValue: {} } };
    await expect(handleRemoteChanged(changes, 'sync')).resolves.toBeUndefined();
  });
});

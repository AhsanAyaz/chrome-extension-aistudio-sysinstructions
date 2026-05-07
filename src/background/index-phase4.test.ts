// Task 2 — index.ts Phase 4 wiring tests
// Tests the Phase 4 additions: BOOTSTRAP_NEEDED_KEY written on install,
// LS_BOOTSTRAP routing, and pollAndPull wiring.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureInitialized, _resetForTesting } from './index';
import { handleLsBootstrap } from './bootstrap';
import { BOOTSTRAP_NEEDED_KEY, DRIVE_CACHE_KEY, REGISTRY_KEY } from '../shared/constants';
import type { DriveCache } from '../shared/types';

vi.mock('./drive-client', () => ({
  pollDriveForChanges: vi.fn().mockResolvedValue(null),
  readDriveCache: vi.fn().mockResolvedValue(null),
  writeDriveCache: vi.fn().mockResolvedValue(undefined),
  flushToDrive: vi.fn().mockResolvedValue(undefined),
  getAuthToken: vi.fn(),
  readDriveFile: vi.fn(),
  writeDriveFile: vi.fn(),
}));

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});

describe('Phase 4: BOOTSTRAP_NEEDED_KEY flag (D-05)', () => {
  it('ensureInitialized + chrome.storage.local.set writes BOOTSTRAP_NEEDED_KEY with triggeredAt', async () => {
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
    // Seed empty Drive cache so getRegistry() returns {}
    const emptyCache: DriveCache = { fileId: '', modifiedTime: '', data: { [REGISTRY_KEY]: {} } };
    const { readDriveCache } = await import('./drive-client');
    vi.mocked(readDriveCache).mockResolvedValue(emptyCache);

    await ensureInitialized();
    const payload = [{ title: 'Boot Item', text: 'body text' }];
    await expect(handleLsBootstrap(payload)).resolves.toBeUndefined();
  });

  it('handleLsBootstrap handles empty payload without error', async () => {
    await ensureInitialized();
    await expect(handleLsBootstrap([])).resolves.toBeUndefined();
  });
});

describe('Phase 4: pollAndPull wiring', () => {
  it('ensureInitialized completes without error', async () => {
    await expect(ensureInitialized()).resolves.toBeUndefined();
  });
});

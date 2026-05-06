// Task 2 — index.ts Phase 4 wiring tests (TDD RED phase)
// Verifies chrome.storage.onChanged routes to handleRemoteChanged,
// onInstalled writes BOOTSTRAP_NEEDED_KEY on 'install', and LS_BOOTSTRAP message routes to handleLsBootstrap.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { _resetForTesting } from './index';
import { BOOTSTRAP_NEEDED_KEY, REGISTRY_KEY } from '../shared/constants';

// Spy on pull-engine and bootstrap modules so we can verify they are called.
vi.mock('./pull-engine', () => ({
  handleRemoteChanged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./bootstrap', () => ({
  handleLsBootstrap: vi.fn().mockResolvedValue(undefined),
}));

let handleRemoteChanged: ReturnType<typeof vi.fn>;
let handleLsBootstrap: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fakeBrowser.reset();
  _resetForTesting();
  const pullMod = await import('./pull-engine');
  const bootMod = await import('./bootstrap');
  handleRemoteChanged = pullMod.handleRemoteChanged as ReturnType<typeof vi.fn>;
  handleLsBootstrap = bootMod.handleLsBootstrap as ReturnType<typeof vi.fn>;
  handleRemoteChanged.mockClear();
  handleLsBootstrap.mockClear();
  // Import to register listeners (side-effectful defineBackground registration)
  await import('./index');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Phase 4 index.ts wiring', () => {
  it('chrome.runtime.onInstalled writes BOOTSTRAP_NEEDED_KEY on reason=install', async () => {
    // Trigger onInstalled with reason 'install'
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install', previousVersion: undefined });

    const r = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    const flag = r[BOOTSTRAP_NEEDED_KEY] as { triggeredAt: number } | undefined;
    expect(flag).toBeDefined();
    expect(typeof flag?.triggeredAt).toBe('number');
  });

  it('chrome.runtime.onInstalled does NOT write BOOTSTRAP_NEEDED_KEY on reason=update', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.1' });

    const r = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(r[BOOTSTRAP_NEEDED_KEY]).toBeUndefined();
  });

  it('chrome.storage.onChanged with areaName=sync and REGISTRY_KEY calls handleRemoteChanged', async () => {
    const changes = { [REGISTRY_KEY]: { oldValue: undefined, newValue: {} } };
    await fakeBrowser.storage.onChanged.trigger(changes, 'sync');

    // Wait for async chain to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(handleRemoteChanged).toHaveBeenCalledWith(changes, 'sync');
  });

  it('chrome.storage.onChanged with areaName=local does NOT call handleRemoteChanged', async () => {
    const changes = { [REGISTRY_KEY]: { oldValue: undefined, newValue: {} } };
    await fakeBrowser.storage.onChanged.trigger(changes, 'local');

    await new Promise((r) => setTimeout(r, 50));
    expect(handleRemoteChanged).not.toHaveBeenCalled();
  });

  it('chrome.storage.onChanged without REGISTRY_KEY does NOT call handleRemoteChanged', async () => {
    const changes = { 'sysins:body:abc': { oldValue: undefined, newValue: 'x' } };
    await fakeBrowser.storage.onChanged.trigger(changes, 'sync');

    await new Promise((r) => setTimeout(r, 50));
    expect(handleRemoteChanged).not.toHaveBeenCalled();
  });

  it('LS_BOOTSTRAP message routes to handleLsBootstrap', async () => {
    const payload = [{ title: 'T1', text: 'Body' }];
    const sendResponse = vi.fn();

    // Trigger onMessage with LS_BOOTSTRAP
    await fakeBrowser.runtime.onMessage.trigger(
      { type: 'LS_BOOTSTRAP', payload },
      {},
      sendResponse,
    );

    // Wait for async resolution
    await new Promise((r) => setTimeout(r, 50));
    expect(handleLsBootstrap).toHaveBeenCalledWith(payload);
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadAndAssertMeta } from './meta-guard';
import { META_KEY, SCHEMA_VERSION } from './constants';
import type { SyncMeta } from './types';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('loadAndAssertMeta (Recipe 7, D-09)', () => {
  it('returns ok=true when schemaVersion matches SCHEMA_VERSION', async () => {
    const meta: SyncMeta = { schemaVersion: 1, lastPushAt: 0, lastPullAt: 0 };
    await chrome.storage.sync.set({ [META_KEY]: meta });

    const result = await loadAndAssertMeta();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meta).toEqual(meta);
      expect(result.meta.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it('returns SCHEMA_AHEAD when remote schemaVersion is greater than SCHEMA_VERSION', async () => {
    await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: 2, lastPushAt: 0, lastPullAt: 0 } });

    const result = await loadAndAssertMeta();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.tag).toBe('SCHEMA_AHEAD');
  });

  it('returns SCHEMA_UNKNOWN when remote schemaVersion is less than SCHEMA_VERSION (D-11 v1 lock)', async () => {
    await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: 0, lastPushAt: 0, lastPullAt: 0 } });

    const result = await loadAndAssertMeta();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.tag).toBe('SCHEMA_UNKNOWN');
  });

  it('returns MALFORMED_REMOTE when meta is absent (key not present in storage)', async () => {
    // fakeBrowser.reset() in beforeEach guarantees an empty store

    const result = await loadAndAssertMeta();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.tag).toBe('MALFORMED_REMOTE');
  });

  it('returns MALFORMED_REMOTE when schemaVersion is non-numeric (string)', async () => {
    await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: '1', lastPushAt: 0, lastPullAt: 0 } });

    const result = await loadAndAssertMeta();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.tag).toBe('MALFORMED_REMOTE');
  });

  it('returns MALFORMED_REMOTE when schemaVersion is null', async () => {
    await chrome.storage.sync.set({ [META_KEY]: { schemaVersion: null, lastPushAt: 0, lastPullAt: 0 } });

    const result = await loadAndAssertMeta();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.tag).toBe('MALFORMED_REMOTE');
  });
});

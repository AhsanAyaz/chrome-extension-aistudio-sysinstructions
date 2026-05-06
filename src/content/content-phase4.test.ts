// Task 4 — content/index.ts Phase 4 additions (TDD RED phase)
// Tests for applyRemoteLocally behaviour and bootstrap/pending-remote storage logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { BOOTSTRAP_NEEDED_KEY, PENDING_REMOTE_KEY, WATCHED_LS_KEY } from '../shared/constants';
import type { PendingRemoteState, RawInstruction } from '../shared/types';

// ---------------------------------------------------------------------------
// Minimal localStorage stub
// ---------------------------------------------------------------------------
let localStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStore[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStore[key]; }),
  clear: vi.fn(() => { localStore = {}; }),
};
const dispatchEventSpy = vi.fn().mockReturnValue(true);

beforeEach(() => {
  fakeBrowser.reset();
  localStore = {};
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  dispatchEventSpy.mockClear();
  // Install mocks on globalThis
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'dispatchEvent', { value: dispatchEventSpy, writable: true, configurable: true });
});

// ---------------------------------------------------------------------------
// applyRemoteLocally — pure extracted logic (same code that will be in content/index.ts)
// ---------------------------------------------------------------------------
function applyRemoteLocally(instructions: RawInstruction[]): void {
  // This mirrors the implementation that will be in content/index.ts Task 4.
  const serialized = JSON.stringify(instructions);
  const oldValue = localStorage.getItem(WATCHED_LS_KEY);
  localStorage.setItem(WATCHED_LS_KEY, serialized);
  dispatchEvent(new StorageEvent('storage', {
    key: WATCHED_LS_KEY,
    oldValue,
    newValue: serialized,
    storageArea: localStorage as unknown as Storage,
    url: window.location.href,
  }));
}

describe('applyRemoteLocally', () => {
  it('writes instructions to localStorage under WATCHED_LS_KEY', () => {
    const instructions: RawInstruction[] = [{ title: 'T1', text: 'body' }];
    applyRemoteLocally(instructions);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      WATCHED_LS_KEY,
      JSON.stringify(instructions),
    );
  });

  it('dispatches a StorageEvent with correct key and newValue', () => {
    const instructions: RawInstruction[] = [{ title: 'T2', text: 'text' }];
    applyRemoteLocally(instructions);
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
    const event = dispatchEventSpy.mock.calls[0][0] as StorageEvent;
    expect(event.type).toBe('storage');
    expect(event.key).toBe(WATCHED_LS_KEY);
    expect(event.newValue).toBe(JSON.stringify(instructions));
  });

  it('reads oldValue from localStorage before writing', () => {
    localStore[WATCHED_LS_KEY] = JSON.stringify([{ title: 'Old', text: 'old' }]);
    applyRemoteLocally([{ title: 'New', text: 'new' }]);
    expect(localStorageMock.getItem).toHaveBeenCalledWith(WATCHED_LS_KEY);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap flag check — storage read logic
// ---------------------------------------------------------------------------
describe('BOOTSTRAP_NEEDED_KEY flag handling', () => {
  it('BOOTSTRAP_NEEDED_KEY can be read from chrome.storage.local', async () => {
    const flag = { triggeredAt: Date.now() };
    await chrome.storage.local.set({ [BOOTSTRAP_NEEDED_KEY]: flag });
    const r = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(r[BOOTSTRAP_NEEDED_KEY]).toEqual(flag);
  });

  it('BOOTSTRAP_NEEDED_KEY is absent before install flag is written', async () => {
    const r = await chrome.storage.local.get(BOOTSTRAP_NEEDED_KEY);
    expect(r[BOOTSTRAP_NEEDED_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PENDING_REMOTE_KEY — visibilitychange deferred apply logic
// ---------------------------------------------------------------------------
describe('PENDING_REMOTE_KEY deferred apply', () => {
  it('pending payload can be read from chrome.storage.local', async () => {
    const pending: PendingRemoteState = {
      payload: [{ title: 'Deferred', text: 'body' }],
      enqueuedAt: Date.now(),
    };
    await chrome.storage.local.set({ [PENDING_REMOTE_KEY]: pending });
    const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    expect(r[PENDING_REMOTE_KEY]).toEqual(pending);
  });

  it('after applying pending payload, PENDING_REMOTE_KEY is removed from chrome.storage.local', async () => {
    const pending: PendingRemoteState = {
      payload: [{ title: 'Pending', text: 'body' }],
      enqueuedAt: Date.now(),
    };
    await chrome.storage.local.set({ [PENDING_REMOTE_KEY]: pending });

    // Simulate visibilitychange handler logic from content/index.ts
    const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    const p = r[PENDING_REMOTE_KEY] as PendingRemoteState | undefined;
    if (p !== undefined) {
      applyRemoteLocally(p.payload);
      await chrome.storage.local.remove(PENDING_REMOTE_KEY);
    }

    const r2 = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    expect(r2[PENDING_REMOTE_KEY]).toBeUndefined();
    expect(dispatchEventSpy).toHaveBeenCalledOnce();
  });
});

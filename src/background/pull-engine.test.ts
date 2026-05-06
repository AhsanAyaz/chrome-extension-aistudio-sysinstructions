/**
 * TDD tests for pull-engine.ts
 * RED phase: all tests written before implementation exists.
 * Covers 6 behavior cases from the plan (PULL-01 through PULL-05).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleRemoteChanged } from './pull-engine';
import {
  REGISTRY_KEY,
  PENDING_REMOTE_KEY,
} from '../shared/constants';
import { LAST_PUSHED_KEY } from './sync-state';
import { _resetForTesting } from './index';
import type { SyncRegistry, RawInstruction } from '../shared/types';

// ---------------------------------------------------------------------------
// Test setup — mirrors push-engine.test.ts pattern
// ---------------------------------------------------------------------------

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
  _resetForTesting();
});

// Typed helper to mock chrome.tabs.query — avoids overload ambiguity with `void` return.
function mockTabsQuery(tabs: chrome.tabs.Tab[]): void {
  vi.spyOn(chrome.tabs, 'query').mockImplementation(
    // chrome.tabs.query has overloads where one returns void (callback form).
    // Cast to any to target the Promise-returning overload used in pull-engine.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (() => Promise.resolve(tabs)) as any,
  );
}

// ---------------------------------------------------------------------------
// Case 1 — areaName guard
// handleRemoteChanged called with areaName='local' → returns immediately, applyRemote NOT called
// ---------------------------------------------------------------------------
describe('Case 1: areaName guard', () => {
  it('returns immediately without merging when areaName is not sync', async () => {
    // Seed a remote registry in sync (simulating what onChanged would have)
    const remoteRegistry: SyncRegistry = {
      'uuid-0000-0000-0000-000000000001': {
        title: 'Remote Item',
        updatedAt: 1000,
        deletedAt: null,
        chunks: 0,
      },
    };

    const changes = {
      [REGISTRY_KEY]: { newValue: remoteRegistry, oldValue: undefined },
    };

    // Calling with areaName='local' should be a no-op
    await handleRemoteChanged(changes, 'local');

    // REGISTRY_KEY should NOT have been updated in chrome.storage.sync
    // (applyRemote would call chrome.storage.sync.set if it ran)
    const r = await chrome.storage.sync.get(REGISTRY_KEY);
    expect(r[REGISTRY_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 2 — REGISTRY_KEY guard
// areaName='sync' but changes has no REGISTRY_KEY → returns immediately
// ---------------------------------------------------------------------------
describe('Case 2: REGISTRY_KEY guard', () => {
  it('returns immediately when REGISTRY_KEY is not in changes', async () => {
    const changes = {
      'sysins:meta': { newValue: { schemaVersion: 1 }, oldValue: undefined },
    };

    // Should be a no-op — no sync write for registry key
    await handleRemoteChanged(changes, 'sync');

    const r = await chrome.storage.sync.get(REGISTRY_KEY);
    expect(r[REGISTRY_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 3 — happy path
// Valid remote registry → applyRemote called, reconstructInstructions called,
// chrome.tabs.sendMessage called with APPLY_REMOTE, PENDING_REMOTE_KEY NOT written
// ---------------------------------------------------------------------------
describe('Case 3: happy path — active tab receives APPLY_REMOTE message', () => {
  it('sends APPLY_REMOTE to the active AI Studio tab on successful pull', async () => {
    // Seed a remote registry with one live item
    const remoteRegistry: SyncRegistry = {
      'uuid-0000-0000-0000-000000000001': {
        title: 'Item A',
        updatedAt: 2000,
        deletedAt: null,
        chunks: 1,
      },
    };

    // Seed the body chunk so reconstructInstructions can read it
    await fakeBrowser.storage.sync.set({
      [REGISTRY_KEY]: remoteRegistry,
      'sysins:body:uuid-0000-0000-0000-000000000001:c0': JSON.stringify({ text: 'body A' }),
    });

    const tabId = 42;
    mockTabsQuery([{ id: tabId, url: 'https://aistudio.google.com/app/prompts' } as chrome.tabs.Tab]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sendMessageSpy = vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((() => Promise.resolve(undefined)) as any);

    const changes = {
      [REGISTRY_KEY]: { newValue: remoteRegistry, oldValue: undefined },
    };
    await handleRemoteChanged(changes, 'sync');

    // sendMessage must have been called with APPLY_REMOTE
    expect(sendMessageSpy).toHaveBeenCalledOnce();
    const [calledTabId, calledMsg] = sendMessageSpy.mock.calls[0]!;
    expect(calledTabId).toBe(tabId);
    expect((calledMsg as { type: string }).type).toBe('APPLY_REMOTE');
    expect(Array.isArray((calledMsg as { payload: unknown }).payload)).toBe(true);

    // PENDING_REMOTE_KEY should NOT be written
    const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    expect(r[PENDING_REMOTE_KEY]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Case 4 — no active tab
// chrome.tabs.query returns [] → PENDING_REMOTE_KEY written to chrome.storage.local
// ---------------------------------------------------------------------------
describe('Case 4: no active tab — falls through to pendingRemote queue', () => {
  it('writes PENDING_REMOTE_KEY when no active AI Studio tab is found', async () => {
    const remoteRegistry: SyncRegistry = {
      'uuid-0000-0000-0000-000000000002': {
        title: 'Item B',
        updatedAt: 3000,
        deletedAt: null,
        chunks: 1,
      },
    };

    await fakeBrowser.storage.sync.set({
      [REGISTRY_KEY]: remoteRegistry,
      'sysins:body:uuid-0000-0000-0000-000000000002:c0': JSON.stringify({ text: 'body B' }),
    });

    // No tabs open
    mockTabsQuery([]);

    const changes = {
      [REGISTRY_KEY]: { newValue: remoteRegistry, oldValue: undefined },
    };
    await handleRemoteChanged(changes, 'sync');

    const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    const pending = r[PENDING_REMOTE_KEY] as { payload: RawInstruction[]; enqueuedAt: number };
    expect(pending).toBeDefined();
    expect(Array.isArray(pending.payload)).toBe(true);
    expect(pending.payload.length).toBeGreaterThan(0);
    expect(typeof pending.enqueuedAt).toBe('number');
    expect(pending.enqueuedAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Case 5 — sendMessage throws
// chrome.tabs.sendMessage throws → falls through to PENDING_REMOTE_KEY path
// ---------------------------------------------------------------------------
describe('Case 5: sendMessage throws — falls through to pendingRemote queue', () => {
  it('writes PENDING_REMOTE_KEY when sendMessage rejects', async () => {
    const remoteRegistry: SyncRegistry = {
      'uuid-0000-0000-0000-000000000003': {
        title: 'Item C',
        updatedAt: 4000,
        deletedAt: null,
        chunks: 1,
      },
    };

    await fakeBrowser.storage.sync.set({
      [REGISTRY_KEY]: remoteRegistry,
      'sysins:body:uuid-0000-0000-0000-000000000003:c0': JSON.stringify({ text: 'body C' }),
    });

    const tabId = 99;
    mockTabsQuery([{ id: tabId, url: 'https://aistudio.google.com/app/prompts' } as chrome.tabs.Tab]);
    // sendMessage throws (content script not ready, tab navigating away, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((() => Promise.reject(
      new Error('Could not establish connection. Receiving end does not exist.'),
    )) as any);

    const changes = {
      [REGISTRY_KEY]: { newValue: remoteRegistry, oldValue: undefined },
    };
    await handleRemoteChanged(changes, 'sync');

    const r = await chrome.storage.local.get(PENDING_REMOTE_KEY);
    const pending = r[PENDING_REMOTE_KEY] as { payload: RawInstruction[]; enqueuedAt: number };
    expect(pending).toBeDefined();
    expect(Array.isArray(pending.payload)).toBe(true);
    expect(typeof pending.enqueuedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Case 6 — D-04 loop guard
// After successful delivery, LAST_PUSHED_KEY is updated in chrome.storage.local
// ---------------------------------------------------------------------------
describe('Case 6: D-04 loop guard — LAST_PUSHED_KEY updated after delivery', () => {
  it('writes LAST_PUSHED_KEY to chrome.storage.local after successful pull', async () => {
    const remoteRegistry: SyncRegistry = {
      'uuid-0000-0000-0000-000000000004': {
        title: 'Item D',
        updatedAt: 5000,
        deletedAt: null,
        chunks: 1,
      },
    };

    await fakeBrowser.storage.sync.set({
      [REGISTRY_KEY]: remoteRegistry,
      'sysins:body:uuid-0000-0000-0000-000000000004:c0': JSON.stringify({ text: 'body D' }),
    });

    mockTabsQuery([{ id: 11, url: 'https://aistudio.google.com/app/prompts' } as chrome.tabs.Tab]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation((() => Promise.resolve(undefined)) as any);

    const changes = {
      [REGISTRY_KEY]: { newValue: remoteRegistry, oldValue: undefined },
    };
    await handleRemoteChanged(changes, 'sync');

    // LAST_PUSHED_KEY must be written after delivery
    const r = await chrome.storage.local.get(LAST_PUSHED_KEY);
    const snapshot = r[LAST_PUSHED_KEY] as Record<string, { titleHash: string; bodyHash: string; updatedAt: number }>;
    expect(snapshot).toBeDefined();
    // Should have at least one entry (the uuid we seeded)
    const uuids = Object.keys(snapshot);
    expect(uuids.length).toBeGreaterThan(0);
    const entry = snapshot[uuids[0]!]!;
    expect(typeof entry.titleHash).toBe('string');
    expect(typeof entry.bodyHash).toBe('string');
    expect(typeof entry.updatedAt).toBe('number');
  });
});

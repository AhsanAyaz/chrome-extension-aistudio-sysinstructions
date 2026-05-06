// Task 3 — account-preflight.ts tests (TDD RED phase)
// Tests extractPageEmail parsing and checkAccountMismatch pre-flight logic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { _resetForTesting } from './index';
import { SYNC_STATUS_KEY } from './sync-state';
import type { SyncStatus } from '../shared/types';

beforeEach(() => {
  fakeBrowser.reset();
  _resetForTesting();
  vi.spyOn(chrome.action, 'setBadgeText').mockResolvedValue(undefined);
  vi.spyOn(chrome.action, 'setBadgeBackgroundColor').mockResolvedValue(undefined);
});

describe('extractPageEmail', () => {
  it('parses email from "Google Account: Full Name (email@example.com)"', async () => {
    const { extractPageEmail } = await import('./account-preflight');
    const result = extractPageEmail('Google Account: Muhammad Ahsan Ayaz (Ahsan.ubitian@gmail.com)');
    expect(result).toBe('Ahsan.ubitian@gmail.com');
  });

  it('parses email from short name format', async () => {
    const { extractPageEmail } = await import('./account-preflight');
    const result = extractPageEmail('Google Account: Jane Doe (jane@example.com)');
    expect(result).toBe('jane@example.com');
  });

  it('returns null for unrecognised format', async () => {
    const { extractPageEmail } = await import('./account-preflight');
    expect(extractPageEmail('not a google account string')).toBeNull();
    expect(extractPageEmail('')).toBeNull();
    expect(extractPageEmail('Google Account: Name')).toBeNull();
  });
});

describe('checkAccountMismatch', () => {
  it('returns false (no mismatch) when pageEmail is undefined', async () => {
    const { checkAccountMismatch } = await import('./account-preflight');
    const result = await checkAccountMismatch(undefined);
    expect(result).toBe(false);
  });

  it('returns false (no mismatch) when pageEmail is empty string', async () => {
    const { checkAccountMismatch } = await import('./account-preflight');
    const result = await checkAccountMismatch('');
    expect(result).toBe(false);
  });

  it('returns false when chrome.identity returns empty email (identity unavailable)', async () => {
    vi.spyOn(chrome.identity, 'getProfileUserInfo').mockResolvedValue({
      email: '',
      id: '',
    });
    const { checkAccountMismatch } = await import('./account-preflight');
    const result = await checkAccountMismatch('user@example.com');
    expect(result).toBe(false);
  });

  it('returns true and sets ACCOUNT_MISMATCH when emails differ', async () => {
    vi.spyOn(chrome.identity, 'getProfileUserInfo').mockResolvedValue({
      email: 'chrome@example.com',
      id: 'abc123',
    });
    const { checkAccountMismatch } = await import('./account-preflight');
    const result = await checkAccountMismatch('page@example.com');
    expect(result).toBe(true);

    const r = await chrome.storage.local.get(SYNC_STATUS_KEY);
    const status = r[SYNC_STATUS_KEY] as SyncStatus;
    expect(status.state).toBe('error');
    expect(status.errorState).toBe('ACCOUNT_MISMATCH');
  });

  it('returns false (no mismatch) and clears ACCOUNT_MISMATCH when emails match', async () => {
    // Pre-seed an ACCOUNT_MISMATCH error state
    await chrome.storage.local.set({
      [SYNC_STATUS_KEY]: { state: 'error', lastSyncAt: 0, errorState: 'ACCOUNT_MISMATCH' } satisfies SyncStatus,
    });
    vi.spyOn(chrome.identity, 'getProfileUserInfo').mockResolvedValue({
      email: 'same@example.com',
      id: 'xyz',
    });
    const { checkAccountMismatch } = await import('./account-preflight');
    const result = await checkAccountMismatch('same@example.com');
    expect(result).toBe(false);

    const r = await chrome.storage.local.get(SYNC_STATUS_KEY);
    const status = r[SYNC_STATUS_KEY] as SyncStatus;
    expect(status.state).toBe('idle');
  });
});

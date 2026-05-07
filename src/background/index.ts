import { defineBackground } from 'wxt/utils/define-background';
import { initializeMeta } from './meta-bootstrap';
import {
  readSyncPending,
  clearSyncPending,
} from './sync-state';
import { PENDING_BATCH_TTL_MS, FLUSH_ALARM_NAME, BOOTSTRAP_NEEDED_KEY, WATCHED_LS_KEY } from '../shared/constants';
import { handleLsChanged } from './message-handler';
import { flushPendingWrite } from './alarm-flush';
import { handleLsBootstrap } from './bootstrap';
import { diffAndAccumulate, importItems } from './push-engine';
import { pollAndPull, pullFromCache } from './pull-engine';
import { isValidPayload } from '../shared/guard';
import type { RawInstruction } from '../shared/types';

let inMemoryState: { initialized: boolean } = { initialized: false };

export async function ensureInitialized(): Promise<void> {
  if (inMemoryState.initialized) return;

  const pending = await readSyncPending();
  if (pending !== undefined) {
    const ageMs = Date.now() - pending.startedAt;
    if (ageMs > PENDING_BATCH_TTL_MS) {
      await clearSyncPending();
    }
  }

  inMemoryState.initialized = true;
}

export function _resetForTesting(): void {
  inMemoryState = { initialized: false };
}

export default defineBackground(() => {
  console.log('[sysins] extension ID:', chrome.runtime.id);

  chrome.runtime.onInstalled.addListener(async (details) => {
    await initializeMeta();
    await ensureInitialized();
    if (details.reason === 'install') {
      await chrome.storage.local.set({
        [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'LS_CHANGED') {
      if (!Array.isArray(message.payload)) {
        sendResponse({ ok: false, error: 'invalid payload' });
        return true;
      }
      ensureInitialized()
        .then(() => handleLsChanged(message.payload as RawInstruction[], message.pageEmail as string | undefined))
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    if (message?.type === 'LS_BOOTSTRAP') {
      if (!Array.isArray(message.payload)) {
        sendResponse({ ok: false, error: 'invalid payload' });
        return true;
      }
      ensureInitialized()
        .then(() => handleLsBootstrap(message.payload as RawInstruction[]))
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    if (message?.type === 'PUSH_NOW') {
      void ensureInitialized().then(async () => {
        const tabs = await chrome.tabs.query({ url: '*://aistudio.google.com/*' });
        const tab = tabs[0];
        if (tab?.id !== undefined) {
          try {
            const resp = await chrome.tabs.sendMessage(tab.id, { type: 'READ_LS_NOW' }) as { raw: string | null } | undefined;
            if (resp?.raw && isValidPayload(resp.raw)) {
              await diffAndAccumulate(JSON.parse(resp.raw) as RawInstruction[]);
            }
          } catch {
            // Fall through and flush whatever is pending
          }
        }
        await flushPendingWrite();
      });
      return false;
    }

    // PULL_NOW: poll Drive for fresh data, then deliver to tab.
    if (message?.type === 'PULL_NOW') {
      void ensureInitialized().then(async () => {
        // Try to fetch fresh data from Drive; if unchanged, re-deliver from cache.
        const newCache = await import('./drive-client').then(m => m.pollDriveForChanges(true));
        if (newCache !== null) {
          // Cache was updated — reconstruct and deliver
          const { reconstructInstructions } = await import('./registry');
          const { deliverToTab } = await import('./pull-engine');
          const { LAST_PUSHED_KEY } = await import('./sync-state');
          const { shortHash } = await import('./hash');
          const merged = await reconstructInstructions();
          const payload: RawInstruction[] = merged.map(({ title, text }) => ({ title, text }));
          console.log('[sysins] pull-engine: applied', payload.length, 'item(s) from remote');
          await deliverToTab(payload);
          // D-04 loop guard
          const entries = await Promise.all(
            merged.map(async ({ uuid, title, text }) => {
              const bodyJson = JSON.stringify({ text });
              const [titleHash, bodyHash] = await Promise.all([shortHash(title), shortHash(bodyJson)]);
              return [uuid, { titleHash, bodyHash, updatedAt: Date.now() }] as const;
            }),
          );
          const snapshot: Record<string, unknown> = {};
          for (const [uuid, entry] of entries) snapshot[uuid] = entry;
          await chrome.storage.local.set({ [LAST_PUSHED_KEY]: snapshot });
        } else {
          // No remote change — re-deliver from cache
          await pullFromCache();
        }
      });
      return false;
    }

    if (message?.type === 'IMPORT_ITEMS') {
      if (!Array.isArray(message.payload)) return false;
      void ensureInitialized()
        .then(() => importItems(message.payload as RawInstruction[]))
        .then(() => flushPendingWrite());
      return false;
    }
  });

  // Alarm: flush pending write AND poll Drive for remote changes every 30s.
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== FLUSH_ALARM_NAME) return;
    await flushPendingWrite();
    await pollAndPull();
  });

  // No chrome.storage.onChanged needed — Drive polling replaces sync push notifications.
});

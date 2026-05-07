import { defineBackground } from 'wxt/utils/define-background';
import { initializeMeta } from './meta-bootstrap';
import {
  readSyncPending,
  clearSyncPending,
} from './sync-state';
import { PENDING_BATCH_TTL_MS, FLUSH_ALARM_NAME, REGISTRY_KEY, BOOTSTRAP_NEEDED_KEY, WATCHED_LS_KEY } from '../shared/constants';
import { handleLsChanged } from './message-handler';
import { flushPendingWrite } from './alarm-flush';
import { handleRemoteChanged } from './pull-engine';       // Phase 4
import { handleLsBootstrap } from './bootstrap';           // Phase 4
import { diffAndAccumulate, importItems } from './push-engine'; // Phase 5
import { isValidPayload } from '../shared/guard';
import type { RawInstruction } from '../shared/types';

/**
 * Module-level ephemeral state. Lost on real SW kill (which is the entire
 * reason FND-06 / D-12-D-15 mirror sync state to chrome.storage.local).
 * The `_resetForTesting` export simulates that loss for FND-06's restart test.
 */
let inMemoryState: { initialized: boolean } = { initialized: false };

/**
 * SW-wake recovery. Idempotent — safe to call from multiple entrypoints.
 *
 * Phase 1 responsibility:
 *   - Detect an orphaned `sysins:local:syncPending` sentinel (startedAt
 *     older than PENDING_BATCH_TTL_MS = 60s) and clear it (D-13).
 *
 * Phase 3+ extends this to:
 *   - Re-derive sync state from registry on orphan detected
 *   - Drain `sysins:local:pendingMerges` if non-empty
 *
 * Decision: orphan recovery does NOT call setErrorState — it's an expected
 * recovery path on SW restart, not a user-facing error. Phase 3 may add a
 * recovery-log surface if visibility is needed.
 */
export async function ensureInitialized(): Promise<void> {
  if (inMemoryState.initialized) return;

  const pending = await readSyncPending();
  if (pending !== undefined) {
    const ageMs = Date.now() - pending.startedAt;
    if (ageMs > PENDING_BATCH_TTL_MS) {
      // Orphaned: another SW instance died mid-write more than 60s ago.
      // Clear the sentinel; Phase 3 will redrive any necessary push from
      // a fresh registry read.
      await clearSyncPending();
    }
    // else: a sibling SW instance may still be writing — back off.
    // Phase 3 will add the back-off retry; Phase 1 just observes.
  }

  inMemoryState.initialized = true;
}

/**
 * @internal Testing seam (Pattern S-4) — clears module-level state to
 * simulate a real service-worker kill. Tests call this before re-running
 * `ensureInitialized()` to verify FND-06's restart-resume contract.
 */
export function _resetForTesting(): void {
  inMemoryState = { initialized: false };
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(async (details) => {
    await initializeMeta();
    await ensureInitialized();
    // Phase 4 (D-05): write bootstrap trigger flag on fresh install only.
    // Not on update — would re-trigger bootstrap on every extension update.
    if (details.reason === 'install') {
      await chrome.storage.local.set({
        [BOOTSTRAP_NEEDED_KEY]: { triggeredAt: Date.now() },
      });
    }
  });

  // Phase 2: LS_CHANGED handler
  // D-03: ensureInitialized is called before handleLsChanged on every SW wake
  // triggered by a content script message — ensures orphan recovery runs.
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
      return true; // keep port open for async response (Pitfall 2 — required for async handlers)
    }

    // Phase 4: LS_BOOTSTRAP message — first-install union merge.
    // CS sends raw localStorage snapshot when BOOTSTRAP_NEEDED_KEY is present.
    if (message?.type === 'LS_BOOTSTRAP') {
      if (!Array.isArray(message.payload)) {
        sendResponse({ ok: false, error: 'invalid payload' });
        return true;
      }
      ensureInitialized()
        .then(() => handleLsBootstrap(message.payload as RawInstruction[]))
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // keep port open for async response
    }
    // Phase 5: PUSH_NOW — read current localStorage from AI Studio tab, diff, then flush (UI-03).
    // D-04: fire-and-forget. Fallback: if no tab is found or READ_LS_NOW fails, flush whatever
    // is already pending (preserves the original bypass-debounce behaviour).
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
            // Tab not ready — fall through and flush whatever is pending.
          }
        }
        await flushPendingWrite();
      });
      return false;
    }

    // Phase 5: PULL_NOW — force a fresh pull by re-triggering handleRemoteChanged (UI-04)
    // Pass current registry as "new value" — handleRemoteChanged re-runs the full pull path.
    // D-04: fire-and-forget, return false
    if (message?.type === 'PULL_NOW') {
      void ensureInitialized().then(async () => {
        const r = await chrome.storage.sync.get(REGISTRY_KEY);
        const fakeChanges: Record<string, chrome.storage.StorageChange> = {
          [REGISTRY_KEY]: { newValue: r[REGISTRY_KEY] ?? {} } as chrome.storage.StorageChange,
        };
        await handleRemoteChanged(fakeChanges, 'sync');
      });
      return false;
    }

    // Phase 5: IMPORT_ITEMS — route imported instructions through the standard merge path (EXPORT-02)
    // D-09: same path as live LS_CHANGED; diffAndAccumulate assigns UUIDs + accumulates pending write.
    // flushPendingWrite() called directly (not scheduleFlush) — import is a user-explicit action.
    // D-04: fire-and-forget, return false
    if (message?.type === 'IMPORT_ITEMS') {
      if (!Array.isArray(message.payload)) return false;
      void ensureInitialized()
        .then(() => importItems(message.payload as RawInstruction[]))
        .then(() => flushPendingWrite());
      return false;
    }

    // return undefined for unhandled message types — Chrome closes port immediately
  });

  // Phase 3: alarm flush listener
  // chrome.alarms.onAlarm fires when the 30s debounce window closes.
  // FLUSH_ALARM_NAME = 'sysins-flush' (constants.ts).
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== FLUSH_ALARM_NAME) return;
    await flushPendingWrite();
  });

  // Phase 4: pull engine wake — fires when Chrome sync delivers remote data.
  // Guard: areaName === 'sync' AND REGISTRY_KEY in changes (prevents re-pull on own push writes).
  // Pitfall 1 guard: onChanged fires for local writes too — the areaName+key guards prevent
  // processing the SW's own push writes.
  chrome.storage.onChanged.addListener(
    (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'sync') return;
      if (!(REGISTRY_KEY in changes)) return;
      void ensureInitialized().then(() => handleRemoteChanged(changes, areaName));
    }
  );

  // Phase 5+ boundary:
  //   - Popup message handler (Phase 5)
});

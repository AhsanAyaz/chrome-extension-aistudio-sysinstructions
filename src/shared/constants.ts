// Single source of truth for all sysins:* storage key names and numeric constants.
// D-24: Magic numbers are forbidden inline anywhere in src/. Every other module imports from here.
// CLAUDE.md hard rule 1: Storage namespace sysins:* is frozen — never write outside it.

export const KEY_PREFIX = 'sysins:';
export const LOCAL_KEY_PREFIX = 'sysins:local:';
export const META_KEY = 'sysins:meta';
export const REGISTRY_KEY = 'sysins:registry';
export const BODY_KEY_PREFIX = 'sysins:body:';
export const CHUNK_BUDGET_BYTES = 7000;
export const SCHEMA_VERSION = 1;
export const PENDING_BATCH_TTL_MS = 60_000;
export const PENDING_MERGE_QUEUE_CAP = 10;
export const TOMBSTONE_GC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Key under sysins:local:* for the Phase 2 observed snapshot.
// Phase 3 reads this key as the initial diff baseline.
export const LAST_OBSERVED_KEY = 'sysins:local:lastObserved';

// The localStorage key AI Studio uses for system instructions.
// Cannot be imported by the MAIN-world injector (no module system there) —
// that file uses a hardcoded literal with a comment pointing here.
export const WATCHED_LS_KEY = 'aistudio_all_system_instructions';

// Phase 3: pending write batch key (persisted to chrome.storage.local across SW kill — D-13/FND-06)
// Stores the full key→value batch for the next sync flush.
export const PENDING_WRITE_KEY = `${LOCAL_KEY_PREFIX}pendingWrite`;

// Phase 3: name of the debounce alarm (PUSH-07, Hard Rule 3).
// sysins-flush fires after 30 seconds (delayInMinutes: 0.5, Chrome 120+ minimum).
export const FLUSH_ALARM_NAME = 'sysins-flush';

// Phase 4: bootstrap trigger flag (D-05).
// Written by SW onInstalled(reason='install'); cleared by SW after successful union merge.
// Content script reads this key on first page load — never clears it (Pitfall 3 guard).
export const BOOTSTRAP_NEEDED_KEY = `${LOCAL_KEY_PREFIX}bootstrapNeeded`;

// Phase 4: deferred remote payload for no-active-tab fallback (D-08).
// Written by SW when no active AI Studio tab is found after a remote pull.
// Content script reads and clears on visibilitychange when tab regains focus.
export const PENDING_REMOTE_KEY = `${LOCAL_KEY_PREFIX}pendingRemote`;

// Tombstone eligibility baseline — written ONLY by push flush (alarm-flush.ts).
// Distinct from LAST_PUSHED_KEY, which is also written by the pull engine (D-04 loop guard).
// diffAndAccumulate uses this key to determine which items this device has locally pushed.
export const PUSH_BASELINE_KEY = 'sysins:local:pushBaseline';

// Google Drive AppData sync backend (replaces chrome.storage.sync for cross-device sync).
// Drive file: single JSON blob in the extension's private AppData folder.
// Cache: Drive file content stored locally so getRegistry() + popup read don't hit Drive per-call.
export const DRIVE_FILE_NAME = 'sysins-data.json';
export const DRIVE_CACHE_KEY = `${LOCAL_KEY_PREFIX}driveCache`;
export const META_LOCAL_KEY = `${LOCAL_KEY_PREFIX}meta`;

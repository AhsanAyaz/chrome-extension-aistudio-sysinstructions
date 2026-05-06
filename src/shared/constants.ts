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

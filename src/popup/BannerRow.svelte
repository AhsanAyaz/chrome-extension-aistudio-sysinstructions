<script lang="ts">
  import type { SyncStatus, ErrorState } from '../shared/types';

  let { syncStatus, showRefreshHint, dismissHint }: {
    syncStatus: SyncStatus;
    showRefreshHint: boolean;
    dismissHint: () => void;
  } = $props();

  const ERROR_COPY: Record<ErrorState, string> = {
    QUOTA_EXCEEDED: 'Sync storage is full. Delete unused instructions to free space.',
    RATE_LIMITED: 'Sync rate limit hit. Will retry automatically in 1 minute.',
    SCHEMA_AHEAD: 'Remote data uses a newer schema. Update the extension to continue syncing.',
    SCHEMA_UNKNOWN: 'Remote data schema is unrecognised. Sync paused to protect your data.',
    MALFORMED_REMOTE: 'Remote sync data is corrupted. Try a manual Pull or re-install on the other device.',
    ACCOUNT_MISMATCH: "AI Studio account doesn't match your Chrome profile. Sign in to the same account to resume sync.",
    OVERSIZED_ITEM: 'One instruction is too large to sync (exceeds chunk budget). Shorten it to continue.',
    STRICT_VALIDATION_FAIL: 'An unexpected sync error occurred. Check the DevTools console for details.',
    PENDING_MERGE_OVERFLOW: 'Too many remote changes queued. Some older changes were skipped to prevent data loss.',
  };

  let isError = $derived(syncStatus.state === 'error' && !!syncStatus.errorState);
  let errorCopy = $derived(
    isError && syncStatus.errorState ? ERROR_COPY[syncStatus.errorState] : ''
  );
</script>

{#if isError}
  <div class="banner banner-error">
    <svg class="banner-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6.5" cy="6.5" r="5.5" stroke="var(--error)" stroke-width="1.2"/>
      <path d="M6.5 4v3" stroke="var(--error)" stroke-width="1.3" stroke-linecap="round"/>
      <circle cx="6.5" cy="9" r="0.65" fill="var(--error)"/>
    </svg>
    <span class="banner-text">{errorCopy}</span>
  </div>
{:else if showRefreshHint}
  <div class="banner banner-hint">
    <svg class="banner-icon" width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6.5" cy="6.5" r="5.5" stroke="var(--warn)" stroke-width="1.2"/>
      <path d="M6.5 4v3" stroke="var(--warn)" stroke-width="1.3" stroke-linecap="round"/>
      <circle cx="6.5" cy="9" r="0.65" fill="var(--warn)"/>
    </svg>
    <span class="banner-text">Pull applied — refresh AI Studio to see changes.</span>
    <button class="dismiss-btn" onclick={dismissHint} aria-label="Dismiss">
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
{/if}

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
  }

  .banner-error {
    border-left: 3px solid var(--error);
    background: var(--error-bg);
    padding-left: 11px;
  }

  .banner-hint {
    border-left: 3px solid var(--warn);
    background: var(--warn-bg);
    padding-left: 11px;
  }

  .banner-icon {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .banner-text {
    font-size: 12.5px;
    color: var(--text);
    line-height: 1.5;
    flex: 1;
    opacity: 0.9;
  }

  .dismiss-btn {
    width: 18px;
    height: 18px;
    min-width: 18px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--muted);
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
    margin-top: 1px;
    transition: color var(--t), background var(--t);
  }

  .dismiss-btn:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }
</style>

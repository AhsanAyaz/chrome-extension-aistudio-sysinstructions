<script lang="ts">
  import type { SyncStatus, ErrorState } from '../shared/types';

  let { syncStatus, showRefreshHint, dismissHint }: {
    syncStatus: SyncStatus;
    showRefreshHint: boolean;
    dismissHint: () => void;
  } = $props();

  // UI-SPEC Error State Copy — all 9 ErrorState values covered
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

  // Derived: which banner to show
  let isError = $derived(syncStatus.state === 'error' && !!syncStatus.errorState);
  let errorCopy = $derived(
    isError && syncStatus.errorState ? ERROR_COPY[syncStatus.errorState] : ''
  );
</script>

<!-- UI-SPEC Error/Hint Banner section -->
{#if isError}
  <!-- Error banner: red border + tint -->
  <div class="banner banner-error">
    <span class="banner-text">{errorCopy}</span>
  </div>
{:else if showRefreshHint}
  <!-- Refresh hint (PULL-03): amber border + tint, dismissable -->
  <!-- UI-SPEC: "Pull applied — refresh AI Studio to see changes." -->
  <div class="banner banner-hint">
    <span class="banner-text">Pull applied — refresh AI Studio to see changes.</span>
    <button class="dismiss-btn" onclick={dismissHint} aria-label="Dismiss">×</button>
  </div>
{/if}

<style>
  /* UI-SPEC Banner: 100% width, 8px padding, 1px border */
  .banner {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 8px;
    border-radius: 4px;
    width: 100%;
    word-break: break-word;
  }

  /* UI-SPEC: Error — 1px solid #EF4444, #FEF2F2 tint */
  .banner-error {
    border: 1px solid #ef4444;
    background: #fef2f2;
  }

  /* UI-SPEC: Hint — 1px solid #F59E0B, #FFFBEB tint */
  .banner-hint {
    border: 1px solid #f59e0b;
    background: #fffbeb;
  }

  .banner-text {
    font-size: 11px;
    font-weight: 400;
    color: #111827;
    line-height: 1.4;
    flex: 1;
  }

  /* UI-SPEC: Dismiss button 20×20px, positioned top-right */
  .dismiss-btn {
    width: 20px;
    height: 20px;
    min-width: 20px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 14px;
    color: #6b7280;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .dismiss-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }
</style>

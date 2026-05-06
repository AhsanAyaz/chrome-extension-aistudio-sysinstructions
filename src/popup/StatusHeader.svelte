<script lang="ts">
  import type { SyncStatus } from '../shared/types';
  import { relativeTime } from './relativeTime';

  // Svelte 5 props — NOT `export let` (Svelte 4)
  let { syncStatus, itemCount }: { syncStatus: SyncStatus; itemCount: number } = $props();

  // State label per UI-SPEC Copywriting Contract
  const STATE_LABEL: Record<string, string> = {
    idle: 'Idle',
    syncing: 'Syncing…', // "Syncing…"
    error: 'Error',
  };

  // Instruction count copy per UI-SPEC Copywriting Contract
  function countLabel(n: number): string {
    if (n === 0) return 'No instructions yet';
    if (n === 1) return '1 instruction';
    return `${n} instructions`;
  }

  // Last sync display per UI-SPEC Status Header section
  function lastSyncLabel(lastSyncAt: number): string {
    if (lastSyncAt === 0) return 'Never synced';
    return `Last sync: ${relativeTime(lastSyncAt)}`;
  }
</script>

<div class="status-header">
  <div class="status-row">
    <span class="state-label state-{syncStatus.state}">{STATE_LABEL[syncStatus.state] ?? 'Idle'}</span>
    <span class="count-label">{countLabel(itemCount)}</span>
  </div>
  <div class="last-sync">{lastSyncLabel(syncStatus.lastSyncAt)}</div>
</div>

<style>
  /* UI-SPEC Typography: Heading 14px/600, Status text 13px/600, Label 11px/400 */
  .status-header {
    display: flex;
    flex-direction: column;
    gap: 4px; /* xs */
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .state-label {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    color: #111827;
  }

  /* UI-SPEC: error state uses red destructive color */
  .state-error {
    color: #ef4444;
  }

  .count-label {
    font-size: 13px;
    font-weight: 400;
    color: #6b7280; /* text secondary */
    line-height: 1.5;
  }

  .last-sync {
    font-size: 11px;
    font-weight: 400;
    color: #6b7280;
    line-height: 1.4;
  }
</style>

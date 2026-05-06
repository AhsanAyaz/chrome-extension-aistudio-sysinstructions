<script lang="ts">
  import type { SyncStatus } from '../shared/types';
  import { relativeTime } from './relativeTime';

  let { syncStatus, itemCount }: { syncStatus: SyncStatus; itemCount: number } = $props();

  function countLabel(n: number): string {
    if (n === 0) return '0 instructions';
    if (n === 1) return '1 instruction';
    return `${n} instructions`;
  }

  function lastSyncLabel(lastSyncAt: number): string {
    if (lastSyncAt === 0) return 'never synced';
    return relativeTime(lastSyncAt);
  }

  let stateClass = $derived(`dot dot-${syncStatus.state}`);
  let stateLabel = $derived(
    syncStatus.state === 'idle' ? 'idle'
    : syncStatus.state === 'syncing' ? 'syncing'
    : 'error'
  );
</script>

<header class="status-header">
  <div class="top-line"></div>
  <div class="header-body">
    <div class="wordmark">
      <svg class="logo-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="7" cy="7" r="5.5" stroke="var(--accent)" stroke-width="1.25"/>
        <path d="M4.5 7h5M7 4.5v5" stroke="var(--accent)" stroke-width="1.25" stroke-linecap="round"/>
      </svg>
      <span class="wordmark-text">AI STUDIO SYNC</span>
    </div>
    <div class="status-pill">
      <span class={stateClass}></span>
      <span class="state-label state-{syncStatus.state}">{stateLabel}</span>
    </div>
  </div>
  <div class="meta-row">
    <span class="count">{countLabel(itemCount)}</span>
    <span class="last-sync">
      <span class="meta-label">last sync</span>
      <span class="meta-value">{lastSyncLabel(syncStatus.lastSyncAt)}</span>
    </span>
  </div>
</header>

<style>
  .status-header {
    position: relative;
    padding: 0;
  }

  .top-line {
    height: 2px;
    background: linear-gradient(90deg, var(--accent) 0%, var(--violet) 100%);
  }

  .header-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 6px;
  }

  .wordmark {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .logo-icon {
    flex-shrink: 0;
  }

  .wordmark-text {
    font-family: var(--mono);
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--accent);
    text-transform: uppercase;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 3px 10px 3px 7px;
  }

  /* Pulsing status dot */
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-idle {
    background: var(--accent);
    box-shadow: 0 0 0 0 var(--accent-glow);
    animation: pulse-idle 2.5s ease-in-out infinite;
  }

  .dot-syncing {
    background: var(--violet);
    box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.4);
    animation: pulse-sync 1s ease-in-out infinite;
  }

  .dot-error {
    background: var(--error);
  }

  @keyframes pulse-idle {
    0%, 100% { box-shadow: 0 0 0 0 var(--accent-glow); }
    50% { box-shadow: 0 0 0 4px transparent; }
  }

  @keyframes pulse-sync {
    0%, 100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.4); transform: scale(1); }
    50% { box-shadow: 0 0 0 3px transparent; transform: scale(1.15); }
  }

  .state-label {
    font-family: var(--mono);
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
  }

  .state-idle { color: var(--accent); }
  .state-syncing { color: var(--violet); }
  .state-error { color: var(--error); }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px 10px;
    border-bottom: 1px solid var(--border);
  }

  .count {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.02em;
  }

  .last-sync {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .meta-label {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.02em;
  }

  .meta-value {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.02em;
  }
</style>

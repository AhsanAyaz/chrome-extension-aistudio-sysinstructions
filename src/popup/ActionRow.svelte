<script lang="ts">
  let { pushNow, pullNow, isSyncing }: {
    pushNow: () => void;
    pullNow: () => void;
    isSyncing: boolean;
  } = $props();
</script>

<div class="action-row">
  <button class="btn btn-push" onclick={pushNow} disabled={isSyncing}>
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 9V3M3.5 5.5L6 3l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Push Now
  </button>
  <button class="btn btn-pull" onclick={pullNow} disabled={isSyncing}>
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 3v6M3.5 6.5L6 9l2.5-2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Pull Now
  </button>
</div>

<style>
  .action-row {
    display: flex;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .btn {
    flex: 1;
    height: 34px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    font-family: var(--sans);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    transition: background var(--t), box-shadow var(--t), opacity var(--t), color var(--t);
    letter-spacing: 0.01em;
  }

  .btn-push {
    background: var(--accent);
    color: #0a1628;
    border: none;
  }

  .btn-push:hover:not(:disabled) {
    background: #60cbfa;
    box-shadow: 0 0 12px var(--accent-glow);
  }

  .btn-pull {
    background: transparent;
    color: var(--accent);
    border: 1px solid rgba(56, 189, 248, 0.35);
  }

  .btn-pull:hover:not(:disabled) {
    background: var(--accent-dim);
    border-color: var(--accent);
  }

  .btn:disabled {
    opacity: 0.38;
    cursor: not-allowed;
    pointer-events: none;
  }
</style>

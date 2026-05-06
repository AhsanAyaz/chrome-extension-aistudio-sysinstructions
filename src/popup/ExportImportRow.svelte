<script lang="ts">
  let { exportJSON, handleFileSelected }: {
    exportJSON: () => Promise<void>;
    handleFileSelected: (event: Event) => Promise<void>;
  } = $props();

  let fileInput: HTMLInputElement;
</script>

<div class="export-import-row">
  <input
    type="file"
    accept=".json"
    style="display:none"
    bind:this={fileInput}
    onchange={handleFileSelected}
  />
  <button class="link-btn" onclick={exportJSON}>
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 1v6M3 4.5l2.5 2.5L8 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M1 9h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
    Export JSON
  </button>
  <span class="divider"></span>
  <button class="link-btn" onclick={() => fileInput.click()}>
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.5 7V1M3 3.5L5.5 1 8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M1 9h9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    </svg>
    Import JSON
  </button>
</div>

<style>
  .export-import-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 7px 14px 9px;
    border-top: 1px solid var(--border);
  }

  .link-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    font-size: 13px;
    font-family: var(--sans);
    color: var(--muted);
    cursor: pointer;
    padding: 4px 12px;
    border-radius: 4px;
    transition: color var(--t), background var(--t);
    letter-spacing: 0.01em;
  }

  .link-btn:hover {
    color: var(--accent);
    background: var(--accent-dim);
  }

  .divider {
    width: 1px;
    height: 14px;
    background: var(--border);
    flex-shrink: 0;
  }
</style>

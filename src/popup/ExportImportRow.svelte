<script lang="ts">
  // D-08: Import uses a hidden <input type="file"> inside the popup.
  // Clicking Import button programmatically triggers the file input.
  let { exportJSON, handleFileSelected }: {
    exportJSON: () => Promise<void>;
    handleFileSelected: (event: Event) => Promise<void>;
  } = $props();

  let fileInput: HTMLInputElement;
</script>

<!-- UI-SPEC: Export (secondary) + Import (accent fill) — side by side -->
<div class="export-import-row">
  <!-- Hidden file input — accept .json only (D-08) -->
  <input
    type="file"
    accept=".json"
    style="display:none"
    bind:this={fileInput}
    onchange={handleFileSelected}
  />
  <button class="btn btn-secondary" onclick={exportJSON}>
    Export JSON
  </button>
  <button class="btn btn-primary" onclick={() => fileInput.click()}>
    Import JSON
  </button>
</div>

<style>
  .export-import-row {
    display: flex;
    gap: 8px;
  }

  .btn {
    flex: 1;
    height: 36px;
    min-height: 36px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 400;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  /* UI-SPEC: Import — accent fill #1A73E8 */
  .btn-primary {
    background: #1a73e8;
    color: #ffffff;
    border: none;
  }

  .btn-primary:hover {
    background: #1558b0;
  }

  /* UI-SPEC: Export — secondary (#F3F4F6 bg, #111827 text, #E5E7EB border) */
  .btn-secondary {
    background: #f3f4f6;
    color: #111827;
    border: 1px solid #e5e7eb;
  }

  .btn-secondary:hover {
    background: #e5e7eb;
  }
</style>

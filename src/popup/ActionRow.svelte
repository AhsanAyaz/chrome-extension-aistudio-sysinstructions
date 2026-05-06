<script lang="ts">
  // Svelte 5 props — callbacks passed from App.svelte (D-04 fire-and-forget)
  let { pushNow, pullNow, isSyncing }: {
    pushNow: () => void;
    pullNow: () => void;
    isSyncing: boolean;
  } = $props();
</script>

<!-- UI-SPEC: Push Now (accent fill) + Pull Now (outlined) — side by side, 36px min height -->
<div class="action-row">
  <button
    class="btn btn-primary"
    onclick={pushNow}
    disabled={isSyncing}
  >
    Push Now
  </button>
  <button
    class="btn btn-secondary"
    onclick={pullNow}
    disabled={isSyncing}
  >
    Pull Now
  </button>
</div>

<style>
  /* UI-SPEC Action row layout */
  .action-row {
    display: flex;
    gap: 8px; /* 2 × 4px gap = 8px total between buttons */
  }

  .btn {
    flex: 1;
    height: 36px;       /* UI-SPEC minimum 36px touch target */
    min-height: 36px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 400;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s;
  }

  /* UI-SPEC: Push Now — accent #1A73E8 fill, white text */
  .btn-primary {
    background: #1a73e8;
    color: #ffffff;
    border: none;
  }

  .btn-primary:hover:not(:disabled) {
    background: #1558b0;
  }

  /* UI-SPEC: Pull Now — outlined, #FFFFFF bg, #111827 text, 1px #E5E7EB border */
  .btn-secondary {
    background: #ffffff;
    color: #111827;
    border: 1px solid #e5e7eb;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #f3f4f6;
  }

  /* UI-SPEC disabled state during sync: opacity 0.5, cursor not-allowed */
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
</style>

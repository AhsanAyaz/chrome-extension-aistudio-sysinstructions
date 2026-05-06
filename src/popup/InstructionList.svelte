<script lang="ts">
  import type { RegistryRecord } from '../shared/types';
  import { relativeTime } from './relativeTime';

  // Svelte 5 props — array of [uuid, record] tuples sorted newest-first
  // D-02: title + updatedAt only — no body fetch
  let { items }: { items: Array<[string, RegistryRecord]> } = $props();
</script>

<div class="list-container">
  {#each items as [uuid, rec] (uuid)}
    <div class="list-row">
      <span class="item-title">{rec.title}</span>
      <span class="item-timestamp">{relativeTime(rec.updatedAt)}</span>
    </div>
  {:else}
    <!-- UI-SPEC Empty state copy -->
    <div class="empty-state">
      <p class="empty-heading">No instructions yet</p>
      <p class="empty-body">Open AI Studio and add a system instruction to start syncing.</p>
    </div>
  {/each}
</div>

<style>
  /* UI-SPEC: instruction list max-height with internal scroll */
  .list-container {
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
  }

  .list-row {
    display: flex;
    flex-direction: column;
    gap: 4px; /* xs — between title and timestamp */
    padding: 8px 10px; /* sm vertical */
    border-bottom: 1px solid #e5e7eb;
    cursor: default;
  }

  .list-row:last-child {
    border-bottom: none;
  }

  /* UI-SPEC: hover state #F3F4F6 */
  .list-row:hover {
    background: #f3f4f6;
  }

  /* UI-SPEC: title 13px/400/#111827, truncated at 280px */
  .item-title {
    font-size: 13px;
    font-weight: 400;
    color: #111827;
    line-height: 1.5;
    max-width: 280px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* UI-SPEC: timestamp 11px/400/#6B7280 */
  .item-timestamp {
    font-size: 11px;
    font-weight: 400;
    color: #6b7280;
    line-height: 1.4;
  }

  .empty-state {
    padding: 24px 16px;
    text-align: center;
  }

  .empty-heading {
    font-size: 13px;
    font-weight: 600;
    color: #111827;
    margin-bottom: 4px;
  }

  .empty-body {
    font-size: 11px;
    font-weight: 400;
    color: #6b7280;
    line-height: 1.4;
  }
</style>

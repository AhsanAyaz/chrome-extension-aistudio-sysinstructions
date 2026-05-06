<script lang="ts">
  import type { RegistryRecord } from '../shared/types';
  import { relativeTime } from './relativeTime';

  let { items }: { items: Array<[string, RegistryRecord]> } = $props();
</script>

<div class="list-wrap">
  {#if items.length === 0}
    <div class="empty-state">
      <svg class="empty-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="var(--dim)" stroke-width="1.5"/>
        <path d="M7 9h10M7 13h6" stroke="var(--dim)" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <p class="empty-heading">No instructions yet</p>
      <p class="empty-body">Edit a system instruction in AI Studio to start syncing.</p>
    </div>
  {:else}
    <ul class="list">
      {#each items as [uuid, rec] (uuid)}
        <li class="list-row">
          <div class="accent-stripe"></div>
          <div class="row-content">
            <span class="item-title">{rec.title}</span>
            <span class="item-timestamp">{relativeTime(rec.updatedAt)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .list-wrap {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .list {
    list-style: none;
    max-height: 210px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .list-row {
    display: flex;
    align-items: stretch;
    position: relative;
    cursor: default;
    transition: background var(--t);
  }

  .list-row:hover {
    background: var(--surface-hover);
  }

  .accent-stripe {
    width: 2px;
    flex-shrink: 0;
    background: transparent;
    transition: background var(--t);
    margin: 4px 0;
    border-radius: 0 1px 1px 0;
  }

  .list-row:hover .accent-stripe {
    background: var(--accent);
  }

  .row-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 14px 7px 10px;
    width: 100%;
    min-width: 0;
  }

  .item-title {
    font-size: 13.5px;
    color: var(--text);
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
    transition: color var(--t);
  }

  .list-row:hover .item-title {
    color: #edf2ff;
  }

  .item-timestamp {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 20px 24px;
    gap: 6px;
  }

  .empty-icon {
    margin-bottom: 4px;
    opacity: 0.6;
  }

  .empty-heading {
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
  }

  .empty-body {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
    line-height: 1.5;
    max-width: 220px;
  }
</style>

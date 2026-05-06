<script lang="ts">
  import { onMount } from 'svelte';
  import type { SyncStatus, SyncRegistry } from '../shared/types';
  import { SYNC_STATUS_KEY } from '../background/sync-state';
  import { REGISTRY_KEY, BODY_KEY_PREFIX } from '../shared/constants';
  import StatusHeader from './StatusHeader.svelte';
  import InstructionList from './InstructionList.svelte';
  import ActionRow from './ActionRow.svelte';
  import ExportImportRow from './ExportImportRow.svelte';
  import BannerRow from './BannerRow.svelte';

  // Reactive state (Svelte 5 runes — NOT Svelte 4 $: syntax)
  let syncStatus = $state<SyncStatus>({ state: 'idle', lastSyncAt: 0 });
  let registry = $state<SyncRegistry>({});
  let refreshHintDismissed = $state(false);
  let importMessage = $state('');

  // Derived: live items sorted newest-first — D-02 registry-only (no body fetch)
  let liveItems = $derived(
    Object.entries(registry)
      .filter(([, rec]) => rec.deletedAt === null)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt),
  );

  // Show refresh hint when a PULL_NOW click was sent, cleared on dismiss or popup close.
  let showRefreshHint = $state(false);

  onMount(async () => {
    // Initial hydration from both storage areas (D-01: popup may read sync directly)
    const [localData, syncData] = await Promise.all([
      chrome.storage.local.get(SYNC_STATUS_KEY),
      chrome.storage.sync.get(REGISTRY_KEY),
    ]);
    syncStatus = (localData[SYNC_STATUS_KEY] as SyncStatus) ?? { state: 'idle', lastSyncAt: 0 };
    registry = (syncData[REGISTRY_KEY] as SyncRegistry) ?? {};

    // Live update via onChanged (D-03) — area guards prevent spurious re-renders (Pitfall 2)
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && SYNC_STATUS_KEY in changes) {
        syncStatus =
          (changes[SYNC_STATUS_KEY]!.newValue as SyncStatus) ?? { state: 'idle', lastSyncAt: 0 };
      }
      if (area === 'sync' && REGISTRY_KEY in changes) {
        registry = (changes[REGISTRY_KEY]!.newValue as SyncRegistry) ?? {};
      }
    }
    chrome.storage.onChanged.addListener(onChanged);

    // Return cleanup — Svelte 5 onMount cleanup pattern (Pitfall 7 guard)
    return () => chrome.storage.onChanged.removeListener(onChanged);
  });

  // Push Now — fire-and-forget (D-04). No sendResponse ack needed.
  function pushNow() {
    chrome.runtime.sendMessage({ type: 'PUSH_NOW' }).catch(() => {
      /* SW may be inactive */
    });
  }

  // Pull Now — fire-and-forget (D-04). Set refresh hint so user knows to reload AI Studio.
  function pullNow() {
    chrome.runtime.sendMessage({ type: 'PULL_NOW' }).catch(() => {
      /* SW may be inactive */
    });
    showRefreshHint = true;
    refreshHintDismissed = false;
  }

  function dismissHint() {
    refreshHintDismissed = true;
  }

  // Export JSON — all in popup DOM context, no downloads permission (D-01 allows sync reads)
  // D-10: live items only (deletedAt === null), schema: { title, text, uuid, updatedAt }
  async function exportJSON() {
    const liveUuids = Object.entries(registry).filter(([, rec]) => rec.deletedAt === null);
    if (liveUuids.length === 0) return;

    // Collect all body chunk keys then fetch in ONE batched get (Hard Rule 3 discipline)
    const bodyKeys: string[] = [];
    for (const [uuid, rec] of liveUuids) {
      for (let i = 0; i < rec.chunks; i++) {
        bodyKeys.push(`${BODY_KEY_PREFIX}${uuid}:c${i}`);
      }
    }
    const bodyData = bodyKeys.length > 0 ? await chrome.storage.sync.get(bodyKeys) : {};

    const items = liveUuids.map(([uuid, rec]) => {
      const keys = Array.from({ length: rec.chunks }, (_, i) => `${BODY_KEY_PREFIX}${uuid}:c${i}`);
      const bodyJson = keys.map((k) => (bodyData[k] as string) ?? '').join('');
      let text = '';
      try {
        text = (JSON.parse(bodyJson) as { text: string }).text;
      } catch {
        /* skip corrupted body */
      }
      return { title: rec.title, text, uuid, updatedAt: rec.updatedAt };
    });

    // Filename: aistudio-instructions-YYYY-MM-DD.json (local date)
    const filename = `aistudio-instructions-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Import JSON — D-08: hidden file input in ExportImportRow triggers this callback
  // D-09: all-or-nothing validation; valid payloads sent to SW via IMPORT_ITEMS
  async function handleFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      importMessage = 'Import failed: file is not valid JSON.';
      return;
    }

    if (!Array.isArray(parsed)) {
      importMessage = 'Import failed: file is not valid JSON.';
      return;
    }

    const invalid = (parsed as unknown[]).filter(
      (item) =>
        typeof (item as Record<string, unknown>)?.title !== 'string' ||
        !(item as Record<string, unknown>).title ||
        typeof (item as Record<string, unknown>)?.text !== 'string' ||
        !(item as Record<string, unknown>).text,
    );
    if (invalid.length > 0) {
      importMessage = `Import failed: ${invalid.length} item(s) missing title or text. No items were imported.`;
      return;
    }

    // All valid — send to SW (D-09). Fire-and-forget with .catch().
    chrome.runtime.sendMessage({ type: 'IMPORT_ITEMS', payload: parsed }).catch(() => {});
    importMessage = `Imported ${(parsed as unknown[]).length} instruction(s). Syncing now.`;
    // Reset file input value so the same file can be re-imported if needed
    (event.target as HTMLInputElement).value = '';
  }

  // Computed display values
  let isSyncing = $derived(syncStatus.state === 'syncing');
  let instructionCount = $derived(liveItems.length);
  let bannerVisible = $derived(
    (syncStatus.state === 'error' && !!syncStatus.errorState) ||
      (showRefreshHint && !refreshHintDismissed),
  );
</script>

<div class="popup">
  <StatusHeader {syncStatus} itemCount={instructionCount} />
  <InstructionList items={liveItems} />
  <ActionRow {pushNow} {pullNow} {isSyncing} />
  <ExportImportRow {exportJSON} {handleFileSelected} />
  {#if bannerVisible}
    <BannerRow
      {syncStatus}
      showRefreshHint={showRefreshHint && !refreshHintDismissed}
      {dismissHint}
      {importMessage}
    />
  {/if}
  {#if importMessage && syncStatus.state !== 'error'}
    <div class="import-message">{importMessage}</div>
  {/if}
</div>

/**
 * Google Drive AppData sync client.
 *
 * Single file (sysins-data.json) in the extension's private AppData folder.
 * No user-visible Drive files — AppData is hidden from Drive UI.
 *
 * Auth: chrome.identity.getAuthToken (uses signed-in Chrome profile).
 *   - interactive: false for background alarm calls (fail silently if no token)
 *   - interactive: true for user-triggered calls (consent popup shown once)
 *
 * Write strategy: read-modify-write (not blind overwrite).
 *   flushToDrive() reads the current Drive file, merges pendingWrite on top,
 *   then writes the merged result. Last-write-wins for simultaneous edits
 *   (acceptable for a personal single-user extension).
 */

import { DRIVE_FILE_NAME, DRIVE_CACHE_KEY, REGISTRY_KEY, BODY_KEY_PREFIX } from '../shared/constants';
import type { DriveFileContent, DriveCache, SyncRegistry } from '../shared/types';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function getAuthToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'getAuthToken failed'));
      } else {
        resolve(token as string);
      }
    });
  });
}

export async function removeCachedToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// ---------------------------------------------------------------------------
// Drive file operations
// ---------------------------------------------------------------------------

interface DriveFileMeta {
  fileId: string;
  modifiedTime: string;
}

async function findFile(token: string): Promise<DriveFileMeta | null> {
  const url =
    `${DRIVE_FILES_URL}?spaces=appDataFolder` +
    `&q=name%3D'${DRIVE_FILE_NAME}'` +
    `&fields=files(id%2CmodifiedTime)`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Drive list failed: ${resp.status}`);
  const body = (await resp.json()) as { files?: Array<{ id: string; modifiedTime: string }> };
  const f = body.files?.[0];
  return f ? { fileId: f.id, modifiedTime: f.modifiedTime } : null;
}

/**
 * Read the Drive file. Returns null if the file doesn't exist yet (fresh install).
 * Retries once with a refreshed token on 401.
 */
export async function readDriveFile(interactive = false): Promise<{ meta: DriveFileMeta; content: DriveFileContent } | null> {
  let token = await getAuthToken(interactive);

  async function attempt(): Promise<{ meta: DriveFileMeta; content: DriveFileContent } | null> {
    const meta = await findFile(token);
    if (!meta) return null;

    const resp = await fetch(`${DRIVE_FILES_URL}/${meta.fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 401) return null; // signal retry
    if (!resp.ok) throw new Error(`Drive read failed: ${resp.status}`);
    const content = (await resp.json()) as DriveFileContent;
    return { meta, content };
  }

  const result = await attempt();
  if (result === null && !interactive) {
    // 401 or no file — return null (background poll fails silently)
    return null;
  }
  return result;
}

/**
 * Write (create or update) the Drive file.
 * fileId undefined → create; provided → update via simple media PATCH.
 * Returns the new file meta (fileId + modifiedTime).
 */
export async function writeDriveFile(
  content: DriveFileContent,
  fileId?: string,
  interactive = true,
): Promise<DriveFileMeta> {
  const token = await getAuthToken(interactive);
  const body = JSON.stringify(content);

  if (fileId === undefined) {
    // Create: multipart upload
    const boundary = 'sysins__boundary__';
    const metadata = JSON.stringify({ name: DRIVE_FILE_NAME, parents: ['appDataFolder'] });
    const multipart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${body}\r\n` +
      `--${boundary}--`;

    const resp = await fetch(
      `${DRIVE_UPLOAD_URL}?uploadType=multipart&spaces=appDataFolder&fields=id%2CmodifiedTime`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipart,
      },
    );
    if (!resp.ok) throw new Error(`Drive create failed: ${resp.status}`);
    const { id, modifiedTime } = (await resp.json()) as { id: string; modifiedTime: string };
    return { fileId: id, modifiedTime };
  }

  // Update: simple media PATCH
  const resp = await fetch(
    `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media&fields=id%2CmodifiedTime`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    },
  );
  if (!resp.ok) throw new Error(`Drive update failed: ${resp.status}`);
  const { id, modifiedTime } = (await resp.json()) as { id: string; modifiedTime: string };
  return { fileId: id, modifiedTime };
}

// ---------------------------------------------------------------------------
// Local Drive cache helpers
// ---------------------------------------------------------------------------

export async function readDriveCache(): Promise<DriveCache | null> {
  const r = await chrome.storage.local.get(DRIVE_CACHE_KEY);
  return (r[DRIVE_CACHE_KEY] as DriveCache | undefined) ?? null;
}

export async function writeDriveCache(cache: DriveCache): Promise<void> {
  await chrome.storage.local.set({ [DRIVE_CACHE_KEY]: cache });
}

// ---------------------------------------------------------------------------
// High-level: flush pendingWrite to Drive (read-modify-write)
// ---------------------------------------------------------------------------

/**
 * Merge pendingWrite batch on top of current Drive data, removing stale body chunks,
 * then write the merged result to Drive. Updates the local Drive cache.
 *
 * Called by alarm-flush after drainPendingWrite() returns a non-empty batch.
 */
export async function flushToDrive(
  pendingWrite: Record<string, unknown>,
  interactive = true,
): Promise<void> {
  const cache = await readDriveCache();

  // Base: current Drive data (from cache), or empty if no file exists yet
  const baseData: Record<string, unknown> = cache?.data ?? {};
  const fileId: string | undefined = cache?.fileId;

  // Merge: apply pendingWrite on top of base
  const merged: Record<string, unknown> = { ...baseData };
  Object.assign(merged, pendingWrite);

  // Remove stale body chunks where chunk count decreased or item was tombstoned
  const pendingRegistry = pendingWrite[REGISTRY_KEY] as SyncRegistry | undefined;
  const baseRegistry = baseData[REGISTRY_KEY] as SyncRegistry | undefined;
  if (pendingRegistry && baseRegistry) {
    for (const [uuid, newRec] of Object.entries(pendingRegistry)) {
      const oldRec = baseRegistry[uuid];
      if (!oldRec) continue;

      if (newRec.deletedAt !== null && oldRec.deletedAt === null) {
        // Newly tombstoned: remove all body keys
        for (let i = 0; i < oldRec.chunks; i++) {
          delete merged[`${BODY_KEY_PREFIX}${uuid}:c${i}`];
        }
      } else if (oldRec.chunks > newRec.chunks) {
        // Chunk count decreased: remove orphaned tail chunks
        for (let i = newRec.chunks; i < oldRec.chunks; i++) {
          delete merged[`${BODY_KEY_PREFIX}${uuid}:c${i}`];
        }
      }
    }
  }

  const content: DriveFileContent = { schemaVersion: 1, data: merged };
  const newMeta = await writeDriveFile(content, fileId, interactive);

  await writeDriveCache({ fileId: newMeta.fileId, modifiedTime: newMeta.modifiedTime, data: merged });
}

// ---------------------------------------------------------------------------
// High-level: poll Drive for remote changes
// ---------------------------------------------------------------------------

/**
 * Check if Drive has newer data than the local cache.
 * Returns the new DriveCache if there's a change, null if up-to-date or no file.
 */
export async function pollDriveForChanges(interactive = false): Promise<DriveCache | null> {
  let result: { meta: DriveFileMeta; content: DriveFileContent } | null;
  try {
    result = await readDriveFile(interactive);
  } catch {
    return null; // network error — poll fails silently
  }
  if (!result) return null;

  const { meta, content } = result;
  const cache = await readDriveCache();

  // No change if modifiedTime matches cached version
  if (cache?.modifiedTime === meta.modifiedTime) return null;

  const newCache: DriveCache = {
    fileId: meta.fileId,
    modifiedTime: meta.modifiedTime,
    data: content.data,
  };
  await writeDriveCache(newCache);
  return newCache;
}

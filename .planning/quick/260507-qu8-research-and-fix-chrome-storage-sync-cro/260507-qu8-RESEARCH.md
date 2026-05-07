# Quick Task qu8: chrome.storage.sync Cross-Device Sync — Research

**Researched:** 2026-05-07
**Domain:** Chrome Extension storage.sync, extension identity, developer mode
**Confidence:** HIGH (official docs + authoritative Chromium dev discussion)

---

## Summary

`chrome.storage.sync` DOES work for sideloaded (unpacked) developer-mode extensions — but ONLY when both devices load the extension with the **identical extension ID**. Without the `key` field in the manifest, Chrome derives the ID from the file-system path of the unpacked directory, producing a different ID on every machine. With `key` present and correctly formatted, Chrome ignores the path and uses the key-derived ID instead. The current project already has a `key` field in `wxt.config.ts` and in the built manifest. The computed extension ID is **`kacgdabapihhffejhjlmpmjnpchlknfe`**. If the two devices show a different ID in `chrome://extensions`, the key is either not in the build loaded on that device, or that device is loading an old build without the key.

**Primary recommendation:** Verify both devices show the same ID (`kacgdabapihhffejhjlmpmjnpchlknfe`) in `chrome://extensions`. If one does not, rebuild and reload the extension. Also verify Chrome Sync includes the "Extensions" category on both devices.

---

## Q1: Does chrome.storage.sync actually work for unpacked extensions?

**Yes — with the same extension ID.** [VERIFIED: developer.chrome.com/docs/extensions/reference/api/storage]

- `chrome.storage.sync` is namespaced by extension ID. Two installs with different IDs are two completely separate, unrelated namespaces that will never share data.
- There is NO restriction that prevents developer-mode/unpacked extensions from using sync storage. The API works identically for unpacked and packed extensions.
- If the user disables Chrome sync entirely, `storage.sync` behaves like `storage.local` (data saved locally, not propagated). If sync is re-enabled later, data propagates. [CITED: developer.chrome.com/docs/extensions/reference/api/storage]
- Chrome sync must include the "Extensions" or "Apps & extensions" category. If the user has customized their sync and excluded extensions, storage.sync will not propagate. [CITED: allthings.how — Chrome extension sync troubleshooting]

**Checklist to confirm sync can flow:**
1. Chrome signed in to same Google account on both devices.
2. Chrome sync enabled (not paused).
3. "Extensions" category included in sync settings (`chrome://settings/syncSetup`).
4. Both devices show the same extension ID in `chrome://extensions`.

---

## Q2: Manifest `key` field — correct format

**Format:** Base64-encoded SubjectPublicKeyInfo (SPKI) DER encoding of a 2048-bit RSA public key, on a single line (no newlines, no PEM headers). [VERIFIED: developer.chrome.com/docs/extensions/reference/manifest/key]

The prefix `MIIBIjAN` is the canonical DER ASN.1 header for RSA-2048 SubjectPublicKeyInfo — it confirms the format is correct. [MEDIUM: multiple cross-checked sources]

**Generating a fresh key from scratch (if ever needed):**

```bash
# Step 1: Generate 2048-bit RSA private key in PKCS#8 format
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem

# Step 2: Extract public key as DER, base64-encode to single line
openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
# Output → paste into manifest "key" field

# Step 3: Compute the extension ID that will result
openssl rsa -in key.pem -pubout -outform DER | sha256sum | head -c32 | tr 0-9a-f a-p
```

[CITED: dangphongvanthanh.wordpress.com/2017/02/14/keep-chrome-extension-id-same-during-development]

**Does WXT pass the `key` field through?** YES — confirmed by reading `.output/chrome-mv3/manifest.json`. The built manifest contains the `key` field verbatim. [VERIFIED: direct codebase inspection]

---

## Q3: Why two devices might still show different namespaces after adding `key`

**Root causes, most likely first:**

| Cause | How to detect | Fix |
|-------|--------------|-----|
| One device is loading an old build without the `key` field | `chrome://extensions` shows a different ID than `kacgdabapihhffejhjlmpmjnpchlknfe` | Rebuild (`pnpm build`) and reload the extension on that device |
| One device never reloaded after key was added | ID mismatch in `chrome://extensions` | Click "Reload" on the extension card, or remove and re-add |
| Chrome sync paused or extension category excluded | No data in `chrome://sync-internals` for the extension | Enable sync, ensure Extensions category is checked |
| Chrome accounts don't match | Profile email differs between devices | Verify same account in `chrome://settings` |
| The key was changed between builds | Two different IDs each derived from different keys | Use the same `key` string in both builds |
| Timing: sync hasn't propagated yet | Data missing but everything else correct | Wait 30–60 seconds; trigger by reading `chrome.storage.sync.get()` |

**The most common cause in practice:** The extension was first sideloaded WITHOUT the key, Chrome assigned a random ID, and the key was added later. Chrome will keep using the old random ID until the extension is **removed and re-added** (not just reloaded). [MEDIUM: multiple community sources]

**Action:** If `chrome://extensions` shows any ID other than `kacgdabapihhffejhjlmpmjnpchlknfe`, remove the extension entirely and reload it from the `.output/chrome-mv3` directory.

---

## Q4: Definitive working approach for sideloaded cross-device sync

**The key-based approach works reliably in practice.** [VERIFIED: chromium-extensions group, developer.chrome.com]

The critical steps are:
1. Generate one RSA-2048 keypair — done once, forever.
2. Put the base64-encoded public key (SPKI DER format) in `manifest.json` → `key`.
3. Keep the private key (`key.pem`) securely — needed only if you want to package a `.crx` later.
4. On every device, remove any previously sideloaded instance and re-load from the built output.
5. Confirm both devices show the same ID in `chrome://extensions`.
6. Confirm Chrome sync is enabled with the Extensions category on both devices.

**No alternative approach needed.** The "reserved ID" approach (upload a draft to Web Store to get a stable ID) is the same mechanism — it just generates the key for you. You already have a valid self-generated key.

---

## Current Project Status

| Item | Status |
|------|--------|
| `key` in `wxt.config.ts` | Present |
| `key` in built manifest | Present (verified in `.output/chrome-mv3/manifest.json`) |
| Key format | Valid SPKI DER base64 (prefix `MIIBIjAN` confirms RSA-2048 SPKI) |
| Expected extension ID | `kacgdabapihhffejhjlmpmjnpchlknfe` |

**If the sync is still broken after confirming both devices show this ID**, the issue is Chrome account / sync configuration, not the extension code.

---

## Verification Script

Run this in the DevTools console on either device to read what the extension currently sees in sync storage:

```javascript
chrome.storage.sync.get(null, (data) => console.log(JSON.stringify(data, null, 2)));
```

Run this to confirm the extension ID at runtime:

```javascript
console.log(chrome.runtime.id);
// Should print: kacgdabapihhffejhjlmpmjnpchlknfe
```

If `chrome.runtime.id` differs between devices, the sync namespaces will never overlap regardless of anything else.

---

## Checklist: Complete Sync Verification Protocol

- [ ] **Build fresh** on both devices: `pnpm build`
- [ ] **Remove** the old sideloaded extension on both devices (don't just reload — remove completely)
- [ ] **Re-add** from `.output/chrome-mv3/` on both devices
- [ ] In `chrome://extensions`, confirm both show ID `kacgdabapihhffejhjlmpmjnpchlknfe`
- [ ] In `chrome://settings/syncSetup`, confirm sync is on and Extensions category is included
- [ ] Open DevTools on both → run `chrome.runtime.id` — must match
- [ ] Run `chrome.storage.sync.get(null, console.log)` on both — after a push on device A, wait 30s, check device B

---

## Sources

- [chrome.storage API docs](https://developer.chrome.com/docs/extensions/reference/api/storage) — sync behavior, quota, offline semantics
- [Manifest key field docs](https://developer.chrome.com/docs/extensions/reference/manifest/key) — key format, how ID is derived
- [chromium-extensions: sync storage across devices](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/qp_087h_vrU) — confirmed works for unpacked with same ID
- [chromium-extensions: unpacked extension ID same on different devices](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/MmPE0Zl1KoQ) — Simeon Vincent confirms `key` is the proper approach
- [Keep same extension ID during development](https://dangphongvanthanh.wordpress.com/2017/02/14/keep-chrome-extension-id-same-during-development/) — exact openssl commands for key generation
- [How to fix Chrome extensions not syncing](https://allthings.how/how-to-fix-it-when-chrome-extensions-are-not-syncing-between-your-computers/) — sync category troubleshooting
- Extension ID computed from current key via Python (in-session, deterministic): `kacgdabapihhffejhjlmpmjnpchlknfe`

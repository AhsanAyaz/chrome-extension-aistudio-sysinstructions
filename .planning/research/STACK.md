# Stack Research

**Domain:** Chrome Manifest V3 Extension (sync/storage, popup UI, content script, service worker)
**Researched:** 2026-05-01
**Confidence:** HIGH (core choices), MEDIUM (storage chunking pattern), HIGH (testing)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TypeScript | ~5.8 (bundled by WXT) | Language | Type-safe chrome API access — `chrome.storage.sync`, message types, and the chunking logic all involve subtle shape contracts. The `@types/chrome` types (now used natively by WXT v0.20) catch quota/quota_bytes errors and API misuse at author time, not runtime. For a project this small the config overhead is ~2 minutes; the payoff comes the first time you mistype a storage key. Justified. |
| WXT | 0.20.25 | Extension framework / bundler | WXT is the clear consensus pick in 2026. It wraps Vite, handles MV3 service worker output, auto-generates manifest.json from file-based entrypoints, provides `fakeBrowser` for unit tests, and ships a built-in typed storage API. `wxt init` scaffolds service worker + content script + popup in one command. Actively maintained (published ~20 hours before research date). Alternatives covered in "Alternatives Considered." |
| Svelte 5 | 5.55.5 | Popup UI framework | Compiled-away reactivity — the popup ships as plain DOM operations with ~2-3 KB runtime overhead (no virtual DOM). The `$state` rune is a perfect fit for syncing popup state with `chrome.storage.sync` via `storage.watch()`. `@wxt-dev/module-svelte` 2.0.5 integrates it with zero extra config. Better bundle discipline than React/Preact for a popup that will be opened and closed thousands of times. |
| Vite | ~6.x (via WXT) | Build tool | Bundled by WXT; no separate Vite dependency to manage. WXT uses Vite under the hood for HMR, tree-shaking, and asset handling. You get sub-second rebuilds during development. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `wxt/utils/storage` (built-in) | bundled with WXT | Typed storage wrapper for `chrome.storage.sync` / `local` | Use for all storage reads and writes. Provides `defineItem`, `getItem`, `setItem`, `watch`. Zero install cost. |
| Roll-your-own chunking module | — | Shard instructions array across multiple `sync:` keys to stay under 8 KB/item | Required because WXT storage does not handle chunking automatically. Single 300-word instruction at UTF-8 is already ~1 KB; N instructions + metadata may exceed one slot. Pattern: serialize payload, split by byte budget, write as `sync:chunk_0`, `sync:chunk_1`, reassemble on read. ~100 lines of TypeScript. |
| `vitest` | 4.1.5 | Unit tests | All unit tests. WXT ships a `WxtVitest()` Vite plugin + `fakeBrowser` that gives an in-memory `browser.storage` implementation — no manual Chrome API mocking required. |
| `@wxt-dev/module-svelte` | 2.0.5 | Svelte integration for WXT | Required when using Svelte; adds the Svelte Vite plugin to WXT's build pipeline. |
| `happy-dom` | latest | Vitest DOM environment | Faster than jsdom for popup component tests. Recommended by WXT's own testing docs. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| WXT CLI (`wxt dev`) | Dev server with HMR | Opens Chrome with the extension pre-installed. Reloads on file save. |
| WXT CLI (`wxt build`) | Production build | Outputs `dist/chrome-mv3/` ready for sideloading or Web Store upload. |
| WXT CLI (`wxt zip`) | Web Store package | Generates the `.zip` with correct structure. |
| `web-ext` (optional) | Browser runner | WXT uses it under the hood; only needed if you want manual lint checks before store submission. |

---

## Installation

```bash
# Scaffold new WXT project with Svelte template
npx wxt@latest init aistudio-sync-ext --template svelte-ts

# Inside the project directory
cd aistudio-sync-ext

# Install Svelte WXT module (if not already in template)
npm install @wxt-dev/module-svelte

# Dev dependencies
npm install -D vitest happy-dom
```

`wxt.config.ts` additions:
```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    permissions: ['storage'],
    host_permissions: ['https://aistudio.google.com/*'],
  },
});
```

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
  },
});
```

---

## UUID Generation

Use the built-in Web Crypto API. No npm package needed.

```typescript
const uuid = crypto.randomUUID(); // Available in all MV3 contexts (service worker, content script, popup)
```

`crypto.randomUUID()` is available in Chrome since Chrome 92 (mid-2021), is always available inside extension service workers, and is cryptographically random. Do not install the `uuid` npm package — it adds dead weight for something the browser already provides.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| WXT | Plasmo | Avoid in 2026. Plasmo is in effective maintenance mode, uses the older Parcel bundler, and produces ~2x larger bundles (~800 KB vs ~400 KB for equivalent extensions). Its React-first stance adds friction for non-React projects. Only consider it if you need to copy from a large existing Plasmo codebase. |
| WXT | CRXJS Vite plugin | If you need ESM content scripts (WXT still marks this WIP) or want to own your full Vite config without any framework conventions. CRXJS development has slowed significantly in 2025-2026. Chrome-only (no cross-browser). Not recommended for new projects. |
| WXT | Vanilla + esbuild/Rollup | Legitimate if the project truly has no popup UI and you want zero framework overhead. For this project — which has a popup, Svelte reactivity, and non-trivial logic — WXT saves more time than it costs. |
| WXT | Webpack | Never use for new MV3 projects in 2026. Config burden, slow rebuilds, bloated output. No advantages over Vite/WXT for this use case. |
| Svelte 5 | Preact (~10) | Both are lightweight (~4 KB for Preact, ~2-3 KB for Svelte). Preact is the better call if the developer is already fluent in React idioms and the team might grow. For a solo project with Svelte familiarity, Svelte 5's compiled reactivity is marginally leaner and the rune-based state management (`$state`) maps naturally to `storage.watch()` callbacks. |
| Svelte 5 | React 19 | React carries ~45 KB gzipped runtime. Overkill for a popup that renders a status indicator and a list of 10-50 items. React is the right call only if the popup grows into a serious micro-app or you plan to share component code with a web app. |
| Svelte 5 | Vanilla JS | Completely valid for the popup. If `$state` and `.svelte` files feel like added ceremony, a handful of hand-written DOM updates in `popup.ts` is fine. The only cost is wiring up `storage.watch()` to DOM updates manually. Choose this if Svelte 5 is unfamiliar. |
| Roll-your-own chunking | `chrome-storage-largeSync` | `chrome-storage-largeSync` (dtuit) wraps `chrome.storage.sync` with LZ-string compression and transparent chunking. The project is dormant (10 commits, no recent activity). For this project's specific data shape (array of `{title, text, uuid, updated_at, deleted_at}`), a custom chunker is ~100 lines, fully understood, and tunable to the exact quota math. Roll your own. |
| `crypto.randomUUID()` | `uuid` npm package | Only needed if you have to support pre-Chrome-92 environments (you don't — MV3 requires Chrome 88+, but `randomUUID` landed in 92). The package adds 0 value here. |
| Vitest | Jest | Vitest is the natural pairing for Vite-based projects. WXT's `WxtVitest()` plugin + `fakeBrowser` are built for Vitest. Jest requires an extra transform layer for ESM and doesn't integrate with WXT's virtual modules. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Plasmo | Maintenance mode, Parcel bundler, 2x bundle size, React-first | WXT |
| Webpack | Obsolete config burden for extension projects, slow, no HMR benefits over Vite | WXT (Vite-based) |
| CRXJS (alone) | Stagnating development, no framework scaffolding, Chrome-only, ESM content scripts still WIP | WXT |
| `idb-keyval` / IndexedDB for primary storage | This extension's sync backend is explicitly `chrome.storage.sync`. IndexedDB is local-only and cannot be synced across devices via Chrome's built-in sync mechanism. Use IndexedDB only if you need a local cache layer (not needed here). | `chrome.storage.sync` via WXT storage API |
| `webext-storage-cache` | Adds a TTL cache layer on top of storage — useful for network-fetched data, not for a sync store where you want all data live at all times. Adds complexity without benefit. | Raw WXT storage API |
| `uuid` npm package | 2 KB for functionality built into the browser since Chrome 92. | `crypto.randomUUID()` |
| `webextension-polyfill` | WXT v0.20 dropped it in favor of `@wxt-dev/browser` which provides better MV3 types. If you use the WXT ecosystem, this polyfill is already handled correctly. | WXT's built-in `browser` alias |
| React 19 for the popup | ~45 KB gzipped runtime for a ~300px wide popup with a status indicator and a short list. Disproportionate to the task. | Svelte 5 or vanilla JS |
| jQuery | Not even a question in 2026. | Svelte 5 or vanilla DOM APIs |

---

## Stack Patterns by Variant

**If you want zero framework in the popup (minimal-is-best preference):**
- Use vanilla TypeScript for popup (`popup.ts` + `popup.html`)
- Wire `storage.watch()` callbacks to hand-written DOM updates
- Skip `@wxt-dev/module-svelte`
- 200-line popup, no framework overhead, fully debuggable in DevTools without Svelte component wrappers

**If the popup grows to include settings, conflict review UI, or diff views:**
- Keep Svelte 5, add `@wxt-dev/module-svelte`
- Svelte's compiled reactivity handles list re-renders cheaply
- Still no extra npm installs needed

**For Web Store submission (personal-first → public later):**
- WXT's `wxt zip` command produces a compliant ZIP
- The manifest generated by WXT is already MV3 and store-clean
- Add `icons/` directory with 16/48/128px PNGs before submission
- Minimum-viable permission set (`storage` + host for `aistudio.google.com`) means store review is straightforward — no `<all_urls>` flags

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `wxt@0.20.25` | Svelte 5.x, Vitest 4.x, TypeScript 5.x | v0.20 dropped `webextension-polyfill`; uses `@wxt-dev/browser`. Breaking from v0.19 but stable within 0.20.x |
| `@wxt-dev/module-svelte@2.0.5` | WXT 0.20.x, Svelte 5.x | Module version 2.x targets Svelte 5 runes; don't mix with Svelte 4 |
| `vitest@4.1.5` | WXT's `WxtVitest()` plugin (bundled) | The `WxtVitest()` plugin from `wxt/testing/vitest-plugin` must match the installed WXT version |
| TypeScript 5.8 | All above | Bundled by WXT; no separate install unless you need editor tooling |

---

## Sources

- WXT official comparison page (wxt.dev/guide/resources/compare) — WXT vs Plasmo vs CRXJS feature matrix; HIGH confidence
- Context7 `/wxt-dev/wxt` — WXT storage API, testing setup, entrypoint definitions; HIGH confidence
- WXT npm package page (npm: wxt, version 0.20.25, published ~day of research) — version currency; HIGH confidence
- `@wxt-dev/module-svelte` npm page (version 2.0.5, published 12 days before research) — version currency; HIGH confidence
- Svelte npm package page (version 5.55.5, published 7 days before research) — version currency; HIGH confidence
- Vitest npm page (version 4.1.5, published 10 days before research) — version currency; HIGH confidence
- WXT GitHub (wxt.dev/guide/resources/upgrading) — v0.20 breaking changes, `@wxt-dev/browser` adoption; HIGH confidence
- WebSearch: "2025 State of Browser Extension Frameworks" (redreamality.com) — Plasmo maintenance mode, bundle size comparison; MEDIUM confidence (single source, corroborated by WXT comparison page)
- WebSearch: chrome-storage-largeSync GitHub (dtuit) — library inspection for chunking alternatives; HIGH confidence (direct GitHub read)
- MDN Crypto.randomUUID documentation — browser availability baseline; HIGH confidence
- Sentry Engineering: Preact or Svelte (sentry.engineering) — bundle size comparison for popup use case; MEDIUM confidence

---

*Stack research for: Chrome MV3 Extension — AI Studio System Instructions Sync*
*Researched: 2026-05-01*

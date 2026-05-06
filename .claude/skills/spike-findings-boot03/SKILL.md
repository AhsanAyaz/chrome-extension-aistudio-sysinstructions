# Spike Findings: BOOT-03 Account Mismatch Pre-flight

**Spiked:** 2026-05-06
**Status:** COMPLETE

## Finding 1: chrome.identity.getProfileUserInfo

Permission required: BOTH `"identity"` AND `"identity.email"` (not just `"identity.email"`)

- `"identity.email"` alone → `chrome.identity` is `undefined` (namespace not exposed)
- `"identity"` alone → `chrome.identity` is defined but returns `{ email: '', id: '' }` (empty email)
- `"identity"` + `"identity.email"` together → returns `{ email: 'Ahsan.ubitian@gmail.com', id: '108678739228443489784' }`

Test result: `chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' })` returned:
  email: Ahsan.ubitian@gmail.com
  id: 108678739228443489784

Decision (D-03): Both `"identity"` AND `"identity.email"` permissions MUST be added to wxt.config.ts in plan 04-05.

## Finding 2: AI Studio DOM Selector

Confirmed selector: `document.querySelector('[aria-label*="Google Account"]')`
Confirmed attribute: `aria-label`
Raw attribute value: `"Google Account: Muhammad Ahsan Ayaz (Ahsan.ubitian@gmail.com)"`
Email extraction: match `/\(([^)]+)\)$/` — the email is in the last parenthesised group

Fallback selectors tried:
  - `[data-email]` → `undefined` (not present on aistudio.google.com)
  - `a[href*="accounts.google.com"]` → `undefined` (not present on aistudio.google.com)

## Implementation Notes for plan 04-05

`account-preflight.ts` must:
1. In SW: call `chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' })` to get `chromeEmail`
2. In CS: read `document.querySelector('[aria-label*="Google Account"]')?.getAttribute('aria-label')` and parse with `/\(([^)]+)\)$/` to extract `pageEmail`
3. CS sends `pageEmail` to SW via a new message (e.g. `GET_PAGE_ACCOUNT` or piggybacked on `LS_CHANGED`)
4. SW compares `chromeEmail` to `pageEmail`; if they differ → `setErrorState('ACCOUNT_MISMATCH')`

Recommended approach: CS sends the DOM-scraped email as an additional field on the existing `LS_CHANGED`/`LS_BOOTSTRAP` message payload (avoids a new round-trip message type).

wxt.config.ts permissions for plan 04-05:
```ts
permissions: ['storage', 'scripting', 'alarms', 'identity', 'identity.email'],
```

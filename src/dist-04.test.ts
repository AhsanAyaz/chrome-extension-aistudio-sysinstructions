// src/dist-04.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Forbidden patterns per D-21 / Recipe 8 layer 2. The list intentionally
// matches the RESEARCH.md Recipe 8 verbatim — DO NOT trim entries without
// updating the recipe.
const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\s*\(/,
  /\bEventSource\s*\(/,
  /\bnavigator\.sendBeacon\b/,
  // analytics SDK markers
  /\bgoogle-analytics\.com\b/,
  /\bgtag\s*\(/,
  /\bsentry\.io\b/,
  /\bdatadog/i,
  /\bmixpanel/i,
  /\bamplitude/i,
];

// File-extension allowlist matches RESEARCH.md Recipe 8: .ts, .js, .svelte,
// .tsx, .jsx. Test files (*.test.ts) are excluded so this test file itself
// — and the literal `fetch(` regex it contains — does not trigger violations.
const SCAN_EXTENSIONS = /\.(ts|js|svelte|tsx|jsx)$/;
const TEST_FILE_SUFFIX = '.test.ts';
// drive-client.ts is the authorized Drive API backend — fetch() is its sole purpose.
const ALLOWED_FILES = new Set(['drive-client.ts']);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCAN_EXTENSIONS.test(name) && !name.endsWith(TEST_FILE_SUFFIX) && !ALLOWED_FILES.has(name)) {
      yield path;
    }
  }
}

describe('DIST-04: no third-party network calls', () => {
  it('src/ contains no forbidden network APIs or analytics SDKs', () => {
    const violations: string[] = [];
    for (const file of walk('src')) {
      const content = readFileSync(file, 'utf8');
      for (const pat of FORBIDDEN_PATTERNS) {
        if (pat.test(content)) {
          violations.push(`${file}: ${pat}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

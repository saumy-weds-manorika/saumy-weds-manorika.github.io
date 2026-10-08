import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Official copy says 10-11 December; "12" may only appear with the Phera time, never as a 10-12 range.
const files = ['index.html', 'assets/og.svg', 'docs/SETUP.md', 'apps-script/Code.gs', ...readdirSync('js').filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];

test('copy: no "10-12 Dec" style date range anywhere in the site', () => {
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/10\s*[–-]\s*12\b/.test(text), `${f} still uses a 10–12 date range`);
  }
});

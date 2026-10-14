import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// Shaadi edition copy and wiring: third person, no name search, shared art from ../assets/,
// and its own link. Unchanged modules stay identical to the friends edition's copies.

const read = (f) => readFileSync(f, 'utf8');
const jsFiles = readdirSync('shaadi/js').filter((f) => f.endsWith('.js')).map((f) => `shaadi/js/${f}`);
const siteFiles = ['shaadi/index.html', 'shaadi/css/styles.css', 'shaadi/css/side.css', 'shaadi/css/trip.css', ...jsFiles];

test('copy: official dates read 10–11 December (12 only with the Phera time)', () => {
  for (const f of [...siteFiles, 'apps-script-shaadi/Code.gs', 'docs/SETUP-shaadi.md']) {
    assert.ok(!/10\s*[–-]\s*12\b/.test(read(f)), `${f} uses a 10–12 date range`);
  }
});

test('copy: third person, with no name search, personal links or Saumy-only WhatsApp', () => {
  const page = siteFiles.map(read).join('\n');
  for (const phrase of [/As Saumy would know you/, /Send it to Saumy/, /Manorika and I\b/, /search your name/i, /Who's boarding/,
    /Not on the list/, /Board anyway/, /guest-search/, /hostWhatsApp/, /\?g=/, /my close friends, \$\{couple\}/]) {
    assert.ok(!phrase.test(page), `found ${phrase}`);
  }
  const html = read('shaadi/index.html');
  assert.match(html, /<title>Saumy &amp; Manorika are getting married/);
  assert.match(html, /<meta property="og:url" content="https:\/\/saumy-weds-manorika\.github\.io\/shaadi\/">/);
  assert.match(html, /Which side are you from\?/);
  assert.match(html, /id="pass-wa" href="https:\/\/wa\.me\/"/);
  assert.match(read('shaadi/js/config.js'), /siteUrl: 'https:\/\/saumy-weds-manorika\.github\.io\/shaadi\/'/);
});

test('assets: the shared art is loaded from ../assets/ and every file exists', () => {
  for (const f of siteFiles) {
    const text = read(f);
    assert.ok(!/(src|href)="assets\//.test(text), `${f} points at assets/ instead of ../assets/`);
    assert.ok(!/'assets\/(bobble|band)/.test(text), `${f} points at assets/ instead of ../assets/`);
    for (const m of text.matchAll(/\.\.\/assets\/([\w./-]+\.(?:webp|png|jpg|m4a|svg))/g)) {
      assert.ok(existsSync(`assets/${m[1]}`), `${f}: missing assets/${m[1]}`);
    }
  }
});

test('modules this edition does not change are identical to the friends edition', () => {
  for (const f of ['js/audio.js', 'js/band.js', 'js/trip.js', 'js/trip-data.js', 'js/travel-data.js', 'js/rajasthan-outline.js', 'css/trip.css']) {
    assert.equal(read(`shaadi/${f}`), read(f), f);
  }
});

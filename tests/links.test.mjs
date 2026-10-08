import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sheet, Spreadsheet, load } from './fake-sheets.mjs';

// Personal link (H), Invite message (I) and Send on WhatsApp (J), run end to end on fake sheets.
// Fictional guests only.
const HEAD = ['Guest 1', 'Gender Guest 1', 'Guest 2', 'Gender Guest 2', 'Both Primary?', 'Nicknames', 'ID'];
const BEFORE = Date.UTC(2026, 9, 8, 10, 0);
const cell = (sh, r, c) => sh.peek(r, c) || { v: '' };

function setupSheets(firstRows, secondRows = [HEAD]) {
  const first = new Sheet('First List', firstRows, 10);
  const second = new Sheet('Second List', secondRows, 10);
  const ss = new Spreadsheet([first, second]);
  const gs = load(ss);
  return { gs, ss, first, second };
}

test('fillPersonalLinks writes H to J for every guest with an ID and clears rows without a name', () => {
  const { gs, first } = setupSheets([
    HEAD,
    ['Meera Kapoor', 'F', 'Dev Malhotra', 'M', 'Y', '', 'k7m2'],
    ['Kabir Khan', 'M', 'Mrs', 'NA', 'N', '', 'z8q4'],
    ['', '', '', '', '', '', ''],
    ['Ananya Iyer', 'F', 'NA', 'NA', 'NA', 'Annu', 'a1b2'],
  ]);
  const tabs = gs.prepareListTabs_(gs.ss_());
  const out = JSON.parse(JSON.stringify(gs.fillLinks_(tabs, BEFORE, [])));
  assert.deepEqual(out, { filled: 3, skipped: 0 });
  assert.equal(cell(first, 1, 8).v, 'Personal link');
  assert.equal(cell(first, 1, 9).v, 'Invite message');
  assert.equal(cell(first, 1, 10).v, 'Send on WhatsApp');
  assert.equal(cell(first, 2, 8).v, 'https://saumy-weds-manorika.github.io/?g=k7m2');
  assert.ok(String(cell(first, 2, 9).v).startsWith('Hi Meera & Dev! 🚂'));
  assert.ok(String(cell(first, 3, 9).v).startsWith('Hi Kabir! 🚂'));
  assert.ok(cell(first, 2, 10).rt.getLinkUrl().startsWith('https://wa.me/?text=Hi%20Meera'));
  assert.equal(cell(first, 4, 8).v, '');
  assert.equal(cell(first, 4, 9).v, '');
  assert.equal(cell(first, 2, 9).wrapStrategy, 'CLIP');
});

test("your own columns headed WhatsApp / Link / Message are never overwritten", () => {
  const head = [...HEAD, 'WhatsApp', 'Link', 'Message'];
  const { gs, first } = setupSheets([
    head,
    ['Meera Kapoor', 'F', 'NA', 'NA', 'NA', '', 'k7m2', '+91 90000 00000', 'photos.example/meera', 'call after 6'],
  ], [head]);
  const tabs = gs.prepareListTabs_(gs.ss_());
  gs.fillLinks_(tabs, BEFORE, []);
  assert.equal(cell(first, 2, 8).v, '+91 90000 00000');
  assert.equal(cell(first, 2, 9).v, 'photos.example/meera');
  assert.equal(cell(first, 2, 10).v, 'call after 6');
  // The script's columns went after the last used column instead
  assert.equal(cell(first, 1, 11).v, 'Personal link');
  assert.equal(cell(first, 2, 11).v, 'https://saumy-weds-manorika.github.io/?g=k7m2');
});

test('a duplicate ID gets a warning instead of a link to someone else\'s ticket', () => {
  const { gs, first, second } = setupSheets(
    [HEAD, ['Meera Kapoor', 'F', 'NA', 'NA', 'NA', '', 'k7m2'], ['Kabir Khan', 'M', 'NA', 'NA', 'NA', '', 'z8q4']],
    [HEAD, ['Rohan Mehta', 'M', 'NA', 'NA', 'NA', '', 'K7M2']],
  );
  const tabs = gs.prepareListTabs_(gs.ss_());
  const ids = JSON.parse(JSON.stringify(gs.fillIds_(tabs)));
  assert.deepEqual(ids.dupes, ['k7m2']);
  const out = JSON.parse(JSON.stringify(gs.fillLinks_(tabs, BEFORE, ids.dupes)));
  assert.deepEqual(out, { filled: 1, skipped: 2 });
  assert.match(String(cell(first, 2, 8).v), /^Duplicate ID "k7m2"/);
  assert.match(String(cell(second, 2, 8).v), /^Duplicate ID "k7m2"/);
  assert.equal(cell(second, 2, 9).v, '');
  assert.equal(cell(first, 3, 8).v, 'https://saumy-weds-manorika.github.io/?g=z8q4');
  assert.match(gs.linksMessage_(out), /2 rows have a duplicate ID/);
});

test('firstName_ greets by first name and handles titles and initials', () => {
  const { gs } = setupSheets([HEAD]);
  assert.equal(gs.firstName_('Rahul Sharma'), 'Rahul');
  assert.equal(gs.firstName_('Dr. Anil Verma'), 'Anil');
  assert.equal(gs.firstName_('Mrs Verma'), 'Mrs Verma');
  assert.equal(gs.firstName_('A. K. Sharma'), 'A. K. Sharma');
  assert.equal(gs.firstName_('Tara'), 'Tara');
  assert.equal(gs.firstName_(''), '');
});

test('guest search reads only the guest-list columns, not the long messages', () => {
  const { gs, first } = setupSheets([HEAD, ['Meera Kapoor', 'F', 'NA', 'NA', 'NA', '', 'k7m2']]);
  gs.fillLinks_(gs.prepareListTabs_(gs.ss_()), BEFORE, []);
  let widest = 0;
  const orig = first.getRange.bind(first);
  first.getRange = (r, c, nr = 1, nc = 1) => { if (nr > 1) widest = Math.max(widest, c + nc - 1); return orig(r, c, nr, nc); };
  const guests = JSON.parse(JSON.stringify(gs.readAllGuests_(gs.ss_())));
  assert.equal(guests[0].label, 'Meera Kapoor');
  assert.equal(widest, 7);
});

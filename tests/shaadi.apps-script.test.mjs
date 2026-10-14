import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import * as logic from '../shaadi/js/logic.js';
import { CONFIG } from '../shaadi/js/config.js';
import { AIRPORTS, JUNCTIONS, BHILWARA_STATION } from '../shaadi/js/travel-data.js';
import { Sheet, Spreadsheet, load } from './shaadi-fake-sheets.mjs';

// apps-script-shaadi/Code.gs: the family edition's backend, on a fake Sheet. Fictional names only.

const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const fresh = (opts) => {
  const ss = new Spreadsheet([new Sheet('Sheet1')]);
  return { ss, gs: load(ss, opts) };
};

const travel = { mode: 'train', from: 'Pune', arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'morning' }, via: { hub: 'COR', onward: 'car' } };
const payload = (extra = {}) => ({
  action: 'rsvp', id: 's-k7m2ab9z', relation: 'ladki-sakhiyaan', label: 'Asha Rao',
  guests: [
    { name: 'Asha Rao', status: 'confirmed', gender: 'F', age: 34 },
    { name: 'Ravi Rao', status: 'waitlisted', gender: 'M', age: 7, added: true },
  ],
  travel, note: 'See you soon', filled_by: 'Asha Rao', client: { ts: '2026-10-14T10:00:00Z', ua: 'test' }, ...extra,
});
const post = (gs, body) => JSON.parse(gs.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());

test('Code.gs is up to date with its template and the friends edition (tools/build-shaadi-gs.py)', () => {
  const before = readFileSync(new URL('../apps-script-shaadi/Code.gs', import.meta.url), 'utf8');
  execFileSync('python', ['tools/build-shaadi-gs.py'], { stdio: 'ignore' });
  const after = readFileSync(new URL('../apps-script-shaadi/Code.gs', import.meta.url), 'utf8');
  assert.equal(after, before, 'run python tools/build-shaadi-gs.py and commit the result');
});

test('RELATIONS, MAX_GUESTS and HUBS match the website', () => {
  const { gs } = fresh();
  const constant = (name) => plain(vm.runInContext(name, gs));
  assert.deepEqual(constant('RELATIONS').map((r) => [r.id, r.label, r.side]), CONFIG.relations.map((r) => [r.id, r.label, r.side]));
  assert.equal(constant('MAX_GUESTS'), CONFIG.maxGuests);
  assert.equal(constant('AGE_MAX'), logic.AGE_MAX);
  assert.deepEqual(constant('HUBS').map((h) => h.code), [BHILWARA_STATION.code, ...JUNCTIONS.map((j) => j.code), ...AIRPORTS.map((a) => a.code)]);
});

test('validatePayload_ agrees with logic.validatePayload on a corpus of good and bad tickets', () => {
  const { gs } = fresh();
  const six = Array.from({ length: 6 }, (_, i) => ({ name: `Guest ${i + 1}`, status: 'confirmed', gender: '', age: 10 * i }));
  const corpus = [
    payload(),
    payload({ guests: six }),
    payload({ guests: [...six, { name: 'Seven', status: 'confirmed', age: 1 }] }),
    payload({ guests: [] }),
    payload({ id: 'u-abcdefgh' }),
    payload({ id: 'k7m2' }),
    payload({ relation: 'friends' }),
    payload({ relation: undefined }),
    payload({ label: '' }),
    payload({ guests: [{ name: '', status: 'confirmed', age: 3 }] }),
    payload({ guests: [{ name: 'A', status: 'maybe', age: 3 }] }),
    payload({ guests: [{ name: 'A', status: 'confirmed', age: '3' }] }),
    payload({ guests: [{ name: 'A', status: 'confirmed', age: 121 }] }),
    payload({ guests: [{ name: 'A', status: 'confirmed', age: 2.5 }] }),
    payload({ guests: [{ name: 'A', status: 'confirmed', age: 0, gender: 'X' }] }),
    payload({ guests: [{ name: 'A', status: 'confirmed', age: 0, added: 'y' }] }),
    payload({ guests: [{ name: 'A', status: 'regret', age: 50 }], travel: null }),
    payload({ guests: [{ name: 'A', status: 'confirmed', age: 50 }], travel: null }),
    payload({ travel: { ...travel, mode: 'local', from: '', arrive: {}, depart: {} } }),
    payload({ travel: { ...travel, arrive: { date: '2026-12-12', slot: 'morning' } } }),
    payload({ travel: { ...travel, depart: { date: '2026-12-08', slot: 'morning' } } }),
    payload({ travel: { ...travel, via: { hub: 'udr', onward: 'car' } } }),
    payload({ note: 'x'.repeat(501) }),
    payload({ action: 'find' }),
  ];
  for (const p of corpus) {
    assert.deepEqual(plain(gs.validatePayload_(p)), logic.validatePayload(p), JSON.stringify(p).slice(0, 160));
  }
});

test('doPost saves a ticket: one Responses row, one People row per guest, ages as numbers', () => {
  const { ss, gs } = fresh();
  gs.setup();
  const res = post(gs, payload());
  assert.equal(res.ok, true);
  assert.equal(res.id, 's-k7m2ab9z');
  const responses = ss.getSheetByName('Responses');
  const people = ss.getSheetByName('People');
  assert.deepEqual(responses.rows(4).slice(1).map((r) => r.slice(1)), [['s-k7m2ab9z', 'ladki-sakhiyaan', 'Asha Rao']]);
  const stored = JSON.parse(responses.get(2, 5));
  assert.deepEqual(stored.guests[1], { name: 'Ravi Rao', status: 'waitlisted', gender: 'M', age: 7, added: true });
  const head = people.rows()[0];
  assert.deepEqual(head, ['id', 'side', 'relation', 'label', 'person', 'gender', 'age', 'status', 'mode', 'from', 'hub', 'onward',
    'arrive_date', 'arrive_slot', 'depart_date', 'depart_slot', 'note', 'filled_by', 'updated_at', 'added']);
  const rows = people.rows().slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].side, 'Ladki Wale side (Manorika)');
  assert.equal(rows[0].relation, 'Ladki Ki Sakhiyaan');
  assert.equal(rows[0].age, 34);
  assert.equal(rows[1].age, 7);
  assert.equal(rows[1].added, true);
  assert.equal(rows[0].hub, 'COR');
  assert.equal(rows[0].onward, 'car');
  assert.equal(rows[0].note, 'See you soon');
});

test('editing a ticket replaces its People rows; other tickets are kept', () => {
  const { ss, gs } = fresh();
  gs.setup();
  post(gs, payload());
  post(gs, payload({ id: 's-otherone', relation: 'ladke-wale', label: 'Dev Shah', guests: [{ name: 'Dev Shah', status: 'confirmed', gender: 'M', age: 61 }] }));
  post(gs, payload({ relation: 'ladki-wale', guests: [{ name: 'Asha Rao', status: 'regret', gender: 'F', age: 34 }], travel: null }));
  const people = ss.getSheetByName('People').rows().slice(1);
  assert.deepEqual(people.map((r) => [r[0], r[2], r[4], r[7]]), [
    ['s-otherone', 'Ladke Wale', 'Dev Shah', 'confirmed'],
    ['s-k7m2ab9z', 'Ladki Wale', 'Asha Rao', 'regret'],
  ]);
  assert.equal(people[1][8], ''); // a regret row has no travel
  assert.equal(ss.getSheetByName('Responses').getLastRow(), 4);
  // rebuildPeople gives the same rows from the Responses log
  gs.rebuildPeople();
  assert.deepEqual(ss.getSheetByName('People').rows().slice(1).map((r) => [r[0], r[2], r[4], r[7]]), [
    ['s-k7m2ab9z', 'Ladki Wale', 'Asha Rao', 'regret'],
    ['s-otherone', 'Ladke Wale', 'Dev Shah', 'confirmed'],
  ]);
});

test('doPost refuses bad requests with the codes the website understands', () => {
  const { gs } = fresh();
  gs.setup();
  assert.equal(post(gs, '').code, 'bad_request');
  assert.equal(post(gs, '{not json').code, 'bad_request');
  assert.equal(post(gs, payload({ relation: 'x' })).code, 'invalid');
  const seven = Array.from({ length: 7 }, (_, i) => ({ name: `G${i}`, status: 'confirmed', age: 20 }));
  assert.equal(post(gs, payload({ guests: seven })).code, 'too_many');
  const busy = fresh({ lockBusy: true });
  assert.equal(post(busy.gs, payload()).code, 'busy');
  assert.equal(JSON.parse(gs.doGet({ parameter: {} }).getContent()).version, 'shaadi-v2');
  assert.equal(JSON.parse(gs.doGet({ parameter: { action: 'find', q: 'asha' } }).getContent()).code, 'bad_request');
});

test('setup builds the three tabs, removes the empty starter tab and writes the Summary', () => {
  const { ss, gs } = fresh();
  gs.setup();
  assert.deepEqual(ss.getSheets().map((s) => s.getName()), ['Summary', 'People', 'Responses']);
  const summary = ss.getSheetByName('Summary');
  const text = summary.rows().flat().filter((v) => typeof v === 'string');
  for (const rel of CONFIG.relations) assert.ok(text.includes(rel.label), rel.label);
  for (const want of ['Ladke Wale side (Saumy), total', 'Ladki Wale side (Manorika), total', 'Everyone who answered',
    '0–5 (little ones)', '60+ (elders)', 'Nights in Bhilwara (travelling guests)', 'Arrivals by hub (confirmed + waitlisted, all dates, not locals)',
    'Everyone who replied, by relation', 'Notes from guests']) {
    assert.ok(text.includes(want), want);
  }
  // Formulas point at the right People columns: relation C, age G, status H
  const formulas = text.filter((v) => v.startsWith('='));
  assert.ok(formulas.some((f) => f.includes('COUNTIFS(People!$C$2:$C,"Ladke Ke Dost",People!$H$2:$H,"confirmed")')));
  assert.ok(formulas.some((f) => f.includes('(People!$G$2:$G>=60)*(People!$G$2:$G<=120)')));
  // A second setup is safe and keeps responses
  post(gs, payload());
  gs.setup();
  assert.equal(ss.getSheetByName('Responses').getLastRow(), 2);
  assert.equal(ss.getSheetByName('People').getLastRow(), 3);
});

test('setup relabels People rows saved with an older relation spelling, so the Summary counts them', () => {
  const { ss, gs } = fresh();
  gs.setup();
  post(gs, payload({ relation: 'mayra-ladke' }));
  const people = ss.getSheetByName('People');
  people.set(2, 3, 'Mayra (Ladke Wale)'); // as shaadi-v1 wrote it
  people.set(3, 3, 'Mayra (Ladke Wale)');
  assert.equal(gs.hasOldRelationLabels_(people), true);
  gs.setup();
  assert.deepEqual(ss.getSheetByName('People').rows().slice(1).map((r) => r[2]), ['Maayra (Ladke Wale)', 'Maayra (Ladke Wale)']);
  assert.equal(gs.hasOldRelationLabels_(ss.getSheetByName('People')), false);
});

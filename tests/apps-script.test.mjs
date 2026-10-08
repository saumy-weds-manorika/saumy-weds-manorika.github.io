import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as logic from '../js/logic.js';
import { AIRPORTS, JUNCTIONS, BHILWARA_STATION } from '../js/travel-data.js';

// apps-script/Code.gs is plain Apps Script (no exports). Load it into a sandbox: nothing Google-specific
// runs at load time, so its pure helpers can be checked here, including against js/logic.js.
const ctx = vm.createContext({ console });
vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx, { filename: 'Code.gs' });
/** Calls a Code.gs function; the result is copied into this realm so deepEqual compares plain values. */
const gs = (name, ...args) => {
  const out = ctx[name](...args);
  return out === undefined ? undefined : JSON.parse(JSON.stringify(out));
};
const gsConst = (name) => JSON.parse(JSON.stringify(vm.runInContext(name, ctx)));

/* ---------- §B: search parity with js/logic.js ---------- */

const ENTRIES = [
  { id: 'k7m2', label: 'Rahul Sharma & Priya Sharma', names: ['Rahul Sharma', 'Priya Sharma'], aliases: [] },
  { id: 'v9v9', label: 'Rahul Verma', names: ['Rahul Verma'], aliases: [] },
  { id: 'p3x9', label: 'Mr & Mrs Agarwal', names: ['Mr Agarwal', 'Mrs Agarwal'], aliases: [] },
  { id: 'a1b2', label: 'Ananya Iyer', names: ['Ananya Iyer'], aliases: ['Annu'] },
  { id: 'r0m1', label: 'Rohan Mehta', names: ['Rohan Mehta'], aliases: [] },
  { id: 'z8q4', label: 'Mr & Mrs Kabir Khan', names: ['Kabir Khan'], aliases: [] },
  { id: 'm4t8', label: 'Arjun Mehra & Tara', names: ['Arjun Mehra', 'Tara'], aliases: ['AJ', 'Arju Bhai'] },
  { id: 'i5a6', label: 'Isha Agarwal', names: ['Isha Agarwal'], aliases: [] },
  { id: 'j0s3', label: 'José María Núñez', names: ['José María Núñez'], aliases: ['Pepe'] },
  { id: 'c4d4', label: 'Christopher Fernandes', names: ['Christopher Fernandes'], aliases: [] },
  { id: 'e1e1', label: 'Zoë O\'Brien-Smith', names: ['Zoë O\'Brien-Smith'], aliases: ['Zo'] },
];
const QUERIES = [
  'rahul', 'Rahul Sharma', 'rahulsharma', 'shar', 'priya s', 'agrawal', 'Rohan Kumar Mehta', 'annu', 'rahl',
  'mr', 'ra', 'hul', 'xyz abc', '', 'manorica', 'mehta', 'mehra', 'kabir', 'mrs khan', 'Mr & Mrs Agarwal',
  'jose', 'Núñez', 'nunez', 'maria jose', 'christofer', 'cristopher fernandez', 'fernandes chris', 'zoe', 'obrien',
  'o brien', 'arjubhai', 'aj', 'tara', 'isha agrwal', 'ISHA', '  ana  ', 'ananya iyer', 'iyer ananya', 'the rahul',
  'dr rohan', 'r a h u l', 'rahul-sharma', 'priyasharma', 'kabirkhan', 'smt priya', 'abc', 'zzzz',
];

/** A few hundred extra queries: name words with 0-2 random typos, sometimes paired with another word. */
function fuzzQueries() {
  let seed = 20261210;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const words = [...new Set(ENTRIES.flatMap((e) => [e.label, ...e.names, ...e.aliases]).flatMap((s) => logic.normalizeName(s).split(' ')).filter(Boolean))];
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const typo = (w) => {
    const i = rand(Math.max(1, w.length));
    switch (rand(4)) {
      case 0: return w.slice(0, i) + w.slice(i + 1);
      case 1: return w.slice(0, i) + letters[rand(26)] + w.slice(i);
      case 2: return w.slice(0, i) + letters[rand(26)] + w.slice(i + 1);
      default: return i + 1 < w.length ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2) : w;
    }
  };
  const out = [];
  for (let k = 0; k < 400; k++) {
    let q = words[rand(words.length)];
    for (let t = rand(3); t > 0; t--) q = typo(q);
    if (rand(3) === 0) q += ` ${words[rand(words.length)]}`;
    if (rand(5) === 0) q = q.slice(0, 3 + rand(4));
    out.push(q);
  }
  return out;
}

test('Code.gs normalizeName_ matches logic.normalizeName', () => {
  for (const s of ['  Rähul   Sharma! ', 'Mr. & Mrs. Agarwal', 'José-María', "Zoë O'Brien", 'श्रेया शर्मा', 'Ånnu  🌸 ', '', null, undefined, 123, 'A B']) {
    assert.equal(gs('normalizeName_', s), logic.normalizeName(s), JSON.stringify(s));
  }
});

test('Code.gs matchScore_ gives identical scores to logic.matchScore (examples + fuzz)', () => {
  let compared = 0;
  for (const q of [...QUERIES, ...fuzzQueries()]) {
    for (const e of ENTRIES) {
      assert.equal(gs('matchScore_', q, e), logic.matchScore(q, e), `query ${JSON.stringify(q)} vs ${e.label}`);
      compared++;
    }
  }
  assert.ok(compared > 4000);
  // The worked examples from tests/logic.v2.test.mjs, against Code.gs directly.
  const [RS, RV, AG, AI, RM] = ENTRIES;
  assert.equal(gs('matchScore_', 'rahul', RS), 3.1);
  assert.equal(gs('matchScore_', 'Rahul Sharma', RS), 6.2);
  assert.equal(gs('matchScore_', 'rahulsharma', RS), 6);
  assert.equal(gs('matchScore_', 'shar', RS), 2.1);
  assert.equal(gs('matchScore_', 'priya s', RS), 3.1);
  assert.equal(gs('matchScore_', 'agrawal', AG), 1.1);
  assert.equal(gs('matchScore_', 'Rohan Kumar Mehta', RM), 6.2);
  assert.equal(gs('matchScore_', 'annu', AI), 3.1);
  assert.equal(gs('matchScore_', 'rahl', RV), 1.1);
  for (const q of ['mr', 'ra', 'hul', 'xyz abc', '']) assert.equal(gs('matchScore_', q, RS), 0, q);
});

test('Code.gs searchGuests_ ranks exactly like logic.searchGuests', () => {
  for (const q of [...QUERIES, ...fuzzQueries().slice(0, 150)]) {
    for (const limit of [undefined, 5, 1, 0]) {
      assert.deepEqual(gs('searchGuests_', q, ENTRIES, limit), logic.searchGuests(q, ENTRIES, limit), `${JSON.stringify(q)} limit ${limit}`);
    }
  }
  assert.deepEqual(gs('searchGuests_', 'rahul', ENTRIES).map((r) => r.id), ['k7m2', 'v9v9']);
  assert.deepEqual(gs('searchGuests_', 'rohan kumar mehta', ENTRIES).map((r) => r.id), ['r0m1']);
  assert.deepEqual(gs('searchGuests_', 'zzz', ENTRIES), []);
});

/* ---------- §A: Saumy's workbook format ---------- */

const HEAD = ['Guest 1', 'Gender Guest 1', 'Guest 2', 'Gender Guest 2', 'Both Primary?', 'Nicknames', 'ID'];

test('list tabs: "First List" is Primary, "Second List" is Secondary, case- and space-insensitive', () => {
  assert.equal(gs('listOf_', 'First List'), 'Primary');
  assert.equal(gs('listOf_', ' second   LIST '), 'Secondary');
  assert.equal(gs('listOf_', 'Primary'), 'Primary');
  assert.equal(gs('listOf_', 'Secondary guests'), 'Secondary');
  for (const other of ['Summary', 'People', 'Responses', 'Sheet3', 'First or Second?', '']) assert.equal(gs('listOf_', other), '', other);
});

test('list columns: found by header text, with the usual positions as a fallback', () => {
  assert.deepEqual(gs('listColumns_', HEAD), { guest1: 0, gender1: 1, guest2: 2, gender2: 3, both: 4, nick: 5, id: 6 });
  // Saumy's original file: no Nicknames / ID yet (setup adds them).
  assert.deepEqual(gs('listColumns_', HEAD.slice(0, 5)), { guest1: 0, gender1: 1, guest2: 2, gender2: 3, both: 4, nick: -1, id: -1 });
  // Extra columns and a different order still work.
  assert.deepEqual(gs('listColumns_', ['S.No', 'ID', 'Guest 1', 'Gender Guest 1', 'Guest 2', 'Gender Guest 2', 'Both Primary', 'Notes', 'Nicknames']),
    { guest1: 2, gender1: 3, guest2: 4, gender2: 5, both: 6, nick: 8, id: 1 });
  // Unrecognised headers fall back to A–E; Nicknames/ID are never guessed.
  assert.deepEqual(gs('listColumns_', ['Friend', 'Sex', 'Plus one', 'Sex 2', 'Both?', 'Notes']),
    { guest1: 0, gender1: 1, guest2: 2, gender2: 3, both: 4, nick: -1, id: -1 });
  // Both gender columns headed plain "Gender": the second one is still Gender Guest 2.
  assert.deepEqual(gs('listColumns_', ['Guest 1', 'Gender', 'Guest 2', 'Gender', 'Both Primary?']),
    { guest1: 0, gender1: 1, guest2: 2, gender2: 3, both: 4, nick: -1, id: -1 });
});

test('parseListRows_: names, genders, partner, labels, couple, aliases, NA handling (fictional rows)', () => {
  const rows = [
    HEAD,
    ['Meera Kapoor', 'F', 'Dev Malhotra', 'M', 'Y', 'Meeru, Mee ', 'K7M2 '],
    ['Arjun Mehra', 'M', 'Tara', 'F', 'N', '', 'm4t8'],
    ['Kabir Khan', 'M', 'Mrs', 'NA', 'N', 'NA', 'z8q4'],
    ['Ananya Iyer', 'F', 'NA', 'NA', 'NA', 'Annu', ''],
    ['Vikram Rao', 'M', 'mr.', '', 'n/a', '', 'v1r2'],
    ['  ', 'F', 'Someone', 'M', 'N', '', 'x1y2'],
    ['NA', '', '', '', '', '', 'x9y9'],
    ['Sara  Thomas ', 'f', '-', '-', '-', '', ''],
    ['Neha Gupta', 'F', 'Ms', 'F', 'N', '', 'n3g4'],
    ['Farhan Ali', 'Male', 'Zoya', '', 'yes', '', 'f5a6'],
    ['Pooja Nair', 'F', 'Mr', 'M', 'N', '', 'p0n1'],
    ['Karan Shah', 'M', 'Mrs .', 'N.A', 'N', '--', 'k1s2'],
    ['Amit Joshi', '', 'Smt', '', 'N', '', 'a2j3'],
    ['Ravi Das', 'M', 'Miss', '', 'N', '', 'r3d4'],
    ['Leela Rao', 'F', 'N / A', 'n.a', 'N.A', '', 'l4r5'],
  ];
  const base = { max_guests: 4, list: 'Primary', aliases: [], partner: null, couple: false };
  assert.deepEqual(gs('parseListRows_', rows, 'Primary'), [
    { ...base, id: 'k7m2', label: 'Meera Kapoor & Dev Malhotra', names: ['Meera Kapoor', 'Dev Malhotra'], genders: ['F', 'M'], couple: true, aliases: ['Meeru', 'Mee'] },
    { ...base, id: 'm4t8', label: 'Arjun Mehra & Tara', names: ['Arjun Mehra', 'Tara'], genders: ['M', 'F'] },
    { ...base, id: 'z8q4', label: 'Mr & Mrs Kabir Khan', names: ['Kabir Khan'], genders: ['M'], partner: { title: 'Mrs', gender: 'F' } },
    { ...base, id: '', label: 'Ananya Iyer', names: ['Ananya Iyer'], genders: ['F'], aliases: ['Annu'] },
    // A title partner reads "Mr & Mrs <Guest 1>" only for the usual pairing; anything else is "<Guest 1> & partner"
    { ...base, id: 'v1r2', label: 'Vikram Rao & partner', names: ['Vikram Rao'], genders: ['M'], partner: { title: 'Mr', gender: 'M' } },
    { ...base, id: '', label: 'Sara Thomas', names: ['Sara Thomas'], genders: ['F'] },
    { ...base, id: 'n3g4', label: 'Neha Gupta & partner', names: ['Neha Gupta'], genders: ['F'], partner: { title: 'Ms', gender: 'F' } },
    { ...base, id: 'f5a6', label: 'Farhan Ali & Zoya', names: ['Farhan Ali', 'Zoya'], genders: ['M', ''], couple: true },
    { ...base, id: 'p0n1', label: 'Mrs Pooja Nair & Mr Nair', names: ['Pooja Nair'], genders: ['F'], partner: { title: 'Mr', gender: 'M' } },
    // Title and "nothing here" variants: "Mrs ." / "Smt" / "Miss", "N.A" / "--" / "N / A" / "n.a"
    { ...base, id: 'k1s2', label: 'Mr & Mrs Karan Shah', names: ['Karan Shah'], genders: ['M'], partner: { title: 'Mrs', gender: 'F' } },
    { ...base, id: 'a2j3', label: 'Mr & Mrs Amit Joshi', names: ['Amit Joshi'], genders: [''], partner: { title: 'Mrs', gender: 'F' } },
    { ...base, id: 'r3d4', label: 'Mr & Mrs Ravi Das', names: ['Ravi Das'], genders: ['M'], partner: { title: 'Ms', gender: 'F' } },
    { ...base, id: 'l4r5', label: 'Leela Rao', names: ['Leela Rao'], genders: ['F'] },
  ]);
  const secondary = gs('parseListRows_', [HEAD.slice(0, 5), ['Rohan Mehta', 'M', 'NA', 'NA', 'NA']], 'Secondary');
  assert.deepEqual(secondary, [{ ...base, list: 'Secondary', id: '', label: 'Rohan Mehta', names: ['Rohan Mehta'], genders: ['M'] }]);
  assert.deepEqual(gs('parseListRows_', [HEAD], 'Primary'), []);
  assert.equal(gsConst('MAX_GUESTS'), 4);
});

test('lookupList_: only rows with an ID, first one wins when an ID repeats', () => {
  const list = gs('lookupList_', [{ id: 'aaaa', label: 'One' }, { id: '', label: 'No id' }, { id: 'aaaa', label: 'Dupe' }, { id: 'bbbb', label: 'Two' }]);
  assert.deepEqual(list.map((e) => e.label), ['One', 'Two']);
});

test('publicGuest_: the §A lookup record, nicknames left out', () => {
  const [entry] = gs('parseListRows_', [HEAD, ['Kabir Khan', 'M', 'Mrs', '', 'N', 'KK', 'z8q4']], 'Secondary');
  assert.deepEqual(gs('publicGuest_', entry, null), {
    id: 'z8q4', label: 'Mr & Mrs Kabir Khan', names: ['Kabir Khan'], genders: ['M'], partner: { title: 'Mrs', gender: 'F' },
    max_guests: 4, couple: false, list: 'Secondary', booked: null,
  });
});

/* ---------- §C / §D / §L: validation, stored payloads and People rows ---------- */

const travel = { mode: 'train', from: 'Pune', arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'morning' } };
const base = { action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul Sharma & Priya Sharma', travel, note: '', filled_by: 'Priya Sharma' };
const one = (g) => ({ ...base, guests: [{ name: 'Rahul', status: 'confirmed', ...g }] });

test('validatePayload_ agrees with logic.validatePayload (ok / not ok)', () => {
  const cases = [
    one({ gender: 'M' }), one({ gender: '' }), one({}), one({ gender: 'X' }), one({ gender: null }),
    one({ added: true }), one({ partner: false }), one({ added: 'yes' }),
    { ...one({}), filled_by: 'x'.repeat(101) }, { ...one({}), filled_by: 42 }, { ...one({}), filled_by: null },
    { ...one({ status: 'regret' }), travel: null }, { ...one({}), travel: null },
    { ...one({}), travel: { ...travel, from: '' } }, { ...one({}), travel: { ...travel, mode: 'boat' } },
    { ...one({}), travel: { ...travel, arrive: { date: '2026-12-13', slot: 'night' } } },
    { ...one({}), travel: { ...travel, arrive: { date: 'soon', slot: 'evening' } } },
    { ...one({}), unlisted: true }, { ...one({}), unlisted: true, id: 'u-abcd1234' },
    { ...one({}), note: 'x'.repeat(501) }, { ...one({}), guests: [] }, { ...one({}), action: 'nope' },
    { ...base, guests: [{ name: 'Rahul', status: 'confirmed', gender: 'M' }, { name: 'Zoya', status: 'confirmed', gender: 'F', partner: true }, { name: 'Dev', status: 'waitlisted', gender: 'M', added: true }] },
    null, 'rsvp',
  ];
  for (const p of cases) assert.equal(gs('validatePayload_', p).ok, logic.validatePayload(p).ok, JSON.stringify(p));
});

const localTravel = { mode: 'local', from: 'Bhilwara', arrive: { date: 'unsure', slot: 'unsure' }, depart: { date: 'unsure', slot: 'unsure' } };

test('validatePayload_ / cleanPayload_: local (Bhilwara) guests need no city or dates', () => {
  assert.equal(gsConst('MODES').includes('local'), true);
  assert.equal(gs('validatePayload_', { ...one({}), travel: localTravel }).ok, true);
  assert.equal(gs('validatePayload_', { ...one({}), travel: { ...localTravel, from: '' } }).ok, true);
  const blank = { mode: 'local', from: '', arrive: { date: '', slot: '' }, depart: {} };
  assert.equal(gs('validatePayload_', { ...one({}), travel: blank }).ok, true);
  assert.deepEqual(gs('cleanPayload_', { ...one({}), travel: blank }).travel, localTravel);
  assert.equal(gs('validatePayload_', { ...one({}), travel: { ...localTravel, arrive: { date: 'soon', slot: 'unsure' } } }).ok, false);
  assert.equal(gs('validatePayload_', { ...one({}), travel: { ...travel, from: '' } }).ok, false, 'travellers still need a city');
});

test('cleanPayload_: keeps gender, true-only flags and filled_by; drops anything else', () => {
  const clean = gs('cleanPayload_', {
    ...base, id: ' K7M2 ', filled_by: ' Priya Sharma ', extra: 'dropped', client: { ts: 't', ua: 'u'.repeat(400) },
    guests: [
      { name: ' Rahul Sharma ', status: 'confirmed', gender: 'M', added: false, sneaky: 1 },
      { name: 'Zoya', status: 'confirmed', partner: true },
      { name: 'Dev', status: 'regret', gender: 'M', added: true },
    ],
  });
  assert.deepEqual(clean.guests, [
    { name: 'Rahul Sharma', status: 'confirmed', gender: 'M' },
    { name: 'Zoya', status: 'confirmed', gender: '', partner: true },
    { name: 'Dev', status: 'regret', gender: 'M', added: true },
  ]);
  assert.equal(clean.id, 'k7m2');
  assert.equal(clean.filled_by, 'Priya Sharma');
  assert.equal(clean.client.ua.length, 300);
  assert.equal('extra' in clean, false);
  assert.deepEqual(clean.travel, travel);
  assert.equal(gs('cleanPayload_', { ...base, guests: [{ name: 'Rahul', status: 'regret' }] }).travel, null);
});

test('peopleRows_: one row per guest in the §G column order (v4: hub, onward after from), plus added/partner flags', () => {
  const headers = gsConst('HEADERS').People;
  assert.deepEqual(headers, ['id', 'label', 'list', 'couple', 'person', 'gender', 'status', 'mode', 'from', 'hub', 'onward',
    'arrive_date', 'arrive_slot', 'depart_date', 'depart_slot', 'note', 'filled_by', 'updated_at', 'unlisted', 'added', 'partner']);
  const when = new Date('2026-10-09T12:00:00.000Z');
  const p = gs('cleanPayload_', {
    ...base, id: 'z8q4', label: 'Mr & Mrs Kabir Khan', filled_by: 'Kabir Khan', note: 'See you!',
    guests: [{ name: 'Kabir Khan', status: 'confirmed', gender: 'M' }, { name: 'Zoya', status: 'confirmed', gender: 'F', partner: true },
      { name: 'Dev', status: 'regret', gender: 'M', added: true }],
  });
  const rows = gs('peopleRows_', p, { list: 'Secondary', couple: false }, when);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.length, headers.length);
  const at = (row, h) => row[headers.indexOf(h)];
  assert.deepEqual(rows[0], ["'z8q4", "'Mr & Mrs Kabir Khan", "'Secondary", false, "'Kabir Khan", "'M", "'confirmed", "'train", "'Pune", '', '',
    "'2026-12-09", "'evening", "'2026-12-12", "'morning", "'See you!", "'Kabir Khan", when.toISOString(), false, false, false]);
  assert.equal(at(rows[1], 'partner'), true);
  assert.equal(at(rows[2], 'added'), true);
  assert.deepEqual(['mode', 'from', 'hub', 'onward', 'arrive_date', 'arrive_slot', 'depart_date', 'depart_slot'].map((h) => at(rows[2], h)),
    ['', '', '', '', '', '', '', ''], 'regret rows have no travel');

  const local = gs('cleanPayload_', { ...one({ gender: 'M' }), travel: { mode: 'local', from: '', arrive: {}, depart: {} } });
  const [lr] = gs('peopleRows_', local, { list: 'Primary', couple: true }, when);
  assert.deepEqual(['list', 'couple', 'mode', 'from', 'arrive_date'].map((h) => at(lr, h)), ["'Primary", true, "'local", "'Bhilwara", "'unsure"]);

  const unlisted = gs('cleanPayload_', { ...one({}), id: 'u-abcd1234', unlisted: true, label: 'Meera Joshi' });
  const [ur] = gs('peopleRows_', unlisted, { list: 'Unlisted', couple: false }, when);
  assert.deepEqual([at(ur, 'list'), at(ur, 'unlisted')], ["'Unlisted", true]);
});

test('bookedFrom_: {filled_by, updated_at, payload} from a Responses row, browser details removed', () => {
  const stored = { action: 'rsvp', id: 'k7m2', label: 'Rahul Sharma & Priya Sharma', guests: [], filled_by: 'Priya Sharma', client: { ts: 't', ua: 'u' } };
  const booked = gs('bookedFrom_', new Date('2026-10-09T12:00:00.000Z'), JSON.stringify(stored));
  assert.deepEqual(booked, { filled_by: 'Priya Sharma', updated_at: '2026-10-09T12:00:00.000Z', payload: { action: 'rsvp', id: 'k7m2', label: 'Rahul Sharma & Priya Sharma', guests: [], filled_by: 'Priya Sharma' } });
  assert.equal(gs('bookedFrom_', new Date(), '{oops'), null);
  assert.equal(gs('bookedFrom_', new Date(), '[1]'), null);
  assert.equal(gs('bookedFrom_', '', JSON.stringify({ id: 'x' })).updated_at, '');
  // A friend's note to the couple is private: anyone can search a name, so only has_note is shared.
  const noted = gs('bookedFrom_', new Date('2026-10-09T12:00:00.000Z'), JSON.stringify({ ...stored, note: 'Please play Kesariya' }));
  assert.equal('note' in noted.payload, false);
  assert.equal(noted.has_note, true);
  assert.equal('has_note' in booked, false);
});

/* ---------- v4 §O3: travel.via, People hub/onward, Arrivals by hub ---------- */

test('API_VERSION is v4', () => {
  assert.equal(gsConst('API_VERSION'), 'v4');
});

const withVia = (via, mode = 'train') => ({ ...one({}), travel: { ...travel, mode, ...(via === undefined ? {} : { via }) } });

test('validatePayload_: via is optional; hub is a 2-5 letter code, unsure or empty; onward from the set (same cases as logic.v4)', () => {
  const ok = (via) => gs('validatePayload_', withVia(via)).ok;
  assert.equal(ok(undefined), true);
  assert.equal(ok({ hub: 'COR', onward: 'car' }), true);
  assert.equal(ok({ hub: 'unsure', onward: 'unsure' }), true);
  assert.equal(ok({ hub: '', onward: '' }), true);
  assert.equal(ok({ hub: 'cor', onward: '' }), false);
  assert.equal(ok({ hub: 'TOOLONGX', onward: '' }), false);
  assert.equal(ok({ hub: 'COR', onward: 'rocket' }), false);
});

test('validatePayload_ agrees with logic.validatePayload on via (ok flag and messages)', () => {
  const vias = [
    undefined, null, {}, { hub: 'COR', onward: 'car' }, { hub: 'unsure', onward: 'unsure' }, { hub: '', onward: '' },
    { hub: 'KOTA' }, { onward: 'bus' }, { hub: 'BHL', onward: 'car' }, { hub: 'UDR', onward: 'train' },
    { hub: 'cor', onward: '' }, { hub: 'TOOLONGX', onward: '' }, { hub: 'COR', onward: 'rocket' }, { hub: ' COR' },
    { hub: 'C', onward: '' }, { hub: 42 }, { hub: null }, { onward: null }, { onward: 'Car' }, 'COR', 7, ['COR', 'car'],
  ];
  for (const mode of ['train', 'flight', 'bus', 'car', 'local']) {
    for (const via of vias) {
      const p = withVia(via, mode);
      assert.deepEqual(gs('validatePayload_', p), JSON.parse(JSON.stringify(logic.validatePayload(p))), `${mode} ${JSON.stringify(via)}`);
    }
  }
});

test('cleanPayload_: via kept like logic.buildPayload (train/flight), emptied for other modes, left out for older pages', () => {
  const clean = (via, mode = 'train') => gs('cleanPayload_', withVia(via, mode)).travel;
  assert.deepEqual(clean({ hub: 'COR', onward: 'car' }).via, { hub: 'COR', onward: 'car' });
  assert.deepEqual(clean({ hub: 'UDR' }, 'flight').via, { hub: 'UDR', onward: '' });
  assert.deepEqual(clean({ hub: 'BHL', onward: 'car' }).via, { hub: 'BHL', onward: '' }, 'getting off at Bhilwara drops the onward leg');
  for (const mode of ['bus', 'car', 'local']) assert.deepEqual(clean({ hub: 'COR', onward: 'car' }, mode).via, { hub: '', onward: '' }, mode);
  assert.equal('via' in clean(undefined), false, 'a payload from an older page is stored exactly as before');
  assert.equal('via' in clean(null), false);
  // Same {hub, onward} as the website builds for that travel.
  const state = (t) => ({ guest: { id: 'k7m2', label: 'Rahul', unlisted: false }, guests: [{ name: 'Rahul', status: 'confirmed', gender: 'M' }], travel: t, note: '' });
  for (const mode of ['train', 'flight', 'bus', 'car']) {
    for (const via of [{ hub: 'COR', onward: 'car' }, { hub: 'UDR' }, { hub: 'BHL', onward: 'bus' }, { hub: 'unsure', onward: 'unsure' }, {}]) {
      const t = { ...travel, mode, via };
      assert.deepEqual(gs('cleanPayload_', withVia(via, mode)).travel.via, logic.buildPayload(state(t), { ts: 't', ua: 'u' }).travel.via, `${mode} ${JSON.stringify(via)}`);
    }
  }
});

test('peopleRows_: hub and onward columns (blank for regret, other modes, older answers and malformed values)', () => {
  const headers = gsConst('HEADERS').People;
  const at = (row, h) => row[headers.indexOf(h)];
  const when = new Date('2026-10-09T12:00:00.000Z');
  const two = (via, mode = 'train') => gs('peopleRows_', {
    ...gs('cleanPayload_', withVia(via, mode)),
    guests: [{ name: 'Rahul', status: 'confirmed', gender: 'M' }, { name: 'Dev', status: 'regret', gender: 'M' }],
  }, { list: 'Primary', couple: false }, when);
  const [going, regret] = two({ hub: 'COR', onward: 'car' });
  assert.deepEqual(['from', 'hub', 'onward', 'arrive_date'].map((h) => at(going, h)), ["'Pune", "'COR", "'car", "'2026-12-09"]);
  assert.deepEqual(['hub', 'onward'].map((h) => at(regret, h)), ['', '']);
  assert.deepEqual(['hub', 'onward'].map((h) => at(two({ hub: 'unsure', onward: 'unsure' }, 'flight')[0], h)), ["'unsure", "'unsure"]);
  assert.deepEqual(['hub', 'onward'].map((h) => at(two({ hub: 'COR', onward: 'car' }, 'bus')[0], h)), ['', '']);
  assert.deepEqual(['hub', 'onward'].map((h) => at(two(undefined)[0], h)), ['', '']);
  // rebuildPeople_ reads stored payloads straight from Responses: anything malformed is left blank.
  const stored = { id: 'k7m2', label: 'Rahul', guests: [{ name: 'Rahul', status: 'confirmed' }], travel: { ...travel, via: { hub: '=IMPORTXML("x")', onward: 'rocket' } } };
  const [row] = gs('peopleRows_', stored, { list: 'Primary', couple: false }, when);
  assert.equal(row.length, headers.length);
  assert.deepEqual(['hub', 'onward'].map((h) => at(row, h)), ['', '']);
  assert.deepEqual(['hub', 'onward'].map((h) => at(gs('peopleRows_', { ...stored, travel: { ...travel, via: 'COR' } }, { list: '', couple: false }, when)[0], h)), ['', '']);
});

/** A tiny in-memory Sheet: enough of the API for headerMatches_ and upgradePeople_. */
function memorySheet(rows) {
  const cells = rows.map((r) => r.slice());
  let maxCols = Math.max(...cells.map((r) => r.length));
  const width = (r) => { let n = r.length; while (n && (r[n - 1] === '' || r[n - 1] == null)) n--; return n; };
  return {
    cells,
    getLastRow: () => cells.length,
    getLastColumn: () => Math.max(0, ...cells.map(width)),
    getMaxColumns: () => maxCols,
    insertColumnsAfter(col, n) {
      for (const r of cells) { while (r.length < col) r.push(''); r.splice(col, 0, ...Array(n).fill('')); }
      maxCols += n;
    },
    getRange(r, c, nr = 1, nc = 1) {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (cells[r - 1 + i] || [])[c - 1 + j] ?? '')),
        setValues(values) {
          values.forEach((vals, i) => vals.forEach((v, j) => {
            while (cells.length < r + i) cells.push([]);
            const row = cells[r - 1 + i];
            while (row.length < c - 1 + j) row.push('');
            row[c - 1 + j] = v;
          }));
          return range;
        },
        setFontWeight: () => range,
      };
      return range;
    },
  };
}

test('upgradePeople_: a v3 People tab gets hub/onward after "from", every row and value kept', () => {
  const v3 = gsConst('PEOPLE_V3');
  const v4 = gsConst('HEADERS').People;
  assert.deepEqual(v4.filter((h) => !['hub', 'onward'].includes(h)), v3, 'v4 = v3 plus hub and onward');
  const rowA = v3.map((h, i) => `a${i}`);
  const rowB = v3.map((h, i) => `b${i}`);
  const sheet = memorySheet([v3, rowA, rowB]);
  assert.equal(ctx.upgradePeople_(sheet), true);
  assert.deepEqual(sheet.cells[0], v4);
  const at = (row, h) => row[v4.indexOf(h)];
  for (const [i, src] of [[1, rowA], [2, rowB]]) {
    const row = sheet.cells[i];
    assert.deepEqual([at(row, 'hub'), at(row, 'onward')], ['', '']);
    for (const h of v3) assert.equal(at(row, h), src[v3.indexOf(h)], h);
  }
  assert.equal(ctx.headerMatches_(sheet, v4), true);
  assert.equal(ctx.upgradePeople_(sheet), false, 'running it again changes nothing');
  assert.deepEqual(sheet.cells[0], v4);

  const notes = memorySheet([[...v3, 'my notes'], [...rowA, 'call back']]); // extra columns after 'partner' move along
  assert.equal(ctx.upgradePeople_(notes), true);
  assert.deepEqual(notes.cells[0], [...v4, 'my notes']);
  assert.equal(notes.cells[1].at(-1), 'call back');

  const older = memorySheet([['id', 'label', 'person', 'status'], ['k7m2', 'Rahul', 'Rahul', 'confirmed']]);
  assert.equal(ctx.upgradePeople_(older), false, 'anything else is left for rebuildPeople_');
  assert.deepEqual(older.cells[0], ['id', 'label', 'person', 'status']);
});

test('HUBS lists Bhilwara station, then the junctions and airports from js/travel-data.js, in order', () => {
  assert.deepEqual(gsConst('HUBS').map((h) => h.code), [BHILWARA_STATION.code, ...JUNCTIONS.map((j) => j.code), ...AIRPORTS.map((a) => a.code)]);
  for (const h of gsConst('HUBS')) assert.match(h.code, /^[A-Z]{2,5}$/);
});

test('hubTableRows_: one row per hub, then Not sure yet / Other code / None given / Total, locals left out', () => {
  const hubs = gsConst('HUBS');
  const P = (name) => { const L = String.fromCharCode(65 + gsConst('HEADERS').People.indexOf(name)); return `People!$${L}$2:$${L}`; };
  const { header, rows } = JSON.parse(JSON.stringify(ctx.hubTableRows_(P, 40)));
  assert.deepEqual(header, ['Hub', 'Confirmed', 'Waitlisted', 'Total', 'Then by car/cab']);
  assert.equal(rows.length, hubs.length + 4);
  assert.deepEqual(rows.map((r) => r[0]), [...hubs.map((h) => `'${h.code} · ${h.name}`), "'Not sure yet", "'Other code", "'None given (bus, car, or not picked)", 'Total']);
  for (const r of rows) assert.equal(r.length, header.length);
  rows.slice(0, -1).forEach((r, i) => {
    for (const f of [r[1], r[2], r[4]]) {
      assert.ok(f.includes('People!$J$2:$J'), 'counts by the hub column');
      assert.ok(f.includes('(People!$H$2:$H<>"local")'), 'locals left out');
    }
    assert.ok(r[1].includes('(People!$G$2:$G="confirmed")') && r[2].includes('(People!$G$2:$G="waitlisted")'));
    assert.ok(r[4].includes('(People!$K$2:$K="car")'), 'then by car/cab reads onward');
    assert.equal(r[3], `=B${40 + i}+C${40 + i}`);
  });
  assert.ok(rows[0][1].includes('(People!$J$2:$J="BHL")'));
  const other = rows[hubs.length + 1][1];
  for (const code of [...hubs.map((h) => h.code), 'unsure']) assert.ok(other.includes(`"${code}"`), code);
  assert.ok(rows[hubs.length + 2][1].includes('(People!$J$2:$J="")'));
  const last = 40 + rows.length - 2;
  assert.deepEqual(rows.at(-1), ['Total', `=SUM(B40:B${last})`, `=SUM(C40:C${last})`, `=SUM(D40:D${last})`, `=SUM(E40:E${last})`]);
});

/** Records every value and formula buildSummary_ writes, as {r, c, v}; every other Sheet call is a no-op. */
function summaryRecorder() {
  const writes = [];
  const a1 = (s) => { const m = /^([A-Z]+)(\d+)/.exec(s); return [Number(m[2]), m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)]; };
  const range = (r, c) => {
    const api = new Proxy({}, { get: (_, prop) => {
      if (prop === 'setValue' || prop === 'setFormula') return (v) => { writes.push({ r, c, v }); return api; };
      if (prop === 'setValues') return (vals) => { vals.forEach((row, i) => row.forEach((v, j) => writes.push({ r: r + i, c: c + j, v }))); return api; };
      return () => api;
    } });
    return api;
  };
  const sheet = new Proxy({}, { get: (_, prop) => {
    if (prop === 'getRange') return (a, b) => (typeof a === 'string' ? range(...a1(a)) : range(a, b));
    if (prop === 'getMaxColumns') return () => 26;
    if (prop === 'getName') return () => 'Summary';
    return () => sheet;
  } });
  return { sheet, writes };
}

test('buildSummary_: People references line up with the v4 columns; hub table above the pickup list; lists never overlap', () => {
  const col = { guest1: 0, gender1: 1, guest2: 2, gender2: 3, both: 4, nick: 5, id: 6 };
  const tabs = [{ list: 'Primary', sheet: { getName: () => 'First List' }, col }, { list: 'Secondary', sheet: { getName: () => 'Second List' }, col }];
  const { sheet, writes } = summaryRecorder();
  ctx.buildSummary_(sheet, tabs);
  const formulas = writes.filter((w) => typeof w.v === 'string' && w.v.startsWith('='));
  assert.ok(formulas.length > 50);
  const used = new Set();
  for (const { v } of formulas) {
    for (const m of v.matchAll(/People!\$([A-Z]+)\$2:\$([A-Z]+)/g)) {
      assert.equal(m[1], m[2]);
      assert.ok(m[1] >= 'A' && m[1] <= 'U' && m[1].length === 1, `People column ${m[1]} exists`);
      used.add(m[1]);
    }
    assert.ok(!/QUERY\(People!/.test(v), 'QUERY reads {…} column arrays, never People column letters');
  }
  for (const L of ['G', 'H', 'J', 'K', 'L', 'M', 'N', 'O']) assert.ok(used.has(L), `uses People column ${L}`);

  const find = (pred) => writes.find(pred);
  const hubTitle = find((w) => w.c === 1 && String(w.v).startsWith('Arrivals by hub'));
  const pickupTitle = find((w) => w.c === 1 && String(w.v).startsWith('Pickup list'));
  assert.ok(hubTitle && pickupTitle && hubTitle.r < pickupTitle.r);
  const pickup = find((w) => w.r === pickupTitle.r + 2 && w.c === 1);
  const cols = ['arrive_date', 'arrive_slot', 'person', 'status', 'mode', 'from', 'hub', 'onward', 'depart_date', 'depart_slot', 'label']
    .map((h) => { const L = String.fromCharCode(65 + gsConst('HEADERS').People.indexOf(h)); return `People!$${L}$2:$${L}`; });
  assert.ok(pickup.v.startsWith(`=IFERROR(QUERY({${cols.join(',')},`), pickup.v);
  const pickupHeader = writes.filter((w) => w.r === pickupTitle.r + 1).map((w) => w.v);
  assert.deepEqual(pickupHeader, ['Arrive date', 'Arrive time', 'Guest', 'Status', 'Mode', 'From', 'Via', 'Then by', 'Leave date', 'Leave time', 'Ticket']);
  // Nothing is written below the pickup list (it spills down), and nothing lands in the spacer columns.
  assert.equal(writes.filter((w) => w.r > pickupTitle.r + 1 && w.c <= 11).length, 1);
  for (const w of writes) assert.ok(![12, 14, 16, 23, 28].includes(w.c), `spacer column ${w.c} stays empty`);
  // The right-hand lists sit to the right of the 11-column pickup list.
  assert.deepEqual(writes.filter((w) => w.r === 3 && w.c > 1).map((w) => w.c), [13, 15, 17, 24, 29]);
  const unlisted = find((w) => w.r === 5 && w.c === 17);
  assert.ok(unlisted.v.includes('where Col7=true order by Col6 desc'));
});

/* ---------- small helpers ---------- */

test('chunk_ splits the cached list without breaking characters; runs_ groups rows', () => {
  const s = `${'a'.repeat(9)}🌸${'b'.repeat(10)}`;
  const parts = gs('chunk_', s, 10);
  assert.equal(parts.join(''), s);
  for (const part of parts) assert.ok(!/[\ud800-\udbff]$/.test(part), 'no chunk ends inside a surrogate pair');
  assert.deepEqual(gs('chunk_', '', 10), ['']);
  assert.deepEqual(gs('runs_', [2, 3, 4, 7, 9, 10]), [{ start: 2, count: 3 }, { start: 7, count: 1 }, { start: 9, count: 2 }]);
  assert.equal(gs('quoteSheet_', "Saumy's List"), "'Saumy''s List'");
  assert.match(gs('slug_'), /^[a-z][a-z0-9]{3}$/);
});

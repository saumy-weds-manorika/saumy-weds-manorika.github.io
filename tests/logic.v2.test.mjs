import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName, matchScore, searchGuests, matchesQuery, ridersFor, validatePayload, buildPayload,
} from '../js/logic.js';

const RS = { id: 'k7m2', label: 'Rahul Sharma & Priya Sharma', names: ['Rahul Sharma', 'Priya Sharma'], aliases: [] };
const RV = { id: 'v9v9', label: 'Rahul Verma', names: ['Rahul Verma'], aliases: [] };
const AG = { id: 'p3x9', label: 'Mr & Mrs Agarwal', names: ['Mr Agarwal', 'Mrs Agarwal'], aliases: [] };
const AI = { id: 'a1b2', label: 'Ananya Iyer', names: ['Ananya Iyer'], aliases: ['Annu'] };
const RM = { id: 'r0m1', label: 'Rohan Mehta', names: ['Rohan Mehta'], aliases: [] };
const KK = { id: 'z8q4', label: 'Kabir Khan', names: ['Kabir Khan'], aliases: [] };
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('normalizeName: lower-case, strip diacritics and punctuation, collapse spaces', () => {
  assert.equal(normalizeName('  Rähul   Sharma! '), 'rahul sharma');
  assert.equal(normalizeName('Mr. & Mrs. Agarwal'), 'mr mrs agarwal');
  assert.equal(normalizeName(''), '');
});

test('matchScore: exact, prefix, fuzzy, middle names, aliases, concatenation', () => {
  assert.ok(near(matchScore('rahul', RS), 3.1));
  assert.ok(near(matchScore('Rahul Sharma', RS), 6.2));
  assert.equal(matchScore('rahulsharma', RS), 6);
  assert.ok(near(matchScore('shar', RS), 2.1));
  assert.ok(near(matchScore('priya s', RS), 3.1));
  assert.ok(near(matchScore('agrawal', AG), 1.1)); // transposition typo
  assert.ok(near(matchScore('Rohan Kumar Mehta', RM), 6.2)); // unexpected middle name
  assert.ok(near(matchScore('annu', AI), 3.1)); // nickname
  assert.ok(near(matchScore('rahl', RV), 1.1)); // one letter missing
  assert.ok(matchScore('manorica', { label: 'Manorika', names: ['Manorika'], aliases: [] }) > 0);
});

test('matchScore: rejects stop words only, too-short and unrelated queries', () => {
  assert.equal(matchScore('mr', AG), 0);
  assert.equal(matchScore('ra', RS), 0);
  assert.equal(matchScore('hul', RS), 0);
  assert.equal(matchScore('xyz abc', RS), 0);
  assert.equal(matchScore('', RS), 0);
});

test('searchGuests: ranks fuller matches first, ties by label, limits results', () => {
  const all = [KK, RV, RS, AG, AI, RM];
  assert.deepEqual(searchGuests('rahul', all).map((r) => r.id), ['k7m2', 'v9v9']);
  assert.deepEqual(searchGuests('rahul sharma', all).map((r) => r.id), ['k7m2', 'v9v9']);
  assert.ok(searchGuests('rahul sharma', all)[0].score > searchGuests('rahul sharma', all)[1].score);
  assert.deepEqual(searchGuests('agrawal', all).map((r) => r.id), ['p3x9']);
  assert.deepEqual(searchGuests('rohan kumar mehta', all).map((r) => r.id), ['r0m1']);
  assert.equal(searchGuests('rahul', all, 1).length, 1);
  assert.deepEqual(searchGuests('zzz', all), []);
  assert.deepEqual(Object.keys(searchGuests('kabir', all)[0]).sort(), ['id', 'label', 'score']);
});

test('matchesQuery keeps working as a wrapper (middle-name tolerant)', () => {
  assert.equal(matchesQuery('rah', 'Rahul Sharma', []), true);
  assert.equal(matchesQuery('rahul kumar', 'Rahul Sharma', []), true);
  assert.equal(matchesQuery('hul', 'Rahul Sharma', []), false);
});

test('ridersFor: first two non-regret guests, gender fallback M then F, never more than 2', () => {
  assert.deepEqual(ridersFor([{ status: 'confirmed', gender: 'M' }, { status: 'waitlisted', gender: 'F' }]), ['M', 'F']);
  assert.deepEqual(ridersFor([{ status: 'regret', gender: 'M' }, { status: 'confirmed', gender: 'F' }]), ['F']);
  assert.deepEqual(ridersFor([{ status: '', gender: '' }, { status: '', gender: '' }]), ['M', 'F']);
  assert.deepEqual(ridersFor([{ status: 'confirmed', gender: 'F' }, { status: 'confirmed', gender: '' }]), ['F', 'F']);
  assert.equal(ridersFor([{ status: 'confirmed', gender: 'M' }, { status: 'confirmed', gender: 'F' }, { status: 'confirmed', gender: 'M' }]).length, 2);
  assert.deepEqual(ridersFor([{ status: 'regret', gender: 'M' }]), []);
  assert.deepEqual(ridersFor([]), []);
});

const travel = { mode: 'train', from: 'Pune', arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'morning' } };
const base = { action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul Sharma & Priya Sharma', travel, note: '', filled_by: 'Priya Sharma' };

test('validatePayload: gender is optional but must be M, F or empty', () => {
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Rahul', status: 'confirmed', gender: 'M' }] }).ok, true);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Rahul', status: 'confirmed', gender: '' }] }).ok, true);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Rahul', status: 'confirmed' }] }).ok, true);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Rahul', status: 'confirmed', gender: 'X' }] }).ok, false);
});

test('validatePayload: optional added/partner flags must be booleans', () => {
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Rahul', status: 'confirmed', gender: 'M' }, { name: 'Tara', status: 'confirmed', gender: 'F', partner: true }, { name: 'Dev', status: 'waitlisted', gender: 'M', added: true }] }).ok, true);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Dev', status: 'confirmed', added: 'yes' }] }).ok, false);
});

test('buildPayload: passes gender and filled_by through', () => {
  const p = buildPayload({
    guest: { id: 'k7m2', label: 'Rahul Sharma & Priya Sharma', unlisted: false },
    filledBy: ' Priya Sharma ',
    guests: [{ name: 'Rahul Sharma', status: 'confirmed', gender: 'M' }, { name: 'Priya Sharma', status: 'confirmed' }],
    travel, note: '',
  }, { ts: 't', ua: 'u' });
  assert.equal(p.filled_by, 'Priya Sharma');
  const q = buildPayload({
    guest: { id: 'z8q4', label: 'Mr & Mrs Kabir Khan', unlisted: false },
    guests: [{ name: 'Kabir Khan', status: 'confirmed', gender: 'M' }, { name: ' Zoya ', status: 'confirmed', gender: 'F', partner: true }, { name: 'Dev', status: 'waitlisted', gender: 'M', added: true }],
    travel, note: '',
  }, { ts: 't', ua: 'u' });
  assert.deepEqual(q.guests, [
    { name: 'Kabir Khan', status: 'confirmed', gender: 'M' },
    { name: 'Zoya', status: 'confirmed', gender: 'F', partner: true },
    { name: 'Dev', status: 'waitlisted', gender: 'M', added: true },
  ]); // flags only present when true
  assert.deepEqual(p.guests, [{ name: 'Rahul Sharma', status: 'confirmed', gender: 'M' }, { name: 'Priya Sharma', status: 'confirmed', gender: '' }]);
});

// --- v3: local (Bhilwara) guests skip travel details ---------------------------------------
const localTravel = { mode: 'local', from: 'Bhilwara', arrive: { date: 'unsure', slot: 'unsure' }, depart: { date: 'unsure', slot: 'unsure' } };

test('validatePayload: local guests need no travel dates or city', () => {
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Rahul', status: 'confirmed', gender: 'M' }], travel: localTravel }).ok, true);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'Rahul', status: 'confirmed', gender: 'M' }], travel: { ...localTravel, from: '' } }).ok, true);
});

test('buildPayload: local mode defaults from to Bhilwara and dates to unsure', () => {
  const p = buildPayload({
    guest: { id: 'k7m2', label: 'Rahul Sharma', unlisted: false },
    guests: [{ name: 'Rahul Sharma', status: 'confirmed', gender: 'M' }],
    travel: { mode: 'local', from: '', arrive: { date: '', slot: '' }, depart: { date: '', slot: '' } },
    note: '',
  }, { ts: 't', ua: 'u' });
  assert.deepEqual(p.travel, { ...localTravel, via: { hub: '', onward: '' } }); // v4 §O3: via always emitted
  assert.equal(validatePayload(p).ok, true);
});

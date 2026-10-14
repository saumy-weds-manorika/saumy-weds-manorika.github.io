import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as logic from '../shaadi/js/logic.js';
import * as friends from '../js/logic.js';
import { CONFIG } from '../shaadi/js/config.js';

// Shaadi (family) edition: relations, ages, the 6-guest ticket and the leave-email wording.
// Fictional names only.

const travel = { mode: 'train', from: 'Pune', arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'morning' }, via: { hub: 'COR', onward: 'car' } };
const guest = (name, extra = {}) => ({ name, status: 'confirmed', gender: 'F', age: 34, ...extra });
const payload = (extra = {}) => ({
  action: 'rsvp', id: 's-k7m2ab9z', relation: 'ladki-sakhiyaan', label: 'Asha Rao',
  guests: [guest('Asha Rao')], travel, note: '', filled_by: 'Asha Rao', client: { ts: 't', ua: 'u' }, ...extra,
});

test('relations: eight tabs, four per side, the same ids in logic, config and index.html', () => {
  assert.deepEqual(CONFIG.relations.map((r) => r.id), logic.RELATION_IDS);
  assert.deepEqual(CONFIG.relations.map((r) => r.label), [
    'Ladke Wale', 'Maayra (Ladke Wale)', 'Ladke Ke Dost', 'Ladke Ke Family Friends',
    'Ladki Wale', 'Maayra (Ladki Wale)', 'Ladki Ki Sakhiyaan', 'Ladki Ke Family Friends',
  ]);
  assert.deepEqual(CONFIG.relations.map((r) => r.side), ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
  for (const r of CONFIG.relations) assert.ok(['family', 'friend', 'family-friend'].includes(r.bond), r.id);
  assert.equal(CONFIG.sides.a.name, 'Saumy');
  assert.equal(CONFIG.sides.b.name, 'Manorika');

  // index.html: Saumy's column holds the groom-side tabs, Manorika's the bride-side ones, labels as in config
  const html = readFileSync(new URL('../shaadi/index.html', import.meta.url), 'utf8');
  for (const side of ['a', 'b']) {
    const col = html.split(`data-side="${side}"`)[1].split('</div>\n        </div>')[0];
    const tabs = [...col.matchAll(/data-value="([^"]+)">([^<]+)</g)].map((m) => ({ id: m[1], label: m[2] }));
    assert.deepEqual(tabs, CONFIG.relations.filter((r) => r.side === side).map(({ id, label }) => ({ id, label })), side);
  }
  assert.equal(logic.relationOf('ladke-dost', CONFIG.relations).label, 'Ladke Ke Dost');
  assert.equal(logic.relationOf('nope', CONFIG.relations), null);
});

test('parseAge: whole years 0 to 120, spaces, leading zeros and Devanagari digits are fine', () => {
  for (const [text, age] of [['34', 34], [' 07 ', 7], ['0', 0], ['120', 120], ['४५', 45], ['००९', 9], [5, 5], [0, 0]]) {
    assert.equal(logic.parseAge(text), age, JSON.stringify(text));
  }
  for (const text of ['', '  ', '121', '1.5', '-3', 'abc', '3 yrs', '1e2', '1234', 7.5, -1, NaN, null, undefined]) {
    assert.equal(logic.parseAge(text), null, JSON.stringify(text));
  }
});

test('buildPayload: relation, typed ages as numbers, added flags, no guest-list fields', () => {
  const p = logic.buildPayload({
    relation: 'ladke-wale',
    guest: { id: 's-k7m2ab9z', label: 'Asha Rao' },
    guests: [
      { name: ' Asha Rao ', status: 'confirmed', gender: 'F', age: ' 34 ', added: false },
      { name: 'Ravi Rao', status: 'waitlisted', gender: 'M', age: '७', added: true },
      { name: 'Baby Rao', status: 'confirmed', gender: '', age: '0', added: true },
      { name: 'Nani', status: 'regret', gender: 'F', age: 'old', added: true },
    ],
    travel, note: ' Hi! ', filledBy: 'Asha Rao',
  }, { ts: 't', ua: 'u' });
  assert.equal(p.relation, 'ladke-wale');
  assert.equal('unlisted' in p, false);
  assert.deepEqual(p.guests, [
    { name: 'Asha Rao', status: 'confirmed', gender: 'F', age: 34 },
    { name: 'Ravi Rao', status: 'waitlisted', gender: 'M', age: 7, added: true },
    { name: 'Baby Rao', status: 'confirmed', gender: '', age: 0, added: true },
    { name: 'Nani', status: 'regret', gender: 'F', age: null, added: true },
  ]);
  assert.equal(p.note, 'Hi!');
  assert.deepEqual(logic.validatePayload(p).errors, ['Pick M or F for Baby Rao.', "Add Nani's age (in years)."]);
});

test('validatePayload: M or F is required for every guest', () => {
  for (const gender of ['', undefined, null, 'X', 'm', 'Male']) {
    assert.deepEqual(logic.validatePayload(payload({ guests: [guest('Asha Rao', { gender })] })).errors, ['Pick M or F for Asha Rao.'], String(gender));
  }
  for (const gender of ['M', 'F']) assert.equal(logic.validatePayload(payload({ guests: [guest('Asha Rao', { gender })] })).ok, true, gender);
});

test('validatePayload: a good ticket passes; ids, relations, ages and the 6-guest cap are checked', () => {
  assert.deepEqual(logic.validatePayload(payload()), { ok: true, errors: [] });
  const six = Array.from({ length: 6 }, (_, i) => guest(`Guest ${i + 1}`, { age: i * 20 }));
  assert.equal(logic.validatePayload(payload({ guests: six })).ok, true);
  assert.deepEqual(logic.validatePayload(payload({ guests: [...six, guest('Seven')] })).errors, ['That is too many guests for one ticket (max 6).']);
  assert.deepEqual(logic.validatePayload(payload({ guests: [] })).errors, ['Please add at least one guest.']);
  for (const id of ['k7m2', 'u-abcdefgh', 's-ABCDEFGH', 's-abc', '', null]) {
    assert.deepEqual(logic.validatePayload(payload({ id })).errors, ['Your ticket id looks wrong. Please start a new ticket.'], String(id));
  }
  for (const relation of ['', 'ladke', 'Ladke Wale', null, undefined]) {
    assert.deepEqual(logic.validatePayload(payload({ relation })).errors, ['Pick which side you are from.'], String(relation));
  }
  for (const age of [undefined, null, '34', 121, -1, 2.5, NaN]) {
    assert.deepEqual(logic.validatePayload(payload({ guests: [guest('Asha Rao', { age })] })).errors, ["Add Asha Rao's age (in years)."], String(age));
  }
  assert.deepEqual(logic.validatePayload(payload({ guests: [guest('Asha Rao', { partner: true })] })).errors, []);
  assert.deepEqual(logic.validatePayload(payload({ guests: [guest('Asha Rao', { added: 'yes' })] })).errors,
    ["Something is off with Asha Rao's seat. Please try again."]);
  // Everyone regrets: no travel needed
  assert.equal(logic.validatePayload(payload({ guests: [guest('Asha Rao', { status: 'regret' })], travel: null })).ok, true);
});

test('leaveEmail: the wedding is described by the relation (family, close friend, family friend)', () => {
  const ctx = { name: 'Asha', arrive: '2026-12-09', depart: '2026-12-11', days: 3, couple: 'Saumy & Manorika', city: 'Bhilwara, Rajasthan' };
  const line = (kind, extra) => logic.leaveEmail(kind, { ...ctx, ...extra }).body.split('\n')[2];
  assert.match(line('formal', { bond: 'family' }), /to attend a family wedding, Saumy & Manorika's, in Bhilwara, Rajasthan\.$/);
  assert.match(line('formal', { bond: 'friend', friend: 'Manorika', partner: 'Saumy' }), /to attend the wedding of my close friend Manorika to Saumy in Bhilwara/);
  assert.match(line('honest', { bond: 'friend', friend: 'Saumy', partner: 'Manorika' }), /for the wedding of my close friend Saumy to Manorika in Bhilwara/);
  assert.match(line('formal', { bond: 'family-friend' }), /a close family friend's wedding, Saumy & Manorika's, in Bhilwara/);
  assert.match(line('formal', {}), /a family wedding/); // unknown bond reads as family
  for (const kind of ['formal', 'honest']) assert.ok(!/my close friends,/.test(logic.leaveEmail(kind, ctx).body), kind);
});

test('the shared travel helpers behave exactly like the friends edition', () => {
  for (const text of ['7', '12', '31', '2026-12-07', 'Dec 7', 'abc', '']) {
    for (const kind of ['arrive', 'depart']) assert.deepEqual(logic.customDate(text, kind), friends.customDate(text, kind), `${text} ${kind}`);
    assert.equal(logic.pastedDay(text), friends.pastedDay(text), text);
  }
  const fns = CONFIG.functions;
  for (const t of [travel, { ...travel, arrive: { date: '2026-12-11', slot: 'night' } }, { ...travel, depart: { date: 'unsure', slot: 'unsure' } }]) {
    assert.deepEqual(logic.catches(t, fns), friends.catches(t, fns));
  }
  for (const [a, d] of [['2026-12-05', '2026-12-15'], ['2026-12-10', '2026-12-11']]) assert.equal(logic.workingDays(a, d), friends.workingDays(a, d));
  const now = Date.UTC(2026, 9, 14);
  for (const mode of ['train', 'flight', 'bus', 'car', 'local']) {
    const t = { ...travel, mode };
    assert.equal(logic.arrivalLine(t, { now }), friends.arrivalLine(t, { now }), mode);
  }
  assert.deepEqual(logic.ridersFor([{ status: 'confirmed', gender: 'F' }, { status: 'regret' }, { status: '' }]), ['F', 'F']);
  assert.equal(logic.formatDate('2026-12-12'), 'Sat 12 Dec');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customDate, pastedDay, validatePayload, buildPayload, catches, workingDays, formatDate } from '../js/logic.js';

// "Other date": the guest types only the day; the month is always December 2026.

test('customDate: a typed day becomes a standard December date', () => {
  assert.deepEqual(customDate('7', 'arrive'), { ok: true, date: '2026-12-07' });
  assert.deepEqual(customDate(' 07 ', 'arrive'), { ok: true, date: '2026-12-07' });
  assert.deepEqual(customDate('1', 'arrive'), { ok: true, date: '2026-12-01' });
  assert.deepEqual(customDate('11', 'arrive'), { ok: true, date: '2026-12-11' });
  assert.deepEqual(customDate('15', 'depart'), { ok: true, date: '2026-12-15' });
  assert.deepEqual(customDate('31', 'depart'), { ok: true, date: '2026-12-31' });
  assert.deepEqual(customDate('10', 'depart'), { ok: true, date: '2026-12-10' });
});

test('customDate: empty, non-numbers and out-of-range days are rejected with a readable reason', () => {
  assert.deepEqual(customDate('', 'arrive'), { ok: false, empty: true, error: 'Type the day you arrive, e.g. 7.' });
  assert.equal(customDate('  ', 'depart').empty, true);
  for (const bad of ['abc', '7th', '1.5', '-3', '0', '32']) {
    const r = customDate(bad, 'arrive');
    assert.equal(r.ok, false, bad);
    assert.ok(typeof r.error === 'string' && r.error.length > 0, bad);
  }
  assert.equal(customDate('12', 'arrive').ok, false); // the celebrations end on the 12th
  assert.match(customDate('12', 'arrive').error, /11 Dec/);
  assert.equal(customDate('9', 'depart').ok, false); // the first function is on the 10th
  assert.match(customDate('9', 'depart').error, /10 Dec/);
});

const base = { action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul Sharma', note: '', filled_by: '', guests: [{ name: 'Rahul Sharma', status: 'confirmed', gender: 'M' }] };

test('custom dates flow through validation, payload, catches and leave days', () => {
  const travel = { mode: 'train', from: 'Pune', arrive: { date: '2026-12-05', slot: 'morning' }, depart: { date: '2026-12-15', slot: 'evening' } };
  assert.equal(validatePayload({ ...base, travel }).ok, true);
  const p = buildPayload({ guest: { id: 'k7m2', label: 'Rahul Sharma', unlisted: false }, guests: base.guests, travel, note: '' }, { ts: 't', ua: 'u' });
  assert.equal(p.travel.arrive.date, '2026-12-05');
  assert.equal(p.travel.depart.date, '2026-12-15');
  const caught = catches(travel, [{ id: 'carnival', name: 'Carnival', at: '2026-12-10T13:00' }, { id: 'phera', name: 'Phera', at: '2026-12-12T03:00' }]);
  assert.deepEqual(caught.map((c) => c.caught), [true, true]);
  assert.equal(workingDays('2026-12-05', '2026-12-15'), 7);
  assert.equal(formatDate('2026-12-05'), 'Sat 5 Dec');
  const backwards = validatePayload({ ...base, travel: { ...travel, arrive: { date: '2026-12-11', slot: 'morning' }, depart: { date: '2026-12-10', slot: 'morning' } } });
  assert.equal(backwards.ok, false);
});

test('pastedDay: a pasted day or December date is read whole, before the 2-character field limit cuts it', () => {
  for (const [text, day] of [
    ['  7  ', '7'], [' 07 ', '7'], ['15', '15'], ['\t31\n', '31'], ['७', '7'], ['१५', '15'],
    ['2026-12-07', '7'], ['2026/12/15', '15'], ['07/12/2026', '7'], ['7.12.26', '7'], ['15-12', '15'],
    ['7 Dec', '7'], ['7th', '7'], ['7th December 2026', '7'], ['15 dec.', '15'], ['Dec 7', '7'], ['December 13th, 2026', '13'],
    ['0', '0'], ['45', '45'],
  ]) assert.equal(pastedDay(text), day, JSON.stringify(text));
  for (const text of ['', '   ', '1e1', 'abc', '2026-11-30', '2027-12-07', '12/07/2026', '7 Nov', '7 to 9 Dec', '123', 'Dec']) {
    assert.equal(pastedDay(text), null, JSON.stringify(text));
  }
  // What a paste leaves in the field goes through customDate like a typed day.
  assert.deepEqual(customDate(pastedDay('2026-12-07'), 'arrive'), { ok: true, date: '2026-12-07' });
  assert.match(customDate(pastedDay('2026-12-07'), 'depart').error, /10 Dec/);
});

test('validatePayload: travel dates outside the "Other date" range are refused, chips and typed days pass', () => {
  const travel = (a, d) => ({ ...base, travel: { mode: 'train', from: 'Pune', arrive: { date: a, slot: 'morning' }, depart: { date: d, slot: 'night' } } });
  for (const [a, d] of [['2026-12-01', '2026-12-31'], ['2026-12-11', '2026-12-11'], ['unsure', '2026-12-10'], ['2026-12-09', 'unsure']]) {
    assert.deepEqual(validatePayload(travel(a, d)), { ok: true, errors: [] }, `${a} → ${d}`);
  }
  assert.deepEqual(validatePayload(travel('2026-11-30', '2026-12-12')).errors, ['Pick a rough arrival date from 1 to 11 Dec (or "Not sure yet").']);
  assert.deepEqual(validatePayload(travel('2026-12-12', '2026-12-13')).errors, ['Pick a rough arrival date from 1 to 11 Dec (or "Not sure yet").']);
  assert.deepEqual(validatePayload(travel('2026-12-05', '2026-12-09')).errors, ['Pick a rough departure date from 10 to 31 Dec (or "Not sure yet").']);
  assert.deepEqual(validatePayload(travel('2026-12-09', '2027-01-02')).errors, ['Pick a rough departure date from 10 to 31 Dec (or "Not sure yet").']);
});

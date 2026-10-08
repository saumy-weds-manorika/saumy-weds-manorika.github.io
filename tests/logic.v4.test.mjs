import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayload, buildPayload, arrivalLine } from '../js/logic.js';
import { AIRPORTS, JUNCTIONS, HIGHWAYS, BUS_FACTS } from '../js/travel-data.js';

const DATA = { airports: AIRPORTS, junctions: JUNCTIONS, highways: HIGHWAYS, busFacts: BUS_FACTS };
const when = { arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'morning' } };
const base = { action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul Sharma', note: '', filled_by: '', guests: [{ name: 'Rahul Sharma', status: 'confirmed', gender: 'M' }] };
const state = (travel) => ({ guest: { id: 'k7m2', label: 'Rahul Sharma', unlisted: false }, guests: [{ name: 'Rahul Sharma', status: 'confirmed', gender: 'M' }], travel, note: '' });

test('buildPayload: via hub/onward passes through for train and flight, is emptied for bus/car/local', () => {
  assert.deepEqual(buildPayload(state({ mode: 'train', from: 'Pune', ...when, via: { hub: 'COR', onward: 'car' } }), { ts: 't', ua: 'u' }).travel.via, { hub: 'COR', onward: 'car' });
  assert.deepEqual(buildPayload(state({ mode: 'flight', from: 'Pune', ...when, via: { hub: 'UDR' } }), { ts: 't', ua: 'u' }).travel.via, { hub: 'UDR', onward: '' });
  assert.deepEqual(buildPayload(state({ mode: 'bus', from: 'Pune', ...when, via: { hub: 'COR', onward: 'car' } }), { ts: 't', ua: 'u' }).travel.via, { hub: '', onward: '' });
  assert.deepEqual(buildPayload(state({ mode: 'train', from: 'Pune', ...when }), { ts: 't', ua: 'u' }).travel.via, { hub: '', onward: '' });
  assert.deepEqual(buildPayload(state({ mode: 'local', from: '', arrive: { date: '', slot: '' }, depart: { date: '', slot: '' } }), { ts: 't', ua: 'u' }).travel.via, { hub: '', onward: '' });
});

test('validatePayload: via is optional; hub must be a 2-5 letter code, unsure or empty; onward from the set', () => {
  const t = (via) => validatePayload({ ...base, travel: { mode: 'train', from: 'Pune', ...when, ...(via === undefined ? {} : { via }) } }).ok;
  assert.equal(t(undefined), true);
  assert.equal(t({ hub: 'COR', onward: 'car' }), true);
  assert.equal(t({ hub: 'unsure', onward: 'unsure' }), true);
  assert.equal(t({ hub: '', onward: '' }), true);
  assert.equal(t({ hub: 'cor', onward: '' }), false);
  assert.equal(t({ hub: 'TOOLONGX', onward: '' }), false);
  assert.equal(t({ hub: 'COR', onward: 'rocket' }), false);
});

test('arrivalLine: exactly one friendly line per travel mode', () => {
  const train = arrivalLine({ mode: 'train', ...when }, DATA);
  assert.ok(train.startsWith('🎟️') && train.includes('Wed 9 Dec') && train.includes('Sat 10 Oct') && train.includes('8 AM'), train);
  assert.ok(arrivalLine({ mode: 'train', arrive: { date: 'unsure', slot: 'unsure' } }, DATA).includes('60 days'));
  const fly = arrivalLine({ mode: 'flight', ...when, via: { hub: 'UDR', onward: 'car' } }, DATA);
  assert.ok(fly.startsWith('✈️') && fly.includes('Udaipur') && fly.includes('145 km') && fly.includes('~2h 30m'), fly);
  const flyUnsure = arrivalLine({ mode: 'flight', ...when, via: { hub: 'unsure', onward: '' } }, DATA);
  assert.ok(flyUnsure.indexOf('Udaipur') < flyUnsure.indexOf('Kishangarh') && flyUnsure.indexOf('Jaipur') < flyUnsure.indexOf('Ahmedabad'), flyUnsure);
  assert.ok(arrivalLine({ mode: 'bus', ...when }, DATA).startsWith('🚌'));
  const car = arrivalLine({ mode: 'car', ...when }, DATA);
  assert.ok(car.startsWith('🚗') && car.includes('NH48'), car);
  assert.ok(arrivalLine({ mode: 'local' }, DATA).includes('Home platform'));
  for (const m of ['train', 'flight', 'bus', 'car', 'local']) assert.ok(!arrivalLine({ mode: m, ...when }, DATA).includes('\n'));
});

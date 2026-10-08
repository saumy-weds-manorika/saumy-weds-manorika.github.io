import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingOpens, bookingStatus, catches, workingDays, formatDate, overallStatus,
  validatePayload, buildPayload, calendarUrl, icsText, leaveEmail, matchesQuery,
  isValidISODate,
} from '../js/logic.js';

const FUNCTIONS = [
  { id: 'carnival', name: 'Carnival', at: '2026-12-10T13:00' },
  { id: 'sangeet', name: 'Sangeet', at: '2026-12-10T19:00' },
  { id: 'maayra', name: 'Maayra', at: '2026-12-11T13:00' },
  { id: 'baraat', name: 'Baraat & Reception', at: '2026-12-11T18:00' },
  { id: 'phera', name: 'Phera', at: '2026-12-12T03:00' },
];
const caught = (r) => r.filter((f) => f.caught).map((f) => f.id);

test('isValidISODate', () => {
  assert.equal(isValidISODate('2026-12-09'), true);
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('unsure'), false);
  assert.equal(isValidISODate('9 Dec'), false);
});

test('bookingOpens: journey minus 60 days at 08:00 IST', () => {
  assert.deepEqual(bookingOpens('2026-12-08'), { date: '2026-10-09', label: 'Fri 9 Oct', iso: '2026-10-09T08:00:00+05:30', ms: Date.UTC(2026, 9, 9, 2, 30) });
  assert.equal(bookingOpens('2026-12-09').date, '2026-10-10');
  assert.equal(bookingOpens('2026-12-09').label, 'Sat 10 Oct');
  assert.equal(bookingOpens('2026-12-10').date, '2026-10-11');
  assert.equal(bookingOpens('2026-12-12').date, '2026-10-13');
  assert.equal(bookingOpens('2026-12-12').label, 'Tue 13 Oct');
  assert.equal(bookingOpens('2026-12-14').date, '2026-10-15');
  assert.equal(bookingOpens('unsure'), null);
});

test('bookingStatus: open vs upcoming relative to now', () => {
  const now = Date.UTC(2026, 9, 9, 12, 0); // 9 Oct 17:30 IST
  assert.deepEqual(bookingStatus('2026-12-09', now), { state: 'upcoming', msUntil: 52200000 });
  assert.deepEqual(bookingStatus('2026-12-08', now), { state: 'open', msUntil: 0 });
  assert.equal(bookingStatus('unsure', now), null);
});

test('catches: full stay catches everything', () => {
  const r = catches({ arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'afternoon' } }, FUNCTIONS);
  assert.deepEqual(caught(r), ['carnival', 'sangeet', 'maayra', 'baraat', 'phera']);
  assert.deepEqual(Object.keys(r[0]).sort(), ['caught', 'id', 'name']);
});

test('catches: late arrival and early departure miss the ends', () => {
  const r = catches({ arrive: { date: '2026-12-10', slot: 'evening' }, depart: { date: '2026-12-11', slot: 'night' } }, FUNCTIONS);
  assert.deepEqual(caught(r), ['sangeet', 'maayra', 'baraat']);
});

test('catches: arriving afternoon of 10 Dec still makes Carnival (arrive <= fn + 1h)', () => {
  const r = catches({ arrive: { date: '2026-12-10', slot: 'afternoon' }, depart: { date: '2026-12-12', slot: 'morning' } }, FUNCTIONS);
  assert.deepEqual(caught(r), ['carnival', 'sangeet', 'maayra', 'baraat', 'phera']);
});

test('catches: unsure dates count as caught on that side; unsure slot with a date uses noon', () => {
  assert.deepEqual(caught(catches({ arrive: { date: 'unsure', slot: 'unsure' }, depart: { date: 'unsure', slot: 'unsure' } }, FUNCTIONS)), ['carnival', 'sangeet', 'maayra', 'baraat', 'phera']);
  assert.deepEqual(caught(catches({ arrive: { date: 'unsure', slot: 'unsure' }, depart: { date: '2026-12-11', slot: 'morning' } }, FUNCTIONS)), ['carnival', 'sangeet']);
  assert.deepEqual(caught(catches({ arrive: { date: '2026-12-11', slot: 'unsure' }, depart: { date: 'unsure', slot: 'unsure' } }, FUNCTIONS)), ['maayra', 'baraat', 'phera']);
});

test('workingDays: Mon-Fri inclusive between arrival and departure', () => {
  assert.equal(workingDays('2026-12-09', '2026-12-12'), 3);
  assert.equal(workingDays('2026-12-08', '2026-12-14'), 5);
  assert.equal(workingDays('2026-12-10', '2026-12-11'), 2);
  assert.equal(workingDays('unsure', 'unsure'), 3);
  assert.equal(workingDays('2026-12-11', 'unsure'), 1);
  assert.equal(workingDays('2026-12-12', '2026-12-10'), 0);
});

test('formatDate', () => {
  assert.equal(formatDate('2026-12-09'), 'Wed 9 Dec');
  assert.equal(formatDate('2026-12-12'), 'Sat 12 Dec');
  assert.equal(formatDate('unsure'), 'Not sure yet');
});

test('overallStatus', () => {
  assert.equal(overallStatus([{ status: 'regret' }, { status: 'confirmed' }]), 'confirmed');
  assert.equal(overallStatus([{ status: 'regret' }, { status: 'waitlisted' }]), 'waitlisted');
  assert.equal(overallStatus([{ status: 'regret' }]), 'regret');
});

const goodTravel = { mode: 'train', from: 'Pune', arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'morning' } };

test('validatePayload: accepts a complete confirmed payload', () => {
  const p = { action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul Sharma', guests: [{ name: 'Rahul Sharma', status: 'confirmed' }], travel: goodTravel, note: '' };
  assert.deepEqual(validatePayload(p), { ok: true, errors: [] });
});

test('validatePayload: all-regret payload may omit travel', () => {
  const p = { action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul', guests: [{ name: 'Rahul', status: 'regret' }], travel: null, note: 'Sorry!' };
  assert.equal(validatePayload(p).ok, true);
});

test('validatePayload: rejects bad input with readable errors', () => {
  const base = { action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul', note: '' };
  assert.equal(validatePayload({ ...base, guests: [], travel: goodTravel }).ok, false);
  assert.equal(validatePayload({ ...base, guests: [{ name: '  ', status: 'confirmed' }], travel: goodTravel }).ok, false);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'A', status: 'maybe' }], travel: goodTravel }).ok, false);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'A', status: 'confirmed' }], travel: null }).ok, false);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'A', status: 'confirmed' }], travel: { ...goodTravel, mode: 'rocket' } }).ok, false);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'A', status: 'confirmed' }], travel: { ...goodTravel, from: '' } }).ok, false);
  const backwards = validatePayload({ ...base, guests: [{ name: 'A', status: 'confirmed' }], travel: { ...goodTravel, arrive: { date: '2026-12-12', slot: 'morning' }, depart: { date: '2026-12-10', slot: 'morning' } } });
  assert.equal(backwards.ok, false);
  assert.ok(backwards.errors.some((e) => /before/i.test(e)));
  assert.equal(validatePayload({ ...base, id: '', guests: [{ name: 'A', status: 'regret' }], travel: null }).ok, false);
  assert.equal(validatePayload({ ...base, guests: [{ name: 'A', status: 'regret' }], travel: null, note: 'x'.repeat(501) }).ok, false);
});

test('buildPayload: trims names, drops travel when everyone regrets', () => {
  const state = {
    guest: { id: 'k7m2', label: 'Rahul Sharma', unlisted: false },
    guests: [{ name: ' Rahul Sharma ', status: 'confirmed' }, { name: 'Priya', status: 'waitlisted' }],
    travel: { mode: 'flight', from: ' Pune ', arrive: { date: '2026-12-09', slot: 'night' }, depart: { date: '2026-12-12', slot: 'afternoon' } },
    note: ' See you! ',
  };
  const p = buildPayload(state, { ts: '2026-10-09T12:00:00.000Z', ua: 'test' });
  assert.deepEqual(p, {
    action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul Sharma',
    guests: [{ name: 'Rahul Sharma', status: 'confirmed', gender: '' }, { name: 'Priya', status: 'waitlisted', gender: '' }],
    travel: { mode: 'flight', from: 'Pune', arrive: { date: '2026-12-09', slot: 'night' }, depart: { date: '2026-12-12', slot: 'afternoon' }, via: { hub: '', onward: '' } }, // v4 §O3: via always emitted
    note: 'See you!',
    filled_by: '',
    client: { ts: '2026-10-09T12:00:00.000Z', ua: 'test' },
  });
  const regret = buildPayload({ ...state, guests: [{ name: 'Rahul', status: 'regret' }] }, { ts: 't', ua: 'u' });
  assert.equal(regret.travel, null);
});

test('calendarUrl: Google Calendar template link in UTC', () => {
  const url = calendarUrl({ title: 'Book train to Bhilwara', startISO: '2026-10-10T07:50:00+05:30', minutes: 15, details: 'IRCTC opens 8 AM' });
  assert.ok(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
  assert.ok(url.includes('dates=20261010T022000Z/20261010T023500Z'));
  assert.ok(url.includes('text=Book%20train%20to%20Bhilwara'));
});

test('icsText: valid VCALENDAR with CRLF and alarm', () => {
  const ics = icsText({ uid: 'bhl-1010@stt', title: 'Book train to Bhilwara', startISO: '2026-10-10T07:50:00+05:30', minutes: 15, details: 'IRCTC opens 8 AM' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('\r\nDTSTART:20261010T022000Z\r\n'));
  assert.ok(ics.includes('\r\nDTEND:20261010T023500Z\r\n'));
  assert.ok(ics.includes('\r\nSUMMARY:Book train to Bhilwara\r\n'));
  assert.ok(ics.includes('BEGIN:VALARM'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
});

test('leaveEmail: formal and honest variants use the guest dates', () => {
  const ctx = { name: 'Rahul', arrive: '2026-12-09', depart: '2026-12-12', days: 3, couple: 'Saumy & Manorika', city: 'Bhilwara' };
  const formal = leaveEmail('formal', ctx);
  assert.ok(/leave/i.test(formal.subject));
  assert.ok(formal.subject.includes('9 Dec'));
  assert.ok(formal.body.includes('Bhilwara'));
  assert.ok(formal.body.includes('3 working days'));
  const honest = leaveEmail('honest', ctx);
  assert.ok(honest.body.includes('3 AM'));
  assert.notEqual(honest.body, formal.body);
});

test('matchesQuery: word-prefix, case-insensitive, min 3 chars', () => {
  assert.equal(matchesQuery('rah', 'Rahul Sharma', []), true);
  assert.equal(matchesQuery('RAHUL sh', 'Rahul Sharma', []), true);
  assert.equal(matchesQuery('ra', 'Rahul Sharma', []), false);
  assert.equal(matchesQuery('agar', 'Mr & Mrs Agarwal', []), true);
  assert.equal(matchesQuery('priya', 'Rahul Sharma', ['Rahul Sharma', 'Priya Sharma']), true);
  assert.equal(matchesQuery('hul', 'Rahul Sharma', []), false);
  assert.equal(matchesQuery('rahul kumar', 'Rahul Sharma', []), true); // v2: unexpected middle/extra names are tolerated
});

import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// shaadi/js/api.js: its own storage keys (the friends edition shares the origin), the mock backend,
// ticket ids and the live POST. Browser stand-ins are installed before the import.
const memory = new Map();
const fakeStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => { memory.set(k, String(v)); },
  removeItem: (k) => { memory.delete(k); },
  clear: () => { memory.clear(); },
};
const fakeLocation = { search: '' };
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('localStorage', fakeStorage);
define('location', fakeLocation);

let api;
let CONFIG;
let logic;
before(async () => {
  api = await import('../shaadi/js/api.js');
  ({ CONFIG } = await import('../shaadi/js/config.js'));
  logic = await import('../shaadi/js/logic.js');
});

const realFetch = globalThis.fetch;
beforeEach(() => {
  memory.clear();
  fakeLocation.search = '';
  CONFIG.apiUrl = '';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  CONFIG.apiUrl = '';
});

const travel = { mode: 'local', from: 'Bhilwara', arrive: { date: 'unsure', slot: 'unsure' }, depart: { date: 'unsure', slot: 'unsure' }, via: { hub: '', onward: '' } };
const payload = (extra = {}) => ({
  action: 'rsvp', id: 's-k7m2ab9z', relation: 'ladke-wale', label: 'Dev Shah',
  guests: [{ name: 'Dev Shah', status: 'confirmed', gender: 'M', age: 61 }], travel, note: '', filled_by: 'Dev Shah', client: { ts: 't', ua: 'u' }, ...extra,
});

test('newTicketId: s- and 8 base36 characters, different every time', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) {
    const id = api.newTicketId();
    assert.match(id, logic.TICKET_ID_RE);
    ids.add(id);
  }
  assert.equal(ids.size, 200);
});

test('storage: this edition never reads or writes the friends edition keys', () => {
  memory.set('stt.v1', JSON.stringify({ id: 'k7m2', label: 'A friend' }));
  memory.set('stt.draft.v1', JSON.stringify({ v: 2 }));
  assert.equal(api.local.load(), null);
  assert.equal(api.local.loadDraft(), null);
  api.local.save({ id: 's-k7m2ab9z', label: 'Dev Shah', relation: 'ladke-wale' });
  api.local.saveDraft({ v: 3 });
  assert.deepEqual([...memory.keys()].sort(), ['stt.draft.v1', 'stt.shaadi.mock.draft.v1', 'stt.shaadi.mock.v1', 'stt.v1']);
  // Live mode uses its own pair of keys too
  CONFIG.apiUrl = 'https://script.google.com/macros/s/x/exec';
  assert.equal(api.isMock(), false);
  api.local.save({ id: 's-k7m2ab9z', label: 'Dev Shah' });
  assert.ok(memory.has('stt.shaadi.v1'));
  assert.equal(JSON.parse(memory.get('stt.v1')).label, 'A friend');
  api.local.clear();
  api.local.clearDraft();
  assert.ok(memory.has('stt.v1') && memory.has('stt.draft.v1'));
});

test('mock submit: validates, logs the answer and returns a timestamp', async () => {
  assert.equal(api.isMock(), true);
  const res = await api.submitRsvp(payload());
  assert.equal(res.ok, true);
  assert.equal(res.id, 's-k7m2ab9z');
  const log = JSON.parse(memory.get('stt.shaadi.mock.responses'));
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.relation, 'ladke-wale');
  await assert.rejects(api.submitRsvp(payload({ guests: [{ name: 'Dev Shah', status: 'confirmed', age: '61' }] })),
    (err) => err.code === 'invalid' && /age/.test(err.message));
  fakeLocation.search = '?mockfail=1';
  await assert.rejects(api.submitRsvp(payload()), (err) => err.code === 'network');
});

test('live submit: posts plain-text JSON and maps server error codes to guest-facing messages', async () => {
  CONFIG.apiUrl = 'https://script.google.com/macros/s/x/exec';
  const calls = [];
  let reply = { ok: true, id: 's-k7m2ab9z', updated_at: '2026-10-14T10:00:00.000Z' };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };
  const res = await api.submitRsvp(payload());
  assert.deepEqual(res, { ok: true, id: 's-k7m2ab9z', updated_at: '2026-10-14T10:00:00.000Z' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(JSON.parse(calls[0].init.body).relation, 'ladke-wale');
  for (const [code, want] of [['too_many', /up to 6 people/], ['busy', /busy/], ['full', /family member who sent you this invite/], ['server', /Something went wrong/]]) {
    reply = { ok: false, code, error: code };
    await assert.rejects(api.submitRsvp(payload()), (err) => err.code === code && want.test(err.message), code);
  }
});

test('live submit: retries up to twice, quietly, when the answer never came back; never for bad input', async () => {
  CONFIG.apiUrl = 'https://script.google.com/macros/s/x/exec';
  let calls = 0;
  const ok = { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, id: 's-k7m2ab9z', updated_at: '2026-10-14T10:00:00.000Z' }) };
  // A dropped connection, then success: one retry, announced through onRetry
  globalThis.fetch = async () => { calls += 1; if (calls === 1) throw new TypeError('Failed to fetch'); return ok; };
  const retried = [];
  const res = await api.submitRsvp(payload(), { onRetry: (code, n) => retried.push(`${code}:${n}`) });
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(retried, ['network:1']);
  // Google's error page every time: two retries, then the error reaches the guest
  calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: false, status: 503, text: async () => '' }; };
  await assert.rejects(api.submitRsvp(payload()), (err) => err.code === 'http_503');
  assert.equal(calls, 3);
  // Bad input is not retried
  calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, code: 'invalid', error: 'Pick M or F for Dev Shah.' }) }; };
  await assert.rejects(api.submitRsvp(payload()), (err) => err.code === 'invalid');
  assert.equal(calls, 1);
});

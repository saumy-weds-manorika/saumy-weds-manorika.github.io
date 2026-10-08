import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Browser stand-ins. They are installed before js/api.js is imported, and
// api.js reads them at call time, so tests can change them freely.
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
before(async () => {
  api = await import('../js/api.js');
  ({ CONFIG } = await import('../js/config.js'));
});

const realFetch = globalThis.fetch;
beforeEach(() => {
  memory.clear();
  fakeLocation.search = '';
  define('localStorage', fakeStorage);
  CONFIG.apiUrl = '';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  CONFIG.apiUrl = '';
});

const travel = { mode: 'train', from: 'Pune', arrive: { date: '2026-12-09', slot: 'evening' }, depart: { date: '2026-12-12', slot: 'morning' } };
const validPayload = () => ({
  action: 'rsvp', id: 'k7m2', unlisted: false, label: 'Rahul Sharma',
  guests: [{ name: 'Rahul Sharma', status: 'confirmed' }, { name: 'Priya Sharma', status: 'waitlisted' }],
  travel, note: 'See you there!', client: { ts: '2026-10-09T12:00:00.000Z', ua: 'node-test' },
});
const NETWORK_MSG = "Couldn't reach the ticket counter. Check your connection and try again.";

test('isMock: on when apiUrl is empty or ?mock=1', () => {
  assert.equal(api.isMock(), true);
  CONFIG.apiUrl = 'https://script.google.com/macros/s/abc/exec';
  assert.equal(api.isMock(), false);
  fakeLocation.search = '?mock=1';
  assert.equal(api.isMock(), true);
});

test('findGuests (mock): word-prefix search over label and names, min 3 chars', async () => {
  assert.deepEqual(await api.findGuests('rah'), [{ id: 'k7m2', label: 'Rahul Sharma' }]);
  assert.deepEqual(await api.findGuests('  priya '), [{ id: 'k7m2', label: 'Rahul Sharma' }]);
  assert.deepEqual(await api.findGuests('agar'), [{ id: 'p3x9', label: 'Mr & Mrs Agarwal' }]);
  assert.deepEqual(await api.findGuests('ra'), []);
  assert.deepEqual(await api.findGuests(''), []);
  assert.deepEqual(await api.findGuests('zzzz'), []);
});

test('getGuest (mock): returns the entry or null', async () => {
  assert.deepEqual(await api.getGuest('k7m2'), { id: 'k7m2', label: 'Rahul Sharma', names: ['Rahul Sharma', 'Priya Sharma'], max_guests: 2 });
  assert.equal((await api.getGuest(' A1B2 ')).max_guests, 1);
  assert.equal(await api.getGuest('nope'), null);
  assert.equal(await api.getGuest(''), null);
});

test('submitRsvp (mock): validates, waits ~600ms, stores in stt.mock.responses', async () => {
  const t0 = Date.now();
  const res = await api.submitRsvp(validPayload());
  assert.ok(Date.now() - t0 >= 550, 'should simulate network latency');
  assert.equal(res.ok, true);
  assert.equal(res.id, 'k7m2');
  assert.ok(!Number.isNaN(Date.parse(res.updated_at)));
  const log = JSON.parse(memory.get('stt.mock.responses'));
  assert.equal(log.length, 1);
  assert.equal(log[0].payload.id, 'k7m2');
});

test('submitRsvp (mock): rejects invalid payloads with a readable Error', async () => {
  const bad = { ...validPayload(), guests: [] };
  await assert.rejects(api.submitRsvp(bad), (err) => err instanceof Error && err.code === 'invalid' && err.message.length > 0);
  await assert.rejects(api.submitRsvp(null), (err) => err.code === 'invalid');
});

test('submitRsvp (mock): mirrors server guest checks', async () => {
  await assert.rejects(api.submitRsvp({ ...validPayload(), id: 'zzzz' }), (err) => err.code === 'unknown_guest');
  const three = { ...validPayload(), guests: [...validPayload().guests, { name: 'Extra', status: 'confirmed' }] };
  await assert.rejects(api.submitRsvp(three), (err) => err.code === 'too_many');
  const unlisted = { ...validPayload(), id: api.newUnlistedId(), unlisted: true, label: 'Meera Joshi', guests: [{ name: 'Meera Joshi', status: 'confirmed' }] };
  assert.equal((await api.submitRsvp(unlisted)).ok, true);
  await assert.rejects(api.submitRsvp({ ...unlisted, id: 'u-bad' }), (err) => err.code === 'invalid');
});

test('submitRsvp (mock): ?mockfail=1 rejects with the network message after ~600ms', async () => {
  fakeLocation.search = '?mockfail=1';
  const t0 = Date.now();
  await assert.rejects(api.submitRsvp(validPayload()), (err) => err instanceof Error && err.message === NETWORK_MSG);
  assert.ok(Date.now() - t0 >= 550);
  assert.equal(memory.get('stt.mock.responses'), undefined);
});

test('newUnlistedId: u- plus 8 base36 chars, unique', () => {
  const ids = new Set(Array.from({ length: 200 }, () => api.newUnlistedId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^u-[a-z0-9]{8}$/);
});

test('local: record and draft round-trip, clear, and survive bad data', () => {
  const { local } = api;
  CONFIG.apiUrl = 'https://script.google.com/macros/s/abc/exec'; // live mode keys
  assert.equal(local.load(), null);
  const record = { id: 'k7m2', label: 'Rahul Sharma', unlisted: false, payload: validPayload(), updated_at: '2026-10-09T12:00:00.000Z' };
  local.save(record);
  assert.ok(memory.has('stt.v1'));
  assert.deepEqual(local.load(), record);
  local.clear();
  assert.equal(local.load(), null);

  local.saveDraft({ stop: 'route', guests: [] });
  assert.ok(memory.has('stt.draft.v1'));
  assert.deepEqual(local.loadDraft(), { stop: 'route', guests: [] });
  local.clearDraft();
  assert.equal(local.loadDraft(), null);

  memory.set('stt.v1', '{not json');
  assert.equal(local.load(), null);
  memory.set('stt.draft.v1', '[1,2]');
  assert.equal(local.loadDraft(), null);
});

test('local: mock mode keeps its own record and draft, apart from the live ones', () => {
  const { local } = api;
  const live = { id: 'abcd', label: 'Real Guest', unlisted: false, payload: {}, updated_at: '2026-10-09T12:00:00.000Z' };
  const sample = { id: 'k7m2', label: 'Rahul Sharma', unlisted: false, payload: {}, updated_at: '2026-10-09T12:00:00.000Z' };

  CONFIG.apiUrl = 'https://script.google.com/macros/s/abc/exec';
  local.save(live);
  local.saveDraft({ stop: 'route' });

  fakeLocation.search = '?mock=1'; // trying practice mode on the live site
  assert.equal(local.load(), null, 'a live ticket must not show up in mock mode');
  assert.equal(local.loadDraft(), null);
  local.save(sample);
  local.saveDraft({ stop: 'arrival' });
  assert.ok(memory.has('stt.mock.v1'));
  assert.ok(memory.has('stt.mock.draft.v1'));
  local.clear();
  local.clearDraft();

  fakeLocation.search = '';
  assert.deepEqual(local.load(), live, 'mock mode must not overwrite or clear the live ticket');
  assert.deepEqual(local.loadDraft(), { stop: 'route' });
});

test('local: never throws when storage is blocked', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  const { local } = api;
  assert.doesNotThrow(() => local.save({ id: 'x' }));
  assert.equal(local.load(), null);
  assert.doesNotThrow(() => local.saveDraft({ a: 1 }));
  assert.equal(local.loadDraft(), null);
  assert.doesNotThrow(() => { local.clear(); local.clearDraft(); });
});

test('live mode: GET/POST shapes and error mapping', async () => {
  CONFIG.apiUrl = 'https://script.google.com/macros/s/abc/exec';
  const calls = [];
  let reply = { ok: true, matches: [{ id: 'k7m2', label: 'Rahul Sharma' }] };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  };

  assert.deepEqual(await api.findGuests('rah ul'), [{ id: 'k7m2', label: 'Rahul Sharma' }]);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('action'), 'find');
  assert.equal(u.searchParams.get('q'), 'rah ul');

  reply = { ok: true, guest: { id: 'k7m2', label: 'Rahul Sharma', names: ['Rahul Sharma', 'Priya Sharma'], max_guests: '2' } };
  assert.equal((await api.getGuest('k7m2')).max_guests, 2);
  reply = { ok: false, error: 'unknown guest', code: 'unknown_guest' };
  assert.equal(await api.getGuest('k7m2'), null);

  reply = { ok: true, id: 'k7m2', updated_at: '2026-10-09T12:00:01.000Z' };
  assert.deepEqual(await api.submitRsvp(validPayload()), { ok: true, id: 'k7m2', updated_at: '2026-10-09T12:00:01.000Z' });
  const post = calls.at(-1);
  assert.equal(post.url, CONFIG.apiUrl);
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(JSON.parse(post.init.body).id, 'k7m2');

  reply = { ok: false, error: 'busy', code: 'busy' };
  await assert.rejects(api.submitRsvp(validPayload()), (err) => err.code === 'busy');

  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(api.submitRsvp(validPayload()), (err) => err.message === NETWORK_MSG);
  await assert.rejects(api.findGuests('rahul'), (err) => err.message === NETWORK_MSG);

  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '<html>Sign in</html>' });
  await assert.rejects(api.submitRsvp(validPayload()), (err) => err.code === 'bad_json');
});

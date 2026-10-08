/**
 * Save the Train: API client, mock backend and on-device persistence.
 *
 * Live mode talks to the Google Apps Script web app at CONFIG.apiUrl.
 * Mock mode (CONFIG.apiUrl is empty, or the page URL has ?mock=1) uses the
 * sample guests below and keeps submissions in localStorage only.
 * In mock mode, ?mockfail=1 makes submitRsvp fail after 600ms, to test the
 * error path.
 *
 * Every error thrown from here is an Error whose message is safe to show to
 * guests as-is. Errors also carry a machine-readable `code`
 * ('network', 'timeout', 'invalid', 'unknown_guest', 'too_many', 'busy',
 * 'full', 'server', ...).
 */
import { CONFIG } from './config.js';
import { matchesQuery, validatePayload } from './logic.js';

/* Mock and live mode keep separate on-device records, so trying ?mock=1 on the live site never
   leaves a sample ticket behind (or overwrites a real one). Live keys are 'stt.v1' / 'stt.draft.v1'. */
const keyRecord = () => (isMock() ? 'stt.mock.v1' : 'stt.v1');
const keyDraft = () => (isMock() ? 'stt.mock.draft.v1' : 'stt.draft.v1');
const KEY_MOCK = 'stt.mock.responses';
const TIMEOUT_MS = 12000;        // GET (search, guest lookup)
const POST_TIMEOUT_MS = 25000;   // POST waits longer than the server's 10s lock wait plus a cold start
const MOCK_DELAY_MS = 600;
const MOCK_LOG_MAX = 50;
const MAX_MATCHES = 5;
const UNLISTED_RE = /^u-[a-z0-9]{8}$/;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

const MSG = {
  network: "Couldn't reach the ticket counter. Check your connection and try again.",
  timeout: 'The ticket counter is taking too long to answer. Check your connection and try again.',
  server: 'Something went wrong at the ticket counter. Please try again in a minute.',
  busy: 'The ticket counter is busy right now. Please try again in a moment.',
  unknownGuest: "We couldn't find your name on the passenger list. Go back and search again, or board anyway.",
  tooMany: 'This ticket has more passengers than your invite allows. Remove a guest and try again.',
  full: 'The ticket counter is closed for now. Please message Saumy on WhatsApp instead.',
  invalid: 'Some details need another look',
};

/** Sample passenger list used in mock mode. */
const MOCK_GUESTS = [
  { id: 'k7m2', label: 'Rahul Sharma', names: ['Rahul Sharma', 'Priya Sharma'], max_guests: 2 },
  { id: 'p3x9', label: 'Mr & Mrs Agarwal', names: ['Mr Agarwal', 'Mrs Agarwal'], max_guests: 2 },
  { id: 'a1b2', label: 'Ananya Iyer', names: ['Ananya Iyer'], max_guests: 1 },
  { id: 'z8q4', label: 'Kabir Khan', names: ['Kabir Khan'], max_guests: 2 },
];

/* ---------- small helpers ---------- */

function pageParams() {
  try {
    return new URLSearchParams((globalThis.location && globalThis.location.search) || '');
  } catch {
    return new URLSearchParams();
  }
}

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // Some browsers throw on access when storage is blocked.
  }
}

function readJSON(key) {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    /* quota, private mode or unserialisable: drafts are best effort */
  }
}

function removeKey(key) {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* ignore */
  }
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeGuest(g) {
  if (!isPlainObject(g) || !g.id) return null;
  const names = Array.isArray(g.names)
    ? g.names.map((n) => String(n ?? '').trim()).filter(Boolean)
    : [];
  const max = Math.trunc(Number(g.max_guests));
  return {
    id: String(g.id),
    label: String(g.label ?? '').trim(),
    names,
    max_guests: Number.isFinite(max) ? Math.min(10, Math.max(1, max)) : 1,
  };
}

/** Maps a `{ok:false, error, code}` server reply to a guest-facing Error. */
function errorFrom(data) {
  const code = String((data && data.code) || '');
  const text = String((data && data.error) || '');
  if (code === 'unknown_guest' || /unknown guest/i.test(text)) return fail(MSG.unknownGuest, 'unknown_guest');
  if (code === 'too_many') return fail(MSG.tooMany, 'too_many');
  if (code === 'busy') return fail(MSG.busy, 'busy');
  if (code === 'full') return fail(MSG.full, 'full');
  if (code === 'invalid' && text) return fail(`${MSG.invalid}: ${text}`, 'invalid');
  return fail(MSG.server, code || 'server');
}

/** fetch with a timeout (12s GET, 25s POST) that covers the body too; resolves to parsed JSON. */
async function request(url, init, timeoutMs = TIMEOUT_MS) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    if (!res.ok) throw fail(MSG.server, `http_${res.status}`);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw fail(MSG.server, 'bad_json');
    }
    if (!isPlainObject(data)) throw fail(MSG.server, 'bad_json');
    return data;
  } catch (err) {
    if (err && err.code) throw err;
    if (err && err.name === 'AbortError') throw fail(MSG.timeout, 'timeout');
    throw fail(MSG.network, 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function apiUrl(params) {
  let url;
  try {
    url = new URL(String(CONFIG.apiUrl).trim());
  } catch {
    throw fail(MSG.network, 'bad_api_url');
  }
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Mirrors the server's guest checks so mock mode catches the same mistakes. */
function mockCheckGuest(payload) {
  if (payload.unlisted === true) {
    if (!UNLISTED_RE.test(String(payload.id))) throw fail(`${MSG.invalid}: ticket id looks wrong.`, 'invalid');
    return;
  }
  const g = MOCK_GUESTS.find((x) => x.id === String(payload.id).trim().toLowerCase());
  if (!g) throw fail(MSG.unknownGuest, 'unknown_guest');
  if (payload.guests.length > g.max_guests) throw fail(MSG.tooMany, 'too_many');
}

/* ---------- public API ---------- */

/**
 * True when the site should use the mock backend.
 * @returns {boolean}
 */
export function isMock() {
  return !String(CONFIG.apiUrl || '').trim() || pageParams().get('mock') === '1';
}

/**
 * Searches the private guest list. Fewer than 3 characters returns [].
 * @param {string} q
 * @returns {Promise<{id:string,label:string}[]>} at most 5 matches
 * @throws {Error} guest-facing message when the counter can't be reached (live mode)
 */
export async function findGuests(q) {
  const term = String(q ?? '').trim().slice(0, 60);
  if (term.length < 3) return [];
  if (isMock()) {
    return MOCK_GUESTS
      .filter((g) => matchesQuery(term, g.label, g.names))
      .slice(0, MAX_MATCHES)
      .map(({ id, label }) => ({ id, label }));
  }
  const data = await request(apiUrl({ action: 'find', q: term }), { method: 'GET' });
  if (!data.ok) throw errorFrom(data);
  const list = Array.isArray(data.matches) ? data.matches : [];
  return list
    .filter((m) => isPlainObject(m) && m.id && m.label)
    .slice(0, MAX_MATCHES)
    .map((m) => ({ id: String(m.id), label: String(m.label) }));
}

/**
 * Loads one guest-list entry by id (used for ?g=<id> links).
 * @param {string} id
 * @returns {Promise<{id:string,label:string,names:string[],max_guests:number}|null>} null when unknown
 * @throws {Error} guest-facing message when the counter can't be reached (live mode)
 */
export async function getGuest(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key || key.length > 40) return null;
  if (isMock()) {
    const g = MOCK_GUESTS.find((x) => x.id === key);
    return g ? normalizeGuest(g) : null;
  }
  const data = await request(apiUrl({ action: 'guest', id: key }), { method: 'GET' });
  if (!data.ok) {
    const err = errorFrom(data);
    if (err.code === 'unknown_guest') return null;
    throw err;
  }
  return normalizeGuest(data.guest);
}

/**
 * Saves an RSVP. The latest submission per id wins on the server.
 * @param {object} payload built by logic.buildPayload
 * @returns {Promise<{ok:true,id:string,updated_at:string}>}
 * @throws {Error} with a guest-facing message on any failure
 */
export async function submitRsvp(payload) {
  const mock = isMock();
  if (mock && pageParams().get('mockfail') === '1') {
    await wait(MOCK_DELAY_MS);
    throw fail(MSG.network, 'network');
  }
  const check = isPlainObject(payload) ? validatePayload(payload) : { ok: false, errors: [] };
  if (!check.ok) {
    const first = (check.errors && check.errors[0]) || 'please check your answers.';
    throw fail(`${MSG.invalid}: ${first}`, 'invalid');
  }

  if (mock) {
    await wait(MOCK_DELAY_MS);
    mockCheckGuest(payload);
    const updated_at = new Date().toISOString();
    const log = readJSON(KEY_MOCK);
    const list = Array.isArray(log) ? log : [];
    list.push({ updated_at, payload });
    writeJSON(KEY_MOCK, list.slice(-MOCK_LOG_MAX));
    return { ok: true, id: String(payload.id), updated_at };
  }

  const data = await request(apiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  }, POST_TIMEOUT_MS);
  if (!data.ok) throw errorFrom(data);
  return {
    ok: true,
    id: String(data.id || payload.id),
    updated_at: String(data.updated_at || new Date().toISOString()),
  };
}

/**
 * A ticket id for a guest who boarded without being on the list.
 * @returns {string} 'u-' + 8 random base36 characters
 */
export function newUnlistedId() {
  let out = '';
  const buf = new Uint8Array(16);
  const cryptoObj = globalThis.crypto;
  while (out.length < 8) {
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      cryptoObj.getRandomValues(buf);
    } else {
      for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    for (const b of buf) {
      // 252 = 36 * 7, so skipping 252-255 keeps every character equally likely.
      if (b < 252 && out.length < 8) out += BASE36[b % 36];
    }
  }
  return `u-${out}`;
}

/**
 * On-device memory. Every call is wrapped in try/catch, so it degrades to
 * "nothing saved" when storage is blocked. Keys: 'stt.v1' and 'stt.draft.v1' in live
 * mode, 'stt.mock.v1' and 'stt.mock.draft.v1' in mock mode.
 */
export const local = {
  /** @returns {{id:string,label:string,unlisted:boolean,payload:object,updated_at:string}|null} */
  load() {
    const r = readJSON(keyRecord());
    return isPlainObject(r) && typeof r.id === 'string' && r.id ? r : null;
  },
  /** @param {{id,label,unlisted,payload,updated_at}} record */
  save(record) {
    writeJSON(keyRecord(), record);
  },
  clear() {
    removeKey(keyRecord());
  },
  /** @returns {object|null} */
  loadDraft() {
    const d = readJSON(keyDraft());
    return isPlainObject(d) ? d : null;
  },
  /** @param {object} state */
  saveDraft(state) {
    writeJSON(keyDraft(), state);
  },
  clearDraft() {
    removeKey(keyDraft());
  },
};

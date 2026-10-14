/**
 * Save the Train, Shaadi edition: API client, mock backend and on-device persistence.
 *
 * Live mode posts RSVPs to the shaadi Google Apps Script web app at CONFIG.apiUrl
 * (apps-script-shaadi/Code.gs). There is no guest list and no search in this edition.
 * Mock mode (CONFIG.apiUrl is empty, or the page URL has ?mock=1) keeps submissions in
 * localStorage only. In mock mode, ?mockfail=1 makes submitRsvp fail after 600ms, to test
 * the error path.
 *
 * Every error thrown from here is an Error whose message is safe to show to
 * guests as-is. Errors also carry a machine-readable `code`
 * ('network', 'timeout', 'invalid', 'too_many', 'busy', 'full', 'server', ...).
 */
import { CONFIG } from './config.js';
import { validatePayload, TICKET_ID_RE } from './logic.js';

/* The friends edition at the site root uses 'stt.v1' / 'stt.draft.v1' on this same origin, so this
   edition keeps its own keys: a friend's saved ticket never shows up here, and the other way round.
   Mock and live mode are kept apart too, so trying ?mock=1 never overwrites a real ticket. */
const keyRecord = () => (isMock() ? 'stt.shaadi.mock.v1' : 'stt.shaadi.v1');
const keyDraft = () => (isMock() ? 'stt.shaadi.mock.draft.v1' : 'stt.shaadi.draft.v1');
const KEY_MOCK = 'stt.shaadi.mock.responses';
const TIMEOUT_MS = 30000;        // GET (ping): Apps Script cold starts can take ~20s
const WARM_EVERY_MS = 4 * 60 * 1000; // re-wake the script at most this often
const POST_TIMEOUT_MS = 25000;   // POST waits longer than the server's 10s lock wait plus a cold start
const MOCK_DELAY_MS = 600;
const MOCK_LOG_MAX = 50;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

const MSG = {
  network: "Couldn't reach the ticket counter. Check your connection and try again.",
  timeout: 'The ticket counter is taking too long to answer. Check your connection and try again.',
  server: 'Something went wrong at the ticket counter. Please try again in a minute.',
  busy: 'The ticket counter is busy right now. Please try again in a moment.',
  tooMany: `A ticket can carry up to ${CONFIG.maxGuests} people. Remove a guest and try again.`,
  full: 'The ticket counter is closed for now. Please tell the family member who sent you this invite.',
  invalid: 'Some details need another look',
};

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

/** Maps a `{ok:false, error, code}` server reply to a guest-facing Error. */
function errorFrom(data) {
  const code = String((data && data.code) || '');
  const text = String((data && data.error) || '');
  if (code === 'too_many') return fail(MSG.tooMany, 'too_many');
  if (code === 'busy') return fail(MSG.busy, 'busy');
  if (code === 'full') return fail(MSG.full, 'full');
  if (code === 'invalid' && text) return fail(`${MSG.invalid}: ${text}`, 'invalid');
  return fail(MSG.server, code || 'server');
}

/** fetch with a timeout (30s GET, 25s POST) that covers the body too; resolves to parsed JSON. */
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
    // A timeout aborts the fetch. Check that first: the browser's AbortError (a DOMException) has a
    // numeric `code` of its own, which must not be mistaken for one of our string error codes.
    if ((ctrl && ctrl.signal.aborted) || (err && err.name === 'AbortError')) throw fail(MSG.timeout, 'timeout');
    if (err && typeof err.code === 'string') throw err;
    throw fail(MSG.network, 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let lastWarm = 0;
/**
 * Wakes the Apps Script backend in the background (a cheap ping), so the guest's submit doesn't
 * wait for a cold start. Live mode only; at most once every few minutes; never throws.
 */
export function warmUp() {
  if (isMock()) return;
  const now = Date.now();
  if (now - lastWarm < WARM_EVERY_MS) return;
  lastWarm = now;
  try {
    request(apiUrl({ action: 'ping' }), { method: 'GET' }).catch(() => {});
  } catch {
    // A bad apiUrl is reported by the real submit; warming up stays silent.
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

/* ---------- public API ---------- */

/**
 * True when the site should use the mock backend (no Apps Script URL yet, or ?mock=1).
 * @returns {boolean}
 */
export function isMock() {
  return !String(CONFIG.apiUrl || '').trim() || pageParams().get('mock') === '1';
}

/**
 * Saves an RSVP. The latest submission per ticket id wins on the server.
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
 * A new ticket id. Kept on this phone, so editing the ticket later updates the same rows in the Sheet.
 * @returns {string} 's-' + 8 random base36 characters (logic.TICKET_ID_RE)
 */
export function newTicketId() {
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
  const id = `s-${out}`;
  return TICKET_ID_RE.test(id) ? id : newTicketId();
}

/**
 * On-device memory. Every call is wrapped in try/catch, so it degrades to "nothing saved" when
 * storage is blocked. Keys: 'stt.shaadi.v1' and 'stt.shaadi.draft.v1' in live mode,
 * 'stt.shaadi.mock.v1' and 'stt.shaadi.mock.draft.v1' in mock mode.
 */
export const local = {
  /** @returns {{id:string,label:string,relation:string,payload:object,updated_at:string}|null} */
  load() {
    const r = readJSON(keyRecord());
    return isPlainObject(r) && typeof r.id === 'string' && r.id ? r : null;
  },
  /** @param {{id,label,relation,payload,updated_at}} record */
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

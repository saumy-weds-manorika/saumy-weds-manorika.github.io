/**
 * Save the Train: API client, mock backend and on-device persistence.
 *
 * Live mode talks to the Google Apps Script web app at CONFIG.apiUrl.
 * Mock mode (CONFIG.apiUrl is empty, or the page URL has ?mock=1) uses the
 * fictional sample guests below and keeps submissions in localStorage only.
 * In mock mode, ?mockfail=1 makes submitRsvp fail after 600ms, to test the
 * error path.
 *
 * A guest record (from getGuest) looks like this (amendments §A/§C):
 *   { id, label, names:[...], genders:['M'|'F'|'', ...] (aligned to names),
 *     partner: null | { title:'Mr'|'Mrs'|'Ms', gender:'M'|'F'|'' },
 *     max_guests: 4, couple: boolean, list: 'Primary'|'Secondary'|'',
 *     booked: null | { filled_by, updated_at, payload, has_note? } }
 * `partner` is an invited partner whose name isn't on the list; `booked` is the
 * latest saved answer for that ticket (from any device), so it can be shown and edited.
 * Its payload never carries the note: anyone can search a name, and a note to the couple
 * is private. `has_note: true` says one is saved; submitting with `keep_note: true` and an
 * empty note keeps it.
 * Its `payload.travel.via` ({hub, onward}, v4 §O3) is there when the answer was saved from
 * a v4 page; older answers have no `via`, which callers treat as `{hub:'', onward:''}`.
 *
 * Every error thrown from here is an Error whose message is safe to show to
 * guests as-is. Errors also carry a machine-readable `code`
 * ('network', 'timeout', 'invalid', 'unknown_guest', 'too_many', 'busy',
 * 'full', 'server', ...).
 */
import { CONFIG } from './config.js';
import { searchGuests, validatePayload } from './logic.js';

/* Mock and live mode keep separate on-device records, so trying ?mock=1 on the live site never
   leaves a sample ticket behind (or overwrites a real one). Live keys are 'stt.v1' / 'stt.draft.v1'. */
const keyRecord = () => (isMock() ? 'stt.mock.v1' : 'stt.v1');
const keyDraft = () => (isMock() ? 'stt.mock.draft.v1' : 'stt.draft.v1');
const KEY_MOCK = 'stt.mock.responses';
const TIMEOUT_MS = 30000;        // GET (search, guest lookup): Apps Script cold starts can take ~20s
const GET_RETRIES = 1;           // one quiet retry for a timeout or a transient Google error
const WARM_EVERY_MS = 4 * 60 * 1000; // re-wake the script at most this often
const POST_TIMEOUT_MS = 25000;   // POST waits longer than the server's 10s lock wait plus a cold start
const MOCK_DELAY_MS = 600;
const MOCK_LOG_MAX = 50;
const MAX_MATCHES = 5;
const MAX_GUESTS = 4;            // every ticket may use "Add guest" up to 4 people (amendments §A)
const UNLISTED_RE = /^u-[a-z0-9]{8}$/;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const LISTS = ['Primary', 'Secondary'];
const TITLES = ['Mr', 'Mrs', 'Ms'];

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

/** Sample passenger list used in mock mode: fictional people, in the shape Code.gs parses
 * from the "First List" (Primary) and "Second List" (Secondary) tabs. `aliases` come from the
 * Nicknames column; they are used for search only and never returned by getGuest. */
const MOCK_GUESTS = [
  { // Both Primary? = Y: either of them may open the link and fill in the ticket
    id: 'k7m2', label: 'Rahul Sharma & Priya Sharma', names: ['Rahul Sharma', 'Priya Sharma'], genders: ['M', 'F'],
    partner: null, max_guests: MAX_GUESTS, couple: true, list: 'Primary', aliases: [],
  },
  { // Both Primary? = N: Tara is Arjun's partner
    id: 'm4t8', label: 'Arjun Mehra & Tara', names: ['Arjun Mehra', 'Tara'], genders: ['M', 'F'],
    partner: null, max_guests: MAX_GUESTS, couple: false, list: 'Primary', aliases: [],
  },
  { // Guest 2 = "Mrs": a partner is invited, name unknown
    id: 'z8q4', label: 'Mr & Mrs Kabir Khan', names: ['Kabir Khan'], genders: ['M'],
    partner: { title: 'Mrs', gender: 'F' }, max_guests: MAX_GUESTS, couple: false, list: 'Secondary', aliases: [],
  },
  { id: 'a1b2', label: 'Ananya Iyer', names: ['Ananya Iyer'], genders: ['F'],
    partner: null, max_guests: MAX_GUESTS, couple: false, list: 'Primary', aliases: ['Annu'] },
  { // a search for "agrawal" still finds her
    id: 'p3x9', label: 'Isha Agarwal', names: ['Isha Agarwal'], genders: ['F'],
    partner: null, max_guests: MAX_GUESTS, couple: false, list: 'Primary', aliases: [] },
  { // a search for "Rohan Kumar Mehta" still finds him
    id: 'r0m1', label: 'Rohan Mehta', names: ['Rohan Mehta'], genders: ['M'],
    partner: null, max_guests: MAX_GUESTS, couple: false, list: 'Primary', aliases: [] },
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

const genderOf = (v) => (v === 'M' || v === 'F' ? v : '');

function normalizePartner(p) {
  if (!isPlainObject(p)) return null;
  const want = String(p.title ?? '').trim().replace(/\.$/, '').toLowerCase();
  const title = TITLES.find((t) => t.toLowerCase() === want);
  return title ? { title, gender: genderOf(p.gender) } : null;
}

function normalizeBooked(b) {
  if (!isPlainObject(b) || !isPlainObject(b.payload)) return null;
  const out = {
    filled_by: String(b.filled_by ?? '').trim(),
    updated_at: String(b.updated_at ?? ''),
    payload: b.payload,
  };
  if (b.has_note === true) out.has_note = true;
  return out;
}

/** A server (or mock) guest record in the shape documented at the top of this file. */
function normalizeGuest(g) {
  if (!isPlainObject(g) || !g.id) return null;
  const rawGenders = Array.isArray(g.genders) ? g.genders : [];
  const people = (Array.isArray(g.names) ? g.names : [])
    .map((n, i) => ({ name: String(n ?? '').trim(), gender: genderOf(rawGenders[i]) }))
    .filter((p) => p.name);
  const max = Math.trunc(Number(g.max_guests));
  return {
    id: String(g.id),
    label: String(g.label ?? '').trim(),
    names: people.map((p) => p.name),
    genders: people.map((p) => p.gender),
    partner: normalizePartner(g.partner),
    max_guests: Number.isFinite(max) ? Math.min(10, Math.max(1, max)) : MAX_GUESTS,
    couple: g.couple === true,
    list: LISTS.includes(g.list) ? g.list : '',
    booked: normalizeBooked(g.booked),
  };
}

/** Mock mode: the latest logged answer for a ticket id ({updated_at, payload}), or null. */
function mockLatest(id, { listedOnly = false } = {}) {
  const log = readJSON(KEY_MOCK);
  const list = Array.isArray(log) ? log : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    const p = isPlainObject(entry) ? entry.payload : null;
    if (!isPlainObject(p) || (listedOnly && p.unlisted === true) || String(p.id ?? '').trim().toLowerCase() !== id) continue;
    return { updated_at: String(entry.updated_at ?? ''), payload: p };
  }
  return null;
}

/** Mock mode: the latest saved answer for a listed ticket id, like the server's `booked`
 * (browser details and the private note left out; `has_note` when a note is saved). */
function mockBooked(id) {
  const latest = mockLatest(id, { listedOnly: true });
  if (!latest) return null;
  const { client, note, ...payload } = latest.payload;
  const out = { filled_by: String(latest.payload.filled_by ?? '').trim(), updated_at: latest.updated_at, payload };
  if (String(note ?? '').trim()) out.has_note = true;
  return out;
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
    // A timeout aborts the fetch. Check that first: the browser's AbortError (a DOMException) has a
    // numeric `code` of its own, which must not be mistaken for one of our string error codes.
    if ((ctrl && ctrl.signal.aborted) || (err && err.name === 'AbortError')) throw fail(MSG.timeout, 'timeout');
    if (err && typeof err.code === 'string') throw err;
    throw fail(MSG.network, 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Error codes worth one quiet retry: timeouts, dropped connections and Google's transient error pages. */
const RETRYABLE = /^(timeout|network|bad_json|http_(404|408|429|5\d\d))$/;

/** GET with one quiet retry, so a cold start or a passing Google hiccup doesn't reach the guest. */
async function getJSON(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request(url, { method: 'GET' });
    } catch (err) {
      if (attempt >= GET_RETRIES || !(err && RETRYABLE.test(String(err.code)))) throw err;
      await wait(800);
    }
  }
}

let lastWarm = 0;
/**
 * Wakes the Apps Script backend in the background (a cheap ping), so the guest's first search
 * doesn't wait for a cold start. Live mode only; at most once every few minutes; never throws.
 */
export function warmUp() {
  if (isMock()) return;
  const now = Date.now();
  if (now - lastWarm < WARM_EVERY_MS) return;
  lastWarm = now;
  try {
    request(apiUrl({ action: 'ping' }), { method: 'GET' }).catch(() => {});
  } catch {
    // A bad apiUrl is reported by the real search; warming up stays silent.
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

/** Mirrors the server's guest checks so mock mode catches the same mistakes. Returns the list entry (null if unlisted). */
function mockCheckGuest(payload) {
  if (payload.unlisted === true) {
    if (!UNLISTED_RE.test(String(payload.id))) throw fail(`${MSG.invalid}: ticket id looks wrong.`, 'invalid');
    return null;
  }
  const g = MOCK_GUESTS.find((x) => x.id === String(payload.id).trim().toLowerCase());
  if (!g) throw fail(MSG.unknownGuest, 'unknown_guest');
  if (payload.guests.length > g.max_guests) throw fail(MSG.tooMany, 'too_many');
  return g;
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
 * Searches the private guest list, forgivingly (first names, nicknames, small typos and
 * extra middle names all work; best matches first). Fewer than 3 characters returns [].
 * @param {string} q
 * @returns {Promise<{id:string,label:string}[]>} at most 5 matches
 * @throws {Error} guest-facing message when the counter can't be reached (live mode)
 */
export async function findGuests(q) {
  const term = String(q ?? '').trim().slice(0, 60);
  if (term.length < 3) return [];
  if (isMock()) {
    return searchGuests(term, MOCK_GUESTS, MAX_MATCHES).map(({ id, label }) => ({ id, label }));
  }
  const data = await getJSON(apiUrl({ action: 'find', q: term }));
  if (!data.ok) throw errorFrom(data);
  const list = Array.isArray(data.matches) ? data.matches : [];
  return list
    .filter((m) => isPlainObject(m) && m.id && m.label)
    .slice(0, MAX_MATCHES)
    .map((m) => ({ id: String(m.id), label: String(m.label) }));
}

/**
 * Loads one guest-list entry by id (after a search pick, or for ?g=<id> links), including
 * the latest saved answer for that ticket as `booked` (see the record shape at the top).
 * @param {string} id
 * @returns {Promise<{id:string,label:string,names:string[],genders:string[],partner:{title:string,gender:string}|null,
 *   max_guests:number,couple:boolean,list:string,booked:{filled_by:string,updated_at:string,payload:object}|null}|null>}
 *   null when unknown
 * @throws {Error} guest-facing message when the counter can't be reached (live mode)
 */
export async function getGuest(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key || key.length > 40) return null;
  if (isMock()) {
    const g = MOCK_GUESTS.find((x) => x.id === key);
    return g ? normalizeGuest({ ...g, booked: mockBooked(key) }) : null;
  }
  const data = await getJSON(apiUrl({ action: 'guest', id: key }));
  if (!data.ok) {
    const err = errorFrom(data);
    if (err.code === 'unknown_guest') return null;
    throw err;
  }
  return normalizeGuest(data.guest);
}

/**
 * Saves an RSVP. The latest submission per id wins on the server.
 * The payload is sent (or, in mock mode, kept) as built, so `travel.via` passes through untouched.
 * `keep_note: true` with an empty note keeps the ticket's previous note (see `booked.has_note`).
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
    const g = mockCheckGuest(payload);
    const updated_at = new Date().toISOString();
    // Like the server: an empty note with keep_note keeps the previous (unseen) note
    const { keep_note: keepNote, ...stored } = payload;
    if (keepNote === true && !String(stored.note ?? '').trim()) {
      const prev = mockLatest(String(stored.id).trim().toLowerCase());
      stored.note = String((prev && prev.payload.note) ?? '');
    }
    const log = readJSON(KEY_MOCK);
    const list = Array.isArray(log) ? log : [];
    list.push({ updated_at, payload: g ? { ...stored, label: g.label } : stored }); // like the server: the list's label wins
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

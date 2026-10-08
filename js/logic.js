// Pure helpers for Save the Train. No DOM and no clock: callers pass `now` in when time matters.
// All date maths runs on UTC midnights (Date.UTC) so results never depend on the device timezone.

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUSES = ['confirmed', 'waitlisted', 'regret'];
const GENDERS = ['M', 'F', ''];
const GUEST_FLAGS = ['added', 'partner']; // optional booleans on a payload guest (amendments §A)
const MODES = ['local', 'train', 'flight', 'bus', 'car']; // 'local' = "Bhilwara is home" (amendments §L)
const LOCAL_FROM = 'Bhilwara'; // a local guest's `from` when none is given
const VIA_MODES = ['train', 'flight']; // modes that ask "landing at / getting off at" and "then on by" (v4 §O3)
const ONWARDS = ['', 'car', 'train', 'bus', 'unsure'];
const HOME_STATION = 'BHL'; // getting off at Bhilwara itself means there is no onward leg
const NO_VIA = Object.freeze({ hub: '', onward: '' });
const SLOT_HOURS = { early: 6, morning: 10, afternoon: 14, evening: 18, night: 22, unsure: 12 };
const [DEFAULT_ARRIVE, DEFAULT_DEPART] = ['2026-12-09', '2026-12-12']; // assumed when a date is 'unsure'
const IST_OFFSET_MS = 5.5 * HOUR_MS;

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** UTC epoch ms of midnight for a `YYYY-MM-DD` string. */
const utcDay = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const toISODate = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Compact UTC stamp used by calendars, e.g. `20261010T022000Z`. */
const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Absolute hours since epoch for a date plus an hour of that day (wedding-local time). */
const absHours = (iso, hour) => utcDay(iso) / HOUR_MS + hour;
const orDefault = (iso, fallback) => (isValidISODate(iso) ? iso : fallback);

/** True for a real calendar date written as `YYYY-MM-DD`.
 * @param {string} s
 * @returns {boolean} */
export function isValidISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISODate(utcDay(s)) === s;
}

/** Short human date: `'2026-12-09'` → `'Wed 9 Dec'`; `'unsure'` → `'Not sure yet'`.
 * @param {string} iso
 * @returns {string} */
export function formatDate(iso) {
  if (iso === 'unsure') return 'Not sure yet';
  if (!isValidISODate(iso)) return String(iso ?? '');
  const t = new Date(utcDay(iso));
  return `${DOW[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`;
}

/** Train booking window: journey date minus 60 days, opening at 08:00 IST.
 * @param {string} journeyISO `YYYY-MM-DD` or `'unsure'`
 * @returns {{date:string, label:string, iso:string, ms:number} | null} `ms` is UTC epoch ms */
export function bookingOpens(journeyISO) {
  if (!isValidISODate(journeyISO)) return null;
  const dayMs = utcDay(journeyISO) - 60 * DAY_MS;
  const date = toISODate(dayMs);
  return { date, label: formatDate(date), iso: `${date}T08:00:00+05:30`, ms: dayMs + 8 * HOUR_MS - IST_OFFSET_MS };
}

/** Whether booking for a journey date is already open at `nowMs`.
 * @param {string} journeyISO
 * @param {number} nowMs epoch ms
 * @returns {{state:'open'|'upcoming', msUntil:number} | null} */
export function bookingStatus(journeyISO, nowMs) {
  const opens = bookingOpens(journeyISO);
  if (!opens) return null;
  return opens.ms > nowMs ? { state: 'upcoming', msUntil: opens.ms - nowMs } : { state: 'open', msUntil: 0 };
}

/** Midpoint hour of a time-of-day slot (`unsure` counts as noon); null for unknown slots.
 * @param {string} slot
 * @returns {number | null} */
export function slotHour(slot) {
  return Object.prototype.hasOwnProperty.call(SLOT_HOURS, slot) ? SLOT_HOURS[slot] : null;
}

/** Which functions a guest catches: `arrive ≤ fn + 1h` and `depart ≥ fn + 2h`.
 * A side whose date is `unsure` always passes; an `unsure` slot on a known date counts as noon.
 * @param {{arrive:{date:string,slot:string}, depart:{date:string,slot:string}}} travel
 * @param {{id:string, name:string, at:string}[]} functions `at` is `YYYY-MM-DDTHH:MM`
 * @returns {{id:string, name:string, caught:boolean}[]} */
export function catches({ arrive, depart }, functions) {
  const sideH = (s, open) => (isValidISODate(s?.date) ? absHours(s.date, slotHour(s.slot) ?? 12) : open);
  const [arriveH, departH] = [sideH(arrive, -Infinity), sideH(depart, Infinity)];
  return functions.map(({ id, name, at }) => {
    const [date, time = '00:00'] = String(at).split('T');
    const [hh, mm] = time.split(':').map(Number);
    const fnH = isValidISODate(date) ? absHours(date, hh + (mm || 0) / 60) : NaN;
    return { id, name, caught: arriveH <= fnH + 1 && departH >= fnH + 2 };
  });
}

/** Mon–Fri days from arrival to departure, inclusive. `unsure` means 9 Dec / 12 Dec 2026.
 * @param {string} arriveISO
 * @param {string} departISO
 * @returns {number} 0 when departure is before arrival */
export function workingDays(arriveISO, departISO) {
  const a = arriveISO === 'unsure' ? DEFAULT_ARRIVE : arriveISO;
  const d = departISO === 'unsure' ? DEFAULT_DEPART : departISO;
  if (!isValidISODate(a) || !isValidISODate(d)) return 0;
  let count = 0;
  for (let t = utcDay(a); t <= utcDay(d); t += DAY_MS) if (new Date(t).getUTCDay() % 6 !== 0) count += 1; // skip Sun (0), Sat (6)
  return count;
}

/** Group status: confirmed if anyone is confirmed, else waitlisted if anyone is, else regret.
 * @param {{status:string}[]} guests
 * @returns {'confirmed'|'waitlisted'|'regret'} */
export function overallStatus(guests) {
  const has = (st) => Array.isArray(guests) && guests.some((g) => g?.status === st);
  return has('confirmed') ? 'confirmed' : has('waitlisted') ? 'waitlisted' : 'regret';
}

/** An empty or missing date/slot reads as `'unsure'` (used for local guests, amendments §L). */
const unsureIfEmpty = (v) => (v == null || v === '' ? 'unsure' : v);

/** Pushes readable travel errors. Local guests (`mode: 'local'`) need no city, dates or slots:
 * a missing or empty one counts as `'unsure'`, though anything given must still be well-formed. */
function checkTravel(t, errors) {
  if (!MODES.includes(t.mode)) errors.push('Pick how you are travelling: train, flight, bus or car (or "Bhilwara is home").');
  const local = t.mode === 'local';
  const from = str(t.from);
  if (!from && !local) errors.push('Tell us roughly where you are travelling from.');
  else if (from.length > 60) errors.push('That city name is too long (max 60 characters).');
  const side = (s) => {
    const o = s && typeof s === 'object' ? s : {};
    return local ? { date: unsureIfEmpty(o.date), slot: unsureIfEmpty(o.slot) } : o;
  };
  const [a, d] = [side(t.arrive), side(t.depart)];
  [[a, 'arrival'], [d, 'departure']].forEach(([s, word]) => {
    if (!(s.date === 'unsure' || isValidISODate(s.date))) errors.push(`Pick a rough ${word} date (or "Not sure yet").`);
    if (slotHour(s.slot) === null) errors.push(`Pick a rough ${word} time of day (or "Not sure yet").`);
  });
  checkVia(t.via, errors);
  if (!isValidISODate(a.date) || !isValidISODate(d.date)) return;
  const [ah, dh] = [a.slot, d.slot].map((s) => (s === 'unsure' ? null : slotHour(s)));
  if (d.date < a.date) errors.push("Your departure date can't be before your arrival date.");
  else if (d.date === a.date && ah !== null && dh !== null && dh < ah) errors.push("Your departure time can't be before your arrival time.");
}

/** A valid hub: `''`, `'unsure'`, or an airport/station code of 2 to 5 uppercase letters (v4 §O3). */
const isHub = (h) => h === '' || h === 'unsure' || (typeof h === 'string' && /^[A-Z]{2,5}$/.test(h));

/** Pushes readable errors for `travel.via` (v4 §O3). A missing `via` (old clients) is fine, and so is
 * a missing `hub` or `onward` inside it; anything given must be well-formed. */
function checkVia(via, errors) {
  if (via == null) return;
  if (typeof via !== 'object' || Array.isArray(via)) { errors.push('Something is off with your route. Please pick it again.'); return; }
  if (via.hub !== undefined && !isHub(via.hub)) errors.push('Pick where you land or get off (or "Not sure yet").');
  if (via.onward !== undefined && !ONWARDS.includes(via.onward)) errors.push('Pick how you will get on to Bhilwara: car, train or bus (or "Not sure yet").');
}

/** Payload `via` for a travel object: `{hub, onward}` for train and flight (getting off at BHL drops the
 * onward leg), and `{hub:'', onward:''}` for every other mode or when nothing was picked. */
function buildVia(t) {
  if (!VIA_MODES.includes(t.mode)) return { ...NO_VIA };
  const v = t.via && typeof t.via === 'object' ? t.via : {};
  const hub = str(v.hub);
  return { hub, onward: hub === HOME_STATION ? '' : str(v.onward) };
}

/** Validates an RSVP payload (spec §5.1, amendments §A/§C/§D/§L). Travel is required unless everyone regrets.
 * Per guest, `gender` is optional but must be `'M'`, `'F'` or `''`; `added` and `partner` are optional booleans.
 * `filled_by` is an optional string of up to 100 characters. `travel.mode` is `local`, `train`, `flight`, `bus`
 * or `car`; for `local` the city is optional and missing or empty dates/slots count as `'unsure'`.
 * `travel.via` (v4 §O3) is optional for old clients; when present, `hub` is `''`, `'unsure'` or a 2–5 letter
 * uppercase code and `onward` is `''`, `'car'`, `'train'`, `'bus'` or `'unsure'`.
 * @param {object} p
 * @returns {{ok:boolean, errors:string[]}} */
export function validatePayload(p) {
  if (!p || typeof p !== 'object') return { ok: false, errors: ['Something went wrong with your ticket. Please try again.'] };
  const errors = [];
  if (p.action !== 'rsvp') errors.push('Unknown request.');
  const id = str(p.id);
  if (!id || id.length > 40) errors.push('Your ticket id looks wrong. Please search for your name again.');
  if (typeof p.unlisted !== 'boolean') errors.push('Missing guest-list flag.');
  else if (p.unlisted && !/^u-[a-z0-9]{8}$/.test(id)) errors.push('Invalid ticket id. Please board again.');
  const label = str(p.label);
  if (!label || label.length > 100) errors.push('Missing the name on your ticket.');
  const guests = Array.isArray(p.guests) ? p.guests : [];
  if (guests.length < 1 || guests.length > 10) errors.push(guests.length ? 'That is too many guests for one ticket (max 10).' : 'Please add at least one guest.');
  guests.forEach((g, i) => {
    const name = str(g?.name);
    if (!name) errors.push(`Guest ${i + 1} needs a name.`);
    else if (name.length > 60) errors.push(`Guest ${i + 1}'s name is too long (max 60 characters).`);
    const who = name || `guest ${i + 1}`;
    if (!STATUSES.includes(g?.status)) errors.push(`Pick Confirmed, Waitlisted or Regret for ${who}.`);
    if (g?.gender !== undefined && !GENDERS.includes(g.gender)) errors.push(`Pick M or F for ${who}.`);
    if (GUEST_FLAGS.some((k) => g?.[k] !== undefined && typeof g[k] !== 'boolean')) errors.push(`Something is off with ${who}'s seat. Please try again.`);
  });
  const allRegret = guests.length > 0 && guests.every((g) => g?.status === 'regret');
  if (p.travel && typeof p.travel === 'object') checkTravel(p.travel, errors);
  else if (p.travel != null || !allRegret) errors.push('Tell us roughly how and when you are travelling.');
  if (p.note != null && typeof p.note !== 'string') errors.push('Your note could not be read.');
  else if (str(p.note).length > 500) errors.push('Your note is too long (max 500 characters).');
  if (p.filled_by != null && (typeof p.filled_by !== 'string' || str(p.filled_by).length > 100)) {
    errors.push('Something went wrong with your ticket. Please try again.');
  }
  return { ok: errors.length === 0, errors };
}

/** Builds the POST body from app state. Trims text; travel is null when everyone regrets.
 * Each guest carries `gender` (`''` when unknown); `added: true` / `partner: true` are included only when set.
 * `filled_by` comes from `state.filledBy` (trimmed, `''` when absent), see amendments §C.
 * For `travel.mode === 'local'` (amendments §L) an empty `from` becomes `'Bhilwara'` and empty or missing
 * dates/slots become `'unsure'`; dates or slots that are set are kept.
 * `travel.via` (v4 §O3) is always emitted: `{hub, onward}` (trimmed, `''` when missing) for train and flight,
 * with `onward` cleared when the hub is Bhilwara (`'BHL'`), and `{hub:'', onward:''}` for bus, car and local.
 * @param {{guest:{id:string,label:string,unlisted:boolean}, filledBy?:string,
 *   guests:{name:string,status:string,gender?:'M'|'F'|'',added?:boolean,partner?:boolean}[],
 *   travel:{mode:string, from:string, arrive:object, depart:object, via?:{hub?:string, onward?:string}}, note:string}} state
 * @param {{ts:string, ua:string}} client
 * @returns {object} payload as in spec §5.1 plus amendments §A/§C/§D/§L and v4 §O3 */
export function buildPayload(state, client) {
  const guests = (state.guests || []).map((g) => {
    const out = { name: str(g?.name), status: g?.status ?? '', gender: str(g?.gender) };
    for (const k of GUEST_FLAGS) if (g?.[k] === true) out[k] = true;
    return out;
  });
  const t = state.travel || {};
  const local = t.mode === 'local';
  const fill = local ? unsureIfEmpty : (v) => v ?? '';
  const side = (s) => ({ date: fill(s?.date), slot: fill(s?.slot) });
  const travel = guests.length > 0 && overallStatus(guests) === 'regret' ? null
    : { mode: t.mode ?? '', from: str(t.from) || (local ? LOCAL_FROM : ''), arrive: side(t.arrive), depart: side(t.depart), via: buildVia(t) };
  const g = state.guest || {};
  return { action: 'rsvp', id: g.id ?? '', unlisted: Boolean(g.unlisted), label: str(g.label), guests, travel,
    note: str(state.note), filled_by: str(state.filledBy), client: { ts: client?.ts ?? '', ua: client?.ua ?? '' } };
}

const LOCAL_LINE = '🏡 Home platform! No train to catch. Just follow the dhol.';
/** Collapses any whitespace (newlines included) so a data string always reads as one line. */
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** `'2026-12-09'` → `'9 Dec'`. */
const dayMonth = (iso) => formatDate(iso).split(' ').slice(1).join(' ');
/** `['a','b','c']` → `'a, b and c'`. */
const listJoin = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The §K booking line: personalised for a known arrival date, else the 60-day rule shown for 9 Dec. */
function trainLine(arriveDate, now) {
  const isOpen = (iso) => Number.isFinite(now) && bookingStatus(iso, now)?.state === 'open';
  if (isValidISODate(arriveDate)) {
    const day = formatDate(arriveDate);
    return isOpen(arriveDate) ? `🎟️ Trains for ${day} are open for booking now. Grab yours early!`
      : `🎟️ Trains for ${day} open for booking ${bookingOpens(arriveDate).label}, 8 AM. Grab yours early!`;
  }
  const example = dayMonth(DEFAULT_ARRIVE);
  return isOpen(DEFAULT_ARRIVE) ? `🎟️ Train bookings open 60 days ahead at 8 AM. For ${example}, they're open now.`
    : `🎟️ Train bookings open 60 days ahead at 8 AM. For ${example}, that's ${bookingOpens(DEFAULT_ARRIVE).label}.`;
}

/** The flight line: the chosen airport's road distance, or every airport nearest first when unsure. */
function flightLine(hub, airports) {
  const list = asList(airports).filter((a) => a && typeof a === 'object' && str(a.name));
  const chosen = hub && hub !== 'unsure' ? list.find((a) => a.code === hub) : null;
  if (chosen) return `✈️ From ${oneLine(chosen.name)}, Bhilwara is about ${chosen.km} km by road (${oneLine(chosen.drive)}).`;
  if (!list.length) return '';
  const names = [...list].sort((a, b) => (Number(a.km) || 0) - (Number(b.km) || 0)).map((a) => oneLine(a.name));
  return `✈️ Nearest airports: ${listJoin(names)}.`;
}

/**
 * The junction stop's single travel line for a guest's mode (v4 §O1). Pure: the travel data from
 * `js/travel-data.js` is passed in, and the clock matters only when `now` is given.
 * - `train`: the §K booking line from `bookingOpens`/`formatDate`, e.g. "🎟️ Trains for Wed 9 Dec open for
 *   booking Sat 10 Oct, 8 AM. Grab yours early!"; with an unsure date, the 60-day rule shown for 9 Dec. When
 *   `now` (epoch ms) is given and that booking window has already opened, the line says it is open now.
 * - `flight`: "✈️ From {airport name}, Bhilwara is about {km} km by road ({drive})." for the airport whose
 *   `code` is `travel.via.hub`; when the hub is empty, `'unsure'` or not an airport, "✈️ Nearest airports:
 *   {names, nearest first}."
 * - `bus`: `'🚌 ' + busFacts[0]`; `car`: `'🚗 Road trip! ' + highways[0]`;
 * - `local`: "🏡 Home platform! No train to catch. Just follow the dhol." (amendments §L).
 * Any other mode, or a bus/flight line with no data to show, gives `''`. The result never contains a newline.
 * @param {{mode:string, arrive?:{date?:string, slot?:string}, via?:{hub?:string, onward?:string}} | null} travel
 * @param {{airports?:{code:string, name:string, km:number, drive:string}[], junctions?:{code:string, name:string,
 *   km:number, drive:string}[], highways?:string[], busFacts?:string[], now?:number}} [data] `junctions` is
 *   accepted for symmetry with the travel data but no line uses it today
 * @returns {string}
 */
export function arrivalLine(travel, { airports = [], highways = [], busFacts = [], now } = {}) {
  const t = travel && typeof travel === 'object' ? travel : {};
  switch (t.mode) {
    case 'train': return trainLine(t.arrive?.date, now);
    case 'flight': return flightLine(t.via?.hub, airports);
    case 'bus': { const fact = oneLine(asList(busFacts)[0]); return fact ? `🚌 ${fact}` : ''; }
    case 'car': { const road = oneLine(asList(highways)[0]); return road ? `🚗 Road trip! ${road}` : '🚗 Road trip!'; }
    case 'local': return LOCAL_LINE;
    default: return '';
  }
}

/** Google Calendar "add event" link, times in UTC.
 * @param {{title:string, startISO:string, minutes:number, details?:string}} ev
 * @returns {string} */
export function calendarUrl({ title, startISO, minutes, details = '' }) {
  const start = Date.parse(startISO);
  const dates = `${utcStamp(start)}/${utcStamp(start + minutes * 60000)}`;
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}`;
}

/** Escapes iCalendar TEXT values. */
const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 UTF-8 octets (RFC 5545 §3.1). */
function icsFold(line) {
  const parts = [];
  let [cur, bytes] = ['', 0];
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + b > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; bytes = 0; }
    [cur, bytes] = [cur + ch, bytes + b];
  }
  return [...parts, cur].join('\r\n ');
}

/** A one-event `.ics` file (CRLF line endings) with a display alarm at the start time.
 * @param {{uid:string, title:string, startISO:string, minutes:number, details?:string}} ev
 * @returns {string} */
export function icsText({ uid, title, startISO, minutes, details = '' }) {
  const start = utcStamp(Date.parse(startISO));
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Save the Train//Saumy & Manorika//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${icsEscape(uid)}`, `DTSTAMP:${start}`, `DTSTART:${start}`,
    `DTEND:${utcStamp(Date.parse(startISO) + minutes * 60000)}`, `SUMMARY:${icsEscape(title)}`, `DESCRIPTION:${icsEscape(details)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:PT0S', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].map(icsFold).join('\r\n') + '\r\n';
}

/** Leave-request email, formal or honest (funny), using the guest's own dates (`unsure` → 9 / 12 Dec).
 * @param {'formal'|'honest'} kind
 * @param {{name:string, arrive:string, depart:string, days:number, couple:string, city:string}} ctx
 * @returns {{subject:string, body:string}} */
export function leaveEmail(kind, { name, arrive, depart, days, couple, city }) {
  const [a, d] = [formatDate(orDefault(arrive, DEFAULT_ARRIVE)), formatDate(orDefault(depart, DEFAULT_DEPART))];
  const n = plural(Number(days) || 0, 'working day');
  const sign = str(name) ? `\n${str(name)}` : '';
  if (kind === 'honest') {
    return {
      subject: `Leave request: ${a} to ${d} (a Marwadi wedding needs me)`,
      body: `Hi,\n\nI'd like to take ${n} off, ${a} to ${d} 2026, for my friends ${couple}'s wedding in ${city}.\n\n`
        + 'In my defence, this is not a holiday. It is a Marwadi wedding: a carnival, a sangeet, a maayra, '
        + 'a baraat where I am morally obliged to dance on the road, and the phera at 3 AM. Yes, AM.\n\n'
        + "I'll hand everything over before I go, stay reachable for real emergencies (between dances), "
        + 'and come back tired, very happy and carrying mithai for the whole team.\n\n'
        + `Thank you for understanding!${sign}`,
    };
  }
  return {
    subject: `Leave request: ${a} to ${d}`,
    body: `Dear Sir/Madam,\n\nI would like to request leave from ${a} to ${d} 2026 (${n}) `
      + `to attend the wedding of my close friends, ${couple}, in ${city}.\n\n`
      + 'I will make sure my work is up to date and handed over before I leave, and I will be reachable for anything urgent.\n\n'
      + `Thank you for considering my request.\n\nKind regards,${sign}`,
  };
}

/* Forgiving name search (amendments \u00a7B). Mirrored in apps-script/Code.gs: keep the two in step. */

/** Titles and joiners that never count as name words, on either side of a search. */
const STOP_WORDS = new Set(['mr', 'mrs', 'ms', 'dr', 'smt', 'shri', 'and', 'the']);
const asList = (v) => (Array.isArray(v) ? v : []);
const splitWords = (s) => (s ? s.split(' ') : []);

/** Normalises a name for matching: lower-case, diacritics stripped (NFD, then every combining mark
 * removed), anything that is not a letter or whitespace turned into a space, spaces collapsed, trimmed.
 * `'  R\u00e4hul   Sharma! '` \u2192 `'rahul sharma'`; `'Mr. & Mrs. Agarwal'` \u2192 `'mr mrs agarwal'`.
 * @param {string} s
 * @returns {string} */
export function normalizeName(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[^\p{L}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Optimal-string-alignment (restricted Damerau-Levenshtein) distance: insertions, deletions,
 * substitutions and swaps of two adjacent letters each cost 1. Works on code points. */
function osaDistance(a, b) {
  const [s, t] = [[...a], [...b]];
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/** Deduplicated, stop-word-free words of an entry's label, names and aliases; each alias also counts
 * as one whole word with its spaces removed (so "Annu Di" also matches "annudi"). */
function candidateWords({ label, names, aliases } = {}) {
  const out = new Set();
  const add = (w) => { if (w && !STOP_WORDS.has(w)) out.add(w); };
  [label, ...asList(names), ...asList(aliases)].forEach((s) => splitWords(normalizeName(s)).forEach(add));
  asList(aliases).forEach((a) => add(normalizeName(a).replace(/ /g, '')));
  return [...out];
}

/** Best score of one query word against the candidate words: exact 3, prefix 2 (query word 3+ chars),
 * fuzzy 1 (OSA distance \u2264 1 for 4\u20137 chars, \u2264 2 for 8+, never under 4 chars), else 0. */
function wordScore(qw, candidates) {
  const len = [...qw].length;
  const maxEdits = len >= 8 ? 2 : len >= 4 ? 1 : 0;
  let best = 0;
  for (const c of candidates) {
    if (c === qw) return 3;
    if (len >= 3 && c.startsWith(qw)) best = 2;
    else if (best < 1 && maxEdits > 0 && Math.abs([...c].length - len) <= maxEdits && osaDistance(qw, c) <= maxEdits) best = 1;
  }
  return best;
}

/** How well a search query matches one guest-list entry; 0 means no match.
 * Query words are the normalised words of 2+ chars that are not stop words (`mr mrs ms dr smt shri and the`);
 * a query with fewer than 3 letters, or no such words, scores 0. A query with no spaces that equals all of
 * one name's words run together (`rahulsharma`) scores 6. Otherwise each query word scores its best of
 * exact 3 / prefix 2 / fuzzy 1 / 0; the entry matches when at least one word scored and the sum reaches
 * 1 (single-word query) or 2 (longer query), and the result is `sum + 0.1 \u00d7 words matched`.
 * So unexpected middle names and extra words still match, while fuller matches rank higher.
 * @param {string} query
 * @param {{label?:string, names?:string[], aliases?:string[]}} entry
 * @returns {number} */
export function matchScore(query, entry) {
  const q = normalizeName(query);
  if (q.replace(/ /g, '').length < 3) return 0;
  const queryWords = splitWords(q).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (queryWords.length === 0) return 0;
  const e = entry && typeof entry === 'object' ? entry : {};
  if (!q.includes(' ') && asList(e.names).some((n) => normalizeName(n).replace(/ /g, '') === q)) return 6;
  const candidates = candidateWords(e);
  const scores = queryWords.map((w) => wordScore(w, candidates));
  const matched = scores.filter((s) => s > 0).length;
  const sum = scores.reduce((a, b) => a + b, 0);
  if (matched < 1 || sum < (queryWords.length === 1 ? 1 : 2)) return 0;
  return Math.round((sum + matched * 0.1) * 10) / 10; // every part is a multiple of 0.1; rounding keeps ties exact
}

/** Ranks guest-list entries for a query: score descending, then label ascending; only scores above 0.
 * @param {string} query
 * @param {{id:string, label:string, names?:string[], aliases?:string[]}[]} entries
 * @param {number} [limit=5]
 * @returns {{id:string, label:string, score:number}[]} */
export function searchGuests(query, entries, limit = 5) {
  return asList(entries)
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ id: e.id, label: e.label, score: matchScore(query, e) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || String(a.label ?? '').localeCompare(String(b.label ?? ''), 'en'))
    .slice(0, Math.max(0, Number(limit) || 0));
}

/** v1-compatible yes/no search: `matchScore(q, {label, names, aliases: []}) > 0`.
 * @param {string} q
 * @param {string} label
 * @param {string[]} [names]
 * @returns {boolean} */
export function matchesQuery(q, label, names = []) {
  return matchScore(q, { label, names: asList(names), aliases: [] }) > 0;
}

/** Who rides on the journey-track vehicle (amendments \u00a7D): the first two guests whose status is not
 * `regret` (before any status is chosen, that is simply the first two). An unknown gender becomes
 * `'M'` for rider 1 and `'F'` for rider 2. Never more than 2.
 * @param {{status?:string, gender?:string}[]} guests
 * @returns {('M'|'F')[]} */
export function ridersFor(guests) {
  return asList(guests)
    .filter((g) => g && typeof g === 'object' && g.status !== 'regret')
    .slice(0, 2)
    .map((g, i) => (g.gender === 'M' || g.gender === 'F' ? g.gender : i === 0 ? 'M' : 'F'));
}

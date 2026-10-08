// Pure helpers for Save the Train. No DOM and no clock: callers pass `now` in when time matters.
// All date maths runs on UTC midnights (Date.UTC) so results never depend on the device timezone.

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUSES = ['confirmed', 'waitlisted', 'regret'];
const MODES = ['train', 'flight', 'bus', 'car'];
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

function checkTravel(t, errors) {
  if (!MODES.includes(t.mode)) errors.push('Pick how you are travelling: train, flight, bus or car.');
  const from = str(t.from);
  if (!from) errors.push('Tell us roughly where you are travelling from.');
  else if (from.length > 60) errors.push('That city name is too long (max 60 characters).');
  const [a, d] = [t.arrive || {}, t.depart || {}];
  [[a, 'arrival'], [d, 'departure']].forEach(([s, word]) => {
    if (!(s.date === 'unsure' || isValidISODate(s.date))) errors.push(`Pick a rough ${word} date (or "Not sure yet").`);
    if (slotHour(s.slot) === null) errors.push(`Pick a rough ${word} time of day (or "Not sure yet").`);
  });
  if (!isValidISODate(a.date) || !isValidISODate(d.date)) return;
  const [ah, dh] = [a.slot, d.slot].map((s) => (s === 'unsure' ? null : slotHour(s)));
  if (d.date < a.date) errors.push("Your departure date can't be before your arrival date.");
  else if (d.date === a.date && ah !== null && dh !== null && dh < ah) errors.push("Your departure time can't be before your arrival time.");
}

/** Validates an RSVP payload (spec §5.1). Travel is required unless everyone regrets.
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
    if (!STATUSES.includes(g?.status)) errors.push(`Pick Confirmed, Waitlisted or Regret for ${name || `guest ${i + 1}`}.`);
  });
  const allRegret = guests.length > 0 && guests.every((g) => g?.status === 'regret');
  if (p.travel && typeof p.travel === 'object') checkTravel(p.travel, errors);
  else if (p.travel != null || !allRegret) errors.push('Tell us roughly how and when you are travelling.');
  if (p.note != null && typeof p.note !== 'string') errors.push('Your note could not be read.');
  else if (str(p.note).length > 500) errors.push('Your note is too long (max 500 characters).');
  return { ok: errors.length === 0, errors };
}

/** Builds the POST body from app state. Trims text; travel is null when everyone regrets.
 * @param {{guest:{id:string,label:string,unlisted:boolean}, guests:{name:string,status:string}[], travel:object, note:string}} state
 * @param {{ts:string, ua:string}} client
 * @returns {object} payload as in spec §5.1 */
export function buildPayload(state, client) {
  const guests = (state.guests || []).map((g) => ({ name: str(g?.name), status: g?.status ?? '' }));
  const t = state.travel || {};
  const side = (s) => ({ date: s?.date ?? '', slot: s?.slot ?? '' });
  const travel = guests.length > 0 && overallStatus(guests) === 'regret' ? null
    : { mode: t.mode ?? '', from: str(t.from), arrive: side(t.arrive), depart: side(t.depart) };
  const g = state.guest || {};
  return { action: 'rsvp', id: g.id ?? '', unlisted: Boolean(g.unlisted), label: str(g.label), guests, travel,
    note: str(state.note), client: { ts: client?.ts ?? '', ua: client?.ua ?? '' } };
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

/** Lower-cases, strips accents and `& . ,`, and splits into words. */
const words = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[&.,]/g, ' ').split(/\s+/).filter(Boolean);

/** Guest-list search: every query word must prefix some word of `label` or `names`.
 * Case-insensitive; ignores `&`, `.` and `,`; the trimmed query needs 3+ characters.
 * @param {string} q
 * @param {string} label
 * @param {string[]} [names]
 * @returns {boolean} */
export function matchesQuery(q, label, names = []) {
  if (str(q).length < 3) return false;
  const qw = words(q);
  const hay = [label, ...(Array.isArray(names) ? names : [])].flatMap(words);
  return qw.length > 0 && qw.every((w) => hay.some((h) => h.startsWith(w)));
}

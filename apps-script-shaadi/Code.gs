// GENERATED from apps-script-shaadi/Code.template.gs by tools/build-shaadi-gs.py, with shared helpers
// copied from apps-script/Code.gs. Edit the template (or the friends edition), then run the script again.
/**
 * Save the Train, Shaadi edition: Google Apps Script backend for the family invite at
 * https://saumy-weds-manorika.github.io/shaadi/ (the friends edition and its Sheet are separate
 * and stay as they are).
 *
 * It runs inside a NEW, empty Google Sheet: no guest list is needed. Create the Sheet, open
 * Extensions > Apps Script, replace everything in Code.gs with this file, save, then run setup
 * (or use the "Save the Train" menu in the Sheet). Full steps are in docs/SETUP-shaadi.md.
 *
 * Deploy as a Web app with "Execute as: Me" and "Who has access: Anyone".
 *   GET  ?action=ping (or no action)  -> {ok, service, version, time}
 *   POST text/plain JSON RSVP         -> {ok:true, id, updated_at} or {ok:false, error, code}
 *        { action:'rsvp', id:'s-xxxxxxxx', relation:'ladke-dost', label, guests:[{name, status,
 *          gender:'M'|'F', age, added?}] (1 to 6), travel | null, note, filled_by, client }
 *        Arrival and departure dates are 'unsure' or a YYYY-MM-DD date, arriving 1–11 Dec and leaving
 *        10–31 Dec 2026, exactly as in the friends edition.
 *
 * Tabs (setup creates them):
 *   Responses  every submission, edits included (the raw log)
 *   People     one row per guest, latest answer per ticket (a ticket's rows are replaced on edit)
 *   Summary    formulas only: people by relation, ages, locals, nights, arrivals, pickups, notes
 *
 * Functions you run yourself (pick one in the toolbar, then click Run, or use the menu):
 *   setup          creates or repairs Summary, People and Responses (safe to re-run)
 *   rebuildPeople  rewrites the People tab from the Responses log
 *   startKeepWarm  wakes the script every 5 minutes so replies save quickly (stopKeepWarm turns it off)
 */

/**
 * Only needed if this script was created on its own at script.google.com (a "standalone" project)
 * instead of from the Sheet's Extensions > Apps Script menu. Paste the long ID from your Sheet's
 * address bar here: https://docs.google.com/spreadsheets/d/<THIS PART>/edit
 * Leave it '' when the script is attached to the Sheet.
 */
const SPREADSHEET_ID = '';
/** Shown by ?action=ping, so you can tell that the newest version of this script is the one that's live. */
const API_VERSION = 'shaadi-v2';

const SHEET = { responses: 'Responses', people: 'People', summary: 'Summary' };
const HEADERS = {
  Responses: ['ts', 'id', 'relation', 'label', 'payload_json'],
  People: ['id', 'side', 'relation', 'label', 'person', 'gender', 'age', 'status', 'mode', 'from', 'hub', 'onward',
    'arrive_date', 'arrive_slot', 'depart_date', 'depart_slot', 'note', 'filled_by', 'updated_at', 'added'],
};

/** The two sides, as the People tab and the Summary name them. */
const SIDES = { a: 'Ladke Wale side (Saumy)', b: 'Ladki Wale side (Manorika)' };
/**
 * The "Which side are you from?" tabs, in the website's order (shaadi/js/config.js has the same ids).
 * People stores the label; Responses keeps the id inside each payload.
 */
const RELATIONS = [
  { id: 'ladke-wale', label: 'Ladke Wale', side: 'a' },
  { id: 'mayra-ladke', label: 'Maayra (Ladke Wale)', side: 'a' },
  { id: 'ladke-dost', label: 'Ladke Ke Dost', side: 'a' },
  { id: 'ladke-family-friends', label: 'Ladke Ke Family Friends', side: 'a' },
  { id: 'ladki-wale', label: 'Ladki Wale', side: 'b' },
  { id: 'mayra-ladki', label: 'Maayra (Ladki Wale)', side: 'b' },
  { id: 'ladki-sakhiyaan', label: 'Ladki Ki Sakhiyaan', side: 'b' },
  { id: 'ladki-family-friends', label: 'Ladki Ke Family Friends', side: 'b' },
];
/** Everyone on one ticket, the guest who fills it in included. */
const MAX_GUESTS = 6;
/** Ages are whole years from 0 (a baby) to 120. */
const AGE_MAX = 120;
/** Age groups for the Summary (confirmed + waitlisted guests). */
const AGE_BANDS = [
  { label: '0–5 (little ones)', min: 0, max: 5 },
  { label: '6–12 (children)', min: 6, max: 12 },
  { label: '13–17 (teens)', min: 13, max: 17 },
  { label: '18–59 (adults)', min: 18, max: 59 },
  { label: '60+ (elders)', min: 60, max: AGE_MAX },
];
/** A ticket id: 's-' and 8 lowercase letters or digits (the website makes it). */
const TICKET_ID_RE = /^s-[a-z0-9]{8}$/;

const STATUSES = ['confirmed', 'waitlisted', 'regret'];
const GENDERS = ['M', 'F']; // required for every guest in this edition
const GUEST_FLAGS = ['added']; // optional boolean on a payload guest
const MODES = ['local', 'train', 'flight', 'bus', 'car'];
const LOCAL_FROM = 'Bhilwara';
/** travel.via: only these modes ask "landing at / getting off at" and "then on by". */
const VIA_MODES = ['train', 'flight'];
/** A hub is '', 'unsure' or an airport/station code of 2 to 5 capital letters. */
const HUB_RE = /^[A-Z]{2,5}$/;
const ONWARDS = ['', 'car', 'train', 'bus', 'unsure'];
/** Getting off at Bhilwara itself means there is no onward leg. */
const HOME_STATION = 'BHL';
/**
 * Hubs listed in the Summary's "Arrivals by hub" table, in the website's order (js/travel-data.js):
 * Bhilwara station, then the junctions and the airports, nearest first. Any other code counts as "Other".
 */
const HUBS = [
  { code: 'BHL', name: 'Bhilwara station' },
  { code: 'COR', name: 'Chittaurgarh Jn' },
  { code: 'AII', name: 'Ajmer Jn' },
  { code: 'UDZ', name: 'Udaipur City station' },
  { code: 'KOTA', name: 'Kota Jn' },
  { code: 'JP', name: 'Jaipur Jn' },
  { code: 'RTM', name: 'Ratlam Jn' },
  { code: 'UDR', name: 'Udaipur airport' },
  { code: 'KQH', name: 'Kishangarh airport' },
  { code: 'JAI', name: 'Jaipur airport' },
  { code: 'AMD', name: 'Ahmedabad airport' },
];
const SLOTS = ['early', 'morning', 'afternoon', 'evening', 'night', 'unsure'];
const SLOT_HOURS = { early: 6, morning: 10, afternoon: 14, evening: 18, night: 22, unsure: 12 };
const SLOT_LABELS = {
  early: 'Early morning', morning: 'Morning', afternoon: 'Afternoon',
  evening: 'Evening', night: 'Night', unsure: 'Not sure yet',
};
const NIGHTS = ['2026-12-09', '2026-12-10', '2026-12-11'];
/** The morning after the last listed night: anyone leaving after it stays on past NIGHTS. */
const NIGHTS_END = '2026-12-12';
/**
 * The website's date chips. A guest can also type any other day in December under "Other date";
 * that is stored as a plain YYYY-MM-DD date too, and the Summary grids count it under "Other dates".
 */
const ARRIVE_DATES = ['2026-12-09', '2026-12-10', '2026-12-11', 'unsure'];
const DEPART_DATES = ['2026-12-11', '2026-12-12', 'unsure'];
/** The days of December 2026 a guest can give: arriving 1–11 Dec, leaving 10–31 Dec. */
const TRAVEL_MONTH = '2026-12';
const TRAVEL_DAYS = { arrival: [1, 11], departure: [10, 31] };
/** A YYYY-MM-DD date, as a Sheets REGEXMATCH pattern (the "Other dates" rows). */
const SHEET_DATE_RE = '^\\d{4}-\\d{2}-\\d{2}$';
const UNSURE_ARRIVE = '2026-12-09';
const UNSURE_DEPART = '2026-12-12';
const MAX_RESPONSES = 5000;
const MAX_BODY_CHARS = 20000;

/* =========================================================================
 * Web app entry points
 * ========================================================================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const action = String(p.action || 'ping');
    if (action === 'ping') {
      return json_({ ok: true, service: 'save-the-train-shaadi', version: API_VERSION, time: new Date().toISOString() });
    }
    return json_(fail_('bad_request', 'unknown action'));
  } catch (err) {
    console.error('doGet failed: ' + (err && err.stack ? err.stack : err));
    return json_(fail_('server', 'server error'));
  }
}

function doPost(e) {
  let body;
  try {
    const raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
    if (!raw) return json_(fail_('bad_request', 'empty request'));
    if (raw.length > MAX_BODY_CHARS) return json_(fail_('bad_request', 'request too large'));
    body = JSON.parse(raw);
  } catch (err) {
    return json_(fail_('bad_request', 'could not read request'));
  }

  const check = validatePayload_(body);
  if (!check.ok) {
    const many = Array.isArray(body && body.guests) && body.guests.length > MAX_GUESTS;
    return json_(many ? fail_('too_many', 'too many guests for one ticket') : fail_('invalid', check.errors.slice(0, 5).join(' ')));
  }
  const payload = cleanPayload_(body);

  const lock = LockService.getScriptLock();
  try {
    // 10s, so a queued guest gets a 'busy' answer well before the website gives up (25s).
    lock.waitLock(10000);
  } catch (err) {
    return json_(fail_('busy', 'busy'));
  }
  try {
    return json_(saveRsvp_(payload));
  } catch (err) {
    console.error('doPost failed: ' + (err && err.stack ? err.stack : err));
    return json_(fail_('server', 'server error'));
  } finally {
    lock.releaseLock();
  }
}

/** Adds a "Save the Train" menu to the Sheet. Runs automatically when the Sheet opens. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Save the Train')
    .addItem('Set up / repair tabs', 'setup')
    .addItem('Rebuild People from Responses', 'rebuildPeople')
    .addSeparator()
    .addItem('Keep replies fast (wake every 5 minutes)', 'startKeepWarm')
    .addItem('Stop keeping replies fast', 'stopKeepWarm')
    .addToUi();
}

/* =========================================================================
 * Functions to run by hand
 * ========================================================================= */

/**
 * Creates or repairs Summary, People and Responses, and removes the new Sheet's empty "Sheet1".
 * Never deletes a response. Safe to re-run.
 */
function setup() {
  const ss = ss_();
  const summary = ensureSheet_(ss, SHEET.summary, null);
  const people = ensureSheet_(ss, SHEET.people, HEADERS.People);
  const responses = ensureSheet_(ss, SHEET.responses, HEADERS.Responses);
  const removed = removeBlankStarterTabs_(ss);

  let rebuilt = -1;
  if (!headerMatches_(people, HEADERS.People) || hasOldRelationLabels_(people)) {
    // People from an older layout, or with a relation spelt the old way ("Mayra (...)" before shaadi-v2):
    // rewrite it from Responses, which always has everything, so the Summary counts every guest.
    rebuilt = withLock_(function () { return rebuildPeople_(ss, people); });
  }

  formatResponses_(responses);
  formatPeople_(people);
  buildSummary_(summary);
  ss.setActiveSheet(summary);
  SpreadsheetApp.flush();

  let msg = 'Setup done: Summary, People and Responses are ready.';
  if (removed) msg += ' The empty starter tab was removed.';
  if (rebuilt === null) msg += ' People has an old layout: run setup again when nobody is submitting.';
  else if (rebuilt >= 0) msg += ' People was rebuilt from Responses (' + rebuilt + ' rows).';
  notify_(msg);
}

/** Rewrites the People tab from the Responses log (latest answer per ticket). Safe: Responses is never changed. */
function rebuildPeople() {
  const ss = ss_();
  const people = ensureSheet_(ss, SHEET.people, HEADERS.People);
  const rows = withLock_(function () { return rebuildPeople_(ss, people); });
  if (rows === null) {
    notify_('Someone is submitting right now. Try again in a minute.');
    return;
  }
  formatPeople_(people);
  SpreadsheetApp.flush();
  notify_('People rebuilt from Responses: ' + rows + ' rows.');
}

/**
 * Google puts a script to sleep when nobody has used it for a while, and waking it can take 10-20s,
 * which a guest feels when they press "Confirm my seat". This runs every 5 minutes (via startKeepWarm)
 * to keep the script awake. It is tiny: a few seconds of trigger time a day.
 */
function keepWarm() {
  ss_().getId();
}

/** Turns on keepWarm every 5 minutes. Safe to run again (it never adds a second timer). */
function startKeepWarm() {
  stopKeepWarm_();
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  keepWarm();
  notify_('Replies will save quickly: the script now wakes itself every 5 minutes. Use "Stop keeping replies fast" to turn this off after the RSVPs are in.');
}

/** Turns keepWarm off. */
function stopKeepWarm() {
  const n = stopKeepWarm_();
  notify_(n ? 'Stopped keeping replies fast.' : 'Keeping replies fast was already off.');
}

function stopKeepWarm_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepWarm') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  return n;
}

/* =========================================================================
 * RSVP saving
 * ========================================================================= */

/** Saves a cleaned payload: one Responses row, and this ticket's People rows replaced. */
function saveRsvp_(p) {
  const ss = ss_();
  const responses = ensureSheet_(ss, SHEET.responses, HEADERS.Responses);
  const people = ensureSheet_(ss, SHEET.people, HEADERS.People);
  if (responses.getLastRow() - 1 >= MAX_RESPONSES) return fail_('full', 'response limit reached');

  const now = new Date();
  responses.appendRow([now, text_(p.id), text_(p.relation), text_(p.label), text_(JSON.stringify(p))]);
  // If People's header is some other layout, rebuild it from the Responses log (which already
  // includes this answer) rather than writing rows under the wrong columns.
  if (!headerMatches_(people, HEADERS.People)) rebuildPeople_(ss, people);
  else replacePeopleRows_(people, p.id, peopleRows_(p, now));
  SpreadsheetApp.flush();
  return { ok: true, id: p.id, updated_at: now.toISOString() };
}

/** True when a People row's relation isn't one of today's labels (e.g. written before a spelling change). */
function hasOldRelationLabels_(people) {
  if (!headerMatches_(people, HEADERS.People) || people.getLastRow() < 2) return false;
  const col = HEADERS.People.indexOf('relation') + 1;
  const labels = RELATIONS.map(function (r) { return r.label; });
  return people.getRange(2, col, people.getLastRow() - 1, 1).getValues().some(function (row) {
    const v = cell_(row[0]);
    return v !== '' && labels.indexOf(v) < 0;
  });
}

/** The relation tab for an id ({id, label, side}), or null. */
function relationOf_(id) {
  for (let i = 0; i < RELATIONS.length; i++) if (RELATIONS[i].id === id) return RELATIONS[i];
  return null;
}

/**
 * One People row per guest, in HEADERS.People order. Regret rows leave the travel columns blank.
 * The age is written as a number, so the Summary can count age groups.
 * @param {object} p a stored payload
 * @param {Date} when
 */
function peopleRows_(p, when) {
  const rel = relationOf_(p.relation);
  const t = p.travel && typeof p.travel === 'object' ? p.travel : null;
  const a = t && t.arrive && typeof t.arrive === 'object' ? t.arrive : {};
  const d = t && t.depart && typeof t.depart === 'object' ? t.depart : {};
  const via = t ? viaOf_(t) : { hub: '', onward: '' };
  const guests = Array.isArray(p.guests) ? p.guests : [];
  return guests.map(function (g) {
    const going = !!t && g.status !== 'regret';
    return [
      text_(p.id), text_(rel ? SIDES[rel.side] : ''), text_(rel ? rel.label : ''), text_(p.label),
      text_(g.name), text_(GENDERS.indexOf(g.gender) >= 0 ? g.gender : ''), isAge_(g.age) ? g.age : '', text_(g.status),
      going ? text_(t.mode) : '', going ? text_(t.from) : '',
      going ? text_(via.hub) : '', going ? text_(via.onward) : '',
      going ? text_(a.date) : '', going ? text_(a.slot) : '',
      going ? text_(d.date) : '', going ? text_(d.slot) : '',
      text_(p.note), text_(p.filled_by), when, g.added === true,
    ];
  });
}

/** Upsert by ticket id: delete this id's old rows, then append the new ones. */
function replacePeopleRows_(sheet, id, rows) {
  const last = sheet.getLastRow();
  if (last >= 2) {
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    const runs = []; // contiguous blocks of matching rows, bottom-most first
    for (let i = ids.length - 1; i >= 0; i--) {
      if (normId_(ids[i][0]) !== id) continue;
      const row = i + 2;
      const run = runs.length ? runs[runs.length - 1] : null;
      if (run && run.start === row + 1) {
        run.start = row;
        run.count++;
      } else {
        runs.push({ start: row, count: 1 });
      }
    }
    runs.forEach(function (run) {
      // Sheets refuses to delete every non-frozen row, so keep spare blank rows at the bottom.
      if (sheet.getMaxRows() - run.count <= sheet.getFrozenRows()) {
        sheet.insertRowsAfter(sheet.getMaxRows(), run.count);
      }
      sheet.deleteRows(run.start, run.count);
    });
  }
  appendRows_(sheet, rows);
}

function appendRows_(sheet, rows) {
  if (!rows.length) return;
  const start = sheet.getLastRow() + 1;
  const end = start + rows.length - 1;
  if (end > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), end - sheet.getMaxRows());
  if (rows[0].length > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), rows[0].length - sheet.getMaxColumns());
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

/** Rewrites People from the latest Responses row per ticket. Returns the number of People rows written. */
function rebuildPeople_(ss, people) {
  const responses = ss.getSheetByName(SHEET.responses);
  const latest = {};
  const order = [];
  if (responses && responses.getLastRow() >= 2) {
    responses.getRange(2, 1, responses.getLastRow() - 1, 5).getValues().forEach(function (row) {
      const id = normId_(row[1]);
      if (!id) return;
      if (!latest[id]) order.push(id);
      latest[id] = row;
    });
  }
  let rows = [];
  order.forEach(function (id) {
    const row = latest[id];
    let p;
    try {
      p = JSON.parse(cell_(row[4]));
    } catch (err) {
      return;
    }
    if (!p || typeof p !== 'object' || !Array.isArray(p.guests)) return;
    p.id = id;
    rows = rows.concat(peopleRows_(p, row[0]));
  });

  people.clear();
  if (people.getMaxColumns() < HEADERS.People.length) {
    people.insertColumnsAfter(people.getMaxColumns(), HEADERS.People.length - people.getMaxColumns());
  }
  people.getRange(1, 1, 1, HEADERS.People.length).setValues([HEADERS.People]).setFontWeight('bold');
  people.setFrozenRows(1);
  appendRows_(people, rows);
  return rows.length;
}

/* =========================================================================
 * Validation: a self-contained copy of validatePayload() in shaadi/js/logic.js.
 * Keep the two in step when changing rules.
 * ========================================================================= */

/** True for an age the payload may carry: a whole number from 0 to 120. */
function isAge_(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= AGE_MAX;
}

function validatePayload_(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { ok: false, errors: ['Something went wrong with your ticket. Please try again.'] };
  }
  const errors = [];
  if (p.action !== 'rsvp') errors.push('Unknown request.');
  if (!TICKET_ID_RE.test(str_(p.id))) errors.push('Your ticket id looks wrong. Please start a new ticket.');
  if (!relationOf_(p.relation)) errors.push('Pick which side you are from.');
  const label = str_(p.label);
  if (!label || label.length > 100) errors.push('Missing the name on your ticket.');

  const guests = Array.isArray(p.guests) ? p.guests : [];
  if (guests.length < 1 || guests.length > MAX_GUESTS) {
    errors.push(guests.length ? 'That is too many guests for one ticket (max ' + MAX_GUESTS + ').' : 'Please add at least one guest.');
  }
  guests.slice(0, MAX_GUESTS + 1).forEach(function (g, i) {
    const name = str_(g && g.name);
    if (!name) errors.push('Guest ' + (i + 1) + ' needs a name.');
    else if (name.length > 60) errors.push('Guest ' + (i + 1) + "'s name is too long (max 60 characters).");
    const who = name || 'guest ' + (i + 1);
    if (!isAge_(g && g.age)) errors.push('Add ' + who + "'s age (in years).");
    if (STATUSES.indexOf(g && g.status) < 0) errors.push('Pick Confirmed, Waitlisted or Regret for ' + who + '.');
    if (GENDERS.indexOf(g && g.gender) < 0) errors.push('Pick M or F for ' + who + '.');
    const badFlag = GUEST_FLAGS.some(function (k) { return !!g && g[k] !== undefined && typeof g[k] !== 'boolean'; });
    if (badFlag) errors.push('Something is off with ' + who + "'s seat. Please try again.");
  });
  const allRegret = guests.length > 0 && guests.every(function (g) { return !!g && g.status === 'regret'; });
  if (p.travel && typeof p.travel === 'object') checkTravel_(p.travel, errors);
  else if (p.travel != null || !allRegret) errors.push('Tell us roughly how and when you are travelling.');

  if (p.note != null && typeof p.note !== 'string') errors.push('Your note could not be read.');
  else if (str_(p.note).length > 500) errors.push('Your note is too long (max 500 characters).');
  if (p.filled_by != null && (typeof p.filled_by !== 'string' || str_(p.filled_by).length > 100)) {
    errors.push('Something went wrong with your ticket. Please try again.');
  }
  return { ok: errors.length === 0, errors: errors };
}

function checkTravel_(t, errors) {
  const local = t.mode === 'local';
  if (MODES.indexOf(t.mode) < 0) errors.push('Pick how you are travelling: train, flight, bus or car (or "Bhilwara is home").');
  const from = str_(t.from);
  if (!from && !local) errors.push('Tell us roughly where you are travelling from.');
  else if (from.length > 60) errors.push('That city name is too long (max 60 characters).');
  const a = travelSide_(t.arrive, local);
  const d = travelSide_(t.depart, local);
  [[a, 'arrival'], [d, 'departure']].forEach(function (pair) {
    const side = pair[0];
    const word = pair[1];
    const days = TRAVEL_DAYS[word];
    if (!(side.date === 'unsure' || isValidISODate_(side.date))) errors.push('Pick a rough ' + word + ' date (or "Not sure yet").');
    else if (side.date !== 'unsure' && (side.date < travelDay_(days[0]) || side.date > travelDay_(days[1]))) {
      errors.push('Pick a rough ' + word + ' date from ' + days[0] + ' to ' + days[1] + ' Dec (or "Not sure yet").');
    }
    if (slotHour_(side.slot) === null) errors.push('Pick a rough ' + word + ' time of day (or "Not sure yet").');
  });
  checkVia_(t.via, errors);
  if (!isValidISODate_(a.date) || !isValidISODate_(d.date)) return;
  const ah = a.slot === 'unsure' ? null : slotHour_(a.slot);
  const dh = d.slot === 'unsure' ? null : slotHour_(d.slot);
  if (d.date < a.date) errors.push("Your departure date can't be before your arrival date.");
  else if (d.date === a.date && ah !== null && dh !== null && dh < ah) errors.push("Your departure time can't be before your arrival time.");
}

/** A valid hub: '', 'unsure', or an airport/station code of 2 to 5 capital letters (v4 §O3). */
function isHub_(h) {
  return h === '' || h === 'unsure' || (typeof h === 'string' && HUB_RE.test(h));
}

/**
 * Errors for travel.via (v4 §O3), like checkVia() in js/logic.js. A missing via (older pages) is fine,
 * and so is a missing hub or onward inside it; anything given must be well-formed.
 */
function checkVia_(via, errors) {
  if (via === undefined || via === null) return;
  if (typeof via !== 'object' || Array.isArray(via)) {
    errors.push('Something is off with your route. Please pick it again.');
    return;
  }
  if (via.hub !== undefined && !isHub_(via.hub)) errors.push('Pick where you land or get off (or "Not sure yet").');
  if (via.onward !== undefined && ONWARDS.indexOf(via.onward) < 0) {
    errors.push('Pick how you will get on to Bhilwara: car, train or bus (or "Not sure yet").');
  }
}

/**
 * {hub, onward} for a travel object, like buildVia() in js/logic.js: kept for train and flight (getting off
 * at Bhilwara drops the onward leg), {hub:'', onward:''} for every other mode. Anything malformed (say, a
 * hand-edited Responses row) becomes ''.
 */
function viaOf_(t) {
  const none = { hub: '', onward: '' };
  if (!t || VIA_MODES.indexOf(t.mode) < 0) return none;
  const v = t.via && typeof t.via === 'object' && !Array.isArray(t.via) ? t.via : {};
  const hub = str_(v.hub);
  const onward = str_(v.onward);
  return {
    hub: isHub_(hub) ? hub : '',
    onward: hub === HOME_STATION || ONWARDS.indexOf(onward) < 0 ? '' : onward,
  };
}

/** An arrival or departure as {date, slot}. Local guests (Bhilwara is home) may leave both empty: that means 'unsure'. */
function travelSide_(s, local) {
  const o = s && typeof s === 'object' ? s : {};
  if (!local) return { date: o.date, slot: o.slot };
  const blank = function (v) { return v === undefined || v === null || v === ''; };
  return { date: blank(o.date) ? 'unsure' : o.date, slot: blank(o.slot) ? 'unsure' : o.slot };
}

/** A trimmed copy holding only the fields we store. Call after validatePayload_ passes. */
function cleanPayload_(p) {
  const guests = p.guests.map(function (g) {
    const out = { name: str_(g.name), status: g.status, gender: GENDERS.indexOf(g.gender) >= 0 ? g.gender : '', age: g.age };
    GUEST_FLAGS.forEach(function (k) { if (g[k] === true) out[k] = true; });
    return out;
  });
  const allRegret = guests.every(function (g) { return g.status === 'regret'; });
  const t = p.travel;
  let travel = null;
  if (!allRegret && t) {
    const local = t.mode === 'local';
    const a = travelSide_(t.arrive, local);
    const d = travelSide_(t.depart, local);
    travel = {
      mode: t.mode,
      from: str_(t.from) || (local ? LOCAL_FROM : ''),
      arrive: { date: a.date, slot: a.slot },
      depart: { date: d.date, slot: d.slot },
      via: viaOf_(t),
    };
  }
  const client = p.client && typeof p.client === 'object' ? p.client : {};
  return {
    action: 'rsvp',
    id: str_(p.id),
    relation: p.relation,
    label: str_(p.label),
    guests: guests,
    travel: travel,
    note: str_(p.note),
    filled_by: str_(p.filled_by),
    client: { ts: str_(client.ts).slice(0, 40), ua: str_(client.ua).slice(0, 300) },
  };
}

/** Day d of TRAVEL_MONTH as YYYY-MM-DD, e.g. 7 -> '2026-12-07'. */
function travelDay_(d) {
  return TRAVEL_MONTH + '-' + (d < 10 ? '0' : '') + d;
}

function isValidISODate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parts = s.split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toISOString().slice(0, 10) === s;
}

function slotHour_(slot) {
  return SLOTS.indexOf(slot) >= 0 ? SLOT_HOURS[slot] : null;
}

/* =========================================================================
 * Tabs and formatting
 * ========================================================================= */

/** Returns the named tab, creating it at the end and writing its header row if missing. Never overwrites a header row that has content. */
function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, ss.getNumSheets());
  if (headers) {
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    const firstRow = sh.getRange(1, 1, 1, headers.length);
    const blank = firstRow.getValues()[0].every(function (v) { return v === '' || v === null; });
    if (blank) {
      firstRow.setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function headerMatches_(sh, headers) {
  if (sh.getLastColumn() < headers.length) return false;
  const row = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  return headers.every(function (h, i) { return cell_(row[i]).toLowerCase() === h; });
}

/** Runs fn under the script lock (so it never clashes with a guest saving). Returns null when the lock is busy. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return null;
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** A new Sheet starts with an empty "Sheet1": remove such untouched starter tabs. Returns how many went. */
function removeBlankStarterTabs_(ss) {
  let removed = 0;
  ss.getSheets().forEach(function (sh) {
    const name = sh.getName();
    const ours = [SHEET.responses, SHEET.people, SHEET.summary].indexOf(name) >= 0;
    if (ours || !/^sheet\s*\d*$/i.test(name) || sh.getLastRow() > 0 || sh.getLastColumn() > 0) return;
    if (ss.getSheets().length > 1) {
      ss.deleteSheet(sh);
      removed++;
    }
  });
  return removed;
}

function boldHeader_(sh) {
  sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function formatResponses_(sh) {
  boldHeader_(sh);
  sh.getRange('A2:A').setNumberFormat('d mmm yyyy, h:mm am/pm');
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(3, 170);
  sh.setColumnWidth(4, 200);
  sh.setColumnWidth(5, 420);
}

/** People column letter for a HEADERS.People name: 'status' -> 'G', 'hub' -> 'J'. */
function peopleCol_(name) {
  const i = HEADERS.People.indexOf(name);
  if (i < 0) throw new Error('People has no column "' + name + '"');
  return colLetter_(i + 1);
}

/** Column widths for People, by header. */
const PEOPLE_WIDTHS = {
  id: 100, side: 190, relation: 180, label: 170, person: 170, gender: 65, age: 55, status: 100, mode: 70, from: 120,
  hub: 60, onward: 70, arrive_date: 100, arrive_slot: 100, depart_date: 100, depart_slot: 100, note: 260,
  filled_by: 160, updated_at: 170, added: 70,
};

function formatPeople_(sh) {
  boldHeader_(sh);
  const updated = peopleCol_('updated_at');
  sh.getRange(updated + '2:' + updated).setNumberFormat('d mmm yyyy, h:mm am/pm');
  HEADERS.People.forEach(function (h, i) { sh.setColumnWidth(i + 1, PEOPLE_WIDTHS[h] || 100); });
  const status = peopleCol_('status');
  const range = sh.getRange(status + '2:' + status);
  const rules = [
    ['confirmed', '#DCEFDC', '#1B5E20'],
    ['waitlisted', '#FFEBC7', '#7A4100'],
    ['regret', '#F8DADA', '#8E1B1B'],
  ].map(function (r) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(r[0]).setBackground(r[1]).setFontColor(r[2]).setRanges([range]).build();
  });
  sh.setConditionalFormatRules(rules);
}

/* =========================================================================
 * Summary
 * ========================================================================= */

/**
 * Rebuilds the Summary tab: formulas only, so it is always safe to wipe. People columns are referred to
 * by their HEADERS.People name. Lists that grow (pickup list, everyone, notes) each get their own
 * columns with nothing underneath, so they can spill down freely.
 */
function buildSummary_(sh) {
  sh.clear();
  sh.clearConditionalFormatRules();
  // Left: tables and the pickup list (A–M). Right, from column O: everyone who replied, then notes.
  const PICKUP_COLS = 13;
  const EVERYONE = PICKUP_COLS + 2; // O, after a narrow spacer column
  const EVERYONE_COLS = 8;
  const NOTES = EVERYONE + EVERYONE_COLS + 1;
  const COLS = NOTES + 2;
  if (sh.getMaxColumns() < COLS) sh.insertColumnsAfter(sh.getMaxColumns(), COLS - sh.getMaxColumns());

  /** A whole People column (from row 2) by header name: P('status') -> People!$H$2:$H. */
  const P = function (name) {
    const L = peopleCol_(name);
    return 'People!$' + L + '$2:$' + L;
  };
  const STATUS = P('status');
  const ACTIVE = '((' + STATUS + '="confirmed")+(' + STATUS + '="waitlisted"))';
  const NOT_LOCAL = '(' + P('mode') + '<>"local")';
  const title = function (r, c, text) { sh.getRange(r, c).setValue(text).setFontWeight('bold').setFontSize(12).setFontColor('#10164A'); };
  const header = function (r, c, labels) {
    sh.getRange(r, c, 1, labels.length).setValues([labels]).setFontWeight('bold').setBackground('#FCE9D6');
  };
  const block = function (r, rows) { sh.getRange(r, 1, rows.length, rows[0].length).setValues(rows); };
  const note = function (r, text) { sh.getRange(r, 1).setValue(text).setFontColor('#555555').setFontStyle('italic'); };

  sh.getRange('A1').setValue('Save the Train (Shaadi): summary').setFontWeight('bold').setFontSize(15).setFontColor('#10164A');
  sh.getRange('A2').setValue("Updates by itself from the People tab. Don't type in this tab (run setup to rebuild it). More lists to the right →")
    .setFontColor('#555555');

  // People by relation and status, with a subtotal per side
  let r = 4;
  header(r, 1, ['People by relation', 'Confirmed', 'Waitlisted', 'Regret', 'Total']);
  const rows = [];
  const subtotalRows = [];
  ['a', 'b'].forEach(function (side) {
    const first = r + 1 + rows.length;
    RELATIONS.filter(function (rel) { return rel.side === side; }).forEach(function (rel) {
      const n = r + 1 + rows.length;
      rows.push([text_(rel.label)].concat(STATUSES.map(function (st) {
        return '=COUNTIFS(' + P('relation') + ',"' + rel.label + '",' + STATUS + ',"' + st + '")';
      })).concat(['=SUM(B' + n + ':D' + n + ')']));
    });
    const last = r + rows.length;
    subtotalRows.push(r + 1 + rows.length);
    rows.push([text_(SIDES[side] + ', total')].concat(['B', 'C', 'D', 'E'].map(function (L) { return '=SUM(' + L + first + ':' + L + last + ')'; })));
  });
  rows.push(['Everyone who answered'].concat(['B', 'C', 'D', 'E'].map(function (L) {
    return '=' + subtotalRows.map(function (n) { return L + n; }).join('+');
  })));
  block(r + 1, rows);
  subtotalRows.concat([r + rows.length]).forEach(function (n) { sh.getRange(n, 1, 1, 5).setFontWeight('bold'); });
  r += rows.length + 2;

  // Other counts
  header(r, 1, ['Also', SIDES.a, SIDES.b, 'Total']);
  const bySide = function (label, formula) {
    return [label].concat(['a', 'b'].map(function (side) { return '=' + formula('(' + P('side') + '="' + SIDES[side] + '")'); }));
  };
  const counts = [
    bySide('Confirmed + waitlisted', function (side) { return 'ARRAYFORMULA(SUMPRODUCT(' + ACTIVE + '*' + side + '))'; }),
    bySide('Locals (Bhilwara is home), confirmed + waitlisted', function (side) {
      return 'ARRAYFORMULA(SUMPRODUCT(' + ACTIVE + '*(' + P('mode') + '="local")*' + side + '))';
    }),
    bySide('Tickets (one per phone that replied)', function (side) {
      return 'IFERROR(ROWS(UNIQUE(FILTER(' + P('id') + ',' + side + '))),0)';
    }),
  ].map(function (row, i) { return row.concat(['=B' + (r + 1 + i) + '+C' + (r + 1 + i)]); });
  block(r + 1, counts);
  r += counts.length + 1;
  sh.getRange(r, 1, 1, 2).setValues([['Submissions incl. edits', '=COUNTA(Responses!$B$2:$B)']]);
  r += 2;

  // Ages of everyone coming (confirmed + waitlisted), by side
  title(r, 1, 'Ages (confirmed + waitlisted)');
  r++;
  header(r, 1, ['Age', SIDES.a, SIDES.b, 'Total']);
  const AGE = P('age');
  const ageRows = AGE_BANDS.map(function (band, i) {
    const n = r + 1 + i;
    const inBand = 'ISNUMBER(' + AGE + ')*(' + AGE + '>=' + band.min + ')*(' + AGE + '<=' + band.max + ')';
    return [text_(band.label)].concat(['a', 'b'].map(function (side) {
      return '=ARRAYFORMULA(SUMPRODUCT(' + ACTIVE + '*' + inBand + '*(' + P('side') + '="' + SIDES[side] + '")))';
    })).concat(['=B' + n + '+C' + n]);
  });
  const ageFirst = r + 1;
  const ageLast = r + ageRows.length;
  ageRows.push(['Total'].concat(['B', 'C', 'D'].map(function (L) { return '=SUM(' + L + ageFirst + ':' + L + ageLast + ')'; })));
  block(r + 1, ageRows);
  sh.getRange(r + ageRows.length, 1, 1, 4).setFontWeight('bold');
  r += ageRows.length + 2;

  // Nights in Bhilwara (locals sleep at home, so they're left out)
  title(r, 1, 'Nights in Bhilwara (travelling guests)');
  r++;
  header(r, 1, ['Night of', 'Confirmed', 'Waitlisted', 'Total']);
  const nights = nightRows_(P);
  block(r + 1, nights.map(function (g, i) {
    const row = r + 1 + i;
    const here = g.match + '*' + NOT_LOCAL;
    return [
      text_(g.label), // plain text, so Sheets doesn't turn "Wed 9 Dec" into a date
      '=ARRAYFORMULA(SUMPRODUCT((' + STATUS + '="confirmed")*' + here + '))',
      '=ARRAYFORMULA(SUMPRODUCT((' + STATUS + '="waitlisted")*' + here + '))',
      '=B' + row + '+C' + row,
    ];
  }));
  r += nights.length + 1;
  note(r, 'Someone counts for a night if they arrive on or before that date and leave after it. "Nights before 9 Dec" counts the people who arrive before 9 Dec, and "Nights from 12 Dec on" the people who leave after 12 Dec (people, not nights). "Not sure yet" counts as arriving 9 Dec and leaving 12 Dec. Locals are not counted here or in the tables below.');
  r += 2;

  // Arrivals and departures grids (confirmed + waitlisted travelling guests)
  const active = ACTIVE + '*' + NOT_LOCAL;
  r = dateSlotGrid_(sh, r, 'Arrivals (confirmed + waitlisted, not locals)', ARRIVE_DATES, 'arrive_date', 'arrive_slot', active, title, header, P);
  r = dateSlotGrid_(sh, r, 'Departures (confirmed + waitlisted, not locals)', DEPART_DATES, 'depart_date', 'depart_slot', active, title, header, P);
  // dateSlotGrid_ leaves one blank row after its Total: the note goes there, with a blank row after it.
  note(r - 1, '"Other dates" counts the guests who typed in a day that isn\'t listed (with "Other date" on the website). The pickup list below shows each of them with their dates.');
  r += 1;

  // Arrivals by hub: where travelling guests land or get off, across all dates (for pickups)
  title(r, 1, 'Arrivals by hub (confirmed + waitlisted, all dates, not locals)');
  r++;
  const hubRows = hubTableRows_(P, r + 1);
  header(r, 1, hubRows.header);
  block(r + 1, hubRows.rows);
  sh.getRange(r + hubRows.rows.length, 1, 1, hubRows.header.length).setFontWeight('bold');
  r += hubRows.rows.length + 1;
  note(r, 'Hub = the airport a guest lands at, or the station they get off at. "Then by car/cab" counts those going on to Bhilwara by road in a car or cab. Bus and car travellers are under "None given".');
  r += 2;

  // Pickup list, sorted by arrival date then time of day (spills down; nothing below it)
  title(r, 1, 'Pickup list (confirmed + waitlisted, by arrival; locals left out)');
  r++;
  header(r, 1, ['Arrive date', 'Arrive time', 'Guest', 'Age', 'Relation', 'Status', 'Mode', 'From', 'Via', 'Then by', 'Leave date', 'Leave time', 'Ticket']);
  const slotRank = 'ARRAYFORMULA(IFERROR(MATCH(' + P('arrive_slot') + ',{"' + SLOTS.join('","') + '"},0),9))';
  sh.getRange(r + 1, 1).setFormula(
    '=IFERROR(QUERY({' + [P('arrive_date'), P('arrive_slot'), P('person'), P('age'), P('relation'), P('status'), P('mode'), P('from'),
      P('hub'), P('onward'), P('depart_date'), P('depart_slot'), P('label'), slotRank].join(',') + '},' +
    '"select Col1,Col2,Col3,Col4,Col5,Col6,Col7,Col8,Col9,Col10,Col11,Col12,Col13 where (Col6=\'confirmed\' or Col6=\'waitlisted\') and Col7<>\'local\' order by Col1,Col14,Col13,Col3",0),' +
    '"No arrivals yet")'
  );

  // Right-hand lists, side by side from row 4. Each reads People through {…} column arrays (never
  // QUERY column letters), so inserting a People column can't point them at the wrong data.
  title(3, EVERYONE, 'Everyone who replied, by relation');
  header(4, EVERYONE, ['Relation', 'Guest', 'Age', 'Gender', 'Status', 'Mode', 'From', 'Ticket']);
  const relationRank = 'ARRAYFORMULA(IFERROR(MATCH(' + P('relation') + ',{"' +
    RELATIONS.map(function (rel) { return rel.label; }).join('","') + '"},0),99))';
  sh.getRange(5, EVERYONE).setFormula(
    '=IFERROR(QUERY({' + [P('relation'), P('person'), P('age'), P('gender'), P('status'), P('mode'), P('from'), P('label'), relationRank].join(',') + '},' +
    '"select Col1,Col2,Col3,Col4,Col5,Col6,Col7,Col8 where Col2<>\'\' order by Col9,Col8,Col2",0),"No replies yet")'
  );

  title(3, NOTES, 'Notes from guests');
  header(4, NOTES, ['Ticket', 'Note']);
  sh.getRange(5, NOTES).setFormula(
    '=IFERROR(UNIQUE(FILTER({' + P('label') + ',' + P('note') + '},' + P('note') + '<>"")),"No notes yet")'
  );

  sh.setColumnWidth(1, 250);
  for (let c = 2; c <= PICKUP_COLS; c++) sh.setColumnWidth(c, 105);
  [PICKUP_COLS + 1, NOTES - 1].forEach(function (c) { sh.setColumnWidth(c, 24); });
  [[EVERYONE, [180, 160, 55, 65, 90, 70, 110, 160]], [NOTES, [200, 320]]].forEach(function (list) {
    list[1].forEach(function (w, i) { sh.setColumnWidth(list[0] + i, w); });
  });
  sh.setFrozenRows(2);
}

/**
 * The "Arrivals by hub" table (v4 §O3): confirmed and waitlisted travelling guests (locals left out)
 * per hub, across all arrival dates and times. One row per known hub (HUBS), then "Not sure yet",
 * "Other code", "None given" and a Total row; together they count every travelling guest exactly once.
 * @param {function(string):string} P People column range by header name
 * @param {number} first the Sheet row of the first hub row (for the Total and per-row sums)
 * @returns {{header:string[], rows:Array[]}}
 */
function hubTableRows_(P, first) {
  const STATUS = P('status');
  const HUB = P('hub');
  const travelling = '(' + P('mode') + '<>"local")';
  const known = HUBS.map(function (h) { return h.code; }).concat(['unsure']);
  const count = function (status, match) {
    return '=ARRAYFORMULA(SUMPRODUCT((' + STATUS + '="' + status + '")*' + travelling + '*' + match + '))';
  };
  const active = '((' + STATUS + '="confirmed")+(' + STATUS + '="waitlisted"))';
  const byCar = function (match) {
    return '=ARRAYFORMULA(SUMPRODUCT(' + active + '*' + travelling + '*' + match + '*(' + P('onward') + '="car")))';
  };
  const row = function (label, match, i) {
    const n = first + i;
    return [text_(label), count('confirmed', match), count('waitlisted', match), '=B' + n + '+C' + n, byCar(match)];
  };
  const groups = HUBS.map(function (h) { return [h.code + ' · ' + h.name, '(' + HUB + '="' + h.code + '")']; }).concat([
    ['Not sure yet', '(' + HUB + '="unsure")'],
    ['Other code', '(' + HUB + '<>"")*ISNA(MATCH(' + HUB + ',{"' + known.join('","') + '"},0))'],
    ['None given (bus, car, or not picked)', '(' + HUB + '="")'],
  ]);
  const rows = groups.map(function (g, i) { return row(g[0], g[1], i); });
  const last = first + rows.length - 1;
  rows.push(['Total'].concat(['B', 'C', 'D', 'E'].map(function (L) { return '=SUM(' + L + first + ':' + L + last + ')'; })));
  return { header: ['Hub', 'Confirmed', 'Waitlisted', 'Total', 'Then by car/cab'], rows: rows };
}

/**
 * A People date column (e.g. People!$L$2:$L) as YYYY-MM-DD text, for the Summary's array formulas. The script
 * always writes dates as text, but a date typed into People by hand without a leading apostrophe becomes a
 * date number, and Sheets sorts every number before any text: left as a number it would count as arriving
 * before 9 Dec (and staying every night) yet match no row of the arrivals or departures grid.
 */
function dateText_(col) {
  return 'IF(ISNUMBER(' + col + '),TEXT(' + col + ',"yyyy-mm-dd"),' + col + ')';
}

/**
 * The rows of the "Nights in Bhilwara" table as {label, match}, where match is a 0/1 Sheets array expression
 * per People row (status and locals are filtered by the caller). One row per listed night (arrive on or before
 * it, leave after it), between "Nights before 9 Dec" (people who arrive before the first listed night) and
 * "Nights from 12 Dec on" (people who leave after NIGHTS_END), both from v4 §Q. Those two count people, not
 * nights, and only people who stay at least one night (leave after the day they arrive).
 * "Not sure yet" counts as arriving UNSURE_ARRIVE and leaving UNSURE_DEPART. Dates are compared as text (dateText_).
 */
function nightRows_(P) {
  const arrive = 'IF(' + P('arrive_date') + '="unsure","' + UNSURE_ARRIVE + '",' + dateText_(P('arrive_date')) + ')';
  const depart = 'IF(' + P('depart_date') + '="unsure","' + UNSURE_DEPART + '",' + dateText_(P('depart_date')) + ')';
  const stays = '(' + depart + '>' + arrive + ')';
  const dayMonth = function (iso) { return dateLabel_(iso).replace(/^\S+ /, ''); }; // 'Wed 9 Dec' -> '9 Dec'
  return [{ label: 'Nights before ' + dayMonth(NIGHTS[0]), match: '(' + arrive + '<"' + NIGHTS[0] + '")*' + stays }]
    .concat(NIGHTS.map(function (night) {
      return { label: dateLabel_(night), match: '(' + arrive + '<="' + night + '")*(' + depart + '>"' + night + '")' };
    }))
    .concat([{ label: 'Nights from ' + dayMonth(NIGHTS_END) + ' on', match: '(' + depart + '>"' + NIGHTS_END + '")*' + stays }]);
}

/**
 * The rows of an arrivals or departures grid as {label, match} (match as in nightRows_): one per listed date,
 * then "Other dates" (any other YYYY-MM-DD date, typed in under "Other date", v4 §Q), then "Not sure yet"
 * when 'unsure' is listed. Together they count every People row with a date exactly once (dates as text, dateText_).
 * @param {string} col the People date column range, e.g. People!$L$2:$L
 * @param {string[]} dates ARRIVE_DATES or DEPART_DATES
 */
function dateRows_(col, dates) {
  const date = dateText_(col);
  const rows = dates.filter(function (d) { return d !== 'unsure'; }).map(function (d) {
    return { label: dateLabel_(d), match: '(' + date + '="' + d + '")' };
  });
  rows.push({
    label: 'Other dates',
    match: 'REGEXMATCH(""&' + date + ',"' + SHEET_DATE_RE + '")*ISNA(MATCH(' + date + ',{"' + dates.join('","') + '"},0))',
  });
  if (dates.indexOf('unsure') >= 0) rows.push({ label: dateLabel_('unsure'), match: '(' + col + '="unsure")' });
  return rows;
}

/** A date × time-of-day table of people counts (rows from dateRows_, then a Total row). Returns the next free row. */
function dateSlotGrid_(sh, r, heading, dates, dateCol, slotCol, active, title, header, P) {
  title(r, 1, heading);
  r++;
  header(r, 1, ['Date'].concat(SLOTS.map(function (s) { return SLOT_LABELS[s]; })).concat(['Total']));
  const lastSlotCol = colLetter_(1 + SLOTS.length);
  const totalCol = 2 + SLOTS.length;
  const groups = dateRows_(P(dateCol), dates);
  const rows = groups.map(function (g, i) {
    const row = r + 1 + i;
    return [text_(g.label)].concat(SLOTS.map(function (slot) {
      return '=ARRAYFORMULA(SUMPRODUCT(' + g.match + '*(' + P(slotCol) + '="' + slot + '")*' + active + '))';
    })).concat(['=SUM(B' + row + ':' + lastSlotCol + row + ')']);
  });
  const totalRow = r + 1 + rows.length;
  const totals = ['Total'];
  for (let c = 2; c <= totalCol; c++) {
    const L = colLetter_(c);
    totals.push('=SUM(' + L + (r + 1) + ':' + L + (totalRow - 1) + ')');
  }
  sh.getRange(r + 1, 1, rows.length + 1, totalCol).setValues(rows.concat([totals]));
  sh.getRange(totalRow, 1, 1, totalCol).setFontWeight('bold');
  return totalRow + 2;
}

/* =========================================================================
 * Small helpers
 * ========================================================================= */

function ss_() {
  const id = String(SPREADSHEET_ID || '').trim();
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script is not attached to your Sheet. Either open it from the Sheet (Extensions > Apps Script), or paste the Sheet ID into SPREADSHEET_ID at the top of Code.gs.');
  return ss;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, error) {
  return { ok: false, error: error, code: code };
}

/** Trimmed string from a payload field; anything that isn't a string becomes ''. */
function str_(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** Trimmed string from a Sheet cell (numbers, dates and booleans are stringified). */
function cell_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function normId_(v) {
  return cell_(v).toLowerCase();
}

/**
 * Text for a Sheet cell. The leading apostrophe makes Sheets store it as plain
 * text: guest-typed values can never run as formulas (e.g. "=IMPORTXML(...)"),
 * and dates like 2026-12-09 stay exactly as written for the Summary formulas.
 */
function text_(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return s ? "'" + s : '';
}

/** '2026-12-09' -> 'Wed 9 Dec'; 'unsure' -> 'Not sure yet'. */
function dateLabel_(iso) {
  if (!isValidISODate_(iso)) return 'Not sure yet';
  const parts = iso.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return dow + ' ' + d.getUTCDate() + ' ' + mon;
}

/** 1 -> A, 26 -> Z, 27 -> AA. */
function colLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function notify_(msg) {
  Logger.log(msg);
  try {
    ss_().toast(msg, 'Save the Train', 10);
  } catch (err) {
    // Toasts need an open Sheet; the Execution log already has the message.
  }
}

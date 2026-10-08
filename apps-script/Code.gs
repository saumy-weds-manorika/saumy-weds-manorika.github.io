/**
 * Save the Train: Google Apps Script backend for Saumy & Manorika's RSVP site.
 *
 * It runs inside Saumy's own guest-list workbook. Upload "Wedding Invites.xlsx"
 * to Google Drive, open it with Google Sheets (File > Save as Google Sheets),
 * then paste this whole file into Extensions > Apps Script (replace everything
 * in Code.gs). Full steps are in docs/SETUP.md.
 *
 * The guest list is read from two tabs (found by name, ignoring case and spaces):
 *   "First List"  -> list Primary        "Second List" -> list Secondary
 * Row 1 of each holds the headers:
 *   A Guest 1 | B Gender Guest 1 | C Guest 2 | D Gender Guest 2 | E Both Primary? | F Nicknames | G ID
 * Guest 2 is a partner's name, or Mr / Mrs / Ms (partner invited, name unknown), or NA.
 * setup adds the Nicknames and ID headers when they are missing and fills in the IDs.
 *
 * Deploy as a Web app with "Execute as: Me" and "Who has access: Anyone".
 *   GET  ?action=find&q=<3+ letters>  -> {ok, matches:[{id,label}]}   (best 5, forgiving search)
 *   GET  ?action=guest&id=<id>        -> {ok, guest:{id,label,names,genders,partner,max_guests,couple,list,booked}}
 *   GET  ?action=ping (or no action)  -> {ok, service, version, time}
 *   POST text/plain JSON RSVP         -> {ok:true, id, updated_at} or {ok:false, error, code}
 *        (travel may carry via:{hub, onward}, the airport/station a guest lands at and how they get
 *        on to Bhilwara; older pages leave it out, which is fine)
 *
 * Functions you run yourself (pick one in the toolbar, then click Run, or use
 * the "Save the Train" menu inside the Sheet):
 *   setup              adds Nicknames/ID headers and IDs, creates or repairs Summary, People and Responses (safe to re-run;
 *                      it also adds the v4 hub and onward columns to an older People tab, keeping every row)
 *   generateIds        gives every guest row without an ID a short unique ID
 *   listPersonalLinks  shows a personal link per guest (uses SITE_URL below)
 *   rebuildPeople      rewrites the People tab from the Responses log
 */

/** The public address of the website (GitHub Pages for this repo). Change it if you host elsewhere. */
const SITE_URL = 'https://saumy-weds-manorika.github.io/';
/**
 * Only needed if this script was created on its own at script.google.com (a "standalone" project)
 * instead of from the Sheet's Extensions > Apps Script menu. Paste the long ID from your Sheet's
 * address bar here: https://docs.google.com/spreadsheets/d/<THIS PART>/edit
 * Leave it '' when the script is attached to the Sheet.
 */
const SPREADSHEET_ID = '';
/** Shown by ?action=ping, so you can tell that the newest version of this script is the one that's live. */
const API_VERSION = 'v4';

const SHEET = { responses: 'Responses', people: 'People', summary: 'Summary' };
const HEADERS = {
  Responses: ['ts', 'id', 'label', 'unlisted', 'payload_json'],
  People: ['id', 'label', 'list', 'couple', 'person', 'gender', 'status', 'mode', 'from', 'hub', 'onward',
    'arrive_date', 'arrive_slot', 'depart_date', 'depart_slot', 'note', 'filled_by', 'updated_at', 'unlisted', 'added', 'partner'],
};
/** The v3 People layout (no hub/onward). setup and saving upgrade it in place by inserting two columns after 'from'. */
const PEOPLE_V3 = ['id', 'label', 'list', 'couple', 'person', 'gender', 'status', 'mode', 'from', 'arrive_date', 'arrive_slot',
  'depart_date', 'depart_slot', 'note', 'filled_by', 'updated_at', 'unlisted', 'added', 'partner'];

/** The two guest-list tabs. A tab whose name contains "first"/"primary" is Primary; "second"/"secondary" is Secondary. */
const LIST_TABS = [
  { list: 'Primary', name: 'First List', re: /first|primary/ },
  { list: 'Secondary', name: 'Second List', re: /second|secondary/ },
];
/**
 * Columns of a list tab, found by their row-1 header (ignoring case, spaces and punctuation).
 * `pos` is the usual position (A = 0), used when a required header can't be found.
 * `auto` columns are the ones setup adds when they are missing.
 */
const LIST_COLS = [
  { key: 'guest1', header: 'Guest 1', aliases: ['guest1', 'guest1name', 'guest', 'name'], pos: 0 },
  { key: 'gender1', header: 'Gender Guest 1', aliases: ['genderguest1', 'guest1gender', 'gender1', 'gender'], pos: 1 },
  { key: 'guest2', header: 'Guest 2', aliases: ['guest2', 'guest2name', 'partner'], pos: 2 },
  { key: 'gender2', header: 'Gender Guest 2', aliases: ['genderguest2', 'guest2gender', 'gender2'], pos: 3 },
  { key: 'both', header: 'Both Primary?', aliases: ['bothprimary', 'couple'], pos: 4 },
  { key: 'nick', header: 'Nicknames', aliases: ['nicknames', 'nickname', 'aliases', 'alias'], pos: 5, auto: true },
  { key: 'id', header: 'ID', aliases: ['id', 'guestid'], pos: 6, auto: true },
];
/** Every ticket may carry up to 4 people (the invite plus "Add guest"). */
const MAX_GUESTS = 4;
/** Cells that mean "nothing here": NA, N/A, N / A, N.A, N.A., -, --. */
const EMPTY_CELL_RE = /^(n\s*\/?\s*a\.?|n\.a\.?|-+)$/i;
/** Guest 2 holding just a title ("Mrs", "Mrs.", "Mrs .", "Smt", "Miss") means "partner invited, name unknown". */
const TITLE_RE = /^(mr|mrs|ms|miss|smt)\s*\.?$/i;
const TITLES = { mr: 'Mr', mrs: 'Mrs', ms: 'Ms', miss: 'Ms', smt: 'Mrs' };
const TITLE_GENDER = { Mr: 'M', Mrs: 'F', Ms: 'F' };

const STATUSES = ['confirmed', 'waitlisted', 'regret'];
const GENDERS = ['M', 'F', ''];
const GUEST_FLAGS = ['added', 'partner']; // optional booleans on a payload guest
const MODES = ['local', 'train', 'flight', 'bus', 'car'];
const LOCAL_FROM = 'Bhilwara';
/** travel.via (v4 §O3): only these modes ask "landing at / getting off at" and "then on by". */
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
const NIGHTS = ['2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'];
const ARRIVE_DATES = ['2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', 'unsure'];
const DEPART_DATES = ['2026-12-11', '2026-12-12', '2026-12-13', '2026-12-14', 'unsure'];
const UNSURE_ARRIVE = '2026-12-09';
const UNSURE_DEPART = '2026-12-12';
const MAX_RESPONSES = 5000;
const MAX_BODY_CHARS = 20000;
const MAX_MATCHES = 5;
const UNLISTED_RE = /^u-[a-z0-9]{8}$/;

/** The parsed guest list is cached for 60s so search stays fast; editing a list tab clears it (see onEdit). */
const CACHE_KEY = 'stt.guests.v3';
const CACHE_SECONDS = 60;
const CACHE_CHUNK = 30000; // characters per cache entry (each entry must stay under 100KB)

/* =========================================================================
 * Web app entry points
 * ========================================================================= */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const action = String(p.action || 'ping');
    if (action === 'find') return json_({ ok: true, matches: findMatches_(p.q) });
    if (action === 'guest') {
      const guest = findGuestById_(p.id);
      if (!guest) return json_(fail_('unknown_guest', 'unknown guest'));
      return json_({ ok: true, guest: publicGuest_(guest, findBooked_(guest.id)) });
    }
    if (action === 'ping') {
      return json_({ ok: true, service: 'save-the-train', version: API_VERSION, time: new Date().toISOString() });
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
  if (!check.ok) return json_(fail_('invalid', check.errors.slice(0, 5).join(' ')));
  const payload = cleanPayload_(body);

  const lock = LockService.getScriptLock();
  try {
    // 10s, so a queued guest gets a 'busy' answer well before the website gives up (25s).
    lock.waitLock(10000);
  } catch (err) {
    return json_(fail_('busy', 'busy'));
  }
  try {
    return json_(saveRsvp_(payload, { keepNote: body.keep_note === true }));
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
    .addItem('Fill in missing guest ids', 'generateIds')
    .addItem('Show personal links', 'listPersonalLinks')
    .addItem('Rebuild People from Responses', 'rebuildPeople')
    .addToUi();
}

/** Runs by itself on every edit you make. An edit to a list tab clears the cached guest list. */
function onEdit(e) {
  try {
    const name = e && e.range ? e.range.getSheet().getName() : '';
    if (listOf_(name)) clearGuestCache_();
  } catch (err) {
    // The cache simply expires within 60 seconds instead.
  }
}

/* =========================================================================
 * Functions to run by hand
 * ========================================================================= */

/**
 * Adds the Nicknames and ID headers to the list tabs (when missing), fills in missing IDs,
 * and creates or repairs Summary, People and Responses. Never deletes guest or response data.
 */
function setup() {
  const ss = ss_();
  const tabs = prepareListTabs_(ss);
  const summary = ensureSheet_(ss, SHEET.summary, null);
  const people = ensureSheet_(ss, SHEET.people, HEADERS.People);
  const responses = ensureSheet_(ss, SHEET.responses, HEADERS.Responses);

  let rebuilt = -1;
  let upgraded = false;
  if (!headerMatches_(people, HEADERS.People)) {
    // People from an older version of this script. The v3 layout gets the hub and onward columns
    // inserted in place (every row kept); anything older is rebuilt from Responses in the new layout.
    const done = withLock_(function () {
      if (upgradePeople_(people)) return 'upgraded';
      return rebuildPeople_(ss, people);
    });
    if (done === 'upgraded') upgraded = true;
    else rebuilt = done;
  }
  const ids = fillIds_(tabs);
  clearGuestCache_();

  formatResponses_(responses);
  formatPeople_(people);
  buildSummary_(summary, tabs);
  SpreadsheetApp.flush();

  const found = tabs.map(function (t) { return '"' + t.sheet.getName() + '" (' + t.list + ')'; }).join(' and ');
  let msg = 'Setup done. Guest lists: ' + found + '. ' + idMessage_(ids);
  if (tabs.length < LIST_TABS.length) msg += ' Only one list tab was found; that is fine if you have just one list.';
  if (rebuilt === null) msg += ' People still has an old layout: run setup again, or "Rebuild People from Responses", when nobody is submitting.';
  else if (rebuilt >= 0) msg += ' People was rebuilt in the new layout (' + rebuilt + ' rows).';
  if (upgraded) msg += ' People got the new hub and onward columns (after "from"); every existing row was kept.';
  notify_(msg);
}

/** Gives every guest row that has a Guest 1 name but no ID a unique 4-character ID (unique across both tabs). */
function generateIds() {
  const tabs = prepareListTabs_(ss_());
  const ids = fillIds_(tabs);
  clearGuestCache_();
  SpreadsheetApp.flush();
  notify_(idMessage_(ids));
}

/** Lists "label: personal link" for every guest. Shows a dialog in the Sheet and writes to the Execution log. */
function listPersonalLinks() {
  const guests = lookupList_(readAllGuests_(ss_()));
  if (!guests.length) {
    notify_('No guests with IDs yet. Run "Fill in missing guest ids" first.');
    return;
  }
  const base = String(SITE_URL).trim();
  const placeholder = !/^https?:\/\//i.test(base) || /YOUR-SITE-ADDRESS/i.test(base);
  const lines = guests.map(function (g) { return g.label + ': ' + personalLink_(base, g.id); });
  if (placeholder) Logger.log('Heads up: SITE_URL at the top of Code.gs is still a placeholder. Put your website address there first.');
  lines.forEach(function (line) { Logger.log(line); });

  try {
    const warn = placeholder
      ? '<p style="color:#C62828"><b>SITE_URL at the top of Code.gs is still a placeholder.</b> Put your website address there, save, then run this again.</p>'
      : '';
    const html = HtmlService.createHtmlOutput(
      '<div style="font-family:Arial,sans-serif">' + warn +
      '<p>Copy a line and paste it into that person\'s WhatsApp chat.</p>' +
      '<textarea readonly style="width:100%;height:340px;font-size:13px">' + escapeHtml_(lines.join('\n')) + '</textarea></div>'
    ).setWidth(680).setHeight(460);
    SpreadsheetApp.getUi().showModalDialog(html, 'Personal links (' + lines.length + ')');
  } catch (err) {
    // No Sheet window to show a dialog in (e.g. run from the editor): the Execution log has the list.
  }
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

/* =========================================================================
 * RSVP saving
 * ========================================================================= */

/**
 * Saves a cleaned payload. opts.keepNote: the guest left the note empty on a ticket whose saved
 * answer has a note they can't see (bookedFrom_ never sends it), so the previous note is kept.
 */
function saveRsvp_(p, opts) {
  const ss = ss_();
  const responses = ensureSheet_(ss, SHEET.responses, HEADERS.Responses);
  const people = ensureSheet_(ss, SHEET.people, HEADERS.People);

  let label = p.label;
  let info = { list: 'Unlisted', couple: false };
  if (!p.unlisted) {
    const guest = findGuestById_(p.id);
    if (!guest) return fail_('unknown_guest', 'unknown guest');
    if (p.guests.length > guest.max_guests) return fail_('too_many', 'too many guests for this invite');
    label = guest.label; // trust the Sheet, not the browser
    info = { list: guest.list, couple: guest.couple };
  }
  if (responses.getLastRow() - 1 >= MAX_RESPONSES) return fail_('full', 'response limit reached');

  const now = new Date();
  const note = !p.note && opts && opts.keepNote ? previousNote_(responses, p.id).slice(0, 500) : p.note;
  const stored = Object.assign({}, p, { label: label, note: note });
  responses.appendRow([now, text_(p.id), text_(label), p.unlisted, text_(JSON.stringify(stored))]);
  // A v3 People tab (this version went live before setup was run) gets its hub/onward columns first,
  // so the new rows line up with the headers.
  // If the header is some other unrecognised layout, rebuild People from the Responses log (which
  // already includes this answer) rather than writing rows under the wrong columns.
  if (!headerMatches_(people, HEADERS.People) && !upgradePeople_(people)) rebuildPeople_(ss, people);
  else replacePeopleRows_(people, p.id, peopleRows_(stored, info, now));
  SpreadsheetApp.flush();
  return { ok: true, id: p.id, updated_at: now.toISOString() };
}

/**
 * One People row per guest, in HEADERS.People order. Regret rows leave the travel columns blank.
 * @param {object} p a stored payload
 * @param {{list:string, couple:boolean}} info from the guest list ('Unlisted' for unlisted tickets)
 * @param {Date} when
 */
function peopleRows_(p, info, when) {
  const t = p.travel && typeof p.travel === 'object' ? p.travel : null;
  const a = t && t.arrive && typeof t.arrive === 'object' ? t.arrive : {};
  const d = t && t.depart && typeof t.depart === 'object' ? t.depart : {};
  const via = t ? viaOf_(t) : { hub: '', onward: '' };
  const guests = Array.isArray(p.guests) ? p.guests : [];
  return guests.map(function (g) {
    const going = !!t && g.status !== 'regret';
    return [
      text_(p.id), text_(p.label), text_(info.list), info.couple === true,
      text_(g.name), text_(GENDERS.indexOf(g.gender) >= 0 ? g.gender : ''), text_(g.status),
      going ? text_(t.mode) : '', going ? text_(t.from) : '',
      going ? text_(via.hub) : '', going ? text_(via.onward) : '',
      going ? text_(a.date) : '', going ? text_(a.slot) : '',
      going ? text_(d.date) : '', going ? text_(d.slot) : '',
      text_(p.note), text_(p.filled_by), when, p.unlisted === true,
      g.added === true, g.partner === true,
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
  const byId = {};
  lookupList_(readAllGuests_(ss)).forEach(function (g) { byId[g.id] = g; });

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
    const g = byId[id];
    const info = p.unlisted === true ? { list: 'Unlisted', couple: false } : { list: g ? g.list : '', couple: g ? g.couple : false };
    p.id = id;
    rows = rows.concat(peopleRows_(p, info, row[0]));
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

/**
 * Upgrades a v3 People tab in place: inserts the hub and onward columns right after 'from' and writes
 * their headers. Every existing row keeps all its values; their hub/onward cells stay blank (v3 never asked).
 * Returns true when it upgraded the tab, false when People isn't in the v3 layout (already current, or unknown).
 * Run it under the script lock, so no guest is saving at the same moment.
 */
function upgradePeople_(sh) {
  if (!headerMatches_(sh, PEOPLE_V3)) return false;
  const from = PEOPLE_V3.indexOf('from') + 1; // 1-based column of 'from' (I)
  const added = HEADERS.People.slice(from, HEADERS.People.indexOf('arrive_date')); // ['hub', 'onward']
  sh.insertColumnsAfter(from, added.length);
  sh.getRange(1, from + 1, 1, added.length).setValues([added]).setFontWeight('bold');
  return true;
}

/* =========================================================================
 * Validation: a self-contained copy of validatePayload() in js/logic.js.
 * Keep the two in step when changing rules.
 * ========================================================================= */

function validatePayload_(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    return { ok: false, errors: ['Something went wrong with your ticket. Please try again.'] };
  }
  const errors = [];
  if (p.action !== 'rsvp') errors.push('Unknown request.');
  const id = str_(p.id);
  if (!id || id.length > 40) errors.push('Your ticket id looks wrong. Please search for your name again.');
  if (typeof p.unlisted !== 'boolean') errors.push('Missing guest-list flag.');
  else if (p.unlisted && !UNLISTED_RE.test(id)) errors.push('Invalid ticket id. Please board again.');
  const label = str_(p.label);
  if (!label || label.length > 100) errors.push('Missing the name on your ticket.');

  const guests = Array.isArray(p.guests) ? p.guests : [];
  if (guests.length < 1 || guests.length > 10) {
    errors.push(guests.length ? 'That is too many guests for one ticket (max 10).' : 'Please add at least one guest.');
  }
  guests.slice(0, 11).forEach(function (g, i) {
    const name = str_(g && g.name);
    if (!name) errors.push('Guest ' + (i + 1) + ' needs a name.');
    else if (name.length > 60) errors.push('Guest ' + (i + 1) + "'s name is too long (max 60 characters).");
    const who = name || 'guest ' + (i + 1);
    if (STATUSES.indexOf(g && g.status) < 0) errors.push('Pick Confirmed, Waitlisted or Regret for ' + who + '.');
    if (g && g.gender !== undefined && GENDERS.indexOf(g.gender) < 0) errors.push('Pick M or F for ' + who + '.');
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
    if (!(side.date === 'unsure' || isValidISODate_(side.date))) errors.push('Pick a rough ' + word + ' date (or "Not sure yet").');
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
    const out = { name: str_(g.name), status: g.status, gender: GENDERS.indexOf(g.gender) >= 0 ? g.gender : '' };
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
    };
    // v4 pages always send via; a payload from an older page is stored exactly as before, without it.
    if (t.via !== undefined && t.via !== null) travel.via = viaOf_(t);
  }
  const client = p.client && typeof p.client === 'object' ? p.client : {};
  return {
    action: 'rsvp',
    id: str_(p.id).toLowerCase(),
    unlisted: p.unlisted,
    label: str_(p.label),
    guests: guests,
    travel: travel,
    note: str_(p.note),
    filled_by: str_(p.filled_by),
    client: { ts: str_(client.ts).slice(0, 40), ua: str_(client.ua).slice(0, 300) },
  };
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
 * Guest list: Saumy's workbook ("First List" / "Second List")
 * ========================================================================= */

/** 'Primary' / 'Secondary' for a list tab's name, '' for any other tab. */
function listOf_(name) {
  const key = tabKey_(name);
  if (!key || [SHEET.responses, SHEET.people, SHEET.summary].some(function (n) { return tabKey_(n) === key; })) return '';
  const hits = LIST_TABS.filter(function (t) { return t.re.test(key); });
  return hits.length === 1 ? hits[0].list : '';
}

/** [{list, sheet}] for each list tab found. A tab named exactly "First List" / "Second List" wins over look-alikes. */
function findListTabs_(ss) {
  const sheets = ss.getSheets();
  const out = [];
  LIST_TABS.forEach(function (t) {
    const mine = sheets.filter(function (sh) { return listOf_(sh.getName()) === t.list; });
    if (!mine.length) return;
    const exact = mine.filter(function (sh) { return tabKey_(sh.getName()) === tabKey_(t.name); })[0];
    out.push({ list: t.list, sheet: exact || mine[0] });
  });
  return out;
}

/**
 * Finds the list tabs and makes sure each has Nicknames and ID headers.
 * In a brand-new, empty spreadsheet it creates "First List" and "Second List".
 * @returns {{list:string, sheet:Sheet, col:Object}[]}
 */
function prepareListTabs_(ss) {
  let tabs = findListTabs_(ss);
  if (!tabs.length) {
    const others = ss.getSheets().filter(function (sh) {
      return !(sh.getLastRow() === 0 && sh.getLastColumn() === 0) && !isOwnTab_(sh.getName());
    });
    if (others.length) {
      throw new Error('Could not find your guest list tabs. Name them "First List" and "Second List". Tabs in this file: ' +
        ss.getSheets().map(function (sh) { return '"' + sh.getName() + '"'; }).join(', ') + '.');
    }
    const blank = ss.getSheets().filter(function (sh) { return !isOwnTab_(sh.getName()); });
    LIST_TABS.forEach(function (t, i) {
      const sh = blank[i] ? blank[i].setName(t.name) : ss.insertSheet(t.name, i);
      const head = LIST_COLS.map(function (c) { return c.header; });
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
    });
    tabs = findListTabs_(ss);
  }
  return tabs.map(function (t) {
    ensureListHeaders_(t.sheet);
    return { list: t.list, sheet: t.sheet, col: listColumns_(headerRow_(t.sheet)) };
  });
}

/** Adds the Nicknames and ID headers when missing: in F and G if those columns are empty, otherwise after the last column. */
function ensureListHeaders_(sh) {
  LIST_COLS.forEach(function (c) {
    if (!c.auto || listColumns_(headerRow_(sh))[c.key] >= 0) return;
    const at = freeColumn_(sh, c.pos + 1);
    if (sh.getMaxColumns() < at) sh.insertColumnsAfter(sh.getMaxColumns(), at - sh.getMaxColumns());
    sh.getRange(1, at).setValue(c.header).setFontWeight('bold');
  });
  const col = listColumns_(headerRow_(sh));
  if (col.id >= 0) {
    sh.getRange(1, col.id + 1).setNote("Filled in by the Save the Train script. Don't change a guest's ID after they have replied.");
  }
  if (col.nick >= 0) {
    sh.getRange(1, col.nick + 1).setNote('Optional. Extra names people might search for, separated by commas, e.g. "Annu, Annie".');
  }
}

/** The preferred 1-based column when its header and cells are all empty, else the first column after the data. */
function freeColumn_(sh, preferred) {
  if (preferred > sh.getMaxColumns()) return Math.max(preferred, sh.getLastColumn() + 1);
  const rows = Math.max(1, sh.getLastRow());
  const empty = sh.getRange(1, preferred, rows, 1).getValues().every(function (r) { return cell_(r[0]) === ''; });
  return empty ? preferred : sh.getLastColumn() + 1;
}

function headerRow_(sh) {
  return sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
}

/** Maps each LIST_COLS key to a 0-based column index (or -1), from a header row. */
function listColumns_(head) {
  const keys = (head || []).map(headerKey_);
  const known = {};
  LIST_COLS.forEach(function (c) { c.aliases.forEach(function (a) { known[a] = true; }); });
  const col = {};
  const taken = {};
  LIST_COLS.forEach(function (c) {
    col[c.key] = -1;
    for (let i = 0; i < c.aliases.length; i++) {
      const at = keys.indexOf(c.aliases[i]);
      if (at >= 0 && !taken[at]) {
        col[c.key] = at;
        taken[at] = true;
        break;
      }
    }
  });
  // A required header that's spelled differently: fall back to its usual column, if nothing else claims it.
  // A header that is a known alias may still be claimed when it repeats one already taken by another
  // column (both gender columns headed plain "Gender": the second one is Gender Guest 2).
  LIST_COLS.forEach(function (c) {
    if (c.auto || col[c.key] >= 0 || taken[c.pos]) return;
    const k = keys[c.pos];
    const repeat = k !== undefined && keys.indexOf(k) !== c.pos && taken[keys.indexOf(k)] === true;
    if (known[k] === true && !repeat) return;
    col[c.key] = c.pos;
    taken[c.pos] = true;
  });
  return col;
}

/** Every guest row of a list tab (row 1 = headers). Rows without a Guest 1 name are skipped. */
function parseListRows_(values, list) {
  const out = [];
  if (!values || values.length < 2) return out;
  const col = listColumns_(values[0]);
  for (let r = 1; r < values.length; r++) {
    const entry = parseGuestRow_(values[r], col, list);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * One row -> one lookup entry:
 * {id, label, names, genders, partner, max_guests, couple, list, aliases}.
 * names/genders hold the people whose names are known; partner is {title, gender} for an unnamed partner.
 */
function parseGuestRow_(row, col, list) {
  const at = function (key) { return col[key] >= 0 && row ? row[col[key]] : ''; };
  const guest1 = clean_(at('guest1'));
  if (!guest1) return null;
  const names = [guest1];
  const genders = [genderOf_(at('gender1'))];
  const guest2 = clean_(at('guest2'));
  const gender2 = genderOf_(at('gender2'));
  let partner = null;
  let label = guest1;
  const title = TITLE_RE.exec(guest2);
  if (title) {
    const t = TITLES[title[1].toLowerCase()];
    partner = { title: t, gender: gender2 || TITLE_GENDER[t] };
    label = unnamedPartnerLabel_(guest1, genders[0], partner.gender);
  } else if (guest2) {
    names.push(guest2);
    genders.push(gender2);
    label = guest1 + ' & ' + guest2;
  }
  const aliases = clean_(at('nick')).split(/[,;]/).map(clean_).filter(Boolean);
  return {
    id: normId_(at('id')),
    label: label,
    names: names,
    genders: genders,
    partner: partner,
    max_guests: MAX_GUESTS,
    couple: /^y(es)?$/i.test(clean_(at('both'))),
    list: list,
    aliases: aliases,
  };
}

/**
 * The ticket label for Guest 1 plus an invited partner whose name the list doesn't know (§A):
 * - "Mr & Mrs Kabir Khan" when Guest 1 is not marked F and the partner is not marked M (Guest 2 "Mrs");
 * - "Mrs Pooja Nair & Mr Nair" when Guest 1 is F and the partner is M (Guest 2 "Mr"), as Saumy asked;
 *   the surname is Guest 1's last word (a one-word name falls back to "Pooja & partner");
 * - "<Guest 1> & partner" for any other pairing.
 * The partner's own card still asks for "Your partner's name".
 */
function unnamedPartnerLabel_(guest1, gender1, partnerGender) {
  if (gender1 === 'F' && partnerGender === 'M') {
    const words = String(guest1).trim().split(/\s+/);
    return words.length > 1 ? 'Mrs ' + guest1 + ' & Mr ' + words[words.length - 1] : guest1 + ' & partner';
  }
  return gender1 !== 'F' && partnerGender !== 'M' ? 'Mr & Mrs ' + guest1 : guest1 + ' & partner';
}

/** Reads every list tab, uncached. Entries may have an empty id (run generateIds). */
function readAllGuests_(ss) {
  let out = [];
  findListTabs_(ss).forEach(function (t) {
    const sh = t.sheet;
    if (sh.getLastRow() < 2 || sh.getLastColumn() < 1) return;
    const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    out = out.concat(parseListRows_(values, t.list));
  });
  return out;
}

/** Entries that can be looked up: those with an id, first one wins when an id is repeated. */
function lookupList_(entries) {
  const seen = {};
  const out = [];
  entries.forEach(function (e) {
    if (!e.id || seen[e.id] === true) return;
    seen[e.id] = true;
    out.push(e);
  });
  return out;
}

/** The lookup list, from CacheService when fresh (60s), otherwise read from the Sheet and cached. */
function cachedGuests_() {
  const cache = scriptCache_();
  if (cache) {
    try {
      const meta = cache.get(CACHE_KEY);
      const n = meta ? parseInt(meta, 10) : 0;
      if (n > 0) {
        const keys = [];
        for (let i = 0; i < n; i++) keys.push(CACHE_KEY + '.' + i);
        const parts = cache.getAll(keys);
        if (keys.every(function (k) { return typeof parts[k] === 'string'; })) {
          return JSON.parse(keys.map(function (k) { return parts[k]; }).join(''));
        }
      }
    } catch (err) {
      // Fall through and read the Sheet.
    }
  }
  const guests = lookupList_(readAllGuests_(ss_()));
  if (cache) {
    try {
      const chunks = chunk_(JSON.stringify(guests), CACHE_CHUNK);
      const put = {};
      chunks.forEach(function (c, i) { put[CACHE_KEY + '.' + i] = c; });
      put[CACHE_KEY] = String(chunks.length);
      cache.putAll(put, CACHE_SECONDS);
    } catch (err) {
      // Too big or cache unavailable: search still works, just reads the Sheet each time.
    }
  }
  return guests;
}

function clearGuestCache_() {
  const cache = scriptCache_();
  if (!cache) return;
  try {
    cache.remove(CACHE_KEY);
  } catch (err) {
    // It expires within 60 seconds anyway.
  }
}

function scriptCache_() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    return null;
  }
}

/** Splits a string into pieces of at most `size` characters, never inside a surrogate pair. */
function chunk_(s, size) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(s.length, i + size);
    const code = s.charCodeAt(end - 1);
    if (end < s.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(s.slice(i, end));
    i = end;
  }
  return out.length ? out : [''];
}

function findGuestById_(id) {
  const key = normId_(id);
  if (!key || key.length > 40) return null;
  const guests = cachedGuests_();
  for (let i = 0; i < guests.length; i++) if (guests[i].id === key) return guests[i];
  return null;
}

/** What ?action=guest returns. Nicknames stay private. */
function publicGuest_(g, booked) {
  return {
    id: g.id,
    label: g.label,
    names: g.names,
    genders: g.genders,
    partner: g.partner,
    max_guests: g.max_guests,
    couple: g.couple,
    list: g.list,
    booked: booked || null,
  };
}

/** The latest saved answer for a ticket id, as {filled_by, updated_at, payload, has_note?}, or null. */
function findBooked_(id) {
  const sh = ss_().getSheetByName(SHEET.responses);
  return sh ? latestResponse_(sh, id, bookedFrom_) : null;
}

/**
 * Walks the Responses log from the newest row up and returns read(timestamp, payload_json) for the
 * first row of this ticket id that read() accepts (anything but null), or null.
 */
function latestResponse_(sh, id, read) {
  if (sh.getLastRow() < 2) return null;
  const ids = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (normId_(ids[i][0]) !== id) continue;
    const row = sh.getRange(i + 2, 1, 1, 5).getValues()[0];
    const out = read(row[0], row[4]);
    if (out !== null) return out;
  }
  return null;
}

/** A stored payload from a Responses payload_json cell, or null when it can't be read. */
function storedPayload_(json) {
  let payload;
  try {
    payload = JSON.parse(cell_(json));
  } catch (err) {
    return null;
  }
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
}

/**
 * {filled_by, updated_at, payload} from a Responses row's timestamp and payload_json. The browser
 * details are left out, and so is the note: ?action=guest answers anyone who searches a name, and a
 * friend's note to the couple is private. `has_note: true` tells the page that a note is saved
 * (it sends `keep_note` to keep it, see saveRsvp_).
 */
function bookedFrom_(ts, json) {
  const payload = storedPayload_(json);
  if (!payload) return null;
  const hasNote = str_(payload.note) !== '';
  delete payload.client;
  delete payload.note;
  const when = new Date(ts);
  const booked = {
    filled_by: str_(payload.filled_by),
    updated_at: isNaN(when.getTime()) ? '' : when.toISOString(),
    payload: payload,
  };
  if (hasNote) booked.has_note = true;
  return booked;
}

/** The note on a ticket's latest readable saved answer ('' when none). */
function previousNote_(sh, id) {
  const note = latestResponse_(sh, id, function (ts, json) {
    const p = storedPayload_(json);
    return p ? str_(p.note) : null;
  });
  return note || '';
}

function findMatches_(q) {
  const term = cell_(q).slice(0, 60);
  if (term.length < 3) return [];
  return searchGuests_(term, cachedGuests_(), MAX_MATCHES).map(function (m) { return { id: m.id, label: m.label }; });
}

/* =========================================================================
 * Forgiving name search: a copy of normalizeName / matchScore / searchGuests
 * in js/logic.js (amendments §B). Keep the two in step: the scores must match.
 * ========================================================================= */

/** Titles and joiners that never count as name words, on either side of a search. */
const STOP_WORDS = new Set(['mr', 'mrs', 'ms', 'dr', 'smt', 'shri', 'and', 'the']);
/** Unicode-aware patterns, built at run time so an older runtime falls back instead of failing to load. */
const NAME_RE = (function () {
  try {
    return { marks: new RegExp('\\p{M}+', 'gu'), other: new RegExp('[^\\p{L}\\s]+', 'gu') };
  } catch (err) {
    return {
      marks: /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯ऀ-ःऺ-ॏ॑-ॗॢॣ]+/g,
      other: /[^A-Za-zªµºÀ-ÖØ-öø-ɏͰ-ϿЀ-ӿऄ-हऽॐक़-ॡॱ-ॿ\s]+/g,
    };
  }
})();

function asList_(v) {
  return Array.isArray(v) ? v : [];
}

function splitWords_(s) {
  return s ? s.split(' ') : [];
}

/** Lower-case, diacritics stripped, anything that isn't a letter or space turned into a space, spaces collapsed. */
function normalizeName_(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFD').replace(NAME_RE.marks, '').toLowerCase()
    .replace(NAME_RE.other, ' ').replace(/\s+/g, ' ').trim();
}

/** Optimal-string-alignment (restricted Damerau-Levenshtein) distance on code points. */
function osaDistance_(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  const d = [];
  for (let i = 0; i <= s.length; i++) {
    d.push([i]);
    for (let j = 1; j <= t.length; j++) d[i].push(i === 0 ? j : 0);
  }
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

/** Deduplicated, stop-word-free words of label, names and aliases; each alias also counts as one word without spaces. */
function candidateWords_(entry) {
  const e = entry || {};
  const out = [];
  const add = function (w) { if (w && !STOP_WORDS.has(w) && out.indexOf(w) < 0) out.push(w); };
  [e.label].concat(asList_(e.names), asList_(e.aliases)).forEach(function (s) { splitWords_(normalizeName_(s)).forEach(add); });
  asList_(e.aliases).forEach(function (a) { add(normalizeName_(a).replace(/ /g, '')); });
  return out;
}

/** Best score of one query word: exact 3, prefix 2 (3+ chars), fuzzy 1 (OSA <= 1 for 4-7 chars, <= 2 for 8+), else 0. */
function wordScore_(qw, candidates) {
  const len = Array.from(qw).length;
  const maxEdits = len >= 8 ? 2 : len >= 4 ? 1 : 0;
  let best = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c === qw) return 3;
    if (len >= 3 && c.indexOf(qw) === 0) best = 2;
    else if (best < 1 && maxEdits > 0 && Math.abs(Array.from(c).length - len) <= maxEdits && osaDistance_(qw, c) <= maxEdits) best = 1;
  }
  return best;
}

/** How well a query matches one guest-list entry; 0 means no match. Same rules as matchScore() in js/logic.js. */
function matchScore_(query, entry) {
  const q = normalizeName_(query);
  if (q.replace(/ /g, '').length < 3) return 0;
  const queryWords = splitWords_(q).filter(function (w) { return w.length >= 2 && !STOP_WORDS.has(w); });
  if (queryWords.length === 0) return 0;
  const e = entry && typeof entry === 'object' ? entry : {};
  if (q.indexOf(' ') < 0 && asList_(e.names).some(function (n) { return normalizeName_(n).replace(/ /g, '') === q; })) return 6;
  const candidates = candidateWords_(e);
  const scores = queryWords.map(function (w) { return wordScore_(w, candidates); });
  const matched = scores.filter(function (s) { return s > 0; }).length;
  const sum = scores.reduce(function (a, b) { return a + b; }, 0);
  if (matched < 1 || sum < (queryWords.length === 1 ? 1 : 2)) return 0;
  return Math.round((sum + matched * 0.1) * 10) / 10;
}

/** Best matches first (then label A-Z), only scores above 0: [{id, label, score}]. */
function searchGuests_(query, entries, limit) {
  const max = limit === undefined ? 5 : limit;
  const labelOf = function (r) { return String(r.label === null || r.label === undefined ? '' : r.label); };
  return asList_(entries)
    .filter(function (e) { return e && typeof e === 'object'; })
    .map(function (e) { return { id: e.id, label: e.label, score: matchScore_(query, e) }; })
    .filter(function (r) { return r.score > 0; })
    .sort(function (a, b) { return b.score - a.score || labelOf(a).localeCompare(labelOf(b), 'en'); })
    .slice(0, Math.max(0, Number(max) || 0));
}

/* =========================================================================
 * Sheet building and formatting
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

function isOwnTab_(name) {
  return [SHEET.responses, SHEET.people, SHEET.summary].some(function (n) { return tabKey_(n) === tabKey_(name); });
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

/** Fills missing IDs in every list tab (unique across tabs). Returns {made, dupes}. */
function fillIds_(tabs) {
  const used = {};
  const dupes = [];
  const todo = [];
  tabs.forEach(function (t) {
    const sh = t.sheet;
    const last = sh.getLastRow();
    if (last < 2) return;
    const values = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
    const col = listColumns_(values[0]);
    if (col.id < 0 || col.guest1 < 0) return;
    const missing = [];
    for (let r = 1; r < values.length; r++) {
      const id = normId_(values[r][col.id]);
      if (id) {
        if (used[id] === true && dupes.indexOf(id) < 0) dupes.push(id);
        used[id] = true;
      } else if (clean_(values[r][col.guest1])) {
        missing.push(r + 1);
      }
    }
    if (missing.length) todo.push({ sheet: sh, col: col.id + 1, rows: missing });
  });

  let made = 0;
  todo.forEach(function (t) {
    runs_(t.rows).forEach(function (run) {
      const ids = [];
      for (let i = 0; i < run.count; i++) {
        let id = slug_();
        while (used[id] === true) id = slug_();
        used[id] = true;
        // The leading apostrophe keeps Sheets from reading the id as a number, date or TRUE/FALSE.
        ids.push(["'" + id]);
      }
      t.sheet.getRange(run.start, t.col, run.count, 1).setValues(ids);
      made += run.count;
    });
  });
  return { made: made, dupes: dupes };
}

/** Sorted row numbers -> [{start, count}] blocks of consecutive rows. */
function runs_(rows) {
  const out = [];
  rows.forEach(function (row) {
    const run = out.length ? out[out.length - 1] : null;
    if (run && run.start + run.count === row) run.count++;
    else out.push({ start: row, count: 1 });
  });
  return out;
}

function idMessage_(ids) {
  let msg = ids.made ? 'Added ' + ids.made + ' new guest ID' + (ids.made === 1 ? '' : 's') + '.' : 'Every guest already has an ID.';
  if (ids.dupes.length) msg += ' Warning: these IDs are used more than once, so make each one unique: ' + ids.dupes.join(', ') + '.';
  return msg;
}

function boldHeader_(sh) {
  sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function formatResponses_(sh) {
  boldHeader_(sh);
  sh.getRange('A2:A').setNumberFormat('d mmm yyyy, h:mm am/pm');
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(3, 200);
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
  id: 80, label: 220, list: 90, couple: 70, person: 170, gender: 65, status: 100, mode: 70, from: 120, hub: 60, onward: 70,
  arrive_date: 100, arrive_slot: 100, depart_date: 100, depart_slot: 100, note: 260, filled_by: 160, updated_at: 170,
  unlisted: 80, added: 70, partner: 70,
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

/**
 * Rebuilds the Summary tab: formulas only, so it is always safe to wipe.
 * People columns are referred to by their HEADERS.People name (v4: A id, B label, C list, D couple,
 * E person, F gender, G status, H mode, I from, J hub, K onward, L arrive_date, M arrive_slot,
 * N depart_date, O depart_slot, P note, Q filled_by, R updated_at, S unlisted, T added, U partner).
 * Lists that grow (pickup list, not replied, unlisted, added, notes) each get their own
 * columns with nothing underneath, so they can spill down freely.
 */
function buildSummary_(sh, tabs) {
  sh.clear();
  sh.clearConditionalFormatRules();
  // Left: tables and the pickup list (A–K). Right, from column M: the lists, side by side.
  const PICKUP_COLS = 11;
  const RIGHT = PICKUP_COLS + 2; // M, after a narrow spacer column
  const PENDING = [['Primary', RIGHT], ['Secondary', RIGHT + 2]];
  const UNLISTED = RIGHT + 4; // 6 columns
  const ADDED = UNLISTED + 7; // 4 columns
  const NOTES = ADDED + 5; // 2 columns
  const COLS = NOTES + 1;
  if (sh.getMaxColumns() < COLS) sh.insertColumnsAfter(sh.getMaxColumns(), COLS - sh.getMaxColumns());

  /** A whole People column (from row 2) by header name: P('status') -> People!$G$2:$G. */
  const P = function (name) {
    const L = peopleCol_(name);
    return 'People!$' + L + '$2:$' + L;
  };
  const STATUS = P('status');
  const ACTIVE = '((' + STATUS + '="confirmed")+(' + STATUS + '="waitlisted"))';
  const NOT_LOCAL = '(' + P('mode') + '<>"local")';
  const LISTS = ['Primary', 'Secondary', 'Unlisted'];
  const tabFor = {};
  tabs.forEach(function (t) { tabFor[t.list] = t; });
  const T = function (t, key) {
    const L = colLetter_(t.col[key] + 1);
    return quoteSheet_(t.sheet.getName()) + '!$' + L + '$2:$' + L;
  };
  const title = function (r, c, text) { sh.getRange(r, c).setValue(text).setFontWeight('bold').setFontSize(12).setFontColor('#10164A'); };
  const header = function (r, c, labels) {
    sh.getRange(r, c, 1, labels.length).setValues([labels]).setFontWeight('bold').setBackground('#FCE9D6');
  };
  const block = function (r, rows) { sh.getRange(r, 1, rows.length, rows[0].length).setValues(rows); };

  sh.getRange('A1').setValue('Save the Train: summary').setFontWeight('bold').setFontSize(15).setFontColor('#10164A');
  sh.getRange('A2').setValue("Updates by itself from the People tab and your list tabs. Don't type in this tab (run setup to rebuild it). More lists to the right →")
    .setFontColor('#555555');

  // People by status and list
  let r = 4;
  header(r, 1, ['People', 'Primary', 'Secondary', 'Unlisted', 'Total']);
  const perList = function (label, formula) {
    return [label].concat(LISTS.map(function (l) { return '=' + formula(l); }));
  };
  const statusCount = function (st) {
    return function (l) { return 'COUNTIFS(' + STATUS + ',"' + st + '",' + P('list') + ',"' + l + '")'; };
  };
  const sumUp = function (row) { return ['All who answered'].concat(['B', 'C', 'D'].map(function (L) { return '=SUM(' + L + (row - 3) + ':' + L + (row - 1) + ')'; })); };
  const peopleRows = [
    perList('Confirmed', statusCount('confirmed')),
    perList('Waitlisted', statusCount('waitlisted')),
    perList('Regret', statusCount('regret')),
    sumUp(r + 4),
    perList('Locals (Bhilwara is home), confirmed + waitlisted', function (l) {
      return 'COUNTIFS(' + P('mode') + ',"local",' + STATUS + ',"confirmed",' + P('list') + ',"' + l + '")+COUNTIFS(' +
        P('mode') + ',"local",' + STATUS + ',"waitlisted",' + P('list') + ',"' + l + '")';
    }),
    perList('Extra guests added (beyond the invite)', function (l) { return 'COUNTIFS(' + P('added') + ',TRUE,' + P('list') + ',"' + l + '")'; }),
  ].map(function (row, i) { return row.concat(['=SUM(B' + (r + 1 + i) + ':D' + (r + 1 + i) + ')']); });
  block(r + 1, peopleRows);
  r += peopleRows.length + 2;

  // Invites (one per row of a list tab) that have replied or not
  header(r, 1, ['Invites (one per list row)', 'Primary', 'Secondary', 'Unlisted', 'Total']);
  const listOnly = function (label, formula, unlisted) {
    return [label].concat(LISTS.map(function (l) {
      if (l === 'Unlisted') return unlisted;
      const t = tabFor[l];
      return t && t.col.id >= 0 && t.col.guest1 >= 0 ? '=' + formula(t) : 0;
    }));
  };
  const inviteRows = [
    listOnly('On the list', function (t) { return 'COUNTIFS(' + T(t, 'id') + ',"<>",' + T(t, 'guest1') + ',"<>")'; }, '—'),
    listOnly('Replied', function (t) {
      return 'ARRAYFORMULA(SUMPRODUCT((' + T(t, 'id') + '<>"")*(' + T(t, 'guest1') + '<>"")*ISNUMBER(MATCH(' + T(t, 'id') + ',' + P('id') + ',0))))';
    }, '=IFERROR(ROWS(UNIQUE(FILTER(' + P('id') + ',' + P('unlisted') + '=TRUE))),0)'),
    ['Not replied yet', '=B' + (r + 1) + '-B' + (r + 2), '=C' + (r + 1) + '-C' + (r + 2), '—'],
    listOnly('Rows still missing an ID (run "Fill in missing guest ids")', function (t) {
      return 'COUNTIFS(' + T(t, 'id') + ',"",' + T(t, 'guest1') + ',"<>")';
    }, '—'),
  ].map(function (row, i) { return row.concat(['=SUM(B' + (r + 1 + i) + ':D' + (r + 1 + i) + ')']); });
  block(r + 1, inviteRows);
  r += inviteRows.length + 1;
  sh.getRange(r, 1, 1, 2).setValues([['Submissions incl. edits', '=COUNTA(Responses!$B$2:$B)']]);
  r += 2;

  // Nights in Bhilwara (locals sleep at home, so they're left out)
  title(r, 1, 'Nights in Bhilwara (travelling guests)');
  r++;
  header(r, 1, ['Night of', 'Confirmed', 'Waitlisted', 'Total']);
  const arriveExpr = 'IF(' + P('arrive_date') + '="unsure","' + UNSURE_ARRIVE + '",' + P('arrive_date') + ')';
  const departExpr = 'IF(' + P('depart_date') + '="unsure","' + UNSURE_DEPART + '",' + P('depart_date') + ')';
  block(r + 1, NIGHTS.map(function (night, i) {
    const row = r + 1 + i;
    const here = '(' + arriveExpr + '<="' + night + '")*(' + departExpr + '>"' + night + '")*' + NOT_LOCAL;
    return [
      text_(dateLabel_(night)), // plain text, so Sheets doesn't turn "Wed 9 Dec" into a date
      '=ARRAYFORMULA(SUMPRODUCT((' + STATUS + '="confirmed")*' + here + '))',
      '=ARRAYFORMULA(SUMPRODUCT((' + STATUS + '="waitlisted")*' + here + '))',
      '=B' + row + '+C' + row,
    ];
  }));
  r += NIGHTS.length + 1;
  sh.getRange(r, 1).setValue('Someone counts for a night if they arrive on or before that date and leave after it. "Not sure yet" counts as arriving 9 Dec and leaving 12 Dec. Locals are not counted here or in the tables below.')
    .setFontColor('#555555').setFontStyle('italic');
  r += 2;

  // Arrivals and departures grids (confirmed + waitlisted travelling guests)
  const active = ACTIVE + '*' + NOT_LOCAL;
  r = dateSlotGrid_(sh, r, 'Arrivals (confirmed + waitlisted, not locals)', ARRIVE_DATES, 'arrive_date', 'arrive_slot', active, title, header, P);
  r = dateSlotGrid_(sh, r, 'Departures (confirmed + waitlisted, not locals)', DEPART_DATES, 'depart_date', 'depart_slot', active, title, header, P);

  // Arrivals by hub: where travelling guests land or get off, across all dates (v4 §O3, for pickups)
  title(r, 1, 'Arrivals by hub (confirmed + waitlisted, all dates, not locals)');
  r++;
  const hubRows = hubTableRows_(P, r + 1);
  header(r, 1, hubRows.header);
  block(r + 1, hubRows.rows);
  sh.getRange(r + hubRows.rows.length, 1, 1, hubRows.header.length).setFontWeight('bold');
  r += hubRows.rows.length + 1;
  sh.getRange(r, 1).setValue('Hub = the airport a guest lands at, or the station they get off at. "Then by car/cab" counts those going on to Bhilwara by road in a car or cab. Bus and car travellers, and answers from before this question existed, are under "None given".')
    .setFontColor('#555555').setFontStyle('italic');
  r += 2;

  // Pickup list, sorted by arrival date then time of day (spills down; nothing below it)
  title(r, 1, 'Pickup list (confirmed + waitlisted, by arrival; locals left out)');
  r++;
  header(r, 1, ['Arrive date', 'Arrive time', 'Guest', 'Status', 'Mode', 'From', 'Via', 'Then by', 'Leave date', 'Leave time', 'Ticket']);
  const slotRank = 'ARRAYFORMULA(IFERROR(MATCH(' + P('arrive_slot') + ',{"' + SLOTS.join('","') + '"},0),9))';
  sh.getRange(r + 1, 1).setFormula(
    '=IFERROR(QUERY({' + [P('arrive_date'), P('arrive_slot'), P('person'), P('status'), P('mode'), P('from'), P('hub'), P('onward'),
      P('depart_date'), P('depart_slot'), P('label'), slotRank].join(',') + '},' +
    '"select Col1,Col2,Col3,Col4,Col5,Col6,Col7,Col8,Col9,Col10,Col11 where (Col4=\'confirmed\' or Col4=\'waitlisted\') and Col5<>\'local\' order by Col1,Col12,Col11,Col3",0),' +
    '"No arrivals yet")'
  );

  // Right-hand lists, side by side from row 4. Each reads People through {…} column arrays (never
  // QUERY column letters), so inserting a People column can't point them at the wrong data.
  PENDING.forEach(function (pair) {
    const t = tabFor[pair[0]];
    title(3, pair[1], 'Not replied yet: ' + (t ? t.sheet.getName() : pair[0]));
    header(4, pair[1], ['Invite']);
    sh.getRange(5, pair[1]).setFormula(t && t.col.id >= 0 && t.col.guest1 >= 0 ? pendingFormula_(t, T) : '="No ' + pair[0] + ' list tab found"');
  });

  title(3, UNLISTED, 'Unlisted guests (boarded without being on the list)');
  header(4, UNLISTED, ['Ticket id', 'Ticket name', 'Guest', 'Status', 'From', 'Updated']);
  sh.getRange(5, UNLISTED).setFormula(
    '=IFERROR(QUERY({' + [P('id'), P('label'), P('person'), P('status'), P('from'), P('updated_at'), P('unlisted')].join(',') + '},' +
    '"select Col1,Col2,Col3,Col4,Col5,Col6 where Col7=true order by Col6 desc",0),"No unlisted guests yet")'
  );
  const updatedCol = colLetter_(UNLISTED + 5);
  sh.getRange(updatedCol + '5:' + updatedCol).setNumberFormat('d mmm, h:mm am/pm');

  title(3, ADDED, 'Extra guests added (beyond the invite)');
  header(4, ADDED, ['Ticket', 'Guest', 'Status', 'List']);
  sh.getRange(5, ADDED).setFormula(
    '=IFERROR(QUERY({' + [P('label'), P('person'), P('status'), P('list'), P('added')].join(',') + '},' +
    '"select Col1,Col2,Col3,Col4 where Col5=true order by Col4,Col1",0),"No extra guests yet")'
  );

  title(3, NOTES, 'Notes from guests');
  header(4, NOTES, ['Ticket', 'Note']);
  sh.getRange(5, NOTES).setFormula(
    '=IFERROR(UNIQUE(FILTER({' + P('label') + ',' + P('note') + '},' + P('note') + '<>"")),"No notes yet")'
  );

  sh.setColumnWidth(1, 250);
  for (let c = 2; c <= PICKUP_COLS; c++) sh.setColumnWidth(c, 105);
  [PICKUP_COLS + 1, RIGHT + 1, RIGHT + 3, UNLISTED + 6, ADDED + 4].forEach(function (c) { sh.setColumnWidth(c, 24); });
  PENDING.forEach(function (pair) { sh.setColumnWidth(pair[1], 230); });
  [[UNLISTED, [80, 200, 160, 90, 110, 120]], [ADDED, [200, 160, 90, 90]], [NOTES, [200, 320]]].forEach(function (list) {
    list[1].forEach(function (w, i) { sh.setColumnWidth(list[0] + i, w); });
  });
  sh.setFrozenRows(2);
}

/**
 * Labels of a list tab's invites whose ID has no row in People yet ("Mr & Mrs Kabir Khan",
 * "Meera Kapoor & Dev Malhotra", "Mrs Pooja Nair & Mr Nair", "Neha Gupta & partner"), built like parseGuestRow_ does:
 * EMPTY_CELL_RE, TITLE_RE and unnamedPartnerLabel_ in Sheet-formula form. Element-wise logic
 * uses + and * because OR/AND would collapse the whole column inside ARRAYFORMULA.
 */
function pendingFormula_(t, T) {
  const g1 = 'TRIM(' + T(t, 'guest1') + ')';
  let label = g1;
  if (t.col.guest2 >= 0) {
    const g2 = 'TRIM(' + T(t, 'guest2') + ')';
    const g2l = 'LOWER(' + g2 + ')';
    const sex = function (key) { return t.col[key] >= 0 ? 'LEFT(UPPER(TRIM(' + T(t, key) + ')),1)' : '""'; };
    const g1F = '(' + sex('gender1') + '="F")';
    // The partner's gender: Gender Guest 2 when it says M or F, otherwise from the title (Mr = M)
    const partnerM = '((' + sex('gender2') + '="M")+(' + sex('gender2') + '<>"F")*REGEXMATCH(' + g2l + ',"^mr ?\\.?$")>0)';
    const partnerLabel = 'IF((' + g1F + ')*(' + partnerM + '),IF(REGEXMATCH(' + g1 + '," "),"Mrs "&' + g1 + '&" & Mr "&REGEXEXTRACT(' + g1 +
      ',"(\\S+)$"),' + g1 + '&" & partner"),IF(' + g1F + '+' + partnerM + ',' + g1 + '&" & partner","Mr & Mrs "&' + g1 + '))';
    label = 'IFERROR(IF(REGEXMATCH(' + g2l + ',"^(n ?/? ?a\\.?|n\\.a\\.?|-+)?$"),' + g1 +
      ',IF(REGEXMATCH(' + g2l + ',"^(mr|mrs|ms|miss|smt) ?\\.?$"),' + partnerLabel + ',' + g1 + '&" & "&' + g2 + ')),' + g1 + ')';
  }
  return '=ARRAYFORMULA(IFERROR(FILTER(' + label + ',' + T(t, 'id') + '<>"",' + g1 + '<>"",ISNA(MATCH(' + T(t, 'id') +
    ',People!$A$2:$A,0))),"Everyone on this list has replied"))';
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

/** A date × time-of-day table of people counts. Returns the next free row. */
function dateSlotGrid_(sh, r, heading, dates, dateCol, slotCol, active, title, header, P) {
  title(r, 1, heading);
  r++;
  header(r, 1, ['Date'].concat(SLOTS.map(function (s) { return SLOT_LABELS[s]; })).concat(['Total']));
  const lastSlotCol = colLetter_(1 + SLOTS.length);
  const totalCol = 2 + SLOTS.length;
  const rows = dates.map(function (date, i) {
    const row = r + 1 + i;
    return [text_(dateLabel_(date))].concat(SLOTS.map(function (slot) {
      return '=ARRAYFORMULA(SUMPRODUCT((' + P(dateCol) + '="' + date + '")*(' + P(slotCol) + '="' + slot + '")*' + active + '))';
    })).concat(['=SUM(B' + row + ':' + lastSlotCol + row + ')']);
  });
  const totalRow = r + 1 + dates.length;
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

/** A list-tab cell: trimmed, inner spaces collapsed, and NA / N/A / - treated as empty. */
function clean_(v) {
  const s = cell_(v).replace(/\s+/g, ' ');
  return EMPTY_CELL_RE.test(s) ? '' : s;
}

/** 'M', 'F' or '' from a gender cell (M / F / Male / Female, any case). */
function genderOf_(v) {
  const s = clean_(v).toLowerCase();
  if (s === 'm' || s === 'male') return 'M';
  if (s === 'f' || s === 'female') return 'F';
  return '';
}

/** Header text reduced to letters and digits: "Both Primary?" -> "bothprimary". */
function headerKey_(h) {
  return cell_(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tabKey_(name) {
  return String(name === null || name === undefined ? '' : name).toLowerCase().replace(/\s+/g, '');
}

/** 'First List' -> "'First List'" for use in a formula. */
function quoteSheet_(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
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

/** 4-character id: a letter, then 3 letters or digits. */
function slug_() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = letters.charAt(Math.floor(Math.random() * letters.length));
  for (let i = 0; i < 3; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

function personalLink_(base, id) {
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'g=' + encodeURIComponent(id);
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

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function notify_(msg) {
  Logger.log(msg);
  try {
    ss_().toast(msg, 'Save the Train', 10);
  } catch (err) {
    // Toasts need an open Sheet; the Execution log already has the message.
  }
}

/**
 * Save the Train: Google Apps Script backend for Saumy & Manorika's RSVP site.
 *
 * Paste this whole file into the "Save the Train RSVPs" Google Sheet via
 * Extensions > Apps Script (replace everything in Code.gs). Full steps are in
 * docs/SETUP.md.
 *
 * Deploy as a Web app with "Execute as: Me" and "Who has access: Anyone".
 *   GET  ?action=find&q=<3+ letters>  -> {ok, matches:[{id,label}]}   (max 5)
 *   GET  ?action=guest&id=<id>        -> {ok, guest:{id,label,names,max_guests}}
 *   GET  ?action=ping (or no action)  -> {ok, service, time}
 *   POST text/plain JSON RSVP         -> {ok:true, id, updated_at} or {ok:false, error, code}
 *
 * Functions you run yourself (pick one in the toolbar, then click Run, or use
 * the "Save the Train" menu inside the Sheet):
 *   setup              creates or repairs the tabs and rebuilds Summary (safe to re-run)
 *   generateIds        gives every guest without an id a short unique id
 *   listPersonalLinks  shows a personal link per guest (uses SITE_URL below)
 */

/** The public address of the website (GitHub Pages for this repo). Change it if you host elsewhere. */
const SITE_URL = 'https://saumy-weds-manorika.github.io/';

const SHEET = { guests: 'Guests', responses: 'Responses', people: 'People', summary: 'Summary' };
const HEADERS = {
  Guests: ['id', 'label', 'names', 'max_guests', 'notes'],
  Responses: ['ts', 'id', 'label', 'unlisted', 'payload_json'],
  People: ['id', 'label', 'person', 'status', 'mode', 'from', 'arrive_date', 'arrive_slot',
    'depart_date', 'depart_slot', 'note', 'updated_at', 'unlisted'],
};
const STATUSES = ['confirmed', 'waitlisted', 'regret'];
const MODES = ['train', 'flight', 'bus', 'car'];
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
      return json_(guest ? { ok: true, guest: guest } : fail_('unknown_guest', 'unknown guest'));
    }
    if (action === 'ping') return json_({ ok: true, service: 'save-the-train', time: new Date().toISOString() });
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
    .addItem('Fill in missing guest ids', 'generateIds')
    .addItem('Show personal links', 'listPersonalLinks')
    .addToUi();
}

/* =========================================================================
 * Functions to run by hand
 * ========================================================================= */

/** Creates or repairs Guests, Responses, People and Summary. Never deletes guest or response data. */
function setup() {
  const ss = ss_();
  if (!ss.getSheetByName(SHEET.guests)) {
    // Reuse the empty "Sheet1" a new spreadsheet starts with.
    const sheets = ss.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0 && sheets[0].getLastColumn() === 0) {
      sheets[0].setName(SHEET.guests);
    }
  }
  const guests = ensureSheet_(ss, SHEET.guests, HEADERS.Guests);
  const responses = ensureSheet_(ss, SHEET.responses, HEADERS.Responses);
  const people = ensureSheet_(ss, SHEET.people, HEADERS.People);
  const summary = ensureSheet_(ss, SHEET.summary, null);

  formatGuests_(guests);
  formatResponses_(responses);
  formatPeople_(people);
  buildSummary_(summary);

  try {
    [summary, people, guests, responses].forEach(function (sh, i) {
      ss.setActiveSheet(sh);
      ss.moveActiveSheet(i + 1);
    });
    ss.setActiveSheet(guests);
  } catch (err) {
    // Tab order is cosmetic only.
  }
  SpreadsheetApp.flush();
  notify_('Setup done. Next: add your guests to the Guests tab, then run generateIds.');
}

/** Gives every guest row that has a label but no id a unique 4-character id. */
function generateIds() {
  const sh = ss_().getSheetByName(SHEET.guests);
  if (!sh) throw new Error('There is no "Guests" tab yet. Run setup first.');
  const last = sh.getLastRow();
  if (last < 2) {
    notify_('The Guests tab is empty. Add your guests first (one per row, starting on row 2).');
    return;
  }
  const width = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return cell_(h).toLowerCase(); });
  const idCol = head.indexOf('id');
  const labelCol = head.indexOf('label');
  if (idCol < 0 || labelCol < 0) {
    throw new Error('Row 1 of the Guests tab must have "id" and "label" headers. Run setup, or copy the header row from guests-template.csv.');
  }
  const values = sh.getRange(2, 1, last - 1, width).getValues();
  const used = {};
  const dupes = [];
  values.forEach(function (row) {
    const id = normId_(row[idCol]);
    if (!id) return;
    if (used[id] && dupes.indexOf(id) < 0) dupes.push(id);
    used[id] = true;
  });

  let made = 0;
  values.forEach(function (row, i) {
    if (normId_(row[idCol]) || !cell_(row[labelCol])) return;
    let id = slug_();
    while (used[id]) id = slug_();
    used[id] = true;
    // The leading apostrophe keeps Sheets from reading the id as a number, date or TRUE/FALSE.
    sh.getRange(i + 2, idCol + 1).setValue("'" + id);
    made++;
  });
  SpreadsheetApp.flush();

  let msg = made ? 'Added ' + made + ' new guest id' + (made === 1 ? '' : 's') + '.' : 'Every guest already has an id.';
  if (dupes.length) msg += ' Warning: these ids are used more than once, so make each one unique: ' + dupes.join(', ') + '.';
  notify_(msg);
}

/** Lists "label: personal link" for every guest. Shows a dialog in the Sheet and writes to the Execution log. */
function listPersonalLinks() {
  const guests = readGuests_();
  if (!guests.length) {
    notify_('No guests with ids yet. Add guests to the Guests tab, then run generateIds.');
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

/* =========================================================================
 * RSVP saving
 * ========================================================================= */

function saveRsvp_(p) {
  const ss = ss_();
  const responses = ensureSheet_(ss, SHEET.responses, HEADERS.Responses);
  const people = ensureSheet_(ss, SHEET.people, HEADERS.People);

  let label = p.label;
  if (!p.unlisted) {
    const guest = findGuestById_(p.id);
    if (!guest) return fail_('unknown_guest', 'unknown guest');
    if (p.guests.length > guest.max_guests) return fail_('too_many', 'too many guests for this invite');
    label = guest.label; // trust the Sheet, not the browser
  }
  if (responses.getLastRow() - 1 >= MAX_RESPONSES) return fail_('full', 'response limit reached');

  const now = new Date();
  const stored = Object.assign({}, p, { label: label });
  responses.appendRow([now, text_(p.id), text_(label), p.unlisted, text_(JSON.stringify(stored))]);
  replacePeopleRows_(people, p.id, peopleRows_(stored, now));
  SpreadsheetApp.flush();
  return { ok: true, id: p.id, updated_at: now.toISOString() };
}

/** One People row per guest. Regret rows leave the travel columns blank. */
function peopleRows_(p, now) {
  const t = p.travel;
  return p.guests.map(function (g) {
    const going = !!t && g.status !== 'regret';
    return [
      text_(p.id), text_(p.label), text_(g.name), text_(g.status),
      going ? text_(t.mode) : '', going ? text_(t.from) : '',
      going ? text_(t.arrive.date) : '', going ? text_(t.arrive.slot) : '',
      going ? text_(t.depart.date) : '', going ? text_(t.depart.slot) : '',
      text_(p.note), now, p.unlisted,
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
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
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
    if (STATUSES.indexOf(g && g.status) < 0) {
      errors.push('Pick Confirmed, Waitlisted or Regret for ' + (name || 'guest ' + (i + 1)) + '.');
    }
  });
  const allRegret = guests.length > 0 && guests.every(function (g) { return !!g && g.status === 'regret'; });
  if (p.travel && typeof p.travel === 'object') checkTravel_(p.travel, errors);
  else if (p.travel != null || !allRegret) errors.push('Tell us roughly how and when you are travelling.');

  if (p.note != null && typeof p.note !== 'string') errors.push('Your note could not be read.');
  else if (str_(p.note).length > 500) errors.push('Your note is too long (max 500 characters).');
  return { ok: errors.length === 0, errors: errors };
}

function checkTravel_(t, errors) {
  if (MODES.indexOf(t.mode) < 0) errors.push('Pick how you are travelling: train, flight, bus or car.');
  const from = str_(t.from);
  if (!from) errors.push('Tell us roughly where you are travelling from.');
  else if (from.length > 60) errors.push('That city name is too long (max 60 characters).');
  const a = t.arrive && typeof t.arrive === 'object' ? t.arrive : {};
  const d = t.depart && typeof t.depart === 'object' ? t.depart : {};
  [[a, 'arrival'], [d, 'departure']].forEach(function (pair) {
    const side = pair[0];
    const word = pair[1];
    if (!(side.date === 'unsure' || isValidISODate_(side.date))) errors.push('Pick a rough ' + word + ' date (or "Not sure yet").');
    if (slotHour_(side.slot) === null) errors.push('Pick a rough ' + word + ' time of day (or "Not sure yet").');
  });
  if (!isValidISODate_(a.date) || !isValidISODate_(d.date)) return;
  const ah = a.slot === 'unsure' ? null : slotHour_(a.slot);
  const dh = d.slot === 'unsure' ? null : slotHour_(d.slot);
  if (d.date < a.date) errors.push("Your departure date can't be before your arrival date.");
  else if (d.date === a.date && ah !== null && dh !== null && dh < ah) errors.push("Your departure time can't be before your arrival time.");
}

/** A trimmed copy holding only the fields we store. Call after validatePayload_ passes. */
function cleanPayload_(p) {
  const guests = p.guests.map(function (g) { return { name: str_(g.name), status: g.status }; });
  const allRegret = guests.every(function (g) { return g.status === 'regret'; });
  const t = p.travel;
  const travel = allRegret || !t ? null : {
    mode: t.mode,
    from: str_(t.from),
    arrive: { date: t.arrive.date, slot: t.arrive.slot },
    depart: { date: t.depart.date, slot: t.depart.slot },
  };
  const client = p.client && typeof p.client === 'object' ? p.client : {};
  return {
    action: 'rsvp',
    id: str_(p.id).toLowerCase(),
    unlisted: p.unlisted,
    label: str_(p.label),
    guests: guests,
    travel: travel,
    note: str_(p.note),
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
 * Guest list
 * ========================================================================= */

/** Reads the Guests tab by header name, so column order doesn't matter. */
function readGuests_() {
  const sh = ss_().getSheetByName(SHEET.guests);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = values[0].map(function (h) { return cell_(h).toLowerCase(); });
  const col = { id: head.indexOf('id'), label: head.indexOf('label'), names: head.indexOf('names'), max: head.indexOf('max_guests') };
  if (col.id < 0 || col.label < 0) return [];
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const id = normId_(row[col.id]);
    const label = cell_(row[col.label]);
    if (!id || !label) continue;
    const names = col.names >= 0
      ? cell_(row[col.names]).split('|').map(function (n) { return n.trim(); }).filter(Boolean)
      : [];
    const max = col.max >= 0 ? parseInt(row[col.max], 10) : NaN;
    out.push({ id: id, label: label, names: names, max_guests: isFinite(max) ? Math.min(10, Math.max(1, max)) : 1 });
  }
  return out;
}

function findGuestById_(id) {
  const key = normId_(id);
  if (!key || key.length > 40) return null;
  const guests = readGuests_();
  for (let i = 0; i < guests.length; i++) if (guests[i].id === key) return guests[i];
  return null;
}

function findMatches_(q) {
  const term = cell_(q).slice(0, 60);
  if (term.length < 3) return [];
  const guests = readGuests_();
  const out = [];
  for (let i = 0; i < guests.length && out.length < MAX_MATCHES; i++) {
    if (matchesQuery_(term, guests[i].label, guests[i].names)) out.push({ id: guests[i].id, label: guests[i].label });
  }
  return out;
}

/** Same rule as matchesQuery() in js/logic.js: every query word must start some word of the label or names. */
function matchesQuery_(q, label, names) {
  if (cell_(q).length < 3) return false;
  const qw = words_(q);
  let hay = words_(label);
  (names || []).forEach(function (n) { hay = hay.concat(words_(n)); });
  return qw.length > 0 && qw.every(function (w) { return hay.some(function (h) { return h.indexOf(w) === 0; }); });
}

function words_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[&.,]/g, ' ').split(/\s+/).filter(Boolean);
}

/* =========================================================================
 * Sheet building and formatting
 * ========================================================================= */

/** Returns the named tab, creating it and writing its header row if missing. Never overwrites a header row that has content. */
function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
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

function boldHeader_(sh) {
  sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function formatGuests_(sh) {
  boldHeader_(sh);
  [[1, 70], [2, 200], [3, 280], [4, 100], [5, 240]].forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
    .map(function (h) { return cell_(h).toLowerCase(); });
  const maxCol = head.indexOf('max_guests');
  if (maxCol < 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 10)
    .setAllowInvalid(false)
    .setHelpText('How many people this invite covers: 1 = just them, 2 = plus-one invited.')
    .build();
  const L = colLetter_(maxCol + 1);
  sh.getRange(L + '2:' + L).setDataValidation(rule);
}

function formatResponses_(sh) {
  boldHeader_(sh);
  sh.getRange('A2:A').setNumberFormat('d mmm yyyy, h:mm am/pm');
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(3, 180);
  sh.setColumnWidth(5, 420);
}

function formatPeople_(sh) {
  boldHeader_(sh);
  sh.getRange('L2:L').setNumberFormat('d mmm yyyy, h:mm am/pm');
  [[1, 80], [2, 170], [3, 170], [4, 100], [5, 70], [6, 120], [7, 100], [8, 100], [9, 100], [10, 100], [11, 260], [12, 170], [13, 80]]
    .forEach(function (w) { sh.setColumnWidth(w[0], w[1]); });
  const range = sh.getRange('D2:D');
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
 * Lists that grow (pickup list, not replied, unlisted, notes) each get their own
 * columns with nothing underneath, so they can spill down freely.
 */
function buildSummary_(sh) {
  sh.clear();
  sh.clearConditionalFormatRules();
  if (sh.getMaxColumns() < 21) sh.insertColumnsAfter(sh.getMaxColumns(), 21 - sh.getMaxColumns());

  const P = function (col) { return 'People!$' + col + '$2:$' + col; };
  const ACTIVE = '((' + P('D') + '="confirmed")+(' + P('D') + '="waitlisted"))';
  const title = function (r, c, text) { sh.getRange(r, c).setValue(text).setFontWeight('bold').setFontSize(12).setFontColor('#10164A'); };
  const header = function (r, c, labels) {
    sh.getRange(r, c, 1, labels.length).setValues([labels]).setFontWeight('bold').setBackground('#FCE9D6');
  };

  sh.getRange('A1').setValue('Save the Train: summary').setFontWeight('bold').setFontSize(15).setFontColor('#10164A');
  sh.getRange('A2').setValue("Updates by itself from the People tab. Don't type in this tab (run setup to rebuild it). More lists to the right →")
    .setFontColor('#555555');

  // Headcount
  let r = 4;
  header(r, 1, ['Headcount', 'Count']);
  const counts = [
    ['Confirmed (people)', '=COUNTIF(' + P('D') + ',"confirmed")'],
    ['Waitlisted (people)', '=COUNTIF(' + P('D') + ',"waitlisted")'],
    ['Regret (people)', '=COUNTIF(' + P('D') + ',"regret")'],
    ['All people answered', '=SUM(B' + (r + 1) + ':B' + (r + 3) + ')'],
    ['Tickets received', '=IFERROR(ROWS(UNIQUE(FILTER(' + P('A') + ',' + P('A') + '<>""))),0)'],
    ['Unlisted tickets', '=IFERROR(ROWS(UNIQUE(FILTER(' + P('A') + ',' + P('M') + '=TRUE))),0)'],
    ['Invites not answered yet', '=IFERROR(ROWS(FILTER(Guests!$A$2:$A,Guests!$A$2:$A<>"",ISNA(MATCH(Guests!$A$2:$A,' + P('A') + ',0)))),0)'],
    ['Submissions incl. edits', '=COUNTA(Responses!$B$2:$B)'],
  ];
  counts.forEach(function (row, i) {
    sh.getRange(r + 1 + i, 1).setValue(row[0]);
    sh.getRange(r + 1 + i, 2).setFormula(row[1]);
  });
  r += counts.length + 2;

  // Nights in Bhilwara
  title(r, 1, 'Nights in Bhilwara');
  r++;
  header(r, 1, ['Night of', 'Confirmed', 'Waitlisted', 'Total']);
  const arriveExpr = 'IF(' + P('G') + '="unsure","' + UNSURE_ARRIVE + '",' + P('G') + ')';
  const departExpr = 'IF(' + P('I') + '="unsure","' + UNSURE_DEPART + '",' + P('I') + ')';
  NIGHTS.forEach(function (night, i) {
    const row = r + 1 + i;
    const here = '(' + arriveExpr + '<="' + night + '")*(' + departExpr + '>"' + night + '")';
    sh.getRange(row, 1).setValue(dateLabel_(night));
    sh.getRange(row, 2).setFormula('=ARRAYFORMULA(SUMPRODUCT((' + P('D') + '="confirmed")*' + here + '))');
    sh.getRange(row, 3).setFormula('=ARRAYFORMULA(SUMPRODUCT((' + P('D') + '="waitlisted")*' + here + '))');
    sh.getRange(row, 4).setFormula('=B' + row + '+C' + row);
  });
  r += NIGHTS.length + 1;
  sh.getRange(r, 1).setValue('Someone counts for a night if they arrive on or before that date and leave after it. "Not sure yet" counts as arriving 9 Dec and leaving 12 Dec.')
    .setFontColor('#555555').setFontStyle('italic');
  r += 2;

  // Arrivals and departures grids (confirmed + waitlisted people)
  r = dateSlotGrid_(sh, r, 'Arrivals (confirmed + waitlisted people)', ARRIVE_DATES, 'G', 'H', ACTIVE, title, header, P);
  r = dateSlotGrid_(sh, r, 'Departures (confirmed + waitlisted people)', DEPART_DATES, 'I', 'J', ACTIVE, title, header, P);

  // Pickup list, sorted by arrival date then time of day (spills down; nothing below it)
  title(r, 1, 'Pickup list (confirmed + waitlisted, by arrival)');
  r++;
  header(r, 1, ['Arrive date', 'Arrive time', 'Guest', 'Status', 'Mode', 'From', 'Leave date', 'Leave time', 'Ticket']);
  const slotRank = 'ARRAYFORMULA(IFERROR(MATCH(' + P('H') + ',{"' + SLOTS.join('","') + '"},0),9))';
  sh.getRange(r + 1, 1).setFormula(
    '=IFERROR(QUERY({' + [P('G'), P('H'), P('C'), P('D'), P('E'), P('F'), P('I'), P('J'), P('B'), slotRank].join(',') + '},' +
    '"select Col1,Col2,Col3,Col4,Col5,Col6,Col7,Col8,Col9 where Col4=\'confirmed\' or Col4=\'waitlisted\' order by Col1,Col10,Col9,Col3",0),' +
    '"No arrivals yet")'
  );

  // Right-hand lists, side by side from row 4
  title(3, 11, 'Not replied yet');
  header(4, 11, ['Invite']);
  sh.getRange(5, 11).setFormula(
    '=IFERROR(FILTER(Guests!$B$2:$B,Guests!$A$2:$A<>"",ISNA(MATCH(Guests!$A$2:$A,' + P('A') + ',0))),"Everyone on the list has replied")'
  );

  title(3, 13, 'Unlisted guests (boarded without being on the list)');
  header(4, 13, ['Ticket id', 'Ticket name', 'Guest', 'Status', 'From', 'Updated']);
  sh.getRange(5, 13).setFormula(
    '=IFERROR(QUERY(People!$A$2:$M,"select A,B,C,D,F,L where M=true order by L desc",0),"No unlisted guests yet")'
  );
  sh.getRange('R5:R').setNumberFormat('d mmm, h:mm am/pm');

  title(3, 20, 'Notes from guests');
  header(4, 20, ['Ticket', 'Note']);
  sh.getRange(5, 20).setFormula(
    '=IFERROR(UNIQUE(FILTER({' + P('B') + ',' + P('K') + '},' + P('K') + '<>"")),"No notes yet")'
  );

  sh.setColumnWidth(1, 200);
  for (let c = 2; c <= 9; c++) sh.setColumnWidth(c, 105);
  sh.setColumnWidth(10, 30);
  sh.setColumnWidth(11, 200);
  sh.setColumnWidth(12, 30);
  sh.setColumnWidth(19, 30);
  sh.setColumnWidth(21, 320);
  sh.setFrozenRows(2);
}

/** A date × time-of-day table of people counts. Returns the next free row. */
function dateSlotGrid_(sh, r, heading, dates, dateCol, slotCol, active, title, header, P) {
  title(r, 1, heading);
  r++;
  header(r, 1, ['Date'].concat(SLOTS.map(function (s) { return SLOT_LABELS[s]; })).concat(['Total']));
  const lastSlotCol = colLetter_(1 + SLOTS.length);
  const totalCol = 2 + SLOTS.length;
  dates.forEach(function (date, i) {
    const row = r + 1 + i;
    sh.getRange(row, 1).setValue(dateLabel_(date));
    SLOTS.forEach(function (slot, j) {
      sh.getRange(row, 2 + j).setFormula(
        '=ARRAYFORMULA(SUMPRODUCT((' + P(dateCol) + '="' + date + '")*(' + P(slotCol) + '="' + slot + '")*' + active + '))'
      );
    });
    sh.getRange(row, totalCol).setFormula('=SUM(B' + row + ':' + lastSlotCol + row + ')');
  });
  const totalRow = r + 1 + dates.length;
  sh.getRange(totalRow, 1).setValue('Total').setFontWeight('bold');
  for (let c = 2; c <= totalCol; c++) {
    const L = colLetter_(c);
    sh.getRange(totalRow, c).setFormula('=SUM(' + L + (r + 1) + ':' + L + (totalRow - 1) + ')').setFontWeight('bold');
  }
  return totalRow + 2;
}

/* =========================================================================
 * Small helpers
 * ========================================================================= */

function ss_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this script from the Google Sheet (Extensions > Apps Script) so it is attached to the Sheet.');
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

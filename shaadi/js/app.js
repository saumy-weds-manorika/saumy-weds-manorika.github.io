/**
 * js/app.js: the Save the Train flow, Shaadi edition.
 *
 * One journey across seven stops (platform → passengers → route → arrival →
 * departure → junction, or → regret-end when everyone regrets). There is no guest
 * list here: the platform asks which side the guest is from (js/side-picker.js),
 * and the passenger chart has everyone type their own name and age
 * (docs/superpowers/specs/2026-10-14-shaadi-edition-design.md). This file only
 * flips the hooks documented in docs/ui-hooks.md and fills text. All visual
 * work lives in css/styles.css and css/side.css; all rules live in js/logic.js.
 *
 * Guest-entered text is only ever written with textContent / value.
 */
import { CONFIG } from './config.js';
import {
  formatDate, isValidISODate, slotHour, catches, workingDays, arrivalLine, customDate, pastedDay,
  overallStatus, validatePayload, buildPayload, leaveEmail, normalizeName, ridersFor, parseAge, relationOf,
  TICKET_ID_RE,
} from './logic.js';
import { submitRsvp, newTicketId, local, warmUp, isMock } from './api.js';
import { createRegretController } from './regret.js';
import { createSidePicker } from './side-picker.js';
import { createBaaja } from './audio.js';
import { createBand } from './band.js';
import { renderPass, passFilename, downloadPass, sharePass, passBlob } from './pass.js';
import { mountTrip, spokenDrive } from './trip.js';
import { ORIGIN, DESTINATIONS, TRIP_COPY } from './trip-data.js';
import { AIRPORTS, JUNCTIONS, BHILWARA_STATION, HIGHWAYS, BUS_FACTS } from './travel-data.js';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STATUS_IDS = CONFIG.statuses.map((s) => s.id);
const MODE_IDS = CONFIG.modes.map((m) => m.id);
const SLOT_IDS = CONFIG.slots.map((s) => s.id);
const GENDER_IDS = ['M', 'F'];
const FORM_STOPS = ['platform', 'passengers', 'route', 'arrival', 'departure'];
const STOP_ORDER = [...FORM_STOPS, 'junction', 'regret-end'];
const GO_COOLDOWN_MS = 400;      // taps this soon after a stop change are the tail of a double-tap
const NUDGE_KEY = 'stt.baaja.nudged';
const NAME_MAX = 60;
const NOTE_MAX = 500;
const AGE_CHARS = 3;
const MAX_GUESTS = CONFIG.maxGuests; // everyone on one ticket, the guest filling it in included (6)
const LOCAL = 'local';           // "Bhilwara is home" (amendments §L)
const HOME_STATION = BHILWARA_STATION.code; // getting off at Bhilwara itself: no onward leg (v4 §O3)
const nearestFirst = (list) => [...list].sort((a, b) => (Number(a.km) || 0) - (Number(b.km) || 0));
/**
 * Hub chips per mode (v4 §O3), nearest first: where a flight lands, or where a train guest gets off
 * (Bhilwara itself first). Bus, car and local guests aren't asked.
 */
const HUBS = {
  flight: nearestFirst(AIRPORTS),
  train: [{ ...BHILWARA_STATION, km: 0 }, ...nearestFirst(JUNCTIONS)],
};
/** "Then on to Bhilwara by", in each mode's order (a train guest is likelier to take a bus than another train). */
const ONWARD_ORDER = { flight: ['car', 'train', 'bus', 'unsure'], train: ['car', 'bus', 'train', 'unsure'] };
const ONWARD_LABEL = { car: 'Car/cab', train: 'Train', bus: 'Bus', unsure: 'Not sure yet' };
const RIDER_OUT_MS = 300;        // matches .rider.is-out in styles.css
const SIDES = ['arrive', 'depart'];
/** Each side's date chips (`unsure` included); "Other date" (v4 §Q) covers any other allowed December day. */
const CHIP_DATES = { arrive: CONFIG.arriveDates, depart: CONFIG.departDates };
const OTHER = 'other';           // data-value of the "Other date" chip; never stored (the typed date is)
const OTHER_LABEL = 'Other date';

/** Bobblehead art (amendments §E), shared with the friends edition one folder up. */
const BUSTS = { a: '../assets/bobble/saumy-bust.webp', b: '../assets/bobble/manorika-bust.webp' };
const RIDER_SRC = { M: '../assets/bobble/guest-m-bust.webp', F: '../assets/bobble/guest-f-bust.webp' };

/**
 * The wedding days, e.g. {first:'2026-12-10', last:'2026-12-11'}: the function dates, with a
 * small-hours function (the 3 AM Phera) counted as the night before. Locals' leave covers these.
 */
const WEDDING = (() => {
  const days = CONFIG.functions.map((f) => {
    const [date, time = ''] = String(f.at || f.date).split('T');
    const hour = Number(time.split(':')[0]);
    return time && hour < 6 ? addDays(date, -1) : date;
  }).filter(isValidISODate).sort();
  return { first: days[0], last: days[days.length - 1] };
})();

/** Per stop: track progress, heading to focus, and what the live region says (sayHome: for locals). */
const STOPS = {
  platform: { progress: 0, title: 't-platform', say: 'Platform. Which side are you from?' },
  passengers: { progress: 0.2, title: 't-passengers', say: 'Stop 1 of 4: Passenger chart', sayHome: 'Stop 1 of 2: Passenger chart' },
  route: { progress: 0.4, title: 't-route', say: 'Stop 2 of 4: Getting to Bhilwara', sayHome: 'Last stop: Getting to Bhilwara' },
  arrival: { progress: 0.6, title: 't-arrival', say: 'Stop 3 of 4: Arrival' },
  departure: { progress: 0.8, title: 't-departure', say: 'Stop 4 of 4: Departure' },
  junction: { progress: 1, title: 't-junction', say: 'Bhilwara Junction. Your ticket is saved.' },
  'regret-end': { progress: null, title: 't-regret', say: "We'll miss you! Your reply is saved." },
};

/** Playful lines for functions a guest's rough plan misses. */
const QUIPS = {
  carnival: "You'll miss the Carnival! Who's winning us the giant teddy?",
  sangeet: 'No Sangeet? Your dance slot goes unclaimed then.',
  maayra: "You'll miss the Maayra. Come for the vibe, stay for the food.",
  baraat: 'Missing the Baraat? Who will do the naagin dance on the road?',
  phera: "You'll miss the Phera! It's at 3 AM anyway…",
};

const DHOL_TAPS = ['dha', 'na', 'ge', 'na'];

/* ------------------------------------------------------------------ */
/* Tiny DOM helpers                                                    */
/* ------------------------------------------------------------------ */

const cache = {};
/** Cached getElementById. */
const el = (id) => cache[id] || (cache[id] = document.getElementById(id));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
/** Clone a <template>'s first element. */
const tpl = (id) => el(id).content.firstElementChild.cloneNode(true);
const slot = (root, name) => root.querySelector(`[data-slot="${name}"]`);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const statusLabel = (id) => (CONFIG.statuses.find((s) => s.id === id) || {}).label || '';
const slotLabel = (id) => (CONFIG.slots.find((s) => s.id === id) || {}).label || '';
const modeLabel = (id) => (CONFIG.modes.find((m) => m.id === id) || {}).label || '';
const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
/** 'YYYY-MM-DD' shifted by n days (UTC maths, so the result never depends on the phone's timezone). */
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Bottom edge of the sticky bar and its hanging toran (px from the top of the viewport). */
const topInset = () => ($('.toran') || el('journey-bar')).getBoundingClientRect().bottom;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const blankVia = () => ({ hub: '', onward: '' });
const blankTravel = () => ({ mode: '', from: '', arrive: { date: '', slot: '' }, depart: { date: '', slot: '' }, via: blankVia() });
/** A local guest's travel: home is Bhilwara, so there is nothing to plan (amendments §L). */
const localTravel = () => ({ mode: LOCAL, from: CONFIG.city, arrive: { date: 'unsure', slot: 'unsure' }, depart: { date: 'unsure', slot: 'unsure' }, via: blankVia() });
const isLocal = () => state.travel.mode === LOCAL;

let keySeq = 0;
/** A stable per-guest key for this visit (regret joke counters, render bookkeeping). Never saved. */
const newKey = () => `p${++keySeq}`;
const genderOf = (v) => (GENDER_IDS.includes(v) ? v : '');
const otherGender = (v) => (v === 'M' ? 'F' : v === 'F' ? 'M' : '');

/**
 * relation: the "Which side are you from?" tab id ('' until one is picked)
 * guest:  {id, label} | null   (this phone's ticket, made at "Board now"; label = passenger 1's name)
 * guests: [{name, age, status, gender, added, key}]
 *         age   = as typed (text), read with logic.parseAge
 *         added = passengers 2 to 6 (Add guest), so removable; passenger 1 fills the ticket in
 * filledBy: passenger 1's name
 */
const state = {
  relation: '',
  guest: null,
  guests: [],
  travel: blankTravel(),
  note: '',
  stop: 'platform',
  ticketId: '',     // remembered so boarding again (after Back) keeps the same ticket id
  filledBy: '',
};
let dirty = false;  // true once the guest changed something since the last save/restore
let busy = false;   // a submission is in flight
let lastGoAt = 0;   // performance.now() of the last stop change (double-tap guard)
let awayTravel = null; // the non-local plan, kept while "Bhilwara is home" is picked, so switching back restores it
/**
 * "Other date" is the picked date chip on this side (v4 §Q). The typed day lives in #<side>-day and the
 * side's date stays '' until it is a valid day. Set again from the date on every restore (syncForm).
 */
const otherPicked = { arrive: false, depart: false };
let arrowing = false;  // a radio chip is being selected with the arrow keys (focus stays on the chips)

/**
 * A reloaded chart (Back to the saved ticket, Edit my ticket) keeps each card's per-visit key when it
 * is the same person in the same seat, so the Regret joke neither restarts nor carries over (v4 §P).
 */
function carryKeys(next) {
  next.forEach((g, i) => {
    const p = state.guests[i];
    if (!p || !!p.added !== !!g.added) return;
    if (normalizeName(p.name) === normalizeName(g.name)) g.key = p.key;
  });
  return next;
}

/* Sanitisers for anything read back from localStorage (or a saved ticket from the server). */
function cleanIdentity(g) {
  const v = obj(g);
  if (typeof v.id !== 'string' || !TICKET_ID_RE.test(v.id)) return null;
  return { id: v.id, label: clip(String(v.label ?? ''), 100).trim() };
}
/** A relation id from storage: one of the tabs, or ''. */
const cleanRelation = (id) => (relationOf(id, CONFIG.relations) ? id : '');
function cleanGuests(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_GUESTS).map((g, i) => {
    const v = obj(g);
    return {
      name: clip(String(v.name ?? ''), NAME_MAX),
      // A saved payload holds the age as a number, a draft as typed
      age: v.age === null || v.age === undefined ? '' : clip(String(v.age), AGE_CHARS),
      status: STATUS_IDS.includes(v.status) ? v.status : '',
      gender: genderOf(v.gender),
      added: i > 0,
      key: newKey(),
    };
  });
}
/**
 * The day to show in the "Other date" field (v4 §Q) for a side's date, e.g. '7' for '2026-12-07' on
 * arrival: only for a December date that isn't one of that side's chips and that `customDate` accepts
 * for the side (arrive 1–11, leave 10–31). '' otherwise.
 */
function otherDay(side, iso) {
  if (!isValidISODate(iso) || CHIP_DATES[side].includes(iso)) return '';
  const day = String(Number(iso.slice(8)));
  return customDate(day, side).date === iso ? day : '';
}
/** A date this side can hold: one of its chips (or "Not sure yet"), or an allowed "Other date". */
const dateAllowed = (side, iso) => CHIP_DATES[side].includes(iso) || otherDay(side, iso) !== '';
/** A side from a draft or a saved answer: chip dates and valid custom December dates stay, anything else goes. */
function cleanSide(s, side) {
  const v = obj(s);
  return { date: dateAllowed(side, v.date) ? v.date : '', slot: SLOT_IDS.includes(v.slot) ? v.slot : '' };
}
function cleanTravel(t) {
  const v = obj(t);
  const mode = MODE_IDS.includes(v.mode) ? v.mode : '';
  return {
    mode,
    from: clip(String(v.from ?? ''), NAME_MAX),
    arrive: cleanSide(v.arrive, 'arrive'),
    depart: cleanSide(v.depart, 'depart'),
    via: cleanVia(mode, v.via),
  };
}
/** True when `hub` is one this mode offers (or "Not sure yet"). */
const isHubFor = (mode, hub) => !!HUBS[mode] && (hub === 'unsure' || HUBS[mode].some((h) => h.code === hub));
/**
 * Is "Then on to Bhilwara by" asked? Flights: once any landing answer is picked. Trains: only for a
 * junction (Bhilwara itself needs no onward leg, and "Not sure yet" has nothing to go on from).
 */
const asksOnward = (mode, hub) => (mode === 'flight' ? isHubFor(mode, hub) : isHubFor(mode, hub) && hub !== 'unsure' && hub !== HOME_STATION);
/** travel.via from a draft or a saved answer: only hubs this mode offers, and an onward leg only where it's asked. */
function cleanVia(mode, via) {
  const v = obj(via);
  const hub = isHubFor(mode, v.hub) ? v.hub : '';
  return { hub, onward: asksOnward(mode, hub) && ONWARD_ORDER[mode].includes(v.onward) ? v.onward : '' };
}

/** The picked relation tab ({id, label, side, bond}) or null. */
const relation = () => relationOf(state.relation, CONFIG.relations);
/** 'a' (Saumy's side) or 'b' (Manorika's), '' before a tab is picked. */
const sideOf = () => (relation() ? relation().side : '');
const everyoneRegrets = () => state.guests.length > 0 && state.guests.every((g) => g.status === 'regret');
/** Group status from the guests who have picked one ('confirmed' until anyone has). */
function party() {
  const chosen = state.guests.filter((g) => STATUS_IDS.includes(g.status));
  return chosen.length ? overallStatus(chosen) : 'confirmed';
}

/* ------------------------------------------------------------------ */
/* Drafts and the saved ticket                                         */
/* ------------------------------------------------------------------ */

/** Guests as stored on this phone (no per-visit keys). */
const storedGuests = () => state.guests.map(({ name, age, status, gender, added }) => ({
  name, age: parseAge(age) ?? clip(String(age ?? ''), AGE_CHARS), status, gender: genderOf(gender), added: !!added,
}));

function saveDraft() {
  if (!dirty || !state.guest || !FORM_STOPS.includes(state.stop)) return;
  local.saveDraft({
    v: 3,
    ts: Date.now(),
    relation: state.relation,
    guest: state.guest,
    guests: storedGuests(),
    travel: state.travel,
    // The plan set aside while "Bhilwara is home" is picked, so switching back after a reload restores it
    awayTravel: isLocal() && awayTravel ? cleanTravel({ ...awayTravel, mode: '' }) : null,
    // "Other date" fields as typed (v4 §Q), null where it isn't picked: a day still being typed, or a wrong
    // one, leaves the date '' and would otherwise be lost on a reload
    otherDays: Object.fromEntries(SIDES.map((s) => [s, otherPicked[s] ? clip(el(`${s}-day`).value, 2) : null])),
    note: state.note,
    stop: state.stop,
    ticketId: state.ticketId,
    filledBy: state.filledBy,
  });
}
function markDirty() {
  dirty = true;
  saveDraft();
}
function readDraft() {
  const d = local.loadDraft();
  if (!d) return null;
  const guest = cleanIdentity(d.guest);
  if (!guest) return null;
  const guests = cleanGuests(d.guests);
  const travel = cleanTravel(d.travel);
  const relationId = cleanRelation(d.relation);
  const stop = FORM_STOPS.includes(d.stop) && guests.length && relationId ? d.stop : 'platform';
  return {
    relation: relationId,
    guest,
    guests,
    travel,
    awayTravel: travel.mode === LOCAL && d.awayTravel ? cleanTravel(d.awayTravel) : null,
    otherDays: Object.fromEntries(SIDES.map((s) => {
      const text = obj(d.otherDays)[s];
      return [s, typeof text === 'string' && text.length <= 2 ? text : null];
    })),
    note: clip(String(d.note ?? ''), NOTE_MAX),
    // Locals never visit the arrival and departure stops
    stop: travel.mode === LOCAL && (stop === 'arrival' || stop === 'departure') ? 'route' : stop,
    ticketId: typeof d.ticketId === 'string' && TICKET_ID_RE.test(d.ticketId) ? d.ticketId : '',
    filledBy: clip(String(d.filledBy ?? ''), 100),
  };
}
function saveRecord(payload, updatedAt) {
  local.save({
    id: payload.id,
    label: payload.label,
    relation: payload.relation,
    guests: storedGuests(),
    payload,
    updated_at: updatedAt,
  });
}
/** Load a saved ticket (local.load()) into state. Returns false if it's unusable. */
function loadRecord(r) {
  const p = obj(r && r.payload);
  const pGuests = Array.isArray(p.guests) ? p.guests : [];
  const guest = cleanIdentity({ id: r && r.id, label: r && r.label });
  const guests = cleanGuests(Array.isArray(r && r.guests) && r.guests.length ? r.guests : pGuests);
  const relationId = cleanRelation((r && r.relation) || p.relation);
  if (!guest || !guests.length || !relationId) return false;
  state.relation = relationId;
  state.guest = guest;
  state.ticketId = guest.id;
  state.guests = carryKeys(guests);
  state.travel = cleanTravel(p.travel);
  state.note = clip(String(p.note ?? ''), NOTE_MAX);
  state.filledBy = clip(String(p.filled_by ?? ''), 100);
  awayTravel = null;
  dirty = false;
  syncForm();
  renderRiders();
  return true;
}

/* ------------------------------------------------------------------ */
/* Announcements, toast, journey bar                                   */
/* ------------------------------------------------------------------ */

let announceTimer = 0;
/** Polite live-region message (stop changes, regret dodges, small confirmations). */
function announce(text) {
  const a = el('announce');
  clearTimeout(announceTimer);
  a.textContent = '';
  announceTimer = setTimeout(() => { a.textContent = text; }, 60);
}

let toastTimer = 0;
function toast(text, ms = 2400) {
  const t = el('toast');
  t.textContent = text;
  t.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-shown'), ms);
}

let moveTimer = 0;
function setProgress(n) {
  const j = el('journey');
  const cur = parseFloat(j.style.getPropertyValue('--progress')) || 0;
  j.style.setProperty('--progress', String(n));
  if (cur === n) return;
  j.classList.add('is-moving');
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => j.classList.remove('is-moving'), 1150);
}

function updateParty() {
  document.body.dataset.party = party();
}

/*
 * Riders (amendments §D): up to two guest busts ride in the vehicle on the journey track. They
 * follow ridersFor(): the first two guests who haven't regretted. A new rider hops in with a
 * small bounce; one who regrets hops out. There are only two slots, so never more than two.
 */
let riding = ['', ''];
const riderTimers = [0, 0];

function renderRiders() {
  const next = ridersFor(state.guest ? state.guests : []);
  const still = prefersReducedMotion();
  $$('.rider').forEach((img, i) => {
    const want = next[i] || '';
    if (want === riding[i]) return;
    clearTimeout(riderTimers[i]);
    img.classList.remove('is-in', 'is-out');
    if (!want) {
      if (still) { img.hidden = true; return; }
      void img.offsetWidth; // restart the animation
      img.classList.add('is-out');
      riderTimers[i] = setTimeout(() => { img.hidden = true; img.classList.remove('is-out'); }, RIDER_OUT_MS);
      return;
    }
    img.src = RIDER_SRC[want];
    img.hidden = false;
    if (!still) {
      void img.offsetWidth;
      img.classList.add('is-in');
    }
  });
  riding = [next[0] || '', next[1] || ''];
}

/** Jump to the top. html has scroll-behavior:smooth, which would make a stop change glide from the bottom. */
function scrollTopNow() {
  const root = document.documentElement;
  const prev = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollTo(0, 0);
  root.style.scrollBehavior = prev;
}

/* ------------------------------------------------------------------ */
/* Browser history (so the phone's back gesture moves between stops)   */
/* ------------------------------------------------------------------ */

/*
 * Each stop the guest moves forward to gets its own history entry: {stt: stop, i: depth, prev}.
 * The back gesture then fires popstate and we show that stop instead of leaving the site.
 * After a submit the form entries are unwound (history.go(-i)) and the bottom entry becomes the
 * junction / regret ending, so Back from there leaves the site instead of re-entering the form.
 */
let unwindTo = '';
let unwindTimer = 0;

function navEntry() {
  try {
    const s = history.state;
    return s && typeof s.stt === 'string' && Number.isInteger(s.i) && s.i >= 0 ? s : null;
  } catch { return null; }
}

/** @param {'push'|'replace'|'base'|'none'} mode */
function writeHistory(mode, stop, prev) {
  if (mode === 'none') return;
  try {
    const cur = navEntry();
    const i = cur ? cur.i : 0;
    if (mode === 'push') {
      history.pushState({ stt: stop, i: i + 1, prev }, '');
    } else if (mode === 'replace') {
      history.replaceState({ stt: stop, i, prev: cur ? cur.prev : '' }, '');
    } else if (mode === 'base') {
      if (i > 0) {
        unwindTo = stop;
        clearTimeout(unwindTimer);
        // If the browser can't go back that far, no popstate arrives: settle on this entry.
        unwindTimer = setTimeout(() => {
          if (!unwindTo) return;
          try { history.replaceState({ stt: unwindTo, i: 0, prev: '' }, ''); } catch { /* ignore */ }
          unwindTo = '';
        }, 1000);
        history.go(-i);
      } else {
        history.replaceState({ stt: stop, i: 0, prev: '' }, '');
      }
    }
  } catch { /* history is unavailable in some sandboxed frames: the in-page buttons still work */ }
}

function onPopState(e) {
  if (unwindTo) {
    const stop = unwindTo;
    unwindTo = '';
    clearTimeout(unwindTimer);
    try { history.replaceState({ stt: stop, i: 0, prev: '' }, ''); } catch { /* ignore */ }
    return;
  }
  let target = e.state && typeof e.state.stt === 'string' && STOPS[e.state.stt] ? e.state.stt : 'platform';
  // Locals skip the travel stops, even if an older history entry points at one
  if (isLocal() && (target === 'arrival' || target === 'departure')) target = 'route';
  if (busy) {
    // Mid-submit: stay put and put our entry back.
    writeHistory('push', state.stop, target);
    return;
  }
  if (target === state.stop) return;
  const dir = STOP_ORDER.indexOf(target) < STOP_ORDER.indexOf(state.stop) ? 'back' : 'forward';
  if (target === 'platform') {
    go('platform', { dir, nav: 'none' });
    // Back from "View my pass": show the welcome panel again rather than the side picker.
    const r = local.load();
    if (r && !dirty && state.guest && state.guest.id === r.id) showWelcome(r);
    return;
  }
  if (target === 'junction' || target === 'regret-end') {
    // Back out of an edit: show the saved ticket, not the half-edited one.
    const r = local.load();
    if (!r || !loadRecord(r)) { go('platform', { dir, nav: 'none' }); return; }
    hideWelcome();
    go(everyoneRegrets() ? 'regret-end' : 'junction', { dir, nav: 'none' });
    return;
  }
  go(target, { dir, nav: 'none' });
}

/* ------------------------------------------------------------------ */
/* Stops                                                               */
/* ------------------------------------------------------------------ */

/**
 * Show a stop: slide direction, active section, body hooks, progress, scroll, focus, announce.
 * @param {string} stop
 * @param {{dir?:'forward'|'back', focus?:boolean, say?:boolean, nav?:'push'|'replace'|'base'|'none'}} [opts]
 *   nav: how the browser history follows (default: push when moving forward, replace when moving back)
 */
function go(stop, { dir = 'forward', focus = true, say = true, nav } = {}) {
  if (!STOPS[stop]) return;
  if (stop !== 'platform' && (!state.guest || !relation())) stop = 'platform';
  const leaving = state.stop;
  const body = document.body;
  lastGoAt = performance.now();
  writeHistory(nav || (dir === 'forward' && stop !== leaving ? 'push' : 'replace'), stop, leaving);
  if (stop !== 'platform') hideBaajaNudge(false);
  body.dataset.dir = dir;
  for (const s of $$('main > .stop')) s.classList.toggle('is-active', s.dataset.stop === stop);
  body.dataset.stop = stop;
  state.stop = stop;

  const meta = STOPS[stop];
  if (meta.progress !== null) setProgress(meta.progress);
  el('cta-error').hidden = true;

  if (stop === 'platform') renderPlatform();
  else if (stop === 'passengers') renderGuests();
  else if (stop === 'route') renderLocalExtras();
  else if (stop === 'departure') renderCatches();
  else if (stop === 'junction') enterJunction();
  else if (stop === 'regret-end') enterRegretEnd();
  updateParty();
  updateCta();
  renderRiders();

  scrollTopNow();
  if (focus) {
    const h = el(meta.title);
    if (h) h.focus({ preventScroll: true });
  }
  if (say) announce(stopSay(stop));
  saveDraft();
}

/** The live-region line for a stop; locals have only two stops (amendments §L). */
const stopSay = (stop) => (isLocal() && STOPS[stop].sayHome) || STOPS[stop].say;

function ctaText() {
  const confirm = party() === 'waitlisted' ? 'Save my spot' : 'Confirm my seat';
  switch (state.stop) {
    case 'platform': return 'Board now';
    case 'passengers': return everyoneRegrets() ? 'Send my regrets' : 'Next station →';
    case 'route': return isLocal() ? confirm : 'Next station →'; // locals finish here
    case 'departure': return confirm;
    default: return 'Next station →';
  }
}

function updateCta() {
  const s = state.stop;
  const welcome = s === 'platform' && !el('welcome').hidden;
  el('cta-bar').hidden = s === 'junction' || s === 'regret-end' || welcome;
  el('cta-back').hidden = s === 'platform';
  if (!busy) el('cta-label').textContent = ctaText();
}

const coolingDown = () => performance.now() - lastGoAt < GO_COOLDOWN_MS;

function next() {
  if (busy || coolingDown()) return;
  switch (state.stop) {
    case 'platform':
      boardNow();
      break;
    case 'passengers':
      if (!checkPassengers(true)) return;
      if (everyoneRegrets()) submit();
      else go('route');
      break;
    case 'route':
      if (!checkRoute(true)) return;
      if (isLocal()) submit(); // "Bhilwara is home": no arrival or departure stops
      else go('arrival');
      break;
    case 'arrival':
      if (checkArrival(true)) go('departure');
      break;
    case 'departure':
      if (checkDeparture(true)) submit();
      break;
    default:
  }
}

function back() {
  if (busy || coolingDown()) return;
  const i = FORM_STOPS.indexOf(state.stop);
  if (i <= 0) return;
  const prev = FORM_STOPS[i - 1];
  const entry = navEntry();
  // When the history entry below this one is the previous stop, let the browser step back
  // (popstate shows it), so the in-page Back and the phone's back gesture stay in step.
  if (entry && entry.i > 0 && entry.stt === state.stop && entry.prev === prev) {
    lastGoAt = performance.now();
    history.back();
    return;
  }
  go(prev, { dir: 'back' });
}

/* ------------------------------------------------------------------ */
/* Chips (radio groups)                                                */
/* ------------------------------------------------------------------ */

function checkChip(group, value) {
  for (const chip of $$('[role="radio"]', group)) chip.setAttribute('aria-checked', String(chip.dataset.value === value));
  rove(group);
}

/** Roving tabindex: one Tab stop per radio group, on the checked chip (or the first one). */
function rove(group) {
  const items = $$('[role="radio"]', group);
  const current = items.find((c) => c.getAttribute('aria-checked') === 'true') || items[0];
  for (const c of items) c.tabIndex = c === current ? 0 : -1;
}

/**
 * Arrow keys / Home / End move through a radio group and select, as screen readers announce
 * ("radio button 1 of 3"). Landing on Regret only moves focus: Space or Enter triggers the joke.
 */
function onRadioKey(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const chip = e.target instanceof Element ? e.target.closest('[role="radio"]') : null;
  const group = chip && chip.closest('[role="radiogroup"]');
  if (!group) return;
  const items = $$('[role="radio"]', group);
  const i = items.indexOf(chip);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  let target = null;
  if (e.key === 'Home') target = items[0];
  else if (e.key === 'End') target = items[items.length - 1];
  else if (step) target = items[(i + step + items.length) % items.length];
  else return;
  e.preventDefault();
  if (!target || target === chip) return;
  for (const c of items) c.tabIndex = c === target ? 0 : -1;
  target.focus();
  const isRegret = group.dataset.group === 'status' && target.dataset.value === 'regret';
  if (isRegret) return;
  arrowing = true; // e.g. "Other date" opens its day field but leaves focus on the chip
  try { target.click(); } finally { arrowing = false; }
}
/** Delegated click handler for a static chip group. */
function bindGroup(group, onPick) {
  group.addEventListener('click', (e) => {
    const chip = e.target instanceof Element ? e.target.closest('[role="radio"]') : null;
    if (!chip || !group.contains(chip)) return;
    onPick(chip.dataset.value, chip);
  });
}

/* ------------------------------------------------------------------ */
/* Stop 0 · Platform                                                   */
/* ------------------------------------------------------------------ */

let picker = null;

/** A relation tab was picked: remember it, light the tab, and let that side celebrate. */
function pickRelation(id) {
  const rel = relationOf(id, CONFIG.relations);
  if (!rel) return;
  const changed = state.relation !== id;
  state.relation = id;
  picker.select(id);
  rove(el('side-tabs'));
  hideSideError();
  picker.celebrate(rel.side);
  if (changed) {
    announce(`${rel.label}. ${CONFIG.sides[rel.side].name}'s side.`);
    if (state.guest) markDirty();
  }
}

function hideSideError() {
  el('side-error').hidden = true;
  el('side-pick').classList.remove('is-invalid');
}

/** "Board now" without a side: say so under the picker and move focus onto it. */
function showSideError() {
  el('side-error').hidden = false;
  el('side-pick').classList.add('is-invalid');
  el('side-pick').scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  const first = picker.tabs.find((t) => t.tabIndex === 0) || picker.tabs[0];
  if (first) first.focus({ preventScroll: true });
  announce(el('side-error').textContent);
}

/** A fresh passenger card: passenger 1 fills the ticket in; the rest come from "Add guest". */
const blankGuest = (added, gender = '') => ({ name: '', age: '', status: '', gender, added, key: newKey() });

function boardNow() {
  if (!relation()) {
    showSideError();
    return;
  }
  if (!state.guest) {
    const id = state.ticketId || newTicketId();
    state.ticketId = id;
    state.guest = { id, label: '' };
  }
  if (!state.guests.length) state.guests = [blankGuest(false)];
  markDirty();
  go('passengers');
}

/** Platform view: the side picker shows the chosen tab (if any). */
function renderPlatform() {
  if (!picker) return;
  picker.select(state.relation);
  rove(el('side-tabs'));
  if (state.relation) hideSideError();
}

function showWelcome(record) {
  el('welcome-name').textContent = record.label;
  el('welcome').hidden = false;
  el('side-pick').hidden = true;
  updateCta();
}
function hideWelcome() {
  el('welcome').hidden = true;
  el('side-pick').hidden = false;
}

/** "Someone else? Start a new ticket". */
function resetAll() {
  local.clear();
  local.clearDraft();
  state.relation = '';
  state.guest = null;
  state.guests = [];
  state.travel = blankTravel();
  state.note = '';
  state.ticketId = '';
  state.filledBy = '';
  awayTravel = null;
  dirty = false;
  hideWelcome();
  hideSideError();
  syncForm();
  updateCta();
  renderRiders();
  el('t-side').scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  const first = picker.tabs[0];
  if (first) first.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ */
/* Stop 1 · Passengers                                                 */
/* ------------------------------------------------------------------ */

let regret = null;
let cards = []; // per guest index: {card, chips:{confirmed,waitlisted,regret}, input, err, group, gender}

function statusGroupLabel(g, n) {
  const name = g.name.trim();
  return name ? `${name}'s status` : `Passenger ${n}'s status`;
}
function genderGroupLabel(g, n) {
  const name = g.name.trim();
  return name ? `${name}'s gender` : `Passenger ${n}'s gender`;
}

/** Passenger 1's name is the ticket's name (the welcome panel, the pass and the Sheet's label). */
function syncLabel() {
  const first = state.guests[0] ? state.guests[0].name.trim() : '';
  if (state.guest) state.guest.label = first;
  state.filledBy = first;
}

function setStamp(card, status) {
  if (STATUS_IDS.includes(status)) card.dataset.status = status;
  else card.removeAttribute('data-status');
}

function buildCard(g, i) {
  const n = i + 1;
  const card = tpl('tpl-guest');
  card.dataset.index = String(i);
  setStamp(card, g.status);
  slot(card, 'no').textContent = String(n);

  const err = slot(card, 'error');
  err.id = `guest-error-${n}`;
  const group = $('[data-group="status"]', card);
  group.setAttribute('aria-label', statusGroupLabel(g, n));
  group.setAttribute('aria-describedby', err.id);

  // M/F toggle (amendments §D): optional, for the riders and the Sheet
  const gender = slot(card, 'gender');
  gender.setAttribute('aria-label', genderGroupLabel(g, n));
  for (const opt of $$('[role="radio"]', gender)) {
    opt.setAttribute('aria-checked', String(opt.dataset.value === g.gender));
    opt.addEventListener('click', () => setGender(g, opt.dataset.value));
  }
  rove(gender);

  // Name: passenger 1 is the guest filling the ticket in
  card.classList.toggle('is-added', !!g.added);
  const input = slot(card, 'name-input');
  input.id = `guest-name-${n}`;
  slot(card, 'name-label').htmlFor = input.id;
  if (i === 0) {
    slot(card, 'name-label').textContent = 'Your name';
    input.autocomplete = 'name';
  } else {
    input.placeholder = 'Their name';
  }
  input.required = true;
  input.value = g.name;
  input.setAttribute('aria-describedby', err.id);
  input.addEventListener('input', () => {
    g.name = input.value.slice(0, NAME_MAX);
    group.setAttribute('aria-label', statusGroupLabel(g, n));
    gender.setAttribute('aria-label', genderGroupLabel(g, n));
    if (i === 0) syncLabel();
    if (card.classList.contains('is-invalid')) recheckCard(g);
    markDirty();
  });

  // Age (shaadi spec): whole years, required for everyone
  const age = slot(card, 'age-input');
  age.id = `guest-age-${n}`;
  slot(card, 'age-label').htmlFor = age.id;
  age.required = true;
  age.value = g.age;
  age.setAttribute('aria-describedby', err.id);
  age.addEventListener('input', () => {
    g.age = age.value.slice(0, AGE_CHARS);
    if (card.classList.contains('is-invalid')) recheckCard(g);
    markDirty();
  });
  age.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); age.blur(); }
  });

  if (g.added) {
    const remove = $('[data-action="remove"]', card);
    remove.hidden = false;
    remove.setAttribute('aria-label', `Remove passenger ${n}`);
    remove.addEventListener('click', () => removeGuest(g));
  }

  const chips = {};
  for (const chip of $$('[role="radio"]', group)) {
    const value = chip.dataset.value;
    chips[value] = chip;
    chip.setAttribute('aria-checked', String(g.status === value));
    chip.tabIndex = (g.status ? g.status === value : value === 'confirmed') ? 0 : -1;
    chip.addEventListener('click', () => {
      if (value !== 'regret') {
        setStatus(g, value);
        return;
      }
      if (g.status === 'regret') return; // already chosen: nothing to joke about
      // Each card runs its own joke, counted by the guest's stable key, so re-rendering the card
      // (Back/Next, Edit my ticket, Add guest) neither restarts nor shares it (v4 §P)
      regret.handle(chip, () => setStatus(g, 'regret'), g.key);
    });
  }
  cards[i] = { card, chips, input, age, err, group, gender };
  return card;
}

function renderGuests() {
  const list = el('guest-list');
  list.replaceChildren();
  cards = [];
  state.guests.forEach((g, i) => list.appendChild(buildCard(g, i)));
  renderAddGuest();
  el('passengers-error').hidden = true;
}

function setGender(g, value) {
  const i = state.guests.indexOf(g);
  if (i < 0 || !GENDER_IDS.includes(value)) return;
  g.gender = value;
  const ref = cards[i];
  if (ref) checkChip(ref.gender, value);
  renderRiders();
  markDirty();
}

function renderAddGuest() {
  el('add-guest').hidden = state.guests.length >= MAX_GUESTS;
}

function setStatus(g, value) {
  const i = state.guests.indexOf(g);
  if (i < 0 || !STATUS_IDS.includes(value)) return;
  g.status = value;
  const ref = cards[i];
  if (ref) {
    for (const [v, chip] of Object.entries(ref.chips)) {
      chip.setAttribute('aria-checked', String(v === value));
      chip.tabIndex = v === value ? 0 : -1;
    }
    setStamp(ref.card, value);
    if (ref.card.classList.contains('is-invalid')) recheckCard(g);
  }
  updateParty();
  updateCta();
  renderRiders();
  markDirty();
}

function addGuest() {
  if (!state.guest || state.guests.length >= MAX_GUESTS) return;
  // Passenger 2 is often the other half of a pair: guess the opposite of passenger 1. Nobody else.
  const gender = state.guests.length === 1 ? otherGender(state.guests[0].gender) : '';
  state.guests.push(blankGuest(true, gender));
  renderGuests();
  updateParty(); // the newcomer has no status yet, so "Send my regrets" no longer fits
  updateCta();
  renderRiders();
  markDirty();
  const ref = cards[cards.length - 1];
  if (ref && ref.input) ref.input.focus();
  announce(`Passenger ${state.guests.length} added. Type their name.`);
}

function removeGuest(g) {
  const i = state.guests.indexOf(g);
  if (i < 0) return;
  // Their Regret joke goes with them (v4 §P); a chip on the run goes home first. Never call
  // reset() without a key: that would restart every other card's joke too.
  if (g.key) regret.reset(g.key);
  state.guests.splice(i, 1);
  renderGuests();
  updateParty();
  updateCta();
  renderRiders();
  markDirty();
  (el('add-guest').hidden ? el('t-passengers') : el('add-guest')).focus();
  announce(`Passenger ${i + 1} removed.`);
}

/** Errors for one guest: {name, age, status}, each true when that answer is missing or wrong. */
function guestProblems(g) {
  return { name: !g.name.trim(), age: parseAge(g.age) === null, status: !STATUS_IDS.includes(g.status) };
}

function setCardError(i, msg, p) {
  const ref = cards[i];
  if (!ref) return;
  ref.card.classList.toggle('is-invalid', !!msg);
  ref.err.textContent = msg;
  ref.err.hidden = !msg;
  for (const [input, bad] of [[ref.input, p.name], [ref.age, p.age]]) {
    if (bad) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function cardMessage(g, p) {
  const age = String(g.age ?? '').trim();
  return [
    p.name ? 'Add a name for this passenger.' : '',
    p.age ? (age ? 'Type the age as a whole number of years, 0 to 120.' : 'Add their age in years (0 for a baby).') : '',
    p.status ? 'Pick Confirmed, Waitlisted or Regret.' : '',
  ].filter(Boolean).join(' ');
}

/** Live re-check of a card that is showing an error. */
function recheckCard(g) {
  const i = state.guests.indexOf(g);
  if (i < 0) return;
  const p = guestProblems(g);
  setCardError(i, cardMessage(g, p), p);
  if (!cards.some((c) => c && c.card.classList.contains('is-invalid'))) el('passengers-error').hidden = true;
}

/** '"a name", "an age" and "a status"' style list for the chart's summary error. */
const listOf = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

function checkPassengers(show) {
  let firstBad = -1;
  const missing = { name: false, age: false, status: false };
  state.guests.forEach((g, i) => {
    const p = guestProblems(g);
    for (const k of Object.keys(missing)) if (p[k]) missing[k] = true;
    if ((p.name || p.age || p.status) && firstBad < 0) firstBad = i;
    if (show) setCardError(i, cardMessage(g, p), p);
  });
  const ok = state.guests.length > 0 && firstBad < 0;
  if (show) {
    const pe = el('passengers-error');
    const parts = [missing.name && 'a name', missing.age && 'an age', missing.status && 'a status'].filter(Boolean);
    pe.textContent = `Add ${listOf(parts)} for every passenger.`;
    pe.hidden = ok;
    if (!ok && firstBad >= 0 && cards[firstBad]) {
      const ref = cards[firstBad];
      const p = guestProblems(state.guests[firstBad]);
      const target = p.name ? ref.input : p.age ? ref.age : $('[role="radio"]', ref.group);
      if (target) target.focus();
    }
  }
  return ok;
}

/* ------------------------------------------------------------------ */
/* Stops 2–4 · Route, arrival, departure                               */
/* ------------------------------------------------------------------ */

/** Is "Other date" the picked chip? (A local plan's 'unsure' dates never show it.) */
const isOther = (side) => otherPicked[side] && (state.travel[side].date === '' || isValidISODate(state.travel[side].date));

function syncSide(side) {
  const other = isOther(side);
  checkChip(el(`${side}-date-chips`), other ? OTHER : state.travel[side].date);
  checkChip(el(`${side}-slot-chips`), state.travel[side].slot);
  renderOther(side, other);
}

/**
 * "Other date" (v4 §Q): the day field shows while the chip is picked, and the chip itself prints the
 * typed date like its neighbours ("MON" over "7 Dec") once the day is valid, so the guest sees which
 * day they picked. A typed day that is one of the chips' own dates (arriving "9") leaves it reading
 * "Other date", so no second "Wed 9 Dec" chip shows. Its accessible name always starts "Other date".
 */
function renderOther(side, other) {
  el(`${side}-other`).hidden = !other;
  const chip = $(`[data-value="${OTHER}"]`, el(`${side}-date-chips`));
  const date = state.travel[side].date;
  const shown = other && isValidISODate(date) && !CHIP_DATES[side].includes(date) ? formatDate(date) : ''; // 'Mon 7 Dec'
  const [dow, ...dayMonth] = shown.split(' ');
  slot(chip, 'kicker').textContent = shown ? dow : '';
  slot(chip, 'kicker').hidden = !shown;
  slot(chip, 'label').textContent = shown ? dayMonth.join(' ') : OTHER_LABEL;
  if (shown) chip.setAttribute('aria-label', `${OTHER_LABEL}, ${shown}`);
  else chip.removeAttribute('aria-label');
  if (!other) showDayError(side, '');
}

/** Show (or with '' clear) the error under a day field; the field points at it only while it shows. */
function showDayError(side, message) {
  const err = el(`${side}-day-error`);
  const input = el(`${side}-day`);
  if (message && err.textContent !== message) err.textContent = message; // role=alert: say each new message once
  err.hidden = !message;
  input.setAttribute('aria-describedby', message ? `${side}-day-hint ${side}-day-error` : `${side}-day-hint`);
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

const DEPART_BEFORE_ARRIVAL = 'Your leaving date is before your arrival. Pick a later date.';
/** Leaving before arriving, for a departure whose dates are both known ('' otherwise). */
function departsBeforeArrival(departDate) {
  const a = state.travel.arrive.date;
  return isValidISODate(a) && isValidISODate(departDate) && departDate < a ? DEPART_BEFORE_ARRIVAL : '';
}

/** The problem with a picked "Other date" ('' when the day is fine or Other isn't picked). */
function dayProblem(side) {
  if (!isOther(side)) return '';
  const r = customDate(el(`${side}-day`).value, side);
  if (!r.ok) return r.error;
  return side === 'depart' ? departsBeforeArrival(r.date) : '';
}

/**
 * True while a one-character entry could still become a valid day (a departure "1" on its way to
 * "15"), so the live check waits for the next digit instead of flashing an error mid-typing.
 */
const dayCanGrow = (text, side) => [...text.trim()].length === 1 && [...'0123456789'].some((d) => customDate(text.trim() + d, side).ok);

/**
 * The error under a day field while the guest types: none for an empty field or for a first digit that
 * could still become a valid day, else whatever dayProblem says.
 */
function showTypingError(side) {
  const text = el(`${side}-day`).value;
  const r = customDate(text, side);
  const problem = dayProblem(side);
  showDayError(side, !problem || r.empty || (!r.ok && dayCanGrow(text, side)) ? '' : problem);
}

/** Typing in a day field: a valid day sets the date at once (catches and the draft follow), else ''. */
function onDayInput(side) {
  const r = customDate(el(`${side}-day`).value, side);
  state.travel[side].date = r.ok ? r.date : '';
  showTypingError(side);
  el(`${side}-error`).hidden = true;
  syncSide(side);
  afterArrivalChange(side);
  renderCatches();
  markDirty();
}

/**
 * Pasting into a day field: the 2-character limit would cut the text before customDate reads it
 * (" 7 " → " ", "2026-12-07" → "20"), so a paste that isn't just a one- or two-digit day is read whole by
 * pastedDay, and the day it finds replaces the field ("2026-12-07" or "7 Dec" → "7"). Text with no day in
 * it ("2026-11-30", "soon") empties the field, like any wrong entry the date becomes '', and the error says
 * why. Pasting only spaces changes nothing.
 */
function onDayPaste(e, side) {
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (/^[0-9०-९]{1,2}$/.test(text)) return; // a plain day goes in at the caret, as usual
  e.preventDefault();
  if (!text.trim()) return;
  const day = pastedDay(text);
  el(`${side}-day`).value = day ?? '';
  onDayInput(side);
  const r = customDate(text, side);
  if (day === null && !r.ok) showDayError(side, r.error);
}

/** An earlier arrival can settle a "leaving before arriving" error still showing under the leaving day. */
function afterArrivalChange(side) {
  if (side === 'arrive' && !el('depart-day-error').hidden && !dayProblem('depart')) showDayError('depart', '');
}

/**
 * Enter in a day field ("next" on a phone keyboard): a day with a problem says so and keeps focus; a good
 * one moves on to the time-of-day chips (the keyboard closes). It never moves to another stop or submits.
 */
function onDayKey(e, side) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const problem = dayProblem(side);
  if (problem) { showDayError(side, problem); return; }
  const chips = $$('[role="radio"]', el(`${side}-slot-chips`));
  (chips.find((c) => c.tabIndex === 0) || chips[0]).focus();
}

function setSide(side, key, value) {
  const s = state.travel[side];
  const toOther = key === 'date' && value === OTHER;
  if (toOther) {
    otherPicked[side] = true;
    const r = customDate(el(`${side}-day`).value, side);
    s.date = r.ok ? r.date : '';
  } else {
    if (key === 'date') {
      // Back to a chip: the typed day goes
      otherPicked[side] = false;
      el(`${side}-day`).value = '';
    }
    s[key] = value;
  }
  if (key === 'date' && value === 'unsure' && !s.slot) s.slot = 'unsure';
  syncSide(side);
  el(`${side}-error`).hidden = true;
  afterArrivalChange(side);
  renderCatches();
  markDirty();
  // A tap (or Enter/Space) on "Other date" goes straight to its field; arrowing through the chips stays on them
  if (toOther && !arrowing) el(`${side}-day`).focus();
}

/** A custom date coming back into state (the away plan after "Bhilwara is home"): "Other date" with its day. */
function adoptOtherDay(side) {
  const day = otherDay(side, state.travel[side].date);
  if (!day) return; // anything else keeps what's there, including a day still being typed
  otherPicked[side] = true;
  el(`${side}-day`).value = day;
}

/** After a restore or reset: "Other date" is picked where the date is a custom one, with its day filled in. */
function syncOtherDays() {
  for (const side of SIDES) {
    const day = otherDay(side, state.travel[side].date);
    otherPicked[side] = day !== '';
    el(`${side}-day`).value = day;
    showDayError(side, '');
  }
}

/**
 * A draft's "Other date" fields (null where it wasn't picked) come back as the guest left them, after
 * syncForm: also a day still being typed or a wrong one (its date is ''), or one of the chips' own days.
 * The date follows the field, as when typing. For a local plan the field waits for the away plan (setMode).
 */
function restoreOtherDays(days) {
  for (const side of SIDES) {
    const text = days[side];
    if (text === null) continue;
    otherPicked[side] = true;
    el(`${side}-day`).value = text;
    if (isLocal()) continue;
    const r = customDate(text, side);
    state.travel[side].date = r.ok ? r.date : '';
    syncSide(side);
    showTypingError(side);
  }
  renderCatches();
}

/**
 * Pick a travel mode. "Bhilwara is home" (amendments §L) fills in a local plan and skips the
 * arrival and departure stops; the away plan is kept aside so switching back restores it.
 * A different mode always starts its hub and onward answers afresh (v4 §O3).
 */
function setMode(value) {
  if (!MODE_IDS.includes(value)) return;
  const was = state.travel.mode;
  if (value === LOCAL && was !== LOCAL) {
    awayTravel = { from: state.travel.from, arrive: { ...state.travel.arrive }, depart: { ...state.travel.depart } };
    state.travel = localTravel();
  } else if (value !== LOCAL && was === LOCAL) {
    const back = awayTravel || blankTravel();
    state.travel = { mode: value, from: back.from, arrive: { ...back.arrive }, depart: { ...back.depart }, via: blankVia() };
    awayTravel = null;
    SIDES.forEach(adoptOtherDay); // a custom date set aside (even across a reload) comes back as "Other date"
  } else {
    state.travel.mode = value;
    if (value !== was) state.travel.via = blankVia();
  }
  el('mode-error').hidden = true;
  syncTravel();
  renderCatches();
  updateCta();
  markDirty();
  // The optional question that just opened below "Travelling from"
  if (value !== was && HUBS[value]) announce(`Optional, just below: ${hubQuestion(value)}`);
}

/** Route stop for locals: every function lit, and the note to the couple (amendments §L). */
function renderLocalExtras() {
  const home = isLocal();
  el('from-field').hidden = home;
  el('getting-there').hidden = home;
  el('local-extras').hidden = !home;
  if (home) renderCatches(el('local-catches'));
}

/*
 * Hub and onward (v4 §O3): flight and train guests get two optional questions after "Travelling from",
 * one at a time: where they land or get off, then (for an airport or a junction) how they go on to
 * Bhilwara. Neither ever blocks Next. The chips are rebuilt only when the mode changes, so focus and
 * the roving tab stop survive every other update.
 */
let viaMode = ''; // the mode whose chips are in #hub-chips / #onward-chips

const hubQuestion = (mode) => (mode === 'flight' ? 'Landing at (best guess)' : 'Getting off at');

/** A small span, e.g. a station code set in the body face (DotGothic's capital I reads as an l: "AII"). */
function span(cls, text) {
  const node = document.createElement('span');
  node.className = cls;
  node.textContent = text;
  return node;
}

/**
 * The better-known city a hub serves, when its own name hides it: 'Ajmer' for Kishangarh airport
 * (AIRPORTS city "Kishangarh (Ajmer)"), else ''. Friends booking a flight search for Ajmer.
 */
function servesCity(h) {
  const city = String(h.city || '').trim();
  if (!city || city === h.name) return '';
  const inner = /\(([^)]+)\)/.exec(city);
  return (inner ? inner[1] : city).trim();
}

/** One radio chip from #tpl-chip. `hint` is text or nodes; `note` is a small line under the label. */
function viaChip(value, label, { hint = '', spoken = '', extra = '', note = '' } = {}) {
  const chip = tpl('tpl-chip');
  chip.dataset.value = value;
  slot(chip, 'label').textContent = label;
  if (note) slot(chip, 'label').after(span('chip__for', note));
  const parts = [].concat(hint).filter(Boolean);
  if (parts.length) {
    slot(chip, 'hint').replaceChildren(...parts);
    slot(chip, 'hint').hidden = false;
  }
  if (spoken) chip.setAttribute('aria-label', spoken);
  if (extra) chip.className += ` ${extra}`;
  return chip;
}

function buildViaChips(mode) {
  const flight = mode === 'flight';
  el('hub-label-text').textContent = flight ? 'Landing at' : 'Getting off at';
  el('hub-label-note').textContent = flight ? '(best guess)' : '(optional)';
  const hubs = HUBS[mode].map((h) => {
    const code = span('hub-code', h.code);
    if (h.code === HOME_STATION) {
      return viaChip(h.code, h.name, { hint: [code, ' · in town'], spoken: `${h.name} station (${h.code}), in town`, extra: 'chip--hub chip--hub-home' });
    }
    const serves = servesCity(h);
    return viaChip(h.code, h.name, {
      hint: [code, ` · ${h.km} km`],
      note: serves ? `for ${serves}` : '',
      spoken: `${h.name}${flight ? ' airport' : ''}${serves ? `, for ${serves}` : ''} (${h.code}), ${h.km} km by road`,
      extra: 'chip--hub',
    });
  });
  hubs.push(viaChip('unsure', 'Not sure yet', { extra: 'chip--hub chip--unsure' }));
  el('hub-chips').replaceChildren(...hubs);
  el('onward-chips').replaceChildren(...ONWARD_ORDER[mode].map((id) => viaChip(id, ONWARD_LABEL[id], { extra: id === 'unsure' ? 'chip--unsure' : '' })));
  viaMode = mode;
}

/** Show the hub question for flight and train, and the onward one once it applies; tick the answers. */
function renderVia() {
  const t = state.travel;
  if (!t.via) t.via = blankVia();
  const asked = !!HUBS[t.mode];
  el('via').hidden = !asked;
  if (!asked) return;
  if (viaMode !== t.mode) buildViaChips(t.mode);
  checkChip(el('hub-chips'), t.via.hub);
  el('onward-group').hidden = !asksOnward(t.mode, t.via.hub);
  checkChip(el('onward-chips'), t.via.onward);
}

function setHub(value) {
  const t = state.travel;
  if (!isHubFor(t.mode, value)) return;
  const opened = !asksOnward(t.mode, t.via.hub) && asksOnward(t.mode, value);
  t.via.hub = value;
  if (!asksOnward(t.mode, value)) t.via.onward = ''; // Bhilwara (BHL) itself: nothing to go on by
  renderVia();
  markDirty();
  if (opened) announce('Optional, just below: Then on to Bhilwara by');
}

function setOnward(value) {
  const t = state.travel;
  if (!asksOnward(t.mode, t.via.hub) || !ONWARD_ORDER[t.mode].includes(value)) return;
  t.via.onward = value;
  checkChip(el('onward-chips'), value);
  markDirty();
}

/*
 * "Getting to Bhilwara" (v4 §O2): the reference panel on the route stop, filled once from
 * js/travel-data.js. Each row reads as one sentence to screen readers ("Udaipur (UDR): 145 km,
 * about 2 hours 30 minutes by road."); the visual columns are hidden from them.
 */
function gtRow(h) {
  const { code, name, km, drive } = h;
  const serves = servesCity(h);
  const li = document.createElement('li');
  li.className = 'gt-row';
  // name (code) · km · drive (v4 §O2); "for Ajmer" under Kishangarh
  const place = span('gt-row__place', '');
  place.append(span('gt-row__name', name), ' ', span('gt-row__code hub-code', `(${code})`));
  if (serves) place.append(span('gt-row__for', `for ${serves}`));
  const cells = [place, span('gt-row__km', keepTogether(`${km} km`)), span('gt-row__drive', keepTogether(String(drive)))];
  for (const cell of cells) {
    cell.setAttribute('aria-hidden', 'true');
    li.appendChild(cell);
  }
  li.appendChild(span('sr-only', `${name}${serves ? `, for ${serves}` : ''} (${code}): ${km} km, ${spokenDrive(drive)} by road.`));
  return li;
}

function renderGettingThere() {
  el('gt-airports').replaceChildren(...nearestFirst(AIRPORTS).map(gtRow));
  el('gt-junctions').replaceChildren(...nearestFirst(JUNCTIONS).map(gtRow));
  el('gt-rail-lede').textContent = `${BHILWARA_STATION.name} (${BHILWARA_STATION.code}) has its own station. Big junctions nearby:`;
  const road = [HIGHWAYS[0], BUS_FACTS[0]].filter((x) => typeof x === 'string' && x.trim());
  el('gt-road').replaceChildren(...road.map((line) => {
    const li = document.createElement('li');
    li.textContent = keepTogether(line.trim());
    return li;
  }));
}

function checkRoute(show) {
  const okMode = MODE_IDS.includes(state.travel.mode);
  const okFrom = isLocal() || state.travel.from.trim().length > 0;
  if (show) {
    el('mode-error').hidden = okMode;
    el('from-error').hidden = okFrom;
    if (okFrom) el('from-city').removeAttribute('aria-invalid');
    else el('from-city').setAttribute('aria-invalid', 'true');
    if (!okMode) {
      $('[role="radio"]', el('mode-chips')).focus();
      announce(el('mode-error').textContent);
    } else if (!okFrom) {
      el('from-city').focus();
      announce(el('from-error').textContent);
    }
  }
  return okMode && okFrom;
}

/** A date (a chip, "Not sure yet" or a valid "Other date") and a time of day are picked. */
const sideComplete = (side) => dateAllowed(side, state.travel[side].date) && SLOT_IDS.includes(state.travel[side].slot);

const PICK_DATE_AND_TIME = 'Pick a rough date and time. "Not sure yet" is fine.';
const PICK_TIME = 'Pick a rough time of day. "Not sure yet" is fine.';

/**
 * Next with "Other date" picked and its day empty, invalid or (leaving) before the arrival: the reason
 * goes under the field (role=alert says it) and the field takes focus. A missing time of day still
 * shows the stop's own error below, asking only for the time (the date's problem is already said).
 * Returns false when the day is fine.
 */
function flagDay(side) {
  const problem = dayProblem(side);
  if (!problem) return false;
  showDayError(side, problem);
  if (!SLOT_IDS.includes(state.travel[side].slot)) {
    const e = el(`${side}-error`);
    e.textContent = PICK_TIME;
    e.hidden = false;
  }
  el(`${side}-day`).focus();
  return true;
}

function checkArrival(show) {
  const ok = sideComplete('arrive');
  if (show && !ok && !flagDay('arrive')) {
    el('arrive-error').textContent = PICK_DATE_AND_TIME;
    el('arrive-error').hidden = false;
    const group = state.travel.arrive.date ? el('arrive-slot-chips') : el('arrive-date-chips');
    $('[role="radio"]', group).focus();
    announce(el('arrive-error').textContent);
  }
  return ok;
}

/** '' when the departure is fine, otherwise the guest-facing problem. */
function departProblem() {
  const { arrive: a, depart: d } = state.travel;
  if (!sideComplete('depart')) return PICK_DATE_AND_TIME;
  if (isValidISODate(a.date) && isValidISODate(d.date)) {
    if (d.date < a.date) return DEPART_BEFORE_ARRIVAL;
    const [ah, dh] = [slotHour(a.slot), slotHour(d.slot)];
    if (d.date === a.date && a.slot !== 'unsure' && d.slot !== 'unsure' && dh !== null && ah !== null && dh < ah) {
      return 'Your leaving time is before your arrival time. Pick a later one.';
    }
  }
  return '';
}

function checkDeparture(show) {
  const problem = departProblem();
  if (show && problem && !flagDay('depart')) {
    const e = el('depart-error');
    e.textContent = problem;
    e.hidden = false;
    const d = state.travel.depart;
    const group = d.date && d.slot ? el('depart-date-chips') : d.date ? el('depart-slot-chips') : el('depart-date-chips');
    $('[role="radio"]', group).focus();
    announce(problem);
  }
  return !problem;
}

/** Live "Your stops" board on the departure stop (or, for locals, on the route stop). */
function renderCatches(list = el('catches')) {
  list.replaceChildren();
  for (const c of catches(state.travel, CONFIG.functions)) {
    const fn = CONFIG.functions.find((f) => f.id === c.id) || {};
    const row = tpl('tpl-catch-row');
    row.dataset.caught = String(c.caught);
    slot(row, 'name').textContent = c.name;
    slot(row, 'when').textContent = `${formatDate(fn.date)} · ${fn.when}`;
    slot(row, 'quip').textContent = c.caught ? '' : (QUIPS[c.id] || "You'll miss this one!");
    slot(row, 'status').textContent = c.caught ? "You'll be there." : "You'll miss this one.";
    list.appendChild(row);
  }
}

function updateCount(textareaId, countId) {
  el(countId).textContent = `${el(textareaId).value.length} / ${NOTE_MAX}`;
}

/** The note to the couple lives on the departure stop, or on the route stop for locals: keep both in step. */
function syncNotes() {
  for (const [id, count] of [['note', 'note-count'], ['local-note', 'local-note-count']]) {
    if (el(id).value !== state.note) el(id).value = state.note;
    updateCount(id, count);
  }
}

/** Mode chips, city, dates and the local extras from state.travel. */
function syncTravel() {
  const t = state.travel;
  checkChip(el('mode-chips'), t.mode);
  document.body.dataset.mode = t.mode || 'train';
  el('from-city').value = isLocal() ? (awayTravel ? awayTravel.from : '') : t.from;
  syncSide('arrive');
  syncSide('depart');
  renderVia();
  renderLocalExtras();
}

/** Push state into every static control (after a restore or reset). */
function syncForm() {
  syncOtherDays();
  syncTravel();
  syncNotes();
  for (const id of ['mode-error', 'from-error', 'arrive-error', 'depart-error', 'passengers-error']) el(id).hidden = true;
  el('from-city').removeAttribute('aria-invalid');
  updateParty();
  renderPlatform();
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

const CHECKS = { passengers: checkPassengers, route: checkRoute, arrival: checkArrival, departure: checkDeparture };

function firstInvalidStop() {
  if (!state.guest || !relation()) return 'platform';
  if (!checkPassengers(false)) return 'passengers';
  if (everyoneRegrets()) return null;
  for (const s of isLocal() ? ['route'] : ['route', 'arrival', 'departure']) if (!CHECKS[s](false)) return s;
  return null;
}

const client = () => ({ ts: new Date().toISOString(), ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '' });

function setBusy(on, label = '') {
  busy = on;
  const btn = el('cta-next');
  if (on) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
  document.body.classList.toggle('is-busy', on);
  el('cta-back').disabled = on;
  el('cta-retry').disabled = on;
  if (on) {
    el('cta-error').hidden = true;
    el('cta-label').textContent = label;
  } else {
    updateCta();
  }
}

function showCtaError(msg) {
  el('cta-error-msg').textContent = msg;
  el('cta-error').hidden = false;
}

async function submit() {
  if (busy) return;
  const bad = firstInvalidStop();
  if (bad) {
    const order = [...FORM_STOPS];
    if (bad !== state.stop) go(bad, { dir: order.indexOf(bad) < order.indexOf(state.stop) ? 'back' : 'forward', say: false });
    if (CHECKS[bad]) CHECKS[bad](true);
    else if (bad === 'platform') showSideError();
    return;
  }
  for (const g of state.guests) {
    g.name = g.name.trim();
    const age = parseAge(g.age);
    if (age !== null) g.age = String(age);
  }
  syncLabel();
  const payload = buildPayload(state, client());
  const check = validatePayload(payload);
  if (!check.ok) {
    showCtaError(check.errors[0] || 'Some details need another look.');
    return;
  }
  const regretOnly = payload.travel === null;
  setBusy(true, regretOnly ? 'Sending your regrets…' : 'Printing your ticket…');
  let res;
  try {
    res = await submitRsvp(payload);
  } catch (err) {
    setBusy(false);
    handleSubmitError(err);
    return;
  }
  saveRecord(payload, res.updated_at);
  dirty = false;
  local.clearDraft();
  setBusy(false);
  // 'base': drop the form's history entries, so the back gesture from here leaves the site.
  go(regretOnly ? 'regret-end' : 'junction', { nav: 'base' });
}

function handleSubmitError(err) {
  const msg = (err && err.message) || "Couldn't reach the ticket counter. Check your connection and try again.";
  const code = err && err.code;
  if (code === 'too_many') {
    if (state.stop !== 'passengers') go('passengers', { dir: 'back', say: false });
    const pe = el('passengers-error');
    pe.textContent = msg;
    pe.hidden = false;
    return;
  }
  showCtaError(msg);
  el('cta-retry').focus();
}

/* ------------------------------------------------------------------ */
/* Stop 5 · Bhilwara Junction                                          */
/* ------------------------------------------------------------------ */

let passCanvas = null;
let passKey = '';
let passJob = null;
let passToken = 0;
let sceneTimer = 0;

function passData() {
  const travel = everyoneRegrets() ? null : state.travel;
  return {
    config: CONFIG,
    label: state.guest.label,
    passId: state.guest.id,
    quota: relation() ? relation().label : '',
    guests: state.guests.map((g) => ({ name: g.name.trim(), status: g.status })),
    travel,
    catches: travel ? catches(travel, CONFIG.functions) : [],
  };
}

function waitForImage(img) {
  if (!img) return Promise.resolve(null);
  if (img.complete) return Promise.resolve(img.naturalWidth ? img : null);
  return new Promise((resolve) => {
    const done = () => resolve(img.complete && img.naturalWidth ? img : null);
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    setTimeout(done, 3000);
  });
}

/* The couple's busts for the boarding pass (amendments §E), preloaded at boot so the pass prints
   without waiting. If one fails to load, pass.js prints a BHILWARA JN postmark instead. */
let bustImages = null;
function preloadBusts() {
  if (bustImages) return;
  bustImages = {};
  for (const [k, src] of Object.entries(BUSTS)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    bustImages[k] = img;
  }
}
async function loadHeads() {
  preloadBusts();
  const [a, b] = await Promise.all([waitForImage(bustImages.a), waitForImage(bustImages.b)]);
  return { a, b };
}

let passUrl = ''; // object URL of the preview image (revoked when the pass is re-rendered)

function passAlt(data) {
  const who = data.guests.map((g) => `${g.name}: ${statusLabel(g.status)}`).join(', ');
  return `Your Shaadi Express boarding pass for ${data.label}. ${who}.`;
}

/** Render (or reuse) the boarding pass and show it in #pass-img. Resolves to the canvas. */
function renderPassPreview() {
  const data = passData();
  const key = JSON.stringify({ ...data, config: undefined });
  if (key === passKey && passJob) return passJob;
  passKey = key;
  passCanvas = null;
  const token = ++passToken;
  const fig = el('pass');
  fig.hidden = false;
  fig.classList.add('is-loading');
  el('pass-error').hidden = true;
  const job = (async () => {
    const heads = await loadHeads();
    const canvas = await renderPass({ ...data, heads });
    if (token !== passToken) return canvas;
    passCanvas = canvas;
    // The same PNG encode that Download uses (pass.js caches it per canvas): no second encode,
    // and an object URL instead of a 2 MB base64 string in the DOM.
    const blob = await passBlob(canvas);
    if (token !== passToken) return canvas;
    const img = el('pass-img');
    const old = passUrl;
    passUrl = URL.createObjectURL(blob);
    img.alt = passAlt(data);
    img.src = passUrl;
    if (old) URL.revokeObjectURL(old);
    fig.classList.remove('is-loading');
    return canvas;
  })();
  passJob = job;
  job.catch(() => {
    if (token !== passToken) return;
    passKey = '';
    passJob = null;
    fig.classList.remove('is-loading');
    fig.hidden = true;
    el('pass-error').hidden = false;
  });
  return job;
}

/** The official dates, e.g. '10–11 Dec 2026' (amendments §J: the 12th is only ever the Phera's time). */
function weddingDates() {
  const [y1, m1, d1] = WEDDING.first.split('-').map(Number);
  const [, m2, d2] = WEDDING.last.split('-').map(Number);
  const mon = formatDate(WEDDING.last).split(' ')[2];
  return m1 === m2 ? `${d1}${d1 === d2 ? '' : `–${d2}`} ${mon} ${y1}` : `${formatDate(WEDDING.first)} – ${formatDate(WEDDING.last)} ${y1}`;
}

/** The guest's own vehicle for the share caption: the Shaadi Express is the theme, not the transport. */
const MODE_EMOJI = { train: '🚂', flight: '✈️', bus: '🚌', car: '🚗' };

/**
 * The caption shared with the pass. Travellers' captions end with the every-mode line (v4 §O1), so
 * friends who see it don't read the trip as train-only; it carries no booking line (amendments §K).
 */
function shareText() {
  const wl = party() === 'waitlisted';
  const line = wl
    ? `On the waitlist for the ${CONFIG.train.name} to ${CONFIG.city} for ${CONFIG.couple.joined}'s wedding. Will confirm soon!`
    : isLocal()
      ? `Home platform! I'll be at every function of ${CONFIG.couple.joined}'s wedding in ${CONFIG.city}. 🛺`
      : `Booked on the ${CONFIG.train.name} to ${CONFIG.city} for ${CONFIG.couple.joined}'s wedding! ${MODE_EMOJI[state.travel.mode] || '🚂'}`;
  const routes = isLocal() ? '' : `\nTrain, bus, car or flight, every route ends at ${CONFIG.city}.`;
  return `${line} ${weddingDates()}.${routes}${CONFIG.siteUrl ? `\n${CONFIG.siteUrl}` : ''}`;
}

/** " via Udaipur (UDR), then car/cab" / " to Bhilwara (BHL)" for the WhatsApp text, or '' (v4 §O3). */
function viaPhrase(t) {
  const via = obj(t.via);
  const hub = (HUBS[t.mode] || []).find((h) => h.code === via.hub);
  if (!hub) return '';
  if (hub.code === HOME_STATION) return ` to ${hub.name} (${hub.code})`;
  const on = via.onward && via.onward !== 'unsure' ? `, then ${ONWARD_LABEL[via.onward].toLowerCase()}` : '';
  return ` via ${hub.name} (${hub.code})${on}`;
}

/**
 * "Send on WhatsApp": a wa.me link with no number, so WhatsApp asks which chat to send it to (the
 * family member who sent the invite, say). Third person: no host is greeted by name.
 */
function waLink() {
  if (!state.guest) return 'https://wa.me/';
  const people = state.guests.map((g) => `${g.name.trim()} (${statusLabel(g.status)})`).join(', ');
  const rel = relation();
  const our = state.guests.length > 1 ? 'Our' : 'My';
  let text = `${our} ${CONFIG.train.name} ticket for ${CONFIG.couple.joined}'s wedding is saved`
    + `${rel ? ` (${rel.label})` : ''}. Passengers: ${people}.`;
  const t = state.travel;
  if (!everyoneRegrets() && t.mode === LOCAL) {
    text += ` ${CONFIG.city} is home, so we'll be at every function.`;
  } else if (!everyoneRegrets() && t.mode) {
    text += ` Rough plan: ${modeLabel(t.mode)} from ${t.from.trim()}${viaPhrase(t)}, arriving ${formatDate(t.arrive.date)} (${slotLabel(t.arrive.slot)}),`
      + ` leaving ${formatDate(t.depart.date)} (${slotLabel(t.depart.slot)}).`;
  }
  if (CONFIG.siteUrl) text += `\n${CONFIG.siteUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

async function onDownload() {
  const btn = el('pass-download');
  if (btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  try {
    const canvas = passCanvas || await renderPassPreview();
    await downloadPass(canvas, passFilename(state.guest.label));
    toast('Ticket downloaded');
  } catch {
    el('pass-error').hidden = false;
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

async function onShare() {
  try {
    // Share straight from the tap when the pass is ready, so the share sheet keeps the user activation.
    const canvas = passCanvas || await renderPassPreview();
    const filename = passFilename(state.guest.label);
    const result = await sharePass(canvas, { title: `${CONFIG.train.name} ticket · ${CONFIG.couple.joined}`, text: shareText(), filename });
    if (result === 'shared') {
      toast('Shared!');
    } else if (result === 'unsupported') {
      await downloadPass(canvas, filename);
      toast('Ticket downloaded. Share it from your photos, or use Send on WhatsApp.');
    }
  } catch {
    el('pass-error').hidden = false;
  }
}

/*
 * The junction's one travel line (amendments §K/§L, v4 §O1), from logic.arrivalLine: trains get the
 * single booking-date line, locals their home-platform line, and flight, bus and car one verified
 * line each from js/travel-data.js. Nothing else about trains appears anywhere.
 */
const NBSP = ' ';
const DAY_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g;
/** Keeps "Sat 10 Oct", "9 Dec", "8 AM" and "145 km" from breaking across lines on a narrow phone. */
const keepTogether = (s) => s
  .replace(DAY_RE, `$1${NBSP}$2${NBSP}$3`)
  .replace(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, `$1${NBSP}$2`)
  .replace(/\b(\d+) (AM|PM|km)\b/g, `$1${NBSP}$2`);

function renderTravelLine() {
  const line = everyoneRegrets() ? '' : arrivalLine(state.travel, { airports: AIRPORTS, highways: HIGHWAYS, busFacts: BUS_FACTS, now: Date.now() });
  el('travel-line').textContent = keepTogether(line);
  el('travel-line').hidden = !line;
}

/* Make it a Rajasthan long weekend (amendments §M): the map is mounted once, on the first visit
   to the junction, and kept for later visits. */
let trip = null;
function mountTripOnce() {
  if (trip) return;
  try {
    trip = mountTrip(el('trip'), { origin: ORIGIN, destinations: DESTINATIONS });
  } catch {
    el('trip-block').hidden = true; // the rest of the junction still works
  }
}

/* Leave kit */

let leaveKind = 'formal';
let currentMail = { subject: '', body: '' };

/*
 * Leave dates. Locals need only the wedding days themselves off (amendments §L). For a guest whose
 * dates are "Not sure yet", the email never invents a date with the 12th in it (amendments §J): an
 * unsure arrival is the usual travel day before the wedding, and an unsure departure is the last
 * wedding day (the Saturday after it is not a working day, so the count is the same either way).
 */
const USUAL_ARRIVAL = addDays(WEDDING.first, -1);

function renderLeave() {
  const t = state.travel;
  const arrive = isLocal() ? WEDDING.first : (isValidISODate(t.arrive.date) ? t.arrive.date : USUAL_ARRIVAL);
  const depart = isLocal() ? WEDDING.last : (isValidISODate(t.depart.date) ? t.depart.date : WEDDING.last);
  const days = workingDays(arrive, depart);
  const daysEl = el('leave-days');
  daysEl.textContent = String(days);
  const tail = daysEl.nextSibling;
  if (tail && tail.nodeType === Node.TEXT_NODE) tail.textContent = days === 1 ? ' working day off.' : ' working days off.';
  const first = state.guests[0] ? state.guests[0].name.trim() : state.guest.label;
  const rel = relation();
  const side = rel ? rel.side : 'a';
  currentMail = leaveEmail(leaveKind, {
    name: first, arrive, depart, days, couple: CONFIG.couple.joined, city: `${CONFIG.city}, ${CONFIG.state}`,
    bond: rel ? rel.bond : 'family', friend: CONFIG.sides[side].name, partner: CONFIG.sides[side === 'a' ? 'b' : 'a'].name,
  });
  el('leave-subject').textContent = currentMail.subject;
  el('leave-body').textContent = currentMail.body;
  el('leave-mail').href = `mailto:?subject=${encodeURIComponent(currentMail.subject)}&body=${encodeURIComponent(currentMail.body)}`;
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

async function copyLeave() {
  const text = `Subject: ${currentMail.subject}\n\n${currentMail.body}`;
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { ok = false; }
  if (!ok) {
    ok = legacyCopy(text);
    el('leave-copy').focus({ preventScroll: true });
  }
  toast(ok ? 'Copied' : "Couldn't copy. Press and hold the email text to copy it.");
}

function enterJunction() {
  const scene = el('arrival-scene');
  scene.classList.remove('is-arrived');
  clearTimeout(sceneTimer);
  // Let the vehicle pull in first, then the board, bobbleheads and petals.
  sceneTimer = setTimeout(() => {
    void scene.offsetWidth;
    scene.classList.add('is-arrived');
  }, prefersReducedMotion() ? 0 : 350);
  renderPassPreview();
  el('pass-wa').href = waLink();
  renderTravelLine();
  renderLeave();
  mountTripOnce();
}

/* ------------------------------------------------------------------ */
/* Stop 5r · Regret ending                                             */
/* ------------------------------------------------------------------ */

function enterRegretEnd() {
  el('regret-note').value = state.note;
  updateCount('regret-note', 'regret-note-count');
  const err = el('regret-note-error');
  if (err) err.hidden = true;
  el('regret-note-save').textContent = state.note.trim() ? 'Update note' : 'Send note';
}

async function saveRegretNote() {
  const btn = el('regret-note-save');
  if (btn.getAttribute('aria-busy') === 'true' || !state.guest) return;
  const err = el('regret-note-error');
  const text = el('regret-note').value.trim().slice(0, NOTE_MAX);
  const fail = (msg) => {
    if (err) {
      err.textContent = msg;
      err.hidden = false;
    } else {
      toast(msg);
    }
  };
  if (!text) {
    fail('Write a few words first.');
    el('regret-note').focus();
    return;
  }
  const before = state.note;
  state.note = text;
  const payload = buildPayload(state, client());
  const check = validatePayload(payload);
  if (!check.ok) {
    state.note = before;
    fail(check.errors[0] || 'Some details need another look.');
    return;
  }
  const label = btn.textContent;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Sending…';
  try {
    const res = await submitRsvp(payload);
    saveRecord(payload, res.updated_at);
    if (err) err.hidden = true;
    btn.textContent = 'Update note';
    toast('Note sent. Thank you!');
  } catch (e) {
    state.note = before;
    btn.textContent = label;
    fail((e && e.message) || "Couldn't reach the ticket counter. Try again.");
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

/** "Edit my ticket" from the junction, the regret ending or the welcome panel. */
function startEdit() {
  dirty = false;
  hideWelcome();
  syncForm();
  // Its own history entry, so the back gesture returns to the saved ticket.
  go('passengers', { dir: 'back', nav: 'push' });
}

/** The welcome panel's "View my pass" / "Edit my ticket": the ticket saved on this phone. */
function openSaved(kind) {
  if (busy) return;
  const r = local.load();
  if (!r || !loadRecord(r)) { resetAll(); return; }
  hideWelcome();
  if (kind === 'edit') {
    startEdit();
    return;
  }
  go(everyoneRegrets() ? 'regret-end' : 'junction', { nav: 'push' });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/* Baaja nudge: the band plays by default, so point once at the button that mutes it. */

let nudgeTimer = 0;
let nudgeHideTimer = 0;

function scheduleBaajaNudge() {
  let seen = false;
  try { seen = localStorage.getItem(NUDGE_KEY) === '1'; } catch { seen = false; }
  if (seen) return;
  nudgeTimer = setTimeout(() => {
    if (state.stop !== 'platform' || el('baaja-toggle').getAttribute('aria-pressed') !== 'true') return;
    el('baaja-nudge').hidden = false;
    try { localStorage.setItem(NUDGE_KEY, '1'); } catch { /* shown once per visit then */ }
    nudgeHideTimer = setTimeout(() => hideBaajaNudge(false), 6000);
  }, 2500);
}

function hideBaajaNudge(remember) {
  clearTimeout(nudgeTimer);
  clearTimeout(nudgeHideTimer);
  const n = el('baaja-nudge');
  if (n) n.hidden = true;
  if (remember) {
    try { localStorage.setItem(NUDGE_KEY, '1'); } catch { /* ignore */ }
  }
}

function bind() {
  // Journey bar: Baaja = Saumy's band recording. On by default (it starts with the guest's first
  // touch, since browsers block sound until then); the first tap on Baaja mutes it.
  const showBand = (on) => {
    el('baaja-toggle').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('is-baaja-on', on);
  };
  const band = createBand({ src: '../assets/band-audio.m4a', toggle: el('baaja-toggle'), onChange: showBand });
  el('baaja-toggle').addEventListener('click', () => {
    hideBaajaNudge(true);
    showBand(band.toggle());
  });
  // The tappable dhol and shehnai at the junction keep their synthesised sounds.
  const baaja = createBaaja();
  let dholTap = 0;
  el('tap-dhol').addEventListener('click', () => { baaja.dholHit(DHOL_TAPS[dholTap++ % DHOL_TAPS.length]); });
  el('tap-shehnai').addEventListener('click', () => { baaja.shehnaiPhrase(); });

  // Regret controller: one per page, with a separate dodge count per guest key (v4 §P)
  regret = createRegretController({
    // The first line names the person on the guest's own side
    messages: () => [CONFIG.regret.dodges[sideOf() || 'a'], ...CONFIG.regret.more],
    finalMessage: CONFIG.regret.final,
    announce,
    getInsets: () => {
      const bar = el('cta-bar');
      return {
        top: topInset(),
        bottom: bar.hidden ? 0 : Math.max(0, window.innerHeight - bar.getBoundingClientRect().top),
      };
    },
    reducedMotion: prefersReducedMotion,
  });

  // Keyboard: arrow keys inside every radio group (status, mode, dates, slots, email tone)
  document.addEventListener('keydown', onRadioKey);

  // Double-tap guard: the second tap of a double-tap lands on the next stop's content. Drop
  // real taps that arrive right after a stop change. (Synthetic clicks, e.g. arrow keys, pass.)
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || !coolingDown()) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('.main, .cta-bar')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // The phone's back gesture moves between stops
  window.addEventListener('popstate', onPopState);

  // CTA bar
  el('cta-next').addEventListener('click', next);
  el('cta-back').addEventListener('click', back);
  el('cta-retry').addEventListener('click', () => submit());

  // Platform
  picker = createSidePicker({ root: el('side-tabs'), onPick: pickRelation, reducedMotion: prefersReducedMotion });
  el('welcome-view-pass').addEventListener('click', () => { openSaved('pass'); });
  el('welcome-edit').addEventListener('click', () => { openSaved('edit'); });
  el('welcome-reset').addEventListener('click', resetAll);

  // Passengers
  el('add-guest').addEventListener('click', addGuest);

  // Route
  bindGroup(el('mode-chips'), setMode);
  bindGroup(el('hub-chips'), setHub);
  bindGroup(el('onward-chips'), setOnward);
  el('from-city').addEventListener('input', () => {
    state.travel.from = el('from-city').value.slice(0, NAME_MAX);
    el('from-error').hidden = true;
    el('from-city').removeAttribute('aria-invalid');
    markDirty();
  });
  const cities = el('city-list');
  cities.replaceChildren(...CONFIG.cities.map((c) => new Option(c)));

  // Arrival + departure
  bindGroup(el('arrive-date-chips'), (v) => setSide('arrive', 'date', v));
  bindGroup(el('arrive-slot-chips'), (v) => setSide('arrive', 'slot', v));
  bindGroup(el('depart-date-chips'), (v) => setSide('depart', 'date', v));
  bindGroup(el('depart-slot-chips'), (v) => setSide('depart', 'slot', v));
  // "Other date" day fields (v4 §Q)
  for (const side of SIDES) {
    const input = el(`${side}-day`);
    // No check on blur: an error appearing as focus leaves would shift the time chips under a tap
    input.addEventListener('input', () => onDayInput(side));
    input.addEventListener('paste', (e) => onDayPaste(e, side));
    input.addEventListener('keydown', (e) => onDayKey(e, side));
  }
  for (const id of ['note', 'local-note']) {
    el(id).addEventListener('input', () => {
      state.note = el(id).value.slice(0, NOTE_MAX);
      syncNotes();
      markDirty();
    });
  }

  // Junction
  el('pass-download').addEventListener('click', onDownload);
  el('pass-share').addEventListener('click', onShare);
  bindGroup(el('leave-kind-chips'), (v) => {
    leaveKind = v === 'honest' ? 'honest' : 'formal';
    checkChip(el('leave-kind-chips'), leaveKind);
    renderLeave();
  });
  el('leave-copy').addEventListener('click', copyLeave);
  el('junction-edit').addEventListener('click', startEdit);

  // Regret ending
  el('regret-note').addEventListener('input', () => {
    state.note = el('regret-note').value.slice(0, NOTE_MAX);
    updateCount('regret-note', 'regret-note-count');
    const err = el('regret-note-error');
    if (err) err.hidden = true;
  });
  el('regret-note-save').addEventListener('click', saveRegretNote);
  el('regret-edit').addEventListener('click', startEdit);
}

/** Decide where this visit starts: draft → saved ticket (welcome back) → fresh platform. */
function restore() {
  const draft = readDraft();
  const record = local.load();

  if (draft) {
    state.relation = draft.relation;
    state.guest = draft.guest;
    state.guests = draft.guests;
    state.travel = draft.travel;
    awayTravel = draft.awayTravel;
    state.note = draft.note;
    state.ticketId = draft.ticketId || draft.guest.id;
    state.filledBy = draft.filledBy;
    dirty = true;
    syncForm();
    restoreOtherDays(draft.otherDays);
    go(draft.stop, { focus: false, say: false, nav: 'replace' });
    return;
  }
  if (record && cleanIdentity(record)) showWelcome(record);
}

function boot() {
  if (document.body.classList.contains('preview-all')) return;
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  for (const id of ['guest-list', 'catches', 'local-catches', 'hub-chips', 'onward-chips']) el(id).replaceChildren();
  el('mock-ribbon').hidden = !isMock();
  renderGettingThere();
  // Long-weekend copy lives with the map data (js/trip-data.js)
  el('trip-title').textContent = TRIP_COPY.title;
  el('trip-intro').textContent = TRIP_COPY.intro;
  el('trip-teaser-text').textContent = TRIP_COPY.teaser;
  preloadBusts();
  bind();
  syncForm();
  for (const group of $$('[role="radiogroup"]')) rove(group);
  updateCta();
  renderRiders();
  warmUp(); // wake the ticket counter while the guest reads the cover
  try { restore(); } catch { /* never leave the platform stuck */ }
  scheduleBaajaNudge();
}

boot();

/**
 * js/app.js: the Save the Train flow.
 *
 * One journey across seven stops (platform → passengers → route → arrival →
 * departure → junction, or → regret-end when everyone regrets). This file only
 * flips the hooks documented in docs/ui-hooks.md and fills text. All visual
 * work lives in css/styles.css; all rules live in js/logic.js.
 *
 * Guest-entered text is only ever written with textContent / value.
 */
import { CONFIG } from './config.js';
import {
  formatDate, isValidISODate, slotHour, catches, workingDays, arrivalLine,
  overallStatus, validatePayload, buildPayload, leaveEmail, matchScore, normalizeName, ridersFor,
} from './logic.js';
import { findGuests, getGuest, submitRsvp, newUnlistedId, local } from './api.js';
import { createRegretController } from './regret.js';
import { createBaaja } from './audio.js';
import { renderPass, passFilename, downloadPass, sharePass, passBlob } from './pass.js';
import { mountTrip } from './trip.js';
import { ORIGIN, DESTINATIONS, TRIP_COPY } from './trip-data.js';
import { AIRPORTS, HIGHWAYS, BUS_FACTS } from './travel-data.js';

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
const MAX_GUESTS = 4;            // every ticket may bring guests up to 4 people (amendments §A)
const UNLISTED_MAX_GUESTS = MAX_GUESTS; // Saumy reviews unlisted tickets in the Sheet
const UNLISTED_RE = /^u-[a-z0-9]{8}$/;
const SEARCH_DEBOUNCE_MS = 250;
const IST_MS = 5.5 * 3600000;
const LOCAL = 'local';           // "Bhilwara is home" (amendments §L)
const RIDER_OUT_MS = 300;        // matches .rider.is-out in styles.css

/** Bobblehead art (amendments §E): the couple's busts for the pass, guest busts for the riders. */
const BUSTS = { a: 'assets/bobble/saumy-bust.webp', b: 'assets/bobble/manorika-bust.webp' };
const RIDER_SRC = { M: 'assets/bobble/guest-m-bust.webp', F: 'assets/bobble/guest-f-bust.webp' };

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
  platform: { progress: 0, title: 't-platform', say: "Platform. Who's boarding?" },
  passengers: { progress: 0.2, title: 't-passengers', say: 'Stop 1 of 4: Passenger chart', sayHome: 'Stop 1 of 2: Passenger chart' },
  route: { progress: 0.4, title: 't-route', say: 'Stop 2 of 4: How you are travelling', sayHome: 'Last stop: How you are travelling' },
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
/** 'Fri 9 Oct' for a saved timestamp, in Indian time; '' when it can't be read. */
function savedOn(ts) {
  const ms = Date.parse(String(ts || ''));
  return Number.isFinite(ms) ? formatDate(new Date(ms + IST_MS).toISOString().slice(0, 10)) : '';
}
const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';
/** Bottom edge of the sticky bar and its hanging toran (px from the top of the viewport). */
const topInset = () => ($('.toran') || el('journey-bar')).getBoundingClientRect().bottom;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const blankTravel = () => ({ mode: '', from: '', arrive: { date: '', slot: '' }, depart: { date: '', slot: '' } });
/** A local guest's travel: home is Bhilwara, so there is nothing to plan (amendments §L). */
const localTravel = () => ({ mode: LOCAL, from: CONFIG.city, arrive: { date: 'unsure', slot: 'unsure' }, depart: { date: 'unsure', slot: 'unsure' } });
const isLocal = () => state.travel.mode === LOCAL;

let keySeq = 0;
/** A stable per-guest key for this visit (regret joke counters, render bookkeeping). Never saved. */
const newKey = () => `p${++keySeq}`;
const genderOf = (v) => (GENDER_IDS.includes(v) ? v : '');
const otherGender = (v) => (v === 'M' ? 'F' : v === 'F' ? 'M' : '');

/**
 * guest:  {id, label, unlisted, max_guests, couple} | null   (whose ticket this is)
 * guests: [{name, status, gender, added, partner, key}]
 *         added   = typed on this page (Add guest), so editable and removable
 *         partner = the invited partner whose name the list doesn't know (editable, not removable)
 * filledBy: who is filling this in (the best-matching list name for the search, amendments §C)
 * booked:   {filled_by, updated_at, payload, has_note?, updated?} when this ticket was already saved
 *           (from any phone); updated = the saved copy on this phone was older (another phone changed it)
 * keepNote: the saved answer has a note this page can't see (the server never shares it), so an empty
 *           note is sent with keep_note and the server keeps the earlier one
 */
const state = {
  guest: null,
  guests: [],
  travel: blankTravel(),
  note: '',
  keepNote: false,
  stop: 'platform',
  unlistedId: '',   // remembered so re-boarding as an unlisted guest keeps the same ticket id
  filledBy: '',
  booked: null,
};
let dirty = false;  // true once the guest changed something since the last save/restore
let busy = false;   // a submission is in flight
let lastGoAt = 0;   // performance.now() of the last stop change (double-tap guard)
let changedFrom = ''; // id of the ticket holder before "Change", so a different pick starts fresh
let awayTravel = null; // the non-local plan, kept while "Bhilwara is home" is picked, so switching back restores it

/**
 * A reloaded chart (Back to the saved ticket, Edit my ticket, a newer saved copy) keeps each card's
 * per-visit key when it is the same person in the same seat, so the Regret joke neither restarts
 * nor carries over (v4 §P). Listed and added guests match by name; the unnamed-partner seat by seat.
 */
function carryKeys(next) {
  next.forEach((g, i) => {
    const p = state.guests[i];
    if (!p || !!p.added !== !!g.added || !!p.partner !== !!g.partner) return;
    if (g.partner || normalizeName(p.name) === normalizeName(g.name)) g.key = p.key;
  });
  return next;
}

/* Sanitisers for anything read back from localStorage (or a saved ticket from the server). */
function cleanIdentity(g) {
  const v = obj(g);
  if (typeof v.id !== 'string' || !v.id.trim() || v.id.length > 40) return null;
  const unlisted = v.unlisted === true;
  if (unlisted && !UNLISTED_RE.test(v.id)) return null;
  const label = clip(String(v.label ?? ''), 100).trim();
  if (!label) return null;
  const max = Math.trunc(Number(v.max_guests));
  return {
    id: v.id, label, unlisted, couple: v.couple === true,
    max_guests: Number.isFinite(max) ? Math.min(10, Math.max(1, max)) : 1,
  };
}
function cleanGuests(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10).map((g) => {
    const v = obj(g);
    return {
      name: clip(String(v.name ?? ''), NAME_MAX),
      status: STATUS_IDS.includes(v.status) ? v.status : '',
      gender: genderOf(v.gender),
      added: v.added === true,
      partner: v.partner === true && v.added !== true,
      key: newKey(),
    };
  });
}
function cleanSide(s, dates) {
  const v = obj(s);
  return { date: dates.includes(v.date) ? v.date : '', slot: SLOT_IDS.includes(v.slot) ? v.slot : '' };
}
function cleanTravel(t) {
  const v = obj(t);
  return {
    mode: MODE_IDS.includes(v.mode) ? v.mode : '',
    from: clip(String(v.from ?? ''), NAME_MAX),
    arrive: cleanSide(v.arrive, CONFIG.arriveDates),
    depart: cleanSide(v.depart, CONFIG.departDates),
  };
}

const maxGuests = () => Math.min(10, Math.max(1, (state.guest && state.guest.max_guests) || 1));
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
const storedGuests = () => state.guests.map(({ name, status, gender, added, partner }) => ({
  name, status, gender: genderOf(gender), added: !!added, partner: !!partner,
}));

function saveDraft() {
  if (!dirty || !state.guest || !FORM_STOPS.includes(state.stop)) return;
  local.saveDraft({
    v: 2,
    ts: Date.now(),
    guest: state.guest,
    guests: storedGuests(),
    travel: state.travel,
    // The plan set aside while "Bhilwara is home" is picked, so switching back after a reload restores it
    awayTravel: isLocal() && awayTravel ? cleanTravel({ ...awayTravel, mode: '' }) : null,
    note: state.note,
    keepNote: state.keepNote,
    stop: state.stop,
    unlistedId: state.unlistedId,
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
  const stop = FORM_STOPS.includes(d.stop) && guests.length ? d.stop : 'platform';
  return {
    guest,
    guests,
    travel,
    awayTravel: travel.mode === LOCAL && d.awayTravel ? cleanTravel(d.awayTravel) : null,
    note: clip(String(d.note ?? ''), NOTE_MAX),
    keepNote: d.keepNote === true,
    // Locals never visit the arrival and departure stops
    stop: travel.mode === LOCAL && (stop === 'arrival' || stop === 'departure') ? 'route' : stop,
    unlistedId: typeof d.unlistedId === 'string' && UNLISTED_RE.test(d.unlistedId) ? d.unlistedId : '',
    filledBy: clip(String(d.filledBy ?? ''), 100),
  };
}
function saveRecord(payload, updatedAt) {
  local.save({
    id: payload.id,
    label: payload.label,
    unlisted: payload.unlisted,
    max_guests: maxGuests(),
    couple: !!(state.guest && state.guest.couple),
    guests: storedGuests(),
    payload,
    updated_at: updatedAt,
  });
}
/** Load a saved ticket (local.load()) into state. Returns false if it's unusable. */
function loadRecord(r) {
  const p = obj(r && r.payload);
  const pGuests = Array.isArray(p.guests) ? p.guests : [];
  const guest = cleanIdentity({
    id: r && r.id, label: r && r.label, unlisted: r && r.unlisted, couple: r && r.couple,
    max_guests: (r && r.max_guests) || pGuests.length,
  });
  const guests = cleanGuests(Array.isArray(r && r.guests) && r.guests.length ? r.guests : pGuests);
  if (!guest || !guests.length) return false;
  state.guest = guest;
  state.guests = carryKeys(guests);
  state.travel = cleanTravel(p.travel);
  state.note = clip(String(p.note ?? ''), NOTE_MAX);
  state.keepNote = p.keep_note === true && !state.note;
  state.filledBy = clip(String(p.filled_by ?? ''), 100);
  state.booked = null;
  awayTravel = null;
  if (guest.unlisted) state.unlistedId = guest.id;
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
    // Back from "View my pass": show the welcome panel again rather than "Boarding as".
    const r = local.load();
    if (r && !dirty && state.guest && state.guest.id === r.id) {
      showWelcome(r);
      savedSync = checkNewer(r);
    }
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
  if (stop !== 'platform' && !state.guest) stop = 'platform';
  const leaving = state.stop;
  const body = document.body;
  lastGoAt = performance.now();
  writeHistory(nav || (dir === 'forward' && stop !== leaving ? 'push' : 'replace'), stop, leaving);
  if (stop !== 'platform') {
    body.classList.remove('is-searching', 'is-typing-name');
    hideBaajaNudge(false);
  }
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
  if (!isRegret) target.click();
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

let searchSeq = 0;
let searchTimer = 0;
let lastMatches = [];
let searchErrorDefault = '';

function hideSearchMessages() {
  el('search-empty').hidden = true;
  el('search-short').hidden = true;
  el('search-error').hidden = true;
  el('search-error').textContent = searchErrorDefault;
}
function showSearchError(msg) {
  el('search-error').textContent = msg || searchErrorDefault;
  el('search-error').hidden = false;
}

function renderResults(matches) {
  lastMatches = matches;
  const list = el('search-results');
  list.replaceChildren();
  for (const m of matches) {
    const li = tpl('tpl-result');
    const btn = li.querySelector('button');
    btn.dataset.id = m.id;
    slot(li, 'label').textContent = m.label;
    btn.setAttribute('aria-label', `Board as ${m.label}`);
    btn.addEventListener('click', () => pickListed(m, btn));
    list.appendChild(li);
  }
}

function onSearchInput() {
  clearTimeout(searchTimer);
  hideSearchMessages();
  const q = el('guest-search').value;
  if (q.trim().length < 3) {
    searchSeq++;
    renderResults([]);
    // A short first name ("Om") gets a nudge instead of silence
    el('search-short').hidden = q.trim().length === 0;
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), SEARCH_DEBOUNCE_MS);
}

async function runSearch(q) {
  const seq = ++searchSeq;
  try {
    const matches = await findGuests(q);
    if (seq !== searchSeq) return;
    renderResults(matches);
    el('search-empty').hidden = matches.length > 0;
    revealResults();
    announce(matches.length
      ? `${plural(matches.length, 'match', 'matches')}. Tab to pick your name.`
      : el('search-empty').textContent);
  } catch (err) {
    if (seq !== searchSeq) return;
    renderResults([]);
    showSearchError(err && err.message);
  }
}

async function pickListed(match, btn) {
  if (busy) return;
  hideSearchMessages();
  let guest = null;
  if (btn) btn.setAttribute('aria-busy', 'true');
  try {
    guest = await getGuest(match.id);
  } catch (err) {
    showSearchError(err && err.message);
    return;
  } finally {
    if (btn) btn.removeAttribute('aria-busy');
  }
  if (!guest) {
    showSearchError("We couldn't open that ticket. Search for your name again.");
    return;
  }
  chooseGuest(guest, el('guest-search').value);
  goPassengers();
}

/** Into the passenger chart; a saved ticket's banner is read out with the stop name. */
function goPassengers() {
  go('passengers', { say: !state.booked });
  if (state.booked) announce(`${stopSay('passengers')}. ${el('booked-text').textContent}`);
}

/* Keep the name search and its results above the phone keyboard. */

let liftTimer = 0;
let typingTimer = 0;

function onSearchFocus() {
  // is-searching: room below the search so it can scroll up under the bar (kept until a name is
  // picked, so the page never shrinks mid-tap). is-typing-name: tucks the CTA bar away while typing.
  document.body.classList.add('is-searching', 'is-typing-name');
  clearTimeout(typingTimer);
  clearTimeout(liftTimer);
  liftTimer = setTimeout(liftSearch, 300); // after the keyboard has slid up
}

function onSearchBlur() {
  // Bring the CTA bar back only after the tap that took focus away has landed, so the bar can't
  // pop up under the guest's finger mid-tap.
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (document.activeElement !== el('guest-search')) document.body.classList.remove('is-typing-name');
  }, 400);
}

/** Scroll "Who's boarding?" to just under the sticky bar, so results open in the visible area. */
function liftSearch() {
  if (state.stop !== 'platform' || document.activeElement !== el('guest-search')) return;
  el('search-block').scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** If the last result is under the keyboard or the CTA bar, scroll it up (never past the input). */
function revealResults() {
  const last = el('search-results').lastElementChild;
  if (!last || state.stop !== 'platform') return;
  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const bar = el('cta-bar');
  const barShown = !bar.hidden && !document.body.classList.contains('is-typing-name');
  const bottom = Math.min(visibleBottom, barShown ? bar.getBoundingClientRect().top : Infinity) - 8;
  const overflow = last.getBoundingClientRect().bottom - bottom;
  if (overflow <= 0) return;
  const room = el('guest-search').getBoundingClientRect().top - (topInset() + 8);
  const by = Math.min(overflow, Math.max(0, room));
  if (by > 0) window.scrollBy({ top: by, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** After "Change", a different ticket holder starts with a blank travel plan and note. */
function startFreshIfNewHolder(id) {
  if (changedFrom && changedFrom !== id) {
    state.travel = blankTravel();
    state.note = '';
    state.keepNote = false;
    awayTravel = null;
    syncForm();
  }
  changedFrom = '';
}

/**
 * Who is filling this in (amendments §C): the list name that best matches what they searched
 * for, so "priya" on Rahul & Priya's ticket is Priya. No search (a ?g= link) means the first name.
 */
function fillerFor(g, query) {
  const names = Array.isArray(g.names) ? g.names.filter(Boolean) : [];
  if (!names.length) return clip(String(g.label || ''), 100);
  let best = names[0];
  let top = 0;
  if (String(query || '').trim()) {
    for (const n of names) {
      const score = matchScore(query, { label: '', names: [n], aliases: [] });
      if (score > top) { best = n; top = score; }
    }
  }
  return clip(best, 100);
}

/**
 * The initial passenger chart for a list record (amendments §A): one read-only card per known
 * name (gender from the list), plus a card for an invited partner whose name the list doesn't
 * know (name required, gender preset, no remove button).
 */
function cardsFor(g) {
  const genders = Array.isArray(g.genders) ? g.genders : [];
  const names = (g.names && g.names.length ? g.names : [g.label]).slice(0, MAX_GUESTS);
  const guests = names.map((n, i) => ({
    name: clip(String(n), NAME_MAX), status: '', gender: genderOf(genders[i]), added: false, partner: false, key: newKey(),
  }));
  if (g.partner && guests.length < MAX_GUESTS) {
    guests.push({ name: '', status: '', gender: genderOf(g.partner.gender), added: false, partner: true, key: newKey() });
  }
  return guests;
}

/** Fill the chart, travel and note from the ticket's latest saved answer (amendments §C). */
function applyBooked(g) {
  const p = obj(g.booked && g.booked.payload);
  const guests = cleanGuests(p.guests);
  if (!guests.length) return false;
  // Older answers may lack genders: take them from the list where the names match
  const listed = Array.isArray(g.names) ? g.names : [];
  for (const x of guests) {
    if (x.gender || x.added || x.partner) continue;
    const i = listed.findIndex((n) => normalizeName(n) === normalizeName(x.name));
    if (i >= 0) x.gender = genderOf(g.genders && g.genders[i]);
  }
  state.guests = carryKeys(guests);
  state.travel = p.travel && typeof p.travel === 'object' ? cleanTravel(p.travel) : blankTravel();
  // The server never shares the note (anyone can search a name); has_note says one is saved
  state.note = clip(String(p.note ?? ''), NOTE_MAX);
  state.keepNote = !state.note && (g.booked.has_note === true || p.keep_note === true);
  state.guest.max_guests = Math.max(state.guest.max_guests, guests.length);
  awayTravel = null;
  syncForm();
  return true;
}

/** state.booked from a guest record's `booked` (null when the ticket has no saved answer yet). */
function bookedFor(g, updated = false) {
  const b = g && g.booked;
  if (!b) return null;
  return {
    filled_by: String(b.filled_by || ''), updated_at: String(b.updated_at || ''), payload: b.payload,
    has_note: b.has_note === true, updated,
    names: Array.isArray(g.names) ? g.names : [], genders: Array.isArray(g.genders) ? g.genders : [],
  };
}

/** Make a listed guest the ticket holder. Keeps the passenger chart if it's the same ticket. */
function chooseGuest(g, query = '') {
  startFreshIfNewHolder(g.id);
  const same = state.guest && state.guest.id === g.id && state.guests.length > 0;
  const max = Math.min(10, Math.max(1, Number(g.max_guests) || MAX_GUESTS));
  state.guest = { id: g.id, label: clip(g.label, 100) || g.id, unlisted: false, max_guests: max, couple: g.couple === true };
  state.filledBy = fillerFor(g, query);
  state.booked = bookedFor(g);
  // The saved ticket wins over a fresh chart, but never over edits in progress on this phone
  if (!same && !(state.booked && applyBooked(g))) state.guests = cardsFor(g);
  renderPlatform();
  updateParty();
  renderRiders();
  if (same || !state.booked) markDirty();
  else dirty = false;
}

/** Board someone who isn't on the list. Re-boarding keeps the same unlisted id. */
function boardUnlisted(name) {
  const prev = state.guest && state.guest.unlisted ? state.guest : null;
  const id = prev ? prev.id : (state.unlistedId || newUnlistedId());
  startFreshIfNewHolder(id);
  state.unlistedId = id;
  if (!prev || !state.guests.length) state.guests = [{ name, status: '', gender: '', added: false, partner: false, key: newKey() }];
  else state.guests[0].name = name;
  state.guest = { id, label: name, unlisted: true, max_guests: UNLISTED_MAX_GUESTS, couple: false };
  state.filledBy = name;
  state.booked = null;
  renderPlatform();
  updateParty();
  renderRiders();
  markDirty();
}

function boardNow() {
  const unlistedOpen = !el('unlisted-block').hidden;
  if (unlistedOpen) {
    const name = el('unlisted-name').value.trim().slice(0, NAME_MAX);
    if (!name) {
      el('unlisted-error').hidden = false;
      el('unlisted-name').setAttribute('aria-invalid', 'true');
      el('unlisted-name').focus();
      announce(el('unlisted-error').textContent);
      return;
    }
    boardUnlisted(name);
    go('passengers');
    return;
  }
  if (state.guest) {
    goPassengers();
    return;
  }
  showSearchError(searchErrorDefault);
  el('guest-search').focus();
  announce(searchErrorDefault);
}

/** Platform view: search UI while nobody is chosen, "Boarding as …" once someone is. */
function renderPlatform() {
  const chosen = !!state.guest;
  const block = el('search-block');
  for (const node of [$('.boarding__label', block), el('search-hint'), $('.search', block), el('search-results'), el('board-anyway')]) {
    if (node) node.hidden = chosen;
  }
  el('boarding-as').hidden = !chosen;
  el('boarding-as-name').textContent = chosen ? state.guest.label : '';
  if (chosen) {
    document.body.classList.remove('is-searching');
    el('unlisted-block').hidden = true;
    el('board-anyway').setAttribute('aria-expanded', 'false');
    el('unlisted-error').hidden = true;
    hideSearchMessages();
  }
}

/**
 * "Change": forget the chosen ticket holder and go back to the search. On a shared phone the next
 * person must not inherit the last one's travel plan or note, so those reset once someone
 * different is picked (keepAnswers: the same people re-picking after a stale-id error).
 */
function changeGuest({ focus = true, keepAnswers = false } = {}) {
  changedFrom = keepAnswers ? '' : (state.guest ? state.guest.id : changedFrom);
  state.guest = null;
  state.guests = [];
  state.filledBy = '';
  state.booked = null;
  dirty = false;
  local.clearDraft();
  el('guest-search').value = '';
  renderResults([]);
  renderPlatform();
  updateParty();
  updateCta();
  renderRiders();
  if (focus) el('guest-search').focus();
}

function showWelcome(record) {
  el('welcome-name').textContent = record.label;
  el('welcome').hidden = false;
  el('search-block').hidden = true;
  updateCta();
}
function hideWelcome() {
  el('welcome').hidden = true;
  el('search-block').hidden = false;
}

/** "Someone else? Start a new ticket". */
function resetAll() {
  local.clear();
  local.clearDraft();
  state.guest = null;
  state.guests = [];
  state.travel = blankTravel();
  state.note = '';
  state.keepNote = false;
  state.unlistedId = '';
  state.filledBy = '';
  state.booked = null;
  awayTravel = null;
  changedFrom = '';
  savedSync = null;
  dirty = false;
  el('guest-search').value = '';
  el('unlisted-name').value = '';
  renderResults([]);
  hideWelcome();
  syncForm();
  updateCta();
  renderRiders();
  el('guest-search').focus();
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
/** Names the guest types: Add guest cards and the invited partner whose name the list lacks. */
const typesName = (g) => g.added || g.partner;
/** M/F is asked of anyone the list doesn't describe: added guests, the partner, an unlisted guest. */
const asksGender = (g) => g.added || g.partner || !!(state.guest && state.guest.unlisted);

/** `{keep_note: true}` while the saved answer's unseen note should be kept (see state.keepNote), else `{}`. */
const keepNoteFlag = () => (state.keepNote && !state.note.trim() ? { keep_note: true } : {});

/** "Already booked" banner on the passenger chart (amendments §C). '' hides it. */
function bookedMessage() {
  const b = state.booked;
  if (!b || !state.guest || state.guest.unlisted) return '';
  const when = savedOn(b.updated_at);
  const by = String(b.filled_by || '').trim();
  const someoneElse = by && normalizeName(by) !== normalizeName(state.filledBy);
  if (b.updated) {
    // This phone's saved copy was older: the ticket was changed from another phone since
    return someoneElse
      ? `${firstWord(by)} updated your ticket${when ? ` on ${when}` : ''}. Check the details or make changes.`
      : `Your ticket was updated from another phone${when ? ` on ${when}` : ''}. Check the details or make changes.`;
  }
  if (state.guest.couple && someoneElse) {
    const who = state.guests.length > 2 ? 'everyone' : 'you both';
    return `${firstWord(by)} already booked seats for ${who}${when ? ` on ${when}` : ''}. Check the details or make changes.`;
  }
  return `Your seats are already booked${when ? ` (updated ${when})` : ''}. Check the details or make changes.`;
}
function renderBooked() {
  const msg = bookedMessage();
  el('booked').hidden = !msg;
  el('booked-text').textContent = msg;
}

/** "View my pass" on the banner: show the saved ticket (not edits in progress) at the junction. */
function viewBookedPass() {
  const b = state.booked;
  if (busy || !b || !state.guest) return;
  if (!applyBooked({ booked: b, names: b.names, genders: b.genders })) return;
  const saved = obj(b.payload);
  saveRecord({ ...saved, ...keepNoteFlag(), id: state.guest.id, label: state.guest.label, unlisted: false }, b.updated_at);
  dirty = false;
  local.clearDraft();
  go(everyoneRegrets() ? 'regret-end' : 'junction', { nav: 'push' });
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

  // M/F toggle (amendments §D): only for people the list doesn't describe
  let gender = null;
  if (asksGender(g)) {
    gender = slot(card, 'gender');
    gender.hidden = false;
    gender.setAttribute('aria-label', genderGroupLabel(g, n));
    for (const opt of $$('[role="radio"]', gender)) {
      opt.setAttribute('aria-checked', String(opt.dataset.value === g.gender));
      opt.addEventListener('click', () => setGender(g, opt.dataset.value));
    }
    rove(gender);
  }

  let input = null;
  if (typesName(g)) {
    card.classList.toggle('is-added', !!g.added);
    card.classList.toggle('is-partner', !!g.partner);
    slot(card, 'name').hidden = true;
    $('.guest-card__name-field', card).hidden = false;
    input = slot(card, 'name-input');
    input.id = `guest-name-${n}`;
    slot(card, 'name-label').htmlFor = input.id;
    if (g.partner) input.placeholder = "Your partner's name";
    input.required = true;
    input.value = g.name;
    input.setAttribute('aria-describedby', err.id);
    input.addEventListener('input', () => {
      g.name = input.value.slice(0, NAME_MAX);
      group.setAttribute('aria-label', statusGroupLabel(g, n));
      if (gender) gender.setAttribute('aria-label', genderGroupLabel(g, n));
      if (card.classList.contains('is-invalid')) recheckCard(g);
      markDirty();
    });
    if (g.added) {
      // The invited partner has no remove button: they pick a status (Regret included) instead
      const remove = $('[data-action="remove"]', card);
      remove.hidden = false;
      remove.setAttribute('aria-label', `Remove passenger ${n}`);
      remove.addEventListener('click', () => removeGuest(g));
    }
  } else {
    slot(card, 'name').textContent = g.name;
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
      // The stable per-guest key lets each card run its own joke (regret.js may ignore it)
      regret.handle(chip, () => setStatus(g, 'regret'), g.key);
    });
  }
  cards[i] = { card, chips, input, err, group, gender };
  return card;
}

function renderGuests() {
  const list = el('guest-list');
  list.replaceChildren();
  cards = [];
  state.guests.forEach((g, i) => list.appendChild(buildCard(g, i)));
  renderAddGuest();
  renderBooked();
  el('passengers-error').hidden = true;
}

function setGender(g, value) {
  const i = state.guests.indexOf(g);
  if (i < 0 || !GENDER_IDS.includes(value)) return;
  g.gender = value;
  const ref = cards[i];
  if (ref && ref.gender) checkChip(ref.gender, value);
  renderRiders();
  markDirty();
}

function renderAddGuest() {
  const left = maxGuests() - state.guests.length;
  el('add-guest').hidden = left <= 0;
  el('add-guest-hint').hidden = left <= 0;
  el('add-guest-hint').textContent = `You can bring ${left} more.`;
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
  if (!state.guest || state.guests.length >= maxGuests()) return;
  // Guessing the other half of a pair: the opposite of passenger 1, or nothing if unknown
  const gender = otherGender(state.guests[0] && state.guests[0].gender);
  state.guests.push({ name: '', status: '', gender, added: true, partner: false, key: newKey() });
  renderGuests();
  renderRiders();
  markDirty();
  const ref = cards[cards.length - 1];
  if (ref && ref.input) ref.input.focus();
  announce(`Passenger ${state.guests.length} added. Type their name.`);
}

function removeGuest(g) {
  const i = state.guests.indexOf(g);
  if (i < 0) return;
  state.guests.splice(i, 1);
  renderGuests();
  updateParty();
  updateCta();
  renderRiders();
  markDirty();
  (el('add-guest').hidden ? el('t-passengers') : el('add-guest')).focus();
  announce(`Passenger ${i + 1} removed.`);
}

/** Errors for one guest: [nameMissing, statusMissing, isPartner]. */
function guestProblems(g) {
  return [!g.name.trim(), !STATUS_IDS.includes(g.status), !!g.partner];
}

function setCardError(i, msg, nameBad) {
  const ref = cards[i];
  if (!ref) return;
  ref.card.classList.toggle('is-invalid', !!msg);
  ref.err.textContent = msg;
  ref.err.hidden = !msg;
  if (ref.input) {
    if (nameBad) ref.input.setAttribute('aria-invalid', 'true');
    else ref.input.removeAttribute('aria-invalid');
  }
}

function cardMessage([nameBad, statusBad, partner]) {
  const name = partner ? "Add your partner's name." : 'Add a name for this passenger.';
  return [nameBad ? name : '', statusBad ? 'Pick Confirmed, Waitlisted or Regret.' : '']
    .filter(Boolean).join(' ');
}

/** Live re-check of a card that is showing an error. */
function recheckCard(g) {
  const i = state.guests.indexOf(g);
  if (i < 0) return;
  const p = guestProblems(g);
  setCardError(i, cardMessage(p), p[0]);
  if (!cards.some((c) => c && c.card.classList.contains('is-invalid'))) el('passengers-error').hidden = true;
}

function checkPassengers(show) {
  let firstBad = -1;
  let missingName = false;
  let missingStatus = false;
  state.guests.forEach((g, i) => {
    const p = guestProblems(g);
    if (p[0]) missingName = true;
    if (p[1]) missingStatus = true;
    if ((p[0] || p[1]) && firstBad < 0) firstBad = i;
    if (show) setCardError(i, cardMessage(p), p[0]);
  });
  const ok = state.guests.length > 0 && firstBad < 0;
  if (show) {
    const pe = el('passengers-error');
    pe.textContent = missingStatus && missingName ? 'Add a name and pick a status for every passenger.'
      : missingName ? 'Add a name for every passenger.' : 'Pick a status for every passenger.';
    pe.hidden = ok;
    if (!ok && firstBad >= 0 && cards[firstBad]) {
      const ref = cards[firstBad];
      const target = ref.input && !state.guests[firstBad].name.trim() ? ref.input : $('[role="radio"]', ref.group);
      if (target) target.focus();
    }
  }
  return ok;
}

/* ------------------------------------------------------------------ */
/* Stops 2–4 · Route, arrival, departure                               */
/* ------------------------------------------------------------------ */

function syncSide(side) {
  checkChip(el(`${side}-date-chips`), state.travel[side].date);
  checkChip(el(`${side}-slot-chips`), state.travel[side].slot);
}

function setSide(side, key, value) {
  const s = state.travel[side];
  s[key] = value;
  if (key === 'date' && value === 'unsure' && !s.slot) s.slot = 'unsure';
  syncSide(side);
  el(`${side}-error`).hidden = true;
  renderCatches();
  markDirty();
}

/**
 * Pick a travel mode. "Bhilwara is home" (amendments §L) fills in a local plan and skips the
 * arrival and departure stops; the away plan is kept aside so switching back restores it.
 */
function setMode(value) {
  if (!MODE_IDS.includes(value)) return;
  const was = state.travel.mode;
  if (value === LOCAL && was !== LOCAL) {
    awayTravel = { from: state.travel.from, arrive: { ...state.travel.arrive }, depart: { ...state.travel.depart } };
    state.travel = localTravel();
  } else if (value !== LOCAL && was === LOCAL) {
    const back = awayTravel || blankTravel();
    state.travel = { mode: value, from: back.from, arrive: { ...back.arrive }, depart: { ...back.depart } };
    awayTravel = null;
  } else {
    state.travel.mode = value;
  }
  el('mode-error').hidden = true;
  syncTravel();
  renderCatches();
  updateCta();
  markDirty();
}

/** Route stop for locals: every function lit, and the note to the couple (amendments §L). */
function renderLocalExtras() {
  const home = isLocal();
  el('from-field').hidden = home;
  el('local-extras').hidden = !home;
  if (home) renderCatches(el('local-catches'));
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

const sideComplete = (side, dates) => dates.includes(state.travel[side].date) && SLOT_IDS.includes(state.travel[side].slot);

function checkArrival(show) {
  const ok = sideComplete('arrive', CONFIG.arriveDates);
  if (show && !ok) {
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
  if (!sideComplete('depart', CONFIG.departDates)) return 'Pick a rough date and time. "Not sure yet" is fine.';
  if (isValidISODate(a.date) && isValidISODate(d.date)) {
    if (d.date < a.date) return 'Your leaving date is before your arrival. Pick a later date.';
    const [ah, dh] = [slotHour(a.slot), slotHour(d.slot)];
    if (d.date === a.date && a.slot !== 'unsure' && d.slot !== 'unsure' && dh !== null && ah !== null && dh < ah) {
      return 'Your leaving time is before your arrival time. Pick a later one.';
    }
  }
  return '';
}

function checkDeparture(show) {
  const problem = departProblem();
  if (show && problem) {
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
  renderNoteKept();
}

/** "Your earlier note is saved" under each note box, while the unseen saved note would be kept. */
function renderNoteKept() {
  const show = state.keepNote && !state.note.trim();
  for (const p of $$('[data-note-kept]')) p.hidden = !show;
}

/** Mode chips, city, dates and the local extras from state.travel. */
function syncTravel() {
  const t = state.travel;
  checkChip(el('mode-chips'), t.mode);
  document.body.dataset.mode = t.mode || 'train';
  el('from-city').value = isLocal() ? (awayTravel ? awayTravel.from : '') : t.from;
  syncSide('arrive');
  syncSide('depart');
  renderLocalExtras();
}

/** Push state into every static control (after a restore or reset). */
function syncForm() {
  syncTravel();
  syncNotes();
  if (state.guest && state.guest.unlisted) el('unlisted-name').value = state.guest.label;
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
  if (!state.guest) return 'platform';
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
    return;
  }
  for (const g of state.guests) g.name = g.name.trim();
  if (!state.filledBy) state.filledBy = (state.guests[0] && state.guests[0].name) || state.guest.label;
  const payload = { ...buildPayload(state, client()), ...keepNoteFlag() };
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
  state.booked = null; // this phone's answer is now the latest one
  if (payload.note) state.keepNote = false; // a new note replaced the earlier one
  dirty = false;
  local.clearDraft();
  setBusy(false);
  // 'base': drop the form's history entries, so the back gesture from here leaves the site.
  go(regretOnly ? 'regret-end' : 'junction', { nav: 'base' });
}

function handleSubmitError(err) {
  const msg = (err && err.message) || "Couldn't reach the ticket counter. Check your connection and try again.";
  const code = err && err.code;
  if (code === 'unknown_guest') {
    changeGuest({ focus: false, keepAnswers: true });
    go('platform', { dir: 'back', say: false });
    showSearchError(msg);
    el('guest-search').focus();
    announce(msg);
    return;
  }
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
  el('pass-wa').hidden = true;
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

function shareText() {
  const wl = party() === 'waitlisted';
  const line = wl
    ? `On the waitlist for the ${CONFIG.train.name} to ${CONFIG.city} for ${CONFIG.couple.joined}'s wedding. Will confirm soon!`
    : isLocal()
      ? `Home platform! I'll be at every function of ${CONFIG.couple.joined}'s wedding in ${CONFIG.city}. 🛺`
      : `Booked on the ${CONFIG.train.name} to ${CONFIG.city} for ${CONFIG.couple.joined}'s wedding! 🚂`;
  return `${line} ${weddingDates()}.${CONFIG.siteUrl ? `\n${CONFIG.siteUrl}` : ''}`;
}

/** wa.me link to Saumy, or '' when CONFIG.hostWhatsApp isn't set. */
function waLink() {
  const num = String(CONFIG.hostWhatsApp || '').replace(/\D/g, '');
  if (!num || !state.guest) return '';
  const people = state.guests.map((g) => `${g.name.trim()} (${statusLabel(g.status)})`).join(', ');
  let text = `Hi ${CONFIG.couple.a}! ${state.guest.label} here. My ${CONFIG.train.name} ticket is saved. Passengers: ${people}.`;
  const t = state.travel;
  if (!everyoneRegrets() && t.mode === LOCAL) {
    text += ` ${CONFIG.city} is home, so I'll be at every function.`;
  } else if (!everyoneRegrets() && t.mode) {
    text += ` Rough plan: ${modeLabel(t.mode)} from ${t.from.trim()}, arriving ${formatDate(t.arrive.date)} (${slotLabel(t.arrive.slot)}),`
      + ` leaving ${formatDate(t.depart.date)} (${slotLabel(t.depart.slot)}).`;
  }
  text += ' Sending my boarding pass next!';
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
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
      const href = waLink();
      if (href) {
        const wa = el('pass-wa');
        wa.href = href;
        wa.hidden = false;
        toast('Ticket downloaded. Send it on WhatsApp.');
      } else {
        toast('Ticket downloaded. Share it from your photos.');
      }
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
  currentMail = leaveEmail(leaveKind, {
    name: first, arrive, depart, days, couple: CONFIG.couple.joined, city: `${CONFIG.city}, ${CONFIG.state}`,
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
  renderNoteKept();
  const err = el('regret-note-error');
  if (err) err.hidden = true;
  el('regret-note-save').textContent = state.note.trim() || state.keepNote ? 'Update note' : 'Send note';
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
    state.keepNote = false; // the new note replaced any earlier one
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
  refreshGuest();
}

/**
 * Pick up changes made since this ticket was saved on this phone: max_guests from the Sheet, and a
 * newer answer saved from another phone (a partner, amendments §C), unless the guest has already
 * started changing things here.
 */
function refreshGuest() {
  const g = state.guest;
  if (!g || g.unlisted) return;
  getGuest(g.id).then((fresh) => {
    if (!fresh || !state.guest || state.guest.id !== fresh.id) return;
    state.guest.max_guests = Math.max(fresh.max_guests, state.guests.length);
    state.guest.couple = fresh.couple === true;
    const r = local.load();
    if (!dirty && !busy && state.stop === 'passengers' && r && r.id === fresh.id && isNewer(fresh.booked, r.updated_at)) {
      adoptNewer(fresh);
      renderGuests();
      updateParty();
      updateCta();
      renderRiders();
      announce(el('booked-text').textContent);
      return;
    }
    if (state.stop === 'passengers') renderAddGuest();
  }).catch(() => { /* offline: keep what we have */ });
}

/*
 * The ticket saved on this phone can go stale: a partner (or the same guest on another phone) may
 * have saved a newer answer since. Before "View my pass" or "Edit my ticket" shows the saved copy,
 * the server's latest answer is fetched; when it is newer it replaces this phone's copy, so an old
 * copy can't silently undo the other person's answer. Offline, the phone's copy is used.
 */
const NEWER_MS = 2000;     // the server's copy must be this much newer (absorbs timestamp rounding)
const SYNC_WAIT_MS = 4000; // how long the welcome buttons wait for that check before using the phone's copy
let savedSync = null;      // Promise<guest record with a newer `booked` | null>, started with the welcome panel

/** True when a server `booked` was saved clearly after `ts` (this phone's copy). */
function isNewer(b, ts) {
  const theirs = Date.parse(String((b && b.updated_at) || ''));
  const ours = Date.parse(String(ts || ''));
  return Number.isFinite(theirs) && Number.isFinite(ours) && theirs - ours > NEWER_MS;
}

/** The guest record when the server holds a newer answer for this saved ticket, else null. Never rejects. */
async function checkNewer(record) {
  if (!record || record.unlisted === true || typeof record.id !== 'string' || !record.id) return null;
  try {
    const g = await getGuest(record.id);
    return g && g.id === record.id && isNewer(g.booked, record.updated_at) ? g : null;
  } catch {
    return null;
  }
}

/** Take the server's newer answer: it fills the chart and replaces this phone's saved copy. */
function adoptNewer(g) {
  const mine = state.filledBy; // who uses this phone; the banner and the next save are theirs
  const booked = bookedFor(g, true);
  if (!applyBooked(g)) return false;
  state.booked = booked;
  state.guest.couple = g.couple === true;
  state.filledBy = mine || state.filledBy;
  const saved = obj(g.booked.payload);
  saveRecord({ ...saved, ...keepNoteFlag(), id: state.guest.id, label: state.guest.label, unlisted: false, filled_by: state.filledBy }, g.booked.updated_at);
  dirty = false;
  return true;
}

/** The welcome panel's "View my pass" / "Edit my ticket": the saved ticket, brought up to date first. */
async function openSaved(kind) {
  const btn = el(kind === 'edit' ? 'welcome-edit' : 'welcome-view-pass');
  if (busy || btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  let newer = null;
  try {
    const check = savedSync || checkNewer(local.load());
    newer = await Promise.race([check, new Promise((resolve) => { setTimeout(() => resolve(null), SYNC_WAIT_MS); })]);
  } finally {
    btn.removeAttribute('aria-busy');
  }
  savedSync = null;
  const r = local.load();
  if (!r || !loadRecord(r)) { resetAll(); return; }
  const updated = !!(newer && newer.id === r.id && adoptNewer(newer));
  hideWelcome();
  if (kind === 'edit') {
    startEdit();
    return;
  }
  go(everyoneRegrets() ? 'regret-end' : 'junction', { nav: 'push' });
  if (updated) toast(bookedMessage().replace(/ Check the details or make changes\.$/, ''), 4000);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/* Baaja nudge: sound is off by default, so point at the toggle once. */

let nudgeTimer = 0;
let nudgeHideTimer = 0;

function scheduleBaajaNudge() {
  let seen = false;
  try { seen = localStorage.getItem(NUDGE_KEY) === '1'; } catch { seen = false; }
  if (seen) return;
  nudgeTimer = setTimeout(() => {
    if (state.stop !== 'platform' || el('baaja-toggle').getAttribute('aria-pressed') === 'true') return;
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
  // Journey bar: Baaja
  const baaja = createBaaja({
    onChange: (on) => {
      el('baaja-toggle').setAttribute('aria-pressed', String(on));
      document.body.classList.toggle('is-baaja-on', on);
    },
  });
  el('baaja-toggle').addEventListener('click', () => {
    hideBaajaNudge(true);
    const on = baaja.toggle();
    el('baaja-toggle').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('is-baaja-on', on);
    if (!on && baaja.state === 'unsupported') toast("This browser can't play the baaja.");
  });
  let dholTap = 0;
  el('tap-dhol').addEventListener('click', () => { baaja.dholHit(DHOL_TAPS[dholTap++ % DHOL_TAPS.length]); });
  el('tap-shehnai').addEventListener('click', () => { baaja.shehnaiPhrase(); });

  // Regret controller (one per page: the dodge count is shared by every card)
  regret = createRegretController({
    messages: CONFIG.regret.dodges,
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
  el('guest-search').addEventListener('focus', onSearchFocus);
  el('guest-search').addEventListener('blur', onSearchBlur);
  el('guest-search').addEventListener('input', onSearchInput);
  el('guest-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(searchTimer);
    if (lastMatches.length === 1) {
      pickListed(lastMatches[0], $('#search-results button'));
    } else if (el('guest-search').value.trim().length >= 3) {
      runSearch(el('guest-search').value);
    }
  });
  el('board-anyway').addEventListener('click', () => {
    const open = el('unlisted-block').hidden;
    el('unlisted-block').hidden = !open;
    el('board-anyway').setAttribute('aria-expanded', String(open));
    if (open) {
      hideSearchMessages();
      el('unlisted-name').focus();
    }
  });
  el('unlisted-name').addEventListener('input', () => {
    el('unlisted-error').hidden = true;
    el('unlisted-name').removeAttribute('aria-invalid');
  });
  el('unlisted-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      next();
    }
  });
  el('boarding-change').addEventListener('click', () => changeGuest());
  el('welcome-view-pass').addEventListener('click', () => { openSaved('pass'); });
  el('welcome-edit').addEventListener('click', () => { openSaved('edit'); });
  el('welcome-reset').addEventListener('click', resetAll);

  // Passengers
  el('add-guest').addEventListener('click', addGuest);
  el('booked-view-pass').addEventListener('click', viewBookedPass);

  // Route
  bindGroup(el('mode-chips'), setMode);
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
    renderNoteKept();
    const err = el('regret-note-error');
    if (err) err.hidden = true;
  });
  el('regret-note-save').addEventListener('click', saveRegretNote);
  el('regret-edit').addEventListener('click', startEdit);
}

/** Decide where this visit starts: draft → saved ticket (welcome back) → ?g= link → fresh platform. */
async function restore() {
  let gParam = '';
  try { gParam = (new URLSearchParams(window.location.search).get('g') || '').trim().toLowerCase(); } catch { gParam = ''; }
  const draft = readDraft();
  const record = local.load();

  if (draft && (!gParam || draft.guest.id === gParam)) {
    state.guest = draft.guest;
    state.guests = draft.guests;
    state.travel = draft.travel;
    awayTravel = draft.awayTravel;
    state.note = draft.note;
    state.keepNote = draft.keepNote;
    state.unlistedId = draft.unlistedId || (draft.guest.unlisted ? draft.guest.id : '');
    state.filledBy = draft.filledBy;
    dirty = true;
    syncForm();
    go(draft.stop, { focus: false, say: false, nav: 'replace' });
    return;
  }
  if (record && (!gParam || record.id === gParam)) {
    showWelcome(record);
    savedSync = checkNewer(record); // ready (usually) by the time "View my pass" is tapped
    return;
  }
  if (gParam) {
    try {
      const g = await getGuest(gParam);
      if (g && !state.guest) chooseGuest(g);
      else if (!g && !state.guest) showSearchError("That link didn't match a ticket. Search your name below.");
    } catch (err) {
      // Offline: the search below still works once the connection is back.
      if (!state.guest) showSearchError(err && err.message);
    }
  }
}

function boot() {
  if (document.body.classList.contains('preview-all')) return;
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  searchErrorDefault = el('search-error').textContent;
  for (const id of ['search-results', 'guest-list', 'catches', 'local-catches']) el(id).replaceChildren();
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
  restore().catch(() => { /* never leave the platform stuck */ });
  scheduleBaajaNudge();
}

boot();

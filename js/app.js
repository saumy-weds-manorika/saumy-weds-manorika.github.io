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
  formatDate, isValidISODate, slotHour, bookingOpens, bookingStatus, catches, workingDays,
  overallStatus, validatePayload, buildPayload, calendarUrl, icsText, leaveEmail,
} from './logic.js';
import { findGuests, getGuest, submitRsvp, newUnlistedId, local } from './api.js';
import { createRegretController } from './regret.js';
import { createBaaja } from './audio.js';
import { renderPass, passFilename, downloadPass, sharePass, passBlob } from './pass.js';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STATUS_IDS = CONFIG.statuses.map((s) => s.id);
const MODE_IDS = CONFIG.modes.map((m) => m.id);
const SLOT_IDS = CONFIG.slots.map((s) => s.id);
const FORM_STOPS = ['platform', 'passengers', 'route', 'arrival', 'departure'];
const STOP_ORDER = [...FORM_STOPS, 'junction', 'regret-end'];
const GO_COOLDOWN_MS = 400;      // taps this soon after a stop change are the tail of a double-tap
const OVERNIGHT_SLOTS = ['early', 'morning']; // arriving then usually means a train that left the day before
const IRCTC_URL = 'https://www.irctc.co.in/nget/train-search';
const NUDGE_KEY = 'stt.baaja.nudged';
const NAME_MAX = 60;
const NOTE_MAX = 500;
const UNLISTED_MAX_GUESTS = 2;   // someone we forgot to list may still bring a plus-one; Saumy reviews unlisted tickets
const UNLISTED_RE = /^u-[a-z0-9]{8}$/;
const SEARCH_DEBOUNCE_MS = 250;

/** Per stop: track progress, heading to focus, and what the live region says. */
const STOPS = {
  platform: { progress: 0, title: 't-platform', say: "Platform. Who's boarding?" },
  passengers: { progress: 0.2, title: 't-passengers', say: 'Stop 1 of 4: Passenger chart' },
  route: { progress: 0.4, title: 't-route', say: 'Stop 2 of 4: How you are travelling' },
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

const blankTravel = () => ({ mode: '', from: '', arrive: { date: '', slot: '' }, depart: { date: '', slot: '' } });

/**
 * guest:  {id, label, unlisted, max_guests} | null  (whose ticket this is)
 * guests: [{name, status, added}]                   (added = typed on this page, so editable/removable)
 */
const state = {
  guest: null,
  guests: [],
  travel: blankTravel(),
  note: '',
  stop: 'platform',
  unlistedId: '',   // remembered so re-boarding as an unlisted guest keeps the same ticket id
};
let dirty = false;  // true once the guest changed something since the last save/restore
let busy = false;   // a submission is in flight
let lastGoAt = 0;   // performance.now() of the last stop change (double-tap guard)
let changedFrom = ''; // id of the ticket holder before "Change", so a different pick starts fresh

/* Sanitisers for anything read back from localStorage. */
function cleanIdentity(g) {
  const v = obj(g);
  if (typeof v.id !== 'string' || !v.id.trim() || v.id.length > 40) return null;
  const unlisted = v.unlisted === true;
  if (unlisted && !UNLISTED_RE.test(v.id)) return null;
  const label = clip(String(v.label ?? ''), 100).trim();
  if (!label) return null;
  const max = Math.trunc(Number(v.max_guests));
  return { id: v.id, label, unlisted, max_guests: Number.isFinite(max) ? Math.min(10, Math.max(1, max)) : 1 };
}
function cleanGuests(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10).map((g) => {
    const v = obj(g);
    return { name: clip(String(v.name ?? ''), NAME_MAX), status: STATUS_IDS.includes(v.status) ? v.status : '', added: v.added === true };
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

function saveDraft() {
  if (!dirty || !state.guest || !FORM_STOPS.includes(state.stop)) return;
  local.saveDraft({
    v: 1,
    ts: Date.now(),
    guest: state.guest,
    guests: state.guests,
    travel: state.travel,
    note: state.note,
    stop: state.stop,
    unlistedId: state.unlistedId,
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
  return {
    guest,
    guests,
    travel: cleanTravel(d.travel),
    note: clip(String(d.note ?? ''), NOTE_MAX),
    stop: FORM_STOPS.includes(d.stop) && guests.length ? d.stop : 'platform',
    unlistedId: typeof d.unlistedId === 'string' && UNLISTED_RE.test(d.unlistedId) ? d.unlistedId : '',
  };
}
function saveRecord(payload, res) {
  local.save({
    id: payload.id,
    label: payload.label,
    unlisted: payload.unlisted,
    max_guests: maxGuests(),
    guests: state.guests.map(({ name, status, added }) => ({ name, status, added: !!added })),
    payload,
    updated_at: res.updated_at,
  });
}
/** Load a saved ticket (local.load()) into state. Returns false if it's unusable. */
function loadRecord(r) {
  const p = obj(r && r.payload);
  const pGuests = Array.isArray(p.guests) ? p.guests : [];
  const guest = cleanIdentity({ id: r && r.id, label: r && r.label, unlisted: r && r.unlisted, max_guests: (r && r.max_guests) || pGuests.length });
  const guests = cleanGuests(Array.isArray(r && r.guests) && r.guests.length ? r.guests : pGuests);
  if (!guest || !guests.length) return false;
  state.guest = guest;
  state.guests = guests;
  state.travel = cleanTravel(p.travel);
  state.note = clip(String(p.note ?? ''), NOTE_MAX);
  if (guest.unlisted) state.unlistedId = guest.id;
  dirty = false;
  syncForm();
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
  const target = e.state && typeof e.state.stt === 'string' && STOPS[e.state.stt] ? e.state.stt : 'platform';
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
  if (leaving === 'junction' && stop !== 'junction') stopTicking();

  if (stop === 'platform') renderPlatform();
  else if (stop === 'passengers') renderGuests();
  else if (stop === 'departure') renderCatches();
  else if (stop === 'junction') enterJunction();
  else if (stop === 'regret-end') enterRegretEnd();
  updateParty();
  updateCta();

  scrollTopNow();
  if (focus) {
    const h = el(meta.title);
    if (h) h.focus({ preventScroll: true });
  }
  if (say) announce(meta.say);
  saveDraft();
}

function ctaText() {
  switch (state.stop) {
    case 'platform': return 'Board now';
    case 'passengers': return everyoneRegrets() ? 'Send my regrets' : 'Next station →';
    case 'departure': return party() === 'waitlisted' ? 'Save my spot' : 'Confirm my seat';
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
      if (checkRoute(true)) go('arrival');
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
  chooseGuest(guest);
  go('passengers');
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
    syncForm();
  }
  changedFrom = '';
}

/** Make a listed guest the ticket holder. Keeps the passenger chart if it's the same ticket. */
function chooseGuest(g) {
  startFreshIfNewHolder(g.id);
  const same = state.guest && state.guest.id === g.id && state.guests.length > 0;
  const max = Math.min(10, Math.max(1, Number(g.max_guests) || 1));
  state.guest = { id: g.id, label: clip(g.label, 100) || g.id, unlisted: false, max_guests: max };
  if (!same) {
    const names = (g.names && g.names.length ? g.names : [g.label]).slice(0, max);
    state.guests = names.map((n) => ({ name: clip(String(n), NAME_MAX), status: '', added: false }));
  }
  renderPlatform();
  updateParty();
  markDirty();
}

/** Board someone who isn't on the list. Re-boarding keeps the same unlisted id. */
function boardUnlisted(name) {
  const prev = state.guest && state.guest.unlisted ? state.guest : null;
  const id = prev ? prev.id : (state.unlistedId || newUnlistedId());
  startFreshIfNewHolder(id);
  state.unlistedId = id;
  if (!prev || !state.guests.length) state.guests = [{ name, status: '', added: false }];
  else state.guests[0].name = name;
  state.guest = { id, label: name, unlisted: true, max_guests: UNLISTED_MAX_GUESTS };
  renderPlatform();
  updateParty();
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
    go('passengers');
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
  dirty = false;
  local.clearDraft();
  el('guest-search').value = '';
  renderResults([]);
  renderPlatform();
  updateParty();
  updateCta();
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
  state.unlistedId = '';
  changedFrom = '';
  dirty = false;
  el('guest-search').value = '';
  el('unlisted-name').value = '';
  renderResults([]);
  hideWelcome();
  syncForm();
  updateCta();
  el('guest-search').focus();
}

/* ------------------------------------------------------------------ */
/* Stop 1 · Passengers                                                 */
/* ------------------------------------------------------------------ */

let regret = null;
let cards = []; // per guest index: {card, chips:{confirmed,waitlisted,regret}, input, err, group}

function statusGroupLabel(g, n) {
  const name = g.name.trim();
  return name ? `${name}'s status` : `Passenger ${n}'s status`;
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

  let input = null;
  if (g.added) {
    card.classList.add('is-added');
    slot(card, 'name').hidden = true;
    $('.guest-card__name-field', card).hidden = false;
    input = slot(card, 'name-input');
    input.id = `guest-name-${n}`;
    slot(card, 'name-label').htmlFor = input.id;
    input.value = g.name;
    input.setAttribute('aria-describedby', err.id);
    input.addEventListener('input', () => {
      g.name = input.value.slice(0, NAME_MAX);
      group.setAttribute('aria-label', statusGroupLabel(g, n));
      if (card.classList.contains('is-invalid')) recheckCard(g);
      markDirty();
    });
    const remove = $('[data-action="remove"]', card);
    remove.hidden = false;
    remove.setAttribute('aria-label', `Remove passenger ${n}`);
    remove.addEventListener('click', () => removeGuest(g));
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
      regret.handle(chip, () => setStatus(g, 'regret'));
    });
  }
  cards[i] = { card, chips, input, err, group };
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
  markDirty();
}

function addGuest() {
  if (!state.guest || state.guests.length >= maxGuests()) return;
  state.guests.push({ name: '', status: '', added: true });
  renderGuests();
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
  markDirty();
  (el('add-guest').hidden ? el('t-passengers') : el('add-guest')).focus();
  announce(`Passenger ${i + 1} removed.`);
}

/** Errors for one guest: [nameMissing, statusMissing]. */
function guestProblems(g) {
  return [!g.name.trim(), !STATUS_IDS.includes(g.status)];
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

function cardMessage([nameBad, statusBad]) {
  return [nameBad ? 'Add a name for this passenger.' : '', statusBad ? 'Pick Confirmed, Waitlisted or Regret.' : '']
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

function setMode(value) {
  state.travel.mode = value;
  checkChip(el('mode-chips'), value);
  document.body.dataset.mode = value;
  el('mode-error').hidden = true;
  markDirty();
}

function checkRoute(show) {
  const okMode = MODE_IDS.includes(state.travel.mode);
  const okFrom = state.travel.from.trim().length > 0;
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

/** Live "Your stops" board on the departure stop. */
function renderCatches() {
  const list = el('catches');
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

/** Push state into every static control (after a restore or reset). */
function syncForm() {
  const t = state.travel;
  checkChip(el('mode-chips'), t.mode);
  document.body.dataset.mode = t.mode || 'train';
  el('from-city').value = t.from;
  syncSide('arrive');
  syncSide('depart');
  el('note').value = state.note;
  updateCount('note', 'note-count');
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
  for (const s of ['route', 'arrival', 'departure']) if (!CHECKS[s](false)) return s;
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
  saveRecord(payload, res);
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

async function loadHeads() {
  const [a, b] = await Promise.all([
    waitForImage($('#arrival-scene .bobble--a img')),
    waitForImage($('#arrival-scene .bobble--b img')),
  ]);
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

function shareText() {
  const wl = party() === 'waitlisted';
  const line = wl
    ? `On the waitlist for the ${CONFIG.train.name} to ${CONFIG.city} for ${CONFIG.couple.joined}'s wedding. Will confirm soon!`
    : `Booked on the ${CONFIG.train.name} to ${CONFIG.city} for ${CONFIG.couple.joined}'s wedding! 🚂`;
  return `${line} 10–12 Dec 2026.${CONFIG.siteUrl ? `\n${CONFIG.siteUrl}` : ''}`;
}

/** wa.me link to Saumy, or '' when CONFIG.hostWhatsApp isn't set. */
function waLink() {
  const num = String(CONFIG.hostWhatsApp || '').replace(/\D/g, '');
  if (!num || !state.guest) return '';
  const people = state.guests.map((g) => `${g.name.trim()} (${statusLabel(g.status)})`).join(', ');
  let text = `Hi ${CONFIG.couple.a}! ${state.guest.label} here. My ${CONFIG.train.name} ticket is saved. Passengers: ${people}.`;
  const t = state.travel;
  if (!everyoneRegrets() && t.mode) {
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

/* Booking reminders (train only) */

let bookingUrls = [];
let tickTimer = 0;

function countdownText(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `in ${plural(d, 'day')}${h ? ` ${h} h` : ''}`;
  if (h) return `in ${h} h${m ? ` ${m} min` : ''}`;
  return `in ${m} min`;
}

const siteTail = () => (CONFIG.siteUrl ? ` ${CONFIG.siteUrl}` : '');
const legWhere = (leg) => (leg.kind === 'Onward' ? `to ${CONFIG.city}` : `back from ${CONFIG.city}`);

/**
 * Which journeys to remind about (train only).
 * - A known date gives one card. An onward trip that arrives early or in the morning usually
 *   means an overnight train that left the day before, and booking counts from that day.
 * - "Not sure yet" lists every candidate date, so the unsure still hear when windows open.
 * @returns {{kind:'Onward'|'Return', date?:string, arrive?:string, overnight?:boolean, choices?:string[]}[]}
 */
function bookingLegs() {
  const t = state.travel;
  if (everyoneRegrets() || t.mode !== 'train') return [];
  const legs = [];
  if (isValidISODate(t.arrive.date)) {
    const overnight = OVERNIGHT_SLOTS.includes(t.arrive.slot);
    legs.push({ kind: 'Onward', date: overnight ? addDays(t.arrive.date, -1) : t.arrive.date, arrive: t.arrive.date, overnight });
  } else if (t.arrive.date === 'unsure') {
    legs.push({ kind: 'Onward', choices: CONFIG.arriveDates.filter(isValidISODate) });
  }
  if (isValidISODate(t.depart.date)) legs.push({ kind: 'Return', date: t.depart.date });
  else if (t.depart.date === 'unsure') legs.push({ kind: 'Return', choices: CONFIG.departDates.filter(isValidISODate) });
  return legs;
}

function reminderEvent(leg, opens) {
  const journey = formatDate(leg.date);
  const sameDay = leg.overnight ? bookingOpens(leg.arrive) : null;
  return {
    title: `Book your train ${legWhere(leg)} (${leg.overnight ? `boards ${journey}` : journey})`,
    startISO: `${opens.date}T07:50:00+05:30`,
    minutes: 15,
    details: `Train booking for ${journey} opens at 8:00 AM today, 60 days ahead. `
      + 'Long-distance trains open 60 days before they leave their first station, so it may open a day earlier. '
      + (sameDay ? `If your train leaves on ${formatDate(leg.arrive)} itself, booking opens ${sameDay.label} instead. ` : '')
      + `${CONFIG.couple.joined}'s wedding, ${CONFIG.city}.${siteTail()}`,
  };
}

function choicesEvent(leg, rows, next) {
  const windows = rows.map((r) => `${formatDate(r.date)} opens ${r.opens.label}`).join(', ');
  return {
    title: `Book your train ${legWhere(leg)}`,
    startISO: `${next.opens.date}T07:50:00+05:30`,
    minutes: 15,
    details: `Train booking opens 60 days ahead at 8:00 AM: ${windows}. `
      + 'Long-distance trains count from the day they leave their first station, so it may open a day earlier. '
      + `${CONFIG.couple.joined}'s wedding, ${CONFIG.city}.${siteTail()}`,
  };
}

/** Google Calendar link + .ics download for one reminder. */
function fillReminder(card, leg, opensLabel, ev, date) {
  const gcal = slot(card, 'gcal');
  gcal.href = calendarUrl(ev);
  gcal.setAttribute('aria-label', `Add a 7:50 AM reminder on ${opensLabel} for your ${leg.kind.toLowerCase()} train (Google Calendar)`);
  const ics = slot(card, 'ics');
  const kind = leg.kind.toLowerCase();
  const url = URL.createObjectURL(new Blob([icsText({ uid: `stt-${state.guest.id}-${kind}-${date}@shaadi-express`, ...ev })], { type: 'text/calendar' }));
  bookingUrls.push(url);
  ics.href = url;
  ics.download = `book-train-${kind}-${date}.ics`;
}

function bookingCard(st, date) {
  const card = tpl('tpl-booking');
  card.dataset.state = st;
  card.dataset.date = date;
  const irctc = slot(card, 'irctc');
  if (irctc) irctc.href = IRCTC_URL;
  return card;
}

/** One known journey date. */
function dateCard(leg, now) {
  const opens = bookingOpens(leg.date);
  const st = bookingStatus(leg.date, now);
  if (!opens || !st) return null;
  const card = bookingCard(st.state, leg.date);
  slot(card, 'leg').textContent = leg.overnight ? `${leg.kind} · boards ~${formatDate(leg.date)}` : `${leg.kind} · ${formatDate(leg.date)}`;
  slot(card, 'opens-verb').textContent = st.state === 'open' ? 'Opened' : 'Opens';
  slot(card, 'opens').textContent = `${opens.label}, 8:00 AM`;
  slot(card, 'countdown').textContent = st.state === 'upcoming' ? countdownText(st.msUntil) : '';
  if (leg.overnight) {
    const sameDay = bookingOpens(leg.arrive);
    const note = slot(card, 'note');
    note.textContent = `Arriving early on ${formatDate(leg.arrive)} usually means an overnight train that leaves the day before. `
      + `If yours leaves on ${formatDate(leg.arrive)} itself, booking opens ${sameDay.label} instead.`;
    note.hidden = false;
  }
  fillReminder(card, leg, opens.label, reminderEvent(leg, opens), leg.date);
  return card;
}

/** "Not sure yet": every candidate date with its window, and a reminder for the next one. */
function choicesCard(leg, now) {
  const rows = leg.choices
    .map((date) => ({ date, opens: bookingOpens(date), st: bookingStatus(date, now) }))
    .filter((r) => r.opens && r.st);
  if (!rows.length) return null;
  const next = rows.find((r) => r.st.state === 'upcoming');
  const card = bookingCard(next ? 'upcoming' : 'open', next ? next.date : rows[rows.length - 1].date);
  slot(card, 'leg').textContent = `${leg.kind} · date not fixed yet`;
  if (next && rows.some((r) => r.st.state === 'open')) {
    // Some dates can already be booked: keep the IRCTC link visible next to the reminder.
    card.dataset.anyOpen = 'true';
    slot(card, 'open-now').querySelector('p').textContent = 'Some of these dates are open now.';
  }
  if (next) {
    slot(card, 'opens-verb').textContent = 'Next window opens';
    slot(card, 'opens').textContent = `${next.opens.label}, 8:00 AM`;
    slot(card, 'countdown').textContent = countdownText(next.st.msUntil);
  } else {
    slot(card, 'opens-verb').textContent = 'Opened';
    slot(card, 'opens').textContent = `${rows[0].opens.label} to ${rows[rows.length - 1].opens.label}`;
  }
  const list = slot(card, 'dates');
  for (const r of rows) {
    const li = document.createElement('li');
    li.dataset.state = r.st.state;
    const when = document.createElement('span');
    when.textContent = formatDate(r.date);
    const opensAt = document.createElement('span');
    opensAt.textContent = r.st.state === 'open' ? 'open now' : `opens ${r.opens.label}`;
    li.append(when, opensAt);
    list.appendChild(li);
  }
  list.hidden = false;
  const note = slot(card, 'note');
  note.textContent = 'Pick your date and book on the morning its window opens.';
  note.hidden = false;
  if (next) fillReminder(card, leg, next.opens.label, choicesEvent(leg, rows, next), next.date);
  return card;
}

function renderBooking() {
  for (const u of bookingUrls) URL.revokeObjectURL(u);
  bookingUrls = [];
  const list = el('booking-list');
  list.replaceChildren();
  const now = Date.now();
  for (const leg of bookingLegs()) {
    const card = leg.choices ? choicesCard(leg, now) : dateCard(leg, now);
    if (card) list.appendChild(card);
  }
  el('booking').hidden = list.children.length === 0;
}

function tickBooking() {
  const now = Date.now();
  for (const card of Array.from(el('booking-list').children)) {
    const st = bookingStatus(card.dataset.date, now);
    if (!st) continue;
    if (st.state !== card.dataset.state) { renderBooking(); return; }
    if (st.state === 'upcoming') slot(card, 'countdown').textContent = countdownText(st.msUntil);
  }
}
function startTicking() {
  stopTicking();
  tickTimer = setInterval(tickBooking, 30000);
}
function stopTicking() {
  clearInterval(tickTimer);
  tickTimer = 0;
}

/* Leave kit */

let leaveKind = 'formal';
let currentMail = { subject: '', body: '' };

function renderLeave() {
  const t = state.travel;
  const arrive = t.arrive.date || 'unsure';
  const depart = t.depart.date || 'unsure';
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
  renderBooking();
  renderLeave();
  startTicking();
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
    saveRecord(payload, res);
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

/** Pick up any change to max_guests made in the Sheet since this ticket was saved. */
function refreshGuest() {
  const g = state.guest;
  if (!g || g.unlisted) return;
  getGuest(g.id).then((fresh) => {
    if (!fresh || !state.guest || state.guest.id !== fresh.id) return;
    state.guest.max_guests = Math.max(fresh.max_guests, state.guests.length);
    if (state.stop === 'passengers') renderAddGuest();
  }).catch(() => { /* offline: keep what we have */ });
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

function swapHeads() {
  if (document.body.dataset.heads !== 'png') return;
  for (const img of $$('img[data-head]')) {
    const svg = img.src;
    img.onerror = () => { img.onerror = null; img.src = svg; };
    img.src = img.dataset.png;
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
  el('welcome-view-pass').addEventListener('click', () => {
    const r = local.load();
    if (!r || !loadRecord(r)) { resetAll(); return; }
    hideWelcome();
    go(everyoneRegrets() ? 'regret-end' : 'junction', { nav: 'push' });
  });
  el('welcome-edit').addEventListener('click', () => {
    const r = local.load();
    if (!r || !loadRecord(r)) { resetAll(); return; }
    startEdit();
  });
  el('welcome-reset').addEventListener('click', resetAll);

  // Passengers
  el('add-guest').addEventListener('click', addGuest);

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
  el('note').addEventListener('input', () => {
    state.note = el('note').value.slice(0, NOTE_MAX);
    updateCount('note', 'note-count');
    markDirty();
  });

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
    state.note = draft.note;
    state.unlistedId = draft.unlistedId || (draft.guest.unlisted ? draft.guest.id : '');
    dirty = true;
    syncForm();
    go(draft.stop, { focus: false, say: false, nav: 'replace' });
    return;
  }
  if (record && (!gParam || record.id === gParam)) {
    showWelcome(record);
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
  for (const id of ['search-results', 'guest-list', 'catches', 'booking-list']) el(id).replaceChildren();
  swapHeads();
  bind();
  syncForm();
  for (const group of $$('[role="radiogroup"]')) rove(group);
  updateCta();
  restore().catch(() => { /* never leave the platform stuck */ });
  scheduleBaajaNudge();
}

boot();

// Rajasthan long-weekend map (spec v3 §M).
//
//   import { mountTrip } from './trip.js';
//   import { ORIGIN, DESTINATIONS } from './trip-data.js';
//   const trip = mountTrip(el, { origin: ORIGIN, destinations: DESTINATIONS });
//
// It renders a ticket into `el`: a route map (inline SVG), a row of destination chips and a
// stub that shows the selected escape (aria-live). Tap a pin, its label or a chip to select;
// a dashed railway line then draws itself from Bhilwara with a tiny engine riding the tip.
//
// Geometry: an equirectangular projection with cos(mid-latitude) x-scaling. By default it is
// fitted to the pins' bounds; on a phone the whole state would squeeze Kumbhalgarh and
// Ranakpur (12 km apart) into one 4px blob. When js/rajasthan-outline.js supplies OUTLINE,
// its border is drawn through that view (paper dots and a soft tint band stay inside the state,
// so the neighbours recede) with a small whole-state locator in the corner that marks Bhilwara,
// and `fit: 'outline'` fits the map to the outline's bbox instead. With no OUTLINE, a plainly
// decorative rounded frame (degree grid, compass, scale bar) stands in. Nothing is guessed.
//
// Name labels keep clear of pins, each other and the map furniture, stay off the state border
// (or get a small paper backing where they can't), keep out of the stretch where their own
// railway comes in, and always sit clearly nearer their own marigold than any other.
//
// Options: { origin, destinations, outline = OUTLINE, fit = 'points' | 'outline', reducedMotion }
// Returns: { select(id), clear(), relayout(), destroy(), get selected() }
//
// Text goes in with textContent only. Safe to mount while hidden (display: none): labels are
// re-measured once the map gets a size.

import { OUTLINE } from './rajasthan-outline.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 340;              // viewBox width: about 1 unit per CSS px on a 375px phone
const PIN_R = 7;            // marigold radius
const LABEL_FS = 13;        // name labels, in map units
const HIT_PX = 22;          // tap radius in CSS px, so every pin gets a 44px target
const MIN_SEP = 15;         // pins closer than this are nudged apart (display only)
const KM_PER_DEG = 111.32;  // km per degree of latitude
const PAD_POINTS = { t: 48, r: 30, b: 42, l: 30 };
const PAD_OUTLINE = { t: 16, r: 16, b: 16, l: 16 };
// Label placement costs, in the same units as box overlap (a label sitting on a pin costs ~250)
const BORDER_COST = 140;    // the state border runs under the label (it then gets a paper backing)
const BORDER_VERTEX = 2;    // ...plus this per border vertex, so a shorter crossing wins
const APPROACH_COST = 30;   // per sample of the place's own incoming railway under its label
const AMBIGUOUS_COST = 400; // the label isn't clearly nearer its own pin than another, so it may read as that one's
const AMBIGUOUS_GAP = 4;    // "clearly nearer": by at least this many map units
const LOCATOR = 66;         // whole-state inset, map units
let instances = 0;

/* Pure helpers (exported for tests and app.js) ------------------------------------------- */

/** "~2h 45m" -> "about 2 hours 45 minutes" (screen-reader friendly). */
export function spokenDrive(drive) {
  const s = String(drive ?? '');
  const h = /(\d+)\s*h/i.exec(s);
  const m = /(\d+)\s*m/i.exec(h ? s.slice(h.index + h[0].length) : s);
  const parts = [];
  if (h) parts.push(`${h[1]} ${h[1] === '1' ? 'hour' : 'hours'}`);
  if (m) parts.push(`${m[1]} ${m[1] === '1' ? 'minute' : 'minutes'}`);
  if (!parts.length) return s;
  return (/^\s*(~|about|approx)/i.test(s) ? 'about ' : '') + parts.join(' ');
}

/** Accessible name for a pin, e.g. "Udaipur, 150 km, about 2 hours 45 minutes by car". */
export const pinLabel = (d) => `${d.name}, ${d.km} km, ${spokenDrive(d.drive)} by car`;

/** Google Maps driving directions, e.g. origin=Bhilwara,Rajasthan&destination=Mount%20Abu,Rajasthan. */
export const directionsUrl = (from, to) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)},Rajasthan&destination=${encodeURIComponent(to)},Rajasthan`;

/**
 * Equirectangular projection fitted to bbox [minLon, minLat, maxLon, maxLat] inside a map that
 * is `width` units wide (height follows). x is scaled by cos(mid-latitude) so shapes keep their
 * proportions; 1 degree of latitude is k units.
 */
export function fitProjection(bbox, pad, width = W) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const cos = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const k = (width - pad.l - pad.r) / ((maxLon - minLon) * cos || 1);
  const height = Math.ceil(pad.t + pad.b + (maxLat - minLat) * k);
  return {
    width, height, k, cos,
    x: (lon) => pad.l + (lon - minLon) * cos * k,
    y: (lat) => pad.t + (maxLat - lat) * k,
    lon: (x) => minLon + (x - pad.l) / (cos * k),
    lat: (y) => maxLat - (y - pad.t) / k,
    // Maps OUTLINE.d (x = lon, y = -lat) into map units.
    matrix: [cos * k, 0, 0, k, pad.l - minLon * cos * k, pad.t + maxLat * k],
  };
}

/**
 * Nudges points that would overlap apart along the line between them, a few units at most
 * (Kumbhalgarh and Ranakpur are 12 km apart: about 2.5 km of nudge each at phone scale).
 * Mutates p.x / p.y; lat/lon stay true.
 */
export function declutter(pts, minSep) {
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i];
        const b = pts[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= minSep) continue;
        const ux = d ? dx / d : 1;
        const uy = d ? dy / d : 0;
        const push = (minSep - d) / 2 + 0.01;
        a.x -= ux * push; a.y -= uy * push;
        b.x += ux * push; b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return pts;
}

/** The outline's vertices as [lon, lat] pairs (its path is "M lon,-lat L lon,-lat ..."). */
export function outlinePoints(d) {
  const nums = String(d ?? '').match(/-?\d+(?:\.\d+)?/g) || [];
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([Number(nums[i]), -Number(nums[i + 1])]);
  return pts;
}

const boundsOf = (pts) => [
  Math.min(...pts.map((p) => p.lon)), Math.min(...pts.map((p) => p.lat)),
  Math.max(...pts.map((p) => p.lon)), Math.max(...pts.map((p) => p.lat)),
];

/* DOM helpers ------------------------------------------------------------------------------ */

const r1 = (n) => Math.round(n * 10) / 10;

function s(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}

function h(tag, attrs, parent, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  if (parent) parent.append(n);
  return n;
}

const box = (x, y, w, hgt) => ({ x, y, w, h: hgt });
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const outside = (b, area) => b.w * b.h - overlap(b, area);

// Fallback label spots, tried after the data's preferred one.
const SPOTS = [
  { dx: 11, dy: 4.5, anchor: 'start' },
  { dx: -11, dy: 4.5, anchor: 'end' },
  { dx: 0, dy: -12, anchor: 'middle' },
  { dx: 0, dy: 21, anchor: 'middle' },
  { dx: 8, dy: -10, anchor: 'start' },
  { dx: -8, dy: -10, anchor: 'end' },
  { dx: 8, dy: 18, anchor: 'start' },
  { dx: -8, dy: 18, anchor: 'end' },
];

/* Component -------------------------------------------------------------------------------- */

export function mountTrip(container, { origin, destinations, outline = OUTLINE, fit = 'points', reducedMotion } = {}) {
  if (!container || !origin || !Array.isArray(destinations)) throw new Error('mountTrip: container, origin and destinations are required');
  const uid = `trip${++instances}`;
  const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const still = () => reducedMotion ?? Boolean(motionQuery?.matches);

  const hasOutline = Boolean(outline && typeof outline.d === 'string' && Array.isArray(outline.bbox) && outline.bbox.length === 4);
  const fitOutline = hasOutline && fit === 'outline';
  const places = destinations.map((d) => ({ ...d, pref: d.label }));
  const byId = new Map(places.map((p) => [p.id, p]));
  const proj = fitOutline
    ? fitProjection(outline.bbox, PAD_OUTLINE)
    : fitProjection(boundsOf([origin, ...places]), PAD_POINTS);
  const H = proj.height;
  const home = { x: proj.x(origin.lon), y: proj.y(origin.lat) };
  // The state border in map units (only the stretch inside the map): labels keep off it
  const borderPts = hasOutline
    ? outlinePoints(outline.d).map(([lon, lat]) => ({ x: proj.x(lon), y: proj.y(lat) }))
      .filter((q) => q.x > -20 && q.x < W + 20 && q.y > -20 && q.y < H + 20)
    : [];
  for (const p of places) { p.x = proj.x(p.lon); p.y = proj.y(p.lat); }
  declutter(places, MIN_SEP);
  // Where each railway comes in: a fan around the direction of Bhilwara, as wide as the arc's bow
  // can turn it (about 26 degrees either way), for the last 40 units before the pin
  for (const p of places) {
    const a = Math.atan2(home.y - p.y, home.x - p.x);
    p.approach = [];
    for (const da of [-0.45, -0.22, 0, 0.22, 0.45]) {
      for (const r of [11, 18, 25, 32, 40]) p.approach.push({ x: p.x + Math.cos(a + da) * r, y: p.y + Math.sin(a + da) * r });
    }
  }

  container.classList.add('trip');
  container.classList.toggle('trip--still', reducedMotion === true);
  container.replaceChildren();

  /* Ticket shell */
  const card = h('div', { class: 'trip__card' }, container);
  const top = h('div', { class: 'trip__top' }, card);
  const strip = h('p', { class: 'trip__strip', 'aria-hidden': 'true' }, top);
  h('span', null, strip, 'Weekend escapes');
  h('span', null, strip, `From ${origin.name}`);
  const mapWrap = h('div', { class: 'trip__map-wrap' }, top);

  /* Map */
  const map = s('svg', {
    class: 'trip__map', viewBox: `0 0 ${W} ${H}`, role: 'group', focusable: 'false',
    'aria-label': `Map of ${places.length} weekend escapes by road from ${origin.name}`,
  }, mapWrap);
  const defs = s('defs', null, map);
  const dots = s('pattern', { id: `${uid}-dots`, width: 7, height: 7, patternUnits: 'userSpaceOnUse' }, defs);
  s('circle', { class: 'trip__dot', cx: 1.5, cy: 1.5, r: 0.7 }, dots);
  const frame = { x: 3, y: 3, w: W - 6, h: H - 6 };
  const outlineMatrix = `matrix(${proj.matrix.map((n) => +n.toFixed(4)).join(' ')})`;
  const clip = s('clipPath', { id: `${uid}-clip` }, defs);
  if (fitOutline) s('path', { d: outline.d, transform: outlineMatrix }, clip);
  else s('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: 14 }, clip);
  // Rajasthan itself, for the dotted paper and the tint band just inside the border
  if (hasOutline) s('path', { d: outline.d, transform: outlineMatrix }, s('clipPath', { id: `${uid}-land` }, defs));
  const mask = s('mask', { id: `${uid}-reveal`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, defs);
  const reveal = s('path', { class: 'trip__reveal', fill: 'none', stroke: '#fff', 'stroke-width': 14 }, mask);

  const bg = s('g', { class: 'trip__bg', 'aria-hidden': 'true' }, map);
  const obstacles = [];
  if (fitOutline) {
    s('path', { class: 'trip__land', d: outline.d, transform: outlineMatrix }, bg);
  } else {
    s('rect', { class: hasOutline ? 'trip__frame trip__frame--sea' : 'trip__frame', x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: 14 }, bg);
  }
  const inner = s('g', { 'clip-path': `url(#${uid}-clip)` }, bg);
  if (hasOutline && !fitOutline) s('path', { class: 'trip__land', d: outline.d, transform: outlineMatrix }, inner);
  // With the real outline the paper dots stay on Rajasthan, so the neighbouring states recede
  const onLand = hasOutline ? s('g', { 'clip-path': `url(#${uid}-land)` }, inner) : inner;
  s('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${uid}-dots)` }, onLand);
  drawGraticule(inner, bg);
  if (hasOutline) {
    // A soft rani band just inside the border, as on old political maps, then the dash-dot line
    s('path', { class: 'trip__border-band', d: outline.d, transform: outlineMatrix, fill: 'none' }, onLand);
    s('path', { class: 'trip__border', d: outline.d, transform: outlineMatrix }, inner);
  }
  if (!fitOutline) {
    s('rect', { class: 'trip__rule', x: frame.x + 5, y: frame.y + 5, width: frame.w - 10, height: frame.h - 10, rx: 10 }, bg);
    s('rect', { class: 'trip__edge', x: frame.x, y: frame.y, width: frame.w, height: frame.h, rx: 14 }, bg);
  }
  const locator = hasOutline && !fitOutline ? drawLocator(bg) : null;
  drawCompass(bg, locator ? 98 : 27, 27);
  drawScale(bg);
  if (!fitOutline) drawCartouche(bg);

  /* Route (masked so it can draw itself), engine (moved under the home board below), home, pins, labels */
  const routeG = s('g', { class: 'trip__route', mask: `url(#${uid}-reveal)`, 'aria-hidden': 'true' }, map);
  const rail = s('path', { class: 'trip__rail' }, routeG);
  const ties = s('path', { class: 'trip__ties' }, routeG);

  const homeG = s('g', { class: 'trip__home', 'aria-hidden': 'true', transform: `translate(${r1(home.x)} ${r1(home.y)})` }, map);
  const board = drawHome(homeG);

  const pinsG = s('g', { class: 'trip__pins' }, map);
  for (const p of places) {
    const a = s('a', {
      class: 'trip__pin', role: 'button', tabindex: 0, 'data-id': p.id,
      'aria-label': pinLabel(p), 'aria-pressed': 'false', transform: `translate(${r1(p.x)} ${r1(p.y)})`,
    }, pinsG);
    p.hit = s('circle', { class: 'trip__hit', r: HIT_PX }, a);
    s('circle', { class: 'trip__ring', r: 13 }, a);
    s('circle', { class: 'trip__sel', r: 10.5 }, a);
    const bloom = s('g', { class: 'trip__bloom' }, a);
    s('circle', { class: 'trip__shadow', cy: 1.3, r: PIN_R }, bloom);
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2;
      s('circle', { class: 'trip__petal', cx: r1(Math.cos(t) * 4.3), cy: r1(Math.sin(t) * 4.3), r: 2.75 }, bloom);
    }
    s('circle', { class: 'trip__core', r: 3.7 }, bloom);
    s('circle', { class: 'trip__eye', r: 1.6 }, bloom);
    p.pin = a;
  }

  const ghostG = s('g', { class: 'trip__ghost', 'aria-hidden': 'true' }, map);
  const engine = s('g', { class: 'trip__engine', 'aria-hidden': 'true' }, map);
  const engineTurn = s('g', null, engine);
  const engineBody = s('g', { transform: 'translate(0 -4.2)' }, engineTurn);
  s('rect', { class: 'trip__engine-cab', x: -8.5, y: -7, width: 6, height: 8.6, rx: 1.2 }, engineBody);
  s('rect', { class: 'trip__engine-boiler', x: -3, y: -3.8, width: 10.5, height: 5.4, rx: 2.7 }, engineBody);
  s('rect', { class: 'trip__engine-stack', x: 3.6, y: -7.6, width: 2.6, height: 4.4, rx: 0.7 }, engineBody);
  for (const cx of [-5.5, -0.6, 4.3]) s('circle', { class: 'trip__engine-wheel', cx, cy: 2.6, r: 1.9 }, engineBody);
  // Under the BHILWARA board, like the rail: a northbound train (Pushkar, Jaipur) pulls out from
  // behind the board instead of driving across its name
  map.insertBefore(engine, homeG);

  const labelsG = s('g', { class: 'trip__labels', 'aria-hidden': 'true' }, map);
  const backsG = s('g', { class: 'trip__backs' }, labelsG); // paper backings for labels over the border
  const plate = s('rect', { class: 'trip__plate', rx: 3 }, labelsG);
  for (const p of places) {
    p.text = s('text', { class: 'trip__label', 'data-id': p.id }, labelsG);
    p.text.textContent = p.name;
  }

  /* Chips */
  const pick = h('div', { class: 'trip__pick' }, top);
  h('p', { class: 'trip__pick-label', id: `${uid}-pick` }, pick, 'Or pick a name · nearest first');
  const chips = h('div', { class: 'trip__chips', role: 'group', 'aria-labelledby': `${uid}-pick` }, pick);
  for (const p of [...places].sort((a, b) => a.km - b.km || a.name.localeCompare(b.name))) {
    p.chip = h('button', { class: 'trip__chip', type: 'button', 'aria-pressed': 'false', 'data-id': p.id }, chips);
    h('span', { class: 'trip__chip-name' }, p.chip, p.name);
    h('span', { class: 'trip__chip-km' }, p.chip, `${p.km} km`);
  }

  /* Stub: the selected escape */
  const stub = h('div', { class: 'trip__stub' }, card);
  const info = h('div', { class: 'trip__info', 'aria-live': 'polite', 'aria-atomic': 'true' }, stub);
  renderEmpty();

  /* Layout: labels avoid pins, each other, the board, compass and scale ------------------- */

  let measured = false;
  function textWidth(el, text, fs) {
    let w = 0;
    try { w = el.getComputedTextLength(); } catch { /* not rendered yet */ }
    return w > 0 ? w : text.length * fs * 0.54;
  }

  function layoutLabels() {
    measured = map.getBoundingClientRect().width > 0;
    const blocked = [...obstacles, ...board.boxes()];
    for (const p of places) blocked.push(box(p.x - PIN_R - 1.5, p.y - PIN_R - 1.5, 2 * PIN_R + 3, 2 * PIN_R + 3));
    const area = box(frame.x + 6, frame.y + 6, frame.w - 12, frame.h - 12);
    const placed = [];
    const within = (q, b, m = 0) => q.x > b.x - m && q.x < b.x + b.w + m && q.y > b.y - m && q.y < b.y + b.h + m;
    const gapTo = (b, q) => Math.hypot(Math.max(0, b.x - q.x, q.x - (b.x + b.w)), Math.max(0, b.y - q.y, q.y - (b.y + b.h)));
    backsG.replaceChildren();
    for (const p of places) {
      const w = textWidth(p.text, p.name, LABEL_FS) + 4;
      let best = null;
      for (const c of [p.pref, ...SPOTS].filter(Boolean)) {
        const bx = p.x + c.dx - (c.anchor === 'end' ? w - 2 : c.anchor === 'middle' ? w / 2 : 2);
        const b = box(bx, p.y + c.dy - LABEL_FS * 0.78, w, LABEL_FS * 1.02);
        let cost = outside(b, area) * 6;
        for (const o of blocked) cost += overlap(b, o);
        for (const o of placed) cost += overlap(b, o) * 3;
        const crossings = borderPts.filter((q) => within(q, b, 1)).length;
        if (crossings) cost += BORDER_COST + crossings * BORDER_VERTEX;
        // Keep off the stretch where this place's own railway comes in
        for (const q of p.approach) if (within(q, b)) cost += APPROACH_COST;
        // A name must sit clearly nearer its own marigold than any other, or it names the wrong place
        const own = gapTo(b, p);
        if (places.some((q) => q !== p && gapTo(b, q) < own + AMBIGUOUS_GAP)) cost += AMBIGUOUS_COST;
        if (!best || cost < best.cost - 0.01) best = { c, b, cost, crossings };
        if (cost === 0) break;
      }
      p.text.setAttribute('x', r1(p.x + best.c.dx));
      p.text.setAttribute('y', r1(p.y + best.c.dy));
      p.text.setAttribute('text-anchor', best.c.anchor);
      p.box = best.b;
      p.labelCost = best.cost;
      placed.push(best.b);
      // Where the border can't be avoided, the name gets a paper backing and the border runs behind it
      if (best.crossings) {
        s('rect', { class: 'trip__back', x: r1(best.b.x - 1.5), y: r1(best.b.y - 1), width: r1(best.b.w + 3), height: r1(best.b.h + 2), rx: 3, fill: '#F7DCB8' }, backsG);
      }
    }
    placePlate();
  }

  function placePlate() {
    const b = current?.box;
    plate.classList.toggle('is-on', Boolean(b));
    if (!b) return;
    plate.setAttribute('x', r1(b.x - 2));
    plate.setAttribute('y', r1(b.y - 1.5));
    plate.setAttribute('width', r1(b.w + 4));
    plate.setAttribute('height', r1(b.h + 3));
  }

  /* Hit targets: at least 44 CSS px, whatever the map's rendered size */
  let hitR = HIT_PX;
  function sizeHits() {
    const px = map.getBoundingClientRect().width;
    if (!px) return;
    hitR = HIT_PX * (W / px);
    for (const p of places) p.hit.setAttribute('r', r1(hitR));
  }

  function relayout() {
    sizeHits();
    layoutLabels();
  }

  /* Selection ------------------------------------------------------------------------------ */

  let current = null;
  let raf = 0;

  function select(id, { via = 'api' } = {}) {
    const p = byId.get(id);
    if (!p) return;
    current = p;
    for (const q of places) {
      const on = q === p;
      q.pin.classList.toggle('is-selected', on);
      q.pin.classList.remove('is-arrived');
      q.pin.setAttribute('aria-pressed', String(on));
      q.text.classList.toggle('is-selected', on);
      q.chip.setAttribute('aria-pressed', String(on));
    }
    // Show the selected marigold above its neighbours (Kumbhalgarh and Ranakpur touch) with an
    // inert copy in the top layer. Moving the real pin would drop keyboard focus and reshuffle
    // the tab order.
    const ghost = s('g', { class: 'trip__pin trip__pin--ghost is-selected', transform: p.pin.getAttribute('transform') });
    for (const part of p.pin.querySelectorAll('.trip__sel, .trip__bloom')) ghost.append(part.cloneNode(true));
    ghostG.replaceChildren(ghost);
    placePlate();
    renderCard(p);
    if (via === 'chip') bringMapIntoView();
    drawRoute(p, via !== 'api');
  }

  function clear() {
    current = null;
    cancelAnimationFrame(raf);
    for (const q of places) {
      q.pin.classList.remove('is-selected', 'is-arrived');
      q.pin.setAttribute('aria-pressed', 'false');
      q.text.classList.remove('is-selected');
      q.chip.setAttribute('aria-pressed', 'false');
    }
    routeG.classList.remove('is-on');
    engine.classList.remove('is-running');
    engine.style.opacity = '';
    ghostG.replaceChildren();
    placePlate();
    renderEmpty();
  }

  function renderEmpty() {
    info.replaceChildren();
    h('p', { class: 'trip__kicker' }, info, `${origin.name} → ?`);
    h('p', { class: 'trip__name' }, info, 'Where to next?');
    h('p', { class: 'trip__note' }, info, "Tap a pin or a name to see how far it is, how long the drive takes and why it's worth it.");
  }

  function renderCard(p) {
    info.replaceChildren();
    h('p', { class: 'trip__kicker' }, info, `${origin.name} → ${p.name}`);
    h('p', { class: 'trip__name' }, info, p.name);
    const meta = h('p', { class: 'trip__meta' }, info);
    h('strong', null, meta, `${p.km} km · ${p.drive} by car`);
    meta.append(` from ${origin.name}`);
    h('p', { class: 'trip__note' }, info, p.note);
    const a = h('a', {
      class: 'btn btn--secondary btn--small trip__dir',
      href: directionsUrl(origin.name, p.name), target: '_blank', rel: 'noopener',
    }, info);
    a.append(`Directions from ${origin.name}`);
    h('span', { class: 'sr-only' }, a, ' (opens in a new tab)');
    const icon = s('svg', { class: 'trip__dir-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' }, a);
    s('path', { d: 'M6 3h7v7M13 3 4 12', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, icon);
  }

  // A gentle arc from Bhilwara, bowing upward (or east, for a north-south hop) unless that would
  // run the rail over other pins, name labels, the BHILWARA board (it would read as if the line
  // stops there) or the map furniture: then the flatter or opposite bow that does least harm wins.
  // A pin costs most, then a label; the board and furniture only break ties (a northbound line
  // can't help starting under the board).
  function routePath(p) {
    const dx = p.x - home.x;
    const dy = p.y - home.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (ny > 0.05 || (Math.abs(ny) <= 0.05 && nx < 0)) { nx = -nx; ny = -ny; }
    const mx = (home.x + p.x) / 2;
    const my = (home.y + p.y) / 2;
    const others = places.filter((q) => q !== p);
    const labels = places.map((q) => q.box).filter(Boolean);
    const furniture = [...board.boxes().slice(0, 2), ...obstacles];
    const inside = (b, x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    let best = null;
    for (const [side, size] of [[1, 0.24], [1, 0.12], [-1, 0.24], [-1, 0.12], [1, 0.05], [-1, 0.05]]) {
      const c = { x: mx + side * nx * size * len, y: my + side * ny * size * len };
      let hits = 0;
      for (let i = 2; i <= 18; i++) {
        const t = i / 20;
        const u = 1 - t;
        const x = u * u * home.x + 2 * u * t * c.x + t * t * p.x;
        const y = u * u * home.y + 2 * u * t * c.y + t * t * p.y;
        for (const q of others) if (Math.hypot(q.x - x, q.y - y) < PIN_R + 4) hits += 4;
        for (const b of labels) if (inside(b, x, y)) hits += 2;
        for (const b of furniture) if (inside(b, x, y)) hits += 1;
      }
      if (!best || hits < best.hits) best = { c, hits };
      if (hits === 0) break;
    }
    return `M${r1(home.x)} ${r1(home.y)} Q${r1(best.c.x)} ${r1(best.c.y)} ${r1(p.x)} ${r1(p.y)}`;
  }

  function drawRoute(p, userInitiated) {
    cancelAnimationFrame(raf);
    const d = routePath(p);
    for (const el of [rail, ties, reveal]) el.setAttribute('d', d);
    routeG.classList.add('is-on');
    let L = 0;
    try { L = reveal.getTotalLength(); } catch { /* not rendered */ }
    if (!L || still()) {
      reveal.removeAttribute('stroke-dasharray');
      reveal.removeAttribute('stroke-dashoffset');
      engine.classList.remove('is-running');
      if (userInitiated) bringCardIntoView(p);
      return;
    }
    reveal.setAttribute('stroke-dasharray', `${r1(L + 1)} ${r1(L + 1)}`);
    reveal.setAttribute('stroke-dashoffset', r1(L + 1));
    engine.style.opacity = '';
    engine.classList.add('is-running');
    const dur = Math.min(1500, Math.max(750, 520 + L * 3.4));
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const at = L * e;
      reveal.setAttribute('stroke-dashoffset', r1(L + 1 - at));
      const a = reveal.getPointAtLength(Math.max(0, at - 0.6));
      const b = reveal.getPointAtLength(Math.min(L, at + 0.6));
      const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const pt = reveal.getPointAtLength(at);
      const flip = Math.abs(deg) > 90;
      engine.setAttribute('transform', `translate(${r1(pt.x)} ${r1(pt.y)})`);
      engineTurn.setAttribute('transform', flip ? `rotate(${r1(deg + 180)}) scale(-1 1)` : `rotate(${r1(deg)})`);
      // Fade out on the final approach so the engine never sits on top of the destination pin.
      engine.style.opacity = t > 0.78 ? String(Math.max(0, (1 - t) / 0.22).toFixed(2)) : '';
      if (t < 1) { raf = requestAnimationFrame(step); return; }
      reveal.removeAttribute('stroke-dasharray');
      reveal.removeAttribute('stroke-dashoffset');
      engine.classList.remove('is-running');
      engine.style.opacity = '';
      p.pin.classList.add('is-arrived');
      ghostG.firstElementChild?.classList.add('is-arrived');
      if (userInitiated) bringCardIntoView(p);
    };
    raf = requestAnimationFrame(step);
  }

  // The page's sticky header covers the top of the viewport; html's scroll-padding-top says by how much.
  function topPad() {
    try { return parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0; } catch { return 0; }
  }

  // A chip sits below the map, so after a chip tap the map may be scrolled up under the sticky
  // header. Bring it back first, so the railway is seen drawing itself to the chosen pin.
  function bringMapIntoView() {
    const hidden = topPad() - map.getBoundingClientRect().top;
    if (hidden > 40) window.scrollBy({ top: -hidden, behavior: still() ? 'instant' : 'smooth' });
  }

  // After a selection, if the stub is out of sight below, scroll just far enough to show its
  // name and distance line (about 220px of it), but never so far that the chosen pin or its
  // label slides under the sticky header.
  function bringCardIntoView(p) {
    const r = stub.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const want = Math.min(220, r.height);
    let by = r.top - (vh - want);
    if (p) {
      const top = Math.min(p.pin.querySelector('.trip__bloom').getBoundingClientRect().top, p.text.getBoundingClientRect().top);
      by = Math.min(by, top - (topPad() + 8));
    }
    if (by > 0) window.scrollBy({ top: by, behavior: still() ? 'instant' : 'smooth' });
  }

  /* Events --------------------------------------------------------------------------------- */

  function toMap(clientX, clientY) {
    const ctm = map.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  }

  function onMapClick(e) {
    const label = e.target.closest?.('.trip__label');
    if (label) { select(label.dataset.id, { via: 'map' }); return; }
    const pinEl = e.target.closest?.('.trip__pin');
    // Keyboard and screen-reader clicks carry no useful coordinates: trust the element.
    if (pinEl && e.detail === 0) { select(pinEl.dataset.id, { via: 'map' }); return; }
    const pt = toMap(e.clientX, e.clientY);
    let best = null;
    let bestD = Infinity;
    if (pt) {
      for (const p of places) {
        const dist = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (dist < bestD) { bestD = dist; best = p; }
      }
    }
    // Touching pins (Kumbhalgarh and Ranakpur): the nearest centre wins, not the top layer.
    if (best && bestD <= hitR) select(best.id, { via: 'map' });
    else if (pinEl) select(pinEl.dataset.id, { via: 'map' });
  }

  function onPinKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const pinEl = e.target.closest?.('.trip__pin');
    if (!pinEl) return;
    e.preventDefault();
    select(pinEl.dataset.id, { via: 'map' });
  }

  function onChip(e) {
    const chip = e.target.closest?.('.trip__chip');
    if (chip) select(chip.dataset.id, { via: 'chip' });
  }

  map.addEventListener('click', onMapClick);
  pinsG.addEventListener('keydown', onPinKey);
  chips.addEventListener('click', onChip);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const was = measured;
    sizeHits();
    if (!was && map.getBoundingClientRect().width > 0) layoutLabels();
  }) : null;
  ro?.observe(map);
  const fontsDone = () => { if (map.isConnected) relayout(); };
  document.fonts?.ready?.then(fontsDone);
  document.fonts?.addEventListener?.('loadingdone', fontsDone);

  relayout();

  return {
    select: (id) => select(id),
    clear,
    relayout,
    destroy() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', fontsDone);
      map.removeEventListener('click', onMapClick);
      pinsG.removeEventListener('keydown', onPinKey);
      chips.removeEventListener('click', onChip);
      container.replaceChildren();
      container.classList.remove('trip', 'trip--still');
    },
    get selected() { return current?.id ?? null; },
  };

  /* Map furniture -------------------------------------------------------------------------- */

  // Whole-degree lines, labelled along the top and left edges.
  function drawGraticule(lines, labels) {
    const g = s('g', { class: 'trip__grid' }, lines);
    const t = s('g', { class: 'trip__grid-labels' }, labels);
    for (let lon = Math.ceil(proj.lon(0)); lon <= Math.floor(proj.lon(W)); lon++) {
      const x = r1(proj.x(lon));
      if (x < 40 || x > W - 30) continue;
      s('line', { x1: x, y1: 0, x2: x, y2: H }, g);
      const lab = s('text', { x, y: 18, 'text-anchor': 'middle' }, t);
      lab.textContent = `${lon}°E`;
      obstacles.push(box(x - 13, 10, 26, 10));
    }
    for (let lat = Math.ceil(proj.lat(H)); lat <= Math.floor(proj.lat(0)); lat++) {
      const y = r1(proj.y(lat));
      if (y < 44 || y > H - 30) continue;
      s('line', { x1: 0, y1: y, x2: W, y2: y }, g);
      const lab = s('text', { x: 13, y: y - 3.5 }, t);
      lab.textContent = `${lat}°N`;
      obstacles.push(box(10, y - 12, 28, 10));
    }
  }

  function drawCompass(parent, cx, cy) {
    const g = s('g', { class: 'trip__compass', transform: `translate(${cx} ${cy})` }, parent);
    s('circle', { class: 'trip__compass-ring', r: 9.5 }, g);
    s('path', { class: 'trip__compass-n', d: 'M0 -8.2 3.4 2 0 0.4 -3.4 2Z' }, g);
    s('path', { class: 'trip__compass-s', d: 'M0 8.2 3.4 2 0 0.4 -3.4 2Z' }, g);
    const n = s('text', { y: -12.5, 'text-anchor': 'middle' }, g);
    n.textContent = 'N';
    obstacles.push(box(cx - 11, cy - 21, 22, 32));
  }

  // A 50 km bar in the classic alternating style. The projection keeps 1 degree of latitude
  // at k units in both directions, so the bar is true in any direction.
  function drawScale(parent) {
    const len = (50 / KM_PER_DEG) * proj.k;
    const x2 = W - 22;
    const x1 = x2 - len;
    const y = H - 19;
    const g = s('g', { class: 'trip__scale' }, parent);
    s('rect', { class: 'trip__scale-bg', x: r1(x1 - 6), y: y - 13, width: r1(len + 12), height: 20, rx: 4, fill: '#FFF6EC', 'fill-opacity': 0.82 }, g);
    s('rect', { class: 'trip__scale-dark', x: r1(x1), y, width: r1(len / 2), height: 3.2 }, g);
    s('rect', { class: 'trip__scale-light', x: r1(x1 + len / 2), y, width: r1(len / 2), height: 3.2 }, g);
    const lab = s('text', { x: r1(x1 + len / 2), y: y - 4.5, 'text-anchor': 'middle' }, g);
    lab.textContent = '50 km';
    obstacles.push(box(x1 - 3, y - 13, len + 6, 19));
  }

  // A bilingual title cartouche, like an old railway map's, in the roomiest empty spot: the
  // place furthest from every pin, likely label, board and piece of map furniture.
  function drawCartouche(parent) {
    const w = 94;
    const hgt = 40;
    const avoid = [...obstacles, box(home.x - 46, home.y - 40, 92, 52)]; // home pin and its board
    for (const p of places) {
      avoid.push(box(p.x - 12, p.y - 12, 24, 24));
      const c = p.pref || SPOTS[0];
      const tw = p.name.length * LABEL_FS * 0.54;
      const bx = p.x + c.dx - (c.anchor === 'end' ? tw : c.anchor === 'middle' ? tw / 2 : 0);
      avoid.push(box(bx - 4, p.y + c.dy - LABEL_FS - 2, tw + 8, LABEL_FS + 6));
    }
    const gap = (a, b) => Math.hypot(
      Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)),
      Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)),
    );
    let best = null;
    for (let y = 14; y <= H - 14 - hgt; y += 4) {
      for (let x = 14; x <= W - 14 - w; x += 4) {
        const b = box(x, y, w, hgt);
        let room = Infinity;
        for (const o of avoid) room = Math.min(room, gap(b, o));
        if (room > 0 && (!best || room > best.room)) best = { b, room };
      }
    }
    if (!best || best.room < 6) return;
    const { x, y } = best.b;
    const g = s('g', { class: 'trip__cartouche', transform: `translate(${x} ${y})` }, parent);
    s('rect', { class: 'trip__cartouche-bg', width: w, height: hgt, rx: 4 }, g);
    s('rect', { class: 'trip__cartouche-rule', x: 3, y: 3, width: w - 6, height: hgt - 6, rx: 2.5 }, g);
    const hi = s('text', { class: 'trip__cartouche-hi', x: w / 2, y: 20, 'text-anchor': 'middle', lang: 'hi' }, g);
    hi.textContent = 'राजस्थान';
    const en = s('text', { class: 'trip__cartouche-en', x: w / 2, y: 31.5, 'text-anchor': 'middle' }, g);
    en.textContent = 'RAJASTHAN';
    obstacles.push(box(x - 2, y - 2, w + 4, hgt + 4));
  }

  // Whole-state silhouette with the shown area boxed (only when real outline data exists).
  function drawLocator(parent) {
    const size = LOCATOR;
    const [minLon, minLat, maxLon, maxLat] = outline.bbox;
    const lp = fitProjection(outline.bbox, { t: 5, r: 5, b: 5, l: 5 }, size);
    const g = s('g', { class: 'trip__locator', transform: 'translate(12 12)' }, parent);
    s('rect', { class: 'trip__locator-bg', width: size, height: lp.height, rx: 7 }, g);
    s('path', { class: 'trip__locator-land', d: outline.d, transform: `matrix(${lp.matrix.map((n) => +n.toFixed(4)).join(' ')})` }, g);
    const lon0 = Math.max(minLon, proj.lon(0));
    const lon1 = Math.min(maxLon, proj.lon(W));
    const lat0 = Math.max(minLat, proj.lat(H));
    const lat1 = Math.min(maxLat, proj.lat(0));
    s('rect', { class: 'trip__locator-view', x: r1(lp.x(lon0)), y: r1(lp.y(lat1)), width: r1(lp.x(lon1) - lp.x(lon0)), height: r1(lp.y(lat0) - lp.y(lat1)) }, g);
    s('circle', { class: 'trip__locator-home', cx: r1(lp.x(origin.lon)), cy: r1(lp.y(origin.lat)), r: 2.3 }, g);
    obstacles.push(box(8, 8, size + 8, lp.height + 8));
    return g;
  }

  // Bhilwara: a pulsing station-board-yellow pin under a tiny BHILWARA board on two posts.
  function drawHome(g) {
    s('circle', { class: 'trip__pulse', r: 7.5 }, g);
    const posts = s('g', { class: 'trip__posts' }, g);
    const plateG = s('g', { class: 'trip__board' }, g);
    const rect = s('rect', { class: 'trip__board-plate', y: -36, height: 18, rx: 3 }, plateG);
    const text = s('text', { class: 'trip__board-text', y: -22.6, 'text-anchor': 'middle' }, plateG);
    const name = origin.name.toUpperCase();
    text.textContent = name;
    s('circle', { class: 'trip__home-pin', r: 6.6 }, g);
    s('circle', { class: 'trip__home-dot', r: 2.3 }, g);
    let bw = 0;
    const fitBoard = () => {
      bw = textWidth(text, name, 10.5) + 14;
      rect.setAttribute('x', r1(-bw / 2));
      rect.setAttribute('width', r1(bw));
      posts.replaceChildren();
      for (const px of [-bw * 0.28, bw * 0.28]) s('rect', { x: r1(px - 0.9), y: -18.5, width: 1.8, height: 12, rx: 0.6 }, posts);
    };
    fitBoard();
    return {
      boxes() {
        fitBoard();
        return [
          box(home.x - bw / 2 - 2, home.y - 38, bw + 4, 22),
          box(home.x - bw * 0.28 - 2, home.y - 18, bw * 0.56 + 4, 10),
          box(home.x - 9, home.y - 9, 18, 18),
        ];
      },
    };
  }
}

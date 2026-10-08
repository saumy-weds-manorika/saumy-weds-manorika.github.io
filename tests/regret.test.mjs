import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/*
 * A tiny stand-in for the DOM, just enough for js/regret.js: elements with layout boxes in page
 * coordinates, a scrollable window, and requestAnimationFrame we flush by hand. A chip that has
 * dodged is position:fixed, so its box is in viewport coordinates and doesn't move with the page.
 */
const VIEW = { w: 375, h: 812 };
let all = [];
let listeners = {};
let frames = [];

class FakeStyle {
  constructor() { this.props = {}; }
  setProperty(k, v) { this.props[k] = String(v); }
  removeProperty(k) { delete this.props[k]; }
  get position() { return this.props.position || ''; }
}

class FakeEl {
  constructor(tag, box = { x: 0, y: 0, w: 100, h: 44 }) {
    this.tagName = tag.toUpperCase();
    this.box = box;
    this.children = [];
    this.parent = null;
    this.root = false;
    this.attrs = {};
    this.classes = new Set();
    this.style = new FakeStyle();
    this.hidden = false;
    this.textContent = '';
    this.id = '';
    this.obstacle = false;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self.classes.add(x)),
      remove: (...c) => c.forEach((x) => self.classes.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !self.classes.has(c) : !!on; if (want) self.classes.add(c); else self.classes.delete(c); return want; },
      contains: (c) => self.classes.has(c),
    };
    all.push(this);
  }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n.root; }
  get parentElement() { return this.parent; }
  get offsetWidth() { return this.box.w; }
  get offsetHeight() { return this.box.h; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'style') this.style = new FakeStyle(); }
  addEventListener() {}
  removeEventListener() {}
  closest() { return null; }
  checkVisibility() { return this.isConnected && !this.hidden; }
  getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; }
  contains(o) { for (let n = o; n; n = n.parent) if (n === this) return true; return false; }
  focus() { globalThis.document.activeElement = this; }
  appendChild(c) {
    if (c.parent) c.parent.children = c.parent.children.filter((x) => x !== c);
    this.children.push(c);
    c.parent = this;
    return c;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  replaceWith(o) {
    const p = this.parent;
    if (o.parent) o.remove();
    p.children[p.children.indexOf(this)] = o;
    o.parent = p;
    this.parent = null;
  }
  getBoundingClientRect() {
    if (!this.isConnected) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const fixed = this.style.position === 'fixed';
    const left = fixed ? parseFloat(this.style.props.left) : this.box.x - win.scrollX;
    const top = fixed ? parseFloat(this.style.props.top) : this.box.y - win.scrollY;
    return { left, top, right: left + this.box.w, bottom: top + this.box.h, width: this.box.w, height: this.box.h };
  }
}

const win = {
  innerWidth: VIEW.w,
  innerHeight: VIEW.h,
  scrollX: 0,
  scrollY: 0,
  visualViewport: null,
  matchMedia: () => ({ matches: false }),
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
};

function scrollTo(y) {
  win.scrollY = y;
  for (const fn of listeners.scroll || []) fn();
  const queued = frames;
  frames = [];
  for (const fn of queued) fn();
}

let card;
let regretChip;

beforeEach(() => {
  all = [];
  listeners = {};
  frames = [];
  win.scrollY = 0;
  const body = new FakeEl('body', { x: 0, y: 0, w: VIEW.w, h: 3000 });
  body.root = true;
  const head = new FakeEl('head');
  head.root = true;
  globalThis.window = win;
  globalThis.document = {
    body,
    head,
    documentElement: { clientWidth: VIEW.w, clientHeight: VIEW.h },
    activeElement: null,
    createElement: (tag) => new FakeEl(tag),
    getElementById: (id) => all.find((e) => e.id === id && e.isConnected) || null,
    querySelectorAll: () => all.filter((e) => e.obstacle && e.isConnected),
  };
  globalThis.getComputedStyle = (e) => ({ width: `${e.box.w}px`, height: `${e.box.h}px`, transform: 'none', visibility: 'visible' });
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  // One guest card with its status chips; the Regret chip is the one that runs away
  card = body.appendChild(new FakeEl('li', { x: 16, y: 300, w: 343, h: 120 }));
  for (const [i, name] of ['confirmed', 'waitlisted', 'regret'].entries()) {
    const chip = card.appendChild(new FakeEl('button', { x: 28 + i * 110, y: 360, w: 100, h: 44 }));
    chip.obstacle = true;
    chip.textContent = name;
    if (name === 'regret') regretChip = chip;
  }
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
});

afterEach(() => {
  mock.timers.tick(5000); // let the bubble and the FLIP settle, then drop any timer left
  mock.timers.reset();
});

const { createRegretController } = await import('../js/regret.js');
const isOut = (chip) => chip.parent === globalThis.document.body && chip.classList.contains('rj-moving');

test('regret: a runaway chip goes home once the page scrolls past the slack', () => {
  const regret = createRegretController({ announce: () => {} });
  let selected = 0;
  assert.equal(regret.handle(regretChip, () => selected++, 'g1'), 'dodged');
  assert.ok(isOut(regretChip), 'the chip dodged out of its slot');
  scrollTo(10);
  assert.ok(isOut(regretChip), 'a small scroll with nothing under the chip keeps it out');
  scrollTo(160);
  assert.ok(!isOut(regretChip), 'a real scroll sends it home');
  assert.equal(regretChip.parent, card, 'back in its own card');
  assert.equal(selected, 0, 'going home never selects Regret');
  // The joke carries on where it was: the next tap is the second dodge
  assert.equal(regret.handle(regretChip, () => selected++, 'g1'), 'dodged');
  assert.equal(regret.dodgesFor('g1'), 2);
});

test('regret: even a small scroll sends the chip home if it slides another control under it', () => {
  const regret = createRegretController({ announce: () => {} });
  regret.handle(regretChip, () => {}, 'g1');
  assert.ok(isOut(regretChip));
  const at = regretChip.getBoundingClientRect();
  // Another guest's chip, 12px below the runaway one: a 12px scroll lines them up
  const other = globalThis.document.body.appendChild(new FakeEl('button', { x: at.left, y: at.top + 12, w: 100, h: 44 }));
  other.obstacle = true;
  scrollTo(12);
  assert.ok(!isOut(regretChip), 'the chip went home instead of covering the other control');
});

test('regret: resizing without a scroll keeps the chip out', () => {
  const regret = createRegretController({ announce: () => {} });
  regret.handle(regretChip, () => {}, 'g1');
  for (const fn of listeners.resize || []) fn();
  for (const fn of frames.splice(0)) fn();
  assert.ok(isOut(regretChip));
});

/**
 * js/regret.js: the runaway "Regret" chip (spec §3.1, per-card counters per v4 §P).
 *
 * Each guest card runs its own joke, keyed by a stable per-guest key (or, when no
 * key is given, by the chip element itself). The first three taps for a key make
 * the chip dodge instead of selecting: the chip is lifted out to document.body as
 * position:fixed (so ancestor transforms or overflow can't trap it) and jumps to a
 * random spot inside the visual viewport, at least 12px from every edge and clear
 * of the sticky bars. A dashed ghost holds its slot and a speech bubble shows the
 * joke. The fourth tap sends it home and selects. From then on, that key's Regret
 * selects at once; other keys keep their own count (a new key starts at 0).
 *
 * Self-styled (.rj-* classes, one injected <style id="rj-style">). No dependencies.
 */

const DEFAULT_MESSAGES = [
  'Do you not love Saumy?',
  'How could you miss a Marwadi wedding?',
  'You must be completely anti-fun person!!',
];
const DEFAULT_FINAL = 'Okay, okay, you must be really busy at the time. We will try to understand. 😢';

const MARGIN = 12;          // min distance from every viewport edge and from the bars
const MIN_JUMP = 80;        // a new spot should be at least this far from the last one
const GAP = 10;             // bubble ↔ button gap
const DODGE_MS = 2600;      // dodge bubble lifetime
const FINAL_MS = 4200;      // final message is longer, so it stays a little longer
const REPEAT_GUARD_MS = 180;
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const GHOST_TEXT = 'Regret ran away →';
const OBSTACLES = 'button, a[href], input, select, textarea, summary, [role="radio"], [role="button"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';

const CSS = `
.rj-ghost{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:44px;max-width:100%;padding:2px .5em;border:2px dashed var(--sindoor,#C62828);border-radius:999px;background:var(--kagaz,#FCE9D6);color:var(--sindoor,#C62828);font:600 .75rem/1.1 Mukta,system-ui,sans-serif;text-align:center;white-space:normal;overflow-wrap:anywhere;text-wrap:balance;overflow:hidden;vertical-align:middle;user-select:none;-webkit-user-select:none}
.rj-moving.rj-moving{display:inline-flex!important;align-items:center;justify-content:center;box-sizing:border-box!important;width:auto!important;height:auto!important;min-width:0!important;min-height:44px!important;max-width:calc(100vw - 24px)!important;flex:none!important;padding:0 1.1em!important;border:2px solid var(--kagaz,#FCE9D6)!important;border-radius:999px!important;background:var(--sindoor,#C62828)!important;color:#fff!important;font-family:Mukta,system-ui,sans-serif;font-weight:600;font-size:1rem;line-height:1.1;white-space:nowrap;opacity:1!important;visibility:visible!important;box-shadow:0 8px 20px rgba(16,22,74,.45),0 0 0 4px rgba(198,40,40,.22)!important;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.rj-moving.rj-moving:focus-visible{outline:3px solid var(--haldi,#FFD23F)!important;outline-offset:3px!important}
.rj-bubble{position:fixed;left:0;top:0;z-index:60;box-sizing:border-box;width:max-content;max-width:min(240px,calc(100vw - 24px));margin:0;padding:.55em .85em;border:2px solid var(--genda,#F6A609);border-radius:14px;background:var(--kagaz,#FCE9D6);color:var(--syahi,#1B1B2F);font:600 .95rem/1.3 Mukta,system-ui,sans-serif;text-align:center;box-shadow:0 10px 26px rgba(16,22,74,.45);--rj-tail:50%;transform-origin:var(--rj-tail) 100%;cursor:default}
.rj-bubble.rj-below{transform-origin:var(--rj-tail) 0}
.rj-bubble[hidden]{display:none!important}
.rj-bubble::after{content:"";position:absolute;left:var(--rj-tail);top:100%;width:12px;height:12px;box-sizing:border-box;background:inherit;border:2px solid var(--genda,#F6A609);border-top:0;border-left:0;transform:translate(-50%,-50%) rotate(45deg)}
.rj-bubble.rj-below::after{top:0;transform:translate(-50%,-50%) rotate(225deg)}
@media (prefers-reduced-motion:no-preference){
.rj-bubble.rj-pop:not(.rj-rm){animation:rj-pop .32s ${SPRING} both}
.rj-moving.rj-wob:not(.rj-rm){animation:rj-wob .55s ease-out}
}
@keyframes rj-pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:none}}
@keyframes rj-wob{0%,100%{transform:none}20%{transform:rotate(-9deg) scale(1.08)}45%{transform:rotate(7deg)}70%{transform:rotate(-4deg)}}
`;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Layout size rounded UP (offsetWidth rounds, which could nudge a box past the margin by <1px). */
function boxSize(el) {
  const cs = getComputedStyle(el);
  return {
    w: Math.ceil(parseFloat(cs.width) || el.offsetWidth),
    h: Math.ceil(parseFloat(cs.height) || el.offsetHeight),
  };
}

function injectStyle() {
  if (document.getElementById('rj-style')) return;
  const s = document.createElement('style');
  s.id = 'rj-style';
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

/**
 * True when the element is laid out and not hidden/inert (used to notice a stop change).
 * Opacity is ignored on purpose: a stop that is fading in starts at opacity 0, and a chip that
 * dodges during that fade must not be snapped straight back into its slot.
 */
function isShown(el) {
  if (!el || !el.isConnected) return false;
  if (el.parentElement && el.parentElement.closest('[inert]')) return false;
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
  }
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function overlaps(x, y, w, h, r) {
  return x < r.right && x + w > r.left && y < r.bottom && y + h > r.top;
}

/** A usable counter key: a non-empty string (numbers are stringified) or an object. Else undefined. */
function normKey(key) {
  if (typeof key === 'string') return key ? key : undefined;
  if (typeof key === 'number') return Number.isFinite(key) ? String(key) : undefined;
  if (key && (typeof key === 'object' || typeof key === 'function')) return key;
  return undefined;
}

/**
 * Create the runaway-Regret controller. One instance per page; each key (guest) has its own
 * dodge count, so one card's joke never uses up another's.
 *
 * @param {object} opts
 * @param {string[]} [opts.messages]      the three dodge messages, in order
 * @param {string}   [opts.finalMessage]  shown when Regret finally selects
 * @param {(text:string)=>void} [opts.announce] aria-live writer provided by the app
 * @param {()=>({top:number,bottom:number})} [opts.getInsets] px covered by the sticky bar (top) and bottom CTA
 * @param {boolean|(()=>boolean)} [opts.reducedMotion] no spring/wobble when true (OS preference also honoured)
 * @returns {{
 *   handle:(buttonEl:HTMLElement,onSelect:()=>void,key?:string)=>('dodged'|'selected'|'ignored'),
 *   dodgesFor:(key:string|HTMLElement)=>number,
 *   readonly dodges:number,
 *   reset:(key?:string|HTMLElement)=>void,
 * }}
 *   handle: `key` is the guest's stable id; without it the counter is keyed by the element.
 *   dodgesFor: dodges so far for that key (0…messages.length).
 *   dodges: total dodges across every key (debugging only).
 *   reset: forgets one key's count, or every count when called with no key.
 */
export function createRegretController({
  messages = DEFAULT_MESSAGES,
  finalMessage = DEFAULT_FINAL,
  announce,
  getInsets,
  reducedMotion = false,
} = {}) {
  const msgs = Array.isArray(messages) && messages.length ? messages.slice() : DEFAULT_MESSAGES.slice();
  const finalText = finalMessage || DEFAULT_FINAL;
  const say = typeof announce === 'function' ? announce : null;

  // Per-key joke state { dodges, done }: string keys in a Map, object keys (incl. the chip
  // element when no key is given) in a WeakMap so dropped elements are not kept alive.
  let named = new Map();
  let byObject = new WeakMap();
  let total = 0;               // dodges across every key (debugging)
  let moved = null;            // { btn, ghost, x, y, joke } while a chip is out of its slot
  let bubbleJoke = null;       // the joke state the visible bubble belongs to
  let lastDodgeAt = 0;
  let calls = 0;               // handle() call counter (for the delegated-click fallback)
  let watchTimer = 0;
  let bubble = null;
  let bubbleTimer = 0;
  let bubbleAnchor = null;     // () => rect the bubble points at
  let anchorWatch = 0;         // polls the final bubble's chip, which no longer has a ghost to watch
  let listening = false;
  let rafId = 0;

  const originals = new WeakMap(); // btn -> original style attribute (string|null)
  const onSelects = new WeakMap(); // btn -> last onSelect passed for it
  const btnKeys = new WeakMap();   // btn -> last key passed for it (for the delegated-click fallback)
  const flipping = new WeakSet();
  let wired = false;

  /** The joke state for a normalised key (see normKey); created on demand when `create`. */
  function jokeFor(k, create) {
    if (k === undefined) return null;
    const store = typeof k === 'string' ? named : byObject;
    let j = store.get(k);
    if (!j && create) {
      j = { dodges: 0, done: false };
      store.set(k, j);
    }
    return j || null;
  }

  const rm = () => {
    const own = typeof reducedMotion === 'function' ? !!reducedMotion() : !!reducedMotion;
    if (own) return true;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  };

  function insets() {
    let v = null;
    try { v = typeof getInsets === 'function' ? getInsets() : null; } catch { v = null; }
    const n = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);
    return { top: n(v && v.top), bottom: n(v && v.bottom) };
  }

  /** Allowed area (fixed-position coords) for a w×h box: visual viewport ∩ outside the bars, minus margins. */
  function region(w = 0, h = 0) {
    const vv = window.visualViewport;
    const de = document.documentElement;
    const ax = vv ? vv.offsetLeft : 0;
    const ay = vv ? vv.offsetTop : 0;
    const aw = vv ? vv.width : (de.clientWidth || window.innerWidth);
    const ah = vv ? vv.height : (window.innerHeight || de.clientHeight);
    const ins = insets();
    const layoutBottom = Math.max(window.innerHeight || 0, ay + ah);
    let left = ax + MARGIN;
    let right = ax + aw - MARGIN;
    let top = Math.max(ay, ins.top) + MARGIN;
    let bottom = Math.min(ay + ah, layoutBottom - ins.bottom) - MARGIN;
    // Last-resort fallbacks for absurdly small viewports: stay visible even if the bars must be overlapped.
    if (bottom - top < h) { top = ay + MARGIN; bottom = ay + ah - MARGIN; }
    if (bottom - top < h) { top = ay; bottom = ay + ah; }
    if (right - left < w) { left = ax; right = ax + aw; }
    return { left, right, top, bottom, minX: left, maxX: Math.max(left, right - w), minY: top, maxY: Math.max(top, bottom - h) };
  }

  function inView(el) {
    const r = el.getBoundingClientRect();
    const reg = region(0, 0);
    return r.width > 0 && r.top >= reg.top && r.bottom <= reg.bottom && r.left >= reg.left && r.right <= reg.right;
  }

  /** Rect without our in-flight FLIP translate, so the bubble aims at where the chip is landing. */
  function layoutRect(el) {
    const r = el.getBoundingClientRect();
    if (!flipping.has(el)) return r;
    const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(el).transform || '');
    if (!m) return r;
    const p = m[1].split(',').map(parseFloat);
    return { left: r.left - (p[4] || 0), top: r.top - (p[5] || 0), width: r.width, height: r.height };
  }

  function restoreStyle(btn) {
    const orig = originals.has(btn) ? originals.get(btn) : null;
    if (orig === null) btn.removeAttribute('style');
    else btn.setAttribute('style', orig);
  }

  function pin(btn, x, y, animate) {
    const s = btn.style;
    s.setProperty('position', 'fixed', 'important');
    s.setProperty('left', `${x}px`, 'important');
    s.setProperty('top', `${y}px`, 'important');
    s.setProperty('right', 'auto', 'important');
    s.setProperty('bottom', 'auto', 'important');
    s.setProperty('margin', '0', 'important');
    s.setProperty('z-index', '59', 'important');
    s.setProperty('transition', animate ? `left .35s ${SPRING}, top .35s ${SPRING}` : 'none', 'important');
  }

  // ---------- speech bubble ----------

  function ensureBubble() {
    if (bubble && bubble.isConnected) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'rj-bubble';
    if (say) bubble.setAttribute('aria-hidden', 'true'); // the app's live region already reads it out
    else bubble.setAttribute('role', 'status');
    bubble.hidden = true;
    bubble.addEventListener('click', hideBubble);
    document.body.appendChild(bubble);
    return bubble;
  }

  /** Set text off-screen-invisibly and return its size so a dodge spot can leave room for it. */
  function prepBubble(text) {
    const b = ensureBubble();
    clearTimeout(bubbleTimer);
    b.textContent = text;
    b.classList.remove('rj-pop', 'rj-below');
    b.classList.toggle('rj-rm', rm());
    b.style.visibility = 'hidden';
    b.style.left = '0px';
    b.style.top = '0px';
    b.hidden = false;
    return boxSize(b);
  }

  function placeBubble(r) {
    const b = bubble;
    if (!b || b.hidden) return;
    // The thing it points at is gone (stop changed, chip re-rendered): don't float over nothing.
    if (!r || !r.width) { hideBubble(); return; }
    const { w, h } = boxSize(b);
    const reg = region(0, 0);
    // Integer bounds so rounding can never nudge the bubble past the 12px margin.
    const minX = Math.ceil(reg.left);
    const maxX = Math.floor(reg.right - w);
    const minY = Math.ceil(reg.top);
    const maxY = Math.floor(reg.bottom - h);
    const cx = r.left + r.width / 2;
    const x = clamp(Math.round(cx - w / 2), minX, maxX);
    const above = Math.floor(r.top - GAP - h);
    const below = Math.ceil(r.top + r.height + GAP);
    let y;
    let under = false;
    if (above >= minY) y = above;
    else if (below <= maxY) { y = below; under = true; }
    else {
      under = reg.bottom - (r.top + r.height) > r.top - reg.top;
      y = clamp(under ? below : above, minY, maxY);
    }
    b.classList.toggle('rj-below', under);
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.style.setProperty('--rj-tail', `${Math.round(clamp(cx - x, 18, w - 18))}px`);
  }

  function revealBubble(anchor, ms) {
    const b = ensureBubble();
    bubbleAnchor = anchor;
    placeBubble(anchor());
    void b.offsetWidth; // restart the pop animation
    b.style.visibility = '';
    b.classList.add('rj-pop');
    bubbleTimer = setTimeout(hideBubble, ms);
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    clearInterval(anchorWatch);
    bubbleAnchor = null;
    bubbleJoke = null;
    if (bubble) {
      bubble.hidden = true;
      bubble.classList.remove('rj-pop');
    }
  }

  // ---------- viewport tracking ----------

  function onViewport() {
    rafId = 0;
    if (moved) {
      const { btn } = moved;
      const { w, h } = boxSize(btn);
      const reg = region(w, h);
      const x = clamp(moved.x, Math.ceil(reg.minX), Math.floor(reg.maxX));
      const y = clamp(moved.y, Math.ceil(reg.minY), Math.floor(reg.maxY));
      if (x !== moved.x || y !== moved.y) {
        moved.x = x;
        moved.y = y;
        pin(btn, x, y, false);
      }
    }
    if (bubble && !bubble.hidden && bubbleAnchor) placeBubble(bubbleAnchor());
  }

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(onViewport);
  }

  function listen() {
    if (listening) return;
    listening = true;
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', schedule);
      vv.addEventListener('scroll', schedule);
    }
  }

  /** While a chip is out, notice when its slot leaves the screen (stop change) or the app re-renders it. */
  function watch() {
    clearInterval(watchTimer);
    watchTimer = setInterval(() => {
      if (!moved) { clearInterval(watchTimer); return; }
      if (!moved.ghost.isConnected || !isShown(moved.ghost)) {
        settle(false, false);
        hideBubble();
      }
    }, 300);
  }

  /**
   * Safety net for apps that use event delegation on an ancestor of the chip: once the chip lives
   * in <body>, clicks no longer bubble through that ancestor. A window capture listener runs before
   * any app listener, notes the handle() count, and if the click did not reach handle() during
   * dispatch, calls handle() itself with the last onSelect for that chip. Apps with direct
   * listeners on the chip are unaffected (their call bumps the count, so the fallback stays quiet).
   */
  function wire() {
    if (wired) return;
    wired = true;
    window.addEventListener('click', (e) => {
      const m = moved;
      if (!m || !(e.target instanceof Node)) return;
      if (!m.btn.contains(e.target)) {
        // Another option in the same group was picked while Regret is on the run: send it home.
        const t = e.target instanceof Element ? e.target : e.target.parentElement;
        const radio = t && t.closest('[role="radio"]');
        const group = radio && radio.closest('[role="radiogroup"]');
        if (group && group.contains(m.ghost)) {
          setTimeout(() => { if (moved === m) { settle(true, false); hideBubble(); } }, 0);
        }
        return;
      }
      const { btn } = m;
      const before = calls;
      setTimeout(() => {
        if (calls === before && moved && moved.btn === btn) handle(btn, onSelects.get(btn), btnKeys.get(btn));
      }, 0);
    }, true);
  }

  // ---------- moving the chip ----------

  function pickSpot(w, h, prev, bsize, btn) {
    const reg = region(w, h);
    const obstacles = [];
    for (const el of document.querySelectorAll(OBSTACLES)) {
      if (el === btn || (bubble && bubble.contains(el))) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.bottom < reg.top || r.top > reg.bottom || r.right < reg.left || r.left > reg.right) continue;
      obstacles.push(r);
    }
    const x0 = Math.ceil(reg.minX);
    const x1 = Math.max(x0, Math.floor(reg.maxX));
    const y0 = Math.ceil(reg.minY);
    const y1 = Math.max(y0, Math.floor(reg.maxY));
    // Where placeBubble() would put the speech bubble for a chip at (x, y): above if it fits, else below.
    const breg = region(0, 0);
    const bubbleClear = (x, y) => {
      if (!bsize) return true;
      const bx = clamp(Math.round(x + w / 2 - bsize.w / 2), Math.ceil(breg.left), Math.floor(breg.right - bsize.w));
      const above = Math.floor(y - GAP - bsize.h);
      const by = above >= Math.ceil(breg.top) ? above : Math.ceil(y + h + GAP);
      if (by + bsize.h > breg.bottom) return false;
      return !obstacles.some((r) => overlaps(bx - 4, by - 4, bsize.w + 8, bsize.h + 8, r));
    };
    let best = { x: x0, y: y0 };
    let bestScore = -1;
    // Cheap per sample; dense phone layouts can leave only a few spots that satisfy everything.
    for (let i = 0; i < 400; i++) {
      const x = Math.round(x0 + Math.random() * (x1 - x0));
      const y = Math.round(y0 + Math.random() * (y1 - y0));
      const clear = !obstacles.some((r) => overlaps(x - 6, y - 6, w + 12, h + 12, r));
      // It has to visibly leave its old spot (no overlap with it), or it doesn't read as a dodge.
      const leaves = Math.abs(x - prev.x) >= w || Math.abs(y - prev.y) >= h;
      const far = Math.hypot(x - prev.x, y - prev.y) >= MIN_JUMP;
      const roomy = !bsize || y - GAP - bsize.h >= reg.top || y + h + GAP + bsize.h <= reg.bottom;
      // The chip must be tappable (clear) and actually move, and the bubble should not cover the other options.
      const score = (clear ? 16 : 0) + (leaves ? 8 : 0) + (clear && bubbleClear(x, y) ? 4 : 0) + (far ? 2 : 0) + (roomy ? 1 : 0);
      if (score > bestScore) {
        best = { x, y };
        bestScore = score;
        if (score === 31) break;
      }
    }
    return best;
  }

  function dodge(btn, text, joke) {
    if (moved && moved.btn !== btn) settle(true, false);
    if (!moved) {
      if (!originals.has(btn)) originals.set(btn, btn.getAttribute('style'));
      if (flipping.has(btn)) { flipping.delete(btn); restoreStyle(btn); }
      const r = btn.getBoundingClientRect();
      const ghost = document.createElement('span');
      ghost.className = 'rj-ghost';
      ghost.textContent = GHOST_TEXT;
      ghost.setAttribute('aria-hidden', 'true');
      if (r.width) ghost.style.minWidth = `${Math.round(r.width)}px`;
      moved = { btn, ghost, x: Math.round(r.left), y: Math.round(r.top), joke };
      btn.replaceWith(ghost);
      btn.classList.add('rj-moving');
      pin(btn, moved.x, moved.y, false);
      document.body.appendChild(btn);
      wire();
      watch();
      listen();
    }
    const m = moved;
    m.joke = joke;
    const { w, h } = boxSize(btn); // also flushes the start position so the jump animates
    const size = prepBubble(text);
    const spot = pickSpot(w, h, m, size, btn);
    m.x = spot.x;
    m.y = spot.y;
    const still = rm();
    pin(btn, spot.x, spot.y, !still);
    btn.classList.toggle('rj-rm', still);
    if (!still) {
      btn.classList.remove('rj-wob');
      void btn.offsetWidth;
      btn.classList.add('rj-wob');
    }
    revealBubble(() => ({ left: m.x, top: m.y, width: w, height: h }), DODGE_MS);
    bubbleJoke = joke;
    btn.focus({ preventScroll: true });
  }

  function flip(btn, dx, dy) {
    flipping.add(btn);
    const s = btn.style;
    s.setProperty('transition', 'none', 'important');
    s.setProperty('transform', `translate(${dx}px, ${dy}px)`, 'important');
    void btn.offsetWidth;
    s.setProperty('transition', `transform .45s ${SPRING}`, 'important');
    s.setProperty('transform', 'translate(0px, 0px)', 'important');
    let t = 0;
    const end = (e) => {
      if (e && (e.target !== btn || e.propertyName !== 'transform')) return;
      clearTimeout(t);
      btn.removeEventListener('transitionend', end);
      if (!flipping.has(btn)) return;
      flipping.delete(btn);
      if (!btn.classList.contains('rj-moving')) restoreStyle(btn);
    };
    btn.addEventListener('transitionend', end);
    t = setTimeout(end, 700);
  }

  /**
   * Put the moved chip back in its slot (FLIP-animated unless reduced motion).
   * Returns the chip's home rect, or null if the slot no longer exists (app re-rendered).
   */
  function settle(animate, reveal) {
    const m = moved;
    if (!m) return null;
    moved = null;
    clearInterval(watchTimer);
    const { btn, ghost } = m;
    const first = btn.getBoundingClientRect();
    const hadFocus = document.activeElement === btn;
    if (!ghost.isConnected) { btn.remove(); return null; }
    ghost.replaceWith(btn);
    btn.classList.remove('rj-moving', 'rj-wob', 'rj-rm');
    restoreStyle(btn);
    if (hadFocus || reveal) btn.focus({ preventScroll: true });
    if (reveal && isShown(btn) && !inView(btn)) {
      try { btn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch { btn.scrollIntoView(false); }
    }
    const last = btn.getBoundingClientRect();
    const home = { left: last.left, top: last.top, width: last.width, height: last.height };
    if (animate && !rm() && last.width) {
      const dx = Math.round(first.left - last.left);
      const dy = Math.round(first.top - last.top);
      if (Math.abs(dx) + Math.abs(dy) > 2) flip(btn, dx, dy);
    }
    return home;
  }

  // ---------- public ----------

  /**
   * Call from the Regret chip's click handler.
   * Dodges for the first three calls for `key` (the guest; the element when omitted), then selects.
   */
  function handle(btn, onSelect, key) {
    calls++;
    if (typeof onSelect === 'function' && btn) onSelects.set(btn, onSelect);
    const select = typeof onSelect === 'function' ? onSelect : (btn ? onSelects.get(btn) : null);
    if (!btn || typeof btn.getBoundingClientRect !== 'function') {
      if (select) select();
      return 'selected';
    }
    const k = normKey(key);
    if (k === undefined) btnKeys.delete(btn);
    else btnKeys.set(btn, k);
    const joke = jokeFor(k === undefined ? btn : k, true);
    injectStyle();

    if (joke.done) {
      // Another card's chip may still be on the run: send it home and drop its bubble.
      if (moved) { settle(true, false); hideBubble(); }
      if (select) select();
      return 'selected';
    }

    if (joke.dodges < msgs.length) {
      const now = Date.now();
      if (moved && moved.btn === btn && now - lastDodgeAt < REPEAT_GUARD_MS) return 'ignored';
      lastDodgeAt = now;
      const text = msgs[joke.dodges];
      dodge(btn, text, joke);
      if (say) say(text);
      joke.dodges++;
      total++;
      return 'dodged';
    }

    // Fourth tap: home, final message, select.
    joke.done = true;
    if (moved) settle(true, moved.btn === btn);
    if (btn.isConnected) {
      if (document.activeElement !== btn) btn.focus({ preventScroll: true });
      prepBubble(finalText);
      revealBubble(() => (isShown(btn) ? layoutRect(btn) : null), FINAL_MS);
      bubbleJoke = joke;
      listen();
      // If the guest moves on (e.g. "Send my regrets") while the message is up, take it down.
      clearInterval(anchorWatch);
      anchorWatch = setInterval(() => {
        if (!bubble || bubble.hidden) { clearInterval(anchorWatch); return; }
        if (!isShown(btn)) hideBubble();
      }, 200);
    }
    if (say) say(finalText);
    if (select) select();
    return 'selected';
  }

  /** Dodges so far for one key (a string key, or the chip element when handle() got no key). */
  function dodgesFor(key) {
    const j = jokeFor(normKey(key), false);
    return j ? j.dodges : 0;
  }

  /** Forget one key's count (e.g. a removed guest), or every count when called without a key. */
  function reset(key) {
    const k = normKey(key);
    if (k === undefined) {
      if (moved) settle(false, false);
      hideBubble();
      named = new Map();
      byObject = new WeakMap();
      total = 0;
      lastDodgeAt = 0;
      return;
    }
    const j = jokeFor(k, false);
    if (!j) return;
    if (moved && moved.joke === j) { settle(false, false); hideBubble(); }
    else if (bubbleJoke === j) hideBubble();
    total = Math.max(0, total - j.dodges);
    (typeof k === 'string' ? named : byObject).delete(k);
  }

  return {
    handle,
    dodgesFor,
    get dodges() { return total; },
    reset,
  };
}

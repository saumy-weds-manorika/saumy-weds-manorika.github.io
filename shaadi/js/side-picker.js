/**
 * js/side-picker.js: "Which side are you from?" (shaadi spec, Flow 1).
 *
 * The eight relation tabs live in index.html (#side-tabs, one radio group across both columns).
 * This module only wires them up: a tap reports the pick to app.js (which owns the state), and
 * `celebrate(side)` makes that side's bobblehead dance and bursts confetti from it, in that side's
 * colours plus marigold. Under reduced motion there is no confetti and only a small bounce.
 *
 * Smoothness: the dance (css/side.css) only animates rotate/translate/transform, so the compositor
 * runs it. It never restarts mid-step: another tap while dancing just dances longer, and it stops
 * at the end of a sway, when the figure is back in its resting pose, so nothing ever jumps.
 */

const DANCE_MS = 3000;         // dance for about two sways (side-sway in side.css is 1.5s), then stop on centre
const STOP_GRACE_MS = 120;     // a sway ending this close to the deadline counts as the last one
const FALLBACK_MS = 2500;      // stop anyway this long after the deadline if no animation event came
const BURST = 60;              // confetti pieces per burst
const LIFE_MS = 2400;          // a piece's lifetime; it fades out over the last FADE_MS
const FADE_MS = 600;
const GRAVITY = 1300;          // px/s²
const DRAG = 1.6;              // per second (air resistance on the sideways and upward speed)
const MAX_DPR = 1.5;           // confetti is small and moving: 1.5x is crisp enough and much cheaper to fill
const MARIGOLD = ['#F6A609', '#E07B00', '#FFD23F'];
const COLOURS = {
  a: ['#5AA9FF', '#2F6BFF', '#A9D4FF', '#FCE9D6'],
  b: ['#FF6FA8', '#D6246E', '#FFC2DA', '#FCE9D6'],
};

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root            #side-tabs (role=radiogroup)
 * @param {(id:string, side:'a'|'b')=>void} opts.onPick  a tab was tapped (or picked with the arrow keys)
 * @param {()=>boolean} [opts.reducedMotion]
 * @returns {{ select:(id:string)=>void, celebrate:(side:'a'|'b')=>void, rest:()=>void, tabs:HTMLButtonElement[] }}
 */
export function createSidePicker({ root, onPick, reducedMotion = () => false }) {
  const tabs = Array.from(root.querySelectorAll('.side-tab[role="radio"]'));
  const sideOf = (tab) => (tab.closest('[data-side]') || {}).dataset?.side === 'b' ? 'b' : 'a';
  const dancers = {};

  for (const side of ['a', 'b']) {
    const figure = root.querySelector(`[data-side="${side}"] .figure`);
    if (!figure) continue;
    const d = { figure, until: 0, fallback: 0 };
    const stop = () => {
      clearTimeout(d.fallback);
      figure.classList.remove('is-dancing');
    };
    // Each sway ends with the figure upright and centred: stop there once the time is up.
    figure.addEventListener('animationiteration', (e) => {
      if (e.target === figure && e.animationName === 'side-sway' && performance.now() >= d.until - STOP_GRACE_MS) stop();
    });
    // Reduced motion: a single bounce that simply ends.
    figure.addEventListener('animationend', (e) => {
      if (e.target === figure) stop();
    });
    // The fallback counts from when the dance really starts running
    figure.addEventListener('animationstart', (e) => {
      if (e.target !== figure || e.animationName !== 'side-sway') return;
      clearTimeout(d.fallback);
      d.fallback = setTimeout(stop, Math.max(0, d.until - performance.now()) + FALLBACK_MS);
    });
    d.stop = stop;
    dancers[side] = d;
  }

  root.addEventListener('click', (e) => {
    const tab = e.target instanceof Element ? e.target.closest('.side-tab[role="radio"]') : null;
    if (!tab || !root.contains(tab)) return;
    onPick(tab.dataset.value, sideOf(tab));
  });

  /** Mark one tab as chosen ('' clears them all). */
  function select(id) {
    for (const tab of tabs) tab.setAttribute('aria-checked', String(tab.dataset.value === id));
  }

  /** The chosen side's bobblehead dances (longer, not restarted, if it already is) and the confetti flies. */
  function celebrate(side) {
    const d = dancers[side];
    if (!d) return;
    d.until = performance.now() + DANCE_MS;
    if (!d.figure.classList.contains('is-dancing')) d.figure.classList.add('is-dancing');
    // If the page is in the background, animation events may never come: stop anyway
    clearTimeout(d.fallback);
    d.fallback = setTimeout(d.stop, DANCE_MS + FALLBACK_MS);
    if (!reducedMotion()) burst(d.figure, side);
  }

  /** Both figures back at rest at once (used when the platform is left, so it's never seen). */
  function rest() {
    for (const d of Object.values(dancers)) d.stop();
  }

  return { select, celebrate, rest, tabs };
}

/* ------------------------------------------------------------------ */
/* Confetti                                                            */
/* ------------------------------------------------------------------ */

/* One canvas, made on the first burst and kept (hidden while idle), so later taps don't pay for a
   new full-screen canvas. Each piece is drawn with a single setTransform: no save/restore. */
let canvas = null;
let ctx = null;
let dpr = 1;
let pieces = [];
let frame = 0;
let last = 0;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function ensureCanvas() {
  if (canvas && canvas.isConnected) return true;
  canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  ctx = canvas.getContext('2d');
  if (!ctx) { canvas = null; return false; }
  document.body.appendChild(canvas);
  return true;
}

/** Matches the canvas to the viewport (only when it changed). */
function sizeCanvas() {
  dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/** Throws BURST pieces up and out from just above the figure's head. */
function burst(figure, side) {
  if (!ensureCanvas()) return;
  const box = figure.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height * 0.18;
  const colours = [...COLOURS[side], ...MARIGOLD];
  for (let i = 0; i < BURST; i++) {
    const angle = rand(-Math.PI * 0.92, -Math.PI * 0.08); // upward fan
    const speed = rand(360, 760);
    const petal = Math.random() < 0.3;
    pieces.push({
      x: x + rand(-10, 10),
      y: y + rand(-6, 6),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: rand(0, Math.PI * 2),
      spin: rand(-7, 7),
      flutter: rand(0, Math.PI * 2),
      w: petal ? rand(5, 7) : rand(6, 10),
      h: petal ? rand(5, 7) : rand(3, 5),
      petal,
      colour: petal ? pick(MARIGOLD) : pick(colours),
      age: 0,
    });
  }
  canvas.style.visibility = 'visible';
  if (!frame) {
    sizeCanvas();
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sizeCanvas();
  const h = window.innerHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const decay = Math.exp(-DRAG * dt);
  let alive = 0;
  for (const p of pieces) {
    p.age += dt * 1000;
    if (p.age > LIFE_MS || p.y > h + 40) continue;
    pieces[alive++] = p;
    p.vx *= decay;
    p.vy = p.vy * decay + GRAVITY * dt;
    p.flutter += dt * 7;
    p.x += (p.vx + Math.sin(p.flutter) * 36) * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    const cos = Math.cos(p.rot) * dpr;
    const sin = Math.sin(p.rot) * dpr;
    ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
    ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE_MS - p.age) / FADE_MS));
    ctx.fillStyle = p.colour;
    const turn = Math.abs(Math.cos(p.flutter)); // a paper square seen turning: it narrows as it flips
    if (p.petal) {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.w / 2, (p.h / 2) * turn + 1, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const ph = Math.max(1, p.h * turn);
      ctx.fillRect(-p.w / 2, -ph / 2, p.w, ph);
    }
  }
  pieces.length = alive;
  ctx.globalAlpha = 1;
  if (alive) {
    frame = requestAnimationFrame(tick);
  } else {
    frame = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.visibility = 'hidden';
  }
}

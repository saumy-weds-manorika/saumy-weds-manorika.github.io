/**
 * js/side-picker.js: "Which side are you from?" (shaadi spec, Flow 1).
 *
 * The eight relation tabs live in index.html (#side-tabs, one radio group across both columns).
 * This module only wires them up: a tap reports the pick to app.js (which owns the state), and
 * `celebrate(side)` makes that side's bobblehead dance and bursts confetti from it, in that side's
 * colours plus marigold. Under reduced motion there is no confetti and only a small bounce.
 */

const DANCE_MS = 2150;         // two runs of side-dance in side.css (1.05s each), plus a little
const BURST = 70;              // confetti pieces per burst
const LIFE_MS = 2300;          // a piece's lifetime; it fades out over the last FADE_MS
const FADE_MS = 500;
const GRAVITY = 1500;          // px/s²
const DRAG = 1.6;              // per second (air resistance on the sideways and upward speed)
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
 * @returns {{ select:(id:string)=>void, celebrate:(side:'a'|'b')=>void, tabs:HTMLButtonElement[] }}
 */
export function createSidePicker({ root, onPick, reducedMotion = () => false }) {
  const tabs = Array.from(root.querySelectorAll('.side-tab[role="radio"]'));
  const sideOf = (tab) => (tab.closest('[data-side]') || {}).dataset?.side === 'b' ? 'b' : 'a';
  const danceTimers = { a: 0, b: 0 };

  root.addEventListener('click', (e) => {
    const tab = e.target instanceof Element ? e.target.closest('.side-tab[role="radio"]') : null;
    if (!tab || !root.contains(tab)) return;
    onPick(tab.dataset.value, sideOf(tab));
  });

  /** Mark one tab as chosen ('' clears them all). */
  function select(id) {
    for (const tab of tabs) tab.setAttribute('aria-checked', String(tab.dataset.value === id));
  }

  /** The chosen side's bobblehead dances (restarting if it already is) and the confetti flies. */
  function celebrate(side) {
    const figure = root.querySelector(`[data-side="${side}"] .figure`);
    if (!figure) return;
    clearTimeout(danceTimers[side]);
    figure.classList.remove('is-dancing');
    void figure.offsetWidth; // restart the animation
    figure.classList.add('is-dancing');
    danceTimers[side] = setTimeout(() => figure.classList.remove('is-dancing'), DANCE_MS);
    if (!reducedMotion()) burst(figure, side);
  }

  return { select, celebrate, tabs };
}

/* ------------------------------------------------------------------ */
/* Confetti                                                            */
/* ------------------------------------------------------------------ */

let canvas = null;
let ctx = null;
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

function sizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const speed = rand(380, 820);
    const petal = Math.random() < 0.3;
    pieces.push({
      x: x + rand(-10, 10),
      y: y + rand(-6, 6),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: rand(0, Math.PI * 2),
      spin: rand(-9, 9),
      flutter: rand(0, Math.PI * 2),
      w: petal ? rand(5, 7) : rand(6, 10),
      h: petal ? rand(5, 7) : rand(3, 5),
      petal,
      colour: petal ? pick(MARIGOLD) : pick(colours),
      age: 0,
    });
  }
  if (!frame) {
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sizeCanvas();
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  const decay = Math.exp(-DRAG * dt);
  pieces = pieces.filter((p) => {
    p.age += dt * 1000;
    if (p.age > LIFE_MS || p.y > h + 40) return false;
    p.vx *= decay;
    p.vy = p.vy * decay + GRAVITY * dt;
    p.flutter += dt * 8;
    p.x += (p.vx + Math.sin(p.flutter) * 40) * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (LIFE_MS - p.age) / FADE_MS));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.colour;
    if (p.petal) {
      ctx.beginPath();
      ctx.ellipse(0, 0, p.w / 2, p.h / 2 * Math.abs(Math.cos(p.flutter)) + 1, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // A paper square seen turning: its height shrinks and grows as it flips
      ctx.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.flutter)), p.w, Math.max(1, p.h * Math.abs(Math.cos(p.flutter))));
    }
    ctx.restore();
    return true;
  });
  if (pieces.length) {
    frame = requestAnimationFrame(tick);
  } else {
    frame = 0;
    canvas.remove();
    canvas = null;
    ctx = null;
  }
}

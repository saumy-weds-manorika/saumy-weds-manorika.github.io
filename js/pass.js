/**
 * Save the Train: the boarding pass.
 *
 * Draws a 1080×1350 "Shaadi Express" ticket with the Canvas 2D API only: a
 * vintage Indian Railways PRS slip printed in dot-matrix on kagaz paper,
 * hung on a neel bandhani night under a marigold toran. Guests download or
 * share this image, so everything is drawn at full resolution and seeded
 * from the pass id (the same guest always gets the same ticket).
 *
 * Exports: renderPass, passFilename, downloadPass, sharePass, passBlob.
 */
import { formatDate } from './logic.js';
import { AIRPORTS, JUNCTIONS, BHILWARA_STATION } from './travel-data.js';

const W = 1080;
const H = 1350;

const C = {
  neel: '#1A2260', neelDeep: '#10164A', genda: '#F6A609', gendaDeep: '#E07B00',
  rani: '#D6246E', haldi: '#FFD23F', kagaz: '#FCE9D6', syahi: '#1B1B2F',
  patta: '#2F7D32', sindoor: '#C62828',
};
/* Stamp inks. WL is genda-deep darkened (#B35C00) so it keeps 4:1 contrast on kagaz. */
const INK = { confirmed: C.patta, waitlisted: '#B35C00', regret: C.sindoor };
const STAMP_FALLBACK = { confirmed: 'CNF', waitlisted: 'WL', regret: 'REGRET' };
const MUTED = 'rgba(27,27,47,0.62)';
const FAINT = 'rgba(27,27,47,0.36)';
const MISSED = 'rgba(27,27,47,0.58)'; // missed stops: greyed and struck through, but still readable

const F = {
  display: '"Yatra One", "Mukta", serif',
  body: '"Mukta", "Noto Sans", system-ui, sans-serif',
  dot: '"DotGothic16", ui-monospace, "Courier New", monospace',
};

/* Ticket geometry. The tear line sits at 62% of the card height. */
const CARD = { x: 76, y: 150, w: 928, h: 1162, r: 30 };
const TEAR = CARD.y + Math.round(CARD.h * 0.62);
const NOTCH = 30;
const HOLE = { x: CARD.x + 60, y: CARD.y + 47, r: 16 };
/* Bust portraits: drawn this many circle-radii wide, with the face (this far down the image) centred. */
const BUST_ZOOM = 2.05;
const BUST_FACE_Y = 0.41;
const L = CARD.x + 60;
const R = CARD.x + CARD.w - 60;
const MID = W / 2;

/* Baselines, top to bottom. */
const Y = {
  strip: CARD.y, stripH: 94, micro: 292, title: 374, sub: 418, orn: 450,
  paxHead: 492, paxTop: 506, paxBottom: 622,
  routeHead: 668, city: 720, routeSub: 752,
  whenRule: 774, whenHead: 806, when: 844,
  stopsHead: 920, stopsTop: 934, stopRow: 39,
  footRule: 1146, pnrHead: 1184, pnr: 1232, foot: 1280,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Render the boarding pass.
 * @param {{
 *   config: object, label: string, passId: string,
 *   guests: {name:string, status:'confirmed'|'waitlisted'|'regret'}[],
 *   travel: {mode:string, from:string, arrive:{date:string,slot:string}, depart:{date:string,slot:string},
 *     via?:{hub?:string, onward?:string}} | null,
 *   catches?: {id:string, name:string, caught:boolean}[],
 *   heads?: {a?: HTMLImageElement|null, b?: HTMLImageElement|null},
 * }} data  `travel.mode === 'local'` prints the home-platform variant (amendments §L). For train and
 *   flight, a `via.hub` other than Bhilwara itself is printed under FROM, e.g. "BY FLIGHT · VIA UDAIPUR
 *   (UDR) · CAR" (v4 §O3). `heads` are the couple's bobblehead busts (assets/bobble/*-bust.webp,
 *   preloaded by app.js); without them a BHILWARA JN postmark is printed instead.
 * @returns {Promise<HTMLCanvasElement>} a 1080×1350 canvas
 */
export async function renderPass(data) {
  const d = normalise(data);
  await ensureFonts(sampleText(d));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const seed = hashStr(`${d.passId}|${d.label}`);

  drawBackdrop(ctx);
  drawLadis(ctx, rng(seed ^ 0x51ed27));
  drawCard(ctx, d, rng(seed ^ 0x2545f491));
  drawHeader(ctx, d);
  drawPassengers(ctx, d, seed);
  drawRoute(ctx, d);
  drawWhen(ctx, d);
  drawStops(ctx, d);
  drawFooter(ctx, d, seed);
  if (d.allRegret) drawRegretStamp(ctx, seed);
  drawHem(ctx, rng(seed ^ 0x3c6ef372));
  drawToran(ctx, rng(seed ^ 0x7f4a7c15));

  // Warm both encodes now, so a later Share tap only awaits a settled promise and keeps the
  // tap's user activation (iOS Safari rejects navigator.share after a slow await).
  canvasBlob(canvas, SHARE_TYPE).catch(() => {});
  canvasBlob(canvas, PNG).catch(() => {});
  return canvas;
}

/**
 * The pass as an image Blob, encoded once per canvas and type and shared with download/share.
 * PNG (default) is the full-quality file for Download and the on-page preview. JPEG is what
 * Share sends: about a quarter of the size, and WhatsApp recompresses to JPEG anyway.
 * @param {HTMLCanvasElement} canvas
 * @param {'image/png'|'image/jpeg'} [type]
 * @returns {Promise<Blob>}
 */
export function passBlob(canvas, type = PNG) {
  return canvasBlob(canvas, type === SHARE_TYPE ? SHARE_TYPE : PNG);
}

/**
 * Download filename for a guest's pass.
 * @param {string} label e.g. 'Rahul Sharma'
 * @returns {string} e.g. 'shaadi-express-ticket-rahul-sharma.png'
 */
export function passFilename(label) {
  const slug = String(label ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48).replace(/-+$/, '');
  return `shaadi-express-ticket-${slug || 'guest'}.png`;
}

/**
 * Save the pass as a PNG via a temporary object URL and <a download>.
 * @param {HTMLCanvasElement} canvas
 * @param {string} [filename]
 */
export async function downloadPass(canvas, filename = passFilename('')) {
  const blob = await canvasBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Share the pass image through the Web Share API (WhatsApp shows up here on phones).
 * Call it straight from a tap handler.
 * @param {HTMLCanvasElement} canvas
 * @param {{title?:string, text?:string, filename?:string}} [opts]
 * @returns {Promise<'shared'|'cancelled'|'unsupported'>}
 */
export async function sharePass(canvas, { title = '', text = '', filename = passFilename('') } = {}) {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || typeof File !== 'function') {
    return 'unsupported';
  }
  let file;
  try {
    const jpgName = String(filename).replace(/\.png$/i, '') + '.jpg';
    file = new File([await canvasBlob(canvas, SHARE_TYPE)], jpgName, { type: SHARE_TYPE });
    if (!nav.canShare({ files: [file] })) return 'unsupported';
  } catch {
    return 'unsupported';
  }
  try {
    await nav.share({ files: [file], title, text });
    return 'shared';
  } catch (err) {
    return err && err.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

/* ------------------------------------------------------------------ */
/* Data + fonts                                                        */
/* ------------------------------------------------------------------ */

const PNG = 'image/png';
const SHARE_TYPE = 'image/jpeg';
const JPEG_QUALITY = 0.9;
const blobCache = new WeakMap(); // canvas -> Map(type -> Promise<Blob>)

/** One encode per canvas and type, shared by preview, download and share. */
function canvasBlob(canvas, type = PNG) {
  let byType = blobCache.get(canvas);
  if (!byType) {
    byType = new Map();
    blobCache.set(canvas, byType);
  }
  let p = byType.get(type);
  if (!p) {
    p = new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not create the ticket image.'))),
        type,
        type === SHARE_TYPE ? JPEG_QUALITY : undefined,
      );
    });
    byType.set(type, p);
    p.catch(() => byType.delete(type));
  }
  return p;
}

function normalise(data = {}) {
  const config = data.config || {};
  const guests = (Array.isArray(data.guests) ? data.guests : [])
    .map((g) => ({ name: String(g?.name ?? '').trim(), status: STAMP_FALLBACK[g?.status] ? g.status : 'confirmed' }))
    .filter((g) => g.name);
  const label = String(data.label ?? '').trim();
  if (!guests.length) guests.push({ name: label || 'Guest', status: 'confirmed' });
  const allRegret = guests.every((g) => g.status === 'regret');
  const travel = data.travel && typeof data.travel === 'object' ? data.travel : null;
  const fns = Array.isArray(config.functions) ? config.functions : [];
  const caught = new Map((Array.isArray(data.catches) ? data.catches : []).map((c) => [c.id, !!c.caught]));
  const stops = fns.map((f) => ({ ...f, caught: allRegret ? false : (caught.has(f.id) ? caught.get(f.id) : true) }));
  return {
    config, guests, allRegret, travel, stops,
    local: !allRegret && !!travel && travel.mode === 'local',
    label: label || guests[0].name,
    passId: String(data.passId ?? '').trim().toUpperCase() || 'SHAADI',
    heads: data.heads || {},
  };
}

function sampleText(d) {
  const c = d.config;
  return [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 ·–()&!?.,:',
    c.cityHi || 'भीलवाड़ा', 'शुभ विवाह शादी एक्सप्रेस',
    d.label, ...d.guests.map((g) => g.name), d.travel?.from || '',
  ].join(' ');
}

async function ensureFonts(text) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const faces = ['40px "Yatra One"', '400 40px "Mukta"', '600 40px "Mukta"', '40px "DotGothic16"'];
  const loads = Promise.all(faces.map((f) => document.fonts.load(f, text).catch(() => [])))
    .then(() => document.fonts.ready);
  await Promise.race([loads, new Promise((r) => setTimeout(r, 5000))]);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small deterministic PRNG in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HAS_LS = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

function font(ctx, size, fam, weight = 400, ls = 0) {
  ctx.font = `${weight} ${Math.round(size)}px ${fam}`;
  if (HAS_LS) ctx.letterSpacing = `${ls}px`;
}

/** Shrink text to fit `width`; truncate with an ellipsis below `min`. Leaves ctx.font set. */
function fit(ctx, text, { fam, weight = 400, max, min, width, ls = 0 }) {
  for (let size = max; size >= min; size -= 1) {
    font(ctx, size, fam, weight, ls);
    if (ctx.measureText(text).width <= width) return { text, size };
  }
  font(ctx, min, fam, weight, ls);
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(`${chars.join('').trimEnd()}…`).width > width) chars.pop();
  return { text: `${chars.join('').trimEnd()}…`, size: min };
}

function text(ctx, str, x, y, { size, fam = F.dot, weight = 400, color = C.syahi, align = 'left', ls = 0 } = {}) {
  font(ctx, size, fam, weight, ls);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  // Canvas letter-spacing trails the last glyph; nudge so right/centre alignment stays true.
  const nudge = HAS_LS && ls ? (align === 'right' ? ls : align === 'center' ? ls / 2 : 0) : 0;
  ctx.fillText(str, x + nudge, y);
}

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function circle(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A row of square "printer pins", the dot-matrix rule. */
function dotRule(ctx, x0, x1, y, color = FAINT, step = 9, s = 3) {
  ctx.fillStyle = color;
  for (let x = x0; x <= x1 - s; x += step) ctx.fillRect(Math.round(x), Math.round(y - s / 2), s, s);
}

function slotLabel(cfg, id) {
  const s = (cfg.slots || []).find((x) => x.id === id);
  return s ? s.label : String(id || '');
}

function modeLabel(cfg, id) {
  const m = (cfg.modes || []).find((x) => x.id === id);
  return m ? m.label : String(id || '');
}

function stampText(cfg, status) {
  const s = (cfg.statuses || []).find((x) => x.id === status);
  return (s && s.stamp) || STAMP_FALLBACK[status];
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NIGHT_ENDS_HOUR = 6; // a function before 6 AM (the 3 AM Phera) is the tail of the previous night

/** The wedding day a function belongs to: its own date, or the day before for a small-hours function. */
function weddingDay(f) {
  const [date, time = ''] = String(f.at || '').split('T');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : String(f.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const hour = Number(time.split(':')[0]);
  if (!time || !Number.isFinite(hour) || hour >= NIGHT_ENDS_HOUR) return day;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The official dates, e.g. 'D1–D2 Mon YYYY' from the wedding days (the Phera counts as the last night). */
function dateRange(cfg) {
  const ds = (cfg.functions || []).map(weddingDay).filter(Boolean).sort();
  if (!ds.length) return '';
  const [y1, m1, d1] = ds[0].split('-').map(Number);
  const [y2, m2, d2] = ds[ds.length - 1].split('-').map(Number);
  if (y1 === y2 && m1 === m2) return d1 === d2 ? `${d1} ${MON[m1 - 1]} ${y1}` : `${d1}–${d2} ${MON[m1 - 1]} ${y1}`;
  return `${d1} ${MON[m1 - 1]} – ${d2} ${MON[m2 - 1]} ${y2}`;
}

/* ------------------------------------------------------------------ */
/* Decor: bandhani, marigolds, mango leaves                            */
/* ------------------------------------------------------------------ */

const MARIGOLD = {
  orange: { deep: '#B94F00', mid: C.gendaDeep, light: '#F59A27' },
  yellow: { deep: '#D98400', mid: C.genda, light: '#FFC94A' },
};

function marigold(ctx, x, y, r, tone, rand) {
  const t = MARIGOLD[tone];
  const spin = rand() * Math.PI;
  ctx.fillStyle = t.deep;
  for (let i = 0; i < 11; i++) {
    const a = spin + (i / 11) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  circle(ctx, x, y, r * 0.74, t.mid);
  ctx.fillStyle = t.light;
  for (let i = 0; i < 7; i++) {
    const a = spin * 1.7 + (i / 7) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.36, y + Math.sin(a) * r * 0.36, r * 0.27, 0, Math.PI * 2);
    ctx.fill();
  }
  circle(ctx, x, y, r * 0.17, t.deep);
  ctx.beginPath();
  ctx.arc(x - r * 0.12, y - r * 0.12, r * 0.62, Math.PI * 1.05, Math.PI * 1.5);
  ctx.strokeStyle = 'rgba(255,240,200,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
}

/** Mango leaf hanging from (x, y); angle 0 points straight down. */
function leaf(ctx, x, y, len, wid, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid * 1.1, len * 0.22, wid * 0.7, len * 0.7, 0, len);
  ctx.bezierCurveTo(-wid * 0.7, len * 0.7, -wid * 1.1, len * 0.22, 0, 0);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.lineTo(0, len * 0.88);
  ctx.strokeStyle = 'rgba(220,255,200,0.32)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

/** Small gold bell with a rani tassel: the latkan at the end of every string. */
function latkan(ctx, x, y, s = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = C.rani;
  ctx.lineWidth = 2;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 1.6, 14);
    ctx.lineTo(i * 2.6, 34);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-9, 15);
  ctx.quadraticCurveTo(-9, -2, 0, -3);
  ctx.quadraticCurveTo(9, -2, 9, 15);
  ctx.closePath();
  ctx.fillStyle = C.haldi;
  ctx.fill();
  ctx.fillStyle = '#C98A00';
  ctx.fillRect(-10, 13, 20, 3);
  circle(ctx, 0, 18, 2.6, '#C98A00');
  ctx.restore();
}

function drawBackdrop(ctx) {
  ctx.fillStyle = C.neel;
  ctx.fillRect(0, 0, W, H);

  // Bandhani: an offset dot grid with rani-and-haldi tie-dye flowers.
  const step = 30;
  ctx.fillStyle = 'rgba(252,233,214,0.13)';
  for (let row = 0, y = 10; y < H; row++, y += step) {
    for (let x = 8 + (row % 2) * (step / 2); x < W; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const big = 120;
  for (let row = 0, y = 70; y < H + big; row++, y += big) {
    for (let x = 40 + (row % 2) * (big / 2); x < W + big; x += big) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        circle(ctx, x + Math.cos(a) * 11, y + Math.sin(a) * 11, 2.8, 'rgba(214,36,110,0.55)');
      }
      circle(ctx, x, y, 3.2, 'rgba(255,210,63,0.45)');
    }
  }

  // Warm lamp-light glow behind the ticket, and a soft vignette.
  const glow = ctx.createRadialGradient(MID, 560, 60, MID, 560, 760);
  glow.addColorStop(0, 'rgba(246,166,9,0.22)');
  glow.addColorStop(1, 'rgba(246,166,9,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const vig = ctx.createRadialGradient(MID, H / 2, 380, MID, H / 2, 900);
  vig.addColorStop(0, 'rgba(16,22,74,0)');
  vig.addColorStop(1, 'rgba(8,10,40,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

/** Vertical marigold strings down both edges. */
function drawLadis(ctx, rand) {
  for (const x of [38, W - 38]) {
    ctx.strokeStyle = 'rgba(90,31,14,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 20);
    ctx.lineTo(x, H - 96);
    ctx.stroke();
    let k = 0;
    for (let y = 40; y < H - 110; y += 23, k++) {
      const tone = Math.floor(k / 4) % 2 ? 'yellow' : 'orange';
      marigold(ctx, x + (rand() - 0.5) * 2, y, 13.5, tone, rand);
      if (k % 4 === 3) circle(ctx, x, y + 12, 4, C.rani);
    }
    latkan(ctx, x, H - 104, 1.2);
  }
}

/** Marigold swags and mango leaves across the top. Drawn last so it hangs over the ticket. */
function drawToran(ctx, rand) {
  const cordY = 14;
  // Mango-leaf bandhanwar hanging from the cord.
  for (let x = 6, i = 0; x < W; x += 26, i++) {
    leaf(ctx, x, cordY, 48 + rand() * 12, 12, (rand() - 0.5) * 0.3, i % 2 ? C.patta : '#236B27');
  }
  ctx.strokeStyle = '#5A1F0E';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, cordY);
  ctx.lineTo(W, cordY);
  ctx.stroke();

  // Five swags, alternating orange and yellow, with a rani bead every few flowers.
  const swags = 5;
  const sw = W / swags;
  const sag = 76;
  for (let s = 0; s < swags; s++) {
    const x0 = s * sw;
    const x1 = x0 + sw;
    const cx = (x0 + x1) / 2;
    const tone = s % 2 ? 'yellow' : 'orange';
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
      const y = (1 - t) * (1 - t) * cordY + 2 * (1 - t) * t * (cordY + sag * 2) + t * t * cordY;
      marigold(ctx, x, y + 6, 16, tone, rand);
      if (i % 4 === 2) circle(ctx, x, y + 6, 5, C.rani);
    }
  }
  // Short drops at each join, ending in a latkan.
  for (let s = 1; s < swags; s++) {
    const x = s * sw;
    for (let k = 0; k < 3; k++) marigold(ctx, x, 32 + k * 22, 13, k % 2 ? 'yellow' : 'orange', rand);
    leaf(ctx, x - 4, 92, 26, 8, 0.5, C.patta);
    leaf(ctx, x + 4, 92, 26, 8, -0.5, '#236B27');
    latkan(ctx, x, 104, 0.95);
  }
}

/** A marigold string along the bottom edge, so the neel band under the ticket isn't empty. */
function drawHem(ctx, rand) {
  const y = CARD.y + CARD.h + (H - CARD.y - CARD.h) / 2 + 1;
  ctx.strokeStyle = 'rgba(90,31,14,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(62, y);
  ctx.lineTo(W - 62, y);
  ctx.stroke();
  let k = 0;
  for (let x = 74; x <= W - 74; x += 21, k++) {
    marigold(ctx, x, y, 10, Math.floor(k / 4) % 2 ? 'yellow' : 'orange', rand);
    if (k % 4 === 3) circle(ctx, x + 10.5, y, 3.4, C.rani);
  }
}

/* ------------------------------------------------------------------ */
/* The ticket                                                          */
/* ------------------------------------------------------------------ */

function cardPath(ctx) {
  const { x, y, w, h, r } = CARD;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, TEAR - NOTCH);
  ctx.arc(x + w, TEAR, NOTCH, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, TEAR + NOTCH);
  ctx.arc(x, TEAR, NOTCH, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.moveTo(HOLE.x + HOLE.r, HOLE.y);
  ctx.arc(HOLE.x, HOLE.y, HOLE.r, 0, Math.PI * 2);
}

function drawCard(ctx, d, rand) {
  // Paper with a lifted shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(4,6,28,0.6)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 20;
  cardPath(ctx);
  ctx.fillStyle = C.kagaz;
  ctx.fill('evenodd');
  ctx.restore();

  ctx.save();
  cardPath(ctx);
  ctx.clip('evenodd');

  // Aged edges.
  const age = ctx.createRadialGradient(MID, CARD.y + CARD.h / 2, 300, MID, CARD.y + CARD.h / 2, 820);
  age.addColorStop(0, 'rgba(224,123,0,0)');
  age.addColorStop(1, 'rgba(176,96,20,0.16)');
  ctx.fillStyle = age;
  ctx.fillRect(CARD.x, CARD.y, CARD.w, CARD.h);

  // Security print: faint diagonal lehariya waves, the way PRS stock carries a pattern.
  ctx.lineWidth = 1.6;
  for (let i = 0, x = CARD.x - CARD.h; x < CARD.x + CARD.w; x += 15, i++) {
    ctx.strokeStyle = i % 3 === 2 ? 'rgba(224,123,0,0.07)' : 'rgba(214,36,110,0.045)';
    ctx.beginPath();
    for (let t = 0; t <= CARD.h; t += 12) {
      const px = x + t + Math.sin(t / 34) * 6;
      const py = CARD.y + CARD.h - t;
      if (t === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // The counterfoil below the tear is printed on a slightly deeper tint.
  ctx.fillStyle = 'rgba(224,123,0,0.06)';
  ctx.fillRect(CARD.x, TEAR, CARD.w, CARD.y + CARD.h - TEAR);

  // Paper fibres.
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(90,50,20,${0.03 + rand() * 0.05})`;
    ctx.fillRect(CARD.x + rand() * CARD.w, CARD.y + rand() * CARD.h, 1 + rand() * 2, 1);
  }

  // Rani header strip with lehariya stripes and a scalloped kangura edge.
  const sy = Y.strip;
  const sh = Y.stripH;
  ctx.fillStyle = C.rani;
  ctx.fillRect(CARD.x, sy, CARD.w, sh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(CARD.x, sy, CARD.w, sh);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 6;
  for (let x = CARD.x - sh; x < CARD.x + CARD.w + sh; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, sy + sh);
    ctx.bezierCurveTo(x + 20, sy + sh * 0.66, x + 40, sy + sh * 0.33, x + sh, sy);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = C.rani;
  for (let x = CARD.x + 8; x < CARD.x + CARD.w; x += 18) {
    ctx.beginPath();
    ctx.arc(x, sy + sh, 8, 0, Math.PI);
    ctx.fill();
  }
  dotRule(ctx, CARD.x + 20, CARD.x + CARD.w - 20, sy + sh - 9, 'rgba(255,210,63,0.75)', 10, 3);
  ctx.restore();

  // Hole and notch edges catch a little shadow.
  ctx.save();
  ctx.strokeStyle = 'rgba(16,22,74,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(HOLE.x, HOLE.y, HOLE.r, 0, Math.PI * 2);
  ctx.stroke();
  // Tear line.
  ctx.setLineDash([12, 9]);
  ctx.strokeStyle = 'rgba(27,27,47,0.38)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(CARD.x + NOTCH + 12, TEAR);
  ctx.lineTo(CARD.x + CARD.w - NOTCH - 12, TEAR);
  ctx.stroke();
  ctx.restore();
}

function drawHeader(ctx, d) {
  const cfg = d.config;
  const train = cfg.train || {};
  const name = `${(train.name || 'Shaadi Express').toUpperCase()} · ${train.number || '1011'}`;
  const tx = HOLE.x + HOLE.r + 22;
  const f = fit(ctx, name, { fam: F.dot, max: 38, min: 24, width: 520, ls: 2 });
  text(ctx, f.text, tx, Y.strip + 58, { size: f.size, color: C.kagaz, ls: 2 });
  text(ctx, 'शुभ विवाह', R, Y.strip + 58, { size: 34, fam: F.display, color: C.haldi, align: 'right' });

  text(ctx, 'SHAADI-CUM-RESERVATION TICKET', L, Y.micro, { size: 21, color: MUTED, ls: 1.5 });
  text(ctx, 'QUOTA: DOSTI', R, Y.micro, { size: 21, color: C.rani, align: 'right', ls: 1.5 });

  // "Saumy weds Manorika": names in Yatra One, a smaller rani "weds" between them.
  const couple = cfg.couple || {};
  const a = couple.a || 'Saumy';
  const b = couple.b || 'Manorika';
  const segs = [
    { t: a, k: 1, color: C.syahi },
    { t: '  weds  ', k: 0.56, color: C.rani },
    { t: b, k: 1, color: C.syahi },
  ];
  let size = 84;
  const widthAt = (s) => segs.reduce((sum, sg) => { font(ctx, s * sg.k, F.display); return sum + ctx.measureText(sg.t).width; }, 0);
  while (size > 40 && widthAt(size) > R - L) size -= 2;
  let x = MID - widthAt(size) / 2;
  for (const sg of segs) {
    font(ctx, size * sg.k, F.display);
    ctx.fillStyle = sg.color;
    ctx.textAlign = 'left';
    ctx.fillText(sg.t, x, Y.title);
    x += ctx.measureText(sg.t).width;
  }

  const sub = [dateRange(cfg), [cfg.city || 'Bhilwara', cfg.state].filter(Boolean).join(', ')].filter(Boolean).join('  ·  ');
  text(ctx, sub, MID, Y.sub, { size: 29, fam: F.body, weight: 600, color: 'rgba(27,27,47,0.78)', align: 'center' });

  // Ornament: dot-matrix rule with a marigold at its heart.
  dotRule(ctx, L, MID - 34, Y.orn);
  dotRule(ctx, MID + 34, R, Y.orn);
  const r = rng(7);
  marigold(ctx, MID, Y.orn, 15, 'orange', r);
  for (const dx of [-26, 26]) {
    ctx.save();
    ctx.translate(MID + dx, Y.orn);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = C.rani;
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
}

function sectionHead(ctx, left, right, y) {
  text(ctx, left, L, y, { size: 20, color: C.rani, ls: 2 });
  if (right) text(ctx, right, R, y, { size: 20, color: C.rani, align: 'right', ls: 2 });
}

function drawPassengers(ctx, d, seed) {
  const n = d.guests.length;
  sectionHead(ctx, n > 1 ? `PASSENGERS (${n})` : 'PASSENGER', 'STATUS', Y.paxHead);
  const cols = n > 3 ? 2 : 1;
  const gap = cols > 1 ? 32 : 0;
  const rows = Math.ceil(n / cols);
  const avail = Y.paxBottom - Y.paxTop;
  const rowH = Math.min(rows === 1 ? 76 : 58, avail / rows);
  const top = Y.paxTop + (avail - rowH * rows) / 2; // a lone passenger sits in the middle
  const colW = (R - L - gap) / cols;
  const maxName = Math.min(44, rowH * 0.68);
  const stampSize = Math.min(40, rowH * 0.56);
  const stampW = (status) => stampSize * (status === 'regret' ? 5.1 : 3.3);
  const slot = (i) => {
    const col = cols > 1 ? Math.floor(i / rows) : 0;
    const row = cols > 1 ? i % rows : i;
    const x0 = L + col * (colW + gap);
    return { row, x0, x1: x0 + colW, cy: top + rowH * (row + 0.5), nameX: x0 + maxName * 1.25 };
  };
  // One shared size so every name sits on the same type line; very long names get an ellipsis.
  const minName = Math.max(22, maxName * 0.66);
  const size = d.guests.reduce((s, g, i) => {
    const p = slot(i);
    return Math.min(s, fit(ctx, g.name, { fam: F.body, weight: 600, max: maxName, min: minName, width: p.x1 - stampW(g.status) - 16 - p.nameX }).size);
  }, maxName);

  d.guests.forEach((g, i) => {
    const p = slot(i);
    if (p.row > 0) dotRule(ctx, p.x0, p.x1, top + rowH * p.row, 'rgba(27,27,47,0.18)', 7, 2);
    text(ctx, String(i + 1).padStart(2, '0'), p.x0, p.cy + size * 0.3, { size: Math.max(16, size * 0.6), color: MUTED });
    const f = fit(ctx, g.name, { fam: F.body, weight: 600, max: size, min: size, width: p.x1 - stampW(g.status) - 16 - p.nameX });
    text(ctx, f.text, p.nameX, p.cy + size * 0.34, { size, fam: F.body, weight: 600, color: C.syahi });
    const tilt = -0.07 + ((hashStr(`${g.name}${i}`) % 9) - 4) * 0.018;
    drawStamp(ctx, stampText(d.config, g.status), INK[g.status], p.x1 - stampW(g.status) / 2, p.cy, stampSize, tilt, seed + i * 101);
  });
}

function drawRoute(ctx, d) {
  const cfg = d.config;
  const t = d.travel;
  dotRule(ctx, L, R, Y.routeHead - 34, 'rgba(27,27,47,0.22)');
  sectionHead(ctx, 'FROM', 'TO', Y.routeHead);

  // Locals (amendments §L): a home platform, bound for every function.
  const city = (cfg.city || 'Bhilwara').toUpperCase();
  const from = d.local ? `${city} · LOCAL` : (t && t.from ? t.from : 'Your city').trim().toUpperCase();
  const ff = fit(ctx, from, { fam: F.dot, max: 52, min: 24, width: 262 });
  text(ctx, ff.text, L, Y.city, { size: ff.size, color: C.syahi });
  const to = d.local ? 'EVERY FUNCTION' : city;
  const tf = fit(ctx, to, { fam: F.dot, max: 52, min: 24, width: 262 });
  text(ctx, tf.text, R, Y.city, { size: tf.size, color: C.syahi, align: 'right' });

  const by = d.local ? 'BY AUTO-RICKSHAW' : t ? `BY ${modeLabel(cfg, t.mode).toUpperCase()}` : 'TBC';
  const code = cfg.station || 'BHL';
  const sub = d.local ? 'CARNIVAL TO PHERA' : `(${code}) ${(cfg.state || '').toUpperCase()}`.trim();
  text(ctx, sub, R, Y.routeSub, { size: 20, color: MUTED, align: 'right', ls: 1.5 });
  // "BY FLIGHT · VIA UDAIPUR (UDR) · CAR", or just the code when the name won't fit beside the TO line
  const via = d.local || d.allRegret ? null : viaOf(t, code);
  font(ctx, 20, F.dot, 400, 1.5);
  const room = R - ctx.measureText(sub).width - 40 - L;
  const lines = via ? [`${by} · VIA ${via.name} (${via.code})${via.on}`, `${by} · VIA ${via.code}${via.on}`] : [by];
  const line = lines.find((x) => ctx.measureText(x).width <= room) || lines[lines.length - 1];
  const lf = fit(ctx, line, { fam: F.dot, max: 20, min: 15, width: room, ls: 1.5 });
  text(ctx, lf.text, L, Y.routeSub, { size: lf.size, color: MUTED, ls: 1.5 });

  if (d.allRegret) return; // the REGRET stamp takes this space
  // Route line with the vehicle riding it.
  const gy = Y.city - 4;
  const x0 = L + 288;
  const x1 = R - 288;
  dotRule(ctx, x0, x1 - 10, gy, 'rgba(27,27,47,0.45)', 10, 4);
  ctx.beginPath();
  ctx.moveTo(x1 - 12, gy - 9);
  ctx.lineTo(x1, gy);
  ctx.lineTo(x1 - 12, gy + 9);
  ctx.strokeStyle = 'rgba(27,27,47,0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
  drawVehicle(ctx, t ? t.mode : 'train', MID, gy, 1.12);
}

/* Hub names for the route row (v4 §O3), and how the guest goes on from there. */
const HUB_NAMES = new Map([...AIRPORTS, ...JUNCTIONS, BHILWARA_STATION].map((h) => [h.code, h.name]));
const ONWARD = { car: 'CAR', train: 'TRAIN', bus: 'BUS' };

/**
 * The hub a train or flight guest lands at or gets off at, e.g. {code:'UDR', name:'UDAIPUR', on:' · CAR'},
 * or null: no hub, "Not sure yet", or Bhilwara itself (the TO side already says BHL).
 */
function viaOf(t, home) {
  const via = t && (t.mode === 'train' || t.mode === 'flight') && t.via && typeof t.via === 'object' ? t.via : null;
  const hub = via ? String(via.hub || '').trim().toUpperCase() : '';
  if (!/^[A-Z]{2,5}$/.test(hub) || hub === home) return null;
  return {
    code: hub,
    name: String(HUB_NAMES.get(hub) || hub).toUpperCase(),
    on: ONWARD[via.onward] ? ` · ${ONWARD[via.onward]}` : '',
  };
}

function whenValue(cfg, side) {
  if (!side) return '—';
  const known = side.date && side.date !== 'unsure';
  const date = known ? formatDate(side.date) : 'Not sure yet';
  const slot = side.slot && side.slot !== 'unsure' ? slotLabel(cfg, side.slot) : '';
  return (slot ? `${date} · ${slot}` : date).toUpperCase();
}

function drawWhen(ctx, d) {
  dotRule(ctx, L, R, Y.whenRule, 'rgba(27,27,47,0.22)');
  if (d.allRegret) {
    const a = 'We’ll miss you!';
    const b = '  (Still loved.)';
    font(ctx, 50, F.display);
    const wa = ctx.measureText(a).width;
    font(ctx, 28, F.body, 600);
    const wb = ctx.measureText(b).width;
    const x = MID - (wa + wb) / 2;
    text(ctx, a, x, Y.when + 8, { size: 50, fam: F.display, color: C.rani });
    text(ctx, b, x + wa, Y.when + 8, { size: 28, fam: F.body, weight: 600, color: MUTED });
    return;
  }
  if (d.local) {
    // One row instead of ARR / DEP: locals are home for the whole wedding.
    text(ctx, 'HOME PLATFORM', L, Y.whenHead, { size: 20, color: C.rani, ls: 1.5 });
    const f = fit(ctx, 'SEE YOU AT EVERY FUNCTION', { fam: F.dot, max: 32, min: 18, width: R - L, ls: 0.5 });
    text(ctx, f.text, L, Y.when, { size: f.size, color: C.syahi, ls: 0.5 });
    return;
  }
  const colW = (R - L) / 2;
  const cols = [['ARR (tentative)', d.travel?.arrive], ['DEP (tentative)', d.travel?.depart]];
  cols.forEach(([head, side], i) => {
    const x = L + i * (colW + 14);
    text(ctx, head, x, Y.whenHead, { size: 20, color: C.rani, ls: 1.5 });
    const f = fit(ctx, whenValue(d.config, side), { fam: F.dot, max: 32, min: 18, width: colW - 24, ls: 0.5 });
    text(ctx, f.text, x, Y.when, { size: f.size, color: C.syahi, ls: 0.5 });
  });
  ctx.fillStyle = 'rgba(27,27,47,0.18)';
  ctx.fillRect(L + colW - 2, Y.whenHead - 22, 2, 66);
}

/** Clay diya: lit when the guest catches the function, an empty outline when they miss it. */
function diya(ctx, x, y, lit) {
  ctx.save();
  ctx.translate(x, y);
  if (lit) {
    const g = ctx.createRadialGradient(0, -12, 1, 0, -12, 20);
    g.addColorStop(0, 'rgba(255,210,63,0.75)');
    g.addColorStop(1, 'rgba(255,210,63,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -32, 40, 40);
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.bezierCurveTo(6, -15, 6, -7, 0, -5);
    ctx.bezierCurveTo(-6, -7, -6, -15, 0, -24);
    ctx.fillStyle = C.genda;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.bezierCurveTo(3, -12, 3, -8, 0, -7);
    ctx.bezierCurveTo(-3, -8, -3, -12, 0, -17);
    ctx.fillStyle = C.haldi;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-15, -4);
  ctx.quadraticCurveTo(-13, 9, 0, 9);
  ctx.quadraticCurveTo(13, 9, 15, -4);
  ctx.quadraticCurveTo(10, -1, 0, -1);
  ctx.quadraticCurveTo(-10, -1, -15, -4);
  ctx.closePath();
  if (lit) {
    ctx.fillStyle = '#A8440F';
    ctx.fill();
    ctx.fillStyle = C.rani;
    ctx.fillRect(-9, 3, 18, 2);
  } else {
    ctx.strokeStyle = MISSED;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawStops(ctx, d) {
  const total = d.stops.length;
  if (!total) return;
  const got = d.stops.filter((s) => s.caught).length;
  const summary = d.allRegret ? 'MAYBE NEXT TIME' : got === total ? `ALL ${total} ON BOARD` : `CATCHING ${got} OF ${total}`;
  sectionHead(ctx, 'YOUR STOPS', summary, Y.stopsHead);

  const rowH = Math.min(Y.stopRow, (Y.footRule - 22 - Y.stopsTop) / total);
  const dateX = L + 340;
  const whenX = L + 548;
  d.stops.forEach((s, i) => {
    const top = Y.stopsTop + i * rowH;
    const base = top + rowH * 0.68;
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(214,36,110,0.06)';
      ctx.fillRect(L - 14, top + 2, R - L + 28, rowH - 2);
    }
    const col = s.caught ? C.syahi : MISSED;
    diya(ctx, L + 16, base - 6, s.caught);
    const nf = fit(ctx, s.name || s.id, { fam: F.body, weight: 600, max: 29, min: 18, width: dateX - (L + 46) - 14 });
    text(ctx, nf.text, L + 46, base, { size: nf.size, fam: F.body, weight: 600, color: col });
    if (!s.caught) {
      ctx.fillStyle = 'rgba(198,40,40,0.55)';
      ctx.fillRect(L + 44, base - nf.size * 0.32, ctx.measureText(nf.text).width + 4, 2.5);
    }
    text(ctx, s.date ? formatDate(s.date).toUpperCase() : '', dateX, base, { size: 23, color: col });
    const wf = fit(ctx, String(s.when || '').toUpperCase(), { fam: F.dot, max: 23, min: 15, width: R - whenX });
    text(ctx, wf.text, whenX, base, { size: wf.size, color: col, ls: 0.5 });
  });
}

function drawFooter(ctx, d, seed) {
  dotRule(ctx, L, R, Y.footRule, 'rgba(27,27,47,0.22)');
  text(ctx, 'PNR', L, Y.pnrHead, { size: 20, color: C.rani, ls: 2 });
  const pf = fit(ctx, d.passId, { fam: F.dot, max: 44, min: 22, width: 214, ls: 3 });
  text(ctx, pf.text, L, Y.pnr, { size: pf.size, color: C.syahi, ls: 3 });

  // Barcode, seeded from the pass id so it never changes.
  const rand = rng(hashStr(d.passId));
  const bx0 = L + 236;
  const bx1 = R - 268;
  const by = Y.pnrHead - 20;
  const bh = 62;
  ctx.fillStyle = C.syahi;
  ctx.fillRect(bx0, by - 4, 3, bh + 8);
  ctx.fillRect(bx0 + 6, by - 4, 3, bh + 8);
  let x = bx0 + 14;
  while (x < bx1 - 16) {
    const bw = 2 + Math.floor(rand() * 4) * 1.5;
    ctx.fillRect(x, by, bw, bh);
    x += bw + 2 + Math.floor(rand() * 3) * 2;
  }
  ctx.fillRect(bx1 - 9, by - 4, 3, bh + 8);
  ctx.fillRect(bx1 - 3, by - 4, 3, bh + 8);

  const note = d.allRegret ? 'Plans change? So can this ticket.' : 'Tentative plan · Chart prepares closer to the date';
  const nf = fit(ctx, note, { fam: F.body, weight: 600, max: 30, min: 26, width: R - 252 - L });
  text(ctx, nf.text, L, Y.foot, { size: nf.size, fam: F.body, weight: 600, color: 'rgba(27,27,47,0.72)' });

  const heads = [d.heads.a, d.heads.b].filter(drawable);
  if (heads.length) drawHeads(ctx, d.heads);
  else drawPostmark(ctx, d, seed);
}

function drawable(img) {
  return !!img && ((img.naturalWidth || img.width || 0) > 0) && img.complete !== false;
}

/**
 * Bobblehead portraits in garlanded circles, leaning in towards each other. The busts are
 * portrait cut-outs (head and shoulders), so they are sized by width and lifted until the face
 * sits in the middle of the circle.
 */
function drawHeads(ctx, heads) {
  const cy = 1214;
  const rad = 60;
  const spots = [
    { img: heads.a, x: R - 168, tilt: -6, ring: C.rani },
    { img: heads.b, x: R - 56, tilt: 6, ring: C.genda },
  ].filter((s) => drawable(s.img));
  if (spots.length === 1) spots[0].x = R - 112;
  for (const s of spots) {
    ctx.save();
    ctx.translate(s.x, cy);
    ctx.rotate((s.tilt * Math.PI) / 180);
    ctx.shadowColor = 'rgba(27,27,47,0.28)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    circle(ctx, 0, 0, rad + 8, s.ring);
    ctx.shadowColor = 'transparent';
    const bg = ctx.createRadialGradient(0, -10, 6, 0, 0, rad);
    bg.addColorStop(0, '#FFF6EA');
    bg.addColorStop(1, '#F9D9A8');
    circle(ctx, 0, 0, rad, bg);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.clip();
    const iw = s.img.naturalWidth || s.img.width;
    const ih = s.img.naturalHeight || s.img.height;
    const portrait = ih > iw * 1.1;
    const k = portrait ? (rad * BUST_ZOOM) / iw : (rad * 2.15) / Math.max(iw, ih);
    const top = portrait ? -ih * k * BUST_FACE_Y : (-ih * k) / 2 + 6;
    ctx.drawImage(s.img, (-iw * k) / 2, top, iw * k, ih * k);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, rad + 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(27,27,47,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/** Round "BHILWARA JN" cancellation postmark, used when there are no head photos. */
function drawPostmark(ctx, d, seed) {
  const cfg = d.config;
  const rad = 74;
  const layer = inkLayer(rad * 2 + 16, rad * 2 + 16, (o) => {
    o.translate(rad + 8, rad + 8);
    o.strokeStyle = C.rani;
    o.fillStyle = C.rani;
    o.lineWidth = 4;
    o.beginPath();
    o.arc(0, 0, rad, 0, Math.PI * 2);
    o.stroke();
    o.lineWidth = 2;
    o.beginPath();
    o.arc(0, 0, rad - 25, 0, Math.PI * 2);
    o.stroke();
    const ring = `${(cfg.city || 'Bhilwara').toUpperCase()} JN · ${dateRange(cfg).toUpperCase()} · `;
    font(o, 15, F.dot, 400, 0);
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    const chars = Array.from(ring);
    chars.forEach((ch, i) => {
      o.save();
      o.rotate((i / chars.length) * Math.PI * 2);
      o.fillText(ch, 0, -(rad - 12.5));
      o.restore();
    });
    font(o, 30, F.dot, 400, 2);
    o.fillText(cfg.station || 'BHL', 1, -6);
    font(o, 11, F.dot, 400, 0.5);
    o.fillText('SHUBH YATRA', 0, 16);
  }, seed ^ 0xabc, 0.9);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.85;
  ctx.translate(R - 104, 1212);
  ctx.rotate(-0.21);
  ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Rubber stamps                                                       */
/* ------------------------------------------------------------------ */

/** Draw onto an offscreen layer, then knock out specks so it reads as worn ink. */
function inkLayer(w, h, paint, seed, wear = 1) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  const o = c.getContext('2d');
  paint(o);
  const rand = rng(seed >>> 0);
  o.globalCompositeOperation = 'destination-out';
  const specks = Math.round(((w * h) / 160) * wear);
  for (let i = 0; i < specks; i++) {
    o.globalAlpha = 0.35 + rand() * 0.65;
    o.beginPath();
    o.arc(rand() * w, rand() * h, 0.5 + rand() * rand() * 2.6, 0, Math.PI * 2);
    o.fill();
  }
  for (let i = 0; i < 4 * wear; i++) {
    o.globalAlpha = 0.18 + rand() * 0.2;
    o.beginPath();
    o.ellipse(rand() * w, rand() * h, 6 + rand() * w * 0.18, 3 + rand() * h * 0.2, rand() * Math.PI, 0, Math.PI * 2);
    o.fill();
  }
  return c;
}

function drawStamp(ctx, label, color, cx, cy, size, angle, seed, { alpha = 0.92, wear = 1 } = {}) {
  const ls = size * 0.1;
  font(ctx, size, F.dot, 400, ls);
  const tw = ctx.measureText(label).width;
  const padX = size * 0.45;
  const padY = size * 0.32;
  const w = tw + padX * 2;
  const h = size * 1.05 + padY * 2;
  const m = Math.ceil(size * 0.2);
  const layer = inkLayer(w + m * 2, h + m * 2, (o) => {
    o.translate(m, m);
    o.strokeStyle = color;
    o.fillStyle = color;
    o.lineJoin = 'round';
    o.lineWidth = Math.max(2, size * 0.09);
    o.beginPath();
    rr(o, 0, 0, w, h, size * 0.18);
    o.stroke();
    o.lineWidth = Math.max(1, size * 0.04);
    o.beginPath();
    rr(o, size * 0.17, size * 0.17, w - size * 0.34, h - size * 0.34, size * 0.1);
    o.stroke();
    font(o, size, F.dot, 400, ls);
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillText(label, w / 2 + (HAS_LS ? ls / 2 : 0), h / 2 + size * 0.04);
    o.lineWidth = size * 0.05;
    o.strokeText(label, w / 2 + (HAS_LS ? ls / 2 : 0), h / 2 + size * 0.04);
  }, seed, wear);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'multiply';
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(layer, -layer.width / 2, -layer.height / 2);
  ctx.restore();
}

/** All-regret tickets get cancelled across the route, leaving the names readable. */
function drawRegretStamp(ctx, seed) {
  drawStamp(ctx, 'REGRET', C.sindoor, MID, Y.city - 22, 100, -0.1, seed ^ 0x5eed, { alpha: 0.8, wear: 1.3 });
}

/* ------------------------------------------------------------------ */
/* Vehicles (simple shapes, rani with syahi wheels)                    */
/* ------------------------------------------------------------------ */

function wheel(ctx, x, y, r) {
  circle(ctx, x, y, r, C.syahi);
  circle(ctx, x, y, r * 0.35, C.kagaz);
}

function garlandDots(ctx, pts) {
  pts.forEach(([x, y], i) => circle(ctx, x, y, 3.2, i % 2 ? C.genda : C.gendaDeep));
}

/** Draws the vehicle for `mode`, centred on x with its wheels on ground line gy. */
function drawVehicle(ctx, mode, x, gy, s = 1) {
  ctx.save();
  ctx.translate(x, gy);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  if (mode === 'local') {
    // Auto-rickshaw: haldi canopy, rani body, open side with a kagaz seat, nose to the right.
    ctx.fillStyle = 'rgba(27,27,47,0.9)'; // open side: the dark cabin behind the seat
    ctx.beginPath();
    rr(ctx, -36, -62, 46, 28, 5);
    ctx.fill();
    ctx.fillStyle = C.kagaz;
    ctx.fillRect(-34, -41, 26, 5);
    ctx.fillStyle = C.haldi; // canopy: roof curving down into the back panel
    ctx.beginPath();
    ctx.moveTo(-48, -32); ctx.lineTo(-48, -58);
    ctx.quadraticCurveTo(-48, -74, -31, -74);
    ctx.lineTo(22, -74); ctx.quadraticCurveTo(29, -74, 29, -67);
    ctx.lineTo(29, -62); ctx.lineTo(-36, -62); ctx.lineTo(-38, -32); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(252,233,214,0.6)'; // windscreen
    ctx.beginPath();
    ctx.moveTo(14, -36); ctx.lineTo(22, -62); ctx.lineTo(29, -62); ctx.lineTo(27, -34); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.rani;
    ctx.beginPath();
    ctx.moveTo(-50, -12); ctx.lineTo(-50, -38); ctx.lineTo(14, -38); ctx.lineTo(24, -32);
    ctx.quadraticCurveTo(44, -30, 50, -12); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.haldi;
    ctx.fillRect(-50, -26, 94, 4);
    circle(ctx, 46, -21, 3.5, C.haldi);
    ctx.fillStyle = C.syahi;
    ctx.fillRect(-48, -14, 94, 4);
    wheel(ctx, -30, -8, 9);
    wheel(ctx, 34, -8, 8);
    garlandDots(ctx, [[-30, -60], [-20, -59], [-10, -58.6], [0, -58.6], [10, -59], [20, -60]]);
  } else if (mode === 'flight') {
    ctx.translate(0, -30);
    ctx.rotate(-0.12);
    ctx.fillStyle = '#A81B55';
    ctx.beginPath();
    ctx.moveTo(-6, -2); ctx.lineTo(8, -2); ctx.lineTo(-14, -26); ctx.lineTo(-24, -26); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.rani;
    ctx.beginPath();
    ctx.ellipse(0, 0, 58, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-46, -4); ctx.lineTo(-36, -4); ctx.lineTo(-52, -30); ctx.lineTo(-60, -30); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-10, 2); ctx.lineTo(10, 2); ctx.lineTo(-12, 32); ctx.lineTo(-26, 32); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.kagaz;
    for (let i = 0; i < 7; i++) circle(ctx, -30 + i * 9, -2, 2.4, C.kagaz);
    ctx.beginPath();
    ctx.moveTo(44, -6); ctx.quadraticCurveTo(52, -6, 55, -2); ctx.lineTo(44, -2); ctx.closePath();
    ctx.fill();
    garlandDots(ctx, [[-30, 8], [-20, 9.5], [-10, 10], [0, 10], [10, 9.5], [20, 8]]);
  } else if (mode === 'bus') {
    ctx.fillStyle = C.rani;
    ctx.beginPath();
    rr(ctx, -58, -54, 116, 46, 9);
    ctx.fill();
    ctx.fillStyle = C.haldi;
    ctx.fillRect(-58, -24, 116, 5);
    ctx.fillStyle = C.kagaz;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      rr(ctx, -50 + i * 19, -46, 14, 14, 3);
      ctx.fill();
    }
    ctx.beginPath();
    rr(ctx, 46, -46, 9, 30, 2);
    ctx.fill();
    ctx.fillStyle = C.syahi;
    ctx.fillRect(-58, -12, 116, 4);
    wheel(ctx, -34, -8, 9);
    wheel(ctx, 34, -8, 9);
    garlandDots(ctx, [[-50, -57], [-36, -59], [-22, -60], [-8, -60], [6, -60], [20, -60], [34, -59], [48, -57]]);
  } else if (mode === 'car') {
    ctx.fillStyle = C.rani;
    ctx.beginPath();
    ctx.moveTo(-30, -26); ctx.lineTo(-18, -46); ctx.lineTo(20, -46); ctx.lineTo(36, -26); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    rr(ctx, -56, -28, 112, 22, 8);
    ctx.fill();
    ctx.fillStyle = C.kagaz;
    ctx.beginPath();
    ctx.moveTo(-23, -28); ctx.lineTo(-15, -41); ctx.lineTo(-2, -41); ctx.lineTo(-2, -28); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(3, -28); ctx.lineTo(3, -41); ctx.lineTo(17, -41); ctx.lineTo(28, -28); ctx.closePath();
    ctx.fill();
    circle(ctx, 52, -20, 3.5, C.haldi);
    wheel(ctx, -32, -6, 10);
    wheel(ctx, 32, -6, 10);
    garlandDots(ctx, [[-20, -29], [-12, -24], [-3, -21], [6, -21], [15, -24], [23, -29]]);
  } else {
    // Train: a garlanded loco, nose to the right.
    ctx.fillStyle = C.rani;
    ctx.beginPath();
    ctx.moveTo(-60, -52);
    ctx.lineTo(34, -52);
    ctx.quadraticCurveTo(58, -50, 62, -26);
    ctx.lineTo(62, -14);
    ctx.lineTo(-60, -14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.haldi;
    ctx.fillRect(-60, -27, 122, 5);
    ctx.fillStyle = C.kagaz;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      rr(ctx, -52 + i * 20, -45, 13, 12, 3);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(34, -45); ctx.lineTo(44, -45); ctx.quadraticCurveTo(54, -42, 56, -33); ctx.lineTo(34, -33); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = C.syahi;
    ctx.fillRect(-56, -14, 116, 5);
    ctx.beginPath();
    ctx.moveTo(62, -14); ctx.lineTo(70, -2); ctx.lineTo(58, -2); ctx.closePath();
    ctx.fill();
    circle(ctx, 60, -40, 3.5, C.haldi);
    for (const wx of [-44, -26, 22, 40]) wheel(ctx, wx, -5, 7);
    ctx.fillStyle = C.syahi;
    ctx.fillRect(-20, -60, 14, 8);
    garlandDots(ctx, [[36, -50], [42, -46], [47, -41], [51, -35], [54, -29], [55, -22]]);
  }
  ctx.restore();
}

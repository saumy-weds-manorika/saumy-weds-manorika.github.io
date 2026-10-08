/**
 * js/audio.js: "Baaja", a procedurally synthesised dhol + shehnai (Web Audio API).
 * No audio files, no libraries. Off until the guest asks for it.
 *
 * Graph: voices -> bus (per play session, faded on stop) -> master (0.6) -> compressor -> out
 */

const BPM = 100;
const STEP = 60 / BPM / 2;                  // one eighth-note, in seconds (0.3s)
const PATTERN = ['dha', '-', 'na', 'ge', 'dha', '-', 'na', '-']; // chaal, one bar of 8 eighths
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.1;
const PHRASE_EVERY_BARS = 4;
const SA = 440;                             // Sa = A4

// Yaman-like scale (Sa Re Ga Ma# Pa Dha Ni), semitones from Sa; "." = lower octave, "'" = upper.
const SWARA = { 'Dha.': -3, 'Ni.': -1, Sa: 0, Re: 2, Ga: 4, Ma: 6, Pa: 7, Dha: 9, Ni: 11, "Sa'": 12 };
// An original ~4s phrase: [swara, seconds]. Notes glide into each other (60ms portamento).
const PHRASE = [
  ['Ni.', 0.28], ['Re', 0.24], ['Ga', 0.56], ['Ma', 0.2], ['Pa', 0.6], ['Ma', 0.18],
  ['Ga', 0.24], ['Re', 0.34], ['Ga', 0.3], ['Re', 0.22], ['Sa', 0.84],
];

const KINDS = new Set(['dha', 'ge', 'na']);

/**
 * @param {{onChange?:(on:boolean)=>void}} [opts] optional: notified when the loop starts/stops
 *   (including the automatic stop when the page is hidden). A `baaja:change` CustomEvent
 *   ({detail:{on}}) is also dispatched on window.
 * @returns {{readonly on:boolean, readonly state:string, toggle:()=>boolean, dholHit:(kind?:'dha'|'ge'|'na')=>void, shehnaiPhrase:()=>boolean, stop:()=>void}}
 */
export function createBaaja({ onChange } = {}) {
  let ctx = null;
  let master = null;
  let bus = null;
  let noise = null;
  let on = false;
  let timer = 0;
  let nextTime = 0;
  let step = 0;
  let bar = 0;
  let solo = null;            // manually triggered phrase { gain, end }

  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

  function emit() {
    if (typeof onChange === 'function') {
      try { onChange(on); } catch (e) { console.error(e); }
    }
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('baaja:change', { detail: { on } }));
    }
  }

  function newBus() {
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(master);
    return g;
  }

  /** Lazily create the context (must be inside a user gesture the first time) and resume it every call. */
  function ensure() {
    if (!AC) return null;
    if (!ctx) {
      try { ctx = new AC(); } catch { ctx = null; return null; }
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(comp);
      comp.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      bus = newBus();
    }
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* older Safari: resume may be missing */ }
    return ctx;
  }

  /** Percussive envelope: silent -> peak in `att` -> exponential decay to silence at `t + dec`. */
  function env(g, t, peak, att, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
  }

  function noiseSource(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }

  /** Bass "ge": 140->55 Hz sine sweep plus a low-passed noise thump. */
  function ge(t, v, out) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const g = ctx.createGain();
    env(g, t, 0.95 * v, 0.006, 0.45);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.5);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 0.7;
    const ng = ctx.createGain();
    env(ng, t, 0.7 * v, 0.003, 0.09);
    noiseSource(t, 0.12).connect(lp).connect(ng).connect(out);
  }

  /** Treble "na": 40ms band-passed noise burst (2.5 kHz, Q 1.2) plus a short 900 Hz triangle click. */
  function na(t, v, out) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    env(ng, t, 0.9 * v, 0.002, 0.04);
    noiseSource(t, 0.05).connect(bp).connect(ng).connect(out);

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 900;
    const g = ctx.createGain();
    env(g, t, 0.35 * v, 0.002, 0.03);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.04);
  }

  function dhol(kind, t, v = 1, out = bus) {
    if (kind === 'ge' || kind === 'dha') ge(t, v, out);
    if (kind === 'na' || kind === 'dha') na(t, v, out);
  }

  /**
   * One shehnai phrase starting at t0: sawtooth + square through two band-pass formants
   * (~1.1 kHz, ~2.6 kHz) and a 4 kHz low-pass, 5.5 Hz vibrato at ±12 cents,
   * 60ms attack / 120ms release per note, 60ms glides between notes.
   */
  function phrase(t0, out) {
    const pg = ctx.createGain();               // per-phrase gain, so a phrase can be cut short
    pg.gain.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000;
    lp.Q.value = 0.5;
    lp.connect(pg).connect(out);

    const voice = ctx.createGain();
    voice.gain.value = 1;
    const formants = [[1100, 3, 1.4], [2600, 4, 0.8]];
    for (const [f, q, level] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      voice.connect(bp).connect(g).connect(lp);
    }
    const dry = ctx.createGain();
    dry.gain.value = 0.16;
    voice.connect(dry).connect(lp);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 12;                     // cents, applied to oscillator detune
    lfo.connect(depth);

    let t = t0;
    let prev = 0;
    for (const [sw, dur] of PHRASE) {
      const f = SA * 2 ** (SWARA[sw] / 12);
      const ne = ctx.createGain();
      ne.gain.setValueAtTime(0.0001, t);
      ne.gain.exponentialRampToValueAtTime(0.42, t + 0.06);
      ne.gain.setValueAtTime(0.42, t + dur);
      ne.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
      ne.connect(voice);
      for (const [type, level] of [['sawtooth', 0.55], ['square', 0.25]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(prev || f, t);
        if (prev) o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        depth.connect(o.detune);
        const mix = ctx.createGain();
        mix.gain.value = level;
        o.connect(mix).connect(ne);
        o.start(t);
        o.stop(t + dur + 0.14);
      }
      prev = f;
      t += dur;
    }
    lfo.start(t0);
    lfo.stop(t + 0.2);
    return { gain: pg, end: t + 0.15 };
  }

  function fadeOut(g, dur) {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + dur);
  }

  /** Lookahead scheduler: every 25ms, schedule whatever falls in the next 0.1s. */
  function tick() {
    if (!on || !ctx) return;
    const now = ctx.currentTime;
    if (nextTime < now - 0.2) nextTime = now + 0.05; // we fell behind (tab throttled): skip, don't burst
    while (nextTime < now + SCHEDULE_AHEAD) {
      const i = step % PATTERN.length;
      const kind = PATTERN[i];
      if (kind !== '-') dhol(kind, nextTime, (i === 0 ? 1 : 0.8) * (0.95 + Math.random() * 0.1));
      if (i === 0 && bar % PHRASE_EVERY_BARS === 1) phrase(nextTime, bus);
      nextTime += STEP;
      step++;
      if (step % PATTERN.length === 0) bar++;
    }
  }

  function stop() {
    const was = on;
    on = false;
    clearInterval(timer);
    timer = 0;
    if (ctx) {
      const old = bus;
      fadeOut(old, 0.15);
      setTimeout(() => { try { old.disconnect(); } catch { /* already gone */ } }, 250);
      bus = newBus();
      solo = null;
    }
    if (was) emit();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stop();
    });
  }

  return {
    get on() { return on; },
    /** 'unsupported' | 'idle' (no context yet) | AudioContext.state */
    get state() { return !AC ? 'unsupported' : ctx ? ctx.state : 'idle'; },
    toggle() {
      if (on) { stop(); return false; }
      if (!ensure()) return false;
      on = true;
      nextTime = ctx.currentTime + 0.06;
      step = 0;
      bar = 0;
      tick();
      timer = setInterval(tick, LOOKAHEAD_MS);
      emit();
      return true;
    },
    dholHit(kind = 'dha') {
      if (!ensure()) return;
      dhol(KINDS.has(kind) ? kind : 'dha', ctx.currentTime + 0.005, 1);
    },
    shehnaiPhrase() {
      if (!ensure()) return false;
      if (solo && solo.end > ctx.currentTime) fadeOut(solo.gain, 0.06);
      solo = phrase(ctx.currentTime + 0.03, bus);
      return true;
    },
    stop,
  };
}

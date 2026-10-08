// The wedding band (assets/band-audio.m4a) behind the Baaja button.
//
// Saumy wants it ON by default and muted by the first tap on Baaja. Browsers never let a page start
// sound by itself, so "on by default" means: try to play straight away, and if the browser blocks it,
// start on the guest's first touch, key press or scroll gesture anywhere on the page. A first touch
// on the Baaja button itself mutes instead. Muting is remembered for this visit (sessionStorage).

const MUTED_KEY = 'stt.band.muted';
const VOLUME = 0.55;
const FADE_MS = 900;

/**
 * @param {{src:string, toggle:HTMLElement, onChange?:(on:boolean)=>void}} opts
 *   toggle: the Baaja button (gestures on it never auto-start the band)
 * @returns {{readonly on:boolean, toggle:()=>boolean}} `on` = sound wanted (not muted)
 */
export function createBand({ src, toggle, onChange }) {
  let wantOn = !readMuted();
  let started = false;
  let fadeTimer = 0;
  const audio = typeof Audio === 'function' ? new Audio() : null;
  if (audio) {
    audio.src = src;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
  }

  const notify = () => { if (typeof onChange === 'function') onChange(wantOn); };

  function fadeTo(target, then) {
    clearInterval(fadeTimer);
    if (!audio) return;
    const from = audio.volume;
    const steps = 18;
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      audio.volume = Math.max(0, Math.min(1, from + ((target - from) * i) / steps));
      if (i >= steps) {
        clearInterval(fadeTimer);
        if (then) then();
      }
    }, FADE_MS / steps);
  }

  function play() {
    if (!audio || !wantOn) return;
    let p;
    try { p = audio.play(); } catch { return; }
    const ok = () => {
      started = true;
      disarm();
      fadeTo(VOLUME);
    };
    if (p && typeof p.then === 'function') p.then(ok, () => { /* blocked until a gesture */ });
    else ok();
  }

  function pause() {
    if (!audio) return;
    fadeTo(0, () => audio.pause());
  }

  // Start on the first real gesture anywhere, except on the Baaja button (that tap means "mute").
  const EVENTS = ['pointerdown', 'touchstart', 'keydown'];
  function onGesture(e) {
    if (toggle && e.target instanceof Node && toggle.contains(e.target)) return;
    play();
  }
  function arm() { EVENTS.forEach((t) => window.addEventListener(t, onGesture, { capture: true, passive: true })); }
  function disarm() { EVENTS.forEach((t) => window.removeEventListener(t, onGesture, { capture: true })); }

  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) {
      clearInterval(fadeTimer);
      audio.pause();
    } else if (wantOn && started) {
      play();
    }
  });

  if (wantOn) {
    arm();
    play(); // works where the browser allows it (e.g. a returning desktop visitor); otherwise waits for a gesture
  }
  notify();

  return {
    get on() { return wantOn; },
    toggle() {
      wantOn = !wantOn;
      writeMuted(!wantOn);
      if (wantOn) {
        arm();
        play(); // this click is itself a gesture, so playback is allowed now
      } else {
        disarm();
        pause();
      }
      notify();
      return wantOn;
    },
  };
}

function readMuted() {
  try { return sessionStorage.getItem(MUTED_KEY) === '1'; } catch { return false; }
}
function writeMuted(muted) {
  try {
    if (muted) sessionStorage.setItem(MUTED_KEY, '1');
    else sessionStorage.removeItem(MUTED_KEY);
  } catch { /* the choice just isn't remembered */ }
}

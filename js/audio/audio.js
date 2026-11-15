// UTTARAKHAND RIDERS — procedural game audio.
// 100% Web Audio API synthesis (no audio files): superbike engines, ride noise, wildlife & town one-shots,
// zone ambience beds, and a look-ahead music sequencer (Pahadi folk menu theme, dhol-electronic race theme).
//
//   import { Audio } from './audio/audio.js';
//   button.onclick = () => Audio.unlock();          // must be called from a user gesture (iOS / Android)
//   Audio.playMusic('menu');
//   const eng = Audio.createEngine('zx10r');        // per frame: eng.update({ rpm, throttle, speed, gear })
//
// Signal flow:
//   engines ─► engineBus ┐
//   ride    ─► rideBus   ├─► gameDuck (pause) ─► sfxBus (sfx volume) ─┐
//   ambience─► ambBus    │                                            ├─► master ─► compressor ─► out
//   one-shot─► fxBus ────┘   (+ valley echo send)                     │
//   ui ─────────────────────► uiBus ─► sfxBus                         │
//   music tracks ─► musicIn ─► musicBus (music volume) ─► musicDuck ──┘   (+ convolver reverb, ping-pong delay)

const MAX_VOICES = 12;      // concurrent gameplay one-shots
const MAX_UI_VOICES = 8;
const SA = 293.66;          // music tonic "Sa" = D4

let ctx = null;             // AudioContext
let N = null;               // node registry (buses / fx)
let BUF = null;             // cached noise buffers
let W = null;               // cached periodic waves
let unlockedOnce = false;
let paused = false;
let mobile = false;
let wantedMusic = null;
let curTrack = null;
let ride = null;
let ambTimer = null;

const vol = { master: 0.9, music: 0.6, sfx: 0.9 };
const ambLevels = { forest: 0, river: 0, town: 0, mountain: 0, waterfall: 0, crowd: 0, temple: 0, insects: 0 };
const LIS = { x: 0, y: 0, z: 0 };   // listener position (for engine distance / doppler)
const voices = [];
const uiVoices = [];
const beds = {};
const engines = new Set();
const curveCache = new Map();
const warned = new Set();

// ------------------------------------------------------------------------------------------- small helpers
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const nyq = () => (ctx ? ctx.sampleRate * 0.5 - 100 : 20000);
const clampF = f => Math.min(Math.max(f, 10), nyq());
const nf = semi => SA * Math.pow(2, semi / 12);            // note frequency, semitones relative to Sa (D4)
const P = o => (o && o.pitch) || 1;

function G(v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
function F(type, freq, Q = 1, gain = 0) {
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = clampF(freq); f.Q.value = Q;
  if (gain) f.gain.value = gain;
  return f;
}
/** oscillator: type string or PeriodicWave; started at t0, stopped at t1 (if given) */
function O(type, freq, t0, t1, dest) {
  const o = ctx.createOscillator();
  if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
  o.frequency.setValueAtTime(freq, t0);
  if (dest) o.connect(dest);
  o.start(t0);
  if (t1 != null) o.stop(t1);
  return o;
}
/** looping noise source with random start offset */
function NS(buf, t0, t1, dest, rate = 1) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  if (rate !== 1) s.playbackRate.value = rate;
  if (dest) s.connect(dest);
  s.start(t0, Math.random() * Math.max(0, buf.duration - 0.6));
  if (t1 != null) s.stop(t1);
  return s;
}
function chain(...ns) { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; }
/** piecewise envelope. pts = [[dt, value, 'lin'|'exp'|'set'], ...] relative to t0 (first point = setValue) */
function env(param, t0, pts) {
  for (let i = 0; i < pts.length; i++) {
    const [dt, v, type] = pts[i]; const t = t0 + dt;
    if (i === 0 || type === 'set') param.setValueAtTime(v, t);
    else if (type === 'exp') param.exponentialRampToValueAtTime(Math.max(v, 1e-4), t);
    else param.linearRampToValueAtTime(v, t);
  }
}
function curve(k) {
  const key = k.toFixed(2); let c = curveCache.get(key);
  if (!c) {
    const n = 2048; c = new Float32Array(n); const tk = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / tk; }
    curveCache.set(key, c);
  }
  return c;
}
function shaper(k = 2, os = 'none') { const s = ctx.createWaveShaper(); s.curve = curve(k); s.oversample = os; return s; }
function setPos(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else if (p.setPosition) p.setPosition(x, y, z);
}
function makePanner(pos, ref = 8, max = 300, roll = 1.1) {
  const p = ctx.createPanner();
  p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
  p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = roll;
  setPos(p, pos.x || 0, pos.y || 0, pos.z || 0);
  return p;
}
function stereoPanner(pan) {
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); return p; }
  // very old Safari fallback: place a panner next to the listener
  const p = ctx.createPanner(); p.panningModel = 'equalpower'; const a = pan * Math.PI / 2;
  setPos(p, LIS.x + Math.sin(a), LIS.y, LIS.z - Math.cos(a));
  return p;
}

// ------------------------------------------------------------------------------------------- buffers & waves
function makeBuffers() {
  const sr = ctx.sampleRate;
  const mk = (sec, fill) => {
    const len = Math.floor(sr * sec), X = Math.floor(sr * 0.05);
    const tmp = new Float32Array(len + X); fill(tmp);
    let peak = 1e-6; for (let i = 0; i < tmp.length; i++) peak = Math.max(peak, Math.abs(tmp[i]));
    const k = 0.95 / peak;
    const b = ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = tmp[i] * k;
    for (let i = 0; i < X; i++) { const w = i / X; d[i] = (tmp[i] * w + tmp[len + i] * (1 - w)) * k; } // seamless loop
    return b;
  };
  const white = mk(2, a => { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; });
  const pink = mk(mobile ? 3 : 4, a => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < a.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
    }
  });
  const brown = mk(mobile ? 3 : 4, a => {
    let last = 0; for (let i = 0; i < a.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; a[i] = last; }
  });
  const crackle = mk(2, a => {
    a.fill(0); const dens = 260 / sr;
    for (let i = 0; i < a.length; i++) {
      if (Math.random() < dens) {
        const amp = (0.2 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
        const Ln = Math.floor(sr * (0.0008 + Math.random() * 0.003));
        for (let j = 0; j < Ln && i + j < a.length; j++) a[i + j] += amp * Math.exp(-j / (Ln * 0.3)) * (Math.random() * 2 - 1);
      }
    }
  });
  return { white, pink, brown, crackle };
}
function makeIR(sec) {
  const sr = ctx.sampleRate, len = Math.floor(sr * sec);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const dec = Math.pow(1 - u, 2.0) * Math.exp(-u * 2.5);
      const a = 0.85 - 0.75 * u; // brighter early reflections, darker tail
      lp += ((Math.random() * 2 - 1) - lp) * a;
      d[i] = lp * dec * (i < sr * 0.006 ? i / (sr * 0.006) : 1);
    }
  }
  return b;
}
/** periodic wave from harmonic amplitudes (sine series) */
function harmWave(amps) {
  const re = new Float32Array(amps.length + 1), im = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => { im[i + 1] = a; });
  return ctx.createPeriodicWave(re, im);
}
/** band-limited rectangular pulse train (for gating LFOs) */
function pulseWave(duty, H = 32) {
  const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(re, im);
}

// ------------------------------------------------------------------------------------------- graph
function buildGraph() {
  const n = {};
  n.master = G(vol.master);
  n.comp = ctx.createDynamicsCompressor();
  n.comp.threshold.value = -14; n.comp.knee.value = 10; n.comp.ratio.value = 4;
  n.comp.attack.value = 0.004; n.comp.release.value = 0.22;
  n.master.connect(n.comp); n.comp.connect(ctx.destination);

  n.musicBus = G(vol.music); n.musicDuck = G(1); n.musicBus.connect(n.musicDuck); n.musicDuck.connect(n.master);
  n.sfxBus = G(vol.sfx); n.sfxBus.connect(n.master);
  n.uiBus = G(0.8); n.uiBus.connect(n.sfxBus);
  n.gameDuck = G(1); n.gameDuck.connect(n.sfxBus);
  n.fxBus = G(0.9); n.fxBus.connect(n.gameDuck);
  n.engineBus = G(0.85); n.engineBus.connect(n.gameDuck);
  n.ambBus = G(0.8); n.ambBus.connect(n.gameDuck);
  n.rideBus = G(0.9); n.rideBus.connect(n.gameDuck);

  // valley echo (cheap feedback delays) for one-shots & ambience
  n.echoIn = G(1);
  const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
  d1.delayTime.value = 0.19; d2.delayTime.value = 0.33;
  const l1 = F('lowpass', 2400, 0.5), l2 = F('lowpass', 1700, 0.5), fb1 = G(0.32), fb2 = G(0.27);
  n.echoIn.connect(d1); chain(d1, l1, fb1, d1);
  n.echoIn.connect(d2); chain(d2, l2, fb2, d2);
  const pl = stereoPanner(-0.5), pr = stereoPanner(0.5), echoOut = G(0.42);
  l1.connect(pl); l2.connect(pr); pl.connect(echoOut); pr.connect(echoOut); echoOut.connect(n.gameDuck);

  // music fx: convolution reverb + ping-pong delay
  n.musicIn = G(1); n.musicIn.connect(n.musicBus);
  n.revIn = G(1); n.rev = ctx.createConvolver(); n.rev.buffer = makeIR(mobile ? 1.3 : 2.1);
  const revOut = G(0.5); chain(n.revIn, n.rev, revOut, n.musicBus);
  n.delayIn = G(1);
  n.dl = ctx.createDelay(2); n.dr = ctx.createDelay(2); n.dl.delayTime.value = n.dr.delayTime.value = 0.3;
  const dlp = F('lowpass', 3200, 0.5), drp = F('lowpass', 2600, 0.5), fbl = G(0.36), fbr = G(0.36);
  const ppl = stereoPanner(-0.7), ppr = stereoPanner(0.7), dOut = G(0.45);
  n.delayIn.connect(n.dl); n.dl.connect(dlp); dlp.connect(ppl); dlp.connect(fbl); fbl.connect(n.dr);
  n.dr.connect(drp); drp.connect(ppr); drp.connect(fbr); fbr.connect(n.dl);
  ppl.connect(dOut); ppr.connect(dOut); dOut.connect(n.musicBus);
  return n;
}

function createContext() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; return null; } }
  return ctx;
}

function buildAll() {
  if (N) return;
  mobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  BUF = makeBuffers();
  W = {
    engine: {},
    flute: harmWave([1, 0.38, 0.14, 0.07, 0.035, 0.015]),
    cricket: pulseWave(0.22),
  };
  N = buildGraph();
  const tryResume = () => { if (ctx && unlockedOnce && ctx.state !== 'running' && ctx.state !== 'closed' && !document.hidden) ctx.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {}); else tryResume();
  });
  window.addEventListener('pageshow', tryResume);
  for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, tryResume, { passive: true });
  ambTimer = setInterval(ambTick, 250);
}

function afterUnlock() {
  applyVolumes();
  if (wantedMusic && (!curTrack || curTrack.name !== wantedMusic)) startTrack(wantedMusic, 1.5);
  const lv = { ...ambLevels }; for (const k in lv) if (lv[k] > 0) setAmbienceImpl({ [k]: lv[k] });
}

function applyVolumes() {
  if (!N) return;
  const t = ctx.currentTime;
  N.master.gain.setTargetAtTime(vol.master, t, 0.03);
  N.musicBus.gain.setTargetAtTime(vol.music, t, 0.03);
  N.sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.03);
}

// ------------------------------------------------------------------------------------------- voices
function voice(dur, o = {}) {
  const t = ctx.currentTime;
  const list = o.ui ? uiVoices : voices;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].end <= t) list.splice(i, 1);
  const cap = o.ui ? MAX_UI_VOICES : MAX_VOICES;
  const prio = o.prio ?? 0;
  const limit = prio < 0 ? cap - 3 : cap;         // ambient one-shots leave headroom for gameplay sounds
  if (list.length >= limit) {
    if (prio <= 0) return null;
    const old = list.shift();
    try { old.out.gain.cancelScheduledValues(t); old.out.gain.setTargetAtTime(0, t, 0.015); } catch (e) { /* noop */ }
  }
  const out = G(o.volume ?? 1);
  let tail = out;
  if (o.lp) { const f = F('lowpass', o.lp, 0.7); tail.connect(f); tail = f; }
  if (o.pos) { const p = makePanner(o.pos, o.ref ?? 8, o.max ?? 300); tail.connect(p); tail = p; }
  else if (o.pan) { const p = stereoPanner(o.pan); tail.connect(p); tail = p; }
  tail.connect(o.bus || N.fxBus);
  let send = null;
  if (o.echo > 0) { send = G(o.echo); tail.connect(send); send.connect(N.echoIn); }
  const v = { end: t + dur, out };
  list.push(v);
  setTimeout(() => {
    try { out.disconnect(); } catch (e) { /* noop */ }
    try { tail.disconnect(); } catch (e) { /* noop */ }
    if (send) try { send.disconnect(); } catch (e) { /* noop */ }
  }, (dur + 1.5) * 1000);
  return v;
}

function playOne(lib, name, o = {}, isUI = false) {
  if (!ctx || !N || ctx.state === 'closed') return false;
  const def = lib[name];
  if (!def) { if (!warned.has(name)) { warned.add(name); console.warn('[audio] unknown sound:', name); } return false; }
  const dur = typeof def.dur === 'function' ? def.dur(o) : def.dur;
  const v = voice(dur, {
    ui: isUI, pos: o.pos, pan: o.pan, lp: o.lp,
    volume: (o.volume ?? 1) * (def.vol ?? 1),
    prio: o.prio ?? def.prio ?? 0,
    echo: isUI ? 0 : (o.echo ?? def.echo ?? 0),
    ref: o.ref ?? def.ref,
    bus: isUI ? N.uiBus : (o.bus || N.fxBus),
  });
  if (!v) return false;
  try { def.fn(ctx.currentTime + 0.004, v.out, o); } catch (e) { console.warn('[audio] sound failed:', name, e); }
  return true;
}

// ------------------------------------------------------------------------------------------- shared voices
/** whistle-like sine note with optional glide & 2nd harmonic (birds, whistles) */
function bird(t, f0, f1, d, vel, out, h2 = 0.1) {
  const o = O('sine', f0, t, t + d + 0.05, null);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + d);
  const g = G(0); chain(o, g, out);
  const a = Math.min(0.03, d * 0.25);
  env(g.gain, t, [[0, 0], [a, vel], [d * 0.75, vel * 0.85], [d, 0.0001, 'exp']]);
  if (h2 > 0) {
    const o2 = O('sine', f0 * 2, t, t + d + 0.05, null);
    if (f1 !== f0) o2.frequency.exponentialRampToValueAtTime(f1 * 2, t + d);
    const g2 = G(0); chain(o2, g2, out);
    env(g2.gain, t, [[0, 0], [a, vel * h2], [d, 0.0001, 'exp']]);
  }
}
function tone(t, f, dur, vel, type, out, att = 0.004, f1 = 0) {
  const o = O(type, f, t, t + dur + 0.05, null);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = G(0); chain(o, g, out);
  env(g.gain, t, [[0, 0], [att, vel], [dur, 0.0001, 'exp']]);
}
function brass(t, f, dur, vel, out) {
  const a = O('sawtooth', f, t, t + dur + 0.25, null), b = O('sawtooth', f * 1.004, t, t + dur + 0.25, null);
  const lp = F('lowpass', 800, 1.2), g = G(0);
  a.connect(lp); b.connect(lp); chain(lp, g, out);
  env(lp.frequency, t, [[0, 700], [0.06, 3200, 'exp'], [dur, 1600, 'exp']]);
  env(g.gain, t, [[0, 0], [0.03, vel], [dur, vel * 0.7], [dur + 0.2, 0.0001, 'exp']]);
}

// ------------------------------------------------------------------------------------------- one-shot SFX
// each: { dur, prio?, echo?, ref?, vol?, fn(t, out, opts) }
const SFX = {
  horn: { dur: 0.6, ref: 10, vol: 0.85, fn(t, out, o) {
    const f = 415 * P(o), d = o.duration || 0.38;
    const sq = O('square', f * 0.97, t, t + d + 0.08, null); sq.frequency.linearRampToValueAtTime(f, t + 0.03);
    const sw = O('sawtooth', f * 2.006, t, t + d + 0.08, null);
    const g2 = G(0.22), gd = G(0.35), bp = F('bandpass', 1900, 0.7), lp = F('lowpass', 3800, 0.7), sh = shaper(1.8), g = G(0);
    sw.connect(g2); g2.connect(bp); sq.connect(bp); sq.connect(gd); gd.connect(sh); bp.connect(sh); chain(sh, lp, g, out);
    env(g.gain, t, [[0, 0], [0.012, 0.55], [d, 0.48], [d + 0.06, 0.0001, 'exp']]);
  } },
  busHorn: { dur: 1.2, ref: 14, echo: 0.3, vol: 0.8, fn(t, out, o) {
    const p = P(o), sh = shaper(3), pk = F('peaking', 900, 1, 5), lp = F('lowpass', 2600, 0.8), g = G(0);
    for (const f of [293 * p, 370 * p]) { O('sawtooth', f, t, t + 1.05, sh); O('sawtooth', f * 1.004, t, t + 1.05, sh); }
    chain(sh, pk, lp, g, out);
    env(g.gain, t, [[0, 0], [0.02, 0.36], [0.3, 0.32], [0.33, 0.0001, 'exp'], [0.44, 0.0001], [0.47, 0.38, 'lin'], [0.95, 0.32], [1.0, 0.0001, 'exp']]);
  } },
  truckHorn: { dur: 2.0, ref: 14, echo: 0.3, vol: 0.78, fn(t, out, o) {
    const p = P(o), notes = [392, 523.25, 659.25, 783.99, 659.25, 783.99], durs = [0.15, 0.15, 0.15, 0.3, 0.15, 0.55];
    const o1 = O('sawtooth', notes[0] * p, t, t + 1.75, null), o2 = O('square', notes[0] * p * 1.003, t, t + 1.75, null);
    const g2 = G(0.5), sh = shaper(3.5), bp = F('bandpass', 1400, 0.8), lp = F('lowpass', 3500, 0.7), g = G(0);
    o2.connect(g2); o1.connect(sh); g2.connect(sh); chain(sh, bp, lp, g, out);
    let tt = t; const pts = [[0, 0]];
    notes.forEach((f, i) => {
      o1.frequency.setValueAtTime(f * p, tt); o2.frequency.setValueAtTime(f * p * 1.003, tt);
      const r = tt - t; pts.push([r + 0.012, 0.42, 'lin'], [r + durs[i] - 0.02, 0.38, 'lin'], [r + durs[i] - 0.005, 0.06, 'lin']);
      tt += durs[i];
    });
    pts.push([tt - t + 0.05, 0.0001, 'exp']);
    env(g.gain, t, pts);
  } },
  autoHorn: { dur: 0.6, ref: 8, vol: 0.75, fn(t, out, o) {
    const sq = O('square', 690 * P(o), t, t + 0.4, null), bp = F('bandpass', 1700, 1), lp = F('lowpass', 4000, 0.7), g = G(0);
    chain(sq, bp, lp, g, out);
    env(g.gain, t, [[0, 0], [0.008, 0.45], [0.11, 0.4], [0.125, 0.0001, 'exp'], [0.19, 0.0001], [0.2, 0.45, 'lin'], [0.31, 0.4], [0.33, 0.0001, 'exp']]);
  } },
  crash: { dur: 1.9, prio: 2, echo: 0.22, vol: 0.7, fn(t, out) {
    const th = O('sine', 78, t, t + 0.6, null); th.frequency.exponentialRampToValueAtTime(32, t + 0.35);
    const tg = G(0); chain(th, tg, out); env(tg.gain, t, [[0, 0], [0.004, 0.95], [0.55, 0.0001, 'exp']]);
    const n = NS(BUF.white, t, t + 1.0, null), nl = F('lowpass', 5000, 0.6), ng = G(0); chain(n, nl, ng, out);
    env(nl.frequency, t, [[0, 6000], [0.8, 700, 'exp']]);
    env(ng.gain, t, [[0, 0], [0.003, 0.7], [0.12, 0.32], [0.95, 0.0001, 'exp']]);
    for (const f of [523, 811, 1187, 1679, 2333, 3121]) {
      const d = 0.25 + Math.random() * 0.7, m = O('sine', f * rand(0.94, 1.06), t, t + d + 0.05, null), mg = G(0);
      chain(m, mg, out); env(mg.gain, t, [[0, 0], [0.002, 0.1], [d, 0.0001, 'exp']]);
    }
    const s = NS(BUF.crackle, t + 0.05, t + 1.85, null, 1.4), sh = F('highpass', 1800, 0.7), sb = F('bandpass', 3300, 1.4), sg = G(0);
    chain(s, sh, sb, sg, out); env(sg.gain, t + 0.05, [[0, 0], [0.1, 0.9, 'lin'], [1.7, 0.0001, 'exp']]);
    const c = NS(BUF.crackle, t, t + 0.5, null, 0.7), cb = F('bandpass', 900, 1), cg = G(0); chain(c, cb, cg, out);
    env(cg.gain, t, [[0, 0], [0.005, 1.4, 'lin'], [0.45, 0.0001, 'exp']]);
  } },
  bump: { dur: 0.4, prio: 1, fn(t, out) {
    const th = O('sine', 95, t, t + 0.3, null); th.frequency.exponentialRampToValueAtTime(48, t + 0.15);
    const tg = G(0); chain(th, tg, out); env(tg.gain, t, [[0, 0], [0.004, 0.8], [0.26, 0.0001, 'exp']]);
    const n = NS(BUF.white, t, t + 0.1, null), nl = F('lowpass', 1200, 0.7), ng = G(0); chain(n, nl, ng, out);
    env(ng.gain, t, [[0, 0], [0.002, 0.4], [0.07, 0.0001, 'exp']]);
    const k = NS(BUF.white, t, t + 0.12, null), kb = F('bandpass', 380, 5), kg = G(0); chain(k, kb, kg, out);
    env(kg.gain, t, [[0, 0], [0.002, 1.4], [0.09, 0.0001, 'exp']]);
  } },
  backfire: { dur: 0.5, ref: 8, vol: 0.75, fn(t, out, o) {
    const n = NS(BUF.white, t, t + 0.15, null), b = F('bandpass', 650 * P(o), 1.2), sh = shaper(4), g = G(0);
    chain(n, b, sh, g, out); env(g.gain, t, [[0, 0], [0.002, 0.8], [0.04, 0.22], [0.12, 0.0001, 'exp']]);
    const th = O('sine', 70, t, t + 0.15, null); th.frequency.exponentialRampToValueAtTime(40, t + 0.08);
    const tg = G(0); chain(th, tg, out); env(tg.gain, t, [[0, 0], [0.003, 0.8], [0.12, 0.0001, 'exp']]);
    const c = NS(BUF.crackle, t + 0.03, t + 0.42, null, 1.2), ch = F('highpass', 1400, 0.7), cg = G(0); chain(c, ch, cg, out);
    env(cg.gain, t + 0.03, [[0, 0], [0.01, 0.9, 'lin'], [0.35, 0.0001, 'exp']]);
  } },
  cowMoo: { dur: 2.0, echo: 0.15, ref: 10, fn(t, out, o) {
    const f0 = 104 * P(o) * rand(0.9, 1.1), src = G(1);
    const cv = (osc, m) => env(osc.frequency, t, [[0, f0 * 0.94 * m], [0.32, f0 * 1.3 * m, 'exp'], [0.95, f0 * 1.24 * m, 'exp'], [1.55, f0 * 0.9 * m, 'exp'], [1.9, f0 * 0.78 * m, 'exp']]);
    const s1 = O('sawtooth', f0, t, t + 1.95, src); cv(s1, 1);
    const s2 = O('sawtooth', f0, t, t + 1.95, null); cv(s2, 1.006); const s2g = G(0.6); s2.connect(s2g); s2g.connect(src);
    const vib = O('sine', 5.3, t, t + 1.95, null), vg = G(2.2); vib.connect(vg); vg.connect(s1.frequency); vg.connect(s2.frequency);
    const lp = F('lowpass', 300, 1.1); env(lp.frequency, t, [[0, 260], [0.32, 1100, 'exp'], [1.0, 1450, 'exp'], [1.6, 650, 'exp'], [1.95, 280, 'exp']]);
    src.connect(lp);
    const f1 = F('bandpass', 320, 4.5), f2 = F('bandpass', 760, 5.5), dg = G(0.45), g1 = G(1.3), g2 = G(0.9), amp = G(0);
    env(f1.frequency, t, [[0, 300], [0.35, 390], [1.0, 680], [1.6, 420]]);
    env(f2.frequency, t, [[0, 700], [0.35, 830], [1.0, 1080], [1.6, 760]]);
    lp.connect(dg); lp.connect(f1); lp.connect(f2); f1.connect(g1); f2.connect(g2);
    dg.connect(amp); g1.connect(amp); g2.connect(amp); amp.connect(out);
    env(amp.gain, t, [[0, 0], [0.22, 0.55, 'lin'], [1.3, 0.5], [1.85, 0.0001, 'exp']]);
    const br = NS(BUF.pink, t, t + 1.9, null), bb = F('bandpass', 1300, 0.8), bgn = G(0); chain(br, bb, bgn, out);
    env(bgn.gain, t, [[0, 0], [0.3, 0.07, 'lin'], [1.5, 0.05], [1.85, 0.0001, 'exp']]);
  } },
  tigerRoar: { dur: 2.8, prio: 1, echo: 0.35, ref: 14, vol: 0.55, fn(t, out, o) {
    const f0 = 92 * P(o), src = G(1);
    const cv = (osc, m) => env(osc.frequency, t, [[0, f0 * 0.75 * m], [0.42, f0 * 1.55 * m, 'exp'], [1.1, f0 * 1.32 * m, 'exp'], [2.0, f0 * 0.85 * m, 'exp'], [2.6, f0 * 0.6 * m, 'exp']]);
    const a = O('sawtooth', f0, t, t + 2.7, src); cv(a, 1);
    const b = O('sawtooth', f0, t, t + 2.7, src); cv(b, 1.013);
    const sub = O('square', f0 / 2, t, t + 2.7, null); cv(sub, 0.5); const sg = G(0.45); sub.connect(sg); sg.connect(src);
    const nz = NS(BUF.pink, t, t + 2.7, null), nb = F('bandpass', 650, 0.8), ng = G(0.9); chain(nz, nb, ng, src);
    const am = G(0.6); src.connect(am);                                   // growl: square AM ~ 25 Hz
    const lfo = O('square', 27, t, t + 2.7, null); lfo.frequency.linearRampToValueAtTime(21, t + 2.4);
    const lg = G(0.38); lfo.connect(lg); lg.connect(am.gain);
    const sh = shaper(4.5); am.connect(sh);
    const F1 = F('bandpass', 520, 2.4), F2 = F('bandpass', 1150, 3), F3 = F('bandpass', 2500, 4), LP = F('lowpass', 1600, 0.7);
    env(F1.frequency, t, [[0, 420], [0.5, 650], [1.4, 560], [2.5, 430]]);
    env(F2.frequency, t, [[0, 980], [0.5, 1300], [1.4, 1150], [2.5, 950]]);
    const g1 = G(1.1), g2 = G(0.7), g3 = G(0.25), gl = G(0.5), amp = G(0);
    sh.connect(F1); sh.connect(F2); sh.connect(F3); sh.connect(LP);
    F1.connect(g1); F2.connect(g2); F3.connect(g3); LP.connect(gl);
    g1.connect(amp); g2.connect(amp); g3.connect(amp); gl.connect(amp); amp.connect(out);
    env(amp.gain, t, [[0, 0], [0.18, 0.35, 'lin'], [0.5, 0.75, 'lin'], [1.35, 0.62], [2.6, 0.0001, 'exp']]);
    const r = O('sine', f0 * 0.5, t, t + 2.7, null); cv(r, 0.5); const rg = G(0); chain(r, rg, out);
    env(rg.gain, t, [[0, 0], [0.4, 0.4, 'lin'], [1.4, 0.3], [2.5, 0.0001, 'exp']]);
  } },
  snakeHiss: { dur: 1.7, ref: 5, vol: 0.4, fn(t, out) {
    const n = NS(BUF.white, t, t + 1.6, null), hp = F('highpass', 2800, 0.7), pk = F('peaking', 6500, 1, 6), lp = F('lowpass', 11000, 0.7), am = G(1), g = G(0);
    chain(n, hp, pk, lp, am, g, out);
    const lfo = O('sine', 2.6, t, t + 1.6, null), lg = G(0.18); lfo.connect(lg); lg.connect(am.gain);
    env(g.gain, t, [[0, 0], [0.09, 0.45, 'lin'], [0.5, 0.38], [1.2, 0.32], [1.55, 0.0001, 'exp']]);
  } },
  monkey: { dur: 1.8, echo: 0.3, ref: 9, vol: 0.75, fn(t, out, o) {
    const whoop = Math.random() < 0.35, n = whoop ? irand(2, 4) : irand(4, 8), p = P(o);
    let tt = t;
    for (let i = 0; i < n && tt < t + 1.55; i++) {
      const d = whoop ? 0.2 : rand(0.07, 0.12), f = (whoop ? 360 + i * 30 : rand(850, 1350)) * p;
      const s = O('sawtooth', f, tt, tt + d + 0.03, null);
      if (whoop) env(s.frequency, tt, [[0, f * 0.7], [d * 0.6, f * 1.3, 'exp'], [d, f * 1.05, 'exp']]);
      else env(s.frequency, tt, [[0, f * 1.12], [d, f * 0.82, 'exp']]);
      const b1 = F('bandpass', f * 1.7, 3), b2 = F('bandpass', 2800, 4), g = G(0), g2 = G(0.5);
      s.connect(b1); s.connect(b2); b1.connect(g); b2.connect(g2); g2.connect(g); g.connect(out);
      env(g.gain, tt, [[0, 0], [0.01, whoop ? 0.9 : 0.75], [d, 0.0001, 'exp']]);
      tt += d + (whoop ? 0.12 : rand(0.035, 0.09));
    }
  } },
  dogBark: { dur: 1.3, echo: 0.25, ref: 9, fn(t, out, o) {
    const n = irand(1, 3), p = P(o);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const f = rand(380, 470) * p;
      const s = O('sawtooth', f * 1.1, tt, tt + 0.2, null); env(s.frequency, tt, [[0, f * 1.1], [0.03, f, 'exp'], [0.15, f * 0.62, 'exp']]);
      const nz = NS(BUF.white, tt, tt + 0.16, null), nb = F('bandpass', 1200, 1), ng = G(0.5); chain(nz, nb, ng);
      const sh = shaper(3), f1 = F('bandpass', 650, 2), f2 = F('bandpass', 1600, 3), g1 = G(1), g2 = G(0.6), amp = G(0);
      s.connect(sh); ng.connect(sh); sh.connect(f1); sh.connect(f2); f1.connect(g1); f2.connect(g2); g1.connect(amp); g2.connect(amp); amp.connect(out);
      env(amp.gain, tt, [[0, 0], [0.008, 0.85], [0.05, 0.5], [0.17, 0.0001, 'exp']]);
      tt += rand(0.28, 0.38);
    }
  } },
  elephant: { dur: 1.8, prio: 1, echo: 0.4, ref: 16, vol: 0.8, fn(t, out, o) {
    const f0 = 420 * P(o);
    const a = O('sawtooth', f0, t, t + 1.7, null), b = O('square', f0, t, t + 1.7, null);
    const cv = (osc, m) => env(osc.frequency, t, [[0, f0 * 0.72 * m], [0.17, f0 * 1.22 * m, 'exp'], [0.6, f0 * 1.34 * m, 'exp'], [1.1, f0 * 1.14 * m, 'exp'], [1.55, f0 * 0.88 * m, 'exp']]);
    cv(a, 1); cv(b, 1.004);
    const vib = O('sine', 7, t, t + 1.7, null), vg = G(16); vib.connect(vg); vg.connect(a.frequency); vg.connect(b.frequency);
    const bg = G(0.5); b.connect(bg);
    const sh = shaper(6), hp = F('highpass', 300, 0.7), bp = F('bandpass', 1400, 1.1), lp = F('lowpass', 5000, 0.7), amp = G(0);
    a.connect(sh); bg.connect(sh); chain(sh, hp, bp, lp, amp, out);
    env(amp.gain, t, [[0, 0], [0.08, 0.6, 'lin'], [1.2, 0.52], [1.65, 0.0001, 'exp']]);
    const nz = NS(BUF.white, t, t + 1.6, null), nb = F('bandpass', 2500, 1), ng = G(0); chain(nz, nb, ng, out);
    env(ng.gain, t, [[0, 0], [0.1, 0.08, 'lin'], [1.5, 0.0001, 'exp']]);
  } },
  templeBell: { dur: 5.0, echo: 0.4, ref: 12, vol: 0.7, fn(t, out, o) {
    const base = (o.freq || rand(640, 760)) * P(o);
    const parts = [[0.5, 0.25, 4.2], [1, 0.5, 3.8], [1.183, 0.28, 2.8], [1.506, 0.22, 2.3], [2, 0.38, 3.0], [2.514, 0.17, 1.7], [2.986, 0.13, 1.3], [4.07, 0.08, 0.85], [5.21, 0.05, 0.55]];
    for (const [r, a, d] of parts) {
      const f = base * r, m = O('sine', f, t, t + d + 0.1, null), g = G(0);
      chain(m, g, out); env(g.gain, t, [[0, 0], [0.002, a * 0.34], [d, 0.0001, 'exp']]);
      if (r === 1 || r === 2 || r === 0.5) { // detuned twin -> slow beating, like a real ghanta
        const m2 = O('sine', f + rand(0.6, 1.8), t, t + d + 0.1, null), g2 = G(0);
        chain(m2, g2, out); env(g2.gain, t, [[0, 0], [0.002, a * 0.2], [d, 0.0001, 'exp']]);
      }
    }
    const n = NS(BUF.white, t, t + 0.06, null), nb = F('bandpass', 3600, 1.4), ng = G(0); chain(n, nb, ng, out);
    env(ng.gain, t, [[0, 0], [0.001, 0.35], [0.035, 0.0001, 'exp']]);
  } },
  koel: { dur: 4.0, echo: 0.35, ref: 20, vol: 0.7, fn(t, out, o) {
    const reps = irand(3, 5); let base = rand(780, 880) * P(o), tt = t, gap = 0.8;
    for (let i = 0; i < reps && tt < t + 3.4; i++) {
      bird(tt, base, base * 1.02, 0.09, 0.34, out);                 // "ku"
      bird(tt + 0.13, base * 1.27, base * 1.42, 0.32, 0.4, out);    // "OO" (rising)
      tt += gap; base *= 1.045; gap *= 0.9;
    }
  } },
  chirp: { dur: 1.3, echo: 0.2, ref: 10, vol: 0.6, fn(t, out, o) {
    const down = Math.random() < 0.5, n = irand(3, 8), base = rand(2800, 4800) * P(o); let tt = t;
    for (let i = 0; i < n && tt < t + 1.15; i++) {
      const d = rand(0.03, 0.075), f = base * rand(0.85, 1.15);
      if (down) bird(tt, f * 1.25, f * 0.8, d, 0.22, out, 0); else bird(tt, f * 0.8, f * 1.3, d, 0.2, out, 0);
      tt += d + rand(0.03, down ? 0.09 : 0.16);
    }
  } },
  crow: { dur: 1.5, echo: 0.3, ref: 14, vol: 0.7, fn(t, out, o) {
    const n = irand(2, 3), p = P(o); let tt = t;
    for (let i = 0; i < n; i++) {
      const f = rand(520, 600) * p;
      const s = O('sawtooth', f * 0.95, tt, tt + 0.3, null); env(s.frequency, tt, [[0, f * 0.95], [0.05, f * 1.05, 'exp'], [0.27, f * 0.78, 'exp']]);
      const nz = NS(BUF.white, tt, tt + 0.3, null), nb = F('bandpass', 1500, 1), ng = G(0.45); chain(nz, nb, ng);
      const am = G(0.55); s.connect(am); ng.connect(am);
      const lfo = O('square', 68, tt, tt + 0.3, null), lg = G(0.4); lfo.connect(lg); lg.connect(am.gain);
      const sh = shaper(4), f1 = F('bandpass', 1300, 2.5), f2 = F('bandpass', 2300, 3), g1 = G(1), g2 = G(0.6), amp = G(0);
      am.connect(sh); sh.connect(f1); sh.connect(f2); f1.connect(g1); f2.connect(g2); g1.connect(amp); g2.connect(amp); amp.connect(out);
      env(amp.gain, tt, [[0, 0], [0.02, 0.6], [0.2, 0.45], [0.28, 0.0001, 'exp']]);
      tt += rand(0.34, 0.42);
    }
  } },
  peacock: { dur: 2.5, echo: 0.4, ref: 18, vol: 0.6, fn(t, out, o) {
    const reps = irand(2, 3), p = P(o);
    for (let i = 0; i < reps; i++) {
      const tt = t + i * 0.72;
      const s = O('sawtooth', 800 * p, tt, tt + 0.66, null);
      env(s.frequency, tt, [[0, 800 * p], [0.12, 980 * p, 'exp'], [0.16, 1120 * p, 'exp'], [0.4, 1250 * p, 'exp'], [0.62, 900 * p, 'exp']]);
      const sh = shaper(2.5), b1 = F('bandpass', 2100, 1.5), b2 = F('bandpass', 1100, 2), g1 = G(1), g2 = G(0.7), amp = G(0);
      s.connect(sh); sh.connect(b1); sh.connect(b2); b1.connect(g1); b2.connect(g2); g1.connect(amp); g2.connect(amp); amp.connect(out);
      env(amp.gain, tt, [[0, 0], [0.02, 0.45], [0.13, 0.4], [0.15, 0.12], [0.18, 0.55], [0.5, 0.48], [0.64, 0.0001, 'exp']]);
    }
  } },
  thrush: { dur: 2.8, echo: 0.4, ref: 16, vol: 0.55, fn(t, out, o) {
    // Himalayan whistling thrush: rambling, human-like melodic whistles with glides
    const sc = [0, 2, 4, 7, 9, 12, 14, 16], base = rand(1350, 1700) * P(o), n = irand(5, 9);
    const osc = O('sine', base, t, t + 2.7, null), g = G(0); chain(osc, g, out);
    const vib = O('sine', 6, t, t + 2.7, null), vg = G(base * 0.015); vib.connect(vg); vg.connect(osc.frequency);
    let tt = t, idx = irand(2, 5); const pts = [[0, 0]];
    for (let i = 0; i < n && tt < t + 2.35; i++) {
      idx = Math.max(0, Math.min(sc.length - 1, idx + irand(-2, 2)));
      const f = base * Math.pow(2, sc[idx] / 12), d = rand(0.09, 0.26);
      if (i === 0) osc.frequency.setValueAtTime(f, tt); else osc.frequency.exponentialRampToValueAtTime(f, tt + 0.035);
      if (Math.random() < 0.25) osc.frequency.exponentialRampToValueAtTime(f * 1.25, tt + d * 0.9); // slur up
      const r = tt - t; pts.push([r + 0.015, 0.3, 'lin'], [r + d * 0.8, 0.26, 'lin'], [r + d, 0.0001, 'exp']);
      tt += d + rand(0.03, 0.12);
      pts.push([tt - t - 0.001, 0.0001, 'lin']);
    }
    env(g.gain, t, pts);
  } },
  cheer: { dur: 3.3, prio: 1, echo: 0.25, fn(t, out) {
    const m = NS(BUF.pink, t, t + 3.2, null), f1 = F('bandpass', 700, 1.8), f2 = F('bandpass', 1180, 2.2), f3 = F('bandpass', 2600, 3);
    const mm = G(0.6); m.connect(f1); m.connect(f2); m.connect(f3); f1.connect(mm); f2.connect(mm); f3.connect(mm);
    const am = NS(BUF.brown, t, t + 3.2, null, 0.7), al = F('lowpass', 9, 0.5), ag = G(1.2); chain(am, al, ag); ag.connect(mm.gain);
    const amp = G(0); chain(mm, amp, out); env(amp.gain, t, [[0, 0], [0.45, 2.2, 'lin'], [1.9, 1.8], [3.1, 0.0001, 'exp']]);
    const c = NS(BUF.crackle, t, t + 3.2, null, 1.4), cb = F('bandpass', 2200, 0.9), cg = G(0); chain(c, cb, cg, out);
    env(cg.gain, t, [[0, 0], [0.4, 1.1, 'lin'], [2.2, 0.8], [3.1, 0.0001, 'exp']]);
    const k = irand(1, 3);
    for (let i = 0; i < k; i++) { const tt = t + rand(0.2, 1.6), up = Math.random() < 0.5; bird(tt, up ? 2100 : 2900, up ? 2900 : 2000, rand(0.3, 0.55), 0.12, out, 0); }
  } },
  whoosh: { dur: 0.9, fn(t, out, o) {
    const n = NS(BUF.pink, t, t + 0.85, null), b = F('bandpass', 300, 1.1), g = G(0); chain(n, b, g, out);
    env(b.frequency, t, [[0, 280], [0.35, 2600 * P(o), 'exp'], [0.8, 500, 'exp']]);
    env(g.gain, t, [[0, 0], [0.3, 1.0, 'lin'], [0.8, 0.0001, 'exp']]);
  } },
  splash: { dur: 0.9, echo: 0.2, ref: 8, fn(t, out) {
    const n = NS(BUF.white, t, t + 0.6, null), b = F('bandpass', 1400, 0.6), g = G(0); chain(n, b, g, out);
    env(g.gain, t, [[0, 0], [0.01, 0.55], [0.45, 0.0001, 'exp']]);
    const pl = O('sine', 220, t, t + 0.2, null); pl.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    const pg = G(0); chain(pl, pg, out); env(pg.gain, t, [[0, 0], [0.005, 0.5], [0.15, 0.0001, 'exp']]);
    for (let i = 0; i < 5; i++) { const tt = t + rand(0.05, 0.55), f = rand(900, 2000); bird(tt, f, f * 1.6, 0.035, 0.12, out, 0); }
  } },
};

// ------------------------------------------------------------------------------------------- UI sounds
const UI = {
  click: { dur: 0.12, fn(t, out) { tone(t, 1500, 0.06, 0.32, 'sine', out, 0.002, 900); tone(t, 3000, 0.03, 0.07, 'triangle', out, 0.001); } },
  hover: { dur: 0.06, fn(t, out) { tone(t, 2200, 0.035, 0.07, 'sine', out, 0.002); } },
  swipe: { dur: 0.45, fn(t, out) {
    const n = NS(BUF.pink, t, t + 0.4, null), b = F('bandpass', 500, 1.4), g = G(0); chain(n, b, g, out);
    env(b.frequency, t, [[0, 500], [0.22, 2600, 'exp'], [0.38, 1400, 'exp']]);
    env(g.gain, t, [[0, 0], [0.07, 0.75, 'lin'], [0.34, 0.0001, 'exp']]);
    tone(t + 0.02, 650, 0.2, 0.06, 'sine', out, 0.02, 1050);
  } },
  select: { dur: 0.5, fn(t, out) { tone(t, 659.25, 0.12, 0.26, 'triangle', out); tone(t + 0.08, 987.77, 0.32, 0.26, 'triangle', out); tone(t + 0.08, 1975.5, 0.22, 0.05, 'sine', out); } },
  back: { dur: 0.45, fn(t, out) { tone(t, 880, 0.1, 0.22, 'triangle', out); tone(t + 0.08, 587.33, 0.25, 0.22, 'triangle', out); } },
  countdown: { dur: 0.45, fn(t, out) { tone(t, 523.25, 0.34, 0.4, 'sine', out, 0.005); tone(t, 1046.5, 0.22, 0.1, 'triangle', out, 0.005); } },
  go: { dur: 1.0, fn(t, out) { tone(t, 1046.5, 0.75, 0.42, 'sine', out, 0.005); tone(t, 1568, 0.6, 0.12, 'triangle', out, 0.005); brass(t, 523.25, 0.5, 0.12, out); } },
  finish: { dur: 2.4, fn(t, out) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => brass(t + i * 0.11, f, 0.14, 0.2, out));
    [523.25, 659.25, 783.99, 1046.5].forEach(f => brass(t + 0.48, f, 1.3, 0.12, out));
  } },
  error: { dur: 0.35, vol: 0.6, fn(t, out) {
    const o = O('square', 180, t, t + 0.3, null), lp = F('lowpass', 1200, 0.7), g = G(0); chain(o, lp, g, out);
    env(g.gain, t, [[0, 0], [0.005, 0.25], [0.1, 0.22], [0.11, 0.0001, 'exp'], [0.16, 0.0001], [0.165, 0.25, 'lin'], [0.27, 0.22], [0.28, 0.0001, 'exp']]);
  } },
  notify: { dur: 0.7, vol: 0.7, fn(t, out) { tone(t, 1318.5, 0.35, 0.2, 'sine', out); tone(t + 0.1, 1975.5, 0.5, 0.18, 'sine', out); } },
  join: { dur: 0.6, fn(t, out) { tone(t, 783.99, 0.2, 0.22, 'triangle', out); tone(t + 0.09, 1046.5, 0.22, 0.22, 'triangle', out); tone(t + 0.18, 1318.5, 0.35, 0.22, 'triangle', out); } },
  lose: { dur: 1.1, fn(t, out) { tone(t, 392, 0.35, 0.22, 'triangle', out); tone(t + 0.22, 329.63, 0.35, 0.22, 'triangle', out); tone(t + 0.44, 261.63, 0.6, 0.22, 'triangle', out); } },
};

// ------------------------------------------------------------------------------------------- engines
// pulses: [phase within the 720° cycle (0..1), amplitude, phase error] — small errors give real-engine "texture".
// res: peaking resonances [Hz, Q, dB] (exhaust / airbox body).
const ENGINE_DEFS = {
  zx10r: { // inline-4, 180° crank, even firing — high-pitched scream, strong intake howl
    idle: 1250, red: 14000, width: 0.062,
    pulses: [[0, 1, 0], [0.25, 0.94, 0.004], [0.5, 1.05, -0.003], [0.75, 0.96, 0.002]],
    res: [[150, 2.5, 4], [470, 2.2, 3], [1350, 1.8, 3]],
    drive: 2.4, noise: 0.24, raspF: 2100, intake: 0.42, sub: 0.16, bright: 1.0, jitter: 0.006,
  },
  s1000rr: { // inline-4 (ShiftCam) — raspier, more metallic top end
    idle: 1300, red: 14600, width: 0.058,
    pulses: [[0, 1, 0], [0.25, 0.97, -0.003], [0.5, 1.02, 0.002], [0.75, 0.92, 0.004]],
    res: [[175, 2.5, 4], [560, 2.4, 3.5], [1650, 2.0, 3.5]],
    drive: 3.0, noise: 0.3, raspF: 2500, intake: 0.36, sub: 0.14, bright: 1.12, jitter: 0.006,
  },
  panigale: { // 90° V4 "Twin Pulse" firing 0°, 90°, 290°, 380° — uneven, deep MotoGP-style growl
    idle: 1400, red: 16000, width: 0.075,
    pulses: [[0, 1, 0], [90 / 720, 0.95, 0.003], [290 / 720, 1.06, -0.002], [380 / 720, 0.97, 0.002]],
    res: [[110, 2.5, 5], [360, 2.2, 4], [1050, 1.8, 2.5]],
    drive: 3.2, noise: 0.27, raspF: 1700, intake: 0.34, sub: 0.32, bright: 0.92, jitter: 0.01,
  },
};

/** one full engine cycle (720° crank) as a PeriodicWave; oscillator runs at rpm/120 Hz */
function engineWave(type) {
  if (W.engine[type]) return W.engine[type];
  const d = ENGINE_DEFS[type], S = 2048, H = 100, w = d.width;
  const x = new Float32Array(S);
  for (const [ph, amp, off] of d.pulses) {
    const st = ph + off;
    for (let i = 0; i < S; i++) {
      let u = i / S - st; u -= Math.floor(u);
      let v = 0;
      if (u < w) { const s = Math.sin(Math.PI * u / w); v = s * s; }                                  // blow-down pulse
      else if (u < w * 2.6) { const s = Math.sin(Math.PI * (u - w) / (1.6 * w)); v = -0.42 * s * s; }  // rarefaction
      else if (u < w * 6) { const q = u - 2.6 * w; v = 0.1 * Math.sin(2 * Math.PI * q / (1.15 * w)) * Math.exp(-q / (1.2 * w)); } // pipe ringing
      x[i] += amp * v;
    }
  }
  let mean = 0; for (let i = 0; i < S; i++) mean += x[i]; mean /= S;
  const re = new Float32Array(H + 1), im = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let a = 0, b = 0; const wk = 2 * Math.PI * k / S;
    for (let i = 0; i < S; i++) { const v = x[i] - mean; a += v * Math.cos(wk * i); b += v * Math.sin(wk * i); }
    re[k] = 2 * a / S; im[k] = 2 * b / S;
  }
  return (W.engine[type] = ctx.createPeriodicWave(re, im));
}

class EngineSound {
  constructor(type, local) {
    this.type = ENGINE_DEFS[type] ? type : 'zx10r';
    this.def = ENGINE_DEFS[this.type];
    this.local = local !== false;
    this.built = false; this.disposed = false;
    this.userVol = 1; this.thr = 0; this.limiter = false; this.nextCut = 0;
    this.lastPop = 0; this.popGap = 0.1; this.offSince = 0; this.lastThr = 0;
    this.prevDist = null; this.doppler = 1; this.lastT = 0;
    engines.add(this);
  }
  _build() {
    if (this.built) return true;
    if (this.disposed || !ctx || !N) return false;
    const d = this.def, t = ctx.currentTime;
    this.srcs = [];
    // core: firing-pattern oscillator -> drive -> resonances -> lowpass -> volume -> cut (shift/limiter)
    this.osc = ctx.createOscillator(); this.osc.setPeriodicWave(engineWave(this.type));
    this.osc.frequency.value = d.idle / 120;
    this.pre = G(1); this.shp = shaper(d.drive, this.local ? '2x' : 'none'); this.post = G(0.55);
    this.lp = F('lowpass', 1200, 0.8); this.out = G(0); this.cut = G(1);
    chain(this.osc, this.pre, this.shp, this.post);
    let tail = this.post;
    if (this.local) for (const [f, q, g] of d.res) { const pk = F('peaking', f, q, g); tail.connect(pk); tail = pk; }
    chain(tail, this.lp, this.out, this.cut);
    // combustion rasp: band-passed noise amplitude-modulated by the firing waveform itself
    this.raspSrc = NS(BUF.white, t, null, null); this.raspBp = F('bandpass', d.raspF, 0.9);
    this.rasp = G(0); this.raspMod = G(0);
    chain(this.raspSrc, this.raspBp, this.rasp, this.pre);
    this.osc.connect(this.raspMod); this.raspMod.connect(this.rasp.gain);
    // cycle-to-cycle irregularity (frequency jitter)
    this.jitSrc = NS(BUF.brown, t, null, null); this.jitLp = F('lowpass', 30, 0.5); this.jit = G(0);
    chain(this.jitSrc, this.jitLp, this.jit); this.jit.connect(this.osc.frequency);
    this.srcs.push(this.raspSrc, this.jitSrc);
    if (this.local) {
      this.ajit = G(0.05); this.jitLp.connect(this.ajit); this.ajit.connect(this.out.gain);     // amplitude jitter
      this.rum = O('sine', d.idle / 60, t, null, null); this.rumG = G(0); chain(this.rum, this.rumG, this.lp); // crank-order rumble
      this.rumJ = G(2); this.jit.connect(this.rumJ); this.rumJ.connect(this.rum.frequency);
      this.inSrc = NS(BUF.pink, t, null, null); this.inBp = F('bandpass', 800, 3); this.inG = G(0);       // intake howl
      chain(this.inSrc, this.inBp, this.inG, this.out);
      this.wh = O('triangle', 300, t, null, null); this.whG = G(0); chain(this.wh, this.whG, this.out);   // chain / gear whine
      this.srcs.push(this.rum, this.inSrc, this.wh);
      this.popBus = G(1); this.popBus.connect(this.cut);
      this.cut.connect(N.engineBus);
    } else {
      this.pan = makePanner(LIS, 7, 260, 1.15);
      this.cut.connect(this.pan); this.pan.connect(N.engineBus);
      this.popBus = G(0.8); this.popBus.connect(this.cut);
    }
    this.osc.start(t); this.srcs.push(this.osc);
    this.built = true;
    return true;
  }
  update(s = {}) {
    if (this.disposed || !ctx) return;
    if (!this.built && !this._build()) return;
    const d = this.def, t = ctx.currentTime;
    const dt = this.lastT ? Math.min(0.25, Math.max(0.001, t - this.lastT)) : 0.016;
    this.lastT = t;
    let rpm = +s.rpm || d.idle;
    rpm = Math.max(d.idle * 0.7, Math.min(rpm, d.red * 1.06));
    const thr = clamp01(s.throttle ?? 0), speed = Math.max(0, +s.speed || 0);
    this.thr += (thr - this.thr) * Math.min(1, dt * 14);
    const thrS = this.thr, rn = clamp01((rpm - d.idle) / (d.red - d.idle));
    if (this.limiter) rpm *= 1 + 0.015 * Math.sin(t * 90);

    let distF = 1;
    if (!this.local && s.position) {
      const p = s.position; setPos(this.pan, p.x, p.y, p.z);
      const dx = p.x - LIS.x, dy = p.y - LIS.y, dz = p.z - LIS.z, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (this.prevDist != null && dt > 0.002) {
        const vr = Math.max(-150, Math.min(150, (dist - this.prevDist) / dt)); // radial velocity (+ = receding)
        this.doppler += (343 / (343 + vr) - this.doppler) * Math.min(1, dt * 6);
      }
      this.prevDist = dist;
      distF = Math.max(0.18, 1 - dist / 320); // air absorption: distant bikes sound duller
    }
    const fc = (rpm / 120) * this.doppler;
    this.osc.frequency.setTargetAtTime(fc, t, 0.012);
    this.jit.gain.setTargetAtTime(fc * d.jitter * (1.6 - rn * 0.8), t, 0.05);
    this.pre.gain.setTargetAtTime(0.55 + thrS * 0.9 + rn * 0.35, t, 0.03);
    const raspLvl = d.noise * (0.25 + thrS * 0.75) * (0.4 + rn * 0.6);
    this.rasp.gain.setTargetAtTime(raspLvl * 0.5, t, 0.03);
    this.raspMod.gain.setTargetAtTime(raspLvl * 0.5, t, 0.03);
    this.raspBp.frequency.setTargetAtTime(clampF(d.raspF * (0.7 + rn * 0.8)), t, 0.05);
    const closed = 420 + 2600 * rn, open = 1100 + 7800 * rn * d.bright;
    this.lp.frequency.setTargetAtTime(clampF((closed + (open - closed) * thrS) * distF), t, 0.03);
    const v = (0.32 + 0.5 * thrS + 0.25 * rn) * this.userVol * (this.local ? 0.62 : 0.55);
    this.out.gain.setTargetAtTime(v, t, 0.04);
    if (this.local) {
      this.rum.frequency.setTargetAtTime(rpm / 60, t, 0.012);
      this.rumG.gain.setTargetAtTime(d.sub * (1 - rn * 0.6) * (0.6 + thrS * 0.4), t, 0.05);
      this.inBp.frequency.setTargetAtTime(clampF(260 + rpm * 0.085), t, 0.03);
      this.inG.gain.setTargetAtTime(d.intake * thrS * Math.pow(rn, 1.3) * 3, t, 0.04);
      this.wh.frequency.setTargetAtTime(Math.max(40, speed * 27), t, 0.05);
      this.whG.gain.setTargetAtTime(0.012 * clamp01(speed / 70) * (0.5 + thrS * 0.5), t, 0.08);
    }
    if (this.limiter && t >= this.nextCut) {          // rev limiter: rapid ignition cuts
      const g = this.cut.gain; g.cancelScheduledValues(t);
      g.setTargetAtTime(0.22, t, 0.004); g.setTargetAtTime(1, t + 0.028, 0.006);
      this.nextCut = t + 0.062;
    }
    if (!paused && (this.local || distF > 0.5)) {    // overrun crackle when throttle is closed at high rpm
      if (thr < 0.12 && rpm > d.red * 0.38) {
        if (this.lastThr >= 0.12) this.offSince = t;
        const fresh = t - this.offSince < 0.7;
        if (t - this.lastPop > this.popGap) {
          this._pop(t + Math.random() * 0.02, fresh ? 1 : 0.55);
          this.lastPop = t;
          this.popGap = (fresh ? 0.05 : 0.12) + Math.random() * (fresh ? 0.12 : 0.45);
        }
      }
    }
    this.lastThr = thr;
  }
  _pop(t, k = 1) {
    if (!this.built || this.disposed) return;
    const crack = Math.random() < 0.5;
    const s = NS(crack ? BUF.crackle : BUF.white, t, t + 0.07, null, rand(0.7, 1.3));
    const bp = F('bandpass', rand(700, 2500), 1.1), g = G(0);
    env(g.gain, t, [[0, 0], [0.002, (crack ? 1.6 : 0.55) * k], [rand(0.012, crack ? 0.06 : 0.025), 0.0001, 'exp']]);
    chain(s, bp, g, this.popBus);
    if (Math.random() < 0.6) {
      const o = O('sine', rand(80, 140), t, t + 0.08, null), og = G(0);
      env(og.gain, t, [[0, 0], [0.003, 0.45 * k], [0.07, 0.0001, 'exp']]);
      chain(o, og, this.popBus);
    }
  }
  shift(up = true) {
    if (!ctx || this.disposed || (!this.built && !this._build())) return;
    const t = ctx.currentTime, g = this.cut.gain;
    g.cancelScheduledValues(t);
    if (up) { g.setTargetAtTime(0.12, t, 0.006); g.setTargetAtTime(1, t + 0.055, 0.018); this._pop(t + 0.01, 0.9); }
    else { g.setTargetAtTime(1.25, t, 0.01); g.setTargetAtTime(1, t + 0.08, 0.03); this._pop(t + 0.03, 0.7); this._pop(t + 0.09, 0.5); }
  }
  setLimiter(on) {
    const was = this.limiter; this.limiter = !!on;
    if (was && !this.limiter && this.built && ctx) { const t = ctx.currentTime; this.cut.gain.cancelScheduledValues(t); this.cut.gain.setTargetAtTime(1, t, 0.01); }
  }
  setVolume(v) { this.userVol = Math.max(0, +v || 0); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; engines.delete(this);
    if (!this.built || !ctx) return;
    const t = ctx.currentTime;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(0, t, 0.03);
    for (const s of this.srcs) { try { s.stop(t + 0.2); } catch (e) { /* noop */ } }
    setTimeout(() => { try { this.cut.disconnect(); } catch (e) { /* noop */ } if (this.pan) try { this.pan.disconnect(); } catch (e) { /* noop */ } }, 400);
  }
}

// ------------------------------------------------------------------------------------------- ride layer
function buildRide() {
  if (ride) return ride;
  if (!ctx || !N) return null;
  const t = ctx.currentTime, r = {}, bus = G(1); bus.connect(N.rideBus);
  r.windSrc = NS(BUF.pink, t, null, null); r.windBp = F('bandpass', 400, 0.5); r.wind = G(0);
  chain(r.windSrc, r.windBp, r.wind, bus);
  r.hissSrc = NS(BUF.white, t, null, null); r.hissHp = F('highpass', 2600, 0.6); r.hiss = G(0);
  chain(r.hissSrc, r.hissHp, r.hiss, bus);
  r.bufSrc = NS(BUF.brown, t, null, null, 0.5); r.bufLp = F('lowpass', 14, 0.5); r.buf = G(0);  // helmet buffeting
  chain(r.bufSrc, r.bufLp, r.buf); r.buf.connect(r.wind.gain);
  r.roadSrc = NS(BUF.brown, t, null, null); r.roadLp = F('lowpass', 240, 0.6); r.road = G(0);
  chain(r.roadSrc, r.roadLp, r.road, bus);
  r.skidSrc = NS(BUF.white, t, null, null); r.skidA = F('bandpass', 1750, 14); r.skidB = F('bandpass', 2500, 16); r.skid = G(0);
  r.skidSrc.connect(r.skidA); r.skidSrc.connect(r.skidB); r.skidA.connect(r.skid); r.skidB.connect(r.skid); r.skid.connect(bus);
  r.skidLfo = O('sine', 6.5, t, null, null); r.skidLfoG = G(70); r.skidLfo.connect(r.skidLfoG);
  r.skidLfoG.connect(r.skidA.frequency); r.skidLfoG.connect(r.skidB.frequency);
  r.scrSrc = NS(BUF.crackle, t, null, null, 1.6); r.scrHp = F('highpass', 1400, 0.7); r.scrBp = F('bandpass', 3300, 1.5); r.scr = G(0);
  chain(r.scrSrc, r.scrHp, r.scrBp, r.scr, bus);
  r.ringSrc = NS(BUF.white, t, null, null); r.ringA = F('bandpass', 2950, 35); r.ringB = F('bandpass', 4420, 40); r.ring = G(0);
  r.ringSrc.connect(r.ringA); r.ringSrc.connect(r.ringB); r.ringA.connect(r.ring); r.ringB.connect(r.ring); r.ring.connect(bus);
  r.grSrc = NS(BUF.brown, t, null, null); r.grLp = F('lowpass', 520, 0.7); r.gr = G(0);
  chain(r.grSrc, r.grLp, r.gr, bus);
  r.pebSrc = NS(BUF.crackle, t, null, null, 0.8); r.pebBp = F('bandpass', 1900, 0.8); r.peb = G(0);
  chain(r.pebSrc, r.pebBp, r.peb, bus);
  ride = r;
  return r;
}
function setRideImpl(s = {}) {
  if (!ctx || !N) return;
  const r = buildRide(); if (!r) return;
  const t = ctx.currentTime, k = 0.06;
  const v = Math.max(0, +s.speed || 0), skid = clamp01(s.skid || 0), scr = clamp01(s.scrape || 0), off = clamp01(s.offroad || 0);
  const w = Math.min(1.25, Math.pow(v / 75, 2));
  r.wind.gain.setTargetAtTime(0.85 * w, t, k);
  r.buf.gain.setTargetAtTime(0.85 * w * 0.45 * Math.min(1, v / 55), t, k);
  r.windBp.frequency.setTargetAtTime(clampF(260 + v * 13), t, k);
  r.hiss.gain.setTargetAtTime(0.16 * Math.min(1.3, Math.pow(v / 85, 3)), t, k);
  r.road.gain.setTargetAtTime(0.3 * Math.min(1.3, v / 55) * (1 - off * 0.7), t, k);
  r.skid.gain.setTargetAtTime(2.5 * skid * Math.min(1, v / 8), t, 0.03);
  r.scr.gain.setTargetAtTime(1.2 * scr, t, 0.03);
  r.ring.gain.setTargetAtTime(3 * scr, t, 0.03);
  r.scrSrc.playbackRate.setTargetAtTime(1 + Math.min(1.5, v / 40), t, 0.1);
  const gv = off * Math.min(1, v / 14);
  r.gr.gain.setTargetAtTime(0.7 * gv, t, 0.05);
  r.peb.gain.setTargetAtTime(0.9 * gv, t, 0.05);
  r.pebSrc.playbackRate.setTargetAtTime(0.6 + Math.min(1.6, v / 30), t, 0.1);
}

// ------------------------------------------------------------------------------------------- ambience
const BED_LEVEL = { forest: 0.75, river: 0.55, town: 0.5, mountain: 0.65, waterfall: 0.7, crowd: 0.6, temple: 0.35, insects: 0.45 };
const BED_DEFS = {
  river(out, t, S) {
    const a = NS(BUF.brown, t, null, null), al = F('lowpass', 650, 0.6), ag = G(0.9); chain(a, al, ag, out);
    const b = NS(BUF.pink, t, null, null), bb = F('bandpass', 1500, 0.7), bg = G(0.5); chain(b, bb, bg, out);
    const l1 = O('sine', 0.13, t, null, null), l1g = G(420); chain(l1, l1g); l1g.connect(bb.frequency);
    const l2 = O('sine', 0.21, t, null, null), l2g = G(0.18); chain(l2, l2g); l2g.connect(bg.gain);
    const c = NS(BUF.white, t, null, null), cb = F('bandpass', 3600, 1.3), cg = G(0.14); chain(c, cb, cg, out);
    const d = NS(BUF.crackle, t, null, null, 0.5), db = F('bandpass', 1100, 2), dg = G(0.6); chain(d, db, dg, out); // babble / droplets
    S.push(a, b, l1, l2, c, d);
  },
  waterfall(out, t, S) {
    const a = NS(BUF.white, t, null, null), al = F('lowpass', 2800, 0.5), ap = F('peaking', 380, 1, 6), ag = G(0.45); chain(a, al, ap, ag, out);
    const b = NS(BUF.brown, t, null, null), bl = F('lowpass', 280, 0.6), bg = G(0.8); chain(b, bl, bg, out);
    S.push(a, b);
  },
  forest(out, t, S) { // leaves rustling in gusts
    const a = NS(BUF.pink, t, null, null), ab = F('bandpass', 900, 0.45), ag = G(0.4); chain(a, ab, ag, out);
    const lfo = O('sine', 0.055, t, null, null), lg = G(0.28); chain(lfo, lg); lg.connect(ag.gain);
    const h = NS(BUF.white, t, null, null), hh = F('highpass', 5200, 0.5), hg = G(0.06); chain(h, hh, hg, out);
    const lg2 = G(0.04); lfo.connect(lg2); lg2.connect(hg.gain);
    S.push(a, lfo, h);
  },
  insects(out, t, S) { // cicadas + crickets
    const a = NS(BUF.white, t, null, null), ab = F('bandpass', 4700, 7), am = G(0.5), ag = G(1.6); chain(a, ab, am, ag, out);
    const pu = O('square', 46, t, null, null), pg = G(0.5); chain(pu, pg); pg.connect(am.gain);
    const sw = O('sine', 0.08, t, null, null), sg = G(0.6); chain(sw, sg); sg.connect(ag.gain);
    const c = O('sine', 4300, t, null, null), c1 = G(0.22), c2 = G(0.5), co = G(0.06); chain(c, c1, c2, co, out);
    const cl = ctx.createOscillator(); cl.setPeriodicWave(W.cricket); cl.frequency.value = 2.7; cl.start(t);
    const clg = G(0.78); cl.connect(clg); clg.connect(c1.gain);
    const tr = O('square', 32, t, null, null), trg = G(0.5); chain(tr, trg); trg.connect(c2.gain);
    S.push(a, pu, sw, c, cl, tr);
  },
  mountain(out, t, S) { // wind in pines with gusts
    const a = NS(BUF.pink, t, null, null), ab = F('bandpass', 460, 0.8), ag = G(0.5); chain(a, ab, ag, out);
    const g1 = O('sine', 0.045, t, null, null), g1g = G(0.35); chain(g1, g1g); g1g.connect(ag.gain);
    const g2 = O('sine', 0.071, t, null, null), g2g = G(220); chain(g2, g2g); g2g.connect(ab.frequency);
    const b = NS(BUF.white, t, null, null), bh = F('highpass', 2800, 0.5), bg = G(0.05); chain(b, bh, bg, out);
    const g1h = G(0.04); g1.connect(g1h); g1h.connect(bg.gain);
    const c = NS(BUF.brown, t, null, null), cl = F('lowpass', 150, 0.6), cg = G(0.5); chain(c, cl, cg, out);
    S.push(a, g1, g2, b, c);
  },
  town(out, t, S) { // traffic rumble + idling engines + murmur of people
    const a = NS(BUF.brown, t, null, null), al = F('lowpass', 300, 0.6), ag = G(0.6); chain(a, al, ag, out);
    const e1 = O('sawtooth', 52, t, null, null), e2 = O('sawtooth', 77.5, t, null, null), el = F('lowpass', 160, 0.7), eg = G(0.035);
    e1.connect(el); e2.connect(el); chain(el, eg, out);
    const m = NS(BUF.pink, t, null, null), f1 = F('bandpass', 520, 3), f2 = F('bandpass', 1150, 4), f3 = F('bandpass', 2500, 5);
    const mm = G(0.5), mg = G(0.9);
    m.connect(f1); m.connect(f2); m.connect(f3); f1.connect(mm); f2.connect(mm); f3.connect(mm); chain(mm, mg, out);
    const sy = NS(BUF.brown, t, null, null, 0.3), sl = F('lowpass', 6, 0.5), sgn = G(1.2); chain(sy, sl, sgn); sgn.connect(mm.gain);
    const v1 = O('sine', 0.7, t, null, null), v1g = G(120); chain(v1, v1g); v1g.connect(f1.frequency);
    const v2 = O('sine', 0.43, t, null, null), v2g = G(260); chain(v2, v2g); v2g.connect(f2.frequency);
    S.push(a, e1, e2, m, sy, v1, v2);
  },
  crowd(out, t, S) {
    const m = NS(BUF.pink, t, null, null), f1 = F('bandpass', 720, 1.6), f2 = F('bandpass', 1250, 2), f3 = F('bandpass', 2600, 2.5);
    const mm = G(0.6), mg = G(1.4);
    m.connect(f1); m.connect(f2); m.connect(f3); f1.connect(mm); f2.connect(mm); f3.connect(mm); chain(mm, mg, out);
    const am = NS(BUF.brown, t, null, null, 0.6), al = F('lowpass', 9, 0.5), ag = G(1.0); chain(am, al, ag); ag.connect(mm.gain);
    const cl = NS(BUF.crackle, t, null, null, 1.3), cb = F('bandpass', 2300, 0.9), cg = G(0.7); chain(cl, cb, cg, out);
    S.push(m, am, cl);
  },
  temple(out, t, S) { // faint resonant drone of the bells
    const a = O('sine', 136.1, t, null, null), b = O('sine', 272.2, t, null, null), c = O('sine', 204.15, t, null, null);
    const g = G(0.05), gb = G(0.02), gc = G(0.012); a.connect(g); b.connect(gb); c.connect(gc); g.connect(out); gb.connect(out); gc.connect(out);
    const lfo = O('sine', 0.1, t, null, null), lg = G(0.02); chain(lfo, lg); lg.connect(g.gain);
    S.push(a, b, c, lfo);
  },
};
// [sound, events per second at level 1, options]
const AMB_EVENTS = {
  forest: [['koel', 0.05], ['chirp', 0.35], ['peacock', 0.025], ['crow', 0.02], ['thrush', 0.03],
    ['tigerRoar', 0.004, { far: true, vol: 0.55 }], ['elephant', 0.004, { far: true, vol: 0.5 }]],
  mountain: [['thrush', 0.08], ['crow', 0.04], ['monkey', 0.03], ['chirp', 0.12], ['whoosh', 0.04, { vol: 0.35, lp: 900 }]],
  town: [['autoHorn', 0.07], ['horn', 0.04], ['busHorn', 0.025], ['truckHorn', 0.012], ['dogBark', 0.04], ['cowMoo', 0.025], ['crow', 0.05], ['chirp', 0.06]],
  river: [['splash', 0.08, { vol: 0.45 }], ['chirp', 0.06], ['koel', 0.015]],
  temple: [['templeBell', 0.22, { vol: 0.6 }]],
  crowd: [['cheer', 0.08, { vol: 0.6 }]],
};

function ensureBed(name) {
  let b = beds[name];
  if (b) return b;
  b = beds[name] = { gain: G(0), srcs: [], zeroAt: 0 };
  b.gain.connect(N.ambBus);
  BED_DEFS[name](b.gain, ctx.currentTime, b.srcs);
  return b;
}
function stopBed(name) {
  const b = beds[name]; if (!b) return;
  delete beds[name];
  for (const s of b.srcs) { try { s.stop(); } catch (e) { /* noop */ } }
  setTimeout(() => { try { b.gain.disconnect(); } catch (e) { /* noop */ } }, 100);
}
function setAmbienceImpl(levels = {}) {
  for (const k of Object.keys(levels)) if (k in ambLevels) ambLevels[k] = clamp01(+levels[k] || 0);
  if (!ctx || !N) return;
  const t = ctx.currentTime;
  for (const k of Object.keys(levels)) {
    if (!(k in BED_DEFS)) continue;
    const target = ambLevels[k] * BED_LEVEL[k];
    if (target > 0.0005) { const b = ensureBed(k); b.gain.gain.setTargetAtTime(target, t, 0.9); b.zeroAt = 0; }
    else if (beds[k]) { const b = beds[k]; b.gain.gain.setTargetAtTime(0, t, 0.6); if (!b.zeroAt) b.zeroAt = t; }
  }
}
function ambTick() {
  if (!ctx || !N || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  for (const k of Object.keys(beds)) { const b = beds[k]; if (b.zeroAt && t - b.zeroAt > 4) stopBed(k); }
  if (paused) return;
  for (const zone in AMB_EVENTS) {
    const lv = ambLevels[zone]; if (!(lv > 0.03)) continue;
    for (const [name, rate, o] of AMB_EVENTS[zone]) {
      if (Math.random() < rate * lv * 0.25) {
        const far = o && o.far ? rand(0.25, 0.5) : rand(0.35, 1);
        playOne(SFX, name, {
          pan: rand(-0.85, 0.85), volume: ((o && o.vol) ?? 0.7) * far * Math.min(1, lv * 1.2),
          lp: (o && o.lp) || (far < 0.5 ? rand(1200, 3000) : undefined), prio: -1, echo: 0.3,
        });
      }
    }
  }
}

// ------------------------------------------------------------------------------------------- music
function upNeighbor(semi) { // next higher note of the pentatonic Sa Re Ga Pa Dha
  const sc = [0, 2, 4, 7, 9, 12]; const o = Math.floor(semi / 12) * 12, r = semi - o;
  for (const s of sc) if (s > r) return o + s;
  return o + 14;
}
// instruments ---------------------------------------------------------------
function flute(tr, t, freq, dur, vel = 0.7, o = {}) {           // bansuri
  const dest = o.dry ? tr.dry : tr.echo, out = G(0); out.connect(dest);
  const osc = ctx.createOscillator(); osc.setPeriodicWave(W.flute);
  if (o.from) { osc.frequency.setValueAtTime(o.from, t); osc.frequency.exponentialRampToValueAtTime(freq, t + (o.glide || 0.09)); }
  else osc.frequency.setValueAtTime(freq, t);
  osc.connect(out);
  if (dur > 0.3) { // delayed vibrato
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5 + Math.random();
    const lg = G(0); lfo.connect(lg); lg.connect(osc.frequency);
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(0, t + Math.min(0.25, dur * 0.4));
    lg.gain.linearRampToValueAtTime(freq * 0.011, t + Math.min(0.6, dur * 0.8));
    lfo.start(t); lfo.stop(t + dur + 0.3);
  }
  const nz = NS(BUF.pink, t, t + dur + 0.25, null), nb = F('bandpass', Math.min(freq * 2.2, 9000), 1.4), ng = G(0);
  chain(nz, nb, ng, dest);
  env(ng.gain, t, [[0, 0], [0.03, 0.5 * vel], [0.15, 0.16 * vel], [dur, 0.12 * vel], [dur + 0.15, 0.0001, 'exp']]);
  const a = Math.min(0.08, dur * 0.3);
  env(out.gain, t, [[0, 0], [a, vel * 0.5], [Math.max(a + 0.01, dur * 0.6), vel * 0.46], [Math.max(a + 0.02, dur), vel * 0.4], [dur + 0.16, 0.0001, 'exp']]);
  osc.start(t); osc.stop(t + dur + 0.25);
}
function tanpura(tr, t, freq, dur = 2.6, vel = 0.1) {
  const lp = F('lowpass', 2800, 1.5), g = G(0);
  O('sawtooth', freq, t, t + dur, lp); O('sawtooth', freq * 1.0015, t, t + dur, lp);
  chain(lp, g, tr.rev);
  env(lp.frequency, t, [[0, 3200], [0.5, 1300, 'exp'], [dur, 700, 'exp']]);
  env(g.gain, t, [[0, 0], [0.015, vel], [0.4, vel * 0.7], [dur, 0.0001, 'exp']]);
}
function softBass(tr, t, freq, dur = 1.4, vel = 0.2) {
  const o = O('triangle', freq, t, t + dur + 0.05, null), g = G(0); chain(o, g, tr.dry);
  env(g.gain, t, [[0, 0], [0.012, vel], [dur, 0.0001, 'exp']]);
}
function dholBass(tr, t, vel = 0.8, p = 1) {
  const o = O('sine', 125 * p, t, t + 0.45, null); o.frequency.exponentialRampToValueAtTime(55 * p, t + 0.16);
  const g = G(0); chain(o, g, tr.dry); env(g.gain, t, [[0, 0], [0.004, vel * 0.9], [0.42, 0.0001, 'exp']]);
  const n = NS(BUF.white, t, t + 0.03, null), nl = F('lowpass', 2200, 0.7), ng = G(0); chain(n, nl, ng, tr.dry);
  env(ng.gain, t, [[0, 0], [0.001, vel * 0.35], [0.025, 0.0001, 'exp']]);
}
function dholTreble(tr, t, vel = 0.4) {
  const n = NS(BUF.white, t, t + 0.12, null), b = F('bandpass', 1150, 1.6), g = G(0); chain(n, b, g, tr.dry);
  env(g.gain, t, [[0, 0], [0.002, vel * 0.9], [0.09, 0.0001, 'exp']]);
  const o = O('triangle', 340, t, t + 0.12, null); o.frequency.exponentialRampToValueAtTime(300, t + 0.1);
  const og = G(0); chain(o, og, tr.dry); env(og.gain, t, [[0, 0], [0.002, vel * 0.45], [0.1, 0.0001, 'exp']]);
}
function hudka(tr, t, vel = 0.4) { // Kumaoni hourglass drum — pitch-bending "talking" stroke
  const o = O('sine', 165, t, t + 0.4, null); o.frequency.linearRampToValueAtTime(215, t + 0.1); o.frequency.exponentialRampToValueAtTime(150, t + 0.35);
  const g = G(0); chain(o, g, tr.dry); env(g.gain, t, [[0, 0], [0.005, vel * 0.8], [0.38, 0.0001, 'exp']]);
  const n = NS(BUF.white, t, t + 0.03, null), b = F('bandpass', 950, 1.2), ng = G(0); chain(n, b, ng, tr.dry);
  env(ng.gain, t, [[0, 0], [0.001, vel * 0.5], [0.02, 0.0001, 'exp']]);
}
function manjira(tr, t, vel = 0.15) { // small temple cymbals
  for (const [f, d] of [[3150, 0.9], [4720, 0.7], [6080, 0.5], [7900, 0.4]]) {
    const o = O('sine', f, t, t + d + 0.05, null), g = G(0); chain(o, g, tr.rev); env(g.gain, t, [[0, 0], [0.002, vel * 0.25], [d, 0.0001, 'exp']]);
  }
  const n = NS(BUF.white, t, t + 0.25, null), h = F('highpass', 6000, 0.7), ng = G(0); chain(n, h, ng, tr.rev);
  env(ng.gain, t, [[0, 0], [0.002, vel * 0.5], [0.2, 0.0001, 'exp']]);
}
function kick(tr, t, vel = 0.9) {
  const o = O('sine', 155, t, t + 0.4, null); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
  const g = G(0); chain(o, g, tr.dry); env(g.gain, t, [[0, 0], [0.003, vel], [0.34, 0.0001, 'exp']]);
  const n = NS(BUF.white, t, t + 0.012, null), h = F('highpass', 3500, 0.7), ng = G(0); chain(n, h, ng, tr.dry);
  env(ng.gain, t, [[0, 0], [0.0008, vel * 0.25], [0.008, 0.0001, 'exp']]);
}
function clap(tr, t, vel = 0.5) {
  const n = NS(BUF.white, t, t + 0.25, null), b = F('bandpass', 1500, 1.1), g = G(0); chain(n, b, g, tr.dry);
  env(g.gain, t, [[0, 0], [0.001, vel], [0.009, vel * 0.25], [0.011, vel * 0.9], [0.02, vel * 0.25], [0.023, vel * 0.85], [0.18, 0.0001, 'exp']]);
  const s = G(0.25); g.connect(s); s.connect(tr.rev);
}
function hat(tr, t, vel = 0.15, open = false) {
  const d = open ? 0.24 : 0.035;
  const n = NS(BUF.white, t, t + d + 0.02, null), h = F('highpass', 7200, 0.8), g = G(0); chain(n, h, g, tr.dry);
  env(g.gain, t, [[0, 0], [0.001, vel * 0.6], [d, 0.0001, 'exp']]);
}
function shaker(tr, t, vel = 0.1) {
  const n = NS(BUF.white, t, t + 0.08, null), b = F('bandpass', 5800, 1.2), g = G(0); chain(n, b, g, tr.dry);
  env(g.gain, t, [[0, 0], [0.012, vel], [0.07, 0.0001, 'exp']]);
}
function cymbal(tr, t, vel = 0.2) {
  const n = NS(BUF.white, t, t + 1.6, null), h = F('highpass', 4500, 0.6), g = G(0); chain(n, h, g, tr.rev);
  env(g.gain, t, [[0, 0], [0.003, vel], [1.5, 0.0001, 'exp']]);
}
function riser(tr, t, dur) {
  const n = NS(BUF.white, t, t + dur, null), b = F('bandpass', 400, 2.5), g = G(0); chain(n, b, g, tr.rev);
  env(b.frequency, t, [[0, 350], [dur, 7000, 'exp']]);
  env(g.gain, t, [[0, 0], [dur * 0.95, 0.3], [dur, 0.0001, 'exp']]);
}
function pad(tr, t, freqs, dur, vel = 0.06) {
  const lp = F('lowpass', 950, 0.6), g = G(0); chain(lp, g, tr.rev);
  for (const f of freqs) { O('sawtooth', f, t, t + dur + 1.3, lp); if (!mobile) O('sawtooth', f * 1.005, t, t + dur + 1.3, lp); }
  env(g.gain, t, [[0, 0], [Math.min(0.9, dur * 0.4), vel], [dur, vel * 0.85], [dur + 1.2, 0.0001, 'exp']]);
}
function bass(tr, t, freq, dur, vel = 0.5) {
  const lp = F('lowpass', 900, 3), g = G(0), g2 = G(0.3);
  O('sawtooth', freq, t, t + dur + 0.1, lp); O('square', freq * 2, t, t + dur + 0.1, g2); g2.connect(lp);
  chain(lp, g, tr.dry);
  env(lp.frequency, t, [[0, 1400], [0.12, 320, 'exp']]);
  env(g.gain, t, [[0, 0], [0.004, vel], [Math.max(0.01, dur * 0.85), vel * 0.55], [dur + 0.06, 0.0001, 'exp']]);
}
function pluck(tr, t, freq, vel = 0.12, decay = 0.25) {
  const lp = F('lowpass', 2600, 1.5), g = G(0), g2 = G(0.35);
  O('triangle', freq, t, t + decay + 0.1, lp); O('sawtooth', freq * 1.003, t, t + decay + 0.1, g2); g2.connect(lp);
  chain(lp, g, tr.echo);
  env(lp.frequency, t, [[0, 3200], [decay, 700, 'exp']]);
  env(g.gain, t, [[0, 0], [0.003, vel], [decay, 0.0001, 'exp']]);
}
function lead(tr, t, freq, dur, vel = 0.1) {
  const lp = F('lowpass', 2200, 1), g = G(0);
  const a = O('sawtooth', freq, t, t + dur + 0.2, lp), b = O('sawtooth', freq * 1.007, t, t + dur + 0.2, lp);
  if (dur > 0.3) {
    const lfo = O('sine', 5.5, t, t + dur + 0.2, null), lg = G(0); lfo.connect(lg); lg.connect(a.frequency); lg.connect(b.frequency);
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * 0.01, t + Math.min(0.5, dur));
  }
  chain(lp, g, tr.echo);
  env(g.gain, t, [[0, 0], [0.02, vel], [Math.max(0.03, dur), vel * 0.8], [dur + 0.15, 0.0001, 'exp']]);
}

// tracks --------------------------------------------------------------------
const MENU = (() => { // Pahadi folk, 6/8 (dadra), bansuri over tanpura + dhol/hudka
  const SD = 0.28, BAR = 6, FL = 12; // flute one octave up (bansuri register)
  const A = [[4, 2], [2, 1], [4, 2], [7, 1], [9, 3], [7, 2], [4, 1], [2, 2], [4, 1], [2, 1], [0, 2], [-3, 3], [0, 3],
    [0, 1], [2, 1], [4, 1], [7, 3], [9, 2], [12, 1], [9, 2], [7, 1], [4, 2], [7, 1], [4, 1], [2, 2], [0, 6]];
  const B = [[7, 1], [9, 1], [12, 1], [14, 3], [12, 2], [9, 1], [7, 3], [9, 1], [12, 1], [9, 1], [7, 1], [4, 2], [2, 3], [4, 3],
    [7, 2], [4, 1], [2, 2], [0, 1], [2, 2], [0, 1], [-3, 3], [-5, 2], [-3, 1], [0, 3], [0, 3], [null, 3]];
  const INTRO = [[3, -3, 3], [6, 0, 8], [15, 2, 2], [17, 4, 3], [20, 2, 2], [22, 0, 2]]; // free "alaap" over the drone
  const ev = arr => { const m = {}; let at = 0; for (const [s, l] of arr) { if (s !== null) m[at] = [s, l]; at += l; } return m; };
  const EA = ev(A), EB = ev(B), EI = {}; for (const [at, s, l] of INTRO) EI[at] = [s, l];
  const PA = [[-12, -8, -5], [-15, -12, -8], [-12, -7, -3], [-12, -8, -5]];   // D  Bm  G  D
  const PB = [[-12, -7, -3], [-12, -8, -5], [-15, -12, -8], [-10, -5, -1]];   // G  D  Bm A
  const TAN = [-17, -12, -12, -24];                                          // Pa  Sa  Sa  Sa(low)
  return {
    stepDur: SD, level: 0.8, rev: 0.45, delay: 0.2, delayTime: SD * 1.5,
    step(tr, i, t) {
      const st = tr.st, introLen = 4 * BAR, loopLen = 28 * BAR;
      let sec, s;
      if (i < introLen) { sec = 'intro'; s = i; }
      else {
        const p = (i - introLen) % loopLen;
        if (p < 48) { sec = 'A'; s = p; } else if (p < 96) { sec = 'B'; s = p - 48; } else if (p < 144) { sec = 'A2'; s = p - 96; } else { sec = 'I'; s = p - 144; }
      }
      const beat = i % BAR, bar = Math.floor(s / BAR);
      if (i % 3 === 0) tanpura(tr, t, nf(TAN[(i / 3) % 4]), 2.6, 0.075);
      if (sec === 'intro') {
        if (bar >= 2 && (beat === 0 || beat === 3)) hudka(tr, t, beat === 0 ? 0.32 : 0.22);
      } else {
        const fillBar = (sec === 'B' && bar === 7) || (sec === 'I' && bar === 3);
        if (fillBar && beat >= 2) dholTreble(tr, t, 0.22 + beat * 0.05);
        else {
          if (beat === 0) dholBass(tr, t, 0.7);
          if (beat === 1) dholTreble(tr, t, 0.32);
          if (beat === 2) dholTreble(tr, t, 0.24);
          if (beat === 3) dholBass(tr, t, 0.5);
          if (beat === 4) hudka(tr, t, 0.38);
          if (beat === 5) dholTreble(tr, t, 0.28);
        }
        if (beat === 0 && bar % 2 === 0) manjira(tr, t, 0.1);
        if (sec === 'I' || sec === 'B') shaker(tr, t, beat % 3 === 0 ? 0.07 : 0.04);
      }
      if (beat === 0) {
        if (sec === 'intro' && bar === 0) pad(tr, t, [-12, -5, 0].map(nf), 4 * BAR * SD, 0.045);
        else if (sec !== 'intro' && bar % 2 === 0) {
          const ch = sec === 'I' ? PA[0] : (sec === 'B' ? PB : PA)[(bar >> 1) % 4];
          pad(tr, t, ch.map(nf), 2 * BAR * SD, 0.04);
          softBass(tr, t, nf(ch[0] - 12), 2 * BAR * SD * 0.9, 0.16);
        }
      }
      const evs = sec === 'intro' ? EI : sec === 'B' ? EB : (sec === 'A' || sec === 'A2') ? EA : null;
      const e = evs && evs[s];
      if (e) {
        const [semi, len] = e, f = nf(semi + FL), dur = len * SD * 0.94, o = {};
        if (st.prev && Math.abs(semi - st.prevSemi) <= 4 && Math.random() < 0.35) { o.from = st.prev; o.glide = 0.1; }   // meend
        else if (sec === 'A2' && len >= 2 && Math.random() < 0.55) { o.from = nf(upNeighbor(semi) + FL); o.glide = 0.07; } // kan swar
        flute(tr, t, f, dur, len >= 3 ? 0.62 : 0.7, o);
        st.prev = f; st.prevSemi = semi;
      }
    },
  };
})();

const RACE = (() => { // 136 bpm, B minor (same pentatonic as D major) — kick/clap/hats + dhol chaal + bass + arp + flute motif
  const SD = 60 / 136 / 4;
  const CH = [[-3, 0, 4], [-7, -3, 0], [0, 4, 7], [-5, -1, 2]];  // Bm G D A
  const ROOT = [-27, -31, -24, -29];                            // B1 G1 D2 A1
  const BASS = { 0: [0, 1.7, 0.55], 3: [0, 0.8, 0.4], 6: [12, 0.8, 0.45], 8: [0, 1.7, 0.55], 10: [7, 0.8, 0.4], 11: [0, 0.8, 0.36], 14: [12, 0.8, 0.45], 15: [7, 0.6, 0.36] };
  const DB = new Set([0, 3, 6, 8, 11, 14]), DT = new Set([2, 4, 7, 10, 12, 13, 15]);
  const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 1, 3];
  const mk = list => { const m = {}; for (const [at, s, l] of list) m[at] = [s, l]; return m; };
  const M1 = mk([[0, 16, 4], [4, 14, 2], [6, 12, 2], [8, 14, 4], [12, 9, 4], [16, 12, 2], [18, 14, 2], [20, 16, 2], [22, 19, 2], [24, 16, 6],
    [32, 19, 4], [36, 16, 2], [38, 14, 2], [40, 12, 4], [44, 14, 2], [46, 12, 2], [48, 9, 6], [54, 7, 2], [56, 9, 8]]);
  const M2 = mk([[0, 21, 4], [4, 19, 2], [6, 16, 2], [8, 19, 4], [12, 16, 4], [16, 14, 2], [18, 16, 2], [20, 14, 2], [22, 12, 2], [24, 9, 8],
    [32, 12, 4], [36, 14, 4], [40, 16, 4], [44, 19, 4], [48, 16, 12]]);
  return {
    stepDur: SD, level: 0.55, rev: 0.3, delay: 0.25, delayTime: SD * 3,
    step(tr, i, t) {
      const st = tr.st, bar = Math.floor(i / 16), s = i % 16;
      let sec, sb;
      if (bar < 4) { sec = 'intro'; sb = bar; }
      else {
        const lb = (bar - 4) % 36;
        if (lb < 8) { sec = 'A'; sb = lb; } else if (lb < 16) { sec = 'B'; sb = lb - 8; } else if (lb < 24) { sec = 'A2'; sb = lb - 16; }
        else if (lb < 28) { sec = 'BD'; sb = lb - 24; } else { sec = 'B2'; sb = lb - 28; }
      }
      const ci = sb % 4, ch = CH[ci], root = ROOT[ci];
      const full = sec === 'A' || sec === 'B' || sec === 'A2' || sec === 'B2';
      if (s === 0 && sb === 0 && sec !== 'intro') cymbal(tr, t, 0.16);
      if (full && s % 4 === 0) kick(tr, t, 0.85);
      if (sec === 'intro' && sb >= 2 && s % 4 === 0) kick(tr, t, 0.5 + sb * 0.1);
      if (full && (s === 4 || s === 12)) clap(tr, t, 0.42);
      if (sec !== 'BD') hat(tr, t, s % 4 === 2 ? 0.28 : 0.11, s === 14 && sb % 2 === 1);
      const dv = sec === 'BD' ? 0.45 : sec === 'intro' ? (sb >= 1 ? 0.6 : 0) : 1;
      if (full && sb === 7 && s >= 8) dholTreble(tr, t, 0.25 + (s - 8) * 0.045);            // fill into next section
      else if (dv > 0) {
        if (DB.has(s)) dholBass(tr, t, 0.5 * dv);
        if (DT.has(s)) dholTreble(tr, t, (s === 4 || s === 12 ? 0.4 : 0.26) * dv);
      }
      if (full) { const b = BASS[s]; if (b) bass(tr, t, nf(root + b[0]), b[1] * SD, b[2]); }
      else if (sec === 'BD' && s === 0) bass(tr, t, nf(root), 14 * SD, 0.3);
      if (full || sec === 'intro') {
        const n = ARP[s], semi = n === 3 ? ch[0] + 24 : ch[n] + 12;
        const v = sec === 'intro' ? 0.04 + sb * 0.025 : 0.1;
        pluck(tr, t, nf(semi), s % 4 === 0 ? v * 1.25 : v, 0.2);
      }
      if (s === 0 && (sec === 'BD' || sec === 'B' || sec === 'B2' || sec === 'intro')) pad(tr, t, ch.map(nf), 16 * SD, sec === 'BD' ? 0.08 : 0.045);
      if (s === 0 && ((sec === 'intro' && sb === 3) || (sec === 'BD' && sb === 3))) riser(tr, t, 16 * SD);
      if (sec === 'B' || sec === 'B2' || sec === 'BD' || sec === 'A2') {
        const ph = (sec === 'BD' || (sb % 8) < 4) ? M1 : M2, e = ph[(sb % 4) * 16 + s];
        if (e) {
          const [semi, len] = e, dur = len * SD * 0.95;
          if (sec === 'A2') { if (sb >= 4) lead(tr, t, nf(semi - 12), dur, 0.06); }
          else {
            const o = {};
            if (st.prev && Math.abs(semi - st.prevSemi) <= 3 && Math.random() < 0.3) { o.from = st.prev; o.glide = 0.06; }
            flute(tr, t, nf(semi), dur, sec === 'BD' ? 0.62 : 0.58, o);
            st.prev = nf(semi); st.prevSemi = semi;
          }
        }
      }
    },
  };
})();

const RESULTS = (() => { // 120 bpm, D major I-V-vi-IV, celebratory flute + dhol
  const SD = 0.125;
  const CH = [[0, 4, 7], [-5, -1, 2], [-3, 0, 4], [-7, -3, 0]], ROOT = [-24, -29, -27, -31];
  const MEL = [{ 0: [19, 4], 4: [16, 2], 6: [19, 2], 8: [21, 4], 12: [19, 4] }, { 0: [14, 4], 4: [16, 2], 6: [14, 2], 8: [12, 4], 12: [14, 4] },
    { 0: [16, 4], 4: [19, 4], 8: [21, 4], 12: [24, 4] }, { 0: [21, 6], 6: [19, 2], 8: [16, 4], 12: [12, 4] }];
  const DBs = new Set([0, 6, 8, 14]), DTs = new Set([3, 4, 10, 11, 12]);
  return {
    stepDur: SD, level: 0.65, rev: 0.4, delay: 0.25, delayTime: SD * 3,
    step(tr, i, t) {
      const bar = Math.floor(i / 16) % 4, s = i % 16, ch = CH[bar], root = ROOT[bar];
      if (s === 0 && bar === 0) cymbal(tr, t, 0.14);
      if (s === 0 || s === 8) kick(tr, t, 0.75);
      if (s === 4 || s === 12) clap(tr, t, 0.4);
      shaker(tr, t, s % 2 ? 0.05 : 0.08);
      if (DBs.has(s)) dholBass(tr, t, 0.45);
      if (DTs.has(s)) dholTreble(tr, t, 0.3);
      if (s === 0 || s === 8) bass(tr, t, nf(root), 3.5 * SD, 0.45);
      if (s === 6 || s === 14) bass(tr, t, nf(root + 12), 1.5 * SD, 0.35);
      if (s === 0) pad(tr, t, ch.map(nf), 16 * SD, 0.05);
      if (s % 2 === 0) pluck(tr, t, nf(ch[(s / 2) % 3] + 12), 0.07, 0.18);
      const e = MEL[bar][s];
      if (e) flute(tr, t, nf(e[0]), e[1] * SD * 0.95, 0.62);
    },
  };
})();

const TRACKS = { menu: MENU, race: RACE, results: RESULTS };

class Track {
  constructor(name, def) {
    this.name = name; this.def = def; this.step = 0; this.st = {}; this.timer = null;
    this.fade = G(0); this.revFade = G(0); this.delFade = G(0);
    this.fade.connect(N.musicIn); this.revFade.connect(N.revIn); this.delFade.connect(N.delayIn);
    this.dry = G(1); this.rev = G(1); this.echo = G(1);
    this.dry.connect(this.fade); this.rev.connect(this.fade); this.echo.connect(this.fade);
    const rs = G(def.rev ?? 0.35), es = G(def.rev ?? 0.35), ed = G(def.delay ?? 0.25);
    this.rev.connect(rs); this.echo.connect(es); this.echo.connect(ed);
    rs.connect(this.revFade); es.connect(this.revFade); ed.connect(this.delFade);
  }
  setFade(v, time) {
    const t = ctx.currentTime;
    for (const g of [this.fade, this.revFade, this.delFade]) {
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + Math.max(0.02, time));
    }
  }
  start(fade) {
    const t = ctx.currentTime;
    this.nextTime = t + 0.08;
    N.dl.delayTime.setTargetAtTime(this.def.delayTime, t, 0.05); N.dr.delayTime.setTargetAtTime(this.def.delayTime, t, 0.05);
    this.setFade(this.def.level, fade);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }
  tick() {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (this.nextTime < t - 0.25) this.nextTime = t + 0.05; // timers were throttled — skip ahead instead of bursting
    let guard = 0;
    while (this.nextTime < t + 0.12 && guard++ < 32) {
      try { this.def.step(this, this.step, this.nextTime); } catch (e) { console.warn('[audio] music step failed', e); }
      this.nextTime += this.def.stepDur; this.step++;
    }
  }
  stop(fade) {
    this.setFade(0, fade);
    setTimeout(() => {
      clearInterval(this.timer);
      for (const g of [this.fade, this.revFade, this.delFade]) { try { g.disconnect(); } catch (e) { /* noop */ } }
    }, fade * 1000 + 700);
  }
}
function startTrack(name, fade) {
  if (curTrack && curTrack.name === name) return;
  if (curTrack) { curTrack.stop(fade); curTrack = null; }
  const def = TRACKS[name];
  if (!def) return;
  curTrack = new Track(name, def);
  curTrack.start(fade);
}

// ------------------------------------------------------------------------------------------- public API
export const Audio = {
  /** Create / resume the AudioContext. Call from a click/tap/keydown handler. Idempotent. */
  unlock() {
    try {
      if (typeof navigator !== 'undefined' && navigator.audioSession) { try { navigator.audioSession.type = 'playback'; } catch (e) { /* noop */ } }
      if (!createContext()) return Promise.resolve();
      // resume synchronously inside the gesture (iOS needs this before any await)
      const p = ctx.state !== 'running' ? ctx.resume() : Promise.resolve();
      try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* noop */ }
      unlockedOnce = true;
      if (!N) buildAll();
      return Promise.race([p, new Promise(r => setTimeout(r, 900))]).then(afterUnlock, afterUnlock).catch(() => {});
    } catch (e) {
      console.warn('[audio] unlock failed', e);
      return Promise.resolve();
    }
  },
  get ready() { return !!ctx && !!N && ctx.state === 'running'; },

  setVolumes(v = {}) {
    for (const k of ['master', 'music', 'sfx']) if (v[k] != null && isFinite(v[k])) vol[k] = clamp01(+v[k]);
    applyVolumes();
  },

  playMusic(name, { fade = 1.5 } = {}) {
    wantedMusic = name || null;
    if (!ctx || !N) return;
    if (!wantedMusic) { if (curTrack) { curTrack.stop(fade); curTrack = null; } return; }
    startTrack(wantedMusic, fade);
  },

  ui(name) { playOne(UI, name, {}, true); },

  sfx(name, opts = {}) { playOne(SFX, name, opts || {}); },

  setListener(position, forward) {
    if (position) { LIS.x = +position.x || 0; LIS.y = +position.y || 0; LIS.z = +position.z || 0; }
    if (!ctx) return;
    const Lr = ctx.listener;
    let fx = 0, fy = 0, fz = -1;
    if (forward) {
      fx = +forward.x || 0; fy = +forward.y || 0; fz = +forward.z || 0;
      const h = Math.hypot(fx, fz); if (h < 1e-4) { fx = 0; fz = -1; fy = 0; } else { fx /= h; fz /= h; fy = 0; } // keep orientation horizontal
    }
    try {
      if (Lr.positionX) {
        Lr.positionX.value = LIS.x; Lr.positionY.value = LIS.y; Lr.positionZ.value = LIS.z;
        Lr.forwardX.value = fx; Lr.forwardY.value = fy; Lr.forwardZ.value = fz;
        Lr.upX.value = 0; Lr.upY.value = 1; Lr.upZ.value = 0;
      } else {
        Lr.setPosition(LIS.x, LIS.y, LIS.z); Lr.setOrientation(fx, fy, fz, 0, 1, 0);
      }
    } catch (e) { /* noop */ }
  },

  /** returns { update({rpm, throttle, speed, gear, position}), shift(up), setLimiter(on), setVolume(v), dispose() } */
  createEngine(type, { local = true } = {}) { return new EngineSound(type, local); },

  setRide(s) { setRideImpl(s); },

  /** levels 0..1; keys not passed keep their previous level (pass 0 to fade a bed out) */
  setAmbience(levels) { setAmbienceImpl(levels || {}); },

  pauseAll(p) {
    paused = !!p;
    if (!ctx || !N) return;
    const t = ctx.currentTime;
    N.gameDuck.gain.setTargetAtTime(paused ? 0 : 1, t, 0.08);
    N.musicDuck.gain.setTargetAtTime(paused ? 0.45 : 1, t, 0.2);
  },

  // ---- integration hooks (voice lines) ----
  get context() { return ctx; },
  /** node to connect character voice recordings into (pre-compressor master) */
  get voiceOut() { return N ? N.master : null; },
  /** lower the music while a character speaks */
  duckMusic(on) {
    if (!ctx || !N) return;
    N.musicDuck.gain.setTargetAtTime(paused ? 0.45 : (on ? 0.32 : 1), ctx.currentTime, on ? 0.06 : 0.35);
  },

  // ---- dev / debug helpers (not part of the gameplay contract) ----
  get _ctx() { return ctx; },
  _stats() {
    return { state: ctx ? ctx.state : 'none', voices: voices.length, uiVoices: uiVoices.length, engines: engines.size,
      beds: Object.keys(beds), music: curTrack ? curTrack.name : null, paused };
  },
  /** RMS / peak meter on a bus: 'master' | 'music' | 'engine' | 'amb' | 'ride' | 'fx' | 'ui' */
  _meter(bus = 'master') {
    if (!ctx || !N) return null;
    N.meters = N.meters || {};
    let m = N.meters[bus];
    if (!m) {
      const src = { master: N.comp, music: N.musicDuck, engine: N.engineBus, amb: N.ambBus, ride: N.rideBus, fx: N.fxBus, ui: N.uiBus }[bus];
      if (!src) return null;
      const an = ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0; src.connect(an);
      m = N.meters[bus] = { an, td: new Float32Array(an.fftSize), fd: new Float32Array(an.frequencyBinCount) };
    }
    m.an.getFloatTimeDomainData(m.td);
    let s = 0, pk = 0; for (let i = 0; i < m.td.length; i++) { const v = m.td[i]; s += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); }
    return { rms: Math.sqrt(s / m.td.length), peak: pk };
  },
  /** strongest spectral peaks [Hz] on a bus (after _meter(bus) has created its analyser) */
  _peaks(bus = 'master', lo = 30, hi = 5000, count = 3) {
    const m = N && N.meters && N.meters[bus]; if (!m) return [];
    m.an.getFloatFrequencyData(m.fd);
    const binHz = ctx.sampleRate / m.an.fftSize, out = [];
    for (let i = Math.max(2, Math.floor(lo / binHz)); i < Math.min(m.fd.length - 1, hi / binHz); i++) {
      if (m.fd[i] > m.fd[i - 1] && m.fd[i] >= m.fd[i + 1]) out.push([i * binHz, m.fd[i]]);
    }
    out.sort((a, b) => b[1] - a[1]);
    return out.slice(0, count).map(([f, db]) => [Math.round(f), Math.round(db)]);
  },
};

export default Audio;

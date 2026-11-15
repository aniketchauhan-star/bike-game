// Audio test bench: audition every sound + a scripted smoke test (window.__audioTest.runAll()).
import { Audio } from '../js/audio/audio.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');
const logEl = $('#log');
const errors = [];
const log = (...a) => { const s = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); logEl.textContent += s + '\n'; logEl.scrollTop = 1e9; console.log('[test]', s); };
window.addEventListener('error', e => { errors.push('error: ' + e.message); log('ERROR', e.message); });
window.addEventListener('unhandledrejection', e => { errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)); log('REJECTION', String(e.reason)); });
const origErr = console.error.bind(console);
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origErr(...a); };
const origWarn = console.warn.bind(console);
console.warn = (...a) => { errors.push('console.warn: ' + a.join(' ')); origWarn(...a); };

const UI_NAMES = ['click', 'hover', 'swipe', 'select', 'back', 'countdown', 'go', 'finish', 'error', 'notify', 'join', 'lose'];
const SFX_NAMES = ['horn', 'busHorn', 'truckHorn', 'autoHorn', 'crash', 'bump', 'cowMoo', 'tigerRoar', 'snakeHiss', 'monkey',
  'dogBark', 'elephant', 'templeBell', 'koel', 'chirp', 'crow', 'peacock', 'thrush', 'cheer', 'backfire', 'whoosh', 'splash'];
const AMB = ['forest', 'river', 'town', 'mountain', 'waterfall', 'crowd', 'temple', 'insects'];
const PRESETS = {
  'Ramnagar town': { town: 1, forest: 0, river: 0, mountain: 0, waterfall: 0, crowd: 0.2, temple: 0, insects: 0 },
  'Corbett forest': { town: 0, forest: 1, river: 0, mountain: 0, waterfall: 0, crowd: 0, temple: 0, insects: 0.8 },
  'Kosi river + Garjiya': { town: 0, forest: 0.4, river: 1, mountain: 0, waterfall: 0, crowd: 0, temple: 0.7, insects: 0.2 },
  'Mountain climb': { town: 0, forest: 0.2, river: 0, mountain: 1, waterfall: 0.5, crowd: 0, temple: 0, insects: 0 },
  'Ranikhet finish': { town: 0.4, forest: 0, river: 0, mountain: 0.5, waterfall: 0, crowd: 1, temple: 0, insects: 0 },
  'Silence': { town: 0, forest: 0, river: 0, mountain: 0, waterfall: 0, crowd: 0, temple: 0, insects: 0 },
};

function section(title) { const s = document.createElement('section'); s.innerHTML = `<h2>${title}</h2>`; app.appendChild(s); return s; }
function btn(parent, text, fn) { const b = document.createElement('button'); b.textContent = text; b.onclick = () => { try { fn(); } catch (e) { log('ERR', e.message); errors.push(e.message); } }; parent.appendChild(b); return b; }
function slider(parent, label, min, max, step, value, fn) {
  const l = document.createElement('label'); l.textContent = label;
  const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
  const v = document.createElement('span'); v.className = 'val'; v.textContent = value;
  r.oninput = () => { v.textContent = r.value; fn(+r.value); };
  l.append(r, v); parent.appendChild(l); return r;
}

// ---- unlock
$('#unlock').onclick = async () => { await Audio.unlock(); $('#state').textContent = 'state: ' + (Audio._ctx ? Audio._ctx.state : 'none') + (Audio.ready ? ' ✓ ready' : ''); };

// ---- volumes
{
  const s = section('Volumes'); const v = { master: 0.9, music: 0.6, sfx: 0.9 };
  for (const k of Object.keys(v)) slider(s, k, 0, 1, 0.01, v[k], x => { v[k] = x; Audio.setVolumes(v); });
}
// ---- music
{
  const s = section('Music');
  for (const m of ['menu', 'race', 'results']) btn(s, '▶ ' + m, () => Audio.playMusic(m));
  btn(s, '■ stop', () => Audio.playMusic(null));
  btn(s, '⏸ pauseAll(true)', () => Audio.pauseAll(true));
  btn(s, '▶ pauseAll(false)', () => Audio.pauseAll(false));
}
// ---- ui
{ const s = section('UI sounds'); for (const n of UI_NAMES) btn(s, n, () => Audio.ui(n)); }
// ---- sfx
let positional = false;
{
  const s = section('SFX (one-shots)');
  const l = document.createElement('label'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.onchange = () => positional = cb.checked;
  l.append(cb, ' positional (random spot 5–40 m around listener)'); s.appendChild(l); s.appendChild(document.createElement('br'));
  for (const n of SFX_NAMES) btn(s, n, () => {
    const opts = {};
    if (positional) { const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 35; opts.pos = { x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d }; log(n, 'at', opts.pos); }
    Audio.setListener({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 });
    Audio.sfx(n, opts);
  });
}
// ---- ambience
{
  const s = section('Ambience beds'); const lv = {}; const sliders = {};
  for (const k of AMB) { lv[k] = 0; sliders[k] = slider(s, k, 0, 1, 0.01, 0, x => { lv[k] = x; Audio.setAmbience({ [k]: x }); }); }
  s.appendChild(document.createElement('br'));
  for (const [name, p] of Object.entries(PRESETS)) btn(s, name, () => { Audio.setAmbience(p); for (const k of AMB) { sliders[k].value = p[k]; sliders[k].nextSibling.textContent = p[k]; } });
}
// ---- engine
const REDLINE = { zx10r: 14000, s1000rr: 14600, panigale: 16000 };
const IDLE = { zx10r: 1250, s1000rr: 1300, panigale: 1400 };
let eng = null, engType = 'zx10r', manual = { rpm: 1300, throttle: 0, speed: 0 }, demo = null, engTimer = null, limiter = false;
function ensureEngine() {
  if (!eng) { eng = Audio.createEngine(engType, { local: true }); log('engine created', engType); }
  if (!engTimer) engTimer = setInterval(() => {
    if (!eng) return;
    if (demo) demo.step(1 / 60);
    const st = demo ? demo.state : manual;
    eng.update({ rpm: st.rpm, throttle: st.throttle, speed: st.speed, gear: st.gear || 1 });
    Audio.setRide({ speed: st.speed, skid: 0, scrape: 0, offroad: 0 });
    rpmOut.textContent = `rpm ${Math.round(st.rpm)}  gear ${st.gear || '-'}  ${Math.round(st.speed * 3.6)} km/h  thr ${st.throttle.toFixed(2)}`;
  }, 1000 / 60);
}
function killEngine() { if (eng) { eng.dispose(); eng = null; } demo = null; Audio.setRide({ speed: 0 }); }
// tiny gearbox sim: full throttle through 6 gears, then throttle off (crackles)
function makeDemo(type) {
  const red = REDLINE[type], idle = IDLE[type];
  const ratios = [0, 2.6, 1.95, 1.6, 1.38, 1.22, 1.1]; const k = 17.5; // rpm per (m/s * ratio)
  const st = { rpm: idle, throttle: 1, speed: 0, gear: 1 }; let tt = 0, phase = 'launch';
  return {
    state: st,
    step(dt) {
      tt += dt;
      if (phase === 'launch') { st.throttle = 1; if (tt > 0.6) phase = 'accel'; st.rpm = Math.min(red * 0.55, st.rpm + 9000 * dt); return; }
      if (phase === 'accel') {
        st.throttle = 1;
        const a = 9.5 * (1 - st.speed / 90) / (1 + (st.gear - 1) * 0.25);
        st.speed += a * dt;
        st.rpm = Math.max(idle * 1.2, st.speed * ratios[st.gear] * k * 10);
        if (st.rpm > red * 0.97) {
          if (st.gear < 6) { st.gear++; eng && eng.shift(true); }
          else { phase = 'limiter'; tt = 0; eng && eng.setLimiter(true); }
        }
        return;
      }
      if (phase === 'limiter') { st.rpm = red; if (tt > 0.8) { eng && eng.setLimiter(false); phase = 'decel'; tt = 0; } return; }
      if (phase === 'decel') {
        st.throttle = 0; st.speed = Math.max(0, st.speed - 7 * dt);
        st.rpm = Math.max(idle, st.speed * ratios[st.gear] * k * 10);
        if (st.rpm < red * 0.45 && st.gear > 1) { st.gear--; eng && eng.shift(false); }
        if (st.speed <= 0.5) { phase = 'idle'; tt = 0; }
        return;
      }
      if (phase === 'idle') { st.throttle = 0; st.rpm = idle; st.speed = 0; st.gear = 1; }
    },
  };
}
let rpmOut;
{
  const s = section('Engine (local) + ride layer');
  const sel = document.createElement('select'); for (const t of ['zx10r', 's1000rr', 'panigale']) { const o = document.createElement('option'); o.value = t; o.textContent = t; sel.appendChild(o); }
  sel.onchange = () => { engType = sel.value; killEngine(); };
  s.appendChild(sel);
  btn(s, '▶ start engine (manual)', () => { demo = null; ensureEngine(); });
  btn(s, '🏁 demo: full-throttle run', () => { killEngine(); ensureEngine(); demo = makeDemo(engType); });
  btn(s, '⇧ shift up', () => eng && eng.shift(true));
  btn(s, '⇩ shift down', () => eng && eng.shift(false));
  btn(s, 'limiter on/off', () => { limiter = !limiter; eng && eng.setLimiter(limiter); });
  btn(s, '■ stop engine', killEngine);
  s.appendChild(document.createElement('br'));
  slider(s, 'rpm', 1000, 16500, 10, 1300, x => manual.rpm = x);
  slider(s, 'throttle', 0, 1, 0.01, 0, x => manual.throttle = x);
  slider(s, 'speed m/s', 0, 90, 0.5, 0, x => manual.speed = x);
  rpmOut = document.createElement('div'); rpmOut.style.cssText = 'font:13px ui-monospace,monospace;margin-top:6px;color:#f5b400'; s.appendChild(rpmOut);
  s.appendChild(document.createElement('br'));
  const ride = { speed: 0, skid: 0, scrape: 0, offroad: 0 };
  for (const k of Object.keys(ride)) slider(s, 'ride.' + k, 0, k === 'speed' ? 90 : 1, 0.01, 0, x => { ride[k] = x; Audio.setRide(ride); });
}
// ---- remote engine fly-by (doppler + panning)
function flyBy(type = 'panigale') {
  const e = Audio.createEngine(type, { local: false }); let z = -150; const v = 60;
  Audio.setListener({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 });
  const id = setInterval(() => {
    z += v / 60;
    e.update({ rpm: REDLINE[type] * 0.78, throttle: 1, speed: v, gear: 5, position: { x: 4, y: 1, z } });
    if (z > 150) { clearInterval(id); e.dispose(); log('fly-by done'); }
  }, 1000 / 60);
}
{ const s = section('Remote rider fly-by (non-local engine)'); for (const t of ['zx10r', 's1000rr', 'panigale']) btn(s, '💨 ' + t, () => flyBy(t)); }

// ------------------------------------------------------------------------------------------- smoke test
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function measure(fn, ms, bus) {
  Audio._meter(bus);
  if (fn) fn();
  let peak = 0, rms = 0; const t0 = performance.now();
  while (performance.now() - t0 < ms) { await sleep(30); const m = Audio._meter(bus); if (m) { peak = Math.max(peak, m.peak); rms = Math.max(rms, m.rms); } }
  return { peak: +peak.toFixed(3), rms: +rms.toFixed(3) };
}
const report = { errors, levels: {}, engine: {}, notes: [] };
async function runAll() {
  const t0 = performance.now();
  await Audio.unlock();
  report.state = Audio._ctx && Audio._ctx.state; report.ready = Audio.ready;
  Audio.setVolumes({ master: 1, music: 1, sfx: 1 });
  Audio.setListener({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 });
  // API calls with odd inputs must not throw
  Audio.sfx('doesNotExist'); Audio.ui('nope'); Audio.setAmbience({}); Audio.setRide({}); Audio.setVolumes({}); Audio.setListener();
  // UI sounds (measured individually)
  for (const n of UI_NAMES) report.levels['ui.' + n] = await measure(() => Audio.ui(n), 380, 'ui');
  // SFX: measure each one alone
  for (const n of SFX_NAMES) report.levels['sfx.' + n] = await measure(() => Audio.sfx(n), n === 'templeBell' ? 1200 : 900, 'fx');
  // positional + voice cap stress
  for (let i = 0; i < 20; i++) Audio.sfx(SFX_NAMES[i % SFX_NAMES.length], { pos: { x: Math.random() * 40 - 20, y: 0, z: Math.random() * 40 - 20 }, volume: 0.5 });
  report.stressStats = Audio._stats();
  await sleep(1500);
  // engines: rpm sweep + spectrum check at fixed rpm
  for (const type of ['zx10r', 's1000rr', 'panigale']) {
    const e = Audio.createEngine(type);
    const r = {}; const red = REDLINE[type];
    for (const [rpm, thr] of [[IDLE[type], 0], [6000, 1], [12000, 1], [red, 1], [9000, 0]]) {
      const id = setInterval(() => e.update({ rpm, throttle: thr, speed: rpm / 200, gear: 3 }), 16);
      await sleep(350);
      const m = await measure(null, 250, 'engine');
      r[`${rpm}@${thr}`] = { ...m, peaksHz: Audio._peaks('engine', 25, 4000, 3), firingHz: Math.round(rpm / 30) };
      clearInterval(id);
    }
    e.shift(true); e.setLimiter(true);
    const id2 = setInterval(() => e.update({ rpm: red, throttle: 1, speed: 70, gear: 6 }), 16);
    await sleep(300); clearInterval(id2); e.setLimiter(false); e.setVolume(0.5);
    e.dispose(); e.update({ rpm: 5000 }); // update after dispose must be a no-op
    report.engine[type] = r;
  }
  // remote engine fly-by
  {
    const e = Audio.createEngine('panigale', { local: false }); let z = -60;
    const id = setInterval(() => { z += 2; e.update({ rpm: 11000, throttle: 1, speed: 60, gear: 5, position: { x: 3, y: 1, z } }); }, 16);
    report.levels.flyby = await measure(null, 1200, 'engine'); clearInterval(id); e.dispose();
  }
  // ride layer
  report.levels.ride70 = await measure(() => Audio.setRide({ speed: 70, skid: 0, scrape: 0, offroad: 0 }), 600, 'ride');
  report.levels.rideSkid = await measure(() => Audio.setRide({ speed: 20, skid: 1, scrape: 0, offroad: 0 }), 500, 'ride');
  report.levels.rideScrape = await measure(() => Audio.setRide({ speed: 30, skid: 0, scrape: 1, offroad: 0 }), 500, 'ride');
  report.levels.rideGravel = await measure(() => Audio.setRide({ speed: 25, skid: 0, scrape: 0, offroad: 1 }), 500, 'ride');
  Audio.setRide({ speed: 0 });
  // ambience beds, one at a time
  for (const k of AMB) {
    const lv = Object.fromEntries(AMB.map(a => [a, a === k ? 1 : 0]));
    report.levels['amb.' + k] = await measure(() => Audio.setAmbience(lv), 2200, 'amb');
  }
  Audio.setAmbience(PRESETS.Silence);
  // music
  for (const m of ['menu', 'race', 'results']) report.levels['music.' + m] = await measure(() => Audio.playMusic(m, { fade: 0.3 }), 3500, 'music');
  Audio.pauseAll(true); await sleep(200); Audio.pauseAll(false);
  Audio.playMusic(null, { fade: 0.3 });
  report.master = await measure(null, 200, 'master');
  report.finalStats = Audio._stats();
  report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  return 'done';
}
// focused engine scan: spectral peaks at fixed rpm (analyser smoothing is 0, so readings are per-window)
async function engineScan() {
  await Audio.unlock();
  Audio.setVolumes({ master: 1, music: 1, sfx: 1 });
  const out = {};
  for (const type of ['zx10r', 's1000rr', 'panigale']) {
    const e = Audio.createEngine(type); const r = {};
    for (const [rpm, thr] of [[IDLE[type], 0], [4000, 0.6], [8000, 1], [12000, 1], [9000, 0]]) {
      const id = setInterval(() => e.update({ rpm, throttle: thr, speed: rpm / 200, gear: 3 }), 16);
      await sleep(450);
      Audio._meter('engine');
      const peaks = []; for (let k = 0; k < 4; k++) { await sleep(90); peaks.push(Audio._peaks('engine', 25, 3000, 4)); }
      const m = await measure(null, 200, 'engine');
      r[`${rpm}rpm@${thr}`] = { rms: m.rms, cycleHz: +(rpm / 120).toFixed(1), firingHz: Math.round(rpm / 30), peaks: peaks[3], peaks2: peaks[1] };
      clearInterval(id);
    }
    e.dispose(); await sleep(400);
    out[type] = r;
  }
  return out;
}
window.__audioTest = { runAll, engineScan, report };

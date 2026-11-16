// UTTARAKHAND RIDERS — app entry: loading → tap (fullscreen) → lobby → race → results. Multiplayer via net.js.
import * as THREE from 'three';
import { Settings, QUALITY, resolveQuality, CHARACTERS, charById, MODES } from './config.js';
import { loadingManager, isTouch, isMobile } from './core/util.js';
import { UI } from './ui/ui.js';
import { Input, noBrowserTouch } from './game/input.js';
import { Audio } from './audio/audio.js';
import { Voice } from './audio/voice.js';
import { Samples } from './audio/samples.js';
import { MusicPlayer } from './audio/music.js';
import { Multiplayer, drawQR } from './net/net.js';
import { VoiceChat } from './net/voicechat.js';

const S = Settings.load();
const app = {
  settings: S, audio: Audio, ui: null, input: new Input(), models: {}, world: null, lobby: null, race: null, mp: null,
  state: 'loading', charIndex: Math.max(0, CHARACTERS.findIndex(c => c.id === S.character)), paused: false,
};
window.__app = app;

// ------------------------------------------------------------------ renderer + layout
const quality = resolveQuality(S.quality, isMobile() || (isTouch() && Math.min(screen.width, screen.height) < 900));
app.quality = quality;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !!quality.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.renderer = renderer;
const camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.3, 4000);
app.camera = camera;
const gameEl = document.getElementById('game');
noBrowserTouch(canvas); // long-press / double-tap on the 3D view never opens browser menus or zooms
// ---- behave like a real game, not a web page: no selection / copy / context menu / long-press menu / zoom
{
  const field = (t) => !!t?.closest?.('input, textarea, select');
  for (const ev of ['contextmenu', 'selectstart', 'copy', 'cut', 'dragstart', 'drop']) document.addEventListener(ev, (e) => { if (!field(e.target)) e.preventDefault(); }, true);
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || !e.target?.closest?.('#panel')) e.preventDefault(); }, { passive: false });
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !field(e.target) && ['s', 'p', 'u', 'a', 'c', 'x', 'f', 'g', '+', '-', '=', '0'].includes((e.key || '').toLowerCase())) e.preventDefault();
  }, true);
}
const touch = isTouch();

// dynamic resolution: if the GPU can't hold the target frame rate, render fewer pixels (UI text stays sharp)
const drs = { scale: 1, min: quality.drsMin ?? 0.6, sum: 0, n: 0, good: 0, slow: 0, refresh: 60, rafs: [] };
function drsSample(ms) {
  if (ms > 250 || app.state === 'loading') { drs.sum = 0; drs.n = 0; return; }
  drs.sum += ms; drs.n++;
  if (drs.n < 40) return;
  const avg = drs.sum / drs.n; drs.sum = 0; drs.n = 0;
  const target = 1000 / Math.min(S.fpsLimit || drs.refresh, drs.refresh);
  let next = drs.scale;
  if (avg > target * 1.25) { next = Math.max(drs.min, drs.scale * Math.max(0.85, Math.sqrt(target / avg))); drs.good = 0; } // only when it really drops (< ~48 fps)
  else if (avg < target * 1.08) { if (++drs.good >= 2) { next = Math.min(1, drs.scale + 0.1); drs.good = 0; } }          // and back to full sharpness quickly
  else drs.good = 0;
  if (drs.scale <= drs.min + 0.001 && avg > target * 1.45 && app.state === 'race') {
    if (++drs.slow === 6 && S.quality === 'high') ui.toast('📱 Phone par game atak raha hai — Settings ⚙ me Graphics MEDIUM karo');
  } else drs.slow = 0;
  next = Math.round(next * 20) / 20;
  if (Math.abs(next - drs.scale) >= 0.049) { drs.scale = next; layout(); }
}
app.drs = drs;

function layout() {
  const W = innerWidth, H = innerHeight;
  let w = W, h = H;
  if (S.aspect !== 'fill') { if (W / H > 16 / 9) { h = H; w = Math.round(H * 16 / 9); } else { w = W; h = Math.round(W * 9 / 16); } }
  gameEl.style.width = w + 'px'; gameEl.style.height = h + 'px';
  gameEl.style.fontSize = (Math.min(w, h * 16 / 9) / 100) + 'px';
  gameEl.style.setProperty('--u', Math.min(h / 100, w / 178) + 'px'); // touch-control unit (same look on every screen shape)
  const dpr = Math.min(devicePixelRatio || 1, quality.maxDpr) * quality.pixelRatio * drs.scale;
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  app.lobby?.resize(w, h);
}
addEventListener('resize', layout);
addEventListener('orientationchange', () => setTimeout(layout, 200));
layout();

// ------------------------------------------------------------------ loading
const ui = new UI(app); app.ui = ui;
ui.applyControls(S, touch);

async function boot() {
  let p = 0; const step = (v, t) => { p = v; ui.loading(p, t); };
  // the 3D world (sky + Himalaya first, then terrain, forests, towns) fills in behind the title while loading
  const { World } = await import('./world/world.js');
  app.world = new World(renderer, quality);
  camera.far = app.world.viewFar; camera.updateProjectionMatrix();
  app.world.setTimeOfDay('evening');
  setupTitleCam();
  step(0.02, 'Fonts aur awaazein...');
  const fontsReady = document.fonts ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  const allVoices = CHARACTERS.flatMap(c => [c.intro, ...(c.voices || [])].filter(Boolean));
  const pre = Promise.all([Voice.preload(allVoices), Samples.preload(), MusicPlayer.load(), fontsReady]);
  step(0.05, 'Bikes aur riders taiyaar ho rahe hain...');
  const load = async (k, path) => { try { app.models[k] = await import(path); } catch (e) { console.error('module failed', path, e); app.models[k] = {}; } };
  await Promise.all([load('bikes', './models/bikes.js'), load('riders', './models/riders.js'), load('veg', './models/vegetation.js'), load('props', './models/props.js')]);
  try { await app.models.riders.preloadRiders?.(); } catch (e) { console.warn(e); }
  step(0.12, 'Lobby saj rahi hai...');
  const { Lobby } = await import('./lobby.js');
  app.lobby = new Lobby(renderer, app.models); layout();
  app.lobby.index = app.charIndex;

  step(0.18, 'Ramnagar se Ranikhet ka raasta ban raha hai...');
  const labels = [[0.25, 'Pahad aur ghaatiyan...'], [0.45, 'Kosi nadi beh rahi hai...'], [0.6, 'Bazaar, bus stand aur gaon...'], [0.75, 'Corbett ka jungle uga rahe hain...'], [0.9, 'Aasmaan aur roshni...']];
  await app.world.build((v) => { const pv = 0.18 + v * 0.74; const l = labels.filter(x => v >= x[0]).pop(); step(pv, l ? l[1] : null); });
  ui.drawMapThumb(app.world.track);
  ui.buildRadar(app.world);
  step(0.94, 'Shaders compile ho rahe hain...');
  await pre;
  try { const T = app.world.track; const pnt = T.point(T.startS, 0); camera.position.set(pnt.x, pnt.y + 3, pnt.z + 8); camera.lookAt(pnt); await renderer.compileAsync?.(app.world.scene, camera); } catch (e) { /* older three */ }
  step(1, 'Taiyaar!');
  updateTitle(0.016); updateTitle(0.016);
  document.getElementById('scr-loading').classList.add('world');
  setTimeout(() => { if (titleCam) titleCam.frozen = false; }, 1400);
  setCharacter(app.charIndex, 0, true);
  ui.setLobbyInfo(S);
  app.state = 'tap';
  ui.showTap(onTap); app.updFsHint?.();
}

if (new URLSearchParams(location.search).get('titleshot') === '1') document.body.classList.add('titleshot');

async function onTap() {
  // must run inside the user gesture
  goFullscreen();
  await Audio.unlock();
  applyVolumes();
  Voice.init(Audio.context, Audio.voiceOut);
  Samples.init(Audio.context, Audio.voiceOut);
  Voice.onDuck = (on) => { Audio.duckMusic(on); MusicPlayer.setDuck(on); if (app.busMusic) app.busMusic.duck = on ? 0.3 : 1; };
  MusicPlayer.attach();
  MusicPlayer.setVolume(S.music);
  MusicPlayer.setScene('menu');
  MusicPlayer.select(Math.min(S.musicTrack ?? 2, MusicPlayer.tracks.length - 1), false); // user starts music himself
  MusicPlayer.emit();
  enterLobby();
  const room = new URLSearchParams(location.search).get('room');
  setTimeout(() => ui.tutorial(false, () => {
    let shown = false; try { shown = sessionStorage.getItem('ukr.iosTip') === '1'; } catch { /* */ }
    if (iosNeedsTip() && !shown) { try { sessionStorage.setItem('ukr.iosTip', '1'); } catch { /* */ } ui.iosFullscreenTip(() => { if (room) ui.openMultiplayer(); }); }
    else if (room) ui.openMultiplayer();
  }), 500);
  setTimeout(() => Voice.playIntro(CHARACTERS[app.charIndex].id), 900);
}

// ------------------------------------------------------------------ full screen
// Browsers only allow full screen inside a user gesture, so: the very FIRST tap / click / key anywhere
// (even while loading) switches to full screen + landscape. Installed as an app (manifest display: fullscreen)
// the game opens full screen straight from its home-screen icon.
const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const isInstalled = () => matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function goFullscreen() {
  if (isFs() || !fsSupported) return;
  const el = document.documentElement; const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const lock = () => { try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* */ } };
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen();
    if (r && r.then) r.then(lock).catch(() => {}); else setTimeout(lock, 300);
  } catch { /* */ }
}
const iosNeedsTip = () => !fsSupported && /iPhone|iPod|iPad|Macintosh/.test(navigator.userAgent) && isTouch() && !isInstalled();
app.toggleFullscreen = () => {
  if (!fsSupported) { ui.iosFullscreenTip(); return; }
  if (isFs()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); else goFullscreen();
};
{
  const evs = ['pointerup', 'touchend', 'mousedown', 'keydown', 'click'];
  const onGesture = (e) => {
    if (e.type === 'keydown' && e.key === 'Escape') return;
    if (e.target?.closest?.('[data-act="fullscreen"]')) return; // the ⛶ button toggles on its own
    goFullscreen();
    if (!touch) evs.forEach(t => document.removeEventListener(t, onGesture, true)); // desktop: only the first time
  };
  evs.forEach(t => document.addEventListener(t, onGesture, true));       // phones: every tap re-enters if you swiped out
  const hint = document.getElementById('fs-hint');
  const iOS = /iPhone|iPod/.test(navigator.userAgent) && !fsSupported;
  const updHint = () => {
    const show = !isFs() && !isInstalled() && (fsSupported || iOS) && (app.state === 'loading' || app.state === 'tap');
    hint.classList.toggle('hidden', !show);
    if (iOS) hint.innerHTML = '📲 iPhone: Share ⬆️ → <b>Add to Home Screen</b> = Full Screen';
  };
  // full screen lost (swipe up / back gesture / app switch): browsers need a new tap to restore it, so pause the race
  // and make the next tap (RESUME, or the big "tap" layer) bring full screen back
  let wantFs = false;
  const ret = document.getElementById('fs-return'); const note = () => document.getElementById('pause-note');
  const showReturn = (on) => ret.classList.toggle('hidden', !on);
  const onFsChange = () => {
    updHint();
    if (isFs()) { wantFs = true; showReturn(false); note()?.classList.add('hidden'); return; }
    if (!wantFs || !touch) return;
    if (app.state === 'race' && !app.mp?.inRoom) { app.pause(); note()?.classList.remove('hidden'); }
    else if (app.state === 'paused') note()?.classList.remove('hidden');
    else showReturn(true);
  };
  document.addEventListener('fullscreenchange', onFsChange); document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !wantFs || !touch || isFs()) return;
    if (app.state === 'paused') note()?.classList.remove('hidden'); else showReturn(true);
  });
  ret.addEventListener('click', () => { goFullscreen(); showReturn(false); });
  app.updFsHint = updHint; updHint();
  // "install app" (Android / desktop Chrome): the installed icon opens directly in full screen
  const ib = document.getElementById('install-btn'); let deferred = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (!isInstalled()) ib.classList.remove('hidden'); });
  addEventListener('appinstalled', () => { ib.classList.add('hidden'); deferred = null; ui.toast('📲 App install ho gaya — ab icon se kholo, seedha full screen!'); });
  ib.addEventListener('click', async (e) => { e.stopPropagation(); if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch { /* */ } deferred = null; ib.classList.add('hidden'); });
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}
app.vibrate = (ms) => { if (S.vibrate && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* */ } };

// ------------------------------------------------------------------ lobby
function enterLobby() {
  app.state = 'lobby'; app.paused = false;
  document.getElementById('fs-hint')?.classList.add('hidden'); document.getElementById('install-btn')?.classList.add('hidden');
  app.lobby?.showSetups();
  ui.show('lobby'); ui.overlay('pause', false);
  app.input.enabled = false;
  MusicPlayer.setScene('menu');
  Audio.setAmbience({ forest: 0, river: 0, town: 0, mountain: 0.25, waterfall: 0, crowd: 0, temple: 0, insects: 0.15 });
  Audio.setRide({ speed: 0, skid: 0, scrape: 0, offroad: 0 });
}

function setCharacter(i, dir = 1, silent = false) {
  app.charIndex = (i + CHARACTERS.length) % CHARACTERS.length;
  const c = CHARACTERS[app.charIndex];
  ui.setCharacter(c);
  app.lobby?.select(app.charIndex, dir);
  S.character = c.id; Settings.save();
  if (!silent && Audio.ready) {
    Samples.play('whoosh', { volume: 0.6 });
    Voice.playIntro(c.id);
    Samples.play('engineRev', { volume: 0.32, offset: 3 + Math.random() * 20, duration: 2.2, fadeOut: 0.8, when: 0.15 });
  }
}
app.selectChar = (d) => setCharacter(app.charIndex + d, d);

// swipe on the lobby to change rider
{
  let sx = null, sy = 0;
  gameEl.addEventListener('pointerdown', (e) => { if (app.state === 'lobby' && !ui.panelOpen && !e.target.closest('button,.card,.char-card,.music-chip')) { sx = e.clientX; sy = e.clientY; } });
  gameEl.addEventListener('pointerup', (e) => {
    if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) app.selectChar(dx < 0 ? 1 : -1);
  });
}

// ------------------------------------------------------------------ settings
function applyVolumes() {
  Audio.setVolumes({ master: S.master, music: S.music, sfx: S.sfx });
  MusicPlayer.setVolume(S.music);
  Voice.setVolume(S.voice ?? 1); Samples.setVolume(S.sfx);
}
app.setSetting = (k, v) => {
  const prev = S[k]; Settings.set(k, v);
  if (['master', 'music', 'sfx', 'voice'].includes(k)) applyVolumes();
  if (['mode', 'difficulty', 'timeOfDay'].includes(k)) ui.setLobbyInfo(S);
  if (k === 'timeOfDay' && app.world) app.world.setTimeOfDay(v);
  if (k === 'aspect') layout();
  if (k === 'camera' && app.race) app.race.rig.setMode(v);
  if (['steering', 'autoGas', 'layout'].includes(k)) { ui.applyControls(S, touch); if (k === 'steering') app.input.enableTilt(v === 'tilt', S.tiltSens).then(ok => { if (v === 'tilt' && !ok) ui.toast('Tilt allow nahi hua — HTTPS link par try karo'); }); }
  if (k === 'tiltSens') app.input.tilt.sens = v;
  if (k === 'quality' && prev !== v) { ui.toast('Quality badli — game reload ho raha hai...'); setTimeout(() => location.reload(), 900); }
};
if (S.steering === 'tilt') app.input.enableTilt(true, S.tiltSens);
MusicPlayer.on((st) => { if (st.index !== S.musicTrack) { S.musicTrack = st.index; Settings.save(); } });

// ------------------------------------------------------------------ input hooks
app.input.bindTouch(document.getElementById('scr-hud'));
app.input.on('pause', () => { if (app.state === 'race') app.pause(); else if (app.state === 'paused') app.resume(); });
app.input.on('camera', () => { if (app.race) { const m = app.race.rig.cycle(); camera.near = m === 'helmet' ? 0.06 : 0.3; camera.updateProjectionMatrix(); ui.toast('Camera: ' + m.toUpperCase()); } });
app.input.on('horn', () => { Samples.play('horn', { volume: 0.9 }); });
app.input.on('reset', () => app.race?.player?.reset());
app.input.on('kickL', () => app.race?.playerKick(-1));
app.input.on('kickR', () => app.race?.playerKick(1));
app.input.on('nitroTap', () => { if (app.race && app.state === 'race' && app.race.state !== 'intro') { if (app.race.player.startNitro()) Samples.play('whoosh', { volume: 0.4 }); else if (app.race.player.nitro < 0.08) ui.toast('Nitro khaali — drift, wheelie ya jump se bharo!'); } });
app.input.on('eat', () => app.race?.maggi?.tryStart());
app.input.on('wheelie', () => { if (app.race && app.state === 'race' && app.race.state !== 'intro') app.race.player.startWheelie(5); });
app.input.on('say', () => { if (app.race && app.state === 'race') app.race.say(app.race.player); });
document.addEventListener('visibilitychange', () => { if (document.hidden && app.state === 'race' && !app.mp?.inRoom) app.pause(); });

// ------------------------------------------------------------------ race flow
let lastRaceOpts = null;
function startRace(opts) {
  if (app.race) { app.race.dispose(); app.race = null; }
  ui.closePanel();
  app.world.setTimeOfDay(opts.timeOfDay || S.timeOfDay);
  app.world.pop?.triggers.forEach(t => t.fired = false);
  app.world.pop?.resetCrossers?.();
  if (app.world.pop) app.world.pop.onCrossing = (c) => { if (app.race && c.toast) ui.toast(c.toast); };
  if (app.world.pop?.special.snake) { const sn = app.world.pop.special.snake; sn.moving = false; sn.d = -(app.world.track.halfWidth(sn.s) + 1.5); }
  return import('./game/race.js').then(({ Race }) => {
    const race = new Race(app, opts);
    app.race = race; race.build();
    app.state = 'race'; app.paused = false;
    camera.near = race.rig.mode === 'helmet' ? 0.06 : 0.3; camera.updateProjectionMatrix();
    ui.show('hud'); ui.overlay('intro', true); ui.resetIntro(!opts.net); ui.resetHud();
    gameEl.classList.add('intro-mode');
    app.input.enabled = false;
    MusicPlayer.setScene('race');
    lastRaceOpts = opts;
    const qp = new URLSearchParams(location.search);
    if (qp.get('auto') === '1') import('./game/ai.js').then(({ AIController }) => { race.autopilot = new AIController(race.player, app.world.track, 1.0, 9); });
  });
}
app.startSingle = () => {
  const c = CHARACTERS[app.charIndex]; const mode = S.mode;
  const entrants = [{ id: 'you', charId: c.id, name: S.playerName || c.name, kind: 'player' }];
  if (mode === 'race') for (const o of CHARACTERS) if (o.id !== c.id) entrants.push({ id: 'cpu-' + o.id, charId: o.id, name: o.name, kind: 'ai' });
  // single player: player in the middle of the grid
  if (entrants.length === 3) entrants.splice(1, 0, entrants.shift());
  const lines = {}; for (const e of entrants) lines[e.charId] = Voice.introLine(e.charId);
  Audio.ui('select');
  startRace({ mode, difficulty: S.difficulty, timeOfDay: S.timeOfDay, entrants, lines });
};
app.onRaceStart = () => { gameEl.classList.remove('intro-mode'); };
app.onRaceResults = (res) => {
  app.state = 'results'; ui.results(res); ui.overlay('results', true);
  MusicPlayer.setScene('results');
  Audio.ui(res.rows.find(r => r.isYou)?.pos === 1 ? 'finish' : 'lose');
};
app.pause = () => {
  if (app.state !== 'race') return;
  app.state = 'paused'; app.paused = true; ui.overlay('pause', true);
  if (!app.mp?.inRoom) { Audio.pauseAll(true); app.busMusic?.pause(true); }
  document.querySelector('[data-act="restart"]').classList.toggle('hidden', !!app.mp?.inRoom);
};
app.resume = () => { if (app.state !== 'paused') return; app.state = 'race'; app.paused = false; ui.overlay('pause', false); ui.closePanel(); Audio.pauseAll(false); app.busMusic?.pause(false); clock.reset(); };
app.restart = () => { ui.overlay('pause', false); Audio.pauseAll(false); if (lastRaceOpts && !app.mp?.inRoom) { const o = { ...lastRaceOpts, goAt: null }; startRace(o); } };
app.quitToLobby = () => {
  ui.overlay('pause', false); ui.overlay('results', false); ui.overlay('intro', false); Audio.pauseAll(false); Voice.stop();
  if (app.mp?.inRoom && app.mp.isHost && app.state !== 'lobby') app.mp.send({ t: 'back-to-lobby' });
  if (app.race) { app.race.dispose(); app.race = null; }
  gameEl.classList.remove('intro-mode');
  enterLobby();
  if (app.mp?.inRoom) setTimeout(() => ui.renderRoom(), 200);
};
app.raceAgain = () => {
  ui.overlay('results', false);
  if (app.mp?.inRoom) { if (app.mp.isHost) app.mpStart(); return; }
  if (lastRaceOpts) { const o = { ...lastRaceOpts, goAt: null }; startRace(o); }
};

// ------------------------------------------------------------------ multiplayer glue
app.mpCreate = async (name) => {
  app.mp = app.mp || new Multiplayer(app);
  try { await app.mp.create(name, CHARACTERS[app.charIndex].id); } catch (e) { ui.mpStatus('Connection fail: ' + e.message); }
};
app.mpJoin = async (code, name) => {
  app.mp = app.mp || new Multiplayer(app);
  try { await app.mp.join(code, name, CHARACTERS[app.charIndex].id); } catch (e) { ui.mpStatus('Connection fail: ' + e.message); }
};
app.mpPick = (c) => { app.mp?.pick(c); const i = CHARACTERS.findIndex(x => x.id === c); if (i >= 0 && i !== app.charIndex) setCharacter(i, 1); };
app.mpCpu = (on) => app.mp?.setCpu(on);
app.mpSize = (n) => app.mp?.setSize(n);
app.shareLink = async (url, code) => {
  const text = `Uttarakhand Riders me race karo! Room code: ${code}`;
  try { if (navigator.share) { await navigator.share({ title: 'Uttarakhand Riders', text, url }); return; } } catch { /* cancelled */ }
  try { await navigator.clipboard.writeText(url); ui.toast('🔗 Link copy ho gaya — doston ko bhejo'); } catch { ui.toast('Room code: ' + code); }
};
app.mpLeave = () => { app.voice?.disable(); app.voice = null; app.mp?.leave(); app.mp = null; };
app.voiceMic = async () => { if (!app.voice) return ui.toast('Voice chat multiplayer room me hi chalta hai'); const on = await app.voice.setMic(!app.voice.micOn); ui.toast(on ? '🎤 Mic ON — ab dost sun sakte hain' : '🎤 Mic OFF'); };
app.voiceSpeaker = () => { if (!app.voice) return; app.voice.setSpeaker(!app.voice.speakerOn); ui.toast(app.voice.speakerOn ? '🔊 Doston ki awaaz ON' : '🔇 Doston ki awaaz OFF'); };
app.drawQR = drawQR;
app.onRoom = async (room) => {
  const mp = app.mp; if (!mp) return;
  if (!app.voice) { app.voice = new VoiceChat(mp, { onState: (v) => ui.voiceHud(v) }); app.voice.setVolume(S.vcVolume ?? 1); }
  if (!app.voice.enabled) app.voice.enable();
  const me = room.players.find(p => p.id === mp.id);
  if (me) { const i = CHARACTERS.findIndex(c => c.id === me.char); if (i >= 0 && i !== app.charIndex) setCharacter(i, 1, true); }
  mp.joinLink = await mp.joinUrl();
  if (app.state === 'lobby') ui.renderRoom();
};
app.onMpError = (msg) => { ui.mpStatus('⚠️ ' + msg); ui.toast(msg); };
app.onMpClosed = (msg) => { ui.toast(msg); app.voice?.disable(); app.voice = null; app.mp = null; if (app.state !== 'lobby') app.quitToLobby(); else ui.closePanel(); };
app.onPeerLeave = (id) => { const r = app.race?.racers.find(x => x.id === id); if (r) { ui.toast(`${r.name} chala gaya`); } };
app.mpStart = () => {
  const mp = app.mp; if (!mp?.isHost) return;
  const lines = {}; for (const c of CHARACTERS) lines[c.id] = Voice.introLine(c.id);
  // intro length = 2.8 + Σ face shots + 1.3 ; GO = now + intro + 3.02 s countdown + 1 s network slack
  const ents = mp.raceSize();
  let intro = 2.8 + 1.3; for (const c of CHARACTERS.slice(0, ents)) intro += Math.max(2.1, Voice.duration(lines[c.id]) + 0.75);
  const goHost = performance.now() + (intro + 3.02 + 1.0) * 1000;
  const msg = mp.startRace({ mode: 'race', difficulty: S.difficulty, timeOfDay: S.timeOfDay, lines, goHost });
  app.onMpRaceStart(msg, true);
};
app.onMpRaceStart = (m, local = false) => {
  const mp = app.mp; if (!mp) return;
  const entrants = m.entrants.map(e => ({ id: e.id, charId: e.charId, name: e.name, kind: e.id === mp.id ? 'player' : e.human ? 'remote' : (mp.isHost ? 'ai' : 'remote') }));
  const goAt = m.goHost - (mp.isHost ? 0 : mp.offset);
  startRace({ mode: 'race', difficulty: m.difficulty, timeOfDay: m.timeOfDay, entrants, lines: m.lines, goAt, net: mp, isHost: mp.isHost });
};
app.onMpBackToLobby = () => { if (app.state !== 'lobby') app.quitToLobby(); };

// ------------------------------------------------------------------ title camera (live 3D Ranikhet behind the logo)
let titleCam = null;
function setupTitleCam() {
  const T = app.world.track; const base = T.point(T.finishS - 160, 0);
  const V = (x, y, z) => new THREE.Vector3(base.x + x, base.y + y, base.z + z);
  titleCam = { t: 0, a: V(55, 34, 40), b: V(-35, 28, 18), look: V(-160, 110, -1200), frozen: true };
  app.titleCam = titleCam;
}
function updateTitle(dt) {
  if (!titleCam || !app.world) return;
  if (!titleCam.frozen) titleCam.t += dt; const k = 0.5 - 0.5 * Math.cos(titleCam.t * 0.06);
  camera.position.lerpVectors(titleCam.a, titleCam.b, k); camera.lookAt(titleCam.look);
  if (camera.fov !== 52) { camera.fov = 52; camera.updateProjectionMatrix(); }
  app.world.update(dt, camera, camera.position, {});
  app.world.render(renderer, camera);
}

// ------------------------------------------------------------------ main loop
const clock = { last: performance.now(), acc: 0, reset() { this.last = performance.now(); } };
const DEV_TS = Math.max(1, Math.min(8, +(new URLSearchParams(location.search).get('ts') || 1)));
let frames = 0, fpsT = performance.now(), fpsVal = 0;
const pace = { lastRaf: performance.now(), acc: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const rafDt = now - pace.lastRaf; pace.lastRaf = now;
  if (drs.rafs.length < 90 && rafDt > 4 && rafDt < 40) { drs.rafs.push(rafDt); if (drs.rafs.length === 90) { const s = [...drs.rafs].sort((a, b) => a - b); drs.refresh = Math.round(1000 / s[45]); } }
  const limit = S.fpsLimit || 0;
  if (limit && limit < drs.refresh - 3) {
    pace.acc += rafDt; const interval = 1000 / limit;
    if (pace.acc < interval - 2) return;
    pace.acc = Math.min(Math.max(0, pace.acc - interval), interval * 0.5);
  }
  const elapsed = now - clock.last;
  clock.last = now;
  drsSample(elapsed);
  const dt = Math.min(0.05, Math.max(0.001, elapsed / 1000));
  frames++; if (now - fpsT > 1000) { fpsVal = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; ui.fps(fpsVal, S.showFps && app.state !== 'loading'); }
  try {
    if (app.state === 'tap') updateTitle(dt);
    else if (app.state === 'loading' && app.world && (frames % 4) === 0) updateTitle(dt); // hidden warm-up behind the title picture
    else if (app.state === 'lobby') { app.lobby?.update(dt); app.lobby?.render(); }
    else if ((app.state === 'race' || app.state === 'results' || app.state === 'paused') && app.race && app.world) {
      if (app.state !== 'paused' || app.mp?.inRoom) { const ts = DEV_TS; for (let i = 0; i < ts; i++) app.race.update(dt); }
      const P = app.race.player;
      app.world.update(app.state === 'paused' ? 0 : dt * (app.race.timeScale || 1), camera, P ? P.root.position : camera.position, { raceTime: app.race.raceTime, playerS: P?.s, audio: Audio });
      app.world.render(renderer, camera);
    }
  } catch (e) { console.error(e); }
}
requestAnimationFrame(frame);
boot().catch(e => { console.error(e); ui.loading(1, '⚠️ Error: ' + e.message); });

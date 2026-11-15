// UTTARAKHAND RIDERS — app entry: loading → tap (fullscreen) → lobby → race → results. Multiplayer via net.js.
import * as THREE from 'three';
import { Settings, QUALITY, CHARACTERS, charById, MODES } from './config.js';
import { loadingManager, isTouch, isMobile } from './core/util.js';
import { UI } from './ui/ui.js';
import { Input } from './game/input.js';
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
const quality = QUALITY[S.quality] || QUALITY.medium;
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
const touch = isTouch();

function layout() {
  const W = innerWidth, H = innerHeight;
  let w = W, h = H;
  if (S.aspect !== 'fill') { if (W / H > 16 / 9) { h = H; w = Math.round(H * 16 / 9); } else { w = W; h = Math.round(W * 9 / 16); } }
  gameEl.style.width = w + 'px'; gameEl.style.height = h + 'px';
  gameEl.style.fontSize = (Math.min(w, h * 16 / 9) / 100) + 'px';
  const dpr = Math.min(devicePixelRatio || 1, quality.maxDpr) * quality.pixelRatio;
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
  ui.showTap(onTap);
}

if (new URLSearchParams(location.search).get('titleshot') === '1') document.body.classList.add('titleshot');

async function onTap() {
  // must run inside the user gesture
  goFullscreen();
  await Audio.unlock();
  applyVolumes();
  Voice.init(Audio.context, Audio.voiceOut);
  Samples.init(Audio.context, Audio.voiceOut);
  Voice.onDuck = (on) => { Audio.duckMusic(on); MusicPlayer.setDuck(on); };
  MusicPlayer.attach();
  MusicPlayer.setVolume(S.music);
  MusicPlayer.setScene('menu');
  MusicPlayer.select(Math.min(S.musicTrack ?? 2, MusicPlayer.tracks.length - 1), false); // user starts music himself
  MusicPlayer.emit();
  enterLobby();
  const room = new URLSearchParams(location.search).get('room');
  setTimeout(() => ui.tutorial(false, () => { if (room) ui.openMultiplayer(); }), 500);
  setTimeout(() => Voice.playIntro(CHARACTERS[app.charIndex].id), 900);
}

function goFullscreen() {
  const el = document.documentElement;
  try {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) { const r = req.call(el, { navigationUI: 'hide' }); if (r && r.then) r.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}); }
  } catch { /* iOS Safari: not supported */ }
}
app.toggleFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else goFullscreen(); };
app.vibrate = (ms) => { if (S.vibrate && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* */ } };

// ------------------------------------------------------------------ lobby
function enterLobby() {
  app.state = 'lobby'; app.paused = false;
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
app.onRaceStart = () => { gameEl.classList.remove('intro-mode'); ui.toast('🏁 GO GO GO! Ranikhet tak race!'); };
app.onRaceResults = (res) => {
  app.state = 'results'; ui.results(res); ui.overlay('results', true);
  MusicPlayer.setScene('results');
  Audio.ui(res.rows.find(r => r.isYou)?.pos === 1 ? 'finish' : 'lose');
};
app.pause = () => {
  if (app.state !== 'race') return;
  app.state = 'paused'; app.paused = true; ui.overlay('pause', true);
  if (!app.mp?.inRoom) Audio.pauseAll(true);
  document.querySelector('[data-act="restart"]').classList.toggle('hidden', !!app.mp?.inRoom);
};
app.resume = () => { if (app.state !== 'paused') return; app.state = 'race'; app.paused = false; ui.overlay('pause', false); ui.closePanel(); Audio.pauseAll(false); clock.reset(); };
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
  const ents = mp.room.players.length + (mp.room.cpuFill ? CHARACTERS.length - mp.room.players.length : 0);
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
function frame(now) {
  requestAnimationFrame(frame);
  const limit = S.fpsLimit || 0;
  const elapsed = now - clock.last;
  if (limit && elapsed < 1000 / limit - 1.5) return;
  clock.last = now;
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

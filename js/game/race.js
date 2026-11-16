// Race manager: grid, intro ("MAIN HOON …" close-ups with the real voice lines), synced countdown, racing with
// free-roam physics, kicks & dialogues (Road Rash style), drift/wheelie/nitro, off-track auto-teleport, finish & results.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { Racer } from './racer.js';
import { AIController } from './ai.js';
import { CameraRig } from './camera.js';
import { Voice } from '../audio/voice.js';
import { Samples, COUNTDOWN_TIMES } from '../audio/samples.js';
import { BusMusic } from '../audio/busmusic.js';
import { MaggiBreak } from './maggi.js';
import { charById, BIKES, DIFFICULTIES, Records } from '../config.js';

const GRID = [{ ds: -4, d: -2.3 }, { ds: -7, d: 0.3 }, { ds: -10, d: 2.7 }];
const COUNT_LEN = 3.02;
const OFF_TRACK_LIMIT = 5;

export class Race {
  constructor(app, opts) {
    this.app = app; this.opts = opts; this.world = app.world; this.T = app.world.track;
    this.mode = opts.mode; this.net = opts.net || null; this.isHost = opts.isHost ?? true;
    this.state = 'intro'; this.raceTime = 0; this.t = 0; this.results = null;
    this.racers = []; this.ai = new Map(); this.player = null;
    this.rig = new CameraRig(app.camera, app.world);
    this.rig.setMode(app.settings.camera || 'chase');
    this.zoneId = null; this.netT = 0; this.finishShown = false; this.endTimer = 0;
    this.diff = DIFFICULTIES.find(d => d.id === opts.difficulty) || DIFFICULTIES[1];
    this.skill = this.diff.skill;
    this.lines = opts.lines || {};
    this.offT = 0; this.voiceCD = 0; this.v = new THREE.Vector3();
    this.timeScale = 1; this.td = null;
  }

  // ---------------------------------------------------------------- setup
  build() {
    const { app } = this; const scene = this.world.scene;
    const start = this.T.marks.start;
    const models = { createBike: app.models.bikes?.createBike, createRider: app.models.riders?.createRider };
    const env = { solids: this.world.solids, barrier: this.world.pop?.barrier, fx: this.world.fx };
    this.opts.entrants.forEach((e, i) => {
      const r = new Racer({ id: e.id, charId: e.charId, bikeId: charById(e.charId).bike, name: e.name || charById(e.charId).name, kind: e.kind, track: this.T, world: this.world, models, audio: app.audio });
      r.env = env;
      const g = GRID[i % GRID.length];
      r.placeAt(start + g.ds - Math.floor(i / 3) * 8, g.d);
      r.attach(scene);
      r.rider?.setHelmet?.(false);
      r.startEngine();
      this.racers.push(r);
      if (e.kind === 'player') this.player = r;
      if (e.kind === 'ai') { const ai = new AIController(r, this.T, this.skill, i + 3); ai.kickCD = 3 + i; ai.rubber = this.diff.rubber; this.ai.set(r.id, ai); }
    });
    if (!this.player) this.player = this.racers[0];
    if (this.net) for (const r of this.racers) r.netDelay = this.net.transport === 'relay' ? 240 : 120;
    // Pahadi songs from the buses (moving traffic + the ones parked at Ramnagar bus stand)
    this.busMusic = app.busMusic || (app.busMusic = new BusMusic());
    const pop = this.world.pop;
    this.busMusic.setBuses([...(pop?.traffic || []).filter(t => t.kind === 'bus').map(t => ({ pos: t.g.position })), ...(pop?.special?.parkedBuses || []).map(g => ({ pos: g.position }))]);
    this.busMusic.volume = 0.9 * (app.settings.sfx ?? 0.9);
    this.racers.forEach(r => r.syncVisual(0, 0));
    this.maggi = new MaggiBreak(this);
    this.buildIntro();
  }

  dispose() {
    for (const r of this.racers) r.detach();
    this.racers = [];
    Samples.setLoop('forest', 0); Samples.setLoop('wind', 0);
    this.busMusic?.stopAll();
    this.maggi?.dispose();
    this.app.audio?.setRide?.({ speed: 0, skid: 0, scrape: 0, offroad: 0 });
    this.app.ui.offTrack(null);
  }

  // ---------------------------------------------------------------- intro timeline
  buildIntro() {
    const segs = []; let t = 0;
    const T = this.T, start = T.marks.start;
    const gate = T.point(start + 3, 0, new THREE.Vector3());
    const f = T.forward(start, new THREE.Vector3()), rgt = T.right(start, new THREE.Vector3());
    segs.push({ t, dur: 2.6, run: () => {
      this.rig.play({ duration: 2.6, from: gate.clone().addScaledVector(f, 26).addScaledVector(rgt, -9).add(new THREE.Vector3(0, 14, 0)), to: gate.clone().addScaledVector(f, 9).addScaledVector(rgt, -4).add(new THREE.Vector3(0, 3.2, 0)),
        lookFrom: gate.clone().addScaledVector(f, -8), lookTo: gate.clone().addScaledVector(f, -9).add(new THREE.Vector3(0, 0.8, 0)), fovFrom: 55, fovTo: 48 });
      Samples.play('engineRev', { volume: 0.5, offset: 1.5, duration: 3.5, fadeOut: 1 });
    } });
    t += 2.6;
    for (const r of this.racers) {
      const line = this.lines[r.charId] || null;
      const dur = Math.max(2.1, (line ? Voice.duration(line) : 1.4) + 0.75);
      segs.push({ t, dur, run: () => this.faceShot(r, dur, line) });
      t += dur;
    }
    segs.push({ t, dur: 1.3, run: () => {
      for (const r of this.racers) { r.rider?.setHelmet?.(true); r.rider?.setLookTarget?.(null); }
      this.app.ui.introBanner(null);
      Samples.play('whoosh', { volume: 0.8 });
      const p = this.player; const pf = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const base = new THREE.Vector3(p.x, p.y, p.z);
      this.rig.play({ duration: 1.3, from: base.clone().addScaledVector(pf, 3.2).add(new THREE.Vector3(1.6, 1.4, 0)), to: base.clone().addScaledVector(pf, -4.6).add(new THREE.Vector3(0, 1.75, 0)),
        lookFrom: base.clone().add(new THREE.Vector3(0, 1.0, 0)), lookTo: base.clone().addScaledVector(pf, 3).add(new THREE.Vector3(0, 1.0, 0)), fovFrom: 50, fovTo: 64 });
    } });
    t += 1.3;
    this.introLen = t; this.segs = segs;
    const now = performance.now();
    this.goAt = this.opts.goAt || (now + (this.introLen + COUNT_LEN + 0.25) * 1000);
    this.countAt = this.goAt - COUNT_LEN * 1000;
    this.introAt = this.countAt - this.introLen * 1000;
    this.countFired = false; this.countShown = -1;
  }

  faceShot(r, dur, line) {
    const c = charById(r.charId);
    const head = new THREE.Vector3();
    r.root.updateMatrixWorld(true);
    if (r.rider?.headAnchor) r.rider.headAnchor.getWorldPosition(head); else head.set(r.x, r.y + 1.45, r.z);
    const f = new THREE.Vector3(Math.sin(r.yaw), 0, Math.cos(r.yaw)); const right = new THREE.Vector3(-f.z, 0, f.x);
    const side = r.d < 0 ? -1 : 1;
    const from = head.clone().addScaledVector(f, 1.35).addScaledVector(right, 0.55 * side).add(new THREE.Vector3(0, -0.02, 0));
    const to = head.clone().addScaledVector(f, 0.62).addScaledVector(right, 0.2 * side).add(new THREE.Vector3(0, -0.03, 0));
    this.rig.play({ duration: dur, from, to, lookFrom: head.clone().add(new THREE.Vector3(0, -0.1, 0)), lookTo: head.clone().add(new THREE.Vector3(0, -0.05, 0)), fovFrom: 30, fovTo: 25 });
    this.app.ui.introBanner({ name: c.name, color: c.accent, isYou: r === this.player });
    for (const o of this.racers) o.rider?.setLookTarget?.(o === r ? this.app.camera.position : null);
    if (line) { Voice.play(line, { volume: 1 }); try { r.rider?.say?.(Math.max(1, Voice.duration(line))); } catch { /* */ } }
    r.revT = 0.4;
  }

  skipIntro() {
    if (this.state !== 'intro' || this.net) return;
    const now = performance.now();
    Voice.stop();
    for (const r of this.racers) r.rider?.setHelmet?.(true);
    this.app.ui.introBanner(null);
    this.rig.shot = null; this.rig.initialized = false;
    this.goAt = now + (COUNT_LEN + 0.2) * 1000; this.countAt = this.goAt - COUNT_LEN * 1000; this.introAt = this.countAt - this.introLen * 1000;
    this.segs.forEach(s => s.done = true);
  }

  // ---------------------------------------------------------------- kicks & dialogues
  playerKick(side) { if (this.state === 'racing') this.doKick(this.player, side); }
  doKick(r, side) {
    if (!r.tryKick(side)) return;
    this.app.audio?.sfx?.('whoosh', { pos: r.root.position, volume: 0.5 });
    let target = null, best = 9;
    for (const o of this.racers) {
      if (o === r || o.crashed > 0) continue;
      const ds = o.s - r.s, lat = (o.d - r.d) * side;
      if (Math.abs(ds) < 1.9 && lat > 0.25 && lat < 2.1 && Math.abs(ds) + lat < best) { best = Math.abs(ds) + lat; target = o; }
    }
    if (!target) return;
    const strength = clamp(0.7 + (r.v - target.v) * 0.05, 0.5, 1.4);
    this.app.audio?.sfx?.('bump', { pos: target.root.position, volume: 1 });
    if (r === this.player || target === this.player) { this.rig.bump(0.5); this.app.vibrate?.(60); }
    if (target.kind === 'remote') this.net?.send({ t: 'kick', target: target.id, by: r.id, side, strength });
    else {
      const fell = target.onKicked(side, strength * (target === this.player ? 0.6 : r === this.player ? 1.3 : 1));
      if (fell) this.takedown(r, target);
      else if (target === this.player) this.app.ui.toast(`🦵 ${r.name} ne laat maari!`);
    }

  }
  /** Asphalt-style takedown: kicker's dialogue + banner; slow-motion orbit cam around the falling rider (single player) */
  takedown(kicker, victim) {
    const P = this.player, ui = this.app.ui;
    const involved = kicker === P || victim === P;
    const near = involved || kicker.root.position.distanceTo(P.root.position) < 60;
    if (kicker.kind !== 'remote') kicker.nitro = Math.min(1, kicker.nitro + 0.35);
    if (near) {
      const line = Voice.pick(kicker.charId);
      if (line) { this.voiceCD = 3; Voice.play(line, { volume: involved ? 1 : 0.75 }); try { kicker.rider?.say?.(Math.max(1, Voice.duration(line))); } catch { /* */ } }
    }
    if (kicker === P) ui.takedown('TAKEDOWN!', `${victim.name} ko gira diya 💥  +NITRO`, 'win');
    else if (victim === P) ui.takedown('LAAT PADI!', `${kicker.name} ne gira diya 😵`, 'lose');
    else if (near) ui.toast(`🦵 ${kicker.name} ne ${victim.name} ko gira diya!`);
    if (!involved) return;
    this.app.vibrate?.(140);
    if (this.net || this.td) { this.rig.bump(0.8); return; } // no slow-mo in multiplayer
    Samples.play('sting', { volume: 0.6 });
    const target = () => (victim.rag ? victim.rag.p : victim.root.position);
    const yaw = victim.vyaw ?? victim.yaw;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); const right = new THREE.Vector3(-f.z, 0, f.x);
    const side = Math.sign(victim.d - kicker.d) || 1;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), L = new THREE.Vector3();
    const from = () => { A.copy(target()).addScaledVector(f, 3.6).addScaledVector(right, 2.4 * side); A.y += 0.9; return A; };
    const to = () => { B.copy(target()).addScaledVector(f, -1.4).addScaledVector(right, 3.2 * side); B.y += 1.8; return B; };
    const look = () => { L.copy(target()); L.y += 0.25; return L; };
    this.td = { t: 0, dur: 2.5, pilot: kicker === P ? new AIController(P, this.T, 1.0, 11) : null };
    ui.cinematic(true);
    this.rig.play({ duration: 2.5, from, to, lookFrom: look, lookTo: look, fovFrom: 40, fovTo: 52, onDone: () => { this.td = null; this.timeScale = 1; ui.cinematic(false); } });
  }
  updateTakedown(realDt) {
    if (!this.td) { this.timeScale = 1; return; }
    this.td.t += realDt; const t = this.td.t, d = this.td.dur;
    this.timeScale = t < d - 0.8 ? 0.27 : lerp(0.27, 1, smoothstep(d - 0.8, d, t));
    if (t > d + 0.6) { this.td = null; this.timeScale = 1; this.app.ui.cinematic(false); }
  }

  say(r, fromKick = false) {
    if (this.voiceCD > 0 && !fromKick) return;
    const line = Voice.pick(r.charId); if (!line) return;
    this.voiceCD = 2.5;
    const near = r === this.player ? 1 : clamp(1.2 - r.root.position.distanceTo(this.player.root.position) / 45, 0.25, 1);
    Voice.play(line, { volume: near }); try { r.rider?.say?.(); } catch { /* */ }
    if (r === this.player && this.net) this.net.send({ t: 'say', id: r.id, line });
  }

  // ---------------------------------------------------------------- main update
  update(dt) {
    const realDt = dt;
    if (this.state !== 'intro') { this.updateTakedown(realDt); dt *= this.timeScale; }
    const now = performance.now(); this.t += dt; this.voiceCD -= realDt;
    const app = this.app, ui = app.ui;
    if (this.state === 'intro') { this.updateIntro(dt, now); return; }

    if (this.state === 'racing' || this.state === 'finished') this.raceTime += dt;
    const P = this.player; const inp = app.input; inp.update(realDt);
    let pin = { throttle: inp.throttle, brake: inp.brake, steer: inp.steer, wheelie: inp.wheelie, nitro: inp.nitro };
    if (app.settings.autoGas && pin.brake < 0.1) pin.throttle = Math.max(pin.throttle, 1);
    if (this.autopilot && !P.finished) pin = this.autopilot.update(dt, { racers: this.racers, obstacles: this.world.obstacles, playerS: null });
    if (this.td?.pilot && !P.finished && P.crashed <= 0) pin = this.td.pilot.update(dt, { racers: this.racers, obstacles: this.world.obstacles, playerS: null });
    if (P.finished && this.mode !== 'free') pin = { throttle: 0, brake: 0.6, steer: P.d > 0.5 ? -0.25 : P.d < -0.5 ? 0.25 : 0 };
    const racers = this.racers; const obstacles = this.world.obstacles;
    const aiIn = new Map();
    for (const [id, ai] of this.ai) {
      const r = racers.find(x => x.id === id); if (!r) continue;
      const ain = r.finished ? { throttle: 0, brake: 0.6, steer: 0 } : ai.update(dt, { racers, obstacles, playerS: P.s });
      r.nitro = Math.min(1, r.nitro + dt * 0.035 * this.diff.nitro);
      const straight = Math.abs(this.T.curvature(r.s + 60)) < 0.004 && Math.abs(this.T.curvature(r.s + 140)) < 0.004;
      ain.nitro = straight && r.nitro > (this.diff.id === 'hard' ? 0.3 : 0.5) && !r.finished && r.v > 25;
      aiIn.set(id, ain);
      ai.kickCD = (ai.kickCD ?? 3) - dt;
      if (ai.kickCD <= 0 && this.state === 'racing' && !r.finished) {
        for (const o of racers) {
          if (o === r || o.crashed > 0) continue;
          const ds = o.s - r.s, lat = o.d - r.d;
          if (Math.abs(ds) < 1.6 && Math.abs(lat) > 0.4 && Math.abs(lat) < 1.9) {
            if (Math.random() < this.diff.kick * (o === P ? 1.2 : 0.8)) this.doKick(r, Math.sign(lat));
            ai.kickCD = (this.diff.id === 'hard' ? 1.8 : 3) + Math.random() * 3; break;
          }
        }
      }
    }
    const sub = dt > 1 / 45 ? 3 : 2; const h = dt / sub;
    for (let k = 0; k < sub; k++) {
      for (const r of racers) { if (r.kind === 'remote' || r.inMaggi) continue; r.step(h, r === P ? pin : aiIn.get(r.id) || { throttle: 0, brake: 1, steer: 0 }); }
      this.collideRacers(); this.collideObstacles();
    }
    for (const r of racers) if (r.kind === 'remote') r.applyRemote(now);
    this.handleEvents();
    // wrong way / stuck / off-track teleport (5 s)
    if (P.wrongWay > 1.2 && !P.finished) ui.warn('WRONG WAY! ⤺'); else ui.warn(null);
    if (P.stuck > 4) { P.reset(); P.stuck = 0; }
    const off = P.crashed <= 0 && !P.finished && !P.inMaggi && Math.abs(P.d) > this.T.halfWidth(P.s) + 5;
    if (off) {
      this.offT += dt; ui.offTrack(Math.max(0, Math.ceil(OFF_TRACK_LIMIT - this.offT)));
      if (this.offT >= OFF_TRACK_LIMIT) { this.offT = 0; P.reset(); ui.offTrack(null); ui.toast('🔁 Wapas track par!'); Samples.play('whoosh', { volume: 0.7 }); }
    } else if (this.offT > 0) { this.offT = 0; ui.offTrack(null); }
    for (const r of racers) if (r !== P && r.kind === 'ai') { r._off = (r.crashed <= 0 && Math.abs(r.d) > this.T.halfWidth(r.s) + 5) ? (r._off || 0) + dt : 0; if (r._off > OFF_TRACK_LIMIT) { r._off = 0; r.reset(); } }
    // finish line
    const fin = this.T.finishS;
    for (const r of racers) {
      if (!r.finished && r.kind !== 'remote' && r.s >= fin && this.mode !== 'free' && Math.abs(r.d) < this.T.halfWidth(r.s) + 8) {
        r.finished = true; r.finishTime = this.raceTime;
        if (this.net) this.net.send({ t: 'fin', id: r.id, time: r.finishTime });
        if (r === P) this.onPlayerFinish();
      }
    }
    if (this.mode === 'free' && P.s >= fin && !this.finishShown) { this.finishShown = true; ui.toast('🏔️ RANIKHET pahunch gaye! Free ride jaari rakho ya Pause → Lobby'); app.audio?.sfx('cheer', { volume: 0.8 }); }
    for (const tr of this.world.triggers) if (!tr.fired && P.s >= tr.s && P.s < tr.s + 120) { tr.fired = true; try { tr.fn(app.audio, { toast: (m) => ui.toast(m) }); } catch (e) { console.warn(e); } }
    const zone = this.T.zoneAt(P.s);
    if (zone.id !== this.zoneId) { this.zoneId = zone.id; ui.zoneBanner(zone.title, zone.sub); }
    if (this.state === 'finished') {
      this.endTimer += dt;
      if ((racers.every(r => r.finished) && this.endTimer > 3) || this.endTimer > (this.net ? 30 : 14)) this.showResults();
    }
    if (this.net) {
      this.netT -= dt;
      if (this.netT <= 0) {
        this.netT = this.net.transport === 'relay' ? 1 / 12 : 1 / 15;
        this.net.send({ t: 'st', id: P.id, ...P.snapshot() });
        if (this.isHost) for (const r of racers) if (r.kind === 'ai') this.net.send({ t: 'st', id: r.id, ...r.snapshot() });
      }
    }
    if (this.state === 'racing') this.maggi?.update(realDt);
    { const dT = P.drunkT || 0; ui.drunk?.(dT > 0 ? Math.ceil(dT) : 0, P.drunkK || 0); if (this._wasDrunk && dT <= 0) ui.toast('😮‍💨 Nasha utar gaya — ab theek se chalao!'); this._wasDrunk = dT > 0; }
    for (const r of racers) r.syncVisual(dt, this.t);
    this.rig.update(realDt, P.crashed > 0 && P.rag ? { ...P, x: P.rag.p.x, y: P.rag.p.y - 0.4, z: P.rag.p.z, lean: 0, v: 6, offroad: 0, crashed: 1, wheelieA: 0 } : P);
    if (P.boosting && !this.td) this.rig.applyFov(this.app.camera.fov + 10, realDt * 3);
    this.postUpdate(dt, now);
    ui.hud(this.hudState());
  }

  updateIntro(dt, now) {
    const ui = this.app.ui;
    const tRel = (now - this.introAt) / 1000;
    for (const s of this.segs) if (!s.done && tRel >= s.t) { s.done = true; if (tRel < s.t + s.dur) s.run(); }
    if (now >= this.countAt && !this.countFired) {
      this.countFired = true;
      for (const r of this.racers) r.rider?.setHelmet?.(true);
      ui.introBanner(null);
      const late = (now - this.countAt) / 1000;
      if (late < 0.5) Samples.play('countdown', { volume: 1, offset: Math.max(0, late) });
      this.rig.shot = null; this.rig.initialized = false;
    }
    if (this.countFired) {
      const tc = (now - this.countAt) / 1000;
      let shown = -1; for (let i = 0; i < 4; i++) if (tc >= COUNTDOWN_TIMES[i]) shown = i;
      if (shown !== this.countShown) { this.countShown = shown; ui.countdown(shown < 3 ? String(3 - shown) : 'GO!'); }
    }
    for (const r of this.racers) {
      if (r.kind === 'remote') r.applyRemote(now);
      r.revT = (r.revT || 0) - dt;
      const rev = this.countFired ? (Math.sin(now / 160 + r.charId.length) > 0.55 ? 0.9 : 0.15) : (r.revT > 0 && r.revT < 0.3 ? 1 : 0);
      r.throttle = rev; r.rpm = lerp(r.rpm, r.spec.idle + rev * 7000, 1 - Math.exp(-dt * 8));
      r.syncVisual(dt, this.t); r.updateAudio(dt);
    }
    this.rig.update(dt, this.player);
    if (now >= this.goAt) {
      this.state = 'racing'; this.raceTime = (now - this.goAt) / 1000; this.app.input.enabled = true; ui.countdown('GO!', true); this.app.onRaceStart?.();
      for (const r of this.racers) if (r.kind !== 'remote') { r.v = Math.max(r.v, 2.5); r.wheelieT = 2; } // launch wheelie off the line
    }
    this.postUpdate(dt, now);
  }

  handleEvents() {
    const P = this.player, app = this.app, ui = app.ui;
    for (const r of this.racers) {
      const me = r === P;
      for (const e of r.events) {
        switch (e) {
          case 'crash': app.audio?.sfx('crash', { pos: r.root.position, volume: me ? 1.1 : 0.7 }); if (me) { Samples.play('sting', { volume: 0.5 }); this.rig.bump(1); ui.toast(r.crashReason === 'tree' ? '🌳 Ped se takra gaye!' : r.crashReason === 'landing' ? '💥 Hard landing!' : r.crashReason === 'kick' ? '🦵 Laat se gir gaye!' : r.crashReason === 'building' ? '🧱 Deewar se takra gaye!' : r.crashReason === 'elephant' ? '🐘 Haathi se takra gaye!' : r.crashReason === 'tiger' ? '🐅 Sher se takra gaye!' : r.crashReason === 'cow' ? '🐄 Gaay se takra gaye!' : '💥 CRASH! Sambhal ke...'); app.vibrate?.(200); } break;
          case 'splash': app.audio?.sfx('splash', { pos: r.root.position, volume: 1.2 }); if (me) { ui.toast('💦 Kosi nadi me gir gaye!'); this.rig.bump(0.6); app.vibrate?.(150); } break;
          case 'bump': case 'thud': app.audio?.sfx('bump', { pos: r.root.position, volume: me ? (e === 'thud' ? 0.6 : 0.9) : 0.4 }); if (me && e === 'bump') { this.rig.bump(0.45); app.vibrate?.(35); } break;
          case 'kicked': if (me) this.rig.bump(0.7); break;
          case 'landHard': app.audio?.sfx('bump', { pos: r.root.position, volume: me ? 1 : 0.5 }); if (me) { this.rig.bump(0.6); app.vibrate?.(60); } break;
          case 'bigAir': if (me) ui.trick(`✈️ AIR ${r.airT.toFixed(1)}s`); break;
          case 'driftStart': if (me) ui.trick('DRIFT!'); break;
          case 'driftEnd': if (me && r.driftScore > 60) ui.trick(`DRIFT +${Math.round(r.driftScore)}`); break;
          case 'wheelie': if (me) ui.trick(this.state === 'racing' && this.raceTime < 1 ? 'LAUNCH WHEELIE!' : 'WHEELIE!'); break;
          case 'nitro': app.audio?.sfx('whoosh', { pos: r.root.position, volume: me ? 1 : 0.5 }); if (me) { ui.trick('🔥 NITRO!'); app.vibrate?.(40); } break;
          case 'respawn': if (me) ui.toast('Wapas sadak par!'); break;
        }
      }
      r.events.length = 0;
      const fx = this.world.fx;
      if (fx && r.boosting && r.kind !== 'remote' && Math.random() < 0.6) fx.burst('spark', r.root.position.clone().add(new THREE.Vector3(-Math.sin(r.yaw) * 1.0, 0.55, -Math.cos(r.yaw) * 1.0)), 1, new THREE.Vector3(-Math.sin(r.yaw) * 6, 0.5, -Math.cos(r.yaw) * 6), 0.6);
      if (fx && r.drift && Math.random() < 0.7) fx.burst('smoke', r.root.position.clone().add(new THREE.Vector3(-Math.sin(r.yaw) * 0.8, 0.15, -Math.cos(r.yaw) * 0.8)), 1, null, 1);
    }
  }

  postUpdate(dt, now) {
    const app = this.app, P = this.player; const cam = app.camera;
    const fwd = this.v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    app.audio?.setListener?.(cam.position, fwd);
    for (const r of this.racers) r.updateAudio(dt);
    if (this.state !== 'intro') app.audio?.setRide?.({ speed: P.v, skid: P.skid, scrape: P.scrape, offroad: P.offroad * smoothstep(3, 15, P.v) });
    this.busMusic?.update(dt, cam.position);
    const amb = this.world.ambience(P.s, P.root.position);
    app.audio?.setAmbience?.(amb);
    Samples.setLoop('forest', clamp(amb.forest * 0.75 + amb.river * 0.25, 0, 1) * 0.9);
    Samples.setLoop('wind', clamp((amb.mountain || 0) * 0.35, 0, 0.4));
  }

  // ---------------------------------------------------------------- collisions
  collideRacers() {
    const rs = this.racers;
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.crashed > 0 || b.crashed > 0 || a.ghost > 0 || b.ghost > 0 || a.air || b.air || a.inMaggi || b.inMaggi) continue;
      const ds = a.s - b.s, dd = a.d - b.d;
      if (Math.abs(ds) > 1.9 || Math.abs(dd) > 0.75) continue;
      const push = (0.76 - Math.abs(dd)) * 0.5 * (Math.sign(dd) || 1);
      const moveA = a.kind !== 'remote', moveB = b.kind !== 'remote';
      const T = this.T;
      const shift = (r, amt) => { const hh = T.heading(r.s); r.x += Math.cos(hh) * amt; r.z += -Math.sin(hh) * amt; r.d += amt; };
      if (moveA) shift(a, push * (moveB ? 1 : 2));
      if (moveB) shift(b, -push * (moveA ? 1 : 2));
      const back = ds < 0 ? a : b;
      if (back.kind !== 'remote' && Math.abs(ds) > 0.6) back.v *= 0.985;
      if (moveA) a.lean += (Math.random() - 0.5) * 0.05; if (moveB) b.lean += (Math.random() - 0.5) * 0.05;
      if ((Math.abs(a.v - b.v) > 2 || Math.abs(dd) < 0.5) && (a === this.player || b === this.player)) this.player.events.push('bump');
    }
  }
  collideObstacles() {
    const obs = this.world.obstacles;
    for (const r of this.racers) {
      if (r.kind === 'remote' || r.crashed > 0 || r.ghost > 0 || r.inMaggi) continue;
      for (const o of obs) {
        if (Math.abs(o.s - r.s) > o.hl + 1.0 || Math.abs(o.d - r.d) > o.hw + 0.42) continue;
        if (r.air && r.y > this.T.surfaceY(o.s, o.d) + 2.2) continue;
        if (r.v > 13.5) { r.crash(o.kind === 'traffic' ? 'vehicle' : o.kind); if (o.kind === 'cow') this.app.audio?.sfx('cowMoo', { pos: r.root.position }); if (o.kind === 'elephant') this.app.audio?.sfx('elephant', { pos: r.root.position, volume: 1.4 }); if (o.kind === 'tiger') this.app.audio?.sfx('tigerRoar', { pos: r.root.position, volume: 1.4 }); if (o.kind === 'traffic') this.app.audio?.sfx('busHorn', { pos: r.root.position }); }
        else {
          const side = Math.sign(r.d - o.d) || 1; const amt = (o.hw + 0.45) - Math.abs(r.d - o.d);
          const hh = this.T.heading(r.s); r.x += Math.cos(hh) * amt * side; r.z += -Math.sin(hh) * amt * side; r.d += amt * side;
          r.v *= 0.55; r.events.push('bump');
        }
      }
    }
  }

  // ---------------------------------------------------------------- finish / results
  onPlayerFinish() {
    const P = this.player; const ui = this.app.ui;
    this.state = 'finished'; this.endTimer = 0;
    const pos = this.standings().indexOf(P) + 1;
    ui.finishBanner(this.mode === 'time' ? 'FINISH!' : pos === 1 ? '🏆 1st! JEET GAYE!' : `FINISH • ${pos}${['st', 'nd', 'rd'][pos - 1] || 'th'}`, fmtTime(P.finishTime));
    this.app.audio?.sfx('cheer', { volume: 1 }); this.app.audio?.ui('finish');
    if (pos === 1) setTimeout(() => Voice.playIntro(P.charId), 900);
    this.app.input.enabled = false;
  }
  standings() {
    return [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1; if (b.finished) return 1;
      return b.s - a.s;
    });
  }
  showResults() {
    if (this.results) return;
    const st = this.standings(); const fin = this.T.finishS;
    const rows = st.map((r, i) => ({ id: r.id, name: r.name, charId: r.charId, bike: BIKES[r.bikeId].name, isYou: r === this.player, kind: r.kind,
      time: r.finished ? r.finishTime : this.raceTime + Math.max(0, fin - r.s) / Math.max(15, r.v), est: !r.finished, pos: i + 1 }));
    const P = this.player; let record = false;
    if (P.finished && this.mode !== 'free') record = Records.set(P.charId, this.mode, P.finishTime);
    this.results = { rows, record, best: Records.get(P.charId, this.mode), mode: this.mode };
    this.state = 'results';
    this.app.ui.offTrack(null);
    this.app.onRaceResults?.(this.results);
  }

  onNet(msg) {
    const r = this.racers.find(x => x.id === (msg.t === 'kick' ? msg.target : msg.id));
    if (msg.t === 'st' && r && r.kind === 'remote') r.pushSnapshot(msg, performance.now());
    else if (msg.t === 'fin' && r && !r.finished) { r.finished = true; r.finishTime = msg.time; }
    else if (msg.t === 'kick' && r && r.kind !== 'remote') {
      const kicker = this.racers.find(x => x.id === msg.by);
      const fell = r.onKicked(msg.side, (msg.strength || 1) * (r === this.player ? 0.6 : 1));
      if (fell) { if (kicker) this.takedown(kicker, r); this.net?.send({ t: 'td', by: msg.by, victim: r.id }); }
      else if (r === this.player) this.app.ui.toast(`🦵 ${kicker?.name || 'Kisi'} ne laat maari!`);
    }
    else if (msg.t === 'td') {
      const k = this.racers.find(x => x.id === msg.by), v = this.racers.find(x => x.id === msg.victim);
      if (k && v && v !== this.player) this.takedown(k, v);
    }
    else if (msg.t === 'say') { const who = this.racers.find(x => x.id === msg.id); if (who) { const vol = clamp(1.2 - who.root.position.distanceTo(this.player.root.position) / 45, 0.25, 1); Voice.play(msg.line, { volume: vol }); try { who.rider?.say?.(); } catch { /* */ } } }
  }

  hudState() {
    const P = this.player; const st = this.standings(); const T = this.T;
    return {
      speed: P.v * 3.6, gear: P.gear, rpm: P.rpm / P.spec.redline, pos: st.indexOf(P) + 1, total: this.racers.length,
      time: this.mode === 'free' ? null : this.raceTime, mode: this.mode, nitro: P.nitro, boosting: P.boosting, wheelieT: P.wheelieT,
      zone: T.zoneAt(P.s).title, kmLeft: Math.max(0, (T.finishS - P.s) / 1000),
      map: this.racers.map(r => ({ x: r.x, z: r.z, yaw: r.yaw, you: r === P, color: charById(r.charId).accent, name: r.name })),
    };
  }
}

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

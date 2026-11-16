// Roadside stops with a 10-second cinematic (orbiting camera):
//   🍜 Maggi stall — helmet off, the bhaiya cooks, the rider eats, helmet on → full nitro + Maggi Power.
//   🍺 Beer shop   — helmet off, the bhaiya hands a chilled bottle through the grill, the rider drinks, helmet on →
//                    GTA-style "nasha" for 25 s (wobbly camera, drifting steering, blurry view). Teen riders get a cold drink.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { createMaggiBowl, createFork } from '../models/maggi.js';
import { createBottle } from '../models/beershop.js';
import { charById } from '../config.js';
import { Voice } from '../audio/voice.js';
import { Samples } from '../audio/samples.js';
import { Foley } from '../audio/foley.js';

const DUR = 10;
const DRUNK_TIME = 25;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const isTeen = (charId) => charById(charId).age === 'Teen';

export class MaggiBreak {
  constructor(race) {
    const sp = race.world.pop?.special || {};
    this.race = race; this.stalls = sp.stops || sp.maggi || [];
    this.active = null; this.near = null; this.hinted = new Set(); this.used = new Set();
    this.v = new THREE.Vector3(); this.head = new THREE.Vector3(); this.cam = new THREE.Vector3(); this.look = new THREE.Vector3();
  }

  label(st) {
    if (st.kind !== 'beer') return { icon: '🍜', text: 'EAT MAGGI' };
    return isTeen(this.race.player.charId) ? { icon: '🥤', text: 'COLD DRINK' } : { icon: '🍺', text: 'BEER PIYO' };
  }

  // ---------------------------------------------------------------- every frame (real time)
  update(dt) {
    const R = this.race, P = R.player, ui = R.app.ui;
    if (this.active) { this.step(dt); return; }
    let near = null;
    for (const st of this.stalls) {
      const ds = P.s - st.parkS;
      if (this.used.has(st)) { st.marker.group.visible = false; continue; }
      if (!this.hinted.has(st) && ds > -190 && ds < -70) {
        this.hinted.add(st);
        ui.toast(st.kind === 'beer' ? (isTeen(P.charId) ? '🥤 Aage dukaan hai — thandi COLD DRINK le lo!' : '🍺 BEER SHOP aage hai') : `🍜 ${st.name} MAGGI POINT aage hai — ruk ke khao!`);
      }
      if (Math.abs(ds) < 16 && Math.abs(P.d - st.parkD) < 5.5 && P.v < 4.6 && P.crashed <= 0 && !P.finished && !P.air) near = st;
      st.marker.group.visible = !(Math.abs(ds) < 10 && Math.abs(P.d - st.parkD) < 7);
    }
    if (near !== this.near) { this.near = near; ui.eatButton(!!near, near ? this.label(near) : null); }
  }

  tryStart() { if (this.near && !this.active && this.race.state === 'racing') this.start(this.near); }

  start(st) {
    const R = this.race, P = R.player, app = R.app;
    app.ui.eatButton(false); this.near = null; this.used.add(st);
    app.input.enabled = false; P.inMaggi = true; P.boosting = false; P.nitroLatch = false; P.drift = false;
    const T = R.T; const park = T.point(st.parkS, st.parkD, new THREE.Vector3());
    const teen = isTeen(P.charId); const beer = st.kind === 'beer';
    this.active = {
      st, kind: beer ? 'beer' : 'maggi', teen, t: 0, done: new Set(), park, yaw0: P.yaw, x0: P.x, z0: P.z, yaw1: T.heading(st.parkS) + Math.PI,
      bowl: beer ? null : createMaggiBowl(), fork: beer ? null : createFork(), bottle: beer ? createBottle(teen ? 'cola' : 'beer') : null,
    };
    st.marker.group.visible = false;
    app.ui.cinematic(true);
    app.ui.caption(!beer ? '🍜 Bhaiya, ek garma-garam Maggi!' : teen ? '🥤 Bhaiya, ek thandi cold drink! (beer nahi — abhi chhota hai)' : '🍺 Bhaiya, ek chilled beer!');
    Samples.play('whoosh', { volume: 0.5 });
  }

  // ---------------------------------------------------------------- cinematic timeline
  step(dt) {
    const A = this.active, R = this.race, P = R.player, app = R.app, ui = app.ui;
    A.t += dt; const t = A.t; const st = A.st;
    const at = (key, time, fn) => { if (t >= time && !A.done.has(key)) { A.done.add(key); try { fn(); } catch (e) { console.warn('[stop]', key, e); } } };
    const rider = P.rider, bike = P.bike, keeper = st.keeper;

    // roll to the parking spot in the first 0.8 s (physics is paused for the player)
    const k = ease(clamp(t / 0.8, 0, 1));
    P.x = lerp(A.x0, A.park.x, k); P.z = lerp(A.z0, A.park.z, k);
    P.yaw = A.yaw0 + wrap(A.yaw1 - A.yaw0) * k; P.vyaw = P.yaw;
    P.v = 0; P.lean = 0; P.wheelieA = 0; P.pitchV = 0; P.rpm = P.spec.idle; P.throttle = 0; P.brake = 0;
    P.project(); P.y = P.groundAt(P.x, P.z, P.s, P.d);

    // ---- common opening: side stand, helmet off
    at('park', 0.75, () => {
      bike?.setParked?.(true);
      if (rider && bike?.group) rider.group.rotation.z = bike.group.rotation.z; // lean together on the side stand
      if (rider?.setPose) try { rider.setPose('sitBike'); } catch { /* older rider build */ }
      Foley.clink(0.12);
    });
    at('helmetOff', 0.95, () => {
      if (rider?.animate) rider.animate('helmetOff', 1.6, { restPos: rider.tankRest });
      else setTimeout(() => rider?.setHelmet?.(false), 900);
    });

    if (A.kind === 'beer') this.beerScript(at, rider, keeper, A, ui);
    else this.maggiScript(at, rider, keeper, A, ui, st);

    // ---- common ending: helmet on, a line, rev, back to the race
    at('helmetOn', 8.3, () => {
      ui.caption('⛑️ Helmet on — chalo Ranikhet!');
      if (rider?.holdProps) rider.holdProps(null); else { A.bowl?.removeFromParent(); A.bottle?.removeFromParent(); }
      if (rider?.animate) rider.animate('helmetOn', 1.3); else setTimeout(() => rider?.setHelmet?.(true), 700);
    });
    at('line', 8.7, () => { const line = Voice.pick(P.charId); if (line) { Voice.play(line, { volume: 1 }); try { rider?.say?.(Math.max(1, Voice.duration(line))); } catch { /* */ } } });
    at('ready', 9.6, () => {
      bike?.setParked?.(false);
      if (rider) { rider.group.rotation.z = 0; try { rider.setHelmet?.(true); rider.setPose?.('ride'); } catch { /* */ } }
      Samples.play('engineRev', { volume: 0.55, offset: 2, duration: 1.6, fadeOut: 0.5 });
      ui.caption(null);
    });
    A.bowl?.userData.update?.(dt, R.t);

    this.camera(t);
    if (t >= DUR) this.finish();
  }

  maggiScript(at, rider, keeper, A, ui, st) {
    at('cook', 2.2, () => {
      ui.caption('👨‍🍳 Pahadi Maggi ban rahi hai...');
      if (keeper) { try { keeper.setPose?.('cook'); if (st.ladle && !st.ladle.parent?.parent) keeper.holdProp?.(st.ladle, 'right'); } catch { /* */ } }
      st.stall.steam.amount = 1.5; Foley.sizzle(2.6, 0.32);
    });
    at('serve', 4.6, () => {
      if (keeper) { try { keeper.holdProp?.(null, 'right'); keeper.holdProp?.(A.bowl, 'right'); keeper.setPose?.('serve'); } catch { /* */ } }
      Foley.clink(0.2); this.race.app.audio?.ui?.('notify');
    });
    at('eat', 5.3, () => {
      ui.caption('😋 Waah! Kya swaad hai');
      try { keeper?.holdProp?.(null, 'right'); keeper?.setPose?.('stand'); } catch { /* */ }
      st.stall.steam.amount = 1;
      if (rider?.holdProps) { rider.holdProps({ left: A.bowl, right: A.fork }); rider.animate?.('eat', 2.9); }
      else if (rider) { A.bowl.position.set(0, 1.08, 0.32); rider.group.add(A.bowl); }
    });
    at('slurp1', 5.8, () => Foley.slurp(0.45)); at('slurp2', 6.8, () => Foley.slurp(0.5)); at('slurp3', 7.7, () => Foley.slurp(0.45));
  }

  beerScript(at, rider, keeper, A, ui) {
    at('order', 2.2, () => {
      ui.caption(A.teen ? '🥤 Ek thandi cold drink, bhaiya!' : '🍺 Thandi-thandi... seedha fridge se!');
      try { keeper?.setPose?.('stand'); } catch { /* */ }
      Foley.clink(0.14);
    });
    at('serve', 3.4, () => {
      if (keeper) { try { keeper.holdProp?.(A.bottle, 'right', 'tray'); keeper.setPose?.('serve'); } catch { /* */ } }
      Foley.clink(0.22);
    });
    at('open', 4.8, () => Foley.fizz(0.4));
    at('drink', 5.3, () => {
      ui.caption(A.teen ? '🥤 Aah, thandak!' : '🍺 Gat-gat-gat...');
      try { keeper?.holdProp?.(null, 'right'); keeper?.setPose?.('stand'); } catch { /* */ }
      if (rider?.holdProps) {
        rider.holdProps({ right: A.bottle });
        const p = rider.animate?.('drink', 2.9);
        p?.then?.((ok) => { if (!ok && this.active === A && A.t < 8) rider.animate?.('eat', 2.4); });
      } else if (rider) { A.bottle.position.set(0.12, 1.4, 0.2); rider.group.add(A.bottle); }
    });
    at('glug1', 5.9, () => Foley.glug(0.45)); at('glug2', 6.8, () => Foley.glug(0.45)); at('glug3', 7.6, () => Foley.glug(0.4));
  }

  /** orbiting cinematic camera: 4 shots, each a smooth arc around the subject */
  camera(t) {
    const R = this.race, P = R.player, cam = R.app.camera, st = this.active.st;
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), rx = -fz, rz = fx;
    const head = this.head;
    if (P.rider?.headAnchor) { P.root.updateMatrixWorld(true); P.rider.headAnchor.getWorldPosition(head); } else head.set(P.x, P.y + 1.45, P.z);
    const orbit = (cx, cy, cz, deg, rad, h) => { const a = deg * Math.PI / 180; this.cam.set(cx + (fx * Math.cos(a) + rx * Math.sin(a)) * rad, cy + h, cz + (fz * Math.cos(a) + rz * Math.sin(a)) * rad); };
    let fov = 45;
    if (t < 2.2) {                                    // 1) around the rider while the helmet comes off
      const u = smoothstep(0, 2.2, t);
      orbit(head.x, head.y, head.z, lerp(205, 335, u), lerp(3.0, 1.9, u), lerp(0.5, 0.15, u));
      this.look.set(head.x, head.y - 0.12, head.z); fov = 44;
    } else if (t < 5.3) {                             // 2) the shop: pot & steam / the grill window
      const u = smoothstep(2.2, 5.3, t); const p = st.focusWorld || st.potWorld;
      const sx = Math.sin(st.yaw), sz = Math.cos(st.yaw), srx = -sz, srz = sx;
      const a = lerp(-0.45, 0.45, u); const rad = st.kind === 'beer' ? 2.1 : 1.55;
      this.cam.set(p.x + (sx * Math.cos(a) + srx * Math.sin(a)) * rad, p.y + 0.55 - u * 0.15, p.z + (sz * Math.cos(a) + srz * Math.sin(a)) * rad);
      this.look.set(p.x, p.y + 0.18, p.z); fov = 40;
    } else if (t < 8.3) {                             // 3) slow arc across the face while he eats / drinks
      const u = smoothstep(5.3, 8.3, t);
      orbit(head.x, head.y, head.z, lerp(48, 112, u), lerp(1.55, 1.3, u), lerp(0.32, 0.22, u));
      this.look.set(head.x, head.y - (st.kind === 'beer' ? 0.1 : 0.24), head.z); fov = 42;
    } else {                                          // 4) helmet on, swing round to the chase view
      const u = smoothstep(8.3, DUR, t);
      orbit(head.x, head.y, head.z, lerp(40, 180, u), lerp(2.2, 5.2, u), lerp(0.2, 0.6, u));
      this.look.set(lerp(head.x, P.x + fx * 3, u), lerp(head.y - 0.1, P.y + 1.0, u), lerp(head.z, P.z + fz * 3, u)); fov = lerp(44, 64, u);
    }
    const gy = R.world.groundAt(this.cam.x, this.cam.z); if (this.cam.y < gy + 0.4) this.cam.y = gy + 0.4;
    R.rig.shot = { t: 0, duration: 1e9, hold: true, from: this.cam, to: this.cam, lookFrom: this.look, lookTo: this.look, fovFrom: fov, fovTo: fov };
    cam.position.copy(this.cam);
  }

  finish() {
    const A = this.active, R = this.race, P = R.player, app = R.app;
    this.active = null; P.inMaggi = false;
    try {
      const kp = A.st.keeper; kp?.holdProp?.(null, 'right');
      if (A.kind === 'beer') kp?.setPose?.('stand'); else { kp?.setPose?.('cook'); if (A.st.ladle) kp?.holdProp?.(A.st.ladle, 'right'); }
    } catch { /* */ }
    try { P.rider?.holdProps?.(null); } catch { /* */ }
    A.bowl?.removeFromParent(); A.fork?.removeFromParent(); A.bottle?.removeFromParent();
    if (A.st.stall?.steam) A.st.stall.steam.amount = 1;
    R.rig.shot = null; R.rig.initialized = false;
    app.ui.cinematic(false); app.ui.caption(null);
    app.input.enabled = true; P.v = 3;
    if (A.kind === 'beer') {
      if (A.teen) { P.nitro = Math.min(1, P.nitro + 0.35); app.ui.trick('🥤 THANDAK!'); app.ui.toast('🥤 Cold drink se +35% nitro'); }
      else {
        P.drunkT = DRUNK_TIME;
        app.ui.trick('🍺 NASHA!');
        app.ui.toast('⚠️ Nashe me ho — steering bahkegi! (asli zindagi me drink & drive kabhi nahi)');
      }
    } else {
      P.nitro = 1; P.maggiPower = 8;
      app.ui.trick('🍜 MAGGI POWER!'); app.ui.toast('🍜 Nitro full + 8 sec unlimited nitro — ab udaao!');
    }
    app.audio?.ui?.('go');
  }

  dispose() {
    if (this.active) {
      const P = this.race.player; P.inMaggi = false;
      try { P.rider?.holdProps?.(null); } catch { /* */ }
      this.active.bowl?.removeFromParent(); this.active.bottle?.removeFromParent(); this.active = null;
    }
    if (this.race.player) this.race.player.drunkT = 0;
    this.race.app.ui.eatButton(false); this.race.app.ui.caption(null); this.race.app.ui.drunk?.(0);
    for (const st of this.stalls) st.marker.group.visible = true;
  }
}

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

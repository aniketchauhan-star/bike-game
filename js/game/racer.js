// Racer = bike + rider + physics + engine sound. Free-roam GTA-style physics: ride off the road onto terrain, get airborne
// off crests/cliffs, fall into the river, hit trees/buildings/walls; crashes throw the rider off (ragdoll-lite) while the
// bike tumbles separately. Driven by player input, AI, or network snapshots.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, wrapAngle } from '../core/util.js';
import { BIKES } from '../config.js';
import { STEP } from '../world/track.js';

const G = 9.81;
const MAX_LEAN = 0.98;
const SHOULDER = 1.5;
const tmpV = new THREE.Vector3();

export class Racer {
  constructor(o) {
    Object.assign(this, { id: o.id, charId: o.charId, bikeId: o.bikeId, name: o.name, kind: o.kind, track: o.track, world: o.world, audio: o.audio });
    this.spec = BIKES[o.bikeId];
    this.vTop = this.spec.topKmh / 3.6;
    // visuals
    this.root = new THREE.Group(); this.root.rotation.order = 'YXZ';
    this.wheelie = new THREE.Group(); this.wheelie.position.z = -0.71; this.root.add(this.wheelie);
    this.body = new THREE.Group(); this.body.position.z = 0.71; this.wheelie.add(this.body);
    this.bike = null; this.rider = null;
    try { this.bike = o.models.createBike(o.bikeId); this.body.add(this.bike.group); } catch (e) { console.warn('bike model failed', e); this.body.add(fallbackBike(this.spec.color)); }
    try { this.rider = o.models.createRider(o.charId); this.rider.setPose?.('ride'); this.rider.setHelmet?.(true); this.body.add(this.rider.group); } catch (e) { console.warn('rider model failed', e); }
    this.root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    // state
    this.x = 0; this.z = 0; this.y = 0; this.vy = 0; this.yaw = 0; this.v = 0; this.lean = 0; this.s = 0; this.d = 0;
    this.air = false; this.airT = 0; this.airPitch = 0;
    this.gear = 1; this.rpm = this.spec.idle; this.shiftT = 0; this.wheelieA = 0; this.pitchV = 0; this.squash = 0;
    this.throttle = 0; this.brake = 0; this.steer = 0;
    this.crashed = 0; this.ghost = 0; this.finished = false; this.finishTime = 0;
    this.offroad = 0; this.scrape = 0; this.skid = 0; this.wrongWay = 0; this.stuck = 0; this.surface = 'road';
    this.maxS = 0; this.lastSafe = { s: 0, d: 0 };
    this.kickCD = 0; this.kickT = 0; this.wobble = 0; this.wobT = 0;
    this.vyaw = 0; this.drift = false; this.driftDir = 0; this.driftAmt = 0; this.slip = 0; this.nitro = 0.35; this.boosting = false; this.driftScore = 0;
    this.wheelieT = 0;
    this.engine = null; this.events = []; this.net = null;
    this.env = null; // { solids, barrier, fx } set by race
  }

  attach(scene) { scene.add(this.root); this.scene = scene; }
  detach() { this.root.removeFromParent(); if (this.rag) this.rag.g.removeFromParent(); this.engine?.dispose?.(); this.engine = null; }
  startEngine() { if (this.engine || !this.audio) return; try { this.engine = this.audio.createEngine(this.bikeId, { local: this.kind === 'player' }); } catch { this.engine = null; } }

  placeAt(s, d) {
    const T = this.track; const p = T.point(s, d, tmpV);
    this.x = p.x; this.z = p.z; this.y = p.y; this.vy = 0; this.s = s; this.d = d; this.maxS = s; this.lastSafe = { s, d };
    this.yaw = T.heading(s) + Math.PI; this.vyaw = this.yaw; this.v = 0; this.lean = 0; this.gear = 1; this.rpm = this.spec.idle;
    this.crashed = 0; this.ghost = 0; this.finished = false; this.air = false; this.drift = false; this.nitro = 0.35;
    this.syncVisual(0, 0);
  }
  get speedKmh() { return this.v * 3.6; }

  // ------------------------------------------------------------------ ground / surface queries
  groundAt(x, z, s, d) {
    const T = this.track; const half = T.halfWidth(s);
    if (Math.abs(d) < half + SHOULDER && this.world.rivers?.bridgeSpan) return T.surfaceY(s, clamp(d, -half - SHOULDER, half + SHOULDER));
    if (Math.abs(d) < half + SHOULDER) return T.surfaceY(s, d);
    return this.world.groundAt(x, z);
  }
  surfaceKind(d) {
    const half = this.track.halfWidth(this.s); const ad = Math.abs(d);
    if (ad < half + 0.2) return 'road';
    if (ad < half + SHOULDER) return 'shoulder';
    const z = this.track.zoneIds[Math.min(this.track.N - 1, Math.round(this.s / STEP))];
    return z === 'forest' || z === 'mountain' || z === 'ridge' ? 'dirt' : 'grass';
  }

  // ------------------------------------------------------------------ physics
  step(dt, inp) {
    if (this.kind === 'remote') return;
    if (this.drunkT > 0) { // GTA-style "nasha": slow, wandering steering
      this.drunkT -= dt; this._dt = (this._dt || 0) + dt;
      const k = this.drunkK = Math.min(1, this.drunkT / 4);
      this.dSteer = (this.dSteer || 0) + (inp.steer - (this.dSteer || 0)) * Math.min(1, dt * 2.6);
      const wander = (Math.sin(this._dt * 0.9) * 0.3 + Math.sin(this._dt * 2.3 + 1.7) * 0.12) * k;
      inp = { ...inp, steer: clamp(lerp(inp.steer, this.dSteer, k) + wander, -1, 1), throttle: inp.throttle * (1 - 0.15 * k) };
    } else this.drunkK = 0;
    const T = this.track, spec = this.spec;
    this.throttle = inp.throttle; this.brake = inp.brake; this.steer = inp.steer;
    if (this.ghost > 0) this.ghost -= dt;
    this.kickCD -= dt; this.kickT = Math.max(0, this.kickT - dt);
    if (this.crashed > 0) { this.stepCrash(dt); return; }

    const v = this.v;
    // ---- lean & yaw (no steering authority in the air)
    if (!this.air) {
      const leanMax = Math.min(MAX_LEAN, 0.32 + v * 0.028) * (0.94 + spec.grip * 0.06) * (this.surface === 'road' ? 1 : 0.8);
      const target = clamp(inp.steer, -1, 1) * leanMax;
      const rate = (2.6 + Math.min(v, 30) * 0.04) * spec.leanRate;
      this.lean += clamp((target - this.lean) * 6.5, -rate, rate) * dt;
      // kick wobble
      if (this.wobble > 0) { this.wobT += dt; this.lean += Math.sin(this.wobT * 18) * this.wobble * 0.9 * dt * 6; this.wobble = Math.max(0, this.wobble - dt * 1.4); }
      let yawRate = 0;
      if (v > 0.5) yawRate = -G * Math.tan(this.lean) / Math.max(v, 4.5);
      yawRate += -inp.steer * 1.25 * (1 - smoothstep(2, 9, v)) * Math.min(1, v / 1.5);
      // ---- Asphalt-style drift: brake while steering hard at speed → the bike over-rotates and slides through the bend
      const onTar = this.surface === 'road' || this.surface === 'shoulder';
      if (!this.drift && onTar && v > 17 && inp.brake > 0.5 && Math.abs(inp.steer) > 0.45 && this.wheelieA < 0.1) { this.drift = true; this.driftDir = Math.sign(inp.steer); this.driftScore = 0; this.events.push('driftStart'); }
      if (this.drift && (Math.abs(inp.steer) < 0.2 || v < 11 || !onTar || (Math.sign(inp.steer) !== this.driftDir && Math.abs(inp.steer) > 0.45))) { this.drift = false; this.events.push('driftEnd'); }
      this.driftAmt = damp(this.driftAmt, this.drift ? 1 : 0, this.drift ? 4 : 3.5, dt); // smooth in / smooth out
      if (this.driftAmt > 0.01) {
        yawRate += -this.driftDir * (0.2 + Math.abs(inp.steer) * 0.26) * this.driftAmt;
        if (this.drift) { this.nitro = Math.min(1, this.nitro + dt * 0.2); this.driftScore += dt * v; }
      }
      this.yaw += yawRate * dt;
    } else {
      this.lean = damp(this.lean, clamp(inp.steer, -1, 1) * 0.25, 1.5, dt);
      this.yaw += -inp.steer * 0.12 * dt;
    }

    // ---- longitudinal
    const g = this.gear; const gTop = spec.gears[g - 1] / 3.6;
    let aEng = 0;
    if (this.shiftT > 0) this.shiftT -= dt;
    else if (!this.air) {
      const torque = 0.82 + 0.18 * Math.sin(clamp(v / gTop, 0, 1) * Math.PI * 0.9);
      aEng = inp.throttle * spec.accel * torque * Math.max(0, 1 - Math.pow(v / this.vTop, 2.4));
      if (v < 18) aEng = Math.min(aEng, spec.accel * 1.05);
    }
    const surf = this.surface = this.surfaceKind(this.d);
    const grip = surf === 'road' ? 1 : surf === 'shoulder' ? 0.85 : 0.6;
    const aBrake = this.air ? 0 : inp.brake * spec.brake * grip * (1 - Math.abs(this.lean) * 0.35) * (1 - 0.8 * this.driftAmt);
    // nitro
    if (this.maggiPower > 0) { this.maggiPower -= dt; this.nitro = 1; }
    if (this.nitroLatch && (this.nitro <= 0 || inp.brake > 0.5)) this.nitroLatch = false;
    const wantNitro = inp.nitro || this.nitroLatch;
    if (wantNitro && this.nitro > 0.04 && !this.air && !this.boosting) { this.boosting = true; this.events.push('nitro'); }
    if (this.boosting && (!wantNitro || this.nitro <= 0)) this.boosting = false;
    if (this.boosting) { aEng += 6.8 * Math.max(0, 1 - Math.pow(v / (this.vTop * 1.16), 3)); this.nitro = Math.max(0, this.nitro - dt * 0.33); }
    const engBrake = this.air ? 0 : (1 - inp.throttle) * (0.9 + v * 0.018);
    const drag = 0.32 * spec.accel * Math.pow(v / this.vTop, 2);
    this.offroad = surf === 'road' ? 0 : surf === 'shoulder' ? 0.35 : 1;
    const aOff = this.air ? 0 : surf === 'shoulder' ? 0.5 : surf === 'road' ? 0 : 2.4 + v * 0.05 + (v > 26 ? 3.2 : 0);
    // slope along heading (from ground under the bike)
    let slope = 0;
    if (!this.air) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const p1 = this.track.project(this.x + fx * 1.5, this.z + fz * 1.5, this.s, 6, {});
      const gA = this.groundAt(this.x + fx * 1.5, this.z + fz * 1.5, p1.s, p1.d);
      slope = clamp((gA - this.y) / 1.5, -0.7, 0.7);
    }
    let a = aEng - drag - engBrake * (v > 0.3 ? 1 : 0) - aOff - G * slope * 0.85;
    this.v = Math.max(0, v + a * dt - aBrake * dt);
    if (this.v < 0.05 && inp.throttle < 0.05) this.v = 0;
    this.skid = this.drift ? 0.85 : clamp((inp.brake - 0.75) * 4 * smoothstep(8, 20, v), 0, 1) * (this.air ? 0 : 1);

    // ---- gears & rpm
    if (g < 6 && this.v > gTop * 0.965 && this.shiftT <= 0) { this.gear++; this.shiftT = 0.07; this.events.push('shiftUp'); this.engine?.shift?.(true); }
    else if (g > 1 && this.v < (spec.gears[g - 2] / 3.6) * 0.7) { this.gear--; this.events.push('shiftDown'); this.engine?.shift?.(false); }
    const gt = spec.gears[this.gear - 1] / 3.6;
    let rpmT = spec.idle + (spec.redline - spec.idle) * clamp(this.v / gt, 0, 1.02);
    if (this.gear === 1 && this.v < 6) rpmT = Math.max(rpmT, spec.idle + inp.throttle * 5200);
    if (this.air) rpmT = Math.min(spec.redline, rpmT + inp.throttle * 2500);
    this.rpm = damp(this.rpm, rpmT, this.shiftT > 0 ? 30 : 14, dt);
    this.limiter = this.gear === 6 && this.v > this.vTop * 0.985 && inp.throttle > 0.5;

    // ---- wheelie / pitch visuals
    const autoWheelie = !this.air && inp.throttle > 0.85 && this.gear <= 2 && this.v > 4 && this.v < 26 && Math.abs(this.lean) < 0.25 && this.shiftT <= 0 && surf === 'road';
    // timed wheelie (button = 5 s, race start = 2 s); hard braking or a slide cancels it
    if (this.wheelieT > 0) { this.wheelieT -= dt; if (inp.brake > 0.6 || this.drift || this.air || this.v < 1.5) this.wheelieT = 0; }
    const userWheelie = this.wheelieT > 0;
    const wT = userWheelie ? 0.42 + (this.charId === 'himanshu' ? 0.05 : 0) : autoWheelie ? 0.16 : 0;
    this.wheelieA = damp(this.wheelieA, wT, wT > this.wheelieA ? (userWheelie ? 3.5 : 2.2) : 4.5, dt);
    if (this.wheelieA > 0.28) { this.nitro = Math.min(1, this.nitro + dt * 0.14); this.lean = clamp(this.lean, -0.38, 0.38); }
    if (this.air) this.nitro = Math.min(1, this.nitro + dt * 0.3);
    this.pitchV = damp(this.pitchV, inp.brake * 0.045 * smoothstep(3, 15, this.v) - inp.throttle * 0.012, 8, dt);

    // ---- velocity direction lags the body while drifting (slip angle)
    {
      const follow = lerp(9, 3.4, this.driftAmt); // grip: velocity follows the body; drifting lets it lag a little
      this.vyaw += wrapAngle(this.yaw - this.vyaw) * Math.min(1, follow * dt);
      const maxSlip = 0.06 + 0.32 * this.driftAmt; const sl = wrapAngle(this.yaw - this.vyaw);
      if (Math.abs(sl) > maxSlip) this.vyaw = this.yaw - Math.sign(sl) * maxSlip;
      this.v = Math.max(0, this.v - Math.abs(sl) * 1.5 * this.driftAmt * dt);
    }
    this.slip = wrapAngle(this.yaw - this.vyaw);
    // ---- horizontal integration
    const fx = Math.sin(this.vyaw), fz = Math.cos(this.vyaw);
    this.x += fx * this.v * dt; this.z += fz * this.v * dt;
    this.project();
    this.collideBarrier();
    this.collideSolids();
    if (this.crashed > 0) return;

    // ---- vertical: follow ground or fly
    const ground = this.groundAt(this.x, this.z, this.s, this.d);
    if (this.air) {
      this.vy -= G * dt; this.y += this.vy * dt; this.airT += dt;
      if (this.y <= ground) this.land(ground);
    } else {
      const predicted = this.y + this.vy * dt - 0.5 * G * dt * dt;
      if (ground < predicted - 0.1 && this.v > 9 && this.vy > -this.v * 0.6) { this.air = true; this.airT = 0; this.y = predicted; this.vy -= G * dt; this.events.push('takeoff'); }
      else {
        // vertical speed follows the ground, but a sudden step (road edge / curb) must not launch the bike:
        // limit the upward part to what the slope just ahead actually supports.
        const fxv = Math.sin(this.vyaw), fzv = Math.cos(this.vyaw);
        const pa = this.track.project(this.x + fxv * 1.5, this.z + fzv * 1.5, this.s, 6, {});
        const ahead = (this.groundAt(this.x + fxv * 1.5, this.z + fzv * 1.5, pa.s, pa.d) - ground) / 1.5;
        const maxUp = Math.max(0, this.v * clamp(ahead, -1, 1)) + 0.6;
        this.vy = clamp((ground - this.y) / Math.max(dt, 1e-4), -30, maxUp);
        this.y = ground;
      }
    }
    this.airPitch = damp(this.airPitch, this.air ? clamp(-Math.atan2(this.vy, Math.max(this.v, 1)) * 0.8, -0.6, 0.6) : 0, this.air ? 4 : 10, dt);
    this.squash = damp(this.squash, 0, 8, dt);

    // ---- water
    const rq = this.world.rivers?.query(this.x, this.z);
    if (rq && rq.dist < rq.w * 0.95 && this.y < rq.y + 0.25) { this.crash('water', { water: rq.y }); return; }
    // ---- too steep terrain (off road, grounded)
    if (!this.air && surf !== 'road' && surf !== 'shoulder' && this.v > 6) {
      const h0 = this.world.groundAt(this.x, this.z), hx = this.world.groundAt(this.x + 1.5, this.z), hz = this.world.groundAt(this.x, this.z + 1.5);
      const steep = Math.hypot(hx - h0, hz - h0) / 1.5;
      if (steep > 1.35 && Math.random() < dt * 2.2) { this.crash('slope'); return; }
    }
    // track progress / wrong way / stuck
    const rel = wrapAngle(this.yaw - (T.heading(this.s) + Math.PI));
    this.wrongWay = Math.abs(rel) > 1.9 && this.v > 3 ? this.wrongWay + dt : 0;
    this.stuck = (this.v < 1.5 && inp.throttle > 0.5) ? this.stuck + dt : 0;
    this.maxS = Math.max(this.maxS, this.s);
    if (!this.air && Math.abs(this.d) < T.halfWidth(this.s) - 0.5) this.lastSafe = { s: this.s, d: this.d };
  }

  project() {
    const T = this.track;
    // far from the road (or jumped across a hairpin) → global search
    const local = T.project(this.x, this.z, this.s, 14, {});
    let p = local;
    if (Math.abs(local.d) > 20) { const g = T.project(this.x, this.z, null, 0, {}); if (Math.abs(g.d) < Math.abs(local.d) - 5) p = g; }
    this.s = p.s; this.d = p.d;
  }

  land(ground) {
    const impact = -this.vy; this.air = false; this.y = ground;
    if (impact > 10.5 || Math.abs(this.lean) > 0.75 || (impact > 7 && this.surface !== 'road')) { this.vy = 0; this.crash('landing'); return; }
    this.vy = 0; this.v *= 0.96 - Math.min(0.15, impact * 0.012); this.squash = Math.min(0.12, impact * 0.012);
    this.events.push(impact > 3 ? 'landHard' : 'land');
    if (this.airT > 0.45) this.events.push('bigAir');
    if (impact > 3) this.env?.fx?.burst(this.surface === 'road' ? 'smoke' : 'dust', this.root.position, 8, null, 2);
  }

  /** parapets / guard rails exist only where the world placed them */
  collideBarrier() {
    const T = this.track; const env = this.env; if (!env?.barrier) return;
    this.scrape = Math.max(0, this.scrape - 0.05);
    const half = T.halfWidth(this.s); const side = this.d >= 0 ? 1 : -1;
    const line = half + 0.78;
    if (Math.abs(this.d) <= line || Math.abs(this.d) > line + 2.5) return;
    const i = Math.min(T.N - 1, Math.round(this.s / STEP)); const arr = side > 0 ? env.barrier.R : env.barrier.L;
    if (!arr[i] && !arr[Math.max(0, i - 1)] && !arr[Math.min(T.N - 1, i + 1)]) return;
    if (this.air && this.y > T.surfaceY(this.s, this.d) + 0.9) return; // flying over it
    const h = T.heading(this.s); const rx = Math.cos(h) * side, rz = -Math.sin(h) * side;
    const over = Math.abs(this.d) - line;
    this.x -= rx * over; this.z -= rz * over; this.d = side * line;
    let vx = Math.sin(this.vyaw) * this.v, vz = Math.cos(this.vyaw) * this.v;
    const vn = vx * rx + vz * rz;
    if (vn > 0) {
      if (vn > 13 && this.ghost <= 0) { this.crash('wall', { over: true, side }); return; }
      vx -= 1.25 * vn * rx; vz -= 1.25 * vn * rz;
      const sp = Math.hypot(vx, vz); this.v = sp * (1 - clamp(0.06 + vn * 0.035, 0, 0.6));
      if (sp > 0.5) { this.yaw = this.vyaw = Math.atan2(vx, vz); } this.drift = false;
      this.lean *= 0.5; this.scrape = Math.min(1, 0.4 + vn * 0.1);
      if (vn > 2.5) { this.events.push('bump'); this.env?.fx?.burst('spark', this.root.position.clone().add(new THREE.Vector3(rx * 0.4, 0.5, rz * 0.4)), 10, null, 4); }
    }
  }

  /** trees, rocks, buildings (world-space circles from env.solids) */
  collideSolids() {
    const S = this.env?.solids; if (!S) return;
    const list = S.near(this.x, this.z); if (!list) return;
    for (const c of list) {
      const dx = this.x - c.x, dz = this.z - c.z; const r = c.r + 0.4; const d2 = dx * dx + dz * dz;
      if (d2 > r * r) continue;
      if (this.air && this.y > c.top) continue;
      const dist = Math.sqrt(d2) || 0.01; const nx = dx / dist, nz = dz / dist;
      const vx = Math.sin(this.vyaw) * this.v, vz = Math.cos(this.vyaw) * this.v;
      const vn = -(vx * nx + vz * nz); // speed into the solid
      this.x += nx * (r - dist); this.z += nz * (r - dist);
      if (vn > 11 && this.ghost <= 0) { this.crash(c.kind || 'tree'); return; }
      if (vn > 0) { const tx = vx + vn * nx * 1.2, tz = vz + vn * nz * 1.2; const sp = Math.hypot(tx, tz); this.v = sp * 0.7; if (sp > 0.5) this.yaw = this.vyaw = Math.atan2(tx, tz); this.drift = false; this.events.push('bump'); }
    }
  }

  /** Asphalt-style: one tap burns the nitro tank until empty (or until you brake / tap again) */
  startNitro() {
    if (this.crashed > 0) return false;
    if (this.nitroLatch) { this.nitroLatch = false; return false; }
    if (this.nitro < 0.08) return false;
    this.nitroLatch = true; return true;
  }

  /** pop a wheelie for `sec` seconds */
  startWheelie(sec = 5) {
    if (this.crashed > 0 || this.air || this.drift) return false;
    this.wheelieT = Math.max(this.wheelieT, sec);
    this.events.push('wheelie');
    return true;
  }

  // ------------------------------------------------------------------ kicks
  tryKick(side) {
    if (this.kickCD > 0 || this.crashed > 0 || this.air || this.v < 4) return false;
    this.kickCD = 1.0; this.kickT = 0.45;
    try { this.rider?.kick?.(side); } catch { /* */ }
    this.events.push('kick');
    return true;
  }
  /** pushed by a kick toward `side` (+1 = to the right of travel) */
  onKicked(side, strength = 1) {
    if (this.crashed > 0 || this.ghost > 0 || this.inMaggi) return false;
    this.wobble = Math.min(1.2, this.wobble + 0.7 * strength); this.wobT = 0;
    this.lean += side * 0.22 * strength; this.v *= 0.93 - strength * 0.03;
    const h = this.track.heading(this.s); this.x += Math.cos(h) * side * 0.5; this.z += -Math.sin(h) * side * 0.5;
    this.events.push('kicked');
    if (this.v > 13 && Math.random() < 0.25 + strength * 0.3) { this.crash('kick', { side }); return true; }
    return false;
  }

  // ------------------------------------------------------------------ crash: rider ragdoll-lite + bike tumble
  crash(reason, opt = {}) {
    if (this.crashed > 0 || this.ghost > 0) return;
    const sp = this.v; const water = reason === 'water';
    this.crashed = water ? 3.4 : 3.6; this.crashReason = reason; this.air = false;
    this.events.push(water ? 'splash' : 'crash'); this.drift = false; this.boosting = false;
    const fx = Math.sin(this.vyaw), fz = Math.cos(this.vyaw);
    const side = opt.side || (Math.sign(this.lean) || (Math.random() < 0.5 ? -1 : 1));
    const big = sp > 22 && !water;
    // bike tumble
    this.tb = {
      vx: fx * sp * (water ? 0.3 : 0.92), vz: fz * sp * (water ? 0.3 : 0.92), vy: water ? -1 : (big ? 2 + Math.random() * 3 : 0.8),
      roll: this.lean, pitch: 0, yawOff: 0, wRoll: side * (big ? 5 + Math.random() * 5 : 3.5), wPitch: big ? (Math.random() - 0.4) * 7 : 0, wYaw: (Math.random() - 0.5) * (big ? 4 : 1.5),
      water: water ? opt.water : null, rest: false,
    };
    if (reason === 'kick') { // thrown sideways, away from the kicker, cartwheeling
      const k = opt.side || side;
      this.tb.vx += -fz * k * 4.5; this.tb.vz += fx * k * 4.5; this.tb.vy = 2.6;
      this.tb.wRoll = k * 6.5; this.tb.wYaw = k * 2.2; this.tb.wPitch = (Math.random() - 0.5) * 3;
    }
    this.lean = 0;
    // rider is thrown (reparent to scene)
    if (this.rider && this.scene) {
      const rg = this.rider.group; rg.updateMatrixWorld(true);
      const wp = new THREE.Vector3(); rg.getWorldPosition(wp);
      const q = new THREE.Quaternion(); rg.getWorldQuaternion(q);
      this.scene.add(rg); rg.position.copy(wp); rg.quaternion.copy(q); rg.updateMatrixWorld(true);
      try { this.rider.setPose?.('fall'); } catch { /* */ }   // moves the group origin to the pelvis without a visual jump
      const e = new THREE.Euler().setFromQuaternion(rg.quaternion, 'YXZ');
      const throwF = water ? 0.4 : (reason === 'wall' || reason === 'tree' || reason === 'building' || reason === 'vehicle' || reason === 'cow') ? 1.05 : 0.8;
      this.rag = {
        g: rg, p: rg.position.clone().add(new THREE.Vector3(0, 0.25, 0)), v: new THREE.Vector3(fx * sp * throwF + (Math.random() - 0.5) * 2, (water ? 1 : 3.5 + sp * 0.06), fz * sp * throwF + (Math.random() - 0.5) * 2),
        r: new THREE.Euler(e.x, e.y, e.z, 'YXZ'), w: new THREE.Vector3((big ? 7 : 4) + Math.random() * 4, (Math.random() - 0.5) * 3, side * (2 + Math.random() * 4)), ground: false, water: water ? opt.water : null,
      };
      if (reason === 'kick') {
        const k = opt.side || side;
        this.rag.v.x += -fz * k * 6; this.rag.v.z += fx * k * 6; this.rag.v.y = 4.8 + sp * 0.03;
        this.rag.w.set(5 + Math.random() * 3, (Math.random() - 0.5) * 4, k * (6 + Math.random() * 3));
      }
    }
    const fxs = this.env?.fx; const pos = this.root.position;
    if (fxs) {
      if (water) fxs.burst('splash', new THREE.Vector3(pos.x, opt.water, pos.z), 40, new THREE.Vector3(fx * 2, 4, fz * 2), 5);
      else { fxs.burst('spark', pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 25, new THREE.Vector3(fx * sp * 0.3, 1, fz * sp * 0.3), 6); fxs.burst(this.surface === 'road' ? 'smoke' : 'dust', pos, 10, null, 3); }
    }
  }

  stepCrash(dt) {
    this.crashed -= dt;
    const b = this.tb; const fxs = this.env?.fx;
    if (b) {
      if (b.water != null) { // sinking in the river
        b.vx *= Math.exp(-2.5 * dt); b.vz *= Math.exp(-2.5 * dt);
        this.x += b.vx * dt; this.z += b.vz * dt; this.y = damp(this.y, b.water - 0.55, 1.5, dt);
        b.roll = damp(b.roll, Math.sign(b.wRoll) * 1.3, 2, dt);
        if (Math.random() < dt * 6) fxs?.burst('splash', new THREE.Vector3(this.x, b.water, this.z), 2, null, 1.5);
      } else {
        b.vy -= G * dt;
        this.x += b.vx * dt; this.z += b.vz * dt; this.y += b.vy * dt;
        this.project();
        const ground = this.groundAt(this.x, this.z, this.s, this.d) + 0.32 * Math.abs(Math.sin(b.roll));
        if (this.y <= ground) {
          this.y = ground;
          if (b.vy < -2.5) { b.vy = -b.vy * 0.32; b.wRoll *= 0.7; b.wPitch *= 0.5; this.events.push('bump'); fxs?.burst(this.surface === 'road' ? 'spark' : 'dust', this.root.position, 8, null, 3); }
          else b.vy = 0;
          const fr = this.surface === 'road' || this.surface === 'shoulder' ? 6.5 : 9;
          const hs = Math.hypot(b.vx, b.vz); const ns = Math.max(0, hs - fr * dt);
          if (hs > 0.01) { b.vx *= ns / hs; b.vz *= ns / hs; }
          if (hs > 3 && (this.surface === 'road' || this.surface === 'shoulder') && Math.random() < dt * 30) fxs?.burst('spark', this.root.position.clone().add(new THREE.Vector3(0, 0.15, 0)), 2, new THREE.Vector3(b.vx * 0.3, 0.5, b.vz * 0.3), 2);
          if (hs > 3 && this.surface !== 'road' && Math.random() < dt * 12) fxs?.burst('dust', this.root.position, 1, null, 1);
          // settle on its side
          const target = Math.sign(b.roll || 1) * Math.PI / 2;
          b.wRoll = damp(b.wRoll, 0, 3, dt); b.wPitch = damp(b.wPitch, 0, 4, dt); b.wYaw = damp(b.wYaw, 0, 2, dt);
          b.roll = damp(b.roll, target, 4, dt); b.pitch = damp(b.pitch, 0, 5, dt);
        }
        // walls stop the slide
        const lim = this.track.halfWidth(this.s) + 0.78; const i = Math.min(this.track.N - 1, Math.round(this.s / STEP));
        const arr = this.d >= 0 ? this.env?.barrier?.R : this.env?.barrier?.L;
        if (arr && arr[i] && Math.abs(this.d) > lim && Math.abs(this.d) < lim + 2) { const side = Math.sign(this.d); const h = this.track.heading(this.s); this.x -= Math.cos(h) * side * (Math.abs(this.d) - lim); this.z -= -Math.sin(h) * side * (Math.abs(this.d) - lim); b.vx *= 0.3; b.vz *= 0.3; }
        const rq = this.world.rivers?.query(this.x, this.z);
        if (rq && rq.dist < rq.w * 0.95 && this.y < rq.y + 0.2) { b.water = rq.y; fxs?.burst('splash', new THREE.Vector3(this.x, rq.y, this.z), 30, null, 4); this.audio?.sfx?.('splash', { pos: this.root.position }); }
      }
      b.roll += b.wRoll * dt; b.pitch += b.wPitch * dt; b.yawOff += b.wYaw * dt;
      this.v = Math.hypot(b.vx, b.vz);
    }
    // rider ragdoll-lite
    const R = this.rag;
    if (R) {
      if (R.water != null) {
        R.v.multiplyScalar(Math.exp(-2.2 * dt)); R.v.y = 0; R.p.addScaledVector(R.v, dt); R.p.y = damp(R.p.y, R.water - 0.1, 3, dt);
        R.w.multiplyScalar(Math.exp(-2 * dt));
      } else {
        R.v.y -= G * dt; R.p.addScaledVector(R.v, dt);
        const pj = this.track.project(R.p.x, R.p.z, this.s, 20, {});
        const gy = this.groundAt(R.p.x, R.p.z, pj.s, pj.d) + 0.18;
        R.ground = false;
        if (R.p.y < gy) {
          R.p.y = gy; R.ground = true;
          if (R.v.y < -2) { R.v.y = -R.v.y * 0.28; this.events.push('thud'); } else R.v.y = 0;
          const hs = Math.hypot(R.v.x, R.v.z); const ns = Math.max(0, hs - 7.5 * dt); if (hs > 0.01) { R.v.x *= ns / hs; R.v.z *= ns / hs; }
          R.w.multiplyScalar(Math.exp(-3 * dt));
          // roll along the ground in the slide direction
          if (hs > 1) R.w.x = damp(R.w.x, hs * 1.6, 3, dt);
        }
        const rq = this.world.rivers?.query(R.p.x, R.p.z);
        if (rq && rq.dist < rq.w * 0.95 && R.p.y < rq.y + 0.15) { R.water = rq.y; fxs?.burst('splash', new THREE.Vector3(R.p.x, rq.y, R.p.z), 25, null, 4); }
      }
      R.r.x += R.w.x * dt; R.r.y += R.w.y * dt; R.r.z += R.w.z * dt;
      if ((R.ground || R.water != null) && R.w.lengthSq() < 0.6) {
        const lie = Math.round((R.r.x - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2; // on back or front
        R.r.x = damp(R.r.x, lie, 3, dt); R.r.z = damp(R.r.z, Math.round(R.r.z / Math.PI) * Math.PI, 3, dt);
      }
      R.g.position.copy(R.p); R.g.rotation.copy(R.r);
      try { this.rider.update?.(dt, performance.now() / 1000, { fall: { airborne: !R.ground && R.water == null, spin: R.w.length() } }); } catch { /* */ }
    }
    this.rpm = damp(this.rpm, this.spec.idle, 3, dt);
    if (this.crashed <= 0) this.respawn();
  }

  respawn() {
    const T = this.track;
    const onRoad = Math.abs(this.d) < T.halfWidth(this.s) + 2 && !this.tb?.water;
    const s = onRoad ? this.s : this.lastSafe.s;
    const half = T.halfWidth(s);
    const d = clamp(onRoad ? this.d : this.lastSafe.d, -half + 1.2, half - 1.2);
    const p = T.point(s, d, tmpV); this.x = p.x; this.z = p.z; this.y = p.y; this.vy = 0; this.s = s; this.d = d;
    this.yaw = T.heading(s) + Math.PI; this.vyaw = this.yaw; this.v = 7; this.lean = 0; this.gear = 1; this.crashed = 0; this.ghost = 2.2; this.air = false; this.drift = false; this.driftAmt = 0; this.wheelieT = 0;
    if (this.rag) { const rg = this.rag.g; this.body.add(rg); rg.position.set(0, 0, 0); rg.rotation.set(0, 0, 0); this.rag = null; try { this.rider.setPose?.('ride'); } catch { /* */ } }
    this.tb = null;
    this.events.push('respawn');
  }
  /** manual reset (R key / button / stuck) */
  reset() { if (this.crashed > 0) return; this.tb = null; this.crashed = 0.0001; const keep = this.lastSafe; if (Math.abs(this.d) > this.track.halfWidth(this.s) + 2) { this.s = keep.s; this.d = keep.d; } this.respawn(); }

  // ------------------------------------------------------------------ network (remote racers)
  pushSnapshot(st, now) { if (!this.net) this.net = []; this.net.push({ t: now, ...st }); if (this.net.length > 12) this.net.shift(); }
  applyRemote(now) {
    const buf = this.net; if (!buf || !buf.length) return;
    const rt = now - (this.netDelay || 120);
    let a = buf[0], b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) if (buf[i].t <= rt && buf[i + 1].t >= rt) { a = buf[i]; b = buf[i + 1]; break; }
    let t = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    if (rt > b.t) { const ex = Math.min((rt - b.t) / 1000, 0.25); a = b; t = 0; this.x = b.x + Math.sin(b.h) * b.v * ex; this.z = b.z + Math.cos(b.h) * b.v * ex; }
    else { this.x = lerp(a.x, b.x, t); this.z = lerp(a.z, b.z, t); }
    this.y = lerp(a.y ?? this.y, b.y ?? this.y, t);
    this.yaw = a.h + wrapAngle(b.h - a.h) * t;
    this.v = lerp(a.v, b.v, t); this.lean = lerp(a.l, b.l, t);
    this.rpm = lerp(a.r, b.r, t); this.gear = b.g; this.throttle = b.th; this.brake = b.b; this.steer = b.st; this.wheelieA = b.w || 0;
    // dead reckoning: show the remote rider close to where he really is now (not where he was netDelay ago)
    if (!b.c) { const ex = (this.netDelay || 120) * 0.0007; this.x += Math.sin(this.yaw) * this.v * ex; this.z += Math.cos(this.yaw) * this.v * ex; }
    this.remoteCrash = !!b.c; this.finished = !!b.f;
    this.project();
  }
  snapshot() {
    return { x: +this.x.toFixed(2), y: +this.y.toFixed(2), z: +this.z.toFixed(2), h: +this.yaw.toFixed(3), v: +this.v.toFixed(2), l: +(this.tb ? this.tb.roll : this.lean).toFixed(3), r: Math.round(this.rpm), g: this.gear,
      th: +this.throttle.toFixed(2), b: +this.brake.toFixed(2), st: +this.steer.toFixed(2), w: +this.wheelieA.toFixed(2), s: +this.s.toFixed(1), c: this.crashed > 0 ? 1 : 0, f: this.finished ? 1 : 0 };
  }

  // ------------------------------------------------------------------ visuals + audio
  syncVisual(dt, time) {
    const T = this.track;
    this.root.position.set(this.x, this.y, this.z);
    if (this.tb) {
      this.root.rotation.set(this.tb.pitch, this.yaw + this.tb.yawOff, this.tb.roll);
      this.wheelie.rotation.x = 0;
    } else {
      const grade = T.gradeAt(this.s);
      const pitch = this.air ? this.airPitch : -Math.atan(grade);
      this.root.rotation.set(pitch + this.pitchV, this.yaw, this.lean);
      this.wheelie.rotation.x = -this.wheelieA;
      this.root.position.y -= this.squash;
    }
    const vis = this.ghost > 0 ? (Math.floor(this.ghost * 10) % 2 === 0) : true;
    this.root.visible = vis;
    const st = { speed: this.tb ? 0 : this.v, steer: clamp(this.steer * (1 - smoothstep(5, 25, this.v) * 0.8), -1, 1), brake: this.brake, throttle: this.throttle, lean: this.lean };
    this.bike?.update?.(dt, time, st);
    if (!this.rag) this.rider?.update?.(dt, time, st);
  }

  updateAudio(dt) {
    if (!this.engine) return;
    this.engine.update({ rpm: this.rpm, throttle: this.crashed > 0 ? 0 : this.throttle, speed: this.v, gear: this.gear, position: this.root.position });
    this.engine.setLimiter?.(!!this.limiter);
  }
}

function fallbackBike(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 1.6), m); body.position.y = 0.7; g.add(body);
  for (const z of [-0.71, 0.71]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 8, 16), new THREE.MeshStandardMaterial({ color: 0x111111 })); w.rotation.y = Math.PI / 2; w.position.set(0, 0.31, z); g.add(w); }
  return g;
}

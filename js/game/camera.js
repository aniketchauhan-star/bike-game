// Camera rig: chase / far chase / helmet views, crash & speed shake, and scripted cinematic shots for the intro.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep } from '../core/util.js';

const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

export class CameraRig {
  constructor(camera, world) {
    this.cam = camera; this.world = world;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.roll = 0; this.fov = 64;
    this.shake = 0; this.shot = null; this.initialized = false;
  }
  setMode(m) { this.mode = m; this.initialized = false; }
  cycle() { const order = ['chase', 'far', 'helmet']; this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]); return this.mode; }

  /** cinematic shot: positions can be Vector3 or functions returning Vector3 */
  play(shot) { this.shot = { t: 0, ...shot }; }
  get inShot() { return !!this.shot; }

  update(dt, racer) {
    const cam = this.cam;
    if (this.shot) {
      const s = this.shot; s.t += dt; const k = ease(clamp(s.t / s.duration, 0, 1));
      const val = (a) => typeof a === 'function' ? a() : a;
      const p0 = val(s.from), p1 = val(s.to), l0 = val(s.lookFrom), l1 = val(s.lookTo ?? s.lookFrom);
      cam.position.lerpVectors(p0, p1, k);
      this.look.lerpVectors(l0, l1, k);
      cam.up.set(0, 1, 0); cam.lookAt(this.look);
      const f = lerp(s.fovFrom ?? 50, s.fovTo ?? s.fovFrom ?? 50, k);
      if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
      if (s.t >= s.duration && !s.hold) { const done = s.onDone; this.shot = null; this.initialized = false; done?.(); }
      return;
    }
    if (!racer) return;
    const yaw = racer.yaw, v = racer.v;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const base = v1.set(racer.x, racer.y, racer.z);
    let fovT = 64 + smoothstep(15, 85, v) * 10;
    if (this.mode === 'helmet') {
      // rider's eye: slightly behind the bars, low in a tuck
      const lean = racer.lean;
      const h = 1.2 - smoothstep(10, 50, v) * 0.1;
      // bike's right-hand direction in world space = forward × up
      const rx = -fz, rz = fx;
      const p = v2.set(base.x + fx * 0.02 + rx * Math.sin(lean) * h, base.y + Math.cos(lean) * h, base.z + fz * 0.02 + rz * Math.sin(lean) * h);
      cam.position.copy(p);
      this.look.set(p.x + fx * 20, p.y - 1.2 - Math.sin(racer.wheelieA) * -6, p.z + fz * 20);
      cam.up.set(0, 1, 0); cam.lookAt(this.look);
      cam.rotateZ(-lean * 0.7);
      fovT = 74 + smoothstep(15, 85, v) * 10;
      this.applyFov(fovT, dt);
      if (racer.rider) racer.rider.group.visible = false;
      return;
    }
    if (racer.rider && !racer.tumble) racer.rider.group.visible = true;
    const far = this.mode === 'far';
    const dist = (far ? 7.4 : 4.4) + v * (far ? 0.03 : 0.022);
    const h = (far ? 2.5 : 1.62) + v * 0.004;
    let tx = base.x - fx * dist, tz = base.z - fz * dist, ty = base.y + h;
    if (racer.crashed > 0) { tx = base.x - fx * 6; tz = base.z - fz * 6; ty = base.y + 2.6; }
    // keep the chase camera out of buildings (riding along the shops in Ramnagar): pull it in towards the bike
    const S = this.world?.solids;
    if (S) for (let k = 0; k < 6; k++) {
      const list = S.near(tx, tz); let blocked = false;
      if (list) for (const c of list) { if (c.r < 0.9) continue; const dx = tx - c.x, dz = tz - c.z; if (dx * dx + dz * dz < (c.r + 0.7) * (c.r + 0.7)) { blocked = true; break; } }
      if (!blocked) break;
      tx = base.x + (tx - base.x) * 0.68; tz = base.z + (tz - base.z) * 0.68; ty = Math.max(ty, base.y + 1.9);
    }
    const gy = this.world ? this.world.groundAt(tx, tz) : -1e9;
    ty = Math.max(ty, gy + 0.7);
    if (!this.initialized) { this.pos.set(tx, ty, tz); this.look.copy(base); this.initialized = true; }
    // separate smoothing: tight longitudinal follow, softer lateral & vertical
    const k = 1 - Math.exp(-dt * (far ? 8 : 12)), kv = 1 - Math.exp(-dt * 6);
    this.pos.x += (tx - this.pos.x) * k; this.pos.z += (tz - this.pos.z) * k; this.pos.y += (ty - this.pos.y) * kv;
    // keep a minimum distance (prevents the camera lagging into the bike at high decel)
    const dx = this.pos.x - base.x, dz = this.pos.z - base.z; const dd = Math.hypot(dx, dz);
    if (dd < dist * 0.75) { this.pos.x = base.x + dx / dd * dist * 0.75; this.pos.z = base.z + dz / dd * dist * 0.75; }
    else if (dd > dist * 1.25 && racer.crashed <= 0) { this.pos.x = base.x + dx / dd * dist * 1.25; this.pos.z = base.z + dz / dd * dist * 1.25; } // never fall far behind at speed
    const lookAhead = 2.5 + v * 0.12;
    const lt = v3.set(base.x + fx * lookAhead, base.y + (far ? 1.1 : 1.0), base.z + fz * lookAhead);
    this.look.x = damp(this.look.x, lt.x, 14, dt); this.look.y = damp(this.look.y, lt.y, 9, dt); this.look.z = damp(this.look.z, lt.z, 14, dt);
    // shake
    const sh = Math.max(this.shake, racer.offroad * 0.35 * smoothstep(5, 25, v), smoothstep(55, 85, v) * 0.12, racer.crashed > 0 ? 0.5 : 0);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const t = performance.now() / 1000;
    cam.position.set(this.pos.x + Math.sin(t * 37) * sh * 0.05, this.pos.y + Math.sin(t * 43 + 1) * sh * 0.06, this.pos.z + Math.cos(t * 31) * sh * 0.05);
    cam.up.set(0, 1, 0); cam.lookAt(this.look);
    this.roll = damp(this.roll, racer.lean * (far ? 0.18 : 0.3), 5, dt);
    cam.rotateZ(-this.roll);
    const dk = racer.drunkK || 0;
    if (dk > 0) { // nasha: the whole view sways and breathes
      const tt = performance.now() / 1000;
      cam.rotateZ(Math.sin(tt * 1.1) * 0.07 * dk);
      cam.rotateY(Math.sin(tt * 0.7 + 1) * 0.045 * dk);
      cam.rotateX(Math.sin(tt * 0.9 + 2) * 0.02 * dk);
      fovT += Math.sin(tt * 1.3) * 4 * dk;
    }
    this.applyFov(fovT, dt);
  }
  applyFov(f, dt) { const c = this.cam; const n = damp(c.fov, f, 3, dt); if (Math.abs(n - c.fov) > 0.01) { c.fov = n; c.updateProjectionMatrix(); } }
  bump(amount = 0.6) { this.shake = Math.max(this.shake, amount); }
}

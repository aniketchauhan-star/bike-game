// CPU rider: physics-consistent speed profile, racing line, pure-pursuit steering, obstacle & rider avoidance.
import { clamp, damp, smoothstep, wrapAngle } from '../core/util.js';
import { STEP } from '../world/track.js';

const G = 9.81;
const profiles = new Map();
const leanMaxAt = (v) => Math.min(0.98, 0.32 + v * 0.028);

/** max cornering speed per track sample, consistent with the bike's lean limits, then braking pass */
function speedProfile(track, margin, vTop, aBrake) {
  const key = `${margin}|${vTop}|${aBrake}`;
  if (profiles.has(key)) return profiles.get(key);
  const N = track.N; const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = Math.abs(track.K[i]);
    let best = 5;
    for (let v = 5; v <= vTop; v += 0.5) { if (G * Math.tan(leanMaxAt(v) * margin) / (v * v) >= k) best = v; else if (v > best + 4) break; }
    out[i] = Math.min(vTop, best);
  }
  // braking pass
  for (let i = N - 2; i >= 0; i--) out[i] = Math.min(out[i], Math.sqrt(out[i + 1] ** 2 + 2 * aBrake * STEP));
  profiles.set(key, out);
  return out;
}

export class AIController {
  constructor(racer, track, skill = 0.92, seed = 1) {
    this.r = racer; this.T = track; this.skill = skill;
    this.lineBias = ((seed * 9301 + 49297) % 233280) / 233280 * 1.6 - 0.8; // personal lateral preference
    this.profile = speedProfile(track, 0.86 + skill * 0.06, racer.vTop * (0.86 + skill * 0.14), racer.spec.brake * (0.66 + skill * 0.16));
    this.dTarget = 0; this.wobble = 0; this.lastSteer = 0;
  }

  update(dt, { racers = [], obstacles = [], leaderS = null, playerS = null } = {}) {
    const r = this.r, T = this.T; const v = r.v; const s = r.s;
    if (r.crashed > 0) return { throttle: 0, brake: 0, steer: 0 };
    if (r.wrongWay > 1.2 || r.stuck > 2.5) { r.reset(); }
    const half = T.halfWidth(s);
    // --- racing line: inside of the upcoming bend
    const la = s + 22 + v * 0.9;
    const k = T.curvature(la);
    let dLine = -Math.sign(k) * (half - 1.3) * clamp(Math.abs(k) * 45, 0, 1) + this.lineBias * (1 - clamp(Math.abs(k) * 45, 0, 1));
    // --- avoidance of riders / obstacles ahead
    let push = 0;
    const consider = (os, od, w, vo = 0) => {
      const closing = Math.max(0, v - vo); // oncoming traffic (vo < 0) closes much faster
      const ahead = os - s; if (ahead < -1.5 || ahead > 16 + closing * 1.9) return;
      if (vo > v + 1 && ahead > 3) return; // faster thing ahead, ignore
      const lateral = od - this.dTarget;
      if (Math.abs(lateral) < w + 1.3) {
        const left = od - w - 1.4, right = od + w + 1.4;
        const goLeft = Math.abs(left - this.dTarget) < Math.abs(right - this.dTarget);
        const tgt = goLeft ? left : right;
        if (Math.abs(tgt) < half - 0.4) push = tgt - this.dTarget; else push = (goLeft ? right : left) - this.dTarget;
      }
    };
    for (const o of racers) if (o !== r && o.crashed <= 0) consider(o.s, o.d, 0.5, o.v);
    let want = clamp(dLine + push, -half + 0.8, half - 0.8);
    // obstacles & traffic are hard constraints: keep a safe corridor beside them
    let lo = -half + 0.8, hi = half - 0.8, blocked = false;
    for (const ob of obstacles) {
      const vo = ob.kind === 'traffic' && ob.ref ? ob.ref.v * ob.ref.dir : 0;
      const closing = Math.max(0, v - vo); const ahead = ob.s - s;
      if (ahead < -ob.hl - 2 || ahead > 16 + closing * 1.9) continue;
      const w = ob.hw + 1.1;
      const roomLeft = (ob.d - w) - lo, roomRight = hi - (ob.d + w);
      const preferLeft = vo < 0 ? true : roomLeft > roomRight; // oncoming traffic: always pass on its outside (left)
      if (preferLeft && roomLeft > 0.2) hi = Math.min(hi, ob.d - w);
      else if (roomRight > 0.2) lo = Math.max(lo, ob.d + w);
      else if (roomLeft > 0.2) hi = Math.min(hi, ob.d - w);
      else blocked = true;
    }
    if (lo > hi) { blocked = true; want = (lo + hi) / 2; } else want = clamp(want, lo, hi);
    this.blocked = blocked;
    this.dTarget = damp(this.dTarget, want, (push || this.blocked || want !== clamp(dLine + push, -half + 0.8, half - 0.8)) ? 6 : 1.6, dt);
    // --- pure pursuit steering -> lean
    const Ld = 7 + v * 0.42;
    const p = T.point(Math.min(T.length, s + Ld), this.dTarget);
    const dx = p.x - r.x, dz = p.z - r.z;
    const desired = Math.atan2(dx, dz);
    const alpha = wrapAngle(desired - r.yaw);              // + = target to the left
    const dist = Math.hypot(dx, dz);
    const kappa = 2 * Math.sin(alpha) / Math.max(dist, 3); // + = left
    const leanD = -Math.atan(v * v * kappa / G);
    let steer = clamp(leanD / Math.max(0.2, leanMaxAt(v)), -1, 1);
    if (v < 6) steer = clamp(-alpha * 2.2, -1, 1);
    steer = this.lastSteer + clamp(steer - this.lastSteer, -dt * 6, dt * 6);
    this.lastSteer = steer;
    // --- speed control
    let rb = 1;
    if (playerS != null) { const gap = s - playerS; const k = this.rubber || 1; rb = gap > 120 ? 1 - Math.min(0.09 / k, (gap - 120) / (2500 * k)) : gap < -120 ? 1 + Math.min(0.07 * k, (-gap - 120) * k / 2500) : 1; }
    const i = Math.min(T.N - 1, Math.round((s + v * 0.35) / STEP));
    const vT = this.profile[i] * rb * (Math.abs(this.dTarget - r.d) > 1.5 ? 0.96 : 1);
    let throttle = 0, brake = 0;
    if (v < vT - 0.6) throttle = 1;
    else if (v > vT + 1.2) { brake = clamp((v - vT) / 5, 0.25, 1); }
    else throttle = 0.55;
    // obstacle directly ahead and no room: brake
    for (const ob of obstacles) {
      const vo = ob.kind === 'traffic' && ob.ref ? ob.ref.v * ob.ref.dir : 0;
      const ahead = ob.s - s; if (ahead > 0 && ahead < 12 + Math.max(0, v - vo) * 0.8 && Math.abs(ob.d - r.d) < ob.hw + 0.9) { brake = Math.max(brake, 0.85); throttle = 0; }
    }
    if (this.blocked) { brake = Math.max(brake, 0.6); throttle = 0; }
    return { throttle, brake, steer };
  }
}

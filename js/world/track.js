// Ramnagar → Ranikhet route: turtle-defined centreline, sampled every STEP metres.
// Pure math (no DOM) — usable from node tests too.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';

export const STEP = 2;

// Zone metadata. roadHalf = half asphalt width, limit = barrier distance from centre (both sides).
export const ZONES = {
  town:     { id: 'town', title: 'RAMNAGAR', sub: 'Bus Stand • Main Bazaar', roadHalf: 4.6, limit: 6.4, km: 0 },
  forest:   { id: 'forest', title: 'CORBETT TIGER RESERVE', sub: 'Jungle hai — dheere aur dhyaan se', roadHalf: 4.0, limit: 7.2 },
  river:    { id: 'river', title: 'KOSI NADI', sub: 'Garjiya Devi Mandir', roadHalf: 3.9, limit: 5.1 },
  mountain: { id: 'mountain', title: 'PAHADI RASTA', sub: 'Mohan • Kumeria • Bhatronjkhan', roadHalf: 3.8, limit: 4.9 },
  ridge:    { id: 'ridge', title: 'RANIKHET', sub: 'Pahadon ki Rani', roadHalf: 4.1, limit: 5.6 },
};

// Turtle route. a: degrees (+ = left, − = right), r: radius (m), S: straight length (m).
// {zone} switches zone from here, {mark, off} records a landmark at current s (+off), {y} = elevation key at current s.
export const ROUTE = [
  { zone: 'town' }, { y: 0 },
  { mark: 'start', off: 36 }, { mark: 'busStand', off: 70 },
  { S: 300 },
  { a: -22, r: 200 }, { S: 140 }, { mark: 'chowk' },
  { a: 28, r: 210 }, { S: 210 }, { y: 0 },

  { zone: 'forest' }, { mark: 'forestGate', off: 20 },
  { a: 18, r: 260 }, { S: 180 }, { mark: 'deer' },
  { a: -42, r: 170 }, { S: 150 }, { mark: 'tiger', off: 40 },
  { a: 34, r: 230 }, { S: 170 }, { y: 6 }, { mark: 'elephant' },
  { a: -30, r: 150 }, { S: 130 }, { y: 12 },

  { zone: 'river' }, { mark: 'riverStart' },
  { a: 38, r: 130 }, { S: 150 }, { mark: 'dhaba1' },
  { a: -46, r: 110 }, { S: 110 }, { mark: 'garjiya', off: 20 },
  { a: 34, r: 140 }, { S: 170 }, { y: 28 },
  { a: -38, r: 100 }, { mark: 'bridge', off: 40 }, { S: 120 },
  { a: 44, r: 115 }, { S: 110 }, { y: 44 }, { mark: 'riverEnd' },

  { zone: 'mountain' },
  { a: -30, r: 80 }, { S: 150 }, { mark: 'waterfall', off: -60 },
  { a: 168, r: 23 }, { S: 175 },
  { a: -172, r: 23 }, { S: 190 }, { mark: 'village', off: -80 },
  { a: 170, r: 25 }, { S: 165 },
  { a: -40, r: 70 }, { S: 110 }, { mark: 'snake', off: -40 },
  { a: -160, r: 24 }, { S: 180 }, { mark: 'dhaba2', off: -60 },
  { a: 152, r: 27 }, { S: 150 },
  { a: -34, r: 90 }, { y: 205 },

  { zone: 'ridge' }, { mark: 'ranikhetGate', off: 30 },
  { S: 190 },
  { a: 30, r: 160 }, { S: 170 }, { mark: 'church', off: -40 },
  { a: -44, r: 125 }, { S: 150 },
  { a: 24, r: 220 }, { S: 120 }, { mark: 'finish', off: 0 }, { S: 140 }, { y: 222 },
];

export class Track {
  constructor(route = ROUTE) {
    this.route = route;
    this.marks = {};
    this._build();
  }

  _build() {
    // 1) raw heading per sample + zone + elevation keys
    const headings = [0]; const zones = []; const yKeys = []; const zoneSpans = [];
    let theta = 0, s = 0, zone = 'town';
    const pendingMarks = [];
    const pushSample = (dTheta) => { theta += dTheta; headings.push(theta); zones.push(zone); s += STEP; };
    for (const seg of this.route) {
      if (seg.zone) { zone = seg.zone; zoneSpans.push({ id: zone, s0: s }); continue; }
      if (seg.mark) { pendingMarks.push([seg.mark, s + (seg.off || 0)]); continue; }
      if (seg.y !== undefined) { yKeys.push([s, seg.y]); continue; }
      if (seg.S) { const n = Math.round(seg.S / STEP); for (let i = 0; i < n; i++) pushSample(0); }
      if (seg.a) {
        const arc = Math.abs(seg.a * Math.PI / 180) * seg.r; const n = Math.max(1, Math.round(arc / STEP));
        const dth = (seg.a * Math.PI / 180) / n; for (let i = 0; i < n; i++) pushSample(dth);
      }
    }
    zones.push(zone);
    const N = headings.length;
    // 2) smooth heading changes (clothoid-like transitions)
    const dH = new Float32Array(N); for (let i = 1; i < N; i++) dH[i] = headings[i] - headings[i - 1];
    const sm = gaussSmooth(dH, 6);
    const H = new Float32Array(N); H[0] = 0; for (let i = 1; i < N; i++) H[i] = H[i - 1] + sm[i];
    // 3) integrate positions
    const X = new Float32Array(N), Z = new Float32Array(N);
    for (let i = 1; i < N; i++) {
      const th = (H[i] + H[i - 1]) * 0.5;
      X[i] = X[i - 1] - Math.sin(th) * STEP; Z[i] = Z[i - 1] - Math.cos(th) * STEP;
    }
    // 4) elevation from keys (linear) then smoothed
    yKeys.sort((a, b) => a[0] - b[0]);
    const Yraw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const si = i * STEP; let y = yKeys[0][1];
      for (let k = 0; k < yKeys.length - 1; k++) {
        if (si >= yKeys[k][0] && si <= yKeys[k + 1][0]) { const t = (si - yKeys[k][0]) / Math.max(1e-6, yKeys[k + 1][0] - yKeys[k][0]); y = lerp(yKeys[k][1], yKeys[k + 1][1], t); break; }
        if (si > yKeys[k + 1][0]) y = yKeys[k + 1][1];
      }
      // gentle undulation in forest / ridge
      const z = zones[i];
      if (z === 'forest' || z === 'ridge') y += Math.sin(si * 0.011) * 1.6 + Math.sin(si * 0.027 + 1.3) * 0.7;
      Yraw[i] = y;
    }
    const Y = gaussSmooth(Yraw, 22);
    // 5) curvature + bank + per-sample road widths (smoothed between zones)
    const K = new Float32Array(N);
    for (let i = 1; i < N - 1; i++) K[i] = (H[i + 1] - H[i - 1]) / (2 * STEP);
    K[0] = K[1]; K[N - 1] = K[N - 2];
    const Ks = gaussSmooth(K, 4);
    const bank = new Float32Array(N); for (let i = 0; i < N; i++) bank[i] = clamp(Ks[i] * 4.0, -0.07, 0.07);
    const half = new Float32Array(N), limit = new Float32Array(N);
    for (let i = 0; i < N; i++) { const zz = ZONES[zones[i]]; half[i] = zz.roadHalf; limit[i] = zz.limit; }
    const halfS = gaussSmooth(half, 15), limS = gaussSmooth(limit, 15);
    // widen slightly on tight hairpins for playability
    for (let i = 0; i < N; i++) { const w = smoothstep(0.012, 0.04, Math.abs(Ks[i])); halfS[i] += w * 0.9; limS[i] += w * 0.9; }

    Object.assign(this, { N, X, Y, Z, H, K: Ks, bank, half: halfS, limit: limS, zoneIds: zones });
    this.length = (N - 1) * STEP;
    for (const [k, v] of pendingMarks) this.marks[k] = clamp(v, 0, this.length);
    this.zoneSpans = zoneSpans.map((z, i) => ({ ...ZONES[z.id], s0: z.s0, s1: i < zoneSpans.length - 1 ? zoneSpans[i + 1].s0 : this.length }));
    this.startS = this.marks.start; this.finishS = this.marks.finish;
    // grade (dy/ds)
    this.grade = new Float32Array(N);
    for (let i = 1; i < N - 1; i++) this.grade[i] = (Y[i + 1] - Y[i - 1]) / (2 * STEP);
    // bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < N; i++) { minX = Math.min(minX, X[i]); maxX = Math.max(maxX, X[i]); minZ = Math.min(minZ, Z[i]); maxZ = Math.max(maxZ, Z[i]); }
    this.bounds = { minX, maxX, minZ, maxZ };
    // spatial hash of samples
    this.cell = 24; this.hash = new Map();
    for (let i = 0; i < N; i++) {
      const k = this._key(Math.floor(X[i] / this.cell), Math.floor(Z[i] / this.cell));
      let arr = this.hash.get(k); if (!arr) this.hash.set(k, arr = []); arr.push(i);
    }
    // speed profile for AI (computed lazily per lateral grip)
    this._speedProfiles = new Map();
  }

  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  // ---------------------------------------------------------------- sampling
  idx(s) { return clamp(s / STEP, 0, this.N - 1.0001); }
  /** linear interpolation of a per-sample array at distance s */
  at(arr, s) { const f = this.idx(s); const i = Math.floor(f); const t = f - i; return arr[i] + (arr[Math.min(i + 1, this.N - 1)] - arr[i]) * t; }
  heading(s) { return this.at(this.H, s); }
  elevation(s) { return this.at(this.Y, s); }
  halfWidth(s) { return this.at(this.half, s); }
  limitAt(s) { return this.at(this.limit, s); }
  curvature(s) { return this.at(this.K, s); }
  bankAt(s) { return this.at(this.bank, s); }
  gradeAt(s) { return this.at(this.grade, s); }
  zoneAt(s) {
    for (const z of this.zoneSpans) if (s >= z.s0 && s < z.s1) return z;
    return this.zoneSpans[this.zoneSpans.length - 1];
  }
  /** centreline point (x, y, z) at s */
  center(s, out = new THREE.Vector3()) { return out.set(this.at(this.X, s), this.at(this.Y, s), this.at(this.Z, s)); }
  /** horizontal forward unit vector */
  forward(s, out = new THREE.Vector3()) { const h = this.heading(s); return out.set(-Math.sin(h), 0, -Math.cos(h)); }
  /** horizontal right unit vector */
  right(s, out = new THREE.Vector3()) { const h = this.heading(s); return out.set(Math.cos(h), 0, -Math.sin(h)); }
  /** road surface point at (s, d) — d positive = right of travel direction */
  point(s, d = 0, out = new THREE.Vector3()) {
    const h = this.heading(s); const x = this.at(this.X, s), z = this.at(this.Z, s);
    return out.set(x + Math.cos(h) * d, this.surfaceY(s, d), z - Math.sin(h) * d);
  }
  surfaceY(s, d) {
    const y = this.elevation(s); const b = this.bankAt(s);
    // positive bank = left curve -> right (outside) higher
    return y + Math.tan(b) * d * (1);
  }

  // ---------------------------------------------------------------- projection
  /** nearest point on track near hint index. returns {s, d, i} */
  project(x, z, hintS = null, window = 40, out = {}) {
    let best = -1, bestD = Infinity;
    if (hintS == null) {
      const r = this.nearestSample(x, z); best = r.i;
    } else {
      const c = Math.round(this.idx(hintS)); const a = Math.max(0, c - window), b = Math.min(this.N - 1, c + window);
      for (let i = a; i <= b; i++) { const dx = this.X[i] - x, dz = this.Z[i] - z; const d2 = dx * dx + dz * dz; if (d2 < bestD) { bestD = d2; best = i; } }
    }
    // refine on segment best-1..best+1
    let s = best * STEP, d = 0, bd = Infinity;
    for (const j of [best - 1, best]) {
      if (j < 0 || j + 1 >= this.N) continue;
      const ax = this.X[j], az = this.Z[j], bx = this.X[j + 1], bz = this.Z[j + 1];
      const vx = bx - ax, vz = bz - az; const L2 = vx * vx + vz * vz;
      let t = ((x - ax) * vx + (z - az) * vz) / L2; t = clamp(t, 0, 1);
      const px = ax + vx * t, pz = az + vz * t; const dd = (x - px) ** 2 + (z - pz) ** 2;
      if (dd < bd) {
        bd = dd; s = (j + t) * STEP;
        const L = Math.sqrt(L2); const rx = -vz / L, rz = vx / L; // right = (−vz, vx)/L for forward (vx,vz)
        d = (x - px) * rx + (z - pz) * rz;
      }
    }
    out.s = s; out.d = d; out.i = best;
    return out;
  }
  /** global nearest sample using spatial hash. returns {i, dist} */
  nearestSample(x, z, maxRing = 6) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
        if (r > 0 && Math.abs(ix - cx) < r && Math.abs(iz - cz) < r) continue; // ring only
        const arr = this.hash.get(this._key(ix, iz)); if (!arr) continue;
        for (const i of arr) { const dx = this.X[i] - x, dz = this.Z[i] - z; const d2 = dx * dx + dz * dz; if (d2 < bestD) { bestD = d2; best = i; } }
      }
      if (best >= 0 && Math.sqrt(bestD) < r * this.cell) break;
    }
    if (best < 0) { // brute force fallback
      for (let i = 0; i < this.N; i += 4) { const dx = this.X[i] - x, dz = this.Z[i] - z; const d2 = dx * dx + dz * dz; if (d2 < bestD) { bestD = d2; best = i; } }
    }
    return { i: best, dist: Math.sqrt(bestD) };
  }
  /** all sample indices within radius (coarse, by hash cells) */
  samplesNear(x, z, radius) {
    const out = []; const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const arr = this.hash.get(this._key(ix, iz)); if (arr) for (const i of arr) out.push(i);
    }
    return out;
  }

  /** AI target speed profile (m/s) for a given max lateral acceleration and braking */
  speedProfile(aLat = 11, aBrake = 8.5, vMax = 80) {
    const key = `${aLat}|${aBrake}|${vMax}`;
    if (this._speedProfiles.has(key)) return this._speedProfiles.get(key);
    const v = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) { const k = Math.abs(this.K[i]); v[i] = Math.min(vMax, k > 1e-5 ? Math.sqrt(aLat / k) : vMax); }
    for (let i = this.N - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * aBrake * STEP));
    this._speedProfiles.set(key, v);
    return v;
  }
}

function gaussSmooth(arr, sigma) {
  const N = arr.length; const out = new Float32Array(N); const R = Math.ceil(sigma * 2.5);
  const w = []; let ws = 0; for (let k = -R; k <= R; k++) { const v = Math.exp(-(k * k) / (2 * sigma * sigma)); w.push(v); ws += v; }
  for (let i = 0; i < N; i++) {
    let s = 0, wsum = 0;
    for (let k = -R; k <= R; k++) { const j = i + k; if (j < 0 || j >= N) continue; s += arr[j] * w[k + R]; wsum += w[k + R]; }
    out[i] = s / wsum;
  }
  return out;
}

// Kosi river + tributary + waterfall stream: polylines with water level & widths, plus fast distance queries.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';

class Polyline {
  /** pts: [{x,z,y,w,bed}] y = water surface, w = water half-width, bed = riverbed (carve) half-width */
  constructor(pts, name) {
    this.name = name; this.pts = pts; this.cell = 40; this.hash = new Map();
    this.len = [0];
    for (let i = 1; i < pts.length; i++) this.len.push(this.len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.total = this.len[this.len.length - 1];
    let maxW = 0; for (const p of pts) maxW = Math.max(maxW, p.bed);
    this.maxBed = maxW;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const minx = Math.min(a.x, b.x) - maxW - 40, maxx = Math.max(a.x, b.x) + maxW + 40;
      const minz = Math.min(a.z, b.z) - maxW - 40, maxz = Math.max(a.z, b.z) + maxW + 40;
      for (let cx = Math.floor(minx / this.cell); cx <= Math.floor(maxx / this.cell); cx++)
        for (let cz = Math.floor(minz / this.cell); cz <= Math.floor(maxz / this.cell); cz++) {
          const k = cx * 92821 ^ cz * 68917; let arr = this.hash.get(k); if (!arr) this.hash.set(k, arr = []); arr.push(i);
        }
    }
  }
  /** nearest segment info or null if far */
  query(x, z, out = {}) {
    const arr = this.hash.get(Math.floor(x / this.cell) * 92821 ^ Math.floor(z / this.cell) * 68917);
    if (!arr) return null;
    let best = Infinity, bi = -1, bt = 0;
    for (const i of arr) {
      const a = this.pts[i], b = this.pts[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z; const L2 = vx * vx + vz * vz || 1;
      const t = clamp(((x - a.x) * vx + (z - a.z) * vz) / L2, 0, 1);
      const px = a.x + vx * t, pz = a.z + vz * t; const d2 = (x - px) ** 2 + (z - pz) ** 2;
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    if (bi < 0) return null;
    const a = this.pts[bi], b = this.pts[bi + 1];
    out.dist = Math.sqrt(best); out.i = bi; out.t = bt;
    out.y = lerp(a.y, b.y, bt); out.w = lerp(a.w, b.w, bt); out.bed = lerp(a.bed, b.bed, bt);
    out.along = lerp(this.len[bi], this.len[bi + 1], bt);
    // flow direction (downstream = toward index 0 for main river)
    out.dx = a.x - b.x; out.dz = a.z - b.z; const L = Math.hypot(out.dx, out.dz) || 1; out.dx /= L; out.dz /= L;
    return out;
  }
}

function smoothPts(pts, iters = 3) {
  for (let k = 0; k < iters; k++) {
    const c = pts.map(p => ({ ...p }));
    for (let i = 1; i < pts.length - 1; i++) {
      for (const key of ['x', 'z', 'y', 'w', 'bed']) c[i][key] = (pts[i - 1][key] + pts[i][key] * 2 + pts[i + 1][key]) / 4;
    }
    pts = c;
  }
  return pts;
}

export class Rivers {
  constructor(track) {
    this.track = track;
    const T = track; const m = T.marks;
    const sA = 1360, sB = 3010;          // river follows road (right side) between these
    const pts = [];
    const tmp = new THREE.Vector3(), r = new THREE.Vector3(), f = new THREE.Vector3();
    const gapAt = (s) => {
      // distance from road centre to river centre (right side)
      let g = 46;
      g += (1 - smoothstep(sA, sA + 380, s)) * 70;          // far from road in the forest
      g += Math.sin(s * 0.006) * 6;
      if (Math.abs(s - m.garjiya) < 120) g += (1 - Math.abs(s - m.garjiya) / 120) * 10; // wider bend at Garjiya
      return g;
    };
    const waterYAt = (s) => T.elevation(s) - 9.5 - (1 - smoothstep(sA, sA + 300, s)) * 1.5;
    // downstream extension: keep following the road on its right, but swing far away from it and end well
    // before Ramnagar town (the bazaar must stay dry!)
    {
      const townEnd = T.zoneSpans.find(z => z.id === 'town')?.s1 ?? 830;
      const sEnd = townEnd + 140; const y0 = waterYAt(sA);
      const tail = [];
      for (let s = sA - 15; s >= sEnd; s -= 15) {
        const t = (sA - s) / (sA - sEnd);
        T.center(s, tmp); T.right(s, r);
        const gap = gapAt(s) + t * t * 230;
        tail.push({ x: tmp.x + r.x * gap, z: tmp.z + r.z * gap, y: y0 - t * 5, w: 17, bed: 30 });
      }
      // beyond that, bend away east/south-east, out of sight of the town
      T.center(sEnd, tmp); T.right(sEnd, r); T.forward(sEnd, f);
      const last = tail[tail.length - 1];
      for (let k = 1; k <= 8; k++) tail.push({ x: last.x + r.x * k * 55 - f.x * k * 25, z: last.z + r.z * k * 55 - f.z * k * 25, y: last.y - k * 0.6, w: 17, bed: 30 });
      tail.reverse(); // far downstream end first
      for (const p of tail) pts.push(p);
    }
    for (let s = sA; s <= sB; s += 12) {
      T.center(s, tmp); T.right(s, r); const g = gapAt(s);
      const wide = Math.abs(s - m.garjiya) < 140 ? (1 - Math.abs(s - m.garjiya) / 140) : 0;
      pts.push({ x: tmp.x + r.x * g, z: tmp.z + r.z * g, y: waterYAt(s), w: 16 + wide * 8 + Math.sin(s * 0.01) * 2, bed: 27 + wide * 9 });
    }
    // upstream extension (north-east, away from hairpins which climb west)
    {
      const s = sB; T.center(s, tmp); T.right(s, r); T.forward(s, f);
      const g = gapAt(s); const y0 = waterYAt(s);
      for (let k = 1; k <= 22; k++) {
        const fwd = k * 60; const side = g + k * k * 0.9;
        pts.push({ x: tmp.x + r.x * side + f.x * fwd, z: tmp.z + r.z * side + f.z * fwd, y: y0 + k * 1.1, w: 15 - k * 0.15, bed: 25 - k * 0.2 });
      }
    }
    // store downstream→upstream; flow is toward index 0
    this.main = new Polyline(smoothPts(pts, 4), 'kosi');
    this.garjiyaPos = (() => { const q = this.main.query(...(() => { T.center(m.garjiya, tmp); T.right(m.garjiya, r); const g = gapAt(m.garjiya); return [tmp.x + r.x * g, tmp.z + r.z * g]; })()); return q; })();

    // tributary under the bridge (from left hills, under road, into Kosi)
    {
      const s = m.bridge; T.center(s, tmp); T.right(s, r); T.forward(s, f);
      const roadY = T.elevation(s);
      const tp = [];
      for (let d = gapAt(s); d >= -170; d -= 10) {
        const tt = (gapAt(s) - d) / (gapAt(s) + 170); // 0 at kosi, 1 far up-hill
        const wig = Math.sin(d * 0.05) * 4 * smoothstep(-20, -80, d);
        tp.push({ x: tmp.x + r.x * d + f.x * wig, z: tmp.z + r.z * d + f.z * wig, y: waterYAt(s) + 0.2 + Math.max(0, tt - 0.25) * 60 + Math.max(0, tt - 0.6) * 40, w: 3.2, bed: 7.5 });
      }
      // force level under road a bit below road
      for (const p of tp) { const dd = Math.hypot(p.x - tmp.x, p.z - tmp.z); if (dd < 14) p.y = Math.min(p.y, roadY - 7.5); }
      tp.reverse(); // downstream (kosi end) first? keep flow toward index 0 → kosi end at index 0
      tp.reverse();
      this.trib = new Polyline(smoothPts(tp, 3), 'trib');
      this.bridgeSpan = { s0: s - 16, s1: s + 16, s: s };
    }

    // waterfall on the uphill (left) side
    {
      const s = m.waterfall; T.center(s, tmp); T.right(s, r); T.forward(s, f);
      const half = T.halfWidth(s); const roadY = T.elevation(s);
      this.waterfall = {
        s, roadY,
        base: new THREE.Vector3(tmp.x - r.x * (half + 9), roadY - 0.6, tmp.z - r.z * (half + 9)),
        top: new THREE.Vector3(tmp.x - r.x * (half + 18), roadY + 22, tmp.z - r.z * (half + 18)),
        right: r.clone(), forward: f.clone(),
      };
      // stream from pool, under road (culvert), down to the right
      const sp = [];
      for (let d = -(half + 9); d <= 70; d += 6) {
        const y = d < half + 3 ? roadY - 1.2 - Math.max(0, d + half) * 0.02 : roadY - 1.4 - (d - half - 3) * 0.45;
        sp.push({ x: tmp.x + r.x * d, z: tmp.z + r.z * d, y, w: 1.6, bed: 4 });
      }
      sp.reverse(); // downstream first
      this.stream = new Polyline(smoothPts(sp, 2), 'stream');
    }
    this.lines = [this.main, this.trib, this.stream];
  }

  /** nearest water body info (prefers deepest carve). returns null if no river near */
  query(x, z) {
    let best = null;
    for (const L of this.lines) {
      const q = L.query(x, z, {});
      if (q && q.dist < q.bed + 30 && (!best || q.dist - q.bed < best.dist - best.bed)) { q.line = L; best = q; }
    }
    return best;
  }
}

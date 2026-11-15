// Hero superbikes: Kawasaki Ninja ZX-10R, BMW S 1000 RR, Ducati Panigale V4.
// Procedural, PBR, livery painted in a fragment shader (crisp at any distance), ≈10 draw calls per bike.
// Conventions: meters, Y up, bike faces +Z, left side = +X. Origin on the ground midway between tyre contact patches.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { canvasTexture, roundRect, clamp, lerp, smoothstep, damp, DEG } from '../core/util.js';

// ------------------------------------------------------------------------------------------------ public info
export const BIKE_INFO = {
  zx10r: {
    id: 'zx10r', name: 'Kawasaki Ninja ZX-10R', short: 'ZX-10R', make: 'Kawasaki', rider: 'mayank',
    engine: '998cc Inline-4', power: '203 hp', torque: '114 Nm', topSpeed: 299, weight: 207,
    idle: 1300, redline: 14000, cylinders: 4, layout: 'inline4', gears: 6,
    plate: 'UK 04 MK 1010', colors: { primary: '#63b32e', secondary: '#111214', accent: '#f2f2f2' },
    stats: { topSpeed: 0.92, acceleration: 0.86, handling: 0.84, braking: 0.88 },
  },
  s1000rr: {
    id: 's1000rr', name: 'BMW S 1000 RR', short: 'S 1000 RR', make: 'BMW', rider: 'tushar',
    engine: '999cc Inline-4', power: '207 hp', torque: '113 Nm', topSpeed: 303, weight: 197,
    idle: 1250, redline: 14600, cylinders: 4, layout: 'inline4', gears: 6,
    plate: 'UK 04 TS 1000', colors: { primary: '#f4f5f7', secondary: '#1c2a6b', accent: '#d3172e' },
    stats: { topSpeed: 0.95, acceleration: 0.92, handling: 0.86, braking: 0.9 },
  },
  panigale: {
    id: 'panigale', name: 'Ducati Panigale V4', short: 'Panigale V4', make: 'Ducati', rider: 'himanshu',
    engine: '1103cc V4 Desmosedici Stradale', power: '215 hp', torque: '124 Nm', topSpeed: 299, weight: 191,
    idle: 1350, redline: 16000, cylinders: 4, layout: 'v4', gears: 6,
    plate: 'UK 04 HM 0004', colors: { primary: '#c40a12', secondary: '#1a1a1a', accent: '#ffffff' },
    stats: { topSpeed: 0.9, acceleration: 0.95, handling: 0.94, braking: 0.92 },
  },
};

/** Standard rider anchors shared by all three bikes (bike-local). */
export const STANDARD_ANCHORS = {
  seat: new THREE.Vector3(0, 0.83, -0.18),
  gripL: new THREE.Vector3(0.30, 0.90, 0.40),
  gripR: new THREE.Vector3(-0.30, 0.90, 0.40),
  pegL: new THREE.Vector3(0.20, 0.37, -0.22),
  pegR: new THREE.Vector3(-0.20, 0.37, -0.22),
  helmetRest: new THREE.Vector3(0, 0.845, -0.15),
};

const RAKE = 24 * DEG;
const AX = new THREE.Vector3(0, Math.cos(RAKE), -Math.sin(RAKE)); // steering axis (up/back)
const RF = 0.300, RR = 0.318;                       // tyre outer radii (front / rear)
const FC = new THREE.Vector3(0, RF, 0.71);          // front axle
const RC = new THREE.Vector3(0, RR, -0.71);         // rear axle
const PIVOT = new THREE.Vector3(0, 0.47, -0.12);    // swingarm pivot

// ------------------------------------------------------------------------------------------------ geometry helpers
function cardinal(p0, p1, p2, p3, t, c) {
  const m1 = (1 - c) * (p2 - p0) / 2, m2 = (1 - c) * (p3 - p1) / 2;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
}
const LOFT_KEYS = ['z', 'cx', 'cy', 'w', 'ht', 'hb', 'nt', 'nb', 'taper', 'dip', 'droop'];
function sectionPoint(s, th) {
  const c = Math.cos(th), sn = Math.sin(th);
  const n = sn >= 0 ? s.nt : s.nb; const e = 2 / n;
  const px = Math.sign(c) * Math.pow(Math.abs(c), e), py = Math.sign(sn) * Math.pow(Math.abs(sn), e);
  const x = s.cx + s.w * px * (1 - s.taper * py);
  let y = s.cy + (py >= 0 ? s.ht * py : s.hb * py);
  if (py > 0) y -= s.dip * py * (1 - px * px);
  y -= s.droop * px * px;
  return [x, y];
}
/**
 * Loft along Z through superellipse sections. station: {z, cx, cy, w, ht, hb, nt, nb, taper, dip, droop}
 * theta0/theta1 → open surface (no caps).
 */
function loft(stations, o = {}) {
  const radial = o.radial ?? 32, steps = o.steps ?? 30, tension = o.tension ?? 0.15;
  const S = stations.map(s => ({ cx: 0, nt: 2.4, nb: 2.4, taper: 0, dip: 0, droop: 0, ...s }));
  const N = S.length;
  const segLen = []; let total = 0;
  for (let i = 0; i < N - 1; i++) { const d = Math.hypot(S[i + 1].z - S[i].z, S[i + 1].cy - S[i].cy) + 1e-4; segLen.push(d); total += d; }
  const samples = [];
  for (let i = 0; i < N - 1; i++) { const n = Math.max(1, Math.round(steps * segLen[i] / total)); for (let k = 0; k < n; k++) samples.push(i + k / n); }
  samples.push(N - 1);
  const sec = (u) => {
    let i = Math.floor(u); if (i >= N - 1) i = N - 2; const t = u - i;
    const p0 = S[Math.max(i - 1, 0)], p1 = S[i], p2 = S[i + 1], p3 = S[Math.min(i + 2, N - 1)];
    const r = {};
    for (const k of LOFT_KEYS) r[k] = cardinal(p0[k], p1[k], p2[k], p3[k], t, tension);
    r.w = Math.max(r.w, 1e-4); r.ht = Math.max(r.ht, 1e-4); r.hb = Math.max(r.hb, 1e-4);
    r.nt = Math.max(r.nt, 1.2); r.nb = Math.max(r.nb, 1.2);
    return r;
  };
  const open = o.theta0 !== undefined;
  const th0 = o.theta0 ?? 0, th1 = o.theta1 ?? Math.PI * 2;
  const ringN = open ? radial + 1 : radial;
  const pos = [], uv = [], idx = [];
  const rings = samples.length;
  const secs = samples.map(sec);
  for (let r = 0; r < rings; r++) {
    const s = secs[r];
    for (let j = 0; j < ringN; j++) {
      const th = th0 + (th1 - th0) * j / radial;
      const [x, y] = sectionPoint(s, th);
      pos.push(x, y, s.z); uv.push(j / radial, r / (rings - 1));
    }
  }
  const dir = Math.sign(S[N - 1].z - S[0].z) || 1;
  for (let r = 0; r < rings - 1; r++) for (let j = 0; j < radial; j++) {
    const j1 = open ? j + 1 : (j + 1) % radial;
    const a = r * ringN + j, b = r * ringN + j1, c = (r + 1) * ringN + j1, d = (r + 1) * ringN + j;
    if (dir > 0) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c);
  }
  if (!open && o.caps !== false) {
    for (const [ri, isEnd] of [[0, false], [rings - 1, true]]) {
      const s = secs[ri]; const base = pos.length / 3;
      pos.push(s.cx, s.cy, s.z); uv.push(0.5, 0.5);
      for (let j = 0; j < radial; j++) { const k = (ri * ringN + j) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); uv.push(0, 0); }
      const front = (isEnd && dir > 0) || (!isEnd && dir < 0);
      for (let j = 0; j < radial; j++) {
        const a = base + 1 + j, b = base + 1 + (j + 1) % radial;
        if (front) idx.push(base, a, b); else idx.push(base, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** apply scale / euler rotation / translation */
function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = null) {
  if (s) g.scale(...(Array.isArray(s) ? s : [s, s, s]));
  if (r[0] || r[1] || r[2]) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ')));
  g.translate(p[0], p[1], p[2]);
  return g;
}
/** orient geometry built along +Y (from y=0 to y=len) onto segment a→b */
function alongY(g, a, b, roll = 0) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
  if (roll) g.rotateY(roll);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
  g.translate(a.x, a.y, a.z);
  return g;
}
/** orient geometry built along +Z (from z=0 to z=len) onto segment a→b, keeping 'up' near +Y */
function alongZ(g, a, b, up = new THREE.Vector3(0, 1, 0)) {
  const o = new THREE.Object3D(); o.position.copy(a); o.up.copy(up); o.lookAt(b); o.updateMatrix();
  g.applyMatrix4(o.matrix); return g;
}
const cylY = (r0, r1, len, seg = 16, open = false) => { const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, open); g.translate(0, len / 2, 0); return g; };
const rbox = (w, h, d, r = 0.01, s = 1) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const mirrorX = g => { const m = g.clone(); m.scale(-1, 1, 1); flipWinding(m); return m; };
function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
  else {
    for (const k of Object.keys(g.attributes)) {
      const at = g.attributes[k], n = at.itemSize, arr = at.array;
      for (let i = 0; i < at.count; i += 3) for (let c = 0; c < n; c++) { const t = arr[(i + 1) * n + c]; arr[(i + 1) * n + c] = arr[(i + 2) * n + c]; arr[(i + 2) * n + c] = t; }
      at.needsUpdate = true;
    }
  }
  g.computeVertexNormals();
  return g;
}
/** quad strip between two polylines (resampled to n points), lying roughly in the XY plane at z */
function strip(top, bot, n = 10) {
  const rs = (pts) => { // resample polyline by arc length
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const out = [];
    for (let k = 0; k <= n; k++) {
      const t = L[L.length - 1] * k / n; let i = 1; while (i < L.length - 1 && L[i] < t) i++;
      const f = (t - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
      out.push([lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)]);
    }
    return out;
  };
  const T = rs(top), B = rs(bot); const pos = [], uv = [], idx = [];
  for (let k = 0; k <= n; k++) { pos.push(T[k][0], T[k][1], 0, B[k][0], B[k][1], 0); uv.push(k / n, 1, k / n, 0); }
  for (let k = 0; k < n; k++) { const a = k * 2, b = a + 1, c = a + 3, d = a + 2; idx.push(a, b, d, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // make it face +Z regardless of input order
  const p = g.attributes.position; const e1 = V(p.getX(1) - p.getX(0), p.getY(1) - p.getY(0), 0), e2 = V(p.getX(2) - p.getX(0), p.getY(2) - p.getY(0), 0);
  if (e1.cross(e2).z < 0) flipWinding(g);
  return g;
}
/** project vertices of geo along dir onto mesh surface (+offset along hit normal) */
const _rc = new THREE.Raycaster();
function projectOnto(geo, mesh, dir, offset = 0.003) {
  const p = geo.attributes.position; const v = new THREE.Vector3(); const d = dir.clone().normalize();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    _rc.set(v.clone().addScaledVector(d, -1.0), d);
    const hit = _rc.intersectObject(mesh, false)[0];
    if (hit) { v.copy(hit.point).addScaledVector(hit.face.normal, offset); p.setXYZ(i, v.x, v.y, v.z); }
  }
  p.needsUpdate = true; geo.computeVertexNormals();
  return geo;
}

/** internal geometry helpers shared with riders.js */
export const _bikeGeo = { loft, xf, alongY, alongZ, cylY, rbox, flipWinding, strip };

// ------------------------------------------------------------------------------------------------ part buckets
class Parts {
  constructor() { this.b = {}; }
  add(bucket, geo, color = 0xffffff, rough = 0.5, metal = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count; const c = new THREE.Color(color);
    const ca = new Float32Array(n * 3), ra = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; ra[i * 2] = rough; ra[i * 2 + 1] = metal; }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); g.setAttribute('rm', new THREE.BufferAttribute(ra, 2));
    (this.b[bucket] ||= []).push(g);
    return g;
  }
  mesh(bucket, material, { cast = true, receive = true } = {}) {
    const list = this.b[bucket]; if (!list || !list.length) return null;
    const geo = mergeGeometries(list, false); geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material); m.castShadow = cast; m.receiveShadow = receive; m.name = bucket;
    return m;
  }
}

// ------------------------------------------------------------------------------------------------ materials
let _uber = null, _glass = null, _lights = null;
function uberMaterial() {
  if (_uber) return _uber;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 rm;\nvarying vec2 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRM;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vRM.y;');
  };
  m.customProgramCacheKey = () => 'bike-uber-v1';
  _uber = m; return m;
}
function glassMaterial() {
  return _glass ||= new THREE.MeshPhysicalMaterial({
    color: 0x1d252b, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.42, side: THREE.DoubleSide,
    depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4,
  });
}
function lightsMaterial() { return _lights ||= new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true }); }

const GLSL_COMMON = /* glsl */`
float aaStep(float e, float v){ float w = max(fwidth(v), 1e-5) * 0.8; return smoothstep(e - w, e + w, v); }
float inBand(float v, float a, float b){ return aaStep(a, v) * (1.0 - aaStep(b, v)); }
float rboxMask(vec2 p, vec2 c, vec2 hs, float ang){
  float s = sin(ang), co = cos(ang); vec2 q = p - c; q = vec2(co*q.x + s*q.y, -s*q.x + co*q.y);
  vec2 d = abs(q) - hs; float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - aaStep(0.0, sd);
}
`;
const GLSL_PANELS = /* glsl */`
float panelLines(vec3 p, vec3 n){
  float side = smoothstep(0.3, 0.7, abs(n.x));
  float l = 0.0;
  // upper cowl / side cowl split (rising toward the tank)
  float y1 = 0.705 + (0.88 - p.z) * 0.30;
  l = max(l, inBand(p.y, y1 - 0.0016, y1 + 0.0016) * inBand(p.z, 0.40, 0.90) * side);
  // side panel rear edge (slanted)
  float z2 = 0.02 + (p.y - 0.30) * 0.35;
  l = max(l, inBand(p.z, z2 - 0.0018, z2 + 0.0018) * inBand(p.y, 0.30, 0.80) * side);
  // lower fairing split
  l = max(l, inBand(p.y, 0.355, 0.3585) * inBand(p.z, 0.06, 0.40) * side);
  // tank / fairing gap and tail seam
  l = max(l, inBand(p.z, 0.392, 0.396) * aaStep(0.82, p.y));
  l = max(l, inBand(p.y - (0.80 + (-p.z - 0.3) * 0.24), -0.0015, 0.0015) * (1.0 - aaStep(-0.36, p.z)) * side);
  return 1.0 - 0.75 * l;
}
`;
const glc = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`; };

/** paint material with GLSL livery (vec4 livery(vec3 p, vec3 n): rgb + roughness override (a<0 = default)) */
function makePaintMaterial(key, liveryGLSL, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: opts.metalness ?? 0.08, roughness: opts.roughness ?? 0.34,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.15,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP;\nvarying vec3 vLN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;\nvLN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP;\nvarying vec3 vLN;\n' + GLSL_COMMON + GLSL_PANELS + liveryGLSL)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 liv = livery(vLP, normalize(vLN));\nliv.rgb *= panelLines(vLP, normalize(vLN));\nvec4 diffuseColor = vec4( liv.rgb, opacity );')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (liv.a >= 0.0) roughnessFactor = liv.a;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nif (liv.a > 0.45) material.clearcoat = 0.0;\n#endif');
  };
  m.customProgramCacheKey = () => 'bike-paint-' + key;
  return m;
}

// ---------------------------------------------------------------- liveries (bike-local position p, normal n)
const LIVERY = {
  zx10r: /* glsl */`
vec4 livery(vec3 p, vec3 n){
  vec3 G = ${glc('#5fb52a')}, K = ${glc('#0b0b0c')}, W = ${glc('#f1f1f1')}, D = ${glc('#2c3036')};
  vec3 col = G; float r = -1.0;
  float ax = abs(p.x);
  // diagonal black lower fairing, rising toward the nose
  float bnd = 0.47 + 0.30 * clamp(p.z, -0.2, 0.75);
  float lower = 1.0 - aaStep(bnd, p.y);
  col = mix(col, K, lower);
  // white pin-stripe + grey swoosh above the boundary (sides only)
  float side = smoothstep(0.25, 0.6, abs(n.x));
  col = mix(col, W, inBand(p.y, bnd + 0.012, bnd + 0.022) * side * step(-0.06, p.z) * (1.0 - step(0.8, p.z)));
  float sw = inBand(p.y, bnd + 0.03, bnd + 0.075 - 0.06 * clamp((0.45 - p.z) / 0.5, 0.0, 1.0)) * inBand(p.z, 0.0, 0.48) * side;
  col = mix(col, D, sw);
  // tank: black knee pads at the rear sides
  col = mix(col, K, inBand(p.z, -0.08, 0.10) * inBand(p.y, 0.80, 0.93) * smoothstep(0.5, 0.8, abs(n.x)));
  // tail: black underside + white thin stripe
  float tail = 1.0 - aaStep(-0.27, p.z);
  col = mix(col, K, tail * (1.0 - aaStep(-0.25, n.y)));
  col = mix(col, W, tail * inBand(p.y - (0.83 + (-p.z - 0.3) * 0.21), -0.004, 0.006) * side);
  // nose: headlight housings (gloss black), ram-air intake, radiator opening
  float hl = rboxMask(vec2(ax, p.y), vec2(0.09, 0.733), vec2(0.064, 0.03), 0.30) * aaStep(0.875, p.z);
  col = mix(col, vec3(0.006), hl); if (hl > 0.5) r = 0.06;
  float ram = rboxMask(vec2(ax, p.y), vec2(0.0, 0.715), vec2(0.032, 0.022), 0.0) * aaStep(0.925, p.z);
  col = mix(col, vec3(0.0), ram); if (ram > 0.5) r = 0.9;
  float rad = aaStep(0.35, n.z) * inBand(p.z, 0.24, 0.49) * (1.0 - aaStep(0.62, p.y));
  col = mix(col, vec3(0.012) * (0.6 + 0.4 * step(0.5, fract(p.y * 70.0))), rad); if (rad > 0.5) r = 0.85;
  // side vent slats on fairing
  float vent = inBand(p.z, 0.36, 0.50) * inBand(p.y + (p.z - 0.36) * 0.9, 0.56, 0.66) * side;
  col = mix(col, vec3(0.008) * (0.5 + 0.5 * step(0.45, fract((p.y + p.z * 0.9) * 55.0))), vent); if (vent > 0.5) r = 0.7;
  return vec4(col, r);
}`,
  s1000rr: /* glsl */`
vec4 livery(vec3 p, vec3 n){
  vec3 Wt = ${glc('#f3f4f6')}, LB = ${glc('#1f86d8')}, DB = ${glc('#1b2766')}, RD = ${glc('#d0162b')}, K = ${glc('#0c0c0d')};
  vec3 col = Wt; float r = -1.0; float ax = abs(p.x);
  float side = smoothstep(0.2, 0.55, abs(n.x));
  float top = smoothstep(0.45, 0.8, n.y);
  // M tri-colour diagonal sweep on sides (rises toward the tail)
  float c = p.y - (0.50 - 0.42 * p.z);
  float sideMask = side * (1.0 - top);
  col = mix(col, RD, inBand(c, 0.000, 0.034) * sideMask);
  col = mix(col, DB, inBand(c, 0.034, 0.068) * sideMask);
  col = mix(col, LB, inBand(c, 0.068, 0.102) * sideMask);
  // centre racing stripes over nose, tank and tail
  float topMask = top * step(0.0, p.y - 0.7);
  col = mix(col, RD, inBand(ax, 0.0, 0.014) * topMask);
  col = mix(col, DB, inBand(ax, 0.014, 0.032) * topMask);
  col = mix(col, LB, inBand(ax, 0.032, 0.050) * topMask);
  // lower fairing / belly black
  col = mix(col, K, 1.0 - aaStep(0.30 + 0.06 * clamp(p.z, 0.0, 1.0), p.y));
  // tail underside black
  col = mix(col, K, (1.0 - aaStep(-0.27, p.z)) * (1.0 - aaStep(-0.3, n.y)));
  // nose: slim LED housings + big central intake + radiator
  float hl = rboxMask(vec2(ax, p.y), vec2(0.10, 0.782), vec2(0.054, 0.016), 0.30) * aaStep(0.87, p.z);
  col = mix(col, vec3(0.006), hl); if (hl > 0.5) r = 0.06;
  float intake = rboxMask(vec2(ax, p.y), vec2(0.0, 0.725), vec2(0.05, 0.03), 0.0) * aaStep(0.92, p.z);
  col = mix(col, vec3(0.0), intake); if (intake > 0.5) r = 0.9;
  float rad = aaStep(0.35, n.z) * inBand(p.z, 0.24, 0.49) * (1.0 - aaStep(0.62, p.y));
  col = mix(col, vec3(0.012) * (0.6 + 0.4 * step(0.5, fract(p.y * 70.0))), rad); if (rad > 0.5) r = 0.85;
  // side gills
  float gill = inBand(p.z, 0.08, 0.30) * inBand(p.y, 0.42, 0.56) * side;
  col = mix(col, vec3(0.01) * (0.4 + 0.6 * step(0.5, fract(p.z * 40.0))), gill * (1.0 - step(0.0, c - 0.0) * step(c, 0.102))); if (gill > 0.5) r = 0.75;
  return vec4(col, r);
}`,
  panigale: /* glsl */`
vec4 livery(vec3 p, vec3 n){
  vec3 R = ${glc('#c00a12')}, K = ${glc('#0c0c0d')}, W = ${glc('#f2f2f2')}, GR = ${glc('#159a3c')}, Gy = ${glc('#2b2d31')};
  vec3 col = R; float r = -1.0; float ax = abs(p.x);
  float side = smoothstep(0.25, 0.6, abs(n.x));
  // large side air outlet (matte black) on the mid fairing
  float outlet = inBand(p.z, 0.02, 0.36) * inBand(p.y + (p.z - 0.02) * 0.55, 0.40, 0.58) * side;
  col = mix(col, vec3(0.01) * (0.5 + 0.5 * step(0.4, fract((p.y + p.z * 0.55) * 45.0))), outlet); if (outlet > 0.5) r = 0.7;
  // belly edge dark grey
  col = mix(col, Gy, 1.0 - aaStep(0.29, p.y));
  // tail underside black, small tricolore near tail end
  float tail = 1.0 - aaStep(-0.27, p.z);
  col = mix(col, K, tail * (1.0 - aaStep(-0.25, n.y)));
  float tc = inBand(p.z, -0.86, -0.80) * inBand(p.y - (0.86 + (-p.z - 0.3) * 0.18), 0.0, 0.03) * side;
  col = mix(col, GR, tc * (1.0 - aaStep(-0.84, p.z))); col = mix(col, W, tc * inBand(p.z, -0.84, -0.82));
  // nose: twin intakes under eyebrows, small centre ridge
  float intake = rboxMask(vec2(ax, p.y), vec2(0.093, 0.722), vec2(0.05, 0.028), 0.22) * aaStep(0.87, p.z);
  col = mix(col, vec3(0.0), intake); if (intake > 0.5) r = 0.85;
  float brow = rboxMask(vec2(ax, p.y), vec2(0.093, 0.777), vec2(0.056, 0.011), 0.22) * aaStep(0.87, p.z);
  col = mix(col, vec3(0.006), brow); if (brow > 0.5) r = 0.06;
  float rad = aaStep(0.35, n.z) * inBand(p.z, 0.24, 0.49) * (1.0 - aaStep(0.62, p.y));
  col = mix(col, vec3(0.012) * (0.6 + 0.4 * step(0.5, fract(p.y * 70.0))), rad); if (rad > 0.5) r = 0.85;
  return vec4(col, r);
}`,
};

// helmet-style generic paint used for small painted parts we don't want livery on (fender etc. use livery anyway)

// ------------------------------------------------------------------------------------------------ shapes per bike
const BODY_BASE = [
  { z: 0.955, cy: 0.740, w: 0.026, ht: 0.018, hb: 0.028 },
  { z: 0.940, cy: 0.743, w: 0.085, ht: 0.052, hb: 0.060, taper: 0.18, nt: 2.8, nb: 2.6 },
  { z: 0.900, cy: 0.751, w: 0.135, ht: 0.088, hb: 0.085, taper: 0.30, nt: 3.0, nb: 2.8 },
  { z: 0.830, cy: 0.767, w: 0.165, ht: 0.118, hb: 0.100, taper: 0.34, nt: 3.1, nb: 2.8 },
  { z: 0.740, cy: 0.778, w: 0.185, ht: 0.138, hb: 0.110, taper: 0.34, nt: 3.1, nb: 2.8 },
  { z: 0.640, cy: 0.784, w: 0.198, ht: 0.145, hb: 0.120, taper: 0.30, nt: 3.0, nb: 2.8 },
  { z: 0.560, cy: 0.775, w: 0.206, ht: 0.130, hb: 0.140, taper: 0.24, dip: 0.03, nt: 2.9, nb: 2.8 },
  { z: 0.500, cy: 0.755, w: 0.214, ht: 0.115, hb: 0.175, taper: 0.14, dip: 0.06, nt: 2.8, nb: 2.8 },
  { z: 0.450, cy: 0.725, w: 0.222, ht: 0.120, hb: 0.250, taper: 0.08, dip: 0.06 },
  { z: 0.400, cy: 0.660, w: 0.226, ht: 0.180, hb: 0.300, taper: 0.06 },
  { z: 0.340, cy: 0.585, w: 0.226, ht: 0.255, hb: 0.310, taper: 0.06 },
  { z: 0.270, cy: 0.555, w: 0.218, ht: 0.285, hb: 0.330, taper: 0.08 },
  { z: 0.170, cy: 0.540, w: 0.202, ht: 0.300, hb: 0.320, taper: 0.10 },
  { z: 0.070, cy: 0.530, w: 0.178, ht: 0.305, hb: 0.300, taper: 0.12 },
  { z: -0.010, cy: 0.520, w: 0.150, ht: 0.290, hb: 0.270, taper: 0.12 },
  { z: -0.050, cy: 0.520, w: 0.100, ht: 0.240, hb: 0.220 },
  { z: -0.070, cy: 0.520, w: 0.040, ht: 0.120, hb: 0.120 },
];
const TANK_BASE = [
  { z: 0.385, cy: 0.900, w: 0.050, ht: 0.020, hb: 0.040 },
  { z: 0.360, cy: 0.910, w: 0.120, ht: 0.055, hb: 0.075, taper: 0.1 },
  { z: 0.300, cy: 0.922, w: 0.172, ht: 0.082, hb: 0.105, nt: 3.0, taper: 0.2 },
  { z: 0.200, cy: 0.924, w: 0.192, ht: 0.090, hb: 0.115, nt: 3.1, taper: 0.24 },
  { z: 0.100, cy: 0.912, w: 0.182, ht: 0.082, hb: 0.115, nt: 3.1, taper: 0.24 },
  { z: 0.020, cy: 0.894, w: 0.152, ht: 0.062, hb: 0.105, taper: 0.15 },
  { z: -0.030, cy: 0.878, w: 0.128, ht: 0.040, hb: 0.085 },
  { z: -0.060, cy: 0.865, w: 0.104, ht: 0.022, hb: 0.065 },
  { z: -0.075, cy: 0.860, w: 0.060, ht: 0.010, hb: 0.040 },
];
const TAIL_BASE = [
  { z: -0.060, cy: 0.740, w: 0.100, ht: 0.050, hb: 0.070 },
  { z: -0.180, cy: 0.745, w: 0.135, ht: 0.055, hb: 0.080 },
  { z: -0.320, cy: 0.775, w: 0.150, ht: 0.060, hb: 0.100, taper: 0.1 },
  { z: -0.460, cy: 0.830, w: 0.142, ht: 0.078, hb: 0.100, nt: 2.8, taper: 0.12 },
  { z: -0.600, cy: 0.868, w: 0.122, ht: 0.074, hb: 0.085, nt: 2.8, taper: 0.12 },
  { z: -0.740, cy: 0.903, w: 0.095, ht: 0.063, hb: 0.065, taper: 0.1 },
  { z: -0.860, cy: 0.934, w: 0.062, ht: 0.048, hb: 0.048 },
  { z: -0.945, cy: 0.956, w: 0.030, ht: 0.026, hb: 0.026 },
  { z: -0.975, cy: 0.962, w: 0.010, ht: 0.010, hb: 0.010 },
];
function modStations(base, fn) { return base.map((s, i) => fn({ ...s }, i)); }

const SPEC = {
  zx10r: {
    body: modStations(BODY_BASE, (s, i) => { if (i <= 2) { s.w *= 0.94; } return s; }),
    tank: TANK_BASE,
    tail: modStations(TAIL_BASE, (s) => { if (s.z < -0.5) s.cy += 0.012 * (-s.z - 0.5) / 0.5; return s; }),
    frame: ['#121314', 0.45, 0.6], swingarm: ['#151617', 0.4, 0.6], fork: ['#c99a2e', 0.28, 1], forkInner: ['#d8c27a', 0.18, 1],
    caliper: ['#c9a227', 0.35, 0.8], wheel: ['#0f0f10', 0.32, 0.4], rimStripe: '#5fb52a', spokes: 'split6',
    clamp: ['#1a1b1c', 0.35, 0.8], engine: ['#1d1e21', 0.5, 0.5], cover: ['#2a2b2e', 0.35, 0.8],
    exhaust: 'zx', shock: '#b5891f', swingarmType: 'double', pillion: 'pad', winglet: 'zx', headlight: 'zx',
    mirror: '#0d0d0e', tailLight: 'zx', chain: ['#8a6a2a', 0.45, 0.9],
  },
  s1000rr: {
    body: modStations(BODY_BASE, (s, i) => { if (i <= 2) { s.cy += 0.006; s.ht *= 1.04; } return s; }),
    tank: modStations(TANK_BASE, (s) => { s.ht *= 1.02; return s; }),
    tail: modStations(TAIL_BASE, (s) => { if (s.z < -0.8) { s.w *= 0.9; } return s; }),
    frame: ['#a9adb2', 0.32, 1], swingarm: ['#9ea2a8', 0.3, 1], fork: ['#151517', 0.3, 0.8], forkInner: ['#c9a75a', 0.2, 1],
    caliper: ['#1d4fa8', 0.35, 0.3], wheel: ['#121213', 0.28, 0.3], rimStripe: '#1f86d8', spokes: 'five',
    clamp: ['#b8bcc1', 0.25, 1], engine: ['#26272a', 0.45, 0.6], cover: ['#3b3d41', 0.35, 0.9],
    exhaust: 'bmw', shock: '#1d4fa8', swingarmType: 'double', pillion: 'pad', winglet: 'bmw', headlight: 'bmw',
    mirror: '#0d0d0e', tailLight: 'bmw', chain: ['#4a4c50', 0.45, 0.9],
  },
  panigale: {
    body: modStations(BODY_BASE, (s, i) => { s.w *= 0.95; if (i <= 3) { s.w *= 0.9; s.cy += 0.004; } if (s.cy - s.hb < 0.27) { s.hb = s.cy - 0.27; } return s; }),
    tank: modStations(TANK_BASE, (s) => { s.w *= 0.96; s.ht *= 1.04; return s; }),
    tail: modStations(TAIL_BASE, (s) => { s.w *= 0.86; s.hb *= 0.85; if (s.z < -0.5) s.cy += 0.02 * (-s.z - 0.5) / 0.5; return s; }),
    frame: ['#1a1a1b', 0.45, 0.5], swingarm: ['#1b1b1c', 0.35, 0.6], fork: ['#d4a22a', 0.25, 1], forkInner: ['#c9b06a', 0.18, 1],
    caliper: ['#c79b2a', 0.35, 0.8], wheel: ['#141414', 0.3, 0.5], rimStripe: '#c00a12', spokes: 'three',
    clamp: ['#1c1c1d', 0.35, 0.8], engine: ['#202124', 0.5, 0.5], cover: ['#2f3034', 0.35, 0.9],
    exhaust: 'v4', shock: '#e8c11a', swingarmType: 'single', pillion: 'cowl', winglet: 'v4', headlight: 'v4',
    mirror: '#c00a12', tailLight: 'v4', chain: ['#4a4c50', 0.45, 0.9],
  },
};

// ------------------------------------------------------------------------------------------------ decal atlas
const _decalCache = {};
function decalMaterial(id) {
  if (_decalCache[id]) return _decalCache[id];
  const info = BIKE_INFO[id];
  const tex = canvasTexture(1024, 512, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const outline = (txt, x, y, fill, stroke, lw) => { if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(txt, x, y); } ctx.fillStyle = fill; ctx.fillText(txt, x, y); };
    // region A (0,0,1024,160): main side text
    // region B (0,160,512,288): secondary text
    // region C (512,160,1024,416): number plate
    // region D (0,288,512,416): extra
    if (id === 'zx10r') {
      ctx.font = 'italic 900 132px "Arial Black", "Helvetica Neue", Arial, sans-serif';
      outline('Ninja', 512, 84, '#ffffff', '#0b0b0b', 14);
      ctx.font = 'italic 900 96px "Arial Black", Arial, sans-serif';
      outline('ZX-10R', 256, 226, '#0b0b0b', '#f1f1f1', 6);
      ctx.font = 'bold 70px Arial, sans-serif'; outline('KRT', 256, 352, '#5fb52a', '#0b0b0b', 6);
    } else if (id === 's1000rr') {
      ctx.font = 'bold 118px "Helvetica Neue", Arial, sans-serif';
      outline('S 1000 RR', 512, 84, '#1b2766', null, 0);
      // tri-colour slashes
      const cols = ['#1f86d8', '#1b2766', '#d0162b'];
      cols.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); const x = 120 + i * 70; ctx.moveTo(x, 280); ctx.lineTo(x + 50, 280); ctx.lineTo(x + 110, 170); ctx.lineTo(x + 60, 170); ctx.closePath(); ctx.fill(); });
      ctx.font = 'bold 84px Arial, sans-serif'; outline('RR', 256, 352, '#1b2766', null, 0);
    } else {
      ctx.font = 'italic bold 112px "Helvetica Neue", Arial, sans-serif';
      outline('Panigale V4', 512, 84, '#ffffff', '#5a0004', 6);
      // tricolore
      ctx.fillStyle = '#159a3c'; ctx.fillRect(110, 190, 100, 70); ctx.fillStyle = '#f2f2f2'; ctx.fillRect(210, 190, 100, 70); ctx.fillStyle = '#c00a12'; ctx.fillRect(310, 190, 100, 70);
      ctx.font = 'italic bold 84px Arial, sans-serif'; outline('V4', 256, 352, '#ffffff', '#5a0004', 5);
    }
    // number plate (Indian HSRP style, two lines)
    const px = 512, py = 160, pw = 512, ph = 256;
    ctx.fillStyle = '#f7f7f2'; roundRect(ctx, px + 6, py + 6, pw - 12, ph - 12, 22); ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = '#111'; roundRect(ctx, px + 14, py + 14, pw - 28, ph - 28, 16); ctx.stroke();
    ctx.fillStyle = '#1b3fa0'; ctx.fillRect(px + 26, py + 26, 52, ph - 52);
    ctx.save(); ctx.translate(px + 52, py + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Arial'; ctx.fillText('IND', 0, 0); ctx.restore();
    const parts = info.plate.split(' ');
    ctx.fillStyle = '#111'; ctx.font = 'bold 92px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(parts.slice(0, 3).join(' '), px + 288, py + 82, 400);
    ctx.font = 'bold 104px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(parts.slice(3).join(' '), px + 288, py + 182, 400);
  }, { wrap: false, anisotropy: 8 });
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.35, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
  _decalCache[id] = m; return m;
}
/** set UVs of a plane-like geometry (uv in [0,1]) into atlas rect (pixels in 1024x512) */
function uvRect(g, x, y, w, h) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / 1024, 1 - (y + (1 - uv.getY(i)) * h) / 512);
  uv.needsUpdate = true; return g;
}

// ------------------------------------------------------------------------------------------------ wheels
function tireProfile(R, W) {
  const rr = 0.2159, rc = 0.6 * W, aMax = Math.asin(0.45 / 0.6);
  const pts = [];
  pts.push(new THREE.Vector2(rr + 0.004, -0.41 * W));
  pts.push(new THREE.Vector2(rr + 0.016, -0.46 * W));
  pts.push(new THREE.Vector2(lerp(rr, R, 0.45), -0.50 * W));
  pts.push(new THREE.Vector2(lerp(rr, R, 0.72), -0.485 * W));
  const n = 8;
  for (let i = 0; i <= n; i++) { const a = -aMax + 2 * aMax * i / n; pts.push(new THREE.Vector2(R - rc * (1 - Math.cos(a)), rc * Math.sin(a))); }
  pts.push(new THREE.Vector2(lerp(rr, R, 0.72), 0.485 * W));
  pts.push(new THREE.Vector2(lerp(rr, R, 0.45), 0.50 * W));
  pts.push(new THREE.Vector2(rr + 0.016, 0.46 * W));
  pts.push(new THREE.Vector2(rr + 0.004, 0.41 * W));
  return pts;
}
const latheX = (pts, seg) => { const g = new THREE.LatheGeometry(pts, seg); g.rotateZ(-Math.PI / 2); return g; };

/** builds a wheel into bucket 'bucket' centred at origin, axle along X */
function buildWheel(P, bucket, spec, o) {
  const { R, W, rimHW } = o;
  // tyre
  P.add(bucket, latheX(tireProfile(R, W), 36), '#151515', 0.86, 0);
  // tread grooves (sport pattern) — thin dark strips just above the crown, alternating sides
  const grooves = 14;
  for (let i = 0; i < grooves; i++) {
    const phi = i / grooves * Math.PI * 2; const sgn = i % 2 ? 1 : -1;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4; const ax = sgn * lerp(0.06, 0.36, t) * W; const ang = phi + t * 0.32;
      const rcrown = R - 0.6 * W * (1 - Math.cos(Math.asin(clamp(ax / (0.6 * W), -0.99, 0.99)))) + 0.0012;
      pts.push([ax, ang, rcrown]);
    }
    const pos = [];
    for (let k = 0; k < 4; k++) {
      const [x0, a0, r0] = pts[k], [x1, a1, r1] = pts[k + 1]; const hw = 0.0035;
      const P0 = [x0 - hw, r0 * Math.cos(a0), r0 * Math.sin(a0)], P1 = [x0 + hw, r0 * Math.cos(a0), r0 * Math.sin(a0)];
      const P2 = [x1 + hw, r1 * Math.cos(a1), r1 * Math.sin(a1)], P3 = [x1 - hw, r1 * Math.cos(a1), r1 * Math.sin(a1)];
      pos.push(...P0, ...P1, ...P2, ...P0, ...P2, ...P3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    // ensure outward
    const n0 = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, 0); const p0 = new THREE.Vector3(0, pos[1], pos[2]);
    if (n0.dot(p0) < 0) flipWinding(g);
    P.add(bucket, g, '#070707', 0.95, 0);
  }
  // rim: lips + inner barrel
  const hw = rimHW;
  const rim = [[0.2262, hw], [0.2215, hw + 0.001], [0.2010, hw - 0.002], [0.1975, hw * 0.55], [0.1955, 0], [0.1975, -hw * 0.55], [0.2010, -hw + 0.002], [0.2215, -hw - 0.001], [0.2262, -hw]].map(([r, y]) => new THREE.Vector2(r, y));
  P.add(bucket, latheX(rim, 40), spec.wheel[0], spec.wheel[1], spec.wheel[2]);
  // rim stripe (outer lip edge colour)
  for (const s of [1, -1]) {
    const st = [[0.2268, s * (hw + 0.0006)], [0.2150, s * (hw + 0.0006)]].map(([r, y]) => new THREE.Vector2(r, y));
    if (s < 0) st.reverse();
    P.add(bucket, latheX(st, 40), spec.rimStripe, 0.3, 0.2);
  }
  // hub
  P.add(bucket, xf(new THREE.CylinderGeometry(0.046, 0.046, hw * 2 + 0.02, 20), [0, 0, 0], [0, 0, Math.PI / 2]), spec.wheel[0], 0.3, 0.6);
  P.add(bucket, xf(new THREE.CylinderGeometry(0.02, 0.02, hw * 2 + 0.05, 12), [0, 0, 0], [0, 0, Math.PI / 2]), '#9a9da2', 0.3, 1);
  // spokes
  const spokeShape = (rIn, rOut, wIn, wOut, curve = 0) => {
    const s = new THREE.Shape();
    s.moveTo(rIn, -wIn / 2);
    s.quadraticCurveTo((rIn + rOut) / 2, -wOut / 2 + curve, rOut, -wOut / 2);
    s.lineTo(rOut, wOut / 2);
    s.quadraticCurveTo((rIn + rOut) / 2, wOut / 2 + curve, rIn, wIn / 2);
    s.closePath(); return s;
  };
  const addSpoke = (shape, phi, depth, xOff) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 5 });
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2);   // radial X->Z, axial Z->-X
    g.rotateX(phi); g.translate(xOff, 0, 0);
    P.add(bucket, g, spec.wheel[0], spec.wheel[1], spec.wheel[2]);
  };
  if (o.spokes === 'split6') {
    for (let i = 0; i < 3; i++) for (const d of [-0.18, 0.18]) addSpoke(spokeShape(0.04, 0.198, 0.026, 0.016, 0.006 * Math.sign(d)), i * Math.PI * 2 / 3 + d, 0.016, 0);
  } else if (o.spokes === 'five') {
    for (let i = 0; i < 5; i++) addSpoke(spokeShape(0.04, 0.198, 0.034, 0.02, 0.004), i * Math.PI * 2 / 5, 0.02, 0);
  } else {
    for (let i = 0; i < 3; i++) addSpoke(spokeShape(0.04, 0.198, 0.05, 0.035, 0.018), i * Math.PI * 2 / 3, 0.022, 0);
  }
  // discs
  for (const d of o.discs || []) {
    const t = 0.0028;
    const ring = [[d.rOut, t], [d.rIn, t], [d.rIn, -t], [d.rOut, -t], [d.rOut, t]].map(([r, y]) => new THREE.Vector2(r, y));
    P.add(bucket, xf(latheX(ring, 40), [d.x, 0, 0]), '#9b9ea3', 0.38, 1);
    // drilled-hole impression: dark dots ring
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2 + (i % 2) * 0.05; const rr = lerp(d.rIn, d.rOut, i % 2 ? 0.42 : 0.68);
      const dot = new THREE.CircleGeometry(0.0042, 6); dot.rotateY(Math.PI / 2 * Math.sign(d.x || 1));
      dot.translate(d.x + Math.sign(d.x || 1) * (t + 0.0004), rr * Math.cos(a), rr * Math.sin(a));
      P.add(bucket, dot, '#202224', 0.6, 0.8);
    }
    // carrier (6 arms + inner ring) & floating buttons
    const cr = d.carrier;
    P.add(bucket, xf(latheX([[0.068, 0.003], [0.05, 0.003], [0.05, -0.003], [0.068, -0.003], [0.068, 0.003]].map(([r, y]) => new THREE.Vector2(r, y)), 16), [d.x, 0, 0]), cr[0], cr[1], cr[2]);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2; const len = d.rIn - 0.062;
      const g = new THREE.BoxGeometry(0.006, len, 0.016); g.translate(0, 0.062 + len / 2, 0); g.rotateX(a); g.translate(d.x, 0, 0);
      P.add(bucket, g, cr[0], cr[1], cr[2]);
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2; const g = new THREE.CylinderGeometry(0.0065, 0.0065, 0.011, 5);
      g.rotateZ(Math.PI / 2); g.translate(d.x, d.rIn * Math.cos(a), d.rIn * Math.sin(a));
      P.add(bucket, g, '#c0c3c7', 0.25, 1);
    }
  }
  // sprocket
  if (o.sprocket) {
    const { x, teeth, r } = o.sprocket; const s = new THREE.Shape(); const rRoot = r - 0.008;
    for (let i = 0; i < teeth; i++) {
      const a0 = i / teeth * Math.PI * 2, a1 = (i + 0.3) / teeth * Math.PI * 2, a2 = (i + 0.55) / teeth * Math.PI * 2, a3 = (i + 0.85) / teeth * Math.PI * 2;
      const P0 = [rRoot * Math.cos(a0), rRoot * Math.sin(a0)], P1 = [r * Math.cos(a1), r * Math.sin(a1)], P2 = [r * Math.cos(a2), r * Math.sin(a2)], P3 = [rRoot * Math.cos(a3), rRoot * Math.sin(a3)];
      if (i === 0) s.moveTo(...P0); else s.lineTo(...P0);
      s.lineTo(...P1); s.lineTo(...P2); s.lineTo(...P3);
    }
    s.closePath();
    for (let i = 0; i < 5; i++) { const h = new THREE.Path(); const a = i / 5 * Math.PI * 2; h.absellipse(0.06 * Math.cos(a), 0.06 * Math.sin(a), 0.016, 0.016, 0, Math.PI * 2, false); s.holes.push(h); }
    const inner = new THREE.Path(); inner.absarc(0, 0, 0.03, 0, Math.PI * 2, true); s.holes.push(inner);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -0.003); g.rotateY(-Math.PI / 2); g.translate(x, 0, 0);
    P.add(bucket, g, o.sprocket.color || '#3a3b3e', 0.4, 0.9);
  }
}

// ------------------------------------------------------------------------------------------------ front end (steer)
function buildFrontEnd(P, spec, id) {
  // everything in bike coordinates; bucket 'steer' (uber) + 'steerPaint'
  const at = (d, x = 0) => FC.clone().addScaledVector(AX, d).add(V(x, 0, 0));
  const fx = 0.105;
  for (const s of [1, -1]) {
    // stanchion (inner, lower)
    P.add('steer', alongY(cylY(0.0225, 0.0225, 0.33, 18), at(0.0, s * fx), at(0.33, s * fx)), spec.forkInner[0], spec.forkInner[1], spec.forkInner[2]);
    // outer tube (upper)
    P.add('steer', alongY(cylY(0.0285, 0.0285, 0.44, 20), at(0.27, s * fx), at(0.71, s * fx)), spec.fork[0], spec.fork[1], spec.fork[2]);
    P.add('steer', alongY(cylY(0.031, 0.029, 0.03, 20), at(0.265, s * fx), at(0.295, s * fx)), spec.fork[0], spec.fork[1] * 0.8, spec.fork[2]);
    // fork foot / axle clamp
    const foot = rbox(0.05, 0.15, 0.065, 0.012); foot.translate(0, 0.045, 0.0); foot.rotateX(-RAKE);
    foot.translate(s * fx, FC.y, FC.z + 0.005);
    P.add('steer', foot, '#141415', 0.4, 0.7);
    // radial caliper mount + caliper
    const ca = -1.78; // angle around axle (from +Y toward +Z)
    const cr = 0.142;
    const cal = rbox(0.038, 0.105, 0.05, 0.012); cal.rotateX(-ca);
    cal.translate(s * 0.072, FC.y + cr * Math.cos(ca), FC.z + cr * Math.sin(ca));
    P.add('steer', cal, spec.caliper[0], spec.caliper[1], spec.caliper[2]);
    // fork cap / preload adjuster
    P.add('steer', alongY(cylY(0.022, 0.02, 0.022, 14), at(0.71, s * fx), at(0.732, s * fx)), '#a8abb0', 0.25, 1);
    P.add('steer', alongY(cylY(0.009, 0.009, 0.014, 8), at(0.732, s * fx), at(0.746, s * fx)), spec.caliper[0], 0.3, 0.8);
    // clip-on: clamp ring + bar + grip + bar end
    const clampP = at(0.60, s * fx);
    P.add('steer', alongY(cylY(0.036, 0.036, 0.045, 16), at(0.575, s * fx), at(0.62, s * fx)), '#17181a', 0.35, 0.8);
    const barEnd = V(s * 0.362, 0.917, 0.383);
    P.add('steer', alongY(cylY(0.011, 0.011, clampP.distanceTo(barEnd), 10), clampP, barEnd), '#1a1b1d', 0.35, 0.8);
    const gripA = clampP.clone().lerp(barEnd, 0.52), gripB = clampP.clone().lerp(barEnd, 0.98);
    P.add('steer', alongY(cylY(0.017, 0.017, gripA.distanceTo(gripB), 14), gripA, gripB), '#1c1c1c', 0.9, 0);
    P.add('steer', alongY(cylY(0.016, 0.019, 0.022, 14), barEnd, barEnd.clone().add(V(s * 0.02, 0.004, -0.004))), '#c4c7cb', 0.25, 1);
    // lever (brake on right, clutch on left) in front of the grip
    const lv0 = clampP.clone().lerp(barEnd, 0.40).add(V(0, 0.002, 0.03));
    const lv1 = clampP.clone().lerp(barEnd, 0.96).add(V(0, -0.012, 0.07));
    P.add('steer', alongY(cylY(0.0065, 0.0045, lv0.distanceTo(lv1), 8), lv0, lv1), '#b3b6ba', 0.3, 1);
    // master cylinder / switchgear
    const sw = rbox(0.05, 0.045, 0.05, 0.012); sw.translate(...clampP.clone().lerp(barEnd, 0.38).toArray());
    P.add('steer', sw, '#121213', 0.5, 0.2);
    if (s < 0) { // brake fluid reservoir on right
      const res = new THREE.CylinderGeometry(0.016, 0.016, 0.04, 14); res.translate(...clampP.clone().lerp(barEnd, 0.3).add(V(0, 0.045, -0.01)).toArray());
      P.add('steer', res, '#3a3027', 0.2, 0.0);
    }
  }
  // triple clamps
  const tc = rbox(0.30, 0.03, 0.09, 0.012); tc.translate(0, 0, -0.02); tc.rotateX(-RAKE); tc.translate(...at(0.66).toArray());
  P.add('steer', tc, spec.clamp[0], spec.clamp[1], spec.clamp[2]);
  const bc = rbox(0.29, 0.04, 0.085, 0.012); bc.translate(0, 0, -0.018); bc.rotateX(-RAKE); bc.translate(...at(0.52).toArray());
  P.add('steer', bc, '#18191a', 0.4, 0.7);
  P.add('steer', alongY(cylY(0.024, 0.024, 0.02, 14), at(0.675), at(0.695)), '#c9ccd0', 0.2, 1);
  // axle
  P.add('steer', xf(new THREE.CylinderGeometry(0.014, 0.014, 0.25, 12), [0, FC.y, FC.z], [0, 0, Math.PI / 2]), '#b9bcc0', 0.3, 1);
  // front fender (painted) — bent strip over the tyre
  const fender = [];
  {
    const R0 = RF + 0.022; const a0 = -0.40, a1 = 1.05; const nA = 18, nX = 8; const hw = 0.06;
    const pos = [], idx = [];
    for (let i = 0; i <= nA; i++) {
      const a = lerp(a0, a1, i / nA);
      for (let j = 0; j <= nX; j++) {
        const u = j / nX * 2 - 1; const x = u * hw * (1 - 0.15 * Math.max(0, (i / nA - 0.6) / 0.4));
        const r = R0 - 0.016 * u * u + 0.003 * (1 - u * u);
        pos.push(x, FC.y + r * Math.cos(a), FC.z + r * Math.sin(a));
      }
    }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nX; j++) { const a = i * (nX + 1) + j, b = a + 1, c = a + nX + 2, d = a + nX + 1; idx.push(a, d, b, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    // thickness: add an inner copy flipped
    const inner = g.clone(); const ip = inner.attributes.position;
    for (let i = 0; i < ip.count; i++) { const v = V(ip.getX(i), ip.getY(i) - FC.y, ip.getZ(i) - FC.z); const L = Math.hypot(v.y, v.z); const k = (L - 0.006) / L; ip.setXYZ(i, v.x, FC.y + v.y * k, FC.z + v.z * k); }
    flipWinding(inner);
    fender.push(g, inner);
  }
  for (const g of fender) P.add('steerPaint', g);
  // fender mounts
  for (const s of [1, -1]) { const m = rbox(0.012, 0.06, 0.05, 0.004); m.translate(s * 0.08, FC.y + 0.2, FC.z + 0.05); m.rotateX(0); P.add('steer', m, '#141415', 0.5, 0.3); }
}

// ------------------------------------------------------------------------------------------------ main body / chassis
function buildChassis(P, spec, id, paintTmp) {
  // ---- painted lofts
  const body = loft(spec.body, { radial: 38, steps: 44 });
  const tank = loft(spec.tank, { radial: 30, steps: 22 });
  const tail = loft(spec.tail, { radial: 30, steps: 24 });
  paintTmp.push(body, tank, tail);
  P.add('paint', body); P.add('paint', tank); P.add('paint', tail);

  // ---- seat & pillion
  const seat = loft([
    { z: 0.000, cy: 0.836, w: 0.090, ht: 0.010, hb: 0.03, nt: 3 },
    { z: -0.060, cy: 0.826, w: 0.128, ht: 0.020, hb: 0.04, nt: 3.2 },
    { z: -0.180, cy: 0.811, w: 0.145, ht: 0.024, hb: 0.045, nt: 3.4 },
    { z: -0.300, cy: 0.820, w: 0.150, ht: 0.028, hb: 0.05, nt: 3.4 },
    { z: -0.355, cy: 0.836, w: 0.130, ht: 0.028, hb: 0.05, nt: 3 },
    { z: -0.372, cy: 0.845, w: 0.080, ht: 0.015, hb: 0.03 },
  ], { radial: 22, steps: 12 });
  P.add('uber', seat, '#1e1e21', 0.95, 0);
  if (spec.pillion === 'pad') {
    const pad = loft([
      { z: -0.40, cy: 0.905, w: 0.06, ht: 0.01, hb: 0.02 },
      { z: -0.43, cy: 0.912, w: 0.11, ht: 0.022, hb: 0.03, nt: 3 },
      { z: -0.56, cy: 0.935, w: 0.10, ht: 0.024, hb: 0.03, nt: 3 },
      { z: -0.64, cy: 0.95, w: 0.07, ht: 0.018, hb: 0.03 },
      { z: -0.66, cy: 0.953, w: 0.03, ht: 0.008, hb: 0.015 },
    ], { radial: 18, steps: 9 });
    P.add('uber', pad, '#1e1e21', 0.95, 0);
  }

  // ---- windscreen (open loft)
  const screen = loft([
    { z: 0.868, cy: 0.858, w: 0.120, ht: 0.020, hb: 0.02 },
    { z: 0.800, cy: 0.893, w: 0.160, ht: 0.040, hb: 0.02 },
    { z: 0.710, cy: 0.952, w: 0.176, ht: 0.056, hb: 0.02 },
    { z: 0.630, cy: 1.020, w: 0.162, ht: 0.064, hb: 0.02 },
    { z: 0.565, cy: 1.070, w: 0.132, ht: 0.056, hb: 0.02 },
  ], { radial: 22, steps: 14, theta0: -0.12, theta1: Math.PI + 0.12 });
  P.add('glass', screen);

  // ---- instrument TFT
  const tft = rbox(0.16, 0.10, 0.035, 0.008); tft.rotateX(45 * DEG); tft.translate(0, 0.975, 0.63);
  P.add('uber', tft, '#0e0e0f', 0.5, 0.1);
  const scr = new THREE.PlaneGeometry(0.14, 0.08); scr.rotateY(Math.PI); scr.rotateX(45 * DEG); scr.translate(0, 0.975 + 0.0125, 0.63 - 0.0125);
  P.add('lights', scr, '#0f2035');
  const bar = new THREE.PlaneGeometry(0.11, 0.012); bar.rotateY(Math.PI); bar.rotateX(45 * DEG); bar.translate(0, 0.975 + 0.035, 0.63 - 0.037);
  P.add('lights', bar, '#3fd06a');
  const bar2 = new THREE.PlaneGeometry(0.03, 0.03); bar2.rotateY(Math.PI); bar2.rotateX(45 * DEG); bar2.translate(0.03, 0.975 + 0.01, 0.63 - 0.016);
  P.add('lights', bar2, '#e8eef8');

  // ---- frame spars (visible behind fairing at knee level)
  for (const s of [1, -1]) {
    const spar = loft([
      { z: 0.20, cy: 0.77, w: 0.022, ht: 0.06, hb: 0.06, nt: 4, nb: 4 },
      { z: 0.00, cy: 0.66, w: 0.024, ht: 0.075, hb: 0.08, nt: 4, nb: 4 },
      { z: -0.12, cy: 0.52, w: 0.026, ht: 0.075, hb: 0.08, nt: 4, nb: 4 },
      { z: -0.16, cy: 0.48, w: 0.02, ht: 0.05, hb: 0.06, nt: 4, nb: 4 },
    ], { radial: 12, steps: 8 });
    spar.translate(s * 0.132, 0, 0);
    P.add('uber', spar, spec.frame[0], spec.frame[1], spec.frame[2]);
    // swingarm pivot boss
    P.add('uber', xf(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 16), [s * 0.15, PIVOT.y, PIVOT.z], [0, 0, Math.PI / 2]), spec.frame[0], 0.3, 0.9);
    P.add('uber', xf(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 6), [s * 0.168, PIVOT.y, PIVOT.z], [0, 0, Math.PI / 2]), '#b9bcc0', 0.3, 1);
  }

  // ---- engine
  const eng = rbox(0.30, 0.30, 0.38, 0.05, 2); eng.translate(0, 0.38, 0.06);
  P.add('uber', eng, spec.engine[0], spec.engine[1], spec.engine[2]);
  const sump = rbox(0.2, 0.08, 0.26, 0.03); sump.translate(0, 0.21, 0.08);
  P.add('uber', sump, spec.engine[0], 0.55, 0.4);
  // side covers (clutch right, alternator left) peeking behind fairing
  for (const s of [1, -1]) {
    const cov = new THREE.SphereGeometry(0.075, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2); cov.scale(1, 0.3, 1); cov.rotateZ(-s * Math.PI / 2);
    cov.translate(s * 0.14, 0.36, -0.04 + (s > 0 ? 0.02 : 0));
    P.add('uber', cov, spec.cover[0], spec.cover[1], spec.cover[2]);
  }
  // countershaft sprocket cover (left)
  const csc = rbox(0.03, 0.11, 0.12, 0.02); csc.translate(0.165, 0.43, -0.07); P.add('uber', csc, '#151516', 0.5, 0.3);
  // inner infill under seat (airbox/subframe area)
  const infill = rbox(0.10, 0.16, 0.30, 0.045, 2); infill.translate(0, 0.60, -0.24); P.add('uber', infill, '#121213', 0.75, 0.1);
  // subframe rails
  for (const s of [1, -1]) P.add('uber', alongY(cylY(0.012, 0.012, 0.62, 8), V(s * 0.1, 0.6, -0.1), V(s * 0.085, 0.86, -0.72)), spec.frame[0], 0.4, 0.8);

  // ---- rear suspension (shock + spring) visible under the seat
  {
    const sx = spec.swingarmType === 'single' ? 0.075 : 0; const a = V(sx, 0.52, -0.22), b = V(sx, 0.74, -0.12);
    P.add('uber', alongY(cylY(0.022, 0.022, a.distanceTo(b), 14), a, b), '#b9a35a', 0.3, 1);
    const coils = 6, segs = 48, rr = 0.033, len = a.distanceTo(b) * 0.62; const pts = [];
    for (let i = 0; i <= segs; i++) { const t = i / segs; const ang = t * coils * Math.PI * 2; pts.push(V(rr * Math.cos(ang), len * 0.18 + t * len, rr * Math.sin(ang))); }
    const spring = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, 0.0065, 5, false);
    P.add('uber', alongY(spring, a, b), spec.shock, 0.35, 0.3);
  }

  // ---- swingarm
  if (spec.swingarmType === 'double') {
    for (const s of [1, -1]) {
      const p0 = V(s * 0.125, PIVOT.y, PIVOT.z), p1 = V(s * 0.118, RC.y, RC.z - 0.02);
      const arm = loft([
        { z: 0, cy: 0, w: 0.026, ht: 0.075, hb: 0.075, nt: 4, nb: 4 },
        { z: 0.25, cy: -0.008, w: 0.024, ht: 0.062, hb: 0.07, nt: 4, nb: 4 },
        { z: p0.distanceTo(p1), cy: 0, w: 0.02, ht: 0.04, hb: 0.04, nt: 4, nb: 4 },
      ], { radial: 12, steps: 8 });
      alongZ(arm, p0, p1);
      P.add('uber', arm, spec.swingarm[0], spec.swingarm[1], spec.swingarm[2]);
      // axle adjuster block
      const blk = rbox(0.03, 0.05, 0.07, 0.008); blk.translate(s * 0.118, RC.y, RC.z);
      P.add('uber', blk, spec.swingarm[0], 0.3, 0.9);
    }
    // cross member + underbrace
    const cm = rbox(0.25, 0.05, 0.06, 0.015); cm.translate(0, PIVOT.y - 0.005, -0.27); P.add('uber', cm, spec.swingarm[0], spec.swingarm[1], spec.swingarm[2]);
    P.add('uber', xf(new THREE.CylinderGeometry(0.015, 0.015, 0.29, 10), [0, RC.y, RC.z], [0, 0, Math.PI / 2]), '#b9bcc0', 0.3, 1);
  } else {
    // single-sided arm on the LEFT (+X), wheel exposed on the right
    const p0 = V(0.115, PIVOT.y, PIVOT.z), p1 = V(0.13, RC.y, RC.z);
    const arm = loft([
      { z: 0, cy: 0, w: 0.03, ht: 0.075, hb: 0.08, nt: 3.5, nb: 3.5 },
      { z: 0.2, cy: -0.01, w: 0.034, ht: 0.075, hb: 0.085, nt: 3.5, nb: 3.5 },
      { z: 0.45, cy: 0.0, w: 0.034, ht: 0.065, hb: 0.07, nt: 3.5, nb: 3.5 },
      { z: p0.distanceTo(p1) - 0.03, cy: 0, w: 0.032, ht: 0.07, hb: 0.07, nt: 3, nb: 3 },
    ], { radial: 20, steps: 14 });
    alongZ(arm, p0, p1);
    P.add('uber', arm, spec.swingarm[0], spec.swingarm[1], spec.swingarm[2]);
    // eccentric hub housing
    P.add('uber', xf(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 28), [0.13, RC.y, RC.z], [0, 0, Math.PI / 2]), '#2a2b2e', 0.3, 0.9);
    P.add('uber', xf(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 14), [0.06, RC.y, RC.z], [0, 0, Math.PI / 2]), '#b9bcc0', 0.3, 1);
    const brace = rbox(0.1, 0.06, 0.07, 0.02); brace.translate(0.06, PIVOT.y - 0.01, -0.22); P.add('uber', brace, spec.swingarm[0], 0.4, 0.6);
  }
  // rear caliper & hanger
  {
    const cx = spec.swingarmType === 'single' ? 0.055 : -0.078; const a = -2.6, cr = 0.098;
    const cal = rbox(0.03, 0.07, 0.045, 0.01); cal.rotateX(-a); cal.translate(cx, RC.y + cr * Math.cos(a), RC.z + cr * Math.sin(a));
    P.add('uber', cal, spec.caliper[0], spec.caliper[1], spec.caliper[2]);
  }
  // chain (left side)
  {
    const x = 0.098; const f = V(x, 0.43, -0.07), fr = 0.04; const r = V(x, RC.y, RC.z), rr = 0.1;
    const runs = [[V(x, f.y + fr, f.z), V(x, r.y + rr, r.z)], [V(x, f.y - fr, f.z), V(x, r.y - rr, r.z)]];
    for (const [a, b] of runs) { const g = rbox(0.012, 0.009, a.distanceTo(b), 0.003, 1); g.translate(0, 0, a.distanceTo(b) / 2); alongZ(g, a, b); P.add('uber', g, spec.chain[0], spec.chain[1], spec.chain[2]); }
    const wrap = new THREE.TorusGeometry(rr + 0.002, 0.005, 6, 28, Math.PI); wrap.rotateY(Math.PI / 2); wrap.rotateX(Math.PI / 2 + Math.PI / 2);
    wrap.translate(x, RC.y, RC.z); P.add('uber', wrap, spec.chain[0], spec.chain[1], spec.chain[2]);
    // chain guard
    const cg = rbox(0.006, 0.02, 0.28, 0.003, 1); cg.translate(x + 0.012, f.y + fr + 0.022, -0.27); cg.rotateX(0.0); P.add('uber', cg, '#151516', 0.5, 0.2);
  }
  // hugger (rear fender) over rear tyre
  {
    const pos = [], idx = []; const R0 = RR + 0.03, a0 = -0.15, a1 = 0.95, nA = 12, nX = 6, hw = 0.07;
    for (let i = 0; i <= nA; i++) { const a = lerp(a0, a1, i / nA); for (let j = 0; j <= nX; j++) { const u = j / nX * 2 - 1; const r = R0 - 0.018 * u * u; pos.push(u * hw, RC.y + r * Math.cos(a), RC.z + r * Math.sin(a)); } }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nX; j++) { const a = i * (nX + 1) + j, b = a + 1, c = a + nX + 2, d = a + nX + 1; idx.push(a, d, b, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    P.add('uber', g, '#141415', 0.4, 0.1); P.add('uber', flipWinding(g.clone()), '#141415', 0.6, 0.1);
  }

  // ---- rearsets: pegs, heel plates, levers (peg = STANDARD_ANCHORS.peg*)
  for (const s of [1, -1]) {
    const pg = (s > 0 ? STANDARD_ANCHORS.pegL : STANDARD_ANCHORS.pegR), py = pg.y, pz = pg.z;
    const plate = rbox(0.012, 0.15, 0.12, 0.01); plate.rotateX(0.35); plate.translate(s * 0.15, py + 0.075, pz + 0.005);
    P.add('uber', plate, '#2c2e31', 0.3, 0.95);
    P.add('uber', alongY(cylY(0.011, 0.011, 0.085, 10), V(s * 0.155, py, pz), V(s * 0.24, py, pz)), '#b9bcc0', 0.45, 1);
    P.add('uber', alongY(cylY(0.0125, 0.0125, 0.05, 10), V(s * 0.185, py, pz), V(s * 0.235, py, pz)), '#8f9297', 0.6, 1);
    const heel = rbox(0.006, 0.07, 0.05, 0.004); heel.translate(s * 0.165, py + 0.04, pz - 0.035); P.add('uber', heel, '#1a1b1d', 0.4, 0.8);
    // gear lever (left) / brake lever (right)
    const l0 = V(s * 0.175, py + 0.01, pz + 0.01), l1 = V(s * 0.19, py - 0.03, pz + 0.13);
    P.add('uber', alongY(cylY(0.006, 0.005, l0.distanceTo(l1), 8), l0, l1), '#9a9da2', 0.35, 1);
    P.add('uber', alongY(cylY(0.008, 0.008, 0.04, 8), l1.clone(), l1.clone().add(V(s * 0.04, 0, 0))), '#9a9da2', 0.45, 1);
    // hanger strut from frame to plate
    P.add('uber', alongY(cylY(0.012, 0.012, 0.2, 8), V(s * 0.14, py + 0.12, pz + 0.04), V(s * 0.14, 0.52, -0.12)), '#2c2e31', 0.3, 0.95);
  }

  // ---- mirrors
  for (const s of [1, -1]) {
    const a = V(s * 0.17, 0.91, 0.665), b = V(s * 0.255, 0.958, 0.66);
    P.add('uber', alongY(cylY(0.008, 0.007, a.distanceTo(b), 8), a, b), '#141415', 0.4, 0.3);
    const h = new THREE.SphereGeometry(0.042, 14, 8); h.scale(1.3, 0.55, 0.7); h.translate(s * 0.282, 0.965, 0.66);
    if (spec.mirror === '#c00a12') P.add('paint', h); else P.add('uber', h, spec.mirror, 0.35, 0.2);
    const gl = new THREE.CircleGeometry(0.042, 16); gl.scale(1.17, 0.47, 1); gl.rotateY(Math.PI); gl.translate(s * 0.282, 0.965, 0.66 - 0.029);
    P.add('uber', gl, '#cfd6dd', 0.04, 1);
    if (id !== 'zx10r') { const ind = rbox(0.055, 0.008, 0.01, 0.003); ind.translate(s * 0.295, 0.955, 0.688); P.add('uber', ind, '#d28a1e', 0.25, 0); }
  }

  // ---- headlights / DRLs (projected onto nose)
  const bodyMesh = new THREE.Mesh(body, new THREE.MeshBasicMaterial()); bodyMesh.updateMatrixWorld();
  const front = (g) => { g.translate(0, 0, 1.2); return projectOnto(g, bodyMesh, V(0, 0, -1), 0.0025); };
  const both = (top, bot, n, color) => { for (const s of [1, -1]) { const T = top.map(([x, y]) => [s * x, y]), B = bot.map(([x, y]) => [s * x, y]); P.add('lights', front(strip(T, B, n)), color); } };
  if (spec.headlight === 'zx') {
    both([[0.04, 0.726], [0.09, 0.742], [0.142, 0.764]], [[0.037, 0.706], [0.09, 0.719], [0.132, 0.741]], 10, '#eaf4ff');
    both([[0.046, 0.72], [0.12, 0.746]], [[0.044, 0.714], [0.12, 0.74]], 6, '#ffffff');
    // indicators in fairing sides
    for (const s of [1, -1]) { const g = strip([[s * 0.145, 0.792], [s * 0.172, 0.802]], [[s * 0.145, 0.784], [s * 0.172, 0.792]], 3); P.add('uber', front(g), '#d28a1e', 0.25, 0); }
  } else if (spec.headlight === 'bmw') {
    both([[0.058, 0.776], [0.10, 0.791], [0.145, 0.806]], [[0.056, 0.766], [0.10, 0.779], [0.141, 0.794]], 10, '#f2f8ff');
    both([[0.066, 0.756], [0.13, 0.774]], [[0.066, 0.751], [0.13, 0.768]], 5, '#dfeeff');
  } else {
    both([[0.04, 0.773], [0.07, 0.786], [0.10, 0.791], [0.13, 0.786], [0.145, 0.778]], [[0.04, 0.766], [0.07, 0.778], [0.10, 0.782], [0.13, 0.778], [0.143, 0.771]], 12, '#ffffff');
    for (const s of [1, -1]) for (const x of [0.075, 0.112]) {
      const c = new THREE.CircleGeometry(0.011, 12); c.translate(s * x, 0.722 - (x - 0.075) * 0.15, 0); P.add('lights', front(c), '#e9f2ff');
    }
  }

  // ---- winglets
  const wing = (z0, z1, y, x0, span, chord, thick, dihedral) => {
    const g = new THREE.BufferGeometry(); // tapered thin wing from root (x0) outward
    const s2 = new THREE.Shape(); s2.moveTo(0, 0); s2.quadraticCurveTo(chord * 0.3, thick, chord, 0); s2.quadraticCurveTo(chord * 0.3, -thick * 0.4, 0, 0);
    const e = new THREE.ExtrudeGeometry(s2, { depth: span, bevelEnabled: false, curveSegments: 6 });
    // shape plane: x=chord(along -z), y=thickness; extrude along +z = span → map to (x span)
    const pos = e.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const cx = pos.getX(i), cy = pos.getY(i), sz = pos.getZ(i);
      const taper = 1 - 0.35 * (sz / span);
      pos.setXYZ(i, x0 + sz, y + cy + sz * Math.tan(dihedral), z1 - cx * taper);
    }
    e.computeVertexNormals(); return e;
  };
  const wingsFor = (list, paint) => {
    for (const w of list) for (const s of [1, -1]) {
      let g = wing(...w); if (s < 0) g = mirrorX(g);
      if (paint) P.add('paint', g); else P.add('uber', g, '#17181a', 0.32, 0.3);
    }
  };
  if (spec.winglet === 'zx') wingsFor([[0.58, 0.69, 0.68, 0.17, 0.055, 0.10, 0.008, -0.1]], false);
  else if (spec.winglet === 'bmw') {
    wingsFor([[0.50, 0.70, 0.66, 0.175, 0.07, 0.15, 0.01, -0.18]], false);
    for (const s of [1, -1]) { const ep = rbox(0.004, 0.05, 0.12, 0.003, 1); ep.translate(s * 0.247, 0.635, 0.61); P.add('uber', ep, '#17181a', 0.32, 0.3); }
  } else {
    wingsFor([[0.56, 0.70, 0.645, 0.165, 0.06, 0.13, 0.008, -0.05], [0.56, 0.69, 0.69, 0.17, 0.055, 0.11, 0.008, -0.05]], true);
    for (const s of [1, -1]) { const ep = rbox(0.004, 0.06, 0.13, 0.003, 1); ep.translate(s * 0.227, 0.668, 0.63); P.add('paint', ep); }
  }

  // ---- exhausts
  if (spec.exhaust === 'zx') {
    const pts = [V(-0.02, 0.21, 0.02), V(-0.09, 0.22, -0.12), V(-0.14, 0.31, -0.24)];
    P.add('uber', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.032, 10), '#8f8477', 0.3, 1);
    const a = V(-0.14, 0.31, -0.22), b = V(-0.168, 0.47, -0.60);
    const can = loft([
      { z: 0, cy: 0, w: 0.045, ht: 0.06, hb: 0.06, nt: 3.2, nb: 3.2 },
      { z: 0.04, cy: 0, w: 0.058, ht: 0.075, hb: 0.07, nt: 3.4, nb: 3.4 },
      { z: 0.32, cy: 0, w: 0.056, ht: 0.07, hb: 0.065, nt: 3.4, nb: 3.4 },
      { z: a.distanceTo(b), cy: 0, w: 0.05, ht: 0.062, hb: 0.058, nt: 3.2, nb: 3.2 },
    ], { radial: 20, steps: 10 });
    alongZ(can, a, b); P.add('uber', can, '#1b1c1e', 0.35, 0.6);
    const end = new THREE.CylinderGeometry(0.03, 0.036, 0.03, 18); end.translate(0, 0.015, 0); alongY(end, b.clone().lerp(a, 0.03), b.clone().lerp(a, -0.06));
    P.add('uber', end, '#c9ccd0', 0.18, 1);
  } else if (spec.exhaust === 'bmw') {
    const pts = [V(-0.02, 0.21, 0.02), V(-0.10, 0.22, -0.12), V(-0.145, 0.32, -0.22)];
    P.add('uber', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.032, 10), '#9a8f82', 0.3, 1);
    const a = V(-0.145, 0.32, -0.20), b = V(-0.172, 0.56, -0.50);
    const can = loft([
      { z: 0, cy: 0, w: 0.05, ht: 0.05, hb: 0.05, nt: 2.2, nb: 2.2 },
      { z: 0.05, cy: 0, w: 0.062, ht: 0.07, hb: 0.07, nt: 2.6, nb: 2.6 },
      { z: a.distanceTo(b), cy: 0, w: 0.058, ht: 0.066, hb: 0.066, nt: 2.6, nb: 2.6 },
    ], { radial: 20, steps: 10 });
    alongZ(can, a, b); P.add('uber', can, '#b4b6b9', 0.24, 1);
    const end = new THREE.CylinderGeometry(0.045, 0.06, 0.05, 18); end.translate(0, 0.025, 0); alongY(end, b.clone().lerp(a, 0.06), b.clone().lerp(a, -0.08));
    P.add('uber', end, '#151516', 0.35, 0.6);
    const hole = new THREE.CircleGeometry(0.03, 16); hole.translate(0, 0, 0); hole.rotateX(-Math.PI / 2); alongY(hole, b.clone().lerp(a, -0.081), b.clone().lerp(a, -0.2));
    P.add('uber', hole, '#050505', 0.9, 0);
  } else {
    // V4 underbelly box + twin right-side tips
    const box = loft([
      { z: 0.30, cy: 0.20, w: 0.08, ht: 0.04, hb: 0.03, nt: 3, nb: 3 },
      { z: 0.20, cy: 0.19, w: 0.15, ht: 0.06, hb: 0.05, nt: 3.5, nb: 3.5 },
      { z: -0.05, cy: 0.20, w: 0.16, ht: 0.065, hb: 0.055, nt: 3.5, nb: 3.5 },
      { z: -0.16, cy: 0.23, w: 0.13, ht: 0.05, hb: 0.045, nt: 3, nb: 3 },
      { z: -0.20, cy: 0.245, w: 0.06, ht: 0.03, hb: 0.03 },
    ], { radial: 28, steps: 16 });
    P.add('uber', box, '#121213', 0.45, 0.5);
    for (const dy of [0.0, 0.05]) {
      const a = V(-0.11, 0.21 + dy, -0.10), b = V(-0.175, 0.24 + dy * 1.1, -0.20);
      P.add('uber', alongY(cylY(0.024, 0.026, a.distanceTo(b), 16), a, b), '#bfc2c6', 0.2, 1);
      const h = new THREE.CircleGeometry(0.02, 14); h.rotateX(-Math.PI / 2); alongY(h, b.clone().add(V(-0.001, 0, -0.001)), b.clone().add(b.clone().sub(a)));
      P.add('uber', h, '#060606', 0.9, 0);
    }
    // rear cylinder bank head peeking under seat on right
    const head = rbox(0.24, 0.12, 0.14, 0.03); head.translate(0, 0.62, -0.10); P.add('uber', head, '#232427', 0.45, 0.6);
  }
  // headers in front of engine (visible through radiator gap)
  {
    const xs = spec.exhaust === 'v4' ? [-0.09, -0.03, 0.03, 0.09] : [-0.105, -0.035, 0.035, 0.105];
    for (const x of xs) {
      const pts = [V(x, 0.56, 0.30), V(x * 1.05, 0.44, 0.40), V(x * 0.9, 0.26, 0.36), V(x * 0.5, 0.2, 0.18), V(x * 0.2, 0.2, 0.02)];
      P.add('uber', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.019, 6), '#8f7e68', 0.32, 1);
    }
  }

  // ---- tail light / plate holder / indicators
  const tailBody = new THREE.Mesh(tail, new THREE.MeshBasicMaterial()); tailBody.updateMatrixWorld();
  const back = (g) => { g.rotateY(Math.PI); g.translate(0, 0, -1.3); return projectOnto(g, tailBody, V(0, 0, 1), 0.0025); };
  if (spec.tailLight === 'zx') {
    P.add('tail', back(strip([[0.05, 0.968], [0.0, 0.982], [-0.05, 0.968]], [[0.045, 0.955], [0.0, 0.962], [-0.045, 0.955]], 8)), '#ff2015');
    P.add('tail', back(strip([[0.012, 0.962], [-0.012, 0.962]], [[0.012, 0.935], [-0.012, 0.935]], 2)), '#ff2015');
  } else if (spec.tailLight === 'bmw') {
    P.add('tail', back(strip([[0.04, 0.972], [-0.04, 0.972]], [[0.036, 0.958], [-0.036, 0.958]], 6)), '#ff2015');
  } else {
    for (const s of [1, -1]) P.add('tail', back(strip([[s * 0.008, 0.978], [s * 0.05, 0.968]], [[s * 0.008, 0.970], [s * 0.046, 0.958]], 5)), '#ff2015');
  }
  {
    const hanger = loft([
      { z: -0.70, cy: 0.80, w: 0.05, ht: 0.012, hb: 0.012, nt: 3, nb: 3 },
      { z: -0.80, cy: 0.775, w: 0.06, ht: 0.012, hb: 0.014, nt: 3, nb: 3 },
      { z: -0.90, cy: 0.735, w: 0.055, ht: 0.012, hb: 0.016, nt: 3, nb: 3 },
      { z: -0.965, cy: 0.70, w: 0.05, ht: 0.012, hb: 0.016, nt: 3, nb: 3 },
    ], { radial: 14, steps: 8 });
    P.add('uber', hanger, '#121213', 0.5, 0.1);
    // plate (decal atlas region C) 0.2 x 0.1, tilted
    const plate = new THREE.PlaneGeometry(0.2, 0.1); uvRect(plate, 512, 160, 512, 256);
    plate.rotateY(Math.PI); plate.rotateX(-0.25); plate.translate(0, 0.652, -0.975);
    P.add('decal', plate);
    const back2 = new THREE.BoxGeometry(0.21, 0.11, 0.006); back2.rotateX(-0.25); back2.translate(0, 0.652, -0.971); P.add('uber', back2, '#111112', 0.5, 0.1);
    for (const s of [1, -1]) {
      const st = alongY(cylY(0.005, 0.005, 0.06, 6), V(s * 0.04, 0.72, -0.93), V(s * 0.1, 0.725, -0.925)); P.add('uber', st, '#111112', 0.5, 0.1);
      const ind = new THREE.SphereGeometry(0.014, 10, 8); ind.scale(1.6, 0.8, 1); ind.translate(s * 0.11, 0.725, -0.925); P.add('uber', ind, '#d28a1e', 0.2, 0);
    }
  }

  // ---- decals (projected onto fairing/tail sides)
  const decalTarget = new THREE.Mesh(mergeGeometries([body.toNonIndexed(), tail.toNonIndexed()]), new THREE.MeshBasicMaterial()); decalTarget.updateMatrixWorld();
  const sideDecal = (rect, zc, yc, w, h, tilt = 0) => {
    for (const s of [1, -1]) {
      const g = new THREE.PlaneGeometry(w, h, 16, 4); uvRect(g, ...rect);
      g.rotateZ(tilt);
      g.rotateY(s * Math.PI / 2); g.translate(s * 0.6, yc, zc);
      projectOnto(g, decalTarget, V(-s, 0, 0), 0.002);
      P.add('decal', g);
    }
  };
  if (id === 'zx10r') { sideDecal([0, 0, 1024, 160], 0.30, 0.64, 0.30, 0.047, 0.12); sideDecal([0, 160, 512, 128], -0.66, 0.875, 0.16, 0.04, 0.2); }
  else if (id === 's1000rr') { sideDecal([0, 0, 1024, 160], 0.20, 0.66, 0.28, 0.044, 0.0); sideDecal([0, 160, 512, 128], -0.55, 0.85, 0.12, 0.03, 0.2); }
  else { sideDecal([0, 0, 1024, 160], 0.40, 0.64, 0.27, 0.042, 0.1); }

  return { bodyMesh, tailBody };
}

// ------------------------------------------------------------------------------------------------ side stand (parked)
function buildSideStand() {
  const P = new Parts();
  const a = V(0.13, 0.33, -0.13), b = V(0.31, 0.02, -0.02);
  P.add('u', alongY(cylY(0.014, 0.011, a.distanceTo(b), 8), a, b), '#1a1b1c', 0.45, 0.7);
  const foot = rbox(0.04, 0.012, 0.05, 0.004); foot.translate(b.x, b.y, b.z); P.add('u', foot, '#1a1b1c', 0.5, 0.6);
  return P.mesh('u', uberMaterial());
}

// ------------------------------------------------------------------------------------------------ createBike
const _paintMats = {};
export function createBike(id = 'zx10r') {
  if (!SPEC[id]) id = 'zx10r';
  const spec = SPEC[id];
  const P = new Parts();
  const paintTmp = [];
  buildChassis(P, spec, id, paintTmp);
  buildFrontEnd(P, spec, id);
  const paintMat = _paintMats[id] ||= makePaintMaterial(id, LIVERY[id], id === 'zx10r' ? { metalness: 0.12, roughness: 0.32 } : {});
  const uber = uberMaterial();
  const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // wheels
  const PF = new Parts(), PR = new Parts();
  buildWheel(PF, 'w', spec, { R: RF, W: 0.12, rimHW: 0.046, spokes: spec.spokes, discs: [{ x: 0.072, rOut: 0.165, rIn: 0.12, carrier: spec.caliper[0] === '#1d4fa8' ? ['#b9bcc0', 0.3, 1] : ['#c9a227', 0.3, 1] }, { x: -0.072, rOut: 0.165, rIn: 0.12, carrier: spec.caliper[0] === '#1d4fa8' ? ['#b9bcc0', 0.3, 1] : ['#c9a227', 0.3, 1] }] });
  const rearDiscX = spec.swingarmType === 'single' ? 0.058 : -0.078;
  buildWheel(PR, 'w', spec, { R: RR, W: 0.195, rimHW: 0.077, spokes: spec.spokes, discs: [{ x: rearDiscX, rOut: 0.11, rIn: 0.082, carrier: ['#1c1c1d', 0.4, 0.6] }], sprocket: { x: 0.098, teeth: 42, r: 0.104, color: id === 'zx10r' ? '#c9a227' : '#3a3b3e' } });
  if (spec.swingarmType === 'single') {
    // big centre-lock nut on the exposed right side
    PR.add('w', xf(new THREE.CylinderGeometry(0.03, 0.034, 0.03, 6), [-0.095, 0, 0], [0, 0, Math.PI / 2]), '#c00a12', 0.3, 0.6);
  }

  const group = new THREE.Group(); group.name = 'bike-' + id;
  const body = new THREE.Group(); body.name = 'body'; group.add(body);
  for (const [b, m] of [['paint', paintMat], ['uber', uber], ['glass', glassMaterial()], ['lights', lightsMaterial()], ['decal', decalMaterial(id)], ['tail', tailMat]]) {
    const mesh = P.mesh(b, m, { cast: !['glass', 'lights', 'decal', 'tail'].includes(b), receive: b !== 'lights' && b !== 'tail' });
    if (mesh) { if (b === 'glass') mesh.renderOrder = 2; body.add(mesh); }
  }

  // steering assembly: base at front axle aligned with steering axis, yaw child, front-end content in bike coords
  const steerBase = new THREE.Group(); steerBase.position.copy(FC); steerBase.rotation.x = -RAKE; group.add(steerBase);
  const steer = new THREE.Group(); steer.name = 'steer'; steerBase.add(steer);
  const frontContent = new THREE.Group(); // inverse of steerBase
  steerBase.updateMatrix(); const inv = steerBase.matrix.clone().invert(); inv.decompose(frontContent.position, frontContent.quaternion, frontContent.scale);
  steer.add(frontContent);
  for (const [b, m] of [['steer', uber], ['steerPaint', paintMat]]) { const mesh = P.mesh(b, m); if (mesh) frontContent.add(mesh); }
  const frontWheel = new THREE.Group(); frontWheel.name = 'frontWheel'; frontWheel.position.copy(FC); frontContent.add(frontWheel);
  const fwm = PF.mesh('w', uber); frontWheel.add(fwm);
  const rearWheel = new THREE.Group(); rearWheel.name = 'rearWheel'; rearWheel.position.copy(RC); group.add(rearWheel);
  rearWheel.add(PR.mesh('w', uber));

  // side stand (hidden unless parked)
  const stand = buildSideStand(); stand.visible = false; group.add(stand);

  const anchors = {}; for (const k of Object.keys(STANDARD_ANCHORS)) anchors[k] = STANDARD_ANCHORS[k].clone();

  let steerCur = 0, brakeCur = 0, parked = false;
  const setTail = (b) => tailMat.color.setRGB(0.55 + 2.6 * b, 0.25 + 0.05 * b, 0.25 + 0.04 * b);
  setTail(0);

  const bike = {
    id, group, info: BIKE_INFO[id],
    parts: { frontWheel, rearWheel, steer, body, steerBase, sideStand: stand },
    anchors, wheelRadius: 0.31, wheelRadiusFront: RF, wheelRadiusRear: RR, wheelbase: 1.42,
    /** speed m/s, steer -1..1 (+1 = turning right), brake 0..1, throttle 0..1 */
    update(dt, time, s = {}) {
      const speed = s.speed || 0;
      frontWheel.rotation.x = (frontWheel.rotation.x + speed / RF * dt) % (Math.PI * 2);
      rearWheel.rotation.x = (rearWheel.rotation.x + speed / RR * dt) % (Math.PI * 2);
      const maxA = lerp(0.42, 0.035, smoothstep(1.5, 28, Math.abs(speed)));
      steerCur = damp(steerCur, -(s.steer || 0) * maxA, 10, dt);
      steer.rotation.y = parked ? 0.5 : steerCur;
      const br = clamp(s.brake || 0, 0, 1); brakeCur = damp(brakeCur, br, 18, dt); setTail(brakeCur);
    },
    /** parked on side stand (lobby): leans the whole group 9° to the left and turns the bars */
    setParked(on) { parked = !!on; stand.visible = parked; group.rotation.z = parked ? -0.155 : 0; steer.rotation.y = parked ? 0.5 : 0; },
    setBrakeLight(v) { brakeCur = clamp(v, 0, 1); setTail(brakeCur); },
    dispose() { group.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); tailMat.dispose(); },
  };
  group.userData.bike = bike;
  return bike;
}

// Animals of the Ramnagar → Ranikhet road: zebu cows, Bengal tiger, cobra/python, langur/rhesus monkeys,
// chital deer, pariah dog, Asian elephant, peacock and bird flocks.
//
// Every animal is ONE SkinnedMesh (1 draw call, vertex colours + a procedural fur/pattern shader) whose bones are
// animated procedurally (idle, walk cycles, special poses). Geometry templates are cached and shared between
// instances; only bones/skeletons are per instance.
//
// All models face +Z, left side = +X, origin on the ground at the centre of the footprint (monkeys: sitting surface).
// Factories return { group, update(dt, time, state), setPose?(p), walkSpeed?, ... }.  For walking animals the game
// moves `group` forward (+Z local) at `walkSpeed` m/s; update() only animates the limbs in place.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, makeRng, canvasTexture } from '../core/util.js';

// =====================================================================================================
//  Rig toolkit (also used by people.js)
// =====================================================================================================
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (h) => new THREE.Color(h);
const _q = new THREE.Quaternion();

function stripGeo(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  return g;
}

/** ellipsoid centred at (x,y,z) with radii (rx,ry,rz); optional Euler rotation [rx,ry,rz] applied before translation */
export function ellipsoid(x, y, z, rx, ry, rz, ws = 12, hs = 8, rot = null) {
  const g = stripGeo(new THREE.SphereGeometry(1, ws, hs));
  g.scale(rx, ry, rz);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(x, y, z);
  return g;
}

/**
 * Loft a (super)elliptical cross-section along a path.
 * stations: [{ p:[x,y,z], w, h (half extents) | r, e?: exponent (2 = ellipse, >2 boxier), dx?, dy?: section offsets }]
 * opts: { seg, exp, pt (parallel-transport frames, for tubes), ref:[x,y,z] reference "up", capStart, capEnd }
 */
export function loft(st, o = {}) {
  const seg = o.seg ?? 12, exp = o.exp ?? 2, pt = !!o.pt;
  const ref = o.ref ? V3(o.ref[0], o.ref[1], o.ref[2]) : V3(0, 1, 0);
  const n = st.length;
  const P = st.map(s => V3(s.p[0], s.p[1], s.p[2]));
  const T = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(P[1], P[0]); else if (i === n - 1) t.subVectors(P[n - 1], P[n - 2]); else t.subVectors(P[i + 1], P[i - 1]);
    T.push(t.normalize());
  }
  const side = new THREE.Vector3().crossVectors(ref, T[0]);
  if (side.lengthSq() < 1e-8) side.crossVectors(V3(0, 0, 1), T[0]);
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3(), s2 = new THREE.Vector3();
  const pos = [], centers = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      if (pt) { _q.setFromUnitVectors(T[i - 1], T[i]); side.applyQuaternion(_q); }
      else { s2.crossVectors(ref, T[i]); if (s2.lengthSq() > 1e-8) side.copy(s2); }
    }
    up.crossVectors(T[i], side).normalize();
    side.crossVectors(up, T[i]).normalize();
    const s = st[i]; const e = s.e ?? exp; const w = s.w ?? s.r, h = s.h ?? s.r; const dx = s.dx || 0, dy = s.dy || 0;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const cx = Math.sign(c) * Math.pow(Math.abs(c), 2 / e), sy = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e);
      const ox = cx * w + dx, oy = sy * h + dy;
      pos.push(P[i].x + side.x * ox + up.x * oy, P[i].y + side.y * ox + up.y * oy, P[i].z + side.z * ox + up.z * oy);
    }
    centers.push([P[i].x + side.x * dx + up.x * dy, P[i].y + side.y * dx + up.y * dy, P[i].z + side.z * dx + up.z * dy]);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg;
    idx.push(a, b, c, b, d, c);
  }
  if (o.capStart !== false) {
    const ci = pos.length / 3; pos.push(...centers[0]);
    for (let j = 0; j < seg; j++) idx.push(ci, (j + 1) % seg, j);
  }
  if (o.capEnd !== false) {
    const ci = pos.length / 3; pos.push(...centers[n - 1]); const b0 = (n - 1) * seg;
    for (let j = 0; j < seg; j++) idx.push(ci, b0 + j, b0 + (j + 1) % seg);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function sampleArr(a, t) {
  if (typeof a === 'number') return a;
  if (typeof a === 'function') return a(t);
  const f = clamp(t, 0, 1) * (a.length - 1); const i = Math.min(a.length - 2, Math.floor(f));
  return lerp(a[i], a[i + 1], f - i);
}
/** smooth a sparse polyline with a centripetal Catmull-Rom, n evenly spaced samples */
export function smoothPts(pts, n) {
  const c = new THREE.CatmullRomCurve3(pts.map(p => V3(p[0], p[1], p[2])), false, 'centripetal');
  return c.getSpacedPoints(n - 1).map(v => [v.x, v.y, v.z]);
}
/** circular tube along a polyline; radii: number | array (along) | fn(t); n: resample count (smooth) */
export function tube(pts, radii, o = {}) {
  const P = o.n ? smoothPts(pts, o.n) : pts;
  const m = P.length;
  return loft(P.map((p, i) => ({ p, r: sampleArr(radii, i / (m - 1)) })), { seg: o.seg ?? 8, pt: true, capStart: o.capStart, capEnd: o.capEnd, exp: o.exp });
}
/** tapered capsule from a to b */
export function limb(a, b, ra, rb, seg = 8, bulge = 1.0, lite = false) {
  const A = V3(a[0], a[1], a[2]), B = V3(b[0], b[1], b[2]); const d = B.clone().sub(A).normalize();
  const P = (v) => [v.x, v.y, v.z];
  let pts, rr;
  if (lite) {
    pts = [A.clone().addScaledVector(d, -ra * 0.75), A, A.clone().lerp(B, 0.45), B, B.clone().addScaledVector(d, rb * 0.75)];
    rr = [ra * 0.55, ra, Math.max(ra, rb) * bulge, rb, rb * 0.55];
  } else {
    pts = [A.clone().addScaledVector(d, -ra * 0.85), A.clone().addScaledVector(d, -ra * 0.45), A, A.clone().lerp(B, 0.45), B,
      B.clone().addScaledVector(d, rb * 0.45), B.clone().addScaledVector(d, rb * 0.85)];
    rr = [ra * 0.5, ra * 0.88, ra, (ra + rb) * 0.5 * bulge + (bulge > 1 ? Math.max(ra, rb) * (bulge - 1) : 0), rb, rb * 0.88, rb * 0.5];
  }
  return loft(pts.map((p, i) => ({ p: P(p), r: rr[i] })), { seg, pt: true });
}
/** cone (point at b) */
export function cone(a, b, r, seg = 6) {
  const A = V3(a[0], a[1], a[2]), B = V3(b[0], b[1], b[2]);
  return loft([{ p: a, r }, { p: [lerp(A.x, B.x, 0.5), lerp(A.y, B.y, 0.5), lerp(A.z, B.z, 0.5)], r: r * 0.55 }, { p: b, r: r * 0.04 }], { seg, pt: true });
}

/** skin weight helpers */
export const blend2 = (a, b, f) => (p, n) => { const t = clamp(f(p, n), 0, 1); return [[a, 1 - t], [b, t]]; };
/** chain blend: bones along a parameter u(p) in [0,1] with knots (array of {u, bone}) */
export const chain = (knots, uf) => (p) => {
  const u = uf(p);
  if (u <= knots[0].u) return [[knots[0].bone, 1]];
  for (let i = 0; i < knots.length - 1; i++) {
    if (u <= knots[i + 1].u) { const t = smoothstep(knots[i].u, knots[i + 1].u, u); return [[knots[i].bone, 1 - t], [knots[i + 1].bone, t]]; }
  }
  return [[knots[knots.length - 1].bone, 1]];
};

export class RigKit {
  constructor() { this.defs = []; this.index = {}; this.parts = []; }
  bone(name, parent, x, y, z) { this.index[name] = this.defs.length; this.defs.push({ name, parent, pos: V3(x, y, z) }); return this; }
  bonePos(name) { return this.defs[this.index[name]].pos; }
  /** geo: indexed geometry in model space; color: hex | Color | fn(p,n)->Color|hex; bind: boneName | fn(p,n)->[[bone,w],..]; pat: [mask,coord] | fn(p,n) */
  add(geo, color, bind, pat = null) { this.parts.push({ geo, color, bind, pat }); return this; }
  build() {
    let nv = 0, ni = 0;
    for (const p of this.parts) {
      if (!p.geo.index) { const idx = []; for (let i = 0; i < p.geo.attributes.position.count; i++) idx.push(i); p.geo.setIndex(idx); }
      nv += p.geo.attributes.position.count; ni += p.geo.index.count;
    }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
    const SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), PT = new Float32Array(nv * 2);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const pv = new THREE.Vector3(), nn = new THREE.Vector3(), c = new THREE.Color();
    let vo = 0, io = 0;
    for (const part of this.parts) {
      const g = part.geo, pa = g.attributes.position, na = g.attributes.normal, cnt = pa.count;
      const rigid = typeof part.bind === 'string';
      const ri = rigid ? this.index[part.bind] : 0;
      if (rigid && ri === undefined) throw new Error('RigKit: unknown bone ' + part.bind);
      const cf = typeof part.color === 'function' ? part.color : null;
      if (!cf) c.set(part.color);
      for (let i = 0; i < cnt; i++) {
        pv.fromBufferAttribute(pa, i); nn.fromBufferAttribute(na, i);
        const k = vo + i;
        P[k * 3] = pv.x; P[k * 3 + 1] = pv.y; P[k * 3 + 2] = pv.z;
        N[k * 3] = nn.x; N[k * 3 + 1] = nn.y; N[k * 3 + 2] = nn.z;
        if (cf) c.set(cf(pv, nn));
        C[k * 3] = c.r; C[k * 3 + 1] = c.g; C[k * 3 + 2] = c.b;
        if (rigid) { SI[k * 4] = ri; SW[k * 4] = 1; }
        else {
          const ws = part.bind(pv, nn).filter(w => w[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
          let s = 0; for (const w of ws) s += w[1];
          ws.forEach((w, j) => { const bi = this.index[w[0]]; if (bi === undefined) throw new Error('RigKit: unknown bone ' + w[0]); SI[k * 4 + j] = bi; SW[k * 4 + j] = w[1] / s; });
        }
        if (part.pat) { const pp = typeof part.pat === 'function' ? part.pat(pv, nn) : part.pat; PT[k * 2] = pp[0]; PT[k * 2 + 1] = pp[1]; }
      }
      const gi = g.index.array; for (let j = 0; j < gi.length; j++) I[io + j] = gi[j] + vo;
      vo += cnt; io += gi.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    geo.setAttribute('aPat', new THREE.BufferAttribute(PT, 2));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return { geometry: geo, defs: this.defs, index: this.index };
  }
}

/** create bones + SkinnedMesh for a template (geometry shared) */
export function instantiate(tpl, material) {
  const bones = tpl.defs.map(d => { const b = new THREE.Bone(); b.name = d.name; return b; });
  const byName = {}, rest = {};
  tpl.defs.forEach((d, i) => {
    byName[d.name] = bones[i];
    if (d.parent) { const pi = tpl.index[d.parent]; bones[i].position.copy(d.pos).sub(tpl.defs[pi].pos); bones[pi].add(bones[i]); }
    else bones[i].position.copy(d.pos);
    rest[d.name] = bones[i].position.clone();
  });
  const mesh = new THREE.SkinnedMesh(tpl.geometry, material);
  tpl.defs.forEach((d, i) => { if (!d.parent) mesh.add(bones[i]); });
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true;
  const bs = tpl.geometry.boundingSphere.clone(); bs.radius *= 1.6; mesh.boundingSphere = bs;
  return { mesh, bones: byName, rest };
}

/** Procedural pose animator: pose functions write channels like T['head.rx'] = 0.3 (offsets from rest), with blending */
export class Animator {
  constructor(bones, rest) {
    this.bones = bones; this.rest = rest; this.list = Object.keys(bones).map(k => bones[k]);
    this.cur = {}; this.from = null; this.k = 1; this.dur = 0.45; this.keys = new Map(); this.mix = {};
  }
  transition(d = 0.45) { this.from = Object.assign({}, this.cur); this.k = 0; this.dur = d; }
  _key(k) {
    let r = this.keys.get(k);
    if (!r) { const i = k.indexOf('.'); r = { b: this.bones[k.slice(0, i)], c: k.slice(i + 1) }; this.keys.set(k, r); }
    return r;
  }
  apply(T, dt) {
    let vals = T;
    if (this.from) {
      this.k = Math.min(1, this.k + dt / this.dur); const e = this.k * this.k * (3 - 2 * this.k);
      vals = this.mix;
      for (const key in vals) vals[key] = 0;
      for (const key in this.from) vals[key] = this.from[key] * (1 - e);
      for (const key in T) vals[key] = (this.from[key] || 0) * (1 - e) + T[key] * e;
      if (this.k >= 1) this.from = null;
    }
    for (const key in this.cur) this.cur[key] = 0;
    for (const key in vals) this.cur[key] = vals[key];
    for (const b of this.list) b.rotation.set(0, 0, 0);
    for (const name in this.bones) this.bones[name].position.copy(this.rest[name]);
    for (const key in vals) {
      const v = vals[key]; if (!v) continue;
      const kk = this._key(key); const b = kk.b; if (!b) continue;
      switch (kk.c) {
        case 'rx': b.rotation.x += v; break; case 'ry': b.rotation.y += v; break; case 'rz': b.rotation.z += v; break;
        case 'px': b.position.x += v; break; case 'py': b.position.y += v; break; case 'pz': b.position.z += v; break;
      }
    }
  }
}

const TPL = new Map();
export function cachedTemplate(key, fn) { let t = TPL.get(key); if (!t) { t = fn(); TPL.set(key, t); } return t; }

// =====================================================================================================
//  Materials (vertex colour + procedural fur grain / stripes / spots / patches / eyespots)
// =====================================================================================================
const NOISE_GLSL = /* glsl */`
float a_hash(vec3 p){ p = fract(p*0.3183099+vec3(0.11,0.17,0.13)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float a_noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(a_hash(i),a_hash(i+vec3(1.,0.,0.)),f.x),mix(a_hash(i+vec3(0.,1.,0.)),a_hash(i+vec3(1.,1.,0.)),f.x),f.y),
             mix(mix(a_hash(i+vec3(0.,0.,1.)),a_hash(i+vec3(1.,0.,1.)),f.x),mix(a_hash(i+vec3(0.,1.,1.)),a_hash(i+vec3(1.,1.,1.)),f.x),f.y),f.z); }
vec2 a_hash2(vec2 p){ p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))); return fract(sin(p)*43758.5453); }
float a_worley(vec2 p){ vec2 i=floor(p), f=fract(p); float d=8.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(float(x),float(y)); vec2 o=a_hash2(i+g); vec2 r=g+o-f; d=min(d,dot(r,r)); }
  return sqrt(d); }
`;
const PATTERN_GLSL = /* glsl */`
{
  float fg = a_noise(vRest * 11.0) * 0.6 + a_noise(vRest * 29.0) * 0.4;
  diffuseColor.rgb *= 0.9 + 0.2 * fg * uGrain + (1.0 - uGrain) * 0.1;
#ifdef PAT_STRIPES
  if (vPat.x > 0.02) {
    float n = a_noise(vRest * 6.0) * 1.1 + a_noise(vRest * 15.0) * 0.45;
    float s = sin(vPat.y * 52.0 + n * 3.4);
    float thr = 1.0 - 0.5 * vPat.x;
    float st = smoothstep(thr, thr + 0.08, s);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.018, 0.015), st);
  }
#endif
#ifdef PAT_SPOTS
  if (vPat.x > 0.02) {
    vec2 q = vec2(vRest.z * 19.0 + (vRest.x > 0.0 ? 0.0 : 7.3), vRest.y * 24.0);
    float w = a_worley(q);
    float sp = (1.0 - smoothstep(0.15, 0.22, w)) * vPat.x;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.92, 0.86), sp);
  }
#endif
#ifdef PAT_PATCHES
  if (vPat.x > 0.02) {
    vec3 q = vRest * 2.3 + vec3(vPat.y * 13.7, vPat.y * 5.1, 0.0);
    float n = a_noise(q) * 0.65 + a_noise(q * 2.3) * 0.35;
    float pc = smoothstep(0.54, 0.58, n) * vPat.x;
    diffuseColor.rgb = mix(diffuseColor.rgb, uPatchColor, pc);
  }
#endif
#ifdef PAT_EYES
  if (vPat.x > -1.5) {
    float u = vPat.x, v = vPat.y;
    vec3 c = diffuseColor.rgb;
    for (int k = 0; k < 6; k++) {
      float vk = 0.36 + float(k) * 0.125;
      float uk = (mod(float(k), 2.0) < 0.5) ? 0.0 : (u > 0.0 ? 0.62 : -0.62);
      float d = length(vec2((u - uk) * 1.25, (v - vk) * 13.0));
      if (d < 0.72) {
        c = d < 0.17 ? vec3(0.02,0.04,0.2) : d < 0.3 ? vec3(0.02,0.3,0.45) : d < 0.42 ? vec3(0.55,0.38,0.08) : d < 0.56 ? vec3(0.08,0.38,0.12) : mix(vec3(0.6,0.52,0.18), c, smoothstep(0.56,0.72,d));
      }
    }
    diffuseColor.rgb = c;
  }
#endif
}
`;
const MATS = new Map();
/** pattern: 'none'|'stripes'|'spots'|'patches_black'|'patches_brown'|'eyes'|'smooth' (no grain) */
export function getAnimalMaterial(pattern = 'none', { roughness = 0.88 } = {}) {
  const key = pattern + '|' + roughness;
  if (MATS.has(key)) return MATS.get(key);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0.0 });
  const defs = { stripes: 'PAT_STRIPES', spots: 'PAT_SPOTS', patches_black: 'PAT_PATCHES', patches_brown: 'PAT_PATCHES', eyes: 'PAT_EYES' };
  const patch = pattern === 'patches_brown' ? new THREE.Color(0x6a3418) : new THREE.Color(0x1e1a18);
  const grain = pattern === 'smooth' || pattern === 'eyes' ? 0.35 : 1.0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPatchColor = { value: patch };
    sh.uniforms.uGrain = { value: grain };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aPat;\nvarying vec3 vRest;\nvarying vec2 vPat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;\nvPat = aPat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nvarying vec2 vPat;\nuniform vec3 uPatchColor;\nuniform float uGrain;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + PATTERN_GLSL);
    if (defs[pattern]) sh.fragmentShader = `#define ${defs[pattern]}\n` + sh.fragmentShader;
  };
  m.customProgramCacheKey = () => 'animal_' + pattern;
  MATS.set(key, m);
  return m;
}

// =====================================================================================================
//  Shared quadruped helpers
// =====================================================================================================
/** leg cycle: ph∈[0,1) → [u (-1 fwd .. +1 back), lift 0..1] */
function legCycle(ph, swing = 0.38) {
  ph -= Math.floor(ph);
  if (ph < 1 - swing) { const s = ph / (1 - swing); return [lerp(-1, 1, s), 0]; }
  const s = (ph - (1 - swing)) / swing; return [Math.cos(s * Math.PI), Math.sin(s * Math.PI)];
}
/** writes a lateral-sequence walk into T. A: {up, knee, hock, hindUp} amplitudes */
function quadWalk(T, t, period, A) {
  const base = t / period;
  const legs = [['bl', 0.0, false], ['fl', 0.25, true], ['br', 0.5, false], ['fr', 0.75, true]];
  for (const [n, off, front] of legs) {
    const [u, lift] = legCycle(base + off);
    T[n + '1.rx'] = u * (front ? A.up : A.hindUp) + (front ? A.frontBias || 0 : A.hindBias || 0);
    T[n + '2.rx'] = lift * (front ? A.knee : -A.hock) + (front ? A.kneeBias || 0 : A.hockBias || 0);
  }
  const bob = Math.cos(base * Math.PI * 4);
  T['body.py'] = (T['body.py'] || 0) + bob * (A.bob || 0.01);
  T['body.rz'] = (T['body.rz'] || 0) + Math.sin(base * Math.PI * 2) * (A.roll || 0.02);
  return base;
}
/** smooth random scalar in [-1,1] (sum of sines, deterministic per seed offset) */
const wander = (t, o) => (Math.sin(t * 0.31 + o) * 0.6 + Math.sin(t * 0.73 + o * 2.1) * 0.3 + Math.sin(t * 1.37 + o * 3.7) * 0.1);
/** occasional spikes 0..1 */
const twitch = (t, o, rate = 0.7, sharp = 16) => Math.pow(Math.max(0, Math.sin(t * rate + o)), sharp);

function makeInstance(tpl, material, name) {
  const inst = instantiate(tpl, material);
  const group = new THREE.Group(); group.name = name; group.add(inst.mesh);
  return { inst, group, anim: new Animator(inst.bones, inst.rest) };
}

// =====================================================================================================
//  COW (Indian zebu)
// =====================================================================================================
const COW_PAL = {
  white: { base: 0xe4dfd5, shade: 0x8f8a83, belly: 0xefebe3, face: 0xbdb7ad, muzzle: 0x2b2523, hoof: 0x2b2522, horn: 0x5e554b, tip: 0x2a2421 },
  brown: { base: 0x8e4d2c, shade: 0x5b2f1b, belly: 0xb88a68, face: 0x7a4128, muzzle: 0x2b211d, hoof: 0x231c18, horn: 0x8d7d68, tip: 0x3a3028 },
  black: { base: 0x2a2421, shade: 0x161312, belly: 0x3e3631, face: 0x242019, muzzle: 0x121010, hoof: 0x151210, horn: 0x6e6255, tip: 0x2a2420 },
  spotted: { base: 0xeeeae2, shade: 0xd2ccc3, belly: 0xf3f0ea, face: 0xe7e1d7, muzzle: 0xc29a8d, hoof: 0x3b332c, horn: 0x8a7e70, tip: 0x4a4038 },
};

function cowTemplate(colorKey, hornStyle, patchSeed) {
  const pal = COW_PAL[colorKey];
  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('body', 'root', 0, 1.0, 0)
    .bone('neck', 'body', 0, 1.16, 0.56)
    .bone('head', 'neck', 0, 1.3, 0.9)
    .bone('jaw', 'head', 0, 1.12, 1.02)
    .bone('earL', 'head', 0.085, 1.27, 0.92).bone('earR', 'head', -0.085, 1.27, 0.92)
    .bone('tail1', 'body', 0, 1.2, -0.93).bone('tail2', 'tail1', 0, 0.92, -0.99).bone('tail3', 'tail2', 0, 0.62, -1.0)
    .bone('fl1', 'body', 0.135, 0.98, 0.41).bone('fl2', 'fl1', 0.13, 0.43, 0.45)
    .bone('fr1', 'body', -0.135, 0.98, 0.41).bone('fr2', 'fr1', -0.13, 0.43, 0.45)
    .bone('bl1', 'body', 0.14, 1.0, -0.6).bone('bl2', 'bl1', 0.13, 0.48, -0.8)
    .bone('br1', 'body', -0.14, 1.0, -0.6).bone('br2', 'br1', -0.13, 0.48, -0.8);

  const C = (h) => new THREE.Color(h);
  const base = C(pal.base), shade = C(pal.shade), belly = C(pal.belly), face = C(pal.face), muz = C(pal.muzzle);
  const patOn = colorKey === 'spotted';
  const P = (m) => patOn ? [m, patchSeed] : null;

  const bodyCol = (p) => {
    const c = base.clone();
    c.lerp(shade, smoothstep(0.05, 0.5, p.z) * smoothstep(1.05, 1.32, p.y) * 0.65); // darker forequarters / hump (zebu)
    c.lerp(shade, smoothstep(-0.55, -0.95, p.z) * smoothstep(0.95, 1.25, p.y) * 0.35);
    c.lerp(belly, smoothstep(0.88, 0.7, p.y) * 0.6);
    c.multiplyScalar(0.78 + 0.22 * smoothstep(0.62, 0.95, p.y));
    return c;
  };
  // torso
  K.add(loft([
    { p: [0, 1.07, -0.99], w: 0.07, h: 0.07 },
    { p: [0, 1.07, -0.93], w: 0.17, h: 0.19 },
    { p: [0, 1.04, -0.8], w: 0.25, h: 0.27 },
    { p: [0, 1.01, -0.6], w: 0.28, h: 0.31 },
    { p: [0, 0.99, -0.32], w: 0.3, h: 0.33 },
    { p: [0, 0.98, -0.02], w: 0.315, h: 0.345 },
    { p: [0, 0.99, 0.25], w: 0.3, h: 0.335 },
    { p: [0, 1.01, 0.45], w: 0.255, h: 0.32 },
    { p: [0, 1.03, 0.6], w: 0.19, h: 0.27 },
    { p: [0, 1.05, 0.68], w: 0.09, h: 0.14 },
  ], { seg: 16, exp: 2.25 }), bodyCol, 'body', P(1));
  // hump (over the withers, blends into neck)
  K.add(ellipsoid(0, 1.27, 0.37, 0.12, 0.13, 0.2, 12, 8, [-0.3, 0, 0]), (p) => bodyCol(p).lerp(shade, 0.15), 'body', P(1));
  // udder (small)
  K.add(ellipsoid(0, 0.69, -0.5, 0.085, 0.065, 0.1, 10, 6), colorKey === 'black' ? 0x3a302c : 0xc9a090, 'body');
  // neck (closed, overlaps body and head; blends body→neck→head)
  K.add(loft([
    { p: [0, 1.1, 0.4], w: 0.17, h: 0.25 },
    { p: [0, 1.15, 0.57], w: 0.15, h: 0.215 },
    { p: [0, 1.21, 0.72], w: 0.13, h: 0.17 },
    { p: [0, 1.27, 0.85], w: 0.11, h: 0.13 },
    { p: [0, 1.3, 0.93], w: 0.08, h: 0.09 },
  ], { seg: 12 }), (p) => bodyCol(p).lerp(shade, colorKey === 'white' ? 0.3 : 0.08),
  chain([{ u: 0.5, bone: 'body' }, { u: 0.66, bone: 'neck' }, { u: 0.9, bone: 'head' }], p => p.z), P(1));
  // dewlap (zebu fold under the throat)
  K.add(loft([
    { p: [0, 1.05, 0.84], w: 0.018, h: 0.04 },
    { p: [0, 0.97, 0.76], w: 0.03, h: 0.1 },
    { p: [0, 0.9, 0.66], w: 0.038, h: 0.14 },
    { p: [0, 0.85, 0.55], w: 0.05, h: 0.15 },
    { p: [0, 0.82, 0.45], w: 0.06, h: 0.12 },
  ], { seg: 10 }), (p) => bodyCol(p), chain([{ u: 0.62, bone: 'body' }, { u: 0.82, bone: 'neck' }], p => p.z), P(0.8));
  // head: long face angled down (poll → muzzle)
  const headCol = (p) => {
    const c = face.clone();
    c.lerp(muz, smoothstep(1.17, 1.235, p.z));
    c.multiplyScalar(0.84 + 0.16 * smoothstep(1.0, 1.32, p.y));
    return c;
  };
  K.add(loft([
    { p: [0, 1.355, 0.87], w: 0.07, h: 0.06 },
    { p: [0, 1.315, 0.935], w: 0.118, h: 0.1 },
    { p: [0, 1.255, 1.005], w: 0.112, h: 0.1 },
    { p: [0, 1.175, 1.085], w: 0.092, h: 0.088 },
    { p: [0, 1.105, 1.155], w: 0.084, h: 0.08 },
    { p: [0, 1.052, 1.212], w: 0.088, h: 0.074 },
    { p: [0, 1.027, 1.243], w: 0.072, h: 0.054 },
    { p: [0, 1.017, 1.258], w: 0.04, h: 0.028 },
  ], { seg: 12, exp: 2.4 }), headCol, 'head', P(0.9));
  // lower jaw / cheek line
  K.add(ellipsoid(0, 1.06, 1.09, 0.062, 0.042, 0.12, 10, 6, [-0.8, 0, 0]), (p) => headCol(p).multiplyScalar(0.92), 'jaw', P(0.5));
  // eyes (with dark lids)
  for (const s of [1, -1]) {
    K.add(ellipsoid(s * 0.103, 1.262, 0.995, 0.02, 0.022, 0.024, 8, 6), 0x0d0a09, 'head');
    K.add(ellipsoid(s * 0.108, 1.27, 0.995, 0.013, 0.008, 0.026, 6, 4), 0x2a201a, 'head');
  }
  // nostrils
  for (const s of [1, -1]) K.add(ellipsoid(s * 0.032, 1.04, 1.245, 0.017, 0.013, 0.009, 6, 4), 0x0b0908, 'head');
  // ears: long, droopy, pointing out & down (zebu)
  for (const [s, b] of [[1, 'earL'], [-1, 'earR']]) {
    K.add(ellipsoid(s * 0.165, 1.235, 0.94, 0.11, 0.026, 0.052, 10, 6, [0, s * 0.3, -s * 0.62]), (p, n) => {
      const c = face.clone().lerp(shade, 0.2); if (n.y < -0.2) c.lerp(new THREE.Color(0xc4a090), 0.35); return c;
    }, b, P(0.7));
  }
  // horns
  const hornPts = hornStyle === 0
    ? [[0.07, 1.37, 0.89], [0.13, 1.4, 0.88], [0.18, 1.47, 0.87], [0.2, 1.56, 0.89], [0.18, 1.63, 0.93]]
    : hornStyle === 1
      ? [[0.07, 1.37, 0.89], [0.11, 1.43, 0.87], [0.12, 1.5, 0.85], [0.1, 1.55, 0.85]]
      : [[0.07, 1.37, 0.89], [0.15, 1.39, 0.87], [0.24, 1.43, 0.85], [0.3, 1.5, 0.85], [0.31, 1.58, 0.89]];
  for (const s of [1, -1]) {
    const pts = hornPts.map(p => [p[0] * s, p[1], p[2]]);
    K.add(tube(pts, [0.036, 0.03, 0.022, 0.012, 0.004], { n: 8, seg: 7 }), (p) => {
      const t = smoothstep(1.4, 1.6, p.y); return new THREE.Color(pal.horn).lerp(new THREE.Color(pal.tip), t);
    }, 'head');
  }
  // poll ridge between horns
  K.add(ellipsoid(0, 1.37, 0.885, 0.085, 0.032, 0.05, 8, 5), (p) => headCol(p), 'head', P(0.5));
  // legs
  const legCol = (p) => {
    const c = base.clone().lerp(shade, colorKey === 'white' ? smoothstep(0.55, 0.15, p.y) * 0.45 : 0.1);
    c.lerp(new THREE.Color(0x6b5a48), smoothstep(0.22, 0.08, p.y) * 0.25); // dusty fetlocks
    c.multiplyScalar(0.8 + 0.2 * smoothstep(0.1, 0.8, p.y));
    return c;
  };
  const hoofCol = pal.hoof;
  for (const [n, s, front] of [['fl', 1, true], ['fr', -1, true], ['bl', 1, false], ['br', -1, false]]) {
    if (front) {
      K.add(limb([s * 0.135, 0.98, 0.4], [s * 0.13, 0.43, 0.45], 0.105, 0.056, 10, 1.08), legCol, n + '1', P(0.6));
      K.add(ellipsoid(s * 0.13, 0.43, 0.455, 0.052, 0.06, 0.055, 8, 6), legCol, n + '2', P(0.2));
      K.add(limb([s * 0.13, 0.43, 0.45], [s * 0.13, 0.08, 0.465], 0.048, 0.038, 8), legCol, n + '2', P(0.15));
      K.add(ellipsoid(s * 0.13, 0.045, 0.478, 0.048, 0.047, 0.062, 8, 6), hoofCol, n + '2');
    } else {
      K.add(limb([s * 0.14, 1.0, -0.6], [s * 0.13, 0.48, -0.8], 0.15, 0.058, 10, 1.0), legCol, n + '1', P(0.7));
      K.add(limb([s * 0.13, 0.48, -0.8], [s * 0.13, 0.08, -0.74], 0.048, 0.038, 8), legCol, n + '2', P(0.15));
      K.add(ellipsoid(s * 0.13, 0.045, -0.718, 0.048, 0.047, 0.062, 8, 6), hoofCol, n + '2');
    }
  }
  // tail with dark switch
  K.add(tube([[0, 1.2, -0.93], [0, 1.05, -0.99], [0, 0.85, -1.0], [0, 0.62, -1.0], [0, 0.42, -0.99]], [0.032, 0.025, 0.02, 0.016, 0.014], { n: 9, seg: 6 }),
    (p) => base.clone().lerp(shade, 0.3),
    chain([{ u: 0.0, bone: 'tail1' }, { u: 0.32, bone: 'tail2' }, { u: 0.62, bone: 'tail3' }], p => (1.2 - p.y) / 0.8));
  K.add(ellipsoid(0, 0.36, -0.99, 0.04, 0.1, 0.04, 8, 6), 0x1c1816, 'tail3');
  return K.build();
}

function cowPose(T, pose, t, o) {
  // idle layers
  const sw = Math.sin(t * 1.4 + o.a) * 0.6 + Math.sin(t * 3.3 + o.b) * 0.25 + twitch(t, o.c, 0.6, 8) * 0.8;
  T['tail1.rz'] = sw * 0.25; T['tail2.rz'] = sw * 0.35; T['tail3.rz'] = sw * 0.45; T['tail1.rx'] = 0.12;
  T['earL.rz'] = twitch(t, o.a, 0.8) * 0.5 + Math.sin(t * 0.7) * 0.05;
  T['earR.rz'] = -twitch(t, o.b, 0.9) * 0.5 - Math.sin(t * 0.6) * 0.05;
  T['earL.ry'] = twitch(t, o.c, 1.1) * 0.4; T['earR.ry'] = -twitch(t, o.a + 2, 1.0) * 0.4;
  const chew = (Math.sin(t * 0.25 + o.c) > 0 ? 1 : 0) * (0.5 + 0.5 * Math.sin(t * 6.5));
  T['jaw.rx'] = chew * 0.07; T['jaw.ry'] = chew * Math.sin(t * 6.5) * 0.04;
  T['body.py'] = Math.sin(t * 1.2) * 0.004;
  if (pose === 'stand') {
    T['neck.ry'] = wander(t, o.a) * 0.22; T['head.ry'] = wander(t, o.a) * 0.15; T['neck.rx'] = 0.05 + wander(t * 0.7, o.b) * 0.1;
    T['head.rx'] = wander(t * 0.8, o.c) * 0.1; T['head.rz'] = wander(t * 0.5, o.a + 1) * 0.06;
    T['bl1.rx'] = 0.04; T['br1.rx'] = -0.02;
  } else if (pose === 'graze') {
    const lift = smoothstep(0.75, 1, Math.sin(t * 0.18 + o.b));
    T['neck.rx'] = lerp(0.95, 0.15, lift); T['head.rx'] = lerp(0.55, 0.1, lift);
    T['neck.ry'] = Math.sin(t * 0.45 + o.a) * 0.18; T['jaw.rx'] = (0.5 + 0.5 * Math.sin(t * 7)) * 0.09 * (1 - lift);
    T['fl1.rx'] = -0.05; T['fr1.rx'] = 0.08;
  } else if (pose === 'walk') {
    quadWalk(T, t, 1.3, { up: 0.32, hindUp: 0.3, knee: 0.9, hock: 0.6, bob: 0.012, roll: 0.025 });
    T['neck.rx'] = 0.12 + Math.cos(t / 1.3 * Math.PI * 4) * 0.04; T['neck.ry'] = wander(t, o.a) * 0.12;
  } else if (pose === 'sit') {
    // sternal recumbency: belly on the ground, front legs folded under, hind legs tucked to the side
    T['body.py'] = -0.53; T['body.rz'] = 0.06;
    T['fl1.rx'] = -0.6; T['fl2.rx'] = 2.9; T['fr1.rx'] = -0.55; T['fr2.rx'] = 2.9;
    T['fl1.rz'] = 0.05; T['fr1.rz'] = -0.05;
    T['bl1.rx'] = -1.45; T['bl2.rx'] = 2.45; T['bl1.rz'] = 0.3; T['bl1.ry'] = 0.15;
    T['br1.rx'] = -1.4; T['br2.rx'] = 2.4; T['br1.rz'] = -0.1; T['br1.ry'] = -0.1;
    T['neck.rx'] = -0.12; T['neck.ry'] = wander(t, o.a) * 0.4; T['head.rx'] = 0.05 + wander(t, o.c) * 0.08;
    T['tail1.rx'] = 0.45; T['tail2.rx'] = 0.55; T['tail3.rx'] = 0.4; T['tail1.rz'] = 0.45 + sw * 0.08; T['tail2.rz'] = 0.35; T['tail3.rz'] = 0.3;
  }
}

export function createCow({ seed = 1, color, pose = 'stand' } = {}) {
  const r = makeRng(seed * 7919 + 13);
  const ck = color && COW_PAL[color] ? color : r.pick(['white', 'white', 'white', 'brown', 'black', 'spotted']);
  const horn = r.int(0, 2), ps = ck === 'spotted' ? r.int(0, 2) : 0;
  const tpl = cachedTemplate(`cow_${ck}_${horn}_${ps}`, () => cowTemplate(ck, horn, ps * 1.37));
  const mat = getAnimalMaterial(ck === 'spotted' ? (r() < 0.6 ? 'patches_black' : 'patches_brown') : 'none');
  const { group, anim } = makeInstance(tpl, mat, 'cow');
  const sc = r.range(0.9, 1.06); group.scale.setScalar(sc);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const T = {}; let t = r() * 100; let cur = pose;
  const api = {
    group, kind: 'cow', walkSpeed: 0.85 * sc,
    get pose() { return cur; },
    setPose(p) { if (p === cur) return; anim.transition(p === 'sit' || cur === 'sit' ? 1.6 : 0.6); cur = p; },
    update(dt = 0) { dt = Math.min(dt, 0.1); t += dt; for (const k in T) T[k] = 0; cowPose(T, cur, t, o); anim.apply(T, dt); },
  };
  api.update(0);
  return api;
}

// =====================================================================================================
//  TIGER (Bengal)
// =====================================================================================================
function tigerTemplate() {
  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('body', 'root', 0, 0.72, 0)
    .bone('neck', 'body', 0, 0.84, 0.46)
    .bone('head', 'neck', 0, 0.92, 0.68)
    .bone('jaw', 'head', 0, 0.86, 0.8)
    .bone('earL', 'head', 0.09, 1.04, 0.73).bone('earR', 'head', -0.09, 1.04, 0.73)
    .bone('tail1', 'body', 0, 0.8, -0.84).bone('tail2', 'tail1', 0, 0.6, -1.08).bone('tail3', 'tail2', 0, 0.4, -1.32).bone('tail4', 'tail3', 0, 0.33, -1.58)
    .bone('fl1', 'body', 0.14, 0.8, 0.32).bone('fl2', 'fl1', 0.13, 0.22, 0.37)
    .bone('fr1', 'body', -0.14, 0.8, 0.32).bone('fr2', 'fr1', -0.13, 0.22, 0.37)
    .bone('bl1', 'body', 0.14, 0.8, -0.56).bone('bl2', 'bl1', 0.13, 0.3, -0.72)
    .bone('br1', 'body', -0.14, 0.8, -0.56).bone('br2', 'br1', -0.13, 0.3, -0.72);
  const orange = col(0xc25e10), orangeL = col(0xdc8a40), white = col(0xefe9dc), cream = col(0xe9d7bd);
  // fur colour from normal: underside → white
  const fur = (p, n, extraWhite = 0) => {
    const c = orange.clone().lerp(orangeL, smoothstep(0.2, -0.45, n.y) * 0.8);
    c.lerp(white, clamp(smoothstep(-0.25, -0.7, n.y) + extraWhite, 0, 1));
    return c;
  };
  const stripeMask = (n, extra = 0) => clamp(1 - smoothstep(-0.3, -0.65, n.y) + extra, 0, 1);
  K.add(loft([
    { p: [0, 0.79, -0.86], w: 0.07, h: 0.07 },
    { p: [0, 0.78, -0.77], w: 0.16, h: 0.16 },
    { p: [0, 0.76, -0.6], w: 0.21, h: 0.2 },
    { p: [0, 0.73, -0.36], w: 0.19, h: 0.19 },
    { p: [0, 0.71, -0.1], w: 0.215, h: 0.225 },
    { p: [0, 0.71, 0.14], w: 0.235, h: 0.26 },
    { p: [0, 0.75, 0.36], w: 0.215, h: 0.25 },
    { p: [0, 0.79, 0.5], w: 0.16, h: 0.2 },
    { p: [0, 0.81, 0.58], w: 0.08, h: 0.1 },
  ], { seg: 14, exp: 2.1 }), (p, n) => fur(p, n), 'body', (p, n) => [stripeMask(n), p.z - Math.abs(p.y - 0.75) * 0.25]);
  // shoulder blades & haunches
  for (const s of [1, -1]) {
    K.add(ellipsoid(s * 0.12, 0.9, 0.31, 0.085, 0.09, 0.16, 8, 6), (p, n) => fur(p, n), 'body', (p, n) => [stripeMask(n), p.z]);
    K.add(ellipsoid(s * 0.13, 0.68, -0.55, 0.105, 0.17, 0.155, 9, 6), (p, n) => fur(p, n), 'bl1'.replace('l', s > 0 ? 'l' : 'r'), (p, n) => [stripeMask(n, -0.1), p.y * 0.9 + p.z * 0.5]);
  }
  // neck
  K.add(loft([
    { p: [0, 0.82, 0.42], w: 0.17, h: 0.2 },
    { p: [0, 0.86, 0.54], w: 0.16, h: 0.18 },
    { p: [0, 0.9, 0.66], w: 0.14, h: 0.15 },
  ], { seg: 12, capStart: false, capEnd: false }), (p, n) => fur(p, n), chain([{ u: 0.44, bone: 'body' }, { u: 0.56, bone: 'neck' }, { u: 0.68, bone: 'head' }], p => p.z), (p, n) => [stripeMask(n), p.z * 0.8]);
  // head
  const faceCol = (p, n) => {
    const c = fur(p, n);
    const lowFace = smoothstep(0.92, 0.86, p.y) * smoothstep(0.8, 0.9, p.z);   // white lower face / chin
    const cheek = smoothstep(0.09, 0.14, Math.abs(p.x)) * smoothstep(0.95, 0.87, p.y);
    c.lerp(white, clamp(lowFace + cheek, 0, 1));
    return c;
  };
  const headPat = (p, n) => {
    const f = smoothstep(0.06, 0.12, Math.abs(p.x)); // 0 = forehead (vertical stripes), 1 = cheeks (diagonal)
    const coord = lerp(p.x * 0.75, p.y * 0.6 - Math.abs(p.x) * 0.45, f);
    const m = p.y > 0.955 ? 0.9 * smoothstep(0.955, 0.985, p.y) * (1 - f) + 0.7 * f * smoothstep(0.86, 0.9, p.y) : 0.7 * f * smoothstep(0.86, 0.9, p.y);
    return [m, coord];
  };
  K.add(ellipsoid(0, 0.94, 0.8, 0.155, 0.13, 0.15, 12, 9), faceCol, 'head', headPat);
  K.add(ellipsoid(0, 0.972, 0.885, 0.112, 0.034, 0.05, 10, 6), (p, n) => fur(p, n), 'head', (p) => [0.6 * (1 - smoothstep(0.06, 0.1, Math.abs(p.x))), p.x * 0.75]); // brow ridge
  // muzzle: orange bridge on top, white below
  K.add(ellipsoid(0, 0.888, 0.935, 0.084, 0.066, 0.078, 12, 8), (p, n) => (n.y > 0.35 && Math.abs(p.x) < 0.045) ? orange.clone().lerp(orangeL, 0.4) : white.clone(), 'head');
  for (const s of [1, -1]) {
    K.add(ellipsoid(s * 0.11, 0.872, 0.84, 0.052, 0.058, 0.058, 10, 7), (p, n) => white.clone().lerp(orange, smoothstep(0.85, 0.9, p.y) * 0.85), 'head', (p) => [0.6 * smoothstep(0.85, 0.89, p.y), p.y * 0.6 - Math.abs(p.x) * 0.45]); // cheek ruff
    K.add(ellipsoid(s * 0.061, 0.972, 0.922, 0.024, 0.01, 0.008, 8, 5), 0xf4efe6, 'head'); // white eyebrow spot
    K.add(ellipsoid(s * 0.06, 0.95, 0.93, 0.019, 0.016, 0.012, 8, 6), 0xa86f14, 'head'); // amber eye
    K.add(ellipsoid(s * 0.06, 0.95, 0.937, 0.006, 0.012, 0.007, 6, 4), 0x050404, 'head'); // pupil
    K.add(ellipsoid(s * 0.06, 0.95, 0.928, 0.023, 0.019, 0.01, 8, 5), 0x1a120c, 'head'); // dark eye rim
  }
  K.add(loft([{ p: [0, 0.93, 0.975], w: 0.012, h: 0.008 }, { p: [0, 0.918, 0.998], w: 0.026, h: 0.015 }, { p: [0, 0.905, 1.008], w: 0.022, h: 0.012 }], { seg: 8 }), 0x8a5045, 'head'); // nose
  // mouth interior (visible when roaring): dark red pad on muzzle underside
  K.add(ellipsoid(0, 0.858, 0.92, 0.062, 0.02, 0.068, 10, 6), 0x5c1612, 'head');
  for (const s of [1, -1]) K.add(cone([s * 0.03, 0.862, 0.962], [s * 0.031, 0.83, 0.966], 0.009, 6), 0xf5f1e6, 'head'); // upper fangs (hidden until jaw opens)
  // jaw
  K.add(ellipsoid(0, 0.843, 0.9, 0.068, 0.03, 0.088, 10, 6), (p, n) => n.y > 0.4 ? col(0x6a1c16) : white.clone(), 'jaw');
  for (const s of [1, -1]) K.add(cone([s * 0.026, 0.852, 0.958], [s * 0.027, 0.878, 0.962], 0.007, 6), 0xf5f1e6, 'jaw'); // lower fangs
  // ears: rounded; front orange rim with pale inner fur, back black with white spot
  for (const [s, b] of [[1, 'earL'], [-1, 'earR']]) {
    K.add(ellipsoid(s * 0.098, 1.055, 0.74, 0.046, 0.052, 0.02, 10, 6, [0.2, -s * 0.3, -s * 0.25]), (p, n) => {
      if (n.z < -0.2) { const sp = Math.hypot(p.x - s * 0.098, p.y - 1.055) < 0.02; return sp ? col(0xf2ede4) : col(0x141110); }
      const d = Math.hypot(p.x - s * 0.098, p.y - 1.05);
      return d < 0.025 ? col(0xe8dccb) : orange.clone().multiplyScalar(0.8);
    }, b);
  }
  // legs
  const legFur = (p, n) => { const c = fur(p, n); const inner = smoothstep(-0.1, -0.7, n.x * Math.sign(p.x)); return c.lerp(white, inner * 0.8); };
  for (const [nm, s] of [['fl', 1], ['fr', -1]]) {
    K.add(limb([s * 0.14, 0.82, 0.32], [s * 0.13, 0.22, 0.37], 0.1, 0.06, 8, 1.05), legFur, nm + '1', (p, n) => [stripeMask(n, -0.25) * 0.8, p.y]);
    K.add(limb([s * 0.13, 0.22, 0.37], [s * 0.13, 0.06, 0.4], 0.058, 0.052, 8), legFur, nm + '2', (p, n) => [0.3, p.y]);
    K.add(ellipsoid(s * 0.13, 0.045, 0.42, 0.068, 0.045, 0.085, 10, 6), (p, n) => white.clone().lerp(orangeL, 0.4), nm + '2');
  }
  for (const [nm, s] of [['bl', 1], ['br', -1]]) {
    K.add(limb([s * 0.14, 0.78, -0.56], [s * 0.13, 0.3, -0.72], 0.11, 0.055, 8, 1.0), legFur, nm + '1', (p, n) => [stripeMask(n, -0.2) * 0.85, p.y * 0.9 + p.z * 0.4]);
    K.add(limb([s * 0.13, 0.3, -0.72], [s * 0.13, 0.06, -0.62], 0.05, 0.045, 8), legFur, nm + '2', (p, n) => [0.35, p.y]);
    K.add(ellipsoid(s * 0.13, 0.042, -0.6, 0.06, 0.04, 0.08, 10, 6), (p, n) => white.clone().lerp(orangeL, 0.4), nm + '2');
  }
  // tail: ringed, black tip
  const tailPts = [[0, 0.8, -0.84], [0, 0.68, -0.98], [0, 0.55, -1.12], [0, 0.42, -1.3], [0, 0.34, -1.48], [0, 0.34, -1.64], [0, 0.4, -1.76]];
  const tg = tube(tailPts, [0.05, 0.044, 0.04, 0.036, 0.034, 0.033, 0.03], { n: 16, seg: 8 });
  const tailU = (p) => { let best = 0, bd = 1e9; for (let i = 0; i < tailPts.length; i++) { const d = (p.y - tailPts[i][1]) ** 2 + (p.z - tailPts[i][2]) ** 2; if (d < bd) { bd = d; best = i; } } return best / (tailPts.length - 1); };
  K.add(tg, (p, n) => { const u = (-0.84 - p.z) / 0.92; return u > 0.88 ? col(0x0e0b0a) : fur(p, n); },
    chain([{ u: 0.0, bone: 'tail1' }, { u: 0.3, bone: 'tail2' }, { u: 0.58, bone: 'tail3' }, { u: 0.85, bone: 'tail4' }], p => clamp((-0.84 - p.z) / 0.92, 0, 1)),
    (p) => [1, (-p.z) * 0.85]);
  void tailU;
  return K.build();
}

function tigerPose(T, pose, t, o, roarK) {
  const sw = Math.sin(t * 0.9 + o.a) * 0.5 + Math.sin(t * 2.3 + o.b) * 0.2;
  T['earL.rz'] = twitch(t, o.a, 0.7) * 0.35; T['earR.rz'] = -twitch(t, o.b, 0.8) * 0.35;
  T['body.py'] = Math.sin(t * 1.6) * 0.004;
  if (pose === 'sit') {
    // upright cat sit: rump down, chest high, front legs straight
    T['body.rx'] = -0.62; T['body.py'] += -0.26; T['body.pz'] = -0.12;
    T['fl1.rx'] = 0.62; T['fr1.rx'] = 0.62; T['fl2.rx'] = -0.02; T['fr2.rx'] = -0.02;
    T['bl1.rx'] = -1.15 + 0.62; T['br1.rx'] = -1.15 + 0.62; T['bl2.rx'] = 1.55; T['br2.rx'] = 1.55;
    T['bl1.rz'] = 0.12; T['br1.rz'] = -0.12;
    T['neck.rx'] = 0.38 + wander(t, o.a) * 0.06; T['head.rx'] = 0.2; T['neck.ry'] = wander(t, o.b) * 0.5; T['head.rz'] = wander(t, o.c) * 0.08;
    // tail curled around on the ground
    T['tail1.rx'] = 0.9; T['tail1.ry'] = 0.5; T['tail2.ry'] = 0.6; T['tail3.ry'] = 0.6 + sw * 0.15; T['tail4.ry'] = 0.5 + sw * 0.4; T['tail2.rx'] = -0.3;
  } else if (pose === 'lie') {
    T['body.py'] += -0.48;
    T['fl1.rx'] = -1.45; T['fr1.rx'] = -1.4; T['fl2.rx'] = 0.15; T['fr2.rx'] = 0.12;
    T['bl1.rx'] = -1.2; T['bl2.rx'] = 2.1; T['bl1.rz'] = 0.55; T['br1.rx'] = -1.2; T['br2.rx'] = 2.1; T['br1.rz'] = -0.55;
    T['neck.rx'] = -0.25; T['neck.ry'] = wander(t, o.b) * 0.5; T['head.rx'] = 0.15;
    T['tail1.rx'] = -0.3; T['tail1.ry'] = 0.4; T['tail2.ry'] = 0.4 + sw * 0.2; T['tail3.ry'] = 0.3 + sw * 0.3;
  } else if (pose === 'walk') {
    quadWalk(T, t, 1.35, { up: 0.42, hindUp: 0.36, knee: 1.1, hock: 0.8, bob: 0.012, roll: 0.03 });
    const ph = t / 1.35 * Math.PI * 2;
    T['body.ry'] = Math.sin(ph) * 0.04;
    T['neck.rx'] = 0.18 + Math.cos(ph * 2) * 0.03; T['neck.ry'] = Math.sin(ph) * 0.06; T['head.rx'] = 0.1;
    T['tail1.rx'] = -0.25; T['tail2.rx'] = 0.15; T['tail3.ry'] = sw * 0.3; T['tail4.ry'] = sw * 0.5; T['tail4.rx'] = -0.4;
  } else { // stand
    T['neck.rx'] = 0.05 + wander(t, o.a) * 0.08; T['neck.ry'] = wander(t, o.b) * 0.45; T['head.rx'] = 0.05;
    T['tail1.rx'] = 0.1; T['tail2.ry'] = sw * 0.2; T['tail3.ry'] = sw * 0.35; T['tail4.ry'] = sw * 0.5; T['tail4.rx'] = -0.5;
  }
  if (roarK > 0) {
    const e = Math.sin(clamp(roarK, 0, 1) * Math.PI);
    const k = smoothstep(0, 0.25, roarK) * (1 - smoothstep(0.75, 1, roarK));
    T['jaw.rx'] = (T['jaw.rx'] || 0) + k * 0.62 + Math.sin(t * 40) * 0.02 * k;
    T['head.rx'] = (T['head.rx'] || 0) - e * 0.35; T['neck.rx'] = (T['neck.rx'] || 0) - e * 0.15;
    T['earL.rz'] = -k * 0.5; T['earR.rz'] = k * 0.5; T['earL.rx'] = k * 0.4; T['earR.rx'] = k * 0.4;
    T['neck.ry'] *= 1 - e;
  }
}

export function createTiger({ seed = 1, pose = 'sit' } = {}) {
  const r = makeRng(seed * 104729 + 7);
  const tpl = cachedTemplate('tiger', tigerTemplate);
  const { group, anim } = makeInstance(tpl, getAnimalMaterial('stripes'), 'tiger');
  const sc = r.range(0.97, 1.08); group.scale.setScalar(sc);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const T = {}; let t = r() * 100; let cur = pose; let roarT = -1; const ROAR = 2.2;
  const api = {
    group, kind: 'tiger', walkSpeed: 1.1 * sc,
    get pose() { return cur; },
    setPose(p) { if (p === cur) return; anim.transition(1.0); cur = p; },
    /** trigger roar animation; returns its duration in seconds (play the 'tigerRoar' sound at the same time) */
    roar() { if (roarT < 0) roarT = 0; return ROAR; },
    get roaring() { return roarT >= 0; },
    update(dt = 0) {
      dt = Math.min(dt, 0.1); t += dt;
      let rk = 0; if (roarT >= 0) { roarT += dt; rk = roarT / ROAR; if (rk >= 1) { roarT = -1; rk = 0; } }
      for (const k in T) T[k] = 0; tigerPose(T, cur, t, o, rk); anim.apply(T, dt);
    },
  };
  api.update(0);
  return api;
}

// =====================================================================================================
//  SNAKE (cobra / python) — slither + optional cobra hood in the vertex shader
// =====================================================================================================
const SNAKE_GEO = new Map();
function snakeGeometry(kind) {
  if (SNAKE_GEO.has(kind)) return SNAKE_GEO.get(kind);
  const L = kind === 'python' ? 3.0 : 1.75, R = kind === 'python' ? 0.075 : 0.03;
  const rings = 90, seg = 10;
  const pos = [], uv = [], idx = [];
  const prof = (s) => { // s: 0 tail tip .. 1 snout
    let r = R * (0.12 + 0.88 * smoothstep(0.0, 0.3, s));
    r *= 1 - 0.18 * smoothstep(0.86, 0.93, s) * (1 - smoothstep(0.93, 0.95, s)); // neck
    const head = smoothstep(0.93, 0.955, s);
    r = lerp(r, R * (kind === 'python' ? 0.95 : 1.05), head);
    r *= 1 - smoothstep(0.975, 1.0, s) * 0.75;
    return r;
  };
  for (let i = 0; i <= rings; i++) {
    const s = i / rings; const z = -L / 2 + s * L; const r = prof(s);
    const head = smoothstep(0.93, 0.96, s);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const w = r * (1 + head * 0.25), h = r * (0.86 - head * 0.22);
      const x = Math.cos(a) * w; let y = Math.sin(a) * h;
      if (y < 0) y *= 0.55; // flat belly
      pos.push(x, y + h * 0.6, z); uv.push(j / seg, s);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // eyes as tiny extra spheres merged in
  const parts = [g];
  for (const sx of [1, -1]) {
    const e = new THREE.SphereGeometry(R * 0.2, 6, 4); e.translate(sx * R * 1.0, R * 0.95, L / 2 - L * 0.035);
    const n = e.attributes.position.count; const uvs = new Float32Array(n * 2).fill(0.999); e.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    parts.push(e);
  }
  const merged = mergeIndexed(parts);
  const out = { geo: merged, L, R };
  SNAKE_GEO.set(kind, out);
  return out;
}
function mergeIndexed(geos) {
  let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, vo * 3); N.set(g.attributes.normal.array, vo * 3); U.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array; for (let j = 0; j < gi.length; j++) I[io + j] = gi[j] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3)); m.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  m.setIndex(new THREE.BufferAttribute(I, 1)); m.computeBoundingSphere();
  return m;
}
const SNAKE_TEX = new Map();
function snakeTexture(kind) {
  if (SNAKE_TEX.has(kind)) return SNAKE_TEX.get(kind);
  const tex = canvasTexture(128, 1024, (ctx, w, h) => {
    const rnd = makeRng(kind === 'python' ? 77 : 33);
    // u: 0 = left side, .25 = top, .5 = right side, .75 = belly ; v: 0 tail .. 1 head (canvas y flipped)
    const belly = kind === 'python' ? '#d9c9a0' : '#d8c38c';
    const back = kind === 'python' ? '#9c7a4a' : '#3b3024';
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0.0, back); g.addColorStop(0.5, back); g.addColorStop(0.62, belly); g.addColorStop(0.88, belly); g.addColorStop(1.0, back);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(0, h); ctx.scale(1, -1);
    if (kind === 'python') {
      // dark saddle blotches with black edges along the back and sides
      for (let i = 0; i < 70; i++) {
        const v = rnd() * h; const u = rnd() < 0.6 ? w * 0.25 + (rnd() - 0.5) * w * 0.12 : (rnd() < 0.5 ? w * 0.03 : w * 0.47) + (rnd() - 0.5) * w * 0.06;
        const rw = w * (0.07 + rnd() * 0.06), rh = h * (0.012 + rnd() * 0.012);
        ctx.fillStyle = '#2c1d10'; ctx.beginPath(); ctx.ellipse(u, v, rw * 1.25, rh * 1.25, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5e4124'; ctx.beginPath(); ctx.ellipse(u, v, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#3a2814'; ctx.beginPath(); ctx.moveTo(w * 0.25, h * 0.995); ctx.lineTo(w * 0.17, h * 0.955); ctx.lineTo(w * 0.33, h * 0.955); ctx.fill(); // head arrow
    } else {
      // faint pale cross-bands, darker tail, hood spectacle mark on the back of the neck
      for (let i = 0; i < 26; i++) { const v = h * (0.08 + i * 0.033); ctx.fillStyle = 'rgba(160,140,95,0.35)'; ctx.fillRect(0, v, w * 0.5, h * 0.006); }
      ctx.fillStyle = 'rgba(20,15,10,0.5)'; ctx.fillRect(0, 0, w, h * 0.12);
      const hv = h * 0.9, hu = w * 0.25;
      ctx.strokeStyle = '#e8dcae'; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hu + s * w * 0.045, hv, w * 0.035, h * 0.008, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(hu - w * 0.08, hv + h * 0.012); ctx.quadraticCurveTo(hu, hv + h * 0.022, hu + w * 0.08, hv + h * 0.012); ctx.stroke();
    }
    // scale speckle
    for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.06})`; ctx.fillRect(rnd() * w, rnd() * h, 2, 2); }
    ctx.restore();
    ctx.fillStyle = '#050505'; ctx.fillRect(w - 2, 0, 2, 2); // eye pixel at uv(0.999, ~1)
  }, { wrap: false, anisotropy: 4 });
  SNAKE_TEX.set(kind, tex);
  return tex;
}

export function createSnake({ seed = 1, kind = 'cobra' } = {}) {
  const r = makeRng(seed * 31337 + 5);
  const { geo, L, R } = snakeGeometry(kind);
  const uni = { uPhase: { value: r() * 10 }, uAmp: { value: kind === 'python' ? 0.09 : 0.11 }, uK: { value: kind === 'python' ? 5.2 : 9.0 },
    uNeckZ: { value: L / 2 - L * 0.07 }, uRaise: { value: 0 }, uRaiseZ: { value: L / 2 - 0.42 }, uHood: { value: kind === 'cobra' ? 1 : 0 }, uLen: { value: L } };
  const mat = new THREE.MeshStandardMaterial({ map: snakeTexture(kind), roughness: 0.45, metalness: 0.0 });
  const SLITHER = /* glsl */`
    uniform float uPhase, uAmp, uK, uNeckZ, uRaise, uRaiseZ, uHood, uLen;
    vec3 snakeBend(vec3 p, inout vec3 nrm) {
      float z = p.z;
      float tailEnv = smoothstep(-uLen * 0.5, -uLen * 0.5 + 0.25, z) * 0.6 + 0.4;
      float frontDamp = 1.0 - uRaise * smoothstep(uRaiseZ - 0.3, uRaiseZ, z);
      float amp = uAmp * tailEnv * frontDamp;
      float zc = min(z, uNeckZ);
      float th = uK * zc + uPhase;
      float cx = amp * sin(th);
      float ang = atan(amp * uK * cos(th));
      float ca = cos(ang), sa = sin(ang);
      // cobra hood: widen just behind the head when raised
      float hood = uHood * uRaise * smoothstep(uNeckZ - 0.2, uNeckZ - 0.1, z) * (1.0 - smoothstep(uNeckZ - 0.03, uNeckZ + 0.01, z));
      float px = p.x * (1.0 + hood * 2.4);
      float py = p.y * (1.0 - hood * 0.45);
      vec2 off = vec2(px, z - zc);
      vec3 q = vec3(cx + off.x * ca + off.y * sa, py, zc - off.x * sa + off.y * ca);
      nrm = vec3(nrm.x * ca + nrm.z * sa, nrm.y, -nrm.x * sa + nrm.z * ca);
      // raise the front part (arc); the head itself stays level, looking forward
      float d = z - uRaiseZ;
      if (uRaise > 0.0 && d > 0.0) {
        float Lb = 0.32; float phi = uRaise * 1.62;
        float kap = max(phi / Lb, 1e-3);
        float ay = q.y;
        float dn = uNeckZ - uRaiseZ;                       // arc length to the neck
        float dd = min(d, dn);
        float da = min(dd, Lb);
        vec2 P = vec2(sin(kap * da) / kap, (1.0 - cos(kap * da)) / kap) + vec2(cos(phi), sin(phi)) * max(0.0, dd - Lb);
        float a2 = kap * da;
        if (z <= uNeckZ) {
          q.z = uRaiseZ + P.x - ay * sin(a2);
          q.y = P.y + ay * cos(a2);
          nrm = vec3(nrm.x, nrm.y * cos(a2) + nrm.z * sin(a2), -nrm.y * sin(a2) + nrm.z * cos(a2));
        } else {
          float hp = mix(a2, -0.12, uRaise);
          vec2 H = vec2(cos(hp), sin(hp));
          vec2 Q = P + H * (z - uNeckZ) + vec2(-sin(hp), cos(hp)) * ay;
          q.z = uRaiseZ + Q.x; q.y = Q.y;
          nrm = vec3(nrm.x, nrm.y * cos(hp) + nrm.z * sin(hp), -nrm.y * sin(hp) + nrm.z * cos(hp));
        }
      }
      return q;
    }`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SLITHER)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 snN = objectNormal; vec3 snP = snakeBend(position, snN); objectNormal = snN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = snP;');
  };
  mat.customProgramCacheKey = () => 'snake_v2';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  const group = new THREE.Group(); group.name = 'snake'; group.add(mesh);
  const baseSpeed = kind === 'python' ? 0.3 : 0.85;
  let raise = 0, raiseTarget = 0, speed = baseSpeed;
  const api = {
    group, kind, length: L, radius: R,
    /** current forward speed (m/s) the game should move the group at along local +Z to avoid sliding */
    get speed() { return speed; },
    setRaised(on) { raiseTarget = on && kind === 'cobra' ? 1 : 0; },
    get raised() { return raise > 0.5; },
    update(dt = 0) {
      dt = Math.min(dt, 0.1);
      raise += clamp(raiseTarget - raise, -dt * 2.5, dt * 2.5);
      speed = baseSpeed * (1 - raise);
      uni.uRaise.value = raise;
      uni.uPhase.value += uni.uK.value * speed * dt;
    },
  };
  return api;
}

// =====================================================================================================
//  MONKEYS (grey langur / rhesus macaque) — primate rig, bind pose upright
// =====================================================================================================
function monkeyTemplate(kind) {
  const L = kind === 'langur';
  const s = L ? 1.12 : 1.0;
  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('hips', 'root', 0, 0.34 * s, 0)
    .bone('spine', 'hips', 0, 0.44 * s, 0)
    .bone('chest', 'spine', 0, 0.54 * s, 0)
    .bone('neck', 'chest', 0, 0.62 * s, 0.01)
    .bone('head', 'neck', 0, 0.665 * s, 0.015)
    .bone('armL1', 'chest', 0.08 * s, 0.6 * s, 0).bone('armL2', 'armL1', 0.09 * s, 0.43 * s, 0).bone('handL', 'armL2', 0.092 * s, 0.26 * s, 0.01)
    .bone('armR1', 'chest', -0.08 * s, 0.6 * s, 0).bone('armR2', 'armR1', -0.09 * s, 0.43 * s, 0).bone('handR', 'armR2', -0.092 * s, 0.26 * s, 0.01)
    .bone('legL1', 'hips', 0.05 * s, 0.33 * s, 0).bone('legL2', 'legL1', 0.05 * s, 0.17 * s, 0.01).bone('footL', 'legL2', 0.05 * s, 0.025 * s, 0.0)
    .bone('legR1', 'hips', -0.05 * s, 0.33 * s, 0).bone('legR2', 'legR1', -0.05 * s, 0.17 * s, 0.01).bone('footR', 'legR2', -0.05 * s, 0.025 * s, 0.0)
    .bone('tail1', 'hips', 0, 0.31 * s, -0.07 * s).bone('tail2', 'tail1', 0, 0.2 * s, -0.16 * s).bone('tail3', 'tail2', 0, 0.06 * s, -0.25 * s).bone('tail4', 'tail3', 0, -0.1 * s, -0.33 * s);
  const fur = col(L ? 0x9a948a : 0x8b6c4b), furBack = col(L ? 0x7c7468 : 0x7a5c3d), furLight = col(L ? 0xcac2b2 : 0xa98a66), hind = col(L ? 0xa8a090 : 0xb07a46);
  const skinDark = col(L ? 0x15120f : 0xc77d6b), handCol = col(L ? 0x1a1613 : 0x7a5a48);
  const furCol = (p, n) => {
    const c = fur.clone().lerp(furBack, smoothstep(0.0, -0.8, n.z) * 0.6);
    c.lerp(furLight, smoothstep(0.1, 0.8, n.z) * 0.45);
    if (!L) c.lerp(hind, smoothstep(0.45 * s, 0.32 * s, p.y) * smoothstep(0.0, -0.6, n.z) * 0.7);
    return c;
  };
  const S = (v) => v * s;
  // torso (vertical loft)
  K.add(loft([
    { p: [0, S(0.26), -0.005], w: S(0.04), h: S(0.035) },
    { p: [0, S(0.3), -0.005], w: S(0.075), h: S(0.06) },
    { p: [0, S(0.38), 0], w: S(0.085), h: S(0.07) },
    { p: [0, S(0.46), 0.005], w: S(0.08), h: S(0.068) },
    { p: [0, S(0.54), 0.0], w: S(0.09), h: S(0.07) },
    { p: [0, S(0.6), -0.005], w: S(0.085), h: S(0.06) },
    { p: [0, S(0.635), 0], w: S(0.04), h: S(0.03) },
  ], { seg: 12, ref: [0, 0, 1] }), furCol, chain([{ u: S(0.36), bone: 'hips' }, { u: S(0.45), bone: 'spine' }, { u: S(0.54), bone: 'chest' }], p => p.y));
  // head
  const hy = S(0.7);
  K.add(ellipsoid(0, hy, S(0.005), S(0.052), S(0.056), S(0.055), 12, 9), (p, n) => {
    if (L) { // black face on the front, pale fringe around
      const front = n.z > 0.45 && p.y < hy + S(0.03);
      return front ? skinDark.clone() : furLight.clone().lerp(fur, smoothstep(0.2, -0.6, n.z));
    }
    const front = n.z > 0.5 && p.y < hy + S(0.025); return front ? skinDark.clone() : furCol(p, n);
  }, 'head');
  K.add(ellipsoid(0, hy - S(0.02), S(0.045), S(0.032), S(0.03), S(0.026), 10, 7), skinDark, 'head'); // muzzle
  K.add(ellipsoid(0, hy + S(0.018), S(0.044), S(0.042), S(0.012), S(0.016), 10, 5), L ? 0x0c0a09 : 0xb06a5a, 'head'); // brow ridge
  for (const sx of [1, -1]) {
    K.add(ellipsoid(sx * S(0.019), hy + S(0.004), S(0.052), S(0.008), S(0.007), S(0.005), 6, 4), L ? 0x8a5a20 : 0x3a2412, 'head'); // eyes
    K.add(ellipsoid(sx * S(0.05), hy + S(0.005), S(0.0), S(0.008), S(0.016), S(0.013), 6, 5), L ? 0x15120f : 0xc4806e, 'head'); // ears
    if (L) K.add(ellipsoid(sx * S(0.045), hy - S(0.01), S(0.02), S(0.02), S(0.035), S(0.03), 8, 6), furLight, 'head'); // cheek fringe
  }
  if (L) K.add(ellipsoid(0, hy + S(0.045), S(0.0), S(0.05), S(0.03), S(0.05), 10, 6), furLight, 'head'); // crown tuft
  // neck
  K.add(limb([0, S(0.6), 0], [0, S(0.67), S(0.01)], S(0.04), S(0.035), 8), furCol, blend2('chest', 'head', p => (p.y - S(0.6)) / S(0.07)));
  // arms
  for (const [sx, a1, a2, hd] of [[1, 'armL1', 'armL2', 'handL'], [-1, 'armR1', 'armR2', 'handR']]) {
    K.add(limb([sx * S(0.08), S(0.6), 0], [sx * S(0.09), S(0.43), 0], S(0.032), S(0.025), 8, 1.05), furCol, a1);
    K.add(limb([sx * S(0.09), S(0.43), 0], [sx * S(0.092), S(0.27), S(0.01)], S(0.025), S(0.02), 8), (p, n) => L ? furCol(p, n).lerp(handCol, smoothstep(S(0.32), S(0.27), p.y)) : furCol(p, n), a2);
    K.add(ellipsoid(sx * S(0.093), S(0.23), S(0.015), S(0.016), S(0.04), S(0.022), 8, 6), handCol, hd);
  }
  // legs
  for (const [sx, l1, l2, ft] of [[1, 'legL1', 'legL2', 'footL'], [-1, 'legR1', 'legR2', 'footR']]) {
    K.add(limb([sx * S(0.05), S(0.34), 0], [sx * S(0.05), S(0.17), S(0.01)], S(0.045), S(0.03), 8, 1.05), furCol, l1);
    K.add(limb([sx * S(0.05), S(0.17), S(0.01)], [sx * S(0.05), S(0.03), 0], S(0.03), S(0.022), 8), furCol, l2);
    K.add(ellipsoid(sx * S(0.05), S(0.015), S(0.035), S(0.022), S(0.014), S(0.055), 8, 5), handCol, ft);
  }
  // tail
  const tl = L ? 1 : 0.32;
  const tp = [[0, 0.31, -0.07], [0, 0.2, -0.16], [0, 0.06, -0.25], [0, -0.1, -0.33], [0, -0.28, -0.38], [0, -0.46, -0.4]].map((p, i) => i === 0 ? p : [0, lerp(0.31, p[1], tl), lerp(-0.07, p[2], tl)]).map(p => [p[0], p[1] * s, p[2] * s]);
  const tailG = tube(tp, L ? [0.022, 0.018, 0.016, 0.014, 0.012, 0.009].map(v => v * s) : [0.022, 0.018, 0.014, 0.012, 0.01, 0.008].map(v => v * s), { n: 14, seg: 6 });
  K.add(tailG, (p, n) => furCol(p, n).lerp(L ? col(0x6e675e) : furBack, 0.3),
    chain([{ u: 0.0, bone: 'tail1' }, { u: 0.25, bone: 'tail2' }, { u: 0.5, bone: 'tail3' }, { u: 0.75, bone: 'tail4' }], p => clamp((S(0.31) - p.y) / (S(0.77) * tl) * 0.75 + clamp((-p.z - S(0.07)) / (S(0.33) * tl), 0, 1) * 0.25, 0, 1)));
  return K.build();
}

function monkeyPose(T, pose, t, o, perch, s) {
  const look = wander(t * 1.4, o.a);
  if (pose === 'walk') {
    // quadrupedal walk: torso pitched forward, arms become front legs
    const per = 0.75, base = t / per;
    T['hips.rx'] = 1.15; T['root.py'] = -0.02 * s; T['spine.rx'] = 0.05; T['chest.rx'] = 0.05;
    T['neck.rx'] = -0.9; T['head.rx'] = -0.3; T['head.ry'] = look * 0.2;
    const legs = [['legL', 0.0, false], ['armL', 0.25, true], ['legR', 0.5, false], ['armR', 0.75, true]];
    for (const [n, off, arm] of legs) {
      const [u, lift] = legCycle(base + off);
      if (arm) { T[n + '1.rx'] = -1.25 + u * 0.4; T[n + '2.rx'] = -lift * 0.7 - 0.05; T[(n === 'armL' ? 'handL' : 'handR') + '.rx'] = 1.0; }
      else { T[n + '1.rx'] = -1.0 + u * 0.45; T[n + '2.rx'] = 0.6 + lift * 0.6; T[(n === 'legL' ? 'footL' : 'footR') + '.rx'] = 0.4; }
    }
    T['tail1.rx'] = -1.6; T['tail2.rx'] = -0.4; T['tail3.rx'] = 0.5; T['tail4.rx'] = 0.6;
    T['root.py'] += Math.cos(base * Math.PI * 4) * 0.008;
    return;
  }
  // sit (on a wall/ground): buttocks at y=0
  T['root.py'] = -0.3 * s;
  T['spine.rx'] = 0.22; T['chest.rx'] = 0.12 + Math.sin(t * 1.8) * 0.01;
  T['neck.rx'] = -0.18; T['head.rx'] = -0.08 + wander(t, o.b) * 0.12; T['head.ry'] = look * 0.75; T['head.rz'] = wander(t, o.c) * 0.1;
  T['legL1.rx'] = -2.2; T['legR1.rx'] = -2.15; T['legL1.rz'] = 0.25; T['legR1.rz'] = -0.25;
  T['legL2.rx'] = 2.3; T['legR2.rx'] = 2.25; T['footL.rx'] = -0.1; T['footR.rx'] = -0.1;
  // arms rest on knees; occasionally scratch / eat
  const act = Math.sin(t * 0.21 + o.a);
  T['armL1.rx'] = -0.45; T['armL2.rx'] = -0.4; T['armL1.rz'] = 0.08; T['handL.rx'] = -0.3;
  T['armR1.rx'] = -0.42; T['armR2.rx'] = -0.45; T['armR1.rz'] = -0.08; T['handR.rx'] = -0.3;
  if (act > 0.55) { // eat: hand to mouth
    const k = smoothstep(0.55, 0.7, act);
    T['armR1.rx'] = lerp(-0.42, -0.75, k); T['armR2.rx'] = lerp(-0.45, -2.3, k) + Math.sin(t * 6) * 0.06 * k; T['armR1.rz'] = lerp(-0.08, 0.3, k);
    T['head.ry'] *= 1 - k; T['head.rx'] += 0.15 * k;
  } else if (act < -0.7) { // scratch side
    const k = smoothstep(-0.7, -0.85, act);
    T['armL1.rx'] = lerp(-0.45, -0.2, k); T['armL1.rz'] = lerp(0.08, 1.0, k); T['armL2.rx'] = lerp(-0.4, -1.9, k) + Math.sin(t * 14) * 0.25 * k;
  }
  if (perch) { // tail hangs down over the wall edge behind
    T['tail1.rx'] = 0.25; T['tail2.rx'] = 0.35 + Math.sin(t * 0.8 + o.c) * 0.08; T['tail3.rx'] = 0.25; T['tail4.rx'] = 0.1;
    T['tail2.rz'] = Math.sin(t * 0.6 + o.a) * 0.12; T['tail3.rz'] = Math.sin(t * 0.6 + o.a - 0.6) * 0.15;
  } else { // tail lies curled on the ground
    T['tail1.rx'] = -1.25; T['tail2.ry'] = 0.6; T['tail3.ry'] = 0.7; T['tail4.ry'] = 0.6 + Math.sin(t * 0.7) * 0.15; T['tail2.rx'] = -0.2;
  }
}

export function createMonkey({ seed = 1, kind, pose = 'sit', perch = true } = {}) {
  const r = makeRng(seed * 6007 + 3);
  const k = kind === 'rhesus' || kind === 'langur' ? kind : (r() < 0.55 ? 'langur' : 'rhesus');
  const tpl = cachedTemplate('monkey_' + k, () => monkeyTemplate(k));
  const { group, anim } = makeInstance(tpl, getAnimalMaterial('none'), 'monkey');
  const s = k === 'langur' ? 1.12 : 1.0;
  const sc = r.range(0.85, 1.05); group.scale.setScalar(sc);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const T = {}; let t = r() * 100; let cur = pose;
  const api = {
    group, kind: k, walkSpeed: 0.9 * sc,
    get pose() { return cur; },
    setPose(p) { if (p === cur) return; anim.transition(0.7); cur = p; },
    update(dt = 0) { dt = Math.min(dt, 0.1); t += dt; for (const kk in T) T[kk] = 0; monkeyPose(T, cur, t, o, perch, s); anim.apply(T, dt); },
  };
  api.update(0);
  return api;
}

// =====================================================================================================
//  CHITAL (spotted deer)
// =====================================================================================================
function deerTemplate(male) {
  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('body', 'root', 0, 0.84, 0)
    .bone('neck', 'body', 0, 0.96, 0.4)
    .bone('head', 'neck', 0, 1.3, 0.6)
    .bone('earL', 'head', 0.05, 1.37, 0.6).bone('earR', 'head', -0.05, 1.37, 0.6)
    .bone('tail1', 'body', 0, 0.95, -0.6)
    .bone('fl1', 'body', 0.085, 0.82, 0.3).bone('fl2', 'fl1', 0.08, 0.41, 0.33)
    .bone('fr1', 'body', -0.085, 0.82, 0.3).bone('fr2', 'fr1', -0.08, 0.41, 0.33)
    .bone('bl1', 'body', 0.085, 0.88, -0.42).bone('bl2', 'bl1', 0.08, 0.41, -0.53)
    .bone('br1', 'body', -0.085, 0.88, -0.42).bone('br2', 'br1', -0.08, 0.41, -0.53);
  const coat = col(0xb3632a), coatD = col(0x6b3a1c), white = col(0xf0e8dc), dark = col(0x1a1310);
  const coatCol = (p, n) => {
    const c = coat.clone();
    c.lerp(coatD, smoothstep(0.75, 0.97, n.y) * 0.75); // dorsal stripe
    c.lerp(white, smoothstep(-0.35, -0.7, n.y));
    return c;
  };
  const spotMask = (n) => clamp(1 - smoothstep(-0.2, -0.5, n.y) - smoothstep(0.85, 0.97, n.y), 0, 1);
  K.add(loft([
    { p: [0, 0.9, -0.63], w: 0.05, h: 0.05 },
    { p: [0, 0.89, -0.55], w: 0.12, h: 0.14 },
    { p: [0, 0.86, -0.37], w: 0.15, h: 0.18 },
    { p: [0, 0.83, -0.08], w: 0.155, h: 0.19 },
    { p: [0, 0.85, 0.2], w: 0.15, h: 0.19 },
    { p: [0, 0.89, 0.38], w: 0.12, h: 0.16 },
    { p: [0, 0.93, 0.48], w: 0.06, h: 0.08 },
  ], { seg: 14, exp: 2.1 }), coatCol, 'body', (p, n) => [spotMask(n), 0]);
  // haunch
  for (const sx of [1, -1]) K.add(ellipsoid(sx * 0.085, 0.8, -0.42, 0.075, 0.13, 0.12, 10, 7), coatCol, sx > 0 ? 'bl1' : 'br1', (p, n) => [spotMask(n) * 0.9, 0]);
  // neck
  K.add(loft([
    { p: [0, 0.94, 0.36], w: 0.08, h: 0.12 },
    { p: [0, 1.05, 0.46], w: 0.065, h: 0.1 },
    { p: [0, 1.17, 0.54], w: 0.058, h: 0.085 },
    { p: [0, 1.28, 0.6], w: 0.055, h: 0.07 },
  ], { seg: 10, capStart: false, capEnd: false }), (p, n) => {
    const c = coatCol(p, n); if (n.z > 0.4 && p.y > 1.12) c.lerp(white, 0.8); return c; // white throat patch
  }, chain([{ u: 0.0, bone: 'body' }, { u: 0.35, bone: 'neck' }, { u: 1.0, bone: 'head' }], p => (p.y - 0.94) / 0.36));
  // head (pointing forward/down)
  K.add(loft([
    { p: [0, 1.36, 0.58], w: 0.05, h: 0.05 },
    { p: [0, 1.35, 0.63], w: 0.062, h: 0.065 },
    { p: [0, 1.31, 0.7], w: 0.052, h: 0.056 },
    { p: [0, 1.26, 0.78], w: 0.038, h: 0.042 },
    { p: [0, 1.23, 0.83], w: 0.03, h: 0.032 },
    { p: [0, 1.22, 0.85], w: 0.02, h: 0.02 },
  ], { seg: 10 }), (p, n) => {
    const c = coat.clone().lerp(coatD, 0.15);
    if (p.z > 0.8) c.lerp(dark, 0.9); // dark muzzle
    if (n.y < -0.5) c.lerp(white, 0.6);
    return c;
  }, 'head');
  for (const sx of [1, -1]) {
    K.add(ellipsoid(sx * 0.052, 1.345, 0.665, 0.012, 0.014, 0.016, 6, 5), 0x080605, 'head'); // eye
    K.add(ellipsoid(sx * 0.055, 1.33, 0.67, 0.006, 0.02, 0.012, 6, 4), 0xefe6da, 'head'); // eye ring hint
  }
  for (const [sx, b] of [[1, 'earL'], [-1, 'earR']]) {
    K.add(ellipsoid(sx * 0.09, 1.4, 0.59, 0.065, 0.032, 0.012, 10, 6, [0, 0.2 * sx, sx * 0.55]), (p, n) => n.z > 0.2 ? col(0xe6d6c2) : coat.clone(), b);
  }
  if (male) { // three-tined lyre antlers
    for (const sx of [1, -1]) {
      const beam = [[sx * 0.035, 1.39, 0.6], [sx * 0.08, 1.52, 0.57], [sx * 0.13, 1.7, 0.54], [sx * 0.15, 1.88, 0.58], [sx * 0.13, 2.02, 0.64]];
      K.add(tube(beam, [0.018, 0.016, 0.013, 0.01, 0.004], { n: 9, seg: 6 }), 0x5a4632, 'head');
      K.add(tube([[sx * 0.05, 1.45, 0.6], [sx * 0.07, 1.52, 0.7], [sx * 0.07, 1.56, 0.78]], [0.011, 0.008, 0.003], { n: 5, seg: 5 }), 0x5a4632, 'head');
      K.add(tube([[sx * 0.15, 1.85, 0.57], [sx * 0.19, 1.95, 0.5], [sx * 0.2, 2.0, 0.46]], [0.009, 0.006, 0.002], { n: 5, seg: 5 }), 0x5a4632, 'head');
      K.add(ellipsoid(sx * 0.035, 1.39, 0.6, 0.022, 0.012, 0.022, 6, 4), 0x3a2c20, 'head'); // pedicle burr
    }
  }
  // legs (very slender)
  const legCol = (p, n) => { const c = coat.clone().lerp(white, smoothstep(-0.1, -0.7, n.x * Math.sign(p.x)) * 0.7); c.lerp(coat, 0); return c.multiplyScalar(0.85 + 0.15 * smoothstep(0.1, 0.7, p.y)); };
  for (const [nm, sx] of [['fl', 1], ['fr', -1]]) {
    K.add(limb([sx * 0.085, 0.84, 0.3], [sx * 0.08, 0.41, 0.33], 0.055, 0.026, 8, 1.05), legCol, nm + '1');
    K.add(limb([sx * 0.08, 0.41, 0.33], [sx * 0.08, 0.04, 0.345], 0.024, 0.018, 6), legCol, nm + '2');
    K.add(ellipsoid(sx * 0.08, 0.025, 0.355, 0.02, 0.026, 0.03, 6, 5), 0x15100c, nm + '2');
  }
  for (const [nm, sx] of [['bl', 1], ['br', -1]]) {
    K.add(limb([sx * 0.085, 0.86, -0.42], [sx * 0.08, 0.41, -0.53], 0.07, 0.028, 8, 1.0), legCol, nm + '1');
    K.add(limb([sx * 0.08, 0.41, -0.53], [sx * 0.08, 0.04, -0.47], 0.026, 0.019, 6), legCol, nm + '2');
    K.add(ellipsoid(sx * 0.08, 0.025, -0.455, 0.02, 0.026, 0.03, 6, 5), 0x15100c, nm + '2');
  }
  // tail: short, dark top, white under
  K.add(tube([[0, 0.95, -0.6], [0, 0.88, -0.65], [0, 0.78, -0.67]], [0.03, 0.026, 0.012], { n: 5, seg: 7 }), (p, n) => n.z < -0.2 && n.y > -0.2 ? coatD.clone() : white.clone(), 'tail1');
  return K.build();
}

function deerPose(T, pose, t, o) {
  T['tail1.rx'] = 0.2 + twitch(t, o.a, 1.2, 10) * -0.9; T['tail1.rz'] = Math.sin(t * 5) * 0.2 * twitch(t, o.b, 0.5, 6);
  T['earL.rz'] = twitch(t, o.b, 0.9) * 0.5; T['earR.rz'] = -twitch(t, o.c, 1.0) * 0.5;
  T['earL.ry'] = 0.2 + wander(t * 2, o.a) * 0.3; T['earR.ry'] = -0.2 - wander(t * 2, o.c) * 0.3;
  T['body.py'] = Math.sin(t * 1.5) * 0.003;
  if (pose === 'walk') {
    quadWalk(T, t, 0.95, { up: 0.38, hindUp: 0.34, knee: 1.1, hock: 0.8, bob: 0.01, roll: 0.02 });
    T['neck.rx'] = 0.1 + Math.cos(t / 0.95 * Math.PI * 4) * 0.04;
    return;
  }
  // graze cycle: head down eating, then up alert (stand pose = alert)
  const up = pose === 'stand' ? 1 : smoothstep(0.55, 0.8, Math.sin(t * 0.2 + o.a));
  T['neck.rx'] = lerp(1.55, -0.05, up); T['head.rx'] = lerp(0.55, 0.0, up);
  T['neck.ry'] = lerp(Math.sin(t * 0.5) * 0.15, wander(t * 1.5, o.b) * 0.5, up);
  T['fl1.rx'] = lerp(-0.12, 0, up); T['fr1.rx'] = lerp(0.1, 0, up);
}

export function createDeer({ seed = 1, male, pose = 'graze' } = {}) {
  const r = makeRng(seed * 4241 + 17);
  const m = male === undefined ? r() < 0.45 : !!male;
  const tpl = cachedTemplate('deer_' + (m ? 'm' : 'f'), () => deerTemplate(m));
  const { group, anim } = makeInstance(tpl, getAnimalMaterial('spots'), 'deer');
  const sc = r.range(0.88, 1.05) * (m ? 1.04 : 0.95); group.scale.setScalar(sc);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const T = {}; let t = r() * 100; let cur = pose;
  const api = {
    group, kind: 'deer', male: m, walkSpeed: 1.2 * sc,
    get pose() { return cur; },
    setPose(p) { if (p === cur) return; anim.transition(0.5); cur = p; },
    update(dt = 0) { dt = Math.min(dt, 0.1); t += dt; for (const k in T) T[k] = 0; deerPose(T, cur, t, o); anim.apply(T, dt); },
  };
  api.update(0);
  return api;
}

// =====================================================================================================
//  DOG (Indian pariah)
// =====================================================================================================
const DOG_PAL = [
  { base: 0xc48a52, light: 0xe8cfab, dark: 0x8a5a30 }, // classic tan
  { base: 0xa8693a, light: 0xd8b48a, dark: 0x5a3418 }, // reddish
  { base: 0x2a2420, light: 0xc79a66, dark: 0x16120f }, // black & tan
  { base: 0xe9e1d3, light: 0xf4efe6, dark: 0xb39a7a }, // white
];
function dogTemplate(pi) {
  const pal = DOG_PAL[pi];
  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('body', 'root', 0, 0.47, 0)
    .bone('neck', 'body', 0, 0.56, 0.27)
    .bone('head', 'neck', 0, 0.69, 0.4)
    .bone('jaw', 'head', 0, 0.66, 0.47)
    .bone('earL', 'head', 0.04, 0.77, 0.42).bone('earR', 'head', -0.04, 0.77, 0.42)
    .bone('tail1', 'body', 0, 0.53, -0.37).bone('tail2', 'tail1', 0, 0.66, -0.44).bone('tail3', 'tail2', 0, 0.75, -0.39)
    .bone('fl1', 'body', 0.06, 0.46, 0.21).bone('fl2', 'fl1', 0.055, 0.17, 0.23)
    .bone('fr1', 'body', -0.06, 0.46, 0.21).bone('fr2', 'fr1', -0.055, 0.17, 0.23)
    .bone('bl1', 'body', 0.06, 0.49, -0.29).bone('bl2', 'bl1', 0.055, 0.17, -0.36)
    .bone('br1', 'body', -0.06, 0.49, -0.29).bone('br2', 'br1', -0.055, 0.17, -0.36);
  const base = col(pal.base), light = col(pal.light), dark = col(pal.dark);
  const coat = (p, n) => { const c = base.clone(); c.lerp(light, smoothstep(-0.2, -0.7, n.y)); c.lerp(dark, smoothstep(0.7, 0.98, n.y) * 0.3); return c; };
  K.add(loft([
    { p: [0, 0.5, -0.41], w: 0.04, h: 0.045 },
    { p: [0, 0.5, -0.35], w: 0.082, h: 0.095 },
    { p: [0, 0.49, -0.2], w: 0.08, h: 0.088 },
    { p: [0, 0.48, 0.03], w: 0.098, h: 0.125 },
    { p: [0, 0.5, 0.2], w: 0.1, h: 0.13 },
    { p: [0, 0.53, 0.3], w: 0.07, h: 0.09 },
    { p: [0, 0.55, 0.35], w: 0.035, h: 0.045 },
  ], { seg: 12 }), coat, 'body');
  K.add(loft([
    { p: [0, 0.54, 0.26], w: 0.06, h: 0.075 },
    { p: [0, 0.61, 0.33], w: 0.052, h: 0.065 },
    { p: [0, 0.68, 0.39], w: 0.048, h: 0.055 },
  ], { seg: 10, capStart: false, capEnd: false }), coat, chain([{ u: 0.0, bone: 'body' }, { u: 0.4, bone: 'neck' }, { u: 1.0, bone: 'head' }], p => (p.y - 0.54) / 0.14));
  // head: skull + wedge muzzle
  K.add(ellipsoid(0, 0.715, 0.43, 0.06, 0.06, 0.07, 10, 8), coat, 'head');
  K.add(loft([
    { p: [0, 0.705, 0.47], w: 0.042, h: 0.04 },
    { p: [0, 0.69, 0.53], w: 0.03, h: 0.03 },
    { p: [0, 0.68, 0.58], w: 0.022, h: 0.022 },
  ], { seg: 8 }), (p) => p.z > 0.555 ? dark.clone().lerp(col(0x111111), 0.6) : light.clone().lerp(base, 0.5), 'head');
  K.add(ellipsoid(0, 0.684, 0.585, 0.014, 0.011, 0.009, 6, 4), 0x0c0b0a, 'head'); // nose
  K.add(ellipsoid(0, 0.665, 0.52, 0.024, 0.012, 0.045, 8, 5), (p) => light.clone(), 'jaw');
  for (const sx of [1, -1]) K.add(ellipsoid(sx * 0.033, 0.73, 0.49, 0.009, 0.009, 0.006, 6, 4), 0x120c08, 'head');
  for (const [sx, b] of [[1, 'earL'], [-1, 'earR']]) {
    K.add(cone([sx * 0.04, 0.755, 0.42], [sx * 0.055, 0.83, 0.415], 0.025, 6), (p, n) => n.z > 0.3 ? light.clone() : dark.clone().lerp(base, 0.5), b);
  }
  for (const [nm, sx] of [['fl', 1], ['fr', -1]]) {
    K.add(limb([sx * 0.06, 0.47, 0.21], [sx * 0.055, 0.17, 0.23], 0.036, 0.022, 8, 1.05), coat, nm + '1');
    K.add(limb([sx * 0.055, 0.17, 0.23], [sx * 0.055, 0.03, 0.245], 0.021, 0.019, 6), (p, n) => light.clone().lerp(base, 0.3), nm + '2');
    K.add(ellipsoid(sx * 0.055, 0.018, 0.255, 0.022, 0.017, 0.03, 6, 4), (p) => light.clone(), nm + '2');
  }
  for (const [nm, sx] of [['bl', 1], ['br', -1]]) {
    K.add(limb([sx * 0.06, 0.48, -0.29], [sx * 0.055, 0.17, -0.36], 0.05, 0.022, 8, 1.0), coat, nm + '1');
    K.add(limb([sx * 0.055, 0.17, -0.36], [sx * 0.055, 0.03, -0.33], 0.021, 0.019, 6), (p, n) => light.clone().lerp(base, 0.3), nm + '2');
    K.add(ellipsoid(sx * 0.055, 0.018, -0.32, 0.022, 0.017, 0.03, 6, 4), (p) => light.clone(), nm + '2');
  }
  // curled tail
  K.add(tube([[0, 0.53, -0.37], [0, 0.6, -0.43], [0, 0.69, -0.44], [0.02, 0.75, -0.4], [0.04, 0.75, -0.34], [0.05, 0.71, -0.31]], [0.026, 0.026, 0.024, 0.022, 0.018, 0.01], { n: 10, seg: 6 }),
    (p, n) => base.clone().lerp(light, n.y < -0.3 ? 0.5 : 0.1),
    chain([{ u: 0.0, bone: 'tail1' }, { u: 0.4, bone: 'tail2' }, { u: 0.8, bone: 'tail3' }], p => clamp((p.y - 0.53) / 0.22 + (p.x > 0.015 ? 0.3 : 0), 0, 1)));
  return K.build();
}
function dogPose(T, pose, t, o) {
  const wag = Math.sin(t * (pose === 'walk' ? 9 : 6) + o.a) * (0.25 + 0.25 * Math.max(0, Math.sin(t * 0.3 + o.b)));
  T['tail1.ry'] = wag * 0.6; T['tail2.ry'] = wag * 0.5;
  T['earL.rz'] = twitch(t, o.b, 0.8) * 0.3; T['earR.rz'] = -twitch(t, o.c, 0.9) * 0.3;
  if (pose === 'walk') {
    quadWalk(T, t, 0.62, { up: 0.42, hindUp: 0.38, knee: 1.0, hock: 0.8, bob: 0.008, roll: 0.02 });
    T['neck.rx'] = 0.12; T['neck.ry'] = wander(t, o.a) * 0.15;
  } else if (pose === 'sit') {
    T['body.rx'] = -0.7; T['body.py'] = -0.16; T['body.pz'] = -0.05;
    T['fl1.rx'] = 0.7; T['fr1.rx'] = 0.7;
    T['bl1.rx'] = -0.75; T['br1.rx'] = -0.75; T['bl2.rx'] = 1.7; T['br2.rx'] = 1.7; T['bl1.rz'] = 0.2; T['br1.rz'] = -0.2;
    T['neck.rx'] = 0.45; T['head.rx'] = 0.15 + wander(t, o.c) * 0.1; T['neck.ry'] = wander(t * 1.3, o.a) * 0.6; T['head.rz'] = wander(t, o.b) * 0.12;
    T['tail1.rx'] = 1.1; T['tail1.ry'] = 0.5 + wag * 0.3;
    // occasional scratch with hind leg
    const sc = twitch(t, o.c, 0.15, 30);
    if (sc > 0.05) { T['bl1.rx'] = lerp(-0.75, -1.6, sc); T['bl2.rx'] = lerp(1.7, 1.2, sc) + Math.sin(t * 30) * 0.3 * sc; T['neck.ry'] = 0.6 * sc; T['head.rz'] = 0.4 * sc; }
  } else if (pose === 'sleep') {
    T['body.py'] = -0.33; T['body.rz'] = 1.25; T['body.pz'] = 0.0; T['body.px'] = 0.08;
    T['fl1.rx'] = -0.6; T['fr1.rx'] = -0.5; T['bl1.rx'] = -0.7; T['br1.rx'] = -0.5; T['bl2.rx'] = 0.6; T['br2.rx'] = 0.5;
    T['neck.rx'] = 0.25; T['neck.ry'] = -0.6; T['head.rz'] = -0.4; T['tail1.ry'] = 0.6; T['tail1.rx'] = 1.2;
    T['body.ry'] = Math.sin(t * 1.4) * 0.004;
  } else { // stand
    T['neck.ry'] = wander(t, o.a) * 0.5; T['neck.rx'] = wander(t, o.b) * 0.15; T['head.rz'] = wander(t, o.c) * 0.1;
  }
  T['body.py'] = (T['body.py'] || 0) + Math.sin(t * 2.2) * 0.003;
}
export function createDog({ seed = 1, pose } = {}) {
  const r = makeRng(seed * 2591 + 11);
  const pi = r.int(0, DOG_PAL.length - 1);
  const tpl = cachedTemplate('dog_' + pi, () => dogTemplate(pi));
  const { group, anim } = makeInstance(tpl, getAnimalMaterial('none'), 'dog');
  const sc = r.range(0.88, 1.08); group.scale.setScalar(sc);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const T = {}; let t = r() * 100; let cur = pose || r.pick(['sit', 'sit', 'stand', 'sleep']);
  const api = {
    group, kind: 'dog', walkSpeed: 1.3 * sc,
    get pose() { return cur; },
    setPose(p) { if (p === cur) return; anim.transition(0.6); cur = p; },
    update(dt = 0) { dt = Math.min(dt, 0.1); t += dt; for (const k in T) T[k] = 0; dogPose(T, cur, t, o); anim.apply(T, dt); },
  };
  api.update(0);
  return api;
}

// =====================================================================================================
//  ELEPHANT (Asian)
// =====================================================================================================
function elephantTemplate(tusks) {
  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('body', 'root', 0, 1.85, 0)
    .bone('neck', 'body', 0, 2.15, 0.95)
    .bone('head', 'neck', 0, 2.35, 1.12)
    .bone('earL', 'head', 0.36, 2.5, 1.12).bone('earR', 'head', -0.36, 2.5, 1.12)
    .bone('trunk1', 'head', 0, 2.02, 1.66).bone('trunk2', 'trunk1', 0, 1.55, 1.84).bone('trunk3', 'trunk2', 0, 1.05, 1.92).bone('trunk4', 'trunk3', 0, 0.62, 1.94)
    .bone('tail1', 'body', 0, 2.2, -1.3).bone('tail2', 'tail1', 0, 1.7, -1.4)
    .bone('fl1', 'body', 0.42, 1.55, 0.62).bone('fl2', 'fl1', 0.42, 0.8, 0.64)
    .bone('fr1', 'body', -0.42, 1.55, 0.62).bone('fr2', 'fr1', -0.42, 0.8, 0.64)
    .bone('bl1', 'body', 0.44, 1.6, -0.85).bone('bl2', 'bl1', 0.44, 0.82, -0.9)
    .bone('br1', 'body', -0.44, 1.6, -0.85).bone('br2', 'br1', -0.44, 0.82, -0.9);
  const skin = col(0x55504b), skinD = col(0x3e3a37), dust = col(0x7d6a58), pink = col(0xa88878);
  const skinCol = (p, n) => {
    const c = skin.clone().lerp(skinD, smoothstep(-0.2, -0.8, n.y) * 0.5);
    c.lerp(dust, smoothstep(0.6, 0.98, n.y) * 0.35); // dusty back
    return c;
  };
  K.add(loft([
    { p: [0, 1.86, -1.36], w: 0.25, h: 0.3 },
    { p: [0, 1.86, -1.22], w: 0.56, h: 0.64 },
    { p: [0, 1.9, -0.9], w: 0.69, h: 0.8 },
    { p: [0, 1.94, -0.4], w: 0.75, h: 0.87 },
    { p: [0, 1.93, 0.1], w: 0.76, h: 0.88 },
    { p: [0, 1.9, 0.55], w: 0.7, h: 0.84 },
    { p: [0, 1.93, 0.9], w: 0.56, h: 0.7 },
    { p: [0, 2.0, 1.1], w: 0.3, h: 0.4 },
  ], { seg: 16, exp: 2.1 }), skinCol, 'body');
  // head: domed with twin bumps
  K.add(ellipsoid(0, 2.42, 1.33, 0.43, 0.52, 0.42, 14, 10), skinCol, 'head');
  for (const sx of [1, -1]) K.add(ellipsoid(sx * 0.15, 2.82, 1.3, 0.2, 0.17, 0.22, 10, 7), skinCol, 'head');
  K.add(ellipsoid(0, 2.25, 1.55, 0.3, 0.32, 0.25, 12, 8), (p, n) => skinCol(p, n).lerp(pink, smoothstep(2.0, 2.4, p.y) * smoothstep(0.3, 0.9, n.z) * 0.35), 'head'); // face/forehead
  for (const sx of [1, -1]) K.add(ellipsoid(sx * 0.33, 2.38, 1.5, 0.025, 0.02, 0.022, 6, 4), 0x120e0c, 'head'); // eyes
  // neck
  K.add(loft([
    { p: [0, 2.0, 0.85], w: 0.55, h: 0.62 },
    { p: [0, 2.2, 1.05], w: 0.45, h: 0.5 },
  ], { seg: 12, capStart: false, capEnd: false }), skinCol, blend2('body', 'head', p => (p.z - 0.85) / 0.25));
  // trunk
  const tp = [[0, 2.08, 1.68], [0, 1.8, 1.8], [0, 1.45, 1.87], [0, 1.1, 1.92], [0, 0.78, 1.95], [0, 0.5, 1.97], [0, 0.32, 2.02]];
  K.add(tube(tp, [0.2, 0.17, 0.14, 0.115, 0.095, 0.075, 0.065], { n: 16, seg: 10 }), (p, n) => {
    const c = skinCol(p, n); c.lerp(pink, smoothstep(1.7, 2.0, p.y) * 0.4 * (0.5 + 0.5 * Math.sin(p.x * 60) * Math.sin(p.y * 40))); return c;
  }, chain([{ u: 0.0, bone: 'trunk1' }, { u: 0.3, bone: 'trunk2' }, { u: 0.6, bone: 'trunk3' }, { u: 0.86, bone: 'trunk4' }], p => clamp((2.08 - p.y) / 1.76, 0, 1)));
  // ears (smaller, Asian)
  for (const [sx, b] of [[1, 'earL'], [-1, 'earR']]) {
    K.add(ellipsoid(sx * 0.48, 2.3, 1.08, 0.05, 0.42, 0.3, 12, 8, [0.1, -sx * 0.35, sx * 0.12]), (p, n) => {
      const c = skinCol(p, n); c.lerp(pink, smoothstep(2.0, 2.6, p.y) * 0.5 * smoothstep(0.35, 0.55, Math.abs(p.x))); return c;
    }, b);
  }
  if (tusks) for (const sx of [1, -1]) K.add(tube([[sx * 0.14, 1.98, 1.58], [sx * 0.15, 1.78, 1.72], [sx * 0.14, 1.66, 1.88]], [0.045, 0.035, 0.012], { n: 6, seg: 7 }), 0xeee6d2, 'head');
  // legs (pillars)
  for (const [nm, sx, z] of [['fl', 1, 0.62], ['fr', -1, 0.62], ['bl', 1, -0.86], ['br', -1, -0.86]]) {
    const front = nm[0] === 'f';
    K.add(limb([sx * (front ? 0.42 : 0.44), front ? 1.6 : 1.7, z], [sx * 0.42, 0.8, z + (front ? 0.02 : -0.04)], front ? 0.27 : 0.31, 0.21, 12, 1.0), skinCol, nm + '1');
    K.add(limb([sx * 0.42, 0.8, z + (front ? 0.02 : -0.04)], [sx * 0.42, 0.12, z + (front ? 0.03 : -0.02)], 0.21, 0.22, 12), skinCol, nm + '2');
    K.add(loft([{ p: [sx * 0.42, 0.0, z + 0.02], r: 0.235 }, { p: [sx * 0.42, 0.14, z + 0.02], r: 0.22 }], { seg: 12 }), skinD, nm + '2');
    for (let k = -1; k <= 1; k++) K.add(ellipsoid(sx * 0.42 + k * 0.1, 0.05, z + 0.02 + 0.2, 0.045, 0.04, 0.03, 6, 4), 0xcdc4b4, nm + '2'); // toenails
  }
  K.add(tube([[0, 2.2, -1.3], [0, 1.9, -1.38], [0, 1.55, -1.42], [0, 1.25, -1.43]], [0.05, 0.035, 0.025, 0.02], { n: 7, seg: 6 }), skinD,
    chain([{ u: 0.0, bone: 'tail1' }, { u: 0.5, bone: 'tail2' }], p => (2.2 - p.y) / 0.95));
  K.add(ellipsoid(0, 1.18, -1.43, 0.03, 0.1, 0.03, 6, 5), 0x1a1715, 'tail2');
  return K.build();
}
function elephantPose(T, pose, t, o) {
  const sw = Math.sin(t * 0.7 + o.a);
  T['trunk1.rx'] = 0.05 + Math.sin(t * 0.5 + o.b) * 0.08;
  T['trunk2.rx'] = 0.1 + Math.sin(t * 0.6 + o.a) * 0.15; T['trunk2.rz'] = Math.sin(t * 0.45 + o.c) * 0.18;
  T['trunk3.rx'] = 0.15 + Math.sin(t * 0.7 + o.b) * 0.2; T['trunk3.rz'] = Math.sin(t * 0.5 + o.a) * 0.2;
  T['trunk4.rx'] = -0.2 + Math.sin(t * 0.9) * 0.3 + twitch(t, o.c, 0.3, 6) * -0.6;
  const flap = Math.sin(t * 1.8 + o.c) * 0.5 + 0.5;
  T['earL.ry'] = 0.35 * flap; T['earR.ry'] = -0.35 * flap;
  T['tail1.rz'] = sw * 0.3; T['tail2.rz'] = sw * 0.4;
  if (pose === 'walk') {
    quadWalk(T, t, 2.0, { up: 0.24, hindUp: 0.22, knee: 0.6, hock: 0.45, bob: 0.03, roll: 0.03 });
    T['head.rx'] = Math.cos(t / 2.0 * Math.PI * 4) * 0.03;
  } else {
    T['body.rz'] = Math.sin(t * 0.4 + o.a) * 0.015; T['body.px'] = Math.sin(t * 0.4 + o.a) * 0.02;
    T['head.ry'] = wander(t * 0.6, o.b) * 0.12; T['head.rx'] = wander(t * 0.5, o.c) * 0.05;
    T['fl1.rz'] = -T['body.rz']; T['fr1.rz'] = -T['body.rz']; T['bl1.rz'] = -T['body.rz']; T['br1.rz'] = -T['body.rz'];
  }
}
export function createElephant({ seed = 1, male, pose = 'stand' } = {}) {
  const r = makeRng(seed * 15485863 + 1);
  const m = male === undefined ? r() < 0.5 : !!male;
  const tusks = m && r() < 0.75;
  const tpl = cachedTemplate('elephant_' + (tusks ? 't' : 'n'), () => elephantTemplate(tusks));
  const { group, anim } = makeInstance(tpl, getAnimalMaterial('none', { roughness: 0.95 }), 'elephant');
  const sc = r.range(0.88, 1.0) * (m ? 1.05 : 0.93); group.scale.setScalar(sc);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const T = {}; let t = r() * 100; let cur = pose;
  const api = {
    group, kind: 'elephant', male: m, walkSpeed: 0.9 * sc,
    get pose() { return cur; },
    setPose(p) { if (p === cur) return; anim.transition(1.0); cur = p; },
    update(dt = 0) { dt = Math.min(dt, 0.1); t += dt; for (const k in T) T[k] = 0; elephantPose(T, cur, t, o); anim.apply(T, dt); },
  };
  api.update(0);
  return api;
}

// =====================================================================================================
//  PEACOCK (Indian peafowl, male) — train of feather strips, can fan out ('display')
// =====================================================================================================
const PEA_N = 13;
function peacockTemplate() {
  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('body', 'root', 0, 0.47, 0)
    .bone('neck1', 'body', 0, 0.56, 0.1).bone('neck2', 'neck1', 0, 0.7, 0.15).bone('head', 'neck2', 0, 0.84, 0.17)
    .bone('legL1', 'body', 0.055, 0.42, 0.0).bone('legL2', 'legL1', 0.055, 0.22, 0.02)
    .bone('legR1', 'body', -0.055, 0.42, 0.0).bone('legR2', 'legR1', -0.055, 0.22, 0.02)
    .bone('train', 'body', 0, 0.5, -0.13);
  for (let i = 0; i < PEA_N; i++) K.bone('f' + i, 'train', 0, 0.5, -0.13);
  const blue = col(0x1b3c9a), blueL = col(0x2f78cf), green = col(0x2e6a3a), bronze = col(0x7a6a2a), rufous = col(0xa0522a), cream = col(0xd8cfb4);
  // body
  K.add(loft([
    { p: [0, 0.5, -0.17], w: 0.05, h: 0.05 },
    { p: [0, 0.49, -0.12], w: 0.095, h: 0.1 },
    { p: [0, 0.48, -0.02], w: 0.105, h: 0.12 },
    { p: [0, 0.5, 0.07], w: 0.095, h: 0.11 },
    { p: [0, 0.53, 0.13], w: 0.06, h: 0.07 },
  ], { seg: 12 }), (p, n) => {
    if (p.z > 0.02 || (n.z > 0.5)) return blue.clone().lerp(blueL, smoothstep(0.3, 0.9, n.y) * 0.5);
    if (Math.abs(n.x) > 0.55) { // wings: barred coverts + rufous primaries
      if (p.y < 0.45 && p.z < -0.02) return rufous.clone();
      return (Math.sin(p.z * 160) > 0.2 ? cream.clone() : col(0x2a2418));
    }
    return green.clone().lerp(bronze, 0.3); // scaled back
  }, 'body');
  // neck
  K.add(tube([[0, 0.55, 0.09], [0, 0.63, 0.13], [0, 0.72, 0.155], [0, 0.8, 0.165], [0, 0.85, 0.17]], [0.042, 0.035, 0.03, 0.026, 0.024], { n: 8, seg: 8 }),
    (p, n) => blue.clone().lerp(blueL, smoothstep(0.0, 0.8, n.z) * 0.5 + 0.1),
    chain([{ u: 0.0, bone: 'body' }, { u: 0.25, bone: 'neck1' }, { u: 0.6, bone: 'neck2' }, { u: 1.0, bone: 'head' }], p => (p.y - 0.55) / 0.3));
  // head
  K.add(ellipsoid(0, 0.875, 0.18, 0.024, 0.027, 0.034, 8, 6), blue, 'head');
  K.add(cone([0, 0.87, 0.21], [0, 0.865, 0.245], 0.009, 5), 0xa89878, 'head'); // beak
  for (const sx of [1, -1]) {
    K.add(ellipsoid(sx * 0.02, 0.882, 0.19, 0.006, 0.012, 0.012, 6, 4), 0xf4f2ec, 'head'); // white face stripe
    K.add(ellipsoid(sx * 0.023, 0.882, 0.195, 0.005, 0.005, 0.005, 5, 4), 0x0a0808, 'head');
  }
  for (let i = 0; i < 6; i++) { // crest fan
    const a = (i - 2.5) * 0.18;
    const tip = [Math.sin(a) * 0.035, 0.96, 0.17 + Math.cos(a) * 0.01 - 0.01];
    K.add(tube([[0, 0.895, 0.175], tip], 0.0018, { seg: 3 }), 0x1a2a50, 'head');
    K.add(ellipsoid(tip[0], tip[1], tip[2], 0.007, 0.009, 0.004, 5, 4), 0x2a6aa0, 'head');
  }
  // legs + feet
  for (const [sx, l1, l2] of [[1, 'legL1', 'legL2'], [-1, 'legR1', 'legR2']]) {
    K.add(limb([sx * 0.055, 0.44, 0.0], [sx * 0.055, 0.25, 0.02], 0.03, 0.014, 6), green.clone().lerp(bronze, 0.4), l1);
    K.add(limb([sx * 0.055, 0.25, 0.02], [sx * 0.055, 0.015, 0.02], 0.011, 0.009, 5), 0x8a7f6a, l2);
    for (const a of [-0.45, 0, 0.45]) K.add(tube([[sx * 0.055, 0.012, 0.02], [sx * 0.055 + Math.sin(a) * 0.06, 0.008, 0.02 + Math.cos(a) * 0.06]], 0.006, { seg: 4 }), 0x8a7f6a, l2);
    K.add(tube([[sx * 0.055, 0.012, 0.02], [sx * 0.055, 0.008, -0.03]], 0.005, { seg: 4 }), 0x8a7f6a, l2);
  }
  // under-tail (brown) + train strips
  K.add(ellipsoid(0, 0.47, -0.18, 0.06, 0.04, 0.09, 8, 5), 0x5a4428, 'train');
  const Ltr = 1.3;
  for (let i = 0; i < PEA_N; i++) {
    const off = (i - (PEA_N - 1) / 2) * 0.012;
    const st = [];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const z = -0.13 - u * Ltr;
      const y = 0.5 - Math.pow(u, 1.3) * 0.42 + (i % 2) * 0.004;
      const w = 0.02 + 0.085 * smoothstep(0.0, 0.55, u) - 0.02 * smoothstep(0.9, 1.0, u);
      st.push({ p: [off, y, z], w, h: 0.006 });
    }
    const g = loft(st, { seg: 6, exp: 2 });
    K.add(g, (p) => green.clone().lerp(bronze, 0.25 + 0.25 * Math.sin(p.z * 9)), 'f' + i, (p) => {
      const u = clamp((-0.13 - p.z) / Ltr, 0, 1);
      const w = 0.02 + 0.085 * smoothstep(0.0, 0.55, u);
      return [(p.x - off) / Math.max(0.03, w), u];
    });
  }
  return K.build();
}
function peacockPose(T, pose, t, o, dispK) {
  if (pose === 'walk') {
    const per = 0.9, ph = (t / per) * Math.PI * 2;
    T['legL1.rx'] = Math.sin(ph) * 0.45; T['legR1.rx'] = -Math.sin(ph) * 0.45;
    T['legL2.rx'] = Math.max(0, Math.cos(ph)) * -0.6; T['legR2.rx'] = Math.max(0, -Math.cos(ph)) * -0.6;
    T['body.py'] = -Math.abs(Math.sin(ph)) * 0.01; T['body.rz'] = Math.sin(ph) * 0.04;
    const bob = Math.sin(ph * 2); // head bob forward/back
    T['neck1.rx'] = 0.15 + bob * 0.12; T['neck2.rx'] = -0.1 - bob * 0.1; T['head.rx'] = -bob * 0.05;
  } else {
    const peck = twitch(t, o.a, 0.5, 6);
    T['neck1.rx'] = wander(t, o.b) * 0.1 + peck * 1.0; T['neck2.rx'] = peck * 0.6; T['head.rx'] = peck * 0.4;
    T['neck1.ry'] = wander(t * 1.3, o.c) * 0.3; T['head.ry'] = wander(t * 2.0, o.a) * 0.4;
  }
  // train
  const spread = (i) => (i - (PEA_N - 1) / 2) / ((PEA_N - 1) / 2);
  for (let i = 0; i < PEA_N; i++) {
    const s = spread(i);
    T['f' + i + '.ry'] = lerp(s * 0.05, s * 1.35, dispK) + (dispK > 0.5 ? Math.sin(t * 38 + i) * 0.01 * dispK : 0);
    T['f' + i + '.rx'] = lerp(0, -Math.abs(s) * 0.12, dispK);
  }
  T['train.rx'] = lerp(Math.sin(t * 0.8) * 0.02, 1.4, dispK);
  if (dispK > 0) { T['body.rx'] = (T['body.rx'] || 0) + 0.15 * dispK; T['neck1.rx'] = (T['neck1.rx'] || 0) - 0.15 * dispK; T['body.ry'] = Math.sin(t * 0.7) * 0.3 * dispK; }
}
export function createPeacock({ seed = 1, pose = 'stand' } = {}) {
  const r = makeRng(seed * 911 + 29);
  const tpl = cachedTemplate('peacock', peacockTemplate);
  const { group, anim } = makeInstance(tpl, getAnimalMaterial('eyes', { roughness: 0.6 }), 'peacock');
  const sc = r.range(0.92, 1.05); group.scale.setScalar(sc);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const T = {}; let t = r() * 100; let cur = pose; let disp = pose === 'display' ? 1 : 0;
  const api = {
    group, kind: 'peacock', walkSpeed: 0.5 * sc,
    get pose() { return cur; },
    setPose(p) { if (p === cur) return; if (p !== 'display' && cur !== 'display') anim.transition(0.4); cur = p; },
    update(dt = 0) {
      dt = Math.min(dt, 0.1); t += dt;
      disp = clamp(disp + (cur === 'display' ? dt : -dt) * 0.9, 0, 1);
      const dk = disp * disp * (3 - 2 * disp);
      for (const k in T) T[k] = 0; peacockPose(T, cur === 'display' ? 'stand' : cur, t, o, dk); anim.apply(T, dt);
    },
  };
  api.update(0);
  return api;
}

// =====================================================================================================
//  BIRD FLOCK — one InstancedMesh, wings flap in the vertex shader
// =====================================================================================================
let BIRD_GEO = null;
function birdGeometry() {
  if (BIRD_GEO) return BIRD_GEO;
  // unit bird, wingspan ≈ 1, faces +Z. aWing = signed span position (0 = body)
  const P = [], W = [], I = [];
  const add = (geo, wingFn) => {
    const o = P.length / 3; const pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) { P.push(pa.getX(i), pa.getY(i), pa.getZ(i)); W.push(wingFn ? wingFn(pa.getX(i)) : 0); }
    const idx = geo.index.array; for (let i = 0; i < idx.length; i++) I.push(idx[i] + o);
  };
  add(ellipsoid(0, 0, 0, 0.055, 0.05, 0.2, 8, 6));
  add(ellipsoid(0, 0.015, 0.19, 0.035, 0.035, 0.045, 6, 5));
  add(loft([{ p: [0, 0, -0.16], w: 0.03, h: 0.008 }, { p: [0, 0, -0.3], w: 0.09, h: 0.006 }, { p: [0, 0, -0.34], w: 0.1, h: 0.004 }], { seg: 6 }));
  for (const s of [1, -1]) {
    const st = [];
    for (let k = 0; k <= 5; k++) {
      const u = k / 5; const x = s * (0.04 + u * 0.48);
      st.push({ p: [x, 0, 0.03 - u * 0.05 * u], w: 0.1 - u * 0.055, h: 0.008 });
    }
    const g = loft(st.map(q => ({ ...q, p: q.p })), { seg: 6, ref: [0, 1, 0] });
    add(g, (x) => x);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  g.setIndex(I); g.computeVertexNormals();
  BIRD_GEO = g;
  return g;
}
const BIRD_KINDS = {
  kite: { scale: 1.4, color: 0x3b2e25, speed: [6, 9], flap: [3.2, 4.2], glide: true },
  crow: { scale: 0.9, color: 0x141414, speed: [8, 11], flap: [5, 6.5], glide: false },
  small: { scale: 0.32, color: 0x6b5a48, speed: [9, 13], flap: [11, 15], glide: false },
  parakeet: { scale: 0.42, color: 0x3fa142, speed: [11, 15], flap: [9, 12], glide: false },
};
export function createBirdFlock({ seed = 1, count = 12, radius = 40, height = 30, kind } = {}) {
  const r = makeRng(seed * 12345 + 9);
  const kd = BIRD_KINDS[kind] ? kind : r.pick(['kite', 'kite', 'crow', 'small', 'parakeet']);
  const K = BIRD_KINDS[kd];
  const geo = birdGeometry().clone();
  const phase = new Float32Array(count * 3);
  const birds = [];
  for (let i = 0; i < count; i++) {
    const fl = r.range(K.flap[0], K.flap[1]);
    phase[i * 3] = fl; phase[i * 3 + 1] = r() * 6.28; phase[i * 3 + 2] = K.glide ? 1 : 0;
    birds.push({
      cx: r.range(-0.4, 0.4) * radius, cz: r.range(-0.4, 0.4) * radius, rad: r.range(0.3, 0.8) * radius,
      h: height + r.range(-0.25, 0.25) * height, w: r.range(K.speed[0], K.speed[1]) / (r.range(0.3, 0.8) * radius) * r.sign(),
      a: r() * 6.28, off: [r.range(-4, 4), r.range(-2, 2), r.range(-4, 4)], sc: K.scale * r.range(0.85, 1.15),
    });
  }
  geo.setAttribute('aFlap', new THREE.InstancedBufferAttribute(phase, 3));
  const uni = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: K.color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aWing;\nattribute vec3 aFlap;\nfloat bFlap(){\n float gl = aFlap.z > 0.5 ? pow(max(0.0, sin(uTime*0.35 + aFlap.y*3.0)), 3.0) : step(-0.6, sin(uTime*1.3 + aFlap.y*2.0));\n float amp = mix(0.12, 0.95, gl);\n return sin(uTime * aFlap.x + aFlap.y) * amp + (aFlap.z > 0.5 ? 0.12 : 0.05);\n}')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nfloat fa = bFlap(); float sp = abs(aWing); float sd = sign(aWing);\nfloat ang = fa * sd * (1.0 + smoothstep(0.25, 0.52, sp) * 0.6);\nif (sp > 0.0) { float c = cos(ang), s = sin(ang); objectNormal = vec3(objectNormal.x * c - objectNormal.y * s, objectNormal.x * s + objectNormal.y * c, objectNormal.z); }')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (sp > 0.0) { float c = cos(ang), s = sin(ang); float hx = sd * 0.04; vec2 q = vec2(transformed.x - hx, transformed.y); transformed.x = hx + q.x * c - q.y * s; transformed.y = q.x * s + q.y * c; }');
  };
  mat.customProgramCacheKey = () => 'birdflap_v1';
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) { c.set(K.color).multiplyScalar(r.range(0.8, 1.2)); mesh.setColorAt(i, c); }
  const group = new THREE.Group(); group.name = 'birds_' + kd; group.add(mesh);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
  let t = r() * 100;
  // flock-level wander (all small birds move together)
  const flockMove = kd === 'small' || kd === 'parakeet';
  const api = {
    group, kind: kd,
    update(dt = 0) {
      dt = Math.min(dt, 0.1); t += dt; uni.uTime.value = t;
      for (let i = 0; i < count; i++) {
        const b = birds[i];
        let x, y, z, yaw, roll;
        if (flockMove) {
          const T = t * 0.18;
          const fx = Math.sin(T * 1.0 + seed) * radius * 0.6, fz = Math.sin(T * 1.3 + seed * 2) * radius * 0.6;
          const dx = Math.cos(T * 1.0 + seed) * 1.0, dz = Math.cos(T * 1.3 + seed * 2) * 1.3;
          x = fx + b.off[0] + Math.sin(t * 1.3 + i) * 0.8; z = fz + b.off[2] + Math.cos(t * 1.1 + i) * 0.8;
          y = b.h + b.off[1] + Math.sin(t * 2.2 + i) * 0.5;
          yaw = Math.atan2(dx, dz); roll = -Math.sin(T * 1.6 + seed) * 0.35;
        } else {
          b.a += b.w * dt;
          x = b.cx + Math.cos(b.a) * b.rad; z = b.cz + Math.sin(b.a) * b.rad;
          y = b.h + Math.sin(t * 0.3 + i) * 2.0;
          // tangent direction
          const tx = -Math.sin(b.a) * Math.sign(b.w), tz = Math.cos(b.a) * Math.sign(b.w);
          yaw = Math.atan2(tx, tz); roll = Math.sign(b.w) * (kd === 'kite' ? 0.45 : 0.3);
        }
        p.set(x, y, z); e.set(0, yaw, roll); q.setFromEuler(e); s.setScalar(b.sc);
        m4.compose(p, q, s); mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
  api.update(0);
  return api;
}

// Riders: Mayank, Tushar, Himanshu — fully procedural, hand-sculpted 3D characters (no photo textures).
//  • Head: sculpted face height-field (brow, sockets, nose bridge/tip/alae, lips, chin, cheekbones, jaw) on a
//    face-dense grid + separate high-res eyelid patches with real eyeballs (sclera / iris / pupil / catch-light),
//    eyebrows & lashes, shaped ears, painted skin (cheek/lip tint, stubble), jaw-open + blink morph targets.
//  • Hair: underlayer shell + layered hair locks (alpha strands) following per-style flow fields.
//  • Body: one SkinnedMesh (vertex colours + procedural cloth/armour patterns + fabric normal map).
// Draw calls: standing 6 (body, head, eyeL, eyeR, brows, hair) · riding with helmet 4 (body + helmet×3).
// Conventions: meters, Y up, rider faces +Z, left = +X. Standing: origin between the feet.
// Riding: put the rider group at the bike origin (same parent as the bike) — it sits on the standard seat.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, damp, createNoise2D } from '../core/util.js';
import { STANDARD_ANCHORS, _bikeGeo } from './bikes.js';

const { loft, alongY, flipWinding } = _bikeGeo;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const G = (v, s) => Math.exp(-(v * v) / (s * s));
const G2 = (a, sa, b, sb) => Math.exp(-(a * a) / (sa * sa) - (b * b) / (sb * sb));

// ------------------------------------------------------------------------------------------------ rider specs
export const RIDER_INFO = {
  mayank: { id: 'mayank', name: 'Mayank', age: 'Adult', bike: 'zx10r', height: 1.75 },
  tushar: { id: 'tushar', name: 'Tushar', age: 'Adult', bike: 's1000rr', height: 1.78 },
  himanshu: { id: 'himanshu', name: 'Himanshu', age: 'Teen', bike: 'panigale', height: 1.55 },
};

const RSPEC = {
  mayank: {
    H: 1.75, build: 0.95, headScale: 1.0, jacket: true, hair: 'puffy',
    skin: '#7b5544', lip: '#5e3330', iris: '#3a2416', stubble: 0.12, moustache: 0.0,
    face: { rx: 0.0755, len: 1.01, jaw: 1.20, cheek: 1.02, cheekFull: 0.7, noseW: 1.30, alarW: 0.0205, noseL: 1.04, noseH: 0.95, noseTip: 1.4, lipU: 1.14, lipL: 1.26, mouthW: 1.04, mouthOff: 0.0, smile: 0.03, brow: 1.22, browArch: 0.55, browY: 0.0205, eyeR: 0.0118, eyeX: 0.0318, eyeH: 0.92, hood: 1.0, chin: 0.95 },
    c: {
      body: '#a7abb1', sleeve: '#1e2943', collar: '#1e2943', armor: '#16171a', pipe: '#74c33c',
      pants: '#a1202b', stripe: '#111111', shoe: '#141414', sole: '#3b3b3d', shoeAccent: '#74c33c',
      glove: '#121213', gloveAccent: '#74c33c', zip: '#2a2a2c',
    },
    bracelet: ['#c3151c', '#e0261c'],
    helmet: { base: '#5fb52a', a: '#0b0b0c', b: '#f1f1f1', visor: '#3c8a2c' },
  },
  tushar: {
    H: 1.78, build: 0.94, headScale: 1.0, jacket: true, hair: 'swept',
    skin: '#956a58', lip: '#6e3e3a', iris: '#33200f', stubble: 0.0, moustache: 0.0,
    face: { rx: 0.0712, len: 0.99, jaw: 1.14, cheek: 0.94, cheekFull: 0.1, noseW: 1.15, alarW: 0.0190, noseL: 1.06, noseH: 1.0, noseTip: 1.15, lipU: 0.82, lipL: 0.98, mouthW: 1.0, mouthOff: -0.0035, smile: 0.12, brow: 0.76, browArch: 0.8, browY: 0.0195, eyeR: 0.0117, eyeX: 0.0320, eyeH: 0.95, hood: 1.1, chin: 1.12 },
    c: {
      body: '#c21f2b', sleeve: '#c21f2b', collar: '#151517', armor: '#16171a', pipe: '#f2f2f2',
      panel: '#f2f2f2', side: '#18181a',
      pants: '#3d4247', stripe: '#1c1f22', shoe: '#151515', sole: '#e9e9e9', shoeAccent: '#f2f2f2',
      glove: '#121213', gloveAccent: '#f2f2f2', zip: '#1a1a1c',
    },
    bracelet: ['#151515', '#c3151c'],
    helmet: { base: '#f3f4f6', a: '#1f86d8', b: '#1b2766', c: '#d0162b', visor: '#2457b8' },
  },
  himanshu: {
    H: 1.55, build: 0.90, headScale: 0.955, jacket: false, hair: 'fringe',
    skin: '#6a4537', lip: '#55302c', iris: '#24150b', stubble: 0.0, moustache: 0.0,
    face: { rx: 0.0775, len: 0.84, jaw: 1.12, cheek: 1.06, cheekFull: 0.85, noseW: 1.25, alarW: 0.0178, noseL: 0.92, noseH: 0.86, noseTip: 1.35, lipU: 1.08, lipL: 1.22, mouthW: 0.98, mouthOff: 0.0, smile: 0.10, brow: 1.2, browArch: 0.3, browY: 0.0185, eyeR: 0.0121, eyeX: 0.0305, eyeH: 1.0, hood: 0.8, chin: 0.85 },
    c: {
      body: '#7a1a2b', sleeve: '#7a1a2b', collar: '#6a1625', armor: '#7a1a2b', pipe: '#5e1421',
      pants: '#6b5a2f', stripe: '#111111', shoe: '#e6e6e6', sole: '#9a9a9a', shoeAccent: '#7a1a2b',
      glove: '#121213', gloveAccent: '#c00a12', zip: '#7a1a2b',
    },
    bracelet: ['#111111'],
    helmet: { base: '#c40a12', a: '#f2f2f2', b: '#0c0c0d', visor: '#1a1c1f' },
  },
};

/** Kept for API compatibility — characters are fully procedural now, nothing to load. */
export async function preloadRiders() { /* no-op */ }

// ------------------------------------------------------------------------------------------------ small spline helper
function crs(xs, ys, x) {   // Catmull-Rom through ascending knots
  const n = xs.length; if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  const p0 = ys[Math.max(i - 1, 0)], p1 = ys[i], p2 = ys[i + 1], p3 = ys[Math.min(i + 2, n - 1)];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function smax(a, b, k) { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, h) + k * h * (1 - h); }

// ------------------------------------------------------------------------------------------------ face sculpt (head space, adult, metres)
// Head centre at origin, eyes at y = +0.005, face toward +Z. Lower face (y<0) is expressed in "yl" (y / len).
const EY = 0.005;
const Y_PROF = [-0.120, -0.112, -0.104, -0.096, -0.088, -0.0765, -0.0625, -0.046, -0.035, -0.018, 0.0, 0.016, 0.032, 0.055, 0.080, 0.100];
const Z_PROF = [0.022, 0.046, 0.068, 0.0845, 0.0915, 0.0890, 0.0950, 0.0935, 0.0880, 0.0885, 0.0890, 0.0915, 0.0975, 0.0920, 0.0800, 0.066];
const Y_A = [-0.120, -0.106, -0.092, -0.078, -0.060, -0.030, 0.0, 0.03, 0.06, 0.10];
const A_V = [40, 30, 22, 16, 13, 11, 10.5, 9.5, 8.5, 9];
const Y_W = [-0.120, -0.108, -0.097, -0.086, -0.070, -0.045, -0.015, 0.02, 0.06, 0.10];
const W_V = [0.020, 0.030, 0.040, 0.047, 0.054, 0.061, 0.067, 0.064, 0.060, 0.052];
const NOSE_Y = [-0.054, -0.048, -0.042, -0.036, -0.030, -0.024, -0.012, 0.000, 0.010, 0.017, 0.024];
const NOSE_H = [0.000, 0.0012, 0.0080, 0.0185, 0.0250, 0.0240, 0.0175, 0.0110, 0.0055, 0.0025, 0.0];
const NOSE_W = [0.0100, 0.0125, 0.0150, 0.0158, 0.0136, 0.0118, 0.0102, 0.0090, 0.0083, 0.0078, 0.0075];

function curvA(y, P) { const a = crs(Y_A, A_V, y) * (0.078 / P.rx) ** 2; return a / lerp(1, P.jaw * P.jaw, smoothstep(-0.025, -0.06, y)); }
function halfW(y, P) { const w = crs(Y_W, W_V, y) * P.rx / 0.078; const k = lerp(lerp(1, P.cheek, smoothstep(0.015, -0.01, y)), P.jaw, smoothstep(-0.02, -0.055, y)); return w * k; }
function mouthY(ax, P) { const q = Math.min(1, ax / (0.0245 * P.mouthW)); return -0.0625 + (P.mouthOff || 0) + P.smile * 0.004 * q * q; }
function lipBorders(ax, P) {   // upper & lower vermilion border heights (yl) at |x|
  const ym = mouthY(ax, P); const mw = 0.0245 * P.mouthW; const q = Math.min(1, ax / mw);
  const hU = (0.0082 + 0.0012 * G(ax - 0.006, 0.004) - 0.0007 * G(ax, 0.0022)) * P.lipU * Math.sqrt(Math.max(0, 1 - Math.pow(q, 3)));
  const hL = 0.0094 * P.lipL * Math.sqrt(Math.max(0, 1 - Math.pow(q, 2.4)));
  return [ym + hU, ym - hL, ym];
}
function noseZ(x, y, P) {
  const yy = 0.017 + (y - 0.017) / P.noseL;
  if (yy < -0.056 || yy > 0.026) return 0;
  const h = crs(NOSE_Y, NOSE_H, yy) * P.noseH, wN = crs(NOSE_Y, NOSE_W, yy) * P.noseW;
  const ax = Math.abs(x); let z = 0;
  if (ax < wN && h > 0) { const q = ax / wN; z += h * Math.pow(1 - q * q, 1.25); }
  z += 0.0032 * P.noseTip * G2(x, 0.0082 * P.noseW, yy + 0.029, 0.0068);
  const ac = P.alarW - 0.0064, axa = ax - ac;
  z += 0.0092 * G2(axa, 0.0064, yy + 0.0372, 0.0062);
  const d = Math.hypot(axa, (yy + 0.0372) * 1.1);
  z -= 0.0011 * G(d - 0.0072, 0.0015) * smoothstep(-0.024, -0.032, yy);
  z -= 0.0016 * G2(ax - (ac - 0.0035), 0.0038, yy + 0.0418, 0.0022);
  return z;
}
function lipsZ(x, y, P) {
  const mw = 0.0245 * P.mouthW, ax = Math.abs(x);
  if (ax > mw * 1.35 || y > -0.040 || y < -0.084) return 0;
  const q = Math.min(1, ax / mw); const ym = mouthY(ax, P);
  const prof = Math.pow(Math.max(0, 1 - q * q), 0.6);
  let z = 0;
  const hU = (0.0082 + 0.0012 * G(ax - 0.006, 0.004)) * P.lipU;
  if (y > ym && y < ym + hU * 1.25) { const t = (y - ym) / hU; z += 0.0044 * P.lipU * prof * Math.pow(Math.sin(Math.PI * clamp(t * 0.85 + 0.08, 0, 1)), 0.8); }
  const hL = 0.0094 * P.lipL;
  if (y < ym && y > ym - hL * 1.2) { const t = (ym - y) / hL; z += 0.0052 * P.lipL * prof * Math.pow(Math.sin(Math.PI * clamp(t * 0.9 + 0.05, 0, 1)), 0.9); }
  z -= 0.0011 * G(y - ym, 0.0008) * prof;
  z -= 0.0012 * G2(ax - mw, 0.0035, y - ym, 0.003);
  return z;
}
function eyeBaseZ(P) { return crs(Y_PROF, Z_PROF, EY) - curvA(EY, P) * P.eyeX * P.eyeX; }
function eyeCenterZ(P) { return P._zEyeC ?? (P._zEyeC = eyeBaseZ(P) - 0.0006 - P.eyeR); }
/** full face height field (no eye opening — eyelids hug the eyeball) */
function faceZ(x, y, P) {
  const ax = Math.abs(x);
  let z = crs(Y_PROF, Z_PROF, y) - curvA(y, P) * x * x;
  z += 0.0042 * P.brow * G(y - (P.browY + 0.0045), 0.0085) * (1 - smoothstep(0.040, 0.062, ax));
  z -= 0.0030 * G2(ax - 0.060, 0.012, y - 0.036, 0.018);
  z += 0.0045 * P.cheek * G2(ax - 0.049, 0.0135, y + 0.012, 0.0125);
  z += 0.0040 * P.cheekFull * G2(ax - 0.041, 0.016, y + 0.040, 0.018);
  z -= 0.0008 * G2(ax - 0.040, 0.010, y + 0.052, 0.012) * (1 - P.cheekFull);
  z += noseZ(x, y, P);
  z += 0.0007 * G2(ax - 0.0048, 0.0018, y + 0.0485, 0.0045);
  z += lipsZ(x, y, P);
  { const t = clamp((-0.036 - y) / 0.026, 0, 1); const lx = lerp(0.019 * P.noseW, 0.029 * P.mouthW, t); const d = ax - lx;
    const on = smoothstep(-0.034, -0.040, y) * smoothstep(-0.068, -0.060, y);
    z -= 0.0010 * G(d, 0.003) * on * (1 - 0.5 * P.cheekFull); z += 0.0006 * G(d - 0.005, 0.004) * on; }
  z += 0.0042 * P.chin * G2(x, 0.017 * (0.8 + 0.2 * P.jaw), y + 0.0885, 0.0100);
  z -= 0.0018 * G2(x, 0.019, y + 0.0765, 0.0040);
  // eye region
  const dx = ax - P.eyeX, dy = y - EY;
  z -= 0.0085 * G2(dx, 0.017, dy, 0.0125);
  const rl = P.eyeR + 0.0013; const q = rl * rl - dx * dx - dy * dy;
  if (q > 0) z = smax(z, eyeCenterZ(P) + Math.sqrt(q), 0.0028);
  const lidTop = P.eyeH * 0.0052 + 0.0042;
  z -= 0.0007 * G(dy - lidTop * Math.max(0, 1 - (dx / 0.017) ** 2), 0.0012) * (Math.abs(dx) < 0.018 && dy > 0 ? 1 : 0);
  z += 0.0006 * G2(dx, 0.012, dy + 0.0075, 0.0025);          // slight lower-lid fullness
  z += 0.0016 * (P.hood ?? 1) * G2(dx + 0.002, 0.013, dy - (lidTop + 0.0012), 0.0022);   // hooded upper-lid fold
  return z;
}
function faceBlendW(x, yl, dz, P) {
  const hw = halfW(yl, P);
  return (1 - smoothstep(0.80, 1.02, Math.abs(x) / hw)) * (1 - smoothstep(0.072, 0.095, yl)) * smoothstep(-0.124, -0.101, yl) * smoothstep(0.0, 0.25, dz);
}
/** unit direction -> head surface point [x, y, z, yl] */
function headSurface(dx, dy, dz, P) {
  const jawK = dy < 0 ? lerp(1, P.jaw, smoothstep(0, -0.7, dy)) : 1;
  const x = dx * P.rx * jawK; const yl = dy * 0.114; const y = dy < 0 ? yl * P.len : yl;
  let z = dz * (dz >= 0 ? 0.099 : 0.104);
  if (dz > 0) { const w = faceBlendW(x, yl, dz, P); if (w > 1e-4) z = lerp(z, faceZ(x, yl, P), w); }
  if (dz < 0) z *= 1 + 0.04 * smoothstep(0.3, -0.2, dy) * smoothstep(-0.75, -0.35, dy);
  return [x, y, z, yl];
}
/** front surface z at (x, yl) — identical to the head mesh (before eye-hole push) */
function faceSurfaceZ(x, yl, P) {
  const dy = yl / 0.114; const jawK = dy < 0 ? lerp(1, P.jaw, smoothstep(0, -0.7, dy)) : 1;
  const xe = x / jawK; const dz = Math.sqrt(Math.max(0, 1 - (xe / P.rx) ** 2 - dy * dy));
  const ze = 0.099 * dz; const w = faceBlendW(x, yl, dz, P);
  return lerp(ze, faceZ(x, yl, P), w);
}

// eye geometry params (shared by geometry, texture, patches)
function eyeShape(P) {
  const k = P.eyeR / 0.0118;
  return { hw: 0.0116 * k, hU: 0.0037 * P.eyeH * k, hL: 0.0029 * P.eyeH * k, tilt: 0.0010, aO: 0.021 * k, bO: 0.016 * k };
}
/** almond (palpebral fissure) point at parameter s∈[0,1): upper arc inner→outer, lower arc outer→inner. returns [x', y', t] */
function almond(s, E) {
  let t, up;
  if (s <= 0.5) { t = -1 + 4 * s; up = true; } else { t = 1 - 4 * (s - 0.5); up = false; }
  const q = Math.max(0, 1 - t * t);
  const y = up ? E.hU * Math.pow(q, 0.85) * (1 - 0.15 * t) : -E.hL * Math.pow(q, 1.0) * (1 + 0.1 * t);
  return [t * E.hw, y + E.tilt * t, t, up];
}

// ------------------------------------------------------------------------------------------------ procedural textures
const _texCache = {};
function canvas2d(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function rgbOf(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
/** skin albedo used for rendering: the sampled photo tone, slightly darker & richer to compensate bright stage lighting */
function skinAlbedo(hex) { const [r, g, b] = rgbOf(hex); const m = (r + g + b) / 3; const sat = (v) => clamp(Math.round((m + (v - m) * 1.05) * 0.84), 0, 255); return '#' + [sat(r), sat(g), sat(b)].map(v => v.toString(16).padStart(2, '0')).join(''); }

/** skin / face texture (planar front projection: u = 0.5 + x/0.20, v = 0.5 + yl/0.26) + roughness map */
function faceTextures(id) {
  if (_texCache['face-' + id]) return _texCache['face-' + id];
  const sp = RSPEC[id], P = sp.face, S = 1024;
  const [cv, ctx] = canvas2d(S, S);
  const U = (x) => (0.5 + x / 0.20) * S, Vy = (y) => (0.5 - y / 0.26) * S, PX = (m) => m / 0.20 * S, PY = (m) => m / 0.26 * S;
  const [sr, sg, sb] = rgbOf(skinAlbedo(sp.skin));
  // base + pores / blotches
  const img = ctx.createImageData(S, S); const d = img.data; const n2 = createNoise2D(7 + id.length);
  let seed = 1234567;
  for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; const grain = (seed / 0x7fffffff - 0.5) * 0.045;
    const low = n2(xx / 60, yy / 60) * 0.035 + n2(xx / 14, yy / 14) * 0.015;
    const k = 1 + grain + low; const i = (yy * S + xx) * 4;
    d[i] = clamp(sr * k, 0, 255); d[i + 1] = clamp(sg * k, 0, 255); d[i + 2] = clamp(sb * k * 0.995, 0, 255); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = (x, y, rx, ry, color, a0 = 1) => {
    ctx.save(); ctx.translate(U(x), Vy(y)); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, PX(rx)); g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.globalAlpha = a0; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, PX(rx), 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  for (const s of [1, -1]) {
    blob(s * 0.046, -0.024, 0.030, 0.024, 'rgba(150,52,42,0.07)');             // cheek warmth
    blob(s * 0.032, -0.011, 0.016, 0.006, 'rgba(35,18,14,0.12)');              // under-eye
    blob(s * P.eyeX, 0.006, 0.021, 0.013, 'rgba(30,16,12,0.16)');             // darker eye area (periorbital)
    blob(s * 0.032, 0.011, 0.016, 0.006, 'rgba(45,25,20,0.14)');               // upper-lid crease shade
    blob(s * (P.eyeX - 0.012), 0.004, 0.005, 0.004, 'rgba(120,45,40,0.22)');   // inner eye corner
    blob(s * (P.alarW - 0.0064), 0.017 + (-0.037 - 0.017) * P.noseL, 0.009, 0.007, 'rgba(140,50,42,0.10)'); // alae
    blob(s * 0.050, 0.030, 0.022, 0.012, 'rgba(30,18,14,0.08)');               // temple shade
  }
  blob(0, 0.017 + (-0.030 - 0.017) * P.noseL, 0.012, 0.010, 'rgba(150,55,45,0.10)');  // nose tip
  blob(0, -0.115, 0.06, 0.02, 'rgba(25,14,10,0.22)');                                   // under chin
  // eyebrow underlay (soft, the 3D brows sit on top)
  for (const s of [1, -1]) {
    ctx.save(); ctx.strokeStyle = 'rgba(25,15,12,0.32)'; ctx.lineCap = 'round';
    for (let i = 0; i <= 24; i++) {
      const t = i / 24; const x = s * lerp(0.0125, 0.057, t); const y = browY(t, P); const th = 0.0042 * P.brow * (1 - 0.55 * t);
      ctx.lineWidth = PY(th * 1.9); if (i === 0) { ctx.beginPath(); ctx.moveTo(U(x), Vy(y)); } else ctx.lineTo(U(x), Vy(y));
    }
    ctx.stroke(); ctx.restore();
  }
  // lips
  const lipPath = () => {
    const mw = 0.0245 * P.mouthW * 1.02; ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const x = -mw + 2 * mw * i / 40; const [yu] = lipBorders(Math.abs(x), P); i ? ctx.lineTo(U(x), Vy(yu)) : ctx.moveTo(U(x), Vy(yu)); }
    for (let i = 40; i >= 0; i--) { const x = -mw + 2 * mw * i / 40; const [, yl] = lipBorders(Math.abs(x), P); ctx.lineTo(U(x), Vy(yl)); }
    ctx.closePath();
  };
  ctx.save(); lipPath(); ctx.fillStyle = sp.lip; ctx.globalAlpha = 0.62; ctx.fill(); ctx.restore();
  ctx.save(); lipPath(); ctx.clip();
  blob(0, mouthY(0, P) - 0.0042 * P.lipL, 0.019, 0.0042, 'rgba(205,140,135,0.42)');    // lighter, pinkish lower lip
  blob(0, mouthY(0, P) - 0.0040 * P.lipL, 0.010, 0.0022, 'rgba(255,220,210,0.16)');    // lower-lip highlight
  blob(0, mouthY(0, P) + 0.0042, 0.024, 0.0038, 'rgba(45,18,16,0.30)');                 // darker upper lip
  ctx.restore();
  // lip line soft edge
  ctx.save(); lipPath(); ctx.strokeStyle = 'rgba(70,35,30,0.25)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  // mouth line (dark slit — also used when the jaw opens)
  ctx.save(); ctx.strokeStyle = '#1b0c0a'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath();
  const mw = 0.0245 * P.mouthW;
  for (let i = 0; i <= 30; i++) { const x = -mw * 0.98 + 1.96 * mw * i / 30; const y = mouthY(Math.abs(x), P); i ? ctx.lineTo(U(x), Vy(y)) : ctx.moveTo(U(x), Vy(y)); }
  ctx.stroke(); ctx.restore();
  // nostrils
  for (const s of [1, -1]) {
    const y = 0.017 + (-0.0412 - 0.017) * P.noseL;
    ctx.save(); ctx.fillStyle = 'rgba(28,13,11,0.88)'; ctx.translate(U(s * (P.alarW - 0.0098)), Vy(y + 0.0004)); ctx.rotate(s * 0.28);
    ctx.beginPath(); ctx.ellipse(0, 0, PX(0.0041), PY(0.0020), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  // stubble & moustache
  if (sp.stubble > 0) {
    let s2 = 99; const r = () => ((s2 = (s2 * 16807) % 2147483647) / 2147483647);
    const inBeard = (x, y) => {
      const ax = Math.abs(x); if (y > -0.012 || y < -0.13) return 0;
      const [yu] = lipBorders(Math.min(ax, 0.024), P);
      const jaw = smoothstep(0.035, 0.05, ax) * smoothstep(-0.02, -0.045, y);       // sideburn → jaw
      const chin = smoothstep(mouthY(0, P) - 0.008, mouthY(0, P) - 0.014, y);         // below lower lip
      const lipUp = (y > yu + 0.0006 && y < yu + 0.0115 && ax < 0.03) ? 1 : 0;       // above upper lip
      const notLips = (y < yu + 0.0005 && y > mouthY(0, P) - 0.0095 && ax < 0.026) ? 0 : 1;
      return Math.max(jaw, chin * smoothstep(0.075, 0.06, ax) + jaw, lipUp * 0.8) * notLips * smoothstep(-0.135, -0.11, y) * (1 - smoothstep(0.065, 0.078, ax));
    };
    ctx.save();
    for (let i = 0; i < 26000 * sp.stubble; i++) {
      const x = (r() - 0.5) * 0.15, y = -0.01 - r() * 0.12; const m = inBeard(x, y); if (r() > m) continue;
      ctx.fillStyle = `rgba(22,14,11,${0.25 + r() * 0.35})`; const rr = 0.5 + r() * 0.8; ctx.fillRect(U(x), Vy(y), rr, rr * (1.2 + r()));
    }
    ctx.restore();
  }
  if (sp.moustache > 0) {
    let s3 = 7; const r = () => ((s3 = (s3 * 16807) % 2147483647) / 2147483647);
    ctx.save(); ctx.lineCap = 'round';
    for (let i = 0; i < 1400; i++) {
      const x = (r() * 2 - 1) * 0.0255 * P.mouthW; const ax = Math.abs(x); const [yu] = lipBorders(Math.min(ax, 0.0245), P);
      const y = yu + 0.0009 + r() * (0.0042 - 0.0018 * (ax / 0.026));
      const dir = Math.sign(x) || 1; const L = 0.0018 + r() * 0.0016;
      ctx.strokeStyle = `rgba(14,9,7,${(0.45 + r() * 0.4) * sp.moustache})`; ctx.lineWidth = 0.9 + r() * 0.6;
      ctx.beginPath(); ctx.moveTo(U(x), Vy(y)); ctx.lineTo(U(x + dir * L * 0.7), Vy(y - L)); ctx.stroke();
    }
    ctx.restore();
  }
  // hairline shade under the hair edge
  { const g = ctx.createLinearGradient(0, Vy(0.06), 0, Vy(0.09)); g.addColorStop(0, 'rgba(18,12,10,0)'); g.addColorStop(1, 'rgba(18,12,10,0.55)'); ctx.fillStyle = g; ctx.fillRect(0, Vy(0.11), S, Vy(0.06) - Vy(0.11)); }
  // ear atlas region (u,v in [0,0.1])
  ctx.save(); ctx.fillStyle = skinAlbedo(sp.skin); ctx.fillRect(0, S - 110, 110, 110);
  ctx.fillStyle = 'rgba(120,45,38,0.07)'; ctx.fillRect(0, S - 110, 110, 110);
  const eu = (lx) => (0.005 + (lx + 0.005) * 2.2) * S, ev = (ly) => (1 - (0.005 + (ly + 0.04) * 1.2)) * S;
  const cg = ctx.createRadialGradient(eu(0.012), ev(-0.004), 1, eu(0.012), ev(-0.004), 20);
  cg.addColorStop(0, 'rgba(25,10,8,0.85)'); cg.addColorStop(1, 'rgba(25,10,8,0)'); ctx.fillStyle = cg; ctx.fillRect(0, S - 110, 110, 110);
  ctx.restore();
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8; map.needsUpdate = true;
  // roughness (G channel)
  const [rc, rx] = canvas2d(256, 256); const U2 = (x) => (0.5 + x / 0.20) * 256, V2 = (y) => (0.5 - y / 0.26) * 256;
  rx.fillStyle = 'rgb(206,206,206)'; rx.fillRect(0, 0, 256, 256);
  const rb = (x, y, r, v) => { const g = rx.createRadialGradient(U2(x), V2(y), 0, U2(x), V2(y), r); g.addColorStop(0, `rgba(${v},${v},${v},1)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`); rx.fillStyle = g; rx.fillRect(0, 0, 256, 256); };
  rb(0, 0.05, 40, 165); rb(0, -0.02, 22, 160); rb(0, mouthY(0, P), 12, 172); for (const s of [1, -1]) rb(s * 0.045, -0.03, 26, 200);
  if (sp.stubble > 0) rb(0, -0.095, 40, 210);
  const rough = new THREE.CanvasTexture(rc); rough.needsUpdate = true;
  return (_texCache['face-' + id] = { map, rough });
}
function browY(t, P) { const u = (t - 0.62) / 0.62; return P.browY - 0.0018 + 0.0036 * P.browArch * (1 - u * u) + 0.0006 * (1 - P.browArch); }

function eyeTexture(iris) {
  if (_texCache['eye-' + iris]) return _texCache['eye-' + iris];
  const S = 256; const [cv, ctx] = canvas2d(S, S); const c = S / 2;
  const sc = ctx.createRadialGradient(c, c, 10, c, c, S * 0.62); sc.addColorStop(0, '#cbbfb2'); sc.addColorStop(0.55, '#bcad9f'); sc.addColorStop(1, '#957d6c');
  ctx.fillStyle = sc; ctx.fillRect(0, 0, S, S);
  let sd = 3; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  ctx.strokeStyle = 'rgba(170,60,60,0.35)'; ctx.lineWidth = 0.8;
  for (let i = 0; i < 26; i++) { const a = r() * Math.PI * 2; let x = c + Math.cos(a) * S * 0.48, y = c + Math.sin(a) * S * 0.48; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (c - x) * 0.07 + (r() - 0.5) * 6; y += (c - y) * 0.07 + (r() - 0.5) * 6; ctx.lineTo(x, y); } ctx.stroke(); }
  const R = S * 0.30;
  const base = new THREE.Color(iris); const hx = (k) => `#${base.clone().multiplyScalar(k).getHexString()}`;
  const ig = ctx.createRadialGradient(c, c, R * 0.3, c, c, R); ig.addColorStop(0, hx(1.3)); ig.addColorStop(0.55, hx(0.95)); ig.addColorStop(0.9, hx(0.6)); ig.addColorStop(1, '#0d0704');
  ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2; ctx.strokeStyle = r() > 0.5 ? 'rgba(0,0,0,0.25)' : `rgba(${110 + r() * 60},${70 + r() * 40},${35 + r() * 20},0.25)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * R * 0.42, c + Math.sin(a) * R * 0.42); ctx.lineTo(c + Math.cos(a) * R * 0.95, c + Math.sin(a) * R * 0.95); ctx.stroke(); }
  ctx.fillStyle = '#050302'; ctx.beginPath(); ctx.arc(c, c, R * 0.38, 0, Math.PI * 2); ctx.fill();
  const hl = ctx.createRadialGradient(c - R * 0.38, c - R * 0.38, 0, c - R * 0.38, c - R * 0.38, R * 0.2); hl.addColorStop(0, 'rgba(255,255,255,0.95)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl; ctx.fillRect(0, 0, S, S);
  const occ = ctx.createLinearGradient(0, S * 0.18, 0, S * 0.47); occ.addColorStop(0, 'rgba(40,22,16,0.55)'); occ.addColorStop(1, 'rgba(40,22,16,0)');
  ctx.fillStyle = occ; ctx.fillRect(0, 0, S, S * 0.47);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  return (_texCache['eye-' + iris] = t);
}
function browTexture() {
  if (_texCache.brow) return _texCache.brow;
  const [cv, ctx] = canvas2d(256, 64); ctx.clearRect(0, 0, 256, 64);
  let sd = 11; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  ctx.lineCap = 'round';
  for (let i = 0; i < 1600; i++) {
    const x = r() * 256, y = 10 + r() * 44; const t = x / 256; const edge = Math.min(y - 8, 56 - y) / 22;
    if (r() > 0.35 + edge) continue;
    const ang = lerp(-1.25, -0.22, t) + (r() - 0.5) * 0.4; const L = 9 + r() * 10;
    ctx.strokeStyle = `rgba(${16 + r() * 18},${11 + r() * 10},${8 + r() * 7},${0.38 + r() * 0.6})`; ctx.lineWidth = 0.8 + r() * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * L, y + Math.sin(ang) * L); ctx.stroke();
  }
  // solid core so lashes / brow stay readable
  const g = ctx.createLinearGradient(0, 0, 0, 64); g.addColorStop(0.32, 'rgba(18,12,9,0)'); g.addColorStop(0.5, 'rgba(18,12,9,0.28)'); g.addColorStop(0.68, 'rgba(18,12,9,0)');
  ctx.fillStyle = g; ctx.fillRect(4, 0, 248, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return (_texCache.brow = t);
}
/** hair atlas: left half = opaque strands (underlayer shell), right half = lock with alpha strands */
function hairAtlas() {
  if (_texCache.hair) return _texCache.hair;
  const S = 512; const [cv, ctx] = canvas2d(S, S);
  let sd = 21; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = '#16110e'; ctx.fillRect(0, 0, 256, S);
  for (let i = 0; i < 1500; i++) {
    const x = r() * 256, y0 = r() * S; const v = r();
    ctx.strokeStyle = v > 0.62 ? `rgba(70,58,50,${0.22 + r() * 0.3})` : `rgba(3,2,2,${0.35 + r() * 0.45})`; ctx.lineWidth = 0.6 + r() * 1.4;
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.bezierCurveTo(x + (r() - 0.5) * 6, y0 + 60, x + (r() - 0.5) * 6, y0 + 120, x + (r() - 0.5) * 5, y0 + 200); ctx.stroke();
  }
  ctx.clearRect(256, 0, 256, S);
  const core = ctx.createLinearGradient(256, 0, 512, 0); core.addColorStop(0.08, 'rgba(20,15,12,0)'); core.addColorStop(0.3, 'rgba(20,15,12,0.92)'); core.addColorStop(0.7, 'rgba(20,15,12,0.92)'); core.addColorStop(0.92, 'rgba(20,15,12,0)');
  ctx.fillStyle = core; ctx.fillRect(256, S * 0.18, 256, S * 0.82);
  const tipFade = ctx.createLinearGradient(0, 0, 0, S * 0.3); tipFade.addColorStop(0, 'rgba(20,15,12,0)'); tipFade.addColorStop(1, 'rgba(20,15,12,0.92)');
  ctx.save(); ctx.beginPath(); ctx.rect(256 + 256 * 0.3, 0, 256 * 0.4, S * 0.3); ctx.clip(); ctx.fillStyle = tipFade; ctx.fillRect(256, 0, 256, S * 0.3); ctx.restore();
  for (let i = 0; i < 420; i++) {
    const cx = 384 + (r() + r() + r() - 1.5) * 150; const top = S * (r() * 0.35); const w = r();
    ctx.strokeStyle = w > 0.6 ? `rgba(92,76,64,${0.55 + r() * 0.4})` : `rgba(${6 + r() * 10},${5 + r() * 7},${4 + r() * 5},${0.7 + r() * 0.3})`;
    ctx.lineWidth = 0.8 + r() * 1.6; ctx.beginPath(); ctx.moveTo(cx + (r() - 0.5) * 10, S);
    ctx.bezierCurveTo(cx + (r() - 0.5) * 20, S * 0.7, cx + (r() - 0.5) * 24, S * 0.35, cx + (r() - 0.5) * 30, top); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true;
  return (_texCache.hair = t);
}
function fabricNormal() {
  if (_texCache.fabric) return _texCache.fabric;
  const S = 128; const [cv, ctx] = canvas2d(S, S); const img = ctx.createImageData(S, S); const d = img.data;
  const h = (x, y) => 0.5 + 0.22 * Math.sin(2 * Math.PI * x / 8) * Math.sin(2 * Math.PI * y / 8) + 0.18 * Math.sin(2 * Math.PI * (x + y) / (S / 24));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1); let nx = -dx * 1.6, ny = -dy * 1.6, nz = 1; const L = Math.hypot(nx, ny, nz);
    const i = (y * S + x) * 4; d[i] = (nx / L * 0.5 + 0.5) * 255; d[i + 1] = (ny / L * 0.5 + 0.5) * 255; d[i + 2] = (nz / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.needsUpdate = true;
  return (_texCache.fabric = t);
}

// ------------------------------------------------------------------------------------------------ head geometry
function rowsYL(P) {
  const r = [0.114];
  const add = (a, b, step) => { for (let y = a; y >= b - 1e-9; y -= step) r.push(+y.toFixed(5)); };
  add(0.106, 0.064, 0.014); add(0.056, 0.042, 0.007);
  add(0.038, -0.010, 0.004);
  add(-0.0128, -0.0464, 0.0028);
  const ym = mouthY(0, P);
  add(-0.0486, ym + 0.0028, 0.0019); r.push(ym + 0.0012, ym + 0.0004, ym - 0.0004, ym - 0.0012);
  add(ym - 0.0030, -0.0756, 0.0019);
  add(-0.0785, -0.1085, 0.0034);
  r.push(-0.1115, -0.1135, -0.114);
  return [...new Set(r)].sort((a, b) => b - a);
}
function colsTheta(rx = 0.078) {
  const xs = [0];
  for (let x = 0.0028; x <= 0.0310 + 1e-9; x += 0.0028) xs.push(x);
  for (let x = 0.0335; x <= 0.0605 + 1e-9; x += 0.0035) xs.push(x);
  xs.push(0.064, 0.068, 0.0715, 0.0745, 0.0768);
  const front = xs.map(x => Math.asin(Math.min(1, x / rx)));
  const th = [...front.slice(1).map(t => -t).reverse(), ...front];
  const nb = 6;
  for (let i = 0; i <= nb; i++) { const t = Math.PI / 2 + (Math.PI / 2) * i / nb; th.push(t); th.unshift(-t); }
  return th; // ascending from -π to +π (seam duplicated as ±π)
}
const _headCache = {};
function buildHeadGeometry(id) {
  if (_headCache[id]) return _headCache[id];
  const sp = RSPEC[id], P = sp.face, E = eyeShape(P);
  const rows = rowsYL(P), cols = colsTheta(P.rx); const NR = rows.length, NC = cols.length;
  const pos = [], uv = [], jaw = [], blink = [];
  const zEyeC = eyeCenterZ(P);
  const eyes = [1, -1].map(so => ({ so, x: so * P.eyeX }));
  const hinge = { y: -0.010 * P.len, z: -0.012 }; const aJ = 0.17;
  for (let r = 0; r < NR; r++) {
    const yl = rows[r]; const dy = clamp(yl / 0.114, -1, 1); const cphi = Math.sqrt(Math.max(0, 1 - dy * dy));
    for (let c = 0; c < NC; c++) {
      const th = cols[c]; const dx = cphi * Math.sin(th), dz = cphi * Math.cos(th);
      let [x, y, z] = headSurface(dx, dy, dz, P);
      // push head surface behind the eyelid patches
      if (dz > 0.3) for (const e of eyes) {
        const rho = Math.hypot((x - e.x) / E.aO, (yl - EY) / E.bO);
        if (rho < 1) z -= 0.016 * (1 - smoothstep(0.5, 0.78, rho)) + 0.0005 * (1 - smoothstep(0.88, 1.0, rho));
      }
      pos.push(x, y, z);
      let u = 0.5 + x / 0.20, v = 0.5 + yl / 0.26;
      v = lerp(v, 0.02, smoothstep(0.01, -0.03, z));
      uv.push(u, v);
      // jaw-open morph (lower face rotates around hinge)
      const ym = mouthY(Math.abs(x), P); let wj = 0;
      if (z > -0.02) wj = smoothstep(ym + 0.0002, ym - 0.0006, yl) * (1 - smoothstep(0.042, 0.07, Math.abs(x))) * smoothstep(-0.02, 0.03, z);
      if (wj > 0) {
        const py = y - hinge.y, pz = z - hinge.z; const ca = Math.cos(aJ * wj), sa = Math.sin(aJ * wj);
        jaw.push(0, (py * ca - pz * sa) - py, (py * sa + pz * ca) - pz);
      } else jaw.push(0, 0, 0);
      blink.push(0, 0, 0);
    }
  }
  const idx = [];
  for (let r = 0; r < NR - 1; r++) for (let c = 0; c < NC - 1; c++) {
    const a = r * NC + c, b = a + 1, cc = a + NC + 1, d = a + NC;
    idx.push(a, d, b, b, d, cc);
  }
  let head = new THREE.BufferGeometry();
  head.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); head.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  head.setIndex(idx); head.computeVertexNormals();
  // weld normals across the ±π seam
  { const n = head.attributes.normal; for (let r = 0; r < NR; r++) { const a = r * NC, b = r * NC + NC - 1; const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b); const L = Math.hypot(nx, ny, nz) || 1; n.setXYZ(a, nx / L, ny / L, nz / L); n.setXYZ(b, nx / L, ny / L, nz / L); } }
  // make sure normals point outward
  { const n = head.attributes.normal; const mid = Math.floor(NR / 2) * NC + Math.floor(NC / 2); if (n.getZ(mid) < 0) flipWinding(head); }
  head.morphAttributes.position = [new THREE.Float32BufferAttribute(jaw, 3), new THREE.Float32BufferAttribute(blink, 3)];
  const parts = [head.toNonIndexed()];

  // ---- eyelid patches (crisp fissure, lid thickness, blink morph)
  const RINGS = [0, 0.03, 0.08, 0.16, 0.27, 0.41, 0.58, 0.78, 1.0]; const NA = 40;
  const lashGeo = { pos: [], uv: [], blink: [] };
  for (const e of eyes) {
    const pp = [], pu = [], pb = [], pi = [];
    const eyeZ = (x, y) => zEyeC + Math.sqrt(Math.max(0, P.eyeR * P.eyeR - (x - e.x) ** 2 - (y - EY) ** 2));
    const lidZ = (x, y) => faceSurfaceZ(x, y, P);
    const pt = (s, ring) => {
      const [xp, yp, t, up] = almond(s, E);
      const len0 = Math.hypot(xp, yp) || 1e-6; const ux = xp / len0, uy = yp / len0;
      const k = 1 / Math.sqrt((ux / E.aO) ** 2 + (uy / E.bO) ** 2);           // outer ellipse along same direction
      let lx, ly;
      if (ring === 0) { lx = xp; ly = yp; }
      else { const f = (ring - RINGS[1]) / (1 - RINGS[1]); const ex = xp + ux * 0.0004, ey = yp + uy * 0.0004; lx = lerp(ex, ux * k, Math.pow(f, 1.25)); ly = lerp(ey, uy * k, Math.pow(f, 1.25)); }
      const x = e.x + e.so * lx, y = EY + ly;
      let z;
      if (ring === 0) z = lerp(eyeZ(x, y) + 0.00015, lidZ(x, y) - 0.0004, smoothstep(0.72, 1.0, Math.abs(t)));
      else z = lidZ(x, y) + 0.00025 * (1 - smoothstep(0.85, 1.0, ring));
      return { x, y, z, t, up };
    };
    for (let ri = 0; ri < RINGS.length; ri++) for (let a = 0; a < NA; a++) {
      const s = a / NA; const p = pt(s, RINGS[ri]);
      pp.push(p.x, p.y, p.z); pu.push(0.5 + p.x / 0.20, 0.5 + p.y / 0.26);
      // blink target
      let bx = 0, by = 0, bz = 0;
      const wr = [1, 1, 0.95, 0.78, 0.52, 0.26, 0.08, 0, 0][ri];
      if (wr > 0) {
        const [xp, , t] = almond(s, E); const tu = t; // same x
        const upper = s <= 0.5;
        const yUp = E.hU * Math.pow(Math.max(0, 1 - tu * tu), 0.85) * (1 - 0.15 * tu) + E.tilt * tu;
        const yLo = -E.hL * Math.max(0, 1 - tu * tu) * (1 + 0.1 * tu) + E.tilt * tu;
        let ny = p.y;
        if (upper) ny = p.y + (yLo - yUp) * wr * 0.96 * (1 - smoothstep(0.85, 1, Math.abs(tu)));
        else ny = p.y + (yUp - yLo) * wr * 0.10;
        const nz = ri === 0 ? eyeZ(p.x, ny) + 0.0002 : Math.max(lidZ(p.x, ny), zEyeC + Math.sqrt(Math.max(0, (P.eyeR + 0.0013) ** 2 - (p.x - e.x) ** 2 - (ny - EY) ** 2))) + 0.0003;
        by = ny - p.y; bz = nz - p.z;
      }
      pb.push(bx, by, bz);
    }
    for (let ri = 0; ri < RINGS.length - 1; ri++) for (let a = 0; a < NA; a++) {
      const a1 = (a + 1) % NA; const i0 = ri * NA + a, i1 = ri * NA + a1, i2 = (ri + 1) * NA + a1, i3 = (ri + 1) * NA + a;
      if (e.so > 0) pi.push(i0, i1, i3, i1, i2, i3); else pi.push(i0, i3, i1, i1, i3, i2);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2)); g.setIndex(pi); g.computeVertexNormals();
    { const n = g.attributes.normal; let dot = 0; for (let i = NA * 4; i < NA * 5; i++) dot += n.getZ(i); if (dot < 0) flipWinding(g); }
    g.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(pp.length), 3), new THREE.Float32BufferAttribute(pb, 3)];
    parts.push(g.toNonIndexed());
    // lashes: upper (long) and lower (short), follow lid in blink
    const lash = (upper) => {
      const N = 14; const base = lashGeo.pos.length / 3; const s0 = upper ? 0.02 : 0.54, s1 = upper ? 0.48 : 0.96;
      for (let i = 0; i <= N; i++) {
        const s = lerp(s0, s1, i / N); const p = pt(s, RINGS[1]); const [, , t] = almond(s, E);
        const flare = 1 - Math.pow(Math.abs(t), 3); const L = (upper ? 0.0026 : 0.0011) * (0.55 + 0.45 * flare) * (1 + (upper ? 0.3 * Math.max(0, t) : 0));
        const dirY = upper ? 0.55 : -0.5, dirZ = 0.85; const lat = 0.25 * t * e.so;
        const tip = [p.x + lat * L, p.y + dirY * L, p.z + dirZ * L];
        lashGeo.pos.push(p.x, p.y, p.z + 0.0002, ...tip);
        lashGeo.uv.push(i / N, 0.38, i / N, upper ? 0.62 : 0.55);
        // blink delta for lashes (upper follow lid down)
        let by = 0, bz = 0;
        if (upper) { const tu = t; const yUp = E.hU * Math.pow(Math.max(0, 1 - tu * tu), 0.85) * (1 - 0.15 * tu); const yLo = -E.hL * Math.max(0, 1 - tu * tu) * (1 + 0.1 * tu); by = (yLo - yUp) * 0.96 * (1 - smoothstep(0.85, 1, Math.abs(tu))); bz = 0.0012 * (1 - Math.abs(tu)); }
        lashGeo.blink.push(0, by, bz, 0, by * 1.05, bz - 0.0012);
      }
      for (let i = 0; i < N; i++) { const a = base + i * 2; lashGeo.idx ||= []; lashGeo.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    };
    lash(true); lash(false);
  }

  // ---- ears (shaped plate + helix rim + antihelix), UVs in ear atlas region
  const earShape = new THREE.Shape();
  earShape.moveTo(0.000, 0.022);
  earShape.bezierCurveTo(0.004, 0.034, 0.020, 0.037, 0.028, 0.026);
  earShape.bezierCurveTo(0.034, 0.016, 0.031, 0.000, 0.026, -0.012);
  earShape.bezierCurveTo(0.022, -0.022, 0.016, -0.030, 0.010, -0.034);
  earShape.bezierCurveTo(0.004, -0.037, -0.002, -0.032, -0.001, -0.024);
  earShape.bezierCurveTo(0.002, -0.016, 0.000, -0.008, -0.002, -0.004);
  earShape.lineTo(0.000, 0.022);
  const earBase = new THREE.ExtrudeGeometry(earShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0022, bevelSize: 0.0022, bevelSegments: 1, curveSegments: 7 });
  const helixPts = [[0.002, 0.024], [0.012, 0.033], [0.024, 0.029], [0.029, 0.016], [0.027, 0.000], [0.022, -0.016], [0.013, -0.027]].map(([x, y]) => V(x, y, 0.0085));
  const helix = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPts), 16, 0.0026, 5);
  const antiPts = [[0.008, 0.022], [0.016, 0.020], [0.020, 0.008], [0.018, -0.006], [0.012, -0.016]].map(([x, y]) => V(x, y, 0.0078));
  const anti = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(antiPts), 14, 0.0018, 5);
  const tragus = new THREE.SphereGeometry(0.0042, 8, 6); tragus.scale(0.8, 1.1, 0.9); tragus.translate(0.001, -0.004, 0.006);
  const earParts = [earBase, helix, anti, tragus].map(g => {
    const x = g.index ? g.toNonIndexed() : g.clone(); const p = x.attributes.position; const u = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { u[i * 2] = 0.005 + (p.getX(i) + 0.005) * 2.2; u[i * 2 + 1] = 0.005 + (p.getY(i) + 0.04) * 1.2; }
    x.setAttribute('uv', new THREE.BufferAttribute(u, 2)); if (!x.attributes.normal) x.computeVertexNormals();
    for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
    return x;
  });
  const earOne = mergeGeometries(earParts, false);
  for (const so of [1, -1]) {
    const g = earOne.clone();
    // local: x = backward, y = up, z = outward thickness → head: -z, y, ±x
    const m = new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(so, 0, 0));
    g.applyMatrix4(m);
    g.scale(1.08, 1.1, 1.0);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(-so * 0.46));    // flare back edge away from head
    g.applyMatrix4(new THREE.Matrix4().makeRotationX(-0.12));
    g.translate(so * (P.rx - 0.0072), -0.010, -0.004);
    if (so < 0) flipWinding(g);
    const n = g.attributes.position.count;
    g.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3), new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)];
    parts.push(g);
  }
  const headGeo = mergeGeometries(parts.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }), false);
  headGeo.morphTargetsRelative = true;
  headGeo.computeBoundingSphere();

  // ---- brows + lashes geometry (dark strands, alpha tested)
  const bp = [], bu = [], bi = [], bb = [];
  for (const so of [1, -1]) {
    const N = 18, M = 4; const base = bp.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = i / N; const x = so * lerp(0.0125, 0.057, t); const yc = browY(t, P);
      const th = 0.0042 * P.brow * (1 - 0.55 * t) * smoothstep(-0.05, 0.12, t) ;
      for (let j = 0; j <= M; j++) {
        const v = j / M * 2 - 1; const y = yc + v * Math.max(th, 0.0008);
        const z = faceSurfaceZ(x, y, P) + 0.0006 + 0.0009 * (1 - v * v);
        bp.push(x, y, z); bu.push(t, (v + 1) / 2 * 0.86 + 0.07); bb.push(0, 0, 0);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = base + i * (M + 1) + j; const b = a + M + 1; if (so > 0) bi.push(a, b, a + 1, a + 1, b, b + 1); else bi.push(a, a + 1, b, a + 1, b + 1, b); }
  }
  const lb = bp.length / 3;
  bp.push(...lashGeo.pos); bu.push(...lashGeo.uv); bb.push(...lashGeo.blink); bi.push(...lashGeo.idx.map(i => i + lb));
  const browGeo = new THREE.BufferGeometry();
  browGeo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); browGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2));
  browGeo.setIndex(bi); browGeo.computeVertexNormals();
  browGeo.morphAttributes.position = [new THREE.Float32BufferAttribute(bb, 3)]; browGeo.morphTargetsRelative = true;

  return (_headCache[id] = { headGeo, browGeo, eyeC: eyes.map(e => V(e.x, EY, zEyeC)), eyeR: P.eyeR });
}
function eyeballGeometry(r) {
  const g = new THREE.SphereGeometry(r, 22, 16); g.rotateX(Math.PI / 2);   // poles along z
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (z > 0) { const k = 1 + 0.07 * smoothstep(0.72, 1.0, z / r); x *= 1 + (k - 1) * 0.3; y *= 1 + (k - 1) * 0.3; z *= k; p.setXYZ(i, x, y, z); }
    if (z > -0.2 * r) uv.setXY(i, 0.5 + x / (2.2 * r), 0.5 + y / (2.2 * r)); else uv.setXY(i, 0.5, 0.06);
  }
  g.computeVertexNormals(); return g;
}

// ------------------------------------------------------------------------------------------------ hair: shell + locks
const HAIR_STYLES = {
  // Mayank — thick wavy hair, puffed up and out (wider than the head at the temples), low-ish straight hairline
  puffy: {
    b: [0.43, 0.25, 0.05, -0.32, -0.55], count: 96, len: [0.05, 0.078], width: [0.026, 0.036], wave: 0.007, clump: 0.007, jag: 0.008, fade: 0.3,
    shell: (dx, dy, dz) => 0.008 + 0.017 * smoothstep(0.05, 0.9, dy) + 0.032 * smoothstep(-0.05, 0.3, dy) * smoothstep(0.98, 0.5, dy) * Math.abs(dx) + 0.011 * Math.max(dz, 0) * smoothstep(0.3, 0.8, dy),
    flow: (d, s, front) => { if (front && s < 0.4) return V(0.25 * d.x, 1, -0.2).normalize();
      const top = smoothstep(0.35, 0.72, d.y), back = smoothstep(0.1, -0.55, d.z);
      const side = V(0, -0.3, -1), up = V(0.5 * d.x, 0.12, -1), dn = V(0, -1, -0.15);
      return side.lerp(up, top).lerp(dn, back * (1 - top * 0.6)).normalize(); },
    lift: (d, s, front) => (front ? 0.008 * Math.sin(Math.PI * Math.min(1, s * 1.15)) : 0.0018 + 0.0042 * Math.sin(Math.PI * s)),
    frontRoots: 30,
  },
  // Tushar — side-swept from his right (−X) over to his left (+X), volume on top, hair falling over the left temple
  swept: {
    b: [0.40, 0.30, 0.10, -0.30, -0.50], skew: (ang) => 0.07 * smoothstep(0.0, -0.9, ang) - 0.11 * smoothstep(0.05, 0.9, ang) * smoothstep(1.6, 0.9, ang),
    count: 78, len: [0.08, 0.12], width: [0.026, 0.036], wave: 0.001, clump: 0.002, protrude: 0.0022, flat: 0.34,
    shell: (dx, dy, dz) => 0.004 + 0.014 * smoothstep(0.15, 0.95, dy) + 0.013 * Math.max(-dx, 0) * smoothstep(0.2, 0.85, dy) + 0.010 * Math.max(dx, 0) * smoothstep(-0.1, 0.5, dy) + 0.011 * Math.max(dz, 0) * smoothstep(0.4, 0.85, dy),
    flow: (d, s, front) => { const top = smoothstep(0.4, 0.75, d.y), back = smoothstep(0.0, -0.6, d.z);
      const sweep = V(1, -0.08 - (front ? 0.25 * s : 0), 0.32), side = V(0, -0.45, -1), dn = V(0, -1, -0.2);
      return side.lerp(sweep, Math.max(top, front ? 0.9 : 0)).lerp(dn, back * (1 - top * 0.5)).normalize(); },
    lift: (d, s, front) => (front ? 0.005 * Math.sin(Math.PI * Math.min(1, s * 1.1)) : 0.001 + 0.0016 * Math.sin(Math.PI * s)),
    frontRoots: 24,
  },
  // Himanshu — rounded bowl with a straight fringe down to the brows, sides covering the temples
  fringe: {
    b: [0.215, 0.17, 0.07, -0.24, -0.50], count: 96, len: [0.08, 0.12], width: [0.03, 0.04], wave: 0.0006, clump: 0.002, taper: 0.3, protrude: 0.0008, jag: 0.004, flat: 0.26,
    edge: (dx, dy, dz) => 0.5 * smoothstep(0.3, 0.9, dz),
    shell: (dx, dy, dz) => 0.007 + 0.010 * smoothstep(0.2, 1.0, dy) + 0.016 * Math.abs(dx) * smoothstep(-0.2, 0.4, dy) * smoothstep(1.0, 0.5, dy) + 0.006 * Math.max(dz, 0) * (1 - smoothstep(0.2, 0.6, dy)),
    flow: (d) => { const out = d.clone().sub(V(0, 0.82, -0.57)); out.y -= 0.35; out.normalize(); const fr = smoothstep(0.15, 0.55, d.z) * smoothstep(0.35, 0.75, d.y + 0.2);
      return out.lerp(V(0.10 * d.x, -1, 0.3).normalize(), fr).normalize(); },
    lift: (d, s) => 0.0012 + 0.0008 * Math.sin(Math.PI * s),
    frontRoots: 22,
  },
};
function hairBoundary(style, dx, dz) {
  const ang = Math.atan2(dx, dz); const a = Math.abs(ang); const [F, T, E, B, N] = style.b;
  const jag = (style.jag ?? 0.018) * (Math.sin(ang * 13.0 + 0.7) * 0.6 + Math.sin(ang * 29.0 + 2.1) * 0.4) + (style.skew ? style.skew(ang) : 0);
  const keys = [[0, F], [0.8, T], [1.5, E], [2.2, B], [Math.PI, N]];
  for (let i = 1; i < keys.length; i++) if (a <= keys[i][0]) { const t = (a - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]); const s = t * t * (3 - 2 * t); return lerp(keys[i - 1][1], keys[i][1], s) + jag; }
  return N + jag;
}
const _hairCache = {};
function buildHairGeometry(id) {
  if (_hairCache[id]) return _hairCache[id];
  const sp = RSPEC[id], P = sp.face, style = HAIR_STYLES[sp.hair];
  const scalp = (dx, dy, dz, h) => {
    const [x, y, z] = headSurface(dx, dy, dz, P);
    let nx = x / (P.rx * P.rx), ny = y / (0.114 * 0.114), nz = z / (0.1 * 0.1); const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    return [V(x + nx * h, y + ny * h, z + nz * h), V(nx, ny, nz)];
  };
  const shellH = (dx, dy, dz) => {
    const bnd = hairBoundary(style, dx, dz); const fade = smoothstep(bnd, bnd + (style.fade ?? 0.16), dy);
    const clump = style.clump * (Math.sin(9 * dx + 1.7) * Math.sin(7 * dy + 0.6) * Math.sin(8 * dz + 2.1) + 0.5 * Math.sin(23 * dx + 0.3) * Math.sin(19 * dz + 1.1) * smoothstep(0.2, 0.9, dy));
    const f = style.edge ? lerp(style.edge(dx, dy, dz), 1, fade) : fade;
    return 0.0016 + (style.shell(dx, dy, dz) + clump) * f;
  };
  // ---- underlayer shell (opaque strands, left half of atlas)
  const NU = 48, NV = 13; const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const phi = -Math.PI + 2 * Math.PI * i / NU; const sx = Math.sin(phi), cz = Math.cos(phi); const bnd = hairBoundary(style, sx, cz);
    for (let j = 0; j <= NV; j++) {
      const t = j / NV; const dy = lerp(bnd, 0.999, Math.pow(t, 0.85)); const r = Math.sqrt(Math.max(0, 1 - dy * dy));
      const dx = r * sx, dz = r * cz; const [p] = scalp(dx, dy, dz, shellH(dx, dy, dz) - 0.0025 * smoothstep(0.3, 1, t));
      pos.push(p.x, p.y, p.z); uv.push(0.02 + 0.46 * (i / NU), 1 - t * 0.98);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = (i + 1) * (NV + 1) + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  let shell = new THREE.BufferGeometry(); shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shell.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); shell.setIndex(idx); shell.computeVertexNormals();
  { const n = shell.attributes.normal, p = shell.attributes.position; let dot = 0; for (let i = 0; i < p.count; i += 5) dot += n.getX(i) * p.getX(i) + n.getY(i) * p.getY(i) + n.getZ(i) * p.getZ(i); if (dot < 0) flipWinding(shell); }
  // ---- locks
  let sd = 5 + id.length * 7; const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const roots = []; const NCAND = 900; const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < NCAND && roots.length < style.count; i++) {
    const y = 1 - (i + 0.5) / NCAND * 1.6; const r = Math.sqrt(Math.max(0, 1 - y * y)); const a = i * golden;
    const d = V(r * Math.sin(a), y, r * Math.cos(a)); const bnd = hairBoundary(style, d.x, d.z);
    if (d.y < bnd + 0.06) continue;
    if (rnd() < 0.18) continue;
    roots.push(d);
  }
  // extra roots along the front hairline so the front of the hair has real clump texture
  for (let i = 0; i < (style.frontRoots || 0); i++) {
    const phi = -1.15 + 2.3 * (i + rnd() * 0.8) / (style.frontRoots || 1); const sx = Math.sin(phi), cz = Math.cos(phi);
    const bnd = hairBoundary(style, sx, cz); const dy = Math.min(0.95, bnd + 0.035 + rnd() * 0.12); const r = Math.sqrt(1 - dy * dy);
    roots.push(V(r * sx, dy, r * cz));
  }
  // ---- sculpted clumps: tapered, flattened tubes following the style's flow field
  const lp = [], lu = [], li = [];
  const NSEG = 5, NR = 4;
  for (const root of roots) {
    const seed = rnd(); const len = lerp(style.len[0], style.len[1], rnd()) * (root.y > 0.4 ? 1 : 0.75);
    const w0 = lerp(style.width[0], style.width[1], rnd());
    const front = root.z > 0.45 && root.y < 0.85; const liftK = 0.6 + 0.8 * rnd();
    // trace the path along the flow (stops at the hairline), then resample to NSEG+1 even points
    let d = root.clone(); const raw = [];
    const SUB = NSEG * 2;
    for (let k = 0; k <= SUB; k++) {
      const s = k / SUB;
      const [p, n] = scalp(d.x, d.y, d.z, shellH(d.x, d.y, d.z) + (style.protrude ?? 0.0042) * smoothstep(0, 0.25, s) + style.lift(d, s, front) * liftK);
      raw.push([p, n]);
      const D = style.flow(d, s, front); const T = D.clone().addScaledVector(n, -D.dot(n)).normalize();
      const nd = p.clone().addScaledVector(T, len / SUB).normalize();
      const bnd = hairBoundary(style, nd.x, nd.z);
      if (nd.y < bnd - 0.012) break;            // reached the hairline (fringe stays a clean line)
      d = nd;
    }
    if (raw.length < 3) continue;
    const cum = [0]; for (let k = 1; k < raw.length; k++) cum.push(cum[k - 1] + raw[k][0].distanceTo(raw[k - 1][0]));
    const total = cum[cum.length - 1]; if (total < 0.008) continue;
    const pts = [], nrms = [];
    for (let k = 0; k <= NSEG; k++) {
      const target = total * k / NSEG; let i = 1; while (i < raw.length - 1 && cum[i] < target) i++;
      const f = (target - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      pts.push(raw[i - 1][0].clone().lerp(raw[i][0], f)); nrms.push(raw[i - 1][1].clone().lerp(raw[i][1], f).normalize());
    }
    const base = lp.length / 3;
    for (let k = 0; k <= NSEG; k++) {
      const s = k / NSEG; const p = pts[k], n = nrms[k];
      const T = (k < NSEG ? pts[k + 1].clone().sub(p) : p.clone().sub(pts[k - 1])).normalize();
      const B = new THREE.Vector3().crossVectors(T, n).normalize();
      const N2 = new THREE.Vector3().crossVectors(B, T).normalize();
      const wv = style.wave * Math.sin(2 * Math.PI * 1.2 * s + seed * 6.28) * s * smoothstep(0.25, 0.6, root.y);
      const c = p.clone().addScaledVector(B, wv);
      const wdt = w0 * (1 - (style.taper ?? 0.86) * Math.pow(s, 1.35)), th = wdt * (style.flat ?? 0.42);
      for (let j = 0; j < NR; j++) {
        const a = 2 * Math.PI * j / NR + seed;
        const q = c.clone().addScaledVector(B, Math.cos(a) * wdt / 2).addScaledVector(N2, Math.sin(a) * th / 2);
        lp.push(q.x, q.y, q.z); lu.push(0.02 + 0.46 * ((j / NR + seed) % 1), s * 0.98);
      }
    }
    for (let k = 0; k < NSEG; k++) for (let j = 0; j < NR; j++) {
      const j1 = (j + 1) % NR; const a = base + k * NR + j, b = base + k * NR + j1, cc = base + (k + 1) * NR + j1, dd = base + (k + 1) * NR + j;
      li.push(a, b, dd, b, cc, dd);
    }
  }
  const locks = new THREE.BufferGeometry(); locks.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); locks.setAttribute('uv', new THREE.Float32BufferAttribute(lu, 2)); locks.setIndex(li); locks.computeVertexNormals();
  // point lock normals outward-ish (double sided material anyway)
  const geo = mergeGeometries([shell.toNonIndexed(), locks.toNonIndexed()].map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }), false);
  return (_hairCache[id] = geo);
}

// ------------------------------------------------------------------------------------------------ helmet (unchanged look)
const HELMET_LIVERY = {
  mayank: (h) => `vec3 livery(vec3 p){ vec3 col = ${glc(h.base)}; float ax = abs(p.x);
    col = mix(col, ${glc(h.a)}, 1.0 - aaStep(-0.025, p.y));
    col = mix(col, ${glc(h.b)}, inBand(p.y, -0.025, -0.010));
    col = mix(col, ${glc(h.a)}, (1.0 - aaStep(0.022, ax)) * aaStep(0.03, p.y));
    col = mix(col, ${glc(h.b)}, inBand(ax, 0.022, 0.03) * aaStep(0.03, p.y));
    return col; }`,
  tushar: (h) => `vec3 livery(vec3 p){ vec3 col = ${glc(h.base)}; float ax = abs(p.x);
    float top = aaStep(0.0, p.y);
    col = mix(col, ${glc(h.c)}, (1.0 - aaStep(0.012, ax)) * top);
    col = mix(col, ${glc(h.b)}, inBand(ax, 0.012, 0.028) * top);
    col = mix(col, ${glc(h.a)}, inBand(ax, 0.028, 0.044) * top);
    col = mix(col, ${glc(h.c)}, inBand(p.y, -0.07, -0.05) * aaStep(0.05, ax));
    col = mix(col, ${glc(h.b)}, (1.0 - aaStep(-0.075, p.y)) * aaStep(0.07, p.z));
    return col; }`,
  himanshu: (h) => `vec3 livery(vec3 p){ vec3 col = ${glc(h.base)}; float ax = abs(p.x);
    col = mix(col, ${glc(h.a)}, inBand(p.y, -0.035, -0.005) * aaStep(0.04, ax));
    col = mix(col, ${glc(h.b)}, (1.0 - aaStep(-0.06, p.y)) * aaStep(0.05, p.z));
    col = mix(col, ${glc(h.a)}, inBand(ax, 0.014, 0.024) * aaStep(0.02, p.y));
    return col; }`,
};
function glc(hex) { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`; }
const GLSL_AA = `float aaStep(float e, float v){ float w = max(fwidth(v), 1e-5) * 0.8; return smoothstep(e - w, e + w, v); }
float inBand(float v, float a, float b){ return aaStep(a, v) * (1.0 - aaStep(b, v)); }
`;
const HELMET_CENTER = 0.14;   // head centre height above helmet origin (bottom ring)
function helmetShape(dx, dy, dz, extra = 0) {
  let x = dx * (0.131 + extra), y = dy * (0.150 + extra), z = dz * (0.162 + extra);
  if (dz > 0 && dy < -0.15) z += 0.03 * smoothstep(-0.15, -0.85, dy) * dz;
  if (dy < -0.5) { const t = smoothstep(-0.5, -1, dy); x *= 1 + 0.06 * t; }
  if (dz < -0.2 && dy > 0.1) z -= 0.008 * dy;
  return [x, y + 0.012, z - 0.004];
}
const _helmetMats = {};
function helmetMaterial(id) {
  if (_helmetMats[id]) return _helmetMats[id];
  const sp = RSPEC[id];
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 });
  const glsl = GLSL_AA + HELMET_LIVERY[id](sp.helmet);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;').replace('#include <begin_vertex>', `#include <begin_vertex>\nvLP = position - vec3(0.0, ${HELMET_CENTER.toFixed(3)}, 0.0);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;\n' + glsl)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( livery(vLP), opacity );');
  };
  m.customProgramCacheKey = () => 'helmet-' + id;
  return (_helmetMats[id] = m);
}
const _helmetGeo = {};
function helmetGeometries() {
  if (_helmetGeo.shell) return _helmetGeo;
  const sph = new THREE.SphereGeometry(1, 36, 26).toNonIndexed(); const p = sph.attributes.position; const pos = [];
  for (let t = 0; t < p.count; t += 3) {
    const tri = [0, 1, 2].map(k => helmetShape(p.getX(t + k), p.getY(t + k), p.getZ(t + k)));
    const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    if (cy < -0.128) continue;
    for (const v of tri) pos.push(v[0], v[1] + HELMET_CENTER, v[2]);
  }
  const shell = new THREE.BufferGeometry(); shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shell.computeVertexNormals();
  const vis = new THREE.SphereGeometry(1, 28, 10, Math.PI / 2 - 1.22, 2.44, 1.30, 0.62);
  const vp = vis.attributes.position;
  for (let i = 0; i < vp.count; i++) { const [x, y, z] = helmetShape(vp.getX(i), vp.getY(i), vp.getZ(i), 0.0045); vp.setXYZ(i, x, y + HELMET_CENTER, z); }
  vis.computeVertexNormals();
  const trims = [];
  const ring = new THREE.TorusGeometry(1, 0.012, 6, 36); ring.rotateX(Math.PI / 2);
  const rp = ring.attributes.position;
  for (let i = 0; i < rp.count; i++) { const x = rp.getX(i), z = rp.getZ(i), y = rp.getY(i); rp.setXYZ(i, x * 0.118, y + 0.016, z * 0.142 - 0.004); }
  ring.computeVertexNormals(); trims.push(ring);
  for (const s of [1, -1]) { const pv = new THREE.CylinderGeometry(0.016, 0.016, 0.01, 14); pv.rotateZ(Math.PI / 2); pv.translate(s * 0.133, HELMET_CENTER + 0.0, 0.06); trims.push(pv); }
  const sp = new THREE.Shape(); sp.moveTo(0, 0); sp.lineTo(0.07, 0.0); sp.lineTo(0.0, 0.035); sp.closePath();
  const spo = new THREE.ExtrudeGeometry(sp, { depth: 0.09, bevelEnabled: false }); spo.translate(0, 0, -0.045); spo.rotateY(-Math.PI / 2); spo.rotateX(-0.35);
  spo.translate(0, HELMET_CENTER + 0.075, -0.13); trims.push(spo);
  const cv = new THREE.BoxGeometry(0.05, 0.022, 0.02); cv.translate(0, HELMET_CENTER - 0.085, 0.178); trims.push(cv);
  for (const s of [1, -1]) { const tv = new THREE.BoxGeometry(0.018, 0.012, 0.04); tv.rotateX(-0.5); tv.translate(s * 0.03, HELMET_CENTER + 0.15, 0.06); trims.push(tv); }
  _helmetGeo.shell = shell; _helmetGeo.visor = vis;
  _helmetGeo.trim = mergeGeometries(trims.map(g => { const x = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(x.attributes)) if (!['position', 'normal'].includes(k)) x.deleteAttribute(k); if (!x.attributes.normal) x.computeVertexNormals(); return x; }));
  return _helmetGeo;
}
let _trimMat = null;
/** standalone full-face helmet; origin = bottom ring centre (place directly at bike.anchors.helmetRest) */
export function createHelmet(id = 'mayank') {
  if (!RSPEC[id]) id = 'mayank';
  const Gm = helmetGeometries(); const sp = RSPEC[id];
  const g = new THREE.Group(); g.name = 'helmet-' + id;
  const shell = new THREE.Mesh(Gm.shell, helmetMaterial(id)); shell.castShadow = true; shell.receiveShadow = true;
  const visor = new THREE.Mesh(Gm.visor, new THREE.MeshPhysicalMaterial({ color: sp.helmet.visor, metalness: 0.9, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 }));
  const trim = new THREE.Mesh(Gm.trim, _trimMat ||= new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.2 }));
  trim.castShadow = true;
  g.add(shell, visor, trim);
  return g;
}

// ------------------------------------------------------------------------------------------------ body material (skin / cloth / armour patterns + fabric normal)
function clothGLSLFor(id, sp, s, w, J) {
  const C = sp.c; const f = (v) => v.toFixed(5);
  const head = `
  float ax = abs(p.x);
  float rag = ax - (0.10 + (${f(1.45 * s)} - p.y) / ${f(s)} * 0.467) * ${f(w)};
  float coll = aaStep(${f(1.459 * s)}, p.y);
  float side = aaStep(${f(0.136 * w * J)}, ax) * (1.0 - aaStep(${f(1.30 * s)}, p.y));
  float hem = 1.0 - aaStep(${f(1.058 * s)}, p.y);
  float dash = step(0.42, fract(p.y * 150.0 + p.x * 40.0));
  float stitch = inBand(rag, -0.0068, -0.0056) * aaStep(${f(1.16 * s)}, p.y) * dash;`;
  let body;
  if (id === 'mayank') body = `
    vec3 c = mix(${glc(C.body)}, ${glc(C.sleeve)}, aaStep(0.0, rag));
    c = mix(c, ${glc(C.sleeve)}, max(side, hem));
    c = mix(c, ${glc(C.pipe)}, inBand(rag, -0.0035, 0.0005) * aaStep(${f(1.2 * s)}, p.y));
    c = mix(c, ${glc(C.pipe)}, inBand(p.y, ${f(1.058 * s)}, ${f(1.064 * s)}));
    c *= 1.0 - 0.32 * stitch;
    c *= 1.0 - 0.25 * inBand(ax, ${f(0.136 * w * J - 0.006)}, ${f(0.136 * w * J - 0.0052)}) * (1.0 - aaStep(${f(1.30 * s)}, p.y)) * dash;
    c = mix(c, ${glc(C.collar)}, coll);`;
  else if (id === 'tushar') body = `
    vec3 c = mix(${glc(C.body)}, ${glc(C.panel)}, aaStep(0.0, rag));
    c = mix(c, ${glc(C.side)}, max(side, hem));
    c = mix(c, ${glc(C.side)}, inBand(rag, -0.004, 0.0) * aaStep(${f(1.2 * s)}, p.y));
    c = mix(c, ${glc(C.panel)}, inBand(p.y, ${f(1.22 * s)}, ${f(1.232 * s)}) * (1.0 - aaStep(${f(0.12 * w)}, ax)) * step(0.0, p.z));
    c *= 1.0 - 0.30 * stitch;
    c = mix(c, ${glc(C.collar)}, coll);`;
  else body = `
    vec3 c = ${glc(C.body)};
    c = mix(c, ${glc(C.pipe)}, inBand(rag, -0.0025, 0.0) * aaStep(${f(1.2 * s)}, p.y) * 0.8);
    c *= 1.0 - 0.18 * inBand(rag, -0.0055, -0.0045) * aaStep(${f(1.2 * s)}, p.y) * dash;
    c *= 1.0 - 0.15 * inBand(p.y, ${f(1.0 * s)}, ${f(1.006 * s)});
    c = mix(c, ${glc(C.collar)}, coll);`;
  return `vec3 clothPattern(vec3 p){ ${head}${body}
    return c; }
  vec3 armorPattern(vec3 p){ float rib = step(0.55, fract(p.y * 95.0 + p.z * 30.0)); return ${glc(C.armor)} * (0.82 + 0.25 * rib); }`;
}
function riderBodyMaterial(skinColor, id, clothGLSL) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, normalMap: fabricNormal(), normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.5 });
  const uSkin = { value: skinColor.clone() };
  m.userData.uSkin = uSkin;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSkin = uSkin;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 rm;\nattribute float fab;\nvarying vec2 vRM;\nvarying vec3 vRest;\nvarying float vFab;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm;\nvRest = position;\nvFab = fab;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRM;\nvarying vec3 vRest;\nvarying float vFab;\nuniform vec3 uSkin;\n' + GLSL_AA + clothGLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vRM.y < -2.5) diffuseColor.rgb = armorPattern(vRest); else if (vRM.y < -1.5) diffuseColor.rgb = clothPattern(vRest); else if (vRM.y < -0.5) diffuseColor.rgb = uSkin;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = max(vRM.y, 0.0);')
      .replace('#include <normal_fragment_maps>', 'vec3 nGeo = normal;\n#include <normal_fragment_maps>\nnormal = normalize(mix(nGeo, normal, vFab));');
  };
  m.customProgramCacheKey = () => 'rider-body-v3-' + id;
  return m;
}

// ------------------------------------------------------------------------------------------------ body part builder
class SkinParts {
  constructor(boneIndex) { this.list = []; this.bi = boneIndex; }
  /** bones: 'name' or fn(x,y,z)->[[name,w],..]; color: hex | THREE.Color | fn(x,y,z)->[hex, rough, metal] | 'skin'; fab: fabric normal 0..1 */
  add(geo, bones, color, rough = 0.8, metal = 0, fab = 1) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count; const p = g.attributes.position;
    const col = new Float32Array(n * 3), rm = new Float32Array(n * 2), fb = new Float32Array(n), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const tmpC = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let hex = color, r = rough, m = metal;
      if (typeof color === 'function') { const res = color(x, y, z); hex = res[0]; r = res[1] ?? rough; m = res[2] ?? metal; }
      let f = fab;
      if (hex === 'skin') { tmpC.set(0xffffff); r = 0.56; m = -1; f = 0; } else if (hex && hex.isColor) tmpC.copy(hex); else tmpC.set(hex);
      col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; rm[i * 2] = r; rm[i * 2 + 1] = m; fb[i] = m > 0.3 ? 0 : f;
      if (typeof bones === 'string') { si[i * 4] = this.bi[bones]; sw[i * 4] = 1; }
      else { const ws = bones(x, y, z); let tot = 0; ws.forEach(([b, wgt], k) => { si[i * 4 + k] = this.bi[b]; sw[i * 4 + k] = wgt; tot += wgt; }); for (let k = 0; k < 4; k++) sw[i * 4 + k] /= tot || 1; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('rm', new THREE.BufferAttribute(rm, 2)); g.setAttribute('fab', new THREE.BufferAttribute(fb, 1));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.list.push(g);
  }
  build() { return mergeGeometries(this.list, false); }
}
/** tapered capsule along +Y from y=0 (radius r1) to y=len (radius r0), with optional bulge */
function limbGeo(len, r0, r1, seg = 12, bulge = 0, peak = 0.5, cap = 3, mid = 6) {
  const pts = [];
  for (let i = 0; i <= cap; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * i / cap; pts.push(new THREE.Vector2(Math.max(1e-4, r1 * Math.cos(a)), r1 * Math.sin(a))); }
  for (let i = 1; i < mid; i++) { const t = i / mid; const r = lerp(r1, r0, t) + bulge * Math.pow(Math.sin(Math.PI * clamp((t - peak) * 0.9 + 0.5, 0, 1)), 2); pts.push(new THREE.Vector2(r, len * t)); }
  for (let i = 0; i <= cap; i++) { const a = (Math.PI / 2) * i / cap; pts.push(new THREE.Vector2(Math.max(1e-4, r0 * Math.cos(a)), len + r0 * Math.sin(a))); }
  return new THREE.LatheGeometry(pts, seg);
}
/** fabric folds: radial ripples along a lathe limb (y in [0,len]) */
function addFolds(g, len, folds) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const r = Math.hypot(x, z); if (r < 1e-5) continue;
    const t = y / len; const ang = Math.atan2(z, x); let k = 0;
    for (const [t0, t1, amp, freq, ph] of folds) {
      const m = smoothstep(t0, t0 + 0.06, t) * (1 - smoothstep(t1 - 0.06, t1, t));
      k += amp * m * Math.sin(2 * Math.PI * freq * t + ph + 0.8 * Math.cos(2 * ang + ph)) * (0.6 + 0.4 * Math.cos(ang * 3 + ph));
    }
    p.setXYZ(i, x * (1 + k), y, z * (1 + k));
  }
  g.computeVertexNormals(); return g;
}
/** vertical loft: stations [y, halfWidth, front(+z), back(-z)] -> geometry */
function vloft(st, o = {}) {
  const S = st.map(([y, wd, f, b, n]) => ({ z: y, cy: 0, w: wd, ht: b, hb: f, nt: n || 2.3, nb: n || 2.3 }));
  const g = loft(S, { radial: o.radial ?? 26, steps: o.steps ?? 16, caps: o.caps });
  g.rotateX(-Math.PI / 2);
  return g;
}
/** cap of a sphere around +Y, re-oriented to point along dir (armour pads) */
function padGeo(r, dir, open = 0.95, seg = 14) {
  const g = new THREE.SphereGeometry(r, seg, 7, 0, Math.PI * 2, 0, open);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize())));
  return g;
}

// ------------------------------------------------------------------------------------------------ IK helpers
const _q1 = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _f = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
function frameQuat(a1, b1, a2, b2, out = new THREE.Quaternion()) {
  const [x1, y1, z1, x2, y2, z2] = _f;
  x1.copy(a1).normalize(); z1.crossVectors(x1, b1).normalize(); y1.crossVectors(z1, x1);
  x2.copy(a2).normalize(); z2.crossVectors(x2, b2).normalize(); y2.crossVectors(z2, x2);
  _m1.makeBasis(x1, y1, z1); _m2.makeBasis(x2, y2, z2);
  return out.setFromRotationMatrix(_m2.multiply(_m1.transpose()));
}
const _A = new THREE.Vector3(), _T = new THREE.Vector3(), _P = new THREE.Vector3(), _bend = new THREE.Vector3(), _dU = new THREE.Vector3(),
  _B = new THREE.Vector3(), _C = new THREE.Vector3(), _hinge = new THREE.Vector3(), _qU = new THREE.Quaternion(), _qUi = new THREE.Quaternion();
/** two-bone IK in world space: sets upper.quaternion & lower.quaternion (rest orientations are identity). Returns lower world quat in outQ. */
function solveTwoBone(L, targetW, poleW, outQ) {
  L.upper.getWorldPosition(_A);
  _T.subVectors(targetW, _A); let d = _T.length();
  d = clamp(d, Math.abs(L.lenU - L.lenL) + 1e-3, L.lenU + L.lenL - 1e-3);
  _T.normalize();
  _P.subVectors(poleW, _A);
  _bend.crossVectors(_T, _P);
  if (_bend.lengthSq() < 1e-8) _bend.set(1, 0, 0); _bend.normalize();
  const cosA = (L.lenU * L.lenU + d * d - L.lenL * L.lenL) / (2 * L.lenU * d);
  _dU.copy(_T).applyAxisAngle(_bend, Math.acos(clamp(cosA, -1, 1)));
  _B.copy(_A).addScaledVector(_dU, L.lenU);
  _C.copy(_A).addScaledVector(_T, d).sub(_B).normalize();
  _hinge.copy(_bend).negate();
  frameQuat(L.restU, L.hinge, _dU, _hinge, _qU);
  frameQuat(L.restL, L.hinge, _C, _hinge, outQ);
  L.upper.parent.getWorldQuaternion(_q1);
  L.upper.quaternion.copy(_q1.invert().multiply(_qU));
  L.lower.quaternion.copy(_qUi.copy(_qU).invert().multiply(outQ));
  return outQ;
}

// ------------------------------------------------------------------------------------------------ createRider
const KICK_DUR = 0.45;
export function createRider(id = 'mayank') {
  if (!RSPEC[id]) id = 'mayank';
  const sp = RSPEC[id]; const C = sp.c;
  const s = sp.H / 1.75, w = s * sp.build, hs = sp.headScale;
  const J = sp.jacket ? 1.07 : 1.0;
  const skinCol = new THREE.Color(skinAlbedo(sp.skin));

  // ---------------- skeleton (rest pose, identity rotations)
  const headY = sp.H - 0.187 * hs, neckY = headY - 0.095 * s, shY = neckY - 0.032 * s;
  const R = {
    root: V(0, 0, 0), pelvis: V(0, 0.98 * s, 0), spine: V(0, 1.07 * s, -0.006), chest: V(0, 1.25 * s, -0.014),
    neck: V(0, neckY, -0.022), head: V(0, headY, -0.004),
  };
  for (const [sd, sx] of [['L', 1], ['R', -1]]) {
    R['upperArm' + sd] = V(sx * 0.178 * w, shY, -0.024);
    R['foreArm' + sd] = V(sx * 0.197 * w, shY - 0.30 * s, -0.034);
    R['hand' + sd] = V(sx * 0.206 * w, shY - 0.555 * s, -0.014);
    R['hand' + sd + '_bare'] = R['hand' + sd].clone(); R['hand' + sd + '_glove'] = R['hand' + sd].clone();
    R['thigh' + sd] = V(sx * 0.088 * w, 0.92 * s, 0.002);
    R['shin' + sd] = V(sx * 0.094 * w, 0.50 * s, 0.012);
    R['foot' + sd] = V(sx * 0.099 * w, 0.082 * s, -0.014);
  }
  const PARENT = { pelvis: 'root', spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck' };
  for (const sd of ['L', 'R']) Object.assign(PARENT, {
    ['upperArm' + sd]: 'chest', ['foreArm' + sd]: 'upperArm' + sd, ['hand' + sd]: 'foreArm' + sd,
    ['hand' + sd + '_bare']: 'hand' + sd, ['hand' + sd + '_glove']: 'hand' + sd,
    ['thigh' + sd]: 'pelvis', ['shin' + sd]: 'thigh' + sd, ['foot' + sd]: 'shin' + sd,
  });
  const bones = {}; const boneList = []; const bi = {};
  for (const name of Object.keys(R)) { const b = new THREE.Bone(); b.name = name; bones[name] = b; bi[name] = boneList.length; boneList.push(b); }
  for (const name of Object.keys(R)) { const b = bones[name]; const par = PARENT[name]; if (par) { b.position.copy(R[name]).sub(R[par]); bones[par].add(b); } else b.position.copy(R[name]); }

  // ---------------- body geometry
  const P = new SkinParts(bi);
  const lerpW = (a, b, y0, y1) => (x, y) => { const t = smoothstep(y0, y1, y); return [[a, 1 - t], [b, t]]; };
  const skin = 'skin';
  const ty = (y) => y * s;

  // pelvis / hips (pants) with crotch folds
  const pelv = vloft([
    [0.835 * s, 0.07 * w, 0.058 * w, 0.068 * w], [0.875 * s, 0.150 * w, 0.086 * w, 0.100 * w], [0.945 * s, 0.168 * w, 0.096 * w, 0.112 * w],
    [1.01 * s, 0.160 * w, 0.092 * w, 0.102 * w], [1.075 * s, 0.150 * w, 0.090 * w, 0.093 * w],
  ], { radial: 24, steps: 10 });
  P.add(pelv, 'pelvis', C.pants, 0.85);
  // waistband (drawstring for track pants)
  { const wb = new THREE.TorusGeometry(0.152 * w, 0.006, 4, 24); wb.rotateX(Math.PI / 2); wb.scale(1, 1, 0.64); wb.translate(0, ty(1.068), -0.002); P.add(wb, 'pelvis', C.pants, 0.8); }

  // torso (jacket / tee) — procedural panels per pixel
  const torsoSt = [
    [ty(0.995), 0.162, 0.104, 0.104], [ty(1.04), 0.160, 0.102, 0.101], [ty(1.12), 0.152, 0.097, 0.092], [ty(1.22), 0.160, 0.104, 0.096],
    [ty(1.31), 0.172, 0.111, 0.101], [ty(1.385), 0.180, 0.101, 0.101], [ty(1.432), 0.172, 0.084, 0.092],
    [ty(1.458), 0.148, 0.070, 0.080], [ty(1.479), 0.098, 0.060, 0.068], [ty(1.494), 0.064, 0.054, 0.060],
  ].map(([y, hw, f, b]) => [y, hw * w * J, f * w * J, b * w * J]);
  const torso = vloft(torsoSt, { radial: 26, steps: 18 });
  // soft fabric wrinkles across the belly / lower back
  { const p = torso.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const m = smoothstep(ty(1.06), ty(1.10), y) * (1 - smoothstep(ty(1.18), ty(1.26), y)); const k = 1 + 0.006 * m * Math.sin(y * 260 + x * 30); p.setXYZ(i, x * k, y, z * k); } torso.computeVertexNormals(); }
  P.add(torso, lerpW('spine', 'chest', ty(1.13), ty(1.26)), () => [0xffffff, sp.jacket ? (id === 'tushar' ? 0.6 : 0.78) : 0.88, -2]);
  if (sp.jacket) {
    const col = new THREE.TorusGeometry(0.07 * w * J, 0.018, 6, 18); col.rotateX(Math.PI / 2); col.scale(1, 1.4, 1.12); col.translate(0, ty(1.49), -0.012);
    P.add(col, 'chest', C.collar, 0.6);
    const pipe = new THREE.TorusGeometry(0.072 * w * J, 0.0042, 4, 18); pipe.rotateX(Math.PI / 2); pipe.scale(1, 1, 1.12); pipe.translate(0, ty(1.468), -0.012);
    P.add(pipe, 'chest', C.pipe, 0.5);
    const snap = new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10); snap.rotateX(Math.PI / 2); snap.translate(0.012, ty(1.49), 0.07 * w * J * 1.12 + 0.004); P.add(snap, 'chest', '#9a9da2', 0.3, 0.9);
    const zp = []; for (const [y, , f] of torsoSt.slice(0, 7)) zp.push(V(0, y, f + 0.003));
    P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(zp.slice(0, 6)), 16, 0.0045, 4), lerpW('spine', 'chest', ty(1.13), ty(1.26)), C.zip, 0.4, 0.6);
    const pull = new THREE.BoxGeometry(0.008, 0.022, 0.004); pull.translate(0.0, torsoSt[5][0] - 0.01, torsoSt[5][2] + 0.006); P.add(pull, 'chest', '#a8abb0', 0.3, 0.9);
    const hump = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); hump.scale(0.11 * w, 0.025, 0.15 * s); hump.rotateX(-Math.PI / 2); hump.translate(0, ty(1.29), -0.098 * w * J + 0.004);
    P.add(hump, 'chest', 0xffffff, 0.5, -3);
  } else {
    const col = new THREE.TorusGeometry(0.064 * w, 0.008, 4, 18); col.rotateX(Math.PI / 2); col.scale(1, 1, 1.12); col.translate(0, ty(1.475), -0.012);
    P.add(col, 'chest', C.collar, 0.9);
  }

  // neck (skin) blended neck->head, with a hint of the adam's apple
  const neckGeo = limbGeo((headY - neckY) + 0.05 * s, 0.059 * w, 0.066 * w, 14);
  { const p = neckGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); if (z > 0) p.setZ(i, z + 0.004 * G(x, 0.012) * G(y - 0.075, 0.02) * (sp.H > 1.7 ? 1 : 0.4)); } neckGeo.computeVertexNormals(); }
  neckGeo.translate(0, neckY - 0.03 * s, -0.018);
  P.add(neckGeo, lerpW('neck', 'head', neckY + 0.01, headY + 0.02), skin);

  // arms
  for (const [sd, sx] of [['L', 1], ['R', -1]]) {
    const A = R['upperArm' + sd], E = R['foreArm' + sd], Wr = R['hand' + sd];
    const ua = 'upperArm' + sd, fa = 'foreArm' + sd;
    const capR = (sp.jacket ? 0.049 : 0.046) * w * J;
    const cap = new THREE.SphereGeometry(capR, 12, 8); cap.scale(0.95, 0.95, 1.05); cap.translate(A.x - sx * 0.008, A.y - 0.01, A.z);
    P.add(cap, ua, sp.jacket ? C.sleeve : C.body, sp.jacket ? 0.7 : 0.88);
    const uaG = limbGeo(A.distanceTo(E), 0.049 * w * J, 0.040 * w * J, 10, 0.004, 0.35);
    if (sp.jacket) addFolds(uaG, A.distanceTo(E), [[0.0, 0.25, 0.05, 3, 0.4]]);
    alongY(uaG, E, A); P.add(uaG, ua, sp.jacket ? C.sleeve : skin, 0.75);
    const faG = limbGeo(E.distanceTo(Wr), 0.040 * w * J, 0.029 * w * J, 10, 0.004, 0.3);
    if (sp.jacket) addFolds(faG, E.distanceTo(Wr), [[0.65, 1.0, 0.06, 4, 1.1], [0.0, 0.25, 0.04, 3, 2.0]]);
    alongY(faG, Wr, E); P.add(faG, fa, sp.jacket ? C.sleeve : skin, 0.75);
    if (sp.jacket) {
      // armour pads hugging shoulder & elbow (ribbed), cuff with strap, sleeve piping
      const sPad = padGeo(capR + 0.006, V(sx * 0.72, 0.68, 0.05), 0.9, 14); sPad.translate(A.x - sx * 0.008, A.y - 0.01, A.z);
      P.add(sPad, ua, 0xffffff, 0.5, -3);
      const ePad = padGeo(0.042 * w * J + 0.005, V(sx * 0.35, -0.05, -0.94), 0.95, 12); ePad.translate(E.x, E.y - 0.005, E.z);
      P.add(ePad, fa, 0xffffff, 0.5, -3);
      const cuff = new THREE.TorusGeometry(0.031 * w * J, 0.008, 4, 12); cuff.rotateX(Math.PI / 2); cuff.translate(Wr.x, Wr.y + 0.02, Wr.z);
      P.add(cuff, fa, C.armor, 0.55);
      const strap = new THREE.BoxGeometry(0.004, 0.012, 0.03); strap.translate(Wr.x + sx * 0.035 * w * J, Wr.y + 0.025, Wr.z); P.add(strap, fa, C.pipe, 0.5);
      for (const [a, b, bone, r0] of [[A, E, ua, 0.048], [E, Wr, fa, 0.039]]) {
        const pts = [0, 0.5, 1].map(t => a.clone().lerp(b, t).add(V(sx * lerp(r0, r0 * 0.78, t) * w * J, 0, 0)));
        P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.0042, 4), bone, C.pipe, 0.5);
      }
    } else {
      // short raglan tee sleeve with hem seam
      const sl = limbGeo(0.13 * s, 0.062 * w, 0.054 * w, 14); const top = A.clone().add(V(sx * 0.004, 0.02, 0)); const bot = A.clone().lerp(E, 0.45);
      addFolds(sl, 0.13 * s, [[0.15, 0.7, 0.018, 2, 0.5]]);
      const ax = top.clone().sub(bot).normalize();
      alongY(sl, bot, top); P.add(sl, ua, (x, y, z) => { const t = V(x, y, z).sub(bot).dot(ax); return [t < 0.013 && t > 0.004 ? new THREE.Color(C.body).multiplyScalar(0.8) : C.body, 0.88]; }, 0.88);
    }
    // bare hand (relaxed) — skin, bound to hand*_bare
    {
      const hb = 'hand' + sd + '_bare'; const parts = [];
      const palm = new THREE.SphereGeometry(1, 10, 7); palm.scale(0.016 * w, 0.046 * s, 0.040 * w); palm.translate(0, -0.05 * s, 0.004); parts.push(palm);
      for (let f = 0; f < 4; f++) {
        const len = [0.074, 0.082, 0.078, 0.064][f] * s; const fz = (0.026 - f * 0.0175) * w;
        const fg = limbGeo(len, 0.0085 * w, 0.0072 * w, 5, 0, 0.5, 2, 4); fg.rotateX(Math.PI); fg.rotateX(-0.25 - f * 0.04); fg.translate(-sx * 0.002, -0.09 * s, fz); parts.push(fg);
      }
      const th = limbGeo(0.05 * s, 0.0105 * w, 0.0085 * w, 5, 0, 0.5, 2, 4); th.rotateX(Math.PI); th.rotateX(-0.55); th.rotateZ(-sx * 0.25); th.translate(-sx * 0.012 * w, -0.035 * s, 0.034 * w); parts.push(th);
      for (const g of parts) { g.translate(Wr.x, Wr.y, Wr.z); P.add(g, hb, skin); }
    }
    // glove — palm block, four fingers curled around the grip, thumb, knuckle armour, gauntlet
    {
      const hg = 'hand' + sd + '_glove';
      const palm = new THREE.SphereGeometry(1, 12, 8); palm.scale(0.022 * w, 0.05 * s, 0.045 * w); palm.translate(Wr.x, Wr.y - 0.055 * s, Wr.z + 0.004);
      P.add(palm, hg, C.glove, 0.62);
      for (let f = 0; f < 4; f++) {
        const fz = (0.027 - f * 0.018) * w; const len = [0.9, 1.0, 0.96, 0.82][f];
        // finger curls toward the palm side (−sx · X) and back up, wrapping the grip
        const pts = [];
        for (let k = 0; k <= 6; k++) { const a = k / 6 * 2.2 * len; const rr = 0.018 * s; pts.push(V(Wr.x - sx * rr * (1 - Math.cos(a)) * 1.1, Wr.y - 0.09 * s - rr * Math.sin(a), Wr.z + fz)); }
        P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 7, 0.0088 * w, 5), hg, C.glove, 0.62);
      }
      const thP = [V(Wr.x - sx * 0.01, Wr.y - 0.035 * s, Wr.z + 0.035 * w), V(Wr.x - sx * 0.024, Wr.y - 0.06 * s, Wr.z + 0.04 * w), V(Wr.x - sx * 0.03, Wr.y - 0.08 * s, Wr.z + 0.026 * w)];
      P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(thP), 6, 0.0095 * w, 6), hg, C.glove, 0.62);
      const kn = padGeo(0.032 * w, V(sx, 0.0, 0.0), 0.85, 10); kn.scale(0.6, 1.0, 1.25); kn.translate(Wr.x + sx * 0.012, Wr.y - 0.085 * s, Wr.z + 0.005);
      P.add(kn, hg, C.gloveAccent, 0.45);
      const gc = limbGeo(0.07 * s, 0.041 * w, 0.037 * w, 12, 0, 0.5, 2, 4); gc.translate(Wr.x, Wr.y - 0.015, Wr.z); P.add(gc, hg, C.glove, 0.6);
      const gs = new THREE.TorusGeometry(0.041 * w, 0.004, 4, 14); gs.rotateX(Math.PI / 2); gs.translate(Wr.x, Wr.y + 0.035, Wr.z); P.add(gs, hg, C.gloveAccent, 0.5);
    }
  }
  sp.bracelet.forEach((hex, k) => {
    const Wr = R.handR; const b = new THREE.TorusGeometry(0.031 * w, 0.0032, 4, 12); b.rotateX(Math.PI / 2); b.translate(Wr.x, Wr.y - 0.002 - k * 0.0075, Wr.z);
    P.add(b, 'handR_bare', hex, 0.6, 0, 0);
  });

  // legs (track pants with folds + side stripes, boots / sneakers)
  for (const [sd, sx] of [['L', 1], ['R', -1]]) {
    const H = R['thigh' + sd], K = R['shin' + sd], A = R['foot' + sd];
    const th = 'thigh' + sd, sh = 'shin' + sd, ft = 'foot' + sd;
    const tg = limbGeo(H.distanceTo(K), 0.084 * w, 0.058 * w, 12, 0.004, 0.3);
    addFolds(tg, H.distanceTo(K), [[0.0, 0.22, 0.045, 3, 0.7 * sx], [0.82, 1.0, 0.03, 2, 1.3]]);
    alongY(tg, K, H); P.add(tg, th, C.pants, 0.85);
    const knee = new THREE.SphereGeometry(0.058 * w, 10, 6); knee.translate(K.x, K.y, K.z + 0.004); P.add(knee, (x, y) => [[th, 0.5], [sh, 0.5]], C.pants, 0.85);
    const bootTop = sp.jacket ? 0.24 * s : 0.12 * s;
    const sgLen = K.y - bootTop + 0.02;
    const sg = limbGeo(sgLen, 0.059 * w, 0.051 * w, 12, 0.003, 0.25);
    addFolds(sg, sgLen, [[0.0, 0.28, 0.07, 3.5, 0.3 * sx], [0.78, 1.0, 0.035, 2, 2.2]]);
    alongY(sg, V(A.x, bootTop, A.z + 0.004), K); P.add(sg, sh, C.pants, 0.85);
    const st = [H.clone().add(V(sx * 0.086 * w, -0.02, 0)), K.clone().add(V(sx * 0.062 * w, 0, 0)), V(A.x + sx * 0.054 * w, bootTop + 0.02, A.z)];
    P.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(st), 12, 0.0055, 4), (x, y) => (y > K.y ? [[th, 1]] : [[sh, 1]]), C.stripe, 0.8);
    if (sp.jacket) {
      const shaft = limbGeo(bootTop - A.y + 0.01, 0.05 * w, 0.046 * w, 12, 0, 0.5, 2, 4); shaft.translate(A.x, A.y - 0.005, A.z + 0.004);
      P.add(shaft, (x, y) => (y > A.y + 0.05 ? [[sh, 1]] : [[ft, 1]]), C.shoe, 0.55, 0, 0.3);
      for (const hy of [0.07, 0.13]) { const strap = new THREE.TorusGeometry(0.05 * w, 0.006, 4, 12); strap.rotateX(Math.PI / 2); strap.translate(A.x, A.y + hy, A.z + 0.004); P.add(strap, hy > 0.1 ? sh : ft, C.shoeAccent, 0.5, 0, 0); }
      const slider = new THREE.BoxGeometry(0.016, 0.012, 0.035); slider.translate(A.x + sx * 0.048 * w, A.y - 0.06, A.z + 0.14 * s); P.add(slider, ft, '#a8abb0', 0.35, 0.8);
    }
    const shoe = loft([
      { z: -0.068, cy: -0.034, w: 0.036, ht: 0.05, hb: 0.046 },
      { z: -0.035, cy: -0.028, w: 0.046, ht: 0.066, hb: 0.054 },
      { z: 0.035, cy: -0.044, w: 0.049, ht: 0.046, hb: 0.038, nt: 2.6, nb: 3.2 },
      { z: 0.115, cy: -0.056, w: 0.05, ht: 0.031, hb: 0.026, nt: 2.6, nb: 3.4 },
      { z: 0.172, cy: -0.058, w: 0.042, ht: 0.023, hb: 0.024 },
      { z: 0.196, cy: -0.06, w: 0.024, ht: 0.012, hb: 0.02 },
    ], { radial: 14, steps: 10 });
    const footS = s * 0.98; shoe.scale(w / 0.95 * 1.02, footS, footS); shoe.translate(A.x, A.y, A.z);
    const soleY = A.y - 0.071 * footS, midY = A.y - 0.060 * footS;
    P.add(shoe, ft, (x, y, z) => {
      if (y < soleY) return [C.sole, 0.9, 0];
      if (!sp.jacket && y < midY) return ['#f4f4f2', 0.8, 0];
      if (sp.jacket) return [(Math.abs(x - A.x) > 0.04 && y > A.y - 0.04 ? C.shoeAccent : C.shoe), 0.55, 0];
      return [(Math.abs(x - A.x) > 0.044 && y > A.y - 0.058 && y < A.y - 0.036 && z > A.z - 0.02 && z < A.z + 0.1) ? C.shoeAccent : C.shoe, 0.7, 0];
    }, 0.7, 0, 0.4);
    if (!sp.jacket) {   // laces
      for (let k = 0; k < 4; k++) { const lz = A.z + (0.035 + k * 0.022) * footS; const ly = A.y + lerp(-0.012, -0.03, k / 3) * footS; const lace = new THREE.BoxGeometry(0.036 * w, 0.003, 0.005); lace.rotateY(k % 2 ? 0.25 : -0.25); lace.translate(A.x, ly, lz); P.add(lace, ft, '#d8d8d8', 0.8, 0, 0); }
    }
  }

  // ---------------- skinned mesh
  const bodyGeo = P.build();
  const bodyMat = riderBodyMaterial(skinCol, id, clothGLSLFor(id, sp, s, w, J));
  const mesh = new THREE.SkinnedMesh(bodyGeo, bodyMat); mesh.name = 'riderBody';
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.add(bones.root);
  const group = new THREE.Group(); group.name = 'rider-' + id;
  group.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(boneList));

  // ---------------- head (sculpted), eyes, brows, hair, helmet
  const headOff = V(0, 0.075 * hs, 0.02 * hs);
  const headGroup = new THREE.Group(); headGroup.name = 'headGroup'; headGroup.position.copy(headOff); headGroup.scale.setScalar(hs);
  bones.head.add(headGroup);
  const HG = buildHeadGeometry(id); const FT = faceTextures(id);
  const faceMat = new THREE.MeshStandardMaterial({ map: FT.map, roughnessMap: FT.rough, roughness: 1.0, metalness: 0, envMapIntensity: 0.18 });
  const headMesh = new THREE.Mesh(HG.headGeo, faceMat); headMesh.name = 'headMesh'; headMesh.castShadow = true; headMesh.receiveShadow = true;
  headMesh.morphTargetInfluences = [0, 0];
  headGroup.add(headMesh);
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTexture(sp.iris), roughness: 0.4, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 0.16 });
  const eyeGeo = eyeballGeometry(HG.eyeR);
  const eyes = HG.eyeC.map((c, i) => { const m = new THREE.Mesh(eyeGeo, eyeMat); m.position.copy(c); m.name = i ? 'eyeR' : 'eyeL'; headGroup.add(m); return m; });
  const browMat = new THREE.MeshStandardMaterial({ map: browTexture(), color: 0xffffff, alphaTest: 0.32, side: THREE.DoubleSide, roughness: 0.82, metalness: 0, envMapIntensity: 0.2 });
  const browMesh = new THREE.Mesh(HG.browGeo, browMat); browMesh.name = 'brows'; browMesh.morphTargetInfluences = [0];
  headGroup.add(browMesh);
  const hairMat = new THREE.MeshPhysicalMaterial({ map: hairAtlas(), color: 0x75706c, side: THREE.DoubleSide, roughness: 0.66, metalness: 0, sheen: 0.12, sheenColor: new THREE.Color(0x231c17), sheenRoughness: 0.55, envMapIntensity: 0.12 });
  const hairMesh = new THREE.Mesh(buildHairGeometry(id), hairMat); hairMesh.name = 'hair'; hairMesh.castShadow = true;
  headGroup.add(hairMesh);
  const helmet = createHelmet(id); helmet.position.copy(headOff).add(V(0, -HELMET_CENTER, 0)); helmet.visible = false;
  bones.head.add(helmet);
  const headAnchor = new THREE.Object3D(); headAnchor.name = 'headAnchor'; headAnchor.position.copy(headOff).add(V(0, 0.006 * hs, 0.09 * hs)); bones.head.add(headAnchor);

  // ---------------- IK chains
  const chain = (u, l, e, hinge) => ({ upper: bones[u], lower: bones[l], lenU: R[u].distanceTo(R[l]), lenL: R[l].distanceTo(R[e]), restU: R[l].clone().sub(R[u]).normalize(), restL: R[e].clone().sub(R[l]).normalize(), hinge });
  const IK = {
    armL: chain('upperArmL', 'foreArmL', 'handL', V(-1, 0, 0)), armR: chain('upperArmR', 'foreArmR', 'handR', V(-1, 0, 0)),
    legL: chain('thighL', 'shinL', 'footL', V(1, 0, 0)), legR: chain('thighR', 'shinR', 'footR', V(1, 0, 0)),
  };

  // ---------------- state
  let pose = 'stand', helmetOn = false, lookTarget = null;
  const st = { h: 0, tuck: 0, brake: 0, look: 0, t: Math.random() * 10, blinkT: 2 + Math.random() * 2, blink: 0, talk: 0, talkDur: 0, kickT: -1, kickSide: 1, fallBlend: 0, fallT: 0, saccade: V(0, 0, 0), saccT: 0 };
  const setGloves = (on) => { for (const sd of ['L', 'R']) { bones['hand' + sd + '_glove'].scale.setScalar(on ? 1 : 1e-4); bones['hand' + sd + '_bare'].scale.setScalar(on ? 1e-4 : 1); } };
  setGloves(false);
  const resetBones = () => { for (const b of boneList) b.quaternion.identity(); bones.pelvis.position.copy(R.pelvis); };
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), gq = new THREE.Quaternion(), qLow = new THREE.Quaternion();
  const REST_F = V(0, -1, 0), REST_PL = V(-1, 0, 0), REST_PR = V(1, 0, 0);
  const PALM_L = V(-0.25, -0.95, 0.15).normalize(), PALM_R = V(0.25, -0.95, 0.15).normalize();
  const FOOT_L = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, 0.12, 0, 'YXZ')), FOOT_R = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, -0.12, 0, 'YXZ'));
  const toW = (v) => group.localToWorld(v.clone());
  const handDir = { L: V(0.05, -0.62, 0.78).normalize(), R: V(-0.05, -0.62, 0.78).normalize() };
  const eul = new THREE.Euler();

  function poseStand(dt) {
    const t = st.t;
    resetBones();
    const sway = Math.sin(t * 0.55), breath = Math.sin(t * 1.6);
    bones.pelvis.position.set(R.pelvis.x - 0.012 + 0.005 * sway, R.pelvis.y - 0.008 + 0.0015 * breath, R.pelvis.z);
    bones.pelvis.rotation.set(0.02, 0.05 + 0.02 * Math.sin(t * 0.21), 0.035 + 0.008 * sway);
    bones.spine.rotation.set(-0.025 + 0.008 * breath, -0.02, -0.03 - 0.006 * sway);
    bones.chest.rotation.set(-0.02 + 0.016 * Math.sin(t * 1.6 + 0.4), -0.04 * Math.sin(t * 0.21) - 0.02, -0.018);
    const look = Math.sin(t * 0.27) * 0.5 + Math.sin(t * 0.61 + 1.3) * 0.25;
    st.look = damp(st.look, clamp(look, -0.55, 0.55), 2.5, dt);
    bones.neck.rotation.set(0.05, st.look * 0.35, 0.01);
    bones.head.rotation.set(-0.04 + 0.04 * Math.sin(t * 0.43), st.look * 0.55 + 0.04, 0.035 + 0.02 * Math.sin(t * 0.37));
    for (const [sd, sx] of [['L', 1], ['R', -1]]) {
      const ph = sx * 0.4;
      bones['upperArm' + sd].rotation.set(0.10 + 0.025 * Math.sin(t * 0.9 + ph), 0.06 * sx, sx * (0.13 + 0.01 * breath));
      bones['foreArm' + sd].rotation.set(-0.38 - 0.05 * Math.sin(t * 0.9 + ph), -0.15 * sx, 0.0);
      bones['hand' + sd].rotation.set(-0.12, sx * 0.35, sx * 0.08);
    }
    bones.thighR.rotation.set(0.0, -0.06, -0.035); bones.shinR.rotation.set(0.03, 0, 0); bones.footR.rotation.set(-0.03, -0.18, 0.035);
    bones.thighL.rotation.set(-0.10, 0.10, -0.01); bones.shinL.rotation.set(0.20, 0, 0); bones.footL.rotation.set(-0.10, 0.24, 0.03);
  }

  function kickEnv() {   // returns [windup, extend] weights 0..1
    if (st.kickT < 0) return [0, 0];
    const u = st.kickT / KICK_DUR;
    const wind = smoothstep(0.0, 0.22, u) * (1 - smoothstep(0.62, 1.0, u));
    const ext = smoothstep(0.18, 0.42, u) * (1 - smoothstep(0.58, 0.95, u));
    return [wind, ext];
  }

  function poseRide(dt, s2) {
    const lean = s2.lean || 0, speed = Math.abs(s2.speed || 0), brake = clamp(s2.brake || 0, 0, 1), steer = s2.steer || 0;
    st.h = damp(st.h, clamp(lean / 0.85, -1, 1), 5, dt);
    st.tuck = damp(st.tuck, smoothstep(10, 45, speed) * (1 - 0.85 * brake), 3, dt);
    st.brake = damp(st.brake, brake, 6, dt);
    const h = st.h, tk = st.tuck, br = st.brake;
    const [kw, ke] = kickEnv(); const kx = -st.kickSide; const kk = Math.max(kw * 0.5, ke);   // kx: X-direction of the kick
    resetBones();
    const seat = STANDARD_ANCHORS.seat;
    bones.pelvis.position.set(-0.075 * h - kx * 0.035 * kk, seat.y + 0.105 * s - 0.012 * tk + 0.01 * kk, seat.z - 0.02 - 0.015 * tk);
    bones.pelvis.rotation.set(0.30 + 0.05 * tk - 0.06 * br - 0.08 * kk, -0.18 * h + kx * 0.12 * kk, 0.12 * h + kx * 0.10 * kk, 'XYZ');
    bones.spine.rotation.set(0.26 + 0.18 * tk - 0.18 * br - 0.08 * kk, -0.06 * h + 0.03 * steer, 0.12 * h + kx * 0.14 * kk);
    bones.chest.rotation.set(0.22 + 0.15 * tk - 0.14 * br, -0.05 * h + 0.04 * steer - kx * 0.10 * kk, 0.10 * h + kx * 0.16 * kk);
    bones.neck.rotation.set(-0.30 - 0.12 * tk + 0.12 * br + 0.06 * kk, -0.08 * h + kx * 0.25 * kk, -0.06 * h - kx * 0.08 * kk);
    bones.head.rotation.set(-0.36 - 0.16 * tk + 0.14 * br + 0.05 * kk, -0.18 * h + kx * 0.35 * kk, -0.30 * h - kx * 0.10 * kk);
    group.updateMatrixWorld(true);
    group.getWorldQuaternion(gq);
    for (const [sd, sx] of [['L', 1], ['R', -1]]) {
      const grip = sx > 0 ? STANDARD_ANCHORS.gripL : STANDARD_ANCHORS.gripR;
      const wrist = grip.clone().add(V(-sx * 0.012, 0.035, -0.05));
      const pole = V(sx * 0.65, 0.70, 0.05);
      const qL = solveTwoBone(IK['arm' + sd], toW(wrist), toW(pole), qLow);
      frameQuat(REST_F, sx > 0 ? REST_PL : REST_PR, handDir[sd], sx > 0 ? PALM_L : PALM_R, tmpQ2); tmpQ.copy(gq).multiply(tmpQ2);
      bones['hand' + sd].quaternion.copy(qL.invert().multiply(tmpQ));
    }
    for (const [sd, sx] of [['L', 1], ['R', -1]]) {
      const peg = sx > 0 ? STANDARD_ANCHORS.pegL : STANDARD_ANCHORS.pegR;
      let ankle = peg.clone().add(V(sx * 0.006, 0.066, -0.09));
      const insideAmt = Math.max(0, -sx * h);
      let pole = V(sx * (0.38 + 0.55 * insideAmt), 0.62 - 0.1 * insideAmt, 0.55);
      let footQ = sx > 0 ? FOOT_L : FOOT_R;
      const kicking = st.kickT >= 0 && sx === kx;
      if (kicking) {
        const wind = V(kx * 0.34, 0.66, -0.06), ext = V(kx * 0.90, 0.60, -0.24);
        ankle = ankle.lerp(wind, kw).lerp(ext, ke);
        pole = pole.lerp(V(kx * 0.45, 1.25, 0.45), Math.max(kw, ke));
        eul.set(0.45 * (1 - ke) + 0.1 * ke, 0, kx * 1.25 * ke, 'YXZ'); tmpQ2.setFromEuler(eul); footQ = tmpQ2.clone();
      }
      const qL = solveTwoBone(IK['leg' + sd], toW(ankle), toW(pole), qLow);
      tmpQ.copy(gq).multiply(footQ);
      bones['foot' + sd].quaternion.copy(qL.invert().multiply(tmpQ));
    }
  }

  function poseFall(dt, s2) {
    const f = s2.fall || {}; const air = f.airborne !== false; const spin = Math.abs(f.spin || 0);
    st.fallBlend = damp(st.fallBlend, air ? 0 : 1, air ? 6 : 2.6, dt);
    st.fallT += dt * (air ? 1 : 0.25);
    const t = st.fallT, k = st.fallBlend, I = clamp(0.75 + spin * 0.12, 0.6, 1.5) * (1 - k);
    resetBones();
    bones.pelvis.position.set(0, 0, 0);
    const S = Math.sin;
    // flailing (airborne) + sprawled (grounded) targets, blended
    const set = (b, ax, ay, az, bx, by, bz) => b.rotation.set(lerp(ax, bx, k), lerp(ay, by, k), lerp(az, bz, k));
    set(bones.pelvis, 0.15 * S(t * 2.3) * I, 0.3 * S(t * 1.7) * I, 0.25 * S(t * 2.1 + 1) * I, 0.0, 0.08, 0.04);
    set(bones.spine, 0.25 * S(t * 2.1) * I - 0.1, 0.35 * S(t * 1.9 + 1) * I, 0.25 * S(t * 2.3 + 2) * I, 0.02, 0.06, -0.03);
    set(bones.chest, 0.2 * S(t * 2.6 + 0.3) * I, 0.25 * S(t * 2.2) * I, 0.2 * S(t * 2.5 + 1.2) * I, 0.0, 0.05, 0.02);
    set(bones.neck, 0.35 * S(t * 3.1 + 0.5) * I, 0.4 * S(t * 2.4) * I, 0.3 * S(t * 2.8 + 1) * I, -0.05, 0.25, 0.08);
    set(bones.head, 0.45 * S(t * 3.3 + 1.1) * I, 0.5 * S(t * 2.7 + 0.4) * I, 0.4 * S(t * 3.0 + 2.2) * I, -0.08, 0.45, 0.15);
    for (const [sd, sx] of [['L', 1], ['R', -1]]) {
      const ph = sx > 0 ? 0 : 1.7;
      set(bones['upperArm' + sd], 1.3 * S(t * 5.2 + ph) * I, 0.4 * S(t * 3.3 + ph) * I, sx * (1.15 + 0.55 * S(t * 4.4 + ph)) * Math.max(I, 0.001) * (I > 0 ? 1 : 0),
        sx > 0 ? 0.25 : -0.1, sx * 0.2, sx * (sx > 0 ? 1.3 : 1.15));
      set(bones['foreArm' + sd], -0.6 - 0.6 * (0.5 + 0.5 * S(t * 6.1 + ph)) * I, 0.3 * S(t * 4.7 + ph) * I, 0, -0.55, -0.2 * sx, 0);
      set(bones['hand' + sd], 0.4 * S(t * 7 + ph) * I, 0, 0.3 * S(t * 6 + ph) * I, -0.2, sx * 0.3, 0.1 * sx);
      set(bones['thigh' + sd], -0.35 - 0.7 * S(t * 4.3 + ph * 1.3) * I, 0.15 * sx, sx * (0.35 + 0.3 * S(t * 3.6 + ph)) * (I > 0 ? 1 : 0),
        sx > 0 ? -0.18 : 0.08, sx * 0.12, sx * (sx > 0 ? 0.42 : 0.30));
      set(bones['shin' + sd], 0.4 + 0.7 * (0.5 + 0.5 * S(t * 5.4 + ph)) * I, 0, 0, sx > 0 ? 0.35 : 0.15, 0, 0);
      set(bones['foot' + sd], 0.3 * S(t * 6 + ph) * I, 0, 0, 0.55, sx * 0.2, 0);
    }
  }

  // face life: blink, eye gaze, talking jaw
  const _lt = new THREE.Vector3(), _lq = new THREE.Quaternion(), _im = new THREE.Matrix4();
  function faceUpdate(dt) {
    // blink
    st.blinkT -= dt;
    if (st.blinkT <= 0) { st.blink = 0.16; st.blinkT = 2.4 + Math.random() * 3.2; }
    let bl = 0; if (st.blink > 0) { st.blink -= dt; const u = 1 - st.blink / 0.16; bl = u < 0.45 ? u / 0.45 : Math.max(0, 1 - (u - 0.45) / 0.55); }
    if (st.kickT >= 0) bl = Math.max(bl, 0.35);
    if (pose === 'fall') bl = Math.max(bl, 0.5 + 0.5 * st.fallBlend);
    headMesh.morphTargetInfluences[1] = bl; browMesh.morphTargetInfluences[0] = bl;
    // talking jaw
    let jaw = 0;
    if (st.talk > 0) { const el = st.talkDur - st.talk; const env = smoothstep(0, 0.12, el) * smoothstep(0, 0.18, st.talk); jaw = env * (0.25 + 0.75 * Math.abs(Math.sin(el * 11.5)) * (0.55 + 0.45 * Math.sin(el * 3.7 + 1))); }
    if (pose === 'fall' && st.fallBlend < 0.5) jaw = Math.max(jaw, 0.35 + 0.3 * Math.sin(st.fallT * 9));
    headMesh.morphTargetInfluences[0] = jaw;
    // eye gaze (toward lookTarget, with tiny saccades)
    st.saccT -= dt; if (st.saccT <= 0) { st.saccT = 0.4 + Math.random() * 1.6; st.saccade.set((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06, 0); }
    let yaw = st.saccade.x, pitch = st.saccade.y;
    if (lookTarget) {
      headGroup.updateWorldMatrix(true, false); _im.copy(headGroup.matrixWorld).invert();
      _lt.copy(lookTarget).applyMatrix4(_im).sub(eyes[0].position.clone().add(eyes[1].position).multiplyScalar(0.5));
      yaw = clamp(Math.atan2(_lt.x, Math.max(1e-3, _lt.z)), -0.45, 0.45) + st.saccade.x * 0.3; pitch = clamp(Math.atan2(_lt.y, Math.hypot(_lt.x, _lt.z)), -0.3, 0.3) + st.saccade.y * 0.3;
    }
    for (const e of eyes) { e.rotation.set(-pitch, yaw, 0, 'YXZ'); }
  }

  const rider = {
    id, group, info: RIDER_INFO[id], bones, headAnchor, height: sp.H, helmet,
    get pose() { return pose; },
    /** 'stand' | 'ride' | 'fall'. 'fall' keeps the body where it is but moves the group origin to the pelvis (good tumbling pivot). */
    setPose(p) {
      const next = p === 'ride' ? 'ride' : p === 'fall' ? 'fall' : 'stand';
      if (next === 'fall' && pose !== 'fall') {
        group.updateMatrixWorld(true);
        const before = bones.pelvis.getWorldPosition(new THREE.Vector3());
        pose = 'fall'; st.fallBlend = 0; st.fallT = 0; st.kickT = -1; setGloves(true);
        rider.update(0, 0, { fall: { airborne: true, spin: 0 } });
        group.updateMatrixWorld(true);
        const after = bones.pelvis.getWorldPosition(new THREE.Vector3());
        const delta = before.sub(after);
        if (group.parent) { const pq = group.parent.getWorldQuaternion(new THREE.Quaternion()).invert(); const ps = group.parent.getWorldScale(new THREE.Vector3()); delta.applyQuaternion(pq).divide(ps); }
        group.position.add(delta);
        return;
      }
      if (next === 'ride' && pose === 'fall') { group.position.set(0, 0, 0); group.quaternion.identity(); }
      pose = next; st.kickT = -1;
      setGloves(pose !== 'stand');
      rider.update(0, 0, {});
    },
    setHelmet(on) { helmetOn = !!on; helmet.visible = helmetOn; headGroup.visible = !helmetOn; },
    /** Road-Rash style side kick while riding. side +1 = kick to rider's right (−X), −1 = left (+X). Returns duration (s). */
    kick(side = 1) { if (pose !== 'ride') return 0; if (st.kickT >= 0 && st.kickT < KICK_DUR * 0.7) return KICK_DUR - st.kickT; st.kickSide = side >= 0 ? 1 : -1; st.kickT = 0; return KICK_DUR; },
    get isKicking() { return st.kickT >= 0; },
    /** small talking animation (jaw + head) for `duration` seconds; voice audio is played by the game. */
    say(duration = 1.6) { st.talk = st.talkDur = clamp(duration, 0.3, 6); return st.talkDur; },
    /** eyes (and nothing else) follow a world-space point; null = look ahead */
    setLookTarget(v) { lookTarget = v ? (v.isVector3 ? v : V(v.x, v.y, v.z)) : null; },
    /** state: { lean (rad; >0 = bike rolled to its right/−X), speed m/s, throttle, brake 0..1, steer -1..1, fall: { airborne, spin } } */
    update(dt, time, s2 = {}) {
      st.t += dt;
      if (st.kickT >= 0) { st.kickT += dt; if (st.kickT >= KICK_DUR) st.kickT = -1; }
      if (pose === 'ride') poseRide(dt, s2); else if (pose === 'fall') poseFall(dt, s2); else poseStand(dt);
      if (st.talk > 0) {   // talking head motion (also with helmet on)
        st.talk = Math.max(0, st.talk - dt); const el = st.talkDur - st.talk; const env = smoothstep(0, 0.12, el) * smoothstep(0, 0.18, st.talk);
        bones.head.rotation.x += 0.03 * Math.sin(el * 6.5) * env; bones.head.rotation.y += 0.02 * Math.sin(el * 2.3) * env; bones.head.rotation.z += 0.015 * Math.sin(el * 4.1) * env;
      }
      if (!helmetOn) faceUpdate(dt);
    },
    dispose() { bodyGeo.dispose(); bodyMat.dispose(); faceMat.dispose(); hairMat.dispose(); browMat.dispose(); eyeMat.dispose(); },
  };
  rider.update(0, 0, {});
  group.userData.rider = rider;
  return rider;
}

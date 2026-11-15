// Vegetation & rock templates for InstancedMesh — UTTARAKHAND RIDERS
// --------------------------------------------------------------------------------------------
// getTreeTemplate(kind, lod) -> { geometry, material, depthMaterial, height, radius, trunkRadius, tris }
//   kind: 'sal'|'pine'|'deodar'|'oak'|'bush'|'bamboo'|'banana'|'grass'|'fern'      lod: 'high'|'low'
//   ONE merged vertex-coloured geometry + ONE material per template (cached; repeated calls return the same object).
//   Origin = trunk base on the ground, real-world size. Use with THREE.InstancedMesh (random Y-rotation/scale is fine).
//   Optional: instancedMesh.customDepthMaterial = template.depthMaterial  (shadows then sway with the tree).
// getRockTemplate(variant 0..3, kind 'river'|'mountain') -> { geometry, material, size }   (≈1 m across; scale instances)
// updateVegetation(time)  -> call once per frame (drives the shared wind uniform of every vegetation material).
//
// All vegetation shares one 1024² canvas atlas (colour map + separate alpha map for leaf cards, so no dark fringes).
import * as THREE from 'three';
import { makeRng, clamp, lerp, smoothstep } from '../core/util.js';

const AT = 1024;
const shared = { uTime: { value: 0 } };
let ATLAS = null;
const TEMPLATES = new Map();
const ROCKS = new Map();
let ROCK_MATS = null;

export function updateVegetation(time) { shared.uTime.value = time; }

// ============================================================================ noise helpers
function ihash(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a = lerp(ihash(xi, yi, zi), ihash(xi + 1, yi, zi), u), b = lerp(ihash(xi, yi + 1, zi), ihash(xi + 1, yi + 1, zi), u);
  const c = lerp(ihash(xi, yi, zi + 1), ihash(xi + 1, yi, zi + 1), u), d = lerp(ihash(xi, yi + 1, zi + 1), ihash(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}
/** periodic 2D value noise (period P lattice cells) — for tileable textures */
function pnoise2(x, y, P, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = k => ((k % P) + P) % P;
  const h = (a, b) => ihash(m(a), m(b), seed);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
function pfbm2(x, y, P, oct, seed) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * pnoise2(x * f, y * f, P * f, seed + i * 17); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// ============================================================================ atlas
function R(x, y, w, h, pad = 4) {
  return { u0: (x + pad) / AT, u1: (x + w - pad) / AT, v0: 1 - (y + h - pad) / AT, v1: 1 - (y + pad) / AT, px: [x, y, w, h] };
}
const REG = {
  barkSal: R(0, 0, 128, 448), barkPine: R(128, 0, 128, 448), barkDeodar: R(256, 0, 128, 448), barkOak: R(384, 0, 128, 448),
  white: R(0, 448, 512, 64, 10),
  volBroad: R(512, 0, 256, 256), volNeedle: R(768, 0, 256, 256), volDeodar: R(512, 256, 256, 256),
  culmBamboo: R(768, 256, 128, 256), culmBanana: R(896, 256, 128, 256),
  cardSal: R(0, 512, 256, 256, 2), cardPine: R(256, 512, 256, 256, 2), cardDeodar: R(512, 512, 256, 256, 2), cardOak: R(768, 512, 256, 256, 2),
  cardGrass: R(0, 768, 256, 256, 2), cardFern: R(256, 768, 256, 256, 2), cardBanana: R(512, 768, 256, 256, 2), cardBamboo: R(768, 768, 256, 256, 2),
};

function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }
function hsl(h, s, l) { return `hsl(${h},${s}%,${l}%)`; }

/** per-pixel painter for a region (ImageData) */
function pixelRegion(ctx, x0, y0, w, h, fn) {
  const img = ctx.getImageData(x0, y0, w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y); const i = (y * w + x) * 4;
    d[i] = clamp(c[0], 0, 255); d[i + 1] = clamp(c[1], 0, 255); d[i + 2] = clamp(c[2], 0, 255); d[i + 3] = 255;
  }
  ctx.putImageData(img, x0, y0);
}

function paintBark(C, reg, style, seed) {
  const [x0, y0, w, h] = reg.px;
  const r = makeRng(seed);
  if (style === 'plates') {
    // chir pine: reddish plates separated by deep dark fissures (cellular noise, vertically elongated)
    const cols = 6, cw = w / cols, ch = 46, rows = Math.ceil(h / ch) + 1;
    const cell = (i, j) => { const ii = ((i % cols) + cols) % cols; return { x: i * cw + ihash(ii, j, seed) * cw, y: j * ch + ihash(ii, j, seed + 1) * ch, k: ihash(ii, j, seed + 2) }; };
    const grid = new Map();
    for (let j = -2; j <= rows + 1; j++) for (let i = -2; i <= cols + 1; i++) grid.set(i + ',' + j, cell(i, j));
    pixelRegion(C, x0, y0, w, h, (x, y) => {
      let d1 = 1e9, d2 = 1e9, k = 0;
      const ci = Math.floor(x / cw), cj = Math.floor(y / ch);
      for (let jj = cj - 1; jj <= cj + 1; jj++) for (let ii = ci - 1; ii <= ci + 1; ii++) {
        const p = grid.get(ii + ',' + jj); if (!p) continue;
        const dx = x - p.x, dy = (y - p.y) * 0.5; const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; k = p.k; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const crack = smoothstep(1.5, 6, edge);
      const n = vnoise3(x * 0.3, y * 0.08, seed) * 0.35 + vnoise3(x * 1.1, y * 0.5, seed + 3) * 0.2;
      const base = [lerp(92, 118, k), lerp(74, 84, k), lerp(64, 66, k)];
      const f = (0.72 + n);
      const deep = 1 - crack; // fissures reveal dark reddish-brown
      return [lerp(base[0] * f, 72, deep), lerp(base[1] * f, 34, deep), lerp(base[2] * f, 22, deep)];
    });
  } else {
    // fissured bark (sal, deodar, oak)
    const P = style === 'sal' ? { b: [96, 82, 68], ridge: 0.14, fiss: 0.55, lich: 0.05 }
      : style === 'deodar' ? { b: [78, 70, 64], ridge: 0.18, fiss: 0.7, lich: 0.02 }
        : { b: [100, 98, 90], ridge: 0.3, fiss: 0.45, lich: 0.25 };
    pixelRegion(C, x0, y0, w, h, (x, y) => {
      const xw = (x / w) * 7; // periodic around trunk
      const warp = (pnoise2(xw * 0.5, y * 0.01, 4, seed + 2) - 0.5) * 2.2;
      const n1 = pfbm2(xw + warp, y * 0.0045, 7, 3, seed);
      const n2 = pfbm2(xw * 2.5, y * 0.03, 18, 2, seed + 5);
      const f1 = Math.abs(n1 - 0.5) * 2;
      const fiss = smoothstep(0.0, P.fiss * 0.3, f1);
      const block = style === 'oak' ? smoothstep(0.05, 0.25, Math.abs(pnoise2(xw * 2, y * 0.035, 14, seed + 9) - 0.5) * 2) : 1;
      let v = (0.62 + n2 * 0.55) * lerp(0.28, 1, fiss) * lerp(0.55, 1, block);
      let c = [P.b[0] * v, P.b[1] * v, P.b[2] * v];
      const l = pnoise2(xw * 4, y * 0.05, 24, seed + 11);
      if (l > 1 - P.lich) { const t = (l - (1 - P.lich)) / P.lich; c = [lerp(c[0], 150, t * 0.6), lerp(c[1], 158, t * 0.6), lerp(c[2], 130, t * 0.6)]; }
      return c;
    });
  }
  // a few knots
  C.save(); C.beginPath(); C.rect(x0, y0, w, h); C.clip();
  for (let i = 0; i < 6; i++) {
    const kx = x0 + r.range(10, w - 10), ky = y0 + r.range(20, h - 20);
    const g = C.createRadialGradient(kx, ky, 1, kx, ky, r.range(5, 10));
    g.addColorStop(0, 'rgba(25,15,10,0.85)'); g.addColorStop(1, 'rgba(25,15,10,0)');
    C.fillStyle = g; C.beginPath(); C.ellipse(kx, ky, 6, 9, 0, 0, Math.PI * 2); C.fill();
  }
  C.restore();
}

function leafPath(ctx, x, y, ang, len, wid, tipSharp = 0.5) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.2, -wid * 0.62, len * (0.75 + tipSharp * 0.1), -wid * 0.45, len, 0);
  ctx.bezierCurveTo(len * (0.75 + tipSharp * 0.1), wid * 0.45, len * 0.2, wid * 0.62, 0, 0);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function paintVolume(C, reg, kind, seed) {
  const [x0, y0, w, h] = reg.px; const r = makeRng(seed);
  C.save(); C.beginPath(); C.rect(x0, y0, w, h); C.clip();
  if (kind === 'broad') {
    C.fillStyle = '#2a401c'; C.fillRect(x0, y0, w, h);
    for (let i = 0; i < 70; i++) { // depth blotches
      const x = x0 + r() * w, y = y0 + r() * h, rad = r.range(8, 26);
      const g = C.createRadialGradient(x, y, 0, x, y, rad); g.addColorStop(0, 'rgba(10,20,6,0.7)'); g.addColorStop(1, 'rgba(10,20,6,0)');
      C.fillStyle = g; C.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 1500; i++) {
      const x = x0 + r() * w, y = y0 + r() * h; const L = r.range(6, 13);
      C.fillStyle = hsl(r.range(78, 104) | 0, r.range(38, 58) | 0, r.range(16, 40) | 0);
      leafPath(C, x, y, r() * Math.PI * 2, L, L * 0.55);
      if (r() < 0.35) { C.fillStyle = hsl(r.range(70, 90) | 0, 55, r.range(44, 58) | 0); leafPath(C, x + 1, y - 1, r() * 6.28, L * 0.5, L * 0.25); }
    }
  } else if (kind === 'needle') {
    C.fillStyle = '#34431f'; C.fillRect(x0, y0, w, h);
    for (let i = 0; i < 240; i++) {
      const cx = x0 + r() * w, cy = y0 + r() * h; const n = 14;
      for (let j = 0; j < n; j++) {
        const a = r() * Math.PI * 2, L = r.range(8, 24);
        C.strokeStyle = hsl(r.range(66, 86) | 0, r.range(40, 58) | 0, r.range(26, 52) | 0);
        C.lineWidth = r.range(0.8, 1.6);
        C.beginPath(); C.moveTo(cx, cy); C.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); C.stroke();
      }
    }
  } else if (kind === 'deodar') {
    C.fillStyle = '#21382b'; C.fillRect(x0, y0, w, h);
    for (let i = 0; i < 520; i++) {
      const cx = x0 + r() * w, cy = y0 + r() * h;
      C.strokeStyle = hsl(r.range(140, 165) | 0, r.range(18, 32) | 0, r.range(20, 42) | 0); C.lineWidth = r.range(0.8, 1.6);
      for (let j = 0; j < 8; j++) {
        const a = Math.PI * 0.5 + r.range(-1.1, 1.1), L = r.range(5, 13);
        C.beginPath(); C.moveTo(cx, cy); C.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); C.stroke();
      }
    }
  } else if (kind === 'culm') {
    // bamboo culm (left 128px): green-yellow with nodes ; banana pseudostem (right 128px)
    pixelRegion(C, x0, y0, 128, h, (x, y) => {
      const across = Math.sin((x / 128) * Math.PI * 4) * 0.12;
      const node = Math.abs(((y % 64) - 4)) < 2.5 ? 0.45 : (((y % 64) > 6 && (y % 64) < 10) ? 1.18 : 1);
      const n = vnoise3(x * 0.4, y * 0.03, 7) * 0.25;
      const f = (0.78 + across + n) * node;
      return [128 * f, 150 * f, 62 * f];
    });
    pixelRegion(C, x0 + 128, y0, 128, h, (x, y) => {
      const fib = vnoise3(x * 0.9, y * 0.012, 3) * 0.4 + vnoise3(x * 3, y * 0.05, 4) * 0.15;
      const brown = smoothstep(0.62, 0.8, vnoise3(x * 0.05, y * 0.03, 9));
      const f = 0.7 + fib;
      return [lerp(104, 120, brown) * f, lerp(124, 92, brown) * f, lerp(58, 52, brown) * f];
    });
  }
  C.restore();
}

/** paint the same shapes on colour (C) and alpha (A) canvases. painter(ctx, col) — call col(css) to get the fill. */
function paintCard(C, A, reg, bg, painter, seed) {
  const [x0, y0, w, h] = reg.px;
  C.save(); C.beginPath(); C.rect(x0, y0, w, h); C.clip(); C.fillStyle = bg; C.fillRect(x0, y0, w, h);
  C.translate(x0, y0); painter(C, c => c, makeRng(seed)); C.restore();
  A.save(); A.beginPath(); A.rect(x0, y0, w, h); A.clip(); A.fillStyle = '#000'; A.fillRect(x0, y0, w, h);
  A.translate(x0, y0); painter(A, () => '#fff', makeRng(seed), true); A.restore();
}

function buildAtlas() {
  const cc = document.createElement('canvas'); cc.width = cc.height = AT;
  const ca = document.createElement('canvas'); ca.width = ca.height = AT;
  const C = cc.getContext('2d', { willReadFrequently: true }), A = ca.getContext('2d');
  A.fillStyle = '#fff'; A.fillRect(0, 0, AT, 512);
  A.fillStyle = '#000'; A.fillRect(0, 512, AT, 512);

  paintBark(C, REG.barkSal, 'sal', 11);
  paintBark(C, REG.barkPine, 'plates', 23);
  paintBark(C, REG.barkDeodar, 'deodar', 37);
  paintBark(C, REG.barkOak, 'oak', 41);
  C.fillStyle = '#ffffff'; C.fillRect(0, 448, 512, 64);
  paintVolume(C, REG.volBroad, 'broad', 5);
  paintVolume(C, REG.volNeedle, 'needle', 6);
  paintVolume(C, REG.volDeodar, 'deodar', 7);
  paintVolume(C, { px: [768, 256, 256, 256] }, 'culm', 8);

  // --- sal leaf cluster: broad ovate leaves around a twig
  paintCard(C, A, REG.cardSal, '#4d7430', (ctx, col, r, isA) => {
    ctx.strokeStyle = col('#4a3a28'); ctx.lineWidth = isA ? 5 : 4;
    ctx.beginPath(); ctx.moveTo(128, 256); ctx.quadraticCurveTo(120, 150, 132, 40); ctx.stroke();
    for (let i = 0; i < 30; i++) {
      const t = r.range(0.05, 1), bx = 128 + Math.sin(t * 3) * 6, by = 256 - t * 210;
      const side = r.sign(); const ang = -Math.PI / 2 + side * r.range(0.35, 1.35);
      const L = r.range(50, 82) * (1 - t * 0.25), Wd = L * r.range(0.48, 0.6);
      ctx.fillStyle = col(hsl(r.range(82, 100) | 0, r.range(40, 55) | 0, r.range(24, 40) | 0));
      leafPath(ctx, bx, by, ang, L, Wd, 0.6);
      if (!isA) { ctx.strokeStyle = 'rgba(190,210,140,0.45)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(ang) * L * 0.95, by + Math.sin(ang) * L * 0.95); ctx.stroke(); }
    }
  }, 101);

  // --- chir pine: radial burst of long needles (tuft seen from any side)
  paintCard(C, A, REG.cardPine, '#5f7a34', (ctx, col, r, isA) => {
    for (let i = 0; i < 190; i++) {
      const a = r() * Math.PI * 2, L = r.range(45, 122), bend = r.range(-0.25, 0.25);
      ctx.strokeStyle = col(hsl(r.range(70, 88) | 0, r.range(38, 52) | 0, r.range(25, 42) | 0));
      ctx.lineWidth = isA ? 2.6 : 1.8;
      const x1 = 128 + Math.cos(a) * L, y1 = 128 + Math.sin(a) * L;
      ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * 6, 128 + Math.sin(a) * 6);
      ctx.quadraticCurveTo(128 + Math.cos(a + bend) * L * 0.55, 128 + Math.sin(a + bend) * L * 0.55 + L * 0.08, x1, y1 + L * 0.12); ctx.stroke();
    }
    ctx.fillStyle = col('#6b4a2c'); ctx.beginPath(); ctx.arc(128, 128, 7, 0, Math.PI * 2); ctx.fill();
  }, 102);

  // --- deodar branch, seen from above: main twig (base at bottom → tip at top), side twigs, needle rosettes
  paintCard(C, A, REG.cardDeodar, '#35584a', (ctx, col, r, isA) => {
    const twig = (x0, y0, x1, y1, w) => { ctx.strokeStyle = col('#4a3c2e'); ctx.lineWidth = isA ? w + 1 : w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    const rosette = (x, y, L) => {
      for (let q = 0; q < 8; q++) {
        const a = r() * Math.PI * 2, l = r.range(L * 0.5, L);
        ctx.strokeStyle = col(hsl(r.range(142, 164) | 0, r.range(20, 34) | 0, r.range(24, 46) | 0)); ctx.lineWidth = isA ? 2.6 : 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    };
    twig(128, 256, 128 + r.range(-6, 6), 6, 4);
    const nSide = 11;
    for (let i = 0; i < nSide; i++) {
      const t = (i + 0.5) / nSide, y = 250 - t * 236;
      const env = Math.sin(Math.min(1, t * 1.1) * Math.PI) * 0.65 + 0.35;  // feather outline
      for (const sd of [-1, 1]) {
        const L = (104 * env) * r.range(0.8, 1.05), ang = -Math.PI / 2 + sd * r.range(0.75, 1.05);
        const x1 = 128 + Math.cos(ang) * L, y1 = y + Math.sin(ang) * L;
        twig(128, y, x1, y1, 2);
        const steps = Math.max(2, Math.round(L / 9));
        for (let k = 1; k <= steps; k++) { const f = k / steps; rosette(lerp(128, x1, f), lerp(y, y1, f), lerp(13, 9, f)); }
      }
      rosette(128, y, 12);
    }
  }, 103);

  // --- banj oak: dense small leaves, dark green with silvery undersides
  paintCard(C, A, REG.cardOak, '#3d5a30', (ctx, col, r, isA) => {
    for (let i = 0; i < 230; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 96;
      const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d * 0.92;
      const L = r.range(18, 32);
      const silver = r() < 0.18;
      ctx.fillStyle = col(silver ? hsl(r.range(90, 110) | 0, 10, r.range(52, 64) | 0) : hsl(r.range(88, 112) | 0, r.range(28, 42) | 0, r.range(18, 34) | 0));
      leafPath(ctx, x, y, a + r.range(-0.8, 0.8), L, L * 0.42, 0.3);
    }
  }, 104);

  // --- grass blades
  paintCard(C, A, REG.cardGrass, '#6f8a3a', (ctx, col, r) => {
    for (let i = 0; i < 60; i++) {
      const bx = r.range(8, 248), H = r.range(110, 246), wd = r.range(3.5, 7.5), lean = r.range(-40, 40);
      const g = ctx.createLinearGradient(0, 256, 0, 256 - H);
      const c1 = hsl(r.range(70, 92) | 0, r.range(35, 50) | 0, r.range(18, 28) | 0), c2 = hsl(r.range(55, 80) | 0, r.range(35, 55) | 0, r.range(42, 60) | 0);
      if (col('#000') === '#fff') ctx.fillStyle = '#fff'; else { g.addColorStop(0, c1); g.addColorStop(1, c2); ctx.fillStyle = g; }
      ctx.beginPath(); ctx.moveTo(bx - wd / 2, 256); ctx.quadraticCurveTo(bx + lean * 0.3, 256 - H * 0.55, bx + lean, 256 - H);
      ctx.quadraticCurveTo(bx + lean * 0.3 + wd * 0.3, 256 - H * 0.55, bx + wd / 2, 256); ctx.closePath(); ctx.fill();
    }
  }, 105);

  // --- fern frond (rachis vertical, base at bottom)
  paintCard(C, A, REG.cardFern, '#4b7f2f', (ctx, col, r, isA) => {
    ctx.strokeStyle = col('#5f6a2a'); ctx.lineWidth = isA ? 4 : 3;
    ctx.beginPath(); ctx.moveTo(128, 256); ctx.quadraticCurveTo(134, 128, 126, 6); ctx.stroke();
    const pairs = 19;
    for (let i = 0; i < pairs; i++) {
      const t = (i + 0.6) / pairs, y = 250 - t * 238, x = 128 + Math.sin(t * 2) * 3;
      const L = 112 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.1)) * (1 - t * 0.35) + 8;
      for (const s of [-1, 1]) {
        ctx.fillStyle = col(hsl(r.range(92, 108) | 0, r.range(45, 58) | 0, r.range(26, 38) | 0));
        const ang = s > 0 ? -0.5 : Math.PI + 0.5;
        // lobed pinna
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(0, 0);
        const lobes = Math.max(3, Math.round(L / 10));
        for (let k = 0; k <= lobes; k++) { const px = (k / lobes) * L, pw = 6.5 * (1 - k / lobes * 0.85); ctx.lineTo(px, -pw - (k % 2) * 2); }
        for (let k = lobes; k >= 0; k--) { const px = (k / lobes) * L, pw = 6.5 * (1 - k / lobes * 0.85); ctx.lineTo(px, pw + (k % 2) * 2); }
        ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
  }, 106);

  // --- banana leaf (long blade along v, midrib, parallel veins, torn slits)
  paintCard(C, A, REG.cardBanana, '#5c9a30', (ctx, col, r, isA) => {
    ctx.fillStyle = col('#5e9c32');
    ctx.beginPath(); ctx.moveTo(128, 254);
    ctx.bezierCurveTo(40, 230, 14, 120, 30, 30); ctx.quadraticCurveTo(70, 2, 128, 4); ctx.quadraticCurveTo(186, 2, 226, 30);
    ctx.bezierCurveTo(242, 120, 216, 230, 128, 254); ctx.closePath(); ctx.fill();
    if (!isA) {
      ctx.save(); ctx.clip();
      for (let y = 8; y < 252; y += 5) { // lateral veins
        ctx.strokeStyle = `rgba(40,80,20,${r.range(0.15, 0.35)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(128, y); ctx.lineTo(8, y - 30); ctx.moveTo(128, y); ctx.lineTo(248, y - 30); ctx.stroke();
      }
      for (let i = 0; i < 26; i++) { // light patches + dry brown edges
        const ex = r() < 0.5 ? r.range(14, 40) : r.range(216, 242), ey = r.range(20, 240);
        ctx.fillStyle = `rgba(140,110,50,${r.range(0.3, 0.7)})`; ctx.beginPath(); ctx.ellipse(ex, ey, r.range(5, 14), r.range(4, 10), 0, 0, 6.28); ctx.fill();
      }
      ctx.fillStyle = 'rgba(200,230,120,0.18)'; ctx.fillRect(0, 0, 128, 256);
      ctx.restore();
      ctx.strokeStyle = '#c9d98e'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(128, 254); ctx.lineTo(128, 6); ctx.stroke();
    } else {
      // torn slits (transparent)
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
      for (let i = 0; i < 9; i++) {
        const y = r.range(40, 230), s = r.sign(); const x0 = 128 + s * r.range(25, 60);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(128 + s * 130, y - 34); ctx.stroke();
      }
    }
  }, 107);

  // --- bamboo leaves: narrow lanceolate leaves drooping from twigs
  paintCard(C, A, REG.cardBamboo, '#6f9a3c', (ctx, col, r, isA) => {
    for (let t = 0; t < 5; t++) {
      const tx = 30 + t * 48 + r.range(-8, 8), ty = r.range(10, 50);
      ctx.strokeStyle = col('#7a7a3a'); ctx.lineWidth = isA ? 2.5 : 1.6;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + r.range(-12, 12), ty + 150); ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const y = ty + i * 17, x = tx + r.range(-5, 5);
        const ang = Math.PI / 2 + r.range(-0.9, 0.9);
        ctx.fillStyle = col(hsl(r.range(76, 96) | 0, r.range(42, 56) | 0, r.range(30, 46) | 0));
        leafPath(ctx, x, y, ang, r.range(58, 92), r.range(10, 15), 0.9);
      }
    }
  }, 108);

  const color = new THREE.CanvasTexture(cc); color.colorSpace = THREE.SRGBColorSpace; color.anisotropy = 4;
  color.needsUpdate = true;
  const alpha = coverageMipTexture(ca);
  return { color, alpha, canvas: cc, alphaCanvas: ca };
}

/**
 * Alpha map with hand-built mip chain that preserves leaf coverage at distance
 * (plain box-filtered mips make alpha-tested foliage thin out and turn see-through far away).
 */
function coverageMipTexture(src) {
  const levels = [src];
  let prev = src, size = src.width, k = 0;
  while (size > 1) {
    size = Math.max(1, size >> 1); k++;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(prev, 0, 0, size, size);
    if (size >= 2) {
      const img = x.getImageData(0, 0, size, size), d = img.data, boost = 1 + 0.55 * k;
      for (let i = 0; i < d.length; i += 4) { const a = Math.min(255, d[i + 1] * boost); d[i] = d[i + 1] = d[i + 2] = a; d[i + 3] = 255; }
      x.putImageData(img, 0, 0);
    }
    levels.push(c); prev = c;
  }
  const t = new THREE.Texture(src);
  t.mipmaps = levels;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
function atlas() { if (!ATLAS) ATLAS = buildAtlas(); return ATLAS; }
/** debug: the atlas canvases */
export function _vegAtlas() { return atlas(); }

// ============================================================================ wind-sway material
const SWAY_PARS = '#include <common>\nuniform float uTime;\nuniform vec3 uSway;';
const SWAY_PROJECT = /* glsl */`
vec4 swLocal = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  swLocal = batchingMatrix * swLocal;
#endif
vec3 swPivot = modelMatrix[3].xyz;
#ifdef USE_INSTANCING
  swLocal = instanceMatrix * swLocal;
  swPivot += instanceMatrix[3].xyz;
#endif
vec4 swWorld = modelMatrix * swLocal;
float swH = clamp( transformed.y / uSway.x, 0.0, 1.4 );
float swHH = swH * swH;
float swPh = dot( swPivot.xz, vec2( 0.071, 0.053 ) );
float swGust = 0.55 + 0.45 * sin( uTime * 0.31 + swPh * 0.37 );
float swS = ( sin( uTime * 1.21 + swPh ) * 0.65 + sin( uTime * 2.37 + swPh * 1.71 ) * 0.35 ) * swGust;
swWorld.xz += vec2( 0.89, 0.45 ) * ( swS * uSway.y * swHH );
float swF = sin( uTime * 6.3 + dot( swWorld.xyz, vec3( 1.7, 1.3, 2.1 ) ) ) * uSway.z * swHH;
swWorld.xyz += vec3( swF, swF * 0.5, -swF * 0.8 );
vec4 mvPosition = viewMatrix * swWorld;
gl_Position = projectionMatrix * mvPosition;
`;
// foliage normals are bent outward from the crown; when such a normal faces away from the viewer the PBR
// specular term explodes into a white haze. Bend shading normals back toward the viewer when back-facing.
const FACE_FIX = /* glsl */`
{
  vec3 vegV = normalize( vViewPosition );
  float vegNV = dot( normal, vegV );
  normal = normalize( normal + vegV * max( 0.0, 0.35 - vegNV ) * 1.15 );
}
`;
function injectSway(shader, uSway) {
  shader.uniforms.uTime = shared.uTime;
  shader.uniforms.uSway = uSway;
  shader.vertexShader = shader.vertexShader.replace('#include <common>', SWAY_PARS).replace('#include <project_vertex>', SWAY_PROJECT);
  if (shader.fragmentShader.includes('varying vec3 vViewPosition;'))
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n' + FACE_FIX);
}
function makeVegMaterials(H, sway, flutter, useAlpha, roughness = 0.86) {
  const A = atlas();
  const uSway = { value: new THREE.Vector3(H, sway, flutter) };
  const material = new THREE.MeshStandardMaterial({
    map: A.color, alphaMap: useAlpha ? A.alpha : null, alphaTest: useAlpha ? 0.42 : 0,
    vertexColors: true, roughness, metalness: 0, side: THREE.FrontSide, envMapIntensity: 0.75,
  });
  material.onBeforeCompile = (shader) => injectSway(shader, uSway);
  material.userData.uSway = uSway;
  const depthMaterial = new THREE.MeshDepthMaterial({ alphaMap: useAlpha ? A.alpha : null, alphaTest: useAlpha ? 0.42 : 0 });
  depthMaterial.onBeforeCompile = (shader) => injectSway(shader, uSway);
  return { material, depthMaterial };
}

// ============================================================================ geometry builder
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
class VB {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; }
  v(p, n, uv, c) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.t.push(uv[0], uv[1]); this.c.push(c[0], c[1], c[2]); }
  tri(a, b, c) { this.v(a[0], a[1], a[2], a[3]); this.v(b[0], b[1], b[2], b[3]); this.v(c[0], c[1], c[2], c[3]); }
  get tris() { return this.p.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
const _c = new THREE.Color();
function lin(hex, f = 1) { _c.setHex(hex); return [_c.r * f, _c.g * f, _c.b * f]; }
function mulc(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }
function vary(c, r, amt = 0.08) { const f = 1 + r.range(-amt, amt); return [c[0] * f * (1 + r.range(-amt, amt) * 0.6), c[1] * f, c[2] * f * (1 + r.range(-amt, amt))]; }

function basisFor(dir) {
  const a = Math.abs(dir.y) < 0.95 ? V3(0, 1, 0) : V3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(a, dir).normalize();
  const w = new THREE.Vector3().crossVectors(dir, u).normalize();
  return [u, w];
}

/** tapered tube (trunk / branch / culm). colorAt(t) -> rgb */
function addTube(vb, { base, dir, len, r0, r1, radial = 6, segs = 1, region, colorAt, bend = null, rough = 0, seed = 0, vScale = 1 }) {
  dir = dir.clone().normalize();
  const [U, W] = basisFor(dir);
  const rings = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = base.clone().addScaledVector(dir, len * t);
    if (bend) c.add(bend(t));
    const r = lerp(r0, r1, t);
    const col = colorAt(t);
    const ring = [];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nrm = U.clone().multiplyScalar(Math.cos(a)).addScaledVector(W, Math.sin(a));
      const rr = rough ? r * (1 + (vnoise3(Math.cos(a) * 1.5 + seed, t * len * 0.8, Math.sin(a) * 1.5) - 0.5) * rough) : r;
      ring.push([c.clone().addScaledVector(nrm, rr), nrm, [lerp(region.u0, region.u1, j / radial), lerp(region.v0, region.v1, Math.min(1, t * vScale))], col]);
    }
    rings.push(ring);
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j + 1], d = rings[i + 1][j];
    vb.tri(a, b, c); vb.tri(a, c, d);
  }
}

const ICO = {};
function icoTris(detail) {
  if (!ICO[detail]) { const g = new THREE.IcosahedronGeometry(1, detail); ICO[detail] = Array.from(g.attributes.position.array); g.dispose(); }
  return ICO[detail];
}
/** displaced leaf-mass blob with soft (crown-spherical) normals, AO vertex colours and per-triangle box mapping */
function addBlob(vb, { center, radius, scale = [1, 1, 1], detail = 1, region, tint, crownC, crownR, seed = 0, disp = 0.3, flat = 0.72, aoMin = 0.5, nCrown = 0.55 }) {
  const arr = icoTris(detail);
  const vs = [];
  for (let i = 0; i < arr.length; i += 3) {
    const d = V3(arr[i], arr[i + 1], arr[i + 2]).normalize();
    const n1 = vnoise3(d.x * 1.9 + seed * 7.1, d.y * 1.9 + seed * 3.3, d.z * 1.9 + seed * 5.7);
    const n2 = vnoise3(d.x * 4.7 + seed, d.y * 4.7 - seed, d.z * 4.7 + seed * 2.0);
    const r = 1 + disp * ((n1 - 0.5) * 1.6 + (n2 - 0.5) * 0.6);
    const L = d.clone().multiplyScalar(r * radius);
    L.x *= scale[0]; L.y *= scale[1] * (d.y < 0 ? flat : 1); L.z *= scale[2];
    const p = L.clone().add(center);
    const nb = L.clone().normalize();
    const nc = p.clone().sub(crownC).normalize();
    const n = nb.multiplyScalar(1 - nCrown).addScaledVector(nc, nCrown).normalize();
    const hy = clamp((p.y - crownC.y) / crownR, -1, 1);
    const out = clamp(p.clone().sub(crownC).length() / crownR, 0, 1);
    const ao = lerp(aoMin, 1.04, smoothstep(-1, 0.85, hy)) * lerp(0.78, 1.0, out);
    vs.push({ p, n, L, ao });
  }
  const R = radius * 1.4;
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  for (let i = 0; i < vs.length; i += 3) {
    const a = vs[i], b = vs[i + 1], c = vs[i + 2];
    const fn = ab.subVectors(b.L, a.L).cross(ac.subVectors(c.L, a.L));
    const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    const proj = (P) => {
      let s, t; if (ax >= ay && ax >= az) { s = P.z; t = P.y; } else if (ay >= az) { s = P.x; t = P.z; } else { s = P.x; t = P.y; }
      return [lerp(region.u0, region.u1, clamp(0.5 + 0.5 * s / R, 0, 1)), lerp(region.v0, region.v1, clamp(0.5 + 0.5 * t / R, 0, 1))];
    };
    vb.tri([a.p, a.n, proj(a.L), mulc(tint, a.ao)], [b.p, b.n, proj(b.L), mulc(tint, b.ao)], [c.p, c.n, proj(c.L), mulc(tint, c.ao)]);
  }
}

/** double-sided leaf card with crown-spherical normals */
function addCard(vb, { center, normal, w, h, rot = 0, region, tint, crownC, crownR, droop = 0, nCrown = 0.65, aoMin = 0.55 }) {
  const n = normal.clone().normalize();
  const up = Math.abs(n.y) > 0.95 ? V3(1, 0, 0) : V3(0, 1, 0);
  const t1 = up.clone().sub(n.clone().multiplyScalar(up.dot(n))).normalize();
  const t2 = new THREE.Vector3().crossVectors(t1, n).normalize();
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const U = t2.clone().multiplyScalar(cs).addScaledVector(t1, sn);
  const Vv = t1.clone().multiplyScalar(cs).addScaledVector(t2, -sn);
  const hw = w / 2, hh = h / 2;
  const P = [
    center.clone().addScaledVector(U, -hw).addScaledVector(Vv, -hh), center.clone().addScaledVector(U, hw).addScaledVector(Vv, -hh),
    center.clone().addScaledVector(U, hw).addScaledVector(Vv, hh), center.clone().addScaledVector(U, -hw).addScaledVector(Vv, hh),
  ];
  if (droop) { P[2].y -= droop; P[3].y -= droop; }
  const UV = [[region.u0, region.v0], [region.u1, region.v0], [region.u1, region.v1], [region.u0, region.v1]];
  const N = P.map(p => p.clone().sub(crownC).normalize().multiplyScalar(nCrown).addScaledVector(n, 1 - nCrown).normalize());
  const C = P.map(p => mulc(tint, lerp(aoMin, 1.08, smoothstep(-1, 0.9, clamp((p.y - crownC.y) / crownR, -1, 1)))));
  const vx = i => [P[i], N[i], UV[i], C[i]];
  vb.tri(vx(0), vx(1), vx(2)); vb.tri(vx(0), vx(2), vx(3));
  vb.tri(vx(0), vx(2), vx(1)); vb.tri(vx(0), vx(3), vx(2));
}

/**
 * ribbon along a spine (grass blade card, fern frond, banana leaf). pts: spine points base→tip,
 * widths per point, side: unit vector across. fold: raise the middle line along the face normal (V-shaped leaf).
 * normalMode: 'geo' (true normals, back face flipped) | 'up' (upward-biased for grass)
 */
function addRibbon(vb, { pts, widths, side, region, colors, fold = 0, normalMode = 'geo', upBias = 0.5 }) {
  const n = pts.length;
  const across = fold ? 3 : 2;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const tng = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    const face = new THREE.Vector3().crossVectors(side, tng).normalize(); // front-face normal
    const hw = widths[i] / 2; const row = [];
    for (let k = 0; k < across; k++) {
      const s = across === 2 ? (k === 0 ? -1 : 1) : (k - 1);
      const p = pts[i].clone().addScaledVector(side, s * hw);
      if (fold && k === 1) p.addScaledVector(face, fold * widths[i]);
      let nn = face.clone();
      if (normalMode === 'up') nn = face.clone().multiplyScalar(1 - upBias).add(V3(0, upBias, 0)).normalize();
      const u = across === 2 ? (k === 0 ? region.u0 : region.u1) : lerp(region.u0, region.u1, k / 2);
      row.push({ p, n: nn, uv: [u, lerp(region.v0, region.v1, i / (n - 1))], c: colors[i] });
    }
    rows.push(row);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < across - 1; k++) {
    const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k + 1], d = rows[i + 1][k];
    const F = (q) => [q.p, q.n, q.uv, q.c];
    const B = (q) => [q.p, normalMode === 'up' ? q.n : q.n.clone().negate(), q.uv, q.c];
    vb.tri(F(a), F(b), F(c)); vb.tri(F(a), F(c), F(d));
    vb.tri(B(a), B(c), B(b)); vb.tri(B(a), B(d), B(c));
  }
}

function randDirUp(r, minY = -0.3) {
  for (let k = 0; k < 20; k++) {
    const v = V3(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1));
    const l = v.length(); if (l > 1 || l < 0.1) continue;
    v.divideScalar(l); if (v.y >= minY) return v;
  }
  return V3(0, 1, 0);
}

// ============================================================================ tree kinds
const KINDS = {
  sal: { H: 20, sway: 0.32, flutter: 0.035, lowAlpha: false, radius: 5.2, trunk: 0.36 },
  pine: { H: 22, sway: 0.42, flutter: 0.05, lowAlpha: false, radius: 4.6, trunk: 0.34 },
  deodar: { H: 25, sway: 0.3, flutter: 0.03, lowAlpha: false, radius: 5.0, trunk: 0.45 },
  oak: { H: 12, sway: 0.2, flutter: 0.035, lowAlpha: false, radius: 5.6, trunk: 0.42 },
  bush: { H: 1.5, sway: 0.05, flutter: 0.02, lowAlpha: false, radius: 1.3, trunk: 0.0 },
  bamboo: { H: 10, sway: 0.55, flutter: 0.05, lowAlpha: true, radius: 3.0, trunk: 0.6 },
  banana: { H: 4, sway: 0.12, flutter: 0.06, lowAlpha: true, radius: 2.2, trunk: 0.16 },
  grass: { H: 0.6, sway: 0.07, flutter: 0.02, lowAlpha: true, radius: 0.35, trunk: 0 },
  fern: { H: 0.8, sway: 0.05, flutter: 0.02, lowAlpha: true, radius: 0.7, trunk: 0 },
};

function barkColor(t, dark = 0.5, f = 1) { return lin(0xffffff, f * lerp(dark, 1.0, smoothstep(0, 0.1, t))); }

function buildSal(high) {
  const vb = new VB(); const r = makeRng(1201);
  const lean = V3(0.03, 1, -0.02).normalize();
  addTube(vb, { base: V3(0, -0.3, 0), dir: lean, len: 14.8, r0: 0.36, r1: 0.13, radial: high ? 7 : 4, segs: high ? 4 : 1, region: REG.barkSal,
    colorAt: t => barkColor(t, 0.45), bend: t => V3(Math.sin(t * 2.4) * 0.22, 0, Math.cos(t * 1.9) * 0.14 - 0.14), rough: high ? 0.12 : 0, seed: 3, vScale: 1 });
  if (high) addTube(vb, { base: V3(0, -0.2, 0), dir: V3(0, 1, 0), len: 1.0, r0: 0.62, r1: 0.34, radial: 7, segs: 1, region: REG.barkSal, colorAt: t => barkColor(t, 0.42, 0.85), rough: 0.25, seed: 9 });
  const crownC = V3(0.25, 15.8, -0.1), crownR = 4.8;
  const blobs = [{ c: V3(0.2, 18.2, -0.1), r: 2.6 }];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + r.range(-0.3, 0.3), d = r.range(2.4, 3.4);
    blobs.push({ c: V3(Math.cos(a) * d + 0.2, r.range(14.0, 16.9), Math.sin(a) * d), r: r.range(1.9, 2.6) });
  }
  const leaf = lin(0xeef8d0);
  if (high) {
    for (let i = 1; i < blobs.length; i += 2) {
      const b = blobs[i]; const h0 = r.range(10.5, 13.2); const base = V3(Math.sin(h0 / 14.8 * 2.4) * 0.22 + lean.x * h0, h0 - 0.3, -0.14);
      const to = b.c.clone().sub(base);
      addTube(vb, { base, dir: to, len: to.length() * 0.85, r0: 0.12, r1: 0.04, radial: 4, segs: 1, region: REG.barkSal, colorAt: () => lin(0xffffff, 0.8) });
    }
    for (const b of blobs) addBlob(vb, { center: b.c, radius: b.r, scale: [1, 0.8, 1], detail: 1, region: REG.volBroad, tint: vary(leaf, r), crownC, crownR, seed: r() * 50 });
    for (const b of blobs) for (let k = 0; k < 4; k++) {
      const d = randDirUp(r, -0.45); const c = b.c.clone().addScaledVector(d, b.r * 0.9);
      addCard(vb, { center: c, normal: d, w: 2.8, h: 2.8, rot: r() * 6.28, region: REG.cardSal, tint: vary(lin(0xe8f2d8), r), crownC, crownR, droop: 0.3 });
    }
  } else {
    const sub = [blobs[0], blobs[1], blobs[3], blobs[5], blobs[7]];
    for (const b of sub) addBlob(vb, { center: b.c, radius: b.r * 1.28, scale: [1, 1.0, 1], detail: 0, region: REG.volBroad, tint: leaf, crownC, crownR, seed: 3, disp: 0.18, flat: 0.85 });
  }
  return vb;
}

function buildPine(high) {
  const vb = new VB(); const r = makeRng(2207);
  const bend = t => V3(Math.sin(t * Math.PI * 0.8) * 0.65, 0, t * 0.35);
  const trunkLen = 21.2;
  addTube(vb, { base: V3(0, -0.3, 0), dir: V3(0, 1, 0), len: trunkLen, r0: 0.34, r1: 0.06, radial: high ? 6 : 4, segs: high ? 5 : 1, region: REG.barkPine,
    colorAt: t => barkColor(t, 0.5), bend, rough: high ? 0.15 : 0, seed: 5 });
  const crownC = V3(0.5, 16.2, 0.3), crownR = 5.4;
  const needle = lin(0xe4ecd0);
  const tufts = [];
  const nb = 13;
  for (let i = 0; i < nb; i++) {
    const t = lerp(0.40, 0.93, i / (nb - 1)) + r.range(-0.02, 0.02);
    const y = t * trunkLen - 0.3; const pt = V3(0, y, 0).add(bend(t));
    const a = i * 2.4 + r.range(-0.4, 0.4);
    const L = lerp(4.6, 1.9, (i / (nb - 1))) * r.range(0.85, 1.15);
    const rise = lerp(-0.08, 0.5, i / (nb - 1)) + r.range(-0.1, 0.15);
    const dir = V3(Math.cos(a), rise, Math.sin(a)).normalize();
    const droop = s => V3(0, -Math.sin(s * Math.PI) * 0.35, 0);
    if (high) addTube(vb, { base: pt, dir, len: L, r0: 0.11, r1: 0.035, radial: 4, segs: 1, region: REG.barkPine, colorAt: () => lin(0xffffff, 0.8), bend: droop });
    const tip = pt.clone().addScaledVector(dir, L);
    tufts.push({ c: tip.clone().add(V3(0, 0.2, 0)), r: r.range(1.15, 1.5) });
    if (L > 2.4) tufts.push({ c: pt.clone().addScaledVector(dir, L * 0.62).add(V3(0, 0.15, 0)), r: r.range(0.95, 1.25) });
    if (L > 3.6) tufts.push({ c: pt.clone().addScaledVector(dir, L * 0.3).add(V3(0, 0.25, 0)), r: r.range(0.8, 1.0) });
  }
  const top = V3(0, trunkLen - 0.3, 0).add(bend(1));
  tufts.push({ c: top.clone().add(V3(0, 0.4, 0)), r: 1.35 }, { c: top.clone().add(V3(0.7, -0.9, 0.3)), r: 1.2 }, { c: top.clone().add(V3(-0.6, -1.3, -0.2)), r: 1.15 });
  if (high) {
    for (const t of tufts) {
      addBlob(vb, { center: t.c, radius: t.r * 0.5, scale: [1.2, 0.7, 1.2], detail: 0, region: REG.volNeedle, tint: mulc(vary(needle, r, 0.08), 0.75), crownC, crownR, seed: r() * 50, disp: 0.25, aoMin: 0.55, nCrown: 0.6 });
      const nc = t.r > 1.3 ? 4 : 3;
      for (let k = 0; k < nc; k++) {
        const d = k === 0 ? V3(r.range(-0.2, 0.2), 1, r.range(-0.2, 0.2)).normalize() : randDirUp(r, -0.35);
        addCard(vb, { center: t.c.clone().addScaledVector(d, t.r * 0.12), normal: d, w: t.r * 2.3, h: t.r * 2.3, rot: r() * 6.28, region: REG.cardPine, tint: vary(needle, r, 0.08), crownC, crownR, aoMin: 0.6, nCrown: 0.55 });
      }
    }
  } else {
    // keep the biggest tufts spread over the crown, enlarged so they merge into clumps
    const picks = tufts.filter((t, i) => i % 3 === 1 || i >= tufts.length - 1).slice(-7);
    picks.forEach((t, i) => addBlob(vb, { center: t.c, radius: t.r * 1.7, scale: [1.15, 0.8, 1.15], detail: 0, region: REG.volNeedle, tint: mulc(needle, 0.78), crownC, crownR, seed: i, disp: 0.3, aoMin: 0.6, flat: 0.8 }));
  }
  return vb;
}

function buildDeodar(high) {
  const vb = new VB(); const r = makeRng(3301);
  const H = 25;
  addTube(vb, { base: V3(0, -0.3, 0), dir: V3(0, 1, 0), len: H - 0.6, r0: 0.45, r1: 0.05, radial: high ? 6 : 4, segs: high ? 4 : 1, region: REG.barkDeodar, colorAt: t => barkColor(t, 0.45), rough: high ? 0.1 : 0, seed: 2 });
  const crownC = V3(0, 11, 0), crownR = 11;
  const col = lin(0xf2fff6);
  const RG = REG.volDeodar;
  // layered dark inner skirts (mass + horizontal layering)
  const tiers = high ? 10 : 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = lerp(2.8, 22.8, t);
    const Rt = lerp(3.9, 0.8, Math.pow(t, 0.92)) * (high ? r.range(0.9, 1.08) : 1.3);
    const droop = lerp(1.9, 0.7, t) * (high ? 1 : 2.1);
    const seg = high ? 7 : 6;
    const inner = [], outer = [];
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2 + i * 0.9;
      const jag = 1 + (ihash(i, j % seg, 77) - 0.5) * 0.45;
      inner.push(V3(Math.cos(a) * 0.3, y + (high ? 0.9 : 1.6), Math.sin(a) * 0.3));
      outer.push(V3(Math.cos(a) * Rt * jag, y - droop * (0.7 + ihash(i, j % seg, 78) * 0.6), Math.sin(a) * Rt * jag));
    }
    const cTop = mulc(col, high ? lerp(0.42, 0.6, t) : lerp(0.62, 0.92, t)), cBot = mulc(cTop, 0.6);
    for (let j = 0; j < seg; j++) {
      const a = inner[j], b = inner[j + 1], c = outer[j + 1], d = outer[j];
      const sh = (j % 2) * 0.5 * (RG.u1 - RG.u0);
      const ua = [RG.u0 + sh, RG.v1], ub = [lerp(RG.u0, RG.u1, 0.5) + sh, RG.v1], uc = [lerp(RG.u0, RG.u1, 0.5) + sh, RG.v0], ud = [RG.u0 + sh, RG.v0];
      const nT = p => p.clone().sub(V3(0, y - 3.0, 0)).normalize();
      const nB = p => V3(p.x, -1.5, p.z).normalize();
      vb.tri([a, nT(a), ua, cTop], [c, nT(c), uc, cTop], [b, nT(b), ub, cTop]); vb.tri([a, nT(a), ua, cTop], [d, nT(d), ud, cTop], [c, nT(c), uc, cTop]);
      vb.tri([a, nB(a), ua, cBot], [b, nB(b), ub, cBot], [c, nB(c), uc, cBot]); vb.tri([a, nB(a), ua, cBot], [c, nB(c), uc, cBot], [d, nB(d), ud, cBot]);
    }
  }
  if (high) {
    // drooping branch sprays (lighter) that form the soft irregular outline
    const whorls = 17;
    let az = r() * 6.28;
    for (let i = 0; i < whorls; i++) {
      const t = i / (whorls - 1);
      const y = lerp(2.3, 23.4, t);
      const nBr = Math.max(3, Math.round(lerp(6, 3, t)));
      for (let b = 0; b < nBr; b++) {
        az += 2.39996 + r.range(-0.2, 0.2);
        const out = V3(Math.cos(az), 0, Math.sin(az));
        const side = V3(-out.z, 0, out.x);
        side.y = r.range(-0.55, 0.55); side.normalize();
        const L = lerp(5.6, 1.2, Math.pow(t, 0.9)) * r.range(0.85, 1.12);
        const droop = L * r.range(0.3, 0.45);
        const wMax = lerp(3.3, 1.3, t) * r.range(0.85, 1.1);
        const p0 = out.clone().multiplyScalar(0.4).add(V3(0, y + 0.1, 0));
        const p1 = out.clone().multiplyScalar(0.4 + L * 0.5).add(V3(0, y + 0.05, 0));
        const p2 = out.clone().multiplyScalar(0.4 + L * 0.92).add(V3(0, y - droop, 0));
        const c = vary(col, r, 0.08), f = lerp(0.75, 1.0, t);
        addRibbon(vb, { pts: [p0, p1, p2], widths: [wMax * 0.45, wMax, wMax * 0.6], side, region: REG.cardDeodar, colors: [mulc(c, 0.62 * f), mulc(c, 0.95 * f), mulc(c, 1.06 * f)] });
      }
    }
  }
  // drooping leader
  addTube(vb, { base: V3(0, H - 1.4, 0), dir: V3(0.25, 1, 0), len: 1.7, r0: 0.25, r1: 0.02, radial: 4, segs: 1, region: REG.volDeodar, colorAt: () => col, bend: s => V3(s * s * 0.5, 0, 0) });
  return vb;
}

function buildOak(high) {
  const vb = new VB(); const r = makeRng(4409);
  addTube(vb, { base: V3(0, -0.3, 0), dir: V3(0.05, 1, 0.03), len: 4.8, r0: 0.42, r1: 0.3, radial: high ? 7 : 4, segs: high ? 2 : 1, region: REG.barkOak, colorAt: t => barkColor(t, 0.45), rough: high ? 0.2 : 0, seed: 4 });
  if (high) addTube(vb, { base: V3(0, -0.2, 0), dir: V3(0, 1, 0), len: 0.8, r0: 0.66, r1: 0.42, radial: 7, segs: 1, region: REG.barkOak, colorAt: t => barkColor(t, 0.42, 0.85), rough: 0.3, seed: 8 });
  const crownC = V3(0.1, 8.2, 0.1), crownR = 5.0;
  const blobs = [{ c: V3(0.1, 10.1, 0.1), r: 2.6 }];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r.range(-0.25, 0.25), d = r.range(2.6, 3.4);
    blobs.push({ c: V3(Math.cos(a) * d, r.range(7.0, 8.9), Math.sin(a) * d), r: r.range(2.1, 2.7) });
  }
  const leaf = lin(0xd8e4cc);
  if (high) {
    for (let i = 1; i < blobs.length; i += 2) {
      const b = blobs[i]; const base = V3(0.2, 4.2, 0.1); const to = b.c.clone().sub(base);
      addTube(vb, { base, dir: to, len: to.length() * 0.8, r0: 0.24, r1: 0.08, radial: 5, segs: 2, region: REG.barkOak, colorAt: () => lin(0xffffff, 0.85), bend: s => V3(0, Math.sin(s * Math.PI) * 0.4, 0) });
    }
    for (const b of blobs) addBlob(vb, { center: b.c, radius: b.r, scale: [1, 0.78, 1], detail: 1, region: REG.volBroad, tint: vary(mulc(leaf, 0.85), r), crownC, crownR, seed: r() * 50, disp: 0.26 });
    for (const b of blobs) for (let k = 0; k < 3; k++) {
      const d = randDirUp(r, -0.45); const c = b.c.clone().addScaledVector(d, b.r * 0.9);
      addCard(vb, { center: c, normal: d, w: 2.3, h: 2.3, rot: r() * 6.28, region: REG.cardOak, tint: vary(lin(0xf0f4ec), r), crownC, crownR });
    }
  } else {
    const sub = [blobs[0], blobs[1], blobs[3], blobs[5], blobs[6]];
    for (const b of sub) addBlob(vb, { center: b.c, radius: b.r * 1.32, scale: [1, 0.78, 1], detail: 0, region: REG.volBroad, tint: mulc(leaf, 0.85), crownC, crownR, seed: 5, disp: 0.16 });
  }
  return vb;
}

function buildBush(high) {
  const vb = new VB(); const r = makeRng(5503);
  const crownC = V3(0, 0.55, 0), crownR = 1.0;
  const leaf = lin(0xe4f0d0);
  const blobs = [{ c: V3(0, 0.75, 0), r: 0.62 }];
  for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.28 + r.range(-0.3, 0.3); blobs.push({ c: V3(Math.cos(a) * 0.55, r.range(0.35, 0.6), Math.sin(a) * 0.55), r: r.range(0.42, 0.56) }); }
  if (high) {
    blobs.forEach((b, i) => addBlob(vb, { center: b.c, radius: b.r, scale: [1, 0.85, 1], detail: i < 2 ? 1 : 0, region: REG.volBroad, tint: vary(leaf, r), crownC, crownR, seed: r() * 50, flat: 0.5, aoMin: 0.45 }));
    for (let k = 0; k < 9; k++) {
      const d = randDirUp(r, -0.1); const c = crownC.clone().add(V3(d.x * 0.9, Math.abs(d.y) * 0.45 + 0.1, d.z * 0.9));
      addCard(vb, { center: c, normal: d, w: 0.8, h: 0.8, rot: r() * 6.28, region: REG.cardOak, tint: vary(lin(0xf4f8ee), r), crownC, crownR });
    }
    // lantana flowers (pink / orange clusters)
    for (let k = 0; k < 9; k++) {
      const d = randDirUp(r, 0.0); const c = crownC.clone().add(V3(d.x * 0.85, 0.2 + d.y * 0.5, d.z * 0.85));
      addBlob(vb, { center: c, radius: 0.06, detail: 0, region: REG.white, tint: lin(r() < 0.5 ? 0xe86aa0 : 0xf2a03a), crownC, crownR, disp: 0.1, aoMin: 0.9 });
    }
  } else {
    addBlob(vb, { center: V3(0, 0.6, 0), radius: 0.95, scale: [1.15, 0.75, 1.15], detail: 0, region: REG.volBroad, tint: leaf, crownC, crownR, seed: 2, flat: 0.4 });
    addBlob(vb, { center: V3(0.4, 0.45, 0.3), radius: 0.6, detail: 0, region: REG.volBroad, tint: leaf, crownC, crownR, seed: 6, flat: 0.4 });
  }
  return vb;
}

function buildBamboo(high) {
  const vb = new VB(); const r = makeRng(6607);
  const n = high ? 16 : 6;
  const crownC = V3(0, 7, 0), crownR = 4;
  const culmCol = lin(0xffffff);
  const tips = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r.range(-0.4, 0.4), d = r.range(0.1, 0.6);
    const base = V3(Math.cos(a) * d, -0.2, Math.sin(a) * d);
    const out = V3(Math.cos(a), 0, Math.sin(a));
    const L = r.range(7.5, 10.2);
    const tilt = r.range(0.06, 0.2);
    const dir = V3(out.x * tilt, 1, out.z * tilt).normalize();
    const arch = r.range(0.8, 2.0);
    const bend = t => out.clone().multiplyScalar(t * t * arch).add(V3(0, -t * t * arch * 0.3, 0));
    addTube(vb, { base, dir, len: L, r0: r.range(0.05, 0.07), r1: 0.022, radial: high ? 4 : 3, segs: high ? 3 : 1, region: REG.culmBamboo, colorAt: t => mulc(culmCol, lerp(0.6, 1, smoothstep(0, 0.15, t))), bend, vScale: 2.5 });
    const tip = base.clone().addScaledVector(dir, L).add(bend(1));
    tips.push({ tip, out, mid: base.clone().addScaledVector(dir, L * 0.7).add(bend(0.7)) });
  }
  const leaf = lin(0xf4ffe8);
  if (high) {
    for (const t of tips) {
      for (const pos of [t.tip, t.mid, t.tip.clone().lerp(t.mid, 0.5).add(V3(0, 0.2, 0))]) {
        const nrm = t.out.clone().add(V3(0, 0.3, 0)).normalize();
        addCard(vb, { center: pos.clone().add(V3(0, -0.6, 0)), normal: nrm, w: 1.7, h: 1.9, rot: r.range(-0.4, 0.4), region: REG.cardBamboo, tint: vary(leaf, r), crownC, crownR, nCrown: 0.5, aoMin: 0.6 });
      }
    }
  } else {
    for (const t of tips) for (const pos of [t.tip, t.mid]) {
      const nrm = t.out.clone().add(V3(0, 0.3, 0)).normalize();
      addCard(vb, { center: pos.clone().add(V3(0, -0.8, 0)), normal: nrm, w: 2.6, h: 3.0, rot: r.range(-0.4, 0.4), region: REG.cardBamboo, tint: leaf, crownC, crownR, nCrown: 0.5, aoMin: 0.6 });
    }
  }
  return vb;
}

function buildBanana(high) {
  const vb = new VB(); const r = makeRng(7703);
  const stemH = 2.4;
  addTube(vb, { base: V3(0, -0.1, 0), dir: V3(0, 1, 0), len: stemH, r0: 0.17, r1: 0.12, radial: high ? 6 : 4, segs: high ? 2 : 1, region: REG.culmBanana, colorAt: t => lin(0xffffff, lerp(0.6, 1, t)) });
  const nl = high ? 8 : 6;
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * 6.28 + r.range(-0.3, 0.3);
    const out = V3(Math.cos(a), 0, Math.sin(a));
    const side = V3(-out.z, 0, out.x);
    const L = r.range(1.9, 2.5), rise = r.range(0.55, 1.0);
    const segs = high ? 5 : 1;
    const pts = [], widths = [], colors = [];
    const base = V3(out.x * 0.08, stemH - 0.05, out.z * 0.08);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      // arch: rises then droops
      const p = base.clone().addScaledVector(out, t * L * 0.95).add(V3(0, Math.sin(t * Math.PI * 0.75) * rise * L * 0.6 - t * t * L * 0.35, 0));
      pts.push(p);
      widths.push(high ? lerp(0.12, 0.62, Math.min(1, t * 2.2)) * (1 - Math.max(0, t - 0.85) * 2) : 0.5);
      colors.push(lin(0xffffff, lerp(0.75, 1.05, t)));
    }
    if (!high) { pts.unshift(base.clone()); widths.unshift(0.1); colors.unshift(lin(0xffffff, 0.75)); }
    addRibbon(vb, { pts, widths, side, region: REG.cardBanana, colors, fold: high ? 0.12 : 0 });
  }
  if (high) {
    // two dry hanging leaves
    for (let k = 0; k < 2; k++) {
      const a = k * 3 + 1; const out = V3(Math.cos(a), 0, Math.sin(a)); const side = V3(-out.z, 0, out.x);
      const pts = [V3(out.x * 0.15, 2.2, out.z * 0.15), V3(out.x * 0.35, 1.7, out.z * 0.35), V3(out.x * 0.4, 1.1, out.z * 0.4)];
      addRibbon(vb, { pts, widths: [0.15, 0.3, 0.25], side, region: REG.cardBanana, colors: pts.map(() => lin(0xa07850)) });
    }
  }
  return vb;
}

function buildGrass(high) {
  const vb = new VB(); const r = makeRng(8803);
  const n = high ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + r.range(-0.2, 0.2);
    const side = V3(Math.cos(a), 0, Math.sin(a));
    const tilt = V3(-side.z, 0, side.x).multiplyScalar(r.range(-0.12, 0.12));
    const pts = [V3(0, -0.02, 0), V3(tilt.x * 0.6, 0.62, tilt.z * 0.6)];
    const c0 = lin(0xf0f4e0, 0.45), c1 = lin(0xf4f0d8, 0.8);
    addRibbon(vb, { pts, widths: [0.62, 0.7], side, region: REG.cardGrass, colors: [c0, c1], normalMode: 'up', upBias: 0.65 });
  }
  return vb;
}

function buildFern(high) {
  const vb = new VB(); const r = makeRng(9907);
  const n = high ? 7 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + r.range(-0.25, 0.25);
    const out = V3(Math.cos(a), 0, Math.sin(a)); const side = V3(-out.z, 0, out.x);
    const L = r.range(0.75, 1.0), segs = high ? 3 : 1;
    const pts = [], widths = [], colors = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      pts.push(out.clone().multiplyScalar(t * L * 0.8).add(V3(0, Math.sin(t * Math.PI * 0.7) * L * 0.55 + 0.02, 0)));
      widths.push(0.3); colors.push(lin(0xffffff, lerp(0.55, 0.9, t)));
    }
    addRibbon(vb, { pts, widths, side, region: REG.cardFern, colors, normalMode: 'up', upBias: 0.4 });
  }
  return vb;
}

const BUILDERS = { sal: buildSal, pine: buildPine, deodar: buildDeodar, oak: buildOak, bush: buildBush, bamboo: buildBamboo, banana: buildBanana, grass: buildGrass, fern: buildFern };

/**
 * getTreeTemplate(kind, lod='high') -> { geometry, material, depthMaterial, height, radius, trunkRadius, tris }
 */
export function getTreeTemplate(kind, lod = 'high') {
  if (!KINDS[kind]) { console.warn('[vegetation] unknown kind', kind, '-> sal'); kind = 'sal'; }
  lod = lod === 'low' ? 'low' : 'high';
  const key = kind + '|' + lod;
  if (TEMPLATES.has(key)) return TEMPLATES.get(key);
  const K = KINDS[kind];
  const high = lod === 'high';
  const vb = BUILDERS[kind](high);
  const geometry = vb.geometry();
  geometry.name = 'veg_' + key;
  const useAlpha = high || K.lowAlpha;
  const { material, depthMaterial } = makeVegMaterials(K.H, K.sway, K.flutter, useAlpha);
  material.name = 'vegMat_' + key;
  const tpl = { geometry, material, depthMaterial, height: K.H, radius: K.radius, trunkRadius: K.trunk, tris: vb.tris, kind, lod };
  TEMPLATES.set(key, tpl);
  return tpl;
}

// ============================================================================ rocks
function rockTexture() {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d');
  pixelRegion(ctx, 0, 0, S, S, (x, y) => {
    const u = x / S, v = y / S;
    const n = pfbm2(u * 8, v * 8, 8, 5, 31);
    const s = pfbm2(u * 32, v * 32, 32, 2, 77);
    const crack = smoothstep(0.0, 0.06, Math.abs(pfbm2(u * 5, v * 5, 5, 3, 91) - 0.5));
    const f = (0.72 + n * 0.45 + (s - 0.5) * 0.25) * lerp(0.55, 1, crack);
    return [230 * f, 226 * f, 218 * f];
  });
  // speckles
  const r = makeRng(5);
  for (let i = 0; i < 900; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(40,38,36,0.35)' : 'rgba(255,255,250,0.25)'; ctx.fillRect(r() * S, r() * S, 1.5, 1.5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function rockMaterials() {
  if (ROCK_MATS) return ROCK_MATS;
  const map = rockTexture();
  ROCK_MATS = {
    river: new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.72, metalness: 0 }),
    mountain: new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true }),
  };
  ROCK_MATS.river.name = 'rockRiver'; ROCK_MATS.mountain.name = 'rockMountain';
  return ROCK_MATS;
}

function buildRiverRock(variant) {
  const g = new THREE.SphereGeometry(0.5, 12, 8);
  const P = g.attributes.position; const r = makeRng(300 + variant * 13);
  const sc = [[1, 0.62, 0.85], [1.15, 0.4, 0.95], [1.35, 0.55, 0.7], [1, 0.72, 0.9]][variant];
  const base = [0x8c8a84, 0x8a8174, 0x7f8588, 0x878a80][variant];
  const cols = new Float32Array(P.count * 3); const cBase = new THREE.Color(base);
  const moss = new THREE.Color(0x5a6a3a), wet = new THREE.Color(0x45443f), top = new THREE.Color(0xb3b0a6);
  for (let i = 0; i < P.count; i++) {
    const v = V3(P.getX(i), P.getY(i), P.getZ(i)); const d = v.clone().normalize();
    const n = vnoise3(d.x * 1.6 + variant * 3, d.y * 1.6, d.z * 1.6) - 0.5;
    const n2 = vnoise3(d.x * 4 + variant, d.y * 4, d.z * 4) - 0.5;
    const rr = 0.5 * (1 + n * 0.3 + n2 * 0.08);
    let x = d.x * rr * sc[0], y = d.y * rr * sc[1], z = d.z * rr * sc[2];
    if (y < 0) y *= 0.75; // flatter bottom, sits on river bed
    P.setXYZ(i, x, y + sc[1] * 0.3, z);
    const c = cBase.clone();
    const h = d.y;
    c.lerp(top, smoothstep(0.1, 0.9, h) * 0.45);
    c.lerp(wet, smoothstep(-0.05, -0.7, h) * 0.7);
    if (variant === 3 || r() < 0.0) c.lerp(moss, smoothstep(0.35, 0.95, h + n * 0.6) * 0.75);
    const f = 0.9 + r() * 0.15; cols[i * 3] = c.r * f; cols[i * 3 + 1] = c.g * f; cols[i * 3 + 2] = c.b * f;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  // fix seam normals: average normals of coincident vertices
  const N = g.attributes.normal; const map = new Map();
  for (let i = 0; i < P.count; i++) { const k = `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`; (map.get(k) || map.set(k, []).get(k)).push(i); }
  for (const idx of map.values()) if (idx.length > 1) {
    const s = V3(0, 0, 0); for (const i of idx) s.add(V3(N.getX(i), N.getY(i), N.getZ(i))); s.normalize();
    for (const i of idx) N.setXYZ(i, s.x, s.y, s.z);
  }
  // uv repeat for detail
  const UV = g.attributes.uv; for (let i = 0; i < UV.count; i++) UV.setXY(i, UV.getX(i) * 3, UV.getY(i) * 1.5);
  g.computeBoundingSphere();
  return g;
}

function buildMountainRock(variant) {
  const r = makeRng(500 + variant * 29);
  const parts = variant === 3 ? [[V3(0, 0, 0), 0.5], [V3(0.5, -0.1, 0.25), 0.32]] : [[V3(0, 0, 0), 0.55]];
  const sc = [[1, 0.8, 0.9], [0.7, 1.4, 0.75], [1.4, 0.45, 1.1], [1, 0.75, 0.9]][variant];
  const pos = [], col = [], uv = [];
  const base = new THREE.Color([0x7d746a, 0x857b70, 0x766f68, 0x7a7268][variant]);
  const dark = new THREE.Color(0x4a443e), lich = new THREE.Color(0x9a9c80);
  for (const [off, rad] of parts) {
    const g = new THREE.IcosahedronGeometry(rad, 1); const P = g.attributes.position;
    const disp = new Map();
    for (let i = 0; i < P.count; i++) {
      const k = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
      let p = disp.get(k);
      if (!p) {
        const d = V3(P.getX(i), P.getY(i), P.getZ(i)).normalize();
        const n = vnoise3(d.x * 2.1 + variant * 5, d.y * 2.1, d.z * 2.1) - 0.5;
        const rr = rad * (1 + n * 0.55 + (r() - 0.5) * 0.12);
        // flatten into facets / ledges
        let y = d.y * rr * sc[1]; if (y < -0.1) y = -0.1 - (y + 0.1) * 0.35;
        p = V3(d.x * rr * sc[0], y, d.z * rr * sc[2]).add(off);
        disp.set(k, p);
      }
      pos.push(p.x, p.y + 0.12, p.z);
      const c = base.clone();
      const h = clamp((p.y + 0.3) / 1.0, 0, 1);
      c.lerp(dark, (1 - h) * 0.45);
      if (r() < 0.25) c.lerp(lich, 0.35 * h);
      const f = 0.88 + r() * 0.2; col.push(c.r * f, c.g * f, c.b * f);
    }
    g.dispose();
  }
  // triplanar-ish uv per triangle
  for (let i = 0; i < pos.length; i += 9) {
    const a = V3(pos[i], pos[i + 1], pos[i + 2]), b = V3(pos[i + 3], pos[i + 4], pos[i + 5]), c = V3(pos[i + 6], pos[i + 7], pos[i + 8]);
    const fn = b.clone().sub(a).cross(c.clone().sub(a)); const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    for (const p of [a, b, c]) {
      if (ax >= ay && ax >= az) uv.push(p.z * 1.8, p.y * 1.8); else if (ay >= az) uv.push(p.x * 1.8, p.z * 1.8); else uv.push(p.x * 1.8, p.y * 1.8);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** getRockTemplate(variant 0..3, kind 'river'|'mountain') -> { geometry, material, size } (≈1 m, origin at ground) */
export function getRockTemplate(variant = 0, kind = 'river') {
  variant = ((variant | 0) % 4 + 4) % 4; kind = kind === 'mountain' ? 'mountain' : 'river';
  const key = kind + variant;
  if (ROCKS.has(key)) return ROCKS.get(key);
  const mats = rockMaterials();
  const geometry = kind === 'river' ? buildRiverRock(variant) : buildMountainRock(variant);
  geometry.name = 'rock_' + key;
  const tpl = { geometry, material: mats[kind], size: 1, kind, variant };
  ROCKS.set(key, tpl);
  return tpl;
}

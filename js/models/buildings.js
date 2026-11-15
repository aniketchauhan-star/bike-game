// Buildings for UTTARAKHAND RIDERS — Ramnagar town, Kumaoni villages, Ranikhet cantonment, temples.
// ------------------------------------------------------------------------------------------------
// Every factory returns { group, update(dt, time), size: {w, d, h} }.  Facade faces +Z, origin = centre of base footprint.
// All buildings share a handful of module-level materials (plaster / stone / slate / tin / brick / rock + one detail atlas),
// so a building is 2–5 draw calls (+1 for a unique shop/bus-stand sign, +1 for animated temple flags).
import * as THREE from 'three';
import { makeRng, clamp, lerp, smoothstep, roundRect } from '../core/util.js';

const DEVA = '"Noto Sans Devanagari","Kohinoor Devanagari","Devanagari Sangam MN","Mangal",sans-serif';
const LATIN = '"Rajdhani","Teko","Arial Narrow","Helvetica Neue",Arial,sans-serif';

// ============================================================================ small noise helpers (tileable)
function ihash(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
function pnoise2(x, y, P, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = k => ((k % P) + P) % P; const h = (a, b) => ihash(m(a), m(b), seed);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}
function pfbm2(x, y, P, oct, seed) { let s = 0, a = 1, n = 0, f = 1; for (let i = 0; i < oct; i++) { s += a * pnoise2(x * f, y * f, P * f, seed + i * 17); n += a; a *= 0.5; f *= 2; } return s / n; }
function pixels(ctx, x0, y0, w, h, fn) {
  const img = ctx.getImageData(x0, y0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y), i = (y * w + x) * 4; d[i] = clamp(c[0], 0, 255); d[i + 1] = clamp(c[1], 0, 255); d[i + 2] = clamp(c[2], 0, 255); d[i + 3] = 255; }
  ctx.putImageData(img, x0, y0);
}
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.needsUpdate = true; return t;
}

// ============================================================================ tiling textures
function plasterCanvas() {
  const S = 512, c = mkCanvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  pixels(x, 0, 0, S, S, (i, j) => {
    const u = i / S, v = j / S;
    const n = pfbm2(u * 6, v * 6, 6, 4, 3), b = pfbm2(u * 2, v * 2, 2, 3, 9);
    const streak = Math.pow(pnoise2(u * 14, v * 1.2, 14, 21), 5) * smoothstep(0.3, 0.8, pnoise2(u * 3, v * 2, 3, 5)) * 0.32;
    const blot = smoothstep(0.62, 0.85, pfbm2(u * 4, v * 4, 4, 3, 33)) * 0.12;
    const f = 0.86 + (n - 0.5) * 0.16 + (b - 0.5) * 0.14 - streak - blot;
    return [222 * f, 216 * f, 206 * f];
  });
  const r = makeRng(7);
  for (let k = 0; k < 14; k++) { // hairline cracks
    let px = r() * S, py = r() * S; x.strokeStyle = 'rgba(70,60,50,0.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 8; s++) { px += r.range(-12, 12); py += r.range(4, 14); x.lineTo(px, py); } x.stroke();
  }
  for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(60,50,40,${r.range(0.05, 0.2)})`; x.fillRect(r() * S, r() * S, r.range(1, 3), r.range(1, 3)); }
  return c;
}
function stoneCanvas() {
  // Kumaoni dry-stone masonry: courses of flat stones, dark mortar gaps
  const S = 512, c = mkCanvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#4e463e'; x.fillRect(0, 0, S, S);
  const r = makeRng(11);
  let y = 0; const rows = [];
  while (y < S) { let h = Math.round(r.range(18, 34)); if (S - (y + h) < 18) h = S - y; rows.push([y, h]); y += h; }
  for (const [ry, rh] of rows) {
    let xs = r.range(0, 60); const start = xs;
    while (xs < start + S) {
      const L = r.range(36, 96); const w = Math.min(L, start + S - xs);
      const col = [r.range(118, 162), 0, 0]; col[1] = col[0] * r.range(0.9, 0.97); col[2] = col[0] * r.range(0.8, 0.9);
      const warm = r() < 0.25 ? 1.08 : 1;
      for (const off of [0, -S]) {
        const X = xs + off; if (X > S || X + w < 0) continue;
        x.fillStyle = `rgb(${col[0] * warm | 0},${col[1] | 0},${col[2] / warm | 0})`;
        roundRect(x, X + 1.5, ry + 1.5, w - 3, rh - 3, 4); x.fill();
        x.fillStyle = 'rgba(255,250,240,0.12)'; x.fillRect(X + 2, ry + 2, w - 4, 3);
        x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(X + 2, ry + rh - 5, w - 4, 3);
      }
      xs += L;
    }
  }
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = (j * S + i) * 4, f = 0.86 + pfbm2(i / S * 16, j / S * 16, 16, 3, 5) * 0.28; d[k] *= f; d[k + 1] *= f; d[k + 2] *= f; }
  x.putImageData(img, 0, 0);
  return c;
}
function slateCanvas() {
  const S = 512, c = mkCanvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#3c3d3c'; x.fillRect(0, 0, S, S);
  const r = makeRng(17); const rowH = 32;
  for (let ry = 0; ry < S; ry += rowH) {
    let xs = (ry / rowH) % 2 ? -r.range(20, 40) : 0;
    while (xs < S) {
      const w = r.range(44, 80), g = r.range(78, 118);
      for (const off of [0, S, -S]) {
        const X = xs + off; if (X > S || X + w < 0) continue;
        x.fillStyle = `rgb(${g * 0.97 | 0},${g | 0},${g * 1.02 | 0})`;
        x.beginPath(); x.moveTo(X + 1, ry); x.lineTo(X + w - 1, ry); x.lineTo(X + w - 1 - r.range(0, 4), ry + rowH + 6); x.lineTo(X + 2 + r.range(0, 4), ry + rowH + 6); x.closePath(); x.fill();
        x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(X + 1, ry + rowH + 3, w - 2, 3);
        if (r() < 0.3) { x.fillStyle = r() < 0.5 ? 'rgba(170,170,110,0.35)' : 'rgba(220,220,200,0.3)'; x.beginPath(); x.arc(X + r() * w, ry + r() * rowH, r.range(2, 6), 0, 6.28); x.fill(); }
      }
      xs += w;
    }
  }
  return c;
}
function tinCanvas() {
  const S = 256, c = mkCanvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  const ribs = 16;
  pixels(x, 0, 0, S, S, (i, j) => {
    const s = Math.sin((i / S) * Math.PI * 2 * ribs);
    const f = 0.78 + 0.2 * s + (pfbm2(i / S * 4, j / S * 4, 4, 3, 2) - 0.5) * 0.12;
    const rust = smoothstep(0.62, 0.8, pfbm2(i / S * 8, j / S * 3, 8, 3, 13));
    return [lerp(240 * f, 150, rust), lerp(240 * f, 95, rust), lerp(236 * f, 60, rust)];
  });
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, 0, S, 3);
  return c;
}
function brickCanvas() {
  const S = 512, c = mkCanvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#bdb6aa'; x.fillRect(0, 0, S, S);
  const r = makeRng(23), rows = 20, rh = S / rows, per = 7, bw = S / per;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * bw / 2;
    for (let i = -1; i <= per; i++) {
      const X = i * bw + off, R = r.range(150, 182), G = R * r.range(0.44, 0.52), B = R * r.range(0.3, 0.37);
      x.fillStyle = `rgb(${R | 0},${G | 0},${B | 0})`; x.fillRect(X + 1.5, j * rh + 1.5, bw - 3, rh - 3);
      x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(X + 1.5, j * rh + rh - 4, bw - 3, 2.5);
    }
  }
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = (j * S + i) * 4, f = 0.85 + pfbm2(i / S * 20, j / S * 20, 20, 2, 8) * 0.3; d[k] *= f; d[k + 1] *= f; d[k + 2] *= f; }
  x.putImageData(img, 0, 0);
  return c;
}
function rockCanvas() {
  const S = 256, c = mkCanvas(S, S), x = c.getContext('2d', { willReadFrequently: true });
  pixels(x, 0, 0, S, S, (i, j) => {
    const u = i / S, v = j / S; const n = pfbm2(u * 6, v * 6, 6, 5, 41);
    const strata = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 9 + n * 6);
    const pebble = smoothstep(0.7, 0.75, pnoise2(u * 30, v * 30, 30, 4));
    const f = 0.7 + n * 0.4 + strata * 0.08 - pebble * 0.15;
    return [222 * f, 212 * f, 196 * f];
  });
  return c;
}

// ============================================================================ detail atlas
const AT = 1024;
function R(x, y, w, h, pad = 2) { return { u0: (x + pad) / AT, u1: (x + w - pad) / AT, v0: 1 - (y + h - pad) / AT, v1: 1 - (y + pad) / AT, px: [x, y, w, h] }; }
const REG = {
  winGrill: R(0, 0, 128, 128), winKumaoni: R(128, 0, 128, 128), winColonial: R(256, 0, 128, 128), winStained: R(384, 0, 128, 128),
  tank: R(512, 0, 128, 128), posters: R(640, 0, 128, 128), ac: R(768, 0, 128, 128), white: R(896, 0, 128, 128, 16),
  doorWood: R(0, 128, 128, 256), doorKumaoni: R(128, 128, 128, 256), doorMetal: R(256, 128, 128, 256), doorColonial: R(384, 128, 128, 256),
  shutter: R(512, 128, 256, 256), shelves: R(768, 128, 256, 256),
  medShelves: R(0, 384, 256, 256), sweets: R(256, 384, 256, 256), packets: R(512, 384, 128, 256), clothes: R(640, 384, 128, 256), dhabaInt: R(768, 384, 256, 256),
  ticket: R(0, 640, 128, 128), timetable: R(128, 640, 128, 128), carving: R(256, 640, 256, 128), aipan: R(512, 640, 256, 128), grill: R(768, 640, 128, 128), mobileAds: R(896, 640, 128, 128),
  bench: R(0, 768, 128, 128), wood: R(128, 768, 128, 128), cross: R(256, 768, 128, 128), templeDoor: R(384, 768, 128, 128), belfry: R(512, 768, 128, 128), dark: R(640, 768, 128, 128, 16),
};
for (let i = 0; i < 8; i++) REG['sign' + i] = R((i % 4) * 256, 896 + Math.floor(i / 4) * 64, 256, 64, 2);
const GENERIC_SIGNS = [
  ['किराना स्टोर', 'KIRANA STORE', '#f2c230', '#b3121b'], ['जनरल स्टोर', 'GENERAL STORE', '#1d4f9a', '#ffffff'],
  ['मोबाइल शॉप', 'MOBILE SHOP', '#d81e3c', '#ffffff'], ['टेलर्स', 'TAILORS', '#5a2a82', '#ffe14d'],
  ['मेडिकल स्टोर', 'MEDICAL STORE', '#118a4a', '#ffffff'], ['मिष्ठान भंडार', 'SWEETS', '#e8641a', '#fff6c8'],
  ['भोजनालय', 'HOTEL', '#7a1420', '#ffd84a'], ['हार्डवेयर', 'HARDWARE', '#20304a', '#9fe0ff'],
];

function fitFont(ctx, text, maxW, px, family, weight = 'bold') {
  let s = px; do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 8); return s + 2;
}

function paintAtlas() {
  const c = mkCanvas(AT, AT), x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#808080'; x.fillRect(0, 0, AT, AT);
  const r = makeRng(99);
  const at = (reg, fn) => { const [X, Y, W, H] = reg.px; x.save(); x.beginPath(); x.rect(X, Y, W, H); x.clip(); x.translate(X, Y); fn(W, H); x.restore(); };
  const glass = (X, Y, W, H) => { const g = x.createLinearGradient(X, Y, X + W, Y + H); g.addColorStop(0, '#5d7286'); g.addColorStop(0.45, '#1f2a36'); g.addColorStop(1, '#0e141b'); x.fillStyle = g; x.fillRect(X, Y, W, H); x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.moveTo(X, Y + H * 0.6); x.lineTo(X + W * 0.5, Y); x.lineTo(X + W * 0.7, Y); x.lineTo(X, Y + H * 0.95); x.fill(); };

  at(REG.winGrill, (W, H) => {
    x.fillStyle = '#efefef'; x.fillRect(0, 0, W, H);
    glass(10, 10, W / 2 - 13, H - 26); glass(W / 2 + 3, 10, W / 2 - 13, H - 26);
    x.fillStyle = '#efefef'; x.fillRect(8, H / 2 - 6, W - 16, 5);
    x.strokeStyle = '#2b3a33'; x.lineWidth = 3; for (let i = 1; i < 7; i++) { x.beginPath(); x.moveTo(i * W / 7, 6); x.lineTo(i * W / 7, H - 14); x.stroke(); }
    x.lineWidth = 2.5; x.beginPath(); x.moveTo(6, H * 0.33); x.lineTo(W - 6, H * 0.33); x.moveTo(6, H * 0.66); x.lineTo(W - 6, H * 0.66); x.stroke();
    x.beginPath(); x.arc(W / 2, H / 2, 14, 0, 6.28); x.stroke();
    x.fillStyle = '#d4d0c8'; x.fillRect(0, H - 14, W, 14); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, H - 14, W, 3);
  });
  at(REG.winKumaoni, (W, H) => {
    x.fillStyle = '#4a2f1c'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) { x.strokeStyle = i % 2 ? '#6b4428' : '#2e1c10'; x.lineWidth = 4; x.strokeRect(6 + i * 7, 6 + i * 7, W - 12 - i * 14, H - 12 - i * 14); }
    x.fillStyle = '#120b07'; x.fillRect(30, 30, W - 60, H - 60);
    x.fillStyle = '#5a3a22'; x.fillRect(30, 30, (W - 60) * 0.42, H - 60); x.fillRect(W - 30 - (W - 60) * 0.3, 30, (W - 60) * 0.3, H - 60);
    x.strokeStyle = '#3a2414'; x.lineWidth = 2; for (let k = 0; k < 4; k++) { x.strokeRect(34, 36 + k * 16, (W - 60) * 0.42 - 8, 11); }
    x.fillStyle = '#7a5434'; for (let k = 0; k < 16; k++) { x.beginPath(); x.arc(10 + (k % 8) * 15, k < 8 ? 9 : H - 9, 3, 0, 6.28); x.fill(); }
  });
  at(REG.winColonial, (W, H) => {
    x.fillStyle = '#f2f0ea'; x.fillRect(0, 0, W, H);
    glass(14, 12, W - 28, H - 30);
    x.fillStyle = '#f2f0ea'; for (let i = 1; i < 3; i++) x.fillRect(14 + i * (W - 28) / 3 - 2, 12, 4, H - 30);
    for (let j = 1; j < 4; j++) x.fillRect(14, 12 + j * (H - 30) / 4 - 2, W - 28, 4);
    x.fillRect(14, 12 + (H - 30) / 2 - 3, W - 28, 6);
    x.fillStyle = '#cfcac0'; x.fillRect(0, H - 16, W, 16);
  });
  at(REG.winStained, (W, H) => {
    x.fillStyle = '#8a857c'; x.fillRect(0, 0, W, H);
    x.save(); x.beginPath(); x.moveTo(20, H - 8); x.lineTo(20, 46); x.quadraticCurveTo(20, 8, W / 2, 6); x.quadraticCurveTo(W - 20, 8, W - 20, 46); x.lineTo(W - 20, H - 8); x.closePath();
    x.fillStyle = '#2a2018'; x.fill(); x.clip();
    const cols = ['#b3222a', '#1f4fa0', '#e0b020', '#2a8a4a', '#7a2a8a', '#d06a20'];
    for (let j = 0; j < 12; j++) for (let i = 0; i < 6; i++) { x.fillStyle = cols[(i * 3 + j * 5 + (r() * 3 | 0)) % cols.length]; x.globalAlpha = 0.85; x.fillRect(22 + i * 14 + 1, 8 + j * 10 + 1, 12, 8); }
    x.globalAlpha = 1; x.strokeStyle = '#1a140e'; x.lineWidth = 2; x.beginPath(); x.moveTo(W / 2, 6); x.lineTo(W / 2, H); x.stroke();
    x.restore(); x.strokeStyle = '#6a655c'; x.lineWidth = 5; x.beginPath(); x.moveTo(20, H - 8); x.lineTo(20, 46); x.quadraticCurveTo(20, 8, W / 2, 6); x.quadraticCurveTo(W - 20, 8, W - 20, 46); x.lineTo(W - 20, H - 8); x.stroke();
  });
  at(REG.tank, (W, H) => {
    for (let j = 0; j < H; j++) { const s = 0.5 + 0.5 * Math.sin(j / H * Math.PI * 2 * 7); const g = 18 + s * 22; x.fillStyle = `rgb(${g},${g},${g + 2})`; x.fillRect(0, j, W, 1); }
    x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(0, 0, W * 0.3, H);
  });
  at(REG.posters, (W, H) => {
    x.fillStyle = '#9a9286'; x.fillRect(0, 0, W, H);
    const P = [['#e8312a', '#ffd400', 'मेला', 'MELA'], ['#1b6fd6', '#ffffff', 'कोचिंग', 'TUITION'], ['#11883c', '#fff', 'योग', 'YOGA'], ['#f07c12', '#3a1000', 'सर्कस', 'CIRCUS']];
    P.forEach((p, k) => {
      const X = 4 + (k % 2) * 62, Y = 4 + Math.floor(k / 2) * 62; x.fillStyle = p[0]; x.fillRect(X, Y, 58, 58);
      x.fillStyle = p[1]; x.font = `bold 18px ${DEVA}`; x.textAlign = 'center'; x.fillText(p[2], X + 29, Y + 26);
      x.font = `bold 11px ${LATIN}`; x.fillText(p[3], X + 29, Y + 44);
    });
  });
  at(REG.ac, (W, H) => {
    x.fillStyle = '#d9dad6'; x.fillRect(0, 0, W, H); x.fillStyle = '#5c5f60'; x.beginPath(); x.arc(46, H / 2, 36, 0, 6.28); x.fill();
    x.strokeStyle = '#bfc2c0'; x.lineWidth = 2; for (let k = 1; k < 6; k++) { x.beginPath(); x.arc(46, H / 2, k * 6.5, 0, 6.28); x.stroke(); }
    x.fillStyle = '#9ea19f'; for (let k = 0; k < 8; k++) x.fillRect(92, 20 + k * 11, 28, 4);
  });
  at(REG.white, (W, H) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); });
  at(REG.dark, (W, H) => { x.fillStyle = '#141210'; x.fillRect(0, 0, W, H); });

  const panelDoor = (W, H, base, line, panels = 3) => {
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    x.strokeStyle = line; x.lineWidth = 6; x.strokeRect(5, 5, W - 10, H - 10);
    x.lineWidth = 3; for (let k = 0; k < panels; k++) { x.strokeRect(18, 18 + k * (H - 36) / panels, W / 2 - 24, (H - 36) / panels - 10); x.strokeRect(W / 2 + 6, 18 + k * (H - 36) / panels, W / 2 - 24, (H - 36) / panels - 10); }
    x.fillStyle = '#c8a040'; x.beginPath(); x.arc(W / 2 - 8, H * 0.52, 4, 0, 6.28); x.fill(); x.beginPath(); x.arc(W / 2 + 8, H * 0.52, 4, 0, 6.28); x.fill();
  };
  at(REG.doorWood, (W, H) => panelDoor(W, H, '#6b4326', '#3d2514', 3));
  at(REG.doorKumaoni, (W, H) => {
    x.fillStyle = '#3e2716'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) { x.strokeStyle = i % 2 ? '#7a5232' : '#24160c'; x.lineWidth = 5; x.strokeRect(4 + i * 7, 4 + i * 7, W - 8 - i * 14, H - 8 - i * 14); }
    x.fillStyle = '#5a3a20'; x.fillRect(32, 34, W - 64, H - 44);
    x.strokeStyle = '#2a1a0e'; x.lineWidth = 3; x.beginPath(); x.moveTo(W / 2, 34); x.lineTo(W / 2, H - 10); x.stroke();
    for (let k = 0; k < 5; k++) { x.strokeRect(38, 42 + k * 40, W / 2 - 44, 30); x.strokeRect(W / 2 + 6, 42 + k * 40, W / 2 - 44, 30); }
    x.fillStyle = '#8a6440'; for (let k = 0; k < 9; k++) { x.beginPath(); x.arc(14 + k * 12.5, 18, 4, 0, 6.28); x.fill(); }
    x.fillStyle = '#c03018'; x.fillRect(W / 2 - 10, 20, 20, 10);
  });
  at(REG.doorMetal, (W, H) => {
    x.fillStyle = '#5b7f74'; x.fillRect(0, 0, W, H);
    for (let k = 0; k < 18; k++) { x.fillStyle = k % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'; x.fillRect(8, 10 + k * 13, W - 16, 13); }
    x.strokeStyle = '#2f453f'; x.lineWidth = 6; x.strokeRect(4, 4, W - 8, H - 8); x.fillStyle = '#222'; x.fillRect(W - 30, H * 0.5, 10, 18);
  });
  at(REG.doorColonial, (W, H) => {
    panelDoor(W, H, '#e9e6dd', '#b9b4a8', 3);
    x.fillStyle = '#e9e6dd'; x.fillRect(0, 0, W, 50); glass(12, 6, W - 24, 38);
    x.fillStyle = '#e9e6dd'; for (let k = 1; k < 5; k++) x.fillRect(12 + k * (W - 24) / 5 - 1.5, 6, 3, 38);
  });
  at(REG.shutter, (W, H) => {
    for (let j = 0; j < H; j++) { const s = Math.sin(j / 6 * Math.PI); const g = 120 + s * 26; x.fillStyle = `rgb(${g * 0.92 | 0},${g * 0.98 | 0},${g | 0})`; x.fillRect(0, j, W, 1); }
    const gr = x.createLinearGradient(0, H * 0.6, 0, H); gr.addColorStop(0, 'rgba(60,40,20,0)'); gr.addColorStop(1, 'rgba(60,40,20,0.45)'); x.fillStyle = gr; x.fillRect(0, 0, W, H);
    x.fillStyle = '#4a4e52'; x.fillRect(0, H - 14, W, 14); x.fillStyle = '#222'; x.fillRect(W / 2 - 14, H - 26, 28, 12);
    x.fillStyle = 'rgba(180,30,30,0.85)'; x.font = `bold 22px ${DEVA}`; x.textAlign = 'center'; x.fillText('किराना • स्टेशनरी', W / 2, H * 0.4);
  });
  const shelvesBase = (W, H, light, palette, small) => {
    x.fillStyle = light ? '#e8ece8' : '#2a2018'; x.fillRect(0, 0, W, H);
    const rows = 5, rh = H / rows;
    for (let j = 0; j < rows; j++) {
      x.fillStyle = light ? '#c9cfcc' : '#5a3e26'; x.fillRect(0, j * rh + rh - 7, W, 7);
      let X = 3; while (X < W - 4) {
        const w = small ? r.range(6, 14) : r.range(8, 26), h = rh * r.range(0.45, 0.85);
        x.fillStyle = r.pick(palette); x.fillRect(X, j * rh + rh - 7 - h, w - 1.5, h);
        x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(X, j * rh + rh - 7 - h, (w - 1.5) * 0.3, h);
        X += w;
      }
    }
    const g = x.createLinearGradient(0, 0, 0, 30); g.addColorStop(0, 'rgba(255,255,240,0.5)'); g.addColorStop(1, 'rgba(255,255,240,0)'); x.fillStyle = g; x.fillRect(0, 0, W, 30);
  };
  at(REG.shelves, (W, H) => shelvesBase(W, H, false, ['#e2231a', '#ffd200', '#1e63c6', '#16a34a', '#ff7a00', '#f5f5f5', '#8b1fa8', '#00a3c4', '#c8102e'], false));
  at(REG.medShelves, (W, H) => shelvesBase(W, H, true, ['#ffffff', '#d8f0f0', '#2aa3a3', '#e6e6f2', '#f2e4e4', '#3a7bd5', '#fafafa', '#9fd8c8'], true));
  at(REG.sweets, (W, H) => {
    x.fillStyle = '#3a2a1e'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#cfd6d8'; x.fillRect(0, H * 0.58, W, H * 0.42);
    const sweets = [['#f39c12', 'jalebi'], ['#f6c945', 'laddoo'], ['#fbf7ec', 'rasgulla'], ['#5a2414', 'jamun'], ['#f2e3b3', 'barfi'], ['#e86aa0', 'peda']];
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
      const X = 8 + i * 61, Y = 14 + row * 64, s = sweets[(i + row * 4) % sweets.length];
      x.fillStyle = '#b8bcbc'; x.beginPath(); x.ellipse(X + 26, Y + 30, 28, 14, 0, 0, 6.28); x.fill();
      x.fillStyle = s[0]; for (let k = 0; k < 9; k++) { x.beginPath(); x.arc(X + 10 + (k % 3) * 16 + r.range(-2, 2), Y + 22 + Math.floor(k / 3) * 8, 6, 0, 6.28); x.fill(); }
    }
    x.fillStyle = 'rgba(255,255,255,0.22)'; x.beginPath(); x.moveTo(0, H * 0.55); x.lineTo(W * 0.4, 0); x.lineTo(W * 0.55, 0); x.lineTo(W * 0.1, H * 0.55); x.fill();
    x.fillStyle = '#9aa4a8'; for (let k = 0; k < 6; k++) x.fillRect(0, H * 0.62 + k * 16, W, 2);
  });
  at(REG.packets, (W, H) => {
    x.fillStyle = '#2a2018'; x.fillRect(0, 0, W, H);
    const cols = ['#e2231a', '#ffd200', '#1e63c6', '#16a34a', '#ff7a00', '#8b1fa8', '#00a3c4'];
    for (let col = 0; col < 3; col++) { x.fillStyle = '#ccc'; x.fillRect(col * 43 + 20, 0, 2, H); for (let k = 0; k < 9; k++) { const X = col * 43 + 4, Y = 4 + k * 28; x.fillStyle = cols[(col * 3 + k) % cols.length]; roundRect(x, X, Y, 34, 26, 4); x.fill(); x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(X + 4, Y + 4, 8, 18); x.fillStyle = 'rgba(255,255,255,0.8)'; x.beginPath(); x.arc(X + 22, Y + 13, 6, 0, 6.28); x.fill(); } }
  });
  at(REG.clothes, (W, H) => {
    x.fillStyle = '#2a2420'; x.fillRect(0, 0, W, H); x.fillStyle = '#999'; x.fillRect(0, 10, W, 3);
    const cols = ['#c8102e', '#f2a900', '#1f4fa0', '#e86aa0', '#0f8a6a', '#7a2a8a', '#f5f5f5', '#ff6a13'];
    for (let k = 0; k < 6; k++) { const X = 4 + k * 20; x.fillStyle = cols[k % cols.length]; x.beginPath(); x.moveTo(X + 4, 14); x.lineTo(X + 16, 14); x.lineTo(X + 20, 26); x.lineTo(X + 18, 150 + r() * 80); x.lineTo(X + 2, 150 + r() * 80); x.lineTo(X, 26); x.closePath(); x.fill(); x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(X + 9, 16, 2, 130); }
  });
  at(REG.dhabaInt, (W, H) => {
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2e2a26'); g.addColorStop(1, '#5a5048'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#6b4a2e'; x.fillRect(0, 70, W, 8); x.fillRect(0, 130, W, 8);
    for (let k = 0; k < 10; k++) { x.fillStyle = '#b8bcc0'; x.beginPath(); x.arc(14 + k * 24, 56, 10, 0, 6.28); x.fill(); x.fillStyle = '#8a8e92'; x.beginPath(); x.arc(14 + k * 24, 56, 5, 0, 6.28); x.fill(); }
    for (let k = 0; k < 7; k++) { x.fillStyle = 'rgba(220,235,240,0.6)'; x.fillRect(10 + k * 34, 92, 22, 36); x.fillStyle = ['#e8b04a', '#c8641a', '#f2d27a', '#d84a2a'][k % 4]; x.fillRect(12 + k * 34, 104, 18, 22); }
    x.fillStyle = '#ffffff'; x.fillRect(170, 8, 60, 40); x.fillStyle = '#e8641a'; x.fillRect(174, 12, 52, 26); x.fillStyle = '#ffd84a'; x.beginPath(); x.arc(200, 25, 10, 0, 6.28); x.fill();
    x.fillStyle = '#9a9ea2'; x.fillRect(30, 170, 110, 20); x.fillStyle = '#c0c4c8'; x.beginPath(); x.ellipse(70, 160, 30, 22, 0, 0, 6.28); x.fill(); x.fillStyle = '#d8dcde'; x.fillRect(60, 132, 20, 10);
    x.fillStyle = '#2a6ad8'; x.beginPath(); x.arc(70, 194, 5, 0, 6.28); x.fill();
    x.fillStyle = '#c8b090'; x.fillRect(150, 160, 90, 40); x.fillStyle = 'rgba(255,255,255,0.6)'; for (let k = 0; k < 6; k++) x.fillRect(156 + k * 14, 150, 8, 12);
  });
  at(REG.ticket, (W, H) => {
    x.fillStyle = '#e9e1cf'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#1d4f9a'; x.fillRect(8, 6, W - 16, 26); x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = `bold 13px ${DEVA}`; x.fillText('टिकट घर', W / 2, 18); x.font = `bold 9px ${LATIN}`; x.fillText('TICKET', W / 2, 29);
    x.fillStyle = '#16120e'; x.fillRect(24, 44, W - 48, 52); x.strokeStyle = '#999'; x.lineWidth = 2; for (let k = 1; k < 6; k++) { x.beginPath(); x.moveTo(24 + k * (W - 48) / 6, 44); x.lineTo(24 + k * (W - 48) / 6, 96); x.stroke(); }
    x.fillStyle = '#b9b2a4'; x.fillRect(16, 96, W - 32, 10);
  });
  at(REG.timetable, (W, H) => {
    x.fillStyle = '#123a6a'; x.fillRect(0, 0, W, H); x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(3, 3, W - 6, H - 6);
    x.fillStyle = '#ffd84a'; x.textAlign = 'left'; x.font = `bold 10px ${LATIN}`;
    [['RANIKHET', '06:30'], ['NAINITAL', '07:15'], ['ALMORA', '08:00'], ['HALDWANI', '09:20'], ['KASHIPUR', '10:45'], ['DELHI', '21:00']].forEach((l, k) => { x.fillText(l[0], 10, 22 + k * 17); x.fillText(l[1], 82, 22 + k * 17); });
  });
  at(REG.carving, (W, H) => {
    x.fillStyle = '#4a2e1a'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#2a190d'; x.fillRect(0, 0, W, 10); x.fillRect(0, H - 10, W, 10);
    for (let k = 0; k < 16; k++) {
      const X = 8 + k * 16; x.fillStyle = '#6e4a2c'; x.beginPath(); x.moveTo(X + 8, 20); x.lineTo(X + 15, H / 2); x.lineTo(X + 8, H - 20); x.lineTo(X + 1, H / 2); x.closePath(); x.fill();
      x.fillStyle = '#2a190d'; x.beginPath(); x.arc(X + 8, H / 2, 3, 0, 6.28); x.fill();
    }
    x.strokeStyle = '#7a5434'; x.lineWidth = 2; x.beginPath(); for (let X = 0; X < W; X += 8) { x.lineTo(X, 14 + (X / 8 % 2) * 3); } x.stroke();
  });
  at(REG.aipan, (W, H) => {
    x.fillStyle = '#9a3520'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#f6f0e4'; x.fillStyle = '#f6f0e4'; x.lineWidth = 2.5;
    x.strokeRect(6, 6, W - 12, H - 12); x.strokeRect(12, 12, W - 24, H - 24);
    for (let k = 0; k < 4; k++) {
      const cx = 32 + k * 64, cy = H / 2;
      for (let p = 0; p < 8; p++) { const a = p / 8 * 6.28; x.beginPath(); x.ellipse(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 8, 3.5, a, 0, 6.28); x.stroke(); }
      x.beginPath(); x.arc(cx, cy, 5, 0, 6.28); x.fill();
      for (let p = 0; p < 12; p++) { const a = p / 12 * 6.28; x.beginPath(); x.arc(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26, 1.8, 0, 6.28); x.fill(); }
    }
    for (let X = 16; X < W - 10; X += 7) { x.beginPath(); x.arc(X, 18, 1.5, 0, 6.28); x.arc(X, H - 18, 1.5, 0, 6.28); x.fill(); }
  });
  at(REG.grill, (W, H) => {
    x.fillStyle = '#3a3632'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#141414'; x.lineWidth = 3;
    for (let k = 0; k <= 8; k++) { x.beginPath(); x.moveTo(k * W / 8, 0); x.lineTo(k * W / 8, H); x.stroke(); }
    x.beginPath(); x.moveTo(0, 6); x.lineTo(W, 6); x.moveTo(0, H - 6); x.lineTo(W, H - 6); x.stroke();
    for (let k = 0; k < 4; k++) { x.beginPath(); x.arc(16 + k * 32, H / 2, 12, 0, 6.28); x.stroke(); }
  });
  at(REG.mobileAds, (W, H) => {
    x.fillStyle = '#1b62d4'; x.fillRect(0, 0, W, H / 2); x.fillStyle = '#e31b23'; x.fillRect(0, H / 2, W, H / 2);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = `bold 15px ${LATIN}`; x.fillText('RECHARGE', W / 2, 28); x.font = `bold 13px ${DEVA}`; x.fillText('रिचार्ज यहाँ', W / 2, 48);
    x.fillStyle = '#111'; roundRect(x, W / 2 - 14, H / 2 + 8, 28, 50, 5); x.fill(); x.fillStyle = '#5ab4ff'; x.fillRect(W / 2 - 11, H / 2 + 13, 22, 38);
  });
  at(REG.bench, (W, H) => { for (let k = 0; k < 6; k++) { const g = 120 + r() * 30; x.fillStyle = `rgb(${g},${g * 0.7 | 0},${g * 0.45 | 0})`; x.fillRect(0, k * H / 6, W, H / 6 - 2); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, k * H / 6 + H / 6 - 3, W, 2); } });
  at(REG.wood, (W, H) => { pixels(x, REG.wood.px[0], REG.wood.px[1], W, H, (i, j) => { const f = 0.75 + 0.25 * Math.sin(i * 0.25 + pnoise2(i / 16, j / 64, 8, 3) * 6); return [92 * f, 60 * f, 36 * f]; }); });
  at(REG.cross, (W, H) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); x.fillStyle = '#12a150'; x.fillRect(W / 2 - 16, 16, 32, H - 32); x.fillRect(16, H / 2 - 16, W - 32, 32); });
  at(REG.templeDoor, (W, H) => {
    x.fillStyle = '#f2ece0'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#c84a14'; x.fillRect(10, 10, W - 20, H - 14);
    x.fillStyle = '#1a0e08'; x.beginPath(); x.moveTo(24, H - 4); x.lineTo(24, 50); x.quadraticCurveTo(W / 2, 14, W - 24, 50); x.lineTo(W - 24, H - 4); x.fill();
    const g = x.createRadialGradient(W / 2, H * 0.62, 2, W / 2, H * 0.62, 30); g.addColorStop(0, 'rgba(255,200,90,1)'); g.addColorStop(1, 'rgba(255,120,20,0)'); x.fillStyle = g; x.fillRect(20, 40, W - 40, H - 44);
    x.fillStyle = '#ff8c00'; for (let k = 0; k < 14; k++) { x.beginPath(); x.arc(20 + k * 6.5, 30 + Math.sin(k / 13 * Math.PI) * 14, 3.5, 0, 6.28); x.fill(); }
  });
  at(REG.belfry, (W, H) => {
    x.fillStyle = '#8a857c'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#100c0a'; x.beginPath(); x.moveTo(28, H - 8); x.lineTo(28, 50); x.quadraticCurveTo(W / 2, 4, W - 28, 50); x.lineTo(W - 28, H - 8); x.fill();
    x.strokeStyle = '#555'; x.lineWidth = 4; for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(28, 40 + k * 18); x.lineTo(W - 28, 40 + k * 18); x.stroke(); }
  });
  GENERIC_SIGNS.forEach(([hi, en, bg, fg], i) => {
    at(REG['sign' + i], (W, H) => {
      x.fillStyle = bg; x.fillRect(0, 0, W, H); x.strokeStyle = fg; x.lineWidth = 3; x.strokeRect(4, 4, W - 8, H - 8);
      x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
      fitFont(x, hi, W * 0.9, 26, DEVA); x.fillText(hi, W / 2, H * 0.36);
      fitFont(x, en, W * 0.9, 16, LATIN); x.fillText(en, W / 2, H * 0.76);
    });
  });
  return c;
}

// ============================================================================ materials (lazy, shared)
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const std = (map, o = {}) => new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  MATS = {
    plaster: std(tex(plasterCanvas())),
    stone: std(tex(stoneCanvas()), { roughness: 0.95 }),
    slate: std(tex(slateCanvas()), { roughness: 0.85 }),
    tin: std(tex(tinCanvas()), { roughness: 0.62, metalness: 0.08 }),
    brick: std(tex(brickCanvas())),
    rock: std(tex(rockCanvas()), { roughness: 0.96 }),
    atlas: std(tex(paintAtlas(), { repeat: false }), { roughness: 0.7 }),
  };
  for (const k in MATS) MATS[k].name = 'bld_' + k;
  return MATS;
}

// ============================================================================ mesh builder
const _col = new THREE.Color();
function C(hex, f = 1) { _col.setHex(hex); return [_col.r * f, _col.g * f, _col.b * f]; }
function shade(c, f) { return [c[0] * f, c[1] * f, c[2] * f]; }

class MB {
  constructor(tile = 1) { this.tile = tile; this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; }
  _v(p, n, uv, c) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]); this.c.push(c[0], c[1], c[2]); return this.p.length / 3 - 1; }
  static nrm(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
  }
  quad(a, b, c, d, uvs, col) {
    const n = MB.nrm(a, b, c);
    const i0 = this._v(a, n, uvs[0], col), i1 = this._v(b, n, uvs[1], col), i2 = this._v(c, n, uvs[2], col), i3 = this._v(d, n, uvs[3], col);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  tri(a, b, c, uvs, col) { const n = MB.nrm(a, b, c); const i0 = this._v(a, n, uvs[0], col), i1 = this._v(b, n, uvs[1], col), i2 = this._v(c, n, uvs[2], col); this.idx.push(i0, i1, i2); }
  /** metric-UV quad: u along a→b, v along a→d (meters / tile) */
  quadM(a, b, c, d, col, u0 = 0, v0 = 0) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / this.tile, H = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) / this.tile;
    this.quad(a, b, c, d, [[u0, v0], [u0 + L, v0], [u0 + L, v0 + H], [u0, v0 + H]], col);
  }
  /** atlas-region quad */
  quadR(a, b, c, d, reg, col = [1, 1, 1]) { this.quad(a, b, c, d, [[reg.u0, reg.v0], [reg.u1, reg.v0], [reg.u1, reg.v1], [reg.u0, reg.v1]], col); }
  /** facade decal on a wall plane facing +Z (or rotated by rotY about origin), from (x0,y0) size w×h, at depth z */
  decal(x, y, z, w, h, reg, col = [1, 1, 1], rotY = 0) {
    const P = [[x - w / 2, y, z], [x + w / 2, y, z], [x + w / 2, y + h, z], [x - w / 2, y + h, z]].map(p => rot(p, rotY));
    this.quadR(P[0], P[1], P[2], P[3], reg, col);
  }
  /**
   * box from y0..y0+h centred (cx,cz). o: { reg (atlas region for all faces), skip:{front,back,left,right,top,bottom},
   * rotY (about box centre), uOff, top/bottom colours }
   */
  box(cx, y0, cz, w, h, d, col, o = {}) {
    const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, ry = o.rotY || 0, sk = o.skip || {};
    const T = p => { const q = rot(p, ry); return [q[0] + cx, q[1] + y0, q[2] + cz]; };
    const faces = {
      front: [[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], w, h],
      back: [[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], w, h],
      left: [[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], d, h],
      right: [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], d, h],
      top: [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], w, d],
      bottom: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], w, d],
    };
    for (const k in faces) {
      if (sk[k]) continue;
      const [a, b, c, dd] = faces[k].slice(0, 4).map(T);
      const fc = (k === 'top' && o.topCol) ? o.topCol : col;
      if (o.reg) this.quadR(a, b, c, dd, o.reg, fc);
      else {
        const u0 = (o.uOff ?? (cx * 0.37 + cz * 0.61 + y0 * 0.13)) / this.tile;
        const vbase = (k === 'top' || k === 'bottom') ? 0 : y0 / this.tile;
        this.quadM(a, b, c, dd, fc, u0, vbase);
      }
    }
  }
  /** cylinder / cone along Y. o: { rTop, reg, caps:true, uScale } */
  cyl(cx, y0, cz, r, h, seg, col, o = {}) {
    const rt = o.rTop ?? r, reg = o.reg;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = (a, rr, y) => [cx + Math.sin(a) * rr, y0 + y, cz + Math.cos(a) * rr];
      const A = p(a0, r, 0), B = p(a1, r, 0), Cc = p(a1, rt, h), D = p(a0, rt, h);
      let uvs;
      if (reg) uvs = [[lerp(reg.u0, reg.u1, i / seg), reg.v0], [lerp(reg.u0, reg.u1, (i + 1) / seg), reg.v0], [lerp(reg.u0, reg.u1, (i + 1) / seg), reg.v1], [lerp(reg.u0, reg.u1, i / seg), reg.v1]];
      else { const L = 2 * Math.PI * r / seg / this.tile, u = i * L; uvs = [[u, y0 / this.tile], [u + L, y0 / this.tile], [u + L, (y0 + h) / this.tile], [u, (y0 + h) / this.tile]]; }
      // smooth normals for round things
      const n0 = [Math.sin(a0), (r - rt) / h, Math.cos(a0)], n1 = [Math.sin(a1), (r - rt) / h, Math.cos(a1)];
      const nl = v => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
      const i0 = this._v(A, nl(n0), uvs[0], col), i1 = this._v(B, nl(n1), uvs[1], col), i2 = this._v(Cc, nl(n1), uvs[2], col), i3 = this._v(D, nl(n0), uvs[3], col);
      this.idx.push(i0, i1, i2, i0, i2, i3);
      if (o.caps !== false) {
        const ru = reg ? [(reg.u0 + reg.u1) / 2, (reg.v0 + reg.v1) / 2] : [0, 0];
        if (rt > 0.001) this.tri([cx, y0 + h, cz], D, Cc, [ru, ru, ru], o.capCol || col);
        this.tri([cx, y0, cz], B, A, [ru, ru, ru], o.capCol || col);
      }
    }
  }
  /** thin beam between two points (square section) */
  beam(a, b, t, col, o = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const corners = [[-t / 2, -t / 2], [t / 2, -t / 2], [t / 2, t / 2], [-t / 2, t / 2]];
    const P = (cx, y, cz) => { const v = new THREE.Vector3(cx, y, cz).applyQuaternion(q); return [v.x + a[0], v.y + a[1], v.z + a[2]]; };
    const reg = o.reg || REG.white;
    for (let i = 0; i < 4; i++) {
      const c0 = corners[i], c1 = corners[(i + 1) % 4];
      this.quadR(P(c0[0], 0, c0[1]), P(c1[0], 0, c1[1]), P(c1[0], L, c1[1]), P(c0[0], L, c0[1]), reg, col);
    }
  }
  get empty() { return this.idx.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
function rot(p, a) { if (!a) return p; const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }

function makeSet() { return { plaster: new MB(3), stone: new MB(2.4), slate: new MB(2.0), tin: new MB(1.5), brick: new MB(1.6), rock: new MB(5), atlas: new MB(1) }; }
function finish(S, extras = []) {
  const M = mats(), g = new THREE.Group();
  for (const k of Object.keys(S)) {
    if (S[k].empty) continue;
    const mesh = new THREE.Mesh(S[k].geometry(), M[k]); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = k; g.add(mesh);
  }
  for (const e of extras) g.add(e);
  return g;
}

// gable roof (ridge along X) over a w×d footprint whose walls end at height y; returns ridge height
function gableRoof(Rb, Wb, cx, y, cz, w, d, pitch, over, col, wallCol) {
  const hw = w / 2 + over, hd = d / 2 + over, rise = Math.tan(pitch) * (d / 2 + over);
  const yr = y + Math.tan(pitch) * d / 2;
  const eaveY = yr - rise;
  // front slope (faces +Z/up), back slope
  Rb.quadM([cx - hw, eaveY, cz + hd], [cx + hw, eaveY, cz + hd], [cx + hw, yr, cz], [cx - hw, yr, cz], col);
  Rb.quadM([cx + hw, eaveY, cz - hd], [cx - hw, eaveY, cz - hd], [cx - hw, yr, cz], [cx + hw, yr, cz], col);
  // undersides (darker)
  const dc = shade(col, 0.55);
  Rb.quadM([cx + hw, eaveY - 0.05, cz + hd], [cx - hw, eaveY - 0.05, cz + hd], [cx - hw, yr - 0.05, cz], [cx + hw, yr - 0.05, cz], dc);
  Rb.quadM([cx - hw, eaveY - 0.05, cz - hd], [cx + hw, eaveY - 0.05, cz - hd], [cx + hw, yr - 0.05, cz], [cx - hw, yr - 0.05, cz], dc);
  // gable triangles (walls)
  if (Wb) {
    const hx = w / 2;
    Wb.tri([cx + hx, y, cz + d / 2], [cx + hx, y, cz - d / 2], [cx + hx, yr, cz], [[0, 0], [d / Wb.tile, 0], [d / 2 / Wb.tile, (yr - y) / Wb.tile]], wallCol);
    Wb.tri([cx - hx, y, cz - d / 2], [cx - hx, y, cz + d / 2], [cx - hx, yr, cz], [[0, 0], [d / Wb.tile, 0], [d / 2 / Wb.tile, (yr - y) / Wb.tile]], wallCol);
  }
  gableRoof.eave = eaveY;
  return yr;
}
// hipped roof over w×d at height y
function hipRoof(Rb, cx, y, cz, w, d, h, over, col) {
  const hw = w / 2 + over, hd = d / 2 + over, ridge = Math.max(0, hw - hd);
  const yE = y - over * (h / (d / 2)) * 0.5, yr = y + h;
  const A = [cx - hw, yE, cz + hd], B = [cx + hw, yE, cz + hd], Cc = [cx + hw, yE, cz - hd], D = [cx - hw, yE, cz - hd];
  const R1 = [cx - ridge, yr, cz], R2 = [cx + ridge, yr, cz];
  Rb.quadM(A, B, R2, R1, col);              // front trapezoid
  Rb.quadM(Cc, D, R1, R2, col);             // back trapezoid
  Rb.tri(B, Cc, R2, [[0, 0], [2 * hd / Rb.tile, 0], [hd / Rb.tile, h * 1.2 / Rb.tile]], shade(col, 0.95));
  Rb.tri(D, A, R1, [[0, 0], [2 * hd / Rb.tile, 0], [hd / Rb.tile, h * 1.2 / Rb.tile]], shade(col, 0.95));
  const dc = shade(col, 0.5);
  Rb.quad([cx + hw, yE - 0.04, cz + hd], [cx - hw, yE - 0.04, cz + hd], [cx - hw, yE - 0.04, cz - hd], [cx + hw, yE - 0.04, cz - hd], [[0, 0], [1, 0], [1, 1], [0, 1]], dc);
  return yr;
}

// ============================================================================ signs (unique canvas per text, cached)
const SIGN_CACHE = new Map();
function signMaterial(hi, en, { bg = '#f2c230', fg = '#b3121b', accent = null, sub = null, w = 1024, h = 256, border = true } = {}) {
  const key = [hi, en, bg, fg, accent, sub, w, h].join('|');
  if (SIGN_CACHE.has(key)) return SIGN_CACHE.get(key);
  const c = mkCanvas(w, h), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, bg); g.addColorStop(1, shadeCss(bg, 0.82)); x.fillStyle = g; x.fillRect(0, 0, w, h);
  if (border) { x.strokeStyle = accent || fg; x.lineWidth = h * 0.05; x.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1); }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = h * 0.02; x.shadowOffsetY = h * 0.015;
  const lines = [[hi, DEVA], [en, LATIN]].filter(l => l[0]);
  if (sub) lines.push([sub, LATIN]);
  const sizes = lines.length === 1 ? [0.62] : lines.length === 2 ? [0.44, 0.3] : [0.36, 0.24, 0.17];
  const ys = lines.length === 1 ? [0.52] : lines.length === 2 ? [0.36, 0.75] : [0.3, 0.6, 0.84];
  lines.forEach(([t, fam], i) => {
    if (i === 2 && accent) x.fillStyle = accent;
    fitFont(x, t, w * 0.9, Math.floor(h * sizes[i]), fam); x.fillText(t, w / 2, h * ys[i]);
  });
  const t = tex(c, { repeat: false, aniso: 8 });
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0 });
  m.name = 'sign_' + (en || hi);
  SIGN_CACHE.set(key, m);
  return m;
}
function shadeCss(css, f) { const c = new THREE.Color(css); c.multiplyScalar(f); return '#' + c.getHexString(); }
function signMesh(mat, w, h, x, y, z, rotY = 0) {
  const geo = new THREE.PlaneGeometry(w, h);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y + h / 2, z); m.rotation.y = rotY; m.castShadow = false; m.receiveShadow = true; return m;
}

const PASTELS = [0xeab8bc, 0xf2c79e, 0xf0dfa0, 0xbfe0c4, 0xa9cde3, 0xefe6d0, 0xd2bfe4, 0xcde4a8, 0xf4f1ea, 0xf3d3b5, 0xbad7d5];
const SHOP_STYLES = {
  general: { bg: '#f2c230', fg: '#b3121b', reg: 'shelves', hang: 'packets', hi: 'जनरल स्टोर', en: 'GENERAL STORE' },
  kirana: { bg: '#ffde3b', fg: '#c4161c', reg: 'shelves', hang: 'packets', hi: 'किराना स्टोर', en: 'KIRANA STORE' },
  chai: { bg: '#5a2d12', fg: '#ffd27a', reg: 'dhabaInt', hang: null, hi: 'चाय की दुकान', en: 'TEA STALL' },
  sweets: { bg: '#d8261c', fg: '#fff3b0', reg: 'sweets', hang: null, hi: 'मिष्ठान भंडार', en: 'SWEETS' },
  mobile: { bg: '#1b5fd0', fg: '#ffffff', reg: 'shelves', hang: null, hi: 'मोबाइल शॉप', en: 'MOBILE & RECHARGE', ads: true },
  hotel: { bg: '#7a1420', fg: '#ffd84a', reg: 'dhabaInt', hang: null, hi: 'भोजनालय', en: 'HOTEL' },
  medical: { bg: '#0f8a48', fg: '#ffffff', reg: 'medShelves', hang: null, hi: 'मेडिकल स्टोर', en: 'MEDICAL STORE', cross: true },
  hardware: { bg: '#1f2f4a', fg: '#9fe0ff', reg: 'shelves', hang: null, hi: 'हार्डवेयर', en: 'HARDWARE' },
  cloth: { bg: '#a3127a', fg: '#ffffff', reg: 'clothes', hang: 'clothes', hi: 'वस्त्रालय', en: 'GARMENTS' },
};

// ============================================================================ SHOP
/**
 * createShop({ seed, w=4.5, d=6, sign:{hi,en}, kind }) — single shop, open front with goods, flex signboard, tin awning.
 * kind: 'general'|'kirana'|'chai'|'sweets'|'mobile'|'hotel'|'medical'|'hardware'|'cloth'
 */
export function createShop({ seed = 1, w = 4.5, d = 6, sign = null, kind = null } = {}) {
  const r = makeRng(seed * 7919 + 13);
  kind = SHOP_STYLES[kind] ? kind : r.pick(Object.keys(SHOP_STYLES));
  const st = SHOP_STYLES[kind];
  const S = makeSet();
  const paint = C(r.pick(PASTELS)), H1 = 3.4, plinth = 0.3;
  const storeys = r() < 0.55 ? 2 : 1;
  const hz = d / 2;
  // body (front face open), plinth & step
  S.plaster.box(0, 0, 0, w + 0.1, plinth, d + 0.1, C(0x9a958c));
  S.plaster.box(0, 0, hz + 0.3, w * 0.9, 0.16, 0.5, C(0x8c877e));
  S.plaster.box(0, plinth, 0, w, H1 - plinth, d, paint, { skip: { front: true, bottom: true } });
  // front pillars & lintel
  S.plaster.box(-w / 2 + 0.15, plinth, hz - 0.15, 0.3, H1 - plinth, 0.3, paint);
  S.plaster.box(w / 2 - 0.15, plinth, hz - 0.15, 0.3, H1 - plinth, 0.3, paint);
  S.plaster.box(0, 2.6, hz - 0.15, w, H1 - 2.6, 0.3, paint, { skip: { bottom: false } });
  // interior: floor, side/ceiling dark, back wall goods
  const iw = w - 0.6, idp = d - 0.6, zb = -hz + 0.3;
  S.atlas.quadR([-iw / 2, plinth + 0.01, hz - 0.3], [iw / 2, plinth + 0.01, hz - 0.3], [iw / 2, plinth + 0.01, zb], [-iw / 2, plinth + 0.01, zb], REG.dark, C(0x6a645c));
  S.atlas.quadR([-iw / 2, 2.6, zb], [iw / 2, 2.6, zb], [iw / 2, 2.6, hz - 0.3], [-iw / 2, 2.6, hz - 0.3], REG.dark, C(0x555555));
  S.atlas.quadR([-iw / 2, plinth, hz - 0.3], [-iw / 2, plinth, zb], [-iw / 2, 2.6, zb], [-iw / 2, 2.6, hz - 0.3], REG.shelves, C(0x8a8a8a));
  S.atlas.quadR([iw / 2, plinth, zb], [iw / 2, plinth, hz - 0.3], [iw / 2, 2.6, hz - 0.3], [iw / 2, 2.6, zb], REG.shelves, C(0x8a8a8a));
  S.atlas.quadR([-iw / 2, plinth, zb + 0.01], [iw / 2, plinth, zb + 0.01], [iw / 2, 2.6, zb + 0.01], [-iw / 2, 2.6, zb + 0.01], REG[st.reg]);
  // counter
  const counterZ = hz - 1.1;
  if (kind === 'sweets') { S.atlas.box(0, plinth, counterZ, iw * 0.8, 1.05, 0.7, [1, 1, 1], { reg: REG.white }); S.atlas.decal(0, plinth, counterZ + 0.36, iw * 0.8, 1.05, REG.sweets); }
  else S.plaster.box(0, plinth, counterZ, iw * 0.75, 0.95, 0.6, C(kind === 'medical' ? 0xf2f2f2 : 0x7a5a3a), { topCol: C(0x3a3a38) });
  // rolled-up shutter housing
  S.atlas.box(0, 2.42, hz + 0.02, w - 0.5, 0.2, 0.22, C(0x8a9096), { reg: REG.white });
  // hanging strips (chips packets / clothes)
  if (st.hang) for (let k = 0; k < Math.max(2, Math.round(w / 1.4)); k++) {
    const xx = -w / 2 + 0.6 + k * (w - 1.2) / Math.max(1, Math.round(w / 1.4) - 1);
    S.atlas.decal(xx, 1.5, hz + 0.05, 0.45, 1.05, REG[st.hang]);
  }
  // tin awning under the sign
  const awn = C(r.pick([0x2a6fb8, 0x2f8a4a, 0xb8322a, 0xdadada, 0x2a8aa0, 0x8a8a8a]));
  const ad = r.range(1.0, 1.5);
  S.tin.quadM([-w / 2 - 0.1, 2.25, hz + ad], [w / 2 + 0.1, 2.25, hz + ad], [w / 2 + 0.1, 2.6, hz + 0.02], [-w / 2 - 0.1, 2.6, hz + 0.02], awn);
  S.tin.quadM([w / 2 + 0.1, 2.23, hz + ad], [-w / 2 - 0.1, 2.23, hz + ad], [-w / 2 - 0.1, 2.58, hz + 0.02], [w / 2 + 0.1, 2.58, hz + 0.02], shade(awn, 0.6));
  for (const sx of [-1, 1]) S.atlas.beam([sx * (w / 2 - 0.1), 2.6, hz + 0.02], [sx * (w / 2 - 0.1), 2.27, hz + ad - 0.05], 0.04, C(0x333333));
  // upper storey
  let topY = H1;
  if (storeys === 2) {
    const H2 = 3.0;
    S.plaster.box(0, H1, 0, w, H2, d, paint);
    S.plaster.box(0, H1 - 0.12, 0, w + 0.15, 0.2, d + 0.15, C(0xf0ece4));
    const nw = w > 5 ? 2 : 1;
    for (let k = 0; k < nw; k++) {
      const xx = nw === 1 ? 0 : (k ? w / 4 : -w / 4);
      S.atlas.decal(xx, H1 + 0.9, hz + 0.02, 1.2, 1.3, REG.winGrill, C(r.pick([0xffffff, 0xcfe8d8, 0xd8e2f2])));
      S.plaster.box(xx, H1 + 2.25, hz + 0.25, 1.6, 0.08, 0.5, C(0xe8e4dc));
    }
    topY = H1 + H2;
  }
  // roof parapet + tank
  for (const [px, pz, pw, pd] of [[0, hz - 0.07, w, 0.14], [0, -hz + 0.07, w, 0.14], [-w / 2 + 0.07, 0, 0.14, d], [w / 2 - 0.07, 0, 0.14, d]]) S.plaster.box(px, topY, pz, pw, 0.7, pd, paint);
  if (r() < 0.6) { S.atlas.cyl(r.range(-w / 4, w / 4), topY + 0.3, -hz + 1.2, 0.55, 1.1, 10, C(0xffffff), { reg: REG.tank }); S.plaster.box(0, topY, -hz + 1.2, 1.4, 0.3, 1.2, C(0x8a8680)); }
  // signboard (unique)
  const sg = sign && (sign.hi || sign.en) ? sign : { hi: st.hi, en: st.en };
  const sm = signMaterial(sg.hi, sg.en, { bg: st.bg, fg: st.fg, w: 1024, h: 256 });
  const extras = [signMesh(sm, w - 0.2, 0.78, 0, 2.62, hz + 0.02)];
  if (st.cross) S.atlas.box(w / 2 - 0.35, 2.7, hz + 0.3, 0.55, 0.55, 0.08, [1, 1, 1], { reg: REG.cross });
  if (st.ads) { S.atlas.decal(-w / 2 + 0.55, 0.9, hz + 0.03, 0.6, 0.6, REG.mobileAds); S.atlas.decal(w / 2 - 0.55, 0.9, hz + 0.03, 0.6, 0.6, REG.mobileAds); }
  if (kind === 'chai') { for (const sx of [-1, 1]) { S.atlas.box(sx * (w / 2 + 0.8), 0, hz + 0.8, 1.6, 0.45, 0.35, C(0x8a5a32), { reg: REG.bench }); } }
  const group = finish(S, extras);
  return { group, update() {}, size: { w, d, h: topY + 0.7 } };
}

// ============================================================================ TOWN BUILDING
/** createTownBuilding({ seed, floors=3, w=8, d=10 }) — pastel concrete mixed-use building with shops below */
export function createTownBuilding({ seed = 1, floors = 3, w = 8, d = 10 } = {}) {
  const r = makeRng(seed * 104729 + 7);
  floors = clamp(Math.round(floors), 1, 5);
  const S = makeSet(); const fh = 3.05, H = floors * fh, hz = d / 2;
  const paint = C(r.pick(PASTELS)), trim = C(r.pick([0xf4f2ee, 0xd8d2c8, 0x9a7b5a, 0x6a8aa0, 0xffffff]));
  const brickSides = r() < 0.35;
  S.plaster.box(0, 0, 0, w, H, d, paint, { skip: brickSides ? { left: true, right: true } : {} });
  if (brickSides) for (const sx of [-1, 1]) S.brick.box(sx * (w / 2 - 0.01), 0, 0, 0.02, H, d, C(0xffffff), { skip: { front: true, back: true, top: true, bottom: true } });
  S.plaster.box(0, 0, 0, w + 0.08, 0.45, d + 0.08, shade(paint, 0.62));                          // plinth band
  for (let f = 1; f < floors; f++) S.plaster.box(0, f * fh - 0.12, 0, w + 0.14, 0.24, d + 0.14, trim); // floor bands
  // ground floor: shop bays
  const bays = Math.max(1, Math.round(w / 3.3)), bw = w / bays;
  for (let b = 0; b < bays; b++) {
    const xx = -w / 2 + bw * (b + 0.5), open = r() < 0.6;
    S.atlas.decal(xx, 0.45, hz + 0.02, bw - 0.5, 2.25, open ? REG[r.pick(['shelves', 'shelves', 'clothes', 'medShelves'])] : REG.shutter, open ? [1, 1, 1] : C(r.pick([0xffffff, 0xd8e8ff, 0xffe8d8])));
    S.atlas.box(xx, 2.7, hz + 0.12, bw - 0.25, 0.48, 0.06, [1, 1, 1], { reg: REG['sign' + r.int(0, 7)] });
    S.atlas.box(xx, 2.5, hz + 0.02, bw - 0.4, 0.18, 0.2, C(0x8a9096), { reg: REG.white });
  }
  S.plaster.box(0, 2.98, hz + 0.45, w + 0.1, 0.1, 0.9, trim);                                     // chajja over shops
  // upper floors
  const nWin = Math.max(1, Math.floor(w / 2.6));
  const winTint = C(r.pick([0xffffff, 0xcfe8d8, 0xd8e2f2, 0xf2e0c8]));
  for (let f = 1; f < floors; f++) {
    const y = f * fh;
    const balcony = r() < 0.55;
    for (let k = 0; k < nWin; k++) {
      const xx = -w / 2 + (k + 0.5) * w / nWin;
      if (balcony && k === Math.floor(nWin / 2)) S.atlas.decal(xx, y + 0.05, hz + 0.02, 1.0, 2.1, REG.doorMetal, C(0xd0d8d0));
      else S.atlas.decal(xx, y + 0.85, hz + 0.02, 1.25, 1.35, REG.winGrill, winTint);
      S.plaster.box(xx, y + 2.3, hz + 0.25, 1.65, 0.08, 0.5, trim);
    }
    if (balcony) {
      const bwid = Math.min(w * 0.65, 4.5);
      S.plaster.box(0, y - 0.05, hz + 0.55, bwid, 0.16, 1.1, trim);
      S.plaster.box(0, y + 0.11, hz + 1.05, bwid, 0.35, 0.1, paint);
      S.atlas.box(0, y + 0.46, hz + 1.05, bwid, 0.55, 0.05, C(0x666666), { reg: REG.grill });
      for (const sx of [-1, 1]) S.plaster.box(sx * (bwid / 2 - 0.05), y + 0.11, hz + 0.55, 0.1, 0.9, 1.1, paint);
    }
  }
  // fix side windows onto the side walls (decal() rotates about origin, so place via explicit quads)
  for (let f = 1; f < floors; f++) for (const sx of [-1, 1]) {
    const y = f * fh + 0.9, xw = sx * (w / 2 + 0.02), zc = r.range(-d / 4, d / 4);
    const P = sx > 0 ? [[xw, y, zc + 0.55], [xw, y, zc - 0.55], [xw, y + 1.2, zc - 0.55], [xw, y + 1.2, zc + 0.55]] : [[xw, y, zc - 0.55], [xw, y, zc + 0.55], [xw, y + 1.2, zc + 0.55], [xw, y + 1.2, zc - 0.55]];
    S.atlas.quadR(P[0], P[1], P[2], P[3], REG.winGrill, winTint);
  }
  // AC unit on a side
  if (floors > 1 && r() < 0.6) {
    const sx = r.sign(), xa = sx * (w / 2 + 0.37), ya = fh + 1.0, za = -d / 4;
    S.atlas.box(sx * (w / 2 + 0.18), ya, za, 0.36, 0.55, 0.8, C(0xd8d8d4), { reg: REG.white });
    const P = sx > 0 ? [[xa, ya, za + 0.4], [xa, ya, za - 0.4], [xa, ya + 0.55, za - 0.4], [xa, ya + 0.55, za + 0.4]] : [[xa, ya, za - 0.4], [xa, ya, za + 0.4], [xa, ya + 0.55, za + 0.4], [xa, ya + 0.55, za - 0.4]];
    S.atlas.quadR(P[0], P[1], P[2], P[3], REG.ac);
  }
  // roof: parapet, mumty, tank, rebar
  for (const [px, pz, pw, pd] of [[0, hz - 0.08, w, 0.16], [0, -hz + 0.08, w, 0.16], [-w / 2 + 0.08, 0, 0.16, d], [w / 2 - 0.08, 0, 0.16, d]]) S.plaster.box(px, H, pz, pw, 0.9, pd, paint);
  if (r() < 0.7) {
    const mx = r.sign() * (w / 2 - 1.5), mz = -hz + 1.6;
    S.plaster.box(mx, H, mz, 2.6, 2.5, 2.8, paint);
    S.atlas.decal(mx, H, mz + 1.42, 0.9, 2.0, REG.doorMetal, C(0xc8d4d0));
    S.atlas.cyl(mx, H + 2.5, mz, 0.6, 1.15, 10, C(0xffffff), { reg: REG.tank });
  } else S.atlas.cyl(r.range(-w / 4, w / 4), H + 0.4, -hz + 1.4, 0.6, 1.15, 10, C(0xffffff), { reg: REG.tank });
  if (r() < 0.75) {
    const dark = C(0x3a3430);
    for (const [cx, cz] of [[-w / 2 + 0.25, hz - 0.25], [w / 2 - 0.25, hz - 0.25], [-w / 2 + 0.25, -hz + 0.25], [w / 2 - 0.25, -hz + 0.25]])
      for (let k = 0; k < 3; k++) S.atlas.beam([cx + (k - 1) * 0.08, H + 0.9, cz], [cx + (k - 1) * 0.1, H + 1.7 + r() * 0.3, cz + r.range(-0.05, 0.05)], 0.025, dark);
  }
  if (r() < 0.4) { const dx = r.range(-w / 3, w / 3); S.atlas.beam([dx, H + 0.9, hz - 1], [dx, H + 1.8, hz - 1], 0.04, C(0x777777)); S.atlas.cyl(dx, H + 1.7, hz - 1.0, 0.35, 0.12, 8, C(0xe8e8e8), { reg: REG.white, rTop: 0.05 }); }
  const group = finish(S);
  return { group, update() {}, size: { w, d, h: H + 0.9 } };
}

// ============================================================================ BUS STAND
/** createBusStand() — "रामनगर बस स्टैंड / RAMNAGAR BUS STAND": shelter, office, benches, ticket windows (~30 x 12 m) */
export function createBusStand() {
  const S = makeSet();
  const W = 30, D = 12, cream = C(0xf1e7cf), band = C(0xd2691e), grey = C(0x9a968e);
  S.plaster.box(0, 0, 0, W, 0.35, D, grey, { topCol: C(0xb0aca2) });                     // platform
  S.plaster.box(0, 0, D / 2 - 0.2, W, 0.36, 0.4, C(0xdedad0));                           // kerb
  S.plaster.box(0, 0.35, -D / 2 + 0.15, W, 3.9, 0.3, cream);                             // back wall
  S.plaster.box(0, 2.2, -D / 2 + 0.33, W, 0.35, 0.06, band);                             // colour band
  // office block at the left end
  const ox = -W / 2 + 3.5;
  S.plaster.box(ox, 0.35, -D / 2 + 3, 7, 3.9, 5.7, cream);
  S.plaster.box(ox, 2.2, -D / 2 + 5.87, 7, 0.35, 0.06, band);
  S.atlas.decal(ox - 2.2, 0.95, -D / 2 + 5.87, 1.3, 1.3, REG.ticket);
  S.atlas.decal(ox - 0.6, 0.95, -D / 2 + 5.87, 1.3, 1.3, REG.ticket);
  S.atlas.decal(ox + 1.2, 0.35, -D / 2 + 5.87, 1.1, 2.2, REG.doorMetal, C(0xd8e0f0));
  S.atlas.decal(ox + 2.7, 1.0, -D / 2 + 5.87, 1.2, 1.2, REG.timetable);
  // roof slab on columns
  S.plaster.box(0, 4.25, -0.5, W + 1, 0.32, D - 1.6, C(0xe8e2d4), { topCol: C(0x8a8a86) });
  S.plaster.box(0, 4.25, D / 2 - 2.2, W + 1, 0.7, 0.18, band);
  for (let k = 0; k < 7; k++) S.plaster.box(-W / 2 + 1 + k * (W - 2) / 6, 0.35, D / 2 - 2.4, 0.4, 3.9, 0.4, cream);
  // benches (steel)
  for (let k = 0; k < 5; k++) {
    const bx = -W / 2 + 10 + k * 4.2, bz = -D / 2 + 1.6;
    S.atlas.box(bx, 0.78, bz, 3.0, 0.07, 0.45, C(0x3a6ab0), { reg: REG.white });
    S.atlas.box(bx, 0.85, bz - 0.24, 3.0, 0.45, 0.05, C(0x3a6ab0), { reg: REG.white });
    for (const sx of [-1.3, 1.3]) S.atlas.box(bx + sx, 0.35, bz, 0.06, 0.45, 0.4, C(0x555555), { reg: REG.white });
  }
  // posters on back wall, water cooler, dustbins
  for (let k = 0; k < 4; k++) S.atlas.decal(-2 + k * 4.5, 1.5, -D / 2 + 0.31, 1.1, 1.1, k % 2 ? REG.posters : REG.mobileAds);
  S.atlas.box(W / 2 - 2, 0.35, -D / 2 + 0.75, 1.2, 1.4, 0.7, C(0xc8ccd0), { reg: REG.white });
  const cool = signMaterial('पीने का पानी', 'DRINKING WATER', { bg: '#1f6fd0', fg: '#ffffff', w: 512, h: 160 });
  S.atlas.box(W / 2 - 5, 0.35, D / 2 - 1.2, 0.5, 0.8, 0.5, C(0x2a8a3a), { reg: REG.white });
  // big sign on the roof front
  const sm = signMaterial('रामनगर बस स्टैंड', 'RAMNAGAR BUS STAND', { bg: '#0e3d7a', fg: '#ffffff', accent: '#ffd84a', sub: 'UTTARAKHAND • उत्तराखण्ड', w: 2048, h: 320 });
  for (const sx of [-5.5, 5.5]) S.atlas.box(sx, 4.57, D / 2 - 2.25, 0.18, 1.0, 0.18, C(0x555555), { reg: REG.white });
  const extras = [
    signMesh(sm, 13.5, 2.0, 0, 4.95, D / 2 - 2.1),
    signMesh(cool, 1.15, 0.36, W / 2 - 2, 1.78, -D / 2 + 1.12),
  ];
  const group = finish(S, extras);
  return { group, update() {}, size: { w: W + 1, d: D, h: 7 } };
}

// ============================================================================ DHABA
/** createDhaba({ seed, sign }) — roadside tin-roof tea stall ("Chai • Maggi • Paratha") with benches & plastic chairs */
export function createDhaba({ seed = 1, sign = null } = {}) {
  const r = makeRng(seed * 31337 + 3);
  const S = makeSet();
  const W = r.range(6, 7.5), D = 3.2, hz = 0;
  const wallCol = C(r.pick([0x5aa0c8, 0x7fbf7f, 0xe8d8a8, 0xf0c8a0, 0x9ac0d8]));
  const brick = r() < 0.4;
  const wb = brick ? S.brick : S.plaster;
  // back room (open front with counter)
  S.plaster.box(0, 0, -1.6, W, 0.25, D + 0.2, C(0x8a857c));
  wb.box(0, 0.25, -1.6, W, 2.6, D, brick ? C(0xffffff) : wallCol, { skip: { front: true, bottom: true } });
  for (const sx of [-1, 1]) wb.box(sx * (W / 2 - 0.4), 0.25, -1.6 + D / 2 - 0.12, 0.8, 2.6, 0.24, brick ? C(0xffffff) : wallCol);
  S.atlas.decal(0, 0.25, -1.6 - D / 2 + 0.17, W - 0.4, 2.55, REG.dhabaInt);
  S.atlas.quadR([-W / 2 + 0.2, 0.26, -0.1], [W / 2 - 0.2, 0.26, -0.1], [W / 2 - 0.2, 0.26, -3.05], [-W / 2 + 0.2, 0.26, -3.05], REG.dark, C(0x6a645c));
  S.plaster.box(0, 0.25, -0.35, W - 1.8, 0.95, 0.55, C(0x9a8a7a), { topCol: C(0x6a6a6a) });          // counter
  S.atlas.cyl(-W / 4, 1.2, -0.4, 0.22, 0.35, 10, C(0xd8dcdf), { reg: REG.white });                  // big kettle
  S.atlas.cyl(-W / 4, 1.55, -0.4, 0.08, 0.06, 6, C(0x333333), { reg: REG.white });
  S.atlas.cyl(W / 4, 1.2, -0.4, 0.17, 0.25, 10, C(0x9aa0a6), { reg: REG.white });                   // pot
  S.atlas.cyl(W / 2 - 0.6, 0.25, -0.6, 0.16, 0.6, 10, C(0xc0281e), { reg: REG.white });             // gas cylinder
  S.atlas.cyl(-W / 2 - 0.5, 0, -1.2, 0.3, 0.9, 10, C(0x1f5fb0), { reg: REG.white });                // water drum
  // lean-to tin roof on poles
  const tinCol = C(r.pick([0x2a6fb8, 0x2f8a4a, 0xa83226, 0x9a9a9a, 0x1f8aa0]));
  const front = 3.4, yb = 3.05, yf = 2.45;
  S.tin.quadM([-W / 2 - 0.6, yf, front], [W / 2 + 0.6, yf, front], [W / 2 + 0.6, yb, -1.6 - D / 2], [-W / 2 - 0.6, yb, -1.6 - D / 2], tinCol);
  S.tin.quadM([W / 2 + 0.6, yf - 0.03, front], [-W / 2 - 0.6, yf - 0.03, front], [-W / 2 - 0.6, yb - 0.03, -1.6 - D / 2], [W / 2 + 0.6, yb - 0.03, -1.6 - D / 2], shade(tinCol, 0.5));
  for (const px of [-W / 2, 0, W / 2]) S.atlas.beam([px, 0, front - 0.2], [px, yf, front - 0.2], 0.09, C(0x6a4a2a), { reg: REG.wood });
  S.atlas.box(0, yf - 0.12, front - 0.2, W + 0.2, 0.12, 0.12, C(0x6a4a2a), { reg: REG.wood });
  // benches, table, plastic chairs
  const benchWood = C(0xffffff);
  for (const [bx, bz, rotY] of [[-W / 4, 1.0, 0], [W / 4 + 0.4, 2.2, 0.15]]) {
    S.atlas.box(bx, 0.42, bz, 2.0, 0.07, 0.4, benchWood, { reg: REG.bench, rotY });
    for (const sx of [-0.85, 0.85]) S.atlas.box(bx + sx * Math.cos(rotY), 0, bz - sx * Math.sin(rotY), 0.07, 0.42, 0.36, C(0x4a3a2a), { reg: REG.white, rotY });
  }
  S.atlas.box(-W / 4, 0.7, 1.75, 1.2, 0.05, 0.6, C(0xe8e8e8), { reg: REG.white });
  S.atlas.box(-W / 4, 0, 1.75, 0.08, 0.7, 0.5, C(0x888888), { reg: REG.white });
  const nCh = r.int(3, 6);
  for (let k = 0; k < nCh; k++) {
    const ch = C(r.pick([0xc8201e, 0xc8201e, 0x1f4fb0, 0x2a8a3a, 0xf0f0f0]));
    const cx = r.range(-W / 2 + 0.6, W / 2 - 0.6), cz = r.range(1.4, 3.0), ry = r.range(-0.8, 0.8);
    const L = (dx, dz) => [cx + dx * Math.cos(ry) + dz * Math.sin(ry), cz - dx * Math.sin(ry) + dz * Math.cos(ry)];
    const [sx, sz] = L(0, 0); S.atlas.box(sx, 0.42, sz, 0.44, 0.05, 0.42, ch, { reg: REG.white, rotY: ry });
    const [bx, bz] = L(0, -0.2); S.atlas.box(bx, 0.47, bz, 0.42, 0.4, 0.04, ch, { reg: REG.white, rotY: ry });
    for (const dz of [0.18, -0.18]) { const [lx, lz] = L(0, dz); S.atlas.box(lx, 0, lz, 0.4, 0.42, 0.04, ch, { reg: REG.white, rotY: ry }); }
  }
  // signboard on the roof edge
  const sg = typeof sign === 'string' ? { hi: null, en: sign } : (sign || { hi: 'पहाड़ी ढाबा', en: 'PAHADI DHABA' });
  const sm = signMaterial(sg.hi || 'पहाड़ी ढाबा', (sg.en || 'PAHADI DHABA').toUpperCase(), { bg: r.pick(['#c8201e', '#1b5fd0', '#f2c230', '#0f7a3c']), fg: '#ffffff', accent: '#ffe14d', sub: 'CHAI • MAGGI • PARATHA', w: 1024, h: 300 });
  const extras = [signMesh(sm, Math.min(W, 5.5), 1.1, 0, yf + 0.02, front + 0.05)];
  for (const sx of [-1.8, 1.8]) S.atlas.box(sx, yf - 0.05, front, 0.07, 1.2, 0.07, C(0x444444), { reg: REG.white });
  const group = finish(S, extras);
  return { group, update() {}, size: { w: W + 1.2, d: D + front + 1.6, h: 3.6 } };
}

// ============================================================================ KUMAONI HOUSE
/** createKumaoniHouse({ seed }) — traditional stone house, slate roof, carved wooden doors/windows, aipan, courtyard */
export function createKumaoniHouse({ seed = 1 } = {}) {
  const r = makeRng(seed * 6007 + 11);
  const S = makeSet();
  const w = r.range(7, 9.5), d = r.range(5, 6.2), sh = 2.6, storeys = r() < 0.78 ? 2 : 1, H = sh * storeys, hz = d / 2;
  const plastered = r() < 0.45;
  const stoneTint = C(r.pick([0xffffff, 0xf2ece4, 0xe8e4e0]));
  const wallB = plastered ? S.plaster : S.stone, wallC = plastered ? C(r.pick([0xf4efe2, 0xefe2c4, 0xf6f2ea])) : stoneTint;
  // courtyard (aangan) + plinth
  S.stone.box(0, -0.2, hz + 1.6, w + 1.5, 0.35, 3.2, C(0xc8c4bc), { uOff: 0 });
  S.stone.box(0, -0.3, 0, w + 0.4, 0.6, d + 0.4, C(0xd8d4cc));
  wallB.box(0, 0.3, 0, w, H - 0.3, d, wallC);
  if (plastered) S.plaster.box(0, 0.3, 0, w + 0.04, 1.0, d + 0.04, C(0x8e3a22));                    // geru (red mud) band
  // first floor wooden beam band (carved)
  if (storeys === 2) { S.atlas.box(0, sh - 0.18, hz + 0.08, w + 0.1, 0.36, 0.16, [1, 1, 1], { reg: REG.carving }); }
  // ground floor (goth) doors + aipan
  const nd = w > 8 ? 3 : 2;
  for (let k = 0; k < nd; k++) {
    const xx = -w / 2 + (k + 0.5) * w / nd;
    S.atlas.decal(xx, 0.3, hz + 0.02, 0.85, 1.65, REG.doorKumaoni, C(r.pick([0xffffff, 0xe8d8c8])));
    S.atlas.decal(xx, 0.05, hz + 0.03, 1.1, 0.24, REG.aipan);
    S.atlas.decal(xx, 2.0, hz + 0.03, 1.1, 0.26, REG.aipan);
  }
  // upper floor: carved main door + windows, little wooden balcony
  if (storeys === 2) {
    const nWin = w > 8 ? 3 : 2;
    for (let k = 0; k < nWin; k++) {
      const xx = -w / 2 + (k + 0.5) * w / nWin;
      if (k === Math.floor(nWin / 2)) {
        S.atlas.decal(xx, sh + 0.15, hz + 0.02, 1.0, 1.95, REG.doorKumaoni);
        S.atlas.box(xx, sh - 0.05, hz + 0.45, 1.8, 0.1, 0.9, C(0x6a4a30), { reg: REG.wood });
        for (const sx of [-0.85, 0, 0.85]) S.atlas.box(xx + sx, sh + 0.05, hz + 0.86, 0.07, 0.85, 0.07, C(0x6a4a30), { reg: REG.wood });
        S.atlas.box(xx, sh + 0.85, hz + 0.86, 1.8, 0.08, 0.08, C(0x6a4a30), { reg: REG.wood });
      } else S.atlas.decal(xx, sh + 0.75, hz + 0.02, 0.95, 0.95, REG.winKumaoni);
    }
    // side stone stairs to the upper floor
    const sx = r.sign();
    for (let k = 0; k < 8; k++) S.stone.box(sx * (w / 2 + 0.6), 0.3 + k * 0.29, hz - 0.4 - k * 0.42, 1.1, 0.29, 0.5, C(0xcac6be), { uOff: k });
    S.stone.box(sx * (w / 2 + 0.6), 0.3, hz - 1.9, 1.1, 2.3, 2.6, C(0xbdb8b0));
  }
  // side windows
  for (const sxx of [-1, 1]) {
    const xw = sxx * (w / 2 + 0.02), y = H - 1.7, zc = r.range(-0.8, 0.8);
    const P = sxx > 0 ? [[xw, y, zc + 0.45], [xw, y, zc - 0.45], [xw, y + 0.9, zc - 0.45], [xw, y + 0.9, zc + 0.45]] : [[xw, y, zc - 0.45], [xw, y, zc + 0.45], [xw, y + 0.9, zc + 0.45], [xw, y + 0.9, zc - 0.45]];
    S.atlas.quadR(P[0], P[1], P[2], P[3], REG.winKumaoni);
  }
  // roof: slate (traditional) or tin (newer)
  const slate = r() < 0.7;
  const roofB = slate ? S.slate : S.tin, roofC = slate ? C(r.pick([0xffffff, 0xe8ece8, 0xd8dcd8])) : C(r.pick([0x2f6a3e, 0xa03226, 0x3a6aa0]));
  const ridge = gableRoof(roofB, wallB, 0, H, 0, w, d, slate ? 0.44 : 0.36, 0.55, roofC, wallC);
  S.atlas.box(0, ridge - 0.08, 0, w + 1.15, 0.16, 0.22, C(0x4a3a2c), { reg: REG.wood });             // ridge beam
  const eave = gableRoof.eave;
  for (const sz of [1, -1]) S.atlas.box(0, eave - 0.2, sz * (hz + 0.55), w + 1.1, 0.18, 0.06, C(0x5a4030), { reg: REG.wood }); // fascia boards
  const group = finish(S);
  return { group, update() {}, size: { w: w + 1.5, d: d + 3.6, h: ridge } };
}

// ============================================================================ COLONIAL (Ranikhet cantonment)
/** createColonialBuilding({ seed }) — stone / lime-washed bungalow with verandah, steep red/green tin roof, chimneys */
export function createColonialBuilding({ seed = 1 } = {}) {
  const r = makeRng(seed * 7717 + 5);
  const S = makeSet();
  const w = r.range(13, 18), d = r.range(8.5, 10.5), storeys = r() < 0.35 ? 2 : 1, sh = 4.0, H = sh * storeys, hz = d / 2;
  const stone = r() < 0.55;
  const wallB = stone ? S.stone : S.plaster, wallC = stone ? C(0xf4f4f0) : C(r.pick([0xf6f3ea, 0xefe8d6, 0xf2ece2]));
  const white = C(0xf4f2ec), roofC = C(r.pick([0xa83226, 0x9a2a20, 0x2f5a3a, 0x3a6a46]));
  S.stone.box(0, -0.2, 0, w + 0.6, 0.7, d + 3.4, C(0xb8b4ac), { uOff: 0 });
  wallB.box(0, 0.5, 0, w, H - 0.5, d, wallC);
  if (storeys === 2) S.plaster.box(0, sh - 0.1, 0, w + 0.1, 0.2, d + 0.1, white);
  // verandah: floor, posts, railing, lean-to roof
  const vd = 2.6, vz = hz + vd / 2;
  const nPost = Math.max(4, Math.round(w / 2.6));
  for (let k = 0; k <= nPost; k++) {
    const xx = -w / 2 + k * w / nPost;
    S.atlas.box(xx, 0.5, hz + vd - 0.15, 0.2, 3.2, 0.2, white, { reg: REG.white });
    if (k < nPost && k !== Math.floor(nPost / 2)) S.atlas.box(xx + w / nPost / 2, 1.3, hz + vd - 0.15, w / nPost - 0.2, 0.08, 0.08, white, { reg: REG.white });
    if (k < nPost && k !== Math.floor(nPost / 2)) for (let q = 1; q < 6; q++) S.atlas.box(xx + q * w / nPost / 6, 0.5, hz + vd - 0.15, 0.04, 0.8, 0.04, white, { reg: REG.white });
  }
  S.tin.quadM([-w / 2 - 0.3, 3.6, hz + vd + 0.3], [w / 2 + 0.3, 3.6, hz + vd + 0.3], [w / 2 + 0.3, 4.15, hz], [-w / 2 - 0.3, 4.15, hz], roofC);
  S.tin.quadM([w / 2 + 0.3, 3.57, hz + vd + 0.3], [-w / 2 - 0.3, 3.57, hz + vd + 0.3], [-w / 2 - 0.3, 4.12, hz], [w / 2 + 0.3, 4.12, hz], shade(roofC, 0.5));
  S.atlas.box(0, 3.5, hz + vd + 0.3, w + 0.6, 0.14, 0.06, white, { reg: REG.white });
  // facade windows & doors (ground + upper)
  const nBay = Math.max(3, Math.round(w / 2.8));
  for (let f = 0; f < storeys; f++) for (let k = 0; k < nBay; k++) {
    const xx = -w / 2 + (k + 0.5) * w / nBay, y0 = 0.5 + f * sh;
    if (f === 0 && k === Math.floor(nBay / 2)) S.atlas.decal(xx, y0, hz + 0.02, 1.5, 2.6, REG.doorColonial);
    else S.atlas.decal(xx, y0 + 0.75, hz + 0.02, 1.15, 1.9, REG.winColonial);
  }
  for (const sxx of [-1, 1]) for (let f = 0; f < storeys; f++) for (let k = 0; k < 2; k++) {
    const xw = sxx * (w / 2 + 0.02), y = 1.25 + f * sh, zc = -d / 4 + k * d / 2;
    const P = sxx > 0 ? [[xw, y, zc + 0.57], [xw, y, zc - 0.57], [xw, y + 1.9, zc - 0.57], [xw, y + 1.9, zc + 0.57]] : [[xw, y, zc - 0.57], [xw, y, zc + 0.57], [xw, y + 1.9, zc + 0.57], [xw, y + 1.9, zc - 0.57]];
    S.atlas.quadR(P[0], P[1], P[2], P[3], REG.winColonial);
  }
  // main roof: hipped, steep tin + gabled porch over the entrance
  const rh = d * 0.42;
  const top = hipRoof(S.tin, 0, H, 0, w, d, rh, 0.45, roofC);
  S.plaster.box(0, H - 0.25, 0, w + 0.9, 0.22, d + 0.9, white, { skip: { top: true } });
  // chimneys
  for (const sx of [-1, 1]) {
    const cx = sx * w * 0.28;
    wallB.box(cx, H, -d * 0.12, 0.7, rh + 1.3, 0.7, stone ? wallC : C(0xd8d2c6));
    S.plaster.box(cx, H + rh + 1.3, -d * 0.12, 0.9, 0.18, 0.9, C(0x8a8478));
  }
  const group = finish(S);
  return { group, update() {}, size: { w: w + 0.9, d: d + 3.4, h: top + 1.5 } };
}

// ============================================================================ CHURCH
/** createChurch() — old stone church (Ranikhet): nave, steep roof, stained-glass windows, bell tower with spire */
export function createChurch() {
  const S = makeSet();
  const w = 9, L = 18, H = 6.5, stone = C(0xe2ded6), roof = C(0x5a5e62);
  // nave along Z, entrance (tower) at +Z
  S.stone.box(0, -0.3, -1, w + 0.6, 0.6, L + 0.6, C(0xbab6ae), { uOff: 0 });
  S.stone.box(0, 0.3, -1, w, H - 0.3, L, stone);
  // steep gable roof with ridge along Z
  const hw = w / 2 + 0.4, yr = H + Math.tan(0.85) * w / 2, z0 = -1 - L / 2 - 0.4, z1 = -1 + L / 2 + 0.2;
  S.slate.quadM([hw, H - 0.3, z1], [hw, H - 0.3, z0], [0, yr, z0], [0, yr, z1], roof);
  S.slate.quadM([-hw, H - 0.3, z0], [-hw, H - 0.3, z1], [0, yr, z1], [0, yr, z0], roof);
  S.stone.tri([-w / 2, H, -1 - L / 2], [w / 2, H, -1 - L / 2], [0, yr, -1 - L / 2], [[0, 0], [w / 2.4, 0], [w / 4.8, (yr - H) / 2.4]], stone); // back gable (faces -Z)
  S.stone.tri([w / 2, H, -1 + L / 2], [-w / 2, H, -1 + L / 2], [0, yr, -1 + L / 2], [[0, 0], [w / 2.4, 0], [w / 4.8, (yr - H) / 2.4]], stone);
  // stained glass windows along both sides, buttresses
  for (let k = 0; k < 5; k++) {
    const z = -1 - L / 2 + 2 + k * (L - 4) / 4;
    for (const sx of [-1, 1]) {
      const xw = sx * (w / 2 + 0.02);
      const P = sx > 0 ? [[xw, 1.8, z + 0.55], [xw, 1.8, z - 0.55], [xw, 4.6, z - 0.55], [xw, 4.6, z + 0.55]] : [[xw, 1.8, z - 0.55], [xw, 1.8, z + 0.55], [xw, 4.6, z + 0.55], [xw, 4.6, z - 0.55]];
      S.atlas.quadR(P[0], P[1], P[2], P[3], REG.winStained);
      if (k < 4) S.stone.box(sx * (w / 2 + 0.25), 0.3, z + (L - 4) / 8, 0.5, 4.2, 0.6, stone, { uOff: k });
    }
  }
  // rear window
  S.atlas.decal(0, 2.0, -1 - L / 2 - 0.02, 1.4, 3.0, REG.winStained, [1, 1, 1], Math.PI);
  // bell tower at the front
  const tz = -1 + L / 2 + 1.7, ts = 3.8, th = 14.5;
  S.stone.box(0, 0.3, tz, ts, th - 0.3, ts, stone);
  S.stone.box(0, th - 3.8, tz, ts + 0.3, 0.3, ts + 0.3, C(0xcfcbc3));
  S.stone.box(0, th, tz, ts + 0.3, 0.4, ts + 0.3, C(0xcfcbc3));
  S.atlas.decal(0, 0.3, tz + ts / 2 + 0.02, 1.6, 2.9, REG.doorWood, C(0xc8a080));
  S.atlas.decal(0, 4.2, tz + ts / 2 + 0.02, 1.0, 2.2, REG.winStained);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, n = [Math.sin(a), Math.cos(a)];
    const c = [n[0] * (ts / 2 + 0.02), n[1] * (ts / 2 + 0.02)], t = [n[1], -n[0]];
    const y0 = th - 3.3, y1 = th - 0.4, hw2 = 0.8;
    S.atlas.quadR([c[0] - t[0] * hw2, y0, tz + c[1] - t[1] * hw2], [c[0] + t[0] * hw2, y0, tz + c[1] + t[1] * hw2], [c[0] + t[0] * hw2, y1, tz + c[1] + t[1] * hw2], [c[0] - t[0] * hw2, y1, tz + c[1] - t[1] * hw2], REG.belfry);
  }
  // pyramidal spire + cross
  const sy = th + 0.4, sp = 7.5, sh = ts / 2 + 0.1, apex = [0, sy + sp, tz];
  const B = [[-sh, sy, tz + sh], [sh, sy, tz + sh], [sh, sy, tz - sh], [-sh, sy, tz - sh]];
  for (let k = 0; k < 4; k++) S.slate.tri(B[k], B[(k + 1) % 4], apex, [[0, 0], [ts / 2, 0], [ts / 4, sp / 2]], roof);
  S.atlas.box(0, sy + sp, tz, 0.12, 1.5, 0.12, C(0xe8e0c8), { reg: REG.white });
  S.atlas.box(0, sy + sp + 0.9, tz, 0.8, 0.12, 0.12, C(0xe8e0c8), { reg: REG.white });
  const group = finish(S);
  return { group, update() {}, size: { w: w + 1.2, d: L + ts + 1, h: sy + sp + 1.6 } };
}

// ============================================================================ TEMPLES
/** curvilinear Nagara shikhara (ribbed) — appended to builder */
function shikhara(B, cx, y0, cz, r0, h, col, band, seg = 12) {
  const prof = [[1.0, 0], [0.97, 0.18], [0.88, 0.4], [0.72, 0.62], [0.52, 0.8], [0.32, 0.93], [0.18, 1.0]];
  for (let k = 0; k < prof.length - 1; k++) {
    const [ra, ya] = prof[k], [rb, yb] = prof[k + 1];
    const c = k % 2 ? band : col;
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const rib0 = i % 2 ? 0.92 : 1, rib1 = (i + 1) % 2 ? 0.92 : 1;
      const P = (a, rr, rib, yy) => [cx + Math.sin(a) * rr * r0 * rib, y0 + yy * h, cz + Math.cos(a) * rr * r0 * rib];
      B.quadM(P(a0, ra, rib0, ya), P(a1, ra, rib1, ya), P(a1, rb, rib1, yb), P(a0, rb, rib0, yb), c);
    }
  }
  // amalaka + kalash
  B.cyl(cx, y0 + h, cz, r0 * 0.3, h * 0.07, 10, col);
  return y0 + h * 1.07;
}

/** animated flags (triangular pennants) sharing one geometry; returns { mesh, update } */
function makeFlags(list) {
  // list: [{ base:[x,y,z], dir:[dx,dz] (unit, horizontal), len, hgt, color }]
  const pos = [], col = [], base = [], meta = [], idx = [];
  list.forEach((f, fi) => {
    const small = f.len < 0.6, cu = small ? 2 : 4, cv = 1;
    const c = new THREE.Color(f.color);
    const start = pos.length / 3;
    for (let j = 0; j <= cv; j++) for (let i = 0; i <= cu; i++) {
      const u = i / cu, v = j / cv;
      const taper = 1 - u;                                  // triangle
      const y = f.base[1] - f.hgt * (0.5 + (v - 0.5) * taper);
      const x = f.base[0] + f.dir[0] * f.len * u, z = f.base[2] + f.dir[1] * f.len * u;
      pos.push(x, y, z); base.push(x, y, z); col.push(c.r, c.g, c.b); meta.push(u, fi * 1.7, -f.dir[1], f.dir[0]);
    }
    for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++) {
      const a = start + j * (cu + 1) + i, b = a + 1, c2 = a + cu + 1, d = c2 + 1;
      idx.push(a, b, d, a, d, c2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, flagMaterial()); m.castShadow = false; m.name = 'flags';
  const P = g.attributes.position;
  let acc = 0;
  return {
    mesh: m,
    update(dt, t) {
      acc += dt; if (acc < 1 / 30) return; acc = 0;               // 30 Hz is plenty for cloth
      for (let i = 0; i < P.count; i++) {
        const u = meta[i * 4], ph = meta[i * 4 + 1], nx = meta[i * 4 + 2], nz = meta[i * 4 + 3];
        const w = Math.sin(t * 7 - u * 5 + ph) * 0.12 * u + Math.sin(t * 13 - u * 9 + ph) * 0.03 * u;
        P.setXYZ(i, base[i * 3] + nx * w, base[i * 3 + 1] + Math.sin(t * 5 + u * 4 + ph) * 0.03 * u, base[i * 3 + 2] + nz * w);
      }
      P.needsUpdate = true; g.computeVertexNormals();
    },
  };
}
let FLAG_MAT = null;
function flagMaterial() { if (!FLAG_MAT) { FLAG_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }); FLAG_MAT.name = 'bld_flags'; } return FLAG_MAT; }

/**
 * createTemple({ style:'small'|'garjiya', bridgeLength=14 })
 *  small   : roadside shrine (white / saffron shikhara, red flag, bell)            ~2.6 x 2.6 m
 *  garjiya : Garjiya Devi temple atop an ~18 m rock pillar rising from the river bed (y = 0 = river bed),
 *            helical stairs with red/white railings, canopy with bells, many flags; optional footbridge toward +Z.
 */
export function createTemple({ style = 'small', bridgeLength = 14 } = {}) {
  return style === 'garjiya' ? garjiya(bridgeLength) : smallTemple();
}

function smallTemple() {
  const S = makeSet();
  const white = C(0xf6f2ea), saffron = C(0xf08a24), red = C(0xc0281e), gold = C(0xd8a830);
  S.plaster.box(0, 0, 0, 2.6, 0.5, 2.6, C(0xe8e2d6));
  S.plaster.box(0, 0, 1.55, 1.4, 0.25, 0.5, C(0xd8d2c6));
  S.plaster.box(0, 0.5, 0, 1.8, 1.9, 1.8, white);
  S.plaster.box(0, 1.75, 0, 1.9, 0.18, 1.9, saffron);
  S.atlas.decal(0, 0.5, 0.92, 0.95, 1.25, REG.templeDoor);
  const top = shikhara(S.plaster, 0, 2.4, 0, 0.95, 2.1, white, saffron, 12);
  S.atlas.cyl(0, top, 0, 0.12, 0.3, 8, gold, { reg: REG.white, rTop: 0.02 });
  // flag pole + bell + trishul
  S.atlas.beam([0.75, 0.5, -0.75], [0.75, 6.0, -0.75], 0.05, C(0x8a6a4a));
  S.atlas.beam([-0.6, 2.25, 1.15], [0.6, 2.25, 1.15], 0.04, C(0x6a5a4a));
  S.atlas.cyl(0, 1.95, 1.15, 0.11, 0.22, 8, gold, { reg: REG.white, rTop: 0.03 });
  S.atlas.beam([-1.1, 0.5, 1.1], [-1.1, 2.4, 1.1], 0.04, C(0x555555));
  S.atlas.beam([-1.3, 2.2, 1.1], [-0.9, 2.2, 1.1], 0.035, C(0x555555));
  for (const dx of [-0.2, 0, 0.2]) S.atlas.beam([-1.1 + dx, 2.2, 1.1], [-1.1 + dx, 2.5 + (dx ? 0 : 0.1), 1.1], 0.03, C(0x555555));
  const flags = makeFlags([{ base: [0.77, 5.95, -0.75], dir: [0.8, 0.6], len: 1.2, hgt: 0.7, color: 0xff6a00 }, { base: [0.77, 5.2, -0.75], dir: [0.6, 0.8], len: 0.9, hgt: 0.5, color: 0xd81e1e }]);
  const group = finish(S, [flags.mesh]);
  return { group, update: (dt, t) => flags.update(dt, t), size: { w: 2.6, d: 2.6, h: 6 } };
}

function garjiya(bridgeLength) {
  const S = makeSet();
  const H = 18, seg = 16, rows = 8;
  // rock radius function (shared by rock mesh and stairs)
  const prof = y => { const t = y / H; return lerp(7.6, 4.6, Math.pow(t, 0.8)) + Math.sin(t * Math.PI) * 0.6; };
  const rad = (a, y) => prof(y) * (1 + (pnoise2(a / (Math.PI * 2) * 6, y / H * 3, 6, 71) - 0.5) * 0.28);
  // rock body
  const ring = [];
  for (let j = 0; j <= rows; j++) {
    const y = j / rows * H, row = [];
    for (let i = 0; i <= seg; i++) { const a = (i % seg) / seg * Math.PI * 2, rr = rad(a, y); row.push([Math.sin(a) * rr, y, Math.cos(a) * rr]); }
    ring.push(row);
  }
  const vcol = (i, j) => {                                              // per-vertex colour so patches blend
    const t = j / rows, n = pnoise2((i % seg) * 0.55, j * 0.8, seg * 0.55, 3), g = pnoise2((i % seg) * 0.9 + 7, j * 1.3, seg * 0.9, 8);
    let c = C(0xc9b89c, lerp(0.7, 1.0, n));
    const green = smoothstep(0.45, 0.8, t) * smoothstep(0.5, 0.75, g);   // shrubs on upper ledges
    c = [lerp(c[0], 0.09, green), lerp(c[1], 0.14, green), lerp(c[2], 0.04, green)];
    const wet = 1 - smoothstep(0.0, 0.16, t);
    return shade(c, lerp(1, 0.62, wet));
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
    const a = ring[j][i], b = ring[j][i + 1], cc = ring[j + 1][i + 1], d = ring[j + 1][i];
    const U = k => k / seg * 8, Vv = k => k / rows * 5;
    const n = MB.nrm(a, b, cc);
    const i0 = S.rock._v(a, n, [U(i), Vv(j)], vcol(i, j)), i1 = S.rock._v(b, n, [U(i + 1), Vv(j)], vcol(i + 1, j));
    const i2 = S.rock._v(cc, n, [U(i + 1), Vv(j + 1)], vcol(i + 1, j + 1)), i3 = S.rock._v(d, n, [U(i), Vv(j + 1)], vcol(i, j + 1));
    S.rock.idx.push(i0, i1, i2, i0, i2, i3);
  }
  // top platform
  const topR = prof(H) * 0.95;
  S.plaster.cyl(0, H, 0, topR, 0.4, 14, C(0xe6dfd2), { caps: true });
  // base platform in the river
  S.plaster.cyl(0, 0, 0, 9.4, 1.3, 16, C(0xb8b2a6));
  // helical stairs around the rock: one full turn from the front (+Z) climbing to the top
  const steps = 48, rise = (H + 0.4 - 1.3) / steps, a0 = 0.35, turn = Math.PI * 2 * 0.98;
  const rail = [], white = C(0xf2f2f2), red = C(0xc8201e);
  for (let k = 0; k < steps; k++) {
    const t = k / steps, a = a0 + t * turn, y = 1.3 + k * rise;
    const rr = rad(a, y) + 0.75;
    const cx = Math.sin(a) * rr, cz = Math.cos(a) * rr;
    S.plaster.box(cx, y - 0.15, cz, 1.7, rise + 0.15, 1.0, C(0xd8d2c6), { rotY: a + Math.PI / 2, skip: { bottom: true, right: true } });
    if (k % 3 === 0 || k === steps - 1) { const ro = rr + 0.85; rail.push([Math.sin(a) * ro, y + rise, Math.cos(a) * ro]); }
  }
  for (let k = 0; k < rail.length; k++) {
    const p = rail[k];
    S.atlas.beam([p[0], p[1], p[2]], [p[0], p[1] + 1.0, p[2]], 0.06, k % 2 ? red : white);
    if (k > 0) { const q = rail[k - 1]; S.atlas.beam([q[0], q[1] + 1.0, q[2]], [p[0], p[1] + 1.0, p[2]], 0.05, C(0xe8c020)); }
  }
  // top: railing ring, temple, canopy with bells
  const ty = H + 0.4;
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * Math.PI * 2, b = (k + 1) / 14 * Math.PI * 2, rr = topR - 0.15;
    if (Math.abs(((a - (a0 + turn)) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.35) continue; // stair opening
    S.atlas.beam([Math.sin(a) * rr, ty, Math.cos(a) * rr], [Math.sin(a) * rr, ty + 1.0, Math.cos(a) * rr], 0.07, k % 2 ? red : white);
    S.atlas.beam([Math.sin(a) * rr, ty + 1.0, Math.cos(a) * rr], [Math.sin(b) * rr, ty + 1.0, Math.cos(b) * rr], 0.06, C(0xe8c020));
  }
  const tw = C(0xf8f2e6), tr = C(0xd8401e), saffron = C(0xf08a24), gold = C(0xd8a830);
  S.plaster.box(0, ty, -0.6, 2.6, 0.4, 2.6, C(0xe0d8c8));
  S.plaster.box(0, ty + 0.4, -0.6, 2.2, 2.2, 2.2, tw);
  S.atlas.decal(0, ty + 0.4, 0.52, 1.1, 1.5, REG.templeDoor);
  const top = shikhara(S.plaster, 0, ty + 2.6, -0.6, 1.15, 2.8, tr, saffron, 12);
  S.atlas.cyl(0, top, -0.6, 0.14, 0.4, 8, gold, { reg: REG.white, rTop: 0.02 });
  // canopy (red tin) on 4 posts in front of the sanctum, with hanging bells
  const cz0 = 1.2, cw = 3.6, cd = 2.6;
  for (const [px, pz] of [[-cw / 2, cz0 - cd / 2], [cw / 2, cz0 - cd / 2], [-cw / 2, cz0 + cd / 2], [cw / 2, cz0 + cd / 2]]) S.atlas.beam([px, ty, pz], [px, ty + 2.7, pz], 0.1, C(0xb02a1a));
  S.tin.quadM([-cw / 2 - 0.2, ty + 2.6, cz0 + cd / 2 + 0.2], [cw / 2 + 0.2, ty + 2.6, cz0 + cd / 2 + 0.2], [cw / 2 + 0.2, ty + 3.1, cz0 - cd / 2 - 0.2], [-cw / 2 - 0.2, ty + 3.1, cz0 - cd / 2 - 0.2], C(0xc0281e));
  S.tin.quadM([cw / 2 + 0.2, ty + 2.58, cz0 + cd / 2 + 0.2], [-cw / 2 - 0.2, ty + 2.58, cz0 + cd / 2 + 0.2], [-cw / 2 - 0.2, ty + 3.08, cz0 - cd / 2 - 0.2], [cw / 2 + 0.2, ty + 3.08, cz0 - cd / 2 - 0.2], C(0x601410));
  for (let k = 0; k < 7; k++) { const bx = -cw / 2 + 0.3 + k * (cw - 0.6) / 6; S.atlas.beam([bx, ty + 2.6, cz0 + cd / 2], [bx, ty + 2.25, cz0 + cd / 2], 0.02, C(0x444444)); S.atlas.cyl(bx, ty + 2.05, cz0 + cd / 2, 0.1, 0.22, 6, gold, { reg: REG.white, rTop: 0.03, caps: false }); }
  // optional footbridge toward +Z (to the river bank)
  if (bridgeLength > 0) {
    const bz0 = 9.0, by = 2.4;
    S.plaster.box(0, by - 0.25, bz0 + bridgeLength / 2, 2.2, 0.25, bridgeLength, C(0xc8c2b6));
    for (let k = 0; k <= Math.round(bridgeLength / 3); k++) for (const sx of [-1.05, 1.05]) {
      const z = bz0 + Math.min(bridgeLength, k * 3); S.atlas.beam([sx, by, z], [sx, by + 1.0, z], 0.06, k % 2 ? red : white);
    }
    for (const sx of [-1.05, 1.05]) S.atlas.beam([sx, by + 1.0, bz0], [sx, by + 1.0, bz0 + bridgeLength], 0.06, C(0xe8c020));
    for (let k = 0; k < Math.max(1, Math.round(bridgeLength / 6)); k++) S.plaster.box(0, 0, bz0 + 3 + k * 6, 1.0, by - 0.25, 1.0, C(0xa8a296));
    S.plaster.box(0, 1.3, 8.4, 2.2, by - 1.55, 1.4, C(0xb8b2a6));
  }
  // flags: on poles around the top + a few big ones on the shikhara
  const fl = [];
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + 0.2, rr = topR - 0.3;
    const px = Math.sin(a) * rr, pz = Math.cos(a) * rr;
    S.atlas.beam([px, ty, pz], [px, ty + 3.4, pz], 0.05, C(0x8a6a4a));
    fl.push({ base: [px, ty + 3.35, pz], dir: [Math.cos(0.5), Math.sin(0.5)], len: 1.1, hgt: 0.65, color: k % 3 === 0 ? 0xd81e1e : (k % 3 === 1 ? 0xff7a00 : 0xffc400) });
  }
  S.atlas.beam([0, top + 0.3, -0.6], [0, top + 2.2, -0.6], 0.05, C(0x8a6a4a));
  fl.push({ base: [0, top + 2.15, -0.6], dir: [Math.cos(0.5), Math.sin(0.5)], len: 1.6, hgt: 0.9, color: 0xff5a00 });
  // bunting strings from the shikhara top to the railing
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + 0.5, rr = topR - 0.2;
    const p0 = [0, top + 0.2, -0.6], p1 = [Math.sin(a) * rr, ty + 1.0, Math.cos(a) * rr];
    S.atlas.beam(p0, p1, 0.015, C(0x666666));
    for (let q = 1; q < 6; q++) {
      const f = q / 6, p = [lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f) - Math.sin(f * Math.PI) * 0.3, lerp(p0[2], p1[2], f)];
      const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1;
      fl.push({ base: p, dir: [-dz / l, dx / l], len: 0.32, hgt: 0.3, color: [0xd81e1e, 0xffc400, 0xff7a00, 0x2a8a3a, 0x1f5fd0][(k + q) % 5] });
    }
  }
  const flags = makeFlags(fl);
  const group = finish(S, [flags.mesh]);
  return { group, update: (dt, t) => flags.update(dt, t), size: { w: 19, d: 19 + Math.max(0, bridgeLength), h: top + 2.5 } };
}

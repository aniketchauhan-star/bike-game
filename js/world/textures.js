// Procedural textures for terrain, road and water (canvas generated at load time, cached).
import * as THREE from 'three';
import { createNoise2D, fbm, mulberry32, clamp, canvasTexture } from '../core/util.js';

const cache = new Map();
function cached(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

/** periodic gradient noise (seamless with integer period) */
const periodic = new WeakMap(); let pSeed = 1;
function periodicFor(noiseFn) {
  let p = periodic.get(noiseFn); if (p) return p;
  const rnd = mulberry32(pSeed++ * 7919);
  const perm = new Uint16Array(512); const base = []; for (let i = 0; i < 256; i++) base.push(i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  p = (x, y, period) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const w = v => ((v % period) + period) % period;
    const h = (i, j) => perm[perm[w(i) & 255] + (w(j) & 255)] & 255;
    const g00 = h(xi, yi), g10 = h(xi + 1, yi), g01 = h(xi, yi + 1), g11 = h(xi + 1, yi + 1);
    const d00 = gx[g00] * xf + gy[g00] * yf, d10 = gx[g10] * (xf - 1) + gy[g10] * yf;
    const d01 = gx[g01] * xf + gy[g01] * (yf - 1), d11 = gx[g11] * (xf - 1) + gy[g11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    return ((d00 + (d10 - d00) * u) + ((d01 + (d11 - d01) * u) - (d00 + (d10 - d00) * u)) * v) * 1.45;
  };
  periodic.set(noiseFn, p);
  return p;
}
/** tileable fbm in [-1,1]-ish over a size×size texture; freq = integer cells across the texture */
function tileNoise(noise, x, y, size, freq, oct = 4) {
  const pn = periodicFor(noise); freq = Math.max(1, Math.round(freq));
  let s = 0, amp = 1, n = 0, f = freq;
  for (let o = 0; o < oct; o++) { s += amp * pn((x / size) * f, (y / size) * f, f); n += amp; amp *= 0.5; f *= 2; }
  return s / n;
}

function imageFrom(size, fn, seed) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size); const d = img.data;
  const rnd = mulberry32(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const col = fn(x, y, rnd); const i = (y * size + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = col[3] ?? 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, ctx };
}

function toTex(canvas, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
  return t;
}

/** normal map from a height function (tileable) */
function normalFromHeights(size, h, strength = 2) {
  const { canvas } = imageFrom(size, (x, y) => {
    const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
    const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
    let nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    return [(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255];
  }, 1);
  return toTex(canvas, { srgb: false });
}

export function grassTexture(size = 512) {
  return cached('grass' + size, () => {
    const n = createNoise2D(11), n2 = createNoise2D(12);
    const { canvas, ctx } = imageFrom(size, (x, y, r) => {
      const a = tileNoise(n, x, y, size, 6, 4), b = tileNoise(n2, x, y, size, 24, 3);
      const v = 0.75 + a * 0.25 + b * 0.18 + (r() - 0.5) * 0.22;
      const dry = clamp(0.5 + tileNoise(n2, x + 99, y, size, 3, 2) * 1.2, 0, 1);
      const R = (62 + dry * 52) * v, G = (96 + dry * 30) * v, B = (36 + dry * 10) * v;
      return [R, G, B];
    }, 13);
    // grass blade strokes
    const rnd = mulberry32(5);
    for (let i = 0; i < size * 9; i++) {
      const x = rnd() * size, y = rnd() * size, l = 2 + rnd() * 6, ang = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
      const g = 70 + rnd() * 80;
      ctx.strokeStyle = `rgba(${g * 0.6 | 0},${g | 0},${g * 0.35 | 0},${0.25 + rnd() * 0.35})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); ctx.stroke();
    }
    return toTex(canvas);
  });
}

export function dirtTexture(size = 512) {
  return cached('dirt' + size, () => {
    const n = createNoise2D(21), n2 = createNoise2D(22);
    const { canvas, ctx } = imageFrom(size, (x, y, r) => {
      const a = tileNoise(n, x, y, size, 5, 4), b = tileNoise(n2, x, y, size, 32, 2);
      const v = 0.8 + a * 0.22 + b * 0.12 + (r() - 0.5) * 0.18;
      return [128 * v, 104 * v, 78 * v];
    }, 23);
    const rnd = mulberry32(9);
    for (let i = 0; i < size * 1.6; i++) { // pebbles
      const x = rnd() * size, y = rnd() * size, rad = 0.8 + rnd() * 2.6, g = 90 + rnd() * 90;
      ctx.fillStyle = `rgba(${g | 0},${g * 0.92 | 0},${g * 0.85 | 0},0.8)`;
      ctx.beginPath(); ctx.ellipse(x, y, rad, rad * (0.6 + rnd() * 0.4), rnd() * 3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + 0.6, y + 0.8, rad, rad * 0.6, 0, 0, 7); ctx.fill();
    }
    return toTex(canvas);
  });
}

export function rockTexture(size = 512) {
  return cached('rock' + size, () => {
    const n = createNoise2D(31), n2 = createNoise2D(32), n3 = createNoise2D(33);
    const { canvas } = imageFrom(size, (x, y, r) => {
      const a = tileNoise(n, x, y, size, 4, 5);
      const strata = Math.sin((y / size) * Math.PI * 2 * 9 + tileNoise(n2, x, y, size, 3, 3) * 6) * 0.5 + 0.5;
      const crack = Math.abs(tileNoise(n3, x, y, size, 10, 3)); const c = crack < 0.04 ? 0.55 : 1;
      const v = (0.62 + a * 0.3 + strata * 0.12 + (r() - 0.5) * 0.1) * c;
      return [118 * v, 112 * v, 104 * v];
    }, 34);
    return toTex(canvas);
  });
}

export function forestFloorTexture(size = 512) {
  return cached('floor' + size, () => {
    const n = createNoise2D(41);
    const { canvas, ctx } = imageFrom(size, (x, y, r) => {
      const a = tileNoise(n, x, y, size, 7, 4); const v = 0.7 + a * 0.3 + (r() - 0.5) * 0.2;
      return [96 * v, 76 * v, 48 * v];
    }, 42);
    const rnd = mulberry32(43);
    for (let i = 0; i < size * 5; i++) { // dry leaves / pine needles
      const x = rnd() * size, y = rnd() * size, l = 2 + rnd() * 5, ang = rnd() * Math.PI;
      const t = rnd(); const col = t < 0.5 ? [150, 96, 48] : t < 0.8 ? [118, 84, 44] : [96, 104, 52];
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.35 + rnd() * 0.4})`; ctx.lineWidth = 1 + rnd() * 1.4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); ctx.stroke();
    }
    return toTex(canvas);
  });
}

/** low-frequency macro variation (grey), used to break tiling */
export function macroTexture(size = 256) {
  return cached('macro' + size, () => {
    const n = createNoise2D(51);
    const { canvas } = imageFrom(size, (x, y) => { const v = 128 + tileNoise(n, x, y, size, 4, 5) * 110; return [v, v, v]; }, 1);
    return toTex(canvas, { srgb: false });
  });
}

export function terrainNormalTexture(size = 256) {
  return cached('tnorm' + size, () => {
    const n = createNoise2D(61); const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = tileNoise(n, x, y, size, 12, 4);
    return normalFromHeights(size, h, 3.5);
  });
}

/**
 * Asphalt road texture. u: across road (0 = left edge of asphalt, 1 = right edge). v: along road (1 tile = 12 m).
 * Markings: white solid edge lines, white dashed centre line.
 */
export function roadTextures(kind = 'hill') {
  return cached('road' + kind, () => {
    const W = 512, H = 1024;
    const n = createNoise2D(71), n2 = createNoise2D(72);
    const height = new Float32Array(W * H);
    const { canvas, ctx } = (() => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
      const img = ctx.createImageData(W, H); const d = img.data; const rnd = mulberry32(73);
      const B = 160; // seamless wrap along v: blend first rows with the continuation past H
      const bigRaw = (x, y) => n(x / 90, y / 90) * 0.5 + n(x / 30, y / 30) * 0.3;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const big = y < B ? bigRaw(x, y + H) + (bigRaw(x, y) - bigRaw(x, y + H)) * (y / B) : bigRaw(x, y);
        const agg = rnd();
        // tyre wear lanes (darker/smoother) around 25% and 75% across
        const lane = Math.exp(-(((x / W) - 0.28) ** 2) / 0.004) + Math.exp(-(((x / W) - 0.72) ** 2) / 0.004);
        let v = 0.36 + big * 0.06 + (agg - 0.5) * 0.16 - lane * 0.05;
        if (agg > 0.985) v += 0.18; // light stones
        // edge wear near shoulders
        const ex = Math.min(x / W, 1 - x / W); if (ex < 0.03) v += (0.03 - ex) * 2.2 * (0.5 + n2(x / 8, y / 8) * 0.5);
        const i = (y * W + x) * 4; const g = v * 255;
        d[i] = g * 0.98; d[i + 1] = g * 0.97; d[i + 2] = g * 0.95; d[i + 3] = 255;
        height[y * W + x] = agg * 0.6 + big * 0.4;
      }
      ctx.putImageData(img, 0, 0);
      return { canvas: c, ctx };
    })();
    // patches (repaired asphalt, irregular & subtle) + cracks
    const rnd = mulberry32(74);
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.2 + rnd() * 0.6), cy = 200 + rnd() * (H - 400), rx = 25 + rnd() * 50, ry = 30 + rnd() * 90;
      ctx.fillStyle = `rgba(${30 + rnd() * 15},${30 + rnd() * 15},${32 + rnd() * 15},${0.16 + rnd() * 0.12})`;
      ctx.beginPath();
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, rr = 0.75 + rnd() * 0.35; const px = cx + Math.cos(a) * rx * rr, py = cy + Math.sin(a) * ry * rr; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(15,15,15,0.55)'; ctx.lineWidth = 1.3;
    for (let i = 0; i < 14; i++) {
      let x = rnd() * W, y = rnd() * H; ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 30; y += rnd() * 26; ctx.lineTo(x, y); } ctx.stroke();
    }
    // markings (slightly worn)
    const paint = (x, y, w, h) => {
      for (let yy = y; yy < y + h; yy += 2) {
        const a = 0.75 + n2(x / 20, yy / 20) * 0.2 - (rnd() < 0.04 ? 0.5 : 0);
        ctx.fillStyle = `rgba(236,234,226,${clamp(a, 0.2, 0.95)})`; ctx.fillRect(x, yy, w, 2);
      }
    };
    paint(14, 0, 12, H);          // left edge line
    paint(W - 26, 0, 12, H);      // right edge line
    for (let y = 0; y < H; y += 512) paint(W / 2 - 6, y + 60, 12, 256); // dashed centre (3 m dash, 3 m gap @ 12 m tile)
    const map = toTex(canvas); map.wrapS = THREE.ClampToEdgeWrapping;
    const normal = normalFromHeights(W, height.subarray(0, W * W), 1.2); // square crop is fine for tiling detail
    // roughness: markings smoother, worn lanes smoother
    return { map, normal };
  });
}

export function shoulderTexture() {
  return cached('shoulder', () => {
    const size = 256; const n = createNoise2D(81);
    const { canvas, ctx } = imageFrom(size, (x, y, r) => {
      const a = tileNoise(n, x, y, size, 8, 3); const v = 0.7 + a * 0.2 + (r() - 0.5) * 0.35;
      return [120 * v, 108 * v, 92 * v];
    }, 82);
    const rnd = mulberry32(83);
    for (let i = 0; i < 900; i++) { const g = 70 + rnd() * 120; ctx.fillStyle = `rgb(${g},${g * 0.95},${g * 0.9})`; ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2); }
    return toTex(canvas);
  });
}

/** tileable water normal map */
export function waterNormalTexture(size = 256) {
  return cached('wnorm' + size, () => {
    const n = createNoise2D(91), n2 = createNoise2D(92); const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = tileNoise(n, x, y, size, 6, 4) * 0.7 + tileNoise(n2, x, y, size, 18, 2) * 0.3;
    return normalFromHeights(size, h, 6);
  });
}

/** foam / streak texture (grey, tileable) */
export function foamTexture(size = 256) {
  return cached('foam' + size, () => {
    const n = createNoise2D(95);
    const { canvas } = imageFrom(size, (x, y) => {
      const a = tileNoise(n, x, y * 0.35, size, 9, 4); const v = clamp((a + 0.15) * 2.6, 0, 1) * 255;
      return [v, v, v];
    }, 1);
    return toTex(canvas, { srgb: false });
  });
}

export function cloudSpriteTexture() {
  return cached('cloudsprite', () => canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: false }));
}

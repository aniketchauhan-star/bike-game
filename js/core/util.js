// Shared helpers used by every module (math, seeded random, noise, canvas textures, geometry baking).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

// ------------------------------------------------------------------ math
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** frame-rate independent exponential smoothing toward target */
export const damp = (cur, target, lambda, dt) => lerp(cur, target, 1 - Math.exp(-lambda * dt));
export const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export const DEG = Math.PI / 180;

// ------------------------------------------------------------------ seeded random
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** rng with helpers: r() in [0,1), r.range(a,b), r.int(a,b) inclusive, r.pick(arr), r.chance(p), r.sign() */
export function makeRng(seed = 1) {
  const f = mulberry32(seed);
  const r = () => f();
  r.range = (a, b) => a + (b - a) * f();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  r.pick = arr => arr[Math.floor(f() * arr.length)];
  r.chance = p => f() < p;
  r.sign = () => (f() < 0.5 ? -1 : 1);
  return r;
}
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ------------------------------------------------------------------ simplex noise (2D / 3D)
export function createNoise2D(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256); for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const g = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return function (xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2; const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2; const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 >= 0) { const gi = pm12[ii + perm[jj]] * 2; t0 *= t0; n0 = t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 >= 0) { const gi = pm12[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n1 = t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 >= 0) { const gi = pm12[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n2 = t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2); }
    return 70 * (n0 + n1 + n2); // [-1,1]
  };
}
/** fractal brownian motion over a 2D noise fn */
export function fbm(noise, x, y, oct = 5, lac = 2, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}
/** ridged multifractal — sharp mountain ridges, returns ~[0,1] */
export function ridged(noise, x, y, oct = 5, lac = 2.1, gain = 0.5) {
  let a = 0.5, f = 1, s = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise(x * f, y * f)); n *= n; n *= w; w = clamp(n * 2, 0, 1);
    s += n * a; a *= gain; f *= lac;
  }
  return s;
}

// ------------------------------------------------------------------ canvas textures
/**
 * canvasTexture(w, h, (ctx, w, h) => {...}, { repeat:[x,y], srgb:true, anisotropy:4, wrap:true })
 * Color maps must be srgb:true (default). Data maps (normal/roughness) -> srgb:false.
 */
export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.wrap !== false) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.anisotropy = opts.anisotropy ?? 4;
  tex.needsUpdate = true;
  return tex;
}

/** Fill a canvas region with per-pixel noise (fast, ImageData based). colorFn(x,y,rnd)->[r,g,b,a?] */
export function paintPixels(ctx, w, h, colorFn, seed = 1) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data; const r = mulberry32(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = colorFn(x, y, r); const i = (y * w + x) * 4;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Text texture for signboards. lines: [{text, font:'bold 64px sans-serif', color:'#fff', y?}] or a single string.
 * bg: css color or null for transparent.  Returns CanvasTexture (srgb).
 */
export function textTexture(lines, { w = 512, h = 256, bg = '#0b6b2e', border = '#ffffff', borderW = 10, radius = 18 } = {}) {
  if (typeof lines === 'string') lines = [{ text: lines }];
  return canvasTexture(w, h, (ctx) => {
    if (bg) {
      ctx.fillStyle = bg; roundRect(ctx, 0, 0, w, h, radius); ctx.fill();
      if (border) { ctx.lineWidth = borderW; ctx.strokeStyle = border; roundRect(ctx, borderW, borderW, w - borderW * 2, h - borderW * 2, Math.max(2, radius - borderW)); ctx.stroke(); }
    }
    const n = lines.length;
    lines.forEach((L, i) => {
      ctx.fillStyle = L.color || '#ffffff';
      ctx.font = L.font || `bold ${Math.floor(h / (n + 1.2))}px "Rajdhani", "Teko", "Noto Sans Devanagari", "Kohinoor Devanagari", sans-serif`;
      ctx.textAlign = L.align || 'center'; ctx.textBaseline = 'middle';
      const y = L.y != null ? L.y * h : h * (i + 1) / (n + 1);
      const x = L.x != null ? L.x * w : w / 2;
      ctx.fillText(L.text, x, y, w * 0.92);
    });
  }, { wrap: false, anisotropy: 8 });
}
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ------------------------------------------------------------------ geometry helpers
/**
 * Merge all static meshes inside `root` that share the same material into single meshes.
 * Children (or descendants) flagged with userData.noMerge = true are kept as-is (for animated parts).
 * Returns a new Group (root's own transform is NOT included — geometry is expressed in root's local space).
 */
export function bakeGroup(root, { castShadow = true, receiveShadow = true } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const keep = [];
  const visit = (obj) => {
    for (const ch of obj.children) {
      if (ch.userData.noMerge) { keep.push(ch); continue; }
      if (ch.isMesh && !ch.isInstancedMesh && !ch.isSkinnedMesh) {
        const g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
        // ensure consistent attribute set (position, normal, uv)
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, ch.matrixWorld));
        const m = ch.material;
        if (!byMat.has(m)) byMat.set(m, []);
        byMat.get(m).push(g);
      }
      visit(ch);
    }
  };
  visit(root);
  const out = new THREE.Group();
  for (const [m, list] of byMat) {
    // color attribute must exist on all or none
    const hasColor = list.some(g => g.attributes.color);
    if (hasColor) for (const g of list) if (!g.attributes.color) {
      const c = new Float32Array(g.attributes.position.count * 3).fill(1); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
    out.add(mesh);
  }
  for (const k of keep) {
    // re-express kept object in root space
    const wm = new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld);
    k.removeFromParent();
    wm.decompose(k.position, k.quaternion, k.scale);
    out.add(k);
  }
  return out;
}

/** Paint a whole geometry with a vertex color (adds 'color' attribute). Useful before merging into one vertex-colored mesh. */
export function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count; const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

/** Merge geometries after making them non-indexed & attribute-compatible. */
export function mergeSafe(geos) {
  const list = geos.map(g => {
    let x = g.index ? g.toNonIndexed() : g;
    if (!x.attributes.normal) x.computeVertexNormals();
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
    return x;
  });
  const hasColor = list.some(g => g.attributes.color);
  for (const g of list) {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    if (hasColor && !g.attributes.color) colorize(g, 0xffffff);
  }
  return mergeGeometries(list, false);
}

/** Displace vertices of a geometry by noise (for rocks / organic shapes). */
export function jitterGeometry(geo, amount = 0.1, seed = 1) {
  const r = mulberry32(seed); const p = geo.attributes.position; const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = map.get(key); if (!d) { d = [(r() - 0.5) * amount, (r() - 0.5) * amount, (r() - 0.5) * amount]; map.set(key, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

// ------------------------------------------------------------------ loading
export const loadingManager = new THREE.LoadingManager();
export const textureLoader = new THREE.TextureLoader(loadingManager);
/** promise texture load (srgb color map by default) */
export function loadTexture(url, { srgb = true } = {}) {
  return new Promise((res) => {
    textureLoader.load(url, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, () => res(null));
  });
}
/** load an HTMLImageElement */
export function loadImage(url) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}

export const isTouch = () => (typeof window !== 'undefined') && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
export const isMobile = () => (typeof navigator !== 'undefined') && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

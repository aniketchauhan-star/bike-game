// Indian road vehicles for the Ramnagar → Ranikhet route: hill bus, Bolero-style jeep, painted truck,
// auto rickshaw and hatchback.  Every factory returns { group, update(dt, time, {speed}), dims, wheelRadius }.
// Conventions: faces +Z, left side = +X, origin on the ground at the footprint centre, metres.
// Draw calls per vehicle ≤ 8: paint, glass, trim, metal, lens, decal-atlas, wheels (InstancedMesh, 1–2).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { makeRng, roundRect } from '../core/util.js';

const HI = '"Noto Sans Devanagari","Kohinoor Devanagari","Devanagari Sangam MN",sans-serif';
const EN = '"Arial Narrow","Helvetica Neue",Arial,sans-serif';
function hashSeed(seed, salt) {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(salt, 668265263) + 0x27d4eb2d) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) || 1;
}
const rngFor = (seed, salt) => { const r = makeRng(hashSeed(seed, salt)); r(); r(); return r; };
const css = hex => '#' + (hex >>> 0).toString(16).padStart(6, '0');

// ------------------------------------------------------------------ shared materials
let MAT = null;
function mats() {
  if (MAT) return MAT;
  MAT = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2630, roughness: 0.07, metalness: 0.65 }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.88 }),
    lens: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.1 }),
    wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.22 }),
  };
  for (const k in MAT) MAT[k].name = 'veh_' + k;
  return MAT;
}

// ------------------------------------------------------------------ geometry helpers
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
function xf(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _m.compose(_p, _q, _s);
  return g.applyMatrix4(_m);
}
function paint(g, hex) {
  _c.set(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return g;
}
const box = (w, h, d, x, y, z, rx, ry, rz) => xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const rbox = (w, h, d, r, x, y, z, rx, ry, rz, seg = 2) => xf(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999), x, y, z, rx, ry, rz);
const rbox1 = (w, h, d, r, x, y, z, rx, ry, rz) => rbox(w, h, d, r, x, y, z, rx, ry, rz, 1);
function cyl(rt, rb, h, seg, axis, x, y, z, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return xf(g, x, y, z);
}
const _ya = new THREE.Vector3(0, 1, 0);
function rod(ax, ay, az, bx, by, bz, r, seg = 6) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
  const d = b.clone().sub(a); const len = Math.max(1e-4, d.length());
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(_ya, d.normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, _s));
}
/** partial cylinder shell around X axis (mudguards). theta 0 = +Z (front), PI/2 = top */
function guard(R, width, t0, tl, x, y, z, seg = 12) {
  const g = new THREE.CylinderGeometry(R, R, width, seg, 1, true, t0, tl);
  g.rotateZ(Math.PI / 2);
  // after rotateZ: theta measured with y = R sin(t), z = R cos(t)  (check: x=sin t -> y)
  return xf(g, x, y, z);
}
/** side-profile extrusion: pts [[z,y],...] (vehicle side view), extruded across width (centred on X) */
function sideExtrude(pts, width, bevel = 0, curveSeg = 4) {
  const sh = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  sh.closePath();
  const depth = Math.max(0.01, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth, steps: 1, curveSegments: curveSeg, bevelEnabled: bevel > 0,
    bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2,
  });
  g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0);
  return g;
}
/** arch notch points over a wheel (from rear intersection to front intersection over the top) */
function arch(cz, cy, r, yb, n = 9) {
  const s = Math.max(-1, Math.min(1, (yb - cy) / r));
  const a0 = Math.PI - Math.asin(s), a1 = Math.asin(s);
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
/** flat polygon on a vehicle side: pts [[z,y]], side +1 (left, +X) or -1 (right, -X) */
function sidePoly(pts, side, x) {
  const sh = new THREE.Shape();
  pts.forEach(([z, y], i) => { const sx = side > 0 ? -z : z; i ? sh.lineTo(sx, y) : sh.moveTo(sx, y); });
  const g = new THREE.ShapeGeometry(sh);
  g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  g.translate(side * x, 0, 0);
  return g;
}
/** textured quad (PlaneGeometry) with atlas uv rect [u0,v0,u1,v1] */
function quad(w, h, r, x, y, z, ry = 0, rx = 0) {
  const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv;
  uv.setXY(0, r[0], r[3]); uv.setXY(1, r[2], r[3]); uv.setXY(2, r[0], r[1]); uv.setXY(3, r[2], r[1]);
  return xf(g, x, y, z, rx, ry, 0);
}

const KEEP = new Set(['position', 'normal', 'uv', 'color']);
function prep(g) {
  let x = g.index ? g.toNonIndexed() : g;
  if (!x.attributes.normal) x.computeVertexNormals();
  if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
  if (!x.attributes.color) paint(x, 0xffffff);
  for (const k of Object.keys(x.attributes)) if (!KEEP.has(k)) x.deleteAttribute(k);
  return x;
}
class Kit {
  constructor() { this.L = {}; }
  add(mat, geo, color) { if (color != null) paint(geo, color); (this.L[mat] ||= []).push(geo); return geo; }
  meshes(M, parent) {
    for (const k of Object.keys(this.L)) {
      const merged = mergeGeometries(this.L[k].map(prep), false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, M[k]); mesh.name = k;
      mesh.castShadow = k !== 'lens' && k !== 'decal'; mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

// ------------------------------------------------------------------ wheels (one InstancedMesh per wheel type)
const wheelCache = new Map();
function wheelGeo(R, w, style = 'alloy', dual = false) {
  const key = `${R}|${w}|${style}|${dual}`;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const parts = [];
  const tires = dual ? [[w / 4 + 0.008, w / 2 - 0.016], [-(w / 4 + 0.008), w / 2 - 0.016]] : [[0, w]];
  const rimF = style === 'heavy' ? 0.58 : style === 'auto' ? 0.55 : style === 'steel' ? 0.6 : 0.66;
  const rimR = R * rimF;
  tires.forEach(([off, tw], ti) => {
    const sh = Math.min(R * 0.13, tw * 0.24);
    const prof = [
      [rimR * 1.01, -tw / 2 * 0.88], [R - sh * 1.4, -tw / 2], [R, -tw / 2 + sh * 1.2],
      [R, tw / 2 - sh * 1.2], [R - sh * 1.4, tw / 2], [rimR * 1.01, tw / 2 * 0.88],
    ].map(([a, b]) => new THREE.Vector2(a, b));
    const tire = new THREE.LatheGeometry(prof, style === 'heavy' ? 18 : 16);
    tire.rotateZ(-Math.PI / 2); tire.translate(off, 0, 0);
    parts.push(paint(tire, 0x1b1b1d));
    const outer = ti === 0; // first tyre is the outer one
    const xo = off + tw * 0.4; // outer face of rim
    if (style === 'alloy') {
      parts.push(paint(cyl(rimR, rimR, tw * 0.8, 20, 'x', off, 0, 0, true), 0xc4c8cc));        // rim barrel
      parts.push(paint(cyl(rimR * 0.97, rimR * 0.97, 0.02, 20, 'x', xo - 0.035, 0, 0), 0x23262a)); // dark back (holes)
      if (outer) {
        for (let k = 0; k < 5; k++) {
          const a = k * Math.PI * 2 / 5;
          const sp = new THREE.BoxGeometry(0.022, rimR * 0.78, rimR * 0.2);
          sp.translate(0, rimR * 0.5, 0); sp.rotateX(a); sp.translate(xo - 0.018, 0, 0);
          parts.push(paint(sp, 0xc9cdd1));
        }
        parts.push(paint(cyl(rimR * 0.28, rimR * 0.3, 0.04, 12, 'x', xo - 0.01, 0, 0), 0xb5babf));
      }
    } else {
      const disc = style === 'heavy' ? 0x3a3f45 : style === 'auto' ? 0x26282a : 0x8d9296;
      parts.push(paint(cyl(rimR, rimR, tw * 0.8, 18, 'x', off, 0, 0), disc));
      if (outer) {
        const hubR = style === 'heavy' ? rimR * 0.42 : rimR * 0.36;
        parts.push(paint(cyl(hubR * 0.7, hubR, 0.07, 12, 'x', xo + 0.03, 0, 0), style === 'steel' ? 0xd0d4d8 : 0x4a4f55));
        const nh = style === 'heavy' ? 6 : style === 'steel' ? 5 : 4;
        for (let k = 0; k < nh; k++) { // holes / nuts ring
          const a = k * Math.PI * 2 / nh;
          const hy = Math.sin(a) * rimR * 0.68, hz = Math.cos(a) * rimR * 0.68;
          if (style === 'heavy') {
            const ny = Math.sin(a) * hubR * 0.75, nz = Math.cos(a) * hubR * 0.75;
            parts.push(paint(cyl(0.018, 0.018, 0.03, 4, 'x', xo + 0.07, ny, nz), 0xbfc3c7));
          } else parts.push(paint(cyl(rimR * 0.1, rimR * 0.1, 0.012, 6, 'x', xo + 0.002, hy, hz), 0x111214));
        }
      }
    }
  });
  const g = mergeGeometries(parts.map(prep), false);
  wheelCache.set(key, g);
  return g;
}
const _qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _X = new THREE.Vector3(1, 0, 0);
/** defs: [{x,y,z, flip?, fixedQ?}] ; returns {mesh, set(angle)} */
function wheelSet(geo, defs) {
  const mesh = new THREE.InstancedMesh(geo, mats().wheel, defs.length);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'wheels';
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), m = new THREE.Matrix4();
  const set = (a) => {
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (d.fixedQ) q.copy(d.fixedQ);
      else { q.setFromAxisAngle(_X, a); if (d.flip) q.multiply(_qY); }
      p.set(d.x, d.y, d.z); m.compose(p, q, _s); mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  set(0); mesh.computeBoundingSphere(); mesh.computeBoundingBox?.();
  return { mesh, set };
}

// ------------------------------------------------------------------ canvas atlas + painting helpers
function makeAtlas(W, H, regions, withEmissive = false) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#7f7f7f'; ctx.fillRect(0, 0, W, H);
  let ce = null, cx2 = null;
  if (withEmissive) { ce = document.createElement('canvas'); ce.width = W; ce.height = H; cx2 = ce.getContext('2d'); cx2.fillStyle = '#000'; cx2.fillRect(0, 0, W, H); }
  const uv = {};
  for (const name of Object.keys(regions)) {
    const [x, y, w, h, draw, drawE] = regions[name];
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); draw(ctx, x, y, w, h); ctx.restore();
    if (cx2 && drawE) { cx2.save(); cx2.beginPath(); cx2.rect(x, y, w, h); cx2.clip(); drawE(cx2, x, y, w, h); cx2.restore(); }
    const pd = 1.5;
    uv[name] = [(x + pd) / W, 1 - (y + h - pd) / H, (x + w - pd) / W, 1 - (y + pd) / H];
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  let etex = null;
  if (ce) { etex = new THREE.CanvasTexture(ce); etex.colorSpace = THREE.SRGBColorSpace; }
  return { tex, etex, uv };
}
function decalMaterial(tex, etex, rough = 0.42, metal = 0.1) {
  const m = new THREE.MeshStandardMaterial({
    map: tex, roughness: rough, metalness: metal,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  if (etex) { m.emissiveMap = etex; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 1.6; }
  m.name = 'veh_decal';
  return m;
}
function plateText(r, series) {
  const Ls = 'ABCDEFGHJKLMNPRSTUVWXY';
  const ser = series || (Ls[r.int(0, Ls.length - 1)] + Ls[r.int(0, Ls.length - 1)]);
  return `UK ${String(r.int(1, 19)).padStart(2, '0')} ${ser} ${String(r.int(11, 9999)).padStart(4, '0')}`;
}
function drawPlate(ctx, x, y, w, h, text, yellow) {
  ctx.fillStyle = '#1a1a1a'; roundRect(ctx, x + 2, y + 2, w - 4, h - 4, h * 0.14); ctx.fill();
  ctx.fillStyle = yellow ? '#f4c514' : '#f6f6f1'; roundRect(ctx, x + 6, y + 6, w - 12, h - 12, h * 0.11); ctx.fill();
  ctx.strokeStyle = '#151515'; ctx.lineWidth = Math.max(2, h * 0.035);
  roundRect(ctx, x + h * 0.1, y + h * 0.1, w - h * 0.2, h - h * 0.2, h * 0.08); ctx.stroke();
  // HSRP hologram + IND
  ctx.fillStyle = '#7ea7dc'; ctx.beginPath(); ctx.arc(x + h * 0.38, y + h * 0.36, h * 0.11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1d4ea6'; ctx.font = `bold ${Math.round(h * 0.2)}px Arial,sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('IND', x + h * 0.38, y + h * 0.72);
  ctx.fillStyle = '#111'; ctx.font = `bold ${Math.round(h * 0.6)}px ${EN}`;
  ctx.fillText(text, x + w * 0.56, y + h * 0.54, w * 0.78);
}
function drawLED(ctx, x, y, w, h, lines, on, emissive) {
  const pitch = 3; const cw = Math.floor(w / pitch), ch = Math.floor(h / pitch);
  const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
  const g = c2.getContext('2d'); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const L of lines) { g.font = `bold ${Math.round(L.size * ch)}px ${L.hi ? HI : EN}`; g.fillText(L.text, cw / 2, L.yf * ch, cw * 0.96); }
  const d = g.getImageData(0, 0, cw, ch).data;
  ctx.fillStyle = emissive ? '#000' : '#0a0705'; ctx.fillRect(x, y, w, h);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const a = d[(j * cw + i) * 4 + 3];
    if (a < 90) { if (!emissive) { ctx.fillStyle = '#1e130a'; ctx.fillRect(x + i * pitch + 1, y + j * pitch + 1, 1, 1); } continue; }
    ctx.fillStyle = on; ctx.beginPath(); ctx.arc(x + i * pitch + pitch / 2, y + j * pitch + pitch / 2, pitch * 0.46, 0, Math.PI * 2); ctx.fill();
  }
}
function outlined(ctx, text, x, y, fill, stroke, lw) {
  ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}
function flower(ctx, cx, cy, r, petal, center) {
  ctx.fillStyle = petal;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.45, r * 0.22, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = center; ctx.beginPath(); ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2); ctx.fill();
}
function lotus(ctx, cx, cy, r) {
  const cols = ['#ff7eb6', '#ff4f9a', '#ffd1e6'];
  for (let k = -3; k <= 3; k++) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(k * 0.36);
    ctx.fillStyle = cols[(k + 9) % 3]; ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 0.22, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#2f8f3a'; ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.12, r * 1.05, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
}
function trianglesBand(ctx, x, y, w, h, c1, c2, down) {
  const n = Math.ceil(w / h);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? c1 : c2; ctx.beginPath();
    if (down) { ctx.moveTo(x + i * h, y); ctx.lineTo(x + (i + 1) * h, y); ctx.lineTo(x + (i + 0.5) * h, y + h); }
    else { ctx.moveTo(x + i * h, y + h); ctx.lineTo(x + (i + 1) * h, y + h); ctx.lineTo(x + (i + 0.5) * h, y); }
    ctx.fill();
  }
}

// ------------------------------------------------------------------ palettes
const BUS_LIVERIES = [
  { skirt: 0x1d3f8f, stripe: 0xf2b705, mid: 0xf3efe4, roof: 0xf8f6f0, door: 0xe7e2d5, text: '#1d3f8f', name: ['पहाड़ी एक्सप्रेस', 'PAHADI EXPRESS'] },
  { skirt: 0x8c1a1a, stripe: 0xff8a1c, mid: 0xf2ece0, roof: 0xf8f6f0, door: 0xe5ddcf, text: '#8c1a1a', name: ['कुमाऊँ यात्री सेवा', 'KUMAON YATRI SEWA'] },
  { skirt: 0x1d634a, stripe: 0xf4f2ea, mid: 0x2f8d68, roof: 0xf2f2ee, door: 0x287c5c, text: '#fdfdf6', name: ['देवभूमि यात्रा', 'DEVBHOOMI YATRA'] },
  { skirt: 0x5b3214, stripe: 0xf7f2e8, mid: 0xefa21f, roof: 0xf7f4ec, door: 0xd8911d, text: '#4a280f', name: ['पहाड़ी एक्सप्रेस', 'PAHADI EXPRESS'] },
];
const LUGGAGE = [0x2456a8, 0xcdb68a, 0x6e4a2a, 0x2f5d3a, 0xb03a48, 0xdcdcd6, 0x232323, 0x8b6b3d, 0x3d6fb6, 0xd2a54a];
const JEEP_COLORS = [0xf3f3f0, 0xf3f3f0, 0xf3f3f0, 0xf3f3f0, 0xb8bdc2, 0x1d1f22, 0x9e1c1c, 0x24427a];
const CAR_COLORS = [0xf2f2ef, 0xf2f2ef, 0xc0c4c8, 0xaf111b, 0x1c4e9b, 0x50555b, 0x141619, 0x6a1525, 0xd5641c, 0x2c6e8f];
const AUTO_COLORS = [
  { body: 0x1e8a3a, top: 0xf2c200 }, { body: 0x161616, top: 0xf2c200 }, { body: 0x1e8a3a, top: 0xf2c200 }, { body: 0xf2c200, top: 0x1c6b30 },
];
const TRUCK_PAL = [
  { cab: 0xff7a00, band: 0xfdfdf5, nose: 0xd12424, cargo: 0xc81d25, tail: ['#b3121b', '#ff6a00'], side: '#ffb703', a: '#1f8f45', b: '#ffffff', c: '#1d4fbf', crown: '#14306e' },
  { cab: 0xffc300, band: 0x1e5bb8, nose: 0x1e5bb8, cargo: 0x1f8f45, tail: ['#0d5c2e', '#22a04f'], side: '#e63946', a: '#ffd60a', b: '#ffffff', c: '#003f88', crown: '#7a0c0c' },
  { cab: 0xd62828, band: 0xffd60a, nose: 0xffd60a, cargo: 0x2a62c9, tail: ['#123c8c', '#2f6fde'], side: '#ffd60a', a: '#d62828', b: '#ffffff', c: '#1f8f45', crown: '#0b4d2a' },
  { cab: 0x1e5bb8, band: 0xfdfdf5, nose: 0xff7a00, cargo: 0xffb703, tail: ['#e85d04', '#ffba08'], side: '#1f8f45', a: '#ff006e', b: '#ffffff', c: '#ffbe0b', crown: '#5a189a' },
  { cab: 0x1f8f45, band: 0xfdfdf5, nose: 0xffc300, cargo: 0xd62828, tail: ['#9d0208', '#e85d04'], side: '#3a86ff', a: '#ffbe0b', b: '#ffffff', c: '#fb5607', crown: '#003049' },
];
const TARPS = [0x2b5fae, 0x3e7c46, 0xcf9a1d, 0x2a2a2a, 0x8a2d2d, 0x3b6fc0];

function finish(group, body, K, decalM, extras = []) {
  const M = mats();
  K.meshes({ ...M, decal: decalM }, body);
  for (const e of extras) group.add(e);
}

// ================================================================== BUS
export function createBus({ seed = 1 } = {}) {
  const r = rngFor(seed, 101);
  const K = new Kit();
  const liv = BUS_LIVERIES[r.int(0, BUS_LIVERIES.length - 1)];
  const L = 10.2, W = 2.5, hw = W / 2, zF = L / 2, zR = -L / 2;
  const yb = 0.42, yS = 1.25, yW0 = 1.8, yW1 = 2.55, yRoof = 3.02;
  const WR = 0.5, fz = 3.45, rz = -2.35, aH = 0.68, aTop = 1.13;
  const plate = plateText(r, 'PA');

  // --- atlas
  const AT = makeAtlas(1024, 512, {
    led: [0, 0, 1024, 144,
      (c, x, y, w, h) => drawLED(c, x, y, w, h, [{ text: 'रामनगर - रानीखेत', size: 0.52, yf: 0.34, hi: true }, { text: 'RAMNAGAR - RANIKHET', size: 0.3, yf: 0.8 }], '#ff9a1f', false),
      (c, x, y, w, h) => drawLED(c, x, y, w, h, [{ text: 'रामनगर - रानीखेत', size: 0.52, yf: 0.34, hi: true }, { text: 'RAMNAGAR - RANIKHET', size: 0.3, yf: 0.8 }], '#ff8a10', true)],
    plate: [0, 144, 512, 128, (c, x, y, w, h) => drawPlate(c, x, y, w, h, plate, true)],
    route: [512, 144, 512, 128, (c, x, y, w, h) => {
      c.fillStyle = '#101010'; c.fillRect(x, y, w, h); c.strokeStyle = '#f2f2f2'; c.lineWidth = 6; c.strokeRect(x + 8, y + 8, w - 16, h - 16);
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `bold 46px ${HI}`; c.fillText('रामनगर ⇄ रानीखेत', x + w / 2, y + h * 0.4, w * 0.9);
      c.font = `bold 26px ${EN}`; c.fillStyle = '#ffd34d'; c.fillText('via MOHAN • BHATRONJKHAN', x + w / 2, y + h * 0.78, w * 0.9);
    }],
    side: [0, 272, 1024, 160, (c, x, y, w, h) => {
      c.fillStyle = css(liv.mid); c.fillRect(x, y, w, h);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = liv.text;
      c.font = `bold 88px ${HI}`; c.fillText(liv.name[0], x + w * 0.5, y + h * 0.38, w * 0.95);
      c.font = `bold 46px ${EN}`; c.fillText(liv.name[1], x + w * 0.5, y + h * 0.85, w * 0.95);
    }],
    emerg: [0, 432, 512, 80, (c, x, y, w, h) => {
      c.fillStyle = '#f4f1e8'; c.fillRect(x, y, w, h); c.fillStyle = '#c1121f'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `bold 30px ${HI}`; c.fillText('आपातकालीन द्वार', x + w / 2, y + h * 0.33); c.font = `bold 24px ${EN}`; c.fillText('EMERGENCY EXIT', x + w / 2, y + h * 0.75);
    }],
  }, true);
  const D = [];

  // --- lower skirt with squared wheel arches
  for (const [z0, z1] of [[zR, rz - aH], [rz + aH, fz - aH], [fz + aH, zF]])
    K.add('paint', box(W, yS - yb, z1 - z0, 0, (yS + yb) / 2, (z0 + z1) / 2), liv.skirt);
  for (const c of [fz, rz]) {
    K.add('trim', box(W + 0.02, yS - aTop, aH * 2, 0, (yS + aTop) / 2, c), 0x141414);
    K.add('trim', box(c === fz ? 1.68 : 1.08, aTop - 0.42, aH * 2, 0, (aTop + 0.42) / 2, c), 0x0b0b0b);
    for (const s of [-1, 1]) {
      for (const e of [-1, 1]) K.add('trim', box(0.035, aTop - yb + 0.02, 0.07, s * (hw + 0.012), (aTop + yb) / 2, c + e * aH), 0x141414);
      K.add('trim', box(0.5, 0.46, 0.02, s * (hw - 0.32), 0.36, c - aH - 0.04), 0x101010);
      K.add('lens', box(0.12, 0.05, 0.01, s * (hw - 0.32), 0.25, c - aH - 0.055), 0xd01818);
    }
  }
  K.add('trim', box(1.55, 0.26, L - 1.0, 0, 0.42, 0), 0x18191a);
  K.add('paint', box(W + 0.008, 0.08, L + 0.008, 0, yS + 0.04, 0), liv.stripe);
  K.add('paint', box(W, yW0 - yS - 0.08, L, 0, (yW0 + yS + 0.08) / 2, 0), liv.mid);
  K.add('glass', box(W - 0.02, yW1 - yW0, L - 0.02, 0, (yW0 + yW1) / 2, 0));
  K.add('paint', rbox(W, yRoof - yW1 + 0.14, L, 0.13, 0, (yRoof + yW1 - 0.14) / 2, 0, 0, 0, 0, 2), liv.roof);

  // --- side windows: pillars + frames (both sides); door on the left (+X)
  const dz0 = 1.82, dz1 = 2.7;
  for (const s of [-1, 1]) {
    const xs = s * (hw - 0.003);
    const zs = []; const n = 10;
    for (let i = 0; i <= n; i++) zs.push(-4.98 + i * (9.96 / n));
    for (const z of zs) {
      if (s > 0 && z > dz0 - 0.2 && z < dz1 + 0.2) continue;
      const wdt = Math.abs(z) > 4.9 ? 0.22 : 0.13;
      K.add('paint', box(0.03, yW1 - yW0, wdt, xs, (yW0 + yW1) / 2, z), liv.mid);
    }
    for (const y of [yW0 + 0.02, yW0 + 0.3, yW1 - 0.02]) K.add('metal', box(0.022, y === yW0 + 0.3 ? 0.025 : 0.035, L - 0.4, s * (hw + 0.006), y, 0), 0xc8ccd0);
  }
  // door (left/+X)
  K.add('paint', box(0.03, yW1 - yb - 0.06, dz1 - dz0, hw + 0.008, (yW1 + yb) / 2 - 0.01, (dz0 + dz1) / 2), liv.door);
  K.add('glass', box(0.02, 0.9, dz1 - dz0 - 0.2, hw + 0.026, 2.02, (dz0 + dz1) / 2));
  K.add('glass', box(0.02, 0.5, dz1 - dz0 - 0.2, hw + 0.026, 1.18, (dz0 + dz1) / 2));
  for (const z of [dz0, dz1]) K.add('trim', box(0.04, yW1 - yb, 0.035, hw + 0.012, (yW1 + yb) / 2, z), 0x151515);
  K.add('trim', box(0.04, 0.035, dz1 - dz0, hw + 0.012, yW1 - 0.02, (dz0 + dz1) / 2), 0x151515);
  K.add('metal', rod(hw + 0.05, 1.0, dz1 - 0.12, hw + 0.05, 2.1, dz1 - 0.12, 0.014), 0xd0d4d8);
  K.add('trim', box(0.3, 0.07, dz1 - dz0, hw - 0.1, 0.36, (dz0 + dz1) / 2), 0x222222);
  D.push(quad(1.0, 0.25, AT.uv.route, hw + 0.03, yW0 + 0.42, 1.0, Math.PI / 2));
  D.push(quad(1.0, 0.25, AT.uv.route, -hw - 0.03, yW0 + 0.42, 3.2, -Math.PI / 2));
  D.push(quad(2.6, 0.406, AT.uv.side, hw + 0.004, (yW0 + yS + 0.08) / 2, -1.8, Math.PI / 2));
  D.push(quad(2.6, 0.406, AT.uv.side, -hw - 0.004, (yW0 + yS + 0.08) / 2, -0.4, -Math.PI / 2));

  // --- front
  K.add('glass', box(W - 0.3, yW0 - 1.32, 0.02, 0, (yW0 + 1.32) / 2, zF + 0.004));
  for (const s of [-1, 1]) K.add('paint', box(0.17, yW1 - 1.32, 0.03, s * (hw - 0.085), (yW1 + 1.32) / 2, zF + 0.006), liv.mid);
  K.add('trim', box(0.07, yW1 - 1.32, 0.03, 0, (yW1 + 1.32) / 2, zF + 0.012), 0x111111);
  for (const s of [-1, 1]) K.add('trim', box(0.78, 0.025, 0.02, s * 0.45, 1.42, zF + 0.022, 0, 0, s * 0.32), 0x0d0d0d);
  K.add('trim', box(W - 0.46, 0.36, 0.03, 0, (yW1 + yRoof) / 2 + 0.02, zF + 0.012), 0x0b0b0b);
  D.push(quad(W - 0.56, 0.28, AT.uv.led, 0, (yW1 + yRoof) / 2 + 0.02, zF + 0.03));
  for (const s of [-1, 1]) {
    K.add('trim', box(0.58, 0.26, 0.03, s * 0.8, 0.95, zF + 0.012), 0x121212);
    for (const lx of [0.66, 0.94]) {
      K.add('lens', cyl(0.085, 0.085, 0.04, 14, 'z', s * lx, 0.95, zF + 0.03), 0xf3f1e8);
      K.add('metal', xf(new THREE.TorusGeometry(0.09, 0.012, 4, 10), s * lx, 0.95, zF + 0.05), 0xd8dbde);
    }
    K.add('lens', box(0.1, 0.07, 0.03, s * 1.14, 0.95, zF + 0.02), 0xff9a1a);
    // mirrors (rabbit-ear style)
    K.add('metal', rod(s * (hw - 0.03), 2.45, zF - 0.25, s * (hw + 0.24), 2.62, zF + 0.3, 0.018), 0x2b2b2b);
    K.add('metal', rod(s * (hw + 0.24), 2.62, zF + 0.3, s * (hw + 0.24), 2.3, zF + 0.32, 0.016), 0x2b2b2b);
    K.add('trim', box(0.06, 0.42, 0.24, s * (hw + 0.26), 2.1, zF + 0.32), 0x111111);
  }
  K.add('trim', box(0.72, 0.3, 0.02, 0, 0.98, zF + 0.012), 0x0e0e0e);
  for (let i = 0; i < 4; i++) K.add('metal', box(0.68, 0.022, 0.02, 0, 0.87 + i * 0.075, zF + 0.025), 0xd2d5d8);
  K.add('trim', box(W + 0.06, 0.24, 0.16, 0, 0.56, zF + 0.06), 0x1a1a1a);
  K.add('metal', box(W + 0.07, 0.035, 0.165, 0, 0.61, zF + 0.06), 0xc7cbcf);
  D.push(quad(0.56, 0.14, AT.uv.plate, 0, 0.53, zF + 0.142));

  // --- rear
  for (const s of [-1, 1]) K.add('paint', box(0.2, yW1 - yW0, 0.03, s * (hw - 0.1), (yW0 + yW1) / 2, zR - 0.006), liv.mid);
  K.add('paint', box(0.1, yW1 - yW0, 0.03, 0, (yW0 + yW1) / 2, zR - 0.006), liv.mid);
  for (const lx of [-0.78, -0.45]) K.add('metal', rod(lx, 1.0, zR - 0.07, lx, yRoof + 0.32, zR - 0.07, 0.018), 0xc9ccd0);
  for (let y = 1.15; y < yRoof + 0.3; y += 0.3) K.add('metal', rod(-0.78, y, zR - 0.07, -0.45, y, zR - 0.07, 0.013), 0xc9ccd0);
  for (const lx of [-0.78, -0.45]) for (const y of [1.05, yRoof - 0.1]) K.add('metal', rod(lx, y, zR, lx, y, zR - 0.07, 0.012), 0xc9ccd0);
  for (const s of [-1, 1]) {
    K.add('lens', box(0.24, 0.32, 0.04, s * 0.98, 0.92, zR - 0.02), 0xc4161c);
    K.add('lens', box(0.24, 0.1, 0.04, s * 0.98, 1.15, zR - 0.02), 0xff9a1a);
  }
  K.add('trim', box(W + 0.04, 0.24, 0.14, 0, 0.56, zR - 0.05), 0x1a1a1a);
  D.push(quad(0.56, 0.14, AT.uv.plate, 0, 0.8, zR - 0.012, Math.PI));
  D.push(quad(0.7, 0.11, AT.uv.emerg, 0.5, 1.62, zR - 0.012, Math.PI));

  // --- roof carrier + luggage
  const rackY = yRoof + 0.3, rx0 = hw - 0.14, rz0 = -4.3, rz1 = 3.3, RC = 0xb3b8bd;
  for (const s of [-1, 1]) K.add('metal', rod(s * rx0, rackY, rz0, s * rx0, rackY, rz1, 0.022), RC);
  K.add('metal', rod(-rx0, rackY, rz0, rx0, rackY, rz0, 0.022), RC);
  K.add('metal', rod(-rx0, rackY, rz1, rx0, rackY, rz1, 0.022), RC);
  for (let i = 0; i <= 7; i++) { const z = rz0 + (rz1 - rz0) * i / 7; for (const s of [-1, 1]) K.add('metal', rod(s * rx0, yRoof - 0.03, z, s * rx0, rackY, z, 0.016), RC); }
  for (let z = rz0 + 0.35; z < rz1; z += 0.55) K.add('metal', box(rx0 * 2, 0.03, 0.05, 0, yRoof + 0.035, z), 0x9a9ea2);
  const nLug = r.int(5, 10);
  for (let i = 0; i < nLug; i++) {
    const w = r.range(0.45, 1.0), h = r.range(0.22, 0.5), d = r.range(0.45, 1.15);
    const x = r.range(-rx0 + w / 2 + 0.04, rx0 - w / 2 - 0.04), z = r.range(rz0 + d / 2 + 0.1, rz1 - d / 2 - 0.1);
    K.add('trim', rbox1(w, h, d, Math.min(0.09, h * 0.35), x, yRoof + 0.05 + h / 2 + (r.chance(0.25) ? 0.2 : 0), z, 0, r.range(-0.35, 0.35), 0), r.pick(LUGGAGE));
  }
  if (r.chance(0.6)) K.add('trim', cyl(0.16, 0.16, 1.8, 10, 'x', 0, yRoof + 0.21, rz0 + 0.5), 0x2456a8);
  K.add('decal', mergeGeometries(D.map(prep), false));

  // --- assemble
  const group = new THREE.Group(); group.name = 'bus';
  const body = new THREE.Group(); body.name = 'body'; group.add(body);
  const fGeo = wheelGeo(WR, 0.3, 'heavy', false), rGeo = wheelGeo(WR, 0.62, 'heavy', true);
  const wf = wheelSet(fGeo, [{ x: hw - 0.2, y: WR, z: fz }, { x: -(hw - 0.2), y: WR, z: fz, flip: true }]);
  const wr = wheelSet(rGeo, [{ x: hw - 0.36, y: WR, z: rz }, { x: -(hw - 0.36), y: WR, z: rz, flip: true }]);
  finish(group, body, K, decalMaterial(AT.tex, AT.etex, 0.34, 0.12), [wf.mesh, wr.mesh]);
  let ang = 0; const ph = r() * 10;
  return {
    group, dims: { length: L, width: W, height: 3.45 }, wheelRadius: WR, kind: 'bus',
    update(dt, time = 0, st = {}) {
      const v = st.speed || 0;
      if (v) { ang += (v / WR) * dt; wf.set(ang); wr.set(ang); }
      const k = Math.min(1, Math.abs(v) / 8);
      body.position.y = Math.sin(time * 6.3 + ph) * 0.012 * k;
      body.rotation.z = Math.sin(time * 1.9 + ph) * 0.007 * k;
    },
  };
}

// ================================================================== JEEP (Bolero / Max style hill taxi)
export function createJeep({ seed = 1 } = {}) {
  const r = rngFor(seed, 202);
  const K = new Kit();
  const col = r.pick(JEEP_COLORS);
  const L = 4.1, W = 1.76, hw = W / 2;
  const WR = 0.355, ww = 0.23, fz = 1.32, rz = -1.36, wx = hw - 0.03 - ww / 2;
  const plate = plateText(r, 'TA');
  const AT = makeAtlas(512, 256, {
    plate: [0, 0, 512, 128, (c, x, y, w, h) => drawPlate(c, x, y, w, h, plate, true)],
    strip: [0, 128, 512, 64, (c, x, y, w, h) => {
      const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#0d3b66'); g.addColorStop(1, '#1b5e9a');
      c.fillStyle = g; c.fillRect(x, y, w, h); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `bold 34px ${HI}`; c.fillText(r.pick(['॥ पहाड़ी सफ़र ॥', '॥ जय देवभूमि ॥', 'रानीखेत टैक्सी']), x + w / 2, y + h * 0.55, w * 0.9);
    }],
  });
  const D = [];
  const yb = 0.5;
  const prof = [[-2.04, yb], ...arch(rz, WR, 0.44, yb), ...arch(fz, WR, 0.44, yb), [2.0, yb], [2.05, 0.62], [2.06, 1.06], [2.0, 1.12],
    [0.98, 1.16], [0.44, 1.84], [0.3, 1.89], [-1.96, 1.89], [-2.05, 1.84], [-2.06, 0.6]];
  K.add('paint', sideExtrude(prof, W, 0.045, 3), col);
  K.add('trim', box(1.15, 0.34, 3.2, 0, 0.5, -0.03), 0x141414); // chassis / wells
  // glass
  const ws0 = [0.97, 1.18], ws1 = [0.45, 1.82];
  const wdz = ws1[0] - ws0[0], wdy = ws1[1] - ws0[1], wl = Math.hypot(wdz, wdy);
  const nz = wdy / wl, ny = -wdz / wl; // outward normal in (z,y)
  const wa = Math.atan2(ny, nz);
  const wcz = (ws0[0] + ws1[0]) / 2 + nz * 0.006, wcy = (ws0[1] + ws1[1]) / 2 + ny * 0.006;
  K.add('glass', xf(new THREE.PlaneGeometry(W - 0.2, wl - 0.04), 0, wcy, wcz, -wa, 0, 0));
  D.push(quad(W - 0.24, 0.1, AT.uv.strip, 0, wcy + (wl / 2 - 0.08) * (wdy / wl) + ny * 0.006, wcz + (wl / 2 - 0.08) * (wdz / wl) + nz * 0.006, 0, -wa));
  for (const s of [-1, 1]) {
    const x = hw + 0.008;
    K.add('glass', sidePoly([[0.04, 1.2], [0.88, 1.2], [0.47, 1.77], [0.04, 1.77]], s, x));
    K.add('glass', sidePoly([[-0.95, 1.2], [-0.04, 1.2], [-0.04, 1.77], [-0.95, 1.77]], s, x));
    K.add('glass', sidePoly([[-1.93, 1.22], [-1.05, 1.22], [-1.05, 1.77], [-1.9, 1.77]], s, x));
    // door seams, handles, cladding, flares, steps, mirrors
    K.add('trim', box(0.008, 0.54, 0.012, s * (hw + 0.002), 0.89, 0.93), 0x202020);
    for (const z of [0.0, -1.0]) K.add('trim', box(0.008, 1.2, 0.012, s * (hw + 0.002), 1.21, z), 0x202020);
    for (const z of [0.12, -0.88]) K.add('trim', box(0.02, 0.035, 0.14, s * (hw + 0.008), 1.1, z), 0x1a1a1a);
    K.add('trim', box(0.02, 0.14, 1.92, s * (hw + 0.006), 0.8, -0.02), 0x1b1b1b);
    for (const c of [fz, rz]) K.add('trim', xf(new THREE.TorusGeometry(0.455, 0.045, 5, 14, Math.PI), s * (hw - 0.01), WR, c, 0, Math.PI / 2, 0), 0x161616);
    K.add('trim', box(0.2, 0.04, 1.75, s * (hw - 0.02), 0.47, -0.03), 0x1e1e1e);
    K.add('trim', box(0.13, 0.12, 0.2, s * (hw + 0.1), 1.33, 0.86), 0x151515);
    K.add('trim', box(0.12, 0.03, 0.03, s * (hw + 0.04), 1.3, 0.9), 0x151515);
  }
  K.add('glass', box(1.36, 0.36, 0.02, 0, 1.6, -2.066));
  // front
  K.add('trim', box(1.0, 0.25, 0.03, 0, 0.92, 2.065), 0x101010);
  for (let i = 0; i < 7; i++) K.add('metal', box(0.03, 0.22, 0.02, -0.39 + i * 0.13, 0.92, 2.085), 0xd5d8db);
  for (const s of [-1, 1]) {
    K.add('lens', box(0.3, 0.17, 0.04, s * 0.65, 0.93, 2.065), 0xf1f0ea);
    K.add('lens', box(0.17, 0.06, 0.03, s * 0.66, 0.79, 2.065), 0xff9a1a);
    K.add('lens', cyl(0.045, 0.045, 0.03, 10, 'z', s * 0.62, 0.55, 2.14), 0xf1f0ea);
    K.add('lens', box(0.07, 0.36, 0.04, s * (hw - 0.07), 1.46, -2.08), 0xc4161c);
  }
  K.add('trim', box(W + 0.04, 0.24, 0.16, 0, 0.56, 2.06), 0x1c1c1c);
  D.push(quad(0.5, 0.12, AT.uv.plate, 0, 0.56, 2.142));
  // rear
  K.add('trim', box(W + 0.02, 0.2, 0.14, 0, 0.56, -2.08), 0x1c1c1c);
  D.push(quad(0.5, 0.12, AT.uv.plate, 0, 0.56, -2.152, Math.PI));
  // roof rails + luggage
  for (const s of [-1, 1]) {
    K.add('metal', rod(s * (hw - 0.12), 2.0, -1.85, s * (hw - 0.12), 2.0, 0.22, 0.018), 0xb7bcc1);
    for (const z of [-1.85, -0.8, 0.22]) K.add('metal', rod(s * (hw - 0.12), 1.88, z, s * (hw - 0.12), 2.0, z, 0.016), 0xb7bcc1);
  }
  for (const z of [-1.5, -0.6, 0.1]) K.add('metal', rod(-(hw - 0.12), 2.0, z, hw - 0.12, 2.0, z, 0.016), 0xb7bcc1);
  if (r.chance(0.65)) {
    const n = r.int(1, 3);
    for (let i = 0; i < n; i++) {
      const w = r.range(0.4, 0.8), h = r.range(0.2, 0.35), d = r.range(0.4, 0.8);
      K.add('trim', rbox1(w, h, d, 0.06, r.range(-0.25, 0.25), 1.92 + h / 2, r.range(-1.4, -0.1), 0, r.range(-0.3, 0.3), 0), r.pick(LUGGAGE));
    }
  }
  K.add('decal', mergeGeometries(D.map(prep), false));
  const group = new THREE.Group(); group.name = 'jeep';
  const body = new THREE.Group(); body.name = 'body'; group.add(body);
  const spareQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const ws = wheelSet(wheelGeo(WR, ww, 'steel'), [
    { x: wx, y: WR, z: fz }, { x: -wx, y: WR, z: fz, flip: true }, { x: wx, y: WR, z: rz }, { x: -wx, y: WR, z: rz, flip: true },
    { x: 0, y: 1.02, z: -2.2, fixedQ: spareQ },
  ]);
  finish(group, body, K, decalMaterial(AT.tex, null), [ws.mesh]);
  let ang = 0; const ph = r() * 10;
  return {
    group, dims: { length: L, width: W, height: 2.0 }, wheelRadius: WR, kind: 'jeep',
    update(dt, time = 0, st = {}) {
      const v = st.speed || 0;
      if (v) { ang += (v / WR) * dt; ws.set(ang); }
      const k = Math.min(1, Math.abs(v) / 8);
      body.position.y = Math.sin(time * 7.5 + ph) * 0.01 * k;
      body.rotation.z = Math.sin(time * 2.3 + ph) * 0.008 * k;
    },
  };
}

// ================================================================== CAR (hatchback)
export function createCar({ seed = 1 } = {}) {
  const r = rngFor(seed, 505);
  const K = new Kit();
  const col = r.pick(CAR_COLORS);
  const L = 3.85, W = 1.7, hw = W / 2;
  const WR = 0.29, ww = 0.18, fz = 1.22, rz = -1.23, wx = hw - 0.04 - ww / 2;
  const plate = plateText(r);
  const AT = makeAtlas(512, 128, { plate: [0, 0, 512, 128, (c, x, y, w, h) => drawPlate(c, x, y, w, h, plate, false)] });
  const D = [];
  const yb = 0.3;
  const lower = [[-1.86, yb], ...arch(rz, WR, 0.335, yb), ...arch(fz, WR, 0.335, yb), [1.84, yb], [1.92, 0.42], [1.94, 0.62], [1.88, 0.76],
    [1.5, 0.84], [0.86, 0.95], [-1.7, 1.0], [-1.8, 0.99], [-1.93, 0.64], [-1.92, 0.42]];
  K.add('paint', sideExtrude(lower, W, 0.06, 3), col);
  const gh = [[0.9, 0.93], [0.0, 1.44], [-0.12, 1.48], [-1.38, 1.48], [-1.62, 1.42], [-1.82, 0.97]];
  K.add('glass', sideExtrude(gh, 1.5, 0.04, 2));
  K.add('trim', box(1.1, 0.26, 2.9, 0, 0.36, 0), 0x121212);
  K.add('paint', rbox(1.44, 0.05, 1.42, 0.02, 0, 1.495, -0.76), col);
  for (const s of [-1, 1]) {
    K.add('paint', rod(s * 0.745, 0.95, 0.9, s * 0.745, 1.47, -0.03, 0.045, 6), col);
    K.add('paint', box(0.03, 0.5, 0.1, s * 0.762, 1.22, -0.6), col);
    K.add('paint', sidePoly([[-1.22, 0.97], [-1.83, 0.97], [-1.63, 1.43], [-1.38, 1.49], [-1.22, 1.49]], s, 0.772), col);
    for (const z of [0.86, -0.56, -1.22]) K.add('trim', box(0.006, 0.6, 0.01, s * (hw + 0.001), 0.66, z), 0x1a1a1a);
    for (const z of [0.05, -0.95]) K.add('trim', box(0.02, 0.03, 0.12, s * (hw + 0.006), 0.9, z), 0x222222);
    K.add('paint', box(0.1, 0.09, 0.16, s * (hw + 0.04), 1.04, 0.62), col);
    K.add('trim', box(0.02, 0.06, 2.7, s * (hw + 0.004), 0.35, -0.02), 0x161616);
    K.add('lens', box(0.36, 0.11, 0.22, s * 0.55, 0.74, 1.79, -0.2, s * 0.28, 0), 0xeeeeea);
    K.add('lens', box(0.16, 0.3, 0.05, s * 0.66, 0.85, -1.85, 0.35, 0, 0), 0xc4161c);
    K.add('lens', cyl(0.04, 0.04, 0.03, 10, 'z', s * 0.62, 0.45, 1.93), 0xeeeeea);
  }
  K.add('trim', box(0.62, 0.1, 0.06, 0, 0.66, 1.91), 0x0f0f0f);
  K.add('trim', box(0.9, 0.12, 0.05, 0, 0.44, 1.925), 0x101010);
  K.add('trim', box(W - 0.04, 0.16, 0.12, 0, 0.42, -1.89), 0x161616);
  D.push(quad(0.5, 0.12, AT.uv.plate, 0, 0.535, 1.94));
  D.push(quad(0.5, 0.12, AT.uv.plate, 0, 0.72, -1.912, Math.PI, 0.35));
  K.add('decal', mergeGeometries(D.map(prep), false));
  const group = new THREE.Group(); group.name = 'car';
  const body = new THREE.Group(); body.name = 'body'; group.add(body);
  const ws = wheelSet(wheelGeo(WR, ww, 'alloy'), [
    { x: wx, y: WR, z: fz }, { x: -wx, y: WR, z: fz, flip: true }, { x: wx, y: WR, z: rz }, { x: -wx, y: WR, z: rz, flip: true },
  ]);
  finish(group, body, K, decalMaterial(AT.tex, null), [ws.mesh]);
  let ang = 0; const ph = r() * 10;
  return {
    group, dims: { length: L, width: W, height: 1.52 }, wheelRadius: WR, kind: 'car',
    update(dt, time = 0, st = {}) {
      const v = st.speed || 0;
      if (v) { ang += (v / WR) * dt; ws.set(ang); }
      const k = Math.min(1, Math.abs(v) / 8);
      body.position.y = Math.sin(time * 8.1 + ph) * 0.006 * k;
    },
  };
}

// ================================================================== AUTO RICKSHAW
export function createAuto({ seed = 1 } = {}) {
  const r = rngFor(seed, 404);
  const K = new Kit();
  const pal = r.pick(AUTO_COLORS);
  const WR = 0.21;
  const plate = plateText(r, 'TA');
  const AT = makeAtlas(512, 256, {
    plate: [0, 0, 512, 128, (c, x, y, w, h) => drawPlate(c, x, y, w, h, plate, true)],
    horn: [0, 128, 512, 96, (c, x, y, w, h) => {
      c.fillStyle = css(pal.body); c.fillRect(x, y, w, h); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `900 54px Impact,"Arial Black",sans-serif`;
      outlined(c, 'HORN PLEASE', x + w / 2, y + h * 0.55, '#ffffff', '#111', 6);
    }],
  });
  const D = [];
  K.add('trim', box(1.16, 0.06, 2.1, 0, 0.4, -0.2), 0x1a1a1a);
  // front cowl (plan-view shape extruded upward)
  const cs = new THREE.Shape();
  cs.moveTo(-0.62, -0.45); cs.lineTo(0.62, -0.45); cs.lineTo(0.62, -0.62);
  cs.quadraticCurveTo(0.5, -1.18, 0.0, -1.3); cs.quadraticCurveTo(-0.5, -1.18, -0.62, -0.62); cs.closePath();
  const cowl = new THREE.ExtrudeGeometry(cs, { depth: 0.5, steps: 1, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 1 });
  cowl.rotateX(-Math.PI / 2); cowl.translate(0, 0.5, 0);
  K.add('paint', cowl, pal.body);
  K.add('trim', box(1.12, 0.04, 0.3, 0, 1.02, 0.6), 0x1b1b1b);
  K.add('paint', guard(0.26, 0.17, -0.35, 2.4, 0, WR, 0.98), pal.body);
  for (const s of [-1, 1]) K.add('metal', rod(s * 0.075, WR, 0.98, s * 0.075, 0.62, 0.9, 0.018), 0x9a9ea2);
  K.add('lens', cyl(0.085, 0.085, 0.04, 14, 'z', 0, 0.82, 1.3), 0xf2f0e6);
  K.add('metal', xf(new THREE.TorusGeometry(0.09, 0.013, 4, 10), 0, 0.82, 1.32), 0xd6d9dc);
  for (const s of [-1, 1]) K.add('lens', box(0.07, 0.05, 0.04, s * 0.22, 0.93, 1.22), 0xff9a1a);
  // windshield + frame
  K.add('glass', xf(new THREE.PlaneGeometry(1.06, 0.52), 0, 1.29, 0.64, -0.12, 0, 0));
  for (const s of [-1, 1]) K.add('metal', rod(s * 0.6, 0.98, 0.65, s * 0.6, 1.58, 0.6, 0.02), 0x1d1d1d);
  K.add('trim', box(0.5, 0.02, 0.02, 0.12, 1.08, 0.665, 0, 0, 0.25), 0x0d0d0d);
  // canopy shell
  const outer = [[0.7, 1.55], [0.62, 1.66], [0.42, 1.73], [0.1, 1.76], [-1.05, 1.76], [-1.28, 1.7], [-1.37, 1.58], [-1.38, 1.46]];
  const inner = [[-1.345, 1.46], [-1.335, 1.565], [-1.255, 1.665], [-1.05, 1.725], [0.1, 1.725], [0.41, 1.695], [0.595, 1.63], [0.665, 1.54]];
  K.add('trim', sideExtrude([...outer, ...inner], 1.34, 0, 2), pal.top);
  for (const s of [-1, 1]) {
    K.add('trim', box(0.02, 0.73, 0.4, s * 0.66, 1.355, -1.14), pal.top);
    K.add('trim', box(0.02, 0.17, 0.6, s * 0.66, 1.635, -0.66), pal.top);
    K.add('metal', rod(s * 0.62, 0.96, -0.38, s * 0.62, 1.73, -0.38, 0.018), 0x1d1d1d);
    K.add('paint', box(0.03, 0.22, 0.84, s * 0.625, 0.56, 0.02), pal.body);
  }
  K.add('trim', box(1.3, 0.5, 0.03, 0, 1.22, -1.355), pal.top);
  K.add('glass', box(0.5, 0.17, 0.01, 0, 1.36, -1.375));
  K.add('paint', rbox(1.3, 0.55, 0.98, 0.05, 0, 0.72, -0.86), pal.body);
  // seats, bars
  K.add('trim', box(0.42, 0.1, 0.34, 0, 0.88, 0.14), 0x151515);
  K.add('trim', box(1.16, 0.12, 0.42, 0, 1.05, -0.8), 0x2a1a12);
  K.add('trim', box(1.16, 0.42, 0.08, 0, 1.3, -1.04), 0x2a1a12);
  K.add('metal', rod(-0.32, 1.12, 0.5, 0.32, 1.12, 0.5, 0.016), 0xbfc3c7);
  for (const s of [-1, 1]) K.add('trim', cyl(0.024, 0.024, 0.1, 8, 'x', s * 0.32, 1.12, 0.5), 0x111111);
  K.add('metal', rod(0, 1.12, 0.5, 0, 0.8, 0.78, 0.02), 0x9a9ea2);
  K.add('trim', cyl(0.05, 0.05, 1.12, 8, 'x', 0, WR, -0.72), 0x1a1a1a);
  K.add('trim', box(0.6, 0.25, 0.5, 0, 0.42, -0.95), 0x202020);
  for (const s of [-1, 1]) {
    K.add('lens', box(0.1, 0.08, 0.03, s * 0.5, 0.8, -1.36), 0xc4161c);
    K.add('paint', guard(0.25, 0.14, 0.3, 2.3, s * 0.565, WR, -0.72), pal.body);
  }
  D.push(quad(0.36, 0.1, AT.uv.plate, 0, 0.6, -1.362, Math.PI));
  D.push(quad(0.62, 0.115, AT.uv.horn, 0, 0.88, -1.362, Math.PI));
  K.add('decal', mergeGeometries(D.map(prep), false));
  const group = new THREE.Group(); group.name = 'auto';
  const body = new THREE.Group(); body.name = 'body'; group.add(body);
  const ws = wheelSet(wheelGeo(WR, 0.11, 'auto'), [
    { x: 0, y: WR, z: 0.98 }, { x: 0.565, y: WR, z: -0.72 }, { x: -0.565, y: WR, z: -0.72, flip: true },
  ]);
  finish(group, body, K, decalMaterial(AT.tex, null), [ws.mesh]);
  let ang = 0; const ph = r() * 10;
  return {
    group, dims: { length: 2.7, width: 1.34, height: 1.78 }, wheelRadius: WR, kind: 'auto',
    update(dt, time = 0, st = {}) {
      const v = st.speed || 0;
      if (v) { ang += (v / WR) * dt; ws.set(ang); }
      const k = Math.min(1, Math.abs(v) / 6) * 0.6 + 0.4 * (v ? 1 : 0.35); // idling autos shake a bit
      body.position.y = Math.sin(time * 23 + ph) * 0.004 * k + Math.sin(time * 7 + ph) * 0.006 * Math.min(1, Math.abs(v) / 6);
    },
  };
}

// ================================================================== TRUCK (Indian truck-art)
export function createTruck({ seed = 1 } = {}) {
  const r = rngFor(seed, 303);
  const K = new Kit();
  const P = TRUCK_PAL[r.int(0, TRUCK_PAL.length - 1)];
  const tarp = r.pick(TARPS);
  const L = 7.6, W = 2.44, hw = W / 2, zF = 3.8, zR = -3.8;
  const WR = 0.5, fz = 2.55, rz = -1.75;
  const plate = plateText(r, 'CA');
  const AT = makeAtlas(1024, 512, {
    side: [0, 0, 1024, 224, (c, x, y, w, h) => {
      c.fillStyle = P.side; c.fillRect(x, y, w, h);
      const tb = h * 0.2;
      c.fillStyle = P.a; c.fillRect(x, y, w, tb); trianglesBand(c, x, y + tb * 0.25, w, tb * 0.5, P.b, P.c, false);
      c.fillStyle = P.c; c.fillRect(x, y + h - tb, w, tb);
      for (let i = 0; i < 26; i++) { c.fillStyle = i % 2 ? P.b : P.a; c.beginPath(); const cx = x + (i + 0.5) * w / 26, cy = y + h - tb / 2; c.moveTo(cx, cy - tb * 0.38); c.lineTo(cx + tb * 0.38, cy); c.lineTo(cx, cy + tb * 0.38); c.lineTo(cx - tb * 0.38, cy); c.fill(); }
      for (let i = 0; i < 10; i++) { if (i === 4 || i === 5) continue; flower(c, x + (i + 0.5) * w / 10, y + h / 2, h * 0.16, i % 2 ? '#ff4d6d' : '#ffffff', '#ffd60a'); }
      c.fillStyle = 'rgba(0,0,0,0.85)'; roundRect(c, x + w * 0.37, y + h * 0.29, w * 0.26, h * 0.42, h * 0.08); c.fill();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `bold ${Math.round(h * 0.15)}px ${HI}`; c.fillStyle = '#ffd60a'; c.fillText('राष्ट्रीय परमिट', x + w / 2, y + h * 0.42, w * 0.24);
      c.font = `bold ${Math.round(h * 0.11)}px ${EN}`; c.fillStyle = '#ffffff'; c.fillText('NATIONAL PERMIT', x + w / 2, y + h * 0.6, w * 0.24);
      c.strokeStyle = 'rgba(0,0,0,0.22)'; c.lineWidth = 2;
      for (let k = 1; k < 6; k++) { c.beginPath(); c.moveTo(x, y + k * h / 6); c.lineTo(x + w, y + k * h / 6); c.stroke(); }
    }],
    tail: [0, 224, 512, 256, (c, x, y, w, h) => {
      const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, P.tail[0]); g.addColorStop(1, P.tail[1]);
      c.fillStyle = g; c.fillRect(x, y, w, h);
      trianglesBand(c, x, y, w, h * 0.08, '#ffd60a', '#1f8f45', true);
      trianglesBand(c, x, y + h * 0.92, w, h * 0.08, '#ffd60a', '#1f8f45', false);
      lotus(c, x + w / 2, y + h * 0.27, h * 0.12);
      flower(c, x + w * 0.1, y + h * 0.27, h * 0.08, '#ffffff', '#ff006e'); flower(c, x + w * 0.9, y + h * 0.27, h * 0.08, '#ffffff', '#ff006e');
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const fs = Math.round(h * 0.2);
      c.font = `900 ${fs}px Impact,"Arial Black",sans-serif`;
      outlined(c, 'HORN', x + w * 0.22, y + h * 0.52, '#ffe600', '#111', fs * 0.14);
      c.fillStyle = '#111'; c.beginPath(); c.arc(x + w * 0.5, y + h * 0.52, fs * 0.62, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x + w * 0.5, y + h * 0.52, fs * 0.54, 0, Math.PI * 2); c.fill();
      c.font = `900 ${Math.round(fs * 0.62)}px Impact,"Arial Black",sans-serif`; outlined(c, 'OK', x + w * 0.5, y + h * 0.53, '#e63946', '#111', fs * 0.06);
      c.font = `900 ${fs}px Impact,"Arial Black",sans-serif`;
      outlined(c, 'PLEASE', x + w * 0.79, y + h * 0.52, '#7bff3a', '#111', fs * 0.14);
      c.fillStyle = '#111'; c.fillRect(x + w * 0.2, y + h * 0.66, w * 0.6, h * 0.11);
      c.font = `bold ${Math.round(h * 0.075)}px Arial,sans-serif`; c.fillStyle = '#fff'; c.fillText('USE DIPPER AT NIGHT', x + w / 2, y + h * 0.716);
      c.font = `bold ${Math.round(h * 0.065)}px ${HI}`; c.fillStyle = '#fff8d6'; c.fillText('बुरी नज़र वाले तेरा मुँह काला', x + w / 2, y + h * 0.84, w * 0.9);
    }],
    crown: [512, 224, 512, 128, (c, x, y, w, h) => {
      c.fillStyle = P.crown; c.fillRect(x, y, w, h);
      c.strokeStyle = '#ffd166'; c.lineWidth = 6; c.strokeRect(x + 6, y + 6, w - 12, h - 12);
      for (let i = 0; i < 22; i++) { c.fillStyle = i % 2 ? '#ff4d6d' : '#ffd166'; c.beginPath(); c.arc(x + 16 + i * (w - 32) / 21, y + 14, 4, 0, Math.PI * 2); c.fill(); }
      flower(c, x + 52, y + h * 0.56, 26, '#ffffff', '#ff006e'); flower(c, x + w - 52, y + h * 0.56, 26, '#ffffff', '#ff006e');
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold 50px ${HI}`;
      outlined(c, 'मेरा भारत महान', x + w / 2, y + h * 0.58, '#ffd166', '#2b1300', 5);
    }],
    plate: [512, 352, 512, 128, (c, x, y, w, h) => drawPlate(c, x, y, w, h, plate, true)],
  });
  const D = [];
  // chassis
  for (const s of [-1, 1]) K.add('trim', box(0.12, 0.26, 7.2, s * 0.46, 0.8, -0.1), 0x151515);
  // --- cab
  const c0 = 1.95, c1 = 3.5, cy0 = 1.05, cW0 = 1.88, cW1 = 2.6, cR = 2.9;
  K.add('paint', box(W - 0.06, cW0 - cy0, c1 - c0, 0, (cy0 + cW0) / 2, (c0 + c1) / 2), P.cab);
  K.add('paint', box(W - 0.05, 0.14, c1 - c0 + 0.012, 0, 1.6, (c0 + c1) / 2), P.band);
  K.add('glass', box(W - 0.08, cW1 - cW0, c1 - c0 - 0.02, 0, (cW0 + cW1) / 2, (c0 + c1) / 2));
  for (const s of [-1, 1]) {
    K.add('paint', box(0.03, cW1 - cW0, 0.55, s * (hw - 0.035), (cW0 + cW1) / 2, c0 + 0.27), P.cab);
    K.add('paint', box(0.03, cW1 - cW0, 0.12, s * (hw - 0.035), (cW0 + cW1) / 2, c1 - 0.06), P.cab);
    K.add('paint', box(0.13, cW1 - cW0, 0.03, s * (hw - 0.095), (cW0 + cW1) / 2, c1 + 0.003), P.cab);
    K.add('trim', box(0.03, cy0 - 0.02 + 0.02, 0.03, s * (hw - 0.03), (cy0 + cW0) / 2, c0 + 0.8), 0x111111);
  }
  K.add('trim', box(0.07, cW1 - cW0, 0.03, 0, (cW0 + cW1) / 2, c1 + 0.008), 0x111111);
  for (const s of [-1, 1]) K.add('trim', box(0.72, 0.025, 0.02, s * 0.45, cW0 + 0.08, c1 + 0.024, 0, 0, s * 0.3), 0x0d0d0d);
  K.add('paint', rbox(W - 0.06, cR - cW1 + 0.12, c1 - c0, 0.1, 0, (cR + cW1 - 0.12) / 2, (c0 + c1) / 2), P.cab);
  // nose / grille / lights
  K.add('paint', box(W - 0.2, 0.62, 0.32, 0, 1.33, c1 + 0.16), P.nose);
  K.add('trim', box(1.1, 0.4, 0.02, 0, 1.36, c1 + 0.325), 0x0e0e0e);
  for (let i = 0; i < 9; i++) K.add('metal', box(0.035, 0.36, 0.02, -0.48 + i * 0.12, 1.36, c1 + 0.338), 0xd5d8db);
  for (const s of [-1, 1]) {
    K.add('lens', cyl(0.11, 0.11, 0.04, 14, 'z', s * 0.86, 1.3, c1 + 0.335), 0xf3f1e8);
    K.add('metal', xf(new THREE.TorusGeometry(0.115, 0.014, 4, 10), s * 0.86, 1.3, c1 + 0.355), 0xd8dbde);
    K.add('lens', box(0.12, 0.07, 0.03, s * 0.86, 1.52, c1 + 0.33), 0xff9a1a);
    K.add('metal', rod(s * (hw - 0.03), 2.45, c1 - 0.2, s * (hw + 0.25), 2.6, c1 + 0.25, 0.018), 0x2b2b2b);
    K.add('metal', rod(s * (hw + 0.25), 2.6, c1 + 0.25, s * (hw + 0.25), 2.3, c1 + 0.28, 0.016), 0x2b2b2b);
    K.add('trim', box(0.06, 0.4, 0.22, s * (hw + 0.27), 2.1, c1 + 0.28), 0x111111);
    K.add('trim', guard(0.57, 0.36, -0.25, 2.3, s * 1.02, WR, fz), 0x151515);
    K.add('trim', box(0.4, 0.06, 0.25, s * (hw - 0.15), 0.78, c0 - 0.05), 0x222222);
  }
  // bumper with hazard stripes
  const bw = W + 0.06;
  for (let i = 0; i < 12; i++) K.add('paint', box(bw / 12, 0.26, 0.18, -bw / 2 + (i + 0.5) * bw / 12, 0.86, zF - 0.02), i % 2 ? 0x111111 : 0xf2c200);
  D.push(quad(0.5, 0.13, AT.uv.plate, 0, 0.86, zF + 0.072));
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) K.add('trim', box(0.03, 0.26, 0.006, s * (bw / 2 - 0.05 - k * 0.04), 0.6, zF + 0.075, 0, 0, r.range(-0.1, 0.1)), r.pick([0x111111, 0xd62828, 0xffc300]));
  // crown (taj) over the windshield
  const cra = 0.28, crc = new THREE.Vector3(0, 3.06, c1 + 0.1);
  K.add('paint', box(W + 0.1, 0.55, 0.06, crc.x, crc.y, crc.z, cra, 0, 0), P.cab);
  const nY = -Math.sin(cra), nZ = Math.cos(cra);
  D.push(quad(W + 0.04, 0.5, AT.uv.crown, 0, crc.y + nY * 0.032, crc.z + nZ * 0.032, 0, cra));
  for (let i = 0; i < 9; i++) {
    const x = -hw + 0.1 + i * (W - 0.2) / 8;
    K.add('lens', box(0.07, 0.05, 0.05, x, crc.y + Math.cos(cra) * 0.29, crc.z + Math.sin(cra) * 0.29), [0xff3b3b, 0xffd60a, 0x38b000, 0x3a86ff][i % 4]);
  }
  for (const s of [-1, 1]) K.add('metal', rod(s * (hw - 0.15), cR - 0.02, c1 - 0.2, s * (hw - 0.15), crc.y - 0.1, crc.z - 0.05, 0.02), 0x5a5a5a);
  // tank & battery
  K.add('metal', cyl(0.27, 0.27, 1.0, 14, 'z', -(hw - 0.35), 0.82, 1.05), 0xc5c9cd);
  K.add('trim', box(0.45, 0.4, 0.5, hw - 0.3, 0.82, 1.2), 0x1d1d1d);
  // --- cargo body
  const b0 = zR, b1 = 1.85, by0 = 1.12, by1 = 2.35;
  K.add('trim', box(W - 0.02, 0.14, b1 - b0, 0, by0 - 0.06, (b0 + b1) / 2), 0x3b2a1d);
  for (const s of [-1, 1]) K.add('paint', box(0.06, by1 - by0, b1 - b0, s * (hw - 0.03), (by0 + by1) / 2, (b0 + b1) / 2), P.cargo);
  K.add('paint', box(W - 0.06, 3.2 - by0, 0.08, 0, (by0 + 3.2) / 2, b1 - 0.04), P.cargo);
  K.add('paint', box(W - 0.06, by1 - by0, 0.08, 0, (by0 + by1) / 2, b0 + 0.04), P.cargo);
  for (const s of [-1, 1]) K.add('trim', box(0.1, 0.07, b1 - b0, s * (hw - 0.03), by1 + 0.035, (b0 + b1) / 2), 0x4a3020);
  for (let z = b0 + 0.55; z < b1 - 0.3; z += 1.12) for (const s of [-1, 1]) K.add('trim', box(0.08, by1 - by0 + 0.1, 0.08, s * (hw + 0.006), (by0 + by1) / 2 + 0.02, z), 0x3d2817);
  for (const s of [-1, 1]) D.push(quad(b1 - b0 - 0.1, by1 - by0 - 0.06, AT.uv.side, s * (hw + 0.003), (by0 + by1) / 2, (b0 + b1) / 2, s * Math.PI / 2));
  D.push(quad(W - 0.12, by1 - by0 - 0.06, AT.uv.tail, 0, (by0 + by1) / 2, b0 - 0.003, Math.PI));
  // tarp load + ropes
  const tl = b1 - b0 - 0.25;
  K.add('trim', rbox(W - 0.16, 0.95, tl, 0.26, 0, by1 + 0.3, (b0 + b1) / 2 - 0.05), tarp);
  for (let z = b0 + 0.45; z < b1 - 0.3; z += 0.8) {
    K.add('trim', box(W - 0.3, 0.02, 0.05, 0, by1 + 0.78, z), 0x2a2116);
    for (const s of [-1, 1]) K.add('trim', box(0.02, 0.5, 0.05, s * (hw - 0.075), by1 + 0.5, z), 0x2a2116);
  }
  // rear: under-ride bar (hazard), lights, plate, tassels, mudflaps
  for (let i = 0; i < 10; i++) K.add('paint', box((W - 0.2) / 10, 0.14, 0.1, -hw + 0.1 + (i + 0.5) * (W - 0.2) / 10, 0.62, zR - 0.03), i % 2 ? 0x111111 : 0xf2c200);
  for (const s of [-1, 1]) {
    K.add('lens', box(0.18, 0.12, 0.04, s * 0.95, 0.86, zR - 0.03), 0xc8141c);
    K.add('lens', box(0.18, 0.08, 0.04, s * 0.95, 0.98, zR - 0.03), 0xff9a1a);
    K.add('trim', box(0.62, 0.5, 0.02, s * (hw - 0.36), 0.42, rz - 0.66), 0x111111);
    K.add('lens', box(0.14, 0.06, 0.01, s * (hw - 0.36), 0.3, rz - 0.675), 0xd01818);
    K.add('trim', guard(0.58, 0.66, 0.15, 2.7, s * 0.86, WR, rz), 0x151515);
  }
  D.push(quad(0.5, 0.13, AT.uv.plate, 0, 0.88, zR - 0.025, Math.PI));
  for (let i = 0; i < 14; i++) {
    const x = -1.04 + i * 0.16;
    K.add('trim', box(0.035, 0.28, 0.006, x, 0.41, zR - 0.085, 0, 0, r.range(-0.1, 0.1)), r.pick([0x111111, 0xd62828, 0xffc300, 0x111111, 0x1d4fbf]));
  }
  K.add('decal', mergeGeometries(D.map(prep), false));
  const group = new THREE.Group(); group.name = 'truck';
  const body = new THREE.Group(); body.name = 'body'; group.add(body);
  const spareQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const wf = wheelSet(wheelGeo(WR, 0.3, 'heavy', false), [
    { x: hw - 0.2, y: WR, z: fz }, { x: -(hw - 0.2), y: WR, z: fz, flip: true }, { x: 0, y: 0.6, z: -3.05, fixedQ: spareQ },
  ]);
  const wr = wheelSet(wheelGeo(WR, 0.62, 'heavy', true), [{ x: hw - 0.36, y: WR, z: rz }, { x: -(hw - 0.36), y: WR, z: rz, flip: true }]);
  finish(group, body, K, decalMaterial(AT.tex, null, 0.5, 0.05), [wf.mesh, wr.mesh]);
  let ang = 0; const ph = r() * 10;
  return {
    group, dims: { length: L, width: W, height: 3.3 }, wheelRadius: WR, kind: 'truck',
    update(dt, time = 0, st = {}) {
      const v = st.speed || 0;
      if (v) { ang += (v / WR) * dt; wf.set(ang); wr.set(ang); }
      const k = Math.min(1, Math.abs(v) / 8);
      body.position.y = Math.sin(time * 5.7 + ph) * 0.014 * k;
      body.rotation.z = Math.sin(time * 1.7 + ph) * 0.008 * k;
    },
  };
}

/** convenience: random vehicle by kind name */
export function createVehicle(kind, opts = {}) {
  switch (kind) {
    case 'bus': return createBus(opts);
    case 'jeep': return createJeep(opts);
    case 'truck': return createTruck(opts);
    case 'auto': return createAuto(opts);
    default: return createCar(opts);
  }
}

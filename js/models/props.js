// Roadside props for the Ramnagar → Ranikhet hill road: milestones, road signs (green / blue / BRO yellow / warning /
// forest brown), start & finish gates, steel truss bridge, festive bunting, hoardings, and single-geometry templates
// for InstancedMesh (poles, street lights, black-white parapets, guard-rail posts, chevrons, reflector posts, 200 m stones).
// Conventions: Y up, faces +Z, left = +X, origin on the ground, metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { roundRect } from '../core/util.js';

const HI = '"Noto Sans Devanagari","Kohinoor Devanagari","Devanagari Sangam MN",sans-serif';
const EN = '"Rajdhani","Arial Narrow","Helvetica Neue",Arial,sans-serif';
const isHindi = t => /[ऀ-ॿ]/.test(t);
const fontFor = (t, px, weight = 'bold') => `${weight} ${Math.round(px)}px ${isHindi(t) ? HI : EN}`;

export const PLACES_HI = {
  RAMNAGAR: 'रामनगर', RANIKHET: 'रानीखेत', MOHAN: 'मोहान', BHATRONJKHAN: 'भतरौंजखान', GARJIYA: 'गर्जिया', DHIKULI: 'ढिकुली',
  KUMERIA: 'कुमेरिया', MARCHULA: 'मर्चुला', ALMORA: 'अल्मोड़ा', NAINITAL: 'नैनीताल', HALDWANI: 'हल्द्वानी', KASHIPUR: 'काशीपुर',
  CORBETT: 'कॉर्बेट', CHAUBATIA: 'चौबटिया', MAJKHALI: 'मजखाली', KOSI: 'कोसी', SITABANI: 'सीतावनी', BHUJAN: 'भुजान',
  DEHRADUN: 'देहरादून', DELHI: 'दिल्ली', BAGESHWAR: 'बागेश्वर', DWARAHAT: 'द्वाराहाट', TADIKHET: 'ताड़ीखेत',
};

// ------------------------------------------------------------------ shared materials (+ cloth flutter)
export const propUniforms = { uTime: { value: 0 } };
/** call once per frame (optional) to animate flags / bunting / banners */
export function updateProps(time) { propUniforms.uTime.value = time; }

let PM = null;
function pm() {
  if (PM) return PM;
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.0, name: 'prop_vc' });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.7, name: 'prop_metal' });
  const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, name: 'prop_cloth' });
  cloth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = propUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\nattribute float aFlutter;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float flW = aFlutter;
      float flP = position.x * 1.9 + position.y * 0.7 + position.z * 1.3;
      transformed.z += sin(uTime * 5.2 + flP) * 0.07 * flW;
      transformed.x += sin(uTime * 3.7 + flP * 0.8) * 0.025 * flW;
      transformed.y += sin(uTime * 4.3 + flP * 1.1) * 0.012 * flW;`);
  };
  cloth.customProgramCacheKey = () => 'prop_cloth_flutter_v1';
  PM = { vc, metal, cloth };
  return PM;
}
const texMatCache = new Map();
function texMat(key, makeTex, opts = {}) {
  if (texMatCache.has(key)) return texMatCache.get(key);
  const tex = makeTex();
  const m = new THREE.MeshStandardMaterial({
    map: tex, roughness: opts.roughness ?? 0.55, metalness: 0.03, alphaTest: opts.alphaTest ?? 0, side: opts.side ?? THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, name: 'prop_tex_' + key.slice(0, 24),
  });
  texMatCache.set(key, m);
  return m;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ geometry helpers
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color(), _ya = new THREE.Vector3(0, 1, 0);
function xf(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _m.compose(_p, _q, _s); return g.applyMatrix4(_m); }
function paint(g, hex) {
  _c.set(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); return g;
}
/** per-vertex colour from a function of local position */
function paintFn(g, fn) {
  const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { _c.set(fn(p.getX(i), p.getY(i), p.getZ(i))); a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); return g;
}
function flutter(g, fn) {
  const p = g.attributes.position, n = p.count, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(a, 1)); return g;
}
const box = (w, h, d, x, y, z, rx, ry, rz) => xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
function cyl(rt, rb, h, seg, x, y, z, axis = 'y', open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return xf(g, x, y, z);
}
function rod(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A); const len = Math.max(1e-4, d.length());
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  return g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_ya, d.normalize()), _s));
}
/** half-disc prism (flat side down) of radius r, thickness t along Z, centred at x,y(base),z */
function halfDisc(r, t, x, y, z, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, t, seg, 1, false, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  return xf(g, x, y, z);
}
function quadUV(w, h, uv, x, y, z, ry = 0) {
  const g = new THREE.PlaneGeometry(w, h); const a = g.attributes.uv;
  a.setXY(0, uv[0], uv[3]); a.setXY(1, uv[2], uv[3]); a.setXY(2, uv[0], uv[1]); a.setXY(3, uv[2], uv[1]);
  return xf(g, x, y, z, 0, ry, 0);
}
const ATTRS = ['position', 'normal', 'uv', 'color', 'aFlutter'];
function mergeList(list) {
  const anyFl = list.some(g => g.attributes.aFlutter);
  const prepped = list.map(g0 => {
    let g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.color) paint(g, 0xffffff);
    if (anyFl && !g.attributes.aFlutter) g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    for (const k of Object.keys(g.attributes)) if (!ATTRS.includes(k) || (!anyFl && k === 'aFlutter')) g.deleteAttribute(k);
    return g;
  });
  return mergeGeometries(prepped, false);
}
class Kit {
  constructor() { this.L = new Map(); }
  add(mat, geo, color) { if (color != null) paint(geo, color); if (!this.L.has(mat)) this.L.set(mat, []); this.L.get(mat).push(geo); return geo; }
  build(name, { shadow = true } = {}) {
    const group = new THREE.Group(); group.name = name;
    for (const [mat, list] of this.L) {
      const g = mergeList(list); if (!g) continue;
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = shadow; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}
/** rounded-triangle path (canvas) */
function triPath(c, pts, r) {
  c.beginPath();
  for (let i = 0; i < 3; i++) {
    const p0 = pts[(i + 2) % 3], p1 = pts[i], p2 = pts[(i + 1) % 3];
    const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
    if (i === 0) c.moveTo(mx, my);
    c.arcTo(p1[0], p1[1], p2[0], p2[1], r);
  }
  c.closePath();
}

// ------------------------------------------------------------------ warning pictograms (canvas, unit coords, y down)
function pictogram(c, icon, cx, cy, s) {
  let d = 1;
  if (/Left$/.test(icon)) { d = -1; icon = icon.replace('Left', 'Right'); }
  c.save(); c.translate(cx, cy); c.scale(d * s, s);
  c.fillStyle = '#111'; c.strokeStyle = '#111'; c.lineCap = 'round'; c.lineJoin = 'round';
  const poly = (pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); };
  switch (icon) {
    case 'elephant':
      c.beginPath(); c.ellipse(-0.05, 0.02, 0.3, 0.19, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(0.23, -0.08, 0.15, 0, Math.PI * 2); c.fill();
      c.lineWidth = 0.075; c.beginPath(); c.moveTo(0.33, -0.02); c.quadraticCurveTo(0.45, 0.14, 0.38, 0.29); c.stroke();
      for (const lx of [-0.29, -0.17, 0.04, 0.15]) c.fillRect(lx, 0.1, 0.085, 0.25);
      c.lineWidth = 0.025; c.beginPath(); c.moveTo(-0.34, -0.04); c.lineTo(-0.41, 0.16); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 0.02; c.beginPath(); c.ellipse(0.15, -0.04, 0.07, 0.12, 0.2, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 0.025; c.beginPath(); c.moveTo(0.3, 0.04); c.quadraticCurveTo(0.36, 0.1, 0.43, 0.06); c.stroke();
      break;
    case 'curveRight':
      c.lineWidth = 0.11; c.beginPath(); c.moveTo(-0.08, 0.34); c.lineTo(-0.08, 0.04); c.quadraticCurveTo(-0.08, -0.16, 0.1, -0.2); c.stroke();
      poly([[0.32, -0.21], [0.1, -0.37], [0.1, -0.05]]);
      break;
    case 'hairpinRight':
      c.lineWidth = 0.1; c.beginPath(); c.moveTo(-0.15, 0.34); c.lineTo(-0.15, -0.06); c.arc(0, -0.06, 0.15, Math.PI, 0, false); c.lineTo(0.15, 0.12); c.stroke();
      poly([[0.15, 0.32], [-0.01, 0.1], [0.31, 0.1]]);
      break;
    case 'rocks':
      poly([[-0.38, 0.34], [-0.38, -0.36], [-0.05, 0.34]]);
      poly([[0.04, -0.27], [0.15, -0.3], [0.2, -0.2], [0.12, -0.12], [0.02, -0.16]]);
      poly([[0.16, -0.05], [0.26, -0.06], [0.28, 0.04], [0.19, 0.08], [0.13, 0.02]]);
      poly([[0.04, 0.16], [0.18, 0.12], [0.24, 0.24], [0.14, 0.33], [0.02, 0.28]]);
      break;
    case 'cattle':
      c.beginPath(); roundRect(c, -0.3, -0.12, 0.48, 0.22, 0.07); c.fill();
      for (const lx of [-0.27, -0.17, 0.05, 0.12]) c.fillRect(lx, 0.06, 0.06, 0.26);
      poly([[0.14, -0.13], [0.36, -0.06], [0.36, 0.05], [0.18, 0.06]]);
      c.lineWidth = 0.03; c.beginPath(); c.moveTo(0.21, -0.12); c.lineTo(0.19, -0.23); c.moveTo(0.27, -0.11); c.lineTo(0.31, -0.21); c.stroke();
      c.beginPath(); c.moveTo(-0.3, -0.07); c.lineTo(-0.38, 0.15); c.stroke();
      break;
    default: // deer / animals
      c.beginPath(); c.ellipse(-0.03, 0.0, 0.25, 0.1, -0.25, 0, Math.PI * 2); c.fill();
      poly([[0.13, -0.08], [0.28, -0.26], [0.36, -0.23], [0.22, -0.02]]);
      c.lineWidth = 0.035; c.beginPath();
      c.moveTo(0.29, -0.26); c.lineTo(0.24, -0.4); c.moveTo(0.26, -0.33); c.lineTo(0.18, -0.38);
      c.moveTo(0.33, -0.26); c.lineTo(0.36, -0.4); c.moveTo(0.35, -0.33); c.lineTo(0.43, -0.37); c.stroke();
      c.lineWidth = 0.05; c.beginPath();
      c.moveTo(0.14, 0.02); c.lineTo(0.34, 0.12); c.moveTo(0.1, 0.05); c.lineTo(0.27, 0.2);
      c.moveTo(-0.2, 0.06); c.lineTo(-0.38, 0.2); c.moveTo(-0.16, 0.08); c.lineTo(-0.3, 0.3); c.stroke();
  }
  c.restore();
}

// ================================================================== MILESTONE
/**
 * Indian highway kilometre stone. kind 'nh' = yellow top, 'sh' = green top.
 * opts: { place, km, kind, hi (Hindi name override), route ('NH 109' etc), back: {place, km} }
 */
export function createMilestone({ place = 'RANIKHET', km = 42, kind = 'nh', hi, route, back } = {}) {
  const M = pm();
  const W = 0.56, T = 0.22, Hr = 0.62, R = W / 2, base = 0.1, H = Hr + R;
  const top = kind === 'sh' ? 0x1f7a3c : 0xf2c40c;
  const K = new Kit();
  K.add(M.vc, box(0.7, base, 0.34, 0, base / 2, 0), 0x9a978f);
  K.add(M.vc, box(W, Hr, T, 0, base + Hr / 2, 0), 0xf1efe7);
  K.add(M.vc, halfDisc(R, T, 0, base + Hr, 0, 16), top);
  const P = String(place).toUpperCase();
  const faces = [{ place: P, km, hi: hi || PLACES_HI[P] }, back ? { place: String(back.place).toUpperCase(), km: back.km, hi: back.hi || PLACES_HI[String(back.place).toUpperCase()] } : { place: P, km, hi: hi || PLACES_HI[P] }];
  const key = `ms|${kind}|${route}|${faces.map(f => f.place + f.km).join('|')}`;
  const mat = texMat(key, () => canvasTex(512, 416, (c, w, h) => {
    faces.forEach((f, i) => {
      const x0 = i * 256, fw = 256, fh = 416;
      c.fillStyle = '#f2f0e8'; c.fillRect(x0, 0, fw, fh);
      const rpx = fw / 2, cyTop = fh * (R / H);
      c.fillStyle = kind === 'sh' ? '#1f7a3c' : '#f2c40c';
      c.beginPath(); c.arc(x0 + rpx, cyTop, rpx, Math.PI, 0); c.lineTo(x0 + fw, cyTop); c.lineTo(x0, cyTop); c.closePath(); c.fill();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = kind === 'sh' ? '#ffffff' : '#141414';
      c.font = `bold 46px ${EN}`; c.fillText(route || (kind === 'sh' ? 'SH' : 'NH'), x0 + fw / 2, cyTop * 0.62, fw * 0.8);
      c.fillStyle = '#141414';
      if (f.hi) { c.font = `bold 46px ${HI}`; c.fillText(f.hi, x0 + fw / 2, cyTop + 54, fw * 0.9); }
      c.font = `bold 40px ${EN}`; c.fillText(f.place, x0 + fw / 2, cyTop + (f.hi ? 112 : 70), fw * 0.92);
      c.font = `bold 92px ${EN}`; c.fillText(String(f.km), x0 + fw / 2, fh - 72, fw * 0.9);
    });
  }));
  // face shapes (front + back) with custom uv
  const shape = new THREE.Shape(); shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, Hr); shape.absarc(0, Hr, R, 0, Math.PI, false); shape.closePath();
  const faceGeo = (off) => {
    const g = new THREE.ShapeGeometry(shape, 12); const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, off + ((p.getX(i) + W / 2) / W) * 0.5, p.getY(i) / H);
    return g;
  };
  K.add(mat, xf(faceGeo(0), 0, base, T / 2 + 0.005));
  K.add(mat, xf(faceGeo(0.5), 0, base, -T / 2 - 0.005, 0, Math.PI, 0));
  return K.build('milestone');
}

// ================================================================== ROAD SIGNS
const SIGN = {
  welcome: { w: 4.2, h: 2.0, bg: '#0a6a39', fg: '#ffffff', border: '#ffffff', y0: 2.1, post: 'metal' },
  direction: { w: 3.4, h: 1.7, bg: '#0a6a39', fg: '#ffffff', border: '#ffffff', y0: 2.0, post: 'metal' },
  info: { w: 2.6, h: 1.25, bg: '#1b4f9e', fg: '#ffffff', border: '#ffffff', y0: 1.8, post: 'metal' },
  bro: { w: 2.0, h: 1.1, bg: '#f7c600', fg: '#111111', border: '#111111', y0: 1.25, post: 'striped' },
  forest: { w: 2.8, h: 1.5, bg: '#6b3d1b', fg: '#f6e7c6', border: '#f6e7c6', y0: 1.5, post: 'wood' },
  warning: { w: 1.0, h: 1.0, y0: 1.75, post: 'striped' },
};
const BRO_SLOGANS = [
  ['BE GENTLE', 'ON MY CURVES'], ['AFTER WHISKY', 'DRIVING RISKY'], ['PEEP PEEP', "DON'T SLEEP"], ['DARLING I LIKE YOU', 'BUT NOT SO FAST'],
  ['SPEED THRILLS', 'BUT KILLS'], ['DRIVE LIKE HELL', 'YOU WILL BE THERE'], ['LIFE IS SHORT', "DON'T MAKE IT SHORTER"], ['IF MARRIED', 'DIVORCE SPEED'],
];
export { BRO_SLOGANS };
function drawBoard(c, w, h, st, lines, kind) {
  c.fillStyle = st.bg; c.fillRect(0, 0, w, h);
  if (kind === 'forest') { // wood grain
    c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 3;
    for (let y = 18; y < h; y += 26) { c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= w; x += 40) c.lineTo(x, y + Math.sin(x * 0.02 + y) * 4); c.stroke(); }
  }
  const bw = Math.max(6, h * 0.035);
  c.strokeStyle = st.border; c.lineWidth = bw; roundRect(c, bw * 1.2, bw * 1.2, w - bw * 2.4, h - bw * 2.4, h * 0.05); c.stroke();
  const n = Math.max(1, lines.length);
  const avail = h * 0.82, lh = avail / n;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = st.fg;
  lines.forEach((t, i) => {
    const big = i === 0 && n > 1 && kind !== 'direction';
    const px = lh * (isHindi(t) ? 0.62 : 0.7) * (big ? 1.06 : 1);
    c.font = fontFor(t, px);
    let tx = w / 2, align = 'center';
    if (kind === 'direction') { if (/^[←↖↙]/.test(t)) { align = 'left'; tx = w * 0.07; } else if (/[→↗↘]$/.test(t)) { align = 'right'; tx = w * 0.93; } }
    c.textAlign = align;
    c.fillText(t, tx, h * 0.09 + lh * (i + 0.5), w * 0.86);
  });
}
/**
 * Road sign on post(s). kind: 'welcome'|'info'|'bro'|'warning'|'direction'|'forest'
 * lines: array of strings (Hindi or English). warning: icon 'elephant'|'curveLeft'|'curveRight'|'hairpinLeft'|'hairpinRight'|'rocks'|'cattle'|'deer'
 */
export function createSign({ kind = 'info', lines, w, h, icon } = {}) {
  const M = pm();
  const st = SIGN[kind] || SIGN.info;
  const K = new Kit();
  if (!lines) lines = kind === 'bro' ? BRO_SLOGANS[0] : kind === 'welcome' ? ['स्वागत है', 'WELCOME'] : [];
  if (kind === 'warning') {
    const txt = lines.join(' ');
    if (!icon) icon = /elephant|हाथी/i.test(txt) ? 'elephant' : /hair|u-turn/i.test(txt) ? 'hairpinRight' : /curve|मोड़/i.test(txt) ? 'curveRight'
      : /rock|land|slide/i.test(txt) ? 'rocks' : /cattle|cow/i.test(txt) ? 'cattle' : 'deer';
    const S = w || 1.0, hasPlate = lines.length > 0;
    const y0 = st.y0;
    const key = `warn|${icon}|${lines.join('/')}`;
    const mat = texMat(key, () => canvasTex(512, 704, (c) => {
      c.clearRect(0, 0, 512, 704);
      const T = [[256, 34], [490, 470], [22, 470]];
      c.fillStyle = '#c8102e'; triPath(c, T, 40); c.fill();
      c.fillStyle = '#ffffff'; triPath(c, [[256, 118], [418, 420], [94, 420]], 22); c.fill();
      pictogram(c, icon, 256, 318, 230);
      if (hasPlate) {
        c.fillStyle = '#ffffff'; roundRect(c, 14, 520, 484, 170, 16); c.fill();
        c.strokeStyle = '#111'; c.lineWidth = 8; roundRect(c, 24, 530, 464, 150, 12); c.stroke();
        c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle';
        const n = lines.length; lines.forEach((t, i) => { c.font = fontFor(t, 120 / n * (isHindi(t) ? 0.85 : 0.95)); c.fillText(t, 256, 530 + 150 * (i + 0.5) / n, 440); });
      }
    }), { alphaTest: 0.5, roughness: 0.72 });
    const vTri = [0, 1 - 512 / 704, 1, 1];
    K.add(mat, quadUV(S, S, vTri, 0, y0 + S / 2, 0.03));
    // grey back of triangle
    const tri = new THREE.Shape(); tri.moveTo(0, S * 0.43); tri.lineTo(S * 0.47, -S * 0.42); tri.lineTo(-S * 0.47, -S * 0.42); tri.closePath();
    K.add(M.vc, xf(new THREE.ShapeGeometry(tri), 0, y0 + S / 2 - S * 0.04, 0.02, 0, Math.PI, 0), 0x8d9195);
    let top = y0 + S * 0.9;
    if (hasPlate) {
      const pw = S * 0.92, ph = pw * 170 / 484;
      K.add(mat, quadUV(pw, ph, [14 / 512, 1 - 690 / 704, 498 / 512, 1 - 520 / 704], 0, y0 - ph / 2 - 0.05, 0.03));
      K.add(M.vc, box(pw, ph, 0.02, 0, y0 - ph / 2 - 0.05, 0.015), 0x8d9195);
    }
    postStriped(K, M, 0, top, -0.01);
    return K.build('sign_warning');
  }
  const W = w || st.w, H = h || st.h, y0 = st.y0;
  const pxW = 1024, pxH = Math.round(1024 * H / W);
  const key = `sign|${kind}|${W}x${H}|${lines.join('/')}`;
  const mat = texMat(key, () => canvasTex(pxW, pxH, (c, cw, ch) => drawBoard(c, cw, ch, st, lines, kind)), { roughness: 0.72 });
  K.add(mat, quadUV(W - 0.02, H - 0.02, [0, 0, 1, 1], 0, y0 + H / 2, 0.036));
  K.add(M.vc, box(W, H, 0.06, 0, y0 + H / 2, 0), kind === 'forest' ? 0x4a2a12 : 0x8d9195);
  const px = W * 0.34, topY = y0 + H - 0.08;
  for (const sx of (W < 1.2 ? [0] : [-px, px])) {
    if (st.post === 'striped') postStriped(K, M, sx, topY, -0.07);
    else if (st.post === 'wood') K.add(M.vc, box(0.12, topY, 0.12, sx, topY / 2, -0.09), 0x5a3a1c);
    else K.add(M.vc, cyl(0.045, 0.05, topY, 8, sx, topY / 2, -0.075), 0x9ea3a8);
  }
  if (kind === 'forest') K.add(M.vc, box(W + 0.3, 0.1, 0.12, 0, y0 + H + 0.05, 0), 0x4a2a12); // little roof cap
  return K.build('sign_' + kind);
}
function postStriped(K, M, x, top, z) {
  const band = 0.25; let y = 0, i = 0;
  while (y < top - 1e-3) { const hh = Math.min(band, top - y); K.add(M.vc, box(0.07, hh, 0.07, x, y + hh / 2, z), i % 2 ? 0x141414 : 0xf2f2ee); y += hh; i++; }
}

// ================================================================== START / FINISH GATE
function trussRods(A, B, s, r, out) {
  // square truss between points A and B (vectors), cross-section s, chords radius r
  const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B);
  const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(s / 2);
  const v = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(s / 2);
  const corners = [u.clone().add(v), u.clone().sub(v), u.clone().negate().sub(v), u.clone().negate().add(v)];
  for (const c of corners) out.push(rod(a.clone().add(c).toArray(), b.clone().add(c).toArray(), r, 6));
  const n = Math.max(2, Math.round(len / s));
  for (let f = 0; f < 4; f++) {
    const c0 = corners[f], c1 = corners[(f + 1) % 4];
    for (let i = 0; i < n; i++) {
      const p0 = a.clone().addScaledVector(dir, len * i / n), p1 = a.clone().addScaledVector(dir, len * (i + 1) / n);
      const [ca, cb] = i % 2 ? [c1, c0] : [c0, c1];
      out.push(rod(p0.clone().add(ca).toArray(), p1.clone().add(cb).toArray(), r * 0.55, 4));
    }
  }
}
function drawBanner(c, w, h, title, subtitle, finishStyle, col) {
  if (finishStyle) {
    c.fillStyle = col.primary || '#c1121f'; c.fillRect(0, 0, w, h);
    const sq = h * 0.12;
    for (let row = 0; row < 2; row++) for (let i = 0; i * sq < w; i++) {
      c.fillStyle = (i + row) % 2 ? '#111' : '#fff'; c.fillRect(i * sq, row * sq, sq, sq);
      c.fillStyle = (i + row) % 2 ? '#fff' : '#111'; c.fillRect(i * sq, h - (row + 1) * sq, sq, sq);
    }
  } else {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col.primary || '#ff8f1f'); g.addColorStop(1, col.secondary || '#d9480f');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = col.band || '#7a1405'; c.fillRect(0, 0, w, h * 0.13); c.fillRect(0, h * 0.87, w, h * 0.13);
    for (let i = 0; i * 26 < w; i++) { c.fillStyle = i % 2 ? '#ffd23f' : '#ff9f1c'; c.beginPath(); c.arc(13 + i * 26, h * 0.065, 9, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(13 + i * 26, h * 0.935, 9, 0, Math.PI * 2); c.fill(); }
  }
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  const ty = subtitle ? h * 0.43 : h * 0.5;
  c.font = fontFor(title, h * 0.44, '900');
  c.lineWidth = h * 0.05; c.strokeStyle = 'rgba(30,8,0,0.85)'; c.strokeText(title, w / 2, ty, w * 0.92);
  c.fillStyle = '#ffffff'; c.fillText(title, w / 2, ty, w * 0.92);
  if (subtitle) {
    c.font = fontFor(subtitle, h * 0.17); c.fillStyle = finishStyle ? '#ffffff' : '#fff3c4';
    c.fillText(subtitle, w / 2, h * 0.76, w * 0.9);
  }
}
/**
 * Arch over a 10 m road. Pillars at x = ±6.5, banner (12 × 1.5 m) bottom at 5.3 m, faces both +Z and −Z.
 * colors: { primary, secondary, band, wrapA, wrapB }  — finish style auto when title contains FINISH.
 */
export function createGate({ title = 'RAMNAGAR — START', subtitle = 'रामनगर  ➜  रानीखेत', colors = {} } = {}) {
  const M = pm();
  const K = new Kit();
  const finishStyle = /finish|समापन/i.test(title);
  const col = finishStyle ? { primary: '#c1121f', wrapA: 0x111111, wrapB: 0xf4f4f0, ...colors } : { primary: '#ff8f1f', secondary: '#e8590c', band: '#7a1405', wrapA: 0xff8c00, wrapB: 0xc1121f, ...colors };
  const PX = 6.5, PH = 7.4, S = 0.46;
  const truss = [];
  for (const sx of [-PX, PX]) trussRods([sx, 0, 0], [sx, PH, 0], S, 0.028, truss);
  trussRods([-PX - S / 2, PH - S / 2, 0], [PX + S / 2, PH - S / 2, 0], S, 0.028, truss);
  for (const g of truss) K.add(M.metal, g, 0xc9cdd1);
  for (const sx of [-PX, PX]) {
    K.add(M.vc, box(0.95, 0.42, 0.95, sx, 0.21, 0), 0x8f8c86);              // ballast block
    for (let i = 0; i < 9; i++) K.add(M.vc, cyl(0.33, 0.33, 0.5, 10, sx, 0.62 + i * 0.5, 0, 'y', true), i % 2 ? col.wrapB : col.wrapA);
    K.add(M.metal, rod([sx, PH, 0], [sx, PH + 1.7, 0], 0.025), 0xd0d4d8);    // flag pole
    const fl = new THREE.BufferGeometry();
    fl.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.56, 0, 0.95, -0.28, 0], 3)); fl.computeVertexNormals();
    flutter(fl, (x) => x / 0.95);
    xf(fl, sx, PH + 1.68, 0, 0, sx < 0 ? Math.PI : 0, 0);
    K.add(M.cloth, fl, finishStyle ? 0xf4f4f0 : 0xff6d00);
  }
  // banner (both faces) + frame
  const BW = 12.0, BH = 1.5, by = 6.05;
  const key = `gate|${title}|${subtitle}|${finishStyle}|${JSON.stringify(colors)}`;
  const bmat = texMat(key, () => canvasTex(2048, 256, (c, w, h) => drawBanner(c, w, h, title, subtitle, finishStyle, col)), { roughness: 0.7 });
  K.add(bmat, quadUV(BW, BH, [0, 0, 1, 1], 0, by, 0.27));
  K.add(bmat, quadUV(BW, BH, [0, 0, 1, 1], 0, by, -0.27, Math.PI));
  K.add(M.vc, box(BW, BH, 0.5, 0, by, 0), 0x2a2a2a);
  for (const y of [by + BH / 2, by - BH / 2]) K.add(M.metal, rod([-BW / 2, y, 0.28], [BW / 2, y, 0.28], 0.03), 0xb9bdc1);
  for (const x of [-5, -2.5, 0, 2.5, 5]) K.add(M.metal, rod([x, by + BH / 2, 0], [x, PH - S, 0], 0.02), 0x9a9ea2);
  // marigold swags under the banner (front and back)
  const ico = new THREE.IcosahedronGeometry(0.06, 0);
  for (const zf of [0.3, -0.3]) for (let k = 0; k < 6; k++) {
    const x0 = -BW / 2 + 0.2 + k * (BW - 0.4) / 6, x1 = x0 + (BW - 0.4) / 6;
    const n = 15;
    for (let i = 0; i <= n; i++) {
      const t = i / n; const x = x0 + (x1 - x0) * t; const y = by - BH / 2 - 0.05 - Math.sin(Math.PI * t) * 0.38;
      K.add(M.vc, xf(ico.clone(), x, y, zf), i % 2 ? 0xffb703 : 0xff7b00);
    }
    // hanging tassel strand at each swag joint
    for (let i = 0; i < 5; i++) K.add(M.vc, xf(ico.clone(), x0, by - BH / 2 - 0.08 - i * 0.12, zf), i % 2 ? 0xffb703 : 0xff5d00);
  }
  return K.build(finishStyle ? 'gate_finish' : 'gate_start');
}

// ================================================================== STEEL TRUSS BRIDGE
/** deck top at y = 0 (slightly below: -0.01), spans along Z centred on origin. opts: {length, width, name} */
export function createBridge({ length = 40, width = 8.5, name } = {}) {
  const M = pm();
  const K = new Kit();
  const L = length, W = width, hw = W / 2;
  const STEEL = 0xaeb4b9, STEEL2 = 0x8f969c;
  // deck & girders
  K.add(M.vc, box(W, 0.42, L, 0, -0.22, 0), 0x3a3c3f);
  for (const s of [-1, 1]) {
    K.add(M.vc, box(0.85, 0.26, L, s * (hw - 0.425), 0.12, 0), 0xa7a49d);           // footpath
    const segs = Math.round(L / 1.0);
    for (let i = 0; i < segs; i++) K.add(M.vc, box(0.05, 0.26, L / segs, s * (hw - 0.875), 0.12, -L / 2 + (i + 0.5) * L / segs), i % 2 ? 0x161616 : 0xf2c200); // kerb paint
  }
  for (const x of [-2.6, 0, 2.6]) K.add(M.metal, box(0.32, 0.8, L, x, -0.83, 0), STEEL2);
  // trusses
  const n = Math.max(4, Math.round(L / 5)), p = L / n, TH = 5.4, xs = hw + 0.2;
  for (const s of [-1, 1]) {
    const x = s * xs;
    K.add(M.metal, box(0.32, 0.5, L, x, 0.12, 0), STEEL);                               // bottom chord
    K.add(M.metal, box(0.34, 0.38, L - 2 * p, x, TH, 0), STEEL);                         // top chord
    for (const e of [-1, 1]) K.add(M.metal, beam([x, 0.2, e * L / 2], [x, TH, e * (L / 2 - p)], 0.3, 0.34), STEEL); // end posts
    for (let i = 1; i < n; i++) { const z = -L / 2 + i * p; K.add(M.metal, box(0.22, TH - 0.2, 0.22, x, (TH + 0.2) / 2, z), STEEL); }
    for (let i = 1; i < n - 1; i++) {
      const z0 = -L / 2 + i * p, z1 = z0 + p;
      const toCenter = (z0 + z1) / 2 < 0;
      K.add(M.metal, toCenter ? beam([x, TH, z0], [x, 0.3, z1], 0.16, 0.2) : beam([x, 0.3, z0], [x, TH, z1], 0.16, 0.2), STEEL);
    }
    K.add(M.metal, rod([s * (hw - 0.04), 1.05, -L / 2], [s * (hw - 0.04), 1.05, L / 2], 0.035), STEEL); // hand rail
    K.add(M.metal, rod([s * (hw - 0.04), 0.6, -L / 2], [s * (hw - 0.04), 0.6, L / 2], 0.03), STEEL);
  }
  for (let i = 1; i < n; i++) { // top lateral bracing
    const z = -L / 2 + i * p;
    K.add(M.metal, box(xs * 2, 0.3, 0.22, 0, TH, z), STEEL2);
    if (i < n - 1) { K.add(M.metal, rod([-xs, TH, z], [xs, TH, z + p], 0.04), STEEL2); K.add(M.metal, rod([xs, TH, z], [-xs, TH, z + p], 0.04), STEEL2); }
  }
  for (const e of [-1, 1]) { // portal frames + knee braces
    const z = e * (L / 2 - p);
    K.add(M.metal, box(xs * 2, 0.6, 0.26, 0, TH - 0.4, z), STEEL);
    for (const s of [-1, 1]) K.add(M.metal, rod([s * xs, TH - 1.4, z], [s * (xs - 1.0), TH - 0.4, z], 0.05), STEEL);
  }
  // abutments (+ pier for long spans)
  for (const e of [-1, 1]) K.add(M.vc, box(W + 1.4, 6.5, 2.6, 0, -3.26, e * (L / 2 + 1.3)), 0x8c8a84);
  if (L > 46) K.add(M.vc, box(W - 1, 12, 2.2, 0, -7.2, 0), 0x86847e);
  if (name) {
    const key = `bridge|${name}`;
    const mat = texMat(key, () => canvasTex(1024, 192, (c, w, h) => {
      c.fillStyle = '#0a6a39'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
      const hi = PLACES_HI[String(name).split(' ')[0].toUpperCase()];
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      if (hi) { c.font = `bold 62px ${HI}`; c.fillText(`${hi} पुल`, w / 2, h * 0.36, w * 0.9); }
      c.font = `bold 58px ${EN}`; c.fillText(String(name).toUpperCase(), w / 2, hi ? h * 0.74 : h * 0.5, w * 0.9);
    }));
    for (const e of [-1, 1]) {
      const z = e * (L / 2 - p) + e * 0.14;
      K.add(mat, quadUV(3.6, 0.68, [0, 0, 1, 1], 0, TH - 0.4, z, e > 0 ? 0 : Math.PI));
    }
  }
  return K.build('bridge');
}
function beam(a, b, w, h) { // rectangular member from a to b
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A); const len = d.length();
  const g = new THREE.BoxGeometry(w, len, h);
  return g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_ya, d.normalize()), _s));
}

// ================================================================== BUNTING
/** festive pennant line spanning X from -length/2..length/2 (ends at y=0), sagging down. Flutters if updateProps() is called. */
export function createBunting({ length = 12, sag = 0.8, colors } = {}) {
  const M = pm();
  const K = new Kit();
  const cols = colors || [0xff8c00, 0xffd60a, 0x2a9d47, 0xe63946, 0x1d4fbf, 0xff4fa3, 0xf4f4f0];
  const yAt = x => -sag * (1 - (2 * x / length) ** 2);
  const n = Math.max(2, Math.floor(length / 0.42));
  for (let i = 0; i < 24; i++) { // string
    const x0 = -length / 2 + length * i / 24, x1 = -length / 2 + length * (i + 1) / 24;
    K.add(M.cloth, rod([x0, yAt(x0), 0], [x1, yAt(x1), 0], 0.008, 3), 0x2b2b2b);
  }
  for (let i = 0; i < n; i++) {
    const xc = -length / 2 + (i + 0.5) * length / n, y = yAt(xc);
    const fw = 0.3, fh = 0.4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-fw / 2, 0, 0, fw / 2, 0, 0, 0, -fh, 0], 3)); g.computeVertexNormals();
    flutter(g, (x, yy) => -yy / fh);
    K.add(M.cloth, xf(g, xc, y - 0.01, 0), cols[i % cols.length]);
  }
  return K.build('bunting', { shadow: false });
}

// ================================================================== HOARDING / BILLBOARD
const AD_THEMES = [
  { a: '#0f5132', b: '#2f9e44', fg: '#fff8dc', acc: '#ffd43b' }, { a: '#0b3d91', b: '#4dabf7', fg: '#ffffff', acc: '#ffe066' },
  { a: '#7a1f0b', b: '#e8590c', fg: '#fff4e6', acc: '#ffe066' }, { a: '#3b1f5c', b: '#9c36b5', fg: '#ffffff', acc: '#63e6be' },
];
/** billboard on steel legs. lines[0] = headline. default fictional ad. */
export function createHoarding({ lines = ['PAHADI CHAI', 'असली पहाड़ी स्वाद', 'Ramnagar • Ranikhet'], w = 6, h = 3, theme } = {}) {
  const M = pm();
  const K = new Kit();
  const y0 = 2.6;
  let hsh = 0; for (const ch of lines.join('')) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const T = AD_THEMES[theme ?? hsh % AD_THEMES.length];
  for (const sx of [-w * 0.3, w * 0.3]) { K.add(M.metal, box(0.22, y0 + h * 0.6, 0.28, sx, (y0 + h * 0.6) / 2, -0.25), 0x6f757b); K.add(M.vc, box(0.6, 0.3, 0.6, sx, 0.15, -0.25), 0x8f8c86); }
  K.add(M.metal, box(w + 0.16, h + 0.16, 0.1, 0, y0 + h / 2, -0.06), 0x50565c);
  K.add(M.metal, box(w * 0.9, 0.05, 0.55, 0, y0 - 0.12, 0.25), 0x6f757b);
  K.add(M.metal, rod([-w * 0.45, y0 + 0.35, 0.5], [w * 0.45, y0 + 0.35, 0.5], 0.02), 0x8a9096);
  for (const x of [-w * 0.33, 0, w * 0.33]) { K.add(M.metal, rod([x, y0 + h + 0.05, -0.05], [x, y0 + h + 0.35, 0.55], 0.025), 0x50565c); K.add(M.metal, box(0.3, 0.1, 0.18, x, y0 + h + 0.35, 0.6), 0x2b2f33); }
  const key = `ad|${lines.join('/')}|${w}x${h}|${theme}`;
  const mat = texMat(key, () => canvasTex(1024, Math.round(1024 * h / w), (c, cw, ch) => {
    const g = c.createLinearGradient(0, 0, 0, ch); g.addColorStop(0, T.b); g.addColorStop(1, T.a);
    c.fillStyle = g; c.fillRect(0, 0, cw, ch);
    c.fillStyle = 'rgba(255,240,200,0.9)'; c.beginPath(); c.arc(cw * 0.82, ch * 0.3, ch * 0.12, 0, Math.PI * 2); c.fill();
    const hills = [[0.55, 'rgba(0,0,0,0.18)'], [0.68, 'rgba(0,0,0,0.28)'], [0.8, 'rgba(0,0,0,0.38)']];
    hills.forEach(([hy, cc], k) => { c.fillStyle = cc; c.beginPath(); c.moveTo(0, ch); for (let x = 0; x <= cw; x += 16) c.lineTo(x, ch * hy + Math.sin(x * (0.01 + k * 0.004) + k * 2) * ch * 0.06 + Math.sin(x * 0.031 + k) * ch * 0.02); c.lineTo(cw, ch); c.fill(); });
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.moveTo(cw * 0.6, ch * 0.62); c.lineTo(cw * 0.68, ch * 0.5); c.lineTo(cw * 0.76, ch * 0.62); c.fill();
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    lines.forEach((t, i) => {
      const px = i === 0 ? ch * 0.2 : ch * 0.105;
      c.font = fontFor(t, px, i === 0 ? '900' : 'bold');
      const y = ch * (i === 0 ? 0.22 : 0.4 + i * 0.13);
      if (i === 0) { c.lineWidth = px * 0.12; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.strokeText(t, cw * 0.06, y, cw * 0.66); }
      c.fillStyle = i === 0 ? T.acc : T.fg; c.fillText(t, cw * 0.06, y, cw * 0.66);
    });
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, ch * 0.9, cw, ch * 0.1);
    c.fillStyle = '#fff'; c.font = `bold ${Math.round(ch * 0.055)}px ${EN}`; c.textAlign = 'right'; c.fillText('UTTARAKHAND • देवभूमि', cw * 0.97, ch * 0.95);
  }), { roughness: 0.6 });
  K.add(mat, quadUV(w, h, [0, 0, 1, 1], 0, y0 + h / 2, 0.0));
  return K.build('hoarding');
}

// ================================================================== INSTANCING TEMPLATES
const TPL = new Map();
/**
 * Single geometry + single material for InstancedMesh.
 * names: 'pole' | 'streetlight' | 'parapet' | 'barrierPost' | 'chevron' | 'chevronLeft' | 'reflectorPost' | 'milestoneSmall'
 * Orientation: face / front toward +Z (chevron board faces +Z; streetlight arm reaches toward +Z; barrier rail-mount on +Z side).
 * 'parapet' is 2.0 m long along Z (place end-to-end for a continuous wall, or with gaps).
 * Extra fields: height, length (parapet), anchors (pole: wire attach points; streetlight: lamp position).
 */
export function getPropTemplate(name) {
  if (TPL.has(name)) return TPL.get(name);
  const M = pm();
  const L = [];
  let material = M.vc, extra = {};
  const add = (g, col) => { L.push(typeof col === 'function' ? paintFn(g, col) : paint(g, col)); return g; };
  switch (name) {
    case 'pole': {
      const H = 8.5;
      const shaft = new THREE.CylinderGeometry(0.07, 0.115, H, 4, 4); shaft.rotateY(Math.PI / 4); shaft.translate(0, H / 2, 0);
      add(shaft, (x, y) => (y < 0.6 ? 0x6f6a60 : y < 2 ? 0x8b877e : 0x9d9b95));
      add(box(1.7, 0.09, 0.09, 0, 8.02, 0), 0x45494d);
      add(rod([-0.55, 7.98, 0], [0, 7.62, 0], 0.025, 4), 0x45494d); add(rod([0.55, 7.98, 0], [0, 7.62, 0], 0.025, 4), 0x45494d);
      for (const x of [-0.72, 0.72]) { add(cyl(0.012, 0.012, 0.1, 4, x, 8.1, 0), 0x45494d); add(cyl(0.05, 0.065, 0.06, 8, x, 8.17, 0), 0x7a3b22); add(cyl(0.035, 0.05, 0.06, 8, x, 8.23, 0), 0x7a3b22); }
      add(box(0.06, 0.32, 0.06, 0, H + 0.12, 0), 0x45494d); add(cyl(0.05, 0.065, 0.06, 8, 0, H + 0.31, 0), 0x7a3b22); add(cyl(0.035, 0.05, 0.06, 8, 0, H + 0.37, 0), 0x7a3b22);
      add(box(1.25, 0.07, 0.07, 0, 6.9, 0), 0x45494d);
      for (const x of [-0.55, -0.2, 0.2, 0.55]) add(cyl(0.035, 0.035, 0.07, 8, x, 6.98, 0, 'z'), 0xe9e5da);
      add(box(0.2, 0.26, 0.01, 0, 2.6, 0.07), 0xc1121f); add(box(0.15, 0.06, 0.012, 0, 2.62, 0.07), 0xf4f4f0); // danger plate
      extra = { height: H + 0.4, anchors: [new THREE.Vector3(-0.72, 8.26, 0), new THREE.Vector3(0, H + 0.4, 0), new THREE.Vector3(0.72, 8.26, 0), new THREE.Vector3(-0.55, 7.02, 0), new THREE.Vector3(-0.2, 7.02, 0), new THREE.Vector3(0.2, 7.02, 0), new THREE.Vector3(0.55, 7.02, 0)] };
      break;
    }
    case 'streetlight': {
      material = M.metal;
      add(box(0.32, 0.3, 0.32, 0, 0.15, 0), 0x8a8780);
      add(cyl(0.055, 0.09, 7.0, 8, 0, 3.8, 0), 0xa3a9ae);
      const pts = [[0, 7.2, 0], [0, 7.45, 0.3], [0, 7.58, 0.8], [0, 7.6, 1.5]];
      for (let i = 0; i < pts.length - 1; i++) add(rod(pts[i], pts[i + 1], 0.04, 6), 0xa3a9ae);
      add(box(0.26, 0.1, 0.62, 0, 7.58, 1.72), 0x3a3d40);
      add(box(0.2, 0.02, 0.5, 0, 7.52, 1.74), 0xfff1d0);
      extra = { height: 7.7, anchors: { lamp: new THREE.Vector3(0, 7.5, 1.74) } };
      break;
    }
    case 'parapet': {
      const sh = new THREE.Shape(); const t = 0.225, hh = 0.7, ch = 0.045;
      sh.moveTo(-t, 0); sh.lineTo(t, 0); sh.lineTo(t, hh - ch); sh.lineTo(t - ch, hh); sh.lineTo(-t + ch, hh); sh.lineTo(-t, hh - ch); sh.closePath();
      for (let i = 0; i < 4; i++) {
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false, steps: 1 });
        g.translate(0, 0, -1.0 + i * 0.5);
        const base = i % 2 ? 0xefeee8 : 0x1b1b1b;
        add(g, (x, y) => (y < 0.08 ? (i % 2 ? 0xb9b2a2 : 0x2a2621) : base));
      }
      extra = { height: 0.7, length: 2.0 };
      break;
    }
    case 'barrierPost': {
      material = M.metal;
      add(box(0.1, 0.82, 0.15, 0, 0.41, 0), 0xa9aeb3);
      add(box(0.14, 0.3, 0.2, 0, 0.55, 0.16), 0x9aa0a5);
      add(box(0.08, 0.06, 0.012, 0, 0.78, 0.08), 0xffb000);
      extra = { height: 0.85, rail: { y: 0.55, z: 0.27 } };
      break;
    }
    case 'chevron': case 'chevronLeft': {
      const d = name === 'chevron' ? 1 : -1;
      add(box(0.62, 0.78, 0.03, 0, 1.35, 0.0), 0x8a8d90);
      add(box(0.6, 0.76, 0.01, 0, 1.35, 0.02), 0xf5c400);
      const a = new THREE.Shape();
      const P = [[-0.17, 0.27], [-0.03, 0.27], [0.19, 0], [-0.03, -0.27], [-0.17, -0.27], [0.05, 0]].map(([x, y]) => [x * d, y]);
      P.forEach(([x, y], i) => (i ? a.lineTo(x, y) : a.moveTo(x, y))); a.closePath();
      const ag = new THREE.ExtrudeGeometry(a, { depth: 0.006, bevelEnabled: false }); ag.translate(0, 1.35, 0.025);
      add(ag, 0x111111);
      let y = 0, i = 0; while (y < 1.72) { const hh = Math.min(0.3, 1.72 - y); add(box(0.06, hh, 0.06, 0, y + hh / 2, -0.045), i % 2 ? 0x151515 : 0xf2f2ee); y += hh; i++; }
      extra = { height: 1.74 };
      break;
    }
    case 'reflectorPost': {
      add(box(0.12, 0.9, 0.12, 0, 0.45, 0), 0xf1f0ea);
      add(box(0.124, 0.08, 0.124, 0, 0.66, 0), 0x161616);
      add(box(0.07, 0.12, 0.01, 0, 0.8, 0.062), 0xd61f1f);
      add(box(0.07, 0.12, 0.01, 0, 0.8, -0.062), 0xf4f4f0);
      extra = { height: 0.9 };
      break;
    }
    case 'milestoneSmall': {
      add(box(0.26, 0.3, 0.13, 0, 0.15, 0), 0xf1efe7);
      add(halfDisc(0.13, 0.13, 0, 0.3, 0, 10), 0xf2c40c);
      add(box(0.32, 0.06, 0.18, 0, 0.03, 0), 0x9a978f);
      extra = { height: 0.43 };
      break;
    }
    default:
      throw new Error('unknown prop template: ' + name);
  }
  const geometry = mergeList(L);
  geometry.computeBoundingSphere();
  const tpl = { geometry, material, ...extra };
  TPL.set(name, tpl);
  return tpl;
}

/** W-beam guard-rail cross-section for extrusion along the road (u = toward road / +Z of barrierPost, v = up, centred). */
export function getRailProfile() {
  const c = [[0, 0.155], [0.05, 0.13], [0.083, 0.078], [0.06, 0.036], [0.022, 0], [0.06, -0.036], [0.083, -0.078], [0.05, -0.13], [0, -0.155]];
  const t = 0.006;
  const s = new THREE.Shape();
  c.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
  for (let i = c.length - 1; i >= 0; i--) s.lineTo(c[i][0] - t, c[i][1]);
  s.closePath();
  return { shape: s, points: c.map(([u, v]) => new THREE.Vector2(u, v)), y: 0.55, offset: 0.27, color: 0xb5babf };
}

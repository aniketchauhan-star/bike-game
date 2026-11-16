// Roadside "theka" style beer shop: small concrete shop, steel grill with a serving window, BEER SHOP board,
// shelves of bottles, glowing fridge, tube light, crates outside. Plus generic (no-brand) beer / cola bottles.
import * as THREE from 'three';
import { canvasTexture, makeRng, bakeGroup } from '../core/util.js';

const cache = {};
const once = (k, f) => (cache[k] || (cache[k] = f()));
const HI = '"Noto Sans Devanagari","Kohinoor Devanagari",sans-serif';

const mats = () => once('mats', () => ({
  wall: new THREE.MeshStandardMaterial({ map: wallTex(), roughness: 0.95 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 0.95 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x6f6d68, roughness: 0.9 }),
  grill: new THREE.MeshStandardMaterial({ color: 0x2e3a33, roughness: 0.55, metalness: 0.6 }),
  shelf: new THREE.MeshStandardMaterial({ color: 0x5a3c24, roughness: 0.85 }),
  sign: new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.55, emissive: 0x220000, emissiveIntensity: 0.3 }),
  fridge: new THREE.MeshStandardMaterial({ map: fridgeTex(), roughness: 0.3, emissive: 0xffffff, emissiveMap: fridgeTex(), emissiveIntensity: 0.55 }),
  tube: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeef6ff, emissiveIntensity: 2.2 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.7 }),
  green: new THREE.MeshPhysicalMaterial({ color: 0x1f5b25, roughness: 0.15, metalness: 0, transmission: 0, clearcoat: 1, clearcoatRoughness: 0.1 }),
  brown: new THREE.MeshPhysicalMaterial({ color: 0x5a2f0d, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 }),
  counter: new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.6, metalness: 0.3 }),
}));

function wallTex() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b9b1a1'; ctx.fillRect(0, 0, w, h);
    const r = makeRng(12);
    for (let i = 0; i < 1600; i++) { ctx.fillStyle = `rgba(${90 + r() * 60},${85 + r() * 50},${70 + r() * 40},${0.08 + r() * 0.12})`; ctx.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 6); }
    for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(60,55,40,${0.05 + r() * 0.1})`; ctx.fillRect(r() * w, 0, 3 + r() * 10, h); } // rain streaks
  }, { repeat: [2, 1] });
}
function signTex() {
  return canvasTexture(768, 180, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#c4161c'); g.addColorStop(1, '#8e0e12'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 8; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff6d0'; ctx.font = 'bold 96px Teko, Impact, sans-serif'; ctx.fillText('BEER SHOP', w * 0.36, h * 0.52);
    ctx.fillStyle = '#ffd34d'; ctx.font = `bold 50px ${HI}`; ctx.fillText('बीयर शॉप', w * 0.79, h * 0.4);
    ctx.font = 'bold 30px Teko, sans-serif'; ctx.fillText('CHILLED • COLD DRINK', w * 0.79, h * 0.74);
  }, { wrap: false, anisotropy: 8 });
}
function fridgeTex() {
  return once('fridgeTex', () => canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d8eef8'; ctx.fillRect(0, 0, w, h);
    const cols = ['#1f6b2a', '#6b3a10', '#c41a1a', '#e8e8e8', '#1f6b2a', '#6b3a10'];
    for (let row = 0; row < 5; row++) for (let i = 0; i < 6; i++) {
      ctx.fillStyle = cols[(i + row) % cols.length]; const x = 10 + i * 19, y = 22 + row * 46;
      ctx.fillRect(x, y, 12, 34); ctx.fillRect(x + 3, y - 10, 6, 10);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(x + 2, y + 10, 8, 8);
    }
    ctx.strokeStyle = '#9fb3bd'; ctx.lineWidth = 3; for (let row = 1; row < 5; row++) { ctx.beginPath(); ctx.moveTo(0, row * 46 + 12); ctx.lineTo(w, row * 46 + 12); ctx.stroke(); }
    ctx.fillStyle = '#c41a1a'; ctx.fillRect(0, 0, w, 14); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('CHILLED', w / 2, 11);
  }, { wrap: false }));
}
function labelTex(kind) {
  return once('label_' + kind, () => canvasTexture(128, 64, (ctx, w, h) => {
    if (kind === 'cola') {
      ctx.fillStyle = '#c41a1a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#fff'; ctx.font = 'bold 34px Teko, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('COLA', w / 2, h / 2 + 2);
    } else {
      ctx.fillStyle = '#efe3c2'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#8e0e12'; ctx.fillRect(0, 0, w, 10); ctx.fillRect(0, h - 10, w, 10);
      ctx.fillStyle = '#1f3d22'; ctx.font = 'bold 26px Teko, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PAHADI', w / 2, h / 2 - 7);
      ctx.font = 'bold 16px Teko, sans-serif'; ctx.fillText('LAGER', w / 2, h / 2 + 13);
    }
  }, { wrap: false }));
}

/** generic bottle: origin at base centre, neck along +Y, ~0.24 m tall. kind: 'beer' (green glass) | 'cola' (dark, red label) */
export function createBottle(kind = 'beer') {
  const M = mats(); const g = new THREE.Group();
  const prof = [[0, 0], [0.031, 0], [0.033, 0.006], [0.033, 0.15], [0.03, 0.17], [0.016, 0.195], [0.013, 0.225], [0.015, 0.232], [0.012, 0.24], [0, 0.24]].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), kind === 'cola' ? M.brown : M.green); g.add(glass);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0335, 0.0335, 0.06, 20, 1, true), new THREE.MeshStandardMaterial({ map: labelTex(kind), roughness: 0.6 }));
  label.position.y = 0.085; g.add(label);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.008, 12), new THREE.MeshStandardMaterial({ color: kind === 'cola' ? 0xc41a1a : 0xd4af37, metalness: 0.8, roughness: 0.3 }));
  cap.position.y = 0.243; g.add(cap); g.userData.cap = cap;
  return g;
}

/** facade (serving window) faces +Z, origin at the base centre */
export function createBeerShop({ seed = 1 } = {}) {
  const M = mats(); const r = makeRng(seed);
  const root = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); root.add(m); return m; };
  add(new THREE.BoxGeometry(3.8, 0.5, 3.6), M.concrete, 0, -0.17, 0);                 // plinth
  // walls (front wall has a big opening behind the grill)
  add(new THREE.BoxGeometry(3.4, 2.8, 0.18), M.wall, 0, 1.4, -1.4);                   // back
  add(new THREE.BoxGeometry(0.18, 2.8, 2.9), M.wall, -1.61, 1.4, 0);                  // left
  add(new THREE.BoxGeometry(0.18, 2.8, 2.9), M.wall, 1.61, 1.4, 0);                   // right
  add(new THREE.BoxGeometry(3.4, 1.0, 0.18), M.wall, 0, 0.5, 1.36);                   // front under the counter
  add(new THREE.BoxGeometry(3.4, 0.55, 0.18), M.wall, 0, 2.52, 1.36);                 // front lintel
  add(new THREE.BoxGeometry(3.8, 0.14, 3.4), M.roof, 0, 2.86, 0.05);                  // flat roof slab
  // steel grill (jaali) over the front opening with a small serving window
  const bar = new THREE.BoxGeometry(0.025, 1.25, 0.025), hbar = new THREE.BoxGeometry(3.3, 0.03, 0.03);
  for (let i = 0; i <= 26; i++) { const x = -1.6 + i * 0.125; if (x > -0.42 && x < 0.42) continue; add(bar, M.grill, x, 1.62, 1.46); }
  for (const y of [1.02, 1.62, 2.22]) add(hbar, M.grill, 0, y, 1.46);
  add(new THREE.BoxGeometry(0.9, 0.03, 0.03), M.grill, 0, 1.48, 1.46);                // window frame top
  for (let i = 0; i < 7; i++) add(bar, M.grill, -0.375 + i * 0.125, 1.85, 1.46).scale.y = 0.62; // bars above the window
  add(new THREE.BoxGeometry(1.0, 0.06, 0.45), M.counter, 0, 1.02, 1.5);               // little serving ledge
  // signboard
  add(new THREE.BoxGeometry(3.5, 0.75, 0.06), M.sign, 0, 3.3, 1.42);
  // inside: shelves with bottles, glowing fridge, tube light
  for (const y of [1.2, 1.65, 2.1]) {
    add(new THREE.BoxGeometry(2.6, 0.04, 0.3), M.shelf, -0.15, y, -1.12);
    for (let i = 0; i < 18; i++) {
      const glass = r() < 0.6 ? M.green : M.brown;
      const b = add(new THREE.CylinderGeometry(0.03, 0.033, 0.2, 8), glass, -1.35 + i * 0.14, y + 0.12, -1.1 + (r() - 0.5) * 0.06);
      add(new THREE.CylinderGeometry(0.012, 0.02, 0.07, 8), glass, b.position.x, y + 0.255, b.position.z);
    }
  }
  add(new THREE.BoxGeometry(0.75, 1.9, 0.62), M.fridge, 1.15, 0.97, -0.95);
  add(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), M.tube, 0, 2.6, 0.9, 0, 0, Math.PI / 2);
  // beer crates stacked outside
  const crate = new THREE.BoxGeometry(0.42, 0.28, 0.32);
  for (const [x, y, z, ry] of [[-1.4, 0.22, 1.95, 0.1], [-1.4, 0.5, 1.95, -0.05], [-0.95, 0.22, 2.05, 0.3], [1.35, 0.22, 2.0, -0.2]]) add(crate, M.crate, x, y, z, 0, ry, 0);
  const baked = bakeGroup(root);
  const group = new THREE.Group(); group.add(baked);
  const light = new THREE.PointLight(0xeef6ff, 4, 6, 1.6); light.position.set(0, 2.4, 0.6); group.add(light);
  return {
    group,
    keeperLocal: new THREE.Vector3(0.05, 0, 0.75),   // behind the window
    windowLocal: new THREE.Vector3(0, 1.4, 1.46),
    update() {},
  };
}

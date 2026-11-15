// Dev helpers for buildings (buildings & vegetation fork)
import * as THREE from 'three';
import * as B from '../js/models/buildings.js';
import { getTreeTemplate, updateVegetation } from '../js/models/vegetation.js';

function ground(size = 200, color = 0x6a6a62) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  g.rotation.x = -Math.PI / 2; g.position.y = -0.01; g.receiveShadow = true; return g;
}
function stats(group, label) {
  let tris = 0, calls = 0; group.traverse(o => { if (o.isMesh) { calls++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } });
  console.log(`${label}: ${Math.round(tris)} tris, ${calls} draw calls`);
}
/** one building by name with options */
export function one(name, opts = {}) {
  const fn = B[name]; const res = fn(opts); stats(res.group, name + JSON.stringify(opts));
  const group = new THREE.Group(); group.add(ground()); group.add(res.group);
  return { group, update: (dt, t) => res.update && res.update(dt, t) };
}
/** a town street: shops + town buildings on both sides */
export function street(seed = 1) {
  const group = new THREE.Group(); group.add(ground(400));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 200), new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9 }));
  road.rotation.x = -Math.PI / 2; road.position.y = 0.005; road.receiveShadow = true; group.add(road);
  const ups = [];
  const kinds = ['general', 'chai', 'sweets', 'mobile', 'medical', 'hotel', 'hardware', 'cloth', 'kirana'];
  let z = -80, k = 0;
  for (const side of [-1, 1]) {
    z = -70;
    while (z < 60) {
      let res;
      if ((k % 3) === 2) { const w = 7 + (k % 4); res = B.createTownBuilding({ seed: seed * 100 + k, floors: 2 + (k % 3), w, d: 10 }); }
      else { const w = 4 + (k % 3) * 0.7; res = B.createShop({ seed: seed * 100 + k, w, d: 6, kind: kinds[k % kinds.length] }); }
      const w = res.size.w;
      res.group.position.set(side * (4.5 + 2.5 + res.size.d / 2), 0, z + w / 2);
      res.group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(res.group); ups.push(res); z += w + 0.3; k++;
    }
  }
  stats(group, 'street');
  return { group, update: (dt, t) => ups.forEach(u => u.update && u.update(dt, t)) };
}
/** lineup of all building types */
export function lineup() {
  const group = new THREE.Group(); group.add(ground(400));
  const items = [
    B.createBusStand(), B.createDhaba({ seed: 2 }), B.createKumaoniHouse({ seed: 3 }), B.createKumaoniHouse({ seed: 8 }),
    B.createColonialBuilding({ seed: 4 }), B.createChurch(), B.createTemple({ style: 'small' }),
  ];
  let x = -60;
  for (const it of items) { x += it.size.w / 2; it.group.position.x = x; group.add(it.group); x += it.size.w / 2 + 4; stats(it.group, 'item'); }
  return { group, update: (dt, t) => items.forEach(u => u.update && u.update(dt, t)) };
}
/** garjiya temple in a fake river */
export function garjiya() {
  const group = new THREE.Group();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x3f6f6a, roughness: 0.2, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.8; group.add(water);
  const res = B.createTemple({ style: 'garjiya' }); group.add(res.group); stats(res.group, 'garjiya');
  return { group, update: (dt, t) => res.update(dt, t) };
}
/** hill village: kumaoni houses + trees */
export function village(seed = 5) {
  const group = new THREE.Group(); group.add(ground(400, 0x6a7448));
  const ups = [];
  for (let i = 0; i < 6; i++) { const h = B.createKumaoniHouse({ seed: seed + i }); h.group.position.set((i % 3 - 1) * 14, (i < 3 ? 0 : 3), i < 3 ? 0 : -14); group.add(h.group); }
  const d = B.createDhaba({ seed }); d.group.position.set(0, 0, 18); group.add(d.group);
  const t = getTreeTemplate('pine', 'high'); const im = new THREE.InstancedMesh(t.geometry, t.material, 12); const M = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) { M.makeTranslation(-40 + (i % 6) * 16, 0, -30 - Math.floor(i / 6) * 12); im.setMatrixAt(i, M); } im.castShadow = true; group.add(im);
  return { group, update: (dt, tt) => { updateVegetation(tt); } };
}

/** smoke test: build everything with several seeds, report totals */
export async function smoke() {
  const V = await import('../js/models/vegetation.js');
  const group = new THREE.Group(); const t0 = performance.now(); let n = 0;
  const kinds = ['general', 'kirana', 'chai', 'sweets', 'mobile', 'hotel', 'medical', 'hardware', 'cloth', undefined];
  for (let s = 1; s <= 10; s++) {
    for (const r of [B.createShop({ seed: s, kind: kinds[s - 1], sign: s === 3 ? { hi: 'शर्मा जनरल स्टोर', en: 'SHARMA GENERAL STORE' } : null }), B.createTownBuilding({ seed: s, floors: 1 + (s % 5), w: 6 + s % 4, d: 9 }),
      B.createDhaba({ seed: s, sign: s % 2 ? 'Corbett Dhaba' : null }), B.createKumaoniHouse({ seed: s }), B.createColonialBuilding({ seed: s })]) {
      if (!r.group || !r.size) throw new Error('bad result'); n++;
    }
  }
  for (const r of [B.createBusStand(), B.createChurch(), B.createTemple({ style: 'small' }), B.createTemple({ style: 'garjiya' }), B.createTemple({ style: 'garjiya', bridgeLength: 0 })]) { n++; r.update && r.update(0.05, 1); }
  for (const k of ['sal', 'pine', 'deodar', 'oak', 'bush', 'bamboo', 'banana', 'grass', 'fern', 'nope']) for (const l of ['high', 'low']) { const t = V.getTreeTemplate(k, l); if (!t.geometry || !t.material) throw new Error('tpl'); }
  for (const k of ['river', 'mountain']) for (let v = 0; v < 6; v++) V.getRockTemplate(v, k);
  console.log(`smoke ok: ${n} buildings in ${(performance.now() - t0).toFixed(0)} ms`);
  return { group };
}

export function timing() {
  const t0 = performance.now(); B.createShop({ seed: 1 }); const t1 = performance.now();
  for (let i = 0; i < 20; i++) B.createTownBuilding({ seed: i }); const t2 = performance.now();
  console.log(`buildings: first (texture gen) ${(t1 - t0).toFixed(0)} ms, 20 town buildings ${(t2 - t1).toFixed(0)} ms`);
  return { group: new THREE.Group() };
}

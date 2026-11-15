// perf/sanity check for animals + people (dev only)
import * as THREE from 'three';
import * as A from '../js/models/animals.js';
import * as P from '../js/models/people.js';
export function perf() {
  const g = new THREE.Group(); const items = []; const t0 = performance.now(); const stats = {};
  const tri = (obj) => { let n = 0; obj.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); }); return Math.round(n); };
  const calls = (obj) => { let n = 0; obj.traverse(o => { if (o.isMesh) n++; }); return n; };
  const mk = (name, f) => { const s = performance.now(); const it = f(); const ms = performance.now() - s; stats[name] = { tris: tri(it.group), meshes: calls(it.group), ms: +ms.toFixed(1) }; return it; };
  items.push(mk('cow', () => A.createCow({ seed: 5 })), mk('cow_spotted', () => A.createCow({ seed: 6, color: 'spotted' })), mk('tiger', () => A.createTiger({ seed: 1 })),
    mk('snake_cobra', () => A.createSnake({ seed: 1, kind: 'cobra' })), mk('snake_python', () => A.createSnake({ seed: 1, kind: 'python' })),
    mk('langur', () => A.createMonkey({ seed: 1, kind: 'langur' })), mk('rhesus', () => A.createMonkey({ seed: 1, kind: 'rhesus' })),
    mk('deer_m', () => A.createDeer({ seed: 1, male: true })), mk('dog', () => A.createDog({ seed: 1 })), mk('elephant', () => A.createElephant({ seed: 1, male: true })),
    mk('peacock', () => A.createPeacock({ seed: 1 })), mk('birds12', () => A.createBirdFlock({ seed: 1, count: 12 })));
  const ps = performance.now(); let ptri = 0, pmax = 0;
  for (let i = 0; i < 50; i++) { const p = P.createPerson({ seed: 200 + i, pose: ['stand', 'sit', 'walk', 'cheer', 'wave', 'squat'][i % 6] }); const tt = tri(p.group); ptri += tt; pmax = Math.max(pmax, tt); p.group.position.set((i % 10) * 0.8 - 4, 0, Math.floor(i / 10) * 1.0 + 3); items.push(p); g.add(p.group); }
  stats.people50 = { totalTris: ptri, maxTris: pmax, avgTris: Math.round(ptri / 50), ms: +(performance.now() - ps).toFixed(1) };
  const ss = performance.now(); for (let i = 0; i < 20; i++) { const p = P.createPerson({ seed: 500 + i, pose: 'cheer', static: true }); p.group.position.set((i % 10) * 0.8 - 4, 0, 9 + Math.floor(i / 10)); g.add(p.group); }
  stats.static20 = { ms: +(performance.now() - ss).toFixed(1) };
  items.slice(0, 12).forEach((it, i) => { it.group.position.set(i * 3 - 16, 0, -3); g.add(it.group); });
  stats.totalMs = +(performance.now() - t0).toFixed(1);
  window.__stats = stats;
  const us = []; 
  return { group: g, update(dt, t) { const s = performance.now(); for (const it of items) it.update(dt, t); us.push(performance.now() - s); window.__updMs = (us.reduce((a, b) => a + b, 0) / us.length).toFixed(3); } };
}

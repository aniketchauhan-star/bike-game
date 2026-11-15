// Dev compositions for the animals/people fork (used with dev/viewer.html?mod=../dev/animals_scenes.js&fn=...)
import * as THREE from 'three';
import * as A from '../js/models/animals.js';
import * as P from '../js/models/people.js';

function lineup(items, gap = 2.5, z = 0) {
  const g = new THREE.Group();
  items.forEach((it, i) => { it.group.position.x += (i - (items.length - 1) / 2) * gap; it.group.position.z += z; g.add(it.group); });
  return { group: g, items, update(dt, t) { for (const it of items) it.update(dt, t); } };
}

export function zoo() {
  const items = [
    A.createTiger({ seed: 1, pose: 'sit' }),
    A.createTiger({ seed: 2, pose: 'stand' }),
    A.createElephant({ seed: 1, male: true }),
    A.createDeer({ seed: 1, male: true, pose: 'stand' }),
    A.createDeer({ seed: 2, male: false }),
    A.createDog({ seed: 1, pose: 'sit' }),
    A.createDog({ seed: 2, pose: 'stand' }),
    A.createMonkey({ seed: 1, kind: 'langur', pose: 'sit', perch: false }),
    A.createMonkey({ seed: 2, kind: 'rhesus', pose: 'sit', perch: false }),
    A.createPeacock({ seed: 1 }),
  ];
  const gaps = [0, 3, 6.5, 10, 12, 14, 15.3, 16.6, 17.6, 18.8];
  const g = new THREE.Group();
  items.forEach((it, i) => { it.group.position.x = gaps[i] - 9; g.add(it.group); });
  return { group: g, update(dt, t) { for (const it of items) it.update(dt, t); } };
}

export function one(kind, opts = {}, pose) {
  const f = { cow: A.createCow, tiger: A.createTiger, elephant: A.createElephant, deer: A.createDeer, dog: A.createDog, monkey: A.createMonkey, peacock: A.createPeacock, snake: A.createSnake }[kind];
  const it = f(opts);
  if (pose && it.setPose) it.setPose(pose);
  return it;
}

/** same animal in several poses side by side */
export function poses(kind, list, opts = {}, gap = 2.5) {
  return lineup(list.map((p, i) => one(kind, { ...opts, seed: (opts.seed || 1) + i, pose: p })), gap);
}

/** walk cycle frames: n copies with time offsets */
export function walkFrames(kind, n = 4, opts = {}, gap = 2.5, period = 1.3) {
  const items = [];
  for (let i = 0; i < n; i++) { const it = one(kind, { ...opts, seed: opts.seed || 1, pose: 'walk' }); it.update(0.0001 + (period * i) / n); items.push(it); }
  const l = lineup(items, gap);
  l.update = () => {};
  return l;
}

export function snakes() {
  const a = A.createSnake({ seed: 1, kind: 'cobra' }), b = A.createSnake({ seed: 2, kind: 'python' }), c = A.createSnake({ seed: 3, kind: 'cobra' });
  c.setRaised(true);
  a.group.position.x = -1.2; b.group.position.x = 0.3; c.group.position.x = 1.6;
  const g = new THREE.Group(); g.add(a.group, b.group, c.group);
  return { group: g, update(dt, t) { a.update(dt); b.update(dt); c.update(dt); } };
}

export function birds() {
  const g = new THREE.Group();
  const f1 = A.createBirdFlock({ seed: 1, count: 8, radius: 6, height: 3, kind: 'kite' });
  const f2 = A.createBirdFlock({ seed: 2, count: 14, radius: 5, height: 2.5, kind: 'small' });
  g.add(f1.group, f2.group);
  return { group: g, update(dt, t) { f1.update(dt); f2.update(dt); } };
}

export function people(n = 8, seed0 = 1, pose) {
  const items = [];
  for (let i = 0; i < n; i++) items.push(P.createPerson({ seed: seed0 + i, pose }));
  return lineup(items, 0.75);
}
export function peoplePoses() {
  const list = ['stand', 'wave', 'cheer', 'walk', 'sit', 'squat'];
  return lineup(list.map((p, i) => P.createPerson({ seed: 10 + i, pose: p })), 0.9);
}
export function crowd(n = 30) {
  const g = new THREE.Group(); const items = [];
  for (let i = 0; i < n; i++) {
    const it = P.createPerson({ seed: 100 + i, pose: i % 3 === 0 ? 'cheer' : (i % 3 === 1 ? 'wave' : 'stand'), static: i % 2 === 0 });
    it.group.position.set((i % 10) * 0.7 - 3.2, 0, Math.floor(i / 10) * 0.8 - 0.8);
    it.group.rotation.y = Math.PI * 0.0;
    g.add(it.group); items.push(it);
  }
  return { group: g, update(dt, t) { for (const it of items) it.update(dt, t); } };
}

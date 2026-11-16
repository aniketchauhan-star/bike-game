// Dev scene: roadside Maggi stall shopkeeper ('cook' / 'serve' poses + holdProp) for the people.js fork.
import * as THREE from 'three';
import * as P from '../js/models/people.js';

const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.28, metalness: 0.9 });
const noodle = new THREE.MeshStandardMaterial({ color: 0xe8c45a, roughness: 0.7 });

function counterSet() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.85 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.5), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.6 }));
  top.position.set(0, 0.93, 0.5); g.add(top);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.91, 0.46), wood); body.position.set(0, 0.455, 0.52); g.add(body);
  const stove = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
  stove.position.set(-0.05, 0.965, 0.45); g.add(stove);
  // pot: centre ≈ (−0.05, 1.05, 0.45)
  const potWall = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.11, 0.16, 24, 1, true), steel);
  potWall.material = steel.clone(); potWall.material.side = THREE.DoubleSide;
  potWall.position.set(-0.05, 1.06, 0.45); g.add(potWall);
  const potBase = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), steel); potBase.rotation.x = -Math.PI / 2; potBase.position.set(-0.05, 0.981, 0.45); g.add(potBase);
  const soup = new THREE.Mesh(new THREE.CircleGeometry(0.112, 24), noodle); soup.rotation.x = -Math.PI / 2; soup.position.set(-0.05, 1.07, 0.45); g.add(soup);
  // jars on the counter
  for (let i = 0; i < 3; i++) {
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), new THREE.MeshStandardMaterial({ color: [0xd04030, 0x30a050, 0xe0b020][i], roughness: 0.5 }));
    jar.position.set(0.45 + i * 0.11, 1.03, 0.62); g.add(jar);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeLadle() {
  // handle along +Y from the grip (origin); bowl at the +Y end
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.27, 8), steel); handle.position.y = 0.12; g.add(handle);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel);
  bowl.material = steel.clone(); bowl.material.side = THREE.DoubleSide;
  bowl.rotation.x = Math.PI; bowl.position.y = 0.27; g.add(bowl);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makePlate() {
  // origin at the base centre
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.018, 28), steel); plate.position.y = 0.009; g.add(plate);
  const food = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 8), noodle); food.scale.set(1, 0.38, 1); food.position.y = 0.025; g.add(food);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function stall(person) {
  const g = new THREE.Group(); g.add(counterSet()); g.add(person.group);
  return g;
}

/** single shopkeeper in a pose holding the matching prop */
export function shop(pose = 'cook', seed = 3, detail = 'high') {
  const p = P.createPerson({ seed, gender: 'm', age: 'adult', pose, detail });
  if (pose === 'cook') p.holdProp(makeLadle(), 'right');
  if (pose === 'serve') p.holdProp(makePlate(), 'right');
  const g = stall(p);
  return { group: g, update(dt) { p.update(dt); } };
}

/** several shopkeepers at different moments of the cook → serve → stand sequence (blend check) */
export function sequence(seed = 3) {
  const g = new THREE.Group(); const people = [];
  const states = [
    { pre: 2.0 },                                            // cooking
    { pre: 2.0, to: 'serve', after: 0.12 },                  // mid-blend cook → serve
    { pre: 2.0, to: 'serve', after: 0.6 },                   // serving
    { pre: 2.0, to: 'serve', after: 0.6, to2: 'stand', after2: 0.15 }, // mid-blend serve → stand
    { pre: 2.0, to: 'serve', after: 0.6, to2: 'stand', after2: 0.6 },  // standing
  ];
  states.forEach((st, i) => {
    const p = P.createPerson({ seed, gender: 'm', age: 'adult', pose: 'cook', detail: 'high' });
    p.holdProp(makeLadle(), 'right');
    const adv = (s) => { for (let k = 0; k < Math.round(s * 60); k++) p.update(1 / 60); };
    adv(st.pre);
    if (st.to) { p.holdProp(null, 'right'); p.holdProp(makePlate(), 'right'); p.setPose(st.to); adv(st.after); }
    if (st.to2) { p.holdProp(null, 'right'); p.setPose(st.to2); adv(st.after2); }
    const s = stall(p); s.position.x = (i - 2) * 1.6; g.add(s); people.push(p);
  });
  return { group: g, update() {} };
}

/** different body types cooking (IK adapts to height) */
export function cooks() {
  const g = new THREE.Group(); const ps = [];
  [{ seed: 3, gender: 'm', age: 'adult' }, { seed: 8, gender: 'f', age: 'adult' }, { seed: 21, gender: 'm', age: 'old' }].forEach((o, i) => {
    const p = P.createPerson({ ...o, pose: 'cook' }); p.holdProp(makeLadle(), 'right');
    const s = stall(p); s.position.x = (i - 1) * 1.6; g.add(s); ps.push(p);
  });
  return { group: g, update(dt) { for (const p of ps) p.update(dt); } };
}

/** tri count of a high-detail vs normal person */
export function triCheck() {
  const tri = (o) => { let n = 0; o.traverse(m => { if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
  const a = P.createPerson({ seed: 3, gender: 'm', age: 'adult', pose: 'cook', detail: 'high' });
  const b = P.createPerson({ seed: 3, gender: 'm', age: 'adult', pose: 'cook' });
  window.__tris = { high: tri(a.group), normal: tri(b.group) };
  a.group.position.x = -0.6; b.group.position.x = 0.6;
  const g = new THREE.Group(); g.add(a.group, b.group);
  return { group: g, update(dt) { a.update(dt); b.update(dt); } };
}

// Dev compositions for vehicles/props (D1 fork). Use with dev/viewer.html?mod=../dev/props_scenes.js&fn=...
import * as THREE from 'three';
import { createBus, createJeep, createTruck, createAuto, createCar } from '../js/models/vehicles.js';

export function vehicleLineup(seed = 1, speed = 0) {
  const g = new THREE.Group();
  const list = [createBus({ seed }), createTruck({ seed }), createJeep({ seed }), createCar({ seed }), createAuto({ seed })];
  let x = 0; const gaps = [0, 3.4, 3.0, 2.6, 2.2];
  list.forEach((v, i) => { x += gaps[i]; v.group.position.x = -x; g.add(v.group); });
  g.position.x = x / 2;
  return { group: g, update(dt, t) { for (const v of list) v.update(dt, t, { speed }); } };
}
export function one(kind = 'bus', seed = 1, speed = 0) {
  const f = { bus: createBus, jeep: createJeep, truck: createTruck, auto: createAuto, car: createCar }[kind];
  const v = f({ seed });
  return { group: v.group, update(dt, t) { v.update(dt, t, { speed }); } };
}
export function seeds(kind = 'car', n = 4, gap = 2.4) {
  const f = { bus: createBus, jeep: createJeep, truck: createTruck, auto: createAuto, car: createCar }[kind];
  const g = new THREE.Group(); const list = [];
  for (let i = 0; i < n; i++) { const v = f({ seed: i + 1 }); v.group.position.x = (i - (n - 1) / 2) * gap; g.add(v.group); list.push(v); }
  return { group: g, update(dt, t) { for (const v of list) v.update(dt, t, {}); } };
}

// ---------------------------------------------------------------- props
import { createMilestone, createSign, createGate, createBridge, createBunting, createHoarding, getPropTemplate, getRailProfile, updateProps, BRO_SLOGANS } from '../js/models/props.js';

export function signsLineup() {
  const g = new THREE.Group();
  const items = [
    createMilestone({ place: 'RANIKHET', km: 42 }),
    createMilestone({ place: 'MOHAN', km: 18, kind: 'sh', back: { place: 'RAMNAGAR', km: 22 } }),
    createSign({ kind: 'warning', lines: ['ELEPHANT CROSSING'] }),
    createSign({ kind: 'warning', icon: 'hairpinLeft', lines: ['HAIRPIN BEND'] }),
    createSign({ kind: 'warning', icon: 'rocks', lines: ['FALLING ROCKS'] }),
    createSign({ kind: 'bro', lines: BRO_SLOGANS[0] }),
    createSign({ kind: 'bro', lines: BRO_SLOGANS[2] }),
    createSign({ kind: 'forest', lines: ['कॉर्बेट टाइगर रिज़र्व', 'CORBETT TIGER RESERVE', 'Drive slowly • No horn'] }),
    createSign({ kind: 'welcome', lines: ['रानीखेत में आपका स्वागत है', 'WELCOME TO RANIKHET'] }),
    createSign({ kind: 'direction', lines: ['← NAINITAL 62', 'RANIKHET 42 →', 'रानीखेत 42 →'] }),
    createSign({ kind: 'info', lines: ['गर्जिया देवी मंदिर 2 km', 'GARJIYA DEVI TEMPLE 2 km'] }),
  ];
  const widths = [0.9, 0.9, 1.3, 1.3, 1.3, 2.3, 2.3, 3.1, 4.5, 3.7, 2.9];
  let x = 0; items.forEach((it, i) => { x += widths[i] / 2; it.position.x = x; x += widths[i] / 2 + 0.4; g.add(it); });
  g.position.x = -x / 2;
  return { group: g, update(dt, t) { updateProps(t); } };
}
export function gateScene() {
  const g = new THREE.Group();
  const a = createGate({ title: 'RAMNAGAR — START', subtitle: 'रामनगर ➜ रानीखेत  •  UTTARAKHAND RIDERS' });
  const b = createGate({ title: 'RANIKHET — FINISH', subtitle: 'रानीखेत  •  समापन' }); b.position.z = -18;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(10, 60), new THREE.MeshStandardMaterial({ color: 0x333336, roughness: 0.9 })); road.rotation.x = -Math.PI / 2; road.position.y = 0.01; road.receiveShadow = true;
  const bun = createBunting({ length: 13 }); bun.position.set(0, 5.6, -9);
  g.add(a, b, road, bun);
  return { group: g, update(dt, t) { updateProps(t); } };
}
export function bridgeScene(len = 40) {
  const g = new THREE.Group();
  const b = createBridge({ length: len, name: 'Kosi River Bridge' });
  g.add(b);
  return { group: g, update() {} };
}
export function hoardingScene() {
  const g = new THREE.Group();
  const a = createHoarding({}); a.position.x = -3.5;
  const b = createHoarding({ lines: ['CORBETT JUNGLE RESORT', 'जंगल के बीच एक रात', 'Book: Dhikuli, Ramnagar'], w: 5, h: 2.5 }); b.position.x = 3.5;
  g.add(a, b); return { group: g, update() {} };
}
export function templates() {
  const g = new THREE.Group();
  const names = ['pole', 'streetlight', 'parapet', 'barrierPost', 'chevron', 'chevronLeft', 'reflectorPost', 'milestoneSmall'];
  names.forEach((n, i) => {
    const t = getPropTemplate(n);
    const im = new THREE.InstancedMesh(t.geometry, t.material, 3);
    const m = new THREE.Matrix4();
    for (let k = 0; k < 3; k++) { m.makeTranslation((i - names.length / 2) * 1.6, 0, k * (n === 'parapet' ? 2.0 : 1.5)); im.setMatrixAt(k, m); }
    im.castShadow = im.receiveShadow = true; g.add(im);
  });
  return { group: g, update() {} };
}
/** short road stretch to judge scale from a chase-cam view */
export function roadScene() {
  const g = new THREE.Group();
  const road = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 120), new THREE.MeshStandardMaterial({ color: 0x3b3b3e, roughness: 0.92 }));
  road.rotation.x = -Math.PI / 2; road.position.y = 0.01; road.receiveShadow = true; g.add(road);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 120), new THREE.MeshStandardMaterial({ color: 0xf0f0f0 })); line.rotation.x = -Math.PI / 2; line.position.set(3.5, 0.015, 0); g.add(line);
  const line2 = line.clone(); line2.position.x = -3.5; g.add(line2);
  const par = getPropTemplate('parapet'); const pim = new THREE.InstancedMesh(par.geometry, par.material, 50); const m = new THREE.Matrix4();
  for (let i = 0; i < 50; i++) { m.makeTranslation(4.2, 0, -50 + i * 2.0); pim.setMatrixAt(i, m); } pim.castShadow = pim.receiveShadow = true; g.add(pim);
  const bp = getPropTemplate('barrierPost'); const bim = new THREE.InstancedMesh(bp.geometry, bp.material, 30);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  for (let i = 0; i < 30; i++) { m.compose(new THREE.Vector3(-4.3, 0, -50 + i * 4), q, new THREE.Vector3(1, 1, 1)); bim.setMatrixAt(i, m); } g.add(bim);
  const rp = getRailProfile(); const rail = new THREE.Mesh(new THREE.ExtrudeGeometry(rp.shape, { depth: 120, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: rp.color, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }));
  rail.position.set(-4.3 + rp.offset, rp.y, -60); g.add(rail);
  const pole = getPropTemplate('pole'); const poim = new THREE.InstancedMesh(pole.geometry, pole.material, 4);
  for (let i = 0; i < 4; i++) { m.makeTranslation(5.2, 0, -45 + i * 30); poim.setMatrixAt(i, m); } poim.castShadow = true; g.add(poim);
  const ch = getPropTemplate('chevronLeft'); const cim = new THREE.InstancedMesh(ch.geometry, ch.material, 4);
  for (let i = 0; i < 4; i++) { m.makeTranslation(4.9, 0, 20 + i * 6); cim.setMatrixAt(i, m); } g.add(cim);
  const ms = createMilestone({ place: 'RANIKHET', km: 38 }); ms.position.set(4.9, 0, -8); ms.rotation.y = -0.3; g.add(ms);
  const s = createSign({ kind: 'bro', lines: BRO_SLOGANS[1] }); s.position.set(5.5, 0, -25); s.rotation.y = -0.25; g.add(s);
  const bus = createBus({ seed: 3 }); bus.group.position.set(-1.8, 0, -18); bus.group.rotation.y = Math.PI; g.add(bus.group);
  const jeep = createJeep({ seed: 5 }); jeep.group.position.set(1.8, 0, 6); g.add(jeep.group);
  return { group: g, update(dt, t) { bus.update(dt, t, { speed: 8 }); jeep.update(dt, t, { speed: 8 }); updateProps(t); } };
}

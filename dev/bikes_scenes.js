// Dev compositions for bikes & riders (used with dev/viewer.html?mod=../dev/bikes_scenes.js&fn=...)
import * as THREE from 'three';
import { createBike } from '../js/models/bikes.js';
import { createRider, createHelmet, preloadRiders } from '../js/models/riders.js';

function triStats(root) {
  const out = {}; let total = 0;
  root.traverse(o => { if (o.isMesh) { const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; out[(o.parent?.name || '') + '/' + o.name] = Math.round(n); total += n; } });
  out.total = Math.round(total); return out;
}
window.__triStats = triStats; window.__bikeDebug = {};

export function allBikes() {
  const g = new THREE.Group(); const list = [];
  ['zx10r', 's1000rr', 'panigale'].forEach((id, i) => { const b = createBike(id); b.group.position.x = (i - 1) * 1.6; g.add(b.group); list.push(b); });
  return { group: g, update(dt, t, s) { for (const b of list) b.update(dt, t, s); } };
}
export function oneBike(id = 'zx10r', parked = false) {
  const b = createBike(id); if (parked) b.setParked(true); window.__bike = b; return b;
}
export async function allRiders(helmet = false, pose = 'stand') {
  await preloadRiders();
  const g = new THREE.Group(); const list = [];
  ['mayank', 'tushar', 'himanshu'].forEach((id, i) => { const r = createRider(id); r.setPose(pose); r.setHelmet(helmet); r.group.position.x = (i - 1) * 0.75; g.add(r.group); list.push(r); });
  window.__riders = list;
  return { group: g, update(dt, t, s) { for (const r of list) r.update(dt, t, s); } };
}
export async function oneRider(id = 'mayank', helmet = false) {
  await preloadRiders();
  const r = createRider(id); r.setHelmet(helmet); window.__rider = r; return r;
}
export async function riderOnBike(riderId = 'mayank', bikeId = 'zx10r', lean = 0, speed = 30, helmet = true) {
  await preloadRiders();
  const c = new THREE.Group(); const inner = new THREE.Group(); c.add(inner);
  const b = createBike(bikeId); const r = createRider(riderId); r.setPose('ride'); r.setHelmet(helmet);
  inner.add(b.group, r.group); inner.rotation.z = lean;
  const st = { lean, speed, steer: 0, brake: 0, throttle: 1 };
  return { group: c, update(dt, t) { b.update(dt, t, st); r.update(dt, t, st); } };
}
export async function allOnBikes(lean = 0, speed = 30) {
  await preloadRiders();
  const g = new THREE.Group(); const list = [];
  [['mayank', 'zx10r'], ['tushar', 's1000rr'], ['himanshu', 'panigale']].forEach(([rid, bid], i) => {
    const inner = new THREE.Group(); inner.position.x = (i - 1) * 1.5; inner.rotation.z = lean; g.add(inner);
    const b = createBike(bid); const r = createRider(rid); r.setPose('ride'); r.setHelmet(true); inner.add(b.group, r.group); list.push([b, r]);
  });
  const st = { lean, speed, throttle: 1 };
  return { group: g, update(dt, t) { for (const [b, r] of list) { b.update(dt, t, st); r.update(dt, t, st); } } };
}
/** PUBG-style lobby layout: rider standing in front, bike parked behind at 3/4, helmet on the seat */
export async function lobbyPreview(riderId = 'mayank') {
  await preloadRiders();
  const bikeId = { mayank: 'zx10r', tushar: 's1000rr', himanshu: 'panigale' }[riderId];
  const g = new THREE.Group();
  const b = createBike(bikeId); b.setParked(true); b.group.position.set(0.35, 0, -1.25); b.group.rotation.y = -0.9; g.add(b.group);
  const h = createHelmet(riderId); h.position.copy(b.anchors.helmetRest); h.rotation.y = 1.2; b.group.add(h);
  const r = createRider(riderId); r.setPose('stand'); g.add(r.group);
  return { group: g, update(dt, t) { b.update(dt, t, {}); r.update(dt, t, {}); } };
}
export async function riderStats() {
  await preloadRiders(); const out = {};
  for (const id of ['mayank', 'tushar', 'himanshu']) { const r = createRider(id); out[id] = triStats(r.group); }
  window.__rstats = out; return new THREE.Group();
}
export async function perfTest() {
  await preloadRiders();
  const g = new THREE.Group(); const b = createBike('zx10r'); const r = createRider('mayank'); r.setPose('ride'); r.setHelmet(true); g.add(b.group, r.group);
  const t0 = performance.now(); for (let i = 0; i < 1000; i++) { r.update(1 / 60, i / 60, { lean: Math.sin(i * 0.01), speed: 40, brake: 0, steer: 0 }); b.update(1 / 60, i / 60, { speed: 40, steer: 0.2, brake: 0.5 }); }
  const t1 = performance.now(); r.setPose('stand'); for (let i = 0; i < 1000; i++) r.update(1 / 60, i / 60, {});
  const t2 = performance.now(); r.setHelmet(false); r.setPose('ride'); r.setHelmet(true); b.setParked(true); b.setParked(false);
  window.__perf = { rideUpdateMs: ((t1 - t0) / 1000).toFixed(3), standUpdateMs: ((t2 - t1) / 1000).toFixed(3) };
  return { group: g, update(dt, t) { b.update(dt, t, { speed: 20 }); r.update(dt, t, { lean: 0.3, speed: 20 }); } };
}
/** intro close-up: rider seated on bike (ride pose, helmet off); container shifted so the eye anchor sits at (0,1.3,0) */
export async function closeUp(riderId = 'mayank', speed = 0, talk = false) {
  const bikeId = { mayank: 'zx10r', tushar: 's1000rr', himanshu: 'panigale' }[riderId];
  const c = new THREE.Group(); const inner = new THREE.Group(); c.add(inner);
  const b = createBike(bikeId); const r = createRider(riderId); r.setPose('ride'); r.setHelmet(false); inner.add(b.group, r.group);
  const st = { speed, lean: 0 };
  r.update(0.016, 0, st); c.updateMatrixWorld(true);
  const eye = r.headAnchor.getWorldPosition(new THREE.Vector3());
  inner.position.set(-eye.x, 1.3 - eye.y, -eye.z);
  r.setLookTarget(new THREE.Vector3(0, 1.3, 0.6));
  if (talk) r.say(3);
  window.__rider = r;
  return { group: c, update(dt, t) { b.update(dt, t, st); r.update(dt, t, st); } };
}
export async function kickFrame(riderId = 'mayank', side = 1, lean = 0) {
  const bikeId = { mayank: 'zx10r', tushar: 's1000rr', himanshu: 'panigale' }[riderId];
  const c = new THREE.Group(); const inner = new THREE.Group(); c.add(inner); inner.rotation.z = lean;
  const b = createBike(bikeId); const r = createRider(riderId); r.setPose('ride'); r.setHelmet(true); inner.add(b.group, r.group);
  const st = { speed: 30, lean };
  r.kick(side);
  return { group: c, update(dt, t) { b.update(dt, t, st); r.update(dt, t, st); } };
}
export async function fallPose(riderId = 'tushar', airborne = true) {
  const c = new THREE.Group(); const r = createRider(riderId); r.setPose('ride'); r.setHelmet(true); c.add(r.group);
  r.setPose('fall'); r.group.position.set(0, 1.0, 0);
  if (!airborne) { r.group.rotation.x = -Math.PI / 2; r.group.position.set(0, 0.16, 0); }
  const st = { fall: { airborne, spin: 4 } };
  return { group: c, update(dt, t) { r.update(dt, t, st); } };
}
/** likeness check: neutral standing pose, head straight, eye line placed at (0, 1.5, 0), no animation */
export async function faceCompare(riderId = 'mayank', yaw = 0) {
  const c = new THREE.Group(); const r = createRider(riderId); r.setPose('stand'); r.setHelmet(false); c.add(r.group);
  r.update(0.016, 0, {});
  for (const b of Object.values(r.bones)) b.quaternion.identity();
  r.group.rotation.y = yaw;
  c.updateMatrixWorld(true);
  // eye line = head group centre + 0.005 (local) → use the eyes' mean world position
  const eyes = []; r.group.traverse(o => { if (o.name === 'eyeL' || o.name === 'eyeR') eyes.push(o.getWorldPosition(new THREE.Vector3())); });
  const e = eyes[0].clone().add(eyes[1]).multiplyScalar(0.5);
  r.group.position.set(-e.x, 1.5 - e.y, -e.z + 0.0);
  c.updateMatrixWorld(true);
  r.setLookTarget(new THREE.Vector3(0, 1.5, 3));
  for (let i = 0; i < 3; i++) { r.update(0.016, 0, {}); for (const b of Object.values(r.bones)) b.quaternion.identity(); }
  window.__rider = r;
  return { group: c, update() {} };
}

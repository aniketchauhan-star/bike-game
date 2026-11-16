// Places buildings, props, animals, people and traffic along the Ramnagar → Ranikhet road.
// Also provides gameplay data: obstacles (track-space boxes), moving traffic, triggers, ambience levels.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, makeRng, mergeSafe } from '../core/util.js';
import { STEP } from './track.js';

const tryCall = (fn, ...a) => {
  if (typeof fn !== 'function') return null; // module not available
  try { return fn(...a); } catch (e) { console.warn('[populate]', fn?.name, e?.message || e); return null; }
};

export class Populator {
  constructor(world) {
    this.w = world; this.T = world.track; this.terrain = world.terrain; this.rivers = world.rivers;
    this.scene = world.scene; this.q = world.quality;
    this.obstacles = [];  // {s, d, hl (half length along s), hw (half width), kind, ref}
    this.traffic = [];    // {obj, s0, s1, v, lane, len, wid, kind, honked}
    this.animated = [];   // {obj (with update), pos: Vector3, always?}
    this.triggers = [];   // {s, r, fired, fn}
    this.reserved = [];   // keep-out circles for trees
    this.special = {};    // tiger, snake etc
    this.staticRoots = []; // placed static groups (batched after population)
    this.cull = [];        // [{o: Object3D, r: radius}] distance-culled objects
    this.cullT = 0;
    this.rng = makeRng(2026);
    this.v = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- helpers
  /** world position on/around the road. d>0 right. y snapped to terrain unless onRoad */
  pos(s, d, { road = false, y = null } = {}) {
    const p = this.T.point(s, d, new THREE.Vector3());
    if (y !== null) p.y = y; else if (!road && Math.abs(d) > this.T.halfWidth(s) + 1.2) p.y = this.terrain.heightAt(p.x, p.z);
    return p;
  }
  /** rotation (Y) so the object's +Z faces direction (dx,dz) */
  yawTo(dx, dz) { return Math.atan2(dx, dz); }
  /** yaw so an object placed at side faces the road (its +Z points toward the centreline) */
  yawFaceRoad(s, side) { const r = this.T.right(s, this.v); return this.yawTo(-r.x * side, -r.z * side); }
  /** yaw aligned with travel direction (forward) */
  yawAlong(s, flip = false) { const f = this.T.forward(s, this.v); return flip ? this.yawTo(-f.x, -f.z) : this.yawTo(f.x, f.z); }

  place(obj, p, yaw, { shadow = true, anim = false, near = 160, reserve = 0, water = false } = {}) {
    if (!obj) return null;
    // never put a building / prop into a river bed (except things meant to be there, like Garjiya temple)
    if (!water && this.rivers) {
      const q = this.rivers.query(p.x, p.z);
      if (q && q.dist < q.bed + Math.max(reserve, 1.5) + 2) return null;
    }
    const g = obj.isObject3D ? obj : obj.group;
    if (!g) return null;
    g.position.copy(p); g.rotation.y = yaw;
    g.traverse(o => { if (o.isMesh) { o.castShadow = shadow && o.castShadow !== false; o.receiveShadow = true; } });
    if (!anim) { g.updateMatrixWorld(true); g.matrixAutoUpdate = false; g.traverse(o => { o.matrixAutoUpdate = false; }); this.staticRoots.push(g); }
    this.scene.add(g);
    if (anim && obj.update) this.animated.push({ obj, pos: g.position, near });
    if (anim) this.cull.push({ o: g, r: Math.max(near * 1.6, 180) * (this.q.cullScale || 1) });
    if (reserve) this.reserved.push({ x: p.x, z: p.z, r: reserve });
    return obj;
  }
  obstacle(s, d, hl, hw, kind, ref) { const o = { s, d, hl, hw, kind, ref }; this.obstacles.push(o); return o; }

  // ---------------------------------------------------------------- main
  async run(M, onProgress = () => {}) {
    const steps = [
      ['town', () => this.town(M)], ['forest', () => this.forest(M)], ['river', () => this.river(M)],
      ['mountain', () => this.mountain(M)], ['ridge', () => this.ridge(M)], ['maggi', () => this.maggi(M)], ['roadside', () => this.roadside(M)],
      ['traffic', () => this.trafficSetup(M)],
    ];
    for (let i = 0; i < steps.length; i++) {
      const t0 = performance.now();
      try { steps[i][1](); } catch (e) { console.warn('[populate] step failed', steps[i][0], e); }
      console.log(`[populate] ${steps[i][0]}: ${(performance.now() - t0).toFixed(0)} ms`);
      onProgress((i + 1) / steps.length);
      await new Promise(r => setTimeout(r, 0));
    }
    const t0 = performance.now();
    try { this.batchStatic(); } catch (e) { console.warn('[populate] batching failed', e); }
    console.log(`[populate] static batching: ${(performance.now() - t0).toFixed(0)} ms`);
    for (const tr of this.traffic) this.cull.push({ o: tr.g, r: 650 });
  }

  // ---------------------------------------------------------------- Ramnagar town
  town(M) {
    const T = this.T, m = T.marks, r = this.rng;
    const { createShop, createTownBuilding, createBusStand, createTemple, createDhaba } = M.buildings;
    const { createGate, createSign, createHoarding, createBunting } = M.props;
    const { createBus, createAuto, createCar, createJeep } = M.vehicles;
    const { createCow, createDog } = M.animals;
    const { createPerson } = M.people;
    // start gate
    const gate = tryCall(createGate, { title: 'RAMNAGAR', subtitle: 'START  •  रामनगर → रानीखेत', colors: ['#ff7a00', '#ffffff', '#138808'] });
    this.place(gate, this.pos(m.start + 3, 0, { road: true }), this.yawAlong(m.start + 3, true), {});
    // bus stand (right side, set back)
    const bsS = m.busStand + 18; const bsD = T.halfWidth(bsS) + 17;
    const bs = tryCall(createBusStand);
    this.place(bs, this.pos(bsS, bsD), this.yawFaceRoad(bsS, 1), { reserve: 20 });
    // parked buses in the bay
    for (let k = 0; k < 2; k++) {
      const s = bsS - 10 + k * 14; const bus = tryCall(createBus, { seed: 11 + k });
      if (this.place(bus, this.pos(s, T.halfWidth(s) + 6.2), this.yawAlong(s, k === 1), { reserve: 7 })) (this.special.parkedBuses ||= []).push(bus.group);
    }
    // people waiting at the bus stand
    for (let k = 0; k < 11; k++) {
      const s = bsS - 12 + r() * 24, d = bsD - 4 + r() * 5;
      const pose = r() < 0.25 ? 'sit' : r() < 0.15 ? 'squat' : 'stand';
      const pp = tryCall(createPerson, { seed: 100 + k, gender: r() < 0.4 ? 'f' : 'm', age: r() < 0.15 ? 'old' : r() < 0.1 ? 'kid' : 'adult', pose });
      this.place(pp, this.pos(s, d), this.yawFaceRoad(s, 1) + (r() - 0.5) * 1.2, { anim: true, near: 90 });
    }
    // shop rows
    const names = [
      ['बिष्ट जनरल स्टोर', 'BISHT GENERAL STORE', 'general'], ['कॉर्बेट स्वीट्स', 'CORBETT SWEETS', 'sweets'], ['पहाड़ी चाय', 'PAHADI CHAI', 'chai'],
      ['नेगी मेडिकल', 'NEGI MEDICAL STORE', 'medical'], ['रावत मोबाइल', 'RAWAT MOBILE SHOP', 'mobile'], ['बाल मिठाई भंडार', 'BAL MITHAI BHANDAR', 'sweets'],
      ['रामनगर हार्डवेयर', 'RAMNAGAR HARDWARE', 'hardware'], ['होटल कोसी व्यू', 'HOTEL KOSI VIEW', 'hotel'], ['पंत बुक डिपो', 'PANT BOOK DEPOT', 'general'],
      ['जोशी ढाबा', 'JOSHI DHABA', 'chai'], ['कुमाऊँ टूर्स', 'KUMAON TOURS & TRAVELS', 'general'], ['सिंगोड़ी कॉर्नर', 'SINGORI CORNER', 'sweets'],
      ['भट्ट क्लॉथ हाउस', 'BHATT CLOTH HOUSE', 'general'], ['मेहरा किराना', 'MEHRA KIRANA', 'general'], ['उत्तराखंड हैंडलूम', 'UTTARAKHAND HANDLOOM', 'general'],
      ['अधिकारी इलेक्ट्रिकल्स', 'ADHIKARI ELECTRICALS', 'hardware'], ['राणा फोटो स्टूडियो', 'RANA PHOTO STUDIO', 'mobile'], ['बोरा मेडिकोज़', 'BORA MEDICOS', 'medical'],
    ];
    let ni = 0;
    for (const side of [-1, 1]) {
      let s = 2;
      while (s < 790) {
        if (Math.abs(s - (m.start + 3)) < 9) { s = m.start + 12; continue; }
        if (side === 1 && s > bsS - 26 && s < bsS + 26) { s = bsS + 26; continue; }
        if (Math.abs(s - m.chowk) < 14) { s += 28; continue; }
        const isShop = r() < 0.62; const w = isShop ? 6 + r() * 3 : 8 + r() * 5; const dpt = isShop ? 7 + r() * 3 : 9 + r() * 4;
        const half = T.halfWidth(s); const d = (half + 3.2 + dpt / 2) * side;
        const nm = names[ni++ % names.length];
        const obj = isShop ? tryCall(createShop, { seed: 500 + ni, w, d: dpt, sign: { hi: nm[0], en: nm[1] }, kind: nm[2] })
                           : tryCall(createTownBuilding, { seed: 900 + ni, floors: 2 + r.int(0, 2), w, d: dpt });
        const sc = s + w / 2;
        this.place(obj, this.pos(sc, d), this.yawFaceRoad(sc, side), { reserve: Math.max(w, dpt) * 0.75 });
        // shopkeeper / customers
        if (isShop && r() < 0.6) {
          const pp = tryCall(createPerson, { seed: 300 + ni, gender: r() < 0.3 ? 'f' : 'm', pose: r() < 0.3 ? 'sit' : 'stand' });
          this.place(pp, this.pos(sc + (r() - 0.5) * w * 0.6, (half + 2.2) * side), this.yawFaceRoad(sc, side) + Math.PI + (r() - 0.5), { anim: true, near: 80 });
        }
        s += w + (r() < 0.2 ? 4 + r() * 6 : 0.4);
      }
    }
    // small temple at the chowk
    this.place(tryCall(createTemple, { style: 'small' }), this.pos(m.chowk, -(T.halfWidth(m.chowk) + 6)), this.yawFaceRoad(m.chowk, -1), { reserve: 6, anim: true, near: 150 });
    // parked autos / cars on shoulders
    const parked = [[200, -1, 'auto'], [270, 1, 'car'], [420, -1, 'auto'], [470, 1, 'jeep'], [610, -1, 'car'], [700, 1, 'auto']];
    for (const [s, side, kind] of parked) {
      const f = kind === 'auto' ? createAuto : kind === 'jeep' ? createJeep : createCar;
      const veh = tryCall(f, { seed: s });
      const d = (T.halfWidth(s) + 0.9) * side;
      this.place(veh, this.pos(s, d, { road: true }), this.yawAlong(s, side > 0), {});
      this.obstacle(s, d, kind === 'auto' ? 1.4 : 2.1, kind === 'auto' ? 0.75 : 0.9, 'vehicle');
    }
    // cows — one sitting in the lane (obstacle!)
    const cowSpots = [[300, -T.halfWidth(300) + 1.6, 'sit', 'white'], [560, T.halfWidth(560) + 2.5, 'graze', 'brown'], [655, T.halfWidth(655) - 1.4, 'stand', 'spotted'], [140, -(T.halfWidth(140) + 2.2), 'sit', 'black']];
    cowSpots.forEach(([s, d, pose, color], k) => {
      const cow = tryCall(createCow, { seed: 40 + k, pose, color });
      const yaw = this.yawAlong(s) + (r() - 0.5) * 2.5;
      this.place(cow, this.pos(s, d, { road: Math.abs(d) < T.halfWidth(s) + 1 }), yaw, { anim: true, near: 120 });
      if (Math.abs(d) < T.halfWidth(s) + 1.2) this.obstacle(s, d, 1.1, 0.9, 'cow', cow);
      this.triggers.push({ s: s - 45, fired: false, fn: (A) => A.sfx('cowMoo', { pos: this.pos(s, d) }) });
    });
    // dogs
    for (const [s, d] of [[230, 7.5], [520, -7.2], [740, 7]]) this.place(tryCall(createDog, { seed: s }), this.pos(s, d), r() * 6, { anim: true, near: 80 });
    // pedestrians along the bazaar
    for (let k = 0; k < Math.round(16 * this.q.people); k++) {
      const s = 110 + r() * 650, side = r() < 0.5 ? -1 : 1; const d = (T.halfWidth(s) + 1.6 + r() * 1.2) * side;
      const pose = r() < 0.12 ? 'wave' : r() < 0.25 ? 'squat' : 'stand';
      this.place(tryCall(createPerson, { seed: 700 + k, gender: r() < 0.35 ? 'f' : 'm', age: r() < 0.12 ? 'kid' : r() < 0.12 ? 'old' : 'adult', pose }), this.pos(s, d), this.yawFaceRoad(s, side) + (r() - 0.5) * 2, { anim: true, near: 90 });
    }
    // hoardings & bunting
    this.place(tryCall(createHoarding, { lines: ['JIM CORBETT NATIONAL PARK', 'जिम कॉर्बेट नेशनल पार्क  →  15 KM'] }), this.pos(250, -(T.halfWidth(250) + 9)), this.yawFaceRoad(250, -1) + 0.5, { reserve: 5 });
    this.place(tryCall(createBunting, { length: T.halfWidth(400) * 2 + 4 }), this.pos(400, 0, { road: true, y: T.elevation(400) + 6.5 }), this.yawAlong(400) + Math.PI / 2, {});
    this.place(tryCall(createSign, { kind: 'welcome', lines: ['WELCOME TO RAMNAGAR', 'रामनगर में आपका स्वागत है', 'Gateway to Corbett'] }), this.pos(20, -(T.halfWidth(20) + 3)), this.yawAlong(20, true) - 0.3, {});
  }

  // ---------------------------------------------------------------- Corbett forest
  forest(M) {
    const T = this.T, m = T.marks, r = this.rng;
    const { createSign } = M.props;
    const { createTiger, createDeer, createElephant, createPeacock, createMonkey, createBirdFlock } = M.animals;
    this.place(tryCall(createSign, { kind: 'forest', lines: ['CORBETT TIGER RESERVE', 'कॉर्बेट टाइगर रिज़र्व', 'Jungle me horn na bajayein'] }), this.pos(m.forestGate, T.halfWidth(m.forestGate) + 3.5), this.yawAlong(m.forestGate, true) + 0.35, {});
    for (const s of [1010, 1560]) this.place(tryCall(createSign, { kind: 'warning', lines: ['ELEPHANT CROSSING', 'हाथी क्षेत्र — धीरे चलें'] }), this.pos(s, -(T.halfWidth(s) + 2.6)), this.yawAlong(s, true) - 0.3, {});
    // deer herd
    for (let k = 0; k < 4; k++) {
      const s = m.deer + k * 6 + r() * 4, d = T.halfWidth(s) + 14 + r() * 12;
      this.place(tryCall(createDeer, { seed: 60 + k, male: k === 0 }), this.pos(s, d), this.yawFaceRoad(s, 1) + (r() - 0.5) * 2, { anim: true, near: 140, reserve: 2 });
    }
    // the tiger, sitting at the jungle edge watching the road
    const ts = m.tiger, td = -(T.halfWidth(ts) + 6.5);
    const tiger = tryCall(createTiger, { seed: 7, pose: 'sit' });
    this.place(tiger, this.pos(ts, td), this.yawFaceRoad(ts, -1) + 0.35, { anim: true, near: 200, reserve: 4 });
    this.special.tiger = { obj: tiger, s: ts };
    this.triggers.push({ s: ts - 70, fired: false, fn: (A, game) => { A.sfx('tigerRoar', { pos: this.pos(ts, td), volume: 1.3 }); tiger?.roar?.(); game?.toast?.('SHER! 🐅  Corbett ka Raja dekh raha hai...'); } });
    // elephant
    const es = m.elephant; this.place(tryCall(createElephant, { seed: 3 }), this.pos(es, T.halfWidth(es) + 24), this.yawFaceRoad(es, 1) - 0.6, { anim: true, near: 220, reserve: 6 });
    this.triggers.push({ s: es - 60, fired: false, fn: (A) => A.sfx('elephant', { pos: this.pos(es, T.halfWidth(es) + 24) }) });
    // animals that walk ACROSS the road when a rider comes close (Corbett: elephant & tiger crossings)
    this.crossers = [];
    const addCrosser = (make, s, fromSide, kind, { trigger, speedMul = 1, hl, hw, sound, toast }) => {
      const obj = tryCall(make, { seed: Math.round(s), pose: 'walk', male: true });
      if (!obj) return;
      const half = T.halfWidth(s); const d0 = fromSide * (half + (kind === 'elephant' ? 2.6 : 2.2));
      this.place(obj, this.pos(s, d0, { road: true }), this.yawFaceRoad(s, fromSide), { anim: true, near: 260 });
      const c = { obj, kind, s, dir: -fromSide, d: d0, d0, state: 'wait', trigger, speed: (obj.walkSpeed || 1) * speedMul, sound, toast };
      c.ob = this.obstacle(s, 999, hl, hw, kind, c);
      this.crossers.push(c);
    };
    addCrosser(createElephant, 1556, -1, 'elephant', { trigger: 125, speedMul: 1.35, hl: 2.4, hw: 1.5, sound: 'elephant', toast: '🐘 HAATHI SADAK PAR! Dhyaan se...' });
    addCrosser(createTiger, 1268, 1, 'tiger', { trigger: 95, speedMul: 2.4, hl: 1.4, hw: 0.7, sound: 'tigerRoar', toast: '🐅 SHER SADAK PAAR KAR RAHA HAI!' });
    // peacock
    this.place(tryCall(createPeacock, { seed: 5 }), this.pos(960, -(T.halfWidth(960) + 9)), 1.2, { anim: true, near: 100 });
    this.triggers.push({ s: 900, fired: false, fn: (A) => A.sfx('peacock', { pos: this.pos(960, -12) }) });
    // monkeys near road
    for (const [s, d] of [[1210, 5.8], [1218, 6.6], [1760, -6.4]]) this.place(tryCall(createMonkey, { seed: s, kind: 'rhesus', pose: 'sit' }), this.pos(s, d * (T.halfWidth(s) / 4)), this.yawFaceRoad(s, Math.sign(d)), { anim: true, near: 90 });
    // birds
    for (const s of [1000, 1500]) { const f = tryCall(createBirdFlock, { seed: s, count: 14, radius: 45, height: 0 }); if (f) { const p = this.pos(s, 0, { road: true }); p.y += 38; this.place(f, p, 0, { anim: true, near: 600 }); } }
  }

  // ---------------------------------------------------------------- Kosi river valley
  river(M) {
    const T = this.T, m = T.marks, r = this.rng;
    const { createTemple, createDhaba } = M.buildings;
    const { createSign, createBridge } = M.props;
    const { createMonkey, createBirdFlock, createCow } = M.animals;
    const { createPerson } = M.people;
    const { createJeep } = M.vehicles;
    // Garjiya Devi temple on its rock in the Kosi
    const gq = this.rivers.garjiyaPos;
    if (gq) {
      const L = this.rivers.main; const a = L.pts[gq.i], b = L.pts[gq.i + 1];
      const p = new THREE.Vector3(lerp(a.x, b.x, gq.t), gq.y - 1.6, lerp(a.z, b.z, gq.t));
      const c = T.center(m.garjiya, new THREE.Vector3());
      const temple = tryCall(createTemple, { style: 'garjiya', bridgeLength: 18 });
      this.place(temple, p, this.yawTo(c.x - p.x, c.z - p.z), { reserve: 14, anim: true, near: 400, water: true });
      this.special.garjiya = p;
      this.triggers.push({ s: m.garjiya - 120, fired: false, fn: (A, game) => { game?.toast?.('🛕 GARJIYA DEVI MANDIR — Kosi nadi ke beech'); A.sfx('templeBell', { pos: p }); } });
      // devotees on the bank
      for (let k = 0; k < 5; k++) {
        const s = m.garjiya - 10 + k * 5; const d = T.halfWidth(s) + 3 + r() * 2;
        this.place(tryCall(createPerson, { seed: 1200 + k, gender: k % 2 ? 'f' : 'm', pose: k === 2 ? 'wave' : 'stand' }), this.pos(s, d), this.yawFaceRoad(s, 1) + Math.PI, { anim: true, near: 90 });
      }
    }
    // dhaba on the hill side
    const ds = m.dhaba1, dd = -(T.halfWidth(ds) + 8);
    this.place(tryCall(createDhaba, { seed: 1, sign: 'KOSI DHABA • चाय मैगी पराठा' }), this.pos(ds, dd), this.yawFaceRoad(ds, -1), { reserve: 9 });
    this.place(tryCall(createJeep, { seed: 5 }), this.pos(ds + 10, -(T.halfWidth(ds) + 1.2), { road: true }), this.yawAlong(ds), {});
    this.obstacle(ds + 10, -(T.halfWidth(ds) + 1.2), 2.2, 0.95, 'vehicle');
    for (let k = 0; k < 4; k++) this.place(tryCall(createPerson, { seed: 1300 + k, pose: k < 2 ? 'sit' : 'stand' }), this.pos(ds - 4 + k * 2.5, dd + 4), this.yawFaceRoad(ds, -1) + Math.PI + (r() - 0.5), { anim: true, near: 80 });
    // bridge
    const br = this.rivers.bridgeSpan;
    const bridge = tryCall(createBridge, { length: (br.s1 - br.s0) + 6, width: T.halfWidth(br.s) * 2 + 2 });
    if (bridge) { const p = this.pos(br.s, 0, { road: true }); p.y = T.elevation(br.s) - 0.02; this.place(bridge, p, this.yawAlong(br.s), {}); }
    // langurs on parapets
    for (const s of [2240, 2246, 2505, 2830]) this.place(tryCall(createMonkey, { seed: s, kind: 'langur', pose: 'sit' }), this.pos(s, T.halfWidth(s) + 0.95, { road: true, y: T.surfaceY(s, T.halfWidth(s)) + 0.72 }), this.yawFaceRoad(s, 1) + (r() - 0.5) * 2, { anim: true, near: 90 });
    this.triggers.push({ s: 2200, fired: false, fn: (A) => A.sfx('monkey', { pos: this.pos(2240, 5) }) });
    this.place(tryCall(createSign, { kind: 'warning', lines: ['FALLING ROCKS', 'भूस्खलन क्षेत्र — सावधान'] }), this.pos(2790, -(T.halfWidth(2790) + 2)), this.yawAlong(2790, true) - 0.3, {});
    this.place(tryCall(createSign, { kind: 'bro', lines: ['BE GENTLE', 'ON MY CURVES'] }), this.pos(2420, -(T.halfWidth(2420) + 2.2)), this.yawAlong(2420, true) - 0.3, {});
    const f = tryCall(createBirdFlock, { seed: 9, count: 10, radius: 60, height: 0 }); if (f) { const p = this.pos(2400, 40, {}); p.y += 30; this.place(f, p, 0, { anim: true, near: 600 }); }
    this.place(tryCall(createCow, { seed: 77, pose: 'graze', color: 'brown' }), this.pos(2000, -(T.halfWidth(2000) + 5)), 0.4, { anim: true, near: 100 });
  }

  // ---------------------------------------------------------------- hairpin mountain road
  mountain(M) {
    const T = this.T, m = T.marks, r = this.rng;
    const { createKumaoniHouse, createDhaba, createTemple } = M.buildings;
    const { createSign } = M.props;
    const { createCow, createMonkey, createSnake, createBirdFlock, createDog } = M.animals;
    const { createPerson } = M.people;
    const { createJeep } = M.vehicles;
    // waterfall shrine
    const wf = this.rivers.waterfall;
    if (wf) this.place(tryCall(createTemple, { style: 'small' }), this.pos(wf.s + 14, -(T.halfWidth(wf.s) + 5)), this.yawFaceRoad(wf.s + 14, -1), { reserve: 5 });
    this.triggers.push({ s: (wf?.s || 3080) - 120, fired: false, fn: (A, game) => game?.toast?.('💧 Pahadi jharna — thanda paani!') });
    // Kumaoni village on the uphill side
    const vs = m.village; const up = this.uphillSide(vs);
    const houses = [[-30, 16], [-10, 22], [14, 15], [34, 26], [6, 40], [-22, 38], [50, 18]];
    houses.forEach(([ds, dd], k) => {
      const s = vs + ds; const d = (T.halfWidth(s) + dd) * up;
      const p = this.pos(s, d);
      this.place(tryCall(createKumaoniHouse, { seed: 40 + k }), p, this.yawFaceRoad(s, up) + (r() - 0.5) * 0.3, { reserve: 7 });
    });
    for (let k = 0; k < 6; k++) {
      const s = vs - 20 + k * 9; const d = (T.halfWidth(s) + 4 + r() * 6) * up;
      this.place(tryCall(createPerson, { seed: 1500 + k, gender: k % 2 ? 'f' : 'm', age: k === 3 ? 'old' : k === 5 ? 'kid' : 'adult', pose: k === 1 ? 'wave' : k === 4 ? 'squat' : 'stand' }), this.pos(s, d), this.yawFaceRoad(s, up), { anim: true, near: 90 });
    }
    this.place(tryCall(createCow, { seed: 90, pose: 'stand', color: 'brown' }), this.pos(vs + 22, (T.halfWidth(vs) + 7) * up), 1.1, { anim: true, near: 100 });
    this.place(tryCall(createCow, { seed: 91, pose: 'sit', color: 'white' }), this.pos(vs - 34, (T.halfWidth(vs) + 9) * up), 2.4, { anim: true, near: 100 });
    this.place(tryCall(createDog, { seed: 92 }), this.pos(vs + 4, (T.halfWidth(vs) + 3) * up), 0.2, { anim: true, near: 80 });
    this.triggers.push({ s: vs - 100, fired: false, fn: (A, game) => { game?.toast?.('🏡 Kumaoni gaon — Mohan'); } });
    // dhaba 2 with a view
    const d2s = m.dhaba2; const d2side = -this.uphillSide(d2s);
    this.place(tryCall(createDhaba, { seed: 2, sign: 'PAHADI DHABA • MAGGI POINT' }), this.pos(d2s, (T.halfWidth(d2s) + 7) * d2side), this.yawFaceRoad(d2s, d2side), { reserve: 9 });
    for (let k = 0; k < 3; k++) this.place(tryCall(createPerson, { seed: 1600 + k, pose: k ? 'sit' : 'stand' }), this.pos(d2s - 3 + k * 3, (T.halfWidth(d2s) + 3.5) * d2side), this.yawFaceRoad(d2s, d2side) + Math.PI, { anim: true, near: 80 });
    this.place(tryCall(createJeep, { seed: 9 }), this.pos(d2s + 11, (T.halfWidth(d2s) + 1.1) * d2side, { road: true }), this.yawAlong(d2s), {});
    this.obstacle(d2s + 11, (T.halfWidth(d2s) + 1.1) * d2side, 2.2, 0.95, 'vehicle');
    // snake crossing (starts when a rider gets close)
    const ss = m.snake;
    const snake = tryCall(createSnake, { seed: 4, kind: 'cobra' });
    if (snake) {
      const startD = -(T.halfWidth(ss) + 1.5);
      this.place(snake, this.pos(ss, startD, { road: true }), this.yawFaceRoad(ss, -1), { anim: true, near: 140 });
      this.special.snake = { obj: snake, s: ss, d: startD, moving: false };
      this.triggers.push({ s: ss - 90, fired: false, fn: (A, game) => { this.special.snake.moving = true; A.sfx('snakeHiss', { pos: this.pos(ss, 0, { road: true }) }); game?.toast?.('🐍 Saanp! Sadak paar kar raha hai'); } });
    }
    // monkeys on parapets in bends
    for (const s of [3320, 3326, 3700, 4120, 4380]) {
      const side = -this.uphillSide(s);
      this.place(tryCall(createMonkey, { seed: s, kind: r() < 0.5 ? 'langur' : 'rhesus', pose: 'sit' }), this.pos(s, (T.halfWidth(s) + 0.95) * side, { road: true, y: T.surfaceY(s, T.halfWidth(s) * side) + 0.72 }), this.yawFaceRoad(s, side), { anim: true, near: 90 });
    }
    this.triggers.push({ s: 3290, fired: false, fn: (A) => A.sfx('monkey', { pos: this.pos(3320, 4) }) });
    // BRO slogans
    const bro = [[3020, ['DRIVE LIKE HELL', "YOU'LL BE THERE"]], [3620, ['AFTER WHISKY', 'DRIVING RISKY']], [4060, ['PEEP PEEP', "DON'T SLEEP"]], [4460, ['DARLING I LIKE YOU', 'BUT NOT SO FAST']]];
    for (const [s, lines] of bro) { const side = this.uphillSide(s); this.place(tryCall(createSign, { kind: 'bro', lines }), this.pos(s, (T.halfWidth(s) + 2.2) * side), this.yawAlong(s, true) - 0.3 * side, {}); }
    const f = tryCall(createBirdFlock, { seed: 21, count: 12, radius: 70, height: 0 }); if (f) { const p = this.pos(3800, 0, { road: true }); p.y += 60; this.place(f, p, 0, { anim: true, near: 800 }); }
  }

  // ---------------------------------------------------------------- Ranikhet ridge
  ridge(M) {
    const T = this.T, m = T.marks, r = this.rng;
    const { createColonialBuilding, createChurch, createKumaoniHouse, createShop } = M.buildings;
    const { createSign, createGate, createBunting, createHoarding } = M.props;
    const { createPerson } = M.people;
    const { createCar, createJeep } = M.vehicles;
    const { createBirdFlock, createDog } = M.animals;
    this.place(tryCall(createSign, { kind: 'welcome', lines: ['WELCOME TO RANIKHET', 'रानीखेत में आपका स्वागत है', 'Cantonment • 1869 m'] }), this.pos(m.ranikhetGate, T.halfWidth(m.ranikhetGate) + 3), this.yawAlong(m.ranikhetGate, true) + 0.3, {});
    this.place(tryCall(createChurch), this.pos(m.church, (T.halfWidth(m.church) + 18)), this.yawFaceRoad(m.church, 1), { reserve: 14 });
    // colonial bungalows & Kumaoni houses
    for (let s = 4760; s < 5400; s += 34 + r() * 26) {
      if (Math.abs(s - m.church) < 30) continue;
      const side = r() < 0.5 ? -1 : 1; const d = (T.halfWidth(s) + 12 + r() * 10) * side;
      const f = r() < 0.65 ? createColonialBuilding : createKumaoniHouse;
      this.place(tryCall(f, { seed: Math.round(s) }), this.pos(s, d), this.yawFaceRoad(s, side), { reserve: 10 });
    }
    // small market near finish
    for (let k = 0; k < 5; k++) {
      const s = m.finish - 120 + k * 11; const side = k % 2 ? 1 : -1;
      this.place(tryCall(createShop, { seed: 3000 + k, w: 7, d: 7, sign: [{ hi: 'रानीखेत टी स्टॉल', en: 'RANIKHET TEA STALL' }, { hi: 'चौबटिया फ्रूट्स', en: 'CHAUBATIA FRUITS' }, { hi: 'केएमवीएन गेस्ट हाउस', en: 'HILL VIEW GUEST HOUSE' }, { hi: 'कुमाऊँ वूलन्स', en: 'KUMAON WOOLLENS' }, { hi: 'झूला देवी प्रसाद', en: 'JHULA DEVI PRASAD' }][k], kind: 'general' }), this.pos(s, (T.halfWidth(s) + 7) * side), this.yawFaceRoad(s, side), { reserve: 6 });
    }
    // finish gate + bunting + crowd
    const fs = m.finish;
    this.place(tryCall(createGate, { title: 'RANIKHET', subtitle: 'FINISH  •  रानीखेत', colors: ['#d40000', '#ffffff', '#111111'] }), this.pos(fs, 0, { road: true }), this.yawAlong(fs, true), {});
    for (const off of [-30, -14, 16]) this.place(tryCall(createBunting, { length: T.halfWidth(fs + off) * 2 + 5 }), this.pos(fs + off, 0, { road: true, y: T.elevation(fs + off) + 6 }), this.yawAlong(fs + off) + Math.PI / 2, {});
    const crowdN = Math.round(26 * this.q.people);
    for (let k = 0; k < crowdN; k++) {
      const s = fs - 40 + r() * 70, side = r() < 0.5 ? -1 : 1; const d = (T.halfWidth(s) + 1.8 + r() * 2.5) * side;
      const far = Math.abs(s - fs) > 25;
      this.place(tryCall(createPerson, { seed: 4000 + k, gender: r() < 0.4 ? 'f' : 'm', age: r() < 0.15 ? 'kid' : 'adult', pose: r() < 0.6 ? 'cheer' : 'wave', static: false }), this.pos(s, d), this.yawFaceRoad(s, side) + (r() - 0.5) * 0.8, { anim: true, near: far ? 70 : 110 });
    }
    this.place(tryCall(createHoarding, { lines: ['CHAUBATIA GARDENS  10 KM', 'चौबटिया बाग़ • KALIKA GOLF COURSE 5 KM'] }), this.pos(5200, -(T.halfWidth(5200) + 8)), this.yawFaceRoad(5200, -1) + 0.4, { reserve: 5 });
    for (const [s, side] of [[fs - 60, 1], [fs - 75, -1], [fs + 30, 1]]) {
      const veh = tryCall(r() < 0.5 ? createCar : createJeep, { seed: Math.round(s) });
      const d = (T.halfWidth(s) + 1.1) * side; this.place(veh, this.pos(s, d, { road: true }), this.yawAlong(s, side > 0), {});
      this.obstacle(s, d, 2.1, 0.9, 'vehicle');
    }
    this.place(tryCall(createDog, { seed: 55 }), this.pos(fs - 50, T.halfWidth(fs) + 4), 2, { anim: true, near: 80 });
    const f = tryCall(createBirdFlock, { seed: 33, count: 16, radius: 80, height: 0 }); if (f) { const p = this.pos(5100, 0, { road: true }); p.y += 55; this.place(f, p, 0, { anim: true, near: 800 }); }
    this.triggers.push({ s: fs - 160, fired: false, fn: (A, game) => { game?.toast?.('🏁 RANIKHET aa gaya! Finish line saamne hai!'); } });
  }

  /** merge all static meshes sharing a material into a few big meshes per 320 m cell (huge draw-call saving) */
  batchStatic() {
    const CELL = 480; const buckets = new Map(); const remove = []; const keep = new Set();
    const pos = new THREE.Vector3();
    for (const root of this.staticRoots) {
      root.updateMatrixWorld(true);
      root.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) return;
        const m = o.material;
        if (Array.isArray(m) || Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') || m.isShaderMaterial) return;
        if (m.aoMap || m.lightMap || m.userData?.noBatch || o.userData?.noBatch || o.geometry.morphAttributes?.position) return;
        if ((o.geometry.groups?.length || 0) > 1) return;
        pos.setFromMatrixPosition(o.matrixWorld);
        const key = m.uuid + '|' + Math.floor(pos.x / CELL) + ',' + Math.floor(pos.z / CELL);
        let b = buckets.get(key); if (!b) buckets.set(key, b = { m, geos: [], cast: false, n: 0 });
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
        b.geos.push(g); b.cast = b.cast || o.castShadow; b.n++;
        remove.push(o);
      });
    }
    let made = 0, merged = 0;
    for (const b of buckets.values()) {
      if (b.n < 2) { continue; }
      let geo = null; try { geo = mergeSafe(b.geos); } catch (e) { geo = null; }
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.m); mesh.castShadow = b.cast && this.q.shadows; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
      this.scene.add(mesh); made++; merged += b.n;
      b.done = true;
    }
    // remove originals that were merged
    const doneMats = new Set(); for (const [k, b] of buckets) if (b.done) doneMats.add(k);
    for (const o of remove) {
      o.updateMatrixWorld(); pos.setFromMatrixPosition(o.matrixWorld);
      const key = o.material.uuid + '|' + Math.floor(pos.x / CELL) + ',' + Math.floor(pos.z / CELL);
      if (doneMats.has(key)) o.removeFromParent();
    }
    // whatever could not be merged (unique sign materials, instanced wheels…) is distance-culled per root
    for (const root of this.staticRoots) {
      let has = false; root.traverse(o => { if (o.isMesh) has = true; });
      if (has) { const bs = new THREE.Box3().setFromObject(root); const size = bs.getSize(pos).length(); this.cull.push({ o: root, r: clamp(160 + size * 22, 220, 900) * (this.q.cullScale || 1) }); }
    }
    console.log(`[populate] batched ${merged} meshes into ${made}`);
  }

  /** roadside Maggi points (stop + EAT = cinematic break, see game/maggi.js) */
  maggi(M) {
    const { createMaggiStall, createMaggiMarker } = M.maggi || {};
    const { createPerson } = M.people || {};
    this.special.maggi = [];
    if (!createMaggiStall) return;
    const T = this.T; const UP = new THREE.Vector3(0, 1, 0);
    [[1985, 'KOSI'], [3215, 'PAHADI'], [4672, 'RANIKHET']].forEach(([s, name], k) => {
      const side = this.uphillSide(s); const half = T.halfWidth(s);
      const stall = tryCall(createMaggiStall, { seed: 50 + k }); if (!stall) return;
      const p = this.pos(s, side * (half + 5.2)); const yaw = this.yawFaceRoad(s, side);
      if (!this.place(stall, p, yaw, { anim: true, near: 240, reserve: 4.6 })) return;
      const keeper = tryCall(createPerson, { seed: 900 + k, gender: 'm', age: k === 1 ? 'old' : 'adult', pose: 'cook', detail: 'high' });
      const kp = stall.keeperLocal.clone().applyAxisAngle(UP, yaw).add(p); kp.y += 0.08;
      const ladle = M.maggi.createLadle?.();
      if (keeper) {
        this.place(keeper, kp, yaw, { anim: true, near: 160, water: true });
        try { keeper.setStation?.({ pot: [-0.05, 1.1, 0.45], counterY: 0.9, counterZ: 0.42 }); if (ladle) keeper.holdProp?.(ladle, 'right'); } catch (e) { console.warn('[maggi keeper]', e); }
      }
      const marker = createMaggiMarker(); marker.group.position.copy(p); this.scene.add(marker.group);
      const potWorld = stall.potLocal.clone().applyAxisAngle(UP, yaw).add(p);
      this.special.maggi.push({ kind: 'maggi', s, side, name, pos: p.clone(), yaw, stall, keeper, ladle, marker, potWorld, parkS: s + 1.2, parkD: side * (half + 0.35) });
    });
    // one "theka" style beer shop at the edge of the Kumaoni village
    this.special.stops = [...this.special.maggi];
    const { createBeerShop } = M.beer || {};
    const { createStopMarker } = M.maggi || {};
    if (createBeerShop && createStopMarker) {
      const s = (T.marks.village || 3566) + 92; const side = this.uphillSide(s); const half = T.halfWidth(s);
      const shop = tryCall(createBeerShop, { seed: 7 });
      const p = this.pos(s, side * (half + 5.4)); const yaw = this.yawFaceRoad(s, side);
      if (shop && this.place(shop, p, yaw, { reserve: 4.8 })) {
        const keeper = tryCall(createPerson, { seed: 1777, gender: 'm', age: 'adult', pose: 'stand', detail: 'high' });
        const kp = shop.keeperLocal.clone().applyAxisAngle(UP, yaw).add(p); kp.y += 0.08;
        if (keeper) {
          this.place(keeper, kp, yaw, { anim: true, near: 160, water: true });
          try { keeper.setStation?.({ counterY: 0.94, counterZ: 0.6, serve: [0, 1.06, 0.62] }); } catch (e) { console.warn('[beer keeper]', e); }
        }
        const marker = createStopMarker({ icon: '🍺', label: 'BEER', color: '#ffb000', beam: 'rgba(255,170,40,' });
        marker.group.position.copy(p); this.scene.add(marker.group);
        const focusWorld = shop.windowLocal.clone().applyAxisAngle(UP, yaw).add(p); focusWorld.y -= 0.25;
        const st = { kind: 'beer', s, side, name: 'BEER', pos: p.clone(), yaw, stall: shop, keeper, marker, focusWorld, parkS: s + 1.2, parkD: side * (half + 0.35) };
        this.special.beer = st; this.special.stops.push(st);
      }
    }
  }

  /** +1 if the right side of the road is uphill at s, else -1 */
  uphillSide(s) {
    const T = this.T; const half = T.halfWidth(s);
    const pl = T.point(s, -(half + 14), new THREE.Vector3()), pr = T.point(s, half + 14, new THREE.Vector3());
    return this.terrain.heightAt(pr.x, pr.z) > this.terrain.heightAt(pl.x, pl.z) ? 1 : -1;
  }

  // ---------------------------------------------------------------- repeated roadside props (instanced)
  roadside(M) {
    const T = this.T, m = T.marks; const { getPropTemplate, createMilestone } = M.props;
    const dummy = new THREE.Object3D();
    const inst = (name, list, { shadow = false, mirrorable = false } = {}) => {
      if (!list.length) return;
      const tpl = tryCall(getPropTemplate, name); if (!tpl) return;
      let mat = tpl.material; if (mirrorable) { mat = Array.isArray(mat) ? mat.map(x => { const c = x.clone(); c.side = THREE.DoubleSide; return c; }) : mat.clone(); if (!Array.isArray(mat)) mat.side = THREE.DoubleSide; }
      const mesh = new THREE.InstancedMesh(tpl.geometry, mat, list.length);
      list.forEach((it, i) => { dummy.position.copy(it.p); dummy.rotation.set(0, it.yaw, 0); dummy.scale.set(it.sx || 1, it.sy || 1, it.sz || 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
      mesh.castShadow = shadow && this.q.shadows; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      this.scene.add(mesh);
      return mesh;
    };
    const br = this.rivers.bridgeSpan;
    const nearBridge = (s) => s > br.s0 - 4 && s < br.s1 + 4;
    const N = T.N; this.barrier = { L: new Uint8Array(N), R: new Uint8Array(N) };
    const markB = (s0, s1, side) => { const arr = side > 0 ? this.barrier.R : this.barrier.L; for (let i = Math.max(0, Math.floor(s0 / 2)); i <= Math.min(N - 1, Math.ceil(s1 / 2)); i++) arr[i] = 1; };
    markB(br.s0 - 4, br.s1 + 4, 1); markB(br.s0 - 4, br.s1 + 4, -1); // bridge railings
    // parapets: valley side where the drop is significant (river / mountain / ridge)
    const parapets = [], railSpans = [], chevL = [], chevR = [], reflectors = [];
    let railStart = null, railSide = 0;
    for (let s = 860; s < T.length - 20; s += 2.4) {
      const z = T.zoneAt(s).id; if (z === 'town') continue;
      if (nearBridge(s)) continue;
      const half = T.halfWidth(s);
      for (const side of [-1, 1]) {
        const pE = T.point(s, (half + 1) * side, this.v); const yRoad = pE.y;
        const pF = T.point(s, (half + 9) * side, new THREE.Vector3());
        const drop = yRoad - this.terrain.heightAt(pF.x, pF.z);
        const isValley = drop > 2.6;
        if (z === 'forest') { if (Math.round(s / 2.4) % 21 === 0) reflectors.push({ p: T.point(s, (half + 1.3) * side, new THREE.Vector3()), yaw: this.yawAlong(s) }); continue; }
        if (isValley) {
          // alternate: parapet blocks mostly, metal rail on fast sweepers in the ridge
          const useRail = z === 'ridge' || (z === 'river' && s > 2300 && s < 2500);
          if (useRail) { if (railStart === null || railSide !== side) { if (railStart !== null) railSpans.push({ s0: railStart, s1: s - 2.4, side: railSide }); railStart = s; railSide = side; } }
          else {
            if (railStart !== null && railSide === side) { railSpans.push({ s0: railStart, s1: s - 2.4, side: railSide }); railStart = null; }
            const p = T.point(s, (half + 0.95) * side, new THREE.Vector3()); p.y = T.surfaceY(s, (half + 0.95) * side) - 0.05;
            parapets.push({ p, yaw: this.yawAlong(s) }); markB(s - 1.3, s + 1.3, side);
          }
        } else if (railStart !== null && railSide === side) { railSpans.push({ s0: railStart, s1: s - 2.4, side: railSide }); railStart = null; }
      }
    }
    if (railStart !== null) railSpans.push({ s0: railStart, s1: T.length - 30, side: railSide });
    for (const sp of railSpans) markB(sp.s0, sp.s1, sp.side);
    // chevrons on tight bends (outside of curve)
    for (let s = 900; s < T.length - 20; s += 7) {
      const k = T.curvature(s); if (Math.abs(k) < 0.018) continue;
      const side = k > 0 ? 1 : -1; const half = T.halfWidth(s);
      const p = T.point(s, (half + 1.9) * side, new THREE.Vector3()); p.y = this.terrain.heightAt(p.x, p.z);
      (k > 0 ? chevL : chevR).push({ p, yaw: this.yawAlong(s, true) });
    }
    inst('parapet', parapets, { shadow: true });
    inst('chevron', chevL);       // arrow toward sign's +X = rider's left (left-hand bends)
    inst('chevronLeft', chevR);   // arrow toward rider's right (right-hand bends)
    inst('reflectorPost', reflectors);
    const rails = this.w.buildRails(railSpans);
    if (rails?.posts?.length) inst('barrierPost', rails.posts.map(pp => ({ p: new THREE.Vector3(pp.x, pp.y, pp.z), yaw: pp.rotY })));
    // electric poles (town: left side, villages)
    const poles = [], lights = [];
    for (let s = 40; s < 820; s += 32) { const p = this.pos(s, -(T.halfWidth(s) + 2.6)); poles.push({ p, yaw: this.yawAlong(s) }); }
    for (let s = 50; s < 820; s += 44) { const p = this.pos(s, T.halfWidth(s) + 2.2); lights.push({ p, yaw: this.yawFaceRoad(s, 1) }); }
    for (let s = 4700; s < T.length - 40; s += 36) { const side = this.uphillSide(s); const p = this.pos(s, (T.halfWidth(s) + 2.4) * side); poles.push({ p, yaw: this.yawAlong(s) }); }
    inst('pole', poles, { shadow: true });
    inst('streetlight', lights, { shadow: true });
    this.poleSpots = [...poles.map(p => ({ x: p.p.x, z: p.p.z, r: 0.2, kind: 'pole' })), ...lights.map(p => ({ x: p.p.x, z: p.p.z, r: 0.15, kind: 'pole' }))];
    this.w.buildWires(poles);
    // milestones every 500 m: distance to Ranikhet (real ~95 km)
    const fin = m.finish;
    for (let s = 200; s < fin - 100; s += 500) {
      const km = Math.max(1, Math.round(95 * (1 - s / fin)));
      const ms = tryCall(createMilestone, { place: 'RANIKHET', km, kind: 'nh' });
      const p = this.pos(s, -(T.halfWidth(s) + 1.7));
      this.place(ms, p, this.yawAlong(s, true) - 0.25, {});
    }
  }

  // ---------------------------------------------------------------- moving traffic (deterministic in race time)
  trafficSetup(M) {
    const { createBus, createJeep, createTruck, createCar, createAuto } = M.vehicles;
    const T = this.T;
    // [factory, s0, s1, speed m/s (sign: + = toward Ranikhet), kind, len, wid]
    const list = [
      [createCar, 120, 800, 7.5, 'car', 3.8, 1.7], [createAuto, 760, 160, -6, 'auto', 2.8, 1.4],
      [createTruck, 900, 1840, 9.5, 'truck', 7.4, 2.4], [createJeep, 1850, 950, -11, 'jeep', 4.3, 1.8],
      [createBus, 2920, 1900, -10.5, 'bus', 10, 2.5], [createCar, 1950, 2900, 10, 'car', 3.8, 1.7],
      [createBus, 3000, 4520, 7.5, 'bus', 10, 2.5], [createJeep, 4540, 3000, -8.5, 'jeep', 4.3, 1.8],
      [createCar, 4600, 5380, 9, 'car', 3.8, 1.7], [createTruck, 4520, 3050, -7, 'truck', 7.4, 2.4],
    ];
    list.forEach(([f, s0, s1, v, kind, len, wid], i) => {
      const obj = tryCall(f, { seed: 600 + i });
      if (!obj) return;
      const g = obj.isObject3D ? obj : obj.group;
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
      const dir = Math.sign(v);
      const lane = dir > 0 ? -1 : 1; // India: keep left
      const tr = { obj, g, s0: Math.min(s0, s1), s1: Math.max(s0, s1), v: Math.abs(v), dir, lane, len, wid, kind, phase: i * 137.0, s: 0, d: 0, honk: 0 };
      this.traffic.push(tr);
      const ob = this.obstacle(0, 0, len / 2, wid / 2, 'traffic', tr); tr.ob = ob;
    });
    this.updateTraffic(0);
  }

  updateTraffic(raceTime, dt = 0, playerS = null, A = null) {
    const T = this.T;
    for (const tr of this.traffic) {
      const span = tr.s1 - tr.s0;
      const u = ((tr.phase + raceTime * tr.v) % span + span) % span;
      const s = tr.dir > 0 ? tr.s0 + u : tr.s1 - u;
      const half = T.halfWidth(s); const d = tr.lane * half * 0.48;
      if (Math.abs(s - tr.s) > 60 && tr.s !== 0) tr.spawnT = 2.5; // wrapped around its route: not solid for a moment
      tr.spawnT = Math.max(0, (tr.spawnT || 0) - dt);
      tr.s = s; tr.d = d; tr.ob.s = s; tr.ob.d = tr.spawnT > 0 ? 999 : d;
      const p = T.point(s, d, this.v);
      tr.g.position.copy(p);
      tr.g.rotation.y = this.yawAlong(s, tr.dir < 0);
      // pitch with grade
      tr.g.rotation.x = 0;
      tr.obj.update?.(dt, raceTime, { speed: tr.v });
      // honk at an approaching player
      if (A && playerS != null && tr.honk <= 0) {
        const gap = (s - playerS) * (tr.dir < 0 ? 1 : -1);
        if (gap > 0 && gap < 70 && tr.dir < 0) { A.sfx(tr.kind === 'bus' ? 'busHorn' : tr.kind === 'truck' ? 'truckHorn' : tr.kind === 'auto' ? 'autoHorn' : 'horn', { pos: tr.g.position, volume: 1.1 }); tr.honk = 9; }
      }
      tr.honk -= dt;
    }
  }

  update(dt, time, camPos, raceTime, playerS, A) {
    this.updateTraffic(raceTime, dt, playerS, A);
    for (const st of this.special.stops || this.special.maggi || []) if (st.marker.group.visible) st.marker.update(dt, time, camPos);
    this.cullT -= dt;
    if (this.cullT <= 0) { this.cullT = 0.3; for (const c of this.cull) { const v = c.o.position.distanceToSquared(camPos) < c.r * c.r; if (c.o.visible !== v) c.o.visible = v; } }
    for (const a of this.animated) {
      const d2 = a.pos.distanceToSquared(camPos);
      if (d2 < a.near * a.near) a.obj.update(dt, time, {});
    }
    // elephant / tiger crossings
    for (const c of this.crossers || []) {
      if (c.state === 'wait' && playerS != null && playerS > c.s - c.trigger && playerS < c.s) {
        c.state = 'cross'; A?.sfx?.(c.sound, { pos: c.obj.group.position, volume: 1.3 }); this.onCrossing?.(c);
      }
      if (c.state === 'cross') {
        c.d += c.dir * c.speed * dt;
        const end = this.T.halfWidth(c.s) + 4;
        if (c.d * c.dir > end) { c.state = 'done'; c.ob.d = 999; c.obj.setPose?.('stand'); }
        else { c.ob.d = c.d; c.ob.s = c.s; }
        const p = this.T.point(c.s, c.d, this.v); c.obj.group.position.copy(p);
      }
    }
    // snake crossing
    const sn = this.special.snake;
    if (sn && sn.moving && sn.obj) {
      sn.d += dt * (sn.obj.speed || 0.9);
      if (sn.d < this.T.halfWidth(sn.s) + 3) { const p = this.T.point(sn.s, sn.d, this.v); sn.obj.group.position.copy(p); }
    }
  }

  resetCrossers() {
    for (const c of this.crossers || []) {
      c.state = 'wait'; c.d = c.d0; c.ob.d = 999; c.obj.setPose?.('walk');
      const p = this.T.point(c.s, c.d, this.v); c.obj.group.position.copy(p);
    }
  }

  /** ambience levels for the audio system at a world position near track s */
  ambience(s, pos) {
    const T = this.T; const z = T.zoneAt(s).id;
    const edge = (id) => { const zs = T.zoneSpans.find(q => q.id === id); if (!zs) return 0; return smoothstep(zs.s0 - 80, zs.s0 + 40, s) * (1 - smoothstep(zs.s1 - 40, zs.s1 + 80, s)); };
    let river = 0; const rq = this.rivers.query(pos.x, pos.z); if (rq) river = clamp(1 - (rq.dist - rq.w) / 70, 0, 1) * (rq.line === this.rivers.main ? 1 : 0.6);
    const wf = this.rivers.waterfall; const wfd = wf ? wf.base.distanceTo(pos) : 1e9;
    const g = this.special.garjiya; const gd = g ? Math.hypot(g.x - pos.x, g.z - pos.z) : 1e9;
    const fin = T.marks.finish;
    return {
      town: edge('town'), forest: edge('forest') * 1 + edge('river') * 0.45, river, mountain: edge('mountain') + edge('ridge') * 0.7,
      waterfall: clamp(1 - wfd / 110, 0, 1), crowd: clamp(1 - Math.abs(s - fin) / 120, 0, 1), temple: clamp(1 - gd / 160, 0, 1),
      insects: edge('forest') * 0.9 + edge('river') * 0.4 + (z === 'town' ? 0.1 : 0),
    };
  }
}

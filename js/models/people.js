// Indian / Kumaoni townspeople & villagers for the Ramnagar → Ranikhet road (bus stand, dhabas, villages, finish crowd).
//
// Each person = ONE SkinnedMesh (1 draw call) using ONE shared vertex-coloured material for everybody.
// Outfits are chosen from the seed: shirt+trousers, kurta-pyjama (+ Pahadi topi + sadri waistcoat), sweater/shawl,
// t-shirt+jeans, saree (+pallu, cardigan), salwar-kameez + dupatta, school uniforms; old people get a stick / shawl.
// Poses: 'stand' (idle variants), 'sit' (seat surface at y = 0.45, seat centre ≈ (0, 0.45, -0.12) in local space),
// 'wave', 'cheer', 'walk' (game moves the group along +Z at api.walkSpeed), 'squat'.
// `static: true` returns a single plain Mesh with the pose baked in (no animation) for far background crowds —
// all statics share the same material, so they can be merged further with util.bakeGroup.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, makeRng } from '../core/util.js';
import { RigKit, Animator, ellipsoid, loft, tube, limb, instantiate } from './animals.js';

let PEOPLE_MAT = null;
/** the one material shared by all people (vertex colours) */
export function getPeopleMaterial() {
  if (!PEOPLE_MAT) PEOPLE_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.0 });
  return PEOPLE_MAT;
}

// ------------------------------------------------------------------ palettes (sRGB hex)
const SKIN = [0xc69072, 0xb98063, 0xab7458, 0x9a674b, 0x8c5c42, 0x7d5039, 0x6d4531, 0x5f3b2a];
const HAIR = { black: 0x15110f, brown: 0x2b1f17, grey: 0x8a8884, white: 0xd8d6d0, henna: 0x5a2a1a };
const SHIRT = [0xf0efe8, 0x9cc3e6, 0x6fa8dc, 0xe8dcc0, 0xa0a4a8, 0xc96a5a, 0x5a7fa8, 0x7a7a52, 0x7a2a30, 0x2a3a5a, 0xc9a03a, 0xdba3b3, 0x4f8a6a];
const TROUSER = [0x3a3c40, 0x232325, 0xb0a07a, 0x2a3248, 0x5a4634, 0x6a6a6a, 0x3b5a88, 0x52709a];
const KURTA = [0xf2f0e8, 0xeadfc8, 0xbcd4ea, 0xefe2a0, 0xc8dcb8, 0xe0e4ea, 0xe8a040];
const PYJAMA = [0xecebe4, 0xe6dccb, 0xdcdcd6];
const VEST = [0x222222, 0x5a3e2a, 0x5a5a5a, 0x2a3048, 0x5a2028, 0x3a4a3a];
const SWEATER = [0x6a2028, 0x24304a, 0x6a6a6a, 0x2a4a32, 0x6a4a32, 0xb08a2a, 0x3a3a3a];
const SAREE = [0xb0202a, 0xe06a1a, 0x2a8a3a, 0xd84a8a, 0xe8c030, 0x6a2a8a, 0x2a4aa8, 0x7a1a2a, 0xb02a7a, 0x1a8a8a];
const KAMEEZ = [0xe89aa8, 0xf0b890, 0x9ac8e8, 0xb8a8d8, 0xa8dcc0, 0xf0d870, 0xf2eee6, 0xd84a6a, 0x4a6ab0];
const SALWAR = [0xf2f0ea, 0x222222, 0xe8dcc8, 0x3a3a5a];
const SHAWL = [0x6a4a32, 0x7a7670, 0x6a2a30, 0xd8ccb0, 0x2a2a2a, 0x4a3a5a];
const TOPI = [0x1a1a1a, 0x1a1a1a, 0x1a1a1a, 0xece8e0, 0xece8e0, 0x6a6a6a];
const TSHIRT = [0xd8302a, 0x2a6ad8, 0xf0c020, 0x2a2a2a, 0xf0f0f0, 0x2aa060, 0xe06aa0, 0x8a2ad0, 0x20a0c0];

const C = (h) => new THREE.Color(h);

/** decide a full appearance from seed/options */
function makeLook(seed, opts) {
  const r = makeRng(seed * 9973 + 101);
  const age = opts.age || r.pick(['adult', 'adult', 'adult', 'adult', 'old', 'kid']);
  const gender = opts.gender || (r() < 0.55 ? 'm' : 'f');
  const L = { seed, age, gender };
  L.skin = r.pick(SKIN);
  L.H = age === 'kid' ? r.range(1.08, 1.32) : gender === 'm' ? (age === 'old' ? r.range(1.58, 1.7) : r.range(1.62, 1.8)) : (age === 'old' ? r.range(1.46, 1.56) : r.range(1.5, 1.64));
  L.girth = age === 'kid' ? 0.9 : r.range(0.92, 1.12) * (age === 'old' ? 1.02 : 1);
  L.belly = gender === 'm' && age !== 'kid' && r() < 0.3 ? r.range(0.01, 0.035) : 0;
  L.hairColor = age === 'old' ? r.pick([HAIR.grey, HAIR.white, HAIR.grey, gender === 'f' ? HAIR.henna : HAIR.white]) : (r() < 0.85 ? HAIR.black : HAIR.brown);
  L.hairStyle = gender === 'f' ? (age === 'kid' ? r.pick(['braid', 'bob']) : r.pick(['bun', 'braid', 'bun'])) : (age === 'old' && r() < 0.45 ? 'bald' : 'short');
  L.mustache = gender === 'm' && age !== 'kid' && r() < (age === 'old' ? 0.75 : 0.55);
  L.beard = gender === 'm' && age !== 'kid' && r() < (age === 'old' ? 0.3 : 0.15);
  L.bindi = gender === 'f' && age !== 'kid' && r() < 0.6;
  L.shoes = r.pick(['black', 'brown', 'sandal', 'sandal', 'sport']);
  // outfit
  if (age === 'kid') {
    L.outfit = r() < 0.5 ? 'school' : (gender === 'f' && r() < 0.5 ? 'frock' : 'tshirt');
  } else if (gender === 'm') {
    L.outfit = age === 'old' ? r.pick(['kurta', 'kurta', 'kurta', 'sweater', 'shirt']) : r.pick(['shirt', 'shirt', 'kurta', 'sweater', 'tshirt', 'tshirt']);
  } else {
    L.outfit = age === 'old' ? r.pick(['saree', 'saree', 'salwar']) : r.pick(['saree', 'saree', 'salwar', 'salwar']);
  }
  L.top = r.pick(SHIRT); L.bottom = r.pick(TROUSER);
  if (L.outfit === 'kurta') { L.top = r.pick(KURTA); L.bottom = r.pick(PYJAMA); L.vest = r() < (age === 'old' ? 0.8 : 0.5) ? r.pick(VEST) : null; L.topi = r() < (age === 'old' ? 0.75 : 0.45) ? r.pick(TOPI) : null; }
  if (L.outfit === 'sweater') { L.top = r.pick(SWEATER); L.collar = r.pick([0xf0efe8, 0x9cc3e6, 0xe8dcc0]); L.topi = age === 'old' && r() < 0.5 ? r.pick(TOPI) : null; L.beanie = !L.topi && r() < 0.25 ? r.pick(SWEATER) : null; }
  if (L.outfit === 'tshirt') { L.top = r.pick(TSHIRT); L.bottom = age === 'kid' ? r.pick([0x2a3248, 0x3a3c40, 0x52709a, 0x6a5a40]) : r.pick([0x3b5a88, 0x52709a, 0x2a3248, 0x232325]); L.shorts = age === 'kid' && r() < 0.6; }
  if (L.outfit === 'school') { L.top = 0xf2f2ee; L.bottom = r.pick([0x2a3248, 0x5a5a62, 0x2a4a6a]); L.shorts = gender === 'm' && r() < 0.6; L.skirt = gender === 'f'; L.tie = r() < 0.6 ? r.pick([0xa02030, 0x2a3a7a]) : null; }
  if (L.outfit === 'frock') { L.top = r.pick(KAMEEZ); L.skirt = true; L.bottom = L.top; }
  if (L.outfit === 'saree') { L.saree = r.pick(SAREE); L.border = r.pick([0xc8a040, 0xd8b850, 0x2a2a2a, 0xf0e8d0]); L.top = r() < 0.5 ? L.saree : r.pick(SAREE); L.cardigan = r() < 0.35 ? r.pick([0x6a2028, 0x2a2a2a, 0x24304a, 0x6a6a6a]) : null; L.headscarf = age === 'old' && r() < 0.4 ? r.pick([0xe8e0d0, L.saree]) : null; }
  if (L.outfit === 'salwar') { L.top = r.pick(KAMEEZ); L.bottom = r.pick(SALWAR); L.dupatta = r.pick(SAREE.concat(KAMEEZ)); L.cardigan = r() < 0.25 ? r.pick([0x6a2028, 0x2a2a2a, 0x24304a]) : null; }
  L.shawl = age === 'old' && !L.cardigan && r() < 0.45 ? r.pick(SHAWL) : null;
  L.stick = age === 'old' && gender === 'm' && r() < 0.55;
  L.bag = age !== 'kid' && !L.stick && r() < 0.18 ? r.pick([0xd8c8a0, 0x8a5a3a, 0x3a5a7a]) : (age === 'kid' && L.outfit === 'school' && r() < 0.7 ? r.pick([0x2a4aa8, 0xa02a3a, 0x2a2a2a]) : null);
  L.schoolBag = age === 'kid' && !!L.bag;
  L.phone = age === 'adult' && r() < 0.25;
  L.cup = r() < 0.5; // only shown when the person is created sitting
  L.armStyle = L.stick ? 'stick' : (L.phone ? 'phone' : r.pick(['down', 'down', 'behind', 'crossed', 'hips']));
  if (age === 'kid' && L.armStyle !== 'phone') L.armStyle = r.pick(['down', 'down', 'hips']);
  return L;
}

// ------------------------------------------------------------------ geometry
function buildPerson(L) {
  const hs = L.age === 'kid' ? 0.93 : (L.gender === 'f' ? 0.96 : 1.0);    // head scale
  const headH = 0.19 * hs;
  const sy = (L.H - headH) / 1.5;                                          // body vertical scale (neck top at 1.5 for base)
  const wf = (L.gender === 'f' ? 0.92 : 1.0) * (L.age === 'kid' ? 0.86 : 1.0); // width factor
  const hipW = L.gender === 'f' ? 1.1 : 1.0;
  const g = L.girth;
  const sx = sy * 0.35 + 0.65;                                             // widths scale less than height
  const X = (v) => v * wf * sx * g, Y = (v) => v * sy, Z = (v) => v * wf * sx * g;
  const neckTop = Y(1.5);
  const hc = neckTop + 0.085 * hs;                                         // head centre
  const H = (v) => v * hs;

  const K = new RigKit();
  K.bone('root', null, 0, 0, 0)
    .bone('hips', 'root', 0, Y(0.93), 0)
    .bone('spine', 'hips', 0, Y(1.08), 0)
    .bone('chest', 'spine', 0, Y(1.26), 0)
    .bone('neck', 'chest', 0, Y(1.43), 0)
    .bone('head', 'neck', 0, neckTop, Z(0.005))
    .bone('uArmL', 'chest', X(0.185), Y(1.39), 0).bone('fArmL', 'uArmL', X(0.205), Y(1.12), Z(-0.005)).bone('handL', 'fArmL', X(0.215), Y(0.885), Z(0.01))
    .bone('uArmR', 'chest', -X(0.185), Y(1.39), 0).bone('fArmR', 'uArmR', -X(0.205), Y(1.12), Z(-0.005)).bone('handR', 'fArmR', -X(0.215), Y(0.885), Z(0.01))
    .bone('uLegL', 'hips', X(0.09) * hipW, Y(0.9), 0).bone('lLegL', 'uLegL', X(0.095), Y(0.48), Z(0.005)).bone('footL', 'lLegL', X(0.095), Y(0.085), Z(-0.01))
    .bone('uLegR', 'hips', -X(0.09) * hipW, Y(0.9), 0).bone('lLegR', 'uLegR', -X(0.095), Y(0.48), Z(0.005)).bone('footR', 'lLegR', -X(0.095), Y(0.085), Z(-0.01));

  const skin = C(L.skin), hair = C(L.hairColor), top = C(L.top), bottom = C(L.bottom);
  const lips = skin.clone().multiplyScalar(0.72).lerp(C(0x7a3a34), 0.25);
  const torsoBind = (p) => {
    const y = p.y;
    if (y < Y(0.99)) { const t = smoothstep(Y(0.95), Y(0.99), y); return [['hips', 1 - t], ['spine', t]]; }
    if (y < Y(1.2)) { const t = smoothstep(Y(1.14), Y(1.2), y); return [['spine', 1 - t], ['chest', t]]; }
    return [['chest', 1]];
  };
  const vestCol = L.vest ? C(L.vest) : null, cardi = L.cardigan ? C(L.cardigan) : null;
  // ---- torso colour (shirt / kurta / vest / sweater / blouse / kameez)
  const torsoCol = (p, n) => {
    const y = p.y;
    let c = top.clone();
    if (L.outfit === 'saree') {
      c = y > Y(1.12) ? top.clone() : (y > Y(1.04) ? skin.clone() : C(L.saree)); // blouse, midriff, saree
      if (cardi && y > Y(1.0)) c = cardi.clone();
    } else if (L.outfit === 'school' || L.outfit === 'shirt') {
      if (y < Y(1.0)) c = bottom.clone();
      if (Math.abs(p.x) < 0.006 && n.z > 0.5 && y > Y(1.0)) c.multiplyScalar(0.85); // button placket
      if (L.tie && Math.abs(p.x) < X(0.018) && n.z > 0.6 && y > Y(1.12) && y < Y(1.4)) c = C(L.tie);
    } else if (L.outfit === 'tshirt' || L.outfit === 'frock') {
      if (y < Y(0.98) && L.outfit === 'tshirt') c = bottom.clone();
    } else if (L.outfit === 'sweater') {
      if (y < Y(0.99)) c = bottom.clone();
      const v = (Y(1.43) - y) * 0.55; if (n.z > 0.4 && Math.abs(p.x) < v && y > Y(1.28)) c = C(L.collar); // V-neck shows shirt
      if (y < Y(1.03) && y > Y(0.99)) c.multiplyScalar(0.8); // ribbed hem
    }
    if (vestCol && y > Y(0.99)) {
      const v = (Y(1.44) - y) * 0.42;
      if (!(n.z > 0.35 && Math.abs(p.x) < v)) c = vestCol.clone();
    }
    if (cardi && L.outfit === 'salwar' && y > Y(1.0)) { const v = (Y(1.44) - y) * 0.3; if (!(n.z > 0.4 && Math.abs(p.x) < v)) c = cardi.clone(); }
    c.multiplyScalar(0.9 + 0.1 * smoothstep(Y(0.95), Y(1.35), y));
    return c;
  };
  // torso
  const bust = L.gender === 'f' && L.age !== 'kid' ? 0.014 : 0;
  K.add(loft([
    { p: [0, Y(0.92), 0], w: X(0.15) * hipW, h: Z(0.105) },
    { p: [0, Y(0.988), 0], w: X(0.145) * (L.gender === 'f' ? 1.02 : 1), h: Z(0.101) + L.belly * 0.8 },
    { p: [0, Y(1.003), 0], w: X(0.143) * (L.gender === 'f' ? 0.97 : 1), h: Z(0.1) + L.belly },
    { p: [0, Y(1.03), 0], w: X(0.142) * (L.gender === 'f' ? 0.94 : 1), h: Z(0.1) + L.belly },
    { p: [0, Y(1.11), L.belly * 0.6], w: X(0.148), h: Z(0.105) + L.belly },
    { p: [0, Y(1.23), 0], w: X(0.163), h: Z(0.11) + bust },
    { p: [0, Y(1.33), 0], w: X(0.172), h: Z(0.106) + bust * 0.5 },
    { p: [0, Y(1.405), 0], w: X(0.152), h: Z(0.09) },
    { p: [0, Y(1.45), 0], w: X(0.065), h: Z(0.055) },
  ], { seg: 10, ref: [0, 0, 1] }), torsoCol, torsoBind);
  // pelvis
  K.add(ellipsoid(0, Y(0.905), 0, X(0.148) * hipW, Y(0.075), Z(0.103), 7, 4), L.outfit === 'saree' ? C(L.saree) : bottom.clone(), 'hips');
  // shoulders
  for (const s of [1, -1]) K.add(ellipsoid(s * X(0.163), Y(1.383), 0, X(0.052), Y(0.048), Z(0.052), 6, 4), cardi ? cardi : top, 'chest');
  // neck
  K.add(limb([0, Y(1.4), 0], [0, neckTop + 0.02, Z(0.008)], 0.047 * g * wf, 0.044 * wf, 6, 1.0, true), (p) => {
    if ((L.outfit === 'shirt' || L.outfit === 'school') && p.y < Y(1.455)) return top.clone().multiplyScalar(0.95); // collar
    return skin.clone();
  }, (p) => { const t = smoothstep(Y(1.43), neckTop, p.y); return [['chest', 1 - t], ['head', t]]; });

  // ---- head
  K.add(ellipsoid(0, hc + H(0.008), -H(0.005), H(0.078), H(0.098), H(0.096), 9, 6), skin, 'head');
  K.add(ellipsoid(0, hc - H(0.045), H(0.022), H(0.064), H(0.062), H(0.07), 7, 4), skin, 'head');
  K.add(ellipsoid(0, hc - H(0.015), H(0.09), 0.012 * hs, 0.02 * hs, 0.016 * hs, 5, 3), skin.clone().multiplyScalar(0.92), 'head');
  for (const s of [1, -1]) {
    K.add(ellipsoid(s * H(0.077), hc - H(0.005), 0, 0.012 * hs, 0.027 * hs, 0.018 * hs, 5, 3), skin.clone().multiplyScalar(0.94), 'head');
    K.add(ellipsoid(s * H(0.03), hc + H(0.008), H(0.082), 0.011 * hs, 0.0072 * hs, 0.006 * hs, 5, 3), 0x16100d, 'head');
    K.add(ellipsoid(s * H(0.031), hc + H(0.027), H(0.085), 0.018 * hs, 0.0045 * hs, 0.006 * hs, 4, 3), hair.clone().multiplyScalar(L.age === 'old' ? 0.8 : 1), 'head');
  }
  K.add(ellipsoid(0, hc - H(0.05), H(0.083), 0.019 * hs, 0.005 * hs, 0.006 * hs, 4, 3), lips, 'head');
  if (L.mustache) K.add(ellipsoid(0, hc - H(0.035), H(0.088), 0.025 * hs, 0.0065 * hs, 0.008 * hs, 4, 3), hair, 'head');
  if (L.beard) K.add(ellipsoid(0, hc - H(0.066), H(0.04), H(0.061), H(0.042), H(0.06), 7, 4), (p, n) => n.z > -0.2 ? hair.clone().lerp(skin, 0.15) : skin.clone(), 'head');
  if (L.bindi) K.add(ellipsoid(0, hc + H(0.036), H(0.093), 0.005, 0.005, 0.003, 4, 3), 0xc0101a, 'head');
  // hair
  const cap = (tilt, cover, sc = 1) => {
    const gg = new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI * cover);
    for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal') gg.deleteAttribute(k);
    gg.scale(H(0.084) * sc, H(0.104) * sc, H(0.101) * sc);
    gg.applyMatrix4(new THREE.Matrix4().makeRotationX(tilt));
    gg.translate(0, hc + H(0.012), -H(0.008));
    return gg;
  };
  if (L.headscarf) {
    K.add(cap(-0.15, 0.62, 1.12), C(L.headscarf), 'head');
  } else if (L.hairStyle === 'bald') {
    K.add(cap(-1.2, 0.42, 1.0), hair, 'head');
  } else {
    K.add(cap(L.gender === 'f' ? -0.28 : -0.38, 0.56, 1.0), hair, 'head');
    if (L.hairStyle === 'bun') K.add(ellipsoid(0, hc - H(0.01), -H(0.1), H(0.045), H(0.04), H(0.04), 6, 4), hair, 'head');
    if (L.hairStyle === 'braid') K.add(tube([[0, hc - H(0.03), -H(0.09)], [0, hc - H(0.15), -H(0.115)], [0, hc - H(0.32), -H(0.12)], [0, hc - H(0.42), -H(0.115)]], [0.026 * hs, 0.022 * hs, 0.017 * hs, 0.01 * hs], { seg: 5 }),
      hair, (p) => { const t = smoothstep(hc - H(0.08), hc - H(0.2), p.y); return [['head', 1 - t], ['chest', t]]; });
    if (L.hairStyle === 'bob') K.add(ellipsoid(0, hc - H(0.03), -H(0.03), H(0.088), H(0.07), H(0.09), 8, 4), hair, 'head');
  }
  if (L.topi) { // Pahadi (Kumaoni) boat cap
    K.add(ellipsoid(0, hc + H(0.082), -H(0.008), H(0.074), H(0.034), H(0.102), 8, 4), C(L.topi), 'head');
    K.add(ellipsoid(0, hc + H(0.104), -H(0.008), H(0.012), H(0.014), H(0.095), 4, 3), C(L.topi).multiplyScalar(0.85), 'head');
  }
  if (L.beanie) K.add(cap(-0.2, 0.55, 1.08), C(L.beanie), 'head');

  // ---- arms
  const longSleeve = ['kurta', 'sweater', 'shirt', 'school'].includes(L.outfit) || !!L.cardigan || (L.outfit === 'salwar' && L.seed % 2 === 0);
  const armTop = cardi ? cardi : top;
  for (const [s, u, f, h] of [[1, 'uArmL', 'fArmL', 'handL'], [-1, 'uArmR', 'fArmR', 'handR']]) {
    K.add(limb([s * X(0.185), Y(1.39), 0], [s * X(0.205), Y(1.12), Z(-0.005)], 0.046 * g * wf, 0.039 * g * wf, 6, 1.0, true), (p) => {
      if (L.outfit === 'saree' && !cardi) return p.y > Y(1.3) ? top.clone() : skin.clone();
      if (!longSleeve) return p.y > Y(1.24) ? armTop.clone() : skin.clone();
      return armTop.clone();
    }, u);
    K.add(limb([s * X(0.205), Y(1.12), Z(-0.005)], [s * X(0.215), Y(0.885), Z(0.01)], 0.038 * g * wf, 0.03 * wf, 6, 1.0, true), (p) => {
      if (longSleeve) return p.y > Y(0.91) ? armTop.clone() : skin.clone();
      return skin.clone();
    }, f);
    K.add(ellipsoid(s * X(0.218), Y(0.82), Z(0.012), 0.024 * wf, 0.055 * sy, 0.037 * wf, 6, 4), skin, h);
  }
  // ---- legs
  const legCol = (p) => {
    if (L.shorts && p.y < Y(0.58)) return skin.clone();
    if (L.skirt && p.y < Y(0.62)) return skin.clone();
    const c = bottom.clone(); c.multiplyScalar(0.88 + 0.12 * smoothstep(Y(0.1), Y(0.8), p.y)); return c;
  };
  const shoeCol = (p) => {
    if (L.shoes === 'sandal') return p.y < 0.022 ? C(0x3a2a20) : skin.clone();
    if (L.shoes === 'sport') return p.y < 0.02 ? C(0xe8e8e4) : C(0x8a8e94);
    return L.shoes === 'black' ? C(0x18181a) : C(0x4a3020);
  };
  for (const [s, u, l, f] of [[1, 'uLegL', 'lLegL', 'footL'], [-1, 'uLegR', 'lLegR', 'footR']]) {
    K.add(limb([s * X(0.09) * hipW, Y(0.9), 0], [s * X(0.095), Y(0.48), Z(0.005)], 0.076 * g * wf, 0.054 * g * wf, 6, 1.0, true), legCol, u);
    K.add(limb([s * X(0.095), Y(0.48), Z(0.005)], [s * X(0.095), Y(0.09), Z(-0.01)], 0.052 * g * wf, 0.035 * wf, 6, 1.04, true), legCol, l);
    K.add(ellipsoid(s * X(0.095), 0.04, Z(0.045), 0.044 * wf, 0.036, 0.112 * Math.min(1, sy * 1.05), 6, 4), shoeCol, f);
  }
  // ---- garments
  const skirtBind = (lenFac) => (p) => {
    const f = smoothstep(Y(0.98), Y(0.98) - lenFac, p.y) * 0.55;
    const side = smoothstep(-0.04, 0.04, p.x);
    return [['hips', 1 - f], ['uLegL', f * side], ['uLegR', f * (1 - side)]];
  };
  if (L.outfit === 'kurta' || L.outfit === 'salwar' || L.outfit === 'frock' || (L.skirt && L.outfit === 'school')) {
    const hem = L.outfit === 'kurta' ? Y(0.56) : L.outfit === 'salwar' ? Y(0.5) : Y(0.62);
    const flare = L.outfit === 'frock' ? 1.25 : (L.skirt ? 1.15 : 1.0);
    const st = [
      { p: [0, Y(1.0), 0], w: X(0.156) * hipW, h: Z(0.113) + L.belly },
      { p: [0, lerp(Y(1.0), hem, 0.33), 0], w: X(0.168) * hipW * flare, h: Z(0.124) * flare + L.belly * 0.5 },
      { p: [0, lerp(Y(1.0), hem, 0.7), 0], w: X(0.177) * hipW * flare, h: Z(0.132) * flare },
      { p: [0, hem, 0], w: X(0.182) * hipW * flare, h: Z(0.137) * flare },
    ];
    const kc = L.outfit === 'school' ? bottom : top;
    K.add(loft(st, { seg: 10, ref: [0, 0, 1] }), (p) => {
      const c = kc.clone(); if (p.y < hem + 0.02) c.multiplyScalar(0.9); return c;
    }, skirtBind(Y(1.0) - hem));
  }
  if (L.outfit === 'saree') {
    const sc = C(L.saree), bc = C(L.border);
    K.add(loft([
      { p: [0, Y(1.05), 0], w: X(0.16) * hipW, h: Z(0.118) },
      { p: [0, Y(0.8), 0], w: X(0.19) * hipW, h: Z(0.14) },
      { p: [0, Y(0.45), 0], w: X(0.205) * hipW, h: Z(0.155) },
      { p: [0, 0.165, 0], w: X(0.213) * hipW, h: Z(0.163) },
      { p: [0, 0.15, 0], w: X(0.214) * hipW, h: Z(0.164) },
      { p: [0, 0.035, 0], w: X(0.22) * hipW, h: Z(0.17) },
    ], { seg: 10, ref: [0, 0, 1] }), (p, n) => {
      if (p.y < 0.158) return bc.clone(); // border at the hem
      const pleat = n.z > 0.6 && Math.abs(p.x) < X(0.05) ? 0.88 : 1; // front pleats
      return sc.clone().multiplyScalar(pleat);
    }, skirtBind(Y(1.0) * 0.9));
    // pallu: across the chest to the left shoulder and down the back
    const pts = [[-X(0.13), Y(0.98), Z(0.115)], [-X(0.04), Y(1.13), Z(0.128)], [X(0.07), Y(1.3), Z(0.118)], [X(0.15), Y(1.415), Z(0.04)], [X(0.15), Y(1.4), -Z(0.07)], [X(0.12), Y(1.2), -Z(0.122)], [X(0.1), Y(0.95), -Z(0.13)], [X(0.09), Y(0.75), -Z(0.13)]];
    if (!cardi) K.add(loft(pts.map(p => ({ p, w: 0.075 * wf, h: 0.007 })), { seg: 6, pt: true }), (p) => (p.z < -Z(0.1) && p.y < Y(0.85)) ? bc.clone() : sc.clone(), (p) => {
      const t = smoothstep(Y(1.1), Y(1.25), p.y); return [['spine', 1 - t], ['chest', t]];
    });
  }
  if (L.dupatta && !cardi) {
    const dc = C(L.dupatta);
    const pts = [[X(0.12), Y(1.02), -Z(0.118)], [X(0.135), Y(1.28), -Z(0.105)], [X(0.12), Y(1.42), -Z(0.03)], [X(0.095), Y(1.4), Z(0.07)], [X(0.06), Y(1.31), Z(0.122)], [0, Y(1.27), Z(0.13)], [-X(0.06), Y(1.31), Z(0.122)], [-X(0.095), Y(1.4), Z(0.07)], [-X(0.12), Y(1.42), -Z(0.03)], [-X(0.135), Y(1.28), -Z(0.105)], [-X(0.12), Y(1.02), -Z(0.118)]];
    K.add(loft(pts.map(p => ({ p, w: 0.05 * wf, h: 0.005 })), { seg: 6, pt: true }), dc, 'chest');
  }
  if (L.shawl) {
    K.add(loft([
      { p: [0, Y(1.48), 0], w: X(0.08), h: Z(0.065) },
      { p: [0, Y(1.43), 0], w: X(0.2), h: Z(0.13) },
      { p: [0, Y(1.33), 0], w: X(0.235), h: Z(0.152) },
      { p: [0, Y(1.18), 0], w: X(0.24), h: Z(0.156) },
      { p: [0, Y(1.1), 0], w: X(0.236), h: Z(0.152) },
    ], { seg: 10, ref: [0, 0, 1] }), (p) => { const c = C(L.shawl); if (p.y < Y(1.14)) c.multiplyScalar(0.82); return c; }, 'chest');
  }
  if (L.bag) {
    if (L.schoolBag) {
      K.add(ellipsoid(0, Y(1.2), -Z(0.17), X(0.13), Y(0.15), Z(0.07), 6, 4), C(L.bag), 'chest');
    } else {
      K.add(loft([{ p: [X(0.16), Y(1.43), 0], w: 0.022, h: 0.004 }, { p: [X(0.05), Y(1.3), Z(0.115)], w: 0.022, h: 0.004 }, { p: [-X(0.1), Y(1.1), Z(0.12)], w: 0.022, h: 0.004 }, { p: [-X(0.18), Y(0.98), Z(0.05)], w: 0.022, h: 0.004 }], { seg: 4, pt: true }), C(L.bag).multiplyScalar(0.8), 'chest');
      K.add(ellipsoid(-X(0.2), Y(0.9), Z(0.03), X(0.04), Y(0.11), Z(0.12), 6, 4), C(L.bag), 'hips');
    }
  }
  if (L.stick) K.add(tube([[-X(0.218), Y(0.84), Z(0.02)], [-X(0.23), Y(0.42), Z(0.06)], [-X(0.24), 0.0, Z(0.1)]], [0.012, 0.011, 0.01], { seg: 5 }), 0x5a3a22, 'handR');
  if (L.phone) K.add(ellipsoid(-X(0.218), Y(0.79), Z(0.04), 0.008, 0.04, 0.035, 4, 3), 0x111214, 'handR');
  if (L.cup && L.sitting) K.add(loft([{ p: [-X(0.22), Y(0.78), Z(0.055)], r: 0.022 }, { p: [-X(0.22), Y(0.83), Z(0.055)], r: 0.027 }], { seg: 6 }), 0xf0ece0, 'handR');
  return { tpl: K.build(), dims: { sy, hipY: Y(0.93), hs } };
}

// ------------------------------------------------------------------ poses
const wander = (t, o) => Math.sin(t * 0.31 + o) * 0.6 + Math.sin(t * 0.73 + o * 2.1) * 0.3 + Math.sin(t * 1.37 + o * 3.7) * 0.1;

function armStyle(T, style, t, o) {
  switch (style) {
    case 'behind':
      T['uArmL.rx'] = 0.38; T['uArmR.rx'] = 0.38; T['uArmL.ry'] = -1.45; T['uArmR.ry'] = 1.45; T['uArmL.rz'] = 0.12; T['uArmR.rz'] = -0.12;
      T['fArmL.rx'] = -1.35; T['fArmR.rx'] = -1.35; break;
    case 'crossed':
      T['uArmL.rx'] = -0.3; T['uArmR.rx'] = -0.28; T['uArmL.ry'] = -0.95; T['uArmR.ry'] = 0.95; T['uArmL.rz'] = 0.12; T['uArmR.rz'] = -0.12;
      T['fArmL.rx'] = -1.78; T['fArmR.rx'] = -1.62; break;
    case 'hips':
      T['uArmL.rz'] = 0.62; T['uArmR.rz'] = -0.62; T['uArmL.ry'] = -0.35; T['uArmR.ry'] = 0.35; T['uArmL.rx'] = 0.1; T['uArmR.rx'] = 0.1;
      T['fArmL.rx'] = -1.5; T['fArmR.rx'] = -1.5; T['fArmL.ry'] = -0.6; T['fArmR.ry'] = 0.6; break;
    case 'phone':
      T['uArmR.rx'] = -0.32; T['uArmR.rz'] = 0.12; T['fArmR.rx'] = -1.7; T['fArmR.ry'] = 0.35; T['handR.rx'] = -0.3;
      T['uArmL.rz'] = 0.04; T['fArmL.rx'] = -0.15; T['neck.rx'] += 0.12; T['head.rx'] += 0.38; break;
    case 'stick':
      T['uArmR.rx'] = -0.28; T['uArmR.rz'] = -0.05; T['fArmR.rx'] = -0.32; T['handR.rx'] = 0.25;
      T['uArmL.rz'] = 0.05; T['fArmL.rx'] = -0.2; T['spine.rx'] += 0.12; T['neck.rx'] -= 0.05; break;
    default:
      T['uArmL.rz'] = 0.04 + Math.sin(t * 0.5 + o) * 0.01; T['uArmR.rz'] = -0.04 - Math.sin(t * 0.5 + o) * 0.01;
      T['fArmL.rx'] = -0.12; T['fArmR.rx'] = -0.14;
  }
}

function personPose(T, pose, t, o, L, d) {
  const old = L.age === 'old';
  if (old) { T['spine.rx'] = 0.14; T['chest.rx'] = 0.08; T['neck.rx'] = -0.08; T['head.rx'] = -0.06; }
  T['chest.rx'] = (T['chest.rx'] || 0) + Math.sin(t * 1.5 + o.a) * 0.012; // breathing
  if (pose === 'walk') {
    const stride = (L.age === 'kid' ? 0.9 : 1.25) * d.sy * (old ? 0.75 : 1);
    const ph = (t * d.walkSpeed / stride) * Math.PI * 2 + o.a;
    const s = Math.sin(ph), c = Math.cos(ph);
    const amp = L.outfit === 'saree' ? 0.32 : (old ? 0.32 : 0.46);
    T['uLegL.rx'] = -s * amp; T['uLegR.rx'] = s * amp;
    T['lLegL.rx'] = Math.max(0, Math.sin(ph + 1.25)) * amp * 1.7 + 0.05;
    T['lLegR.rx'] = Math.max(0, Math.sin(ph + 1.25 + Math.PI)) * amp * 1.7 + 0.05;
    T['footL.rx'] = s * 0.15 - 0.05; T['footR.rx'] = -s * 0.15 - 0.05;
    T['root.py'] = -Math.abs(c) * 0.025 * d.sy + 0.012;
    T['hips.ry'] = s * 0.07; T['chest.ry'] = -s * 0.1; T['hips.rz'] = c * 0.025;
    const aa = old ? 0.18 : 0.34;
    T['uArmL.rx'] = s * aa; T['uArmR.rx'] = -s * aa; T['uArmL.rz'] = 0.06; T['uArmR.rz'] = -0.06;
    T['fArmL.rx'] = -0.25 - Math.max(0, -s) * 0.25; T['fArmR.rx'] = -0.25 - Math.max(0, s) * 0.25;
    T['head.ry'] = wander(t * 0.5, o.b) * 0.25;
    if (L.stick) { T['uArmR.rx'] = -0.3 - s * 0.15; T['fArmR.rx'] = -0.3; T['handR.rx'] = 0.2; T['spine.rx'] += 0.1; }
    if (L.phone && o.c > 5) { T['uArmR.rx'] = -0.32; T['fArmR.rx'] = -1.7; T['head.rx'] += 0.3; }
    return;
  }
  if (pose === 'sit') {
    T['root.py'] = (0.45 + 0.075 * d.sy) - d.hipY; T['root.pz'] = -0.12;
    T['uLegL.rx'] = -1.52; T['uLegR.rx'] = -1.5; T['lLegL.rx'] = 1.48; T['lLegR.rx'] = 1.5; T['footL.rx'] = 0.04; T['footR.rx'] = 0.02;
    T['uLegL.rz'] = 0.06; T['uLegR.rz'] = -0.06;
    T['spine.rx'] = (T['spine.rx'] || 0) + 0.05;
    T['uArmL.rx'] = -0.42; T['uArmR.rx'] = -0.42; T['fArmL.rx'] = -0.72; T['fArmR.rx'] = -0.72; T['uArmL.rz'] = 0.06; T['uArmR.rz'] = -0.06;
    T['head.ry'] = wander(t, o.b) * 0.55; T['head.rx'] = wander(t * 0.7, o.c) * 0.1;
    if (L.cup && L.sitting) { // sip chai every few seconds
      const k = smoothstep(0.6, 0.85, Math.sin(t * 0.55 + o.a));
      T['uArmR.rx'] = lerp(-0.5, -0.55, k); T['uArmR.rz'] = lerp(-0.06, 0.25, k); T['fArmR.rx'] = lerp(-1.2, -2.3, k); T['fArmR.ry'] = lerp(0.2, 0.5, k);
      T['head.rx'] = lerp(T['head.rx'], -0.12, k); T['head.ry'] *= 1 - k;
    }
    return;
  }
  if (pose === 'squat') {
    T['root.py'] = -(d.hipY - 0.34 * d.sy);
    T['uLegL.rx'] = -2.05; T['uLegR.rx'] = -2.05; T['uLegL.rz'] = 0.2; T['uLegR.rz'] = -0.2;
    T['lLegL.rx'] = 2.45; T['lLegR.rx'] = 2.45; T['footL.rx'] = -0.35; T['footR.rx'] = -0.35;
    T['spine.rx'] = 0.45; T['chest.rx'] += 0.12; T['neck.rx'] = -0.25; T['head.rx'] = -0.2 + wander(t, o.c) * 0.1; T['head.ry'] = wander(t, o.b) * 0.5;
    T['uArmL.rx'] = -0.95; T['uArmR.rx'] = -0.95; T['fArmL.rx'] = -0.4; T['fArmR.rx'] = -0.4; T['uArmL.rz'] = 0.15; T['uArmR.rz'] = -0.15;
    return;
  }
  // standing family: stand / wave / cheer
  const sway = Math.sin(t * 0.35 + o.a);
  T['hips.rz'] = sway * 0.025; T['hips.px'] = sway * 0.012;
  T['uLegL.rz'] = -sway * 0.025 + 0.02; T['uLegR.rz'] = -sway * 0.025 - 0.02;
  T['spine.rz'] = -sway * 0.015;
  T['head.ry'] = (T['head.ry'] || 0) + wander(t, o.b) * 0.6; T['head.rx'] = (T['head.rx'] || 0) + wander(t * 0.6, o.c) * 0.08;
  if (pose === 'wave') {
    const left = o.c > 7;
    const a = left ? 'L' : 'R', sg = left ? 1 : -1;
    armStyle(T, 'down', t, o.a);
    T['uArm' + a + '.rz'] = sg * 2.55; T['uArm' + a + '.rx'] = -0.3; T['uArm' + a + '.ry'] = 0;
    T['fArm' + a + '.rz'] = sg * (0.35 + Math.sin(t * 7.5 + o.a) * 0.42); T['fArm' + a + '.rx'] = -0.2;
    return;
  }
  if (pose === 'cheer') {
    const b = Math.abs(Math.sin(t * 4.6 + o.a));
    T['root.py'] = b * 0.05 * d.sy;
    T['uArmL.rz'] = 2.45 + Math.sin(t * 9.2 + o.a) * 0.18; T['uArmR.rz'] = -2.45 - Math.sin(t * 9.2 + o.a + 1) * 0.18;
    T['uArmL.rx'] = -0.25; T['uArmR.rx'] = -0.25;
    T['fArmL.rz'] = 0.35 + b * 0.35; T['fArmR.rz'] = -0.35 - b * 0.35;
    T['head.rx'] = -0.18; T['head.ry'] *= 0.4;
    T['lLegL.rx'] = b * 0.18; T['lLegR.rx'] = b * 0.18; T['uLegL.rx'] = -b * 0.1; T['uLegR.rx'] = -b * 0.1;
    return;
  }
  armStyle(T, L.armStyle, t, o.a);
}

// ------------------------------------------------------------------ factory
/**
 * createPerson({ seed, gender:'m'|'f', age:'adult'|'old'|'kid', pose:'stand'|'sit'|'wave'|'cheer'|'walk'|'squat', static:false })
 * → { group, update(dt), setPose(p), walkSpeed (m/s, for 'walk'), look, height }
 */
export function createPerson(opts = {}) {
  const seed = opts.seed ?? 1;
  const L = makeLook(seed, opts);
  let pose = opts.pose || 'stand';
  L.sitting = pose === 'sit';
  const { tpl, dims } = buildPerson(L);
  const mat = getPeopleMaterial();
  const inst = instantiate(tpl, mat);
  const anim = new Animator(inst.bones, inst.rest);
  const r = makeRng(seed * 31 + 7);
  const o = { a: r() * 10, b: r() * 10, c: r() * 10 };
  const walkSpeed = (L.age === 'old' ? 0.75 : L.age === 'kid' ? 1.0 : 1.2) * (0.92 + r() * 0.16);
  const d = { ...dims, walkSpeed };
  const T = {};
  let t = r() * 100;
  const evalPose = (dt) => { for (const k in T) T[k] = 0; personPose(T, pose, t, o, L, d); anim.apply(T, dt); };
  evalPose(0);

  if (opts.static) {
    // bake the current pose into a plain mesh (1 draw call, no skinning, no animation)
    const mesh = inst.mesh;
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    const src = tpl.geometry;
    const n = src.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(src.attributes.position, i); mesh.applyBoneTransform(i, v); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', src.attributes.color);
    geo.setIndex(src.index);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const sm = new THREE.Mesh(geo, mat); sm.castShadow = true; sm.receiveShadow = true;
    const group = new THREE.Group(); group.name = 'person_static'; group.add(sm);
    return { group, update() {}, setPose() {}, walkSpeed: 0, look: L, height: L.H, static: true };
  }

  const group = new THREE.Group(); group.name = 'person'; group.add(inst.mesh);
  return {
    group, look: L, height: L.H, walkSpeed,
    get pose() { return pose; },
    setPose(p) { if (p === pose) return; anim.transition(p === 'sit' || pose === 'sit' || p === 'squat' || pose === 'squat' ? 0.8 : 0.4); pose = p; },
    update(dt = 0) { dt = Math.min(dt, 0.1); t += dt; evalPose(dt); },
  };
}

/** convenience: many people scattered in a box (bus stand / finish line). → { group, people, update } */
export function createCrowd({ seed = 1, count = 12, width = 6, depth = 2, poses = ['stand', 'cheer', 'wave'], staticFrac = 0 } = {}) {
  const r = makeRng(seed * 77 + 3);
  const group = new THREE.Group(); group.name = 'crowd';
  const people = [];
  for (let i = 0; i < count; i++) {
    const p = createPerson({ seed: seed * 1000 + i, pose: r.pick(poses), static: r() < staticFrac });
    p.group.position.set(r.range(-width / 2, width / 2), 0, r.range(-depth / 2, depth / 2));
    p.group.rotation.y = r.range(-0.35, 0.35);
    group.add(p.group); people.push(p);
  }
  return { group, people, update(dt, t) { for (const p of people) p.update(dt, t); } };
}

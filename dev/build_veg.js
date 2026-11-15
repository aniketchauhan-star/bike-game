// Dev helpers for vegetation / rocks (buildings & vegetation fork)
import * as THREE from 'three';
import { getTreeTemplate, getRockTemplate, updateVegetation, _vegAtlas } from '../js/models/vegetation.js';
import { makeRng } from '../js/core/util.js';

/** dev: give the viewer scene game-like fog once the group is attached */
export function gameLook(group, fogColor = 0xb9c7d2, near = 60, far = 520) {
  let done = false;
  return () => { if (done) return; let p = group; while (p.parent) p = p.parent; if (p.isScene) { p.fog = new THREE.Fog(fogColor, near, far); p.background = new THREE.Color(fogColor); done = true; } };
}
function ground(size = 400, color = 0x5d6b3a) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  g.rotation.x = -Math.PI / 2; g.position.y = 0.01; g.receiveShadow = true; return g;
}

/** a patch of one kind, InstancedMesh; mix lods by distance from origin if lod='mix' */
export function forestPatch(kind = 'sal', lod = 'high', count = 40, spread = 60, seed = 1, withGround = 1) {
  const group = new THREE.Group();
  if (withGround) group.add(ground(spread * 4));
  const r = makeRng(seed);
  const tplH = getTreeTemplate(kind, 'high'), tplL = getTreeTemplate(kind, 'low');
  const mats = [];
  const mk = (tpl, n) => { const m = new THREE.InstancedMesh(tpl.geometry, tpl.material, n); m.customDepthMaterial = tpl.depthMaterial; m.castShadow = true; m.receiveShadow = true; m.count = 0; group.add(m); return m; };
  const mh = mk(tplH, count), ml = mk(tplL, count);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    P.set(r.range(-spread, spread), 0, r.range(-spread, spread));
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    const s = r.range(0.8, 1.2); S.set(s, s * r.range(0.9, 1.1), s);
    M.compose(P, Q, S);
    const useLow = lod === 'low' || (lod === 'mix' && P.x > 0);
    const m = useLow ? ml : mh; m.setMatrixAt(m.count++, M);
  }
  mh.instanceMatrix.needsUpdate = ml.instanceMatrix.needsUpdate = true;
  mh.computeBoundingSphere(); ml.computeBoundingSphere();
  const look = gameLook(group);
  return { group, update(dt, t) { look(); updateVegetation(t); } };
}

/** one of each kind side by side */
export function treeLineup(lod = 'high', kinds = 'sal,pine,deodar,oak,bamboo,banana,bush,fern,grass', gap = 11) {
  const group = new THREE.Group(); group.add(ground(300));
  const list = kinds.split(',');
  list.forEach((k, i) => {
    const t = getTreeTemplate(k, lod);
    const m = new THREE.Mesh(t.geometry, t.material); m.customDepthMaterial = t.depthMaterial;
    m.position.x = (i - (list.length - 1) / 2) * gap; m.castShadow = m.receiveShadow = true; group.add(m);
    console.log(`${k}/${lod}: ${t.tris} tris`);
  });
  return { group, update(dt, t) { updateVegetation(t); } };
}

export function rockLineup() {
  const group = new THREE.Group(); group.add(ground(60, 0x7a7466));
  for (const kind of ['river', 'mountain']) for (let v = 0; v < 4; v++) {
    const t = getRockTemplate(v, kind); const m = new THREE.Mesh(t.geometry, t.material);
    m.position.set((v - 1.5) * 1.6, 0, kind === 'river' ? 0 : -1.8); m.castShadow = m.receiveShadow = true; group.add(m);
    console.log(`rock ${kind}${v}: ${t.geometry.attributes.position.count / 3} tris`);
  }
  return { group };
}

export function atlasView(which = 'color') {
  const A = _vegAtlas();
  const tex = which === 'alpha' ? A.alpha : A.color;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.position.y = 2; const group = new THREE.Group(); group.add(m); return { group };
}

/** mixed forest scene: sal forest, pine slope, deodar ridge, undergrowth */
export function mixedForest(seed = 3) {
  const group = new THREE.Group(); group.add(ground(500, 0x56653a));
  const r = makeRng(seed);
  const kinds = [['sal', 50], ['pine', 30], ['deodar', 18], ['oak', 14], ['bush', 80], ['fern', 120], ['grass', 400], ['bamboo', 6], ['banana', 6]];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  for (const [k, n] of kinds) {
    for (const lod of ['high', 'low']) {
      const t = getTreeTemplate(k, lod); const im = new THREE.InstancedMesh(t.geometry, t.material, n);
      im.customDepthMaterial = t.depthMaterial; im.castShadow = true; im.receiveShadow = true; im.count = 0;
      for (let i = 0; i < n; i++) {
        P.set(r.range(-120, 120), 0, r.range(-200, 30));
        const far = P.z < -90;
        if ((lod === 'low') !== far) continue;
        if (k === 'grass' || k === 'fern') P.set(r.range(-25, 25), 0, r.range(-40, 25));
        Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); const s = r.range(0.8, 1.25); S.set(s, s, s);
        M.compose(P, Q, S); im.setMatrixAt(im.count++, M);
      }
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); group.add(im);
    }
  }
  const look = gameLook(group);
  return { group, update(dt, t) { look(); updateVegetation(t); } };
}

/** timing: atlas + all templates */
export function timing() {
  const t0 = performance.now();
  _vegAtlas();
  const t1 = performance.now();
  let tris = 0;
  for (const k of ['sal', 'pine', 'deodar', 'oak', 'bush', 'bamboo', 'banana', 'grass', 'fern']) for (const l of ['high', 'low']) tris += getTreeTemplate(k, l).tris;
  for (const k of ['river', 'mountain']) for (let v = 0; v < 4; v++) getRockTemplate(v, k);
  const t2 = performance.now();
  console.log(`veg atlas ${(t1 - t0).toFixed(0)} ms, templates+rocks ${(t2 - t1).toFixed(0)} ms, total tris ${tris}`);
  return { group: new THREE.Group() };
}

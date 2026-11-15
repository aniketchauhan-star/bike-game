// Road surface (asphalt + gravel shoulders + skirts) and continuous guard rails generated along the track.
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/util.js';
import { STEP } from './track.js';
import { roadTextures, shoulderTexture, dirtTexture } from './textures.js';

const SHOULDER = 1.5;

export function buildRoad(track, scene, { skipSkirt = [] } = {}) {
  const { map, normal } = roadTextures();
  const asphalt = new THREE.MeshStandardMaterial({
    map, normalMap: normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.86, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const shTex = shoulderTexture();
  const shoulderMat = new THREE.MeshStandardMaterial({ map: shTex, roughness: 0.97, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const skirtMat = new THREE.MeshStandardMaterial({ map: dirtTexture(256), roughness: 1 });
  const CH = 200; // samples per chunk (400 m)
  const meshes = [];
  const tmp = new THREE.Vector3();
  const inSkip = (s) => skipSkirt.some(sp => s >= sp.s0 && s <= sp.s1);
  for (let c0 = 0; c0 < track.N - 1; c0 += CH) {
    const c1 = Math.min(track.N - 1, c0 + CH);
    const A = { pos: [], uv: [], nrm: [], idx: [] }, S = { pos: [], uv: [], nrm: [], idx: [] }, K = { pos: [], uv: [], nrm: [], idx: [] };
    for (let i = c0; i <= c1; i++) {
      const s = i * STEP; const half = track.half[i]; const h = track.H[i];
      const rx = Math.cos(h), rz = -Math.sin(h); const x = track.X[i], z = track.Z[i];
      const yl = track.surfaceY(s, -half), yr = track.surfaceY(s, half);
      const v = s / 12;
      // asphalt (3 verts across for slight crown)
      const yc = track.surfaceY(s, 0) + 0.03;
      A.pos.push(x - rx * half, yl, z - rz * half, x, yc, z, x + rx * half, yr, z + rz * half);
      A.uv.push(0, v, 0.5, v, 1, v);
      const bank = track.bank[i]; const ny = Math.cos(bank), nx = Math.sin(bank);
      for (let k = 0; k < 3; k++) A.nrm.push(-rx * nx, ny, -rz * nx);
      // shoulders: L outer, L inner, R inner, R outer
      const so = half + SHOULDER;
      const ylo = track.surfaceY(s, -half) - 0.06, yro = track.surfaceY(s, half) - 0.06;
      S.pos.push(x - rx * so, ylo - 0.04, z - rz * so, x - rx * (half - 0.05), yl - 0.01, z - rz * (half - 0.05),
                 x + rx * (half - 0.05), yr - 0.01, z + rz * (half - 0.05), x + rx * so, yro - 0.04, z + rz * so);
      S.uv.push(0, s / 4, SHOULDER / 4, s / 4, 0, s / 4, SHOULDER / 4, s / 4);
      for (let k = 0; k < 4; k++) S.nrm.push(0, 1, 0);
      // skirts going down from shoulder edges
      const skip = inSkip(s);
      const dep = skip ? 0.01 : 3.2;
      K.pos.push(x - rx * so, ylo - 0.1, z - rz * so, x - rx * (so + 0.8), ylo - dep, z - rz * (so + 0.8),
                 x + rx * so, yro - 0.1, z + rz * so, x + rx * (so + 0.8), yro - dep, z + rz * (so + 0.8));
      K.uv.push(0, s / 5, 0.6, s / 5, 0, s / 5, 0.6, s / 5);
      K.nrm.push(-rx * 0.7, 0.7, -rz * 0.7, -rx * 0.7, 0.7, -rz * 0.7, rx * 0.7, 0.7, rz * 0.7, rx * 0.7, 0.7, rz * 0.7);
    }
    const n = c1 - c0 + 1;
    for (let j = 0; j < n - 1; j++) {
      // forward = increasing s; ensure upward-facing winding
      const a = j * 3, b = (j + 1) * 3;
      A.idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
      const sa = j * 4, sb = (j + 1) * 4;
      S.idx.push(sa, sa + 1, sb, sa + 1, sb + 1, sb, sa + 2, sa + 3, sb + 2, sa + 3, sb + 3, sb + 2);
      const ka = j * 4, kb = (j + 1) * 4;
      K.idx.push(ka, kb, ka + 1, ka + 1, kb, kb + 1, ka + 2, ka + 3, kb + 2, ka + 3, kb + 3, kb + 2);
    }
    // skirts share the shoulder material -> 2 draw calls per chunk
    for (const [D, mat] of [[A, asphalt], [mergeSK(S, K), shoulderMat]]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(D.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(D.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(D.uv, 2));
      g.setIndex(D.idx);
      fixWinding(g);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m); meshes.push(m);
    }
  }
  return meshes;
}

function mergeSK(S, K) {
  const off = S.pos.length / 3;
  return { pos: S.pos.concat(K.pos), uv: S.uv.concat(K.uv), nrm: S.nrm.concat(K.nrm), idx: S.idx.concat(K.idx.map(i => i + off)), _sk: off };
}

/** make every triangle face upward (+y) — robust against my index-order mistakes */
function fixWinding(g) {
  const p = g.attributes.position, idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (ny < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
}

/**
 * W-beam guard rail along spans [{s0, s1, side:+1|-1}] at lateral offset (half + off).
 * Returns { mesh, posts: [{x,y,z,rotY}] }
 */
export function buildGuardRails(track, spans, scene) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.85, roughness: 0.38 });
  // W profile (local: x = outward, y = up)
  const prof = [[0, 0.52], [0.06, 0.58], [0.0, 0.64], [0.06, 0.7], [0.0, 0.76], [0.02, 0.76], [0.08, 0.7], [0.02, 0.64], [0.08, 0.58], [0.02, 0.52]];
  const pos = [], idx = [], posts = [];
  for (const sp of spans) {
    const base = pos.length / 3; let rows = 0;
    for (let s = sp.s0; s <= sp.s1; s += 2) {
      const half = track.halfWidth(s) + 1.15; const h = track.heading(s);
      const rx = Math.cos(h) * sp.side, rz = -Math.sin(h) * sp.side; const c = track.center(s, new THREE.Vector3());
      const y0 = track.surfaceY(s, half * sp.side);
      for (const [ox, oy] of prof) pos.push(c.x + rx * (half + ox), y0 + oy, c.z + rz * (half + ox));
      rows++;
      if (Math.round(s) % 4 === 0) posts.push({ x: c.x + rx * (half + 0.12), y: y0, z: c.z + rz * (half + 0.12), rotY: h });
    }
    const P = prof.length;
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < P - 1; k++) {
      const a = base + r * P + k, b = a + 1, c = a + P, d = c + 1; idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
  }
  if (!pos.length) return { mesh: null, posts };
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
  return { mesh, posts };
}

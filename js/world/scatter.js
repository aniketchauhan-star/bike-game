// Vegetation scatter: thousands of trees per zone. Near trees = real instanced meshes (CPU-selected around camera),
// far trees = baked billboard impostors (one InstancedMesh per tree type, GPU distance culling).
import * as THREE from 'three';
import { clamp, smoothstep, makeRng, createNoise2D } from '../core/util.js';
import { STEP } from './track.js';
import { getTreeTemplate, getRockTemplate, updateVegetation } from '../models/vegetation.js';

// per-zone composition: [kind, weight]; density = trees per 100 m²
const ZONE_FOREST = {
  town:     { density: 0.05, maxDist: 160, kinds: [['oak', 0.5], ['banana', 0.2], ['bush', 0.3]] },
  forest:   { density: 1.25, maxDist: 380, kinds: [['sal', 0.78], ['bush', 0.14], ['bamboo', 0.04], ['oak', 0.04]] },
  river:    { density: 0.65, maxDist: 360, kinds: [['sal', 0.5], ['oak', 0.2], ['bamboo', 0.12], ['bush', 0.18]] },
  mountain: { density: 0.85, maxDist: 420, kinds: [['pine', 0.82], ['bush', 0.1], ['oak', 0.08]] },
  ridge:    { density: 0.95, maxDist: 420, kinds: [['deodar', 0.45], ['pine', 0.3], ['oak', 0.17], ['bush', 0.08]] },
};
const IMPOSTOR_KINDS = ['sal', 'pine', 'deodar', 'oak', 'bamboo', 'banana'];

export const impostorUniforms = {
  uSunColor: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
  uRNear: { value: 120 }, uRFar: { value: 1400 },
};

// upload only the used part of an instance buffer (much less GPU traffic on phones)
function upload(mesh, count) {
  mesh.count = count; const a = mesh.instanceMatrix;
  if (a.clearUpdateRanges) { a.clearUpdateRanges(); if (count > 0) a.addUpdateRange(0, count * 16); }
  a.needsUpdate = true;
}

export class Forest {
  constructor(track, terrain, rivers, quality, reserved = []) {
    this.track = track; this.terrain = terrain; this.rivers = rivers; this.quality = quality;
    this.reserved = reserved; // [{x,z,r}] keep-out circles (buildings, temple...)
    this.trees = new Map();   // kind -> {x:[], y:[], z:[], s:[], r:[], cells: Map}
    this.near = new Map();    // kind -> InstancedMesh (near high-LOD)
    this.shadow = new Map();
    this.imp = new Map();
    this.rocks = [];
    this.rNear = quality.treeLowR ?? (quality.id === 'high' ? 130 : quality.id === 'medium' ? 90 : 60);
    this.rHigh = Math.min(this.rNear, quality.treeHighR ?? this.rNear);
    this.mid = new Map(); // kind -> InstancedMesh (opaque low LOD between rHigh and rNear)
    impostorUniforms.uRNear.value = this.rNear - 4;
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
  }

  isFree(x, z, q, margin = 3) {
    if (q.dist < q.half + margin + 1.5) return false;
    if (q.river > 0.05) return false;
    for (const r of this.reserved) if ((x - r.x) ** 2 + (z - r.z) ** 2 < r.r * r.r) return false;
    return true;
  }

  async generate(onProgress = () => {}) {
    const T = this.track, rng = makeRng(777), noise = createNoise2D(31337);
    const dens = this.quality.treeDensity;
    const add = (kind, x, y, z, rot, sc) => {
      let t = this.trees.get(kind); if (!t) this.trees.set(kind, t = { x: [], y: [], z: [], rot: [], sc: [] });
      t.x.push(x); t.y.push(y); t.z.push(z); t.rot.push(rot); t.sc.push(sc);
    };
    const pickKind = (kinds, r) => { let a = r * kinds.reduce((s, k) => s + k[1], 0); for (const [k, w] of kinds) { if ((a -= w) <= 0) return k; } return kinds[0][0]; };
    // walk along the track; scatter in bands on both sides
    let t0 = performance.now(); const q = {};
    const cell = 7; // jitter grid cell (m)
    const seen = new Set();
    for (let s = 0; s < T.length; s += cell) {
      const zone = T.zoneAt(s); const zf = ZONE_FOREST[zone.id];
      const c = T.center(s, new THREE.Vector3()); const h = T.heading(s); const rx = Math.cos(h), rz = -Math.sin(h);
      for (let side = -1; side <= 1; side += 2) {
        for (let d = 6; d < zf.maxDist; d += cell) {
          // jittered sample around (s, d)
          const gx = Math.round((c.x + rx * d * side) / cell), gz = Math.round((c.z + rz * d * side) / cell);
          const key = gx * 100003 + gz; if (seen.has(key)) continue; seen.add(key);
          const x = gx * cell + (rng() - 0.5) * cell, z = gz * cell + (rng() - 0.5) * cell;
          // clearings & density falloff with distance
          const n = noise(x / 140, z / 140) * 0.5 + 0.5;
          let p = zf.density * dens * (cell * cell) / 100 * (0.35 + n * 1.3) * (1 - smoothstep(zf.maxDist * 0.6, zf.maxDist, d));
          if (zone.id === 'town') p *= smoothstep(18, 40, d); // keep the bazaar clear
          if (rng() > p) continue;
          this.terrain.sample(x, z, q);
          if (!this.isFree(x, z, q, zone.id === 'forest' ? 2.5 : 3.5)) continue;
          // slope check via finite difference
          const hx = this.terrain.heightAt(x + 2, z) - q.h, hz = this.terrain.heightAt(x, z + 2) - q.h;
          const slope = Math.hypot(hx, hz) / 2;
          if (slope > 1.25) continue;
          const kind = pickKind(zf.kinds, rng());
          add(kind, x, q.h - 0.15, z, rng() * Math.PI * 2, 0.75 + rng() * 0.5);
        }
      }
      if (performance.now() - t0 > 14) { onProgress(s / T.length * 0.8); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); }
    }
    // rocks: river boulders + mountain rocks near road
    for (let s = 0; s < T.length; s += 9) {
      const zone = T.zoneAt(s).id;
      if (zone !== 'river' && zone !== 'mountain' && zone !== 'ridge') continue;
      const c = T.center(s, new THREE.Vector3()); const h = T.heading(s); const rx = Math.cos(h), rz = -Math.sin(h);
      for (let k = 0; k < 3; k++) {
        const side = rng() < 0.5 ? -1 : 1; const d = 7 + rng() * 90;
        const x = c.x + rx * d * side + (rng() - 0.5) * 8, z = c.z + rz * d * side + (rng() - 0.5) * 8;
        this.terrain.sample(x, z, q);
        if (q.dist < q.half + 2.5) continue;
        const inRiver = q.river > 0.2;
        if (!inRiver && rng() > 0.35) continue;
        this.rocks.push({ x, y: q.h - 0.2, z, rot: rng() * 6.28, sc: inRiver ? 0.6 + rng() * 2.4 : 0.5 + rng() * 1.6, kind: inRiver ? 'river' : 'mountain', v: rng.int(0, 3) });
      }
    }
    onProgress(0.85);
  }

  /** build GPU objects */
  build(scene, renderer) {
    this.scene = scene;
    const dummy = new THREE.Object3D();
    for (const [kind, t] of this.trees) {
      // shuffle order so density scaling by count stays uniform
      const n = t.x.length;
      const hi = getTreeTemplate(kind, 'high'); const lo = getTreeTemplate(kind, 'low');
      const cap = Math.min(n, 2600);
      const near = new THREE.InstancedMesh(hi.geometry, hi.material, cap);
      near.count = 0; near.frustumCulled = false; near.castShadow = false; near.receiveShadow = true;
      near.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(near); this.near.set(kind, near);
      if (this.rHigh < this.rNear) {
        const mid = new THREE.InstancedMesh(lo.geometry, lo.material, cap);
        mid.count = 0; mid.frustumCulled = false; mid.castShadow = false; mid.receiveShadow = true;
        mid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(mid); this.mid.set(kind, mid);
      }
      if (this.quality.shadows && this.quality.shadowCasters === 'all' && kind !== 'bush') {
        const shMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        const sh = new THREE.InstancedMesh(lo.geometry, shMat, Math.min(n, 400));
        sh.count = 0; sh.frustumCulled = false; sh.castShadow = true; sh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(sh); this.shadow.set(kind, sh);
      }
      t.height = hi.height || 10;
      if (IMPOSTOR_KINDS.includes(kind)) {
        const imp = this._impostor(kind, hi, renderer);
        const mesh = new THREE.InstancedMesh(imp.geo, imp.mat, n);
        for (let i = 0; i < n; i++) {
          dummy.position.set(t.x[i], t.y[i], t.z[i]); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(t.sc[i]); dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.frustumCulled = false; mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh); this.imp.set(kind, mesh);
      }
      // spatial bins (64 m) for near selection
      t.bins = new Map(); const B = 64;
      for (let i = 0; i < n; i++) {
        const k = Math.floor(t.x[i] / B) * 7919 + Math.floor(t.z[i] / B); let a = t.bins.get(k); if (!a) t.bins.set(k, a = []); a.push(i);
      }
    }
    // rocks: static instanced per template
    const groups = new Map();
    for (const r of this.rocks) { const k = r.kind + r.v; let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(r); }
    for (const [k, list] of groups) {
      const tpl = getRockTemplate(+k.slice(-1), k.startsWith('river') ? 'river' : 'mountain');
      const mesh = new THREE.InstancedMesh(tpl.geometry, tpl.material, list.length);
      list.forEach((r, i) => { dummy.position.set(r.x, r.y, r.z); dummy.rotation.set(0, r.rot, 0); dummy.scale.setScalar(r.sc); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
      mesh.castShadow = this.quality.shadows; mesh.receiveShadow = true; mesh.computeBoundingSphere();
      scene.add(mesh);
    }
  }

  _impostor(kind, tpl, renderer) {
    const geo = tpl.geometry; geo.computeBoundingBox(); const bb = geo.boundingBox;
    const W = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.04, H = (bb.max.y - Math.min(0, bb.min.y)) * 1.02;
    const rtW = 256, rtH = clamp(Math.round(256 * H / W / 32) * 32, 128, 512);
    const rt = new THREE.WebGLRenderTarget(rtW, rtH, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const sc = new THREE.Scene();
    sc.add(new THREE.AmbientLight(0xffffff, 1.7));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(0.4, 1, 0.8); sc.add(dl);
    const m = new THREE.Mesh(geo, tpl.material); sc.add(m);
    const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H, Math.min(0, bb.min.y), 0.1, 500); cam.position.set(0, 0, 200); cam.lookAt(0, 0, 0);
    const prevRT = renderer.getRenderTarget(); const prevClear = renderer.getClearColor(new THREE.Color()); const prevAlpha = renderer.getClearAlpha();
    const prevTM = renderer.toneMapping;
    renderer.setRenderTarget(rt); renderer.setClearColor(0x445533, 0); renderer.clear(); renderer.render(sc, cam);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear, prevAlpha); renderer.toneMapping = prevTM;
    const q = new THREE.PlaneGeometry(1, 1); q.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSize: { value: new THREE.Vector2(W, H - Math.min(0, bb.min.y)) }, uBase: { value: Math.min(0, bb.min.y) } }]),
      fog: true, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        uniform vec2 uSize; uniform float uRNear, uRFar, uBase;
        varying vec2 vUv; varying float vH;
        #include <fog_pars_vertex>
        void main() {
          vec4 c4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 center = c4.xyz;
          float sc = length(instanceMatrix[0].xyz);
          float d = distance(center.xz, cameraPosition.xz);
          if (d < uRNear || d > uRFar) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); vUv = vec2(0.0); vH = 0.0; return; }
          vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); r = normalize(vec3(r.x, 0.0, r.z));
          vec3 wp = center + r * position.x * uSize.x * sc + vec3(0.0, (position.y * uSize.y + uBase) * sc, 0.0);
          vUv = uv; vH = position.y;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tMap; uniform vec3 uSunColor, uAmbient;
        varying vec2 vUv; varying float vH;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(tMap, vUv);
          if (t.a < 0.42) discard;
          vec3 col = t.rgb * (uAmbient * 1.25 + uSunColor * 0.42) * (0.75 + vH * 0.35);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.tMap = { value: rt.texture };
    mat.uniforms.uRNear = impostorUniforms.uRNear; mat.uniforms.uRFar = impostorUniforms.uRFar;
    mat.uniforms.uSunColor = impostorUniforms.uSunColor; mat.uniforms.uAmbient = impostorUniforms.uAmbient;
    return { geo: q, mat };
  }

  setLighting(sunColor, sunI, hemiColor, hemiI, viewFar) {
    impostorUniforms.uSunColor.value.copy(sunColor).multiplyScalar(sunI * 0.33);
    impostorUniforms.uAmbient.value.copy(hemiColor).multiplyScalar(hemiI * 0.38);
    impostorUniforms.uRFar.value = viewFar;
  }

  update(camPos, time) {
    updateVegetation(time);
    if (this.lastCam.distanceToSquared(camPos) < 25) return;
    this.lastCam.copy(camPos);
    const R = this.rNear + 12, R2 = R * R, RS2 = 50 * 50, B = 64, RH = this.rHigh + 6, RH2 = RH * RH;
    const m = new THREE.Matrix4(), qn = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [kind, t] of this.trees) {
      const near = this.near.get(kind), sh = this.shadow.get(kind), mid = this.mid.get(kind);
      let c = 0, cs = 0, cm = 0; const cap = near.instanceMatrix.count, capS = sh ? sh.instanceMatrix.count : 0;
      const bx0 = Math.floor((camPos.x - R) / B), bx1 = Math.floor((camPos.x + R) / B), bz0 = Math.floor((camPos.z - R) / B), bz1 = Math.floor((camPos.z + R) / B);
      for (let bx = bx0; bx <= bx1; bx++) for (let bz = bz0; bz <= bz1; bz++) {
        const arr = t.bins.get(bx * 7919 + bz); if (!arr) continue;
        for (const i of arr) {
          const dx = t.x[i] - camPos.x, dz = t.z[i] - camPos.z; const d2 = dx * dx + dz * dz;
          if (d2 > R2) continue;
          qn.setFromAxisAngle(up, t.rot[i]); sv.setScalar(t.sc[i]); pv.set(t.x[i], t.y[i], t.z[i]);
          m.compose(pv, qn, sv);
          if (mid && d2 > RH2) { if (cm < cap) mid.setMatrixAt(cm++, m); }
          else if (c < cap) near.setMatrixAt(c++, m);
          if (sh && d2 < RS2 && cs < capS) sh.setMatrixAt(cs++, m);
        }
      }
      upload(near, c); if (mid) upload(mid, cm); if (sh) upload(sh, cs);
    }
  }
}

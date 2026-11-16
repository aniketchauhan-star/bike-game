// Terrain: height field shaped around the road + rivers, chunked LOD meshes, splat-blended PBR material.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, createNoise2D, fbm, ridged } from '../core/util.js';
import { STEP } from './track.js';
import { grassTexture, dirtTexture, rockTexture, forestFloorTexture, macroTexture, terrainNormalTexture } from './textures.js';

const ZONE_RELIEF = { town: [4, 0], forest: [14, 0], river: [75, 0], mountain: [160, 0], ridge: [60, 120] };

export class Terrain {
  constructor(track, rivers) {
    this.track = track; this.rivers = rivers;
    this.noise = createNoise2D(1234); this.noise2 = createNoise2D(4321); this.noise3 = createNoise2D(777);
    const b = track.bounds; const M = 2600;
    this.minX = Math.floor((b.minX - M) / 128) * 128; this.maxX = Math.ceil((b.maxX + M) / 128) * 128;
    this.minZ = Math.floor((b.minZ - M) / 128) * 128; this.maxZ = Math.ceil((b.maxZ + M) / 128) * 128;
    this._buildCoarse();
    this._buildBlobs();
    this._q = {};
  }

  // --------------------------------------------------------------- coarse IDW fields (base elevation, relief amp, ridge drop)
  _buildCoarse() {
    const T = this.track; const G = 32; this.G = G;
    const nx = Math.ceil((this.maxX - this.minX) / G) + 1, nz = Math.ceil((this.maxZ - this.minZ) / G) + 1;
    this.cnx = nx; this.cnz = nz;
    const base = new Float32Array(nx * nz), amp = new Float32Array(nx * nz), drop = new Float32Array(nx * nz);
    const cdist = new Float32Array(nx * nz), cidx = new Int32Array(nx * nz);
    const sx = [], sz = [], sy = [], sa = [], sd = [], si = [];
    for (let i = 0; i < T.N; i += 10) { sx.push(T.X[i]); sz.push(T.Z[i]); sy.push(T.Y[i]); const zr = ZONE_RELIEF[T.zoneIds[i]]; sa.push(zr[0]); sd.push(zr[1]); si.push(i); }
    const n = sx.length;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = this.minX + i * G, z = this.minZ + j * G;
      let ws = 0, by = 0, ba = 0, bd = 0, best = Infinity, bk = 0;
      for (let k = 0; k < n; k++) {
        const d2 = (x - sx[k]) ** 2 + (z - sz[k]) ** 2; const w = 1 / ((d2 + 900) * (d2 + 900));
        ws += w; by += w * sy[k]; ba += w * sa[k]; bd += w * sd[k];
        if (d2 < best) { best = d2; bk = k; }
      }
      const id = j * nx + i; base[id] = by / ws; amp[id] = ba / ws; drop[id] = bd / ws;
      cdist[id] = Math.sqrt(best); cidx[id] = si[bk];
    }
    this.cBase = base; this.cAmp = amp; this.cDrop = drop; this.cDist = cdist; this.cIdx = cidx;
  }
  _coarse(arr, x, z) {
    const fx = clamp((x - this.minX) / this.G, 0, this.cnx - 1.001), fz = clamp((z - this.minZ) / this.G, 0, this.cnz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j; const nx = this.cnx;
    const a = arr[j * nx + i], b = arr[j * nx + i + 1], c = arr[(j + 1) * nx + i], d = arr[(j + 1) * nx + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  // --------------------------------------------------------------- large hand-placed landforms
  _buildBlobs() {
    const T = this.track; const v = new THREE.Vector3();
    const P = (s, d) => { T.point(s, d, v); return [v.x, v.z]; };
    const blobs = [];
    const add = (xz, h, r) => blobs.push({ x: xz[0], z: xz[1], h, r });
    // Shivalik foothills visible from Ramnagar (north) + plains elsewhere
    add(P(700, -900), 70, 650); add(P(600, 1100), 55, 700);
    // forest: gentle
    add(P(1300, -500), 45, 450); add(P(1500, 600), 60, 500);
    // Kosi valley walls
    add(P(2250, -430), 170, 430); add(P(2600, -380), 150, 380); add(P(2300, 520), 190, 400); add(P(2750, 560), 210, 420);
    // hairpin mountain: climb direction from first leg to last leg
    let cx = 0, cz = 0, c = 0; for (let i = 0; i < T.N; i++) if (T.zoneIds[i] === 'mountain') { cx += T.X[i]; cz += T.Z[i]; c++; }
    cx /= c; cz /= c;
    const a = P(T.zoneSpans.find(z => z.id === 'mountain').s0 + 40, 0), bb = P(T.zoneSpans.find(z => z.id === 'ridge').s0 - 40, 0);
    let ux = bb[0] - a[0], uz = bb[1] - a[1]; const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul;
    add([cx + ux * 380 - uz * 300, cz + uz * 380 + ux * 300], 210, 420);
    add([cx - ux * 420, cz - uz * 420], -30, 380);
    add([cx + uz * 520, cz - ux * 520], 140, 420);
    // Ranikhet ridge: peaks to the north (right side while riding west) and far south-west hills
    add(P(5000, 900), 180, 520); add(P(5400, -1000), 90, 600); add(P(4700, -700), 60, 400);
    this.blobs = blobs;
  }
  _blobs(x, z) {
    let h = 0; for (const b of this.blobs) { const d2 = (x - b.x) ** 2 + (z - b.z) ** 2; const r2 = b.r * b.r; if (d2 < r2 * 6) h += b.h * Math.exp(-d2 / r2); }
    return h;
  }

  // --------------------------------------------------------------- the height function
  /** full sample: { h, dist (to road centre), s, d, half, river (0..1 in bed), zone } */
  sample(x, z, out = this._q) {
    const T = this.track;
    const coarseD = this._coarse(this.cDist, x, z);
    let s, d, dist;
    if (coarseD > 300) {
      const fx = clamp(Math.round((x - this.minX) / this.G), 0, this.cnx - 1), fz = clamp(Math.round((z - this.minZ) / this.G), 0, this.cnz - 1);
      const i = this.cIdx[fz * this.cnx + fx]; s = i * STEP; dist = coarseD; d = dist;
    } else {
      const ns = T.nearestSample(x, z, 8);
      s = ns.i * STEP; d = ns.dist; dist = ns.dist;
      if (ns.dist < 220) { const p = T.project(x, z, s, 3, out); s = p.s; d = p.d; dist = Math.abs(d); }
    }
    const half = T.halfWidth(s);
    // natural terrain
    const base = this._coarse(this.cBase, x, z);
    const amp = this._coarse(this.cAmp, x, z);
    const drop = this._coarse(this.cDrop, x, z);
    const n = this.noise, n2 = this.noise2;
    const wx = x + n2(x / 900, z / 900) * 180, wz = z + n2(x / 900 + 31.7, z / 900 - 12.3) * 180; // domain warp
    const rg = ridged(n, wx / 820, wz / 820, 5);
    const rel = 0.46 * rg + 0.54 * (fbm(n2, wx / 380, wz / 380, 4) * 0.5 + 0.5);
    const mask = smoothstep(half + 2.5, half + 85, dist);
    const mask2 = smoothstep(half + 10, half + 420, dist);
    const blobs = this._blobs(x, z);
    let h = base + mask * (amp * (rel - 0.18) + blobs * mask2 * (0.7 + rg * 0.5)) - drop * smoothstep(14, 280, dist);
    h += fbm(this.noise3, x / 42, z / 42, 3) * (1.2 + amp * 0.025) * smoothstep(half + 3, half + 25, dist); // small bumps
    // rivers
    let riverF = 0;
    const r = this.rivers ? this.rivers.query(x, z) : null;
    if (r) {
      const inW = clamp(1 - r.dist / Math.max(1, r.w), 0, 1);
      const bedY = r.y + 0.3 - 2.3 * Math.pow(inW, 0.6) + (this.noise3(x / 9, z / 9) * 0.25) * (1 - inW);
      const tr = smoothstep(r.bed * 0.85, r.bed + 24, r.dist);
      const carved = lerp(bedY, h, tr);
      if (carved < h) h = carved;
      riverF = 1 - smoothstep(r.bed * 0.7, r.bed + 6, r.dist);
    }
    // waterfall cliff
    const wf = this.rivers?.waterfall;
    if (wf) {
      const dx = x - wf.base.x, dz = z - wf.base.z; const dd = Math.hypot(dx, dz);
      if (dd < 40) {
        // distance "behind" the fall (toward the hill, i.e. away from road = -right)
        const back = -(dx * wf.right.x + dz * wf.right.z);
        const along = Math.abs(dx * wf.forward.x + dz * wf.forward.z);
        const w = (1 - smoothstep(6, 16, along)) * (1 - smoothstep(22, 40, dd));
        const cliff = wf.roadY - 0.8 + Math.max(0, back) * 2.6;
        if (back > -1) h = lerp(h, Math.max(h, cliff), w);
        if (back < 3 && back > -6) h = lerp(h, Math.min(h, wf.roadY - 2.2), w * (1 - smoothstep(2, 7, along)) * (1 - smoothstep(-1, 3, back)));
      }
    }
    // road flattening (not under the bridge)
    let flat = 1;
    const br = this.rivers?.bridgeSpan;
    if (br && Math.abs(s - br.s) < 30 && dist < half + 30) flat = smoothstep(14, 22, Math.abs(s - br.s));
    const roadY = T.surfaceY(s, clamp(d, -half, half)) - 0.22;
    const t = smoothstep(half + 0.6, half + 10, dist);
    const hRoad = lerp(roadY, h, t);
    h = lerp(h, hRoad, flat);
    out.h = h; out.dist = dist; out.s = s; out.d = d; out.half = half; out.river = riverF;
    out.zone = T.zoneIds[Math.min(T.N - 1, Math.round(s / STEP))]; out.amp = amp;
    return out;
  }
  heightAt(x, z) { return this.sample(x, z, this._q).h; }

  // --------------------------------------------------------------- mesh generation
  async build(scene, quality, onProgress = () => {}) {
    const C = 128; // chunk size
    const R = quality.phone ? 1024 : 512; // region size (merge + culling unit)
    const nCx = (this.maxX - this.minX) / C, nCz = (this.maxZ - this.minZ) / C;
    const regions = new Map();
    const nearSegs = (quality.id === 'high' || quality.id === 'ultra') ? 32 : 16;
    const lodSegs = (dist) => {
      if (dist < 150) return nearSegs;
      if (dist < 420) return quality.id === 'low' ? 8 : 16;
      if (dist < 1000) return 8;
      return 4;
    };
    const segsGrid = new Int32Array(nCx * nCz);
    for (let j = 0; j < nCz; j++) for (let i = 0; i < nCx; i++) {
      const x0 = this.minX + i * C, z0 = this.minZ + j * C;
      const cd = this._coarse(this.cDist, x0 + C / 2, z0 + C / 2);
      const dist = cd > 400 ? cd - C * 0.71 : Math.max(0, this.track.nearestSample(x0 + C / 2, z0 + C / 2, 60).dist - C * 0.71);
      segsGrid[j * nCx + i] = lodSegs(dist);
    }
    const segAt = (i, j) => (i < 0 || j < 0 || i >= nCx || j >= nCz) ? 0 : segsGrid[j * nCx + i];
    let t0 = performance.now(); let done = 0; const total = nCx * nCz;
    for (let j = 0; j < nCz; j++) for (let i = 0; i < nCx; i++) {
      const x0 = this.minX + i * C, z0 = this.minZ + j * C; const segs = segAt(i, j);
      const g = this._chunk(x0, z0, C, segs, { l: segAt(i - 1, j), r: segAt(i + 1, j), t: segAt(i, j - 1), b: segAt(i, j + 1) });
      // near (fine) chunks: small regions for culling; far (coarse) chunks: big regions to save draw calls
      const RR = segs >= 16 ? R : segs >= 8 ? R * 2 : R * 4;
      const rk = `${RR}:${Math.floor((x0 - this.minX) / RR)},${Math.floor((z0 - this.minZ) / RR)}`;
      let reg = regions.get(rk); if (!reg) regions.set(rk, reg = []);
      reg.push(g);
      done++;
      if (performance.now() - t0 > 24) { onProgress(done / total); await yieldNow(); t0 = performance.now(); }
    }
    const material = this.material(quality);
    this.meshes = [];
    for (const [, list] of regions) {
      const geo = mergeRaw(list);
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true; mesh.castShadow = false; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      scene.add(mesh); this.meshes.push(mesh);
    }
    onProgress(1);
    return this.meshes;
  }

  /** one terrain chunk; edges facing coarser neighbours are snapped to their linear edge (crack-free) */
  _chunk(x0, z0, size, segs, nbr) {
    const step = size / segs; const n = segs + 1; const nb = segs + 3; // border ring for normals
    const H = new Float32Array(nb * nb);
    const info = new Array(n * n);
    for (let j = 0; j < nb; j++) for (let i = 0; i < nb; i++) {
      const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
      const interior = i >= 1 && j >= 1 && i <= n && j <= n;
      if (interior) { const q = this.sample(x, z, {}); H[j * nb + i] = q.h; info[(j - 1) * n + (i - 1)] = { h: q.h, dist: q.dist, half: q.half, river: q.river, zone: q.zone, amp: q.amp }; }
      else H[j * nb + i] = this.heightAt(x, z);
    }
    // edge snapping toward coarser neighbours
    const snap = (getIdx, nSegs) => {
      if (!nSegs || nSegs >= segs) return;
      const ratio = segs / nSegs;
      for (let k = 0; k < n; k++) {
        if (k % ratio === 0) continue;
        const k0 = Math.floor(k / ratio) * ratio, k1 = k0 + ratio; const t = (k - k0) / ratio;
        H[getIdx(k)] = H[getIdx(k0)] + (H[getIdx(k1)] - H[getIdx(k0)]) * t;
      }
    };
    snap(k => 1 * nb + (k + 1), nbr.t);           // top row (j=0)
    snap(k => (segs + 1) * nb + (k + 1), nbr.b);  // bottom row
    snap(k => (k + 1) * nb + 1, nbr.l);           // left col
    snap(k => (k + 1) * nb + (segs + 1), nbr.r);  // right col
    const N = n * n;
    const pos = new Float32Array(N * 3), nrm = new Float32Array(N * 3), col = new Float32Array(N * 3), spl = new Float32Array(N * 4), uv = new Float32Array(N * 2);
    const tmpC = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = j * n + i;
      const x = x0 + i * step, z = z0 + j * step; const h = H[(j + 1) * nb + (i + 1)];
      const hl = H[(j + 1) * nb + i], hr = H[(j + 1) * nb + i + 2], hu = H[j * nb + i + 1], hd = H[(j + 2) * nb + i + 1];
      let nx = (hl - hr), ny = 2 * step, nz = (hu - hd); const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      nrm[v * 3] = nx; nrm[v * 3 + 1] = ny; nrm[v * 3 + 2] = nz;
      uv[v * 2] = x * 0.16; uv[v * 2 + 1] = z * 0.16;
      const [c, w] = this._paint(x, z, h, ny, info[v], tmpC);
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
      spl[v * 4] = w[0]; spl[v * 4 + 1] = w[1]; spl[v * 4 + 2] = w[2]; spl[v * 4 + 3] = w[3];
    }
    const idx = new Uint32Array(segs * segs * 6); let o = 0;
    for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      if ((i + j) & 1) { idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
      else { idx[o++] = a; idx[o++] = c; idx[o++] = d; idx[o++] = a; idx[o++] = d; idx[o++] = b; }
    }
    return { pos, nrm, col, spl, uv, idx };
  }

  /** vertex colour tint + splat weights [grass, dirt, rock, forestFloor] */
  _paint(x, z, h, ny, q, c) {
    const slope = 1 - ny;
    const n = this.noise2(x / 60, z / 60), n2 = this.noise(x / 17, z / 17);
    let grass = 1, dirt = 0, rock = 0, floor = 0;
    const zone = q.zone;
    // zone floor types
    if (zone === 'forest') { floor = 0.55 + n * 0.3; grass = 0.6 - n * 0.2; }
    else if (zone === 'mountain') { floor = 0.45 + n * 0.35; grass = 0.6; }
    else if (zone === 'ridge') { floor = 0.3 + n * 0.25; grass = 0.8; }
    else if (zone === 'river') { floor = 0.2 + n * 0.2; grass = 0.85; }
    else if (zone === 'town') { dirt = 0.18 + n * 0.22; grass = 0.85; }
    // roadside worn verge
    const verge = 1 - smoothstep(q.half + 1.2, q.half + 5 + n2 * 2, q.dist);
    dirt += verge * 1.4; grass *= 1 - verge * 0.7; floor *= 1 - verge;
    // steep -> rock (cliffs); distant gentle slopes read as forest
    rock = smoothstep(0.34, 0.58, slope + n2 * 0.06) * 1.6;
    if (q.amp > 120) rock += smoothstep(0.3, 0.5, slope) * 0.4;
    const farF = smoothstep(120, 450, q.dist);
    floor += farF * 0.8; grass *= 1 - farF * 0.4; rock *= 1 - farF * 0.35;
    // river bed -> pebbles & boulders
    if (q.river > 0) { dirt += q.river * 2.2; rock += q.river * 0.5; grass *= 1 - q.river; floor *= 1 - q.river; }
    const sum = grass + dirt + rock + floor;
    const w = [grass / sum, dirt / sum, rock / sum, floor / sum];
    // tint
    let r = 1, g = 1, b = 1;
    if (zone === 'town') { r = 0.92; g = 1.0; b = 0.76; }
    else if (zone === 'forest') { r = 0.78; g = 0.95; b = 0.64; }
    else if (zone === 'river') { r = 0.86; g = 1.02; b = 0.74; }
    else if (zone === 'mountain') { r = 0.9; g = 0.96; b = 0.66; }
    else if (zone === 'ridge') { r = 0.85; g = 1.0; b = 0.74; }
    const v = 0.9 + n * 0.12;
    // distant terrain: dark green forest canopy impression (Kumaon hills are densely wooded)
    const far = smoothstep(110, 600, q.dist) * (1 - w[2] * 0.7);
    const pine = zone === 'mountain' || zone === 'ridge';
    c.setRGB(lerp(r * v, pine ? 0.36 : 0.34, far * 0.82), lerp(g * v, pine ? 0.52 : 0.56, far * 0.82), lerp(b * v, pine ? 0.3 : 0.26, far * 0.82));
    return [c, w];
  }

  material(quality) {
    if (this._mat) return this._mat;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, normalMap: terrainNormalTexture(), normalScale: new THREE.Vector2(0.28, 0.28) });
    const sz = quality.id === 'low' ? 256 : 512;
    const uniforms = {
      tGrass: { value: grassTexture(sz) }, tDirt: { value: dirtTexture(sz) }, tRock: { value: rockTexture(sz) },
      tFloor: { value: forestFloorTexture(sz) }, tMacro: { value: macroTexture() },
    };
    const tri = quality.triplanar ?? (quality.id !== 'low');
    const lite = !!quality.lite;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(position,1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass, tDirt, tRock, tFloor, tMacro;\nvarying vec4 vSplat;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <map_fragment>', `
          vec2 wxz = vWPos.xz;
          float macro = texture2D(tMacro, wxz * 0.0019).r;
          float macro2 = texture2D(tMacro, wxz * 0.011 + 0.37).r;
          ${lite ? 'vec3 cg = texture2D(tGrass, wxz * 0.11).rgb;' : 'vec3 cg = mix(texture2D(tGrass, wxz * 0.13).rgb, texture2D(tGrass, wxz * 0.031).rgb, 0.35);'}
          vec3 cd = texture2D(tDirt, wxz * 0.15).rgb;
          ${lite ? 'vec3 cf = texture2D(tFloor, wxz * 0.1).rgb;' : 'vec3 cf = mix(texture2D(tFloor, wxz * 0.11).rgb, texture2D(tFloor, wxz * 0.027).rgb, 0.3);'}
          ${tri ? `
          vec3 an = abs(normalize(vWNrm)); an = pow(an, vec3(3.0)); an /= (an.x + an.y + an.z);
          vec3 cr = texture2D(tRock, vWPos.zy * 0.075).rgb * an.x + texture2D(tRock, wxz * 0.075).rgb * an.y + texture2D(tRock, vWPos.xy * 0.075).rgb * an.z;`
          : `vec3 cr = texture2D(tRock, wxz * 0.075 + vWPos.y * 0.05).rgb;`}
          vec4 w = vSplat; w = max(w, 0.0);
          // height-ish blending sharpen by macro noise
          w.x *= 0.7 + macro2 * 0.6; w.w *= 1.3 - macro2 * 0.6;
          w /= max(1e-3, w.x + w.y + w.z + w.w);
          vec3 tcol = cg * w.x + cd * w.y + cr * w.z + cf * w.w;
          tcol *= 0.74 + macro * 0.52;
          diffuseColor.rgb *= tcol * 1.5;
        `);
    };
    m.customProgramCacheKey = () => 'terrain-' + (tri ? 'tri' : 'flat') + (lite ? '-lite' : '');
    this._mat = m;
    return m;
  }
}

// fast cooperative yield (setTimeout(0) is clamped to >=4ms in browsers)
const _mc = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null; const _q = [];
if (_mc) _mc.port1.onmessage = () => { const f = _q.shift(); f && f(); };
export function yieldNow() { return new Promise(r => { if (_mc) { _q.push(r); _mc.port2.postMessage(0); } else setTimeout(r, 0); }); }

function mergeRaw(list) {
  let vtx = 0, ind = 0; for (const g of list) { vtx += g.pos.length / 3; ind += g.idx.length; }
  const pos = new Float32Array(vtx * 3), nrm = new Float32Array(vtx * 3), col = new Float32Array(vtx * 3), spl = new Float32Array(vtx * 4), uv = new Float32Array(vtx * 2);
  const idx = vtx > 65535 ? new Uint32Array(ind) : new Uint16Array(ind);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.pos, vo * 3); nrm.set(g.nrm, vo * 3); col.set(g.col, vo * 3); spl.set(g.spl, vo * 4); uv.set(g.uv, vo * 2);
    for (let k = 0; k < g.idx.length; k++) idx[io + k] = g.idx[k] + vo;
    vo += g.pos.length / 3; io += g.idx.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}

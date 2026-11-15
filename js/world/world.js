// World orchestrator: builds track, terrain, road, rivers, sky, vegetation and all the props; renders with a
// background pass (sky + far mountains) followed by the main scene.
import * as THREE from 'three';
import { clamp, smoothstep } from '../core/util.js';
import { Track } from './track.js';
import { Rivers } from './river.js';
import { Terrain } from './terrain.js';
import { buildRoad, buildGuardRails } from './road.js';
import { createRiverMesh, createWaterfall, waterUniforms, waterMaterial } from './water.js';
import { Atmosphere, patchFogChunk } from './sky.js';
import { Solids } from './solids.js';
import { FX } from './fx.js';

const VIEW_FAR = { low: 1500, medium: 2100, high: 3600 };

export class World {
  constructor(renderer, quality) {
    patchFogChunk();
    this.renderer = renderer; this.quality = quality;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.atmo = new Atmosphere(renderer, quality);
    this.atmo.attach(this.scene);
    this.viewFar = VIEW_FAR[quality.id] || 2600;
    this.atmo.setViewDistance(this.viewFar);
    this.updatables = [];
    this.time = 0;
    this.track = new Track();
    this.rivers = new Rivers(this.track);
  }

  async build(onProgress = () => {}) {
    const tm = { t: performance.now() }; const lap = (k) => { const n = performance.now(); console.log(`[world] ${k}: ${(n - tm.t).toFixed(0)} ms`); tm.t = n; };
    this._lap = lap;
    const P = (a, b) => (t) => onProgress(a + (b - a) * t);
    P(0, 0.02)(0);
    this.terrain = new Terrain(this.track, this.rivers);
    lap('track+rivers+idw');
    await this.terrain.build(this.scene, this.quality, P(0.02, 0.42));
    lap('terrain');
    // road
    buildRoad(this.track, this.scene, { skipSkirt: [{ s0: this.rivers.bridgeSpan.s0 - 2, s1: this.rivers.bridgeSpan.s1 + 2 }] });
    // water
    this.scene.add(createRiverMesh(this.rivers.main, { deep: 0x0b4a4e, shallow: 0x3f8a76 }));
    this.scene.add(createRiverMesh(this.rivers.trib, { widen: 1.25, segsAcross: 4, deep: 0x1d4a42, shallow: 0x4d7a66, foam: 1.3 }));
    this.scene.add(createRiverMesh(this.rivers.stream, { widen: 1.3, segsAcross: 3, deep: 0x26514a, shallow: 0x5a8574, foam: 1.5 }));
    const wf = createWaterfall(this.rivers.waterfall); this.scene.add(wf);
    // pool at waterfall base
    {
      const g = new THREE.CircleGeometry(4.2, 24); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, waterMaterial({ deep: 0x1f4f4a, shallow: 0x5a8a78, foamAmt: 1.4 })); m.position.copy(this.rivers.waterfall.base); m.position.y -= 0.35; m.renderOrder = 2;
      g.setAttribute('rapid', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(0.6), 1));
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * 0.8);
      this.scene.add(m);
    }
    lap('road+water');
    P(0.42, 0.45)(1);
    // modules with models (loaded dynamically so one failing module cannot break the game)
    const M = {};
    const load = async (key, path) => { try { M[key] = await import(path); } catch (e) { console.warn('module failed', path, e); M[key] = {}; } };
    await Promise.all([
      load('buildings', '../models/buildings.js'), load('props', '../models/props.js'), load('vehicles', '../models/vehicles.js'),
      load('animals', '../models/animals.js'), load('people', '../models/people.js'), load('veg', '../models/vegetation.js'),
    ]);
    this.M = M; lap('model modules');
    // props / buildings / animals / people / traffic
    const { Populator } = await import('./populate.js');
    this.pop = new Populator(this);
    await this.pop.run(M, P(0.45, 0.62)); lap('populate');
    // vegetation
    try {
      const { Forest } = await import('./scatter.js');
      this.forest = new Forest(this.track, this.terrain, this.rivers, this.quality, this.pop.reserved);
      await this.forest.generate(P(0.62, 0.86)); lap('forest gen');
      this.forest.build(this.scene, this.renderer); lap('forest build');
      this.forestReady = true;
    } catch (e) { console.warn('forest failed', e); this.forest = null; }
    P(0.86, 0.9)(1);
    // solid obstacles for free-roam riding (trees, rocks, buildings, poles)
    this.solids = new Solids(12);
    const TR = { sal: 0.38, pine: 0.32, deodar: 0.42, oak: 0.4, bamboo: 0.9, banana: 0.16 };
    if (this.forest) {
      for (const [kind, t] of this.forest.trees) { const r0 = TR[kind]; if (!r0) continue; for (let i = 0; i < t.x.length; i++) this.solids.add(t.x[i], t.z[i], r0 * t.sc[i], t.y[i] + 30, 'tree'); }
      for (const r of this.forest.rocks) if (r.sc > 0.45) this.solids.add(r.x, r.z, 0.45 * r.sc, r.y + 0.75 * r.sc, 'rock');
    }
    for (const c of this.pop?.reserved || []) {
      // never put a solid on the road itself
      const ns = this.track.nearestSample(c.x, c.z, 6); const half = this.track.half[ns.i] || 4;
      const r = Math.min(c.r * 0.82, ns.dist - half - 1.6);
      if (r > 0.6) this.solids.add(c.x, c.z, r, 1e9, 'building');
    }
    for (const p of this.pop?.poleSpots || []) this.solids.add(p.x, p.z, p.r, 1e9, 'pole');
    this.fx = new FX(this.scene);
    lap('solids+fx');
    this.setTimeOfDay(this.atmo.todId || 'evening'); lap('time of day/env');
    this.updatables.push((dt, t) => wf.userData.update?.(dt, t));
    onProgress(0.92);
  }

  setTimeOfDay(id) {
    const env = this.atmo.setTimeOfDay(id);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.85;
    if (this.forest) this.forest.setLighting(this.atmo.sun.color, this.atmo.sun.intensity, this.atmo.hemi.color, this.atmo.hemi.intensity, this.viewFar * 0.8);
  }

  buildRails(spans) {
    const r = buildGuardRails(this.track, spans, this.scene);
    return r;
  }

  buildWires(poles) {
    const pts = [];
    for (let i = 1; i < poles.length; i++) {
      const a = poles[i - 1], b = poles[i]; if (a.p.distanceTo(b.p) > 60) continue;
      for (const off of [-0.55, 0, 0.55]) {
        const ya = a.yaw, yb = b.yaw;
        const pa = new THREE.Vector3(a.p.x + Math.cos(ya) * off, a.p.y + 7.55, a.p.z - Math.sin(ya) * off);
        const pb = new THREE.Vector3(b.p.x + Math.cos(yb) * off, b.p.y + 7.55, b.p.z - Math.sin(yb) * off);
        const N = 8; let prev = pa;
        for (let k = 1; k <= N; k++) {
          const t = k / N; const p = pa.clone().lerp(pb, t); p.y -= Math.sin(t * Math.PI) * 0.9;
          pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z); prev = p;
        }
      }
    }
    if (!pts.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.75 }));
    this.scene.add(l);
  }

  /** per-frame update. focus = player position */
  update(dt, camera, focus, { raceTime = 0, playerS = null, audio = null } = {}) {
    this.time += dt;
    waterUniforms.uTime.value = this.time;
    this.atmo.update(camera, focus, this.time);
    if (this.forest && this.forestReady) this.forest.update(camera.position, this.time);
    if (this.pop) this.pop.update(dt, this.time, camera.position, raceTime, playerS, audio);
    for (const u of this.updatables) u(dt, this.time);
    this.M?.props?.updateProps?.(this.time);
    this.fx?.update(dt);
  }

  render(renderer, camera) {
    renderer.autoClear = false;
    renderer.clear(true, true, true);
    this.atmo.renderBackground(renderer);
    renderer.clearDepth();
    renderer.render(this.scene, camera);
  }

  // ---- gameplay queries
  get obstacles() { return this.pop ? this.pop.obstacles : []; }
  get triggers() { return this.pop ? this.pop.triggers : []; }
  ambience(s, pos) { return this.pop ? this.pop.ambience(s, pos) : {}; }
  groundAt(x, z) { return this.terrain.heightAt(x, z); }
}

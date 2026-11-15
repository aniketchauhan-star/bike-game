// PUBG-style lobby: character stands in front, his bike parked behind with the helmet on it, golden-hour Himalayan backdrop.
// Swipe / arrows switch rider with a slide transition.
import * as THREE from 'three';
import { Sky } from 'three/addons/Sky.js';
import { clamp, lerp, damp, createNoise2D, fbm, ridged, canvasTexture, makeRng } from './core/util.js';
import { CHARACTERS } from './config.js';

const ease = t => 1 - Math.pow(1 - t, 3);

export class Lobby {
  constructor(renderer, models) {
    this.renderer = renderer; this.models = models;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 6000);
    this.camBase = new THREE.Vector3(0.05, 1.32, 4.15); this.camLook = new THREE.Vector3(0.05, 1.02, -0.3);
    this.setups = []; this.index = 0; this.anim = null; this.time = 0;
    this.build();
  }

  build() {
    const S = this.scene;
    // sky (golden hour, sun behind-left for rim light)
    const sky = new Sky(); sky.scale.setScalar(5000); S.add(sky);
    const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(84), THREE.MathUtils.degToRad(215));
    const u = sky.material.uniforms; u.sunPosition.value.copy(sun); u.turbidity.value = 6; u.rayleigh.value = 2.4; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.88;
    if (u.cloudCoverage) { u.cloudCoverage.value = 0.3; u.cloudDensity.value = 0.4; u.cloudScale.value = 0.00025; }
    this.sky = sky;
    // env map from sky
    const pm = new THREE.PMREMGenerator(this.renderer); const es = new THREE.Scene(); const s2 = new Sky(); s2.scale.setScalar(50); Object.assign(s2.material.uniforms.sunPosition.value, sun);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = u[k].value;
    es.add(s2);
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) { // phones: baked sky background
      const rt = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      new THREE.CubeCamera(0.1, 1000, rt).update(this.renderer, es);
      S.background = rt.texture; sky.visible = false;
    }
    S.environment = pm.fromScene(es, 0.03, 0.1, 200).texture; S.environmentIntensity = 0.9;
    // lights
    const key = new THREE.DirectionalLight(0xffd4a3, 2.6); key.position.set(-4, 6, 6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 }); key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03;
    S.add(key); S.add(key.target);
    const rim = new THREE.DirectionalLight(0xffa860, 2.2); rim.position.set(3, 4, -6); S.add(rim);
    S.add(new THREE.HemisphereLight(0xb9cdf0, 0x4a3b2c, 0.9));
    this.fog = new THREE.Fog(0xe6b48a, 60, 900); S.fog = this.fog;
    // ground: grass + stone platform
    const grass = new THREE.Mesh(new THREE.CircleGeometry(400, 48), new THREE.MeshStandardMaterial({ color: 0x4d5f2c, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; S.add(grass);
    const stoneTex = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#6d6a64'; ctx.fillRect(0, 0, w, h); const r = makeRng(5);
      for (let y = 0; y < h; y += 64) for (let x = (y / 64) % 2 ? -32 : 0; x < w; x += 64 + r() * 20) {
        const g = 90 + r() * 50; ctx.fillStyle = `rgb(${g},${g * 0.97},${g * 0.92})`; ctx.fillRect(x + 2, y + 2, 60 + r() * 18, 60);
      }
      for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(0,0,0,${r() * 0.12})`; ctx.fillRect(r() * w, r() * h, 2, 2); }
    }, { repeat: [3, 3] });
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.8, 0.25, 48), new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9 }));
    plat.position.y = -0.11; plat.receiveShadow = true; S.add(plat);
    // parapet ring at the back (black & white bands, the hill-road look)
    const parTex = canvasTexture(256, 32, (ctx, w, h) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#111' : '#f2f2f2'; ctx.fillRect(i * 32, 0, 32, h); } }, { repeat: [10, 1] });
    const par = new THREE.Mesh(new THREE.CylinderGeometry(7.6, 7.6, 0.7, 64, 1, true, Math.PI * 0.62, Math.PI * 0.76), new THREE.MeshStandardMaterial({ map: parTex, roughness: 0.8, side: THREE.DoubleSide }));
    par.position.y = 0.35; par.rotation.y = Math.PI; par.castShadow = true; par.receiveShadow = true; S.add(par);
    // layered mountains + snow peaks
    const noise = createNoise2D(77);
    const ridge = (dist, height, color, seed, width = 2600, segs = 160) => {
      const pos = [], idx = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs; const x = (t - 0.5) * width;
        const h = height * (0.35 + ridged(noise, x / (width * 0.18) + seed, seed, 4) * 0.75);
        pos.push(x, -20, -dist, x, h, -dist);
      }
      for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false })); S.add(m); return m;
    };
    const snow = (() => {
      const pos = [], col = [], idx = []; const segs = 200, width = 5200, dist = 1500;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs; const x = (t - 0.5) * width;
        const peak = 1 + 1.4 * Math.exp(-(((x + 300) / 500) ** 2)) + 1.1 * Math.exp(-(((x - 900) / 380) ** 2));
        const h = 260 * peak * (0.45 + ridged(noise, x / 700, 9.1, 5) * 0.7);
        pos.push(x, 40, -dist, x, h, -dist);
        col.push(0.55, 0.6, 0.75, 1.0, 0.86, 0.8);
      }
      for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })); S.add(m); return m;
    })();
    ridge(900, 150, 0x8a96bb, 2.3); ridge(560, 85, 0x63739a, 5.1); ridge(330, 38, 0x46566a, 8.7); ridge(190, 13, 0x2f3d33, 1.9, 1600);
    // trees around (instanced from vegetation templates if available)
    try {
      const veg = this.models.veg;
      if (veg?.getTreeTemplate) {
        const rng = makeRng(11); const dummy = new THREE.Object3D();
        for (const [kind, n] of [['deodar', 18], ['pine', 12], ['bush', 16]]) {
          const tpl = veg.getTreeTemplate(kind, 'high'); const mesh = new THREE.InstancedMesh(tpl.geometry, tpl.material, n);
          for (let i = 0; i < n; i++) {
            const side = rng() < 0.5 ? -1 : 1; const x = side * (8.5 + rng() * 30); const z = -6 - rng() * 45 + Math.abs(x) * 0.3;
            dummy.position.set(x, 0, z); dummy.rotation.y = rng() * 6.28; dummy.scale.setScalar(kind === 'bush' ? 0.8 + rng() * 0.6 : 0.6 + rng() * 0.5); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
          }
          mesh.castShadow = true; mesh.receiveShadow = true; S.add(mesh);
        }
        this.vegUpdate = veg.updateVegetation;
      }
      const props = this.models.props;
      if (props?.createMilestone) { const ms = props.createMilestone({ place: 'RANIKHET', km: 95, kind: 'nh' }); ms.position.set(3.4, 0, 0.6); ms.rotation.y = -0.5; ms.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); S.add(ms); }
    } catch (e) { console.warn('lobby props', e); }
    // floating dust motes
    const N = 160, p = new Float32Array(N * 3), r = makeRng(3);
    for (let i = 0; i < N; i++) { p[i * 3] = (r() - 0.5) * 14; p[i * 3 + 1] = r() * 4; p[i * 3 + 2] = (r() - 0.5) * 8; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const dotTex = canvasTexture(32, 32, (ctx, w, h) => { const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,230,180,1)'); g.addColorStop(1, 'rgba(255,230,180,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, { wrap: false });
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.05, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
    S.add(this.motes);
    // character setups
    for (const c of CHARACTERS) this.setups.push(this.makeSetup(c));
    this.setups.forEach((st, i) => { st.group.visible = i === 0; S.add(st.group); });
  }

  makeSetup(c) {
    const group = new THREE.Group();
    let rider = null, bike = null;
    try {
      bike = this.models.bikes.createBike(c.bike);
      bike.group.position.set(0.75, 0, -2.1); bike.group.rotation.y = -0.62;
      bike.setParked?.(true);
      group.add(bike.group);
      if (this.models.riders.createHelmet && bike.anchors?.helmetRest) {
        const h = this.models.riders.createHelmet(c.id); h.position.copy(bike.anchors.helmetRest); h.rotation.y = 0.4; bike.group.add(h);
      }
    } catch (e) { console.warn('lobby bike', e); }
    try {
      rider = this.models.riders.createRider(c.id); rider.setPose?.('stand'); rider.setHelmet?.(false);
      rider.group.position.set(-0.1, 0, 0.55); rider.group.rotation.y = 0.12;
      group.add(rider.group);
    } catch (e) { console.warn('lobby rider', e); }
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { c, group, rider, bike };
  }

  /** switch to character index with slide animation (dir = +1 next / -1 prev) */
  select(i, dir = 1) {
    if (i === this.index && !this.anim) return;
    const from = this.setups[this.index], to = this.setups[i];
    this.anim = { t: 0, from, to, dir };
    to.group.visible = true; to.group.position.x = dir * 7;
    this.index = i;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(dt) {
    this.time += dt; const t = this.time;
    if (this.anim) {
      const a = this.anim; a.t += dt;
      const k1 = ease(Math.min(1, a.t / 0.32)), k2 = ease(Math.min(1, Math.max(0, a.t - 0.08) / 0.5));
      if (a.from !== a.to) a.from.group.position.x = -a.dir * 7 * k1;
      a.to.group.position.x = a.dir * 7 * (1 - k2);
      if (a.t > 0.6) { if (a.from !== a.to) a.from.group.visible = false; a.from.group.position.x = 0; a.to.group.position.x = 0; this.anim = null; }
    }
    for (const st of this.setups) if (st.group.visible) { st.rider?.update?.(dt, t, { speed: 0, lean: 0, throttle: 0, brake: 0, steer: 0 }); st.bike?.update?.(dt, t, { speed: 0, steer: 0, brake: 0, throttle: 0 }); }
    this.vegUpdate?.(t);
    // camera breathing
    const cam = this.camera;
    cam.position.set(this.camBase.x + Math.sin(t * 0.25) * 0.12, this.camBase.y + Math.sin(t * 0.4) * 0.03, this.camBase.z);
    cam.lookAt(this.camLook);
    const pa = this.motes.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) { let y = pa.getY(i) + dt * 0.08; if (y > 4) y = 0; pa.setY(i, y); pa.setX(i, pa.getX(i) + Math.sin(t + i) * dt * 0.05); }
    pa.needsUpdate = true;
    if (this.sky.material.uniforms.time) this.sky.material.uniforms.time.value = t;
  }

  render() {
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
  }

  /** loading-screen backdrop: no riders, slow crane over the snowy range */
  renderBackdrop(dt) {
    this.time += dt; const t = this.time;
    for (const st of this.setups) st.group.visible = false;
    const cam = this.camera;
    cam.position.set(Math.sin(t * 0.05) * 6, 2.4 + Math.sin(t * 0.11) * 0.3, 7.5);
    cam.lookAt(0, 26, -400);
    this.vegUpdate?.(t);
    if (this.sky.material.uniforms.time) this.sky.material.uniforms.time.value = t;
    this.render();
  }
  showSetups() { this.setups.forEach((s, i) => s.group.visible = i === this.index); }
}

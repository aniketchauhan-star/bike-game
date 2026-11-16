// Atmosphere: Preetham sky with clouds, sun + hemisphere lights, time-of-day, directional fog,
// environment map, and a background pass with distant ridges + the snowy Himalaya.
import * as THREE from 'three';
import { Sky } from 'three/addons/Sky.js';
import { clamp, lerp, smoothstep, createNoise2D, ridged, fbm } from '../core/util.js';
import { waterUniforms } from './water.js';

export const TOD = {
  morning: { elev: 13, azim: 105, turbidity: 5.5, rayleigh: 1.9, mie: 0.006, mieG: 0.86, sun: 0xffd2a0, sunI: 3.1, hemiI: 1.1, exposure: 0.62, clouds: 0.32, ground: 0x5d4f3a },
  day:     { elev: 56, azim: 165, turbidity: 2.6, rayleigh: 1.25, mie: 0.004, mieG: 0.82, sun: 0xfff3e2, sunI: 3.6, hemiI: 1.0, exposure: 0.52, clouds: 0.38, ground: 0x5b5a40 },
  evening: { elev: 6.5, azim: 262, turbidity: 8.5, rayleigh: 2.9, mie: 0.008, mieG: 0.9, sun: 0xff9a52, sunI: 2.7, hemiI: 1.0, exposure: 0.66, clouds: 0.42, ground: 0x4f3e30 },
};

// ---- JS port of the Sky shader (no clouds / disc) to derive fog & ambient colours
const totalRayleigh = [5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5];
const MieConst = [1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14];
function skyColor(dir, sunDir, p) {
  const EE = 1000, cutoff = 1.6110731556870734, steep = 1.5;
  const sunE = EE * Math.max(0, 1 - Math.exp(-((cutoff - Math.acos(clamp(sunDir.y, -1, 1))) / steep)));
  const betaR = totalRayleigh.map(v => v * (p.rayleigh - 0));
  const c = (0.2 * p.turbidity) * 10E-18;
  const betaM = MieConst.map(v => 0.434 * c * v * p.mie);
  const zen = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zen) + 0.15 * Math.pow(93.885 - (zen * 180) / Math.PI, -1.253));
  const sR = 8.4E3 * inv, sM = 1.25E3 * inv;
  const cosT = dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z;
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g = p.mieG, g2 = g * g; const mPhase = (1 / (4 * Math.PI)) * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
  const out = [0, 0, 0];
  const mixF = clamp(Math.pow(1 - sunDir.y, 5), 0, 1);
  for (let k = 0; k < 3; k++) {
    const Fex = Math.exp(-(betaR[k] * sR + betaM[k] * sM));
    const ratio = (betaR[k] * rPhase + betaM[k] * mPhase) / (betaR[k] + betaM[k]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    Lin *= lerp(1, Math.pow(sunE * ratio * Fex, 0.5), mixF);
    const L0 = 0.1 * Fex;
    out[k] = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][k];
  }
  return out;
}
function aces(rgb, exposure) {
  let [r, g, b] = rgb.map(v => v * exposure / 0.6);
  const i0 = 0.59719 * r + 0.35458 * g + 0.04823 * b, i1 = 0.07600 * r + 0.90834 * g + 0.01566 * b, i2 = 0.02840 * r + 0.13383 * g + 0.83777 * b;
  const fit = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const a0 = fit(i0), a1 = fit(i1), a2 = fit(i2);
  return [clamp(1.60475 * a0 - 0.53108 * a1 - 0.07367 * a2, 0, 1), clamp(-0.10208 * a0 + 1.10813 * a1 - 0.00605 * a2, 0, 1), clamp(-0.00327 * a0 - 0.07276 * a1 + 1.07602 * a2, 0, 1)];
}

// Directional (sun-scatter) fog for all lit materials. Must run before any material compiles.
let fogPatched = false;
export function patchFogChunk() {
  if (fogPatched) return; fogPatched = true;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 fogCol = fogColor;
  #if ( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) ) && NUM_DIR_LIGHTS > 0
    vec3 fvd = normalize( -vViewPosition );
    float fsun = pow( max( dot( fvd, directionalLights[ 0 ].direction ), 0.0 ), 6.0 );
    vec3 fsc = directionalLights[ 0 ].color; fsc /= max( 0.001, max( fsc.r, max( fsc.g, fsc.b ) ) );
    fsc = pow( fsc, vec3( 0.4545 ) );
    fogCol = mix( fogColor, fogColor * 0.5 + fsc * 0.62, fsun * 0.75 );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
}

export class Atmosphere {
  constructor(renderer, quality) {
    this.renderer = renderer; this.quality = quality;
    this.bgScene = new THREE.Scene();
    this.bgCamera = new THREE.PerspectiveCamera(60, 16 / 9, 30, 160000);
    this.sky = new Sky(); this.sky.scale.setScalar(100000); this.bgScene.add(this.sky);
    this.envSky = new Sky(); this.envSky.scale.setScalar(50); this.envScene = new THREE.Scene(); this.envScene.add(this.envSky);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    // lights for main scene
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = !!quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      const S = quality.shadowSize >= 2048 ? 42 : 30;
      Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
      this.sun.shadow.bias = -0.00035; this.sun.shadow.normalBias = 0.035;
      this.shadowExtent = S;
    }
    this.hemi = new THREE.HemisphereLight(0xbcd2ff, 0x5a4a35, 1);
    this.fog = new THREE.FogExp2(0xc8d4e0, 0.0006);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTex = null;
    this._buildFarLand();
  }

  /** add lights + fog to a main scene */
  attach(scene) {
    scene.add(this.sun); scene.add(this.sun.target); scene.add(this.hemi);
    scene.fog = this.fog;
    this.scene = scene;
  }

  setViewDistance(far) {
    this.viewFar = far;
    this.fog.density = Math.sqrt(-Math.log(0.075)) / far; // a little clearer air (Himalayan views!)
  }

  setTimeOfDay(id) {
    const p = TOD[id] || TOD.morning; this.tod = p; this.todId = id;
    const el = THREE.MathUtils.degToRad(p.elev), az = THREE.MathUtils.degToRad(p.azim);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(this.sunDir); u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = p.mieG;
      if (u.cloudCoverage) { u.cloudCoverage.value = p.clouds; u.cloudDensity.value = 0.45; u.cloudElevation.value = 0.55; u.cloudScale.value = 0.00022; u.cloudSpeed.value = 0.000012; }
    }
    if (this.quality.bakeSky) this.bakeSky();
    this.envSky.material.uniforms.cloudCoverage && (this.envSky.material.uniforms.cloudCoverage.value = p.clouds * 0.6);
    this.renderer.toneMappingExposure = p.exposure;
    // lights
    this.sun.color.set(p.sun); this.sun.intensity = p.sunI;
    // derive colours from the sky model
    const hz = [0, 0, 0], hzAnti = [0, 0, 0]; const d = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2; d.set(Math.cos(a), 0.035, Math.sin(a)).normalize();
      const c = skyColor(d, this.sunDir, p); for (let k = 0; k < 3; k++) hz[k] += c[k] / 12;
    }
    const anti = new THREE.Vector3(-this.sunDir.x, 0.04, -this.sunDir.z).normalize(); const ca = skyColor(anti, this.sunDir, p);
    for (let k = 0; k < 3; k++) hzAnti[k] = ca[k] * 0.6 + hz[k] * 0.4;
    const zen = skyColor(new THREE.Vector3(0, 1, 0), this.sunDir, p);
    this._dbg = { hz, hzAnti, zen };
    const fogTM = aces(hzAnti, p.exposure);
    // slight haze desaturation toward grey-blue
    this.fog.color.setRGB(lerp(fogTM[0], 0.78, 0.12), lerp(fogTM[1], 0.8, 0.12), lerp(fogTM[2], 0.84, 0.12));
    // hemisphere sky colour: normalised zenith tint
    const zm = Math.max(...zen); this.hemi.color.setRGB(zen[0] / zm * 0.8 + 0.2, zen[1] / zm * 0.8 + 0.2, zen[2] / zm * 0.8 + 0.2);
    this.hemi.groundColor.set(p.ground); this.hemi.intensity = p.hemiI;
    // water uniforms (HDR linear values, water shader tone-maps itself)
    waterUniforms.uSunDir.value.copy(this.sunDir);
    waterUniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(p.sunI * 0.55);
    waterUniforms.uSkyTop.value.setRGB(zen[0], zen[1], zen[2]);
    waterUniforms.uSkyHorizon.value.setRGB(hz[0], hz[1], hz[2]);
    waterUniforms.uAmbient.value.copy(this.hemi.color).multiplyScalar(p.hemiI * 0.55);
    // far land colours
    if (this.farMat) {
      this.farMat.uniforms.uSunDir.value.copy(this.sunDir);
      this.farMat.uniforms.uSunColor.value.copy(this.sun.color).multiplyScalar(p.sunI * 0.32);
      this.farMat.uniforms.uAmbient.value.copy(this.hemi.color).multiplyScalar(0.22 * p.hemiI);
      this.farMat.uniforms.uHaze.value.setRGB(hzAnti[0] * 0.85 + hz[0] * 0.15, hzAnti[1] * 0.85 + hz[1] * 0.15, hzAnti[2] * 0.85 + hz[2] * 0.15);
    }
    // environment map from the sky
    if (this.envTex) this.envTex.dispose();
    this.envTex = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200).texture;
    return this.envTex;
  }

  /** per frame: sync background camera, move shadow frustum with the focus point */
  update(camera, focus, time) {
    const bc = this.bgCamera;
    bc.position.copy(camera.position); bc.quaternion.copy(camera.quaternion);
    if (bc.fov !== camera.fov || bc.aspect !== camera.aspect) { bc.fov = camera.fov; bc.aspect = camera.aspect; bc.updateProjectionMatrix(); }
    this.sky.material.uniforms.time && (this.sky.material.uniforms.time.value = time);
    if (focus) {
      // shadow camera follows focus, snapped to texels to avoid shimmering
      const D = 160; const L = this.sun;
      const ext = this.shadowExtent || 30; const texel = (ext * 2) / (this.quality.shadowSize || 1024);
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      L.target.position.set(fx, focus.y, fz);
      L.position.set(fx + this.sunDir.x * D, focus.y + Math.max(0.25, this.sunDir.y) * D, fz + this.sunDir.z * D);
      L.target.updateMatrixWorld();
    }
  }

  /** render the sky once into a cube texture and use it as the background (phones) */
  bakeSky() {
    if (!this.skyRT) {
      this.skyRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
      this.skyCam = new THREE.CubeCamera(0.1, 1000, this.skyRT);
    }
    this.skyCam.update(this.renderer, this.envScene);
    this.bgScene.background = this.skyRT.texture;
    this.sky.visible = false;
  }

  renderBackground(renderer) {
    renderer.render(this.bgScene, this.bgCamera);
  }

  // --------------------------------------------------------------- distant land: ridge rings + Himalaya
  _buildFarLand() {
    const noise = createNoise2D(2024), n2 = createNoise2D(99);
    this.farMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: new THREE.Color(0.3, 0.35, 0.4) }, uHaze: { value: new THREE.Color(0.7, 0.75, 0.8) },
      },
      vertexShader: /* glsl */`
        attribute float snowy; attribute vec3 tint;
        varying vec3 vN; varying vec3 vW; varying float vSnow; varying vec3 vTint;
        void main() { vN = normalize(normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vSnow = snowy; vTint = tint;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir, uSunColor, uAmbient, uHaze;
        varying vec3 vN; varying vec3 vW; varying float vSnow; varying vec3 vTint;
        void main() {
          vec3 n = normalize(vN);
          float snowLine = mix(3200.0, 3400.0, vSnow);
          float snow = smoothstep(snowLine - 500.0, snowLine + 400.0, vW.y + (n.y - 0.5) * 900.0) * smoothstep(0.2, 0.65, n.y + 0.15) * vSnow;
          vec3 rock = vTint;
          vec3 alb = mix(rock, vec3(0.78, 0.8, 0.86), snow);
          float diff = max(dot(n, uSunDir), 0.0);
          vec3 col = alb * (uAmbient * 0.9 + uSunColor * diff * 0.8);
          float dist = length(vW - cameraPosition);
          float haze = 1.0 - exp(-dist * mix(0.00007, 0.000046, vSnow));
          haze *= mix(1.0, 0.8, smoothstep(3000.0, 7000.0, vW.y));
          vec3 hz = mix(uHaze, uHaze * vec3(0.82, 0.9, 1.08), 0.5);
          col = mix(col, hz, clamp(haze, 0.0, 0.96));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const T0 = new THREE.Vector3(-700, 0, -1600); // approx centre of the play area
    const makeRing = (r0, r1, hMin, hMax, segA, segR, snowy, tint, seed) => {
      const pos = [], idx = [], sn = [], tn = [];
      const c = new THREE.Color(tint);
      for (let j = 0; j <= segR; j++) {
        const t = j / segR; const r = lerp(r0, r1, t);
        for (let i = 0; i <= segA; i++) {
          const a = (i / segA) * Math.PI * 2; const x = T0.x + Math.cos(a) * r, z = T0.z + Math.sin(a) * r;
          const north = smoothstep(0.2, 1.0, -Math.sin(a)); // -z side = north (Himalaya side)
          let h = (ridged(noise, x / 6000 + seed, z / 6000, 5) * 0.75 + (fbm(n2, x / 2500, z / 2500, 3) * 0.5 + 0.5) * 0.25);
          h = lerp(hMin, hMax, h) * (0.7 + north * 0.6) * Math.sin(t * Math.PI) ** 0.6;
          pos.push(x, h - 40, z); sn.push(snowy * north); tn.push(c.r * (0.85 + Math.random() * 0.15), c.g, c.b);
        }
      }
      const row = segA + 1;
      for (let j = 0; j < segR; j++) for (let i = 0; i < segA; i++) { const a = j * row + i, b = a + 1, cc = a + row, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('snowy', new THREE.Float32BufferAttribute(sn, 1));
      g.setAttribute('tint', new THREE.Float32BufferAttribute(tn, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.farMat); m.frustumCulled = false; this.bgScene.add(m); return m;
    };
    makeRing(5200, 13000, 120, 950, 160, 14, 0, 0x2f3d2c, 0);
    makeRing(12000, 26000, 300, 1800, 140, 10, 0.3, 0x3a4236, 3.1);
    // the great Himalaya: a long snowy range to the north
    {
      const pos = [], idx = [], sn = [], tn = [];
      const W = 150000, D = 26000, nx = 260, nz = 34; const zc = T0.z - 52000;
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const x = T0.x + (i / nx - 0.5) * W, z = zc + (j / nz - 0.5) * D;
        const prof = Math.sin((j / nz) * Math.PI) ** 0.8;
        // a few named massifs: Trishul / Nanda Devi / Panchachuli feel
        const peaks = 1.6 * Math.exp(-(((x - T0.x + 6000) / 9000) ** 2)) + 1.9 * Math.exp(-(((x - T0.x - 14000) / 7000) ** 2)) + 1.3 * Math.exp(-(((x - T0.x - 36000) / 9000) ** 2));
        let h = ridged(noise, x / 15000, z / 12000, 4) * 0.85 + fbm(n2, x / 5000, z / 5000, 3) * 0.12 + 0.15;
        h = (900 + h * 3600 + peaks * 2100) * prof;
        pos.push(x, h - 300, z); sn.push(1); tn.push(0.32, 0.31, 0.33);
      }
      const row = nx + 1;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * row + i, b = a + 1, c = a + row, d = c + 1; idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('snowy', new THREE.Float32BufferAttribute(sn, 1));
      g.setAttribute('tint', new THREE.Float32BufferAttribute(tn, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.farMat); m.frustumCulled = false; this.bgScene.add(m);
    }
  }
}

// River / stream water surfaces (flowing normal-mapped shader), waterfall and spray particles.
import * as THREE from 'three';
import { clamp, smoothstep, makeRng, canvasTexture } from '../core/util.js';
import { waterNormalTexture, foamTexture } from './textures.js';

export const waterUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
  uSkyTop: { value: new THREE.Color(0.25, 0.45, 0.8) },
  uSkyHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
  uAmbient: { value: new THREE.Color(0.4, 0.45, 0.5) },
};

export function waterMaterial({ deep = 0x0d3b3a, shallow = 0x3f6f5c, flowSpeed = 1, foamAmt = 1 } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    tNormal: { value: waterNormalTexture() }, tFoam: { value: foamTexture() },
    uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(shallow) },
    uFlow: { value: flowSpeed }, uFoamAmt: { value: foamAmt },
  }]);
  // share global uniforms by reference
  for (const k of Object.keys(waterUniforms)) uniforms[k] = waterUniforms[k];
  return new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float rapid;
      varying vec2 vUv; varying vec3 vWPos; varying float vRapid;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv; vRapid = rapid;
        vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tNormal, tFoam; uniform float uTime, uFlow, uFoamAmt;
      uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uAmbient, uDeep, uShallow;
      varying vec2 vUv; varying vec3 vWPos; varying float vRapid;
      #include <fog_pars_fragment>
      void main() {
        float t = uTime * uFlow;
        float sp = 0.55 + vRapid * 1.6;
        vec2 uv1 = vec2(vUv.x * 1.7, vUv.y * 0.35 + t * 0.32 * sp);
        vec2 uv2 = vec2(vUv.x * 3.1 + 0.37, vUv.y * 0.62 + t * 0.55 * sp);
        vec2 uv3 = vec2(vWPos.x * 0.06, vWPos.z * 0.06) + vec2(t * 0.02, -t * 0.015);
        vec3 n1 = texture2D(tNormal, uv1).xzy * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, uv2).xzy * 2.0 - 1.0;
        vec3 n3 = texture2D(tNormal, uv3).xzy * 2.0 - 1.0;
        float rough = 0.35 + vRapid * 0.9;
        vec3 n = normalize(vec3((n1.x + n2.x * 0.8 + n3.x * 0.5) * rough, 1.0, (n1.z + n2.z * 0.8 + n3.z * 0.5) * rough));
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 R = reflect(-V, n);
        float fres = 0.03 + 0.62 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);
        vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.6));
        // depth fake: across-river profile
        float edge = min(vUv.x, 1.0 - vUv.x) * 2.0;
        float depth = smoothstep(0.0, 0.7, edge);
        vec3 body = mix(uShallow, uDeep, depth) * (uAmbient * 1.25 + uSunColor * max(uSunDir.y, 0.0) * 0.7);
        vec3 col = mix(body, sky * 0.5, fres * 0.85);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.0), 220.0) * 3.5 + pow(max(dot(n, H), 0.0), 40.0) * 0.18;
        col += uSunColor * spec;
        // foam: banks, rapids, streaks
        float f1 = texture2D(tFoam, vec2(vUv.x * 2.2, vUv.y * 0.25 + t * 0.45 * sp)).r;
        float f2 = texture2D(tFoam, vec2(vUv.x * 4.0 + 0.5, vUv.y * 0.5 + t * 0.8 * sp)).r;
        float foamMask = (1.0 - smoothstep(0.0, 0.16, edge)) * 0.45 + vRapid * 0.75;
        float foam = smoothstep(0.62, 0.95, f1 * f2 * 1.5 + foamMask * 0.45) * uFoamAmt * clamp(foamMask + 0.1, 0.0, 1.0);
        col = mix(col, vec3(0.92, 0.95, 0.95) * (uAmbient + uSunColor * 0.6), clamp(foam, 0.0, 0.85));
        float alpha = smoothstep(0.0, 0.12, edge) * 0.93 + foam * 0.05;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** ribbon mesh along a Polyline from river.js */
export function createRiverMesh(line, { widen = 1.12, segsAcross = 8, deep, shallow, foam = 1 } = {}) {
  const pts = line.pts; const n = pts.length;
  const pos = [], uv = [], rap = [], idx = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]; const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const rx = -dz, rz = dx; // perpendicular
    const w = p.w * widen;
    const slope = Math.abs(b.y - a.y) / (Math.hypot(b.x - a.x, b.z - a.z) || 1);
    const rapid = clamp(slope * 11 - 0.22, 0, 1);
    for (let k = 0; k <= segsAcross; k++) {
      const u = k / segsAcross; const off = (u - 0.5) * 2 * w;
      pos.push(p.x + rx * off, p.y, p.z + rz * off); uv.push(u, line.len[i] / 10); rap.push(rapid);
    }
  }
  const row = segsAcross + 1;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < segsAcross; k++) {
    const a = i * row + k, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('rapid', new THREE.Float32BufferAttribute(rap, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, waterMaterial({ deep, shallow, foamAmt: foam }));
  mesh.renderOrder = 2; mesh.frustumCulled = true;
  return mesh;
}

/** waterfall: curved sheet from top to base with fast scrolling streaks, plus spray */
export function createWaterfall(wf) {
  const group = new THREE.Group();
  const segsV = 18, segsH = 6, width = 6.5;
  const pos = [], uv = [], idx = [];
  const top = wf.top, base = wf.base; const r = wf.forward; // sheet spans along road direction (forward)
  for (let j = 0; j <= segsV; j++) {
    const t = j / segsV;
    // ease: falls steeply then curves at bottom
    const px = top.x + (base.x - top.x) * (t * t * 0.4 + t * 0.6);
    const pz = top.z + (base.z - top.z) * (t * t * 0.4 + t * 0.6);
    const py = top.y + (base.y - top.y) * t;
    for (let i = 0; i <= segsH; i++) {
      const u = i / segsH; const w = (u - 0.5) * width * (0.8 + t * 0.45);
      pos.push(px + r.x * w, py, pz + r.z * w); uv.push(u, t);
    }
  }
  for (let j = 0; j < segsV; j++) for (let i = 0; i < segsH; i++) { const a = j * (segsH + 1) + i, b = a + 1, c = a + segsH + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tFoam: { value: foamTexture() }, uTime: waterUniforms.uTime, uSunColor: waterUniforms.uSunColor, uAmbient: waterUniforms.uAmbient }]),
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){
        vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D tFoam; uniform float uTime; uniform vec3 uSunColor, uAmbient; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main(){
        float s1 = texture2D(tFoam, vec2(vUv.x * 1.6, vUv.y * 1.2 - uTime * 1.9)).r;
        float s2 = texture2D(tFoam, vec2(vUv.x * 3.1 + 0.3, vUv.y * 2.0 - uTime * 2.7)).r;
        float streak = smoothstep(0.25, 0.85, s1 * 0.6 + s2 * 0.6);
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        vec3 c = mix(vec3(0.55, 0.66, 0.68), vec3(0.97), streak) * (uAmbient * 0.8 + uSunColor * 0.55);
        float a = edge * (0.45 + streak * 0.5) * smoothstep(0.0, 0.05, vUv.y);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const sheet = new THREE.Mesh(g, mat); sheet.renderOrder = 3; group.add(sheet);
  // spray particles
  const spray = createSpray(base, 160, 4.5);
  group.add(spray.points);
  group.userData.update = (dt, t) => spray.update(dt, t);
  return group;
}

function sprayTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: false });
}

export function createSpray(center, count = 120, radius = 4) {
  const rng = makeRng(99);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) { seed[i] = rng(); pos[i * 3] = center.x; pos[i * 3 + 1] = center.y; pos[i * 3 + 2] = center.z; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: waterUniforms.uTime, tex: { value: sprayTexture() }, uCenter: { value: center.clone() }, uRadius: { value: radius }, uColor: waterUniforms.uSunColor },
    transparent: true, depthWrite: false,
    vertexShader: `attribute float seed; uniform float uTime, uRadius; uniform vec3 uCenter; varying float vA;
      void main(){
        float life = fract(uTime * (0.35 + seed * 0.3) + seed * 7.0);
        float ang = seed * 61.0; float r = uRadius * (0.2 + life * (0.6 + fract(seed * 13.0) * 0.6));
        vec3 p = uCenter + vec3(cos(ang) * r, life * (2.5 + seed * 3.5) - life * life * 1.5, sin(ang) * r);
        vA = (1.0 - life) * smoothstep(0.0, 0.1, life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (180.0 + seed * 220.0) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D tex; uniform vec3 uColor; varying float vA;
      void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(mix(vec3(0.85), uColor, 0.3), t.a * vA * 0.55); }`,
  });
  const points = new THREE.Points(g, mat); points.frustumCulled = false; points.renderOrder = 4;
  return { points, update() {} };
}

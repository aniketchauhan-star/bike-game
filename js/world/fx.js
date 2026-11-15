// Lightweight particle effects (one Points draw call): crash sparks, dust, water splash, smoke.
import * as THREE from 'three';
import { canvasTexture } from '../core/util.js';

const MAX = 600;
const TYPES = {
  spark:  { color: [1.0, 0.78, 0.3], size: 0.12, life: 0.45, grav: 9.8, drag: 1.5, grow: -0.6, add: 1 },
  dust:   { color: [0.55, 0.45, 0.32], size: 0.9, life: 1.4, grav: -0.3, drag: 2.2, grow: 1.8, add: 0 },
  splash: { color: [0.85, 0.92, 0.95], size: 0.5, life: 1.1, grav: 9.8, drag: 0.6, grow: 0.9, add: 0 },
  smoke:  { color: [0.5, 0.5, 0.52], size: 1.2, life: 2.2, grav: -0.6, drag: 1.2, grow: 1.4, add: 0 },
  leaf:   { color: [0.35, 0.45, 0.18], size: 0.18, life: 1.6, grav: 2.0, drag: 2.5, grow: 0, add: 0 },
};

export class FX {
  constructor(scene) {
    this.p = []; // particle objects
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 4); this.size = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const tex = canvasTexture(64, 64, (ctx, w, h) => {
      const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    }, { wrap: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: tex }, scale: { value: 600 } }, transparent: true, depthWrite: false,
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D tex; varying vec4 vC; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** emit n particles of type at pos with base velocity vel and random spread */
  burst(type, pos, n = 10, vel = null, spread = 3) {
    const T = TYPES[type]; if (!T) return;
    for (let i = 0; i < n; i++) {
      if (this.p.length >= MAX) this.p.shift();
      const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread * 0.8, (Math.random() - 0.5) * spread);
      if (vel) v.add(vel);
      this.p.push({ t: T, x: pos.x + (Math.random() - 0.5) * 0.3, y: pos.y + Math.random() * 0.2, z: pos.z + (Math.random() - 0.5) * 0.3, v, age: 0, life: T.life * (0.6 + Math.random() * 0.8), s: T.size * (0.7 + Math.random() * 0.6) });
    }
  }

  update(dt) {
    const P = this.p; let w = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i]; q.age += dt; if (q.age >= q.life) continue;
      const T = q.t; const k = Math.exp(-T.drag * dt);
      q.v.x *= k; q.v.z *= k; q.v.y = q.v.y * k - T.grav * dt;
      q.x += q.v.x * dt; q.y += q.v.y * dt; q.z += q.v.z * dt;
      const a = 1 - q.age / q.life;
      this.pos[w * 3] = q.x; this.pos[w * 3 + 1] = q.y; this.pos[w * 3 + 2] = q.z;
      this.col[w * 4] = T.color[0]; this.col[w * 4 + 1] = T.color[1]; this.col[w * 4 + 2] = T.color[2]; this.col[w * 4 + 3] = a * (T.add ? 1 : 0.7);
      this.size[w] = Math.max(0.02, q.s * (1 + T.grow * q.age));
      P[w] = q; w++;
    }
    P.length = w;
    const g = this.points.geometry; g.setDrawRange(0, w);
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true;
  }
}

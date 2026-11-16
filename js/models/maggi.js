// Roadside Maggi stall (tin roof, counter, gas stove + patila, hanging Maggi packets, stools), a GTA-style floating
// location marker, and the props used in the Maggi-break cinematic (bowl of Maggi, fork, ladle) + steam.
import * as THREE from 'three';
import { canvasTexture, makeRng, bakeGroup, mergeSafe, colorize } from '../core/util.js';

const cache = {};
const once = (k, f) => (cache[k] || (cache[k] = f()));
const HI = '"Noto Sans Devanagari","Kohinoor Devanagari",sans-serif';

// ------------------------------------------------------------------ materials / textures
const mats = () => once('mats', () => ({
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.85 }),
  darkWood: new THREE.MeshStandardMaterial({ color: 0x4e3320, roughness: 0.9 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 }),
  black: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6, metalness: 0.3 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x8b8a86, roughness: 0.95 }),
  vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
  roof: new THREE.MeshStandardMaterial({ map: roofTex(), roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide }),
  counter: new THREE.MeshStandardMaterial({ map: counterTex(), roughness: 0.7 }),
  sign: new THREE.MeshStandardMaterial({ map: signTex(), roughness: 0.6, emissive: 0x332200, emissiveIntensity: 0.25 }),
  packet: new THREE.MeshStandardMaterial({ map: packetTex(), roughness: 0.5 }),
  steel: new THREE.MeshPhysicalMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.18, clearcoat: 0.4 }),
  noodles: new THREE.MeshStandardMaterial({ map: noodleTex(), roughness: 0.55 }),
}));

function roofTex() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3f6f7a'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { const g = ctx.createLinearGradient(x, 0, x + 16, 0); g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(0.5, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(255,255,255,.18)'); ctx.fillStyle = g; ctx.fillRect(x, 0, 16, h); }
    const r = makeRng(4); for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(${120 + r() * 60},${60 + r() * 30},20,${0.15 + r() * 0.35})`; ctx.beginPath(); ctx.ellipse(r() * w, r() * h, 3 + r() * 14, 2 + r() * 7, r() * 3, 0, 7); ctx.fill(); }
  }, { repeat: [2, 1] });
}
function counterTex() {
  return canvasTexture(512, 192, (ctx, w, h) => {
    ctx.fillStyle = '#ffd21f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e31b23'; ctx.fillRect(0, h - 26, w, 26); ctx.fillRect(0, 0, w, 12);
    ctx.fillStyle = '#e31b23'; ctx.font = 'bold 92px Teko, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('MAGGI', w * 0.38, h * 0.48);
    ctx.fillStyle = '#7a1206'; ctx.font = `bold 46px ${HI}`; ctx.fillText('मैगी', w * 0.78, h * 0.36);
    ctx.font = 'bold 40px Teko, sans-serif'; ctx.fillText('₹40', w * 0.78, h * 0.68);
  }, { wrap: false, anisotropy: 8 });
}
function signTex() {
  return canvasTexture(768, 160, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#ffe14d'); g.addColorStop(1, '#f5b800'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c4161c'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = '#c4161c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 84px Teko, Impact, sans-serif'; ctx.fillText('MAGGI POINT', w * 0.42, h * 0.5);
    ctx.font = `bold 40px ${HI}`; ctx.fillStyle = '#5a1004'; ctx.fillText('मैगी • चाय', w * 0.84, h * 0.5);
  }, { wrap: false, anisotropy: 8 });
}
function packetTex() {
  return canvasTexture(64, 96, (ctx, w, h) => {
    ctx.fillStyle = '#ffcf00'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e31b23'; ctx.fillRect(0, h * 0.18, w, h * 0.3);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 20px Teko, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('MAGGI', w / 2, h * 0.33);
    ctx.fillStyle = '#d9a400'; ctx.beginPath(); ctx.ellipse(w / 2, h * 0.72, 20, 14, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#b88900'; ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(w / 2 + (i - 3) * 4, h * 0.72, 8, 0, Math.PI); ctx.stroke(); }
  }, { wrap: false });
}
function noodleTex() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#c98f1c'; ctx.fillRect(0, 0, w, h);
    const r = makeRng(9);
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = `rgb(${235 + r() * 20},${185 + r() * 40},${50 + r() * 40})`; ctx.lineWidth = 3 + r() * 2.5; ctx.beginPath();
      let x = r() * w, y = r() * h; ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; ctx.quadraticCurveTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 40; i++) { ctx.fillStyle = r() < 0.5 ? '#3f9b2f' : '#e0561b'; ctx.fillRect(r() * w, r() * h, 5 + r() * 5, 4 + r() * 4); } // matar / gajar
  }, { wrap: false });
}
function beamTexUnused() {
  return canvasTexture(16, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,214,60,0)'); g.addColorStop(0.65, 'rgba(255,214,60,.35)'); g.addColorStop(1, 'rgba(255,214,60,.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: false });
}
function markerTex(icon = '🍜', label = 'MAGGI', color = '#ffc61a') {
  return canvasTexture(256, 300, (ctx, w, h) => {
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 14;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(w / 2, 118, 96, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w / 2 - 34, 200); ctx.lineTo(w / 2 + 34, 200); ctx.lineTo(w / 2, 262); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#1a1200'; ctx.beginPath(); ctx.arc(w / 2, 118, 80, 0, Math.PI * 2); ctx.fill();
    ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, w / 2, 112);
    ctx.font = 'bold 40px Teko, Impact, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 6; ctx.strokeStyle = '#1a1200';
    ctx.strokeText(label, w / 2, 288); ctx.fillText(label, w / 2, 288);
  }, { wrap: false });
}

// ------------------------------------------------------------------ steam
export function createSteam({ count = 22, spread = 0.12, height = 0.9, size = 0.22 } = {}) {
  const tex = once('steamTex', () => canvasTexture(64, 64, (ctx, w, h) => { const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, { wrap: false }));
  const pos = new Float32Array(count * 3), seed = new Float32Array(count); const r = makeRng(7);
  for (let i = 0; i < count; i++) seed[i] = r();
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uAmt: { value: 1 }, tex: { value: tex }, uSpread: { value: spread }, uH: { value: height }, uSize: { value: size * 900 } },
    transparent: true, depthWrite: false,
    vertexShader: `attribute float seed; uniform float uT, uAmt, uSpread, uH, uSize; varying float vA;
      void main(){ float l = fract(uT * (0.35 + seed * 0.25) + seed * 9.0); float a = seed * 40.0;
        vec3 p = vec3(cos(a) * uSpread * (0.3 + l), l * uH, sin(a) * uSpread * (0.3 + l)) + vec3(sin(uT * 1.3 + seed * 6.0) * 0.05 * l, 0.0, 0.0);
        vA = (1.0 - l) * smoothstep(0.0, 0.15, l) * uAmt; vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.5 + l) / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D tex; varying float vA; void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vec3(0.97), t.a * vA * 0.6); }`,
  });
  const points = new THREE.Points(g, mat); points.frustumCulled = false; points.renderOrder = 6; points.userData.noMerge = true;
  return { points, set amount(v) { mat.uniforms.uAmt.value = v; }, update(dt, t) { mat.uniforms.uT.value = t; } };
}

// ------------------------------------------------------------------ props for the cinematic
export function createMaggiBowl() {
  const M = mats(); const g = new THREE.Group();
  const prof = [new THREE.Vector2(0, 0), new THREE.Vector2(0.045, 0), new THREE.Vector2(0.06, 0.012), new THREE.Vector2(0.078, 0.05), new THREE.Vector2(0.082, 0.062), new THREE.Vector2(0.076, 0.062), new THREE.Vector2(0.072, 0.05), new THREE.Vector2(0.054, 0.016), new THREE.Vector2(0, 0.016)];
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), M.steel); g.add(bowl);
  const top = new THREE.Mesh(new THREE.CircleGeometry(0.071, 28), M.noodles); top.rotation.x = -Math.PI / 2; top.position.y = 0.05; g.add(top);
  // a few loose noodle strands on top
  const strand = new THREE.TorusGeometry(0.03, 0.004, 5, 18, Math.PI * 1.4); const nm = new THREE.MeshStandardMaterial({ color: 0xf2c14b, roughness: 0.5 });
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(strand, nm); s.rotation.set(-Math.PI / 2 + 0.3, 0, i * 1.6); s.position.set(Math.cos(i * 1.9) * 0.025, 0.054, Math.sin(i * 1.9) * 0.025); g.add(s); }
  const steam = createSteam({ count: 12, spread: 0.035, height: 0.35, size: 0.08 }); steam.points.position.y = 0.06; g.add(steam.points);
  g.userData.update = (dt, t) => steam.update(dt, t);
  return g;
}
export function createFork() {
  const M = mats(); const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.12, 0.003), M.steel); handle.position.y = 0.06; g.add(handle);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.02, 0.003), M.steel); neck.position.y = 0.13; g.add(neck);
  for (let i = 0; i < 4; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.04, 0.0025), M.steel); t.position.set(-0.0065 + i * 0.0043, 0.16, 0); g.add(t); }
  // a twirl of noodles on the fork
  const tw = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.004, 5, 12), new THREE.MeshStandardMaterial({ color: 0xf2c14b, roughness: 0.5 })); tw.position.y = 0.165; tw.rotation.y = Math.PI / 2; g.add(tw);
  g.userData.noodles = tw;
  return g;
}
export function createLadle() {
  const M = mats(); const g = new THREE.Group();
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 8), M.steel); h.position.y = 0.17; g.add(h);
  const cup = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M.steel); cup.position.y = 0.34; cup.rotation.x = Math.PI; g.add(cup);
  return g;
}

// ------------------------------------------------------------------ the stall
/** facade (counter) faces +Z, origin at the base centre. Returns { group, update, potLocal, keeperLocal, seatLocal } */
export function createMaggiStall({ seed = 1 } = {}) {
  const M = mats(); const r = makeRng(seed);
  const root = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); root.add(m); return m; };
  // floor slab (deep, so it never floats on slopes)
  add(new THREE.BoxGeometry(3.6, 0.5, 2.8), M.concrete, 0, -0.17, 0);
  // posts + roof (slants to the back)
  const postG = new THREE.BoxGeometry(0.09, 1, 0.09);
  for (const [x, z, hgt] of [[-1.6, 1.25, 2.6], [1.6, 1.25, 2.6], [-1.6, -1.2, 2.3], [1.6, -1.2, 2.3]]) { const p = add(postG, M.darkWood, x, hgt / 2, z); p.scale.y = hgt; }
  const roofG = new THREE.BoxGeometry(4.0, 0.04, 3.1);
  add(roofG, M.roof, 0, 2.47, 0.05, -0.105, 0, 0);
  // back wall with shelves of Maggi packets
  add(new THREE.BoxGeometry(3.2, 2.2, 0.06), M.wood, 0, 1.1, -1.22);
  const shelfG = new THREE.BoxGeometry(3.0, 0.04, 0.32);
  for (const y of [1.15, 1.6]) {
    add(shelfG, M.darkWood, 0, y, -1.05);
    for (let i = 0; i < 16; i++) { const b = add(new THREE.BoxGeometry(0.11, 0.16, 0.04), M.packet, -1.35 + i * 0.18, y + 0.1, -1.0); b.rotation.y = (r() - 0.5) * 0.2; }
  }
  // counter with the yellow MAGGI front
  add(new THREE.BoxGeometry(2.9, 0.06, 0.62), M.darkWood, 0, 0.95, 0.78);
  add(new THREE.BoxGeometry(2.9, 0.92, 0.04), M.counter, 0, 0.46, 1.08);
  add(new THREE.BoxGeometry(2.9, 0.92, 0.5), M.wood, 0, 0.46, 0.8);
  // signboard above the front
  add(new THREE.BoxGeometry(3.3, 0.62, 0.05), M.sign, 0, 2.95, 1.3);
  add(new THREE.BoxGeometry(0.06, 0.5, 0.06), M.darkWood, -1.4, 2.62, 1.28); add(new THREE.BoxGeometry(0.06, 0.5, 0.06), M.darkWood, 1.4, 2.62, 1.28);
  // hanging Maggi packets on a string (very typical)
  for (let i = 0; i < 13; i++) { const x = -1.45 + i * 0.24; add(new THREE.BoxGeometry(0.12, 0.17, 0.02), M.packet, x, 2.1 - Math.sin(i / 12 * Math.PI) * 0.08, 1.24); }
  // gas stove + red LPG cylinder + patila on the stove
  add(new THREE.BoxGeometry(0.5, 0.1, 0.36), M.black, -0.7, 1.03, 0.72);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 14), new THREE.MeshStandardMaterial({ color: 0xb3161c, roughness: 0.45, metalness: 0.2 }), -1.25, 0.3, 0.3);
  add(new THREE.CylinderGeometry(0.15, 0.13, 0.15, 22, 1, true), M.steel, -0.7, 1.16, 0.72);
  add(new THREE.CircleGeometry(0.13, 20), M.noodles, -0.7, 1.15, 0.72, -Math.PI / 2);
  // tea kettle, glasses, a jar of biscuits
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 12), M.metal, 0.2, 1.06, 0.7);
  for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.025, 0.02, 0.07, 8), new THREE.MeshStandardMaterial({ color: 0xcfe8f0, roughness: 0.1, transparent: true, opacity: 0.6 }), 0.55 + i * 0.08, 1.02, 0.85);
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 12), new THREE.MeshStandardMaterial({ color: 0xe8d8a8, roughness: 0.3, transparent: true, opacity: 0.75 }), 1.05, 1.1, 0.72);
  // plastic stools in front (red / blue)
  const stool = (x, z, col) => { const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55 }); add(new THREE.CylinderGeometry(0.17, 0.2, 0.05, 14), m, x, 0.44, z); add(new THREE.CylinderGeometry(0.15, 0.2, 0.42, 14, 1, true), m, x, 0.21, z); };
  stool(-0.75, 1.75, 0xd8262e); stool(0.55, 1.85, 0x2856c8);
  // merge statics per material -> few draw calls
  const baked = bakeGroup(root);
  const group = new THREE.Group(); group.add(baked);
  const steam = createSteam({ count: 26, spread: 0.09, height: 0.9, size: 0.13 }); steam.points.position.set(-0.7, 1.2, 0.72); group.add(steam.points);
  return {
    group, steam,
    potLocal: new THREE.Vector3(-0.7, 1.16, 0.72),
    keeperLocal: new THREE.Vector3(-0.65, 0, 0.27),
    update(dt, t) { steam.update(dt, t); },
  };
}

/** GTA-style floating location marker with a light beam (visible from far, through trees) */
export function createStopMarker({ icon = '🍜', label = 'MAGGI', color = '#ffc61a', beam = 'rgba(255,214,60,' } = {}) {
  const group = new THREE.Group();
  const beamTexK = once('beam_' + beam, () => canvasTexture(16, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, beam + '0)'); g.addColorStop(0.65, beam + '.35)'); g.addColorStop(1, beam + '.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: false }));
  const beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 40, 14, 1, true), new THREE.MeshBasicMaterial({ map: beamTexK, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  beamMesh.position.y = 20; beamMesh.renderOrder = 7; group.add(beamMesh);
  const icon3d = new THREE.Sprite(new THREE.SpriteMaterial({ map: once('mtex_' + icon + label, () => markerTex(icon, label, color)), depthTest: false, depthWrite: false, fog: false, transparent: true }));
  icon3d.center.set(0.5, 0); icon3d.renderOrder = 9; group.add(icon3d);
  return {
    group,
    update(dt, t, camPos) {
      const d = camPos ? group.position.distanceTo(camPos) : 50;
      const s = Math.min(30, Math.max(2.2, d * 0.11)); icon3d.scale.set(s, s * 300 / 256, 1); // ~constant size on screen (GTA style)
      icon3d.position.y = 4.4 + Math.sin(t * 2.2) * 0.3;
      beamMesh.material.opacity = 0.85 + Math.sin(t * 3) * 0.15;
    },
  };
}
export function createMaggiMarker() { return createStopMarker({ icon: '🍜', label: 'MAGGI' }); }

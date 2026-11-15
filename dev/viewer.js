// Dev model viewer. Query params:
//   mod=models/bikes.js        module path relative to /js/
//   fn=createBike              exported factory name
//   args=["zx10r"]             JSON args for the factory
//   multi=[["zx10r"],["s1000rr"]]   render several variants side by side (spacing via gap=3)
//   calls=[["setPose","ride"]] methods to call on the returned object after creation
//   cam=3,1.6,4  target=0,0.8,0   camera position / look target
//   t=1.5        simulate update() for t seconds before rendering (default 0.5)
//   rot=30       rotate object(s) around Y in degrees
//   ground=1     show ground plane (default 1)   env=room|sky (default room)
//   spin=1       slowly rotate object (interactive)
//   state={"speed":20}   state object passed to update(dt, time, state)
// Drag mouse to orbit.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { Sky } from 'three/addons/Sky.js';

const q = new URLSearchParams(location.search);
const J = (k, d) => { try { return q.has(k) ? JSON.parse(q.get(k)) : d; } catch (e) { console.error('bad json', k, e); return d; } };
const V = (k, d) => (q.get(k) || d).split(',').map(Number);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = +(q.get('exposure') || 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
if ((q.get('env') || 'room') === 'sky') {
  const sky = new Sky(); sky.scale.setScalar(10000);
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(70), THREE.MathUtils.degToRad(200));
  sky.material.uniforms.sunPosition.value.copy(sun);
  sky.material.uniforms.turbidity.value = 4; sky.material.uniforms.rayleigh.value = 1.5;
  scene.add(sky);
  const envScene = new THREE.Scene(); const sky2 = sky.clone(); envScene.add(sky2);
  scene.environment = pmrem.fromScene(envScene).texture;
} else {
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = new THREE.Color(0x3a4048);
}
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5a4a3a, 0.6));
const sunL = new THREE.DirectionalLight(0xfff1dc, 2.2);
sunL.position.set(5, 9, 6); sunL.castShadow = true;
sunL.shadow.mapSize.set(2048, 2048);
Object.assign(sunL.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 40 });
sunL.shadow.bias = -0.0004; sunL.shadow.normalBias = 0.02;
scene.add(sunL);

if (q.get('ground') !== '0') {
  const g = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x6d6f72, roughness: 0.95 }));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  const grid = new THREE.GridHelper(20, 20, 0x888888, 0x555555); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.25; scene.add(grid);
}

const camera = new THREE.PerspectiveCamera(+(q.get('fov') || 40), innerWidth / innerHeight, 0.05, 20000);
const camPos = new THREE.Vector3(...V('cam', '3,1.6,4'));
const target = new THREE.Vector3(...V('target', '0,0.8,0'));
camera.position.copy(camPos); camera.lookAt(target);

const info = document.getElementById('info');
const objs = [];
let triCount = 0;

async function main() {
  const modPath = q.get('mod');
  if (!modPath) { info.textContent = 'pass ?mod=models/x.js&fn=create...'; return; }
  const mod = await import('../js/' + modPath);
  const fn = mod[q.get('fn')];
  if (typeof fn !== 'function') { info.textContent = 'export not found: ' + q.get('fn'); return; }
  const variants = J('multi', null) || [J('args', [])];
  const gap = +(q.get('gap') || 3);
  const calls = J('calls', []);
  for (let i = 0; i < variants.length; i++) {
    let res = fn(...variants[i]);
    if (res && typeof res.then === 'function') res = await res;
    const obj = res?.isObject3D ? res : res?.group;
    if (!obj) { console.error('factory returned no Object3D/group', res); continue; }
    for (const [m, ...a] of calls) { if (typeof res[m] === 'function') res[m](...a); else console.warn('no method', m); }
    obj.position.x += (i - (variants.length - 1) / 2) * gap;
    obj.rotation.y += THREE.MathUtils.degToRad(+(q.get('rot') || 0));
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(obj);
    objs.push({ res, obj });
  }
  renderer.compile(scene, camera);
  // pre-simulate
  const state = J('state', {});
  const T = +(q.get('t') ?? 0.5); const steps = Math.ceil(T / (1 / 30));
  for (let s = 0; s < steps; s++) for (const o of objs) o.res?.update?.(1 / 30, s / 30, state);
  scene.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry; const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3; triCount += n * (o.isInstancedMesh ? o.count : 1); } });
  window.__ready = true;
}
main().catch(e => { console.error(e); info.textContent = 'ERROR: ' + e.message; });

// simple orbit
let drag = null; const sph = new THREE.Spherical().setFromVector3(camPos.clone().sub(target));
addEventListener('pointerdown', e => drag = { x: e.clientX, y: e.clientY, th: sph.theta, ph: sph.phi });
addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => { if (!drag) return; sph.theta = drag.th - (e.clientX - drag.x) * 0.008; sph.phi = THREE.MathUtils.clamp(drag.ph - (e.clientY - drag.y) * 0.008, 0.1, 3); });
addEventListener('wheel', e => { sph.radius *= 1 + Math.sign(e.deltaY) * 0.1; });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const clock = new THREE.Clock(); let time = 0;
const st = J('state', {});
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05); time += dt;
  if (q.get('spin') === '1') sph.theta += dt * 0.4;
  camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph)); camera.lookAt(target);
  if (q.get('anim') !== '0') for (const o of objs) o.res?.update?.(dt, time, st);
  renderer.render(scene, camera);
  info.textContent = `${q.get('fn') || ''} ${q.get('args') || ''}\ntris: ${Math.round(triCount)}  calls: ${renderer.info.render.calls}`;
});

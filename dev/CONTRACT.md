# UTTARAKHAND RIDERS — module contract (dev notes)

Browser 3D racing game (Three.js r187, ES modules, no build step). Race route: **Ramnagar → Ranikhet** (Uttarakhand, India).
3 riders: **Mayank** (Kawasaki ZX-10R), **Tushar** (BMW S1000RR), **Himanshu** (Ducati Panigale V4). Must look as
realistic as possible while running on phones (mid-range Android, iPhone) and desktops.

Project root: `/Users/AniketChauhan/Desktop/bike game /`  (NOTE the trailing space in the folder name — always quote paths)

## Imports
```js
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { clamp, lerp, smoothstep, damp, makeRng, createNoise2D, fbm, canvasTexture, paintPixels,
         textTexture, roundRect, bakeGroup, colorize, mergeSafe, jitterGeometry, loadTexture, loadImage } from '../core/util.js';
```
Available addons (flat folder `vendor/three/addons/`): `BufferGeometryUtils.js`, `RoundedBoxGeometry.js`, `Sky.js`, `RoomEnvironment.js`.
No other libraries. Do NOT edit `js/core/util.js` (shared) — put extra helpers inside your own module.

three r187 notes: `PCFSoftShadowMap` is removed (use `PCFShadowMap`); `THREE.Clock` deprecated (use `THREE.Timer` or performance.now()).
Color management is ON: canvas color textures need `tex.colorSpace = THREE.SRGBColorSpace` (util `canvasTexture` does it by default).

## Conventions (IMPORTANT)
* Units: meters, seconds, radians. **Y is up.**
* Every model **faces +Z** (front of bike / vehicle / animal / person / building facade looks toward +Z).
  Model's **left side = +X**, right side = −X.
* Origin at ground level (y = 0), centred on footprint (bike: midway between tyre contact patches; person: between feet;
  building: centre of base footprint).
* Real-world scale. People 1.5–1.8 m; superbike ≈ 2.05 m long, 1.15 m tall; bus ≈ 10 m long.
* PBR materials (`MeshStandardMaterial` / `MeshPhysicalMaterial`). The game uses ACES tone mapping, a sun
  DirectionalLight + HemisphereLight + PMREM environment map, and scene fog. Avoid emissive except real lights.
* Share geometries & materials between instances (module-level caches). Merge static parts per material
  (`bakeGroup` / `mergeSafe`) to minimise draw calls. Parts that animate stay separate.
* No DOM access at import time (create canvases lazily inside functions). No global side effects at import.
* Factories are synchronous and return `{ group: THREE.Group, update(dt, time, state) }` (update may be a no-op)
  unless stated otherwise. `group` must be ready to `scene.add()`.

## Performance budgets (mobile!)
| object | triangles | draw calls |
|---|---|---|
| hero bike (3 exist) | 12k–30k | ≤ 14 |
| rider (3 exist) | 6k–15k | ≤ 12 |
| animal | 1k–4k | ≤ 5 |
| person NPC (up to ~50 in world) | ≤ 1.5k | ≤ 6 (single vertex-coloured material) |
| vehicle | 2k–6k | ≤ 8 |
| building | 200–2k | ≤ 6 |
| tree template (instanced, thousands) | high LOD ≤ 1.2k, low LOD ≤ 150 | 1 per template |

## Testing (dev viewer + headless screenshots)
A static server is running at `http://localhost:8123/` (if not: `cd "<root>" && PORT=8123 node server.js &`).
Viewer: `http://localhost:8123/dev/viewer.html?mod=models/bikes.js&fn=createBike&args=["zx10r"]&cam=3,1.4,3.5&target=0,0.6,0`
Params: `mod` (path under /js/), `fn`, `args` (JSON), `multi` (JSON array of arg-arrays → side by side, `gap=3`),
`calls` (JSON `[["setPose","ride"]]`), `cam`, `target`, `fov`, `t` (pre-simulate seconds), `state` (JSON passed to update),
`rot` (deg), `env=room|sky`, `ground=0`, `exposure`.
You can also write your own composition helpers in `dev/<yourname>_*.js` and point `mod=../dev/<file>.js` at them.

Screenshot:
```
node /private/tmp/claude-501/-Users-AniketChauhan-Desktop-bike-game-/682ada97-72a7-4d75-946e-470faf52cc77/scratchpad/shot.mjs '<url>' /private/tmp/claude-501/-Users-AniketChauhan-Desktop-bike-game-/682ada97-72a7-4d75-946e-470faf52cc77/scratchpad/<name>.png --wait=2500 [--w=1280 --h=720]
```
It prints console errors/warnings. Then look at the PNG with the Read tool. Iterate until it looks good.

---------------------------------------------------------------------------------------------------------------

## A. Audio — `js/audio/audio.js`
Everything synthesized with the Web Audio API (no audio files). Must work on Android Chrome + iOS Safari
(create/resume AudioContext inside a user gesture; `webkitAudioContext` fallback). Mobile-friendly CPU use.
```js
export const Audio = {
  unlock(): Promise<void>            // call from a click/tap handler; creates/resumes ctx; idempotent
  get ready(): boolean
  setVolumes({ master, music, sfx })  // 0..1 each (sfx also scales engines + ambience)
  playMusic(name /* 'menu'|'race'|'results'|null */, { fade = 1.5 } = {})
  ui(name /* 'click'|'hover'|'swipe'|'select'|'back'|'countdown'|'go'|'finish'|'error'|'notify'|'join'|'lose' */)
  sfx(name, { pos /*THREE.Vector3|{x,y,z}*/, volume = 1, pitch = 1 } = {})
      // names: 'horn','busHorn','truckHorn','autoHorn','crash','bump','cowMoo','tigerRoar','snakeHiss','monkey',
      //        'dogBark','elephant','templeBell','koel','chirp','crow','peacock','thrush','cheer','backfire','whoosh','splash'
  setListener(position, forward)       // THREE.Vector3s, for positional sfx/engines (call every frame)
  createEngine(type /*'zx10r'|'s1000rr'|'panigale'*/, { local = true } = {}) => {
      update({ rpm, throttle /*0..1*/, speed /*m/s*/, gear, position /*Vector3, for non-local*/ }),
      shift(up /*bool*/),               // quick-shifter blip / pop
      setLimiter(on),                   // rev limiter bounce
      setVolume(v), dispose()
  }
  setRide({ speed, skid /*0..1*/, scrape /*0..1*/, offroad /*0..1*/ })   // wind, tyre squeal, barrier scrape, gravel rumble
  setAmbience({ forest, river, town, mountain, waterfall, crowd, temple, insects })  // 0..1, crossfaded
      // also drives a random one-shot scheduler per zone (birds: koel/chirp/peacock/thrush/crow, town: horns,
      // dog barks, cow moo, mountain: monkeys, crows, wind gusts, river: splashes, temple: bells)
  pauseAll(paused /*bool*/)             // duck/suspend gameplay audio while paused (music may continue softer)
}
export default Audio;
```
Engine is the star: inline-4 (ZX-10R ≈14k rpm redline, S1000RR ≈14.6k) scream vs V4 (Panigale, ≈16k, uneven
"twin-pulse" big-bang growl). idle ≈ 1300 rpm. Firing freq = rpm/60 × 2 for an inline-4. Throttle-off = quieter,
darker + occasional crackles/pops. Upshift = quick cut + rpm drop + pop. Music: 'menu' = Pahadi/Kumaoni folk feel
(Raag Pahadi pentatonic, bansuri/flute lead with vibrato & glides, hudka/dhol rhythm in 6/8 or Kaharwa, tanpura drone);
'race' = energetic 130–140 bpm electronic + dhol with a pahadi flute motif; 'results' = short celebratory loop.
Use a look-ahead scheduler; loop with variation so it doesn't get boring.

## B. Bikes & Riders — `js/models/bikes.js`, `js/models/riders.js`
**Standard anchors (all 3 bikes must match these so any rider fits):** wheelbase ≈ 1.42 m (front contact z=+0.71,
rear z=−0.71), wheel radius ≈ 0.31 m, seat top (0, 0.83, −0.18), grips (±0.30, 0.90, 0.40), foot-pegs (±0.20, 0.36, −0.30).
```js
// bikes.js
export function createBike(id /*'zx10r'|'s1000rr'|'panigale'*/) => {
  group,                       // origin on ground between contact patches, faces +Z
  parts: { frontWheel, rearWheel, steer /*pivot on steering axis; front wheel+fork+bars inside*/, body },
  anchors: { seat, gripL, gripR, pegL, pegR, helmetRest },   // THREE.Vector3 in bike-local coords
  wheelRadius,
  update(dt, time, { speed /*m/s*/, steer /*-1..1*/, brake /*0..1*/, throttle /*0..1*/ })
     // spins wheels, turns steer pivot (visual, small angle), brake light emissive, slight suspension
}
export const BIKE_INFO = { zx10r: {name:'Kawasaki Ninja ZX-10R', ...}, s1000rr: {...}, panigale: {...} } // display names, colours
// riders.js
export async function preloadRiders()   // loads assets/faces/<id>.jpg ; await during loading screen
export function createRider(id /*'mayank'|'tushar'|'himanshu'*/) => {
  group,                        // origin between feet when standing; when riding, place group at bike origin (0,0,0) and it sits on the standard seat
  setPose(p /*'stand'|'ride'*/),
  setHelmet(on /*bool*/),
  headAnchor,                   // Object3D at eye position (for first-person cam)
  height,
  update(dt, time, { lean /*rad, bike lean applied by game on parent*/, speed, throttle, brake, steer })
     // stand: idle breathing, weight shift, look around. ride: tuck at speed, hang-off into corners, sit up when braking
}
export function createHelmet(id) => THREE.Group   // standalone helmet (lobby: rests on bike at anchors.helmetRest)
```
Characters (from photos in `characters images /`, face crops in `assets/faces/*.jpg`, portraits in `assets/portraits/`):
* **Mayank** — adult (~1.75 m), slim, medium-brown skin, thick voluminous black hair. Wears a **riding jacket**
  (inspired by his tee: light-grey body, navy sleeves/collar, black armour pads, lime-green piping), red track pants with
  black side stripe, red thread (kalava) on right wrist, boots. Helmet: lime green / black / white.
* **Tushar** — adult (~1.78 m), slim & tall, medium-brown skin, black hair swept to one side with volume, thin moustache
  + light stubble. Wears a **riding jacket** (red with white accents, inspired by his red hoodie), charcoal track pants,
  black/red wrist bands. Helmet: white / blue / red.
* **Himanshu** — **teen**, clearly **shorter** (~1.55 m), slim, darker brown skin, black hair with a fringe. Maroon
  short-sleeve sports tee (raglan stitching), olive/khaki track pants with black side stripe, black wrist band,
  sneakers. Helmet: red / white.
Bikes: ZX-10R = Kawasaki lime green + black + white, twin LED headlights, winglets in fairing, short side exhaust.
S1000RR = BMW M livery (white + light/dark blue + red stripes), carbon winglets, slim symmetric LED headlights.
Panigale V4 = Ducati red, **single-sided swingarm** (rear wheel exposed on the right), twin "eyebrow" DRLs, biplane winglets,
under-engine exhaust. Indian white number plates e.g. "UK 04 MK 1010".

## C. Animals & People — `js/models/animals.js`, `js/models/people.js`
```js
export function createCow({ seed, color /*'white'|'brown'|'black'|'spotted'*/, pose /*'stand'|'sit'|'graze'|'walk'*/ }) => {group, update, setPose}
export function createTiger({ seed, pose /*'sit'|'stand'|'walk'*/ }) => {group, update, setPose, roar()}
export function createSnake({ seed, kind /*'cobra'|'python'*/ }) => {group, update}   // slithers in place along +Z; game moves the group
export function createMonkey({ seed, kind /*'langur'|'rhesus'*/, pose /*'sit'|'walk'*/ }) => {group, update, setPose}
export function createDeer({ seed, male }) => {group, update}            // chital (spotted deer)
export function createDog({ seed }) => {group, update}                   // Indian pariah dog
export function createElephant({ seed }) => {group, update}              // Asian elephant
export function createPeacock({ seed }) => {group, update}
export function createBirdFlock({ seed, count = 12, radius = 40, height = 30 }) => {group, update}  // instanced, wing-flap in shader
// people.js  — Indian / Kumaoni townspeople & villagers
export function createPerson({ seed, gender /*'m'|'f'*/, age /*'adult'|'old'|'kid'*/, pose /*'stand'|'sit'|'wave'|'cheer'|'walk'|'squat'*/,
                               static: false }) => {group, update, setPose}
   // outfits auto from seed: shirt-pant, kurta-pyjama, Pahadi topi + waistcoat, saree, salwar-kameez + dupatta, sweater/shawl.
   // ONE shared vertex-coloured material for all people; ≤ 6 meshes per person; static:true → single merged mesh.
```

## D1. Vehicles & roadside props — `js/models/vehicles.js`, `js/models/props.js`
```js
// vehicles.js  — each {group, update(dt, time, {speed})} (wheels spin)
export function createBus({ seed })      // Indian hill bus, roof luggage rack, destination board "रामनगर - रानीखेत / RAMNAGAR - RANIKHET", yellow plate
export function createJeep({ seed })     // Bolero/Max style hill taxi
export function createTruck({ seed })    // painted Indian truck, "HORN OK PLEASE"
export function createAuto({ seed })     // auto rickshaw
export function createCar({ seed })      // hatchback
// props.js
export function createMilestone({ place, km, kind /*'nh'(yellow top)|'sh'(green top)*/ }) => Group
export function createSign({ kind /*'welcome'|'info'|'bro'|'warning'|'direction'|'forest'*/, lines, w, h }) => Group  // on posts
export function createGate({ title, subtitle, colors }) => Group   // arch spanning a 10 m road (start: Ramnagar, finish: Ranikhet), banners & flags
export function createBridge({ length, width }) => Group           // steel truss bridge, deck at y=0, spans along +Z centred at origin
export function createBunting({ length }) => Group                 // festive flags line
export function createHoarding({ lines }) => Group
export function getPropTemplate(name) => { geometry, material }    // single geometry+material for InstancedMesh
   // names: 'pole' (electric pole w/ crossarm), 'streetlight', 'parapet' (one 2.0 m black/white painted parapet block),
   //        'barrierPost', 'chevron' (yellow/black curve sign on post, faces +Z), 'reflectorPost', 'milestoneSmall' (200 m stone)
```

## D2. Buildings & vegetation — `js/models/buildings.js`, `js/models/vegetation.js`
```js
// buildings.js — each returns {group} (facade toward +Z, origin at base centre)
export function createShop({ seed, w, d, sign: { hi, en }, kind })
export function createTownBuilding({ seed, floors, w, d })   // pastel concrete, grills, balcony, black rooftop water tank
export function createBusStand()                              // "रामनगर बस स्टैंड / RAMNAGAR BUS STAND"
export function createDhaba({ seed, sign })                   // tin roof tea stall, plastic chairs, "Chai • Maggi"
export function createKumaoniHouse({ seed })                  // stone + slate roof, carved wooden windows
export function createColonialBuilding({ seed })              // Ranikhet cantonment style, red tin roof, chimneys
export function createChurch()
export function createTemple({ style /*'small'|'garjiya'*/ }) // 'garjiya' = Garjiya Devi temple on a tall rock pillar in the river, with steps
// vegetation.js — templates for InstancedMesh (one merged vertex-coloured geometry + one shared material each)
export function getTreeTemplate(kind /*'sal'|'pine'|'deodar'|'oak'|'bush'|'bamboo'|'banana'|'grass'|'fern'*/, lod /*'high'|'low'*/) => { geometry, material, height }
export function getRockTemplate(variant /*0..3*/, kind /*'river'|'mountain'*/) => { geometry, material }
export function updateVegetation(time)   // drives wind-sway uniform shared by all vegetation materials
```

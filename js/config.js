// Game-wide configuration: characters, bikes, modes, map, quality presets and persisted settings.

export const GAME_TITLE = 'UTTARAKHAND RIDERS';
export const GAME_TAGLINE = 'Devbhoomi ki sadkon par race';

export const CHARACTERS = [
  {
    id: 'mayank', name: 'MAYANK', age: 'Adult', bike: 'zx10r',
    tag: 'Green Machine', accent: '#7ed321', accent2: '#1d2b4f',
    intro: 'mayank_1',  // "Main Mayank hoon" — selection + race intro
    voices: ['mayank_2', 'mayank_3', 'mayank_4', 'mayank_5'],  // other lines (💬 dialogue in race)
    bio: 'Riding jacket, red track pants aur full josh.',
  },
  {
    id: 'tushar', name: 'TUSHAR', age: 'Adult', bike: 's1000rr',
    tag: 'Bavarian Rocket', accent: '#2d7ff9', accent2: '#e8212e',
    intro: 'tushar_1',
    voices: ['tushar_2'],
    bio: 'Red jacket, cool style. Straights ka raja.',
  },
  {
    id: 'himanshu', name: 'HIMANSHU', age: 'Teen', bike: 'panigale',
    tag: 'Little Devil', accent: '#e8212e', accent2: '#7a1020',
    intro: 'himanshu_1',
    voices: ['himanshu_2', 'himanshu_3'],
    bio: 'Height me chhota, speed me sabse bada.',
  },
];
export const charById = id => CHARACTERS.find(c => c.id === id) || CHARACTERS[0];

// Physics + display data for the 3 bikes. Speeds in km/h for display; physics converts.
export const BIKES = {
  zx10r: {
    id: 'zx10r', name: 'Kawasaki Ninja ZX-10R', short: 'ZX-10R', engine: '998cc Inline-4', power: '203 PS',
    topKmh: 299, accel: 8.1, brake: 10.4, grip: 1.00, leanRate: 1.0, redline: 14000, idle: 1300,
    gears: [108, 148, 183, 218, 254, 299],
    stats: { speed: 0.95, accel: 0.86, handling: 0.84, brakes: 0.88 },
    color: '#6cc417',
  },
  s1000rr: {
    id: 's1000rr', name: 'BMW S 1000 RR', short: 'S1000RR', engine: '999cc Inline-4', power: '210 PS',
    topKmh: 303, accel: 8.5, brake: 10.6, grip: 0.98, leanRate: 0.96, redline: 14600, idle: 1300,
    gears: [112, 152, 188, 222, 258, 303],
    stats: { speed: 0.98, accel: 0.93, handling: 0.82, brakes: 0.90 },
    color: '#2d7ff9',
  },
  panigale: {
    id: 'panigale', name: 'Ducati Panigale V4', short: 'PANIGALE V4', engine: '1103cc V4 Desmosedici Stradale', power: '215 PS',
    topKmh: 296, accel: 8.4, brake: 10.9, grip: 1.05, leanRate: 1.08, redline: 15800, idle: 1350,
    gears: [104, 146, 181, 215, 251, 296],
    stats: { speed: 0.92, accel: 0.90, handling: 0.95, brakes: 0.94 },
    color: '#e8212e',
  },
};

export const MODES = [
  { id: 'race', name: 'RACE vs CPU', desc: 'Teeno riders ki race — tum vs 2 CPU riders. Ranikhet pehle pahuncho!', icon: '🏁' },
  { id: 'time', name: 'TIME TRIAL', desc: 'Akele ride karo, apna best time todo.', icon: '⏱️' },
  { id: 'free', name: 'FREE RIDE', desc: 'Koi timer nahi. Pahadon ka mazaa lo, aaram se.', icon: '🏔️' },
];

export const MAPS = [
  {
    id: 'ramnagar-ranikhet', name: 'RAMNAGAR → RANIKHET', region: 'Uttarakhand',
    desc: 'Ramnagar bus stand se shuru — Corbett ka jungle, Kosi nadi, Garjiya Devi, pahadi hairpin bends aur Ranikhet finish.',
  },
];

export const TIMES_OF_DAY = [
  { id: 'morning', name: 'SUBAH', desc: 'Sunehri dhoop, thandi hawa' },
  { id: 'day', name: 'DIN', desc: 'Saaf neela aasmaan' },
  { id: 'evening', name: 'SHAAM', desc: 'Golden sunset pahadon par' },
];

export const DIFFICULTIES = [
  { id: 'easy', name: 'EASY', skill: 0.8, kick: 0.15, nitro: 0.4, rubber: 1.0, desc: 'CPU aaram se chalate hain, laat kam maarte hain' },
  { id: 'medium', name: 'MEDIUM', skill: 0.91, kick: 0.45, nitro: 0.8, rubber: 1.0, desc: 'Barabar ki takkar' },
  { id: 'hard', name: 'HARD', skill: 1.0, kick: 0.75, nitro: 1.2, rubber: 1.6, desc: 'Tez CPU, nitro aur laat dono zyada' },
];

// Graphics quality presets
export const QUALITY = {
  low:    { id: 'low', name: 'LOW', pixelRatio: 0.85, maxDpr: 1, shadows: false, shadowSize: 0, antialias: false, treeDensity: 0.38, people: 0.5,
            treeHighR: 0, treeLowR: 60, cullScale: 0.6, bakeSky: true, triplanar: false, lite: true, shadowCasters: 'none', viewFar: 1400, drsMin: 0.55 },
  medium: { id: 'medium', name: 'MEDIUM', pixelRatio: 1, maxDpr: 1.5, shadows: true, shadowSize: 1024, antialias: false, treeDensity: 0.6, people: 0.8,
            treeHighR: 90, treeLowR: 90, cullScale: 1, bakeSky: false, triplanar: true, lite: false, shadowCasters: 'all', viewFar: 2100, drsMin: 0.7 },
  high:   { id: 'high', name: 'HIGH', pixelRatio: 1, maxDpr: 2, shadows: true, shadowSize: 2048, antialias: true, treeDensity: 1.0, people: 1,
            treeHighR: 130, treeLowR: 130, cullScale: 1, bakeSky: false, triplanar: true, lite: false, shadowCasters: 'all', viewFar: 3600, drsMin: 0.75 },
};
// Phones: same names in the menu, but tuned for smooth 60 fps (cheaper shaders, baked sky, opaque mid-distance trees,
// only riders/vehicles cast shadows, lower pixel ratio). Dynamic resolution keeps the frame rate up on top of this.
const PHONE = {
  low:    { maxDpr: 1, pixelRatio: 0.8, treeDensity: 0.32, treeLowR: 50, cullScale: 0.5, viewFar: 1200, drsMin: 0.5 },
  medium: { maxDpr: 1.25, shadowCasters: 'dynamic', treeDensity: 0.5, treeHighR: 26, treeLowR: 70, cullScale: 0.7, bakeSky: true, triplanar: false, lite: true, viewFar: 1700, drsMin: 0.55 },
  high:   { maxDpr: 1.5, shadowSize: 1024, antialias: false, shadowCasters: 'dynamic', treeDensity: 0.75, treeHighR: 45, treeLowR: 100, cullScale: 0.85, bakeSky: true, triplanar: true, viewFar: 2300, drsMin: 0.6 },
};
export function resolveQuality(id, phone) {
  const base = QUALITY[id] || QUALITY.medium;
  return phone ? { ...base, ...PHONE[base.id], phone: true } : { ...base, phone: false };
}

const isMobileUA = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  || ((('ontouchstart' in globalThis) || navigator.maxTouchPoints > 0) && typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 900));

export const DEFAULT_SETTINGS = {
  quality: isMobileUA ? 'medium' : 'high',
  showFps: true,
  fpsLimit: 60,          // 30 | 60 | 0 (unlimited)
  master: 0.9, music: 0.55, sfx: 0.9, voice: 1.0,
  steering: 'buttons',   // 'buttons' | 'tilt'
  tiltSens: 1.0,
  camera: 'chase',       // 'chase' | 'far' | 'helmet'
  aspect: 'fill',        // 'fill' (whole screen) | '16:9'
  difficulty: 'medium',
  mode: 'race',
  map: 'ramnagar-ranikhet',
  timeOfDay: 'morning',
  character: 'mayank',
  playerName: '',
  vibrate: true,
  musicTrack: 2,
};

const KEY = 'ukriders.settings.v1';
export const Settings = {
  data: { ...DEFAULT_SETTINGS },
  load() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); this.data = { ...DEFAULT_SETTINGS, ...s }; } catch { /* private mode */ }
    if (!QUALITY[this.data.quality]) this.data.quality = DEFAULT_SETTINGS.quality;
    if (!this.data._fillV2) { this.data.aspect = 'fill'; this.data._fillV2 = true; this.save(); } // everyone gets full screen once
    return this.data;
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } },
  set(k, v) { this.data[k] = v; this.save(); },
  get(k) { return this.data[k]; },
};

const BEST_KEY = 'ukriders.best.v1';
export const Records = {
  get(char, mode) { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}')[`${mode}:${char}`] || null; } catch { return null; } },
  set(char, mode, time) {
    try {
      const all = JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); const k = `${mode}:${char}`;
      if (!all[k] || time < all[k]) { all[k] = time; localStorage.setItem(BEST_KEY, JSON.stringify(all)); return true; }
    } catch { /* ignore */ }
    return false;
  },
};

export const TIPS = [
  'Tip: Hairpin bends se pehle brake lagao, phir lean karke nikal jao!',
  'Tip: Gaay sadak par baithi ho sakti hai — dhyaan se!',
  'Tip: Corbett ke jungle me sher dikhe to ruko mat... bas nikal lo!',
  'Tip: Indian roads par left side chalte hain — saamne se bus aa sakti hai.',
  'Tip: C dabao ya camera button se view badlo.',
  'Tip: Multiplayer me apne doston ke saath ek hi Wi-Fi par race karo.',
  'Tip: Kosi nadi ke kinare Garjiya Devi mandir zaroor dekhna.',
  'Tip: Settings me graphics LOW karo agar phone garam ho raha ho.',
];

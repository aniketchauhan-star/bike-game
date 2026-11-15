// Pahadi (Garhwali / Kumaoni) songs blaring from buses: positional, muffled "bus speaker" sound that fades in as a
// bus comes closer and fades out after it has passed. Uses the songs cut from the user's mashup.
import { Audio } from './audio.js';
import { MusicPlayer } from './music.js';

const NEAR = 140;     // start hearing the bus from here (m)
const RELEASE = 190;  // free the audio slot beyond this
const SLOTS = 3;      // at most 3 buses playing at once (phones!)

export class BusMusic {
  constructor() { this.slots = []; this.volume = 0.9; this.duck = 1; this.paused = false; this.buses = []; }

  /** buses: array of { pos: THREE.Vector3 } (moving traffic + parked buses) */
  setBuses(list) { this.stopAll(); this.buses = list.map(b => ({ pos: b.pos, song: null, slot: null, d: 1e9, t0: Math.random() })); }

  songs() { return MusicPlayer.tracks.filter(t => t.type === 'file' && !t.loop).map(t => t.src); }

  _slot() {
    const ctx = Audio.context, out = Audio.voiceOut; if (!ctx || !out) return null;
    const el = document.createElement('audio'); el.preload = 'auto'; el.loop = true; el.setAttribute('playsinline', '');
    let src; try { src = ctx.createMediaElementSource(el); } catch { return null; }
    // cheap bus loudspeaker: no bass, boxy mids, rolled-off highs
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220; hp.Q.value = 0.7;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1300; mid.gain.value = 6; mid.Q.value = 1.1;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.9;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createPanner(); pan.panningModel = 'equalpower'; pan.distanceModel = 'linear'; pan.rolloffFactor = 0; pan.refDistance = 1; pan.maxDistance = 100000;
    src.connect(hp); hp.connect(mid); mid.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect(out);
    return { el, gain, lp, pan, bus: null, level: 0 };
  }

  update(dt, cam) {
    if (!Audio.context || this.paused || !this.buses.length) return;
    const songs = this.songs(); if (!songs.length) return;
    for (const b of this.buses) b.d = Math.hypot(b.pos.x - cam.x, b.pos.y - cam.y, b.pos.z - cam.z);
    // free slots of buses that went far away (after their fade-out)
    for (const s of this.slots) if (s.bus && s.bus.d > RELEASE && s.level < 0.005) { s.el.pause(); s.bus.slot = null; s.bus = null; }
    // give free slots to the closest buses in range
    const want = this.buses.filter(b => b.d < NEAR && !b.slot).sort((a, b) => a.d - b.d);
    for (const b of want) {
      let s = this.slots.find(x => !x.bus);
      if (!s && this.slots.length < SLOTS) { s = this._slot(); if (!s) return; this.slots.push(s); }
      if (!s) break;
      s.bus = b; b.slot = s; s.level = 0; s.gain.gain.value = 0;
      if (!b.song) b.song = songs[Math.floor(Math.random() * songs.length)];
      if (!s.el.src.endsWith(b.song)) {
        s.el.src = b.song;
        s.el.addEventListener('loadedmetadata', () => { try { s.el.currentTime = b.t0 * Math.max(0, (s.el.duration || 60) - 20); } catch { /* */ } }, { once: true });
      }
      s.el.play().catch(() => {});
    }
    // smooth distance fades + position for left/right panning
    const t = Audio.context.currentTime;
    for (const s of this.slots) {
      if (!s.bus) continue;
      const d = s.bus.d;
      const target = d >= NEAR ? 0 : Math.pow(1 - d / NEAR, 1.7) * this.volume * this.duck;
      s.level += (target - s.level) * Math.min(1, dt * 2.2);
      s.gain.gain.setTargetAtTime(s.level, t, 0.08);
      s.lp.frequency.setTargetAtTime(1300 + Math.max(0, 1 - d / NEAR) * 2600, t, 0.2); // farther = more muffled
      const p = s.bus.pos;
      if (s.pan.positionX) { s.pan.positionX.setTargetAtTime(p.x, t, 0.05); s.pan.positionY.setTargetAtTime(p.y + 2.2, t, 0.05); s.pan.positionZ.setTargetAtTime(p.z, t, 0.05); }
      else s.pan.setPosition(p.x, p.y + 2.2, p.z);
    }
  }

  pause(on) { this.paused = on; for (const s of this.slots) { if (on) s.el.pause(); else if (s.bus) s.el.play().catch(() => {}); } }
  stopAll() { for (const s of this.slots) { s.el.pause(); s.level = 0; s.gain.gain.value = 0; if (s.bus) s.bus.slot = null; s.bus = null; } }
}

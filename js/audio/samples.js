// Recorded game sounds (assets/sfx/*.mp3 from the "game sound" folder): countdown beeps, horn, whoosh, engine rev,
// forest birds ambience, crash sting, wind. Played through the shared Web Audio context.
export const SFX_FILES = {
  countdown: 'assets/sfx/countdown.mp3',   // beeps at 0.0 / 1.03 / 2.04 s, GO at 3.02 s
  horn: 'assets/sfx/horn.mp3',
  whoosh: 'assets/sfx/whoosh.mp3',
  engineRev: 'assets/sfx/engine_rev.mp3',
  forest: 'assets/sfx/forest.mp3',
  sting: 'assets/sfx/sting.mp3',
  wind: 'assets/sfx/wind.mp3',
};
export const COUNTDOWN_TIMES = [0.0, 1.03, 2.04, 3.02];

export const Samples = {
  ctx: null, out: null, raw: new Map(), buffers: new Map(), loops: new Map(), volume: 1,

  async preload(keys = Object.keys(SFX_FILES)) {
    await Promise.all(keys.map(async (k) => {
      if (this.raw.has(k) || this.buffers.has(k)) return;
      try { const r = await fetch(SFX_FILES[k]); if (r.ok) this.raw.set(k, await r.arrayBuffer()); } catch { /* offline */ }
    }));
  },

  init(ctx, destination) {
    if (!ctx || this.ctx === ctx) return;
    this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = this.volume; this.out.connect(destination || ctx.destination);
    for (const [k, b] of this.raw) this._decode(k, b);
  },

  _decode(k, buf) {
    if (!this.ctx) return Promise.resolve(null);
    if (this.buffers.has(k)) return Promise.resolve(this.buffers.get(k));
    if (!buf) return Promise.resolve(null);
    return new Promise((res) => {
      const done = (ab) => { this.buffers.set(k, ab); this.raw.delete(k); res(ab); };
      try { const p = this.ctx.decodeAudioData(buf.slice(0), done, () => res(null)); if (p && p.then) p.then(done).catch(() => res(null)); } catch { res(null); }
    });
  },
  async buffer(k) { return this.buffers.get(k) || await this._decode(k, this.raw.get(k)); },

  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); },

  /** one-shot. returns {src, gain, duration} or null */
  async play(k, { volume = 1, rate = 1, offset = 0, duration, when = 0, fadeOut = 0 } = {}) {
    if (!this.ctx) return null;
    const b = await this.buffer(k); if (!b) return null;
    const src = this.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = volume; src.connect(g); g.connect(this.out);
    const t = this.ctx.currentTime + when;
    if (duration) {
      src.start(t, offset, duration + 0.05);
      if (fadeOut) { g.gain.setValueAtTime(volume, t + Math.max(0, duration - fadeOut)); g.gain.linearRampToValueAtTime(0.0001, t + duration); }
    } else src.start(t, offset);
    return { src, gain: g, duration: duration || (b.duration - offset) / rate };
  },

  /** continuous loop with smoothly controllable level (0 = silent, auto-stops when 0 for long) */
  async setLoop(k, level, { rate = 1 } = {}) {
    if (!this.ctx) return;
    let L = this.loops.get(k);
    if (!L) {
      if (level <= 0.001) return;
      const b = await this.buffer(k); if (!b || this.loops.get(k)) return;
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true; src.playbackRate.value = rate;
      const g = this.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(this.out);
      src.start(this.ctx.currentTime, Math.random() * b.duration);
      L = { src, g, level: 0, idle: 0 }; this.loops.set(k, L);
    }
    L.level = level; L.g.gain.setTargetAtTime(level, this.ctx.currentTime, 0.6);
  },
  stopLoops() { for (const [k, L] of this.loops) { try { L.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); L.src.stop(this.ctx.currentTime + 1); } catch { /* */ } this.loops.delete(k); } },
};
export default Samples;

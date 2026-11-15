// Character voice lines (the real recordings in assets/voice/*.mp3) played through Web Audio.
// Music is ducked while a character speaks.
import { charById } from '../config.js';

export const Voice = {
  ctx: null, out: null, volume: 1,
  raw: new Map(),      // id -> ArrayBuffer (fetched early, before audio unlock)
  buffers: new Map(),  // id -> AudioBuffer
  onDuck: null,        // (on:boolean) => void
  current: null,
  lastPick: {},

  /** fetch all files early (no AudioContext needed) */
  async preload(ids) {
    await Promise.all(ids.map(async (id) => {
      if (this.raw.has(id) || this.buffers.has(id)) return;
      try { const r = await fetch(`assets/voice/${id}.mp3`); if (r.ok) this.raw.set(id, await r.arrayBuffer()); } catch { /* offline */ }
    }));
  },

  /** attach to the game's AudioContext (call after Audio.unlock) */
  init(ctx, destination) {
    if (!ctx || this.ctx === ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = this.volume;
    this.out.connect(destination || ctx.destination);
    // decode everything we already fetched
    for (const [id, buf] of this.raw) this._decode(id, buf);
  },

  _decode(id, buf) {
    if (!this.ctx || this.buffers.has(id)) return Promise.resolve(this.buffers.get(id));
    return new Promise((res) => {
      const copy = buf.slice(0);
      const done = (ab) => { this.buffers.set(id, ab); this.raw.delete(id); res(ab); };
      try {
        const p = this.ctx.decodeAudioData(copy, done, () => res(null));
        if (p && p.then) p.then(done).catch(() => res(null));
      } catch { res(null); }
    });
  },

  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); },

  /** pick a line for a character (no immediate repeat) */
  pick(charId) {
    const list = charById(charId).voices || [];
    if (!list.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && list[i] === this.lastPick[charId]) i = (i + 1) % list.length;
    this.lastPick[charId] = list[i];
    return list[i];
  },

  duration(id) { return this.buffers.get(id)?.duration || 1.6; },

  stop() {
    if (this.current) { try { this.current.src.stop(); } catch { /* */ } this.current = null; this.onDuck?.(false); }
  },

  /** play a line. returns a promise that resolves when it finishes (or immediately if unavailable) */
  async play(id, { volume = 1, pan = 0 } = {}) {
    if (!id || !this.ctx) return 0;
    let buf = this.buffers.get(id);
    if (!buf && this.raw.has(id)) buf = await this._decode(id, this.raw.get(id));
    if (!buf) return 0;
    this.stop();
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = volume;
    let node = g;
    if (this.ctx.createStereoPanner && pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    src.connect(g); node.connect(this.out);
    const cur = { src }; this.current = cur;
    this.onDuck?.(true);
    src.start();
    return new Promise((res) => {
      src.onended = () => { if (this.current === cur) { this.current = null; this.onDuck?.(false); } res(buf.duration); };
    });
  },

  playRandom(charId, opts) { return this.play(this.pick(charId), opts); },
  /** the character's own introduction ("Main Mayank hoon") */
  introLine(charId) { return charById(charId).intro || this.pick(charId); },
  playIntro(charId, opts) { return this.play(this.introLine(charId), opts); },
};
export default Voice;

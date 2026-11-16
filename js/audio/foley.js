// Small synthesized foley for cinematics: sizzling pan, slurping noodles, a ding. Uses the shared AudioContext.
import { Audio } from './audio.js';

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuf = b);
}
const io = () => (Audio.context && Audio.voiceOut ? [Audio.context, Audio.voiceOut] : [null, null]);

export const Foley = {
  /** frying / boiling sizzle with little oil pops */
  sizzle(dur = 3, vol = 0.35) {
    const [ctx, out] = io(); if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 6500; pk.gain.value = 5; pk.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.35);
    g.gain.setValueAtTime(vol, t + Math.max(0.4, dur - 0.5)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(hp); hp.connect(pk); pk.connect(g); g.connect(out); src.start(t, Math.random()); src.stop(t + dur + 0.05);
    for (let i = 0; i < dur * 16; i++) this._pop(t + Math.random() * dur, vol * (0.4 + Math.random() * 0.6));
  },
  _pop(when, vol) {
    const [ctx, out] = io(); if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500 + Math.random() * 5000; f.Q.value = 2.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0008, when + 0.025 + Math.random() * 0.03);
    src.connect(f); f.connect(g); g.connect(out); src.start(when, Math.random()); src.stop(when + 0.07);
  },
  /** "sluuurp" — eating noodles */
  slurp(vol = 0.45) {
    const [ctx, out] = io(); if (!ctx) return;
    const t = ctx.currentTime, d = 0.38 + Math.random() * 0.12;
    const src = ctx.createBufferSource(); src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 7;
    f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(1700, t + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0008, t + d + 0.05);
    src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random()); src.stop(t + d + 0.1);
  },
  /** bottle cap pop + fizz */
  fizz(vol = 0.4) {
    const [ctx, out] = io(); if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.05);
    const og = ctx.createGain(); og.gain.setValueAtTime(vol, t); og.gain.exponentialRampToValueAtTime(0.0006, t + 0.07);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.08);
    const src = ctx.createBufferSource(); src.buffer = noise(ctx);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + 0.03); g.gain.linearRampToValueAtTime(vol * 0.55, t + 0.09); g.gain.exponentialRampToValueAtTime(0.0006, t + 1.4);
    src.connect(hp); hp.connect(g); g.connect(out); src.start(t, Math.random()); src.stop(t + 1.5);
  },
  /** one gulp: a low "glug" bubble */
  glug(vol = 0.45) {
    const [ctx, out] = io(); if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const w = t + i * 0.16;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, w); o.frequency.exponentialRampToValueAtTime(320, w + 0.08);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, w); g.gain.linearRampToValueAtTime(vol, w + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, w + 0.13);
      o.connect(g); g.connect(out); o.start(w); o.stop(w + 0.15);
    }
  },

  /** steel bowl / ladle clink */
  clink(vol = 0.25) {
    const [ctx, out] = io(); if (!ctx) return;
    const t = ctx.currentTime;
    for (const [fr, dec] of [[2840, 0.5], [4120, 0.35], [6230, 0.22]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr * (0.98 + Math.random() * 0.04);
      const g = ctx.createGain(); g.gain.setValueAtTime(vol / 3, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dec + 0.02);
    }
  },
};
export default Foley;

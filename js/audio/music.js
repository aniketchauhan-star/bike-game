// Music player: in-game BGM (procedural Pahadi music) + "Race Beat" + the Pahadi songs cut from the mashup.
// Songs stream through an <audio> element routed into Web Audio (so volume/ducking also work on iPhone).
import { Audio } from './audio.js';

export const MusicPlayer = {
  tracks: [],          // [{id, title, src?, type:'synth'|'file', dur, loop}]
  index: 0, playing: false, shuffle: false, volume: 0.55, scene: 'menu', duck: 1,
  el: null, node: null, gain: null, listeners: new Set(),

  async load() {
    this.tracks = [
      { id: 'game', title: 'Game Music — Pahadi BGM', type: 'synth' },
      { id: 'beat', title: 'Race Beat', type: 'file', src: 'assets/sfx/race_beat.mp3', loop: true },
    ];
    try {
      const r = await fetch('assets/songs/songs.json'); const list = await r.json();
      for (const s of list) this.tracks.push({ id: s.file, title: s.title, type: 'file', src: 'assets/songs/' + s.file, dur: s.dur });
    } catch { /* no songs */ }
  },

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const f of this.listeners) try { f(this.state()); } catch { /* */ } },
  state() { const t = this.tracks[this.index]; return { index: this.index, title: t?.title || '', playing: this.playing, shuffle: this.shuffle, tracks: this.tracks, type: t?.type }; },

  _ensureEl() {
    if (this.el) return;
    const el = document.createElement('audio'); el.preload = 'auto'; el.setAttribute('playsinline', '');
    el.addEventListener('ended', () => { if (!this.tracks[this.index]?.loop) this.next(); });
    el.addEventListener('error', () => { console.warn('song failed', el.src); setTimeout(() => this.next(), 300); });
    this.el = el;
    this._route();
  },
  _route() {
    const ctx = Audio.context;
    if (!this.el || this.node || !ctx) { if (this.el && !ctx) this.el.volume = this.volume * this.duck; return; }
    try {
      this.node = ctx.createMediaElementSource(this.el);
      this.gain = ctx.createGain(); this.gain.gain.value = this.volume * this.duck;
      this.node.connect(this.gain); this.gain.connect(Audio.voiceOut || ctx.destination);
      this.el.volume = 1;
    } catch (e) { console.warn('media routing failed', e); }
  },
  /** call after Audio.unlock() */
  attach() { this._route(); },

  setVolume(v) {
    this.volume = v; this._applyGain();
  },
  setDuck(on) { this.duck = on ? 0.35 : 1; this._applyGain(); },
  _applyGain() {
    const v = this.volume * this.duck;
    if (this.gain) this.gain.gain.setTargetAtTime(v, Audio.context.currentTime, 0.12);
    else if (this.el) this.el.volume = Math.min(1, v);
  },

  /** scene = 'menu' | 'race' | 'results' (used when the synth BGM is selected) */
  setScene(scene) {
    this.scene = scene;
    const t = this.tracks[this.index];
    if (t?.type === 'synth' && this.playing) Audio.playMusic(scene);
  },

  select(i, autoplay = true) {
    if (!this.tracks.length) return;
    this.index = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
    const t = this.tracks[this.index];
    if (t.type === 'synth') {
      if (this.el) this.el.pause();
      if (autoplay) { Audio.playMusic(this.scene); this.playing = true; }
    } else {
      Audio.playMusic(null);
      this._ensureEl(); this._route();
      this.el.loop = !!t.loop;
      this.el.src = t.src;
      if (autoplay) { const p = this.el.play(); if (p && p.catch) p.catch(() => {}); this.playing = true; }
    }
    this.emit();
  },
  play() {
    const t = this.tracks[this.index];
    if (!t) return;
    if (t.type === 'synth') Audio.playMusic(this.scene);
    else { this._ensureEl(); if (!this.el.src) return this.select(this.index); const p = this.el.play(); if (p && p.catch) p.catch(() => {}); }
    this.playing = true; this.emit();
  },
  pause() {
    const t = this.tracks[this.index];
    if (t?.type === 'synth') Audio.playMusic(null); else this.el?.pause();
    this.playing = false; this.emit();
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  next() {
    if (this.shuffle && this.tracks.length > 3) { let i; do { i = 2 + Math.floor(Math.random() * (this.tracks.length - 2)); } while (i === this.index); return this.select(i); }
    let i = this.index + 1; if (i >= this.tracks.length) i = 0;
    this.select(i);
  },
  prev() { let i = this.index - 1; if (i < 0) i = this.tracks.length - 1; this.select(i); },
  setShuffle(on) { this.shuffle = on; this.emit(); },
  /** pause / resume with the game pause */
  gamePause(on) { if (this.tracks[this.index]?.type === 'file' && this.el) { if (on) this.el.pause(); else if (this.playing) this.el.play().catch(() => {}); } },
};
export default MusicPlayer;

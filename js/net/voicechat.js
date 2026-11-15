// Multiplayer voice chat: WebRTC audio mesh between the (max 3) human players in a room.
// Signalling goes through the existing room transport (WebSocket relay or PeerJS). Everyone hears by default;
// the mic is opt-in (🎤). Browsers only give microphone access on secure pages (https:// or localhost).
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

export class VoiceChat {
  constructor(mp, { onState } = {}) {
    this.mp = mp; this.onState = onState || (() => {});
    this.peers = new Map();   // id -> { pc, audio, analyser, data, level, name }
    this.enabled = false; this.micOn = false; this.speakerOn = true; this.volume = 1;
    this.stream = null; this.track = null; this.ctx = null;
    this.canMic = !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    this.levelTimer = null;
  }

  get myId() { return this.mp.id; }

  /** join the room's voice mesh (listen-only until the mic is switched on) */
  enable() {
    if (this.enabled || !this.mp.inRoom) return;
    this.enabled = true;
    this.mp.send({ t: 'vc', k: 'join' });
    this.levelTimer = setInterval(() => this.measure(), 120);
    this.emit();
  }
  disable() {
    this.enabled = false;
    for (const id of [...this.peers.keys()]) this.drop(id);
    if (this.track) { this.track.stop(); this.track = null; this.stream = null; }
    this.micOn = false; clearInterval(this.levelTimer);
    this.emit();
  }

  async setMic(on) {
    if (!this.enabled) this.enable();
    if (on && !this.canMic) { this.emit('Mic ke liye https:// wala link kholo (Terminal me dikhta hai)'); return false; }
    if (on && !this.track) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        this.track = this.stream.getAudioTracks()[0];
        for (const p of this.peers.values()) p.sender?.replaceTrack(this.track).catch(() => {});
      } catch (e) { this.emit('Mic allow nahi hua — browser me permission do'); return false; }
    }
    for (const p of this.peers.values()) p.audio?.play?.().catch(() => {});
    this.micOn = !!on && !!this.track;
    if (this.track) this.track.enabled = this.micOn;
    this.emit();
    return this.micOn;
  }
  setSpeaker(on) {
    this.speakerOn = !!on;
    for (const p of this.peers.values()) if (p.audio) { p.audio.muted = !this.speakerOn; p.audio.play?.().catch(() => {}); }
    this.emit();
  }
  setVolume(v) { this.volume = v; for (const p of this.peers.values()) if (p.audio) p.audio.volume = Math.min(1, v); }

  // ---------------------------------------------------------------- signalling
  onMsg(m) {
    if (!this.enabled || !m.from || m.from === this.myId) return;
    const id = m.from;
    switch (m.k) {
      case 'join': this.mp.tr.sendTo(id, { t: 'vc', k: 'here' }); if (this.myId < id) this.call(id); break;
      case 'here': if (this.myId < id) this.call(id); break;
      case 'offer': this.answer(id, m.sdp); break;
      case 'answer': { const p = this.peers.get(id); if (p) p.pc.setRemoteDescription(m.sdp).catch(() => {}); break; }
      case 'ice': { const p = this.peers.get(id); if (p && m.c) p.pc.addIceCandidate(m.c).catch(() => {}); break; }
      case 'bye': this.drop(id); break;
    }
  }
  peerLeft(id) { this.drop(id); }

  makePeer(id) {
    this.drop(id);
    const pc = new RTCPeerConnection(ICE);
    const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (this.track) tr.sender.replaceTrack(this.track).catch(() => {});
    const peer = { pc, sender: tr.sender, audio: null, analyser: null, data: null, level: 0 };
    pc.onicecandidate = (e) => { if (e.candidate) this.mp.tr.sendTo(id, { t: 'vc', k: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      const a = document.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); a.srcObject = stream;
      a.muted = !this.speakerOn; a.volume = Math.min(1, this.volume); a.style.display = 'none'; document.body.appendChild(a);
      a.play?.().catch(() => {});
      peer.audio = a;
      try {
        this.ctx = this.ctx || window.__app?.audio?.context || new (window.AudioContext || window.webkitAudioContext)();
        const src = this.ctx.createMediaStreamSource(stream); const an = this.ctx.createAnalyser(); an.fftSize = 256;
        src.connect(an); peer.analyser = an; peer.data = new Uint8Array(an.fftSize);
      } catch { /* level meter optional */ }
      this.emit();
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(id); this.emit(); };
    this.peers.set(id, peer);
    return peer;
  }
  async call(id) {
    if (this.peers.has(id)) return; // already connected / connecting
    const p = this.makePeer(id);
    const offer = await p.pc.createOffer(); await p.pc.setLocalDescription(offer);
    this.mp.tr.sendTo(id, { t: 'vc', k: 'offer', sdp: p.pc.localDescription.toJSON ? p.pc.localDescription.toJSON() : p.pc.localDescription });
  }
  async answer(id, sdp) {
    const p = this.makePeer(id);
    await p.pc.setRemoteDescription(sdp);
    const ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans);
    this.mp.tr.sendTo(id, { t: 'vc', k: 'answer', sdp: p.pc.localDescription.toJSON ? p.pc.localDescription.toJSON() : p.pc.localDescription });
  }
  drop(id) {
    const p = this.peers.get(id); if (!p) return;
    try { p.pc.close(); } catch { /* */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this.peers.delete(id);
  }

  // ---------------------------------------------------------------- speaking indicators
  measure() {
    for (const p of this.peers.values()) {
      if (!p.analyser) continue;
      p.analyser.getByteTimeDomainData(p.data);
      let sum = 0; for (let i = 0; i < p.data.length; i++) { const v = (p.data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / p.data.length);
      p.level = Math.max(rms, p.level * 0.7);
    }
    this.onState({ ...this.state(), tick: true });
  }
  speaking() { const out = []; for (const [id, p] of this.peers) if (p.level > 0.04) out.push(id); return out; }
  state(msg) {
    return { enabled: this.enabled, micOn: this.micOn, speakerOn: this.speakerOn, canMic: this.canMic, peers: [...this.peers.keys()],
      connected: [...this.peers.values()].filter(p => p.pc.connectionState === 'connected').length, speaking: this.speaking(), msg };
  }
  emit(msg) { this.onState(this.state(msg)); }
}

// Multiplayer: rooms of up to 3 riders. Transport = WebSocket relay (server.js) or PeerJS P2P fallback (static hosting).
// Host is authoritative for the room (player list, rider picks, CPU fill, race start + clock).
import { CHARACTERS } from '../config.js';

const MAX = 3;

// ------------------------------------------------------------------ WebSocket transport (server.js)
class WSTransport {
  static open(timeout = 2500) {
    return new Promise((res, rej) => {
      let ws;
      try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); } catch (e) { rej(e); return; }
      const t = setTimeout(() => { try { ws.close(); } catch { /* */ } rej(new Error('timeout')); }, timeout);
      ws.onerror = () => { clearTimeout(t); rej(new Error('ws error')); };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'hello') { clearTimeout(t); res(new WSTransport(ws, m.id)); }
      };
    });
  }
  constructor(ws, id) {
    this.ws = ws; this.id = id; this.kind = 'ws';
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onmsg?.(m); };
    ws.onerror = null;
    ws.onclose = () => this.onclose?.();
  }
  create(name) { this.raw({ t: 'create', name }); }
  join(code, name) { this.raw({ t: 'join', code, name }); }
  send(m) { this.raw(m); }
  sendTo(id, m) { this.raw({ ...m, to: id }); }
  leave() { this.raw({ t: 'leave' }); }
  raw(m) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { try { this.ws.close(); } catch { /* */ } }
}

// ------------------------------------------------------------------ PeerJS transport (no server needed)
function loadPeerJS() {
  if (window.peerjs?.Peer || window.Peer) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/peerjs.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] };

class P2PTransport {
  constructor() { this.kind = 'p2p'; this.conns = new Map(); this.id = null; this.isHost = false; this.names = new Map(); }
  async create(name) {
    await loadPeerJS(); const PeerC = window.peerjs?.Peer || window.Peer;
    const code = makeCode();
    this.peer = new PeerC('ukriders-' + code.toLowerCase(), { config: ICE, debug: 0 });
    this.isHost = true;
    this.peer.on('open', (id) => { this.id = id; this.code = code; this.names.set(id, name); this.onmsg?.({ t: 'created', code, id, hostId: id }); });
    this.peer.on('error', (e) => { this.onmsg?.({ t: 'error', code: e.type, msg: e.type === 'unavailable-id' ? 'Code busy, dobara try karo' : 'P2P error: ' + e.type }); });
    this.peer.on('connection', (c) => {
      c.on('data', (m) => this.hostRecv(c, m));
      c.on('close', () => this.hostDrop(c));
      c.on('error', () => this.hostDrop(c));
    });
  }
  hostRecv(c, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') {
      if (this.conns.size + 1 >= MAX) { c.send({ t: 'error', code: 'full', msg: 'Room full hai (max 3 riders).' }); setTimeout(() => c.close(), 300); return; }
      if (this.started) { c.send({ t: 'error', code: 'started', msg: 'Race already shuru ho chuki hai.' }); setTimeout(() => c.close(), 300); return; }
      const peers = [{ id: this.id, name: this.names.get(this.id) }, ...[...this.conns.values()].map(x => ({ id: x.peer, name: this.names.get(x.peer) }))];
      for (const x of this.conns.values()) x.send({ t: 'peer-join', id: c.peer, name: m.name });
      this.conns.set(c.peer, c); this.names.set(c.peer, m.name);
      c.send({ t: 'joined', code: this.code, id: c.peer, hostId: this.id, peers });
      this.onmsg?.({ t: 'peer-join', id: c.peer, name: m.name });
      return;
    }
    m.from = c.peer;
    if (m.to) { if (m.to === this.id) this.onmsg?.(m); else this.conns.get(m.to)?.send(m); return; }
    for (const [id, x] of this.conns) if (id !== c.peer) x.send(m);
    this.onmsg?.(m);
  }
  hostDrop(c) {
    if (!this.conns.has(c.peer)) return;
    this.conns.delete(c.peer);
    for (const x of this.conns.values()) x.send({ t: 'peer-leave', id: c.peer });
    this.onmsg?.({ t: 'peer-leave', id: c.peer });
  }
  async join(code, name) {
    await loadPeerJS(); const PeerC = window.peerjs?.Peer || window.Peer;
    this.peer = new PeerC(undefined, { config: ICE, debug: 0 });
    this.peer.on('error', (e) => this.onmsg?.({ t: 'error', code: e.type, msg: e.type === 'peer-unavailable' ? 'Room nahi mila. Code check karo.' : 'P2P error: ' + e.type }));
    this.peer.on('open', (id) => {
      this.id = id;
      const c = this.peer.connect('ukriders-' + code.toLowerCase(), { reliable: true, serialization: 'json' });
      this.hostConn = c;
      c.on('open', () => c.send({ t: 'join', name }));
      c.on('data', (m) => this.onmsg?.(m));
      c.on('close', () => this.onmsg?.({ t: 'host-left' }));
    });
  }
  send(m) {
    if (this.isHost) { m.from = this.id; for (const x of this.conns.values()) x.send(m); if (m.t === 'race-start') this.started = true; if (m.t === 'back-to-lobby') this.started = false; }
    else this.hostConn?.open && this.hostConn.send(m);
  }
  sendTo(id, m) {
    if (this.isHost) { m.from = this.id; this.conns.get(id)?.send(m); }
    else this.hostConn?.open && this.hostConn.send({ ...m, to: id });
  }
  leave() { this.close(); }
  close() { try { this.peer?.destroy(); } catch { /* */ } }
}

function makeCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)]; return c; }

// ------------------------------------------------------------------ room logic
export class Multiplayer {
  constructor(app) {
    this.app = app; this.tr = null; this.room = null; this.id = null; this.inRoom = false;
    this.offset = 0; this.bestRtt = 1e9; this.pingTimer = null; this.handlers = {};
  }
  on(t, fn) { this.handlers[t] = fn; }
  get isHost() { return this.room && this.room.hostId === this.id; }
  get transport() { return this.tr?.kind; }

  async ensure(preferP2P = false) {
    if (this.tr) return;
    if (!preferP2P && location.protocol.startsWith('http')) {
      try { this.tr = await WSTransport.open(); } catch { this.tr = null; }
    }
    if (!this.tr) this.tr = new P2PTransport();
    this.tr.onmsg = (m) => this.onMsg(m);
    this.tr.onclose = () => { if (this.inRoom) this.app.onMpClosed?.('Server se connection toot gaya'); this.reset(); };
  }
  reset() { this.inRoom = false; this.room = null; clearInterval(this.pingTimer); this.tr?.close?.(); this.tr = null; }

  async create(name, char) { await this.ensure(); this.myName = name; this.myChar = char; this.tr.create(name); }
  async join(code, name, char) { await this.ensure(); this.myName = name; this.myChar = char; this.tr.join(code, name); }
  leave() { try { this.tr?.leave(); } catch { /* */ } this.reset(); }
  send(m) { this.tr?.send(m); }

  hostNow() { return performance.now() + this.offset; } // host clock estimate (host: offset 0)

  broadcastRoom() { if (!this.isHost) return; this.send({ t: 'room', room: this.room }); this.app.onRoom?.(this.room); }
  freeChar(pref) { const taken = new Set(this.room.players.map(p => p.char)); if (pref && !taken.has(pref)) return pref; return CHARACTERS.map(c => c.id).find(c => !taken.has(c)) || pref; }

  onMsg(m) {
    switch (m.t) {
      case 'created':
        this.id = m.id; this.inRoom = true;
        this.room = { code: m.code, hostId: m.id, players: [{ id: m.id, name: this.myName, char: this.myChar }], cpuFill: true };
        this.app.onRoom?.(this.room); break;
      case 'joined':
        this.id = m.id; this.inRoom = true;
        this.room = { code: m.code, hostId: m.hostId, players: [], cpuFill: true };
        this.tr.sendTo(m.hostId, { t: 'hello', name: this.myName, char: this.myChar });
        this.startPing(); this.app.onRoom?.(this.room); break;
      case 'peer-join': break; // wait for hello
      case 'hello':
        if (!this.isHost) break;
        if (!this.room.players.find(p => p.id === m.from)) this.room.players.push({ id: m.from, name: String(m.name || 'Rider').slice(0, 14), char: this.freeChar(m.char) });
        this.broadcastRoom(); this.app.audio?.ui?.('join'); break;
      case 'peer-leave':
        this.app.voice?.peerLeft(m.id);
        if (this.room) { this.room.players = this.room.players.filter(p => p.id !== m.id); if (this.isHost) this.broadcastRoom(); else this.app.onRoom?.(this.room); }
        this.app.onPeerLeave?.(m.id); break;
      case 'room': if (!this.isHost) { this.room = m.room; this.app.onRoom?.(this.room); } break;
      case 'pick':
        if (!this.isHost) break;
        { const p = this.room.players.find(x => x.id === m.from); const taken = this.room.players.some(x => x.char === m.char && x.id !== m.from); if (p && !taken) p.char = m.char; this.broadcastRoom(); } break;
      case 'ping': if (this.isHost) this.tr.sendTo(m.from, { t: 'pong', ts: m.ts, h: performance.now() }); break;
      case 'pong': {
        const now = performance.now(); const rtt = now - m.ts;
        if (rtt < this.bestRtt * 1.3) { const off = m.h + rtt / 2 - now; this.offset = this.bestRtt === 1e9 ? off : this.offset * 0.6 + off * 0.4; this.bestRtt = Math.min(this.bestRtt, rtt); }
        break;
      }
      case 'race-start': this.app.onMpRaceStart?.(m); break;
      case 'back-to-lobby': this.app.onMpBackToLobby?.(); break;
      case 'host-left': this.app.onMpClosed?.('Host ne room chhod diya'); this.reset(); break;
      case 'error': this.app.onMpError?.(m.msg || 'Error'); break;
      case 'vc': this.app.voice?.onMsg(m); break;
      default: this.app.race?.onNet?.(m);
    }
  }
  startPing() {
    clearInterval(this.pingTimer);
    const ping = () => { if (this.room && !this.isHost) this.tr.sendTo(this.room.hostId, { t: 'ping', ts: performance.now() }); };
    ping(); setTimeout(ping, 300); setTimeout(ping, 700);
    this.pingTimer = setInterval(ping, 2500);
  }
  pick(char) {
    this.myChar = char;
    if (this.isHost) { const me = this.room.players.find(p => p.id === this.id); if (me && !this.room.players.some(p => p.char === char && p.id !== this.id)) me.char = char; this.broadcastRoom(); }
    else this.tr.sendTo(this.room.hostId, { t: 'pick', char });
  }
  setCpu(on) { if (!this.isHost) return; this.room.cpuFill = on; this.broadcastRoom(); }

  /** host: start the race for everyone. returns the start message */
  startRace(opts) {
    const entrants = this.room.players.map(p => ({ id: p.id, charId: p.char, name: p.name, human: true }));
    if (this.room.cpuFill) for (const c of CHARACTERS) if (!entrants.some(e => e.charId === c.id)) entrants.push({ id: 'cpu-' + c.id, charId: c.id, name: c.name, human: false });
    const msg = { t: 'race-start', entrants, ...opts };
    this.send(msg);
    return msg;
  }

  async joinUrl() {
    const code = this.room?.code; if (!code) return '';
    let base = location.origin + location.pathname;
    if (this.transport === 'ws' && /^(localhost|127\.|\[::1\])/.test(location.hostname)) {
      try { const info = await (await fetch('/api/info')).json(); if (info.lanHttps?.length) base = info.lanHttps[0]; else if (info.lan?.length) base = info.lan[0]; } catch { /* */ }
    } else if (this.transport === 'ws' && location.protocol === 'http:') {
      // on plain http: hand out the https link so friends can use the mic for voice chat
      try { const info = await (await fetch('/api/info')).json(); if (info.httpsPort) base = `https://${location.hostname}:${info.httpsPort}/`; } catch { /* */ }
    }
    return base + (base.includes('?') ? '&' : '?') + 'room=' + code;
  }
}

/** draw a QR code into an element (uses vendor/qrcode.js) */
export async function drawQR(el, text) {
  if (!window.qrcode) await new Promise((res) => { const s = document.createElement('script'); s.src = 'vendor/qrcode.js'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  if (!window.qrcode || !el) return;
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), sc = 6, c = document.createElement('canvas'); c.width = c.height = n * sc + sc * 4;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect(col * sc + sc * 2, r * sc + sc * 2, sc, sc);
  el.innerHTML = ''; el.appendChild(c);
}

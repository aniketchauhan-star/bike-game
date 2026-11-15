#!/usr/bin/env node
/*
 * UTTARAKHAND RIDERS — game server
 * --------------------------------
 * Zero-dependency Node.js server:
 *   1) serves the game files (index.html, js, assets ...)
 *   2) runs the multiplayer rooms over WebSocket (/ws)
 *   3) also serves everything over HTTPS (port 8443, auto self-signed certificate) — phones need https for
 *      the microphone (voice chat) and tilt steering
 *
 * Run:   node server.js            (default port 8080)
 *        PORT=3000 node server.js
 * Then open the printed link on your phone(s) — all devices on the same Wi-Fi.
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT || String(PORT === 8080 ? 8443 : PORT + 363), 10);
const MAX_PLAYERS = 3;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8',
};

function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // prefer typical home-wifi ranges first
  out.sort((a, b) => (b.startsWith('192.168.') ? 1 : 0) - (a.startsWith('192.168.') ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------- self-signed certificate (pure Node, no openssl)
function der(tag, content) {
  const n = content.length; let len;
  if (n < 128) len = Buffer.from([n]);
  else { const b = []; let v = n; while (v > 0) { b.unshift(v & 0xff); v >>= 8; } len = Buffer.from([0x80 | b.length, ...b]); }
  return Buffer.concat([Buffer.from([tag]), len, content]);
}
const SEQ = (...a) => der(0x30, Buffer.concat(a));
const SET = (...a) => der(0x31, Buffer.concat(a));
const INT = (b) => der(0x02, (b[0] & 0x80) ? Buffer.concat([Buffer.from([0]), b]) : b);
const OID = (str) => {
  const p = str.split('.').map(Number); const out = [40 * p[0] + p[1]];
  for (const v0 of p.slice(2)) { let v = v0; const st = [v & 0x7f]; v = Math.floor(v / 128); while (v > 0) { st.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(...st); }
  return der(0x06, Buffer.from(out));
};
const UTC = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const CTX = (n, c) => der(0xa0 | n, c);
function makeCert(ips) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = SEQ(SET(SEQ(OID('2.5.4.3'), der(0x0c, Buffer.from('Uttarakhand Riders (LAN)')))));
  const now = Date.now();
  const san = SEQ(der(0x82, Buffer.from('localhost')), ...['127.0.0.1', ...ips].map(ip => der(0x87, Buffer.from(ip.split('.').map(Number)))));
  const exts = CTX(3, SEQ(
    SEQ(OID('2.5.29.17'), der(0x04, san)),
    SEQ(OID('2.5.29.19'), der(0x04, SEQ())),
    SEQ(OID('2.5.29.37'), der(0x04, SEQ(OID('1.3.6.1.5.5.7.3.1')))),
  ));
  const sigAlg = SEQ(OID('1.2.840.10045.4.3.2'));
  const serial = crypto.randomBytes(12); serial[0] &= 0x7f;
  const tbs = SEQ(CTX(0, INT(Buffer.from([2]))), INT(serial), sigAlg, name,
    SEQ(UTC(new Date(now - 86400e3)), UTC(new Date(now + 5 * 365 * 86400e3))), name,
    publicKey.export({ type: 'spki', format: 'der' }), exts);
  const sig = crypto.sign('sha256', tbs, privateKey);
  const certDer = SEQ(tbs, sigAlg, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const pem = '-----BEGIN CERTIFICATE-----\n' + certDer.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END CERTIFICATE-----\n';
  return { cert: pem, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
function loadOrMakeCert() {
  const dir = path.join(ROOT, '.cert'); const ips = lanAddresses();
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'ips.json'), 'utf8'));
    if (JSON.stringify(meta) === JSON.stringify(ips)) return { cert: fs.readFileSync(path.join(dir, 'cert.pem')), key: fs.readFileSync(path.join(dir, 'key.pem')) };
  } catch { /* make a new one */ }
  const c = makeCert(ips);
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'cert.pem'), c.cert); fs.writeFileSync(path.join(dir, 'key.pem'), c.key); fs.writeFileSync(path.join(dir, 'ips.json'), JSON.stringify(ips)); } catch { /* read-only folder: keep in memory */ }
  return c;
}

// ---------------------------------------------------------------- static files
const handler = (req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }

  if (urlPath === '/api/info') {
    const body = JSON.stringify({
      ok: true, port: PORT, ws: true, httpsPort: httpsServer ? HTTPS_PORT : null,
      lan: lanAddresses().map(ip => `http://${ip}:${PORT}/`),
      lanHttps: httpsServer ? lanAddresses().map(ip => `https://${ip}:${HTTPS_PORT}/`) : [],
      rooms: rooms.size,
    });
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(body);
  }

  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  const base = path.basename(filePath);
  if (base === 'server.js' || base.startsWith('.')) { res.writeHead(404); return res.end('Not found'); }
  // original source material (photos / raw recordings) is never served — the game only uses /assets
  const parts = path.relative(ROOT, filePath).split(path.sep);
  if (parts.some(p => p.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); } // .cert (private key), .DS_Store …
  const rel = parts[0];
  if (['characters images ', 'characters images', 'voice overs ', 'voice overs', 'game sound'].includes(rel)) { res.writeHead(404); return res.end('Not found'); }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
};
const server = http.createServer(handler);
let httpsServer = null;
try { httpsServer = https.createServer(loadOrMakeCert(), handler); }
catch (e) { console.warn('HTTPS band hai (certificate nahi ban paya):', e.message); }

// ---------------------------------------------------------------- tiny WebSocket (RFC 6455)
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
let nextId = 1;
const rooms = new Map(); // code -> { code, hostId, clients: Map(id -> client) }

function wsSend(client, obj) {
  if (client.closed) return;
  const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
  let header;
  if (data.length < 126) { header = Buffer.from([0x81, data.length]); }
  else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  try { client.socket.write(Buffer.concat([header, data])); } catch { /* ignore */ }
}
function wsControl(client, opcode, payload = Buffer.alloc(0)) {
  if (client.closed) return;
  try { client.socket.write(Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload])); } catch { /* ignore */ }
}

function makeCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)]; } while (rooms.has(c));
  return c;
}

function roomOf(client) { return client.room ? rooms.get(client.room) : null; }

function leaveRoom(client) {
  const room = roomOf(client);
  if (!room) return;
  room.clients.delete(client.id);
  client.room = null;
  if (room.hostId === client.id) {
    for (const c of room.clients.values()) { wsSend(c, { t: 'host-left' }); c.room = null; }
    rooms.delete(room.code);
    console.log(`[room ${room.code}] closed (host left)`);
  } else {
    for (const c of room.clients.values()) wsSend(c, { t: 'peer-leave', id: client.id });
    if (room.clients.size === 0) rooms.delete(room.code);
  }
}

function onMessage(client, text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!msg || typeof msg.t !== 'string') return;

  switch (msg.t) {
    case 'ping': wsSend(client, { t: 'pong', ts: msg.ts, server: Date.now() }); return;
    case 'create': {
      leaveRoom(client);
      const code = makeCode();
      const room = { code, hostId: client.id, clients: new Map([[client.id, client]]) };
      rooms.set(code, room);
      client.room = code; client.name = String(msg.name || 'Player').slice(0, 16);
      wsSend(client, { t: 'created', code, id: client.id, hostId: client.id });
      console.log(`[room ${code}] created by ${client.name}`);
      return;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return wsSend(client, { t: 'error', code: 'no-room', msg: 'Room nahi mila. Code check karo.' });
      if (room.clients.size >= MAX_PLAYERS) return wsSend(client, { t: 'error', code: 'full', msg: 'Room full hai (max 3 riders).' });
      if (room.started) return wsSend(client, { t: 'error', code: 'started', msg: 'Race already shuru ho chuki hai.' });
      leaveRoom(client);
      client.room = code; client.name = String(msg.name || 'Player').slice(0, 16);
      for (const c of room.clients.values()) wsSend(c, { t: 'peer-join', id: client.id, name: client.name });
      room.clients.set(client.id, client);
      wsSend(client, { t: 'joined', code, id: client.id, hostId: room.hostId, peers: [...room.clients.values()].filter(c => c !== client).map(c => ({ id: c.id, name: c.name })) });
      console.log(`[room ${code}] ${client.name} joined (${room.clients.size}/${MAX_PLAYERS})`);
      return;
    }
    case 'leave': leaveRoom(client); return;
    default: {
      // relay inside the room (optionally to a single peer)
      const room = roomOf(client);
      if (!room) return;
      if (msg.t === 'race-start' && client.id === room.hostId) room.started = true;
      if (msg.t === 'back-to-lobby' && client.id === room.hostId) room.started = false;
      msg.from = client.id;
      const out = JSON.stringify(msg);
      if (msg.to) { const c = room.clients.get(msg.to); if (c) wsSend(c, out); }
      else for (const c of room.clients.values()) if (c !== client) wsSend(c, out);
    }
  }
}

function onUpgrade(req, socket) {
  if (!req.url.startsWith('/ws') || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const client = { id: 'p' + (nextId++), socket, room: null, name: 'Player', closed: false, buf: Buffer.alloc(0), frag: [], alive: true };
  wsSend(client, { t: 'hello', id: client.id });

  socket.on('data', chunk => {
    client.buf = Buffer.concat([client.buf, chunk]);
    while (client.buf.length >= 2) {
      const b0 = client.buf[0], b1 = client.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (client.buf.length < 4) return; len = client.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (client.buf.length < 10) return; len = Number(client.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { socket.destroy(); return; } // 1MB guard
      const maskOff = off; if (masked) off += 4;
      if (client.buf.length < off + len) return;
      let payload = client.buf.subarray(off, off + len);
      if (masked) {
        const mask = client.buf.subarray(maskOff, maskOff + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      client.buf = client.buf.subarray(off + len);

      if (opcode === 0x8) { wsControl(client, 0x8); socket.end(); return; }
      if (opcode === 0x9) { wsControl(client, 0xA, payload.subarray(0, 125)); continue; }
      if (opcode === 0xA) { client.alive = true; continue; }
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        client.frag.push(payload);
        if (fin) { const text = Buffer.concat(client.frag).toString('utf8'); client.frag = []; onMessage(client, text); }
      }
    }
  });
  const done = () => { if (client.closed) return; client.closed = true; leaveRoom(client); };
  socket.on('close', done);
  socket.on('end', done);
  socket.on('error', done);
  client.timer = setInterval(() => {
    if (client.closed) return clearInterval(client.timer);
    if (!client.alive) { socket.destroy(); return; }
    client.alive = false; wsControl(client, 0x9);
  }, 15000);
}
server.on('upgrade', onUpgrade);
if (httpsServer) httpsServer.on('upgrade', onUpgrade);

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  const line = '─'.repeat(58);
  console.log(`\n${line}\n  🏍️  UTTARAKHAND RIDERS — Ramnagar → Ranikhet\n${line}`);
  console.log(`  Is computer par:   http://localhost:${PORT}/`);
  if (lan.length) {
    console.log('  Phone par (same Wi-Fi):');
    for (const ip of lan) console.log(`     ➜  http://${ip}:${PORT}/`);
    if (httpsServer) {
      console.log('  🎤 Voice chat / mic / tilt ke liye ye HTTPS link kholo:');
      for (const ip of lan) console.log(`     ➜  https://${ip}:${HTTPS_PORT}/`);
      console.log('     (pehli baar "Not private" warning aayegi → Advanced → Proceed dabao)');
    }
  }
  console.log(`${line}\n  Band karne ke liye: Ctrl + C\n`);
});
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0');
  httpsServer.on('error', e => { console.warn(`HTTPS port ${HTTPS_PORT} nahi khula (${e.code}). Voice chat ke liye HTTPS_PORT=8444 try karo.`); });
}
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} busy hai. Doosra port try karo:  PORT=8081 node server.js`);
  else console.error(e);
  process.exit(1);
});

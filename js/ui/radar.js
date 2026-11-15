// GTA-style radar: a pre-rendered top-down map of the whole valley (hill-shaded terrain, forests, Kosi river, roads,
// buildings, landmarks) drawn heading-up around the player, with a purple GPS line to Ranikhet and rider blips.
import { clamp, smoothstep } from '../core/util.js';
import { STEP } from '../world/track.js';

export class Radar {
  constructor(world) {
    this.world = world; const T = world.track; const b = T.bounds; const M = 450;
    this.minX = b.minX - M; this.maxX = b.maxX + M; this.minZ = b.minZ - M; this.maxZ = b.maxZ + M;
    const wM = this.maxX - this.minX, hM = this.maxZ - this.minZ;
    const maxPx = world.quality?.phone ? 1400 : 2048; this.ppm = maxPx / Math.max(wM, hM); // pixels per metre on the map canvas
    this.canvas = document.createElement('canvas'); this.canvas.width = Math.ceil(wM * this.ppm); this.canvas.height = Math.ceil(hM * this.ppm);
    this.render();
  }

  X(x) { return (x - this.minX) * this.ppm; }
  Z(z) { return (z - this.minZ) * this.ppm; }

  render() {
    const w = this.world, T = w.track, ter = w.terrain, rv = w.rivers;
    const ctx = this.canvas.getContext('2d'); const W = this.canvas.width, H = this.canvas.height;
    // --- hill-shaded terrain on a coarse grid, upscaled smoothly
    const G = 12; const gw = Math.ceil((this.maxX - this.minX) / G) + 1, gh = Math.ceil((this.maxZ - this.minZ) / G) + 1;
    const hs = new Float32Array(gw * gh); const q = {};
    const zoneCol = { town: [96, 118, 62], forest: [38, 74, 40], river: [52, 88, 50], mountain: [64, 82, 48], ridge: [44, 78, 46] };
    const info = new Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = this.minX + i * G, z = this.minZ + j * G; ter.sample(x, z, q);
      hs[j * gw + i] = q.h; info[j * gw + i] = [q.zone, q.dist, q.river];
    }
    const small = document.createElement('canvas'); small.width = gw; small.height = gh;
    const sctx = small.getContext('2d'); const img = sctx.createImageData(gw, gh); const d = img.data;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i; const h = hs[k];
      const hx = hs[j * gw + Math.min(gw - 1, i + 1)] - hs[j * gw + Math.max(0, i - 1)];
      const hz = hs[Math.min(gh - 1, j + 1) * gw + i] - hs[Math.max(0, j - 1) * gw + i];
      let nx = -hx / (2 * G), nz = -hz / (2 * G); const nl = Math.hypot(nx, 1, nz);
      const shade = clamp(0.62 + ((nx * -0.6 + nz * -0.6) / nl + 1 / nl * 0.5) * 0.65, 0.45, 1.25);
      const [zone, dist, river] = info[k];
      let c = zoneCol[zone] || zoneCol.forest;
      if (zone === 'town' && dist < 160) c = [120, 128, 84];
      if (dist > 220) c = [c[0] * 0.85, c[1] * 0.95, c[2] * 0.85];
      const slope = Math.hypot(hx, hz) / (2 * G); if (slope > 0.7) c = [c[0] * 0.7 + 40, c[1] * 0.7 + 34, c[2] * 0.7 + 28];
      if (river > 0.3) c = [150, 140, 116];
      const elev = smoothstep(0, 320, h) * 18;
      d[k * 4] = clamp(c[0] * shade + elev, 0, 255); d[k * 4 + 1] = clamp(c[1] * shade + elev, 0, 255); d[k * 4 + 2] = clamp(c[2] * shade + elev * 0.6, 0, 255); d[k * 4 + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    // --- rivers
    const stroke = (pts, width, color, getX = p => p.x, getZ = p => p.z) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      pts.forEach((p, i) => { const X = this.X(getX(p)), Z = this.Z(getZ(p)); i ? ctx.lineTo(X, Z) : ctx.moveTo(X, Z); }); ctx.stroke();
    };
    for (const L of rv.lines) {
      const avgW = L.pts.reduce((s, p) => s + p.w, 0) / L.pts.length;
      stroke(L.pts, Math.max(2, avgW * 2 * this.ppm), '#3f86c4');
      stroke(L.pts, Math.max(1, avgW * 1.2 * this.ppm), '#5aa3dd');
    }
    // --- buildings
    ctx.fillStyle = '#d9cba6';
    for (const r of w.pop?.reserved || []) { const s = Math.max(2.5, r.r * 1.3 * this.ppm); ctx.fillRect(this.X(r.x) - s / 2, this.Z(r.z) - s / 2, s, s); }
    // --- the road
    const roadPts = []; for (let i = 0; i < T.N; i += 2) roadPts.push({ x: T.X[i], z: T.Z[i] });
    stroke(roadPts, Math.max(4, 11 * this.ppm), '#1b1f24');
    stroke(roadPts, Math.max(2.5, 7.5 * this.ppm), '#d7dbe2');
    // --- landmarks
    const m = T.marks; const icon = (s, e, d = 0) => { const p = T.point(s, d); this.icons.push({ x: p.x, z: p.z, e }); };
    this.icons = [];
    icon(m.busStand + 18, '🚌', 18); icon(m.forestGate, '🐅', 0); icon(m.dhaba1, '☕', -10); icon(m.waterfall, '💧', -12); icon(m.village, '🏡', 25); icon(m.dhaba2, '☕', 8); icon(m.church, '⛪', 18);
    if (w.pop?.special?.garjiya) this.icons.push({ x: w.pop.special.garjiya.x, z: w.pop.special.garjiya.z, e: '🛕' });
    this.startP = T.point(T.startS, 0); this.finishP = T.point(T.finishS, 0);
  }

  /** draw onto a visible radar canvas */
  draw(cv, me, racers, finishS) {
    const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height; const T = this.world.track;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    rr(ctx, 0, 0, W, H, 18); ctx.clip();
    ctx.fillStyle = '#16231a'; ctx.fillRect(0, 0, W, H);
    const zoom = clamp(0.95 - me.v * 0.006, 0.5, 0.95) * (W / 360); // px per metre on the radar
    const cx = W / 2, cy = H * 0.64;
    ctx.translate(cx, cy); ctx.rotate(me.yaw + Math.PI); ctx.scale(zoom, zoom);
    ctx.translate(-me.x, -me.z);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, this.minX, this.minZ, this.canvas.width / this.ppm, this.canvas.height / this.ppm);
    // GPS route ahead (GTA purple)
    ctx.strokeStyle = 'rgba(177, 76, 255, 0.95)'; ctx.lineWidth = 6.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); const i0 = Math.max(0, Math.round(me.s / STEP)), i1 = Math.min(T.N - 1, Math.round(finishS / STEP));
    for (let i = i0, k = 0; i <= i1 && k < 400; i += 2, k++) { k ? ctx.lineTo(T.X[i], T.Z[i]) : ctx.moveTo(T.X[i], T.Z[i]); }
    ctx.stroke();
    // icons (counter-rotated so they stay upright)
    ctx.font = '22px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const upright = (x, z, fn) => { ctx.save(); ctx.translate(x, z); ctx.scale(1 / zoom, 1 / zoom); ctx.rotate(-(me.yaw + Math.PI)); fn(); ctx.restore(); };
    for (const ic of this.icons) { if (Math.abs(ic.x - me.x) > 500 || Math.abs(ic.z - me.z) > 500) continue; upright(ic.x, ic.z, () => { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill(); ctx.fillText(ic.e, 0, 1); }); }
    upright(this.finishP.x, this.finishP.z, () => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill(); ctx.fillText('🏁', 0, 1); });
    // other riders
    for (const r of racers) {
      if (r.you) continue;
      upright(r.x, r.z, () => { ctx.rotate(-(r.yaw - me.yaw)); ctx.fillStyle = r.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); });
    }
    ctx.restore();
    // player arrow (GTA style)
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 11); ctx.lineTo(0, 6); ctx.lineTo(-10, 11); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    // north marker on the rim
    const th = me.yaw + Math.PI; let nx = Math.sin(th), ny = -Math.cos(th);
    const k = Math.min((W / 2 - 16) / Math.max(1e-3, Math.abs(nx)), (H / 2 - 16) / Math.max(1e-3, Math.abs(ny)));
    const px = W / 2 + nx * k, py = H / 2 + ny * k;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.arc(px, py, 12, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', px, py + 1);
    // frame
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 3; rr(ctx, 1.5, 1.5, W - 3, H - 3, 17); ctx.stroke();
  }
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

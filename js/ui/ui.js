// DOM UI controller: screens, lobby, panels (mode / map / settings / multiplayer / songs), HUD, intro, toasts, results.
import { CHARACTERS, BIKES, MODES, TIMES_OF_DAY, DIFFICULTIES, QUALITY, TIPS, charById } from '../config.js';
import { MusicPlayer } from '../audio/music.js';
import { fmtTime } from '../game/race.js';
import { Radar } from './radar.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export class UI {
  constructor(app) {
    this.app = app;
    this.game = $('#game');
    this.hudCache = {};
    this.tipI = 0;
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]'); if (!el) return;
      e.stopPropagation();
      this.act(el.dataset.act, el);
    });
    MusicPlayer.on((st) => this.renderMusic(st));
    this.fpsEl = document.createElement('div'); this.fpsEl.className = 'fps hidden'; this.game.appendChild(this.fpsEl);
  }

  act(a, el) {
    const app = this.app; app.audio?.ui?.('click');
    switch (a) {
      case 'prev': app.selectChar(-1); break;
      case 'next': app.selectChar(1); break;
      case 'start': app.startSingle(); break;
      case 'multiplayer': this.openMultiplayer(); break;
      case 'mode': this.openMode(); break;
      case 'map': this.openMap(); break;
      case 'settings': this.openSettings(); break;
      case 'fullscreen': app.toggleFullscreen(); break;
      case 'music': this.openMusic(); break;
      case 'music-next': MusicPlayer.next(); break;
      case 'music-btn': if (MusicPlayer.playing) MusicPlayer.next(); else MusicPlayer.play(); break;
      case 'resume': app.resume(); break;
      case 'restart': app.restart(); break;
      case 'quit': app.quitToLobby(); break;
      case 'lobby': app.quitToLobby(); break;
      case 'again': app.raceAgain(); break;
      case 'skip': app.race?.skipIntro(); break;
      case 'close': this.closePanel(); break;
      case 'diff': app.setSetting('difficulty', el.dataset.val); app.audio?.ui?.('select'); break;
      case 'vc-mic': app.voiceMic(); break;
      case 'vc-spk': app.voiceSpeaker(); break;
    }
  }

  show(name) {
    for (const s of $$('.screen')) s.classList.toggle('active', s.id === 'scr-' + name);
    this.current = name;
  }
  overlay(name, on) { $('#scr-' + name).classList.toggle('active', on); }

  // ---------------------------------------------------------------- loading
  loading(p, step) {
    $('#load-fill').style.width = Math.round(p * 100) + '%';
    $('#load-pct').textContent = Math.round(p * 100) + '%';
    if (step) $('#load-step').textContent = step;
    const now = performance.now();
    if (!this._tipT || now - this._tipT > 3800) { this._tipT = now; $('#load-tip').textContent = TIPS[this.tipI++ % TIPS.length]; }
  }
  showTap(fn) {
    $('#scr-loading').classList.add('ready'); $('.title-place').classList.remove('hidden');

    const b = $('#btn-tap'); b.classList.remove('hidden');
    const go = (e) => { e.preventDefault(); b.removeEventListener('pointerup', go); fn(); };
    b.addEventListener('pointerup', go);
  }

  // ---------------------------------------------------------------- lobby
  setCharacter(c) {
    const bike = BIKES[c.bike];
    this.game.style.setProperty('--acc', c.accent); this.game.style.setProperty('--acc2', c.accent2);
    $('#cc-badge').textContent = c.name[0];
    $('#cc-name').textContent = c.name; $('#cc-tag').textContent = c.tag; $('#cc-age').textContent = c.age.toUpperCase();
    $('#cc-bike-img').src = `assets/bikes/${c.bike}.png`;
    $('#cc-bike').textContent = bike.name; $('#cc-engine').textContent = `${bike.engine} • ${bike.power}`;
    $('#cc-bio').textContent = c.bio;
    const names = { speed: 'TOP SPEED', accel: 'ACCEL', handling: 'HANDLING', brakes: 'BRAKES' };
    $('#cc-stats').innerHTML = Object.entries(bike.stats).map(([k, v]) => `<div class="stat"><span>${names[k]}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`).join('');
    const i = CHARACTERS.indexOf(c);
    $('#char-dots').innerHTML = CHARACTERS.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
  }
  setLobbyInfo(s) {
    const m = MODES.find(x => x.id === s.mode) || MODES[0];
    $('#mode-ico').textContent = m.icon; $('#mode-name').textContent = m.name; $('#mode-desc').textContent = m.desc;
    $('#tod-name').textContent = (TIMES_OF_DAY.find(t => t.id === s.timeOfDay) || TIMES_OF_DAY[0]).name;
    const dif = DIFFICULTIES.find(d => d.id === s.difficulty) || DIFFICULTIES[1];
    $('#diff-name').textContent = dif.name;
    $$('.diff-pills button').forEach(b => b.classList.toggle('on', b.dataset.val === dif.id));
    const dd = $('#diff-desc'); if (dd) dd.textContent = dif.desc || '';
    const dc = $('#diff-card'); if (dc) dc.classList.toggle('off', s.mode !== 'race');
  }
  drawMapThumb(track) {
    const c = $('#map-thumb'); const ctx = c.getContext('2d'); const W = c.width, H = c.height;
    const b = track.bounds; const pad = 14;
    // rotate 90° so the long route lies horizontally: x_screen = -z, y_screen = x
    const sx = (W - pad * 2) / (b.maxZ - b.minZ), sy = (H - pad * 2) / (b.maxX - b.minX); const s = Math.min(sx, sy);
    const X = (z) => W - pad - (z - b.minZ) * s, Y = (x) => pad + (x - b.minX) * s + ((H - pad * 2) - (b.maxX - b.minX) * s) / 2;
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#16261c'); g.addColorStop(1, '#203a2e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const col = { town: '#f5a623', forest: '#7ed321', river: '#2d9cdb', mountain: '#bb6bd9', ridge: '#eb5757' };
    ctx.lineWidth = 4; ctx.lineCap = 'round';
    let last = null;
    for (let i = 0; i < track.N; i += 3) {
      const z = track.zoneIds[i];
      if (z !== last) { if (last) ctx.stroke(); ctx.strokeStyle = col[z]; ctx.beginPath(); ctx.moveTo(X(track.Z[i]), Y(track.X[i])); last = z; }
      else ctx.lineTo(X(track.Z[i]), Y(track.X[i]));
    }
    ctx.stroke();
    const dot = (s, label) => { const i = Math.round(s / 2); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(track.Z[i]), Y(track.X[i]), 4, 0, 7); ctx.fill(); ctx.font = 'bold 12px Rajdhani, sans-serif'; ctx.fillText(label, X(track.Z[i]) - 20, Y(track.X[i]) - 8); };
    dot(track.startS, 'Ramnagar'); dot(track.finishS, 'Ranikhet');
    this.track = track;
  }

  // ---------------------------------------------------------------- panels
  panel(html) { $('#panel').innerHTML = `<button class="close" data-act="close">✕</button>` + html; $('#panel-wrap').classList.remove('hidden'); this.panelOpen = true; }
  closePanel() { $('#panel-wrap').classList.add('hidden'); this.panelOpen = false; this.onPanelClose?.(); this.onPanelClose = null; }

  openMode() {
    const s = this.app.settings;
    this.panel(`<h3>MODE CHUNO</h3><div class="opt-grid">${MODES.map(m => `<div class="opt ${m.id === s.mode ? 'on' : ''}" data-mode="${m.id}"><div class="oi">${m.icon}</div><b>${m.name}</b><small>${m.desc}</small></div>`).join('')}</div>
      <div class="set-h">CPU DIFFICULTY</div><div class="seg" id="diff-seg">${DIFFICULTIES.map(d => `<button data-diff="${d.id}" class="${d.id === s.difficulty ? 'on' : ''}">${d.name}</button>`).join('')}</div>`);
    $$('#panel [data-mode]').forEach(el => el.onclick = () => { this.app.setSetting('mode', el.dataset.mode); this.app.audio?.ui('select'); this.openMode(); });
    $$('#panel [data-diff]').forEach(el => el.onclick = () => { this.app.setSetting('difficulty', el.dataset.diff); this.openMode(); });
  }
  openMap() {
    const s = this.app.settings;
    this.panel(`<h3>MAP • UTTARAKHAND</h3>
      <div class="opt on" style="margin-bottom:1em"><div class="oi">🏔️</div><b>RAMNAGAR → RANIKHET</b><small>Ramnagar bus stand se shuru • Corbett Tiger Reserve ka jungle • Kosi nadi aur Garjiya Devi mandir • Mohan–Bhatronjkhan ke pahadi hairpin bends • Ranikhet cantonment finish. ~5.4 km race track (asli raasta ~95 km).</small></div>
      <div class="set-h">TIME OF DAY</div><div class="opt-grid">${TIMES_OF_DAY.map(t => `<div class="opt ${t.id === s.timeOfDay ? 'on' : ''}" data-tod="${t.id}"><div class="oi">${t.id === 'morning' ? '🌅' : t.id === 'day' ? '☀️' : '🌇'}</div><b>${t.name}</b><small>${t.desc}</small></div>`).join('')}</div>`);
    $$('#panel [data-tod]').forEach(el => el.onclick = () => { this.app.setSetting('timeOfDay', el.dataset.tod); this.app.audio?.ui('select'); this.openMap(); });
  }

  openSettings() {
    const s = this.app.settings;
    const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-val="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const range = (key, min, max, step) => `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">`;
    this.panel(`<h3>SETTINGS</h3>
      <div class="set-h">CONTROLS (MOBILE)</div>
      <div class="set-row"><label>Control Mode<small>Steering kaise karna hai</small></label>${seg('steering', [['buttons', '◀ ▶ LEFT-RIGHT'], ['tilt', '📱 TILT'], ['joystick', '🕹 JOYSTICK']])}</div>
      <div class="set-row"><label>Auto Accelerate<small>Gas apne aap — sirf steer + brake</small></label>${seg('autoGas', [[false, 'OFF'], [true, 'ON']])}</div>
      <div class="set-row"><label>Layout<small>Left-handed = buttons ki side badlo</small></label>${seg('layout', [['right', 'RIGHT HAND'], ['left', 'LEFT HAND']])}</div>
      <div class="set-row"><label>Tilt Sensitivity<small>Tilt mode ke liye (HTTPS link chahiye)</small></label>${range('tiltSens', 0.5, 2, 0.1)}</div>
      <div class="set-row"><label>Vibration</label>${seg('vibrate', [[true, 'ON'], [false, 'OFF']])}</div>
      <div class="set-h">GRAPHICS</div>
      <div class="set-row"><label>Quality<small>Phone garam ho to LOW</small></label>${seg('quality', Object.values(QUALITY).map(q => [q.id, q.name]))}</div>
      <div class="set-row"><label>FPS Limit</label>${seg('fpsLimit', [[30, '30'], [60, '60'], [0, 'MAX']])}</div>
      <div class="set-row"><label>Show FPS</label>${seg('showFps', [[true, 'ON'], [false, 'OFF']])}</div>
      <div class="set-row"><label>Screen<small>16:9 ya poori screen</small></label>${seg('aspect', [['16:9', '16:9'], ['fill', 'FULL']])}</div>
      <div class="set-row"><label>Camera</label>${seg('camera', [['chase', 'CHASE'], ['far', 'FAR'], ['helmet', 'HELMET']])}</div>
      <div class="set-h">SOUND</div>
      <div class="set-row"><label>Master</label>${range('master', 0, 1, 0.05)}</div>
      <div class="set-row"><label>Music / Songs</label>${range('music', 0, 1, 0.05)}</div>
      <div class="set-row"><label>Effects (Engine, Animals)</label>${range('sfx', 0, 1, 0.05)}</div>
      <div class="set-row"><label>Voice (Riders)</label>${range('voice', 0, 1.5, 0.05)}</div>
      <div class="set-row"><label>Desktop keys<small>Info</small></label><span style="color:var(--dim)">W/↑ gas • S/↓ brake (mod par = drift) • A D / ← → steer • X / Shift = 5 sec wheelie • N nitro • Q/E laat • T dialogue • C camera • H horn • R reset • Esc pause</span></div>
      <div class="set-row"><label>Tutorial</label><div class="seg"><button id="tut-replay">DOBARA DEKHO</button></div></div>`);
    const tr = document.getElementById('tut-replay'); if (tr) tr.onclick = () => { this.closePanel(); this.tutorial(true); };
    $$('#panel .seg[data-key] button').forEach(b => b.onclick = () => {
      const key = b.parentElement.dataset.key; let v = b.dataset.val;
      if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(+v) && v !== '') v = +v;
      this.app.setSetting(key, v); this.app.audio?.ui('select');
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    });
    $$('#panel input[type=range]').forEach(r => r.oninput = () => this.app.setSetting(r.dataset.key, +r.value));
  }

  openMusic() {
    const st = MusicPlayer.state();
    this.panel(`<h3>🎵 SONGS & MUSIC</h3>
      <div style="text-align:center;font-size:1.5em;font-weight:700" id="np-title">${st.title}</div>
      <div class="player-ctl">
        <button data-mp="prev">⏮</button><button class="main" data-mp="toggle">${st.playing ? '❚❚' : '▶'}</button><button data-mp="next">⏭</button>
        <button data-mp="shuffle" class="${st.shuffle ? 'on' : ''}" title="Shuffle">🔀</button>
      </div>
      <div class="set-row"><label>Volume</label><input type="range" id="mp-vol" min="0" max="1" step="0.05" value="${this.app.settings.music}"></div>
      <div class="song-list">${st.tracks.map((t, i) => `<div class="song ${i === st.index ? 'on' : ''}" data-song="${i}"><i>${i === st.index && st.playing ? '♫' : i + 1}</i><span>${t.title}</span><small>${t.dur ? fmtDur(t.dur) : t.type === 'synth' ? 'Game' : 'Loop'}</small></div>`).join('')}</div>
      <div class="mp-note">Race ke beech me bhi ⏭ button se gaana badal sakte ho. "Pahadi Hit" gaane aapki mashup file se kaate gaye hain.</div>`);
    $$('#panel [data-song]').forEach(el => el.onclick = () => { MusicPlayer.select(+el.dataset.song); });
    $$('#panel [data-mp]').forEach(el => el.onclick = () => {
      const a = el.dataset.mp; if (a === 'prev') MusicPlayer.prev(); else if (a === 'next') MusicPlayer.next(); else if (a === 'toggle') MusicPlayer.toggle(); else if (a === 'shuffle') MusicPlayer.setShuffle(!MusicPlayer.shuffle);
    });
    $('#mp-vol').oninput = (e) => this.app.setSetting('music', +e.target.value);
  }
  renderMusic(st) {
    $$('.music-chip').forEach(c => { c.classList.toggle('playing', st.playing); c.querySelector('.mc-title').textContent = st.playing ? st.title : 'Music band hai — ▶ dabao'; });
    $$('[data-act="music-btn"]').forEach(b => { b.textContent = st.playing ? '⏭' : '▶'; });
    if (this.panelOpen && $('#np-title')) this.openMusic();
  }

  // ---------------------------------------------------------------- multiplayer
  openMultiplayer() {
    const app = this.app; const net = app.mp;
    if (net && net.inRoom) return this.renderRoom();
    const name = app.settings.playerName || charById(app.settings.character).name;
    const urlRoom = new URLSearchParams(location.search).get('room') || '';
    this.panel(`<h3>👥 MULTIPLAYER</h3>
      <div class="set-row"><label>Tumhara naam</label><input id="mp-name" class="code-input" style="font-size:2em;letter-spacing:.1em" maxlength="14" value="${name}"></div>
      <div class="mp-box">
        <div class="box"><h4>ROOM BANAO</h4><p>Room code banega — doston ko code ya QR bhejo. Max 3 riders.</p><button class="btn-yellow" id="mp-create">CREATE ROOM</button></div>
        <div class="box"><h4>ROOM JOIN KARO</h4><p>Dost ka 4-letter code daalo.</p><input id="mp-code" class="code-input" maxlength="4" placeholder="ABCD" value="${urlRoom}"><div style="margin-top:.8em"><button class="btn-blue" id="mp-join">JOIN</button></div></div>
      </div>
      <div class="mp-note" id="mp-status">Sab phones ek hi Wi-Fi par hon (ya same internet link khole). Game ko <b>node server.js</b> se chalao taaki multiplayer kaam kare.</div>`);
    const nm = () => { const v = $('#mp-name').value.trim().slice(0, 14) || name; app.setSetting('playerName', v); return v; };
    $('#mp-create').onclick = () => { this.mpStatus('Room ban raha hai...'); app.mpCreate(nm()); };
    $('#mp-join').onclick = () => { const code = $('#mp-code').value.trim().toUpperCase(); if (code.length < 4) return this.mpStatus('4-letter code daalo'); this.mpStatus('Join ho rahe hain...'); app.mpJoin(code, nm()); };
  }
  mpStatus(t) { const el = $('#mp-status'); if (el) el.innerHTML = t; }
  renderRoom() {
    const app = this.app; const mp = app.mp; if (!mp) return;
    const r = mp.room;
    const taken = new Set(r.players.map(p => p.char));
    const me = r.players.find(p => p.id === mp.id);
    const joinUrl = mp.joinLink || '';
    this.panel(`<h3>ROOM</h3>
      <div class="room-grid"><div>
        <div class="room-code">${r.code}</div>
        <div class="link-box">${joinUrl || ''}</div>
        <div class="plist">${r.players.map(p => `<div class="pl"><div class="pbadge" style="background:${charById(p.char).accent}">${charById(p.char).name[0]}</div><span>${esc(p.name)} • ${charById(p.char).name}</span>${p.id === r.hostId ? '<span class="host">HOST</span>' : ''}</div>`).join('')}
          ${r.cpuFill ? CHARACTERS.filter(c => !taken.has(c.id)).map(c => `<div class="pl cpu"><div class="pbadge" style="background:${c.accent}">${c.name[0]}</div><span>CPU • ${c.name}</span></div>`).join('') : ''}</div>
        <div class="set-h" style="margin-top:.2em">APNA RIDER</div>
        <div class="char-pick">${CHARACTERS.map(c => `<button data-pick="${c.id}" class="${me && me.char === c.id ? 'on' : ''}" ${taken.has(c.id) && !(me && me.char === c.id) ? 'disabled' : ''}>${c.name}</button>`).join('')}</div>
        ${mp.isHost ? `<div class="set-row"><label>Khaali jagah par CPU</label><div class="seg"><button data-cpu="1" class="${r.cpuFill ? 'on' : ''}">ON</button><button data-cpu="0" class="${!r.cpuFill ? 'on' : ''}">OFF</button></div></div>
        ${r.cpuFill ? `<div class="set-row"><label>CPU Level</label><div class="seg">${DIFFICULTIES.map(d => `<button data-rdiff="${d.id}" class="${app.settings.difficulty === d.id ? 'on' : ''}">${d.name}</button>`).join('')}</div></div>` : ''}` : ''}
      </div><div><div class="qr" id="qr"></div><div class="mp-note">Dost ye QR scan karke seedha join kar sakte hain.</div>
        <div style="display:grid;gap:.6em;margin-top:.8em">
          ${mp.isHost ? `<button class="btn-yellow" id="mp-start">START RACE</button>` : `<span class="mp-note">Host race start karega...</span>`}
          <button class="btn-dark" id="mp-leave">LEAVE</button>
        </div>${this.voiceRoomHtml()}</div></div>
      <div class="mp-note">${mp.transport === 'p2p' ? 'Mode: Internet P2P' : 'Mode: Local server'} • ${r.players.length}/3 riders</div>`);
    if (joinUrl) app.drawQR?.($('#qr'), joinUrl);
    $$('#panel [data-pick]').forEach(b => b.onclick = () => app.mpPick(b.dataset.pick));
    $$('#panel [data-cpu]').forEach(b => b.onclick = () => app.mpCpu(b.dataset.cpu === '1'));
    $$('#panel [data-rdiff]').forEach(b => b.onclick = () => { app.setSetting('difficulty', b.dataset.rdiff); this.renderRoom(); });
    $('#mp-leave').onclick = () => { app.mpLeave(); this.closePanel(); };
    const st = $('#mp-start'); if (st) st.onclick = () => app.mpStart();
  }

  // ---------------------------------------------------------------- intro / countdown
  introTitle() { /* removed: intro shows only "MAIN HOON …" */ }
  introBanner(info) {
    const el = $('#intro-banner');
    if (!info) { el.classList.add('hidden'); return; }
    el.querySelector('.ib-name').textContent = info.name;
    el.style.setProperty('--bc', info.color); el.classList.toggle('you', !!info.isYou);
    el.classList.remove('hidden'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  }
  countdown(txt, done) {
    const el = $('#countdown'); $('#scr-intro').classList.add('counting');
    el.textContent = txt; el.classList.toggle('go', txt === 'GO!');
    el.classList.remove('pop'); el.offsetHeight; el.classList.add('pop');
    $('.skip-btn').classList.add('hidden');
    if (done) setTimeout(() => { this.overlay('intro', false); $('#scr-intro').classList.remove('counting'); el.textContent = ''; }, 900);
  }
  resetIntro(canSkip) {
    $('#scr-intro').classList.remove('counting'); $('#countdown').textContent = '';
    $('#intro-banner').classList.add('hidden');
    $('.skip-btn').classList.toggle('hidden', !canSkip);
  }

  // ---------------------------------------------------------------- HUD
  buildProgressMarks(track) {
    const span = track.finishS - track.startS;
    const marks = [['Ramnagar', track.startS], ['Corbett', track.marks.forestGate], ['Garjiya', track.marks.garjiya], ['Pahad', track.zoneSpans.find(z => z.id === 'mountain').s0], ['Ranikhet', track.finishS]];
    $('#prog-marks').innerHTML = marks.map(([n, s]) => `<div class="prog-mark" style="left:${((s - track.startS) / span * 100).toFixed(1)}%"><span>${n}</span></div>`).join('');
    // minimap path cache
    this.mmPts = []; for (let i = 0; i < track.N; i += 3) this.mmPts.push([track.X[i], track.Z[i]]);
  }
  buildRadar(world) { try { this.radar = new Radar(world); } catch (e) { console.warn('radar', e); } }
  hud(h) {
    const c = this.hudCache;
    const set = (id, v) => { if (c[id] !== v) { c[id] = v; const el = document.getElementById(id); if (el) el.textContent = v; } };
    set('hud-speed', String(Math.round(h.speed)));
    set('hud-gear', h.speed < 1 && h.gear === 1 ? 'N' : String(h.gear));
    set('hud-pos', h.mode === 'race' ? String(h.pos) : '–'); set('hud-total', String(h.total));
    set('hud-time', h.time == null ? 'FREE RIDE' : fmtTime(h.time));
    set('hud-zone', h.zone); set('hud-km', `${h.kmLeft.toFixed(1)} km • Ranikhet`);
    const off = Math.round(267 * (1 - Math.min(1, h.rpm)));
    if (c.rpm !== off) { c.rpm = off; const a = document.getElementById('rpm-arc'); a.style.strokeDashoffset = off; a.classList.toggle('red', h.rpm > 0.92); }
    const nw = Math.round(h.nitro * 100);
    if (c.nitro !== nw) { c.nitro = nw; const n = document.getElementById('hud-nitro'); n.style.width = nw + '%'; n.parentElement.classList.toggle('full', nw >= 99); }
    const wl = h.wheelieT > 0 ? `${Math.ceil(h.wheelieT)}s` : 'WHEELIE';
    if (c.wl !== wl) { c.wl = wl; const b = document.querySelector('.tbtn.wheelie'); if (b) { b.textContent = wl; b.classList.toggle('on', h.wheelieT > 0); } }
    const nf = Math.round((1 - Math.min(1, h.nitro)) * 276.5);
    if (c.nf !== nf) { c.nf = nf; const f = document.getElementById('nb-fill'); if (f) f.style.strokeDashoffset = nf; }
    const nst = (h.nitro >= 0.99 ? 'full' : '') + (h.boosting ? ' active' : '');
    if (c.nst !== nst) { c.nst = nst; const b = document.getElementById('nitro-btn'); if (b) { b.classList.toggle('full', h.nitro >= 0.99); b.classList.toggle('active', !!h.boosting); } document.getElementById('vignette')?.classList.toggle('boost', !!h.boosting); }
    const now = performance.now();
    if (this.radar && (!this._rT || now - this._rT > 33)) {
      this._rT = now; const P = this.app.race?.player;
      if (P) this.radar.draw(document.getElementById('radar'), P, h.map, this.app.world.track.finishS);
    }
  }
  voiceRoomHtml() {
    const v = this.app.voice?.state?.() || {}; const can = v.canMic;
    return `<div class="vc-room"><h4>🎙️ VOICE CHAT</h4>
      <div class="vc-btns"><button class="mic ${v.micOn ? 'on' : ''}" data-act="vc-mic">🎤 MIC ${v.micOn ? 'ON' : 'OFF'}</button><button class="${v.speakerOn !== false ? 'on' : ''}" data-act="vc-spk">🔊 SPEAKER ${v.speakerOn !== false ? 'ON' : 'OFF'}</button></div>
      <div class="mp-note">${can ? 'Mic ON karo aur doston se baat karo. Earphones lagao to engine ki awaaz mic me kam jayegi.' : 'Abhi http link khula hai — sun sakte ho, par bolne (mic) ke liye <b>https://</b> wala link kholo (Terminal me 🎤 ke saath dikhta hai).'}${v.connected ? ` • ${v.connected} dost jude hain` : ''}</div></div>`;
  }
  voiceHud(v) {
    const bar = $('#vc-bar'); if (!bar) return;
    bar.classList.toggle('hidden', !v.enabled);
    bar.querySelector('.vc-mic').classList.toggle('on', !!v.micOn);
    bar.querySelector('.vc-spk').classList.toggle('on', v.speakerOn !== false);
    const names = (v.speaking || []).map(id => this.app.mp?.room?.players.find(p => p.id === id)?.name).filter(Boolean);
    const key = names.join('|'); if (this._talkKey !== key) { this._talkKey = key; $('#vc-talk').innerHTML = names.map(n => `<span>🔊 ${esc(n)}</span>`).join(''); }
    if (!v.tick && this.panelOpen && document.querySelector('.vc-room')) this.renderRoom();
  }
  takedown(title, sub, kind = 'win') {
    const el = $('#takedown'); if (!el) return;
    el.querySelector('b').textContent = title; el.querySelector('small').textContent = sub || '';
    el.classList.toggle('lose', kind === 'lose'); el.classList.remove('hidden', 'show'); el.offsetHeight; el.classList.add('show');
    const v = document.getElementById('vignette'); v.classList.remove('td', 'tdlose'); v.classList.add(kind === 'lose' ? 'tdlose' : 'td');
    clearTimeout(this._tdT); this._tdT = setTimeout(() => v.classList.remove('td', 'tdlose'), 2400);
  }
  cinematic(on) { this.game.classList.toggle('td-cam', !!on); }
  trick(t) { const el = $('#hud-trick'); el.textContent = t; el.classList.remove('show'); el.offsetHeight; el.classList.add('show'); }
  offTrack(n) {
    const el = $('#hud-off'); if (!el) return;
    if (n == null) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); const k = $('#hud-off-n'); if (k.textContent !== String(n)) k.textContent = String(n);
  }
  warn(t) { const el = $('#hud-warn'); if (!t) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; } el.textContent = t; el.classList.remove('hidden'); }
  zoneBanner(title, sub) { const el = $('#zone-banner'); el.querySelector('b').textContent = title; el.querySelector('small').textContent = sub || ''; el.classList.remove('show'); el.offsetHeight; el.classList.add('show'); }
  finishBanner(t, sub) { const el = $('#finish-banner'); if (!t) return el.classList.add('hidden'); el.querySelector('b').textContent = t; el.querySelector('small').textContent = sub || ''; el.classList.remove('hidden'); }
  toast(msg) {
    const root = $('#toasts'); const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; root.appendChild(d);
    while (root.children.length > 3) root.firstChild.remove();
    setTimeout(() => d.remove(), 3300);
  }
  resetHud() { this.hudCache = {}; this.finishBanner(null); this.warn(null); this.offTrack(null); }

  // ---------------------------------------------------------------- results
  results(res) {
    const titles = { race: 'RACE RESULTS', time: 'TIME TRIAL', free: 'FREE RIDE' };
    $('#res-title').textContent = titles[res.mode] || 'RESULTS';
    const you = res.rows.find(r => r.isYou);
    $('#res-sub').textContent = res.mode === 'race' && you ? (you.pos === 1 ? '🏆 RANIKHET KE RAJA! 🏆' : `Tum ${you.pos}${['st', 'nd', 'rd'][you.pos - 1] || 'th'} aaye — agli baar pakka!`) : 'Ramnagar → Ranikhet';
    $('#res-rows').innerHTML = res.rows.map((r, i) => `<div class="res-row ${r.isYou ? 'you' : ''}" style="animation-delay:${i * 0.12}s">
      <div class="rp">${r.pos}</div><div class="rbadge" style="background:${charById(r.charId).accent}">${charById(r.charId).name[0]}</div><div class="rn"><b>${esc(r.name)}${r.isYou ? ' (YOU)' : r.kind === 'ai' ? ' • CPU' : ''}</b><small>${charById(r.charId).tag}</small></div>
      <div class="rb">${r.bike}</div><div class="rt">${r.est ? '~' : ''}${fmtTime(r.time)}</div></div>`).join('');
    $('#res-best').innerHTML = res.record ? '⭐ <b>NEW BEST TIME!</b> ⭐' : res.best ? `Best time: <b>${fmtTime(res.best)}</b>` : '';
    const again = $('[data-act="again"]'); again.classList.toggle('hidden', !!(this.app.mp && this.app.mp.inRoom && !this.app.mp.isHost));
  }

  // ---------------------------------------------------------------- tutorial
  tutorial(force = false, onDone = null) {
    if (!force && this.app.settings.tutorialDone) { onDone?.(); return; }
    const touch = this.game.classList.contains('is-touch');
    const steps = [
      { t: 'NAMASTE! 🙏', x: 'Uttarakhand Riders me swagat hai. Chalo jaldi se samjhte hain — har step par <b>OK</b> dabao.', el: null },
      { t: 'APNA RIDER CHUNO', x: '◀ ▶ arrows ya <b>swipe</b> karke Mayank, Tushar aur Himanshu me se chuno. Har rider ki apni superbike hai.', el: '.char-nav' },
      { t: 'MODE', x: '<b>Race vs CPU</b> (teeno riders), <b>Time Trial</b> (apna record todo) ya <b>Free Ride</b> (aaram se ghoomo).', el: '.mode-card' },
      { t: 'CPU LEVEL', x: 'CPU riders kitne tez hon: <b>EASY</b>, <b>MEDIUM</b> ya <b>HARD</b>. Hard me CPU nitro aur laat dono zyada use karte hain!', el: '#diff-card' },
      { t: 'MAP', x: 'Ramnagar se Ranikhet ka raasta — Corbett jungle, Kosi nadi, pahadi hairpins. Yahan <b>Subah / Din / Shaam</b> bhi chuno.', el: '.map-card' },
      { t: 'GAANE 🎵', x: 'Music apne aap nahi bajega. Yahan <b>▶</b> dabao Pahadi gaane chalane ke liye, <b>⏭</b> se agla gaana. Race me bhi badal sakte ho.', el: '.lobby-top .music-chip' },
      { t: 'SETTINGS ⚙', x: 'Controls: <b>Tilt</b>, <b>Left-Right buttons</b> ya <b>Joystick</b>. Auto-gas, graphics, FPS aur sound bhi yahin.', el: '.lobby-top [data-act="settings"]' },
      { t: 'MULTIPLAYER 👥', x: 'Doston ke saath apne-apne phone se race — room banao, code/QR share karo.', el: '[data-act="multiplayer"]' },
      { t: 'RACE CONTROLS', x: touch ? '<b>GAS</b> / <b>BRAKE</b> + ◀ ▶ steer. Mod par steer karte hue <b>BRAKE tap</b> = DRIFT. <b>WHEELIE</b> button = 5 sec wheelie, <b>N₂O</b> = nitro boost (drift/wheelie se bharta hai). <b>🦵</b> = bagal wale ko laat, <b>💬</b> = dialogue, <b>📣</b> horn.' : '<kbd>W</kbd>/<kbd>↑</kbd> gas, <kbd>S</kbd>/<kbd>↓</kbd> brake, <kbd>A</kbd><kbd>D</kbd> steer. Mod par steer + brake = <b>DRIFT</b>. <kbd>X</kbd> = 5 sec wheelie, <kbd>N</kbd> nitro, <kbd>Q</kbd>/<kbd>E</kbd> laat, <kbd>T</kbd> dialogue, <kbd>C</kbd> camera, <kbd>R</kbd> reset.', el: null },
      { t: 'TRACK SE BAHAR?', x: 'Jungle ya nadi ki taraf ja sakte ho (GTA jaisa!) — par 5 second me wapas nahi aaye to track par teleport ho jaoge.', el: null },
      { t: 'BAS! 🏁', x: '<b>START</b> dabao aur Ranikhet tak race jeeto!', el: '[data-act="start"]' },
    ];
    let i = 0; const root = $('#tutorial'); root.classList.remove('hidden');
    const spot = $('#tut-spot'), card = $('#tut-card');
    const done = () => { root.classList.add('hidden'); this.app.setSetting('tutorialDone', true); onDone?.(); };
    const show = () => {
      const st = steps[i]; $('#tut-step').textContent = `${i + 1}/${steps.length}`; $('#tut-title').textContent = st.t; $('#tut-text').innerHTML = st.x;
      $('#tut-ok').textContent = i === steps.length - 1 ? 'SHURU KARO ▶' : 'OK ▶';
      const g = this.game.getBoundingClientRect(); const em = parseFloat(getComputedStyle(this.game).fontSize);
      const el = st.el ? document.querySelector(st.el) : null;
      if (el && el.offsetParent !== null) {
        const r = el.getBoundingClientRect(); const pad = 0.6 * em;
        Object.assign(spot.style, { left: (r.left - g.left - pad) + 'px', top: (r.top - g.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' }); spot.classList.remove('none');
        const cw = 34 * em, ch = card.offsetHeight || 14 * em;
        let cx = r.left - g.left + r.width / 2 - cw / 2; cx = Math.max(em, Math.min(g.width - cw - em, cx));
        let cy = r.bottom - g.top + 1.4 * em; if (cy + ch > g.height - em) cy = r.top - g.top - ch - 1.4 * em;
        Object.assign(card.style, { left: cx + 'px', top: Math.max(em, cy) + 'px' });
      } else {
        spot.classList.add('none');
        Object.assign(card.style, { left: (g.width / 2 - 17 * em) + 'px', top: (g.height / 2 - 8 * em) + 'px' });
      }
      this.app.audio?.ui?.('notify');
    };
    $('#tut-ok').onclick = () => { i++; if (i >= steps.length) done(); else show(); };
    $('#tut-skip').onclick = done;
    show();
  }

  // ---------------------------------------------------------------- controls / misc
  applyControls(s, isTouch) {
    const g = this.game;
    g.classList.toggle('is-touch', isTouch);
    document.body.classList.toggle('is-touch-body', isTouch);
    g.classList.toggle('ctl-tilt', s.steering === 'tilt');
    g.classList.toggle('ctl-joystick', s.steering === 'joystick');
    g.classList.toggle('auto-gas', !!s.autoGas);
    g.classList.toggle('lefty', s.layout === 'left');
  }
  fps(v, show) { this.fpsEl.classList.toggle('hidden', !show); if (show) this.fpsEl.textContent = `${v} FPS`; }
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function fmtDur(d) { const m = Math.floor(d / 60), s = Math.round(d % 60); return `${m}:${String(s).padStart(2, '0')}`; }

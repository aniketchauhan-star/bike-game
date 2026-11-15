// Player input: keyboard, on-screen touch buttons, tilt steering, gamepad. Produces smoothed {throttle, brake, steer}.
import { clamp, damp } from '../core/util.js';

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false };
    this.wheelie = false; this.nitro = false;
    this.throttle = 0; this.brake = 0; this.steer = 0;
    this.tilt = { enabled: false, value: 0, sens: 1, available: false };
    this.handlers = {};       // event name -> fn  ('camera','horn','pause','reset')
    this.enabled = false;
    this._onKey = (e) => this.onKey(e);
    addEventListener('keydown', this._onKey);
    addEventListener('keyup', this._onKey);
    addEventListener('blur', () => { this.keys.clear(); for (const k in this.touch) this.touch[k] = false; });
    this._onOrient = (e) => this.onOrient(e);
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name) { this.handlers[name]?.(); }

  onKey(e) {
    const down = e.type === 'keydown';
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k) && this.enabled) e.preventDefault();
    if (down) {
      if (this.keys.has(k)) return; // auto-repeat
      this.keys.add(k);
      if (!this.enabled) return;
      if (k === 'c') this.emit('camera');
      else if (k === 'h') this.emit('horn');
      else if (k === 'r') this.emit('reset');
      else if (k === 'q') this.emit('kickL');
      else if (k === 'e') this.emit('kickR');
      else if (k === 't') this.emit('say');
      else if (k === 'x' || k === 'Shift') this.emit('wheelie');
      else if (k === 'Escape' || k === 'p') this.emit('pause');
    } else this.keys.delete(k);
  }

  /** wire DOM touch buttons: elements with data-ctl="left|right|gas|brake|camera|horn|pause|reset" */
  bindTouch(root) {
    root.querySelectorAll('[data-ctl]').forEach(el => {
      const ctl = el.dataset.ctl;
      if (ctl === 'joy') { this.bindJoystick(el); return; }
      const press = (e) => {
        e.preventDefault(); el.classList.add('on');
        try { el.setPointerCapture(e.pointerId); } catch { /* */ }
        if (ctl in this.touch) this.touch[ctl] = true; else this.emit(ctl);
        if (navigator.vibrate && ctl !== 'gas' && ctl !== 'brake') try { navigator.vibrate(8); } catch { /* */ }
      };
      const release = (e) => { e.preventDefault(); el.classList.remove('on'); if (ctl in this.touch) this.touch[ctl] = false; };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  bindJoystick(el) {
    const knob = el.querySelector('.joy-knob');
    this.joy = 0; this.joyActive = false;
    const move = (e) => {
      const r = el.getBoundingClientRect(); const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      this.joy = clamp(dx * 1.15, -1, 1); if (Math.abs(this.joy) < 0.06) this.joy = 0;
      if (knob) knob.style.transform = `translateX(${(this.joy * r.width * 0.33).toFixed(1)}px)`;
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* */ } this.joyActive = true; move(e); });
    el.addEventListener('pointermove', (e) => { if (this.joyActive) move(e); });
    const up = () => { this.joyActive = false; this.joy = 0; if (knob) knob.style.transform = ''; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }

  async enableTilt(on, sens = 1) {
    this.tilt.sens = sens;
    if (!on) { this.tilt.enabled = false; removeEventListener('deviceorientation', this._onOrient); return true; }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return false;
      }
    } catch { return false; }
    addEventListener('deviceorientation', this._onOrient);
    this.tilt.enabled = true;
    return true;
  }
  onOrient(e) {
    if (e.beta == null) return;
    this.tilt.available = true;
    const ang = (screen.orientation && screen.orientation.angle) ?? (window.orientation || 0);
    let deg;
    if (ang === 90) deg = e.beta; else if (ang === -90 || ang === 270) deg = -e.beta; else deg = e.gamma; // portrait fallback
    const dead = 2.5, max = 24 / this.tilt.sens;
    const v = Math.abs(deg) < dead ? 0 : (deg - Math.sign(deg) * dead) / max;
    this.tilt.value = clamp(v, -1, 1);
  }

  update(dt) {
    const K = this.keys, T = this.touch;
    let gas = (K.has('ArrowUp') || K.has('w') || T.gas) ? 1 : 0;
    let brk = (K.has('ArrowDown') || K.has('s') || K.has(' ') || T.brake) ? 1 : 0;
    let st = ((K.has('ArrowRight') || K.has('d') || T.right) ? 1 : 0) - ((K.has('ArrowLeft') || K.has('a') || T.left) ? 1 : 0);
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0; if (Math.abs(ax) > 0.12) st = ax;
      const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0;
      if (rt > 0.05 || p.buttons[0]?.pressed) gas = Math.max(gas, rt || 1);
      if (lt > 0.05 || p.buttons[1]?.pressed) brk = Math.max(brk, lt || 1);
      if (p.buttons[9]?.pressed && !this._padPause) { this._padPause = true; this.emit('pause'); } else if (!p.buttons[9]?.pressed) this._padPause = false;
      if (p.buttons[3]?.pressed && !this._padCam) { this._padCam = true; this.emit('camera'); } else if (!p.buttons[3]?.pressed) this._padCam = false;
      break;
    }
    this.wheelie = false;
    this.nitro = K.has('n') || K.has('Control') || T.nitro;
    for (const p of pads) {
      if (!p) continue; if (p.buttons[2]?.pressed) this.nitro = true;
      if (p.buttons[5]?.pressed && !this._padWh) { this._padWh = true; this.emit('wheelie'); } else if (!p.buttons[5]?.pressed) this._padWh = false;
      break;
    }
    if (this.joyActive) st = this.joy;
    if (this.tilt.enabled && this.tilt.available && st === 0) st = this.tilt.value;
    // digital inputs ramp smoothly (analog-like feel)
    const digital = Math.abs(st) === 1 || st === 0;
    this.steer = digital ? damp(this.steer, st, st === 0 ? 9 : 6.5, dt) : st;
    this.throttle = damp(this.throttle, gas, gas > this.throttle ? 7 : 12, dt);
    this.brake = damp(this.brake, brk, brk > this.brake ? 10 : 14, dt);
    if (!this.enabled) { this.throttle = 0; this.brake = 0; this.steer = 0; this.wheelie = false; this.nitro = false; }
  }
}

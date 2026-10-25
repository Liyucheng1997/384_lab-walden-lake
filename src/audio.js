// All sound is synthesized with WebAudio — no audio files.
import { clamp, lerp } from './util.js';

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic degrees

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.8;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.45;
    this.reverb.connect(this.revGain).connect(this.master);
    this.noiseBuf = this.makeNoise(4);
    this.brownBuf = this.makeBrown(4);
    this.setupAmbience();
    this.enabled = true;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  makeNoise(sec) {
    const len = this.ctx.sampleRate * sec;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  makeBrown(sec) {
    const len = this.ctx.sampleRate * sec;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    return b;
  }
  loopNoise(buf, filterType, freq, q = 0.7) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start(0, Math.random() * 3);
    return { src, f, g };
  }

  setupAmbience() {
    this.wind = this.loopNoise(this.brownBuf, 'lowpass', 500, 0.5);
    this.windHi = this.loopNoise(this.noiseBuf, 'bandpass', 900, 1.2);
    this.water = this.loopNoise(this.noiseBuf, 'lowpass', 700, 0.8);
    this.rainN = this.loopNoise(this.noiseBuf, 'highpass', 1200, 0.5);
    this.rainLow = this.loopNoise(this.brownBuf, 'lowpass', 300, 0.5);
    this.fire = this.loopNoise(this.brownBuf, 'lowpass', 400, 0.6);
    this.trainRumble = this.loopNoise(this.brownBuf, 'lowpass', 160, 1.0);
    this.waterPan = this.ctx.createStereoPanner();
    // crickets: amplitude-modulated high sine
    const ctx = this.ctx;
    this.cricketG = ctx.createGain(); this.cricketG.gain.value = 0;
    const osc = ctx.createOscillator(); osc.frequency.value = 4600; osc.type = 'sine';
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 28; lfo.type = 'square';
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const slow = ctx.createOscillator(); slow.frequency.value = 1.3; slow.type = 'square';
    const slowG = ctx.createGain(); slowG.gain.value = 0.5;
    const chirpG = ctx.createGain(); chirpG.gain.value = 0.5;
    slow.connect(slowG).connect(chirpG.gain);
    osc.connect(am).connect(chirpG).connect(this.cricketG).connect(this.master);
    osc.start(); lfo.start(); slow.start();
    // a second cricket voice, detuned
    const osc2 = ctx.createOscillator(); osc2.frequency.value = 4180;
    const am2 = ctx.createGain(); am2.gain.value = 0.5;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 31; lfo2.type = 'square';
    const l2g = ctx.createGain(); l2g.gain.value = 0.5; lfo2.connect(l2g).connect(am2.gain);
    const slow2 = ctx.createOscillator(); slow2.frequency.value = 0.9; slow2.type = 'square';
    const s2g = ctx.createGain(); s2g.gain.value = 0.5; const c2 = ctx.createGain(); c2.gain.value = 0.5;
    slow2.connect(s2g).connect(c2.gain);
    osc2.connect(am2).connect(c2).connect(this.cricketG);
    osc2.start(); lfo2.start(); slow2.start();
    this.birdTimer = 2;
    this.nightTimer = 8;
    this.creakTimer = 10;
  }

  // ------------- ambience driven each frame -------------
  updateAmbience(dt, s) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const set = (node, v, tc = 0.5) => node.gain.setTargetAtTime(v, t, tc);
    const gust = 0.6 + 0.4 * Math.sin(t * 0.13) * Math.sin(t * 0.31 + 1);
    set(this.wind.g, (0.05 + s.wind * 0.22) * gust * (s.indoors ? 0.35 : 1));
    this.wind.f.frequency.setTargetAtTime(300 + s.wind * 500 * gust, t, 0.8);
    set(this.windHi.g, s.wind * 0.03 * gust * (s.winter ? 2 : 0.6) * (s.indoors ? 0.3 : 1) * (1 - s.night * 0.3));
    this.windHi.f.frequency.setTargetAtTime(700 + gust * 600, t, 1);
    const lap = s.shore * (0.5 + 0.5 * Math.sin(t * 0.9) * Math.sin(t * 0.37)) * (1 - s.ice);
    set(this.water.g, lap * 0.2 + s.boating * 0.05, 0.3);
    set(this.rainN.g, s.rain * 0.12 * (s.indoors ? 0.7 : 1));
    set(this.rainLow.g, s.rain * 0.25 * (s.indoors ? 1.3 : 1));
    set(this.fire.g, s.fire * 0.25);
    if (s.fire > 0 && Math.random() < dt * 8) this.crackle(s.fire);
    set(this.trainRumble.g, s.train * 0.5, 0.3);
    set(this.cricketG, s.crickets * 0.012 * (s.indoors ? 0.5 : 1), 1.5);

    // birds by day
    this.birdTimer -= dt;
    if (this.birdTimer < 0) {
      this.birdTimer = 1.5 + Math.random() * 6 / Math.max(0.15, s.birds);
      if (s.birds > 0.05 && Math.random() < s.birds && !s.indoors) this.bird(s);
    }
    // night voices
    this.nightTimer -= dt;
    if (this.nightTimer < 0) {
      this.nightTimer = 10 + Math.random() * 25;
      if (s.night > 0.6) {
        const r = Math.random();
        if (r < 0.35) this.owl();
        else if (r < 0.6 && s.summer) this.whippoorwill();
        else if (r < 0.85 && s.summer) this.bullfrog();
        else if (s.ice > 0.8) this.iceBoom();
        this.lastNightVoice = r < 0.35 ? 'owl' : r < 0.6 && s.summer ? 'whippoorwill' : r < 0.85 && s.summer ? 'bullfrog' : s.ice > 0.8 ? 'ice' : null;
        this.lastNightVoiceTime = performance.now();
      } else if (s.ice > 0.8 && Math.random() < 0.3) {
        this.iceBoom();
        this.lastNightVoice = 'ice'; this.lastNightVoiceTime = performance.now();
      }
    }
  }

  out(pan = 0, dry = 1, wet = 0.3) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    const d = ctx.createGain(); d.gain.value = dry;
    const w = ctx.createGain(); w.gain.value = wet;
    g.connect(p); p.connect(d).connect(this.master); p.connect(w).connect(this.reverb);
    return g;
  }
  spatial(pos) {
    // returns {gain, pan} for a world position
    if (!pos) return { gain: 1, pan: (Math.random() - 0.5) * 1.2 };
    const L = this.listener;
    const dx = pos.x - L.x, dz = pos.z - L.z;
    const d = Math.hypot(dx, dz, (pos.y || 0) - L.y);
    // camera looks along -Z rotated by yaw; its right vector is (cos yaw, 0, -sin yaw)
    const right = (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / Math.max(1e-3, Math.hypot(dx, dz));
    return { gain: 1 / (1 + d * 0.03), pan: right * 0.8, dist: d };
  }

  tone(type, f0, f1, t0, dur, vol, dest, attack = 0.01) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  noiseBurst(t0, dur, vol, type, freq, q, dest, buf) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf || this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 2, dur + 0.1);
    return f;
  }

  // ------------- creatures -------------
  bird(s) {
    const t = this.ctx.currentTime;
    const dest = this.out((Math.random() - 0.5) * 1.6, 0.6, 0.5);
    const kind = s.winter ? 0 : Math.floor(Math.random() * 4);
    const v = 0.04 + Math.random() * 0.04;
    if (kind === 0) { // chickadee "fee-bee"
      this.tone('sine', 3900, 3850, t, 0.35, v, dest, 0.03);
      this.tone('sine', 3300, 3250, t + 0.4, 0.4, v, dest, 0.03);
    } else if (kind === 1) { // wood thrush — flute-like phrase
      const base = 1800 + Math.random() * 600;
      const notes = [1, 1.25, 1.5, 1.2, 2.1];
      notes.forEach((m, i) => this.tone('sine', base * m, base * m * (i === 4 ? 0.85 : 1.02), t + i * 0.09, 0.14, v * 0.8, dest, 0.01));
      for (let i = 0; i < 6; i++) this.tone('sine', 4200 + Math.random() * 800, 3800, t + 0.5 + i * 0.03, 0.04, v * 0.4, dest, 0.005);
    } else if (kind === 2) { // song sparrow trill
      for (let i = 0; i < 3; i++) this.tone('sine', 2600, 3000, t + i * 0.18, 0.12, v, dest, 0.01);
      for (let i = 0; i < 9; i++) this.tone('sine', 4500, 3600, t + 0.6 + i * 0.05, 0.045, v * 0.8, dest, 0.004);
    } else { // brown thrasher / catbird chatter
      for (let i = 0; i < 5; i++) {
        const f = 1500 + Math.random() * 2500;
        this.tone('triangle', f, f * (0.7 + Math.random() * 0.6), t + i * 0.13, 0.1, v * 0.6, dest, 0.01);
      }
    }
  }
  owl() {
    const t = this.ctx.currentTime;
    const dest = this.out((Math.random() - 0.5) * 1.4, 0.4, 0.8);
    const f = 360 + Math.random() * 40;
    [[0, 0.35], [0.5, 0.25], [0.8, 0.25], [1.15, 0.6]].forEach(([dt, d]) => this.tone('sine', f, f * 0.92, t + dt, d, 0.09, dest, 0.06));
  }
  whippoorwill() {
    const t = this.ctx.currentTime;
    const dest = this.out((Math.random() - 0.5) * 1.6, 0.4, 0.7);
    for (let k = 0; k < 4; k++) {
      const t0 = t + k * 1.05;
      this.tone('sine', 1500, 1200, t0, 0.12, 0.05, dest, 0.01);
      this.tone('sine', 1100, 1050, t0 + 0.16, 0.1, 0.035, dest, 0.01);
      this.tone('sine', 1300, 2200, t0 + 0.3, 0.35, 0.06, dest, 0.02);
    }
  }
  bullfrog() {
    const t = this.ctx.currentTime;
    const dest = this.out((Math.random() - 0.5) * 1.4, 0.6, 0.6);
    for (let k = 0; k < 3; k++) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 85 + Math.random() * 10;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
      const g = this.ctx.createGain(); const t0 = t + k * 0.9;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.08);
      g.gain.setValueAtTime(0.12, t0 + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(f).connect(g).connect(dest); o.start(t0); o.stop(t0 + 0.7);
    }
  }
  iceBoom() {
    const t = this.ctx.currentTime;
    const dest = this.out((Math.random() - 0.5), 0.6, 0.9);
    this.tone('sine', 140, 40, t, 1.2, 0.2, dest, 0.01);
    this.noiseBurst(t, 0.4, 0.1, 'bandpass', 700, 1, dest);
    this.tone('sine', 900, 200, t + 0.05, 0.6, 0.03, dest, 0.005);
  }
  loon(pos) {
    if (!this.enabled) return;
    const { gain, pan } = this.spatial(pos);
    const t = this.ctx.currentTime;
    const dest = this.out(pan, 0.5 * gain, 0.9 * gain);
    const kind = Math.random();
    if (kind < 0.5) { // wail
      const o = this.ctx.createOscillator(); o.type = 'sine';
      const vib = this.ctx.createOscillator(); vib.frequency.value = 5; const vg = this.ctx.createGain(); vg.gain.value = 12;
      vib.connect(vg).connect(o.frequency);
      o.frequency.setValueAtTime(600, t); o.frequency.linearRampToValueAtTime(980, t + 0.5);
      o.frequency.setValueAtTime(980, t + 1.4); o.frequency.linearRampToValueAtTime(820, t + 2.2);
      const h = this.ctx.createOscillator(); h.type = 'sine'; h.frequency.setValueAtTime(1200, t); h.frequency.linearRampToValueAtTime(1960, t + 0.5); h.frequency.linearRampToValueAtTime(1640, t + 2.2);
      const hg = this.ctx.createGain(); hg.gain.value = 0.15;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.3); g.gain.setValueAtTime(0.12, t + 1.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.connect(g); h.connect(hg).connect(g); g.connect(dest);
      o.start(t); h.start(t); vib.start(t); o.stop(t + 2.5); h.stop(t + 2.5); vib.stop(t + 2.5);
    } else { // tremolo laugh
      for (let i = 0; i < 9; i++) {
        const f = 900 + (i % 2) * 140;
        this.tone('sine', f, f * 0.96, t + i * 0.11, 0.1, 0.09, dest, 0.01);
      }
    }
  }
  geese(pos) {
    if (!this.enabled) return;
    const { gain, pan } = this.spatial(pos);
    const t = this.ctx.currentTime;
    const dest = this.out(pan, 0.5 * gain + 0.2, 0.6);
    for (let i = 0; i < 10; i++) {
      const t0 = t + i * (0.25 + Math.random() * 0.3);
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(380 + Math.random() * 80, t0); o.frequency.linearRampToValueAtTime(330, t0 + 0.15);
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 2;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(f).connect(g).connect(dest); o.start(t0); o.stop(t0 + 0.2);
    }
  }
  whistle(pos) {
    if (!this.enabled) return;
    const { gain, pan } = this.spatial(pos);
    const t = this.ctx.currentTime;
    const dest = this.out(pan, 0.5 * gain + 0.15, 1.0);
    const parts = [[0, 1.2], [1.4, 2.2]];
    for (const [st, dur] of parts) {
      for (const f of [440, 554, 659]) {
        const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * 0.985;
        o.frequency.linearRampToValueAtTime(f, t + st + 0.2);
        const fl = this.ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f * 2; fl.Q.value = 3;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + st); g.gain.exponentialRampToValueAtTime(0.06, t + st + 0.15);
        g.gain.setValueAtTime(0.06, t + st + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + st + dur);
        o.connect(fl).connect(g).connect(dest); o.start(t + st); o.stop(t + st + dur + 0.1);
      }
    }
  }
  bells() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(-0.4, 0.15, 1.0);
    for (let i = 0; i < 8; i++) {
      const f = i % 2 ? 392 : 330;
      const t0 = t + i * 1.6;
      for (const [m, v] of [[1, 0.05], [2.4, 0.02], [3.0, 0.015], [4.5, 0.01], [0.5, 0.025]]) this.tone('sine', f * m, f * m, t0, 4, v, dest, 0.005);
    }
  }
  splash(pos, big = 1) {
    if (!this.enabled) return;
    const { gain, pan } = this.spatial(pos);
    const t = this.ctx.currentTime;
    const dest = this.out(pan, gain, 0.4 * gain);
    this.noiseBurst(t, 0.35 * big, 0.25 * big, 'bandpass', 1400, 0.8, dest);
    this.noiseBurst(t + 0.05, 0.5 * big, 0.12 * big, 'lowpass', 500, 0.7, dest);
    this.tone('sine', 900, 1500, t + 0.02, 0.08, 0.04 * big, dest, 0.005);
  }
  plop(pos) {
    if (!this.enabled) return;
    const { gain, pan } = this.spatial(pos);
    const t = this.ctx.currentTime;
    const dest = this.out(pan, gain, 0.3);
    this.tone('sine', 400, 1100, t, 0.08, 0.12, dest, 0.003);
    this.noiseBurst(t, 0.12, 0.06, 'bandpass', 2000, 1, dest);
  }
  step(surface) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out((Math.random() - 0.5) * 0.2, 1, 0.08);
    if (surface === 'snow') { this.noiseBurst(t, 0.22, 0.09, 'bandpass', 2600, 0.6, dest); this.noiseBurst(t + 0.05, 0.12, 0.05, 'highpass', 4000, 0.5, dest); } else if (surface === 'wood') { this.tone('sine', 140, 90, t, 0.09, 0.12, dest, 0.003); this.noiseBurst(t, 0.06, 0.04, 'bandpass', 800, 2, dest); } else if (surface === 'water') { this.noiseBurst(t, 0.3, 0.1, 'bandpass', 1200, 0.7, dest); } else if (surface === 'sand') { this.noiseBurst(t, 0.12, 0.05, 'bandpass', 1800, 0.5, dest); } else if (surface === 'ice') { this.tone('sine', 1800, 1200, t, 0.05, 0.02, dest); this.noiseBurst(t, 0.08, 0.04, 'highpass', 3000, 0.5, dest); } else { this.noiseBurst(t, 0.13, 0.05, 'bandpass', 1000 + Math.random() * 500, 0.6, dest); this.noiseBurst(t, 0.08, 0.025, 'highpass', 3500, 0.5, dest); }
  }
  hoe(stone) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(0, 1, 0.5);
    this.noiseBurst(t, 0.18, 0.18, 'lowpass', 600, 1, dest, this.brownBuf);
    this.tone('sine', 110, 70, t, 0.12, 0.15, dest, 0.003);
    // "when my hoe tinkled against the stones, that music echoed to the woods"
    if (stone) for (const f of [2900, 4300, 6100]) this.tone('sine', f, f * 0.99, t + 0.01, 0.6, 0.03, this.out(0, 0.6, 1.2), 0.002);
  }
  chop() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(0, 1, 0.7);
    this.tone('square', 260, 90, t, 0.07, 0.1, dest, 0.002);
    this.noiseBurst(t, 0.12, 0.2, 'bandpass', 1300, 1.2, dest);
    this.tone('sine', 190, 160, t, 0.25, 0.12, dest, 0.002);
  }
  pick() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(0, 1, 0.2);
    for (let i = 0; i < 4; i++) this.noiseBurst(t + i * 0.04, 0.05, 0.08, 'bandpass', 2000 + Math.random() * 2000, 2, dest);
  }
  page() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(0, 1, 0.15);
    const f = this.noiseBurst(t, 0.35, 0.09, 'bandpass', 3000, 0.6, dest);
    f.frequency.linearRampToValueAtTime(5000, t + 0.3);
  }
  crackle(amt) {
    const t = this.ctx.currentTime;
    const dest = this.out((Math.random() - 0.5) * 0.4, amt, 0.2);
    this.noiseBurst(t, 0.02 + Math.random() * 0.03, 0.08 * Math.random() + 0.02, 'highpass', 2000 + Math.random() * 3000, 1, dest);
  }
  chime() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(0, 0.5, 1);
    [784, 988, 1175].forEach((f, i) => this.tone('sine', f, f, t + i * 0.12, 1.6, 0.04, dest, 0.01));
  }
  reel() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(0, 0.8, 0.1);
    for (let i = 0; i < 14; i++) this.noiseBurst(t + i * 0.035, 0.02, 0.04, 'bandpass', 3500, 4, dest);
  }
  cast() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const dest = this.out(0, 0.8, 0.2);
    const f = this.noiseBurst(t, 0.4, 0.1, 'bandpass', 800, 1.5, dest);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
  }
  bathe() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const dest = this.out((Math.random() - 0.5), 0.8, 0.5);
      this.noiseBurst(t + i * 0.35 + Math.random() * 0.2, 0.5, 0.15, 'bandpass', 900 + Math.random() * 800, 0.8, dest);
    }
  }

  // ------------- flute -------------
  fluteNote(semi, dur = 0.6, vol = 0.12) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = 587.33 * Math.pow(2, semi / 12); // D5 root
    const dest = this.out(0, 0.55, 1.1);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + 0.35);
    vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.07);
    g.gain.setValueAtTime(vol * 0.85, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    const g2 = ctx.createGain(); g2.gain.value = 0.06;
    o.connect(g); o2.connect(g2).connect(g);
    g.connect(dest);
    // breath
    const breath = this.noiseBurst(t, dur * 0.6 + 0.2, vol * 0.18, 'bandpass', f * 1.5, 2, dest);
    o.start(t); o2.start(t); vib.start(t);
    o.stop(t + dur + 0.5); o2.stop(t + dur + 0.5); vib.stop(t + dur + 0.5);
  }
  // number keys 1-8 -> pentatonic scale across two octaves
  fluteKey(i) {
    const deg = PENTA[i % 5] + 12 * Math.floor(i / 5) - 5;
    this.fluteNote(deg, 0.55);
  }
  // generative improvisation, called each frame while flute is out
  fluteImprov(dt) {
    if (!this.enabled) return;
    this.impT = (this.impT ?? 0.5) - dt;
    if (this.impT > 0) return;
    if (!this.phrase || this.phrase.length === 0) {
      // new phrase: a gentle random walk
      const len = 4 + Math.floor(Math.random() * 5);
      let p = this.lastDeg ?? 3;
      this.phrase = [];
      for (let i = 0; i < len; i++) {
        p = clamp(p + Math.floor(Math.random() * 5) - 2, 0, 9);
        this.phrase.push(p);
      }
      this.phrase.push(Math.random() < 0.6 ? 0 : 2);
      this.impT = 1.4 + Math.random() * 1.6; // breath between phrases
      return;
    }
    const d = this.phrase.shift();
    this.lastDeg = d;
    const dur = this.phrase.length === 0 ? 1.4 : [0.32, 0.48, 0.64, 0.96][Math.floor(Math.random() * 4)];
    this.fluteNote(PENTA[d % 5] + 12 * Math.floor(d / 5) - 5, dur, 0.1);
    this.impT = dur;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  suspend() { this.ctx && this.ctx.suspend(); }
  resume() { this.ctx && this.ctx.resume(); }
}

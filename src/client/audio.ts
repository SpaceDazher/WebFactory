// Звук (M10): всё синтезируется WebAudio на лету — ни одного файла, игра остаётся одним HTML.
// Шины: master → sfx / music / ambient. Эффекты позиционные: громкость по расстоянию, панорама по X.
type Tone = { f: number; f2?: number; t: number; type?: OscillatorType; g?: number; at?: number };
export interface AudioVol { master: number; sfx: number; music: number; ambient: number; }
const MIDI = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private music!: GainNode; private amb!: GainNode;
  private noise!: AudioBuffer; private last: Record<string, number> = {}; private voices = 0;
  private hum: { osc: OscillatorNode[]; g: GainNode; lp: BiquadFilterNode } | null = null;
  private rattle: { g: GainNode } | null = null; private steam: { g: GainNode } | null = null;
  private speakerLoops = new Map<string, { sound: string; nodes: OscillatorNode[]; gain: GainNode; pan?: StereoPannerNode }>();
  private speakerOneShots = new Map<string, { gain: GainNode; pan?: StereoPannerNode; timer: number }>();
  private delay!: DelayNode; private musicT = 0; private musicTimer = 0; private bar = 0; private pieceStart = 0;
  vol: AudioVol = { master: 0.8, sfx: 0.8, music: 0.45, ambient: 0.6 };
  /** создать контекст по первому жесту пользователя (требование браузеров) */
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    const c: AudioContext = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(comp); this.music = c.createGain(); this.music.connect(comp); this.amb = c.createGain(); this.amb.connect(comp);
    const n = c.sampleRate * 2; this.noise = c.createBuffer(1, n, c.sampleRate); const d = this.noise.getChannelData(0); let s = 1;
    for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
    // эхо для музыки
    this.delay = c.createDelay(2); this.delay.delayTime.value = 0.42; const fb = c.createGain(); fb.gain.value = 0.38; const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.music);
    this.setVol(this.vol); this.startAmbient(); this.startMusic();
  }
  setVol(v: AudioVol) {
    this.vol = { ...v }; if (!this.ctx) return; const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, .05); this.sfx.gain.setTargetAtTime(v.sfx, t, .05); this.music.gain.setTargetAtTime(v.music * .5, t, .05); this.amb.gain.setTargetAtTime(v.ambient, t, .05);
  }
  private out(pan: number, gain: number, dest?: AudioNode): GainNode {
    const c = this.ctx!; const g = c.createGain(); g.gain.value = gain;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(dest || this.sfx); } else g.connect(dest || this.sfx);
    return g;
  }
  private tone(o: Tone, dest: AudioNode, t0: number) {
    const c = this.ctx!; const osc = c.createOscillator(); osc.type = o.type || 'sine'; const g = c.createGain();
    const t = t0 + (o.at || 0); osc.frequency.setValueAtTime(o.f, t); if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.g ?? .3, t + Math.min(.01, o.t / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + o.t);
    osc.connect(g); g.connect(dest); osc.start(t); osc.stop(t + o.t + .02);
  }
  private burst(dest: AudioNode, t0: number, dur: number, type: BiquadFilterType, f: number, f2: number | null, g: number, q = 1, at = 0) {
    const c = this.ctx!; const src = c.createBufferSource(); src.buffer = this.noise; const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    const t = t0 + at; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const gg = c.createGain(); gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(g, t + Math.min(.008, dur / 5)); gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(gg); gg.connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + dur + .02);
  }
  /** «Голос» ОСКАРа без синтеза речи (в браузере нет голосов): каждый слог — короткий тон с формантой своей гласной,
   *  как в старых играх. Громкость — от общей, мимо шины эффектов. Возвращает длительность в мс. */
  babble(text: string, vol: number, oscar: boolean): number {
    const c = this.ctx; if (!c || c.state !== 'running' || vol <= 0 || this.vol.master <= 0) return 0;
    const F: Record<string, number> = { а: 800, a: 800, о: 520, o: 520, у: 360, u: 360, ы: 900, и: 2300, i: 2300, е: 1900, e: 1900, э: 1700, я: 820, ю: 380, ё: 540, y: 1500 };
    const out = c.createGain(); out.gain.value = vol * 0.55; out.connect(this.master);
    let t = c.currentTime + .03, n = 0; const base = oscar ? 150 : 210; let h = 7;
    for (const ch of text.toLowerCase()) {
      if (ch === ' ' || ch === ',' ) { t += .05; continue; } if (ch === '.' || ch === '!' || ch === '?' || ch === '—') { t += .16; continue; }
      const f = F[ch]; if (!f) continue; if (++n > 40) break;
      h = (h * 1103515245 + 12345) & 0x7fffffff; const pitch = base * (0.9 + (h % 1000) / 1000 * 0.35);
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(pitch, t); o.frequency.linearRampToValueAtTime(pitch * (oscar ? 0.94 : 1.06), t + .08);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.5, t + .012); g.gain.exponentialRampToValueAtTime(0.0001, t + .085);
      o.connect(bp); bp.connect(g); g.connect(out); o.start(t); o.stop(t + .1); t += .095;
    }
    return Math.round((t - c.currentTime) * 1000);
  }
  /** звуковое событие; dx, dy — смещение от инженера в клетках */
  play(k: string, dx = 0, dy = 0, options?: { radius?: number; gain?: number; global?: boolean; key?: string; speaker?: boolean }) {
    const c = this.ctx; if (!c || c.state !== 'running' || this.vol.master <= 0 || this.vol.sfx <= 0) return;
    const dist = Math.hypot(dx, dy), radius = options?.radius ?? 40; if (!options?.global && dist > radius) return;
    const minGap: Record<string, number> = { turret: .07, shot: .06, mine: .05, build: .04, craft: .08, squish: .05, alert: 2, ralert: 3, error: .2, acid: .1 };
    const lastKey = options?.key || k, now = c.currentTime; if (now - (this.last[lastKey] || 0) < (minGap[k] ?? .03)) return; this.last[lastKey] = now;
    if (this.voices > 24) return; this.voices++; setTimeout(() => this.voices--, 600);
    const near = options?.global || k === 'oscar' || k === 'alert' || k === 'ralert' || k === 'research' || k === 'goal' || k === 'error' || k === 'craft' || k === 'ui' || k === 'death' || k === 'launch';
    const attenuation = options?.radius == null ? 1 / (1 + dist * dist / 90) : Math.max(0, 1 - dist / Math.max(1, radius));
    const vol = (options?.radius == null && !options?.global ? (near ? 1 : attenuation) : options?.global ? 1 : attenuation) * (options?.gain ?? 1);
    let pan: StereoPannerNode | undefined;
    const o = options?.speaker ? c.createGain() : this.out(near ? 0 : dx / 18, vol);
    if (options?.speaker) {
      o.gain.value = vol;
      if (c.createStereoPanner) { pan = c.createStereoPanner(); pan.pan.value = options.global ? 0 : Math.max(-1, Math.min(1, dx / Math.max(1, radius))); o.connect(pan); pan.connect(this.sfx); }
      else o.connect(this.sfx);
    }
    if (options?.speaker && options.key) {
      const duration: Record<string, number> = { 'speaker-siren': 1200, 'speaker-alert': 420, 'speaker-bell': 520, 'speaker-horn': 700, 'speaker-completion': 900 };
      const key = options.key, timer = window.setTimeout(() => { const shot = this.speakerOneShots.get(key); if (shot?.gain === o) { this.speakerOneShots.delete(key); o.disconnect(); pan?.disconnect(); } }, duration[k] || 1000);
      this.speakerOneShots.set(key, { gain: o, pan, timer });
    }
    const T = now + .005;
    switch (k) {
      case 'build': this.burst(o, T, .09, 'lowpass', 900, 200, .5); this.tone({ f: 140, f2: 60, t: .14, g: .45 }, o, T); this.burst(o, T, .03, 'highpass', 3000, null, .12, 1, .05); break;
      case 'pickup': this.tone({ f: 520, f2: 900, t: .08, g: .18, type: 'triangle' }, o, T); this.burst(o, T, .05, 'bandpass', 1500, null, .15, 2); break;
      case 'mine': this.burst(o, T, .05, 'bandpass', 2600, null, .35, 6); this.tone({ f: 1750, t: .06, g: .08, type: 'square' }, o, T); break;
      case 'rock': this.burst(o, T, .25, 'lowpass', 1600, 300, .5); this.burst(o, T, .12, 'bandpass', 700, null, .3, 2, .08); break;
      case 'chop': this.burst(o, T, .07, 'bandpass', 950, null, .5, 3); this.burst(o, T, .07, 'bandpass', 800, null, .45, 3, .14); this.burst(o, T, .35, 'lowpass', 600, 150, .25, 1, .22); break;
      case 'craft': this.tone({ f: 880, t: .05, g: .1 }, o, T); this.tone({ f: 1320, t: .07, g: .07, at: .04 }, o, T); break;
      case 'oscar': this.tone({ f: 1046, t: .06, g: .07, type: 'sine' }, o, T); this.tone({ f: 1568, t: .09, g: .06, type: 'sine', at: .07 }, o, T); this.burst(o, T, .12, 'bandpass', 3000, null, .04, 2, .02); break;
      case 'ping': this.tone({ f: 1760, t: .12, g: .1, type: 'sine' }, o, T); this.tone({ f: 2350, t: .18, g: .08, type: 'sine', at: .09 }, o, T); break;
      case 'chat': this.tone({ f: 990, t: .05, g: .06, type: 'triangle' }, o, T); break;
      case 'ui': this.tone({ f: 1400, t: .025, g: .05, type: 'triangle' }, o, T); break;
      case 'research': [0, 4, 7, 12].forEach((s, i) => this.tone({ f: MIDI(72 + s), t: .5, g: .14, type: 'triangle', at: i * .11 }, o, T)); break;
      case 'goal': this.tone({ f: MIDI(76), t: .35, g: .14, type: 'triangle' }, o, T); this.tone({ f: MIDI(83), t: .6, g: .12, type: 'triangle', at: .14 }, o, T); break;
      case 'speaker-siren': for (let i = 0; i < 3; i++) { this.tone({ f: 660, f2: 1100, t: .22, g: .16, type: 'sawtooth', at: i * .34 }, o, T); this.tone({ f: 1100, f2: 660, t: .22, g: .16, type: 'sawtooth', at: i * .34 + .12 }, o, T); } break;
      case 'speaker-alert': this.tone({ f: 1320, t: .13, g: .16, type: 'triangle' }, o, T); this.tone({ f: 880, t: .18, g: .13, type: 'triangle', at: .16 }, o, T); break;
      case 'speaker-bell': this.tone({ f: 1046, t: .45, g: .2, type: 'sine' }, o, T); this.tone({ f: 1568, t: .32, g: .06, type: 'sine', at: .015 }, o, T); break;
      case 'speaker-horn': this.tone({ f: 220, f2: 170, t: .65, g: .24, type: 'square' }, o, T); break;
      case 'speaker-completion': [0, 4, 7, 12].forEach((s, i) => this.tone({ f: MIDI(72 + s), t: .35, g: .15, type: 'triangle', at: i * .12 }, o, T)); break;
      case 'ralert': for (let i = 0; i < 2; i++) { this.tone({ f: 740, t: .1, g: .08, type: 'triangle', at: i * .22 }, o, T); this.tone({ f: 988, t: .1, g: .08, type: 'triangle', at: i * .22 + .11 }, o, T); } break;
      case 'alert': for (let i = 0; i < 3; i++) { this.tone({ f: 880, t: .12, g: .09, type: 'square', at: i * .3 }, o, T); this.tone({ f: 660, t: .12, g: .09, type: 'square', at: i * .3 + .15 }, o, T); } break;
      case 'error': this.tone({ f: 190, t: .12, g: .12, type: 'square' }, o, T); this.tone({ f: 150, t: .14, g: .12, type: 'square', at: .1 }, o, T); break;
      case 'boom': this.burst(o, T, 1.1, 'lowpass', 1800, 80, .9); this.tone({ f: 70, f2: 30, t: .8, g: .7 }, o, T); break;
      case 'squish': this.burst(o, T, .16, 'bandpass', 500, 200, .45, 3); this.tone({ f: 260, f2: 90, t: .15, g: .2, type: 'sawtooth' }, o, T); break;
      case 'acid': this.burst(o, T, .4, 'highpass', 2500, 900, .25); break;
      case 'turret': case 'shot': this.burst(o, T, .06, 'highpass', k === 'turret' ? 900 : 1300, null, .5); this.tone({ f: 160, f2: 70, t: .05, g: .35 }, o, T); break;
      // v1.14: новое оружие и оборона
      case 'laser': this.tone({ f: 1800, f2: 600, t: .12, g: .08, type: 'sawtooth' }, o, T); break;
      case 'tesla': this.burst(o, T, .18, 'bandpass', 4200, 1500, .3, 4); this.tone({ f: 120, t: .15, g: .12, type: 'square' }, o, T); break;
      case 'rail': this.tone({ f: 300, f2: 2400, t: .2, g: .15, type: 'sawtooth' }, o, T); this.burst(o, T, .3, 'highpass', 2000, null, .4); break;
      case 'rocket': this.burst(o, T, .5, 'lowpass', 1200, 300, .45); break;
      case 'flame': this.burst(o, T, .2, 'lowpass', 700, 400, .18); break;
      case 'gate': this.tone({ f: 140, f2: 90, t: .35, g: .12, type: 'triangle' }, o, T); this.burst(o, T, .3, 'bandpass', 900, 600, .08); break;
      case 'equip': this.tone({ f: 520, t: .05, g: .08, type: 'triangle' }, o, T); this.tone({ f: 780, t: .07, g: .07, type: 'triangle', at: .05 }, o, T); break;
      case 'death': this.tone({ f: 440, f2: 110, t: 1.2, g: .2, type: 'sawtooth' }, o, T); break;
      case 'launch': {
        const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(120, T); lp.frequency.linearRampToValueAtTime(900, T + 9); lp.frequency.linearRampToValueAtTime(200, T + 15);
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(.9, T + 6); g.gain.setValueAtTime(.9, T + 10); g.gain.exponentialRampToValueAtTime(0.0001, T + 15);
        src.connect(lp); lp.connect(g); g.connect(o); src.start(T); src.stop(T + 15.2); this.tone({ f: 45, f2: 32, t: 12, g: .5 }, o, T + 2); break;
      }
    }
  }
  playSpeaker(sound: string, dx: number, dy: number, radius: number, volume: number, global: boolean, eventKey: string) {
    const aliases: Record<string, string> = { 'attack-siren': 'speaker-siren', 'short-alert': 'speaker-alert', bell: 'speaker-bell', 'warning-horn': 'speaker-horn', completion: 'speaker-completion' };
    const soundId = aliases[sound]; if (!soundId || volume <= 0 || this.speakerOneShots.has(eventKey)) return;
    this.play(soundId, dx, dy, { radius, gain: Math.max(0, Math.min(1, volume / 100)), global, key: eventKey, speaker: true });
  }
  /** Update a sounding clip without restarting its envelope or scheduled notes. */
  updateSpeakerOneShot(eventKey: string, dx: number, dy: number, radius: number, volume: number, global: boolean) {
    const shot = this.speakerOneShots.get(eventKey), c = this.ctx; if (!shot || !c) return;
    const attenuation = global ? 1 : Math.max(0, 1 - Math.hypot(dx, dy) / Math.max(1, radius));
    shot.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume / 100)) * attenuation, c.currentTime, .025);
    shot.pan?.pan.setTargetAtTime(global ? 0 : Math.max(-1, Math.min(1, dx / Math.max(1, radius))), c.currentTime, .04);
  }
  stopSpeakerOneShot(eventKey: string) {
    const shot = this.speakerOneShots.get(eventKey), c = this.ctx; if (!shot) return;
    this.speakerOneShots.delete(eventKey); window.clearTimeout(shot.timer);
    if (c) { shot.gain.gain.cancelScheduledValues(c.currentTime); shot.gain.gain.setTargetAtTime(0, c.currentTime, .025); window.setTimeout(() => { shot.gain.disconnect(); shot.pan?.disconnect(); }, 150); }
  }
  speakerOneShotActive(eventKey: string) { return this.speakerOneShots.has(eventKey); }
  stopAllSpeakerOneShots(includePreviews = true) { for (const key of this.speakerOneShots.keys()) if (includePreviews || !key.startsWith('speaker-preview:')) this.stopSpeakerOneShot(key); }
  startSpeakerLoop(id: string, sound: string, dx: number, dy: number, radius: number, volume: number, global: boolean) {
    const c = this.ctx; if (!c || c.state !== 'running' || this.vol.master <= 0 || this.vol.sfx <= 0 || volume <= 0) return;
    const dist = Math.hypot(dx, dy); if (!global && dist >= radius) { this.stopSpeakerLoop(id); return; }
    let loop = this.speakerLoops.get(id);
    if (loop && loop.sound !== sound) { this.stopSpeakerLoop(id); loop = undefined; }
    if (!loop) {
      const gain = c.createGain(), nodes: OscillatorNode[] = []; let pan: StereoPannerNode | undefined;
      if (c.createStereoPanner) { pan = c.createStereoPanner(); gain.connect(pan); pan.connect(this.sfx); } else gain.connect(this.sfx);
      const osc = c.createOscillator(); osc.type = sound === 'attack-siren' ? 'sawtooth' : sound === 'warning-horn' ? 'square' : 'triangle';
      const f = sound === 'attack-siren' ? 700 : sound === 'warning-horn' ? 185 : sound === 'bell' ? 830 : sound === 'completion' ? 660 : 540;
      osc.frequency.value = f;
      if (sound === 'short-alert') {
        const pulseGain = c.createGain(); pulseGain.gain.value = .55; osc.connect(pulseGain); pulseGain.connect(gain);
        const pulse = c.createOscillator(), depth = c.createGain(); pulse.frequency.value = 2; depth.gain.value = .45; pulse.connect(depth); depth.connect(pulseGain.gain); pulse.start(); nodes.push(pulse);
      } else osc.connect(gain);
      osc.start(); nodes.push(osc);
      if (sound === 'attack-siren') { const lfo = c.createOscillator(), amount = c.createGain(); lfo.frequency.value = 0.8; amount.gain.value = 350; lfo.connect(amount); amount.connect(osc.frequency); lfo.start(); nodes.push(lfo); }
      loop = { sound, nodes, gain, pan }; this.speakerLoops.set(id, loop);
    }
    const attenuation = global ? 1 : Math.max(0, 1 - dist / Math.max(1, radius));
    loop.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume / 100)) * attenuation * .12, c.currentTime, .04);
    if (loop.pan) loop.pan.pan.setTargetAtTime(global ? 0 : Math.max(-1, Math.min(1, dx / Math.max(1, radius))), c.currentTime, .05);
  }
  stopSpeakerLoop(id: string) {
    const loop = this.speakerLoops.get(id), c = this.ctx; if (!loop) return;
    this.speakerLoops.delete(id);
    if (c) { loop.gain.gain.setTargetAtTime(0, c.currentTime, .035); for (const node of loop.nodes) try { node.stop(c.currentTime + .14); } catch { /* already stopped */ } setTimeout(() => { loop.gain.disconnect(); loop.pan?.disconnect(); }, 180); }
  }
  stopAllSpeakerLoops() { for (const id of this.speakerLoops.keys()) this.stopSpeakerLoop(id); }
  // ---------- фон завода ----------
  private loopNoise(type: BiquadFilterType, f: number, q: number): GainNode {
    const c = this.ctx!; const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0;
    src.connect(fl); fl.connect(g); g.connect(this.amb); src.start(); return g;
  }
  private startAmbient() {
    const c = this.ctx!; const g = c.createGain(); g.gain.value = 0; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.connect(g); g.connect(this.amb);
    const osc = [55, 110.5, 165.3].map((f, i) => { const o = c.createOscillator(); o.type = i ? 'sawtooth' : 'triangle'; o.frequency.value = f; const og = c.createGain(); og.gain.value = i ? .12 : .5; o.connect(og); og.connect(lp); o.start(); return o; });
    this.hum = { osc, g, lp };
    // дребезг конвейеров: шум, промодулированный 14 Гц
    const rg = this.loopNoise('bandpass', 3200, 1.2); const lfo = c.createOscillator(); lfo.frequency.value = 14; const lg = c.createGain(); lg.gain.value = 0;
    const mod = c.createGain(); mod.gain.value = 1; rg.disconnect(); rg.connect(mod); mod.connect(this.amb); lfo.connect(lg); lg.connect(mod.gain); lfo.start();
    this.rattle = { g: rg }; (this.rattle as any).lg = lg;
    this.steam = { g: this.loopNoise('lowpass', 420, .7) };
  }
  /** уровни фоновых слоёв 0..1: машины, конвейеры, пар/буры */
  ambient(machines: number, belts: number, steam: number) {
    if (!this.ctx || !this.hum) return; const t = this.ctx.currentTime;
    this.hum.g.gain.setTargetAtTime(Math.min(1, machines) * .22, t, .4); this.hum.lp.frequency.setTargetAtTime(200 + machines * 260, t, .4);
    this.rattle!.g.gain.setTargetAtTime(Math.min(1, belts) * .06, t, .3); (this.rattle as any).lg.gain.setTargetAtTime(Math.min(1, belts) * .5, t, .3);
    this.steam!.g.gain.setTargetAtTime(Math.min(1, steam) * .18, t, .4);
  }
  // ---------- музыка: генеративный эмбиент ля минор, пьесы ~3 мин и паузы ~1 мин ----------
  private startMusic() {
    this.musicT = this.ctx!.currentTime + 1; this.pieceStart = this.musicT;
    this.musicTimer = window.setInterval(() => this.schedule(), 250);
  }
  private schedule() {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    if (this.vol.music <= 0) { this.musicT = Math.max(this.musicT, c.currentTime); return; }
    const PROG = [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62], [57, 60, 64], [50, 57, 62], [52, 55, 59], [52, 56, 59]];
    const PENTA = [69, 72, 74, 76, 79, 81, 84];
    while (this.musicT < c.currentTime + 1.2) {
      const T = this.musicT, BAR = 8;
      const inPiece = (T - this.pieceStart) % 260 < 190; // 190 с музыки, 70 с тишины
      if (inPiece) {
        const ch = PROG[this.bar % PROG.length];
        for (const n of ch) this.pad(MIDI(n - 12), T, BAR);
        this.pad(MIDI(ch[0] - 24), T, BAR, .5);
        let r = (this.bar * 9301 + 49297) % 233280;
        for (let b = 0; b < 8; b++) { r = (r * 9301 + 49297) % 233280; if (r / 233280 < .33) { const n = PENTA[(r >> 3) % PENTA.length]; this.bell(MIDI(n), T + b + ((r >> 5) % 2) * .5); } }
      }
      this.musicT += BAR; this.bar++;
    }
  }
  private pad(f: number, t: number, dur: number, k = 1) {
    const c = this.ctx!; const g = c.createGain(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = .5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.05 * k, t + 2.5); g.gain.setValueAtTime(.05 * k, t + dur - 1); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 2);
    lp.connect(g); g.connect(this.music);
    for (const det of [-6, 5]) { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 2.1); }
  }
  private bell(f: number, t: number) {
    const c = this.ctx!; const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(.06, t + .01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    g.connect(this.music); g.connect(this.delay);
    for (const [m, a] of [[1, 1], [2.01, .3], [3.98, .1]]) { const o = c.createOscillator(); o.frequency.value = f * m; const og = c.createGain(); og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(t + 2.3); }
  }
  dispose() { clearInterval(this.musicTimer); this.ctx?.close(); this.ctx = null; }
}

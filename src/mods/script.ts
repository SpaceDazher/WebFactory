// v1.11 «Моддинг II»: хост скриптов модов. Живёт рядом с симуляцией (Worker симуляции, главный поток или Node-тест).
// На каждый мод с control.js — отдельный Worker-песочница (sandbox.ts). Протокол:
//   хост → мод: init { mod, seed, tick, storage } → ready { subs } | fail;  ev { tick, evs } → ops { ops, ms, st, subs? }.
// Детерминизм: события тика N уходят модам после g.step(); следующий тик (N+1) не начинается, пока не пришли ответы
// всех модов (g.scriptWait), и команды применяются в начале тика N+1 в порядке загрузки модов.
// Лимиты: > 2 мс на тик или > 64 МБ — «страйк», 3 подряд — мод отключается командой modoff (в совместной игре она
// уходит всем игрокам и применяется в одном тике); зависание > hangMs — Worker уничтожается сразу.
import type { Game } from '../sim/game';
import { applyScriptOps, ScriptEv, ScriptOp, sev } from '../sim/scripting';
import { workerSource, checkScript } from './sandbox';
import { CHUNK } from '../core/types';

export interface ScriptMod { name: string; title: string; code: string }
export interface ModPort { post(m: any): void; onmessage: ((m: any) => void) | null; terminate(): void }
export type Spawn = (src: string, name: string) => ModPort;
export interface ConsoleLine { tick: number; mod: string; level: 'info' | 'warn' | 'error'; text: string }
export interface ModStat { name: string; title: string; ms: number; peak: number; mem: number; store: number; state: 'start' | 'run' | 'off' | 'fail'; reason?: string; strikes: number }
export interface HostOpts {
  onConsole?: (l: ConsoleLine) => void;
  onGui?: (mod: string, title: string, op: Extract<ScriptOp, { op: 'gui' | 'guiclose' }>) => void;
  /** отправить команду игре (в совместной игре — через lockstep, иначе g.enqueue) */
  command?: (c: any) => void;
  limitMs?: number; memMB?: number; hangMs?: number; strikes?: number;
  now?: () => number;
}
interface Slot {
  mod: ScriptMod; port: ModPort | null; state: ModStat['state']; reason?: string; subs: Record<string, any>; ticks: number[];
  waiting: number | null; sentAt: number; pend: { ops: ScriptOp[]; st: string | null } | null; first: boolean;
  ms: number; peak: number; mem: number; store: number; strikes: number; offSent: boolean;
}
const nowDefault = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class ScriptHost {
  mods: ScriptMod[] = []; slots: Slot[] = []; g: Game | null = null; lines: ConsoleLine[] = [];
  constructor(public spawn: Spawn, public o: HostOpts = {}) {}
  private now() { return (this.o.now || nowDefault)(); }
  get limitMs() { return this.o.limitMs ?? 2; }
  /** набор скриптовых модов (порядок — порядок загрузки); перезапускает Worker у текущей партии */
  setMods(mods: ScriptMod[]) { this.mods = mods.slice(); if (this.g) this.attach(this.g); }
  log(mod: string, level: ConsoleLine['level'], text: string) {
    const l = { tick: this.g?.tick ?? 0, mod, level, text }; this.lines.push(l); if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500); this.o.onConsole?.(l);
  }
  /** новая или загруженная партия: Worker модов запускаются заново со своими storage из сохранения */
  attach(g: Game) {
    this.stop(); this.g = g;
    if (!this.mods.length) { g.sev = null; g.scriptPre = g.scriptPost = g.scriptWait = g.scriptOff = null; g.world.onGenScript = null; return; }
    g.sev = []; g.scriptPre = () => this.pre(); g.scriptPost = () => this.post(); g.scriptWait = () => this.waiting(); g.scriptOff = (m, r) => this.kill(m, r);
    g.world.onGenScript = c => sev(g, { e: 'chunk_generated', chunk: { x: c.cx, y: c.cy }, area: { x: c.cx * CHUNK, y: c.cy * CHUNK, w: CHUNK, h: CHUNK } });
    for (const m of this.mods) {
      const s: Slot = { mod: m, port: null, state: 'start', subs: {}, ticks: [], waiting: null, sentAt: this.now(), pend: null, first: true, ms: 0, peak: 0, mem: 0, store: 0, strikes: 0, offSent: false };
      this.slots.push(s);
      const bad = checkScript(m.code); if (bad) { this.fail(s, bad); continue; }
      try { s.port = this.spawn(workerSource(m.code), m.name); } catch (e) { this.fail(s, 'Worker не запустился: ' + (e as Error).message); continue; }
      s.port.onmessage = msg => this.recv(s, msg);
      s.port.post({ t: 'init', mod: m.name, seed: g.seed, tick: g.tick, storage: g.scriptStore[m.name] ?? null });
      // события, отправленные до сохранения и не применённые, — обработать заново (storage в сохранении — до них)
      const inf = g.scriptInflight[m.name]; if (inf) { s.port.post({ t: 'ev', tick: inf.tick, evs: inf.evs }); s.waiting = inf.tick; }
    }
  }
  stop() { for (const s of this.slots) { try { s.port?.terminate(); } catch { /* */ } } this.slots = []; }
  private fail(s: Slot, text: string) { s.state = 'fail'; s.reason = text; this.log(s.mod.name, 'error', text); try { s.port?.terminate(); } catch { /* */ } s.port = null; s.waiting = null; if (this.g) { delete this.g.scriptInflight[s.mod.name]; this.g.msg(`Мод «${s.mod.title}» отключён: ${text}`); } }
  /** отключить мод (команда modoff дошла до симуляции — у всех игроков в одном тике) */
  kill(mod: string, reason: string) { const s = this.slots.find(x => x.mod.name === mod); if (!s || s.state === 'off' || s.state === 'fail') return; s.state = 'off'; s.reason = reason; try { s.port?.terminate(); } catch { /* */ } s.port = null; s.waiting = null; s.pend = null; if (this.g) delete this.g.scriptInflight[mod]; this.log(mod, 'error', 'мод отключён: ' + reason); this.g?.msg(`Мод «${s.mod.title}» отключён: ${reason}`); }
  private strike(s: Slot, why: string) {
    s.strikes++; if (s.strikes < (this.o.strikes ?? 3) || s.offSent) return; s.offSent = true;
    const c = { t: 'modoff', mod: s.mod.name, reason: why + ' 3 раза подряд' }; if (this.o.command) this.o.command(c); else this.g?.enqueue(c as any);
  }
  private recv(s: Slot, m: any) {
    const g = this.g; if (!g || !s.port) return;
    if (m.t === 'fail') { this.fail(s, 'ошибка при запуске control.js: ' + m.text); return; }
    if (m.t === 'ready') { s.state = 'run'; s.subs = m.subs || {}; s.ticks = s.subs.tick || []; for (const l of m.logs || []) this.opLog(s, l); s.mem = m.mem || 0; return; }
    if (m.t === 'ops') {
      if (s.waiting !== m.tick) return; s.waiting = null; if (m.subs) { s.subs = m.subs; s.ticks = m.subs.tick || []; }
      const ui: ScriptOp[] = [], sim: ScriptOp[] = [];
      for (const o of m.ops as ScriptOp[]) (o.op === 'log' || o.op === 'gui' || o.op === 'guiclose' ? ui : sim).push(o);
      for (const o of ui) { if (o.op === 'log') this.opLog(s, o); else this.o.onGui?.(s.mod.name, s.mod.title, o as any); }
      s.pend = { ops: sim, st: m.st ?? null };
      s.ms = s.ms * 0.9 + m.ms * 0.1; s.peak = Math.max(s.peak * 0.995, m.ms); s.mem = m.mem || 0; s.store = m.sl || 0;
      const memMB = Math.max(s.mem, s.store * 2) / 1048576;
      if (m.ms > this.limitMs) this.strike(s, `скрипт работал ${m.ms.toFixed(1)} мс за тик (лимит ${this.limitMs} мс)`);
      else if (memMB > (this.o.memMB ?? 64)) this.strike(s, `скрипт занял ${memMB.toFixed(0)} МБ памяти (лимит ${this.o.memMB ?? 64} МБ)`);
      else s.strikes = 0;
    }
  }
  private opLog(s: Slot, o: any) { this.log(s.mod.name, o.level || 'info', String(o.text)); }
  /** начало тика N+1: команды модов в порядке загрузки */
  private pre() {
    const g = this.g!;
    for (const s of this.slots) {
      const p = s.pend; if (!p) continue; s.pend = null; delete g.scriptInflight[s.mod.name];
      if (p.st != null) g.scriptStore[s.mod.name] = p.st;
      if (p.ops.length) for (const w of applyScriptOps(g, s.mod.name, s.mod.title, p.ops)) this.log(s.mod.name, 'warn', w);
    }
  }
  /** конец тика N: разослать события подписчикам */
  private post() {
    const g = this.g!; const evs = g.sev!; const tick = g.tick - 1;
    for (const s of this.slots) {
      if (s.state !== 'run' || !s.port) continue;
      const mine: ScriptEv[] = [];
      if (s.first) { s.first = false; if (s.subs.load) mine.push({ e: 'load' }); }
      if (s.ticks.length && s.ticks.some(p => tick % p === 0)) mine.push({ e: 'tick' });
      for (const e of evs) if (s.subs[e.e] && (e.mod == null || e.mod === s.mod.name)) mine.push(e);
      if (!mine.length) continue;
      g.scriptInflight[s.mod.name] = { tick, evs: mine };
      s.port.post({ t: 'ev', tick, evs: mine }); s.waiting = tick; s.sentAt = this.now();
    }
    evs.length = 0;
  }
  /** true — следующий тик ждать нельзя: Worker модов ещё стартуют или не ответили на события прошлого тика */
  waiting(): boolean {
    let w = false; const t = this.now(), hang = this.o.hangMs ?? 3000;
    for (const s of this.slots) {
      if (!s.port) continue;
      if (s.state === 'start' || s.waiting != null) {
        if (t - s.sentAt > (s.state === 'start' ? Math.max(hang, 10000) : hang)) { this.fail(s, s.state === 'start' ? 'control.js не запустился за 10 с' : `скрипт завис (нет ответа ${(hang / 1000).toFixed(0)} с) — Worker остановлен`); continue; }
        w = true;
      }
    }
    return w;
  }
  /** дождаться ответов (тесты, сохранение) */
  async settle(maxMs = 10000) { const t0 = this.now(); while (this.waiting() && this.now() - t0 < maxMs) await new Promise(r => setTimeout(r, 0)); return !this.waiting(); }
  stats(): ModStat[] { return this.slots.map(s => ({ name: s.mod.name, title: s.mod.title, ms: s.ms, peak: s.peak, mem: s.mem, store: s.store, state: s.state, reason: s.reason, strikes: s.strikes })); }
}

/** Worker мода в браузере (из Worker симуляции или главного потока) */
export const browserSpawn: Spawn = (src, name) => {
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })); const w = new Worker(url, { name: 'mod:' + name });
  const p: ModPort = { post: m => w.postMessage(m), onmessage: null, terminate: () => { w.terminate(); URL.revokeObjectURL(url); } };
  w.onmessage = e => p.onmessage?.(e.data); w.onerror = e => { e.preventDefault?.(); p.onmessage?.({ t: 'fail', text: (e as ErrorEvent).message || 'ошибка Worker' }); };
  return p;
};
/** скриптовые моды из пакетов (порядок загрузки сохраняется) */
export function scriptMods(pkgs: { info: { name: string; title: string }; files: Record<string, Uint8Array> }[]): ScriptMod[] {
  const dec = new TextDecoder(); const r: ScriptMod[] = [];
  for (const p of pkgs) { const f = p.files['control.js']; if (f) r.push({ name: p.info.name, title: p.info.title, code: dec.decode(f).replace(/^\uFEFF/, '') }); }
  return r;
}

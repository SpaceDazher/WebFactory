// Инструменты бета-теста (п. 3 плана 1.0), клиентская часть: журнал, сведения о системе,
// FPS, первое открытие окон, сборка файла статистики и отчёта об ошибке. Ничего не отправляется в сеть.
declare const __VERSION__: string;
export const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
export const SAVE_BEGIN = '-----BEGIN ZAVOD7 SAVE-----', SAVE_END = '-----END ZAVOD7 SAVE-----';

export interface LogEntry { t: number; lvl: 'error' | 'warn' | 'info' | 'game'; msg: string; }
const T0 = typeof performance !== 'undefined' ? performance.now() : 0;
const LOG_MAX = 400;
export const journal: LogEntry[] = [];
export let errorCount = 0;
const onErr: ((e: LogEntry) => void)[] = [];
export function onError(f: (e: LogEntry) => void) { onErr.push(f); }
export function log(lvl: LogEntry['lvl'], msg: string) {
  const e = { t: performance.now() - T0, lvl, msg: String(msg).slice(0, 2000) };
  journal.push(e); if (journal.length > LOG_MAX) journal.shift();
  if (lvl === 'error') { errorCount++; for (const f of onErr) { try { f(e); } catch { /* слушатель не должен ронять журнал */ } } }
}
/** Firefox и Safari пишут в stack только кадры — добавляем «Имя: сообщение» первой строкой (по ней считается подпись ошибки) */
const errText = (x: Error) => { const head = `${x.name}: ${x.message}`; return !x.stack ? head : x.stack.startsWith(head) ? x.stack : head + '\n' + x.stack; };
const str = (a: any[]) => a.map(x => x instanceof Error ? errText(x) : typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ');
/** перехват console.error/warn, необработанных ошибок и отклонённых промисов */
export function installHooks() {
  const ce = console.error.bind(console), cw = console.warn.bind(console);
  console.error = (...a: any[]) => { log('error', str(a)); ce(...a); };
  console.warn = (...a: any[]) => { log('warn', str(a)); cw(...a); };
  window.addEventListener('error', ev => log('error', `${ev.message} @ ${ev.filename || '?'}:${ev.lineno}:${ev.colno}${ev.error?.stack ? '\n' + ev.error.stack : ''}`));
  window.addEventListener('unhandledrejection', ev => log('error', 'unhandledrejection: ' + str([ev.reason])));
}

// ---------- FPS и окна ----------
const FPS_EDGES = [20, 30, 45, 55];
export const perf = { fpsHist: [0, 0, 0, 0, 0], fpsMin: Infinity, fpsSum: 0, fpsN: 0, tickMax: 0 };
/** вызывается раз в ~0,5 с с текущим FPS */
export function fpsSample(fps: number, tickMs: number) {
  if (!(fps > 0)) return; let b = 0; while (b < FPS_EDGES.length && fps >= FPS_EDGES[b]) b++;
  perf.fpsHist[b]++; perf.fpsMin = Math.min(perf.fpsMin, fps); perf.fpsSum += fps; perf.fpsN++; perf.tickMax = Math.max(perf.tickMax, tickMs || 0);
}
export const windows: Record<string, { first: number; n: number }> = {};
export function winOpened(w: string) { const x = windows[w] || (windows[w] = { first: Math.round((performance.now() - T0) / 1000), n: 0 }); x.n++; }

// ---------- система (без личных данных) ----------
export function installId(): string {
  try { let id = localStorage.getItem('zavod7:beta-id'); if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('zavod7:beta-id', id); } return id; } catch { return 'nostorage'; }
}
export function browserInfo() {
  const ua = navigator.userAgent;
  const m = /(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/.exec(ua); const safari = /Safari\//.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  const name = !m ? 'unknown' : m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1] === 'Version' && safari ? 'Safari' : m[1] === 'Version' ? 'unknown' : m[1];
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iOS' : 'other';
  return { browser: name + (m ? ' ' + m[2] : ''), os, lang: navigator.language, screen: `${screen.width}×${screen.height}@${window.devicePixelRatio || 1}`, window: `${innerWidth}×${innerHeight}`,
    cores: navigator.hardwareConcurrency || null, memoryGB: (navigator as any).deviceMemory || null, headless: /HeadlessChrome/.test(ua) };
}
export function clientPart(x: { renderer: string; rendererNote: string; worker: boolean; settings: any; gpu?: string }) {
  return {
    version: VERSION, installId: installId(), exported: new Date().toISOString(), sessionSec: Math.round((performance.now() - T0) / 1000),
    system: { ...browserInfo(), renderer: x.renderer + (x.rendererNote ? ' (' + x.rendererNote + ')' : ''), gpu: x.gpu || null, worker: x.worker },
    perf: { fpsAvg: perf.fpsN ? Math.round(perf.fpsSum / perf.fpsN) : null, fpsMin: isFinite(perf.fpsMin) ? Math.round(perf.fpsMin) : null, fpsHist: Object.fromEntries(['<20', '20–30', '30–45', '45–55', '55+'].map((k, i) => [k, perf.fpsHist[i]])), tickMaxMs: Math.round(perf.tickMax * 100) / 100 },
    windows, errors: errorCount,
    settings: (({ lang, uiScale, renderer, simWorker, colorblind, autosaveMin, smoke, dayNight }) => ({ lang, uiScale, renderer, simWorker, colorblind, autosaveMin, smoke, dayNight }))(x.settings || {}),
  };
}
/** Краткая подпись ошибки для статистики и сводки: первая строка без чисел и адресов (одна ошибка — одна подпись) */
export function errSig(msg: string) {
  return String(msg).split('\n')[0].replace(/@ \S+/g, '').replace(/(file|https?|blob):\/\/\S+/g, '').replace(/\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 160);
}
/** Файл статистики партии: игровая часть (из симуляции) + клиентская */
export function teleFile(sim: any, client: ReturnType<typeof clientPart>) { return { ...sim, client }; }

const hms = (ms: number) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`; };
/** Текст отчёта об ошибке: описание, система, журнал, краткая статистика и строка сохранения */
export function bugReport(o: { desc: string; client: ReturnType<typeof clientPart>; sim: any | null; save: string | null; workerErrors: string[] }) {
  const c = o.client, s = o.sim; const L: string[] = [];
  L.push(`ZAVOD-7 bug report · v${c.version} · ${c.exported}`);
  L.push('', '=== What happened ===', o.desc.trim() || '(no description)');
  L.push('', '=== System ===', `install: ${c.installId}`);
  for (const [k, v] of Object.entries(c.system)) L.push(`${k}: ${v}`);
  L.push(`fps: avg ${c.perf.fpsAvg ?? '—'}, min ${c.perf.fpsMin ?? '—'}, tick max ${c.perf.tickMaxMs} ms · session ${c.sessionSec} s · errors ${c.errors}`);
  L.push('settings: ' + JSON.stringify(c.settings));
  if (s) {
    L.push('', '=== Game ===', `seed ${s.seed} · mode ${s.mode} · tick ${s.tick} (${s.playMin} min) · goal ${s.goalNow.n} (${s.goalNow.sinceMin} min on it) · techs ${s.techs.length} · rockets ${s.totals.rockets} · buildings ${s.totals.buildingsNow} · deaths ${s.deaths.length}`);
  }
  if (o.workerErrors.length) { L.push('', '=== Worker errors ==='); for (const e of o.workerErrors.slice(-20)) L.push(e); }
  L.push('', `=== Log (last ${Math.min(journal.length, 150)}) ===`);
  for (const e of journal.slice(-150)) L.push(`[${hms(e.t)}] ${e.lvl.toUpperCase().padEnd(5)} ${e.msg}`);
  if (o.save) { L.push('', '=== Save (load: Menu → Import from file, or paste into the bug report window) ===', SAVE_BEGIN); for (let i = 0; i < o.save.length; i += 120) L.push(o.save.slice(i, i + 120)); L.push(SAVE_END); }
  return L.join('\n');
}
/** Строка сохранения из отчёта, файла .z7save или просто вставленной строки */
export function extractSave(text: string): string {
  const a = text.indexOf(SAVE_BEGIN), b = text.indexOf(SAVE_END);
  const body = a >= 0 && b > a ? text.slice(a + SAVE_BEGIN.length, b) : text;
  return body.replace(/\s+/g, '');
}
export function download(name: string, data: string, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

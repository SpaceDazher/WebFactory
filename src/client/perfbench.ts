// Замер производительности (v1.1): эталонная база бота (~1 900 построек), два вида — обычный масштаб и отдаление.
// Меряем интервалы кадров (requestAnimationFrame — это и есть кадры/с вместе с видеокартой), время кадра в главном
// потоке и UPS симуляции. Результат — файл zavod7-gpubench-*.json для tools/stats-report.ts. Запуск: index.html?bench=1; v1.9 — index.html?bench=mega (мегабаза ~20 000 построек)
import { browserInfo, VERSION, installId } from './beta';

export interface BenchPhase { zoom: number; sec: number; frames: number; fps: number; frameP50: number; frameP95: number; frameP99: number; over20: number; cpuP50: number; cpuP95: number; ups: number; }
export interface BenchDeps {
  loadRef(): Promise<void>; setZoom(z: number): void; frameCost(): { n: number; ms: number[] }; ups(): number; ents(): number;
  renderer(): string; rendererNote(): string; gpuName(): string; preset(): string; settings(): any; progress(text: string, frac: number): void;
  /** v1.11: замеры мира уровня (ракеты в минуту и т. п.); reset — начать отсчёт */ metrics?(reset: boolean): Promise<any>;
}
const q = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Имя адаптера активного игрового WebGL-контекста; Canvas и скрытые браузером значения показываем честно. */
export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext | null, mode: 'webgl' | 'canvas' | 'legacy'): string {
  if (!gl) return mode === 'canvas' ? 'Canvas2D (WebGL not active)' : 'unknown';
  try {
    if (gl.isContextLost()) return 'unknown';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return name && name !== 'null' && name !== 'undefined' ? name : 'unknown';
  } catch { return 'unknown'; }
}

async function phase(d: BenchDeps, zoom: number, sec: number, label: string, base: number, span: number): Promise<BenchPhase> {
  d.setZoom(zoom); await sleep(1500); // кэш спрайтов и чанков для нового масштаба
  const iv: number[] = []; let last = 0, run = true;
  const loop = (t: number) => { if (last) iv.push(t - last); last = t; if (run) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const n0 = d.frameCost().n; const ups: number[] = []; const t0 = performance.now();
  while (performance.now() - t0 < sec * 1000) { await sleep(250); ups.push(d.ups()); d.progress(label, base + span * Math.min(1, (performance.now() - t0) / (sec * 1000))); }
  run = false;
  const fc = d.frameCost(); const k = Math.min(256, fc.n - n0); const cpu: number[] = []; for (let i = fc.n - k; i < fc.n; i++) cpu.push(fc.ms[i & 255]);
  const real = (performance.now() - t0) / 1000;
  return { zoom, sec: r2(real), frames: iv.length, fps: r2(iv.length / real), frameP50: r2(q(iv, 0.5)), frameP95: r2(q(iv, 0.95)), frameP99: r2(q(iv, 0.99)), over20: r2(iv.filter(x => x > 20).length / Math.max(1, iv.length)),
    cpuP50: r2(q(cpu, 0.5)), cpuP95: r2(q(cpu, 0.95)), ups: r2(q(ups, 0.5)) };
}

export async function runBench(d: BenchDeps, opt: { warm?: number; sec?: number; mega?: boolean; level?: number; info?: () => any } = {}) {
  const warm = opt.warm ?? 6, sec = opt.sec ?? 10;
  d.progress('Загрузка эталонной базы…', 0);
  await d.loadRef();
  const t0 = performance.now(); while (performance.now() - t0 < warm * 1000) { await sleep(250); d.progress('Прогрев (текстуры, кэш чанков)…', 0.1 * (performance.now() - t0) / (warm * 1000)); }
  await d.metrics?.(true);
  // v1.9: мегабаза (?bench=mega) — ещё и вид издалека (карта LOD, вся база на экране)
  const k = opt.mega ? 0.3 : 0.45;
  const ph = [await phase(d, 1, sec, 'Обычный масштаб', 0.1, k), await phase(d, 0.5, sec, 'Отдаление', 0.1 + k, k)];
  if (opt.mega) ph.push(await phase(d, 0.1, sec, 'Карта издалека (LOD)', 0.1 + 2 * k, k));
  d.setZoom(1); const metrics = (await d.metrics?.(false)) || null; d.progress('Готово', 1);
  // итог — по худшему из видов
  const result = { fps: Math.min(...ph.map(p => p.fps)), frameP50: Math.max(...ph.map(p => p.frameP50)), frameP95: Math.max(...ph.map(p => p.frameP95)), cpuP95: Math.max(...ph.map(p => p.cpuP95)), ups: Math.min(...ph.map(p => p.ups)) };
  const s = d.settings();
  return {
    format: 'zavod7-gpubench', v: 1, version: VERSION, installId: installId(), exported: new Date().toISOString(),
    system: { ...browserInfo(), gpu: d.gpuName() }, renderer: d.renderer(), rendererNote: d.rendererNote(), preset: d.preset(),
    settings: { resScale: s.resScale, dprMax: s.dprMax, fpsCap: s.fpsCap, tex: s.tex, smoke: s.smoke, dayNight: s.dayNight, renderer: s.renderer },
    scene: opt.level ? 'L' + opt.level : opt.mega ? 'megabase' : 'refbase', level: opt.level || 0, levelInfo: opt.info?.() || null, metrics, ents: d.ents(), phases: ph, result,
    ok60: result.frameP50 <= 16.9 && result.fps >= 57,
  };
}
export type BenchFile = Awaited<ReturnType<typeof runBench>>;

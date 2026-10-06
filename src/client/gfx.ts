// Настройка графики для слабых ПК (п. 5 плана 1.0): пресеты, подбор по железу при первом запуске,
// подсказка при низком FPS. Пресет — это просто набор обычных настроек; любую можно поменять отдельно.
import type { Settings } from './settings';

export type Preset = 'high' | 'medium' | 'low' | 'min';
export interface GfxValues { tex: number; resScale: number; dprMax: number; fpsCap: number; detail: boolean; smoke: boolean; dayNight: boolean; }
export const PRESETS: Record<Preset, GfxValues> = {
  high: { tex: 2048, resScale: 1, dprMax: 3, fpsCap: 0, detail: true, smoke: true, dayNight: true },
  medium: { tex: 1024, resScale: 1, dprMax: 1.5, fpsCap: 0, detail: true, smoke: true, dayNight: true },
  low: { tex: 512, resScale: 0.75, dprMax: 1, fpsCap: 60, detail: false, smoke: false, dayNight: true },
  min: { tex: 512, resScale: 0.5, dprMax: 1, fpsCap: 30, detail: false, smoke: false, dayNight: false },
};
export const PRESET_NAMES: Record<Preset, string> = { high: 'Высокое', medium: 'Среднее', low: 'Низкое', min: 'Минимум' };

/** Какой пресет подходит этому компьютеру. soft — WebGL без видеокарты (SwiftShader, llvmpipe), nogl — WebGL2 нет совсем */
export function detectPreset(hw: { cores?: number; memGB?: number; soft?: boolean; nogl?: boolean; pixels?: number }): { preset: Preset; why: string[] } {
  const why: string[] = []; let score = 0;
  const cores = hw.cores || 4, mem = hw.memGB, px = hw.pixels || 0;
  if (cores <= 2) { score += 2; why.push(`${cores} ядра`); } else if (cores <= 4) { score += 1; why.push(`${cores} ядра`); }
  if (mem != null && mem <= 2) { score += 2; why.push(`${mem} ГБ памяти`); } else if (mem != null && mem <= 4) { score += 1; why.push(`${mem} ГБ памяти`); }
  if (hw.soft) { score += 2; why.push('WebGL без видеокарты'); } else if (hw.nogl) { score += 1; why.push('нет WebGL2'); }
  if (px > 3840 * 2160 * 0.9 && score > 0) { score += 1; why.push('экран 4K'); }
  return { preset: score >= 4 ? 'min' : score >= 2 ? 'low' : score >= 1 ? 'medium' : 'high', why };
}
/** Значения пресета в настройки (текстуры хранятся отдельно — их применяет вызывающий) */
export function presetSettings(p: Preset): Partial<Settings> {
  const v = PRESETS[p]; return { gfx: p, resScale: v.resScale, dprMax: v.dprMax, fpsCap: v.fpsCap, detail: v.detail, smoke: v.smoke, dayNight: v.dayNight };
}
/** Совпадают ли текущие настройки с каким-нибудь пресетом (иначе — «свои») */
export function matchPreset(s: Settings, tex: number): Settings['gfx'] {
  for (const p of Object.keys(PRESETS) as Preset[]) {
    const v = PRESETS[p];
    if (v.tex === tex && v.resScale === s.resScale && v.dprMax === s.dprMax && v.fpsCap === s.fpsCap && v.detail === s.detail && v.smoke === s.smoke && v.dayNight === s.dayNight) return p;
  }
  return 'custom';
}
/** Следит за FPS и один раз за сессию предлагает понизить графику */
export class FpsWatch {
  private t = 0; private sum = 0; private n = 0; hinted = false;
  /** вызывать раз в ~0,5 с; возвращает true, когда пора показать подсказку */
  sample(fps: number, dtMs: number, preset: Settings['gfx']): boolean {
    if (this.hinted || preset === 'min' || !(fps > 0)) return false;
    this.t += dtMs; this.sum += fps; this.n++;
    if (this.t < 20000) return false;
    const avg = this.sum / this.n; this.t = 0; this.sum = 0; this.n = 0;
    if (avg < 40) { this.hinted = true; return true; }
    return false;
  }
}

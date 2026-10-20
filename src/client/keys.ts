// v1.11: переназначение клавиш на любые кнопки — сочетания с Ctrl/Shift/Alt/Cmd, кнопки мыши (средняя, «назад», «вперёд»),
// клавиши без кода (e.code пустой — по e.key), два назначения на действие. Чистые функции — для теста без браузера.
export interface KeyEv { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; }
const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
export const MOD_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);
/** код события: e.code, а если его нет (некоторые раскладки, экранные клавиатуры) — «Key:<символ>» */
export function evCode(e: { code?: string; key?: string }): string {
  if (e.code && e.code !== 'Unidentified') return e.code;
  return e.key && e.key !== 'Unidentified' && e.key !== 'Dead' ? 'Key:' + e.key.toLowerCase() : '';
}
export interface Bind { code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; }
export function parseBind(s: string): Bind | null {
  if (!s) return null;
  const parts = s === '+' ? ['+'] : s.split('+'); const code = parts.pop()!;
  const b: Bind = { code, ctrl: false, alt: false, shift: false, meta: false };
  for (const p of parts) { if (p === 'Ctrl') b.ctrl = true; else if (p === 'Alt') b.alt = true; else if (p === 'Shift') b.shift = true; else if (p === 'Meta') b.meta = true; }
  return b;
}
/** сочетание по событию: модификаторы + клавиша (сам модификатор, нажатый один, — без префикса) */
export function comboOf(e: KeyEv, code = e.code): string {
  if (MOD_CODES.has(code)) return code;
  const m: string[] = []; if (e.ctrlKey) m.push('Ctrl'); if (e.altKey) m.push('Alt'); if (e.shiftKey) m.push('Shift'); if (e.metaKey) m.push('Meta');
  return [...m, code].join('+');
}
/** совпадение: с модификаторами — точно; без модификаторов — если не зажаты Ctrl/Alt/Cmd (Shift можно: Shift+R — поворот назад) */
export function bindMatch(s: string, e: KeyEv): 0 | 1 | 2 {
  const b = parseBind(s); if (!b || b.code !== e.code) return 0;
  const exact = b.ctrl === e.ctrlKey && b.alt === e.altKey && b.shift === e.shiftKey && b.meta === e.metaKey;
  if (b.ctrl || b.alt || b.shift || b.meta) return exact ? 2 : 0;
  if (MOD_CODES.has(b.code)) return 1;
  return !e.ctrlKey && !e.altKey && !e.metaKey ? 1 : 0;
}
/** какое действие сработало: сначала точные сочетания, потом простые клавиши */
export function actionOf(e: KeyEv, keys: Record<string, string>, keys2: Record<string, string>, only?: (a: string) => boolean): string | null {
  let best: string | null = null, bestQ = 0;
  for (const src of [keys, keys2]) for (const a in src) { if (only && !only(a)) continue; const q = bindMatch(src[a], e); if (q > bestQ) { bestQ = q; best = a; if (q === 2) return a; } }
  return best;
}
/** код клавиши без модификаторов — для действий, которые держат (ходьба, стрельба) */
export const baseCode = (s: string) => parseBind(s)?.code || '';
export { MODS };

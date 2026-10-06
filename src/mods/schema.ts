// v1.10: проверка прототипов модов. Схема полей выводится из встроенных данных (какие поля и какого вида есть у предметов,
// рецептов, технологий и построек игры) — новое поле в данных игры сразу становится доступно модам. Поверх — смысловые
// проверки (диапазоны, перечисления, ссылки). Ошибка — «поле Z: что не так», без падения.
export type Shape = { k: 'num' | 'str' | 'bool' | 'any' } | { k: 'arr'; of: Shape } | { k: 'tup'; of: Shape[] } | { k: 'obj'; f: Record<string, Shape> };
const kindOf = (v: any) => typeof v === 'number' ? 'num' : typeof v === 'string' ? 'str' : typeof v === 'boolean' ? 'bool' : Array.isArray(v) ? 'arr' : v && typeof v === 'object' ? 'obj' : 'any';
/** вид поля по образцам (все значения этого поля во встроенных данных) */
export function infer(vals: any[]): Shape {
  vals = vals.filter(v => v !== undefined && v !== null);
  if (!vals.length) return { k: 'any' };
  const ks = new Set(vals.map(kindOf));
  if (ks.size > 1) return { k: 'any' };
  const k = [...ks][0];
  if (k === 'num' || k === 'str' || k === 'bool' || k === 'any') return { k };
  if (k === 'arr') {
    const L = vals[0].length;
    if (L > 0 && L <= 4 && vals.every(a => a.length === L)) {
      const pos = Array.from({ length: L }, (_, i) => infer(vals.map(a => a[i])));
      if (new Set(pos.map(p => p.k)).size > 1) return { k: 'tup', of: pos };
    }
    return { k: 'arr', of: infer(vals.flat()) };
  }
  const keys = new Set<string>(); for (const o of vals) for (const x of Object.keys(o)) keys.add(x);
  const f: Record<string, Shape> = {}; for (const x of keys) f[x] = infer(vals.map(o => o[x]));
  return { k: 'obj', f };
}
/** схема записи: поле → вид, по всем записям таблицы */
export function inferTable(defs: any[]): Record<string, Shape> { const s = infer(defs); return s.k === 'obj' ? s.f : {}; }
const KIND_RU: Record<string, string> = { num: 'число', str: 'строка', bool: 'true или false', arr: 'список [...]', tup: 'список [...]', obj: 'объект {...}' };
/** проверить значение по виду; ошибки — [путь, текст] */
export function check(v: any, s: Shape, path: string, out: [string, string][]) {
  if (s.k === 'any') return;
  const k = kindOf(v);
  if (s.k === 'num') { if (k !== 'num' || !Number.isFinite(v)) out.push([path, `ожидается число, а не ${show(v)}`]); return; }
  if (s.k === 'str' || s.k === 'bool') { if (k !== s.k) out.push([path, `ожидается ${KIND_RU[s.k]}, а не ${show(v)}`]); return; }
  if (s.k === 'arr' || s.k === 'tup') {
    if (k !== 'arr') { out.push([path, `ожидается ${KIND_RU[s.k]}, а не ${show(v)}`]); return; }
    if (s.k === 'tup') { if (v.length !== s.of.length) { out.push([path, `ожидается ${s.of.length} значения в скобках, а не ${v.length}`]); return; } v.forEach((x: any, i: number) => check(x, s.of[i], `${path}[${i}]`, out)); }
    else v.forEach((x: any, i: number) => check(x, s.of, `${path}[${i}]`, out));
    return;
  }
  if (k !== 'obj') { out.push([path, `ожидается объект {...}, а не ${show(v)}`]); return; }
  const F = (s as { k: 'obj'; f: Record<string, Shape> }).f;
  for (const key of Object.keys(v)) { if (!(key in F)) { out.push([path ? path + '.' + key : key, `неизвестное поле (есть: ${Object.keys(F).join(', ')})`]); continue; } check(v[key], F[key], path ? path + '.' + key : key, out); }
}
export const show = (v: any) => { const t = JSON.stringify(v); return t === undefined ? 'пусто' : t.length > 40 ? t.slice(0, 40) + '…' : t; };
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** PNG: подпись и размер из IHDR (без декодирования) */
export function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

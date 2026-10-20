// v1.10: мод = info.json + prototypes/*.json + locale/*.json + спрайты PNG (папка или zip). Разбор, отпечаток, порядок загрузки.
import { isSemver, satisfies, gameVer, parseVer, cmpVer } from './semver';
import { ID_RE } from './schema';
export interface Dep { name: string; range: string; optional: boolean; }
export interface ModInfo { name: string; title: string; version: string; gameVersion: string; dependencies: Dep[]; author: string; description: string; }
export interface ModPackage { info: ModInfo; files: Record<string, Uint8Array>; hash: string; errors: ModError[]; }
/** ошибка мода: «мод X, файл Y, запись N (тип «id»), поле Z: текст»; warn — предупреждение (мод загружается) */
export interface ModError { mod: string; file?: string; entry?: number; id?: string; field?: string; msg: string; warn?: boolean; }
/** мод в сохранении и в совместной игре */
export interface ModRef { name: string; version: string; hash: string; title?: string; }
export function errText(e: ModError): string {
  const p = [`мод «${e.mod}»`]; if (e.file) p.push(`файл ${e.file}`); if (e.entry != null) p.push(`запись ${e.entry + 1}${e.id ? ` («${e.id}»)` : ''}`); else if (e.id) p.push(`«${e.id}»`); if (e.field) p.push(`поле ${e.field}`);
  return p.join(', ') + ': ' + e.msg;
}
const dec = new TextDecoder();
export const text = (b: Uint8Array) => dec.decode(b).replace(/^\uFEFF/, '');
/** JSON с понятной ошибкой: строка и столбец */
export function parseJson(b: Uint8Array): { v?: any; err?: string } {
  const s = text(b);
  try { return { v: JSON.parse(s) }; } catch (e) {
    const m = /position (\d+)/.exec(String((e as Error).message)); let where = '';
    if (m) { const pos = +m[1]; const before = s.slice(0, pos); const line = before.split('\n').length, col = pos - before.lastIndexOf('\n'); where = ` (строка ${line}, столбец ${col})`; }
    return { err: 'ошибка JSON' + where + ': ' + String((e as Error).message).replace(/^JSON\.parse: /, '') };
  }
}
/** отпечаток содержимого: пути по порядку + байты, FNV-1a 2×32 бита */
export function modHash(files: Record<string, Uint8Array>): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193; const enc = new TextEncoder();
  for (const p of Object.keys(files).sort()) { for (const b of [enc.encode(p + '\0'), files[p]]) for (let i = 0; i < b.length; i++) { h1 = Math.imul(h1 ^ b[i], 16777619); h2 = Math.imul(h2 + b[i], 2654435761); } }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
function parseDep(d: any, mod: string, i: number, errs: ModError[]): Dep | null {
  const E = (msg: string) => { errs.push({ mod, file: 'info.json', field: `dependencies[${i}]`, msg }); return null; };
  if (typeof d === 'string') {
    const m = /^\s*(\?|\(\?\))?\s*([a-z0-9][a-z0-9_-]*)\s*(.*)$/.exec(d); if (!m) return E(`не разобрать «${d}» (пример: "base-tweaks >= 1.2", "? optional-mod")`);
    const r = m[3].trim(); if (satisfies('1.0.0', r) === null) return E(`неверный диапазон версий «${r}»`);
    return { name: m[2], range: r, optional: !!m[1] };
  }
  if (d && typeof d === 'object') {
    if (typeof d.name !== 'string' || !ID_RE.test(d.name)) return E('нужно поле name — имя мода');
    const r = d.version == null ? '' : String(d.version); if (satisfies('1.0.0', r) === null) return E(`неверный диапазон версий «${r}»`);
    return { name: d.name, range: r, optional: !!d.optional };
  }
  return E('ожидается строка "имя >= версия" или объект { name, version, optional }');
}
/** разобрать файлы мода (корень архива или одна вложенная папка) */
export function parsePackage(files0: Record<string, Uint8Array>, label = 'мод'): ModPackage {
  let files = files0; const keys = Object.keys(files0).filter(k => !k.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(k));
  if (!files0['info.json']) { const inner = keys.filter(k => /^[^/]+\/info\.json$/.test(k)); if (inner.length === 1) { const pre = inner[0].slice(0, -'info.json'.length); files = {}; for (const k of keys) if (k.startsWith(pre)) files[k.slice(pre.length)] = files0[k]; } }
  else { files = {}; for (const k of keys) files[k] = files0[k]; }
  const errs: ModError[] = [];
  const info: ModInfo = { name: label, title: label, version: '0.0.0', gameVersion: '', dependencies: [], author: '', description: '' };
  const ij = files['info.json'];
  if (!ij) errs.push({ mod: label, msg: 'нет файла info.json в корне мода' });
  else {
    const { v, err } = parseJson(ij);
    if (err) errs.push({ mod: label, file: 'info.json', msg: err });
    else if (!v || typeof v !== 'object' || Array.isArray(v)) errs.push({ mod: label, file: 'info.json', msg: 'ожидается объект { "name": …, "version": … }' });
    else {
      const E = (field: string, msg: string) => errs.push({ mod: typeof v.name === 'string' ? v.name : label, file: 'info.json', field, msg });
      if (typeof v.name !== 'string' || !ID_RE.test(v.name)) E('name', 'нужно имя из строчных латинских букв, цифр, «-» и «_» (например "double-ore")'); else info.name = v.name;
      if (typeof v.version !== 'string' || !isSemver(v.version)) E('version', `нужна версия вида 1.0.0, а не ${JSON.stringify(v.version)}`); else info.version = v.version;
      info.title = typeof v.title === 'string' && v.title.trim() ? v.title.slice(0, 80) : info.name;
      if (v.gameVersion != null) { if (typeof v.gameVersion !== 'string' || satisfies('1.0.0', v.gameVersion) === null) E('gameVersion', `неверный диапазон «${v.gameVersion}» (пример ">=1.10")`); else info.gameVersion = v.gameVersion; }
      if (v.dependencies != null) { if (!Array.isArray(v.dependencies)) E('dependencies', 'ожидается список'); else v.dependencies.forEach((d: any, i: number) => { const x = parseDep(d, info.name, i, errs); if (x) info.dependencies.push(x); }); }
      for (const f of ['author', 'description'] as const) if (v[f] != null) { if (typeof v[f] !== 'string') E(f, 'ожидается строка'); else info[f] = v[f].slice(0, f === 'author' ? 80 : 2000); }
      const KNOWN = new Set(['name', 'title', 'version', 'gameVersion', 'dependencies', 'author', 'description', 'homepage', 'license']);
      for (const k of Object.keys(v)) if (!KNOWN.has(k)) errs.push({ mod: info.name, file: 'info.json', field: k, msg: 'неизвестное поле — пропущено', warn: true });
    }
  }
  for (const e of errs) e.mod = info.name;
  return { info, files, hash: modHash(files), errors: errs };
}
/** порядок загрузки: зависимости раньше зависящих, иначе — по приоритету пользователя (перетаскивание), затем по имени.
 *  Возвращает включённые моды по порядку; моды с ошибками зависимостей — в failed. */
export function orderMods(pkgs: ModPackage[], prio: string[] = [], game = '1.11.0'): { order: ModPackage[]; failed: Map<string, ModError[]> } {
  const failed = new Map<string, ModError[]>(); const fail = (m: string, e: ModError) => { const a = failed.get(m) || []; a.push(e); failed.set(m, a); };
  const by = new Map<string, ModPackage>();
  for (const p of pkgs) {
    if (p.errors.some(e => !e.warn)) { fail(p.info.name, { mod: p.info.name, msg: 'мод не загружен: ошибки в info.json' }); continue; }
    if (by.has(p.info.name)) { fail(p.info.name, { mod: p.info.name, msg: 'включены две копии мода с одним именем' }); continue; }
    if (p.info.gameVersion && !satisfies(gameVer(game), p.info.gameVersion)) { fail(p.info.name, { mod: p.info.name, file: 'info.json', field: 'gameVersion', msg: `мод для версии игры ${p.info.gameVersion}, а у вас ${game}` }); continue; }
    by.set(p.info.name, p);
  }
  // зависимости: обязательные должны быть и подходить по версии (цепочкой — пока что-то меняется)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [n, p] of [...by]) for (const d of p.info.dependencies) {
      const q = by.get(d.name);
      const bad = !q ? (d.optional ? null : `нужен мод «${d.name}»${d.range ? ' ' + d.range : ''} — он не установлен или не включён`)
        : d.range && !satisfies(q.info.version, d.range) ? `нужен «${d.name}» ${d.range}, а включён ${q.info.version}` : null;
      if (bad) { fail(n, { mod: n, file: 'info.json', field: 'dependencies', msg: bad }); by.delete(n); changed = true; break; }
    }
  }
  const rank = (n: string) => { const i = prio.indexOf(n); return i < 0 ? 1e9 : i; };
  const cmp = (a: string, b: string) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  const order: ModPackage[] = []; const done = new Set<string>(); const left = new Set(by.keys());
  while (left.size) {
    const ready = [...left].filter(n => by.get(n)!.info.dependencies.every(d => !by.has(d.name) || done.has(d.name))).sort(cmp);
    if (!ready.length) { for (const n of left) fail(n, { mod: n, file: 'info.json', field: 'dependencies', msg: 'круговая зависимость: ' + [...left].join(' → ') }); break; }
    const n = ready[0]; order.push(by.get(n)!); done.add(n); left.delete(n);
  }
  return { order, failed };
}
export const newestFirst = (a: ModPackage, b: ModPackage) => cmpVer(parseVer(b.info.version)!, parseVer(a.info.version)!);

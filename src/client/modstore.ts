// v1.10: установленные моды — в IndexedDB (архив мода в base64 + список: включён ли, порядок). Установка из zip
// (один мод или пакет модов с modpack.json), удаление, порядок, экспорт текущего набора в «пакет модов».
import * as store from './store';
import { unzip, zip } from '../mods/zip';
import { parsePackage, ModPackage, ModRef } from '../mods/mod';
import { cmpVer, parseVer } from '../mods/semver';

export interface Installed { name: string; on: boolean; pkg: ModPackage; installed: number; file: string; }
interface Index { mods: { name: string; on: boolean; installed: number; file: string }[]; order: string[]; }
const IDX = 'mods:index';
const enc = new TextEncoder();
export function toB64(b: Uint8Array): string { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); }
export function fromB64(s: string): Uint8Array { const t = atob(s); const b = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; }

/** разобрать архив: один мод (info.json в корне или в единственной папке) или пакет (modpack.json / несколько папок с info.json) */
export async function readArchive(bytes: Uint8Array, fname: string): Promise<{ pkgs: ModPackage[]; pack: { order: string[]; on: Record<string, boolean> } | null }> {
  const files = await unzip(bytes);
  const label = fname.replace(/\.zip$/i, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'mod';
  const tops = [...new Set(Object.keys(files).filter(k => /^[^/]+\/info\.json$/.test(k)).map(k => k.split('/')[0]))];
  if (!files['modpack.json'] && (files['info.json'] || tops.length <= 1)) return { pkgs: [parsePackage(files, label)], pack: null };
  let pack: { order: string[]; on: Record<string, boolean> } | null = null;
  if (files['modpack.json']) try {
    const j = JSON.parse(new TextDecoder().decode(files['modpack.json']));
    pack = { order: Array.isArray(j.order) ? j.order.filter((x: any) => typeof x === 'string') : [], on: {} };
    for (const m of Array.isArray(j.mods) ? j.mods : []) if (m && typeof m.name === 'string') pack.on[m.name] = m.enabled !== false;
  } catch { pack = null; }
  const pkgs = tops.map(t => { const sub: Record<string, Uint8Array> = {}; for (const k of Object.keys(files)) if (k.startsWith(t + '/')) sub[k.slice(t.length + 1)] = files[k]; return parsePackage(sub, t); });
  return { pkgs, pack };
}

export class ModStore {
  list: Installed[] = []; ready = false;
  /** изменено после последнего применения (нужен перезапуск симуляции) */
  dirty = false;
  async init() {
    let idx: Index = { mods: [], order: [] };
    try { const s = await store.get(IDX); if (s) idx = JSON.parse(s); } catch { /* нет хранилища */ }
    this.list = [];
    for (const m of idx.mods) {
      try { const s = await store.get('mod:' + m.name); if (!s) continue; const files = await unzip(fromB64(s)); this.list.push({ ...m, pkg: parsePackage(files, m.name) }); } catch (e) { console.warn('мод ' + m.name + ' не прочитан', e); }
    }
    const rank = (n: string) => { const i = idx.order.indexOf(n); return i < 0 ? 1e9 : i; };
    this.list.sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : 1));
    this.ready = true;
  }
  private async saveIndex() { const idx: Index = { mods: this.list.map(m => ({ name: m.name, on: m.on, installed: m.installed, file: m.file })), order: this.list.map(m => m.name) }; await store.put(IDX, JSON.stringify(idx)); }
  get(name: string) { return this.list.find(m => m.name === name); }
  /** порядок для загрузки (перетаскивание) */
  order() { return this.list.map(m => m.name); }
  enabled(): ModPackage[] { return this.list.filter(m => m.on).map(m => m.pkg); }
  /** установить из архива; мод с тем же именем заменяется (новая версия), включается сразу */
  async install(bytes: Uint8Array, fname: string): Promise<{ added: Installed[]; replaced: string[] }> {
    const { pkgs, pack } = await readArchive(bytes, fname);
    if (!pkgs.length) throw new Error('в архиве нет модов (нужен info.json)');
    const added: Installed[] = [], replaced: string[] = [];
    for (const pkg of pkgs) {
      const name = pkg.info.name; const old = this.get(name);
      const m: Installed = { name, on: pack ? pack.on[name] !== false : true, pkg, installed: Date.now(), file: fname };
      await store.put('mod:' + name, toB64(await zip(pkg.files)));
      if (old) { replaced.push(`${name} ${old.pkg.info.version} → ${pkg.info.version}`); this.list[this.list.indexOf(old)] = m; } else this.list.push(m);
      added.push(m);
    }
    if (pack?.order.length) { const rank = (n: string) => { const i = pack.order.indexOf(n); return i < 0 ? 1e9 : i; }; this.list.sort((a, b) => rank(a.name) - rank(b.name)); }
    this.dirty = true; await this.saveIndex(); return { added, replaced };
  }
  async remove(name: string) { const m = this.get(name); if (!m) return; this.list.splice(this.list.indexOf(m), 1); await store.del('mod:' + name); if (m.on) this.dirty = true; await this.saveIndex(); }
  async setOn(name: string, on: boolean) { const m = this.get(name); if (!m || m.on === on) return; m.on = on; this.dirty = true; await this.saveIndex(); }
  async move(from: number, to: number) { if (from === to || !this.list[from]) return; const [m] = this.list.splice(from, 1); this.list.splice(Math.max(0, Math.min(this.list.length, to)), 0, m); if (m.on) this.dirty = true; await this.saveIndex(); }
  /** включить ровно моды сохранения (имя и отпечаток; если отпечаток другой — та же версия) — для «Включить нужные» */
  async enableExactly(need: ModRef[]): Promise<string[]> {
    const missing: string[] = [];
    for (const m of this.list) m.on = false;
    for (const r of need) { const m = this.get(r.name); if (m && (m.pkg.hash === r.hash || m.pkg.info.version === r.version)) m.on = true; else missing.push(r.title || r.name); }
    this.dirty = true; await this.saveIndex(); return missing;
  }
  /** «пакет модов»: zip с modpack.json (набор, порядок, версии, отпечатки) и папками модов — его можно установить целиком */
  async exportPack(game: string, onlyEnabled = true): Promise<Uint8Array> {
    const ms = this.list.filter(m => m.on || !onlyEnabled); const files: Record<string, Uint8Array> = {};
    files['modpack.json'] = enc.encode(JSON.stringify({ format: 1, game, created: new Date().toISOString(), order: ms.map(m => m.name), mods: ms.map(m => ({ name: m.name, title: m.pkg.info.title, version: m.pkg.info.version, hash: m.pkg.hash, enabled: m.on })) }, null, 1));
    for (const m of ms) for (const [p, b] of Object.entries(m.pkg.files)) files[m.name + '/' + p] = b;
    return zip(files);
  }
}
/** сверка модов сохранения с включёнными: чего не хватает (и установлено ли), что лишнее, что другой версии */
export interface ModDiff { need: { ref: ModRef; installed: 'same' | 'other' | 'none'; have?: string; on: boolean }[]; extra: ModRef[]; ok: boolean; }
export function modDiff(save: ModRef[], active: ModRef[], st: ModStore): ModDiff {
  const need: ModDiff['need'] = []; const extra: ModRef[] = [];
  for (const r of save) {
    if (active.some(a => a.name === r.name && a.hash === r.hash)) continue;
    const m = st.get(r.name);
    need.push({ ref: r, installed: !m ? 'none' : m.pkg.hash === r.hash ? 'same' : 'other', have: m?.pkg.info.version, on: !!m?.on });
  }
  for (const a of active) if (!save.some(r => r.name === a.name)) extra.push(a);
  return { need, extra, ok: !need.length && !extra.length };
}
export const newer = (a: string, b: string) => { const x = parseVer(a), y = parseVer(b); return x && y ? cmpVer(x, y) > 0 : false; };

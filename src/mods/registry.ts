// v1.10: реестр прототипов. Встроенные данные запоминаются при запуске; набор модов применяется к копии и записывается
// в общие таблицы (ITEMS, PROTOS, RECIPES, TECHS, RESOURCES, MAPGEN) на месте — остальной код ничего не знает о модах.
// Операции: add (новый), patch (слияние полей: объекты — вглубь, списки и числа — заменой; unset — убрать поля), remove
// (с каскадом: убранный предмет уносит рецепты с ним, рецепт — из открытий технологий и т. д., всё с предупреждением).
// Мод с ошибкой не применяется целиком (откат к состоянию до него), зависящие от него — тоже; игра не падает.
import { ITEMS, ITEM_LIST, ITEM_IDS, ITEM_IDX, FLUID_COLORS, ItemDef, GROUPS } from '../data/items';
import { PROTOS, Proto } from '../data/entities';
import { RECIPES, RECIPE_LIST, RECIPE_FOR, SMELT_BY_INPUT, RecipeDef } from '../data/recipes';
import { TECHS, TECH_LIST, TechDef } from '../data/techs';
import { RESOURCES, MAPGEN } from '../data/resources';
import { setModTranslations } from '../core/i18n';
import { ModPackage, ModError, ModRef, orderMods, parseJson, text } from './mod';
import { Shape, inferTable, check, show, ID_RE, COLOR_RE, pngSize } from './schema';

type Tables = { items: Record<string, ItemDef>; protos: Record<string, Proto>; recipes: Record<string, RecipeDef>; techs: Record<string, TechDef>; techOrder: string[]; recipeOrder: string[]; itemOrder: string[]; res: typeof RESOURCES; map: typeof MAPGEN; };
const VAN: Tables = structuredClone({ items: ITEMS, protos: PROTOS, recipes: RECIPES, techs: TECHS, techOrder: TECH_LIST.map(t => t.id), recipeOrder: [...RECIPE_LIST], itemOrder: [...ITEM_LIST], res: RESOURCES, map: MAPGEN });
const VAN_IDS = [...ITEM_IDS];
// ---------- схемы из встроенных данных ----------
const SCH = {
  item: { ...inferTable(Object.values(VAN.items)), sprite: { k: 'str' } as Shape },
  recipe: { ...inferTable(Object.values(VAN.recipes)), name: { k: 'str' } as Shape, prod: { k: 'bool' } as Shape },
  technology: { ...inferTable(Object.values(VAN.techs)) },
  entity: { ...inferTable(Object.values(VAN.protos)), sprite: { k: 'str' } as Shape, buildable: { k: 'bool' } as Shape },
  resource: inferTable(Object.values(VAN.res)),
  'map-settings': inferTable(Object.values(VAN.map)),
};
for (const k of ['order', 'fluid', 'virtual', 'meta'] as const) delete (SCH.item as any)[k]; // служебные — выставляет игра
for (const k of ['item', 'recipe', 'technology', 'entity'] as const) delete (SCH[k] as any).compat15; // совместимость назначает игра, мод не может её подменить
delete (SCH.resource as any).res;
type Kind = keyof typeof SCH;
const ALIAS: Record<string, Kind> = { item: 'item', fluid: 'item', recipe: 'recipe', technology: 'technology', tech: 'technology', entity: 'entity', building: 'entity', resource: 'resource', 'map-settings': 'map-settings', map: 'map-settings', 'map-gen': 'map-settings' };
/** типы построек, которые мод может добавлять (готовая логика); остальные — только patch */
export const MOD_ENTITY_TYPES = ['belt', 'inserter', 'chest', 'drill', 'furnace', 'assembler', 'lab', 'pole', 'solar', 'accumulator', 'lamp', 'wall', 'turret', 'beacon', 'radar', 'boiler', 'engine', 'tank', 'pipe'];
const REQ: Record<string, string[]> = {}; // обязательные поля постройки по типу: есть у всех встроенных построек этого типа
for (const t of new Set(Object.values(VAN.protos).map(p => p.type))) { const ps = Object.values(VAN.protos).filter(p => p.type === t); REQ[t] = Object.keys(ps[0]).filter(k => ps.every(p => k in p) && k !== 'name' && k !== 'color' && k !== 'id'); }
const ENUM = {
  group: new Set([...Object.values(VAN.items).map(i => i.group), ...GROUPS.map(g => g[0])]),
  icon: new Set(Object.values(VAN.items).map(i => i.icon)),
  cat: new Set(Object.values(VAN.recipes).map(r => r.cat)),
  bonus: new Set(['mining', 'damage', 'lab']),
  logi: new Set(['passive', 'active', 'storage', 'requester', 'buffer']),
};
const INT = { item: ['stack'], entity: ['w', 'h', 'slots', 'area', 'modules', 'hand', 'wire', 'reach'], technology: ['count'], recipe: [] as string[] };
// ---------- состояние ----------
let active: ModRef[] = []; let lastReport: ApplyReport | null = null;
export interface ApplyReport { loaded: ModRef[]; failed: { name: string; title: string; errors: ModError[] }[]; warnings: ModError[]; ms: number; ops: { add: number; patch: number; remove: number }; sprites: Record<string, { mod: string; path: string }>; changed: string[]; }
export const activeMods = (): ModRef[] => active.map(m => ({ ...m }));
export const lastApply = () => lastReport;
/** слушатели смены набора (отпечаток данных для кооператива, кэши иконок) */
const listeners: (() => void)[] = []; export const onModsChanged = (f: () => void) => listeners.push(f);

const clone = <T>(x: T): T => structuredClone(x);
const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
function merge(dst: any, src: any) { for (const k of Object.keys(src)) { if (isObj(src[k]) && isObj(dst[k])) merge(dst[k], src[k]); else dst[k] = clone(src[k]); } }
const tableOf = (T: Tables, k: Kind): Record<string, any> => k === 'item' ? T.items : k === 'recipe' ? T.recipes : k === 'technology' ? T.techs : k === 'entity' ? T.protos : k === 'resource' ? T.res : T.map;

/** применить включённые моды (порядок — orderMods). Пустой список — встроенные данные. */
export function applyMods(pkgs: ModPackage[], prio: string[] = [], game = '1.11.0'): ApplyReport {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rep: ApplyReport = { loaded: [], failed: [], warnings: [], ms: 0, ops: { add: 0, patch: 0, remove: 0 }, sprites: {}, changed: [] };
  const { order, failed } = orderMods(pkgs, prio, game);
  const titles = new Map(pkgs.map(p => [p.info.name, p.info.title]));
  for (const [n, errs] of failed) rep.failed.push({ name: n, title: titles.get(n) || n, errors: errs });
  for (const p of pkgs) for (const e of p.errors) if (e.warn) rep.warnings.push(e);
  let T: Tables = clone(VAN); const tr: Record<string, string> = {}; const gone = new Set(rep.failed.map(f => f.name)); const changed = new Set<string>();
  for (const p of order) {
    const name = p.info.name;
    const bad = p.info.dependencies.find(d => gone.has(d.name) && !d.optional);
    if (bad) { rep.failed.push({ name, title: p.info.title, errors: [{ mod: name, file: 'info.json', field: 'dependencies', msg: `зависит от «${bad.name}», который не загрузился` }] }); gone.add(name); continue; }
    const before = clone(T); const errs: ModError[] = []; const warns: ModError[] = []; const ops = { add: 0, patch: 0, remove: 0 }; const touched = new Set<string>(); const spr: ApplyReport['sprites'] = {};
    runMod(p, T, errs, warns, ops, touched, spr);
    if (!errs.length) crossCheck(T, name, errs, warns, touched);
    let loc: Record<string, string> = {};
    for (const f of Object.keys(p.files).filter(f => /^locale\/en\.json$/i.test(f))) { const { v, err } = parseJson(p.files[f]); if (err) errs.push({ mod: name, file: f, msg: err }); else if (!isObj(v)) errs.push({ mod: name, file: f, msg: 'ожидается объект { "русская строка": "English" }' }); else { for (const k of Object.keys(v)) if (typeof v[k] !== 'string') errs.push({ mod: name, file: f, field: k, msg: 'перевод должен быть строкой' }); loc = v; } }
    if (errs.length) { T = before; rep.failed.push({ name, title: p.info.title, errors: errs }); gone.add(name); continue; }
    Object.assign(tr, loc);
    // новые или изменённые названия без английского перевода — предупреждение (в EN покажется русское имя)
    for (const key of touched) { const [k, i] = key.split(':'); const d: any = tableOf(T, k as Kind)[i]; const v: any = (VAN as any)[kindKey(k as Kind)][i];
      for (const f of ['name', 'desc']) if (d && typeof d[f] === 'string' && /[А-Яа-яЁё]/.test(d[f]) && d[f] !== v?.[f] && !tr[d[f]]) warns.push({ mod: name, id: i, field: f, msg: `нет английского перевода для «${d[f]}» (файл locale/en.json)`, warn: true }); }
    rep.warnings.push(...warns); for (const k in ops) (rep.ops as any)[k] += (ops as any)[k]; Object.assign(rep.sprites, spr); for (const x of touched) changed.add(x);
    rep.loaded.push({ name, version: p.info.version, hash: p.hash, title: p.info.title });
  }
  write(T); setModTranslations(tr);
  active = rep.loaded; rep.changed = [...changed]; rep.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0; lastReport = rep;
  for (const f of listeners) f();
  return rep;
}
function runMod(p: ModPackage, T: Tables, errs: ModError[], warns: ModError[], ops: ApplyReport['ops'], touched: Set<string>, spr: ApplyReport['sprites']) {
  const name = p.info.name;
  const files = Object.keys(p.files).filter(f => /^prototypes\/.+\.json$/i.test(f)).sort();
  if (!files.length && !p.files['control.js'] && !Object.keys(p.files).some(f => /^locale\//.test(f))) warns.push({ mod: name, msg: 'в моде нет файлов prototypes/*.json', warn: true });
  for (const file of files) {
    const { v, err } = parseJson(p.files[file]); if (err) { errs.push({ mod: name, file, msg: err }); continue; }
    const list = Array.isArray(v) ? v : [v];
    list.forEach((op: any, entry: number) => {
      const E = (msg: string, field?: string) => errs.push({ mod: name, file, entry, id: op && typeof op.id === 'string' ? op.id : undefined, field, msg });
      const W = (msg: string, field?: string) => warns.push({ mod: name, file, entry, id: op?.id, field, msg, warn: true });
      if (!isObj(op)) return E('ожидается объект { "op": "add" | "patch" | "remove", "type": …, "id": … }');
      const kind = ALIAS[op.type]; if (!kind) return E(`неизвестный тип «${op.type}» (можно: item, fluid, recipe, technology, entity, resource, map-settings)`, 'type');
      if (!['add', 'patch', 'remove'].includes(op.op)) return E(`неизвестная операция «${op.op}» (add, patch, remove)`, 'op');
      const id = kind === 'map-settings' ? (op.id ?? 'default') : op.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) return E('нужен id из строчных латинских букв, цифр, «-» и «_»', 'id');
      const tab = tableOf(T, kind); const key = `${kind}:${id}`;
      if (op.op === 'remove') {
        if (kind === 'resource' || kind === 'map-settings') return E('ресурсы и настройки карты убирать нельзя — только patch', 'op');
        if (!tab[id]) { W(`«${id}» и так нет — пропущено`); return; }
        removeCascade(T, kind, id, m => W(m)); ops.remove++; touched.add(key); return;
      }
      let def: any;
      if (op.op === 'add') {
        if (kind === 'resource' || kind === 'map-settings') return E('новые ресурсы и наборы настроек карты добавлять нельзя (с v1.11) — используйте patch', 'op');
        if (tab[id]) return E(`«${id}» уже есть${(VAN as any)[kindKey(kind)][id] ? ' в игре' : ''} — для изменения используйте "op": "patch"`, 'id');
        const known = new Set(['op', 'type', 'id', 'from', 'data']);
        const fields = isObj(op.data) ? op.data : Object.fromEntries(Object.entries(op).filter(([k]) => !known.has(k)));
        if (op.from != null) { if (typeof op.from !== 'string' || !tab[op.from]) return E(`образец «${op.from}» не найден`, 'from'); def = clone(tab[op.from]); delete def.sprite; }
        else def = defaults(kind, id, op.type);
        const errs0: [string, string][] = []; check(fields, { k: 'obj', f: SCH[kind] }, '', errs0); for (const [f, m] of errs0) E(m, f); if (errs0.length) return;
        merge(def, fields); def.id = id;
        if (kind === 'item') { def.order = 10000 + T.itemOrder.length; def.fluid = def.group === 'fluid'; T.itemOrder.push(id); }
        if (kind === 'recipe') { if (typeof def.out === 'number') def.out = [[id, def.out]]; T.recipeOrder.push(id); }
        if (kind === 'technology') T.techOrder.push(id);
        ops.add++;
      } else {
        if (!tab[id]) return E(`«${id}» не найден — patch меняет только существующее (для нового — "op": "add")`, 'id');
        def = tab[id];
        if (op.set == null && op.unset == null) return E('нужно поле "set": { … } или "unset": [ … ]', 'set');
        if (op.set != null) {
          if (!isObj(op.set)) return E('ожидается объект { "поле": значение }', 'set');
          if ('id' in op.set || 'type' in op.set && kind === 'entity') return E('id и тип постройки менять нельзя', 'set');
          const errs0: [string, string][] = []; check(op.set, { k: 'obj', f: SCH[kind] }, '', errs0); for (const [f, m] of errs0) E(m, 'set.' + f); if (errs0.length) return;
          def = clone(def); merge(def, op.set);
        }
        if (op.unset != null) { if (!Array.isArray(op.unset) || op.unset.some((x: any) => typeof x !== 'string')) return E('ожидается список имён полей', 'unset'); def = clone(def); for (const f of op.unset) delete def[f]; }
        if (kind === 'item') def.fluid = def.group === 'fluid';
        if (kind === 'recipe' && typeof def.out === 'number') def.out = [[id, def.out]];
        ops.patch++;
      }
      const sem: [string, string][] = []; semantic(kind, def, sem, p, spr, name);
      for (const [f, m] of sem) E(m, f); if (sem.length) { if (op.op === 'add') { if (kind === 'item') T.itemOrder.pop(); if (kind === 'recipe') T.recipeOrder.pop(); if (kind === 'technology') T.techOrder.pop(); } return; }
      tab[id] = def; touched.add(key);
    });
  }
}
const kindKey = (k: Kind) => k === 'item' ? 'items' : k === 'recipe' ? 'recipes' : k === 'technology' ? 'techs' : k === 'entity' ? 'protos' : k === 'resource' ? 'res' : 'map';
function defaults(kind: Kind, id: string, type: string): any {
  switch (kind) {
    case 'item': return { id, name: id, stack: 50, color: '#8a8f96', icon: type === 'fluid' ? 'fluid' : 'plate', group: type === 'fluid' ? 'fluid' : 'inter' };
    case 'recipe': return { id, in: [], out: [[id, 1]], time: 1, cat: 'crafting', hand: true, enabled: true };
    case 'technology': return { id, name: id, desc: '', prereq: [], count: 50, time: 10, packs: [], unlocks: [] };
    case 'entity': return { id, name: id, solid: true, mineTime: 0.2, hp: 100, w: 1, h: 1, color: '#8a8f96' };
    default: return { id };
  }
}
function semantic(kind: Kind, d: any, out: [string, string][], p: ModPackage, spr: ApplyReport['sprites'], mod: string) {
  const num = (f: string, lo: number, hi: number, int = false) => { const v = d[f]; if (v == null) return; if (typeof v !== 'number' || !(v >= lo && v <= hi) || (int && !Number.isInteger(v))) out.push([f, `ожидается ${int ? 'целое ' : ''}число от ${lo} до ${hi}, а не ${show(v)}`]); };
  const sprite = (f: string) => {
    if (d[f] == null) return; const path = String(d[f]); const b = p.files[path]; if (!b) { out.push([f, `нет файла ${path} в моде`]); return; }
    const sz = pngSize(b); if (!sz) { out.push([f, `${path} — не PNG`]); return; } if (sz.w > 2048 || sz.h > 2048 || sz.w < 8 || sz.h < 8) { out.push([f, `${path}: размер ${sz.w}×${sz.h}, можно от 8 до 2048 пикселей`]); return; }
    spr[`${kind === 'entity' ? 'entity' : 'item'}:${d.id}`] = { mod, path };
  };
  if (typeof d.name === 'string' && !d.name.trim()) out.push(['name', 'пустое название']);
  if (d.color != null && !COLOR_RE.test(d.color)) out.push(['color', `ожидается цвет вида "#a1b2c3", а не ${show(d.color)}`]);
  switch (kind) {
    case 'item':
      num('stack', 1, 1e6, true); num('fuel', 0, 1e6);
      if (d.bioLining && (!['phys', 'fire', 'expl', 'speed', 'energy', 'laser'].includes(d.bioLining.kind) || d.equip?.kind !== 'lining' ||
        !Number.isFinite(d.bioLining.amount) || d.bioLining.amount <= 0 || d.bioLining.amount > (d.bioLining.kind === 'speed' ? .03 : d.bioLining.kind === 'energy' ? .04 : .06))) out.push(['bioLining', 'недопустимый эффект биоподкладки']);
      if (d.bioCoating) {
        const c = d.bioCoating, a = d.am;
        const maxByKind = { phys: .04, fire: .04, expl: .04, acid: .03, slow: .04, radius: .02, 'fire-duration': .04, accuracy: .04 } as Record<string, number>;
        const max = maxByKind[c.kind], known = Object.prototype.hasOwnProperty.call(maxByKind, c.kind);
        const compatible = !!a && (c.kind === 'phys' ? a.dt === 'phys' : c.kind === 'fire' ? a.dt === 'fire' : c.kind === 'expl' ? a.dt === 'expl' :
          c.kind === 'accuracy' ? a.cat === 'shotgun' : c.kind === 'radius' ? (a.aoe || 0) > 0 : c.kind === 'fire-duration' ? !!a.fire :
          c.kind === 'acid' || c.kind === 'slow' ? ['bullet', 'shotgun', 'rail', 'rocket', 'shell', 'artillery'].includes(a.cat) : false);
        if (!known || !a ||
          !Number.isFinite(c.amount) || c.amount <= 0 || c.amount > max || !compatible) out.push(['bioCoating', 'недопустимое биопокрытие боеприпаса']);
      }
      if (!ENUM.group.has(d.group)) out.push(['group', `неизвестная группа «${d.group}» (можно: ${[...ENUM.group].join(', ')})`]);
      if (!ENUM.icon.has(d.icon)) out.push(['icon', `неизвестный вид значка «${d.icon}» (можно: ${[...ENUM.icon].slice(0, 30).join(', ')}…) или поле sprite`]);
      sprite('sprite'); break;
    case 'recipe':
      num('time', 0.05, 3600);
      if (!ENUM.cat.has(d.cat)) out.push(['cat', `неизвестная категория «${d.cat}» (можно: ${[...ENUM.cat].join(', ')})`]);
      for (const f of ['in', 'out']) (d[f] || []).forEach((x: any, i: number) => { if (!(x[1] > 0) || x[1] > 1e6) out.push([`${f}[${i}]`, `количество должно быть больше 0, а не ${show(x[1])}`]); });
      if (!(d.out || []).length && !(d.cat === 'bioprocessing' && d.hand === false && d.prod === false && (d.in || []).length > 0)) out.push(['out', 'рецепт ничего не производит']); break;
    case 'technology':
      num('count', 1, 1e7, true); num('time', 0.1, 3600);
      if (d.infinite && !ENUM.bonus.has(d.infinite.bonus)) out.push(['infinite.bonus', `можно: ${[...ENUM.bonus].join(', ')}`]); break;
    case 'entity': {
      const isNew = !VAN.protos[d.id];
      if (isNew && !MOD_ENTITY_TYPES.includes(d.type)) { out.push(['type', `мод не может добавить постройку типа «${d.type}» (можно: ${MOD_ENTITY_TYPES.join(', ')}); свои типы логики — с v1.11`]); break; }
      if (d.bio != null && d.id !== 'bio-collection-station') out.push(['bio', 'биометаданные разрешены только встроенной станции биосбора']);
      if (d.id === 'bio-collection-station') {
        const b = d.bio;
        if (d.type !== 'bioport' || !b || typeof b !== 'object') out.push(['bio', 'встроенная станция биосбора должна сохранять bioport и профиль bio']);
        else {
          const bioNum = (field: string, lo: number, hi: number, integer = false) => {
            const v = b[field]; if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi || integer && !Number.isInteger(v))
              out.push([`bio.${field}`, 'числовое поле профиля станции выходит за допустимые границы']);
          };
          bioNum('range', 1, 24); bioNum('robots', 1, 4, true); bioNum('spots', 1, 4, true); bioNum('spotKW', 1, 120);
          if (!d.energy || d.energy.kind !== 'electric' || typeof d.energy.kW !== 'number' || d.energy.kW < 1 || d.energy.kW > 120)
            out.push(['energy.kW', 'станция биосбора должна использовать электрическую сеть с мощностью от 1 до 120 кВт']);
          else if (Number.isFinite(b.spots) && Number.isFinite(b.spotKW) && b.spots * b.spotKW > d.energy.kW)
            out.push(['bio.spotKW', 'сумма зарядных мест не может превышать мощность станции']);
        }
      }
      for (const f of REQ[d.type] || []) if (d[f] == null) out.push([f, `обязательное поле для постройки типа «${d.type}» (пример — "from": "${Object.values(VAN.protos).find(p => p.type === d.type)?.id}")`]);
      num('w', 1, 12, true); num('h', 1, 12, true); num('hp', 1, 1e6); num('mineTime', 0, 60); num('speed', 0.001, 1000); num('slots', 1, 400, true); num('modules', 0, 8, true);
      if (d.energy && !['burner', 'electric'].includes(d.energy.kind)) out.push(['energy.kind', 'можно: burner, electric']);
      if (d.energy && !(d.energy.kW > 0)) out.push(['energy.kW', 'мощность должна быть больше 0']);
      if (d.logi != null && !ENUM.logi.has(d.logi)) out.push(['logi', `можно: ${[...ENUM.logi].join(', ')}`]);
      for (const c of d.cats || []) if (!ENUM.cat.has(c)) out.push(['cats', `неизвестная категория рецептов «${c}»`]);
      sprite('sprite'); break;
    }
    case 'resource': num('richness', 0.01, 100); num('size', 0.1, 5); break;
    case 'map-settings': num('trees', 0, 5); num('rocks', 0, 20); num('richness', 0.01, 100); break;
  }
  for (const f of (INT as any)[kind] || []) if (d[f] != null && !Number.isInteger(d[f])) out.push([f, 'ожидается целое число']);
}
/** ссылки между прототипами после мода: предметы рецептов, пакеты и открытия технологий, постройка предмета, циклы технологий */
function crossCheck(T: Tables, mod: string, errs: ModError[], warns: ModError[], touched: Set<string>) {
  const E = (id: string, field: string, msg: string) => errs.push({ mod, id, field, msg });
  for (const key of touched) {
    const [k, id] = key.split(':'); const d: any = tableOf(T, k as Kind)[id]; if (!d) continue;
    if (k === 'recipe') for (const f of ['in', 'out']) d[f].forEach((x: any, i: number) => { if (!T.items[x[0]]) E(id, `${f}[${i}]`, `нет предмета «${x[0]}»`); });
    if (k === 'technology') {
      d.prereq.forEach((x: string, i: number) => { if (!T.techs[x]) E(id, `prereq[${i}]`, `нет технологии «${x}»`); });
      d.packs.forEach((x: string, i: number) => { if (!T.items[x]) E(id, `packs[${i}]`, `нет предмета «${x}»`); });
      d.unlocks.forEach((x: string, i: number) => { if (!T.recipes[x]) E(id, `unlocks[${i}]`, `нет рецепта «${x}»`); });
      if (!d.packs.length && !d.infinite) warns.push({ mod, id, field: 'packs', msg: 'технология без пакетов науки изучится мгновенно', warn: true });
    }
    if (k === 'item' && d.place != null && !T.protos[d.place]) E(id, 'place', `нет постройки «${d.place}»`);
    if (k === 'item' && d.bioCoating) {
      const source = T.items[d.bioCoating.source];
      if (!source?.am || source.id === id || source.bioCoating || source.id.startsWith('bio-coated-') || source.am.cat !== d.am?.cat) E(id, 'bioCoating.source', 'нужен исходный непокрытый боеприпас той же категории');
    }
    if (k === 'entity' && d.buildable !== false && !Object.values(T.items).some(i => i.place === id)) warns.push({ mod, id, msg: 'ни один предмет не ставит эту постройку (поле place у предмета)', warn: true });
    if (k === 'item' && !d.hidden && d.group !== 'fluid' && !Object.values(T.recipes).some(r => r.out.some(o => o[0] === id)) && !['raw'].includes(d.group)) warns.push({ mod, id, msg: 'нет рецепта, который делает этот предмет', warn: true });
    if (k === 'recipe' && !d.enabled && !Object.values(T.techs).some(t => t.unlocks.includes(id))) warns.push({ mod, id, msg: 'рецепт выключен и не открывается ни одной технологией', warn: true });
  }
  // циклы в дереве технологий
  const st = new Map<string, number>(); const cyc = (id: string, path: string[]): string[] | null => { const s = st.get(id); if (s === 2) return null; if (s === 1) return [...path, id]; st.set(id, 1); for (const p of T.techs[id]?.prereq || []) { const r = cyc(p, [...path, id]); if (r) return r; } st.set(id, 2); return null; };
  for (const id of Object.keys(T.techs)) { const c = cyc(id, []); if (c) { E(c[0], 'prereq', 'круговая зависимость технологий: ' + c.join(' → ')); break; } }
}
function removeCascade(T: Tables, kind: Kind, id: string, warn: (m: string) => void) {
  const del = (k: Kind, x: string, why: string) => { const tab = tableOf(T, k); if (!tab[x]) return; delete tab[x]; if (why) warn(`вместе с «${id}» убрано: ${k === 'recipe' ? 'рецепт' : k === 'item' ? 'предмет' : k === 'entity' ? 'постройка' : 'технология'} «${x}» (${why})`); cascade(k, x); };
  const cascade = (k: Kind, x: string) => {
    if (k === 'item') { for (const r of Object.values(T.recipes)) if (r.in.some(i => i[0] === x) || r.out.some(o => o[0] === x)) del('recipe', r.id, 'использует предмет'); for (const t of Object.values(T.techs)) t.packs = t.packs.filter(p => p !== x); T.itemOrder = T.itemOrder.filter(i => i !== x); }
    if (k === 'entity') for (const i of Object.values(T.items)) if (i.place === x) del('item', i.id, 'ставил постройку');
    if (k === 'recipe') { for (const t of Object.values(T.techs)) t.unlocks = t.unlocks.filter(u => u !== x); T.recipeOrder = T.recipeOrder.filter(r => r !== x); }
    if (k === 'technology') { for (const t of Object.values(T.techs)) t.prereq = t.prereq.filter(p => p !== x); T.techOrder = T.techOrder.filter(t => t !== x); }
  };
  delete tableOf(T, kind)[id]; cascade(kind, id);
}
/** записать таблицы в общие объекты и пересчитать производные списки */
function write(T: Tables) {
  const unchanged = (a: any, b: any) => {
    if (!a || !b) return false;
    const { compat15: _a, ...av } = a; const { compat15: _b, ...bv } = b;
    return JSON.stringify(av) === JSON.stringify(bv);
  };
  const stamp = (now: Record<string, any>, vanilla: Record<string, any>) => {
    for (const [id, d] of Object.entries(now)) if (!vanilla[id] || vanilla[id].compat15 === false || !unchanged(d, vanilla[id])) d.compat15 = false;
  };
  stamp(T.items, VAN.items); stamp(T.protos, VAN.protos); stamp(T.recipes, VAN.recipes); stamp(T.techs, VAN.techs);
  const put = (dst: Record<string, any>, src: Record<string, any>, order?: string[]) => { for (const k of Object.keys(dst)) delete dst[k]; for (const k of order || Object.keys(src)) if (src[k]) dst[k] = src[k]; };
  // предметы: встроенные по порядку (с сигналами), затем добавленные модами
  const itemKeys = [...VAN_IDS.filter(k => T.items[k]), ...Object.keys(T.items).filter(k => !VAN.items[k])];
  put(ITEMS, T.items, itemKeys);
  ITEM_LIST.length = 0; ITEM_LIST.push(...T.itemOrder.filter(k => T.items[k]));
  ITEM_IDS.length = 0; ITEM_IDS.push(...Object.keys(ITEMS)); for (const k of Object.keys(ITEM_IDX)) delete ITEM_IDX[k]; ITEM_IDS.forEach((k, i) => ITEM_IDX[k] = i);
  for (const k of Object.keys(FLUID_COLORS)) delete FLUID_COLORS[k]; for (const k of ITEM_LIST) if (ITEMS[k].group === 'fluid') FLUID_COLORS[k] = ITEMS[k].color;
  put(PROTOS, T.protos);
  put(RECIPES, T.recipes, T.recipeOrder);
  RECIPE_LIST.length = 0; RECIPE_LIST.push(...T.recipeOrder.filter(r => T.recipes[r]));
  for (const o of [RECIPE_FOR, SMELT_BY_INPUT]) for (const k of Object.keys(o)) delete o[k];
  for (const id of RECIPE_LIST) { const x = RECIPES[id]; if (x.cat === 'crafting' && x.hand && x.out.length && !RECIPE_FOR[x.out[0][0]]) RECIPE_FOR[x.out[0][0]] = x.id; if (x.cat === 'smelting') SMELT_BY_INPUT[x.in[0][0]] = x.id; }
  put(TECHS, T.techs, T.techOrder); TECH_LIST.length = 0; TECH_LIST.push(...T.techOrder.filter(t => T.techs[t]).map(t => T.techs[t]));
  put(RESOURCES, T.res); put(MAPGEN, T.map);
}
/** файлы спрайтов по ключу (entity:id / item:id) — для главного потока */
export function spriteFiles(pkgs: ModPackage[], rep: ApplyReport = lastReport!): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}; if (!rep) return out; const by = new Map(pkgs.map(p => [p.info.name, p]));
  for (const [k, s] of Object.entries(rep.sprites)) { const b = by.get(s.mod)?.files[s.path]; if (b) out[k] = b; }
  return out;
}
export { text };

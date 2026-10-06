// Архив сохранений старых версий (п. 5 плана 1.0): tests/saves/*.z7save + MANIFEST.json.
//
// Сборок v0.2–rc1 в репозитории нет, поэтому сохранения восстановлены по истории формата: настоящие партии
// (промежуточные сохранения бота и сценарии с Роем) приводятся к тому виду, который писала каждая версия.
// Что знаем о версиях (save.ts migrate, store.ts, README):
//   v0.1  формат v1: без врагов, загрязнения и прочности построек; localStorage
//   v0.2  формат v2: M0–M7 (нефть, Рой, оборона); нет M9 (модули, маяки, шахта…), призраков и чертежей; localStorage
//   v0.3  формат v3: + M8–M9 (призраки, пометки, модули, ракеты, бесконечные исследования); localStorage
//   v0.4  формат v3: настройки и IndexedDB (старые слоты переносятся из localStorage)
//   rc1   формат v3: Worker, EN; поле ui (хотбар, масштаб). До rc3 нет статистики партии (tele) и прогресса добычи рукой;
//         до rc4 — старый баланс (например, деталь ракеты по 10 каркасов, топлива и процессоров).
// Запуск: BOT_SAVES=/tmp/botsaves npm run bot  →  npx tsx tools/oldsaves.ts /tmp/botsaves
// Ledger каждого файла считается по самому старому JSON и записывается в MANIFEST — tests/compat.test.ts сверяет с ним загрузку.
import fs from 'fs';
import zlib from 'zlib';
import { Game, newPlayer } from '../src/sim/game';
import { serialize, deserialize } from '../src/sim/save';
import { ledger } from '../src/sim/compat';
import { placeNest } from '../src/sim/enemies';
import { TECH_LIST } from '../src/data/techs';
import { RECIPES } from '../src/data/recipes';
import { ITEMS } from '../src/data/items';

const pack = (o: any) => '0' + zlib.deflateSync(Buffer.from(JSON.stringify(o))).toString('base64');
const unpack = (s: string) => JSON.parse(zlib.inflateSync(Buffer.from(s.trim().slice(1), 'base64')).toString());
const clone = (o: any) => JSON.parse(JSON.stringify(o));
const run = (g: Game, n: number) => { for (let i = 0; i < n; i++) g.step(); };
const dir = process.argv[2] || '/data/botsaves';
const OUT = 'tests/saves';
const cks = fs.readdirSync(dir).filter(f => f.endsWith('.z7save')).sort();
if (!cks.length) { console.error('нет сохранений бота в ' + dir + ' — запустите BOT_SAVES=' + dir + ' npm run bot'); process.exit(1); }
const at = (h: number) => { const t = h * 216000; let best = cks[0]; for (const f of cks) if (Math.abs(+f.slice(3, 11) - t) < Math.abs(+best.slice(3, 11) - t)) best = f; return unpack(fs.readFileSync(dir + '/' + best, 'utf8')); };

// ---------- что появилось в M9 (v0.3): этого не было в сохранениях v0.2 ----------
const firstM9 = TECH_LIST.findIndex(t => t.id === 'electric-energy-distribution-1');
const M9_TECHS = new Set(TECH_LIST.slice(firstM9).map(t => t.id));
const M9_RECIPES = new Set<string>(['steel-chest', 'rocket-part', 'satellite']);
for (const t of TECH_LIST.slice(firstM9)) for (const u of t.unlocks) M9_RECIPES.add(u);
const M9_ITEMS = new Set<string>(); for (const r of M9_RECIPES) for (const [it] of RECIPES[r]?.out || []) M9_ITEMS.add(it);
for (const id in ITEMS) if (ITEMS[id].module) M9_ITEMS.add(id);
const M9_PROTOS = new Set<string>(); for (const it of M9_ITEMS) if (ITEMS[it]?.place) M9_PROTOS.add(ITEMS[it].place!);

/** v3 → как писали v0.3–rc2: без статистики партии, версии игры и прогресса добычи рукой */
function asRc1(s: any, ui = true): any {
  s = clone(s); delete s.tele; delete s.ver; delete s.player.mining;
  if (ui) s.ui = s.ui || { hotbar: ['transport-belt', 'inserter', 'electric-mining-drill', 'stone-furnace', 'assembling-machine-2', 'small-electric-pole', 'pipe', null, null, null], zoom: 0.8 };
  else delete s.ui;
  return s;
}
/** v3 → v2 (v0.2): без M8–M9 */
function asV02(s: any): any {
  s = asRc1(s, false); s.v = 2;
  delete s.ghosts; delete s.nextGhost; delete s.treeMarks; delete s.rockets; delete s.research.levels;
  const stk = (x: any) => x && !M9_ITEMS.has(x.item) ? x : null;
  s.inv = s.inv.map(stk);
  s.ents = s.ents.filter((o: any) => !M9_PROTOS.has(o.proto) && o.proto !== 'rocket-silo');
  for (const o of s.ents) {
    for (const k of ['modules', 'pbar', 'pend', 'lastIt', 'charge', 'parts', 'satellite', 'launchT', 'decon', 'upgrade']) delete o[k];
    if (o.inv) o.inv = o.inv.map(stk); if (o.fuel) o.fuel = stk(o.fuel); if (o.ammo) o.ammo = stk(o.ammo);
    if (o.lanes) for (const seg of o.lanes) for (let i = 0; i < seg.length; i++) seg[i] = seg[i].filter((it: any) => !M9_ITEMS.has(it.item));
    if (o.hand && M9_ITEMS.has(o.hand)) o.hand = null; if (o.outBuf && M9_ITEMS.has(o.outBuf)) o.outBuf = null;
    if (o.recipe && M9_RECIPES.has(o.recipe)) { o.recipe = null; o.input = {}; o.output = {}; o.crafting = false; o.progress = 0; }
    for (const k of ['input', 'output']) if (o[k]) for (const it of Object.keys(o[k])) if (M9_ITEMS.has(it)) delete o[k][it];
  }
  s.ground = s.ground.filter((x: any) => !M9_ITEMS.has(x.item));
  for (const c of s.corpses || []) c.slots = c.slots.map(stk);
  s.research.done = s.research.done.filter((t: string) => !M9_TECHS.has(t));
  if (s.research.current && M9_TECHS.has(s.research.current)) { s.research.current = null; s.research.progress = 0; }
  // в v0.2 «Обработка стали» ещё не открывала стальной сундук, а M9-рецептов не было вовсе
  s.enabled = s.enabled.filter((r: string) => !M9_RECIPES.has(r));
  s.queue = s.queue.filter((j: any) => !M9_RECIPES.has(j.recipe));
  return s;
}
/** v2 → v1 (v0.1): без врагов, загрязнения, прочности */
function asV01(s: any): any {
  s = asV02(s); s.v = 1;
  for (const k of ['settings', 'evolution', 'polProduced', 'nextUnit', 'units', 'groups', 'projectiles', 'corpses', 'alerts', 'pol']) delete s[k];
  s.player = { x: s.player.x, y: s.player.y }; // остальные поля инженера появились позже (migrate дополняет их из newPlayer)
  for (const o of s.ents) delete o.hp;
  s.ents = s.ents.filter((o: any) => o.t !== 'nest' && o.t !== 'turret' && o.t !== 'wall');
  return s;
}

/** Рой поверх партии бота: гнёзда за 260 клеток, загрязнение, атаки, гибель инженера (тело с инвентарём) */
function withSwarm(s0: any, minutes: number): any {
  const g = deserialize(s0); g.settings.enemies = 'normal';
  const R = 11; for (let cy = -R; cy <= R; cy++) for (let cx = -R; cx <= R; cx++) if (Math.max(Math.abs(cx), Math.abs(cy)) >= 9) g.world.getChunk(cx, cy);
  g.evolution = 0.25; run(g, minutes * 3600);
  // гнездо поближе к базе с запасом очков — чтобы в сохранении был рой «в пути»
  const P = g.player; let nest: any = null;
  for (let r = 70; r < 140 && !nest; r += 6) for (let a = 0; a < 16 && !nest; a++) nest = placeNest(g, Math.floor(P.x + r * Math.cos(a / 16 * 6.283)), Math.floor(P.y + r * Math.sin(a / 16 * 6.283)));
  if (nest) nest.points = 400;
  for (let i = 0; i < 40 && !g.units.some(u => u.st === 'attack'); i++) run(g, 600);
  g.inv.add('firearm-magazine', 30); g.hurtPlayer(1e6); run(g, 120);
  return serialize(g);
}
function withPlanners(s0: any): any {
  const g = deserialize(s0); const P = g.player; const x = Math.floor(P.x), y = Math.floor(P.y);
  let n = 0; for (let dy = -12; dy <= 12 && n < 6; dy += 3) for (let dx = 6; dx <= 30 && n < 6; dx += 3) if (g.placeGhost('wooden-chest', x + dx, y + dy, 0)) n++;
  const belts = [...g.ents.values()].filter(e => e.t === 'belt').slice(0, 8); for (const e of belts) { e.upgrade = 'fast-transport-belt'; g.marked.add(e.id); }
  const any = [...g.ents.values()].find(e => e.t === 'chest'); if (any) { any.decon = true; g.marked.add(any.id); }
  const a2 = [...g.ents.values()].find(e => e.proto === 'assembling-machine-2' && e.modules && !e.modules[0]); if (a2) a2.modules![0] = 'speed-module';
  g.research.levels['lab-speed'] = 1;
  return serialize(g);
}
/** rc1: старый баланс — буфер шахты под деталь «по 10», очередь ручного крафта посреди работы */
function rc1Quirks(s: any): any {
  s = clone(s);
  const silo = s.ents.find((o: any) => o.proto === 'rocket-silo');
  if (silo) { silo.input = { ...silo.input, 'low-density-structure': 20, 'rocket-fuel': 20, 'processing-unit': 20 }; }
  s.queue = [{ recipe: 'iron-gear-wheel', count: 4, started: true, left: 12 }, { recipe: 'electronic-circuit', count: 10, started: false, left: 0 }];
  return s;
}

const files: any[] = [];
function emit(name: string, label: string, version: string, storage: 'localStorage' | 'indexeddb', s: any, notes: string) {
  const str = pack(s); fs.writeFileSync(`${OUT}/${name}.z7save`, str);
  files.push({ file: `${name}.z7save`, label, version, fmt: s.v, storage, notes, kb: Math.round(str.length / 1024), ents: s.ents.length, ledger: ledger(s) });
  console.log(`${name}: v${s.v}, ${s.ents.length} построек, ${Math.round(str.length / 1024)} КБ — ${label}`);
}
fs.mkdirSync(OUT, { recursive: true });
// v1.7: архивы версий 1.x (партии бота: v1.12-*, v1.6-*, …) не пересоздаются — их файлы и записи описи сохраняются
const KEEP = (f: string) => /^v1\./.test(f);
const kept: any[] = fs.existsSync(`${OUT}/MANIFEST.json`) ? JSON.parse(fs.readFileSync(`${OUT}/MANIFEST.json`, 'utf8')).files.filter((m: any) => KEEP(m.file) && fs.existsSync(`${OUT}/${m.file}`)) : [];
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.z7save') && !KEEP(f)) fs.unlinkSync(`${OUT}/${f}`);

// v0.1 — начало партии
{ const g = new Game(7, true, { enemies: 'none' }); g.player.mining = null; run(g, 600); emit('v0.1-start', 'v0.1: начало партии, без врагов', 'v0.1', 'localStorage', asV01(serialize(g)), 'формат v1: миграция v1 → v2 → v3'); }
// v0.2 — нефть и Рой
const swarm = withSwarm(at(2.2), 20);
emit('v0.2-oil-swarm', 'v0.2: нефть, синяя наука, Рой атакует, тело инженера', 'v0.2', 'localStorage', asV02(swarm), 'формат v2; M9-контент убран; «Обработка стали» без стального сундука');
emit('v0.2-early', 'v0.2: первые печи и пар', 'v0.2', 'localStorage', asV02(at(0.6)), 'формат v2, ранняя партия');
// v0.3 — чертежи, призраки, модули
emit('v0.3-planners', 'v0.3: призраки, пометки сноса и улучшения, модули', 'v0.3', 'localStorage', asRc1(withPlanners(at(4)), false), 'формат v3 без статистики партии; хранилище — localStorage');
// v0.4 — IndexedDB
emit('v0.4-purple', 'v0.4: фиолетовая и жёлтая наука', 'v0.4', 'indexeddb', asRc1(at(6)), 'формат v3, IndexedDB');
// rc1 — поздняя игра со старым балансом и с Роем
const late = at(99);
emit('rc1-silo', 'rc1: ракетная шахта, буфер деталей по старому рецепту, очередь крафта', 'v1.0-rc1', 'indexeddb', asRc1(rc1Quirks(late)), 'формат v3; баланс до rc4');
emit('rc1-swarm', 'rc1: Рой, турели не построены, инженер погиб', 'v1.0-rc1', 'indexeddb', asRc1(swarm), 'формат v3 с врагами');
fs.writeFileSync(`${OUT}/MANIFEST.json`, JSON.stringify({ about: 'Архив сохранений v0.1–rc1 (восстановлен tools/oldsaves.ts) и версий 1.x (партии бота, tools/oldsaves.ts их сохраняет). Проверка: npx tsx tests/compat.test.ts, в браузерах — tests/e2e12.mjs', files: [...files, ...kept] }, null, 1));
void newPlayer;

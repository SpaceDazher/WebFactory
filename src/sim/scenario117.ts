import { BIO_V117_SOURCES } from '../data/biomaterials';
import { ITEMS, V117_SCENARIO_ITEMS } from '../data/items';
import { PROTOS, V117_SCENARIO_PROTOS } from '../data/entities';
import { RECIPES, V117_SCENARIO_RECIPES } from '../data/recipes';
import { TECHS, V117_SCENARIO_TECHS } from '../data/techs';
import { UNITS } from './enemies';
import type { Scenario } from './scenario';

export interface ScenarioCulture { species: string; labX: number; labY: number; bankX: number; bankY: number; cells: number; }
export interface ScenarioAlly { species: string; x: number; y: number; }
export interface ScenarioBiology { genomes: string[]; cultures: ScenarioCulture[]; allies: ScenarioAlly[]; enemies: ScenarioAlly[]; }
export const emptyScenarioBiology = (): ScenarioBiology => ({ genomes: [], cultures: [], allies: [], enemies: [] });
export const hasScenarioBiology = (b?: ScenarioBiology) => !!b && !!(b.genomes.length || b.cultures.length || b.allies.length || b.enemies.length);
/** A scenario referencing 1.17 definitions must not be offered to 1.16 as fmt 2. */
export function scenarioNeeds117(s: Scenario): boolean {
  const newId = (id: string) => V117_SCENARIO_ITEMS.has(id) || V117_SCENARIO_PROTOS.has(id) || V117_SCENARIO_RECIPES.has(id) || V117_SCENARIO_TECHS.has(id);
  const newType = (id: string) => id.startsWith('type:') && !Object.values(PROTOS).some(p => p.type === id.slice(5) && !V117_SCENARIO_PROTOS.has(p.id));
  return hasScenarioBiology(s.biology) || s.map.ents.some(e => newId(e.proto) || !!e.recipe && newId(e.recipe)) || s.map.nests.some(e => newId(e.proto)) || Object.keys(s.rules.startItems || {}).some(newId) || [...(s.rules.techs || []), ...s.rules.preTech].some(newId) || s.rules.ban.some(id => newId(id) || newType(id)) || s.goals.some(g => [g.item, g.proto, g.tech].some(id => !!id && (newId(id) || newType(id))));
}
const plain = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const keys = (v: unknown, names: string[]) => plain(v) && Object.keys(v).sort().join(',') === names.slice().sort().join(',');
const coord = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= -4096 && (v as number) <= 4096;
const source = (kind: unknown) => typeof kind === 'string' ? BIO_V117_SOURCES.find(s => s.kind === kind) : undefined;

/** Scenario imports are a data boundary, not a route to arbitrary world-state injection. */
export function readScenarioBiology(raw: unknown, s: Scenario, errors: string[]): ScenarioBiology | undefined {
  if (raw === undefined) return;
  const fail = () => { errors.push('Некорректные начальные биоданные сценария'); return undefined; };
  if (!keys(raw, ['genomes', 'cultures', 'allies', 'enemies'])) return fail();
  const b = raw as ScenarioBiology;
  if (!Array.isArray(b.genomes) || b.genomes.length > 15 || !Array.isArray(b.cultures) || b.cultures.length > 64 || !Array.isArray(b.allies) || b.allies.length > 24 || !Array.isArray(b.enemies) || b.enemies.length > 600) return fail();
  const out = emptyScenarioBiology(), genomes = new Set<string>(), lines = new Set<string>();
  const inside = (x: number, y: number) => !s.map.bounds || x >= -Math.floor(s.map.bounds.w / 2) && y >= -Math.floor(s.map.bounds.h / 2) && x < -Math.floor(s.map.bounds.w / 2) + s.map.bounds.w && y < -Math.floor(s.map.bounds.h / 2) + s.map.bounds.h;
  const banned = (id: string) => s.rules.ban.includes(id) || !!PROTOS[id] && s.rules.ban.includes('type:' + PROTOS[id].type);
  const allowedTech = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return true;
    seen.add(id);
    return !!TECHS[id] && (s.rules.techs === null || s.rules.techs.includes(id)) && TECHS[id].prereq.every(p => allowedTech(p, seen));
  };
  const allowedRecipe = (id: string) => !banned(id) && !!RECIPES[id] && (RECIPES[id].requiresTechs || []).every(t => allowedTech(t));
  for (const kind of b.genomes) {
    const src = source(kind);
    if (!src || genomes.has(kind) || !allowedTech('swarm-genomics') || banned('bio-genome-data-' + kind)) return fail();
    genomes.add(kind); out.genomes.push(kind);
  }
  for (const row of b.cultures) {
    if (!keys(row, ['species', 'labX', 'labY', 'bankX', 'bankY', 'cells'])) return fail();
    const src = source(row.species), line = `${row.bankX},${row.bankY}:${row.species}`;
    if (!src || ![row.labX, row.labY, row.bankX, row.bankY].every(coord) || !inside(row.labX, row.labY) || !inside(row.bankX, row.bankY) || !Number.isSafeInteger(row.cells) || row.cells < 1 || row.cells > 100 || lines.has(line) || !allowedTech('biohybrid-fabrication') || banned('genetic-lab') || banned('bio-culture-bank') || banned('bio-culture-capsule-' + row.species)) return fail();
    if (!s.map.ents.some(e => e.proto === 'genetic-lab' && e.x === row.labX && e.y === row.labY) || !s.map.ents.some(e => e.proto === 'bio-culture-bank' && e.x === row.bankX && e.y === row.bankY)) { errors.push('Для начальной культуры нужны лаборатория и банк в указанных клетках'); return; }
    lines.add(line); out.cultures.push({ species: src.kind, labX: row.labX, labY: row.labY, bankX: row.bankX, bankY: row.bankY, cells: row.cells });
  }
  let weight = 0, queens = 0;
  for (const row of b.allies) {
    if (!keys(row, ['species', 'x', 'y'])) return fail();
    const src = source(row.species);
    if (!src || !coord(row.x) || !coord(row.y) || !inside(row.x, row.y) || !allowedTech('biohybrid-fabrication') || !allowedRecipe('bioform-' + src.form) || !ITEMS['bioform-' + src.form]) return fail();
    weight += src.w; if (src.kind === 'queen') queens++;
    if (weight > 24 || queens > 1) { errors.push('Начальная биоармия превышает 24 W или лимит одной Королевы'); return; }
    out.allies.push({ species: src.kind, x: row.x, y: row.y });
  }
  let enemyQueens = 0;
  for (const row of b.enemies) {
    if (!keys(row, ['species', 'x', 'y']) || !source(row.species) || !UNITS[row.species] || !coord(row.x) || !coord(row.y) || !inside(row.x, row.y) || s.rules.enemies === 'none') return fail();
    if (row.species === 'queen' && ++enemyQueens > 1) return fail();
    out.enemies.push({ species: row.species, x: row.x, y: row.y });
  }
  return hasScenarioBiology(out) ? out : undefined;
}

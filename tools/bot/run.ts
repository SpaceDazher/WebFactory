// Бот-тест (rc3): npm run bot [-- --seed 1 --verbose --checkpoint 30 --until <этап> --mods mods/double-ore,mods/new-recipe]
import fs from 'fs';
import { Run } from './script';
import { BotError, Bot } from './core';
import { serialize } from '../../src/sim/save';
import { teleReport } from '../../src/sim/telemetry';
import { dataHash } from '../datahash';
import { useMods } from '../modfs';
import { errText } from '../../src/mods/mod';
import { resolveBotSavesDir } from './saves-path';
const arg = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
if (arg('enemies')) process.env.BOT_ENEMIES = arg('enemies');
if (arg('scn')) process.env.BOT_SCN = arg('scn'); // v1.15: сценарий (id испытания или файл .z7scn)
if (arg('raids')) process.env.BOT_RAIDS = arg('raids'); // раз в N игровых минут гнёзда рядом с базой получают загрязнение и шлют волну
process.env.BOT_SAVES = resolveBotSavesDir({ env: process.env.BOT_SAVES });
fs.mkdirSync(process.env.BOT_SAVES, { recursive: true });
const seed = +(arg('seed', '1')!); const verbose = process.argv.includes('--verbose');
// v1.10: моды (папки или zip через запятую) — до создания партии
const modArg = arg('mods'); let modInfo: any = null;
if (modArg) {
  const { report: r } = await useMods(modArg.split(',').filter(Boolean));
  if (r.failed.length) { console.log('моды не загрузились:', r.failed.flatMap(f => f.errors.map(errText)).join('\n')); process.exit(1); }
  modInfo = { loaded: r.loaded.map(m => `${m.name}@${m.version}`), ops: r.ops, ms: Math.round(r.ms * 10) / 10 }; console.log(`моды: ${modInfo.loaded.join(', ')} (за ${modInfo.ms} мс)`);
}
const bot = new Run(seed, { checkpointMin: +(arg('checkpoint', '30')!), verbose });
const t0 = Date.now(); let err: any = null;
try { bot.run(bot.main()); } catch (e: any) { err = e; }
const g = bot.g; const ms = Date.now() - t0;
const hm = (t: number) => { const m = Math.floor(t / 3600); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
fs.mkdirSync('shots', { recursive: true });
fs.writeFileSync('shots/bot-final.z7save', Bot.pack(serialize(g)));
const rep: any = { seed, mods: modInfo, dataHash: dataHash(), ok: !err && g.rockets > 0, error: err ? String(err.message || err) : null, errorCtx: err?.ctx ?? null, gameTime: hm(g.tick), ticks: g.tick, realSec: Math.round(ms / 1000),
  speedup: Math.round(g.tick / 60 / (ms / 1000)), entities: g.ents.size, walkedTiles: Math.round(bot.walked), blueprintsPasted: bot.pasted, blueprintKinds: bot.blueprints.length,
  scenario: g.scn ? { id: g.scn.id, state: g.scnSt, limitMin: g.scn.rules.timeLimit } : null, pollution: Math.round((g.stats as any).pol || 0), ach: Object.keys(g.ach),
  enemies: g.settings.enemies, evolution: Math.round(g.evolution * 1000) / 1000, swarm: g.settings.enemies === 'none' ? null : { attacks: g.sw.total, kills: g.sw.kills, killedBy: g.sw.by, lost: g.sw.lost, nests: Object.keys(g.ents).length && [...g.ents.values()].filter(e => e.t === 'nest').length, raids: bot.raids }, defense: g.settings.enemies === 'none' ? null : bot.def, rounds: bot.rounds, cells: bot.cells.length, checkpoints: bot.checkpoints, milestones: bot.milestones.map(m => ({ t: hm(m.t), what: m.what })), tele: teleReport(g), log: bot.logs };
fs.writeFileSync('shots/bot-report.json', JSON.stringify(rep, null, 1));
console.log(`\n${rep.ok ? '✔ РАКЕТА ЗАПУЩЕНА' : '✘ НЕ ДОШЁЛ'}: игровое время ${rep.gameTime}, реальное ${rep.realSec} с (×${rep.speedup}), построек ${rep.entities}, чертежей вставлено ${rep.pasted ?? bot.pasted}`);
if (g.scn) console.log(`Сценарий «${g.scn.name}»: ${g.scnSt?.res ? (g.scnSt.res.ok ? 'ПРОЙДЕН за ' : 'не пройден, ') + hm(g.scnSt.res.tick - g.scnSt.t0) : 'итога нет'}; загрязнение ${Math.round((g.stats as any).pol || 0)}; достижения: ${Object.keys(g.ach).join(', ') || '—'}`);
if (g.settings.enemies !== 'none') console.log(`Рой (${g.settings.enemies}): эволюция ${rep.evolution}, атак ${g.sw.total}${bot.raids ? ` (из них набегов ${bot.raids})` : ''}, убито юнитов ${Object.values(g.sw.kills).reduce((a: number, b: any) => a + b, 0)}, потеряно построек ${Object.values(g.sw.lost).reduce((a: number, b: any) => a + b, 0)}; оборона: постов ${bot.def.posts}, пулемётных ${bot.def.guns}, лазерных ${bot.def.lasers}, радаров ${bot.def.radars}, патронов заложено ${bot.def.ammo}, смертей инженера ${bot.def.deaths}`);
console.log(`сохранений/загрузок: ${bot.checkpoints.length}, все совпали: ${bot.checkpoints.every(c => c.ok && c.lockstep !== false)}`);
for (const m of rep.milestones) console.log(`  ${m.t.padStart(6)}  ${m.what}`);
if (err && verbose) { // карта вокруг бота
  const px = Math.floor(g.player.x), py = Math.floor(g.player.y); const L: string[] = [];
  for (let y = py - 18; y <= py + 18; y++) { let l = ''; for (let x = px - 30; x <= px + 30; x++) { const e = g.entAt(x, y); l += x === px && y === py ? '@' : e ? ({ pipe: '=', pole: '|', chest: 'c', inserter: 'i', assembler: 'A', furnace: 'F', drill: 'D', lab: 'L', boiler: 'B', engine: 'E' } as any)[e.t] || '#' : g.world.terrain(x, y) >= 3 ? '~' : g.world.decor(x, y) ? 't' : '.'; } L.push(l); }
  console.log(L.join('\n')); }
if (err) { console.log('ОШИБКА:', rep.error); if (err.ctx) console.log(JSON.stringify(err.ctx).slice(0, 1500)); if (!(err instanceof BotError) || verbose) console.log(err.stack); }
process.exit(rep.ok ? 0 : 1);

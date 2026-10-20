// Синтетические сохранения 1.11 (формат 15) и 1.13 (формат 16). Кода этих версий в репозитории нет, настоящие файлы получить нельзя,
// поэтому берём настоящие партии бота 1.10 и приводим их к полям формата нужной версии:
//   1.11: v14 → v15 — к партии 1.10 добавляется хранилище скриптов модов (то же, что делает 1.11 при первом сохранении);
//   1.13: партия 1.10 проходит через совместную игру двух игроков (код 1.14 в харнесе, тот же формат peers/роли), затем поля формата 17
//         (снаряды, огонь, лужи, статистика Роя, мутации) убираются, формат ставится 16.
// Файлы помечены в MANIFEST.json как «синтетические». Запуск: npx tsx tools/archive-synth.ts
import fs from 'fs';
import zlib from 'zlib';
import { ledger } from '../src/sim/compat';
import { deserialize, serialize } from '../src/sim/save';
import { Coop } from '../tests/mpharness';
import { players } from '../tests/mpplayers';

const pack = (o: any) => '0' + zlib.deflateSync(Buffer.from(JSON.stringify(o))).toString('base64');
const unpack = (s: string) => JSON.parse(zlib.inflateSync(Buffer.from(s.trim().slice(1), 'base64')).toString());
const OUT = 'tests/saves'; const man = JSON.parse(fs.readFileSync(`${OUT}/MANIFEST.json`, 'utf8'));
const LABEL: Record<string, string> = { early: 'ранняя игра: пар, первые исследования', mid: 'средняя игра: нефть, синяя наука', late: 'поздняя игра: ракетная шахта близко' };
const put = (name: string, ver: string, s: any, notes: string) => {
  const str = pack(s); fs.writeFileSync(`${OUT}/${name}.z7save`, str);
  const e = { file: `${name}.z7save`, label: `${name.split('-')[0]}: ${LABEL[name.split('-')[1]]}`, version: ver, fmt: s.v, storage: 'indexeddb', notes, kb: Math.round(str.length / 1024), ents: s.ents.length, ledger: ledger(s) };
  man.files = man.files.filter((f: any) => f.file !== e.file); man.files.push(e); console.log(`${name}: формат v${s.v}, ${s.ents.length} построек, ${e.kb} КБ, тик ${s.tick}`);
};
(async () => {
  for (const k of ['early', 'mid', 'late']) {
    const src = unpack(fs.readFileSync(`${OUT}/v1.10-${k}.z7save`, 'utf8'));
    // 1.11
    const a = JSON.parse(JSON.stringify(src)); a.v = 15; a.ver = '1.11.0'; a.scripts = { store: {}, inflight: {} };
    put(`v1.11-${k}`, '1.11.0', a, `СИНТЕТИЧЕСКОЕ: настоящая партия бота 1.10 (${k}) с полями формата 15 (скрипты модов); кода 1.11 в репозитории нет`);
    // 1.13: совместная игра двух игроков на мире 1.10
    const g = deserialize(JSON.parse(JSON.stringify(src)));
    const c = new Coop({ n: 2, pingMs: 60, loss: 0, seed: 5, game: g, map: 'current', kbps: 20000, names: ['Хост', 'Анна'] });
    await c.start(); const act = players(9, 4); c.advance(3000, act);
    const s = JSON.parse(JSON.stringify(serialize(c.peers[0].g)));
    for (const f of ['shots', 'fires', 'acids', 'sw', 'mut', 'mutT']) delete s[f];
    if (s.player) delete s.player.kit;
    s.v = 16; s.ver = '1.13.0';
    put(`v1.13-${k}`, '1.13.0', s, `СИНТЕТИЧЕСКОЕ: партия бота 1.10 (${k}), прошедшая совместную игру двух игроков, с полями формата 16 (роли, права, библиотека партии); кода 1.13 в репозитории нет`);
  }
  fs.writeFileSync(`${OUT}/MANIFEST.json`, JSON.stringify(man, null, 1));
  process.exit(0);
})();

// Пополнение архива сохранений (общие требования 2.2): три настоящих сохранения текущей версии — ранняя, средняя
// и поздняя игра из чекпойнтов бота. Остальные файлы архива не трогаются.
//   BOT_SAVES=/tmp/bs npm run bot  →  npx tsx tools/archive-version.ts /tmp/bs 1.0.0
// Чекпойнты бота пишет Node без __VERSION__ (ver = 'dev'), поэтому версия ставится явно — так файл пишет игра.
import fs from 'fs';
import zlib from 'zlib';
import { ledger } from '../src/sim/compat';

const [dir, ver] = process.argv.slice(2);
if (!dir || !ver) { console.error('npx tsx tools/archive-version.ts <папка чекпойнтов> <версия, например 1.0.0>'); process.exit(2); }
const pack = (o: any) => '0' + zlib.deflateSync(Buffer.from(JSON.stringify(o))).toString('base64');
const unpack = (s: string) => JSON.parse(zlib.inflateSync(Buffer.from(s.trim().slice(1), 'base64')).toString());
const cks = fs.readdirSync(dir).filter((f: string) => f.endsWith('.z7save')).sort();
const at = (h: number) => { const t = h * 216000; let best = cks[0]; for (const f of cks) if (Math.abs(+f.slice(3, 11) - t) < Math.abs(+best.slice(3, 11) - t)) best = f; return unpack(fs.readFileSync(dir + '/' + best, 'utf8')); };
const OUT = 'tests/saves', man = JSON.parse(fs.readFileSync(`${OUT}/MANIFEST.json`, 'utf8'));
const short = 'v' + ver.split('.').slice(0, 2).join('.');
const pick: [string, string, number][] = [['early', 'ранняя игра: пар, первые исследования', 1], ['mid', 'средняя игра: нефть, синяя наука', 3], ['late', 'поздняя игра: фиолетовая и жёлтая наука, ракетная шахта', 99]];
for (const [k, label, h] of pick) {
  const s = at(h); s.ver = ver;
  const name = `${short}-${k}`, str = pack(s);
  fs.writeFileSync(`${OUT}/${name}.z7save`, str);
  const e = { file: `${name}.z7save`, label: `${short}: ${label}`, version: ver, fmt: s.v, storage: 'indexeddb', notes: `настоящее сохранение ${ver} (чекпойнт бота, тик ${s.tick})`, kb: Math.round(str.length / 1024), ents: s.ents.length, ledger: ledger(s) };
  man.files = man.files.filter((f: any) => f.file !== e.file); man.files.push(e);
  console.log(`${name}: формат v${s.v}, ${s.ents.length} построек, ${e.kb} КБ, тик ${s.tick}`);
}
man.about = 'Архив сохранений v0.1–rc1 (восстановлен tools/oldsaves.ts) и настоящие сохранения 1.0+ (tools/archive-version.ts). Проверка: npx tsx tests/compat.test.ts, в браузерах — tests/e2e12.mjs';
fs.writeFileSync(`${OUT}/MANIFEST.json`, JSON.stringify(man, null, 1));

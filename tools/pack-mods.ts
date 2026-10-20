// v1.10: собрать примеры модов в zip: mods/<имя>/ → mods/dist/<имя>.zip (и пакет всех трёх — mods/dist/examples-modpack.zip).
// Запуск: npx tsx tools/pack-mods.ts [папка вывода]
import fs from 'fs';
import path from 'path';
import { readDir, nodeDeflate } from './modfs';
import { zip } from '../src/mods/zip';
import { parsePackage } from '../src/mods/mod';
const out = process.argv[2] || 'mods/dist'; fs.mkdirSync(out, { recursive: true });
const dirs = fs.readdirSync('mods').filter(d => fs.existsSync(path.join('mods', d, 'info.json'))).sort();
const pack: Record<string, Uint8Array> = {}; const list: any[] = [];
for (const d of dirs) {
  const files = readDir(path.join('mods', d)); const p = parsePackage(files, d);
  if (p.errors.some(e => !e.warn)) { console.error('ошибка в моде', d, p.errors); process.exit(1); }
  fs.writeFileSync(path.join(out, d + '.zip'), await zip(files, nodeDeflate));
  for (const [k, b] of Object.entries(files)) pack[d + '/' + k] = b;
  list.push({ name: p.info.name, title: p.info.title, version: p.info.version, hash: p.hash, enabled: true });
  console.log(`${d}.zip — ${p.info.title} ${p.info.version}, файлов ${Object.keys(files).length}, отпечаток ${p.hash}`);
}
pack['modpack.json'] = new TextEncoder().encode(JSON.stringify({ format: 1, game: '1.11.0', order: list.map(m => m.name), mods: list }, null, 1));
fs.writeFileSync(path.join(out, 'examples-modpack.zip'), await zip(pack, nodeDeflate));
console.log('examples-modpack.zip — все примеры одним пакетом');

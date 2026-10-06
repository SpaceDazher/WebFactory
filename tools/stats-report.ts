// Сводка плейтестов v1.1: npx tsx tools/stats-report.ts <папки и файлы> [--out report.md] [--json report.json] [--min-finished 10] [--check]
// Берёт файлы статистики партии (*.json, «Помочь игре» → «Сохранить статистику»), замеры производительности
// (zavod7-gpubench-*.json, «Помочь игре» → «Замер производительности») и отчёты об ошибках (F8, *.txt).
// Один игрок (installId + seed) учитывается один раз — по самому позднему файлу.
import fs from 'fs';
import path from 'path';
import { load, summarize, markdown } from './statslib';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const flags = new Set(['--check']); const withVal = new Set(['--out', '--json', '--min-finished']);
const paths: string[] = []; for (let i = 0; i < args.length; i++) { if (withVal.has(args[i])) { i++; continue; } if (!flags.has(args[i])) paths.push(args[i]); }
if (!paths.length) { console.error('укажите папку с файлами: npx tsx tools/stats-report.ts playtests/'); process.exit(2); }
const files: { name: string; text: string }[] = [];
const walk = (p: string) => { const st = fs.statSync(p); if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f)); } else if (/\.(json|txt)$/i.test(p)) files.push({ name: p, text: fs.readFileSync(p, 'utf8') }); };
for (const p of paths) walk(p);
const inp = load(files);
const s = summarize(inp, { minFinished: +(opt('min-finished') || 10) });
const md = markdown(s);
if (opt('out')) fs.writeFileSync(opt('out')!, md); else process.stdout.write(md);
if (opt('json')) fs.writeFileSync(opt('json')!, JSON.stringify(s, null, 1));
if (inp.skipped.length) console.error('пропущено: ' + inp.skipped.join('; '));
console.error(`файлов ${files.length}: игроков ${s.players}, замеров ${s.benches.length}, отчётов F8 ${s.bugReports}`);
if (args.includes('--check') && s.verdict.some(v => v.ok === false)) process.exit(1);

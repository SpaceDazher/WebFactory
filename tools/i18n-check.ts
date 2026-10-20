// Проверка переводов: все русские строковые литералы в исходниках интерфейса и данных → непереведённые фрагменты в EN.
// Запуск: npx tsx tools/i18n-check.ts [файлы…]  (без аргументов — интерфейс, симуляция, данные). Код выхода 1 — есть пробелы.
import fs from 'fs';
import { setLang, untranslated } from '../src/core/i18n';
import { ITEMS } from '../src/data/items';
import { TECHS } from '../src/data/techs';
import { PROTOS } from '../src/data/entities';
import { NEWS } from '../src/data/news';
import { TIPS } from '../src/ui/tips';
const FULL = process.argv.includes('--full'); const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const FILES = ARGS.length ? ARGS : ['src/ui/ui.ts', 'src/sim/nucguide.ts', 'src/ui/genform.ts', 'src/sim/scenario.ts', 'src/ui/editor.ts', 'src/main.ts', 'src/sim/game.ts', 'src/sim/robots.ts', 'src/sim/circuit.ts', 'src/render/renderer.ts', 'src/client/settings.ts', 'src/ui/mpui.ts', 'src/client/mp.ts', 'src/net/session.ts', 'src/net/rtc.ts', 'src/sim/trains.ts', 'src/render/rails.ts', 'src/ui/produi.ts', 'src/sim/calc.ts', 'src/sim/prodstats.ts', 'src/sim/notes.ts', 'src/sim/perf.ts', 'src/ui/modsui.ts', 'src/mods/mod.ts', 'src/mods/registry.ts', 'src/mods/zip.ts', 'src/client/modstore.ts', 'src/mods/schema.ts', 'src/sim/compat.ts', 'src/ui/modrt.ts', 'src/sim/perfworld.ts', 'src/sim/scripting.ts', 'src/mods/script.ts', 'src/mods/sandbox.ts', 'src/ui/techgraph.ts', 'src/client/perfbench.ts', 'src/ui/morph.ts', 'src/client/input.ts', 'src/sim/combat.ts', 'src/sim/enemies.ts', 'src/ui/gearui.ts', 'src/ui/scnui.ts', 'src/ui/editor.ts', 'src/sim/scenario.ts', 'src/data/challenges.ts', 'src/sim/achieve.ts', 'src/client/scnstore.ts', 'src/sim/heat.ts', 'src/sim/networks.ts', 'src/ui/xui.ts', 'src/sim/mgmt.ts', 'src/sim/x116.ts', 'src/data/statusText.ts', 'src/sim/radar.ts'];
/** русские фрагменты строк: литералы '…', "…", `…` (подстановки ${…} с учётом вложенности вырезаются), HTML-теги — разделители */
export function literals(src: string): string[] {
  const out: string[] = []; let i = 0;
  const push = (t: string) => { for (const a of t.matchAll(/(?:placeholder|title|aria-label)="([^"\u0001]*)/g)) if (/[А-Яа-яЁё]/.test(a[1])) out.push(a[1]); for (const p of t.split(/<[^>]*>|"|\u0001/)) if (/[А-Яа-яЁё]/.test(p)) out.push(p); }; // v1.11: и атрибуты-подсказки
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (ch === "'" || ch === '"') { let j = i + 1, t = ''; while (j < src.length && src[j] !== ch && src[j] !== '\n') { if (src[j] === '\\') { t += src[j + 1]; j += 2; continue; } t += src[j++]; } push(t); i = j + 1; continue; }
    if (ch === '`') {
      // шаблон: текст до ${, затем пропуск выражения с учётом вложенных строк и скобок — выражение разбирается рекурсивно
      let j = i + 1, t = '';
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { t += src[j + 1]; j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { let d = 1, k = j + 2; const s0 = k;
          while (k < src.length && d > 0) { const c = src[k]; if (c === '{') d++; else if (c === '}') d--; else if (c === '`') { k++; while (k < src.length && src[k] !== '`') { if (src[k] === '\\') k++; else if (src[k] === '$' && src[k + 1] === '{') { let d2 = 1; k += 2; while (k < src.length && d2 > 0) { if (src[k] === '{') d2++; else if (src[k] === '}') d2--; k++; } continue; } k++; } } else if (c === "'" || c === '"') { const q = c; k++; while (k < src.length && src[k] !== q) { if (src[k] === '\\') k++; k++; } } k++; }
          out.push(...literals(src.slice(s0, k - 1))); t += '\u0001'; j = k; continue; }
        t += src[j++];
      }
      push(t); i = j + 1; continue;
    }
    i++;
  }
  return out;
}
const strs: string[] = [];
if (!ARGS.length) FILES.push(
  'src/sim/v117Systems.ts', 'src/sim/v117.ts', 'src/sim/bioguide.ts', 'src/sim/bio.ts',
  'src/sim/bioRobots.ts', 'src/sim/scenario117.ts', 'src/sim/polechain.ts',
  'src/ui/nativeui.ts', 'src/ui/bioroute.ts', 'src/ui/fluidports.ts',
  'src/ui/drone-transfer.ts', 'src/ui/reference117.ts', 'src/data/reference117.ts',
  'src/native/server.ts', 'src/native/play-transport.ts', 'src/client/native.ts', 'src/client/native-transport.ts',
);
for (const f of FILES) if (fs.existsSync(f)) strs.push(...literals(fs.readFileSync(f, 'utf8')));
for (const it of Object.values(ITEMS)) strs.push(it.name);
for (const p of Object.values(PROTOS)) strs.push(p.name);
for (const t of Object.values(TECHS)) strs.push(t.name, t.desc);
for (const n of NEWS) strs.push(n.title, ...n.items.map(i => i.text));
for (const t of Object.values(TIPS)) strs.push(t.title, t.text);
setLang('en');
const IGN = new Set(['с', 'ч', 'Русский']);
const left = [...new Set(strs.flatMap(s => untranslated(s)))].filter(x => !IGN.has(x));
if (left.length) { console.log(`Без перевода (${left.length}):`); if (FULL) { const full = [...new Set(strs.filter(s => untranslated(s).some(x => !IGN.has(x))))]; for (const x of full) console.log('  ' + JSON.stringify(x)); } else for (const x of left) console.log('  ' + x); process.exit(1); }
console.log(`✔ переводы: ${strs.length} строк, пробелов нет`);

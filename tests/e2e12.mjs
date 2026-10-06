// E2E rc5 (пункт 5 плана v1.0): совместимость и надёжность в трёх движках — Chromium, Firefox, WebKit (Safari).
//  • архив сохранений v0.1–rc1 (tests/saves) грузится в браузере без потерь: старое хранилище localStorage
//    с переносом в IndexedDB, слоты IndexedDB, импорт файла .z7save, строка из отчёта об ошибке;
//  • сохранение → IndexedDB → перезагрузка страницы → продолжение;
//  • колесо мыши (deltaMode строки/пиксели), тачпад (мелкие дельты, щипок ctrl+wheel), жесты Safari, Ctrl+щелчок на Mac;
//  • пресеты графики для слабых ПК: разрешение, ограничение кадров, ?gfx=min, масштаб интерфейса без CSS zoom.
// Запуск: npx tsx tests/e2e12.mjs [chromium|firefox|webkit] (без аргумента — все три по очереди).
// WebKit: Playwright 1.49 со сборкой WebKit для Ubuntu 20.04 в /data/pwold (см. README) — если её нет, движок пропускается.
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import { ledger, diffLedger } from '../src/sim/compat.ts';
import { unpackStr, packStr } from '../src/core/pack.ts';

const WK = { PW: '/data/pwold/node_modules/playwright/index.mjs', PLAYWRIGHT_BROWSERS_PATH: '/data/pwold/browsers', PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: '1', PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: 'ubuntu20.04-x64' };
const name = process.argv[2];
if (!name) {
  let bad = 0; const sum = [];
  for (const n of ['chromium', 'firefox', 'webkit']) {
    if (n === 'webkit' && !fs.existsSync(WK.PW)) { console.log('\n=== webkit: пропущен (нет /data/pwold)'); continue; }
    const env = { ...process.env, ...(n === 'webkit' ? WK : {}) };
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], n], { stdio: 'inherit', env });
    sum.push(`${n}: ${r.status === 0 ? 'OK' : 'ПРОВАЛ'}`); if (r.status !== 0) bad++;
  }
  console.log('\n' + sum.join(' · ')); process.exit(bad ? 1 : 0);
}
const pw = (await import(process.env.PW || 'playwright')).default;
const DIR = 'tests/saves', man = JSON.parse(fs.readFileSync(DIR + '/MANIFEST.json', 'utf8'));
const saves = Object.fromEntries(man.files.map(m => [m.file.replace('.z7save', ''), { ...m, str: fs.readFileSync(`${DIR}/${m.file}`, 'utf8').trim() }]));
let fails = 0; const errs = []; const nums = {};
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = 'file:///data/game/dist/index.html';
const launch = name === 'chromium' ? { executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] }
  : name === 'firefox' ? { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } } : {};
const b = await pw[name].launch(launch);
console.log(`\n=== ${name} ${b.version()}`);
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async (p, t = 300000) => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && window.__started !== false && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: t }); await p.waitForTimeout(300); };
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ru-RU' });
// WebKit для Linux (WPE) без D-Bus падает в libspiel на speechSynthesis.getVoices() (окно настроек с rc6 спрашивает голоса) — это окружение, не игра
const NOSPEECH = () => Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} }, configurable: true });
if (name === 'webkit') await ctx.addInitScript(NOSPEECH);
const p = await ctx.newPage(); watch(p);
let t0 = Date.now();
await p.goto(URL0);
await ready(p);
nums.start = Date.now() - t0;
const info = await p.evaluate(() => { const z = window.__zavod; return { mode: z.R.mode, note: z.R.modeNote, worker: !!z.sim, gfx: z.settings.gfx, auto: z.settings.gfxAuto, tex: window.__texMs, zoomCSS: CSS.supports('zoom', '2'), cs: typeof CompressionStream, ds: typeof DecompressionStream, idb: typeof indexedDB }; });
ok(true, `запуск за ${(nums.start / 1000).toFixed(1)} с: рендер ${info.mode}${info.note ? ' (' + info.note + ')' : ''}, симуляция ${info.worker ? 'в Worker' : 'в главном потоке'}, графика «${info.gfx}»${info.auto ? ' (авто)' : ''}, текстуры ${Math.round(info.tex)} мс`);
ok(info.worker, 'Worker работает');
ok(info.cs === 'function' && info.ds === 'function', 'CompressionStream/DecompressionStream есть');
ok(await p.evaluate(async () => (await window.__zavod.store.backend()) === 'indexeddb'), 'хранилище — IndexedDB');
await p.screenshot({ path: `shots/rc5-${name}-start.png` });

// ---------- 1. Старое хранилище: сохранения v0.1–v0.3 лежали в localStorage ----------
console.log('1. Сохранения v0.1–v0.3 в localStorage → перенос в IndexedDB при запуске');
const legacy = ['v0.1-start', 'v0.2-oil-swarm', 'v0.2-early', 'v0.3-planners'];
await p.evaluate(async ({ legacy, strs }) => {
  const z = window.__zavod; z.sim.post({ t: 'pause', paused: true });
  const req = indexedDB.deleteDatabase('zavod7'); await new Promise(r => { req.onsuccess = req.onerror = req.onblocked = r; setTimeout(r, 1500); });
  localStorage.clear(); const meta = {}; legacy.forEach((k, i) => { localStorage.setItem('zavod7:' + k, strs[i]); meta[k] = { time: Date.now() - 1e6 + i * 1000, tick: 1 }; });
  localStorage.setItem('zavod7:meta', JSON.stringify(meta));
}, { legacy, strs: legacy.map(k => saves[k].str) });
await p.reload(); await ready(p);
const mig = await p.evaluate(async legacy => { const z = window.__zavod; const out = {}; for (const k of legacy) out[k] = { ls: localStorage.getItem('zavod7:' + k) != null, idb: await z.store.get(k) }; return { out, tick: z.game.tick, rep: await z.workerEval('return g.loadReport ? { era: g.loadReport.era } : null') }; }, legacy);
ok(legacy.every(k => !mig.out[k].ls), 'в localStorage старых слотов не осталось');
ok(legacy.every(k => mig.out[k].idb === saves[k].str), 'все 4 перенесены в IndexedDB байт в байт');
ok(mig.rep && mig.rep.era.startsWith('v0.3') && mig.tick >= saves['v0.3-planners'].ledger.tick, `игра продолжилась с последнего сохранения (${mig.rep?.era}, тик ${mig.tick})`);

// ---------- 2. Каждое сохранение архива: загрузка и сверка с описью ----------
console.log('2. Архив v0.1–rc1: загрузка из IndexedDB и сверка с описью (предметы, постройки, жидкости, исследования, Рой)');
const slotOf = k => saves[k].storage === 'localStorage' ? k : 'idb-' + k;
await p.evaluate(async items => { const z = window.__zavod; const meta = JSON.parse(localStorage.getItem('zavod7:meta') || '{}');
  for (const [slot, str] of items) { await z.store.put(slot, str); meta[slot] = { time: Date.now() - 5e5, tick: 1 }; } localStorage.setItem('zavod7:meta', JSON.stringify(meta)); },
  Object.keys(saves).filter(k => saves[k].storage === 'indexeddb').map(k => [slotOf(k), saves[k].str]));
for (const k of Object.keys(saves)) {
  const m = saves[k]; t0 = Date.now();
  const r = await p.evaluate(async slot => { const z = window.__zavod; z.sim.post({ t: 'pause', paused: true }); const al = window.alert; let alerted = null; window.alert = s => { alerted = s; };
    await z.loadFrom(slot); const sv = await z.sim.save({}); window.alert = al;
    const ev = await z.workerEval('return { rep: g.loadReport, steel: g.enabled.has("steel-chest"), ents: g.ents.size, units: g.units.length }');
    return { str: sv.str, alerted, ...ev }; }, slotOf(k));
  const ms = Date.now() - t0;
  if (r.alerted) { ok(false, `${k}: ${r.alerted}`); continue; }
  const s = await unpackStr(r.str); const skip = m.ledger.tele === -1 ? ['tele'] : [];
  const d = diffLedger(m.ledger, ledger(s), { skip, fluidTol: 1e-6 });
  ok(d.length === 0 && Object.keys(r.rep.dropped).length === 0, `${k} (${m.storage}): ${r.ents} построек${r.units ? ', ' + r.units + ' юнитов Роя' : ''} — ${d.length ? 'потери: ' + d.slice(0, 5).join('; ') : 'без потерь'}, ${ms} мс`);
  if (k === 'v0.2-oil-swarm') ok(r.steel, 'v0.2: «Обработка стали» открывает стальной сундук');
}
// партия идёт дальше
await p.evaluate(() => window.__zavod.sim.post({ t: 'pause', paused: false })); const tk0 = await p.evaluate(() => window.__zavod.game.tick);
await p.waitForTimeout(3000); const tk1 = await p.evaluate(() => window.__zavod.game.tick);
ok(tk1 - tk0 > 60, `после загрузки rc1 игра идёт: +${tk1 - tk0} тиков за 3 с`);

// ---------- 3. Сохранение → IndexedDB → перезагрузка ----------
console.log('3. Сохранение в слот → перезагрузка страницы → продолжение');
const before = await p.evaluate(async () => { const z = window.__zavod; await z.loadFrom('idb-v0.4-purple'); z.sim.post({ t: 'pause', paused: false }); await new Promise(r => setTimeout(r, 2000));
  z.sim.post({ t: 'pause', paused: true }); await z.saveTo('rc5-test'); const str = await z.store.get('rc5-test'); return { str, len: str ? str.length : 0 }; });
ok(before.len > 1000, `сохранено в IndexedDB: ${Math.round(before.len / 1024)} КБ`);
await p.reload(); await ready(p);
const afterStr = await p.evaluate(async () => { const z = window.__zavod; z.sim.post({ t: 'pause', paused: true }); return (await z.sim.save({})).str; });
{ const a = ledger(await unpackStr(before.str)), c = ledger(await unpackStr(afterStr)); const d = diffLedger(a, c, { skip: ['tick', 'items', 'fluids', 'pollution', 'units', 'crafting', 'produced', 'tele', 'research'] });
  ok(d.length === 0 && c.tick >= a.tick, `после перезагрузки та же партия: ${Object.values(c.ents).reduce((x, y) => x + y, 0)} построек, тик ${c.tick} ≥ ${a.tick}${d.length ? ' — ' + d.slice(0, 4).join('; ') : ''}`); }

// ---------- 4. Файл .z7save (BOM, переводы строк Windows) и строка из отчёта ----------
console.log('4. Импорт файла .z7save и строки из отчёта об ошибке');
const tmp = os.tmpdir() + `/old-${name}.z7save`;
fs.writeFileSync(tmp, '\ufeff' + saves['v0.2-early'].str.match(/.{1,76}/g).join('\r\n') + '\r\n');
const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.evaluate(() => window.__zavod.ui.h.importSave())]);
await fc.setFiles(tmp); await p.waitForTimeout(1500);
const imp = await p.evaluate(() => window.__zavod.workerEval('return { n: g.ents.size, era: g.loadReport && g.loadReport.era }'));
ok(imp.n === saves['v0.2-early'].ents && imp.era === 'v0.2', `файл с BOM и CRLF открыт: ${imp.era}, ${imp.n} построек`);
const rep = await p.evaluate(async () => { const z = window.__zavod; const t = await z.ui.h.bugReport('проверка rc5', true); const tick = z.game.tick, n = z.game.ents.size; z.ui.h.newGame(5, 'peaceful'); await new Promise(r => setTimeout(r, 500));
  const n0 = z.game.ents.size; await z.ui.h.loadSaveString(t); await new Promise(r => setTimeout(r, 800)); return { len: t.length, tick, n, n0, n2: z.game.ents.size, tick2: z.game.tick }; });
ok(rep.n2 === rep.n && rep.n0 !== rep.n && rep.tick2 >= rep.tick, `отчёт (${Math.round(rep.len / 1024)} КБ) → партия восстановлена: ${rep.n2} построек`);
// ошибки: файл из будущей версии и мусор — текущая партия не трогается
const fut = await packStr({ v: 99, seed: 1, tick: 1, ents: [] });
const bad = await p.evaluate(async fut => { const z = window.__zavod; const n = z.game.ents.size; const res = [];
  for (const s of [fut, 'Zabcdef', 'hello']) { try { await z.ui.h.loadSaveString(s); res.push('ok'); } catch (e) { res.push(e.message); } }
  await new Promise(r => setTimeout(r, 300)); return { res, same: z.game.ents.size === n }; }, fut);
ok(/новой версии/.test(bad.res[0]) && bad.res.every(r => r !== 'ok') && bad.same, `сохранение из будущего и мусор отклонены, партия цела: «${bad.res[0]}»`);

// ---------- 5. Мышь, тачпад, жесты ----------
console.log('5. Колесо мыши, тачпад, щипок, жесты Safari');
const zoomAfter = (evs) => p.evaluate(async evs => { const z = window.__zavod, cv = document.getElementById('game'); z.view.zoom = 1;
  for (const e of evs) { if (e.g) { const ev = new Event(e.g, { cancelable: true }); ev.scale = e.scale; cv.dispatchEvent(ev); } else cv.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 640, clientY: 360, ...e })); }
  return z.view.zoom; }, evs);
const zl = await zoomAfter([{ deltaY: 3, deltaMode: 1 }]); // Firefox: колесо в строках
const zp = await zoomAfter([{ deltaY: 100, deltaMode: 0 }]); // Chrome/Safari: колесо в пикселях
ok(Math.abs(zl - zp) < 1e-9 && zl < 0.95 && zl > 0.8, `один щелчок колеса: строки (Firefox) и пиксели дают одинаково ×${zl.toFixed(3)}`);
const ztp = await zoomAfter(Array.from({ length: 20 }, () => ({ deltaY: -2.5, deltaMode: 0 })));
const ztp1 = await zoomAfter([{ deltaY: -2.5, deltaMode: 0 }]);
ok(ztp > 1.05 && ztp < 1.6 && ztp1 < 1.03, `тачпад: 20 мелких событий прокрутки — плавно ×${ztp.toFixed(3)} (одно — ×${ztp1.toFixed(3)})`);
const zpin = await zoomAfter(Array.from({ length: 10 }, () => ({ deltaY: -3, deltaMode: 0, ctrlKey: true })));
ok(zpin > 1.1, `щипок (ctrl+колесо): ×${zpin.toFixed(3)}`);
const zh = await zoomAfter([{ deltaX: 40, deltaY: 0, deltaMode: 0 }]);
ok(zh === 1, 'горизонтальная прокрутка двумя пальцами не масштабирует');
const zg = await zoomAfter([{ g: 'gesturestart', scale: 1 }, { g: 'gesturechange', scale: 1.5 }, { deltaY: -10, ctrlKey: true, deltaMode: 0 }, { g: 'gesturechange', scale: 2 }, { g: 'gestureend', scale: 2 }]);
ok(Math.abs(zg - 2) < 1e-9, `жест Safari (gesturechange scale 2) → ×${zg}; ctrl+колесо во время жеста не удваивает`);
const pageZoom = await p.evaluate(() => { const ev = new Event('gesturestart', { cancelable: true, bubbles: true }); document.body.dispatchEvent(ev); return ev.defaultPrevented; });
ok(pageZoom, 'щипок вне холста не масштабирует страницу');
const ctl = await p.evaluate(() => { const z = window.__zavod, cv = document.getElementById('game'); z.setTool('decon');
  cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true, clientX: 600, clientY: 300 })); const c = z.view.sel ? z.view.sel.cancel : null;
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ctrlKey: true, clientX: 600, clientY: 300 })); z.setTool(null); return c; });
ok(ctl === false, 'не Mac: Ctrl+щелчок — обычный левый');

// ---------- 6. Графика для слабых ПК ----------
console.log('6. Пресеты графики: разрешение холста и кадры в секунду');
await p.evaluate(() => { window.__zavod.ui.close(); });
const measure = () => p.evaluate(async () => { const z = window.__zavod; await new Promise(r => setTimeout(r, 600)); const f0 = z.R.frame, t = performance.now(); await new Promise(r => setTimeout(r, 2500)); const cv = document.getElementById('game');
  return { fps: (z.R.frame - f0) / ((performance.now() - t) / 1000), w: cv.width, css: cv.clientWidth, dpr: devicePixelRatio, gfx: z.settings.gfx }; });
nums.fps = {};
for (const pr of ['high', 'medium', 'low', 'min']) {
  await p.evaluate(pr => window.__zavod.ui.h.setPreset(pr), pr); await p.waitForFunction(() => document.getElementById('loading').style.display === 'none', null, { timeout: 120000 });
  const r = await measure(); nums.fps[pr] = Math.round(r.fps);
  ok(r.gfx === pr, `пресет «${pr}» выбран и подсвечен (${r.gfx})`);
  const want = { high: 1, medium: 1, low: 0.75, min: 0.5 }[pr] * Math.min(r.dpr, { high: 3, medium: 1.5, low: 1, min: 1 }[pr]);
  ok(Math.abs(r.w / r.css - want) < 0.02 && (pr !== 'min' || r.fps < 34) && (pr !== 'low' || r.fps < 64), `«${pr}»: холст ${r.w} px на ${r.css} CSS px (×${(r.w / r.css).toFixed(2)}), ${r.fps.toFixed(0)} кадр/с`);
  if (pr === 'min') await p.screenshot({ path: `shots/rc5-${name}-min.png` });
}
await p.evaluate(() => { window.__zavod.ui.h.setPreset('high'); window.__zavod.ui.toggle('settings'); }); await p.waitForTimeout(300); await p.waitForFunction(() => document.getElementById('loading').style.display === 'none', null, { timeout: 120000 }); await p.waitForTimeout(400);
await p.screenshot({ path: `shots/rc5-${name}-settings.png` });
const pg = await ctx.newPage(); watch(pg);
await pg.goto(URL0 + '?gfx=min&nozoom'); await ready(pg);
const g2 = await pg.evaluate(() => { const z = window.__zavod; z.ui.h.setSettings({ uiScale: 1.5 }); z.ui.toggle('settings'); const w = document.getElementById('win'); return { gfx: z.settings.gfx, cap: z.settings.fpsCap, res: z.R.resScale, tr: w.style.transform, zoom: w.style.zoom }; });
ok(g2.gfx === 'min' && g2.cap === 30 && g2.res === 0.5, '?gfx=min: «Минимум» — 50% разрешения, 30 кадр/с');
ok(/scale\(1\.5\)/.test(g2.tr) && !g2.zoom, `масштаб интерфейса без CSS zoom (старый Firefox): ${g2.tr}`);
await pg.close();
await ctx.close();

// ---------- 7. Mac: Ctrl+щелчок = правая кнопка ----------
const mctx = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" });
if (name === 'webkit') await mctx.addInitScript(NOSPEECH);
await mctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }); if ('userAgentData' in navigator) Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => ({ platform: 'macOS' }) }); });
const mp = await mctx.newPage(); watch(mp); await mp.goto(URL0 + '?gfx=low'); await ready(mp);
const mac = await mp.evaluate(() => { const z = window.__zavod, cv = document.getElementById('game'); z.ui.close(); z.setTool('decon');
  cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true, clientX: 600, clientY: 300 })); const c = z.view.sel ? z.view.sel.cancel : null;
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ctrlKey: true, clientX: 600, clientY: 300 })); const left = !!z.view.sel; z.setTool(null);
  z.ui.toggle('settings'); return { c, left, row: /Ctrl\+(щелчок|click)/.test(document.getElementById('win').innerText) }; });
ok(mac.c === true && !mac.left && mac.row, 'Mac: Ctrl+щелчок работает как правая кнопка (отмена рамки сноса), в настройках есть переключатель');
await mctx.close();
await b.close();
const real = errs.filter(e => !/WebGL|GPU stall|swiftshader|GL_|Software WebGL/i.test(e));
ok(real.length === 0, 'ошибок на страницах нет' + (real.length ? ': ' + real.slice(0, 4).join(' | ') : ''));
fs.writeFileSync(`shots/rc5-${name}.json`, JSON.stringify({ browser: name, version: b.version(), info, nums }, null, 1));
console.log(fails ? `ПРОВАЛОВ: ${fails}` : `${name}: все проверки прошли`);
process.exit(fails ? 1 : 0);

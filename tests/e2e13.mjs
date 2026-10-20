// E2E п. 6 плана v1.0 (мелкие доработки): озвучка ОСКАРа и интерфейса, обучающие подсказки, слоты сохранений с превью.
// Запуск: node tests/e2e13.mjs [chromium|firefox|webkit] (без аргумента — все три).
// Речь проверяется подменой speechSynthesis (в headless-браузерах голосов нет), запасной «голос» — без подмены.
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
import fs from 'fs';
import { spawnSync } from 'child_process';
const name = process.env.PW_BROWSER || process.argv[2];
if (!name) {
  let bad = 0; const sum = [];
  for (const n of ['chromium', 'firefox', 'webkit']) {
    const r = spawnSync(process.execPath, [process.argv[1], n], { stdio: 'inherit', env: process.env });
    sum.push(`${n}: ${r.status === 0 ? 'OK' : 'ПРОВАЛ'}`); if (r.status !== 0) bad++;
  }
  console.log('\n' + sum.join(' · ')); process.exit(bad ? 1 : 0);
}
let fails = 0; const errs = [];
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const URL0 = appUrl(import.meta.url);
const b = await launchBrowser(name, name === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] } : {});
console.log(`\n=== ${name} ${b.version()}`);
const watch = p => { p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 300)); }); };
const ready = async p => { await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 }); await p.waitForTimeout(300); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// подмена синтеза речи: два голоса, запись всех фраз
const MOCK = () => {
  const voices = [{ name: 'Test Irina', lang: 'ru-RU', localService: true, default: true, voiceURI: 'irina' }, { name: 'Test David', lang: 'en-US', localService: true, default: false, voiceURI: 'david' }];
  window.__spoken = [];
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  const ss = { speaking: false, pending: false, getVoices: () => voices, addEventListener() {}, cancel() {}, pause() {}, resume() {},
    speak(u) { window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang, volume: u.volume, rate: u.rate, pitch: u.pitch, t: Date.now() }); setTimeout(() => u.onend && u.onend(), 40); } };
  Object.defineProperty(window, 'speechSynthesis', { value: ss, configurable: true });
};
const spoken = p => p.evaluate(() => window.__spoken.map(s => s.text));
const spokenSince = async (p, n) => (await p.evaluate(() => window.__spoken)).slice(n);
const nSpoken = p => p.evaluate(() => window.__spoken.length);

// ---------- 1. Озвучка ----------
console.log('1. Голос ОСКАРа и озвучка интерфейса (speechSynthesis)');
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
await ctx.addInitScript(MOCK);
const p = await ctx.newPage(); watch(p);
await p.goto(URL0 + '?gfx=low'); await ready(p); await p.waitForTimeout(800);
ok((await nSpoken(p)) === 0, 'до первого щелчка игрока голос молчит (требование браузеров)');
await p.evaluate(() => window.__zavod.ui.close()); await p.mouse.click(700, 420); await p.waitForTimeout(2500);
let sp = await p.evaluate(() => window.__spoken);
ok(sp.some(s => /Крушение на Кеплер/.test(s.text)) && sp.some(s => /Построй завод/.test(s.text)), `после щелчка ОСКАР зачитал вступление (${sp.length} фраз)`);
ok(sp.length && sp.every(s => s.voice === 'Test Irina' && s.pitch < 1 && !/ОСКАР/.test(s.text)), 'русский голос, ниже обычного, без «ОСКАР:» в тексте');
ok(sp.some(s => /правая кнопка/.test(s.text)), `сокращения словами: «${sp.find(s => /правая/.test(s.text))?.text}»`);
let n0 = await nSpoken(p);
await p.evaluate(() => window.__zavod.workerEval("g.stats.handMined['iron-ore'] = 10"));
await p.waitForTimeout(4000); sp = await spokenSince(p, n0);
ok(sp.some(s => /цель выполнена/.test(s.text)) && sp.some(s => /^Новая цель: Поставь Каменную печь/.test(s.text)), `цель выполнена → новая цель вслух: «${sp.map(s => s.text).join(' | ')}»`);
const say = (t) => p.evaluate(t => window.__zavod.workerEval(`g.msg(${JSON.stringify(t)})`), t);
n0 = await nSpoken(p); await say('Исследовано: Автоматизация'); await p.waitForTimeout(1200);
ok((await nSpoken(p)) === n0, 'озвучка интерфейса выключена по умолчанию — сообщение не читается');
await p.evaluate(() => window.__zavod.ui.h.setSettings({ uiVoice: 'important' }));
n0 = await nSpoken(p); await say('Исследовано: Логистика'); await say('Нет предмета: Труба'); await say('⚠ Рой атакует постройку!'); await p.waitForTimeout(2500); sp = await spokenSince(p, n0);
ok(sp.length === 2 && /Логистика/.test(sp[0].text) && /Рой атакует/.test(sp[1].text) && sp[0].pitch === 1, `«важное»: исследование и атака прочитаны, мелочь — нет (${sp.map(s => s.text).join(' | ')})`);
await p.evaluate(() => window.__zavod.ui.h.setSettings({ uiVoice: 'all' }));
n0 = await nSpoken(p); await say('Нет предмета: Труба'); await p.evaluate(() => window.__zavod.ui.toggle('stats')); await p.waitForTimeout(2500); sp = await spokenSince(p, n0);
ok(sp.some(s => /Нет предмета/.test(s.text)) && sp.some(s => /^Статистика( производства)?$/.test(s.text)), `«всё»: любые сообщения и название открытого окна (${sp.map(s => s.text.slice(0, 40)).join(' | ')})`);
ok(sp.some(s => /Сколько произведено/.test(s.text)), 'обучающая подсказка окна прочитана голосом ОСКАРа');
await p.evaluate(() => window.__zavod.ui.close()); await p.waitForTimeout(300);
n0 = await nSpoken(p);
await p.evaluate(() => { const el = document.querySelector('#hotbar [data-tip]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); });
await p.waitForTimeout(1600); sp = await spokenSince(p, n0);
const tipName = await p.evaluate(() => document.getElementById('tip').innerText.split('\n')[0]);
ok(sp.some(s => s.text === tipName), `подсказка под курсором прочитана: «${tipName}»`);
await p.evaluate(() => window.__zavod.ui.h.setSettings({ uiVoice: 'off', voiceRate: 1.2 }));
n0 = await nSpoken(p); await say('ОСКАР: Проверка темпа.'); await p.waitForTimeout(1500); sp = await spokenSince(p, n0);
ok(sp.length === 1 && Math.abs(sp[0].rate - 1.2) < 1e-9, `темп речи ×${sp[0]?.rate}`);
await p.evaluate(() => window.__zavod.ui.h.setSettings({ voice: 0 }));
n0 = await nSpoken(p); await say('ОСКАР: Тишина.'); await p.waitForTimeout(1500);
ok((await nSpoken(p)) === n0, 'громкость голоса 0 — ОСКАР молчит');
await p.evaluate(() => window.__zavod.ui.h.setSettings({ voice: 0.8, voiceRate: 1, lang: 'en' }));
n0 = await nSpoken(p); await say('ОСКАР: Построй завод и запусти маяк. Начни с добычи руды (ПКМ).'); await p.waitForTimeout(2000); sp = await spokenSince(p, n0);
ok(sp.length === 1 && sp[0].voice === 'Test David' && !/[А-Яа-яЁё]/.test(sp[0].text), `английский: голос ${sp[0]?.voice}, «${sp[0]?.text}»`);
await p.evaluate(() => { window.__zavod.ui.h.setSettings({ lang: 'ru' }); window.__zavod.ui.toggle('settings'); }); await p.waitForTimeout(400);
const setTxt = await p.evaluate(() => document.getElementById('win').innerText + [...document.querySelectorAll('#voicesel option')].map(o => o.textContent).join(' '));
ok(/Голос ОСКАРа/.test(setTxt) && /Test Irina/.test(setTxt) && /Озвучка интерфейса/.test(setTxt), 'в настройках: громкость голоса, выбор голоса браузера, озвучка интерфейса');
await p.evaluate(() => { const s = document.getElementById('voicesel'); s.value = 'Test Irina'; s.dispatchEvent(new Event('change', { bubbles: true })); });
n0 = await nSpoken(p); await p.evaluate(() => { const b = [...document.querySelectorAll('#win button')].find(x => x.dataset.act === 'vtest'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }); await p.waitForTimeout(1200); sp = await spokenSince(p, n0);
ok(sp.length === 1 && /Голос работает/.test(sp[0].text) && (await p.evaluate(() => window.__zavod.settings.voiceName)) === 'Test Irina', 'кнопка «Проверить» и выбор голоса');
await p.screenshot({ path: `shots/p6-${name}-settings.png` });
await ctx.close();
// без speechSynthesis — запасной «голос»
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
await ctx2.addInitScript(() => { try { delete window.speechSynthesis; Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); } catch {} });
const p2 = await ctx2.newPage(); watch(p2); await p2.goto(URL0 + '?gfx=low'); await ready(p2);
await p2.evaluate(() => window.__zavod.ui.close()); await p2.mouse.click(700, 420); await p2.waitForTimeout(9000);
const fb = await p2.evaluate(() => { const z = window.__zavod; z.ui.toggle('settings'); return { log: z.voice.log.map(l => l.engine + ':' + l.text.slice(0, 30)), txt: document.getElementById('win').innerText, ctx: z.audio.ctx && z.audio.ctx.state }; });
ok(fb.log.length >= 2 && fb.log.every(l => l.startsWith('babble')), `без синтеза речи ОСКАР «говорит» сигналами: ${fb.log.length} реплик, звук ${fb.ctx}`);
ok(/Голосов для этого языка в браузере нет/.test(fb.txt), 'в настройках объяснено, почему нет голоса');
await ctx2.close();

// ---------- 2. Обучающие подсказки ----------
console.log('2. Обучающие подсказки при первом открытии окон');
const ctx3 = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
// подмена речи и здесь: сборка WebKit для Linux (WPE) без D-Bus падает в libspiel на первом speechSynthesis.getVoices() — это окружение теста, не игра
await ctx3.addInitScript(MOCK);
const p3 = await ctx3.newPage(); watch(p3); await p3.goto(URL0 + '?gfx=low'); await ready(p3);
const tipIn = (w, ent) => p3.evaluate(([w, ent]) => { const z = window.__zavod; z.ui.close(); if (ent != null) z.ui.toggle('ent', ent); else z.ui.toggle(w); const t = document.querySelector('#win .tipbox'); return t ? t.dataset.tipkey : null; }, [w, ent]);
ok(await tipIn('inv') === 'inv', 'первое открытие инвентаря — подсказка');
await p3.screenshot({ path: `shots/p6-${name}-tip.png` });
const invV12 = await p3.evaluate(() => { const z = window.__zavod; z.ui.close(); z.ui.toggle('inv'); const t = document.querySelector('#win .tipbox'); return t ? { key: t.dataset.tipkey, text: t.innerText } : null; });
ok(invV12?.key === 'inv:v12' && /Новое: стопки и быстрая погрузка/.test(invV12.text) && /Shift\+ПКМ/.test(invV12.text), `новая версия инвентаря показывает отдельную подсказку о стопках: ${invV12?.key || 'нет'}`);
await p3.evaluate(() => document.querySelector('#win [data-act="tipok"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
const invV111 = await p3.evaluate(() => { const t = document.querySelector('#win .tipbox'); return t ? { key: t.dataset.tipkey, text: t.innerText } : null; });
ok(invV111?.key === 'inv:v111' && /Новое: быстрый доступ/.test(invV111.text) && /Средняя кнопка/.test(invV111.text), `после подсказки о стопках показывается отдельная подсказка быстрого доступа: ${invV111?.key || 'нет'}`);
await p3.evaluate(() => document.querySelector('#win [data-act="tipok"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
ok(await tipIn('inv') === null, 'после показа обеих версий подсказок повторное открытие не показывает их снова');
const furn = await p3.evaluate(() => window.__zavod.workerEval(`const P = g.player; g.inv.add('stone-furnace', 1); for (let d = 3; d < 12; d++) { const e = g.build('stone-furnace', Math.floor(P.x) + d, Math.floor(P.y) + 3, 0, true); if (e) return e.id; } return -1;`));
await p3.waitForTimeout(600);
ok(furn >= 0 && await tipIn(null, furn) === 'ent:furnace', 'печь — своя подсказка');
await p3.evaluate(() => { const b = document.querySelector('#win [data-act="tipok"]'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }); await p3.waitForTimeout(200);
ok(await p3.evaluate(() => !document.querySelector('#win .tipbox') && document.getElementById('win').style.display !== 'none'), '«Понятно» убирает подсказку, окно остаётся');
const seen = await p3.evaluate(() => JSON.parse(localStorage.getItem('zavod7:tips') || '[]'));
ok(seen.includes('inv') && seen.includes('ent:furnace'), `показанные подсказки запомнены: ${seen.join(', ')}`);
await p3.reload(); await ready(p3);
ok(await tipIn('inv') === null, 'после прочтения подсказки обновления повторное открытие не показывает её снова');
await p3.reload(); await ready(p3);
ok(await tipIn('inv') === null, 'после перезагрузки ранее прочитанные версии подсказки не повторяются');
await p3.evaluate(() => window.__zavod.ui.h.setSettings({ tips: false }));
ok(await tipIn('tech') === null, 'выключены в настройках — не показываются');
await p3.evaluate(() => { const z = window.__zavod; z.ui.close(); z.ui.toggle('settings'); const b = document.querySelector('#win [data-act="tipsreset"]'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
ok(await tipIn('inv') === 'inv' && await tipIn('tech') === 'tech', '«Показать подсказки заново» — снова показываются');

// ---------- 3. Слоты с превью ----------
console.log('3. Слоты сохранений с превью');
await p3.evaluate(() => window.__zavod.ui.close());
await p3.evaluate(() => window.__zavod.workerEval(`const P = g.player; g.inv.add('wooden-chest', 3); let n = 0; for (let d = 3; d < 14 && n < 3; d++) if (g.build('wooden-chest', Math.floor(P.x) + d, Math.floor(P.y) - 3, 0, true)) n++;`)); await p3.waitForTimeout(500);
const meta1 = await p3.evaluate(async () => { const z = window.__zavod; await z.saveTo('1'); return JSON.parse(localStorage.getItem('zavod7:meta'))['1']; });
ok(meta1 && /^data:image\/jpeg;base64,/.test(meta1.prev || '') && meta1.ents >= 1 && meta1.goal >= 0 && meta1.mode && meta1.kb >= 1, `слот 1: картинка ${Math.round((meta1?.prev || '').length / 1024)} КБ, построек ${meta1?.ents}, цель ${meta1?.goal + 1}, ${meta1?.kb} КБ`);
const pix = await p3.evaluate(async src => { const im = new Image(); im.src = src; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v; n++; } const m = s / n; return { w: im.width, h: im.height, mean: m, sd: Math.sqrt(s2 / n - m * m) }; }, meta1.prev);
ok(pix.w === 192 && pix.h === 108 && pix.sd > 8 && pix.mean > 20, `превью 192×108 не пустое: яркость ${pix.mean.toFixed(0)}, разброс ${pix.sd.toFixed(0)} (рендер ${await p3.evaluate(() => window.__zavod.R.mode)})`);
const old = fs.readFileSync('tests/saves/v0.2-early.z7save', 'utf8').trim();
await p3.evaluate(async old => { const z = window.__zavod; await z.saveTo('auto1'); await z.store.put('old-v02', old); const m = JSON.parse(localStorage.getItem('zavod7:meta')); m['old-v02'] = { time: Date.now() - 864e5, tick: 1 }; localStorage.setItem('zavod7:meta', JSON.stringify(m)); z.ui.toggle('menu'); }, old);
await p3.locator('#win .menu-primary-actions [data-act="menu-page"][data-page="load"]').click(); await p3.waitForTimeout(1600);
const menu = await p3.evaluate(() => { const cards = [...document.querySelectorAll('#win .savecard')]; return { n: cards.length, slots: cards.map(c => c.dataset.slot), img: cards.filter(c => c.querySelector('img.thumb')).map(c => c.dataset.slot), old: cards.find(c => c.dataset.slot === 'old-v02')?.innerText || '', meta: JSON.parse(localStorage.getItem('zavod7:meta'))['old-v02'] }; });
ok(menu.slots.slice(0, 3).join() === '1,2,3' && menu.img.includes('1') && menu.img.includes('auto1'), `в меню карточки: ${menu.slots.join(', ')}; с картинкой: ${menu.img.join(', ')}`);
ok(menu.meta.ents === 47 && menu.meta.era === 'v0.2' && /v0\.2/.test(menu.old) && /построек 47/.test(menu.old), `слот старой версии без сведений: прочитан из файла — ${menu.old.replace(/\s+/g, ' ').slice(0, 120)}`);
await p3.screenshot({ path: `shots/p6-${name}-menu.png` });
await p3.evaluate(() => { const z = window.__zavod; z.ui.h.setSettings({ lang: 'en' }); z.ui.close(); z.ui.toggle('menu'); });
await p3.locator('#win .menu-primary-actions [data-act="menu-page"][data-page="load"]').click(); await p3.waitForTimeout(400);
const cyr = await p3.evaluate(() => (document.getElementById('win').innerText.match(/[А-Яа-яЁё][А-Яа-яЁё\s.,:—-]*/g) || []).map(s => s.trim()).filter(s => s && s !== 'Русский'));
ok(cyr.length === 0, 'меню со слотами на английском без кириллицы' + (cyr.length ? ': ' + cyr.slice(0, 6).join(' | ') : ''));
await p3.screenshot({ path: `shots/p6-${name}-menu-en.png` });
await p3.evaluate(() => window.__zavod.ui.h.setSettings({ lang: 'ru' }));
const del = await p3.evaluate(async () => { const z = window.__zavod; z.ui.h.deleteSave('old-v02'); await new Promise(r => setTimeout(r, 300)); return { s: await z.store.get('old-v02'), m: 'old-v02' in JSON.parse(localStorage.getItem('zavod7:meta')) }; });
ok(del.s == null && !del.m, 'удаление слота: файл и карточка убраны');
const ldBefore = await p3.evaluate(async () => { const z = window.__zavod; const n = z.game.ents.size; z.ui.h.newGame(3, 'none'); await new Promise(r => setTimeout(r, 600)); const n0 = z.game.ents.size; z.ui.toggle('menu'); return { n, n0 }; });
await p3.locator('#win .menu-primary-actions [data-act="menu-page"][data-page="load"]').click();
await p3.locator('#menu-saves .savecard[data-slot="1"] img.thumb').click(); await p3.waitForTimeout(1000);
const ldAfter = await p3.evaluate(() => window.__zavod.game.ents.size);
ok(ldAfter === ldBefore.n && ldBefore.n0 !== ldBefore.n, `щелчок по картинке загружает слот (${ldAfter} построек)`);

// Startup restore is asynchronous: a real new-game choice made while mod startup is pending must win.
console.log('4. Новая игра не должна быть перезаписана отложенным стартовым сохранением');
const race = await p3.evaluate(async () => {
  const z = window.__zavod;
  await z.workerEval("g.inv.add('iron-plate', 77); return true;");
  await z.saveTo('startup-race');
  const m = JSON.parse(localStorage.getItem('zavod7:meta') || '{}');
  m['startup-race'].time = Date.now() + 60000;
  localStorage.setItem('zavod7:meta', JSON.stringify(m));
  return await z.workerEval("return { seed: g.seed, tick: g.tick, iron: g.inv.count('iron-plate') };");
});
const chosenSeed = 987654321;
await p3.reload();
await p3.waitForFunction(() => !!window.__zavod?.mods?.init, null, { timeout: 300000 });
await p3.evaluate(() => {
  const mods = window.__zavod.mods, init = mods.init.bind(mods);
  window.__startupModsWaiting = false;
  window.__startupReleaseMods = null;
  mods.init = async () => {
    window.__startupModsWaiting = true;
    await new Promise(resolve => { window.__startupReleaseMods = resolve; });
    return init();
  };
});
await p3.waitForFunction(() => window.__startupModsWaiting, null, { timeout: 300000 });
await p3.keyboard.press('Escape');
await p3.locator('.menu-primary-actions [data-act="menu-page"][data-page="new"]').click();
await p3.locator('#seed').fill(String(chosenSeed));
await p3.locator('[data-act="new"]').click();
await p3.evaluate(() => window.__startupReleaseMods?.());
await p3.waitForFunction(() => window.__zavod?.frameCost?.().n > 5 && window.__zavod?.sim?.snaps > 5 && window.__zavod?.ui?.open == null, null, { timeout: 300000 });
const raceAfter = await p3.evaluate(() => window.__zavod.workerEval("return { seed: g.seed, tick: g.tick, iron: g.inv.count('iron-plate') };"));
ok(raceAfter.seed === chosenSeed, `отложенное сохранение ${race.seed} не перезаписало выбранную seed ${chosenSeed} (фактически ${raceAfter.seed})`);
await ctx3.close();
await b.close();
const real = errs.filter(e => !/WebGL|GPU stall|swiftshader|GL_|Software WebGL/i.test(e));
ok(real.length === 0, 'ошибок на страницах нет' + (real.length ? ': ' + real.slice(0, 4).join(' | ') : ''));
console.log(fails ? `ПРОВАЛОВ: ${fails}` : `${name}: все проверки прошли`);
process.exit(fails ? 1 : 0);

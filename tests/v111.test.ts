// v1.11, дополнительный список: переназначение клавиш (src/client/keys.ts), 4 ряда быстрого доступа, конвейеры,
// подземные конвейеры и разделители 4 уровней, точная коллизия инженера. Запуск: npx tsx tests/v111.test.ts
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { comboOf, bindMatch, actionOf, evCode, parseBind, baseCode, KeyEv } from '../src/client/keys';
import { ACTIONS, DEFAULTS, KEY_PRESETS } from '../src/client/settings';
import { PROTOS } from '../src/data/entities';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { entHit, colMargin } from '../src/sim/collide';
let fails = 0; const ok = (c: any, m: string) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const ev = (code: string, m: Partial<KeyEv> = {}): KeyEv => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...m });
const K = DEFAULTS.keys, K2: Record<string, string> = {};

console.log('— клавиши');
{
  ok(comboOf(ev('KeyX', { ctrlKey: true, shiftKey: true })) === 'Ctrl+Shift+KeyX' && comboOf(ev('ShiftRight', { shiftKey: true })) === 'ShiftRight', 'сочетание по событию: Ctrl+Shift+KeyX; модификатор один — без префикса');
  const b = parseBind('Ctrl+Alt+KeyQ')!; ok(b.ctrl && b.alt && !b.shift && b.code === 'KeyQ' && baseCode('Shift+KeyR') === 'KeyR', 'разбор назначения');
  ok(evCode({ code: '', key: 'Ц' }) === 'Key:ц' && evCode({ code: 'KeyW', key: 'ц' }) === 'KeyW', 'клавиша без кода — по символу');
  ok(bindMatch('KeyR', ev('KeyR', { shiftKey: true })) === 1 && bindMatch('KeyR', ev('KeyR', { ctrlKey: true })) === 0 && bindMatch('Ctrl+KeyZ', ev('KeyZ', { ctrlKey: true })) === 2, 'простая клавиша работает с Shift (поворот назад), но не с Ctrl; сочетание — точно');
  ok(actionOf(ev('KeyZ', { ctrlKey: true }), K, K2) === 'undo' && actionOf(ev('KeyC', { ctrlKey: true }), K, K2) === 'copy' && actionOf(ev('KeyS'), K, K2) === 'down', 'Ctrl+Z — отмена, Ctrl+C — копирование, S — вниз');
  const hb = ['', 'Shift+', 'Alt+', 'Alt+Shift+'].map(p => actionOf(ev('Digit3', { shiftKey: p.includes('Shift'), altKey: p.includes('Alt') }), K, K2));
  ok(hb.join() === 'hb0_2,hb1_2,hb2_2,hb3_2', `4 ряда быстрого доступа: 3, Shift+3, Alt+3, Alt+Shift+3 → ${hb.join(', ')}`);
  ok(actionOf(ev('Digit0'), K, K2) === 'hb0_9' && actionOf(ev('Backquote', { ctrlKey: true }), K, K2) === 'console', '0 — десятая ячейка, Ctrl+` — консоль модов');
  const keys = { ...K, inv: 'KeyI' }, keys2 = { inv: 'Mouse3' };
  ok(actionOf(ev('KeyI'), keys, keys2) === 'inv' && actionOf(ev('KeyE'), keys, keys2) !== 'inv' && actionOf(ev('Mouse3'), keys, keys2) === 'inv', 'переназначение: I и второе назначение «кнопка мыши» открывают инвентарь, E — нет');
  const ids = new Set(ACTIONS.map(a => a[0]));
  ok(Object.values(KEY_PRESETS).every(([, m]) => Object.keys(m).every(k => ids.has(k))), 'раскладки ссылаются только на существующие действия');
  const seen = new Map<string, string>(); const dup: string[] = [];
  for (const [a, , d] of ACTIONS) { if (!d) continue; if (seen.has(d)) dup.push(`${d}: ${seen.get(d)} / ${a}`); seen.set(d, a); }
  ok(!dup.length, `назначения по умолчанию не повторяются${dup.length ? ': ' + dup.join('; ') : ''} (${ACTIONS.length} действий)`);
  for (const [id, [name, m]] of Object.entries(KEY_PRESETS)) {
    const k = { ...K, ...m }; const c = new Map<string, string>(); const d2: string[] = [];
    for (const [a, v] of Object.entries(k)) { if (!v) continue; if (c.has(v)) d2.push(`${v}: ${c.get(v)}/${a}`); c.set(v, a); }
    ok(!d2.length, `раскладка ${name}: без конфликтов${d2.length ? ' — ' + d2.join(', ') : ''}`);
  }
  ok(DEFAULTS.quickKey === 'shift', 'быстрая погрузка по умолчанию — Shift');
}

console.log('— конвейеры 4 уровней');
const TIERS = [['transport-belt', 'underground-belt', 'splitter'], ['fast-transport-belt', 'fast-underground-belt', 'fast-splitter'], ['express-transport-belt', 'express-underground-belt', 'express-splitter'], ['turbo-transport-belt', 'turbo-underground-belt', 'turbo-splitter']];
const fresh = () => { const g = new Game(7); const sx = 3, sy = 3; for (let y = -1; y < 14; y++) for (let x = -1; x < 40; x++) if (g.world.decor(sx + x, sy + y)) g.world.removeDecor(sx + x, sy + y); for (const t of TIERS.flat()) g.enabled.add(t); return { g, sx, sy }; };
{
  ok(TIERS.flat().every(id => PROTOS[id] && RECIPES[id]), 'у всех 12 построек есть прототип и рецепт');
  ok(TECHS['logistics-4'] && ['turbo-transport-belt', 'turbo-underground-belt', 'turbo-splitter'].every(u => TECHS['logistics-4'].unlocks.includes(u)), '«Логистика 4» открывает турбо-ленту, подземный и разделитель');
  TIERS.forEach(([belt, ug, sp], k) => {
    const { g, sx, sy } = fresh();
    const b: any[] = []; for (let i = 0; i < 16; i++) b.push(g.build(belt, sx + i, sy, 1, false));
    b[0].lanes[0][0].push({ item: 'coal', pos: 0, n: 1 });
    let t = 0; while (!b[15].lanes[0][0].length && t < 3000) { g.step(); t++; }
    const v = 15 / (t / 60), want = 1.875 * (k + 1);
    // подземный: максимальная дальность — reach−1 клеток препятствий
    const reach = PROTOS[ug].reach!, y2 = sy + 3;
    const b0 = g.build(belt, sx, y2, 1, false)!; const uin = g.build(ug, sx + 1, y2, 1, false)!;
    for (let i = 2; i < reach + 1; i++) g.build('wooden-chest', sx + i, y2, 0, false);
    const uout = g.build(ug, sx + reach + 1, y2, 1, false)!; const bo = g.build(belt, sx + reach + 2, y2, 1, false)!;
    b0.lanes![0][1].push({ item: 'stone', pos: 0, n: 1 });
    for (let i = 0; i < 400; i++) g.step();
    const far = g.build(ug, sx + 1, sy + 6, 1, false)!; const far2 = g.build(ug, sx + reach + 2, sy + 6, 1, false)!;
    // разделитель делит поток
    const y4 = sy + 9; const src = g.build(belt, sx, y4, 1, false)!; const s = g.build(sp, sx + 1, y4, 1, false)!;
    const A: any[] = [], B: any[] = []; for (let i = 2; i < 8; i++) { A.push(g.build(belt, sx + i, y4, 1, false)); B.push(g.build(belt, sx + i, y4 + 1, 1, false)); }
    for (let i = 0; i < 600; i++) { const a = src.lanes![0][0]; if (!a.length || a[a.length - 1].pos >= 64) a.push({ item: 'coal', pos: 0, n: 1 }); g.step(); }
    const cnt = (l: any[]) => l.reduce((a, e) => a + e.lanes[0][0].length + e.lanes[0][1].length, 0);
    ok(Math.abs(v - want) < 0.15 * (k + 1) && uin.partner === uout.id && bo.lanes![0][1].length === 1 && far.partner !== far2.id && !!s && cnt(A) > 4 && cnt(B) > 4,
      `${belt}: ${v.toFixed(2)} клетки/с (≈ ${want}); подземный на ${reach - 1} клетки связан и пропускает, дальше — нет; разделитель ${cnt(A)}/${cnt(B)}`);
  });
  // улучшение по цепочке и сохранение
  const { g, sx, sy } = fresh(); for (let i = 0; i < 3; i++) g.build('turbo-transport-belt', sx + i, sy, 1, false); g.build('turbo-underground-belt', sx + 3, sy, 1, false); g.build('turbo-underground-belt', sx + 6, sy, 1, false); g.build('turbo-splitter', sx + 8, sy, 1, false);
  for (let i = 0; i < 30; i++) g.step();
  const g2 = deserialize(JSON.parse(JSON.stringify(serialize(g))));
  ok(stateHash(g2) === stateHash(g) && [...g2.ents.values()].filter(e => e.proto.startsWith('turbo-')).length === 6, 'турбо-постройки сохраняются и загружаются без изменений');
}

console.log('— точная коллизия');
{
  const { g, sx, sy } = fresh(); const r = 0.2;
  const f1 = g.build('stone-furnace', sx, sy, 0, false)!, f2 = g.build('stone-furnace', sx + 2, sy, 0, false)!;
  const hit = (e: any, x: number, y: number) => entHit(g, e, x, y, r);
  ok(hit(f1, sx + 1, sy + 1) && !hit(f1, sx + 2, sy + 1) && !hit(f2, sx + 2, sy + 1), 'между печами вплотную — проход (центр печи твёрдый, стык свободен)');
  ok(colMargin(PROTOS['stone-wall']) === 0 && colMargin(PROTOS['stone-furnace']) > 0, 'стена — сплошная, у печи отступ');
  const w1 = g.build('stone-wall', sx, sy + 4, 0, false)!; const w2 = g.build('stone-wall', sx + 1, sy + 4, 0, false)!;
  ok(hit(w1, sx + 1, sy + 4.5) || hit(w2, sx + 1, sy + 4.5), 'между стенами не пройти');
  const p1 = g.build('pipe', sx, sy + 7, 0, false)!, p2 = g.build('pipe', sx + 1, sy + 7, 0, false)!; // соединены
  const q1 = g.build('pipe', sx + 5, sy + 7, 0, false)!; g.build('stone-wall', sx + 5, sy + 6, 0, false); g.build('stone-wall', sx + 5, sy + 8, 0, false);
  const q2 = g.build('pipe-to-ground', sx + 6, sy + 7, 3, false) || null;
  ok(hit(p1, sx + 1, sy + 7.5) || hit(p2, sx + 1, sy + 7.5), 'вдоль соединённых труб — «рукав», на стыке не пройти');
  ok(!hit(q1, sx + 6, sy + 7.5), 'у одиночной трубы край клетки свободен');
  void q2;
  // ходьба: инженер проходит между печами
  const pl = g.player; pl.x = sx + 2; pl.y = sy - 1.5;
  for (let i = 0; i < 90; i++) { g.enqueue({ t: 'input', mx: 0, my: 1, mine: null }); g.step(); }
  ok(pl.y > sy + 2.2, `инженер прошёл между печами вниз (y ${(pl.y - sy).toFixed(2)})`);
}

console.log(fails ? `\nПРОВАЛОВ: ${fails}` : '\nv1.11: клавиши, конвейеры и коллизия в порядке');
process.exit(fails ? 1 : 0);

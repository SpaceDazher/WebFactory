// v1.15: пять встроенных испытаний. Все — «запустить ракету»; различаются картой и правилами.
import { Noise2D } from '../core/noise';
import { RNG } from '../core/rng';
import { newScenario, canonScn, Scenario } from '../sim/scenario';
import { GEN_LEGACY_VER } from '../sim/world';

/** карта «Острова»: 100×100, остров с пляжем, пять пятен ресурсов, нефтяные скважины и лес; вокруг — глубокая вода */
function islandEdits() {
  const R = 100, H = R / 2, nz = new Noise2D(1507), nf = new Noise2D(1508), rng = new RNG(1509);
  const edge = (x: number, y: number) => 40 + 4 * nz.fbm(x, y, 3, 1 / 18);
  const terrain: number[][] = [], res: number[][] = [], decor: number[][] = [];
  const kind = (x: number, y: number) => { const d = Math.hypot(x + 0.5, y + 0.5), e = edge(x, y); return d < e - 3 ? 0 : d < e ? 1 : d < e + 3 ? 3 : 4; };
  const patches: [number, number, number, number, number][] = [[-20, -12, 11, 1, 4800], [30, 3, 10, 1, 4200], [-30, 4, 7, 1, 4000], [17, -16, 10, 2, 4200], [-19, 17, 12, 3, 4000], [20, 17, 7, 4, 2800]];
  const taken = new Set<number>(); const K = (x: number, y: number) => (x + H) * R + (y + H);
  for (let y = -H; y < H; y++) {
    let x0 = -H, cur = kind(-H, y);
    for (let x = -H + 1; x <= H; x++) { const k = x < H ? kind(x, y) : -1; if (k !== cur) { terrain.push([y, x0, x - 1, cur]); x0 = x; cur = k; } }
  }
  for (const [px, py, pr, rt, rich] of patches) for (let y = py - pr - 3; y <= py + pr + 3; y++) for (let x = px - pr - 3; x <= px + pr + 3; x++) {
    const d = Math.hypot(x - px, y - py), e = pr * (1 + 0.2 * nf.get(x / 5 + rt * 50, y / 5)); if (d >= e || kind(x, y) >= 3) continue;
    res.push([y, x, x, rt, Math.floor(rich * (1.2 - d / e))]); taken.add(K(x, y));
  }
  for (const [wx, wy] of [[-6, -31], [0, -33], [6, -31], [-3, -28], [3, -28], [0, -30], [-9, -29], [9, -29]]) if (kind(wx, wy) < 3) { res.push([wy, wx, wx, 5, 120 + rng.int(180)]); taken.add(K(wx, wy)); }
  for (let y = -H; y < H; y++) for (let x = -H; x < H; x++) {
    if (kind(x, y) !== 0 || taken.has(K(x, y)) || Math.hypot(x, y) < 6) continue;
    const f = nf.fbm(x, y, 2, 1 / 16); const hv = rng.float();
    if (f > 0.1 && hv < (f - 0.05) * 0.5) decor.push([y, x, x, 1]); else if (hv > 0.995) decor.push([y, x, x, 2]);
  }
  return { terrain, res, decor };
}
const base = (id: string, name: string, desc: string, seed: number): Scenario => { const s = newScenario('z7-' + id, name); s.desc = desc; s.author = 'ЗАВОД-7'; s.seed = seed; return s; };
function build(): Scenario[] {
  const out: Scenario[] = [];
  const rocket = { k: 'rocket' as const, n: 1 };
  const a = base('rocket-8h', 'Ракета за 8 ч', 'Обычная карта, врагов нет. Запустите ракету не позже чем через 8 часов игры.', 1);
  a.rules.enemies = 'none'; a.rules.timeLimit = 480; a.goals = [rocket];
  out.push(a);
  const b = base('no-belts', 'Без конвейеров (только роботы)', 'Конвейеры, подземные конвейеры, разветвители и железная дорога запрещены. Всё нужно возить руками, манипуляторами и роботами. Цель — ракета.', 9);
  b.rules.enemies = 'peaceful'; b.rules.ban = ['type:belt', 'type:underground', 'type:splitter', 'type:rail', 'type:loco', 'type:wagon', 'type:stop', 'type:signal', 'type:tpump']; b.goals = [rocket];
  out.push(b);
  const c = base('island', 'Остров', 'Карта 100×100: остров с пятнами железа, меди, угля и камня, вокруг — глубокая вода. Мало места — стройте плотно. Цель — ракета.', 15070);
  c.map.base = 'blank'; c.genv = GEN_LEGACY_VER; c.map.bounds = { w: 100, h: 100 }; c.map.edits = islandEdits(); c.rules.enemies = 'peaceful'; c.rules.nests = 'none'; c.goals = [rocket];
  out.push(c);
  const d = base('deathworld', 'Смерть-мир', 'Мир смерти: гнёзда начинаются уже в 130 клетках от корабля и их в полтора раза больше, эволюция быстрее. Выживите и запустите ракету.', 1);
  d.rules.enemies = 'deathworld'; d.rules.nestMin = 130; d.rules.nestDens = 1.5; d.goals = [rocket];
  out.push(d);
  const e = base('trains', 'Только поезда', 'Конвейеры и роботы запрещены: грузы возят только поезда (и манипуляторы у станций). Цель — ракета.', 9);
  e.rules.enemies = 'peaceful'; e.rules.ban = ['type:belt', 'type:underground', 'type:splitter', 'type:roboport', 'construction-robot', 'logistic-robot', 'personal-roboport-equipment', 'personal-roboport-mk2-equipment', 'personal-roboport-mk3-equipment']; e.goals = [rocket];
  out.push(e);
  out.push(atomic());
  return out.map(s => canonScn(s)!);
}
/** v1.16: «Атомный пуск» — учебный сценарий: у игрока есть детали станции, уран ещё в земле, а бойлер холоден */
function atomic(): Scenario {
  const a = base('atomic', 'Атомный пуск', 'Чистая карта 100×100: озеро, урановое пятно в земле и готовая паровая станция без топлива. В рюкзаке — детали реактора, центрифуга и химзавод. Добудьте 100 урановой руды, сделайте 10 стержней, запустите реактор на 30+ МВт на целую минуту и переработайте 5 отработанных стержней. Испытательная нагрузка из 100 радаров находится на юго-востоке: подключите её к атомной станции. Подсказка: в окне чертежей есть кнопка «Добавить три чертежа станций».', 1160);
  a.map.base = 'blank'; a.genv = GEN_LEGACY_VER; a.map.bounds = { w: 100, h: 100 }; a.map.start = { x: 0, y: 0, w: 8, h: 8 };
  const lake: number[][] = []; for (let y = 6; y <= 20; y++) lake.push([y, -34, -22, 3]);
  const res: number[][] = [];
  const disc = (cx: number, cy: number, r: number, rt: number, rich: number) => { for (let y = cy - r; y <= cy + r; y++) { const w = Math.floor(Math.sqrt(r * r - (y - cy) * (y - cy))); res.push([y, cx - w, cx + w, rt, Math.floor(rich * (1.1 - Math.abs(y - cy) / (r + 1) * 0.5))]); } };
  disc(22, -14, 6, 6, 1200); disc(-12, -24, 4, 3, 2500);
  a.map.edits = { terrain: lake, res, decor: [] };
  // паровая станция: насос на берегу → труба → бойлер → два двигателя; без топлива, столб рядом
  a.map.ents = [
    { proto: 'offshore-pump', x: -28, y: 5, dir: 0 }, { proto: 'pipe', x: -28, y: 4, dir: 0 }, { proto: 'boiler', x: -31, y: 3, dir: 0 },
    { proto: 'steam-engine', x: -31, y: -2, dir: 0 }, { proto: 'steam-engine', x: -31, y: -7, dir: 0 }, { proto: 'small-electric-pole', x: -28, y: -3, dir: 0 },
  ];
  // 4 separate 25-radar banks; existing substations and big poles connect the load to one network.
  // Leave that network disconnected from the cold starter station so the challenge requires wiring the reactor to the load.
  const banks = [[6, 8], [28, 8], [6, 27], [28, 27]] as const;
  for (const [ox, oy] of banks) {
    a.map.ents.push({ proto: 'substation', x: ox + 8, y: oy + 8, dir: 0 });
    for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
      if ((row === 2 && col === 1) || (row === 2 || row === 3) && (col === 2 || col === 3)) continue;
      a.map.ents.push({ proto: 'radar', x: ox + col * 3, y: oy + row * 3, dir: 0 });
    }
  }
  // Wire reach 30, placed in the clear four-cell gaps between the radar banks.
  for (const [x, y] of [[24, 16], [24, 35], [14, 25]]) a.map.ents.push({ proto: 'big-electric-pole', x, y, dir: 0 });
  a.rules.enemies = 'none'; a.rules.nests = 'none'; a.rules.timeLimit = 120;
  a.rules.preTech = ['nuclear-fuel-reprocessing'];
  a.rules.startItems = {
    'coal': 600, 'iron-plate': 300, 'sulfur': 30, 'uranium-235': 2, 'uranium-238': 40,
    'electric-mining-drill': 4, 'centrifuge': 1, 'chemical-plant': 1, 'assembling-machine-2': 1, 'offshore-pump': 3,
    'nuclear-reactor': 1, 'heat-exchanger': 4, 'steam-turbine': 7, 'heat-pipe': 25, 'substation': 4,
    'pipe': 150, 'pipe-to-ground': 20, 'wooden-chest': 8, 'inserter': 12, 'small-electric-pole': 10, 'medium-electric-pole': 20,
  };
  a.goals = [{ k: 'produce', item: 'uranium-ore', n: 100 }, { k: 'produce', item: 'nuclear-fuel-cell', n: 10 }, { k: 'power', min: 30 }, { k: 'consume', item: 'used-nuclear-fuel-cell', n: 5 }];
  return a;
}
let cache: Scenario[] | null = null;
export const CHALLENGES = (): Scenario[] => cache || (cache = build());
export const CHALLENGE_IDS = ['z7-rocket-8h', 'z7-no-belts', 'z7-island', 'z7-deathworld', 'z7-trains', 'z7-atomic'];

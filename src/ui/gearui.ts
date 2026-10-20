// v1.14: окна «Снаряжение» (броня, сетка модулей, оружие и патроны, улучшения инженера), «Рой» (обзор, угрозы, виды)
// и панель персонажа внизу слева (здоровье, щит, энергия, оружие в руках).
import { ITEMS } from '../data/items';
import { BIO_LINING_LABELS } from '../data/biomaterials';
import { TECHS } from '../data/techs';
import type { Game } from '../sim/game';
import { kitOf, kitStats, maxHp, curGun, KIT_SLOTS, RAD_CAP, NR_CAP } from '../sim/combat';
import { radStatus } from '../sim/heat';
import { UNITS, attackDir, MUT_EVO, ELITE_EVO, MUT_HP, MUT_DMG, LOG_TICKS } from '../sim/enemies';
import { PROTOS } from '../data/entities';
import { droneInFlight, droneUsesBudget } from '../sim/mechanical-drones';
import { DRONE_MODELS } from '../sim/v117';
import { iconURL } from '../render/art';
import { tr } from '../core/i18n';
import { droneTransferControls } from './drone-transfer';

const TICKS = 60;
const attr = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const mmss = (t: number) => { const s = Math.max(0, Math.floor(t / TICKS)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const pct = (v: number) => Math.round(v * 100) + '%';
const DT_N: Record<string, string> = { phys: 'физ.', fire: 'огонь', laser: 'лазер', expl: 'взрыв', elec: 'электр.', acid: 'кислота' };
const SRC_N: Record<string, string> = { player: 'Инженер', fire: 'Огонь', other: 'Прочее', gun: 'Пулемётные турели', laser: 'Лазерные турели', flame: 'Огнемётные турели', rocket: 'Ракетные турели', tesla: 'Тесла-турели', mortar: 'Миномёты', art: 'Артиллерия', rail: 'Рельсотроны', wall: 'Стены' };
const ENG: [string, string, string][] = [['eng-health', 'Здоровье', 'ph'], ['eng-speed', 'Скорость бега', 'pm'], ['eng-mining', 'Добыча рукой', 'pmi'], ['eng-crafting', 'Ручной крафт', 'pc'], ['eng-reach', 'Дальность стройки', 'pr'], ['eng-regen', 'Регенерация', 'pg']];
const EQ_N: Record<string, string> = { solar: 'выработка', reactor: 'выработка', battery: 'запас', shield: 'щит', laser: 'оружие', rocket: 'оружие', drones: 'оружие', exo: 'скорость', roboport: 'роботы', rad: 'защита от радиации', nreactor: 'ядерный, 500 кВт' };
let v117CommandSerial = 0;

export interface GearHooks { game(): Game; render(): void; mapAt(x: number, y: number): void; artPick(): void; }
export class GearUI {
  modSel: string | null = null; swTab: 'over' | 'threat' | 'species' = 'over';
  constructor(private h: GearHooks) {}
  private get g() { return this.h.game(); }
  // ---------- панель персонажа ----------
  heroPanel(gearKey: string, swarmKey: string): string {
    const g = this.g; const pl = g.player; const k = kitOf(pl); const s = kitStats(k); const mh = maxHp(g);
    const bar = (cls: string, v: number, max: number, lbl: string) => `<div class="hbar ${cls}" title="${lbl}"><i style="width:${max ? Math.min(100, v / max * 100).toFixed(0) : 0}%"></i><span>${lbl}: ${Math.ceil(v)} / ${Math.ceil(max)}</span></div>`;
    let h = `<div class="hp-row">${k.armor ? `<img class="arm" src="${iconURL(k.armor)}" data-tip="item:${k.armor}">` : '<div class="arm none">🦺</div>'}<div style="flex:1">`;
    h += bar('hp', pl.hp, mh, 'Здоровье');
    if (s.shMax) h += bar('sh', k.sh, s.shMax, 'Щит');
    if (s.cap) h += bar('en', k.en / 1e6, s.cap / 1e6, 'Энергия, МДж');
    h += `</div></div>`;
    { const rs = radStatus(g, pl); if (rs.raw > 0.01) h += `<div class="radhud ${rs.net > 1 ? 'err' : rs.net > 0.2 ? 'warn' : ''}" title="Радиация урановой руды, аварийных зон и следов боеприпасов">☢ Радиация: −${rs.net.toFixed(2)} ед/с${rs.prot ? ` (защита ${Math.round(rs.prot * 100)}%)` : ' — без защиты'}${rs.net * 20 > pl.hp ? ' · смертельно за 20 с!' : rs.net > 0.2 && rs.prot < 0.5 ? ' · наденьте радиационный костюм' : ''}</div>`; else if (s.rad) h += `<div class="small dim">☢ Защита от радиации ${Math.round(s.rad * 100)}%</div>`; }
    if (pl.dead) h += `<div class="err">Инженер погиб · возрождение через ${Math.ceil(pl.respawn / 60)} с</div>`;
    h += `<div class="guns"><button data-act="holster" class="gbtn ${k.hid ? 'on' : ''}" title="${k.hid ? 'Достать оружие' : 'Убрать оружие'}">${k.hid ? '🔫' : '✋'}</button>`;
    const cg = curGun(k);
    for (let i = 0; i < KIT_SLOTS; i++) {
      const gun = k.guns[i]; const am = k.ammo[i];
      h += `<div class="gslot ${i === cg ? 'sel' : ''}" data-act="ksel" data-i="${i}">${gun ? `<img src="${iconURL(gun)}" data-tip="item:${gun}">` : '<span class="dim">—</span>'}${am ? `<img class="am" src="${iconURL(am.item)}"><span class="cnt">${am.count}</span>` : gun ? '<span class="cnt err">0</span>' : ''}</div>`;
    }
    h += `<button data-act="gearopen" class="gbtn" title="Снаряжение">🎒 <kbd>${gearKey}</kbd></button><button data-act="swarmopen" class="gbtn" title="Рой">☣ <kbd>${swarmKey}</kbd></button></div>`;
    if (g.settings.enemies !== 'none') { const att = g.sw.att.some(a => a.end == null); h += `<div class="sub">Эволюция ${(g.evolution * 100).toFixed(1)}%${g.mut ? ` · мутация ${g.mut}` : ''}${att ? ' · <span class="err">атака!</span>' : ''}</div>`; }
    return h;
  }
  // ---------- снаряжение ----------
  gearHtml(): string {
    const g = this.g; const k = kitOf(g.player); const s = kitStats(k); const inv = g.inv;
    const invOf = (f: (id: string) => boolean) => { const seen = new Set<string>(); const out: string[] = []; for (const sl of inv.slots) if (sl && !seen.has(sl.item) && f(sl.item)) { seen.add(sl.item); out.push(sl.item); } return out; };
    const ic = (id: string, act: string, extra = '', n?: number) => `<div class="slot" data-act="${act}" data-item="${id}" ${extra} data-tip="item:${id}"><img src="${iconURL(id)}">${n != null ? `<span class="cnt">${fmt(n)}</span>` : ''}</div>`;
    let h = `<div class="panel gear"><div class="title">Снаряжение инженера<span class="x" data-act="close">✕</span></div><div class="gearcols"><div class="gcol">`;
    // броня
    const A = k.armor ? ITEMS[k.armor].armor! : null;
    h += `<h4>Броня</h4><div class="row">${k.armor ? `<div class="slot big" data-act="karm" data-item="" data-tip="item:${k.armor}" title="Снять"><img src="${iconURL(k.armor)}"></div>` : '<div class="slot big empty">🦺</div>'}<div class="small">${A ? `${ITEMS[k.armor!].name}<br>+${A.hp} здоровья · −${pct(A.pct)}, −${A.flat} урона${A.grid ? `<br>Сетка модулей ${A.grid[0]}×${A.grid[1]}` : '<br>Без сетки модулей'}` : 'Без брони'}</div></div>`;
    const arms = invOf(id => !!ITEMS[id].armor);
    h += arms.length ? `<div class="small dim">Надеть:</div><div class="grid g8">${arms.map(id => ic(id, 'karm', '', inv.count(id))).join('')}</div>` : '<div class="small dim">Броню делают в сборщике или вручную (вкладка «Бой»).</div>';
    // сетка
    if (A?.grid) {
      const [W, H] = A.grid; const Z = W > 7 ? 26 : 32;
      h += `<h4>Модули брони <button data-act="kauto" class="sm">Разложить автоматически</button></h4><div class="egrid" style="width:${W * Z}px;height:${H * Z}px;background-size:${Z}px ${Z}px">`;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) h += `<div class="ecell" data-act="kcell" data-x="${x}" data-y="${y}" style="left:${x * Z}px;top:${y * Z}px;width:${Z}px;height:${Z}px"></div>`;
      k.grid.forEach((m, i) => { const d = ITEMS[m.id].equip!; const w = d.w || 1, hh = d.h || 1; h += `<div class="emod k-${d.kind}" data-act="kunmod" data-i="${i}" data-tip="item:${m.id}" title="Снять" style="left:${m.x * Z + 1}px;top:${m.y * Z + 1}px;width:${w * Z - 2}px;height:${hh * Z - 2}px"><img src="${iconURL(m.id)}" style="width:${Math.min(w, hh) * Z * .7}px"></div>`; });
      h += `</div>`;
      if (s.activeLining) h += k.grid.map((m, i) => {
        const item = ITEMS[m.id], effect = item.bioLining;
        if (item.equip?.kind !== 'lining') return '';
        const active = i === s.activeLining!.i;
        return `<div class="small ${active ? '' : 'dim'}">${tr(item.name)} · ${tr(active ? 'Активная биоподкладка' : 'Неактивна: действует другая биоподкладка')}${effect ? ' · ' + tr(BIO_LINING_LABELS[`${effect.kind}:${effect.amount}`] || '') : ''}</div>`;
      }).join('');
      const mods = invOf(id => !!ITEMS[id].equip?.w);
      h += mods.length ? `<div class="small dim">Выберите модуль и щёлкните клетку сетки (повторный щелчок по модулю — в первую свободную клетку):</div><div class="grid g8">${mods.map(id => ic(id, 'kmodsel', this.modSel === id ? 'style="outline:2px solid #e8c22e"' : '', inv.count(id))).join('')}</div>` : '<div class="small dim">Модулей в инвентаре нет.</div>';
    }
    const bioControl = k.grid.some(m => ITEMS[m.id]?.equip?.kind === 'bio-control');
    if (bioControl) h += `<div class="small dim">Переносной биопульт 2×2 · 20 кВт при управлении отрядом · заряд ${(k.en / 1e6).toFixed(2)} МДж</div>`;
    if (s.personalPort) {
      h += k.grid.map((m, index) => ITEMS[m.id]?.equip?.kind === 'drone-port' ? `<div class="small ${index === s.personalPort!.index ? '' : 'dim'}">${tr(ITEMS[m.id].name)} · ${tr(index === s.personalPort!.index ? 'Активный личный боевой порт' : 'Неактивен: действует другой личный боевой порт')}</div>` : '').join('');
      const parked = k.grid[s.personalPort.index]?.drones || [], who = g.v117.playerIds[g.pl] || `player-${g.pl + 1}`;
      const active = g.v117.drones.instances.filter(d => d.owner === who && d.source === 'personal' && droneUsesBudget(d));
      const physical = invOf(id => !!ITEMS[id].droneModel);
      const module = k.grid[s.personalPort.index];
      h += `<h4>Личный боевой порт</h4><div class="small dim">3×3 · до 4 машин в стоянке и 4 развёрнутые боевые единицы · управление 20 кВт · зарядка до 150 кВт</div>`;
      h += `<div class="row2"><button data-act="drone-port-auto" data-enabled="${module.droneAuto === false ? '1' : '0'}">${tr('Автовыпуск')}: ${tr(module.droneAuto === false ? 'Выключен' : 'Включён')}</button><span>${tr('Приоритет вылета')}:</span><button data-act="drone-port-priority" data-item=""${module.dronePriority == null ? ' disabled' : ''}>${tr('Автоматически')}</button>${Object.keys(DRONE_MODELS).map(model => `<button class="sm" data-act="drone-port-priority" data-item="${model}" title="${attr(tr(ITEMS[`combat-drone-${model}`].name))}"${module.dronePriority === model ? ' disabled' : ''}><img src="${iconURL(`combat-drone-${model}`)}" alt="${attr(tr(ITEMS[`combat-drone-${model}`].name))}"></button>`).join('')}</div>`;
      h += parked.length ? parked.map(d => `<div class="row2"><span>${ITEMS[`combat-drone-${d.model}`]?.name || d.model} #${d.id} · ${Math.ceil(d.hp)}/${d.maxHp} HP · ${(d.charge / 1e6).toFixed(2)} МДж${d.ammoType ? ` · боезапас ${d.ammo}` : ''}</span><button data-act="drone-port-launch" data-id="${d.id}">Запустить</button>${droneTransferControls(g, d.id)}</div>`).join('') : `<div class="small dim">Стоянка пуста.</div>`;
      h += physical.length ? `<div class="grid g8 wcand">${physical.map(id => `<button class="sm" data-act="drone-port-load" data-item="${id}" title="${ITEMS[id].name}">Загрузить ${ITEMS[id].name} ×${inv.count(id)}</button>`).join('')}</div>` : '';
      h += active.length ? `<div class="row2"><span>${tr('Развёрнуто:')} ${active.length} · ${active.reduce((n, d) => n + DRONE_MODELS[d.model].units, 0)}/4 ${tr('боевых единиц')}</span><button data-act="drone-port-return-all"${active.some(droneInFlight) ? '' : ' disabled'}>Вернуть всех</button></div>` : `<div class="small dim">Личных дронов в мире нет.</div>`;
      for (const d of active) h += `<div class="row2"><span>#${d.id} · ${attr(tr(ITEMS[`combat-drone-${d.model}`]?.name || d.model))} · ${tr(droneInFlight(d) ? 'В полёте' : 'На земле')}</span>${droneInFlight(d) ? '' : `<button data-act="drone-port-recover" data-id="${d.id}"${Math.hypot(d.x - g.player.x, d.y - g.player.y) <= 4 ? '' : ' disabled'}>${tr('Подобрать дрон')}</button>`}${droneTransferControls(g, d.id)}</div>`;
    }
    h += `</div><div class="gcol">`;
    // оружие
    h += `<h4>Оружие и патроны</h4>`; const cg = curGun(k);
    for (let i = 0; i < KIT_SLOTS; i++) {
      const gun = k.guns[i]; const am = k.ammo[i]; const G = gun ? ITEMS[gun].gun! : null;
      h += `<div class="wrow ${i === cg ? 'sel' : ''}"><b>${i + 1}</b>${gun ? `<div class="slot" data-act="kgun" data-i="${i}" data-item="" title="Снять" data-tip="item:${gun}"><img src="${iconURL(gun)}"></div>` : '<div class="slot empty"></div>'}${am ? `<div class="slot" data-act="kammo" data-i="${i}" data-item="" title="Снять" data-tip="item:${am.item}"><img src="${iconURL(am.item)}"><span class="cnt">${am.count}</span></div>` : '<div class="slot empty"></div>'}`;
      h += `<div class="small">${G ? `${ITEMS[gun!].name}<br>${G.rate} выстр./с · дальность ${G.range}${G.pellets ? ` · дробь ×${G.pellets}` : ''}${k.rnd[i] ? ` · в стволе ${k.rnd[i]}` : ''}` : 'Пусто'}</div></div>`;
      const guns = invOf(id => !!ITEMS[id].gun); const ams = gun ? invOf(id => !!ITEMS[id].am && ITEMS[id].am!.cat === (G!.cat || 'bullet')) : [];
      if (guns.length || ams.length) h += `<div class="grid g8 wcand">${guns.map(id => ic(id, 'kgun', `data-i="${i}"`, inv.count(id))).join('')}${ams.map(id => ic(id, 'kammo', `data-i="${i}"`, inv.count(id))).join('')}</div>`;
    }
    h += `<div class="small dim">X — следующее оружие. Огонь — в любую точку под курсором; рядом с врагом прицел доводится сам.</div>`;
    // v1.17 contact weapons use the same pointer attack input and shared recovery timer.
    const playerId = g.v117.playerIds[g.pl] || `player-${g.pl + 1}`;
    const melee = g.v117.melee[playerId] || { weapon: null, charges: 0, cooldown: 0, windup: 0 };
    const meleeItems = invOf(id => !!ITEMS[id].melee);
    const meleeIcon = (id: string | null, title: string) => id && ITEMS[id]
      ? `<div class="slot big" data-tip="item:${id}"><img src="${iconURL(id)}"></div><b>${title}</b>`
      : `<div class="slot big empty">⚔</div><span class="dim">Не экипировано</span>`;
    h += `<h4>Контактное оружие</h4><div class="row">${meleeIcon(melee.weapon, melee.weapon ? ITEMS[melee.weapon].name : '')}<span class="small">${melee.weapon ? `Заряд ${melee.charges}/20 · ${melee.cooldown ? `восстановление ${Math.ceil(melee.cooldown / TICKS)} с` : 'готово'}${melee.windup ? ` · замах ${Math.ceil(melee.windup / TICKS)} с` : ''}` : 'Выберите изготовленное оружие из инвентаря.'}</span><button data-act="melee-equip" data-item="">Убрать</button></div>`;
    if (meleeItems.length) h += `<div class="grid g8 wcand">${meleeItems.map(id => `<div class="slot ${melee.weapon === id ? 'sel' : ''}" data-act="melee-equip" data-item="${id}" data-tip="item:${id}"><img src="${iconURL(id)}"><span class="cnt">${inv.count(id)}</span></div>`).join('')}</div>`;
    h += `<div class="small dim">Удар — штатным огнём по курсору. Заряжаемое оружие автоматически расходует лазерную ячейку при начале удара. Смена оружия отменяет оплаченный замах, сохраняя общее время восстановления.</div>`;
    // характеристики
    h += `<h4>Характеристики</h4><div class="kvs small">`;
    const row = (a: string, b: string) => `<div><span>${a}</span><b>${b}</b></div>`;
    h += row('Здоровье', `${Math.ceil(g.player.hp)} / ${maxHp(g)}`) + row('Снижение урона', `−${pct(s.pct)}, −${s.flat}`);
    if (s.shMax) h += row('Щит', `${Math.ceil(k.sh)} / ${s.shMax} (+${s.shRegen} ед/с)`);
    if (s.cap) h += row('Энергия', `${(k.en / 1e6).toFixed(1)} / ${(s.cap / 1e6).toFixed(0)} МДж`) + row('Выработка', `${s.gen} кВт`);
    h += row('Защита от радиации', s.rad ? `${Math.round(s.rad * 100)}% (предел ${Math.round(RAD_CAP * 100)}%)` : 'нет');
    if (s.exo) h += row('Экзоскелеты', `+${pct(s.exo)} скорости`);
    if (s.robo) h += row('Личные роботы', `${s.robo.robots} · зона ${s.robo.zone}`);
    for (const m of s.mods) h += row(ITEMS[k.grid[m.i].id].name, `${EQ_N[m.d.kind] || ''} ${m.d.dmg ? `${m.d.dmg} урона, ${m.d.range} клеток` : ''}`);
    k.grid.forEach((m, i) => { if (ITEMS[m.id].equip?.kind !== 'nreactor') return; h += `<div class="nrbox small"><b>Личный ядерный реактор</b> · ${(m.r || 0) > 0 ? `работает, остаток цикла ${Math.ceil((m.r || 0) / 60)} с из 200 · 500 кВт` : (m.w || 0) >= NR_CAP ? '<span class="err">отходы заполнены — новый цикл не начнётся</span>' : (m.n || 0) ? 'ожидает цикла' : 'нет стержня'}<br>Стержней в слоте: ${m.n || 0}/${NR_CAP} · отходов: ${m.w || 0}/${NR_CAP} <button class="sm" data-act="nrfeed" data-i="${i}">+ Загрузить стержни</button> <button class="sm" data-act="nrtake" data-i="${i}">Забрать отходы</button><div class="dim">Часть энергии стержня уходит в потери компактной установки; снятие активного модуля — аварийная остановка (один отход).</div></div>`; });
    h += `</div>`;
    // улучшения инженера
    h += `<h4>Улучшения инженера</h4><div class="kvs small">`;
    for (const [id, name, key] of ENG) { let n = 0; for (let i = 1; i <= 5; i++) if (g.research.done.has(`${id}-${i}`)) n = i; const b = g.bonus(key);
      h += `<div><span>${name}</span><span class="elv">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span><b>${key === 'pm' || key === 'pmi' || key === 'pc' ? '+' + pct(b) : '+' + (Math.round(b * 10) / 10)}</b></div>`; }
    h += `</div><div class="small dim">Улучшения открываются исследованиями «${TECHS['eng-health-1']?.name.replace(/ 1$/, '') || 'Здоровье инженера'}» и др. (5 уровней).</div>`;
    h += `</div></div></div>`;
    return h;
  }
  // ---------- Рой ----------
  swarmHtml(): string {
    const g = this.g; const sw = g.sw; const T = this.swTab;
    let h = `<div class="panel swarm"><div class="title">Рой<span class="x" data-act="close">✕</span></div><div class="tabs">${([['over', 'Обзор'], ['threat', 'Угрозы'], ['species', 'Виды']] as const).map(([k, n]) => `<button data-act="swtab" data-v="${k}" class="${T === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    if (g.settings.enemies === 'none') return h + `<div class="dim">Рой отключён в настройках мира.</div></div>`;
    if (T === 'over') {
      let nN = 0, nW = 0; for (const e of g.ents.values()) if (e.t === 'nest') { if (PROTOS[e.proto].enemy?.worm) nW++; else nN++; } const ev = g.evolution;
      const phase = ev >= MUT_EVO ? 'Мутации: Рой крепнет каждые 20 минут, приходит Королева' : ev >= ELITE_EVO ? 'Элита: в волнах — усиленные особи' : ev >= 0.5 ? 'Поздний Рой: большие и бронированные особи' : ev >= 0.2 ? 'Средний Рой: плевуны и средние ползуны' : 'Ранний Рой: малые ползуны';
      h += `<div class="kvs"><div><span>Эволюция</span><b>${(ev * 100).toFixed(2)}%</b></div><div class="bar"><i style="width:${(ev * 100).toFixed(1)}%"></i></div><div class="small">${phase}</div>`;
      if (g.mut || ev >= MUT_EVO) h += `<div><span>Уровень мутации</span><b>${g.mut || 0} (+${Math.round(MUT_HP * 100 * (g.mut || 0))}% здоровья, +${Math.round(MUT_DMG * 100 * (g.mut || 0))}% урона)</b></div>${g.mutT ? `<div><span>Следующая мутация через</span><b>${mmss(g.mutT - g.tick)}</b></div>` : ''}`;
      h += `<div><span>Гнёзд на карте</span><b>${nN}</b></div><div><span>Червей на карте</span><b>${nW}</b></div><div><span>Особей сейчас</span><b>${g.units.length}</b></div></div>`;
      // история эволюции
      const H = sw.evoH; if (H.length > 1) { const w = 360, hh = 70, n = H.length; const pts = H.map((v, i) => `${(i / (n - 1) * w).toFixed(1)},${(hh - v * hh).toFixed(1)}`).join(' ');
        h += `<h4>Эволюция по минутам</h4><svg width="${w}" height="${hh}" class="evochart"><polyline points="${pts}" fill="none" stroke="#c060d0" stroke-width="2"/><line x1="0" x2="${w}" y1="${hh * (1 - ELITE_EVO)}" y2="${hh * (1 - ELITE_EVO)}" stroke="#e8c22e" stroke-dasharray="3 3"/></svg><div class="small dim">${n} мин · жёлтая линия — порог элиты (95%)</div>`; }
      h += `<h4>Итоги</h4><div class="kvs small"><div><span>Атак всего</span><b>${sw.total}</b></div><div><span>Уничтожено гнёзд</span><b>${sw.nests}</b></div><div><span>Уничтожено червей</span><b>${sw.worms}</b></div><div><span>Убито королев</span><b>${sw.queens}</b></div><div><span>Гнёзд отросло на слизи</span><b>${sw.regrown}</b></div><div><span>Выжжено клеток слизи</span><b>${sw.burned || 0}</b></div></div>`;
      const kl = Object.entries(sw.kills).sort((a, b) => b[1] - a[1]); const by = Object.entries(sw.by).sort((a, b) => b[1] - a[1]); const lost = Object.entries(sw.lost).sort((a, b) => b[1] - a[1]).slice(0, 10);
      h += `<div class="gearcols"><div class="gcol"><h4>Убито особей</h4><div class="kvs small">${kl.map(([k, n]) => `<div><span>${UNITS[k]?.name || k}</span><b>${fmt(n)}</b></div>`).join('') || '<span class="dim">пока никого</span>'}</div></div>`;
      h += `<div class="gcol"><h4>Чем убиты</h4><div class="kvs small">${by.map(([k, n]) => `<div><span>${SRC_N[k] || PROTOS[k]?.name || k}</span><b>${fmt(n)}</b></div>`).join('') || '<span class="dim">—</span>'}</div>`;
      h += `<h4>Потери построек</h4><div class="kvs small">${lost.map(([k, n]) => `<div><span>${PROTOS[k]?.name || k}</span><b>${n}</b></div>`).join('') || '<span class="dim">потерь нет</span>'}</div></div></div>`;
    } else if (T === 'threat') {
      const now = g.tick; const list = sw.att.filter(a => now - a.t <= LOG_TICKS).slice().reverse();
      h += `<div class="row2"><button data-act="artpick">🎯 Залп артиллерии по точке на карте</button></div>`;
      h += list.length ? `<table class="sw"><tr><th>Когда</th><th>Откуда</th><th>Кто</th><th>Особей</th><th>Убито</th><th>Потери</th><th></th></tr>${list.map(a => `<tr class="${a.end == null ? 'live' : ''}"><td>${a.end == null ? '<span class="err">идёт</span>' : mmss(now - a.t) + ' назад'}</td><td>${attackDir(a)}</td><td>${a.q ? '👑 ' : ''}${UNITS[a.k]?.name || a.k}${a.el ? ` · элита ${a.el}` : ''}</td><td>${a.n}</td><td>${a.killed}</td><td>${a.lost ? `<span class="err">${a.lost}</span>` : '0'}</td><td><button class="sm" data-act="swmap" data-x="${a.tx}" data-y="${a.ty}">Показать на карте</button><button class="sm" data-act="swart" data-x="${a.x}" data-y="${a.y}" title="Залп по гнезду, откуда пришла атака">🎯</button></td></tr>`).join('')}</table>` : '<div class="dim">За последний час атак не было.</div>';
      // направления
      const dirs: Record<string, number> = {}; for (const a of list) { const d = attackDir(a); dirs[d] = (dirs[d] || 0) + 1; }
      const dl = Object.entries(dirs).sort((a, b) => b[1] - a[1]);
      if (dl.length) h += `<h4>Направления атак за час</h4><div class="kvs small">${dl.map(([d, n]) => `<div><span>${d}</span><b>${n}</b></div>`).join('')}</div>`;
      h += `<div class="small dim">Значки атак видны на мини-карте и большой карте (M). Артиллерия стреляет по точке, если в радиусе есть заряженные артиллерийские турели или вагоны.</div>`;
    } else {
      h += `<div class="species">`;
      for (const [k, d] of Object.entries(UNITS)) {
        const open = g.evolution >= d.evo || (g.sw.kills[k] || 0) > 0; const tags: string[] = [];
        if (d.ranged) tags.push('дальний бой'); if (d.fly) tags.push('летает над стенами'); if (d.boom) tags.push('взрывается'); if (d.brood) tags.push(`выводок ×${d.brood}`); if (d.boss) tags.push('босс');
        const res = Object.entries(d.res || {}).map(([t, v]) => `${DT_N[t] || t} ${v! > 0 ? '−' : '+'}${pct(Math.abs(v!))}`).join(', ');
        h += `<div class="sp ${open ? '' : 'locked'}"><div class="spdot" style="background:${d.color}"></div><div><b>${open ? d.name : '???'}</b> <span class="dim small">с эволюции ${pct(d.evo)}</span>${open ? `<div class="small">${d.desc || ''}</div><div class="small dim">Здоровье ${d.hp} · урон ${d.dmg} · скорость ${(d.speed * TICKS).toFixed(1)} кл/с${tags.length ? ' · ' + tags.join(', ') : ''}${res ? ` · сопротивления: ${res}` : ''} · убито ${g.sw.kills[k] || 0}</div>` : ''}</div></div>`;
      }
      h += `</div>`;
    }
    return h + `</div>`;
  }
  /** действия окон; true — обработано */
  act(a: string, el: HTMLElement, rmb: boolean): boolean {
    const g = this.g; const send = (c: any) => g.enqueue({ t: 'kit', ...c });
    switch (a) {
      case 'melee-equip': g.enqueue({ t: 'v117', section: 'melee', op: 'equip', weapon: el.dataset.item || null, opId: `ui-${Date.now()}-${++v117CommandSerial}` }); break;
      case 'drone-port-load': g.enqueue({ t: 'v117', section: 'drones', op: 'personal-load', item: el.dataset.item, opId: `ui-${g.tick}-${++v117CommandSerial}` }); break;
      case 'drone-port-launch': g.enqueue({ t: 'v117', section: 'drones', op: 'personal-launch', droneId: Number(el.dataset.id), opId: `ui-${g.tick}-${++v117CommandSerial}` }); break;
      case 'drone-port-auto': g.enqueue({ t: 'v117', section: 'drones', op: 'personal-configure', autoLaunch: el.dataset.enabled === '1', opId: `ui-${g.tick}-${++v117CommandSerial}` }); break;
      case 'drone-port-priority': g.enqueue({ t: 'v117', section: 'drones', op: 'personal-configure', priority: el.dataset.item || null, opId: `ui-${g.tick}-${++v117CommandSerial}` }); break;
      case 'drone-transfer': { const id = Number(el.dataset.id), target = Number((document.getElementById(`drone-transfer-${id}`) as HTMLSelectElement | null)?.value); g.enqueue({ t: 'v117', section: 'drones', op: 'transfer', droneId: id, player: target, opId: `ui-${g.tick}-${++v117CommandSerial}` }); break; }
      case 'drone-port-return-all': g.enqueue({ t: 'v117', section: 'drones', op: 'return-all', opId: `ui-${g.tick}-${++v117CommandSerial}` }); break;
      case 'drone-port-recover': g.enqueue({ t: 'v117', section: 'drones', op: 'recover', droneId: Number(el.dataset.id), opId: `ui-${g.tick}-${++v117CommandSerial}` }); break;
      case 'karm': send({ op: 'armor', item: el.dataset.item || null }); break;
      case 'kauto': send({ op: 'autoMods' }); break;
      case 'kmodsel': { const id = el.dataset.item!; if (this.modSel === id || rmb) send({ op: 'mod', item: id }); else this.modSel = id; break; }
      case 'kcell': { if (!this.modSel) return true; send({ op: 'mod', item: this.modSel, x: +el.dataset.x!, y: +el.dataset.y! }); if (g.inv.count(this.modSel) <= 1) this.modSel = null; break; }
      case 'nrfeed': send({ op: 'nrfeed', i: +el.dataset.i! }); break;
      case 'nrtake': send({ op: 'nrtake', i: +el.dataset.i! }); break;
      case 'kunmod': send({ op: 'unmod', i: +el.dataset.i! }); break;
      case 'kgun': send({ op: 'gun', slot: +el.dataset.i!, item: el.dataset.item || null }); break;
      case 'kammo': send({ op: 'ammo', slot: +el.dataset.i!, item: el.dataset.item || null }); break;
      case 'holster': send({ op: 'holster' }); break;
      case 'ksel': send({ op: 'sel', slot: +el.dataset.i! }); break;
      case 'swtab': this.swTab = el.dataset.v as any; break;
      case 'swmap': this.h.mapAt(+el.dataset.x!, +el.dataset.y!); return true;
      case 'swart': g.enqueue({ t: 'artillery', x: +el.dataset.x!, y: +el.dataset.y! }); break;
      case 'artpick': this.h.artPick(); return true;
      default: return false;
    }
    setTimeout(() => this.h.render(), 60); return true;
  }
}
export const _tr = tr;

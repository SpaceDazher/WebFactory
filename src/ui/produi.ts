// v1.9: окна «Статистика производства 2.0» (P) и «Калькулятор». Данные статистики считает Worker (statsView) —
// в главный поток приходят только суммы выбранного окна и ряды для графиков; запрос — раз в секунду, пока окно открыто.
import { ITEMS, ITEM_LIST } from '../data/items';
import { PROTOS } from '../data/entities';
import { RECIPES } from '../data/recipes';
import { iconURL } from '../render/art';
import { TIER_NAMES, StatsView, Tab } from '../sim/prodstats';
import { energyPlan, calculate, recipeFor, CalcOpts, DEFAULT_CALC, calcText, fmtN, fmtKW, ModKind } from '../sim/calc';
import type { Game } from '../sim/game';
import { tr } from '../core/i18n';

export interface ProdHooks { statsView(tier: number, tab: Tab, sel: string | null): Promise<StatsView | null>; game(): Game; render(): void; note(title: string, text: string): void; calcOpen(): void; }
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const recipeItem = (id: string) => RECIPES[id]?.out[0]?.[0] || RECIPES[id]?.in[0]?.[0];
const nm = (id: string) => id === 'lab' ? 'Лаборатория' : ITEMS[id]?.name || PROTOS[id]?.name || RECIPES[id]?.name || (recipeItem(id) ? ITEMS[recipeItem(id)!]?.name : '') || id;
const icon = (id: string) => ITEMS[id] ? `<img src="${iconURL(id)}">` : recipeItem(id) ? `<img src="${iconURL(recipeItem(id)!)}">` : '';
const TABS: [Tab, string][] = [['items', 'Предметы'], ['fluids', 'Жидкости'], ['energy', 'Энергия'], ['bottlenecks', 'Узкие места']];
/** кВт из кДж за окно */
const kwOf = (kJ: number, sec: number) => sec > 0 ? kJ / sec : 0;

export class ProdUI {
  tier = 0; tab: Tab = 'items'; sel: string | null = null; data: StatsView | null = null; private pending = false; private lastReq = 0; private want = '';
  calcItem = 'electronic-circuit'; calcRate = 60; calcOpts: CalcOpts = { ...DEFAULT_CALC }; calcFrom: 'stats' | 'recipe' | 'key' = 'key'; calcTab: 'prod' | 'energy' = 'prod'; calcCols = 2; calcRows = 2;
  constructor(private h: ProdHooks) {}
  /** запрос данных (не чаще раза в секунду; при смене вкладки — сразу) */
  private poll() {
    const key = `${this.tier}|${this.tab}|${this.sel}`; const now = performance.now();
    if (this.pending || (key === this.want && now - this.lastReq < 1000)) return;
    this.pending = true; this.lastReq = now; this.want = key;
    this.h.statsView(this.tier, this.tab, this.sel).then(v => { this.pending = false; if (v) { this.data = v; this.h.render(); } }, () => { this.pending = false; });
  }
  statsHtml(extra = ''): string {
    this.poll();
    const v = this.data && this.data.tier === this.tier && this.data.tab === this.tab ? this.data : null;
    const tiers = TIER_NAMES.map((l, i) => `<div class="tab ${this.tier === i ? 'on' : ''}" data-act="ps-tier" data-v="${i}">${l}</div>`).join('');
    const tabs = TABS.map(([k, l]) => `<div class="tab ${this.tab === k ? 'on' : ''}" data-act="ps-tab" data-v="${k}">${l}</div>`).join('');
    let body = '<div class="dim">Сбор данных…</div>';
    if (v) {
      const min = v.sec / 60;
      if (!v.sec) body = '<div class="dim">Статистика этого окна копится: первая точка — через ' + ['1 с', '12 с', '2 мин', '10 мин'][this.tier] + '</div>';
      else if (this.tab === 'bottlenecks') body = this.bottHtml(v);
      else if (this.tab === 'energy') {
        const mx = Math.max(1, ...v.rows.map(r => Math.max(r.p, r.c)));
        const prod = v.rows.filter(r => r.p > 0), cons = v.rows.filter(r => r.c > 0);
        const tp = prod.reduce((a, r) => a + r.p, 0), tc = cons.reduce((a, r) => a + r.c, 0);
        const row = (r: { id: string; p: number; c: number }, k: 'p' | 'c') => `<tr><td>${icon(r.id)} ${nm(r.id)}</td><td class="${k === 'p' ? 'pr' : 'co'}"><i style="width:${r[k] / mx * 100}%"></i>${fmtKW(kwOf(r[k], v.sec))}</td></tr>`;
        body = `<div class="row2">Выработка в среднем: <b>${fmtKW(kwOf(tp, v.sec))}</b> · потребление: <b>${fmtKW(kwOf(tc, v.sec))}</b></div>
          <div class="cols2"><div><div class="lbl">Выработка</div><table class="stats">${prod.map(r => row(r, 'p')).join('') || '<tr><td class="dim">нет</td></tr>'}</table></div>
          <div><div class="lbl">Потребление</div><table class="stats">${cons.map(r => row(r, 'c')).join('') || '<tr><td class="dim">нет</td></tr>'}</table></div></div>`;
      } else {
        const unit = this.tab === 'fluids' ? 'ед/мин' : 'шт/мин';
        const mx = Math.max(1, ...v.rows.map(r => Math.max(r.p, r.c) / min));
        const rows = v.rows.map(r => { const p = r.p / min, c = r.c / min, b = p - c;
          return `<tr data-act="ps-sel" data-k="${r.id}" class="${this.sel === r.id ? 'sel' : ''}"><td>${icon(r.id)} ${nm(r.id)}</td><td class="pr"><i style="width:${p / mx * 100}%"></i>${fmtN(p)}</td><td class="co"><i style="width:${c / mx * 100}%"></i>${fmtN(c)}</td><td class="${b < -1e-6 ? 'err' : 'dim'}">${b > 0 ? '+' : ''}${fmtN(b)}</td><td>${recipeFor(r.id) ? `<button class="mini" data-act="ps-calc" data-k="${r.id}" data-r="${Math.max(1, Math.round(c || p))}" title="Калькулятор">🧮</button>` : ''}</td></tr>`; }).join('');
        let chart = '';
        const sr = v.rows.find(r => r.id === this.sel && r.series);
        if (sr) {
          const k = 60 / ([1, 12, 120, 600][this.tier]); const pp = sr.series!.map(x => x * k), cc = (sr.cs || []).map(x => x * k); const B = pp.length;
          const m = Math.max(1, ...pp, ...cc); const line = (arr: number[], col: string) => `<polyline fill="none" stroke="${col}" stroke-width="1.2" vector-effect="non-scaling-stroke" points="${arr.map((x, i) => `${(i / Math.max(1, B - 1) * 100).toFixed(1)},${(48 - x / m * 46).toFixed(1)}`).join(' ')}"/>`;
          chart = `<div class="lbl">${icon(sr.id)} ${nm(sr.id)}: ${unit} (макс. ${fmtN(m)})</div><svg class="graph big" viewBox="0 0 100 50" preserveAspectRatio="none">${line(pp, '#4be36b')}${line(cc, '#ffb347')}</svg><div class="dim small"><span style="color:#4be36b">■</span> производство <span style="color:#ffb347">■</span> потребление</div>`;
        }
        body = `${chart}<div class="scroll"><table class="stats"><tr><th>${this.tab === 'fluids' ? 'Жидкость' : 'Предмет'}</th><th>Произведено, ${unit}</th><th>Потреблено, ${unit}</th><th>Баланс</th><th></th></tr>${rows || `<tr><td colspan=5 class="dim">За это окно ничего не произведено</td></tr>`}</table></div>`;
      }
    }
    return `<div class="panel wide tall"><div class="title">Статистика производства <span class="dim small">окно ${TIER_NAMES[this.tier]}</span> <button class="mini" data-act="ps-calcopen">🧮 Калькулятор</button> <span class="x" data-act="close">✕</span></div>
      ${extra}<div class="tabs">${tiers}</div><div class="tabs">${tabs}</div>${body}
      <div class="dim small">Средние за окно; строка — график. Узкие места: доля времени, когда машины ждут предмет. Окна 10 ч и 50 ч копятся и сохраняются в партии.</div></div>`;
  }
  private bottHtml(v: StatsView): string {
    const b = (v.bott || []).filter(x => x.share >= 0.02), o = (v.blocked || []).filter(x => x.share >= 0.02);
    const pct = (x: number) => Math.round(x * 100) + '%';
    const r1 = b.map(x => `<tr><td>${icon(x.item)} ${nm(x.item)}</td><td class="${x.share >= 0.3 ? 'err' : ''}"><b>${tr('в дефиците')} ${pct(x.share)} ${tr('времени')}</b></td><td class="dim">${tr('ждут')} ${fmtN(x.waiting)} ${tr('из')} ${fmtN(x.using)} ${tr('машин')}</td><td>${recipeFor(x.item) ? `<button class="mini" data-act="ps-calc" data-k="${x.item}" data-r="60" title="Калькулятор">🧮</button>` : ''}</td></tr>`).join('');
    const r2 = o.map(x => `<tr><td>${icon(x.recipe)} ${nm(x.recipe)}</td><td><b>${tr('выход забит')} ${pct(x.share)} ${tr('времени')}</b></td><td class="dim">${tr('машин')}: ${fmtN(x.machines)}</td></tr>`).join('');
    return `<div class="lbl">Не хватает (машины ждут вход)</div><div class="scroll"><table class="stats">${r1 || '<tr><td class="dim">Дефицита нет — все машины получают сырьё</td></tr>'}</table>
      <div class="lbl">Некуда девать (выход машин забит)</div><table class="stats">${r2 || '<tr><td class="dim">Нет — продукцию успевают забирать</td></tr>'}</table></div>`;
  }
  // ---------- калькулятор ----------
  openCalc(item: string, rate: number, from: 'stats' | 'recipe' | 'key') { if (recipeFor(item)) this.calcItem = item; this.calcRate = Math.max(0.1, Math.min(1e6, rate || 60)); this.calcFrom = from; }
  calcHtml(): string {
    if (this.calcTab === 'energy') return this.energyHtml();
    const g = this.h.game(); const o = { ...this.calcOpts, mining: g.bonus ? g.bonus('mining') : 0 };
    const r = calculate(this.calcItem, this.calcRate, o);
    const items = ITEM_LIST.filter(id => !ITEMS[id].virtual && !ITEMS[id].hidden && recipeFor(id)).sort((a, b) => ITEMS[a].order - ITEMS[b].order);
    const sel = `<select id="calcitem">${items.map(id => `<option value="${id}" ${id === this.calcItem ? 'selected' : ''}>${esc(nm(id))}</option>`).join('')}</select>`;
    const btn = (act: string, v: string | number, cur: any, label: string) => `<button data-act="${act}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${label}</button>`;
    const opts = `<div class="row2">Сборщик: ${[1, 2, 3, 4].map(t => btn('calc-asm', t, o.asm, String(t))).join('')} · Бур: ${[1, 2, 3].map(t => btn('calc-drill', t, o.drill || 1, String(t))).join('')} · Печь: ${btn('calc-fur', 'stone-furnace', o.furnace, 'каменная')}${btn('calc-fur', 'steel-furnace', o.furnace, 'стальная')}${btn('calc-fur', 'electric-furnace', o.furnace, 'электро')}</div>
      <div class="row2">Модули: ${([['none', 'нет'], ['speed', 'скорость'], ['prod', 'продуктивность'], ['eff', 'эффективность']] as [ModKind, string][]).map(([k, l]) => btn('calc-mod', k, o.mods, l)).join('')} ур. ${[1, 2, 3].map(t => btn('calc-mt', t, o.modTier, String(t))).join('')}</div>
      <div class="row2">Маяков на машину: ${[0, 1, 2, 4, 8, 12].map(n => btn('calc-bc', n, o.beacons, String(n))).join('')} с модулями скорости ур. ${[1, 2, 3].map(t => btn('calc-bt', t, o.beaconTier, String(t))).join('')}</div>`;
    const rows = r.steps.map(s => `<tr><td style="padding-left:${s.depth * 12}px">${icon(s.item)} ${nm(s.item)}</td><td>${fmtN(s.perMin)}</td><td>${s.machine ? `${icon(s.machine) || ''}<b>${s.count}</b> × ${nm(s.machine)} <span class="dim">(${fmtN(s.machines, 2)})</span>` : '<span class="dim">сырьё</span>'}</td><td class="dim">${s.machine ? fmtN(s.perMachine) + '/мин' : ''}${s.speedMul !== 1 ? ` · ×${fmtN(s.speedMul, 2)}` : ''}${s.prod ? ` · +${Math.round(s.prod * 100)}%` : ''}${s.beacons ? ` · ${tr('маяков')} ${s.beacons}` : ''}</td><td>${s.kW ? fmtKW(s.kW) : s.burnerKW ? '<span class="dim">' + tr('топливо') + ' ' + fmtKW(s.burnerKW) + '</span>' : ''}</td></tr>${s.byproducts.length ? `<tr><td colspan=5 class="dim small" style="padding-left:${s.depth * 12 + 20}px">попутно: ${s.byproducts.map(([k, v]) => `${nm(k)} ${fmtN(v)}/мин`).join(', ')}</td></tr>` : ''}`).join('');
    const raw = Object.entries(r.raw).map(([k, v]) => `<span class="chip">${icon(k)} ${nm(k)} <b>${fmtN(v)}</b>/мин</span>`).join(' ');
    const mach = Object.entries(r.machines).map(([k, v]) => `<span class="chip">${nm(k)}: <b>${v}</b></span>`).join(' ');
    return `<div class="panel wide tall"><div class="title">Калькулятор производства <span class="x" data-act="close">✕</span></div>
      <div class="tabs"><button class="on" data-act="calc-tab" data-v="prod">Производство</button><button data-act="calc-tab" data-v="energy">Энергетика</button></div>
      <div class="row2">Нужно: ${sel} <input id="calcrate" type="number" min="0.1" step="any" value="${this.calcRate}" style="width:90px"> шт/мин ${this.calcFrom === 'stats' ? '<button data-act="calc-back">← к статистике</button>' : ''}</div>${opts}
      <div class="scroll"><table class="stats"><tr><th>Предмет</th><th>шт/мин</th><th>Машины</th><th>Одна машина</th><th>Энергия</th></tr>${rows}</table></div>
      <div class="row2">Сырьё: ${raw || '—'}</div><div class="row2">Машин всего: ${mach || '—'}${r.beacons ? ` · ${tr('маяков')}: <b>${r.beacons}</b>` : ''} · Энергия: <b>${fmtKW(r.kW)}</b>${r.burnerKW ? ` + ${tr('топливо')} ${fmtKW(r.burnerKW)}` : ''}</div>
      ${r.notes.map(n => `<div class="dim small">${n}</div>`).join('')}
      <div class="row2"><button data-act="calc-note">📌 Сохранить как заметку на карте</button> <span class="dim small">заметка встанет там, где стоит инженер</span></div></div>`;
  }
  /** v1.16: вкладка «Энергетика» — станция из реакторов сеткой: тепло, теплообменники, турбины, вода, насосы, стержни */
  private energyHtml(): string {
    const p = energyPlan(this.calcCols, this.calcRows);
    const btn = (act: string, v: number, cur: number) => `<button data-act="${act}" data-v="${v}" class="${cur === v ? 'on' : ''}">${v}</button>`;
    const rod = calculate('nuclear-fuel-cell', p.rodsPerMin, { ...this.calcOpts, mining: this.h.game().bonus ? this.h.game().bonus('mining') : 0 });
    const raw = Object.entries(rod.raw).map(([k, v]) => `<span class="chip">${icon(k)} ${nm(k)} <b>${fmtN(v)}</b>/мин</span>`).join(' ');
    return `<div class="panel wide tall"><div class="title">Калькулятор производства <span class="x" data-act="close">✕</span></div>
      <div class="tabs"><button data-act="calc-tab" data-v="prod">Производство</button><button class="on" data-act="calc-tab" data-v="energy">Энергетика</button></div>
      <div class="row2">Реакторов в ряду: ${[1, 2, 3, 4, 5, 6].map(n => btn('calc-cols', n, p.cols)).join('')} · рядов: ${[1, 2, 3, 4, 5, 6].map(n => btn('calc-rows', n, p.rows)).join('')}</div>
      <table class="stats"><tr><td>Реакторов</td><td><b>${p.reactors}</b> (${p.cols}×${p.rows})</td></tr>
      <tr><td>Тепловая мощность</td><td><b>${fmtN(p.mw)} МВт</b></td></tr>
      <tr><td>${icon('heat-exchanger')} Теплообменников (по 10 МВт)</td><td><b>${p.exchangers}</b></td></tr>
      <tr><td>${icon('steam-turbine')} Паровых турбин (по 5,82 МВт)</td><td><b>${p.turbines}</b></td></tr>
      <tr><td>Вода и пар (97 кДж/ед)</td><td><b>${String(p.water.toFixed(3)).replace('.', ',')}</b> ед/с</td></tr>
      <tr><td>Береговых насосов (по 1200 ед/с)</td><td><b>${p.pumps}</b></td></tr>
      <tr><td>Стержней в минуту (200 с на стержень)</td><td><b>${fmtN(p.rodsPerMin)}</b></td></tr></table>
      <div class="row2">Сырьё на стержни: ${raw || '—'}</div>
      <div class="dim small">Соседом считается реактор с общей стороной в 5 клеток и совпадающим краем: каждый работающий сосед даёт +40 МВт. Расчёт без потерь в тепловых трубах — на линии добавьте запас.</div></div>`;
  }
  /** нажатие в окнах; true — обработано */
  act(a: string, el: HTMLElement): boolean {
    const v = el.dataset.v!;
    switch (a) {
      case 'ps-tier': this.tier = +v; this.data = null; break;
      case 'ps-tab': this.tab = v as Tab; this.data = null; break;
      case 'ps-sel': this.sel = this.sel === el.dataset.k ? null : el.dataset.k!; this.want = ''; break;
      case 'ps-calc': this.openCalc(el.dataset.k!, +el.dataset.r! || 60, 'stats'); this.h.calcOpen(); return true;
      case 'ps-calcopen': this.calcFrom = 'stats'; this.h.calcOpen(); return true;
      case 'calc-tab': this.calcTab = v === 'energy' ? 'energy' : 'prod'; break;
      case 'calc-cols': this.calcCols = +v; break;
      case 'calc-rows': this.calcRows = +v; break;
      case 'calc-asm': this.calcOpts.asm = +v as 1 | 2 | 3 | 4; break;
      case 'calc-drill': this.calcOpts.drill = +v as 1 | 2 | 3; break;
      case 'calc-fur': this.calcOpts.furnace = v as CalcOpts['furnace']; break;
      case 'calc-mod': this.calcOpts.mods = v as ModKind; break;
      case 'calc-mt': this.calcOpts.modTier = +v as 1 | 2 | 3; break;
      case 'calc-bc': this.calcOpts.beacons = +v; break;
      case 'calc-bt': this.calcOpts.beaconTier = +v as 1 | 2 | 3; break;
      case 'calc-note': { const g = this.h.game(); const r = calculate(this.calcItem, this.calcRate, { ...this.calcOpts, mining: g.bonus ? g.bonus('mining') : 0 }); this.h.note(`🧮 ${tr(nm(this.calcItem))} ${fmtN(this.calcRate)}/${tr('мин')}`, calcText(r, id => tr(nm(id)), tr)); break; }
      default: return false;
    }
    this.h.render(); return true;
  }
  input(el: HTMLInputElement | HTMLSelectElement): boolean {
    if (el.id === 'calcrate') { const x = parseFloat(el.value.replace(',', '.')); if (x > 0 && x < 1e7) { this.calcRate = x; this.h.render(); } return true; }
    if (el.id === 'calcitem') { this.calcItem = el.value; this.h.render(); return true; }
    return false;
  }
}

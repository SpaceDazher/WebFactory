// Интерфейс на DOM поверх canvas (11.1–11.2).
import { ITEMS, GROUPS, ITEM_LIST } from '../data/items';
import { RECIPES, RECIPE_LIST } from '../data/recipes';
import { PROTOS, FLOOR_BY_ITEM, FLOORS } from '../data/entities';
import { TECH_LIST, TECHS, techEra, SCIENCE_PACKS, techGain } from '../data/techs';
import { moduleSlots, fx } from '../sim/modules';
import { Blueprint, bpCost, validBp } from '../sim/blueprint';
import { packStr, unpackStr } from '../core/pack';
import { ACTIONS, keyName, DEFAULTS, Settings } from '../client/settings';
import { PRESET_NAMES } from '../client/gfx';
import { Game, Entity, PLAYER_HP } from '../sim/game';
import { RES_ITEMS, R_OIL } from '../sim/world';
import { texQuality } from '../render/textures';
import type { EnemyMode } from '../sim/enemies';
import { GOALS } from '../sim/goals';
import { iconURL } from '../render/art';
import { tr, LANG } from '../core/i18n';
import { STATUS_TEXT } from '../render/renderer';
import { TIPS, Tip, seenTips, markTip, resetTips } from './tips';
import { playTime, SlotInfo } from '../sim/slotinfo';
import { NEWS } from '../data/news';
import { robotView, ROBOT_STRIDE, ROBOT, LROBOT, REPAIR, REQ_SLOTS, NetSummary } from '../sim/robots';
import { ITEM_IDX } from '../data/items';
import { CC, OPS, CC_SLOTS, circuitCapable, condCapable, signalList, WIRE_OF, AOPS, DOPS, EACH, ANY, EVERY, hasOut, csigOf, wt, Arith, Decider } from '../sim/circuits';
import { fmtSig } from '../render/renderer';
import { trainOf, graph, fillPct, stopLinked, Train, SchedRec, VMAX, WCond, CONDS, stopLimit, FWAGON_CAP, isChain } from '../sim/trains';
import type { CondOp } from '../sim/circuits';
import { ProdUI } from './produi';
import type { StatsView, Tab } from '../sim/prodstats';
/** v1.8: условие k записи расписания (0 — основное, дальше — дополнительные) */
const condAt = (r: SchedRec | undefined, k: number): WCond | null => !r ? null : k === 0 ? r : r.x?.[k - 1] || null;
/** запись о слоте сохранения: время, картинка базы (JPEG data URL) и сведения о партии */
export interface SaveMeta extends Partial<SlotInfo> { slot: string; time: number; tick: number; prev?: string; }

export const MODE_NAMES: Record<string, string> = { none: 'нет врагов', peaceful: 'мирный', normal: 'обычный', deathworld: 'мир смерти' };
export type Win = 'cnet' | 'inv' | 'ent' | 'tech' | 'stats' | 'menu' | 'map' | 'help' | 'bp' | 'victory' | 'settings' | 'beta' | 'bug' | 'contrib' | 'news' | 'perf' | 'logi' | 'mp' | 'players' | 'trains' | 'calc' | 'mods' | 'modcheck' | null;
export interface BpEntry { name: string; bp: Blueprint; time: number; }
const BP_KEY = 'zavod7:bps';
/** пары «что → во что» для планировщика улучшений (одинаковый размер, одна группа быстрой замены) */
export const UPGRADES: [string, string][] = [['transport-belt', 'fast-transport-belt'], ['fast-transport-belt', 'express-transport-belt'], ['burner-inserter', 'inserter'], ['inserter', 'fast-inserter'], ['wooden-chest', 'iron-chest'], ['iron-chest', 'steel-chest'], ['stone-furnace', 'steel-furnace'], ['assembling-machine-1', 'assembling-machine-2'], ['assembling-machine-2', 'assembling-machine-3']];
const ERA_NAMES = ['Автоматизация', 'Логистика', 'Химия', 'Производство', 'Космос', 'Бесконечные'];
const pct = (v: number) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(0) + 'k' : n >= 1000 ? (n / 1e3).toFixed(1) + 'k' : String(Math.floor(n));
const kw = (k: number) => k >= 1000 ? (k / 1000).toFixed(2) + ' МВт' : k.toFixed(1) + ' кВт';
const fluidName = (f: string | null) => f ? ITEMS[f]?.name || f : 'Пусто';
export function slotHTML(item: string | null, count: number | null, attrs = '', extra = '') {
  if (!item) return `<div class="slot empty" ${attrs}>${extra}</div>`;
  return `<div class="slot" ${attrs} data-tip="item:${item}"><img src="${iconURL(item)}">${count != null && count > 0 ? `<span class="cnt">${fmt(count)}</span>` : ''}${extra}</div>`;
}
export interface BetaHooks {
  /** статистика партии из симуляции (в Worker — асинхронно) */ teleReport(): Promise<any>; exportTele(): void; setTele(on: boolean): void;
  /** текст отчёта об ошибке */ bugReport(desc: string, withSave: boolean): Promise<string>; saveBug(text: string): void; loadSaveString(str: string): Promise<void>; errors(): number;
  /** v1.1: замер производительности (открывает ?bench=1 в новой вкладке), его состояние и файл */
  openBench(): void; bench(): { running: boolean; text: string; frac: number; file: any | null }; saveBench(): void; copyBench(): Promise<boolean>;
  /** куда отправлять файлы (ZAVOD_FEEDBACK при сборке; пусто — только инструкция) */ feedback(): string;
}
export interface ClientHooks extends BetaHooks { /** v1.9: данные окна статистики 2.0 (в Worker — асинхронно) */ statsView(tier: number, tab: Tab, sel: string | null): Promise<StatsView | null>; getSettings(): Settings; setSettings(p: Partial<Settings>): void; storageInfo(): string; workerActive(): boolean; rendererMode(): string; rendererNote(): string; setRenderer(m: 'auto' | 'webgl' | 'canvas'): string; takeBp(bp: Blueprint): void; curBp(): Blueprint | null; setTool(t: 'copy' | 'cut' | 'decon' | 'upgrade' | 'cancel'): void; getGame(): Game; setCursor(i: string | null): void; cursor(): string | null; save(slot: string): void; load(slot: string): void; newGame(seed: number, mode: EnemyMode): void; setTex(n: number): void; setPreset(p: 'high' | 'medium' | 'low' | 'min'): void; isMac(): boolean; togglePollution(): void; pollution(): boolean; exportSave(): void; importSave(): void; listSaves(): SaveMeta[]; deleteSave(slot: string): void; voiceInfo(): string; voiceList(): string[]; voiceTest(): void; }

export class UI {
  /** v1.3: выбор предмета для запроса / фильтра / личного запроса; редактирование количества (колёсико, ввод с клавиатуры); вкладка инвентаря */
  pick: { kind: 'lreq' | 'lfilter' | 'preq' | 'ca' | 'cb' | 'cs' | 'xa' | 'xb' | 'xo' | 'sit' | 'sca'; i: number } | null = null;
  /** v1.8: перетаскивание записи расписания (индекс) */ sdrag: number | null = null;
  edit: { kind: 'lreq' | 'pmin' | 'pmax' | 'cn' | 'csn' | 'xn' | 'sin' | 'scn' | 'tlim'; i: number; buf: string } | null = null;
  /** v1.6: окно «Сеть сигналов» — постройка, клемма (1 — выход комбинатора), цвет; поиск; выбранный сигнал; история за 10 с */
  net: { id: number; t: 0 | 1; c: 0 | 1 } | null = null; netQ = ''; netSel: string | null = null; private netHist: { tick: number; v: Map<string, number> }[] = [];
  invTab: 'inv' | 'logi' = 'inv';
  open: Win = null; entId = -1; tab = 'logistics'; statsRange = 60; statItem: string | null = null;
  deconFilter: 'all' | 'belts' | 'nobelts' = 'all'; deconTrees = true;
  upgradeOn: Record<string, boolean> = Object.fromEntries(UPGRADES.map(([a]) => [a, true]));
  bpMsg = ''; rebinding: string | null = null;
  /** v1.12: окна совместной игры (ui/mpui.ts); inGame — идёт совместная игра (новая игра и загрузка недоступны) */
  /** v1.10: включённых модов (кнопка в меню) */ modCount = 0;
  /** v1.10: окно «Моды» */ mods: { html(w: string): string; act(a: string, el: HTMLElement): boolean } | null = null;
  ext: { html(w: string): string | null; act(a: string, el: HTMLElement): boolean; inGame(): boolean } | null = null;
  hotbar: (string | null)[] = new Array(10).fill(null);
  private last = ''; private frame = 0; private tipEl = $('tip');
  constructor(public h: ClientHooks) {
    const win = $('win');
    win.addEventListener('mousedown', ev => this.onClick(ev));
    win.addEventListener('contextmenu', ev => ev.preventDefault());
    // v1.8: перетаскивание записи расписания — отпустить над другой записью
    document.addEventListener('mouseup', ev => { if (this.sdrag == null) return; const from = this.sdrag; this.sdrag = null;
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-srow]') as HTMLElement | null; const to = el ? +el.dataset.srow! : from;
      if (to !== from) this.schedEdit((sc, t) => { const [r] = sc.splice(from, 1); sc.splice(to, 0, r); const cur = t.si; if (cur === from) return to; if (from < cur && to >= cur) return cur - 1; if (from > cur && to <= cur) return cur + 1; return undefined; }); else this.render(true); });
    // v1.3: количество запроса — колёсиком над ячейкой (Shift — по одному) и вводом с клавиатуры
    win.addEventListener('wheel', ev => {
      const el = (ev.target as HTMLElement).closest('[data-act="lreq"],[data-act="preq"]') as HTMLElement | null; if (!el) return;
      ev.preventDefault(); const i = +el.dataset.i!; const up = ev.deltaY < 0;
      if (el.dataset.act === 'lreq') { const e = this.g.ents.get(this.entId); const q = e?.req?.[i]; if (!q) return; const st = ev.shiftKey ? 1 : Math.max(1, Math.round(ITEMS[q.item].stack / 10)); this.g.enqueue({ t: 'lreq', id: this.entId, i, item: q.item, n: Math.max(1, q.n + (up ? st : -st)) }); }
      else { const q = this.g.preq[i]; if (!q) return; const st = ev.shiftKey ? 1 : Math.max(1, Math.round(ITEMS[q.item].stack / 10)); const min = Math.max(0, q.min + (up ? st : -st)); this.g.enqueue({ t: 'preq', i, item: q.item, min, max: q.max == null ? null : Math.max(min, q.max) }); }
      this.edit = null;
    }, { passive: false });
    document.addEventListener('keydown', ev => {
      if (!this.edit || !this.open) return;
      const k = ev.key; let used = true;
      if (/^[0-9]$/.test(k)) { if (this.edit.buf.replace('-', '').length < (this.edit.kind === 'cn' || this.edit.kind === 'csn' || this.edit.kind === 'xn' ? 10 : 6)) this.edit.buf += k; }
      else if (k === '-' && this.edit.buf === '' && (this.edit.kind === 'cn' || this.edit.kind === 'csn' || this.edit.kind === 'xn')) this.edit.buf = '-';
      else if (k === 'Backspace') this.edit.buf = this.edit.buf.slice(0, -1);
      else if (k === 'Enter') this.commitEdit();
      else if (k === 'Escape') this.edit = null;
      else used = false;
      if (used) { ev.preventDefault(); ev.stopImmediatePropagation(); this.render(true); }
    }, true);
    $('hotbar').addEventListener('mousedown', ev => this.onHotbar(ev));
    $('hotbar').addEventListener('contextmenu', ev => ev.preventDefault());
    $('craftq').addEventListener('mousedown', ev => { const el = (ev.target as HTMLElement).closest('[data-q]') as HTMLElement; if (el) this.g.enqueue({ t: 'cancelCraft', index: +el.dataset.q! }); });
    document.addEventListener('mousemove', ev => this.onTip(ev));
    win.addEventListener('change', ev => { const el = ev.target as HTMLSelectElement; if (this.inRender) return; /* change при удалении поля во время перерисовки */ if (this.prod.input(el)) return; if (el.id === 'voicesel') this.h.setSettings({ voiceName: el.value }); });
    win.addEventListener('input', ev => {
      const el = ev.target as HTMLInputElement;
      if (el.id === 'calcrate') { this.prod.input(el); return; }
      if (el.id === 'notetitle' || el.id === 'notetext') { this.noteDraft[el.id === 'notetitle' ? 'title' : 'text'] = el.value; return; }
      if (el.id === 'csearch') { this.chestQ = el.value; this.render(true); return; }
      if (el.id === 'nsearch') { this.netQ = el.value; this.render(true); return; }
      const k = el.dataset?.set; if (!k) return;
      const v = +el.value / 100; this.h.setSettings({ [k]: v } as any); const sp = el.nextElementSibling; if (sp) sp.textContent = el.value + '%';
    });
  }
  get g() { return this.h.getGame(); }
  /** v1.9: статистика 2.0 и калькулятор */
  prod = new ProdUI({ statsView: (t, tab, sel) => this.h.statsView(t, tab, sel), game: () => this.g, render: () => this.render(true),
    note: (title, text) => { const p = this.g.player; this.g.enqueue({ t: 'note', op: 'add', x: p.x, y: p.y, title, text }); },
    calcOpen: () => { if (this.open !== 'calc') this.toggle('calc'); else this.render(true); } });
  /** v1.9: заметки на карте — список в окне карты, новая заметка там, где стоит инженер */
  noteDraft = { title: '', text: '' };
  private notesHtml() {
    const g = this.g; const ns = g.notes || [];
    const list = ns.slice().reverse().map(n => `<div class="kv"><span>📌 <b>${esc(n.title)}</b> <span class="dim small">(${Math.round(n.x)}, ${Math.round(n.y)})</span><br><span class="dim small" style="white-space:pre-line">${esc(n.text.split('\n').slice(0, 4).join('\n'))}</span></span><span><button class="mini" data-act="note-del" data-id="${n.id}">Удалить</button></span></div>`).join('');
    return `<div class="lbl">Заметки на карте (${ns.length})</div><div class="scroll" style="max-height:160px">${list || '<div class="dim small">Заметок нет. Расчёт калькулятора (K) тоже можно сохранить заметкой.</div>'}</div>
      <div class="row2"><input id="notetitle" placeholder="Заголовок" maxlength="60" value="${esc(this.noteDraft.title)}" style="width:160px"> <input id="notetext" placeholder="Текст заметки" maxlength="400" value="${esc(this.noteDraft.text)}" style="width:300px"> <button data-act="note-add">📌 Добавить здесь</button></div>`;
  }
  /** открыть калькулятор для предмета (из окна рецепта, статистики или клавишей) */
  openCalc(item: string | null, rate: number, from: 'stats' | 'recipe' | 'key') { if (item) this.prod.openCalc(item, rate, from); else this.prod.calcFrom = from; if (this.open !== 'calc') this.toggle('calc'); else this.render(true); }
  toggle(w: Win, ent = -1) { this.tipKey = null; if (this.open === w && (w !== 'ent' || ent === this.entId)) this.open = null; else { this.open = w; this.entId = ent; this.onOpen?.(w); } this.last = ''; this.render(true); if (this.open === 'beta') this.refreshTele(); }
  onOpen: ((w: Win) => void) | null = null;
  /** показана обучающая подсказка (ключ TIPS) — до закрытия окна; onHint — озвучить её голосом ОСКАРа */
  tipKey: string | null = null; onHint: ((t: Tip) => void) | null = null;
  tele: any = null; bugText = ''; bugMsg = '';
  refreshTele() { this.h.teleReport().then(r => { this.tele = r; if (this.open === 'beta') this.render(true); }); }
  close() { this.open = null; this.tipKey = null; this.last = ''; this.render(true); }
  /** ключ подсказки для открытого окна */
  private inRender = false;
  private tipFor(): string | null {
    if (this.open === 'inv' && this.invTab === 'logi' && this.tipKey !== 'inv') return 'inv:v13';
    if (this.open === 'inv' && this.tipKey !== 'inv' && seenTips().has('inv') && (this.g.inv.count('concrete') || this.g.inv.count('refined-concrete'))) return 'floor';
    if (this.open === 'inv' && seenTips().has('inv') && this.tipKey !== 'inv') return 'inv:v12';
    if (this.open === 'stats' && seenTips().has('stats') && this.tipKey !== 'stats') return 'stats:v19'; // v1.9
    if (this.open !== 'ent') return this.open; const e = this.g.ents.get(this.entId); if (!e) return null;
    if (e.proto.endsWith('-warehouse')) return 'ent:warehouse';
    if (e.t !== 'combinator' && !hasOut(e) && this.wired(e) && (this.tipKey === 'circuit' || !seenTips().has('circuit'))) return 'circuit';
    return TIPS['ent:' + e.proto] ? 'ent:' + e.proto : 'ent:' + e.t;
  }
  /** обучающая подсказка при первом открытии окна: вставляется в первую панель под заголовком */
  private withTip(html: string): string {
    if (!this.h.getSettings().tips) return html;
    const k = this.tipFor(); if (!k || !TIPS[k]) return html;
    if (this.tipKey !== k) { if (seenTips().has(k)) return html; this.tipKey = k; markTip(k); this.onHint?.(TIPS[k]); }
    const t = TIPS[k]; const box = `<div class="tipbox" data-tipkey="${k}"><div class="oscar">ОСКАР</div><div><b>${t.title}</b><div class="small">${t.text}</div><div class="row2"><button data-act="tipok">Понятно</button><button data-act="tipsoff">Больше не показывать подсказки</button></div></div></div>`;
    const i = html.indexOf('<div class="title">'); if (i < 0) return box + html; const j = html.indexOf('</div>', i); return html.slice(0, j + 6) + box + html.slice(j + 6);
  }
  // ---------- HUD ----------
  hud() {
    const g = this.g; this.frame++;
    const r = g.research.current;
    const rc = r ? g.techCost(r) : 1, rl = r && TECHS[r].infinite ? ' ' + ((g.research.levels[r] || 0) + 1) : '';
    const rh = r ? `<div class="lbl">Исследование: <b>${TECHS[r].name}${rl}</b></div><div class="bar"><i style="width:${(g.research.progress / rc * 100).toFixed(1)}%"></i></div><div class="sub">${g.research.progress}/${rc}</div>` : `<div class="lbl dim">Нет исследования — нажмите <kbd>${keyName(this.h.getSettings().keys.tech)}</kbd></div>`;
    const goal = GOALS[Math.min(g.goalIdx, GOALS.length - 1)];
    const gh = `<div class="goal"><div class="oscar">ОСКАР</div><div><b>${goal.text}</b>${goal.progress ? ` <span class="dim">${goal.progress(g)}</span>` : ''}<div class="sub">${goal.hint}</div></div></div>`;
    const pl = g.player; const gun = g.inv.count('submachine-gun') ? 'submachine-gun' : g.inv.count('pistol') ? 'pistol' : null;
    const ammo = g.inv.count('piercing-rounds-magazine') + g.inv.count('firearm-magazine');
    const ch = g.settings.enemies === 'none' ? '' : `<div class="combat"><div class="kv">❤ <div class="bar hp" style="flex:1"><i style="width:${(pl.hp / PLAYER_HP * 100).toFixed(0)}%"></i></div><span>${Math.ceil(pl.hp)}</span></div>
      ${pl.dead ? `<div class="err">Инженер погиб · возрождение через ${Math.ceil(pl.respawn / 60)} с</div>` : ''}
      <div class="sub">${gun ? (gun === 'pistol' ? 'Пистолет' : 'Пистолет-пулемёт') : 'Нет оружия'} · патроны: ${pl.rounds ? pl.rounds + ' + ' : ''}${ammo} маг. · <kbd>${keyName(this.h.getSettings().keys.shoot)}</kbd> — огонь</div>
      <div class="sub">Рой: ${MODE_NAMES[g.settings.enemies]} · эволюция ${(g.evolution * 100).toFixed(1)}%${g.units.some(u => u.st === 'attack') ? ' · <span class="err">атака!</span>' : ''}</div></div>`;
    const html = rh + ch + gh;
    if ($('hudl').dataset.h !== html) { $('hudl').innerHTML = tr(html); $('hudl').dataset.h = html; }
    // хотбар
    let hb = '';
    for (let i = 0; i < 10; i++) {
      const it = this.hotbar[i]; const n = it ? g.inv.count(it) : 0; const sel = it && this.h.cursor() === it;
      hb += it ? `<div class="slot ${sel ? 'sel' : ''} ${n ? '' : 'zero'}" data-h="${i}" data-tip="item:${it}"><img src="${iconURL(it)}">${n ? `<span class="cnt">${fmt(n)}</span>` : ''}<span class="key">${(i + 1) % 10}</span></div>`
        : `<div class="slot empty" data-h="${i}"><span class="key">${(i + 1) % 10}</span></div>`;
    }
    if ($('hotbar').dataset.h !== hb) { $('hotbar').innerHTML = tr(hb); $('hotbar').dataset.h = hb; }
    // очередь крафта
    let q = '';
    g.queue.slice(0, 12).forEach((j, i) => { const r = RECIPES[j.recipe]; const prog = j.started ? 1 - j.left / (r.time * 60) : 0; q += `<div class="slot ${j.auto ? 'auto' : ''}" data-q="${i}" data-tip="item:${r.out[0][0]}"><img src="${iconURL(r.out[0][0])}"><span class="cnt">${j.count}</span><i class="qp" style="width:${prog * 100}%"></i></div>`; });
    if ($('craftq').dataset.h !== q) { $('craftq').innerHTML = tr(q); $('craftq').dataset.h = q; }
    // сообщения
    const msgs = g.messages.filter(m => g.tick - m.tick < 300).slice(-4).map(m => `<div>${esc(m.text)}</div>`).join('');
    if ($('toast').dataset.h !== msgs) { $('toast').innerHTML = tr(msgs); $('toast').dataset.h = msgs; }
    // авто-заполнение хотбара
    if (this.frame % 30 === 0) for (const s of g.inv.slots) if (s && ITEMS[s.item].place && !this.hotbar.includes(s.item)) { const k = this.hotbar.indexOf(null); if (k >= 0) this.hotbar[k] = s.item; }
    if (this.frame % 8 === 0) this.render(false);
  }
  hoverInfo(e: Entity | null, tile: [number, number] | null, wire = -1) {
    const g = this.g; let h = '';
    const w = !e && wire >= 0 ? g.cw[wire] : null;
    if (w) { // v1.6: провод под курсором — сигналы его сети
      const A = g.ents.get(w[0]); const arr = A ? (this.sigsOf(A)[wt(w, 0) * 2 + w[2]] || []).filter(([, v]) => v) : [];
      arr.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      h = `<b>${w[2] ? 'Зелёный провод' : 'Красный провод'}</b><div class="grid g6 sigs">${arr.slice(0, 18).map(([k, v]) => this.sigSlot(k, v, '')).join('') || '<span class="dim small">сигналов нет</span>'}</div>${arr.length > 18 ? `<div class="dim small">и ещё ${arr.length - 18}</div>` : ''}<div class="dim small">ЛКМ — окно «Сеть сигналов»</div>`;
    } else
    if (e) {
      const p = PROTOS[e.proto];
      h = `<b>${p.name}</b>`;
      if (e.status && e.t !== 'nest' && e.t !== 'wall') h += `<div class="st st-${e.status}">${STATUS_TEXT[e.status] || e.status}</div>`;
      if (e.hp != null && (e.hp < p.hp || e.t === 'nest')) h += `<div>Прочность: ${Math.ceil(e.hp)}/${p.hp}</div>`;
      if (e.t === 'nest') h += `<div class="dim small">Гнездо поглощает загрязнение и рождает ползунов. Уничтожьте турелями или оружием (Пробел).</div>`;
      if (e.t === 'turret') h += `<div>Патроны: ${(e.rounds || 0)} + ${e.ammo ? e.ammo.count + ' маг.' : '0'}</div>`;
      if (e.t === 'pumpjack') h += `<div>Выход источника: ${g.world.amt(e.x + 1, e.y + 1)}%</div>`;
      if (e.recipe && RECIPES[e.recipe] && e.t !== 'lab') h += `<div>Рецепт: ${ITEMS[RECIPES[e.recipe].out[0][0]].name}</div>`;
      if (e.progress != null && (e.crafting || e.t === 'drill')) h += `<div class="bar sm"><i style="width:${Math.min(100, e.progress * 100)}%"></i></div>`;
      if (e.fuel) h += `<div>Топливо: ${ITEMS[e.fuel.item].name} ×${e.fuel.count}</div>`;
      if (e.t === 'drill') { let n = 0; for (const [x, y] of g.drillTiles(e)) n += g.world.res(x, y) ? g.world.amt(x, y) : 0; h += `<div>Руды под буром: ${fmt(n)}</div>`; }
      if (e.t === 'underground') h += `<div>${e.ug === 'in' ? 'Вход' : 'Выход'}${e.partner == null ? ' (нет пары)' : ''}</div>`;
      if (e._net != null && e._net >= 0) { const n = g.powerNets.get(e._net); if (n) h += `<div class="dim">Сеть: ${kw(n.demand)} / ${kw(n.supply)}</div>`; }
      if (e.t === 'engine' || e.t === 'solar') h += `<div>Выработка: ${kw(e._out || 0)}</div>`;
      if (p.fluid && e._fn) e._fn.forEach((ni) => { const n = g.fluidNets[ni]; if (n) h += `<div>${fluidName(n.fluid)}: ${n.amount.toFixed(0)}/${n.cap}${n.conflict ? ' ⚠ смешение' : ''}</div>`; });
      if (e.t !== 'nest') h += `<div class="dim small">ЛКМ — открыть, ПКМ — разобрать${['belt', 'inserter', 'drill', 'assembler', 'furnace'].includes(e.t) ? ', R — повернуть' : ''}</div>`;
    } else if (tile) {
      const [x, y] = tile; if (!g.world.hasChunk(Math.floor(x / 32), Math.floor(y / 32))) { $('hover').innerHTML = ''; return; }
      const r = g.world.res(x, y), d = g.world.decor(x, y);
      if (r === R_OIL) h = `<b>Нефтяной источник</b><div>Выход: ${g.world.amt(x, y)}%</div><div class="dim small">Поставьте насос-качалку центром на источник</div>`;
      else if (r) h = `<b>${ITEMS[RES_ITEMS[r]].name}</b><div>Запас: ${fmt(g.world.amt(x, y))}</div><div class="dim small">ПКМ — добыть рукой</div>`;
      const pol = g.world.chunkAt(x, y).pollution; if (pol > 0.05 && this.h.pollution()) h += `<div class="dim">Загрязнение чанка: ${pol.toFixed(1)}</div>`;
      else if (d) h = `<b>${d === 1 ? 'Дерево' : 'Скала'}</b><div class="dim small">ПКМ — добыть (${d === 1 ? '4 древесины' : '20 камня, 10 угля'})</div>`;
      const gh = g.ghostAt(x, y);
      if (gh) { const ST: Record<string, string> = { wait: 'Ждёт робота', out: 'Вне зоны робопортов', noitem: 'Нет предмета', norobot: 'Нет свободных роботов' }; h = `<b>Призрак: ${PROTOS[gh.proto].name}</b>${gh.rb ? '<div class="small">Восстановить разрушенное</div>' : ''}${gh.st ? `<div class="st st-${gh.st === 'wait' ? 'working' : 'no-input'}">${ST[gh.st]}</div>` : ''}<div class="dim small">Shift+ЛКМ — роботы построят первым</div>`; }
      const gi = [...g.ground.values()].find(i => i.x === x && i.y === y);
      if (gi) h += `<b>${ITEMS[gi.item].name} ×${gi.count}</b><div class="dim small">F — подобрать рядом</div>`;
    }
    if ($('hover').dataset.h !== h) { $('hover').innerHTML = tr(h); $('hover').dataset.h = h; $('hover').style.display = h ? 'block' : 'none'; }
  }
  // ---------- окна ----------
  render(force: boolean) {
    const win = $('win');
    if (!this.open) { if (win.style.display !== 'none') { win.style.display = 'none'; win.innerHTML = ''; } return; }
    let html = '';
    switch (this.open) {
      case 'inv': html = this.invWindow(); break;
      case 'logi': html = this.logiWindow(); break;
      case 'trains': html = this.trainsWindow(); break;
      case 'ent': html = this.entWindow(); break;
      case 'cnet': html = this.netWindow(); break;
      case 'tech': html = this.techWindow(); break;
      case 'stats': html = this.statsWindow(); break;
      case 'calc': html = this.prod.calcHtml(); break;
      case 'menu': html = this.menuWindow(); break;
      case 'help': html = this.helpWindow(); break;
      case 'bp': html = this.bpWindow(); break;
      case 'victory': html = this.victoryWindow(); break;
      case 'settings': html = this.settingsWindow(); break;
      case 'beta': html = this.betaWindow(); break;
      case 'bug': html = this.bugWindow(); break;
      case 'contrib': html = this.contribWindow(); break;
      case 'news': html = this.newsWindow(); break;
      case 'perf': html = this.perfWindow(); break;
      case 'mp': case 'players': html = this.ext?.html(this.open) || ''; break;
      case 'mods': case 'modcheck': html = this.mods?.html(this.open) || ''; break;
      case 'map': html = `<div class="panel wide"><div class="title">Карта <span class="x" data-act="close">✕</span></div><canvas id="bigmap" width="720" height="540"></canvas><div class="row2"><button data-act="pollution">${this.h.pollution() ? '☑' : '☐'} Загрязнение (U)</button><span class="dim small">Чёрное — туман войны. 1 пиксель = 2 клетки. Малиновое — гнёзда Роя, красные точки — ползуны.</span></div>${this.notesHtml()}</div>`; break;
    }
    html = this.withTip(html);
    if (force || html !== this.last) {
      if ((this.open === 'menu' || this.open === 'mp' || this.open === 'bp' || this.open === 'settings' || this.open === 'bug' || this.open === 'beta') && !force && win.innerHTML) return; // не сбрасывать поля ввода
      // v1.4: поле поиска и прокрутка склада переживают перерисовку
      const act = document.activeElement as HTMLInputElement | null; const aidId = act && win.contains(act) && (act.id === 'csearch' || act.id === 'nsearch' || act.id === 'calcrate' || act.id === 'notetitle' || act.id === 'notetext') ? act.id : null; const aid = aidId ? act!.selectionStart : null;
      const cg = document.getElementById('cgrid'); const sTop = cg ? cg.scrollTop : 0;
      this.inRender = true; try { win.innerHTML = tr(html); } finally { this.inRender = false; } this.last = html; win.style.display = 'flex';
      const cg2 = document.getElementById('cgrid'); if (cg2 && sTop) cg2.scrollTop = sTop;
      if (aid != null && aidId) { const inp = document.getElementById(aidId) as HTMLInputElement | null; if (inp) { inp.focus(); inp.setSelectionRange(aid, aid); } }
    }
  }
  private invGrid(mode: 'cursor' | 'put') {
    const g = this.g; let h = '<div class="grid g10">';
    g.inv.slots.forEach((s, i) => { h += slotHTML(s?.item || null, s?.count ?? null, `data-act="inv" data-mode="${mode}" data-i="${i}"`); });
    return h + '</div>';
  }
  private invWindow() {
    const g = this.g;
    let tabs = '<div class="tabs">' + GROUPS.map(([id, name]) => `<div class="tab ${this.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${name}</div>`).join('') + '</div>';
    let rec = '<div class="grid g8">';
    for (const rid of RECIPE_LIST) {
      const r = RECIPES[rid]; if (r.cat !== 'crafting') continue;
      const out = r.out[0][0]; if (ITEMS[out].group !== this.tab && !(this.tab === 'inter' && ITEMS[out].group === 'raw')) continue;
      const en = g.enabled.has(rid);
      if (!en) { rec += `<div class="slot locked" data-tip="locked:${rid}"><img src="${iconURL(out)}"></div>`; continue; }
      const n = g.maxCraftable(rid, 99);
      rec += `<div class="slot ${n ? '' : 'none'}" data-act="craft" data-r="${rid}" data-tip="recipe:${rid}"><img src="${iconURL(out)}">${n ? `<span class="cnt">${n}</span>` : ''}</div>`;
    }
    rec += '</div>';
    const eq = g.equip; const ed = eq ? ITEMS[eq].equip : null;
    let pf = 0; const rb = robotView(g, ITEM_IDX).buf; for (let i = 3; i < rb.length; i += ROBOT_STRIDE) if (rb[i] & 1) pf++;
    const armor = `<div class="lbl">Броня</div><div class="row">${slotHTML(eq, null, `data-act="unequip" id="equipslot"`)}<div class="small">${ed ? `<b>${ITEMS[eq!].name}</b><br>Зона ${ed.zone}×${ed.zone}, до ${ed.robots} роботов из инвентаря · в полёте ${pf}<br><span class="dim">ЛКМ — снять</span>` : '<span class="dim">Пусто — ЛКМ по модулю брони в инвентаре, чтобы надеть (личный робопорт: технология «Личный робопорт»)</span>'}</div></div>`;
    const itabs = `<div class="tabs"><div class="tab ${this.invTab === 'inv' ? 'on' : ''}" data-act="invtab" data-tab="inv">Инвентарь</div><div class="tab ${this.invTab === 'logi' ? 'on' : ''}" data-act="invtab" data-tab="logi">Логистика</div></div>`;
    const body = this.invTab === 'logi' ? this.personalTab() : `${this.invGrid('cursor')}<div class="dim small">ЛКМ по постройке — взять в руку. Q — убрать из руки. ПКМ — половину стопки в руку, Shift+ПКМ — один предмет.</div>${armor}`;
    return `<div class="panel"><div class="title">Инвентарь <span class="x" data-act="close">✕</span></div>${itabs}${body}</div>
    <div class="panel"><div class="title">Крафт</div>${tabs}${rec}<div class="dim small">ЛКМ — 1 шт, ПКМ — 5 шт, Shift — сколько можно. Детали создаются сами.</div></div>`;
  }
  private entWindow() {
    const g = this.g; const e = g.ents.get(this.entId);
    if (!e) { this.open = null; return ''; }
    const p = PROTOS[e.proto];
    let b = `<div class="st st-${e.status}">${STATUS_TEXT[e.status || ''] || ''}</div>`;
    const slot = (item: string | null, n: number | null, s: string, label: string) => `<div class="lab">${label}${slotHTML(item, n, item ? `data-act="take" data-slot="${s}"` : '')}</div>`;
    const prog = (v: number) => `<div class="bar"><i style="width:${Math.min(100, v * 100).toFixed(1)}%"></i></div>`;
    const fuelSlot = p.energy?.kind === 'burner' ? slot(e.fuel?.item || null, e.fuel?.count ?? null, 'fuel', '🔥 Топливо') + `<div class="bar sm fuel"><i style="width:${Math.min(100, (e.fuelJ || 0) / 4e6 * 100)}%"></i></div>` : '';
    const power = () => { if (p.energy?.kind !== 'electric') return ''; const n = e._net! >= 0 ? g.powerNets.get(e._net!) : null; return `<div class="dim">⚡ ${n ? `Удовлетворение сети ${(n.satisfaction * 100).toFixed(0)}% · потребление ${kw(e.active ? p.energy.kW : (p.energy.drainKW || 0))}` : 'Нет подключения к сети — поставьте столб рядом'}</div>`; };
    switch (e.t) {
      case 'furnace': {
        const ik = Object.keys(e.input!)[0] || null, ok = Object.keys(e.output!)[0] || null;
        b += `<div class="row">${fuelSlot ? `<div>${fuelSlot}</div>` : ''}${slot(ik, ik ? e.input![ik] : null, 'input:' + ik, 'Вход')}<div class="arrow">➜</div>${slot(ok, ok ? e.output![ok] : null, 'output:' + ok, 'Выход')}</div>${prog(e.crafting ? e.progress! : 0)}`;
        b += `<div class="dim small">Скорость ${p.speed}. Плавит: руда → пластины, камень → кирпич${g.enabled.has('steel-plate') ? ', железо → сталь' : ''}.</div>`; break;
      }
      case 'drill': {
        let n = 0; for (const [x, y] of g.drillTiles(e)) n += g.world.res(x, y) ? g.world.amt(x, y) : 0;
        b += `<div class="row">${fuelSlot ? `<div>${fuelSlot}</div>` : ''}<div>Скорость: ${p.speed} ед/с<br>Руды в зоне: ${fmt(n)}</div></div>${prog(e.progress!)}${power()}`; break;
      }
      case 'assembler': {
        let rl = '<div class="grid g10 recipes">';
        const cats = p.cats || ['crafting'];
        for (const rid of RECIPE_LIST) { const r = RECIPES[rid]; if (!cats.includes(r.cat) || !g.enabled.has(rid)) continue; rl += `<div class="slot ${e.recipe === rid ? 'sel' : ''}" data-act="setrecipe" data-r="${rid}" data-tip="recipe:${rid}"><img src="${iconURL(r.out[0][0])}"></div>`; }
        if (rl === '<div class="grid g10 recipes">') rl += '<div class="dim">Нет изученных рецептов — см. технологии (T)</div>';
        rl += '</div>';
        if (e.recipe) {
          const r = RECIPES[e.recipe];
          const fl = (it: string, io: 'in' | 'out') => { const n = g.fluidNetFor(e, it, io); return n ? Math.floor(n.amount) : 0; };
          const ins = r.in.map(([it, k]) => ITEMS[it].fluid ? `<div class="lab">${k}×${slotHTML(it, fl(it, 'in'))}</div>` : `<div class="lab">${k}×${slotHTML(it, e.input![it] || 0, `data-act="take" data-slot="input:${it}"`)}</div>`).join('');
          const outs = r.out.map(([o, k]) => ITEMS[o].fluid ? `<div class="lab">${k}×${slotHTML(o, fl(o, 'out'))}</div>` : `<div class="lab">${k}×${slotHTML(o, e.output![o] || 0, e.output![o] ? `data-act="take" data-slot="output:${o}"` : '')}</div>`).join('');
          b += `<div class="row">${ins}<div class="arrow">➜</div>${outs}</div>${p.fluid ? '<div class="dim small">Жидкости: входы — снизу, выходы — сверху (порядок слева направо как в рецепте).</div>' : ''}${prog(e.crafting ? e.progress! : 0)}<div class="dim small">Время: ${(r.time / p.speed!).toFixed(2)} с за цикл</div>`;
        }
        b += power() + `<div class="lbl">Рецепт: ${e.recipe && RECIPES[e.recipe] ? `<button class="mini" data-act="calcrec" data-k="${RECIPES[e.recipe].out[0][0]}" title="Калькулятор">🧮 Калькулятор</button>` : ''}</div>${rl}`; break;
      }
      case 'lab': {
        const cur = g.research.current;
        b += `<div class="row">${SCIENCE_PACKS.map(pk => slotHTML(pk, e.input![pk] || 0, `data-act="take" data-slot="input:${pk}"`)).join('')}</div>`;
        b += cur ? `<div>Изучается: <b>${TECHS[cur].name}</b> ${g.research.progress}/${g.techCost(cur)}</div>${prog(e.crafting ? e.progress! : 0)}` : `<div class="dim">Выберите исследование (T)</div>`;
        b += power(); break;
      }
      case 'chest': {
        if (p.logi) { b = this.logiChest(e); break; }
        b = this.chestGrid(e) + `<button data-act="takeall">Забрать всё</button>`; break;
      }
      case 'turret': {
        b += `<div class="row">${slot(e.ammo?.item || null, e.ammo?.count ?? null, 'ammo', 'Патроны')}<div>В стволе: ${e.rounds || 0}<br>Дальность: ${p.range} клеток<br>Урон: ${e.ammoType ? ITEMS[e.ammoType].ammo : ITEMS['firearm-magazine'].ammo} за выстрел</div></div><div class="dim small">Кладите магазины руками или манипулятором (до 10).</div>`; break;
      }
      case 'nest': b += `<div>Прочность: ${Math.ceil(e.hp || 0)}/${p.hp}</div><div class="dim small">Гнездо Роя. Уничтожение повышает эволюцию.</div>`; break;
      case 'wall': b = `<div>Прочность: ${Math.ceil(e.hp || 0)}/${p.hp}</div><div class="dim small">Задерживает ползунов. Ремонт: ремонтный набор в руке + ЛКМ.</div>`; break;
      case 'lamp': b += `<div>${e.active ? 'Светит' : e.cc?.en && this.wired(e) ? 'Выключена условием' : 'Включится ночью'}</div>${power()}`; break;
      case 'combinator': b = this.combinatorHTML(e); break;
      case 'loco': case 'wagon': b = this.trainHTML(e, fuelSlot); break;
      case 'stop': b = this.stopHTML(e); break;
      case 'tpump': b += `<div class="row2">Режим: <button data-act="tpm" data-v="0" class="${e.pm === 1 ? '' : 'on'}">Налив в цистерну</button><button data-act="tpm" data-v="1" class="${e.pm === 1 ? 'on' : ''}">Слив из цистерны</button></div>`
        + (e._fn ? (() => { const n = g.fluidNets[e._fn![0]]; return n ? `<div>Трубы: ${fluidName(n.fluid)} ${n.amount.toFixed(0)} / ${n.cap}</div>` : ''; })() : '') + power()
        + '<div class="dim small">Ставится вплотную к пути: стрелка — к вагону-цистерне, сзади — трубы. Работает, пока поезд стоит на станции. 20 ед. за тик (1200/с).</div>'; break;
      case 'signal': b = this.signalHTML(e); break;
      case 'arith': case 'decider': b = this.combHTML(e) + power(); break;
      case 'pumpjack': case 'tank':
      case 'boiler': case 'engine': case 'pump': case 'pipe': {
        if (e.t === 'pumpjack') b += `<div>Выход источника: ${g.world.amt(e.x + 1, e.y + 1)}% → ${(p.speed! * g.world.amt(e.x + 1, e.y + 1) / 100).toFixed(1)} нефти/с</div>${power()}`;
        b += fuelSlot ? `<div class="row">${fuelSlot}</div>` : '';
        if (e._fn) e._fn.forEach((ni) => { const n = g.fluidNets[ni]; if (!n) return; const nm = fluidName(n.fluid); b += `<div>${nm}: ${n.amount.toFixed(0)} / ${n.cap} ${n.conflict ? '<span class="err">смешение жидкостей!</span>' : ''}</div><div class="bar sm ${n.fluid}"><i style="width:${(n.cap ? n.amount / n.cap * 100 : 0).toFixed(0)}%"></i></div>`; });
        if (e.t === 'engine') b += `<div>Выработка: ${kw(e._out || 0)} из ${kw(p.maxOut!)}</div>${e._net! < 0 ? '<div class="err">Не подключён к столбу</div>' : ''}`;
        if (e.t === 'boiler') b += `<div class="dim small">1.8 МВт · 60 воды/с → 60 пара/с. Вода — по бокам, пар — сверху (по стрелке).</div>`;
        if (e.t === 'pump') b += `<div class="dim small">1200 воды/с</div>`;
        break;
      }
      case 'pole': {
        const n = g.powerNets.get(e._net!);
        if (n) {
          b = `<div>Потребление: <b>${kw(n.demand)}</b></div><div>Производство (макс.): <b>${kw(n.supply)}</b></div><div>Удовлетворение: <b>${(n.satisfaction * 100).toFixed(0)}%</b></div>`;
          b += `<div class="dim">Пар: ${kw(n.steam || 0)} · солнце: ${kw(n.solar || 0)} · аккумуляторы: ${(n.accFlow || 0) >= 0 ? 'заряд ' : 'разряд '}${kw(Math.abs(n.accFlow || 0))}</div>`;
          if (n.storeCap) b += `<div>Запас: ${((n.stored || 0) / 1e6).toFixed(1)} / ${(n.storeCap / 1e6).toFixed(0)} МДж</div><div class="bar sm"><i style="width:${((n.stored || 0) / n.storeCap * 100).toFixed(0)}%"></i></div>`;
          const mx = Math.max(1, ...n.hist.map(x => Math.max(x.d, x.s)));
          b += '<svg class="graph" viewBox="0 0 100 40" preserveAspectRatio="none">' + ['s', 'd'].map(k => `<polyline fill="none" stroke="${k === 's' ? '#4be36b' : '#ffb347'}" stroke-width="1" points="${n.hist.map((x: any, i) => `${i},${40 - x[k] / mx * 38}`).join(' ')}"/>`).join('') + '</svg><div class="dim small"><span style="color:#4be36b">■</span> доступно <span style="color:#ffb347">■</span> потребление · последние 10 с</div>';
          const by: Record<string, number> = {}; for (const x of g.ents.values()) if (x._net === n.id && PROTOS[x.proto].energy?.kind === 'electric') by[x.proto] = (by[x.proto] || 0) + (x.active ? PROTOS[x.proto].energy!.kW : PROTOS[x.proto].energy!.drainKW || 0);
          b += '<div class="lbl">По типам:</div>' + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="kv"><img src="${iconURL(k)}"> ${PROTOS[k].name}<span>${kw(v)}</span></div>`).join('');
        }
        break;
      }
      case 'inserter': {
        b += `<div class="row">${fuelSlot ? `<div>${fuelSlot}</div>` : ''}<div>В руке: ${e.hand ? ITEMS[e.hand].name + (e.hn ? ' ×' + e.hn : '') : '—'}<br>Скорость: ${p.rot} об/с${p.hand ? '<br>Берёт за раз: ' + g.handCap(e) + ' · на ленту — стопкой до 4' : ''}</div></div>${power()}`; break;
      }
      case 'belt': case 'underground': case 'splitter': {
        const cnt = e.lanes!.reduce((a, s) => a + s[0].length + s[1].length, 0); b = `<div>Предметов: ${cnt}</div><div>Скорость: ${(p.speed! * 60 / 256).toFixed(3)} клетки/с (${(p.speed! * 60 / 256 * 8).toFixed(1)} предм/с)</div>`; break;
      }
      case 'accumulator': {
        const A = p.accum!; const n = g.powerNets.get(e._net!);
        b += `<div>Заряд: <b>${((e.charge || 0) / 1e6).toFixed(2)} / ${A.MJ} МДж</b></div><div class="bar"><i style="width:${((e.charge || 0) / (A.MJ * 1e6) * 100).toFixed(0)}%"></i></div><div>${(e._out || 0) >= 0 ? 'Заряд' : 'Разряд'}: ${kw(Math.abs(e._out || 0))} (макс. ${kw(A.kW)})</div>`;
        if (n && n.storeCap) b += `<div class="dim">Вся сеть: ${((n.stored || 0) / 1e6).toFixed(1)} / ${(n.storeCap / 1e6).toFixed(0)} МДж</div>`;
        b += `<div class="dim small">Заряжается от излишков (солнце и свободная мощность паровых машин), отдаёт энергию ночью и при пиках.</div>`; break;
      }
      case 'beacon': b += `<div>Передаёт <b>50%</b> эффекта своих модулей всем постройкам с модулями в радиусе ${p.beaconRange} клеток от края.</div><div class="dim small">Модули продуктивности маяк не принимает.</div>${power()}`; break;
      case 'radar': b += `<div>Постоянно видит ${7}×${7} чанков вокруг, раз в 30 с разведывает новый чанк.</div>${prog(e.progress || 0)}${power()}`; break;
      case 'silo': {
        const r = RECIPES['rocket-part'];
        const ins = r.in.map(([it, k]) => `<div class="lab">${k}×${slotHTML(it, e.input![it] || 0, `data-act="take" data-slot="input:${it}"`)}</div>`).join('');
        b += `<div class="row">${ins}<div class="arrow">➜</div><div class="lab">Части ракеты<b style="font-size:20px">${e.parts || 0}/100</b></div></div>${prog((e.parts || 0) / 100)}${prog(e.crafting ? e.progress! : 0)}`;
        b += `<div class="row">${slot(e.satellite ? 'satellite' : null, e.satellite || null, 'satellite', '🛰 Спутник')}<div class="arrow">🚀</div>${slot(e.output!['space-science-pack'] ? 'space-science-pack' : null, e.output!['space-science-pack'] || null, 'output:space-science-pack', 'Космос')}</div>`;
        if (e.launchT) b += `<div class="ok">Запуск через ${Math.ceil(e.launchT / 60)} с…</div>${prog(1 - e.launchT / 900)}`;
        b += `<div class="dim">Запущено ракет: <b>${g.rockets}</b></div>${power()}<div class="dim small">100 частей ракеты + спутник → автоматический запуск. Ракета приносит 1000 пакетов «Космос».</div>`; break;
      }
      case 'roboport': {
        const R = p.robo!, B = p.buffer!;
        b += `<div>Буфер: <b>${((e.charge || 0) / 1e6).toFixed(1)} / ${B.MJ} МДж</b> · зарядка до ${kw(B.kW)}</div><div class="bar"><i style="width:${((e.charge || 0) / (B.MJ * 1e6) * 100).toFixed(0)}%"></i></div>${power()}`;
        b += `<div class="lbl">Роботы (${R.robotSlots} ячеек) и ремонтные наборы (${R.repairSlots})</div><div class="grid g7" id="roboslots">` + e.inv!.slots.map((s, i) => slotHTML(s?.item || null, s?.count ?? null, s ? `data-act="take" data-slot="chest:${i}"` : `data-act="eslot" data-slot="chest:${i}"`)).join('') + `</div><div class="row2"><button data-act="quickload">Загрузить роботов и наборы из инвентаря</button><button data-act="takeall">Забрать всё</button></div>`;
        const net = robotView(g, ITEM_IDX, true).nets.find(n => n.ports.includes(e.id));
        if (net) {
          const tk: Record<string, string> = { build: 'стройка', decon: 'снос', tree: 'вырубка', upgrade: 'улучшение', repair: 'ремонт', deliver: 'доставка' };
          b += `<div class="lbl">Сеть: ${net.ports.length} ${net.ports.length === 1 ? 'робопорт' : 'робопорта(ов)'}</div><div class="robonet">`
            + `<div class="kv">Свободны (в робопортах)<span id="rn-idle">${net.idle}</span></div><div class="kv">В работе<span id="rn-work">${net.working}</span></div><div class="kv">Заряжаются<span id="rn-chg">${net.charging}</span></div><div class="kv">Ремонтных наборов<span>${net.repair}</span></div><div class="kv">Логистических: свободны<span id="rn-lidle">${net.lidle}</span></div><div class="kv">в полёте<span>${net.lwork}</span></div></div>`;
          const tasks = Object.entries(net.tasks); b += `<div class="small">Очередь задач: ${tasks.length ? tasks.map(([k, n]) => `${tk[k] || k} ${n}`).join(' · ') : '<span class="dim">пусто</span>'}</div>`;
          if (net.noRobot) b += `<div class="err small">Ждут свободного робота: ${net.noRobot} призр. — добавьте роботов</div>`;
          if (net.missing.length) b += `<div class="lbl">Не хватает предметов для стройки:</div><div class="row" id="rn-miss">${net.missing.slice(0, 10).map(([it, n]) => `<div class="lab">${slotHTML(it, n)}</div>`).join('')}</div><div class="dim small">Положите их в сундук хранения или снабжения в жёлтой зоне или держите в инвентаре, стоя в зоне сети.</div>`;
        }
        b += `<div class="dim small">Зона стройки ${R.cz}×${R.cz} (оранжевая), логистики ${R.lz}×${R.lz} (жёлтая), ${R.spots} места зарядки по ${kw(R.spotKW)}. Логистические сундуки в жёлтой зоне — склад сети (L — окно сети).</div>`; break;
      }
      case 'solar': b += `<div>Выработка: ${kw(e._out || 0)} из ${kw(p.maxOut!)} (день/ночь: ${(g.daylight() * 100).toFixed(0)}%)</div>`; break;
    }
    if (moduleSlots(e)) {
      b += `<div class="lbl">Модули:</div><div class="row">${e.modules!.map((m, i) => slotHTML(m, null, m ? `data-act="take" data-slot="module:${i}"` : '')).join('')}</div>`;
      const f = fx(g, e); if (e.t !== 'beacon' && (f.speed || f.prod || f.energy || f.pollution)) b += `<div class="small fxl">Скорость <b>${pct(f.speed)}</b> · продуктивность <b>${pct(f.prod)}</b> · энергия <b>${pct(f.energy)}</b> · загрязнение <b>${pct(f.pollution)}</b></div>`;
      if (e.pbar) b += `<div class="dim small">Бонус продуктивности:</div><div class="bar sm prod"><i style="width:${Math.min(100, e.pbar * 100).toFixed(0)}%"></i></div>`;
    }
    if (e.t !== 'combinator' && !hasOut(e) && circuitCapable(e) && (this.wired(e) || e.cc?.setr)) b += this.circuitHTML(e);
    if (e.hp != null && e.hp < p.hp && e.t !== 'nest' && e.t !== 'wall') b += `<div class="err">Повреждено: ${Math.ceil(e.hp)}/${p.hp} — ремонтный набор в руке + ЛКМ</div>`;
    const canPut = moduleSlots(e) > 0 || e.t === 'silo' || e.t === 'roboport' || ['furnace', 'drill', 'assembler', 'lab', 'chest', 'boiler', 'inserter', 'turret'].includes(e.t) && (e.t !== 'drill' || p.energy?.kind === 'burner') && (e.t !== 'inserter' || p.energy?.kind === 'burner');
    return `<div class="panel"><div class="title">${p.name} <span class="x" data-act="close">✕</span></div>${b}</div>` + (canPut ? `<div class="panel"><div class="title">Инвентарь</div>${this.invGrid('put')}<div class="dim small">ЛКМ — положить стопку, Shift — всё такого типа, ПКМ — половину в руку. Ctrl+ЛКМ по постройке — загрузить всё нужное.</div></div>` : '');
  }
  private techWindow() {
    const g = this.g; let h = '';
    for (let era = 0; era < ERA_NAMES.length; era++) {
      const list = TECH_LIST.filter(t => techEra(t) === era); if (!list.length) continue;
      const nDone = list.filter(t => !t.infinite && g.research.done.has(t.id)).length;
      h += `<div class="era">${ERA_NAMES[era]} <span class="dim">${list.some(t => t.infinite) ? '' : `${nDone}/${list.length}`}</span></div><div class="techs">`;
      for (const t of list) {
        const lv = g.research.levels[t.id] || 0, cost = g.techCost(t.id);
        const done = !t.infinite && g.research.done.has(t.id), avail = g.canResearch(t.id), cur = g.research.current === t.id;
        h += `<div class="tech ${done ? 'done' : avail ? 'avail' : 'locked'} ${cur ? 'cur' : ''}" ${avail ? `data-act="research" data-t="${t.id}"` : ''}>
        <div class="tn">${t.name}${t.infinite ? ` <span class="lvl">ур. ${lv + 1}</span>` : ''}</div><div class="td">${t.desc}</div>
        <div class="tc">${t.packs.map(pk => `<img src="${iconURL(pk)}">`).join('')} × ${cost} · ${t.time} с</div>
        <div class="tu">${t.unlocks.map(u => `<img src="${iconURL(RECIPES[u].out[0][0])}" data-tip="item:${RECIPES[u].out[0][0]}">`).join('')}</div>
        ${t.infinite ? (() => { const gn = techGain(t, lv); return `<div class="dim small">Изучено уровней: ${lv} · бонус сейчас ${pct(lv * t.infinite.per)}</div><div class="small ok">Следующий уровень: ×${gn.from.toFixed(2)} → ×${gn.to.toFixed(2)} (+${(gn.rel * 100).toFixed(1)}% к текущему)</div>`; })() : ''}
        ${t.prereq.length && !done ? `<div class="tp">Нужно: ${t.prereq.map(p => `<span class="${g.research.done.has(p) ? 'ok' : ''}">${TECHS[p].name}</span>`).join(', ')}</div>` : ''}
        ${cur ? `<div class="bar sm"><i style="width:${g.research.progress / cost * 100}%"></i></div>` : ''}
        ${done ? '<div class="ok">✔ Изучено</div>' : ''}</div>`;
      }
      h += '</div>';
    }
    const total = TECH_LIST.filter(t => !t.infinite).length, nd = TECH_LIST.filter(t => !t.infinite && g.research.done.has(t.id)).length;
    return `<div class="panel wide tall"><div class="title">Технологии <span class="dim small">изучено ${nd}/${total}</span> <span class="x" data-act="close">✕</span></div><div class="scroll">${h}</div><div class="dim small">Нажмите на доступную технологию. Пакеты кладите в лаборатории.</div></div>`;
  }
  private statsWindow() {
    // v1.9: статистика 2.0 — окна 5 мин … 50 ч, вкладки «Предметы», «Жидкости», «Энергия», «Узкие места» (src/ui/produi.ts)
    const g = this.g;
    const extra = g.settings.enemies !== 'none' ? `<div class="row2">Рой: <b>${MODE_NAMES[g.settings.enemies]}</b> · эволюция <b>${(g.evolution * 100).toFixed(2)}%</b> · ползунов: ${g.units.length} · уничтожено: ${g.stats.kills} · потеряно построек: ${g.stats.lost}
        ${g.settings.enemies === 'peaceful' || g.settings.enemies === 'normal' ? `<button data-act="mode">${g.settings.enemies === 'peaceful' ? 'Включить атаки' : 'Мирный режим'}</button>` : ''}</div>` : '';
    return this.prod.statsHtml(extra + `<div class="dim small">Ракет запущено: <b>${g.rockets}</b> · время игры ${Math.floor(g.tick / 216000)} ч ${Math.floor(g.tick / 3600) % 60} мин</div>`);
  }
  // ---------- чертежи ----------
  bpLib(): BpEntry[] { try { const a = JSON.parse(localStorage.getItem(BP_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => validBp(x?.bp)) : []; } catch { return []; } }
  private saveLib(a: BpEntry[]) { try { localStorage.setItem(BP_KEY, JSON.stringify(a)); } catch (e) { this.g.msg('Не удалось сохранить библиотеку: ' + (e as Error).message); } }
  addBp(bp: Blueprint) { const a = this.bpLib(); a.unshift({ name: bp.name, bp, time: Date.now() }); this.saveLib(a.slice(0, 60)); if (this.open === 'bp') this.render(true); }
  private bpWindow() {
    const g = this.g; const lib = this.bpLib(); const cur = this.h.curBp();
    const list = lib.map((x, i) => `<div class="bp"><div class="bpi">${x.bp.icons.slice(0, 4).map(ic => `<img src="${iconURL(ic)}">`).join('')}</div><div class="bpn"><b>${esc(x.name)}</b><div class="dim small">${x.bp.w}×${x.bp.h} · ${x.bp.entities.length} построек</div></div>
      <button data-act="bptake" data-i="${i}">В руку</button><button data-act="bpcopy" data-i="${i}">Строка</button><button data-act="bpren" data-i="${i}">Имя</button><button data-act="bpdel" data-i="${i}">Удалить</button></div>`).join('') || '<div class="dim">Библиотека пуста. Ctrl+C и выделите область, чтобы создать чертёж.</div>';
    let need = '';
    if (cur) { const cost = bpCost(cur); need = `<div class="lbl">Нужно для «${esc(cur.name)}» (в руке):</div><div class="grid g10">` + Object.entries(cost).map(([it, n]) => { const have = g.inv.count(it); return `<div class="slot ${have >= n ? '' : 'miss'}" data-tip="item:${it}"><img src="${iconURL(it)}"><span class="cnt">${n}</span></div>`; }).join('') + '</div><div class="dim small">Красные — не хватает в инвентаре: такие постройки станут призраками и будут построены, когда предметы появятся.</div>'; }
    const filt = [['all', 'Всё'], ['belts', 'Только конвейеры'], ['nobelts', 'Всё, кроме конвейеров']].map(([v, l]) => `<button data-act="dfilt" data-v="${v}" class="${this.deconFilter === v ? 'on' : ''}">${l}</button>`).join('');
    const ups = UPGRADES.map(([a, b]) => `<button data-act="upg" data-v="${a}" class="${this.upgradeOn[a] ? 'on' : ''}">${this.upgradeOn[a] ? '☑' : '☐'} <img src="${iconURL(a)}">→<img src="${iconURL(b)}"></button>`).join('');
    return `<div class="panel wide tall"><div class="title">Чертежи и планировщики <span class="x" data-act="close">✕</span></div>
      <div class="row2"><button data-act="tool" data-v="copy">Копировать (Ctrl+C)</button><button data-act="tool" data-v="cut">Вырезать (Ctrl+X)</button><button data-act="tool" data-v="decon">Снос (Alt+D)</button><button data-act="tool" data-v="upgrade">Улучшение (Alt+U)</button><button data-act="tool" data-v="cancel">Отменить стройку</button><button data-act="undo">Отменить (Ctrl+Z)</button><button data-act="redo">Повторить (Ctrl+Y)</button></div>
      <div class="scroll" style="max-height:34vh">${list}</div>
      <div class="lbl">Импорт строки чертежа</div><div class="row2"><textarea id="bpstr" rows="2" placeholder="0eNq..."></textarea><button data-act="bpimport">Импорт</button></div>${this.bpMsg ? `<div class="small">${esc(this.bpMsg)}</div>` : ''}
      ${need}
      <div class="lbl">Планировщик сноса</div><div class="row2">${filt}<button data-act="dtrees" class="${this.deconTrees ? 'on' : ''}">${this.deconTrees ? '☑' : '☐'} Деревья и скалы</button></div>
      <div class="lbl">Планировщик улучшений</div><div class="row2 ups">${ups}</div>
      <div class="row2"><button data-act="clearghosts">Удалить все призраки (${g.ghosts.size})</button><span class="dim small">ПКМ-рамка любым планировщиком — снять пометки. Инженер сам строит призраки и сносит помеченное в радиусе ${10} клеток.</span></div></div>`;
  }
  upgradeMap() { const m: Record<string, string> = {}; for (const [a, b] of UPGRADES) if (this.upgradeOn[a]) m[a] = b; return m; }
  private settingsWindow() {
    const st = this.h.getSettings();
    const sl = (k: keyof Settings, label: string) => `<div class="kv set">${label}<input type="range" min="0" max="100" value="${Math.round((st[k] as number) * 100)}" data-set="${k}"><span>${Math.round((st[k] as number) * 100)}%</span></div>`;
    const ck = (k: keyof Settings, label: string) => `<button data-act="setb" data-k="${k}" class="${st[k] ? 'on' : ''}">${st[k] ? '☑' : '☐'} ${label}</button>`;
    const keys = ACTIONS.map(([a, label]) => `<tr><td>${label}</td><td><button data-act="rebind" data-k="${a}" class="${this.rebinding === a ? 'on' : ''}">${this.rebinding === a ? 'нажмите клавишу…' : keyName(st.keys[a])}</button></td></tr>`).join('');
    return `<div class="panel"><div class="title">Настройки <span class="x" data-act="close">✕</span></div>
      <div class="lbl">Звук</div>${sl('master', 'Общая громкость')}${sl('sfx', 'Эффекты')}${sl('music', 'Музыка')}${sl('ambient', 'Шум завода')}
      <div class="lbl">Графика</div>
      <div class="row2">Качество: ${(['high', 'medium', 'low', 'min'] as const).map(v => `<button data-act="gfx" data-v="${v}" class="${st.gfx === v ? 'on' : ''}">${PRESET_NAMES[v]}</button>`).join(' ')}${st.gfx === 'custom' ? ' <span class="dim small">свои настройки</span>' : ''}${st.gfxAuto && st.gfx !== 'custom' ? ' <span class="dim small">подобрано автоматически</span>' : ''}</div>
      <div class="dim small">«Низкое» и «Минимум» — для слабых ПК и ноутбуков без видеокарты: меньше разрешение и текстуры, без дыма, ограничение кадров.</div>
      <div class="row2">Разрешение: ${[[0.5, '50%'], [0.75, '75%'], [1, '100%']].map(([v, l]) => `<button data-act="res" data-v="${v}" class="${st.resScale === v ? 'on' : ''}">${l}</button>`).join(' ')} · Чёткость (Retina/4K): ${[[1, '1×'], [1.5, '1,5×'], [2, '2×'], [3, 'макс.']].map(([v, l]) => `<button data-act="dpr" data-v="${v}" class="${st.dprMax === v ? 'on' : ''}">${l}</button>`).join(' ')}</div>
      <div class="row2">Кадров в секунду: ${[[0, 'без ограничения'], [60, '60'], [30, '30']].map(([v, l]) => `<button data-act="fps" data-v="${v}" class="${st.fpsCap === v ? 'on' : ''}">${l}</button>`).join(' ')} ${ck('detail', 'Подробная земля вблизи')}${ck('lod', 'Карта издалека (LOD)')}</div>
      <div class="row2">Текстуры: ${[[2048, '2K'], [1024, '1K'], [512, '512']].map(([v, l]) => `<button data-act="tex" data-v="${v}" ${texQuality() === v ? 'class="on"' : ''}>${l}</button>`).join(' ')}</div>
      <div class="row2">Рендер: ${[['auto', 'Авто'], ['webgl', 'WebGL2'], ['canvas', 'Canvas2D']].map(([v, l]) => `<button data-act="render" data-v="${v}" class="${(st.renderer || 'auto') === v ? 'on' : ''}">${l}</button>`).join(' ')}<span class="dim small">сейчас: ${this.h.rendererMode() === 'webgl' ? 'WebGL2' : 'Canvas2D'}${this.h.rendererNote() === 'soft' ? ' (WebGL без видеокарты — программный, Canvas2D быстрее)' : this.h.rendererNote() === 'nogl' ? ' (WebGL2 недоступен)' : ''}</span></div>
      <div class="row2">${ck('smoke', 'Дым')}${ck('dayNight', 'Ночное затемнение')}${ck('shake', 'Тряска экрана')}${ck('colorblind', 'Режим для дальтоников')}</div>
      <div class="kv set">Масштаб интерфейса<input type="range" min="75" max="200" step="5" value="${Math.round(st.uiScale * 100)}" data-set="uiScale"><span>${Math.round(st.uiScale * 100)}%</span></div>
      <div class="lbl">Мышь и тачпад</div><div class="row2">Колесо / прокрутка: ${[['auto', 'Авто'], ['mouse', 'Мышь (по щелчку)'], ['touchpad', 'Тачпад (плавно)']].map(([v, l]) => `<button data-act="wheel" data-v="${v}" class="${st.wheel === v ? 'on' : ''}">${l}</button>`).join(' ')}${this.h.isMac() ? ' ' + ck('ctrlClick', 'Ctrl+щелчок = правая кнопка') : ''}</div>
      <div class="dim small">Масштаб: колесо мыши, прокрутка двумя пальцами или щипок. Добыча — правая кнопка: на тачпаде нажатие двумя пальцами${this.h.isMac() ? ' или Ctrl+щелчок' : ''}.</div>
      <div class="lbl">Озвучка</div>${sl('voice', 'Голос ОСКАРа')}
      <div class="row2">Озвучка интерфейса: ${[['off', 'выкл'], ['important', 'важное'], ['all', 'всё']].map(([v, l]) => `<button data-act="uivoice" data-v="${v}" class="${st.uiVoice === v ? 'on' : ''}">${l}</button>`).join(' ')} · Темп: ${[[0.85, 'медленно'], [1, 'обычно'], [1.2, 'быстро']].map(([v, l]) => `<button data-act="vrate" data-v="${v}" class="${st.voiceRate === v ? 'on' : ''}">${l}</button>`).join(' ')}</div>
      <div class="row2">${this.h.voiceList().length ? `Голос: <select id="voicesel"><option value="">Авто</option>${this.h.voiceList().map(n => `<option value="${esc(n)}" ${st.voiceName === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : '<span class="dim small">Голосов для этого языка в браузере нет — ОСКАР говорит синтезированными сигналами</span>'} <button data-act="vtest">▶ Проверить</button></div>
      <div class="dim small">«Важное»: атаки, исследования, гибель, сохранение. «Всё»: все сообщения, названия окон и подсказки под курсором — для тех, кому трудно читать с экрана.</div>
      <div class="row2">${ck('tips', 'Обучающие подсказки в окнах')}<button data-act="tipsreset">Показать подсказки заново</button></div>
      <div class="lbl">Игра</div><div class="row2">Язык / Language: ${[['ru', 'Русский'], ['en', 'English']].map(([v, l]) => `<button data-act="lang" data-v="${v}" class="${st.lang === v ? 'on' : ''}">${l}</button>`).join(' ')}</div>
      <div class="row2">${ck('simWorker', 'Симуляция в отдельном потоке (Worker)')}<span class="dim small">${st.simWorker !== this.h.workerActive() ? 'вступит в силу после перезагрузки' : ''}</span></div>
      <div class="row2">Автосохранение: ${[[0, 'выкл'], [2, '2 мин'], [5, '5 мин'], [10, '10 мин']].map(([v, l]) => `<button data-act="autos" data-v="${v}" class="${st.autosaveMin === v ? 'on' : ''}">${l}</button>`).join(' ')}</div>
      <div class="dim small">Хранилище: ${esc(this.h.storageInfo() || '…')}</div></div>
    <div class="panel"><div class="title">Клавиши</div><table class="keys">${keys}</table><div class="row2"><button data-act="keysreset">Сбросить клавиши</button></div><div class="dim small">Щёлкните по клавише и нажмите новую (Esc — отмена). Сочетания Ctrl+C/X/V/Z/Y, Alt+D/U, Shift и колесо не переназначаются.</div></div>`;
  }
  private victoryWindow() {
    const g = this.g; const st = g.stats; const built = Object.values(st.built).reduce((a, b) => a + b, 0); const prod = Object.values(st.produced).reduce((a, b) => a + b, 0);
    return `<div class="panel menu victory"><div class="title">🚀 Маяк на орбите! <span class="x" data-act="close">✕</span></div>
      <div class="big">ОСКАР: Сигнал принят. Спасательный корабль будет через 40 суток. Хорошая работа, инженер.</div>
      <table class="keys"><tr><td>Время игры</td><td><b>${Math.floor(g.tick / 216000)} ч ${Math.floor(g.tick / 3600) % 60} мин</b></td></tr><tr><td>Ракет запущено</td><td><b>${g.rockets}</b></td></tr>
      <tr><td>Изучено технологий</td><td><b>${g.research.done.size}</b></td></tr><tr><td>Построено объектов</td><td><b>${fmt(built)}</b></td></tr><tr><td>Произведено предметов</td><td><b>${fmt(prod)}</b></td></tr>
      <tr><td>Уничтожено врагов</td><td><b>${st.kills}</b></td></tr><tr><td>Эволюция Роя</td><td><b>${(g.evolution * 100).toFixed(1)}%</b></td></tr></table>
      <button class="big" data-act="close">Продолжить строить (свободная игра)</button><div class="dim small">Пакеты «Космос» открывают бесконечные исследования: продуктивность добычи, урон, скорость лабораторий.</div></div>`;
  }
  private betaWindow() {
    const r = this.tele;
    if (!r) return `<div class="panel wide"><div class="title">Статистика партии <span class="x" data-act="close">✕</span></div><div class="dim">Загрузка…</div></div>`;
    const m = (v: number | null | undefined) => v == null ? '—' : v < 1 ? `${Math.round(v * 60)} с` : v < 120 ? `${v.toFixed(1)} мин` : `${Math.floor(v / 60)} ч ${Math.round(v % 60)} мин`;
    const ck = r.checklist.map((c: any) => `<tr><td>${c.ok === true ? '<span class="ok">✔</span>' : c.ok === false ? '<span class="err">✘</span>' : '·'}</td><td>${esc(c.item)}</td><td>≤ ${m(c.limit)}</td><td><b>${m(c.min)}</b></td></tr>`).join('');
    const goals = r.goals.map((x: any) => `<tr><td>${x.n}</td><td>${esc(x.goal || '')}</td><td><b>${m(x.min)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="dim">Пока ни одной цели</td></tr>';
    const packs = SCIENCE_PACKS.map(p => `<div class="kv"><img src="${iconURL(p)}"> ${ITEMS[p].name}: <b>${m(r.packs[p])}</b></div>`).join('');
    const stalls = r.stalls.slice(-6).map((x: any) => `<tr><td>${m(x.min)}</td><td>цель ${x.goal + 1}: ${esc(x.goalText || '')} — ${x.stalledMin} мин</td><td class="dim">${x.problems.map((p: any) => p[0] + ' ×' + p[1]).join(', ')}</td></tr>`).join('');
    return `<div class="panel wide tall"><div class="title">Статистика партии <span class="x" data-act="close">✕</span></div>
      <div class="dim small">Для бета-теста: время до каждой цели ОСКАРа, каждой науки и ракеты, гибели, места, где игра застопорилась. Только игровые данные, хранятся в сохранении и никуда не отправляются — файл можно передать разработчикам вручную.</div>
      <div class="row2">Время игры: <b>${m(r.playMin)}</b> · цель ${r.goalNow.n}${r.goalNow.goal ? ' — ' + esc(r.goalNow.goal) : ''} (${m(r.goalNow.sinceMin)}) · гибелей: <b>${r.deaths.length}</b> · ракет: <b>${r.totals.rockets}</b>${r.fromMin > 0 ? ` · <span class="dim">статистика ведётся с ${m(r.fromMin)} (сохранение старой версии)</span>` : ''}</div>
      <div class="row2"><button data-act="teleexport">Сохранить в файл (.json)</button><button data-act="telerefresh">Обновить</button><button data-act="teletoggle">${r.recording ? '☑' : '☐'} Записывать статистику</button></div>
      <div class="lbl">Чек-лист «первого часа» (20.5)</div><table class="keys">${ck}</table>
      <div class="lbl">Наука — первый пакет</div><div class="grid2">${packs}</div><div class="kv">🚀 Ракета: <b>${m(r.rocketMin)}</b></div>
      <div class="lbl">Цели ОСКАРа</div><table class="keys">${goals}</table>
      ${stalls ? `<div class="lbl">Застопорилось (нет новой цели дольше 20 мин)</div><table class="keys">${stalls}</table>` : ''}
      ${r.stuck.length ? `<div class="dim small">Инженер упирался и не мог пройти: ${r.stuck.length} раз (координаты — в файле)</div>` : ''}</div>`;
  }
  private contribWindow() {
    const n = this.h.errors(); const fb = this.h.feedback();
    const to = fb ? (/^mailto:|^https?:/.test(fb) ? `<a href="${esc(fb)}" target="_blank" rel="noopener">${esc(fb.replace(/^mailto:/, ''))}</a>` : esc(fb)) : '';
    return `<div class="panel wide"><div class="title">Помочь игре <span class="x" data-act="close">✕</span></div>
      <div class="small">Баланс и скорость игры проверены ботом и без видеокарты. Чтобы настроить их по живым партиям, нужны ваши файлы. В них только игровые данные и сведения о браузере, без личных данных; игра ничего не отправляет сама.</div>
      <div class="lbl">1. Статистика партии</div><div class="dim small">Время до каждой цели ОСКАРа, науки и ракеты, где игра застопорилась. Лучше всего — в конце игровой сессии.</div>
      <div class="row2"><button class="big" data-act="teleexport">Сохранить статистику (.json)</button><button data-act="beta">Посмотреть, что в ней</button></div>
      <div class="lbl">2. Замер производительности</div><div class="dim small">Около минуты: в новой вкладке откроется эталонная база (1 900 построек), игра измерит кадры и время кадра на вашей видеокарте. Текущая партия не меняется.</div>
      <div class="row2"><button data-act="benchopen">Запустить замер</button></div>
      <div class="lbl">3. Ошибки</div><div class="dim small">${n ? `<span class="err">Ошибок за сессию: ${n}.</span> ` : ''}Если что-то сломалось — отчёт (F8) с журналом и сохранением.</div>
      <div class="row2"><button data-act="bug">Отчёт об ошибке (F8)</button></div>
      <div class="lbl">Как отправить</div><div class="small">${to ? `Приложите файлы к письму или форме: ${to}.` : 'Приложите файлы к письму или сообщению разработчикам.'} Каждый файл — отдельная партия; несколько файлов одной партии тоже подходят, учтём последний.</div>
      <div class="row2"><button data-act="news">Что нового</button></div></div>`;
  }
  private newsWindow() {
    const ic: Record<string, string> = { new: '＋', balance: '⚖', fix: '✔' };
    const kinds: Record<string, string> = { new: 'Новое', balance: 'Баланс', fix: 'Исправлено' };
    const body = NEWS.map(v => `<div class="lbl">Версия ${esc(v.ver)} — ${esc(v.title)}</div>` + (['new', 'balance', 'fix'] as const).map(k => {
      const it = v.items.filter(i => i.kind === k); return it.length ? `<div class="small"><b>${kinds[k]}</b></div><ul class="small news">${it.map(i => `<li>${ic[k]} ${esc(i.text)}</li>`).join('')}</ul>` : '';
    }).join('')).join('');
    return `<div class="panel wide tall"><div class="title">Что нового <span class="x" data-act="close">✕</span></div>${body}
      <div class="dim small">Помогите настроить баланс: Esc → «Помочь игре» → «Сохранить статистику».</div><div class="row2"><button data-act="contrib">Помочь игре</button><button data-act="close">Закрыть</button></div></div>`;
  }
  private perfWindow() {
    const b = this.h.bench(); const f = b.file;
    const ph = f ? f.phases.map((p: any) => `<tr><td>${p.zoom === 1 ? 'Обычный масштаб' : 'Отдаление'}</td><td><b>${p.fps.toFixed(0)}</b></td><td>${p.frameP50.toFixed(1)} / ${p.frameP95.toFixed(1)} мс</td><td>${p.cpuP95.toFixed(1)} мс</td><td>${p.ups.toFixed(0)}</td></tr>`).join('') : '';
    return `<div class="panel wide"><div class="title">Замер производительности <span class="x" data-act="close">✕</span></div>
      ${b.running ? `<div class="small">${esc(b.text)}</div><div class="bar"><i style="width:${Math.round(b.frac * 100)}%"></i></div><div class="dim small">Не переключайте вкладку и не сворачивайте окно — иначе браузер перестанет рисовать кадры.</div>` : ''}
      ${f ? `<div class="small">Видеокарта: <b>${esc(String(f.system.gpu))}</b> · рендер ${esc(f.renderer)}${f.rendererNote ? ' (' + esc(f.rendererNote) + ')' : ''} · графика «${esc(PRESET_NAMES[f.preset as keyof typeof PRESET_NAMES] || f.preset)}» · построек ${f.ents}</div>
        <table class="keys"><tr><td></td><td>Кадр/с</td><td>Кадр: медиана / 95%</td><td>Главный поток, 95%</td><td>UPS</td></tr>${ph}</table>
        <div class="small">${f.ok60 ? '<span class="ok">✔ 60 FPS на эталонной базе</span>' : '<span class="err">✘ ниже 60 FPS</span> — попробуйте графику ниже (Esc → Настройки → Графика)'}</div>
        <div class="row2"><button class="big" data-act="benchsave">Сохранить результат (.json)</button><button data-act="benchcopy">Копировать</button></div>
        <div class="dim small">Приложите файл вместе со статистикой партии (Esc → «Помочь игре»). Эту вкладку можно закрыть.</div>` : ''}</div>`;
  }
  private bugWindow() {
    const n = this.h.errors();
    return `<div class="panel wide"><div class="title">Отчёт об ошибке <span class="x" data-act="close">✕</span></div>
      <div class="dim small">Опишите, что делали и что пошло не так. В отчёт попадут журнал игры (последние сообщения и ошибки), сведения о браузере и системе без личных данных и строка сохранения — по ней разработчик откроет ту же партию.${n ? ` <span class="err">Ошибок за сессию: ${n}</span>` : ''}</div>
      <textarea id="bugdesc" rows="4" placeholder="Что случилось?"></textarea>
      <div class="row2"><label><input type="checkbox" id="bugsave" checked> Приложить сохранение</label> <button data-act="bugmake">Собрать отчёт</button> <button data-act="bugcopy" ${this.bugText ? '' : 'disabled'}>Копировать</button> <button data-act="bugfile" ${this.bugText ? '' : 'disabled'}>Сохранить в файл (.txt)</button></div>
      ${this.bugMsg ? `<div class="small">${esc(this.bugMsg)}</div>` : ''}
      <textarea id="bugtext" rows="10" readonly>${esc(this.bugText)}</textarea>
      <div class="lbl">Для разработчиков</div><div class="dim small">Вставьте отчёт целиком или строку сохранения — партия откроется в том же состоянии.</div>
      <textarea id="savein" rows="2" placeholder="-----BEGIN ZAVOD7 SAVE-----"></textarea><div class="row2"><button data-act="bugload">Загрузить партию из отчёта</button></div></div>`;
  }
  private menuWindow() {
    const saves = this.h.listSaves();
    const card = (x: SaveMeta | undefined, slot: string, label: string, auto: boolean) => {
      const img = x ? (x.prev ? `<img class="thumb" src="${x.prev}" alt="">` : `<div class="thumb none">${x.ents != null ? 'превью появится после сохранения' : '…'}</div>`) : `<div class="thumb none">пусто</div>`;
      const info = x ? `<div class="dim small">${new Date(x.time).toLocaleString(LANG === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}${x.era ? ' · ' + esc(x.era) : ''}</div>
        <div class="small">${x.ents != null ? `⏱ ${playTime(x.tick)} · построек ${x.ents} · цель ${Math.min((x.goal || 0) + 1, GOALS.length)}/${GOALS.length}${x.research ? ' · изучено ' + x.research : ''}${x.robots ? ' · 🤖 ' + x.robots : ''}${x.floors ? ' · покрытий ' + x.floors : ''}${x.rockets ? ' · 🚀 ' + x.rockets : ''}${x.mods ? ' · 🧩 модов ' + x.mods : ''}` : `⏱ ${playTime(x.tick)}`}</div>
        ${x.mode ? `<div class="dim small">Рой: ${MODE_NAMES[x.mode] || x.mode}${x.kb ? ` · ${x.kb} КБ` : ''}</div>` : ''}` : '<div class="dim small">свободный слот</div>';
      const btn = (auto ? '' : `<button data-act="save" data-s="${slot}">Сохранить</button>`) + (x ? `<button data-act="load" data-s="${slot}">Загрузить</button>` : '') + (x && !auto ? `<button data-act="delsave" data-s="${slot}">Удалить</button>` : '');
      return `<div class="savecard ${x ? '' : 'empty'}" data-slot="${slot}">${x ? `<div data-act="load" data-s="${slot}">${img}</div>` : img}<div class="si"><b>${label}</b>${info}<div class="row2">${btn}</div></div></div>`;
    };
    const sl = ['1', '2', '3'].map(s => card(saves.find(v => v.slot === s), s, 'Слот ' + s, false)).join('');
    const autos = saves.filter(v => v.slot.startsWith('auto')).sort((a, b) => b.time - a.time);
    const others = saves.filter(v => !['1', '2', '3'].includes(v.slot) && !v.slot.startsWith('auto')).sort((a, b) => b.time - a.time);
    const auto = autos.map(x => card(x, x.slot, 'Автосохранение', true)).join('') + others.map(x => card(x, x.slot, 'Сохранение «' + esc(x.slot) + '»', false)).join('');
    return `<div class="panel menu"><div class="title">ЗАВОД-7 <span class="x" data-act="close">✕</span></div>
      <div class="row2"><button class="big" data-act="close">Продолжить</button><button class="big" data-act="mpopen">Совместная игра</button><button class="big" data-act="modsopen">Моды${this.modCount ? ' (' + this.modCount + ')' : ''}</button></div>
      <div class="lbl">Сохранения</div><div class="saves">${sl}</div>${auto ? `<div class="lbl">Автосохранения</div><div class="saves">${auto}</div>` : ''}
      <div class="row2"><button data-act="export">Экспорт в файл (.z7save)</button><button data-act="import">Импорт из файла</button></div>
      <div class="lbl">Новая игра</div><div class="row2">Seed: <input id="seed" value="${Math.floor(Math.random() * 1e9)}">
        <select id="mode"><option value="none">Нет врагов</option><option value="peaceful">Мирный</option><option value="normal" selected>Обычный</option><option value="deathworld">Мир смерти</option></select> <button data-act="new">Начать</button></div>
      <div class="lbl">Графика</div><div class="row2">Текстуры: ${[[2048, '2K'], [1024, '1K'], [512, '512']].map(([v, l]) => `<button data-act="tex" data-v="${v}" ${texQuality() === v ? 'class="on"' : ''}>${texQuality() === v ? '● ' : ''}${l}</button>`).join(' ')}</div>
      <div class="row2"><button data-act="settings">Настройки</button><button data-act="help">Управление</button></div>
      <div class="lbl">Бета-тест</div><div class="row2"><button data-act="contrib">Помочь игре</button><button data-act="beta">Статистика партии</button><button data-act="bug">Отчёт об ошибке (F8)</button><button data-act="news">Что нового</button></div><div class="dim small">Хранилище: ${esc(this.h.storageInfo() || '…')}</div>
      <div class="dim small">Мирный: Рой отвечает только на атаки. Обычный: атакует источники загрязнения. Мир смерти — гнёзд больше, эволюция быстрее. Автосохранение — по настройке (Esc → Настройки → Игра).</div></div>`;
  }
  private helpWindow() {
    const st = this.h.getSettings(); const kn = (a: string) => keyName(st.keys[a]);
    const rows = [[`${kn('up')} ${kn('left')} ${kn('down')} ${kn('right')}`, 'Ходьба'], ['ЛКМ', 'Поставить / открыть постройку (можно протягивать)'], ['ПКМ (зажать)', 'Добыть руду, дерево, скалу / разобрать постройку'], [`${kn('rotate')} / Shift+${kn('rotate')}`, 'Повернуть'], [kn('pipette'), 'Пипетка / очистить руку'], ['F8', 'Отчёт об ошибке'], ['1–0', 'Панель быстрого доступа'], [kn('inv'), 'Инвентарь и крафт'], [kn('tech'), 'Технологии'], [kn('stats'), 'Статистика'], [kn('map'), 'Карта'], [kn('pickup'), 'Подобрать предметы с земли / вещи погибшего'], [kn('shoot'), 'Стрелять в сторону курсора (нужны пистолет и магазины)'], ['Ремонтный набор + ЛКМ', 'Чинить постройку'], [kn('pollution'), 'Слой загрязнения'], ['Alt', 'Режим деталей (рецепты, модули)'], ['Ctrl+C / Ctrl+X', 'Копировать / вырезать область в чертёж (протянуть ЛКМ)'], ['Ctrl+V', 'Взять последний чертёж'], ['Чертёж: R, F / G', 'Повернуть, отразить по горизонтали / вертикали'], ['Alt+D', 'Планировщик сноса (ПКМ-рамка — отмена)'], ['Alt+U', 'Планировщик улучшений'], ['Ctrl+Z / Ctrl+Y', 'Отменить / повторить'], [kn('bp'), 'Библиотека чертежей'], ['Shift+ПКМ / Shift+ЛКМ', 'Копировать / вставить рецепт сборщика и настройки комбинатора'], ['Наведение на провод', 'Сигналы сети; ЛКМ — окно «Сеть сигналов»'], [this.h.isMac() ? 'Cmd+ЛКМ / Cmd+ПКМ' : 'Ctrl+ЛКМ / Ctrl+ПКМ', 'Быстро загрузить в постройку всё нужное / забрать готовое (можно протягивать)'], ['ПКМ / Shift+ПКМ по ячейке', 'Взять в руку половину стопки / один предмет'], ['Стопка в руке: ЛКМ / ПКМ', 'Положить всё / по одному'], ['Shift+ЛКМ по призраку', 'Роботы построят его первым'], [kn('logi'), 'Окно логистической сети: содержимое, роботы, ждущие запросы'], ['Рельсы в руке: ЛКМ / протянуть ЛКМ', 'Один кусок / путь до курсора (Shift — только призраки)'], [kn('vehicle'), 'Сесть в локомотив / выйти (в кабине W / S — газ / тормоз, A / D — стрелка)'], [kn('trains'), 'Окно «Поезда»'], ['Alt', 'Зоны робопортов (вместе с режимом деталей)'], ['Колесо', 'Масштаб'], [kn('debug'), 'Отладка (+ / − скорость времени)'], [kn('pause'), 'Пауза'], ['Esc', 'Меню / закрыть окно']];
    return `<div class="panel"><div class="title">Управление <span class="x" data-act="close">✕</span></div><table class="keys">${rows.map(r => `<tr><td><kbd>${r[0]}</kbd></td><td>${r[1]}</td></tr>`).join('')}</table>
    <div class="lbl">С чего начать</div><div class="small">Добудьте камень и руду рукой (ПКМ), сделайте печь (E), положите в неё руду и древесину/уголь. Поставьте бур на руду, а перед ним — печь. Дальше следуйте целям ОСКАРа слева сверху.</div></div>`;
  }
  // ---------- логистика (v1.3) ----------
  private commitEdit() {
    const ed = this.edit; this.edit = null; if (!ed || ed.buf === '' || ed.buf === '-') return; const v = +ed.buf; const g = this.g;
    if (ed.kind === 'xn') { const e = g.ents.get(this.entId); if (!e) return; const cc = this.ccOf(e); const x = e.t === 'arith' ? cc.ar : cc.de; if (x) { x.n = Math.max(-2147483648, Math.min(2147483647, v)); delete x.b; this.setCC(e, cc); } return; }
    if (ed.kind === 'cn' || ed.kind === 'csn') { const e = g.ents.get(this.entId); if (!e) return; const cc = this.ccOf(e); if (ed.kind === 'cn' && cc.en) { cc.en.n = v; cc.en.b = undefined; } if (ed.kind === 'csn' && cc.sig?.[ed.i]) cc.sig[ed.i]!.n = v; this.setCC(e, cc); return; }
    if (ed.kind === 'sin' || ed.kind === 'scn') { const i = ed.i >> 4, k = ed.i & 15; this.schedEdit(sc => { const w = condAt(sc[i], k); if (!w) return; if (ed.kind === 'sin') w.n = Math.trunc(v); else if (w.cs) w.cs.n = Math.trunc(v); }); return; }
    if (ed.kind === 'tlim') { g.enqueue({ t: 'stopLimit', id: this.entId, lim: Math.max(0, Math.min(99, Math.trunc(v))) }); setTimeout(() => this.render(true), 50); return; }
    if (ed.kind === 'lreq') { const q = g.ents.get(this.entId)?.req?.[ed.i]; if (q) g.enqueue({ t: 'lreq', id: this.entId, i: ed.i, item: q.item, n: Math.max(1, v) }); }
    else { const q = g.preq[ed.i]; if (!q) return; if (ed.kind === 'pmin') g.enqueue({ t: 'preq', i: ed.i, item: q.item, min: v, max: q.max == null ? null : Math.max(v, q.max) }); else g.enqueue({ t: 'preq', i: ed.i, item: q.item, min: Math.min(q.min, v), max: v }); }
  }
  private numHTML(kind: 'lreq' | 'pmin' | 'pmax' | 'cn' | 'csn' | 'xn' | 'sin' | 'scn' | 'tlim', i: number, v: number | null) {
    const ed = this.edit && this.edit.kind === kind && this.edit.i === i ? this.edit : null;
    return `<span class="num ${ed ? 'on' : ''}" data-act="lnum" data-k="${kind}" data-i="${i}">${ed ? (ed.buf || '') + '▌' : v == null ? '∞' : fmt(v)}</span>`;
  }
  /** v1.4: ячейки сундука; у склада (больше 48 ячеек) — поиск, сортировка и прокрутка */
  chestQ = '';
  // ---------- железная дорога (v1.7) ----------
  private kname(a: string) { return keyName(this.h.getSettings().keys[a]); }
  private stName(t: Train) { const st = t.tgt != null ? this.g.ents.get(t.tgt) : null; return st?.sname || t.sched[t.si]?.st || '—'; }
  private trainState(t: Train): string {
    const n = esc(this.stName(t)); const r = t.sched[t.si];
    switch (t.st) {
      case 'manual': return t.drv >= 0 ? 'Ручное управление: за рулём игрок' : 'Ручное управление';
      case 'go': return `В пути к «${n}»`;
      case 'wait': return `Стоит на «${n}»: ${r ? this.condText(r) : ''}`;
      case 'nopath': return `<span class="err">Нет пути до «${esc(r?.st || '—')}»</span>`;
      case 'nofuel': return '<span class="err">Нет топлива</span>';
      case 'blocked': return '<span class="err">Путь занят другим поездом</span>';
      case 'nosched': return '<span class="err">Нет расписания</span>';
      case 'busy': return `<span class="err">Все станции «${esc(r?.st || '—')}» заняты</span>`;
      case 'signal': return `<span class="err">Ждёт у красного светофора</span> (к «${n}»)`;
      case 'full': return `<span class="err">Нет места на станциях «${esc(r?.st || '—')}»</span> <span class="dim small">(лимит поездов или станция выключена)</span>`;
    }
    return '';
  }
  private condText(r: SchedRec) {
    const one = (w: WCond) => w.c === 'full' ? 'пока вагоны не заполнятся' : w.c === 'empty' ? 'пока вагоны не опустеют' : w.c === 'time' ? `${w.n} с` : w.c === 'idle' ? `${w.n} с без погрузки`
      : w.c === 'item' ? `груз ${w.it ? ITEMS[w.it].name : '?'} ${w.op || '>'} ${w.n}` : `сигнал ${w.cs?.a ? ITEMS[w.cs.a].name : '?'} ${w.cs?.op || '>'} ${w.cs?.b ? ITEMS[w.cs.b].name : w.cs?.n ?? 0}`;
    return [one(r), ...(r.x || []).map(w => ' ' + (w.j ? 'ИЛИ' : 'И') + ' ' + one(w))].join('');
  }
  private trainHTML(e: Entity, fuelSlot: string) {
    const g = this.g; const t = trainOf(g, e);
    if (!t) return '<div class="dim">Вагон не на рельсах</div>';
    const kmh = (t.v / 1000 / 1000 * 60 * 3.6), vmax = VMAX / 1000 / 1000 * 60 * 3.6;
    let b = `<div class="row2"><b>Поезд №${t.id}</b><span class="dim">${t.cars.length} ваг. · ${kmh.toFixed(0)} км/ч (макс. ${vmax.toFixed(0)})</span></div><div>${this.trainState(t)}</div>`;
    b += '<div class="row2 tcars">' + t.cars.map(id => { const c = g.ents.get(id); if (!c) return ''; const back = c.t === 'loco' && c.fl; return `<div class="slot ${id === e.id ? 'sel' : ''}" data-act="tcar" data-id="${id}" title="${PROTOS[c.proto].name}${back ? ' (задом)' : ''}"><img src="${iconURL(c.proto)}" style="${back ? 'transform:scaleX(-1)' : ''}"></div>`; }).join('') + `</div>`;
    const auto = !t.manual; const canAuto = g.research.done.has('automated-rail-transportation');
    b += `<div class="row2"><button data-act="tmode" data-v="0" class="${!auto ? 'on' : ''}">Ручной</button><button data-act="tmode" data-v="1" class="${auto ? 'on' : ''}" ${canAuto ? '' : 'disabled title="Нужна технология «Автоматическая ж/д»"'}>Автоматический</button><span class="dim small">${t.cars.some(id => g.ents.get(id)?.t === 'wagon') ? 'Груз: ' + fillPct(g, t) + '%' : ''}</span></div>`;
    if (e.t === 'loco') b += `<div class="row">${fuelSlot}<div class="dim small">Топливо тратится, пока локомотив тянет: при разгоне и на ходу. ${this.kname('vehicle')} рядом — сесть / выйти; в кабине ${this.kname('up')} / ${this.kname('down')} — газ / тормоз, ${this.kname('left')} / ${this.kname('right')} — стрелка на развилке.</div></div>`;
    else if (e.proto === 'fluid-wagon') { const pc = Math.round((e.tn || 0) / FWAGON_CAP * 100); b += `<div>${e.tf ? fluidName(e.tf) : 'Пусто'}: ${Math.floor(e.tn || 0)} / ${FWAGON_CAP}</div><div class="bar sm ${e.tf || ''}"><i style="width:${pc}%"></i></div><div class="dim small">Наливается и сливается насосом для цистерн у станции, пока поезд стоит. Условия «полон» / «пуст» и «груз» учитывают жидкость.</div>`; }
    else b += this.chestGrid(e) + `<div class="row2"><button data-act="takeall">Забрать всё</button><button data-act="wfall" data-v="set">Фильтры по содержимому</button><button data-act="wfall" data-v="clear">Сбросить фильтры</button></div><div class="dim small">Alt+ЛКМ по ячейке — фильтр: предмет из ячейки или снять. В ячейку с фильтром кладётся только этот предмет.</div>`;
    // расписание
    const names = [...graph(g).stops.keys()].sort();
    const SC = this.schedOf(t); b += `<div class="lbl">Расписание${SC.length ? '' : ': пусто'}</div><div class="sched">`;
    const CN: Record<string, string> = { full: 'Вагоны полны', empty: 'Вагоны пусты', time: 'Время', idle: 'Бездействие', item: 'Груз', circuit: 'Сигнал сети' };
    SC.forEach((r, i) => {
      const cur = i === t.si && !t.manual;
      b += `<div class="srow ${cur ? 'cur' : ''} ${this.sdrag === i ? 'drag' : ''}" data-srow="${i}"><span class="dim grip" data-act="sdrag" data-i="${i}" title="Перетащите, чтобы изменить порядок">⠿ ${i + 1}.</span><button data-act="sst" data-i="${i}" title="Следующая станция">🚉 ${esc(r.st || '—')}</button>`
        + `<button data-act="sgo" data-i="${i}" title="Ехать сюда">▶</button><button data-act="smv" data-i="${i}" data-d="-1" title="Выше">↑</button><button data-act="smv" data-i="${i}" data-d="1" title="Ниже">↓</button><button data-act="sdel" data-i="${i}" title="Удалить">✕</button></div>`;
      const conds: WCond[] = [r, ...(r.x || [])];
      conds.forEach((w, k) => {
        const id = i * 16 + k; let row = `<div class="srow scnd">`;
        row += k ? `<button class="small" data-act="sj" data-i="${id}" title="И / ИЛИ">${(w as any).j ? 'ИЛИ' : 'И'}</button>` : '<span class="dim small">ждать:</span>';
        row += `<button data-act="scond" data-i="${id}">${CN[w.c] || w.c}</button>`;
        if (w.c === 'time' || w.c === 'idle') row += `<button data-act="sn" data-i="${id}" data-d="-5">−</button><b>${w.n} с</b><button data-act="sn" data-i="${id}" data-d="5">+</button>`;
        if (w.c === 'item') row += this.sigSlot(w.it || null, null, `data-act="sit" data-i="${id}"`, w.it ? '' : '<span class="plus">?</span>') + `<button class="op" data-act="sop" data-i="${id}">${w.op || '>'}</button><span class="small">${this.numHTML('sin', id, w.n)}</span>`;
        if (w.c === 'circuit') { const cs = w.cs || { a: null, op: '>', n: 0 }; row += this.sigSlot(cs.a, null, `data-act="sca" data-i="${id}"`, cs.a ? '' : '<span class="plus">A</span>') + `<button class="op" data-act="sop" data-i="${id}">${cs.op}</button><span class="small">${this.numHTML('scn', id, cs.n)}</span>`; }
        if (conds.length > 1) row += `<button class="small" data-act="sxdel" data-i="${id}" title="Убрать условие">✕</button>`;
        b += row + '</div>';
      });
      if (conds.length < 9) b += `<div class="srow scnd"><button class="small" data-act="sxadd" data-i="${i}" data-j="0">+ И</button><button class="small" data-act="sxadd" data-i="${i}" data-j="1">+ ИЛИ</button></div>`;
    });
    if (this.edit?.kind === 'sin' || this.edit?.kind === 'scn') b += '<div class="dim small">Цифры, «−» и Enter; Esc — отмена</div>';
    if (this.pick && (this.pick.kind === 'sit' || this.pick.kind === 'sca')) b += this.pickerHTML(this.pick.kind === 'sca');
    b += '<div class="dim small">Условия группы «И» должны выполниться вместе; «ИЛИ» начинает новую группу (как в Factorio). «Груз» — предмет или жидкость в вагонах, «Сигнал сети» — сигнал на проводах станции.</div>';
    b += `</div><div class="row2"><button data-act="sadd" ${names.length ? '' : 'disabled'}>+ Станция</button>${names.length ? '' : '<span class="dim small">Нет станций — поставьте ж/д станцию у пути</span>'}</div>`;
    return b;
  }
  private tlimPend: { id: number; v: number | undefined; until: number } | null = null;
  private schedPend: { id: number; s: SchedRec[]; until: number } | null = null;
  private schedOf(t: Train): SchedRec[] { const sp = this.schedPend; return sp && sp.id === t.id && performance.now() < sp.until ? sp.s : t.sched; }
  private schedEdit(f: (s: SchedRec[], t: Train) => number | void) {
    const g = this.g; const e = g.ents.get(this.entId); const t = e ? trainOf(g, e) : null; if (!t) return;
    // правки подряд строятся на последнем отправленном расписании: снимок Worker может прийти раньше, чем команда применится
    const base = this.schedOf(t);
    const s: SchedRec[] = JSON.parse(JSON.stringify(base)); const si = f(s, t); g.enqueue({ t: 'sched', id: e!.id, sched: s, si: si ?? undefined });
    this.schedPend = { id: t.id, s, until: performance.now() + 1500 };
    t.sched = s; if (si != null) t.si = si; this.render(true);
  }
  private stopHTML(e: Entity) {
    const g = this.g; const linked = stopLinked(g, e);
    const coming = g.trains.filter(t => !t.manual && t.tgt === e.id);
    let b = `<div class="row2"><input id="stname" value="${esc(e.sname || '')}" maxlength="40" autocomplete="off"> <button data-act="stname">Переименовать</button></div>`;
    b += linked ? '<div class="ok">Путь подведён: поезд остановится головой у станции</div>' : '<div class="err">Нет пути у станции: рельсы должны проходить слева от неё по стрелке</div>';
    b += `<div>Станций с таким именем: ${graph(g).stops.get(e.sname || '')?.length || 0}</div>`;
    const L = stopLimit(g, e), lim = e.cc?.lim && e._cn;
    b += `<div class="row2">Лимит поездов: ${lim ? `<b>${L}</b> <span class="dim small">(сигнал L)</span>` : `<button data-act="tlim" data-d="-1">−</button><span class="small">${this.numHTML('tlim', 0, e.tlim ?? null)}</span><button data-act="tlim" data-d="1">+</button><button data-act="tlim" data-d="0" class="small" title="Без лимита">∞</button>`}</div>`;
    b += `<div class="${e.coff ? 'err' : 'dim'} small">${e.coff ? 'Станция выключена условием сети — поезда сюда не едут' : `Едет сюда / стоит: ${coming.length}${L != null ? ' из ' + L : ''}. Когда лимит исчерпан, поезда ждут «нет места» и едут к другой станции с тем же именем.`}</div>`;
    if (this.edit?.kind === 'tlim') b += '<div class="dim small">Цифры и Enter; Esc — отмена</div>';
    b += `<div class="lbl">Поезда сюда: ${coming.length}</div>` + coming.map(t => `<div class="kv">Поезд №${t.id}<span>${this.trainState(t)}</span></div>`).join('');
    b += '<div class="dim small">Поезд едет к станции с именем из расписания; если таких несколько — к ближайшей свободной.</div>';
    return b;
  }
  /** v1.8: окно светофора — состояние блока за ним, подсказки по развилкам */
  private signalHTML(e: Entity) {
    const g = this.g; const G = graph(g); const b0 = G.sigB.get(e.id); const ch = isChain(e);
    const SS = ['Зелёный — блок свободен', 'Жёлтый — блок зарезервирован поездом', 'Красный — в блоке поезд', 'Нет пути за светофором'];
    let h = `<div class="sigst s${e.ss ?? 0}">${SS[e.ss ?? 0]}</div>`;
    if (b0 != null) { const occ = G.bocc.get(b0), res = g.bres.get(b0); h += `<div class="small">Блок №${b0}${G.jblk.has(b0) ? ' · развилка / пересечение' : ''}${occ != null ? ` · поезд №${occ}` : ''}${res != null && res !== occ ? ` · резерв поезда №${res}` : ''}</div>`;
      if (!ch && G.jblk.has(b0)) h += '<div class="warn small">За светофором развилка или пересечение: поставьте здесь проходной светофор, иначе поезд может встать посреди развилки и создать тупик.</div>'; }
    h += ch ? '<div class="dim small">Проходной: пропускает поезд, только если свободен путь до следующего обычного светофора — поезд не останавливается на развилке. Ставьте на въезде в развилки и пересечения.</div>'
      : '<div class="dim small">Обычный: делит путь на блоки; в блоке — не больше одного поезда. Ставится справа от пути по ходу поезда; поезда не ездят против одностороннего светофора — для движения в обе стороны поставьте второй светофор напротив, у того же узла.</div>';
    return h;
  }
  private trainsWindow() {
    const g = this.g; const list = g.trains;
    let b = `<div class="panel wide"><div class="title">Поезда <span class="x" data-act="close">✕</span></div>`;
    if (!list.length) b += `<div class="dim">Поездов нет. Изучите «Железная дорога», уложите рельсы (протяните ЛКМ с рельсами в руке) и поставьте на них локомотив.</div>`;
    for (const t of list) {
      const loco = t.cars.find(id => g.ents.get(id)?.t === 'loco') ?? t.cars[0];
      b += `<div class="trow"><b>№${t.id}</b> <span class="tcars">${t.cars.map(id => { const c = g.ents.get(id); return c ? `<img src="${iconURL(c.proto)}">` : ''; }).join('')}</span> <span>${t.manual ? 'ручной' : 'авто'}</span> <span>${this.trainState(t)}</span> <span class="dim small">${t.sched.map(r => esc(r.st)).join(' → ')}</span> <button data-act="topen" data-id="${loco}">Открыть</button></div>`;
    }
    const nst = [...graph(g).stops.values()].reduce((a, x) => a + x.length, 0);
    b += `<div class="dim small">Станций: ${nst} · ${this.kname('trains')} — это окно · ${this.kname('vehicle')} — сесть в локомотив / выйти</div></div>`;
    return b;
  }
  private chestGrid(e: Entity) {
    const slots = e.inv!.slots; const big = slots.length > 48; const q = this.chestQ.trim().toLowerCase();
    const fl = e.filt; const cell = (st: typeof slots[number], i: number) => (!st && fl && fl[i]) ? `<div class="slot filt" data-act="eslot" data-slot="chest:${i}" data-wf="${i}" title="Фильтр: ${ITEMS[fl[i]!].name}"><img src="${iconURL(fl[i]!)}" style="opacity:.35"></div>` : slotHTML(st?.item || null, st?.count ?? null, (st ? `data-act="take" data-slot="chest:${i}"` : `data-act="eslot" data-slot="chest:${i}"`) + (fl ? ` data-wf="${i}"` : ''));
    if (!big) return '<div class="grid g8">' + slots.map(cell).join('') + '</div>';
    const used = slots.filter(x => x).length;
    const hit = (it: string) => (ITEMS[it].name + ' ' + tr(ITEMS[it].name) + ' ' + it).toLowerCase().includes(q);
    const cells = slots.map((st, i) => !q || (st && hit(st.item)) ? cell(st, i) : '').join('');
    return `<div class="row2"><input id="csearch" placeholder="Поиск" value="${esc(this.chestQ)}" autocomplete="off"> <button data-act="csort">Сортировать</button> <span class="dim small">Занято ячеек: ${used} из ${slots.length}</span></div>`
      + `<div class="grid g10 chestbig" id="cgrid">${cells || '<span class="dim small">Ничего не найдено</span>'}</div>`;
  }
  // ---------- схемотехника (v1.5) ----------
  wired(e: Entity) { return this.g.cw.some(w => w[0] === e.id || w[1] === e.id); }
  private ccOf(e: Entity): CC { return e.cc ? JSON.parse(JSON.stringify(e.cc)) : {}; }
  /** v1.6: сигнал A / B / выхода комбинатора (особые — только допустимые: иначе выход сбрасывается) */
  private setX(e: Entity, k: 'xa' | 'xb' | 'xo', it: string) {
    const cc = this.ccOf(e); const ar = e.t === 'arith'; const x: any = (ar ? cc.ar : cc.de) || (ar ? { a: null, op: '+', n: 0, o: null } : { a: null, op: '>', n: 0, o: null, one: true }); if (ar) cc.ar = x; else cc.de = x;
    if (k === 'xa') { x.a = it; if (x.o && ITEMS[x.o]?.meta && !this.metaFor({ ...e, cc } as Entity, 'xo').includes(x.o)) x.o = null; }
    else if (k === 'xb') { if (ITEMS[it]?.meta) return; x.b = it; } else x.o = it;
    this.setCC(e, cc);
  }
  private setCC(e: Entity, cc: CC) { e.cc = cc; this.g.enqueue({ t: 'cset', id: e.id, cc }); setTimeout(() => this.render(true), 50); }
  private sigSlot(sg: string | null, n: number | null, attrs: string, extra = '') {
    if (!sg) return slotHTML(null, null, attrs, extra || '<span class="plus">+</span>');
    return slotHTML(sg, null, attrs, (n != null ? `<span class="cnt">${n < 0 ? '−' + fmt(-n) : fmt(n)}</span>` : '') + extra);
  }
  /** блок «Схемотехника» в окне постройки: сети и их сигналы, условие включения, режим чтения */
  private circuitHTML(e: Entity): string {
    const g = this.g; const cc = e.cc || {}; const cs = g.csig[e.id] || [];
    let h = '<div class="lbl">Схемотехника</div><div class="circ">';
    const nets = [0, 1].map(c => { const ids = new Set<number>(); for (const w of g.cw) if (w[2] === c && (w[0] === e.id || w[1] === e.id)) ids.add(w[0] === e.id ? w[1] : w[0]); return ids.size; });
    for (const c of [0, 1]) {
      if (!nets[c]) continue; const sig = (cs[c] || []).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 20);
      h += `<div class="small"><span class="wire w${c}"></span>${c ? 'Зелёная сеть' : 'Красная сеть'} · соединений: ${nets[c]} <button class="small" data-act="nopen" data-t="0" data-c="${c}">Сеть сигналов</button></div>`;
      h += `<div class="grid g10 sigs">${sig.length ? sig.map(([k, v]) => this.sigSlot(k, v, '')).join('') : '<span class="dim small">сигналов нет</span>'}</div>`;
    }
    h += '<div class="dim small">Значение обновится в следующем тике: постройка видит сигналы, выставленные тиком раньше.</div>';
    if (e.t === 'belt') h += `<div class="row2">Чтение: ${[['Не читать', 0], ['Прочитать', 1], ['Держать', 2]].map(([t, v]) => `<button data-act="crd" data-v="${v}" class="${(cc.rd || 0) === v ? 'on' : ''}">${t}</button>`).join(' ')}</div><div class="dim small">«Прочитать» — импульс, когда предмет въезжает на клетку; «держать» — всё, что лежит на клетке.</div>`;
    if (e.t === 'inserter') h += `<div class="row2"><button data-act="crd" data-v="${cc.rd === 1 ? 0 : 1}" class="${cc.rd === 1 ? 'on' : ''}">${cc.rd === 1 ? '☑' : '☐'} Читать руку</button></div>`;
    // v1.6: новые источники сигналов и рецепт по сигналу
    const tog = (v: boolean, act: string, txt: string, extra = '') => `<button data-act="${act}" ${extra} class="${v ? 'on' : ''}">${v ? '☑' : '☐'} ${txt}</button>`;
    if (e.t === 'pole') h += `<div class="row2">${tog(cc.rd === 1, 'crd', 'Выдавать состояние электросети', `data-v="${cc.rd === 1 ? 0 : 1}"`)}</div><div class="dim small">Сигналы: удовлетворение сети, % и запас аккумуляторов, %.</div>`;
    if (e.t === 'lab') h += `<div class="row2">${tog(cc.rd === 1, 'crd', 'Выдавать текущее исследование', `data-v="${cc.rd === 1 ? 0 : 1}"`)}</div><div class="dim small">Пакеты науки текущей технологии = 1 и прогресс исследования, %.</div>`;
    if (e.t === 'roboport') h += `<div class="row2">${tog(!!((cc.rd || 0) & 1), 'crbit', 'Содержимое сети', 'data-v="1"')} ${tog(!!((cc.rd || 0) & 2), 'crbit', 'Роботы', 'data-v="2"')}</div><div class="dim small">Роботы: свободные и все логистические и строительные роботы сети.</div>`;
    if (e.t === 'stop') h += `<div class="row2">${tog(!!((cc.rd || 0) & 1), 'crbit', 'Читать содержимое поезда', 'data-v="1"')} ${tog(!!((cc.rd || 0) & 2), 'crbit', 'Поездов едет сюда (C)', 'data-v="2"')} ${tog(!!cc.lim, 'clim', 'Лимит по сигналу L')}</div><div class="dim small">Содержимое стоящего поезда — предметы и жидкости. C — число поездов, которые едут сюда или стоят. Условие включения выключает станцию: поезда к ней не едут.</div>`;
    if (e.t === 'assembler') h += `<div class="row2">${tog(cc.rd === 1, 'crd', 'Выдавать рецепт и «работает»', `data-v="${cc.rd === 1 ? 0 : 1}"`)} ${tog(!!cc.setr, 'csetr', 'Рецепт по сигналу')}</div>${cc.setr ? '<div class="dim small">Сборщик берёт рецепт предмета с наибольшим положительным сигналом на входе; сигналов нет — стоит. Остатки старого рецепта уходят в выход — их заберут манипуляторы.</div>' : ''}`;
    if (condCapable(e)) {
      const en = cc.en;
      h += `<div class="row2"><button data-act="cen" class="${en ? 'on' : ''}">${en ? '☑' : '☐'} Включать по условию</button></div>`;
      if (en) {
        const ok = !e.coff;
        h += `<div class="row cond">${this.sigSlot(en.a, null, 'data-act="ca"', en.a ? '' : '<span class="plus">A</span>')}<button class="op" data-act="cop">${en.op}</button>`
          + (en.b ? this.sigSlot(en.b, null, 'data-act="cb"') : `<span class="small">${this.numHTML('cn', 0, en.n)}</span>`)
          + `<button data-act="cbm" class="small">${en.b ? 'число' : 'сигнал B'}</button></div>`;
        h += `<div class="small ${ok ? 'ok' : 'err'}">${en.a ? ok ? 'Условие выполнено — работает' : 'Условие не выполнено — выключено' : 'Выберите сигнал A'}</div>`;
        if (this.edit?.kind === 'cn') h += '<div class="dim small">Цифры, «−» и Enter; Esc — отмена</div>';
      }
      if (e.t === 'lamp') h += `<div class="row2"><button data-act="ccol" class="${cc.col ? 'on' : ''}">${cc.col ? '☑' : '☐'} Цвет по сигналу</button></div>${cc.col ? '<div class="dim small">Цвет — первый положительный цветной сигнал: красный, зелёный, синий, жёлтый, розовый, голубой, белый.</div>' : ''}`;
    }
    if (this.pick && (this.pick.kind === 'ca' || this.pick.kind === 'cb')) h += this.pickerHTML(true);
    return h + '</div>';
  }
  /** v1.6: сигналы сетей постройки — из снимка Worker или (главный поток) из сетей игры */
  sigsOf(e: Entity): ([string, number][] | null)[] { const g = this.g; return g.csig[e.id] || (g.cnets.length ? csigOf(g, e) : []); }
  private coOf(e: Entity) { const g = this.g; return (g.cco ? g.cco[e.id] : undefined) || e.co; }
  /** v1.6: окно арифметического/логического комбинатора: вход, операция, выход, живые значения */
  private combHTML(e: Entity): string {
    const ar = e.t === 'arith'; const cc = e.cc || {}; const x: Arith | Decider = (ar ? cc.ar : cc.de) || (ar ? { a: null, op: '+', n: 0, o: null } : { a: null, op: '>', n: 0, o: null, one: true });
    const inp = cc.inp || 0; const cs = this.sigsOf(e);
    let h = `<div class="row2">Вход: ${[['Обе сети', 0], ['Красная', 1], ['Зелёная', 2]].map(([t, v]) => `<button data-act="cinp" data-v="${v}" class="${inp === v ? 'on' : ''}">${t}</button>`).join(' ')}</div>`;
    h += `<div class="row cond">${this.sigSlot(x.a, null, 'data-act="xa"', x.a ? '' : '<span class="plus">A</span>')}<button class="op" data-act="xop">${x.op}</button>`
      + (x.b ? this.sigSlot(x.b, null, 'data-act="xb"') : `<span class="small">${this.numHTML('xn', 0, x.n)}</span>`)
      + `<button data-act="xbm" class="small">${x.b ? 'число' : 'сигнал B'}</button><span class="arrow">➜</span>${this.sigSlot(x.o, null, 'data-act="xo"', x.o ? '' : '<span class="plus">?</span>')}</div>`;
    if (!ar) h += `<div class="row2">Выход: <button data-act="xone" data-v="1" class="${(x as Decider).one ? 'on' : ''}">1</button> <button data-act="xone" data-v="0" class="${(x as Decider).one ? '' : 'on'}">Входное значение</button></div>`;
    if (this.edit?.kind === 'xn') h += '<div class="dim small">Цифры, «−» и Enter; Esc — отмена</div>';
    if (this.pick && (this.pick.kind === 'xa' || this.pick.kind === 'xb' || this.pick.kind === 'xo')) return h + this.pickerHTML(true, this.metaFor(e, this.pick.kind));
    const grid = (arr: [string, number][]) => { const a = arr.filter(([, v]) => v).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])); return `<div class="grid g10 sigs">${a.slice(0, 20).map(([k, v]) => this.sigSlot(k, v, '')).join('') || '<span class="dim small">сигналов нет</span>'}</div>`; };
    const inM = new Map<string, number>(); for (const c of [0, 1]) if (!inp || inp === c + 1) for (const [k, v] of cs[c] || []) inM.set(k, ((inM.get(k) || 0) + v) | 0);
    const co = this.coOf(e);
    h += `<div class="lbl">Вход</div>${grid([...inM])}<div class="lbl">Выход</div>${grid(co ? Object.entries(co) : [])}`;
    const nb: string[] = []; const has = (t: number, c: number) => this.g.cw.some(w => w[2] === c && (w[0] === e.id && wt(w, 0) === t || w[1] === e.id && wt(w, 1) === t));
    for (const t of [0, 1]) for (const c of [0, 1]) if (has(t, c)) nb.push(`<button class="small" data-act="nopen" data-t="${t}" data-c="${c}"><span class="wire w${c}"></span>${t ? 'выход' : 'вход'}</button>`);
    h += `<div class="row2">${nb.length ? 'Сеть сигналов: ' + nb.join(' ') : '<span class="dim small">Не подключён: провод к задней клетке — вход, к передней (по стрелке) — выход</span>'}</div>`;
    h += ar ? '<div class="dim small">Операции: + − × ÷ (целая часть) % (остаток) ^ (степень) &lt;&lt; &gt;&gt; (сдвиги) AND OR XOR. Числа — 32 бита со знаком, переполнение по кругу, деление на 0 даёт 0. «Каждый» — операция над каждым сигналом входа; выход «каждый» — по сигналу, иначе сумма.</div>'
      : '<div class="dim small">Если условие верно — выдаёт сигнал выхода: 1 или его значение на входе. «Каждый» — проверка каждого сигнала, «любой» — хотя бы один, «все» — все сигналы; выход «все» — весь вход.</div>';
    h += '<div class="dim small">Задержка — 1 тик. Shift+ПКМ — скопировать настройки, Shift+ЛКМ — вставить в такой же комбинатор.</div>';
    return h;
  }
  private metaFor(e: Entity, k: 'xa' | 'xb' | 'xo'): string[] {
    const ar = e.t === 'arith'; const x = ar ? e.cc?.ar : e.cc?.de;
    if (k === 'xb') return [];
    if (k === 'xa') return ar ? [EACH] : [EACH, ANY, EVERY];
    return ar ? (x?.a === EACH ? [EACH] : []) : (x?.a === EACH ? [EACH, EVERY] : [EVERY]);
  }
  /** v1.6: открыть окно «Сеть сигналов» для клеммы постройки */
  openNet(id: number, t: 0 | 1, c: 0 | 1) { this.net = { id, t, c }; this.netHist = []; this.netSel = null; this.tipKey = null; this.open = 'cnet'; this.last = ''; this.onOpen?.('cnet'); this.render(true); }
  private netNow(): [string, number][] | null { const n = this.net; if (!n) return null; const e = this.g.ents.get(n.id); if (!e) return null; return this.sigsOf(e)[n.t * 2 + n.c] || null; }
  /** каждый кадр: история сигналов открытой сети за последние 10 секунд (600 тиков) */
  sampleNet() {
    if (this.open !== 'cnet' || !this.net) return; const tick = this.g.tick; const L = this.netHist;
    if (L.length && L[L.length - 1].tick >= tick) return; const arr = this.netNow(); if (!arr) return;
    L.push({ tick, v: new Map(arr) }); while (L.length && L[0].tick < tick - 600) L.shift();
  }
  private netWindow(): string {
    const n = this.net; const e = n ? this.g.ents.get(n.id) : null; const arr = this.netNow();
    let h = `<div class="panel"><div class="title">Сеть сигналов <span class="x" data-act="close">✕</span></div>`;
    if (!n || !e || !arr) return h + '<div class="dim">Сеть не найдена: провод снят или постройка разобрана.</div></div>';
    h += `<div class="small"><span class="wire w${n.c}"></span>${n.c ? 'Зелёная сеть' : 'Красная сеть'} · ${PROTOS[e.proto].name}${hasOut(e) ? (n.t ? ' (выход)' : ' (вход)') : ''} · сигналов: ${arr.filter(([, v]) => v).length}</div>`;
    h += `<div class="row2"><input id="nsearch" placeholder="Поиск" value="${esc(this.netQ)}" autocomplete="off"></div>`;
    const q = this.netQ.trim().toLowerCase(); const hit = (k: string) => !q || (ITEMS[k].name + ' ' + tr(ITEMS[k].name) + ' ' + k).toLowerCase().includes(q);
    const list = arr.filter(([k, v]) => v && hit(k)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    h += `<div class="nlist">${list.map(([k, v]) => `<div class="nrow ${this.netSel === k ? 'on' : ''}" data-act="nsel" data-s="${k}">${slotHTML(k, null, '')}<span>${ITEMS[k].name}</span><b>${fmtSig(v)}</b></div>`).join('') || '<span class="dim small">Ничего не найдено</span>'}</div>`;
    const sel = this.netSel || list[0]?.[0] || null;
    if (sel) {
      const L = this.netHist; const t1 = this.g.tick, t0 = t1 - 600; const pts = L.map(p => [p.tick, p.v.get(sel) || 0] as [number, number]);
      const vs = pts.map(p => p[1]); const mx = Math.max(1, ...vs), mn = Math.min(0, ...vs); const span = mx - mn || 1;
      const poly = pts.map(([t, v]) => `${((t - t0) / 600 * 100).toFixed(2)},${(38 - (v - mn) / span * 36).toFixed(2)}`).join(' ');
      h += `<div class="lbl">${ITEMS[sel].name} — последние 10 с</div><svg class="ngraph" viewBox="0 0 100 40" preserveAspectRatio="none"><line x1="0" x2="100" y1="${(38 - (0 - mn) / span * 36).toFixed(2)}" y2="${(38 - (0 - mn) / span * 36).toFixed(2)}" stroke="rgba(255,255,255,.2)" stroke-width=".3"/><polyline fill="none" stroke="${n.c ? '#3fd04f' : '#e8433a'}" stroke-width="1.2" vector-effect="non-scaling-stroke" points="${poly}"/></svg><div class="small dim">макс ${fmtSig(mx)} · мин ${fmtSig(mn)} · сейчас ${fmtSig(arr.find(([k]) => k === sel)?.[1] || 0)}</div>`;
    }
    h += '<div class="dim small">Щёлкните сигнал — график за последние 10 секунд (пишется, пока окно открыто). Наведите на провод на карте — подсказка с сигналами.</div>';
    return h + '</div>';
  }
  /** окно постоянного комбинатора: 20 сигналов и выключатель */
  private combinatorHTML(e: Entity): string {
    const cc = e.cc || {}; const sig = cc.sig || []; const on = cc.on !== false;
    let h = `<div class="row2"><button data-act="con" class="${on ? 'on' : ''}">${on ? '☑ Включён' : '☐ Выключен'}</button> <span class="dim small">${this.wired(e) ? 'Подключён к сети' : 'Не подключён: возьмите красный или зелёный провод и щёлкните по комбинатору и другой постройке'}</span></div>`;
    h += '<div class="lbl">Сигналы</div><div class="grid g10" id="csigs">';
    for (let i = 0; i < CC_SLOTS; i++) { const q = sig[i]; h += this.sigSlot(q ? q.s : null, q ? q.n : null, `data-act="cslot" data-i="${i}"`, this.edit?.kind === 'csn' && this.edit.i === i ? '<i class="selb"></i>' : ''); }
    h += '</div>';
    const ed = this.edit && this.edit.kind === 'csn' ? sig[this.edit.i] : null;
    if (ed) h += `<div class="small">Значение «${ITEMS[ed.s].name}»: ${this.numHTML('csn', this.edit!.i, ed.n)} <span class="dim">— цифры, «−» и Enter, Esc — отмена</span></div>`;
    h += '<div class="dim small">ЛКМ по пустой ячейке — выбрать сигнал, по заполненной — ввести число; ПКМ — очистить. Комбинатор выдаёт сигналы в подключённые сети.</div>';
    if (this.pick && this.pick.kind === 'cs') h += this.pickerHTML(true);
    return h;
  }
  /** выбор предмета: все предметы, кроме жидкостей; сначала то, что есть в инвентаре; signals — ещё жидкости и виртуальные сигналы */
  private pickerHTML(signals = false, metas: string[] = []) {
    const inv = this.g.inv.items(); const list = signals ? signalList() : ITEM_LIST.filter(i => !ITEMS[i].fluid);
    if (signals) { const vs = metas.concat(list.filter(i => ITEMS[i].virtual)), rest = list.filter(i => !ITEMS[i].virtual); rest.sort((a, b) => (inv[b] ? 1 : 0) - (inv[a] ? 1 : 0) || ITEMS[a].order - ITEMS[b].order); return `<div class="lbl">Выберите сигнал <button data-act="pickcancel">Отмена</button></div><div class="grid g10 picker">${vs.concat(rest).map(i => slotHTML(i, null, `data-act="pick" data-item="${i}"`)).join('')}</div>`; }
    list.sort((a, b) => (inv[b] ? 1 : 0) - (inv[a] ? 1 : 0) || ITEMS[a].order - ITEMS[b].order);
    return `<div class="lbl">Выберите предмет <button data-act="pickcancel">Отмена</button></div><div class="grid g10 picker">${list.map(i => slotHTML(i, null, `data-act="pick" data-item="${i}"`)).join('')}</div>`;
  }
  /** окно логистического сундука: запросы (запрос, буфер), фильтр (хранение), состояние */
  private logiChest(e: Entity): string {
    const k = PROTOS[e.proto].logi!; const g = this.g; let b = '';
    const D: Record<string, string> = {
      passive: 'Отдаёт предметы роботам, когда их кто-то запросил. Для стройки — источник.',
      active: 'Роботы вывозят из него всё в сундуки хранения — и в первую очередь отдают тем, кто запросил.',
      storage: 'Принимает излишки: вывоз из активного снабжения, мусор инженера, разобранное роботами. Фильтр — только один предмет.',
      requester: 'Роботы привозят сюда заданные предметы. Манипулятор забирает их в постройку.',
      buffer: 'Как сундук запроса, но из него могут брать другие запросы, инженер и строительные роботы.' };
    const net = robotView(g, ITEM_IDX, true).nets.find(n => this.netHas(n, e));
    b += `<div class="small dim">${D[k]}</div>`;
    if (!net) b += `<div class="err small">Вне зоны логистики робопорта (жёлтой) — роботы его не видят</div>`;
    if (k === 'requester' || k === 'buffer') {
      if (this.pick && this.pick.kind === 'lreq') b += this.pickerHTML();
      else {
        const R = e.req || []; let h = '<div class="grid g6 reqs">';
        for (let i = 0; i < REQ_SLOTS; i++) { const q = R[i]; const have = q ? e.inv!.count(q.item) : 0; const w = q && e.lw?.[i] ? `<i class="wait"></i>` : '';
          h += q ? slotHTML(q.item, q.n, `data-act="lreq" data-i="${i}"`, `<span class="have ${have < q.n ? 'low' : ''}">${fmt(have)}</span>${w}${this.edit?.kind === 'lreq' && this.edit.i === i ? '<i class="selb"></i>' : ''}`) : slotHTML(null, null, `data-act="lreq" data-i="${i}"`, '<span class="plus">+</span>'); }
        b += `<div class="lbl">Запросы (до ${REQ_SLOTS})</div>${h}</div>`;
        const ed = this.edit && this.edit.kind === 'lreq' ? R[this.edit.i] : null;
        if (ed) b += `<div class="small">Количество «${ITEMS[ed.item].name}»: ${this.numHTML('lreq', this.edit!.i, ed.n)} <span class="dim">— цифры и Enter, Esc — отмена</span></div>`;
        b += `<div class="dim small">ЛКМ по пустой ячейке — выбрать предмет (или ЛКМ с предметом в руке), ЛКМ по запросу — ввести количество, колёсико — ±10% стопки (Shift — по 1), ПКМ — убрать.</div>`;
        if (k === 'requester') b += `<div class="row2"><button data-act="lrbuf">${e.rbuf ? '☑' : '☐'} Брать из буферов</button></div>`;
        if (e.lst === 'noitem') b += `<div class="err small">Нет запрошенных предметов в сети</div>`;
        else if (e.lst === 'norobot') b += `<div class="err small">Нет свободных логистических роботов</div>`;
      }
    }
    if (k === 'storage') {
      if (this.pick && this.pick.kind === 'lfilter') b += this.pickerHTML();
      else b += `<div class="row"><div class="lab">Фильтр${slotHTML(e.lfilter || null, null, `data-act="lfilter"`, e.lfilter ? '' : '<span class="plus">+</span>')}</div><div class="small dim">${e.lfilter ? 'Сюда кладут только «' + ITEMS[e.lfilter].name + '», и этот сундук — первый для него. ПКМ — снять фильтр.' : 'Без фильтра — принимает всё. ЛКМ — выбрать предмет.'}</div></div>`;
    }
    b += '<div class="lbl">Содержимое</div>' + this.chestGrid(e) + `<button data-act="takeall">Забрать всё</button>`;
    return b;
  }
  private netHas(n: NetSummary, e: Entity) {
    // сундук в сети — если рядом (в жёлтой зоне) есть робопорт этой сети
    for (const id of n.ports) { const p = this.g.ents.get(id); if (!p) continue; const h = PROTOS[p.proto].robo!.lz / 2; if (Math.abs(e.x + 0.5 - (p.x + p.w / 2)) <= h && Math.abs(e.y + 0.5 - (p.y + p.h / 2)) <= h) return true; }
    return false;
  }
  /** вкладка «Логистика» в окне инвентаря: личные запросы и мусор */
  private personalTab(): string {
    const g = this.g; const on = g.research.done.has('personal-logistics');
    if (this.pick && this.pick.kind === 'preq') return this.pickerHTML();
    let h = `<div class="lbl">Личные запросы ${on ? '' : '<span class="err small">— нужна технология «Личные запросы»</span>'}</div><div class="preqs">`;
    const n = Math.min(40, g.preq.length + 1);
    for (let i = 0; i < n; i++) {
      const q = g.preq[i];
      if (!q) { h += `<div class="preq">${slotHTML(null, null, `data-act="preq" data-i="${i}"`, '<span class="plus">+</span>')}</div>`; continue; }
      h += `<div class="preq">${slotHTML(q.item, g.inv.count(q.item), `data-act="preq" data-i="${i}"`)}<div class="small">мин ${this.numHTML('pmin', i, q.min)}<br>макс ${this.numHTML('pmax', i, q.max)} <span class="x2" data-act="pinf" data-i="${i}" title="без предела">∞</span></div></div>`;
    }
    h += '</div>';
    h += `<div class="row2"><button data-act="preqoff">${g.preqOff ? '☑' : '☐'} Пауза запросов</button></div>`;
    h += `<div class="dim small">Роботы держат в инвентаре не меньше «мин» и вывозят в хранение всё сверх «макс» (макс 0 — мусор). Работает в оранжевой зоне сети. ЛКМ по числу — ввести с клавиатуры, колёсико по предмету — изменить «мин», ПКМ — убрать запрос.</div>`;
    return h;
  }
  /** окно логистической сети (L): содержимое, роботы, дольше всего ждущие запросы, нехватка */
  private logiWindow(): string {
    const g = this.g; const nets = robotView(g, ITEM_IDX, true).nets;
    let best: NetSummary | null = null, bd = Infinity;
    for (const n of nets) for (const id of n.ports) { const p = g.ents.get(id); if (!p) continue; const d = Math.hypot(p.x + 2 - g.player.x, p.y + 2 - g.player.y); if (d < bd) { bd = d; best = n; } }
    let b = '';
    if (!best) b = '<div class="dim">Сетей робопортов нет. Поставьте робопорт и подключите его к электросети.</div>';
    else {
      const n = best;
      b += `<div class="small dim">Ближайшая сеть: ${n.ports.length} ${n.ports.length === 1 ? 'робопорт' : 'робопорта(ов)'}, логистических сундуков ${n.chests}${nets.length > 1 ? ` · всего сетей ${nets.length}` : ''}</div>`;
      b += `<div class="robonet"><div class="kv">Логистические роботы: свободны<span id="ln-idle">${n.lidle}</span></div><div class="kv">в полёте<span id="ln-work">${n.lwork}</span></div><div class="kv">Строительные: свободны<span>${n.idle}</span></div><div class="kv">в работе<span>${n.working + n.charging}</span></div></div>`;
      b += `<div class="small">Доставок в пути: ${n.tasks.deliver || 0}</div>`;
      b += `<div class="lbl">Содержимое сети</div><div class="grid g10" id="ln-items">${n.contents.length ? n.contents.map(([it, k]) => slotHTML(it, k)).join('') : '<span class="dim">пусто</span>'}</div>`;
      b += `<div class="lbl">Дольше всего ждут</div>`;
      if (!n.waits.length) b += '<div class="dim small">Все запросы выполнены</div>';
      else b += `<div id="ln-waits">${n.waits.map(w => { const e = g.ents.get(w.id); return `<div class="wrow">${slotHTML(w.item, w.need)}<span>${e ? PROTOS[e.proto].name : ''} (${e ? e.x + ', ' + e.y : ''})</span><span class="dim">ждёт ${Math.round((g.tick - w.since) / 60)} с</span></div>`; }).join('')}</div>`;
      if (n.lmissing.length) b += `<div class="lbl">Не хватает в сети:</div><div class="row" id="ln-miss">${n.lmissing.map(([it, k]) => `<div class="lab">${slotHTML(it, k)}</div>`).join('')}</div>`;
    }
    return `<div class="panel wide"><div class="title">Логистическая сеть <span class="x" data-act="close">✕</span></div>${b}<div class="dim small">L — открыть/закрыть. Приоритет источников: активное снабжение → буфер → пассивное снабжение и хранение, ближайший.</div></div>`;
  }
  // ---------- события ----------
  private onClick(ev: MouseEvent) {
    const el = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null; if (!el) return;
    const g = this.g; const a = el.dataset.act!; const rmb = ev.button === 2;
    if (this.ext && (a === 'load' || a === 'new' || a === 'import') && this.ext.inGame()) { g.msg('В совместной игре новая игра и загрузка недоступны — сначала выйдите (Tab → «Выйти»)'); return; }
    if (this.ext && a.startsWith('mp') && this.ext.act(a, el)) return;
    if (a.startsWith('mm-') && this.mods?.act(a, el)) return;
    if ((a.startsWith('ps-') || a.startsWith('calc-')) && this.prod.act(a, el)) return;
    if (ev.altKey && el.dataset.wf != null) { const e = g.ents.get(this.entId); const i = +el.dataset.wf; if (e?.filt) { const it = e.inv?.slots[i]?.item ?? null; g.enqueue({ t: 'wfilter', id: e.id, i, item: e.filt[i] ? null : it }); } return; }
    switch (a) {
      case 'close': this.close(); break;
      case 'note-add': { const p = g.player; g.enqueue({ t: 'note', op: 'add', x: p.x, y: p.y, title: this.noteDraft.title || 'Заметка', text: this.noteDraft.text }); this.noteDraft = { title: '', text: '' }; this.render(true); break; }
      case 'note-del': g.enqueue({ t: 'note', op: 'del', id: +el.dataset.id! }); break;
      case 'calcrec': this.openCalc(el.dataset.k!, 60, 'recipe'); break;
      case 'calc-back': this.toggle('stats'); break;
      case 'tipok': this.tipKey = null; this.render(true); break;
      case 'tipsoff': this.tipKey = null; this.h.setSettings({ tips: false }); this.render(true); break;
      case 'tipsreset': resetTips(); this.h.setSettings({ tips: true }); this.bpMsg = ''; this.render(true); break;
      case 'uivoice': this.h.setSettings({ uiVoice: el.dataset.v as any }); this.render(true); break;
      case 'vrate': this.h.setSettings({ voiceRate: +el.dataset.v! }); this.render(true); break;
      case 'vtest': this.h.voiceTest(); break;
      case 'delsave': if (confirm(tr('Удалить сохранение?'))) { this.h.deleteSave(el.dataset.s!); this.render(true); } break;
      case 'tab': this.tab = el.dataset.tab!; this.render(true); break;
      case 'srange': this.statsRange = +el.dataset.v!; this.render(true); break;
      case 'craft': { const n = ev.shiftKey ? 99 : rmb ? 5 : 1; g.enqueue({ t: 'craft', recipe: el.dataset.r!, count: n }); break; }
      case 'unequip': if (g.equip) g.enqueue({ t: 'equip', item: null }); break;
      case 'csort': g.enqueue({ t: 'sortInv', id: this.entId }); break;
      // v1.7: поезда
      case 'tcar': this.entId = +el.dataset.id!; this.render(true); break;
      case 'topen': this.toggle('ent', +el.dataset.id!); break;
      case 'tmode': g.enqueue({ t: 'tmode', id: this.entId, auto: el.dataset.v === '1' }); break;
      case 'wfall': g.enqueue({ t: 'wfilterAll', id: this.entId, op: el.dataset.v as any }); break;
      case 'stname': { const v = (document.getElementById('stname') as HTMLInputElement | null)?.value || ''; if (v.trim()) { g.enqueue({ t: 'stopName', id: this.entId, name: v }); } break; }
      case 'sadd': this.schedEdit(s => { const names = [...graph(g).stops.keys()].sort(); const last = s[s.length - 1]?.st; const nx = names[(names.indexOf(last ?? '') + 1) % names.length] || names[0]; s.push({ st: nx, c: s.length ? 'empty' : 'full', n: 5 }); }); break;
      case 'sst': this.schedEdit(s => { const i = +el.dataset.i!; const names = [...graph(g).stops.keys()].sort(); if (names.length) s[i].st = names[(names.indexOf(s[i].st) + (rmb ? names.length - 1 : 1)) % names.length]; }); break;
      case 'scond': this.schedEdit(sc => { const id = +el.dataset.i!; const w = condAt(sc[id >> 4], id & 15); if (!w) return; const C = CONDS; w.c = C[(C.indexOf(w.c) + (rmb ? C.length - 1 : 1)) % C.length];
        if ((w.c === 'time' || w.c === 'idle') && !w.n) w.n = 5; if (w.c === 'item') { w.op = w.op || '>'; w.it = w.it ?? null; } else { delete w.it; delete w.op; } if (w.c === 'circuit') w.cs = w.cs || { a: null, op: '>', n: 0 }; else delete w.cs; }); break;
      case 'sn': this.schedEdit(sc => { const id = +el.dataset.i!; const w = condAt(sc[id >> 4], id & 15); if (w) w.n = Math.max(0, Math.min(3600, w.n + +el.dataset.d! * (ev.shiftKey ? 6 : 1))); }); break;
      case 'sj': this.schedEdit(sc => { const id = +el.dataset.i!; const w = condAt(sc[id >> 4], id & 15) as any; if (w && (id & 15)) w.j = w.j ? 0 : 1; }); break;
      case 'sop': this.schedEdit(sc => { const id = +el.dataset.i!; const w = condAt(sc[id >> 4], id & 15); if (!w) return; const O: CondOp[] = ['>', '<', '=', '≠']; if (w.c === 'circuit' && w.cs) w.cs.op = O[(O.indexOf(w.cs.op as CondOp) + 1) % 4]; else w.op = O[(O.indexOf(w.op || '>') + 1) % 4]; }); break;
      case 'sxadd': this.schedEdit(sc => { const r = sc[+el.dataset.i!]; if (!r) return; (r.x || (r.x = [])).push({ c: 'time', n: 5, j: el.dataset.j === '1' ? 1 : 0 }); }); break;
      case 'sxdel': this.schedEdit(sc => { const id = +el.dataset.i!, r = sc[id >> 4], k = id & 15; if (!r) return;
        if (k) { r.x!.splice(k - 1, 1); } else if (r.x?.length) { const [nx, ...rest] = r.x; const { j, ...w } = nx; void j; for (const key of ['n', 'it', 'op', 'cs'] as const) delete (r as any)[key]; Object.assign(r, w); r.x = rest; }
        if (r.x && !r.x.length) delete r.x; }); break;
      case 'sit': case 'sca': { const id = +el.dataset.i!; if (rmb) { this.schedEdit(sc => { const w = condAt(sc[id >> 4], id & 15); if (!w) return; if (a === 'sit') w.it = null; else if (w.cs) w.cs.a = null; }); break; }
        const hand = g.held?.item || this.h.cursor() || null; if (hand && ITEMS[hand] && WIRE_OF[hand] == null && (a === 'sca' || !ITEMS[hand].virtual)) { this.schedEdit(sc => { const w = condAt(sc[id >> 4], id & 15); if (!w) return; if (a === 'sit') w.it = hand; else if (w.cs) w.cs.a = hand; }); break; }
        this.pick = { kind: a, i: id }; this.edit = null; this.render(true); break; }
      case 'sdrag': this.sdrag = +el.dataset.i!; this.render(true); break;
      case 'tpm': g.enqueue({ t: 'tpmode', id: this.entId, m: +el.dataset.v! }); setTimeout(() => this.render(true), 50); break;
      case 'tlim': { const d = +el.dataset.d!; const e = g.ents.get(this.entId); if (!e) break; const tp = this.tlimPend; const cur = tp && tp.id === e.id && performance.now() < tp.until ? tp.v : e.tlim;
        const lim = d === 0 ? null : Math.max(0, Math.min(99, (cur ?? (d > 0 ? 0 : 1)) + d)); g.enqueue({ t: 'stopLimit', id: e.id, lim }); this.tlimPend = { id: e.id, v: lim ?? undefined, until: performance.now() + 1500 }; setTimeout(() => this.render(true), 50); break; }
      case 'smv': this.schedEdit((s, t) => { const i = +el.dataset.i!, j = i + +el.dataset.d!; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j], s[i]]; return t.si === i ? j : t.si === j ? i : undefined; }); break;
      case 'sdel': this.schedEdit((s, t) => { const i = +el.dataset.i!; s.splice(i, 1); return t.si >= s.length ? 0 : t.si > i ? t.si - 1 : undefined; }); break;
      case 'sgo': this.schedEdit(() => +el.dataset.i!); break;
      case 'invtab': this.invTab = el.dataset.tab as any; this.pick = null; this.edit = null; this.render(true); break;
      case 'lreq': case 'preq': {
        const i = +el.dataset.i!; const isP = a === 'preq'; const cur = isP ? g.preq[i] : g.ents.get(this.entId)?.req?.[i];
        if (rmb) { if (isP) g.enqueue({ t: 'preq', i, item: null, min: 0, max: null }); else g.enqueue({ t: 'lreq', id: this.entId, i, item: null, n: 0 }); this.edit = null; break; }
        const hand = g.held?.item || this.h.cursor() || null;
        if (hand && ITEMS[hand]) { if (isP) g.enqueue({ t: 'preq', i, item: hand, min: ITEMS[hand].stack, max: null }); else g.enqueue({ t: 'lreq', id: this.entId, i, item: hand, n: ITEMS[hand].stack }); break; }
        if (!cur) { this.pick = { kind: a, i }; this.edit = null; }
        else this.edit = { kind: isP ? 'pmin' : 'lreq', i, buf: '' };
        this.render(true); break;
      }
      case 'lnum': this.edit = { kind: el.dataset.k as any, i: +el.dataset.i!, buf: '' }; this.render(true); break;
      case 'pinf': { const i = +el.dataset.i!; const q = g.preq[i]; if (q) g.enqueue({ t: 'preq', i, item: q.item, min: q.min, max: null }); this.edit = null; break; }
      case 'preqoff': g.enqueue({ t: 'preqOff', on: !g.preqOff }); setTimeout(() => this.render(true), 50); break;
      case 'lrbuf': { const e = g.ents.get(this.entId); if (e) g.enqueue({ t: 'lrbuf', id: this.entId, on: !e.rbuf }); setTimeout(() => this.render(true), 50); break; }
      case 'lfilter': {
        if (rmb) { g.enqueue({ t: 'lfilter', id: this.entId, item: null }); break; }
        const hand = g.held?.item || this.h.cursor() || null;
        if (hand && ITEMS[hand]) g.enqueue({ t: 'lfilter', id: this.entId, item: hand }); else { this.pick = { kind: 'lfilter', i: 0 }; this.render(true); }
        break;
      }
      case 'pick': {
        const it = el.dataset.item!; const pk = this.pick; this.pick = null; if (!pk) break;
        if (pk.kind === 'xa' || pk.kind === 'xb' || pk.kind === 'xo') { const e = g.ents.get(this.entId); if (!e) break; this.setX(e, pk.kind, it); break; }
        if (pk.kind === 'sit' || pk.kind === 'sca') { this.schedEdit(sc => { const w = condAt(sc[pk.i >> 4], pk.i & 15); if (!w) return; if (pk.kind === 'sit') w.it = it; else if (w.cs) w.cs.a = it; }); break; }
        if (pk.kind === 'ca' || pk.kind === 'cb' || pk.kind === 'cs') {
          const e = g.ents.get(this.entId); if (!e) break; const cc = this.ccOf(e);
          if (pk.kind === 'cs') { const sig = cc.sig || (cc.sig = new Array(CC_SLOTS).fill(null)); sig[pk.i] = { s: it, n: 1 }; this.edit = { kind: 'csn', i: pk.i, buf: '' }; }
          else if (cc.en) { if (pk.kind === 'ca') cc.en.a = it; else cc.en.b = it; }
          this.setCC(e, cc); break;
        }
        if (pk.kind === 'lreq') { g.enqueue({ t: 'lreq', id: this.entId, i: pk.i, item: it, n: ITEMS[it].stack }); this.edit = { kind: 'lreq', i: pk.i, buf: '' }; }
        else if (pk.kind === 'lfilter') g.enqueue({ t: 'lfilter', id: this.entId, item: it });
        else { g.enqueue({ t: 'preq', i: pk.i, item: it, min: ITEMS[it].stack, max: null }); this.edit = { kind: 'pmin', i: pk.i, buf: '' }; }
        setTimeout(() => this.render(true), 50); break;
      }
      case 'pickcancel': this.pick = null; this.render(true); break;
      // v1.5: схемотехника
      case 'nopen': { const id = this.open === 'ent' ? this.entId : -1; if (id >= 0) this.openNet(id, +el.dataset.t! as 0 | 1, +el.dataset.c! as 0 | 1); break; }
      case 'nsel': this.netSel = el.dataset.s!; this.render(true); break;
      case 'cinp': case 'xop': case 'xbm': case 'xone': case 'xa': case 'xb': case 'xo': case 'crbit': case 'csetr': case 'clim': {
        const e = g.ents.get(this.entId); if (!e) break; const cc = this.ccOf(e);
        if (a === 'crbit') { const v = (cc.rd || 0) ^ +el.dataset.v!; if (v) cc.rd = v as any; else delete cc.rd; this.setCC(e, cc); break; }
        if (a === 'csetr') { if (cc.setr) delete cc.setr; else cc.setr = true; this.setCC(e, cc); break; }
        if (a === 'clim') { if (cc.lim) delete cc.lim; else cc.lim = true; this.setCC(e, cc); break; }
        const ar = e.t === 'arith'; const x: any = (ar ? cc.ar : cc.de) || (ar ? { a: null, op: '+', n: 0, o: null } : { a: null, op: '>', n: 0, o: null, one: true }); if (ar) cc.ar = x; else cc.de = x;
        if (a === 'cinp') { const v = +el.dataset.v!; if (v) cc.inp = v as 1 | 2; else delete cc.inp; }
        else if (a === 'xop') { const L: string[] = ar ? AOPS : DOPS; x.op = L[(L.indexOf(x.op) + (rmb ? L.length - 1 : 1)) % L.length]; }
        else if (a === 'xbm') { if (x.b) delete x.b; else { this.pick = { kind: 'xb', i: 0 }; this.edit = null; this.render(true); break; } }
        else if (a === 'xone') x.one = el.dataset.v === '1' || undefined;
        else if (a === 'xa' || a === 'xb' || a === 'xo') {
          if (rmb) { if (a === 'xb') delete x.b; else x[a === 'xa' ? 'a' : 'o'] = null; }
          else { const hand = g.held?.item || this.h.cursor() || null; if (hand && ITEMS[hand] && WIRE_OF[hand] == null) { this.setX(e, a, hand); break; } this.pick = { kind: a, i: 0 }; this.edit = null; this.render(true); break; }
        }
        this.setCC(e, cc); break;
      }
      case 'crd': case 'cen': case 'cop': case 'cbm': case 'ccol': case 'con': case 'ca': case 'cb': case 'cslot': {
        const e = g.ents.get(this.entId); if (!e) break; const cc = this.ccOf(e);
        if (a === 'crd') { const v = +el.dataset.v!; if (v) cc.rd = v as any; else delete cc.rd; }
        else if (a === 'cen') { if (cc.en) delete cc.en; else cc.en = { a: null, op: '<', n: 0 }; }
        else if (a === 'cop' && cc.en) cc.en.op = OPS[(OPS.indexOf(cc.en.op) + 1) % OPS.length];
        else if (a === 'cbm' && cc.en) { if (cc.en.b) delete cc.en.b; else { this.pick = { kind: 'cb', i: 0 }; this.render(true); break; } }
        else if (a === 'ccol') { if (cc.col) delete cc.col; else cc.col = true; }
        else if (a === 'con') { if (cc.on === false) delete cc.on; else cc.on = false; }
        else if (a === 'ca' || a === 'cb') {
          if (rmb && cc.en) { if (a === 'ca') cc.en.a = null; else delete cc.en.b; }
          else { const hand = g.held?.item || this.h.cursor() || null; if (hand && ITEMS[hand] && WIRE_OF[hand] == null && cc.en) { if (a === 'ca') cc.en.a = hand; else cc.en.b = hand; } else { this.pick = { kind: a, i: 0 }; this.render(true); break; } }
        }
        else if (a === 'cslot') {
          const i = +el.dataset.i!; const sig = cc.sig || (cc.sig = new Array(CC_SLOTS).fill(null));
          if (rmb) { sig[i] = null; if (this.edit?.kind === 'csn') this.edit = null; }
          else if (sig[i]) { this.edit = { kind: 'csn', i, buf: '' }; this.render(true); break; }
          else { this.pick = { kind: 'cs', i }; this.edit = null; this.render(true); break; }
        }
        this.setCC(e, cc); break;
      }
      case 'quickload': g.enqueue({ t: 'quick', id: this.entId, op: 'load' }); break;
      case 'eslot': if (g.held) g.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: this.entId, slot: el.dataset.slot, n: rmb ? 'one' : 'all' }); break;
      case 'inv': {
        const i = +el.dataset.i!;
        if (g.held) { g.enqueue({ t: 'hand', op: 'drop', to: 'inv', i, n: rmb ? 'one' : 'all' }); break; }
        const s = g.inv.slots[i]; if (!s) break;
        if (rmb) { g.enqueue({ t: 'hand', op: 'pick', from: 'inv', i, n: ev.shiftKey ? 'one' : 'half' }); break; }
        if ((ev.ctrlKey || ev.metaKey) && el.dataset.mode === 'put') { g.enqueue({ t: 'quick', id: this.entId, op: 'load', item: s.item }); break; }
        if (ITEMS[s.item].equip && el.dataset.mode !== 'put') { g.enqueue({ t: 'equip', item: s.item }); break; }
        if (el.dataset.mode === 'put') { g.enqueue({ t: 'put', id: this.entId, item: s.item, count: ev.shiftKey ? 1e9 : s.count }); }
        else if (ITEMS[s.item].place || s.item === 'repair-pack' || FLOOR_BY_ITEM[s.item] || WIRE_OF[s.item] != null) { this.h.setCursor(s.item); this.close(); }
        break;
      }
      case 'take':
        if (g.held) { g.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: this.entId, slot: el.dataset.slot, n: rmb ? 'one' : 'all' }); break; }
        if (rmb) { g.enqueue({ t: 'hand', op: 'pick', from: 'ent', id: this.entId, slot: el.dataset.slot, n: ev.shiftKey ? 'one' : 'half' }); break; }
        g.enqueue({ t: 'take', id: this.entId, slot: el.dataset.slot! }); break;
      case 'takeall': g.enqueue({ t: 'take', id: this.entId, slot: 'chestall:0' }); break;
      case 'setrecipe': g.enqueue({ t: 'setRecipe', id: this.entId, recipe: el.dataset.r! }); break;
      case 'research': g.enqueue({ t: 'research', tech: el.dataset.t! }); break;
      case 'save': this.h.save(el.dataset.s!); this.render(true); break;
      case 'load': this.h.load(el.dataset.s!); break;
      case 'export': this.h.exportSave(); break;
      case 'import': this.h.importSave(); break;
      case 'new': { const v = (document.getElementById('seed') as HTMLInputElement).value; const m = (document.getElementById('mode') as HTMLSelectElement).value as EnemyMode; this.h.newGame(Number(v) || 1, m); break; }
      case 'tex': this.h.setTex(+el.dataset.v!); this.render(true); break;
      case 'gfx': this.h.setPreset(el.dataset.v as any); this.render(true); break;
      case 'res': this.h.setSettings({ resScale: +el.dataset.v! }); this.render(true); break;
      case 'dpr': this.h.setSettings({ dprMax: +el.dataset.v! }); this.render(true); break;
      case 'fps': this.h.setSettings({ fpsCap: +el.dataset.v! }); this.render(true); break;
      case 'wheel': this.h.setSettings({ wheel: el.dataset.v as any }); this.render(true); break;
      case 'mode': g.enqueue({ t: 'setEnemies', mode: g.settings.enemies === 'peaceful' ? 'normal' : 'peaceful' }); setTimeout(() => this.render(true), 50); break;
      case 'pollution': this.h.togglePollution(); this.render(true); break;
      case 'help': this.toggle('help'); break;
      case 'settings': this.toggle('settings'); break;
      case 'beta': this.toggle('beta'); break;
      case 'bug': this.toggle('bug'); break;
      case 'contrib': this.toggle('contrib'); break;
      case 'news': this.toggle('news'); break;
      case 'modsopen': this.toggle('mods'); break;
      case 'benchopen': this.h.openBench(); break;
      case 'benchsave': this.h.saveBench(); break;
      case 'benchcopy': this.h.copyBench().then(ok => { if (ok) this.bpMsg = ''; }); break;
      case 'teleexport': this.h.exportTele(); break;
      case 'teletoggle': this.h.setTele(!(this.tele?.recording ?? true)); setTimeout(() => this.refreshTele(), 100); break;
      case 'telerefresh': this.refreshTele(); break;
      case 'bugmake': {
        const d = (document.getElementById('bugdesc') as HTMLTextAreaElement)?.value || ''; const ws = (document.getElementById('bugsave') as HTMLInputElement)?.checked ?? true;
        this.bugMsg = 'Собираю отчёт…'; this.render(true); (document.getElementById('bugdesc') as HTMLTextAreaElement).value = d;
        this.h.bugReport(d, ws).then(t => { this.bugText = t; this.bugMsg = `Отчёт готов: ${Math.ceil(t.length / 1024)} КБ`; this.render(true); const ta = document.getElementById('bugdesc') as HTMLTextAreaElement | null; if (ta) ta.value = d; }); break;
      }
      case 'bugcopy': { const t = this.bugText; if (!t) break; const ta = document.getElementById('bugtext') as HTMLTextAreaElement | null; if (ta) ta.select(); navigator.clipboard?.writeText(t).then(() => { this.bugMsg = 'Отчёт скопирован в буфер обмена'; this.render(true); }, () => { this.bugMsg = 'Не удалось скопировать — выделите текст в поле и нажмите Ctrl+C'; this.render(true); }); break; }
      case 'bugfile': if (this.bugText) this.h.saveBug(this.bugText); break;
      case 'bugload': { const ta = document.getElementById('savein') as HTMLTextAreaElement; const v = ta?.value || ''; if (!v.trim()) break; this.h.loadSaveString(v).catch(e => { this.bugMsg = 'Ошибка загрузки: ' + (e as Error).message; this.render(true); }); break; }
      case 'setb': { const k = el.dataset.k as keyof Settings; this.h.setSettings({ [k]: !this.h.getSettings()[k] } as any); this.render(true); break; }
      case 'render': this.h.setRenderer(el.dataset.v as any); this.render(true); break;
      case 'lang': this.h.setSettings({ lang: el.dataset.v as any }); this.render(true); break;
      case 'autos': this.h.setSettings({ autosaveMin: +el.dataset.v! }); this.render(true); break;
      case 'rebind': this.rebinding = this.rebinding === el.dataset.k ? null : el.dataset.k!; this.render(true); break;
      case 'keysreset': this.h.setSettings({ keys: { ...DEFAULTS.keys } }); this.render(true); break;
      case 'sitem': this.statItem = this.statItem === el.dataset.k ? null : el.dataset.k!; this.render(true); break;
      case 'bptake': { const x = this.bpLib()[+el.dataset.i!]; if (x) { this.h.takeBp(x.bp); this.close(); } break; }
      case 'bpdel': { const a = this.bpLib(); a.splice(+el.dataset.i!, 1); this.saveLib(a); this.render(true); break; }
      case 'bpren': { const a = this.bpLib(); const x = a[+el.dataset.i!]; if (!x) break; const n = prompt(tr('Название чертежа'), x.name); if (n) { x.name = n.slice(0, 40); x.bp.name = x.name; this.saveLib(a); this.render(true); } break; }
      case 'bpcopy': { const x = this.bpLib()[+el.dataset.i!]; if (!x) break; packStr(x.bp).then(str => { const ta = document.getElementById('bpstr') as HTMLTextAreaElement | null; if (ta) { ta.value = str; ta.select(); } navigator.clipboard?.writeText(str).then(() => { this.bpMsg = 'Строка скопирована в буфер обмена'; }, () => { this.bpMsg = 'Строка в поле ниже — скопируйте её'; }); this.bpMsg = 'Строка в поле ниже'; }); break; }
      case 'bpimport': {
        const ta = document.getElementById('bpstr') as HTMLTextAreaElement; const str = ta.value.trim(); if (!str) break;
        unpackStr(str).then(o => { if (!validBp(o)) throw new Error('не чертёж'); this.addBp(o); this.bpMsg = `Импортирован «${o.name}»`; this.render(true); }).catch(e => { this.bpMsg = 'Ошибка импорта: ' + (e as Error).message; this.render(true); }); break;
      }
      case 'dfilt': this.deconFilter = el.dataset.v as any; this.render(true); break;
      case 'dtrees': this.deconTrees = !this.deconTrees; this.render(true); break;
      case 'upg': this.upgradeOn[el.dataset.v!] = !this.upgradeOn[el.dataset.v!]; this.render(true); break;
      case 'tool': this.h.setTool(el.dataset.v as any); this.close(); break;
      case 'undo': g.enqueue({ t: 'undo' }); break;
      case 'redo': g.enqueue({ t: 'redo' }); break;
      case 'clearghosts': g.enqueue({ t: 'clearGhosts' }); setTimeout(() => this.render(true), 50); break;
    }
    setTimeout(() => this.render(false), 30);
  }
  private onHotbar(ev: MouseEvent) {
    const el = (ev.target as HTMLElement).closest('[data-h]') as HTMLElement | null; if (!el) return;
    const i = +el.dataset.h!; ev.stopPropagation();
    if (ev.button === 2) { this.hotbar[i] = null; return; }
    const cur = this.h.cursor();
    if (cur && !this.hotbar[i]) { this.hotbar[i] = cur; return; }
    this.selectHot(i);
  }
  selectHot(i: number) { const it = this.hotbar[i]; if (!it) return; this.h.setCursor(this.h.cursor() === it ? null : it); }
  private onTip(ev: MouseEvent) {
    const el = (ev.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (!el) { this.tipEl.style.display = 'none'; return; }
    const [k, id] = el.dataset.tip!.split(':'); const g = this.g; let h = '';
    if (k === 'item') { const it = ITEMS[id]; h = `<b>${it.name}</b>${it.fuel ? `<div>Топливо: ${it.fuel} МДж</div>` : ''}${it.ammo ? `<div>Урон: ${it.ammo} за выстрел</div>` : ''}${it.module ? `<div>${[['Скорость', it.module.speed], ['Продуктивность', it.module.prod], ['Энергия', it.module.energy], ['Загрязнение', it.module.pollution]].filter(x => x[1]).map(x => `${x[0]}: <b>${pct(x[1] as number)}</b>`).join('<br>')}</div>${it.module.kind === 'productivity' ? '<div class="dim small">Только для промежуточных продуктов; маяк не принимает</div>' : ''}` : ''}${it.fluid ? '<div class="dim">Жидкость — по трубам</div>' : `<div class="dim">В инвентаре: ${g.inv.count(id)}</div>`}`; }
    if (k === 'recipe' || k === 'locked') {
      const r = RECIPES[id]; const o = r.out[0];
      const where: Record<string, string> = { crafting: r.hand ? '' : 'Сборщик', smelting: 'Печь', chemistry: 'Химический завод', refining: 'НПЗ', 'crafting-with-fluid': 'Сборщик 2/3 (с жидкостью)', rocket: 'Ракетная шахта' };
      h = `<b>${r.name || ITEMS[o[0]].name}${o[1] > 1 && !r.name ? ' ×' + o[1] : ''}</b><div class="dim">${r.time} с${where[r.cat] ? ' · ' + where[r.cat] : ''}</div>` + r.in.map(([it, n]) => { const have = g.inv.count(it); return `<div class="kv"><img src="${iconURL(it)}"> ${n} × ${ITEMS[it].name} ${ITEMS[it].fluid ? '' : `<span class="${have >= n ? '' : 'err'}">${have}</span>`}</div>`; }).join('')
        + (r.out.length > 1 || r.name ? '<div class="lbl">Результат:</div>' + r.out.map(([it, n]) => `<div class="kv"><img src="${iconURL(it)}"> ${n} × ${ITEMS[it].name}</div>`).join('') : '');
      if (k === 'locked') { const t = TECH_LIST.find(t => t.unlocks.includes(id)); h += `<div class="err">Нужна технология «${t?.name}»</div>`; }
    }
    this.tipEl.innerHTML = tr(h); this.tipEl.style.display = 'block';
    const x = Math.min(window.innerWidth - 260, ev.clientX + 16), y = Math.min(window.innerHeight - this.tipEl.offsetHeight - 8, ev.clientY + 12);
    this.tipEl.style.left = x + 'px'; this.tipEl.style.top = y + 'px';
  }
}

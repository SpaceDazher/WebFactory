import { BIO_COATING_LABELS, BIO_LINING_LABELS, BIO_PRECISION_HELP } from "../data/biomaterials";
// Интерфейс на DOM поверх canvas (11.1–11.2).
import { nucHud } from '../sim/nucguide';
import { bioGuideHud } from '../sim/bioguide';
import { bioLivingTicksLeft, nearbyBioCorpses } from '../sim/bio';
import { genFormHtml, readGen, refreshGenForm } from './genform';
import { NR_CAP } from '../sim/combat';
import { TICKS } from '../core/types';
import { SAVE_VERSION as SAVE_FMT } from '../sim/save';
import { GAME_VERSION } from '../sim/compat';
import { cleanGen, GenSet } from '../sim/world';
import { RQ_MAX, missingPrereqs, depsToAdd } from '../sim/x116';
import { ITEMS, GROUPS, ITEM_LIST } from '../data/items';
import { RECIPES, RECIPE_LIST } from '../data/recipes';
import { PROTOS, FLOOR_BY_ITEM, FLOORS } from '../data/entities';
import { TECH_LIST, TECHS, techEra, SCIENCE_PACKS, techGain, type TechDef } from '../data/techs';
import { moduleSlots, fx } from '../sim/modules';
import { Blueprint, bpCost, validBp } from '../sim/blueprint';
import { packStr, unpackStr } from '../core/pack';
import { morph } from './morph';
import { layoutTechs, prereqChain, edgePath, CARD_W, CARD_H } from './techgraph';
import { PERF_LEVELS } from '../sim/perfworld';
import { uiZoomMode } from '../client/input';
import { ACTIONS, keyName, DEFAULTS, Settings, KEY_GROUPS, KEY_PRESETS } from '../client/settings';
import { PRESET_NAMES } from '../client/gfx';
import { Game, Entity } from '../sim/game';
import { fluidPortPanel } from './fluidports';
import { reference117Html } from './reference117';
import { BioRoutePlanner } from './bioroute';
import { bioCommandLinks } from '../sim/v117Systems';
import { RES_ITEMS, R_OIL, R_URAN } from '../sim/world';
import { heatTemp, heatPorts, ROD_TICKS, WARN_T, OVER_T, HEX_ON, contamRate, BOOM_R } from '../sim/heat';
import { asmTier } from '../data/entities';
import { texQuality } from '../render/textures';
import type { EnemyMode } from '../sim/enemies';
import { GOALS } from '../sim/goals';
import { iconURL } from '../render/art';
import { tr, LANG } from '../core/i18n';
import { droneTransferControls } from './drone-transfer';
import { STATUS_TEXT } from '../render/renderer';
import { TIPS, Tip, seenTips, markTip, resetTips } from './tips';
import { validNoteIcon } from '../sim/notes';
import { playTime, SlotInfo } from '../sim/slotinfo';
import { NEWS } from '../data/news';
import { robotView, ROBOT_STRIDE, ROBOT, LROBOT, REPAIR, REQ_SLOTS, NetSummary } from '../sim/robots';
import { ITEM_IDX } from '../data/items';
import { bp116 } from '../data/bp116';
import { CC, OPS, CC_SLOTS, circuitCapable, condCapable, signalList, WIRE_OF, AOPS, DOPS, EACH, ANY, EVERY, hasOut, csigOf, wt, Arith, Decider } from '../sim/circuits';
import { fmtSig } from '../render/renderer';
import { trainOf, graph, fillPct, stopLinked, trainRouteAvailable, Train, SchedRec, VMAX, WCond, CONDS, stopLimit, FWAGON_CAP, isChain } from '../sim/trains';
import { LOCO_FUEL_SLOTS, locoFuelInventory, locoFuelOpen } from '../sim/trainfuel';
import type { CondOp } from '../sim/circuits';
import { ProdUI } from './produi';
import { GearUI } from './gearui';
import { dmgMul } from '../sim/combat';
import { DRONE_MODELS } from '../sim/v117';
import { BIO_V117_SOURCES } from '../data/biomaterials';
import type { StatsView, Tab } from '../sim/prodstats';
/** v1.8: условие k записи расписания (0 — основное, дальше — дополнительные) */
const condAt = (r: SchedRec | undefined, k: number): WCond | null => !r ? null : k === 0 ? r : r.x?.[k - 1] || null;
/** запись о слоте сохранения: время, картинка базы (JPEG data URL) и сведения о партии */
export interface SaveMeta extends Partial<SlotInfo> { slot: string; time: number; tick: number; prev?: string; }

export const MODE_NAMES: Record<string, string> = { none: 'нет врагов', peaceful: 'мирный', normal: 'обычный', deathworld: 'мир смерти' };
export type Win = 'cnet' | 'inv' | 'ent' | 'tech' | 'stats' | 'menu' | 'map' | 'help' | 'bp' | 'victory' | 'settings' | 'beta' | 'bug' | 'contrib' | 'news' | 'perf' | 'logi' | 'mp' | 'players' | 'trains' | 'calc' | 'mods' | 'modcheck' | 'console' | 'gear' | 'swarm' | 'chal' | 'ach' | 'chalres' | 'gcon' | 'fact' | null;
type MenuPage = 'home' | 'new' | 'load';
export interface BpEntry { name: string; bp: Blueprint; time: number; }
const BP_KEY = 'zavod7:bps';
/** пары «что → во что» для планировщика улучшений (одинаковый размер, одна группа быстрой замены) */
export const UPGRADES: [string, string][] = [['transport-belt', 'fast-transport-belt'], ['fast-transport-belt', 'express-transport-belt'], ['express-transport-belt', 'turbo-transport-belt'], ['underground-belt', 'fast-underground-belt'], ['fast-underground-belt', 'express-underground-belt'], ['express-underground-belt', 'turbo-underground-belt'], ['splitter', 'fast-splitter'], ['fast-splitter', 'express-splitter'], ['express-splitter', 'turbo-splitter'], ['burner-inserter', 'inserter'], ['inserter', 'fast-inserter'], ['wooden-chest', 'iron-chest'], ['iron-chest', 'steel-chest'], ['stone-furnace', 'steel-furnace'], ['assembling-machine-1', 'assembling-machine-2'], ['assembling-machine-2', 'assembling-machine-3'], ['assembling-machine-3', 'assembling-machine-4'], ['electric-mining-drill', 'electric-mining-drill-2'], ['electric-mining-drill-2', 'electric-mining-drill-3']];
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
const recipeItem = (rid: string) => RECIPES[rid]?.out[0]?.[0] || RECIPES[rid]?.in[0]?.[0] || rid;
const recipeDisplayName = (rid: string) => RECIPES[rid]?.name || ITEMS[recipeItem(rid)]?.name || rid;
export interface BetaHooks {
  /** статистика партии из симуляции (в Worker — асинхронно) */ teleReport(): Promise<any>; exportTele(): void; setTele(on: boolean): void;
  /** текст отчёта об ошибке */ bugReport(desc: string, withSave: boolean): Promise<string>; saveBug(text: string): void; loadSaveString(str: string): Promise<void>; errors(): number;
  /** v1.1: замер производительности (открывает ?bench=1 в новой вкладке), его состояние и файл */
  openBench(lv?: number): void; bench(): { running: boolean; text: string; frac: number; file: any | null }; saveBench(): void; copyBench(): Promise<boolean>;
  /** куда отправлять файлы (ZAVOD_FEEDBACK при сборке; пусто — только инструкция) */ feedback(): string;
}
export interface ClientHooks extends BetaHooks { /** v1.9: данные окна статистики 2.0 (в Worker — асинхронно) */ statsView(tier: number, tab: Tab, sel: string | null): Promise<StatsView | null>; getSettings(): Settings; setSettings(p: Partial<Settings>): void; storageInfo(): string; workerActive(): boolean; rendererMode(): string; rendererNote(): string; setRenderer(m: 'auto' | 'webgl' | 'canvas'): string; takeBp(bp: Blueprint): void; curBp(): Blueprint | null; setTool(t: 'copy' | 'cut' | 'decon' | 'upgrade' | 'cancel'): void; getGame(): Game; setCursor(i: string | null): void; cursor(): string | null; save(slot: string): void; load(slot: string): void; newGame(seed: number, mode: EnemyMode, scn?: undefined, gen?: GenSet | null): void; setTex(n: number): void; setPreset(p: 'high' | 'medium' | 'low' | 'min'): void; isMac(): boolean; togglePollution(): void; pollution(): boolean; exportSave(): void; importSave(): void; listSaves(): SaveMeta[]; deleteSave(slot: string): void; voiceInfo(): string; voiceList(): string[]; voiceTest(): void; speakerListen(entityId: number): void; }

/** v1.11: короткая подпись клавиши ячейки быстрого доступа: «1», «⇧1», «A1», «A⇧1» */
function shortKey(b: string | undefined): string {
  if (!b) return ''; const p = b.split('+'); const code = p.pop()!; const base = code.startsWith('Digit') ? code.slice(5) : code.startsWith('Key') ? code.slice(3) : code.startsWith('Numpad') ? 'n' + code.slice(6) : keyName(code).slice(0, 3);
  return p.map(m => m === 'Shift' ? '⇧' : m === 'Alt' ? 'A' : m === 'Ctrl' ? '^' : '⌘').join('') + base;
}
export class UI {
  readonly bioRoute = new BioRoutePlanner(() => this.g, () => { if (this.open === 'map') { this.render(true); this.onMapDraw?.(); } });
  /** v1.3: выбор предмета для запроса / фильтра / личного запроса; редактирование количества (колёсико, ввод с клавиатуры); вкладка инвентаря */
  pick: { kind: 'lreq' | 'lfilter' | 'preq' | 'ca' | 'cb' | 'cs' | 'xa' | 'xb' | 'xo' | 'sit' | 'sca'; i: number } | null = null;
  /** v1.16: выбор любой станции в мире для расписания */ sPick: { row: number } | null = null; sPickQ = '';
  /** v1.8: перетаскивание записи расписания (индекс) */ sdrag: number | null = null;
  edit: { kind: 'lreq' | 'pmin' | 'pmax' | 'cn' | 'csn' | 'xn' | 'sin' | 'scn' | 'tlim'; i: number; buf: string } | null = null;
  /** v1.6: окно «Сеть сигналов» — постройка, клемма (1 — выход комбинатора), цвет; поиск; выбранный сигнал; история за 10 с */
  net: { id: number; t: 0 | 1; c: 0 | 1 } | null = null; netQ = ''; netSel: string | null = null; private netHist: { tick: number; v: Map<string, number> }[] = [];
  invTab: 'inv' | 'logi' = 'inv';
  invPage = 0;
  open: Win = null; entId = -1; tab = 'logistics'; statsRange = 60; statItem: string | null = null;
  /** v1.16: main/pause menu routes share a shell; the setup draft survives route changes. */
  menuPage: MenuPage = 'home'; menuReturnTo: MenuPage | null = null;
  private menuSeed = String(Math.floor(Math.random() * 1e9)); private menuMode: EnemyMode = 'normal'; private menuGen: GenSet | null = null;
  deconFilter: 'all' | 'belts' | 'nobelts' = 'all'; deconTrees = true;
  /** v1.13: вкладка окна чертежей — свои или библиотека партии */ bpTab: 'mine' | 'party' = 'mine'; private seenBpLib = -1;
  upgradeOn: Record<string, boolean> = Object.fromEntries(UPGRADES.map(([a]) => [a, true]));
  bpMsg = ''; rebinding: string | null = null;
  /** v1.12: окна совместной игры (ui/mpui.ts); inGame — идёт совместная игра (новая игра и загрузка недоступны) */
  /** v1.10: включённых модов (кнопка в меню) */ modCount = 0;
  /** v1.11: консоль и окна скриптов модов */ modrt: { consoleHtml(): string; filter: string; lines: any[] } | null = null;
  /** v1.10: окно «Моды» */ mods: { html(w: string): string; act(a: string, el: HTMLElement): boolean } | null = null;
  /** v1.16: управление заводом (консоль, группы, оповещения…) */ x: import('./xui').XUi | null = null;
  /** v1.15: испытания и достижения */ scn: { html(w: string): string | null; act(a: string, el: HTMLElement): boolean; hud(g: Game): string } | null = null;
  ext: { html(w: string): string | null; act(a: string, el: HTMLElement): boolean; inGame(): boolean } | null = null;
  /** v1.11: до 4 рядов по 10 ячеек (ряд r — индексы r*10…r*10+9); закреплённые ячейки не меняются автозаполнением,
   *  снятые вручную предметы автозаполнение больше не возвращает (пока их снова не закрепят) */
  hotbar: (string | null)[] = new Array(40).fill(null); hotPin: boolean[] = new Array(40).fill(false); hotBan: string[] = [];
  private hotDrag = -1;
  fluidFocus: { entity: number; tank: number } | null = null;
  private pendingFluidRecipe: { entity: number; recipe: string; until: number } | null = null;
  private v117Seq = 0;
  private techClickTimer: number | null = null;
  private last = ''; private frame = 0; private tipEl = $('tip');
  constructor(public h: ClientHooks) {
    const win = $('win');
    win.addEventListener('mousedown', ev => this.onClick(ev));
    win.addEventListener('dblclick', ev => {
      const card = (ev.target as HTMLElement).closest('[data-act="techsel"][data-t]') as HTMLElement | null; if (!card) return;
      ev.preventDefault(); ev.stopPropagation(); if (this.techClickTimer != null) window.clearTimeout(this.techClickTimer); this.techClickTimer = null;
      const id = card.dataset.t!, g = this.g, t = TECHS[id]; this.techSel = id;
      if (t && g.techOk(id) && (t.infinite || !g.research.done.has(id)) && id !== g.research.current && !g.x.rq.includes(id)) g.enqueue({ t: 'x', op: 'rqadd', tech: id, deps: missingPrereqs(g, id).length > 0 });
      this.render(true);
    });
    win.addEventListener('contextmenu', ev => ev.preventDefault());
    win.addEventListener('focusin', ev => { const row = (ev.target as HTMLElement).closest('[data-fluid-tank]') as HTMLElement | null; this.fluidFocus = row ? { entity: Number(row.dataset.fluidEntity), tank: Number(row.dataset.fluidTank) } : null; });
    win.addEventListener('focusout', () => { this.fluidFocus = null; });
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
    // v1.11: граф технологий — перетаскивание фона сдвигает, колесо масштабирует вокруг курсора
    let pan: { x: number; y: number; tx: number; ty: number } | null = null;
    win.addEventListener('mousedown', ev => { const t = ev.target as HTMLElement; if (ev.button !== 0 || !t.closest('#techgraph') || t.closest('.tcard')) return; pan = { x: ev.clientX, y: ev.clientY, tx: this.tg.x, ty: this.tg.y }; ev.preventDefault(); });
    document.addEventListener('mousemove', ev => { if (!pan) return; this.tg.x = pan.tx + ev.clientX - pan.x; this.tg.y = pan.ty + ev.clientY - pan.y; this.techApply(); });
    document.addEventListener('mouseup', () => { pan = null; });
    win.addEventListener('wheel', ev => { if (!(ev.target as HTMLElement).closest?.('#techgraph')) return; ev.preventDefault(); this.techZoom(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX, ev.clientY); }, { passive: false });
    // v1.11: большая карта — колесо масштабирует вокруг курсора, перетаскивание сдвигает, щелчок подставляет координаты в метку
    let mdrag: { x: number; y: number; cx: number; cy: number; sx: number; sy: number; moved: boolean } | null = null;
    win.addEventListener('wheel', ev => { if ((ev.target as HTMLElement).id !== 'bigmap') return; ev.preventDefault(); this.mapZoom(ev.deltaY < 0 ? 1 / 1.25 : 1.25, ev.clientX, ev.clientY); }, { passive: false });
    win.addEventListener('mousedown', ev => { if ((ev.target as HTMLElement).id !== 'bigmap' || ev.button !== 0) return; ev.preventDefault(); const box = this.mapCanvasBox(); mdrag = { x: ev.clientX, y: ev.clientY, cx: this.mapv.cx, cy: this.mapv.cy, sx: box ? box.canvas.width / box.width : 1, sy: box ? box.canvas.height / box.height : 1, moved: false }; });
    document.addEventListener('mousemove', ev => {
      if (mdrag) { const dx = ev.clientX - mdrag.x, dy = ev.clientY - mdrag.y; if (Math.abs(dx) + Math.abs(dy) > 3) mdrag.moved = true;
        if (mdrag.moved) { this.mapv.cx = mdrag.cx - dx * mdrag.sx * this.mapv.tpp; this.mapv.cy = mdrag.cy - dy * mdrag.sy * this.mapv.tpp; this.mapv.follow = false; this.onMapDraw?.(); } }
      if (this.open === 'map') { const w = this.mapAt(ev.clientX, ev.clientY); const h = w ? [Math.floor(w[0]), Math.floor(w[1])] as [number, number] : null; if (String(h) !== String(this.mapHover)) { this.mapHover = h; this.onMapHover?.(); const el = document.getElementById('mapcoord'); if (el) { el.textContent = h ? `X ${h[0]}, Y ${h[1]}` : ''; el.style.display = h ? '' : 'none'; } } }
    });
    document.addEventListener('mouseup', ev => { const m = mdrag; mdrag = null; if (!m || m.moved) { if (m) this.render(true); return; } const w = this.mapAt(ev.clientX, ev.clientY); if (w && this.bioRoute.draft) { this.bioRoute.add(w[0], w[1]); this.render(true); this.onMapDraw?.(); return; } if (w && this.artPick) { this.artPick = false; this.g.enqueue({ t: 'artillery', x: w[0], y: w[1] }); this.render(true); return; } if (w) { this.noteDraft.x = String(Math.floor(w[0])); this.noteDraft.y = String(Math.floor(w[1])); this.render(true); } });
    $('hero').addEventListener('mousedown', ev => { const el = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null; if (!el) return; ev.preventDefault(); ev.stopPropagation(); const a = el.dataset.act!;
      if (a === 'gearopen') this.toggle('gear'); else if (a === 'swarmopen') this.toggle('swarm'); else this.gear.act(a, el, ev.button === 2); });
    $('hero').addEventListener('contextmenu', ev => ev.preventDefault());
    $('hotbar').addEventListener('mousedown', ev => this.onHotbar(ev));
    $('hotbar').addEventListener('contextmenu', ev => ev.preventDefault());
    $('craftq').addEventListener('mousedown', ev => { const el = (ev.target as HTMLElement).closest('[data-q]') as HTMLElement; if (el) this.g.enqueue({ t: 'cancelCraft', index: +el.dataset.q! }); });
    document.addEventListener('mousemove', ev => this.onTip(ev));
    win.addEventListener('change', ev => { const el = ev.target as HTMLSelectElement; if (this.inRender) return; /* change при удалении поля во время перерисовки */ if (el.id === 'biomode') { const e = this.g.ents.get(this.entId), mode = el.value; if (e?.t === 'bioport' && (mode === 'corpses' || mode === 'all' || mode === 'film')) this.g.enqueue({ t: 'bioRobotConfig', id: e.id, mode }); return; } if (el.id === 'biofamily') { const e = this.g.ents.get(this.entId); if (e?.t === 'bioport') this.g.enqueue({ t: 'bioRobotConfig', id: e.id, family: el.value || null, species: null }); return; } if (el.id === 'biospecies') { const e = this.g.ents.get(this.entId); if (e?.t === 'bioport') this.g.enqueue({ t: 'bioRobotConfig', id: e.id, species: el.value || null }); return; } if (el.id === 'biosamplemode') { const e = this.g.ents.get(this.entId), mode = el.value; if (e?.t === 'bioport' && (mode === 'sample' || mode === 'genetic' || mode === 'cells')) this.g.enqueue({ t: 'bioRobotConfig', id: e.id, sampleMode: mode }); return; } if (el.dataset.act === 'slotLimit') { const input = el as unknown as HTMLInputElement, id = Number(el.dataset.id), e = this.g.ents.get(id), n = input.valueAsNumber; if (e?.t === 'loco' && Number.isInteger(n) && n >= 1 && n <= LOCO_FUEL_SLOTS) this.g.enqueue({ t: 'slotLimit', id, limit: n === LOCO_FUEL_SLOTS ? null : n }); else if (e?.t === 'chest' && e.inv && Number.isInteger(n) && n >= 1 && n <= e.inv.size) this.g.enqueue({ t: 'slotLimit', id, limit: n }); else if (e?.inv) input.value = String(e.t === 'loco' ? locoFuelOpen(e) : e.inv.slotLimit); return; } if (el.id?.startsWith('gen-f')) refreshGenForm('gen', win); if (this.x?.input(el)) return; if (this.prod.input(el)) return; if (el.id === 'voicesel') this.h.setSettings({ voiceName: el.value }); });
    win.addEventListener('change', ev => {
      const el = ev.target as HTMLSelectElement; if (this.inRender || el.dataset.act !== 'bio-follow') return;
      const form = this.g.v117.genetics.forms.find(f => f.id === Number(el.dataset.form)), player = Number(el.value);
      if (!form || form.dead || form.owner !== (this.g.v117.playerIds[this.g.pl] || `player-${this.g.pl + 1}`) || !Number.isSafeInteger(player) || player < 0 || player >= this.g.nPlayers) return;
      this.g.enqueue({ t: 'v117', section: 'genetics', op: 'order', opId: `ui-bio-${this.g.tick}-${++this.v117Seq}`, formId: form.id, mode: 'follow', points: [], combat: form.order.combat, player });
      setTimeout(() => this.render(true), 50);
    });
    win.addEventListener('keydown', ev => { if (this.x?.key(ev)) return; });
    win.addEventListener('input', ev => {
      const el = ev.target as HTMLInputElement;
      if (this.x?.input(el)) return;
      if (el.id === 'seed') { this.menuSeed = el.value; return; }
      if (el.id === 'calcrate') { this.prod.input(el); return; }
      if (el.id === 'notetitle' || el.id === 'notetext') { this.noteDraft[el.id === 'notetitle' ? 'title' : 'text'] = el.value; return; }
      if (el.id === 'notex' || el.id === 'notey') { this.noteDraft[el.id === 'notex' ? 'x' : 'y'] = el.value.replace(/[^\d.-]/g, ''); return; }
      if (el.id === 'noteiconq') { this.noteIconQ = el.value; this.render(true); return; }
      if (el.id === 'invq') { this.invQ = el.value; this.render(true); return; }
      if (el.id === 'techq') { this.techQ = el.value; const q = el.value.trim().toLowerCase(); const t = q && TECH_LIST.find(t => t.name.toLowerCase().includes(q) || tr(t.name).toLowerCase().includes(q) || t.unlocks.some(u => { const n = ITEMS[recipeItem(u)]?.name || ''; return n.toLowerCase().includes(q) || tr(n).toLowerCase().includes(q); })); if (t) { this.techSel = t.id; this.centerTech(t.id); } this.render(true); return; }
      if (el.id === 'csearch') { this.chestQ = el.value; this.render(true); return; }
      if (el.id === 'nsearch') { this.netQ = el.value; this.render(true); return; }
      if (el.id === 'spq') { this.sPickQ = el.value; this.render(true); return; }
      const k = el.dataset?.set; if (!k) return;
      const v = +el.value / 100; this.h.setSettings({ [k]: v } as any); const sp = el.nextElementSibling; if (sp) sp.textContent = el.value + '%';
    });
    win.addEventListener('change', ev => {
      if (this.inRender || this.open !== 'menu' || this.menuPage !== 'new') return;
      const el = ev.target as HTMLElement; if (el.id === 'mode' || el.id.startsWith('gen-')) this.captureMenuDraft();
    });
  }
  get g() { return this.h.getGame(); }
  /** v1.9: статистика 2.0 и калькулятор */
  prod = new ProdUI({ statsView: (t, tab, sel) => this.h.statsView(t, tab, sel), game: () => this.g, render: () => this.render(true),
    note: (title, text) => { const p = this.g.player; this.g.enqueue({ t: 'note', op: 'add', x: p.x, y: p.y, title, text }); },
    calcOpen: () => { if (this.open !== 'calc') this.toggle('calc'); else this.render(true); } });
  /** v1.14: снаряжение, Рой, панель персонажа; artPick — следующий щелчок по большой карте даёт залп артиллерии */
  artPick = false;
  gear = new GearUI({ game: () => this.g, render: () => this.render(true), mapAt: (x, y) => { if (this.open !== 'map') this.toggle('map'); Object.assign(this.mapv, { cx: x, cy: y, follow: false }); this.onMapDraw?.(); this.render(true); },
    artPick: () => { this.artPick = true; if (this.open !== 'map') this.toggle('map'); this.g.msg('Щёлкните по большой карте — туда ударит артиллерия'); this.render(true); } });
  /** v1.9: заметки на карте — список в окне карты, новая заметка там, где стоит инженер */
  noteDraft: { title: string; text: string; x: string; y: string; icon: string | null } = { title: '', text: '', x: '', y: '', icon: null };
  private noteEditing: number | null = null; private noteIconOpen = false; private noteIconQ = '';
  /** v1.11: вид большой карты — центр, клеток на пиксель, следовать за игроком; координаты под курсором */
  mapv = { cx: 0, cy: 0, tpp: 2, follow: true }; mapHover: [number, number] | null = null; onMapHover: (() => void) | null = null; onMapDraw: (() => void) | null = null;
  private mapWindow() {
    const mapW = Math.max(320, Math.floor(innerWidth - 20)), mapH = Math.max(120, Math.floor(innerHeight - 310));
    const sc = this.mapv.tpp >= 1 ? `1 пиксель = ${+this.mapv.tpp.toFixed(2)} кл.` : `1 клетка = ${+(1 / this.mapv.tpp).toFixed(1)} пикс.`;
    return `<div class="panel map-full"><div class="title">Карта <span class="dim small">${sc}</span> <span class="x" data-act="close" title="Закрыть (M / Esc)">✕</span></div>
      <div class="mapwrap" id="mapwrap"><canvas id="bigmap" width="${mapW}" height="${mapH}"></canvas><canvas id="bigov" width="${mapW}" height="${mapH}"></canvas><div class="mapcoord" id="mapcoord" style="${this.mapHover ? '' : 'display:none'}">${this.mapHover ? `X ${this.mapHover[0]}, Y ${this.mapHover[1]}` : ''}</div></div>
      ${this.bioRoute.html()}<div class="row2 map-toolbar"><button data-act="pollution">${this.h.pollution() ? '☑' : '☐'} Загрязнение (U)</button> <button data-act="mapzoom" data-v="1" title="Приблизить">＋</button><button data-act="mapzoom" data-v="-1" title="Отдалить">－</button> <button data-act="mapme" class="${this.mapv.follow ? 'on' : ''}">◎ К инженеру</button> ${this.g.settings.enemies !== 'none' ? `<button data-act="artpick" class="${this.artPick ? 'on' : ''}">🎯 Залп артиллерии</button>` : ''}
      ${this.h.pollution() ? '<span class="maplegend small">загрязнение: мало <i></i> много</span>' : ''}</div>
      <div class="dim small map-hint">Колесо — масштаб, перетаскивание — сдвиг, щелчок — координаты для метки. Чёрное — туман войны, малиновое — гнёзда Роя, фиолетовое — слизь, красные точки — ползуны, треугольники — атаки Роя.${this.artPick ? ' <b class="err">Щёлкните по карте — туда ударит артиллерия.</b>' : ''}</div>${this.notesHtml()}</div>`;
  }
  /** мировые координаты под точкой экрана на большой карте */
  private mapCanvasBox(): { canvas: HTMLCanvasElement; left: number; top: number; width: number; height: number } | null {
    const canvas = document.getElementById('bigmap') as HTMLCanvasElement | null; if (!canvas) return null;
    const overlay = document.getElementById('bigov') as HTMLCanvasElement | null; if (!overlay) return null;
    const r = overlay.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return null;
    return { canvas, left: r.left, top: r.top, width: r.width, height: r.height };
  }
  mapAt(cx: number, cy: number): [number, number] | null {
    const box = this.mapCanvasBox(); if (!box) return null;
    const px = (cx - box.left) * box.canvas.width / box.width, py = (cy - box.top) * box.canvas.height / box.height;
    if (px < 0 || py < 0 || px > box.canvas.width || py > box.canvas.height) return null;
    return [this.mapv.cx + (px - box.canvas.width / 2) * this.mapv.tpp, this.mapv.cy + (py - box.canvas.height / 2) * this.mapv.tpp];
  }
  mapZoom(f: number, cx?: number, cy?: number) {
    const v = this.mapv; const before = cx != null ? this.mapAt(cx, cy!) : null; v.tpp = Math.max(0.125, Math.min(32, v.tpp * f));
    if (before) { const after = this.mapAt(cx!, cy!)!; v.cx += before[0] - after[0]; v.cy += before[1] - after[1]; v.follow = false; }
    this.onMapDraw?.(); this.render(true);
  }
  private notesHtml() {
    const g = this.g; const ns = g.notes || [];
    const list = ns.slice().reverse().map(n => `<div class="kv map-note"><span>${validNoteIcon(n.icon) ? `<img class="note-thumb" src="${iconURL(n.icon)}">` : '📌'} <b>${esc(n.title)}</b> <span class="dim small">(${Math.round(n.x)}, ${Math.round(n.y)})</span><br><span class="dim small" style="white-space:pre-line">${esc(n.text.split('\n').slice(0, 2).join('\n'))}</span></span><span><button class="mini" data-act="note-go" data-id="${n.id}" title="Показать на карте">◎</button> <button class="mini" data-act="note-edit" data-id="${n.id}" title="Изменить метку">✎</button> <button class="mini" data-act="note-del" data-id="${n.id}">Удалить</button></span></div>`).join('');
    const alerts = Object.values(g.v117.speakers.configs).filter(c => c.visual).map(c => { const e = g.ents.get(c.entityId); return e?.proto === 'programmable-speaker' && e.active ? `<div class="kv map-note"><span>🔊 <b>${esc(c.label || `Громкоговоритель ${c.entityId}`)}</b> <span class="dim small">(${Math.round(e.x + e.w / 2)}, ${Math.round(e.y + e.h / 2)})</span></span><button class="mini" data-act="speaker-go" data-id="${e.id}" title="Показать на карте">◎</button></div>` : ''; }).join('');
    const icon = this.noteDraft.icon && validNoteIcon(this.noteDraft.icon) ? `<img class="note-preview" src="${iconURL(this.noteDraft.icon)}"> ${esc(ITEMS[this.noteDraft.icon].name)}` : 'Без иконки';
    const q = this.noteIconQ.trim().toLowerCase();
    const options = Object.entries(ITEMS).filter(([id, it]) => validNoteIcon(id) && (!q || (it.name + ' ' + tr(it.name)).toLowerCase().includes(q))).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const picker = this.noteIconOpen ? `<div class="note-icon-picker"><input id="noteiconq" placeholder="Поиск предмета или руды" value="${esc(this.noteIconQ)}" autocomplete="off"><button class="mini" data-act="note-icon-clear">Сбросить</button><div class="note-icon-grid">${options.map(([id, it]) => `<button class="note-icon-option ${this.noteDraft.icon === id ? 'on' : ''}" data-act="note-icon-select" data-item="${esc(id)}" title="${esc(it.name)}"><img src="${iconURL(id)}"><span>${esc(it.name)}</span></button>`).join('') || '<span class="dim small">Совпадений нет</span>'}</div></div>` : '';
    const editing = this.noteEditing != null;
    return `${alerts ? `<div class="map-notes"><div class="lbl">Активные оповещения</div><div class="map-note-list">${alerts}</div></div>` : ''}<div class="map-notes"><div class="lbl">Заметки на карте (${ns.length})</div><div class="map-note-list">${list || '<div class="dim small">Заметок нет. Расчёт калькулятора (K) тоже можно сохранить заметкой.</div>'}</div>
      <div class="row2 map-note-form"><input id="notetitle" placeholder="Заголовок" maxlength="60" value="${esc(this.noteDraft.title)}" style="width:150px"> <input id="notetext" placeholder="Текст заметки" maxlength="400" value="${esc(this.noteDraft.text)}" style="flex:1;min-width:120px"> <input id="notex" placeholder="X" value="${esc(this.noteDraft.x)}" style="width:58px"> <input id="notey" placeholder="Y" value="${esc(this.noteDraft.y)}" style="width:58px"> <button data-act="note-icon-toggle">${icon}</button> <button data-act="note-add">${editing ? 'Сохранить метку' : '📌 Добавить'}</button>${editing ? '<button data-act="note-cancel">Отмена</button>' : ''}</div>${picker}${this.open === 'map' ? '<div class="dim small">Щёлкните по карте, чтобы указать координаты. Для метки можно выбрать предмет или руду.</div>' : ''}</div>`;
  }
  /** открыть калькулятор для предмета (из окна рецепта, статистики или клавишей) */
  openCalc(item: string | null, rate: number, from: 'stats' | 'recipe' | 'key') { if (item) this.prod.openCalc(item, rate, from); else this.prod.calcFrom = from; if (this.open !== 'calc') this.toggle('calc'); else this.render(true); }
  toggle(w: Win, ent = -1) { if (this.open === 'map') this.bioRoute.cancel(); this.tipKey = null; if (this.open === w && (w !== 'ent' || ent === this.entId)) { this.open = null; this.menuReturnTo = null; this.onOpen?.(null); } else { if (w === 'menu') { this.menuPage = 'home'; this.menuReturnTo = null; } this.open = w; this.entId = ent; this.onOpen?.(w); } this.last = ''; this.render(true); if (this.open === 'beta') this.refreshTele(); }
  onOpen: ((w: Win | null) => void) | null = null;
  /** показана обучающая подсказка (ключ TIPS) — до закрытия окна; onHint — озвучить её голосом ОСКАРа */
  tipKey: string | null = null; onHint: ((t: Tip) => void) | null = null;
  tele: any = null; bugText = ''; bugMsg = '';
  refreshTele() { this.h.teleReport().then(r => { this.tele = r; if (this.open === 'beta') this.render(true); }); }
  close() {
    const win = $('win'), active = document.activeElement;
    if (active instanceof HTMLElement && win.contains(active)) active.blur();
    this.artPick = false; this.bioRoute.cancel(); this.tipKey = null;
    if (this.menuReturnTo) { this.captureMenuDraft(); this.menuPage = this.menuReturnTo; this.menuReturnTo = null; this.open = 'menu'; this.onOpen?.('menu'); }
    else { this.open = null; this.menuReturnTo = null; this.onOpen?.(null); }
    this.last = ''; this.render(true);
  }
  /** ключ подсказки для открытого окна */
  private inRender = false;
  private tipFor(): string | null {
    if (this.open === 'inv' && this.invTab === 'logi' && this.tipKey !== 'inv') return 'inv:v13';
    if (this.open === 'inv' && this.tipKey !== 'inv' && seenTips().has('inv') && (this.g.inv.count('concrete') || this.g.inv.count('refined-concrete'))) return 'floor';
    if (this.open === 'inv' && seenTips().has('inv:v12') && this.tipKey !== 'inv' && this.tipKey !== 'inv:v12') return 'inv:v111'; // v1.11
    if (this.open === 'inv' && seenTips().has('inv') && this.tipKey !== 'inv') return 'inv:v12';
    if ((this.open === 'tech' || this.open === 'map' || this.open === 'mods') && seenTips().has(this.open) && this.tipKey !== this.open) return this.open + ':v111';
    if (this.open === 'bp' && this.bpTab === 'party' && this.tipKey !== 'bp') return 'bp:party'; // v1.13
    if ((this.open === 'mp' || this.open === 'players') && seenTips().has(this.open) && this.tipKey !== this.open) return this.open + ':v113';
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
    if (this.open === 'bp' && this.g.bpLibVer !== this.seenBpLib) { this.seenBpLib = this.g.bpLibVer; this.render(true); } // v1.13: библиотека партии изменилась
    const g = this.g; this.frame++;
    const r = g.research.current;
    const rc = r ? g.techCost(r) : 1, rl = r && TECHS[r].infinite ? ' ' + ((g.research.levels[r] || 0) + 1) : '';
    const rh = r ? `<div class="lbl">Исследование: <b>${TECHS[r].name}${rl}</b></div><div class="bar"><i style="width:${(g.research.progress / rc * 100).toFixed(1)}%"></i></div><div class="sub">${g.research.progress}/${rc}</div>` : `<div class="lbl dim">Нет исследования — нажмите <kbd>${keyName(this.h.getSettings().keys.tech)}</kbd></div>`;
    const goal = GOALS[Math.min(g.goalIdx, GOALS.length - 1)];
    const gh = g.scn ? (this.scn?.hud(g) || '') : `<div class="goal"><div class="oscar">ОСКАР</div><div><b>${goal.text}</b>${goal.progress ? ` <span class="dim">${goal.progress(g)}</span>` : ''}<div class="sub">${goal.hint}</div></div></div>`;
    const ch = g.x.mode === 1 ? '<div class="goal"><div class="oscar">🧪</div><div><b>Творческий режим</b><div class="sub">тестовая партия: достижения и рекорды отключены</div></div></div>' : g.x.cheats ? '<div class="sub">🧪 тестовая партия</div>' : '';
    // v1.14: панель персонажа внизу слева
    const ks = this.h.getSettings().keys; const hh = this.gear.heroPanel(keyName(ks.gear || 'KeyH'), keyName(ks.swarm || 'KeyZ'));
    if ($('hero').dataset.h !== hh) { morph($('hero'), tr(hh)); $('hero').dataset.h = hh; }
    const html = rh + ch + (this.x?.alertHud() || '') + gh + nucHud(g) + bioGuideHud(g);
    if ($('hudl').dataset.h !== html) { morph($('hudl'), tr(html)); $('hudl').dataset.h = html; }
    // хотбар (v1.11: ряды сверху вниз — 4…1, у ячейки — клавиша и значок закрепления)
    let hb = ''; const rows = this.hotRows(); const st = this.h.getSettings(); const cur = this.h.cursor();
    for (let r = rows - 1; r >= 0; r--) {
      hb += `<div class="hrow" data-row="${r}">`;
      for (let c = 0; c < 10; c++) {
        const i = r * 10 + c; const it = this.hotbar[i]; const n = it ? g.inv.count(it) : 0; const sel = it && cur === it; const key = shortKey(st.keys[`hb${r}_${c}`]);
        hb += it ? `<div class="slot ${sel ? 'sel' : ''} ${n ? '' : 'zero'} ${this.hotPin[i] ? 'pin' : ''}" data-h="${i}" data-tip="item:${it}"><img src="${iconURL(it)}">${n ? `<span class="cnt">${fmt(n)}</span>` : ''}<span class="key">${key}</span>${this.hotPin[i] ? '<span class="pinm">📌</span>' : ''}</div>`
          : `<div class="slot empty" data-h="${i}"><span class="key">${key}</span></div>`;
      }
      hb += '</div>';
    }
    if ($('hotbar').dataset.h !== hb) { morph($('hotbar'), tr(hb)); $('hotbar').dataset.h = hb; }
    // очередь крафта
    let q = '';
    g.queue.slice(0, 12).forEach((j, i) => { const r = RECIPES[j.recipe], it = recipeItem(j.recipe); const prog = j.started ? 1 - j.left / (r.time * 60) : 0; q += `<div class="slot ${j.auto ? 'auto' : ''}" data-q="${i}" data-tip="item:${it}"><img src="${iconURL(it)}"><span class="cnt">${j.count}</span><i class="qp" style="width:${prog * 100}%"></i></div>`; });
    if ($('craftq').dataset.h !== q) { morph($('craftq'), tr(q)); $('craftq').dataset.h = q; }
    // сообщения
    const msgs = g.messages.filter(m => g.tick - m.tick < 300).slice(-4).map(m => `<div>${esc(m.text)}</div>`).join('');
    if ($('toast').dataset.h !== msgs) { morph($('toast'), tr(msgs)); $('toast').dataset.h = msgs; }
    // авто-заполнение хотбара
    if (this.frame % 30 === 0) { const lim = this.hotRows() * 10; for (const s of g.inv.slots) if (s && ITEMS[s.item].place && !this.hotbar.includes(s.item) && !this.hotBan.includes(s.item)) { const k = this.hotbar.findIndex((x, i) => x == null && !this.hotPin[i] && i < lim); if (k >= 0) this.hotbar[k] = s.item; } }
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
      if (e.recipe && RECIPES[e.recipe] && e.t !== 'lab') h += `<div>Рецепт: ${tr(recipeDisplayName(e.recipe))}</div>`;
      if (e.progress != null && (e.crafting || e.t === 'drill')) h += `<div class="bar sm"><i style="width:${Math.min(100, e.progress * 100)}%"></i></div>`;
      if (e.fuel) h += `<div>Топливо: ${ITEMS[e.fuel.item].name} ×${e.fuel.count}</div>`;
      if (e.t === 'drill') { let n = 0; for (const [x, y] of g.drillTiles(e)) n += g.world.res(x, y) ? g.world.amt(x, y) : 0; h += `<div>Руды под буром: ${fmt(n)}</div>`; }
      if (e.t === 'underground') h += `<div>${e.ug === 'in' ? 'Вход' : 'Выход'}${e.partner == null ? ' (нет пары)' : ''}</div>`;
      if (e._net != null && e._net >= 0) { const n = g.powerNets.get(e._net); if (n) h += `<div class="dim">Сеть: ${kw(n.demand)} / ${kw(n.supply)}</div>`; }
      if (e.t === 'engine' || e.t === 'solar') h += `<div>Выработка: ${kw(e._out || 0)}</div>`;
      if (e.t === 'engine' && (e._wk || 0) > 0.5) h += `<div class="dim small">Горячий пар: лишняя энергия списывается — ${kw(e._wk!)}</div>`;
      if (e.t === 'reactor') h += `<div>${Math.round(heatTemp(e))} °C · ${e._mw || 0} МВт${e.rt ? ' · стержень ' + Math.round(e.rt / 60) + ' с' : ''}</div>`;
      if (e.t === 'hpipe' || e.t === 'hexch') h += `<div>${Math.round(heatTemp(e))} °C${e.t === 'hexch' && e._hx ? ' · ' + e._hx.toFixed(1) + ' МВт в пар' : ''}</div>`;
      if (e.t === 'drill' && (e.status === 'no-acid' || e.status === 'uranium-locked' || e.status === 'uranium-electric')) h += `<div class="dim small">${e.status === 'no-acid' ? 'Урану нужна серная кислота: подключите трубу сзади' : e.status === 'uranium-locked' ? 'Нужна технология «Переработка урана»' : 'Уран добывает только электробур'}</div>`;
      if (p.fluid && e._fn) e._fn.forEach((ni) => { const n = g.fluidNets[ni]; if (n) h += `<div>${fluidName(n.fluid)}: ${n.amount.toFixed(0)}/${n.cap}${n.conflict ? ' ⚠ смешение' : ''}</div>`; });
      if (e.t !== 'nest') h += `<div class="dim small">ЛКМ — открыть, ПКМ — разобрать${['belt', 'inserter', 'drill', 'assembler', 'furnace'].includes(e.t) ? ', R — повернуть' : ''}</div>`;
    } else if (tile) {
      const [x, y] = tile; if (!g.world.hasChunk(Math.floor(x / 32), Math.floor(y / 32))) { $('hover').innerHTML = ''; return; }
      const r = g.world.res(x, y), d = g.world.decor(x, y);
      if (r === R_OIL) h = `<b>Нефтяной источник</b><div>Выход: ${g.world.amt(x, y)}%</div><div class="dim small">Поставьте насос-качалку центром на источник</div>`;
      else if (r === R_URAN) h = `<b>${ITEMS[RES_ITEMS[r]].name}</b><div>Запас: ${fmt(g.world.amt(x, y))}</div><div class="dim small">Только электробур с серной кислотой</div>`;
      else if (r) h = `<b>${ITEMS[RES_ITEMS[r]].name}</b><div>Запас: ${fmt(g.world.amt(x, y))}</div><div class="dim small">ПКМ — добыть рукой</div>`;
      const pol = g.world.chunkAt(x, y).pollution; if (pol > 0.05 && this.h.pollution()) h += `<div class="dim">Загрязнение чанка: ${pol.toFixed(1)}</div>`;
      else if (d) h = `<b>${d === 1 ? 'Дерево' : 'Скала'}</b><div class="dim small">ПКМ — добыть (${d === 1 ? '4 древесины' : '20 камня, 10 угля'})</div>`;
      const gh = g.ghostAt(x, y);
      if (gh) { const ST: Record<string, string> = { wait: 'Ждёт робота', out: 'Вне зоны робопортов', noitem: 'Нет предмета', norobot: 'Нет свободных роботов' }; h = `<b>Призрак: ${PROTOS[gh.proto].name}</b>${gh.rb ? '<div class="small">Восстановить разрушенное</div>' : ''}${gh.st ? `<div class="st st-${gh.st === 'wait' ? 'working' : 'no-input'}">${ST[gh.st]}</div>` : ''}<div class="dim small">Shift+ЛКМ — роботы построят первым</div>`; }
      const gi = [...g.ground.values()].find(i => i.x === x && i.y === y);
      if (gi) h += `<b>${ITEMS[gi.item].name} ×${gi.count}</b><div class="dim small">F — подобрать рядом</div>`;
    }
    if ($('hover').dataset.h !== h) { morph($('hover'), tr(h)); $('hover').dataset.h = h; $('hover').style.display = h ? 'block' : 'none'; }
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
      case 'console': html = this.modrt?.consoleHtml() || ''; break;
      case 'map': html = this.mapWindow(); break;
      case 'gcon': case 'fact': html = this.x?.html(this.open) || ''; break;
      case 'chal': case 'ach': case 'chalres': html = this.scn?.html(this.open) || ''; break;
      case 'gear': html = this.gear.gearHtml(); break;
      case 'swarm': html = this.gear.swarmHtml(); break;
    }
    html = this.withTip(html);
    if (this.menuReturnTo && this.open !== 'menu') {
      const titles: Partial<Record<Exclude<Win, null>, string>> = { chal: 'Испытания', ach: 'Достижения', chalres: 'Результаты испытания', mp: 'Мультиплеер', players: 'Игроки', mods: 'Моды', modcheck: 'Проверка модов', settings: 'Настройки', help: 'Помощь', news: 'Что нового' };
      html = this.menuFrame(html, this.menuReturnTo, titles[this.open!] || 'ЗАВОД-7', true);
    }
    if (force || html !== this.last) {
      if ((this.open === 'menu' || this.open === 'mp' || this.open === 'bp' || this.open === 'settings' || this.open === 'bug' || this.open === 'beta') && !force && win.innerHTML) return; // не сбрасывать поля ввода
      // v1.4: поле поиска и прокрутка склада переживают перерисовку
      const act = document.activeElement as HTMLInputElement | null; const aidId = act && win.contains(act) && (act.id === 'csearch' || act.id === 'xcon-in' || act.id.startsWith('xin-') || act.id === 'invq' || act.id === 'techq' || act.id === 'spq' || act.id === 'nsearch' || act.id === 'calcrate' || act.id === 'notetitle' || act.id === 'notetext' || act.id === 'notex' || act.id === 'notey' || act.id === 'noteiconq') ? act.id : null;
      const selection = aidId && act ? { value: act.value, start: act.selectionStart, end: act.selectionEnd, direction: act.selectionDirection } : null;
      const cg = document.getElementById('cgrid'); const sTop = cg ? cg.scrollTop : 0;
      this.inRender = true; try { morph(win, tr(html)); } finally { this.inRender = false; } this.last = html; win.style.display = 'flex'; if (this.tgPending) { this.centerTech(this.tgPending); this.tgPending = null; this.techApply(); } if (this.open === 'console') { const mc = document.getElementById('mconsole'); if (mc) mc.scrollTop = mc.scrollHeight; } this.refreshTip();
      const cg2 = document.getElementById('cgrid'); if (cg2 && sTop) cg2.scrollTop = sTop;
      const invq = document.getElementById('invq') as HTMLInputElement | null; if (invq && invq.value !== this.invQ) invq.value = this.invQ;
      if (selection && aidId && selection.start != null && selection.end != null) { const inp = document.getElementById(aidId) as HTMLInputElement | null; if (inp) { inp.focus(); if (inp.value === selection.value) inp.setSelectionRange(selection.start, selection.end, selection.direction || 'none'); } }
    }
  }
  private invGrid(mode: 'cursor' | 'put') {
    const g = this.g; let h = '<div class="grid g10">';
    g.inv.slots.forEach((s, i) => { h += slotHTML(s?.item || null, s?.count ?? null, `data-act="inv" data-mode="${mode}" data-i="${i}"`); });
    return h + '</div>';
  }
  /** v1.11: поиск по инвентарю и рецептам (русские и английские названия) */
  invQ = '';
  private invMatch(it: string) { const q = this.invQ.trim().toLowerCase(); if (!q) return true; const n = ITEMS[it].name; return n.toLowerCase().includes(q) || tr(n).toLowerCase().includes(q) || it.includes(q); }
  private invWindow() {
    const g = this.g; const st = this.h.getSettings(); const q = this.invQ.trim();
    const qk = st.quickKey === 'ctrl' ? 'Ctrl' : 'Shift', pk = st.quickKey === 'ctrl' ? 'Средняя кнопка' : 'Ctrl+ЛКМ / средняя кнопка';
    const groupIcon = (id: string) => { const r = RECIPE_LIST.find(rid => RECIPES[rid].cat === 'crafting' && ITEMS[recipeItem(rid)]?.group === id); return r ? `<img src="${iconURL(recipeItem(r))}">` : ''; };
    const tabs = '<div class="tabs ctabs">' + GROUPS.map(([id, name]) => `<div class="tab ${this.tab === id && !q ? 'on' : ''}" data-act="tab" data-tab="${id}">${groupIcon(id)}${name}</div>`).join('') + '</div>';
    let rec = '<div class="grid g8 recgrid">'; let nrec = 0;
    for (const rid of RECIPE_LIST) {
      const r = RECIPES[rid]; if (r.cat !== 'crafting') continue;
        if (!r.out.length) continue;
        const out = r.out[0][0]; if (q ? !this.invMatch(out) : (ITEMS[out].group !== this.tab && !(this.tab === 'inter' && ITEMS[out].group === 'raw'))) continue;
      if (!g.enabled.has(rid) || g.recipeBanned(rid)) continue; nrec++; // v1.16: закрытые рецепты в обычном списке не показываются (они видны в дереве технологий)
      const n = g.maxCraftable(rid, 99); const pin = this.hotbar.includes(out);
      rec += `<div class="slot ${n ? '' : 'none'}" data-act="craft" data-r="${rid}" data-tip="recipe:${rid}"><img src="${iconURL(out)}">${n ? `<span class="cnt">${n}</span>` : ''}${pin ? '<span class="pinm">📌</span>' : ''}</div>`;
    }
    rec += '</div>' + (!nrec ? '<div class="dim small">Ничего не найдено</div>' : '');
    const used = g.inv.slots.filter(Boolean).length, size = g.inv.slots.length;
    const pageSize = 32, pages = Math.max(1, Math.ceil(size / pageSize)); this.invPage = Math.max(0, Math.min(pages - 1, this.invPage));
    const first = this.invPage * pageSize, last = Math.min(size, first + pageSize);
    const pagebar = pages > 1 ? `<div class="row2 invpages"><button data-act="invpage" data-v="${Math.max(0, this.invPage - 1)}" ${this.invPage === 0 ? 'disabled' : ''} aria-label="Предыдущие ячейки">‹</button>${Array.from({ length: pages }, (_, p) => `<button data-act="invpage" data-v="${p}" class="${p === this.invPage ? 'on' : ''}" aria-label="Ячейки ${p * pageSize + 1}–${Math.min(size, (p + 1) * pageSize)}">${p * pageSize + 1}–${Math.min(size, (p + 1) * pageSize)}</button>`).join('')}<button data-act="invpage" data-v="${Math.min(pages - 1, this.invPage + 1)}" ${this.invPage === pages - 1 ? 'disabled' : ''} aria-label="Следующие ячейки">›</button></div>` : '';
    let grid = '<div class="grid g10 invgrid">';
    for (let i = first; i < last; i++) { const sl = g.inv.slots[i]; const it = sl?.item || null; const dim = it && q && !this.invMatch(it) ? ' dimslot' : ''; const pin = it && this.hotbar.includes(it) ? '<span class="pinm">📌</span>' : '';
      grid += it ? `<div class="slot${dim}" data-act="inv" data-mode="cursor" data-i="${i}" data-tip="item:${it}"><img src="${iconURL(it)}">${sl!.count > 0 ? `<span class="cnt">${fmt(sl!.count)}</span>` : ''}${pin}</div>` : `<div class="slot empty" data-act="inv" data-mode="cursor" data-i="${i}"></div>`; }
    grid += '</div>';
    const trashUsed = g.trash.slots.filter(Boolean).length;
    const trash = `<div class="lbl">Ячейки для удаления: ${trashUsed}/8</div><div class="grid g8 trashgrid">${g.trash.slots.map((sl, i) => slotHTML(sl?.item || null, sl?.count ?? null, `data-act="inv" data-mode="trash" data-i="${i}"`)).join('')}</div><div class="row2"><button data-act="trashClear" ${trashUsed ? '' : 'disabled'}>Удалить содержимое корзины</button><span class="dim small">ЛКМ — стопка, ПКМ — половина, Shift+ПКМ — один предмет</span></div>`;
    const eq = g.equip; const ed = eq ? ITEMS[eq].equip : null;
    let pf = 0; const rb = robotView(g, ITEM_IDX).buf; for (let i = 3; i < rb.length; i += ROBOT_STRIDE) if (rb[i] & 1) pf++;
    const armor = `<div class="lbl">Броня</div><div class="row">${slotHTML(eq, null, `data-act="unequip" id="equipslot"`)}<div class="small">${ed ? `<b>${ITEMS[eq!].name}</b><br>Зона ${ed.zone}×${ed.zone}, до ${ed.robots} роботов из инвентаря · в полёте ${pf}<br><span class="dim">ЛКМ — снять</span>` : '<span class="dim">Пусто — ЛКМ по модулю брони в инвентаре, чтобы надеть (личный робопорт: «Строительные роботы»)</span>'}</div></div>`;
    const itabs = `<div class="tabs"><div class="tab ${this.invTab === 'inv' ? 'on' : ''}" data-act="invtab" data-tab="inv">Инвентарь</div><div class="tab ${this.invTab === 'logi' ? 'on' : ''}" data-act="invtab" data-tab="logi">Логистика</div></div>`;
    const search = `<div class="row2 invsearch"><input id="invq" placeholder="🔍 Поиск предмета или рецепта" value="${esc(this.invQ)}" autocomplete="off">${q ? '<button data-act="invqclear">✕</button>' : ''}</div>`;
    const cap = `<div class="invcap"><div class="bar sm"><i style="width:${(used / size * 100).toFixed(0)}%"></i></div><span class="small ${used >= size ? 'err' : 'dim'}">Занято ${used} / ${size} ячеек</span></div>`;
    const hints = `<div class="hints small"><span><kbd>ЛКМ</kbd> взять в руку</span><span><kbd>ПКМ</kbd> половину</span><span><kbd>Shift+ЛКМ</kbd> взять всю стопку</span><span><kbd>Shift+ПКМ</kbd> один</span><span><kbd>${pk}</kbd> закрепить в быстром доступе</span><span><kbd>${qk}+ЛКМ</kbd> по постройке — быстрая погрузка</span><span><kbd>${esc(keyName(st.keys.pipette))}</kbd> убрать из руки</span></div>`;
    const body = this.invTab === 'logi' ? this.personalTab() : `${search}${pagebar}${grid}${cap}${trash}${hints}${armor}`;
    const queue = g.queue.length ? `<div class="lbl">Очередь крафта</div><div class="grid g8">${g.queue.slice(0, 16).map((j, i) => { const r = RECIPES[j.recipe], it = recipeItem(j.recipe); const prog = j.started ? 1 - j.left / (r.time * 60) : 0; return `<div class="slot ${j.auto ? 'auto' : ''}" data-act="cancelq" data-q="${i}" data-tip="item:${it}"><img src="${iconURL(it)}"><span class="cnt">${j.count}</span><i class="qp" style="width:${prog * 100}%"></i></div>`; }).join('')}</div><div class="dim small">ЛКМ по заказу — отменить</div>` : '';
    return `<div class="panel invpanel"><div class="title">Инвентарь <span class="x" data-act="close">✕</span></div>${itabs}${body}</div>
    <div class="panel invpanel"><div class="title">Крафт</div>${q ? `<div class="dim small">Поиск: «${esc(q)}» во всех группах</div>` : tabs}${rec}<div class="dim small">ЛКМ — 1 шт, ПКМ — 5 шт, Shift — сколько можно. Детали создаются сами.</div>${queue}</div>`;
  }

  /** v1.16: окно реактора — температура, стержень, мощность и соседи, управление запуском */
  private reactorHTML(e: Entity): string {
    const g = this.g; const T = heatTemp(e), rod = e.rt || 0, noBoom = !!g.settings.noBoom;
    const cells = e.input?.['nuclear-fuel-cell'] || 0, waste = e.output?.['used-nuclear-fuel-cell'] || 0;
    const sl = (item: string, n: number, slot: string, label: string) => `<div class="lab">${label}${slotHTML(n ? item : null, n || null, n ? `data-act="take" data-slot="${slot}"` : '')}</div>`;
    const cls = T >= OVER_T ? 'err' : T >= WARN_T ? 'warn' : '';
    let b = `<div class="row">${sl('nuclear-fuel-cell', cells, 'input:nuclear-fuel-cell', 'Стержни')}<div class="arrow">➜</div>${sl('used-nuclear-fuel-cell', waste, 'output:used-nuclear-fuel-cell', 'Отходы')}</div>`;
    b += `<div>Температура: <b class="${cls}">${Math.round(T)} °C</b></div><div class="bar"><i style="width:${Math.min(100, T / 12).toFixed(0)}%"></i></div>`;
    b += `<div class="dim small">Зоны: от 900 °C — тревога, от 1000 °C — перегрев, 1200 °C — предел${e.t === 'reactor' && T >= HEX_ON ? '. От 500 °C реактор нельзя разобрать' : ''}.</div>`;
    if (rod) b += `<div>Стержень: осталось ${Math.floor(rod / 3600)}:${String(Math.floor(rod / 60) % 60).padStart(2, '0')} из 3:20</div><div class="bar sm"><i style="width:${((1 - rod / ROD_TICKS) * 100).toFixed(1)}%"></i></div>`;
    b += `<div>Мощность: <b>${e._mw || 0} МВт</b> (${rod ? `базовые 40 + бонус ${40 * (e.rn || 0)}` : 'не горит'}) · соседей: ${e.rn || 0}</div>`;
    if (!rod) b += `<div class="dim small">${e._why || 'Ждёт запуска'}</div>`;
    if (e.rstop) b += `<div class="err">Аварийная остановка: выработка прекращена, накопленное тепло остаётся</div>`;
    if (e._dT !== undefined && T >= 300) b += `<div class="small ${e._dT > 30 ? 'warn' : 'dim'}">Температура: ${e._dT >= 0 ? '+' : '−'}${Math.abs(Math.round(e._dT))} °C/мин${rod ? ` · горение ещё ${Math.ceil(rod / 60)} с` : ''}</div>`;
    if (T >= WARN_T - 100 && e._cause) b += `<div class="small ${T >= WARN_T ? 'warn' : 'dim'}">Вероятная причина: ${e._cause}</div>`;
    if (T >= WARN_T) b += `<div class="${T >= OVER_T ? 'err' : 'warn'}">${T >= OVER_T ? (noBoom ? 'Перегрев: тепло теряется, взрыв отключён' : `Перегрев: взрыв через ${Math.max(0, Math.ceil((600 - (e.ot || 0)) / 60))} с`) : (noBoom ? 'Тревога: близко к перегреву' : 'Авария возможна')} — проверьте воду, пар, теплообменники и соединения</div>`;
    b += `<div class="row2"><button data-act="rallow" data-on="${e.rgo === false ? 1 : 0}">${e.rgo === false ? 'Разрешить следующий стержень' : 'Запретить следующий стержень'}</button><button class="${e.rstop ? 'on' : ''}" data-act="rstop" data-on="${e.rstop ? 0 : 1}">${e.rstop ? 'Снять остановку' : 'Аварийная остановка'}</button></div>`;
    b += `<div class="row2"><button class="${noBoom ? 'on' : ''}" data-act="noboom" data-on="${noBoom ? 0 : 1}">Реакторы не взрываются: ${noBoom ? 'вкл' : 'выкл'}</button></div>`;
    b += `<div class="dim small">Стержень горит ровно 200 с (12 000 тиков); 8 ГДж. Соседние реакторы (стороной 5 клеток, с совпадающим краем) дают +40 МВт каждый. Взрыв: радиус ${BOOM_R}, заражение радиус 20 на 30 мин.</div>`;
    return b;
  }
  private speakerHTML(e: Entity) {
    const g = this.g, c = g.v117.speakers.configs[String(e.id)] || { mode: 'off', sound: 'attack-siren', group: '', label: '', range: 'local', radius: 32, volume: 60, playback: 'once', intervalTicks: 300, pauseTicks: 300, visual: true, manualOn: false };
    const options = (rows: [string, string][], value: string) => rows.map(([v, n]) => `<option value="${v}"${value === v ? ' selected' : ''}>${n}</option>`).join('');
    const status: Record<string, string> = { disabled: 'Выключен', 'no-power': 'Нет питания', 'speaker-wait': 'Ожидание сигнала', 'speaker-pause': 'Пауза между срабатываниями', 'speaker-idle': 'Сигнал ожидает повтора', working: 'Активен' };
    return `<div class="lbl">Настройка громкоговорителя</div><div class="row2"><label>Источник <select id="speaker-mode">${options([['off', 'Выключен'], ['manual', 'Вручную включён'], ['circuit', 'Условие сети']], c.mode)}</select></label><label>Звук <select id="speaker-sound">${options([['attack-siren', 'Сирена нападения'], ['short-alert', 'Короткая тревога'], ['bell', 'Звонок'], ['warning-horn', 'Низкий гудок'], ['completion', 'Завершение']], c.sound)}</select></label></div>`
      + `<div class="row2"><label>Область <select id="speaker-range">${options([['local', 'Рядом'], ['global', 'Вся карта']], c.range)}</select></label><label>Воспроизведение <select id="speaker-playback">${options([['once', 'Один раз'], ['repeat', 'Повторять'], ['continuous', 'Непрерывно']], c.playback)}</select></label></div>`
      + `<div class="row2"><label>Радиус 8–64 <input id="speaker-radius" type="number" min="8" max="64" step="1" value="${c.radius}" style="width:5em"></label><label>Громкость 0–100% <input id="speaker-volume" type="number" min="0" max="100" step="1" value="${c.volume}" style="width:5em"></label></div>`
      + `<div class="row2"><label>Интервал, с <input id="speaker-interval" type="number" min="1" max="60" step="1" value="${Math.round(c.intervalTicks / 60)}" style="width:5em"></label><label>Пауза, с <input id="speaker-pause" type="number" min="1" max="60" step="1" value="${Math.round(c.pauseTicks / 60)}" style="width:5em"></label></div>`
      + `<div class="row2"><label>Подпись <input id="speaker-label" maxlength="64" value="${esc(c.label)}"></label><label>Группа <input id="speaker-group" maxlength="32" pattern="[A-Za-z0-9_-]*" value="${esc(c.group)}"></label></div>`
      + `<div class="row2"><label><input id="speaker-visual" type="checkbox"${c.visual ? ' checked' : ''}> Значок на карте</label><button data-act="speaker-save">Сохранить настройки</button></div>`
      + `<div class="row2"><button data-act="speaker-manual" ${c.mode !== 'manual' ? 'disabled' : ''}>${c.manualOn ? 'Выключить' : 'Включить вручную'}</button><button data-act="speaker-listen">Прослушать</button><span class="${e.active ? 'ok' : 'dim'}">${status[e.status || ''] || 'Ожидание'}</span></div>`
      + `<div class="dim small">Для режима сети задайте штатное условие в разделе «Схемотехника» ниже. Местный звук учитывает расстояние от инженера. Ожидание 1 кВт · активный сигнал 5 кВт.</div>`;
  }
  private dronePortHTML(e: Entity) {
    const g = this.g, key = String(e.id), p = g.v117.drones.ports[key];
    const radius = p?.radius ?? 32, enabled = p?.enabled !== false, autoLaunch = p?.autoLaunch === true, centerX = p?.centerX ?? e.x + e.w / 2, centerY = p?.centerY ?? e.y + e.h / 2;
    const parked = (e.inv?.slots || []).flatMap(s => s?.instance ? [s.instance] : []);
    const active = g.v117.drones.instances.filter(d => d.owner === (g.v117.playerIds[g.pl] || `player-${g.pl + 1}`));
    const inventoryGrid = (from: number, to: number) => `<div class="grid g8">${(e.inv?.slots || []).slice(from, to).map((s, j) => slotHTML(s?.item || null, s?.count ?? null, s ? `data-act="take" data-slot="chest:${from + j}"` : '')).join('')}</div>`;
    const modes = Object.entries(DRONE_MODELS).map(([model, spec]) => `<div class="lab"><b>${esc(ITEMS[`combat-drone-${model}`]?.name || model)}</b> · ${spec.hp} HP · ${spec.speed} клеток/с · ${spec.units} единиц · ${spec.damage} ${spec.damageType}<br><span class="dim small">${spec.ammoItem ? `${esc(ITEMS[spec.ammoItem]?.name || spec.ammoItem)}: ${spec.ammoLimit}` : 'Боезапас не нужен'} · ${Math.round(spec.energyPerUse / 1000)} кДж/действие · дальность ${spec.range}</span></div>`).join('');
    const droneRows = parked.map(d => {
      const item = `combat-drone-${d.model}`, spec = DRONE_MODELS[d.model as keyof typeof DRONE_MODELS];
      return `<div class="row2"><span>${slotHTML(item, 1)} ${esc(ITEMS[item]?.name || item)} · ${Math.ceil(d.hp)}/${d.maxHp} HP · ${(d.charge / 1e6).toFixed(2)} MJ${d.ammoType ? ` · ${esc(ITEMS[d.ammoType]?.name || d.ammoType)} ${d.ammo}` : ''}${d.model === 'repair' ? ` · ремонт ${d.repair}` : ''}</span><button data-act="drone-launch" data-id="${d.id}" ${enabled && spec ? '' : 'disabled'}>Запустить</button>${droneTransferControls(g, d.id)}</div>`;
    }).join('') || '<div class="dim small">В порту пока нет физических дронов. Положите дрон в инвентаре в сетку порта.</div>';
    const activeRows = active.map(d => { const stopped = d.mode === 'landed' || d.mode === 'disabled'; return `<div class="row2"><span>${esc(ITEMS[`combat-drone-${d.model}`]?.name || d.model)} #${d.id} · ${Math.ceil(d.hp)}/${d.maxHp} HP · ${(d.charge / 1e6).toFixed(2)} MJ · ${stopped ? 'остановлен' : d.mode === 'returning' ? 'возвращается' : d.mode === 'repair' ? 'ремонтирует' : 'вылетел'}${d.ammoType ? ` · боезапас ${d.ammo}` : ''}</span>${stopped ? `<button data-act="drone-recover" data-id="${d.id}">Забрать</button>` : `<button data-act="drone-return" data-id="${d.id}">Вернуть</button>`}${droneTransferControls(g, d.id)}</div>`; }).join('') || '<div class="dim small">Ваших дронов в полёте нет.</div>';
    const power = e._net != null && e._net >= 0 ? g.powerNets.get(e._net) : null;
    return `<div class="lbl">Боевой порт · ${enabled ? 'включён' : 'отключён'} · ${p?.owner === (g.v117.playerIds[g.pl] || `player-${g.pl + 1}`) ? 'ваш' : p ? 'другого владельца' : 'ещё не настроен'}</div>`
      + `<div class="row2"><label>Радиус связи 16–64 <input id="drone-port-radius" type="number" min="16" max="64" step="1" value="${radius}" style="width:5em"></label><label><input id="drone-port-enabled" type="checkbox"${enabled ? ' checked' : ''}> Включён</label><label><input id="drone-port-auto" type="checkbox"${autoLaunch ? ' checked' : ''}> Автовыпуск</label><button data-act="drone-port-save">Сохранить</button></div>`
      + `<div class="row2"><label>${tr('Приоритет вылета')}: <select id="drone-port-priority"><option value=""${p?.priority == null ? ' selected' : ''}>${tr('Автоматически')}</option>${Object.keys(DRONE_MODELS).map(model => `<option value="${model}"${p?.priority === model ? ' selected' : ''}>${esc(tr(ITEMS[`combat-drone-${model}`].name))}</option>`).join('')}</select></label><span class="small">Центр участка: ${centerX.toFixed(1)}, ${centerY.toFixed(1)} · радиус защиты 16 клеток, в пределах зоны связи</span><button data-act="drone-port-center">Назначить вокруг инженера</button></div>`
      + `<div class="small">Питание: ${power ? `удовлетворение ${(power.satisfaction * 100).toFixed(0)}%` : 'нет подключённой сети'} · ${e.active ? 'заряжает батареи' : 'ожидание'} · склад ${parked.length}/12</div>${power ? `<div class="dim small">Ожидание 50 кВт · при зарядке всего 650 кВт (зарядные устройства до 600 кВт).</div>` : ''}`
      + `<div class="lbl">Посадочные места · ${parked.length}/12</div>${inventoryGrid(0, 12)}`
      + `<div class="lbl">Боезапас · четыре ячейки</div>${inventoryGrid(12, 16)}<div class="lbl">Ремонтный резерв · две ячейки</div>${inventoryGrid(16, 18)}`
      + `<div class="dim small">Порт принимает магазины, ракеты, топливо огнемёта и ремонтные наборы. Он пополняет дроны из соответствующих ячеек и заряжает их при наличии питания. Обычный клик по дрону переносит целый экземпляр вместе с состоянием.</div>`
      + `<div class="lbl">Доступные модели</div>${modes}<div class="lbl">Стоянка в порту</div>${droneRows}<div class="row2"><span class="lbl">Ваши действующие дроны</span><button data-act="drone-return-all" data-id="${e.id}">Вернуть все из этого порта</button></div>${activeRows}`;
  }
  private geneticsLabHTML(e: Entity) {
    const g = this.g, state = g.v117.genetics.labs[String(e.id)], banks = [...g.ents.values()].filter(x => x.proto === 'bio-culture-bank').sort((a, b) => a.id - b.id);
    const rows = BIO_V117_SOURCES.map(s => {
      const key = `${s.family}:${s.kind}`, analyzed = !!g.v117.genetics.library[key]?.analyzed, data = g.inv.count(`bio-genome-data-${s.kind}`), cells = g.inv.count(`viable-cell-${s.kind}`);
      const culture = banks.map(bank => ({ bank, line: g.v117.genetics.banks[`${bank.id}:${s.kind}`] })).filter(x => x.line);
      return `<div class="row2 bio-source"><span>${esc(s.label)} · ${analyzed ? 'геном записан' : `данные ${data}`} · донорские клетки ${cells}${culture.length ? ` · линии ${culture.map(x => `#${x.bank.id}: ${x.line!.cells}/100`).join(', ')}` : ''}</span>${data && !analyzed ? `<button data-act="bio-command" data-op="analyze" data-family="${s.kind}">Записать геном</button>` : ''}${cells ? banks.filter(bank => !g.v117.genetics.banks[`${bank.id}:${s.kind}`]).map(bank => `<button data-act="bio-command" data-op="preserve" data-family="${s.kind}" data-bank="${bank.id}" data-lab="${e.id}" ${state?.activity || e.crafting ? 'disabled' : ''}>Основание линии → #${bank.id}</button>`).join('') : ''}</div>`;
    }).join('');
    const activity = state?.activity ? `${state.activity.kind === 'found' ? 'Основание линии' : 'Деление культуры'} · ${esc(state.activity.species)} · ${Math.floor(state.progress / TICKS)} / ${state.activity.kind === 'found' ? 60 : 20} с` : 'Ожидание';
    return `<div class="lbl">Геномная библиотека · ${Object.values(g.v117.genetics.library).filter(x => x.analyzed).length}/15</div><div class="small">${esc(activity)}</div>${e.crafting && e.recipe ? `<div class="small">Рецепт: ${esc(recipeDisplayName(e.recipe))} · цикл ${Math.floor((e.progress || 0) * (RECIPES[e.recipe]?.time || 0))} с</div>` : ''}<div class="bio-sources">${rows}</div><div class="dim small">Выберите рецепт выделения ДНК или анализа в генолаборатории. Кнопками лаборатории запишите геном и основайте линию; капсулы культуры выпускаются из банка.</div>`;
  }
  private bioFabricatorHTML(e: Entity) {
    const g = this.g, who = g.v117.playerIds[g.pl] || `player-${g.pl + 1}`;
    const jobs = g.v117.genetics.jobs.filter(j => j.fabId === e.id).sort((a, b) => a.id - b.id);
    const stageName: Record<string, string> = { queued: 'Ожидает резерва материалов', 'cell-prep': 'Подготовка клеточной линии', growth: 'Выращивание ткани', controller: 'Установка нейроконтроллера', ready: 'Готово к выпуску', blocked: 'Ожидает выпуска', culturing: 'Подготовка клеточной линии', assembling: 'Выращивание ткани' };
    const jobRows = jobs.map(j => {
      const s = BIO_V117_SOURCES.find(row => row.kind === j.family), ready = j.stage === 'ready' || j.stage === 'blocked';
      const total = s ? 40 * s.w * TICKS : 1, pct = Math.min(100, 100 * j.progress / total);
      return `<div class="lab bioform-job"><div><b>#${j.id} ${esc(s?.label || j.family)}</b> · ${s?.w || 0} W · ${esc(stageName[j.stage] || j.stage)} · ${Math.floor(j.progress / TICKS)}/${Math.floor(total / TICKS)} с<div class="bar sm"><i style="width:${pct.toFixed(1)}%"></i></div></div>${j.owner === who && !ready ? `<button data-act="bio-cancel-job" data-job="${j.id}">Отменить</button>` : ''}</div>`;
    }).join('') || '<div class="dim small">Очередь пуста. Сухие материалы резервируются перед подготовкой клеток; жидкости расходуются по этапам.</div>';
    const available = BIO_V117_SOURCES.map(s => {
      const item = `bioform-${s.form}`, recipe = RECIPES[item], analyzed = !!g.v117.genetics.library[`${s.family}:${s.kind}`]?.analyzed;
      const unlocked = !!recipe && g.recipeAvailable(item), reason = !analyzed ? 'Сначала запишите геном' : !unlocked ? 'Нужны технологии рецепта' : jobs.length >= 5 ? 'Очередь заполнена' : '';
      return `<div class="row2 bio-source"><span>${esc(s.label)} · ${s.w} W${analyzed ? ' · геном записан' : ' · геном не изучен'}</span><button data-act="bio-queue" data-item="${item}" data-fab="${e.id}" ${!analyzed || !unlocked || jobs.length >= 5 ? 'disabled' : ''} title="${esc(reason)}">Поставить в очередь</button></div>`;
    }).join('');
    const dry = Object.entries(e.input || {}).filter(([, n]) => n > 0).map(([item, n]) => `<div class="lab">${slotHTML(item, n, `data-act="take" data-slot="input:${item}"`)}</div>`).join('');
    return `<div class="lbl">Биофабрикатор · ${jobs.length}/5 работ · ${esc(STATUS_TEXT[e.status || ''] || '')}</div><div class="bio-jobs">${jobRows}</div><div class="lbl">Новые работы по изученным геномам</div><div class="bio-sources">${available}</div><div class="lbl">Зарезервированные для очереди входы</div><div class="row2">${dry || '<span class="dim small">В буфере нет сухих входов</span>'}</div><div class="dim small">Одна работа проходит резервирование, подготовку клеточной линии, рост ткани, установку контроллера и выпуск. Неиспользованный резерв возвращается при отмене; обработанные материалы не возвращаются. Жидкости проходят через порты согласно выбранному рецепту.</div>`;
  }
  private bioCultureBankHTML(e: Entity) {
    const g = this.g, lines = Object.entries(g.v117.genetics.banks).filter(([, b]) => b.entityId === e.id).sort((a, b) => a[0].localeCompare(b[0]));
    const rows = lines.map(([key, b]) => {
      const species = BIO_V117_SOURCES.find(s => s.kind === b.species), lab = g.ents.get(b.labId), work = lab && g.v117.genetics.labs[String(lab.id)];
      const busy = !!work?.activity || !!lab?.crafting;
      return `<div class="row2"><span>${esc(species?.label || b.species)} · ${b.cells}/100 порций${b.unpoweredTicks ? ` · без питания ${Math.floor(b.unpoweredTicks / (60 * TICKS))} мин` : ''}</span><button data-act="bio-command" data-op="divide" data-family="${b.species}" data-bank="${e.id}" ${busy || b.cells < 1 || b.cells >= 100 ? 'disabled' : ''}>Делить · 20 с</button><button data-act="bio-command" data-op="export-culture" data-family="${b.species}" data-bank="${e.id}" ${b.cells <= 1 ? 'disabled' : ''}>Экспортировать капсулу</button></div>`;
    }).join('');
    return `${this.chestGrid(e)}<div class="lbl">Живые линии · ${lines.length}</div>${rows || '<div class="dim small">Пока нет клеточных линий. Основание выполняется в генетической лаборатории из жизнеспособной пробы.</div>'}`;
  }
  private bioLibraryHTML() {
    const rows = BIO_V117_SOURCES.map(s => {
      const record = this.g.v117.genetics.library[`${s.family}:${s.kind}`];
      return `<div class="row2"><span>${esc(s.label)}</span><span class="${record?.analyzed ? 'ok' : 'dim'}">${record?.analyzed ? 'геном изучен' : 'не изучен'}</span></div>`;
    }).join('');
    return `<div class="lbl">Записи геномов · ${Object.values(this.g.v117.genetics.library).filter(x => x.analyzed).length}/15</div>${rows}`;
  }
  private bioCommandPostHTML(e: Entity) {
    const g = this.g, ownerId = g.v117.playerIds[g.pl] || `player-${g.pl + 1}`;
    const postCapsule = g.v117.genetics.feeders?.['e:' + e.id], handCapsule = g.v117.genetics.feeders?.['p:' + ownerId];
    const nutritionHtml = `<div class="dim small">${tr('Остаток открытой капсулы в пункте:')} ${postCapsule?.remaining.toFixed(2) || '0'}/20 · ${tr('В ручном дозаторе:')} ${handCapsule?.remaining.toFixed(2) || '0'}/20</div>`;
    const links = bioCommandLinks(g);
    const forms = g.v117.genetics.forms.filter(f => f.owner === ownerId).sort((a, b) => a.id - b.id);
    const rows = forms.map(f => {
      const species = BIO_V117_SOURCES.find(s => s.kind === f.family), w = species?.w || 0, reserve = Math.max(0, f.food - f.foodTimer * 2 * w / (60 * TICKS));
      const orderNames = { move: 'Идти к точке', patrol: 'Патрулировать', follow: 'Следовать за инженером', hold: 'Удерживать', return: 'На снабжение' };
      const order = f.order.mode === 'patrol' ? `${orderNames.patrol}: ${(f.order.cursor || 0) + 1}/${f.order.waypoints.length} · ${f.order.patrolMode === 'pingpong' ? 'Туда-обратно' : 'Замкнутый круг'}` : orderNames[f.order.mode];
      const state = f.dead ? 'погиб' : f.detonationTicks !== undefined ? `${tr('Подрыв через')} ${(f.detonationTicks / TICKS).toFixed(1)} ${tr('с')}` : reserve <= 0 ? 'нет питания' : `${Math.ceil(reserve)}/${20 * w} ед.`;
      const connected = links.has(f.id), contact = connected ? tr('Связь есть') : `${tr('Нет связи с пультом')} · ${tr('Последние сведения')}: ${f.lastContact === undefined ? '—' : Math.max(0, Math.floor((g.tick - f.lastContact) / TICKS)) + ' ' + tr('с')}`;
      const detonationControl = f.family === 'destroyer' ? `<button data-act="bio-command" data-op="detonate" data-form="${f.id}" data-enabled="${f.detonationTicks === undefined}" ${f.dead || !connected ? 'disabled' : ''} title="${tr('Подрыв уничтожит эту особь. Подготовка: 2 секунды.')}">${tr(f.detonationTicks === undefined ? 'Подготовить подрыв · 2 с' : 'Отменить подрыв')}</button>` : '';
      return `<div class="lab bioform-row"><div><b>#${f.id} ${esc(species?.label || f.family)}</b> · ${w} W · ${Math.ceil(f.hp)}/${f.maxHp} HP · ${esc(state)} · ${esc(contact)}<div class="dim small">Приказ: ${esc(order)}${f.disconnected ? ` · связь ${Math.floor(f.disconnected / TICKS)} с отсутствует` : ''}${f.target != null ? ' · бой' : ''}</div></div><div class="row2">${detonationControl}<label class="small">Следовать за <select data-act="bio-follow" data-form="${f.id}" ${f.dead || !connected ? 'disabled' : ''}>${Array.from({ length: g.nPlayers }, (_, i) => `<option value="${i}"${(g.v117.playerIds[i] || `player-${i + 1}`) === (f.order.followPlayer || f.owner) ? ' selected' : ''}>${esc(g.peer(i).name || `Игрок ${i + 1}`)}</option>`).join('')}</select></label><button data-act="bio-squad" data-form="${f.id}">Группа…</button><button data-act="bio-order" data-form="${f.id}" data-mode="hold" ${f.dead || !connected ? 'disabled' : ''}>Удерживать</button><button data-act="bio-order" data-form="${f.id}" data-mode="move" ${f.dead || !connected ? 'disabled' : ''}>Идти к точке</button><button data-act="bio-order" data-form="${f.id}" data-mode="patrol" ${f.dead || !connected ? 'disabled' : ''}>Патруль</button><button data-act="bio-order" data-form="${f.id}" data-mode="return" ${f.dead || !connected ? 'disabled' : ''}>На снабжение</button><button data-act="bio-order" data-form="${f.id}" data-mode="combat" ${f.dead || !connected ? 'disabled' : ''}>Бой ${f.order.combat ? 'вкл.' : 'выкл.'}</button><button data-act="bio-order" data-form="${f.id}" data-mode="auto-return" ${f.dead || !connected ? 'disabled' : ''}>Автоснабжение ${f.autoReturn ? 'вкл.' : 'выкл.'}</button><button data-act="bio-command" data-op="feed" data-form="${f.id}" ${f.dead || Math.hypot(f.x - g.player.x, f.y - g.player.y) > 4 || reserve >= 20 * w || f.emptyCapsuleDue || f.foodCapsule > 0 ? 'disabled' : ''}>Питательная капсула</button><span class="dim small">Ткани восстанавливаются в пункте снабжения</span>${Array.from({ length: g.nPlayers }, (_, i) => i).filter(i => i !== g.pl).map(i => `<button data-act="bio-transfer" data-form="${f.id}" data-player="${i}" ${f.dead || !connected ? 'disabled' : ''}>Передать: ${esc(g.peer(i).name || `Игрок ${i + 1}`)}</button>`).join('')}</div></div>`;
    }).join('');
    const squadNames = [...new Set(forms.filter(f => !f.dead && f.squad).map(f => f.squad!))].sort();
    const squads = squadNames.map(name => {
      const members = forms.filter(f => !f.dead && f.squad === name), first = members[0];
      if (!first) return '';
      const weight = members.reduce((n, f) => n + (BIO_V117_SOURCES.find(s => s.kind === f.family)?.w || 0), 0);
      const connected = members.every(f => links.has(f.id));
      const hp = members.reduce((n, f) => n + f.hp, 0), reserve = members.reduce((n, f) => n + f.food, 0);
      return `<div class="lab bioform-squad"><b>${esc(name)}</b> · ${members.length} особей · ${weight} W · ${Math.ceil(hp)} HP · запас ${Math.ceil(reserve)}<div class="row2"><button data-act="bio-squad-order" data-form="${first.id}" data-squad="${esc(name)}" data-mode="follow" ${connected ? '' : 'disabled'}>Следовать</button><button data-act="bio-squad-order" data-form="${first.id}" data-squad="${esc(name)}" data-mode="hold" ${connected ? '' : 'disabled'}>Удерживать</button><button data-act="bio-squad-order" data-form="${first.id}" data-squad="${esc(name)}" data-mode="move" ${connected ? '' : 'disabled'}>К точке</button><button data-act="bio-squad-order" data-form="${first.id}" data-squad="${esc(name)}" data-mode="patrol" ${connected ? '' : 'disabled'}>Патруль</button><button data-act="bio-squad-order" data-form="${first.id}" data-squad="${esc(name)}" data-mode="return" ${connected ? '' : 'disabled'}>На снабжение</button><button data-act="bio-squad-order" data-form="${first.id}" data-squad="${esc(name)}" data-mode="combat" ${connected ? '' : 'disabled'}>Бой ${first.order.combat ? 'вкл.' : 'выкл.'}</button><button data-act="bio-squad-order" data-form="${first.id}" data-squad="${esc(name)}" data-mode="auto-return" ${connected ? '' : 'disabled'}>Автоснабжение ${members.every(f => f.autoReturn) ? 'вкл.' : 'выкл.'}</button></div></div>`;
    }).join('');
    const energy = g.energy(e), fluid = g.fluidNetFor(e, 'nutrient-medium', 'in');
    return nutritionHtml + `<div class="lbl">Командный пункт · связь 128 клеток · снабжение 8 клеток</div><div class="small">Питание ${energy >= .999 ? 'в норме' : 'недостаточно'} · питательная среда ${fluid?.fluid === 'nutrient-medium' ? Math.floor(fluid.amount) : 0}/500 · капсулы ${e.inv?.count('nutrient-capsule') || 0} · пустые ${e.inv?.count('empty-bio-capsule') || 0}</div>${e.req ? `<div class="dim small">Заявки логистике задаются в блоке ниже. По умолчанию запрашивается 24 питательные капсулы.</div>` : ''}<div class="lbl">Отряды владельца · ${forms.filter(f => !f.dead).length} живых</div>${squads}${rows || '<div class="dim small">Нет выращенных биоформ. Геномная лаборатория, библиотека и фабрикатор открываются после исследования.</div>'}`;
  }
  private entWindow() {
    const g = this.g; const e = g.ents.get(this.entId);
    if (!e) { this.open = null; return ''; }
    const p = PROTOS[e.proto];
    let b = `<div class="st st-${e.status}">${STATUS_TEXT[e.status || ''] || ''}</div>`;
    const slot = (item: string | null, n: number | null, s: string, label: string) => `<div class="lab">${label}${slotHTML(item, n, item || s === 'fuel' ? `data-act="take" data-slot="${s}"` : '')}</div>`;
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
        b += `<div class="row">${fuelSlot ? `<div>${fuelSlot}</div>` : ''}<div>Скорость: ${p.speed} ед/с<br>Руды в зоне: ${fmt(n)}</div></div>${prog(e.progress!)}${power()}`;
        if (p.fluid) { const an = g.fluidNets[e._fn?.[0] ?? -1]; b += `<div>Серная кислота: ${an && an.fluid === 'sulfuric-acid' ? an.amount.toFixed(0) : 0} / ${p.fluid[0].cap}</div><div class="dim small">Урану нужна 1 ед. кислоты на единицу руды — труба подключается с задней стороны (по стрелке выход). Обычным рудам кислота не нужна.</div>`; }
        break;
      }
      case 'assembler': {
        if (e.proto === 'combat-drone-port') { b += this.dronePortHTML(e); break; }
        if (e.proto === 'bio-fabricator') b += this.bioFabricatorHTML(e);
        let rl = '<div class="grid g10 recipes">';
        const cats = p.cats || ['crafting'];
        for (const rid of RECIPE_LIST) {
          const r = RECIPES[rid]; if (!cats.includes(r.cat) || !g.recipeAvailable(rid)) continue;
          const icon = recipeItem(rid);
          if (r.minTier && asmTier(e.proto) < r.minTier) { rl += `<div class="slot locked" title="Нужен сборщик уровня ${r.minTier} или выше" data-tip="recipe:${rid}"><img src="${iconURL(icon)}"></div>`; continue; }
          rl += `<div class="slot ${e.recipe === rid ? 'sel' : ''}" data-act="setrecipe" data-r="${rid}" data-tip="recipe:${rid}"><img src="${iconURL(icon)}"></div>`;
        }
        if (rl === '<div class="grid g10 recipes">') rl += '<div class="dim">Нет изученных рецептов — см. технологии (T)</div>';
        rl += '</div>';
        if (e.recipe) {
          const r = RECIPES[e.recipe];
          const fl = (it: string, io: 'in' | 'out') => { const n = g.fluidNetFor(e, it, io); return n ? Math.floor(n.amount) : 0; };
          const ins = r.in.map(([it, k]) => ITEMS[it].fluid ? `<div class="lab">${k}×${slotHTML(it, fl(it, 'in'))}</div>` : `<div class="lab">${k}×${slotHTML(it, e.input![it] || 0, `data-act="take" data-slot="input:${it}"`)}</div>`).join('');
          const outs = r.out.length ? r.out.map(([o, k]) => ITEMS[o].fluid ? `<div class="lab">${k}×${slotHTML(o, fl(o, 'out'))}</div>` : (() => { const n = (e.output?.[o] || 0) + (e.outInstances?.filter(s => s.item === o).length || 0); return `<div class="lab">${k}×${slotHTML(o, n, n ? `data-act="take" data-slot="output:${o}"` : '')}</div>`; })()).join('') : `<div class="lab zero-output"><span class="zero-output-symbol" aria-hidden="true">♻</span><span>${tr('Выхода нет: отходы утилизируются')}</span></div>`;
          const fluidNote = fluidPortPanel(g, e, this.pendingFluidRecipe?.entity === e.id && this.pendingFluidRecipe.recipe !== e.recipe && this.pendingFluidRecipe.until > performance.now());
          b += `<div class="row">${ins}<div class="arrow">➜</div>${outs}</div>${fluidNote}${e.proto === 'bio-extractor' ? `<div class="dim small">${tr(BIO_PRECISION_HELP)}</div>` : ''}${prog(e.crafting ? e.progress! : 0)}<div class="dim small">Время: ${(r.time / p.speed!).toFixed(2)} с за цикл</div>`;
        }
        if (!e.recipe) b += fluidPortPanel(g, e, this.pendingFluidRecipe?.entity === e.id && this.pendingFluidRecipe.until > performance.now());
        if (e.recipe && RECIPES[e.recipe]?.rout) { b += `<div class="dim small">Шанс разделения: ${(RECIPES[e.recipe].rout!.find(x => x[0] === 'uranium-235')![1] / 10).toFixed(1)}% на U-235, иначе U-238. Результат выбирается при запуске партии${e.crafting && e.pick ? '' : ''}.</div>`; }
        if (e.recipe === 'uranium-enrichment') b += `<div class="dim small">Оборотный запас: 40 U-235 возвращаются в оборот. Чистый результат: +1 U-235, −3 U-238.</div>`;
        if (e.crafting && e.recipe && RECIPES[e.recipe]?.cat === 'centrifuging' || e.crafting && e.recipe === 'nuclear-fuel-cell') b += `<div class="dim small">Партия уже списана: при разборе машины она пропадёт.</div>`;
        if (e.rnx != null) b += `<div class="err small">Рецепт сменится после окончания цикла${e.rnx ? ': ' + tr(recipeDisplayName(e.rnx)) : ''}</div>`;
        const calcItem = e.recipe ? RECIPES[e.recipe]?.out[0]?.[0] : undefined;
        b += power() + `<div class="lbl">Рецепт: ${e.recipe && RECIPES[e.recipe] ? `${tr(recipeDisplayName(e.recipe))} ${calcItem ? `<button class="mini" data-act="calcrec" data-k="${calcItem}" title="Калькулятор">🧮 Калькулятор</button>` : ''}` : ''}</div>${rl}`;
        if (e.proto === 'genetic-lab') b += this.geneticsLabHTML(e);
        break;
      }
      case 'lab': {
        const cur = g.research.current;
        b += `<div class="row">${SCIENCE_PACKS.map(pk => slotHTML(pk, e.input![pk] || 0, `data-act="take" data-slot="input:${pk}"`)).join('')}</div>`;
        b += cur ? `<div>Изучается: <b>${TECHS[cur].name}</b> ${g.research.progress}/${g.techCost(cur)}</div>${prog(e.crafting ? e.progress! : 0)}` : `<div class="dim">Выберите исследование (T)</div>`;
        b += power(); break;
      }
      case 'chest': {
        if (e.proto === 'bio-culture-bank') { b = this.bioCultureBankHTML(e); break; }
        if (e.proto === 'genetic-library') { b = this.chestGrid(e) + this.bioLibraryHTML(); break; }
        if (e.proto === 'bio-command-post') { b = this.bioCommandPostHTML(e) + this.logiChest(e); break; }
        if (p.logi) { b = this.logiChest(e); break; }
        b = this.chestGrid(e) + `<button data-act="takeall">Забрать всё</button>`; break;
      }
      case 'car': {
        const v = e.vehicleState, invItems = g.inv.items(), turretIds = ['gun-turret', 'laser-turret', 'flamethrower-turret'];
        b += `<div>Скорость: ${Math.round((v?.speed || 0) * 10) / 10} клеток/с · двигатель 150 кВт только в движении</div>${fuelSlot}`;
        b += `<div class="lbl">Две турели</div><div class="row2">${(v?.mounts || [null, null]).map((m, i) => `<div class="lab">${i + 1}: ${m ? esc(PROTOS[m.proto].name) : 'пусто'} ${m ? `<button data-act="vehicle-turret" data-slot="${i}" data-v="">Снять</button>` : ''}${turretIds.filter(id => (invItems[id] || 0) > 0 && PROTOS[id]?.tur && (m?.proto !== id)).map(id => `<button data-act="vehicle-turret" data-slot="${i}" data-v="${id}">${esc(ITEMS[id].name)}</button>`).join('')}<div class="small">${m ? `Боезапас: ${m.ammo?.count || 0} · в стволе: ${m.rounds || 0} ${Object.keys(invItems).filter(id => (invItems[id] || 0) > 0 && ITEMS[id]?.am?.cat === (PROTOS[m.proto].tur?.kind === 'flame' ? 'flame' : PROTOS[m.proto].tur?.cat)).slice(0, 4).map(id => `<button data-act="vehicle-ammo" data-slot="${i}" data-v="${id}">+ ${esc(ITEMS[id].name)}</button>`).join('')}${m.ammo ? `<button data-act="vehicle-ammo" data-slot="${i}" data-v="">Снять боезапас</button>` : ''}` : ''}</div></div>`).join('')}</div>`;
        const modules = v?.grid || [], moduleKinds = PROTOS.car.vehicle?.equipmentKinds || [], fits = (id: string, x: number, y: number) => { const d = ITEMS[id].equip!; return x + (d.w || 1) <= 4 && y + (d.h || 1) <= 4 && !modules.some(m => { const q = ITEMS[m.id]?.equip; return q && x < m.x + (q.w || 1) && x + (d.w || 1) > m.x && y < m.y + (q.h || 1) && y + (d.h || 1) > m.y; }); };
        const moduleState = modules.map(m => {
          const isNuclear = ITEMS[m.id]?.equip?.kind === 'nreactor';
          if (!isNuclear) return `<button data-act="vehicle-equip" data-op="take" data-x="${m.x}" data-y="${m.y}">Снять ${esc(ITEMS[m.id].name)}</button>`;
          const active = (m.r || 0) > 0, seconds = active ? Math.ceil((m.r || 0) / TICKS) : 0;
          return `<div class="lab">${esc(ITEMS[m.id].name)} · резерв ${m.n || 0}/${NR_CAP} · ${active ? `цикл ${seconds} с` : 'ожидание'} · отходы ${m.w || 0}/${NR_CAP}<div><button data-act="vehicle-equip" data-op="feed" data-x="${m.x}" data-y="${m.y}" ${invItems['nuclear-fuel-cell'] ? '' : 'disabled'}>Загрузить стержни</button>${(m.w || 0) > 0 || (!active && (m.n || 0) > 0) ? `<button data-act="vehicle-equip" data-op="takeNuclear" data-x="${m.x}" data-y="${m.y}">Забрать стержни/отходы</button>` : ''}<button data-act="vehicle-equip" data-op="take" data-x="${m.x}" data-y="${m.y}">Снять</button></div></div>`;
        }).join('');
        b += `<div class="lbl">Оборудование 4×4 · заряд ${(v?.gridCharge || 0) / 1e6 | 0} МДж</div><div class="row2">${Object.keys(invItems).filter(id => (invItems[id] || 0) > 0 && ITEMS[id]?.equip && moduleKinds.includes(ITEMS[id].equip.kind as any)).slice(0, 12).map(id => { let at: [number, number] | null = null; for (let y = 0; y < 4 && !at; y++) for (let x = 0; x < 4 && !at; x++) if (fits(id, x, y)) at = [x, y]; return at ? `<button data-act="vehicle-equip" data-op="put" data-v="${id}" data-x="${at[0]}" data-y="${at[1]}">+ ${esc(ITEMS[id].name)} (${at.join(',')})</button>` : ''; }).join('')}${moduleState}</div><div class="dim small">Солнечные, fusion и ядерные реакторы вырабатывают энергию; аккумуляторы её накапливают для лазерных турелей.</div>`;
        b += `<div class="lbl">Багажник · ${e.inv?.slots.filter(Boolean).length || 0}/40 занято</div>${e.inv ? this.chestGrid(e) : ''}<button data-act="takeall">Забрать всё</button>`;
        if (v?.driver != null) b += `<div class="dim small">За рулём: ${g.peer(v.driver).name || 'вы'} · WASD управляет машиной · ${this.kname('vehicle')} — безопасный выход.</div>`;
        break;
      }
      case 'turret': {
        // v1.14: виды турелей — патроны / энергия / жидкое топливо; урон и скорострельность с учётом исследований
        const T = p.tur; const K: Record<string, string> = { gun: 'пулемёт', laser: 'лазер', flame: 'огнемёт', rocket: 'ракеты', tesla: 'тесла: цепная молния', mortar: 'миномёт: навесной огонь по площади', art: 'артиллерия: сама бьёт по гнёздам', rail: 'рельсотрон: пробивает всё на линии' };
        const rng = T ? Math.round(T.range * (1 + (T.kind === 'art' ? g.bonus('ar') : 0))) : p.range;
        const dmg = T?.dmg ? Math.round(T.dmg * dmgMul(g, (T.kind === 'flame' ? 'flame' : T.kind === 'tesla' ? 'tesla' : T.kind === 'laser' ? 'laser' : T.cat || 'bullet') as any)) : e.ammoType ? Math.round((ITEMS[e.ammoType].ammo || 0) * dmgMul(g, T?.cat || 'bullet')) : null;
        const info = `<div>${T ? K[T.kind] || '' : ''}<br>Дальность: ${T?.min ? T.min + '–' : ''}${rng} клеток${dmg != null ? `<br>Урон: ${dmg}` : ''}${T ? `<br>Выстрел раз в ${(T.cd / 60).toFixed(2)} с` : ''}${T && !T.air ? '<br><span class="dim">не бьёт по летунам</span>' : ''}</div>`;
        if (!T || T.cat) b += `<div class="row">${slot(e.ammo?.item || null, e.ammo?.count ?? null, 'ammo', 'Патроны')}<div>В стволе: ${e.rounds || 0}</div>${info}</div><div class="dim small">Кладите боеприпасы руками или манипулятором (${T?.cat === 'bullet' || !T ? 'магазины' : T.cat === 'rocket' ? 'ракеты' : T.cat === 'shell' ? 'снаряды' : T.cat === 'artillery' ? 'артиллерийские снаряды' : 'стрелы рельсотрона'}).</div>`;
        else b += `<div class="row">${info}</div>`;
        if (T?.kind === 'flame' && e._fn) { const n = g.fluidNets[e._fn[0]]; b += `<div>${n ? `${fluidName(n.fluid)}: ${n.amount.toFixed(0)} / ${n.cap}` : 'Нет топлива'}</div><div class="dim small">Топливо — сырая нефть, мазут или лёгкая нефть по трубе. Слизь Роя выгорает под огнём.</div>`; }
        if (p.energy) b += power();
        if (T?.kind === 'art') b += `<div class="dim small">Ручной залп: окно «Рой» → «Угрозы» или кнопка «Залп артиллерии» на большой карте.${e.artQ?.length ? ` В очереди целей: ${e.artQ.length}.` : ''}</div>`;
        break;
      }
      case 'nest': b += `<div>Прочность: ${Math.ceil(e.hp || 0)}/${p.hp}</div><div class="dim small">Гнездо Роя. Уничтожение повышает эволюцию.</div>`; break;
      case 'wall': b = `<div>Прочность: ${Math.ceil(e.hp || 0)}/${p.hp}</div><div class="dim small">Задерживает ползунов. Ремонт: ремонтный набор в руке + ЛКМ.</div>`; break;
      case 'gate': b = `<div>Прочность: ${Math.ceil(e.hp || 0)}/${p.hp}</div><div>${e.open ? 'Открыты' : 'Закрыты'}</div><div class="dim small">${e.proto === 'rail-gate' ? 'Ставятся на рельсы в линию стены. Открываются перед поездом и инженером, ползуны не проходят.' : 'Открываются сами, когда рядом инженер; ползуны не проходят.'}</div>`; break;
      case 'flare': b += `<div>${e.active ? 'Сжигает излишки' : 'Нет жидкости'}</div>${e._fn ? (() => { const n = g.fluidNets[e._fn![0]]; return n ? `<div>${fluidName(n.fluid)}: ${n.amount.toFixed(0)} / ${n.cap}</div>` : ''; })() : ''}<div class="dim small">Факел сжигает любую жидкость из трубы — 60 ед/с. Удобно, чтобы нефтепереработка не вставала из-за переполнения.</div>`; break;
      case 'lamp': if (e.proto === 'programmable-speaker') b += this.speakerHTML(e) + power(); else b += `<div>${e.active ? 'Светит' : e.cc?.en && this.wired(e) ? 'Выключена условием' : 'Включится ночью'}</div>${power()}`; break;
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
        if (e.t === 'engine') { const fnn = g.fluidNets[e._fn?.[0] ?? -1]; b += `<div>Выработка: ${kw(e._out || 0)} из ${kw(p.maxOut!)}</div>${e._net! < 0 ? '<div class="err">Не подключён к столбу</div>' : ''}`;
          if (fnn && fnn.fluid === 'steam' && fnn.amount > 0) b += `<div class="dim">Пар: ${Math.round(15 + fnn.se / 0.2)} °C · ${fnn.se.toFixed(0)} кДж/ед</div>`;
          if (p.turbine) b += `<div class="dim small">До 60 пара/с: 5,82 МВт на паре 500 °C, 1,8 МВт на пару бойлера (165 °C). Турбина забирает всю энергию пара.</div>`; else b += `<div class="dim small">До 900 кВт и 30 пара/с. Горячий пар даёт не больше 30 кДж на единицу — остальное списывается${(e._wk || 0) > 0.5 ? ': ' + kw(e._wk!) : ''}.</div>`; }
        if (e.t === 'boiler') b += `<div class="dim small">1.8 МВт · 60 воды/с → 60 пара/с. Вода — по бокам, пар — сверху (по стрелке).</div>`;
        if (e.t === 'pump') b += `<div class="dim small">1200 воды/с</div>`;
        break;
      }
      case 'reactor': b += this.reactorHTML(e); break;
      case 'hexch': case 'hpipe': {
        const T = heatTemp(e); b += `<div>Температура: <b>${Math.round(T)} °C</b></div><div class="bar sm"><i style="width:${Math.min(100, T / 12).toFixed(0)}%"></i></div><div class="dim small">Тепло: ${((e.hE || 0) / 1e6).toFixed(1)} МДж · теплоёмкость ${p.heatC} МДж/°C</div>`;
        if (e.t === 'hexch') { if (e._fn) e._fn.forEach((ni) => { const n = g.fluidNets[ni]; if (!n) return; b += `<div>${fluidName(n.fluid)}: ${n.amount.toFixed(0)} / ${n.cap} ${n.conflict ? '<span class="err">смешение жидкостей!</span>' : ''}</div>`; });
          b += `<div>В пар: <b>${(e._hx || 0).toFixed(2)} МВт</b> из 10 · пар 500 °C (97 кДж/ед)</div><div class="dim small">Работает выше 500 °C. Вода — по бокам, пар — сверху, тепло — снизу (по стрелкам портов). Одинаковый объём воды и пара: до 103,09 ед/с.</div>`; }
        else b += `<div class="dim small">Передаёт тепло четырём соседним клеткам. Теряет 20 Вт на каждый градус выше 15 °C — делайте линии короткими.</div>`;
        break;
      }
      case 'pole': {
        const n = g.powerNets.get(e._net!);
        if (n) {
          b = `<div>Потребление: <b>${kw(n.demand)}</b></div><div>Производство (макс.): <b>${kw(n.supply)}</b></div><div>Удовлетворение: <b>${(n.satisfaction * 100).toFixed(0)}%</b></div>`;
          b += `<div class="dim">Пар: ${kw(n.steam || 0)} · солнце: ${kw(n.solar || 0)} · аккумуляторы: ${(n.accFlow || 0) >= 0 ? 'заряд ' : 'разряд '}${kw(Math.abs(n.accFlow || 0))}</div>`;
          if (n.sl && n.dl) b += `<div class="lbl">Приоритеты</div>` + ['Критический', 'Обычный', 'Второстепенный'].map((nm, i) => `<div class="small">${nm}: спрос ${kw(n.dl![i])} → выдача ${kw(n.dl![i] * n.sl![i])} (${(n.sl![i] * 100).toFixed(0)}%)${n.dl![i] > 0 && n.sl![i] <= 0 ? ' <span class="err">отключены приоритетом</span>' : ''}</div>`).join('');
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
      case 'radar': {
        const R = g.x.rs; const ago = (t: number) => { const m = Math.floor((g.tick - t) / 3600); return m < 1 ? 'меньше минуты назад' : m < 90 ? m + ' мин назад' : Math.round(m / 60) + ' ч назад'; };
        const has = e.tx !== undefined && e.ty !== undefined; const cc = [Math.floor((e.x + 1) / 32), Math.floor((e.y + 1) / 32)];
        const sat = e.status === 'working' ? 1 : e.status === 'low-power' ? .5 : 0; const left = has ? Math.ceil((1 - (e.progress || 0)) * 30 / Math.max(.05, sat || .05)) : 0;
        const tgt = has ? `${g.world.hasChunk(e.tx!, e.ty!) ? 'обновление' : 'новый сектор'} (${e.tx}, ${e.ty}), в ${Math.max(Math.abs(e.tx! - cc[0]), Math.abs(e.ty! - cc[1]))} чанках${sat ? `, ещё ≈ ${left} с` : ', нет питания — скан стоит'}` : 'всё в радиусе свежее — ждёт';
        b += `<div>Постоянный обзор: 7×7 чанков. Дальний скан: один сектор раз в 30 с до радиуса 14 чанков. Расход: 300 кВт.</div><div class="small">Сейчас: ${tgt}</div>${prog(e.progress || 0)}${power()}`;
        b += `<div class="small dim">Всего по миру: новых секторов ${R.fresh}, обновлено ${R.upd}. Несколько радаров не берут один сектор; устаревшей считается разведка старше 5 мин.</div>`;
        const tr = g.v117.speakers.radar[String(e.id)] || { radius: 32, count: 0, attacking: false, attackedUntil: 0, enabled: false };
        b += `<div class="lbl">Сигналы угрозы</div><div class="row2"><label>Радиус наблюдения, 8–64 <input id="speaker-radar-radius" type="number" min="8" max="64" value="${tr.radius}" style="width:5em"></label><button data-act="speaker-radar-save">Сохранить радиус</button><button data-act="speaker-radar-toggle" class="${e.cc?.rd === 1 ? 'on' : ''}">${e.cc?.rd === 1 ? '☑ Читать угрозы' : '☐ Читать угрозы'}</button></div><div class="small">Обнаруженные враги: ${tr.count} · нападение: ${tr.attacking || tr.attackedUntil > g.tick ? 'да' : 'нет'}${e.status !== 'working' ? ' · нет питания' : ''}</div><div class="dim small">Выходы: signal-enemy-count и signal-attack-active. Неизвестные чанки не создаются для сканирования угроз.</div>`;
        b += `<div class="lbl">Уведомления</div><div class="row2">${(['uranium', 'oil', 'nest'] as const).map(k => `<button class="${R.flt[k] ? 'on' : ''}" data-act="rflt" data-k="${k}" data-on="${R.flt[k] ? 0 : 1}">${R.flt[k] ? '✓ ' : ''}${k === 'uranium' ? 'Уран' : k === 'oil' ? 'Нефть' : 'Гнёзда'}</button>`).join('')}</div>`;
        const fl = R.finds.filter(f => R.flt[f.k]).slice(-6).reverse(); const ageSc = (f: { cx: number; cy: number; t: number }) => ago(R.scan[f.cx + ',' + f.cy] ?? f.t);
        b += `<div class="lbl">Находки (${R.finds.length})</div>` + (fl.length ? fl.map(f => `<div class="small"><b>${f.k === 'uranium' ? 'Уран' : f.k === 'oil' ? 'Нефть' : 'Гнездо'}</b> (${Math.round(f.x)}, ${Math.round(f.y)}) · разведка ${ageSc(f)}${f.k === 'nest' ? ' <span class="dim">(данные могут устареть)</span>' : ''}</div>`).join('') : '<div class="small dim">Пока ничего не найдено</div>');
        break;
      }
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
      case 'bioport': {
        const modes: [string, string][] = [['corpses', 'Только останки'], ['all', 'Останки и слизь'], ['film', 'Санитарная очистка']];
        const bioFamilies = [['', 'Все семейства'], ['crawler', 'Ползуны'], ['spitter', 'Плевуны'], ['armored', 'Панцирники'], ['destroyer', 'Разрушители'], ['flyer', 'Летуны'], ['brood', 'Выводок'], ['giant', 'Гиганты'], ['queen', 'Королевы'], ['worm', 'Черви']];
        const bots = g.bioRobots.filter(r => r.homeId === e.id);
        const outputs = Object.entries(e.output || {}).filter(([, n]) => n > 0).map(([it, n]) => slotHTML(it, n, `data-act="take" data-slot="output:${it}"`)).join('');
        const bioStatus: Record<string, string> = { 'no-power': 'Нет энергии', 'no-robot': 'Нет роботов', 'no-target': 'Нет цели', 'no-capsule': 'Нет капсулы', 'no-preservation': 'Нет набора консервации культур', 'cells-expired': 'Живые клетки недоступны', 'no-research': 'Исследование режима биосбора недоступно', 'output-full': 'Выход забит', working: 'Работает' };
        b += `<div class="small">${tr('Радиус')}: <b>${p.bio?.range || 24}</b> · ${tr('Роботы')}: <b>${bots.length}/${p.bio?.robots || 4}</b> · ${tr(bioStatus[e.bioStatus || 'no-robot'] || 'Нет роботов')}</div>${power()}`;
        b += `<div class="row2"><label>${tr('Режим')} <select id="biomode">${modes.map(([v, n]) => `<option value="${v}"${(e.bioMode || 'corpses') === v ? ' selected' : ''}>${tr(n)}</option>`).join('')}</select></label><label>${tr('Семейство')} <select id="biofamily">${bioFamilies.map(([v, n]) => `<option value="${v}"${(e.bioFamily || '') === v ? ' selected' : ''}>${tr(n)}</option>`).join('')}</select></label></div>`;
        const sampleModes = [['sample', 'Материал', 'bio-sampling'], ['genetic', 'Генетическая проба', 'swarm-genomics'], ['cells', 'Живые клетки', 'cellular-sampling']];
        const sourceKinds = BIO_V117_SOURCES.filter(s => !e.bioFamily || s.family === e.bioFamily);
        b += `<div class="row2"><label>${tr('Тип пробы')} <select id="biosamplemode">${sampleModes.map(([v, n, tech]) => `<option value="${v}"${(e.bioSampleMode || 'sample') === v ? ' selected' : ''}${g.research.done.has(tech) ? '' : ' disabled'}>${esc(tr(n))}${g.research.done.has(tech) ? '' : ' 🔒'}</option>`).join('')}</select></label><label>${tr('Вид')} <select id="biospecies"><option value="">${tr('Все виды')}</option>${sourceKinds.map(s => `<option value="${esc(s.kind)}"${e.bioSpecies === s.kind ? ' selected' : ''}>${esc(tr(s.label))}</option>`).join('')}</select></label></div>`;
        const remains = nearbyBioCorpses(g, e.x + e.w / 2, e.y + e.h / 2, p.bio?.range || 24, 16, 256, e.bioFamily, c => !e.bioSpecies || e.bioSpecies === c.kind);
        b += `<div class="small">${tr('Ближайшие донорские клетки')}: ${remains.length ? remains.slice(0, 4).map(c => `${esc(tr(BIO_V117_SOURCES.find(s => s.kind === c.kind)?.label || c.kind))} · ${bioLivingTicksLeft(g, c) ? Math.ceil(bioLivingTicksLeft(g, c) / TICKS) + ' ' + tr('с') : tr('нежизнеспособны')}`).join(' · ') : tr('Нет цели')}</div>`;
        b += `<p class="dim small">${tr('Клетки проверяются при завершении забора: 10 игровых минут после гибели. Выжженные и самоподорвавшиеся останки не дают живых клеток. Слизь собирается отдельно в обычном режиме.')}</p>`;
        b += `<div class="lbl">${tr('Вход')}</div><div class="row">${slotHTML('empty-bio-capsule', e.input?.['empty-bio-capsule'] || 0, `data-act="take" data-slot="input:empty-bio-capsule"`)}${slotHTML('culture-preservation-kit', e.input?.['culture-preservation-kit'] || 0, `data-act="take" data-slot="input:culture-preservation-kit"`)}${slotHTML('sanitary-robot', e.input?.['sanitary-robot'] || 0, `data-act="take" data-slot="input:sanitary-robot"`)}</div>`;
        b += `<div class="lbl">${tr('Выход')}</div><div class="grid g7">${outputs || `<div class="dim small">${tr('Пусто')}</div>`}</div>`;
        break;
      }
      case 'solar': b += `<div>Выработка: ${kw(e._out || 0)} из ${kw(p.maxOut!)} (день/ночь: ${(g.daylight() * 100).toFixed(0)}%)</div>`; break;
    }
    if (moduleSlots(e)) {
      b += `<div class="lbl">Модули:</div><div class="row">${e.modules!.map((m, i) => slotHTML(m, null, m ? `data-act="take" data-slot="module:${i}"` : '')).join('')}</div>`;
      const f = fx(g, e); if (e.t !== 'beacon' && (f.speed || f.prod || f.energy || f.pollution)) b += `<div class="small fxl">Скорость <b>${pct(f.speed)}</b> · продуктивность <b>${pct(f.prod)}</b> · энергия <b>${pct(f.energy)}</b> · загрязнение <b>${pct(f.pollution)}</b></div>`;
      if (e.pbar) b += `<div class="dim small">Бонус продуктивности:</div><div class="bar sm prod"><i style="width:${Math.min(100, e.pbar * 100).toFixed(0)}%"></i></div>`;
    }
    if (e.t !== 'combinator' && !hasOut(e) && circuitCapable(e) && (this.wired(e) || e.cc?.setr)) b += this.circuitHTML(e);
    b += this.x?.entExtra(e) || '';
    if (e.hp != null && e.hp < p.hp && e.t !== 'nest' && e.t !== 'wall') b += `<div class="err">Повреждено: ${Math.ceil(e.hp)}/${p.hp} — ремонтный набор в руке + ЛКМ</div>`;
    const canPut = moduleSlots(e) > 0 || e.t === 'silo' || e.t === 'roboport' || e.t === 'bioport' || e.t === 'loco' || ['furnace', 'drill', 'assembler', 'lab', 'chest', 'boiler', 'inserter', 'turret', 'reactor'].includes(e.t) && (e.t !== 'drill' || p.energy?.kind === 'burner') && (e.t !== 'inserter' || p.energy?.kind === 'burner');
    return `<div class="panel"><div class="title">${p.name} <span class="x" data-act="close">✕</span></div>${b}</div>` + (canPut ? `<div class="panel"><div class="title">Инвентарь</div>${this.invGrid('put')}<div class="dim small">ЛКМ — положить стопку, Shift — всё такого типа, ПКМ — половину в руку. ${this.h.getSettings().quickKey === 'ctrl' ? 'Ctrl' : 'Shift'}+ЛКМ по постройке — загрузить всё нужное.</div></div>` : '');
  }
  /** v1.16: очередь исследований — текущее и ожидающие, с перестановкой; кнопки постановки выбранной технологии */
  private techQueueHtml(sel: string | null) {
    const g = this.g, q = g.x.rq, cur = g.research.current;
    const chip = (id: string, i: number, active: boolean) => {
      const wait = !active && !g.canResearch(id) ? (g.research.done.has(id) ? '' : ' wait') : '';
      return `<span class="rqchip ${active ? 'on' : ''}${wait}" data-tip="${esc(wait ? 'Ждёт предшественника' : TECHS[id].desc)}">${active ? '▶ ' : (i + 1) + '. '}${esc(TECHS[id].name)}${active && g.research.progress ? ` ${Math.floor(g.research.progress / g.techCost(id) * 100)}%` : ''}${active ? '' : ` <button data-act="rqmove" data-t="${id}" data-d="-1">↑</button><button data-act="rqmove" data-t="${id}" data-d="1">↓</button>`} ${active ? '' : `<button data-act="rqdel" data-t="${id}">✕</button>`}</span>`;
    };
    const n = (cur ? 1 : 0) + q.length;
    let add = '';
    if (sel && TECHS[sel] && g.techOk(sel) && (TECHS[sel].infinite || !g.research.done.has(sel)) && sel !== cur && !q.includes(sel)) {
      const miss = missingPrereqs(g, sel); const deps = miss.length ? depsToAdd(g, sel) : [];
      add = miss.length ? `<button data-act="rqadd" data-t="${sel}" data-deps="1">+ В очередь с предшественниками (${deps.length})</button>` : `<button data-act="rqadd" data-t="${sel}">+ В очередь «${esc(TECHS[sel].name)}»</button>`;
    }
    return `<div class="rqbar"><b>Очередь ${n}/${RQ_MAX}</b> ${cur ? chip(cur, 0, true) : '<span class="dim">нет активного исследования</span>'}${q.map((id, i) => chip(id, i + (cur ? 1 : 0), false)).join('')} ${add}${q.length ? ' <button data-act="rqclear">Очистить</button>' : ''}</div>`;
  }
  private techListHtml() {
    const g = this.g; let h = '';
    for (let era = 0; era < ERA_NAMES.length; era++) {
      const list = TECH_LIST.filter(t => techEra(t) === era); if (!list.length) continue;
      const nDone = list.filter(t => !t.infinite && g.research.done.has(t.id)).length;
      h += `<div class="era">${ERA_NAMES[era]} <span class="dim">${list.some(t => t.infinite) ? '' : `${nDone}/${list.length}`}</span></div><div class="techs">`;
      for (const t of list) {
        const lv = g.research.levels[t.id] || 0, cost = g.techCost(t.id);
        const done = !t.infinite && g.research.done.has(t.id), avail = g.canResearch(t.id), cur = g.research.current === t.id;
        h += `<div class="tech ${done ? 'done' : avail ? 'avail' : 'locked'} ${cur ? 'cur' : ''} ${g.techOk(t.id) ? '' : 'off'} ${this.techSel === t.id ? 'sel' : ''}" data-act="techsel" data-t="${t.id}">
        <div class="tn">${t.name}${t.infinite ? ` <span class="lvl">ур. ${lv + 1}</span>` : ''}</div><div class="td">${t.desc}</div>
        <div class="tc">${t.packs.map(pk => `<img src="${iconURL(pk)}">`).join('')} × ${cost} · ${t.time} с</div>
        <div class="tu">${t.unlocks.map(u => { const it = recipeItem(u); return `<img src="${iconURL(it)}" data-tip="item:${it}">`; }).join('')}</div>
        ${t.infinite ? (() => { const gn = techGain(t, lv); return `<div class="dim small">Изучено уровней: ${lv} · бонус сейчас ${pct(lv * t.infinite.per)}</div><div class="small ok">Следующий уровень: ×${gn.from.toFixed(2)} → ×${gn.to.toFixed(2)} (+${(gn.rel * 100).toFixed(1)}% к текущему)</div>`; })() : ''}
        ${t.prereq.length && !done ? `<div class="tp">Нужно: ${t.prereq.map(p => `<span class="${g.research.done.has(p) ? 'ok' : ''}">${TECHS[p].name}</span>`).join(', ')}</div>` : ''}
        ${cur ? `<div class="bar sm"><i style="width:${g.research.progress / cost * 100}%"></i></div>` : ''}
        ${done ? '<div class="ok">✔ Изучено</div>' : ''}</div>`;
      }
      h += '</div>';
    }
    const total = TECH_LIST.filter(t => !t.infinite).length, nd = TECH_LIST.filter(t => !t.infinite && g.research.done.has(t.id)).length;
    return { h, nd, total };
  }  /** v1.11: вид окна технологий — граф (по умолчанию) или список по эпохам; сдвиг и масштаб графа; выбранная технология; поиск */
  techView: 'graph' | 'list' = 'graph'; tgPending: string | null = null; tg = { x: 0, y: 0, z: 0.8, init: false }; techSel: string | null = null; techQ = '';
  private techCard(t: TechDef, x: number, y: number, hl: string) {
    const g = this.g; const lv = g.research.levels[t.id] || 0, cost = g.techCost(t.id);
    const done = !t.infinite && g.research.done.has(t.id), avail = g.canResearch(t.id), cur = g.research.current === t.id;
    const q = this.techQ.trim().toLowerCase(); const hit = q && (t.name.toLowerCase().includes(q) || tr(t.name).toLowerCase().includes(q) || t.unlocks.some(u => { const n = ITEMS[recipeItem(u)]?.name || ''; return n.toLowerCase().includes(q) || tr(n).toLowerCase().includes(q); }));
    return `<div class="tech tcard ${done ? 'done' : avail ? 'avail' : 'locked'} ${cur ? 'cur' : ''} ${g.techOk(t.id) ? '' : 'off'} ${hl} ${hit ? 'hit' : ''} ${this.techSel === t.id ? 'sel' : ''}" data-key="${t.id}" style="left:${x}px;top:${y}px;width:${CARD_W}px;height:${CARD_H}px" data-act="techsel" data-t="${t.id}">
      <div class="tn">${t.name}${t.infinite ? ` <span class="lvl">ур. ${lv + 1}</span>` : ''}${done ? ' <span class="ok">✔</span>' : ''}</div>
      <div class="tc">${t.packs.map(pk => `<img src="${iconURL(pk)}">`).join('')} × ${cost} · ${t.time} с</div>
      <div class="tu">${t.unlocks.slice(0, 8).map(u => { const it = recipeItem(u); return `<img src="${iconURL(it)}" data-tip="item:${it}">`; }).join('')}${t.unlocks.length > 8 ? `<span class="dim small">+${t.unlocks.length - 8}</span>` : ''}</div>
      ${cur ? `<div class="bar sm"><i style="width:${g.research.progress / cost * 100}%"></i></div>` : ''}</div>`;
  }
  private techWindow() {
    const g = this.g; const total = TECH_LIST.filter(t => !t.infinite).length, nd = TECH_LIST.filter(t => !t.infinite && g.research.done.has(t.id)).length;
    const bar = `<div class="row2 techbar"><button data-act="techview" data-v="graph" class="${this.techView === 'graph' ? 'on' : ''}">Граф</button><button data-act="techview" data-v="list" class="${this.techView === 'list' ? 'on' : ''}">Список</button>
      <input id="techq" placeholder="🔍 Найти технологию или предмет" value="${esc(this.techQ)}" autocomplete="off"> <button data-act="techcenter">К текущему исследованию</button> <button data-act="techzoom" data-v="1">＋</button><button data-act="techzoom" data-v="-1">－</button></div>`;
    const head = `<div class="title">Технологии <span class="dim small">изучено ${nd}/${total}</span> <span class="x" data-act="close">✕</span></div>`;
    if (this.techView === 'list') { const { h } = this.techListHtml(); return `<div class="panel wide tall">${head}${bar}${this.techQueueHtml(this.techSel)}<div class="scroll">${h}</div><div class="dim small">Нажмите на доступную технологию. Пакеты кладите в лаборатории.</div></div>`; }
    const L = layoutTechs(TECH_LIST);
    if (!this.tg.init) { this.tg.init = true; this.tgPending = (g.research.current || TECH_LIST.find(t => g.canResearch(t.id))?.id || TECH_LIST[0].id); }
    const sel = this.techSel || g.research.current; const chain = sel ? prereqChain(TECH_LIST, sel) : new Set<string>();
    let cards = '', paths = '';
    for (const [a, b] of L.edges) {
      const pa = L.pos.get(a)!, pb = L.pos.get(b)!; const da = g.research.done.has(a), db = !TECHS[b].infinite && g.research.done.has(b);
      const on = sel && (b === sel || chain.has(b)) && (chain.has(a));
      const cls = on ? 'hl' : db ? 'done' : da ? 'avail' : 'locked';
      paths += `<path class="${cls}" d="${edgePath(pa, pb)}" marker-end="url(#ta-${cls})"/>`;
    }
    for (const t of TECH_LIST) { const p = L.pos.get(t.id)!; cards += this.techCard(t, p.x, p.y, chain.has(t.id) ? 'chain' : ''); }
    const st = TECHS[sel || ''];
    const info = st ? `<div class="techinfo"><b>${st.name}</b> — ${st.desc}${st.prereq.length ? `<div class="small">Нужно: ${st.prereq.map(p => `<span class="${g.research.done.has(p) ? 'ok' : 'err'}">${TECHS[p].name}</span>`).join(', ')}</div>` : ''}${(() => { const miss = [...prereqChain(TECH_LIST, st.id)].filter(p => !g.research.done.has(p)); return miss.length && !g.research.done.has(st.id) ? `<div class="small dim">До неё не изучено технологий: ${miss.length}</div>` : ''; })()}${st.infinite ? (() => { const lv = g.research.levels[st.id] || 0; const gn = techGain(st, lv); return `<div class="small ok">Изучено уровней: ${lv} · следующий: ×${gn.from.toFixed(2)} → ×${gn.to.toFixed(2)}</div>`; })() : ''}</div>` : '';
    const mk = ['hl', 'done', 'avail', 'locked'].map(c => `<marker id="ta-${c}" class="${c}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker>`).join('');
    return `<div class="panel wide tall techwin">${head}${bar}${this.techQueueHtml(sel)}
      <div class="techgraph" id="techgraph"><div class="techcanvas" id="techcanvas" style="width:${L.w}px;height:${L.h}px;transform:translate(${this.tg.x.toFixed(1)}px,${this.tg.y.toFixed(1)}px) scale(${this.tg.z.toFixed(3)})">
      <svg class="techedges" width="${L.w}" height="${L.h}"><defs>${mk}</defs>${paths}</svg>${cards}</div></div>
      ${info}<div class="dim small">ЛКМ по доступной (жёлтой) — исследовать, по другой — показать цепочку требований. Перетаскивание — сдвиг, колесо — масштаб.</div></div>`;
  }
  /** сдвинуть граф так, чтобы технология оказалась в центре окна */
  centerTech(id: string) {
    const L = layoutTechs(TECH_LIST); const p = L.pos.get(id); if (!p) return; const el = document.getElementById('techgraph');
    const W = el?.clientWidth || Math.min(1060, innerWidth * 0.9), H = el?.clientHeight || innerHeight * 0.6;
    this.tg.x = W / 2 - (p.x + CARD_W / 2) * this.tg.z; this.tg.y = H / 2 - (p.y + CARD_H / 2) * this.tg.z; this.tg.x = Math.min(this.tg.x, 24); this.tg.y = Math.min(this.tg.y, 24);
  }
  private techApply() { const c = document.getElementById('techcanvas'); if (c) c.style.transform = `translate(${this.tg.x.toFixed(1)}px,${this.tg.y.toFixed(1)}px) scale(${this.tg.z.toFixed(3)})`; }
  techZoom(k: number, cx?: number, cy?: number) {
    const el = document.getElementById('techgraph'); const r = el?.getBoundingClientRect(); const ox = cx != null && r ? cx - r.left : (el?.clientWidth || 800) / 2, oy = cy != null && r ? cy - r.top : (el?.clientHeight || 500) / 2;
    const z0 = this.tg.z, z = Math.max(0.25, Math.min(1.6, z0 * k)); this.tg.x = ox - (ox - this.tg.x) * z / z0; this.tg.y = oy - (oy - this.tg.y) * z / z0; this.tg.z = z; this.techApply();
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
    const party = !!this.g.mpv?.mp || this.g.bpLib.length > 0; if (!party) this.bpTab = 'mine';
    const card = (x: { name: string; bp: Blueprint }, extra: string, btns: string) => `<div class="bp"><div class="bpi">${x.bp.icons.slice(0, 4).map(ic => `<img src="${iconURL(ic)}">`).join('')}</div><div class="bpn"><b>${esc(x.name)}</b><div class="dim small">${x.bp.w}×${x.bp.h} · ${x.bp.entities.length} построек${extra}</div></div>${btns}</div>`;
    const list = this.bpTab === 'party'
      ? (g.bpLib.map(x => card(x, ` · добавил ${esc(x.by)}`, `<button data-act="pbtake" data-id="${x.id}">В руку</button><button data-act="pbmine" data-id="${x.id}">В мою библиотеку</button><button data-act="pbren" data-id="${x.id}">Имя</button><button data-act="pbdel" data-id="${x.id}">Удалить</button>`)).join('')
        || `<div class="dim">Библиотека партии пуста. На вкладке «Мои чертежи» нажмите «В партию» — чертёж увидят все игроки${g.mpPerm.bp === 'admins' ? ' (хост разрешил это только админам)' : ''}.</div>`)
      : lib.map((x, i) => card(x, '', `<button data-act="bptake" data-i="${i}">В руку</button>${party ? `<button data-act="bpparty" data-i="${i}">В партию</button>` : ''}<button data-act="bpcopy" data-i="${i}">Строка</button><button data-act="bpren" data-i="${i}">Имя</button><button data-act="bpdel" data-i="${i}">Удалить</button>`)).join('') || '<div class="dim">Библиотека пуста. Ctrl+C и выделите область, чтобы создать чертёж.</div>';
    const tabs = party ? `<div class="row2 tabs"><button data-act="bptab" data-v="mine" class="${this.bpTab === 'mine' ? 'on' : ''}">Мои чертежи (${lib.length})</button><button data-act="bptab" data-v="party" class="${this.bpTab === 'party' ? 'on' : ''}">Библиотека партии (${g.bpLib.length})</button></div>` : '';
    let need = '';
    if (cur) { const cost = bpCost(cur); need = `<div class="lbl">Нужно для «${esc(cur.name)}» (в руке):</div><div class="grid g10">` + Object.entries(cost).map(([it, n]) => { const have = g.inv.count(it); return `<div class="slot ${have >= n ? '' : 'miss'}" data-tip="item:${it}"><img src="${iconURL(it)}"><span class="cnt">${n}</span></div>`; }).join('') + '</div><div class="dim small">Красные — не хватает в инвентаре: такие постройки станут призраками и будут построены, когда предметы появятся.</div>'; }
    const filt = [['all', 'Всё'], ['belts', 'Только конвейеры'], ['nobelts', 'Всё, кроме конвейеров']].map(([v, l]) => `<button data-act="dfilt" data-v="${v}" class="${this.deconFilter === v ? 'on' : ''}">${l}</button>`).join('');
    const ups = UPGRADES.map(([a, b]) => `<button data-act="upg" data-v="${a}" class="${this.upgradeOn[a] ? 'on' : ''}">${this.upgradeOn[a] ? '☑' : '☐'} <img src="${iconURL(a)}">→<img src="${iconURL(b)}"></button>`).join('');
    return `<div class="panel wide tall"><div class="title">Чертежи и планировщики <span class="x" data-act="close">✕</span></div>
      <div class="row2"><button data-act="tool" data-v="copy">Копировать (Ctrl+C)</button><button data-act="tool" data-v="cut">Вырезать (Ctrl+X)</button><button data-act="tool" data-v="decon">Снос (Alt+D)</button><button data-act="tool" data-v="upgrade">Улучшение (Alt+U)</button><button data-act="tool" data-v="cancel">Отменить стройку</button><button data-act="undo">Отменить (Ctrl+Z)</button><button data-act="redo">Повторить (Ctrl+Y)</button></div>
      ${tabs}<div class="scroll" style="max-height:34vh">${list}</div>
      <div class="lbl">Примеры 1.16 — ядерные станции</div><div class="row2"><button data-act="bp116">Добавить три чертежа станций в «Мои чертежи»</button></div><div class="dim small">«Первый реактор 40 МВт», «Станция 2×2» (480 МВт), «Станция 2×2 с экономией топлива» (цистерны пара и память 25 % / 75 %). Воду подведите к помеченным входам.</div>
      <div class="lbl">Импорт строки чертежа</div><div class="row2"><textarea id="bpstr" rows="2" placeholder="0eNq..."></textarea><button data-act="bpimport">Импорт</button></div>${this.bpMsg ? `<div class="small">${esc(this.bpMsg)}</div>` : ''}
      ${need}
      <div class="lbl">Планировщик сноса</div><div class="row2">${filt}<button data-act="dtrees" class="${this.deconTrees ? 'on' : ''}">${this.deconTrees ? '☑' : '☐'} Деревья и скалы</button></div>
      <div class="lbl">Планировщик улучшений</div><div class="row2 ups">${ups}</div>
      <div class="row2"><button data-act="clearghosts">Удалить все призраки (${g.ghosts.size})</button><span class="dim small">ПКМ-рамка любым планировщиком — снять пометки. Инженер сам строит призраки и сносит помеченное в радиусе ${10} клеток.</span></div></div>`;
  }
  /** v1.11: таблица клавиш по группам; ряды быстрого доступа — свёрнуты */
  rebindNote = ''; keysHot = false;
  private keysTable(st: Settings) {
    const btn = (a: string, slot2: boolean) => { const id = slot2 ? a + '#2' : a; const v = slot2 ? st.keys2[a] || '' : st.keys[a] || ''; const on = this.rebinding === id;
      return `<button data-act="rebind" data-k="${id}" class="kb ${on ? 'on' : ''}">${on ? 'нажмите клавишу…' : esc(keyName(v))}</button>${v && !on ? `<span class="x2" data-act="unbind" data-k="${id}" title="Очистить">✕</span>` : ''}`; };
    let h = '';
    for (const [gid, gname] of KEY_GROUPS) {
      const list = ACTIONS.filter(x => (x[3] || '') === gid); if (!list.length) continue;
      if (gid === 'hot') { h += `<tr class="kgrp"><td colspan="3"><span data-act="keyshot" class="link">${this.keysHot ? '▾' : '▸'} ${gname} (${list.length})</span></td></tr>`; if (!this.keysHot) continue; }
      else h += `<tr class="kgrp"><td colspan="3">${gname}</td></tr>`;
      for (const [a, label] of list) h += `<tr><td>${label}</td><td>${btn(a, false)}</td><td>${btn(a, true)}</td></tr>`;
    }
    return h;
  }
  hotRows() { return Math.max(1, Math.min(4, this.h.getSettings().hotRows || 1)); }
  upgradeMap() { const m: Record<string, string> = {}; for (const [a, b] of UPGRADES) if (this.upgradeOn[a]) m[a] = b; return m; }
  private settingsWindow() {
    const st = this.h.getSettings();
    const sl = (k: keyof Settings, label: string) => `<div class="kv set">${label}<input type="range" min="0" max="100" value="${Math.round((st[k] as number) * 100)}" data-set="${k}"><span>${Math.round((st[k] as number) * 100)}%</span></div>`;
    const ck = (k: keyof Settings, label: string) => `<button data-act="setb" data-k="${k}" class="${st[k] ? 'on' : ''}">${st[k] ? '☑' : '☐'} ${label}</button>`;
    const keys = this.keysTable(st);
    return `<div class="panel"><div class="title">Настройки <span class="x" data-act="close">✕</span></div>
      <div class="lbl">Звук</div>${sl('master', 'Общая громкость')}${sl('sfx', 'Эффекты')}${sl('speakerVolume', 'Громкоговорители')}${sl('music', 'Музыка')}${sl('ambient', 'Шум завода')}
      <div class="lbl">Графика</div>
      <div class="row2">Качество: ${(['high', 'medium', 'low', 'min'] as const).map(v => `<button data-act="gfx" data-v="${v}" class="${st.gfx === v ? 'on' : ''}">${PRESET_NAMES[v]}</button>`).join(' ')}${st.gfx === 'custom' ? ' <span class="dim small">свои настройки</span>' : ''}${st.gfxAuto && st.gfx !== 'custom' ? ' <span class="dim small">подобрано автоматически</span>' : ''}</div>
      <div class="dim small">«Низкое» и «Минимум» — для слабых ПК и ноутбуков без видеокарты: меньше разрешение и текстуры, без дыма, ограничение кадров.</div>
      <div class="row2">Разрешение: ${[[0.5, '50%'], [0.75, '75%'], [1, '100%']].map(([v, l]) => `<button data-act="res" data-v="${v}" class="${st.resScale === v ? 'on' : ''}">${l}</button>`).join(' ')} · Чёткость (Retina/4K): ${[[1, '1×'], [1.5, '1,5×'], [2, '2×'], [3, 'макс.']].map(([v, l]) => `<button data-act="dpr" data-v="${v}" class="${st.dprMax === v ? 'on' : ''}">${l}</button>`).join(' ')}</div>
      <div class="row2">Кадров в секунду: ${[[0, 'без ограничения'], [60, '60'], [30, '30']].map(([v, l]) => `<button data-act="fps" data-v="${v}" class="${st.fpsCap === v ? 'on' : ''}">${l}</button>`).join(' ')} ${ck('detail', 'Подробная земля вблизи')}${ck('lod', 'Карта издалека (LOD)')}</div>
      <div class="row2">Текстуры: ${[[2048, '2K'], [1024, '1K'], [512, '512']].map(([v, l]) => `<button data-act="tex" data-v="${v}" ${texQuality() === v ? 'class="on"' : ''}>${l}</button>`).join(' ')}</div>
      <div class="row2">Рендер: ${[['auto', 'Авто'], ['webgl', 'WebGL2'], ['canvas', 'Canvas2D']].map(([v, l]) => `<button data-act="render" data-v="${v}" class="${(st.renderer || 'auto') === v ? 'on' : ''}">${l}</button>`).join(' ')}<span class="dim small">сейчас: ${this.h.rendererMode() === 'webgl' ? 'WebGL2' : 'Canvas2D'}${this.h.rendererNote() === 'soft' ? ' (WebGL без видеокарты — программный, Canvas2D быстрее)' : this.h.rendererNote() === 'nogl' ? ' (WebGL2 недоступен)' : this.h.rendererNote() === 'lost' ? ' (контекст WebGL потерян; Canvas2D работает до восстановления)' : this.h.rendererNote() === 'restore-failed' ? ' (WebGL восстановить не удалось; используется Canvas2D)' : ''}</span></div>
      <div class="row2">${ck('smoke', 'Дым')}${ck('dayNight', 'Ночное затемнение')}${ck('shake', 'Тряска экрана')}${ck('ruleSound', 'Звук правил оповещения')}${ck('colorblind', 'Режим для дальтоников')}</div>
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
    <div class="panel keyspanel"><div class="title">Клавиши</div>
      <div class="row2">Раскладка: ${Object.entries(KEY_PRESETS).map(([id, [n]]) => `<button data-act="keypreset" data-v="${id}">${n}</button>`).join(' ')}</div>
      <div class="row2">Быстрая погрузка: ${[['shift', 'Shift+ЛКМ / Shift+ПКМ'], ['ctrl', 'Ctrl+ЛКМ / Ctrl+ПКМ']].map(([v, l]) => `<button data-act="quickkey" data-v="${v}" class="${st.quickKey === v ? 'on' : ''}">${l}</button>`).join(' ')}</div>
      <div class="row2">Рядов быстрого доступа: ${[1, 2, 3, 4].map(v => `<button data-act="hotrows" data-v="${v}" class="${st.hotRows === v ? 'on' : ''}">${v}</button>`).join(' ')} ${ck('leaveGuard', 'Спрашивать перед закрытием вкладки')}</div>
      <div class="scroll keyscroll"><table class="keys">${keys}</table></div>${this.rebindNote ? `<div class="small ok">${esc(this.rebindNote)}</div>` : ''}
      <div class="row2"><button data-act="keysreset">Сбросить клавиши</button></div><div class="dim small">Щёлкните по назначению и нажмите клавишу, сочетание (Ctrl/Alt/Shift/Cmd + клавиша) или кнопку мыши (средняя, «назад», «вперёд»). Esc — отмена, ✕ — очистить. У каждого действия два назначения. Модификатор отдельно (например, правый Shift) — нажать и отпустить.</div></div>`;
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
      <div class="lbl">2. Замер производительности</div><div class="dim small">Около минуты: в новой вкладке откроется мир выбранного уровня, игра измерит кадры, время кадра и скорость симуляции на вашем компьютере. Текущая партия не меняется.</div>
      <div class="perflv">${PERF_LEVELS.map(l => `<button data-act="benchopen" data-v="${l.id}" title="${esc(l.desc)}"><b>${l.id}. ${esc(l.name)}</b><br><span class="small dim">${esc(l.desc)}</span></button>`).join('')}</div>
      <div class="lbl">3. Ошибки</div><div class="dim small">${n ? `<span class="err">Ошибок за сессию: ${n}.</span> ` : ''}Если что-то сломалось — отчёт (F8) с журналом и сохранением.</div>
      <div class="row2"><button data-act="bug">Отчёт об ошибке (F8)</button></div>
      <div class="lbl">Как отправить</div><div class="small">${to ? `Приложите файлы к письму или форме: ${to}.` : 'Приложите файлы к письму или сообщению разработчикам.'} Каждый файл — отдельная партия; несколько файлов одной партии тоже подходят, учтём последний.</div>
      <div class="row2"><button data-act="news">Что нового</button>${this.g.x.ng === -1 ? '<button data-act="ngshow">Вернуть атомный курс ОСКАРа</button>' : ''}</div></div>`;
  }
  private newsWindow() {
    const ic: Record<string, string> = { new: '＋', balance: '⚖', fix: '✔' };
    const kinds: Record<string, string> = { new: 'Новое', balance: 'Баланс', fix: 'Исправлено' };
    const body = NEWS.map(v => `<div class="lbl">Версия ${esc(v.ver)} — ${esc(tr(v.title))}</div>` + (['new', 'balance', 'fix'] as const).map(k => {
      const it = v.items.filter(i => i.kind === k); return it.length ? `<div class="small"><b>${kinds[k]}</b></div><ul class="small news">${it.map(i => `<li>${ic[k]} ${esc(tr(i.text))}</li>`).join('')}</ul>` : '';
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
        ${f.level ? `<div class="small">Уровень ${f.level}: <b>${esc(PERF_LEVELS[f.level - 1]?.name || '')}</b>${f.levelInfo ? ` · исследований ${f.levelInfo.techs} · типов построек ${f.levelInfo.types}/${f.levelInfo.typesTotal} · поездов ${f.levelInfo.trains} · роботов ${f.levelInfo.robots}${f.levelInfo.silos ? ` · ракетных шахт ${f.levelInfo.silos}` : ''}` : ''}</div>` : ''}
        ${f.metrics?.partsPerMin ? `<div class="small">Ракеты: <b>${f.metrics.rocketsPerMin}</b> в минуту (деталей ракет ${f.metrics.partsPerMin}/мин за ${f.metrics.minutes} мин замера)</div>` : ''}
        <div class="small">${f.ok60 ? `<span class="ok">✔ 60 FPS${f.level ? ' на уровне ' + f.level : ' на эталонной базе'}</span>` : '<span class="err">✘ ниже 60 FPS</span> — попробуйте графику ниже (Esc → Настройки → Графика)'}</div>
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
  /** v1.16: настройки воды и ресурсов нового мира; стартовые ресурсы и озеро остаются гарантированными */
  private genForm(): string { return genFormHtml('gen', this.menuGen); }
  private captureMenuDraft() {
    const seed = document.getElementById('seed') as HTMLInputElement | null;
    const mode = document.getElementById('mode') as HTMLSelectElement | null;
    if (seed) this.menuSeed = seed.value;
    if (mode) this.menuMode = mode.value as EnemyMode;
    if (document.getElementById('gen-w')) this.menuGen = readGen('gen');
  }
  private menuFrame(content: string, activePage: MenuPage, title: string, child = false) {
    const scale = Math.max(0.75, Math.min(2, this.h.getSettings().uiScale || 1));
    const layoutScale = Math.max(1, scale);
    const width = `min(${(1160 / layoutScale).toFixed(2)}px,${(96 / layoutScale).toFixed(2)}vw)`;
    const height = `min(${(820 / layoutScale).toFixed(2)}px,${(90 / layoutScale).toFixed(2)}vh)`;
    const page = (id: MenuPage, label: string, icon: string) => `<button class="menu-nav-item ${!child && activePage === id ? 'on' : ''}" data-act="menu-page" data-page="${id}"><span class="mi">${icon}</span><span>${label}</span>${!child && activePage === id ? '<i></i>' : ''}</button>`;
    const route = (id: string, label: string, icon: string) => `<button class="menu-nav-item ${child && this.open === id ? 'on' : ''}" data-act="menu-child" data-win="${id}"><span class="mi">${icon}</span><span>${label}</span>${child && this.open === id ? '<i></i>' : ''}</button>`;
    const editor = `<button class="menu-nav-item ${child && this.open === 'chal' ? 'on' : ''}" data-act="menu-editor" data-win="editor"><span class="mi">▧</span><span>Редактор карт</span></button>`;
    return `<div class="menu-shell" style="width:${width};height:${height}">
      <aside class="menu-sidebar"><div class="menu-logo"><span class="menu-mark">Z7</span><span><b>ЗАВОД-7</b><small>INDUSTRIAL SYSTEMS</small></span></div>
        <nav class="menu-nav" aria-label="Разделы меню">${page('home', 'Главная', '⌂')}${page('new', 'Новая игра', '＋')}${page('load', 'Загрузить', '▤')}
          <div class="menu-nav-label">ИГРА</div>${route('chal', 'Испытания', '◇')}${route('ach', 'Достижения', '✧')}${editor}${route('mp', 'Мультиплеер', '⌘')}
          <div class="menu-nav-label">СИСТЕМА</div>${route('mods', 'Моды', '⬡')}${route('settings', 'Настройки', '⚙')}${route('help', 'Помощь', '?')}${route('news', 'Что нового', '✦')}
        </nav><div class="menu-sidebar-foot"><span class="menu-live-dot"></span> ${title === 'ЗАВОД-7' ? 'СИСТЕМА ГОТОВА' : 'МЕНЮ ПАУЗЫ'}<small>v${esc(GAME_VERSION)} · ${this.h.rendererMode() === 'webgl' ? 'WebGL2' : 'Canvas2D'}</small></div>
      </aside><section class="menu-stage"><header class="menu-stage-head"><div><span class="menu-overline">${child ? 'РАЗДЕЛ' : 'ЗАВОД-7 / ПАНЕЛЬ УПРАВЛЕНИЯ'}</span><h1>${title}</h1></div>${child ? '<button class="menu-back" data-act="menu-back">← <span>Назад</span></button>' : '<button class="menu-close" data-act="menu-continue" aria-label="Продолжить">×</button>'}</header>
        <main class="menu-stage-body">${content}</main>
      </section></div>`;
  }
  openMenuChild(w: Win) {
    if (w === 'menu' || w == null) return;
    this.captureMenuDraft(); this.menuReturnTo = this.menuPage; this.open = w; this.tipKey = null; this.last = '';
    this.onOpen?.(w); this.render(true); if (w === 'beta') this.refreshTele();
  }
  private menuWindow() {
    const saves = this.h.listSaves();
    const card = (x: SaveMeta | undefined, slot: string, label: string, auto: boolean) => {
      const img = x ? (x.prev ? `<img class="thumb" src="${x.prev}" alt="">` : `<div class="thumb none">${x.ents != null ? 'превью появится после сохранения' : '…'}</div>`) : `<div class="thumb none">пусто</div>`;
      const info = x ? `<div class="save-world">Мир ${x.seed != null ? '№ ' + x.seed : ''}</div><div class="dim small">${new Date(x.time).toLocaleString(LANG === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}${x.era ? ' · ' + esc(x.era) : ''}</div>
        <div class="small">⏱ ${playTime(x.tick)}${x.ents != null ? ` · построек ${x.ents} · цель ${Math.min((x.goal || 0) + 1, GOALS.length)}/${GOALS.length}` : ''}${x.research ? ' · изучено ' + x.research : ''}${x.robots ? ' · 🤖 ' + x.robots : ''}${x.floors ? ' · покрытий ' + x.floors : ''}${x.rockets ? ' · 🚀 ' + x.rockets : ''}${x.mods ? ' · 🧩 модов ' + x.mods : ''}</div>
        <div class="dim small">Версия ${esc(x.ver || '—')} · формат ${x.fmt ?? '—'}${x.mode ? ' · Рой: ' + (MODE_NAMES[x.mode] || esc(x.mode)) : ''}${x.kb ? ` · ${x.kb} КБ` : ''}${x.scn ? ' · сценарий «' + esc(x.scn) + '»' : ''}${x.test ? ' · тестовая партия' : ''}</div>${x.fmt && x.fmt > SAVE_FMT ? '<div class="err small">⚠ Сохранено более новой версией (формат ' + x.fmt + ') — загрузка может не удаться</div>' : ''}` : '<div class="dim small">свободный слот</div>';
      const btn = (auto ? '' : `<button data-act="save" data-s="${slot}">Сохранить</button>`) + (x ? `<button data-act="load" data-s="${slot}">Загрузить</button>` : '') + (x && !auto ? `<button data-act="delsave" data-s="${slot}">Удалить</button>` : '');
      return `<div class="savecard ${x ? '' : 'empty'}" data-slot="${slot}">${x ? `<div data-act="load" data-s="${slot}">${img}</div>` : img}<div class="si"><b>${label}</b>${info}<div class="row2">${btn}</div></div></div>`;
    };
    const sl = ['1', '2', '3', '4', '5'].map(s => card(saves.find(v => v.slot === s), s, 'Слот ' + s, false)).join('');
    const autos = saves.filter(v => v.slot.startsWith('auto')).sort((a, b) => b.time - a.time);
    const others = saves.filter(v => !['1', '2', '3', '4', '5'].includes(v.slot) && !v.slot.startsWith('auto')).sort((a, b) => b.time - a.time);
    const auto = autos.map(x => card(x, x.slot, 'Автосохранение', true)).join('') + others.map(x => card(x, x.slot, 'Сохранение «' + esc(x.slot) + '»', false)).join('');
    let content = '';
    if (this.menuPage === 'home') {
      const newest = saves.slice().sort((a, b) => b.time - a.time)[0];
      content = `<section class="menu-welcome"><div class="menu-orb">Z<span>7</span></div><div><div class="menu-eyebrow">ПРОИЗВОДСТВО НАЧИНАЕТСЯ ЗДЕСЬ</div><h2>Снова к делу, инженер.</h2><p>Развивайте завод, исследуйте технологии и выведите маяк на орбиту.</p></div></section>
        <div class="menu-primary-actions"><button class="menu-continue" data-act="menu-continue"><span>▶</span><b>Продолжить</b><small>Вернуться к заводу</small></button><button class="menu-action" data-act="menu-page" data-page="new"><span>＋</span><b>Новая игра</b><small>Настроить мир и начать</small></button><button class="menu-action" data-act="menu-page" data-page="load"><span>▤</span><b>Загрузить</b><small>Пять слотов и автосохранения</small></button></div>
        <div class="menu-home-lower"><section><div class="menu-section-title">БЫСТРЫЙ ДОСТУП</div><div class="menu-shortcuts"><button data-act="menu-child" data-win="chal">◇ Испытания</button><button data-act="menu-editor" data-win="editor">▧ Редактор карт</button><button data-act="menu-child" data-win="mp">⌘ Мультиплеер</button><button data-act="menu-child" data-win="settings">⚙ Настройки</button><button data-act="menu-child" data-win="help">? Помощь</button><button data-act="menu-child" data-win="news">✦ Что нового</button></div></section>
          <section class="menu-last-save"><div class="menu-section-title">${newest ? 'ПОСЛЕДНЕЕ СОХРАНЕНИЕ' : 'СТАТУС СИСТЕМЫ'}</div>${newest ? `<b>Мир № ${newest.seed ?? '—'}</b><span>${playTime(newest.tick)} · ${new Date(newest.time).toLocaleString(LANG === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })}</span><button data-act="menu-page" data-page="load">Открыть сохранения →</button>` : `<b>Завод готов к запуску</b><span>Новая партия начнётся с базовых ресурсов и озера рядом.</span><button data-act="menu-page" data-page="new">Настроить мир →</button>`}</section></div>
        <div class="menu-footer"><span>Хранилище: ${esc(this.h.storageInfo() || '…')}</span><span>${this.h.rendererMode() === 'webgl' ? 'WebGL2' : 'Canvas2D'} · ЗАВОД-7 1.16</span></div>`;
    } else if (this.menuPage === 'new') {
      content = `<div class="menu-page-intro"><span class="menu-step">МИР / 01</span><h2>Новая игра</h2><p>Выберите условия старта. Их можно изменить, не теряя введённые настройки при переходе по меню.</p></div>
        <div class="menu-form-grid"><label class="menu-field"><span>Seed мира</span><input id="seed" type="number" inputmode="numeric" value="${esc(this.menuSeed)}"><small>Одинаковый seed создаёт тот же мир.</small></label>
        <label class="menu-field"><span>Сложность Роя</span><select id="mode"><option value="none" ${this.menuMode === 'none' ? 'selected' : ''}>Нет врагов</option><option value="peaceful" ${this.menuMode === 'peaceful' ? 'selected' : ''}>Мирный</option><option value="normal" ${this.menuMode === 'normal' ? 'selected' : ''}>Обычный</option><option value="deathworld" ${this.menuMode === 'deathworld' ? 'selected' : ''}>Мир смерти</option></select><small>Рой реагирует на атаки и загрязнение в зависимости от режима.</small></label></div>
        <details class="genbox menu-gen"><summary>Вода и ресурсы мира</summary>${this.genForm()}</details>
        <div class="menu-page-actions"><button class="menu-continue" data-act="new"><span>▶</span><b>Начать игру</b></button><button class="menu-secondary" data-act="menu-page" data-page="home">Отмена</button></div>`;
    } else {
      content = `<div class="menu-page-intro"><span class="menu-step">СОХРАНЕНИЯ / 01</span><h2>Загрузить игру</h2><p>Пять ручных слотов и отдельные автосохранения. Старые сохранения сохраняют свои прежние идентификаторы.</p></div>
        <div id="menu-saves" class="menu-saves"><div class="menu-save-column"><div class="menu-section-title">РУЧНЫЕ СЛОТЫ</div><div class="saves">${sl}</div><div class="row2"><button data-act="export">Экспорт в файл (.z7save)</button><button data-act="import">Импорт из файла</button></div></div>
        <div class="menu-save-column menu-autos"><div class="menu-section-title">АВТОСОХРАНЕНИЯ</div><div class="saves">${auto || '<div class="menu-empty">Автосохранений пока нет.</div>'}</div></div></div>`;
    }
    return this.menuFrame(content, this.menuPage, this.menuPage === 'home' ? 'ЗАВОД-7' : this.menuPage === 'new' ? 'Новая игра' : 'Загрузить игру');
  }
  private helpWindow() {
    const st = this.h.getSettings(); const kn = (a: string) => keyName(st.keys[a]); const qk = st.quickKey === 'ctrl' ? (this.h.isMac() ? 'Cmd' : 'Ctrl') : 'Shift', cm = st.quickKey === 'ctrl' ? 'Shift' : 'Ctrl';
    const rows = [[`${kn('up')} ${kn('left')} ${kn('down')} ${kn('right')}`, 'Ходьба'], ['ЛКМ', 'Поставить / открыть постройку (можно протягивать)'], ['ПКМ (зажать)', 'Добыть руду, дерево, скалу / разобрать постройку'], [`${kn('rotate')} / Shift+${kn('rotate')}`, 'Повернуть'], [kn('pipette'), 'Пипетка / очистить руку'], [kn('bug'), 'Отчёт об ошибке'], [kn('help'), 'Это окно'], [kn('console'), 'Консоль модов'], ['1–0', 'Панель быстрого доступа'], [kn('inv'), 'Инвентарь и крафт'], [kn('tech'), 'Технологии'], [kn('stats'), 'Статистика'], [kn('map'), 'Карта'], [kn('pickup'), 'Подобрать предметы с земли / вещи погибшего'], [kn('shoot'), 'Стрелять в сторону курсора (нужны пистолет и магазины)'], ['Ремонтный набор + ЛКМ', 'Чинить постройку'], [kn('pollution'), 'Слой загрязнения'], ['Alt', 'Режим деталей (рецепты, модули)'], [`${kn('copy')} / ${kn('cut')}`, 'Копировать / вырезать область в чертёж (протянуть ЛКМ)'], [kn('paste'), 'Взять последний чертёж'], [`Чертёж: ${kn('rotate')}, ${kn('flip')} / ${kn('flipv')}`, 'Повернуть, отразить по горизонтали / вертикали'], [kn('decon'), 'Планировщик сноса (ПКМ-рамка — отмена)'], [kn('upgrade'), 'Планировщик улучшений'], [`${kn('undo')} / ${kn('redo')}`, 'Отменить / повторить'], [kn('bp'), 'Библиотека чертежей'], [`${cm}+ПКМ / ${cm}+ЛКМ`, 'Копировать / вставить рецепт сборщика и настройки комбинатора'], ['Наведение на провод', 'Сигналы сети; ЛКМ — окно «Сеть сигналов»'], [`${qk}+ЛКМ / ${qk}+ПКМ`, 'Быстро загрузить в постройку всё нужное / забрать готовое (можно протягивать)'], ['ПКМ / Shift+ПКМ по ячейке', 'Взять в руку половину стопки / один предмет'], ['Стопка в руке: ЛКМ / ПКМ', 'Положить всё / по одному'], ['Shift+ЛКМ по призраку', 'Роботы построят его первым'], [kn('logi'), 'Окно логистической сети: содержимое, роботы, ждущие запросы'], ['Рельсы в руке: ЛКМ / протянуть ЛКМ', 'Один кусок / путь до курсора (Shift — только призраки)'], [kn('vehicle'), 'Сесть в локомотив / выйти (в кабине W / S — газ / тормоз, A / D — стрелка)'], [kn('trains'), 'Окно «Поезда»'], ['Alt', 'Зоны робопортов (вместе с режимом деталей)'], ['Колесо', 'Масштаб'], [kn('debug'), 'Отладка (+ / − скорость времени)'], [kn('pause'), 'Пауза'], ['Esc', 'Меню / закрыть окно']];
    return `<div class="panel"><div class="title">Управление <span class="x" data-act="close">✕</span></div><table class="keys">${rows.map(r => `<tr><td><kbd>${r[0]}</kbd></td><td>${r[1]}</td></tr>`).join('')}</table>
    <div class="lbl">С чего начать</div><div class="small">Добудьте камень и руду рукой (ПКМ), сделайте печь (E), положите в неё руду и древесину/уголь. Поставьте бур на руду, а перед ним — печь. Дальше следуйте целям ОСКАРа слева сверху.</div>${reference117Html(this.g)}</div>`;
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
    if (e.t === 'loco') {
      const inv = locoFuelInventory(e)!; const open = locoFuelOpen(e);
      const fuelCells = inv.slots.slice(0, LOCO_FUEL_SLOTS).map((s, i) => {
        const act = s ? `data-act="take" data-slot="fuel:${i}"` : `data-act="eslot" data-slot="fuel:${i}"`;
        const cell = slotHTML(s?.item || null, s?.count ?? null, act, i >= open ? '<span class="dim" style="position:absolute;right:2px;top:0;font-size:10px">🔒</span>' : '');
        return `<div title="Ячейка ${i + 1}${i >= open ? ' — закрыта для загрузки, содержимое можно забрать' : ''}">${cell}</div>`;
      }).join('');
      b += `<div class="lbl">Топливо · пять стопок, ${LOCO_FUEL_SLOTS === open ? 'все ячейки открыты' : `открыто ${open} из ${LOCO_FUEL_SLOTS}`}</div><div class="row">${fuelCells}</div><div class="row2"><label>Открыть ячеек: <select data-act="slotLimit" data-id="${e.id}">${[5, 1, 2, 3, 4].map(n => `<option value="${n}" ${n === open ? 'selected' : ''}>${n === 5 ? 'Все' : n}</option>`).join('')}</select></label><button data-act="quickload">Загрузить топливо</button><button data-act="quickunload">Забрать топливо</button></div><div class="bar sm fuel"><i style="width:${Math.min(100, (e.fuelJ || 0) / 4e6 * 100)}%"></i></div><div class="dim small">Топливо тратится при разгоне и на ходу. Закрытые ячейки сохраняются и доступны для извлечения. ${this.kname('vehicle')} рядом — сесть / выйти; в кабине ${this.kname('up')} / ${this.kname('down')} — газ / тормоз, ${this.kname('left')} / ${this.kname('right')} — стрелка на развилке.</div>`;
    }
    else if (e.proto === 'fluid-wagon') { const pc = Math.round((e.tn || 0) / FWAGON_CAP * 100); b += `<div>${e.tf ? fluidName(e.tf) : 'Пусто'}: ${Math.floor(e.tn || 0)} / ${FWAGON_CAP}</div><div class="bar sm ${e.tf || ''}"><i style="width:${pc}%"></i></div><div class="dim small">Наливается и сливается насосом для цистерн у станции, пока поезд стоит. Условия «полон» / «пуст» и «груз» учитывают жидкость.</div>`; }
    else b += this.chestGrid(e) + `<div class="row2"><button data-act="takeall">Забрать всё</button><button data-act="wfall" data-v="set">Фильтры по содержимому</button><button data-act="wfall" data-v="clear">Сбросить фильтры</button></div><div class="dim small">Alt+ЛКМ по ячейке — фильтр: предмет из ячейки или снять. В ячейку с фильтром кладётся только этот предмет.</div>`;
    // расписание
    const worldStations = new Map<string, number>(); for (const st of g.ents.values()) if (st.t === 'stop') { const name = st.sname || 'Станция'; worldStations.set(name, (worldStations.get(name) || 0) + 1); }
    const names = [...worldStations.keys()].sort(); const routeCache = new Map<string, boolean>();
    const route = (name: string) => { if (!routeCache.has(name)) routeCache.set(name, trainRouteAvailable(g, t, name)); return routeCache.get(name)!; };
    const SC = this.schedOf(t); b += `<div class="lbl">Расписание${SC.length ? '' : ': пусто'}</div><div class="sched">`;
    const CN: Record<string, string> = { full: 'Вагоны полны', empty: 'Вагоны пусты', time: 'Время', idle: 'Бездействие', item: 'Груз', circuit: 'Сигнал сети' };
    SC.forEach((r, i) => {
      const cur = i === t.si && !t.manual;
      const reachable = route(r.st || '');
      b += `<div class="srow ${cur ? 'cur' : ''} ${this.sdrag === i ? 'drag' : ''}" data-srow="${i}"><span class="dim grip" data-act="sdrag" data-i="${i}" title="Перетащите, чтобы изменить порядок">⠿ ${i + 1}.</span><button data-act="sst" data-i="${i}" title="Выбрать любую мировую станцию">🚉 ${esc(r.st || '—')}</button><span class="${reachable ? 'ok' : 'err'} small" title="Проверка физического маршрута; выключенная станция или исчерпанный лимит могут оставить поезд в ожидании">${reachable ? '✓ путь есть' : '✕ пути нет'}</span>`
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
    b += `</div><div class="row2"><button data-act="sadd">+ Станция</button><span class="dim small">Станций в мире: ${names.length ? [...worldStations.values()].reduce((a, n) => a + n, 0) : 0}; список включает недостижимые</span></div>`;
    if (this.sPick) { const q = this.sPickQ.trim().toLowerCase(); const list = names.filter(n => (n + ' ' + tr(n)).toLowerCase().includes(q)); b += `<div class="station-picker"><input id="spq" placeholder="Поиск по имени станции" value="${esc(this.sPickQ)}" autocomplete="off"><div class="scroll" style="max-height:180px">${list.map(n => `<button class="mini" data-act="schoose" data-name="${esc(n)}">🚉 ${esc(n)} <span class="dim">×${worldStations.get(n)}</span></button>`).join('') || '<div class="dim small">Станций с таким именем нет</div>'}</div></div>`; }
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
    const left = e.stopLeft === true;
    const coming = g.trains.filter(t => !t.manual && t.tgt === e.id);
    let b = `<div class="row2"><input id="stname" value="${esc(e.sname || '')}" maxlength="40" autocomplete="off"> <button data-act="stname">Переименовать</button></div>`;
    b += linked ? '<div class="ok">Стык пути найден ' + (left ? 'слева' : 'справа') + ': поезд остановится головой у станции</div>' : '<div class="err">Нет стыка пути ' + (left ? 'слева' : 'справа') + ' по направлению движения</div>';
    b += '<div class="row2"><span>Станция ' + (left ? 'слева' : 'справа') + ' от направления поезда</span><button data-act="stopSide" data-left="' + (left ? '0' : '1') + '">Перенести на другую сторону</button></div>';
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
    const inv = e.inv!; const slots = inv.slots; const big = slots.length > 48; const q = this.chestQ.trim().toLowerCase();
    const usedOpen = slots.slice(0, inv.slotLimit).filter(Boolean).length, usedClosed = slots.slice(inv.slotLimit).filter(Boolean).length;
    const fl = e.filt; const cell = (st: typeof slots[number], i: number) => {
      if (e.t === 'chest' && i >= inv.slotLimit) {
        const content = st ? `<img src="${iconURL(st.item)}"><span class="cnt">${fmt(st.count)}</span>` : fl?.[i] ? `<img src="${iconURL(fl[i]!)}" style="opacity:.35">` : '';
        const title = tr(st ? 'Ячейка закрыта для загрузки. Содержимое можно забрать.' : 'Ячейка закрыта для загрузки. Увеличьте лимит доступных ячеек.');
        return `<div class="slot${st ? '' : ' empty'} locked"${st ? ` data-act="take" data-slot="chest:${i}"` : ''}${fl ? ` data-wf="${i}"` : ''} title="${esc(title)}" style="opacity:.58;border:1px dashed #c99">${content}<span aria-hidden="true" style="position:absolute;right:2px;top:0;font-size:10px;text-shadow:0 0 3px #111">🔒</span></div>`;
      }
      return (!st && fl && fl[i]) ? `<div class="slot filt" data-act="eslot" data-slot="chest:${i}" data-wf="${i}" title="Фильтр: ${ITEMS[fl[i]!].name}"><img src="${iconURL(fl[i]!)}" style="opacity:.35"></div>` : slotHTML(st?.item || null, st?.count ?? null, (st ? `data-act="take" data-slot="chest:${i}"` : `data-act="eslot" data-slot="chest:${i}"`) + (fl ? ` data-wf="${i}"` : ''));
    };
    const control = e.t === 'chest' ? `<div class="row2 chest-slot-limit"><span>${tr('Доступные ячейки')}: ${inv.slotLimit} / ${slots.length}</span><button data-act="slotLimitAll" data-id="${e.id}" ${e.slotLimit === undefined ? 'disabled' : ''}>${tr('Все')}</button>${[1, 2, 3, 4].filter(n => n <= slots.length).map(n => `<button data-act="slotLimitPreset" data-id="${e.id}" data-v="${n}" ${e.slotLimit === n ? 'disabled' : ''}>${n}</button>`).join('')}<label>${tr('Другое')}: <input class="chest-slot-limit" type="number" min="1" max="${slots.length}" step="1" value="${inv.slotLimit}" data-act="slotLimit" data-id="${e.id}" style="width:5em"></label><span class="dim small">${tr('Открыто ячеек с предметами')}: ${usedOpen} · ${tr('Вне лимита занято')}: ${usedClosed}</span></div>` : '';
    if (!big) return control + '<div class="grid g8">' + slots.map(cell).join('') + '</div>';
    const used = slots.filter(x => x).length;
    const hit = (it: string) => (ITEMS[it].name + ' ' + tr(ITEMS[it].name) + ' ' + it).toLowerCase().includes(q);
    const cells = slots.map((st, i) => !q || (st && hit(st.item)) ? cell(st, i) : '').join('');
    return control + `<div class="row2"><input id="csearch" placeholder="Поиск" value="${esc(this.chestQ)}" autocomplete="off"> <button data-act="csort">Сортировать</button> <span class="dim small">Занято ячеек: ${used} из ${slots.length}</span></div>`
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
    { const cmk = this.h.getSettings().quickKey === 'ctrl' ? 'Shift' : 'Ctrl'; h += `<div class="dim small">Задержка — 1 тик. ${cmk}+ПКМ — скопировать настройки, ${cmk}+ЛКМ — вставить в такой же комбинатор.</div>`; }
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
    if (a === 'menu-page') { this.captureMenuDraft(); this.menuPage = (['home', 'new', 'load'].includes(el.dataset.page || '') ? el.dataset.page : 'home') as MenuPage; this.menuReturnTo = null; this.open = 'menu'; this.last = ''; this.render(true); return; }
    if (a === 'menu-child') { this.openMenuChild(el.dataset.win as Win); return; }
    if (a === 'menu-back') { this.close(); return; }
    if (a === 'menu-continue') { this.menuReturnTo = null; this.close(); return; }
    if (a === 'menu-editor') { this.captureMenuDraft(); this.menuReturnTo = this.menuPage; if (this.scn) this.scn.act('sc-new', el); else this.toggle('chal'); return; }
    if (this.ext && (a === 'load' || a === 'new' || a === 'import') && this.ext.inGame()) { g.msg('В совместной игре новая игра и загрузка недоступны — сначала выйдите (Tab → «Выйти»)'); return; }
    if (this.ext && (a.startsWith('mp') || a.startsWith('native-')) && this.ext.act(a, el)) return;
    if (a.startsWith('x-') && this.x?.act(a, el)) return;
    if (a.startsWith('sc-') && this.scn?.act(a, el)) return;
    if (a.startsWith('mm-') && this.mods?.act(a, el)) return;
    if (a === 'mcfilter' && this.modrt) { this.modrt.filter = el.dataset.v || ''; this.render(true); return; }
    if (a === 'mcclear' && this.modrt) { this.modrt.lines = []; this.render(true); return; }
    if (a === 'mconsole') { this.toggle('console'); return; }
    if ((a.startsWith('ps-') || a.startsWith('calc-')) && this.prod.act(a, el)) return;
    if (this.gear.act(a, el, rmb)) return;
    // v1.11: закрепить предмет в быстром доступе — средняя кнопка или Ctrl+ЛКМ по ячейке инвентаря / рецепту крафта
    const pinClick = ev.button === 1 || (ev.button === 0 && (ev.ctrlKey || ev.metaKey) && this.h.getSettings().quickKey !== 'ctrl');
    if (pinClick && (a === 'inv' && el.dataset.mode === 'cursor' || a === 'craft' || a === 'pin')) { const it = a === 'craft' ? recipeItem(el.dataset.r!) : a === 'pin' ? el.dataset.item! : g.inv.slots[+el.dataset.i!]?.item; if (it) { this.togglePin(it); this.render(true); } return; }
    if (ev.button === 1) return;
    if (ev.altKey && el.dataset.wf != null) { const e = g.ents.get(this.entId); const i = +el.dataset.wf; if (e?.filt) { const it = e.inv?.slots[i]?.item ?? null; g.enqueue({ t: 'wfilter', id: e.id, i, item: e.filt[i] ? null : it }); } return; }
    if (this.bioRoute.action(a)) { this.render(true); this.onMapDraw?.(); return; }
    switch (a) {
      case 'speaker-save': {
        const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
        const radius = Number(value('speaker-radius')), volume = Number(value('speaker-volume')), intervalTicks = Number(value('speaker-interval')) * 60, pauseTicks = Number(value('speaker-pause')) * 60;
        const mode = value('speaker-mode'), sound = value('speaker-sound'), range = value('speaker-range'), playback = value('speaker-playback');
        const group = value('speaker-group'), label = value('speaker-label'), visual = !!(document.getElementById('speaker-visual') as HTMLInputElement | null)?.checked;
        if (!Number.isInteger(radius) || radius < 8 || radius > 64 || !Number.isInteger(volume) || volume < 0 || volume > 100 || !Number.isInteger(intervalTicks) || intervalTicks < 60 || intervalTicks > 3600 || !Number.isInteger(pauseTicks) || pauseTicks < 60 || pauseTicks > 3600 || group.length > 32 || label.length > 64) { g.msg('Проверьте диапазоны настроек громкоговорителя'); break; }
        g.enqueue({ t: 'v117', section: 'speaker', op: 'configure', opId: `ui-speaker-${g.tick}-${++this.v117Seq}`, entityId: this.entId, mode, sound, group, label, range, radius, volume, playback, intervalTicks, pauseTicks, visual });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'speaker-manual': { const c = g.v117.speakers.configs[String(this.entId)]; if (c?.mode === 'manual') g.enqueue({ t: 'v117', section: 'speaker', op: 'manual', opId: `ui-speaker-${g.tick}-${++this.v117Seq}`, entityId: this.entId, enabled: !c.manualOn }); setTimeout(() => this.render(true), 50); break; }
      case 'speaker-listen': this.h.speakerListen(this.entId); break;
      case 'speaker-radar-save': { const e = g.ents.get(this.entId), radius = Number((document.getElementById('speaker-radar-radius') as HTMLInputElement | null)?.value); if (!e || e.t !== 'radar' || !Number.isInteger(radius) || radius < 8 || radius > 64) { g.msg('Радиус радара должен быть от 8 до 64 клеток'); break; } g.enqueue({ t: 'v117', section: 'speaker', op: 'radar', opId: `ui-speaker-${g.tick}-${++this.v117Seq}`, entityId: e.id, radius, enabled: e.cc?.rd === 1 }); setTimeout(() => this.render(true), 50); break; }
      case 'speaker-radar-toggle': { const e = g.ents.get(this.entId); if (e?.t === 'radar') { const r = g.v117.speakers.radar[String(e.id)]; g.enqueue({ t: 'v117', section: 'speaker', op: 'radar', opId: `ui-speaker-${g.tick}-${++this.v117Seq}`, entityId: e.id, radius: r?.radius || 32, enabled: e.cc?.rd !== 1 }); setTimeout(() => this.render(true), 50); } break; }
      case 'drone-port-save': {
        const radius = Number((document.getElementById('drone-port-radius') as HTMLInputElement | null)?.value);
        const enabled = !!(document.getElementById('drone-port-enabled') as HTMLInputElement | null)?.checked;
        const autoLaunch = !!(document.getElementById('drone-port-auto') as HTMLInputElement | null)?.checked;
        const priority = (document.getElementById('drone-port-priority') as HTMLSelectElement | null)?.value || null;
        if (!Number.isInteger(radius) || radius < 16 || radius > 64) { g.msg('Радиус связи дронового порта должен быть от 16 до 64 клеток'); break; }
        g.enqueue({ t: 'v117', section: 'drones', op: 'configure', opId: `ui-drone-${g.tick}-${++this.v117Seq}`, entityId: this.entId, radius, enabled, autoLaunch, priority });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'drone-port-center': {
        const e = g.ents.get(this.entId); if (!e || e.proto !== 'combat-drone-port') break;
        g.enqueue({ t: 'v117', section: 'drones', op: 'configure', opId: `ui-drone-${g.tick}-${++this.v117Seq}`, entityId: this.entId, x: g.player.x, y: g.player.y });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'drone-launch':
        g.enqueue({ t: 'v117', section: 'drones', op: 'launch', opId: `ui-drone-${g.tick}-${++this.v117Seq}`, entityId: this.entId, droneId: Number(el.dataset.id) });
        setTimeout(() => this.render(true), 50); break;
      case 'drone-transfer': { const id = Number(el.dataset.id), target = Number((document.getElementById(`drone-transfer-${id}`) as HTMLSelectElement | null)?.value); g.enqueue({ t: 'v117', section: 'drones', op: 'transfer', droneId: id, player: target, opId: `ui-drone-${g.tick}-${++this.v117Seq}` }); setTimeout(() => this.render(true), 50); break; }
      case 'drone-return': case 'drone-recover':
        g.enqueue({ t: 'v117', section: 'drones', op: a === 'drone-return' ? 'return' : 'recover', opId: `ui-drone-${g.tick}-${++this.v117Seq}`, droneId: Number(el.dataset.id) });
        setTimeout(() => this.render(true), 50); break;
      case 'drone-return-all':
        g.enqueue({ t: 'v117', section: 'drones', op: 'return-all', opId: `ui-drone-${g.tick}-${++this.v117Seq}`, entityId: Number(el.dataset.id) });
        setTimeout(() => this.render(true), 50); break;
      case 'bio-squad': {
        const formId = Number(el.dataset.form), form = g.v117.genetics.forms.find(f => f.id === formId);
        if (!form || form.owner !== (g.v117.playerIds[g.pl] || `player-${g.pl + 1}`) || form.dead) break;
        const name = prompt('Имя группы для этого и других назначенных биотрядов (пусто — убрать из группы):', form.squad || '');
        if (name == null) break;
        if (name.trim().length > 32) { g.msg('Имя группы — не больше 32 символов'); break; }
        g.enqueue({ t: 'v117', section: 'genetics', op: 'squad', opId: `ui-bio-${g.tick}-${++this.v117Seq}`, formId, squad: name });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'bio-squad-order': {
        const formId = Number(el.dataset.form), squad = el.dataset.squad || '', mode = el.dataset.mode || '';
        const form = g.v117.genetics.forms.find(f => f.id === formId && !f.dead && f.squad === squad);
        if (!form || form.owner !== (g.v117.playerIds[g.pl] || `player-${g.pl + 1}`)) break;
        if (mode === 'combat') { g.enqueue({ t: 'v117', section: 'genetics', op: 'combat', opId: 'ui-bio-combat-' + g.tick + '-' + (++this.v117Seq), formId, ...(a === 'bio-squad-order' ? { squad: el.dataset.squad } : {}), enabled: !form.order.combat }); setTimeout(() => this.render(true), 50); break; }
        if (mode === 'auto-return') { const forms = a === 'bio-squad-order' ? g.v117.genetics.forms.filter(f => !f.dead && f.owner === form.owner && f.squad === form.squad) : [form]; g.enqueue({ t: 'v117', section: 'genetics', op: 'auto-return', opId: 'ui-bio-resupply-' + g.tick + '-' + (++this.v117Seq), formId, ...(a === 'bio-squad-order' ? { squad: el.dataset.squad } : {}), enabled: !forms.every(f => f.autoReturn) }); setTimeout(() => this.render(true), 50); break; }
        const nextMode = mode;
        if (nextMode === 'move' || nextMode === 'patrol') { if (this.bioRoute.begin(formId, nextMode, a === 'bio-squad-order' ? el.dataset.squad : undefined)) { this.artPick = false; if (this.open !== 'map') this.toggle('map'); this.render(true); this.onMapDraw?.(); } break; }
        const points: { x: number; y: number }[] = [];
        const player = nextMode === 'follow' ? Math.max(0, g.v117.playerIds.indexOf(form.order.followPlayer || form.owner)) : undefined;
        g.enqueue({ t: 'v117', section: 'genetics', op: 'order', opId: `ui-bio-${g.tick}-${++this.v117Seq}`, formId, squad, mode: nextMode, points, combat: form.order.combat, ...(player === undefined ? {} : { player }) });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'bio-order': {
        const formId = Number(el.dataset.form), mode = el.dataset.mode || '', form = g.v117.genetics.forms.find(f => f.id === formId);
        if (!form || form.owner !== (g.v117.playerIds[g.pl] || `player-${g.pl + 1}`) || form.dead) break;
        if (mode === 'combat') { g.enqueue({ t: 'v117', section: 'genetics', op: 'combat', opId: 'ui-bio-combat-' + g.tick + '-' + (++this.v117Seq), formId, enabled: !form.order.combat }); setTimeout(() => this.render(true), 50); break; }
        if (mode === 'auto-return') { const forms = [form]; g.enqueue({ t: 'v117', section: 'genetics', op: 'auto-return', opId: 'ui-bio-resupply-' + g.tick + '-' + (++this.v117Seq), formId, enabled: !forms.every(f => f.autoReturn) }); setTimeout(() => this.render(true), 50); break; }
        const nextMode = mode;
        if (nextMode === 'move' || nextMode === 'patrol') { if (this.bioRoute.begin(formId, nextMode)) { this.artPick = false; if (this.open !== 'map') this.toggle('map'); this.render(true); this.onMapDraw?.(); } break; }
        const points: { x: number; y: number }[] = [];
        g.enqueue({ t: 'v117', section: 'genetics', op: 'order', opId: `ui-bio-${g.tick}-${++this.v117Seq}`, formId, mode: nextMode, points, combat: form.order.combat });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'bio-command': {
        const op = el.dataset.op || '', family = el.dataset.family, bank = Number(el.dataset.bank), formId = Number(el.dataset.form);
        const body = { ...(op === 'detonate' ? { enabled: el.dataset.enabled === 'true' } : {}), ...(family ? { family } : {}), ...(el.dataset.bank ? { entityId: bank } : {}), ...(el.dataset.form ? { formId } : {}), ...(el.dataset.lab ? { labId: Number(el.dataset.lab) } : {}) };
        g.enqueue({ t: 'v117', section: 'genetics', op, opId: `ui-bio-${g.tick}-${++this.v117Seq}`, ...body });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'bio-queue': {
        const item = el.dataset.item, entityId = Number(el.dataset.fab);
        if (item && Number.isSafeInteger(entityId) && entityId > 0) g.enqueue({ t: 'v117', section: 'genetics', op: 'queue', opId: `ui-bio-${g.tick}-${++this.v117Seq}`, item, entityId });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'bio-cancel-job': {
        const jobId = Number(el.dataset.job);
        if (Number.isSafeInteger(jobId) && jobId > 0) g.enqueue({ t: 'v117', section: 'genetics', op: 'cancel', opId: `ui-bio-${g.tick}-${++this.v117Seq}`, jobId });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'bio-transfer': {
        const formId = Number(el.dataset.form), player = Number(el.dataset.player);
        if (Number.isSafeInteger(formId) && Number.isSafeInteger(player)) g.enqueue({ t: 'v117', section: 'genetics', op: 'transfer', opId: `ui-bio-${g.tick}-${++this.v117Seq}`, formId, player });
        setTimeout(() => this.render(true), 50); break;
      }
      case 'close': this.close(); break;
      case 'note-add': { const p = g.player; const d = this.noteDraft; const hx = d.x !== '' && d.y !== '' && isFinite(+d.x) && isFinite(+d.y); g.enqueue({ t: 'note', op: this.noteEditing == null ? 'add' : 'edit', ...(this.noteEditing == null ? {} : { id: this.noteEditing }), x: hx ? Math.floor(+d.x) + 0.5 : p.x, y: hx ? Math.floor(+d.y) + 0.5 : p.y, title: d.title || 'Заметка', text: d.text, icon: d.icon }); this.noteEditing = null; this.noteDraft = { title: '', text: '', x: '', y: '', icon: null }; this.noteIconOpen = false; this.noteIconQ = ''; this.render(true); break; }
      case 'note-go': { const n = g.notes.find(n => n.id === +el.dataset.id!); if (n) { if (this.open !== 'map') this.toggle('map'); Object.assign(this.mapv, { cx: n.x, cy: n.y, follow: false }); this.onMapDraw?.(); this.render(true); } break; }
      case 'speaker-go': { const e = g.ents.get(+el.dataset.id!); if (e?.proto === 'programmable-speaker') { if (this.open !== 'map') this.toggle('map'); Object.assign(this.mapv, { cx: e.x + e.w / 2, cy: e.y + e.h / 2, follow: false }); this.onMapDraw?.(); this.render(true); } break; }
      case 'note-edit': { const n = g.notes.find(n => n.id === +el.dataset.id!); if (n) { this.noteEditing = n.id; this.noteDraft = { title: n.title, text: n.text, x: String(n.x), y: String(n.y), icon: validNoteIcon(n.icon) ? n.icon : null }; this.noteIconOpen = false; this.render(true); } break; }
      case 'note-cancel': this.noteEditing = null; this.noteDraft = { title: '', text: '', x: '', y: '', icon: null }; this.noteIconOpen = false; this.render(true); break;
      case 'note-icon-toggle': this.noteIconOpen = !this.noteIconOpen; this.render(true); break;
      case 'note-icon-select': this.noteDraft.icon = validNoteIcon(el.dataset.item) ? el.dataset.item : null; this.noteIconOpen = false; this.render(true); break;
      case 'note-icon-clear': this.noteDraft.icon = null; this.render(true); break;
      case 'mapzoom': this.mapZoom(+el.dataset.v! > 0 ? 0.5 : 2); break;
      case 'mapme': this.mapv.follow = true; this.onMapDraw?.(); this.render(true); break;
      case 'note-del': g.enqueue({ t: 'note', op: 'del', id: +el.dataset.id! }); if (this.noteEditing === +el.dataset.id!) { this.noteEditing = null; this.noteDraft = { title: '', text: '', x: '', y: '', icon: null }; } this.render(true); break;
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
      case 'invqclear': this.invQ = ''; this.render(true); break;
      case 'cancelq': g.enqueue({ t: 'cancelCraft', index: +el.dataset.q! }); setTimeout(() => this.render(true), 40); break;
      case 'craft': { const n = ev.shiftKey ? 99 : rmb ? 5 : 1; g.enqueue({ t: 'craft', recipe: el.dataset.r!, count: n, max: ev.shiftKey }); break; }
      case 'unequip': if (g.equip) g.enqueue({ t: 'equip', item: null }); break;
      case 'csort': g.enqueue({ t: 'sortInv', id: this.entId }); break;
      // v1.7: поезда
      case 'tcar': this.entId = +el.dataset.id!; this.render(true); break;
      case 'vehicle-turret': g.enqueue({ t: 'vehicleTurret', id: this.entId, slot: +el.dataset.slot!, proto: el.dataset.v || null }); setTimeout(() => this.render(true), 50); break;
      case 'vehicle-ammo': g.enqueue({ t: 'vehicleAmmo', id: this.entId, slot: +el.dataset.slot!, item: el.dataset.v || null }); setTimeout(() => this.render(true), 50); break;
      case 'vehicle-equip': g.enqueue({ t: 'vehicleEquipment', id: this.entId, op: el.dataset.op as any, item: el.dataset.v, x: +el.dataset.x!, y: +el.dataset.y! }); setTimeout(() => this.render(true), 50); break;
      case 'topen': this.toggle('ent', +el.dataset.id!); break;
      case 'tmode': g.enqueue({ t: 'tmode', id: this.entId, auto: el.dataset.v === '1' }); break;
      case 'wfall': g.enqueue({ t: 'wfilterAll', id: this.entId, op: el.dataset.v as any }); break;
      case 'stname': { const v = (document.getElementById('stname') as HTMLInputElement | null)?.value || ''; if (v.trim()) { g.enqueue({ t: 'stopName', id: this.entId, name: v }); } break; }
      case 'stopSide': { const e = g.ents.get(this.entId); if (e?.t === 'stop') g.enqueue({ t: 'stopSide', id: e.id, left: el.dataset.left === '1' }); break; }
      case 'sadd': this.sPick = { row: -1 }; this.sPickQ = ''; this.render(true); break;
      case 'sst': this.sPick = { row: +el.dataset.i! }; this.sPickQ = ''; this.render(true); break;
      case 'schoose': { const name = el.dataset.name || ''; const row = this.sPick?.row ?? -1; if (!name) break;
        this.schedEdit(s => { if (row < 0) s.push({ st: name, c: s.length ? 'empty' : 'full', n: 5 }); else if (s[row]) s[row].st = name; });
        this.sPick = null; this.sPickQ = ''; this.render(true); break; }
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
      case 'invpage': { const p = Number(el.dataset.v); if (Number.isInteger(p)) this.invPage = Math.max(0, Math.min(Math.ceil(g.inv.size / 32) - 1, p)); this.render(true); break; }
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
      case 'quickunload': g.enqueue({ t: 'quick', id: this.entId, op: 'unload' }); break;
      case 'eslot': if (g.held) g.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: this.entId, slot: el.dataset.slot, n: rmb ? 'one' : 'all' }); break;
      case 'inv': {
        const i = +el.dataset.i!;
        if (el.dataset.mode === 'trash') { if (!Number.isInteger(i) || i < 0 || i >= g.trash.slots.length) break; if (g.held) g.enqueue({ t: 'hand', op: 'drop', to: 'trash', i, n: rmb ? 'one' : 'all' }); else if (g.trash.slots[i]) g.enqueue({ t: 'hand', op: 'pick', from: 'trash', i, n: rmb ? (ev.shiftKey ? 'one' : 'half') : 'all' }); break; }
        if (g.held) { g.enqueue({ t: 'hand', op: 'drop', to: 'inv', i, n: rmb ? 'one' : 'all' }); break; }
        const s = g.inv.slots[i]; if (!s) break;
        if (rmb) { g.enqueue({ t: 'hand', op: 'pick', from: 'inv', i, n: ev.shiftKey ? 'one' : 'half' }); break; }
        if (ev.shiftKey && el.dataset.mode !== 'put') { g.enqueue({ t: 'hand', op: 'pick', from: 'inv', i, n: 'all' }); break; }
        const qk = this.h.getSettings().quickKey === 'ctrl' ? (ev.ctrlKey || ev.metaKey) : ev.shiftKey; // v1.11: быстрая погрузка — Shift (или Ctrl в настройках)
        if (qk && el.dataset.mode === 'put') { g.enqueue({ t: 'quick', id: this.entId, op: 'load', item: s.item }); break; }
        if (ITEMS[s.item].equip && el.dataset.mode !== 'put') { g.enqueue({ t: 'equip', item: s.item }); break; }
        if (el.dataset.mode === 'put') { g.enqueue({ t: 'put', id: this.entId, item: s.item, count: (ev.ctrlKey || ev.metaKey || ev.shiftKey) ? 1e9 : s.count }); }
        else if (ITEMS[s.item].place || s.item === 'repair-pack' || FLOOR_BY_ITEM[s.item] || WIRE_OF[s.item] != null) { this.h.setCursor(s.item); this.close(); }
        break;
      }
      case 'take':
        if (g.held) { g.enqueue({ t: 'hand', op: 'drop', to: 'ent', id: this.entId, slot: el.dataset.slot, n: rmb ? 'one' : 'all' }); break; }
        if (rmb) { g.enqueue({ t: 'hand', op: 'pick', from: 'ent', id: this.entId, slot: el.dataset.slot, n: ev.shiftKey ? 'one' : 'half' }); break; }
        g.enqueue({ t: 'take', id: this.entId, slot: el.dataset.slot! }); break;
      case 'takeall': g.enqueue({ t: 'take', id: this.entId, slot: 'chestall:0' }); break;
      case 'slotLimitAll': { const id = Number(el.dataset.id), e = g.ents.get(id); if (e?.t === 'chest' && e.inv) g.enqueue({ t: 'slotLimit', id, limit: null }); break; }
      case 'slotLimitPreset': { const id = Number(el.dataset.id), n = Number(el.dataset.v), e = g.ents.get(id); if (e?.t === 'chest' && e.inv && Number.isInteger(n) && n >= 1 && n <= Math.min(4, e.inv.size)) g.enqueue({ t: 'slotLimit', id, limit: n }); break; }
      case 'trashClear': if (!rmb && ev.button === 0) g.enqueue({ t: 'trashClear' }); break;
      case 'rallow': g.enqueue({ t: 'reactor', id: this.entId, op: 'allow', on: el.dataset.on === '1' }); break;
      case 'rstop': g.enqueue({ t: 'reactor', id: this.entId, op: 'stop', on: el.dataset.on === '1' }); break;
      case 'noboom': g.enqueue({ t: 'noBoom', on: el.dataset.on === '1' }); break;
      case 'setrecipe': this.pendingFluidRecipe = { entity: this.entId, recipe: el.dataset.r!, until: performance.now() + 5000 }; g.enqueue({ t: 'setRecipe', id: this.entId, recipe: el.dataset.r! }); break;
      case 'research': g.enqueue({ t: 'research', tech: el.dataset.t! }); this.techSel = el.dataset.t!; break;
      case 'rqadd': { const id = el.dataset.t!; if (el.dataset.deps) { const l = depsToAdd(g, id); if (!confirm(`Добавить в очередь ${l.length}: ${l.map(x => TECHS[x].name).join(' → ')}?`)) break; } g.enqueue({ t: 'x', op: 'rqadd', tech: id, deps: !!el.dataset.deps }); break; }
      case 'rqdel': g.enqueue({ t: 'x', op: 'rqdel', tech: el.dataset.t! }); break;
      case 'rqmove': g.enqueue({ t: 'x', op: 'rqmove', tech: el.dataset.t!, d: +el.dataset.d! }); break;
      case 'nghide': g.enqueue({ t: 'x', op: 'nghide' }); break;
      case 'ngshow': g.enqueue({ t: 'x', op: 'ngshow' }); break;
      case 'bghide': case 'bgshow': case 'bgcompare': g.enqueue({ t: 'v117', section: 'training', op: a === 'bghide' ? 'hide' : a === 'bgshow' ? 'show' : 'compare', opId: `ui-bioguide-${g.tick}-${++this.v117Seq}`, ...(a === 'bgcompare' ? { item: el.dataset.item } : {}) }); break;
      case 'rflt': g.enqueue({ t: 'x', op: 'rflt', k: el.dataset.k!, on: el.dataset.on === '1' }); break;
      case 'rqclear': g.enqueue({ t: 'x', op: 'rqclear' }); break;
      case 'techsel': {
        const old = this.techSel; this.techSel = el.dataset.t!;
        if (old) { const prev = document.querySelector(`#win [data-act="techsel"][data-t="${CSS.escape(old)}"]`); prev?.classList.remove('sel'); }
        el.classList.add('sel'); if (this.techClickTimer != null) window.clearTimeout(this.techClickTimer);
        this.techClickTimer = window.setTimeout(() => { this.techClickTimer = null; if (this.open === 'tech') this.render(true); }, 350); break;
      }
      case 'techview': this.techView = el.dataset.v as any; this.render(true); break;
      case 'techcenter': { const id = g.research.current || this.techSel; if (id) { this.techSel = id; this.centerTech(id); this.techApply(); } this.render(true); break; }
      case 'techzoom': this.techZoom(+el.dataset.v! > 0 ? 1.2 : 1 / 1.2); break;
      case 'save': this.h.save(el.dataset.s!); this.render(true); break;
      case 'load': this.menuReturnTo = null; this.h.load(el.dataset.s!); break;
      case 'export': this.h.exportSave(); break;
      case 'import': this.h.importSave(); break;
      case 'new': { this.captureMenuDraft(); this.menuReturnTo = null; const v = this.menuSeed; const m = this.menuMode; const gen = this.menuGen; this.h.newGame(Number(v) || 1, m, undefined, gen); break; }
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
      case 'factory': this.toggle('fact'); break;
      case 'gconsole': this.toggle('gcon'); break;
      case 'beta': this.toggle('beta'); break;
      case 'bug': this.toggle('bug'); break;
      case 'contrib': this.toggle('contrib'); break;
      case 'news': this.toggle('news'); break;
      case 'modsopen': this.toggle('mods'); break;
      case 'benchopen': this.h.openBench(el.dataset.v ? +el.dataset.v : undefined); break;
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
      case 'keysreset': this.h.setSettings({ keys: { ...DEFAULTS.keys }, keys2: {} }); this.rebindNote = ''; this.render(true); break;
      case 'unbind': { const id = el.dataset.k!; const st = this.h.getSettings(); if (id.endsWith('#2')) this.h.setSettings({ keys2: { ...st.keys2, [id.slice(0, -2)]: '' } }); else this.h.setSettings({ keys: { ...st.keys, [id]: '' } }); this.render(true); break; }
      case 'keypreset': { const st = this.h.getSettings(); const pr = KEY_PRESETS[el.dataset.v!][1]; const keys = { ...st.keys }; const k2 = { ...st.keys2 };
        for (const [a, c] of Object.entries(pr)) { for (const o in keys) if (keys[o] === c && !(o in pr)) keys[o] = ''; for (const o in k2) if (k2[o] === c) k2[o] = ''; keys[a] = c; }
        this.h.setSettings({ keys, keys2: k2 }); this.rebindNote = 'Раскладка: ' + KEY_PRESETS[el.dataset.v!][0]; this.render(true); break; }
      case 'quickkey': this.h.setSettings({ quickKey: el.dataset.v as any }); this.render(true); break;
      case 'hotrows': this.h.setSettings({ hotRows: +el.dataset.v! }); this.render(true); break;
      case 'keyshot': this.keysHot = !this.keysHot; this.render(true); break;
      case 'sitem': this.statItem = this.statItem === el.dataset.k ? null : el.dataset.k!; this.render(true); break;
      case 'bptab': this.bpTab = el.dataset.v === 'party' ? 'party' : 'mine'; this.render(true); break;
      case 'bp116': { const have = new Set(this.bpLib().map(x => x.name)); let n = 0; for (const b of bp116()) if (!have.has(b.name)) { this.addBp(JSON.parse(JSON.stringify(b.bp))); n++; } this.bpMsg = n ? `Добавлено чертежей: ${n}` : 'Эти чертежи уже в вашей библиотеке'; this.render(true); break; }
      case 'bpparty': { const x = this.bpLib()[+el.dataset.i!]; if (x) { this.g.enqueue({ t: 'bplib', op: 'add', bp: x.bp }); this.bpTab = 'party'; } break; }
      case 'pbtake': { const x = this.g.bpLib.find(b => b.id === +el.dataset.id!); if (x) { this.h.takeBp(JSON.parse(JSON.stringify(x.bp))); this.close(); } break; }
      case 'pbmine': { const x = this.g.bpLib.find(b => b.id === +el.dataset.id!); if (x) { this.addBp(JSON.parse(JSON.stringify(x.bp))); this.g.msg('Чертёж скопирован в вашу библиотеку'); } break; }
      case 'pbdel': { const id = +el.dataset.id!; if (confirm(tr('Удалить чертёж из библиотеки партии у всех игроков?'))) this.g.enqueue({ t: 'bplib', op: 'del', id }); break; }
      case 'pbren': { const x = this.g.bpLib.find(b => b.id === +el.dataset.id!); if (!x) break; const n = prompt(tr('Название чертежа'), x.name); if (n) this.g.enqueue({ t: 'bplib', op: 'ren', id: x.id, name: n.slice(0, 40) }); break; }
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
  /** v1.11: ЛКМ — взять в руку (с предметом в руке по пустой ячейке — закрепить его), ПКМ — убрать (автозаполнение его не вернёт),
   *  средняя кнопка или Ctrl+ЛКМ — закрепить / открепить, перетаскивание — поменять ячейки местами */
  private onHotbar(ev: MouseEvent) {
    const el = (ev.target as HTMLElement).closest('[data-h]') as HTMLElement | null; if (!el) return;
    const i = +el.dataset.h!; ev.stopPropagation(); ev.preventDefault();
    if (ev.button === 2) { const it = this.hotbar[i]; if (it && !this.hotBan.includes(it)) this.hotBan.push(it); this.hotbar[i] = null; this.hotPin[i] = false; return; }
    if (ev.button === 1 || (ev.button === 0 && (ev.ctrlKey || ev.metaKey))) { if (this.hotbar[i]) this.hotPin[i] = !this.hotPin[i]; return; }
    const cur = this.h.cursor();
    if (cur && !this.hotbar[i]) { this.pinAt(i, cur); return; }
    this.hotDrag = i;
    const up = (e2: MouseEvent) => { document.removeEventListener('mouseup', up, true); const t = (document.elementFromPoint(e2.clientX, e2.clientY) as HTMLElement | null)?.closest('#hotbar [data-h]') as HTMLElement | null; const j = t ? +t.dataset.h! : -1; const from = this.hotDrag; this.hotDrag = -1;
      if (j >= 0 && j !== from) { [this.hotbar[from], this.hotbar[j]] = [this.hotbar[j], this.hotbar[from]]; [this.hotPin[from], this.hotPin[j]] = [this.hotPin[j], this.hotPin[from]]; } else this.selectHot(from); };
    document.addEventListener('mouseup', up, true);
  }
  /** закрепить предмет в ячейке (из инвентаря, крафта или руки) */
  pinAt(i: number, it: string) { const j = this.hotbar.indexOf(it); if (j >= 0 && j !== i) { this.hotbar[j] = null; this.hotPin[j] = false; } this.hotbar[i] = it; this.hotPin[i] = true; this.hotBan = this.hotBan.filter(x => x !== it); }
  /** закрепить в первую свободную ячейку видимых рядов; уже закреплён — открепить */
  togglePin(it: string) {
    const j = this.hotbar.indexOf(it);
    if (j >= 0 && this.hotPin[j]) { this.hotPin[j] = false; this.hotbar[j] = null; if (!this.hotBan.includes(it)) this.hotBan.push(it); this.g.msg(`Откреплено: ${ITEMS[it].name}`); return; }
    if (j >= 0) { this.hotPin[j] = true; this.g.msg(`Закреплено: ${ITEMS[it].name}`); return; }
    const lim = this.hotRows() * 10; let k = this.hotbar.findIndex((x, i) => x == null && i < lim); if (k < 0) k = this.hotbar.findIndex((x, i) => !this.hotPin[i] && i < lim);
    if (k < 0) { this.g.msg('Нет свободной ячейки быстрого доступа — добавьте ряд в настройках'); return; }
    this.pinAt(k, it); this.g.msg(`Закреплено: ${ITEMS[it].name}`);
  }
  selectHot(i: number) { const it = this.hotbar[i]; if (!it) return; this.h.setCursor(this.h.cursor() === it ? null : it); }
  /** v1.11: подсказка не мигает — содержимое меняется только при изменении, после перерисовки окна обновляется по последней точке курсора */
  private tipXY: [number, number] = [-1, -1]; private tipH = '';
  refreshTip() { if (this.tipEl.style.display !== 'block') return; const [x, y] = this.tipXY; const t = document.elementFromPoint(x, y); if (t) this.onTip({ target: t, clientX: x, clientY: y } as any); }
  private onTip(ev: MouseEvent) {
    const fluidRow = (ev.target as HTMLElement).closest?.('[data-fluid-tank]') as HTMLElement | null;
    this.fluidFocus = fluidRow ? { entity: Number(fluidRow.dataset.fluidEntity), tank: Number(fluidRow.dataset.fluidTank) } : null;
    this.tipXY = [ev.clientX, ev.clientY];
    const el = (ev.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null;
    if (!el) { if (this.tipEl.style.display !== 'none') this.tipEl.style.display = 'none'; this.tipH = ''; return; }
    const [k, id] = el.dataset.tip!.split(':'); const g = this.g; let h = '';
    if (k === 'item') { const it = ITEMS[id]; h = `<b>${it.name}</b>${it.fuel ? `<div>Топливо: ${it.fuel} МДж</div>` : ''}${it.ammo ? `<div>Урон: ${it.ammo} за выстрел</div>` : ''}${it.bioCoating ? `<div class="small">${tr(BIO_COATING_LABELS[`${it.bioCoating.kind}:${it.bioCoating.amount}`] || '')}<br>${tr('Исходный боеприпас')}: ${tr(ITEMS[it.bioCoating.source]?.name || it.bioCoating.source)}</div>` : ''}${it.bioLining ? `<div class="small">${tr(BIO_LINING_LABELS[`${it.bioLining.kind}:${it.bioLining.amount}`] || '')} · ${tr('Активна только одна подкладка')}</div>` : ''}${it.am?.aoe ? `<div>Радиус взрыва: ${it.am.aoe} клеток (у границы — 50 % урона)</div>` : ''}${it.am?.nuke ? `<div class="err">☢ Радиоактивный след: ${it.am.nuke.tr} клеток, ${it.am.nuke.ts} с, ${it.am.nuke.dps} ед/с. Опасно для своих и построек.</div>` : ''}${it.am?.iso ? `<div class="small">Изотопный: урон ×${it.am.iso}</div>` : ''}${it.module ? `<div>${[['Скорость', it.module.speed], ['Продуктивность', it.module.prod], ['Энергия', it.module.energy], ['Загрязнение', it.module.pollution]].filter(x => x[1]).map(x => `${x[0]}: <b>${pct(x[1] as number)}</b>`).join('<br>')}</div>${it.module.kind === 'productivity' ? '<div class="dim small">Только для промежуточных продуктов; маяк не принимает</div>' : ''}` : ''}${it.fluid ? '<div class="dim">Жидкость — по трубам</div>' : `<div class="dim">В инвентаре: ${g.inv.count(id)}</div>`}`; }
    if (k === 'recipe' || k === 'locked') {
      const r = RECIPES[id]; const out = r.out[0]; const first = out?.[0] || r.in[0]?.[0] || id;
      const where: Record<string, string> = { crafting: r.hand ? '' : 'Сборщик', smelting: 'Печь', chemistry: 'Химический завод', refining: 'НПЗ', centrifuging: 'Центрифуга', bioprocessing: 'Биоэкстрактор', 'crafting-with-fluid': 'Сборщик 2/3 (с жидкостью)', rocket: 'Ракетная шахта' };
      h = `<b>${tr(r.name || ITEMS[first]?.name || id)}${out && out[1] > 1 && !r.name ? ' ×' + out[1] : ''}</b><div class="dim">${r.time} с${where[r.cat] ? ' · ' + tr(where[r.cat]) : ''}</div>` + r.in.map(([it, n]) => { const have = g.inv.count(it); return `<div class="kv"><img src="${iconURL(it)}"> ${n} × ${ITEMS[it].name} ${ITEMS[it].fluid ? '' : `<span class="${have >= n ? '' : 'err'}">${have}</span>`}</div>`; }).join('')
        + (r.out.length ? (r.out.length > 1 || r.name ? '<div class="lbl">Результат:</div>' : '') + r.out.map(([it, n]) => `<div class="kv"><img src="${iconURL(it)}"> ${n} × ${ITEMS[it].name}</div>`).join('') : `<div class="lbl">${tr('Выхода нет: отходы утилизируются')}</div>`);
      if (k === 'locked') { const t = TECH_LIST.find(t => t.unlocks.includes(id)); h += `<div class="err">Нужна технология «${t?.name}»</div>`; }
    }
    if (!h) { this.tipEl.style.display = 'none'; this.tipH = ''; return; }
    if (h !== this.tipH) { this.tipEl.innerHTML = tr(h); this.tipH = h; }
    if (this.tipEl.style.display !== 'block') this.tipEl.style.display = 'block';
    const sc = this.h.getSettings().uiScale || 1; const tw = this.tipEl.offsetWidth * (uiZoomMode === 'zoom' ? sc : 1), th = this.tipEl.offsetHeight * (uiZoomMode === 'zoom' ? sc : 1);
    // подсказка не заходит под курсор: справа-снизу, у края экрана — слева или сверху
    let x = ev.clientX + 16, y = ev.clientY + 14; if (x + tw > window.innerWidth - 4) x = ev.clientX - tw - 12; if (y + th > window.innerHeight - 4) y = Math.max(4, ev.clientY - th - 10);
    const zk = uiZoomMode === 'zoom' ? sc : 1; const L = Math.round(x / zk) + 'px', T = Math.round(y / zk) + 'px';
    if (this.tipEl.style.left !== L) this.tipEl.style.left = L; if (this.tipEl.style.top !== T) this.tipEl.style.top = T;
  }
}

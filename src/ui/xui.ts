// v1.16: окна управления заводом — консоль (/creative, /survival), «Завод» (группы, оповещения, месторождения, расширение, питание),
// «Почему остановилась?». Всё берётся из состояния Game (g.x и расчёты sim/mgmt.ts), физику UI не считает.
import type { Entity, Game } from '../sim/game';
import { CONSOLE_HELP } from '../sim/x116';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';
import { STATUS_TEXT } from '../data/statusText';
import { PR_NAMES, RULE_INFO, RuleKind, MAX_GROUPS, MAX_RULES, ruleText, fmtMin, DiagReport, DNode, powerLevel, GroupInfo, Forecast, PlanResult, PlanPreview, PlanInput } from '../sim/mgmt';
import { CHUNK } from '../core/types';

export const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export interface XHost { game(): Game; render(): void; close(): void; toggle(w: string): void; open(): string | null; tool?(t: 'group' | null): void; openEnt?(id: number): void; mapArea?(r: { x: number; y: number; w: number; h: number }): void; hl?(r: { x: number; y: number; w: number; h: number }[]): void; /** запрос к Worker (диагностика, группы, прогноз, план) */ query(q: string, a: any): Promise<any>; }
const TABS: [string, string][] = [['g', 'Группы'], ['a', 'Оповещения'], ['f', 'Месторождения'], ['p', 'Расширение'], ['w', 'Питание']];
const fmtKW = (k: number) => Math.abs(k) >= 1000 ? (k / 1000).toFixed(2).replace('.', ',') + ' МВт' : Math.round(k) + ' кВт';
const n1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
const iname = (id: string) => ITEMS[id]?.name ?? id;
export class XUi {
  hist: string[] = []; hi = -1; log: string[] = [];
  /** поля форм (переживают перерисовку) */
  f: Record<string, string> = { tab: 'g', gname: '', gcolor: '#4a8fc0', gnew: '', rkind: 'fuel', rtarget: 'all', rthr: '', rdur: '', rrem: '60', pitem: 'iron-gear-wheel', prate: '60', pmode: 'abs', pgroup: '', pasm: '2', pfurnace: 'stone-furnace', pdrill: '1', pmods: 'none', pmodTier: '1', pbeacons: '0', pbeaconTier: '1', pdistance: '', pcycle: '', px: '', py: '' };
  gsel: number | null = null; sel: number[] = []; diagId = -1; private preparedPlanKey: string | null = null;
  private cache = new Map<string, { t: number; tick: number; world: object; v: any; busy: boolean; seen: number }>();
  /** результат запроса к Worker (кэш, обновление не чаще ttl мс; после ответа окно перерисовывается, пока его смотрят) */
  q<T = any>(key: string, kind: string, arg: any, ttl = 1000): T | null {
    const now = performance.now(), game = this.h.game(); let c = this.cache.get(key);
    if (c?.world !== game.world) c = undefined;
    if (!c) { if (this.cache.size > 200) this.cache.clear(); c = { t: -1e9, tick: -1e9, world: game.world, v: null, busy: false, seen: now }; this.cache.set(key, c); }
    c.seen = now;
    const expired = kind === 'diag' ? !c.v || game.tick - c.tick >= 60 : now - c.t > ttl;
    if (!c.busy && expired) { c.busy = true; const cc = c; this.h.query(kind, arg).then(v => { if (this.cache.get(key) !== cc || this.h.game().world !== cc.world) return; cc.v = v; cc.t = performance.now(); cc.tick = this.h.game().tick; cc.busy = false; if (performance.now() - cc.seen < 1500) this.h.render(); }).catch(() => { cc.busy = false; cc.t = performance.now(); cc.tick = this.h.game().tick; }); }
    return c.v as T | null;
  }
  /** рамка выбора: идентификаторы определяет Worker (в зеркале видна не вся карта) */
  async pickRect(x0: number, y0: number, x1: number, y1: number) { const ids = await this.h.query('rect', { x0, y0, x1, y1 }); if (!ids.length) { this.h.game().msg('В рамке нет построек'); return; } this.h.game().msg(`Выбрано построек: ${ids.length}`); this.setSel(ids); }
  constructor(public h: XHost) {}
  private knownEntity(e: Entity): boolean {
    for (let cy = Math.floor(e.y / CHUNK); cy <= Math.floor((e.y + e.h - 1) / CHUNK); cy++) for (let cx = Math.floor(e.x / CHUNK); cx <= Math.floor((e.x + e.w - 1) / CHUNK); cx++) if (!this.h.game().world.hasChunk(cx, cy)) return false;
    return true;
  }
  html(w: string): string | null {
    if (w === 'gcon') return this.conHtml();
    if (w === 'fact') return this.factHtml();
    return null;
  }
  setSel(ids: number[]) { this.sel = ids; this.f.tab = 'g'; if (this.h.open() !== 'fact') this.h.toggle('fact'); else this.h.render(); }
  input(el: HTMLElement): boolean {
    if (!el.id.startsWith('xin-')) return false;
    this.f[el.id.slice(4)] = (el as HTMLInputElement).value;
    if (el.id === 'xin-rkind') { this.f.rthr = this.f.rdur = ''; if (this.f.rtarget.startsWith('n:') && this.f.rkind !== 'power' || this.f.rtarget.startsWith('f:') && this.f.rkind !== 'field' || this.f.rtarget.startsWith('t:') && this.f.rkind !== 'train') this.f.rtarget = 'all'; }
    if (el.tagName === 'SELECT') this.h.render();
    return true;
  }
  // ---------- консоль ----------
  private conHtml() {
    const g = this.h.game(); const mode = g.x.mode === 1 ? '<b class="warn">ТВОРЧЕСКИЙ</b>' : 'выживание';
    const msgs = g.messages.slice(-6).map(m => `<div class="small">${esc(m.text)}</div>`).join('');
    return `<div class="panel"><div class="title">Консоль <span class="x" data-act="close">✕</span></div>
      <div class="small">Режим мира: ${mode}${g.x.cheats ? ' · <span class="warn">тестовая партия: достижения и рекорды отключены навсегда</span>' : ''}</div>
      <div class="dim small">${esc(CONSOLE_HELP)}. Enter — выполнить, ↑↓ — история, Esc — закрыть. Команды меняют режим всего мира — только хост и админы.</div>
      <div class="conlog">${this.log.slice(-6).map(l => `<div class="small dim">${esc(l)}</div>`).join('')}${msgs}</div>
      <div class="row2"><input id="xcon-in" maxlength="256" placeholder="/creative  или  /survival" autocomplete="off" spellcheck="false"><button data-act="x-con">Выполнить</button></div></div>`;
  }
  // ---------- карточка машины: приоритет, группа, «Почему остановилась?» ----------
  entExtra(e: Entity): string {
    const g = this.h.game(); const p = PROTOS[e.proto]; let b = '';
    const gr = e.grp !== undefined ? g.x.groups[e.grp] : null;
    if (gr) b += `<div class="small"><span class="gdot" style="background:${esc(gr.color)}"></span>Группа: <b>${esc(gr.name)}</b></div>`;
    if (p.energy?.kind === 'electric') {
      const lv = powerLevel(g, e); const own = e.pp !== undefined;
      b += `<div class="lbl">Приоритет питания при дефиците${own ? '' : ' <span class="dim">(' + (gr?.pr !== undefined ? 'от группы' : 'по умолчанию') + ')</span>'}</div><div class="row2">` + [0, 1, 2].map(i => `<button class="${lv === i ? 'on' : ''}" data-act="x-pri" data-id="${e.id}" data-pr="${i}">${PR_NAMES[i]}</button>`).join('') + `</div>`;
      if (e._cut) b += `<div class="err small">Отключена приоритетом: на её уровне не хватает мощности</div>`;
    }
    if (e.status && !['belt', 'underground', 'splitter', 'pole', 'wall', 'gate', 'rail', 'pipe', 'hpipe', 'chest', 'lamp', 'signal', 'stop'].includes(e.t) && e.t !== 'nest') {
      b += `<div class="row2"><button data-act="x-why" data-id="${e.id}">Почему остановилась?</button></div>`;
      if (this.diagId === e.id) b += this.diagHtml();
    }
    return b;
  }
  private diagHtml() {
    const g = this.h.game(); const R = this.q<DiagReport>('diag:' + this.diagId, 'diag', this.diagId); if (!R || R.id !== this.diagId) return '<div class="dim small">Считаю цепочку…</div>';
    const node = (n: DNode, d: number): string => {
      const e = n.id >= 0 ? g.ents.get(n.id) : undefined, clickable = !!e && this.knownEntity(e);
      const go = clickable ? ` data-act="x-go" data-id="${n.id}"` : ''; const stable = n.stable === true ? ' · устойчиво' : n.stable === false ? ' · переходное состояние' : '';
      return `<div class="dnode" style="margin-left:${d * 12}px"><span${go} class="${clickable ? 'lnk' : ''}"><b>${esc(n.name)}</b></span>${n.status ? ` <span class="dim">[${esc(STATUS_TEXT[n.status] || n.status)}${stable}]</span>` : ''} — ${esc(n.cause)}</div>` + n.kids.map(k => node(k, d + 1)).join('');
    };
    const age = Math.round((g.tick - R.tick) / 60);
    return `<div class="diag"><div class="dim small">Снимок: тик ${R.tick} (${age ? age + ' с назад' : 'сейчас'}) · узлов ${R.nodes} · расчёт ${R.ms.toFixed(1)} мс. Отчёт ничего не меняет в машинах.</div>${R.root ? node(R.root, 0) : '<div class="err">Объект не найден</div>'}${R.cut ? `<div class="warn small">Цепочка продолжена за пределами отчёта — нажмите на узел и спросите «Почему остановилась?» от него.</div>` : ''}</div>`;
  }
  alertHud(): string {
    const g = this.h.game(); const ownAck = new Set(g.x.ack[g.pl] || []); const act = g.x.rules.filter(r => g.x.al[r.id]?.st === 2 && !ownAck.has(g.x.al[r.id].ev));
    if (!act.length) return '';
    return `<div class="goal" data-act="factory" style="cursor:pointer"><div class="oscar">⚠</div><div><b>Тревог: ${act.length}</b><div class="sub">${esc(ruleText(g, act[0]))}${act.length > 1 ? ' и ещё ' + (act.length - 1) : ''}</div></div></div>`;
  }
  // ---------- окно «Завод» ----------
  private factHtml(): string {
    const g = this.h.game(); const tab = this.f.tab;
    const tabs = `<div class="tabs">${TABS.map(([k, n]) => `<button class="${tab === k ? 'on' : ''}" data-act="x-tab" data-tab="${k}">${n}${k === 'a' && g.x.rules.some(r => g.x.al[r.id]?.st === 2) ? ' ⚠' : ''}</button>`).join('')}</div>`;
    const body = tab === 'g' ? this.groupsHtml() : tab === 'a' ? this.alertsHtml() : tab === 'f' ? this.fieldsHtml() : tab === 'p' ? this.planHtml() : this.powerHtml();
    return `<div class="panel wide"><div class="title">Завод <span class="x" data-act="close">✕</span></div>${tabs}<div class="scroll" style="max-height:62vh">${body}</div></div>`;
  }
  private groupsHtml(): string {
    const g = this.h.game(); const gs = Object.values(g.x.groups);
    let b = `<div class="row2"><button data-act="x-gtool">▭ Выделить постройки рамкой</button><span class="small">Выбрано: <b>${this.sel.length}</b></span></div>`;
    b += `<div class="row2"><input id="xin-gnew" maxlength="60" placeholder="Название группы (до 60 знаков)" value="${esc(this.f.gnew)}"><input type="color" id="xin-gcolor" value="${esc(this.f.gcolor)}"><button data-act="x-gnew" ${this.sel.length && gs.length < MAX_GROUPS ? '' : 'disabled'}>Создать из выделения</button></div>`;
    b += `<div class="dim small">Групп: ${gs.length}/${MAX_GROUPS}. Постройка состоит не больше чем в одной группе; новые постройки рядом в группу сами не попадают. Удаление группы оставляет постройки на месте.</div>`;
    if (!gs.length) return b + '<div class="dim">Групп пока нет. Нажмите «Выделить постройки рамкой», протяните рамку по станции, задайте имя.</div>';
    const gl = this.q<{ id: number; n: number; w: number }[]>('groups', 'groups', 0) || [];
    b += '<div class="glist">' + gs.map(G => { const m = gl.find(q => q.id === G.id); return `<div class="grow ${this.gsel === G.id ? 'on' : ''}" data-act="x-gsel" data-g="${G.id}"><span class="gdot" style="background:${esc(G.color)}"></span><b>${esc(G.name)}</b> <span class="dim">${m ? `${m.n} построек · работает ${m.w}` : '…'}</span></div>`; }).join('') + '</div>';
    const G = this.gsel !== null ? g.x.groups[this.gsel] : null; if (!G) return b + '<div class="dim small">Выберите группу в списке.</div>';
    const R = this.q<{ info: GroupInfo; types: Record<string, number> }>('group:' + G.id, 'group', G.id); if (!R) return b + '<div class="dim small">Считаю…</div>';
    const I = R.info; const per = (w: number, k: 'p' | 'c') => Object.entries(I.rate[w][k]).sort((a, b2) => b2[1] - a[1]).slice(0, 6).map(([it, v]) => `${esc(iname(it))} ${n1(v / (I.rate[w].sec || 1) * 60)}/мин`).join(', ') || '—';
    const types = R.types;
    b += `<div class="lbl"><span class="gdot" style="background:${esc(G.color)}"></span>${esc(G.name)}</div>
      <div class="row2"><input id="xin-gname" maxlength="60" placeholder="Новое имя" value="${esc(this.f.gname)}"><button data-act="x-gren">Переименовать</button><button data-act="x-ghl">Показать на карте</button></div>
      <div class="row2"><button data-act="x-gadd" ${this.sel.length ? '' : 'disabled'}>+ Добавить выделенные (${this.sel.length})</button><button data-act="x-gmove" ${this.sel.length ? '' : 'disabled'} data-tip="Перенести выделенные из других групп сюда">Перенести из других</button><button data-act="x-grem" ${this.sel.length ? '' : 'disabled'}>− Исключить выделенные</button><button data-act="x-gdel" class="danger">Удалить группу</button></div>
      <div class="lbl">Приоритет питания группы</div><div class="row2">${[0, 1, 2].map(i => `<button class="${G.pr === i ? 'on' : ''}" data-act="x-gpri" data-pr="${i}">${PR_NAMES[i]}</button>`).join('')}<button class="${G.pr === undefined ? 'on' : ''}" data-act="x-gpri" data-pr="-1">Не задан</button></div>
      <div class="small">Состав: ${Object.entries(types).map(([k, v]) => `${esc(k)} ×${v}`).join(', ')}</div>
      <div class="small">Работают <b>${I.working}</b> · остановлены <b>${I.stopped}</b>${I.lost ? ` · потеряно за историю: ${I.lost}` : ''}</div>
      <div class="small">Электричество: потребление <b>${fmtKW(I.kwUse)}</b>, выработка <b>${fmtKW(I.kwGen)}</b>${I.mwHeat ? ` · тепло реакторов <b>${n1(I.mwHeat)} МВт</b> <span class="dim">(тепловые МВт не прибавляются к электрическим)</span>` : ''}</div>
      <div class="small">Выпуск за 1 мин: ${per(60, 'p')}<br>Выпуск за 5 мин: ${per(300, 'p')}<br>Расход за 1 мин: ${per(60, 'c')}<br>Расход за 5 мин: ${per(300, 'c')}${I.rate[300].sec < 60 ? '<br><span class="dim">данных ещё мало (история копится с загрузки)</span>' : ''}</div>
      <div class="small">Запасы: ${Object.entries(I.stock).sort((a, b2) => b2[1] - a[1]).slice(0, 8).map(([k, v]) => `${esc(iname(k))} ${Math.round(v)}`).join(', ') || '—'}${Object.keys(I.fluids).length ? '<br>Жидкости: ' + Object.entries(I.fluids).map(([k, v]) => `${esc(iname(k.replace(' (общая сеть)', '')))}${k.includes('общая') ? ' (общая сеть, не дублируется)' : ''} ${Math.round(v)}`).join(', ') : ''}</div>
      <div class="small">Отходы: <b>${I.waste}</b> · оценка работы топлива: <b>${I.fuelMin === null ? '—' : fmtMin(I.fuelMin)}</b></div>`;
    if (I.faults.length) b += `<div class="lbl">Неисправности</div>` + I.faults.slice(0, 12).map(f => `<div class="small"><span class="lnk" data-act="x-go" data-id="${f.id}">${esc(f.name)}</span> — ${esc(STATUS_TEXT[f.status] || f.status)} <span class="lnk" data-act="x-why" data-id="${f.id}">почему?</span></div>`).join('');
    return b;
  }
  private alertsHtml(): string {
    const g = this.h.game(); const X = g.x; const I = RULE_INFO[this.f.rkind as RuleKind] || RULE_INFO.fuel; const kind = (RULE_INFO[this.f.rkind as RuleKind] ? this.f.rkind : 'fuel') as RuleKind;
    const ownAck = new Set<number>(X.ack?.[g.pl] || []);
    const groups = Object.values(X.groups);
    const nets = this.q<{ id: number; demand: number; pole: { x: number; y: number } | null }[]>('alert-nets', 'nets', 0) || [];
    const fields = this.q<{ f: Forecast; id: number; res: string }[]>('alert-fields', 'fields', 0, 2000) || [];
    const opts: string[] = ['<option value="all">Весь завод</option>'];
    if (kind === 'bio-expiry') {
      const area = this.f.rtarget.startsWith('a:') ? this.f.rtarget : `a:${Math.floor(g.player.x)}:${Math.floor(g.player.y)}:32`;
      const [, x, y, radius] = area.split(':');
      opts.push(`<option value="${esc(area)}" ${this.f.rtarget === area ? 'selected' : ''}>Участок останков (${esc(x)}, ${esc(y)}), радиус ${esc(radius)}</option>`);
    }
    for (const G of groups) opts.push('<option value="g:' + G.id + '" ' + (this.f.rtarget === 'g:' + G.id ? 'selected' : '') + '>Группа: ' + esc(G.name) + '</option>');
    for (const id of this.sel.slice(0, 100)) { const e = g.ents.get(id); if (e) opts.push('<option value="e:' + id + '" ' + (this.f.rtarget === 'e:' + id ? 'selected' : '') + '>Объект: ' + esc(PROTOS[e.proto]?.name || e.proto) + ' #' + id + '</option>'); }
    if (kind === 'power') for (const n of nets) opts.push('<option value="n:' + n.id + '" ' + (this.f.rtarget === 'n:' + n.id ? 'selected' : '') + '>Электросеть' + (n.pole ? ' у (' + n.pole.x + ', ' + n.pole.y + ')' : ' #' + n.id) + '</option>');
    if (kind === 'field') for (const field of fields) opts.push('<option value="f:' + esc(field.f.key) + '" ' + (this.f.rtarget === 'f:' + field.f.key ? 'selected' : '') + '>Поле: ' + esc(iname(field.res)) + ' (' + esc(field.f.key) + ')</option>');
    if (kind === 'train') for (const train of g.trains) opts.push('<option value="t:' + train.id + '" ' + (this.f.rtarget === 't:' + train.id ? 'selected' : '') + '>Поезд #' + train.id + ' · ' + esc(train.st) + '</option>');
    let b = '';
    for (const rule of X.rules) if (rule.kind === 'bio-expiry' && rule.target.t === 'bioArea') b += `<button data-act="x-bio-area" data-r="${rule.id}">Показать участок останков (${rule.target.x}, ${rule.target.y})</button>`;
    const ST = ['норма', 'ожидание устойчивого нарушения', '<b class="err">АКТИВНО</b>', 'восстановлено'];
    b += X.rules.length ? X.rules.map(r => { const a = X.al[r.id]; const ack = a?.st === 2 && ownAck.has(a.ev); const v = a?.val === null || a === undefined ? '<span class="dim">прогноз ещё не рассчитан</span>' : 'значение ' + n1(a.val) + (RULE_INFO[r.kind].unit ? ' ' + RULE_INFO[r.kind].unit : '');
      return '<div class="rrow ' + (a?.st === 2 ? 'bad' : '') + '"><div><b>' + esc(ruleText(g, r)) + '</b> ' + (r.on ? '' : '<span class="dim">(выкл.)</span>') + '</div><div class="small">' + ST[a?.st ?? 0] + (a?.n ? ' · объектов: ' + a.n : '') + ' · ' + v + ' · повтор ' + (r.rem ? r.rem + ' с' : 'нет') + ' · восстановление при ' + n1(r.hy) + (RULE_INFO[r.kind].unit ? ' ' + RULE_INFO[r.kind].unit : '') + '</div><div class="row2">' + (a?.st === 2 && !ack ? '<button data-act="x-ack" data-ev="' + a.ev + '">Подтвердить</button>' : '') + (a?.n && a.ids.length && r.kind !== 'power' && r.kind !== 'train' && r.kind !== 'bio-expiry' ? '<button data-act="x-ids" data-r="' + r.id + '">Показать на карте</button>' : '') + '<button data-act="x-ron" data-r="' + r.id + '" data-on="' + (r.on ? 0 : 1) + '">' + (r.on ? 'Выключить' : 'Включить') + '</button><button data-act="x-rdel" data-r="' + r.id + '" class="danger">Удалить</button></div></div>'; }).join('') : '<div class="dim">Правил нет. Добавьте правило ниже — условия только из списка, произвольные выражения не выполняются.</div>';
    b += '<div class="lbl">Новое правило (' + X.rules.length + '/' + MAX_RULES + ')</div><div class="row2"><select id="xin-rkind">' + (Object.keys(RULE_INFO) as RuleKind[]).map(k => '<option value="' + k + '" ' + (k === kind ? 'selected' : '') + '>' + esc(RULE_INFO[k].name) + '</option>').join('') + '</select><select id="xin-rtarget">' + opts.join('') + '</select></div>';
    b += '<div class="row2">' + (I.hasThr ? '<label class="small">Порог, ' + I.unit + '<input id="xin-rthr" type="number" step="any" style="width:80px" value="' + esc(this.f.rthr || String(I.thr)) + '"></label>' : '') + '<label class="small">Длительность, с<input id="xin-rdur" type="number" min="0" style="width:80px" value="' + esc(this.f.rdur || String(I.dur)) + '"></label><label class="small">Напоминать, с<input id="xin-rrem" type="number" min="0" style="width:80px" value="' + esc(this.f.rrem) + '"></label><button data-act="x-radd" ' + (X.rules.length >= MAX_RULES ? 'disabled' : '') + '>Добавить правило</button></div>';
    b += '<div class="dim small">Гистерезис задаётся автоматически (например, тревога ниже 10 мин, восстановление выше 12 мин). Звук и подтверждение — личная настройка игрока; правила и активные тревоги общие для мира.</div>';
    if (X.ev.length) b += '<div class="lbl">Последние события</div>' + X.ev.slice(-8).reverse().map(e => '<div class="small dim">тик ' + e.tick + ' · ' + (e.kind === 'off' ? '✔' : e.kind === 'rem' ? '⏰' : '⚠') + ' ' + esc(e.text) + '</div>').join('');
    return b;
  }
  private fieldsHtml(): string {
    const L = this.q<{ f: Forecast; id: number; res: string }[]>('fields', 'fields', 0, 2000);
    if (!L) return '<div class="dim">Считаю…</div>'; if (!L.length) return '<div class="dim">Добывающих машин на месторождениях пока нет.</div>';
    let b = '<div class="dim small">Остаток — только открытая часть поля; неизвестные клетки не раскрываются. Скорость — реальное уменьшение запаса по окну наблюдения. Для нефти показывается наблюдаемый дебит, без фиктивного срока истощения.</div>';
    for (const { f, id, res } of L) {
      const t = f.oil ? (f.state === 'collect' ? 'собираются данные (' + Math.round(f.secs) + ' из 60 с)' : f.state === 'stopped' ? 'добыча остановлена' : 'наблюдаемый дебит ≈ ' + n1(f.ratePerMin) + ' ед/мин (окно ' + Math.round(f.secs) + ' с)') : (f.state === 'collect' ? 'собираются данные (' + Math.round(f.secs) + ' из 60 с)' : f.state === 'stopped' ? 'добыча остановлена' : '≈ ' + fmtMin(f.minutes) + ' при ' + n1(f.ratePerMin) + ' ед/мин (окно ' + Math.round(f.secs) + ' с, предварительно)');
      const remain = f.oil ? '' : ' · остаток <b>' + Math.round(f.remain) + '</b>';
      const count = f.oil ? 'нефтяных скважин' : 'буров на поле';
      b += '<div class="rrow"><div><b>' + esc(iname(res)) + '</b> · ' + count + ': ' + f.drills + remain + (f.open && !f.oil ? ' <span class="warn" data-tip="Поле продолжается в неизвестную область; оценка изменится после раскрытия">(раскрыто не всё)</span>' : '') + '</div><div class="small">Время работы: ' + t + '</div><div class="row2"><button data-act="x-go" data-id="' + id + '">Показать на карте</button></div></div>';
    }
    return b;
  }
  private planInput(g: Game): PlanInput {
    const abs = this.f.pmode !== 'pct'; const rate = Number(this.f.prate) || 0;
    const x = this.f.px.trim() ? Number(this.f.px) : Math.floor(g.player.x) + 4;
    const y = this.f.py.trim() ? Number(this.f.py) : Math.floor(g.player.y) + 4;
    const options: any = {
      asm: Number(this.f.pasm) || 2, furnace: this.f.pfurnace, drill: Number(this.f.pdrill) || 1,
      mods: this.f.pmods, modTier: Number(this.f.pmodTier) || 1, beacons: Number(this.f.pbeacons) || 0,
      beaconTier: Number(this.f.pbeaconTier) || 1,
      routeDistance: this.f.pdistance.trim() ? Number(this.f.pdistance) : undefined,
      routeCycleSeconds: this.f.pcycle.trim() ? Number(this.f.pcycle) : undefined
    };
    if (!abs && this.f.pgroup) options.groupId = Number(this.f.pgroup);
    return { item: this.f.pitem, perMin: abs ? rate : 0, pct: abs ? undefined : rate, x, y, options };
  }
  private planHtml(): string {
    const g = this.h.game(); const f = this.f; const abs = f.pmode !== 'pct';
    const items = [...new Set(Object.values(RECIPES).filter(r => r.cat !== 'rocket' && r.out.length > 0).map(r => r.out[0][0]))].filter(i => ITEMS[i] && !ITEMS[i].virtual && !ITEMS[i].fluid).sort((a, b2) => iname(a).localeCompare(iname(b2), 'ru'));
    if (!items.includes(f.pitem)) f.pitem = items[0];
    const input = this.planInput(g); const key = JSON.stringify(input);
    const calcKey = JSON.stringify([input.item, input.perMin, input.pct, input.options]);
    const res = this.q<PlanResult | null>('plan:' + calcKey, 'plan', { item: input.item, perMin: input.perMin, pct: input.pct, options: input.options }, 2000);
    let b = '<div class="row2"><select id="xin-pitem">' + items.map(i => '<option value="' + i + '" ' + (i === f.pitem ? 'selected' : '') + '>' + esc(iname(i)) + '</option>').join('') + '</select>';
    b += '<select id="xin-pmode"><option value="abs" ' + (abs ? 'selected' : '') + '>цель, шт/мин</option><option value="pct" ' + (!abs ? 'selected' : '') + '>увеличить выпуск группы на %</option></select>';
    b += '<input id="xin-prate" type="number" min="0" step="any" style="width:90px" value="' + esc(f.prate) + '"></div>';
    if (!abs) b += '<div class="row2"><label class="small">Группа для сравнения<select id="xin-pgroup"><option value="">Весь завод</option>' + Object.values(g.x.groups).map(G => '<option value="' + G.id + '" ' + (f.pgroup === String(G.id) ? 'selected' : '') + '>' + esc(G.name) + '</option>').join('') + '</select></label></div>';
    b += '<div class="lbl">Настройки расчёта</div><div class="row2">';
    b += '<label class="small">Сборщик<select id="xin-pasm">' + [1, 2, 3, 4].map(n => '<option value="' + n + '" ' + (f.pasm === String(n) ? 'selected' : '') + '>' + n + '</option>').join('') + '</select></label>';
    b += '<label class="small">Печь<select id="xin-pfurnace">' + [['stone-furnace', 'Каменная печь'], ['steel-furnace', 'Стальная печь'], ['electric-furnace', 'Электропечь']].map(([id, label]) => '<option value="' + id + '" ' + (f.pfurnace === id ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
    b += '<label class="small">Электробур<select id="xin-pdrill">' + [1, 2, 3].map(n => '<option value="' + n + '" ' + (f.pdrill === String(n) ? 'selected' : '') + '>' + n + '</option>').join('') + '</select></label>';
    b += '<label class="small">Модуль<select id="xin-pmods">' + [['none', 'Нет'], ['speed', 'Скорости'], ['prod', 'Продуктивности'], ['eff', 'Эффективности']].map(([id, label]) => '<option value="' + id + '" ' + (f.pmods === id ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>';
    b += '<label class="small">Уровень модуля<select id="xin-pmodTier">' + [1, 2, 3].map(n => '<option value="' + n + '" ' + (f.pmodTier === String(n) ? 'selected' : '') + '>' + n + '</option>').join('') + '</select></label></div>';
    b += '<div class="row2"><label class="small">Маяков на машину<input id="xin-pbeacons" type="number" min="0" max="64" value="' + esc(f.pbeacons) + '"></label><label class="small">Уровень модулей маяка<select id="xin-pbeaconTier">' + [1, 2, 3].map(n => '<option value="' + n + '" ' + (f.pbeaconTier === String(n) ? 'selected' : '') + '>' + n + '</option>').join('') + '</select></label><label class="small">Расстояние маршрута<input id="xin-pdistance" type="number" min="0" step="any" placeholder="не задано" value="' + esc(f.pdistance) + '"></label><label class="small">Цикл маршрута, с<input id="xin-pcycle" type="number" min="1" step="any" placeholder="не задан" value="' + esc(f.pcycle) + '"></label></div>';
    b += '<div class="lbl">Место схемы (координаты на карте)</div><div class="row2"><label class="small">X<input id="xin-px" type="number" step="1" value="' + esc(String(input.x)) + '"></label><label class="small">Y<input id="xin-py" type="number" step="1" value="' + esc(String(input.y)) + '"></label><button data-act="x-planpreview">Подготовить схему</button></div>';
    if (!res) b += '<div class="dim">Для расчёта укажите положительную цель. Для процента нужен наблюдаемый выпуск за группу или завод.</div>';
    else {
      b += '<div class="small">Фактически: <b>' + n1(res.actual) + '</b>/мин · расчётная мощность установленной линии: <b>' + n1(res.installedPerMin) + '</b>/мин · цель выпуска: <b>' + n1(res.target) + '</b>/мин' + (res.groupId !== undefined ? ' · группа: ' + esc(g.x.groups[res.groupId]?.name || String(res.groupId)) : '') + ' <span class="dim">(сырьевой дефицит не считается нехваткой машин)</span></div>';
      b += '<table class="tbl"><tr><th>Предмет</th><th>Нужно/мин</th><th>Машина</th><th>Установлено</th><th>Добавить</th><th>Выходы цикла</th></tr>' + res.rows.map(r => '<tr><td>' + esc(iname(r.item)) + '</td><td>' + n1(r.perMin) + '</td><td>' + esc(PROTOS[r.machine]?.name || r.machine) + (!r.placeable ? ' <span class="dim small">(ручное размещение на месторождении)</span>' : '') + '</td><td>' + n1(r.installed) + '/мин' + (r.stalled ? ' <span class="warn">(простой: ' + r.stalled + ')</span>' : '') + '</td><td><b>' + r.add + '</b></td><td>' + r.outputs.map(([it, n]) => esc(iname(it)) + ' ×' + n1(n)).join(', ') + '</td></tr>').join('') + '</table>';
      b += '<div class="small">Входное сырьё: ' + res.raw.map(([k, v]) => esc(iname(k)) + ' ' + n1(v) + '/мин').join(', ') + '</div><div class="small">Мощность: <b>' + fmtKW(res.kW) + '</b> · жёлтые ленты: ~' + res.belts + ' · манипуляторы: ~' + res.inserters + '</div>';
      b += '<div class="small">Маршрут: ' + (res.logistics.distance === null ? 'расстояние не задано' : n1(res.logistics.distance) + ' клеток') + ' · цикл: ' + (res.logistics.cycleSeconds === null ? 'не задан' : n1(res.logistics.cycleSeconds) + ' с') + ' · роботы: ' + (res.logistics.robots === null ? '—' : res.logistics.robots) + ' · поезда: ' + (res.logistics.trains === null ? '—' : res.logistics.trains) + ' (предварительная оценка по сырью)</div>';
      b += res.notes.map(n => '<div class="small dim">• ' + esc(n) + '</div>').join('');
    }
    let preview: PlanPreview | null = null;
    if (this.preparedPlanKey === key) preview = this.q<PlanPreview | null>('plan-preview:' + key, 'planPreview', input, 30000);
    if (this.preparedPlanKey === key && !preview) b += '<div class="dim">Подготавливаю превью схемы…</div>';
    if (preview) {
      b += '<div class="lbl">Превью размещения: ' + preview.placements.length + (preview.truncated ? '+' : '') + ' машин · конфликтов: ' + preview.blocked + '</div>';
      b += '<div class="small">Материалы (свободно после резервов призраков; материалы очереди крафта уже сняты из инвентаря): ' + (preview.materials.map(m => esc(iname(m.item)) + ' ' + m.need + ' / свободно ' + m.free + (m.shortage ? ' <span class="err">не хватает ' + m.shortage + '</span>' : '') + (m.craftReserved ? ' · ручной резерв ' + m.craftReserved : '') + (m.manual ? ' · вручную установить: ' + m.manual : '')).join(', ') || 'не требуются') + '</div>';
      b += '<div class="small">Геометрия размещения (первые ' + Math.min(24, preview.placements.length) + '):</div>' + preview.placements.slice(0, 24).map(p => '<div class="small ' + (p.ok ? 'dim' : 'err') + '">' + (p.ok ? '✓ ' : '⚠ ') + esc(PROTOS[p.machine]?.name || p.machine) + (p.recipe ? ' · ' + esc(RECIPES[p.recipe]?.name || p.recipe) : '') + ' · (' + p.x + ', ' + p.y + ') ' + p.w + '×' + p.h + (p.reason ? ' — ' + esc(p.reason) : '') + '</div>').join('');
      b += preview.notes.map(n => '<div class="small dim">• ' + esc(n) + '</div>').join('');
      if (preview.canAccept) b += '<div class="row2"><button data-act="x-planghost">Принять схему и поставить призраки (' + preview.placements.length + ')</button></div>';
      else b += '<div class="dim small">Исправьте место или исследуйте недостающие машины, затем подготовьте схему снова.</div>';
    }
    const actions = g.x.plans || [];
    if (actions.length) b += '<div class="lbl">Принятые планы</div>' + actions.map(p => '<div class="row2"><span class="small">' + esc(iname(p.item)) + ' · ' + p.ids.length + ' призраков · игрок ' + (p.by + 1) + '</span>' + (p.by === g.pl ? '<button data-act="x-planundo" data-id="' + p.id + '">Отменить этот план</button>' : '') + '</div>').join('');
    else if (g.x.plan) b += '<div class="row2"><span class="small">Старый план · ' + g.x.plan.ids.length + ' призраков</span>' + (g.peers.length <= 1 ? '<button data-act="x-planundo">Отменить план</button>' : '') + '</div>';
    return b;
  }  private powerHtml(): string {
    const nets = this.q<{ id: number; demand: number; supply: number; sat: number; sl?: number[]; dl?: number[]; pole: { id: number; x: number; y: number } | null }[]>('nets', 'nets', 0) || [];
    let b = `<div class="row2"><button data-act="x-pprof" data-tip="Насосы, оборона, комбинаторы и выбранные постройки — критический уровень">Профиль «Сохранить работу станции и обороны»</button></div><div class="dim small">При дефиците: сначала критический уровень, затем обычный, затем второстепенный; внутри уровня — пропорционально запросу. Уровень задаётся в окне машины или группы.</div>`;
    if (!nets.length) return b + '<div class="dim">Электросетей с нагрузкой нет.</div>';
    for (const n of nets) { const p = n.pole; b += `<div class="rrow"><div><b>Сеть ${p ? `у (${p.x}, ${p.y})` : n.id}</b> · спрос ${fmtKW(n.demand)} · доступно ${fmtKW(n.supply)} · удовлетворение <b>${Math.round(n.sat * 100)}%</b></div>${n.sl && n.dl ? ['Критический', 'Обычный', 'Второстепенный'].map((nm, i) => `<div class="small">${nm}: спрос ${fmtKW(n.dl![i])} → выдача ${fmtKW(n.dl![i] * n.sl![i])}${n.dl![i] > 0 && n.sl![i] <= 0 ? ' <span class="err">отключён приоритетом</span>' : n.sl![i] < 1 ? ' <span class="warn">неполное питание</span>' : ''}</div>`).join('') : '<div class="small dim">приоритеты не заданы — прежнее общее распределение</div>'}${p ? `<div class="row2"><button data-act="x-go" data-id="${p.id}">Показать</button></div>` : ''}</div>`; }
    return b;
  }
  // ---------- действия ----------
  act(a: string, el: HTMLElement): boolean {
    const g = this.h.game(); const D = el.dataset; const id = +(D.id || -1);
    const send = (c: any) => { g.enqueue({ t: 'x', ...c }); setTimeout(() => this.h.render(), 120); };
    switch (a) {
      case 'x-con': this.run(); return true;
      case 'x-tab': this.f.tab = D.tab || 'g'; this.h.render(); return true;
      case 'x-pri': send({ op: 'epri', ids: [id], pr: +D.pr! }); return true;
      case 'x-why': { this.diagId = id; this.cache.delete('diag:' + id); if (g.ents.get(id) && this.h.open() === 'fact') this.h.openEnt?.(id); else this.h.render(); return true; }
      case 'x-go': {
        const e = g.ents.get(id);
        if (!Number.isSafeInteger(id) || id < 0 || !e || !this.knownEntity(e)) return true;
        this.h.query('ids', [id]).then(r => { const current = g.ents.get(id); if (current && this.knownEntity(current) && Array.isArray(r)) this.h.hl?.(r); });
        if (this.h.open() === 'ent') this.h.close();
        this.h.openEnt?.(id); return true;
      }
      case 'x-gtool': this.h.tool?.('group'); this.h.close(); return true;
      case 'x-gnew': { const name = this.f.gnew.trim(); if (!name || !this.sel.length) return true; send({ op: 'gnew', name, color: this.f.gcolor, ids: this.sel }); this.f.gnew = ''; this.sel = []; setTimeout(() => { const ids = Object.keys(g.x.groups).map(Number); this.gsel = ids.length ? Math.max(...ids) : null; this.h.render(); }, 200); return true; }
      case 'x-gsel': this.gsel = +D.g!; this.h.render(); return true;
      case 'x-gren': if (this.gsel !== null && this.f.gname.trim()) { send({ op: 'gren', gid: this.gsel, name: this.f.gname }); this.f.gname = ''; } return true;
      case 'x-gadd': case 'x-gmove': if (this.gsel !== null) send({ op: 'gadd', gid: this.gsel, ids: this.sel, move: a === 'x-gmove' }); return true;
      case 'x-grem': send({ op: 'grem', ids: this.sel }); return true;
      case 'x-gdel': if (this.gsel !== null) { send({ op: 'gdel', gid: this.gsel }); this.gsel = null; } return true;
      case 'x-gpri': if (this.gsel !== null) send({ op: 'gpri', gid: this.gsel, pr: +D.pr! }); return true;
      case 'x-ghl': if (this.gsel !== null) { const R = this.q<any>('group:' + this.gsel, 'group', this.gsel); if (R) this.h.hl?.(R.rects); } return true;
      case 'x-ack': send({ op: 'ack', ev: +D.ev! }); return true;
      case 'x-ron': send({ op: 'ruleon', id: +D.r!, on: D.on === '1' }); return true;
      case 'x-rdel': send({ op: 'ruledel', id: +D.r! }); return true;
      case 'x-ids': { const al = g.x.al[+D.r!]; this.h.query('ids', al?.ids || []).then(r => this.h.hl?.(r)); return true; }
      case 'x-bio-area': { const target = g.x.rules.find(r => r.id === +D.r!)?.target; if (target?.t === 'bioArea') { const area = { x: target.x - target.radius, y: target.y - target.radius, w: target.radius * 2, h: target.radius * 2 }; this.h.hl?.([area]); this.h.mapArea?.(area); } return true; }
      case 'x-radd': {
        const kind = (RULE_INFO[this.f.rkind as RuleKind] ? this.f.rkind : 'fuel') as RuleKind; const I = RULE_INFO[kind]; const thr = I.hasThr ? +(this.f.rthr || I.thr) : 0;
        const hy = kind === 'waste' ? Math.max(0, thr - 20) : kind === 'power' ? Math.min(100, thr + 8) : thr * 1.2;
        const target = this.f.rtarget; let t: any = { t: 'all' };
        if (target.startsWith('g:')) t = { t: 'group', id: +target.slice(2) };
        else if (target.startsWith('e:')) t = { t: 'ent', id: +target.slice(2) };
        else if (target.startsWith('n:')) t = { t: 'powerNet', id: +target.slice(2) };
        else if (target.startsWith('f:')) t = { t: 'field', key: target.slice(2) };
        else if (target.startsWith('t:')) t = { t: 'train', id: +target.slice(2) };
        else if (kind === 'bio-expiry' && target.startsWith('a:')) { const [, x, y, radius] = target.split(':'); t = { t: 'bioArea', x: +x, y: +y, radius: +radius }; }
        send({ op: 'rule', rule: { kind, target: t, thr, hy, dur: +(this.f.rdur || I.dur), rem: +this.f.rrem || 0 } }); return true;
      }
      case 'x-planpreview': { const input = this.planInput(g); const key = JSON.stringify(input); this.preparedPlanKey = key; this.cache.delete('plan-preview:' + key); this.h.render(); return true; }
      case 'x-planghost': { const input = this.planInput(g); const key = JSON.stringify(input); const preview = this.q<PlanPreview | null>('plan-preview:' + key, 'planPreview', input, 30000); if (this.preparedPlanKey !== key || !preview?.canAccept) return true; this.preparedPlanKey = null; send({ op: 'plan', item: input.item, perMin: input.perMin, pct: input.pct, x: input.x, y: input.y, options: input.options }); return true; }
      case 'x-planundo': send({ op: 'planundo', id: D.id === undefined ? undefined : +D.id }); return true;
      case 'x-pprof': send({ op: 'pprof', ids: this.sel }); return true;
    }
    return false;
  }
  run() {
    const inp = document.getElementById('xcon-in') as HTMLInputElement | null; const line = (inp?.value || '').slice(0, 256); if (!line.trim()) return;
    this.hist.push(line); if (this.hist.length > 50) this.hist.shift(); this.hi = -1; this.log.push('> ' + line); if (this.log.length > 50) this.log.shift();
    this.h.game().enqueue({ t: 'x', op: 'con', line }); if (inp) inp.value = ''; setTimeout(() => this.h.render(), 120);
  }
  /** клавиши в поле консоли; true — обработано */
  key(ev: KeyboardEvent): boolean {
    const t = ev.target as HTMLElement; if (t.id.startsWith('xin-')) { ev.stopPropagation(); if (ev.key === 'Escape') { ev.preventDefault(); this.h.close(); } return true; }
    if (t.id !== 'xcon-in') return false;
    const inp = t as HTMLInputElement; ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); this.run(); return true; }
    if (ev.key === 'Escape') { ev.preventDefault(); this.h.close(); return true; }
    if (ev.key === 'ArrowUp' && this.hist.length) { ev.preventDefault(); this.hi = this.hi < 0 ? this.hist.length - 1 : Math.max(0, this.hi - 1); inp.value = this.hist[this.hi]; return true; }
    if (ev.key === 'ArrowDown' && this.hi >= 0) { ev.preventDefault(); this.hi++; inp.value = this.hi >= this.hist.length ? '' : this.hist[this.hi]; if (this.hi >= this.hist.length) this.hi = -1; return true; }
    return true;
  }
}

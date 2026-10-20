import type { Game } from '../sim/game';
import { bioCommandLinks, previewBioRoute, type BioRoutePreview } from '../sim/v117Systems';
import { tr } from '../core/i18n';

type Point = { x: number; y: number };
interface Draft { formId: number; owner: string; mode: 'move' | 'patrol'; squad?: string; points: Point[]; combat: boolean; patrolMode: 'loop' | 'pingpong'; }
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Local bounded map work. Only explicit confirmation sends an authoritative order. */
export class BioRoutePlanner {
  draft: Draft | null = null;
  private source: Game | null = null;
  private sourceWorld: Game['world'] | null = null;
  private seq = 0;
  private version = 0;
  private job: Generator<void, void, void> | null = null;
  private preview: BioRoutePreview | null = null;
  private nextNotice = 0;
  private nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
  constructor(private game: () => Game, private changed: () => void = () => {}) {}
  begin(formId: number, mode: 'move' | 'patrol', squad?: string) {
    const g = this.game(), f = g.v117.genetics.forms.find(f => f.id === formId && !f.dead && f.owner === g.v117.playerIds[g.pl]);
    if (!f || squad && f.squad !== squad) return false;
    this.cancel(); this.source = g; this.sourceWorld = g.world;
    this.draft = { formId, owner: f.owner, mode, ...(squad ? { squad } : {}), points: [], combat: f.order.combat, patrolMode: f.order.patrolMode || 'loop' }; return true;
  }
  cancel() { this.version++; this.job = null; this.preview = null; this.draft = null; this.source = null; this.sourceWorld = null; }
  private live() {
    const g = this.game(), d = this.draft;
    if (!d || this.source !== g || this.sourceWorld !== g.world || g.v117.playerIds[g.pl] !== d.owner || !g.v117.genetics.forms.some(f => f.id === d.formId && !f.dead && f.owner === d.owner && (!d.squad || f.squad === d.squad))) { this.cancel(); return null; }
    return d;
  }
  private recalculate() {
    this.version++; this.job = null; this.preview = null;
    const d = this.live(); if (!d || !d.points.length) return;
    this.preview = { lines: [], seconds: 0, members: 0, completed: 0, total: 0, problem: '', done: false };
    this.job = previewBioRoute(this.game(), d.formId, d.squad, d.points.map(p => ({ ...p })), d.mode, d.patrolMode, this.preview);
  }
  private pump() {
    if (!this.live() || !this.job) return;
    const until = performance.now() + 3;
    for (let i = 0; i < 4; i++) {
      if (this.job.next().done) { this.job = null; break; }
      if (performance.now() >= until) break;
    }
    const now = performance.now();
    if (!this.job || now >= this.nextNotice) {
      this.nextNotice = now + 250; const version = this.version;
      queueMicrotask(() => { if (version === this.version && this.draft) this.changed(); });
    }
  }
  tick() { this.pump(); }
  private linked(d: Draft) {
    const g = this.game(), links = bioCommandLinks(g);
    return links.has(d.formId) && (!d.squad || g.v117.genetics.forms.filter(f => !f.dead && f.owner === d.owner && f.squad === d.squad).every(f => links.has(f.id)));
  }
  add(x: number, y: number) {
    const d = this.live(); if (!d || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const p = { x: Math.floor(x), y: Math.floor(y) }; if (Math.abs(p.x) > 65536 || Math.abs(p.y) > 65536) return;
    if (d.mode === 'move') d.points = [p]; else if (d.points.length < 16) d.points.push(p);
    this.recalculate();
  }
  html() {
    const d = this.live(); if (!d) return '';
    const p = this.preview, linked = this.linked(d), valid = linked && (d.mode === 'move' ? d.points.length === 1 : d.points.length >= 2) && !!p?.done && !p.problem;
    const progress = !linked ? tr('Нет связи с пультом') : !p ? tr('Добавьте точки маршрута') : !p.done ? `${tr('Расчёт обходов')}… ${p.completed}/${p.total}` : p.problem ? tr(p.problem) : `${tr('Время движения отряда')}: ≈ ${p.seconds} ${tr('с')} · ${p.members} ${tr('биоформ')}`;
    return `<div class="lab bio-route"><b>${esc(tr(d.mode === 'move' ? 'Движение биоотряда' : 'Маршрут патруля'))} #${d.formId}</b><p class="small">${esc(tr('Щёлкайте по разведанной карте. До подтверждения приказ не отправляется.'))}</p><div class="row2"><button data-act="bio-route-combat">${esc(tr('Бой'))}: ${esc(tr(d.combat ? 'вкл.' : 'выкл.'))}</button>${d.mode === 'patrol' ? `<button data-act="bio-route-loop">${esc(tr(d.patrolMode === 'loop' ? 'Замкнутый круг' : 'Туда-обратно'))}</button>` : ''}<button data-act="bio-route-undo">${esc(tr('Убрать последнюю точку'))}</button><button data-act="bio-route-recalculate">${esc(tr('Пересчитать путь'))}</button><button data-act="bio-route-confirm"${!valid ? ' disabled' : ''}>${esc(tr('Подтвердить маршрут'))}</button><button data-act="bio-route-cancel">${esc(tr('Отмена'))}</button></div><div class="small">${d.points.length}/${d.mode === 'move' ? 1 : 16} · ${esc(progress)}</div><p class="dim small">${esc(tr('Оценка по текущей карте: без боя, снабжения и ожидания других отрядов. Перед отправкой точки проверяются снова.'))}</p>${d.points.map((q, i) => `<span class="small">${i + 1}: ${q.x}, ${q.y}</span>`).join(' · ')}</div>`;
  }
  action(a: string) {
    if (!a.startsWith('bio-route-')) return false;
    const d = this.live(); if (!d) return true;
    if (a === 'bio-route-cancel') this.cancel();
    else if (a === 'bio-route-undo') { d.points.pop(); this.recalculate(); }
    else if (a === 'bio-route-recalculate') this.recalculate();
    else if (a === 'bio-route-combat') d.combat = !d.combat;
    else if (a === 'bio-route-loop') { d.patrolMode = d.patrolMode === 'loop' ? 'pingpong' : 'loop'; this.recalculate(); }
    else if (a === 'bio-route-confirm') {
      const valid = d.mode === 'move' ? d.points.length === 1 : d.points.length >= 2 && d.points.length <= 16;
      if (valid && this.linked(d) && this.preview?.done && !this.preview.problem) {
        this.game().enqueue({ t: 'v117', section: 'genetics', op: 'order', opId: `bio-map-${this.nonce}-${++this.seq}`, formId: d.formId, ...(d.squad ? { squad: d.squad } : {}), mode: d.mode, points: d.points.map(p => ({ ...p })), combat: d.combat, ...(d.mode === 'patrol' ? { patrolMode: d.patrolMode } : {}) }); this.cancel();
      }
    }
    return true;
  }
  draw(canvas: HTMLCanvasElement, cx: number, cy: number, tpp: number) {
    const d = this.live(), c = canvas.getContext('2d'); if (!d || !c) return;
    c.save(); c.lineWidth = 2; c.font = 'bold 12px sans-serif'; c.textAlign = 'center';
    const point = (p: Point, center = false) => [canvas.width / 2 + (p.x + (center ? .5 : 0) - cx) / tpp, canvas.height / 2 + (p.y + (center ? .5 : 0) - cy) / tpp];
    c.setLineDash([4, 4]); c.strokeStyle = '#819aa3'; c.beginPath();
    d.points.forEach((p, i) => { const [x, y] = point(p, true); if (!i) c.moveTo(x, y); else c.lineTo(x, y); });
    if (d.mode === 'patrol' && d.patrolMode === 'loop' && d.points.length > 2) c.closePath(); c.stroke(); c.setLineDash([]);
    for (const line of this.preview?.lines || []) {
      c.strokeStyle = line.problem ? '#ff6262' : '#4bdbff'; c.globalAlpha = .7; c.beginPath();
      line.points.forEach((p, i) => { const [x, y] = point(p); if (!i) c.moveTo(x, y); else c.lineTo(x, y); }); c.stroke();
    }
    c.globalAlpha = 1;
    d.points.forEach((p, i) => { const [x, y] = point(p, true); c.fillStyle = this.preview?.lines.some(line => line.problem && line.segment === i) ? '#e64f4f' : '#1b6478'; c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.fillText(String(i + 1), x, y + 4); }); c.restore();
  }
}


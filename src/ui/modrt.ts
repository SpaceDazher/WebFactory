// v1.11: интерфейс скриптов модов в главном потоке — консоль модов (Ctrl+`), окна модов из готовых элементов
// (текст, кнопка, список, поле ввода, ряд) в стиле окон игры, замеры «мс/тик» для менеджера модов.
// Нажатия уходят в симуляцию командой modgui (в совместной игре — всем игрокам), скрипт получает on_gui_click / on_gui_input.
import type { ConsoleLine, ModStat } from '../mods/script';
import { morph } from './morph';
import { tr } from '../core/i18n';

const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export interface GuiEl { type: 'text' | 'button' | 'list' | 'input' | 'row'; id?: string; text?: string; items?: string[]; value?: string; placeholder?: string; children?: GuiEl[]; style?: string }
interface Gui { mod: string; title: string; id: string; spec: { title: string; elements: GuiEl[] } }
export class ModRuntime {
  lines: ConsoleLine[] = []; stats: ModStat[] = []; guis = new Map<string, Gui>(); filter = ''; unread = 0; ver = 0;
  private el: HTMLElement;
  constructor(private send: (c: any) => void, private onChange: () => void) {
    this.el = document.createElement('div'); this.el.id = 'modgui'; document.body.appendChild(this.el);
    this.el.addEventListener('click', ev => {
      const t = (ev.target as HTMLElement).closest('[data-mg]') as HTMLElement | null; if (!t) return;
      const g = this.guis.get(t.dataset.mg!); if (!g) return; const kind = t.dataset.k;
      if (kind === 'close') { this.guis.delete(t.dataset.mg!); this.send({ t: 'modgui', mod: g.mod, gui: g.id, el: '__close', kind: 'click' }); this.render(); return; }
      if (kind === 'btn') this.send({ t: 'modgui', mod: g.mod, gui: g.id, el: t.dataset.el, kind: 'click' });
      if (kind === 'li') this.send({ t: 'modgui', mod: g.mod, gui: g.id, el: t.dataset.el, kind: 'click', value: t.dataset.i });
    });
    this.el.addEventListener('change', ev => {
      const t = ev.target as HTMLInputElement; if (!t.dataset?.mg) return; const g = this.guis.get(t.dataset.mg); if (!g) return;
      this.send({ t: 'modgui', mod: g.mod, gui: g.id, el: t.dataset.el, kind: 'input', value: t.value.slice(0, 500) });
    });
    this.el.addEventListener('keydown', ev => ev.stopPropagation()); // ввод в поле не управляет инженером
  }
  /** сообщения хоста скриптов (из Worker симуляции или главного потока) */
  onMsg(m: any, me = 0) {
    if (m.t === 'modcon') { this.lines.push(m.l); if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500); if (m.l.level === 'error') this.unread++; this.ver++; this.onChange(); }
    else if (m.t === 'modstat') { this.stats = m.s; }
    else if (m.t === 'modgui') {
      const op = m.op; if (op.pl != null && op.pl >= 0 && op.pl !== me) return; const k = m.mod + ':' + op.id;
      if (op.op === 'guiclose') this.guis.delete(k); else this.guis.set(k, { mod: m.mod, title: m.title, id: op.id, spec: op.spec });
      this.render();
    }
  }
  reset() { this.guis.clear(); this.render(); }
  private elHtml(k: string, e: GuiEl): string {
    const cls = e.style ? ` class="${e.style === 'ok' ? 'ok' : e.style === 'err' ? 'err' : 'dim'}"` : '';
    switch (e.type) {
      case 'button': return `<button data-mg="${esc(k)}" data-k="btn" data-el="${esc(e.id || '')}">${esc(e.text || e.id || '…')}</button>`;
      case 'list': return `<div class="ml">${(e.items || []).map((it, i) => `<div class="kv link" data-mg="${esc(k)}" data-k="li" data-el="${esc(e.id || '')}" data-i="${i}">${esc(it)}</div>`).join('') || '<div class="dim small">—</div>'}</div>`;
      case 'input': return `<input data-mg="${esc(k)}" data-el="${esc(e.id || '')}" value="${esc(e.value || '')}" placeholder="${esc(e.placeholder || '')}" maxlength="200">`;
      case 'row': return `<div class="row2">${(e.children || []).map(c => this.elHtml(k, c)).join(' ')}</div>`;
      default: return `<div${cls}>${esc(e.text || '')}</div>`;
    }
  }
  render() {
    let h = '';
    for (const [k, g] of this.guis) h += `<div class="panel modgui"><div class="title">${esc(g.spec.title)} <span class="dim small">${esc(g.title)}</span> <span class="x" data-mg="${esc(k)}" data-k="close">✕</span></div>${g.spec.elements.map(e => this.elHtml(k, e)).join('')}</div>`;
    const act = document.activeElement as HTMLInputElement | null; const keep = act && this.el.contains(act) ? act.dataset.mg + '|' + act.dataset.el : null;
    morph(this.el, tr(h)); this.el.style.display = h ? '' : 'none';
    if (keep) (this.el.querySelector(`input[data-mg="${CSS.escape(keep.split('|')[0])}"][data-el="${CSS.escape(keep.split('|')[1])}"]`) as HTMLInputElement | null)?.focus();
  }
  /** окно «Консоль модов» */
  consoleHtml(): string {
    this.unread = 0; const mods = [...new Set(this.lines.map(l => l.mod))];
    const L = this.lines.filter(l => !this.filter || l.mod === this.filter).slice(-300);
    const st = this.stats.length ? `<div class="small">${this.stats.map(s => `<b>${esc(s.title)}</b>: ${s.state === 'run' ? `${s.ms.toFixed(2)} мс/тик (пик ${s.peak.toFixed(1)})${s.mem ? ` · ${(s.mem / 1048576).toFixed(0)} МБ` : ''} · storage ${(s.store / 1024).toFixed(1)} КБ` : s.state === 'start' ? 'запускается' : `<span class="err">отключён: ${esc(s.reason || '')}</span>`}`).join('<br>')}</div>` : '<div class="dim small">Скриптовых модов нет. Скрипт мода — файл control.js в архиве мода (см. README, «Скрипты модов»).</div>';
    return `<div class="panel wide"><div class="title">Консоль модов <span class="x" data-act="close">✕</span></div>${st}
      <div class="row2">${['', ...mods].map(m => `<button class="mini ${this.filter === m ? 'on' : ''}" data-act="mcfilter" data-v="${esc(m)}">${m ? esc(m) : 'все'}</button>`).join('')} <button class="mini" data-act="mcclear">Очистить</button></div>
      <div class="mconsole" id="mconsole">${L.map(l => `<div class="${l.level === 'error' ? 'e' : l.level === 'warn' ? 'w' : ''}">[${l.tick}] ${esc(l.mod)}: ${esc(l.text)}</div>`).join('') || '<span class="dim">Сообщений нет. console.log() и ошибки скриптов появятся здесь.</span>'}</div></div>`;
  }
}

// v1.10: окно «Моды» (Esc → «Моды»): список установленных модов — включить/выключить, версия, автор, ошибки и
// предупреждения проверки, порядок загрузки (перетаскивание ⠿), установка из файла, удаление, «Создать пакет модов».
// Изменения вступают в силу после «Применить» — симуляция перезапускается (партия сохраняется и открывается заново).
// Окно «Моды сохранения» — при загрузке партии с другим набором модов: включить нужные / загрузить без них / отмена.
import type { ModStore, ModDiff } from '../client/modstore';
import type { ApplyReport } from '../mods/registry';
import { errText, ModError } from '../mods/mod';
import { tr } from '../core/i18n';

const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export interface ModsHooks {
  store: ModStore; report(): ApplyReport | null; apply(): Promise<void>; busy(): boolean;
  download(name: string, data: Uint8Array): void; msg(t: string): void; render(): void; close(): void; game: string;
  /** ожидающая загрузка с другим набором модов */ pending(): { diff: ModDiff; label: string } | null;
  resolve(how: 'enable' | 'without' | 'cancel'): void;
}
export class ModsUI {
  drag: number | null = null; note = ''; open = new Set<string>();
  constructor(private h: ModsHooks) {
    document.addEventListener('mouseup', ev => {
      if (this.drag == null) return; const from = this.drag; this.drag = null;
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-mrow]') as HTMLElement | null;
      const to = el ? +el.dataset.mrow! : from;
      if (to !== from) this.h.store.move(from, to).then(() => this.h.render()); else this.h.render();
    });
  }
  private errs(list: ModError[], key: string, warn: boolean) {
    if (!list.length) return '';
    const max = this.open.has(key) ? 200 : 3; const more = list.length - max;
    return `<div class="small ${warn ? 'modwarn' : 'moderr'}">${list.slice(0, max).map(e => `<div>${warn ? '⚠' : '✖'} ${esc(tr(errText(e)))}</div>`).join('')}${more > 0 ? `<button class="mini" data-act="mm-more" data-k="${key}">ещё ${more}</button>` : ''}</div>`;
  }
  html(w: string): string {
    if (w === 'modcheck') return this.checkHtml();
    const st = this.h.store; const rep = this.h.report();
    let b = '';
    if (!st.list.length) b += '<div class="dim">Модов нет. Установите мод из zip-архива — например, примеры из папки mods игры.</div>';
    st.list.forEach((m, i) => {
      const inf = m.pkg.info; const f = rep?.failed.find(x => x.name === m.name); const loaded = rep?.loaded.find(x => x.name === m.name && x.hash === m.pkg.hash);
      const errs = [...m.pkg.errors.filter(e => !e.warn), ...(m.on && f ? f.errors : [])];
      const warns = [...m.pkg.errors.filter(e => e.warn), ...(m.on && loaded && rep ? rep.warnings.filter(x => x.mod === m.name) : [])];
      const state = !m.on ? '<span class="dim">выключен</span>' : st.dirty ? '<span class="dim">включится после «Применить»</span>' : f ? '<span class="bad">не загружен</span>' : loaded ? '<span class="good">загружен</span>' : '<span class="dim">ждёт применения</span>';
      b += `<div class="srow modrow ${this.drag === i ? 'drag' : ''}" data-mrow="${i}"><span class="dim grip" data-act="mm-drag" data-i="${i}" title="Перетащите, чтобы изменить порядок загрузки">⠿ ${i + 1}.</span>
        <button class="mini" data-act="mm-toggle" data-n="${esc(m.name)}" ${this.h.busy() ? 'disabled' : ''}>${m.on ? '☑' : '☐'}</button>
        <span class="mtitle"><b>${esc(inf.title)}</b> <span class="dim small">${esc(m.name)} ${esc(inf.version)}${inf.author ? ' · ' + esc(inf.author) : ''}${inf.gameVersion ? ' · игра ' + esc(inf.gameVersion) : ''}${inf.dependencies.length ? ' · нужны: ' + inf.dependencies.map(d => esc(d.name + (d.range ? ' ' + d.range : '') + (d.optional ? ' (необяз.)' : ''))).join(', ') : ''}</span> · ${state}
        ${inf.description ? `<div class="small">${esc(inf.description)}</div>` : ''}${this.errs(errs, 'e:' + m.name, false)}${this.errs(warns, 'w:' + m.name, true)}</span>
        <button class="mini" data-act="mm-del" data-n="${esc(m.name)}">Удалить</button></div>`;
    });
    const sum = rep ? `Загружено модов: ${rep.loaded.length}${rep.failed.length ? `, с ошибками: ${rep.failed.length}` : ''} · за ${rep.ms.toFixed(1)} мс · добавлено ${rep.ops.add}, изменено ${rep.ops.patch}, убрано ${rep.ops.remove}, спрайтов ${Object.keys(rep.sprites).length}` : '';
    return `<div class="panel wide"><div class="title">Моды <span class="x" data-act="close">✕</span></div>
      <div class="small dim">Моды меняют данные игры: предметы, рецепты, технологии, постройки, ресурсы и генерацию карты. Порядок загрузки — сначала зависимости, затем по списку сверху вниз (перетащите ⠿).</div>
      <div class="modlist">${b}</div>
      ${st.dirty ? `<div class="small warnline">Набор изменён — нажмите «Применить»: партия сохранится и откроется заново с новыми данными.</div>` : ''}
      <div class="row2"><button class="big" data-act="mm-apply" ${this.h.busy() || !st.dirty ? 'disabled' : ''}>${this.h.busy() ? 'Применяю…' : 'Применить и перезапустить'}</button>
        <button data-act="mm-install">Установить из файла (.zip)</button><button data-act="mm-export" ${st.list.some(m => m.on) ? '' : 'disabled'}>Создать пакет модов</button>
        ${st.list.some(m => m.on) ? '<button data-act="mm-off">Выключить все</button>' : ''}</div>
      ${this.note ? `<div class="small">${esc(this.note)}</div>` : ''}<div class="dim small">${sum}</div>
      <div class="dim small">Формат мода: info.json, prototypes/*.json (операции add / patch / remove), locale/en.json, спрайты PNG — см. README, раздел «Моды».</div></div>`;
  }
  private checkHtml() {
    const p = this.h.pending(); if (!p) return `<div class="panel"><div class="title">Моды сохранения <span class="x" data-act="close">✕</span></div><div class="dim">Нет загрузки.</div></div>`;
    const d = p.diff; const can = d.need.every(n => n.installed !== 'none');
    const need = d.need.map(n => `<li><b>${esc(n.ref.title || n.ref.name)}</b> ${esc(n.ref.version)} — ${n.installed === 'none' ? '<span class="bad">не установлен</span>' : n.installed === 'other' ? `установлен другой: ${esc(n.have || '')}` : n.on ? 'включён, нужен перезапуск' : 'установлен, выключен'}</li>`).join('');
    const extra = d.extra.map(a => `<li>${esc(a.title || a.name)} ${esc(a.version)}</li>`).join('');
    return `<div class="panel"><div class="title">Моды сохранения <span class="x" data-act="mm-cancel">✕</span></div>
      <div class="small">Партия «${esc(p.label)}» сделана с другим набором модов.</div>
      ${need ? `<div class="lbl">Нужны</div><ul class="small">${need}</ul>` : ''}${extra ? `<div class="lbl">Включены, но в партии их нет</div><ul class="small">${extra}</ul>` : ''}
      <div class="row2"><button class="big" data-act="mm-need" ${d.need.some(n => n.installed !== 'none') || d.extra.length ? '' : 'disabled'}>Включить нужные</button><button data-act="mm-without">Загрузить без них</button><button data-act="mm-cancel">Отмена</button></div>
      <div class="dim small">${can ? '«Включить нужные» — включит моды партии (лишние выключит) и загрузит её.' : 'Неустановленные моды можно взять у автора партии («Создать пакет модов») и установить в окне «Моды».'} «Загрузить без них» — постройки, предметы и рецепты из отсутствующих модов будут убраны, отчёт — в сообщениях.</div></div>`;
  }
  act(a: string, el: HTMLElement): boolean {
    const st = this.h.store; const n = el.dataset.n || '';
    switch (a) {
      case 'mm-drag': this.drag = +el.dataset.i!; this.h.render(); return true;
      case 'mm-toggle': { const m = st.get(n); if (m) st.setOn(n, !m.on).then(() => this.h.render()); return true; }
      case 'mm-del': { const m = st.get(n); if (m && confirm(tr('Удалить мод') + ` «${m.pkg.info.title}»?`)) st.remove(n).then(() => { this.note = tr('Мод удалён') + `: ${m.pkg.info.title}`; this.h.render(); }); return true; }
      case 'mm-more': { const k = el.dataset.k!; if (this.open.has(k)) this.open.delete(k); else this.open.add(k); this.h.render(); return true; }
      case 'mm-off': Promise.all(st.list.map(m => st.setOn(m.name, false))).then(() => this.h.render()); return true;
      case 'mm-apply': this.h.apply().then(() => this.h.render()); this.h.render(); return true;
      case 'mm-install': {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.zip'; i.multiple = true; i.id = 'modfile';
        i.onchange = async () => {
          const out: string[] = [];
          for (const f of Array.from(i.files || [])) {
            try { const r = await st.install(new Uint8Array(await f.arrayBuffer()), f.name); out.push(...r.added.map(m => `${m.pkg.info.title} ${m.pkg.info.version}${m.pkg.errors.some(e => !e.warn) ? ' (' + tr('с ошибками') + ')' : ''}`)); }
            catch (e) { out.push(`${f.name}: ${tr('ошибка')} — ${tr((e as Error).message)}`); }
          }
          this.note = tr('Установлено') + ': ' + out.join(', '); i.remove(); this.h.render();
        };
        i.style.display = 'none'; document.body.appendChild(i); i.click(); return true;
      }
      case 'mm-export': st.exportPack(this.h.game).then(b => { this.h.download(`zavod7-modpack-${st.list.filter(m => m.on).length}.zip`, b); this.note = tr('Пакет модов сохранён в файл — его можно установить целиком'); this.h.render(); }); return true;
      case 'mm-need': this.h.resolve('enable'); return true;
      case 'mm-without': this.h.resolve('without'); return true;
      case 'mm-cancel': this.h.resolve('cancel'); return true;
    }
    return false;
  }
}

// v1.15: интерфейс испытаний и достижений — окна «Испытания», «Достижения», итог испытания; блок целей в HUD;
// плашка нового достижения; учёт результатов (локально). Игровой логики здесь нет: цели и победа считаются в симуляции.
import type { Game } from '../sim/game';
import { Scenario, parseScnText, scnToText, goalText, fmtClock } from '../sim/scenario';
import { CHALLENGES, CHALLENGE_IDS } from '../data/challenges';
import { ACHIEVEMENTS, GROUP_NAMES, AchGroup } from '../sim/achieve';
import * as S from '../client/scnstore';
import { tr } from '../core/i18n';

const esc = (s: any) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export interface ScnHooks {
  game(): Game; play(s: Scenario): void; render(): void; toggle(w: string): void; close(): void; open(): string | null;
  download(name: string, text: string): void; pickFile(accept: string): Promise<string | null>; inMp(): boolean;
  openEditor(s?: Scenario): void; msg(t: string): void; sound(k: string): void;
}
interface Ask { kind: 'chal' | 'mine'; id: string }
interface ResView { id: string; name: string; ok: boolean; ticks: number; rank: number; best: boolean; builtin: boolean; limit: number }

export class ScnUI {
  mine: S.ScnMeta[] = []; private loaded = false; private note = ''; private ask: Ask | null = null; resv: ResView | null = null;
  private gkey = ''; private seenRes = true; private prevOpen: string | null = null; private toast!: HTMLElement; private toastQ: string[] = []; private toastT = 0;
  constructor(private h: ScnHooks) {
    const t = document.createElement('div'); t.id = 'achtoast'; t.style.display = 'none'; document.body.appendChild(t); this.toast = t;
    t.addEventListener('click', () => { this.toastT = 0; this.nextToast(); });
  }
  // ---------- окна ----------
  html(w: string): string | null {
    if (w === 'chal') return this.chalWindow(); if (w === 'ach') return this.achWindow(); if (w === 'chalres') return this.resWindow(); return null;
  }
  private bestLine(id: string) { const b = S.bestOf(id); return b ? `<span class="chbest">🏆 ${fmtClock(b.ticks)}</span>` : '<span class="dim small">не пройдено</span>'; }
  private chalWindow() {
    if (!this.loaded) { this.loaded = true; void this.refresh(); }
    const cards = CHALLENGES().map(c => `<div class="chcard"><div class="chhead"><b>${esc(c.name)}</b>${this.bestLine(c.id)}</div><div class="small chdesc">${esc(c.desc)}</div>
      ${this.ask?.id === c.id ? this.askHtml() : `<div class="row2"><button data-act="sc-play" data-id="${c.id}">Играть</button></div>`}</div>`).join('');
    const mine = this.mine.map(m => `<div class="chcard mine"><div class="chhead"><b>${esc(m.name)}</b><span class="dim small">${esc(m.author || '')} · ${m.kb} КБ</span></div>${m.desc ? `<div class="small chdesc">${esc(m.desc)}</div>` : ''}
      ${this.ask?.id === m.id ? this.askHtml() : `<div class="row2"><button data-act="sc-myplay" data-id="${esc(m.id)}">Играть</button><button data-act="sc-myedit" data-id="${esc(m.id)}">Редактировать</button><button data-act="sc-myexp" data-id="${esc(m.id)}">В файл</button><button data-act="sc-mydel" data-id="${esc(m.id)}">Удалить</button></div>`}</div>`).join('');
    const rows = CHALLENGES().map(c => {
      const l = S.loadResults().filter(r => r.id === c.id).sort((a, b) => a.ticks - b.ticks).slice(0, 3);
      return `<tr><td>${esc(c.name)}</td><td>${l.length ? l.map((r, i) => `<span class="${i ? 'dim' : 'chbest'}">${fmtClock(r.ticks)}</span>`).join(' · ') : '<span class="dim">—</span>'}</td></tr>`;
    }).join('');
    return `<div class="panel wide chal"><div class="title">Испытания <span class="x" data-act="close">✕</span></div>
      <div class="dim small">Испытание — карта с правилами и целями. Новая партия заменит текущую (сохраните её в слот). Результаты и достижения хранятся только в этом браузере.</div>
      ${this.note ? `<div class="chnote">${esc(this.note)}</div>` : ''}
      <div class="chcards">${cards}</div>
      <div class="lbl">Мои сценарии (${this.mine.length})</div>
      ${mine ? `<div class="chcards">${mine}</div>` : '<div class="dim small">Пока пусто. Сделайте карту в редакторе или откройте файл .z7scn от друга.</div>'}
      <div class="row2"><button data-act="sc-new">Редактор карт</button><button data-act="sc-import">Открыть сценарий из файла</button></div>
      <div class="lbl">Лучшие результаты</div><table class="keys chtab">${rows}</table>
      <div class="row2"><button data-act="sc-expscores">Экспорт результатов и достижений</button><button data-act="sc-impscores">Импорт из файла</button><button data-act="sc-ach">Достижения (${Object.keys(S.loadAch()).length}/${ACHIEVEMENTS.length})</button></div></div>`;
  }
  private askHtml() { return `<div class="chask">Текущая партия будет заменена. <button class="big" data-act="sc-yes">Начать</button><button data-act="sc-no">Отмена</button></div>`; }
  private achWindow() {
    const have = S.loadAch(); const n = ACHIEVEMENTS.filter(a => have[a.id]).length;
    const groups = (Object.keys(GROUP_NAMES) as AchGroup[]).map(k => {
      const l = ACHIEVEMENTS.filter(a => a.group === k);
      return `<h4>${GROUP_NAMES[k]} <span class="dim small">${l.filter(a => have[a.id]).length}/${l.length}</span></h4><div class="achgrid">${l.map(a => {
        const d = have[a.id];
        return `<div class="ach ${d ? 'on' : ''}" data-id="${a.id}"><span class="achi">${d ? '🏆' : '🔒'}</span><div><b>${esc(a.name)}</b><div class="small dim">${esc(a.desc)}</div>${d ? `<div class="small achd">${new Date(d).toLocaleDateString()}</div>` : ''}</div></div>`;
      }).join('')}</div>`;
    }).join('');
    return `<div class="panel wide ach"><div class="title">Достижения: ${n}/${ACHIEVEMENTS.length} <span class="x" data-act="close">✕</span></div>
      <div class="bar"><i style="width:${Math.round(n / ACHIEVEMENTS.length * 100)}%"></i></div>
      <div class="dim small">Достижения даются в обычной партии и во встроенных испытаниях (в своих сценариях — нет) и записываются в этом браузере. Ачивки про Рой — только если враги включены.</div>${groups}
      <div class="row2"><button data-act="sc-open">Испытания</button></div></div>`;
  }
  private resWindow() {
    const r = this.resv; if (!r) return '<div class="panel"><div class="title">Итог <span class="x" data-act="close">✕</span></div></div>';
    const body = r.ok
      ? `<div class="chres ok">✔ Испытание пройдено за <b>${fmtClock(r.ticks)}</b></div>${r.builtin ? `<div>${r.best ? '🏆 Новый личный рекорд!' : r.rank ? 'Место в таблице: ' + r.rank : 'Не вошло в десятку лучших'}</div>` : '<div class="dim small">Результаты своих сценариев в таблицу не записываются.</div>'}`
      : `<div class="chres bad">✖ Время вышло (${fmtClock(r.limit * 3600)}) — испытание не пройдено</div><div class="dim small">Можно продолжить играть или начать заново.</div>`;
    return `<div class="panel chresw"><div class="title">${esc(r.name)} <span class="x" data-act="close">✕</span></div>${body}
      <div class="row2"><button class="big" data-act="close">Продолжить играть</button><button data-act="sc-again">Заново</button><button data-act="sc-open">Испытания</button></div></div>`;
  }
  // ---------- действия ----------
  async refresh() { try { this.mine = await S.listScenarios(); } catch { this.mine = []; } this.h.render(); }
  private builtin(id: string) { return CHALLENGES().find(c => c.id === id) || null; }
  private start(s: Scenario) {
    if (this.h.inMp()) { this.h.msg('В совместной игре новая партия недоступна — сначала выйдите (Tab → «Выйти»)'); return; }
    this.ask = null; this.last = s; this.h.play(s);
  }
  private last: Scenario | null = null;
  act(a: string, el: HTMLElement): boolean {
    const id = el.dataset.id || '';
    switch (a) {
      case 'sc-open': if (this.h.open() !== 'chal') this.h.toggle('chal'); else this.h.render(); return true;
      case 'sc-ach': if (this.h.open() !== 'ach') this.h.toggle('ach'); else this.h.render(); return true;
      case 'sc-play': case 'sc-myplay':
        if (this.h.inMp()) { this.h.msg('В совместной игре новая партия недоступна — сначала выйдите (Tab → «Выйти»)'); return true; }
        this.ask = { kind: a === 'sc-play' ? 'chal' : 'mine', id }; this.h.render(); return true;
      case 'sc-no': this.ask = null; this.h.render(); return true;
      case 'sc-yes': {
        const k = this.ask; if (!k) return true;
        if (k.kind === 'chal') { const s = this.builtin(k.id); if (s) this.start(s); }
        else void S.loadScenario(k.id).then(s => { if (s) this.start(s); else { this.note = 'Сценарий не открылся'; this.ask = null; this.h.render(); } });
        return true;
      }
      case 'sc-again': if (this.last) this.start(this.last); else this.h.toggle('chal'); return true;
      case 'sc-new': this.h.close(); this.h.openEditor(); return true;
      case 'sc-myedit': void S.loadScenario(id).then(s => { if (!s) { this.note = 'Сценарий не открылся'; this.h.render(); return; } this.h.close(); this.h.openEditor(s); }); return true;
      case 'sc-myexp': void S.loadScenario(id).then(s => { if (s) { this.h.download(`${s.id}.z7scn`, scnToText(s)); this.note = 'Сценарий записан в файл'; } else this.note = 'Сценарий не открылся'; this.h.render(); }); return true;
      case 'sc-mydel': void S.deleteScenario(id).then(() => this.refresh()); return true;
      case 'sc-import': void this.h.pickFile('.z7scn,.json,application/json').then(async t => {
        if (!t) return; const r = parseScnText(t); if (!r.scn) { this.note = r.errors[0] || 'Файл не открылся'; this.h.render(); return; }
        await S.saveScenario(r.scn); this.note = 'Добавлено: «' + r.scn.name + '»' + (r.warns.length ? ' (' + r.warns[0] + ')' : ''); await this.refresh();
      }); return true;
      case 'sc-expscores': this.h.download('zavod7-results.json', S.exportScores()); this.note = 'Результаты записаны в файл'; this.h.render(); return true;
      case 'sc-impscores': void this.h.pickFile('.json,application/json').then(t => {
        if (!t) return; const r = S.importScores(t); this.note = r ? `Добавлено: достижений ${r.ach}, результатов ${r.results}` : 'Файл не подошёл'; this.checkMeta(); this.h.render();
      }); return true;
    }
    return false;
  }
  // ---------- HUD ----------
  hud(g: Game): string {
    const s = g.scn, st = g.scnSt; if (!s || !st) return '';
    const t = Math.max(0, g.tick - st.t0), lim = s.rules.timeLimit;
    const goals = s.goals.map((o, i) => { const d = st.done[i] > 0; const pr = st.pr?.[i] || ''; return `<div class="scng ${d ? 'ok' : ''}"><span>${d ? '✔' : '○'}</span> ${esc(goalText(o))}${!d && pr ? ` <span class="dim">${pr}</span>` : ''}</div>`; }).join('');
    const res = st.res ? (st.res.ok ? `<div class="scnr ok">Пройдено за ${fmtClock(st.res.tick - st.t0)}</div>` : '<div class="scnr bad">Время вышло</div>') : '';
    return `<div class="scn"><div class="scnh"><b>${esc(s.name)}</b><span class="scnt ${lim && !st.res && t > lim * 3240 ? 'warn' : ''}">⏱ ${fmtClock(st.res ? st.res.tick - st.t0 : t)}${lim ? ' / ' + fmtClock(lim * 3600) : ''}</span></div>${goals}${res}</div>`;
  }
  // ---------- слежение за партией (каждый кадр) ----------
  private checkMeta() { if (S.challengesDone().length >= CHALLENGE_IDS.length && S.unlockAch('all-challenges')) this.pop('all-challenges'); }
  private pop(id: string) { const a = ACHIEVEMENTS.find(x => x.id === id); if (!a) return; this.h.sound('goal'); this.toastQ.push(`<b>🏆 Достижение: ${esc(a.name)}</b><span>${esc(a.desc)}</span>`); if (!this.toastT) this.nextToast(); }
  private nextToast() {
    const h = this.toastQ.shift(); if (!h) { this.toast.style.display = 'none'; this.toastT = 0; return; }
    this.toast.innerHTML = tr(h); this.toast.style.display = 'flex'; clearTimeout(this.toastT); this.toastT = window.setTimeout(() => { this.toastT = 0; this.nextToast(); }, 5000);
  }
  watch(g: Game) {
    const o = this.h.open();
    if (o !== this.prevOpen) { if (o === 'chal') { this.ask = null; this.note = ''; void this.refresh(); } if (o === 'ach') this.checkMeta(); this.prevOpen = o; }
    if (g.achNew.length) for (const id of g.achNew.splice(0)) if (S.unlockAch(id)) { this.pop(id); if (this.h.open() === 'ach') this.h.render(); }
    const s = g.scn, st = g.scnSt;
    const key = s && st ? `${s.id}|${g.seed}|${st.t0}` : '';
    if (key !== this.gkey) { this.gkey = key; this.seenRes = !!st?.res; if (s && st && !this.seenRes) this.last = s; } // загруженная уже законченная партия итог не показывает
    if (s && st?.res && !this.seenRes) {
      this.seenRes = true; const builtin = s.id.startsWith('z7-'); const ticks = st.res.tick - st.t0; let rank = 0, best = false;
      if (st.res.ok && builtin && !this.h.game().x.cheats) { const r = S.addResult({ id: s.id, name: s.name, ticks, date: Date.now() }); rank = r.rank; best = r.best; this.checkMeta(); }
      this.resv = { id: s.id, name: s.name, ok: st.res.ok, ticks, rank, best, builtin, limit: s.rules.timeLimit };
      const op = this.h.open(); if (!op || op === 'victory') { if (op) this.h.close(); this.h.toggle('chalres'); }
    }
  }
}

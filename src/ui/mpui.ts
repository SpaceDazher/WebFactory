// v1.12: интерфейс совместной игры — окно «Совместная игра» (вход, лобби, ручные коды), список игроков (Tab),
// чат (Enter), плашка «Синхронизация…», метки на карте (Alt + ЛКМ).
import type { MpClient } from '../client/mp';
import type { Game } from '../sim/game';
import { PEER_COLORS } from '../sim/game';
import type { Settings } from '../client/settings';
import { keyName } from '../client/settings';
import { tr } from '../core/i18n';

const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const $ = (id: string) => document.getElementById(id);
const MODE_N: Record<string, string> = { none: 'Нет врагов', peaceful: 'Мирный', normal: 'Обычный', deathworld: 'Мир смерти' };
export interface MpHooks {
  mp: MpClient; game(): Game; settings(): Settings; setSettings(p: Partial<Settings>): void;
  render(): void; close(): void; toggle(w: string): void; open(): string | null; msg(t: string): void; download(name: string, text: string): void; sound(k: string): void;
}

export class MpUI {
  chatOpen = false; private liveSig = ''; private chatSig = ''; private seenChat = 0; private seenMark = 0; private frame = 0; private lostUntil = 0; private lostWhy = '';
  constructor(private h: MpHooks) {
    const el = document.createElement('div'); el.id = 'chatbox';
    el.innerHTML = '<div id="chatlog"></div><input id="chatin" maxlength="200" autocomplete="off" style="display:none">';
    document.body.appendChild(el);
    const pl = document.createElement('div'); pl.id = 'mpplate'; pl.style.display = 'none'; document.body.appendChild(pl);
    const inp = $('chatin') as HTMLInputElement;
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { const t = inp.value.trim(); if (t) this.h.game().enqueue({ t: 'chat', text: t }); this.closeChat(); ev.preventDefault(); }
      else if (ev.key === 'Escape') { this.closeChat(); ev.preventDefault(); }
      ev.stopPropagation();
    });
    inp.addEventListener('blur', () => { if (this.chatOpen) this.closeChat(); });
    document.getElementById('win')!.addEventListener('change', ev => {
      const t = ev.target as HTMLInputElement; const s = this.h.mp.session; if (!s || !s.isHost || s.state !== 'lobby') return;
      if (t.id === 'mpmap') s.setMap({ mode: t.value as any }); else if (t.id === 'mpseed') s.setMap({ seed: (+t.value >>> 0) || 1 }); else if (t.id === 'mpen') s.setMap({ enemies: t.value });
    });
  }
  openChat() { const i = $('chatin') as HTMLInputElement; this.chatOpen = true; i.style.display = 'block'; i.value = ''; i.placeholder = tr('Сообщение — Enter, отмена — Esc'); i.focus(); this.chatSig = ''; }
  closeChat() { const i = $('chatin') as HTMLInputElement; this.chatOpen = false; i.style.display = 'none'; i.blur(); this.chatSig = ''; }
  lost(why: string) { this.lostWhy = why; this.lostUntil = performance.now() + 8000; }
  // ---------- окна ----------
  html(w: string): string | null {
    if (w === 'mp') return this.mpWindow(); if (w === 'players') return this.playersWindow(); return null;
  }
  private colors(cur: string) { return PEER_COLORS.map(c => `<span class="mpsw ${c === cur ? 'on' : ''}" data-act="mpcolor" data-c="${c}" style="background:${c}"></span>`).join(''); }
  private mpWindow() {
    const mp = this.h.mp, s = mp.session, st = this.h.settings();
    const head = `<div class="panel mp"><div class="title">Совместная игра <span class="x" data-act="close">✕</span></div>`;
    if (!s || s.state === 'closed') {
      return head + `${mp.err ? `<div class="mperr">${esc(mp.err)}</div>` : ''}
        <div class="lbl">Ваш персонаж</div>
        <div class="row2">Имя: <input id="mpname" maxlength="20" value="${esc(st.mpName || '')}" placeholder="Инженер"> Цвет: ${this.colors(st.mpColor)}</div>
        <div class="lbl">Создать игру (вы — хост, от 2 до 4 игроков)</div>
        <div class="row2">Карта: <select id="mpmap"><option value="current">Текущая партия</option><option value="new">Новая карта</option></select>
          Seed: <input id="mpseed" size="10" value="${Math.floor(Math.random() * 1e9)}">
          Рой: <select id="mpen">${Object.entries(MODE_N).map(([k, v]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="big" data-act="mphost">Создать игру</button></div>
        <div class="lbl">Войти в игру друга</div>
        <div class="row2">Код: <input id="mpcode" size="10" placeholder="ZVD-XXXX" style="text-transform:uppercase"> <button class="big" data-act="mpjoin">Войти</button></div>
        <details class="mpman"><summary>Без сервера: обмен кодами вручную</summary>
          <div class="dim small">Хост создаёт игру без сервера и для каждого друга — код приглашения. Друг вставляет его сюда и отправляет хосту код ответа. Коды длинные — пересылайте их через мессенджер.</div>
          <div class="row2"><button data-act="mphostm">Создать игру без сервера</button></div>
          <textarea id="mpoffer" rows="3" placeholder="Код приглашения от хоста (Z7O…)"></textarea>
          <div class="row2"><button data-act="mpanswer">Получить код ответа</button></div>
        </details>
        <details class="mpman"><summary>Сеть</summary>
          <div class="row2">Сервер сигналинга: <input id="mpserver" size="28" value="${esc(st.mpServer)}"></div>
          <div class="row2">STUN/TURN: <input id="mpice" size="40" value="${esc(st.mpIce)}"></div>
          <div class="dim small">Сервер: <code>node tools/signal-server.mjs</code> (порт 8787). Если прямое соединение не установится за 8 с, данные пойдут через сервер. Для строгих NAT укажите свой TURN: <code>turn:user:pass@host:3478</code>.</div>
        </details>
        <div class="dim small">Все игроки считают одну и ту же игру: по сети идут только команды, раз в секунду сверяются контрольные суммы. Нужны одинаковые версия игры и моды. Паузу ставит только хост.</div></div>`;
    }
    if (s.state === 'lobby') {
      const host = s.isHost; const m = s.map;
      const mapCtl = host ? `<div class="lbl">Карта</div><div class="row2"><select id="mpmap"><option value="current" ${m.mode === 'current' ? 'selected' : ''}>Текущая партия</option><option value="new" ${m.mode === 'new' ? 'selected' : ''}>Новая карта</option></select>
        Seed: <input id="mpseed" size="10" value="${m.seed}"> Рой: <select id="mpen">${Object.entries(MODE_N).map(([k, v]) => `<option value="${k}" ${k === m.enemies ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` : '';
      const manual = host ? `<details class="mpman" ${mp.mode === 'manual' ? 'open' : ''}><summary>Пригласить без сервера (коды вручную)</summary>
          <div class="row2"><button data-act="mpinvite">Код приглашения для игрока</button></div>
          ${mp.invite ? `<textarea id="mpinv" rows="3" readonly>${mp.invite}</textarea><div class="row2"><button data-act="mpcopy" data-t="mpinv">Копировать</button></div>
          <textarea id="mpans" rows="3" placeholder="Код ответа от игрока (Z7A…)"></textarea><div class="row2"><button data-act="mpaccept">Принять ответ</button></div>` : ''}</details>`
        : mp.answer ? `<div class="lbl">Код ответа — отправьте хосту</div><textarea id="mpansout" rows="3" readonly>${mp.answer}</textarea><div class="row2"><button data-act="mpcopy" data-t="mpansout">Копировать</button></div>` : '';
      return head.replace('Совместная игра', 'Совместная игра — лобби') + `<div id="mplive">${this.live()}</div>${mapCtl}${manual}</div>`;
    }
    return head + `<div>Игра идёт. Список игроков — ${keyName(st.keys.players)}.</div><div class="row2"><button data-act="mpplayers">Игроки</button><button data-act="mpleave">Выйти из совместной игры</button></div></div>`;
  }
  /** изменяемая часть лобби (обновляется без перерисовки полей ввода) */
  live(): string {
    const mp = this.h.mp, s = mp.session; if (!s) return '';
    const host = s.isHost; let h = '';
    if (mp.code) h += `<div class="mpcode">Код приглашения: <b>${esc(mp.code)}</b> <button data-act="mpcopycode">Копировать</button></div>`;
    else if (host && !mp.serverOk && mp.mode === 'manual') h += `<div class="dim small">Без сервера: пригласите игроков кодами ниже.</div>`;
    if (mp.status) h += `<div class="dim">${esc(mp.status)}</div>`;
    if (mp.err) h += `<div class="mperr">${esc(mp.err)}</div>`;
    h += `<div class="lbl">Игроки (${s.players.length} из 4)</div><table class="mpt"><tr class="dim"><td></td><td>Имя</td><td>Пинг</td><td>Готов</td></tr>`;
    s.players.forEach((p, i) => { h += `<tr><td><span class="mpsw on" style="background:${p.color}"></span></td><td>${esc(p.name)}${i === 0 ? ' <span class="dim">(хост)</span>' : ''}${i === s.me ? ' <span class="dim">(вы)</span>' : ''}</td><td>${i === 0 ? '—' : p.ping + ' мс'}</td><td>${p.ready ? '✓' : '…'}</td></tr>`; });
    if (!s.players.length) h += `<tr><td colspan="4" class="dim">Соединение…</td></tr>`;
    h += '</table>';
    const m = s.map; if (!host) h += `<div class="small">Карта: ${m.mode === 'new' ? `новая, seed ${m.seed}, Рой: ${MODE_N[m.enemies] || m.enemies}` : 'текущая партия хоста'}</div>`;
    const ms = host ? s.mods : s.hostMods || s.mods; h += `<div class="small dim">Моды: ${ms.mods.length ? ms.mods.map(x => esc(x.id + " " + x.ver)).join(', ') : 'нет'} · данные игры ${ms.data}${!host && s.hostMods ? (s.hostMods.data === s.mods.data ? ' · совпадают ✓' : ' · НЕ совпадают') : ''}</div>`;
    const me = s.players[s.me];
    h += '<div class="row2">';
    if (host) h += `<button class="big" data-act="mpstart" ${s.allReady() ? '' : 'disabled'}>Начать</button>${s.players.length < 2 ? '<span class="dim small">Ждём игроков…</span>' : !s.allReady() ? '<span class="dim small">Ждём «Готов» от всех</span>' : ''}`;
    else if (me) h += `<button class="big" data-act="mpready">${me.ready ? 'Не готов' : 'Готов'}</button>`;
    h += `<button data-act="mpleave">Выйти</button></div>`;
    return h;
  }
  private playersWindow() {
    const mp = this.h.mp, s = mp.session, g = this.h.game(); const st = this.h.settings();
    let h = `<div class="panel mp"><div class="title">Игроки (${esc(keyName(st.keys.players))}) <span class="x" data-act="close">✕</span></div>`;
    if (!s || s.state !== 'game') return h + `<div class="dim">Одиночная игра. Совместная — Esc → «Совместная игра».</div></div>`;
    const v = g.mpv?.mp; const peers = g.mpv?.peers || [];
    h += `<table class="mpt"><tr class="dim"><td></td><td>Имя</td><td>Пинг</td><td>Состояние</td><td></td></tr>`;
    s.players.forEach((p, i) => {
      const P = peers[i]; const state = !p.on ? 'отключён' : P?.dead ? 'погиб' : 'в игре';
      h += `<tr><td><span class="mpsw on" style="background:${p.color}"></span></td><td>${esc(p.name)}${i === 0 ? ' <span class="dim">(хост)</span>' : ''}${i === s.me ? ' <span class="dim">(вы)</span>' : ''}</td><td>${i === 0 ? '—' : p.ping + ' мс'}</td><td>${state}</td><td>${s.isHost && i > 0 && p.on ? `<button data-act="mpdrop" data-i="${i}">Продолжить без игрока</button>` : ''}</td></tr>`;
    });
    h += '</table>';
    const d = v?.delay ?? s.delay; const kind = mp.kinds.filter(Boolean); const kn = kind.includes('relay') ? 'через сервер (ретрансляция)' : 'WebRTC напрямую';
    h += `<div class="small">Задержка ввода: ${d} тиков (≈ ${Math.round(d * 1000 / 60)} мс) · запас кадров: ${v?.buf ?? 0} · пинг: ${s.ping()} мс · связь: ${kn}</div>`;
    h += `<div class="small">Рассинхронов: ${s.desyncs} · пересинхронизаций: ${s.resyncs}${s.paused ? ' · <b>пауза хоста</b>' : ''}</div>`;
    h += '<div class="row2">';
    if (s.isHost) h += `<button data-act="mppause">${s.paused ? 'Продолжить' : 'Пауза'}</button>`;
    if (mp.reports.length) h += `<button data-act="mpreport">Скачать отчёт о рассинхроне (${mp.reports.length})</button>`;
    h += `<button data-act="mpleave">Выйти из совместной игры</button></div>`;
    h += `<div class="dim small">Чат — ${esc(keyName(st.keys.chat))}, метка на карте — ${esc(keyName(st.keys.mark))} + ЛКМ. Паузу ставит только хост.</div></div>`;
    return h;
  }
  // ---------- действия ----------
  act(a: string, el: HTMLElement): boolean {
    const mp = this.h.mp; const val = (id: string) => (($(id) as HTMLInputElement | null)?.value ?? '').trim();
    const saveForm = () => { const p: Partial<Settings> = {}; if ($('mpname')) p.mpName = val('mpname').slice(0, 20); if ($('mpserver')) p.mpServer = val('mpserver'); if ($('mpice')) p.mpIce = val('mpice'); this.h.setSettings(p); };
    const fail = (e: any) => { mp.err = (e as Error)?.message || String(e); this.h.render(); };
    switch (a) {
      case 'mpopen': this.h.toggle('mp'); return true;
      case 'mpcolor': this.h.setSettings({ mpColor: el.dataset.c! }); saveForm(); el.parentElement?.querySelectorAll('[data-act="mpcolor"]').forEach(x => x.classList.toggle('on', x === el)); return true; // без перерисовки: поля формы сохраняются
      case 'mphost': case 'mphostm': {
        saveForm(); const map = { mode: val('mpmap') as any || 'current', seed: (+val('mpseed') >>> 0) || 1, enemies: val('mpen') || 'normal' };
        mp.host(map, a === 'mphostm').then(() => this.h.render(), fail); this.h.render(); return true;
      }
      case 'mpjoin': { saveForm(); const code = val('mpcode').toUpperCase(); if (!code) { mp.err = tr('Введите код приглашения'); this.h.render(); return true; } mp.join(code).catch(fail); this.h.render(); return true; }
      case 'mpanswer': { saveForm(); const code = val('mpoffer'); mp.answerInvite(code).then(() => this.h.render(), fail); return true; }
      case 'mpinvite': mp.makeInvite().then(() => this.h.render(), fail); return true;
      case 'mpaccept': mp.acceptAnswer(val('mpans')).then(() => this.h.render(), fail); return true;
      case 'mpcopy': case 'mpcopycode': { const t = a === 'mpcopycode' ? mp.code : (($(el.dataset.t!) as HTMLTextAreaElement)?.value || ''); navigator.clipboard?.writeText(t).then(() => this.h.msg('Скопировано'), () => { const x = $(el.dataset.t || '') as HTMLTextAreaElement | null; x?.select(); }); return true; }
      case 'mpready': { const s = mp.session; if (s) { const me = s.players[s.me]; s.setReady(!(me && me.ready)); } return true; }
      case 'mpstart': mp.session?.startGame(); return true;
      case 'mpleave': mp.close(); this.h.close(); this.h.msg('Вы вышли из совместной игры — партия продолжается у вас одиночной'); return true;
      case 'mpplayers': this.h.toggle('players'); return true;
      case 'mppause': { const s = mp.session; if (s) s.pause(!s.paused); this.h.render(); return true; }
      case 'mpdrop': { const s = mp.session; const i = +el.dataset.i!; if (s && confirm(tr('Продолжить без этого игрока? Он не сможет вернуться в эту игру.'))) { s.drop(i); this.h.game().enqueue({ t: 'teleMp', ev: 'drop' }); } this.h.render(); return true; }
      case 'mpreport': { const r = mp.reports[mp.reports.length - 1]; if (r) this.h.download(`zavod7-desync-${r.hostTick}.json`, JSON.stringify({ format: 'zavod7-desync', ...r, local: safeJson(r.local), host: safeJson(r.host) })); return true; }
    }
    return false;
  }
  // ---------- каждый кадр ----------
  hud() {
    this.frame++; const mp = this.h.mp, s = mp.session, g = this.h.game();
    if (this.h.open() === 'mp' && this.frame % 10 === 0) { const live = $('mplive'); if (live) { const h = this.live(); if (h !== this.liveSig) { this.liveSig = h; live.innerHTML = tr(h); } } }
    // плашка
    const pl = $('mpplate')!; let t = '';
    const v = g.mpv?.mp;
    if (s && s.state === 'game') {
      if (s.syncing) t = 'Синхронизация…'; else if (s.paused || v?.paused) t = s.isHost ? 'Пауза (F9 — продолжить)' : 'Пауза (хост)'; else if (v && v.wait > 400) t = 'Ожидание игроков…';
    } else if (performance.now() < this.lostUntil) t = this.lostWhy || 'Связь с хостом потеряна';
    if (pl.dataset.t !== t) { pl.dataset.t = t; pl.textContent = tr(t); pl.style.display = t ? 'block' : 'none'; }
    // чат
    if (this.frame % 6 === 0) {
      const log = $('chatlog')!; const ch = g.chat || []; const peers = g.mpv?.peers || [];
      const show = ch.filter(c => this.chatOpen || g.tick - c.tick < 20 * 60).slice(-8);
      const sig = show.map(c => c.tick + c.text).join('|') + this.chatOpen;
      if (sig !== this.chatSig) { this.chatSig = sig; log.innerHTML = show.map(c => `<div><b style="color:${peers[c.pl]?.color || '#ddd'}">${esc(peers[c.pl]?.name || '?')}:</b> ${esc(c.text)}</div>`).join(''); log.style.display = show.length ? 'block' : 'none'; }
      const mk = g.marks || []; const lm = mk.length ? mk[mk.length - 1].tick : 0; if (lm > this.seenMark) { if (this.seenMark && mk[mk.length - 1].pl !== (v?.me ?? 0)) this.h.sound('ping'); this.seenMark = lm; }
      const last = ch.length ? ch[ch.length - 1].tick : 0; if (last > this.seenChat) { if (this.seenChat && ch[ch.length - 1].pl !== (v?.me ?? 0)) this.h.sound('chat'); this.seenChat = last; }
    }
  }
}
function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }

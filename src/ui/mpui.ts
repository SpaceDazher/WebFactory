// v1.12: интерфейс совместной игры — окно «Совместная игра» (вход, лобби, ручные коды), список игроков (Tab),
// чат (Enter), плашка «Синхронизация…», метки на карте (Alt + ЛКМ).
// v1.13: до 8 игроков, пароль; окно «Игроки» — роль, пинг, состояние, «Выгнать», «Запретить», «Сделать админом»,
// «Передать хоста»; настройки хоста (снос чужого, чертежи, пароль, пауза при входе); ручные коды — пошаговое состояние
// каждого соединения, причины неудачи, «Новый код ответа», встречный «код-запрос», «Проверка сети»; плашки
// «Подключается игрок…», «Загрузка мира…», «Передача хоста…»; «Переподключиться» после обрыва.
import type { MpClient, Manual } from '../client/mp';
import type { Game } from '../sim/game';
import { PEER_COLORS, MAX_PEERS } from '../sim/game';
import type { Settings } from '../client/settings';
import { keyName } from '../client/settings';
import { tr } from '../core/i18n';
import { genFormHtml, readGen, refreshGenForm } from './genform';
import { GEN_VER } from '../sim/world';

const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const $ = (id: string) => document.getElementById(id);
const MODE_N: Record<string, string> = { none: 'Нет врагов', peaceful: 'Мирный', normal: 'Обычный', deathworld: 'Мир смерти' };
const ROLE_N: Record<string, string> = { host: 'хост', admin: 'админ', player: 'игрок' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export interface MpHooks {
  mp: MpClient; game(): Game; settings(): Settings; setSettings(p: Partial<Settings>): void;
  nativeHtml?(): string; nativeActive?(): boolean; nativePlayers?(): string;
  render(): void; close(): void; toggle(w: string): void; open(): string | null; msg(t: string): void; download(name: string, text: string): void; sound(k: string): void; chooseSession(): void;
}

export class MpUI {
  chatOpen = false; private liveSig = ''; private chatSig = ''; private seenChat = 0; private seenMark = 0; private frame = 0; private lostUntil = 0; private lostWhy = '';
  constructor(private h: MpHooks) {
    const el = document.createElement('div'); el.id = 'chatbox';
    el.innerHTML = '<div id="chatlog"></div><input id="chatin" maxlength="200" autocomplete="off" style="display:none">';
    document.body.appendChild(el);
    const pl = document.createElement('div'); pl.id = 'mpplate'; pl.style.display = 'none'; document.body.appendChild(pl);
    pl.addEventListener('click', () => { if (pl.dataset.c === 'true') { if (this.h.open() !== 'mp') this.h.toggle('mp'); } });
    const inp = $('chatin') as HTMLInputElement;
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { const t = inp.value.trim(); if (t) this.h.game().enqueue({ t: 'chat', text: t }); this.closeChat(); ev.preventDefault(); }
      else if (ev.key === 'Escape') { this.closeChat(); ev.preventDefault(); }
      ev.stopPropagation();
    });
    inp.addEventListener('blur', () => { if (this.chatOpen) this.closeChat(); });
    document.getElementById('win')!.addEventListener('change', ev => {
      const t = ev.target as HTMLInputElement; if (t.id?.startsWith('mpgen-f')) refreshGenForm('mpgen'); const s = this.h.mp.session; if (!s || !s.isHost) return;
      if (s.state === 'lobby') { if (t.id === 'mpmap') s.setMap({ mode: t.value as any }); else if (t.id === 'mpseed') s.setMap({ seed: (+t.value >>> 0) || 1 }); else if (t.id === 'mpen') s.setMap({ enemies: t.value }); else if (t.id?.startsWith('mpgen-')) s.setMap({ gen: readGen('mpgen'), genv: GEN_VER }); }
      if (t.id === 'mpdem') s.setCfg({ demolish: t.value === 'admins' ? 'admins' : 'all' });
      if (t.id === 'mpbp') s.setCfg({ bp: t.value === 'admins' ? 'admins' : 'all' });
      if (t.id === 'mpjp') s.setCfg({ joinPause: t.checked });
    });
  }
  openChat() { const i = $('chatin') as HTMLInputElement; this.chatOpen = true; i.style.display = 'block'; i.value = ''; i.placeholder = tr('Сообщение — Enter, отмена — Esc'); i.focus(); this.chatSig = ''; }
  closeChat() { const i = $('chatin') as HTMLInputElement; this.chatOpen = false; i.style.display = 'none'; i.blur(); this.chatSig = ''; }
  lost(why: string) { this.lostWhy = why; this.lostUntil = performance.now() + 8000; }
  // ---------- окна ----------
  html(w: string): string | null {
    if (w === 'mp') return this.mpWindow(); if (w === 'players') return this.h.nativeActive?.() ? this.h.nativePlayers?.() || null : this.playersWindow(); return null;
  }
  private colors(cur: string) { return PEER_COLORS.map(c => `<span class="mpsw ${c === cur ? 'on' : ''}" data-act="mpcolor" data-c="${c}" style="background:${c}"></span>`).join(''); }
  private keep(id: string) { return esc((($(id) as HTMLInputElement | null)?.value) || ''); }
  private mpWindow() {
    const mp = this.h.mp, s = mp.session, st = this.h.settings();
    const head = `<div class="panel mp"><div class="title">Совместная игра <span class="x" data-act="close">✕</span></div>${this.h.nativeHtml?.() || ''}`;
    if (this.h.nativeActive?.()) return head + `<button data-act="mpplayers">${tr('Игроки')}</button></div>`;
    if (!s || s.state === 'closed') {
      const rebtn = mp.canReconnect
        ? `<div class="mperr">${esc(mp.reText() || 'Связь с хостом потеряна')}</div><div class="row2"><button class="big" data-act="mprejoin">Переподключиться</button><span class="dim small">${mp.lastJoin && mp.mode !== 'manual' ? 'ваш персонаж и инвентарь ждут вас 5 минут' : 'создаст новый код-запрос — отправьте его хосту, он вставит его в «Игроки → Настройки хоста и приглашения» и пришлёт ответ'}</span></div>`
        : '';
      return head + `${mp.err && !rebtn ? `<div class="mperr">${esc(mp.err)}</div>${mp.lastJoin ? `<div class="row2"><button class="big" data-act="mprejoin">Переподключиться</button><span class="dim small">ваш персонаж и инвентарь ждут вас 5 минут</span></div>` : ''}` : mp.err ? `<div class="dim small">Причина: ${esc(mp.err)}</div>${rebtn}` : rebtn}
        <div class="lbl">Ваш персонаж</div>
        <div class="row2">Имя: <input id="mpname" maxlength="20" value="${esc(st.mpName || '')}" placeholder="Инженер"> Цвет: ${this.colors(st.mpColor)}</div>
        <div class="lbl">Создать игру (вы — хост, от 2 до ${MAX_PEERS} игроков)</div>
        <div class="row2">Карта: <select id="mpmap"><option value="current">Текущая партия</option><option value="new">Новая карта</option></select>
          Seed: <input id="mpseed" size="10" value="${Math.floor(Math.random() * 1e9)}">
          Рой: <select id="mpen">${Object.entries(MODE_N).map(([k, v]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <details class="mpman"><summary>${tr('Вода и ресурсы нового мира')}</summary>${genFormHtml('mpgen')}</details>
        <div class="row2">Пароль (необязательно): <input id="mphpass" size="12" maxlength="40" value="${this.keep('mphpass')}"> <button class="big" data-act="mphost">Создать игру</button><button data-act="mphostm">Без сервера (коды вручную)</button></div>
        <div class="lbl">Войти в игру друга</div>
        <div class="row2">Код: <input id="mpcode" size="10" placeholder="ZVD-XXXX" style="text-transform:uppercase" value="${esc(mp.lastJoin)}"> Пароль: <input id="mppass" size="10" maxlength="40" value="${this.keep('mppass')}"> <button class="big" data-act="mpjoin">Войти</button></div>
        <details class="mpman" ${mp.mode === 'manual' ? 'open' : ''}><summary>Без сервера: обмен кодами вручную</summary>
          <div class="dim small">Хост создаёт игру «Без сервера» и для каждого друга — код приглашения (Z7O…). Друг вставляет его ниже и отправляет хосту код ответа (Z7A…). Не получается — наоборот: друг создаёт «код-запрос» (Z7J…), хост вставляет его и отправляет ответ. Коды длинные — пересылайте через мессенджер, ответ вставляйте сразу, как получили.</div>
          <textarea id="mppaste" rows="3" placeholder="Код приглашения от хоста (Z7O…)">${this.keep('mppaste')}</textarea>
          <div class="row2"><button data-act="mppaste">Получить код ответа</button><button data-act="mpreq">Создать код-запрос</button><button data-act="mpnet">Проверка сети</button></div>
          ${this.manualList()}
        </details>
        ${this.netSettings(st)}
        <div class="dim small">Все игроки считают одну и ту же игру: по сети идут только команды, раз в секунду сверяются контрольные суммы. Нужны одинаковые версия игры и моды. Паузу ставит только хост.</div></div>`;
    }
    if (s.state === 'lobby') {
      const host = s.isHost; const m = s.map;
      const mapCtl = host ? `<div class="lbl">Карта</div><div class="row2"><select id="mpmap"><option value="current" ${m.mode === 'current' ? 'selected' : ''}>Текущая партия</option><option value="new" ${m.mode === 'new' ? 'selected' : ''}>Новая карта</option></select>
        Seed: <input id="mpseed" size="10" value="${m.seed}"> Рой: <select id="mpen">${Object.entries(MODE_N).map(([k, v]) => `<option value="${k}" ${k === m.enemies ? 'selected' : ''}>${v}</option>`).join('')}</select></div>${m.mode === 'new' ? `<details class="mpman"><summary>${tr('Вода и ресурсы нового мира')}</summary>${genFormHtml('mpgen', m.gen)}</details>` : ''}${this.hostCfg()}` : '';
      return head.replace('Совместная игра', 'Совместная игра — лобби') + `<div id="mplive">${this.live()}</div>${mapCtl}${this.manualBlock(mp.mode === 'manual' || mp.manual.length > 0)}</div>`;
    }
    return head + `<div>Игра идёт. Список игроков — ${keyName(st.keys.players)}.</div>
      ${s.isHost ? this.hostCfg() + (mp.code ? `<div class="mpcode">Код комнаты: <b>${esc(mp.code)}</b> <button data-act="mpcopycode">Копировать</button></div>` : '') + this.manualBlock(true) : ''}
      <div class="row2"><button data-act="mpplayers">Игроки</button><button data-act="mpleave">Выйти из совместной игры</button></div></div>`;
  }
  private netSettings(st: Settings) {
    return `<details class="mpman"><summary>Сеть</summary>
      <div class="row2">Сервер сигналинга: <input id="mpserver" size="28" value="${esc(st.mpServer)}"></div>
      <div class="row2">STUN/TURN: <input id="mpice" size="40" value="${esc(st.mpIce)}"></div>
      <div class="dim small">Сервер: <code>node tools/signal-server.mjs</code> (порт 8787). Если прямое соединение не установится за 8 с, данные пойдут через сервер. Для строгих NAT укажите свой TURN: <code>turn:user:pass@host:3478</code>.</div>
    </details>`;
  }
  /** настройки хоста: права, пароль, пауза при входе */
  private hostCfg() {
    const s = this.h.mp.session!; const c = s.cfg;
    return `<details class="mpman"><summary>Настройки хоста</summary>
      <div class="row2">Сносить чужие постройки: <select id="mpdem"><option value="all" ${c.demolish === 'all' ? 'selected' : ''}>все игроки</option><option value="admins" ${c.demolish === 'admins' ? 'selected' : ''}>только хост и админы</option></select></div>
      <div class="row2">Ставить чертежи: <select id="mpbp"><option value="all" ${c.bp === 'all' ? 'selected' : ''}>все игроки</option><option value="admins" ${c.bp === 'admins' ? 'selected' : ''}>только хост и админы</option></select></div>
      <div class="row2"><label><input type="checkbox" id="mpjp" ${c.joinPause ? 'checked' : ''}> Пауза, пока входящему передаётся мир (не дольше 15 с; иначе он догоняет на ускорении)</label></div>
      <div class="row2">Пароль: <input id="mpsetpass" size="14" maxlength="40" value="${esc(c.pass)}"> <button data-act="mpsetpass">Сохранить</button><span class="dim small">${c.pass ? 'вход по паролю' : 'без пароля'}</span></div>
    </details>`;
  }
  /** ручные коды: кнопки, поле вставки, список соединений */
  private manualBlock(open: boolean) {
    const mp = this.h.mp, s = mp.session!; const host = s.isHost;
    if (!host && s.state !== 'lobby') return '';
    return `<details class="mpman" ${open ? 'open' : ''}><summary>${host ? 'Пригласить без сервера (коды вручную)' : 'Соединение по кодам'}</summary>
      ${host ? `<div class="dim small">Для каждого игрока — свой код приглашения. Если не соединяется, игрок может создать «код-запрос» — вставьте его сюда и отправьте ему код ответа.</div>` : ''}
      <div class="row2">${host ? '<button data-act="mpinvite">Новый код приглашения</button>' : '<button data-act="mpreq">Создать код-запрос</button>'}<button data-act="mpnet">Проверка сети</button></div>
      <textarea id="mppaste" rows="2" placeholder="${host ? 'Код ответа (Z7A…) или код-запрос игрока (Z7J…)' : 'Код от хоста (Z7O… или Z7A…)'}">${this.keep('mppaste')}</textarea>
      <div class="row2"><button data-act="mppaste">Вставить код</button></div>
      ${this.manualList()}</details>`;
  }
  private manualList() {
    const mp = this.h.mp; let h = '';
    if (mp.net) h += `<div class="small">Проверка сети: ${esc(mp.net)}</div>`;
    mp.manual.forEach((m, k) => {
      if (m.phase === 'closed') return;
      const title = m.role === 'offer' ? (mp.isHost ? `Приглашение №${m.id}` : `Код-запрос №${m.id}`) : `Ответ на код №${m.forId || '—'}${m.peer ? ` (${esc(m.peer)})` : ''}`;
      h += `<div class="mpconn ${m.phase === 'open' ? 'ok' : m.phase === 'failed' ? 'bad' : ''}"><b>${title}</b> <span class="x" data-act="mpdropm" data-k="${k}" title="Убрать">✕</span>
        <div class="mpst" data-mpst="${k}">${esc(mp.manualText(m))}</div>`;
      if (m.code && (m.phase === 'wait')) h += `<textarea id="mpc${k}" rows="2" readonly>${m.code}</textarea><div class="row2"><button data-act="mpcopy" data-t="mpc${k}">Копировать</button>${m.role === 'answer' ? `<button data-act="mprenew" data-id="${esc(m.forId)}">Новый код ответа</button>` : ''}<span class="dim small">${m.role === 'offer' ? 'отправьте этот код' : `отправьте этот код ${mp.isHost ? 'игроку' : 'хосту'}`}</span></div>`;
      if (m.code) h += `<div class="dim small">Адреса в вашем коде: ${esc(mp.candText(m.mine))}${m.theirs ? ` · в коде второго игрока: ${esc(mp.candText(m.theirs))}` : ''}</div>`;
      if (m.phase === 'failed') h += `<div class="mperr">${esc(m.note)}</div>`;
      h += '</div>';
    });
    return h;
  }
  /** изменяемая часть лобби (обновляется без перерисовки полей ввода) */
  live(): string {
    const mp = this.h.mp, s = mp.session; if (!s) return '';
    const host = s.isHost; let h = '';
    if (mp.code) h += `<div class="mpcode">Код приглашения: <b>${esc(mp.code)}</b> <button data-act="mpcopycode">Копировать</button></div>`;
    else if (host && !mp.serverOk && mp.mode === 'manual') h += `<div class="dim small">Без сервера: пригласите игроков кодами ниже.</div>`;
    if (mp.status) h += `<div class="dim">${esc(mp.status)}</div>`;
    if (mp.err) h += `<div class="mperr">${esc(mp.err)}</div>`;
    h += `<div class="lbl">Игроки (${s.players.length} из ${MAX_PEERS})${s.hasPass || (host && s.cfg.pass) ? ' · вход по паролю' : ''}</div><table class="mpt"><tr class="dim"><td></td><td>Имя</td><td>Пинг</td><td>Готов</td><td></td></tr>`;
    s.players.forEach((p, i) => { h += `<tr><td><span class="mpsw on" style="background:${p.color}"></span></td><td>${esc(p.name)}${i === s.hostPl ? ' <span class="dim">(хост)</span>' : ''}${i === s.me ? ' <span class="dim">(вы)</span>' : ''}</td><td>${i === s.hostPl ? '—' : p.ping + ' мс'}</td><td>${p.ready ? '✓' : '…'}</td><td>${host && i !== s.hostPl ? `<button data-act="mpkick" data-i="${i}">Выгнать</button><button data-act="mpban" data-i="${i}">Запретить</button>` : ''}</td></tr>`; });
    if (!s.players.length) h += `<tr><td colspan="5" class="dim">${mp.manual.length ? 'Ждём соединения по кодам — состояние ниже' : 'Соединение с хостом…'}</td></tr>`;
    h += '</table>';
    const m = s.map; if (!host && s.players.length) h += `<div class="small">Карта: ${m.mode === 'new' ? `новая, seed ${m.seed}, Рой: ${MODE_N[m.enemies] || m.enemies}` : 'текущая партия хоста'}</div>`;
    const ms = host ? s.mods : s.hostMods || s.mods; h += `<div class="small dim">Моды: ${ms.mods.length ? ms.mods.map(x => esc(x.id + " " + x.ver)).join(', ') : 'нет'} · данные игры ${ms.data}${!host && s.hostMods ? (s.hostMods.data === s.mods.data ? ' · совпадают ✓' : ' · НЕ совпадают') : ''}</div>`;
    const me = s.players[s.me];
    h += '<div class="row2">';
    if (host) h += `<button class="big" data-act="mpstart" ${s.allReady() ? '' : 'disabled'}>Начать</button>${s.players.length < 2 ? '<span class="dim small">Ждём игроков…</span>' : !s.allReady() ? '<span class="dim small">Ждём «Готов» от всех</span>' : ''}`;
    else if (me && s.players.length) h += `<button class="big" data-act="mpready">${me.ready ? 'Не готов' : 'Готов'}</button>`;
    h += `<button data-act="mpleave">Выйти</button></div>`;
    return h;
  }
  private playersWindow() {
    const mp = this.h.mp, s = mp.session, g = this.h.game(); const st = this.h.settings();
    let h = `<div class="panel mp"><div class="title">Игроки (${esc(keyName(st.keys.players))}) <span class="x" data-act="close">✕</span></div>`;
    if (!s || s.state !== 'game') return h + `<div class="dim">Одиночная игра. Совместная — Esc → «Совместная игра».</div></div>`;
    const v = g.mpv?.mp; const peers = g.mpv?.peers || []; const meRole = s.players[s.me]?.role; const admin = s.isHost || meRole === 'admin';
    h += `<div class="small">Хост: <b>${esc(s.players[s.hostPl]?.name || '?')}</b> · игроков в игре: ${s.players.filter(p => p.on).length} из ${MAX_PEERS}${s.hasPass || s.cfg.pass ? ' · вход по паролю' : ''} · снос чужого: ${s.cfg.demolish === 'admins' ? 'хост и админы' : 'все'} · чертежи: ${s.cfg.bp === 'admins' ? 'хост и админы' : 'все'}</div>`;
    h += `<table class="mpt"><tr class="dim"><td></td><td>Имя</td><td>Роль</td><td>Пинг</td><td>Состояние</td><td></td></tr>`;
    s.players.forEach((p, i) => {
      const P = peers[i]; let state = 'в игре';
      if (p.join) state = s.xfer && !s.xfer.me ? `входит: ${s.xfer.pct}%` : 'входит';
      else if (!p.on) state = P?.off === 2 ? 'ушёл (персонаж убран)' : 'нет связи — персонаж ждёт';
      else if (P?.dead) state = 'погиб';
      const role = i === s.hostPl ? 'host' : p.role;
      let btn = '';
      if (admin && i !== s.hostPl && i !== s.me && (s.isHost || p.role !== 'admin')) btn += `<button data-act="mpkick" data-i="${i}">Выгнать</button><button data-act="mpban" data-i="${i}">Запретить</button>`;
      if (s.isHost && i !== s.hostPl) btn += p.role === 'admin' ? `<button data-act="mprole" data-i="${i}" data-r="player">Снять админа</button>` : `<button data-act="mprole" data-i="${i}" data-r="admin">Сделать админом</button>`;
      if (s.isHost && i !== s.hostPl && p.on && !p.join) btn += `<button data-act="mpxfer" data-i="${i}">Передать хоста</button>`;
      h += `<tr><td><span class="mpsw on" style="background:${p.color}"></span></td><td>${esc(p.name)}${i === s.me ? ' <span class="dim">(вы)</span>' : ''}</td><td>${ROLE_N[role] || role}</td><td>${i === s.hostPl ? '—' : p.on ? p.ping + ' мс' : '—'}</td><td>${state}</td><td>${btn}</td></tr>`;
    });
    h += '</table>';
    if (s.bans.length && s.isHost) h += `<div class="small dim">Запрещён вход до конца сеанса: ${s.bans.length} <button data-act="mpunban">Снять запреты</button></div>`;
    const d = v?.delay ?? s.delay; const kind = mp.kinds.filter(Boolean); const kn = kind.includes('relay') ? 'через сервер (ретрансляция)' : 'WebRTC напрямую';
    h += `<div class="small">Задержка ввода: ${d} тиков (≈ ${Math.round(d * 1000 / 60)} мс) · запас кадров: ${v?.buf ?? 0} · пинг: ${s.ping()} мс · связь: ${kn}</div>`;
    h += `<div class="small">Рассинхронов: ${s.desyncs} · пересинхронизаций: ${s.resyncs}${s.paused ? ' · <b>пауза хоста</b>' : ''}</div>`;
    h += '<div class="row2">';
    if (s.isHost) h += `<button data-act="mppause">${s.paused ? 'Продолжить' : 'Пауза'}</button><button data-act="mpopen">Настройки хоста и приглашения</button>`;
    if (mp.reports.length) h += `<button data-act="mpreport">Скачать отчёт о рассинхроне (${mp.reports.length})</button>`;
    h += `<button data-act="mpleave">Выйти из совместной игры</button></div>`;
    h += `<div class="dim small">Чат — ${esc(keyName(st.keys.chat))}, метка на карте — ${esc(keyName(st.keys.mark))} + ЛКМ. Паузу ставит только хост. Выпавший игрок возвращается к своему персонажу и инвентарю, если войдёт в течение 5 минут.</div></div>`;
    return h;
  }
  // ---------- действия ----------
  act(a: string, el: HTMLElement): boolean {
    const mp = this.h.mp; const val = (id: string) => (($(id) as HTMLInputElement | null)?.value ?? '').trim();
    const saveForm = () => { const p: Partial<Settings> = {}; if ($('mpname')) p.mpName = val('mpname').slice(0, 20); if ($('mpserver')) p.mpServer = val('mpserver'); if ($('mpice')) p.mpIce = val('mpice'); this.h.setSettings(p); };
    const fail = (e: any) => { mp.err = (e as Error)?.message || String(e); this.h.render(); };
    const s = mp.session; const i = +(el.dataset.i ?? -1);
    switch (a) {
      case 'mpopen': this.h.toggle('mp'); return true;
      case 'mpcolor': this.h.setSettings({ mpColor: el.dataset.c! }); saveForm(); el.parentElement?.querySelectorAll('[data-act="mpcolor"]').forEach(x => x.classList.toggle('on', x === el)); return true; // без перерисовки: поля формы сохраняются
      case 'mphost': case 'mphostm': {
        saveForm(); const map = { mode: val('mpmap') as any || 'current', seed: (+val('mpseed') >>> 0) || 1, enemies: val('mpen') || 'normal', gen: readGen('mpgen'), genv: GEN_VER };
        this.h.chooseSession();
        mp.host(map, a === 'mphostm', val('mphpass')).then(() => this.h.render(), fail); this.h.render(); return true;
      }
      case 'mpjoin': { saveForm(); this.pass = val('mppass'); const code = val('mpcode').toUpperCase(); if (!code) { mp.err = tr('Введите код приглашения'); this.h.render(); return true; } this.h.chooseSession(); mp.join(code).catch(fail); this.h.render(); return true; }
      case 'mprejoin': { saveForm(); this.pass = val('mppass') || this.pass; this.h.chooseSession(); mp.reconnectNow().then(() => this.h.render(), fail); this.h.render(); return true; }
      case 'mppaste': { saveForm(); if (!mp.session || mp.session.state === 'closed') this.pass = val('mppass'); const code = val('mppaste'); mp.err = '';
        this.h.chooseSession();
        mp.pasteCode(code).then(() => { const t = $('mppaste') as HTMLTextAreaElement | null; if (t) t.value = ''; this.h.render(); }, fail); return true; }
      case 'mpreq': saveForm(); if (!mp.session || mp.session.state === 'closed') this.pass = val('mppass'); this.h.chooseSession(); mp.makeOffer().then(() => this.h.render(), fail); this.h.render(); return true;
      case 'mpinvite': mp.makeOffer().then(() => this.h.render(), fail); return true;
      case 'mprenew': mp.renewAnswer(el.dataset.id || '').then(() => this.h.render(), fail); return true;
      case 'mpdropm': { const m = mp.manual[+el.dataset.k!]; if (m) mp.dropManual(m); this.h.render(); return true; }
      case 'mpnet': mp.checkNet().then(() => this.h.render()); this.h.render(); return true;
      case 'mpcopy': case 'mpcopycode': { const t = a === 'mpcopycode' ? mp.code : (($(el.dataset.t!) as HTMLTextAreaElement)?.value || ''); navigator.clipboard?.writeText(t).then(() => this.h.msg('Скопировано'), () => { const x = $(el.dataset.t || '') as HTMLTextAreaElement | null; x?.select(); }); return true; }
      case 'mpready': { if (s) { const me = s.players[s.me]; s.setReady(!(me && me.ready)); } return true; }
      case 'mpstart': { if (s) { this.h.chooseSession(); s.startGame().catch(fail); } return true; }
      case 'mpleave': mp.close(); this.h.close(); this.h.msg('Вы вышли из совместной игры — партия продолжается у вас одиночной'); return true;
      case 'mpplayers': this.h.toggle('players'); return true;
      case 'mppause': { if (s) s.pause(!s.paused); this.h.render(); return true; }
      case 'mpkick': case 'mpban': { if (s && s.players[i] && confirm(tr(a === 'mpban' ? 'Выгнать игрока и запретить ему входить до конца сеанса?' : 'Выгнать игрока? Он сможет войти снова.'))) { s.kick(i, a === 'mpban'); mp.tele(a === 'mpban' ? 'ban' : 'kick'); } this.h.render(); return true; }
      case 'mpdrop': { if (s && confirm(tr('Продолжить без этого игрока? Он не сможет вернуться в эту игру.'))) { s.drop(i); mp.tele('drop'); } this.h.render(); return true; }
      case 'mprole': { s?.setRole(i, el.dataset.r === 'admin' ? 'admin' : 'player'); this.h.render(); return true; }
      case 'mpxfer': { if (s && confirm(tr('Передать хоста этому игроку? Игра не остановится, остальные переподключатся к нему.'))) { if (!s.transfer(i)) this.h.msg('Сейчас передать хоста нельзя — подождите, пока закончится вход игрока'); else mp.tele('transfer'); } this.h.render(); return true; }
      case 'mpunban': { if (s) s.bans = []; this.h.render(); return true; }
      case 'mpsetpass': { s?.setCfg({ pass: val('mpsetpass') }); this.h.msg(val('mpsetpass') ? 'Пароль установлен' : 'Пароль снят'); this.h.render(); return true; }
      case 'mpreport': { const r = mp.reports[mp.reports.length - 1]; if (r) this.h.download(`zavod7-desync-${r.hostTick}.json`, JSON.stringify({ format: 'zavod7-desync', ...r, local: safeJson(r.local), host: safeJson(r.host) })); return true; }
    }
    return false;
  }
  /** пароль для входа (клиент) — передаётся сеансу через opts() */
  pass = '';
  // ---------- каждый кадр ----------
  hud() {
    this.frame++; const mp = this.h.mp, s = mp.session, g = this.h.game();
    if (this.h.open() === 'mp' && this.frame % 10 === 0) {
      const live = $('mplive'); if (live) { const h = this.live(); if (h !== this.liveSig) { this.liveSig = h; live.innerHTML = tr(h); } }
      document.querySelectorAll<HTMLElement>('[data-mpst]').forEach(e => { const m = mp.manual[+e.dataset.mpst!] as Manual | undefined; if (m) { const t = tr(mp.manualText(m)); if (e.textContent !== t) e.textContent = t; } });
    }
    // плашка
    const pl = $('mpplate')!; let t = '';
    const v = g.mpv?.mp; const x = s?.xfer;
    if (s && x && x.me && s.state !== 'closed') t = `Загрузка мира: ${x.pct}%${x.total ? ` из ${(x.total / 1048576).toFixed(1)} МБ` : ''}${x.eta ? ` (~${mmss(x.eta)})` : ''}`;
    else if (s && s.state === 'game') {
      if (s.rehosting) t = 'Передача хоста: переподключение…';
      else if (s.syncing) t = 'Синхронизация…';
      else if (x && !x.me) t = `Подключается игрок ${x.name}: ${x.pct}%${x.eta ? ` (~${mmss(x.eta)})` : ''}${s.paused && s.pauseWhy === 'join' ? ' · пауза' : ''}`;
      else if (s.paused || v?.paused) t = s.isHost ? 'Пауза (F9 — продолжить)' : 'Пауза (хост)';
      else if (v && v.wait > 400) t = 'Ожидание игроков…';
      else if (v && v.buf > 90 && !s.isHost) t = `Догоняем игру: ${Math.round(v.buf / 60)} с`;
    } else if (mp.re || mp.canReconnect) t = mp.reText();
    else if (performance.now() < this.lostUntil) t = this.lostWhy || 'Связь с хостом потеряна';
    const clickable = !!t && !s?.xfer && (mp.re != null || mp.canReconnect); if (pl.dataset.c !== String(clickable)) { pl.dataset.c = String(clickable); pl.style.pointerEvents = clickable ? 'auto' : 'none'; pl.style.cursor = clickable ? 'pointer' : ''; }
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

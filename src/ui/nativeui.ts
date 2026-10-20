import type { NativeClient } from '../client/native';
import type { Game } from '../sim/game';
import { tr } from '../core/i18n';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const states: Record<string, string> = { stopped: 'Сервер выключен', starting: 'Запуск сервера…', running: 'Сервер работает', stopping: 'Сохранение и остановка…', error: 'Ошибка сервера' };
export class NativeUI {
  private installer: string | null = null;
  constructor(private client: NativeClient, private game: () => Game, private render: () => void, private canTransfer: () => boolean) {
    if (location.protocol === 'file:' && document.querySelector('link[rel="zavod-native-installer"]')?.getAttribute('href') === './native/Zavod7-Server-Setup.exe') this.installer = './native/Zavod7-Server-Setup.exe';
    // A packaged download is offered only after it actually exists. Dev-server HTML fallbacks fail this check.
    if (location.protocol === 'http:' || location.protocol === 'https:') void fetch('./native/Zavod7-Server-Setup.exe', { method: 'HEAD', cache: 'no-store', redirect: 'error' }).then(r => {
      if (r.ok && !/text\/html/i.test(r.headers.get('content-type') || '') && Number(r.headers.get('content-length')) > 0) { this.installer = './native/Zavod7-Server-Setup.exe'; this.render(); }
    }).catch(() => {});
  }
  private settingsForm() {
    const settings = this.client.settings;
    const maxPlayers = settings?.maxPlayers ?? 8;
    const admins = new Set(settings?.adminPlayerIds || []);
    const roster = settings?.roster || [];
    return `<details${settings ? '' : ' open'}><summary>${tr('Дополнительные настройки сервера')}</summary>
      <div class="row2"><label>${tr('Игроков:')} <select id="native-players"><option value="8" ${maxPlayers === 8 ? 'selected' : ''}>8</option><option value="16" ${maxPlayers === 16 ? 'selected' : ''}>16</option></select></label><label><input id="native-pause-empty" type="checkbox" ${settings?.pauseWhenEmpty !== false ? 'checked' : ''}> ${tr('Приостанавливать мир, когда игроки вышли')}</label></div>
      <label>${tr('Доступ к комнате:')} <select id="native-access-mode"><option value="invite" ${settings?.accessMode !== 'whitelist' ? 'selected' : ''}>${tr('По приглашению')}</option><option value="whitelist" ${settings?.accessMode === 'whitelist' ? 'selected' : ''}>${tr('Приглашение и белый список устройств')}</option></select></label>
      <label>${tr('Пароль комнаты:')} <input id="native-password" type="password" maxlength="128" autocomplete="new-password" placeholder="${settings?.passwordSet ? tr('Пустое поле оставит текущий пароль') : tr('Необязательно')}"></label>
      ${settings?.passwordSet ? `<label><input id="native-clear-password" type="checkbox"> ${tr('Удалить текущий пароль')}</label>` : ''}
      ${roster.length ? `<div class="dim small">${tr('Администраторы назначаются по ID игрока; имя не меняет права.')}</div><div class="native-access-list">${roster.map(row => `<label><input type="checkbox" name="native-admin" value="${esc(row.playerId)}" ${admins.has(row.playerId) || row.role === 'owner' ? 'checked' : ''} ${row.role === 'owner' ? 'disabled' : ''}> ${esc(row.name)} · ${esc(row.playerId)}${row.online ? ` · ${tr('в сети')}` : ''}</label>`).join('')}</div>` : `<div class="dim small">${tr('Владелец мира будет администратором.')}</div>`}
      <label>${tr('Добавить отпечаток ключа допуска:')} <textarea id="native-whitelist-add" rows="2" maxlength="4400" placeholder="${tr('64 шестнадцатеричных символа на строку')}"></textarea></label>
      ${settings?.whitelistFingerprints.length ? `<div class="dim small">${tr('Удалить сохранённые записи:')}</div><div class="native-access-list">${settings.whitelistFingerprints.map(hash => `<label><input type="checkbox" name="native-whitelist-remove" value="${esc(hash)}"> ${tr('Отпечаток устройства')} · ${esc(hash.slice(0, 12))}</label>`).join('')}</div>` : ''}
      ${settings ? `<button data-act="native-settings-save" ${this.client.busy ? 'disabled' : ''}>${tr('Сохранить настройки')}</button>` : `<div class="dim small">${tr('Ключ допуска остаётся в профиле устройства; владельцу сообщают только отпечаток.')}</div>`}
    </details>`;
  }
  html() {
    const c = this.client, s = c.status, disabled = c.busy ? 'disabled' : '';
    const reachability = s?.invite?.reachability;
    const reachabilityText = reachability === 'local-only' ? 'Доступ только в локальной сети' : reachability === 'relay-configured' ? 'Подключение через настроенный ретранслятор' : reachability === 'proxy-configured' ? 'Подключение через настроенный HTTPS-прокси' : reachability === 'relay-unavailable' ? 'Ретранслятор недоступен' : 'HTTPS-прокси недоступен';
    let h = `<section class="native-server"><div class="lbl">${tr('Сервер на этом компьютере')}</div>`;
    if (c.connecting) h += `<div role="status">${tr('Подключение к серверу…')}${c.loading ? ` · ${Math.floor(c.loading.received * 100 / Math.max(1, c.loading.total))}%` : ''} <button data-act="native-cancel-join">${tr('Отменить подключение')}</button></div>`;
    if (c.error) h += `<div class="mperr" role="alert">${esc(tr(c.error))}</div>`;
    if (c.connected) h += `<div class="dim small" role="status">${tr(c.transportRoute === 'rtc' ? 'Прямое соединение WebRTC' : c.transportRoute === 'ws' ? 'Резервное соединение с сервером' : 'Восстановление соединения…')}</div>`;
    if (!c.available) return h + (c.engaged ? `<p>${tr(c.connected ? 'Вы подключены к серверу. Мир сохранится при закрытии вкладки.' : 'Связь потеряна. Ваш персонаж и инвентарь сохранены на сервере.')}</p><label>${tr('Пароль комнаты, если он задан:')} <input id="native-guest-password" type="password" maxlength="128" autocomplete="off"></label><button data-act="native-join" ${c.connected ? 'disabled' : ''}>${tr('Переподключиться к серверу')}</button>` : `<p>${tr('Приложение сервера продолжает игру, даже когда вкладка закрыта.')}</p><div class="row2"><a class="button" href="zavod7://server">${tr('Открыть приложение сервера')}</a>${this.installer ? `<a class="button" href="${this.installer}" download>${tr('Скачать приложение сервера')}</a>` : ''}</div><p class="dim small">${tr('Управление откроется в защищённой локальной вкладке приложения.')}</p><div class="row2"><input id="native-guest-code" maxlength="512" autocomplete="off" placeholder="${tr('Приглашение этого сервера')}"><button data-act="native-guest-join">${tr('Войти по приглашению')}</button></div><label>${tr('Пароль комнаты, если он задан:')} <input id="native-guest-password" type="password" maxlength="128" autocomplete="off"></label><div class="dim small">${tr('Отпечаток ключа допуска:')} <code>${esc(c.guestDeviceId)}</code> <button data-act="native-copy-device">${tr('Копировать отпечаток')}</button></div>`) + '</section>';
    h += `<div role="status">${esc(tr(s ? states[s.controller.state] || s.controller.state : 'Обновление состояния…'))}${s?.world ? ' · ' + esc(s.world.name) + ' · ' + s.world.players + '/' + s.world.maxPlayers : ''}</div>`;
    if (s?.controller.health) h += `<div class="dim small">${esc(tr(s.controller.health))}</div>`;
    if (c.unresolvedHandoff) return h + `<p>${tr('Мир заморожен до подтверждения передачи серверу.')}</p><div class="row2"><button data-act="native-resolve" ${disabled}>${tr('Проверить передачу мира')}</button><button data-act="native-abort" ${disabled}>${tr('Отменить незавершённую передачу')}</button></div></section>`;
    if (c.engaged) h += `<p>${tr(c.connected ? 'Вы подключены к серверу. Мир сохранится при закрытии вкладки.' : 'Связь потеряна. Ваш персонаж и инвентарь сохранены на сервере.')}</p>`;
    if (s?.controller.state === 'running') {
      h += `<div class="row2"><button data-act="native-join" ${c.connected || c.busy ? 'disabled' : ''}>${tr(c.engaged ? 'Переподключиться к серверу' : 'Войти на сервер')}</button><button data-act="native-stop" ${disabled}>${tr('Сохранить и выключить сервер')}</button></div>`;
      if (s.invite?.ready && s.invite.code) h += `<div class="mpcode">${tr('Приглашение сервера:')} <b style="user-select:all;overflow-wrap:anywhere">${esc(s.invite.code)}</b> <button data-act="native-copy">${tr('Копировать')}</button></div><div class="dim small">${tr('Действует до')} ${esc(new Date(s.invite.expiresAt).toLocaleTimeString())} · ${tr(reachabilityText)}</div>`;
      else h += `<p class="dim small">${tr('Мир работает локально. Приглашение появится после проверки маршрута подключения.')}</p>`;
      h += `<button data-act="native-invite" ${disabled}>${tr('Обновить приглашение')}</button>`;
      h += this.settingsForm();
    } else if (s?.controller.state === 'stopped') {
      h += this.settingsForm();
      h += `<button data-act="native-start" ${disabled}>${tr('Запустить новый мир')}</button>`;
      if (c.worlds.length) h += `<div class="row2"><select id="native-world">${c.worlds.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')}</select><button data-act="native-open" ${disabled}>${tr('Открыть сохранённый мир на сервере')}</button></div>`;
      h += `<div class="row2"><button data-act="native-handoff" ${c.busy || c.engaged || !this.canTransfer() ? 'disabled' : ''}>${tr('Передать текущую игру серверу')}</button></div>`;
      if (!this.canTransfer()) h += `<div class="dim small">${tr('Передать мир может только его текущий хост.')}</div>`;
    }
    return h + `<div class="row2"><button data-act="native-refresh" ${disabled}>${tr('Обновить состояние сервера')}</button></div></section>`;
  }
  players() {
    const c = this.client, peers = this.game().mpv?.peers || [];
    return `<div class="panel mp"><div class="title">${tr('Игроки сервера')} <span class="x" data-act="close">✕</span></div>${c.connected ? '' : `<div class="mperr">${tr('Соединение с сервером потеряно')}</div>`}<table class="mpt"><tr><th>${tr('Имя')}</th><th>${tr('Роль')}</th><th>${tr('Состояние')}</th></tr>${peers.map(p => `<tr><td>${esc(p.name)}</td><td>${tr(p.role === 'host' ? 'Владелец' : p.role === 'admin' ? 'Администратор' : 'Игрок')}</td><td>${tr(p.off ? 'Нет связи' : 'В игре')}</td></tr>`).join('')}</table><button data-act="mpopen">${tr('Управление сервером')}</button></div>`;
  }
  act(action: string) {
    if (!action.startsWith('native-')) return false;
    const c = this.client;
    const value = (id: string) => (document.getElementById(id) as HTMLSelectElement | null)?.value || '';
    const settings = (): import('../net/native-protocol').NativeSettingsUpdate => {
      const password = value('native-password');
      const checked = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.checked || false;
      return {
        maxPlayers: value('native-players') === '16' ? 16 : 8,
        pauseWhenEmpty: (document.getElementById('native-pause-empty') as HTMLInputElement | null)?.checked ?? true,
        accessMode: value('native-access-mode') === 'whitelist' ? 'whitelist' : 'invite',
        ...(password ? { password } : {}), ...(checked('native-clear-password') ? { clearPassword: true } : {}),
        adminPlayerIds: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="native-admin"]:checked')).map(el => el.value),
        whitelistFingerprints: value('native-whitelist-add').split(/[\s,;]+/).filter(Boolean),
        removeWhitelistFingerprints: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="native-whitelist-remove"]:checked')).map(el => el.value),
      };
    };
    let promise: Promise<unknown> | undefined;
    switch (action) {
      case 'native-refresh': promise = c.refresh(); break;
      case 'native-start': promise = c.action('start', undefined, value('native-players') === '16' ? 16 : 8, settings()); break;
      case 'native-settings-save': promise = c.updateSettings(settings()); break;
      case 'native-open': if (value('native-world')) promise = c.action('openWorld', value('native-world')); break;
      case 'native-stop': promise = c.action('stop'); break;
      case 'native-invite': promise = c.action('rotateInvite'); break;
      case 'native-handoff': if (this.canTransfer()) promise = c.handoff(tr('Партия инженера')); break;
      case 'native-resolve': promise = c.resolveHandoff(); break;
      case 'native-abort': promise = c.abortHandoff(); break;
      case 'native-join': promise = c.join(undefined, value('native-guest-password')); break;
      case 'native-cancel-join': c.disconnect(); break;
      case 'native-guest-join': if (value('native-guest-code')) promise = c.joinInvitation(value('native-guest-code'), value('native-guest-password')); break;
      case 'native-copy-device': {
        const deviceId = c.guestDeviceId;
        if (!deviceId) { c.error = tr('Сначала откройте приглашение сервера'); this.render(); break; }
        if (navigator.clipboard?.writeText) promise = navigator.clipboard.writeText(deviceId).catch(() => { c.error = tr('Отпечаток устройства:') + ' ' + deviceId; this.render(); });
        else { c.error = tr('Отпечаток устройства:') + ' ' + deviceId; this.render(); }
        break;
      }
      case 'native-copy': if (c.status?.invite?.ready && c.status.invite.code) {
        const fallback = () => { c.error = tr('Приглашение выделено — скопируйте его вручную'); this.render(); const code = document.querySelector('.native-server .mpcode b'); if (code) { const range = document.createRange(); range.selectNodeContents(code); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); } };
        if (navigator.clipboard?.writeText) promise = navigator.clipboard.writeText(c.status.invite.code).catch(fallback); else fallback();
        break;
      }
    }
    if (promise) void promise.catch(e => { c.error = e instanceof Error ? e.message : String(e); this.render(); });
    return true;
  }
}

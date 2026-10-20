// Настройки (M10): громкость, клавиши, графика, автосохранение. Хранятся в localStorage отдельно от сохранений.
/** клавиши: [действие, подпись, по умолчанию, группа]. v1.11: значение — код клавиши, кнопка мыши (Mouse1 — средняя,
 *  Mouse3/Mouse4 — «назад»/«вперёд») или сочетание «Ctrl+Shift+KeyX»; у каждого действия есть второе назначение (keys2). */
export const ACTIONS: [string, string, string, string?][] = [
  ['up', 'Вверх', 'KeyW', 'move'], ['left', 'Влево', 'KeyA', 'move'], ['down', 'Вниз', 'KeyS', 'move'], ['right', 'Вправо', 'KeyD', 'move'],
  ['inv', 'Инвентарь и крафт', 'KeyE', 'win'], ['tech', 'Технологии', 'KeyT', 'win'], ['stats', 'Статистика', 'KeyP', 'win'], ['calc', 'Калькулятор производства', 'KeyK', 'win'], ['map', 'Карта', 'KeyM', 'win'], ['bp', 'Библиотека чертежей', 'KeyB', 'win'], ['logi', 'Логистическая сеть', 'KeyL', 'win'], ['trains', 'Поезда', 'KeyY', 'win'], ['vehicle', 'Сесть в локомотив / выйти', 'KeyV'],
  ['rotate', 'Повернуть', 'KeyR'], ['pipette', 'Пипетка / очистить руку', 'KeyQ'], ['pickup', 'Подобрать', 'KeyF'], ['droneAction', 'Действие выбранного боевого дрона', 'Shift+KeyF'], ['flipv', 'Отразить чертёж по вертикали', 'KeyG'], ['pollution', 'Слой загрязнения', 'KeyU'],
  ['shoot', 'Стрелять', 'Space'], ['nextGun', 'Следующее оружие', 'KeyX'], ['holster', 'Убрать/достать оружие', 'Alt+KeyX'], ['ranges', 'Радиусы турелей (выкл. / наведённая / все)', 'Alt+KeyZ'], ['gear', 'Снаряжение', 'KeyH', 'win'], ['swarm', 'Рой', 'KeyZ', 'win'], ['pause', 'Пауза', 'F9'], ['debug', 'Отладка', 'F3'],
  ['copy', 'Копировать (чертёж)', 'Ctrl+KeyC', 'tool'], ['cut', 'Вырезать', 'Ctrl+KeyX', 'tool'], ['paste', 'Вставить последний чертёж', 'Ctrl+KeyV', 'tool'], ['undo', 'Отменить', 'Ctrl+KeyZ', 'tool'], ['redo', 'Повторить', 'Ctrl+KeyY', 'tool'], ['decon', 'Планировщик сноса', 'Alt+KeyD', 'tool'], ['upgrade', 'Планировщик улучшений', 'Alt+KeyU', 'tool'],
  ['bio', 'Забор биоматериала', 'Alt+KeyB', 'tool'],
  ['bug', 'Отчёт об ошибке', 'F8', 'win'], ['console', 'Консоль модов', 'Ctrl+Backquote', 'win'], ['gconsole', 'Консоль команд (/creative, /survival)', 'Backquote', 'win'], ['factory', 'Управление заводом', 'KeyC', 'win'], ['help', 'Окно «Управление»', 'F1', 'win'],
  ['players', 'Список игроков', 'Tab', 'mp'], ['chat', 'Чат', 'Enter', 'mp'], ['mark', 'Метка на карте (+ ЛКМ)', 'AltLeft', 'mp'],
  // v1.11: 4 ряда быстрого доступа — 1…0, Shift+1…0, Alt+1…0, Alt+Shift+1…0
  ...[0, 1, 2, 3].flatMap(r => Array.from({ length: 10 }, (_, i) => [`hb${r}_${i}`, `Ряд ${r + 1}, ячейка ${(i + 1) % 10}`, (['', 'Shift+', 'Alt+', 'Alt+Shift+'][r]) + 'Digit' + ((i + 1) % 10), 'hot'] as [string, string, string, string])),
];
export const KEY_GROUPS: [string, string][] = [['move', 'Движение'], ['', 'Действия'], ['tool', 'Инструменты'], ['win', 'Окна'], ['mp', 'Совместная игра'], ['hot', 'Быстрый доступ']];
/** v1.11: готовые раскладки (кроме своих назначений) — меняют только движение */
export const KEY_PRESETS: Record<string, [string, Record<string, string>]> = {
  wasd: ['WASD', { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD' }],
  esdf: ['ESDF', { up: 'KeyE', left: 'KeyS', down: 'KeyD', right: 'KeyF', inv: 'KeyI', pickup: 'KeyG', flipv: 'KeyH', gear: 'KeyJ' }],
  arrows: ['Стрелки', { up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight' }],
  zqsd: ['ZQSD (AZERTY — по положению клавиш)', { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD' }],
  ijkl: ['IJKL (левая рука на мыши)', { up: 'KeyI', left: 'KeyJ', down: 'KeyK', right: 'KeyL', logi: 'KeyO', inv: 'KeyU', pollution: 'KeyN', calc: 'KeyH', gear: 'Semicolon' }],
};
export interface Settings {
  master: number; sfx: number; music: number; ambient: number; speakerVolume: number;
  autosaveMin: number; smoke: boolean; dayNight: boolean; shake: boolean; /** v1.16 rc.7: звук правил оповещения (личная настройка клиента) */ ruleSound: boolean; uiScale: number;
  keys: Record<string, string>; simWorker: boolean; lang: 'ru' | 'en'; colorblind: boolean; renderer: 'auto' | 'webgl' | 'canvas';
  /** качество графики (п. 5 плана 1.0): пресет; '' — ещё не выбран, при первом запуске подбирается по железу (client/gfx.ts) */
  gfx: '' | 'high' | 'medium' | 'low' | 'min' | 'custom'; gfxAuto: boolean;
  /** разрешение отрисовки: доля от пикселей экрана и потолок devicePixelRatio */
  resScale: number; dprMax: number;
  /** ограничение кадров в секунду: 0 — как у монитора */
  fpsCap: number;
  /** подробная поверхность вблизи (контуры берегов, 2K-текстуры, отдельные спрайты); выкл — дешёвый кеш чанков */
  detail: boolean;
  /** v1.9: карта издалека (LOD) — при сильном отдалении чанки рисуются готовыми картинками, без построек по одной */
  lod: boolean;
  /** колесо и тачпад: auto — определять по событиям, mouse — шаг на щелчок колеса, touchpad — плавно */
  wheel: 'auto' | 'mouse' | 'touchpad';
  /** macOS: Ctrl+щелчок работает как правая кнопка (добыча, копирование рецепта) */
  ctrlClick: boolean;
  /** озвучка (п. 6 плана 1.0): громкость голоса, что озвучивать из интерфейса, скорость речи, выбранный голос браузера ('' — авто) */
  voice: number; uiVoice: 'off' | 'important' | 'all'; voiceRate: number; voiceName: string;
  /** обучающие подсказки при первом открытии окон */
  tips: boolean;
  /** v1.12: совместная игра — имя и цвет персонажа, сервер сигналинга, STUN/TURN */
  mpName: string; mpColor: string; mpServer: string; mpIce: string;
  /** v1.11: второе назначение клавиш; быстрая погрузка — Shift (по умолчанию) или Ctrl; рядов быстрого доступа (1–4) */
  keys2: Record<string, string>; quickKey: 'shift' | 'ctrl'; hotRows: number;
  /** v1.11: масштаб мини-карты (клеток на пиксель); спрашивать перед закрытием вкладки */ miniZoom: number; leaveGuard: boolean;
}
const KEY = 'zavod7:settings';
export const DEFAULTS: Settings = { lod: true, master: 0.8, sfx: 0.8, music: 0.45, ambient: 0.6, speakerVolume: 1, autosaveMin: 5, smoke: true, dayNight: true, shake: true, ruleSound: true, uiScale: 1, simWorker: true, renderer: 'auto', lang: (typeof navigator !== 'undefined' && navigator.language && !/^(ru|be|uk|kk)/i.test(navigator.language)) ? 'en' : 'ru', colorblind: false, gfx: '', gfxAuto: false, resScale: 1, dprMax: 3, fpsCap: 0, detail: true, wheel: 'auto', ctrlClick: true, voice: 0.8, uiVoice: 'off', voiceRate: 1, voiceName: '', tips: true, mpName: '', mpColor: '#d2782e', mpServer: typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.hostname ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787` : 'ws://localhost:8787', mpIce: 'stun:stun.l.google.com:19302', keys: Object.fromEntries(ACTIONS.map(a => [a[0], a[2]])), keys2: {}, quickKey: 'shift', hotRows: 2, miniZoom: 1, leaveGuard: true };
export function loadSettings(): Settings {
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); const speakerVolume = Number.isFinite(s.speakerVolume) ? Math.max(0, Math.min(1, s.speakerVolume)) : DEFAULTS.speakerVolume; return { ...DEFAULTS, ...s, speakerVolume, keys: { ...DEFAULTS.keys, ...(s.keys || {}) }, keys2: { ...(s.keys2 || {}) } }; } catch { return { ...DEFAULTS, keys: { ...DEFAULTS.keys }, keys2: {} }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ } }
/** читаемое имя клавиши или сочетания (v1.11: «Ctrl+Shift+X», кнопки мыши, буква своей раскладки в скобках) */
export function keyName(code: string): string {
  if (!code) return '—';
  if (code.includes('+') && code !== '+') return code.split('+').map((p, i, a) => i < a.length - 1 ? (p === 'Meta' ? 'Cmd' : p) : keyName(p)).join('+');
  if (code.startsWith('Key:')) return code.slice(4).toUpperCase();
  if (code.startsWith('Key')) { const l = LAYOUT.get(code); const c = code.slice(3); return l && l.toUpperCase() !== c ? `${c} (${l.toUpperCase()})` : c; }
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6).replace('Add', '+').replace('Subtract', '−').replace('Multiply', '×').replace('Divide', '/').replace('Decimal', '.');
  const m: Record<string, string> = { Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Правый Shift', ControlLeft: 'Ctrl', ControlRight: 'Правый Ctrl', MetaLeft: 'Cmd', MetaRight: 'Cmd', Tab: 'Tab', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', AltLeft: 'Alt', AltRight: 'AltGr', Backspace: 'Backspace', CapsLock: 'Caps', Mouse1: 'Средняя кнопка', Mouse3: 'Кнопка мыши «назад»', Mouse4: 'Кнопка мыши «вперёд»', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', IntlBackslash: '\\', Escape: 'Esc', Delete: 'Del', Insert: 'Ins', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End' };
  if (m[code]) return m[code];
  const l = LAYOUT.get(code); return l ? l.toUpperCase() : code;
}
/** v1.11: буквы текущей раскладки (Chrome/Edge: navigator.keyboard.getLayoutMap) — «W (Ц)» для русской */
const LAYOUT = new Map<string, string>();
export function loadLayout(done?: () => void) {
  try { const kb = (navigator as any).keyboard; if (!kb?.getLayoutMap) return; kb.getLayoutMap().then((m: Map<string, string>) => { LAYOUT.clear(); m.forEach((v, k) => LAYOUT.set(k, v)); done?.(); }).catch(() => {}); } catch { /* нет API */ }
}

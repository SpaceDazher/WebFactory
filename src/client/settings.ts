// Настройки (M10): громкость, клавиши, графика, автосохранение. Хранятся в localStorage отдельно от сохранений.
export const ACTIONS: [string, string, string][] = [
  ['up', 'Вверх', 'KeyW'], ['left', 'Влево', 'KeyA'], ['down', 'Вниз', 'KeyS'], ['right', 'Вправо', 'KeyD'],
  ['inv', 'Инвентарь и крафт', 'KeyE'], ['tech', 'Технологии', 'KeyT'], ['stats', 'Статистика', 'KeyP'], ['calc', 'Калькулятор производства', 'KeyK'], ['map', 'Карта', 'KeyM'], ['bp', 'Библиотека чертежей', 'KeyB'], ['logi', 'Логистическая сеть', 'KeyL'], ['trains', 'Поезда', 'KeyY'], ['vehicle', 'Сесть в локомотив / выйти', 'KeyV'],
  ['rotate', 'Повернуть', 'KeyR'], ['pipette', 'Пипетка / очистить руку', 'KeyQ'], ['pickup', 'Подобрать', 'KeyF'], ['pollution', 'Слой загрязнения', 'KeyU'],
  ['shoot', 'Стрелять', 'Space'], ['pause', 'Пауза', 'F9'], ['debug', 'Отладка', 'F3'],
  ['players', 'Список игроков', 'Tab'], ['chat', 'Чат', 'Enter'], ['mark', 'Метка на карте (+ ЛКМ)', 'AltLeft'],
];
export interface Settings {
  master: number; sfx: number; music: number; ambient: number;
  autosaveMin: number; smoke: boolean; dayNight: boolean; shake: boolean; uiScale: number;
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
}
const KEY = 'zavod7:settings';
export const DEFAULTS: Settings = { lod: true, master: 0.8, sfx: 0.8, music: 0.45, ambient: 0.6, autosaveMin: 5, smoke: true, dayNight: true, shake: true, uiScale: 1, simWorker: true, renderer: 'auto', lang: (typeof navigator !== 'undefined' && navigator.language && !/^(ru|be|uk|kk)/i.test(navigator.language)) ? 'en' : 'ru', colorblind: false, gfx: '', gfxAuto: false, resScale: 1, dprMax: 3, fpsCap: 0, detail: true, wheel: 'auto', ctrlClick: true, voice: 0.8, uiVoice: 'off', voiceRate: 1, voiceName: '', tips: true, mpName: '', mpColor: '#d2782e', mpServer: typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && location.hostname ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787` : 'ws://localhost:8787', mpIce: 'stun:stun.l.google.com:19302', keys: Object.fromEntries(ACTIONS.map(a => [a[0], a[2]])) };
export function loadSettings(): Settings {
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); return { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) } }; } catch { return { ...DEFAULTS, keys: { ...DEFAULTS.keys } }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ } }
/** читаемое имя клавиши */
export function keyName(code: string) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3); if (code.startsWith('Digit')) return code.slice(5);
  const m: Record<string, string> = { Space: 'Пробел', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', Tab: 'Tab', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', AltLeft: 'Alt', AltRight: 'Alt', Backspace: 'Backspace', CapsLock: 'Caps' };
  return m[code] || code;
}

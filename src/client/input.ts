// Ввод для разных браузеров и устройств (п. 5 плана 1.0): колесо мыши и тачпад, жесты Safari,
// Ctrl+щелчок на macOS, масштаб интерфейса без CSS zoom (Firefox до 126).

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test((navigator as any).userAgentData?.platform || navigator.platform || navigator.userAgent);

/** Пиксели прокрутки: Firefox для колеса мыши отдаёт строки (deltaMode 1), иногда — страницы (2) */
export function wheelPixels(e: { deltaY: number; deltaMode: number }): number {
  return e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
}
/** Похоже ли событие на щелчок колеса мыши, а не на тачпад.
 *  Колесо: строки (Firefox) или крупные целые шаги (≥ 50 px, обычно 100/120) без горизонтали.
 *  Тачпад: много мелких событий, часто дробных, с deltaX; щипок — ctrlKey (Chrome, Edge, Firefox). */
export function looksLikeMouseWheel(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.ctrlKey) return false;
  const y = Math.abs(e.deltaY);
  return e.deltaX === 0 && y >= 50 && Number.isInteger(e.deltaY);
}
/** Новый масштаб по событию колеса. mode — настройка «колесо и тачпад» */
/** v1.9: наименьший масштаб — 1/16 (вся мегабаза на экране; дальше 0,3 — карта издалека, LOD) */
export const MIN_ZOOM = 0.0625;
export function wheelZoom(zoom: number, e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }, mode: 'auto' | 'mouse' | 'touchpad' = 'auto'): number {
  const dy = wheelPixels(e); if (!dy) return zoom;
  const notch = mode === 'mouse' || (mode === 'auto' && looksLikeMouseWheel(e));
  let k: number;
  if (notch) k = dy < 0 ? 1.12 : 1 / 1.12;                    // как раньше: 12% на щелчок
  else k = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.003));       // плавно: щипок чувствительнее прокрутки двумя пальцами
  k = Math.max(0.5, Math.min(2, k));
  return Math.max(MIN_ZOOM, Math.min(4, zoom * k));
}
/** Масштаб интерфейса. CSS zoom есть в Chrome, Safari и Firefox 126+; в более старом Firefox — transform: scale
 *  с точкой отсчёта у того края экрана, к которому прижат элемент. */
const ZOOM_OK = typeof CSS !== 'undefined' && CSS.supports?.('zoom', '2') && !(typeof location !== 'undefined' && /[?&]nozoom/.test(location.search));
export const uiZoomMode = ZOOM_OK ? 'zoom' : 'transform';
export function uiScaleStyle(el: HTMLElement, k: number) {
  if (ZOOM_OK) { (el.style as any).zoom = String(k); return; }
  if (k === 1) { el.style.transform = ''; el.style.transformOrigin = ''; return; }
  const was = el.style.transform; el.style.transform = '';
  const r = el.getBoundingClientRect(); el.style.transform = was;
  const W = innerWidth, H = innerHeight, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const ox = r.width >= W * 0.9 ? 'center' : cx < W / 3 ? 'left' : cx > W * 2 / 3 ? 'right' : 'center';
  const oy = r.height >= H * 0.9 ? 'center' : cy < H / 3 ? 'top' : cy > H * 2 / 3 ? 'bottom' : 'center';
  el.style.transformOrigin = `${ox} ${oy}`; el.style.transform = `scale(${k})`;
}
/** Щипок в Safari (macOS): события gesturestart/gesturechange со scale. Возвращает «идёт ли жест» — пока идёт,
 *  ctrl+колесо не обрабатываем, чтобы не масштабировать дважды. */
export function installGestures(target: HTMLElement, get: () => number, set: (z: number) => void): () => boolean {
  let active = false, z0 = 1;
  const on = (name: string, f: (e: any) => void) => target.addEventListener(name, f as any, { passive: false } as any);
  on('gesturestart', e => { e.preventDefault(); active = true; z0 = get(); });
  on('gesturechange', e => { e.preventDefault(); if (e.scale > 0) set(Math.max(MIN_ZOOM, Math.min(4, z0 * e.scale))); });
  on('gestureend', e => { e.preventDefault(); active = false; });
  // жест вне холста не должен масштабировать страницу целиком
  if (typeof document !== 'undefined') document.addEventListener('gesturestart', (e: any) => e.preventDefault(), { passive: false } as any);
  return () => active;
}

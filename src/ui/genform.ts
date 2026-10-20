// v1.16: настройки воды, биомов и отдельных месторождений.
import { cleanGen, GenSet, genSpacingDefault, genSpacingRange } from '../sim/world';
import { tr } from '../core/i18n';
const NAMES = ['Железо', 'Медь', 'Уголь', 'Камень', 'Нефть', 'Уран'];
export function genFormHtml(prefix = 'gen', cur?: GenSet | null): string {
  const opt = (vals: number[], c: number) => vals.map(v => `<option value="${v}" ${v === c ? 'selected' : ''}>×${v}</option>`).join('');
  const w = cur?.water ?? 1;
  const row = (i: number) => {
    const f = cur?.freq[i] ?? 1, range = genSpacingRange(i, f), distance = cur?.spacing[i] ?? genSpacingDefault(i, f);
    const uranium = i === 6 ? `<label><input type="checkbox" id="${prefix}-u" ${cur?.uranium === false ? '' : 'checked'}> ${tr('Включён')}</label>` : '';
    return `<div class="row2"><b style="min-width:70px">${tr(NAMES[i - 1])}</b> ${tr('Размер')} <select id="${prefix}-s${i}">${opt([0.5, 0.75, 1, 1.5, 2], cur?.size[i] ?? 1)}</select> ${tr('Богатство')} <select id="${prefix}-r${i}">${opt([0.25, 0.5, 1, 2, 4], cur?.rich[i] ?? 1)}</select> ${tr('Частота')} <select id="${prefix}-f${i}">${opt([0.25, 0.5, 1, 1.5, 2], f)}</select> ${tr('Расстояние между месторождениями')} <input id="${prefix}-d${i}" type="number" min="${range[0]}" max="${range[1]}" step="10" value="${distance}" style="width:72px"> <span class="dim small" id="${prefix}-dr${i}">${range[0]}–${range[1]} ${tr('клеток')}</span> ${uranium}</div>`;
  };
  return `<div class="row2">${tr('Вода')} <select id="${prefix}-w">${opt([0.5, 0.75, 1, 1.5, 2], w)}</select> <span class="dim small">${tr('меньше — суше, больше — больше озёр и рек')}</span></div><div class="row2">${tr('Масштаб биомов')} <select id="${prefix}-b">${opt([0.5, 0.75, 1, 1.5, 2], cur?.biomeScale ?? 1.5)}</select> <span class="dim small">${tr('больше — крупнее области травы, песка и камня')}</span></div>${[1, 2, 3, 4, 5, 6].map(row).join('')}<div class="dim small">${tr('Размер задаёт площадь поля, богатство — запас, частота — число полей. Расстояние задаёт минимальный зазор между краями полей; допустимый диапазон зависит от частоты. Стартовые месторождения сохраняются.')}</div>`;
}
/** Обновляет диапазон зазора после выбора частоты и не оставляет значение за пределами контракта. */
export function refreshGenForm(prefix = 'gen', root: ParentNode = document) {
  for (let i = 1; i <= 6; i++) {
    const f = root.querySelector(`#${prefix}-f${i}`) as HTMLSelectElement | null;
    const d = root.querySelector(`#${prefix}-d${i}`) as HTMLInputElement | null;
    const label = root.querySelector(`#${prefix}-dr${i}`) as HTMLElement | null;
    if (!f || !d) continue;
    const range = genSpacingRange(i, Number(f.value) || 1), value = Number(d.value) || genSpacingDefault(i, Number(f.value) || 1);
    d.min = String(range[0]); d.max = String(range[1]);
    d.value = String(Math.max(range[0], Math.min(range[1], Math.round(value / 10) * 10)));
    if (label) label.textContent = `${range[0]}–${range[1]} ${tr('клеток')}`;
  }
}
/** прочитать форму; null — все значения по умолчанию */
export function readGen(prefix = 'gen', root: ParentNode = document): GenSet | null {
  const val = (id: string) => Number((root.querySelector('#' + id) as HTMLSelectElement | null)?.value) || 1;
  const arr = (k: string) => [1, 1, 2, 3, 4, 5, 6].map((_, i) => i ? val(`${prefix}-${k}${i}`) : 1);
  const spacing = [1, 1, 2, 3, 4, 5, 6].map((_, i) => i ? Number((root.querySelector(`#${prefix}-d${i}`) as HTMLInputElement | null)?.value) || genSpacingDefault(i, val(`${prefix}-f${i}`)) : 1);
  const uranium = (root.querySelector(`#${prefix}-u`) as HTMLInputElement | null)?.checked ?? true;
  return cleanGen({ water: val(prefix + '-w'), size: arr('s'), rich: arr('r'), freq: arr('f'), spacing, biomeScale: val(prefix + '-b'), uranium });
}

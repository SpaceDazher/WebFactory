import type { Entity, Game } from '../sim/game';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import { fluidAssignments } from '../sim/fluidports';
import { iconURL } from '../render/art';
import { tr } from '../core/i18n';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function fluidPortPanel(g: Game, e: Entity, pending = false): string {
  if (!PROTOS[e.proto]?.fluid?.some(b => b.io)) return '';
  const plan = fluidAssignments(e), scale = 26, pad = 25, w = e.w * scale + pad * 2, h = e.h * scale + pad * 2;
  const points = plan.tanks.filter(t => t.io).flatMap(t => t.connections.map(c => {
    const x = pad + (c.x - e.x + .5) * scale, y = pad + (c.y - e.y + .5) * scale;
    const angle = (t.io === 'in' ? (c.d + 2) % 4 : c.d) * 90;
    return `<g><circle cx="${x}" cy="${y}" r="10" fill="${t.used ? '#243943' : '#333'}" stroke="#cbd5dc"/><text x="${x}" y="${y + 3}" fill="white" text-anchor="middle" font-size="9">${t.key}</text><path d="M0,-4 L4,3 L-4,3 Z" fill="white" transform="translate(${x + [0, 16, 0, -16][c.d]},${y + [-16, 0, 16, 0][c.d]}) rotate(${angle})"/></g>`;
  })).join('');
  const rows = plan.tanks.filter(t => t.io).map(t => {
    const side = tr(t.io === 'in' ? 'Вход' : 'Выход'), assignment = !plan.hasRecipe ? tr('Выберите рецепт') : !t.used ? tr('Не используется в этом рецепте') : `${tr(ITEMS[t.fluid!]?.name || t.fluid!)} · ${t.amount} ${tr('ед. на цикл')}`;
    const net = e._fn ? g.fluidNets[e._fn[t.tank]] : undefined;
    const connected = t.connections.some(c => { const other = g.entAt(c.outsideX, c.outsideY); return other && PROTOS[other.proto]?.fluid?.some((_, b) => fluidAssignments(other).tanks[b].connections.some(o => o.x === c.outsideX && o.y === c.outsideY && o.d === (c.d + 2) % 4)); });
    const actual = t.used ? !connected ? tr('Нет подключения') : net?.conflict || net?.fluid && net.fluid !== t.fluid ? tr('Другая жидкость в сети') : `${tr('Сеть')}: ${tr(net?.fluid ? ITEMS[net.fluid]?.name || net.fluid : 'Пусто')}, ${Math.floor(net?.amount || 0)}` : '';
    const mismatch = t.used && e.ffilter?.[t.tank] !== t.fluid;
    return `<button type="button" class="fluid-port-row" data-fluid-entity="${e.id}" data-fluid-tank="${t.tank}" title="${esc(`${side}: ${assignment}${actual ? ' · ' + actual : ''}`)}"><b>${t.key} ${t.io === 'in' ? '↘' : '↗'} ${esc(side)}</b>${t.used && t.fluid ? `<img src="${iconURL(t.fluid)}" alt="">` : '<span>—</span>'}<span>${esc(assignment)}${actual ? `<small>${esc(actual)}</small>` : ''}${mismatch ? `<small>${esc(tr('Ожидание обновления подключения'))}</small>` : ''}</span></button>`;
  }).join('');
  return `<section class="fluid-port-panel"><b>${tr('Жидкостные подключения')}</b>${pending || e.rnx != null ? `<div role="status">${tr('Ожидание смены рецепта')}</div>` : ''}<div class="fluid-port-layout"><svg role="img" aria-label="${esc(tr('Схема подключений'))}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect x="${pad}" y="${pad}" width="${e.w * scale}" height="${e.h * scale}" fill="#243039" stroke="#84939b"/>${points}</svg><div>${rows}</div></div>${plan.incompatible ? `<div class="err">${tr('Рецепт несовместим с жидкостными баками здания')}</div>` : ''}</section>`;
}

import { DX, DY } from '../core/types';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import type { Game, Entity } from '../sim/game';
import { fluidAssignments, type FluidMachine } from '../sim/fluidports';
import { tr } from '../core/i18n';
import { itemIcon } from './art';
import type { View } from './renderer';

/** Client-only overlay; never writes filters, tank contents, or network state. */
export function drawFluidPorts(g: Game, c: CanvasRenderingContext2D, v: View, sx: (x: number) => number, sy: (y: number) => number, s: number, mouseX: number, mouseY: number, pixelRatio = 1) {
  const u = pixelRatio;
  const pipe = v.cursor && ITEMS[v.cursor]?.place && PROTOS[ITEMS[v.cursor].place!]?.fluid;
  let tip: { x: number; y: number; text: string } | null = null;
  const draw = (e: FluidMachine, detailed: boolean, actual?: Entity) => {
    const p = PROTOS[e.proto]; if (!p?.fluid?.some(b => b.io)) return;
    const w = e.dir % 2 ? p.h : p.w, h = e.dir % 2 ? p.w : p.h;
    if (sx(e.x + w + 1) < 0 || sy(e.y + h + 1) < 0 || sx(e.x - 1) > c.canvas.width || sy(e.y - 1) > c.canvas.height) return;
    const plan = fluidAssignments(e);
    for (const t of plan.tanks) if (t.io) for (const cn of t.connections) {
      const x = sx(cn.x + .5 + DX[cn.d] * .48), y = sy(cn.y + .5 + DY[cn.d] * .48);
      const focused = actual && v.fluidFocus?.entity === actual.id && v.fluidFocus.tank === t.tank;
      const r = Math.max((detailed ? 8 : 3) * u, Math.min(15 * u, s * .29));
      c.save(); c.fillStyle = '#172128'; c.strokeStyle = focused ? '#ffe066' : t.used ? '#e2edf1' : '#78838c'; c.lineWidth = (focused ? 3 : 1.5) * u;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke();
      if (detailed && t.used && t.fluid) c.drawImage(itemIcon(t.fluid), x - r * .7, y - r * .7, r * 1.4, r * 1.4);
      else if (!t.used) { c.strokeStyle = '#8b959c'; c.beginPath(); c.moveTo(x - r * .45, y); c.lineTo(x + r * .45, y); c.stroke(); }
      const direction = t.io === 'in' ? (cn.d + 2) % 4 : cn.d, ax = x + DX[cn.d] * (r + 5 * u), ay = y + DY[cn.d] * (r + 5 * u);
      c.translate(ax, ay); c.rotate(direction * Math.PI / 2); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -4 * u); c.lineTo(4 * u, 3 * u); c.lineTo(-4 * u, 3 * u); c.closePath(); c.fill(); c.restore();
      if (detailed) { c.save(); c.font = `bold ${10 * u}px sans-serif`; c.textAlign = 'center'; c.fillStyle = '#fff'; c.strokeStyle = '#10181d'; c.lineWidth = 3 * u; c.strokeText(t.key, x, y + r + 12 * u); c.fillText(t.key, x, y + r + 12 * u); c.restore(); }
      if (v.mouseIn && Math.hypot(mouseX - x, mouseY - y) < r + 5 * u || focused) {
        let text = `${tr(t.io === 'in' ? 'Вход' : 'Выход')}: ${!plan.hasRecipe ? tr('Выберите рецепт') : !t.used ? tr('Не используется в этом рецепте') : `${tr(ITEMS[t.fluid!]?.name || t.fluid!)} · ${t.amount} ${tr('ед. на цикл')}`}`;
        if (actual && t.used) {
          const net = actual._fn ? g.fluidNets[actual._fn[t.tank]] : undefined;
          const linked = t.connections.some(q => { const other = g.entAt(q.outsideX, q.outsideY); return other && PROTOS[other.proto]?.fluid?.some((_, b) => fluidAssignments(other).tanks[b].connections.some(o => o.x === q.outsideX && o.y === q.outsideY && o.d === (q.d + 2) % 4)); });
          text += ` · ${!linked ? tr('Нет подключения') : net?.conflict || net?.fluid && net.fluid !== t.fluid ? tr('Другая жидкость в сети') : `${tr('Сеть')}: ${tr(net?.fluid ? ITEMS[net.fluid]?.name || net.fluid : 'Пусто')}, ${Math.floor(net?.amount || 0)}`}`;
          if (actual.ffilter?.[t.tank] !== t.fluid) text += ` · ${tr('Ожидание обновления подключения')}`;
        }
        if (plan.incompatible) text += ` · ${tr('Рецепт несовместим с жидкостными баками здания')}`;
        tip = { x, y, text };
      }
    }
  };
  for (const e of g.ents.values()) {
    if (!PROTOS[e.proto]?.fluid?.some(b => b.io)) continue;
    const selected = v.fluidSelection === e.id || v.hoverEnt?.id === e.id;
    const nearPipe = !!pipe && !!v.ghostPos && v.ghostPos[0] >= e.x - 2 && v.ghostPos[0] <= e.x + e.w + 1 && v.ghostPos[1] >= e.y - 2 && v.ghostPos[1] <= e.y + e.h + 1;
    if (s >= 12 * u || selected || v.alt || nearPipe) draw(e, selected || v.alt || nearPipe, e);
  }
  for (const gh of g.ghosts.values()) if (s >= 12 * u || v.alt || v.ghostPos && Math.hypot(v.ghostPos[0] - gh.x, v.ghostPos[1] - gh.y) < 8) draw(gh, true);
  if (v.bp && v.bpPos && v.mouseIn) for (const be of v.bp.entities) draw({ proto: be.p, x: be.x + v.bpPos[0], y: be.y + v.bpPos[1], dir: be.d, recipe: be.recipe }, true);
  if (v.cursor && v.ghostPos && v.mouseIn) { const proto = ITEMS[v.cursor]?.place; if (proto) draw({ proto, x: v.ghostPos[0], y: v.ghostPos[1], dir: v.rot }, true); }
  if (tip) {
    // draw() sets this through a closure; keep the annotation explicit for TS control flow.
    const t = tip as { x: number; y: number; text: string }; c.save(); c.font = `${12 * u}px sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
    const width = Math.max(1, Math.min(c.canvas.width - 12 * u, c.measureText(t.text).width + 16 * u)), x = Math.max(6 * u, Math.min(c.canvas.width - width - 6 * u, t.x - width / 2)), y = Math.max(16 * u, t.y - 30 * u);
    c.fillStyle = '#111c24'; c.fillRect(x, y - 12 * u, width, 24 * u); c.fillStyle = '#f0f5fa'; c.fillText(t.text, x + 8 * u, y, Math.max(1, width - 16 * u)); c.restore();
  }
}

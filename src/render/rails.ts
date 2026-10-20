// v1.7: рисование рельсов (шпалы + две нитки по оси куска) и вагонов. Пути строятся один раз на вариант в клетках
// (от узла-якоря) и рисуются с масштабом — дёшево даже для тысяч кусков.
import { shapeOf, pointOn, U } from '../sim/railgeo';
import { tr } from '../core/i18n';
type C = CanvasRenderingContext2D;
interface RP { ties: Path2D; rails: Path2D; axis: Path2D; }
const cache = new Map<string, RP>();
export function railPaths(proto: string, v: number): RP {
  const k = proto + v; let r = cache.get(k); if (r) return r;
  const s = shapeOf(proto, v); const ties = new Path2D(), rails = new Path2D(), axis = new Path2D();
  const n = Math.max(2, Math.round(s.len / 250));
  const P: [number, number, number][] = []; for (let i = 0; i <= n; i++) P.push(pointOn(s, s.len * i / n));
  for (let i = 0; i < n; i++) { const a = P[i], b = P[i + 1]; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * .62, ny = dx / l * .62; ties.moveTo(mx + nx, my + ny); ties.lineTo(mx - nx, my - ny); }
  for (const off of [.36, -.36]) { for (let i = 0; i <= n; i++) { const a = P[Math.min(i, n - 1)], b = P[Math.min(i + 1, n)]; const p = P[i]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; const x = p[0] - dy / l * off, y = p[1] + dx / l * off; if (i) rails.lineTo(x, y); else rails.moveTo(x, y); } }
  for (let i = 0; i <= n; i++) { if (i) axis.lineTo(P[i][0], P[i][1]); else axis.moveTo(P[i][0], P[i][1]); }
  r = { ties, rails, axis }; cache.set(k, r); return r;
}
/** рельс: (x, y) — экранная точка узла-якоря, s — пикселей на клетку */
export function drawRail(c: C, proto: string, v: number, x: number, y: number, s: number, o: { map?: boolean; ghost?: boolean; layer?: 0 | 1 | 2 } = {}) {
  const p = railPaths(proto, v); c.save(); c.translate(x, y); c.scale(s, s); c.lineCap = 'butt';
  if (o.map) { c.strokeStyle = o.ghost ? 'rgba(120,190,255,.8)' : '#8d949c'; c.lineWidth = Math.max(1.5 / s, .9); c.stroke(p.axis); c.restore(); return; }
  const L = o.layer ?? 0;
  if (L !== 2) { c.strokeStyle = o.ghost ? 'rgba(120,190,255,.55)' : '#3b4140'; c.lineWidth = .2; c.stroke(p.ties);
    if (!o.ghost && s >= 10) { c.strokeStyle = '#82918d'; c.lineWidth = .12; c.stroke(p.ties); } }
  if (L !== 1) {
    if (!o.ghost && s >= 10) { c.strokeStyle = '#35474d'; c.lineWidth = .16; c.stroke(p.rails); }
    c.strokeStyle = o.ghost ? 'rgba(170,215,255,.85)' : '#a7babd'; c.lineWidth = s >= 10 ? .09 : .14; c.stroke(p.rails);
    if (!o.ghost && s >= 18) { c.strokeStyle = '#e1e6dc'; c.lineWidth = .035; c.stroke(p.rails); }
  }
  c.restore();
}
/** вагон: центр (x, y) на экране, (dx, dy) — на голову поезда; fl — локомотив смотрит назад */
export function drawCar(c: C, proto: string, x: number, y: number, dx: number, dy: number, s: number, o: { fl?: boolean; ghost?: boolean; sel?: boolean; t?: number; moving?: boolean; /** v1.8: цистерна — цвет жидкости и заполнение 0..1 */ fluid?: string; fill?: number } = {}) {
  const loco = proto === 'locomotive'; const L = (loco ? 7000 : 6000) / U - .3, W = 1.7;
  c.save(); c.translate(x, y); c.rotate(Math.atan2(dy, dx) + (o.fl ? Math.PI : 0)); c.scale(s, s);
  // тень
  if (!o.ghost) { c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(-L / 2 + .15, -W / 2 + .2, L, W); }
  // тележки
  c.fillStyle = '#26292c'; for (const q of [-L / 2 + 1.1, L / 2 - 1.1]) c.fillRect(q - .55, -W / 2 - .05, 1.1, W + .1);
  if (loco || proto === 'cargo-wagon' || proto === 'fluid-wagon') {
    c.fillStyle = '#637b83'; for (const q of [-L / 2 + 1.1, L / 2 - 1.1]) for (const yy of [-W / 2, W / 2 - .07]) c.fillRect(q - .38, yy, .76, .07);
  }
  if (loco) {
    c.fillStyle = o.ghost ? 'rgba(201,86,58,.5)' : '#ac6745'; c.fillRect(-L / 2, -W / 2 + .1, L, W - .2);
    c.fillStyle = '#354b54'; c.fillRect(-L / 2 + .3, -W / 2 + .3, L - 2.4, W - .6);
    // кабина спереди (по +x) и стекло
    c.fillStyle = '#a6b8b8'; c.fillRect(L / 2 - 2, -W / 2 + .2, 1.4, W - .4);
    c.fillStyle = '#274c60'; c.fillRect(L / 2 - .75, -W / 2 + .3, .45, W - .6);
    c.fillStyle = '#d2b277'; c.fillRect(-L / 2 + .16, -W / 2 + .13, L - .35, .08); c.fillRect(-L / 2 + .16, W / 2 - .21, L - .35, .08);
    c.fillStyle = '#c4d5d2'; c.fillRect(L / 2 - .65, -W / 2 + .34, .08, W - .68);
    for (const q of [-L / 2 + 1, -L / 2 + 2.1]) { c.fillStyle = '#789097'; c.beginPath(); c.arc(q, 0, .28, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#263d47'; c.lineWidth = .06; c.beginPath(); c.moveTo(q - .2, 0); c.lineTo(q + .2, 0); c.stroke(); }
    // нос и фара
    c.fillStyle = '#e8c35a'; c.beginPath(); c.arc(L / 2 - .12, 0, .16, 0, 7); c.fill();
    // решётки
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = .06; c.beginPath(); for (let q = -L / 2 + .7; q < L / 2 - 2.4; q += .55) { c.moveTo(q, -W / 2 + .4); c.lineTo(q, W / 2 - .4); } c.stroke();
    if (o.moving && !o.ghost && o.t != null) { c.fillStyle = 'rgba(200,200,200,.35)'; const k = (o.t % 20) / 20; c.beginPath(); c.arc(-L / 2 + 1.6 - k * 1.5, -.1 - k * .3, .25 + k * .35, 0, 7); c.fill(); }
  } else if (proto === 'artillery-wagon') {
    // v1.14: артиллерийский вагон — платформа, поворотная башня и длинный ствол
    c.fillStyle = o.ghost ? 'rgba(90,100,90,.5)' : '#4f5648'; c.fillRect(-L / 2, -W / 2 + .15, L, W - .3);
    c.fillStyle = o.ghost ? 'rgba(120,130,110,.5)' : '#6a7060'; c.fillRect(-L / 2 + .4, -W / 2 + .35, L - .8, W - .7);
    c.fillStyle = '#3b4036'; c.beginPath(); c.arc(-.4, 0, W / 2 - .2, 0, 7); c.fill();
    c.fillStyle = '#7d8572'; c.beginPath(); c.arc(-.4, 0, W / 2 - .45, 0, 7); c.fill();
    c.fillStyle = '#2d3129'; c.fillRect(-.2, -.17, L / 2 + .1, .34); c.fillStyle = '#1d201b'; c.fillRect(L / 2 - .3, -.22, .3, .44);
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = .06; c.beginPath(); for (const q of [-L / 2 + .8, L / 2 - .8]) { c.moveTo(q, -W / 2 + .35); c.lineTo(q, W / 2 - .35); } c.stroke();
  } else if (proto === 'fluid-wagon') {
    // v1.8: цистерна — рама и бочка со скруглёнными торцами; полоса — уровень жидкости
    c.fillStyle = o.ghost ? 'rgba(90,100,110,.5)' : '#3c555f'; c.fillRect(-L / 2, -W / 2 + .2, L, W - .4);
    const r = W / 2 - .12; c.fillStyle = o.ghost ? 'rgba(170,180,190,.5)' : '#b8c8c6'; c.beginPath(); c.moveTo(-L / 2 + r, -r); c.lineTo(L / 2 - r, -r); c.arc(L / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2); c.lineTo(-L / 2 + r, r); c.arc(-L / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5); c.fill();
    c.fillStyle = '#91a9ad'; c.fillRect(-L / 2 + .65, -r + .12, L - 1.3, .12);
    c.strokeStyle = '#516e79'; c.lineWidth = .12; c.beginPath(); for (const q of [-L / 4, L / 4]) { c.moveTo(q, -r + .02); c.lineTo(q, r - .02); } c.stroke();
    if (!o.ghost && o.fluid && (o.fill || 0) > 0) { c.fillStyle = o.fluid; c.globalAlpha = .85; c.fillRect(-L / 2 + .5, -.18, (L - 1) * Math.min(1, o.fill!), .36); c.globalAlpha = 1; }
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = .06; c.beginPath(); for (const q of [-L / 4, 0, L / 4]) { c.moveTo(q, -r); c.lineTo(q, r); } c.stroke();
    c.fillStyle = '#5d7b86'; c.beginPath(); c.arc(0, 0, .22, 0, 7); c.fill();
  } else {
    c.fillStyle = o.ghost ? 'rgba(154,163,171,.5)' : '#869ea3'; c.fillRect(-L / 2, -W / 2 + .1, L, W - .2);
    c.fillStyle = '#344f5b'; c.fillRect(-L / 2 + .2, -W / 2 + .3, L - .4, W - .6);
    if (proto === 'cargo-wagon') { c.fillStyle = '#c0aa7e'; c.fillRect(-L / 2 + .25, -W / 2 + .15, L - .5, .07); c.fillRect(-L / 2 + .25, W / 2 - .22, L - .5, .07); c.fillStyle = '#607d86'; c.fillRect(-L / 2 + .4, -.18, L - .8, .36); }
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = .07; c.beginPath(); for (let q = -L / 2 + .6; q < L / 2 - .3; q += .8) { c.moveTo(q, -W / 2 + .15); c.lineTo(q, W / 2 - .15); } c.stroke();
  }
  c.strokeStyle = o.sel ? '#ffd34d' : 'rgba(0,0,0,.6)'; c.lineWidth = o.sel ? .12 : .06; c.strokeRect(-L / 2, -W / 2 + .1, L, W - .2);
  c.restore();
}
/** ж/д станция (2×2): столб с табличкой и красный световой знак; стрелка — направление поезда */
export function drawStop(c: C, x: number, y: number, s: number, dir: number, o: { name?: string; ghost?: boolean; busy?: boolean } = {}) {
  c.save(); c.translate(x + s, y + s);
  c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(s * .12, s * .5, s * .7, s * .3, 0, 0, 7); c.fill();
  c.fillStyle = '#465e68'; c.fillRect(-s * .6, s * .3, s * 1.2, s * .4);
  c.fillStyle = '#99afb1'; c.fillRect(-s * .53, s * .34, s * 1.06, s * .055);
  c.fillStyle = '#cfb372'; for (let i = 0; i < 4; i++) c.fillRect(s * (-.45 + i * .25), s * .57, s * .13, s * .06);
  c.fillStyle = '#263f4b'; c.beginPath(); c.roundRect(-s * .48, -s * .99, s * .96, s * .79, s * .08); c.fill();
  c.fillStyle = '#a2b9bb'; c.fillRect(-s * .08, -s * .8, s * .16, s * 1.2);
  c.fillStyle = o.busy ? '#4be36b' : '#c9563a'; c.beginPath(); c.arc(0, -s * .62, s * .36, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .05); c.stroke();
  c.fillStyle = '#fff'; c.font = `bold ${Math.round(s * .42)}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(tr('Ж'), 0, -s * .6);
  // стрелка направления поезда (0 — С: поезд едет на север, путь слева от станции)
  c.rotate(dir * Math.PI / 2); c.fillStyle = 'rgba(255,211,77,.9)'; c.beginPath(); c.moveTo(-s * .95, -s * .55); c.lineTo(-s * .75, -s * .2); c.lineTo(-s * 1.15, -s * .2); c.fill();
  c.restore();
}
/** v1.8: светофор в клетке: (x, y) — левый верх, s — пикселей на клетку, h — направление хода поезда (0..7);
 *  ss: 0 — зелёный (блок свободен), 1 — жёлтый (зарезервирован), 2 — красный (занят), 3 — серый (за светофором нет пути) */
export const SIG_COL = ['#3ddc5a', '#f2c230', '#ee3b30', '#6c747b'];
export function drawSignal(c: C, x: number, y: number, s: number, h: number, ss: number, chain: boolean, o: { ghost?: boolean; warn?: boolean } = {}) {
  c.save(); c.translate(x + s / 2, y + s / 2);
  if (!o.ghost) { c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(s * .08, s * .12, s * .34, s * .22, 0, 0, 7); c.fill(); }
  c.fillStyle = '#5d7883'; c.beginPath(); c.arc(0, 0, s * .2, 0, 7); c.fill();
  c.rotate(h * Math.PI / 4);
  // голова: вытянута поперёк хода; у проходного — две лампы и синяя рамка
  const hw = s * (chain ? .2 : .17), hh = s * (chain ? .38 : .27);
  c.fillStyle = o.ghost ? 'rgba(40,44,48,.6)' : '#20343e'; c.beginPath(); c.roundRect ? c.roundRect(-hw, -hh, hw * 2, hh * 2, s * .08) : c.rect(-hw, -hh, hw * 2, hh * 2); c.fill();
  c.strokeStyle = chain ? '#5aa8ff' : 'rgba(255,255,255,.35)'; c.lineWidth = Math.max(1, s * .04); c.stroke();
  c.fillStyle = '#849ba3'; c.fillRect(-hw * .55, hh - s * .065, hw * 1.1, s * .03);
  const col = SIG_COL[ss] || SIG_COL[0];
  const lamp = (ly: number, on: boolean) => { c.fillStyle = on ? col : '#3b3f44'; c.beginPath(); c.arc(0, ly, s * .11, 0, 7); c.fill(); if (on && !o.ghost && s >= 10) { c.globalAlpha = .35; c.beginPath(); c.arc(0, ly, s * .2, 0, 7); c.fill(); c.globalAlpha = 1; } };
  if (chain) { lamp(-hh * .48, true); lamp(hh * .48, ss !== 3); } else lamp(0, true);
  c.restore();
  if (o.warn) { c.save(); c.fillStyle = '#ff9a2e'; c.beginPath(); c.arc(x + s * .9, y + s * .1, s * .2, 0, 7); c.fill(); c.fillStyle = '#000'; c.font = `bold ${Math.round(s * .3)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', x + s * .9, y + s * .12); c.restore(); }
}
/** v1.8: насос для цистерн (1×1): плита, корпус, патрубок к трубам сзади, стрелка к вагону (вперёд); drain — слив */
export function drawTPump(c: C, x: number, y: number, s: number, dir: number, o: { ghost?: boolean; working?: boolean; drain?: boolean; t?: number } = {}) {
  c.save(); c.translate(x + s / 2, y + s / 2); c.rotate(dir * Math.PI / 2);
  c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(-s * .4, -s * .36, s * .86, s * .86);
  c.fillStyle = '#5a636a'; c.fillRect(-s * .18, s * .1, s * .36, s * .4); // патрубок
  c.fillStyle = o.ghost ? 'rgba(74,143,192,.5)' : '#3f7fae'; c.beginPath(); c.arc(0, 0, s * .34, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .045); c.stroke();
  c.fillStyle = '#cfd6dc'; c.beginPath(); if (o.drain) { c.moveTo(0, s * .3); c.lineTo(s * .18, s * .02); c.lineTo(-s * .18, s * .02); } else { c.moveTo(0, -s * .3); c.lineTo(s * .18, -s * .02); c.lineTo(-s * .18, -s * .02); } c.closePath(); c.fill();
  c.fillStyle = '#2a2f33'; c.fillRect(-s * .3, -s * .48, s * .6, s * .12); // лоток к вагону
  if (o.working && o.t != null) { c.fillStyle = 'rgba(140,200,255,.8)'; const k = (o.t % 30) / 30; c.beginPath(); c.arc(0, (o.drain ? 1 : -1) * s * (.1 + k * .25), s * .05, 0, 7); c.fill(); }
  c.restore();
}

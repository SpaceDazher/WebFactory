// v1.14: новый облик инженера — броня по уровню (лёгкая … силовая MK2), шлем со стеклом, ранец, оружие в руках
// (по виду: пистолет, пистолет-пулемёт, дробовик, ракетомёт, огнемёт, лазерная винтовка), походка и вспышка выстрела.
import { ITEMS } from '../data/items';
import { shade } from './swarmart';
type C = CanvasRenderingContext2D;
export interface HeroLook { color: string; facing: number; walk: number; aim?: number | null; gun?: string | null; armor?: string | null; shooting?: boolean; }
const TAU = Math.PI * 2;
/** цвета брони по уровню: 0 — комбинезон, 1–3 — простые брони, 4–6 — модульные */
const ARMOR = ['', '#8a6a4a', '#6a6f74', '#4f5f45', '#5a6a7a', '#3a5a8a', '#2a3a6a'];
export function drawGun(c: C, gun: string, s: number, flash: boolean) {
  const icon = ITEMS[gun]?.icon || 'pistol';
  const box = (x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(x * s, y * s, w * s, h * s); };
  switch (gun) {
    case 'pistol': box(0, -.035, .26, .07, '#3a3d40'); box(.02, .02, .06, .1, '#2a2c2e'); break;
    case 'submachine-gun': box(0, -.045, .4, .09, '#3a3d40'); box(.1, .03, .06, .14, '#2a2c2e'); box(-.06, -.03, .08, .06, '#5a4a3a'); break;
    case 'shotgun': case 'combat-shotgun': box(-.08, -.04, .14, .08, gun === 'shotgun' ? '#7a5a3a' : '#3a3f44'); box(.06, -.04, .44, .055, '#2e3134'); box(.06, .01, .3, .04, '#4a4d50'); break;
    case 'rocket-launcher': box(-.12, -.08, .62, .16, '#5a6a4a'); box(.42, -.1, .1, .2, '#3a4430'); box(.05, .07, .06, .1, '#2a2c2e'); c.fillStyle = '#d8c84a'; c.fillRect(.5 * s, -.03 * s, .05 * s, .06 * s); break;
    case 'flamethrower': box(-.05, -.05, .5, .08, '#4a3a30'); box(.4, -.06, .08, .1, '#2a2420'); c.fillStyle = '#c8743a'; c.beginPath(); c.arc(.05 * s, .1 * s, .08 * s, 0, TAU); c.fill(); break;
    case 'laser-rifle': box(-.06, -.05, .5, .1, '#3a6a9a'); box(.36, -.035, .14, .07, '#1e3a5a'); c.fillStyle = '#7af0ff'; c.fillRect(.1 * s, -.02 * s, .2 * s, .04 * s); break;
    default: void icon; box(0, -.04, .34, .08, '#3a3d40');
  }
  if (flash) { const fx = (gun === 'rocket-launcher' ? .58 : gun === 'flamethrower' ? .5 : gun.includes('shotgun') ? .52 : gun === 'laser-rifle' ? .52 : gun === 'pistol' ? .3 : .44) * s;
    const col = gun === 'laser-rifle' ? '120,240,255' : gun === 'flamethrower' ? '255,150,50' : '255,220,120';
    const g = c.createRadialGradient(fx, 0, 0, fx, 0, s * .14); g.addColorStop(0, `rgba(${col},1)`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.beginPath(); c.arc(fx, 0, s * .14, 0, TAU); c.fill(); }
}
/** персонаж: (x, y) — точка у ног (как прежде: центр клетки), s — пикселей на клетку */
export function drawHero(c: C, x: number, y: number, s: number, o: HeroLook) {
  const tier = o.armor ? ITEMS[o.armor]?.armor?.tier || 0 : 0; const ac = ARMOR[tier] || '';
  const bob = o.walk ? Math.sin(o.walk * TAU) * s * .03 : 0; const step = o.walk ? Math.sin(o.walk * TAU) : 0;
  const side = o.facing === 1 ? 1 : o.facing === 3 ? -1 : 0, back = o.facing === 0;
  c.save(); c.translate(x, y); c.lineJoin = 'round';
  // тень
  c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(s * .05, s * .25, s * .3, s * .13, 0, 0, TAU); c.fill();
  // ноги
  const leg = ac ? shade(ac, -.25) : '#4a4f55';
  c.fillStyle = leg; c.fillRect(-s * .15, -s * .05 + bob, s * .12, s * (.28 + step * .04)); c.fillRect(s * .03, -s * .05 + bob, s * .12, s * (.28 - step * .04));
  c.fillStyle = '#2a2c30'; c.fillRect(-s * .16, s * (.2 + step * .04) + bob, s * .14, s * .06); c.fillRect(s * .02, s * (.2 - step * .04) + bob, s * .14, s * .06);
  // ранец (виден сзади и сбоку)
  if (back || side) { c.fillStyle = tier >= 4 ? '#3a4048' : '#6b5a3e'; c.beginPath(); c.roundRect(-s * .2 - side * s * .1, -s * .48 + bob, s * .4, s * .38, s * .06); c.fill(); if (tier >= 4) { c.fillStyle = '#7af0ff'; c.fillRect(-s * .06 - side * s * .1, -s * .4 + bob, s * .12, s * .04); } }
  // туловище: комбинезон цвета игрока, поверх — броня
  c.fillStyle = o.color; c.beginPath(); c.roundRect(-s * .22, -s * .47 + bob, s * .44, s * .48, s * .13); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .04); c.stroke();
  if (ac) {
    const g = c.createLinearGradient(-s * .2, -s * .45, s * .2, 0); g.addColorStop(0, shade(ac, .35)); g.addColorStop(1, shade(ac, -.3)); c.fillStyle = g;
    c.beginPath(); c.roundRect(-s * .2, -s * .44 + bob, s * .4, s * (tier >= 2 ? .34 : .24), s * .08); c.fill(); c.stroke();
    if (tier >= 2) { c.fillStyle = shade(ac, .1); c.beginPath(); c.arc(-s * .23, -s * .38 + bob, s * .09, 0, TAU); c.arc(s * .23, -s * .38 + bob, s * .09, 0, TAU); c.fill(); c.stroke(); } // наплечники
    if (tier >= 4) { c.strokeStyle = tier >= 6 ? 'rgba(255,200,90,.85)' : 'rgba(120,220,255,.8)'; c.lineWidth = Math.max(1, s * .025); c.beginPath(); c.moveTo(-s * .14, -s * .3 + bob); c.lineTo(0, -s * .2 + bob); c.lineTo(s * .14, -s * .3 + bob); c.stroke(); }
    c.fillStyle = o.color; c.fillRect(-s * .2, -s * .12 + bob, s * .4, s * .05); // пояс цвета игрока
  }
  // голова / шлем
  const hc = tier >= 4 ? shade(ac, .2) : tier ? '#c9c3b2' : '#e9e2d0';
  c.fillStyle = hc; c.beginPath(); c.arc(0, -s * .6 + bob, s * (tier >= 4 ? .2 : .18), 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .04); c.stroke();
  if (!back) { const fx = side * s * .08; const vg = tier >= 4 ? (tier >= 6 ? '#ffb84a' : '#5ae0ff') : '#3aa0d8';
    c.fillStyle = vg; if (tier >= 4) { c.shadowColor = vg; c.shadowBlur = s * .2; } c.beginPath(); c.ellipse(fx, -s * .6 + bob, s * (side ? .08 : .13), s * .07, 0, 0, TAU); c.fill(); c.shadowBlur = 0; }
  if (tier >= 5) { c.strokeStyle = shade(ac, -.4); c.lineWidth = Math.max(1, s * .03); c.beginPath(); c.moveTo(s * .1, -s * .76 + bob); c.lineTo(s * .16, -s * .92 + bob); c.stroke(); c.fillStyle = '#ff5030'; c.beginPath(); c.arc(s * .16, -s * .93 + bob, s * .025, 0, TAU); c.fill(); }
  // оружие в руках — к прицелу (или по направлению взгляда)
  if (o.gun) {
    const a = o.aim ?? [-Math.PI / 2, 0, Math.PI / 2, Math.PI][o.facing] ?? 0;
    c.save(); c.translate(0, -s * .3 + bob); c.rotate(a); if (Math.cos(a) < 0) c.scale(1, -1);
    c.fillStyle = ac ? shade(ac, -.1) : o.color; c.beginPath(); c.arc(s * .1, s * .02, s * .07, 0, TAU); c.fill(); // руки
    c.translate(s * .12, 0); drawGun(c, o.gun, s, !!o.shooting);
    c.restore();
  } else { c.fillStyle = '#6b6f73'; c.fillRect(-s * .3, -s * .35 + bob, s * .1, s * .35); }
  c.restore();
}

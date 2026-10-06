// Процедурная графика: иконки предметов и спрайты построек (стиль «читаемый MVP», 15.1).
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { pixPattern, TexName } from './textures';
import { drawRail, drawCar, drawStop, drawSignal, drawTPump } from './rails';
import { shapeOf } from '../sim/railgeo';
type C = CanvasRenderingContext2D;

function rr(c: C, x: number, y: number, w: number, h: number, r: number) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export { shade };
/** период анимаций построек — 96 тиков (1,6 с): все вращения и пульсации кратны ему, поэтому 24 кадра атласа зациклены без скачков */
export const AK = Math.PI * 2 / 96;
function gear(c: C, cx: number, cy: number, r: number, col: string, teeth = 8) {
  c.fillStyle = col; c.beginPath();
  for (let i = 0; i < teeth * 2; i++) { const a = i / (teeth * 2) * Math.PI * 2; const rr2 = i % 2 ? r * 0.78 : r; c.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2); }
  c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = Math.max(1, r * 0.08); c.stroke();
  c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.arc(cx, cy, r * 0.3, 0, 7); c.fill();
}
// Режим для дальтоников (11.5): палитра Okabe–Ito для пакетов науки + значок формы на колбе
const CB_COL: Record<string, string> = { 'automation-science-pack': '#D55E00', 'logistic-science-pack': '#56B4E9', 'chemical-science-pack': '#0b3d91', 'production-science-pack': '#CC79A7', 'utility-science-pack': '#F0E442', 'space-science-pack': '#f2f4f8' };
const CB_MARK: Record<string, number> = { 'automation-science-pack': 0, 'logistic-science-pack': 1, 'chemical-science-pack': 2, 'production-science-pack': 3, 'utility-science-pack': 4, 'space-science-pack': 5 };
const ORIG_COL: Record<string, string> = {};
let CB = false;
export function colorblind() { return CB; }
export function setColorblind(on: boolean) {
  on = !!on; if (on === CB) return; CB = on;
  for (const id in CB_COL) { const it = ITEMS[id]; if (!it) continue; if (!(id in ORIG_COL)) ORIG_COL[id] = it.color; it.color = on ? CB_COL[id] : ORIG_COL[id]; }
  iconCache.clear(); urlCache.clear();
}
// v1.10: спрайты модов (PNG): 'entity:id' — постройка (во весь прямоугольник, поворот — вращением картинки), 'item:id' — значок
const MOD_SPR = new Map<string, CanvasImageSource & { width: number; height: number }>();
/** после смены набора модов: новые спрайты, цвета заново (таблицы предметов переписаны), кэши значков — сбросить */
export function setModArt(spr: Record<string, CanvasImageSource & { width: number; height: number }>) {
  MOD_SPR.clear(); for (const k in spr) MOD_SPR.set(k, spr[k]);
  for (const id in CB_COL) { const it = ITEMS[id]; if (!it) continue; ORIG_COL[id] = it.color; if (CB) it.color = CB_COL[id]; }
  iconCache.clear(); urlCache.clear();
}
export const modSpriteCount = () => MOD_SPR.size;
function modEntity(c: C, img: CanvasImageSource, W: number, H: number, dir: number, st: ArtState) {
  c.save();
  if (!st.icon) { c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.roundRect(W * .06, H * .1, W * .98, H * .96, Math.min(W, H) * .12); c.fill(); }
  c.translate(W / 2, H / 2); c.rotate((dir % 4) * Math.PI / 2); const w = dir % 2 ? H : W, h = dir % 2 ? W : H;
  c.imageSmoothingQuality = 'high'; c.drawImage(img, -w / 2, -h / 2, w, h);
  if (st.working && !st.icon) { c.globalAlpha = .18 + .12 * Math.sin(st.t * 6); c.fillStyle = '#ffd27a'; c.fillRect(-w * .2, -h * .2, w * .4, h * .4); }
  c.restore();
}
/** Цвет проводов: в режиме для дальтоников — светлый с высоким контрастом */
export function wireColor() { return CB ? 'rgba(250,250,250,.95)' : 'rgba(190,120,60,.85)'; }
function packMark(c: C, s: number, k: number) {
  const x = s * .5, y = s * .74, r = s * .1; c.fillStyle = '#111'; c.strokeStyle = '#fff'; c.lineWidth = s * .03; c.beginPath();
  if (k === 0) c.arc(x, y, r, 0, 7);
  else if (k === 1) { c.moveTo(x, y - r * 1.1); c.lineTo(x + r * 1.1, y + r * .9); c.lineTo(x - r * 1.1, y + r * .9); c.closePath(); }
  else if (k === 2) c.rect(x - r * .9, y - r * .9, r * 1.8, r * 1.8);
  else if (k === 3) { c.moveTo(x, y - r * 1.2); c.lineTo(x + r * 1.1, y); c.lineTo(x, y + r * 1.2); c.lineTo(x - r * 1.1, y); c.closePath(); }
  else if (k === 4) { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * .5 : r * 1.25; c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } c.closePath(); }
  else { c.arc(x, y, r, 0, 7); c.moveTo(x + r * .5, y); c.arc(x, y, r * .5, 0, 7, true); }
  c.fill(); c.stroke();
}
function flask(c: C, s: number, col: string, id = '') {
  c.fillStyle = 'rgba(220,235,245,.9)'; c.beginPath();
  c.moveTo(s * .4, s * .12); c.lineTo(s * .6, s * .12); c.lineTo(s * .6, s * .4); c.lineTo(s * .85, s * .85); c.quadraticCurveTo(s * .87, s * .92, s * .78, s * .92);
  c.lineTo(s * .22, s * .92); c.quadraticCurveTo(s * .13, s * .92, s * .15, s * .85); c.lineTo(s * .4, s * .4); c.closePath(); c.fill();
  c.fillStyle = col; c.beginPath(); c.moveTo(s * .3, s * .58); c.lineTo(s * .7, s * .58); c.lineTo(s * .84, s * .86); c.lineTo(s * .16, s * .86); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke();
  if (CB && id in CB_MARK) packMark(c, s, CB_MARK[id]);
}
/** Нарисовать иконку предмета в квадрат s×s (0,0) */
const SIG_SYM: Record<string, string> = { 'signal-each': '✱', 'signal-any': '∃', 'signal-every': '∀', 'signal-power': '⚡', 'signal-accu': '▮', 'signal-lrobot': 'L', 'signal-lrobot-all': 'L+', 'signal-crobot': 'C', 'signal-crobot-all': 'C+', 'signal-research': 'R', 'signal-work': '✓' };
export function drawItemIcon(c: C, id: string, s: number) {
  const it = ITEMS[id]; if (!it) return;
  const ms = MOD_SPR.get('item:' + id); if (ms) { c.save(); c.imageSmoothingQuality = 'high'; const k = Math.min(s / ms.width, s / ms.height) * .92; c.drawImage(ms, (s - ms.width * k) / 2, (s - ms.height * k) / 2, ms.width * k, ms.height * k); c.restore(); return; }
  const col = it.color;
  c.save(); c.lineJoin = 'round';
  switch (it.icon) {
    case 'ore': {
      const pts = [[.3, .55, .22], [.62, .5, .24], [.45, .3, .2], [.5, .72, .18]];
      for (const [x, y, r] of pts) { c.fillStyle = shade(col, -.25); c.beginPath(); c.arc(x * s, y * s + s * .03, r * s, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(x * s, y * s, r * s, 0, 7); c.fill(); c.fillStyle = shade(col, .35); c.beginPath(); c.arc(x * s - r * s * .3, y * s - r * s * .3, r * s * .35, 0, 7); c.fill(); }
      break;
    }
    case 'wood': for (let i = 0; i < 3; i++) { const y = s * (.3 + i * .2); c.fillStyle = shade(col, -.1 * i); rr(c, s * .12, y, s * .76, s * .17, s * .08); c.fill(); c.fillStyle = '#d8b07a'; c.beginPath(); c.ellipse(s * .82, y + s * .085, s * .05, s * .08, 0, 0, 7); c.fill(); } break;
    case 'plate': for (let i = 2; i >= 0; i--) { c.fillStyle = shade(col, -.15 * i); c.beginPath(); const o = i * s * .08; c.moveTo(s * .5, s * .22 + o); c.lineTo(s * .9, s * .42 + o); c.lineTo(s * .5, s * .62 + o); c.lineTo(s * .1, s * .42 + o); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = s * .03; c.stroke(); } break;
    case 'brick': c.fillStyle = col; rr(c, s * .12, s * .3, s * .76, s * .42, s * .05); c.fill(); c.strokeStyle = shade(col, -.4); c.lineWidth = s * .04; c.beginPath(); c.moveTo(s * .12, s * .51); c.lineTo(s * .88, s * .51); c.moveTo(s * .5, s * .3); c.lineTo(s * .5, s * .51); c.moveTo(s * .3, s * .51); c.lineTo(s * .3, s * .72); c.moveTo(s * .7, s * .51); c.lineTo(s * .7, s * .72); c.stroke(); break;
    case 'beam': c.fillStyle = col; c.fillRect(s * .1, s * .3, s * .8, s * .1); c.fillRect(s * .1, s * .6, s * .8, s * .1); c.fillStyle = shade(col, -.25); c.fillRect(s * .1, s * .4, s * .8, s * .2); c.fillStyle = shade(col, .3); c.fillRect(s * .1, s * .3, s * .8, s * .03); break;
    case 'gear': gear(c, s / 2, s / 2, s * .4, col); break;
    case 'cable': c.strokeStyle = col; c.lineWidth = s * .09; for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(s * (.3 + i * .13), s * .5, s * .12, s * .3, 0, 0, 7); c.stroke(); } break;
    case 'circuit': c.fillStyle = id === 'advanced-circuit' ? '#9a2f26' : id === 'processing-unit' ? '#2a4f9a' : '#2f7f3a'; rr(c, s * .1, s * .18, s * .8, s * .64, s * .06); c.fill(); c.strokeStyle = '#a8e08a'; c.lineWidth = s * .04; c.beginPath(); c.moveTo(s * .2, s * .35); c.lineTo(s * .45, s * .35); c.lineTo(s * .55, s * .5); c.lineTo(s * .8, s * .5); c.moveTo(s * .2, s * .65); c.lineTo(s * .65, s * .65); c.stroke(); c.fillStyle = '#222'; c.fillRect(s * .55, s * .26, s * .2, s * .16); c.fillStyle = '#e8c35a'; c.fillRect(s * .25, s * .45, s * .1, s * .1); break;
    case 'flask': flask(c, s, col, id); break;
    case 'plastic': for (let i = 0; i < 3; i++) { const g = c.createLinearGradient(0, s * .3, 0, s * .7); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#b9bcc6'); c.fillStyle = g; rr(c, s * (.12 + i * .05), s * (.5 - i * .14), s * .7, s * .2, s * .06); c.fill(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = s * .03; c.stroke(); } break;
    case 'sulfur': { const pts = [[.35, .6, .2], [.62, .62, .2], [.5, .38, .2]]; for (const [x, y, r] of pts) { const g = c.createRadialGradient(x * s - r * s * .3, y * s - r * s * .3, 1, x * s, y * s, r * s); g.addColorStop(0, '#fff7a0'); g.addColorStop(1, '#b8a020'); c.fillStyle = g; c.beginPath(); c.arc(x * s, y * s, r * s, 0, 7); c.fill(); } break; }
    case 'solidfuel': { const g = c.createLinearGradient(0, s * .2, 0, s * .8); g.addColorStop(0, '#7a7a84'); g.addColorStop(1, '#2e2e34'); c.fillStyle = g; rr(c, s * .2, s * .25, s * .6, s * .5, s * .1); c.fill(); c.fillStyle = '#ff9a2e'; c.beginPath(); c.moveTo(s * .5, s * .32); c.quadraticCurveTo(s * .66, s * .5, s * .5, s * .68); c.quadraticCurveTo(s * .34, s * .5, s * .5, s * .32); c.fill(); break; }
    case 'engineunit': { c.fillStyle = '#6d757c'; rr(c, s * .15, s * .3, s * .6, s * .45, s * .08); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke(); c.fillStyle = '#aab2b9'; for (let i = 0; i < 3; i++) c.fillRect(s * (.22 + i * .17), s * .18, s * .1, s * .14); gear(c, s * .78, s * .55, s * .14, '#c9a35a', 7); break; }
    case 'fluid': { const g = c.createRadialGradient(s * .42, s * .45, 1, s * .5, s * .58, s * .38); g.addColorStop(0, shade(col, .45)); g.addColorStop(1, shade(col, -.25)); c.fillStyle = g; c.beginPath(); c.moveTo(s * .5, s * .1); c.bezierCurveTo(s * .62, s * .32, s * .84, s * .5, s * .84, s * .64); c.arc(s * .5, s * .64, s * .34, 0, Math.PI); c.bezierCurveTo(s * .16, s * .5, s * .38, s * .32, s * .5, s * .1); c.fill(); c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = s * .04; c.stroke(); c.fillStyle = 'rgba(255,255,255,.4)'; c.beginPath(); c.ellipse(s * .38, s * .6, s * .06, s * .12, .3, 0, 7); c.fill(); break; }
    case 'magazine': { c.fillStyle = shade(col, -.2); rr(c, s * .3, s * .2, s * .4, s * .64, s * .06); c.fill(); c.fillStyle = col; rr(c, s * .34, s * .14, s * .32, s * .14, s * .04); c.fill(); for (let i = 0; i < 3; i++) { c.fillStyle = '#d9b23a'; c.beginPath(); c.arc(s * (.4 + i * .1), s * .12, s * .045, 0, 7); c.fill(); } c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .03; c.strokeRect(s * .3, s * .2, s * .4, s * .64); break; }
    case 'pistol': case 'smg': { c.fillStyle = col; c.save(); c.translate(s * .5, s * .5); c.rotate(-.25); rr(c, -s * .38, -s * .16, s * (it.icon === 'smg' ? .8 : .6), s * .18, s * .04); c.fill(); rr(c, -s * .3, 0, s * .16, s * .34, s * .04); c.fill(); if (it.icon === 'smg') { rr(c, s * .02, 0, s * .1, s * .28, s * .03); c.fill(); } c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .03; c.stroke(); c.restore(); break; }
    case 'module': {
      const m = it.module!; const g = c.createLinearGradient(0, s * .15, 0, s * .85); g.addColorStop(0, shade(col, .35)); g.addColorStop(1, shade(col, -.35));
      c.fillStyle = '#3a3d40'; rr(c, s * .14, s * .14, s * .72, s * .72, s * .1); c.fill(); c.fillStyle = g; rr(c, s * .2, s * .2, s * .6, s * .6, s * .08); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .04; c.stroke();
      c.fillStyle = '#e8c35a'; for (let i = 0; i < 4; i++) c.fillRect(s * (.24 + i * .14), s * .8, s * .07, s * .1);
      c.fillStyle = 'rgba(255,255,255,.85)'; c.font = `bold ${s * .34}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(m.kind === 'speed' ? '»' : m.kind === 'productivity' ? '+' : '∿', s * .5, s * .45);
      c.fillStyle = '#fff'; for (let i = 0; i < m.tier; i++) { c.beginPath(); c.arc(s * (.3 + i * .2), s * .68, s * .045, 0, 7); c.fill(); }
      c.textBaseline = 'alphabetic'; break;
    }
    case 'battery': { c.fillStyle = '#3a3d40'; rr(c, s * .28, s * .14, s * .44, s * .74, s * .08); c.fill(); c.fillStyle = col; rr(c, s * .32, s * .3, s * .36, s * .54, s * .05); c.fill(); c.fillStyle = '#ccc'; c.fillRect(s * .42, s * .08, s * .16, s * .08); c.fillStyle = '#222'; c.font = `bold ${s * .3}px system-ui`; c.textAlign = 'center'; c.fillText('+', s * .5, s * .66); break; }
    case 'eengine': { c.fillStyle = '#3d5a7a'; rr(c, s * .12, s * .28, s * .62, s * .48, s * .1); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke(); c.strokeStyle = '#e6914f'; c.lineWidth = s * .05; for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(s * (.2 + i * .13), s * .32); c.lineTo(s * (.2 + i * .13), s * .72); c.stroke(); } c.fillStyle = '#aab2b9'; c.fillRect(s * .74, s * .46, s * .16, s * .12); break; }
    case 'lds': { for (let i = 0; i < 3; i++) { c.strokeStyle = shade(col, -.2 * i); c.lineWidth = s * .06; c.beginPath(); const o = i * s * .1; c.moveTo(s * .15, s * .3 + o); c.lineTo(s * .5, s * .15 + o); c.lineTo(s * .85, s * .3 + o); c.lineTo(s * .5, s * .45 + o); c.closePath(); c.stroke(); } c.strokeStyle = '#e08850'; c.lineWidth = s * .04; c.beginPath(); c.moveTo(s * .15, s * .5); c.lineTo(s * .5, s * .85); c.lineTo(s * .85, s * .5); c.stroke(); break; }
    case 'rocketfuel': { const g = c.createLinearGradient(0, s * .1, 0, s * .9); g.addColorStop(0, '#f08a5a'); g.addColorStop(1, '#8a2a1a'); c.fillStyle = g; rr(c, s * .3, s * .14, s * .4, s * .74, s * .12); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke(); c.fillStyle = '#ffd34d'; c.beginPath(); c.moveTo(s * .5, s * .32); c.quadraticCurveTo(s * .64, s * .52, s * .5, s * .7); c.quadraticCurveTo(s * .36, s * .52, s * .5, s * .32); c.fill(); break; }
    case 'satellite': { c.fillStyle = '#1d3566'; c.fillRect(s * .04, s * .38, s * .3, s * .24); c.fillRect(s * .66, s * .38, s * .3, s * .24); c.strokeStyle = '#5a7fc0'; c.lineWidth = s * .02; for (const x0 of [.04, .66]) for (let i = 1; i < 3; i++) { c.beginPath(); c.moveTo(s * (x0 + i * .1), s * .38); c.lineTo(s * (x0 + i * .1), s * .62); c.stroke(); } const g = c.createRadialGradient(s * .45, s * .42, 1, s * .5, s * .5, s * .2); g.addColorStop(0, '#fff'); g.addColorStop(1, '#9aa3ab'); c.fillStyle = g; rr(c, s * .34, s * .32, s * .32, s * .36, s * .06); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .03; c.stroke(); c.strokeStyle = '#ddd'; c.beginPath(); c.moveTo(s * .5, s * .32); c.lineTo(s * .5, s * .12); c.stroke(); c.fillStyle = '#ff5030'; c.beginPath(); c.arc(s * .5, s * .12, s * .04, 0, 7); c.fill(); break; }
    case 'rocketpart': { c.fillStyle = '#c9cfd4'; rr(c, s * .3, s * .1, s * .4, s * .8, s * .15); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke(); c.fillStyle = '#d8503a'; c.fillRect(s * .3, s * .55, s * .4, s * .08); break; }
    case 'robot': drone(c, s * .5, s * .52, s * .9, false); break;
    case 'lrobot': drone(c, s * .5, s * .52, s * .9, false, 0, true); break;
    case 'warehouse': case 'lwarehouse': { c.fillStyle = it.icon === 'lwarehouse' ? '#6b625a' : col; rr(c, s * .08, s * .16, s * .84, s * .7, s * .05); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .04; c.stroke();
      c.strokeStyle = 'rgba(0,0,0,.3)'; for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(s * .12, s * .16 + i * s * .175); c.lineTo(s * .88, s * .16 + i * s * .175); c.stroke(); }
      if (it.icon === 'lwarehouse') { c.fillStyle = col; c.fillRect(s * .08, s * .36, s * .84, s * .14); }
      c.fillStyle = '#3a3530'; c.fillRect(s * .38, s * .58, s * .24, s * .28); break; }
    case 'cwire': { // v1.5: моток провода
      c.strokeStyle = shade(col, -.35); c.lineWidth = s * .13; c.beginPath(); c.arc(s * .5, s * .52, s * .27, 0, 7); c.stroke();
      c.strokeStyle = col; c.lineWidth = s * .08; c.beginPath(); c.arc(s * .5, s * .5, s * .27, 0, 7); c.stroke(); c.beginPath(); c.arc(s * .5, s * .5, s * .14, 0, 7); c.stroke();
      c.beginPath(); c.moveTo(s * .74, s * .38); c.quadraticCurveTo(s * .95, s * .2, s * .86, s * .08); c.stroke();
      c.fillStyle = '#e6914f'; c.beginPath(); c.arc(s * .86, s * .08, s * .05, 0, 7); c.fill(); break;
    }
    case 'signal': { // v1.5: виртуальный сигнал — цветной кружок или буква
      const letter = id.startsWith('signal-') && id.length === 8 ? id.slice(7) : '';
      c.fillStyle = '#2a2e33'; rr(c, s * .08, s * .08, s * .84, s * .84, s * .14); c.fill(); c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = s * .04; c.stroke();
      if (letter) { c.fillStyle = '#e8ecef'; c.font = `bold ${Math.round(s * .6)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(letter, s * .5, s * .54); }
      else { const g = c.createRadialGradient(s * .42, s * .4, 1, s * .5, s * .5, s * .32); g.addColorStop(0, shade(col, .4)); g.addColorStop(1, shade(col, -.2)); c.fillStyle = g; c.beginPath(); c.arc(s * .5, s * .5, s * .3, 0, 7); c.fill();
        // v1.6: значок особых сигналов и сигналов источников
        const sym = SIG_SYM[id]; if (sym) { c.fillStyle = '#101418'; c.font = `bold ${Math.round(s * (sym.length > 1 ? .3 : .42))}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(sym, s * .5, s * .53); } }
      break;
    }
    case 'concrete': case 'rconcrete': { const g4 = it.icon === 'rconcrete';
      for (let i = 0; i < 2; i++) { c.fillStyle = shade(col, -.12 * i); c.beginPath(); const o = i * s * .1; c.moveTo(s * .5, s * .18 + o); c.lineTo(s * .9, s * .4 + o); c.lineTo(s * .5, s * .62 + o); c.lineTo(s * .1, s * .4 + o); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = s * .03; c.stroke(); }
      c.fillStyle = 'rgba(255,255,255,.12)'; for (let i = 0; i < 9; i++) c.fillRect(s * (.3 + (i * 37 % 40) / 100), s * (.3 + (i * 53 % 20) / 100), s * .03, s * .03);
      if (g4) { c.strokeStyle = '#d8b43a'; c.lineWidth = s * .05; c.beginPath(); c.moveTo(s * .3, s * .29); c.lineTo(s * .7, s * .51); c.stroke(); }
      break; }
    case 'lchest': { c.fillStyle = '#6d7680'; rr(c, s * .14, s * .2, s * .72, s * .62, s * .06); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .04; c.stroke(); c.fillStyle = col; c.fillRect(s * .14, s * .38, s * .72, s * .14); c.fillStyle = '#d9c38a'; c.fillRect(s * .44, s * .34, s * .12, s * .22); break; }
    case 'frame': { c.fillStyle = '#5d656c'; rr(c, s * .2, s * .32, s * .6, s * .36, s * .1); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .04; c.stroke(); c.strokeStyle = '#9aa3ab'; c.lineWidth = s * .05; for (const [x1, y1, x2, y2] of [[.2, .35, .08, .2], [.8, .35, .92, .2], [.2, .65, .08, .8], [.8, .65, .92, .8]]) { c.beginPath(); c.moveTo(s * x1, s * y1); c.lineTo(s * x2, s * y2); c.stroke(); c.fillStyle = '#3a3f44'; c.beginPath(); c.arc(s * x2, s * y2, s * .07, 0, 7); c.fill(); } c.fillStyle = '#e6914f'; c.fillRect(s * .3, s * .46, s * .4, s * .08); break; }
    case 'proport': { c.fillStyle = '#3d454c'; rr(c, s * .1, s * .1, s * .8, s * .8, s * .1); c.fill(); c.strokeStyle = '#e8b84a'; c.lineWidth = s * .05; c.stroke(); drone(c, s * .5, s * .5, s * .62, false); break; }
    // v1.7: железная дорога
    case 'stick': c.strokeStyle = shade(col, -.35); c.lineWidth = s * .13; c.lineCap = 'round'; c.beginPath(); c.moveTo(s * .2, s * .8); c.lineTo(s * .8, s * .2); c.stroke(); c.strokeStyle = col; c.lineWidth = s * .08; c.stroke(); c.lineCap = 'butt'; break;
    case 'rail': case 'crail': {
      const cv = it.icon === 'crail'; c.save();
      if (cv) { c.translate(s * .12, s * .9); c.scale(s / 12, s / 12); drawRail(c, 'curved-rail', 0, 0, 0, 1); }
      else { c.translate(s * .5, s * .5); c.rotate(Math.PI / 4); c.translate(0, s * .45); drawRail(c, 'straight-rail', 0, 0, 0, s * .45); }
      c.restore(); break;
    }
    case 'stop': drawStop(c, s * .02, s * .1, s * .48, 0); break;
    case 'loco': case 'wagon': case 'fwagon': c.save(); drawCar(c, it.icon === 'loco' ? 'locomotive' : it.icon === 'fwagon' ? 'fluid-wagon' : 'cargo-wagon', s * .5, s * .5, 1, -1, s * .13, it.icon === 'fwagon' ? { fluid: '#3a7fd0', fill: .6 } : {}); c.restore(); break;
    case 'rsig': case 'csig': drawSignal(c, s * .1, s * .1, s * .8, 2, it.icon === 'csig' ? 1 : 0, it.icon === 'csig'); break;
    case 'repair': { c.fillStyle = '#c03a2a'; rr(c, s * .15, s * .3, s * .7, s * .48, s * .08); c.fill(); c.fillStyle = '#7a2a1a'; c.fillRect(s * .38, s * .2, s * .24, s * .12); c.fillStyle = '#fff'; c.fillRect(s * .44, s * .4, s * .12, s * .3); c.fillRect(s * .35, s * .49, s * .3, s * .12); break; }
    default: {
      const pid = it.place; if (pid) drawProtoIcon(c, pid, s);
    }
  }
  c.restore();
}
function drawProtoIcon(c: C, pid: string, s: number) {
  const p = PROTOS[pid]; const m = Math.max(p.w, p.h);
  const ts = s * 0.9 / m;
  c.save(); c.translate((s - p.w * ts) / 2, (s - p.h * ts) / 2);
  drawEntityArt(c, pid, 0, 0, ts, p.type === 'inserter' ? 2 : 0, { icon: true, t: 0 });
  c.restore();
}
/** строительный робот (дрон): cx, cy — центр, sz — размах; lit — мигающие огни в полёте */
export function drone(c: C, cx: number, cy: number, sz: number, lit: boolean, t = 0, lg = false) {
  const r = sz / 2;
  c.save(); c.translate(cx, cy);
  c.strokeStyle = '#3a3f44'; c.lineWidth = Math.max(1, sz * .07);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.beginPath(); c.moveTo(0, 0); c.lineTo(dx * r * .62, dy * r * .5); c.stroke(); }
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.fillStyle = 'rgba(200,210,220,.55)'; c.beginPath(); c.ellipse(dx * r * .62, dy * r * .5, r * .32, r * .12, (t * .9 + dx * dy) % 3, 0, 7); c.fill(); }
  const g = c.createLinearGradient(-r * .4, -r * .3, r * .4, r * .3); g.addColorStop(0, lg ? '#b8d4ee' : '#f2c26a'); g.addColorStop(1, lg ? '#4f78a8' : '#b5782c');
  c.fillStyle = g; rr(c, -r * .42, -r * .28, r * .84, r * .56, r * .2); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, sz * .04); c.stroke();
  c.fillStyle = '#2b3036'; rr(c, -r * .2, -r * .14, r * .4, r * .24, r * .08); c.fill();
  c.fillStyle = lit ? '#6cf' : '#7cc4ff'; c.beginPath(); c.arc(0, -r * .02, r * .07, 0, 7); c.fill();
  if (lit) { c.fillStyle = (t | 0) % 2 ? '#ff5030' : '#50ff70'; c.beginPath(); c.arc(r * .36, -r * .2, r * .06, 0, 7); c.fill(); }
  c.restore();
}
export interface ArtState { icon?: boolean; t: number; working?: boolean; curve?: number; ug?: 'in' | 'out'; progress?: number; recipeColor?: string; light?: number; aim?: number; flash?: boolean; seed?: number; conn?: number; lit?: boolean; /** v1.5: цвет лампы по сигналу */ lampColor?: string; fluidColor?: string; fill?: number; launch?: number; parts?: number; mods?: (string | null)[]; ghost?: boolean; /** v1.6: знак операции комбинатора */ op?: string; }
/** Спрайт постройки: x,y — левый верх в пикселях, s — пикселей на клетку */
export function drawEntityArt(c: C, pid: string, x: number, y: number, s: number, dir: number, st: ArtState) {
  const p = PROTOS[pid]; const W = (dir % 2 ? p.h : p.w) * s, H = (dir % 2 ? p.w : p.h) * s;
  const ms = MOD_SPR.get('entity:' + pid); if (ms) { c.save(); c.translate(x, y); modEntity(c, ms, W, H, dir, st); c.restore(); return; }
  const col = p.color;
  c.save(); c.translate(x, y); c.lineJoin = 'round';
  const shadow = () => { softShadow(); if (false) { c.fillStyle = 'rgba(0,0,0,.25)'; rr(c, s * .12, s * .16, W - s * .02, H - s * .02, s * .12); c.fill(); } };
  const so = st.seed || 0;
  /** материал поверх текущего пути: 2K-текстура металла/камня + грязь (только на карте, не в иконках) */
  const mat = (kind: TexName = 'metal', k = .5) => {
    if (st.icon || s < 10) return;
    const p1 = pixPattern(c, kind, s, (so * 37) % 97 * s * .13, (so * 53) % 89 * s * .11); if (!p1) return;
    c.save(); c.clip();
    c.globalCompositeOperation = kind === 'metal' ? 'overlay' : 'soft-light'; c.globalAlpha = k; c.fillStyle = p1; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    const p2 = pixPattern(c, 'grime', s, so * s * .7, so * s * .3); if (p2) { c.globalAlpha = .35; c.fillStyle = p2; c.fillRect(0, 0, W, H); }
    c.restore();
  };
  const body = (pad: number, fill: string, r = .12, kind: TexName = 'metal') => {
    const g = c.createLinearGradient(0, 0, W * .3, H); g.addColorStop(0, shade(fill, .2)); g.addColorStop(1, shade(fill, -.25)); c.fillStyle = g;
    rr(c, pad, pad, W - pad * 2, H - pad * 2, s * r); c.fill(); mat(kind);
    rr(c, pad, pad, W - pad * 2, H - pad * 2, s * r); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .045); c.stroke();
    if (!st.icon) { c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = Math.max(1, s * .03); rr(c, pad + s * .05, pad + s * .05, W - pad * 2 - s * .1, H - pad * 2 - s * .1, s * r * .8); c.stroke(); }
  };
  const softShadow = () => { if (st.icon) return; const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(0,0,0,.0)'); g.addColorStop(.5, 'rgba(0,0,0,.32)'); g.addColorStop(1, 'rgba(0,0,0,.12)'); c.fillStyle = g; rr(c, s * .22, s * .28, W, H - s * .1, s * .2); c.fill(); };
  const arrow = (d: number, len = .3, colr = 'rgba(255,255,255,.7)') => {
    c.save(); c.translate(W / 2, H / 2); c.rotate(d * Math.PI / 2); c.fillStyle = colr; c.beginPath(); c.moveTo(0, -s * len); c.lineTo(s * .16, -s * (len - .18)); c.lineTo(-s * .16, -s * (len - .18)); c.closePath(); c.fill(); c.restore();
  };
  switch (p.type) {
    case 'rail': { const sh = shapeOf(pid, dir); drawRail(c, pid, dir, sh.ox * s, sh.oy * s, s, { ghost: st.ghost }); break; }
    case 'stop': drawStop(c, 0, 0, s, dir, { ghost: st.ghost }); break;
    case 'loco': case 'wagon': drawCar(c, pid, W / 2, H / 2, 0, -1, s, { ghost: st.ghost }); break;
    case 'signal': drawSignal(c, 0, 0, s, dir, st.icon ? 0 : 0, pid === 'rail-chain-signal', { ghost: st.ghost }); break;
    case 'tpump': drawTPump(c, 0, 0, s, dir, { ghost: st.ghost, working: st.working, t: st.t, drain: (st as any).drain }); break;
    case 'belt': case 'underground': case 'splitter': {
      const segs = p.type === 'splitter' ? 2 : 1;
      for (let i = 0; i < segs; i++) {
        c.save();
        const ox = dir % 2 === 0 ? i * s : 0, oy = dir % 2 === 0 ? 0 : i * s;
        c.translate(ox + s / 2, oy + s / 2); c.rotate(dir * Math.PI / 2);
        c.fillStyle = '#2b2b2f'; c.fillRect(-s / 2, -s / 2, s, s);
        c.fillStyle = shade(col, -.15); c.fillRect(-s / 2, -s / 2, s * .1, s); c.fillRect(s * .4, -s / 2, s * .1, s);
        if (st.curve != null && st.curve >= 0 && p.type === 'belt') {
          // поворот: дорисуем боковой вход
          const rel = ((st.curve - dir) + 4) % 4; // 1 = вход слева (едет на восток относительно)
          c.fillStyle = '#2b2b2f'; c.fillRect(-s / 2, -s * .4, s, s * .9);
          c.fillStyle = shade(col, -.15);
          if (rel === 1) { c.fillRect(-s / 2, s * .4, s * .9, s * .1); c.fillRect(s * .4, -s / 2, s * .1, s); c.fillRect(-s / 2, -s / 2, s * .1, s * .1); }
          else { c.fillRect(-s * .4, s * .4, s * .9, s * .1); c.fillRect(-s / 2, -s / 2, s * .1, s); c.fillRect(s * .4, -s / 2, s * .1, s * .1); }
        }
        // шевроны
        const off = ((st.t * (p.speed! / 256)) % 0.25) * s;
        c.strokeStyle = shade(col, .1); c.lineWidth = s * .06; c.globalAlpha = .55;
        c.beginPath(); c.rect(-s * .4, -s / 2, s * .8, s); c.clip();
        for (let k = -1; k < 4; k++) { const yy = s / 2 - k * s * .25 - off; c.beginPath(); c.moveTo(-s * .28, yy + s * .08); c.lineTo(0, yy - s * .06); c.lineTo(s * .28, yy + s * .08); c.stroke(); }
        c.globalAlpha = 1;
        c.restore();
      }
      if (p.type === 'underground') {
        c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2);
        c.fillStyle = shade(col, -.3); const into = st.ug !== 'out';
        rr(c, -s * .48, into ? -s * .48 : -s * .05, s * .96, s * .53, s * .1); c.fill();
        c.fillStyle = '#111'; rr(c, -s * .34, into ? -s * .4 : s * .08, s * .68, s * .3, s * .08); c.fill();
        c.restore();
      }
      if (p.type === 'splitter') { c.fillStyle = shade(col, -.3); c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2); rr(c, -s * .95, -s * .18, s * 1.9, s * .36, s * .1); c.fill(); c.fillStyle = '#222'; c.fillRect(-s * .7, -s * .06, s * 1.4, s * .12); c.restore(); }
      break;
    }
    case 'inserter': {
      c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.arc(s * .55, s * .58, s * .3, 0, 7); c.fill();
      c.fillStyle = '#555'; c.beginPath(); c.arc(s / 2, s / 2, s * .3, 0, 7); c.fill();
      c.fillStyle = col; c.beginPath(); c.arc(s / 2, s / 2, s * .22, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .04; c.stroke();
      if (st.icon) { c.strokeStyle = col; c.lineWidth = s * .12; c.lineCap = 'round'; c.beginPath(); c.moveTo(s / 2, s / 2); c.lineTo(s * .2, s * .15); c.lineTo(s * .8, s * .1); c.stroke(); }
      break;
    }
    case 'chest': if (p.w > 1) { // v1.4: склад 3×3 — дощатые стенки, ворота; у логистических — цветная полоса
      shadow(); body(s * .08, p.logi ? '#6b625a' : col, .05);
      c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = s * .05; for (let i = 1; i < 6; i++) { const y = s * .12 + i * (H - s * .24) / 6; c.beginPath(); c.moveTo(s * .16, y); c.lineTo(W - s * .16, y); c.stroke(); }
      if (p.logi) { c.fillStyle = col; c.fillRect(s * .08, H * .4, W - s * .16, H * .14); c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(s * .08, H * .54, W - s * .16, H * .02); }
      c.fillStyle = '#3a3530'; c.fillRect(W * .36, H * .62, W * .28, H * .3); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.strokeRect(W * .36, H * .62, W * .28, H * .3);
      c.fillStyle = '#d9c38a'; c.fillRect(W * .47, H * .7, W * .06, H * .06); break;
    }
    if (p.logi) { shadow(); body(s * .1, '#6d7680', .08); c.fillStyle = col; c.fillRect(s * .1, s * .36, s * .8, s * .2); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(s * .1, s * .55, s * .8, s * .04); c.fillStyle = '#d9c38a'; c.fillRect(s * .44, s * .34, s * .12, s * .2); break; } shadow(); body(s * .1, col, .08); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(s * .1, s * .42, s * .8, s * .07); c.fillStyle = '#d9c38a'; c.fillRect(s * .44, s * .38, s * .12, s * .16); break;
    case 'pipe': {
      if (p.ugReach) {
        c.save(); c.translate(s / 2, s / 2); c.rotate(dir * Math.PI / 2);
        c.fillStyle = '#6b737a'; c.fillRect(-s * .2, 0, s * .4, s * .52);
        const g = c.createLinearGradient(-s * .4, 0, s * .4, 0); g.addColorStop(0, '#5c646b'); g.addColorStop(.5, '#aab2b9'); g.addColorStop(1, '#4d555c');
        c.fillStyle = g; rr(c, -s * .36, -s * .34, s * .72, s * .5, s * .12); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .04; c.stroke();
        c.fillStyle = '#222'; rr(c, -s * .24, -s * .42, s * .48, s * .14, s * .05); c.fill();
        c.restore(); break;
      }
      c.fillStyle = shade(col, -.2); c.beginPath(); c.arc(s / 2, s / 2, s * .3, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(s / 2, s / 2, s * .22, 0, 7); c.fill(); break;
    }
    case 'pole': {
      if (pid === 'big-electric-pole') {
        c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(W * .5, H * .5, W * .45, s * .2);
        c.strokeStyle = '#6d757c'; c.lineWidth = s * .1; c.beginPath(); c.moveTo(W * .2, H * .9); c.lineTo(W * .45, H * .12); c.moveTo(W * .8, H * .9); c.lineTo(W * .55, H * .12); c.moveTo(W * .28, H * .65); c.lineTo(W * .72, H * .65); c.moveTo(W * .34, H * .42); c.lineTo(W * .66, H * .42); c.moveTo(W * .28, H * .65); c.lineTo(W * .66, H * .42); c.stroke();
        c.fillStyle = '#8e98a6'; c.fillRect(W * .1, H * .1, W * .8, s * .14); c.fillStyle = '#d9a35a'; c.fillRect(W * .1, H * .04, s * .12, s * .12); c.fillRect(W * .9 - s * .12, H * .04, s * .12, s * .12); break;
      }
      if (pid === 'substation') {
        softShadow(); body(s * .1, '#6d8a9a', .15);
        c.fillStyle = '#3a4650'; rr(c, W * .25, H * .25, W * .5, H * .5, s * .1); c.fill();
        c.strokeStyle = '#e8c22e'; c.lineWidth = s * .08; c.beginPath(); c.moveTo(W * .55, H * .3); c.lineTo(W * .42, H * .52); c.lineTo(W * .58, H * .5); c.lineTo(W * .45, H * .72); c.stroke();
        c.fillStyle = '#d9a35a'; for (const [a, b] of [[.15, .15], [.85, .15], [.15, .85], [.85, .85]]) { c.beginPath(); c.arc(W * a, H * b, s * .08, 0, 7); c.fill(); } break;
      }
      if (pid === 'medium-electric-pole') {
        c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(s * .5, s * .45, s * .35, s * .12);
        c.fillStyle = '#7d8792'; c.fillRect(s * .44, s * .12, s * .12, s * .78); c.fillStyle = '#a7aeb5'; c.fillRect(s * .14, s * .16, s * .72, s * .09); c.fillRect(s * .22, s * .32, s * .56, s * .07);
        c.fillStyle = '#d9a35a'; c.fillRect(s * .14, s * .1, s * .08, s * .08); c.fillRect(s * .78, s * .1, s * .08, s * .08); break;
      }
      c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(s * .5, s * .45, s * .35, s * .12);
      c.fillStyle = '#6b4a2b'; c.fillRect(s * .42, s * .15, s * .16, s * .75); c.fillStyle = '#8b6a3b'; c.fillRect(s * .18, s * .2, s * .64, s * .1);
      c.fillStyle = '#d9a35a'; c.fillRect(s * .2, s * .14, s * .08, s * .08); c.fillRect(s * .72, s * .14, s * .08, s * .08); break;
    }
    case 'drill': {
      shadow(); body(s * .06, col);
      c.fillStyle = 'rgba(0,0,0,.35)'; rr(c, W * .2, H * .2, W * .6, H * .6, s * .1); c.fill();
      c.save(); c.translate(W / 2, H / 2); c.rotate(st.working ? st.t * AK * 2 : 0); gear(c, 0, 0, Math.min(W, H) * .26, '#9aa0a6', 6); c.restore();
      arrow(dir, Math.min(W, H) / s / 2 - 0.02, '#ffd34d');
      if (pid === 'burner-mining-drill') { c.fillStyle = st.working ? '#ff9a2e' : '#40302a'; c.fillRect(W * .08, H * .78, W * .2, H * .12); }
      break;
    }
    case 'furnace': {
      if (pid === 'electric-furnace') {
        shadow(); body(s * .08, '#8a5a4a', .15);
        c.fillStyle = '#2a2420'; rr(c, W * .18, H * .2, W * .64, H * .6, s * .12); c.fill();
        for (let i = 0; i < 3; i++) { const y0 = H * (.3 + i * .18); c.strokeStyle = st.working ? `rgb(255,${120 + i * 40},60)` : '#5a3a30'; c.lineWidth = s * .09; c.beginPath(); for (let k = 0; k <= 8; k++) c.lineTo(W * (.24 + k * .065), y0 + (k % 2 ? s * .1 : -s * .1)); c.stroke(); }
        if (st.working) { const g = c.createRadialGradient(W / 2, H / 2, 1, W / 2, H / 2, W * .35); g.addColorStop(0, 'rgba(255,200,120,.5)'); g.addColorStop(1, 'rgba(255,80,0,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
        c.fillStyle = '#c7ccd1'; for (const [a, b] of [[.12, .12], [.88, .12], [.12, .88], [.88, .88]]) { c.beginPath(); c.arc(W * a, H * b, s * .1, 0, 7); c.fill(); }
        break;
      }
      shadow(); body(s * .06, col, .25, pid === 'stone-furnace' ? 'stone' : 'metal');
      c.fillStyle = '#2a2420'; rr(c, W * .25, H * .35, W * .5, H * .42, s * .1); c.fill();
      if (st.working) { const g = c.createRadialGradient(W / 2, H * .6, 1, W / 2, H * .6, W * .3); g.addColorStop(0, '#ffe08a'); g.addColorStop(.5, '#ff8a2a'); g.addColorStop(1, 'rgba(255,80,0,0)'); c.fillStyle = g; c.fillRect(W * .25, H * .35, W * .5, H * .42); }
      c.fillStyle = shade(col, -.35); c.fillRect(W * .35, H * .1, W * .3, H * .12);
      break;
    }
    case 'assembler': {
      if (pid === 'oil-refinery') {
        shadow(); body(s * .06, '#8d969e', .08);
        const tw = (cx: number, cy: number, r: number, h: string) => { const g = c.createRadialGradient(cx - r * .3, cy - r * .3, r * .1, cx, cy, r); g.addColorStop(0, '#f0f2f4'); g.addColorStop(.7, h); g.addColorStop(1, shade(h, -.5)); c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke(); };
        c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(W * .12, H * .55, W * .76, H * .1);
        tw(W * .3, H * .35, s * .75, '#b7bfc6'); tw(W * .68, H * .3, s * .6, '#c9a35a'); tw(W * .62, H * .72, s * .55, '#b7bfc6');
        c.fillStyle = '#3d4246'; c.fillRect(W * .18, H * .78, W * .2, H * .12);
        if (st.working && !st.icon) { const f = (Math.sin(st.t * AK * 5) + 1) / 2; const g = c.createRadialGradient(W * .3, H * .35, 1, W * .3, H * .35, s * .35); g.addColorStop(0, `rgba(255,${180 + f * 60 | 0},80,.9)`); g.addColorStop(1, 'rgba(255,120,0,0)'); c.fillStyle = g; c.beginPath(); c.arc(W * .3, H * .35, s * .35, 0, 7); c.fill(); }
        if (st.recipeColor) { c.fillStyle = st.recipeColor; c.beginPath(); c.arc(W * .68, H * .3, s * .2, 0, 7); c.fill(); }
        break;
      }
      if (pid === 'chemical-plant') {
        shadow(); body(s * .08, '#5b7f9c', .12);
        const g = c.createRadialGradient(W * .42, H * .4, 2, W / 2, H / 2, W * .3); g.addColorStop(0, '#e8f4ff'); g.addColorStop(1, st.recipeColor || '#6fa0c8');
        c.fillStyle = g; c.beginPath(); c.arc(W / 2, H / 2, W * .27, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .05; c.stroke();
        c.save(); c.translate(W / 2, H / 2); c.rotate(st.working ? st.t * AK : 0); c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = s * .06; c.beginPath(); c.arc(0, 0, W * .17, 0, 2.2); c.stroke(); c.beginPath(); c.arc(0, 0, W * .17, 3.14, 5.3); c.stroke(); c.restore();
        c.fillStyle = '#c7ccd1'; for (const [a, b] of [[.17, .17], [.83, .17], [.17, .83], [.83, .83]]) { c.beginPath(); c.arc(W * a, H * b, s * .12, 0, 7); c.fill(); }
        break;
      }
      shadow(); body(s * .08, col);
      c.fillStyle = shade(col, -.3); rr(c, W * .15, H * .15, W * .7, H * .7, s * .12); c.fill();
      c.save(); c.translate(W / 2, H / 2); c.rotate(st.working ? st.t * AK : 0); gear(c, 0, 0, W * .22, '#c9cfd4', 10); c.restore();
      if (st.recipeColor) { c.fillStyle = st.recipeColor; c.beginPath(); c.arc(W / 2, H / 2, W * .07, 0, 7); c.fill(); }
      c.fillStyle = '#3d4246'; for (const [a, b] of [[.12, .12], [.88, .12], [.12, .88], [.88, .88]]) { c.beginPath(); c.arc(W * a, H * b, s * .07, 0, 7); c.fill(); }
      break;
    }
    case 'lab': {
      shadow(); body(s * .1, '#8d99a6', .4);
      const g = c.createRadialGradient(W * .45, H * .4, 2, W / 2, H / 2, W * .35); g.addColorStop(0, '#f2fbff'); g.addColorStop(1, st.working ? '#4fb3ff' : '#7a8fa3');
      c.fillStyle = g; c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = s * .05; c.stroke();
      break;
    }
    case 'pump': {
      shadow(); body(s * .14, col, .2); arrow(dir, .44, '#cfe8ff'); break;
    }
    case 'boiler': {
      shadow(); body(s * .06, col, .3);
      c.fillStyle = '#2a2420'; rr(c, W * .35, H * .3, W * .3, H * .4, s * .08); c.fill();
      if (st.working) { c.fillStyle = '#ff9a2e'; rr(c, W * .38, H * .4, W * .24, H * .25, s * .06); c.fill(); }
      c.fillStyle = '#8d969e';
      c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2);
      const w0 = dir % 2 ? H : W, h0 = dir % 2 ? W : H;
      c.fillRect(-w0 / 2 - s * .02, h0 / 2 - s * .7, s * .25, s * .4); c.fillRect(w0 / 2 - s * .23, h0 / 2 - s * .7, s * .25, s * .4);
      c.fillStyle = '#c7ccd1'; c.fillRect(-s * .15, -h0 / 2 - s * .02, s * .3, s * .25); c.restore();
      break;
    }
    case 'engine': {
      shadow(); body(s * .06, col, .2);
      c.save(); c.translate(W / 2, H / 2); if (dir % 2) c.rotate(Math.PI / 2);
      const L = Math.max(W, H), Sx = Math.min(W, H);
      c.fillStyle = '#6d757c'; rr(c, -Sx * .3, -L * .4, Sx * .6, L * .55, s * .2); c.fill();
      c.save(); c.translate(0, L * .27); c.rotate(st.working ? st.t * AK * 3 : 0); c.strokeStyle = '#3a3f44'; c.lineWidth = s * .12; c.beginPath(); c.arc(0, 0, Sx * .3, 0, 7); c.stroke();
      c.beginPath(); c.moveTo(-Sx * .3, 0); c.lineTo(Sx * .3, 0); c.moveTo(0, -Sx * .3); c.lineTo(0, Sx * .3); c.stroke(); c.restore();
      c.fillStyle = '#c7ccd1'; c.fillRect(-s * .15, -L / 2 - s * .02, s * .3, s * .2); c.fillRect(-s * .15, L / 2 - s * .18, s * .3, s * .2);
      c.restore(); break;
    }

    case 'pumpjack': {
      shadow(); body(s * .1, '#5d5248', .1, 'metal');
      c.fillStyle = '#2b2622'; rr(c, W * .35, H * .62, W * .3, H * .22, s * .06); c.fill();
      const a = st.working ? Math.sin(st.t * AK) * .32 : 0;
      c.save(); c.translate(W * .5, H * .38);
      c.fillStyle = '#4a3f36'; c.beginPath(); c.moveTo(-s * .5, s * .55); c.lineTo(0, -s * .1); c.lineTo(s * .5, s * .55); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .05; c.stroke();
      c.rotate(a);
      const bg = c.createLinearGradient(0, -s * .12, 0, s * .12); bg.addColorStop(0, '#e8a63a'); bg.addColorStop(1, '#9a5f1a');
      c.fillStyle = bg; rr(c, -W * .42, -s * .1, W * .78, s * .2, s * .05); c.fill(); c.stroke();
      c.fillStyle = '#c9822a'; c.beginPath(); c.moveTo(-W * .42, -s * .35); c.quadraticCurveTo(-W * .55, 0, -W * .42, s * .35); c.lineTo(-W * .36, s * .2); c.lineTo(-W * .36, -s * .2); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#333'; c.fillRect(W * .3, -s * .22, s * .3, s * .44);
      c.restore();
      c.fillStyle = '#777'; c.beginPath(); c.arc(W * .5, H * .38, s * .1, 0, 7); c.fill();
      arrow(dir, H / s / 2 - .02, '#9ad1ff');
      break;
    }
    case 'tank': {
      shadow(); c.save(); c.translate(W / 2, H / 2);
      const R = Math.min(W, H) * .46; const g = c.createRadialGradient(-R * .35, -R * .35, R * .1, 0, 0, R);
      g.addColorStop(0, '#e6eaee'); g.addColorStop(.7, '#9aa3ab'); g.addColorStop(1, '#5e666d');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, 7); c.fill(); c.translate(-W / 2, -H / 2); mat('metal', .45); c.translate(W / 2, H / 2);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .05; c.beginPath(); c.arc(0, 0, R, 0, 7); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = s * .03; c.beginPath(); c.arc(0, 0, R * .7, 0, 7); c.stroke();
      if (st.fill != null && !st.icon) { c.fillStyle = 'rgba(0,0,0,.5)'; rr(c, -R * .5, R * .15, R, R * .2, s * .05); c.fill(); c.fillStyle = st.fluidColor || '#3c8fd8'; rr(c, -R * .48, R * .17, R * .96 * st.fill, R * .16, s * .04); c.fill(); }
      c.fillStyle = '#5e666d'; for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) c.fillRect(dx * R * .98 - s * .17, dy * R * .98 - s * .17, s * .34, s * .34);
      c.restore(); break;
    }
    case 'turret': {
      shadow(); c.save(); c.translate(W / 2, H / 2);
      const R = W * .44; c.fillStyle = '#4a4f54'; c.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; c.lineTo(Math.cos(a) * R, Math.sin(a) * R); } c.closePath(); c.fill();
      c.translate(-W / 2, -H / 2); mat('metal', .5); c.translate(W / 2, H / 2);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .05; c.stroke();
      c.rotate((st.aim ?? -Math.PI / 2) + Math.PI / 2);
      const hg = c.createRadialGradient(-R * .2, -R * .2, 2, 0, 0, R * .6); hg.addColorStop(0, '#e8c27a'); hg.addColorStop(1, '#8a6a2a');
      c.fillStyle = '#2b2e31'; c.fillRect(-s * .16, -R * 1.25, s * .12, R * .9); c.fillRect(s * .04, -R * 1.25, s * .12, R * .9);
      if (st.flash) { const fg = c.createRadialGradient(0, -R * 1.35, 0, 0, -R * 1.35, s * .45); fg.addColorStop(0, 'rgba(255,250,200,1)'); fg.addColorStop(.4, 'rgba(255,190,60,.8)'); fg.addColorStop(1, 'rgba(255,120,0,0)'); c.fillStyle = fg; c.beginPath(); c.arc(0, -R * 1.35, s * .45, 0, 7); c.fill(); }
      c.fillStyle = hg; rr(c, -R * .55, -R * .5, R * 1.1, R * 1.05, s * .15); c.fill(); c.stroke();
      c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(-R * .3, -R * .3, R * .6, R * .12);
      c.restore(); break;
    }
    case 'wall': {
      softShadow();
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#b8ae9e'); g.addColorStop(1, '#7a7264'); c.fillStyle = g;
      rr(c, s * .02, s * .02, W - s * .04, H - s * .04, s * .06); c.fill(); mat('stone', .8);
      c.strokeStyle = 'rgba(40,34,28,.6)'; c.lineWidth = s * .04;
      c.beginPath(); c.moveTo(0, H * .5); c.lineTo(W, H * .5); c.moveTo(W * .5, 0); c.lineTo(W * .5, H * .5); c.moveTo(W * .25, H * .5); c.lineTo(W * .25, H); c.moveTo(W * .75, H * .5); c.lineTo(W * .75, H); c.stroke();
      rr(c, s * .02, s * .02, W - s * .04, H - s * .04, s * .06); c.strokeStyle = 'rgba(0,0,0,.55)'; c.stroke();
      break;
    }
    case 'combinator': { // v1.5: постоянный комбинатор — корпус с табло и клеммами
      softShadow(); c.fillStyle = '#4c5458'; rr(c, s * .1, s * .14, W - s * .2, H - s * .26, s * .08); c.fill(); mat('metal', .45);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .04; rr(c, s * .1, s * .14, W - s * .2, H - s * .26, s * .08); c.stroke();
      c.fillStyle = '#152018'; rr(c, s * .22, s * .26, W - s * .44, s * .3, s * .04); c.fill();
      c.fillStyle = st.ghost ? '#6a8a6a' : '#7cf08a'; for (let i = 0; i < 3; i++) c.fillRect(s * (.28 + i * .16), s * .34, s * .1, s * .14);
      c.fillStyle = '#d8423a'; c.beginPath(); c.arc(s * .3, s * .72, s * .07, 0, 7); c.fill(); c.fillStyle = '#3fb54a'; c.beginPath(); c.arc(s * .7, s * .72, s * .07, 0, 7); c.fill();
      break;
    }
    case 'arith': case 'decider': { // v1.6: корпус 1×2, табло со знаком операции; клеммы: выход — спереди (по направлению), вход — сзади
      softShadow(); c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2);
      const w = s, h = 2 * s, x0 = -w / 2, y0 = -h / 2;
      c.fillStyle = p.type === 'arith' ? '#4a5866' : '#5e5446'; rr(c, x0 + s * .1, y0 + s * .18, w - s * .2, h - s * .36, s * .08); c.fill(); mat('metal', .45);
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .04; rr(c, x0 + s * .1, y0 + s * .18, w - s * .2, h - s * .36, s * .08); c.stroke();
      c.fillStyle = '#121a20'; rr(c, x0 + s * .2, -s * .36, w - s * .4, s * .72, s * .05); c.fill();
      const txt = st.op || (p.type === 'arith' ? '+' : '>'); c.save(); c.rotate(-dir * Math.PI / 2);
      c.fillStyle = st.ghost ? '#7a8a9a' : st.working ? (p.type === 'arith' ? '#7cc8ff' : '#ffc86a') : '#5a6670'; c.font = `bold ${Math.round(s * (txt.length > 2 ? .26 : txt.length > 1 ? .36 : .5))}px system-ui,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, 0, s * .03); c.restore();
      // клеммы: выход (вверху в локальных координатах) — светлые, вход — тёмные
      for (const [yy, a] of [[y0 + s * .14, '#d8dde0'], [-y0 - s * .14, '#6a7278']] as [number, string][]) { c.fillStyle = a; c.fillRect(-s * .3, yy - s * .05, s * .14, s * .1); c.fillRect(s * .16, yy - s * .05, s * .14, s * .1); }
      c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(0, y0 + s * .24); c.lineTo(s * .1, y0 + s * .4); c.lineTo(-s * .1, y0 + s * .4); c.fill();
      c.restore(); break;
    }
    case 'lamp': {
      softShadow(); c.fillStyle = '#555b60'; c.beginPath(); c.arc(W / 2, H / 2, s * .32, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .04; c.stroke();
      const lc = st.lit && st.lampColor; const g = c.createRadialGradient(W * .45, H * .42, 1, W / 2, H / 2, s * .24); g.addColorStop(0, lc ? shade(lc, .55) : st.lit ? '#fffbe0' : '#d8d4c0'); g.addColorStop(1, lc ? lc : st.lit ? '#ffd860' : '#8a8670');
      c.fillStyle = g; c.beginPath(); c.arc(W / 2, H / 2, s * .22, 0, 7); c.fill(); break;
    }
    case 'nest': {
      const t = st.t * AK + so;
      if (!st.icon) { c.fillStyle = 'rgba(30,10,25,.45)'; c.beginPath(); c.ellipse(W / 2 + s * .15, H / 2 + s * .2, W * .55, H * .45, 0, 0, 7); c.fill(); }
      // слизь вокруг
      c.fillStyle = 'rgba(90,40,70,.55)'; c.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = W * (.46 + Math.sin(i * 2.3 + so) * .05); c.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r * .9); } c.closePath(); c.fill();
      const pulse = 1 + Math.sin(t) * .03;
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2 + so, d = W * .16, x0 = W / 2 + Math.cos(a) * d, y0 = H / 2 + Math.sin(a) * d * .8, r = W * .2 * pulse;
        const g = c.createRadialGradient(x0 - r * .3, y0 - r * .4, r * .1, x0, y0, r); g.addColorStop(0, '#d07aa8'); g.addColorStop(.6, '#8a3a6a'); g.addColorStop(1, '#3a1430');
        c.fillStyle = g; c.beginPath(); c.arc(x0, y0, r, 0, 7); c.fill();
      }
      const hg = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * .14); hg.addColorStop(0, `rgba(255,${150 + Math.sin(t * 2) * 60 | 0},90,.95)`); hg.addColorStop(1, 'rgba(120,20,40,0)');
      c.fillStyle = hg; c.beginPath(); c.arc(W / 2, H / 2, W * .14, 0, 7); c.fill();
      c.fillStyle = '#1a0614'; c.beginPath(); c.ellipse(W / 2, H / 2, W * .06, H * .05, 0, 0, 7); c.fill();
      break;
    }
    case 'beacon': {
      shadow(); body(s * .1, '#4d5a66', .3);
      c.fillStyle = '#2b3036'; c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.fill();
      const on = st.working && !st.icon;
      const mods = st.mods || [];
      mods.forEach((m, i) => { const a = i / Math.max(1, mods.length) * Math.PI * 2 + (on ? st.t * AK : 0); const col2 = m ? ITEMS[m].color : '#333'; c.fillStyle = col2; c.beginPath(); c.arc(W / 2 + Math.cos(a) * W * .2, H / 2 + Math.sin(a) * H * .2, s * .16, 0, 7); c.fill(); });
      const g = c.createRadialGradient(W / 2, H / 2, 1, W / 2, H / 2, W * .14); g.addColorStop(0, on ? '#e8f8ff' : '#8a96a3'); g.addColorStop(1, on ? '#3a8fd8' : '#4a5560');
      c.fillStyle = g; c.beginPath(); c.arc(W / 2, H / 2, W * .12, 0, 7); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke();
      c.strokeStyle = '#9aa3ab'; c.lineWidth = s * .06; c.beginPath(); c.moveTo(W / 2, H / 2 - W * .12); c.lineTo(W / 2, H * .08); c.stroke();
      if (on) { c.fillStyle = `rgba(120,200,255,${.5 + Math.sin(st.t * AK * 2) * .3})`; c.beginPath(); c.arc(W / 2, H * .08, s * .1, 0, 7); c.fill(); }
      break;
    }
    case 'accumulator': {
      shadow(); body(s * .08, '#5e666d', .12);
      for (const [a, b] of [[.3, .32], [.7, .32], [.3, .7], [.7, .7]]) {
        const g = c.createLinearGradient(W * a - s * .2, 0, W * a + s * .2, 0); g.addColorStop(0, '#6d757c'); g.addColorStop(.5, '#c7ccd1'); g.addColorStop(1, '#4d555c');
        c.fillStyle = g; rr(c, W * a - s * .22, H * b - s * .26, s * .44, s * .5, s * .08); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .03; c.stroke();
      }
      if (st.fill != null && !st.icon) { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(W * .12, H * .5 - s * .06, W * .76, s * .12); c.fillStyle = st.fill > .2 ? '#4be36b' : '#e8c22e'; c.fillRect(W * .12, H * .5 - s * .06, W * .76 * st.fill, s * .12); }
      break;
    }
    case 'radar': {
      shadow(); body(s * .12, '#6d757c', .2);
      c.save(); c.translate(W / 2, H / 2); c.rotate(st.working && !st.icon ? st.t * AK : .6);
      c.fillStyle = '#c7ccd1'; c.beginPath(); c.ellipse(0, 0, W * .38, H * .16, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .05; c.stroke();
      c.fillStyle = '#8d969e'; c.beginPath(); c.ellipse(0, 0, W * .3, H * .1, 0, 0, 7); c.fill();
      c.fillStyle = '#3a3f44'; c.fillRect(-s * .06, -H * .12, s * .12, H * .24);
      c.restore(); break;
    }
    case 'silo': {
      if (!st.icon) { c.fillStyle = 'rgba(0,0,0,.3)'; rr(c, s * .3, s * .4, W, H - s * .2, s * .4); c.fill(); }
      const g0 = c.createLinearGradient(0, 0, W, H); g0.addColorStop(0, '#a8a296'); g0.addColorStop(1, '#6e695f'); c.fillStyle = g0; rr(c, s * .1, s * .1, W - s * .2, H - s * .2, s * .4); c.fill(); mat('stone', .7);
      rr(c, s * .1, s * .1, W - s * .2, H - s * .2, s * .4); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .06); c.stroke();
      // жёлто-чёрные полосы по краю шахты
      c.save(); c.beginPath(); c.arc(W / 2, H / 2, W * .36, 0, 7); c.clip();
      for (let i = -12; i < 12; i++) { c.fillStyle = i % 2 ? '#e8b84a' : '#222'; c.beginPath(); c.moveTo(W / 2 + i * s * .6, 0); c.lineTo(W / 2 + i * s * .6 + s * .6, 0); c.lineTo(W / 2 + i * s * .6 - H + s * .6, H); c.lineTo(W / 2 + i * s * .6 - H, H); c.fill(); }
      c.restore();
      const L = st.launch || 0; const open = Math.min(1, L * 5 + (st.parts && st.parts >= 100 ? .15 : 0));
      c.fillStyle = '#111'; c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.fill();
      // ракета: растёт по мере сборки, взлетает при запуске
      if (!st.icon && (st.parts || L)) {
        const k = L ? 1 : Math.min(1, (st.parts || 0) / 100); const up = L > 0.25 ? Math.pow((L - .25) / .75, 2) * H * 3 : 0;
        c.save(); c.translate(W / 2, H / 2 - up);
        const rh = H * .5 * (.3 + .7 * k), rw = W * .09;
        const rg = c.createLinearGradient(-rw, 0, rw, 0); rg.addColorStop(0, '#9aa3ab'); rg.addColorStop(.5, '#f2f4f6'); rg.addColorStop(1, '#7a838b');
        c.fillStyle = rg; c.beginPath(); c.moveTo(0, -rh * .6); c.quadraticCurveTo(rw, -rh * .35, rw, rh * .3); c.lineTo(-rw, rh * .3); c.quadraticCurveTo(-rw, -rh * .35, 0, -rh * .6); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .05; c.stroke();
        c.fillStyle = '#d8503a'; c.beginPath(); c.moveTo(-rw, rh * .1); c.lineTo(-rw * 1.8, rh * .4); c.lineTo(-rw, rh * .3); c.fill(); c.beginPath(); c.moveTo(rw, rh * .1); c.lineTo(rw * 1.8, rh * .4); c.lineTo(rw, rh * .3); c.fill();
        if (L > 0.15) { const fg = c.createRadialGradient(0, rh * .35, 0, 0, rh * .5, rw * 3); fg.addColorStop(0, 'rgba(255,250,200,1)'); fg.addColorStop(.4, 'rgba(255,170,60,.85)'); fg.addColorStop(1, 'rgba(255,90,0,0)'); c.fillStyle = fg; c.beginPath(); c.ellipse(0, rh * .6, rw * 2.2, rw * (3 + Math.sin(st.t) * .5), 0, 0, 7); c.fill(); }
        c.restore();
      }
      // створки
      c.fillStyle = '#4a4f54'; const dw = W * .3 * (1 - open);
      c.save(); c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.clip(); c.fillRect(W / 2 - W * .3, H * .2, dw, H * .6); c.fillRect(W / 2 + W * .3 - dw, H * .2, dw, H * .6); c.restore();
      c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = s * .08; c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.stroke();
      // опоры по углам
      c.fillStyle = '#7d8792'; for (const [a, b] of [[.1, .1], [.9, .1], [.1, .9], [.9, .9]]) { rr(c, W * a - s * .5, H * b - s * .5, s, s, s * .15); c.fill(); }
      break;
    }
    case 'roboport': {
      shadow(); body(s * .08, '#6d6a62', .14, 'stone');
      // жёлто-чёрная кайма
      c.save(); rr(c, s * .3, s * .3, W - s * .6, H - s * .6, s * .1); c.clip();
      for (let i = -10; i < 14; i++) { c.fillStyle = i % 2 ? '#e8b84a' : '#2a2a2a'; c.beginPath(); c.moveTo(i * s * .4, 0); c.lineTo(i * s * .4 + s * .4, 0); c.lineTo(i * s * .4 - H + s * .4, H); c.lineTo(i * s * .4 - H, H); c.fill(); }
      c.restore();
      c.fillStyle = '#4a4f54'; rr(c, s * .55, s * .55, W - s * 1.1, H - s * 1.1, s * .1); c.fill(); mat('metal', .6);
      // четыре площадки зарядки по углам
      for (const [a, b] of [[.18, .18], [.82, .18], [.18, .82], [.82, .82]]) {
        c.fillStyle = '#2b3036'; c.beginPath(); c.arc(W * a, H * b, s * .32, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .04; c.stroke();
        const on = st.working && !st.icon; c.fillStyle = on ? `rgba(110,220,255,${.55 + Math.sin((st.t + a * 40 + b * 70) * AK * 3) * .35})` : '#56606a'; c.beginPath(); c.arc(W * a, H * b, s * .13, 0, 7); c.fill();
      }
      // башня с антенной
      const g = c.createLinearGradient(W * .38, 0, W * .62, 0); g.addColorStop(0, '#8d969e'); g.addColorStop(.5, '#d6dade'); g.addColorStop(1, '#6d757c');
      c.fillStyle = g; rr(c, W * .36, H * .3, W * .28, H * .4, s * .12); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .05; c.stroke();
      c.fillStyle = '#2b3036'; c.fillRect(W * .42, H * .4, W * .16, H * .08);
      c.strokeStyle = '#9aa3ab'; c.lineWidth = s * .07; c.beginPath(); c.moveTo(W / 2, H * .3); c.lineTo(W / 2, -s * .5); c.stroke();
      c.save(); c.translate(W / 2, -s * .2); c.rotate(st.working && !st.icon ? st.t * AK * 1.5 : .5); c.fillStyle = '#c7ccd1'; c.beginPath(); c.ellipse(0, 0, s * .5, s * .14, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .04; c.stroke(); c.restore();
      if (!st.icon) { c.fillStyle = st.working ? '#ffb030' : '#555'; c.beginPath(); c.arc(W / 2, -s * .5, s * .09, 0, 7); c.fill(); }
      break;
    }
    case 'solar': {
      shadow(); body(s * .06, '#6d757c', .08);
      c.fillStyle = '#1d3566'; c.fillRect(W * .1, H * .1, W * .8, H * .8);
      c.strokeStyle = '#5a7fc0'; c.lineWidth = Math.max(1, s * .03);
      for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(W * (.1 + i * .8 / 6), H * .1); c.lineTo(W * (.1 + i * .8 / 6), H * .9); c.stroke(); }
      for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(W * .1, H * (.1 + i * .2)); c.lineTo(W * .9, H * (.1 + i * .2)); c.stroke(); }
      c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.moveTo(W * .1, H * .1); c.lineTo(W * .5, H * .1); c.lineTo(W * .1, H * .5); c.fill();
      break;
    }
  }
  c.restore();
}
const iconCache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();
export function itemIcon(id: string, size = 32): HTMLCanvasElement {
  const k = id + '@' + size; let cv = iconCache.get(k);
  if (!cv) { cv = document.createElement('canvas'); cv.width = cv.height = size; drawItemIcon(cv.getContext('2d')!, id, size); iconCache.set(k, cv); }
  return cv;
}
export function iconURL(id: string): string { let u = urlCache.get(id); if (!u) { u = itemIcon(id, 64).toDataURL(); urlCache.set(id, u); } return u; }

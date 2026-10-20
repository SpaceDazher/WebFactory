// Процедурная графика: иконки предметов и спрайты построек (стиль «читаемый MVP», 15.1).
import { beltLanePos } from '../sim/beltgeom';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { pixPattern, TexName } from './textures';
import { drawRail, drawCar, drawStop, drawSignal, drawTPump } from './rails';
import { shapeOf } from '../sim/railgeo';
import { drawEntityArt2, drawItemIcon2 } from './art2';
import { drawNuclearArt, drawNuclearIcon } from './art116';
import { drawSwarmStructure } from './swarmart';
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
  if (id.startsWith('bio-coated-')) {
    const source = it.bioCoating?.source || id.slice('bio-coated-'.length);
    c.save();
    if (ITEMS[source] && source !== id && !ITEMS[source].bioCoating && !source.startsWith('bio-coated-')) drawItemIcon(c, source, s);
    c.strokeStyle = it.bioCoating?.kind === 'accuracy' ? '#8dc6d1' : it.bioCoating?.amount === .04 ? '#c7a678' : '#83c88b';
    c.lineWidth = Math.max(1.5, s * .07); c.beginPath(); c.arc(s * .5, s * .5, s * .44, -.8, .8); c.stroke();
    if (it.bioCoating?.kind === 'accuracy') { c.beginPath(); c.moveTo(s*.36,s*.5); c.lineTo(s*.64,s*.5); c.moveTo(s*.5,s*.36); c.lineTo(s*.5,s*.64); c.stroke(); }
    c.fillStyle = '#8ed18e'; c.beginPath(); c.ellipse(s * .78, s * .23, s * .12, s * .065, -.65, 0, 7); c.fill(); c.restore(); return;
  }
  const col = it.color;
  c.save(); c.lineJoin = 'round';
  if (drawNuclearIcon(c, id, s) || drawItemIcon2(c, id, s)) { c.restore(); return; }
  switch (it.icon) {
    case 'sample': case 'capsule': {
      c.fillStyle = '#213b42'; rr(c, s * .27, s * .15, s * .46, s * .71, s * .12); c.fill();
      c.strokeStyle = '#bdd9d6'; c.lineWidth = s * .035; c.stroke();
      c.fillStyle = id === 'empty-bio-capsule' ? '#30494d' : col;
      rr(c, s * .32, s * .39, s * .36, s * .39, s * .06); c.fill();
      c.fillStyle = '#9fbab6'; rr(c, s * .25, s * .13, s * .5, s * .15, s * .035); c.fill();
      c.fillStyle = '#ffffff85'; c.fillRect(s * .34, s * .32, s * .045, s * .37);
      if (it.icon === 'sample') { c.fillStyle = '#dce4b2'; c.beginPath(); c.ellipse(s * .51, s * .59, s * .1, s * .07, -.6, 0, 7); c.fill(); }
      break;
    }
    case 'tool': {
      c.save(); c.translate(s * .5, s * .5); c.rotate(.45);
      c.fillStyle = '#bccdc8'; rr(c, -s * .13, -s * .18, s * .26, s * .5, s * .04); c.fill();
      c.fillStyle = col; rr(c, -s * .21, -s * .36, s * .42, s * .3, s * .07); c.fill();
      c.fillStyle = '#66d0cf'; c.fillRect(-s * .11, -s * .29, s * .22, s * .1);
      c.strokeStyle = '#e2ece7'; c.lineWidth = s * .035; c.beginPath(); c.moveTo(0, s * .32); c.lineTo(0, s * .45); c.stroke(); c.restore();
      break;
    }
    case 'residue': {
      c.fillStyle = '#424b40'; rr(c, s * .17, s * .38, s * .66, s * .45, s * .07); c.fill();
      c.fillStyle = col; for (const [x,y,r] of [[.33,.4,.16],[.57,.34,.18],[.68,.51,.14]]) { c.beginPath(); c.arc(x*s,y*s,r*s,0,7); c.fill(); }
      c.strokeStyle = '#a1a57f'; c.lineWidth = s * .035; c.strokeRect(s * .19,s * .58,s * .62,s * .2);
      break;
    }
    case 'bio-fraction': {
      c.fillStyle = '#34453d'; c.beginPath(); c.arc(s * .5, s * .52, s * .37, 0, 7); c.fill();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, x = s * (.5 + Math.cos(a) * .2), y = s * (.5 + Math.sin(a) * .2); c.fillStyle = i % 2 ? '#a3d79b' : col; c.beginPath(); c.ellipse(x, y, s * .1, s * .065, a, 0, 7); c.fill(); }
      c.strokeStyle = '#d1e7bf'; c.lineWidth = s * .035; c.beginPath(); c.arc(s * .5, s * .5, s * .35, 0, 7); c.stroke(); break;
    }
    case 'bio-composite': {
      c.fillStyle = '#31453c'; rr(c, s * .12, s * .2, s * .76, s * .62, s * .12); c.fill();
      c.fillStyle = col; c.beginPath(); c.moveTo(s * .5, s * .28); c.lineTo(s * .72, s * .42); c.lineTo(s * .68, s * .68); c.lineTo(s * .5, s * .77); c.lineTo(s * .32, s * .68); c.lineTo(s * .28, s * .42); c.closePath(); c.fill();
      c.strokeStyle = '#d1e7bf'; c.lineWidth = s * .04; c.stroke(); break;
    }
    case 'bio-lining': {
      c.fillStyle = '#354941'; c.beginPath(); c.moveTo(s * .5, s * .12); c.lineTo(s * .8, s * .24); c.lineTo(s * .74, s * .62); c.quadraticCurveTo(s * .68, s * .8, s * .5, s * .9); c.quadraticCurveTo(s * .32, s * .8, s * .26, s * .62); c.lineTo(s * .2, s * .24); c.closePath(); c.fill();
      c.strokeStyle = '#93c995'; c.lineWidth = s * .055; c.stroke(); c.fillStyle = col; c.beginPath(); c.moveTo(s * .5, s * .28); c.lineTo(s * .66, s * .38); c.lineTo(s * .63, s * .6); c.lineTo(s * .5, s * .72); c.lineTo(s * .37, s * .6); c.lineTo(s * .34, s * .38); c.closePath(); c.fill(); break;
    }
    case 'bio-waste': {
      c.fillStyle = '#343c36'; rr(c, s * .17, s * .3, s * .66, s * .53, s * .08); c.fill();
      c.fillStyle = '#adb49a'; c.fillRect(s * .2, s * .26, s * .6, s * .08); c.fillRect(s * .29, s * .48, s * .42, s * .08);
      c.strokeStyle = '#d5dfc1'; c.lineWidth = s * .035; c.strokeRect(s * .17, s * .3, s * .66, s * .53); break;
    }
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
    case 'loco': case 'wagon': case 'fwagon': case 'awagon': c.save(); drawCar(c, it.icon === 'loco' ? 'locomotive' : it.icon === 'fwagon' ? 'fluid-wagon' : it.icon === 'awagon' ? 'artillery-wagon' : 'cargo-wagon', s * .5, s * .5, 1, -1, s * .13, it.icon === 'fwagon' ? { fluid: '#3a7fd0', fill: .6 } : {}); c.restore(); break;
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
export interface ArtState { icon?: boolean; t: number; working?: boolean; curve?: number; ug?: 'in' | 'out'; progress?: number; recipeColor?: string; light?: number; aim?: number; flash?: boolean; seed?: number; conn?: number; lit?: boolean; /** v1.5: цвет лампы по сигналу */ lampColor?: string; fluidColor?: string; fill?: number; launch?: number; parts?: number; mods?: (string | null)[]; ghost?: boolean; open?: boolean; /** v1.6: знак операции комбинатора */ op?: string; /** v1.16: нагрев (доля от 1000 °C), стержень, соседи, маска труб */ heat?: number; rod?: boolean; nb?: number; mask?: number; /** v1.16: непрерывный угол и независимые прицелы автомобильных турелей */ angle?: number; mounts?: { proto: string; aim: number; fireCd: number }[]; }
/** Спрайт постройки: x,y — левый верх в пикселях, s — пикселей на клетку */
export function drawEntityArt(c: C, pid: string, x: number, y: number, s: number, dir: number, st: ArtState) {
  const p = PROTOS[pid]; const W = (dir % 2 ? p.h : p.w) * s, H = (dir % 2 ? p.w : p.h) * s;
  const ms = MOD_SPR.get('entity:' + pid); if (ms) { c.save(); c.translate(x, y); modEntity(c, ms, W, H, dir, st); c.restore(); return; }
  const col = p.color;
  c.save(); c.translate(x, y); c.lineJoin = 'round';
  if (drawNuclearArt(c, pid, W, H, s, dir, st as any) || drawEntityArt2(c, pid, W, H, s, dir, st as any)) { c.restore(); return; }
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
  if (['offshore-pump', 'pumpjack', 'oil-refinery', 'chemical-plant'].includes(pid)) {
    const on = !!st.working && !st.icon, phase = on ? (st.t % 96) * AK : 0;
    shadow(); body(s * .12, pid === 'pumpjack' ? '#66716e' : '#627e88', .1);
    c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2); c.translate(-W / 2, -H / 2);
    const pipe = (x: number, y: number, x2: number, y2: number) => {
      c.strokeStyle = '#263a41'; c.lineWidth = s * .19; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
      c.strokeStyle = '#b1bfc0'; c.lineWidth = s * .1; c.stroke();
    };
    // Neutral pipe stubs follow prototype geometry; recipe-coloured ports remain renderer overlays.
    for (const box of p.fluid || []) for (const q of box.conns) {
      const dx = [0, 1, 0, -1][q.d], dy = [-1, 0, 1, 0][q.d];
      const x = (q.x + .5 + dx * .3) * s, y = (q.y + .5 + dy * .3) * s;
      pipe(x, y, x - dx * s * .38, y - dy * s * .38);
    }
    if (pid === 'offshore-pump') {
      c.fillStyle = '#293d46'; c.fillRect(W * .27, H * .65, W * .46, H * .19);
      c.fillStyle = '#a3b8ba'; for (let i = 0; i < 3; i++) c.fillRect(W * (.32 + i * .14), H * .69, W * .06, H * .12);
      c.fillStyle = '#90a9af'; c.beginPath(); c.arc(W * .5, H * .45, W * .25, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#2f6178'; c.beginPath(); c.arc(W * .5, H * .45, W * .18, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(W * .5, H * .45); c.rotate(phase * 2); c.strokeStyle = on ? '#91d2d9' : '#6c929c'; c.lineWidth = s * .05; c.beginPath(); c.moveTo(-s * .12, 0); c.lineTo(s * .12, 0); c.moveTo(0, -s * .12); c.lineTo(0, s * .12); c.stroke(); c.restore();
    } else if (pid === 'pumpjack') {
      c.fillStyle = '#293b3f'; c.fillRect(W * .17, H * .74, W * .66, H * .1);
      c.strokeStyle = '#a7b5b4'; c.lineWidth = s * .11; c.beginPath(); c.moveTo(W * .35, H * .74); c.lineTo(W * .52, H * .4); c.lineTo(W * .69, H * .74); c.stroke();
      const swing = Math.sin(phase) * .22, rodY = H * .4 - Math.sin(swing) * W * .3;
      c.strokeStyle = '#b7c3bd'; c.lineWidth = s * .055; c.beginPath(); c.moveTo(W * .22, rodY); c.lineTo(W * .22, H * .74); c.stroke();
      c.save(); c.translate(W * .52, H * .4); c.rotate(swing);
      c.fillStyle = '#c7a26a'; rr(c, -W * .32, -H * .035, W * .59, H * .07, s * .04); c.fill();
      c.fillStyle = '#d0ac70'; rr(c, -W * .37, -H * .11, W * .12, H * .23, s * .14); c.fill();
      c.fillStyle = '#42575d'; c.fillRect(W * .18, -H * .065, W * .12, H * .13); c.restore();
      c.save(); c.translate(W * .71, H * .67); c.rotate(phase); c.fillStyle = '#9eafb0'; c.beginPath(); c.arc(0, 0, W * .09, 0, Math.PI * 2); c.fill(); c.fillStyle = '#3b525b'; c.fillRect(-W * .06, -H * .013, W * .12, H * .026); c.restore();
    } else if (pid === 'oil-refinery') {
      pipe(W * .22, H * .75, W * .78, H * .75); pipe(W * .3, H * .46, W * .7, H * .46);
      for (let i = 0; i < 3; i++) {
        const x = W * (.23 + i * .27), y = H * (.23 + (i % 2) * .07);
        c.fillStyle = '#2c4047'; rr(c, x - W * .09, y, W * .18, H * .43, s * .18); c.fill();
        c.fillStyle = i === 1 ? '#baa580' : '#a4b5b8'; rr(c, x - W * .072, y - H * .025, W * .144, H * .4, s * .16); c.fill();
        c.fillStyle = '#607d88'; for (let j = 0; j < 3; j++) c.fillRect(x - W * .075, y + H * (.075 + j * .1), W * .15, H * .025);
        c.fillStyle = '#d1d9d0'; c.beginPath(); c.ellipse(x, y, W * .07, H * .035, 0, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = '#2c4149'; rr(c, W * .39, H * .67, W * .22, H * .14, s * .08); c.fill();
      c.fillStyle = st.recipeColor || '#839ba2'; c.fillRect(W * .42, H * .7, W * .07, H * .065);
      c.fillStyle = on ? 'rgba(243,185,99,' + (.65 + .2 * Math.sin(phase * 2)) + ')' : '#5f6c68'; c.fillRect(W * .53, H * .7, W * .04, H * .065);
    } else {
      pipe(W * .18, H * .72, W * .82, H * .72); pipe(W * .23, H * .29, W * .76, H * .29);
      c.fillStyle = '#a9b9bc'; rr(c, W * .13, H * .3, W * .22, H * .35, s * .18); c.fill();
      c.fillStyle = '#476775'; c.fillRect(W * .16, H * .42, W * .16, H * .08);
      c.fillStyle = '#b6c7c5'; c.beginPath(); c.arc(W * .63, H * .49, W * .23, 0, Math.PI * 2); c.fill();
      c.fillStyle = st.recipeColor || '#609eac'; c.beginPath(); c.arc(W * .63, H * .49, W * .18, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(W * .63, H * .49); c.rotate(phase); c.strokeStyle = '#d8e2da'; c.lineWidth = s * .05;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0, 0, W * .12, i * Math.PI * 2 / 3, i * Math.PI * 2 / 3 + 1); c.stroke(); } c.restore();
      c.fillStyle = '#314b56'; c.fillRect(W * .4, H * .79, W * .28, H * .06); c.fillStyle = on ? '#8ed8c3' : '#6c858a'; c.fillRect(W * .44, H * .805, W * .2, H * .025);
    }
    c.restore(); c.restore(); return;
  }
  switch (p.type) {
    case 'car': {
      const a = st.angle ?? (-Math.PI / 2 + dir * Math.PI / 2);
      shadow(); c.save(); c.translate(W / 2, H / 2); c.rotate(a + Math.PI / 2);
      const bw = s * 1.62, bh = s * 2.72;
      c.fillStyle = '#262b30'; rr(c, -bw * .5 - s * .16, -bh * .44, s * .32, bh * .88, s * .12); c.fill(); rr(c, bw * .5 - s * .16, -bh * .44, s * .32, bh * .88, s * .12); c.fill();
      const cg = c.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2); cg.addColorStop(0, '#e3a050'); cg.addColorStop(.45, col); cg.addColorStop(1, '#754521');
      c.fillStyle = cg; rr(c, -bw / 2, -bh / 2, bw, bh, s * .3); c.fill(); c.strokeStyle = 'rgba(0,0,0,.75)'; c.lineWidth = Math.max(1, s * .07); c.stroke();
      c.fillStyle = '#273943'; rr(c, -bw * .34, -bh * .29, bw * .68, bh * .28, s * .15); c.fill(); c.strokeStyle = 'rgba(230,245,255,.4)'; c.lineWidth = s * .035; c.stroke();
      c.fillStyle = '#d8e5df'; rr(c, -bw * .33, bh * .29, bw * .66, s * .1, s * .05); c.fill();
      c.fillStyle = '#f7d879'; c.fillRect(-bw * .38, -bh * .47, bw * .22, s * .12); c.fillRect(bw * .16, -bh * .47, bw * .22, s * .12);
      c.fillStyle = '#d84c3a'; c.fillRect(-bw * .38, bh * .37, bw * .2, s * .1); c.fillRect(bw * .18, bh * .37, bw * .2, s * .1);
      for (let i = 0; i < (st.mounts || []).length; i++) { const m = st.mounts![i]; c.save(); c.translate(i ? bw * .3 : -bw * .3, i ? -bh * .1 : bh * .12); c.fillStyle = '#51585e'; c.beginPath(); c.arc(0, 0, s * .25, 0, 7); c.fill(); c.rotate(m.aim - a); c.fillStyle = m.proto === 'laser-turret' ? '#5dcaff' : m.proto === 'flamethrower-turret' ? '#ef713a' : '#30363b'; rr(c, -s * .08, -s * .38, s * .16, s * .38, s * .05); c.fill(); if (m.fireCd > 1) { c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(0, -s * .4, s * .12, 0, 7); c.fill(); } c.restore(); }
      c.restore(); break;
    }
    case 'rail': { const sh = shapeOf(pid, dir); drawRail(c, pid, dir, sh.ox * s, sh.oy * s, s, { ghost: st.ghost }); break; }
    case 'stop': drawStop(c, 0, 0, s, dir, { ghost: st.ghost }); break;
    case 'loco': case 'wagon': drawCar(c, pid, W / 2, H / 2, 0, -1, s, { ghost: st.ghost }); break;
    case 'signal': drawSignal(c, 0, 0, s, dir, st.icon ? 0 : 0, pid === 'rail-chain-signal', { ghost: st.ghost }); break;
    case 'tpump': drawTPump(c, 0, 0, s, dir, { ghost: st.ghost, working: st.working, t: st.t, drain: (st as any).drain }); break;
    case 'belt': case 'underground': case 'splitter': {
      const segs = p.type === 'splitter' ? 2 : 1;
      const beltPhase = ((st.icon ? 0 : st.t) * (p.speed! / 256)) % .25;
      for (let i = 0; i < segs; i++) {
        c.save(); c.translate(dir % 2 === 0 ? i * s : 0, dir % 2 === 0 ? 0 : i * s);
        const curve = p.type === 'belt' ? st.curve ?? -1 : -1;
        // Sample the same ribbon as the items; the two lanes remain one continuous belt.
        const point = (pos: number, side: number): [number, number] => {
          const l = beltLanePos(0, 0, dir, curve, 0, pos), r = beltLanePos(0, 0, dir, curve, 1, pos);
          return [((l[0] + r[0]) / 2 + (r[0] - l[0]) * side) * s,
            ((l[1] + r[1]) / 2 + (r[1] - l[1]) * side) * s];
        };
        const ribbon = (width: number) => {
          c.beginPath();
          for (const side of [-width, width]) for (let j = 0; j <= 16; j++) {
            const pos = side < 0 ? j * 16 : 256 - j * 16;
            const q = point(pos, side);
            // Extend the outlet to the tile boundary (item positions stop at 255).
            if (pos === 256) { q[0] += [0, 1, 0, -1][dir] * s / 256; q[1] += [-1, 0, 1, 0][dir] * s / 256; }
            if (side < 0 && j === 0) c.moveTo(...q); else c.lineTo(...q);
          }
          c.closePath();
        };
        ribbon(1); c.fillStyle = '#151c20'; c.fill();
        ribbon(.92); c.fillStyle = shade(col, -.22); c.fill();
        ribbon(.77); c.fillStyle = '#343b3e'; c.fill();
        c.save(); ribbon(.77); c.clip();
        const off = beltPhase;
        c.strokeStyle = '#687274'; c.lineWidth = s * .035;
        for (let k = 0; k < 4; k++) {
          const pos = ((k * .25 + off) % 1) * 256, l = point(pos, -.76), r = point(pos, .76);
          c.beginPath(); c.moveTo(...l); c.lineTo(...r); c.stroke();
          const hl = point((pos + 3) % 256, -.76), hr = point((pos + 3) % 256, .76);
          c.strokeStyle = '#242e32'; c.lineWidth = s * .025; c.beginPath(); c.moveTo(...hl); c.lineTo(...hr); c.stroke();
          c.strokeStyle = '#687274'; c.lineWidth = s * .035;
        }
        c.restore();
        // A small fixed arrow marks the outlet without masking either item lane.
        c.save(); c.translate(s / 2, s / 2); c.rotate(dir * Math.PI / 2);
        c.strokeStyle = shade(col, .25); c.lineWidth = s * .035;
        c.beginPath(); c.moveTo(-s * .09, -s * .22); c.lineTo(0, -s * .31); c.lineTo(s * .09, -s * .22); c.stroke(); c.restore();
        c.restore();
      }
      if (p.type === 'underground') {
        c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2);
        if (st.ug === 'out') c.rotate(Math.PI);
        const yy = -s * .5;
        c.fillStyle = '#1a2227'; rr(c, -s * .49, yy, s * .98, s * .5, s * .05); c.fill();
        c.fillStyle = shade(col, -.12); rr(c, -s * .45, yy + s * .025, s * .9, s * .34, s * .045); c.fill();
        c.fillStyle = shade(col, .3); c.fillRect(-s * .39, yy + s * .055, s * .78, s * .045);
        c.fillStyle = '#101619'; c.fillRect(-s * .33, yy + s * .37, s * .66, s * .09);
        c.fillStyle = '#869293'; c.fillRect(-s * .31, yy + s * .385, s * .62, s * .04);
        c.fillStyle = '#39474b'; const roll = Math.sin(beltPhase * Math.PI * 8) * s * .015; c.fillRect(-s * .31, yy + s * .398 + roll, s * .62, s * .02);
        c.fillStyle = '#242d31'; for (let j = 0; j < 3; j++) c.fillRect(s * (-.25 + j * .2), yy + s * .14, s * .1, s * .11);
        c.restore();
      }
      if (p.type === 'splitter') {
        c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2);
        c.fillStyle = '#182126'; rr(c, -s * .96, -s * .18, s * 1.92, s * .36, s * .04); c.fill();
        c.fillStyle = shade(col, -.1); c.fillRect(-s * .91, -s * .14, s * 1.82, s * .1);
        c.fillStyle = '#758184'; c.fillRect(-s * .83, s * .02, s * 1.66, s * .045);
        c.fillStyle = shade(col, .25); rr(c, -s * .13, -s * .17, s * .26, s * .34, s * .04); c.fill();
        c.strokeStyle = '#354349'; c.lineWidth = s * .035; const drive = beltPhase * Math.PI * 8;
        c.beginPath(); c.moveTo(-Math.cos(drive) * s * .075, -Math.sin(drive) * s * .075); c.lineTo(Math.cos(drive) * s * .075, Math.sin(drive) * s * .075); c.stroke(); c.restore();
      }
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
      if (['small-electric-pole', 'medium-electric-pole', 'big-electric-pole', 'substation'].includes(pid)) {
        const insulator = (x: number, y: number, r: number) => {
          c.fillStyle = '#283c42'; c.fillRect(x - r * .4, y - r, r * .8, r * 2);
          c.fillStyle = '#b6c9bf'; for (let j = 0; j < 3; j++) c.fillRect(x - r, y - r * .8 + j * r * .65, r * 2, r * .35);
          c.fillStyle = '#d7aa62'; c.fillRect(x - r * .3, y - r * 1.25, r * .6, r * .5);
        };
        if (pid === 'substation') {
          shadow(); body(s * .08, '#69797b', .1);
          c.fillStyle = '#26373e'; rr(c, W * .25, H * .3, W * .5, H * .5, s * .08); c.fill();
          c.fillStyle = '#8a9c9e'; for (let i = 0; i < 5; i++) c.fillRect(W * (.29 + i * .09), H * .37, W * .055, H * .34);
          c.fillStyle = '#536b72'; rr(c, W * .32, H * .26, W * .36, H * .18, s * .05); c.fill();
          c.strokeStyle = '#b78550'; c.lineWidth = s * .055; c.beginPath(); c.moveTo(W * .16, H * .2); c.lineTo(W * .16, H * .54); c.lineTo(W * .32, H * .54); c.moveTo(W * .84, H * .2); c.lineTo(W * .84, H * .54); c.lineTo(W * .68, H * .54); c.stroke();
          c.fillStyle = '#27393f'; c.fillRect(W * .12, s * .17, W * .76, s * .065);
          for (const x of [.16, .5, .84]) insulator(W * x, s * .2, s * .085);
          c.fillStyle = '#dcb757'; c.beginPath(); c.moveTo(W * .47, H * .29); c.lineTo(W * .42, H * .39); c.lineTo(W * .56, H * .39); c.closePath(); c.fill();
          c.fillStyle = '#26373e'; c.fillRect(W * .31, H * .85, W * .38, H * .045);
        } else {
          const big = pid === 'big-electric-pole', wood = pid === 'small-electric-pole';
          if (!st.icon) { c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(W * .5, H * .52, W * .4, s * .11); }
          c.fillStyle = '#465456'; for (const x of big ? [.16, .73] : [.36]) { rr(c, W * x, H * .8, W * (big ? .12 : .28), H * .13, s * .04); c.fill(); }
          if (big) {
            c.strokeStyle = '#9caeb1'; c.lineWidth = s * .095; c.beginPath(); c.moveTo(W * .22, H * .86); c.lineTo(W * .43, s * .2); c.lineTo(W * .57, s * .2); c.lineTo(W * .78, H * .86); c.stroke();
            c.strokeStyle = '#607b83'; c.lineWidth = s * .06; c.beginPath(); c.moveTo(W * .31, H * .58); c.lineTo(W * .64, H * .32); c.lineTo(W * .36, H * .32); c.lineTo(W * .69, H * .58); c.lineTo(W * .31, H * .58); c.stroke();
          } else {
            c.fillStyle = wood ? '#795535' : '#667f88'; c.fillRect(W * .43, H * .12, W * .14, H * .75);
            c.fillStyle = wood ? '#ae8251' : '#b2c4c7'; c.fillRect(W * .44, H * .16, W * .035, H * .65);
            if (!wood) { c.fillStyle = '#738e96'; c.fillRect(W * .24, H * .38, W * .52, H * .07); }
          }
          c.fillStyle = wood ? '#a37b49' : '#a5b8ba'; c.fillRect(W * .12, s * .2, W * .76, s * .09);
          for (const x of [.2, .5, .8]) insulator(W * x, s * .2, s * (big ? .085 : .065));
          c.fillStyle = '#c4cbbe'; c.fillRect(W * .46, H * .69, W * .08, H * .035);
        }
        break;
      }
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
      if (pid === 'uranium-mining-drill') {
        const on = st.working && !st.icon, phase = on ? (st.t % 96) * AK : 0;
        shadow(); body(s * .08, '#547c61', .11);
        c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2); c.translate(-W / 2, -H / 2);
        c.fillStyle = '#233d35'; rr(c, W * .2, H * .21, W * .6, H * .53, s * .08); c.fill();
        c.fillStyle = '#b5c8ba'; c.fillRect(W * .46, H * .04, W * .08, H * .19);
        c.fillStyle = '#decb76'; c.beginPath(); c.moveTo(W * .5, H * .05); c.lineTo(W * .45, H * .13); c.lineTo(W * .55, H * .13); c.closePath(); c.fill();
        for (const x of [.1,.8]) { c.fillStyle = '#9fb69d'; rr(c, W * x, H * .25, W * .1, H * .46, s * .04); c.fill(); }
        c.save(); c.translate(W * .5, H * .46); c.rotate(phase * 2); gear(c, 0, 0, W * .21, '#bbcbbb', 10); c.restore();
        c.fillStyle = '#647f69'; c.fillRect(W * .24, H * .43, W * .52, H * .08);
        c.fillStyle = on ? '#afe6a0' : '#7d977a'; c.beginPath(); c.arc(W * .5, H * .47, W * .055, 0, Math.PI * 2); c.fill();
        // Acid coupling at local (1,2), facing south; the output faces north.
        c.fillStyle = '#b7c5b6'; c.fillRect(W * .5 - s * .12, H * .74, s * .24, H * .22);
        c.fillStyle = '#d5bc5d'; c.fillRect(W * .5 - s * .22, H * .85, s * .44, H * .05);
        c.fillStyle = '#253b35'; c.fillRect(W * .5 - s * .08, H * .92, s * .16, H * .045);
        c.fillStyle = '#d8bf62'; c.beginPath(); c.arc(W * .77, H * .15, W * .07, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#293c32'; for (let i=0;i<3;i++) { const a = i * Math.PI * 2 / 3; c.beginPath(); c.moveTo(W * .77,H * .15); c.arc(W * .77,H * .15,W * .055,a,a+.85); c.closePath(); c.fill(); }
        c.fillStyle = '#91bc87'; c.fillRect(W * .2,H * .82,W * .13,H * .055);
        c.restore(); break;
      }
      const tier = pid === 'burner-mining-drill' ? 0 : pid.endsWith('-3') ? 3 : pid.endsWith('-2') ? 2 : 1;
      const accent = ['#c99a60', '#7cacc2', '#6dc3bc', '#b296d8'][tier];
      const on = st.working && !st.icon, phase = on ? (st.t % 96) * AK : 0;
      shadow(); body(s * .08, tier ? '#627983' : '#796f5c', .11);
      c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2); c.translate(-W / 2, -H / 2);
      c.fillStyle = '#263b42'; rr(c, W * .18, H * .22, W * .64, H * .55, s * .09); c.fill();
      // The discharge chute uses the prototype's output cell, including the offset burner outlet.
      const outX = ((p.out?.x ?? 0) + .5) * s;
      c.fillStyle = '#263b42'; c.fillRect(outX - s * .19, H * .05, s * .38, H * .24);
      c.fillStyle = '#a8babb'; c.fillRect(outX - s * .14, H * .06, s * .055, H * .22); c.fillRect(outX + s * .085, H * .06, s * .055, H * .22);
      c.fillStyle = accent; c.beginPath(); c.moveTo(outX, H * .075); c.lineTo(outX - s * .08, H * .15); c.lineTo(outX + s * .08, H * .15); c.closePath(); c.fill();
      if (tier) { c.fillStyle = '#a4b8b8'; c.fillRect(W * .5 - s * .09, H * .79, s * .18, H * .15); c.fillStyle = '#4c6975'; c.fillRect(W * .5 - s * .13, H * .86, s * .26, H * .04); }
      for (const x of [.1, .79]) {
        c.fillStyle = accent; rr(c, W * x, H * .23, W * .11, H * .51, s * .045); c.fill();
        c.fillStyle = '#bed0ca'; c.fillRect(W * (x + .04), H * .28, W * .025, H * .41);
      }
      c.fillStyle = '#172c33'; c.beginPath(); c.arc(W * .5, H * .49, W * .235, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(W * .5, H * .49); c.rotate(phase * (tier + 1));
      gear(c, 0, 0, W * .2, '#adbcba', 8 + tier * 2);
      c.strokeStyle = accent; c.lineWidth = s * .07; c.beginPath(); c.moveTo(-W * .13, 0); c.lineTo(W * .13, 0); c.stroke(); c.restore();
      const feed = on ? Math.sin(phase * 2) * H * .025 : 0;
      c.fillStyle = '#6c858d'; c.fillRect(W * .24, H * .45 + feed, W * .52, H * .08);
      c.fillStyle = '#c3d0c9'; rr(c, W * .43, H * .405 + feed, W * .14, H * .17, s * .04); c.fill();
      c.fillStyle = on ? '#9cdbca' : '#4c6d76'; c.fillRect(W * .47, H * .445 + feed, W * .06, H * .065);
      if (tier === 0) {
        c.fillStyle = '#29393d'; rr(c, W * .65, H * .08, W * .18, H * .15, s * .04); c.fill();
        c.fillStyle = on ? '#eda052' : '#684c36'; c.fillRect(W * .68, H * .125, W * .12, H * .055);
        c.fillStyle = '#3e4f53'; c.fillRect(W * .2, H * .8, W * .15, H * .09);
      } else {
        c.fillStyle = '#293e47'; rr(c, W * .64, H * .09, W * .21, H * .12, s * .04); c.fill();
        c.fillStyle = accent; for (let i = 0; i < tier; i++) c.fillRect(W * (.665 + i * .06), H * .12, W * .035, H * .055);
        c.fillStyle = '#829aa0'; for (let i = 0; i < tier; i++) c.fillRect(W * (.22 + i * .09), H * .82, W * .05, H * .065);
      }
      c.fillStyle = '#bbcac7'; for (const x of [.13, .84]) for (const y of [.16, .81]) c.fillRect(W * x, H * y, W * .03, H * .03);
      c.restore(); break;
    }
    case 'furnace': {
      const stone = pid === 'stone-furnace', electric = pid === 'electric-furnace';
      const heat = st.working && !st.icon ? .5 + .5 * Math.sin((st.t % 96) * AK * 2) : 0;
      if (electric) {
        shadow(); body(s * .09, '#697c83', .12);
        c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2); c.translate(-W / 2, -H / 2);
        // Insulated chamber, resistance elements and a separate electrical cabinet.
        c.fillStyle = '#26343a'; rr(c, W * .13, H * .22, W * .61, H * .58, s * .12); c.fill();
        c.strokeStyle = '#c2c9be'; c.lineWidth = s * .12; c.stroke();
        c.fillStyle = st.working ? '#56362a' : '#202b31'; rr(c, W * .2, H * .29, W * .47, H * .44, s * .06); c.fill();
        if (st.working) { c.fillStyle = 'rgba(255,153,56,' + (.08 + heat * .12) + ')'; c.fillRect(W * .2, H * .29, W * .47, H * .44); }
        c.strokeStyle = st.working ? 'rgb(255,' + Math.round(155 + heat * 45) + ',77)' : '#8c7161'; c.lineWidth = s * .085; c.lineCap = 'round';
        for (const x of [.25, .55]) {
          c.beginPath(); c.moveTo(W * x, H * .34);
          for (let j = 0; j < 5; j++) c.lineTo(W * (x + (j % 2 ? 0 : .07)), H * (.36 + j * .07));
          c.stroke();
        }
        c.fillStyle = '#8b9697'; c.fillRect(W * .37, H * .39, W * .13, H * .25);
        c.fillStyle = st.working ? 'rgb(227,' + Math.round(133 + heat * 25) + ',78)' : '#56666d'; c.fillRect(W * .39, H * .41, W * .09, H * .21);
        c.fillStyle = '#384b53'; rr(c, W * .78, H * .23, W * .14, H * .55, s * .06); c.fill();
        c.fillStyle = st.working ? '#87d9cb' : '#526e73'; c.fillRect(W * .81, H * .29, W * .08, H * .08);
        c.strokeStyle = '#ddb763'; c.lineWidth = s * .055; c.beginPath(); c.moveTo(W * .87, H * .45); c.lineTo(W * .82, H * .53); c.lineTo(W * .87, H * .53); c.lineTo(W * .83, H * .62); c.stroke();
        c.fillStyle = '#303f46'; rr(c, W * .15, H * .07, W * .7, H * .1, s * .04); c.fill();
        c.fillStyle = '#9eafb3'; for (let j = 0; j < 6; j++) c.fillRect(W * (.19 + j * .105), H * .085, W * .06, H * .055);
        c.fillStyle = '#34464e'; c.fillRect(W * .16, H * .85, W * .68, H * .065);
        c.fillStyle = '#80aeb8'; c.fillRect(W * .2, H * .86, W * .32, H * .03);
        c.fillStyle = '#c5cdd0'; for (const x of [.08, .89]) for (const y of [.08, .87]) c.fillRect(W * x, H * y, W * .025, H * .025);
        c.restore(); break;
      }
      shadow(); body(s * .09, stone ? '#8e7960' : electric ? '#975b43' : '#68757b', stone ? .3 : .13, stone ? 'stone' : 'metal');
      c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2); c.translate(-W / 2, -H / 2);
      c.fillStyle = '#242b2d'; rr(c, W * .19, H * .2, W * .62, H * .63, W * (stone ? .22 : .05)); c.fill();
      c.strokeStyle = stone ? '#c0a580' : '#a1adb0'; c.lineWidth = s * .09; c.stroke();
      c.fillStyle = st.working ? `rgb(241,${Math.round(115 + heat * 30)},50)` : '#4b3830'; rr(c, W * .29, H * .35, W * .42, H * .35, W * .08); c.fill();
      c.fillStyle = st.working ? `rgb(255,${Math.round(198 + heat * 30)},124)` : '#242a2b'; c.fillRect(W * .34, H * .49, W * .32, H * .12);
      if (st.working) { c.fillStyle = `rgba(255,172,66,${.06 + heat * .1})`; rr(c, W * .23, H * .29, W * .54, H * .47, W * .1); c.fill(); }
      c.strokeStyle = '#292e2e'; c.lineWidth = s * .055;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(W * (.35 + i * .15), H * .39); c.lineTo(W * (.35 + i * .15), H * .72); c.stroke(); }
      if (stone) {
        c.strokeStyle = '#514b40'; c.lineWidth = s * .035;
        for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(W * .08, H * (.25 + j * .23)); c.lineTo(W * .2, H * (.25 + j * .23)); c.moveTo(W * .8, H * (.25 + j * .23)); c.lineTo(W * .92, H * (.25 + j * .23)); c.stroke(); }
      } else {
        c.fillStyle = '#303b40';
        for (const x of [.08, .82]) { c.fillRect(W * x, H * .23, W * .1, H * .53); c.fillStyle = electric ? '#d2a15e' : '#98a5a9'; for (let j = 0; j < 4; j++) c.fillRect(W * x, H * (.27 + j * .12), W * .1, H * .04); c.fillStyle = '#303b40'; }
      }
      c.fillStyle = stone ? '#574c3e' : '#30383c'; rr(c, W * .33, H * .07, W * .34, H * .18, s * .06); c.fill();
      c.fillStyle = '#11191c'; c.fillRect(W * .39, H * .1, W * .22, H * .07);
      c.fillStyle = electric ? '#73cacc' : '#9b8668'; c.fillRect(W * .3, H * .86, W * .4, H * .045);
      c.restore(); break;
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
      if (pid === 'bio-extractor') {
        shadow(); body(s * .055, '#49695d', .1);
        c.fillStyle = '#263b34'; rr(c, W * .19, H * .17, W * .62, H * .66, s * .08); c.fill();
        c.fillStyle = '#101e1a'; rr(c, W * .27, H * .24, W * .46, H * .48, s * .08); c.fill();
        const gel = c.createLinearGradient(0, H * .3, 0, H * .69); gel.addColorStop(0, '#a5d28a'); gel.addColorStop(.5, st.working ? '#65b58e' : '#4a9475'); gel.addColorStop(1, '#2d6958');
        c.fillStyle = gel; rr(c, W * .31, H * .31, W * .38, H * .36, s * .05); c.fill();
        c.strokeStyle = 'rgba(220,245,211,.7)'; c.lineWidth = Math.max(1, s * .035); c.stroke();
        c.fillStyle = '#d7e4c7'; for (const [x, y, r] of [[.4, .43, .045], [.56, .55, .06], [.48, .62, .035], [.62, .38, .03]]) { c.beginPath(); c.arc(W * x, H * y, s * r, 0, 7); c.fill(); }
        c.fillStyle = '#92a9a0'; for (const [x, y, w, h] of [[.07, .44, .15, .12], [.78, .44, .15, .12], [.43, .03, .14, .15], [.43, .82, .14, .15]]) rr(c, W * x, H * y, W * w, H * h, s * .035), c.fill();
        c.fillStyle = '#92c9a8'; for (const [x, y] of [[.12, .47], [.84, .47], [.46, .08], [.46, .87]]) { c.beginPath(); c.arc(W * x, H * y, s * .055, 0, 7); c.fill(); }
        c.fillStyle = '#2b3d35'; c.fillRect(W * .34, H * .75, W * .32, H * .07);
        if (st.working && !st.icon) { c.fillStyle = 'rgba(135,228,153,.14)'; c.beginPath(); c.arc(W / 2, H / 2, W * .43, 0, 7); c.fill(); }
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
      if (pid.startsWith('assembling-machine-')) {
        const tier = Number(pid.slice(-1)), accent = col;
        shadow(); body(s * .08, '#465258', .1);
        c.fillStyle = '#202a2e'; rr(c, W * .16, H * .16, W * .68, H * .68, s * .08); c.fill();
        c.fillStyle = '#69767a'; c.fillRect(W * .28, H * .26, W * .44, H * .48);
        c.fillStyle = '#354146'; c.fillRect(W * .32, H * .3, W * .36, H * .4);
        for (const xx of [.09, .81]) {
          c.fillStyle = accent; rr(c, W * xx, H * .1, W * .1, H * .8, s * .05); c.fill();
          c.fillStyle = '#b8c3c5'; c.fillRect(W * (xx + .035), H * .23, W * .03, H * .53);
        }
        const phase = st.working && !st.icon ? (st.t % 96) * AK : 0;
        const travel = Math.sin(phase * 2) * H * .11;
        const toolX = Math.sin(phase) * W * .12;
        c.save(); c.translate(W * .76, H * .19); c.rotate(phase * 2);
        c.fillStyle = '#9aa8ab'; c.beginPath(); c.arc(0, 0, W * .045, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#29363b'; c.fillRect(-W * .035, -H * .008, W * .07, H * .016); c.restore();
        c.fillStyle = '#172125'; c.fillRect(W * .14, H * .4 + travel, W * .72, H * .16);
        c.fillStyle = accent; c.fillRect(W * .16, H * .4 + travel, W * .68, H * .09);
        c.fillStyle = '#bdc8c9'; rr(c, W * .42 + toolX, H * .36 + travel, W * .16, H * .23, s * .04); c.fill();
        c.fillStyle = st.working ? '#f2c970' : '#48565b'; c.fillRect(W * .47 + toolX, H * .5 + travel, W * .06, H * .055);
        c.fillStyle = '#6a797e'; c.fillRect(W * .485 + toolX, H * .555 + travel, W * .03, H * (.025 + (st.working && !st.icon ? .02 * (1 - Math.cos(phase * 4)) : 0)));
        c.fillStyle = '#182125'; c.fillRect(W * .26, H * .82, W * .48, H * .08);
        c.fillStyle = accent; for (let i = 0; i < tier; i++) c.fillRect(W * (.3 + i * .1), H * .835, W * .065, H * .045);
        c.fillStyle = '#aebabc'; for (const xx of [.12, .85]) for (const yy of [.13, .84]) c.fillRect(W * xx, H * yy, W * .03, H * .03);
        if (st.recipeColor) { c.fillStyle = st.recipeColor; c.fillRect(W * .45, H * .66, W * .1, H * .05); }
        break;
      }
      {
        const tier = pid.endsWith('-4') ? 4 : pid.endsWith('-3') ? 3 : pid.endsWith('-2') ? 2 : 1;
        const accent = ['#9da6ad', '#82b2d0', '#53cad2', '#e1b45b', '#bd91fa'][tier]; const m = Math.min(W, H);
        shadow(); body(s * .07, col, .12);
        c.fillStyle = shade(col, -.34); rr(c, W * .12, H * .12, W * .76, H * .76, s * .12); c.fill();
        c.fillStyle = '#25292b'; rr(c, W * .19, H * .18, W * .62, H * .64, s * .1); c.fill();
        c.strokeStyle = accent; c.globalAlpha = .82; c.lineWidth = s * .055; rr(c, W * .22, H * .21, W * .56, H * .58, s * .08); c.stroke(); c.globalAlpha = 1;
        // Tier accents stay fixed while the inner rotor and articulated arms animate during work.
        const rails = tier === 1 ? 1 : tier;
        c.fillStyle = accent; for (let i = 0; i < rails; i++) c.fillRect(W * .16 + i * W * .11, H * .84, W * .07, s * .065);
        c.save(); c.translate(W / 2, H / 2); c.rotate(st.working ? st.t * AK * (tier === 1 ? 1.5 : 1 + tier * .3) : 0);
        c.strokeStyle = accent; c.globalAlpha = .8; c.lineWidth = s * .06; c.beginPath(); c.arc(0, 0, m * .3, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
        gear(c, 0, 0, m * (tier === 1 ? .24 : .2), '#c6cdd1', 8 + tier * 2);
        c.restore();
        const arms = tier === 1 ? 1 : tier;
        for (let i = 0; i < arms; i++) {
          const base = (i / arms) * Math.PI * 2 + Math.PI * .25;
          const swing = st.working ? Math.sin(st.t * AK * 2 + i * 1.7) * .18 : 0;
          c.save(); c.translate(W / 2, H / 2); c.rotate(base + swing); c.strokeStyle = i % 2 ? '#d4d8dc' : accent; c.lineWidth = s * .075; c.lineCap = 'round';
          c.beginPath(); c.moveTo(m * .25, 0); c.lineTo(m * .37, -m * .035); c.lineTo(m * .43, m * .06); c.stroke();
          c.fillStyle = accent; c.beginPath(); c.arc(m * .43, m * .06, s * .07, 0, 7); c.fill(); c.restore();
        }
        if (st.recipeColor) { c.fillStyle = st.recipeColor; c.beginPath(); c.arc(W / 2, H / 2, m * .065, 0, 7); c.fill(); }
        c.fillStyle = '#c5cbd0'; for (const [a, b] of [[.13, .13], [.87, .13], [.13, .87], [.87, .87]]) { c.beginPath(); c.arc(W * a, H * b, s * .075, 0, 7); c.fill(); c.fillStyle = '#3d4246'; c.beginPath(); c.arc(W * a, H * b, s * .03, 0, 7); c.fill(); c.fillStyle = '#c5cbd0'; }
        c.save(); c.translate(W / 2, H / 2); c.rotate(dir * Math.PI / 2); c.fillStyle = '#343a3d'; rr(c, -s * .14, -H * .44, s * .28, H * .15, s * .05); c.fill(); c.fillStyle = accent; c.fillRect(-s * .045, -H * .43, s * .09, H * .06); c.restore();
        arrow(dir, .27, accent);
      }
      break;
    }
    case 'lab': {
      if (pid === 'lab') {
        const on = st.working && !st.icon, phase = on ? (st.t % 96) * AK : 0;
        shadow(); body(s * .09, '#8c9fa4', .14);
        c.fillStyle = '#2a414a'; rr(c, W * .12, H * .13, W * .76, H * .64, s * .09); c.fill();
        c.fillStyle = on ? '#386d85' : '#354f5d'; c.beginPath(); c.arc(W * .5, H * .44, W * .25, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#a9c3c6'; c.lineWidth = s * .055; c.stroke();
        c.save(); c.translate(W * .5, H * .44); c.rotate(phase);
        c.strokeStyle = on ? '#8cdbdf' : '#607e89'; c.lineWidth = s * .045;
        for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0, 0, W * .19, i * Math.PI * 2 / 3, i * Math.PI * 2 / 3 + 1.1); c.stroke(); }
        c.restore();
        c.fillStyle = '#c4d4d1'; c.fillRect(W * .45, H * .31, W * .1, H * .2); c.fillRect(W * .39, H * .51, W * .22, H * .035);
        c.fillStyle = on ? '#a1e5d1' : '#7e9b98'; c.fillRect(W * .46, H * .39, W * .08, H * .1);
        c.fillStyle = 'rgba(212,237,240,.2)'; c.beginPath(); c.ellipse(W * .41, H * .34, W * .055, H * .11, .65, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#30434b'; c.fillRect(W * .15, H * .82, W * .7, H * .08);
        for (let i = 0; i < 3; i++) { c.fillStyle = ['#be826d','#8cbb94','#75a8c5'][i]; c.fillRect(W * (.2 + i * .11), H * .835, W * .06, H * .05); }
        c.fillStyle = on ? '#91d6c9' : '#607b83'; c.fillRect(W * .64, H * .835, W * .15, H * .035);
        break;
      }
      shadow(); body(s * .1, '#8d99a6', .4);
      const g = c.createRadialGradient(W * .45, H * .4, 2, W / 2, H / 2, W * .35); g.addColorStop(0, '#f2fbff'); g.addColorStop(1, st.working ? '#4fb3ff' : '#7a8fa3');
      c.fillStyle = g; c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = s * .05; c.stroke();
      break;
    }
    case 'pump': {
      shadow(); body(s * .14, col, .2); arrow(dir, .44, '#cfe8ff'); break;
    }
    case 'boiler': {
      if(pid==='boiler') {
 const on=st.working&&!st.icon, phase=on?(st.t%96)*AK:0; shadow(); c.save(); c.translate(W/2,H/2); c.rotate(dir*Math.PI/2); c.translate(-1.5*s,-s);
 c.fillStyle='#394b52'; rr(c,.12*s,.16*s,2.76*s,1.7*s,.12*s); c.fill(); const g=c.createLinearGradient(0,.2*s,0,1.2*s); g.addColorStop(0,'#bccbc6'); g.addColorStop(.4,'#8ca3a9'); g.addColorStop(1,'#445f69'); c.fillStyle=g; rr(c,.3*s,.25*s,2.4*s,.85*s,.3*s); c.fill();
 c.fillStyle='#c3cec5'; for(const x of [.65,2.2])c.fillRect(x*s,.27*s,.12*s,.8*s); c.fillStyle='#9d7755'; rr(c,.7*s,1.03*s,1.6*s,.7*s,.1*s); c.fill(); c.fillStyle='#202d32'; rr(c,.88*s,1.16*s,1.24*s,.42*s,.07*s); c.fill(); c.fillStyle=on?'rgba(255,155,65,'+(.8+.1*Math.sin(phase*2))+')':'#453c34'; c.fillRect(1*s,1.24*s,s,.24*s); c.fillStyle='#556063'; for(let i=0;i<5;i++)c.fillRect((1.06+i*.19)*s,1.2*s,.05*s,.34*s);
 c.fillStyle='#b5c8ca'; c.fillRect(1.34*s,-.02*s,.32*s,.32*s); for(const x of [0,2.6]){c.fillRect(x*s,1.36*s,.4*s,.28*s);c.fillRect((x+.12)*s,1.29*s,.08*s,.42*s);} c.fillStyle='#28424d'; c.beginPath();c.arc(1.5*s,.65*s,.17*s,0,7);c.fill();c.strokeStyle='#ddd6b9';c.lineWidth=.035*s;c.beginPath();c.moveTo(1.5*s,.65*s);c.lineTo(1.58*s,.56*s);c.stroke();c.restore();break;
}

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
      if(pid==='steam-engine') {
 const on=st.working&&!st.icon, phase=on?(st.t%96)*AK:0; shadow(); c.save();c.translate(W/2,H/2);c.rotate(dir*Math.PI/2);c.translate(-1.5*s,-2.5*s); c.fillStyle='#465c64';rr(c,.15*s,.15*s,2.7*s,4.7*s,.15*s);c.fill();c.fillStyle='#b9cccb';c.fillRect(1.35*s,-.02*s,.3*s,.45*s);c.fillRect(1.35*s,4.55*s,.3*s,.47*s);
 c.fillStyle='#9c7855';for(const x of [.35,2.5])c.fillRect(x*s,.5*s,.15*s,3.9*s);
 for(let i=0;i<2;i++){const x=(.7+1.05*i)*s, sh=Math.cos(phase*2+i*Math.PI)*.18*s;const g=c.createLinearGradient(x,0,x+.55*s,0);g.addColorStop(0,'#506d78');g.addColorStop(.5,'#c2d0c9');g.addColorStop(1,'#68828b');c.fillStyle=g;rr(c,x,.55*s,.55*s,1.15*s,.15*s);c.fill();c.fillStyle='#d2d6c6';c.fillRect(x+.21*s,1.5*s,.13*s,.72*s+sh);c.fillRect(x+.05*s,1.9*s+sh,.45*s,.16*s);}
 c.save();c.translate(1.5*s,2.65*s);c.rotate(phase*2);c.strokeStyle='#263b42';c.lineWidth=.2*s;c.beginPath();c.arc(0,0,.77*s,0,7);c.stroke();c.strokeStyle='#bfb18a';c.lineWidth=.1*s;c.beginPath();c.arc(0,0,.68*s,0,7);c.stroke();for(let i=0;i<6;i++){c.rotate(Math.PI/3);c.beginPath();c.moveTo(0,0);c.lineTo(.66*s,0);c.stroke();}c.restore();c.fillStyle='#c6d1c6';c.beginPath();c.arc(1.5*s,2.65*s,.17*s,0,7);c.fill();c.fillStyle='#70938e';rr(c,.75*s,3.55*s,1.5*s,.85*s,.2*s);c.fill();c.fillStyle='#b8cabc';for(let i=0;i<6;i++)c.fillRect((.87+i*.22)*s,3.65*s,.08*s,.63*s);c.restore();break;
}

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
      if(pid==='storage-tank') {
 shadow();c.save();c.translate(W/2,H/2);c.rotate(dir*Math.PI/2);c.translate(-W/2,-H/2);c.fillStyle='#506a74';rr(c,.18*s,.22*s,2.64*s,2.56*s,.15*s);c.fill();for(let a=0;a<4;a++){c.save();c.translate(1.5*s,1.5*s);c.rotate(a*Math.PI/2);c.fillStyle='#afc1c3';c.fillRect(-.15*s,-1.51*s,.3*s,.55*s);c.fillStyle='#64828c';c.fillRect(-.23*s,-1.35*s,.46*s,.1*s);c.restore();}
 const g=c.createRadialGradient(1.1*s,.9*s,.1*s,1.5*s,1.5*s,1.21*s);g.addColorStop(0,'#cbd4ca');g.addColorStop(.65,'#91a7ab');g.addColorStop(1,'#496773');c.fillStyle=g;c.beginPath();c.arc(1.5*s,1.5*s,1.12*s,0,7);c.fill();c.strokeStyle='#d0d7c9';c.lineWidth=.05*s;c.beginPath();c.arc(1.5*s,1.5*s,.98*s,.2,5.8);c.stroke();c.fillStyle='#526f7b';c.beginPath();c.arc(1.35*s,1.1*s,.3*s,0,7);c.fill();c.fillStyle='#bbc9c0';c.fillRect(1.12*s,1.05*s,.46*s,.1*s);
 c.fillStyle='#203640';rr(c,1.91*s,.92*s,.27*s,1.25*s,.08*s);c.fill();const f=Math.max(0,Math.min(1,st.fill??0));c.fillStyle=st.fluidColor||'#547e97';c.fillRect(1.97*s,(2.1-1.1*f)*s,.15*s,1.1*f*s);c.strokeStyle='#ccd4c9';c.lineWidth=.025*s;for(let i=0;i<4;i++){c.beginPath();c.moveTo(2.09*s,(1.05+i*.3)*s);c.lineTo(2.2*s,(1.05+i*.3)*s);c.stroke();}c.strokeStyle='#a88458';c.lineWidth=.09*s;c.beginPath();c.moveTo(.7*s,1.9*s);c.lineTo(.7*s,2.4*s);c.lineTo(1.3*s,2.4*s);c.stroke();c.strokeStyle='#a65843';c.lineWidth=.045*s;c.beginPath();c.arc(.7*s,1.88*s,.15*s,0,7);c.stroke();c.restore();break;
}

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
      if (pid !== 'nest' || true) { drawSwarmStructure(c, pid, W, H, s, st.t * AK, so, !!st.icon, st.aim); break; }
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
      if (pid === 'beacon') {
        const on = st.working && !st.icon, phase = on ? (st.t % 96) * AK : 0;
        shadow(); body(s * .09, '#607d89', .14);
        c.fillStyle = '#263941'; rr(c, W * .14, H * .15, W * .72, H * .7, s * .08); c.fill();
        c.strokeStyle = '#91adb3'; c.lineWidth = s * .055; c.beginPath(); c.arc(W * .5, H * .51, W * .25, 0, Math.PI * 2); c.stroke();
        const mods = st.mods || [];
        mods.forEach((m, i) => { const angle = i / Math.max(1, mods.length) * Math.PI * 2 + phase; const x = W * .5 + Math.cos(angle) * W * .25, y = H * .51 + Math.sin(angle) * H * .25; c.fillStyle = '#182c33'; rr(c, x - s * .18, y - s * .18, s * .36, s * .36, s * .035); c.fill(); c.fillStyle = m ? ITEMS[m].color : '#465b63'; c.fillRect(x - s * .115, y - s * .115, s * .23, s * .23); });
        c.strokeStyle = '#9db3b9'; c.lineWidth = s * .09; c.beginPath(); c.moveTo(W * .5, H * .51); c.lineTo(W * .5, H * .08); c.stroke();
        c.fillStyle = '#829da6'; rr(c, W * .4, H * .36, W * .2, H * .3, s * .08); c.fill();
        c.fillStyle = on ? '#9ce5e4' : '#4d6c79'; c.fillRect(W * .45, H * .4, W * .1, H * .2);
        c.strokeStyle = on ? 'rgba(125,215,228,' + (.5 + Math.sin(phase * 2) * .2) + ')' : '#526d77'; c.lineWidth = s * .04;
        for (const side of [-1, 1]) for (const r of [.17, .23]) { c.beginPath(); c.arc(W * .5, H * .24, W * r, side < 0 ? 2.55 : -.59, side < 0 ? 3.73 : .59); c.stroke(); }
        c.fillStyle = on ? '#d7f4e6' : '#8b9f9c'; c.beginPath(); c.arc(W * .5, H * .08, s * .07, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#91a7aa'; c.fillRect(W * .3, H * .87, W * .4, H * .025);
        break;
      }
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
      if (pid === 'accumulator') {
        shadow(); body(s * .08, '#586b73', .12);
        c.fillStyle = '#223239'; rr(c, W * .12, H * .16, W * .76, H * .65, s * .06); c.fill();
        for (const x of [.17, .54]) {
          c.fillStyle = '#a2b4b5'; rr(c, W * x, H * .24, W * .29, H * .48, s * .055); c.fill();
          c.fillStyle = '#6e8b92'; c.fillRect(W * (x + .035), H * .31, W * .22, H * .3);
          c.fillStyle = '#d0d9cc'; c.fillRect(W * (x + .035), H * .35, W * .22, H * .055); c.fillRect(W * (x + .035), H * .53, W * .22, H * .055);
          c.fillStyle = '#d5a064'; c.fillRect(W * (x + .055), H * .18, W * .065, H * .09);
          c.fillStyle = '#323f44'; c.fillRect(W * (x + .18), H * .18, W * .065, H * .09);
        }
        c.strokeStyle = '#b38756'; c.lineWidth = s * .055; c.beginPath(); c.moveTo(W * .38, H * .2); c.lineTo(W * .38, H * .12); c.lineTo(W * .62, H * .12); c.lineTo(W * .62, H * .2); c.stroke();
        c.fillStyle = '#24373d'; c.fillRect(W * .2, H * .83, W * .6, H * .07);
        if (st.fill != null && !st.icon) { c.fillStyle = st.fill > .2 ? '#4be36b' : '#e8c22e'; c.fillRect(W * .2, H * .83, W * .6 * st.fill, H * .07); }
        else { c.fillStyle = '#79959c'; c.fillRect(W * .23, H * .85, W * .12, H * .025); }
        break;
      }
      shadow(); body(s * .08, '#5e666d', .12);
      for (const [a, b] of [[.3, .32], [.7, .32], [.3, .7], [.7, .7]]) {
        const g = c.createLinearGradient(W * a - s * .2, 0, W * a + s * .2, 0); g.addColorStop(0, '#6d757c'); g.addColorStop(.5, '#c7ccd1'); g.addColorStop(1, '#4d555c');
        c.fillStyle = g; rr(c, W * a - s * .22, H * b - s * .26, s * .44, s * .5, s * .08); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .03; c.stroke();
      }
      if (st.fill != null && !st.icon) { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(W * .12, H * .5 - s * .06, W * .76, s * .12); c.fillStyle = st.fill > .2 ? '#4be36b' : '#e8c22e'; c.fillRect(W * .12, H * .5 - s * .06, W * .76 * st.fill, s * .12); }
      break;
    }
    case 'radar': {
      if (pid === 'radar') {
        const on = st.working && !st.icon, phase = on ? (st.t % 96) * AK : .6;
        shadow(); body(s * .1, '#6d8188', .12);
        c.fillStyle = '#2a3c43'; rr(c, W * .14, H * .14, W * .72, H * .72, s * .08); c.fill();
        c.strokeStyle = '#56717c'; c.lineWidth = s * .045; c.beginPath(); c.arc(W / 2, H / 2, W * .32, 0, Math.PI * 2); c.stroke();
        c.fillStyle = '#8ba0a6'; c.fillRect(W * .43, H * .25, W * .14, H * .5);
        c.save(); c.translate(W / 2, H / 2); c.rotate(phase);
        c.fillStyle = '#c1d0d0'; c.beginPath(); c.ellipse(0, 0, W * .36, H * .16, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#445e69'; c.lineWidth = s * .05; c.stroke();
        c.fillStyle = '#7e9ba6'; c.beginPath(); c.ellipse(0, 0, W * .3, H * .105, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#d2dcd7'; c.lineWidth = s * .035; c.beginPath(); c.moveTo(-W * .28, 0); c.lineTo(W * .28, 0); c.moveTo(0, -H * .1); c.lineTo(0, H * .1); c.stroke();
        c.strokeStyle = '#314b56'; c.lineWidth = s * .06; c.beginPath(); c.moveTo(0, H * .12); c.lineTo(0, -H * .22); c.stroke();
        c.fillStyle = on ? '#a8e4cd' : '#809da2'; c.beginPath(); c.arc(0, -H * .22, s * .055, 0, Math.PI * 2); c.fill(); c.restore();
        c.fillStyle = on ? '#8dcaba' : '#4d666e'; c.fillRect(W * .2, H * .87, W * .14, H * .035);
        c.fillStyle = '#9cb0b3'; for (let i = 0; i < 3; i++) c.fillRect(W * (.57 + i * .075), H * .87, W * .045, H * .03);
        break;
      }
      shadow(); body(s * .12, '#6d757c', .2);
      c.save(); c.translate(W / 2, H / 2); c.rotate(st.working && !st.icon ? st.t * AK : .6);
      c.fillStyle = '#c7ccd1'; c.beginPath(); c.ellipse(0, 0, W * .38, H * .16, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .05; c.stroke();
      c.fillStyle = '#8d969e'; c.beginPath(); c.ellipse(0, 0, W * .3, H * .1, 0, 0, 7); c.fill();
      c.fillStyle = '#3a3f44'; c.fillRect(-s * .06, -H * .12, s * .12, H * .24);
      c.restore(); break;
    }
    case 'silo': {
      if (!st.icon) { c.fillStyle = 'rgba(0,0,0,.3)'; rr(c, s * .3, s * .4, W, H - s * .2, s * .4); c.fill(); }
      body(.16*s,'#74878d',.25);
      c.fillStyle='#25343d'; rr(c,W*.08,H*.08,W*.84,H*.84,.3*s);c.fill();
      c.strokeStyle='#b3ac88';c.lineWidth=.16*s;c.beginPath();c.arc(W/2,H/2,W*.35,0,7);c.stroke();
      const L = st.icon ? 0 : st.launch || 0; const open = st.icon ? .16 : Math.min(1, .15 + L * 5 + (st.parts || 0) / 200);
      c.fillStyle = '#0b1823'; c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.fill();
      // створки
      c.fillStyle = '#7c9198'; const dw = W * .3 * (1 - open);
      c.save(); c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.clip(); c.fillRect(W / 2 - W * .3, H * .2, dw, H * .6); c.fillRect(W / 2 + W * .3 - dw, H * .2, dw, H * .6); c.strokeStyle='#aebdbc'; c.lineWidth=.045*s; for(let i=0;i<6;i++){c.beginPath();c.moveTo(W*.2,H*(.2+i*.1));c.lineTo(W*.5-W*.3*open,H*(.2+i*.1));c.moveTo(W*.5+W*.3*open,H*(.2+i*.1));c.lineTo(W*.8,H*(.2+i*.1));c.stroke();} c.restore();
      c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = s * .08; c.beginPath(); c.arc(W / 2, H / 2, W * .3, 0, 7); c.stroke();
      // ракета: растёт по мере сборки, взлетает при запуске
      if (!st.icon && (st.parts || L)) {
        const k = L ? 1 : Math.min(1, (st.parts || 0) / 100); const up = L > 0.25 ? Math.pow((L - .25) / .75, 2) * H * 3 : 0;
        c.save(); c.translate(W / 2, H / 2 - up);
        const rh = H * .5 * (.3 + .7 * k), rw = W * .09;
        const rg = c.createLinearGradient(-rw, 0, rw, 0); rg.addColorStop(0, '#9aa3ab'); rg.addColorStop(.5, '#f2f4f6'); rg.addColorStop(1, '#7a838b');
        c.fillStyle = rg; c.beginPath(); c.moveTo(0, -rh * .6); c.quadraticCurveTo(rw, -rh * .35, rw, rh * .3); c.lineTo(-rw, rh * .3); c.quadraticCurveTo(-rw, -rh * .35, 0, -rh * .6); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .05; c.stroke();
        c.fillStyle = '#d8503a'; c.beginPath(); c.moveTo(-rw, rh * .1); c.lineTo(-rw * 1.8, rh * .4); c.lineTo(-rw, rh * .3); c.fill(); c.beginPath(); c.moveTo(rw, rh * .1); c.lineTo(rw * 1.8, rh * .4); c.lineTo(rw, rh * .3); c.fill();
        if (L > 0.15) { const fg = c.createRadialGradient(0, rh * .35, 0, 0, rh * .5, rw * 3); fg.addColorStop(0, 'rgba(255,250,200,1)'); fg.addColorStop(.4, 'rgba(255,170,60,.85)'); fg.addColorStop(1, 'rgba(255,90,0,0)'); c.fillStyle = fg; c.beginPath(); c.ellipse(0, rh * .6, rw * 2.2, rw * (3 + Math.sin((st.working && !st.icon ? st.t % 96 : 0) * AK * 2) * .5), 0, 0, 7); c.fill(); }
        c.restore();
      }
      for(const x of [.1,.8]) { c.fillStyle='#8ca1a5';rr(c,W*x,H*.14,W*.1,H*.72,.13*s);c.fill();c.fillStyle='#334d59';for(let j=0;j<5;j++)c.fillRect(W*(x+.02),H*(.2+j*.12),W*.06,H*.07); }
      c.strokeStyle='#c3b582';c.lineWidth=.1*s;c.beginPath();c.moveTo(W*.2,H*.23);c.lineTo(W*.43,H*.23+(st.working&&!st.icon?Math.sin((st.t%96)*AK*2)*s*.12:0));c.stroke();
      c.fillStyle='#20343e';c.fillRect(W*.28,H*.86,W*.44,H*.04);c.fillStyle='#8dc3aa';c.fillRect(W*.28,H*.86,W*.44*Math.min(1,(st.icon?0:st.parts||0)/100),H*.04);
      // опоры по углам
      c.fillStyle = '#7d8792'; for (const [a, b] of [[.1, .1], [.9, .1], [.1, .9], [.9, .9]]) { rr(c, W * a - s * .5, H * b - s * .5, s, s, s * .15); c.fill(); }
      break;
    }
    case 'roboport': {
      if(pid==='roboport') {
 const on=st.working&&!st.icon, phase=on?(st.t%96)*AK:0;shadow();body(.1*s,'#687e80',.14);c.fillStyle='#263e49';rr(c,.5*s,.5*s,3*s,3*s,.28*s);c.fill();c.strokeStyle='#bab88f';c.lineWidth=.07*s;rr(c,.76*s,.76*s,2.48*s,2.48*s,.3*s);c.stroke();c.strokeStyle='#8ca9ac';c.lineWidth=.08*s;c.beginPath();c.arc(2*s,1.85*s,.76*s,0,7);c.stroke();c.beginPath();c.moveTo(1.65*s,1.5*s);c.lineTo(1.65*s,2.2*s);c.moveTo(2.35*s,1.5*s);c.lineTo(2.35*s,2.2*s);c.moveTo(1.65*s,1.85*s);c.lineTo(2.35*s,1.85*s);c.stroke();
 for(const [x,y] of [[.32,.32],[3.1,.32],[.32,3.1],[3.1,3.1]]){c.fillStyle='#acbfbd';rr(c,x*s,y*s,.58*s,.58*s,.1*s);c.fill();c.fillStyle='#314e5b';c.fillRect((x+.12)*s,(y+.08)*s,.34*s,.4*s);c.fillStyle=on?'rgba(120,220,222,'+(.7+.2*Math.sin(phase*2+x))+')':'#64828a';c.fillRect((x+.18)*s,(y+.13)*s,.22*s,.15*s);c.fillStyle='#d0ab64';c.fillRect((x+.17)*s,(y+.4)*s,.24*s,.08*s);}
 c.fillStyle='#91a6aa';rr(c,1.15*s,2.87*s,1.7*s,.6*s,.09*s);c.fill();c.fillStyle='#314c55';for(let i=0;i<5;i++)c.fillRect((1.28+i*.18)*s,3.02*s,.08*s,.28*s);c.fillStyle=on?'#e1bc68':'#596f72';c.fillRect(2.42*s,3.02*s,.25*s,.13*s);c.strokeStyle='#c4d0c5';c.lineWidth=.06*s;c.beginPath();c.moveTo(2.9*s,.72*s);c.lineTo(2.9*s,.18*s);c.stroke();c.fillStyle=on?'#91d9cf':'#54777e';c.beginPath();c.arc(2.9*s,.18*s,.09*s,0,7);c.fill();break;
}

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
      if (pid === 'solar-panel') {
        shadow(); body(s * .07, '#8b9b9f', .065);
        c.fillStyle = '#172c3f'; c.fillRect(W * .075, H * .075, W * .85, H * .85);
        for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) {
          const x = W * (.09 + col * .137), y = H * (.09 + row * .205);
          c.fillStyle = (row + col) % 2 ? '#254d72' : '#2d5b80'; c.fillRect(x, y, W * .124, H * .188);
          c.fillStyle = '#6086a0'; c.fillRect(x + W * .06, y, W * .005, H * .188);
          c.fillStyle = 'rgba(168,208,222,.12)'; c.fillRect(x, y + H * .055, W * .124, H * .008); c.fillRect(x, y + H * .12, W * .124, H * .008);
        }
        c.fillStyle = '#afbec0'; c.fillRect(W * .485, H * .07, W * .03, H * .86);
        c.fillStyle = 'rgba(165,208,227,.1)'; c.beginPath(); c.moveTo(W * .09, H * .09); c.lineTo(W * .48, H * .09); c.lineTo(W * .09, H * .65); c.closePath(); c.fill();
        c.fillStyle = '#415760'; for (const x of [.025, .95]) for (const y of [.12, .84]) c.fillRect(W * x, H * y, W * .025, H * .035);
        break;
      }
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

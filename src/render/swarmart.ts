// v1.14 «Рой 2.0»: новая графика Роя — у каждого вида свой силуэт и анимация (лапы, крылья, пульсация мешков),
// элита (золотой панцирь и ореол), мутации (шипы), Королева; логова по видам и черви-плевуны 4 уровней.
import { UNITS } from '../sim/enemies';
import { PROTOS } from '../data/entities';
type C = CanvasRenderingContext2D;
export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
const TAU = Math.PI * 2;
function blob(c: C, x: number, y: number, rx: number, ry: number, col: string, hi = .35, lo = -.45) {
  const g = c.createRadialGradient(x - rx * .35, y - ry * .4, Math.min(rx, ry) * .1, x, y, Math.max(rx, ry) * 1.05);
  g.addColorStop(0, shade(col, hi)); g.addColorStop(.6, col); g.addColorStop(1, shade(col, lo)); c.fillStyle = g;
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill();
}
function legs(c: C, L: number, n: number, ph: number, col: string, span: number, y0: number, dy: number, w = .07) {
  c.strokeStyle = shade(col, -.6); c.lineWidth = Math.max(1, L * w); c.lineCap = 'round'; c.lineJoin = 'round';
  for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
    const sw = Math.sin(ph + i * 2.1 + (sd > 0 ? Math.PI : 0)); const by = (y0 + i * dy) * L;
    c.beginPath(); c.moveTo(sd * L * .1, by); c.lineTo(sd * L * span * .7, by - L * (.1 - sw * .06)); c.lineTo(sd * L * span, by + L * (.1 + sw * .12)); c.stroke();
  }
}
function eyes(c: C, L: number, y: number, dx: number, col = '#ff4a2a', r = .035) {
  c.fillStyle = col; c.shadowColor = col; c.shadowBlur = L * .15; c.beginPath(); c.arc(-L * dx, y, L * r, 0, TAU); c.arc(L * dx, y, L * r, 0, TAU); c.fill(); c.shadowBlur = 0;
}
function mandibles(c: C, L: number, y: number, ph: number, col: string) {
  const m = Math.sin(ph * 2) * .06; c.strokeStyle = shade(col, -.7); c.lineWidth = Math.max(1, L * .05);
  c.beginPath(); c.moveTo(-L * .06, y); c.quadraticCurveTo(-L * .15, y - L * .12, -L * (.03 + m), y - L * .17); c.moveTo(L * .06, y); c.quadraticCurveTo(L * .15, y - L * .12, L * (.03 + m), y - L * .17); c.stroke();
}
/** юнит Роя: (x, y) — центр, s — пикселей на клетку, ang — направление, ph — фаза походки; el — элита; mut — уровень мутаций */
export function drawSwarmUnit(c: C, k: string, x: number, y: number, s: number, ang: number, ph: number, el = false, mut = 0) {
  const d = UNITS[k] || UNITS.small; const L = d.size * s * 1.45; let col = d.color;
  if (el) col = shade(col, .15);
  c.save(); c.translate(x, y);
  // тень (летуны — дальше и мягче)
  const fly = !!d.fly; c.fillStyle = fly ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(L * (fly ? .3 : .08), L * (fly ? .5 : .12), L * .42, L * .26, 0, 0, TAU); c.fill();
  if (el) { const g = c.createRadialGradient(0, 0, L * .2, 0, 0, L * .7); g.addColorStop(0, 'rgba(255,215,90,.35)'); g.addColorStop(1, 'rgba(255,200,60,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, L * .7, 0, TAU); c.fill(); }
  if (fly) c.translate(0, -L * (.25 + Math.sin(ph) * .04));
  c.rotate(ang + Math.PI / 2);
  switch (k) {
    case 'spitter': case 'spitter-big': {
      legs(c, L, 2, ph, col, .42, -.02, .28);
      blob(c, 0, L * .22, L * .2, L * .27, col); // брюшко
      const pulse = 1 + Math.sin(ph * 1.5) * .08; const ag = c.createRadialGradient(0, L * .26, 0, 0, L * .26, L * .18 * pulse);
      ag.addColorStop(0, 'rgba(230,255,120,.95)'); ag.addColorStop(1, 'rgba(110,200,40,.2)'); c.fillStyle = ag; c.beginPath(); c.ellipse(0, L * .26, L * .15 * pulse, L * .2 * pulse, 0, 0, TAU); c.fill();
      c.strokeStyle = shade(col, -.5); c.lineWidth = Math.max(1, L * .025); for (const a of [-.4, 0, .4]) { c.beginPath(); c.moveTo(Math.sin(a) * L * .16, L * .08); c.quadraticCurveTo(Math.sin(a) * L * .22, L * .25, Math.sin(a) * L * .12, L * .44); c.stroke(); }
      blob(c, 0, -L * .1, L * .1, L * .14, col); blob(c, 0, -L * .27, L * .11, L * .1, shade(col, -.1));
      c.fillStyle = 'rgba(200,255,90,.9)'; c.beginPath(); c.arc(0, -L * .37, L * .045, 0, TAU); c.fill(); // сопло
      if (k === 'spitter-big') { c.fillStyle = shade(col, -.4); for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(sd * L * .1, -L * .25); c.lineTo(sd * L * .2, -L * .36); c.lineTo(sd * L * .08, -L * .3); c.fill(); } }
      eyes(c, L, -L * .27, .06, '#e8ff60', .03); break;
    }
    case 'armored': {
      legs(c, L, 3, ph * .8, col, .4, -.12, .16, .09);
      // панцирь — шестиугольные пластины
      blob(c, 0, L * .06, L * .32, L * .36, shade(col, -.15), .25, -.6);
      c.strokeStyle = shade(col, -.7); c.lineWidth = Math.max(1, L * .025);
      for (const [hx, hy] of [[0, -.1], [-.16, .04], [.16, .04], [0, .18], [-.14, .28], [.14, .28]]) { c.fillStyle = shade(col, .1 + hy * .3); c.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; c.lineTo(hx * L + Math.cos(a) * L * .09, hy * L + Math.sin(a) * L * .09); } c.closePath(); c.fill(); c.stroke(); }
      blob(c, 0, -L * .3, L * .14, L * .1, shade(col, -.2)); mandibles(c, L, -L * .36, ph, col); eyes(c, L, -L * .32, .07, '#ffb03a'); break;
    }
    case 'destroyer': {
      legs(c, L, 3, ph * 1.2, '#7a4a2a', .44, -.14, .18);
      const pulse = 1 + Math.sin(ph * 2.5) * .07;
      const g = c.createRadialGradient(0, L * .14, L * .04, 0, L * .14, L * .3 * pulse); g.addColorStop(0, '#fff2a0'); g.addColorStop(.35, '#ffa030'); g.addColorStop(.8, '#c04a1a'); g.addColorStop(1, '#5a1a0a');
      c.fillStyle = g; c.beginPath(); c.ellipse(0, L * .14, L * .26 * pulse, L * .3 * pulse, 0, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(90,20,10,.8)'; c.lineWidth = Math.max(1, L * .02); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + .3; c.beginPath(); c.moveTo(0, L * .14); c.quadraticCurveTo(Math.cos(a) * L * .1, L * .14 + Math.sin(a) * L * .2, Math.cos(a) * L * .22, L * .14 + Math.sin(a) * L * .26); c.stroke(); }
      blob(c, 0, -L * .22, L * .13, L * .12, '#7a4a2a'); mandibles(c, L, -L * .3, ph, '#7a4a2a'); eyes(c, L, -L * .25, .06, '#ffe060'); break;
    }
    case 'flyer': {
      const fl = Math.sin(ph * 3); // взмах
      for (const sd of [-1, 1]) {
        c.save(); c.scale(sd, 1); c.rotate(-.2 + fl * .35);
        const wg = c.createLinearGradient(0, 0, L * .62, 0); wg.addColorStop(0, 'rgba(120,170,230,.85)'); wg.addColorStop(1, 'rgba(160,210,255,.25)');
        c.fillStyle = wg; c.beginPath(); c.moveTo(L * .05, -L * .05); c.quadraticCurveTo(L * .45, -L * .38, L * .66, -L * .12); c.quadraticCurveTo(L * .45, L * .02, L * .5, L * .14); c.quadraticCurveTo(L * .3, L * .08, L * .05, L * .12); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(40,60,100,.6)'; c.lineWidth = Math.max(1, L * .015); for (const t of [.25, .45]) { c.beginPath(); c.moveTo(L * .06, 0); c.lineTo(L * (.2 + t * .8), -L * (.24 - t * .3)); c.stroke(); }
        c.restore();
      }
      blob(c, 0, L * .12, L * .09, L * .26, col); // тело и хвост
      c.fillStyle = shade(col, -.3); c.beginPath(); c.moveTo(-L * .05, L * .34); c.lineTo(0, L * .5); c.lineTo(L * .05, L * .34); c.fill();
      blob(c, 0, -L * .2, L * .1, L * .1, shade(col, -.1)); eyes(c, L, -L * .24, .045, '#9af0ff', .03); break;
    }
    case 'brood': {
      legs(c, L, 3, ph * .7, col, .42, -.16, .15, .08);
      blob(c, 0, L * .18, L * .3, L * .33, col, .3, -.55);
      for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + ph * .1, r = L * .17; const ex = Math.cos(a) * r, ey = L * .18 + Math.sin(a) * r * 1.1; const eg = c.createRadialGradient(ex - L * .02, ey - L * .02, 0, ex, ey, L * .07); eg.addColorStop(0, '#ffe0f0'); eg.addColorStop(1, '#b0508a'); c.fillStyle = eg; c.beginPath(); c.arc(ex, ey, L * .06 * (1 + Math.sin(ph + i) * .1), 0, TAU); c.fill(); }
      blob(c, 0, -L * .2, L * .15, L * .13, shade(col, -.15)); mandibles(c, L, -L * .3, ph, col); eyes(c, L, -L * .24, .07, '#ff70c0'); break;
    }
    case 'queen': {
      // гребень и крылья-обрубки
      for (const sd of [-1, 1]) { c.fillStyle = 'rgba(200,120,220,.5)'; c.beginPath(); c.moveTo(sd * L * .15, -L * .05); c.quadraticCurveTo(sd * L * .55, -L * .2 + Math.sin(ph) * L * .03, sd * L * .5, L * .2); c.lineTo(sd * L * .15, L * .1); c.fill(); }
      legs(c, L, 4, ph * .6, col, .46, -.2, .14, .06);
      blob(c, 0, L * .2, L * .26, L * .3, col, .35, -.6);
      c.strokeStyle = 'rgba(255,170,230,.55)'; c.lineWidth = Math.max(1, L * .02); for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(0, L * .2, L * (.08 + i * .05), Math.PI * .1, Math.PI * .9); c.stroke(); }
      blob(c, 0, -L * .12, L * .16, L * .14, shade(col, -.1)); blob(c, 0, -L * .3, L * .12, L * .1, shade(col, -.25));
      c.fillStyle = '#ffd04a'; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * L * .045 - L * .02, -L * .36); c.lineTo(i * L * .045, -L * (.46 + (2 - Math.abs(i)) * .03)); c.lineTo(i * L * .045 + L * .02, -L * .36); c.fill(); }
      eyes(c, L, -L * .31, .06, '#ff3ab0', .03); break;
    }
    default: { // ползуны: малый, средний, большой, гигант — сегментный панцирь
      const n = k === 'giant' ? 3 : 3; legs(c, L, n, ph, col, k === 'small' ? .46 : .5, -.15, .2);
      blob(c, 0, L * .22, L * .22, L * .28, col); // брюшко
      c.strokeStyle = shade(col, -.55); c.lineWidth = Math.max(1, L * .022); for (const yy of [.12, .22, .32]) { c.beginPath(); c.ellipse(0, L * .22, L * .2, L * (.27 - Math.abs(yy - .22)), 0, Math.PI * .15 + (yy - .22), Math.PI * .85 - (yy - .22)); c.stroke(); }
      blob(c, 0, -L * .02, L * .16, L * .12, shade(col, -.08)); // грудь
      blob(c, 0, -L * .2, L * .14, L * .13, shade(col, -.15)); // голова
      if (k === 'big' || k === 'giant') { c.fillStyle = shade(col, -.5); for (const yy of [.05, .2, .35]) for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(sd * L * .14, L * yy); c.lineTo(sd * L * .27, L * (yy - .05)); c.lineTo(sd * L * .16, L * (yy + .05)); c.fill(); } }
      if (k === 'giant') { c.fillStyle = 'rgba(160,200,120,.5)'; for (const yy of [-.02, .14, .3]) { c.beginPath(); c.ellipse(0, L * yy, L * .05, L * .04, 0, 0, TAU); c.fill(); } }
      mandibles(c, L, -L * .28, ph, col); eyes(c, L, -L * .23, .065);
    }
  }
  if (mut > 0) { c.fillStyle = 'rgba(220,60,200,.75)'; for (let i = 0; i < Math.min(6, mut + 1); i++) { const a = i / 6 * TAU; c.beginPath(); c.moveTo(Math.cos(a) * L * .16, L * .15 + Math.sin(a) * L * .2); c.lineTo(Math.cos(a) * L * .3, L * .15 + Math.sin(a) * L * .32); c.lineTo(Math.cos(a + .25) * L * .16, L * .15 + Math.sin(a + .25) * L * .2); c.fill(); } }
  if (el) { c.strokeStyle = 'rgba(255,215,90,.9)'; c.lineWidth = Math.max(1, L * .03); c.beginPath(); c.ellipse(0, L * .1, L * .3, L * .38, 0, 0, TAU); c.stroke(); }
  c.restore();
}
/** постройка Роя: W×H пикселей; t — время анимации, aim — куда смотрит червь */
export function drawSwarmStructure(c: C, pid: string, W: number, H: number, s: number, t: number, seed: number, icon: boolean, aim?: number) {
  const p = PROTOS[pid]; const en = p.enemy; const col = p.color;
  if (!icon) { c.fillStyle = 'rgba(30,10,25,.4)'; c.beginPath(); c.ellipse(W / 2 + s * .15, H / 2 + s * .2, W * .55, H * .45, 0, 0, TAU); c.fill(); }
  if (en?.worm) { // червь-плевун: нора и тело из сегментов, голова к цели
    const lv = en.worm; const R = W * (.3 + lv * .03);
    c.fillStyle = 'rgba(40,20,30,.8)'; c.beginPath(); c.ellipse(W / 2, H / 2 + s * .1, R * 1.2, R * .9, 0, 0, TAU); c.fill();
    c.fillStyle = 'rgba(90,50,40,.9)'; for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; c.beginPath(); c.arc(W / 2 + Math.cos(a) * R * 1.15, H / 2 + s * .1 + Math.sin(a) * R * .85, R * .2, 0, TAU); c.fill(); }
    const a = aim ?? -Math.PI / 2; const sway = Math.sin(t * 1.3 + seed) * .15; const dx = Math.cos(a + sway), dy = Math.sin(a + sway);
    const segs = 4 + lv; for (let i = 0; i < segs; i++) { const k = i / segs; const r = R * (.55 - k * .2); const sx = W / 2 + dx * R * k * 1.1, sy = H / 2 - k * R * 1.2 + dy * R * k * .6;
      const g = c.createRadialGradient(sx - r * .3, sy - r * .3, r * .1, sx, sy, r); g.addColorStop(0, shade(col, .4)); g.addColorStop(1, shade(col, -.45)); c.fillStyle = g; c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.fill(); }
    const hx = W / 2 + dx * R * 1.1, hy = H / 2 - R * 1.2 + dy * R * .6; const hr = R * .38;
    c.fillStyle = shade(col, -.3); c.beginPath(); c.arc(hx, hy, hr, 0, TAU); c.fill();
    c.save(); c.translate(hx, hy); c.rotate(a + sway + Math.PI / 2);
    c.fillStyle = '#2a0a10'; c.beginPath(); c.ellipse(0, -hr * .2, hr * .55, hr * .45, 0, 0, TAU); c.fill(); // пасть
    c.fillStyle = '#eee0c0'; for (let i = 0; i < 6; i++) { const b = i / 6 * TAU; c.beginPath(); c.moveTo(Math.cos(b) * hr * .55, -hr * .2 + Math.sin(b) * hr * .45); c.lineTo(Math.cos(b) * hr * .3, -hr * .2 + Math.sin(b) * hr * .25); c.lineTo(Math.cos(b + .4) * hr * .55, -hr * .2 + Math.sin(b + .4) * hr * .45); c.fill(); }
    const ag = c.createRadialGradient(0, -hr * .2, 0, 0, -hr * .2, hr * .4); ag.addColorStop(0, 'rgba(200,255,90,.9)'); ag.addColorStop(1, 'rgba(120,200,40,0)'); c.fillStyle = ag; c.beginPath(); c.arc(0, -hr * .2, hr * .4, 0, TAU); c.fill();
    c.restore();
    if (lv >= 3) { c.fillStyle = shade(col, -.5); for (let i = 0; i < lv; i++) { const b = i / lv * TAU; c.beginPath(); c.moveTo(W / 2 + Math.cos(b) * R, H / 2 + Math.sin(b) * R * .7); c.lineTo(W / 2 + Math.cos(b) * R * 1.45, H / 2 + Math.sin(b) * R * 1.05 - s * .2); c.lineTo(W / 2 + Math.cos(b + .3) * R, H / 2 + Math.sin(b + .3) * R * .7); c.fill(); } }
    return;
  }
  const pulse = 1 + Math.sin(t) * .035;
  // основание — плоть / слизь
  c.fillStyle = shade(col, -.45); c.beginPath(); for (let i = 0; i < 18; i++) { const a = i / 18 * TAU, r = W * (.47 + Math.sin(i * 2.3 + seed) * .04); c.lineTo(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r * .9); } c.closePath(); c.fill();
  const pod = (x0: number, y0: number, r: number, c1: string, c2: string, c3: string) => { const g = c.createRadialGradient(x0 - r * .3, y0 - r * .4, r * .1, x0, y0, r); g.addColorStop(0, c1); g.addColorStop(.6, c2); g.addColorStop(1, c3); c.fillStyle = g; c.beginPath(); c.arc(x0, y0, r, 0, TAU); c.fill(); };
  const core = (r: number, rgb: string) => { const hg = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r); hg.addColorStop(0, `rgba(${rgb},.95)`); hg.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = hg; c.beginPath(); c.arc(W / 2, H / 2, r, 0, TAU); c.fill(); c.fillStyle = '#1a0614'; c.beginPath(); c.ellipse(W / 2, H / 2, W * .06, H * .05, 0, 0, TAU); c.fill(); };
  const n = 5, glow = (Math.sin(t * 2) + 1) / 2;
  switch (pid) {
    case 'spitter-spawner': for (let i = 0; i < n; i++) { const a = i / n * TAU + seed, x0 = W / 2 + Math.cos(a) * W * .17, y0 = H / 2 + Math.sin(a) * H * .14; pod(x0, y0, W * .19 * pulse, '#c8f07a', '#5a8a2a', '#1e3010'); c.fillStyle = `rgba(220,255,120,${.4 + glow * .4})`; c.beginPath(); c.arc(x0, y0 - W * .04, W * .04, 0, TAU); c.fill(); } core(W * .13, `200,255,${110 + glow * 60 | 0}`); break;
    case 'armored-mound': for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + seed, x0 = W / 2 + Math.cos(a) * W * .2, y0 = H / 2 + Math.sin(a) * H * .17; c.fillStyle = shade(col, (i % 3) * .12 - .1); c.beginPath(); for (let j = 0; j < 6; j++) { const b = j / 6 * TAU + a; c.lineTo(x0 + Math.cos(b) * W * .13, y0 + Math.sin(b) * W * .11); } c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = Math.max(1, s * .04); c.stroke(); } core(W * .12, `255,${150 + glow * 60 | 0},60`); break;
    case 'destroyer-hive': for (let i = 0; i < n; i++) { const a = i / n * TAU + seed, x0 = W / 2 + Math.cos(a) * W * .17, y0 = H / 2 + Math.sin(a) * H * .14; pod(x0, y0, W * .19 * (1 + Math.sin(t * 2 + i) * .06), '#ffe08a', '#d0702a', '#5a200a'); } core(W * .15, `255,${200 + glow * 55 | 0},90`); break;
    case 'flyer-roost': for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + seed + .4, x0 = W / 2 + Math.cos(a) * W * .2, y0 = H / 2 + Math.sin(a) * H * .16; c.fillStyle = shade(col, -.2); c.beginPath(); c.moveTo(x0 - W * .08, y0 + H * .08); c.quadraticCurveTo(x0, y0 - H * .45, x0 + W * .08, y0 + H * .08); c.fill(); c.fillStyle = `rgba(150,210,255,${.4 + glow * .5})`; c.beginPath(); c.arc(x0, y0 - H * .12, W * .03, 0, TAU); c.fill(); } core(W * .12, `150,${200 + glow * 55 | 0},255`); break;
    case 'brood-lair': for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + seed, x0 = W / 2 + Math.cos(a) * W * .22, y0 = H / 2 + Math.sin(a) * H * .19; pod(x0, y0, W * .12 * pulse, '#ffd0ec', '#b04a8a', '#3a0a2a'); } for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + seed * 2; pod(W / 2 + Math.cos(a) * W * .09, H / 2 + Math.sin(a) * H * .08, W * .09, '#f0b0e0', '#8a2a6a', '#300a24'); } core(W * .1, `255,${120 + glow * 80 | 0},200`); break;
    default: for (let i = 0; i < n; i++) { const a = i / n * TAU + seed, x0 = W / 2 + Math.cos(a) * W * .16, y0 = H / 2 + Math.sin(a) * H * .13; pod(x0, y0, W * .2 * pulse, '#d07aa8', '#8a3a6a', '#3a1430'); } core(W * .14, `255,${150 + Math.sin(t * 2) * 60 | 0},90`);
  }
}

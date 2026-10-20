// v1.16: графика ядерной энергетики — центрифуга, реактор (свечение по температуре, стержень, соседи), тепловая труба,
// теплообменник, паровая турбина; значки урана-235/238 и ядерных стержней.
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { shade } from './swarmart';
type C = CanvasRenderingContext2D;
export interface NucState { icon?: boolean; t: number; working?: boolean; ghost?: boolean; seed?: number; /** температура, доля от 1000 °C (0…1.2), округлена до 0,1 */ heat?: number; /** в реакторе горит стержень */ rod?: boolean; /** соседние реакторы */ nb?: number; /** тепловая труба: маска соединений (бит 1<<направление) */ mask?: number; /** стержней загружено */ cells?: number; }
const TAU = Math.PI * 2;
const AK = TAU / 96;
const rr = (c: C, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
function plate(c: C, x: number, y: number, w: number, h: number, col: string, s: number, r = .1) {
  const g = c.createLinearGradient(x, y, x + w * .3, y + h); g.addColorStop(0, shade(col, .22)); g.addColorStop(1, shade(col, -.3)); c.fillStyle = g;
  rr(c, x, y, w, h, s * r); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .045); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = Math.max(1, s * .03); rr(c, x + s * .05, y + s * .05, w - s * .1, h - s * .1, s * r * .8); c.stroke();
}
function shadowBox(c: C, W: number, H: number, s: number, icon?: boolean) { if (icon) return; const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(0,0,0,.32)'); g.addColorStop(1, 'rgba(0,0,0,.12)'); c.fillStyle = g; rr(c, s * .22, s * .26, W - s * .1, H - s * .1, s * .14); c.fill(); }
function glow(c: C, x: number, y: number, r: number, rgb: string, a = 1) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
/** цвет нагрева: тёмный → красный → оранжевый → белый */
export function heatRgb(k: number): string {
  const q = Math.max(0, Math.min(1.2, k));
  const r = Math.round(60 + Math.min(1, q / .45) * 195), g = Math.round(Math.max(0, q - .35) / .85 * 255), b = Math.round(Math.max(0, q - .8) / .4 * 200 + 40);
  return `${r},${Math.min(255, g)},${Math.min(255, b)}`;
}
const arrowAt = (c: C, x: number, y: number, ang: number, s: number, col: string) => { c.save(); c.translate(x, y); c.rotate(ang); c.fillStyle = col; c.beginPath(); c.moveTo(0, -s * .1); c.lineTo(s * .09, s * .07); c.lineTo(-s * .09, s * .07); c.closePath(); c.fill(); c.restore(); };
export function drawNuclearArt(c: C, pid: string, W: number, H: number, s: number, dir: number, st: NucState): boolean {
  const p = PROTOS[pid]; if (!p) return false; const col = p.color;
  const on = !!st.working && !st.icon, phase = on ? (st.t % 96) * AK : 0;
  switch (pid) {
    case 'centrifuge': {
      shadowBox(c, W, H, s, st.icon);
      plate(c, s * .08, s * .08, W - s * .16, H - s * .16, '#728b7d', s, .12);
      c.fillStyle = shade('#7d8a80', -.45); rr(c, W * .14, H * .14, W * .72, H * .72, s * .12); c.fill();
      c.strokeStyle = '#a8bdb2'; c.lineWidth = s * .075; c.beginPath(); c.moveTo(W * .3, H * .3); c.lineTo(W * .3, H * .72); c.lineTo(W * .7, H * .72); c.lineTo(W * .7, H * .3); c.stroke();
      const cs: [number, number, number][] = [[.3, .36, 1], [.7, .36, -1], [.5, .68, 1]];
      for (const [fx, fy, d] of cs) {
        plate(c, W * fx - s * .4, H * fy - s * .49, s * .8, s * 1.02, '#9bafa5', s, .15);
        c.fillStyle = '#536d62'; c.fillRect(W * fx - s * .35, H * fy + s * .32, s * .7, s * .085);
        c.save(); c.translate(W * fx, H * fy); c.fillStyle = '#2c3430'; c.beginPath(); c.arc(0, 0, s * .36, 0, TAU); c.fill();
        c.rotate(on ? phase * 2 * d : fx * 3);
        c.fillStyle = '#c8d3c4'; c.beginPath(); c.arc(0, 0, s * .3, 0, TAU); c.fill();
        c.strokeStyle = '#59655c'; c.lineWidth = s * .07; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(i * TAU / 3) * s * .27, Math.sin(i * TAU / 3) * s * .27); c.stroke(); }
        c.fillStyle = '#7ad46a'; c.beginPath(); c.arc(0, 0, s * .07, 0, TAU); c.fill(); c.restore();
      }
      c.fillStyle = '#263d35'; rr(c, W * .13, H * .86, W * .74, H * .07, s * .03); c.fill();
      c.fillStyle = on ? '#9edb88' : '#648477'; c.fillRect(W * .19, H * .88, W * .18, H * .025);
      c.fillStyle = '#b9c7b6'; c.fillRect(W * .65, H * .88, W * .16, H * .025);
      return true;
    }
    case 'nuclear-reactor': {
      shadowBox(c,W,H,s,st.icon); plate(c,s*.06,s*.06,W-s*.12,H-s*.12,'#657d73',s,.16);
      const hk=st.heat??0,cx=W/2,cy=H/2,R=Math.min(W,H)*.32;
      // Shielded pressure vessel: solid lid, with heat visible only in peripheral exchangers.
      for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
        c.save();c.translate(cx,cy);c.rotate(Math.atan2(dy,dx)+Math.PI/2);
        plate(c,-s*.46,-H*.43,s*.92,H*.17,'#a08262',s,.08);
        c.fillStyle=hk>.1?'rgb('+heatRgb(hk)+')':'#574e43';c.fillRect(-s*.32,-H*.4,s*.64,H*.035);
        c.fillStyle='#c0afa0';for(let i=0;i<3;i++)c.fillRect(-s*.35+i*s*.29,-H*.35,s*.12,H*.035);
        c.restore();
      }
      c.fillStyle='#263e35';c.beginPath();c.arc(cx,cy,R*1.12,0,TAU);c.fill();
      const lid=c.createLinearGradient(cx-R,cy-R,cx+R,cy+R);lid.addColorStop(0,'#c1cec0');lid.addColorStop(.45,'#91a79b');lid.addColorStop(1,'#536d62');c.fillStyle=lid;c.beginPath();c.arc(cx,cy,R,0,TAU);c.fill();
      c.strokeStyle='#d1dacb';c.lineWidth=s*.055;c.stroke();
      c.strokeStyle='#536c60';c.lineWidth=s*.085;c.beginPath();c.arc(cx,cy,R*.76,0,TAU);c.stroke();
      c.fillStyle='#d2dac9';for(let i=0;i<12;i++){const ang=i*TAU/12;c.beginPath();c.arc(cx+Math.cos(ang)*R*.89,cy+Math.sin(ang)*R*.89,s*.065,0,TAU);c.fill();}
      for(const dx of [-1,1]){plate(c,cx+dx*R*.45-s*.09,cy-R*.28,s*.18,R*.56,'#536e61',s,.04);}
      c.fillStyle='#cbbb70';c.beginPath();c.arc(cx,cy,R*.27,0,TAU);c.fill();c.fillStyle='#394d3c';
      for(let i=0;i<3;i++){const ang=i*TAU/3;c.beginPath();c.moveTo(cx,cy);c.arc(cx,cy,R*.21,ang,ang+.9);c.closePath();c.fill();}
      c.fillStyle='#273f37';rr(c,W*.26,H*.83,W*.48,H*.08,s*.045);c.fill();
      c.fillStyle=st.rod?'#a9de82':'#566a57';c.fillRect(W*.29,H*.85,W*.1,H*.035);
      if(st.rod&&on)glow(c,W*.34,H*.865,s*.28,'150,240,115',.15+.08*Math.sin(phase*2));
      c.fillStyle='#7bc4cd';for(let i=0;i<Math.min(4,st.nb||0);i++)c.fillRect(W*.46+i*s*.22,H*.85,s*.12,H*.035);
      c.fillStyle='#d28a5a';for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]])c.fillRect(cx+dx*(W/2-s*.02)-s*.22,cy+dy*(H/2-s*.02)-s*.22,s*.44,s*.44);
      return true;
    }
    case 'heat-pipe': {
      const hk = st.heat ?? 0, m = st.icon ? 15 : (st.mask ?? 0);
      if (!st.icon) { c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.arc(W * .54, H * .58, s * .24, 0, TAU); c.fill(); }
      const arm = (d: number) => { const x = d === 1 ? W * .5 : d === 3 ? 0 : W * .38, y = d === 2 ? H * .5 : d === 0 ? 0 : H * .38; const w = d % 2 ? W * .5 : W * .24, h = d % 2 ? H * .24 : H * .5; return [x, y, w, h]; };
      for (let d = 0; d < 4; d++) if (m & (1 << d)) { const [x, y, w, h] = arm(d); c.fillStyle = '#796451'; c.fillRect(x, y, w, h);
        c.fillStyle = '#c19b76'; c.fillRect(x, y, d % 2 ? w : w * .2, d % 2 ? h * .2 : h); c.fillStyle = `rgb(${heatRgb(hk * .8 + .1)})`; c.fillRect(d % 2 ? x : x + w * .25, d % 2 ? y + h * .25 : y, d % 2 ? w : w * .5, d % 2 ? h * .5 : h); }
      c.fillStyle = '#91a3a0'; c.beginPath(); c.arc(W / 2, H / 2, s * .22, 0, TAU); c.fill();
      const g = c.createRadialGradient(W / 2 - s * .05, H / 2 - s * .05, 1, W / 2, H / 2, s * .2); g.addColorStop(0, `rgb(${heatRgb(hk + .3)})`); g.addColorStop(1, `rgb(${heatRgb(hk)})`); c.fillStyle = g; c.beginPath(); c.arc(W / 2, H / 2, s * .17, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = Math.max(1, s * .04); c.beginPath(); c.arc(W / 2, H / 2, s * .22, 0, TAU); c.stroke();
      return true;
    }
    case 'heat-exchanger': {
      shadowBox(c,W,H,s,st.icon);c.save();c.translate(W/2,H/2);c.rotate(dir*Math.PI/2);
      const w0=dir%2?H:W,h0=dir%2?W:H; c.translate(-w0/2,-h0/2);const hk=st.heat??0;
      plate(c,s*.06,s*.06,w0-s*.12,h0-s*.12,'#667f88',s,.12);
      // Four parallel copper tubes with silver cooling fins and side water headers.
      plate(c,w0*.23,h0*.2,w0*.54,h0*.62,'#4b5d5e',s,.06);
      for(let i=0;i<4;i++){
        const x=w0*(.3+i*.135);const metal=c.createLinearGradient(x-s*.1,0,x+s*.1,0);metal.addColorStop(0,'#805941');metal.addColorStop(.4,'#dfb38a');metal.addColorStop(1,'#8b634a');c.fillStyle=metal;rr(c,x-s*.1,h0*.23,s*.2,h0*.53,s*.08);c.fill();
      }
      c.fillStyle='#9eafb0';for(let i=0;i<4;i++)c.fillRect(w0*.24,h0*(.3+i*.12),w0*.52,s*.055);
      for(const x of [.16,.84]){plate(c,w0*x-s*.13,h0*.21,s*.26,h0*.62,'#a3bdc3',s,.12);}
      c.strokeStyle='#b9ccd0';c.lineWidth=s*.1;c.beginPath();c.moveTo(w0*.16,s*1.5);c.lineTo(0,s*1.5);c.moveTo(w0*.84,s*1.5);c.lineTo(w0,s*1.5);c.moveTo(w0/2,h0*.23);c.lineTo(w0/2,0);c.stroke();
      c.fillStyle=hk>.1?'rgb('+heatRgb(hk)+')':'#735440';c.fillRect(w0*.28,h0*.83,w0*.44,s*.075);
      c.fillStyle='#d28a5a';c.fillRect(w0/2-s*.17,h0-s*.1,s*.34,s*.12);
      c.fillStyle='#4a90d9';c.fillRect(-s*.02,s*1.5-s*.16,s*.14,s*.32);c.fillRect(w0-s*.12,s*1.5-s*.16,s*.14,s*.32);
      c.fillStyle='#e6edf3';c.fillRect(w0/2-s*.17,-s*.02,s*.34,s*.14);
      if(on){c.strokeStyle='rgba(225,245,245,'+(.45+.2*Math.sin(phase*2))+')';c.lineWidth=s*.045;c.beginPath();c.arc(w0*.5,h0*.16,s*.13,Math.PI,TAU);c.stroke();}
      c.restore();return true;
    }
    case 'steam-turbine': {
      shadowBox(c,W,H,s,st.icon);c.save();c.translate(W/2,H/2);if(dir%2)c.rotate(Math.PI/2);
      const L=Math.max(W,H),Sx=Math.min(W,H);
      plate(c,-Sx*.46,-L*.46,Sx*.92,L*.92,'#657e88',s,.12);
      c.fillStyle='#304b56';c.fillRect(-Sx*.36,-L*.38,Sx*.72,L*.76);
      const shell=c.createLinearGradient(-Sx*.29,0,Sx*.29,0);shell.addColorStop(0,'#5c7e89');shell.addColorStop(.35,'#c3d2d1');shell.addColorStop(.65,'#9fb6ba');shell.addColorStop(1,'#4a6976');
      c.fillStyle=shell;rr(c,-Sx*.29,-L*.37,Sx*.58,L*.5,s*.3);c.fill();
      c.fillStyle='#587a86';for(let i=0;i<4;i++)c.fillRect(-Sx*.3,-L*.3+i*L*.1,Sx*.6,s*.085);
      c.fillStyle='#ced9d1';c.fillRect(-s*.09,L*.11,s*.18,L*.13);
      plate(c,-Sx*.27,L*.22,Sx*.54,L*.16,'#75928e',s,.12);
      c.fillStyle='#354f55';for(let i=0;i<4;i++)c.fillRect(-Sx*.2+i*Sx*.11,L*.245,Sx*.045,L*.1);
      c.fillStyle='#243f4b';c.beginPath();c.arc(0,L*.055,Sx*.14,0,TAU);c.fill();
      c.save();c.translate(0,L*.055);c.rotate(phase*2);c.strokeStyle='#c7d4d0';c.lineWidth=s*.045;for(let i=0;i<5;i++){const ang=i*TAU/5;c.beginPath();c.moveTo(0,0);c.lineTo(Math.cos(ang)*Sx*.115,Math.sin(ang)*Sx*.115);c.stroke();}c.restore();
      c.fillStyle=on?'#98dcca':'#54727b';c.fillRect(-Sx*.4,L*.26,s*.12,s*.22);
      c.fillStyle='#e6edf3';c.fillRect(-s*.17,-L/2-s*.02,s*.34,s*.16);c.fillRect(-s*.17,L/2-s*.14,s*.34,s*.16);
      c.restore();return true;
    }
  }
  return false;
}
/** значки урана-235/238 и ядерных стержней (true — нарисовано) */
export function drawNuclearIcon(c: C, id: string, s: number): boolean {
  const it = ITEMS[id]; if (!it) return false; const col = it.color;
  if (it.icon === 'isotope') {
    // слиток-гранула с буквой массового числа
    const g = c.createRadialGradient(s * .42, s * .4, s * .05, s * .5, s * .5, s * .42); g.addColorStop(0, shade(col, .45)); g.addColorStop(1, shade(col, -.35));
    c.fillStyle = g; c.beginPath(); c.arc(s * .5, s * .52, s * .36, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = s * .05; c.stroke();
    if (id === 'uranium-235') { c.save(); c.globalAlpha = .6; glow(c, s * .5, s * .5, s * .5, '130,255,110', .5); c.restore(); }
    c.fillStyle = '#10200c'; c.font = `bold ${s * .27}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(id.endsWith('235') ? '235' : '238', s * .5, s * .53);
    return true;
  }
  if (it.icon === 'fuelcell') {
    const used = id.startsWith('used');
    c.fillStyle = '#4a5058'; rr(c, s * .36, s * .08, s * .28, s * .84, s * .06); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .04; c.stroke();
    const g = c.createLinearGradient(0, s * .15, 0, s * .85); g.addColorStop(0, used ? '#8a8a76' : '#d6ff9a'); g.addColorStop(1, used ? '#4e4e40' : '#58b83a');
    c.fillStyle = g; rr(c, s * .41, s * .16, s * .18, s * .68, s * .04); c.fill();
    c.fillStyle = used ? '#2e2e26' : '#e8c93a'; c.fillRect(s * .36, s * .3, s * .28, s * .05); c.fillRect(s * .36, s * .64, s * .28, s * .05);
    if (!used) glow(c, s * .5, s * .5, s * .5, '130,255,110', .35);
    return true;
  }
  return false;
}

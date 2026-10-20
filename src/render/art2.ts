// v1.14: графика новых построек — 7 турелей, бетонные и композитные стены, ворота (открытые/закрытые), ж/д ворота,
// дизельный генератор и газовая турбина, факел, малая и большая цистерны; иконки оружия, патронов, брони и модулей.
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { drawGun } from './heroart';
import { shade } from './swarmart';
type C = CanvasRenderingContext2D;
export interface Art2State { conn?: number; icon?: boolean; t: number; working?: boolean; aim?: number; flash?: boolean; open?: boolean; fill?: number; fluidColor?: string; ghost?: boolean; seed?: number; }
const TAU = Math.PI * 2;
const rr = (c: C, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
function plate(c: C, x: number, y: number, w: number, h: number, col: string, s: number, r = .1) {
  const g = c.createLinearGradient(x, y, x + w * .3, y + h); g.addColorStop(0, shade(col, .22)); g.addColorStop(1, shade(col, -.3)); c.fillStyle = g;
  rr(c, x, y, w, h, s * r); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .045); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = Math.max(1, s * .03); rr(c, x + s * .05, y + s * .05, w - s * .1, h - s * .1, s * r * .8); c.stroke();
}
function shadowBox(c: C, W: number, H: number, s: number, icon?: boolean) { if (icon) return; const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(0,0,0,.32)'); g.addColorStop(1, 'rgba(0,0,0,.12)'); c.fillStyle = g; rr(c, s * .22, s * .28, W, H - s * .1, s * .2); c.fill(); }
function glow(c: C, x: number, y: number, r: number, rgb: string, a = 1) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
/** основание турели: восьмиугольник с заклёпками */
function turretBase(c: C, R: number, col: string, s: number) {
  c.fillStyle = shade(col, -.45); c.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + Math.PI / 8; c.lineTo(Math.cos(a) * R, Math.sin(a) * R); } c.closePath(); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .05); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; c.beginPath(); c.arc(Math.cos(a) * R * .82, Math.sin(a) * R * .82, Math.max(1, s * .04), 0, TAU); c.fill(); }
}
function connectedWall(c: C, pid: string, W: number, H: number, scale: number, conn: number) {
  const north = !!(conn & 1), east = !!(conn & 2), south = !!(conn & 4), west = !!(conn & 8);
  const composite = pid === 'composite-wall', concrete = pid === 'concrete-wall';
  const cap = composite ? '#79888b' : concrete ? '#9b9e97' : '#96988b';
  const body = composite ? '#3a4b53' : concrete ? '#59625e' : '#61665b';
  const points: [number, number][] = [[.26, .2]];
  if (north) points.push([.26, 0], [.74, 0]);
  points.push([.74, .2]);
  if (east) points.push([1, .2], [1, .62]);
  points.push([.74, .62]);
  if (south) points.push([.74, 1], [.26, 1]);
  points.push([.26, .62]);
  if (west) points.push([0, .62], [0, .2]);
  // Union outline avoids overlapping caps and interior seams at corners and junctions.
  const outline = () => { c.beginPath(); c.moveTo(points[0]![0] * W, points[0]![1] * H); for (let i = 1; i < points.length; i++) c.lineTo(points[i]![0] * W, points[i]![1] * H); c.closePath(); };
  c.save(); c.lineJoin = 'miter';
  c.beginPath(); c.rect(0, 0, W, H); c.clip();
  // Only exposed south-facing edges have a visible vertical masonry face.
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!, [x2, y2] = points[(i + 1) % points.length]!;
    if (x2 >= x1 || y1 >= 1) continue;
    const bottom = Math.min(1, y1 + .24);
    c.fillStyle = 'rgba(10,18,18,.3)'; c.fillRect(x2 * W, bottom * H, (x1 - x2) * W, Math.min(.055, 1 - bottom) * H);
    const g = c.createLinearGradient(0, y1 * H, 0, bottom * H); g.addColorStop(0, body); g.addColorStop(1, shade(body, -.4));
    c.fillStyle = g; c.fillRect(x2 * W, y1 * H, (x1 - x2) * W, (bottom - y1) * H);
    c.fillStyle = shade(body, -.48); c.fillRect(x2 * W, (bottom - .025) * H, (x1 - x2) * W, .025 * H);
    c.fillStyle = composite ? '#a48b58' : 'rgba(25,35,30,.32)';
    c.fillRect(x2 * W, (y1 + .115) * H, (x1 - x2) * W, .018 * H);
    for (const joint of [.18, .5, .82]) if (joint > x2 && joint < x1) {
      c.fillStyle = 'rgba(18,28,26,.42)'; c.fillRect(joint * W, (y1 + .035) * H, Math.max(.6, scale * .017), .18 * H);
    }
  }
  outline(); c.fillStyle = cap; c.fill();
  // Bevel only exposed edges; a neighbor boundary must have no border or inset.
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!, [x2, y2] = points[(i + 1) % points.length]!;
    if ((x1 === x2 && (x1 === 0 || x1 === 1)) || (y1 === y2 && (y1 === 0 || y1 === 1))) continue;
    c.strokeStyle = x2 > x1 || y2 < y1 ? shade(cap, .18) : shade(cap, -.3);
    c.lineWidth = Math.max(.8, scale * .035); c.beginPath(); c.moveTo(x1 * W, y1 * H); c.lineTo(x2 * W, y2 * H); c.stroke();
  }
  outline(); c.clip();
  c.strokeStyle = composite ? 'rgba(31,49,55,.55)' : 'rgba(43,52,43,.32)'; c.lineWidth = Math.max(.55, scale * .018);
  c.beginPath();
  if (east || west) { c.moveTo(W * .5, H * .22); c.lineTo(W * .5, H * .6); }
  if (north || south) { c.moveTo(W * .28, H * .46); c.lineTo(W * .72, H * .46); }
  c.stroke();
  if (composite) {
    c.fillStyle = '#c1b38b';
    for (const [x, y] of [[.32, .28], [.68, .28], [.32, .56], [.68, .56]]) c.fillRect(x * W, y * H, Math.max(.7, scale * .025), Math.max(.7, scale * .025));
  } else {
    for (let i = 0; i < 24; i++) {
      c.fillStyle = i % 3 ? 'rgba(39,49,40,.16)' : 'rgba(228,227,204,.28)';
      c.fillRect(((i * 37 + 11) % 97) / 100 * W, ((i * 23 + 7) % 97) / 100 * H, Math.max(.5, scale * .018), Math.max(.5, scale * .014));
    }
    if (!concrete) {
      c.strokeStyle = 'rgba(46,55,43,.38)'; c.beginPath(); c.moveTo(W * .62, H * .24); c.lineTo(W * .58, H * .34); c.lineTo(W * .63, H * .39); c.stroke();
    }
  }
  c.restore();
}
function wallTooth(c: C, pid: string, W: number, H: number, s: number, icon: boolean) {
  const composite = pid === 'composite-wall', concrete = pid === 'concrete-wall';
  const lit = composite ? '#66777d' : concrete ? '#91958e' : '#929084';
  const mid = composite ? '#46575f' : concrete ? '#6b706c' : '#72756a';
  const dark = composite ? '#28373f' : concrete ? '#414a49' : '#484f49';
  const path = (pts: [number, number][]) => { c.beginPath(); c.moveTo(pts[0]![0] * W, pts[0]![1] * H); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i]![0] * W, pts[i]![1] * H); c.closePath(); };
  const face = (pts: [number, number][], color: string) => { path(pts); c.fillStyle = color; c.fill(); };
  c.save(); c.lineJoin = 'round';
  // Broad planted footing and a directional shadow separate neighboring teeth.
  if (!icon) {
    face([[.24, .63], [.64, .58], [.96, .77], [.91, .89], [.57, .96], [.2, .8]], 'rgba(10,16,17,.3)');
    c.fillStyle = 'rgba(6,12,13,.36)'; c.beginPath(); c.ellipse(W * .5, H * .77, W * .38, H * .12, 0, 0, TAU); c.fill();
  }
  face([[.1, .66], [.47, .5], [.88, .66], [.88, .75], [.51, .92], [.1, .75]], '#283332');
  face([[.1, .66], [.47, .5], [.88, .66], [.51, .84]], mid);
  face([[.1, .66], [.51, .84], [.51, .91], [.1, .74]], dark);
  face([[.51, .84], [.88, .66], [.88, .74], [.51, .91]], shade(dark, -.22));
  face([[.11, .66], [.51, .82], [.87, .66], [.51, .85]], shade(lit, -.14));
  // Truncated square pyramid: broad battered faces, narrow flat cap, chipped bevels.
  const left = c.createLinearGradient(W * .24, H * .25, W * .49, H * .8);
  left.addColorStop(0, lit); left.addColorStop(.6, mid); left.addColorStop(1, shade(mid, -.16));
  path([[.34, .23], [.51, .31], [.51, .81], [.17, .66]]); c.fillStyle = left; c.fill();
  const right = c.createLinearGradient(W * .55, H * .29, W * .77, H * .71);
  right.addColorStop(0, mid); right.addColorStop(.45, dark); right.addColorStop(1, shade(dark, -.18));
  path([[.51, .31], [.66, .23], [.82, .66], [.51, .81]]); c.fillStyle = right; c.fill();
  face([[.34, .23], [.48, .13], [.66, .23], [.51, .33]], shade(lit, .12));
  face([[.37, .225], [.48, .155], [.625, .23], [.51, .295]], lit);
  face([[.34, .23], [.37, .225], [.21, .65], [.17, .66]], shade(lit, -.04));
  face([[.505, .33], [.52, .325], [.535, .794], [.51, .81]], shade(lit, -.21));
  face([[.17, .66], [.51, .81], [.82, .66], [.8, .7], [.51, .845], [.19, .7]], shade(dark, -.15));
  if (composite) {
    // Armor seams follow the slope; restrained brass identifies the reinforced tier.
    face([[.365, .33], [.465, .38], [.465, .71], [.245, .615]], '#374951');
    face([[.555, .38], [.645, .33], [.755, .615], [.555, .71]], '#22343c');
    face([[.355, .345], [.37, .352], [.276, .6], [.257, .594]], '#7b8a8b');
    face([[.29, .61], [.46, .686], [.46, .724], [.278, .642]], '#ac915d');
    face([[.56, .686], [.731, .608], [.742, .64], [.56, .724]], '#7c704e');
    c.fillStyle = '#a7b1aa';
    for (const [x, y] of [[.385, .39], [.435, .63], [.62, .39], [.585, .63]]) { c.beginPath(); c.arc(W * x, H * y, Math.max(.55, s * .019), 0, TAU); c.fill(); }
  } else {
    // Deterministic aggregate remains stable in the atlas and inventory icons.
    for (let i = 0; i < 18; i++) {
      const y = .36 + (i % 6) * .057, edge = .34 - (y - .23) * .395;
      const x = edge + .025 + ((i * 7) % 11) / 11 * (.465 - edge - .025);
      c.fillStyle = i % 3 === 0 ? 'rgba(218,218,200,.26)' : 'rgba(24,34,32,.23)';
      c.fillRect(W * x, H * y, Math.max(.55, s * .018), Math.max(.45, s * .013));
    }
    c.strokeStyle = concrete ? 'rgba(34,44,42,.28)' : 'rgba(33,42,37,.5)'; c.lineWidth = Math.max(.65, s * .018); c.beginPath();
    if (concrete) {
      c.moveTo(W * .285, H * .43); c.lineTo(W * .48, H * .515);
      c.moveTo(W * .54, H * .515); c.lineTo(W * .728, H * .43);
      c.moveTo(W * .235, H * .57); c.lineTo(W * .48, H * .68);
    } else {
      c.moveTo(W * .4, H * .35); c.lineTo(W * .365, H * .45); c.lineTo(W * .39, H * .5); c.lineTo(W * .33, H * .61);
      c.moveTo(W * .365, H * .45); c.lineTo(W * .31, H * .46);
      c.moveTo(W * .62, H * .49); c.lineTo(W * .66, H * .55); c.lineTo(W * .645, H * .66);
    }
    c.stroke();
    if (!concrete) face([[.205, .64], [.249, .672], [.236, .697], [.19, .675]], '#858679');
  }
  c.restore();
}
export function drawEntityArt2(c: C, pid: string, W: number, H: number, s: number, dir: number, st: Art2State): boolean {
  const p = PROTOS[pid]; if (!p) return false; const col = p.color;
  if (p.type === 'wall') {
    const conn = (st.conn ?? 0) & 15;
    if (conn && !st.icon) connectedWall(c, pid, W, H, s, conn);
    else wallTooth(c, pid, W, H, s, !!st.icon);
    return true;
  }
  if (pid === 'bio-collection-station') {
    shadowBox(c, W, H, s, st.icon);
    plate(c, s * .12, s * .12, W - s * .24, H - s * .24, '#506a60', s, .12);
    plate(c, s * .28, s * .28, W - s * .56, H - s * .56, '#30444a', s, .08);
    c.fillStyle = '#547d69'; c.fillRect(s * .42, s * .42, W - s * .84, H - s * .84);
    c.fillStyle = '#263b40'; rr(c, W * .29, H * .25, W * .42, H * .5, s * .08); c.fill();
    c.strokeStyle = '#8aa99a'; c.lineWidth = Math.max(1, s * .045); c.stroke();
    c.fillStyle = '#93c7ad'; rr(c, W * .38, H * .33, W * .24, H * .34, s * .07); c.fill();
    c.fillStyle = '#273b3e'; c.fillRect(W * .42, H * .4, W * .16, H * .2);
    c.fillStyle = st.working && !st.icon ? '#7cf3d7' : '#b4cf9b';
    for (const [x, y] of [[.2, .2], [.8, .2], [.2, .8], [.8, .8]]) {
      c.beginPath(); c.arc(W * x, H * y, s * .09, 0, TAU); c.fill();
      c.strokeStyle = '#c5d2bc'; c.lineWidth = Math.max(1, s * .035); c.stroke();
    }
    c.strokeStyle = '#b8cfb3'; c.lineWidth = Math.max(1, s * .04);
    c.beginPath(); c.moveTo(W * .5, H * .2); c.lineTo(W * .5, H * .29); c.moveTo(W * .5, H * .71); c.lineTo(W * .5, H * .8); c.stroke();
    if (st.working && !st.icon) glow(c, W * .5, H * .5, s * .45, '90,240,210', .22);
    return true;
  }
  // Standard defenses: fixed services and independently aimed weapon heads.
  if (['gun-turret', 'laser-turret', 'flamethrower-turret'].includes(pid)) {
    const flame=pid==='flamethrower-turret', laser=pid==='laser-turret', flash=!!st.flash&&!st.icon;
    const phase=st.working&&!st.icon?(st.t%96)*TAU/96:0;
    shadowBox(c,W,H,s,st.icon);
    let cx=W/2,cy=H/2;
    if(flame) {
      c.save();c.translate(W/2,H/2);c.rotate(dir*Math.PI/2);c.translate(-s,-1.5*s);
      plate(c,.12*s,.12*s,1.76*s,2.76*s,'#596f73',s,.15);
      for(const x of [.32,1.12]) {
        const g=c.createLinearGradient(x*s,0,(x+.56)*s,0);g.addColorStop(0,'#896445');g.addColorStop(.45,'#c9a87a');g.addColorStop(1,'#74543d');c.fillStyle=g;rr(c,x*s,1.53*s,.56*s,1.04*s,.22*s);c.fill();
        c.fillStyle='#bbcac3';c.fillRect(x*s,1.74*s,.56*s,.09*s);c.fillRect(x*s,2.31*s,.56*s,.09*s);
      }
      for(const q of p.fluid![0].conns){const x=(q.x+.5)*s;c.fillStyle='#9eafb2';c.fillRect(x-.11*s,2.53*s,.22*s,.49*s);c.fillStyle='#c6a061';c.fillRect(x-.18*s,2.79*s,.36*s,.09*s);}
      c.strokeStyle='#b48b57';c.lineWidth=.12*s;c.beginPath();c.moveTo(.5*s,1.55*s);c.lineTo(s,1.32*s);c.lineTo(1.5*s,1.55*s);c.stroke();c.restore();
      const dx=0,dy=-.4*s,a=dir*Math.PI/2;cx+=dx*Math.cos(a)-dy*Math.sin(a);cy+=dx*Math.sin(a)+dy*Math.cos(a);
    } else {
      plate(c,.12*s,.12*s,W-.24*s,H-.24*s,laser?'#667f89':'#76817a',s,.16);
      for(const x of [.2,1.5]){c.fillStyle=laser?'#506c7d':'#a48e60';rr(c,x*s,.4*s,.3*s,1.2*s,.07*s);c.fill();c.fillStyle='#b5c7c4';for(let i=0;i<4;i++)c.fillRect(x*s,(.51+i*.25)*s,.3*s,.055*s);}
    }
    c.fillStyle='#263b43';c.beginPath();c.arc(cx,cy,.68*s,0,TAU);c.fill();c.strokeStyle='#a5b8b6';c.lineWidth=.065*s;c.beginPath();c.arc(cx,cy,.55*s,0,TAU);c.stroke();
    c.save();c.translate(cx,cy);c.rotate((st.aim??-Math.PI/2)+Math.PI/2);
    if(laser){
      plate(c,-.38*s,-.42*s,.76*s,.9*s,'#8d666a',s,.12);c.fillStyle='#c5d0c7';for(const x of [-.49,.37])for(let i=0;i<4;i++)c.fillRect(x*s,(-.32+i*.19)*s,.12*s,.08*s);
      c.fillStyle='#293d4a';rr(c,-.2*s,-.92*s,.4*s,.65*s,.09*s);c.fill();c.fillStyle='#a9c5cc';c.fillRect(-.24*s,-.9*s,.48*s,.12*s);c.fillStyle=st.working&&!st.icon?'#f2a6a2':'#b67b7e';c.fillRect(-.14*s,-.96*s,.28*s,.1*s);
      c.fillStyle='#b4d6cf';c.fillRect(-.12*s,-.16*s,.24*s,.34*s);if(st.working&&!st.icon)glow(c,0,-.07*s,.24*s,'220,135,140',.2+.08*Math.sin(phase*2));
    }else if(flame){
      plate(c,-.35*s,-.35*s,.7*s,.72*s,'#b68959',s,.12);c.fillStyle='#30464e';rr(c,-.12*s,-.98*s,.24*s,.85*s,.05*s);c.fill();c.fillStyle='#b9b8a3';c.fillRect(-.18*s,-.99*s,.36*s,.16*s);c.fillStyle='#714c35';c.fillRect(-.1*s,-1.02*s,.2*s,.06*s);
      c.strokeStyle='#c49b66';c.lineWidth=.065*s;c.beginPath();c.moveTo(.27*s,.22*s);c.lineTo(.27*s,-.65*s);c.lineTo(.12*s,-.82*s);c.stroke();
    }else{
      plate(c,-.36*s,-.35*s,.72*s,.82*s,'#9e946e',s,.12);c.fillStyle='#4b6064';rr(c,-.63*s,-.15*s,.27*s,.55*s,.07*s);c.fill();c.fillStyle='#cfb575';for(let i=0;i<4;i++)c.fillRect(-.58*s,(-.09+i*.12)*s,.2*s,.055*s);
      for(const x of [-.22,.1]){c.fillStyle='#253940';c.fillRect(x*s,(-.97+(flash?.05:0))*s,.12*s,.75*s);c.fillStyle='#aabbb9';c.fillRect(x*s,-.65*s,.12*s,.08*s);c.fillStyle='#101f28';c.fillRect((x-.025)*s,-.99*s,.17*s,.13*s);}
      c.fillStyle='#bbc8bd';c.fillRect(-.21*s,-.05*s,.42*s,.1*s);
    }
    if(flash)glow(c,0,-1.06*s,(flame?.5:laser?.33:.38)*s,flame?'255,155,65':laser?'255,145,145':'255,220,135');
    c.restore();return true;
  }
  if(pid==='stone-wall') {
    // Full tile coverage keeps adjacent masonry continuous in either axis.
    const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,'#c4c1ad');g.addColorStop(.55,'#a5a392');g.addColorStop(1,'#686e67');c.fillStyle=g;c.fillRect(0,0,W,H);
    c.fillStyle='#d1ceba';c.fillRect(0,0,W,H*.17);c.fillStyle='#777d73';c.fillRect(0,H*.2,W,H*.055);c.fillRect(0,H*.66,W,H*.045);
    c.fillStyle='#747b72';c.fillRect(W*.48,H*.25,W*.04,H*.41);for(const x of [.23,.75])c.fillRect(W*x,H*.7,W*.035,H*.3);
    c.fillStyle='rgba(234,235,209,.25)';c.fillRect(0,H*.27,W*.46,H*.04);c.fillRect(W*.53,H*.27,W*.47,H*.04);return true;
  }
  if(pid==='gate') {
    c.save();c.translate(W/2,H/2);c.rotate(dir*Math.PI/2);c.translate(-W/2,-H/2);
    c.fillStyle='#4e656d';c.fillRect(0,H*.08,W*.18,H*.84);c.fillRect(W*.82,H*.08,W*.18,H*.84);
    c.fillStyle='#c1c6b6';c.fillRect(0,H*.08,W*.18,H*.12);c.fillRect(W*.82,H*.08,W*.18,H*.12);
    const k=st.open?.1:1;for(const side of [0,1]){const w=W*.33*k,x=side?W*.82-w:W*.18;c.fillStyle='#93a5a6';c.fillRect(x,H*.24,w,H*.52);c.fillStyle='#566f79';for(let i=0;i<3;i++)c.fillRect(x,H*(.32+i*.14),w,H*.035);c.fillStyle='#d0b671';c.fillRect(x,H*.48,w,H*.075);}
    c.fillStyle='#253b44';c.fillRect(W*.03,H*.42,W*.1,H*.28);c.fillStyle=st.open?'#87c7a2':'#bd805e';c.fillRect(W*.055,H*.47,W*.05,H*.1);
    c.strokeStyle='#69818a';c.lineWidth=.035*s;c.beginPath();c.moveTo(0,H*.87);c.lineTo(W,H*.87);c.stroke();c.restore();return true;
  }
  const T = p.tur;
  if (T && p.type === 'turret' && T.kind !== 'gun') {
    shadowBox(c, W, H, s, st.icon);
    const cx = W / 2, cy = T.kind === 'flame' ? H * .38 : H / 2, R = Math.min(W, H) * .44;
    c.save(); c.translate(cx, cy);
    if (T.kind === 'flame') { c.restore(); plate(c, s * .1, H * .55, W - s * .2, H * .42, '#5a4a3a', s); c.fillStyle = '#7a6a4a'; for (const x of [.3, .7]) { c.beginPath(); c.arc(W * x, H * .82, s * .14, 0, TAU); c.fill(); } c.save(); c.translate(cx, cy); }
    turretBase(c, R, col, s);
    const a = (st.aim ?? -Math.PI / 2) + Math.PI / 2; c.rotate(a);
    switch (T.kind) {
      case 'laser': {
        plate(c, -R * .55, -R * .55, R * 1.1, R * 1.1, '#b84a4a', s, .3);
        c.fillStyle = '#2a2e33'; rr(c, -s * .1, -R * 1.25, s * .2, R * .85, s * .05); c.fill();
        c.fillStyle = '#ff5a5a'; c.fillRect(-s * .04, -R * 1.2, s * .08, R * .6);
        glow(c, 0, -R * .1, R * .35, '255,90,90', st.working ? .9 : .4);
        if (st.flash) glow(c, 0, -R * 1.3, s * .4, '255,120,120');
        break;
      }
      case 'flame': {
        plate(c, -R * .5, -R * .45, R, R * .95, '#c8743a', s, .25);
        c.fillStyle = '#2b2e31'; rr(c, -s * .09, -R * 1.3, s * .18, R * .95, s * .05); c.fill(); c.fillStyle = '#5a5045'; c.fillRect(-s * .12, -R * 1.32, s * .24, s * .12);
        c.fillStyle = 'rgba(255,170,60,.8)'; c.beginPath(); c.arc(0, -R * 1.34, s * .05, 0, TAU); c.fill();
        if (st.flash) { glow(c, 0, -R * 1.6, s * .6, '255,140,40'); }
        break;
      }
      case 'rocket': {
        plate(c, -R * .62, -R * .5, R * 1.24, R * 1.05, '#8a9a4a', s, .15);
        for (const dx of [-.3, .3]) { c.fillStyle = '#3a4430'; rr(c, R * dx - s * .14, -R * 1.05, s * .28, R * .7, s * .06); c.fill(); for (const dy of [-.95, -.7]) { c.fillStyle = '#d8c84a'; c.beginPath(); c.arc(R * dx, R * dy, s * .07, 0, TAU); c.fill(); } }
        if (st.flash) glow(c, 0, -R * 1.2, s * .5, '255,200,120');
        break;
      }
      case 'tesla': {
        c.rotate(-a);
        plate(c, -R * .5, -R * .5, R, R, '#3a4a5a', s, .45);
        c.strokeStyle = '#c87a3a'; c.lineWidth = Math.max(1, s * .05); for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(0, -R * .1 + i * R * .08, R * .32, R * .1, 0, 0, TAU); c.stroke(); }
        c.fillStyle = '#c0d0e0'; c.beginPath(); c.arc(0, -R * .55, R * .28, 0, TAU); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.stroke();
        glow(c, 0, -R * .55, R * .5, '120,220,255', st.flash ? 1 : st.working ? .6 : .25);
        if (st.flash || st.working) { c.strokeStyle = 'rgba(200,240,255,.9)'; c.lineWidth = Math.max(1, s * .025); for (let i = 0; i < 3; i++) { const b = (st.t * .3 + i * 2.1) % TAU; c.beginPath(); c.moveTo(0, -R * .55); c.lineTo(Math.cos(b) * R * .3, -R * .55 + Math.sin(b) * R * .3); c.lineTo(Math.cos(b + .3) * R * .5, -R * .55 + Math.sin(b + .3) * R * .5); c.stroke(); } }
        break;
      }
      case 'mortar': {
        plate(c, -R * .55, -R * .45, R * 1.1, R, '#7a7a5a', s, .2);
        c.fillStyle = '#3a3a2e'; c.beginPath(); c.arc(0, -R * .1, R * .42, 0, TAU); c.fill();
        c.fillStyle = '#23231c'; rr(c, -s * .2, -R * 1.0, s * .4, R * .8, s * .12); c.fill(); c.fillStyle = '#0e0e0a'; c.beginPath(); c.arc(0, -R * .95, s * .14, 0, TAU); c.fill();
        if (st.flash) glow(c, 0, -R * 1.1, s * .6, '255,200,120');
        break;
      }
      case 'art': {
        plate(c, -R * .6, -R * .6, R * 1.2, R * 1.2, '#6a7060', s, .25);
        c.fillStyle = '#3e4338'; c.beginPath(); c.arc(0, 0, R * .5, 0, TAU); c.fill();
        c.fillStyle = '#2a2d26'; rr(c, -s * .16, -R * 1.45, s * .32, R * 1.35, s * .06); c.fill(); c.fillStyle = '#191b17'; c.fillRect(-s * .22, -R * 1.5, s * .44, s * .2);
        c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(-s * .05, -R * 1.3, s * .05, R * 1.0);
        if (st.flash) glow(c, 0, -R * 1.6, s * .9, '255,210,140');
        break;
      }
      case 'rail': {
        plate(c, -R * .6, -R * .55, R * 1.2, R * 1.1, '#4a6a9a', s, .2);
        for (const dx of [-1, 1]) { c.fillStyle = '#20324a'; c.fillRect(dx * s * .2 - s * .07, -R * 1.5, s * .14, R * 1.3); }
        c.fillStyle = '#7ab0d8'; for (let i = 0; i < 5; i++) c.fillRect(-s * .2, -R * (1.4 - i * .22), s * .4, s * .05);
        glow(c, 0, -R * .2, R * .45, '120,190,255', st.working ? .7 : .25);
        if (st.flash) glow(c, 0, -R * 1.55, s * .7, '170,220,255');
        break;
      }
    }
    c.restore(); return true;
  }
  if (p.type === 'gate') {
    shadowBox(c, W, H, s, st.icon);
    const base = pid === 'concrete-gate' ? '#9a9993' : pid === 'composite-gate' ? '#5a6a74' : pid === 'rail-gate' ? '#6a5a3a' : '#8a8172';
    // рама
    c.fillStyle = shade(base, -.35); rr(c, 0, 0, W, H, s * .05); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .04); c.stroke();
    const k = st.open ? .12 : 1; // створки разъезжаются
    for (const sd of [0, 1]) { const w = W * .46 * k; const x = sd ? W - s * .04 - w : s * .04; plate(c, x, s * .08, w, H - s * .16, pid === 'rail-gate' ? '#c8a83a' : base, s, .04); }
    if (pid === 'rail-gate' && !st.open) { c.fillStyle = '#1e1e1e'; for (let i = 0; i < 4; i++) c.fillRect(W * (.08 + i * .24), H * .44, W * .12, H * .12); }
    c.fillStyle = st.open ? '#4be36b' : '#e8503a'; c.beginPath(); c.arc(W / 2, s * .12, s * .06, 0, TAU); c.fill();
    return true;
  }
  if (pid === 'oil-generator' || pid === 'gas-turbine') {
    shadowBox(c, W, H, s, st.icon);
    const gas = pid === 'gas-turbine';
    plate(c, s * .08, s * .08, W - s * .16, H - s * .16, col, s, .12);
    if (gas) { // корпус турбины с кольцами и выхлопом
      c.fillStyle = '#3a3448'; rr(c, W * .2, H * .18, W * .6, H * .64, s * .3); c.fill();
      c.strokeStyle = 'rgba(200,180,255,.35)'; c.lineWidth = s * .05; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(W * .22, H * (.25 + i * .12)); c.lineTo(W * .78, H * (.25 + i * .12)); c.stroke(); }
      c.save(); c.translate(W / 2, H * .5); c.rotate(st.working ? st.t * .5 : 0); c.fillStyle = '#c0b0e0'; for (let i = 0; i < 6; i++) { c.rotate(TAU / 6); c.fillRect(-s * .04, 0, s * .08, s * .5); } c.restore();
      if (st.working) glow(c, W / 2, H * .5, s * .6, '200,150,255', .5);
    } else { // дизель: цилиндры и выхлопная труба
      for (let i = 0; i < 3; i++) { c.fillStyle = '#4a4033'; rr(c, W * (.18 + i * .22), H * .2, W * .16, H * .4, s * .06); c.fill(); c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(W * (.2 + i * .22), H * .22, W * .03, H * .34); }
      c.fillStyle = '#2a2420'; c.beginPath(); c.arc(W * .78, H * .72, s * .25, 0, TAU); c.fill();
      const pist = st.working ? Math.sin(st.t * .8) * s * .05 : 0; c.fillStyle = '#c8a050'; c.fillRect(W * .2, H * .64 + pist, W * .5, H * .08);
      if (st.working) glow(c, W * .78, H * .72, s * .3, '255,140,60', .6);
    }
    return true;
  }
  if (p.type === 'flare') {
    shadowBox(c, W, H, s, st.icon);
    plate(c, s * .15, s * .45, W - s * .3, H - s * .5, '#5a5a5a', s, .08);
    c.fillStyle = '#3a3a3a'; c.fillRect(W * .4, -s * .6, W * .2, s * 1.1); c.fillStyle = '#c8743a'; c.fillRect(W * .37, -s * .65, W * .26, s * .1);
    if (st.working || st.icon) { const f = st.t * .4; for (let i = 0; i < 5; i++) { const h = s * (.35 + ((Math.sin(f + i * 1.7) + 1) / 2) * .4); c.fillStyle = i % 2 ? 'rgba(255,220,90,.85)' : 'rgba(255,120,40,.8)'; c.beginPath(); c.moveTo(W * .38 + i * W * .06, -s * .62); c.quadraticCurveTo(W * .5, -s * .62 - h * 1.4, W * .62 - i * W * .03, -s * .62); c.fill(); } glow(c, W / 2, -s * .8, s * .6, '255,160,60', .6); }
    return true;
  }
  if (pid === 'small-tank' || pid === 'large-tank') {
    shadowBox(c, W, H, s, st.icon);
    const R = Math.min(W, H) * .46; c.save(); c.translate(W / 2, H / 2);
    const g = c.createRadialGradient(-R * .3, -R * .3, R * .1, 0, 0, R); g.addColorStop(0, '#d8dee4'); g.addColorStop(1, '#7a838c'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = Math.max(1, s * .05); c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.22)'; for (const k of [.75, .5]) { c.beginPath(); c.arc(0, 0, R * k, 0, TAU); c.stroke(); }
    if (pid === 'large-tank') { c.strokeStyle = 'rgba(0,0,0,.3)'; for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; c.beginPath(); c.moveTo(Math.cos(a) * R * .5, Math.sin(a) * R * .5); c.lineTo(Math.cos(a) * R, Math.sin(a) * R); c.stroke(); } c.fillStyle = '#5e666d'; rr(c, -R * .15, -R * .9, R * .3, R * 1.8, s * .05); c.globalAlpha = .4; c.fill(); c.globalAlpha = 1; }
    if (st.fill != null && !st.icon) { c.fillStyle = 'rgba(0,0,0,.5)'; rr(c, -R * .5, R * .12, R, R * .2, s * .05); c.fill(); c.fillStyle = st.fluidColor || '#3c8fd8'; rr(c, -R * .48, R * .14, R * .96 * st.fill, R * .16, s * .04); c.fill(); }
    c.restore(); return true;
  }
  return false;
}
/** иконки новых предметов (true — нарисовано) */
export function drawItemIcon2(c: C, id: string, s: number): boolean {
  const it = ITEMS[id]; if (!it) return false; const col = it.color;
  switch (it.icon) {
    case 'bioport':
      plate(c, s * .12, s * .12, s * .76, s * .76, '#506a60', s, .12);
      plate(c, s * .28, s * .28, s * .44, s * .44, '#30444a', s, .08);
      c.fillStyle = '#a3d2b4'; rr(c, s * .42, s * .37, s * .16, s * .26, s * .035); c.fill();
      c.strokeStyle = '#b8cfb3'; c.lineWidth = s * .035;
      for (const [x, y] of [[.22, .22], [.78, .22], [.22, .78], [.78, .78]]) { c.beginPath(); c.arc(s * x, s * y, s * .07, 0, TAU); c.stroke(); }
      return true;
    case 'bio-robot':
      c.save(); c.translate(s / 2, s / 2);
      c.strokeStyle = '#526a58'; c.lineWidth = s * .055;
      c.beginPath(); c.moveTo(-s * .21, s * .17); c.lineTo(-s * .29, s * .36); c.moveTo(s * .21, s * .17); c.lineTo(s * .29, s * .36); c.stroke();
      plate(c, -s * .31, -s * .25, s * .62, s * .5, '#8fbd79', s, .12);
      c.fillStyle = '#263d41'; rr(c, -s * .18, -s * .12, s * .36, s * .22, s * .06); c.fill();
      c.fillStyle = '#79eee0'; c.beginPath(); c.arc(-s * .08, -s * .02, s * .035, 0, TAU); c.arc(s * .08, -s * .02, s * .035, 0, TAU); c.fill();
      c.strokeStyle = '#c8dd9d'; c.lineWidth = s * .04; c.beginPath(); c.moveTo(0, -s * .25); c.lineTo(0, -s * .38); c.stroke();
      c.fillStyle = '#d2d79b'; c.beginPath(); c.arc(0, -s * .41, s * .045, 0, TAU); c.fill();
      c.restore(); return true;
    case 'shotgun': case 'rlauncher': case 'flamer': case 'lrifle':
      c.save(); c.translate(s * .12, s * .55); c.rotate(-.5); drawGun(c, id, s * 1.25, false); c.restore(); return true;
    case 'shell': for (let i = 0; i < 3; i++) { const x = s * (.22 + i * .2); c.fillStyle = col; rr(c, x, s * .3, s * .16, s * .42, s * .04); c.fill(); c.fillStyle = '#d8b04a'; c.fillRect(x, s * .62, s * .16, s * .1); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = s * .03; rr(c, x, s * .3, s * .16, s * .42, s * .04); c.stroke(); } return true;
    case 'rocket': c.save(); c.translate(s / 2, s / 2); c.rotate(-.8); c.fillStyle = '#c0c4c8'; rr(c, -s * .08, -s * .3, s * .16, s * .55, s * .05); c.fill(); c.fillStyle = col; c.beginPath(); c.moveTo(-s * .08, -s * .3); c.lineTo(0, -s * .45); c.lineTo(s * .08, -s * .3); c.fill(); c.fillStyle = '#5a5e62'; c.beginPath(); c.moveTo(-s * .08, s * .15); c.lineTo(-s * .18, s * .3); c.lineTo(s * .18, s * .3); c.lineTo(s * .08, s * .15); c.fill(); c.restore(); return true;
    case 'fcan': c.fillStyle = col; rr(c, s * .25, s * .22, s * .5, s * .62, s * .08); c.fill(); c.fillStyle = '#3a2a20'; c.fillRect(s * .4, s * .12, s * .2, s * .12); c.fillStyle = 'rgba(255,220,90,.9)'; c.beginPath(); c.moveTo(s * .5, s * .38); c.quadraticCurveTo(s * .62, s * .55, s * .5, s * .72); c.quadraticCurveTo(s * .38, s * .55, s * .5, s * .38); c.fill(); return true;
    case 'cell': c.fillStyle = '#2a3a4a'; rr(c, s * .28, s * .2, s * .44, s * .62, s * .08); c.fill(); glow(c, s / 2, s * .5, s * .3, '74,216,232'); c.fillStyle = '#9af0ff'; c.fillRect(s * .4, s * .3, s * .2, s * .42); c.fillStyle = '#7a8a9a'; c.fillRect(s * .4, s * .12, s * .2, s * .1); return true;
    case 'cshell': case 'ashell': { const big = it.icon === 'ashell'; c.fillStyle = col; rr(c, s * .32, s * (big ? .14 : .26), s * .36, s * (big ? .72 : .56), s * .06); c.fill(); c.fillStyle = shade(col, -.35); c.beginPath(); c.moveTo(s * .32, s * (big ? .3 : .38)); c.quadraticCurveTo(s * .5, s * (big ? 0 : .12), s * .68, s * (big ? .3 : .38)); c.fill(); c.fillStyle = '#c8a050'; c.fillRect(s * .32, s * .74, s * .36, s * .08); return true; }
    case 'dart': c.save(); c.translate(s / 2, s / 2); c.rotate(-.8); c.fillStyle = col; c.fillRect(-s * .05, -s * .4, s * .1, s * .8); c.fillStyle = '#e0f0ff'; c.beginPath(); c.moveTo(-s * .05, -s * .4); c.lineTo(0, -s * .48); c.lineTo(s * .05, -s * .4); c.fill(); c.restore(); return true;
    case 'armor': case 'marmor': {
      const g = c.createLinearGradient(0, s * .15, s, s * .85); g.addColorStop(0, shade(col, .35)); g.addColorStop(1, shade(col, -.35)); c.fillStyle = g;
      c.beginPath(); c.moveTo(s * .25, s * .15); c.lineTo(s * .4, s * .22); c.lineTo(s * .6, s * .22); c.lineTo(s * .75, s * .15); c.lineTo(s * .88, s * .35); c.lineTo(s * .75, s * .45); c.lineTo(s * .72, s * .85); c.lineTo(s * .28, s * .85); c.lineTo(s * .25, s * .45); c.lineTo(s * .12, s * .35); c.closePath(); c.fill(); c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = s * .04; c.stroke();
      if (it.icon === 'marmor') { c.strokeStyle = 'rgba(120,220,255,.85)'; c.lineWidth = s * .03; for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) c.strokeRect(s * (.33 + j * .18), s * (.35 + i * .15), s * .15, s * .12); }
      return true;
    }
    case 'eq': {
      const d = it.equip!; const w = d.w || 1, h = d.h || 1; const k = s * .8 / Math.max(w, h); const x0 = (s - w * k) / 2, y0 = (s - h * k) / 2;
      c.fillStyle = '#1e242a'; rr(c, x0, y0, w * k, h * k, s * .06); c.fill(); c.strokeStyle = shade(col, .3); c.lineWidth = s * .04; c.stroke();
      c.fillStyle = col; const cx = s / 2, cy = s / 2, r = Math.min(w, h) * k * .32;
      switch (d.kind) {
        case 'solar': c.fillStyle = '#2c4a7a'; c.fillRect(x0 + s * .05, y0 + s * .05, w * k - s * .1, h * k - s * .1); c.strokeStyle = '#8ab0e0'; c.lineWidth = s * .02; for (let i = 1; i < 3; i++) { c.beginPath(); c.moveTo(x0 + w * k * i / 3, y0); c.lineTo(x0 + w * k * i / 3, y0 + h * k); c.stroke(); } break;
        case 'reactor': glow(c, cx, cy, r * 1.4, '90,230,140'); c.fillStyle = '#c0ffd0'; c.beginPath(); c.arc(cx, cy, r * .5, 0, TAU); c.fill(); break;
        case 'battery': c.fillRect(cx - r * .6, cy - r * 1.2, r * 1.2, r * 2.4); c.fillStyle = '#e8e070'; c.fillRect(cx - r * .3, cy - r * 1.4, r * .6, r * .25); break;
        case 'shield': c.beginPath(); c.moveTo(cx, cy - r * 1.2); c.lineTo(cx + r, cy - r * .7); c.lineTo(cx + r * .8, cy + r * .5); c.lineTo(cx, cy + r * 1.2); c.lineTo(cx - r * .8, cy + r * .5); c.lineTo(cx - r, cy - r * .7); c.closePath(); c.fill(); glow(c, cx, cy, r, '150,200,255', .5); break;
        case 'laser': c.fillRect(cx - r * .2, cy - r * 1.2, r * .4, r * 1.6); glow(c, cx, cy - r * 1.1, r * .6, '255,90,90'); c.fillStyle = '#444'; c.beginPath(); c.arc(cx, cy + r * .5, r * .6, 0, TAU); c.fill(); break;
        case 'rocket': for (const dx of [-.5, .5]) { c.fillStyle = '#d8c84a'; c.fillRect(cx + dx * r - r * .2, cy - r, r * .4, r * 1.6); } break;
        case 'drones': for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; c.beginPath(); c.arc(cx + Math.cos(a) * r * .8, cy + Math.sin(a) * r * .8, r * .35, 0, TAU); c.fill(); } break;
        case 'exo': c.strokeStyle = col; c.lineWidth = s * .06; c.beginPath(); c.moveTo(cx - r * .4, cy - r * 1.5); c.lineTo(cx - r * .4, cy + r * 1.5); c.moveTo(cx + r * .4, cy - r * 1.5); c.lineTo(cx + r * .4, cy + r * 1.5); c.stroke(); for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(cx, cy + i * r, r * .25, 0, TAU); c.fill(); } break;
        case 'rad': { glow(c, cx, cy, r * 1.5, '230,230,60'); c.fillStyle = '#e8e03a'; for (let i = 0; i < 3; i++) { const a0 = i / 3 * TAU - TAU / 4 - .5; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r * 1.2, a0, a0 + 1.05); c.closePath(); c.fill(); } c.fillStyle = '#1e242a'; c.beginPath(); c.arc(cx, cy, r * .3, 0, TAU); c.fill(); break; }
        default: c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
      }
      if ((d.tier || 1) >= 2) { c.fillStyle = '#ffd04a'; c.font = `bold ${Math.round(s * .22)}px sans-serif`; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(d.tier === 3 ? 'III' : 'II', s * .92, s * .95); }
      return true;
    }
    case 'gate': drawEntityArt2(c, it.place || 'gate', s, s, s, 0, { t: 0, icon: true }); return true;
    case 'explosives': for (let i = 0; i < 3; i++) { c.fillStyle = col; rr(c, s * (.2 + i * .22), s * .3, s * .18, s * .5, s * .04); c.fill(); } c.strokeStyle = '#222'; c.lineWidth = s * .04; c.beginPath(); c.moveTo(s * .5, s * .3); c.quadraticCurveTo(s * .6, s * .12, s * .78, s * .15); c.stroke(); c.fillStyle = '#ffd04a'; c.beginPath(); c.arc(s * .8, s * .14, s * .05, 0, TAU); c.fill(); return true;
    case 'landfill': c.fillStyle = '#3a6aa8'; c.fillRect(s * .1, s * .55, s * .8, s * .3); c.fillStyle = col; c.beginPath(); c.moveTo(s * .1, s * .7); c.quadraticCurveTo(s * .5, s * .15, s * .9, s * .7); c.fill(); c.fillStyle = 'rgba(0,0,0,.15)'; for (let i = 0; i < 8; i++) c.fillRect(s * (.25 + (i * 37 % 50) / 100), s * (.4 + (i * 23 % 25) / 100), s * .04, s * .04); return true;
    case 'tilei': { c.fillStyle = col; rr(c, s * .12, s * .12, s * .76, s * .76, s * .06); c.fill(); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = s * .03; c.stroke();
      if (id === 'hazard-concrete') { c.save(); rr(c, s * .12, s * .12, s * .76, s * .76, s * .06); c.clip(); c.fillStyle = '#222'; for (let i = -2; i < 6; i++) { c.beginPath(); c.moveTo(s * (i * .25), s); c.lineTo(s * (i * .25 + .12), s); c.lineTo(s * (i * .25 + .62), 0); c.lineTo(s * (i * .25 + .5), 0); c.fill(); } c.restore(); }
      else if (id === 'white-tile' || id === 'paving-stone') { c.beginPath(); c.moveTo(s * .5, s * .12); c.lineTo(s * .5, s * .88); c.moveTo(s * .12, s * .5); c.lineTo(s * .88, s * .5); c.stroke(); }
      else if (id === 'metal-deck') { c.strokeStyle = 'rgba(255,255,255,.3)'; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { c.beginPath(); c.moveTo(s * (.22 + i * .25), s * (.25 + j * .25)); c.lineTo(s * (.32 + i * .25), s * (.2 + j * .25)); c.stroke(); } }
      return true; }
    case 'flare': drawEntityArt2(c, 'flare-stack', s * .6, s * .6, s * .6, 0, { t: 10, icon: true, working: true }); return true;
  }
  return false;
}
/** v1.14: плитка покрытия для новых видов (null — старый рисунок) */
export function floorPattern(c: C, id: string, z: number, col: string): boolean {
  const L = Math.max(1, z / 32);
  switch (id) {
    case 'white-tile': c.strokeStyle = 'rgba(80,80,80,.35)'; c.lineWidth = L; for (const k of [0, .5]) { c.beginPath(); c.moveTo(0, z * k + .5); c.lineTo(z, z * k + .5); c.moveTo(z * k + .5, 0); c.lineTo(z * k + .5, z); c.stroke(); } c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(L, L, z / 2 - 2 * L, L); c.fillRect(z / 2 + L, z / 2 + L, z / 2 - 2 * L, L); return true;
    case 'hazard-concrete': c.fillStyle = '#2a2a2a'; for (let i = -2; i < 4; i++) { c.beginPath(); c.moveTo(z * (i * .5), z); c.lineTo(z * (i * .5 + .25), z); c.lineTo(z * (i * .5 + 1.25), 0); c.lineTo(z * (i * .5 + 1), 0); c.fill(); } c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = L; c.strokeRect(.5, .5, z - 1, z - 1); return true;
    case 'metal-deck': { c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = L * 1.5; const n = 4; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = (i + .5) * z / n, y = (j + .5) * z / n, d = z / n * .25; c.beginPath(); if ((i + j) % 2) { c.moveTo(x - d, y - d); c.lineTo(x + d, y + d); } else { c.moveTo(x - d, y + d); c.lineTo(x + d, y - d); } c.stroke(); } c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = L; c.strokeRect(.5, .5, z - 1, z - 1); return true; }
    case 'paving-stone': { let h = 99; const rnd = () => (h = (h * 16807) % 2147483647) / 2147483647; c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(0, 0, z, z); for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { c.fillStyle = shade(col, (rnd() - .5) * .25); c.beginPath(); c.roundRect(i * z / 3 + L, j * z / 3 + L, z / 3 - 2 * L, z / 3 - 2 * L, z / 12); c.fill(); } return true; }
    case 'red-concrete': case 'blue-concrete': case 'green-concrete': { let h = 7; const rnd = () => (h = (h * 16807) % 2147483647) / 2147483647; for (let i = 0; i < z * z / 24; i++) { c.fillStyle = rnd() < .5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.07)'; c.fillRect(rnd() * z, rnd() * z, Math.max(1, z / 40), Math.max(1, z / 40)); } c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = L; c.strokeRect(.5, .5, z - 1, z - 1); return true; }
  }
  return false;
}

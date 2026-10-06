// E2E: WebGL2-рендер среднего слоя и Canvas2D-атлас против прежнего векторного рендера:
// одинаковая картинка (попиксельное сравнение) и время кадра на большой базе.
import { chromium } from 'playwright';
import fs from 'fs';
const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'] });
const errs = []; let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto('file:///data/game/dist/index.html?local=1');
await p.waitForFunction(() => window.__texMs != null && window.__zavod, null, { timeout: 180000 }); await p.waitForTimeout(300);
const info = await p.evaluate(() => { const z = window.__zavod; z.ui.h.newGame(11, 'none'); z.ui.close(); const g = z.game; g.sat = () => 1;
  const X = Math.floor(g.player.x) - 50, Y = Math.floor(g.player.y) - 28;
  for (let y = Y - 2; y < Y + 60; y++) for (let x = X - 2; x < X + 104; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  for (let r = 0; r < 14; r++) { const y = Y + r * 4;
    for (let x = X; x < X + 100; x++) g.build('transport-belt', x, y, 1, false);
    for (let i = 0; i < 25; i++) { const f = g.build(r % 2 ? 'assembling-machine-2' : 'stone-furnace', X + i * 4, y + 2, 0, false); if (f) { if (r % 2) { g.setRecipe?.(f, 'iron-gear-wheel'); f.recipe = 'iron-gear-wheel'; } else { g.insertItem(f, 'iron-ore', 50, false); g.insertItem(f, 'coal', 50, false); } }
      g.build('inserter', X + i * 4 + 2, y + 1, 0, false); }
  }
  for (const e of g.ents.values()) if (e.lanes) for (const sg of e.lanes) for (const L of sg) for (let k = 0; k < 3; k++) L.push({ item: k % 2 ? 'iron-plate' : 'copper-plate', pos: 40 + k * 70 });
  for (let i = 0; i < 120; i++) g.step();
  return { ents: g.ents.size }; });
console.log('    постройки:', info.ents);
await p.keyboard.press('Pause'); await p.waitForTimeout(100);
const shoot = async (mode, zoom) => p.evaluate(async ([mode, zoom]) => { const z = window.__zavod; const got = z.R.setMode(mode); z.view.zoom = zoom; z.view.noNight = true; z.view.smoke = false;
  const g = z.game; const px = g.player.x, py = g.player.y;
  for (let i = 0; i < 40; i++) z.R.draw(g, z.view, px, py); // прогрев атласа
  const flush = () => { z.R.mainCtx.getImageData(0, 0, 1, 1); if (z.R.topCtx) z.R.topCtx.getImageData(0, 0, 1, 1); const gl = z.R.batch && z.R.batch.gl; if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
  flush(); const N = 20, t0 = performance.now(); for (let i = 0; i < N; i++) { z.R.draw(g, z.view, px, py); flush(); } const ms = (performance.now() - t0) / N;
  z.R.skip = 3; flush(); const t1 = performance.now(); for (let i = 0; i < N; i++) { z.R.draw(g, z.view, px, py); flush(); } const midMs = (performance.now() - t1) / N; z.R.skip = 0;
  // композиция слоёв в один холст для сравнения
  const W = z.R.W, H = z.R.H, out = document.createElement('canvas'); out.width = W; out.height = H; const c = out.getContext('2d');
  z.R.draw(g, z.view, px, py); c.drawImage(z.R.canvas, 0, 0); if (z.R.glCanvas) { c.drawImage(z.R.glCanvas, 0, 0); c.drawImage(z.R.topCanvas, 0, 0); }
  const d = c.getImageData(0, 0, W, H).data; return { got, ms, midMs, mid: z.R.stat.mid, quads: z.R.stat.quads, W, H, png: out.toDataURL('image/png'), px: (() => { const B = 4, bw = Math.floor(W / B), bh = Math.floor(H / B), o = []; for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) { let r = 0, gg = 0, bb = 0; for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { const i = ((by * B + y) * W + bx * B + x) * 4; r += d[i]; gg += d[i + 1]; bb += d[i + 2]; } o.push(r / 16, gg / 16, bb / 16); } return o; })() };
}, [mode, zoom]);
const res = {};
for (const zoom of [1, 0.5]) for (const mode of ['legacy', 'canvas', 'webgl']) {
  const r = await shoot(mode, zoom); res[mode + zoom] = r;
  fs.writeFileSync(`shots/r-${mode}-${zoom}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`    ${mode.padEnd(6)} zoom ${zoom}: кадр ${r.ms.toFixed(1)} мс, только средний слой ${r.midMs.toFixed(1)} мс (JS ${r.mid.toFixed(1)} мс, спрайтов ${r.quads}), режим ${r.got}`);
}
const diff = (a, c) => { let n = 0, big = 0; for (let i = 0; i < a.length; i += 3) { const d = Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]); n++; if (d > 45) big++; } return big / n; };
for (const zoom of [1, 0.5]) {
  const L = res['legacy' + zoom].px; const dc = diff(L, res['canvas' + zoom].px), dg = diff(L, res['webgl' + zoom].px);
  ok(res['webgl' + zoom].got === 'webgl', `zoom ${zoom}: WebGL2 включён`);
  const dgc = diff(res['canvas' + zoom].px, res['webgl' + zoom].px);
  ok(dgc < 0.02, `zoom ${zoom}: WebGL2 и Canvas2D-атлас дают одну картинку (различаются ${(dgc * 100).toFixed(2)}% блоков 4×4)`);
  ok(dc < 0.1 && dg < 0.1, `zoom ${zoom}: атлас близок к векторному рендеру: Canvas2D ${(dc * 100).toFixed(2)}%, WebGL2 ${(dg * 100).toFixed(2)}% блоков 4×4 (разница в основном от текстуры металла: 2 варианта на тип вместо своего у каждой постройки)`);
  ok(res['webgl' + zoom].midMs < res['legacy' + zoom].midMs, `zoom ${zoom}: средний слой WebGL2 быстрее векторного: ${res['webgl' + zoom].midMs.toFixed(1)} против ${res['legacy' + zoom].midMs.toFixed(1)} мс`);
}
await b.close();
ok(errs.length === 0, 'ошибок нет' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'ВСЁ ОК'); process.exit(fails ? 1 : 0);

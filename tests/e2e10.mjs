// E2E: упакованные снимки Worker → главный поток (Transferable) против прежних «целиком»; WebGL2 в режиме Worker.
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';
const b = await launchBrowser(selectedBrowser(), { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errs = []; let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✘ ') + m); if (!c) fails++; };
const p = await b.newPage({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto(appUrl(import.meta.url));
await p.waitForFunction(() => window.__zavod && window.__zavod.R, null, { timeout: 180000 });
const auto = await p.evaluate(() => ({ mode: window.__zavod.R.mode, note: window.__zavod.R.modeNote, gpu: window.__zavod.R.gpuNote() }));
const softwareFallback = auto.mode === 'canvas' && (auto.note === 'soft' || auto.note === 'nogl');
const activeWebgl = auto.mode === 'webgl' && auto.note === '' && !/software|программный/i.test(auto.gpu);
const autoOk = selectedBrowser() === 'chromium' ? softwareFallback : softwareFallback || activeWebgl;
ok(autoOk, 'авто: программный GL/без WebGL → Canvas2D; для активного WebGL сохраняется WebGL2 ' + JSON.stringify(auto));
// Wait for a real Worker snapshot before same-page navigation. Firefox 1538 can crash the tab if it
// navigates while the app's initial Worker is still compiling; the snapshot count is the ready signal.
await p.waitForFunction(() => window.__zavod && window.__zavod.sim && window.__zavod.sim.snaps > 3, null, { timeout: 180000 });
await p.goto(appUrl(import.meta.url, '?render=webgl'));
await p.waitForFunction(() => window.__texMs != null && window.__zavod && window.__zavod.sim && window.__zavod.sim.snaps > 3, null, { timeout: 180000 });
await p.evaluate(() => { const z = window.__zavod; z.ui.h.newGame(11, 'none'); z.ui.close(); z.view.zoom = 0.5; });
await p.waitForTimeout(600);
const n = await p.evaluate(() => window.__zavod.workerEval(`g.sat = () => 1; const freeArea = (w, h) => { const px = Math.floor(g.player.x), py = Math.floor(g.player.y); for (let r = 0; r <= 600; r += 12) for (let dy = -r; dy <= r; dy += 12) for (let dx = -r; dx <= r; dx += 12) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const bx = px + dx - (w >> 1), by = py + dy - (h >> 1); let ok = true; for (let y = by; y < by + h && ok; y++) for (let x = bx; x < bx + w && ok; x++) if (g.world.terrain(x, y) >= 3 || g.world.occ(x, y) >= 0 || g.world.res(x, y)) ok = false; if (ok) return [bx, by]; } return null; }; /* 1.16: новая генерация карты ставит воду и руду рядом со стартом — сцена строится на свободном участке */ const fa = freeArea(108, 62); if (fa) { g.player.x = fa[0] + 52; g.player.y = fa[1] + 30; } const X = Math.floor(g.player.x) - 50, Y = Math.floor(g.player.y) - 28;
  for (let y = Y - 2; y < Y + 60; y++) for (let x = X - 2; x < X + 104; x++) if (g.world.decor(x, y)) g.world.removeDecor(x, y);
  for (let r = 0; r < 14; r++) { const y = Y + r * 4; for (let x = X; x < X + 100; x++) g.build('transport-belt', x, y, 1, false);
    for (let i = 0; i < 25; i++) { const f = g.build(r % 2 ? 'assembling-machine-2' : 'stone-furnace', X + i * 4, y + 2, 0, false); if (f && !(r % 2)) { g.insertItem(f, 'iron-ore', 50, false); g.insertItem(f, 'coal', 50, false); } g.build('inserter', X + i * 4 + 2, y + 1, 0, false); } }
  for (const e of g.ents.values()) if (e.lanes) for (const sg of e.lanes) for (const L of sg) for (let k = 0; k < 3; k++) L.push({ item: k % 2 ? 'iron-plate' : 'copper-plate', pos: 40 + k * 70 });
  return g.ents.size;`));
console.log('    построек в Worker:', n);
const measure = async (nopack) => p.evaluate(async (nopack) => { const z = window.__zavod, s = z.sim; s.nopack = nopack; await new Promise(r => setTimeout(r, 1500));
  const acc = { post: 0, clone: 0, recv: 0, snap: 0, apply: 0, full: 0, dyn: 0, items: 0, k: 0 }; const s0 = s.snaps; let frames = 0, run = true; const loop = () => { frames++; if (run) requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  const end = performance.now() + 3000; while (performance.now() < end) { await new Promise(r => setTimeout(r, 50)); acc.snap += s.snapMs; acc.apply += s.applyMs; acc.post += s.postMs; acc.clone += s.cloneMs; acc.recv += s.recvMs; acc.full += s.nFull; acc.dyn += s.nDyn; acc.items += s.nItems; acc.k++; }
  run = false; for (const k of ['post', 'clone', 'recv', 'snap', 'apply', 'full', 'dyn', 'items']) acc[k] /= acc.k; return { ...acc, snaps: (s.snaps - s0) / 3, frames: frames / 3, ups: s.ups, mode: z.R.mode }; }, nopack);
const old = await measure(true), neu = await measure(false);
const f = r => `Worker: сборка ${r.snap.toFixed(2)} + отправка ${r.post.toFixed(2)} мс; главный поток: распаковка ${r.clone.toFixed(2)} + применение ${r.apply.toFixed(2)} = ${r.recv.toFixed(2)} мс; целиком ${r.full.toFixed(0)}, кратко ${r.dyn.toFixed(0)}, предметов ${r.items.toFixed(0)}, снимков/с ${r.snaps.toFixed(0)}, FPS ${r.frames.toFixed(0)}, UPS ${r.ups.toFixed(0)}`;
console.log('    целиком (rc1): ' + f(old)); console.log('    упаковано:     ' + f(neu));
ok(neu.mode === 'webgl', 'в режиме Worker рендер — WebGL2');
ok(neu.full < old.full / 10 && neu.dyn > 500, 'видимые постройки идут в упакованном буфере, целиком — только изменённые');
ok(neu.recv < old.recv, `приём снимка в главном потоке быстрее: ${neu.recv.toFixed(2)} против ${old.recv.toFixed(2)} мс`);
ok(neu.snap + neu.post < old.snap + old.post, `Worker тратит на снимок меньше: ${(neu.snap + neu.post).toFixed(2)} против ${(old.snap + old.post).toFixed(2)} мс`);
ok(neu.items > 5000, 'предметы на конвейерах приходят буфером: ' + neu.items.toFixed(0));
// предметы двигаются, манипуляторы работают
const mv = await p.evaluate(async () => { const s = window.__zavod.sim; const a = s.beltItems.data.slice(); await new Promise(r => setTimeout(r, 500)); const b2 = s.beltItems.data; let d = 0; for (let i = 0; i < Math.min(a.length, b2.length); i++) d += Math.abs(a[i] - b2[i]); 
  let ins = 0, moving = 0; for (const e of window.__zavod.game.ents.values()) { if (e.t === 'inserter' && e.ist) ins++; if (e.t === 'belt' && e.moving) moving++; } return { d, ins, moving }; });
ok(mv.d > 0.1 && mv.moving > 100, 'предметы на конвейерах движутся в зеркале ' + JSON.stringify(mv));
await p.screenshot({ path: 'shots/m11-worker-webgl.png' });
await b.close();
ok(errs.length === 0, 'ошибок нет' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
console.log(fails ? `ПРОВАЛОВ: ${fails}` : 'ВСЁ ОК'); process.exit(fails ? 1 : 0);

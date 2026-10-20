// v1.16 rail UI: real pointer drags, four parallel tracks, Escape/blur cancel, and no-cost guarantees.
import { launchBrowser, appUrl, projectRoot } from './browser.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const name = process.env.PW_BROWSER || process.argv[2] || 'chromium';
// A real tab focus transition is part of this journey; headless tabs do not
// reliably deliver window blur. Do not replace it with a synthetic event.
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function portReady(port, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Chromium remote debugging port ${port} did not become ready`);
}
const debugPort = name === 'chromium' ? await freePort() : null;
const b = await launchBrowser(name, { headless: false, ...(name === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', `--remote-debugging-port=${debugPort}`] } : {}) });
let connectedBrowser = null;
let context;
if (name === 'chromium') {
  await portReady(debugPort);
  connectedBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { noDefaults: true, timeout: 10000 });
  context = connectedBrowser.contexts()[0];
} else context = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
const p = await context.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
const errors = [];
let fails = 0;
const ok = (condition, label) => { console.log((condition ? '  ✔ ' : '  ✘ ') + label); if (!condition) fails++; };
p.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error' && !/WebGL|GPU stall|swiftshader|GL_|Software WebGL/i.test(m.text())) errors.push('CONSOLE ' + m.text().slice(0, 300)); });
fs.mkdirSync(path.join(projectRoot(import.meta.url), 'shots'), { recursive: true });

await p.goto(appUrl(import.meta.url, '?render=webgl&gfx=low'));
await p.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 180000 });
await p.evaluate(() => { const z = window.__zavod; z.ui.close(); z.ui.h.newGame(716, 'none'); });
await p.waitForFunction(() => window.__zavod && window.__zavod.sim.snaps > 2, null, { timeout: 30000 });
const scene = await p.evaluate(() => window.__zavod.workerEval(`
  const land = (w, h) => { for (let r = 0; r < 400; r += 3) for (let a = 0; a < 24; a++) {
    const bx = Math.floor(g.player.x + Math.cos(a / 24 * 6.283) * r), by = Math.floor(g.player.y + Math.sin(a / 24 * 6.283) * r);
    let ok = true; for (let ty = by; ty < by + h && ok; ty++) for (let tx = bx; tx < bx + w && ok; tx++) if (g.world.terrain(tx, ty) >= 3 || g.world.occ(tx, ty) >= 0 || g.world.res(tx, ty)) ok = false;
    if (ok) { for (let ty = by; ty < by + h; ty++) for (let tx = bx; tx < bx + w; tx++) if (g.world.decor(tx, ty)) g.world.removeDecor(tx, ty); return { x: bx, y: by }; }
  } return null; };
  const A = land(96, 40); if (!A) return null;
  const X = (A.x + 8) & ~1, Y = (A.y + 12) & ~1;
  g.research.done.add('railway'); g.player.x = X + 30; g.player.y = Y + 18;
  g.inv.add('straight-rail', 1000);
  return { X, Y, seed: g.seed, rails: [...g.ents.values()].filter(e => e.t === 'rail').length, stock: g.inv.count('straight-rail') };
`));
ok(!!scene && scene.rails === 0 && scene.stock === 1000, `пустая площадка для pointer-сценария (${JSON.stringify(scene)})`);
// Use two owned headful targets with Playwright's focus emulation disabled.
// The CDP-attached Chromium default context uses noDefaults:true, unlike the
// Playwright-launched context that forces focus emulation on each page.
const other = await context.newPage();
await other.setViewportSize({ width: 900, height: 600 });
await other.goto('about:blank');
await p.bringToFront();
await p.waitForFunction(() => document.hasFocus() && document.visibilityState === 'visible', null, { timeout: 10000 });
const initialFocus = await Promise.all([p.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState })),
  other.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }))]);
ok(initialFocus[0].focused && !initialFocus[1].focused, `real app window focus is exclusive before drag (${JSON.stringify(initialFocus)})`);
await p.evaluate(() => {
  window.__zavod.ui.close(); window.__zavod.view.zoom = 0.7; window.__zavod.view.cursor = 'straight-rail';
  window.__railBlurSeen = false; window.__railBlurTrusted = false;
  window.addEventListener('blur', event => { window.__railBlurSeen = true; window.__railBlurTrusted = event.isTrusted; }, { once: true });
});
await other.evaluate(() => {
  window.__railFocusSeen = false; window.__railFocusTrusted = false;
  window.addEventListener('focus', event => { window.__railFocusSeen = true; window.__railFocusTrusted = event.isTrusted; }, { once: true });
});
await p.waitForFunction(([x, y]) => { const R = window.__zavod.R; return Math.abs(R.camX - x) < 0.1 && Math.abs(R.camY - y) < 0.1; }, [scene.X + 30, scene.Y + 18], { timeout: 15000 });
const W = (code) => p.evaluate(c => window.__zavod.workerEval(c), code);
const pixel = (x, y) => p.evaluate(([x, y]) => { const R = window.__zavod.R, d = R.pixelRatio(); return { x: ((x - R.camX) * R.s + R.W / 2) / d, y: ((y - R.camY) * R.s + R.H / 2) / d }; }, [x, y]);
const at = async (x, y) => { const q = await pixel(x, y); await p.mouse.move(q.x, q.y, { steps: 4 }); await p.waitForTimeout(80); };
const state = () => W(`return { rails: [...g.ents.values()].filter(e => e.t === 'rail').length, stock: g.inv.count('straight-rail') };`);
const beginDrag = async (x1, y1, x2, y2) => { await at(x1, y1); await p.mouse.down(); await at(x2, y2); await p.waitForTimeout(250); };
const startX = scene.X + 24, endX = scene.X + 36, centerY = scene.Y + 18;

console.log('1. Cancel Escape: pointer preview closes without rail/inventory changes');
const beforeEscape = await state();
await beginDrag(scene.X + 22, scene.Y + 8, scene.X + 30, scene.Y + 8);
const escapePreview = await p.evaluate(() => { const q = window.__zavod.view.railPlan; return q && { tracks: Number(q.label?.match(/^(\d+) /)?.[1]), pieces: q.pieces.length }; });
ok(escapePreview?.tracks === 1 && escapePreview.pieces > 0, `предпросмотр до Escape: ${JSON.stringify(escapePreview)}`);
await p.keyboard.press('Escape'); await p.mouse.up(); await p.waitForTimeout(250);
const afterEscape = await state();
ok(afterEscape.rails === beforeEscape.rails && afterEscape.stock === beforeEscape.stock && await p.evaluate(() => !window.__zavod.view.railPlan), 'Escape отменил drag без укладки и списания рельсов');

console.log('2. Cancel blur: потеря фокуса закрывает preview без railPath command');
const beforeBlur = await state();
await beginDrag(scene.X + 22, scene.Y + 28, scene.X + 30, scene.Y + 28);
const blurPreview = await p.evaluate(() => !!window.__zavod.view.railPlan?.pieces.length);
await other.bringToFront();
await p.waitForFunction(() => window.__railBlurSeen && !document.hasFocus(), null, { timeout: 5000 }).catch(() => {});
await other.waitForFunction(() => window.__railFocusSeen && document.hasFocus(), null, { timeout: 5000 }).catch(() => {});
const focusState = await Promise.all([p.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState,
    blurSeen: window.__railBlurSeen, blurTrusted: window.__railBlurTrusted })),
  other.evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState,
    focusSeen: window.__railFocusSeen, focusTrusted: window.__railFocusTrusted }))]);
console.log(`  · focus probe [app, other]: ${JSON.stringify(focusState)}`);
await p.bringToFront();
await p.waitForFunction(() => document.hasFocus() && !window.__zavod.view.railPlan, null, { timeout: 5000 });
const blurHandled = await p.evaluate(() => ({ seen: window.__railBlurSeen, trusted: window.__railBlurTrusted, preview: !!window.__zavod.view.railPlan }));
await p.mouse.up(); await other.close(); await p.waitForTimeout(250);
const afterBlur = await state();
ok(blurPreview && blurHandled.seen && blurHandled.trusted && !blurHandled.preview &&
  !focusState[0].focused && focusState[1].focused && focusState[1].focusSeen && focusState[1].focusTrusted,
  `trusted window blur/focus transition canceled the preview (${JSON.stringify({ blurHandled, focusState })})`);
ok(afterBlur.rails === beforeBlur.rails && afterBlur.stock === beforeBlur.stock, 'blur отменил drag без укладки и списания рельсов');

console.log('3. Four-track drag: pointer selects 4 lanes and commits all tracks');
const beforeCommit = await state();
await beginDrag(startX, centerY, endX, centerY);
await p.keyboard.press('4'); await p.waitForTimeout(250);
const plan = await p.evaluate(() => { const q = window.__zavod.view.railPlan; return q && { tracks: Number(q.label?.match(/^(\d+) /)?.[1]), lanes: q.lanes.length, pieces: q.pieces.filter(x => !x.have).length, blocked: q.pieces.filter(x => !x.valid).length, exact: q.ok, rows: [...new Set(q.pieces.map(x => x.y))].sort((a, b) => a - b) }; });
ok(plan?.tracks === 4 && plan.lanes === 4 && plan.pieces > 0 && plan.blocked === 0 && plan.exact, `4 полосы и точный preview: ${JSON.stringify(plan)}`);
await p.screenshot({ path: path.join(projectRoot(import.meta.url), 'shots', `e2e-rail-v116-${name}-four-track-preview.png`) });
await p.mouse.up();
let committed;
try {
  // Poll the synchronous Worker mirror, then read authoritative inventory.
  // An async predicate returns a truthy Promise before the Worker has replied.
  await p.waitForFunction(({ rails, add }) => [...window.__zavod.game.ents.values()].filter(e => e.t === 'rail').length >= rails + add,
    { rails: beforeCommit.rails, add: plan?.pieces || 1 }, { timeout: 10000 });
  committed = await state();
} catch { committed = await state(); }
const finalRails = await W(`const a=[...g.ents.values()].filter(e=>e.t==='rail'); return { rows:[...new Set(a.map(e=>e.y))].sort((x,y)=>x-y), dirs:[...new Set(a.map(e=>e.dir))], n:a.length };`);
ok(plan && committed.rails === beforeCommit.rails + plan.pieces, `Worker уложил все ${plan?.pieces} запланированных сегментов (${committed.rails - beforeCommit.rails})`);
ok(committed.stock === beforeCommit.stock - (plan?.pieces || 0), `инвентарь уменьшился ровно на число построенных сегментов (${beforeCommit.stock} → ${committed.stock})`);
ok(finalRails.rows.length === 4 && finalRails.dirs.length === 1, `в мире четыре параллельных пути (${JSON.stringify(finalRails)})`);

console.log('4. Worker-backed 2+8+2 shuttle completes a round trip and keeps the consist ordered');
await p.evaluate(() => { const z = window.__zavod; z.ui.close(); z.ui.h.newGame(117, 'none'); });
await p.waitForFunction(() => window.__zavod && window.__zavod.sim.snaps > 2, null, { timeout: 30000 });
await p.evaluate(async () => { const z = window.__zavod; z.sim.post({ t: 'pause', paused: true }); await z.workerEval('return g.tick'); });
const shuttle = await W(`
  const X0 = 100, Y = 100;
  g.world.terrain = () => 0; g.world.decor = () => 0; g.world.res = () => 0; g.world.walkable = () => true; g.sat = () => 1;
  for (const tech of ['railway', 'automated-rail-transportation', 'rail-signals']) g.research.done.add(tech);
  for (let x = X0; x < X0 + 260; x += 2) if (!g.build('straight-rail', x, Y - 1, 2, false)) return { error: 'rail ' + x };
  const west = g.build('train-stop', X0 + 4, Y - 3, 3, false), east = g.build('train-stop', X0 + 258, Y + 1, 1, false);
  if (!west || !east) return { error: 'terminal placement' };
  g.apply({ t: 'stopName', id: west.id, name: 'West terminal' }); g.apply({ t: 'stopName', id: east.id, name: 'East terminal' });
  g.inv.add('locomotive', 4); g.inv.add('cargo-wagon', 8);
  const specs = ['locomotive', 'locomotive', ...Array(8).fill('cargo-wagon'), 'locomotive', 'locomotive'];
  const carLen = p => p === 'locomotive' ? 7 : 6; let x = X0 + 230, prev = null; const ids = [];
  for (let i = 0; i < specs.length; i++) {
    const proto = specs[i]; if (prev) x -= (carLen(prev) + carLen(proto)) / 2 + 0.5;
    const rail = [...g.ents.values()].find(e => e.t === 'rail' && x >= e.x && x < e.x + e.w);
    if (!rail) return { error: 'rail under car ' + i + ' at ' + x };
    g.player.x = x; g.player.y = Y + 3; const id = g.nextId;
    g.apply({ t: 'placeCar', proto, rail: rail.id, x, y: Y, back: i >= 10 });
    const car = g.ents.get(id); if (!car) return { error: 'car placement ' + i + ' at ' + x };
    if (car.t === 'loco') car.fuel = { item: 'coal', count: 100 };
    if (car.t === 'wagon') car.inv.add('iron-plate', 25);
    ids.push(id); prev = proto;
  }
  const train = g.trains[0]; if (!train || train.cars.length !== 12) return { error: 'consist ' + (train?.cars.length || 0) };
  g.enqueue({ t: 'sched', id: ids[0], sched: [{ st: 'East terminal', c: 'time', n: 1 }, { st: 'West terminal', c: 'time', n: 1 }] });
  g.enqueue({ t: 'tmode', id: ids[0], auto: true }); g.step();
  let ticks = 0; while (ticks < 12000 && !(train.laps >= 1 && train.st === 'wait')) { g.step(); ticks++; }
  const types = train.cars.map(id => g.ents.get(id)?.proto || 'missing');
  const cargo = train.cars.reduce((n, id) => n + (g.ents.get(id)?.inv?.count('iron-plate') || 0), 0);
  return { ticks, done: train.laps >= 1 && train.st === 'wait', laps: train.laps || 0, st: train.st, si: train.si,
    n: train.cars.length, types, front: types.slice(0, 2), rear: types.slice(-2), cargo, allPresent: train.cars.every(id => g.ents.has(id)) };
`);
ok(!shuttle?.error && shuttle.done, `автопоезд проходит оба терминала и возвращается (${JSON.stringify(shuttle)})`);
ok(shuttle?.n === 12 && shuttle.front.every(t => t === 'locomotive') && shuttle.rear.every(t => t === 'locomotive') && shuttle.types.filter(t => t === 'cargo-wagon').length === 8,
  `2+8+2 порядок состава сохранён после разворота (${shuttle?.types.join(' → ')})`);
ok(shuttle?.cargo === 200 && shuttle.allPresent, `груз и все 12 вагонов сохранены после рейса (${shuttle?.cargo} ед.)`);
await p.screenshot({ path: path.join(projectRoot(import.meta.url), 'shots', `e2e-rail-v116-${name}-shuttle.png`) });
ok(errors.length === 0, 'нет ошибок страницы' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
await connectedBrowser?.close();
await b.close();
console.log(fails ? `ПРОВАЛОВ: ${fails}` : `${name}: все проверки прошли`);
process.exit(fails ? 1 : 0);

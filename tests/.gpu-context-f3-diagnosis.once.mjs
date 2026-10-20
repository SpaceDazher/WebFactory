// v1.16 WebGL loss and restore journey. Run after `npm run build:dev` with
// `node tests/gpu-context-v116.mjs`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightEntry = process.env.UI_V116_PLAYWRIGHT
  ? pathToFileURL(path.join(process.env.UI_V116_PLAYWRIGHT, 'index.mjs')).href
  : 'playwright';
const { chromium } = await import(playwrightEntry);
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const shots = path.join(ROOT, 'docs', 'evidence', 'gpu-context-v116', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

async function openApp(lang) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'en' ? 'en-US' : 'ru-RU' });
  await context.addInitScript(({ lang }) => {
    localStorage.setItem('zavod7:seenVersion', '1.16.0-rc.7');
    localStorage.setItem('zavod7:settings', JSON.stringify({ tips: false, lang, renderer: 'webgl' }));
  }, { lang });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`file://${path.join(ROOT, 'dist', 'index.html').replaceAll('\\', '/')}?render=webgl`);
  await page.waitForFunction(() => window.__zavod && window.__texMs != null && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.menu-shell'), null, { timeout: 30000 });
  await page.locator('.menu-primary-actions [data-act="menu-page"][data-page="new"]').click();
  await page.locator('#seed').fill('4242');
  await page.locator('#mode').selectOption('none');
  await page.locator('[data-act="new"]').click();
  await page.waitForTimeout(1500);
  const seeded = await page.evaluate(() => window.__zavod.workerEval('return g.world.seed + ":" + g.tick'));
  const [seed, firstTick] = String(seeded).split(':').map(Number);
  assert.equal(seed, 4242, 'the game must start through the New Game flow with its selected seed');
  assert(firstTick > 0, `the seeded Worker must be running before the context-loss test: ${seeded}`);
  await page.waitForTimeout(250);
  const tickSample1 = Number(await page.evaluate(() => window.__zavod.workerEval('return g.tick')));
  await page.waitForTimeout(250);
  const tickSample2 = Number(await page.evaluate(() => window.__zavod.workerEval('return g.tick')));
  assert(tickSample2 > tickSample1, `the Worker must advance between awaited samples: ${tickSample1} -> ${tickSample2}`);
  assert.equal((await page.evaluate(() => window.__zavod.R.mode)), 'webgl');
  console.log(`${lang.toUpperCase()} new-game flow started seed ${seed} at tick ${firstTick}; awaited Worker samples advanced ${tickSample1} -> ${tickSample2}`);
  return { context, page, errors };
}

async function workerState(page) {
  return page.evaluate(() => window.__zavod.workerEval(`
    let h = 0x811c9dc5;
    const add = value => { const s = typeof value === 'string' ? value : JSON.stringify(value); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); };
    add([g.seed, g.tick, g.player]);
    for (const e of [...g.ents.values()].sort((a, b) => a.id - b.id)) add(e);
    for (const [k, c] of [...g.world.chunks.entries()].sort((a, b) => a[0] - b[0])) {
      add([k, c.version]);
      for (const field of ['terrain', 'occ', 'res', 'amt', 'decor']) add(Array.from(c[field]));
      add([...c.mods.entries()].sort((a, b) => a[0] - b[0]));
    }
    return { tick: g.tick, entities: g.ents.size, chunks: g.world.chunks.size, hash: (h >>> 0).toString(16) };
  `));
}

async function serializedWorkerState(page) {
  return page.evaluate(async () => {
    const { tick, str } = await window.__zavod.sim.save(null);
    return { tick, str };
  });
}

function serializedStateSummary(snapshot) {
  return { tick: snapshot.tick, bytes: Buffer.byteLength(snapshot.str), sha256: createHash('sha256').update(snapshot.str).digest('hex') };
}

async function rendererSettingText(page) {
  if (await page.evaluate(() => window.__zavod.ui.open !== 'menu')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__zavod.ui.open === 'menu' && document.querySelector('.menu-shell'), null, { timeout: 10000 });
  await page.evaluate(() => {
    const menu = document.querySelector('.menu-shell');
    if (menu) menu.style.visibility = '';
  });
  await page.locator('.menu-sidebar [data-act="menu-child"][data-win="settings"]').click();
  await page.waitForSelector('.row2:has([data-act="render"])', { timeout: 10000 });
  const text = await page.locator('.row2:has([data-act="render"])').textContent();
  await page.locator('.menu-back').click();
  return text || '';
}

async function pauseAtBoundary(page) {
  if (await page.evaluate(() => window.__zavod.ui.open !== 'menu')) await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__zavod.ui.open === 'menu' && document.querySelector('.menu-shell'), null, { timeout: 10000 });
  await page.waitForTimeout(250);
  const first = await workerState(page);
  const firstSerialized = await serializedWorkerState(page);
  await page.waitForTimeout(150);
  const second = await workerState(page);
  const secondSerialized = await serializedWorkerState(page);
  assert.deepEqual(second, first, 'Worker state must be stable at the pause boundary');
  assert.equal(secondSerialized.tick, firstSerialized.tick, 'full Worker save tick must be stable at the pause boundary');
  assert.equal(secondSerialized.str, firstSerialized.str, 'full serialized Worker game state must be stable at the pause boundary');
  await page.evaluate(() => {
    window.__zavod.view.debug = false;
    const menu = document.querySelector('.menu-shell');
    if (menu) menu.style.visibility = 'hidden';
  });
  await page.waitForTimeout(80);
  return { partial: second, serialized: secondSerialized };
}

try {
  const ru = await openApp('ru');
  try {
    const initial = await ru.page.evaluate(() => {
      const gl = window.__zavod.R.gameGL();
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!gl || !ext) throw new Error('WebGL2 and WEBGL_lose_context must be available for this test');
      window.__zavod.view.debug = true;
      window.__v116Context = { gl, ext };
      return { mode: window.__zavod.R.mode, gpu: window.__zavod.R.gpuNote(), renderer: gl.getParameter(gl.RENDERER) };
    });
    assert.equal(initial.mode, 'webgl');
    console.log(`WebGL adapter before loss: ${initial.renderer}; diagnostic ${initial.gpu}`);
    await ru.page.waitForFunction(() => document.querySelector('#debug')?.textContent.includes('рендер webgl'), null, { timeout: 5000 });

    const runningTick = await ru.page.evaluate(() => window.__zavod.game.tick);
    await ru.page.evaluate(() => window.__v116Context.ext.loseContext());
    await ru.page.waitForFunction(() => window.__zavod.R.mode === 'canvas' && window.__zavod.R.modeNote === 'lost', null, { timeout: 3000 });
    await ru.page.waitForFunction(tick => window.__zavod.game.tick > tick, runningTick, { timeout: 10000 });
    console.log("F3_LOSS_IMMEDIATE", JSON.stringify(await ru.page.evaluate(() => ({text:document.querySelector("#debug").textContent,note:window.__zavod.R.gpuNote(),mode:window.__zavod.R.mode,modeNote:window.__zavod.R.modeNote,debug:window.__zavod.view.debug,lang:window.__zavod.settings.lang}))));
    await ru.page.waitForTimeout(500);
    console.log("F3_LOSS_500MS", JSON.stringify(await ru.page.evaluate(() => ({text:document.querySelector("#debug").textContent,note:window.__zavod.R.gpuNote(),mode:window.__zavod.R.mode,modeNote:window.__zavod.R.modeNote}))));
    const lostText = await ru.page.locator('#debug').textContent();
    assert.match(lostText, /контекст WebGL потерян/, 'F3 must explain the temporary Canvas2D fallback in Russian');
    const lostSetting = await rendererSettingText(ru.page);
    assert.match(lostSetting, /контекст WebGL потерян/, 'the renderer setting must explain the temporary Canvas2D fallback in Russian');
    console.log('PASS: real WEBGL_lose_context falls back to Canvas2D while Worker ticks continue');

    const paused = await pauseAtBoundary(ru.page);
    const beforeRestore = await ru.page.screenshot({ path: path.join(shots, 'ru-canvas-before-restore.png') });
    const restoreRequested = await ru.page.evaluate(() => {
      window.__v116Context.ext.restoreContext();
      return window.__v116Context.gl.isContextLost();
    });
    assert.equal(restoreRequested, true, 'the real context remains lost until the restore event is delivered');
    await ru.page.waitForFunction(() => window.__zavod.R.mode === 'webgl' && window.__zavod.R.modeNote === '', null, { timeout: 10000 });
    await ru.page.waitForFunction(() => window.__zavod.R.batch.atlas.slots.size > 1 && window.__zavod.R.stat.quads > 0, null, { timeout: 10000 });
    const afterState = await workerState(ru.page);
    assert.deepEqual(afterState, paused.partial, 'restoring GPU resources must preserve the paused Worker snapshot');
    const afterSerialized = await serializedWorkerState(ru.page);
    assert.deepEqual(afterSerialized, paused.serialized, 'restoring GPU resources must preserve the full serialized Worker game state');
    const afterRestore = await ru.page.screenshot({ path: path.join(shots, 'ru-webgl-after-restore.png') });
    assert(beforeRestore.length > 20000 && afterRestore.length > 20000, 'the rendered scene must be visible before and after recovery');
    const recovered = await ru.page.evaluate(() => {
      const gl = window.__zavod.R.gameGL();
      return { mode: window.__zavod.R.mode, modeNote: window.__zavod.R.modeNote, gpu: window.__zavod.R.gpuNote(), context: !!gl && !gl.isContextLost(), renderer: gl?.getParameter(gl.RENDERER), atlasSlots: window.__zavod.R.batch.atlas.slots.size, quads: window.__zavod.R.stat.quads };
    });
    assert.equal(recovered.mode, 'webgl');
    assert.equal(recovered.context, true);
    assert(recovered.atlasSlots > 1 && recovered.quads > 0, `restored atlas and frame must be populated: ${JSON.stringify(recovered)}`);
    assert(recovered.gpu.includes('аппаратный') || recovered.gpu.includes('программный') || recovered.gpu.includes('GPU не определён'), `F3 must report the active adapter honestly: ${recovered.gpu}`);
    assert.equal(ru.errors.length, 0, `successful recovery has no uncaught page errors: ${ru.errors.join('; ')}`);
    console.log(`PASS: restored WebGL atlas/frame and unchanged Worker hash ${paused.partial.hash}; full save ${JSON.stringify(serializedStateSummary(afterSerialized))}; ${JSON.stringify(recovered)}`);

    await ru.page.evaluate(() => {
      const canvas = window.__zavod.R.glCanvas;
      const removedEvents = [];
      const remove = canvas.removeEventListener.bind(canvas);
      canvas.removeEventListener = (type, listener, options) => { removedEvents.push(type); return remove(type, listener, options); };
      window.__v116SwitchedOld = { gl: window.__zavod.R.gameGL(), canvas, removedEvents };
      window.__zavod.R.setMode('canvas');
    });
    await ru.page.waitForFunction(() => window.__zavod.R.mode === 'canvas' && !window.__zavod.R.glCanvas && window.__v116SwitchedOld.gl.isContextLost() && !window.__v116SwitchedOld.canvas.isConnected, null, { timeout: 5000 });
    await ru.page.evaluate(() => window.__zavod.R.setMode('webgl'));
    await ru.page.waitForFunction(() => window.__zavod.R.mode === 'webgl' && window.__zavod.R.batch.atlas.slots.size > 1 && window.__zavod.R.stat.quads > 0, null, { timeout: 10000 });
    const switched = await ru.page.evaluate(() => ({
      mode: window.__zavod.R.mode,
      oldContextLost: window.__v116SwitchedOld.gl.isContextLost(),
      oldCanvasDetached: !window.__v116SwitchedOld.canvas.isConnected,
      oldListenersRemoved: ['webglcontextlost', 'webglcontextrestored'].every(type => window.__v116SwitchedOld.removedEvents.includes(type)),
      newContext: window.__zavod.R.gameGL() !== window.__v116SwitchedOld.gl && !window.__zavod.R.gameGL().isContextLost(),
      atlasSlots: window.__zavod.R.batch.atlas.slots.size,
      quads: window.__zavod.R.stat.quads,
    }));
    assert.equal(switched.mode, 'webgl');
    assert.equal(switched.oldContextLost, true, 'switching renderer must explicitly release the old WebGL context');
    assert.equal(switched.oldCanvasDetached, true, 'switching renderer must detach the old WebGL surface');
    assert.equal(switched.oldListenersRemoved, true, 'switching renderer must remove both context lifecycle handlers');
    assert.equal(switched.newContext, true, 'switching back must allocate an independent live WebGL context');
    assert(switched.atlasSlots > 1 && switched.quads > 0, `new WebGL mode must repopulate its atlas and frame: ${JSON.stringify(switched)}`);
    assert.deepEqual(await workerState(ru.page), paused.partial, 'mode switches must preserve the paused Worker snapshot');
    assert.equal(ru.errors.length, 0, `mode switches have no uncaught page errors: ${ru.errors.join('; ')}`);
    console.log(`PASS: renderer mode switches release the old context and rebuild a live atlas without changing Worker state; ${JSON.stringify(switched)}`);

    await ru.page.evaluate(() => {
      const gl = window.__zavod.R.gameGL();
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!gl || !ext) throw new Error('A fresh WebGL context is required for the Russian restore-failure test');
      Object.defineProperty(gl, 'createProgram', { configurable: true, value() { throw new Error('injected Russian restoration program creation failure'); } });
      window.__zavod.view.debug = true;
      window.__v116RuFailureContext = { ext };
      ext.loseContext();
    });
    await ru.page.waitForFunction(() => window.__zavod.R.mode === 'canvas' && window.__zavod.R.modeNote === 'lost', null, { timeout: 3000 });
    await ru.page.evaluate(() => window.__v116RuFailureContext.ext.restoreContext());
    await ru.page.waitForFunction(() => window.__zavod.R.mode === 'canvas' && window.__zavod.R.modeNote === 'restore-failed', null, { timeout: 10000 });
    await ru.page.waitForFunction(() => document.querySelector('#debug')?.textContent.includes('WebGL восстановить не удалось'), null, { timeout: 5000 });
    assert.match(await rendererSettingText(ru.page), /WebGL восстановить не удалось/, 'the renderer setting must show the restoration failure in Russian');
    assert.deepEqual(await workerState(ru.page), paused.partial, 'failed restoration must leave the paused Worker game intact');
    assert.equal(ru.errors.length, 0, `Russian failed recovery is handled without uncaught page errors: ${ru.errors.join('; ')}`);
    console.log('PASS: injected restoration failure keeps the game in Canvas2D and explains the fallback in Russian');
  } finally {
    await ru.context.close();
  }

  const en = await openApp('en');
  try {
    const injected = await en.page.evaluate(() => {
      const gl = window.__zavod.R.gameGL();
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!gl || !ext) throw new Error('WebGL2 and WEBGL_lose_context must be available for the injected failure test');
      Object.defineProperty(gl, 'createProgram', { configurable: true, value() { window.__v116RestoreBuildFailed = true; throw new Error('injected restoration program creation failure'); } });
      window.__zavod.view.debug = true;
      window.__v116Context = { gl, ext };
      ext.loseContext();
      return true;
    });
    assert(injected);
    await en.page.waitForFunction(() => window.__zavod.R.mode === 'canvas' && window.__zavod.R.modeNote === 'lost', null, { timeout: 3000 });
    await en.page.waitForFunction(() => document.querySelector('#debug')?.textContent.includes('WebGL context lost'), null, { timeout: 5000 });
    const lostText = await en.page.locator('#debug').textContent();
    assert.match(lostText, /WebGL context lost/, 'F3 must localize the temporary fallback reason in English');
    const lostSetting = await rendererSettingText(en.page);
    assert.match(lostSetting, /WebGL context lost/, 'the renderer setting must localize the temporary fallback reason in English');
    await en.page.evaluate(() => window.__v116Context.ext.restoreContext());
    await en.page.waitForFunction(() => window.__zavod.R.mode === 'canvas' && window.__zavod.R.modeNote === 'restore-failed', null, { timeout: 10000 });
    const fallback = await en.page.evaluate(() => ({ mode: window.__zavod.R.mode, note: window.__zavod.R.modeNote, gpu: window.__zavod.R.gpuNote(), hasGL: !!window.__zavod.R.gameGL(), failed: !!window.__v116RestoreBuildFailed, attachedGLCanvas: !!window.__zavod.R.glCanvas }));
    const debug = await en.page.locator('#debug').textContent();
    assert.equal(fallback.mode, 'canvas');
    assert.equal(fallback.hasGL, false, 'failed restoration must not leave a stale active WebGL context');
    assert.equal(fallback.attachedGLCanvas, false, 'failed restoration must release the failed GL canvas');
    assert.equal(fallback.failed, true, 'the injected resource rebuild failure must be reached');
    assert.match(debug, /WebGL restoration failed/, 'F3 must show the real restoration failure in English');
    assert(fallback.gpu.includes('Canvas2D') && !fallback.gpu.includes('аппаратный'), `fallback diagnostics must report Canvas2D, not stale GPU data: ${fallback.gpu}`);
    const failedSetting = await rendererSettingText(en.page);
    assert.match(failedSetting, /WebGL restoration failed/, 'the renderer setting must show the restoration failure in English');
    assert.equal(en.errors.length, 0, `failed recovery is handled without uncaught page errors: ${en.errors.join('; ')}`);
    console.log(`PASS: injected resource rebuild failure leaves Canvas2D active with English reason; ${JSON.stringify(fallback)}`);
  } finally {
    await en.context.close();
  }

  console.log(`Rendered screenshots: ${shots}`);
} catch (error) {
  console.error('FAIL:', error.stack || error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

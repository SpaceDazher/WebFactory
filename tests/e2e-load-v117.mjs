// SPEC release load: actual browser render + Worker/local simulation, not a drawing mock.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { releaseLoadFixture } from './v117-load-fixture.ts';
import { serialize } from '../src/sim/save.ts';
import { launchBrowser, appUrl } from './browser.mjs';
const out = 'logs/acceptance-20261020'; mkdirSync(out, { recursive: true });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const hardware = process.argv.includes('--hardware'), tag = hardware ? 'hardware' : 'software';
const results = [], browser = await launchBrowser('chromium', { args: [...(hardware ? ['--use-angle=d3d11', '--enable-gpu'] : ['--enable-unsafe-swiftshader']), '--enable-precise-memory-info'] });
function stats(samples) { const s = samples.slice().sort((a, b) => a - b); return { n: s.length, p50: s[Math.floor(s.length * .5)], p95: s[Math.floor(s.length * .95)], max: s.at(-1) }; }
try {
  for (const [mode, worker, corpses] of [['canvas', false, 0], ['canvas', false, 50000], ['webgl', true, 0], ['webgl', true, 50000]]) {
    const save = JSON.stringify(serialize(releaseLoadFixture(128, corpses).g));
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), errors = [];
    try {
      await context.addInitScript(({ mode, worker, version }) => {
        localStorage.setItem('zavod7:seenVersion', version);
        localStorage.setItem('zavod7:settings', JSON.stringify({ simWorker: worker, renderer: mode, lang: 'en', tips: false, dayNight: false, leaveGuard: false }));
      }, { mode, worker, version });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(appUrl(import.meta.url, worker ? '' : '?local'));
      await page.waitForFunction(() => window.__texMs != null && window.__zavod && (!__zavod.sim || __zavod.sim.snaps > 2), null, { timeout: 120000 });
      const loadStart = performance.now();
      await page.evaluate(async save => { await __zavod.ui.h.loadSaveString(save); __zavod.ui.close(); }, save);
      await page.waitForFunction(n => __zavod.game.bioCorpses.length === n, corpses, { timeout: 120000 });
      const loadMs = performance.now() - loadStart;
      await page.evaluate(() => __zavod.workerEval(`
        globalThis.__releaseLoadTicks=[];
        const original=g.step.bind(g); g.step=()=>{ const start=performance.now(); original(); const a=globalThis.__releaseLoadTicks; a.push(performance.now()-start); if(a.length>600)a.shift(); };
        return true;
      `));
      const start = await page.evaluate(() => ({ at: performance.now(), frame: __zavod.frameCost().n, tick: __zavod.game.tick }));
      await page.waitForTimeout(20000);
      const measured = await page.evaluate(async () => { const gl = __zavod.R.gameGL(), ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ({ at: performance.now(), frame: __zavod.frameCost(), renderer: __zavod.R.mode, worker: !!__zavod.sim,
        gpu: gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null,
        workerErrors: __zavod.sim?.errors || [], mainHeapBytes: performance.memory?.usedJSHeapSize,
        sim: await __zavod.workerEval('return {tick:g.tick,corpses:g.bioCorpses.length,forms:g.v117.genetics.forms.length,drones:g.v117.drones.instances.length,ticks:globalThis.__releaseLoadTicks}') }); });
      assert.equal(measured.sim.corpses, corpses); assert.ok(measured.sim.tick > start.tick); assert.deepEqual(errors, []); assert.deepEqual(measured.workerErrors, []);
      assert.equal(measured.worker, worker); assert.equal(measured.renderer, mode);
      if (hardware && worker) assert.ok(measured.gpu && !/swiftshader|llvmpipe|software|basic render/i.test(measured.gpu), 'hardware acceptance uses a real GPU');
      if (corpses) await page.screenshot({ path: out + '/load-final-' + tag + '-' + mode + '.png' });
      const result = { mode, worker, hardware, executable: process.env.PW_EXECUTABLE_PATH || 'managed Chromium', gpu: measured.gpu, loadMs, elapsedMs: measured.at - start.at, frames: measured.frame.n - start.frame,
        fps: (measured.frame.n - start.frame) * 1000 / (measured.at - start.at), frameMs: stats(measured.frame.ms), tickMs: stats(measured.sim.ticks),
        mainHeapBytes: measured.mainHeapBytes, corpses: measured.sim.corpses, forms: measured.sim.forms, drones: measured.sim.drones, errors };
      results.push(result); writeFileSync(out + '/e2e-load-v117-' + tag + '.json', JSON.stringify(results, null, 2) + '\n'); console.log(JSON.stringify(result));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }

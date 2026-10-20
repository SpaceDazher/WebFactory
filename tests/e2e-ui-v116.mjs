// Focused v1.16 menu and rendering journeys. Run after `npm run build` with
// `node tests/e2e-ui-v116.mjs`; screenshots are captured from the built app.
import assert from 'node:assert/strict';
import { startGameplay } from './gameplay-start.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const browserName = process.env.UI_V116_BROWSER || 'chromium';
const playwrightEntry = process.env.UI_V116_PLAYWRIGHT
  ? pathToFileURL(path.join(process.env.UI_V116_PLAYWRIGHT, 'index.mjs')).href
  : 'playwright';
const engines = await import(playwrightEntry);
const engine = engines[browserName];
if (!engine) throw new Error(`Unsupported UI_V116_BROWSER: ${browserName}`);
const browser = await engine.launch(browserName === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] } : {});
const shots = path.join(process.env.TEMP || '/tmp', 'zavod7-ui-v116-shots');
fs.mkdirSync(shots, { recursive: true });
const failures = [];
const CYR = /[А-Яа-яЁё]/;
const check = (condition, message) => {
  console.log(`  ${condition ? '✔' : '✘'} ${message}`);
  if (!condition) failures.push(message);
};

async function openApp(render, lang = 'ru') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'en' ? 'en-US' : 'ru-RU' });
  await context.addInitScript(({ lang, render }) => {
    localStorage.setItem('zavod7:seenVersion', '1.16.0-rc.7');
    localStorage.setItem('zavod7:settings', JSON.stringify({ tips: false, lang, renderer: render }));
  }, { lang, render });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`file://${path.join(ROOT, 'dist', 'index.html').replaceAll('\\', '/') }?render=${render}`);
  await page.waitForFunction(() => window.__zavod && window.__texMs != null, null, { timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.menu-shell') || window.__zavod.game.tick > 2, null, { timeout: 30000 });
  return { context, page, errors };
}

async function buildMachineSamples(page) {
  return page.evaluate(() => window.__zavod.workerEval(`
    const x = Math.floor(g.player.x) - 5, y = Math.floor(g.player.y) - 4;
    for (let ty=y-7;ty<=y+10;ty++) for (let tx=x-2;tx<=x+13;tx++) {
      const c=g.world.chunkAt(tx,ty), k=g.world.idx(tx,ty);
      c.terrain[k]=0; c.decor[k]=0; c.occ[k]=-1; c.res[k]=0; c.amt[k]=0; c.mods.delete(k);
    }
    const drillIds = ['burner-mining-drill','electric-mining-drill','electric-mining-drill-2','electric-mining-drill-3'];
    for (let i=0;i<drillIds.length;i++) {
      const tx=x+i*3+1, ty=y+4, c=g.world.chunkAt(tx,ty), k=g.world.idx(tx,ty);
      c.res[k]=1; c.amt[k]=100000; c.mods.set(k,100000); c.version++; c.av=(c.av||0)+1;
    }
    for (const ty of [-7,10]) for (let tx=x-2;tx<=x+13;tx++) { const c=g.world.chunkAt(tx,ty); c.version++; }
    const placed = { assembler:0, drill:0, furnace:0 };
    const ids = ['assembling-machine-1','assembling-machine-2','assembling-machine-3','assembling-machine-4'];
    for (let i=0;i<ids.length;i++) if (g.build(ids[i], x+i*3, y, 0, false)) placed.assembler++;
    for (const [i,id] of drillIds.entries()) if (g.build(id, x+i*3, y+3, i%4, false)) placed.drill++;
    for (const [i,id] of ['stone-furnace','steel-furnace','electric-furnace'].entries()) if (g.build(id, x+i*3, y+6, i%4, false)) placed.furnace++;
    const corner = g.build('transport-belt', x+10, y+6, 0, false);
    if (corner) { corner.curve=1; corner.lanes[0][0].push({item:'iron-plate',n:1,pos:96}); corner.lanes[0][1].push({item:'copper-plate',n:1,pos:160}); }
    return { corner:!!corner, placed };
  `));
}

try {
  const { context, page, errors } = await openApp('webgl');
  const win = page.locator('#win');
  await page.waitForFunction(() => document.querySelector('.menu-shell'));
  check(await page.locator('.menu-shell').isVisible(), 'startup opens the same unified menu shell used for pause');
  check((await page.locator('.menu-sidebar-foot small').innerText()).includes('v' + VERSION), 'menu footer shows the actual build version');
  for (const item of ['home', 'new', 'load']) {
    check(await page.locator(`.menu-nav [data-page="${item}"]`).count() === 1, `main navigation exposes the ${item} route`);
  }
  for (const winName of ['chal', 'ach', 'mp', 'mods', 'settings', 'help', 'news']) {
    check(await page.locator(`.menu-nav [data-win="${winName}"]`).count() === 1, `main navigation exposes ${winName}`);
  }
  for (const winName of ['chal', 'ach', 'mp', 'mods', 'settings', 'help', 'news']) {
    await page.locator(`.menu-nav [data-win="${winName}"]`).click();
    check(await page.locator('.menu-shell').isVisible() && await page.locator('.menu-back').isVisible(), `${winName} opens as a child of the unified menu`);
    await page.locator('.menu-back').click();
    check(await page.locator('.menu-shell').isVisible(), `Back from ${winName} returns to the menu`);
  }
  await page.locator('.menu-nav [data-act="menu-editor"]').click();
  await page.waitForFunction(() => window.__zavod.editor.isOpen);
  check(await page.locator('.menu-shell').isVisible(), 'map editor opens above the unified menu');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__zavod.editor.isOpen);
  check(await page.locator('.menu-shell').isVisible(), 'closing the map editor returns to the unified menu');
  await page.screenshot({ path: path.join(shots, `v116-menu-home-${browserName}.png`) });

  await page.locator('.menu-nav [data-page="new"]').click();
  await page.locator('.menu-gen summary').click();
  await page.locator('#seed').fill('314159');
  await page.locator('#mode').selectOption('peaceful');
  await page.locator('#gen-w').selectOption('1.5');
  await page.locator('.menu-nav [data-page="load"]').click();
  check(await page.locator('#menu-saves .savecard').count() === 5, 'load page presents all five manual save slots');
  await page.locator('.menu-nav [data-page="new"]').click();
  check(await page.locator('#seed').inputValue() === '314159', 'seed survives switching between menu pages');
  check(await page.locator('#mode').inputValue() === 'peaceful', 'game mode survives switching between menu pages');
  check(await page.locator('#gen-w').inputValue() === '1.5', 'world generation options survive switching between menu pages');

  await page.locator('.menu-nav [data-win="settings"]').click();
  await page.locator('[data-act="lang"][data-v="en"]').click();
  check(await page.locator('#win').innerText().then(text => text.includes('Settings')), 'settings route uses English labels after changing language');
  await page.locator('[data-act="menu-back"]').click();
  check(await page.locator('.menu-stage-head h1').innerText().then(text => text.includes('New game')), 'back restores the selected menu page in the chosen language');
  await page.screenshot({ path: path.join(shots, `v116-menu-new-en-${browserName}.png`) });
  await page.locator('.menu-nav [data-page="new"]').click();
  check(await page.locator('#seed').inputValue() === '314159', 'world setup remains intact after a child screen');
  await page.locator('.menu-nav [data-win="settings"]').click();
  await page.locator('[data-set="uiScale"]').fill('200');
  await page.waitForTimeout(150);
  await page.locator('[data-act="menu-back"]').click();
  const box = await page.locator('.menu-shell').boundingBox();
  check(!!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800,
    `menu remains fully inside the viewport at 200% UI scale (${JSON.stringify(box)})`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '200% menu text and controls do not create horizontal viewport clipping');
  const english200 = await page.locator('.menu-shell').innerText();
  check(english200.includes('New game') && !CYR.test(english200), 'English menu labels remain visible at 200% UI scale');
  await page.screenshot({ path: path.join(shots, `v116-menu-scale-200-en-${browserName}.png`) });
  check(await page.evaluate(() => {
    const sampler = document.getElementById('biosample-btn'), box = sampler?.getBoundingClientRect();
    return !!box && !!document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('#win');
  }), 'the menu receives clicks above the biosampling HUD at 200% scale');
  await page.locator('.menu-stage-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
  const bodyBox = await page.locator('.menu-stage-body').boundingBox();
  const actionBox = await page.locator('.menu-page-actions').boundingBox();
  check(!!bodyBox && !!actionBox && actionBox.y >= bodyBox.y && actionBox.y + actionBox.height <= bodyBox.y + bodyBox.height,
    'new-world start action can be reached by scrolling the 200% menu content');
  await page.locator('.menu-nav [data-win="settings"]').click();
  await page.locator('[data-set="uiScale"]').fill('75');
  await page.locator('[data-act="menu-back"]').click();
  await page.locator('.menu-nav [data-page="home"]').click();
  const smallBox = await page.locator('.menu-shell').boundingBox();
  check(!!smallBox && smallBox.width < 1000 && smallBox.height < 620, `menu visibly scales down at 75% (${JSON.stringify(smallBox)})`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    '75% menu stays within the viewport without horizontal clipping');
  await page.keyboard.press('w');
  check(await win.isVisible(), 'gameplay movement keys do not dismiss or steal focus from an open menu');
  const english75 = await page.locator('.menu-shell').innerText();
  check(english75.includes('Continue') && !CYR.test(english75), 'English menu labels remain visible at 75% UI scale');
  await page.screenshot({ path: path.join(shots, `v116-menu-home-en-75-${browserName}.png`) });
  await page.locator('.menu-nav [data-win="settings"]').click();
  await page.locator('[data-act="lang"][data-v="ru"]').click();
  await page.locator('[data-act="menu-back"]').click();
  await page.locator('.menu-nav [data-page="home"]').click();
  await page.screenshot({ path: path.join(shots, `v116-menu-home-ru-75-${browserName}.png`) });
  await page.locator('.menu-primary-actions [data-act="menu-continue"]').click();
  check(!(await page.locator('.menu-shell').count()), 'Continue closes the pause menu and returns to the game');
  // The startup screen can expose the preview world before any simulation is
  // started. Pause/resume must be measured against a real Worker-backed game.
  await startGameplay(page);
  check(await page.evaluate(() => {
    const box = document.getElementById('biosample-btn')?.getBoundingClientRect();
    return !!box && !!document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('#biosample');
  }), 'biosampling controls remain reachable during gameplay');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.menu-shell'));
  check(await page.locator('.menu-shell').isVisible(), 'Escape from gameplay opens the same unified pause menu');
  await page.waitForTimeout(200);
  const pausedState = await page.evaluate(() => ({ x: window.__zavod.game.player.x, y: window.__zavod.game.player.y, tick: window.__zavod.game.tick }));
  await page.keyboard.press('w');
  await page.waitForTimeout(200);
  const capturedState = await page.evaluate(() => ({ x: window.__zavod.game.player.x, y: window.__zavod.game.player.y, tick: window.__zavod.game.tick }));
  check(capturedState.x === pausedState.x && capturedState.y === pausedState.y && capturedState.tick === pausedState.tick,
    'the pause menu captures movement keys and freezes the simulation');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.menu-shell'));
  await page.waitForTimeout(200);
  check(await page.evaluate(tick => window.__zavod.game.tick > tick, capturedState.tick), 'closing the pause menu resumes the simulation');

  const built = await buildMachineSamples(page);
  check(built?.corner && built.placed.assembler === 4 && built.placed.drill === 4 && built.placed.furnace === 3,
    `renderer sample places every tier and a two-lane turn (${JSON.stringify(built)})`);
  await page.evaluate(() => { window.__zavod.view.zoom = 1.5; });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(shots, `v116-machines-webgl-${browserName}.png`) });
  check(await page.evaluate(() => window.__zavod.R.mode === 'webgl'), 'the WebGL2 renderer is active for the machine sample');
  check(errors.length === 0, 'WebGL session has no uncaught page errors');
  await context.close();

  const canvasRun = await openApp('canvas');
  await startGameplay(canvasRun.page);
  await canvasRun.page.evaluate(() => window.__zavod.ui.close());
  const canvasBuilt = await buildMachineSamples(canvasRun.page);
  check(canvasBuilt?.corner && canvasBuilt.placed.assembler === 4 && canvasBuilt.placed.drill === 4 && canvasBuilt.placed.furnace === 3,
    `same machine tiers and curved belt build in the Canvas2D sample world (${JSON.stringify(canvasBuilt)})`);
  await canvasRun.page.evaluate(() => { window.__zavod.view.zoom = 1.5; });
  await canvasRun.page.waitForTimeout(900);
  await canvasRun.page.screenshot({ path: path.join(shots, `v116-machines-canvas-${browserName}.png`) });
  check(await canvasRun.page.evaluate(() => window.__zavod.R.mode === 'canvas'), 'Canvas2D fallback is active');
  check(canvasRun.errors.length === 0, 'Canvas2D session has no uncaught page errors');
  await canvasRun.context.close();
} catch (error) {
  failures.push(error.message);
  console.error('  ✘', error.stack || error.message);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n✘ ${failures.length} UI E2E checks failed` : '\n✔ v1.16 UI E2E passed');
process.exit(failures.length ? 1 : 0);

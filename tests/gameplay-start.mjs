/** Start a real Worker-backed game through the current home-menu flow for legacy gameplay E2Es. */
export async function startGameplay(page, seed = 4242) {
  const expectedSeed = Number(seed);
  await page.evaluate(() => {
    const ui = window.__zavod.ui;
    if (ui.open !== 'menu') ui.close();
    if (ui.open !== 'menu') ui.toggle('menu');
  });
  await page.click('[data-act="menu-page"][data-page="new"]');
  await page.waitForSelector('details.menu-gen summary', { state: 'visible' });
  await page.fill('#seed', String(expectedSeed));
  await page.click('[data-act="new"]');

  await page.waitForFunction(() => window.__zavod?.game?.tick >= 60, null, { timeout: 120000, polling: 200 });
  const before = await page.evaluate(() => window.__zavod.workerEval('return { seed: g.world.seed, tick: g.tick }'));
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => window.__zavod.workerEval('return { seed: g.world.seed, tick: g.tick }'));
  const ups = await page.evaluate(() => window.__zavod.sim?.ups ?? 60);
  if (before.seed !== expectedSeed || after.seed !== expectedSeed || after.tick <= before.tick) {
    throw new Error(`Worker game did not start steadily: expected seed ${expectedSeed}, got ${before.seed}/${before.tick} → ${after.seed}/${after.tick}`);
  }
  console.log(`[E2E_GAME_START] seed ${expectedSeed}, Worker ${before.tick}→${after.tick} (${ups.toFixed(1)} UPS)`);
  return { before, after, ups };
}

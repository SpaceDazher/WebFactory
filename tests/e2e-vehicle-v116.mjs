// v1.16 vehicle acceptance in a real browser against the production build.
// Run from this package with: node tests/e2e-vehicle-v116.mjs [chromium|firefox|webkit]
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserName = process.env.PW_BROWSER || process.argv[2] || 'chromium';
const browserTypes = { chromium, firefox, webkit };
assert.ok(browserTypes[browserName], `Unsupported browser: ${browserName}`);
const browser = await browserTypes[browserName].launch({ headless: true });
const shots = path.join(ROOT, 'shots', 'vehicle-v116', browserName);
fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (condition, message) => {
  console.log(`  ${condition ? '✔' : '✘'} ${message}`);
  if (!condition) failures.push(message);
};

const appUrl = `${pathToFileURL(path.join(ROOT, 'dist', 'index.html')).href}?render=canvas&gfx=low`;
async function openApp() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await context.addInitScript(() => {
    localStorage.setItem('zavod7:seenVersion', '1.16.0-rc.7');
    localStorage.setItem('zavod7:settings', JSON.stringify({ tips: false, lang: 'ru', renderer: 'canvas', leaveGuard: false }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errors.push(m.text()); });
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__zavod?.sim?.snaps > 2 && window.__texMs != null, null, { timeout: 300000 });
  await page.waitForSelector('.menu-shell', { timeout: 30000 });
  await page.locator('.menu-primary-actions [data-act="menu-continue"]').click();
  await page.waitForFunction(() => !document.querySelector('.menu-shell') && window.__zavod.game.tick > 2, null, { timeout: 30000 });
  return { context, page, errors };
}

const W = (page, code) => page.evaluate(c => window.__zavod.workerEval(c), code);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, message, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${message}`);
}
const readCar = (page, id) => W(page, `const e=g.ents.get(${id}); if(!e) return null; const v=e.vehicleState; return { proto:e.proto,x:e.x,y:e.y,w:e.w,h:e.h, fuel:e.fuel&&{...e.fuel},fuelJ:e.fuelJ||0, trunk:e.inv?.slots.filter(Boolean).map(s=>({...s}))||[], state:v&&JSON.parse(JSON.stringify(v)) };`);
const readPlayer = page => W(page, `return {x:g.player.x,y:g.player.y,veh:g.player.veh,dead:g.player.dead,hp:g.player.hp};`);
const worldPoint = (page, x, y) => page.evaluate(([wx, wy]) => {
  const canvas = document.getElementById('game'); const box = canvas.getBoundingClientRect(); const r = window.__zavod.R; const dpr = r.pixelRatio();
  return { x: box.left + (r.W / 2 + (wx - r.camX) * r.s) / dpr, y: box.top + (r.H / 2 + (wy - r.camY) * r.s) / dpr };
}, [x, y]);
async function clickWorld(page, x, y) {
  const p = await worldPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}
async function placeFixture(page) {
  return W(page, `
    const px=Math.floor(g.player.x), py=Math.floor(g.player.y), x=px+5, y=py+5;
    for(let ty=y-12;ty<=y+12;ty++) for(let tx=x-12;tx<=x+12;tx++) {
      const c=g.world.chunkAt(tx,ty), k=g.world.idx(tx,ty); c.terrain[k]=0; c.decor[k]=0; c.occ[k]=-1; c.res[k]=0; c.amt[k]=0; c.mods.delete(k); c.version++;
    }
    g.inv.slots.fill(null); g.held=null;
    const e=g.build('car',x,y,0,false); if(!e) return {error:'car placement failed',x,y};
    g.player.x=x+1; g.player.y=y+5;
    for(const [item,n] of [['iron-plate',50],['coal',5],['gun-turret',1],['laser-turret',1],['firearm-magazine',4],['fission-reactor-equipment',1],['battery-equipment',1],['nuclear-fuel-cell',1]]) g.inv.add(item,n);
    return {id:e.id,x:e.x,y:e.y,centerX:e.vehicleState.x,centerY:e.vehicleState.y,player:{x:g.player.x,y:g.player.y}};
  `);
}

async function runVehicleJourney() {
  const { context, page, errors } = await openApp();
  try {
    const fixture = await placeFixture(page);
    check(!!fixture?.id && !fixture.error, `Worker fixture places a real 2×3 vehicle near the player (${JSON.stringify(fixture)})`);
    if (!fixture?.id || fixture.error) return;
    const id = fixture.id;
    await page.evaluate(id => { window.__vehicleV116CarId = id; }, id);
    await page.waitForFunction(({ x, y }) => Math.hypot(window.__zavod.R.camX - x, window.__zavod.R.camY - y) < 1,
      fixture.player, { timeout: 10000 });
    const initial = await readCar(page, id);
    check(initial?.proto === 'car' && initial.w === 2 && initial.h === 3 && initial.trunk.length === 0,
      'vehicle starts with the 2×3 body and a separate 40-slot trunk');

    await clickWorld(page, fixture.centerX, fixture.centerY);
    await page.waitForFunction(id => window.__zavod.ui.open === 'ent' && window.__zavod.ui.entId === id, id, { timeout: 10000 });
    check(await page.locator('#win .lbl').filter({ hasText: 'Багажник · 0/40 занято' }).count() === 1 &&
      await page.locator('#win [data-act="eslot"][data-slot^="chest:"]').count() === 40,
      'the car UI shows all 40 usable trunk slots');

    // Put a real stack in the trunk using the inventory hand and the car hit target.
    await page.locator('#win [data-act="close"]').click();
    await page.keyboard.press('e');
    await page.waitForSelector('#win .invgrid');
    const ironSlot = await W(page, `return g.inv.slots.findIndex(s=>s?.item==='iron-plate');`);
    await page.locator(`#win [data-act="inv"][data-i="${ironSlot}"]`).click({ button: 'right' });
    await until(() => W(page, `return g.held?.item||null;`), value => value === 'iron-plate', 'iron plate picked up into hand');
    await page.locator('#win [data-act="close"]').click();
    await clickWorld(page, fixture.centerX, fixture.centerY);
    await until(() => readCar(page, id), car => car?.trunk.some(s => s.item === 'iron-plate'), 'stack inserted into trunk');
    check((await readCar(page, id)).trunk.some(s => s.item === 'iron-plate'), 'a held item can be deposited into the car trunk through the world UI');
    await page.waitForFunction(id => {
      const g = window.__zavod.game;
      return !g.held && g.ents.get(id)?.inv?.slots.some(s => s?.item === 'iron-plate');
    }, id, { timeout: 10000 });

    // Fuel reaches the vehicle through the same hand/drop flow, then powers real movement.
    await clickWorld(page, fixture.centerX, fixture.centerY);
    await page.waitForFunction(id => window.__zavod.ui.open === 'ent' && window.__zavod.ui.entId === id, id);
    await page.locator('#win [data-act="close"]').click();
    await page.keyboard.press('e');
    await page.waitForSelector('#win .invgrid');
    const coalSlot = await W(page, `return g.inv.slots.findIndex(s=>s?.item==='coal');`);
    await page.locator(`#win [data-act="inv"][data-i="${coalSlot}"]`).click({ button: 'right' });
    await until(() => W(page, `return g.held?.item||null;`), value => value === 'coal', 'coal picked up into hand');
    await page.locator('#win [data-act="close"]').click();
    await clickWorld(page, fixture.centerX, fixture.centerY);
    await until(() => readCar(page, id), car => car?.fuel?.item === 'coal' && car.fuel.count > 0, 'coal inserted into vehicle fuel slot');
    check((await readCar(page, id)).fuel?.item === 'coal', 'fuel slot accepts coal through the real hand/drop interaction');

    await page.keyboard.press('v');
    await until(() => readPlayer(page), player => player?.veh === id, 'driver enters the vehicle');
    const beforeDrive = await readCar(page, id);
    await page.keyboard.down('w');
    await page.waitForTimeout(900);
    await page.keyboard.up('w');
    const afterDrive = await until(() => readCar(page, id), car => Math.hypot(car.state.x - beforeDrive.state.x, car.state.y - beforeDrive.state.y) > 0.2,
      'vehicle moves from browser keyboard input', 10000);
    check(afterDrive.state.speed > 0 && (afterDrive.fuelJ > 0 || afterDrive.fuel?.count < beforeDrive.fuel?.count),
      `W moves the vehicle and consumes its burner fuel ((${beforeDrive.state.x.toFixed(2)}, ${beforeDrive.state.y.toFixed(2)})→(${afterDrive.state.x.toFixed(2)}, ${afterDrive.state.y.toFixed(2)}), ${afterDrive.fuel?.count || 0} coal left)`);
    await page.keyboard.press('v');
    const exited = await until(() => readPlayer(page), player => player?.veh == null, 'driver safely exits');
    check(exited?.veh == null && Math.hypot(exited.x - afterDrive.state.x, exited.y - afterDrive.state.y) >= 1.5,
      'the vehicle action exits to a nearby safe tile');

    const carNow = await readCar(page, id);
    await clickWorld(page, carNow.state.x, carNow.state.y);
    await page.waitForFunction(id => window.__zavod.ui.open === 'ent' && window.__zavod.ui.entId === id, id);
    await page.locator('#win [data-act="vehicle-turret"][data-slot="0"][data-v="gun-turret"]').click();
    await until(() => readCar(page, id), car => car?.state.mounts[0]?.proto === 'gun-turret', 'gun turret installed');
    await page.locator('#win [data-act="vehicle-turret"][data-slot="1"][data-v="laser-turret"]').click();
    await until(() => readCar(page, id), car => car?.state.mounts[1]?.proto === 'laser-turret', 'laser turret installed');
    await page.locator('#win [data-act="vehicle-ammo"][data-slot="0"][data-v="firearm-magazine"]').click();
    await until(() => readCar(page, id), car => car?.state.mounts[0]?.ammo?.item === 'firearm-magazine', 'gun ammo installed');
    await page.locator('#win [data-act="vehicle-equip"][data-op="put"][data-v="fission-reactor-equipment"]').click();
    await until(() => readCar(page, id), car => car?.state.grid.some(m => m.id === 'fission-reactor-equipment'), 'personal fission module installed');
    await page.locator('#win [data-act="vehicle-equip"][data-op="put"][data-v="battery-equipment"]').click();
    await until(() => readCar(page, id), car => car?.state.grid.some(m => m.id === 'battery-equipment'), 'vehicle battery installed');
    await page.locator('#win [data-act="vehicle-equip"][data-op="feed"]').click();
    const powered = await until(() => readCar(page, id), car => car?.state.grid[0] &&
      (car.state.grid[0].n > 0 || car.state.grid[0].r > 0 || car.state.grid[0].w > 0) && car.state.gridCharge >= 1_000_000,
      'nuclear fuel loaded and reactor generates charge', 15000);
    check(powered.state.mounts[0]?.ammo?.item === 'firearm-magazine' && powered.state.mounts[1]?.proto === 'laser-turret' &&
      powered.state.grid.some(m => m.id === 'battery-equipment') &&
      (powered.state.grid[0].n > 0 || powered.state.grid[0].r > 0 || powered.state.grid[0].w > 0) && powered.state.gridCharge >= 1_000_000,
      'two mounted turrets, independent gun ammunition, and the fueled personal reactor are live in the Worker');
    check(await page.locator('#win').innerText().then(text => text.includes('Две турели') && text.includes('Оборудование 4×4') && text.includes('Багажник · 1/40 занято')),
      'vehicle window renders both mount slots, equipment grid, and used trunk capacity');
    await page.screenshot({ path: path.join(shots, 'vehicle-ui-loaded.png') });

    // The range overlay is an actual canvas draw around the hovered car mount.
    await page.locator('#win [data-act="close"]').click();
    const hoverAt = await worldPoint(page, powered.state.x, powered.state.y);
    await page.mouse.move(hoverAt.x, hoverAt.y);
    await page.waitForFunction(id => window.__zavod.view.hoverEnt?.id === id, id, { timeout: 10000 });
    const frameBeforeRadius = await page.evaluate(() => window.__zavod.R.frame);
    await page.keyboard.press('Alt+z');
    await page.waitForFunction(({ frame }) => window.__zavod.view.ranges === 1 && window.__zavod.R.frame >= frame + 2,
      { frame: frameBeforeRadius }, { timeout: 10000 });
    const radiusPixel = await page.evaluate(() => {
      const r = window.__zavod.R, g = window.__zavod.game, e = g.ents.get(window.__vehicleV116CarId);
      if (!r.ctx?.getImageData || !e?.vehicleState) return false;
      const px = Math.round(r.W / 2 + (e.vehicleState.x - r.camX) * r.s + 18 * r.s);
      const py = Math.round(r.H / 2 + (e.vehicleState.y - r.camY) * r.s);
      const image = r.ctx.getImageData(Math.max(0, px - 2), Math.max(0, py - 2), 5, 5).data;
      for (let i = 0; i < image.length; i += 4) if (image[i] > 150 && image[i + 1] > 65 && image[i] > image[i + 2] * 1.3) return true;
      return false;
    });
    if (!radiusPixel) console.log('  radius debug:', JSON.stringify(await page.evaluate(() => {
      const r=window.__zavod.R,g=window.__zavod.game,e=g.ents.get(window.__vehicleV116CarId),v=window.__zavod.view;
      const x=Math.round(r.W/2+(e.vehicleState.x-r.camX)*r.s+18*r.s),y=Math.round(r.H/2+(e.vehicleState.y-r.camY)*r.s);
      const data=x>=0&&y>=0&&x<r.W&&y<r.H?r.ctx.getImageData(Math.max(0,x-2),Math.max(0,y-2),5,5).data:null;
      return {mode:r.mode,zoom:v.zoom,ranges:v.ranges,hover:v.hoverEnt?.id,cam:[r.camX,r.camY],s:r.s,canvas:[r.W,r.H],car:[e.vehicleState.x,e.vehicleState.y],sample:[x,y],colors:data?Array.from(data).filter((_,i)=>i%4===0).slice(0,25):null};
    })));
    check(radiusPixel, 'Canvas2D paints the mounted gun turret radius at the expected 18-tile boundary');
    await page.screenshot({ path: path.join(shots, 'vehicle-turret-radius.png') });

    // Save and reload only through the game menu controls.
    await page.keyboard.press('Escape');
    await page.waitForSelector('.menu-shell');
    await page.locator('.menu-nav [data-page="load"]').click();
    await page.locator('#menu-saves .savecard[data-slot="1"] [data-act="save"]').click();
    await page.waitForFunction(() => {
      const card = document.querySelector('#menu-saves .savecard[data-slot="1"]');
      return card && !card.classList.contains('empty') && card.querySelector('[data-act="load"]');
    }, null, { timeout: 30000 });
    await page.reload();
    await page.waitForFunction(() => window.__zavod?.sim?.snaps > 2 && window.__texMs != null, null, { timeout: 300000 });
    await page.waitForSelector('.menu-shell', { timeout: 30000 });
    await page.locator('.menu-nav [data-page="load"]').click();
    await page.locator('#menu-saves .savecard[data-slot="1"] button[data-act="load"]').click();
    await page.waitForFunction(() => !document.querySelector('.menu-shell') && window.__zavod.game.tick > 2, null, { timeout: 30000 });
    const restored = await until(async () => W(page, `const e=[...g.ents.values()].find(e=>e.proto==='car'); if(!e) return null; return {fuel:e.fuel&&{...e.fuel},trunk:e.inv?.slots.filter(Boolean).map(s=>({...s}))||[],vehicleState:e.vehicleState&&JSON.parse(JSON.stringify(e.vehicleState))};`),
      car => car?.vehicleState?.mounts?.[0]?.proto === 'gun-turret' && car.vehicleState.mounts?.[1]?.proto === 'laser-turret', 'saved vehicle restored with both mounts', 30000);
    check(restored?.fuel?.item === 'coal' && restored.trunk.some(s => s.item === 'iron-plate') &&
      restored.vehicleState.grid.some(m => m.id === 'fission-reactor-equipment' && (m.n > 0 || m.r > 0 || m.w > 0)) && restored.vehicleState.driver == null,
      'UI save/reload preserves fuel, trunk, both turrets, nuclear reserve, and the safe exited state');
    check(errors.length === 0, `browser journey has no uncaught console/page errors (${errors.join(' | ') || 'none'})`);
  } finally {
    await context.close();
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function portReady(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const connected = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await pause(100);
  }
  throw new Error('local multiplayer signalling server did not start');
}
async function openPeer(name, port) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, locale: 'ru-RU' });
  await context.addInitScript(port => {
    localStorage.setItem('zavod7:seenVersion', '1.16.0-rc.7');
    localStorage.setItem('zavod7:settings', JSON.stringify({ mpServer: `ws://127.0.0.1:${port}`, tips: false, lang: 'ru', renderer: 'canvas', leaveGuard: false }));
  }, port);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(m.text())) errors.push(m.text()); });
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__zavod?.sim?.snaps > 2 && window.__texMs != null, null, { timeout: 300000 });
  await page.waitForSelector('.menu-shell', { timeout: 30000 });
  await page.locator('.menu-nav [data-win="mp"]').click();
  await page.waitForSelector('#mpname', { timeout: 10000 });
  await page.locator('#mpname').fill(name);
  return { context, page, errors };
}
async function runMultiplayerJourney() {
  if (browserName !== 'chromium') return;
  let signal = null, host = null, client = null, late = null;
  const port = await freePort();
  try {
    signal = spawn(process.execPath, [path.join(ROOT, 'tools', 'signal-server.mjs'), '--port', String(port)], {
      cwd: ROOT, stdio: 'ignore', windowsHide: true,
    });
    await portReady(port);
    host = await openPeer('Vehicle host', port);
    await host.page.locator('#mpmap').selectOption('new');
    await host.page.locator('#mpen').selectOption('none');
    await host.page.locator('[data-act="mphost"]').click();
    await host.page.waitForFunction(() => !!window.__zavod.mp.code, null, { timeout: 20000 });
    const code = await host.page.evaluate(() => window.__zavod.mp.code);

    client = await openPeer('Vehicle client', port);
    await client.page.locator('#mpcode').fill(code);
    await client.page.locator('[data-act="mpjoin"]').click();
    await host.page.waitForFunction(() => window.__zavod.mp.session?.players.length === 2, null, { timeout: 30000 });
    await client.page.waitForFunction(() => window.__zavod.mp.session?.state === 'lobby', null, { timeout: 30000 });
    await client.page.locator('[data-act="mpready"]').click();
    await host.page.waitForFunction(() => { const b=document.querySelector('[data-act="mpstart"]'); return b && !b.disabled; }, null, { timeout: 15000 });
    await host.page.locator('[data-act="mpstart"]').click();
    await host.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
    await client.page.waitForFunction(() => window.__zavod.mp.inGame && window.__zavod.game.mpv?.mp, null, { timeout: 60000 });
    check(true, 'real Chromium host and browser client join the same running multiplayer game');

    const localPeer = await W(client.page, `const index=g.peers.findIndex(p=>p.name==='Vehicle client'); const p=index>=0?g.peer(index).player:null; return {index,name:index>=0?g.peer(index).name:null,x:p?.x,y:p?.y};`);
    check(localPeer.index >= 0 && Number.isFinite(localPeer.x) && Number.isFinite(localPeer.y), `client Worker exposes its player peer (${JSON.stringify(localPeer)})`);
    if (localPeer.index < 0) return;
    const localClient = { x: localPeer.x, y: localPeer.y };
    const fixture = await W(host.page, `
      const ci=g.peers.findIndex(p=>p.name==='Vehicle client'); if(ci<0) return {error:'client peer missing'};
      const x=Math.floor(${localClient.x})+1,y=Math.floor(${localClient.y})+1;
      for(let ty=y-12;ty<=y+12;ty++) for(let tx=x-12;tx<=x+12;tx++) { const c=g.world.chunkAt(tx,ty),k=g.world.idx(tx,ty); c.terrain[k]=0;c.decor[k]=0;c.occ[k]=-1;c.res[k]=0;c.amt[k]=0;c.mods.delete(k);c.version++; }
      const e=g.build('car',x,y,0,false); if(!e) return {error:'car placement failed'};
      e.own=ci; e.fuel={item:'coal',count:2};
      return {id:e.id,peer:ci,x:e.vehicleState.x,y:e.vehicleState.y,px:${localClient.x},py:${localClient.y}};
    `);
    console.log(`  multiplayer local player: ${JSON.stringify(localPeer)}`);
    check(!!fixture?.id && !fixture.error, `host Worker fixture places a client-owned car (${JSON.stringify(fixture)})`);
    if (!fixture?.id || fixture.error) return;
    const clientPlayer = await until(() => W(client.page, `const p=g.peer(${fixture.peer}).player; return {x:p.x,y:p.y,veh:p.veh};`), p => Math.hypot(p.x - fixture.px, p.y - fixture.py) < 1,
      'client receives authoritative player position near the car', 30000).catch(async error => {
      console.log('  multiplayer position debug:', JSON.stringify({ hostPeer: await W(host.page,
        `const p=g.peer(${fixture.peer}).player; return {x:p.x,y:p.y,veh:p.veh,name:g.peer(${fixture.peer}).name};`), client: await readPlayer(client.page) }));
      throw error;
    });
    const clientCar = await until(() => readCar(client.page, fixture.id), car => !!car?.state, 'client receives the car snapshot', 30000);
    const clickAt = await worldPoint(client.page, clientCar.state.x, clientCar.state.y), canvasBounds = await client.page.locator('#game').boundingBox();
    check(!!canvasBounds && clickAt.x >= canvasBounds.x && clickAt.x <= canvasBounds.x + canvasBounds.width &&
      clickAt.y >= canvasBounds.y && clickAt.y <= canvasBounds.y + canvasBounds.height,
      `client sees the car click target in its viewport (${JSON.stringify(clickAt)})`);
    const uiBeforeDrive = await client.page.evaluate(() => window.__zavod.ui.open);
    if (uiBeforeDrive) { await client.page.keyboard.press('Escape'); await client.page.waitForFunction(() => !window.__zavod.ui.open, null, { timeout: 10000 }); }
    await client.page.mouse.click(Math.min(canvasBounds.x + canvasBounds.width - 8, clickAt.x + 80), Math.min(canvasBounds.y + canvasBounds.height - 8, clickAt.y + 80));
    await client.page.keyboard.press('v');
    const driven = await until(() => readCar(host.page, fixture.id), car => car?.state.driver === fixture.peer,
      'client enters its owned car via browser input', 30000);
    check(driven.state.driver === fixture.peer, 'client key action takes the replicated vehicle in the authoritative Worker');
    const start = [driven.state.x, driven.state.y];
    await client.page.keyboard.down('w'); await client.page.waitForTimeout(900); await client.page.keyboard.up('w');
    const moved = await until(() => readCar(host.page, fixture.id), car => Math.hypot(car.state.x - start[0], car.state.y - start[1]) > 0.2,
      'authoritative host receives client driving input', 30000);
    check(moved.state.driver === fixture.peer && Math.hypot(moved.state.x - start[0], moved.state.y - start[1]) > 0.2,
      'browser client movement synchronizes to the host car state');
    await host.page.screenshot({ path: path.join(shots, 'vehicle-multiplayer-host.png') });
    await client.page.screenshot({ path: path.join(shots, 'vehicle-multiplayer-client.png') });

    await client.context.close(); client = null;
    const disconnected = await until(async () => {
      const car = await readCar(host.page, fixture.id);
      const player = await W(host.page, `const p=g.peer(${fixture.peer}).player; return {x:p.x,y:p.y,veh:p.veh,off:g.peer(${fixture.peer}).off||0};`);
      return { car, player };
    }, s => s.car?.state.driver == null && s.player.veh == null && Math.hypot(s.player.x - s.car.state.x, s.player.y - s.car.state.y) >= 1.5,
      'disconnect safely releases the remote driver', 30000);
    check(disconnected.car.state.driver == null && disconnected.player.veh == null,
      'closing the actual client browser safely exits the driver from the vehicle');

    // A fresh browser joins the already-running room, exercising live late-join transfer.
    late = await openPeer('Vehicle late join', port);
    await late.page.locator('#mpcode').fill(code);
    await late.page.locator('[data-act="mpjoin"]').click();
    const lateInGame = await until(() => late.page.evaluate(() => ({ inGame: window.__zavod.mp.inGame, session: window.__zavod.mp.session?.state })),
      s => s.inGame, 'fresh browser late-joins the running multiplayer game', 60000);
    const joinedName = await until(() => W(host.page, `return g.peers.filter(p=>p.name==='Vehicle late join').length;`), n => n === 1,
      'host receives the late-joining browser peer', 30000);
    check(lateInGame.inGame && joinedName === 1, 'late-joining browser receives the live multiplayer session');
    const latePeer = await W(host.page, `const i=g.peers.findIndex(p=>p.name==='Vehicle late join'); const p=i>=0?g.peer(i).player:null; return {index:i,x:p?.x,y:p?.y};`);
    if (latePeer.index >= 0) {
      const positioned = await W(host.page, `
        const e=g.ents.get(${fixture.id}), i=${latePeer.index}, p=g.peer(i).player, v=e.vehicleState;
        e.own=i;
        if(Math.hypot(p.x-v.x,p.y-v.y)>g.reach()+1.5){p.x=v.x;p.y=v.y+3;}
        return {x:p.x,y:p.y,carX:v.x,carY:v.y};
      `);
      await until(() => W(late.page, `const p=g.peer(${latePeer.index}).player; return {x:p.x,y:p.y};`),
        p => Math.hypot(p.x - positioned.x, p.y - positioned.y) < 1, 'late client receives its nearby test position', 15000);
      await until(() => readCar(late.page, fixture.id), car => !!car?.state, 'late client receives the car snapshot', 30000);
      const driverFixture = await W(host.page, `
        const e=g.ents.get(${fixture.id}),i=${latePeer.index},p=g.peer(i).player,v=e.vehicleState;
        e.own=i;p.x=v.x+1;p.y=v.y+3;v.driver=i;p.veh=e.id;
        return {driver:v.driver,veh:p.veh,x:p.x,y:p.y};
      `);
      check(driverFixture.driver === latePeer.index && driverFixture.veh === fixture.id,
        'the connected late-join peer is prepared as a seated driver for the engine damage path');
      const death = await W(host.page, `
        const old=g.pl; g.usePl(${latePeer.index}); const p=g.player; p.hp=1; g.hurtPlayer(2,true); g.step();
        const result={dead:p.dead,veh:p.veh,x:p.x,y:p.y}; g.usePl(old);
        const e=g.ents.get(${fixture.id}); return {...result,driver:e.vehicleState.driver,xv:e.vehicleState.x,yv:e.vehicleState.y};
      `);
      check(death.dead && death.veh == null && death.driver == null && Math.hypot(death.x - death.xv, death.y - death.yv) >= 1.5,
        `real Worker damage/death safely releases a browser-connected vehicle driver (${JSON.stringify(death)})`);
    } else check(false, `host does not expose the late client peer (${JSON.stringify(latePeer)})`);
    check([...host.errors, ...late.errors].length === 0, `multiplayer browser pages have no uncaught errors (${[...host.errors, ...late.errors].join(' | ') || 'none'})`);
  } finally {
    await late?.context.close().catch(() => {});
    await client?.context.close().catch(() => {});
    await host?.context.close().catch(() => {});
    if (signal && signal.exitCode == null) signal.kill();
  }
}

try {
  console.log(`Vehicle browser journey: ${browserName} ${browser.version()}`);
  if (process.env.V116_MP_ONLY !== '1') await runVehicleJourney();
  await runMultiplayerJourney();
} catch (error) {
  failures.push(error.message);
  console.error('  ✘', error.stack || error.message);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n✘ ${failures.length} vehicle browser checks failed` : '\n✔ v1.16 vehicle browser journey passed');
process.exit(failures.length ? 1 : 0);

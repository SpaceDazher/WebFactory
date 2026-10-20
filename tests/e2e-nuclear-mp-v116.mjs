// Real browser multiplayer acceptance for v1.16 nuclear accidents, roles, saves, reconnect, and late join.
// Run from this package after `npm run build`: node tests/e2e-nuclear-mp-v116.mjs [chromium|firefox|webkit]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';

const ROOT = projectRoot(import.meta.url);
const browserName = selectedBrowser('chromium');
const browser = await launchBrowser(browserName, { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] });
const shots = path.join(ROOT, 'shots', 'nuclear-mp-v116', browserName);
fs.mkdirSync(shots, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const failures = [];
const check = (condition, message) => {
  console.log(`  ${condition ? '✔' : '✘'} ${message}`);
  if (!condition) failures.push(message);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, message, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${message}`);
}
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
    await pause(100);
  }
  throw new Error('local multiplayer signalling server did not start');
}
function watchErrors(page, label, errors) {
  page.on('pageerror', error => errors.push(`${label} pageerror: ${error.stack || error.message}`));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(message.text())) errors.push(`${label} console: ${message.text()}`);
  });
}
async function loadApp(context, label, port) {
  const page = await context.newPage();
  const errors = context.__nuclearErrors || (context.__nuclearErrors = []);
  watchErrors(page, label, errors);
  await page.goto(appUrl(import.meta.url, '?render=canvas&gfx=low'));
  await page.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 });
  await page.waitForSelector('.menu-shell', { timeout: 30000 });
  return { page, errors };
}
async function openPeer(name, port) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await context.addInitScript(({ port, version }) => {
    localStorage.setItem('zavod7:seenVersion', version);
    localStorage.setItem('zavod7:settings', JSON.stringify({ mpServer: `ws://127.0.0.1:${port}`, tips: false, lang: 'ru', renderer: 'canvas', leaveGuard: false }));
  }, { port, version });
  const peer = await loadApp(context, name, port);
  return { ...peer, context, name };
}
async function openMp(page, name) {
  await page.locator('.menu-nav [data-win="mp"]').click();
  await page.waitForSelector('#mpname', { timeout: 10000 });
  await page.locator('#mpname').fill(name);
}
const W = (page, code) => page.evaluate(source => window.__zavod.workerEval(source), code);
const stateFor = (page, ids) => W(page, `
  const ids=${JSON.stringify(ids)};
  const reactors=ids.map(id=>{const e=g.ents.get(id);return e?{id:e.id,proto:e.proto,t:15+(e.hE||0)/(10*1e6),rt:e.rt||0,ot:e.ot||0,rgo:e.rgo,input:e.input?{...e.input}:null,dead:!!e.rdead}:null;});
  return {tick:g.tick,zones:(g.nuc.zones||[]).map(z=>({x:z.x,y:z.y,t:z.t,r:z.r})),boom:g.nuc.st.boom||0,reactors,liveReactors:[...g.ents.values()].filter(e=>e.t==='reactor').length,mode:g.x.mode};
`);
async function startConsoleCommand(page, line) {
  await page.evaluate(() => { window.__zavod.ui.close(); window.__zavod.ui.toggle('gcon'); });
  await page.waitForSelector('#xcon-in', { state: 'visible', timeout: 10000 });
  await page.locator('#xcon-in').fill(line);
  await page.locator('#xcon-in').press('Enter');
}
async function installHashRecorder(page) {
  await page.evaluate(() => {
    const session = window.__zavod.mp.session;
    if (!session) throw new Error('no MP session to observe');
    window.__nuclearHashLog = [];
    const original = session.onSimHash;
    session.onSimHash = function(tick, hash) {
      window.__nuclearHashLog.push({ tick, hash });
      return original.call(this, tick, hash);
    };
  });
}
const readHashes = page => page.evaluate(() => window.__nuclearHashLog || []);
async function enterReactorUI(page, id) {
  await page.evaluate(reactorId => { window.__zavod.ui.close(); window.__zavod.ui.toggle('ent', reactorId); }, id);
  await page.waitForSelector('#win [data-act="rallow"]', { state: 'visible', timeout: 10000 });
  await page.locator('#win [data-act="rallow"]').click();
}
async function unpackSave(page, slot) {
  return page.evaluate(async saveSlot => {
    const raw = await window.__zavod.store.get(saveSlot);
    if (!raw) return null;
    if (raw[0] === 'J') return JSON.parse(raw.slice(1));
    if (raw[0] === '{') return JSON.parse(raw);
    if (raw[0] !== '0') throw new Error(`unknown save encoding ${raw[0]}`);
    const bin = atob(raw.slice(1));
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return JSON.parse(await new Response(stream).text());
  }, slot);
}
function commonHash(logs) {
  const maps = logs.map(list => new Map(list.map(({ tick, hash }) => [tick, hash])));
  const candidates = [...maps[0].keys()].sort((a, b) => b - a);
  for (const tick of candidates) {
    const values = maps.map(map => map.get(tick));
    if (values.every(value => value !== undefined) && values.every(value => value === values[0])) return { tick, hash: values[0] };
  }
  return null;
}

let signal = null, host = null, clientA = null, clientB = null, late = null;
const port = await freePort();
try {
  console.log(`Nuclear MP browser journey: ${browserName} ${browser.version()}`);
  signal = spawn(process.execPath, [path.join(ROOT, 'tools', 'signal-server.mjs'), '--port', String(port), '--quiet'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  await portReady(port);

  host = await openPeer('Nuclear host', port);
  // Fixture only: seed two adjacent reactors at 999 °C, with fuel present but their real allow switch off.
  // Their temperature/overheat counters then evolve only through normal synchronized Game.step() calls.
  const fixture = await W(host.page, `
    const px=Math.floor(g.player.x),py=Math.floor(g.player.y);
    let pos=null;
    for(const d of [18,24,30,36,42,48]) { const x=px+d,y=py+d; let free=true;
      for(let ty=y;ty<y+5&&free;ty++) for(let tx=x;tx<x+10;tx++) if(g.world.occ(tx,ty)>=0){free=false;break;}
      if(free){pos={x,y};break;}
    }
    if(!pos) return {error:'no free reactor footprint'};
    for(let ty=pos.y-2;ty<pos.y+7;ty++) for(let tx=pos.x-2;tx<pos.x+12;tx++) {
      const c=g.world.chunkAt(tx,ty),k=g.world.idx(tx,ty); c.terrain[k]=0;c.decor[k]=0;c.res[k]=0;c.amt[k]=0;c.mods.delete(k);c.version++;
    }
    g.settings.noBoom=false; g.nuc.zones=[];g.nuc.st={};
    const a=g.build('nuclear-reactor',pos.x,pos.y,0,false), b=g.build('nuclear-reactor',pos.x+5,pos.y,0,false);
    if(!a||!b) return {error:'reactor fixture build failed'};
    for(const e of [a,b]) { e.hE=9840000000; e.input={'nuclear-fuel-cell':1};e.output={};e.rgo=false;e.rstop=false;e.rhold=false;e.ot=0;e.rdead=false; }
    g._heat=null;g.heatDirty=true;
    return {ids:[a.id,b.id],x:pos.x,y:pos.y,tick:g.tick,temp:999,fuel:[a.input['nuclear-fuel-cell'],b.input['nuclear-fuel-cell']]};
  `);
  check(!!fixture?.ids?.length && !fixture.error && fixture.temp === 999, `host Worker seeds a synchronized two-reactor hot base (${JSON.stringify(fixture)})`);
  assert.ok(fixture?.ids?.length === 2 && !fixture.error, fixture?.error || 'reactor fixture unavailable');
  const ids = fixture.ids;

  await openMp(host.page, 'Nuclear host');
  await host.page.locator('#mpmap').selectOption('current');
  await host.page.locator('#mpen').selectOption('none');
  await host.page.locator('[data-act="mphost"]').click();
  await host.page.waitForFunction(() => !!window.__zavod.mp.code, null, { timeout: 20000 });
  const code = await host.page.evaluate(() => window.__zavod.mp.code);

  clientA = await openPeer('Nuclear admin', port);
  clientB = await openPeer('Nuclear player', port);
  await openMp(clientA.page, clientA.name); await clientA.page.locator('#mpcode').fill(code); await clientA.page.locator('[data-act="mpjoin"]').click();
  await openMp(clientB.page, clientB.name); await clientB.page.locator('#mpcode').fill(code); await clientB.page.locator('[data-act="mpjoin"]').click();
  await host.page.waitForFunction(() => window.__zavod.mp.session?.players.length === 3, null, { timeout: 30000 });
  await clientA.page.waitForFunction(() => window.__zavod.mp.session?.state === 'lobby', null, { timeout: 30000 });
  await clientB.page.waitForFunction(() => window.__zavod.mp.session?.state === 'lobby', null, { timeout: 30000 });
  await clientA.page.locator('[data-act="mpready"]').click(); await clientB.page.locator('[data-act="mpready"]').click();
  await host.page.waitForFunction(() => { const button=document.querySelector('[data-act="mpstart"]'); return button&&!button.disabled; }, null, { timeout: 15000 });
  await host.page.locator('[data-act="mpstart"]').click();
  await host.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
  await clientA.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
  await clientB.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
  const initialStates = await Promise.all([host, clientA, clientB].map(peer => stateFor(peer.page, ids)));
  check(initialStates.every(state => state.reactors.length === 2 && state.reactors.every(r => r?.t >= 998 && r?.t < 1000 && r.rt === 0 && r.input?.['nuclear-fuel-cell'] === 1)),
    `both real browser clients receive the same hot-but-held reactor base (${initialStates.map(s => `tick ${s.tick}, ${s.reactors.map(r => Math.round(r?.t || 0)).join('/') } °C`).join('; ')})`);
  await Promise.all([host, clientA, clientB].map(peer => installHashRecorder(peer.page)));

  const originalHostInventory = await W(host.page, `return Object.entries(g.inv.items()).sort(([a],[b])=>a.localeCompare(b));`);
  await startConsoleCommand(clientB.page, '/creative');
  const denied = await until(() => W(clientB.page, `return g.messages.slice(-12).some(m=>m.text.includes('Недостаточно прав'));`), Boolean, 'player console denial message', 15000);
  const deniedMode = await stateFor(clientB.page, ids);
  check(denied && deniedMode.mode === 0, 'ordinary player receives a real permission denial and cannot enable creative mode');

  await startConsoleCommand(host.page, '/creative');
  await until(async () => (await Promise.all([host, clientA, clientB].map(peer => stateFor(peer.page, ids)))).every(s => s.mode === 1), Boolean, 'host creative command replicated to all players', 15000);
  await startConsoleCommand(host.page, '/survival');
  await until(async () => (await Promise.all([host, clientA, clientB].map(peer => stateFor(peer.page, ids)))).every(s => s.mode === 0), Boolean, 'host survival command replicated to all players', 15000);
  const restoredHostInventory = await W(host.page, `return Object.entries(g.inv.items()).sort(([a],[b])=>a.localeCompare(b));`);
  check(JSON.stringify(restoredHostInventory) === JSON.stringify(originalHostInventory), 'host /creative then /survival restores the original inventory');

  const roleIndices = await host.page.evaluate(name => ({
    session: window.__zavod.mp.session.players.findIndex(p => p.name === name),
  }), clientA.name);
  const adminIndex = roleIndices.session;
  const workerAdminIndex = await W(host.page, `return g.peers.findIndex(p=>p.name==='${clientA.name}');`);
  check(adminIndex > 0 && workerAdminIndex === adminIndex, `multiplayer UI and authoritative Worker agree on the candidate's peer index (${adminIndex}/${workerAdminIndex})`);
  assert.ok(adminIndex > 0 && workerAdminIndex === adminIndex, `candidate peer index mismatch ${JSON.stringify({ roleIndices, workerAdminIndex })}`);
  await host.page.evaluate(() => { window.__zavod.ui.close(); window.__zavod.ui.toggle('players'); });
  await host.page.waitForSelector(`#win [data-act="mprole"][data-i="${adminIndex}"][data-r="admin"]`, { state: 'visible', timeout: 10000 });
  await host.page.locator(`#win [data-act="mprole"][data-i="${adminIndex}"][data-r="admin"]`).click();
  await until(() => W(host.page, `return g.peers[${adminIndex}]?.role;`), role => role === 'admin', 'host role change to replicate', 15000);
  await until(() => W(clientA.page, `return g.peers[${adminIndex}]?.role;`), role => role === 'admin', 'admin role replicated to promoted browser', 15000);
  await startConsoleCommand(clientA.page, '/creative');
  await until(async () => (await Promise.all([host, clientA, clientB].map(peer => stateFor(peer.page, ids)))).every(s => s.mode === 1), Boolean, 'promoted admin creative command', 15000);
  await startConsoleCommand(clientA.page, '/survival');
  await until(async () => (await Promise.all([host, clientA, clientB].map(peer => stateFor(peer.page, ids)))).every(s => s.mode === 0), Boolean, 'promoted admin survival command', 15000);
  check(true, 'host promotes a browser player through the Players UI; that admin can run both creative commands');
  await host.page.screenshot({ path: path.join(shots, 'roles-and-reactors.png') });

  // The UI toggles are real replicated commands; they release the seeded rods only after all clients loaded the base.
  for (const id of ids) {
    await enterReactorUI(host.page, id);
    await until(() => W(host.page, `const e=g.ents.get(${id});return e?.rgo===true&&e.rt>0;`), Boolean, `reactor ${id} fuel starts`, 15000);
  }
  const startedReactors = await stateFor(host.page, ids);
  check(startedReactors.reactors.every(r => r?.rt > 0 && (r.input?.['nuclear-fuel-cell'] || 0) === 0),
    `both reactor rods start through the synchronized UI action at tick ${startedReactors.tick} (${JSON.stringify(startedReactors.reactors)})`);

  const accident = await until(() => stateFor(host.page, ids), state => state.zones.length >= 2 && state.liveReactors === 0,
    'two real overheat explosions and chain reaction', 90000);
  check(accident.zones.length >= 2 && accident.boom >= 1 && accident.liveReactors === 0,
    `real Game.step() overheat cascade removes both reactors and records ${accident.zones.length} radiation zones at tick ${accident.tick}`);
  await host.page.screenshot({ path: path.join(shots, 'reactor-cascade.png') });

  const slot = `nuclear-mp-e2e-${Date.now()}`;
  const tickAtSaveRequest = await W(host.page, 'return g.tick;');
  await host.page.evaluate(saveSlot => window.__zavod.saveTo(saveSlot), slot);
  const saved = await unpackSave(host.page, slot);
  check(!!saved && saved.tick >= tickAtSaveRequest && saved.tick >= accident.tick && (saved.nuc?.zones?.length || 0) >= 2,
    `real multiplayer snapshot save contains the current post-cascade tick/state (${JSON.stringify({ requestedTick: tickAtSaveRequest, saveTick: saved?.tick, zones: saved?.nuc?.zones?.length })})`);
  const activeFx = await Promise.all([host, clientB].map(peer => W(peer.page,
    `return g.fx.filter(f=>f.k==='blast'||f.k==='boom').map(({k,t,life})=>({k,t,life}));`)));
  check(activeFx.every(fx => fx.some(f => f.k === 'blast' && f.life === 70 && f.t > 0) && fx.some(f => f.k === 'boom' && f.life === 60 && f.t > 0)),
    `active 70/60-tick visual FX durations survive worker-to-client snapshots (${JSON.stringify(activeFx)})`);

  // Close and re-open the existing browser context: localStorage retains the real persistent player key.
  const playerBIndex = await W(host.page, `return g.peers.findIndex(p=>p.name==='${clientB.name}');`);
  const beforeDisconnect = await W(host.page, `const p=g.peer(${playerBIndex}).player;return {x:p.x,y:p.y,veh:p.veh,name:g.peer(${playerBIndex}).name};`);
  await clientB.page.close();
  await until(() => W(host.page, `return g.peers[${playerBIndex}]?.off||0;`), off => off > 0, 'actual browser disconnect', 30000);
  clientB = { ...clientB, ...(await loadApp(clientB.context, 'Nuclear player reconnect', port)) };
  await openMp(clientB.page, 'Nuclear player');
  await clientB.page.locator('#mpcode').fill(code);
  await clientB.page.locator('[data-act="mpjoin"]').click();
  await clientB.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
  await until(() => W(host.page, `const P=g.peers[${playerBIndex}],p=P.player;return {off:P.off||0,name:P.name,x:p.x,y:p.y};`),
    p => p.off === 0 && p.name === 'Nuclear player', 'same player reconnects into saved character slot', 60000);
  await installHashRecorder(clientB.page);
  const reconnected = await W(host.page, `const P=g.peers[${playerBIndex}],p=P.player;return {off:P.off||0,name:P.name,x:p.x,y:p.y};`);
  check(reconnected.off === 0 && reconnected.name === 'Nuclear player' && Math.hypot(reconnected.x - beforeDisconnect.x, reconnected.y - beforeDisconnect.y) < 0.01,
    `same browser identity reconnects to the same world character after the accident (${JSON.stringify(reconnected)})`);
  const reconnectedNuclear = await stateFor(clientB.page, ids);
  check(reconnectedNuclear.zones.length >= 2 && reconnectedNuclear.liveReactors === 0, 'reconnected client receives the saved post-accident world');

  // Release the promoted client; a genuinely new browser then joins the already-running, post-accident session.
  await clientA.context.close(); clientA = null;
  late = await openPeer('Nuclear late join', port);
  await openMp(late.page, 'Nuclear late join');
  await late.page.locator('#mpcode').fill(code);
  await late.page.locator('[data-act="mpjoin"]').click();
  await late.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
  const lateState = await until(() => stateFor(late.page, ids), state => state.zones.length >= 2 && state.liveReactors === 0,
    'fresh browser receives post-accident hot-join snapshot', 60000);
  check(lateState.zones.length >= 2 && lateState.tick >= accident.tick, `fresh browser hot-joins after the accident at tick ${lateState.tick}`);
  await installHashRecorder(late.page);
  await host.page.screenshot({ path: path.join(shots, 'post-accident-hot-join-host.png') });
  await late.page.screenshot({ path: path.join(shots, 'post-accident-hot-join-client.png') });

  const aligned = await until(async () => {
    const [hostHashes, reconnectHashes, lateHashes] = await Promise.all([readHashes(host.page), readHashes(clientB.page), readHashes(late.page)]);
    const match = commonHash([hostHashes, reconnectHashes, lateHashes]);
    return match && match.tick >= accident.tick ? { ...match, counts: [hostHashes.length, reconnectHashes.length, lateHashes.length] } : null;
  }, Boolean, 'same actual lockstep hash on all three active browser peers after the real accident', 60000);
  const syncCounters = await Promise.all([host, clientB, late].map(peer => peer.page.evaluate(() => ({ desyncs: window.__zavod.mp.session.desyncs, resyncs: window.__zavod.mp.session.resyncs }))));
  check(!!aligned && syncCounters.every(c => c.desyncs === 0),
    `all live browsers report the same Worker lockstep hash at tick ${aligned?.tick} (${aligned?.hash}; records ${aligned?.counts?.join('/')}; desyncs ${syncCounters.map(c => c.desyncs).join('/')})`);
  check(syncCounters.every(c => c.resyncs === 0), `no recovery resync was needed for the matching-state checkpoint (${syncCounters.map(c => c.resyncs).join('/')})`);

  const pageErrors = [host, clientB, late].flatMap(peer => peer?.context?.__nuclearErrors || []);
  check(pageErrors.length === 0, `surviving browser clients report no uncaught page/console errors (${pageErrors.slice(0, 4).join(' | ') || 'none'})`);
} catch (error) {
  failures.push(error.message);
  console.error('  ✘', error.stack || error.message);
} finally {
  await late?.context.close().catch(() => {});
  await clientB?.context.close().catch(() => {});
  await clientA?.context.close().catch(() => {});
  await host?.context.close().catch(() => {});
  if (signal && signal.exitCode == null) signal.kill();
  await browser.close();
}

console.log(failures.length ? `\n✘ ${failures.length} nuclear MP browser checks failed` : '\n✔ v1.16 nuclear multiplayer browser journey passed');
process.exit(failures.length ? 1 : 0);

// Real host/client Worker acceptance for a bidirectional 2+8+2 rail shuttle.
// Run after `npm run build`: node tests/e2e-rail-mp-v116.mjs [chromium|firefox|webkit]
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';

const ROOT = projectRoot(import.meta.url);
const browserName = selectedBrowser('chromium');
const browser = await launchBrowser(browserName, browserName === 'chromium' ? { args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] } : {});
const shots = path.join(ROOT, 'shots', 'rail-mp-v116', browserName);
fs.mkdirSync(shots, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const failures = [];
const check = (condition, message) => {
  console.log(`  ${condition ? '✔' : '✘'} ${message}`);
  if (!condition) failures.push(message);
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, message, timeoutMs = 30000) {
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
async function loadApp(context, label) {
  const page = await context.newPage();
  const errors = context.__railErrors || (context.__railErrors = []);
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
  return { ...(await loadApp(context, name)), context, name };
}
async function openMp(page, name) {
  await page.locator('.menu-nav [data-win="mp"]').click();
  await page.waitForSelector('#mpname', { timeout: 10000 });
  await page.locator('#mpname').fill(name);
}
const W = (page, code) => page.evaluate(source => window.__zavod.workerEval(source), code);
async function installHashRecorder(page) {
  await page.evaluate(() => {
    const session = window.__zavod.mp.session;
    if (!session) throw new Error('no MP session to observe');
    window.__railHashLog = [];
    const original = session.onSimHash;
    session.onSimHash = function(tick, hash) {
      window.__railHashLog.push({ tick, hash });
      return original.call(this, tick, hash);
    };
  });
}
const readHashes = page => page.evaluate(() => window.__railHashLog || []);
function commonHash(logs) {
  const maps = logs.map(list => new Map(list.map(({ tick, hash }) => [tick, hash])));
  const ticks = [...maps[0].keys()].sort((a, b) => b - a);
  for (const tick of ticks) {
    const values = maps.map(map => map.get(tick));
    if (values.every(value => value !== undefined) && values.every(value => value === values[0])) return { tick, hash: values[0] };
  }
  return null;
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
const trainState = (page, id) => W(page, `
  const t=g.trains.find(t=>t.id===${id});
  if(!t)return null;
  const cars=t.cars.map(id=>g.ents.get(id));
  return {tick:g.tick,id:t.id,laps:t.laps||0,st:t.st,si:t.si,tgt:t.tgt,manual:t.manual,trail:t.trail.slice(),pos:t.pos,
    schedule:t.sched.map(r=>r.st),types:cars.map(e=>e?.proto||'missing'),allPresent:cars.every(Boolean),
    cargo:cars.reduce((n,e)=>n+(e?.inv?.count('iron-plate')||0),0),fuel:cars.filter(e=>e?.t==='loco').map(e=>e.fuel?.count||0)};
`);

let signal = null, host = null, client = null, late = null;
const port = await freePort();
try {
  console.log(`Rail shuttle MP browser journey: ${browserName} ${browser.version()}`);
  signal = spawn(process.execPath, [path.join(ROOT, 'tools', 'signal-server.mjs'), '--port', String(port), '--quiet'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  await portReady(port);

  host = await openPeer('Rail shuttle host', port);
  const fixture = await W(host.page, `
    const X0=(Math.floor(g.player.x)+24)&~1,Y=(Math.floor(g.player.y)+20)&~1,END=X0+160;
    for(let y=Y-8;y<Y+9;y++)for(let x=X0-4;x<END+6;x++){
      const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);c.terrain[i]=0;c.decor[i]=0;c.res[i]=0;c.amt[i]=0;c.mods.delete(i);if(c.decorRemoved)c.decorRemoved.add(i);c.version++;
    }
    if([...g.ents.values()].some(e=>e.x<X0+END-X0+6&&e.x+e.w>X0-4&&e.y<Y+9&&e.y+e.h>Y-8))return {error:'fixture overlaps existing entity'};
    g.research.done.add('railway');g.research.done.add('automated-rail-transportation');g.research.done.add('rail-signals');
    for(let x=X0;x<END;x+=2)if(!g.build('straight-rail',x,Y-1,2,false))return {error:'rail '+x};
    const west=g.build('train-stop',X0+4,Y-3,3,false),east=g.build('train-stop',END-2,Y+1,1,false);
    if(!west||!east)return {error:'terminal placement'};
    g.apply({t:'stopName',id:west.id,name:'West terminal'});g.apply({t:'stopName',id:east.id,name:'East terminal'});
    g.inv.add('locomotive',4);g.inv.add('cargo-wagon',8);
    const specs=['locomotive','locomotive',...Array(8).fill('cargo-wagon'),'locomotive','locomotive'];
    const carLen=p=>p==='locomotive'?7:6;let x=X0+END-X0-28,prev=null;const ids=[];
    for(let i=0;i<specs.length;i++){
      const proto=specs[i];if(prev)x-=(carLen(prev)+carLen(proto))/2+.5;
      const rail=[...g.ents.values()].find(e=>e.t==='rail'&&x>=e.x&&x<e.x+e.w);
      if(!rail)return {error:'rail under car '+i+' at '+x};
      g.player.x=x;g.player.y=Y+3;const id=g.nextId;
      g.apply({t:'placeCar',proto,rail:rail.id,x,y:Y,back:i>=10});
      const car=g.ents.get(id);if(!car)return {error:'car placement '+i+' at '+x};
      if(car.t==='loco')car.fuel={item:'coal',count:100};
      if(car.t==='wagon')car.inv.add('iron-plate',25);
      ids.push(id);prev=proto;
    }
    const t=g.trains[0];if(!t||t.cars.length!==12)return {error:'consist '+(t?.cars.length||0)};
    g.enqueue({t:'sched',id:ids[0],sched:[{st:'East terminal',c:'time',n:1},{st:'West terminal',c:'time',n:1}]});
    g.enqueue({t:'tmode',id:ids[0],auto:true});g.step();
    return {X0,Y,west:west.id,east:east.id,train:t.id,cars:t.cars.slice(),types:t.cars.map(id=>g.ents.get(id)?.proto),
      initial:{st:t.st,si:t.si,manual:t.manual},rails:[...g.ents.values()].filter(e=>e.t==='rail').length};
  `);
  check(!fixture?.error && fixture?.cars?.length === 12, `host Worker prepares the 2+8+2 consist on a saved rail route (${JSON.stringify(fixture)})`);
  if (fixture?.error || fixture?.cars?.length !== 12) throw new Error(fixture?.error || 'rail shuttle fixture is incomplete');

  await openMp(host.page, 'Rail shuttle host');
  await host.page.locator('#mpmap').selectOption('current');
  await host.page.locator('#mpen').selectOption('none');
  await host.page.locator('[data-act="mphost"]').click();
  await host.page.waitForFunction(() => !!window.__zavod.mp.code, null, { timeout: 20000 });
  const code = await host.page.evaluate(() => window.__zavod.mp.code);

  client = await openPeer('Rail shuttle client', port);
  await openMp(client.page, client.name);
  await client.page.locator('#mpcode').fill(code);
  await client.page.locator('[data-act="mpjoin"]').click();
  await host.page.waitForFunction(() => window.__zavod.mp.session?.players.length === 2, null, { timeout: 30000 });
  await client.page.waitForFunction(() => window.__zavod.mp.session?.state === 'lobby', null, { timeout: 30000 });
  await client.page.locator('[data-act="mpready"]').click();
  await host.page.waitForFunction(() => { const button=document.querySelector('[data-act="mpstart"]'); return button&&!button.disabled; }, null, { timeout: 15000 });
  await host.page.locator('[data-act="mpstart"]').click();
  await Promise.all([host, client].map(peer => peer.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 })));

  const initial = await Promise.all([host, client].map(peer => trainState(peer.page, fixture.train)));
  check(initial.every(s => s?.types.length === 12 && s.types.slice(0, 2).every(t => t === 'locomotive') && s.types.slice(2, 10).every(t => t === 'cargo-wagon') && s.types.slice(10).every(t => t === 'locomotive') && s.allPresent && s.schedule.join('|') === 'East terminal|West terminal'),
    `host and client Workers start from the same ordered, fueled shuttle (${JSON.stringify(initial)})`);
  await Promise.all([host, client].map(peer => installHashRecorder(peer.page)));

  const roundTrip = await until(() => trainState(host.page, fixture.train), s => s?.laps >= 1 && s.si === 0 && !s.manual,
    'train to reach both terminal stations and reverse into its next eastbound leg', 120000);
  check(roundTrip.laps >= 1 && roundTrip.si === 0 && roundTrip.tgt === fixture.east && !roundTrip.manual && roundTrip.st === 'go' && roundTrip.schedule.join('|') === 'East terminal|West terminal',
    `real Worker completes the west/east/west round trip and starts back with the same schedule (${JSON.stringify(roundTrip)})`);
  const clientRoundTrip = await until(() => trainState(client.page, fixture.train), s => s?.laps >= 1 && s.si === 0,
    'client Worker to reproduce the shuttle round trip', 30000);
  check(clientRoundTrip.laps >= 1 && clientRoundTrip.types.join('|') === roundTrip.types.join('|') && clientRoundTrip.cargo === roundTrip.cargo && clientRoundTrip.allPresent,
    `client Worker preserves consist order and cargo after the round trip (${JSON.stringify(clientRoundTrip)})`);

  const slot = `rail-mp-e2e-${Date.now()}`;
  const requestedTick = await W(host.page, 'return g.tick;');
  await host.page.evaluate(saveSlot => window.__zavod.saveTo(saveSlot), slot);
  const saved = await unpackSave(host.page, slot);
  const savedTrain = saved?.trains?.find(t => t.id === fixture.train);
  const savedCars = savedTrain?.cars?.map(id => saved.ents?.find(e => e.id === id));
  check(!!savedTrain && saved.tick >= requestedTick && savedTrain.laps >= 1 && savedTrain.cars.length === 12 && savedCars?.every(Boolean) && savedTrain.sched.map(r => r.st).join('|') === 'East terminal|West terminal',
    `host save contains the current tick, completed shuttle, ordered consist and schedule (${JSON.stringify({ requestedTick, tick: saved?.tick, laps: savedTrain?.laps, cars: savedTrain?.cars?.length })})`);

  late = await openPeer('Rail shuttle late join', port);
  await openMp(late.page, late.name);
  await late.page.locator('#mpcode').fill(code);
  await late.page.locator('[data-act="mpjoin"]').click();
  await late.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
  const lateState = await until(() => trainState(late.page, fixture.train), s => s?.laps >= 1 && s.types.length === 12,
    'late join to receive the running shuttle snapshot', 60000);
  check(lateState.laps >= 1 && lateState.schedule.join('|') === 'East terminal|West terminal' && lateState.allPresent && lateState.cargo === roundTrip.cargo,
    `late join receives the same running shuttle and loaded consist (${JSON.stringify(lateState)})`);
  await installHashRecorder(late.page);
  await Promise.all([host, client, late].map(peer => peer.page.screenshot({ path: path.join(shots, `${peer.name.toLowerCase().replaceAll(' ', '-')}.png`) })));

  const aligned = await until(async () => {
    const logs = await Promise.all([host, client, late].map(peer => readHashes(peer.page)));
    const match = commonHash(logs);
    return match && match.tick >= roundTrip.tick ? { ...match, counts: logs.map(list => list.length) } : null;
  }, Boolean, 'same actual lockstep hash on all host/client/late-join Workers after the shuttle trip', 60000);
  const sync = await Promise.all([host, client, late].map(peer => peer.page.evaluate(() => ({ desyncs: window.__zavod.mp.session.desyncs, resyncs: window.__zavod.mp.session.resyncs }))));
  check(!!aligned && sync.every(s => s.desyncs === 0 && s.resyncs === 0),
    `all three Workers agree on the post-shuttle state at tick ${aligned?.tick} (${aligned?.hash}; hash samples ${aligned?.counts?.join('/')}; desync/resync ${sync.map(s => `${s.desyncs}/${s.resyncs}`).join(',')})`);

  const errors = [host, client, late].flatMap(peer => peer?.context?.__railErrors || []);
  check(errors.length === 0, `no uncaught browser errors (${errors.slice(0, 4).join(' | ') || 'none'})`);
} catch (error) {
  failures.push(error.stack || error.message);
  console.error('  ✘', error.stack || error.message);
} finally {
  await late?.context.close().catch(() => {});
  await client?.context.close().catch(() => {});
  await host?.context.close().catch(() => {});
  if (signal && signal.exitCode == null) signal.kill();
  await browser.close();
}

console.log(failures.length ? `\n✘ ${failures.length} rail shuttle multiplayer checks failed` : '\n✔ v1.16 rail shuttle multiplayer journey passed');
process.exit(failures.length ? 1 : 0);

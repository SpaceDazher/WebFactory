// Real multiplayer UI journey for v1.16 management permissions, alert acknowledgements,
// plan ownership, group history, save and late join. Requires `npm run build` first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';

const ROOT = projectRoot(import.meta.url);
const browserName = selectedBrowser('webkit');
const browser = await launchBrowser(browserName);
const shots = path.join(ROOT, 'shots', 'mgmt-mp-v116', browserName);
fs.mkdirSync(shots, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const failures = [];
const check = (condition, message) => { console.log(`  ${condition ? '✔' : '✘'} ${message}`); if (!condition) failures.push(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, predicate, label, timeoutMs = 20000) {
  const start = Date.now(); let lastValue;
  while (Date.now() - start < timeoutMs) { lastValue = await read(); if (predicate(lastValue)) return lastValue; await pause(100); }
  throw new Error(`Timed out waiting for ${label}; last observed state: ${JSON.stringify(lastValue)}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function portReady(port) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const ready = await new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
    if (ready) return; await pause(100);
  }
  throw new Error('local multiplayer signalling server did not start');
}
function watchErrors(page, label, errors) {
  page.on('pageerror', error => errors.push(`${label}: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|WebSocket/.test(message.text())) errors.push(`${label}: ${message.text()}`); });
}
async function loadApp(context, label) {
  const page = await context.newPage(); const errors = context.__mgmtErrors || (context.__mgmtErrors = []); watchErrors(page, label, errors);
  await page.goto(appUrl(import.meta.url, '?render=canvas&gfx=low'));
  await page.waitForFunction(() => window.__texMs != null && window.__zavod && (!window.__zavod.sim || window.__zavod.sim.snaps > 2), null, { timeout: 300000 });
  await page.waitForSelector('.menu-shell', { timeout: 30000 }); return { page, errors };
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
  await page.locator('.menu-nav [data-win="mp"]').click(); await page.waitForSelector('#mpname', { timeout: 10000 }); await page.locator('#mpname').fill(name);
}
async function openWindow(page, name) {
  await page.evaluate(w => { window.__zavod.ui.close(); window.__zavod.ui.toggle(w); }, name);
  await page.waitForSelector('#win', { state: 'visible', timeout: 10000 }); await pause(250);
}
async function tab(page, id) { await page.locator(`[data-act="x-tab"][data-tab="${id}"]`).click(); await pause(250); }
const W = (page, code) => page.evaluate(source => window.__zavod.workerEval(source), code);
async function clearArea(page, x0, y0, x1, y1) {
  await W(page, `for(let y=${y0};y<${y1};y++)for(let x=${x0};x<${x1};x++){const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);if(c.decor[i])g.world.removeDecor(x,y);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;c.mods.delete(i);if(c.decorRemoved)c.decorRemoved.add(i);c.version++;}return true;`);
}
async function planThroughUI(peer, x, y) {
  const page = peer.page; await openWindow(page, 'fact'); await tab(page, 'p');
  await page.locator('#xin-pitem').selectOption('iron-plate');
  await page.locator('#xin-pmode').selectOption('abs');
  await page.locator('#xin-prate').fill('60'); await page.locator('#xin-px').fill(String(x)); await page.locator('#xin-py').fill(String(y));
  await page.locator('[data-act="x-planpreview"]').click();
  await page.waitForFunction(() => /Превью размещения|Placement preview/.test(document.getElementById('win')?.innerText || ''), null, { timeout: 30000 });
  const previewText = await page.locator('#win').innerText();
  if (!(await page.locator('#win [data-act="x-planghost"]').isVisible().catch(() => false))) throw new Error(`plan preview is not acceptable at (${x}, ${y}): ${previewText.slice(-1400)}`);
  const preview = await W(page, `return g.ghosts.size;`);
  await page.locator('#win [data-act="x-planghost"]').click();
  return await until(() => W(page, `return {plans:g.x.plans.map(p=>({id:p.id,by:p.by,ids:p.ids.slice()})),ghosts:g.ghosts.size};`), s => s.plans.length > 0 && s.ghosts > preview, 'accepted plan to replicate');
}
async function saveSnapshot(page, slot) {
  await page.evaluate(saveSlot => window.__zavod.saveTo(saveSlot), slot);
  return await page.evaluate(async saveSlot => {
    const raw = await window.__zavod.store.get(saveSlot); if (!raw) return null;
    if (raw[0] === 'J') return JSON.parse(raw.slice(1)); if (raw[0] === '{') return JSON.parse(raw);
    const bin = atob(raw.slice(1)), bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return JSON.parse(await new Response(stream).text());
  }, slot);
}
async function installHashRecorder(page) {
  await page.evaluate(() => {
    const session = window.__zavod.mp.session;
    if (!session) throw new Error('no MP session to observe');
    window.__mgmtHashLog = [];
    const original = session.onSimHash;
    session.onSimHash = function(tick, hash) { window.__mgmtHashLog.push({ tick, hash }); return original.call(this, tick, hash); };
  });
}
const readHashes = page => page.evaluate(() => window.__mgmtHashLog || []);
function commonHash(logs) {
  const maps = logs.map(list => new Map(list.map(({ tick, hash }) => [tick, hash])));
  for (const tick of [...maps[0].keys()].sort((a, b) => b - a)) {
    const values = maps.map(map => map.get(tick));
    if (values.every(value => value !== undefined) && values.every(value => value === values[0])) return { tick, hash: values[0] };
  }
  return null;
}

let signal = null, host = null, clientA = null, clientB = null, late = null;
const port = await freePort();
try {
  console.log(`Management MP browser journey: ${browserName} ${browser.version()}`);
  signal = spawn(process.execPath, [path.join(ROOT, 'tools', 'signal-server.mjs'), '--port', String(port), '--quiet'], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  await portReady(port);
  host = await openPeer('Management host', port);
  const fixture = await W(host.page, `
    const px=Math.floor(g.player.x),py=Math.floor(g.player.y),cx0=Math.floor(px/32),cy0=Math.floor(py/32);let spot=null;
    for(let ring=0;ring<=8&&!spot;ring++)for(let cy=cy0-ring;cy<=cy0+ring&&!spot;cy++)for(let cx=cx0-ring;cx<=cx0+ring&&!spot;cx++){
      if(Math.max(Math.abs(cx-cx0),Math.abs(cy-cy0))!==ring)continue;
      const c=g.world.getChunk(cx,cy);
      for(let i=0;i<c.res.length;i++)if(c.res[i]===1&&c.amt[i]>0){const x=cx*32+i%32,y=cy*32+Math.floor(i/32);if(g.canPlace('burner-mining-drill',x,y,0,false).ok){spot={x,y};break;}}
    }
    if(!spot)return {error:'no natural iron patch with a valid burner-drill footprint'};
    const c=g.world.chunkAt(spot.x,spot.y),i=g.world.idx(spot.x,spot.y);c.amt[i]=10000;c.mods.set(i,10000);c.av=(c.av||0)+1;c.version++;
    const e=g.build('burner-mining-drill',spot.x,spot.y,0,false);if(!e)return {error:'burner-mining-drill fixture failed'};
    e.fuel={item:'coal',count:10};return {id:e.id,x:e.x,y:e.y,px,py,ore:g.world.res(spot.x,spot.y)};
  `);
  assert.ok(fixture?.id && !fixture.error, fixture?.error || 'burner drill fixture missing');
  host.fixture = fixture;

  await openMp(host.page, 'Management host'); await host.page.locator('#mpmap').selectOption('current'); await host.page.locator('#mpen').selectOption('none');
  await host.page.locator('[data-act="mphost"]').click(); await host.page.waitForFunction(() => !!window.__zavod.mp.code, null, { timeout: 20000 });
  const code = await host.page.evaluate(() => window.__zavod.mp.code);
  clientA = await openPeer('Management player A', port); clientB = await openPeer('Management player B', port);
  for (const peer of [clientA, clientB]) { await openMp(peer.page, peer.name); await peer.page.locator('#mpcode').fill(code); await peer.page.locator('[data-act="mpjoin"]').click(); }
  await host.page.waitForFunction(() => window.__zavod.mp.session?.players.length === 3, null, { timeout: 30000 });
  await Promise.all([clientA, clientB].map(peer => peer.page.waitForFunction(() => window.__zavod.mp.session?.state === 'lobby', null, { timeout: 30000 })));
  await clientA.page.locator('[data-act="mpready"]').click(); await clientB.page.locator('[data-act="mpready"]').click();
  await host.page.waitForFunction(() => { const b=document.querySelector('[data-act="mpstart"]'); return b&&!b.disabled; }, null, { timeout: 15000 });
  await host.page.locator('[data-act="mpstart"]').click();
  await Promise.all([host, clientA, clientB].map(peer => peer.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 })));
  await Promise.all([host, clientA, clientB].map(peer => until(() => peer.page.evaluate(() => ({
    tick: window.__zavod.game.tick, mp: window.__zavod.game.mpv?.mp ?? null, peers: window.__zavod.game.mpv?.peers?.length ?? 0,
  })), state => state.tick > 0 && state.peers === 3 && state.mp !== null, `${peer.name} local MP snapshot`, 15000)));
  await Promise.all([host, clientA, clientB].map(peer => installHashRecorder(peer.page)));
  const peers = await Promise.all([host, clientA, clientB].map(peer => peer.page.evaluate(id => ({
    pl: window.__zavod.game.pl, snapshotMe: window.__zavod.game.mpv?.mp?.me,
    mpv: window.__zavod.game.mpv && { mp: window.__zavod.game.mpv.mp, peers: window.__zavod.game.mpv.peers?.length }, sessionMe: window.__zavod.mp.session?.me,
    peerCount: window.__zavod.mp.session?.players.length, drill: window.__zavod.game.ents.get(id)?.proto,
  }), fixture.id)));
  check(peers.length === 3 && peers.every(p => p.peerCount === 3 && Number.isInteger(p.sessionMe) && p.sessionMe >= 0 && p.sessionMe < 3 && p.snapshotMe === p.sessionMe && p.pl === p.sessionMe) && new Set(peers.map(p => p.sessionMe)).size === 3,
    `three real Workers expose each authenticated player index in the game mirror (${JSON.stringify(peers)})`);

  // Host creates a production group through the real panel and selection helper.
  await openWindow(host.page, 'fact');
  await host.page.evaluate(({ x, y }) => window.__zavod.ui.x.pickRect(x - 2, y - 2, x + 4, y + 4), fixture);
  await host.page.locator('#xin-gnew').fill('North production'); await host.page.locator('[data-act="x-gnew"]').click();
  const group = await until(() => W(host.page, `return Object.values(g.x.groups).map(q=>({id:q.id,by:q.by,name:q.name,members:[...g.ents.values()].filter(e=>e.grp===q.id).map(e=>e.id)}));`), xs => xs.length === 1 && xs[0].members.includes(fixture.id), 'host-created group');
  const gid = group[0].id;
  await until(async () => Promise.all([clientA, clientB].map(peer => W(peer.page, `return g.x.groups[${gid}]?.name;`))), names => names.every(name => name === 'North production'), 'group snapshot to both clients');
  check(group[0].by === 0 && group[0].members.length === 1, `host creates a group containing the actual burner drill through the Groups UI (owner ${group[0].by}, members ${group[0].members})`);

  // Non-admin can read shared group state but cannot rename the host-owned group or create a shared rule.
  await openWindow(clientB.page, 'fact'); await clientB.page.locator(`[data-act="x-gsel"][data-g="${gid}"]`).click();
  await clientB.page.locator('#xin-gname').fill('Unauthorized rename'); await clientB.page.locator('[data-act="x-gren"]').click();
  await clientB.page.locator('[data-act="x-tab"][data-tab="a"]').click(); await clientB.page.locator('#xin-rkind').selectOption('fuel');
  await clientB.page.locator('#xin-rtarget').selectOption(`g:${gid}`); await clientB.page.locator('#xin-rthr').fill('1000'); await clientB.page.locator('#xin-rdur').fill('0');
  await clientB.page.locator('[data-act="x-radd"]').click();
  const rejected = await until(() => W(host.page, `return {name:g.x.groups[${gid}]?.name,rules:g.x.rules.length};`), s => s.name !== 'Unauthorized rename', 'rejected client management commands');
  check(rejected.name === 'North production' && rejected.rules === 0, `ordinary player UI requests are rejected by the authority; group remains owned by host and no alert rule is added (${JSON.stringify(rejected)})`);

  // Host adds a real fuel alert; the actual burner drill is operating from finite coal.
  await openWindow(host.page, 'fact'); await tab(host.page, 'a');
  await host.page.locator('#xin-rkind').selectOption('fuel'); await host.page.locator('#xin-rtarget').selectOption(`g:${gid}`);
  await host.page.locator('#xin-rthr').fill('1000'); await host.page.locator('#xin-rdur').fill('0'); await host.page.locator('#xin-rrem').fill('0');
  await host.page.locator('[data-act="x-radd"]').click();
  await until(() => W(host.page, 'return g.x.rules.length;'), n => n === 1, 'host-created rule to enter the shared world');
  const alert = await until(() => W(host.page, `const rule=g.x.rules[0],a=rule&&g.x.al[rule.id];return a&&{id:a.ev,st:a.st,n:a.n,val:a.val,rule,tick:g.tick,drill:(()=>{const e=g.ents.get(${fixture.id});return e&&{active:e.active,status:e.status,fuel:e.fuel,fuelJ:e.fuelJ,grp:e.grp};})()};`), a => a?.st === 2 && a.id > 0, 'real alert from low fuel on group member', 20000);
  const histories = await until(() => W(host.page, `const s=g.x.gs[${gid}],e=g.ents.get(${fixture.id});return {tick:g.tick,ring:s?.ring.length||0,ore:s?s.ring.reduce((n,q)=>n+(q.p['iron-ore']||0),0):0,cur:s?.cur.p['iron-ore']||0,produced:g.stats.produced['iron-ore']||0,drill:e&&{status:e.status,active:e.active,dc:e.dc,dh:e.dh,lastOre:e.lastOre,lastIt:e.lastIt,fuel:e.fuel,fuelJ:e.fuelJ}};`), h => h.ring > 0 && h.ore + h.cur > 0, 'group production history from Game.step', 30000);
  check(alert.rule.target.t === 'group' && alert.rule.target.id === gid && alert.n === 1 && histories.ore + histories.cur > 0, `normal simulation creates an active fuel alert and persistent group production history (${JSON.stringify({ alert, histories })})`);

  const ev = alert.id;
  for (const peer of [host, clientA, clientB]) { await openWindow(peer.page, 'fact'); await tab(peer.page, 'a'); await peer.page.waitForSelector(`[data-act="x-ack"][data-ev="${ev}"]`, { state: 'visible', timeout: 10000 }); }
  const playerIds = await Promise.all([host, clientA, clientB].map(peer => peer.page.evaluate(() => window.__zavod.mp.session?.me)));
  check(playerIds[0] === 0 && playerIds.every(id => Number.isInteger(id) && id >= 0 && id < 3) && new Set(playerIds).size === 3,
    `alert acknowledgement probes use each authenticated multiplayer session index (${playerIds.join(',')})`);
  await clientA.page.locator(`[data-act="x-ack"][data-ev="${ev}"]`).click();
  await until(() => W(clientA.page, `return (g.x.ack[${playerIds[1]}]||[]).includes(${ev});`), Boolean, 'player A acknowledgement to replicate');
  const acks = await Promise.all([host, clientA, clientB].map(async (peer, i) => ({
    pl: playerIds[i], ...(await W(peer.page, `return {ack:g.x.ack[${playerIds[i]}]||[],ackKeys:Object.keys(g.x.ack),active:g.x.al[${alert.rule.id}]?.st};`)),
  })));
  check(acks[1].ack.includes(ev) && !acks[0].ack.includes(ev) && !acks[2].ack.includes(ev) && acks.every(a => a.active === 2), `acknowledging on player A clears only that player's notification; host and player B retain active unacknowledged alert (${JSON.stringify(acks)})`);
  await clientA.page.waitForSelector(`[data-act="x-ack"][data-ev="${ev}"]`, { state: 'detached', timeout: 10000 });
  check(await host.page.locator(`[data-act="x-ack"][data-ev="${ev}"]`).count() === 1 && await clientB.page.locator(`[data-act="x-ack"][data-ev="${ev}"]`).count() === 1,
    'real UI keeps the confirmation button visible to unacknowledged players only');

  // Each player accepts a real planner preview through the UI. Undo is owner-scoped.
  const planX1 = fixture.px + 20, planX2 = fixture.px + 115, planY = fixture.py + 28;
  // мир у каждого участника свой: прямая правка ландшафта не реплицируется, а генерация 1.16 ставит здесь воду
  for (const peer of [host, clientA, clientB]) await clearArea(peer.page, fixture.px + 10, planY - 5, fixture.px + 195, planY + 100);
  const hostPlan = await planThroughUI(host, planX1, planY);
  const clientPlan = await planThroughUI(clientA, planX2, planY);
  const planState = await W(host.page, `return {plans:g.x.plans.map(p=>({id:p.id,by:p.by,ids:p.ids.slice()})),ghosts:[...g.ghosts.keys()]};`);
  const ownHost = planState.plans.find(p => p.by === playerIds[0]), ownClient = planState.plans.find(p => p.by === playerIds[1]);
  check(ownHost && ownClient && ownHost.ids.length > 0 && ownClient.ids.length > 0 && hostPlan.plans.length > 0 && clientPlan.plans.length > 0,
    `host and client A accept independent real plan previews (${JSON.stringify(planState.plans.map(p => ({ id: p.id, by: p.by, count: p.ids.length })))})`);
  await openWindow(clientA.page, 'fact'); await tab(clientA.page, 'p');
  await clientA.page.waitForSelector(`#win [data-act="x-planundo"][data-id="${ownClient.id}"]`, { state: 'visible', timeout: 10000 });
  check(await clientA.page.locator(`#win [data-act="x-planundo"][data-id="${ownHost.id}"]`).count() === 0,
    'client UI exposes its own undo and no undo control for the host plan');
  await clientA.page.locator(`#win [data-act="x-planundo"][data-id="${ownClient.id}"]`).click();
  const afterClientUndo = await until(() => W(host.page, `return {plans:g.x.plans.map(p=>({id:p.id,by:p.by,ids:p.ids.slice()})),ghosts:[...g.ghosts.keys()]};`), s => !s.plans.some(p => p.id === ownClient.id), "client's own plan undo");
  check(afterClientUndo.plans.some(p => p.id === ownHost.id) && ownHost.ids.every(id => afterClientUndo.ghosts.includes(id)),
    `client A undo removes only its own ghosts; host action ${ownHost.id} remains intact`);
  await openWindow(host.page, 'fact'); await tab(host.page, 'p');
  await host.page.locator(`#win [data-act="x-planundo"][data-id="${ownHost.id}"]`).click();
  await until(() => W(host.page, 'return g.x.plans.length === 0 && g.ghosts.size === 0;'), Boolean, "host's own plan undo");

  const slot = `mgmt-mp-e2e-${Date.now()}`;
  const saved = await saveSnapshot(host.page, slot);
  const savedMgmt = saved?.x && { group: saved.x.groups?.[gid], history: saved.x.gs?.[gid], alert: saved.x.al?.[alert.rule.id], ackA: saved.x.ack?.[playerIds[1]], plans: saved.x.plans };
  check(!!savedMgmt?.group && !!savedMgmt.history?.ring?.length && savedMgmt.alert?.st === 2 && savedMgmt.ackA?.includes(ev) && savedMgmt.plans?.length === 0,
    `save snapshot persists group history, active alert, player-specific ack and fully undone plans (${JSON.stringify({ group: !!savedMgmt?.group, history: savedMgmt?.history?.ring?.length, alert: savedMgmt?.alert?.st, ackA: savedMgmt?.ackA, plans: savedMgmt?.plans?.length })})`);

  late = await openPeer('Management late join', port); await openMp(late.page, late.name); await late.page.locator('#mpcode').fill(code); await late.page.locator('[data-act="mpjoin"]').click();
  await late.page.waitForFunction(() => window.__zavod.mp.inGame, null, { timeout: 60000 });
  const latePlayerId = await late.page.evaluate(() => window.__zavod.mp.session?.me);
  const lateState = await until(() => W(late.page, `const s=g.x.gs[${gid}],a=g.x.al[${alert.rule.id}];return {tick:g.tick,group:g.x.groups[${gid}],history:s&&{ring:s.ring.length,ore:s.ring.reduce((n,q)=>n+(q.p['iron-ore']||0),0)},alert:a&&{st:a.st,ev:a.ev},ackA:g.x.ack[${playerIds[1]}]||[],ackOwn:g.x.ack[${latePlayerId}]||[],ackKeys:Object.keys(g.x.ack),plans:g.x.plans.length,ghosts:g.ghosts.size};`), s => s.group && s.alert?.st === 2, 'late join snapshot with group and alert', 30000);
  check(Number.isInteger(latePlayerId) && latePlayerId >= 0 && latePlayerId < 16 && lateState.group.name === 'North production' && lateState.history?.ring > 0 && lateState.history.ore > 0 && lateState.ackA.includes(ev) && !lateState.ackOwn.includes(ev) && !lateState.plans && !lateState.ghosts,
    `fresh browser hot-joins with shared group history/active alert, preserved player A ack, its own unacknowledged alert and no undone plans (me=${latePlayerId}; ${JSON.stringify(lateState)})`);
  await openWindow(late.page, 'fact'); await tab(late.page, 'a');
  await late.page.waitForSelector(`[data-act="x-ack"][data-ev="${ev}"]`, { state: 'visible', timeout: 10000 });
  check(true, 'late-joining player sees the active alert as unacknowledged for its own player index');
  await installHashRecorder(late.page);
  await host.page.screenshot({ path: path.join(shots, 'management-host.png') }); await late.page.screenshot({ path: path.join(shots, 'management-late-join-alert.png') });

  const aligned = await until(async () => {
    const logs = await Promise.all([host, clientA, clientB, late].map(peer => readHashes(peer.page)));
    const match = commonHash(logs);
    return match && match.tick >= lateState.tick ? { ...match, counts: logs.map(list => list.length) } : null;
  }, Boolean, 'same actual lockstep hash on all four browser peers after management actions and late join', 60000);
  check(!!aligned, `all four Worker clients report the same real state hash after history/ack/plan/save/late join at tick ${aligned.tick} (${aligned.hash}; records ${aligned.counts.join('/')})`);

  const errors = [host, clientA, clientB, late].flatMap(peer => peer?.context?.__mgmtErrors || []);
  check(errors.length === 0, `no uncaught browser page/console errors (${errors.slice(0, 4).join(' | ') || 'none'})`);
} catch (error) {
  failures.push(error.stack || error.message); console.error('  ✘', error.stack || error.message);
} finally {
  await late?.context.close().catch(() => {}); await clientB?.context.close().catch(() => {}); await clientA?.context.close().catch(() => {}); await host?.context.close().catch(() => {});
  if (signal && signal.exitCode == null) signal.kill(); await browser.close();
}

console.log(failures.length ? `\n✘ ${failures.length} management MP browser checks failed` : '\n✔ v1.16 management multiplayer browser journey passed');
process.exit(failures.length ? 1 : 0);

// Focused real-browser regression checks for MP snapshots, late join, same-page
// reconnect, and movement. Uses the report save as data; never prints it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, selectedBrowser, appUrl, projectRoot } from './browser.mjs';

const ROOT = projectRoot(import.meta.url);
const fixture = fs.readFileSync(path.join(ROOT, 'integration-logs/mp-bugfix-20261014/fixtures/zavod7-bug-20261013-2140.json'), 'utf8');
const saveTick = JSON.parse(fixture).tick;
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const browserName = selectedBrowser('chromium');
const browser = await launchBrowser(browserName, { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errors = [];
let host = null, client = null, late = null, phase = 'startup';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(condition, message) { console.log(`  ${condition ? 'PASS' : 'FAIL'} ${message}`); assert.ok(condition, message); }
async function openPeer(name, port, local = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await context.addInitScript(({ port, version, name }) => {
    localStorage.setItem('zavod7:seenVersion', version);
    localStorage.setItem('zavod7:settings', JSON.stringify({ simWorker: true, mpName: name, mpServer: `ws://127.0.0.1:${port}`, tips: false, lang: 'ru', renderer: 'canvas', leaveGuard: false }));
  }, { port, version, name });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.name || 'Error'));
  await page.goto(appUrl(import.meta.url, `?render=canvas&gfx=low${local ? '&local' : ''}`));
  await page.waitForFunction(() => window.__texMs != null && window.__zavod && (window.__zavod.sim ? window.__zavod.sim.snaps > 2 : true), null, { timeout: 300000 });
  await page.waitForSelector('.menu-shell', { timeout: 30000 });
  return { context, page, name };
}
const W = (page, source) => page.evaluate(code => window.__zavod.workerEval(code), source);
async function waitForGame(page, timeout = 60000) {
  await page.waitForFunction(() => window.__zavod?.mp?.inGame, null, { timeout });
}

try {
  phase = 'user-save worker snapshot';
  const workerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await workerContext.addInitScript(({ version }) => {
    localStorage.setItem('zavod7:seenVersion', version);
    localStorage.setItem('zavod7:settings', JSON.stringify({ simWorker: true, tips: false, lang: 'ru', renderer: 'canvas', leaveGuard: false }));
  }, { version });
  const workerPage = await workerContext.newPage();
  workerPage.on('pageerror', error => errors.push(error.name || 'Error'));
  await workerPage.goto(appUrl(import.meta.url, '?render=canvas&gfx=low'));
  await workerPage.waitForFunction(() => window.__texMs != null && window.__zavod?.sim?.snaps > 2, null, { timeout: 300000 });
  await workerPage.evaluate(async save => {
    const z = window.__zavod;
    await z.ui.h.loadSaveString(save);
    z.ui.close();
    z.settings.fpsCap = 0;
  }, fixture);
  // Playwright polls the immediate predicate result: a Promise is truthy even
  // when it later resolves to false. Readiness predicates must be synchronous;
  // inspect the authoritative Worker only after the UI mirror is populated.
  await workerPage.waitForFunction(minTick => {
    const z = window.__zavod;
    return !!z?.sim && z.game.ents.size > 5000 && z.game.tick >= minTick && z.sim.errors.length === 0;
  }, saveTick + 60, { timeout: 300000 });
  const workerState = await workerPage.evaluate(async () => {
    const z = window.__zavod, source = await z.workerEval(`return {n:g.ents.size,tick:g.tick,cache:[...g.ents.values()].some(e=>e._tg||e._fd||e._io)}`);
    return { source, mirror: z.game.ents.size, snaps: z.sim.snaps, errors: z.sim.errors.length };
  });
  check(workerState.source.n > 5000 && workerState.source.cache && workerState.mirror >= workerState.source.n && workerState.errors === 0,
    `native browser cloned the stepped report save after its runtime cache was observed (${workerState.source.n} source / ${workerState.mirror} mirror entities; worker errors ${workerState.errors})`);
  await workerContext.close();

  phase = 'user-save main-thread mode';
  const localContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
  await localContext.addInitScript(({ version }) => {
    localStorage.setItem('zavod7:seenVersion', version);
    localStorage.setItem('zavod7:settings', JSON.stringify({ simWorker: true, tips: false, lang: 'ru', renderer: 'canvas', leaveGuard: false }));
  }, { version });
  const localPage = await localContext.newPage();
  localPage.on('pageerror', error => errors.push(error.name || 'Error'));
  await localPage.goto(appUrl(import.meta.url, '?render=canvas&gfx=low&local'));
  await localPage.waitForFunction(() => window.__texMs != null && window.__zavod && !window.__zavod.sim, null, { timeout: 300000 });
  await localPage.evaluate(async save => {
    const z = window.__zavod;
    await z.ui.h.loadSaveString(save);
    z.ui.close();
  }, fixture);
  await localPage.waitForFunction(() => window.__zavod?.game?.ents?.size > 5000, null, { timeout: 300000 });
  const localState = await localPage.evaluate(() => ({ entities: window.__zavod.game.ents.size, tick: window.__zavod.game.tick, worker: !!window.__zavod.sim }));
  check(localState.entities > 5000 && !localState.worker, `native browser loaded the report save in main-thread mode (${localState.entities} entities)`);
  await localContext.close();

  phase = 'manual-code WebRTC join and movement';
  // Manual codes carry the SDP directly; no signaling server, relay, or external service is involved.
  const port = 0;
  phase = 'host and client startup';
  host = await openPeer('Bugfix host', port);
  client = await openPeer('Bugfix player', port);
  await host.page.evaluate(async save => {
    const z = window.__zavod;
    await z.ui.h.loadSaveString(save);
    z.ui.close(); z.ui.toggle('menu'); z.settings.fpsCap = 0;
  }, fixture);
  await host.page.waitForFunction(() => {
    const z = window.__zavod;
    return !!z?.sim && z.sim.errors.length === 0 && z.game.ents.size > 5000 && z.game.tick > 0;
  }, null, { timeout: 300000 });
  const hostSaveState = await W(host.page, 'return {n:g.ents.size,tick:g.tick};');
  check(hostSaveState.n > 5000, `manual WebRTC host has the report world loaded (${hostSaveState.n} entities)`);
  phase = 'create hosted room';
  await host.page.locator('.menu-nav [data-win="mp"]').click();
  await host.page.waitForSelector('#mpname', { timeout: 10000 });
  await host.page.locator('#mpmap').selectOption('current');
  await host.page.locator('#mpen').selectOption('none');
  await host.page.locator('[data-act="mphostm"]').click();
  await host.page.waitForFunction(() => window.__zavod.mp.session?.state === 'lobby' && window.__zavod.mp.isHost, null, { timeout: 20000 });
  let code = await host.page.evaluate(() => window.__zavod.mp.makeInvite());
  check(code.startsWith('Z7O'), 'host generated a manual Z7O invitation');
  phase = 'manual Z7A answer';
  const focusStateBefore = await client.page.evaluate(() => {
    const z = window.__zavod;
    if (z.ui.open !== 'mp') z.ui.toggle('mp');
    const name = document.querySelector('#mpname'); name.focus();
    z.ui.close();
    const closed = z.ui.open === null && !document.querySelector('#win')?.contains(document.activeElement);
    z.ui.toggle('menu');
    return { closed, focusedTag: document.activeElement?.tagName, menuOpen: z.ui.open === 'menu' };
  });
  check(focusStateBefore.closed && focusStateBefore.menuOpen, 'closing the MP window releases its input focus before the game starts');
  let answer = await client.page.evaluate(invite => window.__zavod.mp.answerInvite(invite), code);
  check(answer.startsWith('Z7A'), 'client generated a manual Z7A answer');
  await host.page.evaluate(answerCode => window.__zavod.mp.acceptAnswer(answerCode), answer);
  await Promise.all([
    host.page.waitForFunction(() => window.__zavod.mp.manual.some(m => m.phase === 'open') && window.__zavod.mp.session?.players.length === 2, null, { timeout: 60000 }),
    client.page.waitForFunction(() => window.__zavod.mp.manual.some(m => m.phase === 'open') && window.__zavod.mp.session?.state === 'lobby', null, { timeout: 60000 }),
  ]);
  await client.page.evaluate(() => window.__zavod.mp.session.setReady(true));
  await host.page.waitForFunction(() => { const b = document.querySelector('[data-act="mpstart"]'); return b && !b.disabled; }, null, { timeout: 15000 });
  phase = 'start multiplayer game';
  await host.page.locator('[data-act="mpstart"]').click();
  await waitForGame(host.page); await waitForGame(client.page);
  const afterStart = await client.page.evaluate(() => ({
    uiOpen: window.__zavod.ui.open,
    lost: performance.now() < window.__zavod.mpui.lostUntil,
  }));
  check(afterStart.uiOpen === null && !afterStart.lost,
    `client start closes the menu without a false lost-connection warning (window ${afterStart.uiOpen || 'closed'}, lost ${afterStart.lost})`);
  const playerIndex = await host.page.evaluate(name => window.__zavod.mp.session.players.findIndex(player => player.name === name), client.name);
  assert.ok(playerIndex > 0, 'joined player has a host-side character slot');
  phase = 'movement after initial join';
  await client.page.bringToFront();
  const initialMovement = [];
  for (const key of ['a', 'w', 's', 'd']) {
    const start = await W(host.page, `const p=g.peer(${playerIndex}).player;return {x:p.x,y:p.y};`);
    await client.page.keyboard.down(key); await sleep(500); await client.page.keyboard.up(key); await sleep(120);
    const end = await W(host.page, `const p=g.peer(${playerIndex}).player;return {x:p.x,y:p.y};`);
    initialMovement.push({ key, distance: Math.hypot(end.x - start.x, end.y - start.y) });
  }
  const focusState = await client.page.evaluate(() => ({ tag: document.activeElement?.tagName, inWindow: !!document.querySelector('#win')?.contains(document.activeElement) }));
  check(initialMovement.some(sample => sample.distance > 0.2),
    `player can walk after joining without restarting the page (directions ${JSON.stringify(initialMovement)}, focus ${focusState.tag || 'none'}, in window ${focusState.inWindow})`);

  phase = 'same-page second manual connection';
  await client.page.evaluate(() => window.__zavod.mp.close());
  code = await host.page.evaluate(() => window.__zavod.mp.makeInvite());
  answer = await client.page.evaluate(invite => window.__zavod.mp.answerInvite(invite), code);
  await host.page.evaluate(answerCode => window.__zavod.mp.acceptAnswer(answerCode), answer);
  await waitForGame(client.page);
  await host.page.waitForFunction(() => window.__zavod.mp.session?.state === 'game' && !window.__zavod.mp.session.paused && !window.__zavod.mp.session.players.some(p => p.join), null, { timeout: 30000 });
  await client.page.waitForFunction(() => window.__zavod.mp.inGame && window.__zavod.game.pl === window.__zavod.mp.session.me && window.__zavod.sim.errors.length === 0, null, { timeout: 30000 });
  const samePage = await client.page.evaluate(() => ({ inGame: window.__zavod.mp.inGame, errors: window.__zavod.sim.errors.length, snaps: window.__zavod.sim.snaps }));
  check(samePage.inGame && samePage.errors === 0, 'same page reconnects to the running room after leaving');
  const beforeAgain = await W(host.page, `const q=g.peers[${playerIndex}],p=q.player;return {x:p.x,y:p.y,walking:p.walking,input:q.input,off:q.off,tick:g.tick,peerCount:g.peers.length};`);
  const clientBeforeAgain = await client.page.evaluate(() => ({ x: window.__zavod.game.player.x, y: window.__zavod.game.player.y, pl: window.__zavod.game.pl, tick: window.__zavod.game.tick, me: window.__zavod.mp.session.me }));
  check(clientBeforeAgain.me === playerIndex, `same-page manual reconnect returned to its prior player slot ${playerIndex}`);
  // Observe actual lockstep frames at the client callback and host Worker boundary.
  await client.page.evaluate(() => {
    window.__inputProbe = [];
    window.__clientFrames = [];
    const session = window.__zavod.mp.session;
    const onSimFrame = session.onSimFrame.bind(session);
    session.onSimFrame = frame => {
      window.__clientFrames.push({ t: frame.t, p: frame.p, input: frame.c.filter(c => c?.t === 'input').map(c => [c.mx, c.my]) });
      onSimFrame(frame);
    };
    const sim = window.__zavod.sim, post = sim.post.bind(sim);
    sim.post = message => { if (message.t === 'cmd' && message.c?.t === 'input') window.__inputProbe.push([message.c.mx, message.c.my]); post(message); };
    window.addEventListener('keydown', event => { if (event.code === 'KeyS') window.__sKeySeen = true; }, true);
  });
  await host.page.evaluate(() => {
    window.__hostFrames = [];
    const session = window.__zavod.mp.session, simFrame = session.sim.frame.bind(session.sim);
    session.sim.frame = frame => {
      window.__hostFrames.push({ t: frame.t, p: frame.p, input: frame.c.filter(c => c?.t === 'input').map(c => [c.mx, c.my]) });
      simFrame(frame);
    };
  });
  await client.page.bringToFront();
  const movementSamples = [];
  for (const key of ['a', 'w', 's', 'd']) {
    const start = await W(host.page, `const p=g.peer(${playerIndex}).player,q=g.peers[${playerIndex}];return {x:p.x,y:p.y,dead:p.dead,hp:p.hp,veh:p.veh,off:q.off,input:q.input};`);
    await client.page.keyboard.down(key); await sleep(500);
    const during = await W(host.page, `const p=g.peer(${playerIndex}).player,q=g.peers[${playerIndex}];return {x:p.x,y:p.y,walking:p.walking,dead:p.dead,hp:p.hp,veh:p.veh,off:q.off,input:q.input,blocked:[g.blocked(p.x-0.15,p.y),g.blocked(p.x+0.15,p.y),g.blocked(p.x,p.y-0.15),g.blocked(p.x,p.y+0.15)]};`);
    await client.page.keyboard.up(key); await sleep(120);
    const end = await W(host.page, `const p=g.peer(${playerIndex}).player;return {x:p.x,y:p.y};`);
    movementSamples.push({ key, distance: Math.hypot(end.x - start.x, end.y - start.y), start, during });
  }
  const afterAgain = await W(host.page, `const q=g.peers[${playerIndex}],p=g.peer(${playerIndex}).player;return {x:p.x,y:p.y,walking:p.walking,input:q.input,off:q.off,tick:g.tick,peerCount:g.peers.length};`);
  const clientAfterAgain = await client.page.evaluate(() => ({ x: window.__zavod.game.player.x, y: window.__zavod.game.player.y, pl: window.__zavod.game.pl, tick: window.__zavod.game.tick, me: window.__zavod.mp.session.me }));
  const clientInputProbe = await client.page.evaluate(() => ({ keySeen: !!window.__sKeySeen, inputs: window.__inputProbe,
    frames: window.__clientFrames.filter(frame => frame.input.length), lastFrames: window.__clientFrames.slice(-8) }));
  const hostFrameProbe = await host.page.evaluate(() => window.__hostFrames.filter(frame => frame.input.length));
  const rejoinInput = await client.page.evaluate(() => ({
    uiOpen: window.__zavod.ui.open,
    focusTag: document.activeElement?.tagName || 'none',
    focusedInWindow: !!document.querySelector('#win')?.contains(document.activeElement),
    lost: performance.now() < window.__zavod.mpui.lostUntil,
    session: window.__zavod.mp.session?.state || 'none',
  }));
  const rejoinDistance = movementSamples.some(sample => sample.distance > 0.2);
  check(rejoinDistance, `movement works after the same-page second connection (directions ${JSON.stringify(movementSamples)}, key ${clientInputProbe.keySeen}, inputs ${JSON.stringify(clientInputProbe.inputs)}, client frames ${JSON.stringify(clientInputProbe.frames.slice(-8))}, host frames ${JSON.stringify(hostFrameProbe.slice(-8))}, UI ${rejoinInput.uiOpen || 'closed'}, focus ${rejoinInput.focusTag}/${rejoinInput.focusedInWindow}, lost ${rejoinInput.lost}, host ${beforeAgain.tick}->${afterAgain.tick}, client ${JSON.stringify(clientBeforeAgain)}->${JSON.stringify(clientAfterAgain)}, peer ${playerIndex}/${afterAgain.peerCount}, off ${afterAgain.off})`);

  phase = 'late join to running game';
  late = await openPeer('Bugfix late join', port);
  await late.page.evaluate(() => {
    const z = window.__zavod, sim = z.sim, prior = sim.onReset;
    const probe = { resets: 0, resetMessages: [], snapMessages: 0, snapSamples: [], requests: 0, outboundStart: 0, lastSnapTick: -1, lastSnapFull: -1 };
    window.__snapshotProbe = probe;
    window.__resetCount = 0;
    sim.onReset = (...args) => { window.__resetCount++; probe.resets++; probe.resetMessages.push({ entities: sim.g.ents.size, tick: sim.g.tick }); prior?.(...args); };
    const onMsg = sim.onMsg.bind(sim), request = sim.request.bind(sim), post = sim.post.bind(sim);
    sim.onMsg = message => {
      if (message?.t === 'reset') probe.resetMessages.push({ entities: sim.g.ents.size, tick: sim.g.tick, seed: message.seed });
      if (message?.t === 'snap') {
        probe.snapMessages++; probe.lastSnapTick = message.s?.tick ?? -1; probe.lastSnapFull = message.s?.full?.length ?? -1;
        if (probe.snapSamples.length < 4 || message.s?.tick > 0 || message.s?.full?.length > 0) {
          if (probe.snapSamples.length < 30) probe.snapSamples.push({ tick: message.s?.tick, full: message.s?.full?.length, dyn: message.s?.dyn?.length, mirrorBefore: sim.g.ents.size });
        }
      }
      return onMsg(message);
    };
    sim.post = message => { if (message?.t === 'mp' && message.k === 'start') probe.outboundStart++; post(message); };
    sim.request = (...args) => { probe.requests++; return request(...args); };
    probe.snapsBefore = sim.snaps; probe.requestsBefore = probe.requests;
  });
  const lateAnswer = await late.page.evaluate(invite => window.__zavod.mp.answerInvite(invite), code = await host.page.evaluate(() => window.__zavod.mp.makeInvite()));
  await host.page.evaluate(answerCode => window.__zavod.mp.acceptAnswer(answerCode), lateAnswer);
  await waitForGame(late.page);
  await host.page.waitForFunction(() => window.__zavod.mp.session?.state === 'game' && !window.__zavod.mp.session.paused && !window.__zavod.mp.session.players.some(p => p.join), null, { timeout: 30000 });
  await late.page.bringToFront();
  await late.page.waitForFunction(() => {
    const z = window.__zavod;
    return !!z?.sim && z.sim.errors.length === 0 && z.game.ents.size > 5000 && z.game.tick > 0
      && !!z.mp.session && z.mp.session.state === 'game' && z.game.pl === z.mp.session.me;
  }, null, { timeout: 60000, polling: 1000 });
  const lateState = await late.page.evaluate(async () => {
    const z = window.__zavod;
    const me = z.mp.session.me;
    const worker = await z.workerEval(`const p=g.peer(${me}).player;return {n:g.ents.size,tick:g.tick,freePower:g.freePower,enemies:g.settings.enemies,player:{x:g.player.x,y:g.player.y},peer:{x:p.x,y:p.y}};`);
    const p = z.game.peer(me).player, mp = z.sim.g.peer(me).player;
    const raf = z.frameCost();
    return { worker, me, mirror: z.game.ents.size, mirrorTick: z.game.tick, mirrorPl: z.game.pl, mirrorPeer: { x: p.x, y: p.y },
      gameIsSimG: z.game === z.sim.g, simMirror: { entities: z.sim.g.ents.size, tick: z.sim.g.tick, pl: z.sim.g.pl, peer: { x: mp.x, y: mp.y } },
      snaps: z.sim.snaps, snapsBefore: window.__snapshotProbe.snapsBefore, nFull: z.sim.nFull, nDyn: z.sim.nDyn, resets: window.__resetCount,
      probe: window.__snapshotProbe,
      inflight: z.sim.inflight, lastSnapAge: performance.now() - z.sim.lastSnap, visible: document.visibilityState, hidden: document.hidden,
      hasFocus: document.hasFocus(), raf: raf.n, resyncs: z.mp.session.resyncs, desyncs: z.mp.session.desyncs, errors: z.sim.errors.length };
  });
  const hostWorld = await host.page.evaluate(async () => window.__zavod.workerEval('return {tick:g.tick,freePower:g.freePower,enemies:g.settings.enemies,entities:g.ents.size};'));
  // workerEval and rendering run asynchronously on a live world. Compare the
  // slot and bound the snapshot age; exact ticks/coordinates across threads
  // are not an atomic observation.
  const currentMirror = lateState.mirrorTick > 0
    && Math.abs(lateState.worker.tick - lateState.mirrorTick) <= 120
    && lateState.lastSnapAge < 2000 && lateState.me === lateState.mirrorPl;
  check(lateState.worker.n > 5000 && lateState.mirror === lateState.worker.n && lateState.errors === 0
    && currentMirror && lateState.resets === 1
    && lateState.resyncs === 0 && lateState.desyncs === 0
    && lateState.worker.freePower === hostWorld.freePower && lateState.worker.enemies === hostWorld.enemies,
    `new page joined the running report world from normal UI frames with a current mirror, one load reset, matching peer slot/options, and no desync/resync (${JSON.stringify({ lateState, hostWorld })})`);
  const transports = await Promise.all([host, client, late].map(peer => peer.page.evaluate(() => window.__zavod.mp.kinds.slice())));
  check(transports.flat().some(kind => kind === 'rtc'), 'manual-code browser multiplayer established a WebRTC data channel');
  console.log('  Transport: manual-code WebRTC direct');
  phase = 'leave multiplayer without losing the local mirror';
  await client.page.evaluate(() => {
    const sim = window.__zavod.sim, prior = sim.onReset;
    window.__leaveReset = false;
    sim.onReset = (...args) => { window.__leaveReset = true; prior?.(...args); };
    window.__zavod.mp.close();
  });
  await client.page.bringToFront();
  await client.page.waitForFunction(() => window.__leaveReset, null, { timeout: 10000 });
  await client.page.waitForFunction(() => window.__zavod.game.ents.size > 5000 && window.__zavod.game.tick > 0, null, { timeout: 15000 });
  check(await client.page.evaluate(() => !window.__zavod.mp.inGame && window.__zavod.sim.errors.length === 0),
    'leaving multiplayer keeps the report world visible in single player after the reset');
  check(errors.length === 0, `no page errors (${errors.length})`);
} catch (error) {
  const transport = await Promise.all([host, client, late].filter(Boolean).map(async peer => {
    try {
      return await peer.page.evaluate(() => ({
        state: window.__zavod.mp.session?.state || 'none',
        players: window.__zavod.mp.session?.players.length || 0,
        kinds: window.__zavod.mp.kinds.map(kind => kind === 'rtc' || kind === 'relay'),
        manual: window.__zavod.mp.manual.map(m => ({ role: m.role, phase: m.phase, connection: m.rc.pc.connectionState, ice: m.rc.pc.iceConnectionState })),
      }));
    } catch { return { state: 'unavailable' }; }
  }));
  if (transport.length) console.error(`Transport states: ${JSON.stringify(transport)}`);
  console.error(`FAIL at ${phase}: ${error?.name || 'Error'} (diagnostic details withheld)`);
  process.exitCode = 1;
} finally {
  await late?.context.close().catch(() => {});
  await client?.context.close().catch(() => {});
  await host?.context.close().catch(() => {});
  await browser.close();
}

// Opt-in integration check of the actual packaged process; never installs the Windows app.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { basename, join, resolve, sep } from 'node:path';
import { Game } from '../src/sim/game.ts';
import { serialize, deserialize } from '../src/sim/save.ts';
import { quickHash } from '../src/sim/nethash.ts';
import { newScenario } from '../src/sim/scenario.ts';
import { encodeNativeJson, decodeNativeJson } from '../src/net/native-protocol.ts';

const root = resolve('logs/verify-20261019');
await access(resolve('dist/native/server.mjs'));
const runtime = resolve('dist/native/node.exe');
await access(runtime);
await mkdir(root, { recursive: true });
const probes = [createServer(), createServer()];
await Promise.all(probes.map(s => new Promise((ok, fail) => { s.once('error', fail); s.listen(0, '127.0.0.1', ok); })));
const [controlPort, playPort] = probes.map(s => s.address().port);
await Promise.all(probes.map(s => new Promise((ok, fail) => s.close(error => error ? fail(error) : ok()))));
const data = await mkdtemp(join(root, 'native-smoke-'));
const relay = process.argv.includes('--relay') ? await (await import('./native-relay-v117.mjs')).startAcceptanceRelay(root, runtime) : null;
const child = spawn(runtime, [resolve('dist/native/server.mjs')], {
  cwd: resolve('dist/native'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ZAVOD_DATA_DIR: data, ZAVOD_CONTROL_PORT: String(controlPort), ZAVOD_PLAY_PORT: String(playPort), ZAVOD_CONTROL_BIND: '127.0.0.1', ZAVOD_PUBLIC_ORIGIN: '', ZAVOD_RELAY_ORIGIN: '',
    ZAVOD_RELAY_URL: relay?.hostUrl || '', ZAVOD_RELAY_PUBLIC_ORIGIN: relay?.origin || '', ZAVOD_RELAY_HOST_TOKEN: '',
    ...(relay ? { NODE_EXTRA_CA_CERTS: relay.caPath } : {}) },
});
let stderr = '', timer;
child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr = (stderr + text).slice(-4000); });
const redact = text => text.replace(/local-admin=[A-Za-z0-9_-]+/g, 'local-admin=[redacted]')
  .replace(/server-invite=[A-Za-z0-9_-]+/g, 'server-invite=[redacted]').replace(/\/r\/[A-HJ-NP-Z2-9]{10}\//g, '/r/[redacted]/');
try {
  const capability = await new Promise((ok, fail) => {
    let output = '';
    timer = setTimeout(() => fail(new Error('Native bootstrap timed out: ' + redact(stderr))), 30000);
    child.once('error', fail);
    child.once('exit', code => fail(new Error('Native process exited before readiness (' + code + '): ' + redact(stderr))));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', text => {
      output = (output + text).slice(-4000);
      const match = /local-admin=([A-Za-z0-9_-]{32,128})/.exec(output);
      if (match) { clearTimeout(timer); ok(match[1]); }
    });
  });
  const origin = `http://127.0.0.1:${controlPort}`;
  const request = (path, options = {}) => fetch(origin + '/api/v1' + path, { ...options, headers: { Origin: origin, ...options.headers }, signal: AbortSignal.timeout(5000) });
  assert.equal((await request('/status')).status, 401, 'no controller state without authorization');
  assert.equal((await request('/bootstrap', { method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ capability }) })).status, 403, 'a foreign Origin cannot consume the launch capability');
  const response = await request('/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability }) });
  assert.equal(response.status, 200);
  const credentials = await response.json();
  assert.ok(typeof credentials.token === 'string' && credentials.token.length >= 32, 'controller bearer issued');
  assert.ok(typeof credentials.csrf === 'string' && credentials.csrf.length >= 32, 'CSRF secret issued');
  assert.match(credentials.serverId, /^[a-f0-9]{64}$/);
  const status = await request('/status', { headers: { Authorization: 'Bearer ' + credentials.token } });
  assert.equal(status.status, 200);
  const state = await status.json();
  assert.equal(state.controller.state, 'stopped'); assert.equal(state.world, null);
  assert.equal((await request('/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability }) })).status, 401, 'launch capability is one-use');
  assert.equal((await request('/pause', { method: 'POST', headers: { Authorization: 'Bearer ' + credentials.token, 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'a bearer without CSRF cannot mutate control state');
  const headers = { Authorization: 'Bearer ' + credentials.token, 'X-CSRF-Token': credentials.csrf, 'Content-Type': 'application/json' };
  const getStatus = async () => {
    const response = await request('/status', { headers }); assert.equal(response.status, 200); return response.json();
  };
  const mutate = async (path, body, expectedStatus = 200) => {
    const response = await request(path, { method: 'POST', headers, body: encodeNativeJson(body) });
    const result = await response.json();
    assert.equal(response.status, expectedStatus, path + ' response' + (response.status === expectedStatus ? '' : ': ' + redact(String(result.message || ''))));
    return result;
  };
  const created = await mutate('/start', { requestId: randomUUID(), expectedRevision: state.revision, world: { mode: 'new', name: 'Native new-world acceptance' } });
  assert.equal((await getStatus()).world.id, created.worldId, 'a new dedicated world creates its existing owner seat');
  const initialStop = await mutate('/stop', { requestId: randomUUID(), expectedRevision: created.revision });
  const scripted = process.argv.includes('--scripts');
  const scriptCode = x => `storage.loads = (storage.loads || 0) + 1; game.on_tick(e => {
    storage.ticks = (storage.ticks || 0) + 1;
    if (!storage.built) { game.create_entity({ name: 'wooden-chest', position: { x: ${x}, y: 12 } }); storage.built = true; }
  }, 1);`;
  const scenario = scripted ? newScenario('native-script-acceptance', 'Dedicated script acceptance') : undefined;
  if (scenario) { scenario.seed = 1171910; scenario.rules.enemies = 'none'; scenario.script = scriptCode(12); }
  const fixture = new Game(1171910, true, { enemies: 'none' }, scenario);
  const scriptIds = ['scn-native-script-acceptance', 'native-script-probe'];
  if (scripted) for (const id of scriptIds) fixture.scriptStore[id] = JSON.stringify({ loads: 2, ticks: 7 });
  const manyPlayers = process.argv.includes('--players');
  for (let y = manyPlayers ? -16 : 2; y < (manyPlayers ? 20 : scripted ? 18 : 8); y++) for (let x = manyPlayers ? -16 : 1; x < (manyPlayers ? 20 : scripted ? 18 : 11); x++) {
    const c = fixture.world.chunkAt(x, y), i = fixture.world.idx(x, y);
    c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; fixture.world.removeDecor(x, y);
  }
  fixture.inv.add('copper-plate', 17); fixture.player.x = 3.25; fixture.player.y = 4.75;
  const supply = manyPlayers ? fixture.build('wooden-chest', 0, 1, 0, false) : null;
  if (manyPlayers) { assert.ok(supply?.inv, 'real supply chest exists'); supply.inv.add('iron-plate', 8); }
  const owner = fixture.v117.playerIds[0], sessionId = randomUUID();
  const prepareBody = { requestId: randomUUID(), expectedRevision: initialStop.revision, sessionId, sourceGeneration: 2, worldName: 'Native handoff acceptance' };
  const prepared = await mutate('/handoff/prepare', prepareBody);
  const replay = await mutate('/handoff/prepare', prepareBody);
  assert.equal(replay.transactionId, prepared.transactionId); assert.equal(replay.revision, prepared.revision, 'replay performs no second transition');
  await mutate('/handoff/prepare', { ...prepareBody, worldName: 'Changed replay' }, 409);
  const commitBody = { requestId: randomUUID(), expectedRevision: prepared.revision, transactionId: prepared.transactionId, ownerPlayerId: owner,
    lastTick: fixture.tick, lastHash: quickHash(fixture), save: serialize(fixture),
    ...(scripted ? { modState: { mods: [{
      'info.json': new TextEncoder().encode(JSON.stringify({ name: scriptIds[1], title: 'Native script probe', version: '1.0.0', gameVersion: '>=1.17', dependencies: [] })),
      'control.js': new TextEncoder().encode(scriptCode(14)),
    }], prio: [scriptIds[1]], game: '1.17.0' } } : {}) };
  await mutate('/handoff/commit', { ...commitBody, lastHash: '00000000' }, 409);
  assert.equal((await getStatus()).world, null, 'invalid handoff never starts a partial world');
  const committed = await mutate('/handoff/commit', commitBody);
  assert.equal(committed.ownerPlayerId, owner); assert.equal(committed.generation, 3);
  const repeated = await mutate('/handoff/commit', commitBody);
  assert.equal(repeated.worldId, committed.worldId); assert.equal(repeated.revision, committed.revision);
  const running = await getStatus();
  assert.equal(running.controller.state, 'running'); assert.equal(running.world.id, committed.worldId);
  assert.equal(running.world.tick, fixture.tick, 'empty-server pause keeps the handoff tick until the owner connects');
  const stopped = await mutate('/stop', { requestId: randomUUID(), expectedRevision: running.revision });
  assert.equal((await getStatus()).controller.state, 'stopped');
  const saved = decodeNativeJson(await readFile(join(data, 'worlds', committed.worldId + '.json'), 'utf8'));
  const restored = deserialize(saved.world.save);
  assert.equal(restored.v117.playerIds[0], owner); assert.equal(restored.inv.count('copper-plate'), fixture.inv.count('copper-plate'));
  assert.equal(restored.player.x, 3.25); assert.equal(restored.player.y, 4.75);
  assert.equal(restored.tick, fixture.tick, 'stop persists the transferred state');
  await mutate('/start', { requestId: randomUUID(), expectedRevision: stopped.revision, world: { mode: 'open', worldId: committed.worldId } });
  const reopened = await getStatus(); assert.equal(reopened.controller.state, 'running'); assert.equal(reopened.world.id, committed.worldId);
  if (relay && process.argv.includes('--invite-only')) {
    const { acceptRelayInviteLifecycle } = await import('./native-players-v117.mjs');
    await acceptRelayInviteLifecycle({ relay, getStatus, mutate, worldId: committed.worldId, inviteDeadline: saved.world.inviteExpiresAt });
  }
  if (manyPlayers) {
    const { acceptNativePlayers } = await import('./native-players-v117.mjs');
    await acceptNativePlayers({ request, headers, mutate, getStatus, playPort, worldId: committed.worldId, ownerId: owner, supplyId: supply.id, relay });
  }
  if (process.argv.includes('--browser')) {
    const { launchBrowser } = await import('./browser.mjs');
    const browser = await launchBrowser('chromium', { args: ['--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns',
      ...(relay ? ['--ignore-certificate-errors-spki-list=' + relay.certificatePin] : [])] });
    try {
      if (relay) await (await import('./native-relay-v117.mjs')).acceptRelayLanding(browser, relay, getStatus);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const language = process.argv.includes('--en') ? 'en' : 'ru';
      const transportLabel = process.argv.includes('--require-rtc')
        ? language === 'en' ? 'Direct WebRTC connection' : 'Прямое соединение WebRTC'
        : language === 'en' ? 'Backup connection to the server' : 'Резервное соединение с сервером';
      await context.addInitScript(lang => localStorage.setItem('zavod7:settings', JSON.stringify({ lang, simWorker: true, tips: false, leaveGuard: false })), language);
      if (process.argv.includes('--ws-only')) await context.addInitScript(() => Object.defineProperty(window, 'RTCPeerConnection', { value: undefined }));
      const launch = await request('/bootstrap-capability', { method: 'POST', headers, body: '{}' });
      assert.equal(launch.status, 200);
      const page = await context.newPage(), pageErrors = [], requests = [], wire = [];
      page.on('pageerror', error => pageErrors.push(redact(error.message)));
      page.on('response', response => { const p = new URL(response.url()).pathname; if (p.startsWith('/api/')) requests.push({ path: p, status: response.status() }); });
      page.on('websocket', ws => {
        const record = direction => event => {
          try { const m = JSON.parse(String(event.payload)); let inner = '', input, control, pause; if (m.t === 'z7-link' && m.p) { const p = JSON.parse(m.p); inner = p.type || p.t || ''; if (p.command?.t === 'input') input = { mx: p.command.mx, my: p.command.my }; if (p.type === 'owner-action') control = { op: p.op, value: p.value }; if (p.type === 'snapshot') pause = { tick: p.snapshot.tick, paused: p.snapshot.mp?.paused }; } wire.push({ direction, t: m.t || m.type, inner, input, control, pause }); } catch { wire.push({ direction, invalid: true }); }
        };
        ws.on('framesent', record('out')); ws.on('framereceived', record('in'));
        ws.on('socketerror', () => wire.push({ error: true })); ws.on('close', () => wire.push({ closed: true }));
      });
      await page.goto((await launch.json()).url);
      // Startup opens the unified menu after async mods/bootstrap; enter through
      // its real button instead of racing that initialization with ui.toggle.
      await page.locator('[data-act="menu-child"][data-win="mp"]').first().click({ timeout: 45000 });
      const join = page.locator('[data-act="native-join"]');
      try { await join.waitFor({ state: 'visible', timeout: 30000 }); }
      catch (error) {
        console.error(redact(JSON.stringify(await page.evaluate(errors => ({ errors, open: window.__zavod?.ui?.open,
          actions: Array.from(document.querySelectorAll('[data-act]')).map(el => el.getAttribute('data-act')).slice(0, 70),
          nativeErrors: Array.from(document.querySelectorAll('.native-server .mperr')).map(el => el.textContent) }), pageErrors))));
        throw error;
      }
      await join.click();
      try {
        await page.waitForFunction(count => window.__zavod.game?.inv?.count('copper-plate') === count && Math.abs(window.__zavod.game.player.x - 3.25) < .01, fixture.inv.count('copper-plate'), { timeout: 45000 });
      } catch (error) {
        const debug = await page.evaluate(() => ({ open: window.__zavod?.ui?.open, tick: window.__zavod?.game?.tick,
          player: window.__zavod?.game?.player && { x: window.__zavod.game.player.x, y: window.__zavod.game.player.y },
          copper: window.__zavod?.game?.inv?.count('copper-plate'), workerErrors: window.__zavod?.sim?.errors?.slice(-3),
          nativeErrors: Array.from(document.querySelectorAll('.native-server .mperr')).map(el => el.textContent) }));
        const status = await getStatus();
        console.error(redact(JSON.stringify({ ...debug, browserErrors: pageErrors, requests: requests.slice(-20), wire: wire.slice(-25), serverPlayers: status.world?.players, serverTick: status.world?.tick, serverStderr: stderr.slice(-1000) })));
        throw error;
      }
      assert.equal((await getStatus()).world.players, 1, 'real Chromium client authenticates to the independent server');
      assert.deepEqual(await page.evaluate(() => ({ seed: window.__zavod.game.seed, lake: window.__zavod.game.world.lake, oil: window.__zavod.game.world.oil,
        genv: window.__zavod.game.world.genv, noUranium: window.__zavod.game.world.noUranium })),
        { seed: fixture.seed, lake: fixture.world.lake, oil: fixture.world.oil, genv: fixture.world.genv, noUranium: fixture.world.noUranium }, 'the renderer receives the real world identity and generation flags');
      if (language === 'en') {
        const controls = await page.locator('.native-server button, .native-server > .lbl, .native-server [role="status"], .native-server > .dim').allTextContents();
        assert.ok(!/[А-Яа-яЁё]/.test(controls.join(' ')), 'English dedicated controls and health have no Russian fallback');
      }
      if (process.argv.includes('--require-rtc') || process.argv.includes('--ws-only')) {
        await page.waitForFunction(text => Array.from(document.querySelectorAll('.native-server [role="status"]')).some(el => el.textContent === text), transportLabel, { timeout: 20000 });
      }
      // The first Escape returns from the multiplayer child to the unified
      // menu; the second resumes play. Keys are intentionally blocked in menus.
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      await page.waitForFunction(() => !window.__zavod.ui.open);
      await page.keyboard.down('d');
      try { await page.waitForFunction(() => window.__zavod.game.player.x > 3.4, null, { timeout: 10000 }); }
      catch (error) {
        const status = await getStatus();
        console.error(redact(JSON.stringify({ movement: await page.evaluate(() => ({ open: window.__zavod.ui.open, tick: window.__zavod.game.tick,
          player: { x: window.__zavod.game.player.x, y: window.__zavod.game.player.y }, focus: document.activeElement?.tagName,
          errors: Array.from(document.querySelectorAll('.native-server .mperr')).map(el => el.textContent), workerErrors: window.__zavod.sim.errors })),
          inputs: wire.filter(e => e.input).slice(-8), controls: wire.filter(e => e.control).slice(-8), snapshots: wire.filter(e => e.pause).slice(-3), recentWire: wire.slice(-8), serverTick: status.world?.tick, serverHealth: status.controller.health })));
        throw error;
      }
      finally { await page.keyboard.up('d'); }
      assert.deepEqual(pageErrors, []);
      if (process.argv.includes('--require-rtc') || process.argv.includes('--ws-only')) {
        await page.keyboard.press('Escape');
        await page.locator('[data-act="menu-child"][data-win="mp"]').first().click();
        await page.waitForFunction(text => Array.from(document.querySelectorAll('.native-server [role="status"]')).some(el => el.textContent === text), transportLabel, { timeout: 20000 });
        console.log('✔ actual dedicated transport: ' + (process.argv.includes('--require-rtc') ? 'WebRTC DataChannel' : 'WebSocket fallback without RTC'));
      }
      console.log('✔ real Chromium UI joins the packaged native server with the same inventory and authoritative keyboard movement');
    } finally { await browser.close(); }
  }
  const beforeSettingsTick = (await getStatus()).world.tick;
  const active = await mutate('/settings', { requestId: randomUUID(), expectedRevision: (await getStatus()).revision, settings: { pauseWhenEmpty: false } });
  await delay(300);
  const beforeFailure = await getStatus(); assert.ok(beforeFailure.world.tick > beforeSettingsTick, 'settings preserve a running independent simulation');
  const worldFile = join(data, 'worlds', committed.worldId + '.json'), heldFile = worldFile + '.smoke-held';
  assert.match(committed.worldId, /^[a-f0-9]{32}$/);
  await rename(worldFile, heldFile); await mkdir(worldFile);
  try {
    await mutate('/stop', { requestId: randomUUID(), expectedRevision: active.revision }, 400);
    const failed = await getStatus(); assert.equal(failed.controller.state, 'running'); assert.equal(failed.world.id, committed.worldId);
    await delay(300);
    assert.ok((await getStatus()).world.tick > failed.world.tick, 'failed save restores the previously running simulation');
  } finally { await rmdir(worldFile); await rename(heldFile, worldFile); }
  const finalStop = await mutate('/stop', { requestId: randomUUID(), expectedRevision: active.revision });
  if (scripted) {
    const inspectSave = async () => decodeNativeJson(await readFile(worldFile, 'utf8'));
    const firstSave = await inspectSave();
    for (const id of scriptIds) {
      const store = JSON.parse(firstSave.world.save.scripts.store[id]);
      assert.ok(store.ticks > 7 && store.loads === 3 && store.built, 'scenario and mod execute with transferred persistent storage: ' + id);
    }
    const firstGame = deserialize(firstSave.world.save);
    for (const x of [12, 14]) assert.ok([...firstGame.ents.values()].some(e => e.proto === 'wooden-chest' && e.x === x && e.y === 12), 'script commands reach the authoritative world');
    assert.equal(firstSave.world.mods.mods.length, 1, 'script package is saved with the dedicated world');
    await mutate('/start', { requestId: randomUUID(), expectedRevision: finalStop.revision, world: { mode: 'open', worldId: committed.worldId } });
    const deadline = performance.now() + 10000;
    while ((await getStatus()).world.tick <= firstGame.tick + 10 && performance.now() < deadline) await delay(50);
    assert.ok((await getStatus()).world.tick > firstGame.tick + 10, 'scripted world continues after reopen');
    await mutate('/stop', { requestId: randomUUID(), expectedRevision: (await getStatus()).revision });
    const secondSave = await inspectSave();
    for (const id of scriptIds) {
      const before = JSON.parse(firstSave.world.save.scripts.store[id]), after = JSON.parse(secondSave.world.save.scripts.store[id]);
      assert.equal(after.loads, before.loads + 1, 'script restarts once after reopen');
      assert.ok(after.ticks > before.ticks && after.built, 'script storage survives reopening and keeps advancing');
    }
    console.log('✔ packaged dedicated scenario and script mod: transferred storage, real world commands, package persistence and continuing state after reopen');
  }
  console.log('✔ packaged native process: bootstrap/Origin/CSRF, handoff replay/hash checks, persistent owner/inventory, stop/reopen and failed-save recovery pass');
} catch (error) {
  if (error instanceof Error) { error.message = redact(error.message); if (error.stack) error.stack = redact(error.stack); }
  throw error;
} finally {
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'exit'); child.kill('SIGTERM'); await closed; }
  if (relay) await relay.stop();
  // Check the actual absolute target before recursively deleting generated identity files.
  const actual = await realpath(data), allowed = await realpath(root);
  if (!actual.startsWith(allowed + sep) || !basename(actual).startsWith('native-smoke-')) throw new Error('Refusing unsafe smoke-data cleanup path');
  await rm(actual, { recursive: true, force: true });
}

// A real local TLS termination hop, with a private test CA; TLS checks stay enabled.
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpsServer, get as httpsGet } from 'node:https';
import { request as httpRequest } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { wsReceiver, ws as NodeWebSocket } from '../node_modules/playwright-core/lib/utilsBundle.js';
import { createHash, X509Certificate, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { nativeRelayHostProofPayload } from '../src/net/native-relay-protocol.ts';
import { modSet } from '../src/net/mods.ts';

export async function acceptReleasedHostReplacement(relay) {
  const pair = generateKeyPairSync('ed25519'), key = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const serverId = createHash('sha256').update(key).digest('hex'), leaseId = randomBytes(16).toString('hex'), clients = [];
  const wait = async (predicate, label) => {
    const deadline = performance.now() + 10000;
    while (!predicate() && performance.now() < deadline) await new Promise(ok => setTimeout(ok, 20));
    assert.ok(predicate(), label);
  };
  const connect = id => {
    const client = { messages: [], code: null };
    const socket = client.socket = new NodeWebSocket(relay.hostUrl, relay.ca ? { ca: relay.ca } : {}); clients.push(client);
    socket.on('error', error => { client.error = error.message; });
    socket.on('close', code => { client.code = code; });
    socket.on('message', raw => {
      const message = JSON.parse(String(raw)); client.messages.push(message);
      if (message.type === 'host-challenge') socket.send(JSON.stringify({ type: 'host-proof', serverId, leaseId: id, nonce: message.nonce, publicKey: key.toString('hex'),
        proof: sign(null, Buffer.from(nativeRelayHostProofPayload(relay.origin, message.nonce, serverId, id)), pair.privateKey).toString('hex') }));
    });
    return client;
  };
  const result = client => client.messages.find(m => m.type === 'host-ready' || m.type === 'error');
  const registration = () => ({ type: 'register', requestId: randomBytes(16).toString('hex'), leaseId,
    worldId: randomBytes(16).toString('hex'), generation: 1, inviteToken: randomBytes(32).toString('base64url'), inviteExpiresAt: Date.now() + 86400000, maxPlayers: 8, modSet: modSet() });
  const register = async client => {
    const message = registration(); client.socket.send(JSON.stringify(message));
    await wait(() => client.messages.some(m => m.type === 'registered' && m.requestId === message.requestId), 'own test room registers');
    return client.messages.find(m => m.type === 'registered' && m.requestId === message.requestId);
  };
  try {
    const old = connect(leaseId); await wait(() => result(old), 'original signed host authenticates'); assert.equal(result(old).type, 'host-ready');
    const registered = await register(old);
    old.socket.send(JSON.stringify({ type: 'release', leaseId }));
    const deadline = performance.now() + 10000;
    while ((await relay.request(relay.origin + '/v1/rooms/' + registered.code)).status !== 404 && performance.now() < deadline) await new Promise(ok => setTimeout(ok, 20));
    assert.equal((await relay.request(relay.origin + '/v1/rooms/' + registered.code)).status, 404, 'release is processed while the proxy-side socket stays open');
    const wrongLease = connect(randomBytes(16).toString('hex')); await wait(() => result(wrongLease), 'different lease is rejected');
    assert.equal(result(wrongLease).type, 'error'); assert.equal(old.socket.readyState, NodeWebSocket.OPEN);
    const replacement = connect(leaseId); await wait(() => result(replacement), 'released installation authenticates again');
    assert.equal(result(replacement).type, 'host-ready', 'a fresh signature for the same released installation replaces its lingering proxy socket');
    if (relay.ca) { await wait(() => old.code !== null, 'lingering socket is retired'); assert.equal(old.code, 1012); }
    const current = await register(replacement);
    // A public proxy may delay the old client's close notification. Verify
    // loss of authority instead: that socket cannot release or replace the
    // new room, even while its local readyState still reports OPEN.
    const stale = registration();
    if (old.socket.readyState === NodeWebSocket.OPEN) {
      old.socket.send(JSON.stringify({ type: 'release', leaseId })); old.socket.send(JSON.stringify(stale));
    }
    for (let check = 0; check < 4; check++) {
      await new Promise(ok => setTimeout(ok, 250));
      assert.equal((await relay.request(relay.origin + '/v1/rooms/' + current.code)).status, 200, 'retired socket cannot release or replace the current room');
      assert.ok(!old.messages.some(m => m.type === 'registered' && m.requestId === stale.requestId), 'retired socket cannot publish another world');
    }
    const activeDuplicate = connect(leaseId); await wait(() => result(activeDuplicate), 'active duplicate is rejected');
    assert.equal(result(activeDuplicate).type, 'error', 'an active world cannot be replaced'); assert.equal(replacement.socket.readyState, NodeWebSocket.OPEN);
    replacement.socket.send(JSON.stringify({ type: 'release', leaseId }));
    console.log('✔ fresh signed host replaces only its released same-lease socket; different lease and active duplicates remain rejected');
  } finally { for (const client of clients) client.socket.close(); }
}

// Opt-in public acceptance: use the platform's real certificate chain and
// never stop/restart its gateway or trust the local fixture's private CA.
export async function connectPublicAcceptanceRelay(rawOrigin) {
  const url = new URL(rawOrigin);
  assert.ok(url.protocol === 'https:' && url.origin === rawOrigin && !url.username && !url.password, 'exact public HTTPS origin required');
  const request = async (target, headers = {}) => {
    const destination = new URL(target);
    assert.equal(destination.origin, url.origin, 'public acceptance stays on the selected service');
    const response = await fetch(destination, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('Public relay response exceeds acceptance bound');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return { status: response.status, json: async () => JSON.parse(text), text: async () => text };
  };
  const landing = await request(url.origin + '/');
  assert.equal(landing.status, 200); assert.match(await landing.text(), /id="code"/);
  assert.equal((await request(url.origin + '/', { Origin: 'https://untrusted.invalid' })).status, 403);
  return { origin: url.origin, hostUrl: url.origin.replace(/^https:/, 'wss:') + '/v1/host', request,
    stats: { publicOrigin: url.origin }, async stop() {} };
}

export async function startAcceptanceRelay(root, runtime) {
  const directory = await mkdtemp(join(root, 'relay-smoke-'));
  const sockets = new Set(), hostSockets = new Set();
  let child, proxy;
  const stats = { connections: 0, hostConnections: 0, receivedBytes: 0, sentBytes: 0, hostDisconnects: 0, controls: [] };
  const cleanup = async () => {
    for (const socket of sockets) socket.destroy();
    if (proxy?.listening) await new Promise(resolveClose => proxy.close(resolveClose));
    if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
    const actual = await realpath(directory), allowed = await realpath(root);
    if (!actual.startsWith(allowed + sep) || !basename(actual).startsWith('relay-smoke-')) throw new Error('Unsafe relay cleanup path');
    await rm(actual, { recursive: true, force: true });
  };
  try {
    const keyPath = join(directory, 'key.pem'), caPath = join(directory, 'cert.pem');
    execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', keyPath, '-out', caPath], { windowsHide: true, stdio: 'pipe' });
    const ca = await readFile(caPath), key = await readFile(keyPath);
    const probe = createNetServer(); await new Promise(ok => probe.listen(0, '127.0.0.1', ok));
    const gatewayPort = probe.address().port; await new Promise(ok => probe.close(ok));
    proxy = createHttpsServer({ key, cert: ca }, (request, response) => {
      const forwarded = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: request.url, method: request.method, headers: request.headers }, upstream => {
        response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
      });
      forwarded.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(forwarded);
    });
    proxy.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    proxy.on('upgrade', (request, socket, head) => {
      stats.connections++;
      if (request.url === '/v1/host') { stats.hostConnections++; hostSockets.add(socket); socket.once('close', () => hostSockets.delete(socket)); }
      const forward = httpRequest({ hostname: '127.0.0.1', port: gatewayPort, path: request.url, headers: request.headers });
      forward.on('upgrade', (response, upstream, upstreamHead) => {
        sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream));
        socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(response.headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
        let inbound, outbound;
        if (request.url === '/v1/host') {
          const observer = (isServer, direction) => {
            const receiver = new wsReceiver({ isServer, maxPayload: 8 * 1024 * 1024 });
            receiver.on('error', () => {});
            receiver.on('message', data => { try { const message = JSON.parse(String(data));
              if (message.type !== 'guest-data') { stats.controls.push({ direction, type: message.type, ...(message.type === 'error' ? { code: message.code, message: message.message } : {}) }); if (stats.controls.length > 24) stats.controls.shift(); }
            } catch {} }); return receiver;
          };
          inbound = observer(true, 'host'); outbound = observer(false, 'gateway');
        }
        // Receiver unmasks frames in place. Its observation copy must never
        // alter the bytes that the real proxy forwards to either endpoint.
        if (upstreamHead.length) { outbound?.write(Buffer.from(upstreamHead)); socket.write(upstreamHead); } if (head.length) { inbound?.write(Buffer.from(head)); upstream.write(head); }
        socket.on('data', data => inbound?.write(Buffer.from(data))); upstream.on('data', data => outbound?.write(Buffer.from(data)));
        socket.on('data', data => { stats.receivedBytes += data.length; }); upstream.on('data', data => { stats.sentBytes += data.length; });
        socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
        socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
        socket.pipe(upstream); upstream.pipe(socket);
      });
      forward.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`); response.resume(); });
      forward.on('error', () => socket.destroy()); forward.end();
    });
    await new Promise(ok => proxy.listen(0, '127.0.0.1', ok));
    const origin = `https://127.0.0.1:${proxy.address().port}`;
    const startGateway = async () => {
      child = spawn(runtime, [resolve('dist/native/relay-gateway.mjs')], { cwd: resolve('dist/native'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env,
        ...(process.argv.includes('--render-env')
          ? { ZAVOD_RELAY_PUBLIC_ORIGIN: '', ZAVOD_RELAY_PORT: '', RENDER_EXTERNAL_URL: origin, PORT: String(gatewayPort) }
          : { ZAVOD_RELAY_PUBLIC_ORIGIN: origin, ZAVOD_RELAY_PORT: String(gatewayPort), RENDER_EXTERNAL_URL: 'https://unused.invalid', PORT: '1' }),
        ZAVOD_RELAY_REGISTRATION: 'public', ZAVOD_RELAY_HOST_TOKEN: '', ZAVOD_RELAY_TRUST_PROXY: '0' } });
      await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error('Packaged relay readiness timeout')), 15000);
      child.once('error', error => { clearTimeout(timer); fail(error); });
      child.once('exit', code => { clearTimeout(timer); fail(new Error('Packaged relay exited before readiness: ' + code)); });
      child.stdout.on('data', chunk => { if (String(chunk).includes('relay gateway is listening')) { clearTimeout(timer); ok(); } });
      });
    };
    await startGateway();
    const request = (url, headers = {}) => new Promise((ok, fail) => {
      const request = httpsGet(url, { ca, headers, timeout: 10000 }, response => {
        const chunks = []; let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) response.destroy(new Error('Relay response bound')); else chunks.push(chunk); });
        response.on('error', fail); response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); ok({ status: response.statusCode, json: async () => JSON.parse(text), text: async () => text }); });
      });
      request.on('error', fail); request.on('timeout', () => request.destroy(new Error('TLS relay request timeout')));
    });
    assert.equal((await request(origin + '/')).status, 200);
    assert.equal((await request(origin + '/', { Origin: 'https://untrusted.invalid' })).status, 403);
    const certificatePin = createHash('sha256').update(new X509Certificate(ca).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    return { origin, ca, caPath, certificatePin, hostUrl: origin.replace(/^https/, 'wss') + '/v1/host', request, stats,
      async restart() { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; await startGateway(); },
      dropHost() { assert.ok(hostSockets.size); stats.hostDisconnects++; for (const socket of hostSockets) socket.destroy(); }, stop: cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export async function acceptRelayLanding(browser, relay, getStatus) {
  const readyDeadline = performance.now() + 45000;
  while ((await getStatus()).invite.relay.state !== 'ready' && performance.now() < readyDeadline) await new Promise(ok => setTimeout(ok, 100));
  assert.equal((await getStatus()).invite.relay.state, 'ready', 'the asynchronous relay publication is ready before entering an invitation');
  const invitation = (await getStatus()).invite;
  for (const value of [invitation.code, invitation.relay.roomCode]) {
    const context = await browser.newContext();
    const errors = [];
    try {
      await context.addInitScript(() => localStorage.setItem('zavod7:settings', JSON.stringify({ lang: 'en', simWorker: true, tips: false, leaveGuard: false })));
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(relay.origin);
      await page.locator('#code').fill(value); await page.locator('#go').click();
      await page.waitForURL(url => /^\/r\/[A-HJ-NP-Z2-9]{10}\/$/.test(url.pathname) && /^#server-invite=[A-Za-z0-9_-]{32,128}$/.test(url.hash), { timeout: 15000 });
      await page.waitForFunction(() => window.__zavod?.game?.seed === 1171910, null, { timeout: 45000 });
      assert.equal(await page.evaluate(() => window.__zavod.game.inv.count('copper-plate')), 0, 'guest never inherits owner inventory');
      assert.deepEqual(errors, []);
      assert.equal((await getStatus()).world.players, 1, 'actual browser guest joins through the invitation page');
    } finally { await context.close(); }
    const deadline = performance.now() + 35000;
    while ((await getStatus()).world.players && performance.now() < deadline) await new Promise(ok => setTimeout(ok, 100));
    assert.equal((await getStatus()).world.players, 0, 'temporary browser guest leaves after its transport grace period');
  }
  console.log('✔ real Chromium relay landing: copied full invitation and short code both join as independent guests');
}

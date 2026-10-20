// Release acceptance of real socket clients against the independently packaged server.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
// Reuse the pinned Playwright WebSocket implementation; no additional dependency.
import { ws as NodeWebSocket } from '../node_modules/playwright-core/lib/utilsBundle.js';
import { NativeBrowserTransport } from '../src/client/native-transport.ts';
import { decodeNativeJson, encodeNativeJson, nativeWireHash } from '../src/net/native-protocol.ts';
import { deriveGuestPasswordProof, guestAdmissionFingerprint, guestAdmissionProofPayload } from '../src/net/password-proof.ts';

async function until(predicate, label, timeout = 15000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) { if (await predicate()) return; await delay(25); }
  throw new Error('Native multiplayer acceptance timed out: ' + label);
}
const count = (snapshot, item) => (snapshot?.inv?.slots || []).reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
const identity = () => {
  const pair = generateKeyPairSync('ed25519');
  const key = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  return { key, privateKey: pair.privateKey, fingerprint: guestAdmissionFingerprint(key) };
};

export async function acceptRelayInviteLifecycle({ relay, getStatus, mutate, worldId, inviteDeadline }) {
  await until(async () => (await getStatus()).invite.relay.state === 'ready', 'initial invitation published');
  const initial = (await getStatus()).invite;
  const stop = await mutate('/stop', { requestId: randomUUID(), expectedRevision: (await getStatus()).revision });
  await mutate('/start', { requestId: randomUUID(), expectedRevision: stop.revision, world: { mode: 'open', worldId } });
  await until(async () => (await getStatus()).invite.relay.state === 'ready', 'same invitation republished');
  const reopened = (await getStatus()).invite;
  assert.deepEqual({ codeStable: initial.relay.roomCode === reopened.relay.roomCode, initialDeadlineMatches: initial.expiresAt === inviteDeadline,
    reopenedDeadlineMatches: reopened.expiresAt === inviteDeadline }, { codeStable: true, initialDeadlineMatches: true, reopenedDeadlineMatches: true },
    'one invitation retains its code and original 24-hour deadline across ordinary stop/start');
  const publicLink = new URL(reopened.code);
  assert.ok(/^#server-invite=[A-Za-z0-9_-]{32,128}$/.test(publicLink.hash), 'the copied public link carries its 128-bit-or-stronger invitation token in the fragment');
  const room = await relay.request(relay.origin + '/v1/rooms/' + reopened.relay.roomCode);
  assert.equal(room.status, 200); assert.equal((await room.json()).expiresAt, inviteDeadline);
  console.log('✔ relay invitation preserves short code and original deadline across ordinary stop/start');
  const connections = relay.stats.hostConnections;
  await relay.restart();
  await until(async () => relay.stats.hostConnections > connections && (await getStatus()).invite.relay.state === 'ready' &&
    (await relay.request(relay.origin + '/v1/rooms/' + reopened.relay.roomCode)).status === 200,
    'host re-registers after the actual gateway process restarts', 45000);
  const recovered = (await getStatus()).invite;
  assert.equal(recovered.relay.roomCode, reopened.relay.roomCode);
  assert.equal(recovered.expiresAt, inviteDeadline);
  assert.equal((await (await relay.request(relay.origin + '/v1/rooms/' + recovered.relay.roomCode)).json()).expiresAt, inviteDeadline);
  const beforeRotation = await getStatus();
  await mutate('/rotateInvite', { requestId: randomUUID(), expectedRevision: beforeRotation.revision });
  await until(async () => {
    const registration = (await getStatus()).invite.relay;
    return registration.state === 'ready' && registration.roomCode !== reopened.relay.roomCode;
  }, 'rotating invitation replaces the gateway route');
  const rotated = (await getStatus()).invite;
  assert.notEqual(new URL(rotated.code).hash, publicLink.hash, 'rotation replaces the strong fragment token as well');
  assert.equal((await relay.request(relay.origin + '/v1/rooms/' + reopened.relay.roomCode)).status, 404, 'old short code is revoked');
  assert.equal((await relay.request(new URL(publicLink.pathname, relay.origin).href)).status, 404, 'old copied link is revoked');
  assert.equal((await relay.request(relay.origin + '/v1/rooms/' + rotated.relay.roomCode)).status, 200);
  console.log('✔ actual gateway process restart restores the original invitation; rotation revokes its old code and copied link');
}

export async function acceptNativePlayers({ request, headers, mutate, getStatus, playPort, worldId, ownerId, supplyId, relay }) {
  const oldWebSocket = globalThis.WebSocket;
  const rawSockets = new Set(), clients = new Set(), transportErrors = [];
  let completed = false;
  class LocalWebSocket extends NodeWebSocket {
    constructor(url) {
      const origin = new URL(url).origin.replace(/^ws/, 'http');
      super(url, { origin, ...(relay && new URL(url).protocol === 'wss:' ? { ca: relay.ca } : {}) }); rawSockets.add(this);
      this.once('close', () => rawSockets.delete(this));
      this.on('error', error => { if (transportErrors.length < 40) transportErrors.push(error.message); });
    }
  }
  globalThis.WebSocket = LocalWebSocket;
  const base = `http://127.0.0.1:${playPort}`;
  const metaResponse = await fetch(base + '/api/v1/world-info'); assert.equal(metaResponse.status, 200);
  const meta = await metaResponse.json();
  let guestBase = base, initialRelayCode = null, initialRelayExpiry = null;
  if (relay) {
    try { await until(async () => (await getStatus()).invite.relay.state === 'ready', 'public-key host registers its relay room'); }
    catch (error) { throw new Error(error.message + '; ' + JSON.stringify({ relay: (await getStatus()).invite.relay, traffic: relay.stats })); }
    const registration = (await getStatus()).invite.relay;
    initialRelayCode = registration.roomCode; initialRelayExpiry = registration.expiresAt;
    guestBase = registration.guestBaseUrl.replace(/\/$/, '');
    const room = await relay.request(relay.origin + '/v1/rooms/' + registration.roomCode);
    assert.equal(room.status, 200); assert.equal((await room.json()).worldId, worldId);
    const mirroredMeta = await relay.request(guestBase + '/api/v1/world-info');
    assert.deepEqual(await mirroredMeta.json(), meta, 'room metadata matches the independently running server');
    assert.equal((await relay.request(guestBase + '/api/v1/status')).status, 404, 'relay never publishes the local controller');
  }
  const password = randomUUID() + ' acceptance';
  const update = async settings => mutate('/settings', { requestId: randomUUID(), expectedRevision: (await getStatus()).revision, settings });
  const token = async () => { const r = await request('/join-token', { headers }); assert.equal(r.status, 200); return (await r.json()).joinToken; };
  const invite = async () => new URL((await getStatus()).invite.lanUrls[0]).hash.slice('#server-invite='.length);
  function connect(auth) {
    const client = { snapshots: 0, snapshot: null, welcome: null, seq: 0, error: null, ended: false, transfer: null };
    const transport = client.transport = new NativeBrowserTransport(new URL((auth.ownerToken ? base : guestBase).replace(/^http/, 'ws') + '/api/v1/play'), worldId, meta.serverId,
      async payload => auth.ownerToken ? { ownerToken: auth.ownerToken } : { publicKey: auth.identity.key, proof: sign(null, Buffer.from(payload), auth.identity.privateKey).toString('hex') });
    clients.add(client);
    const send = message => transport.send(encodeNativeJson(message));
    client.send = send;
    client.command = command => send({ type: 'cmd', seq: ++client.seq, command });
    client.close = () => { transport.close(); clients.delete(client); };
    transport.onclose = () => { client.ended = true; };
    transport.onmessage = async event => {
      try {
        const message = decodeNativeJson(event.data);
        if (message.type === 'auth-challenge') {
          let response;
          if (auth.ownerToken) response = { type: 'auth', role: 'owner', challengeId: message.challengeId, joinToken: auth.ownerToken, modSet: meta.modSet, name: auth.name };
          else {
            const fingerprint = auth.identity.fingerprint;
            response = { type: 'auth', role: 'guest', challengeId: message.challengeId, modSet: meta.modSet, name: auth.name,
              admissionPublicKey: auth.identity.key,
              admissionProof: sign(null, Buffer.from(guestAdmissionProofPayload(message.worldId, message.generation, message.challengeId, fingerprint, meta.serverId)), auth.identity.privateKey).toString('hex'),
              ...(auth.reconnectToken ? { reconnectToken: auth.reconnectToken } : { inviteToken: auth.inviteToken }) };
            if (message.passwordRequired) response.passwordProof = await deriveGuestPasswordProof(auth.password || '', message.passwordSalt, message.passwordIterations,
              `zavod7-native-auth\n${meta.serverId}\n${message.worldId}\n${message.generation}\n${message.challengeId}\n${fingerprint}\nguest`);
          }
          send(response);
        } else if (message.type === 'welcome') { client.welcome = message; transport.authenticated(); }
        else if (message.type === 'snapshot') { client.snapshot = message.snapshot; client.snapshots++; }
        else if (message.type === 'snapshot-begin') { client.transfer = { ...message, chunks: [] }; }
        else if (message.type === 'snapshot-chunk') {
          const t = client.transfer; assert.ok(t); assert.equal(message.id, t.id); assert.equal(message.index, t.chunks.length);
          t.chunks.push(Buffer.from(message.data, 'base64'));
          if (t.chunks.length === t.parts) {
            const bytes = Buffer.concat(t.chunks); assert.equal(bytes.length, t.bytes); assert.equal(nativeWireHash(bytes), t.hash);
            client.snapshot = decodeNativeJson(bytes.toString('utf8'), t.bytes + 1).snapshot; client.snapshots++; client.transfer = null;
          }
          send({ type: 'snapshot-ack', id: message.id, index: message.index });
        } else if (message.type === 'error') client.error = message.code;
      } catch (error) { client.error = error; transport.close(); }
    };
    client.ready = async () => {
      await until(() => client.snapshot || client.error || client.ended, 'client joins');
      assert.equal(client.error, null, 'client receives no server/client protocol error'); assert.ok(client.snapshot, 'client receives a real snapshot');
      return client;
    };
    return client;
  }
  const reject = async auth => {
    const rejected = connect(auth);
    try { await until(() => rejected.error || rejected.ended || rejected.welcome, 'unauthorized client rejected'); assert.equal(rejected.welcome, null); assert.equal(rejected.error, 'auth'); }
    finally { rejected.close(); }
  };
  try {
    await update({ maxPlayers: 16, pauseWhenEmpty: true, password });
    if (relay) {
      await until(async () => (await getStatus()).invite.relay.state === 'ready', 'settings metadata republished');
      const response = await relay.request(guestBase + '/api/v1/world-info');
      assert.equal((await response.json()).maxPlayers, 16, 'relay metadata follows the saved server capacity setting');
    }
    const owner = await connect({ ownerToken: await token(), name: 'Owner acceptance' }).ready();
    assert.equal(owner.welcome.playerId, ownerId); assert.equal(owner.welcome.owner, true);
    const invitation = await invite(), keys = Array.from({ length: 15 }, identity), guests = [];
    await reject({ identity: keys[0], inviteToken: invitation, password: randomUUID(), name: 'Wrong password' });
    for (let i = 0; i < 15; i++) guests.push(await connect({ identity: keys[i], inviteToken: invitation, password, name: 'Guest ' + i }).ready());
    await until(async () => (await getStatus()).world.players === 16, '16 live network clients');
    const ids = guests.map(g => g.welcome.playerId);
    assert.equal(new Set([owner.welcome.playerId, ...ids]).size, 16);
    for (const client of [owner, ...guests]) {
      assert.equal(client.welcome.maxPlayers, 16);
      assert.ok(Number.isFinite(client.snapshot.player.x) && Number.isFinite(client.snapshot.player.y), 'all 16 engineers have finite positions');
      assert.equal(client.snapshot.mp.dedicatedServer, true);
    }
    await reject({ identity: identity(), inviteToken: invitation, password, name: 'Seventeenth' });
    const first = guests[0], initialX = first.snapshot.player.x, initialOwnerX = owner.snapshot.player.x;
    first.command({ t: 'input', mx: 1, my: 0 });
    await until(() => first.snapshot.player.x > initialX + .2, 'guest authoritative movement');
    first.command({ t: 'input', mx: 0, my: 0 });
    first.command({ t: 'take', id: supplyId, slot: 'chest:0' });
    await until(() => count(first.snapshot, 'iron-plate') === 8, 'guest receives real chest supply');
    const gears = count(first.snapshot, 'iron-gear-wheel');
    first.command({ t: 'craft', recipe: 'iron-gear-wheel', count: 1 });
    await until(() => count(first.snapshot, 'iron-gear-wheel') === gears + 1, 'guest paid crafting');
    assert.equal(owner.snapshot.player.x, initialOwnerX, 'guest movement does not control the owner');
    const copper = count(first.snapshot, 'copper-plate');
    assert.notEqual(copper, count(owner.snapshot, 'copper-plate'), 'owner inventory stays separate');
    const originalSnapshots = new Map([owner, ...guests].map(c => [c, c.snapshots]));
    // Physical path interruption must resume the existing logical stream/engineer.
    for (const socket of rawSockets) socket.terminate();
    try { await until(() => [owner, ...guests].every(c => c.snapshots > originalSnapshots.get(c) && !c.ended), 'physical reconnect of all 16 clients', 25000); }
    catch (error) { throw new Error(error.message + '; ' + JSON.stringify({ errors: transportErrors, closed: [owner, ...guests].filter(c => c.ended).length,
      resumed: [owner, ...guests].filter(c => c.snapshots > originalSnapshots.get(c)).length, online: (await getStatus()).world.players })); }
    assert.equal((await getStatus()).world.players, 16);
    if (relay) {
      const beforeTunnelLoss = new Map([owner, ...guests].map(c => [c, c.snapshots]));
      relay.dropHost();
      try { await until(() => [owner, ...guests].every(c => !c.ended && c.snapshots > beforeTunnelLoss.get(c)), 'outbound WSS tunnel recovers all existing engineers', 25000); }
      catch (error) { throw new Error(error.message + '; ' + JSON.stringify({ errors: transportErrors, resumed: [owner, ...guests].filter(c => c.snapshots > beforeTunnelLoss.get(c)).length,
        relayState: (await getStatus()).invite.relay.state, relayMessage: (await getStatus()).invite.relay.message, traffic: relay.stats })); }
      assert.equal((await getStatus()).world.players, 16);
    }
    const reconnectToken = first.welcome.reconnectToken;
    await reject({ identity: keys[1], reconnectToken, password, name: 'Stolen reconnect' });
    first.close();
    const renamed = await connect({ identity: keys[0], reconnectToken, password, name: 'Renamed guest' }).ready();
    guests[0] = renamed;
    assert.equal(renamed.welcome.playerId, ids[0]); assert.equal(count(renamed.snapshot, 'iron-gear-wheel'), gears + 1); assert.equal(count(renamed.snapshot, 'copper-plate'), copper);
    // A guest can neither elevate itself nor pause the shared server.
    const tick = (await getStatus()).world.tick;
    renamed.send({ type: 'owner-action', requestId: randomUUID(), op: 'pause', value: true });
    await until(() => renamed.error, 'guest management rejected'); assert.equal(renamed.error, 'request');
    await until(async () => (await getStatus()).world.tick > tick + 3, 'guest cannot pause the world');
    // Policy changes apply to existing identities at the next admission as well.
    await update({ accessMode: 'whitelist', whitelistFingerprints: keys.map(k => k.fingerprint) });
    renamed.close();
    const allowed = await connect({ identity: keys[0], reconnectToken: renamed.welcome.reconnectToken, password, name: 'Allowed guest' }).ready(); guests[0] = allowed;
    assert.equal(allowed.welcome.playerId, ids[0]);
    await update({ removeWhitelistFingerprints: [keys[0].fingerprint] });
    allowed.close();
    await reject({ identity: keys[0], reconnectToken: allowed.welcome.reconnectToken, password, name: 'Removed guest' });
    await update({ accessMode: 'invite', clearPassword: true });
    for (const client of [...clients]) client.close();
    // The transport deliberately retains an interrupted logical session for
    // 25 seconds so a physical failure does not detach the engineer.
    await until(async () => (await getStatus()).world.players === 0, 'all clients disconnected', 35000);
    const state = await getStatus();
    const stopped = await mutate('/stop', { requestId: randomUUID(), expectedRevision: state.revision });
    await mutate('/start', { requestId: randomUUID(), expectedRevision: stopped.revision, world: { mode: 'open', worldId } });
    if (relay) {
      await until(async () => (await getStatus()).invite.relay.state === 'ready', 'room reopens');
      const registration = (await getStatus()).invite.relay;
      assert.ok(registration.roomCode === initialRelayCode, 'ordinary stop/start preserves the existing short code');
      assert.equal(registration.expiresAt, initialRelayExpiry, 'ordinary stop/start does not renew the invitation deadline');
    }
    const afterRestart = await connect({ identity: keys[0], reconnectToken: allowed.welcome.reconnectToken, name: 'After restart' }).ready();
    assert.equal(afterRestart.welcome.playerId, ids[0]); assert.equal(count(afterRestart.snapshot, 'iron-gear-wheel'), gears + 1); assert.equal(count(afterRestart.snapshot, 'copper-plate'), copper);
    const rosterResponse = await request('/settings', { headers }); const roster = (await rosterResponse.json()).roster;
    assert.equal(roster.length, 16); assert.equal(new Set(roster.map(p => p.playerId)).size, 16);
    completed = true;
    console.log('✔ packaged server: 16 independent network clients, 17th rejected, password/whitelist, physical resume, stable guest identity/inventory and persisted 16-engineer roster');
    if (relay) console.log('✔ packaged public-key relay over verified local TLS, room resolution, no control-plane exposure and host tunnel recovery: ' + JSON.stringify(relay.stats));
  } finally {
    for (const client of clients) client.close();
    if (completed) await until(async () => (await getStatus()).world.players === 0, 'final client grace period', 35000);
    globalThis.WebSocket = oldWebSocket;
  }
}

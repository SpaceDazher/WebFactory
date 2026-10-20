import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP, Socket } from 'node:net';
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { lstat, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { acceptNativeWebSocket, NATIVE_WS_MAX_MESSAGE, type NativeSocket } from './websocket';
import { relayLanding, relayLandingCsp } from './relay-landing';
import {
  isNativeRelayHostMessage, nativeRelayHostProofPayload, NATIVE_RELAY_CODE,
  NATIVE_RELAY_CODE_ALPHABET, NATIVE_RELAY_MAX_DATA_BYTES, NATIVE_RELAY_MAX_GUESTS,
  NATIVE_RELAY_MAX_LEASE_MS, type NativeRelayHostMessage, type NativeRelayGatewayMessage, type NativeRelayRoom,
} from '../net/native-relay-protocol';

const MAX_HOSTS = 64, MAX_PENDING = 32, MAX_LEASES = 128, MAX_TOTAL_GUESTS = 64;
const INSTALLER = 'native/Zavod7-Server-Setup.exe';
const ASSETS = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'licenses/tweetnacl.txt', 'licenses/noble-hashes.txt']);
const codeSource = NATIVE_RELAY_CODE.source.slice(1, -1);
const RESOLVE = new RegExp(`^/v1/rooms/(${codeSource})$`), PAGE = new RegExp(`^/r/(${codeSource})(?:/(.*))?$`);
const PLAY = new RegExp(`^/r/(${codeSource})/api/v1/play$`), RESUME = /^\/s\/([a-f0-9]{32})\/api\/v1\/play$/;
type Rate = { start: number; count: number };
type Host = {
  socket: NativeSocket; serverId: string; leaseId: string; nonce: string; address: string;
  authenticated: boolean; pending: boolean; closed: boolean; timer: ReturnType<typeof setTimeout>;
  rate: { at: number; bytes: number; frames: number }; controls: Rate;
};
type Guest = { id: string; socket: NativeSocket; lease: Lease; closed: boolean };
type Lease = NativeRelayRoom & { leaseId: string; code: string; leaseExpiresAt: number; host: Host | null; guests: Map<string, Guest> };
export type RelayGatewayOptions = { origin: string; assetsRoot: string; port: number; mode: 'private' | 'public'; hostToken?: string; trustInternalProxy?: boolean; installerPath?: string };
const randomId = () => randomBytes(16).toString('hex');
// A room is another representation of the existing invitation. Derive its
// 50-bit code from the authenticated host, world and secret invitation token,
// so stop/start or a gateway restart does not silently replace it.
const codeOf = (serverId: string, worldId: string, inviteToken: string) => Array.from(
  createHash('sha256').update(`zavod7-relay-invite-v1\n${serverId}\n${worldId}\n${inviteToken}`).digest().subarray(0, 10),
  byte => NATIVE_RELAY_CODE_ALPHABET[byte & 31]).join('');
function equalToken(a: string, b: string) { return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()); }
function json(res: ServerResponse, status: number, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value)); res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', bytes.length);
  res.setHeader('Cache-Control', 'no-store'); res.end(bytes);
}
function mime(path: string) { return path.endsWith('.txt') ? 'text/plain; charset=utf-8' : path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.webmanifest') ? 'application/manifest+json' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8'; }
function decodeData(value: string) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > NATIVE_RELAY_MAX_DATA_BYTES || bytes.toString('base64') !== value) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}
function internalAddress(value: string) {
  const address = value.toLowerCase().replace(/^::ffff:/, '');
  if (!isIP(address)) return false;
  if (address === '::1' || /^f[cd]/.test(address)) return true;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && (parts[0] === 127 || parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

/** Each verified host controls exactly its own room and guest sockets. */
export class RelayGateway {
  private origin: URL; private root: string; private server: Server | null = null;
  private sessions = new Set<Host>(); private hosts = new Map<string, Host>(); private pending = 0;
  private leases = new Map<string, Lease>(); private routes = new Map<string, Lease>(); private rooms = new Map<string, Lease>();
  private guests = new Map<string, Guest>(); private index: Buffer | null = null;
  private rates = new Map<string, Map<string, Rate>>(); private totals = new Map<string, Rate>();
  private cleanup: ReturnType<typeof setInterval> | null = null; private stopping = false;
  private installerPath: string; private installerAvailable = false;
  constructor(private options: RelayGatewayOptions) {
    this.origin = new URL(options.origin); this.root = resolve(options.assetsRoot);
    this.installerPath = resolve(options.installerPath || join(this.root, INSTALLER));
    if (this.origin.protocol !== 'https:' || this.origin.origin !== options.origin || this.origin.username || this.origin.password) throw new Error('Relay public origin must be an exact HTTPS origin');
    if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error('Invalid relay port');
    if (!['private', 'public'].includes(options.mode)) throw new Error('Invalid relay registration mode');
    if (options.mode === 'private' && !/^[A-Za-z0-9_-]{32,128}$/.test(options.hostToken || '')) throw new Error('Private relay requires a 32–128 character host token');
  }
  async start() {
    if (this.server) throw new Error('Relay already started');
    this.index = await readFile(join(this.root, 'index.html'));
    this.installerAvailable = await this.hasInstaller();
    this.server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
      void this.http(req, res).catch(() => { if (!res.headersSent) json(res, 500, { message: 'Gateway request failed' }); else res.destroy(); });
    });
    this.server.maxConnections = 512; this.server.requestTimeout = 15_000; this.server.headersTimeout = 10_000; this.server.keepAliveTimeout = 5000;
    this.server.on('upgrade', (req, socket, head) => { if (!(socket instanceof Socket)) { socket.destroy(); return; } try { this.upgrade(req, socket, head); } catch { socket.destroy(); } });
    await new Promise<void>((yes, no) => { this.server!.once('error', no); this.server!.listen(this.options.port, '0.0.0.0', () => { this.server!.off('error', no); yes(); }); });
    this.cleanup = setInterval(() => this.sweep(), 30_000);
  }
  private address(req: IncomingMessage) {
    const remote = String(req.socket.remoteAddress || 'unknown');
    if (!this.options.trustInternalProxy || !internalAddress(remote)) return remote;
    // Only enable behind the controlled, unexposed Caddy hop, which overwrites this header.
    const header = req.headers['x-forwarded-for'];
    if (typeof header !== 'string' || header.length > 512) return remote;
    const values = header.split(','); if (values.length > 8) return remote;
    const last = values[values.length - 1].trim(); return isIP(last) ? last : remote;
  }
  private allowed(kind: string, address: string, perAddress: number, global: number) {
    const now = Date.now(); let total = this.totals.get(kind);
    if (!total || now - total.start >= 60_000) this.totals.set(kind, total = { start: now, count: 0 });
    total.count++;
    let rows = this.rates.get(kind); if (!rows) this.rates.set(kind, rows = new Map());
    if (rows.size >= 4096) for (const [key, row] of rows) if (now - row.start >= 60_000) rows.delete(key);
    if (rows.size >= 4096 && !rows.has(address)) rows.delete(rows.keys().next().value!);
    let row = rows.get(address); if (!row || now - row.start >= 60_000) rows.set(address, row = { start: now, count: 0 });
    return ++row.count <= perAddress && total.count <= global;
  }
  private validHost(req: IncomingMessage) { return req.headers.host === this.origin.host; }
  private liveRoom(code: string) {
    const lease = this.rooms.get(code); if (!lease) return null;
    if (Math.min(lease.expiresAt, lease.leaseExpiresAt) <= Date.now()) { this.rooms.delete(code); return null; }
    return lease;
  }
  private async http(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (!this.validHost(req) || req.headers.origin && req.headers.origin !== this.origin.origin) return json(res, 403, { message: 'Wrong gateway host or origin' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { message: 'Method not allowed' });
    const url = new URL(req.url || '/', this.origin);
    if (url.search || url.hash) return json(res, 404, { message: 'Not found' });
    if (url.pathname === '/') {
      const link = this.installerAvailable ? '<p><a id="installer" class="button" href="/native/Zavod7-Server-Setup.exe" download>Скачать сервер для Windows</a></p>' : '';
      const page = Buffer.from(relayLanding.replace('<!--NATIVE-INSTALLER-->', link)); res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Length', page.length);
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', relayLandingCsp);
      res.end(req.method === 'HEAD' ? undefined : page); return;
    }
    if (url.pathname === '/' + INSTALLER) { await this.serveInstaller(req, res); return; }
    const lookup = RESOLVE.exec(url.pathname);
    if (lookup) {
      if (!this.allowed('resolve', this.address(req), 40, 1200)) return json(res, 429, { message: 'Room resolution is rate limited' });
      const room = this.liveRoom(lookup[1]);
      if (!room || !room.host?.socket.isOpen) return json(res, 404, { message: 'Room is unavailable' });
      return json(res, 200, this.roomResponse(room));
    }
    const match = PAGE.exec(url.pathname), room = match && this.liveRoom(match[1]);
    if (!match || !room) return json(res, 404, { message: 'Room is unavailable' });
    const asset = match[2] || 'index.html';
    if (asset === INSTALLER) { await this.serveInstaller(req, res); return; }
    if (asset === 'api/v1/world-info') return json(res, 200, { serverId: room.serverId, worldId: room.worldId, generation: room.generation, maxPlayers: room.maxPlayers, modSet: room.modSet });
    if (!ASSETS.has(asset)) return json(res, 404, { message: 'Not found' });
    try {
      const bytes = asset === 'index.html' ? this.index! : await readFile(join(this.root, asset)); res.statusCode = 200;
      res.setHeader('Content-Type', mime(asset)); res.setHeader('Content-Length', bytes.length); res.setHeader('Cache-Control', asset === 'index.html' ? 'no-store' : 'public, max-age=300');
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { json(res, 404, { message: 'Game asset unavailable' }); }
  }
  private async hasInstaller() {
    try {
      const stat = await lstat(this.installerPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1024 || stat.size > 512 * 1024 * 1024) return false;
      const file = await open(this.installerPath, 'r');
      try { const magic = Buffer.alloc(2); const got = await file.read(magic, 0, 2, 0); return got.bytesRead === 2 && magic.toString('ascii') === 'MZ'; }
      finally { await file.close(); }
    } catch { return false; }
  }
  private async serveInstaller(req: IncomingMessage, res: ServerResponse) {
    if (!this.installerAvailable) { json(res, 404, { message: 'Windows installer unavailable' }); return; }
    if (!this.allowed('installer', this.address(req), 64, 120)) { json(res, 429, { message: 'Installer download is rate limited' }); return; }
    const file = await open(this.installerPath, 'r');
    try {
      const stat = await file.stat(), magic = Buffer.alloc(2); await file.read(magic, 0, 2, 0);
      if (!stat.isFile() || stat.size < 1024 || stat.size > 512 * 1024 * 1024 || magic.toString('ascii') !== 'MZ') { json(res, 404, { message: 'Windows installer unavailable' }); return; }
      res.statusCode = 200; res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', 'attachment; filename="Zavod7-Server-Setup.exe"'); res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'HEAD') res.end(); else await pipeline(file.createReadStream({ start: 0, autoClose: false }), res);
    } finally { await file.close(); }
  }
  private upgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
    const url = new URL(req.url || '/', this.origin);
    if (this.stopping || !this.validHost(req) || url.search || url.hash) { socket.destroy(); return; }
    if (url.pathname === '/v1/host') { this.upgradeHost(req, socket, head); return; }
    const normal = PLAY.exec(url.pathname), resume = RESUME.exec(url.pathname);
    if ((!normal && !resume) || req.headers.origin !== this.origin.origin) { socket.destroy(); return; }
    const lease = resume ? this.routes.get(resume[1]) || null : this.liveRoom(normal![1]);
    this.upgradeGuest(req, socket, head, lease, !!resume);
  }
  private upgradeHost(req: IncomingMessage, socket: Socket, head: Buffer) {
    const address = this.address(req);
    if (req.headers.origin || this.pending >= MAX_PENDING || this.sessions.size >= MAX_HOSTS + MAX_PENDING) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    if (!this.allowed('host', address, 8, 200)) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }
    let host: Host | null = null, earlyClosed = false; const early: { text: string; bytes: number }[] = [];
    const receive = (text: string, bytes: number) => {
      if (!host) { if (early.length < 4) early.push({ text, bytes }); else earlyClosed = true; return; }
      if (host.closed) return;
      if (bytes > (host.authenticated ? NATIVE_WS_MAX_MESSAGE : 8192)) { host.socket.close(1009, 'Host frame too large'); return; }
      const now = Date.now(); if (now - host.rate.at >= 1000) host.rate = { at: now, bytes: 0, frames: 0 };
      host.rate.bytes += bytes; host.rate.frames++;
      if (host.rate.bytes > 64 * 1024 * 1024 || host.rate.frames > 4096) { host.socket.close(1008, 'Host rate limit'); return; }
      let message: unknown; try { message = JSON.parse(text); } catch { host.socket.close(1007, 'Invalid host JSON'); return; }
      if (!isNativeRelayHostMessage(message)) { this.failHost(host, 'message', 'Invalid relay message'); return; }
      this.hostMessage(host, message);
    };
    const ws = acceptNativeWebSocket(req, socket, head, receive, () => { if (host) this.closeHost(host); else earlyClosed = true; }, 8192);
    if (!ws) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    host = { socket: ws, serverId: '', leaseId: '', nonce: randomId(), address, authenticated: false, closed: false, pending: true,
      timer: setTimeout(() => ws.close(1008, 'Host authentication timeout'), 10_000), rate: { at: Date.now(), bytes: 0, frames: 0 }, controls: { start: Date.now(), count: 0 } };
    this.sessions.add(host); this.pending++;
    if (earlyClosed) { ws.terminate(); this.closeHost(host); return; }
    if (this.options.mode === 'public') this.sendHost(host, { type: 'host-challenge', nonce: host.nonce });
    for (const message of early) receive(message.text, message.bytes);
  }
  private authenticate(host: Host, message: NativeRelayHostMessage) {
    let valid = false;
    if (this.options.mode === 'private' && message.type === 'host-auth') valid = equalToken(message.token, this.options.hostToken!);
    else if (this.options.mode === 'public' && message.type === 'host-proof' && message.nonce === host.nonce) {
      try {
        const bytes = Buffer.from(message.publicKey, 'hex');
        const id = createHash('sha256').update(bytes).digest('hex');
        const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: bytes.toString('base64url') }, format: 'jwk' });
        valid = id === message.serverId && verify(null, Buffer.from(nativeRelayHostProofPayload(this.origin.origin, host.nonce, message.serverId, message.leaseId)), key, Buffer.from(message.proof, 'hex'));
      } catch { valid = false; }
    }
    host.nonce = '';
    if (!valid || message.type !== 'host-auth' && message.type !== 'host-proof') { this.failHost(host, 'auth', 'Host authentication failed'); return; }
    const route = this.routes.get(message.leaseId);
    if (route && route.serverId !== message.serverId) { this.failHost(host, 'lease', 'Routing identity is already owned'); return; }
    const previous = this.hosts.get(message.serverId);
    if (previous) {
      // A TLS proxy may retain the old socket after the owner released its
      // world. A fresh signature for that same installation may retire only
      // this idle socket; an active world or different routing lease is denied.
      const released = this.options.mode === 'public' && message.type === 'host-proof' && previous.leaseId === message.leaseId && !this.leases.has(message.serverId);
      if (!released) { this.failHost(host, 'auth', 'This server identity already has an active tunnel'); return; }
      previous.socket.close(1012, 'Released host connection replaced');
    }
    if (this.hosts.size >= MAX_HOSTS || this.options.mode === 'private' && this.hosts.size > 0 || [...this.hosts.values()].filter(other => other.address === host.address).length >= 8) { this.failHost(host, 'limit', 'Host capacity reached'); return; }
    host.serverId = message.serverId; host.leaseId = message.leaseId; host.authenticated = true;
    if (host.pending) { host.pending = false; this.pending--; }
    clearTimeout(host.timer); host.socket.setMessageLimit?.(NATIVE_WS_MAX_MESSAGE); this.hosts.set(host.serverId, host);
    if (!this.sendHost(host, { type: 'host-ready', serverId: host.serverId, leaseId: host.leaseId })) host.socket.close(1013, 'Host readiness backpressure');
  }
  private hostMessage(host: Host, message: NativeRelayHostMessage) {
    if (host.closed || !host.socket.isOpen) return;
    if (!host.authenticated) { this.authenticate(host, message); return; }
    if (this.hosts.get(host.serverId) !== host) { this.failHost(host, 'auth', 'Stale host session'); return; }
    if (message.type === 'host-auth' || message.type === 'host-proof') { this.failHost(host, 'auth', 'Already authenticated'); return; }
    if (message.type === 'pong') return;
    if (message.type === 'register' || message.type === 'release') {
      if (Date.now() - host.controls.start >= 60_000) host.controls = { start: Date.now(), count: 0 };
      if (++host.controls.count > 30) { this.failHost(host, 'limit', 'Room control rate limit'); return; }
      if (message.leaseId !== host.leaseId) { this.failHost(host, 'lease', 'Wrong owned lease'); return; }
      if (message.type === 'register') { this.register(host, message); return; }
      const old = this.leases.get(host.serverId); if (old) this.expireLease(old); return;
    }
    const lease = this.leases.get(host.serverId);
    if (!lease || lease.host !== host || lease.leaseId !== host.leaseId) { this.failHost(host, 'lease', 'No owned room'); return; }
    if (message.type === 'guest-data') {
      const guest = lease.guests.get(message.id), data = decodeData(message.data);
      if (!guest) return;
      if (data === null || guest.socket.bufferedBytes > 4 * 1024 * 1024 || !guest.socket.send(data)) this.closeGuest(guest, 1013, 'Guest data backpressure', true);
    } else if (message.type === 'guest-close') {
      const guest = lease.guests.get(message.id); if (guest) this.closeGuest(guest, message.code, message.reason, false);
    }
  }
  private register(host: Host, message: Extract<NativeRelayHostMessage, { type: 'register' }>) {
    const now = Date.now(); this.sweep();
    if (message.inviteExpiresAt <= now || message.inviteExpiresAt > now + 30 * 24 * 60 * 60 * 1000) { this.failHost(host, 'register', 'Invitation is expired or outside its bound'); return; }
    const prior = this.leases.get(host.serverId), occupiedRoute = this.routes.get(host.leaseId);
    if (occupiedRoute && occupiedRoute.serverId !== host.serverId) { this.failHost(host, 'lease', 'Routing identity collision'); return; }
    const resume = prior && prior.leaseId === host.leaseId && prior.worldId === message.worldId && prior.inviteToken === message.inviteToken && Math.min(prior.expiresAt, prior.leaseExpiresAt) > now;
    if (!prior && this.leases.size >= MAX_LEASES) { this.failHost(host, 'limit', 'Room capacity reached'); return; }
    if (prior && !resume) this.expireLease(prior);
    let lease = resume ? prior! : null;
    if (!lease) {
      const code = codeOf(host.serverId, message.worldId, message.inviteToken);
      if (this.rooms.has(code)) { this.failHost(host, 'register', 'Invitation code collision; rotate the invitation'); return; }
      lease = { serverId: host.serverId, leaseId: host.leaseId, code, worldId: message.worldId, generation: message.generation,
        guestBaseUrl: `${this.origin.origin}/r/${code}/`, inviteToken: message.inviteToken, modSet: structuredClone(message.modSet), maxPlayers: message.maxPlayers,
        expiresAt: message.inviteExpiresAt, leaseExpiresAt: Math.min(message.inviteExpiresAt, now + NATIVE_RELAY_MAX_LEASE_MS), host, guests: new Map() };
      this.leases.set(host.serverId, lease); this.routes.set(host.leaseId, lease); this.rooms.set(code, lease);
    } else {
      lease.generation = message.generation; lease.modSet = structuredClone(message.modSet); lease.maxPlayers = message.maxPlayers;
      lease.expiresAt = Math.min(lease.expiresAt, message.inviteExpiresAt);
      lease.leaseExpiresAt = Math.min(lease.expiresAt, now + NATIVE_RELAY_MAX_LEASE_MS); lease.host = host;
    }
    if (!this.sendHost(host, { type: 'registered', requestId: message.requestId, serverId: host.serverId, leaseId: host.leaseId, code: lease.code, guestBaseUrl: lease.guestBaseUrl, expiresAt: lease.expiresAt })) host.socket.close(1013, 'Registration backpressure');
  }
  private upgradeGuest(req: IncomingMessage, socket: Socket, head: Buffer, lease: Lease | null, resumeOnly: boolean) {
    // These are physical paths, including signed resumes after a tunnel loss.
    // New-player authentication retains its separate 32/minute host-side cap.
    if (!this.allowed('guest', this.address(req), 128, 512)) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }
    if (!lease?.host?.socket.isOpen || lease.guests.size >= NATIVE_RELAY_MAX_GUESTS || this.guests.size >= MAX_TOTAL_GUESTS) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    const host = lease.host;
    let id = randomId(); while (this.guests.has(id)) id = randomId();
    let guest: Guest | null = null, earlyClosed = false; const early: { text: string; bytes: number }[] = [];
    const receive = (text: string, bytes: number) => {
      if (!guest) { if (early.length < 4) early.push({ text, bytes }); else earlyClosed = true; return; }
      if (guest.closed) return;
      if (bytes > NATIVE_RELAY_MAX_DATA_BYTES || lease.host !== host || !host.socket.isOpen || !this.sendHost(host, { type: 'guest-data', id, data: Buffer.from(text, 'utf8').toString('base64') })) this.closeGuest(guest, 1013, 'Relay unavailable', true);
    };
    const ws = acceptNativeWebSocket(req, socket, head, receive, () => { if (guest) this.closeGuest(guest, 1001, 'Guest disconnected', true); else earlyClosed = true; }, NATIVE_RELAY_MAX_DATA_BYTES);
    if (!ws) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    guest = { id, socket: ws, lease, closed: false }; lease.guests.set(id, guest); this.guests.set(id, guest);
    if (earlyClosed) { ws.terminate(); this.closeGuest(guest, 1001, 'Guest disconnected', false); return; }
    if (!this.sendHost(host, { type: 'guest-open', id, resumeOnly })) this.closeGuest(guest, 1013, 'Relay unavailable', false);
    else for (const message of early) receive(message.text, message.bytes);
  }
  private closeGuest(guest: Guest, code: number, reason: string, notify: boolean) {
    if (guest.closed) return; guest.closed = true; guest.lease.guests.delete(guest.id); this.guests.delete(guest.id);
    if (notify && guest.lease.host?.socket.isOpen) this.sendHost(guest.lease.host, { type: 'guest-close', id: guest.id, code, reason: reason.slice(0, 120) });
    guest.socket.close(code, reason.slice(0, 120));
  }
  private closeHost(host: Host) {
    if (host.closed) return; host.closed = true; clearTimeout(host.timer); this.sessions.delete(host);
    if (host.pending) { host.pending = false; this.pending--; }
    if (this.hosts.get(host.serverId) === host) this.hosts.delete(host.serverId);
    const lease = this.leases.get(host.serverId);
    if (lease?.host === host) { lease.host = null; for (const guest of [...lease.guests.values()]) this.closeGuest(guest, 1012, 'Host tunnel disconnected', false); }
  }
  private expireLease(lease: Lease) {
    this.rooms.delete(lease.code); if (this.routes.get(lease.leaseId) === lease) this.routes.delete(lease.leaseId);
    if (this.leases.get(lease.serverId) === lease) this.leases.delete(lease.serverId);
    for (const guest of [...lease.guests.values()]) this.closeGuest(guest, 1001, 'Room released', true);
    lease.host = null;
  }
  private sweep() {
    const now = Date.now();
    for (const lease of this.leases.values()) if (Math.min(lease.expiresAt, lease.leaseExpiresAt) <= now) { this.rooms.delete(lease.code); if (!lease.host?.socket.isOpen) this.expireLease(lease); }
    for (const rows of this.rates.values()) for (const [address, rate] of rows) if (now - rate.start >= 60_000) rows.delete(address);
  }
  private sendHost(host: Host, message: NativeRelayGatewayMessage) {
    return host.socket.isOpen && host.socket.bufferedBytes <= 4 * 1024 * 1024 && host.socket.send(JSON.stringify(message));
  }
  private failHost(host: Host, code: 'auth' | 'register' | 'lease' | 'limit' | 'message', message: string) {
    this.sendHost(host, { type: 'error', code, message: message.slice(0, 160) }); host.socket.close(1008, code);
  }
  private roomResponse(lease: Lease): NativeRelayRoom {
    return { serverId: lease.serverId, worldId: lease.worldId, generation: lease.generation, guestBaseUrl: lease.guestBaseUrl, inviteToken: lease.inviteToken, modSet: lease.modSet, expiresAt: lease.expiresAt, maxPlayers: lease.maxPlayers };
  }
  async stop(reason: string) {
    if (this.stopping) return; this.stopping = true; if (this.cleanup) clearInterval(this.cleanup);
    const sockets = [...this.sessions].map(host => host.socket).concat([...this.guests.values()].map(guest => guest.socket));
    for (const lease of [...this.leases.values()]) this.expireLease(lease);
    for (const host of [...this.sessions]) host.socket.close(1001, reason);
    const terminate = setTimeout(() => sockets.forEach(socket => socket.terminate()), 1000);
    if (this.server) await new Promise<void>(done => this.server!.close(() => done()));
    sockets.forEach(socket => socket.terminate()); clearTimeout(terminate); this.server = null;
  }
}

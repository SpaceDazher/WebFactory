import { createServer, request as requestHttp, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { request as requestHttps } from 'node:https';
import { connect, Socket } from 'node:net';
import { createHash, createHmac, createPublicKey, pbkdf2, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Game, type Command } from '../sim/game';
import { validChestSettings } from '../sim/chest-settings';
import { ITEMS } from '../data/items';
import { PROTOS } from '../data/entities';
import { RECIPES } from '../data/recipes';
import { TECHS } from '../data/techs';
import { CONDS } from '../sim/trains';
import { deserialize, serialize, SAVE_VERSION } from '../sim/save';
import { quickHash } from '../sim/nethash';
import { makeSnapper } from '../sim/snapshot';
import { packStr, unpackStr } from '../core/pack';
import { parsePackage, type ModPackage } from '../mods/mod';
import { applyMods } from '../mods/registry';
import { ScriptHost, scriptMods } from '../mods/script';
import { nodeSpawn, stepScripts } from '../mods/script-node';
import { xQuery, diagnoseAsync } from '../sim/mgmt';
import { statsView, type Tab } from '../sim/prodstats';
import { teleReport } from '../sim/telemetry';
import { slotInfo } from '../sim/slotinfo';
import { SYS_CMDS } from '../net/lockstep';
import { decodeNativeJson, encodeNativeJson, NATIVE_API_VERSION, NATIVE_MAX_FRAME_BYTES, NATIVE_MAX_HANDOFF_BYTES, NATIVE_MAX_SNAPSHOT_BYTES, NATIVE_SNAPSHOT_CHUNK_BYTES, nativeWireHash, type NativeAccessMode, type NativeControlStatus, type NativeHandoffCommitResponse, type NativeHandoffTransactionStatus, type NativePeerMigration, type NativePlayAuth, type NativePlayClientMessage, type NativePlayServerMessage, type NativeSettingsUpdate, type NativeSettingsView } from '../net/native-protocol';
import { guestAdmissionFingerprint, guestAdmissionProofPayload } from '../net/password-proof';
import { modSet, sameMods, type ModSet } from '../net/mods';
import { acceptNativeWebSocket, type NativeSocket, NATIVE_WS_MAX_MESSAGE } from './websocket';
import { NativePlayTransports } from './play-transport';
import { loadNativeHostIdentity, type NativeHostIdentity } from './host-identity';
import { NativeRelayClient, type RelayGuestSocket, type RelayRegistration, type RelayState } from './relay-client';

const EXEC = promisify(execFile);
const TICK_MS = 1000 / 60;
const MAX_CONTROL_BODY = NATIVE_MAX_HANDOFF_BYTES + 1024 * 1024;
const MAX_SAVE_BYTES = NATIVE_MAX_HANDOFF_BYTES;
const MAX_ACTIVE_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_ACTIVE_EXPORT_BYTES = 256 * 1024 * 1024;
const EXPORT_TTL_MS = 60_000;
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_MIN_BYTES = 8;
const PASSWORD_MAX_BYTES = 128;
const MAX_WORLD_ID = /^[a-f0-9]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const PEER_KEY = /^[a-f0-9]{16}$/i;
const PLAYER_ID = /^player-[1-9][0-9]{0,12}$/;
const HASH256 = /^[a-f0-9]{64}$/i;
const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const CONTROL_PORT = portOf(process.env.ZAVOD_CONTROL_PORT, 17837);
const PLAY_PORT = portOf(process.env.ZAVOD_PLAY_PORT, 17838);
const CONTROL_BIND = process.env.ZAVOD_CONTROL_BIND === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
const PUBLIC_ORIGIN = publicOriginOf(process.env.ZAVOD_PUBLIC_ORIGIN || process.env.ZAVOD_RELAY_ORIGIN);
const dataRoot = resolve(process.env.ZAVOD_DATA_DIR || join(process.env.APPDATA || process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'Zavod7', 'native-server'));

function portOf(s: string | undefined, fallback: number) { const n = s ? Number(s) : fallback; if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('Native server port must be 1024–65535'); return n; }
const token = () => randomBytes(32).toString('base64url');
const secretHash = (s: string) => createHash('sha256').update(s).digest('hex');
const sameSecret = (a: string, b: string) => { const x = Buffer.from(secretHash(a), 'hex'), y = Buffer.from(secretHash(b), 'hex'); return x.length === y.length && timingSafeEqual(x, y); };
const validId = (s: unknown): s is string => typeof s === 'string' && MAX_WORLD_ID.test(s);
const id = () => randomBytes(16).toString('hex');
const boundedText = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const isRecord = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === null || Object.getPrototypeOf(v) === Object.prototype);
const safeOrigin = (s: unknown): string | null => { if (typeof s !== 'string' || s.length > 512) return null; try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && u.origin === s ? s : null; } catch { return null; } };
const modClone = (mods: Record<string, Uint8Array>[]) => mods.map(row => Object.fromEntries(Object.entries(row).map(([name, bytes]) => [name, new Uint8Array(bytes)])));

function defaultAccessSettings(ownerPlayerId: string): WorldAccessSettings {
  return { pauseWhenEmpty: true, accessMode: 'invite', password: null, adminPlayerIds: [ownerPlayerId], whitelistHashes: [] };
}
function storedAccessSettings(value: unknown, ownerPlayerId: string): WorldAccessSettings {
  if (value === undefined) return defaultAccessSettings(ownerPlayerId);
  if (!isRecord(value) || Object.keys(value).length !== 5 || typeof value.pauseWhenEmpty !== 'boolean' || !['invite', 'whitelist'].includes(String(value.accessMode)) ||
      !Array.isArray(value.adminPlayerIds) || value.adminPlayerIds.length > 16 || !Array.isArray(value.whitelistHashes) || value.whitelistHashes.length > 256) throw new Error('Некорректные настройки доступа сервера');
  if (value.adminPlayerIds.some((id: unknown) => typeof id !== 'string' || !PLAYER_ID.test(id)) || new Set(value.adminPlayerIds).size !== value.adminPlayerIds.length ||
      value.whitelistHashes.some((hash: unknown) => typeof hash !== 'string' || !HASH256.test(hash)) || new Set(value.whitelistHashes.map((hash: string) => hash.toLowerCase())).size !== value.whitelistHashes.length) throw new Error('Некорректный список доступа сервера');
  let password: PasswordVerifier | null = null;
  if (value.password !== null) {
    const row = value.password;
    if (!isRecord(row) || Object.keys(row).length !== 3 || typeof row.salt !== 'string' || !/^[a-f0-9]{32}$/i.test(row.salt) || typeof row.verifier !== 'string' || !HASH256.test(row.verifier) || row.iterations !== PASSWORD_ITERATIONS) throw new Error('Некорректная запись пароля сервера');
    password = { salt: row.salt.toLowerCase(), verifier: row.verifier.toLowerCase(), iterations: PASSWORD_ITERATIONS };
  }
  const admins = [...new Set([ownerPlayerId, ...value.adminPlayerIds as string[]])];
  return { pauseWhenEmpty: value.pauseWhenEmpty, accessMode: value.accessMode as NativeAccessMode, password,
    adminPlayerIds: admins, whitelistHashes: (value.whitelistHashes as string[]).map(hash => hash.toLowerCase()) };
}
function normalizePasswordInput(value: unknown) {
  if (typeof value !== 'string') throw new Error('Пароль должен быть текстом');
  let password = value.normalize('NFKC');
  try { encodeURIComponent(password); } catch { throw new Error('Пароль содержит некорректный символ'); }
  const bytes = Buffer.byteLength(password, 'utf8');
  if (bytes < PASSWORD_MIN_BYTES || bytes > PASSWORD_MAX_BYTES) throw new Error(`Пароль должен занимать ${PASSWORD_MIN_BYTES}–${PASSWORD_MAX_BYTES} байт`);
  return password;
}
function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolveHash, rejectHash) => pbkdf2(password, salt, PASSWORD_ITERATIONS, 32, 'sha256', (error, result) => error ? rejectHash(error) : resolveHash(result)));
}
function passwordProofPayload(worldId: string, generation: number, challengeId: string, fingerprint: string, role: string, serverId: string) {
  return `zavod7-native-auth\n${serverId}\n${worldId}\n${generation}\n${challengeId}\n${fingerprint}\n${role}`;
}

type ModState = { mods: Record<string, Uint8Array>[]; prio: string[]; game: string };
type PasswordVerifier = { salt: string; verifier: string; iterations: number };
type WorldAccessSettings = { pauseWhenEmpty: boolean; accessMode: NativeAccessMode; password: PasswordVerifier | null; adminPlayerIds: string[]; whitelistHashes: string[] };
type WorldRecord = { id: string; name: string; generation: number; save: any; maxPlayers: 8 | 16; settings: WorldAccessSettings; ownerPlayerId: string; ownerJoinToken: string; inviteToken: string; inviteExpiresAt: number; mods: ModState; updatedAt: number; lastTick: number; reconnect: Record<string, { tokenHash: string; playerId: string; peerKey: string; expiresAt: number; owner?: boolean; admissionHash?: string; clientIdHash?: string }>; lastHandoff?: { transactionId: string; result: NativeHandoffCommitResponse } };
type WorldSummary = { id: string; name: string; updatedAt: number; lastTick: number };
type Handoff = { transactionId: string; state: NativeHandoffTransactionStatus['state']; requestId: string; worldId: string; sessionId: string; sourceGeneration: number; targetGeneration: number; expectedRevision: number; expiresAt: number; worldName: string; result?: NativeHandoffCommitResponse; commitHash?: string };
type SnapshotTransfer = { id: string; bytes: Uint8Array; parts: number; next: number; tick: number; hash: string; snapshot: import('../sim/protocol').Snapshot; startedAt: number; lastProgressAt: number; awaitingAck: boolean; sfxCount: number; achCount: number };
type SaveExport = { id: string; tokenHash: string; peer: PlayPeer; bytes: Uint8Array; hash: string; expiresAt: number };
type PlayPeer = { socket: NativeSocket; playerId: string; playerIndex: number; owner: boolean; admin: boolean; name: string; color: string; reconnectToken: string; lastSeq: number; snapper: ReturnType<typeof makeSnapper>; vp: { x0: number; y0: number; x1: number; y1: number }; focus: number[]; allChunks: boolean; lastView: number; lastSnapshot: number; bucket: { start: number; count: number; bytes: number }; ownerActions: Map<string, string>; pendingSfx: { k: string; x: number; y: number }[]; pendingAch: string[]; snapshotTransfer?: SnapshotTransfer };
type Replay = { hash: string; expiresAt: number; response: any };

class NativeServer {
  private control: Server | null = null;
  private play: Server | null = null;
  private controllerToken = token();
  private csrf = token();
  private startupCapability = token();
  private capabilityUsed = false;
  private revision = 0;
  private health = 'Starting';
  private controllerState: NativeControlStatus['controller']['state'] = 'starting';
  private worlds = new Map<string, WorldRecord>();
  private summaries = new Map<string, WorldSummary>();
  private activeWorld: WorldRecord | null = null;
  private game: Game | null = null;
  private paused = false;
  private emptyPause = false;
  private speed = 1;
  private peers = new Map<NativeSocket, PlayPeer>();
  private hostIdentity: NativeHostIdentity | null = null;
  private playTransports = new NativePlayTransports(() => this.activeWorld && this.hostIdentity ? { id: this.activeWorld.id, generation: this.activeWorld.generation, serverId: this.hostIdentity.serverId } : null, () => this.relay.backupPlayUrl);
  private relayState: RelayState = { state: 'disabled', message: 'Relay is not configured', invite: null };
  private relay = new NativeRelayClient(socket => this.attachRelayGuest(socket), state => { this.relayState = state; });
  private activeSnapshotBytes = 0;
  private activeExportBytes = 0;
  private saveExports = new Map<string, SaveExport>();
  private pendingPlayAuth = 0;
  private authAttempts = new Map<string, { start: number; count: number }>();
  private playUpgradeAttempts = new Map<string, { start: number; count: number }>();
  private handoffs = new Map<string, Handoff>();
  private replay = new Map<string, Replay>();
  private serial: Promise<unknown> = Promise.resolve();
  private lockToken = token();
  private lockPath = join(dataRoot, 'server.lock');
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpTask: Promise<void> | null = null;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private inviteRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private accumulator = 0;
  private lastSnapshotAt = 0;
  private distIndex: Buffer | null = null;
  private modState: ModState = { mods: [], prio: [], game: '' };
  private scriptHost: ScriptHost | null = null;
  private stopRequested = false;
  private pumping = false;
  private snapshotting = false;
  private lastSnapshotMs = 0;
  private lastTickMs = 0;
  private ups = 60;
  private upsWindowStart = performance.now();
  private upsWindowTicks = 0;
  private reachablePlayAddresses: string[] = [];
  private publicOriginReady = false;
  private routeProbeTimer: ReturnType<typeof setInterval> | null = null;
  private routeProbeInFlight = false;
  private emergencySavePending = false;
  private lastBootstrapIssue = 0;

  async start() {
    if (PLAY_PORT === CONTROL_PORT) throw new Error('Control and gameplay ports must differ');
    await mkdir(join(dataRoot, 'worlds'), { recursive: true, mode: 0o700 });
    await this.protectDataRoot();
    await this.acquireLock();
    await this.loadController();
    this.hostIdentity = await loadNativeHostIdentity(dataRoot);
    try { this.distIndex = await readFile(join(DIST_DIR, 'index.html')); }
    catch { throw new Error('Сначала выполните npm run build: игровая страница dist/index.html не найдена'); }
    this.control = createServer((req, res) => { void this.handleControl(req, res); });
    this.play = createServer((req, res) => { void this.handlePlayHttp(req, res); });
    this.play.on('upgrade', (req, socket, head) => { if (!(socket instanceof Socket)) { socket.destroy(); return; } void this.handleUpgrade(req, socket, head); });
    await Promise.all([listen(this.control, CONTROL_BIND, CONTROL_PORT), listen(this.play, '0.0.0.0', PLAY_PORT)]);
    this.relay.start(this.hostIdentity);
    await this.probePlayRoutes();
    this.routeProbeTimer = setInterval(() => { void this.probePlayRoutes(); }, 60_000);
    this.controllerState = 'stopped'; this.health = 'Ready';
    if (this.activeWorld) {
      try { if (this.refreshExpiredInvite(this.activeWorld)) await this.persistWorld(this.activeWorld, false); await this.activateWorld(this.activeWorld); this.relay.setWorld(this.relayRegistration(this.activeWorld)); }
      catch (e) { this.controllerState = 'error'; this.health = 'Сохранённый мир не восстановлен: ' + safeError(e); }
    }
    this.autoSaveTimer = setInterval(() => { if (this.activeWorld && this.game) void this.serialized(() => this.saveActive(true).catch(e => { this.health = 'Не удалось сохранить: ' + safeError(e); })); }, 10 * 60 * 1000);
    this.inviteRefreshTimer = setInterval(() => {
      if (!this.storedInvite || this.inviteExpiresAt <= Date.now()) this.rotateStoredInvite();
      if (this.activeWorld && this.game && this.refreshExpiredInvite(this.activeWorld)) {
        this.relay.setWorld(this.relayRegistration(this.activeWorld));
        void this.serialized(() => this.persistWorld(this.activeWorld!, false).catch(e => { this.health = 'Не удалось обновить приглашение: ' + safeError(e); }));
      }
      this.expireSaveExports();
    }, 60_000);
    const controlUrl = `http://127.0.0.1:${CONTROL_PORT}/#local-admin=${this.startupCapability}`;
    process.stdout.write(`ЗАВОД-7 Dedicated Server\nУправление (секрет только во фрагменте URL): ${controlUrl}\nИгровой адрес для друзей будет показан после запуска мира.\n`);
    process.on('SIGINT', () => { void this.shutdown('SIGINT'); });
    process.on('SIGTERM', () => { void this.shutdown('SIGTERM'); });
  }

  private async acquireLock() {
    try {
      const f = await open(this.lockPath, 'wx', 0o600);
      await f.writeFile(JSON.stringify({ pid: process.pid, token: this.lockToken, at: Date.now() })); await f.sync(); await f.close();
      if (process.platform !== 'win32') await chmod(this.lockPath, 0o600).catch(() => {});
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let stale = false;
      try { const old = JSON.parse(await readFile(this.lockPath, 'utf8')); if (Number.isSafeInteger(old.pid) && old.pid > 0) { try { process.kill(old.pid, 0); } catch (x) { stale = (x as NodeJS.ErrnoException).code === 'ESRCH'; } } }
      catch { stale = false; }
      if (!stale) throw new Error('Сервер уже запущен или файл блокировки повреждён: ' + this.lockPath);
      await rm(this.lockPath, { force: true });
      const f = await open(this.lockPath, 'wx', 0o600); await f.writeFile(JSON.stringify({ pid: process.pid, token: this.lockToken, at: Date.now() })); await f.sync(); await f.close();
    }
  }

  private async protectDataRoot() {
    if (process.platform !== 'win32') { await chmod(dataRoot, 0o700).catch(() => {}); return; }
    // AppData normally inherits a per-user ACL. Make that boundary explicit so
    // the tray/reopen path can read the same bearer without exposing it to other
    // local accounts. Refuse to start if ACL hardening cannot be confirmed.
    const { stdout } = await EXEC('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = /"[^\"]*","(S-1-[0-9-]+)"/.exec(stdout)?.[1];
    if (!sid) throw new Error('Не удалось определить владельца защищённой папки сервера');
    await EXEC('icacls.exe', [dataRoot, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '/grant', '*S-1-5-18:(OI)(CI)F', '/T', '/Q'], { windowsHide: true });
  }

  private async loadController() {
    const file = join(dataRoot, 'controller.json');
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (!data || data.schema !== 1 || !Number.isSafeInteger(data.revision) || !Array.isArray(data.worlds) || data.worlds.length > 500 || !Array.isArray(data.handoffs)) throw new Error('Некорректный формат controller.json');
      if (data.controlAuth && TOKEN.test(data.controlAuth.token) && TOKEN.test(data.controlAuth.csrf)) {
        this.controllerToken = data.controlAuth.token; this.csrf = data.controlAuth.csrf;
      } else {
        this.controllerToken = token(); this.csrf = token();
      }
      this.revision = data.revision;
      for (const s of data.worlds) {
        if (!validId(s.id) || typeof s.name !== 'string' || s.name.length > 80 || !Number.isSafeInteger(s.generation) || s.generation < 0) throw new Error('Некорректная запись мира');
        const rec = await this.readWorld(s.id); if (!rec) continue;
        this.worlds.set(rec.id, rec); this.summaries.set(rec.id, { id: rec.id, name: rec.name, updatedAt: rec.updatedAt, lastTick: rec.lastTick });
      }
      this.activeWorld = validId(data.activeWorldId) ? this.worlds.get(data.activeWorldId) || null : null;
      const invitation = data.invite;
      if (invitation && TOKEN.test(invitation.token) && Number.isFinite(invitation.expiresAt)) {
        // Keep a valid invitation through service restarts; expired tokens are rotated below.
        if (invitation.expiresAt > Date.now()) { this.storedInvite = invitation.token; this.inviteExpiresAt = invitation.expiresAt; }
      }
      this.handoffs.clear();
      for (const h of data.handoffs.slice(-64)) if (h && typeof h.transactionId === 'string' && ['prepared', 'committing', 'committed', 'aborted', 'expired'].includes(h.state)) this.handoffs.set(h.transactionId, h);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (!this.storedInvite || this.inviteExpiresAt <= Date.now()) this.rotateStoredInvite();
    await this.persistController();
  }

  private storedInvite = '';
  private inviteExpiresAt = 0;
  private rotateStoredInvite() { this.storedInvite = token(); this.inviteExpiresAt = Date.now() + 24 * 60 * 60 * 1000; }
  private refreshExpiredInvite(world: WorldRecord) {
    if (world.inviteExpiresAt > Date.now()) return false;
    if (!this.storedInvite || this.inviteExpiresAt <= Date.now()) this.rotateStoredInvite();
    world.inviteToken = this.storedInvite; world.inviteExpiresAt = this.inviteExpiresAt; return true;
  }

  private async readWorld(worldId: string): Promise<WorldRecord | null> {
    if (!validId(worldId)) return null;
    const file = this.worldPath(worldId);
    try {
      const bytes = await readFile(file); if (bytes.byteLength > MAX_SAVE_BYTES) throw new Error('Файл мира превышает ограничение сервера');
      const data = decodeNativeJson<any>(bytes.toString('utf8'), MAX_SAVE_BYTES, 12_000_000);
      const w = data?.world;
      if (data?.schema !== 1 || w?.id !== worldId || typeof w.name !== 'string' || w.name.length > 80 || !Number.isSafeInteger(w.generation) || w.generation < 0 || !PLAYER_ID.test(w.ownerPlayerId) || ![8, 16].includes(w.maxPlayers) || !TOKEN.test(w.inviteToken) || !Number.isFinite(w.inviteExpiresAt) || !TOKEN.test(w.ownerJoinToken) || !w.save || !w.mods || !isRecord(w.reconnect) || Object.keys(w.reconnect).length > 16 || !Number.isFinite(w.updatedAt) || !Number.isSafeInteger(w.lastTick) || w.lastTick < 0) throw new Error('Некорректное сохранение сервера');
      const reconnect: WorldRecord['reconnect'] = Object.create(null);
      for (const [playerId, row] of Object.entries(w.reconnect)) {
        if (!PLAYER_ID.test(playerId) || !isRecord(row) || row.playerId !== playerId || !/^[a-f0-9]{64}$/i.test(row.tokenHash) || !PEER_KEY.test(row.peerKey) || !Number.isFinite(row.expiresAt) || row.expiresAt < 0 || row.owner !== undefined && typeof row.owner !== 'boolean' || row.admissionHash !== undefined && !HASH256.test(row.admissionHash) || row.clientIdHash !== undefined && !HASH256.test(row.clientIdHash)) throw new Error('Некорректная запись повторного подключения');
        reconnect[playerId] = { tokenHash: row.tokenHash.toLowerCase(), playerId, peerKey: row.peerKey.toLowerCase(), expiresAt: row.expiresAt, ...(row.owner ? { owner: true } : {}), ...(typeof row.admissionHash === 'string' ? { admissionHash: row.admissionHash.toLowerCase() } : {}), ...(typeof row.clientIdHash === 'string' ? { clientIdHash: row.clientIdHash.toLowerCase() } : {}) };
      }
      const settings = storedAccessSettings(w.settings, w.ownerPlayerId);
      const mods = this.validateModState(w.mods);
      return { ...w, reconnect, settings, mods } as WorldRecord;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }

  private worldPath(worldId: string) {
    if (!validId(worldId)) throw new Error('Invalid world identifier');
    const root = resolve(dataRoot, 'worlds'), file = resolve(root, worldId + '.json');
    if (!file.startsWith(root + sep)) throw new Error('World path escaped registry');
    return file;
  }

  private async persistController() {
    const payload = { schema: 1, revision: this.revision, controlAuth: { token: this.controllerToken, csrf: this.csrf }, activeWorldId: this.activeWorld?.id || null, worlds: [...this.worlds.values()].map(w => ({ id: w.id, name: w.name, generation: w.generation })), invite: { token: this.storedInvite, expiresAt: this.inviteExpiresAt }, handoffs: [...this.handoffs.values()].slice(-64) };
    await atomicWrite(join(dataRoot, 'controller.json'), Buffer.from(JSON.stringify(payload)), 0o600);
  }

  private async persistWorld(w: WorldRecord, backup: boolean) {
    const file = this.worldPath(w.id);
    if (backup) await rotateBackups(file, 10);
    await atomicWrite(file, Buffer.from(encodeNativeJson({ schema: 1, world: w }, MAX_SAVE_BYTES)), 0o600);
    this.worlds.set(w.id, w); this.summaries.set(w.id, { id: w.id, name: w.name, updatedAt: w.updatedAt, lastTick: w.lastTick });
    this.activeWorld = w;
    await this.persistController();
  }

  private async handleControl(req: IncomingMessage, res: ServerResponse) {
    this.headers(res);
    const origin = this.controlOrigin(req);
    if (!origin) return send(res, 403, { message: 'Local controller only' });
    const url = new URL(req.url || '/', origin), path = url.pathname.replace(/^\/api\/v1/, '') || '/';
    try {
      if (['GET', 'HEAD'].includes(req.method || '') && (path === '/' || ['/index.html', '/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/native/Zavod7-Server-Setup.exe'].includes(path))) return this.servePage(path, res, req.method === 'HEAD');
      if (req.method === 'POST' && path === '/bootstrap') {
        const body = await readJson(req, 4096);
        if (this.capabilityUsed || !isRecord(body) || typeof body.capability !== 'string' || !sameSecret(body.capability, this.startupCapability) || !this.exactOrigin(req, origin)) return send(res, 401, { message: 'Launch capability invalid or already used' });
        this.capabilityUsed = true; this.startupCapability = token();
        return send(res, 200, { apiVersion: NATIVE_API_VERSION, serverId: this.hostIdentity!.serverId, origin, playOrigin: `http://127.0.0.1:${PLAY_PORT}`, revision: this.revision, token: this.controllerToken, csrf: this.csrf });
      }
      if (req.method === 'POST' && path === '/bootstrap-capability') {
        // A loopback Origin is not an OS-user credential: any local process can
        // forge it. Reopening the control page therefore requires the bearer
        // and CSRF pair issued by the one-time launch capability.
        if (!this.authorized(req, origin, true) || !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 401, { message: 'Authenticated local controller required' });
        const body = await readJson(req, 4096);
        if (!isRecord(body) || Object.keys(body).length !== 0 || Date.now() - this.lastBootstrapIssue < 5000) return send(res, 429, { message: 'Launch link was just issued; wait briefly before requesting another' });
        this.startupCapability = token(); this.capabilityUsed = false; this.lastBootstrapIssue = Date.now();
        return send(res, 200, { url: `${origin}/#local-admin=${this.startupCapability}` });
      }
      if (req.method === 'GET' && path.startsWith('/export/')) return this.serveSaveExport(req, res, path.slice('/export/'.length));
      if (!this.authorized(req, origin, req.method !== 'GET')) return send(res, 401, { message: 'Local controller authorization required' });
      if (req.method === 'GET' && path === '/status') return send(res, 200, this.status());
      if (req.method === 'GET' && path === '/worlds') return send(res, 200, { worlds: [...this.summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(({ id: worldId, name }) => ({ id: worldId, name })) });
      if (req.method === 'GET' && path === '/settings') {
        if (!this.activeWorld || !this.game) throw httpError(409, 'Сначала запустите мир');
        return send(res, 200, this.settingsView(this.activeWorld));
      }
      if (req.method === 'GET' && path === '/join-token') {
        return this.joinTokenResponse(res);
      }
      if (req.method === 'GET' && path.startsWith('/handoff/')) {
        const transactionId = path.slice('/handoff/'.length); const h = this.handoffs.get(transactionId);
        if (!h) return send(res, 404, { message: 'Unknown handoff' });
        this.expireHandoff(h);
        return send(res, 200, { state: h.state, result: h.result, expiresAt: h.expiresAt });
      }
      if (req.method !== 'POST') return send(res, 404, { message: 'Not found' });
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 415, { message: 'application/json required' });
      const body = await readJson(req, MAX_CONTROL_BODY);
      if (!isRecord(body)) return send(res, 400, { message: 'Object body required' });
      const result = await this.serialized(() => this.controlMutation(path, body));
      if (path === '/shutdown' && result.accepted) res.once('finish', () => { setTimeout(() => { void this.shutdown('controller shutdown'); }, 25); });
      return send(res, 200, result);
    } catch (e) {
      const err = e as NativeError;
      return send(res, err.status || 400, { message: safeError(e), status: err.status === 409 ? this.status() : undefined, transaction: err.transaction });
    }
  }

  private headers(res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
  }

  private controlOrigin(req: IncomingMessage): string | null {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${CONTROL_PORT}` && host !== `localhost:${CONTROL_PORT}`) return null;
    const origin = req.headers.origin;
    return origin === `http://${host}` ? origin : ['GET', 'HEAD'].includes(req.method || '') && !origin ? `http://${host}` : null;
  }

  private exactOrigin(req: IncomingMessage, origin: string) { return req.headers.origin === origin && req.headers.host === new URL(origin).host; }
  private allowedPlayOrigin(hostHeader: string, origin: string) {
    let target: URL, source: URL;
    try { target = new URL(`http://${hostHeader}`); source = new URL(origin); } catch { return false; }
    if (target.origin === 'null' || source.origin !== origin || !['http:', 'https:'].includes(source.protocol) || source.username || source.password) return false;
    if (origin === `http://${hostHeader}` || origin === `https://${hostHeader}`) return true;
    const targetLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
    const sourceLoopbackControl = source.protocol === 'http:' && source.port === String(CONTROL_PORT) && ['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname);
    return target.port === String(PLAY_PORT) && targetLoopback && sourceLoopbackControl;
  }
  private authorized(req: IncomingMessage, origin: string, csrf: boolean) {
    if (req.method === 'GET') {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return false;
    } else if (!this.exactOrigin(req, origin)) return false;
    const auth = req.headers.authorization || '', supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return !!supplied && sameSecret(supplied, this.controllerToken) && (!csrf || sameSecret(String(req.headers['x-csrf-token'] || ''), this.csrf));
  }

  private expireSaveExports() {
    const now = Date.now();
    for (const entry of this.saveExports.values()) if (entry.expiresAt <= now || !entry.peer.socket.isOpen || this.peers.get(entry.peer.socket) !== entry.peer) this.discardSaveExport(entry.id);
  }

  private discardSaveExport(id: string) {
    const entry = this.saveExports.get(id); if (!entry) return;
    this.activeExportBytes = Math.max(0, this.activeExportBytes - entry.bytes.byteLength); this.saveExports.delete(id);
  }

  private createSaveExport(peer: PlayPeer, result: { str: string; tick: number; info: unknown }) {
    this.expireSaveExports();
    if (!peer.owner || this.peers.get(peer.socket) !== peer) throw new Error('Only the connected owner can export a save');
    if ([...this.saveExports.values()].some(entry => entry.peer === peer)) throw new Error('A previous save export is still available; retry it or wait for expiry');
    const bytes = new TextEncoder().encode(JSON.stringify(result));
    if (!bytes.byteLength || bytes.byteLength > NATIVE_MAX_SNAPSHOT_BYTES || this.activeExportBytes + bytes.byteLength > MAX_ACTIVE_EXPORT_BYTES) throw new Error('Save export exceeds the configured aggregate limit');
    const id = randomBytes(16).toString('hex'), accessToken = token(), hash = nativeWireHash(bytes);
    this.saveExports.set(id, { id, tokenHash: secretHash(accessToken), peer, bytes, hash, expiresAt: Date.now() + EXPORT_TTL_MS });
    this.activeExportBytes += bytes.byteLength;
    return { download: { path: `/api/v1/export/${id}`, token: accessToken, bytes: bytes.byteLength, hash }, tick: result.tick, info: result.info };
  }

  private serveSaveExport(req: IncomingMessage, res: ServerResponse, id: string) {
    if (!/^[a-f0-9]{32}$/.test(id)) return send(res, 404, { message: 'Save export not found' });
    this.expireSaveExports();
    const entry = this.saveExports.get(id), authorization = String(req.headers.authorization || ''), accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!entry || !TOKEN.test(accessToken) || !sameHash(secretHash(accessToken), entry.tokenHash) || !entry.peer.owner || this.peers.get(entry.peer.socket) !== entry.peer) return send(res, 404, { message: 'Save export not found or expired' });
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', entry.bytes.byteLength);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.once('finish', () => this.discardSaveExport(id)); res.end(entry.bytes);
  }

  private async servePage(path: string, res: ServerResponse, head = false) {
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const allowed = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'native/Zavod7-Server-Setup.exe']);
    if (!allowed.has(rel)) return send(res, 404, { message: 'Not found' });
    try {
      const data = rel === 'index.html' && this.distIndex ? this.distIndex : await readFile(join(DIST_DIR, rel));
      res.statusCode = 200; res.setHeader('Content-Type', mime(rel)); res.setHeader('Content-Length', data.byteLength); res.end(head ? undefined : data);
    } catch { send(res, 404, { message: 'Game asset not found; rebuild the application' }); }
  }

  private async handlePlayHttp(req: IncomingMessage, res: ServerResponse) {
    this.headers(res);
    const host = String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');
    if (!this.playHosts().has(host)) return send(res, 403, { message: 'Host is not a configured gameplay address' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return send(res, 403, { message: 'Same-origin guest page required' });
    if (req.method !== 'GET') return send(res, 405, { message: 'Method not allowed' });
    const path = new URL(req.url || '/', `http://${req.headers.host}`).pathname;
    if (path === '/api/v1/world-info') {
      if (!this.activeWorld || !this.game) return send(res, 404, { message: 'No active world' });
      return send(res, 200, { serverId: this.hostIdentity!.serverId, worldId: this.activeWorld.id, generation: this.activeWorld.generation, maxPlayers: this.activeWorld.maxPlayers, modSet: modSet() });
    }
    if (path === '/' || path === '/index.html') return this.servePage('index.html', res);
    if (['/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(path)) return this.servePage(path, res);
    send(res, 404, { message: 'Not found' });
  }

  private async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
    if (req.url !== '/api/v1/play' || !this.activeWorld || !this.game) { socket.destroy(); return; }
    const host = String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');
    if (!this.playHosts().has(host)) { socket.destroy(); return; }
    const origin = req.headers.origin;
    if (!origin || !this.allowedPlayOrigin(String(req.headers.host || ''), origin)) { socket.destroy(); return; }
    const remote = String(req.socket.remoteAddress || 'unknown');
    if (!this.allowPlayUpgrade(remote) || this.pendingPlayAuth >= 32) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return; }
    // Docker port forwarding changes the peer address even for the owner's localhost tab.
    // Origin selects the local route; possession of the owner credential is still mandatory.
    const playRemote = process.env.ZAVOD_DOCKER === '1' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]+)?$/.test(origin) ? 'docker-loopback-forward' : remote;
    let earlyClosed = false, handlers: { receive(text: string, bytes: number): void; closed(): void } | null = null;
    const early: { text: string; bytes: number }[] = [];
    const ws = acceptNativeWebSocket(req, socket, head, (text, bytes) => { if (!handlers) early.push({ text, bytes }); else handlers.receive(text, bytes); }, () => { if (handlers) handlers.closed(); else earlyClosed = true; });
    if (!ws) { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return; }
    handlers = this.playTransports.connect(ws, playRemote, logical => this.attachPlaySocket(logical, playRemote));
    if (earlyClosed) handlers.closed(); else for (const m of early.splice(0)) handlers.receive(m.text, m.bytes);
    socket.once('close', () => handlers?.closed());
  }

  private attachRelayGuest(socket: RelayGuestSocket) {
    if (this.pendingPlayAuth >= 32) { socket.close(1013, 'authentication capacity'); return; }
    const handlers = this.playTransports.connect(socket, 'relay-gateway', logical => this.attachPlaySocket(logical, 'relay-gateway'), socket.resumeOnly);
    socket.bind(handlers.receive); socket.onClosed(handlers.closed);
  }

  private attachPlaySocket(ws: NativeSocket, remote: string) {
    let peer: PlayPeer | null = null, authed = false, authPending = false, closed = false, countedPending = true;
    ws.onUnavailable = () => {
      const game = this.game;
      if (!peer || !game || !game.peers[peer.playerIndex]) return;
      const state = game.peers[peer.playerIndex];
      state.input = { mx: 0, my: 0, mine: null, shoot: null, repair: null };
      if (game.pl === peer.playerIndex) game.input = state.input;
      state.player.mining = null; state.player.bioSampling = null;
      const melee = game.v117.melee[peer.playerId]; if (melee) { melee.windup = 0; melee.hit = true; }
    };
    const challengeWorld = this.activeWorld;
    if (!challengeWorld || !this.game) { ws.close(1013, 'world unavailable'); return { receive: () => {}, closed: () => {} }; }
    const challengeId = token();
    const challenge: Extract<NativePlayServerMessage, { type: 'auth-challenge' }> = {
      type: 'auth-challenge', serverId: this.hostIdentity!.serverId, challengeId, worldId: challengeWorld.id, generation: challengeWorld.generation,
      accessMode: challengeWorld.settings.accessMode, passwordRequired: !!challengeWorld.settings.password,
      ...(challengeWorld.settings.password ? { passwordSalt: challengeWorld.settings.password.salt, passwordIterations: PASSWORD_ITERATIONS } : {}),
    };
    if (!ws.send(encodeNativeJson(challenge))) { ws.close(1013, 'challenge backpressure'); return { receive: () => {}, closed: () => {} }; }
    let challengeConsumed = false;
    this.pendingPlayAuth++;
    const releasePending = () => { if (!countedPending) return; countedPending = false; this.pendingPlayAuth = Math.max(0, this.pendingPlayAuth - 1); };
    const authTimer = setTimeout(() => { if (!authed) ws.close(1008, 'Authentication timeout'); }, 10_000);
    const onClose = () => {
      if (closed) return; closed = true; releasePending(); clearTimeout(authTimer); if (peer) this.detachPeer(peer);
    };
    const receive = (text: string, bytes: number) => {
      if (closed || !ws.isOpen) return;
      let msg: NativePlayClientMessage;
      try { if (bytes > ws.maxMessageBytes) throw new Error('Message too large'); msg = decodeNativeJson<NativePlayClientMessage>(text, ws.maxMessageBytes); }
      catch { ws.close(1007, 'Invalid message'); return; }
      if (!authed) {
        if (msg.type === 'auth' && msg.role === 'owner' && remote !== 'docker-loopback-forward' && remote !== '::1' && !/^127\./.test(remote) && !/^::ffff:127\./.test(remote)) { ws.close(1008, 'Owner requires loopback control'); return; }
        if (authPending || challengeConsumed || bytes > 4096 || msg.type !== 'auth') { ws.close(1008, 'Authentication required'); return; }
        if (!this.allowPlayAuthentication(remote) || this.pendingPlayAuth > 32) { ws.close(1008, 'Authentication rate limit'); return; }
        challengeConsumed = true; authPending = true;
        void this.authenticate(msg, ws, challenge).then(value => {
          releasePending();
          if (closed || !ws.isOpen) { this.detachPeer(value); return; }
          peer = value; authed = true; authPending = false; clearTimeout(authTimer);
          if (msg.type === 'auth') ws.authenticated?.(msg.role === 'guest' ? { publicKey: msg.admissionPublicKey } : { ownerToken: msg.joinToken });
          if (!this.send(peer, { type: 'welcome', serverId: this.hostIdentity!.serverId, worldId: this.activeWorld!.id, sessionId: 'native-' + this.activeWorld!.id, generation: this.activeWorld!.generation, revision: this.revision, playerId: peer.playerId, owner: peer.owner, maxPlayers: this.activeWorld!.maxPlayers, reconnectToken: peer.reconnectToken, tick: this.game!.tick, modSet: modSet() })) { peer.socket.close(1013, 'welcome backpressure'); return; }
          this.sendSnapshot(peer, true);
        }).catch(() => {
          releasePending(); authPending = false;
          if (ws.isOpen) { ws.send(encodeNativeJson({ type: 'error', code: 'auth', message: 'Проверьте приглашение, пароль и список доступа' })); ws.close(1008, 'Authentication failed'); }
        });
        return;
      }
      if (!peer) return;
      if (!this.consumeRate(peer, bytes)) { ws.close(1008, 'Rate limit'); return; }
      void this.handlePlayMessage(peer, msg).catch(e => { if (!this.send(peer!, { type: 'error', code: 'request', message: safeError(e) })) peer!.socket.close(1013, 'error response backpressure'); });
    };
    return { receive, closed: onClose };
  }

  private allowPlayAuthentication(address: string) {
    return this.allowPlayRate(this.authAttempts, address, 32);
  }

  private allowPlayUpgrade(address: string) {
    // A shared NAT can reconnect all 16 signed transports together. Physical
    // retries must not consume the stricter budget for new player admission.
    return this.allowPlayRate(this.playUpgradeAttempts, address, 128);
  }

  private allowPlayRate(attempts: Map<string, { start: number; count: number }>, address: string, limit: number) {
    const now = Date.now();
    for (const [key, value] of attempts) if (now - value.start > 60_000) attempts.delete(key);
    if (attempts.size > 2048) attempts.delete(attempts.keys().next().value!);
    let bucket = attempts.get(address);
    if (!bucket || now - bucket.start >= 60_000) attempts.set(address, bucket = { start: now, count: 0 });
    bucket.count++;
    return bucket.count <= limit;
  }

  private status(): NativeControlStatus {
    const invite = this.activeWorld ? this.inviteStatus(this.activeWorld) : null;
    return { revision: this.revision, controller: { state: this.controllerState, health: this.health }, world: this.activeWorld ? { id: this.activeWorld.id, name: this.activeWorld.name, tick: this.game?.tick ?? this.activeWorld.lastTick, players: this.peers.size, maxPlayers: this.activeWorld.maxPlayers } : null,
      handoff: [...this.handoffs.values()].find(h => h.state === 'prepared' || h.state === 'committing') ? (() => { const h = [...this.handoffs.values()].find(x => x.state === 'prepared' || x.state === 'committing')!; return { worldId: h.worldId, sessionId: h.sessionId, generation: h.targetGeneration }; })() : null, invite };
  }

  private settingsView(world: WorldRecord): NativeSettingsView {
    const game = this.activeWorld?.id === world.id ? this.game : null;
    const online = new Set([...this.peers.values()].filter(peer => peer.playerId !== world.ownerPlayerId).map(peer => peer.playerId));
    const roster = (game?.v117.playerIds || []).map((playerId, index) => ({
      playerId,
      name: game?.peers[index]?.name || `Игрок ${playerId}`,
      role: playerId === world.ownerPlayerId ? 'owner' as const : world.settings.adminPlayerIds.includes(playerId) ? 'admin' as const : 'player' as const,
      online: playerId === world.ownerPlayerId ? online.has(playerId) || [...this.peers.values()].some(peer => peer.playerId === playerId) : online.has(playerId),
    }));
    return { maxPlayers: world.maxPlayers, pauseWhenEmpty: world.settings.pauseWhenEmpty, accessMode: world.settings.accessMode,
      passwordSet: !!world.settings.password, adminPlayerIds: world.settings.adminPlayerIds.slice(), whitelistFingerprints: world.settings.whitelistHashes.slice(), roster };
  }

  private inviteStatus(w: WorldRecord) {
    const lanUrls = this.reachablePlayAddresses.map(ip => `http://${ip}:${PLAY_PORT}/#server-invite=${w.inviteToken}`);
    const preferred = lanUrls[0] || '';
    const relay = this.relay.getInvite(this.relayRegistration(w));
    if (relay) {
      const relayOrigin = new URL(relay.guestBaseUrl).origin;
      return { code: `${relay.guestBaseUrl}#server-invite=${w.inviteToken}`, lanUrls, ready: true, expiresAt: Math.min(w.inviteExpiresAt, relay.expiresAt),
        transport: { kind: 'relay' as const, relayUrl: relayOrigin, roomCode: relay.code }, reachability: 'relay-configured' as const,
        relay: { state: 'ready' as const, message: this.relayState.message, guestBaseUrl: relay.guestBaseUrl, roomCode: relay.code, expiresAt: relay.expiresAt } };
    }
    const publicCode = this.publicOriginReady && PUBLIC_ORIGIN ? `${PUBLIC_ORIGIN}/#server-invite=${w.inviteToken}` : '';
    const code = publicCode || preferred;
    const relayStatus = this.relayState.state === 'ready' ? { state: 'connecting' as const, message: 'Registering the active world with the relay', invite: null } : this.relayState;
    return { code, lanUrls, ready: (!!code || lanUrls.length > 0) && w.inviteExpiresAt > Date.now(), expiresAt: w.inviteExpiresAt,
      transport: publicCode ? { kind: 'https-proxy' as const, proxyUrl: PUBLIC_ORIGIN! } : { kind: 'lan' as const },
      reachability: publicCode ? 'proxy-configured' as const : lanUrls.length ? 'local-only' as const : relayStatus.state === 'unavailable' ? 'relay-unavailable' as const : 'proxy-unavailable' as const,
      relay: { state: relayStatus.state, message: relayStatus.message,
        ...(relayStatus.invite ? { guestBaseUrl: relayStatus.invite.guestBaseUrl, roomCode: relayStatus.invite.code, expiresAt: relayStatus.invite.expiresAt } : {}) } };
  }

  private relayRegistration(world: WorldRecord): RelayRegistration {
    return { serverId: this.hostIdentity!.serverId, worldId: world.id, generation: world.generation, inviteToken: world.inviteToken, inviteExpiresAt: world.inviteExpiresAt,
      maxPlayers: world.maxPlayers, modSet: modSet() };
  }

  private async probePlayRoutes() {
    if (this.routeProbeInFlight || !this.play?.listening) return;
    this.routeProbeInFlight = true;
    try {
      const addresses = advertisedPlayAddresses();
      const results = await Promise.all(addresses.map(address => new Promise<boolean>(resolveProbe => {
        let done = false;
        const finish = (ok: boolean) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolveProbe(ok); };
        const socket = connect(PLAY_PORT, address);
        const timer = setTimeout(() => finish(false), 900);
        socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
      })));
      this.reachablePlayAddresses = addresses.filter((_, i) => results[i]);
      const world = this.activeWorld;
      this.publicOriginReady = !!(PUBLIC_ORIGIN && world && await this.probePublicOrigin(world.id, world.generation) && this.activeWorld?.id === world.id && this.activeWorld.generation === world.generation);
    } finally { this.routeProbeInFlight = false; }
  }

  private playHosts() {
    return new Set(['127.0.0.1', 'localhost', ...advertisedPlayAddresses(), ...(PUBLIC_ORIGIN ? [new URL(PUBLIC_ORIGIN).hostname] : [])]);
  }

  private async probePublicOrigin(worldId: string, generation: number) {
    if (!PUBLIC_ORIGIN) return false;
    const origin = new URL(PUBLIC_ORIGIN), get = (origin.protocol === 'https:' ? requestHttps : requestHttp) as typeof requestHttp;
    const reachable = await new Promise<boolean>(resolveProbe => {
      let settled = false;
      const finish = (ok: boolean) => { if (settled) return; settled = true; clearTimeout(timer); resolveProbe(ok); };
      const timer = setTimeout(() => finish(false), 4000);
      const req = get({ hostname: origin.hostname, port: origin.port || undefined, path: '/api/v1/world-info', method: 'GET', headers: { Accept: 'application/json' }, timeout: 3500 }, response => {
        let data = '', bytes = 0;
        response.on('data', (chunk: Buffer) => { bytes += chunk.byteLength; if (bytes <= 8192) data += chunk.toString('utf8'); else req.destroy(); });
        response.on('end', () => { try { const body = JSON.parse(data); finish(response.statusCode === 200 && body.worldId === worldId && body.generation === generation && validModSet(body.modSet) && sameMods(body.modSet, modSet())); } catch { finish(false); } });
      });
      req.on('timeout', () => req.destroy()); req.on('error', () => finish(false)); req.end();
    });
    if (!reachable) return false;
    return new Promise<boolean>(resolveProbe => {
      let settled = false;
      const finish = (ok: boolean, socket?: Socket) => { if (settled) return; settled = true; clearTimeout(timer); socket?.destroy(); resolveProbe(ok); };
      const timer = setTimeout(() => finish(false), 4000);
      const req = get({ hostname: origin.hostname, port: origin.port || undefined, path: '/api/v1/play', method: 'GET', headers: {
        Host: origin.host, Origin: origin.origin, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      }, timeout: 3500 });
      req.on('upgrade', (response, socket) => finish(response.statusCode === 101, socket));
      req.on('response', response => { response.resume(); finish(false); });
      req.on('timeout', () => req.destroy()); req.on('error', () => finish(false)); req.end();
    });
  }

  private joinTokenResponse(res: ServerResponse) {
    if (!this.activeWorld || !this.game) return send(res, 409, { message: 'Сначала запустите мир' });
    return send(res, 200, { serverId: this.hostIdentity!.serverId, worldId: this.activeWorld.id, generation: this.activeWorld.generation, ownerPlayerId: this.activeWorld.ownerPlayerId, joinToken: this.activeWorld.ownerJoinToken });
  }

  private async controlMutation(path: string, body: Record<string, any>) {
    const requestId = body.requestId;
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw httpError(400, 'Valid requestId required');
    const hash = createHash('sha256').update(encodeNativeJson(body, MAX_CONTROL_BODY)).digest('hex');
    this.pruneReplay(); const previous = this.replay.get(requestId);
    if (previous) { if (previous.hash !== hash) throw httpError(409, 'requestId was reused with a different body'); return previous.response; }
    const expected = body.expectedRevision;
    const abortRequest = path === '/handoff/abort';
    if (!Number.isSafeInteger(expected) || (!abortRequest && expected !== this.revision)) throw httpError(409, 'Controller state changed');
    let result: any;
    let changed = true;
    switch (path) {
      case '/start': result = await this.startAction(body); break;
      case '/openWorld': result = await this.openWorldAction(body); break;
      case '/stop': result = await this.stopAction(); break;
      case '/shutdown': result = { stopping: true }; break;
      case '/rotateInvite': result = await this.rotateInviteAction(); break;
      case '/settings': result = await this.updateSettings(body.settings); break;
      case '/handoff/prepare': result = await this.prepareHandoff(body); break;
      case '/handoff/commit': result = await this.commitHandoff(body); break;
      case '/handoff/abort': result = await this.abortHandoff(body); changed = !!result.changed; delete result.changed; break;
      default: throw httpError(404, 'Unknown controller operation');
    }
    if (changed) this.revision++;
    await this.persistController();
    const response = { requestId, accepted: true, revision: this.revision, ...result };
    this.replay.set(requestId, { hash, response, expiresAt: Date.now() + 5 * 60 * 1000 });
    return response;
  }

  private pruneReplay() { const now = Date.now(); for (const [key, value] of this.replay) if (value.expiresAt <= now) this.replay.delete(key); while (this.replay.size > 1024) this.replay.delete(this.replay.keys().next().value!); }
  private serialized<T>(fn: () => Promise<T>): Promise<T> { const p = this.serial.then(fn); this.serial = p.catch(() => undefined); return p; }

  private validateModState(raw: unknown): ModState {
    if (!isRecord(raw) || !Array.isArray(raw.mods) || raw.mods.length > 64 || !Array.isArray(raw.prio) || raw.prio.length > 64 || typeof raw.game !== 'string' || raw.game.length > 32) throw httpError(400, 'Некорректный список модов');
    const mods: Record<string, Uint8Array>[] = []; let total = 0;
    for (const row of raw.mods) {
      if (!isRecord(row) || Object.keys(row).length > 256) throw httpError(400, 'Некорректный архив мода');
      const files: Record<string, Uint8Array> = Object.create(null);
      for (const [name, value] of Object.entries(row)) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,180}$/.test(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..') || !(value instanceof Uint8Array) || value.byteLength > 16 * 1024 * 1024) throw httpError(400, 'Файл мода имеет недопустимый путь или размер');
        total += value.byteLength; if (total > 64 * 1024 * 1024) throw httpError(413, 'Общий размер модов превышает 64 МиБ');
        files[name] = new Uint8Array(value);
      }
      mods.push(files);
    }
    if (raw.prio.some((p: unknown) => typeof p !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(p)) || new Set(raw.prio).size !== raw.prio.length) throw httpError(400, 'Некорректный порядок модов');
    return { mods, prio: raw.prio.slice(), game: raw.game || '1.17.0' };
  }

  private applyModState(state: ModState) {
    const clean = this.validateModState(state);
    const packages = clean.mods.map((files, i) => parsePackage(files, `mod-${i + 1}`));
    const result = applyMods(packages, clean.prio, clean.game);
    if (result.failed.length) throw httpError(400, `Не удалось загрузить моды: ${result.failed.slice(0, 3).map(x => x.title).join(', ')}`);
    this.modState = { mods: modClone(clean.mods), prio: clean.prio.slice(), game: clean.game };
    return packages;
  }

  private activateScripts(game: Game, packages: ModPackage[]) {
    const host = new ScriptHost(nodeSpawn, { command: c => { if (this.game === game) game.enqueue(c as Command); }, onConsole: l => { if (this.activeWorld) this.health = `Мод ${l.mod}: ${l.text}`.slice(0, 180); } });
    const scenario = game.scn?.script ? [{ name: 'scn-' + game.scn.id, title: game.scn.name, code: game.scn.script }] : [];
    host.setMods([...scriptMods(packages), ...scenario]); host.attach(game); this.scriptHost = host;
  }

  private normalizePeerRoles(game: Game, ownerPlayerId: string, adminPlayerIds: string[] = []) {
    const ownerIndex = game.v117.playerIds.indexOf(ownerPlayerId);
    // A single-player save keeps its engineer directly on Game until the first
    // peer joins. Promote that same seat before dedicated ownership is checked;
    // addPeer would create a second engineer and a new inventory.
    if (!game.peers.length && game.v117.playerIds.length === 1 && ownerIndex === 0) {
      game.peers.push({ name: 'Игрок 1', color: game.peer(0).color,
        player: game.player, inv: game.inv, trash: game.trash, input: game.input,
        queue: game.queue, held: game.held, equip: game.equip, preq: game.preq,
        preqOff: game.preqOff, undoStack: game.undoStack, redoStack: game.redoStack });
    }
    if (ownerIndex < 0 || ownerIndex >= 16 || !game.peers[ownerIndex]) throw httpError(400, 'У владельца сервера нет сохранённого места игрока');
    for (let i = 0; i < game.peers.length; i++) {
      const peer = game.peers[i]; if (!peer) continue;
      // A save may have been hosted by another peer. Only the authenticated
      // owner receives host authority in the dedicated process; existing
      // explicitly granted admins remain admins.
      const playerId = game.v117.playerIds[i];
      peer.role = i === ownerIndex ? 'host' : adminPlayerIds.includes(playerId) ? 'admin' : 'player';
    }
  }

  private async activateWorld(world: WorldRecord) {
    const previous = { game: this.game, world: this.activeWorld, host: this.scriptHost, mods: this.modState, paused: this.paused, emptyPause: this.emptyPause };
    this.paused = true; this.scriptHost?.stop(); this.scriptHost = null;
    try {
      const packages = this.applyModState(world.mods);
      const game = deserialize(world.save); game.dedicatedServer = true;
      if (!game.v117.playerIds.includes(world.ownerPlayerId) || game.v117.playerIds.length > 16 || game.peers.length && game.peers.length !== game.v117.playerIds.length) throw httpError(400, 'Мир не содержит ожидаемые идентификаторы игроков');
      this.normalizePeerRoles(game, world.ownerPlayerId, world.settings.adminPlayerIds);
      world.save = serialize(game); world.lastTick = game.tick;
      this.game = game; this.activeWorld = world; this.speed = 1; this.paused = world.settings.pauseWhenEmpty; this.emptyPause = world.settings.pauseWhenEmpty;
      this.controllerState = 'running'; this.health = world.settings.pauseWhenEmpty ? 'Мир загружен; сервер ожидает игроков' : 'Мир загружен и работает';
      this.activateScripts(game, packages); this.lastTime = 0; this.accumulator = 0; this.schedulePump();
    } catch (e) {
      (this.scriptHost as ScriptHost | null)?.stop(); this.scriptHost = previous.host; this.game = previous.game; this.activeWorld = previous.world; this.paused = previous.paused; this.emptyPause = previous.emptyPause;
      try { this.applyModState(previous.mods); if (previous.game) this.activateScripts(previous.game, previous.mods.mods.map((files, i) => parsePackage(files, `mod-${i + 1}`))); } catch { /* retain original activation error */ }
      throw e;
    }
  }

  private async startAction(body: Record<string, any>) {
    if (this.game) throw httpError(409, 'Сначала остановите текущий мир');
    const cfg = body.world;
    if (!isRecord(cfg) || !['new', 'open'].includes(cfg.mode)) throw httpError(400, 'Укажите режим нового или сохранённого мира');
    if (body.transport && (!isRecord(body.transport) || !['lan', 'https-proxy', 'relay'].includes(body.transport.kind) || body.transport.kind === 'https-proxy' && !PUBLIC_ORIGIN || body.transport.kind === 'relay' && this.relayState.state === 'disabled')) throw httpError(400, 'Указанный транспорт не настроен');
    if (cfg.mode === 'open') return this.openWorldAction({ worldId: cfg.worldId });
    const maxPlayers = isRecord(body.settings) && body.settings.maxPlayers !== undefined ? body.settings.maxPlayers : body.maxPlayers === undefined ? 8 : body.maxPlayers;
    if (maxPlayers !== 8 && maxPlayers !== 16) throw httpError(400, 'Лимит сервера должен быть 8 или 16');
    if (!this.storedInvite || this.inviteExpiresAt <= Date.now()) this.rotateStoredInvite();
    const seed = randomBytes(4).readUInt32LE(0), game = new Game(seed, true); game.dedicatedServer = true;
    const state: ModState = { mods: [], prio: [], game: '1.17.0' }; this.applyModState(state);
    const ownerPlayerId = game.v117.playerIds[0] || 'player-1';
    const settings = await this.parseSettingsUpdate(body.settings || { maxPlayers, pauseWhenEmpty: true, accessMode: 'invite', adminPlayerIds: [], whitelistFingerprints: [], removeWhitelistFingerprints: [] }, defaultAccessSettings(ownerPlayerId), maxPlayers, game.v117.playerIds);
    const now = Date.now();
    const world: WorldRecord = { id: id(), name: boundedText(cfg.name, 80) || `Мир ${new Date(now).toLocaleDateString('ru-RU')}`, generation: 0,
      save: serialize(game), maxPlayers: settings.maxPlayers, settings: settings.settings, ownerPlayerId, ownerJoinToken: token(), inviteToken: this.storedInvite,
      inviteExpiresAt: this.inviteExpiresAt, mods: state, updatedAt: now, lastTick: game.tick, reconnect: {} };
    await this.activateWorld(world); await this.persistWorld(world, false); this.relay.setWorld(this.relayRegistration(world)); void this.probePlayRoutes();
    return { worldId: world.id, generation: world.generation };
  }

  private async openWorldAction(body: Record<string, any>) {
    if (!validId(body.worldId)) throw httpError(400, 'Недопустимый идентификатор мира');
    const world = this.worlds.get(body.worldId) || await this.readWorld(body.worldId);
    if (!world) throw httpError(404, 'Сохранённый мир не найден');
    this.refreshExpiredInvite(world);
    if (this.game && this.activeWorld?.id === world.id) return { worldId: world.id, generation: world.generation };
    const previousPaused = this.paused;
    if (this.game) {
      this.paused = true; if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
      await this.pumpTask; await this.saveActive(true);
    }
    try { await this.activateWorld(world); await this.persistWorld(world, false); this.relay.setWorld(this.relayRegistration(world)); void this.probePlayRoutes(); }
    catch (e) { this.paused = previousPaused; this.schedulePump(); throw e; }
    return { worldId: world.id, generation: world.generation };
  }

  private async parseSettingsUpdate(raw: unknown, base: WorldAccessSettings, currentMax: 8 | 16, playerIds: string[]) {
    if (!isRecord(raw)) throw httpError(400, 'Настройки сервера должны быть объектом');
    const allowed = new Set(['maxPlayers', 'pauseWhenEmpty', 'accessMode', 'password', 'clearPassword', 'adminPlayerIds', 'whitelistFingerprints', 'removeWhitelistFingerprints']);
    if (Object.keys(raw).some(key => !allowed.has(key))) throw httpError(400, 'Неизвестное поле настроек сервера');
    const maxPlayers = raw.maxPlayers === undefined ? currentMax : raw.maxPlayers;
    const pauseWhenEmpty = raw.pauseWhenEmpty === undefined ? base.pauseWhenEmpty : raw.pauseWhenEmpty;
    const accessMode = raw.accessMode === undefined ? base.accessMode : raw.accessMode;
    if ((maxPlayers !== 8 && maxPlayers !== 16) || typeof pauseWhenEmpty !== 'boolean' || !['invite', 'whitelist'].includes(String(accessMode))) throw httpError(400, 'Некорректные настройки сервера');
    const admins = raw.adminPlayerIds === undefined ? base.adminPlayerIds : raw.adminPlayerIds;
    if (!Array.isArray(admins) || admins.length > 16 || admins.some(id => typeof id !== 'string' || !PLAYER_ID.test(id) || !playerIds.includes(id)) || new Set(admins).size !== admins.length) throw httpError(400, 'Администраторы должны быть выбранными идентификаторами игроков');
    const additions = raw.whitelistFingerprints === undefined ? [] : raw.whitelistFingerprints;
    const removals = raw.removeWhitelistFingerprints === undefined ? [] : raw.removeWhitelistFingerprints;
    if (!Array.isArray(additions) || additions.length > 64 || additions.some(id => typeof id !== 'string' || !HASH256.test(id)) ||
        !Array.isArray(removals) || removals.length > 256 || removals.some(hash => typeof hash !== 'string' || !HASH256.test(hash))) throw httpError(400, 'Некорректный список устройств белого списка');
    if (typeof raw.clearPassword !== 'undefined' && typeof raw.clearPassword !== 'boolean') throw httpError(400, 'Некорректный флаг пароля');
    if (raw.clearPassword && typeof raw.password !== 'undefined') throw httpError(400, 'Укажите смену или удаление пароля, но не оба действия');
    let password = base.password;
    if (raw.clearPassword === true) password = null;
    else if (raw.password !== undefined && raw.password !== '') {
      const normalized = normalizePasswordInput(raw.password);
      const salt = randomBytes(16);
      const verifier = await derivePassword(normalized, salt);
      password = { salt: salt.toString('hex'), verifier: verifier.toString('hex'), iterations: PASSWORD_ITERATIONS };
    }
    const whitelist = new Set(base.whitelistHashes.map(hash => hash.toLowerCase()));
    for (const hash of removals as string[]) whitelist.delete(hash.toLowerCase());
    for (const fingerprint of additions as string[]) whitelist.add(fingerprint.toLowerCase());
    if (whitelist.size > 256) throw httpError(400, 'В белом списке может быть не больше 256 устройств');
    const ownerId = this.activeWorld?.ownerPlayerId || playerIds[0];
    const adminPlayerIds = [...new Set([ownerId, ...(admins as string[])])];
    return { maxPlayers: maxPlayers as 8 | 16, settings: { pauseWhenEmpty, accessMode: accessMode as NativeAccessMode, password, adminPlayerIds, whitelistHashes: [...whitelist].sort() } satisfies WorldAccessSettings };
  }

  private async updateSettings(raw: unknown) {
    const world = this.activeWorld, game = this.game;
    if (!world || !game) throw httpError(409, 'Сначала запустите мир');
    const parsed = await this.parseSettingsUpdate(raw, world.settings, world.maxPlayers, game.v117.playerIds);
    if (parsed.maxPlayers < this.peers.size) throw httpError(409, 'Новый лимит меньше текущего числа подключённых игроков');
    const priorPaused = this.paused, priorEmptyPause = this.emptyPause, priorSettings = world.settings, priorMax = world.maxPlayers;
    this.paused = true; if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
    await this.pumpTask;
    try {
      world.settings = parsed.settings; world.maxPlayers = parsed.maxPlayers;
      this.normalizePeerRoles(game, world.ownerPlayerId, world.settings.adminPlayerIds);
      this.emptyPause = this.peers.size === 0 && world.settings.pauseWhenEmpty;
      // The temporary save pause must not become a manual pause after an
      // ordinary settings change. Retain a real owner pause, release an old
      // empty-server pause when the policy no longer requires it.
      this.paused = this.emptyPause || (!priorEmptyPause && priorPaused);
      world.save = serialize(game); world.lastTick = game.tick; world.updatedAt = Date.now();
      await this.persistWorld(world, false);
    } catch (error) {
      world.settings = priorSettings; world.maxPlayers = priorMax; this.normalizePeerRoles(game, world.ownerPlayerId, priorSettings.adminPlayerIds);
      this.paused = priorPaused; this.emptyPause = priorEmptyPause; throw error;
    } finally { if (this.game === game) this.schedulePump(); }
    this.relay.setWorld(this.relayRegistration(world));
    return this.settingsView(world);
  }

  private async stopAction() {
    if (this.game) {
      const previousPaused = this.paused, previousEmptyPause = this.emptyPause;
      this.controllerState = 'stopping'; this.paused = true;
      if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
      await this.pumpTask;
      try { await this.saveActive(true); }
      catch (e) {
        this.controllerState = 'running'; this.health = 'Остановка отменена: сохранение не удалось';
        this.paused = previousPaused; this.emptyPause = previousEmptyPause;
        this.lastTime = 0; this.accumulator = 0; this.schedulePump();
        throw e;
      }
      this.relay.setWorld(null);
      this.scriptHost?.stop(); this.scriptHost = null;
      for (const peer of [...this.peers.values()]) peer.socket.close(1001, 'server stopping');
      for (const exportId of [...this.saveExports.keys()]) this.discardSaveExport(exportId);
      if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
      this.game = null; this.activeWorld = null; this.peers.clear(); this.paused = true; this.emptyPause = false; this.controllerState = 'stopped'; this.health = 'Остановлен';
    }
    await this.persistController();
    return { stopped: true };
  }

  private async rotateInviteAction() {
    if (!this.activeWorld) throw httpError(409, 'Сначала запустите мир');
    this.rotateStoredInvite();
    const world = this.activeWorld; world.inviteToken = this.storedInvite; world.inviteExpiresAt = this.inviteExpiresAt;
    this.relay.setWorld(this.relayRegistration(world));
    await this.persistWorld(world, false); return { invite: this.inviteStatus(world) };
  }

  private async saveActive(backup: boolean) {
    const game = this.game, world = this.activeWorld; if (!game || !world) return;
    const wasPaused = this.paused; this.paused = true;
    if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
    try {
      await this.pumpTask;
      if (this.game !== game || this.activeWorld !== world) throw httpError(409, 'Мир изменился во время сохранения');
      world.save = serialize(game); world.lastTick = game.tick; world.updatedAt = Date.now(); world.mods = { mods: modClone(this.modState.mods), prio: this.modState.prio.slice(), game: this.modState.game };
      await this.persistWorld(world, backup);
    } finally {
      if (this.game === game && !this.stopRequested) {
        if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
        if (!wasPaused) this.paused = false;
        this.schedulePump();
      }
    }
  }

  private schedulePump() {
    if (this.stopRequested || !this.game || this.tickTimer) return;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      const task = this.pump(); this.pumpTask = task;
      void task.finally(() => { if (this.pumpTask === task) this.pumpTask = null; });
    }, this.paused ? 50 : 8);
  }

  private async pump() {
    if (this.pumping || this.stopRequested || !this.game) return;
    this.pumping = true;
    const started = performance.now();
    try {
      const game = this.game, now = started;
      const elapsed = Math.min(250, this.lastTime ? now - this.lastTime : TICK_MS); this.lastTime = now;
      if (!this.paused) this.accumulator += elapsed * this.speed;
      let count = 0;
      while (!this.paused && this.accumulator >= TICK_MS && count < 8) {
        const before = performance.now(); await stepScripts(game, this.scriptHost!, 1); this.accumulator -= TICK_MS; count++;
        this.lastTickMs = performance.now() - before;
        if (this.game !== game) break;
      }
      const nucEvents = game.nucEv.splice(0);
      if (nucEvents.some(event => event.k === 'overheat') && !this.emergencySavePending) {
        this.emergencySavePending = true;
        void this.serialized(async () => { try { await this.saveActive(true); } catch (e) { this.health = 'Аварийная копия мира не сохранена: ' + safeError(e); } finally { this.emergencySavePending = false; } });
      }
      this.upsWindowTicks += count;
      const wallNow = performance.now(), windowMs = wallNow - this.upsWindowStart;
      if (windowMs >= 1000) { this.ups = this.upsWindowTicks * 1000 / windowMs; this.upsWindowTicks = 0; this.upsWindowStart = wallNow; }
      if (this.game && performance.now() - this.lastSnapshotMs >= 100) this.broadcastSnapshots();
    } catch (e) { this.paused = true; this.health = 'Симуляция приостановлена: ' + safeError(e); }
    finally { this.pumping = false; if (!this.stopRequested && this.game) this.schedulePump(); }
  }

  private async shutdown(signal: string) {
    if (this.stopRequested) return;
    this.stopRequested = true; if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
    if (this.routeProbeTimer) clearInterval(this.routeProbeTimer); this.routeProbeTimer = null;
    if (this.inviteRefreshTimer) clearInterval(this.inviteRefreshTimer); this.inviteRefreshTimer = null;
    this.controllerState = 'stopping'; this.paused = true;
    await this.pumpTask;
    try { await this.serialized(() => this.saveActive(true)); }
    catch (e) { this.stopRequested = false; this.controllerState = 'running'; this.health = 'Не удалось завершить сохранение; сервер продолжает работу: ' + safeError(e); this.schedulePump(); return; }
    this.autoSaveTimer && clearInterval(this.autoSaveTimer); this.relay.stop(); this.scriptHost?.stop(); this.scriptHost = null;
    for (const peer of [...this.peers.values()]) peer.socket.close(1001, signal);
    for (const exportId of [...this.saveExports.keys()]) this.discardSaveExport(exportId);
    await Promise.all([this.control && new Promise<void>(r => this.control!.close(() => r())), this.play && new Promise<void>(r => this.play!.close(() => r()))]);
    try { const lock = JSON.parse(await readFile(this.lockPath, 'utf8')); if (lock.token === this.lockToken) await rm(this.lockPath, { force: true }); } catch { /* lock file is recoverable on next start */ }
    this.controllerState = 'stopped'; this.health = 'Остановлен';
  }

  private expireHandoff(h: Handoff) {
    if (h.state === 'prepared' && h.expiresAt <= Date.now()) { h.state = 'expired'; void this.persistController(); }
  }

  private async prepareHandoff(body: Record<string, any>) {
    if (this.game) throw httpError(409, 'Остановите текущий сервер перед передачей локального мира');
    if (typeof body.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.sessionId) || !Number.isSafeInteger(body.sourceGeneration) || body.sourceGeneration < 0) throw httpError(400, 'Некорректная сессия исходного мира');
    const worldName = boundedText(body.worldName, 80); if (!worldName) throw httpError(400, 'Название мира обязательно');
    if ([...this.handoffs.values()].some(h => h.state === 'prepared' || h.state === 'committing')) throw httpError(409, 'Уже выполняется передача мира');
    const now = Date.now(), h: Handoff = { transactionId: token(), state: 'prepared', requestId: body.requestId, worldId: id(), sessionId: body.sessionId,
      sourceGeneration: body.sourceGeneration, targetGeneration: body.sourceGeneration + 1, expectedRevision: this.revision + 1, expiresAt: now + 5 * 60 * 1000, worldName };
    this.handoffs.set(h.transactionId, h); await this.persistController();
    return { transactionId: h.transactionId, worldId: h.worldId, sessionId: h.sessionId, sourceGeneration: h.sourceGeneration, targetGeneration: h.targetGeneration, expectedRevision: h.expectedRevision, expiresAt: h.expiresAt };
  }

  private async abortHandoff(body: Record<string, any>) {
    if (typeof body.transactionId !== 'string') throw httpError(400, 'transactionId required');
    const h = this.handoffs.get(body.transactionId); if (!h) throw httpError(404, 'Unknown handoff');
    this.expireHandoff(h);
    if (h.state === 'committed') return { state: h.state, result: h.result, changed: false };
    if (h.state === 'committing') return { state: h.state, changed: false };
    if (h.state === 'aborted' || h.state === 'expired') return { state: h.state, changed: false };
    h.state = 'aborted'; await this.persistController(); return { state: h.state, changed: true };
  }

  private async commitHandoff(body: Record<string, any>) {
    if (typeof body.transactionId !== 'string' || !PLAYER_ID.test(body.ownerPlayerId) || !Number.isSafeInteger(body.lastTick) || body.lastTick < 0 || typeof body.lastHash !== 'string' || !/^[a-f0-9]{8,128}$/i.test(body.lastHash) || !body.save) throw httpError(400, 'Некорректные данные передачи мира');
    const h = this.handoffs.get(body.transactionId); if (!h) throw httpError(404, 'Unknown handoff'); this.expireHandoff(h);
    if (h.state === 'committed' && h.result) return h.result;
    if (h.state !== 'prepared' || h.expectedRevision !== this.revision || h.expiresAt <= Date.now()) throw httpError(409, 'Передача мира устарела или отменена');
    let state: ModState; try { state = this.validateModState(body.modState || { mods: [], prio: [], game: '1.17.0' }); } catch (e) { throw e; }
    const packages = this.applyModState(state);
    const game = deserialize(body.save);
    if (game.tick !== body.lastTick || quickHash(game) !== body.lastHash || !game.v117.playerIds.includes(body.ownerPlayerId) || game.v117.playerIds.length > 16 || game.v117.playerIds.length < 1) throw httpError(409, 'Снимок передачи не совпадает с указанным тиком, владельцем или хешем');
    game.dedicatedServer = true;
    const ownerIndex = game.v117.playerIds.indexOf(body.ownerPlayerId);
    const settings = defaultAccessSettings(body.ownerPlayerId);
    this.normalizePeerRoles(game, body.ownerPlayerId, settings.adminPlayerIds);
    const maxPlayers: 8 | 16 = game.v117.playerIds.length > 8 ? 16 : 8;
    if (!this.storedInvite || this.inviteExpiresAt <= Date.now()) this.rotateStoredInvite();
    const now = Date.now(), ownerJoinToken = token(), ownerReconnect = token(), reconnect: WorldRecord['reconnect'] = {};
    const expiry = now + 30 * 24 * 60 * 60 * 1000;
    const ownerKey = game.peers[ownerIndex]?.key && PEER_KEY.test(game.peers[ownerIndex].key!) ? game.peers[ownerIndex].key! : randomBytes(8).toString('hex');
    reconnect[body.ownerPlayerId] = { tokenHash: secretHash(ownerReconnect), playerId: body.ownerPlayerId, peerKey: ownerKey, expiresAt: expiry, owner: true };
    const playOrigin = this.reachablePlayAddresses[0] ? `http://${this.reachablePlayAddresses[0]}:${PLAY_PORT}` : '';
    const peerMigrations: NativePeerMigration[] = [];
    for (let i = 0; i < game.v117.playerIds.length; i++) {
      const playerId = game.v117.playerIds[i]; if (playerId === body.ownerPlayerId || !game.peers[i]) continue;
      const peerKey = game.peers[i].key || ''; if (!PEER_KEY.test(peerKey) || !playOrigin) continue;
      const reconnectToken = token(), expiresAt = expiry;
      reconnect[playerId] = { tokenHash: secretHash(reconnectToken), playerId, peerKey, expiresAt };
      peerMigrations.push({ playerId, peerKey, playOrigin, reconnectToken, expiresAt });
    }
    const world: WorldRecord = { id: h.worldId, name: h.worldName, generation: h.targetGeneration, save: serialize(game), maxPlayers,
      settings, ownerPlayerId: body.ownerPlayerId, ownerJoinToken, inviteToken: this.storedInvite, inviteExpiresAt: this.inviteExpiresAt,
      mods: { mods: modClone(state.mods), prio: state.prio.slice(), game: state.game }, updatedAt: now, lastTick: game.tick, reconnect };
    const result: NativeHandoffCommitResponse = { requestId: body.requestId, accepted: true, revision: this.revision + 1, worldId: h.worldId, sessionId: h.sessionId, generation: h.targetGeneration,
      ownerPlayerId: body.ownerPlayerId, reconnectToken: ownerReconnect, peerMigrations };
    world.lastHandoff = { transactionId: h.transactionId, result };
    h.state = 'committing'; h.commitHash = body.lastHash; await this.persistController();
    try {
      await this.persistWorld(world, false);
      h.state = 'committed'; h.result = result;
      this.game = game; this.activeWorld = world; this.controllerState = 'running'; this.paused = world.settings.pauseWhenEmpty; this.emptyPause = world.settings.pauseWhenEmpty; this.health = world.settings.pauseWhenEmpty ? 'Передача завершена; сервер ожидает подключения владельца' : 'Передача завершена; мир работает';
      this.activateScripts(game, packages); this.relay.setWorld(this.relayRegistration(world)); this.lastTime = 0; this.accumulator = 0; this.schedulePump(); void this.probePlayRoutes();
      return result;
    } catch (e) { h.state = 'prepared'; h.result = undefined; this.activeWorld = null; await this.persistController(); throw e; }
  }

  private authenticate(raw: NativePlayClientMessage, socket: NativeSocket, challenge: Extract<NativePlayServerMessage, { type: 'auth-challenge' }>): Promise<PlayPeer> {
    return this.serialized(async () => {
      const w = this.activeWorld, game = this.game;
      if (!w || !game || !isRecord(raw) || raw.type !== 'auth' || !['owner', 'guest'].includes(raw.role)) throw new Error('auth required');
      const authFields = raw.role === 'owner'
        ? new Set(['type', 'challengeId', 'role', 'joinToken', 'modSet', 'name', 'color'])
        : new Set(['type', 'challengeId', 'role', 'inviteToken', 'reconnectToken', 'admissionPublicKey', 'admissionProof', 'passwordProof', 'modSet', 'name', 'color']);
      if (Object.keys(raw).some(key => !authFields.has(key))) throw new Error('auth schema invalid');
      if (w.id !== challenge.worldId || w.generation !== challenge.generation || raw.challengeId !== challenge.challengeId) throw new Error('authentication challenge expired');
      if (!validModSet(raw.modSet) || !sameMods(raw.modSet, modSet())) throw new Error('Версия игровых данных или набор модов не совпадает с сервером');
      const name = boundedText(raw.name, 20) || 'Игрок'; const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#d2782e';
      let playerId = '', playerIndex = -1, owner = false, reconnectToken = '', admin = false, admissionHash = '';
      const reconnectRecord = (v: string) => Object.values(w.reconnect).find(r => r.expiresAt > Date.now() && sameHash(secretHash(v), r.tokenHash) && r.playerId);
      if (raw.role === 'guest') {
        if (raw.inviteToken !== undefined && typeof raw.inviteToken !== 'string' || raw.reconnectToken !== undefined && typeof raw.reconnectToken !== 'string' || raw.inviteToken !== undefined && raw.reconnectToken !== undefined) throw new Error('guest credential shape invalid');
        if (typeof raw.admissionPublicKey !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.admissionPublicKey)) throw new Error('guest admission public key invalid');
        const publicBytes = Buffer.from(raw.admissionPublicKey, 'hex');
        admissionHash = guestAdmissionFingerprint(raw.admissionPublicKey);
        if (typeof raw.admissionProof !== 'string' || !/^[a-f0-9]{128}$/i.test(raw.admissionProof)) throw new Error('guest admission proof invalid');
        const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicBytes.toString('base64url') }, format: 'jwk' });
        if (!verify(null, Buffer.from(guestAdmissionProofPayload(w.id, w.generation, challenge.challengeId, admissionHash, this.hostIdentity!.serverId), 'utf8'), publicKey, Buffer.from(raw.admissionProof, 'hex'))) throw new Error('guest admission proof invalid');
        const verifier = w.settings.password;
        if (verifier) {
          const validProof = typeof raw.passwordProof === 'string' && HASH256.test(raw.passwordProof);
          const suppliedProof = validProof ? Buffer.from(raw.passwordProof!, 'hex') : Buffer.alloc(32);
          const expectedProof = createHmac('sha256', Buffer.from(verifier.verifier, 'hex'))
            .update(passwordProofPayload(w.id, w.generation, challenge.challengeId, admissionHash, 'guest', this.hostIdentity!.serverId)).digest();
          const proofMatches = timingSafeEqual(expectedProof, suppliedProof);
          if (!proofMatches || !validProof) throw new Error('guest password proof invalid');
        } else if (raw.passwordProof !== undefined) throw new Error('unexpected password proof');
        if (w.settings.accessMode === 'whitelist' && !w.settings.whitelistHashes.includes(admissionHash)) throw new Error('guest is not allowlisted');
      }
      if (raw.role === 'owner') {
        if (typeof raw.joinToken !== 'string' || !sameSecret(raw.joinToken, w.ownerJoinToken)) throw new Error('owner credential invalid');
        playerId = w.ownerPlayerId; playerIndex = game.v117.playerIds.indexOf(playerId); owner = true;
      } else {
        const tokenRecord = raw.reconnectToken && TOKEN.test(raw.reconnectToken) ? reconnectRecord(raw.reconnectToken) : undefined;
        const keyRecord = Object.values(w.reconnect).find(r => r.expiresAt > Date.now() && r.admissionHash === admissionHash && r.playerId);
        if (raw.reconnectToken && !tokenRecord && !keyRecord) throw new Error('reconnect credential invalid');
        if (tokenRecord) {
          if (tokenRecord.admissionHash && tokenRecord.admissionHash !== admissionHash) throw new Error('reconnect key mismatch');
          if (keyRecord && keyRecord.playerId !== tokenRecord.playerId) throw new Error('admission key identity collision');
          playerId = tokenRecord.playerId; playerIndex = game.v117.playerIds.indexOf(playerId); owner = !!tokenRecord.owner;
        } else if (keyRecord) {
          playerId = keyRecord.playerId; playerIndex = game.v117.playerIds.indexOf(playerId); owner = !!keyRecord.owner;
        } else {
          if (!raw.inviteToken || !sameSecret(raw.inviteToken, w.inviteToken) || w.inviteExpiresAt <= Date.now()) throw new Error('invite invalid or expired');
          if (this.peers.size >= w.maxPlayers || game.v117.playerIds.length >= 16) throw new Error('server full');
          playerIndex = game.addPeer(name, color, randomBytes(8).toString('hex'));
          if (playerIndex < 1) throw new Error('no player slot');
          playerId = game.v117.playerIds[playerIndex];
        }
      }
      if (!PLAYER_ID.test(playerId) || playerIndex < 0 || playerIndex > 15 || playerIndex > 0 && !game.peers[playerIndex]) throw new Error('saved player identity unavailable');
      if (raw.role === 'guest' && w.settings.accessMode === 'whitelist' && !w.settings.whitelistHashes.includes(admissionHash)) throw new Error('guest is not allowlisted');
      const previous = [...this.peers.values()].find(p => p.playerId === playerId);
      if (!previous && this.peers.size >= w.maxPlayers) throw new Error('server full');
      if (previous) previous.socket.close(4001, 'identity reconnected');
      if (playerIndex > 0) { game.peers[playerIndex].off = 0; delete game.peers[playerIndex].offAt; game.peers[playerIndex].name = name; game.peers[playerIndex].color = color; }
      const oldRecord = w.reconnect[playerId];
      if (raw.role === 'guest' && raw.reconnectToken && !oldRecord) throw new Error('reconnect token already used');
      reconnectToken = token();
      if (!reconnectToken) throw new Error('stable guest identity required');
      admin = owner || w.settings.adminPlayerIds.includes(playerId);
      game.peers[playerIndex].role = owner ? 'host' : admin ? 'admin' : 'player';
      const peerKey = game.peers[playerIndex]?.key || (owner ? randomBytes(8).toString('hex') : '');
      if (!PEER_KEY.test(peerKey)) throw new Error('saved peer key invalid');
      w.reconnect[playerId] = { tokenHash: secretHash(reconnectToken), playerId, peerKey, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, owner,
        ...(raw.role === 'guest' ? { admissionHash } : oldRecord?.admissionHash ? { admissionHash: oldRecord.admissionHash } : {}) };
      const at = Date.now(), p: PlayPeer = { socket, playerId, playerIndex, owner, admin, name, color, reconnectToken, lastSeq: 0,
        snapper: makeSnapper(), vp: { x0: -40, y0: -40, x1: 40, y1: 40 }, focus: [], allChunks: false, lastView: at, lastSnapshot: 0,
        bucket: { start: at, count: 0, bytes: 0 }, ownerActions: new Map(), pendingSfx: [], pendingAch: [] };
      this.peers.set(socket, p);
      if (this.emptyPause) { this.paused = false; this.emptyPause = false; this.health = 'Мир работает'; }
      try { await this.persistWorld(w, false); }
      catch (error) { this.detachPeer(p); throw error; }
      return p;
    });
  }

  private detachPeer(peer: PlayPeer) {
    if (this.peers.get(peer.socket) !== peer) return;
    this.discardSnapshotTransfer(peer);
    for (const entry of this.saveExports.values()) if (entry.peer === peer) this.discardSaveExport(entry.id);
    this.peers.delete(peer.socket);
    if (this.game && peer.playerIndex > 0 && this.game.peers[peer.playerIndex]) { this.game.peers[peer.playerIndex].off = 1; this.game.peers[peer.playerIndex].offAt = this.game.tick; }
    if (this.peers.size === 0 && this.game) {
      if (this.activeWorld?.settings.pauseWhenEmpty) { this.paused = true; this.emptyPause = true; this.health = 'Мир приостановлен: все игроки отключились'; }
      void this.serialized(() => this.saveActive(true).catch(e => { this.health = 'Не удалось сохранить после отключения: ' + safeError(e); }));
    }
  }

  private consumeRate(peer: PlayPeer, bytes: number) {
    const now = Date.now(), b = peer.bucket;
    if (now - b.start >= 1000) { b.start = now; b.count = 0; b.bytes = 0; }
    b.count++; b.bytes += bytes;
    return b.count <= 240 && b.bytes <= 2 * 1024 * 1024;
  }

  private send(peer: PlayPeer, message: NativePlayServerMessage) {
    let encoded: string; try { encoded = encodeNativeJson(message); } catch (e) { this.health = 'Снимок превышает сетевой предел: ' + safeError(e); return false; }
    return this.sendEncoded(peer, encoded);
  }

  private sendEncoded(peer: PlayPeer, encoded: string) {
    if (!peer.socket.isOpen || peer.socket.bufferedBytes > 1024 * 1024 || Buffer.byteLength(encoded, 'utf8') > Math.min(NATIVE_MAX_FRAME_BYTES, peer.socket.maxMessageBytes)) return false;
    return peer.socket.send(encoded);
  }

  private setView(peer: PlayPeer, vp: unknown, focus: unknown, allChunks: unknown) {
    if (!isRecord(vp) || !['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(vp[k])) || vp.x1 <= vp.x0 || vp.y1 <= vp.y0 || Math.max(Math.abs(vp.x0), Math.abs(vp.x1), Math.abs(vp.y0), Math.abs(vp.y1)) > 1_000_000) throw new Error('invalid viewport');
    if (focus !== undefined && (!Array.isArray(focus) || focus.length > 256 || focus.some(x => !Number.isSafeInteger(x) || x < 0))) throw new Error('invalid focus list');
    if (allChunks !== undefined && typeof allChunks !== 'boolean') throw new Error('invalid allChunks flag');
    // Coarse zoom can legitimately request thousands of cells. Clamp its footprint instead
    // of disconnecting normal users, while never asking the simulation to generate chunks.
    const bounded = (lo: number, hi: number) => {
      const size = Math.min(2048, hi - lo), mid = (lo + hi) / 2;
      return [mid - size / 2, mid + size / 2] as const;
    };
    const [x0, x1] = bounded(vp.x0, vp.x1), [y0, y1] = bounded(vp.y0, vp.y1);
    peer.vp = { x0, y0, x1, y1 }; peer.focus = Array.isArray(focus) ? focus.slice(0, 256) : []; peer.allChunks = allChunks === true; peer.lastView = Date.now();
  }

  private sendSnapshot(peer: PlayPeer, force = false) {
    const game = this.game; if (!game || !peer.socket.isOpen) return;
    if (peer.socket.canSendSnapshot === false) return;
    if (peer.snapshotTransfer) {
      if (Date.now() - peer.snapshotTransfer.startedAt > 180_000 || Date.now() - peer.snapshotTransfer.lastProgressAt > 30_000) { peer.snapper.failed(peer.snapshotTransfer.snapshot); this.discardSnapshotTransfer(peer); peer.socket.close(1008, 'snapshot timeout'); return; }
      if (!peer.snapshotTransfer.awaitingAck) this.sendSnapshotChunk(peer);
      return;
    }
    if (this.activeSnapshotBytes >= MAX_ACTIVE_SNAPSHOT_BYTES) return;
    if (!force && Date.now() - peer.lastSnapshot < 100) return;
    const prior = game.pl;
    let snapshot: import('../sim/protocol').Snapshot | undefined;
    const sfxCount = peer.pendingSfx.length, achCount = peer.pendingAch.length;
    try {
      if (game.peers.length && peer.playerIndex < game.peers.length) game.usePl(peer.playerIndex);
      snapshot = peer.snapper.take(game, { tickMs: this.lastTickMs, ups: this.ups, ns: null, mpMe: peer.playerIndex, mpWaitMs: 0, postMs: 0, sfx: peer.pendingSfx.slice(), achNew: peer.pendingAch.slice() }, peer.vp, peer.focus, peer.allChunks);
      snapshot.mp = { me: peer.playerIndex, n: game.v117.playerIds.length, delay: 0, buf: 0, wait: 0, stalls: 0, hashMs: 0, paused: this.paused, dedicatedServer: true };
      if (!peer.lastSnapshot) snapshot.worldInit = { seed: game.seed, lake: { ...game.world.lake }, oil: { ...game.world.oil },
        uranium: { ...game.world.uranium }, noUranium: game.world.noUranium, scenario: game.scn };
      const message = { type: 'snapshot' as const, snapshot };
      let small: string | null = null;
      const inlineLimit = Math.min(NATIVE_MAX_FRAME_BYTES, peer.socket.maxMessageBytes);
      try { small = encodeNativeJson(message, inlineLimit); } catch { /* large snapshots use the paced chunk protocol */ }
      if (small !== null) {
        if (this.sendEncoded(peer, small)) { peer.snapper.delivered(snapshot); peer.lastSnapshot = Date.now(); peer.pendingSfx.splice(0, sfxCount); peer.pendingAch.splice(0, achCount); }
        else peer.snapper.failed(snapshot);
        return;
      }
      const large = encodeNativeJson(message, NATIVE_MAX_SNAPSHOT_BYTES);
      const bytes = new TextEncoder().encode(large);
      const parts = Math.ceil(bytes.byteLength / NATIVE_SNAPSHOT_CHUNK_BYTES);
      if (bytes.byteLength > NATIVE_MAX_SNAPSHOT_BYTES || parts < 2) throw new Error('Snapshot exceeds the configured aggregate limit');
      if (this.activeSnapshotBytes + bytes.byteLength > MAX_ACTIVE_SNAPSHOT_BYTES) { peer.snapper.failed(snapshot); return; }
      const startedAt = Date.now();
      const transfer: SnapshotTransfer = { id: token(), bytes, parts, next: 0, tick: game.tick, hash: nativeWireHash(bytes), snapshot, startedAt, lastProgressAt: startedAt, awaitingAck: false, sfxCount, achCount };
      peer.snapshotTransfer = transfer;
      this.activeSnapshotBytes += bytes.byteLength;
      if (!this.send(peer, { type: 'snapshot-begin', id: transfer.id, bytes: bytes.byteLength, parts, tick: transfer.tick, hash: transfer.hash, modSet: modSet() })) {
        this.discardSnapshotTransfer(peer); peer.snapper.failed(snapshot); return;
      }
      this.sendSnapshotChunk(peer);
    } catch (e) {
      if (snapshot) peer.snapper.failed(snapshot);
      this.discardSnapshotTransfer(peer);
      this.health = 'Снимок превышает сетевой предел: ' + safeError(e);
    } finally { if (game.peers.length && game.pl !== prior) game.usePl(prior); }
  }

  private sendSnapshotChunk(peer: PlayPeer) {
    const transfer = peer.snapshotTransfer;
    if (!transfer || transfer.awaitingAck || !peer.socket.isOpen) return;
    if (transfer.next >= transfer.parts) return;
    const start = transfer.next * NATIVE_SNAPSHOT_CHUNK_BYTES;
    const data = Buffer.from(transfer.bytes.subarray(start, Math.min(transfer.bytes.byteLength, start + NATIVE_SNAPSHOT_CHUNK_BYTES))).toString('base64');
    if (this.send(peer, { type: 'snapshot-chunk', id: transfer.id, index: transfer.next, data })) transfer.awaitingAck = true;
  }

  private acknowledgeSnapshotChunk(peer: PlayPeer, id: string, index: number) {
    const transfer = peer.snapshotTransfer;
    if (!transfer || transfer.id !== id || !transfer.awaitingAck || index !== transfer.next) throw new Error('invalid snapshot acknowledgement');
    transfer.awaitingAck = false; transfer.next++; transfer.lastProgressAt = Date.now();
    if (transfer.next >= transfer.parts) {
      peer.snapper.delivered(transfer.snapshot); peer.lastSnapshot = Date.now(); peer.pendingSfx.splice(0, transfer.sfxCount); peer.pendingAch.splice(0, transfer.achCount); this.discardSnapshotTransfer(peer);
    } else this.sendSnapshotChunk(peer);
  }

  private discardSnapshotTransfer(peer: PlayPeer) {
    if (!peer.snapshotTransfer) return;
    this.activeSnapshotBytes = Math.max(0, this.activeSnapshotBytes - peer.snapshotTransfer.bytes.byteLength);
    peer.snapshotTransfer = undefined;
  }

  private broadcastSnapshots() {
    this.lastSnapshotMs = performance.now();
    const game = this.game; if (!game || !this.peers.size) return;
    // These event queues are world-wide. Take them once and retain a copy per peer until that
    // peer's full (possibly chunked) snapshot is confirmed delivered.
    const sfx = game.sfx.splice(0), ach = game.achNew.splice(0);
    for (const peer of this.peers.values()) {
      if (sfx.length) peer.pendingSfx.push(...sfx);
      if (ach.length) peer.pendingAch.push(...ach);
      if (peer.pendingSfx.length > 1024) peer.pendingSfx.splice(0, peer.pendingSfx.length - 1024);
      if (peer.pendingAch.length > 512) peer.pendingAch.splice(0, peer.pendingAch.length - 512);
      this.sendSnapshot(peer);
    }
  }

  private async handlePlayMessage(peer: PlayPeer, raw: NativePlayClientMessage) {
    const game = this.game; if (!game || !isRecord(raw)) return;
    switch (raw.type) {
      case 'snapshot-ack':
        try {
          if (typeof raw.id !== 'string' || !Number.isSafeInteger(raw.index) || raw.index < 0) throw new Error('invalid snapshot acknowledgement');
          this.acknowledgeSnapshotChunk(peer, raw.id, raw.index);
        } catch { peer.socket.close(1008, 'invalid snapshot acknowledgement'); }
        return;
      case 'ping': if (Number.isSafeInteger(raw.nonce)) this.send(peer, { type: 'pong', nonce: raw.nonce, tick: game.tick }); return;
      case 'view': this.setView(peer, raw.vp, raw.focus, raw.allChunks); return;
      case 'cmd': {
        if (!Number.isSafeInteger(raw.seq) || raw.seq <= peer.lastSeq || raw.seq > peer.lastSeq + 1000 || !isRecord(raw.command)) throw new Error('invalid command sequence');
        const c = this.cleanCommand(raw.command, peer.owner || peer.admin); peer.lastSeq = raw.seq;
        game.enqueue({ ...c, pl: peer.playerIndex } as Command); return;
      }
      case 'owner-action': {
        if (!peer.owner || typeof raw.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.requestId) || !['pause', 'speed'].includes(raw.op)) throw new Error('owner action denied');
        if (this.snapshotting) throw new Error('Save export is capturing the current world; retry the owner action shortly');
        const prior = peer.ownerActions.get(raw.requestId); if (prior) { if (!this.send(peer, JSON.parse(prior))) peer.socket.close(1013, 'owner response backpressure'); return; }
        if (raw.op === 'pause') { if (typeof raw.value !== 'boolean') throw new Error('invalid pause'); this.paused = raw.value; this.emptyPause = false; }
        else { if (typeof raw.value !== 'number' || !Number.isFinite(raw.value) || raw.value < .25 || raw.value > 8) throw new Error('invalid speed'); this.speed = raw.value; }
        this.revision++; await this.persistController();
        const response = { type: 'owner-action' as const, requestId: raw.requestId, accepted: true, revision: this.revision, paused: this.paused, speed: this.speed };
        peer.ownerActions.set(raw.requestId, JSON.stringify(response)); if (peer.ownerActions.size > 128) peer.ownerActions.delete(peer.ownerActions.keys().next().value!); if (!this.send(peer, response)) peer.socket.close(1013, 'owner response backpressure'); return;
      }
      case 'rpc': {
        if (!Number.isSafeInteger(raw.id) || raw.id < 0) throw new Error('invalid RPC id');
        try {
          let result: unknown;
          if (raw.method === 'frame') { this.setView(peer, raw.vp, raw.focus, raw.allChunks); this.sendSnapshot(peer, true); return; }
          if (raw.method === 'xq') {
            if (typeof raw.q !== 'string' || raw.q.length > 40) throw new Error('invalid query');
            const query = sanitizeData(raw.a, 0, { n: 0 }) as any;
            if (raw.q === 'diag') { const eid = Math.floor(Number(query)); const target = game.ents.get(eid); result = await diagnoseAsync(game, eid, () => this.game === game && !!target && game.ents.get(eid) === target); }
            else result = this.withPeer(game, peer, () => xQuery(game, raw.q as string, query));
          } else if (raw.method === 'pstats') {
            if (!Number.isSafeInteger(raw.tier) || raw.tier < 0 || raw.tier > 6 || !['items', 'fluids', 'energy', 'bottlenecks'].includes(raw.tab) || raw.sel !== null && typeof raw.sel !== 'string') throw new Error('invalid statistics request');
            result = this.withPeer(game, peer, () => statsView(game, raw.tier as number, raw.tab as Tab, 40, raw.sel as string | null));
          } else if (raw.method === 'save') {
            if (!peer.owner) throw new Error('Only the connected owner can export a save');
            result = await this.serialized(() => this.captureSaveExport(game));
          }
          else if (raw.method === 'tele') result = this.withPeer(game, peer, () => teleReport(game));
          else throw new Error('unsupported RPC');
          const reply = { type: 'rpc' as const, id: raw.id, result };
          let encoded: string | null = null;
          try { encoded = encodeNativeJson(reply, Math.min(NATIVE_MAX_FRAME_BYTES, peer.socket.maxMessageBytes)); } catch { /* large save responses use the authenticated HTTP export ticket */ }
          if (encoded !== null) {
            if (!this.sendEncoded(peer, encoded)) peer.socket.close(1013, 'RPC response backpressure');
          } else if (raw.method === 'save' && peer.owner) {
            const ticket = this.createSaveExport(peer, result as { str: string; tick: number; info: unknown });
            if (!this.send(peer, { type: 'rpc', id: raw.id, result: ticket })) {
              const exportId = ticket.download.path.slice('/api/v1/export/'.length); this.discardSaveExport(exportId);
              peer.socket.close(1013, 'Save export ticket backpressure');
            }
          } else if (!this.send(peer, { type: 'rpc', id: raw.id, error: 'RPC result exceeds the transport limit' })) peer.socket.close(1013, 'RPC response unavailable');
        } catch (e) { if (!this.send(peer, { type: 'rpc', id: raw.id, error: safeError(e) })) peer.socket.close(1013, 'RPC response unavailable'); }
        return;
      }
      default: throw new Error('unsupported play message');
    }
  }

  private cleanCommand(raw: Record<string, unknown>, owner: boolean): Record<string, any> {
    if (Object.keys(raw).length > 40 || typeof raw.t !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(raw.t) || 'pl' in raw) throw new Error('invalid game command');
    const type = raw.t;
    if (['join', 'peer', 'snap', 'modoff', 'teleMods'].includes(type)) throw new Error('server-owned command');
    if (['perm', 'setEnemies', 'noBoom'].includes(type) && !owner) throw new Error('owner command denied');
    const allowed = new Set(['v117','poleChain','input','build','wallBatch','setDirAt','rotate','setRecipe','craft','cancelCraft','research','take','put','pickup','bioSample','bioRobotConfig','paste','decon','upgrade','undo','redo','clearGhosts','msg','tele','teleErr','equip','kit','artillery','robotPrio','cancelGhosts','hand','quick','lreq','lrbuf','lfilter','preq','preqOff','floor','unfloor','sortInv','slotLimit','chestSettings','trashClear','cwire','cset','bplib','chat','mark','note','setEnemies','perm','placeCar','vehicle','vehicleTurret','vehicleAmmo','vehicleEquipment','sched','tmode','stopName','stopSide','stopLimit','tpmode','wfilter','wfilterAll','reactor','noBoom','x','railPath','stopLimit']);
    if (!allowed.has(type)) throw new Error('unknown game command');
    const copied = sanitizeData(raw, 0, { n: 0 }) as Record<string, any>;
    if (!validNativeCommand(copied)) throw new Error('invalid game command payload');
    return copied;
  }

  private withPeer<T>(game: Game, peer: PlayPeer, fn: () => T): T {
    const prior = game.pl;
    if (game.peers.length && peer.playerIndex < game.peers.length) game.usePl(peer.playerIndex);
    try { return fn(); } finally { if (game.peers.length && game.pl !== prior) game.usePl(prior); }
  }

  private async captureSaveExport(game: Game) {
    if (this.game !== game || !this.activeWorld) throw new Error('The active world changed before the save capture');
    if (this.snapshotting) throw new Error('A save capture is already in progress');
    this.snapshotting = true;
    const wasPaused = this.paused;
    this.paused = true;
    if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
    try {
      await this.pumpTask;
      if (this.game !== game) throw new Error('The active world changed during the save capture');
      const tick = game.tick;
      const captured = decodeNativeJson<any>(encodeNativeJson(serialize(game), NATIVE_MAX_HANDOFF_BYTES), NATIVE_MAX_HANDOFF_BYTES, 12_000_000);
      const info = slotInfo(game);
      const str = await packStr(captured);
      return { str, tick, info };
    } finally {
      this.snapshotting = false;
      if (this.game === game && !this.stopRequested) {
        if (this.tickTimer) clearTimeout(this.tickTimer); this.tickTimer = null;
        if (!wasPaused) this.paused = false;
        this.schedulePump();
      }
    }
  }
}

const cmdKeys = (v: Record<string, any>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const numIn = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const intIn = (v: unknown, lo: number, hi: number) => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;
const coordIn = (v: unknown) => numIn(v, -65_536, 65_535);
const idIn = (v: unknown) => intIn(v, 1, Number.MAX_SAFE_INTEGER);
const textIn = (v: unknown, max: number, min = 0) => typeof v === 'string' && v.length >= min && v.length <= max;
const rectIn = (x0: unknown, y0: unknown, x1: unknown, y1: unknown) => coordIn(x0) && coordIn(y0) && coordIn(x1) && coordIn(y1) &&
  (Math.abs((x1 as number) - (x0 as number)) + 1) * (Math.abs((y1 as number) - (y0 as number)) + 1) <= 65_536;
const itemIn = (v: unknown) => typeof v === 'string' && Object.hasOwn(ITEMS, v);
const protoIn = (v: unknown) => typeof v === 'string' && Object.hasOwn(PROTOS, v);
const ownFields = (v: unknown, allowed: string[]) => isRecord(v) && cmdKeys(v, allowed);
function conditionIn(v: any) {
  return ownFields(v, ['c', 'n', 'it', 'op', 'cs', 'j']) && CONDS.includes(v.c) && intIn(v.n, 0, 1_000_000_000) &&
    (v.it === undefined || v.it === null || itemIn(v.it)) && (v.op === undefined || ['<', '>', '=', '≠'].includes(v.op)) &&
    (v.cs === undefined || v.cs === null || ownFields(v.cs, ['a', 'op', 'n', 'b']) &&
      (v.cs.a === null || textIn(v.cs.a, 64)) && ['<', '>', '=', '≠'].includes(v.cs.op) && numIn(v.cs.n, -1e9, 1e9) &&
      (v.cs.b === undefined || v.cs.b === null || textIn(v.cs.b, 64))) && (v.j === undefined || v.j === 0 || v.j === 1);
}
function blueprintIn(bp: any) {
  if (!ownFields(bp, ['v', 'name', 'icons', 'w', 'h', 'entities', 'tiles', 'wires']) || bp.v !== 1 || !textIn(bp.name, 120) ||
      !Array.isArray(bp.icons) || bp.icons.length > 4 || !bp.icons.every(itemIn) || !intIn(bp.w, 1, 256) || !intIn(bp.h, 1, 256) || bp.w * bp.h > 65_536 ||
      !Array.isArray(bp.entities) || bp.entities.length > 5000) return false;
  for (const e of bp.entities) if (!ownFields(e, ['p', 'x', 'y', 'd', 'recipe', 'cc', 'stopLeft', 'chest']) || !protoIn(e.p) || !intIn(e.x, -65_536, 65_535) || !intIn(e.y, -65_536, 65_535) || !intIn(e.d, 0, 7) ||
      (e.chest !== undefined && (PROTOS[e.p].type !== 'chest' || !validChestSettings(e.chest, PROTOS[e.p].slots))) ||
      (e.recipe !== undefined && e.recipe !== null && !Object.hasOwn(RECIPES, e.recipe)) || (e.cc !== undefined && e.cc !== null && !isRecord(e.cc)) ||
      (e.stopLeft !== undefined && typeof e.stopLeft !== 'boolean')) return false;
  if (bp.tiles !== undefined && (!Array.isArray(bp.tiles) || bp.tiles.length > 65_536 || bp.tiles.some((t: any) => !Array.isArray(t) || t.length !== 3 || !intIn(t[0], -65_536, 65_535) || !intIn(t[1], -65_536, 65_535) || !itemIn(t[2])))) return false;
  if (bp.wires !== undefined && (!Array.isArray(bp.wires) || bp.wires.length > 25_000 || bp.wires.some((w: any) => !Array.isArray(w) || ![3, 5].includes(w.length) || !intIn(w[0], 0, bp.entities.length - 1) || !intIn(w[1], 0, bp.entities.length - 1) || (w[2] !== 0 && w[2] !== 1) ||
      w.length === 5 && (w[3] !== 0 && w[3] !== 1 || w[4] !== 0 && w[4] !== 1)))) return false;
  return true;
}
function ruleIn(r: any) {
  if (!ownFields(r, ['kind', 'target', 'thr', 'hy', 'dur', 'rem', 'on']) || !['fuel', 'acid', 'field', 'power', 'waste', 'train', 'bio-capsules', 'bio-full', 'bio-expiry'].includes(r.kind) ||
      !numIn(r.thr, 0, 100_000) || !numIn(r.hy, 0, 100_000) || !intIn(r.dur, 0, 3600) || !intIn(r.rem, 0, 86400) || (r.on !== undefined && typeof r.on !== 'boolean') || !isRecord(r.target)) return false;
  const t = r.target;
  if (t.t === 'all') return ownFields(t, ['t']);
  if (t.t === 'bioArea') return r.kind === 'bio-expiry' && ownFields(t, ['t', 'x', 'y', 'radius']) && intIn(t.x, -65_535, 65_535) && intIn(t.y, -65_535, 65_535) && intIn(t.radius, 1, 64);
  if (t.t === 'field') return r.kind === 'field' && ownFields(t, ['t', 'key']) && textIn(t.key, 48) && /^\d+@\d+$/.test(t.key);
  if (['group', 'ent', 'powerNet', 'train'].includes(t.t)) return ownFields(t, ['t', 'id']) && intIn(t.id, 0, 1_000_000_000);
  return false;
}
function xCommandIn(c: Record<string, any>) {
  const op = c.op;
  if (['rqclear', 'nghide', 'ngshow'].includes(op)) return cmdKeys(c, ['t', 'op']);
  if (op === 'rqadd') return cmdKeys(c, ['t', 'op', 'tech', 'deps']) && textIn(c.tech, 96) && (c.deps === undefined || typeof c.deps === 'boolean') && Object.hasOwn(TECHS, c.tech);
  if (op === 'rqdel') return cmdKeys(c, ['t', 'op', 'tech']) && textIn(c.tech, 96);
  if (op === 'rqmove') return cmdKeys(c, ['t', 'op', 'tech', 'd']) && textIn(c.tech, 96) && intIn(c.d, -1, 1);
  if (op === 'con') return cmdKeys(c, ['t', 'op', 'line']) && textIn(c.line, 256, 1);
  if (op === 'give') return cmdKeys(c, ['t', 'op', 'item', 'n']) && itemIn(c.item) && intIn(c.n, 0, 100_000);
  if (op === 'rflt') return cmdKeys(c, ['t', 'op', 'k', 'on']) && ['uranium', 'oil', 'nest'].includes(c.k) && typeof c.on === 'boolean';
  if (op === 'rfdel') return cmdKeys(c, ['t', 'op', 'k']) && ['uranium', 'oil', 'nest'].includes(c.k);
  if (op === 'gnew') return cmdKeys(c, ['t', 'op', 'name', 'color', 'ids']) && textIn(c.name, 120, 1) && (c.color === undefined || textIn(c.color, 16)) && (c.ids === undefined || Array.isArray(c.ids) && c.ids.length <= 10_000 && c.ids.every(idIn));
  if (op === 'gren') return cmdKeys(c, ['t', 'op', 'gid', 'name', 'color']) && intIn(c.gid, 1, 1_000_000_000) && textIn(c.name, 120) && (c.color === undefined || textIn(c.color, 16));
  if (op === 'gadd') return cmdKeys(c, ['t', 'op', 'gid', 'ids', 'move']) && intIn(c.gid, 1, 1_000_000_000) && Array.isArray(c.ids) && c.ids.length <= 10_000 && c.ids.every(idIn) && (c.move === undefined || typeof c.move === 'boolean');
  if (op === 'grem' || op === 'pprof') return cmdKeys(c, ['t', 'op', 'ids']) && Array.isArray(c.ids) && c.ids.length <= 10_000 && c.ids.every(idIn);
  if (op === 'gdel') return cmdKeys(c, ['t', 'op', 'gid']) && intIn(c.gid, 1, 1_000_000_000);
  if (op === 'gpri') return cmdKeys(c, ['t', 'op', 'gid', 'pr']) && intIn(c.gid, 1, 1_000_000_000) && intIn(c.pr, 0, 2);
  if (op === 'epri') return cmdKeys(c, ['t', 'op', 'ids', 'pr']) && Array.isArray(c.ids) && c.ids.length <= 10_000 && c.ids.every(idIn) && intIn(c.pr, 0, 2);
  if (op === 'rule') return cmdKeys(c, ['t', 'op', 'rule']) && ruleIn(c.rule);
  if (op === 'ack') return cmdKeys(c, ['t', 'op', 'ev']) && idIn(c.ev);
  if (op === 'ruledel' || op === 'ruleon') return cmdKeys(c, op === 'ruleon' ? ['t', 'op', 'id', 'on'] : ['t', 'op', 'id']) && idIn(c.id) && (op !== 'ruleon' || typeof c.on === 'boolean');
  if (op === 'planundo') return cmdKeys(c, ['t', 'op', 'id']) && (c.id === undefined || idIn(c.id));
  if (op === 'plan') return cmdKeys(c, ['t', 'op', 'item', 'perMin', 'pct', 'x', 'y', 'options']) && itemIn(c.item) && numIn(c.perMin, 0, 1_000_000) && (c.pct === undefined || numIn(c.pct, 0, 100)) && coordIn(c.x) && coordIn(c.y) && (c.options === undefined || isRecord(c.options) && Object.keys(c.options).length <= 32);
  return false;
}
function validNativeCommand(c: Record<string, any>) {
  const coord = (...keys: string[]) => keys.every(k => coordIn(c[k]));
  const id = (k = 'id') => idIn(c[k]);
  const simple = (fields: string[], checks: () => boolean) => cmdKeys(c, ['t', ...fields]) && checks();
  switch (c.t) {
    case 'v117': return cmdKeys(c, ['t', 'section', 'op', 'opId', 'id', 'entityId', 'family', 'count', 'jobId', 'formId', 'droneId', 'player', 'x', 'y', 'points', 'combat', 'weapon', 'charges', 'mode', 'sound', 'group', 'squad', 'label', 'range', 'radius', 'volume', 'playback', 'intervalTicks', 'pauseTicks', 'visual', 'repeat', 'continuous', 'enabled', 'target', 'module', 'item', 'limit', 'preset', 'tech', 'step']);
    case 'poleChain': return cmdKeys(c, ['t', 'gesture', 'seq', 'op', 'proto', 'dir', 'ghost', 'x', 'y', 'anchor', 'origin']);
    case 'input': return simple(['mx', 'my', 'mine', 'shoot', 'repair'], () => numIn(c.mx, -1.1, 1.1) && numIn(c.my, -1.1, 1.1) && ['mine', 'shoot'].every(k => c[k] == null || ownFields(c[k], ['x', 'y']) && coordIn(c[k].x) && coordIn(c[k].y)) && (c.repair === undefined || c.repair === null || idIn(c.repair)));
    case 'build': return simple(['proto', 'x', 'y', 'dir', 'stopLeft', 'quiet'], () => protoIn(c.proto) && coord('x', 'y') && intIn(c.dir, 0, 3) && (c.stopLeft === undefined || typeof c.stopLeft === 'boolean') && (c.quiet === undefined || typeof c.quiet === 'boolean'));
    case 'wallBatch': return simple(['proto', 'positions', 'ghost'], () => protoIn(c.proto) && Array.isArray(c.positions) && c.positions.length <= 4096 && c.positions.every((p: any) => Array.isArray(p) && p.length === 2 && intIn(p[0], -65_536, 65_535) && intIn(p[1], -65_536, 65_535)) && (c.ghost === undefined || typeof c.ghost === 'boolean'));
    case 'setDirAt': return simple(['x', 'y', 'dir'], () => coord('x', 'y') && intIn(c.dir, 0, 3));
    case 'rotate': return simple(['id', 'rev'], () => id() && (c.rev === undefined || typeof c.rev === 'boolean'));
    case 'setRecipe': return simple(['id', 'recipe'], () => id() && (c.recipe === null || typeof c.recipe === 'string' && Object.hasOwn(RECIPES, c.recipe)));
    case 'craft': return simple(['recipe', 'count', 'max'], () => typeof c.recipe === 'string' && Object.hasOwn(RECIPES, c.recipe) && intIn(c.count, 1, 1_000_000) && (c.max === undefined || typeof c.max === 'boolean'));
    case 'cancelCraft': return simple(['index'], () => intIn(c.index, 0, 59));
    case 'research': return simple(['tech'], () => c.tech === null || typeof c.tech === 'string' && Object.hasOwn(TECHS, c.tech));
    case 'take': return simple(['id', 'slot'], () => id() && textIn(c.slot, 100, 1) && /^(?:chestall|module:\d+|satellite(?::\d+)?|ammo(?::[A-Za-z0-9_-]+)?|fuel(?::\d+)?|input:[A-Za-z0-9_-]+|output:[A-Za-z0-9_-]+|chest:\d+)$/.test(c.slot));
    case 'put': return simple(['id', 'item', 'count'], () => id() && itemIn(c.item) && intIn(c.count, 1, 65_535));
    case 'pickup': case 'undo': case 'redo': case 'clearGhosts': case 'trashClear': case 'vehicle': return cmdKeys(c, ['t']);
    case 'bioSample': return simple(['target', 'cancel', 'mode'], () => (c.target === null || ownFields(c.target, ['id']) && idIn(c.target.id) || ownFields(c.target, ['x', 'y']) && coordIn(c.target.x) && coordIn(c.target.y)) && (c.cancel === undefined || typeof c.cancel === 'boolean') && (c.mode === undefined || ['sample', 'genetic', 'cells'].includes(c.mode)));
    case 'bioRobotConfig': return simple(['id', 'mode', 'family', 'species', 'sampleMode'], () => id() && (c.mode === undefined || ['corpses', 'all', 'film'].includes(c.mode)) && (c.family === undefined || c.family === null || textIn(c.family, 64)) && (c.species === undefined || c.species === null || textIn(c.species, 80)) && (c.sampleMode === undefined || ['sample', 'genetic', 'cells'].includes(c.sampleMode)));
    case 'paste': return simple(['bp', 'x', 'y'], () => blueprintIn(c.bp) && coord('x', 'y'));
    case 'decon': return simple(['x0', 'y0', 'x1', 'y1', 'filter', 'trees', 'cancel'], () => rectIn(c.x0, c.y0, c.x1, c.y1) && (c.filter === undefined || ['all', 'belts', 'nobelts'].includes(c.filter)) && ['trees', 'cancel'].every(k => c[k] === undefined || typeof c[k] === 'boolean'));
    case 'upgrade': return simple(['x0', 'y0', 'x1', 'y1', 'map', 'cancel'], () => rectIn(c.x0, c.y0, c.x1, c.y1) && isRecord(c.map) && Object.keys(c.map).length <= 256 && Object.entries(c.map).every(([a, b]) => protoIn(a) && protoIn(b)) && (c.cancel === undefined || typeof c.cancel === 'boolean'));
    case 'msg': case 'chat': return simple(['text'], () => textIn(c.text, c.t === 'chat' ? 200 : 500));
    case 'tele': return simple(['on'], () => typeof c.on === 'boolean');
    case 'teleErr': return simple(['sig'], () => textIn(c.sig, 96, 1));
    case 'equip': return simple(['item'], () => c.item === null || itemIn(c.item));
    case 'kit': return simple(['op', 'i', 'item', 'x', 'y', 'slot'], () => {
      if (!['nrfeed', 'nrtake', 'armor', 'mod', 'unmod', 'gun', 'ammo', 'sel', 'next', 'holster', 'autoMods'].includes(c.op)) return false;
      if (['nrfeed', 'nrtake', 'unmod'].includes(c.op)) return idIn(c.i) || intIn(c.i, 0, 15);
      if (['armor', 'gun', 'ammo'].includes(c.op)) return (c.item === null || itemIn(c.item)) && (c.op === 'armor' || intIn(c.slot, 0, 2));
      if (c.op === 'mod') return itemIn(c.item) && (c.x === undefined && c.y === undefined || intIn(c.x, 0, 20) && intIn(c.y, 0, 20));
      return c.op === 'sel' ? intIn(c.slot, 0, 2) : c.i === undefined && c.item === undefined;
    });
    case 'artillery': return simple(['x', 'y'], () => coord('x', 'y'));
    case 'robotPrio': return simple(['x', 'y'], () => coord('x', 'y'));
    case 'cancelGhosts': return simple(['x0', 'y0', 'x1', 'y1'], () => rectIn(c.x0, c.y0, c.x1, c.y1));
    case 'hand': return simple(['op', 'from', 'to', 'i', 'id', 'slot', 'n'], () => ['pick', 'drop', 'return'].includes(c.op) && ['from', 'to'].every(k => c[k] === undefined || ['inv', 'trash', 'ent', 'ground'].includes(c[k])) && (c.i === undefined || intIn(c.i, 0, 255)) && (c.id === undefined || idIn(c.id)) && (c.slot === undefined || textIn(c.slot, 80)) && (c.n === undefined || ['all', 'half', 'one'].includes(c.n)));
    case 'quick': return simple(['id', 'op', 'item', 'quiet'], () => id() && ['load', 'unload'].includes(c.op) && (c.item === undefined || c.item === null || itemIn(c.item)) && (c.quiet === undefined || typeof c.quiet === 'boolean'));
    case 'lreq': return simple(['id', 'i', 'item', 'n'], () => id() && intIn(c.i, 0, 39) && (c.item === null || itemIn(c.item)) && intIn(c.n, 0, 65_535));
    case 'lrbuf': return simple(['id', 'on'], () => id() && typeof c.on === 'boolean');
    case 'lfilter': return simple(['id', 'item'], () => id() && (c.item === null || itemIn(c.item)));
    case 'preq': return simple(['i', 'item', 'min', 'max'], () => intIn(c.i, 0, 39) && (c.item === null || itemIn(c.item)) && intIn(c.min, 0, 1_000_000_000) && (c.max === null || intIn(c.max, c.min, 1_000_000_000)));
    case 'preqOff': return simple(['on'], () => typeof c.on === 'boolean');
    case 'floor': return simple(['x', 'y', 'size', 'item', 'ghost'], () => coord('x', 'y') && intIn(c.size, 1, 256) && itemIn(c.item) && (c.ghost === undefined || typeof c.ghost === 'boolean'));
    case 'unfloor': return simple(['x', 'y', 'size'], () => coord('x', 'y') && intIn(c.size, 1, 256));
    case 'sortInv': return simple(['id'], () => id());
    case 'slotLimit': return simple(['id', 'limit'], () => id() && (c.limit === null || intIn(c.limit, 1, 1_000_000)));
    case 'chestSettings': return simple(['id', 'settings'], () => id() && validChestSettings(c.settings));
    case 'cwire': return simple(['a', 'b', 'c', 'ta', 'tb'], () => idIn(c.a) && idIn(c.b) && intIn(c.c, 0, 1) && (c.ta === undefined || intIn(c.ta, 0, 1)) && (c.tb === undefined || intIn(c.tb, 0, 1)));
    case 'cset': return simple(['id', 'cc'], () => id() && (c.cc === null || isRecord(c.cc)));
    case 'bplib': return simple(['op', 'bp', 'id', 'name'], () => ['add', 'del', 'ren'].includes(c.op) && (c.bp === undefined || blueprintIn(c.bp)) && (c.id === undefined || idIn(c.id)) && (c.name === undefined || textIn(c.name, 80)) && (c.op !== 'add' || c.bp !== undefined) && (c.op !== 'del' || c.id !== undefined));
    case 'mark': return simple(['x', 'y'], () => coord('x', 'y'));
    case 'note': return simple(['op', 'id', 'x', 'y', 'text', 'title', 'icon'], () => ['add', 'edit', 'del'].includes(c.op) && (c.id === undefined || idIn(c.id)) && (c.x === undefined || coordIn(c.x)) && (c.y === undefined || coordIn(c.y)) && (c.text === undefined || textIn(c.text, 500)) && (c.title === undefined || textIn(c.title, 80)) && (c.icon === undefined || c.icon === null || textIn(c.icon, 32)));
    case 'setEnemies': return simple(['mode'], () => ['peaceful', 'normal'].includes(c.mode));
    case 'perm': return simple(['demolish', 'bp'], () => (c.demolish === undefined || ['all', 'admins'].includes(c.demolish)) && (c.bp === undefined || ['all', 'admins'].includes(c.bp)));
    case 'placeCar': return simple(['proto', 'rail', 'x', 'y', 'back'], () => ['locomotive', 'cargo-wagon', 'fluid-wagon', 'artillery-wagon'].includes(c.proto) && idIn(c.rail) && coord('x', 'y') && typeof c.back === 'boolean');
    case 'vehicleTurret': return simple(['id', 'slot', 'proto'], () => id() && intIn(c.slot, 0, 1) && (c.proto === null || protoIn(c.proto)));
    case 'vehicleAmmo': return simple(['id', 'slot', 'item'], () => id() && intIn(c.slot, 0, 1) && (c.item === null || itemIn(c.item)));
    case 'vehicleEquipment': return simple(['id', 'op', 'item', 'x', 'y'], () => id() && ['put', 'take', 'feed', 'takeNuclear'].includes(c.op) && (c.item === undefined || itemIn(c.item)) && coord('x', 'y'));
    case 'sched': return simple(['id', 'sched', 'si'], () => id() && Array.isArray(c.sched) && c.sched.length <= 32 && c.sched.every((r: any) => ownFields(r, ['st', 'c', 'n', 'it', 'op', 'cs', 'x']) && textIn(r.st, 40, 1) && conditionIn(r) && (r.x === undefined || Array.isArray(r.x) && r.x.length <= 8 && r.x.every(conditionIn))) && (c.si === undefined || intIn(c.si, 0, 31)));
    case 'tmode': return simple(['id', 'auto'], () => id() && typeof c.auto === 'boolean');
    case 'stopName': return simple(['id', 'name'], () => id() && textIn(c.name, 80));
    case 'stopSide': return simple(['id', 'left'], () => id() && typeof c.left === 'boolean');
    case 'stopLimit': return simple(['id', 'lim'], () => id() && (c.lim === null || intIn(c.lim, 0, 99)));
    case 'tpmode': return simple(['id', 'm'], () => id() && intIn(c.m, 0, 1));
    case 'wfilter': return simple(['id', 'i', 'item'], () => id() && intIn(c.i, 0, 999_999) && (c.item === null || itemIn(c.item)));
    case 'wfilterAll': return simple(['id', 'op'], () => id() && ['set', 'clear'].includes(c.op));
    case 'reactor': return simple(['id', 'op', 'on'], () => id() && ['allow', 'stop'].includes(c.op) && typeof c.on === 'boolean');
    case 'noBoom': return simple(['on'], () => typeof c.on === 'boolean');
    case 'railPath': return simple(['pieces', 'ghost'], () => Array.isArray(c.pieces) && c.pieces.length <= 4096 && c.pieces.every((p: any) => ownFields(p, ['proto', 'x', 'y', 'dir']) && protoIn(p.proto) && coordIn(p.x) && coordIn(p.y) && intIn(p.dir, 0, 7)) && (c.ghost === undefined || typeof c.ghost === 'boolean'));
    case 'x': return xCommandIn(c);
    default: return false;
  }
}

type NativeError = Error & { status?: number; transaction?: unknown };
function httpError(status: number, message: string): NativeError { const e = new Error(message) as NativeError; e.status = status; return e; }
function safeError(e: unknown) { const s = e instanceof Error ? e.message : String(e); return s.slice(0, 400); }
function sameHash(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && timingSafeEqual(x, y);
}
function validModSet(value: unknown): value is ModSet {
  if (!isRecord(value) || typeof value.data !== 'string' || !/^[a-f0-9]{8}$/i.test(value.data) || !Array.isArray(value.mods) || value.mods.length > 64) return false;
  return value.mods.every((m: any) => isRecord(m) && typeof m.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(m.id) && typeof m.ver === 'string' && m.ver.length <= 64 && typeof m.hash === 'string' && /^[a-f0-9]{8,128}$/i.test(m.hash));
}
function sanitizeData(value: any, depth: number, state: { n: number }): any {
  if (++state.n > 50_000 || depth > 24) throw new Error('Request data exceeds its structure limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Non-finite request number'); return value; }
  if (ArrayBuffer.isView(value)) {
    if (!(value instanceof Uint8Array) || value.byteLength > 64 * 1024) throw new Error('Unsupported request byte array');
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) { if (value.length > 10_000) throw new Error('Request list too large'); return value.map(x => sanitizeData(x, depth + 1, state)); }
  if (!isRecord(value) || value instanceof Set || value instanceof Map) throw new Error('Request must contain plain data only');
  const out = Object.create(null);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length > 200) throw new Error('Request object has too many fields');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor' || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('Unsafe request field');
    out[key] = sanitizeData(descriptor.value, depth + 1, state);
  }
  return out;
}
function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return res.end();
  const data = Buffer.from(JSON.stringify(body)); res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Content-Length', data.byteLength); res.end(data);
}
function mime(file: string) { const ext = extname(file); return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' } as Record<string, string>)[ext] || 'application/octet-stream'; }
function listen(s: Server, host: string, port: number) { return new Promise<void>((resolveListen, reject) => { s.once('error', reject); s.listen(port, host, () => { s.off('error', reject); resolveListen(); }); }); }
function readJson(req: IncomingMessage, maxBytes: number) {
  return new Promise<any>((resolveBody, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) { reject(httpError(413, 'Request body too large')); req.destroy(); return; } chunks.push(Buffer.from(chunk)); });
    req.on('end', () => { try { const raw = Buffer.concat(chunks).toString('utf8'); resolveBody(decodeNativeJson(raw, maxBytes, maxBytes > NATIVE_MAX_FRAME_BYTES ? 12_000_000 : 500_000)); } catch { reject(httpError(400, 'Invalid JSON request body')); } });
    req.on('error', reject);
  });
}
function lanAddresses() {
  const out: string[] = [];
  for (const rows of Object.values(networkInterfaces())) for (const row of rows || []) {
    if (!row.internal && row.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(row.address)) out.push(row.address);
  }
  return [...new Set(out)].sort();
}
function advertisedPlayAddresses() {
  const configured = process.env.ZAVOD_ADVERTISE_HOST?.trim();
  if (configured) {
    if (!/^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\d{1,3}(?:\.\d{1,3}){3})$/i.test(configured)) return [];
    return [configured];
  }
  return process.env.ZAVOD_DOCKER === '1' ? [] : lanAddresses();
}
function publicOriginOf(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const value = raw.trim().replace(/\/$/, ''), url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value) return null;
    return url.origin;
  } catch { return null; }
}
async function atomicWrite(file: string, data: Uint8Array, mode = 0o600) {
  const tmp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
  const f = await open(tmp, 'wx', mode);
  try { await f.writeFile(data); await f.sync(); } finally { await f.close(); }
  await rename(tmp, file); if (process.platform !== 'win32') await chmod(file, mode).catch(() => {});
}
async function rotateBackups(file: string, keep: number) {
  try { await access(file); } catch { return; }
  for (let i = keep - 1; i >= 1; i--) await rename(file + `.bak.${i}`, file + `.bak.${i + 1}`).catch(() => {});
  await writeFile(file + '.bak.1.tmp', await readFile(file), { mode: 0o600 }); await rename(file + '.bak.1.tmp', file + '.bak.1');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = new NativeServer();
  void app.start().catch(error => { process.stderr.write('Dedicated server failed: ' + safeError(error) + '\n'); process.exitCode = 1; });
}

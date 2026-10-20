import type { WorkerSim } from './mirror';
import type { ToWorker } from '../sim/protocol';
import { unpackStr } from '../core/pack';
import { decodeNativeJson, encodeNativeJson, NATIVE_API_VERSION, NATIVE_MAX_FRAME_BYTES, NATIVE_MAX_HANDOFF_BYTES, NATIVE_MAX_SNAPSHOT_BYTES, NATIVE_SNAPSHOT_CHUNK_BYTES, nativeWireHash } from '../net/native-protocol';
import { modSet, sameMods } from '../net/mods';
import { NATIVE_RELAY_CODE } from '../net/native-relay-protocol';
import { guestAdmissionFingerprint, guestAdmissionProofPayload } from '../net/password-proof';
import { deriveGuestAdmissionProof, guestAdmissionPublicKey } from './admission';
import { passwordProofInWorker } from './password-worker';
import { NativeBrowserTransport } from './native-transport';
import { nativeInviteOrigin } from './invite-provider';
import { canonScn } from '../sim/scenario';
import type { NativeAccessMode, NativeControlBootstrap, NativeControlStatus, NativeHandoffPrepareResponse, NativeHandoffCommitResponse, NativePlayAuth, NativePlayClientMessage, NativePlayServerMessage, NativeSettingsUpdate, NativeSettingsView } from '../net/native-protocol';

// Consume the launcher credential before UI, telemetry or links can retain it. Never persist it.
const fragment = new URLSearchParams(location.hash.slice(1));
let bootstrapCapability = fragment.get('local-admin');
let launchInvite = fragment.get('server-invite');
let launchReconnect = fragment.get('server-reconnect');
if (bootstrapCapability || launchInvite || launchReconnect) { fragment.delete('local-admin'); fragment.delete('server-invite'); fragment.delete('server-reconnect'); history.replaceState(null, '', location.pathname + location.search + (fragment.size ? '#' + fragment : '')); }
function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4 && octets[0] === '127' && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
const localOrigin = location.protocol === 'http:' && isLoopbackHost(location.hostname);
const roomPath = new RegExp('^/r/(' + NATIVE_RELAY_CODE.source.slice(1, -1) + ')/(?:index\\.html)?$');
const relayRoom = roomPath.exec(location.pathname)?.[1] || '';
const guestBasePath = relayRoom ? `/r/${relayRoom}/` : '/';
// LAN guest pages use HTTP, where randomUUID may be unavailable; getRandomValues remains available.
const requestId = () => { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
type Frozen = { str: string; tick: number; hash: string; ownerPlayerId: string; playerIds: string[]; peers: unknown[]; modState?: { mods: Record<string, Uint8Array>[]; prio: string[]; game: string }; pausedBefore: { local: boolean; network: boolean; speed: number } };
type GuestResume = { worldId: string; playerId: string; token: string; time: number };
type NativePlayAuthBase = Omit<Extract<NativePlayAuth, { role: 'owner' }>, 'challengeId'> | Omit<Extract<NativePlayAuth, { role: 'guest' }>, 'challengeId' | 'admissionProof'>;
const RESUME_KEY = 'zavod7:native-guest-resume:v1';
type AdmissionRecord = { worldId: string; key: string };
type GuestAdmission = AdmissionRecord & { publicKey: string };
const transientAdmission = new Map<string, string>();
function guestAdmission(worldId: string): GuestAdmission {
  let rows: AdmissionRecord[] = [];
  try {
    const raw = localStorage.getItem('zavod7:native-admission:v1');
    const parsed = raw && raw.length <= 4096 ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) rows = parsed.filter((r): r is AdmissionRecord => !!r && /^[a-f0-9]{32}$/.test(r.worldId) && /^[a-f0-9]{64}$/.test(r.key)).slice(-16).map(r => ({ worldId: r.worldId, key: r.key }));
  } catch { /* Retain a per-tab key when browser storage is unavailable. */ }
  let key = rows.find(row => row.worldId === worldId)?.key || transientAdmission.get(worldId) || '';
  if (!key) key = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
  transientAdmission.set(worldId, key);
  while (transientAdmission.size > 16) transientAdmission.delete(transientAdmission.keys().next().value!);
  rows = rows.filter(row => row.worldId !== worldId).concat({ worldId, key }).slice(-16);
  try { localStorage.setItem('zavod7:native-admission:v1', JSON.stringify(rows)); } catch { /* This session can connect; persistent reconnect also needs storage. */ }
  return { worldId, key, publicKey: guestAdmissionPublicKey(key) };
}
function guestResumes(): GuestResume[] {
  try {
    const text = localStorage.getItem(RESUME_KEY); if (!text || text.length > 32768) return [];
    const rows = JSON.parse(text); if (!Array.isArray(rows) || rows.length > 16) return [];
    return rows.filter(r => r && /^[a-f0-9]{32}$/.test(r.worldId) && /^player-[1-9][0-9]{0,12}$/.test(r.playerId) && /^[A-Za-z0-9_-]{32,128}$/.test(r.token) && Number.isSafeInteger(r.time)).map(r => ({ worldId: r.worldId, playerId: r.playerId, token: r.token, time: r.time }));
  } catch { return []; }
}

/** Controller credentials and gameplay reconnect credentials deliberately have separate lifetimes. */
export class NativeClient {
  private downloads = new Set<AbortController>();
  status: NativeControlStatus | null = null;
  settings: NativeSettingsView | null = null;
  joinAccessMode: NativeAccessMode | null = null;
  private admission: GuestAdmission | null = null;
  worlds: { id: string; name: string }[] = [];
  busy = false; error = ''; connected = false; engaged = false;
  loading: { received: number; total: number } | null = null;
  welcome: Extract<NativePlayServerMessage, { type: 'welcome' }> | null = null;
  private credentials: NativeControlBootstrap | null = null;
  private socket: NativeBrowserTransport | null = null;
  transportRoute: 'ws' | 'rtc' | null = null;
  private latestInput: Record<string, unknown> = { t: 'input', mx: 0, my: 0, mine: null, shoot: null, repair: null };
  private inputNeedsResend = false;
  private joining = false;
  private joinGeneration = 0;
  private reconnectToken = ''; private seq = 0;
  private rememberedPassword = ''; private rememberedPasswordWorldId = '';
  private pendingInvite: { worldId: string; token: string } | null = null;
  private explicitReconnect = false;
  private lastJoinedWorld = '';
  private transaction: { prepare: NativeHandoffPrepareResponse; frozen: Frozen } | null = null;
  private transferring = false;
  private readonly browserSession = requestId();
  onChange: (() => void) | null = null;
  onBeforeAttach: (() => void) | null = null;
  onHandoff: ((result: NativeHandoffCommitResponse) => Promise<void>) | null = null;
  get available() { return !!this.credentials; }
  get connecting() { return this.joining; }
  get unresolvedHandoff() { return this.transferring || !!this.transaction; }
  get guestDeviceId() { return this.admission ? guestAdmissionFingerprint(this.admission.publicKey) : ''; }
  constructor(private sim: WorkerSim, private identity: () => { name: string; color: string }) {}

  async bootstrap() {
    const capability = bootstrapCapability; bootstrapCapability = null;
    if (launchReconnect) { this.reconnectToken = launchReconnect; this.explicitReconnect = true; launchReconnect = null; try { await this.join(); } catch (e) { this.fail(e); } return; }
    if (launchInvite) { const invite = launchInvite; launchInvite = null; try { await this.join(invite); } catch (e) { this.fail(e); } return; }
    if (!capability || !localOrigin) {
      if (['http:', 'https:'].includes(location.protocol) && (relayRoom || guestResumes().length)) { try { await this.join(); } catch (e) { this.fail(e); } }
      return;
    }
    try {
      const result = await this.http<NativeControlBootstrap>('/bootstrap', { capability }, false);
      if (result.apiVersion !== NATIVE_API_VERSION || result.origin !== location.origin || !/^[A-Za-z0-9_-]{32,128}$/.test(result.token) || !/^[A-Za-z0-9_-]{32,128}$/.test(result.csrf)) throw new Error('Несовместимый локальный сервер');
      const play = new URL(result.playOrigin);
      if (!/^[a-f0-9]{64}$/.test(result.serverId)) throw new Error('Несовместимый локальный сервер');
      if (play.origin !== result.playOrigin || play.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(play.hostname) || play.username || play.password) throw new Error('Несовместимый локальный сервер');
      this.credentials = result; await this.refresh();
    } catch (e) { this.fail(e); }
    this.onChange?.();
  }
  private fail(e: unknown) { this.error = e instanceof Error ? e.message : String(e); this.onChange?.(); }
  private async http<T>(path: string, body?: unknown, authenticated = true): Promise<T> {
    if (!localOrigin || (authenticated && !this.credentials)) throw new Error('Откройте игру через приложение сервера');
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (authenticated) { headers.Authorization = 'Bearer ' + this.credentials!.token; if (body !== undefined) headers['X-CSRF-Token'] = this.credentials!.csrf; }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/v1' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : encodeNativeJson(body, path === '/handoff/commit' ? NATIVE_MAX_HANDOFF_BYTES : NATIVE_MAX_FRAME_BYTES), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      const reader = response.body?.getReader(); let bytes = 0, text = ''; const decoder = new TextDecoder();
      if (!reader) throw new Error('Пустой ответ локального сервера');
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > NATIVE_MAX_FRAME_BYTES) { await reader.cancel(); throw new Error('Слишком большой ответ сервера'); } text += decoder.decode(chunk.value, { stream: true }); }
      text += decoder.decode(); const result = decodeNativeJson<any>(text);
      if (!response.ok) { if (response.status === 409 && result.status) this.status = result.status; throw new Error(typeof result.message === 'string' ? result.message : 'Ошибка локального сервера: ' + response.status); }
      return result as T;
    } finally { clearTimeout(timer); }
  }
  async refresh() {
    const [status, catalog] = await Promise.all([this.http<NativeControlStatus>('/status'), this.http<{ worlds: { id: string; name: string }[] }>('/worlds')]);
    const settings = status.world ? await this.http<NativeSettingsView>('/settings').catch(() => null) : null;
    this.status = status; this.worlds = catalog.worlds; this.settings = settings; this.onChange?.();
  }
  private mutation(path: string, fields: Record<string, unknown> = {}) {
    if (!this.status) throw new Error('Сначала обновите состояние сервера');
    return this.http<{ revision: number; accepted: boolean; result?: unknown }>(path, { requestId: requestId(), expectedRevision: this.status.revision, ...fields });
  }
  async action(op: 'start' | 'stop' | 'rotateInvite' | 'openWorld', worldId?: string, maxPlayers: 8 | 16 = 8, settings?: NativeSettingsUpdate) {
    if (this.busy || this.transaction) return;
    this.busy = true; this.error = ''; this.onChange?.();
    try {
      await this.mutation('/' + op, op === 'start' ? { world: worldId ? { mode: 'open', worldId } : { mode: 'new' }, maxPlayers, ...(settings ? { settings } : {}), transport: { kind: 'lan' } } : op === 'openWorld' ? { worldId } : {});
      await this.refresh();
      if ((op === 'start' || op === 'openWorld') && this.status?.world?.id !== this.lastJoinedWorld) this.reconnectToken = '';
      if (op === 'stop') this.disconnect();
    } catch (e) { this.fail(e); } finally { this.busy = false; this.onChange?.(); }
  }
  async updateSettings(settings: NativeSettingsUpdate) {
    if (this.busy || !this.status?.world) return;
    this.busy = true; this.error = ''; this.onChange?.();
    try { await this.mutation('/settings', { settings }); await this.refresh(); }
    catch (e) { this.fail(e); }
    finally { this.busy = false; this.onChange?.(); }
  }
  async handoff(worldName: string) {
    if (this.busy || this.engaged || this.transaction || !this.status) return;
    this.busy = this.transferring = true; this.error = ''; this.onChange?.();
    let frozen: Frozen | null = null, commitSent = false;
    try {
      const prepare = await this.http<NativeHandoffPrepareResponse>('/handoff/prepare', { requestId: requestId(), expectedRevision: this.status.revision, sessionId: this.browserSession, sourceGeneration: 0, worldName });
      frozen = await this.sim.nativeFreeze();
      this.transaction = { prepare, frozen };
      const save = await unpackStr(frozen.str);
      // From this point a lost HTTP response is an uncertain transfer, never permission to resume.
      commitSent = true;
      const result = await this.http<NativeHandoffCommitResponse>('/handoff/commit', { requestId: requestId(), expectedRevision: prepare.expectedRevision, transactionId: prepare.transactionId, lastTick: frozen.tick, lastHash: frozen.hash, ownerPlayerId: frozen.ownerPlayerId, ...(frozen.modState ? { modState: frozen.modState } : {}), save });
      await this.acceptHandoff(result);
    } catch (e) {
      if (!commitSent) { if (frozen) this.sim.nativeResume(frozen.pausedBefore.local); this.transaction = null; }
      this.fail(e);
    } finally { this.busy = this.transferring = false; this.onChange?.(); }
  }
  private async acceptHandoff(result: NativeHandoffCommitResponse) {
    if (!result.accepted || !this.transaction || result.worldId !== this.transaction.prepare.worldId || result.generation !== this.transaction.prepare.targetGeneration) throw new Error('Передача мира не подтверждена');
    this.reconnectToken = result.reconnectToken;
    this.transaction = null;
    // Keep the old authority frozen even if the subsequent play connection fails.
    this.engaged = true;
    if (this.onHandoff) { try { await this.onHandoff(result); } catch (e) { this.fail(e); } }
    await this.refresh(); await this.join();
  }
  async resolveHandoff() {
    if (!this.transaction || this.busy) return;
    this.busy = true; this.onChange?.();
    try {
      const t = this.transaction;
      const result = await this.http<{ state: string; result?: NativeHandoffCommitResponse }>('/handoff/' + encodeURIComponent(t.prepare.transactionId));
      if (result.state === 'committed' && result.result) await this.acceptHandoff(result.result);
      else if (result.state === 'aborted' || result.state === 'expired') { this.transaction = null; this.sim.nativeResume(t.frozen.pausedBefore.local); await this.refresh(); }
      else this.error = 'Передача ещё не завершена. Мир остаётся на паузе.';
    } catch (e) { this.fail(e); } finally { this.busy = false; this.onChange?.(); }
  }
  async abortHandoff() {
    if (!this.transaction || this.busy) return;
    this.busy = true; this.onChange?.();
    try {
      const t = this.transaction;
      const result = await this.http<{ state: string; result?: NativeHandoffCommitResponse }>('/handoff/abort', { requestId: requestId(), expectedRevision: this.status?.revision, transactionId: t.prepare.transactionId });
      if (result.state === 'committed' && result.result) await this.acceptHandoff(result.result);
      else if (result.state === 'aborted' || result.state === 'expired') { this.transaction = null; this.sim.nativeResume(t.frozen.pausedBefore.local); await this.refresh(); }
      else throw new Error('Передача мира не подтверждена');
    } catch (e) { this.fail(e); } finally { this.busy = false; this.onChange?.(); }
  }
  async joinInvitation(raw: string, password = '') {
    const value = raw.trim();
    if (!value && (relayRoom || this.pendingInvite)) { await this.join(undefined, password); return; }
    if (/^https?:\/\//i.test(value)) {
      const target = new URL(value), fields = new URLSearchParams(target.hash.slice(1));
      const reconnect = fields.get('server-reconnect'), invite = fields.get('server-invite');
      const credential = reconnect || invite;
      const room = roomPath.test(target.pathname);
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || !room && !['/', '/index.html'].includes(target.pathname) || !room && !credential || credential && !/^[A-Za-z0-9_-]{32,128}$/.test(credential) || fields.has('local-admin')) throw new Error('Некорректная ссылка приглашения');
      if (target.origin !== location.origin || target.pathname !== location.pathname) { this.disconnect(); target.hash = credential ? (reconnect ? 'server-reconnect=' : 'server-invite=') + credential : ''; location.assign(target.href); return; }
      if (room && !credential) { await this.join(); return; }
      if (reconnect) { this.reconnectToken = reconnect; this.explicitReconnect = true; await this.join(undefined, password); } else await this.join(invite!, password);
      return;
    }
    const shortCode = value.replace(/[\s-]/g, '').toUpperCase();
    if (NATIVE_RELAY_CODE.test(shortCode)) {
      const provider = relayRoom ? location.origin : nativeInviteOrigin();
      if (!provider) throw new Error('Для этой сборки служба коротких кодов ещё не настроена. Вставьте полную ссылку приглашения.');
      this.disconnect(); location.assign(new URL(`/r/${shortCode}/`, provider).href); return;
    }
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new Error('Вставьте полную ссылку приглашения сервера');
    await this.join(value, password);
  }
  async join(inviteToken?: string, password = '') {
    if (this.connected || this.socket || this.joining) return;
    this.joining = true;
    const generation = ++this.joinGeneration;
    this.onChange?.();
    try {
    this.error = '';
    this.joinAccessMode = null;
    this.admission = null;
    let expectedWorldId = this.status?.world?.id || '';
    let expectedServerId = this.credentials?.serverId || '';
    if (!this.credentials) {
      if (!['http:', 'https:'].includes(location.protocol)) throw new Error('Вставьте полную ссылку приглашения сервера');
      const info = await this.worldInfo();
      if (!sameMods(info.modSet, modSet())) throw new Error('Версия данных игры или набор модов не совпадает с сервером');
      expectedWorldId = info.worldId;
      expectedServerId = info.serverId;
      inviteToken ||= info.inviteToken;
      const resume = guestResumes().find(r => r.worldId === info.worldId);
      if (resume && !this.explicitReconnect) this.reconnectToken = resume.token;
      else if (!this.explicitReconnect && this.lastJoinedWorld !== info.worldId && inviteToken) this.reconnectToken = '';
    }
    let ownerJoinToken: string | null = null;
    if (!this.credentials && expectedWorldId) {
      if (this.pendingInvite?.worldId !== expectedWorldId) this.pendingInvite = null;
      if (inviteToken) this.pendingInvite = { worldId: expectedWorldId, token: inviteToken };
      else if (!this.reconnectToken && this.pendingInvite) inviteToken = this.pendingInvite.token;
    }
    if (this.credentials && !inviteToken) {
      const join = await this.http<{ worldId: string; generation: number; joinToken: string; serverId: string }>('/join-token');
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(join.joinToken) || !/^[a-f0-9]{32}$/.test(join.worldId) || join.serverId !== this.credentials.serverId) throw new Error('Несовместимый локальный сервер');
      ownerJoinToken = join.joinToken; expectedWorldId = join.worldId; expectedServerId = join.serverId;
    }
    if (generation !== this.joinGeneration) throw new Error('Подключение отменено');
    const localMods = modSet();
    if (!ownerJoinToken && expectedWorldId) this.admission = guestAdmission(expectedWorldId);
    const auth: NativePlayAuthBase = ownerJoinToken
      ? { type: 'auth', role: 'owner', joinToken: ownerJoinToken, modSet: localMods, ...this.identity() }
      : this.admission ? { type: 'auth', role: 'guest', ...(this.reconnectToken && !this.credentials ? { reconnectToken: this.reconnectToken } : inviteToken ? { inviteToken } : this.reconnectToken ? { reconnectToken: this.reconnectToken } : {}), admissionPublicKey: this.admission.publicKey, modSet: localMods, ...this.identity() }
      : (() => { throw new Error('Введите приглашение сервера'); })();
    const url = new URL(this.credentials ? '/api/v1/play' : guestBasePath + 'api/v1/play', this.credentials?.playOrigin || location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const admission = this.admission;
    const socket = new NativeBrowserTransport(url, expectedWorldId || '', expectedServerId, async payload => auth.role === 'owner'
      ? { ownerToken: auth.joinToken }
      : { publicKey: admission!.publicKey, proof: await deriveGuestAdmissionProof(admission!.key, payload) });
    this.socket = socket; this.seq = 0; this.welcome = null;
    this.latestInput = { t: 'input', mx: 0, my: 0, mine: null, shoot: null, repair: null }; this.inputNeedsResend = false;
    socket.onroute = route => {
      if (this.socket !== socket) return;
      this.transportRoute = route;
      if (!route) this.inputNeedsResend = true;
      else this.resendCurrentInput();
      this.onChange?.();
    };
    return await new Promise<void>((resolve, reject) => {
      let settled = false;
      let authSent = false, authPending = false, challengePassword = '';
      const authAbort = new AbortController();
      let transfer: { id: string; bytes: Uint8Array; parts: number; next: number; offset: number; tick: number; hash: string; started: number } | null = null;
      let lastReceived = performance.now();
      let lastProgress = 0;
      const heartbeat = setInterval(() => { if (performance.now() - lastReceived >= 30000 || transfer && performance.now() - transfer.started > 180000) { this.error = 'Нет соединения с сервером'; socket.close(1000); } else if (authSent && socket.readyState === WebSocket.OPEN) socket.send(encodeNativeJson({ type: 'ping', nonce: Date.now() })); }, 10000);
      const timer = setTimeout(() => { if (!settled) { settled = true; socket.close(); reject(new Error('Сервер не прислал мир')); } }, 180000);
      const apply = (m: Extract<NativePlayServerMessage, { type: 'snapshot' }>) => {
        if (!this.welcome) throw new Error('Снимок получен до входа');
        if (!this.connected) {
          const info = m.snapshot.worldInit;
          const patch = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) &&
            Object.keys(v).sort().join(',') === 'r,res,rich,x,y' && Object.values(v).every(n => typeof n === 'number' && Number.isFinite(n)) &&
            (v as { r: number }).r >= 0 && (v as { rich: number }).rich >= 0 &&
            Number.isInteger((v as { res: number }).res) && (v as { res: number }).res >= 0 && (v as { res: number }).res <= 255;
          if (!info || Object.keys(info).sort().join(',') !== 'lake,noUranium,oil,scenario,seed,uranium' ||
              !Number.isInteger(info.seed) || info.seed < 0 || info.seed > 0xffffffff || !patch(info.lake) || !patch(info.oil) || !patch(info.uranium) ||
              typeof info.noUranium !== 'boolean' || info.scenario !== null && !canonScn(info.scenario)) throw new Error('Несовместимые параметры мира сервера');
          this.onBeforeAttach?.(); this.engaged = this.connected = true; this.loading = null;
          this.sim.attachRemote(message => this.sendWorker(message), info, m.snapshot.settings); this.onChange?.();
        }
        this.sim.remoteMessage({ t: 'snap', s: m.snapshot });
        if (!settled) { settled = true; clearTimeout(timer); resolve(); }
      };
      socket.onopen = () => { if (this.socket !== socket || generation !== this.joinGeneration) socket.close(1000); };
      socket.onmessage = async ev => {
        if (this.socket !== socket || generation !== this.joinGeneration) return;
        try {
          if (typeof ev.data !== 'string') throw new Error('Неверный формат сообщения сервера');
          const m = decodeNativeJson<NativePlayServerMessage>(ev.data);
          lastReceived = performance.now();
          if (m.type === 'auth-challenge') {
            if (m.serverId !== expectedServerId) throw new Error('Идентификатор сервера не совпадает с приглашением');
            if (authSent || authPending || !/^[A-Za-z0-9_-]{32,128}$/.test(m.challengeId) || !/^[a-f0-9]{32}$/.test(m.worldId) || !Number.isSafeInteger(m.generation) || m.generation < 0 || !['invite', 'whitelist'].includes(m.accessMode) || typeof m.passwordRequired !== 'boolean' || expectedWorldId && m.worldId !== expectedWorldId) throw new Error('Некорректная проверка доступа сервера');
            authPending = true;
            if (this.rememberedPasswordWorldId && this.rememberedPasswordWorldId !== m.worldId) { this.rememberedPassword = ''; this.rememberedPasswordWorldId = ''; }
            this.joinAccessMode = m.accessMode;
            this.onChange?.();
            const fingerprint = auth.role === 'guest' ? guestAdmissionFingerprint(auth.admissionPublicKey) : '';
            const admissionProof = auth.role === 'guest'
              ? await deriveGuestAdmissionProof(this.admission!.key, guestAdmissionProofPayload(m.worldId, m.generation, m.challengeId, fingerprint, expectedServerId))
              : undefined;
            let passwordProof: string | undefined;
            if (auth.role === 'guest' && m.passwordRequired) {
              if (!/^[a-f0-9]{32}$/i.test(m.passwordSalt || '') || m.passwordIterations !== 310_000) throw new Error('Несовместимые настройки защиты сервера');
              challengePassword = password || (this.rememberedPasswordWorldId === m.worldId ? this.rememberedPassword : '');
              if (!challengePassword) { this.onChange?.(); throw new Error('Для входа нужен пароль сервера'); }
              const payload = `zavod7-native-auth\n${expectedServerId}\n${m.worldId}\n${m.generation}\n${m.challengeId}\n${fingerprint}\nguest`;
              passwordProof = await passwordProofInWorker(challengePassword, m.passwordSalt!, m.passwordIterations!, payload, authAbort.signal);
            } else if (auth.role === 'guest') { this.rememberedPassword = ''; this.rememberedPasswordWorldId = ''; }
            const response: NativePlayAuth = auth.role === 'guest' ? { ...auth, challengeId: m.challengeId, admissionProof: admissionProof!, ...(passwordProof ? { passwordProof } : {}) } : { ...auth, challengeId: m.challengeId };
            if (socket.readyState !== WebSocket.OPEN || this.socket !== socket || generation !== this.joinGeneration) throw new Error('Подключение отменено');
            socket.send(encodeNativeJson(response)); authSent = true;
          } else if (m.type === 'welcome') {
            if (m.serverId !== expectedServerId) throw new Error('Идентификатор сервера не совпадает с приглашением');
            if (this.welcome || !sameMods(m.modSet, localMods)) throw new Error('Версия данных игры или набор модов не совпадает с сервером');
            socket.authenticated();
            this.welcome = m; this.lastJoinedWorld = m.worldId;
            if (challengePassword && !m.owner) { this.rememberedPassword = challengePassword; this.rememberedPasswordWorldId = m.worldId; }
            this.explicitReconnect = false;
            if (m.reconnectToken) {
              this.reconnectToken = m.reconnectToken;
              if (!m.owner && /^[a-f0-9]{32}$/.test(m.worldId) && /^player-[1-9][0-9]{0,12}$/.test(m.playerId) && /^[A-Za-z0-9_-]{32,128}$/.test(m.reconnectToken)) {
                const rows = guestResumes().filter(r => r.worldId !== m.worldId).sort((a, b) => a.time - b.time).slice(-15);
                rows.push({ worldId: m.worldId, playerId: m.playerId, token: m.reconnectToken, time: Date.now() });
                try { localStorage.setItem(RESUME_KEY, JSON.stringify(rows)); } catch { /* A live connection still retains its credential in memory. */ }
              }
            }
          }
          else if (m.type === 'snapshot') {
            if (transfer) throw new Error('Неверный порядок частей мира');
            apply(m);
          } else if (m.type === 'snapshot-begin') {
            if (!this.welcome || transfer || !/^[A-Za-z0-9_-]{1,96}$/.test(m.id) || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > NATIVE_MAX_SNAPSHOT_BYTES || m.parts !== Math.ceil(m.bytes / NATIVE_SNAPSHOT_CHUNK_BYTES) || !Number.isSafeInteger(m.tick) || m.tick < 0 || !/^[a-f0-9]{16}$/.test(m.hash) || !sameMods(m.modSet, localMods)) throw new Error('Некорректный заголовок снимка мира');
            transfer = { id: m.id, bytes: new Uint8Array(m.bytes), parts: m.parts, next: 0, offset: 0, tick: m.tick, hash: m.hash, started: performance.now() };
            this.loading = { received: 0, total: m.bytes }; this.onChange?.();
          } else if (m.type === 'snapshot-chunk') {
            const t = transfer;
            if (!t || m.id !== t.id || m.index !== t.next || typeof m.data !== 'string') throw new Error('Неверный порядок частей мира');
            const expected = Math.min(NATIVE_SNAPSHOT_CHUNK_BYTES, t.bytes.length - t.offset);
            if (m.data.length !== 4 * Math.ceil(expected / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.data)) throw new Error('Неверный размер части мира');
            const bytes = atob(m.data); if (bytes.length !== expected) throw new Error('Неверный размер части мира');
            for (let i = 0; i < bytes.length; i++) t.bytes[t.offset + i] = bytes.charCodeAt(i);
            t.offset += bytes.length; t.next++;
            this.loading = { received: t.offset, total: t.bytes.length };
            if (performance.now() - lastProgress > 200) { lastProgress = performance.now(); this.onChange?.(); }
            if (t.next === t.parts) {
              if (t.offset !== t.bytes.length || nativeWireHash(t.bytes) !== t.hash) throw new Error('Контрольная сумма снимка мира не совпадает');
              const complete = decodeNativeJson<NativePlayServerMessage>(new TextDecoder('utf-8', { fatal: true }).decode(t.bytes), NATIVE_MAX_SNAPSHOT_BYTES, 8_000_000);
              if (complete.type !== 'snapshot' || complete.snapshot.tick !== t.tick) throw new Error('Некорректный заголовок снимка мира');
              transfer = null; this.loading = null; apply(complete);
            }
            socket.send(encodeNativeJson({ type: 'snapshot-ack', id: t.id, index: m.index }));
          } else if (m.type === 'rpc') {
            if (!m.error && m.result && typeof m.result === 'object' && 'download' in m.result) {
              void this.exportResult(m.result).then(result => { if (this.socket === socket) this.sim.remoteReply(m.id, result); }, error => { if (this.socket === socket) this.sim.remoteReply(m.id, undefined, error instanceof Error ? error.message : String(error)); });
            } else this.sim.remoteReply(m.id, m.result, m.error);
          }
          else if (m.type === 'error') { this.fail(new Error(m.message)); if (!this.connected) socket.close(1000); }
        } catch (e) { this.fail(e); socket.close(1002, 'Protocol error'); }
      };
      socket.onerror = () => { if (this.socket === socket) { this.error = 'Нет соединения с сервером'; this.onChange?.(); } };
      socket.onclose = () => {
        authAbort.abort();
        clearTimeout(timer); clearInterval(heartbeat);
        transfer = null;
        this.loading = null;
        if (!settled) { settled = true; reject(new Error(this.error || 'Соединение с сервером закрыто')); }
        if (this.socket !== socket) return;
        for (const download of this.downloads) download.abort(); this.downloads.clear();
        this.socket = null; this.transportRoute = null; this.connected = false; this.welcome = null;
        if (this.engaged) this.sim.remoteDisconnected();
        this.onChange?.();
      };
    });
    } finally { this.joining = false; this.onChange?.(); }
  }
  /** Large saves use a one-use owner ticket; no administrative credential enters the URL. */
  private async exportResult(result: object): Promise<unknown> {
    const ticket = (result as { download?: { path?: unknown; token?: unknown; bytes?: unknown; hash?: unknown } }).download;
    if (!this.credentials || !this.welcome?.owner || !ticket || typeof ticket.path !== 'string' || !/^\/api\/v1\/export\/[a-f0-9]{32}$/.test(ticket.path) || typeof ticket.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(ticket.token) || !Number.isSafeInteger(ticket.bytes) || (ticket.bytes as number) < 1 || (ticket.bytes as number) > NATIVE_MAX_HANDOFF_BYTES || typeof ticket.hash !== 'string' || !/^[a-f0-9]{16}$/.test(ticket.hash)) throw new Error('Некорректный билет экспорта мира');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
    this.downloads.add(controller);
    try {
      const response = await fetch(new URL(ticket.path, this.credentials.origin), { headers: { Authorization: 'Bearer ' + ticket.token }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('Не удалось получить экспорт мира');
      const bytes = new Uint8Array(ticket.bytes as number), reader = response.body.getReader(); let offset = 0;
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        if (offset + part.value.byteLength > bytes.length) { await reader.cancel(); throw new Error('Неверный размер экспорта мира'); }
        bytes.set(part.value, offset); offset += part.value.byteLength;
      }
      if (offset !== bytes.length || nativeWireHash(bytes) !== ticket.hash) throw new Error('Контрольная сумма экспорта мира не совпадает');
      const payload = decodeNativeJson<unknown>(new TextDecoder('utf-8', { fatal: true }).decode(bytes), NATIVE_MAX_HANDOFF_BYTES, 8_000_000);
      if (!payload || typeof payload !== 'object' || typeof (payload as { str?: unknown }).str !== 'string' || !Number.isSafeInteger((payload as { tick?: unknown }).tick)) throw new Error('Некорректный экспорт мира');
      return payload;
    } finally { clearTimeout(timer); this.downloads.delete(controller); }
  }
  private async worldInfo(): Promise<{ worldId: string; serverId: string; modSet: ReturnType<typeof modSet>; inviteToken?: string }> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(relayRoom ? '/v1/rooms/' + relayRoom : '/api/v1/world-info', { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('Сервер сейчас не принимает игроков');
      const reader = response.body.getReader(); let text = '', bytes = 0; const decoder = new TextDecoder();
      for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 128 * 1024) { await reader.cancel(); throw new Error('Неверный формат сообщения сервера'); } text += decoder.decode(part.value, { stream: true }); }
      const info = JSON.parse(text + decoder.decode());
      if (!/^[a-f0-9]{32}$/.test(info?.worldId) || !/^[a-f0-9]{64}$/.test(info?.serverId) || !info.modSet) throw new Error('Неверный формат сообщения сервера');
      if (relayRoom) {
        if (typeof info.guestBaseUrl !== 'string' || typeof info.inviteToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(info.inviteToken) || !Number.isSafeInteger(info.generation) || info.generation < 0 || !Number.isSafeInteger(info.expiresAt) || info.expiresAt <= Date.now()) throw new Error('Приглашение сервера истекло или недоступно');
        const base = new URL(info.guestBaseUrl);
        if (base.origin !== location.origin || base.pathname !== guestBasePath || base.search || base.hash || base.username || base.password) throw new Error('Некорректная ссылка приглашения');
      }
      return info;
    } finally { clearTimeout(timer); }
  }
  private send(message: NativePlayClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.connected) throw new Error('Соединение с сервером потеряно');
    if (!this.socket.route) throw new Error('Восстановление соединения…');
    if (this.socket.bufferedAmount > 1024 * 1024) throw new Error('Сервер не успевает принимать команды');
    this.socket.send(encodeNativeJson(message));
  }
  private sendWorker(m: ToWorker) {
    if (this.socket?.readyState !== WebSocket.OPEN) { if ('id' in m && typeof m.id === 'number') this.sim.remoteReply(m.id, undefined, 'Соединение с сервером потеряно'); return; }
    try { this.forwardWorker(m); }
    catch (e) {
      if ('id' in m && typeof m.id === 'number') this.sim.remoteReply(m.id, undefined, e instanceof Error ? e.message : String(e));
      this.fail(e);
      if (this.socket && this.socket.bufferedAmount > 1024 * 1024) this.disconnect();
    }
  }
  private forwardWorker(m: ToWorker) {
    if (m.t === 'cmd' && m.c.t === 'input') {
      this.latestInput = structuredClone(m.c);
      if (!this.socket?.route) { this.inputNeedsResend = true; return; }
    }
    this.resendCurrentInput();
    if (m.t === 'frame' && !this.socket?.canSendView) return;
    switch (m.t) {
      case 'cmd': this.send({ type: 'cmd', seq: ++this.seq, command: m.c as unknown as Record<string, unknown> }); return;
      case 'frame': this.send({ type: 'view', vp: m.vp, focus: m.focus, allChunks: m.allChunks }); return;
      case 'xq': this.send({ type: 'rpc', id: m.id, method: 'xq', q: m.q, a: m.a }); return;
      case 'pstats': this.send({ type: 'rpc', id: m.id, method: 'pstats', tier: m.tier, tab: m.tab, sel: m.sel }); return;
      case 'save': this.send({ type: 'rpc', id: m.id, method: 'save' }); return;
      case 'tele': this.send({ type: 'rpc', id: m.id, method: 'tele' }); return;
      case 'pause': case 'speed': if (this.welcome?.owner) this.send({ type: 'owner-action', requestId: requestId(), op: m.t, value: m.t === 'pause' ? m.paused : m.speed }); return;
      case 'prof': return;
      default: throw new Error('Действие недоступно при подключении к серверу');
    }
  }
  private resendCurrentInput() {
    if (!this.inputNeedsResend || !this.connected || !this.socket?.route) return;
    try { this.send({ type: 'cmd', seq: ++this.seq, command: this.latestInput }); this.inputNeedsResend = false; }
    catch { /* Wait for journal acknowledgements; do not turn a recovery into an unbounded queue. */ }
  }
  disconnect() { ++this.joinGeneration; for (const download of this.downloads) download.abort(); this.downloads.clear(); this.socket?.close(1000); this.socket = null; this.transportRoute = null; this.connected = false; this.welcome = null; this.loading = null; if (this.engaged) this.sim.remoteDisconnected(); this.onChange?.(); }
  /** Explicit world selection, unlike a network failure, may start another local authority. */
  leaveForLocalWorld() { this.disconnect(); this.engaged = false; this.reconnectToken = ''; this.explicitReconnect = false; this.rememberedPassword = ''; this.rememberedPasswordWorldId = ''; }
}

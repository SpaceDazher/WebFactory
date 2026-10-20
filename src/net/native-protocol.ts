/** Native controller/play JSON wire primitives shared by the Node server and browser client. */
import { Inventory } from '../sim/inventory';
export const NATIVE_API_VERSION = 1;
export const NATIVE_MAX_FRAME_BYTES = 8 * 1024 * 1024;
/** Larger control-plane bound for a one-time save/mod handoff. Gameplay frames remain 8 MiB. */
export const NATIVE_MAX_HANDOFF_BYTES = 128 * 1024 * 1024;
/** Chunked snapshot aggregate cap. Per-WebSocket frames remain NATIVE_MAX_FRAME_BYTES. */
export const NATIVE_MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
export const NATIVE_SNAPSHOT_CHUNK_BYTES = 384 * 1024;

/** Non-cryptographic corruption check for chunk assembly; authentication uses bearer tokens. */
export function nativeWireHash(bytes: Uint8Array): string {
  // Split FNV-1a-64 into words to keep a 128 MiB snapshot transfer cheap in HTTP LAN contexts
  // where SubtleCrypto may be unavailable. Products stay below Number.MAX_SAFE_INTEGER.
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (const byte of bytes) {
    lo = (lo ^ byte) >>> 0;
    const product = lo * 0x1b3;
    const nextLo = product >>> 0;
    const carry = Math.floor(product / 0x1_0000_0000);
    hi = (hi * 0x1b3 + carry + lo * 0x100) >>> 0;
    lo = nextLo;
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

type NativeTypedArray = Uint8Array | Uint16Array | Uint32Array | Int16Array | Int32Array | Float32Array | Float64Array;
type TypedArrayName = 'u8' | 'u16' | 'u32' | 'i16' | 'i32' | 'f32' | 'f64';
type PackedArray = { $z7ta: TypedArrayName; data: string };
const arrayName = (v: ArrayBufferView): TypedArrayName | null => {
  if (v instanceof Uint8Array) return 'u8';
  if (v instanceof Uint16Array) return 'u16';
  if (v instanceof Uint32Array) return 'u32';
  if (v instanceof Int16Array) return 'i16';
  if (v instanceof Int32Array) return 'i32';
  if (v instanceof Float32Array) return 'f32';
  if (v instanceof Float64Array) return 'f64';
  return null;
};
const ctorOf: Record<TypedArrayName, { new(buffer: ArrayBuffer): NativeTypedArray; readonly BYTES_PER_ELEMENT: number }> = {
  u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, i16: Int16Array,
  i32: Int32Array, f32: Float32Array, f64: Float64Array,
};
const encode64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  return btoa(binary);
};
const decode64 = (value: string, maxBytes: number): Uint8Array => {
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid native typed-array payload');
  const binary = atob(value);
  if (binary.length > maxBytes) throw new Error('Native typed-array payload exceeds limit');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Convert the simulator's typed-array snapshot fields to compact, explicit JSON tags. */
export function encodeNativeJson(value: unknown, maxBytes = NATIVE_MAX_FRAME_BYTES): string {
  const seen = new Set<object>();
  const visit = (v: any, depth: number): any => {
    if (depth > 40) throw new Error('Native message nesting exceeds limit');
    if (v === undefined) return null;
    if (v == null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v !== 'object') throw new Error('Native message contains a non-data value');
    if (ArrayBuffer.isView(v)) {
      const kind = arrayName(v);
      if (!kind) throw new Error('Unsupported native typed array');
      const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      return { $z7ta: kind, data: encode64(bytes) } satisfies PackedArray;
    }
    if (seen.has(v)) throw new Error('Native message contains a cycle');
    seen.add(v);
    let out: any;
    if (v instanceof Set) out = { $z7set: [...v].map(x => visit(x, depth + 1)) };
    else if (v instanceof Map) out = { $z7map: [...v.entries()].map(([k, value]) => [visit(k, depth + 1), visit(value, depth + 1)]) };
    else if (Array.isArray(v)) out = v.map(x => visit(x, depth + 1));
    else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null && !(v instanceof Inventory)) throw new Error('Native message contains an unsupported object');
      out = Object.create(null);
      for (const [k, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('Native message contains an accessor');
        if (!descriptor.enumerable || descriptor.value === undefined) continue;
        out[k] = visit(descriptor.value, depth + 1);
      }
    }
    seen.delete(v);
    return out;
  };
  const encoded = JSON.stringify(visit(value, 0));
  if (typeof encoded !== 'string') throw new Error('Native message is not serializable');
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) throw new Error('Native message exceeds configured limit');
  return encoded;
}

/** Restore only the typed-array forms emitted above; untrusted tags are strictly closed-schema. */
export function decodeNativeJson<T = unknown>(encoded: string, maxFrameBytes = NATIVE_MAX_FRAME_BYTES, maxNodes = 500_000): T {
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > maxFrameBytes) throw new Error('Native message exceeds frame limit');
  const root = JSON.parse(encoded);
  let nodes = 0;
  const visit = (v: any, depth: number): any => {
    if (++nodes > maxNodes || depth > 40) throw new Error('Native message structure exceeds limit');
    if (v == null || typeof v !== 'object') return v;
    if (!Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '$z7ta')) {
      if (Object.keys(v).length !== 2 || typeof v.$z7ta !== 'string' || !Object.prototype.hasOwnProperty.call(ctorOf, v.$z7ta) || typeof v.data !== 'string') throw new Error('Invalid native typed-array tag');
      const name = v.$z7ta as TypedArrayName;
      const bytes = decode64(v.data, maxFrameBytes);
      const Ctor = ctorOf[name];
      if (bytes.byteLength % Ctor.BYTES_PER_ELEMENT) throw new Error('Misaligned native typed-array payload');
      const copy = bytes.slice().buffer;
      return new Ctor(copy);
    }
    if (!Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '$z7set')) {
      if (Object.keys(v).length !== 1 || !Array.isArray(v.$z7set)) throw new Error('Invalid native Set tag');
      return new Set(v.$z7set.map((x: any) => visit(x, depth + 1)));
    }
    if (!Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '$z7map')) {
      if (Object.keys(v).length !== 1 || !Array.isArray(v.$z7map)) throw new Error('Invalid native Map tag');
      return new Map(v.$z7map.map((row: any) => {
        if (!Array.isArray(row) || row.length !== 2) throw new Error('Invalid native Map row');
        return [visit(row[0], depth + 1), visit(row[1], depth + 1)];
      }));
    }
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
    const out = Object.create(null);
    for (const k of Object.keys(v)) out[k] = visit(v[k], depth + 1);
    return out;
  };
  return visit(root, 0) as T;
}

export type NativeControlStatus = {
  revision: number;
  controller: { state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'; health: string };
  world: null | { id: string; name: string; tick: number; players: number; maxPlayers: 8 | 16 };
  handoff: null | { worldId: string; sessionId: string; generation: number };
  invite: null | { code: string; lanUrls: string[]; ready: boolean; expiresAt: number; transport: { kind: 'lan' | 'https-proxy' | 'relay'; proxyUrl?: string; relayUrl?: string; roomCode?: string }; reachability: 'local-only' | 'proxy-configured' | 'proxy-unavailable' | 'relay-configured' | 'relay-unavailable'; relay: { state: 'disabled' | 'connecting' | 'ready' | 'unavailable'; message: string; guestBaseUrl?: string; roomCode?: string; expiresAt?: number } };
};

export type NativeAccessMode = 'invite' | 'whitelist';
export type NativeSettingsUpdate = {
  maxPlayers: 8 | 16;
  pauseWhenEmpty: boolean;
  accessMode: NativeAccessMode;
  /** Optional replacement password; never returned by the settings endpoint. */
  password?: string;
  clearPassword?: boolean;
  adminPlayerIds: string[];
  /** Public SHA-256 fingerprints of private world-scoped admission keys. */
  whitelistFingerprints: string[];
  removeWhitelistFingerprints: string[];
};
export type NativeSettingsView = {
  maxPlayers: 8 | 16;
  pauseWhenEmpty: boolean;
  accessMode: NativeAccessMode;
  passwordSet: boolean;
  adminPlayerIds: string[];
  whitelistFingerprints: string[];
  roster: { playerId: string; name: string; role: 'owner' | 'admin' | 'player'; online: boolean }[];
};

export type NativeControlBootstrap = {
  serverId: string;
  apiVersion: typeof NATIVE_API_VERSION;
  origin: string;
  playOrigin: string;
  revision: number;
  token: string;
  csrf: string;
  /** Present only if a world is active during bootstrap. Fetch `/join-token` after start/open. */
  joinToken?: string;
  ownerPlayerId?: string;
};

export type NativeControlBootstrapRequest = { capability: string };

export type NativeControlRequest = {
  requestId: string;
  expectedRevision: number;
};

export type NativeHandoffPrepareRequest = NativeControlRequest & {
  sessionId: string;
  sourceGeneration: number;
  worldName: string;
};

export type NativeHandoffPrepareResponse = {
  requestId: string;
  revision: number;
  transactionId: string;
  worldId: string;
  sessionId: string;
  sourceGeneration: number;
  targetGeneration: number;
  expectedRevision: number;
  expiresAt: number;
};

export type NativeHandoffCommitRequest = NativeControlRequest & {
  transactionId: string;
  ownerPlayerId: string;
  lastTick: number;
  lastHash: string;
  save: unknown;
  modState?: { mods: Record<string, Uint8Array>[]; prio: string[]; game: string };
};

export type NativeHandoffCommitResponse = {
  requestId: string;
  accepted: true;
  revision: number;
  worldId: string;
  sessionId: string;
  generation: number;
  ownerPlayerId: string;
  reconnectToken: string;
  peerMigrations: NativePeerMigration[];
};

/** One durable, identity-bound rejoin capability per pre-handoff peer. */
export type NativePeerMigration = {
  playerId: string;
  peerKey: string;
  playOrigin: string;
  reconnectToken: string;
  expiresAt: number;
};

export type NativeHandoffTransactionStatus = {
  state: 'prepared' | 'committing' | 'committed' | 'aborted' | 'expired';
  result?: NativeHandoffCommitResponse;
  expiresAt?: number;
};

export type NativePlayAuth =
  | { type: 'auth'; challengeId: string; role: 'owner'; joinToken: string; modSet: { data: string; mods: { id: string; ver: string; hash: string }[] }; name?: string; color?: string }
  | { type: 'auth'; challengeId: string; admissionPublicKey: string; admissionProof: string; passwordProof?: string; role: 'guest'; inviteToken?: string; reconnectToken?: string; modSet: { data: string; mods: { id: string; ver: string; hash: string }[] }; name?: string; color?: string };

export type NativePlayClientMessage =
  | NativePlayAuth
  | { type: 'view'; vp: { x0: number; y0: number; x1: number; y1: number }; focus?: number[]; allChunks?: boolean }
  | { type: 'cmd'; seq: number; command: Record<string, unknown> }
  | { type: 'owner-action'; requestId: string; op: 'pause' | 'speed'; value: boolean | number }
  | { type: 'rpc'; id: number; method: 'frame'; vp: { x0: number; y0: number; x1: number; y1: number }; focus?: number[]; allChunks?: boolean }
  | { type: 'rpc'; id: number; method: 'xq'; q: string; a: unknown }
  | { type: 'rpc'; id: number; method: 'pstats'; tier: number; tab: string; sel: string | null }
  | { type: 'rpc'; id: number; method: 'save' }
  | { type: 'rpc'; id: number; method: 'tele' }
  | { type: 'ping'; nonce: number }
  | { type: 'snapshot-ack'; id: string; index: number };

export type NativePlayServerMessage =
  | { type: 'auth-challenge'; serverId: string; challengeId: string; worldId: string; generation: number; accessMode: NativeAccessMode; passwordRequired: boolean; passwordSalt?: string; passwordIterations?: number }
  | { type: 'welcome'; serverId: string; worldId: string; sessionId: string; generation: number; revision: number; playerId: string; owner: boolean; maxPlayers: number; reconnectToken?: string; tick: number; modSet: { data: string; mods: { id: string; ver: string; hash: string }[] } }
  | { type: 'snapshot'; snapshot: import('../sim/protocol').Snapshot }
  | { type: 'snapshot-begin'; id: string; bytes: number; parts: number; tick: number; hash: string; modSet: { data: string; mods: { id: string; ver: string; hash: string }[] } }
  | { type: 'snapshot-chunk'; id: string; index: number; data: string }
  | { type: 'rpc'; id: number; result?: unknown; error?: string }
  | { type: 'owner-action'; requestId: string; accepted: boolean; revision: number; paused: boolean; speed: number }
  | { type: 'event'; name: string; data?: unknown }
  | { type: 'pong'; nonce: number; tick: number }
  | { type: 'error'; code: string; message: string };

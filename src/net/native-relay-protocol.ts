/** Shared, closed-schema wire contract for the optional self-hosted guest relay. */
import type { ModSet } from './mods';

export const NATIVE_RELAY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const NATIVE_RELAY_CODE = /^[A-HJ-NP-Z2-9]{10}$/;
/** Raw guest play frames. Base64 tunnel envelopes remain below the 8 MiB WS cap. */
export const NATIVE_RELAY_MAX_DATA_BYTES = 5 * 1024 * 1024;
export const NATIVE_RELAY_MAX_LEASE_MS = 60 * 60 * 1000;
export const NATIVE_RELAY_MIN_HOST_TOKEN = 32;
export const NATIVE_RELAY_MAX_GUESTS = 32;

export type NativeRelayRoom = {
  serverId: string;
  worldId: string;
  generation: number;
  guestBaseUrl: string;
  inviteToken: string;
  modSet: ModSet;
  expiresAt: number;
  maxPlayers: 8 | 16;
};

export type NativeRelayHostMessage =
  | { type: 'host-auth'; token: string; leaseId: string; serverId: string }
  | { type: 'host-proof'; leaseId: string; serverId: string; publicKey: string; nonce: string; proof: string }
  | { type: 'register'; requestId: string; leaseId: string; worldId: string; generation: number; inviteToken: string; inviteExpiresAt: number; maxPlayers: 8 | 16; modSet: ModSet; resumeCode?: string }
  | { type: 'release'; leaseId: string }
  | { type: 'guest-data'; id: string; data: string }
  | { type: 'guest-close'; id: string; code: number; reason: string }
  | { type: 'pong'; nonce: number };

export type NativeRelayGatewayMessage =
  | { type: 'host-challenge'; nonce: string }
  | { type: 'host-ready'; leaseId: string; serverId: string }
  | { type: 'registered'; requestId: string; leaseId: string; serverId: string; code: string; guestBaseUrl: string; expiresAt: number }
  | { type: 'guest-open'; id: string; resumeOnly: boolean }
  | { type: 'guest-data'; id: string; data: string }
  | { type: 'guest-close'; id: string; code: number; reason: string }
  | { type: 'ping'; nonce: number }
  | { type: 'error'; code: 'auth' | 'register' | 'lease' | 'limit' | 'message'; message: string };

export const nativeRelayRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function validNativeRelayModSet(value: unknown): value is ModSet {
  if (!nativeRelayRecord(value) || Object.keys(value).length !== 2 || typeof value.data !== 'string' || !/^[a-f0-9]{8,64}$/i.test(value.data) || !Array.isArray(value.mods) || value.mods.length > 256) return false;
  return value.mods.every(row => nativeRelayRecord(row) && Object.keys(row).length === 3 &&
    typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 80 &&
    typeof row.ver === 'string' && row.ver.length <= 40 &&
    typeof row.hash === 'string' && /^[a-f0-9]{8,128}$/i.test(row.hash));
}

const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(value, k));
const leaseIdOk = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s);
const worldIdOk = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s);
const safeToken = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(s);
const guestIdOk = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s);
export const nativeRelayServerIdOk = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export function nativeRelayHostProofPayload(origin: string, nonce: string, serverId: string, leaseId: string) {
  return `zavod7-relay-host-v1\n${origin}\n${nonce}\n${serverId}\n${leaseId}`;
}

/** Validation is deliberately shared by the Node host and the gateway boundary. */
export function isNativeRelayHostMessage(value: unknown): value is NativeRelayHostMessage {
  if (!nativeRelayRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'host-auth': return exact(value, ['type', 'token', 'leaseId', 'serverId']) && safeToken(value.token) && leaseIdOk(value.leaseId) && nativeRelayServerIdOk(value.serverId);
    case 'host-proof': return exact(value, ['type', 'leaseId', 'serverId', 'publicKey', 'nonce', 'proof']) && leaseIdOk(value.leaseId) && nativeRelayServerIdOk(value.serverId) && nativeRelayServerIdOk(value.publicKey) && leaseIdOk(value.nonce) && typeof value.proof === 'string' && /^[a-f0-9]{128}$/.test(value.proof);
    case 'register': return (exact(value, ['type', 'requestId', 'leaseId', 'worldId', 'generation', 'inviteToken', 'inviteExpiresAt', 'maxPlayers', 'modSet']) ||
      exact(value, ['type', 'requestId', 'leaseId', 'worldId', 'generation', 'inviteToken', 'inviteExpiresAt', 'maxPlayers', 'modSet', 'resumeCode'])) && leaseIdOk(value.requestId) &&
      leaseIdOk(value.leaseId) && worldIdOk(value.worldId) && Number.isSafeInteger(value.generation) && (value.generation as number) >= 0 &&
      safeToken(value.inviteToken) && Number.isSafeInteger(value.inviteExpiresAt) &&
      (value.maxPlayers === 8 || value.maxPlayers === 16) && validNativeRelayModSet(value.modSet) &&
      (value.resumeCode === undefined || typeof value.resumeCode === 'string' && NATIVE_RELAY_CODE.test(value.resumeCode));
    case 'release': return exact(value, ['type', 'leaseId']) && leaseIdOk(value.leaseId);
    case 'guest-data': return exact(value, ['type', 'id', 'data']) && guestIdOk(value.id) && typeof value.data === 'string' &&
      value.data.length > 0 && value.data.length <= Math.ceil(NATIVE_RELAY_MAX_DATA_BYTES / 3) * 4 + 4 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data);
    case 'guest-close': return exact(value, ['type', 'id', 'code', 'reason']) && guestIdOk(value.id) && Number.isSafeInteger(value.code) &&
      (value.code as number) >= 1000 && (value.code as number) <= 4999 && typeof value.reason === 'string' && value.reason.length <= 120;
    case 'pong': return exact(value, ['type', 'nonce']) && Number.isSafeInteger(value.nonce) && (value.nonce as number) >= 0;
    default: return false;
  }
}

export function isNativeRelayGatewayMessage(value: unknown): value is NativeRelayGatewayMessage {
  if (!nativeRelayRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'host-challenge': return exact(value, ['type', 'nonce']) && leaseIdOk(value.nonce);
    case 'host-ready': return exact(value, ['type', 'leaseId', 'serverId']) && leaseIdOk(value.leaseId) && nativeRelayServerIdOk(value.serverId);
    case 'registered': return exact(value, ['type', 'requestId', 'leaseId', 'serverId', 'code', 'guestBaseUrl', 'expiresAt']) && leaseIdOk(value.leaseId) && leaseIdOk(value.requestId) && nativeRelayServerIdOk(value.serverId) &&
      typeof value.code === 'string' && NATIVE_RELAY_CODE.test(value.code) && typeof value.guestBaseUrl === 'string' && value.guestBaseUrl.length <= 512 &&
      Number.isSafeInteger(value.expiresAt);
    case 'guest-open': return exact(value, ['type', 'id', 'resumeOnly']) && guestIdOk(value.id) && typeof value.resumeOnly === 'boolean';
    case 'guest-data': return exact(value, ['type', 'id', 'data']) && guestIdOk(value.id) && typeof value.data === 'string' &&
      value.data.length > 0 && value.data.length <= Math.ceil(NATIVE_RELAY_MAX_DATA_BYTES / 3) * 4 + 4 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data);
    case 'guest-close': return exact(value, ['type', 'id', 'code', 'reason']) && guestIdOk(value.id) && Number.isSafeInteger(value.code) &&
      (value.code as number) >= 1000 && (value.code as number) <= 4999 && typeof value.reason === 'string' && value.reason.length <= 120;
    case 'ping': return exact(value, ['type', 'nonce']) && Number.isSafeInteger(value.nonce) && (value.nonce as number) >= 0;
    case 'error': return exact(value, ['type', 'code', 'message']) && ['auth', 'register', 'lease', 'limit', 'message'].includes(String(value.code)) &&
      typeof value.message === 'string' && value.message.length <= 160;
    default: return false;
  }
}

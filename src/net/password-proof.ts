import { sha256 } from '../vendor/noble-hashes/sha2.js';
import { hmac } from '../vendor/noble-hashes/hmac.js';
import { pbkdf2Async } from '../vendor/noble-hashes/pbkdf2.js';
import { bytesToHex, hexToBytes } from '../vendor/noble-hashes/utils.js';

/** Derive the same password proof on secure contexts and ordinary LAN HTTP pages. */
export async function deriveGuestPasswordProof(password: string, saltHex: string, iterations: number, payload: string) {
  if (iterations !== 310_000 || !/^[a-f0-9]{32}$/i.test(saltHex)) throw new Error('Несовместимые настройки защиты сервера');
  let normalized: string;
  try { normalized = password.normalize('NFKC'); encodeURIComponent(normalized); }
  catch { throw new Error('Пароль содержит некорректный символ'); }
  const passwordBytes = new TextEncoder().encode(normalized);
  if (passwordBytes.length < 8 || passwordBytes.length > 128) throw new Error('Пароль должен занимать 8–128 байт');
  const salt = hexToBytes(saltHex), message = new TextEncoder().encode(payload);
  if (globalThis.crypto?.subtle) {
    try {
      const base = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt).buffer, iterations }, base, 256);
      const key = await crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)));
    } catch { /* Some LAN browsers do not expose SubtleCrypto; use the same pinned primitives. */ }
  }
  const verifier = await pbkdf2Async(sha256, passwordBytes, salt, { c: iterations, dkLen: 32, asyncTick: 4 });
  try { return bytesToHex(hmac(sha256, verifier, message)); }
  finally { verifier.fill(0); }
}

export function guestAdmissionFingerprint(publicKey: string) {
  if (!/^[a-f0-9]{64}$/i.test(publicKey)) throw new Error('Некорректный ключ допуска');
  return bytesToHex(sha256(hexToBytes(publicKey)));
}
export function guestAdmissionProofPayload(worldId: string, generation: number, challengeId: string, fingerprint: string, serverId: string) {
  return `zavod7-admission-auth\n${serverId}\n${worldId}\n${generation}\n${challengeId}\n${fingerprint.toLowerCase()}\nguest`;
}


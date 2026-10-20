import * as nacl from '../vendor/tweetnacl';

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
function pair(seedHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(seedHex)) throw new Error('Некорректный ключ допуска');
  const seed = Uint8Array.from(seedHex.match(/../g)!, s => Number.parseInt(s, 16));
  try { return nacl.sign.keyPair.fromSeed(seed); }
  finally { seed.fill(0); }
}
export function guestAdmissionPublicKey(seedHex: string) {
  const keys = pair(seedHex);
  try { return hex(keys.publicKey); } finally { keys.secretKey.fill(0); }
}
/** Browser-only dependency. The Node server verifies public signatures using node:crypto. */
export async function deriveGuestAdmissionProof(seedHex: string, payload: string) {
  const keys = pair(seedHex);
  try { return hex(nacl.sign.detached(new TextEncoder().encode(payload), keys.secretKey)); }
  finally { keys.secretKey.fill(0); }
}

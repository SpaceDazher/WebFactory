import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { chmod, link, lstat, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export type NativeHostIdentity = { serverId: string; publicKey: string; leaseId: string; sign(payload: string): string };
/** Persisted application identity, deliberately separate from transferable world saves. */
export async function loadNativeHostIdentity(dataRoot: string): Promise<NativeHostIdentity> {
  const path = join(dataRoot, 'relay-identity.json');
  let privateKey: KeyObject | null = null, leaseId = '';
  try { await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const keys = generateKeyPairSync('ed25519');
    const temp = join(dataRoot, '.relay-identity-' + randomBytes(12).toString('hex') + '.tmp');
    const file = await open(temp, 'wx', 0o600);
    try {
      try {
        await file.writeFile(JSON.stringify({ schema: 1, leaseId: randomBytes(16).toString('hex'), privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) }) + '\n');
        await file.sync();
      } finally { await file.close(); }
      try { await link(temp, path); }
      catch (linkError) { if ((linkError as NodeJS.ErrnoException).code !== 'EEXIST') throw linkError; }
    }
    finally { await unlink(temp).catch(() => {}); }
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 64 || stat.size > 8192) throw new Error('Invalid server identity file');
  if (process.platform !== 'win32') await chmod(path, 0o600);
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || Object.keys(stored).sort().join(',') !== 'leaseId,privateKey,schema' || stored.schema !== 1 || typeof stored.privateKey !== 'string' || stored.privateKey.length > 4096 || typeof stored.leaseId !== 'string' || !/^[a-f0-9]{32}$/.test(stored.leaseId)) throw new Error();
    privateKey = createPrivateKey(stored.privateKey); leaseId = stored.leaseId;
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') throw new Error();
  } catch { throw new Error('Server identity is damaged; restore the private application identity backup'); }
  if (!privateKey) throw new Error('Invalid private server identity');
  const pub = createPublicKey(privateKey).export({ format: 'jwk' });
  if (typeof pub.x !== 'string') throw new Error('Invalid Ed25519 host identity');
  const bytes = Buffer.from(pub.x, 'base64url');
  if (bytes.length !== 32) throw new Error('Invalid Ed25519 host identity');
  return { serverId: createHash('sha256').update(bytes).digest('hex'), publicKey: bytes.toString('hex'), leaseId, sign: payload => sign(null, Buffer.from(payload), privateKey!).toString('hex') };
}

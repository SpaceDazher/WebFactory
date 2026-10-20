import { deriveGuestPasswordProof } from '../net/password-proof';

let busy = false;
self.onmessage = async ev => {
  if (busy) return;
  busy = true;
  const v = ev.data;
  try {
    if (!v || typeof v !== 'object' || Object.keys(v).sort().join(',') !== 'id,iterations,password,payload,saltHex' || !Number.isSafeInteger(v.id) || v.id < 1 || typeof v.password !== 'string' || v.password.length > 256 || typeof v.payload !== 'string' || v.payload.length > 1024 || typeof v.saltHex !== 'string' || v.iterations !== 310_000) throw new Error('Несовместимые настройки защиты сервера');
    const proof = await deriveGuestPasswordProof(v.password, v.saltHex, v.iterations, v.payload);
    self.postMessage({ id: v.id, proof });
  } catch (e) {
    self.postMessage({ id: Number.isSafeInteger(v?.id) ? v.id : 0, error: e instanceof Error ? e.message.slice(0, 256) : 'Не удалось подготовить подтверждение пароля' });
  } finally { self.close(); }
};

let nextId = 0;
/** A fresh bounded worker keeps the expensive LAN password fallback off the render thread. */
export function passwordProofInWorker(password: string, saltHex: string, iterations: number, payload: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(new Error('Подключение отменено'));
  const source = document.getElementById('authworker')?.textContent;
  if (!source || source.length > 2 * 1024 * 1024) return Promise.reject(new Error('В сборке отсутствует обработчик защиты пароля'));
  const id = ++nextId, url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let worker: Worker;
  try { worker = new Worker(url); }
  catch { URL.revokeObjectURL(url); return Promise.reject(new Error('Не удалось запустить обработчик защиты пароля')); }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error, proof?: string) => {
      if (done) return; done = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(proof!);
    };
    const abort = () => finish(new Error('Подключение отменено'));
    const timer = setTimeout(() => finish(new Error('Истекло время подготовки подтверждения пароля')), 9000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('Не удалось подготовить подтверждение пароля'));
    worker.onmessage = ev => {
      const v = ev.data;
      if (!v || typeof v !== 'object' || v.id !== id || Object.keys(v).some(k => !['id', 'proof', 'error'].includes(k))) return finish(new Error('Неверный ответ обработчика защиты пароля'));
      if (typeof v.error === 'string' && v.error.length <= 256) return finish(new Error(v.error));
      if (typeof v.proof !== 'string' || !/^[a-f0-9]{64}$/.test(v.proof)) return finish(new Error('Неверный ответ обработчика защиты пароля'));
      finish(undefined, v.proof);
    };
    if (signal.aborted) abort();
    else try { worker.postMessage({ id, password, saltHex, iterations, payload }); }
    catch { finish(new Error('Не удалось подготовить подтверждение пароля')); }
  });
}

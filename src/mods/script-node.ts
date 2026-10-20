// v1.11: Worker мода в Node (тесты, бот, инструменты) — worker_threads с кодом из строки
import { Worker } from 'worker_threads';
import type { Spawn, ModPort, ScriptHost } from './script';
import type { Game } from '../sim/game';
export const nodeSpawn: Spawn = (src, name) => {
  const w = new Worker(src, { eval: true, name: 'mod:' + name, resourceLimits: { maxOldGenerationSizeMb: 96 } });
  const p: ModPort = { post: m => w.postMessage(m), onmessage: null, terminate: () => { void w.terminate(); } };
  w.on('message', m => p.onmessage?.(m)); w.on('error', e => p.onmessage?.({ t: 'fail', text: e.message })); w.unref();
  return p;
};
/** n тиков с ожиданием ответов модов (как цикл Worker симуляции) */
export async function stepScripts(g: Game, host: ScriptHost, n: number, cmds: (tick: number) => void = () => {}) {
  for (let i = 0; i < n; i++) { if (!(await host.settle())) throw new Error('моды не ответили'); cmds(g.tick); g.step(); }
  await host.settle();
}

// Test-only preload in the actual packaged server process, never in release startup.
import { appendFileSync } from 'node:fs';
const path = process.env.ZAVOD_SOAK_METRICS_FILE;
if (!path || typeof global.gc !== 'function') throw new Error('Soak telemetry requires its own metrics file and --expose-gc');
const started = performance.now();
function sample() {
  global.gc();
  appendFileSync(path, JSON.stringify({ at: Date.now(), elapsedMs: performance.now() - started, pid: process.pid, ...process.memoryUsage() }) + '\n');
}
sample();
setInterval(sample, 60_000).unref();

// Run the browser acceptance scripts without passing a long && chain through
// cmd.exe. Preserve the suite order and fail-fast behavior while forwarding
// the selected browser environment to each test process.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2).map(value => Number(value.replace(/^e2e/i, '')));
if (requested.some(number => !Number.isInteger(number) || number < 5 || number > 38)) {
  throw new Error('Select E2E scripts by number or name (5–38), e.g. e2e5 e2e38');
}
const tests = requested.length ? requested : Array.from({ length: 34 }, (_, i) => i + 5);

for (const number of tests) {
  const name = `e2e${number}.mjs`;
  const script = path.join('tests', name);
  const args = number === 12 || number >= 34 ? ['--import', 'tsx', script] : [script];
  const started = performance.now();
  console.log(`[E2E_START] ${name}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const code = result.status ?? 1;
  const duration = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`[E2E_EXIT] ${name} code=${code}${result.signal ? ` signal=${result.signal}` : ''} duration=${duration}s`);
  if (result.error) console.error(`[E2E_ERROR] ${name}: ${result.error.message}`);
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}

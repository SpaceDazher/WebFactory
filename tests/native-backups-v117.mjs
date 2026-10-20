// Observe this test's live data only; never copy controller capabilities or save contents to logs.
import assert from 'node:assert/strict';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { decodeNativeJson } from '../src/net/native-protocol.ts';
import { deserialize, stateHash } from '../src/sim/save.ts';
const pid = Number(process.argv[2]); assert.ok(Number.isSafeInteger(pid) && pid > 0, 'own live soak PID required');
const root = await realpath(resolve('logs/verify-20261019')), matches = [];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('native-smoke-')) continue;
  try {
    const dir = await realpath(join(root, entry.name)); if (!dir.startsWith(root + sep)) continue;
    if (JSON.parse(await readFile(join(dir, 'server.lock'), 'utf8')).pid === pid) matches.push(dir);
  } catch (error) { if (!['ENOENT', 'EPERM', 'EACCES'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
}
assert.equal(matches.length, 1, 'exactly one own smoke data directory matches the server PID');
const directory = matches[0], output = resolve('logs/acceptance-20261020/soak-backups.json'), started = performance.now();
const report = { state: 'waiting', pid, checkedAt: '', rows: [] };
try {
  let lastCount = -1;
  while (performance.now() - started < 3 * 3600000) {
    process.kill(pid, 0);
    assert.equal(JSON.parse(await readFile(join(directory, 'server.lock'), 'utf8')).pid, pid);
    const names = await readdir(join(directory, 'worlds')), backups = names.filter(n => /\.json\.bak\.\d+$/.test(n));
    report.checkedAt = new Date().toISOString();
    if (backups.length !== lastCount) { console.log('Automatic backup files: ' + backups.length); lastCount = backups.length; }
    if (backups.length >= 10) {
      assert.equal(backups.length, 10, 'automatic retention keeps exactly ten backups');
      const files = backups.slice().sort((a, b) => Number(a.split('.').at(-1)) - Number(b.split('.').at(-1)));
      for (const file of files) {
        const saved = decodeNativeJson(await readFile(join(directory, 'worlds', basename(file)), 'utf8'));
        assert.equal(saved.schema, 1);
        const game = deserialize(saved.world.save);
        assert.equal(game.v117.playerIds.length, 16, 'backup preserves all sixteen engineers');
        report.rows.push({ slot: Number(file.split('.').at(-1)), tick: game.tick, hash: stateHash(game), players: game.v117.playerIds.length });
      }
      assert.ok(report.rows.every((r, i) => !i || r.tick <= report.rows[i - 1].tick), 'backup slots are newest first');
      report.state = 'passed'; await writeFile(output, JSON.stringify(report, null, 2) + '\n');
      console.log('PASS: ten automatic backups restore valid complete sixteen-engineer worlds'); process.exit(0);
    }
    await writeFile(output, JSON.stringify({ ...report, count: backups.length }, null, 2) + '\n'); await delay(60000);
  }
  throw new Error('Ten automatic backups not observed within three real hours');
} catch (error) { report.state = 'failed'; report.error = String(error.message); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); throw error; }

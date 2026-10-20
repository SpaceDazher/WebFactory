import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveBotSavesDir } from '../tools/bot/saves-path';

const cwd = path.resolve('portable-project-root');
assert.equal(
  resolveBotSavesDir({ cwd }),
  path.resolve(cwd, 'integration-logs', 'bot-saves'),
  'default bot checkpoints stay under the current release output directory',
);
assert.equal(
  resolveBotSavesDir({ cwd, env: 'custom/bot-saves' }),
  path.resolve(cwd, 'custom/bot-saves'),
  'BOT_SAVES remains a supported override',
);
assert.equal(
  resolveBotSavesDir({ cwd, argument: 'cli/bot-saves', env: 'env/bot-saves' }),
  path.resolve(cwd, 'cli/bot-saves'),
  'an explicit oldsaves CLI directory takes precedence over BOT_SAVES',
);
console.log('✔ bot checkpoint directory defaults inside release output and preserves overrides');

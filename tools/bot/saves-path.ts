import path from 'node:path';

export type BotSavesDirOptions = {
  cwd?: string;
  argument?: string;
  env?: string;
};

/** Resolve bot checkpoints and oldsaves input to one portable, release-local default. */
export function resolveBotSavesDir(options: BotSavesDirOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const requested = options.argument || options.env || path.join('integration-logs', 'bot-saves');
  return path.resolve(cwd, requested);
}

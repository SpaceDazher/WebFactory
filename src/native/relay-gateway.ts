import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RelayGateway } from './relay-gateway-service';

async function main() {
  const mode = process.env.ZAVOD_RELAY_REGISTRATION || 'private';
  if (mode !== 'private' && mode !== 'public') throw new Error('ZAVOD_RELAY_REGISTRATION must be private or public');
  const gateway = new RelayGateway({
    origin: process.env.ZAVOD_RELAY_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '',
    assetsRoot: resolve(dirname(fileURLToPath(import.meta.url)), '../../dist'),
    port: Number(process.env.ZAVOD_RELAY_PORT || process.env.PORT || 17900),
    mode, hostToken: process.env.ZAVOD_RELAY_HOST_TOKEN || '',
    trustInternalProxy: process.env.ZAVOD_RELAY_TRUST_PROXY === '1',
    installerPath: process.env.ZAVOD_NATIVE_INSTALLER_PATH,
  });
  await gateway.start();
  process.stdout.write('Zavod-7 relay gateway is listening; registration mode: ' + mode + '\n');
  process.on('SIGINT', () => { void gateway.stop('SIGINT'); });
  process.on('SIGTERM', () => { void gateway.stop('SIGTERM'); });
}
void main().catch(error => {
  process.stderr.write('Relay gateway failed: ' + (error instanceof Error ? error.message : 'unknown error') + '\n');
  process.exitCode = 1;
});

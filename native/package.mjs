import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, copyFile, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = process.cwd();
const dist = resolve(root, 'dist');
const native = join(dist, 'native');
const server = join(native, 'server.mjs');
const relayGateway = join(native, 'relay-gateway.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inviteOrigin = (process.env.ZAVOD_INVITE_ORIGIN || '').trim();
if (inviteOrigin) {
  const provider = new URL(inviteOrigin);
  if (provider.protocol !== 'https:' || provider.origin !== inviteOrigin || provider.username || provider.password) throw new Error('ZAVOD_INVITE_ORIGIN must be an exact owned HTTPS origin.');
}
const nativeDefines = { __NATIVE_INVITE_ORIGIN__: JSON.stringify(inviteOrigin), __VERSION__: JSON.stringify(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version) };
await mkdir(native, { recursive: true });
const rtcModules = join(root, 'native/rtc-runtime/node_modules');
const rtcLock = await readFile(join(root, 'native/rtc-runtime/package-lock.json'));
const rtcNotices = [];
for (const entry of (await readdir(rtcModules, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const paths = entry.name.startsWith('@') ? (await readdir(join(rtcModules, entry.name))).map(name => join(rtcModules, entry.name, name)) : [join(rtcModules, entry.name)];
  for (const path of paths) {
    const metadata = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    const files = (await readdir(path)).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    // A few pure JS packages include the full license in their README instead.
    const texts = await Promise.all((files.length ? files : ['README.md']).map(name => readFile(join(path, name), 'utf8')));
    rtcNotices.push(`${metadata.name}@${metadata.version} (${metadata.license || 'See upstream notice'})\n${texts.join('\n')}`);
  }
}
await writeFile(join(native, 'THIRD-PARTY-NOTICES.txt'), (await Promise.all(['tweetnacl', 'noble-hashes'].map(async name => `${name}\n${await readFile(join(root, 'public/licenses', name + '.txt'), 'utf8')}`))).concat(rtcNotices).join('\n\n'));
await writeFile(join(native, 'rtc-dependency-lock.json'), rtcLock);
const nodeRequire = 'import {createRequire as __nativeCreateRequire} from "node:module"; const require=__nativeCreateRequire(import.meta.url);';
await build({ entryPoints: [resolve(root, 'src/native/server.ts')], outfile: server, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'bundle', sourcemap: false, legalComments: 'eof', charset: 'utf8', banner: { js: nodeRequire }, define: nativeDefines });
await build({ entryPoints: [resolve(root, 'src/native/relay-gateway.ts')], outfile: relayGateway, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'bundle', sourcemap: false, legalComments: 'eof', charset: 'utf8', define: nativeDefines });
const serverBytes = await readFile(server), relayBytes = await readFile(relayGateway);
await writeFile(join(native, 'runtime-manifest.json'), JSON.stringify({ api: 1, nodeMajor: 22, serverSha256: sha(serverBytes), relayGatewaySha256: sha(relayBytes) }, null, 2) + '\n');

if (process.argv.includes('--server-only')) process.exit(0);
if (process.platform !== 'win32') throw new Error('Windows packaging requires a Windows build host; use --server-only for Docker/Linux.');
const REQUIRED_NODE_VERSION = '22.23.2';
if (process.versions.node !== REQUIRED_NODE_VERSION) throw new Error(`Windows packaging requires Node ${REQUIRED_NODE_VERSION} (found ${process.versions.node}).`);
const nodeExe = resolve(process.env.ZAVOD_NODE_EXE || process.execPath);
if ((await stat(nodeExe)).isDirectory()) throw new Error('ZAVOD_NODE_EXE must name node.exe, not a directory.');
const selectedNode = spawnSync(nodeExe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
if (selectedNode.error) throw selectedNode.error;
if (selectedNode.status !== 0 || selectedNode.stdout.trim() !== `v${REQUIRED_NODE_VERSION}`) throw new Error(`Selected runtime must be Node ${REQUIRED_NODE_VERSION} (found ${selectedNode.stdout.trim() || selectedNode.stderr.trim() || 'unknown'}).`);
await copyFile(nodeExe, join(native, 'node.exe'));
const licenseCandidates = [process.env.ZAVOD_NODE_LICENSE, join(dirname(nodeExe), 'LICENSE.txt'), join(dirname(dirname(nodeExe)), 'LICENSE.txt'), join(root, 'native/licenses/node-v22.23.2-LICENSE.txt')].filter(Boolean);
let nodeLicense = null;
for (const candidate of licenseCandidates) { try { await access(candidate); nodeLicense = candidate; break; } catch { /* try next installed distribution location */ } }
if (!nodeLicense) throw new Error('Node LICENSE.txt was not found; set ZAVOD_NODE_LICENSE to the license shipped with the selected Node runtime.');
await copyFile(nodeLicense, join(native, 'Node-LICENSE.txt'));
const nodeBytes = await readFile(join(native, 'node.exe'));
await writeFile(join(native, 'runtime-manifest.json'), JSON.stringify({ api: 1, node: process.versions.node, nodeSha256: sha(nodeBytes), serverSha256: sha(serverBytes), relayGatewaySha256: sha(relayBytes), installer: 'Zavod7-Server-Setup.exe' }, null, 2) + '\n');

const csc = process.env.ZAVOD_CSC || join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const compile = (source, output, refs = [], options = []) => {
  const result = spawnSync(csc, ['/nologo', '/target:winexe', '/optimize+', `/out:${output}`, ...refs.map(x => `/reference:${x}`), ...options, source], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${basename(source)} compilation failed with exit ${result.status}`);
};
compile(join(root, 'native/windows/Tray.cs'), join(native, 'Zavod7-Server-Tray.exe'), ['System.Windows.Forms.dll', 'System.Drawing.dll', 'System.Core.dll', 'System.Security.dll'], ['/codepage:65001']);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; }
  return table;
})();
const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const u16 = (b, n) => { const x = Buffer.alloc(2); x.writeUInt16LE(n & 0xffff); b.push(x); };
const u32 = (b, n) => { const x = Buffer.alloc(4); x.writeUInt32LE(n >>> 0); b.push(x); };

// Package only build products. Never sweep dist recursively: local server data,
// invitation credentials or an operator's .env must not become installer payload.
const payloadPaths = [
  'index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'licenses/tweetnacl.txt', 'licenses/noble-hashes.txt',
  'native/server.mjs', 'native/relay-gateway.mjs', 'native/node.exe', 'native/Node-LICENSE.txt',
  'native/Zavod7-Server-Tray.exe', 'native/runtime-manifest.json',
  'native/THIRD-PARTY-NOTICES.txt', 'native/rtc-dependency-lock.json',
];
async function packageFiles() {
  const files = [];
  for (const path of payloadPaths) {
    const file = join(dist, path), metadata = await lstat(file);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Invalid build product: ${path}`);
    files.push(file);
  }
  return files;
}
async function zip(files, destination) {
  if (files.length > 0xffff) throw new Error('Package has too many files for ZIP32.');
  const local = [], central = []; let offset = 0;
  for (const file of files) {
    const name = relative(root, file).split(sep).join('/');
    if (!name.startsWith('dist/') || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe package path: ${name}`);
    const raw = await readFile(file), packed = deflateRawSync(raw, { level: 9 }), nameBytes = Buffer.from(name, 'utf8'), crc = crc32(raw);
    if (nameBytes.length > 0xffff || raw.length > 0xffffffff || packed.length > 0xffffffff || offset + packed.length + nameBytes.length + 30 > 0xffffffff) throw new Error(`Package entry exceeds ZIP32 limits: ${name}`);
    const lh = []; u32(lh, 0x04034b50); u16(lh, 20); u16(lh, 0x0800); u16(lh, 8); u16(lh, 0); u16(lh, 0x21); u32(lh, crc); u32(lh, packed.length); u32(lh, raw.length); u16(lh, nameBytes.length); u16(lh, 0);
    local.push(Buffer.concat([...lh, nameBytes, packed]));
    const ch = []; u32(ch, 0x02014b50); u16(ch, 20); u16(ch, 20); u16(ch, 0x0800); u16(ch, 8); u16(ch, 0); u16(ch, 0x21); u32(ch, crc); u32(ch, packed.length); u32(ch, raw.length); u16(ch, nameBytes.length); u16(ch, 0); u16(ch, 0); u16(ch, 0); u16(ch, 0); u32(ch, 0); u32(ch, offset);
    central.push(Buffer.concat([...ch, nameBytes]));
    offset += local[local.length - 1].length;
  }
  const centralBytes = Buffer.concat(central), end = [];
  if (centralBytes.length > 0xffffffff || offset + centralBytes.length > 0xffffffff) throw new Error('Package exceeds ZIP32 archive limits.');
  u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, files.length); u16(end, files.length); u32(end, centralBytes.length); u32(end, offset); u16(end, 0);
  await writeFile(destination, Buffer.concat([...local, centralBytes, Buffer.concat(end)]));
}

const payload = join(native, '.payload.zip');
const createInstaller = async () => {
try {
  const files = await packageFiles();
  await zip(files, payload);
  compile(join(root, 'native/windows/Setup.cs'), join(native, 'Zavod7-Server-Setup.exe'), ['System.Windows.Forms.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll', 'System.Core.dll', 'System.Security.dll'], ['/codepage:65001', `/resource:${payload},PAYLOAD`]);
} finally { await rm(payload, { force: true }); }
};
await createInstaller();

const index = join(dist, 'index.html');
const html = await readFile(index, 'utf8');
const marker = '<link rel="zavod-native-installer" href="./native/Zavod7-Server-Setup.exe">';
if (!html.includes(marker)) await writeFile(index, html.replace('</head>', `  ${marker}\n</head>`));
// Re-embed the installer discovery link only after a real first installer has
// been compiled; Setup copies its own final executable beside the installed app.
await createInstaller();
console.log('Prepared dist/native server bundle, private Windows installer, and bundled Node 22 runtime.');

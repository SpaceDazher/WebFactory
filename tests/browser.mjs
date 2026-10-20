import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwrightPath = process.env.PW || 'playwright';
const playwrightSpecifier = path.isAbsolute(playwrightPath) ? pathToFileURL(playwrightPath).href : playwrightPath;
const { chromium, firefox, webkit } = await import(playwrightSpecifier);

const browserTypes = { chromium, firefox, webkit };

export function selectedBrowser(fallback = 'chromium') {
  const name = process.env.PW_BROWSER || process.argv[2] || fallback;
  if (!Object.hasOwn(browserTypes, name)) {
    throw new Error(`Unsupported browser "${name}". Choose chromium, firefox, or webkit.`);
  }
  return name;
}

export function launchBrowser(name, options = {}) {
  const browserType = browserTypes[name];
  if (!browserType) throw new Error(`Unsupported browser "${name}". Choose chromium, firefox, or webkit.`);
  const launchOptions = { ...options };
  // Keep headless as Playwright's default unless a browser acceptance run explicitly requests otherwise.
  if (process.env.PW_HEADLESS != null) {
    const headless = process.env.PW_HEADLESS.trim().toLowerCase();
    if (headless === '0' || headless === 'false') launchOptions.headless = false;
    else if (headless === '1' || headless === 'true') launchOptions.headless = true;
    else throw new Error('PW_HEADLESS must be 0/false or 1/true.');
  }
  // E2E scripts pass Chromium rendering flags; other engines must use their own defaults.
  if (name !== 'chromium') delete launchOptions.args;
  // Firefox скрывает локальные ICE-адреса за mDNS; между тестовыми браузерами без разрешения mDNS WebRTC не соединяется (ICE failed)
  if (name === 'firefox') launchOptions.firefoxUserPrefs = { 'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.peerconnection.ice.loopback': true, ...(launchOptions.firefoxUserPrefs || {}) };
  // Managed browser is the default; allow an explicit system-browser override for driver diagnostics.
  if (process.env.PW_EXECUTABLE_PATH) launchOptions.executablePath = process.env.PW_EXECUTABLE_PATH;
  else delete launchOptions.executablePath;
  return browserType.launch(launchOptions);
}

export function projectRoot(moduleUrl) {
  return fileURLToPath(new URL('../', moduleUrl));
}

export function appUrl(moduleUrl, search = '') {
  return new URL(`../dist/index.html${search}`, moduleUrl).href;
}

/** Serve the built app from a local HTTP origin when browser APIs reject file:// origins. */
export async function startLocalAppServer(moduleUrl) {
  const root = fs.realpathSync(path.resolve(projectRoot(moduleUrl), 'dist'));
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  const types = new Map([
    ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'], ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'], ['.wasm', 'application/wasm'], ['.webp', 'image/webp'],
  ]);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end(); return; }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(rootPrefix)) { res.writeHead(403); res.end(); return; }
    fs.realpath(file, (realError, realFile) => {
      if (realError) { res.writeHead(404); res.end(); return; }
      if (!realFile.startsWith(rootPrefix)) { res.writeHead(403); res.end(); return; }
      fs.stat(realFile, (statError, stat) => {
        if (statError || !stat.isFile()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types.get(path.extname(realFile).toLowerCase()) || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(realFile).pipe(res);
      });
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') { await new Promise(resolve => server.close(resolve)); throw new Error('Local app server did not bind a TCP port.'); }
  return { url: `http://127.0.0.1:${address.port}/index.html`, close: () => new Promise(resolve => server.close(resolve)) };
}

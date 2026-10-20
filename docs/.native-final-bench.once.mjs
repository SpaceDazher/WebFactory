// Measure the existing full-duration game benchmark in an isolated native Chrome.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const root = process.cwd();
const label = process.env.V116_BENCH_LABEL || 'combined';
const html = path.resolve(process.env.V116_BENCH_HTML || 'dist/index.html');
const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: exe, headless: false });
try {
  for (const level of [4, 5]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(html).href + `?bench=L${level}&render=webgl&gfx=low`);
    await page.waitForFunction(() => window.__zavod?.bench?.file || (!window.__zavod?.bench?.running && /Замер не удался/.test(window.__zavod?.bench?.text || '')), null, { timeout: 300000, polling: 500 });
    const result = await page.evaluate(() => ({ file: window.__zavod.bench.file, error: window.__zavod.bench.text, mode: window.__zavod.R.mode, note: window.__zavod.R.gpuNote() }));
    const evidence = { label, executablePath: exe, browser: browser.version(), headless: false, forcedGpuFlags: false, url: page.url(), errors, ...result };
    fs.writeFileSync(path.join(root, 'docs', `native-fps-v116-${label}-l${level}.json`), JSON.stringify(evidence, null, 2));
    await page.screenshot({ path: path.join(root, 'docs', `native-fps-v116-${label}-l${level}.png`) });
    console.log(JSON.stringify({ level, label, browser: browser.version(), gpu: result.file?.system.gpu, result: result.file?.result, ok60: result.file?.ok60, errors }));
    if (!result.file || errors.length) process.exitCode = 1;
    await context.close();
  }
} finally { await browser.close(); }

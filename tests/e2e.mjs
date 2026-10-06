import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/usr/local/bin/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1400, height: 850 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto('file:///data/zavod7/dist/index.html');
await p.waitForTimeout(1500);
await p.screenshot({ path: '/data/zavod7/shots/01-start-help.png' });
await p.keyboard.press('Escape');
// walk & mine via real input
await p.keyboard.down('KeyD'); await p.waitForTimeout(600); await p.keyboard.up('KeyD');
await p.waitForTimeout(300);
await p.screenshot({ path: '/data/zavod7/shots/02-world.png' });
await p.keyboard.press('KeyE'); await p.waitForTimeout(400);
await p.screenshot({ path: '/data/zavod7/shots/03-inventory.png' });
await p.keyboard.press('Escape');
console.log(errs.join('\n') || 'no errors');
await b.close();

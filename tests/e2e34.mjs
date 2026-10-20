// First-alpha biomaterials acceptance. Run: node --import tsx tests/e2e34.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../src/sim/game.ts';
import { makeUnit, hitUnit, setCreepIntensity } from '../src/sim/enemies.ts';
import { serialize } from '../src/sim/save.ts';
import { launchBrowser, appUrl, projectRoot } from './browser.mjs';
const root = projectRoot(import.meta.url), out = root + '/integration-logs/v117-alpha4-20261015';
const version = JSON.parse(fs.readFileSync(root + '/package.json', 'utf8')).version;
fs.mkdirSync(out, { recursive: true });
const fixture = new Game(11734, true, { enemies: 'none' });
for (let y = -8; y < 10; y++) for (let x = -9; x < 11; x++) {
  const c = fixture.world.chunkAt(x, y), i = fixture.world.idx(x, y);
  c.terrain[i] = 0; c.res[i] = 0; c.amt[i] = 0; fixture.world.removeDecor(x, y);
}
fixture.player.x = .5; fixture.player.y = .5;
fixture.research.done.add('bio-sampling'); fixture.research.done.add('bio-processing');
fixture.inv.add('bio-sampler', 1); fixture.inv.add('empty-bio-capsule', 8);
fixture.build('transport-belt', 1, 0, 0, false);
hitUnit(fixture, makeUnit(fixture, 'small', 1.5, .5, 'defend'), 100000, -1);
hitUnit(fixture, makeUnit(fixture, 'small', 13.5, .5, 'defend'), 100000, -1);
setCreepIntensity(fixture, 0, 1, 230);
const save = JSON.stringify(serialize(fixture));
const b = await launchBrowser('chromium', { args: ['--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
const W = (p, code) => p.evaluate(c => window.__zavod.workerEval(c), code);
async function poll(p, code, predicate, timeout = 12000) {
  const deadline = Date.now() + timeout;
  do { const result = await W(p, code); if (predicate(result)) return result; await p.waitForTimeout(150); } while (Date.now() < deadline);
  throw Error('Authority timeout: ' + code);
}
async function target(p, x, y) {
  const xy = await p.evaluate(([x,y]) => { const r=__zavod.R,d=r.pixelRatio(); return [(r.W/2+(x-r.camX)*r.s)/d,(r.H/2+(y-r.camY)*r.s)/d]; }, [x,y]);
  await p.mouse.move(...xy); await p.keyboard.press('Alt+KeyB');
}
try {
  for (const [mode, worker, lang] of [['canvas', false, 'ru'], ['webgl', true, 'en']]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(({mode,worker,lang,version}) => { localStorage.setItem('zavod7:seenVersion',version); localStorage.setItem('zavod7:settings',JSON.stringify({simWorker:worker,renderer:mode,lang,tips:false,dayNight:false,leaveGuard:false})); }, {mode,worker,lang,version});
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(mode+': '+e.message));
    await p.goto(appUrl(import.meta.url, worker ? '' : '?local'));
    await p.waitForFunction(() => window.__texMs!=null && window.__zavod && (!__zavod.sim || __zavod.sim.snaps>2), null, {timeout:120000});
    await p.evaluate(async s => { await __zavod.ui.h.loadSaveString(s); __zavod.ui.close(); }, save);
    await poll(p,'return g.bioCorpses.length', x => x===2);
    await p.waitForTimeout(600);
    const state = await p.evaluate(() => ({worker:!!__zavod.sim,renderer:__zavod.R.mode,gl:!!__zavod.R.gameGL()}));
    assert.equal(state.worker,worker); assert.equal(state.renderer,mode); assert.equal(state.gl,worker);
    await p.screenshot({path:out+'/bio-'+mode+'-before.png'});
    await target(p,1.5,.5);
    await poll(p,'return !!g.player.bioSampling',Boolean);
    await p.waitForTimeout(650);
    const hud = await p.locator('#biosample').innerText();
    assert.ok(lang==='ru' ? hud.includes('Проба') : !/[А-Яа-яЁё]/.test(hud),hud);
    await p.screenshot({path:out+'/bio-'+mode+'-sampling.png'});
    await poll(p,"return [g.inv.count('bio-sample-small'), g.inv.count('empty-bio-capsule'),g.bioCorpses[0]?.remainingSamples]",x=>x[0]===1&&x[1]===7&&x[2]===0);
    for (const intensity of [166,102,38,0]) {
      await target(p,.5,1.5);
      await poll(p,'return !!g.player.bioSampling',Boolean);
      await poll(p,'const c=g.world.chunkAt(0,1); return c.creep[g.world.idx(0,1)]',x=>x===intensity);
    }
    const final = await W(p,"return {raw:g.inv.count('raw-slime-capsule'),empty:g.inv.count('empty-bio-capsule'),bodies:g.bioCorpses.length,task:g.player.bioSampling}");
    assert.deepEqual(final,{raw:3,empty:4,bodies:2,task:null});
    await p.screenshot({path:out+'/bio-'+mode+'-after.png'});
    assert.equal(await p.evaluate(()=>__zavod.sim?.errors.length||0),0,'no Worker errors');
    await p.keyboard.press('KeyE');
    await p.screenshot({path:out+'/bio-'+mode+'-inventory.png'});
    console.log('PASS',mode,lang,JSON.stringify({...state,...final}));
    await ctx.close();
  }
  // Exercise real Z7O/Z7A transport and command replication, rather than calling
  // two copies of the sampler directly in a simulation-only test.
  async function peer(name) {
    const c = await b.newContext({viewport:{width:1280,height:800}});
    await c.addInitScript(({name,version}) => {localStorage.setItem('zavod7:seenVersion',version);localStorage.setItem('zavod7:settings',JSON.stringify({simWorker:true,renderer:'canvas',lang:'en',tips:false,mpName:name,leaveGuard:false}));},{name,version});
    const p = await c.newPage(); p.on('pageerror',e=>errors.push(name+': '+e.message));
    await p.goto(appUrl(import.meta.url));
    await p.waitForFunction(()=>window.__texMs!=null&&window.__zavod?.sim?.snaps>2,null,{timeout:120000});
    return {p,c};
  }
  const host=await peer('Bio Host'),guest=await peer('Bio Guest');
  await host.p.evaluate(async s=>{await __zavod.ui.h.loadSaveString(s);__zavod.ui.close();__zavod.ui.toggle('mp');},save);
  await host.p.selectOption('#mpmap','current');await host.p.selectOption('#mpen','none');await host.p.click('[data-act="mphostm"]');
  await host.p.waitForFunction(()=>__zavod.mp.isHost&&__zavod.mp.session?.state==='lobby');
  const offer=await host.p.evaluate(()=>__zavod.mp.makeInvite());assert.ok(offer.startsWith('Z7O'));
  const answer=await guest.p.evaluate(o=>__zavod.mp.answerInvite(o),offer);assert.ok(answer.startsWith('Z7A'));
  await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),answer);
  await guest.p.waitForFunction(()=>__zavod.mp.manual.some(m=>m.phase==='open'));
  await host.p.waitForFunction(()=>__zavod.mp.manual.some(m=>m.phase==='open')&&__zavod.mp.session.players.length===2);
  await guest.p.evaluate(()=>__zavod.mp.session.setReady(true));
  await host.p.locator('[data-act="mpstart"]:enabled').click();
  for(const p of [host.p,guest.p])await p.waitForFunction(()=>__zavod.mp.inGame,null,{timeout:60000});
  await host.p.evaluate(()=>{__zavod.ui.close();__zavod.ui.toggle('menu');});
  await host.p.waitForTimeout(500);
  for(const p of [host.p,guest.p])await W(p,"g.eachPl(()=>{g.player.x=.5;g.player.y=.5;g.inv.add('bio-sampler',g.inv.count('bio-sampler')?0:1);g.inv.add('empty-bio-capsule',g.inv.count('empty-bio-capsule')?0:8);});return g.nPlayers");
  await host.p.evaluate(()=>__zavod.ui.close());await guest.p.evaluate(()=>__zavod.ui.close());
  await Promise.all([host.p,guest.p].map(p=>p.evaluate(()=>__zavod.game.enqueue({t:'bioSample',target:{id:1}}))));
  const getResult="return {left:g.bioCorpses[0]?.remainingSamples,total:g.peers.reduce((s,p)=>s+p.inv.count('bio-sample-small'),0),errors:g.player.dead}";
  const hostResult=await poll(host.p,getResult,r=>r.total===1&&r.left===0,20000);
  const guestResult=await poll(guest.p,getResult,r=>r.total===1&&r.left===0,20000);
  assert.deepEqual(hostResult,guestResult);
  await host.p.evaluate(()=>{__zavod.ui.toggle('menu');});await host.p.waitForTimeout(500);
  const mpState=await Promise.all([host.p,guest.p].map(p=>W(p,"return {tick:g.tick,bodies:g.bioCorpses,players:g.peers.map(p=>({sampling:p.player.bioSampling,empty:p.inv.count('empty-bio-capsule'),sample:p.inv.count('bio-sample-small')}))}")));
  assert.deepEqual(mpState[0],mpState[1]);
  console.log('PASS native Z7O/Z7A two-peer same-body race',JSON.stringify(hostResult),'tick',mpState[0].tick);
  for(const p of [host.p,guest.p])await W(p,'z.enemies.setCreepIntensity(g,0,1,64);return true');
  await host.p.evaluate(()=>__zavod.ui.close());
  await Promise.all([host.p,guest.p].map(p=>p.evaluate(()=>__zavod.game.enqueue({t:'bioSample',target:{x:0,y:1}}))));
  const slimeResult="return {raw:g.peers.reduce((s,p)=>s+p.inv.count('raw-slime-capsule'),0),slime:z.enemies.creepAt(g,0,1),active:g.peers.some(p=>p.player.bioSampling)}";
  for(const p of [host.p,guest.p])assert.deepEqual(await poll(p,slimeResult,r=>r.raw===1&&r.slime===0&&!r.active,20000),{raw:1,slime:0,active:false});
  console.log('PASS native two-peer same-cell slime race consumes only one capsule');
  const late=await peer('Bio Late');
  const lateOffer=await host.p.evaluate(()=>__zavod.mp.makeInvite());
  const lateAnswer=await late.p.evaluate(o=>__zavod.mp.answerInvite(o),lateOffer);
  await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),lateAnswer);
  await late.p.waitForFunction(()=>__zavod.mp.inGame,null,{timeout:60000});
  const joined=await poll(late.p,getResult,r=>r.total===1&&r.left===0,20000);
  assert.deepEqual(joined,hostResult);
  assert.equal(await W(late.p,'return g.nPlayers'),3);
  assert.deepEqual(await W(late.p,slimeResult),{raw:1,slime:0,active:false});
  await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(500);
  const bodies=await Promise.all([host.p,guest.p,late.p].map(p=>W(p,'return g.bioCorpses')));
  assert.deepEqual(bodies[0],bodies[1]);assert.deepEqual(bodies[0],bodies[2]);
  for(const p of [host.p,guest.p,late.p])assert.deepEqual(await p.evaluate(()=>({workerErrors:__zavod.sim.errors.length,reports:__zavod.mp.reports.length})),{workerErrors:0,reports:0});
  console.log('PASS native late join preserves depleted body, source id and original expiry');
  await host.c.close();await guest.c.close();await late.c.close();
  assert.deepEqual(errors,[]); console.log('PASS e2e34: real UI, 3s corpse, 2s slime, drained remains, Canvas, Worker/WebGL and native MP');
} finally { await b.close(); }

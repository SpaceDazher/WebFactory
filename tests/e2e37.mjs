// Alpha4: real powered sanitary flights, filters, film cleanup and native late join.
// Run: npm run e2e -- 37 (the runner supplies the TypeScript loader).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/sim/game.ts';
import {serialize} from '../src/sim/save.ts';
import {makeUnit,hitUnit,setCreepIntensity} from '../src/sim/enemies.ts';
import {rebuildFluids} from '../src/sim/networks.ts';
import {ITEMS} from '../src/data/items.ts';
import {launchBrowser,appUrl,projectRoot} from './browser.mjs';

const root=projectRoot(import.meta.url),out=root+'/integration-logs/v117-alpha4-20261015';
const version=JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
fs.mkdirSync(out,{recursive:true});
const g=new Game(11737,true,{enemies:'none'});
for(let y=-5;y<32;y++)for(let x=-1;x<38;x++){
  const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);
  c.land||=new Set();c.land.add(i);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;c.mods.set(i,0);g.world.removeDecor(x,y);
}
g.player.x=15.5;g.player.y=9.5;
for(const id of ['bio-sampling','bio-processing','bio-fractionation','construction-robotics','automated-bio-collection'])g.research.done.add(id);
g.enabled.add('bio-collection-station');g.enabled.add('sanitary-robot');
function build(id,x,y){const e=g.build(id,x,y,0,false);assert.ok(e,`${id} at ${x},${y}`);return e;}
const station=build('bio-collection-station',8,8);
build('steam-engine',24,3);const steam=build('storage-tank',24,-2);
build('pipe',25,1);build('pipe',25,2);
for(const [x,y]of [[6,6],[18,5]])build('substation',x,y);
g.step();rebuildFluids(g);g.dirtyFluid=false;
const net=g.fluidNets[steam._fn[0]];net.fluid='steam';net.amount=5000;net.se=30;
g.inv.add('empty-bio-capsule',8);g.inv.add('sanitary-robot',2);g.inv.add('bio-sampler',1);
hitUnit(g,makeUnit(g,'small',15.5,9.5,'defend'),100000,-1);
hitUnit(g,makeUnit(g,'spitter',18.5,11.5,'defend'),100000,-1);
const small=g.bioCorpses.find(c=>c.kind==='small'),spitter=g.bioCorpses.find(c=>c.kind==='spitter');
assert.ok(small&&spitter);setCreepIntensity(g,13,15,230);
const save=JSON.stringify(serialize(g));
const fullOutput=JSON.parse(save);
const sampleStack=ITEMS['bio-sample-small'].stack;
fullOutput.ents.find(e=>e.id===station.id).output={'bio-sample-small':sampleStack};
const fullOutputSave=JSON.stringify(fullOutput);
setCreepIntensity(g,13,15,38);const filmSave=JSON.stringify(serialize(g));
const browser=await launchBrowser('chromium',{args:['--enable-unsafe-swiftshader',
  '--disable-features=WebRtcHideLocalIpsWithMdns','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
const W=(p,code)=>p.evaluate(code=>__zavod.workerEval(code),code);
// A new 1.5 MJ robot at a real 30 kW charging spot needs 50 game seconds.
async function poll(p,code,predicate,timeout=80000){
  const end=Date.now()+timeout;let last;
  do{last=await W(p,code);if(predicate(last))return last;await p.waitForTimeout(150);}while(Date.now()<end);
  throw Error(`Authority timeout: ${code}; last=${JSON.stringify(last)}`);
}
async function open(name,mode='canvas',worker=true,lang='en'){
  const c=await browser.newContext({viewport:{width:1280,height:800}});
  await c.addInitScript(o=>{
    localStorage.setItem('zavod7:seenVersion',o.version);
    localStorage.setItem('zavod7:settings',JSON.stringify({simWorker:o.worker,renderer:o.mode,lang:o.lang,
      mpName:o.name,tips:false,leaveGuard:false,dayNight:false}));
  },{name,mode,worker,lang,version});
  const p=await c.newPage();p.on('pageerror',e=>errors.push(`${name}: ${e.message}`));
  await p.goto(appUrl(import.meta.url,worker?'':'?local'));
  await p.waitForFunction(()=>window.__texMs!=null&&window.__zavod&&(!__zavod.sim||__zavod.sim.snaps>2),null,{timeout:120000});
  return {p,c};
}
async function load(p,data=save){
  await p.evaluate(async s=>{await __zavod.ui.h.loadSaveString(s);__zavod.ui.close();},data);
  await poll(p,`return !!g.ents.get(${station.id})`,Boolean);
}
const cmd=(p,c)=>p.evaluate(c=>__zavod.game.enqueue(c),c);
const entity=p=>p.evaluate(id=>{__zavod.ui.close();__zavod.ui.toggle('ent',id);},station.id);
async function put(p,item,count){await cmd(p,{t:'put',id:station.id,item,count});}
const creepCode='const c=g.world.chunkAt(13,15);return c.creep?.[g.world.idx(13,15)]||0';
const read=`const e=g.ents.get(${station.id});return {tick:g.tick,input:e.input,output:e.output,
  status:e.bioStatus,mode:e.bioMode,family:e.bioFamily,
  robots:g.bioRobots.map(r=>({...r})),corpses:g.bioCorpses.map(c=>({id:c.id,left:c.remainingSamples})),
  creep:g.world.chunkAt(13,15).creep?.[g.world.idx(13,15)]||0};`;
async function configure(p,mode,family=''){
  await entity(p);await p.selectOption('#biomode',mode);await p.selectOption('#biofamily',family);
  await poll(p,`const e=g.ents.get(${station.id});return[e.bioMode,e.bioFamily]`,
    s=>s[0]===mode&&(s[1]||'')===family);
}
try{
  for(const [mode,worker,lang]of [['canvas',false,'ru'],['webgl',true,'en']]){
    const {p,c}=await open(mode,mode,worker,lang);await load(p,fullOutputSave);
    assert.deepEqual(await p.evaluate(()=>({mode:__zavod.R.mode,worker:!!__zavod.sim})),{mode,worker});
    await configure(p,'corpses','crawler');
    await put(p,'empty-bio-capsule',8);await put(p,'sanitary-robot',2);
    const blocked=await poll(p,read,s=>s.status==='output-full');
    assert.equal(blocked.corpses.find(c=>c.id===small.id).left,1,'full output cannot consume the last sample');
    assert.equal(blocked.input['empty-bio-capsule'],8,'full output cannot consume a capsule');
    assert.ok(blocked.robots.every(r=>r.phase==='idle'),'full output prevents new dispatch');
    await entity(p);
    await p.locator('[data-act="take"][data-slot="output:bio-sample-small"]').click();
    await poll(p,"return g.inv.count('bio-sample-small')",n=>n===sampleStack);
    await poll(p,'return g.bioRobots.filter(r=>r.phase===\'outbound\').length',n=>n>0);
    await p.waitForFunction(()=>__zavod.game.bioRobots.some(r=>r.phase==='outbound'||r.phase==='sampling'));
    const first=await W(p,'return g.bioRobots.map(r=>({id:r.id,x:r.x,y:r.y,charge:r.charge}))');
    await p.waitForTimeout(450);
    const second=await W(p,'return g.bioRobots.map(r=>({id:r.id,x:r.x,y:r.y,charge:r.charge}))');
    assert.ok(first.some(a=>second.some(b=>b.id===a.id&&Math.hypot(b.x-a.x,b.y-a.y)>.2&&b.charge<a.charge)),
      'a robot actually moves and spends battery');
    await p.evaluate(()=>__zavod.ui.close());
    await p.screenshot({path:out+`/sanitary-${mode}-flight.png`});
    const collected=await poll(p,read,s=>s.output?.['bio-sample-small']===1);
    assert.equal(collected.corpses.find(c=>c.id===small.id).left,0);
    assert.equal(collected.corpses.find(c=>c.id===spitter.id).left,2,'family filter leaves spitter untouched');
    assert.equal(collected.creep,230,'corpses mode leaves slime untouched');
    await configure(p,'all');
    const done=await poll(p,read,s=>s.output?.['bio-sample-spitter']===2&&s.output?.['raw-slime-capsule']===3);
    assert.equal(done.output['bio-sample-small'],1);assert.equal(done.input['empty-bio-capsule'],2);
    assert.ok(done.robots.length<=4,'station cannot launch more than four robots');
    await entity(p);const text=await p.locator('#win').innerText();
    fs.writeFileSync(out+`/sanitary-${mode}-window.txt`,text);
    if(lang==='en')assert.ok(!/[А-Яа-яЁё]/.test(text),'English collection station has no Russian fallback');
    await p.screenshot({path:out+`/sanitary-${mode}-delivered.png`});
    await p.locator('[data-act="take"][data-slot="output:bio-sample-small"]').click();
    await poll(p,"return g.inv.count('bio-sample-small')",n=>n===sampleStack+1);
    await load(p,filmSave);await configure(p,'film');await put(p,'sanitary-robot',1);
    await poll(p,creepCode,n=>n===0);
    assert.equal(await W(p,"return g.inv.count('empty-bio-capsule')"),8,'film cleanup needs no capsule');
    assert.equal(await W(p,`return g.ents.get(${station.id}).output?.['raw-slime-capsule']||0`),0);
    assert.equal(await p.evaluate(()=>__zavod.sim?.errors.length||0),0);
    console.log('PASS powered sanitary flights, family/mode filters, delivery and film',mode,lang,
      JSON.stringify({output:done.output,capsules:done.input['empty-bio-capsule']}));await c.close();
  }
  const host=await open('Sanitary Host'),guest=await open('Sanitary Guest');await load(host.p);
  await host.p.evaluate(()=>__zavod.ui.toggle('mp'));await host.p.selectOption('#mpmap','current');
  await host.p.selectOption('#mpen','none');await host.p.click('[data-act="mphostm"]');
  await host.p.waitForFunction(()=>__zavod.mp.isHost&&__zavod.mp.session?.state==='lobby');
  const offer=await host.p.evaluate(()=>__zavod.mp.makeInvite());
  const answer=await guest.p.evaluate(o=>__zavod.mp.answerInvite(o),offer);
  await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),answer);
  await host.p.waitForFunction(()=>__zavod.mp.manual.some(m=>m.phase==='open')&&__zavod.mp.session.players.length===2);
  await guest.p.evaluate(()=>__zavod.mp.session.setReady(true));await host.p.locator('[data-act="mpstart"]:enabled').click();
  for(const p of [host.p,guest.p])await p.waitForFunction(()=>__zavod.mp.inGame);
  await cmd(host.p,{t:'bioRobotConfig',id:station.id,mode:'corpses',family:'crawler'});
  for(const p of [host.p,guest.p])await poll(p,`return g.ents.get(${station.id}).bioFamily`,f=>f==='crawler');
  await put(host.p,'empty-bio-capsule',1);await put(host.p,'sanitary-robot',1);
  await poll(host.p,'return g.bioRobots.some(r=>r.phase===\'outbound\'||r.phase===\'sampling\')',Boolean);
  await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(400);
  const late=await open('Sanitary Late');
  const lateOffer=await host.p.evaluate(()=>__zavod.mp.makeInvite());
  const lateAnswer=await late.p.evaluate(o=>__zavod.mp.answerInvite(o),lateOffer);
  await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),lateAnswer);
  await host.p.waitForFunction(()=>__zavod.mp.manual.filter(m=>m.phase==='open').length===2);
  await host.p.evaluate(()=>__zavod.ui.close());await late.p.waitForFunction(()=>__zavod.mp.inGame,null,{timeout:60000});
  await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(500);
  const mid=await Promise.all([host.p,guest.p,late.p].map(p=>W(p,read)));
  assert.deepEqual(mid[0],mid[1]);assert.deepEqual(mid[0],mid[2]);
  assert.ok(mid[0].robots.length===1&&mid[0].robots[0].phase!=='idle','late join preserves a real flight/job');
  await host.p.evaluate(()=>__zavod.ui.close());
  await cmd(host.p,{t:'bioSample',target:{id:small.id}});
  for(const p of [host.p,guest.p,late.p]){
    const end=await poll(p,`const e=g.ents.get(${station.id});return {
      total:(e.output?.['bio-sample-small']||0)+g.peers.reduce((s,p)=>s+p.inv.count('bio-sample-small'),0),
      left:g.bioCorpses.find(c=>c.id===${small.id})?.remainingSamples,
      caps:(e.input?.['empty-bio-capsule']||0)+g.peers.reduce((s,p)=>s+p.inv.count('empty-bio-capsule'),0)+g.bioRobots.filter(r=>r.cargo==='empty-bio-capsule').length};`,s=>s.total===1&&s.left===0);
    assert.equal(end.total,1,'manual competition cannot duplicate the sole sample');
    assert.equal(end.caps,7,'the single collected sample consumes exactly one of the eight original capsules');
    assert.deepEqual(await p.evaluate(()=>({errors:__zavod.sim.errors.length,reports:__zavod.mp.reports.length})),{errors:0,reports:0});
  }
  console.log('PASS native sanitary late join preserves battery, cargo and job; manual collection cannot duplicate');
  await host.c.close();await guest.c.close();await late.c.close();assert.deepEqual(errors,[]);
  console.log('PASS e2e37');
}finally{await browser.close();}

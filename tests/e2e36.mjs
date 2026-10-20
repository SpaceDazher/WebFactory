// Alpha3: powered mineral extraction, precision ammunition, mixed linings, native late join.
// Run: npm run e2e -- 36
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/sim/game.ts';
import {RECIPES} from '../src/data/recipes.ts';
import {serialize} from '../src/sim/save.ts';
import {makeUnit} from '../src/sim/enemies.ts';
import {rebuildFluids} from '../src/sim/networks.ts';
import {launchBrowser,appUrl,projectRoot} from './browser.mjs';

const root=projectRoot(import.meta.url), out=root+'/integration-logs/v117-alpha4-20261015';
const version=JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
fs.mkdirSync(out,{recursive:true});
const g=new Game(11736,true,{enemies:'none'});
for(let y=-4;y<32;y++)for(let x=-1;x<41;x++){
  const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);
  c.land||=new Set();c.land.add(i);c.terrain[i]=0;c.amt[i]=0;c.mods.set(i,0);g.world.removeDecor(x,y);
}
g.player.x=16.5;g.player.y=12.5;
for(const id of ['military','military-2','military-3','shotguns','modular-armor','advanced-electronics',
  'chemical-science-pack','production-science-pack','bio-sampling','bio-processing','bio-fractionation',
  'bio-fractionation-2','bio-fractionation-3','bio-ammunition','bio-armor-composites'])g.research.done.add(id);
for(const r of Object.values(RECIPES))g.enabled.add(r.id);
function build(id,x,y){const e=g.build(id,x,y,0,false);assert.ok(e,`${id} at ${x},${y}`);return e;}
function line(y){
  const ex=build('bio-extractor',8,y),water=build('storage-tank',3,y),gel=build('storage-tank',13,y);
  const sludge=build('storage-tank',8,y-5);
  for(const [x,py]of [[6,y+1],[7,y+1],[11,y+1],[12,y+1],[9,y-2],[9,y-1]])build('pipe',x,py);
  return {ex,water,gel,sludge};
}
const mineral=line(8),precision=line(23);
const acid=build('storage-tank',8,13);build('pipe',9,11);build('pipe',9,12);
const armorAsm=build('assembling-machine-2',18,13),ammoAsm=build('assembling-machine-2',18,23);
build('steam-engine',24,3);build('steam-engine',28,3);
const steam=build('storage-tank',24,-2);
for(const [x,y]of [[25,1],[25,2],[26,1],[27,1],[28,1],[29,1],[29,2]])build('pipe',x,y);
for(const [x,y]of [[6,6],[18,5],[26,9],[18,9],[6,21],[18,21]])build('substation',x,y);
g.applyRecipe(mineral.ex,'bio-extract-armored-i');g.applyRecipe(precision.ex,'bio-extract-small-iii');
g.step();rebuildFluids(g);g.dirtyFluid=false;
for(const [tank,fluid,amount]of [[mineral.water,'water',40],[mineral.gel,'bio-gel',16],
  [precision.water,'water',20],[precision.gel,'bio-gel',8],[acid,'sulfuric-acid',10],[steam,'steam',5000]]){
  const n=g.fluidNets[tank._fn[0]];n.fluid=fluid;n.amount=amount;if(fluid==='steam')n.se=30;
}
const speedLining='bio-lining-crawler-iv-equipment',mineralLining='bio-lining-armored-i-equipment';
const precisionAmmo='bio-coated-crawler-iii-shotgun-shell';
for(const [id,n]of [['bio-sample-armored',8],['bio-sample-small',4],['plastic-bar',6],['steel-plate',8],
  ['advanced-circuit',5],['shotgun-shell',10],['combat-shotgun',1],['modular-armor',1],
  ['bio-lining-equipment',1],[speedLining,1]])g.inv.add(id,n);
const target=makeUnit(g,'small',20.5,12.5,'defend');target.hp=1000;
const save=JSON.stringify(serialize(g));
const ids={mineral:mineral.ex.id,precision:precision.ex.id,armorAsm:armorAsm.id,ammoAsm:ammoAsm.id};
const browser=await launchBrowser('chromium',{args:['--enable-unsafe-swiftshader',
  '--disable-features=WebRtcHideLocalIpsWithMdns','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
const W=(p,code)=>p.evaluate(code=>__zavod.workerEval(code),code);
async function poll(p,code,predicate,timeout=35000){
  const end=Date.now()+timeout;let value;
  do{value=await W(p,code);if(predicate(value))return value;await p.waitForTimeout(150);}while(Date.now()<end);
  throw Error(`Authority timeout: ${code}; last=${JSON.stringify(value)}`);
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
async function load(p){
  await p.evaluate(async s=>{await __zavod.ui.h.loadSaveString(s);__zavod.ui.close();},save);
  await poll(p,`return !!g.ents.get(${ids.mineral})`,Boolean);
}
const cmd=(p,c)=>p.evaluate(c=>__zavod.game.enqueue(c),c);
const at=(p,x,y)=>W(p,`g.player.x=${x};g.player.y=${y};return true`);
const entity=(p,id)=>p.evaluate(id=>{__zavod.ui.close();__zavod.ui.toggle('ent',id);},id);
async function choose(p,id,r){await entity(p,id);await p.locator(`[data-act="setrecipe"][data-r="${r}"]`).click();}
async function take(p,id,item){await entity(p,id);await p.locator(`[data-act="take"][data-slot="output:${item}"]`).click();}
async function put(p,id,items){for(const [item,count]of items)await cmd(p,{t:'put',id,item,count});}
const readMineral=`const e=g.ents.get(${ids.mineral});return {
  crafting:!!e.crafting,progress:e.progress||0,fraction:e.output?.['bio-fraction-armored-i']||0,
  caps:e.output?.['empty-bio-capsule']||0,residue:e.output?.['organic-residue']||0,
  acid:g.fluidNetFor(e,'sulfuric-acid','in')?.amount||0,
  sludge:g.fluidNetFor(e,'bio-sludge','out')?.amount||0,
  kit:g.peer(0).player.kit?.grid.map(m=>m.id)||[]};`;
async function moveSixtyTicks(p){
  return W(p,`g.player.x=.5;g.player.y=30.5;const x=g.player.x;
    g.apply({t:'input',mx:1,my:0,mine:null});for(let i=0;i<60;i++)g.step();
    g.apply({t:'input',mx:0,my:0,mine:null});return g.player.x-x;`);
}
try{
  for(const [mode,worker,lang]of [['canvas',false,'ru'],['webgl',true,'en']]){
    const {p,c}=await open(mode,mode,worker,lang);await load(p);
    assert.deepEqual(await p.evaluate(()=>({mode:__zavod.R.mode,worker:!!__zavod.sim})),{mode,worker});
    await p.evaluate(()=>{__zavod.ui.techSel='bio-fractionation-3';__zavod.ui.toggle('tech');});
    await p.screenshot({path:out+`/materials-${mode}-research.png`});
    await at(p,16.5,24.5);await choose(p,ids.precision,'bio-extract-small-iii');
    await put(p,ids.precision,[['bio-sample-small',4]]);
    await poll(p,`return !!g.ents.get(${ids.precision}).crafting`,Boolean);
    await at(p,16.5,12.5);await choose(p,ids.mineral,'bio-extract-armored-i');
    await put(p,ids.mineral,[['bio-sample-armored',8]]);
    await poll(p,readMineral,s=>s.crafting&&s.acid===5);
    await p.screenshot({path:out+`/materials-${mode}-mineral-cycle.png`});
    const produced=await poll(p,readMineral,s=>s.fraction===4);
    assert.deepEqual([produced.caps,produced.residue,produced.acid,produced.sludge],[8,4,0,40]);
    await take(p,ids.mineral,'bio-fraction-armored-i');
    await choose(p,ids.armorAsm,'bio-composite-armored-i');
    await put(p,ids.armorAsm,[['bio-fraction-armored-i',4],['plastic-bar',4],['steel-plate',2]]);
    await at(p,16.5,24.5);
    await poll(p,`return g.ents.get(${ids.precision}).output?.['bio-fraction-crawler-iii']||0`,n=>n===2);
    await take(p,ids.precision,'bio-fraction-crawler-iii');
    await choose(p,ids.ammoAsm,'bio-composite-crawler-iii');
    await put(p,ids.ammoAsm,[['bio-fraction-crawler-iii',2],['plastic-bar',2],['steel-plate',1]]);
    await poll(p,`return g.ents.get(${ids.ammoAsm}).output?.['bio-composite-crawler-iii']||0`,n=>n===1);
    await take(p,ids.ammoAsm,'bio-composite-crawler-iii');
    await choose(p,ids.ammoAsm,'bio-coating-crawler-iii-shotgun-shell');
    await put(p,ids.ammoAsm,[['bio-composite-crawler-iii',1],['shotgun-shell',10]]);
    await at(p,16.5,12.5);
    await poll(p,`return g.ents.get(${ids.armorAsm}).output?.['bio-composite-armored-i']||0`,n=>n===2);
    await take(p,ids.armorAsm,'bio-composite-armored-i');
    await choose(p,ids.armorAsm,mineralLining);
    await put(p,ids.armorAsm,[['bio-composite-armored-i',2],['steel-plate',5],['advanced-circuit',5]]);
    await poll(p,`return g.ents.get(${ids.armorAsm}).output?.['${mineralLining}']||0`,n=>n===1);
    await take(p,ids.armorAsm,mineralLining);
    await at(p,16.5,24.5);
    await poll(p,`return g.ents.get(${ids.ammoAsm}).output?.['${precisionAmmo}']||0`,n=>n===10);
    await take(p,ids.ammoAsm,precisionAmmo);
    await cmd(p,{t:'kit',op:'armor',item:'modular-armor'});
    for(const item of ['bio-lining-equipment',speedLining,mineralLining])await cmd(p,{t:'kit',op:'mod',item});
    await poll(p,'return g.player.kit.grid.length',n=>n===3);
    await p.evaluate(()=>{__zavod.ui.close();__zavod.ui.toggle('gear');});
    const mixed=await p.locator('#win').innerText();
    assert.equal((mixed.match(/неактив|inactive/gi)||[]).length,2,'one active lining across different effects');
    if(lang==='en')assert.ok(!/[А-Яа-яЁё]/.test(mixed),'English gear uses no Russian fallbacks');
    await p.screenshot({path:out+`/materials-${mode}-mixed-linings.png`});
    await p.evaluate(()=>__zavod.ui.close());const baseline=await moveSixtyTicks(p);
    await p.evaluate(()=>__zavod.ui.toggle('gear'));
    await p.locator('[data-act="kunmod"][data-i="0"]').click();
    await poll(p,'return g.player.kit.grid.length',n=>n===2);
    await p.evaluate(()=>__zavod.ui.close());const faster=await moveSixtyTicks(p);
    assert.ok(Math.abs(faster/baseline-1.02)<1e-6,'the active speed lining changes actual movement by +2%');
    await p.evaluate(()=>__zavod.ui.toggle('gear'));
    await p.screenshot({path:out+`/materials-${mode}-speed-active.png`});
    await p.locator('[data-act="kunmod"][data-i="0"]').click();
    await poll(p,'return g.player.kit.grid.length',n=>n===1);
    await p.evaluate(()=>__zavod.ui.close());const restored=await moveSixtyTicks(p);
    assert.ok(Math.abs(restored-baseline)<1e-6,'removing speed restores actual movement');
    const physical=await W(p,"g.player.hp=250;g.player.kit.sh=0;g.hurtPlayer(100,true,false,'phys');return 250-g.player.hp");
    assert.ok(Math.abs(physical-62.51)<1e-6,'active mineral lining applies -6% after modular armor');
    await at(p,16.5,12.5);
    await cmd(p,{t:'kit',op:'gun',slot:0,item:'combat-shotgun'});
    await cmd(p,{t:'kit',op:'ammo',slot:0,item:precisionAmmo});
    await poll(p,'return g.player.kit.ammo[0]?.item',id=>id===precisionAmmo);
    const aim=await p.evaluate(()=>{const r=__zavod.R,d=r.pixelRatio();
      return[(r.W/2+(20.5-r.camX)*r.s)/d,(r.H/2+(12.5-r.camY)*r.s)/d];});
    await p.mouse.move(...aim);await p.keyboard.down('Space');await p.waitForTimeout(120);await p.keyboard.up('Space');
    await poll(p,`return g.units.find(u=>u.id===${target.id})?.hp`,hp=>typeof hp==='number'&&hp<1000);
    assert.equal(await W(p,'return g.player.kit.rt[0]'),precisionAmmo);
    assert.equal(await p.evaluate(()=>__zavod.sim?.errors.length||0),0);
    console.log('PASS mineral/precision factories, mixed linings, actual movement and shotgun',mode,lang,
      JSON.stringify({produced,baseline,faster,restored,physical}));await c.close();
  }
  const host=await open('Mineral Host'),guest=await open('Mineral Guest');await load(host.p);
  await host.p.evaluate(()=>__zavod.ui.toggle('mp'));await host.p.selectOption('#mpmap','current');
  await host.p.selectOption('#mpen','none');await host.p.click('[data-act="mphostm"]');
  await host.p.waitForFunction(()=>__zavod.mp.isHost&&__zavod.mp.session?.state==='lobby');
  const offer=await host.p.evaluate(()=>__zavod.mp.makeInvite());
  const answer=await guest.p.evaluate(o=>__zavod.mp.answerInvite(o),offer);
  await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),answer);
  await host.p.waitForFunction(()=>__zavod.mp.manual.some(m=>m.phase==='open')&&__zavod.mp.session.players.length===2);
  await guest.p.evaluate(()=>__zavod.mp.session.setReady(true));await host.p.locator('[data-act="mpstart"]:enabled').click();
  for(const p of [host.p,guest.p])await p.waitForFunction(()=>__zavod.mp.inGame);
  await cmd(host.p,{t:'kit',op:'armor',item:'modular-armor'});
  for(const item of ['bio-lining-equipment',speedLining])await cmd(host.p,{t:'kit',op:'mod',item});
  await poll(host.p,'return g.peer(0).player.kit.grid.length',n=>n===2);
  await put(host.p,ids.mineral,[['bio-sample-armored',4]]);
  await poll(host.p,readMineral,s=>s.crafting&&s.progress>0&&s.acid===5);
  await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(400);
  const late=await open('Mineral Late');const lateOffer=await host.p.evaluate(()=>__zavod.mp.makeInvite());
  const lateAnswer=await late.p.evaluate(o=>__zavod.mp.answerInvite(o),lateOffer);
  await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),lateAnswer);
  await host.p.waitForFunction(()=>__zavod.mp.manual.filter(m=>m.phase==='open').length===2);
  await host.p.evaluate(()=>__zavod.ui.close());
  await late.p.waitForFunction(()=>__zavod.mp.inGame,null,{timeout:60000});
  await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(500);
  const mid=await Promise.all([host.p,guest.p,late.p].map(p=>W(p,readMineral)));
  assert.deepEqual(mid[0],mid[1]);assert.deepEqual(mid[0],mid[2]);assert.ok(mid[0].crafting&&mid[0].progress>0);
  assert.deepEqual(mid[0].kit,['bio-lining-equipment',speedLining]);
  await host.p.evaluate(()=>__zavod.ui.close());
  for(const p of [host.p,guest.p,late.p]){
    const end=await poll(p,readMineral,s=>s.fraction===2);
    assert.deepEqual([end.fraction,end.caps,end.residue,end.sludge,end.acid],[2,4,2,20,5]);
    assert.deepEqual(await p.evaluate(()=>({errors:__zavod.sim.errors.length,reports:__zavod.mp.reports.length})),{errors:0,reports:0});
  }
  console.log('PASS native mineral late join preserves paid acid, batch, and mixed equipment');
  await host.c.close();await guest.c.close();await late.c.close();assert.deepEqual(errors,[]);
  console.log('PASS e2e36');
}finally{await browser.close();}

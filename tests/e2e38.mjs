// Alpha5: four flyer directions, actual production/equipment and native late join.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/sim/game.ts';
import {RECIPES} from '../src/data/recipes.ts';
import {serialize,deserialize} from '../src/sim/save.ts';
import {makeUnit} from '../src/sim/enemies.ts';
import {rebuildFluids} from '../src/sim/networks.ts';
import {launchBrowser,appUrl,projectRoot} from './browser.mjs';

const root=projectRoot(import.meta.url),out=root+'/integration-logs/v117-alpha5-20261015';
const version=JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
fs.mkdirSync(out,{recursive:true});
const g=new Game(11738,true,{enemies:'none'});
for(let y=-4;y<36;y++)for(let x=-1;x<43;x++){
  const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);
  c.land||=new Set();c.land.add(i);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;c.mods.set(i,0);g.world.removeDecor(x,y);
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
const light=line(8),precision=line(23),acid=build('storage-tank',8,13);
build('pipe',9,11);build('pipe',9,12);
const armorAsm=build('assembling-machine-2',18,13),ammoAsm=build('assembling-machine-2',18,23);
build('steam-engine',24,3);build('steam-engine',28,3);
const steam=build('storage-tank',24,-2);
for(const [x,y]of [[25,1],[25,2],[26,1],[27,1],[28,1],[29,1],[29,2]])build('pipe',x,y);
for(const [x,y]of [[6,6],[18,5],[26,9],[18,9],[6,21],[18,21]])build('substation',x,y);
g.applyRecipe(light.ex,'bio-extract-flyer-i');g.applyRecipe(precision.ex,'bio-extract-flyer-ii');
g.step();rebuildFluids(g);g.dirtyFluid=false;
for(const [tank,fluid,amount]of [[light.water,'water',120],[light.gel,'bio-gel',48],
  [precision.water,'water',20],[precision.gel,'bio-gel',8],[acid,'sulfuric-acid',10],[steam,'steam',5000]]){
  const n=g.fluidNets[tank._fn[0]];n.fluid=fluid;n.amount=amount;if(fluid==='steam')n.se=30;
}
const speed='bio-lining-flyer-i-equipment',energy='bio-lining-flyer-iii-equipment';
const laser='bio-lining-flyer-iv-equipment',ammo='bio-coated-flyer-ii-shotgun-shell';
for(const [id,n]of [['bio-sample-flyer',28],['plastic-bar',14],['steel-plate',22],['advanced-circuit',15],
  ['shotgun-shell',10],['combat-shotgun',1],['modular-armor',1],['energy-shield-equipment',1],
  ['bio-lining-equipment',1]])assert.equal(g.inv.add(id,n),0,`fixture inventory ${id}`);
const target=makeUnit(g,'small',20.5,12.5,'defend');target.hp=1000;
const save=JSON.stringify(serialize(g));
const mp=deserialize(JSON.parse(save));mp.inv.add(energy,1);
mp.apply({t:'kit',op:'armor',item:'modular-armor'});
mp.apply({t:'kit',op:'mod',item:'energy-shield-equipment'});mp.player.kit.en=2e6;
const mpSave=JSON.stringify(serialize(mp));
const ids={light:light.ex.id,precision:precision.ex.id,armorAsm:armorAsm.id,ammoAsm:ammoAsm.id};
const browser=await launchBrowser('chromium',{args:['--enable-unsafe-swiftshader',
  '--disable-features=WebRtcHideLocalIpsWithMdns','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[],W=(p,code)=>p.evaluate(code=>__zavod.workerEval(code),code);
async function poll(p,code,predicate,timeout=40000){
  const end=Date.now()+timeout;let value;
  do{value=await W(p,code);if(predicate(value))return value;await p.waitForTimeout(150);}while(Date.now()<end);
  throw Error(`Authority timeout: ${code}; last=${JSON.stringify(value)}`);
}
async function open(name,mode='canvas',worker=true,lang='en'){
  const c=await browser.newContext({viewport:{width:1280,height:800}});
  await c.addInitScript(o=>{localStorage.setItem('zavod7:seenVersion',o.version);
    localStorage.setItem('zavod7:settings',JSON.stringify({simWorker:o.worker,renderer:o.mode,lang:o.lang,
      mpName:o.name,tips:false,leaveGuard:false,dayNight:false}));},{name,mode,worker,lang,version});
  const p=await c.newPage();p.on('pageerror',e=>errors.push(`${name}: ${e.message}`));
  await p.goto(appUrl(import.meta.url,worker?'':'?local'));
  await p.waitForFunction(()=>window.__texMs!=null&&window.__zavod&&(!__zavod.sim||__zavod.sim.snaps>2),null,{timeout:120000});
  return {p,c};
}
async function load(p,data=save){await p.evaluate(async s=>{await __zavod.ui.h.loadSaveString(s);__zavod.ui.close();},data);await poll(p,`return !!g.ents.get(${ids.light})`,Boolean);}
const cmd=(p,c)=>p.evaluate(c=>__zavod.game.enqueue(c),c);
const entity=(p,id)=>p.evaluate(id=>{__zavod.ui.close();__zavod.ui.toggle('ent',id);},id);
async function choose(p,id,r){await entity(p,id);await p.locator(`[data-act="setrecipe"][data-r="${r}"]`).click();}
async function take(p,id,item){await entity(p,id);await p.locator(`[data-act="take"][data-slot="output:${item}"]`).click();}
async function put(p,id,items){for(const [item,count]of items)await cmd(p,{t:'put',id,item,count});}
const at=(p,x,y)=>W(p,`g.player.x=${x};g.player.y=${y};return true`);
const recipeOutput=(id,item)=>`return g.ents.get(${id}).output?.['${item}']||0`;
const readLight=`const e=g.ents.get(${ids.light}),k=g.peer(0).player.kit;return {
  tick:g.tick,crafting:!!e.crafting,progress:e.progress||0,fraction:e.output?.['bio-fraction-flyer-i']||0,
  caps:e.output?.['empty-bio-capsule']||0,residue:e.output?.['organic-residue']||0,
  sludge:g.fluidNetFor(e,'bio-sludge','out')?.amount||0,
  kit:k?.grid.map(m=>m.id)||[],energy:k?.en||0,shield:k?.sh||0};`;
async function liningFrom(p,tier,item){
  await at(p,16.5,12.5);await choose(p,ids.light,`bio-extract-flyer-${tier}`);
  await put(p,ids.light,[['bio-sample-flyer',8]]);
  await poll(p,recipeOutput(ids.light,`bio-fraction-flyer-${tier}`),n=>n===4);
  await take(p,ids.light,`bio-fraction-flyer-${tier}`);
  await choose(p,ids.armorAsm,`bio-composite-flyer-${tier}`);
  await put(p,ids.armorAsm,[[`bio-fraction-flyer-${tier}`,4],['plastic-bar',4],['steel-plate',2]]);
  await poll(p,recipeOutput(ids.armorAsm,`bio-composite-flyer-${tier}`),n=>n===2);
  await take(p,ids.armorAsm,`bio-composite-flyer-${tier}`);
  await choose(p,ids.armorAsm,item);
  await put(p,ids.armorAsm,[[`bio-composite-flyer-${tier}`,2],['steel-plate',5],['advanced-circuit',5]]);
  await poll(p,recipeOutput(ids.armorAsm,item),n=>n===1);await take(p,ids.armorAsm,item);
}
const move=p=>W(p,`g.player.x=.5;g.player.y=33.5;const x=g.player.x;g.apply({t:'input',mx:1,my:0,mine:null});
  for(let i=0;i<60;i++)g.step();g.apply({t:'input',mx:0,my:0,mine:null});return g.player.x-x;`);
const shieldCost=p=>W(p,`const k=g.player.kit;k.en=100000;k.sh=0;k.shT=-10000;const before=k.en;g.step();return {cost:before-k.en,shield:k.sh};`);
const laserDamage=p=>W(p,`g.player.hp=250;g.player.kit.sh=0;g.hurtPlayer(100,true,false,'laser');return 250-g.player.hp;`);
async function gear(p,lang,label){await p.evaluate(()=>{__zavod.ui.close();__zavod.ui.toggle('gear');});
  const text=await p.locator('#win').innerText();if(lang==='en')assert.ok(!/[А-Яа-яЁё]/.test(text));
  await p.screenshot({path:out+`/flyer-${label}-${lang}.png`});return text;}
try{
  for(const [mode,worker,lang]of [['canvas',false,'ru'],['webgl',true,'en']]){
    const {p,c}=await open(mode,mode,worker,lang);await load(p);
    assert.deepEqual(await p.evaluate(()=>({mode:__zavod.R.mode,worker:!!__zavod.sim})),{mode,worker});
    await at(p,16.5,24.5);await choose(p,ids.precision,'bio-extract-flyer-ii');await put(p,ids.precision,[['bio-sample-flyer',4]]);
    await liningFrom(p,'i',speed);
    await at(p,16.5,24.5);await poll(p,recipeOutput(ids.precision,'bio-fraction-flyer-ii'),n=>n===2);
    await take(p,ids.precision,'bio-fraction-flyer-ii');await choose(p,ids.ammoAsm,'bio-composite-flyer-ii');
    await put(p,ids.ammoAsm,[['bio-fraction-flyer-ii',2],['plastic-bar',2],['steel-plate',1]]);
    await poll(p,recipeOutput(ids.ammoAsm,'bio-composite-flyer-ii'),n=>n===1);await take(p,ids.ammoAsm,'bio-composite-flyer-ii');
    await choose(p,ids.ammoAsm,'bio-coating-flyer-ii-shotgun-shell');await put(p,ids.ammoAsm,[['bio-composite-flyer-ii',1],['shotgun-shell',10]]);
    await liningFrom(p,'iii',energy);await liningFrom(p,'iv',laser);
    // Changing extraction direction returns the previous solid outputs to inventory.
    const production=await W(p,`const e=g.ents.get(${ids.light});return {
      caps:(e.output?.['empty-bio-capsule']||0)+g.inv.count('empty-bio-capsule'),
      residue:(e.output?.['organic-residue']||0)+g.inv.count('organic-residue'),
      sludge:g.fluidNetFor(e,'bio-sludge','out')?.amount||0,
      water:g.fluidNets[g.ents.get(${light.water.id})._fn[0]].amount,
      gel:g.fluidNets[g.ents.get(${light.gel.id})._fn[0]].amount,
      acid:g.fluidNets[g.ents.get(${acid.id})._fn[0]].amount};`);
    assert.deepEqual(production,{caps:24,residue:12,sludge:120,water:0,gel:0,acid:10});
    await p.screenshot({path:out+`/flyer-production-${mode}.png`});
    await cmd(p,{t:'kit',op:'armor',item:'modular-armor'});
    for(const item of ['bio-lining-equipment',speed])await cmd(p,{t:'kit',op:'mod',item});
    await poll(p,'return g.player.kit.grid.length',n=>n===2);
    assert.equal(((await gear(p,lang,'mixed')).match(/неактив|inactive/gi)||[]).length,1);
    await p.evaluate(()=>__zavod.ui.close());const baseline=await move(p);
    await gear(p,lang,'before-speed');await p.locator('[data-act="kunmod"][data-i="0"]').click();
    await poll(p,'return g.player.kit.grid.length',n=>n===1);await p.evaluate(()=>__zavod.ui.close());
    const faster=await move(p);assert.ok(Math.abs(faster/baseline-1.03)<1e-6);
    await gear(p,lang,'speed');await p.locator('[data-act="kunmod"][data-i="0"]').click();
    await poll(p,'return g.player.kit.grid.length',n=>n===0);
    await cmd(p,{t:'kit',op:'mod',item:'energy-shield-equipment'});await poll(p,'return g.player.kit.grid.length',n=>n===1);
    const plainCost=await shieldCost(p);assert.ok(plainCost.cost>0&&plainCost.shield>0);
    await cmd(p,{t:'kit',op:'mod',item:energy});await poll(p,'return g.player.kit.grid.length',n=>n===2);
    const discounted=await shieldCost(p);assert.ok(Math.abs(discounted.cost/plainCost.cost-.96)<1e-9);assert.equal(discounted.shield,plainCost.shield);
    await cmd(p,{t:'kit',op:'mod',item:laser});await poll(p,'return g.player.kit.grid.length',n=>n===3);
    assert.equal(((await gear(p,lang,'energy')).match(/неактив|inactive/gi)||[]).length,1);
    const plainLaser=await laserDamage(p);await p.locator('[data-act="kunmod"][data-i="1"]').click();
    await poll(p,'return g.player.kit.grid.length',n=>n===2);
    const protectedLaser=await laserDamage(p);assert.ok(Math.abs(protectedLaser/plainLaser-.96)<1e-9);
    await gear(p,lang,'laser');await at(p,16.5,24.5);
    await poll(p,recipeOutput(ids.ammoAsm,ammo),n=>n===10);await take(p,ids.ammoAsm,ammo);
    await cmd(p,{t:'kit',op:'gun',slot:0,item:'combat-shotgun'});await cmd(p,{t:'kit',op:'ammo',slot:0,item:ammo});
    await poll(p,'return g.player.kit.ammo[0]?.item',id=>id===ammo);await p.evaluate(()=>__zavod.ui.close());await at(p,16.5,12.5);
    // Await the rendered authority position before mapping the world target to mouse pixels.
    await p.waitForFunction(()=>Math.abs(__zavod.R.camX-16.5)<.05&&Math.abs(__zavod.R.camY-12.5)<.05);
    const aim=await p.evaluate(()=>{const r=__zavod.R,d=r.pixelRatio();return[(r.W/2+(20.5-r.camX)*r.s)/d,(r.H/2+(12.5-r.camY)*r.s)/d];});
    await p.mouse.move(...aim);await p.keyboard.down('Space');await p.waitForTimeout(120);await p.keyboard.up('Space');
    await poll(p,`return g.units.find(u=>u.id===${target.id})?.hp`,hp=>typeof hp==='number'&&hp<1000);
    assert.equal(await W(p,'return g.player.kit.rt[0]'),ammo);assert.equal(await p.evaluate(()=>__zavod.sim?.errors.length||0),0);
    console.log('PASS all flyer factory branches, real movement/energy/laser and shotgun',mode,lang,
      JSON.stringify({production,baseline,faster,plainCost,discounted,plainLaser,protectedLaser}));await c.close();
  }
  const host=await open('Flyer Host'),guest=await open('Flyer Guest');await load(host.p,mpSave);
  await host.p.evaluate(()=>__zavod.ui.toggle('mp'));await host.p.selectOption('#mpmap','current');await host.p.selectOption('#mpen','none');
  await host.p.click('[data-act="mphostm"]');await host.p.waitForFunction(()=>__zavod.mp.isHost&&__zavod.mp.session?.state==='lobby');
  const offer=await host.p.evaluate(()=>__zavod.mp.makeInvite()),answer=await guest.p.evaluate(o=>__zavod.mp.answerInvite(o),offer);
  await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),answer);await host.p.waitForFunction(()=>__zavod.mp.manual.some(m=>m.phase==='open')&&__zavod.mp.session.players.length===2);
  await guest.p.evaluate(()=>__zavod.mp.session.setReady(true));await host.p.locator('[data-act="mpstart"]:enabled').click();
  for(const p of [host.p,guest.p])await p.waitForFunction(()=>__zavod.mp.inGame);
  await cmd(host.p,{t:'kit',op:'mod',item:energy});await poll(host.p,'return g.peer(0).player.kit.grid.length',n=>n===2);
  await put(host.p,ids.light,[['bio-sample-flyer',4]]);await poll(host.p,readLight,s=>s.crafting&&s.progress>0);
  await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(400);
  const late=await open('Flyer Late'),lateOffer=await host.p.evaluate(()=>__zavod.mp.makeInvite());
  const lateAnswer=await late.p.evaluate(o=>__zavod.mp.answerInvite(o),lateOffer);await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),lateAnswer);
  await host.p.waitForFunction(()=>__zavod.mp.manual.filter(m=>m.phase==='open').length===2);await host.p.evaluate(()=>__zavod.ui.close());
  await late.p.waitForFunction(()=>__zavod.mp.inGame,null,{timeout:60000});await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(500);
  const mid=await Promise.all([host.p,guest.p,late.p].map(p=>W(p,readLight)));
  assert.deepEqual(mid[0],mid[1]);assert.deepEqual(mid[0],mid[2]);assert.ok(mid[0].crafting&&mid[0].progress>0);
  assert.deepEqual(mid[0].kit,['energy-shield-equipment',energy]);await host.p.evaluate(()=>__zavod.ui.close());
  for(const p of [host.p,guest.p,late.p]){
    const end=await poll(p,readLight,s=>s.fraction===2);assert.deepEqual([end.fraction,end.caps,end.residue,end.sludge],[2,4,2,20]);
    assert.deepEqual(await p.evaluate(()=>({errors:__zavod.sim.errors.length,reports:__zavod.mp.reports.length})),{errors:0,reports:0});
  }
  console.log('PASS native flyer late join preserves in-flight batch and energy equipment');
  await host.c.close();await guest.c.close();await late.c.close();assert.deepEqual(errors,[]);console.log('PASS e2e38');
}finally{await browser.close();}

// Alpha2: real factory networks, UI, equipment and native manual-code late join.
// Run: npm run e2e -- 35
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Game} from '../src/sim/game.ts';
import {RECIPES} from '../src/data/recipes.ts';
import {serialize} from '../src/sim/save.ts';
import {makeUnit,UNITS} from '../src/sim/enemies.ts';
import {rebuildFluids} from '../src/sim/networks.ts';
import {launchBrowser,appUrl,projectRoot} from './browser.mjs';
const root=projectRoot(import.meta.url),out=root+'/integration-logs/v117-alpha4-20261015';
const version=JSON.parse(fs.readFileSync(root+'/package.json','utf8')).version;
fs.mkdirSync(out,{recursive:true});
const g=new Game(11735,true,{enemies:'none'});
for(let y=-4;y<24;y++)for(let x=-1;x<30;x++){
  const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);c.land||=new Set();c.land.add(i);c.terrain[i]=0;c.amt[i]=0;c.mods.set(i,0);g.world.removeDecor(x,y);
}
g.player.x=16.5;g.player.y=12.5;
for(const id of ['bio-sampling','bio-processing','bio-fractionation','bio-ammunition','bio-armor-composites','military','military-3','modular-armor'])g.research.done.add(id);
for(const r of Object.values(RECIPES))g.enabled.add(r.id);
function build(id,x,y){const e=g.build(id,x,y,0,false);assert.ok(e,`${id} at ${x},${y}`);return e;}
const ex=build('bio-extractor',8,8),asm=build('assembling-machine-2',18,13),chem=build('chemical-plant',3,0);
const wt=build('storage-tank',3,8),gt=build('storage-tank',13,8),at=build('storage-tank',8,13),st=build('storage-tank',8,3);
for(const [x,y]of [[6,9],[7,9],[11,9],[12,9],[9,11],[9,12],[9,6],[9,7],[3,3],[3,4],[4,4],[5,4],[6,4],[7,4]])build('pipe',x,y);
build('steam-engine',24,3);const steam=build('storage-tank',24,-2);build('pipe',25,1);build('pipe',25,2);
for(const [x,y]of [[6,6],[18,5],[18,9]])build('substation',x,y);
g.applyRecipe(ex,'bio-extract-small-ii');g.step();rebuildFluids(g);g.dirtyFluid=false;
for(const [tank,fluid,n]of [[wt,'water',20],[gt,'bio-gel',8],[at,'sulfuric-acid',5],[steam,'steam',5000]]){
  const net=g.fluidNets[tank._fn[0]];net.fluid=fluid;net.amount=n;if(fluid==='steam')net.se=30;
}
for(const [id,n]of [['bio-sample-small',4],['plastic-bar',2],['steel-plate',1],['firearm-magazine',10],['stone',1],['organic-residue',3],['modular-armor',1],['bio-lining-equipment',2],['pistol',1]])g.inv.add(id,n);
const target=makeUnit(g,'small',26.5,12.5,'defend');
const save=JSON.stringify(serialize(g));
const recipeFor=id=>Object.values(RECIPES).find(r=>r.out.some(([it])=>it===id))?.id;
const ids={ex:ex.id,asm:asm.id,chem:chem.id,coating:recipeFor('bio-coated-firearm-magazine'),neutral:recipeFor('inert-waste'),dispose:Object.values(RECIPES).find(r=>!r.out.length&&r.in.some(([it])=>it==='organic-residue'))?.id};
assert.ok(ids.coating&&ids.neutral&&ids.dispose,'real processing recipes registered');
const browser=await launchBrowser('chromium',{args:['--enable-unsafe-swiftshader','--disable-features=WebRtcHideLocalIpsWithMdns','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=[];
const W=(p,s)=>p.evaluate(code=>__zavod.workerEval(code),s);
async function poll(p,s,predicate,timeout=25000){const end=Date.now()+timeout;do{const r=await W(p,s);if(predicate(r))return r;await p.waitForTimeout(150);}while(Date.now()<end);throw Error('Authority timeout: '+s);}
async function open(name,mode='canvas',worker=true,lang='en'){
 const c=await browser.newContext({viewport:{width:1280,height:800}});
 await c.addInitScript(o=>{localStorage.setItem('zavod7:seenVersion',o.version);localStorage.setItem('zavod7:settings',JSON.stringify({simWorker:o.worker,renderer:o.mode,lang:o.lang,mpName:o.name,tips:false,leaveGuard:false,dayNight:false}));},{name,mode,worker,lang,version});
 const p=await c.newPage();p.on('pageerror',e=>errors.push(name+': '+e.message));await p.goto(appUrl(import.meta.url,worker?'':'?local'));
 await p.waitForFunction(()=>window.__texMs!=null&&window.__zavod&&(!__zavod.sim||__zavod.sim.snaps>2),null,{timeout:120000});return {p,c};
}
const load=async p=>{await p.evaluate(async s=>{await __zavod.ui.h.loadSaveString(s);__zavod.ui.close();},save);await poll(p,`return !!g.ents.get(${ids.ex})`,Boolean);};
const cmd=(p,c)=>p.evaluate(c=>__zavod.game.enqueue(c),c);
const entity=(p,id)=>p.evaluate(id=>{__zavod.ui.close();__zavod.ui.toggle('ent',id);},id);
async function choose(p,id,recipe){await entity(p,id);await p.locator(`[data-act="setrecipe"][data-r="${recipe}"]`).click();}
async function take(p,id,item){await entity(p,id);await p.locator(`[data-act="take"][data-slot="output:${item}"]`).click();}
const readExtraction=`const e=g.ents.get(${ids.ex});return {crafting:!!e.crafting,progress:e.progress||0,fraction:e.output?.['bio-fraction-crawler-ii']||0,capsules:e.output?.['empty-bio-capsule']||0,residue:e.output?.['organic-residue']||0,sludge:Math.round(g.fluidNetFor(e,'bio-sludge','out')?.amount||0),acid:Math.round(g.fluidNetFor(e,'sulfuric-acid','in')?.amount||0)};`;
try{
 for(const [mode,worker,lang]of [['canvas',false,'ru'],['webgl',true,'en']]){
  const {p,c}=await open(mode,mode,worker,lang);await load(p);
  assert.deepEqual(await p.evaluate(()=>({mode:__zavod.R.mode,worker:!!__zavod.sim})),{mode,worker});
  await p.evaluate(()=>{__zavod.ui.techSel='bio-fractionation';__zavod.ui.close();__zavod.ui.toggle('tech');});
  await p.screenshot({path:out+'/chain-'+mode+'-research.png'});
  await choose(p,ids.ex,'bio-extract-small-ii');await cmd(p,{t:'put',id:ids.ex,item:'bio-sample-small',count:4});
  await poll(p,`return g.ents.get(${ids.ex}).status`,s=>s==='working');
  await p.locator(`[data-act="setrecipe"][data-r="${ids.dispose}"]`).click();
  await p.getByText(lang==='en'?'The current bio cycle will finish before the recipe changes':'Текущий биоцикл завершится перед сменой рецепта',{exact:true}).waitFor();
  assert.equal(await W(p,`return g.ents.get(${ids.ex}).recipe`),'bio-extract-small-ii','the UI cannot cancel a paid extraction batch');
  await p.screenshot({path:out+'/chain-'+mode+'-extracting.png'});
  const extracted=await poll(p,readExtraction,s=>s.fraction===2);
  assert.deepEqual([extracted.capsules,extracted.residue,extracted.sludge,extracted.acid],[4,2,20,5]);
  await take(p,ids.ex,'bio-fraction-crawler-ii');await choose(p,ids.asm,'bio-composite-crawler-ii');
  for(const [item,count]of [['bio-fraction-crawler-ii',2],['plastic-bar',2],['steel-plate',1]])await cmd(p,{t:'put',id:ids.asm,item,count});
  await poll(p,`return g.ents.get(${ids.asm}).output?.['bio-composite-crawler-ii']||0`,n=>n===1);
  await take(p,ids.asm,'bio-composite-crawler-ii');await choose(p,ids.asm,ids.coating);
  for(const [item,count]of [['bio-composite-crawler-ii',1],['firearm-magazine',10]])await cmd(p,{t:'put',id:ids.asm,item,count});
  await poll(p,`return g.ents.get(${ids.asm}).output?.['bio-coated-firearm-magazine']||0`,n=>n===10);
  await take(p,ids.asm,'bio-coated-firearm-magazine');
  await W(p,'g.player.x=6.5;g.player.y=2.5;return true');
  await choose(p,ids.chem,ids.neutral);await cmd(p,{t:'put',id:ids.chem,item:'stone',count:1});
  await poll(p,`return g.ents.get(${ids.chem}).output?.['inert-waste']||0`,n=>n===1);
  await W(p,'g.player.x=16.5;g.player.y=12.5;return true');
  await take(p,ids.ex,'organic-residue');await choose(p,ids.ex,ids.dispose);
  await p.screenshot({path:out+'/chain-'+mode+'-disposal.png'});
  await cmd(p,{t:'put',id:ids.ex,item:'organic-residue',count:5});
  await poll(p,"return g.stats.consumed['organic-residue']||0",n=>n===5);
  await poll(p,`return !!g.ents.get(${ids.ex}).crafting`,v=>!v);
  const acidAfterSwap=await W(p,`return g.fluidNetFor(g.ents.get(${ids.ex}),'sulfuric-acid','in')?.amount`);
  assert.ok(Math.abs(acidAfterSwap-5)<1e-6,'recipe changes preserve all acid in unchanged fixed ports');
  await cmd(p,{t:'kit',op:'armor',item:'modular-armor'});
  for(let i=0;i<2;i++)await cmd(p,{t:'kit',op:'mod',item:'bio-lining-equipment'});
  await poll(p,'return g.player.kit.grid.length',n=>n===2);
  await p.evaluate(()=>{__zavod.ui.close();__zavod.ui.toggle('gear');});
  const gearText=await p.locator('#win').innerText();assert.match(gearText,/неактив|inactive/i,'second lining is visibly inactive');
  if(lang==='en')assert.ok(!/[А-Яа-яЁё]/.test(gearText),'English equipment window has no Russian fallback');
  await p.screenshot({path:out+'/chain-'+mode+'-gear.png'});
  assert.equal(await W(p,"return g.inv.count('bio-coated-firearm-magazine')"),10);
  assert.equal(await W(p,"return g.inv.count('empty-bio-capsule')+[...g.ents.values()].reduce((s,e)=>s+(e.output?.['empty-bio-capsule']||0)+(e.input?.['empty-bio-capsule']||0),0)"),4,'recipe changes preserve all returned capsules');
  await p.evaluate(()=>__zavod.ui.close());
  await cmd(p,{t:'kit',op:'gun',slot:0,item:'pistol'});await cmd(p,{t:'kit',op:'ammo',slot:0,item:'bio-coated-firearm-magazine'});
  await poll(p,"return g.player.kit.ammo[0]?.item",id=>id==='bio-coated-firearm-magazine');
  const aim=await p.evaluate(()=>{const r=__zavod.R,d=r.pixelRatio();return[(r.W/2+(26.5-r.camX)*r.s)/d,(r.H/2+(12.5-r.camY)*r.s)/d];});
  await p.mouse.move(...aim);await p.keyboard.down('Space');await p.waitForTimeout(120);await p.keyboard.up('Space');
  await poll(p,`return g.units.find(u=>u.id===${target.id})?.hp`,hp=>typeof hp==='number'&&hp<UNITS.small.hp);
  assert.equal(await W(p,'return g.player.kit.rt[0]'),'bio-coated-firearm-magazine');
  assert.equal(await p.evaluate(()=>__zavod.sim?.errors.length||0),0);
  console.log('PASS powered real-pipe chain',mode,lang,JSON.stringify(extracted));await c.close();
 }
 const host=await open('Chain Host'),guest=await open('Chain Guest');await load(host.p);
 await host.p.evaluate(()=>__zavod.ui.toggle('mp'));await host.p.selectOption('#mpmap','current');await host.p.selectOption('#mpen','none');await host.p.click('[data-act="mphostm"]');
 await host.p.waitForFunction(()=>__zavod.mp.isHost&&__zavod.mp.session?.state==='lobby');
 const offer=await host.p.evaluate(()=>__zavod.mp.makeInvite());const answer=await guest.p.evaluate(o=>__zavod.mp.answerInvite(o),offer);await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),answer);
 await host.p.waitForFunction(()=>__zavod.mp.manual.some(m=>m.phase==='open')&&__zavod.mp.session.players.length===2);await guest.p.evaluate(()=>__zavod.mp.session.setReady(true));await host.p.locator('[data-act="mpstart"]:enabled').click();
 for(const p of [host.p,guest.p])await p.waitForFunction(()=>__zavod.mp.inGame);
 await cmd(host.p,{t:'put',id:ids.ex,item:'bio-sample-small',count:4});await poll(host.p,readExtraction,s=>s.crafting&&s.progress>0);
 await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(400);
 const late=await open('Chain Late');const lateOffer=await host.p.evaluate(()=>__zavod.mp.makeInvite());const lateAnswer=await late.p.evaluate(o=>__zavod.mp.answerInvite(o),lateOffer);await host.p.evaluate(a=>__zavod.mp.acceptAnswer(a),lateAnswer);
 await host.p.waitForFunction(()=>__zavod.mp.manual.filter(m=>m.phase==='open').length===2);
 // The authoritative join is a simulation command: allow ticks after ICE connects.
 await host.p.evaluate(()=>__zavod.ui.close());await late.p.waitForFunction(()=>__zavod.mp.inGame,null,{timeout:60000});
 await host.p.evaluate(()=>__zavod.ui.toggle('menu'));await host.p.waitForTimeout(500);
 const mid=await Promise.all([host.p,guest.p,late.p].map(p=>W(p,readExtraction)));assert.deepEqual(mid[0],mid[1]);assert.deepEqual(mid[0],mid[2]);assert.ok(mid[0].crafting&&mid[0].progress>0);
 await host.p.evaluate(()=>__zavod.ui.close());const end=await Promise.all([host.p,guest.p,late.p].map(p=>poll(p,readExtraction,s=>s.fraction===2)));for(const r of end)assert.deepEqual([r.fraction,r.capsules,r.residue,r.sludge,r.acid],[2,4,2,20,5]);
 for(const p of [host.p,guest.p,late.p])assert.deepEqual(await p.evaluate(()=>({worker:__zavod.sim.errors.length,reports:__zavod.mp.reports.length})),{worker:0,reports:0});
 console.log('PASS native Z7O/Z7A late join during powered extraction; quantities match');
 await host.c.close();await guest.c.close();await late.c.close();assert.deepEqual(errors,[]);
 console.log('PASS e2e35');
}finally{await browser.close();}

import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { PROTOS } from '../src/data/entities';
import { ITEMS } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { TECHS } from '../src/data/techs';
import { R_URAN } from '../src/sim/world';
import { fluidConns } from '../src/sim/networks';
import { serialize, deserialize } from '../src/sim/save';
import { newScenario, canonScn, scnToText } from '../src/sim/scenario';
import { Coop } from './mpharness';
const id = 'uranium-mining-drill';
const steps = (g: Game, n: number) => { for (let i=0;i<n;i++) g.step(); };
function fresh() {
  const g = new Game(3, true, { enemies:'none' }); g.freePower=true;
  for(let y=390;y<410;y++)for(let x=390;x<410;x++){const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;g.world.removeDecor(x,y);}
  return g;
}
function ore(g:Game,x:number,y:number,r:number){const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);c.res[i]=r;c.amt[i]=100;c.version++;}
(async()=>{
assert(PROTOS[id] && ITEMS[id] && RECIPES[id], 'dedicated drill entity/item/recipe exist');
assert.equal(PROTOS[id].compat15,false); assert.equal(ITEMS[id].compat15,false); assert.equal(RECIPES[id].compat15,false);
assert.equal(PROTOS[id].fr,'uranium-drill'); assert.equal(PROTOS[id].hp,350);
assert(TECHS['uranium-processing'].unlocks.includes(id)); assert.equal(RECIPES[id].enabled,false);
const locked=fresh(); assert(!locked.enabled.has(id)); ore(locked,400,400,R_URAN); assert(!locked.build(id,399,399,0,false));
const old=fresh(); old.research.done.add('uranium-processing'); for(const r of TECHS['uranium-processing'].unlocks) if(r!==id) old.enabled.add(r); old.enabled.delete(id);
const migrated=deserialize(serialize(old)); assert(migrated.enabled.has(id),'old researched save receives just the new unlock');
assert.deepEqual([...migrated.enabled].filter(x=>x!==id).sort(), [...old.enabled].sort(), 'migration preserves other permissions');
assert(!deserialize(serialize(locked)).enabled.has(id), 'unresearched save stays locked');
const craft=fresh(); craft.research.done.add('uranium-processing'); craft.enabled.add(id);
for(const [it,n] of RECIPES[id].in)craft.inv.add(it,n);
craft.queueCraft(id,1); steps(craft,310); assert.equal(craft.inv.count(id),1,'craft produces new drill');
for(let d=0;d<4;d++){
 const g=fresh();g.research.done.add('uranium-processing');g.enabled.add(id);ore(g,399,399,1);ore(g,400,400,R_URAN);
 assert(!g.minable(id,399,399));assert(g.minable(id,400,400));assert(g.minable('electric-mining-drill',399,399));
 const dr=g.build(id,399,399,d as any,false)!;assert(dr);
 const cn=fluidConns(dr,0)[0],dx=[0,1,0,-1][cn.d],dy=[-1,0,1,0][cn.d];const pipe=g.build('pipe',cn.x+dx,cn.y+dy,0,false)!;assert(pipe);
 const out=g.drillOut(dr);const chest=g.build('wooden-chest',out.x,out.y,0,false)!;assert(chest);
 g.dirtyFluid=true;steps(g,150);assert.equal(dr.status,'no-acid');assert.equal(g.world.amt(399,399),100);assert.equal(g.world.amt(400,400),100);
 assert.equal(dr._fn![0],pipe._fn![0],'acid pipe connects in every orientation');
 const net=g.fluidNets[dr._fn![0]];net.fluid='water';net.amount=10;steps(g,2);assert.equal(g.world.amt(400,400),100,'wrong fluid cannot mine');
 net.fluid='sulfuric-acid';net.amount=10;
 steps(g,2);assert.equal(chest.inv!.count('uranium-ore'),1);assert.equal(net.amount,9);assert.equal(g.world.amt(400,400),99);assert.equal(g.world.amt(399,399),100);
 const restored=deserialize(serialize(g));assert.equal(restored.ents.get(dr.id)?.proto,id);assert.equal(restored.ents.get(dr.id)?.dir,d);
 const uc=g.world.chunkAt(400,400);uc.amt[g.world.idx(400,400)]=0;steps(g,130);assert.equal(dr.status,'no-ore');assert.equal(g.world.amt(399,399),100,'depleted uranium never falls back to iron');
}
const mixed=fresh(); mixed.research.done.add('uranium-processing');ore(mixed,400,400,1);assert(!mixed.build(id,399,399,0,false),'cannot place on ordinary ore only');
const sc=newScenario('uranium-drill-test','test');sc.fmt=2;sc.rules.startItems={[id]:1};assert.equal(canonScn(sc)!.rules.startItems![id],1);
sc.map.ents.push({proto:id,x:0,y:0,dir:0});assert.equal(JSON.parse(scnToText(sc)).fmt,2,'export upgrades scenario containing uranium drill to fmt2');
const g=new Game(3,true,{enemies:'none'});g.research.done.add('uranium-processing');g.enabled.add(id);
const ux=Math.round(g.world.uranium.x),uy=Math.round(g.world.uranium.y);
for(let y=uy-3;y<=uy+3;y++)for(let x=ux-3;x<=ux+3;x++)g.world.removeDecor(x,y);
const mpDrill=g.build(id,ux-1,uy-1,0,false)!;assert(mpDrill);
const mpPort=fluidConns(mpDrill,0)[0];const mpPipe=g.build('pipe',mpPort.x,mpPort.y+1,0,false)!;assert(mpPipe);
const mpOut=g.drillOut(mpDrill);const mpChest=g.build('wooden-chest',mpOut.x,mpOut.y,0,false)!;assert(mpChest);
g.dirtyFluid=true;steps(g,1);const mpAcid=g.fluidNets[mpDrill._fn![0]];mpAcid.fluid='sulfuric-acid';mpAcid.amount=100;
const coop=new Coop({n:2,pingMs:20,loss:0,seed:3,game:g,map:'current',kbps:20000});await coop.start();for(const peer of coop.live())peer.g.freePower=true;coop.advance(6000);
assert.equal(coop.live().length,2,'both multiplayer peers are live');
for(const peer of coop.live()){
 const dr=peer.g.ents.get(mpDrill.id)!;assert.equal(dr.proto,id);
 const produced=peer.g.ents.get(mpChest.id)!.inv!.count('uranium-ore');assert(produced>=2,'each peer actively mines uranium: '+JSON.stringify({produced,tick:peer.g.tick,status:dr.status,power:peer.g.freePower,ore:peer.g.world.amt(ux,uy),net:peer.g.fluidNets[dr._fn![0]]}));
 assert.equal(dr._fn![0],peer.g.ents.get(mpPipe.id)!._fn![0]);
 assert(Math.abs(peer.g.fluidNets[dr._fn![0]].amount-(100-produced))<1e-6,'each peer consumes acid 1:1');
 assert.equal(peer.session.desyncs,0);assert.equal(peer.reports.length,0);
}
assert(coop.sameState().ok,'active multiplayer mining has identical common-tick hashes');
console.log('PASS uranium drill: unlock/craft/mixed ores/acid 1:1/4 ports/save/scenario/multiplayer');
})().catch(e=>{console.error(e);process.exit(1)});

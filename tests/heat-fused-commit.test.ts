import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
let g=new Game(1160701,true,{enemies:'none'});g.batchBuild=true;
for(let y=90;y<125;y++)for(let x=90;x<125;x++){
 const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;if(c.decor[i])g.world.removeDecor(x,y);
}
for(let y=100;y<110;y++)for(let x=100;x<110;x++){
 const e=g.build('heat-pipe',x,y,0,false)!;assert.ok(e);e.hE=(1+(x+y)%7)*30_000_000;
}
g.batchBuild=false;
const initial=JSON.parse(JSON.stringify(serialize(g)));g=deserialize(JSON.parse(JSON.stringify(initial)));const clone=deserialize(JSON.parse(JSON.stringify(initial)));
const writes=new Map<number,number>();
for(const e of g.ents.values()){
 let energy=e.hE;Object.defineProperty(e,'hE',{enumerable:true,configurable:true,get:()=>energy,set:value=>{energy=value;writes.set(e.id,(writes.get(e.id)||0)+1);}});
}
g.step();clone.step();
assert.ok((g.nuc.st.lost||0)>0,'real pipe loss occurred');
assert.ok(g._heat!.flowJ.some(x=>x>0),'real positive edge flows occurred');
assert.ok([...g.ents.values()].some(e=>e.hE !==initial.ents.find((old:any)=>old.id===e.id)?.hE),'real thermal update occurred');
assert.equal(stateHash(g),stateHash(clone));assert.deepEqual(serialize(g),serialize(clone));assert.deepEqual(g.nuc,clone.nuc);
assert.equal(writes.size,100);
assert.ok([...writes.values()].every(n=>n===1),'transfer plus positive pipe loss commits each pipe exactly once');
for(const e of g.ents.values()){const energy=e.hE;Object.defineProperty(e,'hE',{enumerable:true,configurable:true,writable:true,value:energy});}
for(let i=0;i<80;i++){g.step();clone.step();assert.equal(stateHash(g),stateHash(clone));assert.deepEqual(g.nuc,clone.nuc);}
// A formerly active buffer must not affect a later no-flow tick.
for(const game of [g,clone])for(const e of game.ents.values()){e.hE=0;e.hL=0;}
g.step();clone.step();assert.equal(stateHash(g),stateHash(clone));for(const e of g.ents.values())assert.equal(e.hE,0);
console.log('✔ fused heat commit: real flow/loss, one pipe write, complete replay and no stale flags on a no-flow tick');

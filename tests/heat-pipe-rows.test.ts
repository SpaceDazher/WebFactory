import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { heatNet } from '../src/sim/heat';
const g = new Game(1160602, true, { enemies: 'none' });
g.batchBuild = true;
for (let y = 90; y < 130; y++) for (let x = 90; x < 130; x++) {
  const c = g.world.chunkAt(x,y), i = g.world.idx(x,y);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;
  if(c.decor[i])g.world.removeDecor(x,y);
}
for(let y=100;y<110;y++)for(let x=100;x<110;x++) {
 const e=g.build('heat-pipe',x,y,0,false)!;assert.ok(e);e.hE=(1+(x+y)%9)*30_000_000;
}
g.batchBuild=false;
const old=heatNet(g), page=old.storage.blocks.get(old.storage.keys[0])! as any;
assert.ok(Array.isArray(page.pipes),'touched pages store canonical pipe references');
const oldIds=page.pipes.map((e:any)=>e.id);
for(const p of old.storage.blocks.values())for(const node of p)if(node){
 const entity=node.entity;
 Object.defineProperty(node,'entity',{configurable:true,get(){throw new Error('pipe losses traversed topology node metadata');}});
 (node as any)._testEntity=entity;
}
assert.doesNotThrow(()=>g.step(),'pipe loss phase consumes canonical pipe rows without topology node reads');
for(const p of old.storage.blocks.values())for(const node of p)if(node){
 Object.defineProperty(node,'entity',{configurable:true,writable:true,value:(node as any)._testEntity});
 delete (node as any)._testEntity;
}
g.removeEntity(g.entAt(102,102)!,false);g.step();
assert.deepEqual(page.pipes.map((e:any)=>e.id),oldIds,'old pipe snapshot remains immutable');
const current=heatNet(g);const expected=[...g.ents.values()].filter(e=>e.t==='hpipe').sort((a,b)=>a.id-b.id);
const actual=current.storage.keys.flatMap(k=>(current.storage.blocks.get(k)! as any).pipes);
assert.deepEqual(actual.map((e:any)=>e.id),expected.map(e=>e.id),'pipe loss traversal remains globally canonical');
console.log('✔ canonical heat pipe rows: metadata traversal forbidden, immutable snapshot and exact loss order');

import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { heatNet } from '../src/sim/heat';
const g=new Game(1160702,true,{enemies:'none'});g.batchBuild=true;
for(let y=90;y<125;y++)for(let x=90;x<125;x++){
 const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;if(c.decor[i])g.world.removeDecor(x,y);
}
for(let x=100;x<120;x++)assert.ok(g.build('heat-pipe',x,100,0,false));g.batchBuild=false;
const old=heatNet(g),page=old.storage.blocks.get(old.storage.keys[0])! as any;
assert.ok(page.nodeSlots instanceof Int32Array,'each touched page packs stable slots alongside canonical edge indices');
const frozen=[...page.nodeSlots];g.removeEntity(g.entAt(105,100)!,false);const current=heatNet(g);
assert.deepEqual([...page.nodeSlots],frozen,'old node-slot snapshot stays immutable');
for(const p of current.storage.blocks.values())for(let i=0;i<p.length;i++)
 assert.equal((p as any).nodeSlots[i],p[i]?.slot??-1,'node-slot row exactly matches current topology or empty sentinel');
console.log('✔ packed heat node slots: stable endpoint metadata, empty sentinel and immutable old snapshot');

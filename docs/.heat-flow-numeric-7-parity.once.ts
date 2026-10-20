import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Game } from '../src/sim/game';
import { serialize, deserialize, stateHash } from '../src/sim/save';
import { deserialize as oldLoad, serialize as oldSave, stateHash as oldHash } from '../integration-logs/continuation-7/baseline-src/sim/save';
const seed=new Game(11606031,true,{enemies:'none'});seed.batchBuild=true;
for(let y=90;y<125;y++)for(let x=90;x<125;x++){
 const c=seed.world.chunkAt(x,y),i=seed.world.idx(x,y);c.terrain[i]=0;c.res[i]=0;c.amt[i]=0;if(c.decor[i])seed.world.removeDecor(x,y);
}
for(let y=100;y<110;y++)for(let x=100;x<110;x++)assert.ok(seed.build('heat-pipe',x,y,0,false));
seed.batchBuild=false;const initial=JSON.parse(JSON.stringify(serialize(seed)));
const inputs=[0,.25,-0,NaN,1000,30_000_000,Number.MAX_SAFE_INTEGER,2**54];let steps=0;
for(const value of inputs){
 const current=deserialize(JSON.parse(JSON.stringify(initial))),previous=oldLoad(JSON.parse(JSON.stringify(initial)));
 for(const game of [current,previous])for(const e of game.ents.values()){
  e.hE=Number.isNaN(value)?NaN:value===0?value:value+(e.id%9)*.25;e.hL=(e.id%7)*100_000+.125;
 }
 for(let i=0;i<10;i++){
  current.step();previous.step();steps++;
  for(const e of current.ents.values()){
   assert.ok(Object.is(e.hE,previous.ents.get(e.id)!.hE),`exact Number bits at input ${value}, tick ${i}, entity ${e.id}`);
   assert.ok(Object.is(e.hL,previous.ents.get(e.id)!.hL));
  }
  assert.equal(stateHash(current),oldHash(previous));assert.deepEqual(serialize(current),oldSave(previous));assert.deepEqual(current.nuc,previous.nuc);
 }
}
const result={status:'passed',steps,cases:inputs.map(x=>Number.isNaN(x)?'NaN':Object.is(x,-0)?'-0':String(x)),scope:'independent previous source, exact hE/hL Number bits, full saved state and nuclear counters; unsafe magnitudes are numerical regression inputs, not newly allowed mod values'};
writeFileSync('integration-logs/continuation-7/flow-numeric-parity.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

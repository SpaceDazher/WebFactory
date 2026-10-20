import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { deserialize } from '../src/sim/save';
import { Game } from '../src/sim/game';
import { T_GRASS } from '../src/sim/world';
import { Plan, routePipe, pipeOk, portsOf, key, type RouteSearchStats } from '../tools/bot/map';

// Exact capture from the full seed-1 bot, after continuation-1 recovery changes.
// No altered scale, fabricated targets, increased budget or moved endpoints.
const d=JSON.parse(zlib.gunzipSync(fs.readFileSync('tests/fixtures/bot-water-failure.json.gz')).toString());
assert.equal(d.tick,995369);
assert.deepEqual([d.x,d.y],[-172,-605]);
assert.equal(d.targets.length,272);
const g=deserialize(d.game), p=new Plan(g);
p.tile=new Map(d.plan.tile);p.front=new Map(d.plan.front);p.ports=new Map(d.plan.ports);
p.keep=new Set(d.plan.keep);p.tunnel=new Set(d.plan.tunnel);
assert.ok(pipeOk(p,d.x,d.y,d.net),'the failing feed cell itself is legal');
const before=JSON.stringify({tile:[...p.tile],front:[...p.front],ports:[...p.ports],keep:[...p.keep],tunnel:[...p.tunnel]});
const stats={} as RouteSearchStats;
const route=routePipe(p,d.net,d.x,d.y,new Set(d.targets.map(([x,y]:number[])=>key(x,y))),{stats});
console.log('Route search',JSON.stringify(stats));
assert.ok(route,'the unchanged captured water-feed route must be found within the existing 300000-node budget');
assert.equal(stats.reason,'found');assert.ok(stats.visited<=300000);
assert.equal(JSON.stringify({tile:[...p.tile],front:[...p.front],ports:[...p.ports],keep:[...p.keep],tunnel:[...p.tunnel]}),before,'search is read-only');
// Failure reporting must keep a real search budget and port/terrain validation.
const limited={} as RouteSearchStats;
assert.equal(routePipe(p,d.net,d.x,d.y,new Set(d.targets.map(([x,y]:number[])=>key(x,y))),{maxNodes:1,stats:limited}),null);
assert.equal(limited.reason,'limit');assert.equal(limited.visited,1);
const blocked={} as RouteSearchStats;
assert.equal(routePipe(p,d.net,-171,-606,new Set([key(126,-164)]),{stats:blocked}),null);
assert.equal(blocked.reason,'blocked-start');
console.log('✔ explicit search limit and occupied-start rejection remain enforced');

const boilers=[...g.ents.values()].filter(e=>e.proto==='boiler'&&e.y===-606&&[-171,-167,-163].includes(e.x));
assert.equal(boilers.length,3);
for(const e of route.ents){
  // In normal play buildBp mines decor first. Here it is fixture preparation;
  // terrain, buildings, ports, tunnels and all route coordinates stay untouched.
  if(g.world.decor(e.x,e.y))g.world.removeDecor(e.x,e.y);
  const legal=g.canPlace(e.p,e.x,e.y,e.d as any,false);
  assert.ok(legal.ok,`${e.p} ${e.x},${e.y}: ${legal.reason}`);
  assert.ok(g.build(e.p,e.x,e.y,e.d as any,false));
}
// The geometry test supplies coal only, never water, steam or electrical output.
for(const b of boilers)b.fuel={item:'coal',count:10};
for(let i=0;i<180;i++)g.step();
for(const b of boilers){
  const water=g.fluidNets[b._fn![0]],steam=g.fluidNets[b._fn![1]];
  assert.ok(water.nodes.some(([id])=>g.ents.get(id)?.proto==='offshore-pump'),'the routed boiler must physically share a water net with a real pump');
  assert.equal(water.fluid,'water');assert.ok(water.amount>0);
  assert.equal(steam.fluid,'steam');assert.ok(steam.amount>0,'real boiler ticks produce steam from pump water');
  assert.notEqual(b.status,'no-water');
}
console.log(`✔ exact late-bot feed routes ${route.ents.length} entities to real pump water and all three boilers produce steam`);


// These expected routes were captured from continuation-1, not recomputed from
// the candidate. Early ordinary searches must retain their established paths.
const short=JSON.parse(fs.readFileSync('tests/fixtures/bot-short-routes.json','utf8'));
const sg=new Game(1,true,{enemies:'none'}),sp=new Plan(sg);
for(let y=-5;y<=35;y++)for(let x=-5;x<=55;x++){
  const c=sg.world.chunkAt(x,y),i=sg.world.idx(x,y);c.terrain[i]=T_GRASS;c.res[i]=0;c.amt[i]=0;c.decor[i]=0;
}
sp.keep=new Set(short.keep);sp.add(short.boiler,undefined,portsOf(short.boiler,{fixed:['water','steam']}));
for(const c of short.cases){
  const st={} as RouteSearchStats;
  const r=routePipe(sp,'water',c.start[0],c.start[1],new Set([key(c.target[0],c.target[1])]),{stats:st});
  assert.deepEqual(r,c.expected,'short-route geometry remains identical to continuation-1');
  assert.equal(st.tightened,false,'short routes do not use the stronger second-phase heuristic');
}
console.log('✔ three ordinary route geometries match the previous implementation exactly');

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game';
import { T_GRASS } from '../src/sim/world';
import { Plan, routePipe, portsOf, key, type RouteSearchStats } from '../tools/bot/map';
const scratch='tools/bot/.map-continuation1.once.ts';
fs.writeFileSync(scratch,fs.readFileSync('integration-logs/continuation-2/map-continuation1.txt'));
try {
 const old=await import(pathToFileURL(process.cwd()+'/'+scratch).href);
 const g=new Game(1,true,{enemies:'none'});
 for(let y=-5;y<=35;y++)for(let x=-5;x<=55;x++){
  const c=g.world.chunkAt(x,y),i=g.world.idx(x,y);c.terrain[i]=T_GRASS;c.res[i]=0;c.amt[i]=0;c.decor[i]=0;
 }
 const p=new Plan(g);for(let y=2;y<=12;y++)p.keep.add(key(14,y));
 const boiler={p:'boiler',x:8,y:18,d:0};p.add(boiler,undefined,portsOf(boiler,{fixed:['water','steam']}));
 const cases=[];
 for(const [start,target] of [[[0,0],[24,11]],[[1,20],[33,19]],[[5,3],[45,23]]] as number[][][]){
  const targets=new Set([key(...target as [number,number])]);
  const expected=old.routePipe(p,'water',...start as [number,number],targets);
  const stats={} as RouteSearchStats;const actual=routePipe(p,'water',...start as [number,number],targets,{stats});
  assert.ok(expected);assert.deepEqual(actual,expected);assert.equal(stats.tightened,false);
  cases.push({start,target,expected});console.log('PASS unchanged short route',JSON.stringify({start,target,...stats}));
 }
 fs.writeFileSync('tests/fixtures/bot-short-routes.json',JSON.stringify({keep:[...p.keep],boiler,cases},null,2));
}finally{fs.unlinkSync(scratch);}

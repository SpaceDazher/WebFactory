// Read-only failure capture: execute the existing full bot entrypoint.
import fs from 'node:fs';
import { Factory } from '../tools/bot/factory';
import { pipeOk, key, unkey } from '../tools/bot/map';
import { serialize } from '../src/sim/save';
const original = Factory.prototype.pipeTo;
Factory.prototype.pipeTo = function* (net: string, x: number, y: number) {
  try { yield* original.call(this, net, x, y); }
  catch (error) {
    const p=this.plan;
    const state={ net, x, y, tick:this.g.tick, startAllowed:pipeOk(p,x,y,net),
      occupied:this.g.world.occ(x,y), terrain:this.g.world.terrain(x,y), keep:p.keep.has(key(x,y)),
      planned:p.tile.get(key(x,y)), front:p.front.get(key(x,y)),
      targets:[...this.netTiles(net)].map(unkey),
      neighbors:[[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy])=>({x:x+dx,y:y+dy,tile:p.tile.get(key(x+dx,y+dy)),front:p.front.get(key(x+dx,y+dy))})),
      plan:{tile:[...p.tile],tunnel:[...p.tunnel],front:[...p.front],ports:[...p.ports],keep:[...p.keep]},
      game:serialize(this.g) };
    fs.writeFileSync('integration-logs/continuation-2/water-failure.json',JSON.stringify(state));
    console.log('PIPE_FAILURE_CAPTURE',JSON.stringify({net,x,y,tick:state.tick,startAllowed:state.startAllowed,occupied:state.occupied,keep:state.keep,front:state.front,planned:state.planned,targets:state.targets.length,neighbors:state.neighbors}));
    throw error;
  }
};
await import('../tools/bot/run');

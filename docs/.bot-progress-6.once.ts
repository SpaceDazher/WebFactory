import {readFileSync,readdirSync} from 'node:fs';
import {unpackStr} from '../src/core/pack';
const dir='integration-logs/continuation-6/ordinary-bot-checkpoints';
const name=readdirSync(dir).filter(x=>x.endsWith('.z7save')).sort().at(-1);
if(name){const s:any=await unpackStr(readFileSync(dir+'/'+name,'utf8'));console.log(JSON.stringify({checkpoint:name,tick:s.tick,rockets:s.rockets,research:s.research,dead:s.player?.dead,hp:s.player?.hp}));}

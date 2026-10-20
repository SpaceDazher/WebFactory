// v1.11 «Моддинг II»: сторона симуляции для скриптов модов. События тика N копятся в g.sev (только если есть скриптовые
// моды), хост скриптов (src/mods/script.ts) рассылает их в Worker модов, а ответы — команды — применяются здесь в тике N+1.
// Объекты мира передаются копией (entInfo); менять мир можно только командами.
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import type { Game, Entity } from './game';
import type { Dir } from '../core/types';
import { RES_ITEMS } from './world';
import { fmtClock } from './scenario';

/** копия постройки для скрипта */
export interface EntInfo { id: number; name: string; type: string; kind: string; position: { x: number; y: number }; size: { w: number; h: number }; direction: number; drop_position?: { x: number; y: number }; resource?: string | null; recipe?: string | null }
export function entInfo(g: Game, e: Entity): EntInfo {
  const r: EntInfo = { id: e.id, name: e.proto, type: e.proto, kind: e.t, position: { x: e.x, y: e.y }, size: { w: e.w, h: e.h }, direction: e.dir };
  if (e.t === 'drill' && PROTOS[e.proto]?.out) {
    const o = g.drillOut(e); r.drop_position = { x: o.x, y: o.y };
    // руда под буром — самая частая на его клетках
    const cnt = new Map<number, number>(); for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) { const k = g.world.res(x, y); if (k) cnt.set(k, (cnt.get(k) || 0) + 1); }
    let best = 0, bn = 0; for (const [k, n] of cnt) if (n > bn) { best = k; bn = n; } r.resource = best ? RES_ITEMS[best] || null : null;
  }
  if (e.t === 'assembler') r.recipe = e.recipe || null;
  return r;
}
export type ScriptEv = { e: string; [k: string]: any };
/** команда скрипта (см. mods/api/zavod7-mod.d.ts) */
export type ScriptOp =
  | { op: 'print'; text: string; color?: string }
  | { op: 'create'; name: string; x: number; y: number; dir: number; fp?: boolean; pl?: number }
  | { op: 'remove'; id: number }
  | { op: 'insert'; target: number | 'player'; pl?: number; item: string; n: number }
  | { op: 'take'; target: number | 'player'; pl?: number; item: string; n: number }
  | { op: 'gui'; id: string; spec: any; pl?: number } | { op: 'guiclose'; id: string; pl?: number }
  | { op: 'scn'; what: 'win' | 'fail'; text: string }
  | { op: 'log'; level: 'info' | 'warn' | 'error'; text: string };

/** записать событие (если скрипты включены) */
export function sev(g: Game, ev: ScriptEv) { if (g.sev) g.sev.push(ev); }

/** применить команды мода (тик N+1). Возвращает предупреждения для консоли модов */
export function applyScriptOps(g: Game, mod: string, title: string, ops: ScriptOp[]): string[] {
  const warn: string[] = []; const prevBy = g.sevBy; g.sevBy = 'script:' + mod;
  const withPl = <T>(pl: number | undefined, fn: () => T): T => { const i = (pl || 0) | 0; if (!g.peers.length || !g.peers[i] || i === g.pl) return fn(); const was = g.pl; g.usePl(i); try { return fn(); } finally { g.usePl(was); } };
  try {
    for (const o of ops) {
      switch (o.op) {
        case 'print': g.msg(`[${title}] ${String(o.text).slice(0, 300)}`); break;
        case 'scn': { // v1.15: скрипт сценария объявляет победу или поражение
          const st = g.scnSt; if (!g.scn || !st) { warn.push('game.scenario: партия не из сценария'); break; }
          if (st.res) break; st.res = { ok: o.what === 'win', tick: g.tick };
          g.msg(o.what === 'win' ? 'ОСКАР: испытание пройдено за ' + fmtClock(g.tick - st.t0) + (o.text ? ' — ' + String(o.text).slice(0, 200) : '') : 'ОСКАР: испытание не пройдено' + (o.text ? ' — ' + String(o.text).slice(0, 200) : '')); if (o.what === 'win') g.snd('goal'); break;
        }
        case 'create': {
          const p = PROTOS[o.name]; if (!p) { warn.push(`create_entity: нет постройки «${o.name}»`); break; }
          if (p.type === 'nest' || p.type === 'loco' || p.type === 'wagon' || p.type === 'rail') { warn.push(`create_entity: «${o.name}» нельзя создать скриптом`); break; }
          const x = Math.floor(+o.x), y = Math.floor(+o.y), dir = (((o.dir | 0) % 4) + 4) % 4 as Dir; if (!isFinite(x) || !isFinite(y)) { warn.push('create_entity: неверные координаты'); break; }
          withPl(o.pl, () => {
            if (o.fp && g.inv.count(o.name) < 1) { warn.push(`create_entity: у игрока нет «${ITEMS[o.name]?.name || o.name}»`); return; }
            const c = g.canPlace(o.name, x, y, dir, false); if (!c.ok || c.replace) { warn.push(`create_entity: ${o.name} в (${x}, ${y}) — ${c.ok ? 'место занято' : c.reason}`); return; }
            const e = g.build(o.name, x, y, dir, false); if (!e) { warn.push(`create_entity: ${o.name} в (${x}, ${y}) не построен`); return; }
            if (o.fp) g.inv.remove(o.name, 1);
          });
          break;
        }
        case 'remove': { const e = g.ents.get(o.id | 0); if (!e || e.t === 'nest') { warn.push(`remove_entity: нет постройки #${o.id}`); break; } g.removeEntity(e, false); break; }
        case 'insert': case 'take': {
          if (!ITEMS[o.item]) { warn.push(`${o.op === 'insert' ? 'insert' : 'remove_item'}: нет предмета «${o.item}»`); break; }
          const n = Math.max(0, Math.min(1e6, Math.floor(+o.n || 0))); if (!n) break;
          if (o.target === 'player') withPl(o.pl, () => { if (o.op === 'insert') { const left = g.inv.add(o.item, n); if (left) g.dropGround(g.player.x, g.player.y, o.item, left); } else g.inv.remove(o.item, Math.min(n, g.inv.count(o.item))); });
          else { const e = g.ents.get(+o.target | 0); if (!e) { warn.push(`нет постройки #${o.target}`); break; }
            if (o.op === 'insert') { const put = g.insertItem(e, o.item, n, false); if (put < n) warn.push(`insert: в #${e.id} поместилось ${put} из ${n}`); }
            else if (e.inv) e.inv.remove(o.item, Math.min(n, e.inv.count(o.item))); else if (e.output?.[o.item]) { e.output[o.item] = Math.max(0, e.output[o.item] - n); } }
          break;
        }
      }
    }
  } finally { g.sevBy = prevBy; }
  return warn;
}

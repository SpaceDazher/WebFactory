import { DX, DY, rotLocal } from '../core/types';
import { PROTOS } from '../data/entities';
import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';

export interface FluidMachine { proto: string; x: number; y: number; dir: number; recipe?: string | null; }
/** Pure geometry shared by network connectivity, previews and interface diagrams. */
export function fluidConnections(e: FluidMachine, tank: number) {
  const p = PROTOS[e.proto], box = p?.fluid?.[tank];
  return box?.conns.map(c => {
    const [x, y] = rotLocal(c.x, c.y, p.w, p.h, e.dir);
    return { x: e.x + x, y: e.y + y, d: (c.d + e.dir) % 4 };
  }) || [];
}
/** Tank order is prototype order, never screen order after rotation. */
export function fluidAssignments(e: FluidMachine) {
  const boxes = PROTOS[e.proto]?.fluid || [], recipe = e.recipe ? RECIPES[e.recipe] : undefined;
  const inputs = recipe?.in.filter(([id]) => ITEMS[id]?.fluid) || [];
  const outputs = recipe?.out.filter(([id]) => ITEMS[id]?.fluid) || [];
  let ni = 0, no = 0;
  const tanks = boxes.map((box, tank) => {
    const index = box.io === 'in' ? ni++ : box.io === 'out' ? no++ : -1;
    const ingredient = box.io === 'in' ? inputs[index] : box.io === 'out' ? outputs[index] : undefined;
    const fluid = box.io ? box.filter || ingredient?.[0] || null : null;
    return { tank, io: box.io, key: `${box.io === 'in' ? 'I' : 'O'}${index + 1}`, fluid,
      amount: ingredient?.[1] || 0, used: !!ingredient,
      connections: fluidConnections(e, tank).map(c => ({ ...c, outsideX: c.x + DX[c.d], outsideY: c.y + DY[c.d] })) };
  });
  const overflow = inputs.length > ni || outputs.length > no;
  const incompatible = overflow || tanks.some(t => t.used && (t.io === 'in' ? inputs : outputs)[Number(t.key.slice(1)) - 1]?.[0] !== t.fluid);
  return { tanks, filters: tanks.map(t => t.fluid), hasRecipe: !!recipe, incompatible };
}

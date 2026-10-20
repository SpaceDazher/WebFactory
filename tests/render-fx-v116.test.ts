import { Renderer } from '../src/render/renderer';

type DrawFx = (g: any, c: any, sx: (n: number) => number, sy: (n: number) => number, s: number) => void;
const drawFx = (Renderer.prototype as unknown as { drawFx: DrawFx }).drawFx;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`v1.16 render fx: ${message}`);
}

function render(k: 'blast' | 'boom', ticksLeft: number, life?: number) {
  const arcs: number[] = [], gradients: number[] = [];
  const context = {
    beginPath() {},
    arc(_x: number, _y: number, radius: number) { arcs.push(radius); },
    createRadialGradient(_x0: number, _y0: number, _r0: number, _x1: number, _y1: number, r1: number) {
      gradients.push(r1); return { addColorStop() {} };
    },
    stroke() {}, fill() {},
  };
  const effect = { k, x: 0, y: 0, t: ticksLeft, s: 8, ...(life == null ? {} : { life }) };
  drawFx.call(null, { tick: 0, acids: [], fires: [], shots: [], projectiles: [], fx: [effect] }, context, value => value, value => value, 32);
  return { arcs, gradients };
}

for (const life of [12, 30, 36, 50, 70]) {
  const start = render('blast', life, life).arcs[0];
  const middle = render('blast', Math.ceil(life / 2), life).arcs[0];
  const last = render('blast', 1, life).arcs[0];
  for (const [at, radius] of [['start', start], ['middle', middle], ['last tick', last]] as const) {
    assert(Number.isFinite(radius) && radius >= 0, `blast with life ${life} has valid radius at ${at} (got ${radius})`);
  }
  assert(start < middle && middle < last, `blast with life ${life} expands across its full animation lifetime (${start}/${middle}/${last})`);
}

for (const life of [40, 60]) {
  const at = (ticksLeft: number) => render('boom', ticksLeft, life).gradients[0];
  const start = at(life), middle = at(Math.ceil(life / 2)), last = at(1);
  for (const [label, radius] of [['start', start], ['middle', middle], ['last tick', last]] as const) {
    assert(Number.isFinite(radius) && radius >= 0, `boom with life ${life} has valid gradient radius at ${label} (got ${radius})`);
  }
  assert(start < middle && middle < last, `boom with life ${life} expands across its full animation lifetime (${start}/${middle}/${last})`);
}

assert(render('blast', 30).arcs[0] > 0, 'legacy blast without life uses the 30-tick visual default');
assert(render('boom', 40).gradients[0] > 0, 'legacy boom without life uses the 40-tick visual default');
console.log('✓ blast/boom radii remain valid and expand through their actual lifetime');

const existing = { id: 1, proto: 'laser-turret', t: 'turret', x: 2, y: 3, w: 2, h: 2 } as any;
const second = { id: 2, proto: 'artillery-turret', t: 'turret', x: 30, y: 40, w: 3, h: 3 } as any;
const rangeGame = { ents: new Map([[existing.id, existing], [second.id, second]]), bonus: (kind: string) => kind === 'ar' ? 0.5 : 0 } as any;
const rangeView: any = { ranges: 0, hoverEnt: existing, cursor: null, ghostPos: null, rot: 0 };
type DrawRanges = (g: any, c: any, v: any, sx: (n: number) => number, sy: (n: number) => number, s: number, x0: number, y0: number, x1: number, y1: number, mapMode: boolean) => void;
const drawRanges = (Renderer.prototype as unknown as { drawTurretRanges: DrawRanges }).drawTurretRanges;
function renderRanges(v: any, mapMode = false) {
  const arcs: [number, number, number][] = [];
  const context = { save() {}, restore() {}, setLineDash() {}, beginPath() {}, arc(x: number, y: number, r: number) { arcs.push([x, y, r]); }, fill() {}, stroke() {}, fillText() {} };
  drawRanges.call(null, rangeGame, context, v, value => value, value => value, 1, -100, -100, 100, 100, mapMode);
  return arcs;
}
assert(renderRanges(rangeView).length === 0, 'off mode hides every turret radius');
rangeView.ranges = 1;
assert(renderRanges(rangeView).length === 1, 'hover mode shows the hovered turret radius');
rangeView.hoverEnt = null;
rangeView.cursor = 'flamethrower-turret';
rangeView.ghostPos = [10, 20];
rangeView.rot = 1;
const ghostArcs = renderRanges(rangeView);
assert(ghostArcs.length === 2 && ghostArcs[0]?.[0] === 11.5 && ghostArcs[0][1] === 21 && ghostArcs[0][2] === 30 && ghostArcs[1]?.[2] === 4,
  'hover mode shows both rotated turret placement radii at the rotated center');
rangeView.ranges = 2;
const allArcs = renderRanges(rangeView);
assert(allArcs.length === 5 && allArcs[1]?.[2] === 300 && allArcs[2]?.[2] === 10,
  'all mode keeps visible turrets, includes artillery bonus/minimum range, and adds placement radii');
assert(renderRanges(rangeView, true).length === 0, 'map mode suppresses turret radii');
const vehicle = { id: 3, proto: 'car', t: 'car', x: 29, y: 38, w: 2, h: 3,
  vehicleState: { x: 30, y: 40, mounts: [{ proto: 'laser-turret' }, { proto: 'flamethrower-turret' }] } } as any;
rangeGame.ents.set(vehicle.id, vehicle);
rangeView.ranges = 1; rangeView.cursor = null; rangeView.ghostPos = null; rangeView.hoverEnt = vehicle;
const mountedArcs = renderRanges(rangeView);
assert(mountedArcs.length === 3 && mountedArcs[0]?.[0] === 29.45 && mountedArcs[0][1] === 40.2 &&
  mountedArcs[1]?.[0] === 30.55 && mountedArcs[1][1] === 39.8,
  'hover mode draws mounted turret radii at their simulation origins');
console.log('✓ turret radii follow off/hover/all modes and include the rotated placement ghost');

const lodCanvas = (Renderer.prototype as unknown as { lodCanvas: (this: any, g: any, ch: any) => HTMLCanvasElement }).lodCanvas;
const lodEntitySignature = (Renderer.prototype as unknown as { lodEntitySignature: (this: any, g: any, ids: number[]) => string }).lodEntitySignature;
const hasCreep = (Renderer.prototype as unknown as { hasCreep: (this: any, ch: any) => boolean }).hasCreep;
assert(hasCreep.call(null, { creep: new Uint8Array([255]), cn: 0 }), 'a creep chunk at tick 0 remains renderable when its timestamp is zero');
const previousDocument = globalThis.document;
const lodPixels: Uint8ClampedArray[] = [];
globalThis.document = {
  createElement() {
    return {
      width: 0, height: 0,
      getContext() {
        return {
          createImageData(width: number, height: number) { return { data: new Uint8ClampedArray(width * height * 4) }; },
          putImageData(image: ImageData) { lodPixels.push(image.data.slice()); },
        };
      },
    } as unknown as HTMLCanvasElement;
  },
} as unknown as Document;
try {
  const chunk = {
    cx: 0, cy: 0, terrain: new Uint8Array(1024), res: new Uint8Array(1024), amt: new Uint32Array(1024),
    decor: new Uint8Array(1024), occ: new Int32Array(1024).fill(-1), version: 1, ov: 0, av: 0, cv: 0, creep: undefined as Uint8Array | undefined,
  };
  const world = {};
  const entities = Object.assign(new Map<number, any>(), { ver: 0 });
  const game: any = { world, ents: entities };
  const renderer: any = { lodCache: new Map(), frame: 1, lodBuilt: 0, lodEntitySignature };
  const pixel = (index: number, tile = 0) => lodPixels[index] ? [...lodPixels[index].slice(tile * 4, tile * 4 + 3)] : null;
  const draw = () => lodCanvas.call(renderer, game, chunk);

  draw();
  const grass = pixel(0);
  const openGround = pixel(0, 3);
  draw();
  assert(renderer.lodBuilt === 1, 'an unchanged LOD chunk stays cached');
  entities.set(99, { id: 99, t: 'chest', proto: 'iron-chest' }); entities.ver++;
  draw();
  assert(renderer.lodBuilt === 1, 'an unrelated entity update does not redraw this cached LOD chunk');

  chunk.occ[0] = 1; chunk.ov++;
  entities.set(1, { id: 1, t: 'chest', proto: 'iron-chest' }); entities.ver++;
  draw();
  const chest = pixel(1);
  assert(renderer.lodBuilt === 2 && chest !== null && chest.some((value, i) => value !== grass?.[i]), 'new occupancy redraws a cached chunk without changing terrain version');

  const chestBeforeCreep = chest && [...chest];
  chunk.creep = new Uint8Array(1024); chunk.creep[0] = 255; chunk.creep[3] = 220; chunk.cv++;
  draw();
  const chestOnCreep = pixel(2);
  const openSlime = pixel(2, 3);
  assert(renderer.lodBuilt === 3 && chestBeforeCreep !== null && chestOnCreep !== null && chestOnCreep.every((value, i) => value === chestBeforeCreep[i]) && openGround !== null && openSlime !== null && openSlime.some((value, i) => value !== openGround[i]), 'far-zoom slime tints open ground while leaving an occupied building pixel on top');

  entities.set(1, { id: 1, t: 'chest', proto: 'iron-chest', status: 'working' }); entities.ver++;
  draw();
  assert(renderer.lodBuilt === 3, 'a status-only entity replacement does not redraw stable LOD art');

  entities.get(1).proto = 'steel-chest'; entities.ver++;
  draw();
  const upgraded = pixel(3);
  assert(renderer.lodBuilt === 4 && upgraded !== null && chestOnCreep !== null && upgraded.some((value, i) => value !== chestOnCreep[i]), 'a proto upgrade redraws LOD even when occupancy and terrain versions stay unchanged');

  chunk.occ[0] = -1; chunk.ov++; chunk.creep[0] = 0; chunk.cv++; entities.delete(1); entities.ver++;
  draw();
  const removed = pixel(4);
  assert(renderer.lodBuilt === 5 && removed !== null && grass !== null && removed.every((value, i) => value === grass[i]), 'removal restores the ground color in a cached chunk');

  chunk.occ[1] = 2; chunk.ov++; draw();
  const unknown = pixel(5, 1);
  entities.set(2, { id: 2, t: 'chest', proto: 'iron-chest' }); entities.ver++;
  draw();
  const arrived = pixel(6, 1);
  assert(renderer.lodBuilt === 7 && arrived !== null && unknown !== null && arrived.some((value, i) => value !== unknown[i]), 'a late entity arrival replaces the cached unknown-occupancy color immediately');

  chunk.amt[2] = 10; chunk.res[2] = 1; chunk.av++;
  draw();
  assert(renderer.lodBuilt === 8, 'a resource revision refreshes the LOD cache without changing terrain or occupancy revisions');

  game.world = {};
  chunk.terrain[0] = 1;
  draw();
  const newWorld = pixel(8);
  assert(renderer.lodBuilt === 9 && newWorld !== null && grass !== null && newWorld.some((value, i) => value !== grass[i]), 'a new world cannot reuse an old LOD image at matching chunk coordinates');
} finally {
  globalThis.document = previousDocument;
}
console.log('✓ LOD cache follows occupancy, entity, resource, and world revisions');

/** Cached, deterministic biomass art. Neighbor bits: N, NE, E, SE, S, SW, W, NW. */
export function drawCreepTile(
  c: CanvasRenderingContext2D, x: number, y: number, size: number,
  strength: number, mask: number, seed: number,
): void {
  if (!(strength > 0) || !(size > 0)) return;
  const density = Math.min(255, strength) / 255;
  let state = seed | 0;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const occupied = (bit: number) => (mask & (1 << (bit & 7))) !== 0;
  // Corners reach the tile boundary only where the surrounding mat continues.
  const corners = [7, 1, 3, 5].map(bit =>
    occupied(bit) || (occupied(bit - 1) && occupied(bit + 1)) ? 0 : .13 + random() * .09);
  const dents = [0, 1, 2, 3].map(() => .08 + random() * .12);
  const point = (side: number, u: number, v: number): [number, number] => {
    switch (side) {
      case 0: return [u, v];
      case 1: return [1 - v, u];
      case 2: return [1 - u, 1 - v];
      default: return [v, 1 - u];
    }
  };
  const edge = (side: number, move: boolean) => {
    const a = corners[side], b = corners[(side + 1) & 3];
    if (move) c.moveTo(...point(side, a, a));
    if (occupied(side * 2)) {
      c.bezierCurveTo(...point(side, .28, 0), ...point(side, .32, 0), ...point(side, .5, 0));
      c.bezierCurveTo(...point(side, .68, 0), ...point(side, .72, 0), ...point(side, 1 - b, b));
    } else {
      const d = dents[side];
      c.bezierCurveTo(...point(side, .3, d + .07), ...point(side, .32, d * .25), ...point(side, .52, d));
      c.bezierCurveTo(...point(side, .69, d + .07), ...point(side, .8, d * .2), ...point(side, 1 - b, b));
    }
  };
  c.save();
  c.translate(x, y); c.scale(size, size);
  // All strokes and droplets remain inside the occupied tile, including chunk edges.
  c.beginPath(); c.rect(0, 0, 1, 1); c.clip();
  c.globalAlpha *= .72 + .17 * density;
  const mat = '#542d50';
  c.beginPath();
  for (let side = 0; side < 4; side++) edge(side, side === 0);
  c.closePath(); c.fillStyle = mat; c.fill(); c.clip();
  // Subtle irregular mottles have no repeated tile-wide lighting direction.
  for (let i = 0; i < 2; i++) {
    c.beginPath();
    c.ellipse(.15 + random() * .7, .15 + random() * .7, .14 + random() * .17,
      .08 + random() * .12, random() * Math.PI, 0, Math.PI * 2);
    c.fillStyle = i === 0 ? 'rgba(143,78,113,.16)' : 'rgba(33,21,43,.15)'; c.fill();
  }
  // Rim exists only on exposed fronts, never as a grid around interior tiles.
  c.beginPath();
  for (let side = 0; side < 4; side++) if (!occupied(side * 2)) edge(side, true);
  c.lineWidth = .065; c.strokeStyle = '#281c32'; c.stroke();
  c.lineWidth = .018; c.strokeStyle = '#ad6b91'; c.stroke();
  const cx = .2 + random() * .6, cy = .2 + random() * .6;
  const branches = 2 + (random() > .55 ? 1 : 0);
  const angle = random() * Math.PI * 2;
  // One shared branching path, shaded twice for raised, root-like ridges.
  c.beginPath();
  for (let branch = 0; branch < branches; branch++) {
    const a = angle + branch * 2.2 + random() * .8;
    const length = .22 + random() * .38;
    const ex = Math.max(.06, Math.min(.94, cx + Math.cos(a) * length));
    const ey = Math.max(.06, Math.min(.94, cy + Math.sin(a) * length));
    c.moveTo(cx, cy);
    c.bezierCurveTo(cx + (random() - .5) * .45, cy + (random() - .5) * .45,
      ex + (cx - ex) * .25 + (random() - .5) * .2,
      ey + (cy - ey) * .25 + (random() - .5) * .2, ex, ey);
  }
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.lineWidth = .085 + density * .025; c.strokeStyle = '#2e1939'; c.stroke();
  c.lineWidth = .043 + density * .012; c.strokeStyle = '#99557b'; c.stroke();
  c.lineWidth = .012; c.strokeStyle = '#c7839b'; c.stroke();
  // One to three scattered flesh nodules with offset glossy highlights.
  const bulbs = 1 + Math.floor(random() * 3);
  for (let i = 0; i < bulbs; i++) {
    const bx = .09 + random() * .82, by = .09 + random() * .82;
    const r = .045 + random() * .055 + density * .018;
    c.beginPath(); c.ellipse(bx + .012, by + .022, r * 1.2, r * .87, 0, 0, Math.PI * 2);
    c.fillStyle = '#271a30'; c.fill();
    c.beginPath(); c.ellipse(bx, by, r, r * .72, -.35, 0, Math.PI * 2);
    c.fillStyle = i === 0 ? '#9c526d' : '#784165'; c.fill();
    c.beginPath(); c.ellipse(bx - r * .23, by - r * .24, r * .49, r * .18, -.35, 0, Math.PI * 2);
    c.fillStyle = '#d094a6'; c.fill();
  }
  c.restore();
}

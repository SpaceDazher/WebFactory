// Transient copy-on-write heat topology. Numeric-ID pages preserve canonical
// traversal without sorting/reindexing every unchanged edge after an edit.
import type { Entity } from './game';

export const HEAT_PAGE = 16, HEAT_SLOT_PAGE = 64;
export interface HeatEdge { pair: [Entity, Entity]; a: number; b: number; }
export interface HeatNode {
  entity: Entity; type: string; slot: number; cap: number; neighbors: number[]; edges: HeatEdge[];
}
class HeatNodeRecord implements HeatNode {
  constructor(
    public entity: Entity, public type: string, public slot: number,
    public cap: number, public neighbors: number[], public edges: HeatEdge[],
  ) {}
}
export interface HeatPage extends Array<HeatNode | undefined> {
  edgeSlots: Int32Array;
  nodeSlots: Int32Array;
  pipes: Entity[]; pipeSlots: Int32Array;
}
export class HeatStorage {
  private static readonly pipeScratch = new Int32Array(HEAT_PAGE);
  blocks = new Map<number, HeatPage>();
  keys: number[] = [];
  slots: (Entity | undefined)[][] = [];
  freeSlots: number[] = [];
  nextSlot = 0; count = 0; edgeCount = 0;
  updateStats = { full: true, nodesCopied: 0, edgeRowsUpdated: 0, edgesReindexed: 0, pagesCopied: 0 };
  private ownedBlocks = new Set<number>();
  private ownedSlots = new Set<number>();
  private ownedNodes = new Set<number>();
  /** owned pages whose node membership changed (insert/remove); others only had edge rows rewritten */
  private membership = new Set<number>();

  fork() {
    const result = new HeatStorage();
    // Copy page directories, not individual neighbor/edge entries. There is
    // no retained parent chain; unchanged pages are structurally shared.
    result.blocks = new Map(this.blocks);
    result.keys = this.keys.slice();
    result.slots = this.slots.slice();
    result.freeSlots = this.freeSlots.slice();
    result.nextSlot = this.nextSlot; result.count = this.count; result.edgeCount = this.edgeCount;
    result.updateStats.full = false;
    return result;
  }
  get(id: number) { return this.blocks.get(Math.floor(id / HEAT_PAGE))?.[id % HEAT_PAGE]; }
  entityAt(slot: number) { return this.slots[Math.floor(slot / HEAT_SLOT_PAGE)][slot % HEAT_SLOT_PAGE]!; }
  private blockForWrite(key: number) {
    let page = this.blocks.get(key);
    if (!this.ownedBlocks.has(key)) {
      const old = page;
      page = (old ? old.slice() : new Array<HeatNode | undefined>(HEAT_PAGE)) as HeatPage;
      page.edgeSlots = old?.edgeSlots || new Int32Array(0);
      page.nodeSlots = old?.nodeSlots || new Int32Array(0);
      page.pipes = old?.pipes || [];
      page.pipeSlots = old?.pipeSlots || new Int32Array(0);
      if (!this.blocks.has(key)) {
        let lo = 0, hi = this.keys.length;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.keys[mid] < key) lo = mid + 1; else hi = mid; }
        this.keys.splice(lo, 0, key);
      }
      this.blocks.set(key, page);
      this.ownedBlocks.add(key); this.updateStats.pagesCopied++;
    }
    return page!;
  }
  private setSlot(slot: number, entity: Entity | undefined) {
    const key = Math.floor(slot / HEAT_SLOT_PAGE);
    if (!this.ownedSlots.has(key)) {
      this.slots[key] = this.slots[key] ? this.slots[key].slice() : new Array(HEAT_SLOT_PAGE);
      this.ownedSlots.add(key);
    }
    this.slots[key][slot % HEAT_SLOT_PAGE] = entity;
  }
  insert(entity: Entity, cap: number) {
    const id = entity.id;
    const slot = this.freeSlots.pop() ?? this.nextSlot++;
    const node = new HeatNodeRecord(entity, entity.t, slot, cap, [], []);
    this.blockForWrite(Math.floor(id / HEAT_PAGE))[id % HEAT_PAGE] = node;
    this.membership.add(Math.floor(id / HEAT_PAGE));
    this.setSlot(slot, entity);
    this.ownedNodes.add(id); this.count++; this.updateStats.nodesCopied++;
    return node;
  }
  remove(id: number) {
    const node = this.get(id);
    if (!node) return;
    const key = Math.floor(id / HEAT_PAGE), page = this.blockForWrite(key);
    page[id % HEAT_PAGE] = undefined; this.membership.add(key);
    this.setSlot(node.slot, undefined); this.freeSlots.push(node.slot);
    this.edgeCount -= node.edges.length; this.count--; this.ownedNodes.delete(id);
    if (!page.some(Boolean)) {
      this.blocks.delete(key); this.keys.splice(this.keys.indexOf(key), 1);
      this.ownedBlocks.delete(key);
    }
  }
  writable(id: number) {
    const old = this.get(id);
    if (!old) return undefined;
    if (this.ownedNodes.has(id)) return old;
    const node = new HeatNodeRecord(old.entity, old.type, old.slot, old.cap, old.neighbors.slice(), old.edges);
    this.blockForWrite(Math.floor(id / HEAT_PAGE))[id % HEAT_PAGE] = node;
    this.ownedNodes.add(id); this.updateStats.nodesCopied++;
    return node;
  }
  rebuildRow(id: number) {
    const node = this.writable(id);
    if (!node) return;
    const previous = node.edges;
    this.edgeCount -= previous.length;
    // Rows stay in ascending neighbour order, so an unchanged edge is found by
    // a forward scan. Reusing it keeps canonical pair identity and avoids
    // re-allocating every surviving pair of a touched row.
    let edges: HeatEdge[] | undefined, kept = 0, scan = 0;
    const list = node.neighbors;
    for (let n = 0; n < list.length; n++) {
      const neighborId = list[n];
      if (neighborId <= id) continue;
      const other = this.get(neighborId)!;
      while (scan < previous.length && previous[scan].pair[1].id < neighborId) scan++;
      const old = scan < previous.length ? previous[scan] : undefined;
      const reuse = !!old && old.pair[0] === node.entity && old.pair[1] === other.entity && old.a === node.slot && old.b === other.slot;
      if (reuse && !edges && kept === scan) { kept++; scan++; continue; }
      if (!edges) edges = previous.slice(0, kept);
      edges.push(reuse ? old! : { pair: [node.entity, other.entity], a: node.slot, b: other.slot });
      if (reuse) scan++;
    }
    if (!edges) edges = kept === previous.length ? previous : previous.slice(0, kept);
    node.edges = edges; this.edgeCount += edges.length; this.updateStats.edgeRowsUpdated++;
    if (this.updateStats.full) this.updateStats.edgesReindexed += edges.length;
  }
  finish() {
    // Pack only touched pages into typed slot rows for the hot loop. This is
    // bounded by 16 nodes per touched page, never by all graph edges.
    for (const key of this.ownedBlocks) {
      const page = this.blocks.get(key);
      if (!page) continue;
      let length = 0;
      for (let i = 0; i < HEAT_PAGE; i++) length += page[i]?.edges.length || 0;
      const slots = new Int32Array(length * 2);
      if (!this.membership.has(key)) {
        // Same nodes, entities and slots as the shared parent page: only
        // edge rows changed, so node/pipe slot rows are reused verbatim.
        let index = 0;
        for (let i = 0; i < HEAT_PAGE; i++) {
          const node = page[i]; if (!node) continue;
          const edges = node.edges;
          for (let j = 0; j < edges.length; j++) { slots[index++] = edges[j].a; slots[index++] = edges[j].b; }
        }
        page.edgeSlots = slots;
        continue;
      }
      const nodeSlots = new Int32Array(HEAT_PAGE); nodeSlots.fill(-1);
      const pipes: Entity[] = [], pipeSlotScratch = HeatStorage.pipeScratch;
      let index = 0;
      for (let i = 0; i < HEAT_PAGE; i++) {
        const node = page[i]; if (!node) continue;
        nodeSlots[i] = node.slot;
        if (node.entity.t === 'hpipe') { pipeSlotScratch[pipes.length] = node.slot; pipes.push(node.entity); }
        const edges = node.edges;
        for (let j = 0; j < edges.length; j++) {
          slots[index++] = edges[j].a; slots[index++] = edges[j].b;
        }
      }
      page.edgeSlots = slots;
      page.nodeSlots = nodeSlots;
      page.pipes = pipes; page.pipeSlots = pipeSlotScratch.slice(0, pipes.length);
    }
  }
  // Canonical snapshots are compatibility/debug views only. The actual
  // physics consumes the already ordered pages and stable slots directly.
  entities() {
    const result: Entity[] = [];
    for (const key of this.keys) for (const node of this.blocks.get(key)!) if (node) result.push(node.entity);
    return result;
  }
  edgePairs() {
    const result: [Entity, Entity][] = [];
    for (const key of this.keys) for (const node of this.blocks.get(key)!) if (node)
      for (const edge of node.edges) result.push(edge.pair);
    return result;
  }
}

export class HeatNeighbors implements ReadonlyMap<number, number[]> {
  constructor(private storage: HeatStorage) {}
  get size() { return this.storage.count; }
  get(id: number) { return this.storage.get(id)?.neighbors; }
  has(id: number) { return !!this.storage.get(id); }
  *entries(): MapIterator<[number, number[]]> {
    for (const key of this.storage.keys) for (const node of this.storage.blocks.get(key)!)
      if (node) yield [node.entity.id, node.neighbors];
  }
  *keys(): MapIterator<number> { for (const [id] of this.entries()) yield id; }
  *values(): MapIterator<number[]> { for (const [, neighbors] of this.entries()) yield neighbors; }
  [Symbol.iterator]() { return this.entries(); }
  forEach(callback: (value: number[], key: number, map: ReadonlyMap<number, number[]>) => void, thisArg?: any) {
    for (const [id, neighbors] of this.entries()) callback.call(thisArg, neighbors, id, this);
  }
}
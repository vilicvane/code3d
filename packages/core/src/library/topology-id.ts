/** A result-local ID, or an input path ending in an earlier result's local ID. */
export type TopologyId = number | readonly [number, number, ...number[]];
export type VertexId = TopologyId;
export type EdgeId = TopologyId;
export type SurfaceId = TopologyId;
export type TopologyKind = 'vertex' | 'edge' | 'surface';

export function isTopologyId(value: unknown): value is TopologyId {
  const positiveInteger = (part: unknown): part is number =>
    typeof part === 'number' && Number.isSafeInteger(part) && part > 0;
  if (positiveInteger(value)) return true;
  if (!Array.isArray(value) || value.length < 2) return false;
  for (const part of value) if (!positiveInteger(part)) return false;
  return true;
}

export function topologyIdKey(id: TopologyId): string {
  return typeof id === 'number' ? String(id) : id.join('/');
}

export function sameTopologyId(
  left: TopologyId | undefined,
  right: TopologyId | undefined,
): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      topologyIdKey(left) === topologyIdKey(right))
  );
}

export function inheritedTopologyId(input: number, id: TopologyId): TopologyId {
  return typeof id === 'number' ? [input, id] : [input, ...id];
}

export function compareTopologyIds(
  left: TopologyId,
  right: TopologyId,
): number {
  if (typeof left === 'number')
    return typeof right === 'number' ? left - right : -1;
  if (typeof right === 'number') return 1;
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const difference = left[index] - right[index];
    if (difference) return difference;
  }
  return left.length - right.length;
}

export function formatTopologyId(kind: TopologyKind, id: TopologyId): string {
  const prefix = {vertex: 'V', edge: 'E', surface: 'S'}[kind];
  return `${prefix}${typeof id === 'number' ? id : `[${id.join(',')}]`}`;
}

/** Value equality also works for IDs reconstructed from source or a Worker. */
export class TopologyIdSet implements Iterable<TopologyId> {
  private readonly entries = new Map<string, TopologyId>();
  constructor(ids: Iterable<TopologyId> = []) {
    for (const id of ids) this.add(id);
  }
  get size(): number {
    return this.entries.size;
  }
  has(id: TopologyId): boolean {
    return this.entries.has(topologyIdKey(id));
  }
  add(id: TopologyId): this {
    this.entries.set(topologyIdKey(id), id);
    return this;
  }
  delete(id: TopologyId): boolean {
    return this.entries.delete(topologyIdKey(id));
  }
  clear(): void {
    this.entries.clear();
  }
  [Symbol.iterator](): MapIterator<TopologyId> {
    return this.entries.values();
  }
}

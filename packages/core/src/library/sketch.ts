/** Coordinates in a sketch's local two-dimensional plane. */
export type SketchPosition = readonly [x: number, y: number];

export type SketchEntry =
  | readonly [kind: 'point', id: number, position: SketchPosition]
  | readonly [
      kind: 'line',
      id: number,
      points: readonly [start: number | SketchPoint, end: number | SketchPoint],
    ];

/** A point reference carries its defining layer, not just a numeric ID. */
export interface SketchPoint {
  readonly sketch: Sketch;
  readonly id: number;
}

/** An immutable sketch definition, independent of B-Rep construction. */
export interface Sketch {
  /** References a point defined in this layer. */
  point(id: number): SketchPoint;
  /** Adds a local layer while retaining the upstream sketch as read-only input. */
  derive(entries: readonly SketchEntry[]): Sketch;
}

type Definition = Readonly<{
  base?: Sketch;
  /** Used only to identify the authored argument during source tracing. */
  input: readonly SketchEntry[];
  entries: readonly SketchEntry[];
  points: ReadonlyMap<number, SketchPosition>;
}>;

const definitions = new WeakMap<Sketch, Definition>();
const references = new WeakSet<SketchPoint>();

class SketchValue implements Sketch {
  constructor(entries: readonly SketchEntry[], base?: Sketch) {
    const ids = new Set<number>();
    const points = new Map<number, SketchPosition>();
    const copied = entries.map<SketchEntry>(entry => {
      const [kind, id, data] = entry;
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error('Sketch entity IDs must be positive safe integers.');
      if (ids.has(id)) throw new Error(`Duplicate sketch entity ID ${id}.`);
      ids.add(id);
      if (kind === 'point') {
        if (data.length !== 2 || !data.every(Number.isFinite))
          throw new Error(
            `Sketch point ${id} requires two finite coordinates.`,
          );
        const position: SketchPosition = [data[0], data[1]];
        points.set(id, position);
        return ['point', id, position];
      }
      if (kind !== 'line' || data.length !== 2)
        throw new Error(`Invalid sketch entity ${id}.`);
      return ['line', id, [data[0], data[1]]];
    });
    const ancestors = new Set<Sketch>();
    for (
      let ancestor = base;
      ancestor;
      ancestor = definitions.get(ancestor)?.base
    )
      ancestors.add(ancestor);
    for (const [kind, id, data] of copied) {
      if (kind !== 'line') continue;
      for (const ref of data) {
        if (typeof ref === 'number') {
          if (!points.has(ref))
            throw new Error(
              `Sketch line ${id} references missing local point ${ref}.`,
            );
        } else if (!references.has(ref) || !ancestors.has(ref.sketch)) {
          throw new Error(
            `Sketch line ${id} must reference a local or upstream point.`,
          );
        }
      }
    }
    definitions.set(this, {base, input: entries, entries: copied, points});
  }

  point(id: number): SketchPoint {
    if (!definitions.get(this)!.points.has(id))
      throw new Error(`Unknown local sketch point ${id}.`);
    const ref = {sketch: this, id};
    references.add(ref);
    return ref;
  }

  derive(entries: readonly SketchEntry[]): Sketch {
    return new SketchValue(entries, this);
  }
}

/** Defines a sketch using [kind, ID, data] tuples. IDs belong to this layer. */
export function sketch(entries: readonly SketchEntry[]): Sketch {
  return new SketchValue(entries);
}

export function isSketch(value: unknown): value is Sketch {
  return value instanceof SketchValue;
}

export function sketchDefinition(value: Sketch): Definition {
  return definitions.get(value)!;
}

export type SketchPointSnapshot = Readonly<{
  kind: 'point';
  id: number;
  position: SketchPosition;
}>;

export type SketchPointAddress = Readonly<{layer: string; id: number}>;

export type SketchLineSnapshot = Readonly<{
  kind: 'line';
  id: number;
  points: readonly [SketchPointAddress, SketchPointAddress];
}>;

/** Each snapshot contains only its own definitions; base retains the lineage. */
export type SketchSnapshot = Readonly<{
  id: string;
  base?: string;
  entities: readonly (SketchPointSnapshot | SketchLineSnapshot)[];
}>;

export function snapshotSketch(
  value: Sketch,
  identity: (sketch: Sketch) => string,
): SketchSnapshot {
  const {base, entries} = sketchDefinition(value);
  const id = identity(value);
  const point = (ref: number | SketchPoint): SketchPointAddress =>
    typeof ref === 'number'
      ? {layer: id, id: ref}
      : {layer: identity(ref.sketch), id: ref.id};
  return {
    id,
    base: base && identity(base),
    entities: entries.map(([kind, entityId, data]) =>
      kind === 'point'
        ? {kind, id: entityId, position: data}
        : {kind, id: entityId, points: [point(data[0]), point(data[1])]},
    ),
  };
}

import {
  solveSketchProblem,
  type SketchSolveProblem,
  type SketchSolveConstraint,
} from './sketch-solver.js';

/** Current coordinates in a sketch's local two-dimensional plane. */
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

/** Constraints are separate from geometry and do not have persistent IDs. */
export type SketchConstraint<P = number | SketchPoint> =
  | readonly [kind: 'fixed', point: P]
  | readonly [kind: 'horizontal' | 'vertical', line: number]
  | readonly [kind: 'coincident', points: readonly [P, P]]
  | readonly [
      kind: 'length' | 'angle',
      data: readonly [line: number, value: number],
    ]
  | readonly [kind: 'x' | 'y', data: readonly [point: P, value: number]];

export type SketchOptions = Readonly<{
  constraints?: readonly SketchConstraint[];
}>;

/** An immutable sketch definition, independent of B-Rep construction. */
export interface Sketch {
  /** References a point defined in this layer. */
  point(id: number): SketchPoint;
  /** Adds a local layer while retaining the upstream sketch as read-only input. */
  derive(entries: readonly SketchEntry[], options?: SketchOptions): Sketch;
}

type Definition = Readonly<{
  base?: Sketch;
  /** Used only to identify the authored argument during source tracing. */
  input: readonly SketchEntry[];
  inputOptions?: SketchOptions;
  entries: readonly SketchEntry[];
  constraints: readonly SketchConstraint[];
  points: ReadonlyMap<number, SketchPosition>;
  degreesOfFreedom: number;
  redundant: readonly number[];
}>;

const definitions = new WeakMap<Sketch, Definition>();
const references = new WeakSet<SketchPoint>();

class SketchValue implements Sketch {
  constructor(
    entries: readonly SketchEntry[],
    options?: SketchOptions,
    base?: Sketch,
  ) {
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
    const pointRef = (ref: number | SketchPoint) => {
      if (
        typeof ref === 'number'
          ? !points.has(ref)
          : !references.has(ref) || !ancestors.has(ref.sketch)
      )
        throw new Error(
          'Sketch constraints must reference a local or upstream point.',
        );
    };
    const lineRef = (id: number) => {
      if (!copied.some(e => e[0] === 'line' && e[1] === id))
        throw new Error(
          `Sketch constraint references missing local line ${id}.`,
        );
    };
    const constraints = (options?.constraints ?? []).map<SketchConstraint>(
      ([kind, data]) => {
        if (kind === 'fixed') {
          pointRef(data);
          return [kind, data];
        }
        if (kind === 'horizontal' || kind === 'vertical') {
          lineRef(data);
          return [kind, data];
        }
        if (kind === 'coincident') {
          data.forEach(pointRef);
          return [kind, [data[0], data[1]]];
        }
        if (
          kind === 'x' ||
          kind === 'y' ||
          kind === 'length' ||
          kind === 'angle'
        ) {
          if (kind === 'x' || kind === 'y') pointRef(data[0]);
          else lineRef(data[0] as number);
          if (!Number.isFinite(data[1]) || (kind === 'length' && data[1] <= 0))
            throw new Error(
              `Sketch ${kind} constraint requires ${kind === 'length' ? 'a positive' : 'a'} finite value.`,
            );
          return [kind, [data[0], data[1]]] as SketchConstraint;
        }
        throw new Error(`Unknown sketch constraint ${kind}.`);
      },
    );
    const local = 'local';
    const layers = new Map<Sketch, string>();
    const identity = (value: Sketch) => {
      let id = layers.get(value);
      if (!id) layers.set(value, (id = `upstream:${layers.size}`));
      return id;
    };
    const snapshots = [...ancestors]
      .reverse()
      .map(value => snapshotSketch(value, identity));
    const unresolved: SketchSnapshot = {
      id: local,
      entities: snapshotEntries(copied, local, identity),
      constraints: snapshotConstraints(constraints, local, identity),
      degreesOfFreedom: 0,
      redundant: [],
    };
    const solved = solveSketchSnapshot([...snapshots, unresolved]);
    for (const entity of solved.entities)
      if (entity.kind === 'point') points.set(entity.id, entity.position);
    definitions.set(this, {
      base,
      input: entries,
      inputOptions: options,
      entries: copied,
      constraints,
      points,
      degreesOfFreedom: solved.degreesOfFreedom,
      redundant: solved.redundant,
    });
  }

  point(id: number): SketchPoint {
    if (!definitions.get(this)!.points.has(id))
      throw new Error(`Unknown local sketch point ${id}.`);
    const ref = {sketch: this, id};
    references.add(ref);
    return ref;
  }

  derive(entries: readonly SketchEntry[], options?: SketchOptions): Sketch {
    return new SketchValue(entries, options, this);
  }
}

/** Defines a sketch using [kind, ID, data] tuples. IDs belong to this layer. */
export function sketch(
  entries: readonly SketchEntry[],
  options?: SketchOptions,
): Sketch {
  return new SketchValue(entries, options);
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
  constraints: readonly SketchConstraint<SketchPointAddress>[];
  degreesOfFreedom: number;
  /** Evaluation-local indices into constraints, not persistent identity. */
  redundant: readonly number[];
}>;

export function snapshotSketch(
  value: Sketch,
  identity: (sketch: Sketch) => string,
): SketchSnapshot {
  const {base, entries, constraints, points, degreesOfFreedom, redundant} =
    sketchDefinition(value);
  const id = identity(value);
  return {
    id,
    base: base && identity(base),
    entities: snapshotEntries(entries, id, identity).map(e =>
      e.kind === 'point' ? {...e, position: points.get(e.id)!} : e,
    ),
    constraints: snapshotConstraints(constraints, id, identity),
    degreesOfFreedom,
    redundant,
  };
}

function pointAddress(id: string, identity: (sketch: Sketch) => string) {
  return (ref: number | SketchPoint): SketchPointAddress =>
    typeof ref === 'number'
      ? {layer: id, id: ref}
      : {layer: identity(ref.sketch), id: ref.id};
}

function snapshotEntries(
  entries: readonly SketchEntry[],
  id: string,
  identity: (sketch: Sketch) => string,
): SketchSnapshot['entities'] {
  const point = pointAddress(id, identity);
  return entries.map(([kind, entityId, data]) =>
    kind === 'point'
      ? {kind, id: entityId, position: data}
      : {kind, id: entityId, points: [point(data[0]), point(data[1])]},
  );
}

function snapshotConstraints(
  constraints: readonly SketchConstraint[],
  id: string,
  identity: (sketch: Sketch) => string,
): SketchSnapshot['constraints'] {
  const point = pointAddress(id, identity);
  return constraints.map(([kind, data]) => {
    switch (kind) {
      case 'fixed':
        return [kind, point(data)];
      case 'coincident':
        return [kind, [point(data[0]), point(data[1])]];
      case 'x':
      case 'y':
        return [kind, [point(data[0]), data[1]]];
      case 'horizontal':
      case 'vertical':
        return [kind, data];
      case 'length':
      case 'angle':
        return [kind, data];
    }
  });
}

/** The same solver and snapshot contract serve evaluation and interactive dragging. */
export function solveSketchSnapshot(
  layers: readonly SketchSnapshot[],
  drag?: Readonly<{
    id: number;
    position: SketchPosition;
    /** Numeric, gesture-only locks on local coordinates; never author constraints. */
    locks?: readonly Readonly<{id: number; axis: 0 | 1; value: number}>[];
  }>,
): SketchSnapshot {
  const local = layers.at(-1)!;
  const points = layers.flatMap(layer =>
    layer.entities.flatMap(e =>
      e.kind === 'point' ? [{...e, layer: layer.id}] : [],
    ),
  );
  const pointIndex = (ref: SketchPointAddress) => {
    const index = points.findIndex(
      p => p.id === ref.id && p.layer === ref.layer,
    );
    if (index < 0) throw new Error(`Missing sketch point ${ref.id}.`);
    return index;
  };
  const linePoints = (id: number): readonly [number, number] => {
    const line = local.entities.find(e => e.kind === 'line' && e.id === id) as
      SketchLineSnapshot | undefined;
    if (!line) throw new Error(`Missing sketch line ${id}.`);
    return [pointIndex(line.points[0]), pointIndex(line.points[1])];
  };
  const constraints = local.constraints.map<SketchSolveConstraint>(
    ([kind, data]) => {
      switch (kind) {
        case 'fixed': {
          const point = pointIndex(data);
          return {kind, point, position: points[point].position};
        }
        case 'x':
        case 'y':
          return {kind, point: pointIndex(data[0]), value: data[1]};
        case 'horizontal':
        case 'vertical':
          return {kind, points: linePoints(data)};
        case 'coincident':
          return {kind, points: [pointIndex(data[0]), pointIndex(data[1])]};
        case 'length':
        case 'angle':
          return {kind, points: linePoints(data[0]), value: data[1]};
      }
    },
  );
  const problem: SketchSolveProblem = {
    points: points.map(p => {
      const position: [number, number] = [...p.position];
      const upstream = p.layer !== local.id;
      const locked: [boolean, boolean] = [upstream, upstream];
      if (!upstream)
        for (const lock of drag?.locks ?? [])
          if (lock.id === p.id) {
            position[lock.axis] = lock.value;
            locked[lock.axis] = true;
          }
      return {position, locked};
    }),
    constraints,
  };
  const result = solveSketchProblem(
    // Applying authored coordinate locks can change the displayed geometry.
    // Satisfy those locks before choosing a gesture anchor, otherwise the old
    // anchor can contradict a perfectly valid set of persistent constraints.
    drag &&
      problem.points.some((p, i) =>
        p.position.some((v, axis) => v !== points[i].position[axis]),
      )
      ? {
          ...problem,
          points: solveSketchProblem(problem).positions.map((position, i) => ({
            ...problem.points[i],
            position,
          })),
        }
      : problem,
    drag && {
      point: pointIndex({layer: local.id, id: drag.id}),
      position: drag.position,
    },
  );
  const entities = local.entities.map(e =>
    e.kind === 'point'
      ? {
          ...e,
          position: result.positions[pointIndex({layer: local.id, id: e.id})],
        }
      : e,
  );
  for (const entity of entities) {
    if (entity.kind !== 'line') continue;
    const [a, b] = entity.points.map(p => result.positions[pointIndex(p)]);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) === 0)
      throw new Error(`Sketch line ${entity.id} has zero length.`);
  }
  return {
    ...local,
    entities,
    degreesOfFreedom: drag ? local.degreesOfFreedom : result.degreesOfFreedom,
    redundant: drag ? local.redundant : result.redundant,
  };
}

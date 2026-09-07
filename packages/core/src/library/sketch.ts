import {
  solveSketchProblem,
  type SketchSolveProblem,
  type SketchSolveConstraint,
} from './sketch-solver.js';

/** Current coordinates in a sketch's local two-dimensional plane. */
export type SketchPosition = readonly [x: number, y: number];
export type SketchArcDirection = 'cw' | 'ccw';

export type SketchEntry =
  | readonly [kind: 'point', id: number, position: SketchPosition]
  | readonly [
      kind: 'line',
      id: number,
      points: readonly [start: number | SketchPoint, end: number | SketchPoint],
    ]
  | readonly [
      kind: 'circle',
      id: number,
      data: readonly [center: number | SketchPoint, radius: number],
    ]
  | readonly [
      kind: 'arc',
      id: number,
      data: readonly [
        center: number | SketchPoint,
        radius: number,
        start: number | SketchPoint,
        end: number | SketchPoint,
        direction: SketchArcDirection,
      ],
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
      kind: 'midpoint',
      points: readonly [midpoint: P, start: P, end: P],
    ]
  | readonly [
      kind: 'length' | 'angle' | 'radius' | 'sweep',
      data: readonly [curve: number, value: number],
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
  radii: ReadonlyMap<number, number>;
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
      if (kind === 'circle' || kind === 'arc') {
        if (!Number.isFinite(data[1]) || data[1] <= 0)
          throw new Error(
            `Sketch ${kind} ${id} requires a positive finite radius.`,
          );
      }
      if (kind === 'circle') {
        if (data.length !== 2)
          throw new Error(`Sketch circle ${id} requires center and radius.`);
        return ['circle', id, [data[0], data[1]]];
      }
      if (kind === 'arc') {
        if (data.length !== 5 || (data[4] !== 'cw' && data[4] !== 'ccw'))
          throw new Error(
            `Sketch arc ${id} requires center, radius, start, end and cw/ccw direction.`,
          );
        return ['arc', id, [data[0], data[1], data[2], data[3], data[4]]];
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
      if (kind === 'point') continue;
      const refs =
        kind === 'circle'
          ? [data[0]]
          : kind === 'arc'
            ? [data[0], data[2], data[3]]
            : data;
      for (const ref of refs) {
        if (typeof ref === 'number') {
          if (!points.has(ref))
            throw new Error(
              `Sketch ${kind} ${id} references missing local point ${ref}.`,
            );
        } else if (!references.has(ref) || !ancestors.has(ref.sketch)) {
          throw new Error(
            `Sketch ${kind} ${id} must reference a local or upstream point.`,
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
    const curveRef = (id: number, kind: 'line' | 'arc' | 'circular curve') => {
      if (
        !copied.some(
          e =>
            (kind === 'circular curve'
              ? e[0] === 'circle' || e[0] === 'arc'
              : e[0] === kind) && e[1] === id,
        )
      )
        throw new Error(
          `Sketch constraint references missing local ${kind} ${id}.`,
        );
    };
    const constraints = (options?.constraints ?? []).map<SketchConstraint>(
      ([kind, data]) => {
        if (kind === 'fixed') {
          pointRef(data);
          return [kind, data];
        }
        if (kind === 'horizontal' || kind === 'vertical') {
          curveRef(data, 'line');
          return [kind, data];
        }
        if (kind === 'coincident') {
          data.forEach(pointRef);
          return [kind, [data[0], data[1]]];
        }
        if (kind === 'midpoint') {
          if (data.length !== 3)
            throw new Error(
              'Sketch midpoint constraint requires three points.',
            );
          data.forEach(pointRef);
          return [kind, [data[0], data[1], data[2]]];
        }
        if (
          kind === 'x' ||
          kind === 'y' ||
          kind === 'length' ||
          kind === 'angle' ||
          kind === 'radius' ||
          kind === 'sweep'
        ) {
          if (kind === 'x' || kind === 'y') pointRef(data[0]);
          else
            curveRef(
              data[0] as number,
              kind === 'radius'
                ? 'circular curve'
                : kind === 'sweep'
                  ? 'arc'
                  : 'line',
            );
          if (kind === 'sweep' && !(data[1] > 0 && data[1] < 360))
            throw new Error(
              'Sketch sweep constraint requires degrees strictly between 0 and 360.',
            );
          const positive = kind === 'length' || kind === 'radius';
          if (!Number.isFinite(data[1]) || (positive && data[1] <= 0))
            throw new Error(
              `Sketch ${kind} constraint requires ${positive ? 'a positive' : 'a'} finite value.`,
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
    const radii = new Map<number, number>();
    for (const entity of solved.entities)
      if (entity.kind === 'point') points.set(entity.id, entity.position);
      else if (entity.kind === 'circle' || entity.kind === 'arc')
        radii.set(entity.id, entity.radius);
    definitions.set(this, {
      base,
      input: entries,
      inputOptions: options,
      entries: copied,
      constraints,
      points,
      radii,
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

export type SketchCircleSnapshot = Readonly<{
  kind: 'circle';
  id: number;
  center: SketchPointAddress;
  radius: number;
}>;

export type SketchArcSnapshot = Readonly<{
  kind: 'arc';
  id: number;
  center: SketchPointAddress;
  radius: number;
  points: readonly [SketchPointAddress, SketchPointAddress];
  direction: SketchArcDirection;
}>;

export type SketchEntitySnapshot =
  | SketchPointSnapshot
  | SketchLineSnapshot
  | SketchCircleSnapshot
  | SketchArcSnapshot;

/** Numeric geometry parameters, excluding identity and point references. */
export function sketchEntityParameters(
  entity: SketchEntitySnapshot,
): readonly number[] {
  switch (entity.kind) {
    case 'point':
      return entity.position;
    case 'circle':
    case 'arc':
      return [entity.radius];
    case 'line':
      return [];
  }
}

export function withSketchEntityParameters(
  entity: SketchEntitySnapshot,
  parameters: readonly number[],
): SketchEntitySnapshot {
  switch (entity.kind) {
    case 'point':
      return {...entity, position: [parameters[0], parameters[1]]};
    case 'circle':
    case 'arc':
      return {...entity, radius: parameters[0]};
    case 'line':
      return entity;
  }
}

/** Each snapshot contains only its own definitions; base retains the lineage. */
export type SketchSnapshot = Readonly<{
  id: string;
  base?: string;
  entities: readonly SketchEntitySnapshot[];
  constraints: readonly SketchConstraint<SketchPointAddress>[];
  degreesOfFreedom: number;
  /** Evaluation-local indices into constraints, not persistent identity. */
  redundant: readonly number[];
}>;

export function snapshotSketch(
  value: Sketch,
  identity: (sketch: Sketch) => string,
): SketchSnapshot {
  const {
    base,
    entries,
    constraints,
    points,
    radii,
    degreesOfFreedom,
    redundant,
  } = sketchDefinition(value);
  const id = identity(value);
  return {
    id,
    base: base && identity(base),
    entities: snapshotEntries(entries, id, identity).map(e =>
      e.kind === 'point'
        ? {...e, position: points.get(e.id)!}
        : e.kind === 'circle' || e.kind === 'arc'
          ? {...e, radius: radii.get(e.id)!}
          : e,
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
      : kind === 'circle'
        ? {kind, id: entityId, center: point(data[0]), radius: data[1]}
        : kind === 'arc'
          ? {
              kind,
              id: entityId,
              center: point(data[0]),
              radius: data[1],
              points: [point(data[2]), point(data[3])],
              direction: data[4],
            }
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
      case 'midpoint':
        return [kind, [point(data[0]), point(data[1]), point(data[2])]];
      case 'x':
      case 'y':
        return [kind, [point(data[0]), data[1]]];
      case 'horizontal':
      case 'vertical':
        return [kind, data];
      case 'length':
      case 'angle':
      case 'radius':
      case 'sweep':
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
    /** Numeric, gesture-only parameter locks; never author constraints. */
    locks?: readonly Readonly<{id: number; parameter: number; value: number}>[];
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
  const circles = layers.flatMap(layer =>
    layer.entities.flatMap(e =>
      e.kind === 'circle' ? [{...e, layer: layer.id}] : [],
    ),
  );
  const circleIndex = (id: number) => {
    const index = circles.findIndex(c => c.id === id && c.layer === local.id);
    if (index < 0) throw new Error(`Missing sketch circle ${id}.`);
    return index;
  };
  const arcs = local.entities.filter(e => e.kind === 'arc');
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
        case 'midpoint':
          return {
            kind,
            points: [
              pointIndex(data[0]),
              pointIndex(data[1]),
              pointIndex(data[2]),
            ],
          };
        case 'length':
        case 'angle':
          return {kind, points: linePoints(data[0]), value: data[1]};
        case 'radius':
          return arcs.some(a => a.id === data[0])
            ? {
                kind,
                curve: 'arc',
                index: arcs.findIndex(a => a.id === data[0]),
                value: data[1],
              }
            : {
                kind,
                curve: 'circle',
                index: circleIndex(data[0]),
                value: data[1],
              };
        case 'sweep':
          return {
            kind,
            index: arcs.findIndex(a => a.id === data[0]),
            value: data[1],
          };
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
            position[lock.parameter as 0 | 1] = lock.value;
            locked[lock.parameter as 0 | 1] = true;
          }
      return {position, locked};
    }),
    lines: local.entities
      .filter(e => e.kind === 'line')
      .map(e => [pointIndex(e.points[0]), pointIndex(e.points[1])]),
    circles: circles.map(c => {
      const upstream = c.layer !== local.id;
      const lock = !upstream && drag?.locks?.find(lock => lock.id === c.id);
      return {
        center: pointIndex(c.center),
        radius: lock ? lock.value : c.radius,
        locked: upstream || !!lock,
      };
    }),
    arcs: arcs.map(a => {
      const lock = drag?.locks?.find(lock => lock.id === a.id);
      return {
        center: pointIndex(a.center),
        radius: lock ? lock.value : a.radius,
        locked: !!lock,
        points: [pointIndex(a.points[0]), pointIndex(a.points[1])],
        direction: a.direction,
      };
    }),
    constraints,
  };
  const target = drag && local.entities.find(e => e.id === drag.id)!;
  const objective =
    drag &&
    target &&
    (target.kind === 'circle' || target.kind === 'arc'
      ? {
          kind: 'radius' as const,
          curve: target.kind,
          index:
            target.kind === 'circle'
              ? circleIndex(target.id)
              : arcs.findIndex(a => a.id === target.id),
          value: Math.hypot(
            ...drag.position.map(
              (v, axis) => v - points[pointIndex(target.center)].position[axis],
            ),
          ),
        }
      : {
          kind: 'point' as const,
          point: pointIndex({layer: local.id, id: drag.id}),
          position: drag.position,
        });
  const result = solveSketchProblem(
    // Applying authored coordinate locks can change the displayed geometry.
    // Satisfy those locks before choosing a gesture anchor, otherwise the old
    // anchor can contradict a perfectly valid set of persistent constraints.
    drag &&
      (problem.points.some((p, i) =>
        p.position.some((v, axis) => v !== points[i].position[axis]),
      ) ||
        problem.circles.some((c, i) => c.radius !== circles[i].radius) ||
        problem.arcs.some((a, i) => a.radius !== arcs[i].radius))
      ? solvedProblem(problem)
      : problem,
    objective,
  );
  const entities = local.entities.map(e =>
    e.kind === 'point'
      ? {
          ...e,
          position: result.positions[pointIndex({layer: local.id, id: e.id})],
        }
      : e.kind === 'circle'
        ? {...e, radius: result.radii[circleIndex(e.id)]}
        : e.kind === 'arc'
          ? {...e, radius: result.arcRadii[arcs.findIndex(a => a.id === e.id)]}
          : e,
  );
  for (const entity of entities) {
    if (
      (entity.kind === 'circle' || entity.kind === 'arc') &&
      (!Number.isFinite(entity.radius) || entity.radius <= 0)
    )
      throw new Error(
        `Sketch ${entity.kind} ${entity.id} requires a positive finite radius.`,
      );
    if (entity.kind === 'arc') {
      const [center, a, b] = [entity.center, ...entity.points].map(
        p => result.positions[pointIndex(p)],
      );
      if (
        Math.hypot(a[0] - center[0], a[1] - center[1]) === 0 ||
        Math.hypot(a[0] - b[0], a[1] - b[1]) === 0
      )
        throw new Error(
          `Sketch arc ${entity.id} requires a nonzero radius and distinct endpoints; use circle for a full circle.`,
        );
    }
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

function solvedProblem(problem: SketchSolveProblem): SketchSolveProblem {
  const solved = solveSketchProblem(problem);
  return {
    ...problem,
    points: problem.points.map((p, i) => ({
      ...p,
      position: solved.positions[i],
    })),
    circles: problem.circles.map((c, i) => ({...c, radius: solved.radii[i]})),
    arcs: problem.arcs.map((a, i) => ({...a, radius: solved.arcRadii[i]})),
  };
}

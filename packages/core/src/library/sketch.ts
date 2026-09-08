import {
  solveSketchProblem,
  type SketchSolveProblem,
  type SketchSolveConstraint,
} from './sketch-solver.js';
import {solveSketchDrag} from './sketch-drag-rules.js';
import {sketchRegions} from './sketch-regions.js';
import {
  sketchFaceModel,
  disposeModelObjects,
  isModelObject,
  type FaceModel,
} from './runtime.js';
import {
  sketchIncidences,
  sketchIncidencePoints,
  sketchIncidenceCurve,
  isPointOnSketchCurve,
  type SketchIncidenceGeometry,
} from './sketch-incidence.js';

/** Current coordinates in a sketch's local two-dimensional plane. */
export type SketchPosition = readonly [x: number, y: number];
export type SketchArcDirection = 'cw' | 'ccw';

export type SketchEntry =
  | readonly [
      kind: 'point',
      id: number,
      data: SketchPosition | number | SketchPoint,
    ]
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
  | readonly [
      kind: 'parallel' | 'perpendicular',
      lines: readonly [number, number],
    ]
  /** Signed rotation from the first line's authored direction to the second, in degrees. */
  | readonly [kind: 'angle', lines: readonly [number, number], value: number]
  | readonly [kind: 'coincident', points: readonly [P, P]]
  | readonly [
      kind: 'midpoint',
      points: readonly [midpoint: P, start: P, end: P],
    ]
  | readonly [
      kind: 'length' | 'angle' | 'radius' | 'sweep',
      curve: number,
      value: number,
    ]
  | readonly [kind: 'x' | 'y', point: P, value: number];

export type SketchOptions = Readonly<{
  constraints?: readonly SketchConstraint[];
}>;

/** An immutable sketch definition, independent of B-Rep construction. */
export interface Sketch {
  /** References a point defined in this layer. */
  point(id: number): SketchPoint;
  /** Adds a local layer while retaining the upstream sketch as read-only input. */
  derive(entries?: readonly SketchEntry[], options?: SketchOptions): Sketch;
  /** Creates the only closed region, including holes. Requires exactly one face. */
  face(): FaceModel;
  /** Creates all closed regions, including upstream boundaries. Returns an ordinary array. */
  faces(): readonly FaceModel[];
}

type Definition = Readonly<{
  base?: Sketch;
  /** Used only to identify the authored argument during source tracing. */
  input?: readonly SketchEntry[];
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
    entries?: readonly SketchEntry[],
    options?: SketchOptions,
    base?: Sketch,
  ) {
    const ids = new Set<number>();
    const points = new Map<number, SketchPosition>();
    const copied = (entries ?? []).map<SketchEntry>(entry => {
      const [kind, id, data] = entry;
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error('Sketch entity IDs must be positive safe integers.');
      if (ids.has(id)) throw new Error(`Duplicate sketch entity ID ${id}.`);
      ids.add(id);
      if (kind === 'point') {
        if (!Array.isArray(data)) return ['point', id, data];
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
      if (kind === 'point' && Array.isArray(data)) continue;
      const refs =
        kind === 'point'
          ? [data as number | SketchPoint]
          : kind === 'circle'
            ? [data[0]]
            : kind === 'arc'
              ? [data[0], data[2], data[3]]
              : data;
      for (const ref of refs) {
        if (typeof ref === 'number') {
          if (!copied.some(e => e[0] === 'point' && e[1] === ref))
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
    const resolving = new Set<number>();
    const resolve = (id: number): SketchPosition => {
      const position = points.get(id);
      if (position) return position;
      if (resolving.has(id))
        throw new Error(`Cyclic sketch point alias at ${id}.`);
      resolving.add(id);
      const entry = copied.find(e => e[0] === 'point' && e[1] === id)!;
      const ref = entry[2] as number | SketchPoint;
      const resolved =
        typeof ref === 'number'
          ? resolve(ref)
          : definitions.get(ref.sketch)!.points.get(ref.id)!;
      resolving.delete(id);
      points.set(id, resolved);
      return resolved;
    };
    for (const [kind, id] of copied) if (kind === 'point') resolve(id);
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
      ([kind, data, value]) => {
        if (kind === 'fixed') {
          pointRef(data);
          return [kind, data];
        }
        if (kind === 'horizontal' || kind === 'vertical') {
          curveRef(data, 'line');
          return [kind, data];
        }
        if (
          kind === 'parallel' ||
          kind === 'perpendicular' ||
          (kind === 'angle' && typeof data !== 'number')
        ) {
          if (!Array.isArray(data) || data.length !== 2 || data[0] === data[1])
            throw new Error(
              `Sketch ${kind} constraint requires two distinct local lines.`,
            );
          data.forEach(id => curveRef(id, 'line'));
          if (kind === 'angle') {
            if (!Number.isFinite(value))
              throw new Error(
                'Sketch angle constraint requires a finite value.',
              );
            return [kind, [data[0], data[1]], value];
          }
          return [kind, [data[0], data[1]]];
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
          if (kind === 'x' || kind === 'y') pointRef(data);
          else
            curveRef(
              data as number,
              kind === 'radius'
                ? 'circular curve'
                : kind === 'sweep'
                  ? 'arc'
                  : 'line',
            );
          if (kind === 'sweep' && !(value > 0 && value < 360))
            throw new Error(
              'Sketch sweep constraint requires degrees strictly between 0 and 360.',
            );
          const positive = kind === 'length' || kind === 'radius';
          if (!Number.isFinite(value) || (positive && value <= 0))
            throw new Error(
              `Sketch ${kind} constraint requires ${positive ? 'a positive' : 'a'} finite value.`,
            );
          return [kind, data, value] as SketchConstraint;
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
      entities: snapshotEntries(copied, local, identity, points),
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

  derive(entries?: readonly SketchEntry[], options?: SketchOptions): Sketch {
    return new SketchValue(entries, options, this);
  }

  face(): FaceModel {
    const regions = sketchRegions(this.layers());
    if (regions.length !== 1)
      throw new Error(
        `sketch.face() requires exactly one closed region; found ${regions.length}. Use faces() for multiple regions.`,
      );
    return sketchFaceModel(regions[0]);
  }

  faces(): readonly FaceModel[] {
    const faces: FaceModel[] = [];
    try {
      for (const region of sketchRegions(this.layers()))
        faces.push(sketchFaceModel(region));
      return faces;
    } catch (error) {
      disposeModelObjects(
        faces.flatMap(face => (isModelObject(face) ? [face] : [])),
      );
      throw error;
    }
  }

  private layers(): readonly SketchSnapshot[] {
    const values: Sketch[] = [];
    for (
      let value: Sketch | undefined = this;
      value;
      value = definitions.get(value)!.base
    )
      values.unshift(value);
    return values.map(value =>
      snapshotSketch(value, s => String(values.indexOf(s))),
    );
  }
}

/** Defines a sketch using [kind, ID, data] tuples. IDs belong to this layer. */
export function sketch(
  entries?: readonly SketchEntry[],
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
  /** Same geometric point, retaining this authored ID for references. */
  alias?: SketchPointAddress;
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
      return entity.alias ? [] : entity.position;
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
      return entity.alias
        ? entity
        : {...entity, position: [parameters[0], parameters[1]]};
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
    entities: snapshotEntries(entries, id, identity, points).map(e =>
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
  positions: ReadonlyMap<number, SketchPosition>,
): SketchSnapshot['entities'] {
  const point = pointAddress(id, identity);
  return entries.map(([kind, entityId, data]) =>
    kind === 'point'
      ? Array.isArray(data)
        ? {kind, id: entityId, position: data as SketchPosition}
        : {
            kind,
            id: entityId,
            position: positions.get(entityId)!,
            alias: point(data as number | SketchPoint),
          }
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

/** Resolve identity once for solving, dragging, snapping and topology edits. */
export function sketchPointResolver(layers: readonly SketchSnapshot[]) {
  const points = new Map(
    layers.flatMap(layer =>
      layer.entities.flatMap(e =>
        e.kind === 'point'
          ? [
              [
                JSON.stringify([layer.id, e.id]),
                {...e, layer: layer.id},
              ] as const,
            ]
          : [],
      ),
    ),
  );
  const resolved = new Map<string, SketchPointAddress>();
  const visiting = new Set<string>();
  const resolve = (ref: SketchPointAddress): SketchPointAddress => {
    const key = JSON.stringify([ref.layer, ref.id]);
    const cached = resolved.get(key);
    if (cached) return cached;
    const point = points.get(key);
    if (!point) throw new Error(`Missing sketch point ${ref.id}.`);
    if (visiting.has(key))
      throw new Error(`Cyclic sketch point alias at ${ref.id}.`);
    visiting.add(key);
    const target = point.alias
      ? resolve(point.alias)
      : {layer: ref.layer, id: ref.id};
    visiting.delete(key);
    resolved.set(key, target);
    return target;
  };
  for (const point of points.values()) resolve(point);
  return resolve;
}

function snapshotConstraints(
  constraints: readonly SketchConstraint[],
  id: string,
  identity: (sketch: Sketch) => string,
): SketchSnapshot['constraints'] {
  const point = pointAddress(id, identity);
  return constraints.map(([kind, data, value]) => {
    switch (kind) {
      case 'fixed':
        return [kind, point(data)];
      case 'coincident':
        return [kind, [point(data[0]), point(data[1])]];
      case 'midpoint':
        return [kind, [point(data[0]), point(data[1]), point(data[2])]];
      case 'x':
      case 'y':
        return [kind, point(data), value];
      case 'horizontal':
      case 'vertical':
        return [kind, data];
      case 'parallel':
      case 'perpendicular':
        return [kind, [data[0], data[1]]];
      case 'length':
      case 'radius':
      case 'sweep':
        return [kind, data, value];
      case 'angle':
        return typeof data === 'number'
          ? [kind, data, value]
          : [kind, [data[0], data[1]], value];
    }
  });
}

function sketchGeometry(layers: readonly SketchSnapshot[]) {
  const resolve = sketchPointResolver(layers);
  // Array order is source layout, not numeric priority. Keep a stable local
  // parameter basis (including the normalization origin), without reordering
  // author entries, snapshots, layers, or constraint diagnostic indices.
  const entities = layers.flatMap(layer =>
    [...layer.entities]
      .sort((a, b) => a.id - b.id)
      .map(e => ({...e, layer: layer.id})),
  );
  const points = entities.filter(e => e.kind === 'point').filter(e => !e.alias);
  const pointIndex = (ref: SketchPointAddress) => {
    ref = resolve(ref);
    const index = points.findIndex(
      p => p.id === ref.id && p.layer === ref.layer,
    );
    if (index < 0) throw new Error(`Missing sketch point ${ref.id}.`);
    return index;
  };
  const lines = entities
    .filter(e => e.kind === 'line')
    .map(e => [pointIndex(e.points[0]), pointIndex(e.points[1])] as const);
  const circles = entities.filter(e => e.kind === 'circle');
  const arcs = entities.filter(e => e.kind === 'arc');
  const geometry: SketchIncidenceGeometry = {
    points: points.map(p => p.position),
    lines,
    circles: circles.map(c => ({
      center: pointIndex(c.center),
      radius: c.radius,
    })),
    arcs: arcs.map(a => ({
      center: pointIndex(a.center),
      radius: a.radius,
      points: [pointIndex(a.points[0]), pointIndex(a.points[1])],
      direction: a.direction,
    })),
  };
  return {points, pointIndex, lines, circles, arcs, geometry};
}

/** Includes gesture-only equations, not merely authored constraints. */
export function sketchDragRequiresSolver(
  layers: readonly SketchSnapshot[],
): boolean {
  const local = layers.at(-1)!;
  if (
    local.constraints.length ||
    layers.some(layer => layer.entities.some(e => e.kind === 'arc'))
  )
    return true;
  const {points, geometry} = sketchGeometry(layers);
  return sketchIncidences(geometry).some(contact =>
    sketchIncidencePoints(geometry, contact).some(
      i => points[i].layer === local.id,
    ),
  );
}

/** Source replay must retain every gesture-start incidence, including aliases. */
export function assertSketchDragConnections(
  layers: readonly SketchSnapshot[],
  reference: SketchSnapshot,
): void {
  const original = sketchGeometry([...layers.slice(0, -1), reference]);
  const current = sketchGeometry(layers);
  for (const contact of sketchIncidences(original.geometry)) {
    const point =
      current.points[current.pointIndex(original.points[contact.point])]
        .position;
    if (
      !isPointOnSketchCurve(
        point,
        sketchIncidenceCurve(current.geometry, contact),
      )
    )
      throw new Error(
        'The source replay could not retain a point on its curve. No changes were applied.',
      );
  }
}

/** The same solver and snapshot contract serve evaluation and interactive dragging. */
export function solveSketchSnapshot(
  layers: readonly SketchSnapshot[],
  drag?: Readonly<{
    id: number;
    position: SketchPosition;
    /** Gesture-start geometry; previous-frame geometry remains the numeric seed. */
    reference?: SketchSnapshot;
    /** Numeric, gesture-only parameter locks; never author constraints. */
    locks?: readonly Readonly<{id: number; parameter: number; value: number}>[];
  }>,
): SketchSnapshot {
  const local = layers.at(-1)!;
  const {points, pointIndex, lines, circles, arcs, geometry} =
    sketchGeometry(layers);
  const linePoints = (id: number): readonly [number, number] => {
    const line = local.entities.find(e => e.kind === 'line' && e.id === id) as
      SketchLineSnapshot | undefined;
    if (!line) throw new Error(`Missing sketch line ${id}.`);
    return [pointIndex(line.points[0]), pointIndex(line.points[1])];
  };
  const circleIndex = (id: number) => {
    const index = circles.findIndex(c => c.id === id && c.layer === local.id);
    if (index < 0) throw new Error(`Missing sketch circle ${id}.`);
    return index;
  };
  const arcIndex = (id: number) =>
    arcs.findIndex(a => a.id === id && a.layer === local.id);
  const constraints = local.constraints.map<SketchSolveConstraint>(
    ([kind, data, value]) => {
      switch (kind) {
        case 'fixed': {
          const point = pointIndex(data);
          return {kind, point, position: points[point].position};
        }
        case 'x':
        case 'y':
          return {kind, point: pointIndex(data), value};
        case 'horizontal':
        case 'vertical':
          return {kind, points: linePoints(data)};
        case 'parallel':
        case 'perpendicular':
          return {
            kind,
            points: [...linePoints(data[0]), ...linePoints(data[1])],
          };
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
          return {kind, points: linePoints(data), value};
        case 'angle':
          return typeof data === 'number'
            ? {kind, points: linePoints(data), value}
            : {
                kind: 'lineAngle',
                points: [...linePoints(data[0]), ...linePoints(data[1])],
                value,
              };
        case 'radius':
          return arcIndex(data) >= 0
            ? {
                kind,
                curve: 'arc',
                index: arcIndex(data),
                value,
              }
            : {
                kind,
                curve: 'circle',
                index: circleIndex(data),
                value,
              };
        case 'sweep':
          return {
            kind,
            index: arcIndex(data),
            value,
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
          if (
            local.entities.some(e => e.kind === 'point' && e.id === lock.id) &&
            pointIndex({layer: local.id, id: lock.id}) === pointIndex(p)
          ) {
            position[lock.parameter as 0 | 1] = lock.value;
            locked[lock.parameter as 0 | 1] = true;
          }
      return {position, locked};
    }),
    lines,
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
      const upstream = a.layer !== local.id;
      const lock = !upstream && drag?.locks?.find(lock => lock.id === a.id);
      return {
        center: pointIndex(a.center),
        radius: lock ? lock.value : a.radius,
        locked: upstream || !!lock,
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
              : arcIndex(target.id),
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
  const prepared =
    // Applying authored coordinate locks can change the displayed geometry.
    // Satisfy those locks before matching a drag rule or preparing its reference.
    drag &&
    (problem.points.some((p, i) =>
      p.position.some((v, axis) => v !== points[i].position[axis]),
    ) ||
      problem.circles.some((c, i) => c.radius !== circles[i].radius) ||
      problem.arcs.some((a, i) => a.radius !== arcs[i].radius))
      ? solvedProblem(problem)
      : problem;
  const referenceEntities = new Map(
    drag?.reference?.entities.map(e => [e.id, e]),
  );
  const reference = drag?.reference
    ? solvedProblem({
        ...prepared,
        points: prepared.points.map((p, index) => {
          const entity =
            points[index].layer === local.id &&
            referenceEntities.get(points[index].id);
          return entity && entity.kind === 'point'
            ? {
                ...p,
                position: p.position.map((v, axis) =>
                  p.locked[axis] ? v : entity.position[axis],
                ) as [number, number],
              }
            : p;
        }),
        circles: prepared.circles.map((c, index) => {
          const entity =
            circles[index].layer === local.id &&
            referenceEntities.get(circles[index].id);
          return !c.locked && entity && entity.kind === 'circle'
            ? {...c, radius: entity.radius}
            : c;
        }),
        arcs: prepared.arcs.map((a, index) => {
          const entity =
            arcs[index].layer === local.id &&
            referenceEntities.get(arcs[index].id);
          return !a.locked && entity && entity.kind === 'arc'
            ? {...a, radius: entity.radius}
            : a;
        }),
      })
    : prepared;
  const result = objective
    ? solveSketchDrag(
        prepared,
        objective,
        reference,
        drag?.reference
          ? sketchGeometry([...layers.slice(0, -1), drag.reference]).geometry
          : geometry,
      )
    : solveSketchProblem(prepared);
  const entities = local.entities.map(e =>
    e.kind === 'point'
      ? {
          ...e,
          position: result.positions[pointIndex({layer: local.id, id: e.id})],
        }
      : e.kind === 'circle'
        ? {...e, radius: result.radii[circleIndex(e.id)]}
        : e.kind === 'arc'
          ? {...e, radius: result.arcRadii[arcIndex(e.id)]}
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

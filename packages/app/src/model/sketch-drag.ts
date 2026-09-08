import {deletedSketchConstraints} from './sketch-topology';
import type * as CoreTooling from '@code3d/core/tooling';
import type {
  SketchPosition,
  SketchSnapshot,
  SketchPointAddress,
} from '@code3d/core/tooling';
import {
  sketchEntityParameters,
  withSketchEntityParameters,
  sketchPointResolver,
  assertSketchDragConnections,
} from '@code3d/core/tooling';

/** Evaluated author parameters, distinct from the constrained display. */
export type SketchGeometryData = Readonly<{
  id: number;
  parameters: readonly number[];
}>;

/** AST-derived permissions shared by preview, UI and source transactions. */
export type SketchEditableParameters = ReadonlyMap<number, readonly boolean[]>;

export type SketchPointMerge = Readonly<{
  id: number;
  target: SketchPointAddress;
  deleted: Readonly<{ids: readonly number[]; constraints: readonly number[]}>;
}>;

export type SketchDrag = Readonly<{
  id: number;
  position: SketchPosition;
  editable: SketchEditableParameters;
  data: readonly SketchGeometryData[];
  reference?: SketchSnapshot;
  /** A snapped point previews the complete merge; only release persists it. */
  mergeTarget?: SketchPointAddress;
}>;

/** Preview and commit share these exact, losslessly serialized author data. */
export type SketchDragPreview = Readonly<{
  snapshot: SketchSnapshot;
  data: readonly SketchGeometryData[];
  reference: SketchSnapshot;
  merge?: SketchPointMerge;
  /** A topology preview is never the numeric seed for the next pointer position. */
  continuation?: Readonly<{
    snapshot: SketchSnapshot;
    data: readonly SketchGeometryData[];
  }>;
}>;

export function previewSketchDrag(
  runtime: Pick<typeof CoreTooling, 'solveSketchSnapshot'>,
  layers: readonly SketchSnapshot[],
  drag: SketchDrag,
): SketchDragPreview {
  const local = layers.at(-1)!;
  const locks = drag.data.flatMap(entity =>
    entity.parameters.flatMap((value, parameter) =>
      drag.editable.get(entity.id)?.[parameter]
        ? []
        : [{id: entity.id, parameter, value}],
    ),
  );
  if (drag.mergeTarget) {
    const preview = previewPointMerge(runtime, layers, drag, locks);
    if (preview) return preview;
  }
  const data = movedSketchData(runtime, layers, drag, locks);
  const authored = withSketchData(local, data);
  const snapshot = runtime.solveSketchSnapshot([
    ...layers.slice(0, -1),
    authored,
  ]);
  assertSketchDragConnections(
    [...layers.slice(0, -1), snapshot],
    drag.reference ?? local,
  );
  // This is the same forward solve performed after the data are written to
  // source. Neither the mouse objective nor gesture-only locks escape here.
  return {
    data,
    reference: drag.reference ?? local,
    snapshot,
  };
}

function previewPointMerge(
  runtime: Pick<typeof CoreTooling, 'solveSketchSnapshot'>,
  layers: readonly SketchSnapshot[],
  drag: SketchDrag,
  locks: readonly Readonly<{id: number; parameter: number; value: number}>[],
): SketchDragPreview | undefined {
  const local = layers.at(-1)!;
  const resolve = sketchPointResolver(layers);
  const source = resolve({layer: local.id, id: drag.id});
  const target = resolve(drag.mergeTarget!);
  if (source.layer === target.layer && source.id === target.id) return;
  if (
    source.layer !== local.id ||
    !drag.editable.get(source.id)?.every(Boolean)
  )
    throw new Error(
      'Merging a point requires two editable coordinate literals.',
    );
  const aliased = {
    ...local,
    entities: local.entities.map(e =>
      e.kind === 'point' && e.id === source.id
        ? {...e, alias: drag.mergeTarget}
        : e,
    ),
  };
  const mergedPoint = sketchPointResolver([...layers.slice(0, -1), aliased]);
  const ids = aliased.entities.flatMap(e => {
    if (e.kind !== 'line') return [];
    const [a, b] = e.points.map(mergedPoint);
    return a.layer === b.layer && a.id === b.id ? [e.id] : [];
  });
  const constraints = deletedSketchConstraints(local, ids);
  const remaining: SketchSnapshot = {
    ...local,
    entities: local.entities.filter(e => !ids.includes(e.id)),
    constraints: local.constraints.filter(
      (_, index) => !constraints.includes(index),
    ),
  };
  const reference = drag.reference ?? local;
  // Deleted curves no longer own incidences; both solve and replay use the
  // surviving gesture-start topology, including attached points on other curves.
  const remainingReference = {
    ...reference,
    entities: reference.entities.filter(e => !ids.includes(e.id)),
    constraints: reference.constraints.filter(
      (_, index) => !constraints.includes(index),
    ),
  };
  const data = movedSketchData(
    runtime,
    [...layers.slice(0, -1), remaining],
    {
      ...drag,
      data: drag.data.filter(e => !ids.includes(e.id)),
      reference: remainingReference,
    },
    locks,
  );
  const authored = withSketchData(remaining, data);
  const snapshot = runtime.solveSketchSnapshot([
    ...layers.slice(0, -1),
    {
      ...authored,
      entities: authored.entities.map(e =>
        e.kind === 'point' && e.id === source.id
          ? {...e, alias: drag.mergeTarget}
          : e,
      ),
    },
  ]);
  assertSketchDragConnections(
    [...layers.slice(0, -1), snapshot],
    remainingReference,
  );
  // Identity changes must not silently redefine fixed points or consume
  // expression-driven coordinates. Reject the entire transaction if needed.
  const positions = new Map(
    snapshot.entities
      .filter(e => e.kind === 'point')
      .map(e => [e.id, e.position]),
  );
  for (const lock of locks) {
    const e = snapshot.entities.find(e => e.id === lock.id)!;
    if (sketchEntityParameters(e)[lock.parameter] !== lock.value)
      throw new Error('Point merge conflicts with expression-driven geometry.');
  }
  for (const [kind, ref] of local.constraints) {
    if (kind !== 'fixed' || ref.layer !== local.id) continue;
    const original = local.entities.find(
      e => e.kind === 'point' && e.id === ref.id,
    )!;
    if (
      original.kind === 'point' &&
      !original.position.every((v, i) => v === positions.get(ref.id)![i])
    )
      throw new Error('Point merge conflicts with a fixed point.');
  }

  return {
    snapshot,
    data: data.filter(e => e.id !== source.id),
    reference,
    merge: {
      id: source.id,
      target: drag.mergeTarget!,
      deleted: {ids, constraints},
    },
    continuation: {snapshot: local, data: drag.data},
  };
}

function movedSketchData(
  runtime: Pick<typeof CoreTooling, 'solveSketchSnapshot'>,
  layers: readonly SketchSnapshot[],
  drag: SketchDrag,
  locks: readonly Readonly<{id: number; parameter: number; value: number}>[],
): readonly SketchGeometryData[] {
  const before = new Map(
    layers.at(-1)!.entities.map(e => [e.id, sketchEntityParameters(e)]),
  );
  const moved = runtime.solveSketchSnapshot(layers, {...drag, locks});
  const after = new Map(
    moved.entities.map(e => [e.id, sketchEntityParameters(e)]),
  );
  const changed = [...after].some(([id, parameters]) => {
    const old = before.get(id)!;
    return parameters.some((value, index) => value !== old[index]);
  });
  // Once geometry moves, persist the solved editable parameters, including
  // an anchor whose original source seed differed from its displayed position.
  // Applying displacement to an unsolved seed would reintroduce its old error.
  // A zero-motion gesture leaves author data untouched; expressions stay intact.
  const data = drag.data.map(entity => {
    const editable = drag.editable.get(entity.id);
    if (!changed || !editable?.some(Boolean)) return entity;
    const parameters = after.get(entity.id)!;
    return {
      ...entity,
      parameters: parameters.map((value, index) =>
        editable[index] ? value : entity.parameters[index],
      ),
    };
  });
  return data;
}

function withSketchData(
  local: SketchSnapshot,
  data: readonly SketchGeometryData[],
): SketchSnapshot {
  const parameters = new Map(
    data.map(entity => [entity.id, entity.parameters]),
  );
  const authored: SketchSnapshot = {
    ...local,
    entities: local.entities.map(e =>
      parameters.has(e.id)
        ? withSketchEntityParameters(e, parameters.get(e.id)!)
        : e,
    ),
  };
  return authored;
}

import type * as CoreTooling from '@code3d/core/tooling';
import type {SketchPosition, SketchSnapshot} from '@code3d/core/tooling';
import {
  sketchEntityParameters,
  withSketchEntityParameters,
} from '@code3d/core/tooling';
import {formatSourceNumber} from '../tools/source-expression';

/** Evaluated author parameters, distinct from the constrained display. */
export type SketchGeometryData = Readonly<{
  id: number;
  parameters: readonly number[];
}>;

/** AST-derived permissions shared by preview, UI and source transactions. */
export type SketchEditableParameters = ReadonlyMap<number, readonly boolean[]>;

export type SketchDrag = Readonly<{
  id: number;
  position: SketchPosition;
  editable: SketchEditableParameters;
  data: readonly SketchGeometryData[];
}>;

/** Preview and commit share these exact author data, including rounding. */
export type SketchDragPreview = Readonly<{
  snapshot: SketchSnapshot;
  data: readonly SketchGeometryData[];
}>;

export function previewSketchDrag(
  runtime: Pick<typeof CoreTooling, 'solveSketchSnapshot'>,
  layers: readonly SketchSnapshot[],
  drag: SketchDrag,
): SketchDragPreview {
  const local = layers.at(-1)!;
  const before = new Map(
    local.entities.map(e => [e.id, sketchEntityParameters(e)]),
  );
  const locks = drag.data.flatMap(entity =>
    entity.parameters.flatMap((value, parameter) =>
      drag.editable.get(entity.id)?.[parameter]
        ? []
        : [{id: entity.id, parameter, value}],
    ),
  );
  const moved = runtime.solveSketchSnapshot(layers, {...drag, locks});
  const after = new Map(
    moved.entities.map(e => [e.id, sketchEntityParameters(e)]),
  );
  const changed = [...after].some(([id, parameters]) => {
    const old = before.get(id)!;
    return parameters.some(
      (value, index) => Math.abs(value - old[index]) > 1e-9,
    );
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
        editable[index]
          ? Number(formatSourceNumber(value))
          : entity.parameters[index],
      ),
    };
  });
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
  // This is the same forward solve performed after the data are written to
  // source. Neither the mouse objective nor gesture-only locks escape here.
  return {
    data,
    snapshot: runtime.solveSketchSnapshot([...layers.slice(0, -1), authored]),
  };
}

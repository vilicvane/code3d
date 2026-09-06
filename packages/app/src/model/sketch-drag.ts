import type * as CoreTooling from '@code3d/core/tooling';
import type {SketchPosition, SketchSnapshot} from '@code3d/core/tooling';
import {formatSourceNumber} from '../tools/source-expression';

/** Evaluated author coordinates, distinct from the constrained display. */
export type SketchPointData = Readonly<{id: number; position: SketchPosition}>;

/** AST-derived permissions shared by preview, UI and source transactions. */
export type SketchEditableCoordinates = ReadonlyMap<
  number,
  readonly [boolean, boolean]
>;

export type SketchDrag = Readonly<{
  id: number;
  position: SketchPosition;
  editable: SketchEditableCoordinates;
  data: readonly SketchPointData[];
}>;

/** Preview and commit share these exact author data, including rounding. */
export type SketchDragPreview = Readonly<{
  snapshot: SketchSnapshot;
  data: readonly SketchPointData[];
}>;

export function previewSketchDrag(
  runtime: Pick<typeof CoreTooling, 'solveSketchSnapshot'>,
  layers: readonly SketchSnapshot[],
  drag: SketchDrag,
): SketchDragPreview {
  const local = layers.at(-1)!;
  const before = new Map(
    local.entities.flatMap(e =>
      e.kind === 'point' ? [[e.id, e.position] as const] : [],
    ),
  );
  const locks = drag.data.flatMap(point =>
    ([0, 1] as const).flatMap(axis =>
      drag.editable.get(point.id)?.[axis]
        ? []
        : [{id: point.id, axis, value: point.position[axis]}],
    ),
  );
  const moved = runtime.solveSketchSnapshot(layers, {...drag, locks});
  const after = new Map(
    moved.entities.flatMap(e =>
      e.kind === 'point' ? [[e.id, e.position] as const] : [],
    ),
  );
  const changed = [...after].some(([id, point]) => {
    const old = before.get(id)!;
    return Math.hypot(point[0] - old[0], point[1] - old[1]) > 1e-9;
  });
  // Once geometry moves, persist the solved editable coordinates, including
  // an anchor whose original source seed differed from its displayed position.
  // Applying displacement to an unsolved seed would reintroduce its old error.
  // A zero-motion gesture leaves author data untouched; expressions stay intact.
  const data = drag.data.map(point => {
    const editable = drag.editable.get(point.id);
    if (!changed || !editable?.some(Boolean)) return point;
    const position = after.get(point.id)!;
    return {
      ...point,
      position: [
        editable[0]
          ? Number(formatSourceNumber(position[0]))
          : point.position[0],
        editable[1]
          ? Number(formatSourceNumber(position[1]))
          : point.position[1],
      ] as SketchPosition,
    };
  });
  const positions = new Map(data.map(point => [point.id, point.position]));
  const authored: SketchSnapshot = {
    ...local,
    entities: local.entities.map(e =>
      e.kind === 'point' ? {...e, position: positions.get(e.id)!} : e,
    ),
  };
  // This is the same forward solve performed after the data are written to
  // source. Neither the mouse objective nor gesture-only locks escape here.
  return {
    data,
    snapshot: runtime.solveSketchSnapshot([...layers.slice(0, -1), authored]),
  };
}

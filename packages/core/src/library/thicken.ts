import {
  ModelObject,
  requireModelKind,
  type FaceModel,
  type SolidModel,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';

/**
 * Give each face signed thickness along its surface normals, preserving placement.
 * @code3d.inspect face thicken.inspectFaces
 * @code3d.inspect thickness thicken.inspectFaces
 * @code3d.param thickness {kind: 'length', default: 1, label: 'Thickness'}
 */
export function thicken(face: FaceModel<{}>, thickness: number): SolidModel;
/**
 * @code3d.inspect faces thicken.inspectFaces
 * @code3d.inspect thickness thicken.inspectFaces
 * @code3d.param thickness {kind: 'length', default: 1, label: 'Thickness'}
 */
export function thicken(
  faces: readonly FaceModel<{}>[],
  thickness: number,
): readonly SolidModel[];
export function thicken(
  face: FaceModel<{}> | readonly FaceModel<{}>[],
  thickness = 1,
): SolidModel | readonly SolidModel[] {
  const faces = (Array.isArray(face) ? face : [face]).map(value =>
    requireModelKind(value, 'face', 'thicken requires face models.'),
  );
  const results: SolidModel[] = [];
  try {
    for (const value of faces) results.push(value.thicken(thickness));
    return Array.isArray(face) ? results : results[0];
  } finally {
    ModelObject.recordFaceResults(
      faces,
      results as unknown as readonly ModelObject[],
    );
  }
}
/** @internal */
export namespace thicken {
  export function inspectFaces(
    [face]: [FaceModel<{}> | readonly FaceModel<{}>[], number],
    context: InspectContext<
      SolidModel | readonly SolidModel[],
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const results = context.return
      ? Array.isArray(context.return)
        ? context.return
        : [context.return]
      : [];
    return ModelObject.inspectComposition(
      context.data,
      results,
      Array.isArray(face) ? face : [face],
    );
  }
  export function inspectMethod(
    [thickness]: [number],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectFaces([context.receiver, thickness], context);
  }
}

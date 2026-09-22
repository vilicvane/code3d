import {
  ModelObject,
  requireModelKind,
  type FaceModel,
  type SolidModel,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';

/**
 * Extrudes each face independently, preserving array order and placement.
 * @code3d.inspect face extrude.inspectFaces
 * @code3d.inspect distance extrude.inspectFaces
 * @code3d.param distance {kind: 'length', default: 10, label: 'Extrusion distance'}
 */
export function extrude(face: FaceModel<{}>, distance: number): SolidModel;
/**
 * Extrudes each face independently.
 * @code3d.inspect faces extrude.inspectFaces
 * @code3d.inspect distance extrude.inspectFaces
 * @code3d.param distance {kind: 'length', default: 10, label: 'Extrusion distance'}
 */
export function extrude(
  faces: readonly FaceModel<{}>[],
  distance: number,
): readonly SolidModel[];
export function extrude(
  face: FaceModel<{}> | readonly FaceModel<{}>[],
  distance = 10,
): SolidModel | readonly SolidModel[] {
  const faces = (Array.isArray(face) ? face : [face]).map(value =>
    requireModelKind(
      value,
      'face',
      'extrude requires a face model or an array of face models.',
    ),
  );
  const solids: SolidModel[] = [];
  try {
    for (const value of faces) solids.push(value.extrude(distance));
    return Array.isArray(face) ? solids : solids[0];
  } finally {
    // Inner method records belong to this same free-function invocation.
    // Restore its complete input scope even when a batch member throws.
    ModelObject.recordFaceResults(
      faces,
      solids as unknown as readonly ModelObject[],
    );
  }
}
/** @internal */
export namespace extrude {
  export function inspectFaces(
    [face, distance]: [FaceModel<{}> | readonly FaceModel<{}>[], number],
    context: InspectContext<
      SolidModel | readonly SolidModel[],
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const faces = (
      Array.isArray(face) ? face : [face]
    ) as readonly FaceModel<{}>[];
    const results = (
      Array.isArray(context.return)
        ? context.return
        : context.return
          ? [context.return]
          : []
    ) as readonly SolidModel[];
    return ModelObject.inspectExtrude(
      faces,
      results,
      distance,
      context.focused.parameter,
      context.data,
    );
  }
  export function inspectMethod(
    [distance]: [number],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectExtrude(
        [context.receiver],
        context.return ? [context.return] : [],
        distance,
        context.focused.parameter,
        context.data,
      )
    );
  }
}

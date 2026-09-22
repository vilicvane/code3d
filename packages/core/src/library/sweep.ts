import {
  ModelObject,
  requireModelKind,
  type FaceModel,
  type EdgeModel,
  type SolidModel,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';

/**
 * Sweeps one planar profile along an open curve.
 * @code3d.inspect profile sweep.inspectProfile
 * @code3d.inspect spine sweep.inspectSpine
 */
export function sweep(
  profile: FaceModel<{}>,
  spine: EdgeModel<{}>,
): SolidModel {
  return requireModelKind(
    profile,
    'face',
    'sweep requires a face model.',
  ).sweep(spine);
}
/** @internal */
export namespace sweep {
  export function inspectProfile(
    [profile, spine]: [FaceModel<{}>, EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [spine, ...(context.return ? [context.return] : [])],
      [profile],
    );
  }

  export function inspectSpine(
    [profile, spine]: [FaceModel<{}>, EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [profile, ...(context.return ? [context.return] : [])],
      [spine],
    );
  }

  export function inspectMethodProfile(
    [spine]: [EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectProfile([context.receiver, spine], context);
  }

  export function inspectMethodSpine(
    [spine]: [EdgeModel<{}>],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectSpine([context.receiver, spine], context);
  }
}

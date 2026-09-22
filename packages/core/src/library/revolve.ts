import {
  ModelObject,
  requireModelKind,
  type FaceModel,
  type LineAnchor,
  type RevolveConfig,
  type SolidModel,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';

/**
 * @code3d.inspect profile revolve.inspectProfile
 * @code3d.inspect axis revolve.inspectAxis
 * @code3d.inspect config revolve.inspectProfile
 * @code3d.param config.angle {kind: 'angle', default: 360, label: 'Revolution angle'}
 * @code3d.param config.advance {kind: 'length', default: 0, label: 'Axial advance'}
 */
export function revolve(
  profile: FaceModel<{}>,
  axis: LineAnchor,
  config: RevolveConfig,
): SolidModel;
export function revolve(
  profile: FaceModel<{}>,
  axis: LineAnchor,
  config: RevolveConfig = {angle: 360},
): SolidModel {
  const runtimeProfile = requireModelKind(
    profile,
    'face',
    'revolve requires a face model.',
  );
  let result: SolidModel | undefined;
  try {
    result = runtimeProfile.revolve(axis, config);
    return result;
  } finally {
    ModelObject.recordRevolve(
      runtimeProfile,
      axis,
      result as ModelObject | undefined,
    );
  }
}
/** @internal */
export namespace revolve {
  export function inspectProfile(
    [profile, axis]: [FaceModel<{}>, LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        profile,
        axis,
        context.return,
        context.data,
        'profile',
      )
    );
  }

  export function inspectAxis(
    [profile, axis]: [FaceModel<{}>, LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        profile,
        axis,
        context.return,
        context.data,
        'axis',
      )
    );
  }

  export function inspectMethodProfile(
    [axis]: [LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        context.receiver,
        axis,
        context.return,
        context.data,
        'profile',
      )
    );
  }

  export function inspectMethodAxis(
    [axis]: [LineAnchor, RevolveConfig],
    context: InspectContext<
      SolidModel,
      FaceModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return (
      context.data &&
      ModelObject.inspectRevolve(
        context.receiver,
        axis,
        context.return,
        context.data,
        'axis',
      )
    );
  }
}

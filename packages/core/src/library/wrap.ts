import {
  ModelObject,
  requireModelKind,
  type FaceModel,
  type Surface,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';
import type {WrapOptions} from './wrap-geometry.js';
export type {WrapOptions} from './wrap-geometry.js';

/**
 * Wrap coplanar profiles onto one smooth, finite target surface. The complete
 * source bounding rectangle chooses the closest correspondence. Distinct local
 * results and crossing/overlapping regions are errors. Output may split at seams.
 * @code3d.inspect profiles wrap.inspectProfiles
 * @code3d.inspect target wrap.inspectTarget
 */
export function wrap(
  profiles: FaceModel<{}> | readonly FaceModel<{}>[],
  target: Surface | FaceModel<{}>,
  options: WrapOptions = {},
): readonly FaceModel<{}>[] {
  return ModelObject.wrapProfiles(
    (Array.isArray(profiles) ? profiles : [profiles]).map(profile =>
      requireModelKind(profile, 'face', 'wrap requires planar face models.'),
    ),
    target,
    options,
  );
}
/** @internal */
export namespace wrap {
  function inspect(
    [profiles, target]: [
      FaceModel<{}> | readonly FaceModel<{}>[],
      Surface | FaceModel<{}>,
    ],
    context: InspectContext<
      readonly FaceModel<{}>[],
      unknown,
      CompositionInspectData | undefined
    >,
    focus: 'profiles' | 'target',
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const faces = Array.isArray(profiles) ? profiles : [profiles];
    return ModelObject.inspectComposition(
      context.data,
      focus === 'profiles'
        ? [target, ...(context.return ?? [])]
        : [...faces, ...(context.return ?? [])],
      focus === 'profiles' ? faces : [target],
    );
  }
  export function inspectProfiles(
    args: [FaceModel<{}> | readonly FaceModel<{}>[], Surface | FaceModel<{}>],
    context: InspectContext<
      readonly FaceModel<{}>[],
      unknown,
      CompositionInspectData | undefined
    >,
  ) {
    return inspect(args, context, 'profiles');
  }
  export function inspectTarget(
    args: [FaceModel<{}> | readonly FaceModel<{}>[], Surface | FaceModel<{}>],
    context: InspectContext<
      readonly FaceModel<{}>[],
      unknown,
      CompositionInspectData | undefined
    >,
  ) {
    return inspect(args, context, 'target');
  }
}

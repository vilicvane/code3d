import {
  ModelObject,
  requireModelKind,
  loftModels,
  type FaceModel,
  type EdgeModel,
  type LoftOptions,
  type SolidModel,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';

/**
 * @code3d.inspect sections loft.inspectSections
 * @code3d.inspect spine loft.inspectSpine
 */
export function loft(
  sections: readonly FaceModel<{}>[],
  {spine, ruled = false}: LoftOptions = {},
): SolidModel {
  if (sections.length < 2) {
    throw new Error('loft requires at least two planar sections.');
  }
  const runtimeSections = sections.map(section =>
    requireModelKind(
      section,
      'face',
      'Every loft section must be a planar face model.',
    ),
  );
  const runtimeSpine = spine
    ? requireModelKind(spine, 'edge', 'A loft spine must be a curve model.')
    : undefined;
  const [first, ...others] = runtimeSections;
  return first[loftModels](others, runtimeSpine, ruled);
}
/** @internal */
export namespace loft {
  export function inspectSections(
    [sections, {spine} = {}]: [readonly FaceModel<{}>[], LoftOptions?],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [...(context.return ? [context.return] : []), ...(spine ? [spine] : [])],
      sections,
    );
  }
  export function inspectSpine(
    [sections, {spine} = {}]: [readonly FaceModel<{}>[], LoftOptions?],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(
      context.data,
      [...sections, ...(context.return ? [context.return] : [])],
      spine ? [spine] : [],
    );
  }
}

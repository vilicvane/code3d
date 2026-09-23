import {
  ModelObject,
  combineModels,
  type SolidModel,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';
import {booleanOperands} from './boolean-model.js';
/** @code3d.inspect operands union.inspectOperands */
export function union(operands: readonly SolidModel<{}>[]): SolidModel {
  const {first, others} = booleanOperands('union', operands);
  return first[combineModels]('fuse', others);
}
/** @internal */
export namespace union {
  export function inspectMethod(
    [operands]: [SolidModel<{}> | readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      SolidModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    const others = (
      Array.isArray(operands) ? operands : [operands]
    ) as readonly SolidModel<{}>[];
    return inspectOperands([[context.receiver, ...others]], context);
  }

  export function inspectOperands(
    [operands]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(context.data, [], operands);
  }
}

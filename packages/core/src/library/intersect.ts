import {
  ModelObject,
  combineModels,
  inspectionRegionMaterial,
  type SolidModel,
  type Model,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';
import {booleanOperands} from './boolean-model.js';
/** @code3d.inspect operands intersect.inspectOperands */
export function intersect(operands: readonly SolidModel<{}>[]): SolidModel {
  const {first, others} = booleanOperands('intersect', operands);
  return first[combineModels]('intersect', others);
}
/** @internal */
export namespace intersect {
  export function inspectOperands(
    [operands]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    const focused = new Set(context.focused.solids);
    const scene = ModelObject.inspectComposition(
      context.data,
      operands.filter(operand => !focused.has(operand)),
      operands.filter(operand => focused.has(operand)),
    );
    if (!context.return) return scene;
    const result = ModelObject.inspectComposition(
      context.data,
      [],
      [context.return],
    ).target![0] as Model;
    return {
      ...scene,
      target: [
        ...scene.target!,
        result.material(inspectionRegionMaterial('#66c9ff')),
      ],
    };
  }
}

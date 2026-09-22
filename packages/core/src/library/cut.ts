import {
  ModelObject,
  requireModelKind,
  type SolidModel,
  type CompositionInspectData,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';
/**
 * @code3d.inspect stock cut.inspectStock
 * @code3d.inspect tools cut.inspectTools
 */
export function cut(
  stock: SolidModel<{}>,
  tools: readonly SolidModel<{}>[],
): SolidModel {
  const runtimeStock = requireModelKind(
    stock,
    'solid',
    'The cut stock must be a solid model.',
  );
  return runtimeStock.cut(tools);
}
/** @internal */
export namespace cut {
  export function inspectStock(
    [stock, tools]: [SolidModel<{}>, readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectComposition(context.data, tools, [stock]);
  }
  export function inspectTools(
    [stock, tools]: [SolidModel<{}>, readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      unknown,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    if (!context.data) return undefined;
    return ModelObject.inspectCutTools(
      stock,
      tools,
      context.focused.solids,
      context.data,
    );
  }
  export function inspectReceiver(
    [tools]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      SolidModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectStock([context.receiver, tools], context);
  }
  export function inspectMethodTools(
    [tools]: [readonly SolidModel<{}>[]],
    context: InspectContext<
      SolidModel,
      SolidModel<{}>,
      CompositionInspectData | undefined
    >,
  ): InspectResult | undefined {
    return inspectTools([context.receiver, tools], context);
  }
}

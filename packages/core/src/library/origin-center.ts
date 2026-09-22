import {
  ModelObject,
  isModelObject,
  inspectGroupMembers,
  type Model,
} from './runtime.js';
import type {InspectContext, InspectResult} from './inspect.js';
type CenterableModel = Model & {originCenter(): Model};
/**
 * Put the current local bounding-box center at zero, like model.originCenter().
 * @code3d.inspect model originCenter.inspectModels
 */
export function originCenter<T extends CenterableModel>(model: T): T;
/**
 * Center the complete layout, preserving order and spacing. Member placements
 * are resolved into the first member's axes before choosing the shared origin.
 * @code3d.inspect models originCenter.inspectModels
 */
export function originCenter<const T extends readonly CenterableModel[]>(
  models: T,
): {readonly [Index in keyof T]: T[Index]};
export function originCenter(
  model: CenterableModel | readonly CenterableModel[],
): Model | readonly Model[] {
  const models = (Array.isArray(model) ? model : [model]).map(value => {
    if (!isModelObject(value))
      throw new Error(
        'originCenter requires a geometric model or an array of geometric models.',
      );
    return value;
  });
  const results = ModelObject.centerOrigins(
    models,
  ) as unknown as readonly Model[];
  return Array.isArray(model) ? results : results[0];
}
/** @internal */
export namespace originCenter {
  export function inspectModels(
    [models]: [Model | readonly Model[]],
    context: InspectContext<Model | readonly Model[]>,
  ): InspectResult | undefined {
    if (context.return === undefined) return;
    return inspectGroupMembers(
      Array.isArray(context.return)
        ? context.return
        : [context.return as Model],
      Array.isArray(models) ? models : [models as Model],
    );
  }
}

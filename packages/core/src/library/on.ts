import {
  Constraint,
  currentRelationSelf,
  requireModelObject,
  anchorReference,
  boundReference,
  ModelObject,
  relate,
  type Anchor,
  type Bound,
} from './runtime.js';
import {type InspectContext, type InspectResult} from './inspect.js';
/**
 * Translate the whole current model onto the directed target bound.
 * @code3d.inspect on.inspect
 * @code3d.inspect target on.inspect
 */
export function on(target: Bound): Constraint;
/**
 * Translate the selected source geometry's matching bound onto the target bound.
 * @code3d.inspect on.inspect
 * @code3d.inspect source on.inspect
 * @code3d.inspect target on.inspect
 */
export function on(source: Anchor, target: Bound): Constraint;
export function on(source: Anchor, target?: Bound): Constraint {
  if (arguments.length === 1) {
    const self = currentRelationSelf();
    if (!self)
      throw new Error('on(target) must be called inside a relate callback.');
    target = source as Bound;
    source = requireModelObject(
      self,
      'on(target) requires a current model with finite geometry.',
    );
  }
  return Constraint.create(anchorReference(source), boundReference(target!));
}
/** @internal */
export namespace on {
  export function inspect(
    [source, target]: [Anchor, Bound?],
    context: InspectContext<Constraint>,
  ): InspectResult | undefined {
    const data = relate.context(context);
    if (!data || !context.return) return undefined;
    return ModelObject.inspectConstraint(
      data,
      context.return,
      target === undefined ? (data.self as ModelObject) : source,
      target ?? source,
      context.focused.parameter === undefined,
    );
  }
}

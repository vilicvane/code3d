import {
  Constraint,
  currentRelationSelf,
  requireModelObject,
  straightAxisReference,
  ModelObject,
  relate,
  type Model,
  type LineAnchor,
  type RotationCouplingConfig,
} from './runtime.js';
import {type InspectContext, type InspectResult} from './inspect.js';
/**
 * Couple relate's current model to another model using each model's own axis:
 * selfAngle = ratio * otherAngle + phase.
 * @code3d.tool
 * @code3d.inspect coupleRotation.inspect
 * @code3d.inspect other coupleRotation.inspect
 */
export function coupleRotation(
  other: Model<Readonly<{axis: LineAnchor}>>,
  config: RotationCouplingConfig,
): Constraint {
  const self = currentRelationSelf();
  if (!self)
    throw new Error(
      'coupleRotation() must be called inside a relate callback.',
    );
  return Constraint.coupleRotation(
    straightAxisReference(modelRotationAxis(self), 'coupleRotation()'),
    straightAxisReference(modelRotationAxis(other), 'coupleRotation()'),
    config,
  );
}
function modelRotationAxis(value: unknown): LineAnchor {
  const model = requireModelObject(
    value,
    'coupleRotation() requires a model with an axis.',
  );
  if (!('axis' in model))
    throw new Error('coupleRotation() requires each model to have an axis.');
  return model.axis as LineAnchor;
}
/** @internal */
export namespace coupleRotation {
  export function inspect(
    [other]: [Model<Readonly<{axis: LineAnchor}>>],
    context: InspectContext<Constraint>,
  ): InspectResult | undefined {
    const data = relate.context(context);
    return data && context.return
      ? ModelObject.inspectConstraint(
          data,
          context.return,
          modelRotationAxis(data.self),
          other.axis,
        )
      : undefined;
  }
}

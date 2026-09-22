import {
  Constraint,
  anchorReference,
  ModelObject,
  relate,
  type Anchor,
  type FrameAnchor,
} from './runtime.js';
import {type InspectContext, type InspectResult} from './inspect.js';
/**
 * Align underlying geometry while retaining unconstrained degrees of freedom.
 * @code3d.inspect align.inspect
 * @code3d.inspect source align.inspect
 * @code3d.inspect target align.inspect
 */
export function align(
  source: Anchor<'point' | 'line' | 'face'>,
  target: Anchor<'point' | 'line' | 'face'>,
): Constraint;
/**
 * Coincide the origins and all axes of two coordinate frames.
 * @code3d.inspect align.inspect
 * @code3d.inspect source align.inspect
 * @code3d.inspect target align.inspect
 */
export function align(source: FrameAnchor, target: FrameAnchor): Constraint;
export function align(source: Anchor, target: Anchor): Constraint {
  return Constraint.create(
    anchorReference(source),
    anchorReference(target),
    'align',
  );
}
/** @internal */
export namespace align {
  export function inspect(
    [source, target]: [Anchor, Anchor],
    context: InspectContext<Constraint>,
  ): InspectResult | undefined {
    const data = relate.context(context);
    return data && context.return
      ? ModelObject.inspectConstraint(
          data,
          context.return,
          source,
          target,
          context.focused.parameter === undefined,
        )
      : undefined;
  }
}

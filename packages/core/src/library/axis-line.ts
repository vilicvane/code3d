import {
  AxisChain,
  TransformationRotation,
  straightAxisReference,
  type LineAnchor,
} from './runtime.js';
/**
 * Select a positioned axis in the composition for the next rotation.
 * @code3d.inspect relate.inspectRelation
 * @code3d.tool
 */
export function axisLine(axis: LineAnchor): AxisChain {
  return new AxisChain(new TransformationRotation(), {
    kind: 'axisLine',
    axis: straightAxisReference(axis),
  });
}

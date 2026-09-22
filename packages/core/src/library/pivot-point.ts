import {
  PivotChain,
  TransformationRotation,
  rotationPointReference,
  type PointAnchor,
} from './runtime.js';
/**
 * Select a point reference as the center; rotation axes remain self local.
 * @code3d.tool
 * @code3d.inspect relate.inspectRelation
 */
export function pivotPoint(point: PointAnchor): PivotChain {
  return new PivotChain(new TransformationRotation(), {
    kind: 'pivotPoint',
    point: rotationPointReference(point),
  });
}

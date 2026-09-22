import {AxisChain, TransformationRotation} from './runtime.js';
import {assertTopologyId, type EdgeId} from './topology.js';
/**
 * @code3d.inspect relate.inspectRelation
 * @code3d.param id {kind: 'edge', label: 'Rotation edge'}
 */
export function axisEdge(id: EdgeId): AxisChain {
  assertTopologyId('edge', id);
  return new AxisChain(new TransformationRotation(), {
    kind: 'axisEdge',
    id,
  });
}

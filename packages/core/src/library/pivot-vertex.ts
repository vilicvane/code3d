import {PivotChain, TransformationRotation} from './runtime.js';
import {assertTopologyId, type VertexId} from './topology.js';
/**
 * @code3d.inspect relate.inspectRelation
 * @code3d.param id {kind: 'vertex', label: 'Pivot vertex'}
 */
export function pivotVertex(id: VertexId): PivotChain {
  assertTopologyId('vertex', id);
  return new PivotChain(new TransformationRotation(), {
    kind: 'pivotVertex',
    id,
  });
}

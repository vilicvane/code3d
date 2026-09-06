import {identityRigidTransform, type Vec3} from '@code3d/core/tooling';
import {namedElementDecorations} from './element-decorations';
import type {
  SourceDecorationProvider,
  ViewportDecoration,
} from '../viewport-decoration';

export function originDecoration(
  nodeId: string,
  position: Vec3,
): ViewportDecoration {
  return {
    kind: 'anchor',
    id: `${nodeId}:origin`,
    nodeId,
    elementKind: 'point',
    markerSize: 1,
    layer: 'foreground',
    transform: {...identityRigidTransform, position, scale: [1, 1, 1]},
    appearance: {color: '#d8ff3e', opacity: 1, depthTest: false},
  };
}

export const originSourceDecoration: SourceDecorationProvider = {
  id: 'model-origin',
  previewBehavior: 'hide',
  decorations({module, evaluation}) {
    const relation = evaluation.constraintSpatial;
    if (relation) {
      const {spatial, nodeId, kind} = relation;
      if (kind !== 'around' && !spatial.axisOnly)
        return [originDecoration(nodeId, spatial.origin)];
      const node = module.objects.get(nodeId);
      return node
        ? namedElementDecorations(node, {
            name: 'rotation-axis',
            kind: 'line',
            transform: {...spatial.frame!, scale: [1, 1, 1]},
          })
        : [];
    }
    return evaluation.nodeIds.flatMap(nodeId => {
      const node = module.objects.get(nodeId);
      return node?.operation.spatial
        ? [originDecoration(nodeId, node.origin)]
        : [];
    });
  },
};

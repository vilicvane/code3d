import {
  identityRigidTransform,
  type Vec3,
  type ModelSnapshotObject,
  type ModelSpatialOperation,
} from '@code3d/core/tooling';
import type {SpatialObjectPreview} from '../tools/spatial-edit';
import {namedElementDecorations} from './element-decorations';
import type {
  SourceDecorationProvider,
  ViewportAnchorDecoration,
  ViewportDecoration,
} from '../viewport-decoration';

function pointReferenceDecoration(
  nodeId: string,
  position: Vec3,
  frame: ViewportAnchorDecoration['frame'] = 'operation',
  reference: 'origin' | 'pivot' = 'origin',
): ViewportAnchorDecoration {
  return {
    kind: 'anchor',
    id: `${nodeId}:${reference}`,
    spatialReference: reference,
    nodeId,
    frame,
    elementKind: 'point',
    layer: 'foreground',
    transform: {...identityRigidTransform, position, scale: [1, 1, 1]},
    appearance: {
      color: reference === 'pivot' ? '#ffad4d' : '#d8ff3e',
      opacity: 1,
      depthTest: false,
    },
  };
}

export const originSourceDecoration: SourceDecorationProvider = {
  id: 'model-origin',
  decorations({module, target, evaluation, spatialTool}) {
    const owner =
      evaluation.relationPreview ??
      module.objects.get(evaluation.relationOwnerNodeId ?? '');
    if (spatialTool === 'translate') {
      const editsOrigin = (
        target.operation?.kind ??
        target.tool?.signature.name ??
        ''
      ).startsWith('origin');
      const nodeIds = owner
        ? [owner.nodeId]
        : (evaluation.focusNodeIds ?? evaluation.nodeIds);
      return nodeIds.flatMap(nodeId => {
        const node = module.objects.get(nodeId);
        return node
          ? [
              pointReferenceDecoration(
                nodeId,
                node.origin,
                editsOrigin ? 'operation' : 'geometry',
              ),
            ]
          : [];
      });
    }
    if (owner && spatialTool) {
      const relation = evaluation.relationSpatial;
      if (
        !target.relationArray &&
        relation &&
        relation.kind !== 'offset' &&
        !!relation.spatial.axisOnly === (spatialTool === 'rotate-axis')
      )
        return spatialReferenceDecorations(
          module.objects.get(relation.nodeId)!,
          relation.spatial,
          spatialTool === 'rotate-axis' ? 'axis' : 'pivot',
        );
      // An insertion already has a tool reference before any call is authored.
      // Point rotation starts at self's origin; an axis exists only after picking.
      return spatialTool === 'rotate-point'
        ? [
            pointReferenceDecoration(
              owner.nodeId,
              [0, 0, 0],
              'operation',
              'pivot',
            ),
          ]
        : [];
    }
    const nearest =
      target.kind === 'value' && owner
        ? owner.transformations?.flatMap(value => value.rotations)[0]?.spatial
        : undefined;
    const relation =
      nearest && owner
        ? {kind: 'rotate' as const, spatial: nearest, nodeId: owner.nodeId}
        : evaluation.relationSpatial;
    if (relation) {
      const {spatial, nodeId, kind} = relation;
      return spatialReferenceDecorations(
        module.objects.get(nodeId)!,
        spatial,
        kind === 'offset' ? 'origin' : spatial.axisOnly ? 'axis' : 'pivot',
      );
    }
    if (target.kind === 'value' && owner)
      return [pointReferenceDecoration(owner.nodeId, [0, 0, 0])];
    return (evaluation.focusNodeIds ?? evaluation.nodeIds).flatMap(nodeId => {
      const node = module.objects.get(nodeId);
      if (node?.operation.spatial)
        return [
          pointReferenceDecoration(
            nodeId,
            node.origin,
            'operation',
            node.operation.kind === 'rotate' ? 'pivot' : 'origin',
          ),
        ];
      const rotation = node?.transformations?.at(-1)?.rotations[0]?.spatial;
      return rotation && node
        ? spatialReferenceDecorations(
            node,
            rotation,
            rotation.axisOnly ? 'axis' : 'pivot',
          )
        : [];
    });
  },
};

function spatialReferenceDecorations(
  node: ModelSnapshotObject,
  spatial: ModelSpatialOperation,
  reference: 'origin' | 'pivot' | 'axis',
): ViewportDecoration[] {
  if (reference !== 'axis')
    return [
      pointReferenceDecoration(
        node.nodeId,
        spatial.origin,
        'operation',
        reference,
      ),
    ];
  return namedElementDecorations(node, {
    name: 'rotation-axis',
    kind: 'line',
    transform: {...spatial.frame!, scale: [1, 1, 1]},
  }).map(decoration =>
    decoration.kind === 'anchor'
      ? {...decoration, frame: 'operation', spatialReference: 'axis'}
      : decoration,
  );
}

/** Project the same marker through each occurrence's gesture/committed snapshot. */
export function previewSpatialReference(
  decoration: ViewportAnchorDecoration,
  preview: SpatialObjectPreview | undefined,
  node: ModelSnapshotObject,
): ViewportAnchorDecoration {
  if (!preview || !decoration.spatialReference) return decoration;
  const reference = decoration.spatialReference;
  return {
    ...decoration,
    transform: {
      ...decoration.transform,
      ...(reference === 'axis' ? preview.spatial.frame : undefined),
      position:
        reference === 'origin' && decoration.frame === 'geometry'
          ? node.origin
          : preview.spatial.origin,
    },
  };
}

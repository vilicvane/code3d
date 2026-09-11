import {identityRigidTransform} from '@code3d/core/tooling';
import type {SourceDecorationProvider} from '../viewport-decoration';
import {sameOperationCall} from './operation-context';

export const parameterSourceDecoration = {
  id: 'parameter-geometry',
  previewBehavior: 'hide',
  decorations({module, evaluation, parameter}) {
    if (!parameter) return [];
    const operation = evaluation.operationId
      ? module.operations.get(evaluation.operationId)
      : undefined;
    const dimensions = evaluation.nodeIds.flatMap(nodeId => {
      const output = module.objects.get(nodeId);
      const candidate = output?.operation;
      const dimension = candidate?.dimensions?.[parameter.name];
      return dimension &&
        output?.mesh &&
        sameOperationCall(candidate, operation)
        ? [
            {
              kind: 'dimension' as const,
              id: `${candidate!.id}:parameter:${parameter.name}`,
              nodeId: output.nodeId,
              dimension,
              mesh: output.mesh,
              appearance: {color: '#d8ff3e', depthTest: false},
            },
          ]
        : [];
    });
    if (dimensions.length) return dimensions;
    const selection = evaluation.selection;
    if (!selection) return [];
    const kind = selection.kind === 'edges' ? 'edge' : selection.kind;
    if (kind !== parameter.kind || selection.ids.length === 0) return [];
    const input = module.objects.get(
      selection.scope?.geometryNodeId ?? selection.inputNodeId,
    );
    if (!input?.mesh) return [];
    return [
      {
        kind: 'topology',
        visibility: 'without-topology-selection',
        id: `parameter:${parameter.name}`,
        nodeId: operation?.outputNodeId ?? selection.inputNodeId,
        mesh: input.mesh,
        topologyKind: kind,
        ids: selection.ids,
        transform: selection.scope?.transform ?? {
          ...identityRigidTransform,
          scale: [1, 1, 1],
        },
        appearance: {color: '#d8ff3e', depthTest: false},
      },
    ];
  },
} satisfies SourceDecorationProvider;

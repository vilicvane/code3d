import {identityRigidTransform} from '@code3d/core/tooling';
import type {SourceTarget} from './compiler';
import type {ToolParameterSchema} from './tool-schema';
import type {SourceDecorationProvider} from '../viewport-decoration';

/** Resolve this argument occurrence, independently of its editable variable. */
export function sourceParameterAt(
  target: SourceTarget,
  file: string,
  offset: number,
): ToolParameterSchema | undefined {
  const argument = target.tool?.arguments.find(
    ({target: source}) =>
      source?.kind === 'present' &&
      source.sourceRef.file === file &&
      source.sourceRef.start <= offset &&
      offset <= source.sourceRef.end,
  );
  return argument
    ? target.tool!.signature.parameters.find(
        parameter => parameter.index === argument.index,
      )
    : undefined;
}

export const parameterSourceDecoration = {
  id: 'parameter-geometry',
  previewBehavior: 'hide',
  decorations({module, evaluation, parameter}) {
    if (!parameter) return [];
    const operation = evaluation.operationId
      ? module.operations.get(evaluation.operationId)
      : undefined;
    const dimension = operation?.dimensions?.[parameter.name];
    const output = operation && module.objects.get(operation.outputNodeId);
    if (dimension && output?.mesh) {
      return [
        {
          kind: 'dimension',
          id: `${operation!.id}:parameter:${parameter.name}`,
          nodeId: output.nodeId,
          dimension,
          mesh: output.mesh,
          appearance: {color: '#d8ff3e', depthTest: false},
        },
      ];
    }
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

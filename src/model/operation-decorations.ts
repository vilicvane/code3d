import type {SourceTarget} from './compiler';
import type {SourceDecorationProvider} from '../viewport-decoration';

type BooleanInputTarget = SourceTarget & {
  operation: Readonly<{
    kind: 'cut' | 'union';
    ids: readonly string[];
    role: 'receiver' | 'tool' | 'operand';
  }>;
};

const booleanAppearances = {
  cut: {
    color: '#ff9b45',
    opacity: 0.94,
    emissive: '#7c2900',
    emissiveIntensity: 0.7,
    edgeColor: '#ffe2bd',
    edgeOpacity: 0.92,
    depthBias: 2,
  },
  union: {
    color: '#66c9ff',
    opacity: 0.94,
    emissive: '#083d66',
    emissiveIntensity: 0.65,
    edgeColor: '#d8f2ff',
    edgeOpacity: 0.92,
    depthBias: 2,
    depthTest: false,
  },
} as const;

const unionSectionAppearance = {
  color: '#66c9ff',
  opacity: 0.88,
  emissive: '#083d66',
  emissiveIntensity: 0.7,
  edgeColor: '#d8f2ff',
  edgeOpacity: 1,
  depthTest: false,
} as const;

const decorations: SourceDecorationProvider['decorations'] = ({
  module,
  target,
}) => {
  if (!isBooleanInputTarget(target)) {
    return [];
  }

  const sourceOperation = target.operation;
  const operationKind = sourceOperation.kind;
  const inputRole = sourceOperation.role;
  const focusedNodeIds = new Set(target.nodeIds);
  return sourceOperation.ids.flatMap(operationId => {
    const operation = module.operations.get(operationId)!;
    const output = module.objects.get(operation.outputNodeId)!;

    return operation.regions
      .filter(
        region =>
          (operationKind === 'union' || region.kind === 'intersection') &&
          (inputRole === 'receiver' || focusedNodeIds.has(region.inputNodeId)),
      )
      .map((region, index) => ({
        id: `${operation.id}:${region.kind}:${region.inputNodeId}:${index}`,
        mesh: region.mesh,
        transform: output.transform,
        appearance:
          operationKind === 'union' && region.kind === 'section'
            ? unionSectionAppearance
            : booleanAppearances[operationKind],
      }));
  });
};

export const booleanOperationSourceDecoration = {
  id: 'boolean-operation-regions',
  previewBehavior: 'hide',
  decorations,
} satisfies SourceDecorationProvider;

function isBooleanInputTarget(
  target: SourceTarget,
): target is BooleanInputTarget {
  const operationKind = target.operation?.kind;
  const inputRole = target.operation?.role;
  return (
    (operationKind === 'cut' || operationKind === 'union') &&
    (inputRole === 'receiver' ||
      inputRole === 'tool' ||
      inputRole === 'operand')
  );
}

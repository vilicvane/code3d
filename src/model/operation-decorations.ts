import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from './compiler';
import type {SourceDecorationProvider} from '../viewport-decoration';

type BooleanInputContext = Readonly<{
  operation: Readonly<{
    kind: 'cut' | 'union';
    role: 'receiver' | 'tool' | 'operand' | 'collection';
  }>;
}>;

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
  evaluation,
}) => {
  const input = booleanInputContext(module, target, evaluation);
  if (!input || !evaluation.operationId) {
    return [];
  }

  const sourceOperation = input.operation;
  const operationKind = sourceOperation.kind;
  const inputRole = sourceOperation.role;
  const focusedNodeIds = new Set(
    evaluation.constraintSourceNodeId
      ? [evaluation.constraintSourceNodeId]
      : evaluation.nodeIds,
  );
  const operation = module.operations.get(evaluation.operationId)!;
  const output = module.objects.get(operation.outputNodeId)!;

  return operation.regions
    .filter(
      region =>
        (operationKind === 'union' || region.kind === 'intersection') &&
        (inputRole === 'receiver' ||
          inputRole === 'collection' ||
          focusedNodeIds.has(region.inputNodeId)),
    )
    .map((region, index) => ({
      kind: 'mesh' as const,
      id: `${operation.id}:${region.kind}:${region.inputNodeId}:${index}`,
      mesh: region.mesh,
      transform: output.transform,
      appearance:
        operationKind === 'union' && region.kind === 'section'
          ? unionSectionAppearance
          : booleanAppearances[operationKind],
    }));
};

export const booleanOperationSourceDecoration = {
  id: 'boolean-operation-regions',
  previewBehavior: 'hide',
  decorations,
} satisfies SourceDecorationProvider;

function booleanInputContext(
  module: ModelModule,
  target: SourceTarget,
  evaluation: SourceTargetEvaluation,
): BooleanInputContext | undefined {
  const runtimeOperation = evaluation.operationId
    ? module.operations.get(evaluation.operationId)
    : undefined;
  const operationKind = runtimeOperation?.kind ?? target.operation?.kind;
  const inputRole = evaluation.constraintSourceNodeId
    ? runtimeOperation?.inputs.find(
        input => input.nodeId === evaluation.constraintSourceNodeId,
      )?.role
    : target.operation?.role;
  return (operationKind === 'cut' || operationKind === 'union') &&
    (inputRole === 'receiver' ||
      inputRole === 'tool' ||
      inputRole === 'operand' ||
      inputRole === 'collection')
    ? {operation: {kind: operationKind, role: inputRole}}
    : undefined;
}

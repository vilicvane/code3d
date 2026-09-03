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

const modifiedEdgeInputAppearance = {
  color: '#8d969c',
  opacity: 0.07,
  edgeColor: '#aeb8be',
  edgeOpacity: 0.42,
  depthBias: 1,
} as const;

const modifiedEdgeSelectionAppearance = {
  color: '#ffad66',
  opacity: 0.96,
  depthTest: false,
  lineWidth: 1,
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
    evaluation.operationInput?.nodeIds ?? evaluation.nodeIds,
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
      operationRole: inputRole,
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

export const edgeModificationSourceDecoration = {
  id: 'edge-modification-comparison',
  previewBehavior: 'hide',
  decorations({module, target, evaluation}) {
    if (target.kind !== 'operation-output' || !evaluation.operationId) {
      return [];
    }
    const operation = module.operations.get(evaluation.operationId);
    if (
      !operation ||
      (operation.kind !== 'fillet' && operation.kind !== 'chamfer')
    ) {
      return [];
    }
    const selection = operation.selections.find(
      candidate => candidate.kind === 'edge',
    );
    const input = selection
      ? module.objects.get(selection.inputNodeId)
      : undefined;
    if (!selection || selection.ids.length === 0 || !input?.mesh) {
      return [];
    }
    return [
      {
        kind: 'mesh' as const,
        id: `${operation.id}:input-shape`,
        mesh: input.mesh,
        transform: input.transform,
        appearance: modifiedEdgeInputAppearance,
      },
      {
        kind: 'edges' as const,
        id: `${operation.id}:input-edges`,
        mesh: input.mesh,
        edgeIds: selection.ids,
        transform: input.transform,
        appearance: modifiedEdgeSelectionAppearance,
      },
    ];
  },
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
  const inputRole = evaluation.operationInput?.role ?? target.operation?.role;
  return (operationKind === 'cut' || operationKind === 'union') &&
    (inputRole === 'receiver' ||
      inputRole === 'tool' ||
      inputRole === 'operand' ||
      inputRole === 'collection')
    ? {operation: {kind: operationKind, role: inputRole}}
    : undefined;
}

import type {
  ModelModule,
  SourceTarget,
  SourceTargetEvaluation,
} from './compiler';
import type {SourceDecorationProvider} from '../viewport-decoration';
import {identityRigidTransform} from '@code3d/core/tooling';
import {sourceContextAppearance} from '../rendering/source-appearance';
import {sameOperationCall} from './operation-context';

type BooleanInputContext = Readonly<{
  operation: Readonly<{
    kind: 'cut' | 'union' | 'intersect';
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
} as const;

const decorations: SourceDecorationProvider['decorations'] = ({
  module,
  target,
  evaluation,
}) => {
  const input = booleanInputContext(module, target, evaluation);
  if (!input || !evaluation.operationInput) {
    return [];
  }

  const sourceOperation = input.operation;
  const operationKind = sourceOperation.kind;
  const inputRole = sourceOperation.role;
  const focusedNodeIds = new Set(
    evaluation.operationInput?.nodeIds ?? evaluation.nodeIds,
  );
  const operation = module.operations.get(
    evaluation.operationInput.operationId,
  )!;

  // A later transform can move the consumed value away from the step being
  // edited. Its final Boolean regions do not describe the current geometry.
  if (
    !evaluation.constraintId &&
    evaluation.operationInput.nodeIds.some(
      nodeId => !evaluation.nodeIds.includes(nodeId),
    )
  )
    return [];

  if (operationKind === 'intersect') {
    const result = module.objects.get(operation.outputNodeId);
    const receiver = operation.inputs.find(input => input.role === 'receiver');
    if (!result?.mesh || !receiver) return [];
    // Show the common result of every operand, not pairwise overlaps.
    return [
      {
        kind: 'mesh',
        id: `${operation.id}:result`,
        nodeId: receiver.nodeId,
        mesh: result.mesh,
        transform: {...identityRigidTransform, scale: [1, 1, 1]},
        appearance: booleanAppearances.union,
      },
    ];
  }

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
      nodeId: region.frameNodeId,
      mesh: region.mesh,
      transform: {...identityRigidTransform, scale: [1, 1, 1] as const},
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

export const loftResultSourceDecoration = {
  id: 'loft-result',
  previewBehavior: 'hide',
  decorations({module, target, evaluation}) {
    if (target.kind !== 'operation-input' || !evaluation.operationInput)
      return [];
    const operation = module.operations.get(
      evaluation.operationInput.operationId,
    );
    if (operation?.kind !== 'loft') return [];
    const result = module.objects.get(operation.outputNodeId);
    const receiver = operation.inputs.find(input => input.role === 'receiver');
    if (!result?.mesh || !receiver) return [];
    // Loft geometry belongs to the first section's local frame. Anchoring to
    // that visible input also keeps the result correct for a related section.
    return [
      {
        kind: 'mesh',
        id: `${operation.id}:result`,
        nodeId: receiver.nodeId,
        mesh: result.mesh,
        transform: {...identityRigidTransform, scale: [1, 1, 1]},
        appearance: sourceContextAppearance,
      },
    ];
  },
} satisfies SourceDecorationProvider;

export const extrudeResultSourceDecoration = {
  id: 'extrude-result',
  previewBehavior: 'hide',
  decorations({module, evaluation}) {
    const input = evaluation.operationInput;
    const selected = input && module.operations.get(input.operationId);
    if (
      selected?.kind !== 'extrude' ||
      !input ||
      input.nodeIds.some(id => !evaluation.nodeIds.includes(id))
    )
      return [];
    return [...module.operations.values()]
      .filter(operation => sameOperationCall(operation, selected))
      .flatMap(operation => {
        const receiver = operation.inputs.find(
          input => input.role === 'receiver',
        );
        const result = module.objects.get(operation.outputNodeId);
        if (!receiver || !result?.mesh) return [];
        return [
          {
            kind: 'mesh' as const,
            id: `${operation.id}:result`,
            nodeId: receiver.nodeId,
            mesh: result.mesh,
            transform: {...identityRigidTransform, scale: [1, 1, 1] as const},
            appearance: input.nodeIds.includes(receiver.nodeId)
              ? booleanAppearances.union
              : sourceContextAppearance,
          },
        ];
      });
  },
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
        nodeId: operation.outputNodeId,
        mesh: input.mesh,
        transform: selection.transform,
        appearance: modifiedEdgeInputAppearance,
      },
      {
        kind: 'edges' as const,
        id: `${operation.id}:input-edges`,
        nodeId: operation.outputNodeId,
        mesh: input.mesh,
        edgeIds: selection.ids,
        transform: selection.transform,
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
  const runtimeOperation = evaluation.operationInput
    ? module.operations.get(evaluation.operationInput.operationId)
    : undefined;
  const operationKind = runtimeOperation?.kind ?? target.operation?.kind;
  const inputRole = evaluation.operationInput?.role ?? target.operation?.role;
  return (operationKind === 'cut' ||
    operationKind === 'union' ||
    operationKind === 'intersect') &&
    (inputRole === 'receiver' ||
      inputRole === 'tool' ||
      inputRole === 'operand' ||
      inputRole === 'collection')
    ? {operation: {kind: operationKind, role: inputRole}}
    : undefined;
}

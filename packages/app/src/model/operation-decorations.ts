import type {SourceDecorationProvider} from '../viewport-decoration';

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

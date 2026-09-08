import type {ModelDiagnostic} from './diagnostic';
import type {CompiledSketch} from './sketch-trace';

/** A sketch owns its defining evaluation, not every operation that reads it. */
export function viewportDiagnostic(
  diagnostic: ModelDiagnostic | undefined,
  previewDiagnostic: ModelDiagnostic | undefined,
  sketchLayers: readonly Pick<CompiledSketch, 'evaluationId'>[] | undefined,
): ModelDiagnostic | undefined {
  if (sketchLayers) {
    return diagnostic?.kind === 'evaluation' &&
      sketchLayers.some(
        layer =>
          layer.evaluationId &&
          diagnostic.failedEvaluationIds?.includes(layer.evaluationId),
      )
      ? diagnostic
      : undefined;
  }
  return (
    previewDiagnostic ??
    (diagnostic?.relatedModelNodeIds?.length ? diagnostic : undefined)
  );
}

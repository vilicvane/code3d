import type {ModelDiagnostic} from './diagnostic';
import type {CompiledSketch} from './sketch-trace';

/** Only explicitly supported presentations belong in the viewport. */
export function viewportDiagnostic(
  diagnostic: ModelDiagnostic | undefined,
  sketchLayers: readonly Pick<CompiledSketch, 'id'>[] | undefined,
): ModelDiagnostic | undefined {
  return diagnostic?.viewport === 'sketch-source-sync' &&
    sketchLayers?.some(layer => diagnostic.relatedSketchIds?.includes(layer.id))
    ? diagnostic
    : undefined;
}

/** Status ownership is independent of permission to show a diagnostic card. */
export function sketchDiagnostic(
  diagnostic: ModelDiagnostic | undefined,
  sketchLayers: readonly Pick<CompiledSketch, 'id' | 'evaluationId'>[],
): ModelDiagnostic | undefined {
  return diagnostic?.kind === 'evaluation' &&
    sketchLayers.some(
      layer =>
        diagnostic.relatedSketchIds?.includes(layer.id) ||
        (layer.evaluationId &&
          diagnostic.failedEvaluationIds?.includes(layer.evaluationId)),
    )
    ? diagnostic
    : undefined;
}

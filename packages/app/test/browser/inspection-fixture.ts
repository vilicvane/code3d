import type {ModelModule} from '../../src/model/compiler';
import type {ModelCompilerClient} from '../../src/model/compiler-client';
import type {ModelViewport} from '../../src/viewport';

/** Browser fixtures use the same completed invocation and scene publication as the App. */
export async function inspectSource(
  compiler: ModelCompilerClient,
  viewport: ModelViewport,
  module: ModelModule,
  file: string,
  offset: number,
  contextId?: string,
): Promise<boolean> {
  const scope = viewport.sourceEvaluationAt(module, file, offset, contextId);
  const selection = {
    file,
    offset,
    contextId: scope?.evaluation.contextId ?? contextId,
    order: scope?.evaluation.runtime.order,
    callId: scope?.evaluation.inspectCallId,
  };
  const scene = await compiler.inspect(module, selection);
  if (!scene) return false;
  viewport.renderInspection(module, scene, selection);
  return true;
}

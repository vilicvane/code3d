/// <reference lib="webworker" />
import {ArtifactStoreConnection} from './artifact-store';
import {checkCompilationCancellation} from './compilation-cancellation';
import {
  ArtifactChannel,
  type ExecutorRequest,
  type ExecutorResponse,
} from './compiler-protocol';
import {diagnosticFromError} from './diagnostic';
import {ProjectExecutor} from './project-executor';
const scope = self as DedicatedWorkerGlobalScope;
const send = (message: ExecutorResponse) => scope.postMessage(message);
const storage = new ArtifactStoreConnection();
const executor = new ProjectExecutor(undefined, undefined, storage);
const artifactChannel = new ArtifactChannel();
let compileId: number | undefined;

async function execute(
  request: Extract<ExecutorRequest, {kind: 'execute'}>,
): Promise<void> {
  const checkCancelled = () =>
    checkCompilationCancellation(request.cancellation);
  compileId = undefined;
  try {
    const module = await executor.execute(
      artifactChannel.decode(request),
      phase => send({kind: 'progress', id: request.id, phase}),
      checkCancelled,
    );
    checkCancelled();
    compileId = request.id;
    send({kind: 'result', id: request.id, ok: true, module});
  } catch (error) {
    if (Atomics.load(request.cancellation, 0))
      send({kind: 'cancelled', id: request.id});
    else
      send({
        kind: 'result',
        id: request.id,
        ok: false,
        diagnostic: diagnosticFromError(error),
      });
  }
}

scope.onmessage = ({data}: MessageEvent<ExecutorRequest>) => {
  if (data.kind === 'artifact-store') {
    storage.connect(data.endpoint);
  } else if (data.kind === 'sketch') {
    try {
      send({
        kind: 'sketch',
        id: data.id,
        ok: true,
        preview: executor.previewSketchDrag(data.layers, data.drag),
      });
    } catch (error) {
      send({
        kind: 'result',
        id: data.id,
        ok: false,
        diagnostic: diagnosticFromError(error),
      });
    }
  } else if (data.kind === 'export' || data.kind === 'topology') {
    try {
      if (compileId !== data.compileId)
        throw new Error(
          'The model has changed. Reopen export after compilation finishes.',
        );
      if (data.kind === 'export') {
        const blob = executor.export(data.instances, data.options);
        send({kind: 'export', id: data.id, ok: true, blob});
      } else {
        const topology = executor.inspectTopology(data.nodeId, data.options);
        send({kind: 'topology', id: data.id, ok: true, topology});
      }
    } catch (error) {
      send({
        kind: 'result',
        id: data.id,
        ok: false,
        diagnostic: diagnosticFromError(error),
      });
    }
  } else if (data.kind === 'execute') {
    void execute(data);
  }
};

/// <reference lib="webworker" />

import * as esbuild from 'esbuild-wasm';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import {ProjectCompiler} from './project-compiler';
import {diagnosticFromError} from './diagnostic';
import {checkCompilationCancellation} from './compilation-cancellation';
import type {ProjectFileInfo} from '../project/file-reader';
import type {
  CompileRequest,
  CompilerRequest,
  CompilerResponse,
  FileRequest,
  FileQuery,
} from './compiler-protocol';

const workerScope = self as DedicatedWorkerGlobalScope;
const send = (message: CompilerResponse) => workerScope.postMessage(message);
let engineReady: Promise<void> | undefined;
let nextFileId = 1;
const pendingFiles = new Map<
  number,
  {resolve(value: unknown): void; reject(error: Error): void}
>();

function requestFile<T>(
  source: FileRequest['source'],
  query: FileQuery,
): Promise<T> {
  const id = nextFileId++;
  return new Promise((resolve, reject) => {
    pendingFiles.set(id, {resolve: value => resolve(value as T), reject});
    send({kind: 'file', id, source, ...query});
  });
}

const compiler = new ProjectCompiler(
  {
    readFile: path =>
      requestFile<Uint8Array | undefined>('project', {
        operation: 'readFile',
        path,
      }),
    stat: path =>
      requestFile<ProjectFileInfo | undefined>('project', {
        operation: 'stat',
        path,
      }),
    statMany: paths =>
      requestFile<readonly (ProjectFileInfo | undefined)[]>('project', {
        operation: 'statMany',
        paths,
      }),
  },
  {
    readFile: path =>
      requestFile<Uint8Array | undefined>('builtin', {
        operation: 'readFile',
        path,
      }),
    stat: path =>
      requestFile<ProjectFileInfo | undefined>('builtin', {
        operation: 'stat',
        path,
      }),
  },
  esbuild,
);
let compileId: number | undefined;

// The client waits for a cancelled compile's cleanup before sending its successor.
// Keep the runtime and completed kernel operations across ordinary cancellation.
async function compile(request: CompileRequest): Promise<void> {
  const checkCancelled = () =>
    checkCompilationCancellation(request.cancellation);
  compileId = undefined;
  try {
    checkCancelled();
    if (!engineReady) {
      send({kind: 'progress', id: request.id, phase: 'loading-compiler'});
      engineReady = esbuild
        .initialize({wasmURL: esbuildWasmUrl, worker: false})
        .catch(error => {
          engineReady = undefined;
          throw error;
        });
    }
    await engineReady;
    checkCancelled();
    const module = await compiler.compile(
      request.project,
      request.rootPath,
      request.designContext,
      language => send({kind: 'language', id: request.id, language}),
      phase => send({kind: 'progress', id: request.id, phase}),
      checkCancelled,
    );
    checkCancelled();
    compileId = request.id;
    send({kind: 'result', id: request.id, ok: true, module});
  } catch (error) {
    if (Atomics.load(request.cancellation, 0)) {
      send({kind: 'cancelled', id: request.id});
      return;
    }
    send({
      kind: 'result',
      id: request.id,
      ok: false,
      diagnostic: diagnosticFromError(error, 'project'),
    });
  }
}

workerScope.onmessage = ({data}: MessageEvent<CompilerRequest>) => {
  if (data.kind === 'file-result') {
    const pending = pendingFiles.get(data.id);
    pendingFiles.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.value);
  } else if (data.kind === 'sketch') {
    try {
      send({
        kind: 'sketch',
        id: data.id,
        ok: true,
        preview: compiler.previewSketchDrag(data.layers, data.drag),
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
        const blob = compiler.export(data.instances, data.options);
        send({kind: 'export', id: data.id, ok: true, blob});
      } else {
        const topology = compiler.inspectTopology(data.nodeId, data.options);
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
  } else {
    void compile(data);
  }
};

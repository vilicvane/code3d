/// <reference lib="webworker" />

import * as esbuild from 'esbuild-wasm';
import esbuildWasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import {ProjectCompiler} from './project-compiler';
import {diagnosticFromError} from './diagnostic';
import type {ProjectFileInfo} from '../project/file-reader';
import type {
  CompileRequest,
  CompilerRequest,
  CompilerResponse,
  FileRequest,
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
  operation: FileRequest['operation'],
  path: string,
): Promise<T | undefined> {
  const id = nextFileId++;
  return new Promise((resolve, reject) => {
    pendingFiles.set(id, {resolve: value => resolve(value as T), reject});
    send({kind: 'file', id, operation, path, source});
  });
}

const compiler = new ProjectCompiler(
  {
    readFile: path => requestFile<Uint8Array>('project', 'readFile', path),
    stat: path => requestFile<ProjectFileInfo>('project', 'stat', path),
  },
  {
    readFile: path => requestFile<Uint8Array>('builtin', 'readFile', path),
    stat: path => requestFile<ProjectFileInfo>('builtin', 'stat', path),
  },
  esbuild,
);
let compileId: number | undefined;

// The client serializes requests and terminates this Worker when superseding
// in-flight work. Completed runs retain the initialized kernel for later edits.
async function compile(request: CompileRequest): Promise<void> {
  compileId = undefined;
  try {
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
    const module = await compiler.compile(
      request.project,
      request.rootPath,
      request.designContext,
      language => send({kind: 'language', id: request.id, language}),
      phase => send({kind: 'progress', id: request.id, phase}),
    );
    compileId = request.id;
    send({kind: 'result', id: request.id, ok: true, module});
  } catch (error) {
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

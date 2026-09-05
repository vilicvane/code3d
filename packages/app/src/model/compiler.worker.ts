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
const engineReady = esbuild.initialize({
  wasmURL: esbuildWasmUrl,
  worker: false,
});
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
let queued: CompileRequest | undefined;
let currentId: number | undefined;
let running = false;
let compileId: number | undefined;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await engineReady;
    while (queued) {
      const request = queued;
      queued = undefined;
      currentId = request.id;
      try {
        const module = await compiler.compile(
          request.project,
          request.rootPath,
          request.designContextId,
          language => send({kind: 'language', id: request.id, language}),
          () => {
            if (currentId !== request.id || queued)
              throw new Error('Compilation superseded.');
            send({kind: 'evaluating', id: request.id});
          },
        );
        if (currentId === request.id) {
          compileId = request.id;
          send({kind: 'result', id: request.id, ok: true, module});
        }
      } catch (error) {
        if (currentId === request.id)
          send({
            kind: 'result',
            id: request.id,
            ok: false,
            diagnostic: diagnosticFromError(error, 'project'),
          });
      }
    }
  } catch (error) {
    if (queued) {
      send({
        kind: 'result',
        id: queued.id,
        ok: false,
        diagnostic: diagnosticFromError(error, 'project'),
      });
      queued = undefined;
    }
  } finally {
    running = false;
    currentId = undefined;
  }
}

workerScope.onmessage = ({data}: MessageEvent<CompilerRequest>) => {
  if (data.kind === 'file-result') {
    const pending = pendingFiles.get(data.id);
    pendingFiles.delete(data.id);
    if (data.error) pending?.reject(new Error(data.error));
    else pending?.resolve(data.value);
  } else if (data.kind === 'cancel') {
    if (queued?.id === data.id) queued = undefined;
    if (currentId === data.id) currentId = undefined;
  } else if (data.kind === 'export') {
    try {
      if (running || queued || compileId !== data.compileId)
        throw new Error(
          'The model has changed. Reopen export after compilation finishes.',
        );
      const blob = compiler.export(data.instances, data.options);
      send({kind: 'export', id: data.id, ok: true, blob});
    } catch (error) {
      send({
        kind: 'result',
        id: data.id,
        ok: false,
        diagnostic: diagnosticFromError(error),
      });
    }
  } else {
    compileId = undefined;
    queued = data;
    void drain();
  }
};

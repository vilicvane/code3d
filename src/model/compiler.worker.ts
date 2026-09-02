/// <reference lib="webworker" />

import {compileModel} from './compiler';
import initOpenCascade from 'replicad-opencascadejs';
import openCascadeWasmUrl from 'replicad-opencascadejs/wasm?url';
import {setOC} from 'replicad';

type CompileRequest = Readonly<{
  id: number;
  source: string;
}>;

type SerializedError = Readonly<{
  message: string;
  stack?: string;
  start?: number;
  length?: number;
}>;

const workerScope = self as DedicatedWorkerGlobalScope;
const kernelReady = initOpenCascade({
  locateFile: () => openCascadeWasmUrl,
}).then(openCascade => {
  setOC(openCascade);
});

workerScope.onmessage = async ({data}: MessageEvent<CompileRequest>) => {
  try {
    await kernelReady;
    const module = compileModel(data.source);
    workerScope.postMessage({id: data.id, ok: true, module});
  } catch (error) {
    workerScope.postMessage({
      id: data.id,
      ok: false,
      error: serializeError(error),
    });
  }
};

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const located = error as Error & {start?: number; length?: number};
    return {
      message: error.message,
      stack: error.stack,
      start: located.start,
      length: located.length,
    };
  }
  return {message: String(error)};
}

/// <reference lib="webworker" />

import {compileProject} from './compiler';
import {diagnosticFromError} from './diagnostic';
import type {ModelProject} from '../project/project';
import initOpenCascade from 'replicad-opencascadejs';
import openCascadeWasmUrl from 'replicad-opencascadejs/wasm?url';
import {setOC} from 'replicad';

type CompileRequest = Readonly<{
  id: number;
  project: ModelProject;
  designContextId?: string;
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
    const module = compileProject(data.project, data.designContextId);
    workerScope.postMessage({id: data.id, ok: true, module});
  } catch (error) {
    workerScope.postMessage({
      id: data.id,
      ok: false,
      diagnostic: diagnosticFromError(error),
    });
  }
};

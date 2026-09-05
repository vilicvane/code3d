/// <reference lib="webworker" />

import {compileProject} from './compiler';
import {diagnosticFromError} from './diagnostic';
import type {CompilerRequest, CompilerResponse} from './compiler-protocol';
import {exportModel} from './model-export';
import initOpenCascade from 'replicad-opencascadejs';
import openCascadeWasmUrl from 'replicad-opencascadejs/wasm?url';
import {
  installOpenCascade,
  retainModelGeometry,
  type ModelGeometrySnapshot,
} from '@code3d/core/tooling';

const workerScope = self as DedicatedWorkerGlobalScope;
const kernelReady = initOpenCascade({
  locateFile: () => openCascadeWasmUrl,
}).then(openCascade => {
  installOpenCascade(openCascade);
});

let geometry: ModelGeometrySnapshot | undefined;
let compileId: number | undefined;
const respond = (response: CompilerResponse) =>
  workerScope.postMessage(response);

workerScope.onmessage = async ({data}: MessageEvent<CompilerRequest>) => {
  try {
    await kernelReady;
    if (data.kind === 'export') {
      if (!geometry || compileId !== data.compileId) {
        throw new Error(
          'The model has changed. Reopen export after compilation finishes.',
        );
      }
      const blob = exportModel(geometry, data.instances, data.options);
      respond({kind: 'export', id: data.id, ok: true, blob});
      return;
    }
    geometry?.dispose();
    geometry = undefined;
    compileId = undefined;
    const module = compileProject(
      data.project,
      data.rootPath,
      data.designContextId,
      objects => {
        geometry = retainModelGeometry(objects);
      },
    );
    compileId = data.id;
    respond({kind: 'compile', id: data.id, ok: true, module});
  } catch (error) {
    if (data.kind === 'compile') {
      geometry?.dispose();
      geometry = undefined;
    }
    respond({
      id: data.id,
      ok: false,
      diagnostic: diagnosticFromError(error),
    });
  }
};

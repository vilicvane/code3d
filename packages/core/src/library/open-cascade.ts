import type {OpenCascadeInstance} from '@code3d/opencascade';
import {setOC} from 'replicad';
import {
  clearKernelOperationCache,
  setKernelNativeMemoryCounter,
} from './kernel-cache.js';

/** Install the backend and its memory accounting for Node and hosted runtimes. */
export function installOpenCascade(openCascade: OpenCascadeInstance): void {
  clearKernelOperationCache();
  setOC(openCascade);
  setKernelNativeMemoryCounter(() => openCascade.Code3dMemory.AllocatedBytes());
}

import {fileURLToPath} from 'node:url';
import initOpenCascade from 'replicad-opencascadejs';
import {setOC} from 'replicad';

const wasmPath = fileURLToPath(
  import.meta.resolve('replicad-opencascadejs/wasm'),
);
const openCascade = await initOpenCascade({locateFile: () => wasmPath});
setOC(openCascade);

export * from '../library/index.js';

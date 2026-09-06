import {fileURLToPath} from 'node:url';
import initOpenCascade from '@code3d/opencascade';
import {setOC} from 'replicad';

const wasmPath = fileURLToPath(import.meta.resolve('@code3d/opencascade/wasm'));
const openCascade = await initOpenCascade({locateFile: () => wasmPath});
setOC(openCascade);
export * from '../library/index.js';

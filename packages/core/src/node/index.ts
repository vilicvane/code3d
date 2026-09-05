import {fileURLToPath} from 'node:url';
import initOpenCascade from '@code3d/opencascade';
import {setOC} from 'replicad';
import initializeSolver from '@code3d/solver';
import {installConstraintSolver} from '../library/constraint-solver.js';

const wasmPath = fileURLToPath(import.meta.resolve('@code3d/opencascade/wasm'));
const openCascade = await initOpenCascade({locateFile: () => wasmPath});
setOC(openCascade);
installConstraintSolver(
  await initializeSolver({
    locateFile: () => fileURLToPath(import.meta.resolve('@code3d/solver/wasm')),
    print() {},
    printErr() {},
  }),
);

export * from '../library/index.js';

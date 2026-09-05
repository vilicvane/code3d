import {fileURLToPath} from 'node:url';
import initOpenCascade from 'replicad-opencascadejs';
import {setOC} from 'replicad';
import initializeSolver from '@code3d/solver';
import {installConstraintSolver} from '../library/constraint-solver.js';
import {init_planegcs_module as initializeSketchSolver} from '@salusoft89/planegcs';
import {installSketchSolver} from '../library/sketch-solver.js';

const wasmPath = fileURLToPath(
  import.meta.resolve('replicad-opencascadejs/wasm'),
);
const openCascade = await initOpenCascade({locateFile: () => wasmPath});
setOC(openCascade);
installConstraintSolver(
  await initializeSolver({
    locateFile: () => fileURLToPath(import.meta.resolve('@code3d/solver/wasm')),
    print() {},
    printErr() {},
  }),
);
installSketchSolver(
  await initializeSketchSolver({
    locateFile: () =>
      fileURLToPath(
        import.meta
          .resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm'),
      ),
  }),
);

export * from '../library/index.js';

import {readFileSync} from 'node:fs';
import {
  installModelResourceReader,
  installFontEngine,
} from '../library/font.js';
import * as fontEngine from 'harfbuzzjs';
import {fileURLToPath} from 'node:url';
import initOpenCascade from '@code3d/opencascade';
import {setOC} from 'replicad';
import {init_planegcs_module as initializeSketchSolver} from '@salusoft89/planegcs';
import {installSketchSolver} from '../library/sketch-solver.js';

installModelResourceReader(url =>
  url.protocol === 'file:' ? readFileSync(url) : undefined,
);
installFontEngine(fontEngine);

const wasmPath = fileURLToPath(import.meta.resolve('@code3d/opencascade/wasm'));
const openCascade = await initOpenCascade({locateFile: () => wasmPath});
setOC(openCascade);
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

import initOpenCascade from '@code3d/opencascade';
import {init_planegcs_module as initializeSketchSolver} from '@salusoft89/planegcs';
import * as fontEngine from 'harfbuzzjs';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {installFontEngine} from '../library/font.js';
import {
  installModelResourceLoader,
  fetchModelResource,
} from '../library/resources.js';
import {installOpenCascade} from '../library/open-cascade.js';
import {installSketchSolver} from '../library/sketch-solver.js';

installModelResourceLoader({
  load: async url =>
    url.protocol === 'file:'
      ? {bytes: await readFile(url), expires: 0, cacheable: true}
      : fetchModelResource(url),
});
installFontEngine(fontEngine);

const wasmPath = fileURLToPath(import.meta.resolve('@code3d/opencascade/wasm'));
const openCascade = await initOpenCascade({locateFile: () => wasmPath});
installOpenCascade(openCascade);
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

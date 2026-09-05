import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('../../..', import.meta.url));

let nextNativeModule = 1;
export const importTestModule = source =>
  import(
    'data:text/javascript;base64,' +
      Buffer.from(
        source +
          '\n//# sourceURL=code3d-test:/module-' +
          nextNativeModule++ +
          '.js',
      ).toString('base64')
  );

/** Tests consume emitted package artifacts through the same lazy reader boundary. */
export const packageTestFiles = {
  async readFile(path) {
    try {
      return new Uint8Array(await readFile(root + path));
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code))
        return undefined;
      throw error;
    }
  },
  async stat(path) {
    try {
      const info = await stat(root + path);
      return {
        kind: info.isDirectory() ? 'directory' : 'file',
        version: `${info.mtimeMs}:${info.size}`,
      };
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return undefined;
      throw error;
    }
  },
};

export async function createTestEvaluator(server) {
  const {ModuleEvaluator} = await server.ssrLoadModule(
    '/src/model/module-evaluator.ts',
  );
  class BrowserEvaluator extends ModuleEvaluator {
    constructor() {
      super(importTestModule);
    }
    evaluate(url, source, context = {}) {
      return super.evaluate(url, source, {
        ...context,
        globalThis: Object.defineProperty(
          Object.create(globalThis),
          'process',
          {
            value: undefined,
          },
        ),
      });
    }
  }
  return new BrowserEvaluator();
}

export async function createTestProjectCompiler(server) {
  const {ProjectCompiler} = await server.ssrLoadModule(
    '/src/model/project-compiler.ts',
  );
  const prototype = await createTestEvaluator(server);
  return new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
    () => new prototype.constructor(),
  );
}

export async function packageTestLanguage(server) {
  const {loadProjectLanguage} = await server.ssrLoadModule(
    '/src/project/project-language.ts',
  );
  return loadProjectLanguage(packageTestFiles, {
    files: [
      {
        path: '/model.ts',
        source:
          'import "@code3d/core"; import "@code3d/core/replicad"; import "@code3d/screws";',
      },
    ],
  });
}

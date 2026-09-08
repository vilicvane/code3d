import assert from 'node:assert/strict';
import type {ModelDiagnosticError} from '../src/model/diagnostic.ts';
import type {AppTestServer} from './vite-test-server.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import type {ModuleExports} from '../src/model/module-evaluator.ts';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('../../..', import.meta.url));

let nextNativeModule = 1;
export const importTestModule = (source: string): Promise<ModuleExports> =>
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
export const packageTestFiles: ProjectFileReader = {
  async readFile(path) {
    try {
      return new Uint8Array(await readFile(root + path));
    } catch (error) {
      if (
        ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
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
      if (
        ['ENOENT', 'ENOTDIR'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        return undefined;
      throw error;
    }
  },
};

export async function testEvaluatorClass(server: AppTestServer) {
  const {ModuleEvaluator} = await server.ssrLoadModule<
    typeof import('../src/model/module-evaluator.ts')
  >('/src/model/module-evaluator.ts');
  class BrowserEvaluator extends ModuleEvaluator {
    constructor() {
      super(importTestModule);
    }
    override evaluate(
      url: string,
      source: string,
      context: Readonly<Record<string, unknown>> = {},
    ) {
      return super.evaluate(url, source, {
        ...context,
        process: undefined,
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
  return BrowserEvaluator;
}

export async function createTestEvaluator(server: AppTestServer) {
  const Evaluator = await testEvaluatorClass(server);
  return new Evaluator();
}

export async function createTestProjectCompiler(server: AppTestServer) {
  const {ProjectCompiler} = await server.ssrLoadModule<
    typeof import('../src/model/project-compiler.ts')
  >('/src/model/project-compiler.ts');
  const Evaluator = await testEvaluatorClass(server);
  return new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
}

export async function packageTestLanguage(server: AppTestServer) {
  const {loadProjectLanguage} = await server.ssrLoadModule<
    typeof import('../src/project/project-language.ts')
  >('/src/project/project-language.ts');
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

export function assertModelDiagnosticError(
  error: unknown,
): asserts error is ModelDiagnosticError {
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ModelDiagnosticError');
  assert.ok('diagnostic' in error);
}

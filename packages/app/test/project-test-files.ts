import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {ModelDiagnosticError} from '../src/model/diagnostic.ts';
import type {ModuleExports} from '../src/model/module-evaluator.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import type {AppTestServer} from './vite-test-server.ts';

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
      super(source =>
        importTestModule(`const process = undefined;
const globalThis = Object.defineProperty(Object.create(global), 'process', {value: undefined});
${source}`),
      );
    }
  }
  return BrowserEvaluator;
}

export async function createTestEvaluator(server: AppTestServer) {
  const Evaluator = await testEvaluatorClass(server);
  return new Evaluator();
}

export async function createTestModelPipeline(
  server: AppTestServer,
  files: ProjectFileReader = packageTestFiles,
) {
  const {TestModelPipeline} = await server.ssrLoadModule<
    typeof import('./model-pipeline.ts')
  >('/test/model-pipeline.ts');
  const Evaluator = await testEvaluatorClass(server);
  return new TestModelPipeline(
    files,
    packageTestFiles,
    esbuild,
    () => new Evaluator(),
  );
}

export async function packageTestLanguage(server: AppTestServer) {
  const {ProjectLanguageLoader} = await server.ssrLoadModule<
    typeof import('../src/project/project-language.ts')
  >('/src/project/project-language.ts');
  return new ProjectLanguageLoader(packageTestFiles).load({
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

export async function buildTestDependencies(
  server: AppTestServer,
  files: ProjectFileReader,
  builder: import('../src/project/project-builder.ts').ProjectBuilder,
  assets: import('../src/project/project-assets.ts').ProjectAssets,
  source: string,
) {
  const {DependencyBuilder} = await server.ssrLoadModule<
    typeof import('../src/model/dependency-builder.ts')
  >('/src/model/dependency-builder.ts');
  const dependencies = new DependencyBuilder(files, builder, assets);
  await dependencies.prepare('/model.ts');
  const discovery = await builder.build(source, {
    runtimeFiles: dependencies.formats,
    bundlePackages: true,
  });
  return dependencies.build(discovery);
}

/** Execute a raw esbuild test bundle through the same compiler-side scope transform. */
export async function evaluateTestBundle(
  server: AppTestServer,
  evaluator: import('../src/model/module-evaluator.ts').ModuleEvaluator,
  source: string,
  context: Readonly<Record<string, unknown>> = {},
) {
  const {executableModuleSource} = await server.ssrLoadModule<
    typeof import('../src/model/executable-module.ts')
  >('/src/model/executable-module.ts');
  return evaluator.evaluate(
    executableModuleSource('test.js', source, Object.keys(context)),
    context,
  );
}

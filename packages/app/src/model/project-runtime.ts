import type * as CoreTooling from '@code3d/core/tooling';
import type * as Replicad from 'replicad';
import type {ProjectFileReader} from '../project/file-reader';
import {ProjectBuilder, type ProjectBundle} from '../project/project-builder';
import {ModuleEvaluator, type ModuleExports} from './module-evaluator';

const runtimeUrl = 'code3d-project:/runtime.js';

/** The only long-lived model runtime is built from the project's installed core. */
export class ProjectRuntime {
  private nextDependencyBundle = 1;
  private readonly imported = new Map<string, ModuleExports>();
  private readonly pending = new Map<string, Promise<ModuleExports>>();
  private constructor(
    readonly tooling: typeof CoreTooling,
    readonly replicad: typeof Replicad,
    readonly modules: Map<string, ModuleExports>,
    readonly formats: Map<string, 'esm' | 'cjs'>,
    private readonly evaluator: ModuleEvaluator,
    private builder: ProjectBuilder,
  ) {}

  static async create(
    files: ProjectFileReader,
    builder: ProjectBuilder,
    evaluator: ModuleEvaluator,
  ): Promise<ProjectRuntime> {
    const resolve = async (specifier: string, importer?: string) => {
      const path = await builder.resolve(specifier, importer);
      if (path === false)
        throw new Error(`Required runtime entry is disabled: ${specifier}`);
      return path;
    };
    const toolingPath = await resolve('@code3d/core/tooling');
    const corePath = await resolve('@code3d/core');
    const interopPath = await resolve('@code3d/core/replicad');
    const replicadPath = await resolve('replicad', toolingPath);
    const loaderPath = await resolve('replicad-opencascadejs', toolingPath);
    const wasmPath = await resolve('replicad-opencascadejs/wasm', toolingPath);
    const entry = [toolingPath, corePath, interopPath, loaderPath, replicadPath]
      .map(
        (path, index) =>
          `export * as entry${index} from ${JSON.stringify(path)};`,
      )
      .join('\n');
    const discovery = await builder.build(entry);
    const paths = discovery.files;
    const runtimeSource =
      paths
        .map(
          (path, index) =>
            `import * as module${index} from ${JSON.stringify(path)};`,
        )
        .join('\n') +
      `
      export const modules = new Map([${paths
        .map((path, index) => `[${JSON.stringify(path)}, module${index}]`)
        .join(',')}]);
      export const tooling = modules.get(${JSON.stringify(toolingPath)});
      if (tooling.toolingProtocolVersion !== 4) {
        throw new Error('This installed @code3d/core tooling protocol is not supported by this Studio.');
      }
      const initialize = modules.get(${JSON.stringify(loaderPath)}).default;
      const kernel = await initialize({
        wasmBinary: __code3dKernelBytes,
        locateFile: () => ${JSON.stringify(wasmPath)},
      });
      tooling.installOpenCascade(kernel);
    `;
    try {
      const [bundle, wasm] = await Promise.all([
        builder.build(runtimeSource),
        files.readFile(wasmPath),
      ]);
      if (!wasm)
        throw new Error(`Installed kernel asset is missing: ${wasmPath}`);
      const runtime = await evaluator.evaluate(runtimeUrl, bundle.source, {
        __code3dKernelBytes: wasm,
      });
      return new ProjectRuntime(
        runtime.tooling,
        runtime.modules.get(replicadPath),
        runtime.modules,
        new Map(discovery.formats),
        evaluator,
        builder,
      );
    } catch (error) {
      throw error;
    }
  }

  dispose(): void {
    this.modules.clear();
    this.formats.clear();
    this.imported.clear();
    this.pending.clear();
  }

  async loadDependencies(
    builder: ProjectBuilder,
    entrySource: string,
  ): Promise<ProjectBundle> {
    this.builder = builder;
    const discovery = await builder.build(entrySource, {
      runtimeFiles: this.formats,
    });
    for (const path of discovery.staticPackages) await this.importModule(path);
    return discovery;
  }

  readonly importModule = async (path: string): Promise<ModuleExports> => {
    const existing =
      this.imported.get(path) ??
      (this.formats.get(path) === 'esm' ? this.modules.get(path) : undefined);
    if (existing) return existing;
    const pending = this.pending.get(path);
    if (pending) return pending;
    const load = this.evaluateDependency(path);
    this.pending.set(path, load);
    try {
      return await load;
    } finally {
      this.pending.delete(path);
    }
  };

  private async evaluateDependency(path: string): Promise<ModuleExports> {
    const entry = 'export * as entry from ' + JSON.stringify(path) + ';';
    const discovery = await this.builder.build(entry, {
      runtimeFiles: this.formats,
    });
    const bundle = await this.builder.build(entry, {
      runtimeFiles: this.formats,
      captureModules: discovery.formats,
    });
    const loaded = await this.evaluator.evaluate(
      'code3d-project:/dependency-' + this.nextDependencyBundle++ + '.js',
      bundle.source,
      {
        __code3dModules: this.modules,
        __code3dImport: this.importModule,
        __code3dRecordModule: (
          file: string,
          namespace: ModuleExports,
          format: 'esm' | 'cjs',
        ) => {
          this.modules.set(file, namespace);
          this.formats.set(file, format);
        },
      },
    );
    this.imported.set(path, loaded.entry);
    return loaded.entry;
  }
}

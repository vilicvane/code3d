import type * as CoreTooling from '@code3d/core/tooling';
import type * as Replicad from 'replicad';
import type {ProjectFileReader} from '../project/file-reader';
import {ProjectBuilder, type ProjectBundle} from '../project/project-builder';
import {ModuleEvaluator, type ModuleExports} from './module-evaluator';
import type {CompilationProgress} from './compilation-progress';

const runtimeUrl = 'code3d-project:/runtime.js';

/** The only long-lived model runtime is built from the project's installed core. */
export class ProjectRuntime {
  private nextDependencyBundle = 1;
  private readonly imported = new Map<string, ModuleExports>();
  private readonly pending = new Map<string, Promise<ModuleExports>>();
  private preparation = Promise.resolve();
  private readonly initializing = new Map<
    string,
    {ready: Promise<void>; complete(): void}
  >();
  private readonly failed = new Map<string, unknown>();
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
    onProgress?: CompilationProgress,
  ): Promise<ProjectRuntime> {
    onProgress?.('loading-runtime');
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
    const loaderPath = await resolve('@code3d/opencascade', toolingPath);
    const wasmPath = await resolve('@code3d/opencascade/wasm', toolingPath);
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
      const initialize = modules.get(${JSON.stringify(loaderPath)}).default;
      const kernel = await initialize({
        wasmBinary: __code3dKernelBytes,
        locateFile: () => ${JSON.stringify(wasmPath)},
      });
      tooling.installOpenCascade(kernel);
    `;
    const [bundle, wasm] = await Promise.all([
      builder.build(runtimeSource),
      files.readFile(wasmPath),
    ]);
    if (!wasm)
      throw new Error(`Installed kernel asset is missing: ${wasmPath}`);
    onProgress?.('initializing-runtime');
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
  }

  dispose(): void {
    this.modules.clear();
    this.formats.clear();
    this.imported.clear();
    this.pending.clear();
    this.initializing.clear();
    this.failed.clear();
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
    if (this.failed.has(path)) throw this.failed.get(path);
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
    for (;;) {
      // Reserve a static graph before another build can include it. Execution
      // stays outside this lock: top-level await may import another graph.
      const previous = this.preparation;
      let release!: () => void;
      this.preparation = new Promise(resolve => {
        release = resolve;
      });
      await previous;
      let wait: Promise<unknown> | undefined;
      let evaluation: Promise<ModuleExports> | undefined;
      try {
        if (this.failed.has(path)) throw this.failed.get(path);
        if (this.formats.get(path) === 'esm' && this.modules.has(path))
          return this.modules.get(path)!;
        const discovery = await this.builder.build(entry, {
          runtimeFiles: this.formats,
        });
        const blockers = discovery.files.flatMap(file => {
          if (this.failed.has(file)) throw this.failed.get(file);
          const loading = this.initializing.get(file);
          return loading ? [loading.ready] : [];
        });
        if (blockers.length) {
          wait = Promise.all(blockers);
        } else {
          const bundle = await this.builder.build(entry, {
            runtimeFiles: this.formats,
            captureModules: discovery.formats,
          });
          const reserved = bundle.files.filter(file => !this.modules.has(file));
          for (const file of reserved) {
            let complete!: () => void;
            const ready = new Promise<void>(resolve => {
              complete = resolve;
            });
            this.initializing.set(file, {ready, complete});
          }
          evaluation = this.evaluator
            .evaluate(
              'code3d-project:/dependency-' +
                this.nextDependencyBundle++ +
                '.js',
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
                  this.initializing.get(file)?.complete();
                  this.initializing.delete(file);
                },
              },
            )
            .then(loaded => {
              const namespace =
                this.formats.get(path) === 'esm'
                  ? this.modules.get(path)!
                  : loaded.entry;
              this.imported.set(path, namespace);
              return namespace;
            })
            .catch(error => {
              for (const file of reserved) {
                if (!this.initializing.has(file)) continue;
                this.failed.set(file, error);
                this.initializing.get(file)!.complete();
                this.initializing.delete(file);
              }
              throw error;
            });
        }
      } finally {
        release();
      }
      if (evaluation) return evaluation;
      // A shared child can complete while its parent awaits this import.
      // Waiting for the entire parent bundle here would deadlock that case.
      await wait;
    }
  }
}

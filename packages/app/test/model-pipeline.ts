import type * as esbuild from 'esbuild-wasm';
import type {ArtifactStoreConnection} from '../src/model/artifact-store';
import {ModuleEvaluator} from '../src/model/module-evaluator';
import {
  ProjectCompiler,
  type ProjectBuildArtifact,
} from '../src/model/project-compiler';
import {ProjectExecutor} from '../src/model/project-executor';
import type {SnapshotPoolOptions} from '../src/model/snapshot-pool';
import type {ProjectFileReader} from '../src/project/file-reader';

/** Exercise the real artifact handoff without Worker scheduling in modeling unit tests. */
export class TestModelPipeline {
  readonly compiler: ProjectCompiler;
  artifact?: ProjectBuildArtifact;
  readonly executor: ProjectExecutor;
  constructor(
    files: ProjectFileReader,
    builtinFiles: ProjectFileReader,
    engine: Pick<typeof esbuild, 'build' | 'context'>,
    evaluator = () => new ModuleEvaluator(),
    snapshotOptions?: SnapshotPoolOptions,
    private readonly storage?: ArtifactStoreConnection,
  ) {
    this.compiler = new ProjectCompiler(
      files,
      builtinFiles,
      engine,
      storage?.scope('resources'),
    );
    this.executor = new ProjectExecutor(evaluator(), snapshotOptions, storage);
  }
  async compile(...args: Parameters<ProjectCompiler['compile']>) {
    await this.storage?.ready;
    const artifact = (this.artifact = await this.compiler.compile(...args));
    return this.executor.execute(structuredClone(artifact), args[4], args[5]);
  }
  get runtime() {
    return this.executor['runtime'];
  }
  get kernelCacheStats() {
    return this.executor.kernelCacheStats;
  }
  get compiledBytes() {
    return this.executor.compiledBytes;
  }
  export(...args: Parameters<ProjectExecutor['export']>) {
    return this.executor.export(...args);
  }
  inspectTopology(...args: Parameters<ProjectExecutor['inspectTopology']>) {
    return this.executor.inspectTopology(...args);
  }
  previewSketchDrag(...args: Parameters<ProjectExecutor['previewSketchDrag']>) {
    return this.executor.previewSketchDrag(...args);
  }
  async dispose() {
    this.executor.dispose();
    await this.compiler.dispose();
    this.storage?.dispose();
  }
}

import type * as CoreTooling from '@code3d/core/tooling';
import type * as Replicad from 'replicad';
import type {DependencyArtifact} from './dependency-builder';
import {ModelResources} from './model-resources';
import {ModuleEvaluator, type ModuleExports} from './module-evaluator';

/** One immutable dependency artifact owns the executor's module and kernel identities. */
export class ProjectRuntime {
  private constructor(
    readonly artifactIdentity: string,
    readonly snapshotRuntime: {
      url: string;
      wasm: Uint8Array;
      sketchWasm: Uint8Array;
      resources: readonly (readonly [string, string])[];
    },
    readonly tooling: typeof CoreTooling,
    readonly replicad: typeof Replicad,
    readonly modules: Map<string, ModuleExports>,
    readonly importModule: (path: string) => Promise<ModuleExports>,
    readonly resources: ModelResources,
  ) {}

  static async create(
    artifact: DependencyArtifact,
    evaluator: ModuleEvaluator,
  ): Promise<ProjectRuntime> {
    const resources = new ModelResources(artifact.resources);
    let tooling: typeof CoreTooling | undefined;
    try {
      const runtime = await evaluator.evaluate(artifact.source, {
        __code3dKernelBytes: artifact.wasm,
        __code3dSketchBytes: artifact.sketchWasm,
        __code3dAssetUrl: resources.url,
        __code3dCachedFunction: (
          ...args: Parameters<typeof CoreTooling.identifyCachedFunction>
        ) => tooling!.identifyCachedFunction(...args),
      });
      const initialized = await runtime.initialize();
      tooling = initialized.tooling;
      tooling!.installModelResourceReader(resources.read);
      const url = URL.createObjectURL(
        new Blob([artifact.source], {type: 'text/javascript'}),
      );
      return new ProjectRuntime(
        artifact.kernelIdentity,
        {
          url,
          wasm: artifact.wasm,
          sketchWasm: artifact.sketchWasm,
          resources: [...artifact.resources.keys()]
            .filter(path => path.startsWith('/'))
            .map(path => [path, resources.url(path)] as const),
        },
        tooling!,
        initialized.replicad,
        runtime.modules,
        runtime.importModule,
        resources,
      );
    } catch (error) {
      resources.dispose();
      throw error;
    }
  }

  dispose(): void {
    URL.revokeObjectURL(this.snapshotRuntime.url);
    this.resources.dispose();
    this.tooling.clearKernelOperationCache();
    this.modules.clear();
  }
}

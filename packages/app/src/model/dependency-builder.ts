import {
  statProjectFiles,
  type ProjectFileInfo,
  type ProjectFileReader,
} from '../project/file-reader';
import type {ProjectAssets} from '../project/project-assets';
import {
  ProjectBuilder,
  dependencyFileIdentity,
  type ModuleFormats,
  type ProjectBundle,
} from '../project/project-builder';
import {executableModuleSource} from './executable-module';
import {runtimeArtifactIdentity} from './persistent-artifacts';

type RuntimeEntries = Readonly<{
  tooling: string;
  replicad: string;
  loader: string;
  wasm: string;
  sketchLoader: string;
  sketchWasm: string;
  fontEngine: string;
  files: readonly string[];
  identityPaths: readonly string[];
}>;

export type DependencyArtifact = Readonly<{
  id: string;
  kernelIdentity: string;
  source: string;
  formats: ModuleFormats;
  wasm: Uint8Array;
  sketchWasm: Uint8Array;
  resources: ReadonlyMap<string, Uint8Array>;
  runtime: RuntimeEntries;
  metadata: readonly (readonly [string, ProjectFileInfo | null])[];
}>;

/** esbuild owns one complete dependency graph, including lazy module initialization. */
export class DependencyBuilder {
  private core?: RuntimeEntries;
  private readonly modules = new Map<string, 'esm' | 'cjs'>();
  private artifact?: DependencyArtifact;
  private preparedBundle?: {
    bundle: ProjectBundle;
    resources: ReadonlyMap<string, Uint8Array>;
  };

  constructor(
    private readonly files: ProjectFileReader,
    private readonly builder: ProjectBuilder,
    private readonly assets: ProjectAssets,
  ) {}

  get formats(): ModuleFormats {
    return this.modules;
  }

  get prepared(): boolean {
    return this.core !== undefined;
  }
  get ready(): boolean {
    return this.artifact !== undefined;
  }

  /** An earlier entry can execute against the unchanged superset already installed. */
  reuse(artifact: DependencyArtifact): DependencyArtifact {
    const current = this.artifact;
    if (!current || current.kernelIdentity !== artifact.kernelIdentity)
      return artifact;
    if (
      [...artifact.formats].some(
        ([path, format]) => current.formats.get(path) !== format,
      )
    )
      return artifact;
    const metadata = new Map(current.metadata);
    if (
      artifact.metadata.some(
        ([path, info]) =>
          JSON.stringify(metadata.get(path)) !== JSON.stringify(info),
      )
    )
      return artifact;
    return current;
  }

  /** Restore output after checking package/installation metadata, without reading its source tree. */
  async adopt(artifact: DependencyArtifact): Promise<boolean> {
    if (this.core) return false;
    const infos = await statProjectFiles(
      this.files,
      artifact.metadata.map(([path]) => path),
    );
    if (
      artifact.metadata.some(
        ([, expected], index) =>
          JSON.stringify(expected) !==
          JSON.stringify(dependencyFileIdentity(infos[index])),
      )
    )
      return false;
    this.core = artifact.runtime;
    this.artifact = artifact;
    for (const [path, format] of artifact.formats)
      this.modules.set(path, format);
    for (const [path, info] of artifact.metadata)
      this.builder.dependencyMetadata.set(path, info);
    return true;
  }

  async prepare(rootPath: string): Promise<void> {
    if (this.core) return;
    const resolve = async (specifier: string, importer: string) => {
      const path = await this.builder.resolve(specifier, importer);
      if (path === false)
        throw new Error(`Required runtime entry is disabled: ${specifier}`);
      return path;
    };
    const tooling = await resolve('@code3d/core/tooling', rootPath);
    const [
      core,
      interop,
      replicad,
      loader,
      wasm,
      sketchLoader,
      sketchWasm,
      fontEngine,
    ] = await Promise.all([
      resolve('@code3d/core', rootPath),
      resolve('@code3d/core/replicad', rootPath),
      resolve('replicad', tooling),
      resolve('@code3d/opencascade', tooling),
      resolve('@code3d/opencascade/wasm', tooling),
      resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.js', tooling),
      resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm', tooling),
      resolve('harfbuzzjs', tooling),
    ]);
    const runtime = {
      tooling,
      replicad,
      loader,
      wasm,
      sketchLoader,
      sketchWasm,
      fontEngine,
    };
    const entries = [
      tooling,
      core,
      interop,
      replicad,
      loader,
      sketchLoader,
      fontEngine,
    ];
    const discovery = await this.builder.build(
      dependencyEntry(runtime, entries),
      {
        slot: 'dependencies',
        instrumentCaches: false,
        bundlePackages: true,
      },
    );
    this.preparedBundle = {
      bundle: discovery,
      resources: this.assets.snapshot(),
    };
    this.core = {
      tooling,
      replicad,
      loader,
      wasm,
      sketchLoader,
      sketchWasm,
      fontEngine,
      files: discovery.files,
      identityPaths: [
        ...new Set([...discovery.files, ...discovery.resources]),
      ].sort(),
    };
    for (const path of entries)
      this.modules.set(path, discovery.formats.get(path)!);
  }

  async build(
    sourceGraph: ProjectBundle,
    onBuild?: () => void,
  ): Promise<DependencyArtifact> {
    const core = this.core!;
    let changed = !this.artifact;
    for (const path of sourceGraph.packageEntries) {
      const format = sourceGraph.formats.get(path) ?? this.modules.get(path)!;
      if (this.modules.get(path) !== format) {
        changed = true;
        this.preparedBundle = undefined;
      }
      this.modules.set(path, format);
    }
    if (!changed) return this.artifact!;
    onBuild?.();
    const prepared = this.preparedBundle;
    const [bundle, wasm, sketchWasm] = await Promise.all([
      prepared?.bundle ??
        this.builder.build(dependencyEntry(core, this.modules.keys()), {
          slot: 'dependencies',
          bundlePackages: true,
          cacheIdentityFiles: new Set(core.files),
        }),
      this.files.readFile(core.wasm),
      this.files.readFile(core.sketchWasm),
    ]);
    this.preparedBundle = undefined;
    if (!wasm || !sketchWasm)
      throw new Error('Installed modeling engine asset is missing.');
    const paths = core.identityPaths;
    const inputs = this.artifact
      ? []
      : await Promise.all(
          paths.map(async path => {
            const bytes = await this.files.readFile(path);
            if (!bytes) throw new Error(`Runtime input is missing: ${path}`);
            return bytes;
          }),
        );
    const assets = prepared?.resources ?? this.assets.snapshot();
    const resources = new Map(
      bundle.resources.flatMap(path =>
        assets.has(path) ? [[path, assets.get(path)!] as const] : [],
      ),
    );
    const kernelIdentity =
      this.artifact?.kernelIdentity ??
      (await runtimeArtifactIdentity([
        new TextEncoder().encode(JSON.stringify(paths)),
        ...inputs,
        wasm,
        sketchWasm,
      ]));
    const metadata = [...this.builder.dependencyMetadata].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const id = await runtimeArtifactIdentity([
      new TextEncoder().encode(bundle.source),
      new TextEncoder().encode(
        JSON.stringify([core, metadata, [...resources.keys()]]),
      ),
      ...resources.values(),
      wasm,
      sketchWasm,
    ]);
    return (this.artifact = {
      id,
      kernelIdentity,
      source: executableModuleSource(
        'code3d-project:/dependencies.js',
        bundle.source,
        [
          '__code3dKernelBytes',
          '__code3dSketchBytes',
          '__code3dAssetUrl',
          '__code3dCachedFunction',
        ],
      ),
      formats: new Map(this.modules),
      wasm,
      sketchWasm,
      resources,
      runtime: core,
      metadata,
    });
  }
}

function dependencyEntry(
  core: Pick<
    RuntimeEntries,
    | 'tooling'
    | 'replicad'
    | 'loader'
    | 'wasm'
    | 'sketchLoader'
    | 'sketchWasm'
    | 'fontEngine'
  >,
  paths: Iterable<string>,
): string {
  return `
    const entries = new Map([${[...paths]
      .sort()
      .map(
        path =>
          `[${JSON.stringify(path)}, () => import(${JSON.stringify(path)})]`,
      )
      .join(',')}]);
    export const modules = new Map();
    const pending = new Map();
    export function importModule(path) {
      if (!pending.has(path)) pending.set(path, entries.get(path)().then(namespace => {modules.set(path, namespace); return namespace;}));
      return pending.get(path);
    }
    export async function initialize() {
      const tooling = await importModule(${JSON.stringify(core.tooling)});
      tooling.installFontEngine(await importModule(${JSON.stringify(core.fontEngine)}));
      const loader = await importModule(${JSON.stringify(core.loader)});
      tooling.installOpenCascade(await loader.default({wasmBinary: __code3dKernelBytes, locateFile: () => ${JSON.stringify(core.wasm)}}));
      const sketchLoader = await importModule(${JSON.stringify(core.sketchLoader)});
      tooling.installSketchSolver(await sketchLoader.default({wasmBinary: __code3dSketchBytes, locateFile: () => ${JSON.stringify(core.sketchWasm)}, print() {}, printErr() {}}));
      return {tooling, replicad: await importModule(${JSON.stringify(core.replicad)})};
    }
  `;
}

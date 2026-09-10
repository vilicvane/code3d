import type {KernelArtifactStore} from '@code3d/core/tooling';
import {strFromU8, strToU8, unzlibSync, zlibSync} from 'fflate';
import {normalizeProjectPath} from '../project/project';
import type {CompiledModelSource, DesignContext} from './compiler';
import type {DependencyArtifact} from './dependency-builder';
import {runtimeArtifactIdentity} from './persistent-artifacts';
import type {ProjectBuildArtifact} from './project-compiler';

type BinaryRef = readonly [path: string, id: string];
type StoredDependency = Omit<
  DependencyArtifact,
  'formats' | 'wasm' | 'sketchWasm' | 'resources'
> & {
  formats: readonly (readonly [string, 'esm' | 'cjs'])[];
  wasm: string;
  sketchWasm: string;
  resources: readonly BinaryRef[];
};
type StoredModel = Omit<
  CompiledModelSource,
  | 'files'
  | 'edgeSelectionSites'
  | 'toolCallSites'
  | 'relationCallSites'
  | 'sketches'
> & {
  files: [string, string][];
  edgeSelectionSites: [
    string,
    CompiledModelSource['edgeSelectionSites'] extends ReadonlyMap<
      string,
      infer V
    >
      ? V
      : never,
  ][];
  toolCallSites: [
    string,
    CompiledModelSource['toolCallSites'] extends ReadonlyMap<string, infer V>
      ? V
      : never,
  ][];
  relationCallSites: [
    string,
    CompiledModelSource['relationCallSites'] extends ReadonlyMap<
      string,
      infer V
    >
      ? V
      : never,
  ][];
  sketches: [
    string,
    CompiledModelSource['sketches'] extends ReadonlyMap<string, infer V>
      ? V
      : never,
  ][];
};
type StoredArtifact = Omit<
  ProjectBuildArtifact,
  'model' | 'dependencies' | 'resources'
> & {
  model: StoredModel;
  dependencies: string;
  resources: readonly BinaryRef[];
};
export type LatestBuild = Readonly<{stamp: number; artifact: string}>;
export type PublishBuild = (
  key: string,
  value: LatestBuild,
  required: readonly string[],
) => boolean;

const encode = (value: unknown) =>
  zlibSync(strToU8(JSON.stringify(value)), {level: 3});
const decode = <T>(bytes: Uint8Array): T =>
  JSON.parse(strFromU8(unzlibSync(bytes))) as T;

// Artifact bytes are immutable; compilation and persistence share their content IDs.
const binaryIds = new WeakMap<Uint8Array, Promise<string>>();
function binaryArtifactIdentity(bytes: Uint8Array): Promise<string> {
  let pending = binaryIds.get(bytes);
  if (!pending) {
    pending = runtimeArtifactIdentity([bytes]);
    binaryIds.set(bytes, pending);
  }
  return pending;
}

function storedModel(model: CompiledModelSource): StoredModel {
  return {
    ...model,
    files: [...model.files].sort(([a], [b]) => a.localeCompare(b)),
    edgeSelectionSites: [...model.edgeSelectionSites].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    toolCallSites: [...model.toolCallSites].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    relationCallSites: [...model.relationCallSites].sort(([a], [b]) =>
      a.localeCompare(b),
    ),
    sketches: [...model.sketches].sort(([a], [b]) => a.localeCompare(b)),
  };
}

/** Source tools and diagnostics are part of the executable snapshot's identity. */
export async function projectArtifactIdentity(
  artifact: Omit<ProjectBuildArtifact, 'id' | 'resourceStats'>,
): Promise<string> {
  const resources = await Promise.all(
    [...artifact.resources]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([path, bytes]) => [
        path,
        await binaryArtifactIdentity(bytes),
      ]),
  );
  return runtimeArtifactIdentity([
    strToU8(
      JSON.stringify({
        staticPackages: artifact.staticPackages,
        runtimeSourceRef: artifact.runtimeSourceRef,
        model: storedModel(artifact.model),
        dependencies: artifact.dependencies.id,
        resources,
      }),
    ),
  ]);
}

export function buildEntryKey(
  project: string,
  path: string,
  context?: DesignContext,
): Promise<string> {
  return runtimeArtifactIdentity([
    strToU8(
      JSON.stringify([project, normalizeProjectPath(path), context ?? null]),
    ),
  ]);
}

/** Complete immutable manifests reference shared dependency and binary records. */
export class BuildArtifactCache {
  private readonly memory = new Map<
    string,
    {artifact: ProjectBuildArtifact; bytes: number}
  >();
  private readonly latest = new Map<string, LatestBuild>();
  private readonly requiredRecords = new WeakMap<
    ProjectBuildArtifact,
    readonly string[]
  >();
  private memoryBytes = 0;
  private readonly encodedDependencies = new WeakMap<
    DependencyArtifact,
    Uint8Array
  >();

  constructor(
    private readonly store?: KernelArtifactStore,
    private readonly publish?: PublishBuild,
    readonly maximumBytes = 256 * 1024 ** 2,
  ) {}

  get stats() {
    return {
      memoryBytes: this.memoryBytes,
      entries: this.memory.size,
      maximumBytes: this.maximumBytes,
    };
  }

  restore(
    key: string,
    kind: 'latest' | 'successful' = 'latest',
  ): ProjectBuildArtifact | undefined {
    try {
      const id = this.latestArtifact(kind + ':' + key);
      return id ? this.artifact(id) : undefined;
    } catch {
      return;
    }
  }

  restoreDependencies(key: string): DependencyArtifact | undefined {
    try {
      const id = this.latestArtifact('dependencies:' + key);
      if (!id) return;
      for (const {artifact} of this.memory.values())
        if (artifact.dependencies.id === id) return artifact.dependencies;
      return this.dependency(id, this.binaryReader(new Set()));
    } catch {
      return;
    }
  }

  private latestArtifact(index: string): string | undefined {
    const pointer = this.store?.get(index);
    const disk = pointer
      ? (JSON.parse(strFromU8(pointer)) as LatestBuild)
      : undefined;
    const local = this.latest.get(index);
    return (local && (!disk || local.stamp >= disk.stamp) ? local : disk)
      ?.artifact;
  }

  private binaryReader(required: Set<string>) {
    const binaries = new Map<string, Uint8Array>();
    return (id: string): Uint8Array => {
      const existing = binaries.get(id);
      if (existing) return existing;
      required.add('binary:' + id);
      const bytes = this.store?.get('binary:' + id);
      if (!bytes) throw new Error('Incomplete build artifact');
      binaries.set(id, bytes);
      binaryIds.set(bytes, Promise.resolve(id));
      return bytes;
    };
  }

  private dependency(
    id: string,
    binary: (id: string) => Uint8Array,
  ): DependencyArtifact | undefined {
    const bytes = this.store?.get('dependency:' + id);
    if (!bytes) return;
    const value = decode<StoredDependency>(bytes);
    return {
      ...value,
      formats: new Map(value.formats),
      wasm: binary(value.wasm),
      sketchWasm: binary(value.sketchWasm),
      resources: new Map(
        value.resources.map(([path, id]) => [path, binary(id)]),
      ),
    };
  }

  private artifact(id: string): ProjectBuildArtifact | undefined {
    try {
      const hit = this.memory.get(id);
      if (hit) {
        this.memory.delete(id);
        this.memory.set(id, hit);
        return hit.artifact;
      }
      const modelBytes = this.store?.get('model:' + id);
      if (!modelBytes) return;
      const value = decode<StoredArtifact>(modelBytes);
      const required = new Set([
        'model:' + id,
        'dependency:' + value.dependencies,
      ]);
      const binary = this.binaryReader(required);
      const dependency = this.dependency(value.dependencies, binary);
      if (!dependency) return;
      const resources = (refs: readonly BinaryRef[]) =>
        new Map(refs.map(([path, id]) => [path, binary(id)]));
      const artifact: ProjectBuildArtifact = {
        ...value,
        model: {
          ...value.model,
          files: new Map(value.model.files),
          edgeSelectionSites: new Map(value.model.edgeSelectionSites),
          toolCallSites: new Map(value.model.toolCallSites),
          relationCallSites: new Map(value.model.relationCallSites),
          sketches: new Map(value.model.sketches),
        },
        dependencies: dependency,
        resources: resources(value.resources),
      };
      this.retain(artifact);
      this.requiredRecords.set(artifact, [...required]);
      return artifact;
    } catch {
      return;
    }
  }

  async succeeded(key: string, id: string, stamp: number): Promise<void> {
    const artifact = this.artifact(id);
    if (!artifact) return;
    const required = this.requiredRecords.get(artifact);
    if (required) this.publishPointer('successful:' + key, id, stamp, required);
    else await this.save(key, artifact, stamp, () => {}, 'successful');
  }

  async save(
    key: string,
    artifact: ProjectBuildArtifact,
    stamp: number,
    checkCancelled: () => void,
    kind: 'latest' | 'successful' = 'latest',
    dependencyKey?: string,
  ): Promise<void> {
    this.retain(artifact);
    const records = new Map<string, () => Uint8Array>();
    const binary = async (bytes: Uint8Array): Promise<string> => {
      const id = await binaryArtifactIdentity(bytes);
      records.set('binary:' + id, () => bytes);
      return id;
    };
    const resources = (files: ReadonlyMap<string, Uint8Array>) =>
      Promise.all(
        [...files].map(
          async ([path, bytes]) => [path, await binary(bytes)] as const,
        ),
      );
    const dependency = artifact.dependencies;
    const dependencyValue: StoredDependency = {
      ...dependency,
      formats: [...dependency.formats],
      wasm: await binary(dependency.wasm),
      sketchWasm: await binary(dependency.sketchWasm),
      resources: await resources(dependency.resources),
    };
    records.set('dependency:' + dependency.id, () => {
      let bytes = this.encodedDependencies.get(dependency);
      if (!bytes) {
        bytes = encode(dependencyValue);
        this.encodedDependencies.set(dependency, bytes);
      }
      return bytes;
    });
    const dependencyRecords = [...records.keys()];
    const value: StoredArtifact = {
      ...artifact,
      dependencies: dependency.id,
      resources: await resources(artifact.resources),
      model: storedModel(artifact.model),
    };
    records.set('model:' + artifact.id, () => encode(value));
    const required = [...records.keys()];
    const present = this.store?.touchMany(required);
    [...records].forEach(([id, bytes], index) => {
      if (!present?.[index]) this.store?.set(id, bytes());
    });
    this.requiredRecords.set(artifact, required);
    // Cancellation preserves completed content-addressed records, never advances latest.
    checkCancelled();
    if (dependencyKey)
      this.publishPointer(
        'dependencies:' + dependencyKey,
        dependency.id,
        stamp,
        dependencyRecords,
      );
    this.publishPointer(kind + ':' + key, artifact.id, stamp, required);
  }

  private publishPointer(
    index: string,
    artifact: string,
    stamp: number,
    required: readonly string[],
  ): void {
    const pointer = {stamp, artifact};
    const previous = this.latest.get(index);
    if (previous && previous.stamp > stamp) return;
    this.publish?.(index, pointer, required);
    if (!this.publish) this.store?.set(index, strToU8(JSON.stringify(pointer)));
    this.latest.delete(index);
    this.latest.set(index, pointer);
    // The disk owns the full per-entry index; bound the session's convenience index.
    while (this.latest.size > 1024)
      this.latest.delete(this.latest.keys().next().value!);
  }

  private retain(artifact: ProjectBuildArtifact): void {
    const previous = this.memory.get(artifact.id);
    if (previous) {
      this.memory.delete(artifact.id);
      this.memory.set(artifact.id, previous);
      return;
    }
    const bytes =
      2 *
        (artifact.model.source.length +
          artifact.dependencies.source.length +
          [...artifact.model.files.values()].reduce(
            (size, source) => size + source.length,
            0,
          )) +
      artifact.dependencies.wasm.byteLength +
      artifact.dependencies.sketchWasm.byteLength +
      [
        ...artifact.resources.values(),
        ...artifact.dependencies.resources.values(),
      ].reduce((size, data) => size + data.byteLength, 0);
    if (bytes > this.maximumBytes) return;
    this.memory.set(artifact.id, {artifact, bytes});
    this.memoryBytes += bytes;
    while (this.memoryBytes > this.maximumBytes) {
      const [id, value] = this.memory.entries().next().value!;
      this.memory.delete(id);
      this.memoryBytes -= value.bytes;
    }
  }
}

import type {
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import type {ProjectFileInfo} from '../project/file-reader';
import type {ModelProject} from '../project/project';
import type {ProjectLanguage} from '../project/project-language';
import type {CompilationCancellation} from './compilation-cancellation';
import type {CompilationPhase} from './compilation-progress';
import type {DesignContext, ModelModule} from './compiler';
import type {DependencyArtifact} from './dependency-builder';
import type {ModelDiagnostic} from './diagnostic';
import type {ModelExportInstance, ModelExportOptions} from './model-export';
import type {ProjectBuildArtifact} from './project-compiler';
import type {SketchDrag, SketchDragPreview} from './sketch-drag';

export type CompileRequest = Readonly<{
  kind: 'compile';
  projectIdentity?: string;
  stamp: number;
  id: number;
  cancellation: CompilationCancellation;
  project: ModelProject;
  rootPath: string;
  designContext?: DesignContext;
}>;

export type FileQuery =
  | Readonly<{operation: 'readFile' | 'stat'; path: string}>
  | Readonly<{operation: 'statMany'; paths: readonly string[]}>;

export type FileRequest = FileQuery &
  Readonly<{
    kind: 'file';
    id: number;
    source: 'project' | 'builtin';
  }>;

type WorkerRequest =
  | CompileRequest
  | Readonly<{kind: 'cancel-compile'; id: number}>
  | Readonly<{kind: 'refresh-dependencies'}>
  | Readonly<{
      kind: 'execution-succeeded';
      projectIdentity: string;
      rootPath: string;
      designContext?: DesignContext;
      artifact: string;
      stamp: number;
    }>
  | Readonly<{
      kind: 'restore';
      id: number;
      projectIdentity: string;
      rootPath: string;
      designContext?: DesignContext;
    }>
  | Readonly<
      {
        kind: 'execute';
        id: number;
        cancellation: CompilationCancellation;
      } & ArtifactMessage
    >
  | Readonly<{
      kind: 'topology';
      id: number;
      compileId: number;
      nodeId: string;
      options: TopologyInspectionOptions;
    }>
  | Readonly<{
      kind: 'sketch';
      id: number;
      layers: readonly SketchSnapshot[];
      drag: SketchDrag;
    }>
  | Readonly<{
      kind: 'export';
      id: number;
      compileId: number;
      instances: readonly ModelExportInstance[];
      options: ModelExportOptions;
    }>
  | Readonly<{
      kind: 'file-result';
      id: number;
      value?:
        Uint8Array | ProjectFileInfo | readonly (ProjectFileInfo | undefined)[];
      error?: string;
    }>;

type WorkerResponse =
  | FileRequest
  | Readonly<{kind: 'cached'; id: number} & ArtifactMessage>
  | Readonly<{kind: 'compiled'; id: number} & ArtifactMessage>
  | Readonly<{kind: 'cancelled'; id: number}>
  | Readonly<{
      kind: 'topology';
      id: number;
      ok: true;
      topology: TopologyInspection;
    }>
  | Readonly<{kind: 'language'; id: number; language: ProjectLanguage}>
  | Readonly<{kind: 'progress'; id: number; phase: CompilationPhase}>
  | Readonly<{kind: 'result'; id: number; ok: true; module: ModelModule}>
  | Readonly<{kind: 'export'; id: number; ok: true; blob: Blob}>
  | Readonly<{kind: 'sketch'; id: number; ok: true; preview: SketchDragPreview}>
  | Readonly<{
      kind: 'result';
      id: number;
      ok: false;
      diagnostic: ModelDiagnostic;
    }>;

export type ExecutorRequest = Extract<
  WorkerRequest,
  {kind: 'execute' | 'export' | 'topology' | 'sketch'}
>;
export type CompilerRequest = Exclude<WorkerRequest, ExecutorRequest>;
export type ExecutorResponse = Extract<
  WorkerResponse,
  {kind: 'result' | 'export' | 'topology' | 'sketch' | 'progress' | 'cancelled'}
>;
export type CompilerResponse = Exclude<
  WorkerResponse,
  {kind: 'export' | 'topology' | 'sketch'} | {kind: 'result'; ok: true}
>;

export type ArtifactMessage = Readonly<{
  artifact: Omit<ProjectBuildArtifact, 'dependencies'> & {
    dependencies: string;
  };
  dependency?: DependencyArtifact;
}>;

/** One ordered Worker stream sends an immutable dependency only when its identity changes. */
export class ArtifactChannel {
  private dependency?: DependencyArtifact;

  encode(artifact: ProjectBuildArtifact): ArtifactMessage {
    const {dependencies, resources, ...model} = artifact;
    const dependency =
      this.dependency?.id === dependencies.id ? undefined : dependencies;
    this.dependency = dependencies;
    return {
      artifact: {
        ...model,
        dependencies: dependencies.id,
        resources: new Map(
          [...resources].filter(
            ([path, bytes]) => dependencies.resources.get(path) !== bytes,
          ),
        ),
      },
      dependency,
    };
  }

  decode(message: ArtifactMessage): ProjectBuildArtifact {
    this.dependency = message.dependency ?? this.dependency;
    return {...message.artifact, dependencies: this.dependency!};
  }

  reset(): void {
    this.dependency = undefined;
  }
}

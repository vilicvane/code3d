import type {ModelProject} from '../project/project';
import type {ProjectFileInfo} from '../project/file-reader';
import type {ProjectLanguage} from '../project/project-language';
import type {DesignContext, ModelModule} from './compiler';
import type {ModelDiagnostic} from './diagnostic';
import type {ModelExportInstance, ModelExportOptions} from './model-export';
import type {CompilationPhase} from './compilation-progress';
import type {
  SketchSnapshot,
  TopologyInspection,
  TopologyInspectionOptions,
} from '@code3d/core/tooling';
import type {SketchDrag, SketchDragPreview} from './sketch-drag';
import type {CompilationCancellation} from './compilation-cancellation';

export type CompileRequest = Readonly<{
  kind: 'compile';
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

export type CompilerRequest =
  | CompileRequest
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

export type CompilerResponse =
  | FileRequest
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

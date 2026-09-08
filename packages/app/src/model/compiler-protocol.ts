import type {ModelProject} from '../project/project';
import type {ProjectFileInfo} from '../project/file-reader';
import type {ProjectLanguage} from '../project/project-language';
import type {ModelModule} from './compiler';
import type {ModelDiagnostic} from './diagnostic';
import type {ModelExportInstance, ModelExportOptions} from './model-export';
import type {CompilationPhase} from './compilation-progress';
import type {SketchSnapshot} from '@code3d/core/tooling';
import type {SketchDrag, SketchDragPreview} from './sketch-drag';

export type CompileRequest = Readonly<{
  kind: 'compile';
  id: number;
  project: ModelProject;
  rootPath: string;
  designContextId?: string;
}>;

export type FileRequest = Readonly<{
  kind: 'file';
  id: number;
  operation: 'readFile' | 'stat';
  source: 'project' | 'builtin';
  path: string;
}>;

export type CompilerRequest =
  | CompileRequest
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
  | Readonly<{kind: 'cancel'; id: number}>
  | Readonly<{
      kind: 'file-result';
      id: number;
      value?: Uint8Array | ProjectFileInfo;
      error?: string;
    }>;

export type CompilerResponse =
  | FileRequest
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

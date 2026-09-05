import type {ModelProject} from '../project/project';
import type {ProjectFileInfo} from '../project/file-reader';
import type {ProjectLanguage} from '../project/project-language';
import type {ModelModule} from './compiler';
import type {ModelDiagnostic} from './diagnostic';

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
  | Readonly<{kind: 'evaluating'; id: number}>
  | Readonly<{kind: 'result'; id: number; ok: true; module: ModelModule}>
  | Readonly<{
      kind: 'result';
      id: number;
      ok: false;
      diagnostic: ModelDiagnostic;
    }>;

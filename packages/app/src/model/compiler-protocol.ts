import type {ModelProject} from '../project/project';
import type {ModelModule} from './compiler';
import type {ModelDiagnostic} from './diagnostic';
import type {ModelExportInstance, ModelExportOptions} from './model-export';

export type CompilerRequest =
  | Readonly<{
      kind: 'compile';
      id: number;
      project: ModelProject;
      rootPath: string;
      designContextId?: string;
    }>
  | Readonly<{
      kind: 'export';
      id: number;
      compileId: number;
      instances: readonly ModelExportInstance[];
      options: ModelExportOptions;
    }>;

export type CompilerResponse =
  | Readonly<{kind: 'compile'; id: number; ok: true; module: ModelModule}>
  | Readonly<{kind: 'export'; id: number; ok: true; blob: Blob}>
  | Readonly<{id: number; ok: false; diagnostic: ModelDiagnostic}>;

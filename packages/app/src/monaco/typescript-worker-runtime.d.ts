declare module 'monaco-editor/base/common/uri' {
  // The worker-safe implementation of the Uri exported by editor.api.
  export const URI: typeof import('monaco-editor/editor').Uri;
}

declare module 'monaco-editor/language/typescript/ts.worker' {
  import type * as typeScript from '@typescript/typescript6';
  import type * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';

  export type TypeScriptWorkerExtraLibs = Readonly<
    Record<string, Readonly<{content: string; version: number}>>
  >;

  export type TypeScriptSelectionRange = Readonly<{
    textSpan: typeScript.TextSpan;
    parent?: TypeScriptSelectionRange;
  }>;

  export interface TypeScriptLanguageService
    extends typeScript.LanguageService {
    getSmartSelectionRange(
      fileName: string,
      position: number,
    ): TypeScriptSelectionRange;
  }

  export interface TypeScriptWorker extends typeScript.LanguageServiceHost {}

  export class TypeScriptWorker {
    constructor(context: unknown, createData: unknown);
    getExtraLibs(): TypeScriptWorkerExtraLibs;
    getLanguageService(): TypeScriptLanguageService;
    getScriptFileNames(): string[];
    getSemanticDiagnostics(
      fileName: string,
    ): ReturnType<
      typeScriptLanguage.TypeScriptWorker['getSemanticDiagnostics']
    >;
  }

  export function initialize(
    factory: (context: unknown, createData: unknown) => unknown,
  ): void;
}

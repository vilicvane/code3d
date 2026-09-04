declare module 'monaco-editor/language/typescript/ts.worker' {
  import type * as typeScript from '@typescript/typescript6';

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

  export class TypeScriptWorker {
    constructor(context: unknown, createData: unknown);
    getExtraLibs(): TypeScriptWorkerExtraLibs;
    getLanguageService(): TypeScriptLanguageService;
    getScriptFileNames(): string[];
  }

  export function initialize(
    factory: (context: unknown, createData: unknown) => unknown,
  ): void;
}

declare module 'monaco-editor/language/typescript/ts.worker' {
  import type * as typeScript from '@typescript/typescript6';

  export type TypeScriptWorkerExtraLibs = Readonly<
    Record<string, Readonly<{content: string; version: number}>>
  >;

  export class TypeScriptWorker {
    constructor(context: unknown, createData: unknown);
    getExtraLibs(): TypeScriptWorkerExtraLibs;
    getLanguageService(): typeScript.LanguageService;
    getScriptFileNames(): string[];
  }

  export function initialize(
    factory: (context: unknown, createData: unknown) => unknown,
  ): void;
}

declare module 'monaco-editor/language/typescript/ts.worker' {
  import type * as typeScript from '@typescript/typescript6';

  export class TypeScriptWorker {
    constructor(context: unknown, createData: unknown);
    getLanguageService(): typeScript.LanguageService;
    getScriptFileNames(): string[];
  }

  export function initialize(
    factory: (context: unknown, createData: unknown) => unknown,
  ): void;
}

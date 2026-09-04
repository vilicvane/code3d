import type * as typeScript from '@typescript/typescript6';
import type {TypeScriptSelectionRange} from 'monaco-editor/language/typescript/ts.worker';
import type * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';

export type {TypeScriptSelectionRange};

export type TypeScriptCompletionEntry = typeScript.CompletionEntry;
export type TypeScriptCompletionInfo = typeScript.CompletionInfo;
export type TypeScriptCompletionEntryData = typeScript.CompletionEntryData;
export type TypeScriptCompletionEntryDetails =
  typeScript.CompletionEntryDetails;

export interface ProjectTypeScriptWorker
  extends typeScriptLanguage.TypeScriptWorker {
  getProjectCompletions(
    fileName: string,
    position: number,
  ): Promise<TypeScriptCompletionInfo | undefined>;

  getProjectCompletionDetails(
    fileName: string,
    position: number,
    name: string,
    source: string | undefined,
    data: TypeScriptCompletionEntryData | undefined,
  ): Promise<TypeScriptCompletionEntryDetails | undefined>;

  getProjectSelectionRanges(
    fileName: string,
    positions: readonly number[],
  ): Promise<readonly TypeScriptSelectionRange[]>;
}

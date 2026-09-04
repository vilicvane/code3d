import type * as typeScript from '@typescript/typescript6';
import {
  initialize,
  TypeScriptWorker,
  type TypeScriptSelectionRange,
} from 'monaco-editor/language/typescript/ts.worker';

const completionPreferences = {
  quotePreference: 'single',
  includeCompletionsForModuleExports: true,
  includeCompletionsForImportStatements: true,
  includeCompletionsWithInsertText: true,
  includeCompletionsWithSnippetText: false,
  useLabelDetailsInCompletionEntries: true,
  // Node modules still use their package names. Project files use relative
  // paths, which also avoids assuming a synthetic baseUrl in the browser host.
  importModuleSpecifierPreference: 'relative',
  importModuleSpecifierEnding: 'js',
  includePackageJsonAutoImports: 'off',
} satisfies typeScript.UserPreferences;

const completionFormatSettings = {
  indentSize: 2,
  tabSize: 2,
  newLineCharacter: '\n',
  convertTabsToSpaces: true,
  insertSpaceAfterCommaDelimiter: true,
  insertSpaceAfterSemicolonInForStatements: true,
  insertSpaceBeforeAndAfterBinaryOperators: true,
  insertSpaceAfterKeywordsInControlFlowStatements: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: false,
  semicolons: 'insert' as typeScript.SemicolonPreference,
} satisfies typeScript.FormatCodeSettings;

class ProjectTypeScriptWorker extends TypeScriptWorker {
  override getScriptFileNames(): string[] {
    const extraLibFileNames = new Map(
      Object.keys(this.getExtraLibs()).map(fileName => [
        uriFileIdentity(fileName),
        fileName,
      ]),
    );
    return super
      .getScriptFileNames()
      .filter(
        fileName =>
          !fileName.endsWith('/package.json') &&
          (extraLibFileNames.get(uriFileIdentity(fileName)) ?? fileName) ===
            fileName,
      );
  }

  async getProjectCompletions(
    fileName: string,
    position: number,
  ): Promise<typeScript.CompletionInfo | undefined> {
    return this.getLanguageService().getCompletionsAtPosition(
      fileName,
      position,
      completionPreferences,
    );
  }

  async getProjectCompletionDetails(
    fileName: string,
    position: number,
    name: string,
    source: string | undefined,
    data: typeScript.CompletionEntryData | undefined,
  ): Promise<typeScript.CompletionEntryDetails | undefined> {
    return this.getLanguageService().getCompletionEntryDetails(
      fileName,
      position,
      name,
      completionFormatSettings,
      source,
      completionPreferences,
      data,
    );
  }

  async getProjectSelectionRanges(
    fileName: string,
    positions: readonly number[],
  ): Promise<readonly TypeScriptSelectionRange[]> {
    const languageService = this.getLanguageService();
    return positions.map(position =>
      languageService.getSmartSelectionRange(fileName, position),
    );
  }
}

/** Monaco models serialize scoped-package paths while extra libs keep them raw. */
function uriFileIdentity(fileName: string): string {
  return decodeURIComponent(fileName);
}

self.onmessage = () => {
  initialize(
    (context, createData) => new ProjectTypeScriptWorker(context, createData),
  );
};

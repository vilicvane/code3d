import type * as typeScript from '@typescript/typescript6';
import {
  initialize,
  TypeScriptWorker,
  type TypeScriptSelectionRange,
} from 'monaco-editor/language/typescript/ts.worker';
import {AnnotationLanguageService} from './annotation-language-service';

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
  includePackageJsonAutoImports: 'on',
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
  private readonly annotations = new AnnotationLanguageService(this);

  override async getSemanticDiagnostics(fileName: string) {
    const diagnostics = await super.getSemanticDiagnostics(fileName);
    if (!this.hasParameterAnnotations(fileName)) return diagnostics;
    return [
      ...diagnostics,
      ...this.annotations.diagnostics(fileName).map(diagnostic => ({
        ...diagnostic,
        file: undefined,
      })),
    ];
  }

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
    const sourceFile = this.hasParameterAnnotations(fileName)
      ? this.annotations.sourceFile(fileName)
      : undefined;
    const annotations =
      sourceFile &&
      this.annotations.completions(sourceFile, position, completionPreferences);
    if (annotations) return annotations;
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
    const sourceFile = this.hasParameterAnnotations(fileName)
      ? this.annotations.sourceFile(fileName)
      : undefined;
    const annotation =
      sourceFile &&
      this.annotations.details(
        sourceFile,
        position,
        name,
        completionFormatSettings,
        completionPreferences,
      );
    if (annotation) return annotation;
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
    const snapshot = this.getScriptSnapshot(fileName);
    const sourceFile = snapshot
      ?.getText(0, snapshot.getLength())
      .includes('@code3d.')
      ? this.annotations.sourceFile(fileName)
      : undefined;
    return positions.map(position => {
      const outer = languageService.getSmartSelectionRange(fileName, position);
      return sourceFile
        ? this.annotations.selectionRange(sourceFile, position, outer)
        : outer;
    });
  }

  private hasParameterAnnotations(fileName: string): boolean {
    const snapshot = this.getScriptSnapshot(fileName);
    return (
      snapshot?.getText(0, snapshot.getLength()).includes('@code3d.param') ??
      false
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

import {TraceMap, originalPositionFor} from '@jridgewell/trace-mapping';
import type * as typeScript from '@typescript/typescript6';
import {
  initialize,
  TypeScriptWorker,
  type TypeScriptSelectionRange,
} from 'monaco-editor/language/typescript/ts.worker';
import {AnnotationLanguageService} from './annotation-language-service';
import {cursorTypeInfo} from './type-info';
import {
  monacoFileName,
  typeScriptFileName,
  typeScriptWorkerRequests,
} from './typescript-file-names';

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
  private navigationWorker?: ProjectTypeScriptWorker;

  constructor(
    private readonly context: unknown,
    private readonly createData: unknown,
    private readonly navigationRoot?: string,
  ) {
    super(context, createData);
  }

  /** Navigation queries get an isolated program; opening a model never adds project roots. */
  workerForRequest(
    method: PropertyKey,
    file: unknown,
  ): ProjectTypeScriptWorker {
    if (
      typeof file !== 'string' ||
      !file.startsWith('/') ||
      typeof method !== 'string' ||
      method.endsWith('Diagnostics') ||
      this.isProjectFile(file) ||
      !this.getScriptSnapshot(file)
    )
      return this;
    if (this.navigationWorker?.navigationRoot !== file) {
      this.navigationWorker?.getLanguageService().dispose();
      this.navigationWorker = new ProjectTypeScriptWorker(
        this.context,
        {
          ...(this.createData as object),
          extraLibs: this.getExtraLibs(),
        },
        file,
      );
    }
    return this.navigationWorker;
  }

  override async updateExtraLibs(
    libs: ReturnType<TypeScriptWorker['getExtraLibs']>,
  ) {
    await super.updateExtraLibs(libs);
    await this.navigationWorker?.updateExtraLibs(libs);
  }

  private isProjectFile(file: string): boolean {
    return !!this.getLanguageService().getProgram()?.getSourceFile(file);
  }

  override async getSyntacticDiagnostics(file: string) {
    return this.isProjectFile(file) ? super.getSyntacticDiagnostics(file) : [];
  }

  override async getSuggestionDiagnostics(file: string) {
    return this.isProjectFile(file) ? super.getSuggestionDiagnostics(file) : [];
  }

  override async getCompilerOptionsDiagnostics(file: string) {
    return this.isProjectFile(file)
      ? super.getCompilerOptionsDiagnostics(file)
      : [];
  }

  override readFile(file: string): string | undefined {
    return super.readFile(monacoFileName(file));
  }

  override fileExists(file: string): boolean {
    return this.readFile(file) !== undefined;
  }

  override getScriptSnapshot(file: string) {
    return super.getScriptSnapshot(monacoFileName(file));
  }

  override getScriptVersion(file: string): string {
    return super.getScriptVersion(monacoFileName(file));
  }

  override realpath(file: string): string {
    const snapshot = this.getScriptSnapshot(
      '/workspace/.__code3d-realpaths.json',
    );
    if (!snapshot) return file;
    const paths = JSON.parse(
      snapshot.getText(0, snapshot.getLength()),
    ) as Record<string, string>;
    return paths[file] ?? file;
  }

  override async getDefinitionAtPosition(file: string, position: number) {
    const definitions = await super.getDefinitionAtPosition(file, position);
    return definitions?.map(definition => this.sourceDefinition(definition));
  }

  private sourceDefinition(
    definition: typeScript.DefinitionInfo,
  ): typeScript.DefinitionInfo {
    if (!/\.d\.[cm]?ts$/.test(definition.fileName)) return definition;
    const declaration = this.readFile(definition.fileName);
    const mapping =
      declaration &&
      /\/\/# sourceMappingURL=(.+)/.exec(declaration)?.[1].trim();
    if (!mapping) return definition;
    const mapPath = typeScriptFileName(
      new URL(mapping, monacoFileName(definition.fileName)).href,
    );
    const mapSource = this.readFile(mapPath);
    if (!mapSource) return definition;
    const map = new TraceMap(mapSource, monacoFileName(mapPath));
    const locate = (offset: number) => {
      const prefix = declaration!.slice(0, offset);
      return originalPositionFor(map, {
        line: prefix.split('\n').length,
        column: offset - prefix.lastIndexOf('\n') - 1,
      });
    };
    const start = locate(definition.textSpan.start);
    if (!start.source || start.line === null || start.column === null)
      return definition;
    const sourceFile = typeScriptFileName(start.source);
    const source = this.readFile(sourceFile);
    if (source === undefined) return definition;
    const offsetAt = (line: number, column: number) => {
      let offset = 0;
      for (let current = 1; current < line; current++)
        offset = source.indexOf('\n', offset) + 1;
      return offset + column;
    };
    const offset = offsetAt(start.line, start.column);
    const end = locate(definition.textSpan.start + definition.textSpan.length);
    const length =
      end.source === start.source && end.line !== null && end.column !== null
        ? Math.max(0, offsetAt(end.line, end.column) - offset)
        : 0;
    return {
      ...definition,
      fileName: sourceFile,
      textSpan: {start: offset, length},
      contextSpan: undefined,
    };
  }

  async getProjectTypeInfo(file: string, start: number, end: number) {
    return cursorTypeInfo(this.getLanguageService(), file, start, end);
  }

  override async getSemanticDiagnostics(fileName: string) {
    if (!this.isProjectFile(fileName)) return [];
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
    if (this.navigationRoot) return [this.navigationRoot];
    const roots = this.getScriptSnapshot('/workspace/.__code3d-roots.json');
    return roots
      ? (JSON.parse(roots.getText(0, roots.getLength())) as string[])
      : [];
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

self.onmessage = () => {
  initialize((context, createData) => {
    const worker = new ProjectTypeScriptWorker(context, createData);
    return typeScriptWorkerRequests(worker, (method, file) =>
      worker.workerForRequest(method, file),
    );
  });
};

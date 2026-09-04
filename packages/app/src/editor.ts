import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/typescript/register';
import * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import ProjectTypeScriptWorker from './monaco/typescript.worker?worker';
import type {CursorOptions, Options} from 'prettier';
import {code3dCodeColors, code3dCodeFocusColors} from './code-theme';
import {
  injectedPackageFiles,
  injectedPackageSpecifiers,
} from './monaco/injected-packages';
import {
  observeSuggestionFocus,
  type FocusedSuggestion,
} from './monaco/suggestion-focus';
import {
  registerProjectTypeScriptCompletions,
  typeScriptCompletionItemKind,
} from './monaco/typescript-completions';
import type {TypeScriptCompletionEntry} from './monaco/typescript-protocol';
import {code3dAnnotations, type Code3dAnnotation} from './model/annotations';
import type {DesignArgumentContext} from './model/compiler';
import type {ModelDiagnostic} from './model/diagnostic';
import type {SourceRef} from '@code3d/core/tooling';
import {
  normalizeProjectPath,
  projectPathIsWithin,
  type ModelProject,
} from './project/project';
import type {SourceTextEdit, ToolCommitOptions} from './tools/tool-system';
import type {SourceEditExcerpt} from './ui/source-edit-popover';

type MonacoEnvironment = typeof self & {
  MonacoEnvironment: {
    getWorker(_moduleId: string, label: string): Worker;
  };
};

export type ProjectEditorChange =
  | Readonly<{
      kind: 'content';
      path: string;
      source: string;
      origin: ContentChangeOrigin;
    }>
  | Readonly<{kind: 'create'; path: string; source: string}>
  | Readonly<{kind: 'rename'; from: string; to: string}>
  | Readonly<{kind: 'delete'; path: string}>;

export type ActiveFileChangeReason = 'switch' | 'rename' | 'delete' | 'reset';

export type CompletionFocus = Readonly<{
  receiverRef?: SourceRef;
  definitionRef?: SourceRef;
  memberName: string;
  preview?: Readonly<{
    project: ModelProject;
    cursor: Readonly<{file: string; offset: number}>;
    sourceVersion: number;
  }>;
}>;

type ProjectDocument = {
  path: string;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState | null;
  subscription: monaco.IDisposable;
};

type ContentChangeOrigin = 'user' | 'tool' | 'undo' | 'redo';

type FormatOptions = Readonly<{
  origin?: 'user' | 'tool';
  undoGroup?: string;
}>;

const modelPrettierOptions = {
  parser: 'typescript',
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  jsxSingleQuote: false,
  trailingComma: 'all',
  bracketSpacing: false,
  bracketSameLine: false,
  arrowParens: 'avoid',
} satisfies Options;

const projectLanguageSelector = [
  {language: 'typescript', scheme: 'file', pattern: '**/workspace/**'},
  {language: 'javascript', scheme: 'file', pattern: '**/workspace/**'},
] satisfies monaco.languages.LanguageSelector;
const modelDiagnosticOwner = 'code3d-model';

(self as MonacoEnvironment).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'typescript' || label === 'javascript') {
      return new ProjectTypeScriptWorker();
    }
    return new EditorWorker();
  },
};

const languageCompilerOptions = {
  target: typeScriptLanguage.ScriptTarget.ESNext,
  module: 199 as typeScriptLanguage.ModuleKind,
  moduleResolution: 99 as typeScriptLanguage.ModuleResolutionKind,
  allowNonTsExtensions: true,
  allowImportingTsExtensions: true,
  strict: true,
  noEmit: true,
};
typeScriptLanguage.typescriptDefaults.setCompilerOptions(
  languageCompilerOptions,
);
typeScriptLanguage.javascriptDefaults.setCompilerOptions({
  ...languageCompilerOptions,
  allowJs: true,
});
typeScriptLanguage.typescriptDefaults.setEagerModelSync(true);
typeScriptLanguage.javascriptDefaults.setEagerModelSync(true);
typeScriptLanguage.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
});
typeScriptLanguage.typescriptDefaults.setExtraLibs(injectedPackageFiles);
typeScriptLanguage.javascriptDefaults.setExtraLibs(injectedPackageFiles);
registerProjectTypeScriptCompletions(
  projectLanguageSelector,
  injectedPackageSpecifiers,
);

monaco.languages.registerDocumentFormattingEditProvider('typescript', {
  async provideDocumentFormattingEdits(model) {
    const source = model.getValue();
    const text = await formatTypeScript(source);
    return text === source ? [] : [{range: model.getFullModelRange(), text}];
  },
});

monaco.editor.defineTheme('code3d-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    {token: 'comment', foreground: tokenColor(code3dCodeColors.comment)},
    {token: 'keyword', foreground: tokenColor(code3dCodeColors.keyword)},
    {token: 'string', foreground: tokenColor(code3dCodeColors.string)},
    {token: 'number', foreground: tokenColor(code3dCodeColors.number)},
    {token: 'type.identifier', foreground: tokenColor(code3dCodeColors.type)},
  ],
  colors: {
    'editor.background': code3dCodeColors.background,
    'editor.foreground': code3dCodeColors.foreground,
    'editorLineNumber.foreground': '#4e514a',
    'editorLineNumber.activeForeground': '#b9beaf',
    'editorCursor.foreground': code3dCodeFocusColors.cursor,
    'editor.selectionBackground': '#53651566',
    'editor.inactiveSelectionBackground': '#53651533',
    'editor.lineHighlightBackground': code3dCodeFocusColors.currentLine,
    'editorIndentGuide.background1': '#272923',
    'editorIndentGuide.activeBackground1': '#555a4e',
    'editorWidget.background': '#1a1b17',
    'editorHoverWidget.background': '#1a1b17',
    'editorSuggestWidget.background': '#1a1b17',
    'editorSuggestWidget.selectedBackground': '#303527',
  },
});

function tokenColor(color: `#${string}`): string {
  return color.slice(1);
}

const typeScriptTokenizationReady = monaco.editor.colorize(
  "['code3d', 1]",
  'typescript',
  {},
);

export class CodeEditor {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly documents = new Map<string, ProjectDocument>();
  private readonly designArgumentModels = new Map<
    string,
    monaco.editor.ITextModel
  >();
  private readonly trackedSourceRefs = new Map<string, SourceRef>();
  private designArguments: readonly DesignArgumentContext[] = [];
  private readonly annotationDecorations = new Map<string, string[]>();
  private readonly openPaths: string[] = [];
  private readonly changeListeners = new Set<
    (change: ProjectEditorChange) => void
  >();
  private readonly cursorListeners = new Set<
    (source: Readonly<{file: string; offset: number}>) => void
  >();
  private readonly activeFileListeners = new Set<
    (path: string, reason: ActiveFileChangeReason) => void
  >();
  private readonly editorActivationListeners = new Set<() => void>();
  private readonly completionFocusListeners = new Set<
    (focus: CompletionFocus | undefined) => void
  >();
  private readonly pendingToolFormats = new Map<string, string | undefined>();
  private completionFocusVersion = 0;
  private contentChangeOrigin: 'user' | 'tool' = 'user';
  private readonly sourceEditUndoGroups = new Map<string, string>();
  private readonly sourceDecoration: monaco.editor.IEditorDecorationsCollection;
  private activePath: string;
  private revision = 1;
  private suppressCursorEvent = false;

  constructor(
    private readonly container: HTMLElement,
    project: ModelProject,
    initialPath: string,
  ) {
    this.activePath = normalizeProjectPath(initialPath);
    for (const file of project.files) {
      this.addDocument(file.path, file.source);
    }
    const active = this.requireDocument(this.activePath);
    this.openPaths.push(this.activePath);
    this.editor = monaco.editor.create(container, {
      model: active.model,
      theme: 'code3d-dark',
      automaticLayout: true,
      fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: 13,
      lineHeight: 22,
      fontLigatures: true,
      minimap: {enabled: false},
      padding: {top: 18, bottom: 18},
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: 'line',
      bracketPairColorization: {enabled: true},
      guides: {bracketPairs: true, indentation: true},
      fixedOverflowWidgets: true,
      suggest: {preview: true, showWords: false},
      quickSuggestions: {other: true, comments: true, strings: false},
      tabSize: 2,
    });
    this.sourceDecoration = this.editor.createDecorationsCollection();
    this.editor.onDidChangeCursorSelection(({selection, reason}) => {
      // History and marker recovery move Monaco's cursor without the user
      // leaving the source target currently being edited by a viewport tool.
      if (
        this.suppressCursorEvent ||
        reason === monaco.editor.CursorChangeReason.RecoverFromMarkers ||
        reason === monaco.editor.CursorChangeReason.Undo ||
        reason === monaco.editor.CursorChangeReason.Redo
      ) {
        return;
      }
      this.sourceDecoration.clear();
      this.emitCursorPosition(selection.getPosition());
    });
    this.editor.onDidFocusEditorText(() => this.emitEditorActivation());
    this.editor.onMouseDown(() => this.emitEditorActivation());
    monaco.editor.registerEditorOpener({
      openCodeEditor: (source, resource, selectionOrPosition) =>
        source === this.editor &&
        this.openProjectResource(resource, selectionOrPosition),
    });
    monaco.languages.registerCompletionItemProvider(projectLanguageSelector, {
      triggerCharacters: ["'", '"'],
      provideCompletionItems: (model, position, _context, token) =>
        this.designArgumentCompletions(model, position, token),
    });
    observeSuggestionFocus(this.editor, item => {
      const version = ++this.completionFocusVersion;
      if (item) {
        void this.resolveCompletionFocus(item, version);
      } else {
        this.emitCompletionFocus(undefined);
      }
    });
    void typeScriptTokenizationReady.then(() => {
      for (const document of this.documents.values()) {
        this.refreshAnnotationDecorations(document.path, document.model);
      }
    });
  }

  project(): ModelProject {
    return {
      files: [...this.documents.values()]
        .map(({path, model}) => ({path, source: model.getValue()}))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  currentFile(): string {
    return this.activePath;
  }

  filePaths(): readonly string[] {
    return [...this.documents.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  openedFiles(): readonly string[] {
    return [...this.openPaths];
  }

  switchFile(path: string, takeFocus = false): void {
    const normalized = normalizeProjectPath(path);
    if (normalized === this.activePath) {
      if (takeFocus) this.editor.focus();
      return;
    }
    const next = this.requireDocument(normalized);
    const current = this.requireDocument(this.activePath);
    current.viewState = this.editor.saveViewState();
    this.activePath = normalized;
    if (!this.openPaths.includes(normalized)) this.openPaths.push(normalized);
    this.withSuppressedCursorEvents(() => {
      this.sourceDecoration.clear();
      this.editor.setModel(next.model);
      if (next.viewState) this.editor.restoreViewState(next.viewState);
      if (takeFocus) this.editor.focus();
    });
    this.emitActiveFile('switch');
  }

  closeFile(path: string): void {
    const normalized = normalizeProjectPath(path);
    const index = this.openPaths.indexOf(normalized);
    if (index === -1 || this.openPaths.length === 1) return;
    this.openPaths.splice(index, 1);
    if (normalized === this.activePath) {
      this.switchFile(this.openPaths[Math.max(0, index - 1)]);
    }
  }

  createFile(path: string, source = ''): void {
    const normalized = normalizeProjectPath(path);
    if (normalized === '/' || this.documents.has(normalized)) {
      throw new Error(`File already exists: ${normalized}`);
    }
    this.addDocument(normalized, source);
    this.revision += 1;
    this.emitChange({kind: 'create', path: normalized, source});
    this.switchFile(normalized, true);
  }

  renameFile(from: string, to: string): void {
    const sourcePath = normalizeProjectPath(from);
    const targetPath = normalizeProjectPath(to);
    if (this.documents.has(targetPath)) {
      throw new Error(`File already exists: ${targetPath}`);
    }
    const source = this.requireDocument(sourcePath).model.getValue();
    const wasActive = sourcePath === this.activePath;
    const openIndex = this.openPaths.indexOf(sourcePath);
    this.removeDocument(sourcePath);
    this.addDocument(targetPath, source);
    if (openIndex >= 0) this.openPaths.splice(openIndex, 1, targetPath);
    if (wasActive) {
      this.activePath = targetPath;
      this.editor.setModel(this.requireDocument(targetPath).model);
    }
    this.revision += 1;
    this.emitChange({kind: 'rename', from: sourcePath, to: targetPath});
    if (wasActive) this.emitActiveFile('rename');
  }

  deleteFile(path: string): void {
    const normalized = normalizeProjectPath(path);
    if (this.documents.size === 1) {
      throw new Error('A project needs at least one source file.');
    }
    const wasActive = normalized === this.activePath;
    const openIndex = this.openPaths.indexOf(normalized);
    if (wasActive) {
      const nextPath =
        this.openPaths.find(candidate => candidate !== normalized) ??
        [...this.documents.keys()].find(candidate => candidate !== normalized)!;
      this.activePath = nextPath;
      this.withSuppressedCursorEvents(() => {
        this.sourceDecoration.clear();
        this.editor.setModel(this.requireDocument(nextPath).model);
      });
    }
    this.removeDocument(normalized);
    if (openIndex >= 0) this.openPaths.splice(openIndex, 1);
    this.revision += 1;
    this.emitChange({kind: 'delete', path: normalized});
    if (wasActive) this.emitActiveFile('delete');
  }

  replaceDirectory(project: ModelProject, directory: string): void {
    const normalizedDirectory = normalizeProjectPath(directory);
    const replacementFiles = project.files.filter(file =>
      projectPathIsWithin(file.path, normalizedDirectory),
    );
    const replacementPaths = new Set(replacementFiles.map(file => file.path));
    const activeDocumentReplaced = projectPathIsWithin(
      this.activePath,
      normalizedDirectory,
    );

    this.sourceDecoration.clear();
    this.trackedSourceRefs.clear();
    [...this.documents.keys()]
      .filter(path => projectPathIsWithin(path, normalizedDirectory))
      .forEach(path => this.removeDocument(path));
    replacementFiles.forEach(file => this.addDocument(file.path, file.source));

    const retainedOpenPaths = this.openPaths.filter(
      path =>
        !projectPathIsWithin(path, normalizedDirectory) ||
        replacementPaths.has(path),
    );
    this.openPaths.splice(0, this.openPaths.length, ...retainedOpenPaths);
    if (activeDocumentReplaced) {
      if (!replacementPaths.has(this.activePath)) {
        this.activePath =
          replacementFiles[0]?.path ?? [...this.documents.keys()][0]!;
      }
      if (!this.openPaths.includes(this.activePath)) {
        this.openPaths.push(this.activePath);
      }
      this.editor.setModel(this.requireDocument(this.activePath).model);
    }
    this.revision += 1;
    this.emitActiveFile('reset');
  }

  sourceVersion(): number {
    return this.revision;
  }

  ownsFocus(): boolean {
    return this.container.contains(document.activeElement);
  }

  runHistoryAction(action: 'undo' | 'redo'): void {
    const model = this.activeModel();
    if (action === 'undo') {
      if (model.canUndo()) void model.undo();
    } else if (model.canRedo()) {
      void model.redo();
    }
  }

  cursorSource(): Readonly<{file: string; offset: number}> | undefined {
    const position = this.editor.getPosition();
    return position
      ? {
          file: this.activePath,
          offset: this.activeModel().getOffsetAt(position),
        }
      : undefined;
  }

  readSource(sourceRef: SourceRef): string {
    const model = this.requireDocument(sourceRef.file).model;
    return model.getValueInRange(sourceRange(model, sourceRef));
  }

  setDesignArguments(contexts: readonly DesignArgumentContext[]): void {
    this.designArguments = contexts;
  }

  trackSourceRefs(sourceRefs: readonly SourceRef[]): void {
    this.trackedSourceRefs.clear();
    sourceRefs.forEach(sourceRef =>
      this.trackedSourceRefs.set(sourceRefKey(sourceRef), sourceRef),
    );
  }

  resolveSourceRef(sourceRef: SourceRef): SourceRef | undefined {
    return this.trackedSourceRefs.get(sourceRefKey(sourceRef));
  }

  applySourceEdits(
    baseVersion: number,
    edits: readonly SourceTextEdit[],
    options: ToolCommitOptions = {},
  ): boolean {
    if (this.revision !== baseVersion || edits.length === 0) return false;
    const grouped = groupEditsByFile(edits);
    for (const [path, fileEdits] of grouped) {
      const model = this.documents.get(path)?.model;
      if (!model || !validEdits(model, fileEdits)) return false;
    }
    this.withSuppressedCursorEvents(() =>
      this.withContentChangeOrigin('tool', () => {
        for (const [path, fileEdits] of grouped) {
          const model = this.requireDocument(path).model;
          this.pushSourceEdits(
            path,
            [...fileEdits]
              .sort(
                (left, right) => right.sourceRef.start - left.sourceRef.start,
              )
              .map(edit => ({
                range: sourceRange(model, edit.sourceRef),
                text: edit.text,
                forceMoveMarkers: true,
              })),
            options.undoGroup,
          );
        }
      }),
    );
    for (const path of grouped.keys()) {
      this.pendingToolFormats.set(path, options.undoGroup);
    }
    return true;
  }

  async formatPendingToolEdits(): Promise<void> {
    const pending = [...this.pendingToolFormats];
    this.pendingToolFormats.clear();
    await Promise.all(
      pending.map(async ([path, undoGroup]) => {
        try {
          await this.formatFile(path, {origin: 'tool', undoGroup});
        } finally {
          if (undoGroup) this.endSourceEditGroup(undoGroup);
        }
      }),
    );
  }

  hasPendingToolEdits(): boolean {
    return this.pendingToolFormats.size > 0;
  }

  discardPendingToolFormat(path: string, undoGroup: string): void {
    const normalized = normalizeProjectPath(path);
    if (this.pendingToolFormats.get(normalized) === undoGroup) {
      this.pendingToolFormats.delete(normalized);
    }
  }

  resumeSourceEditGroup(path: string, undoGroup: string): void {
    const normalized = normalizeProjectPath(path);
    if (this.documents.has(normalized)) {
      this.sourceEditUndoGroups.set(normalized, undoGroup);
    }
  }

  endSourceEditGroup(undoGroup: string): void {
    for (const [path, activeGroup] of this.sourceEditUndoGroups) {
      if (activeGroup === undoGroup) this.sourceEditUndoGroups.delete(path);
    }
  }

  sourceEditExcerpts(edits: readonly SourceTextEdit[]): SourceEditExcerpt[] {
    return [...groupEditsByFile(edits)].flatMap(([file, fileEdits]) => {
      const source = this.requireDocument(file).model.getValue();
      return sourceEditExcerpts(source, fileEdits, file);
    });
  }

  onChange(listener: (change: ProjectEditorChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onCursorOffset(
    listener: (source: Readonly<{file: string; offset: number}>) => void,
  ): () => void {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  }

  onActiveFile(
    listener: (path: string, reason: ActiveFileChangeReason) => void,
  ): () => void {
    this.activeFileListeners.add(listener);
    return () => this.activeFileListeners.delete(listener);
  }

  onEditorActivation(listener: () => void): () => void {
    this.editorActivationListeners.add(listener);
    return () => this.editorActivationListeners.delete(listener);
  }

  onCompletionFocus(
    listener: (focus: CompletionFocus | undefined) => void,
  ): () => void {
    this.completionFocusListeners.add(listener);
    return () => this.completionFocusListeners.delete(listener);
  }

  revealSource(sourceRef: SourceRef, takeFocus = false): void {
    this.switchFile(sourceRef.file);
    const range = sourceRange(this.activeModel(), sourceRef);
    this.withSuppressedCursorEvents(() => {
      this.sourceDecoration.set([
        {
          range,
          options: {
            className: 'code3d-source-selection',
            inlineClassName: 'code3d-source-selection-inline',
            overviewRuler: {
              color: '#d8ff3e88',
              position: monaco.editor.OverviewRulerLane.Right,
            },
          },
        },
      ]);
      this.editor.setSelection(range);
      this.editor.revealRangeInCenterIfOutsideViewport(range);
      if (takeFocus) this.editor.focus();
    });
  }

  clearSourceHighlight(): void {
    this.sourceDecoration.clear();
  }

  setModelDiagnostic(diagnostic?: ModelDiagnostic): void {
    for (const document of this.documents.values()) {
      const sourceRef = diagnostic?.sourceRef;
      const marker =
        diagnostic && sourceRef?.file === document.path
          ? modelDiagnosticMarker(document.model, diagnostic, sourceRef)
          : undefined;
      monaco.editor.setModelMarkers(
        document.model,
        modelDiagnosticOwner,
        marker ? [marker] : [],
      );
    }
  }

  async hasLanguageError(): Promise<boolean> {
    const model = this.editor.getModel();
    if (!model) return false;
    const version = model.getVersionId();
    try {
      const factory = await (model.getLanguageId() === 'javascript'
        ? typeScriptLanguage.getJavaScriptWorker()
        : typeScriptLanguage.getTypeScriptWorker());
      const worker = await factory(model.uri);
      const diagnostics = await Promise.all([
        worker.getSyntacticDiagnostics(model.uri.toString()),
        worker.getSemanticDiagnostics(model.uri.toString()),
      ]);
      if (
        model.isDisposed() ||
        this.editor.getModel() !== model ||
        model.getVersionId() !== version
      ) {
        return false;
      }
      return diagnostics.some(group =>
        group.some(diagnostic => diagnostic.category === 1),
      );
    } catch {
      return false;
    }
  }

  private async resolveCompletionFocus(
    suggestion: FocusedSuggestion,
    version: number,
  ): Promise<void> {
    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    const document = [...this.documents.values()].find(
      candidate => candidate.model === model,
    );
    if (!model || !position || !document) {
      if (version === this.completionFocusVersion)
        this.emitCompletionFocus(undefined);
      return;
    }
    const memberName = completionLabel(suggestion.completion.label);
    const preview = completionProject(
      this.project(),
      document.path,
      model,
      position,
      suggestion,
      this.editor.getOption(monaco.editor.EditorOption.suggest).insertMode,
      this.revision,
    );
    const receiverRef = completionReceiver(model, position, document.path);
    if (!receiverRef) {
      if (version === this.completionFocusVersion) {
        this.emitCompletionFocus({memberName, preview});
      }
      return;
    }
    const workerFactory = await (model.getLanguageId() === 'javascript'
      ? typeScriptLanguage.getJavaScriptWorker()
      : typeScriptLanguage.getTypeScriptWorker());
    const worker = await workerFactory(model.uri);
    const definitions = (await worker.getDefinitionAtPosition(
      model.uri.toString(),
      Math.max(receiverRef.start, receiverRef.end - 1),
    )) as
      | readonly Readonly<{
          fileName: string;
          textSpan: Readonly<{start: number; length: number}>;
        }>[]
      | undefined;
    if (
      version !== this.completionFocusVersion ||
      this.editor.getModel() !== model
    ) {
      return;
    }
    this.emitCompletionFocus({
      receiverRef,
      definitionRef: definitions
        ?.map(definitionSourceRef)
        .find(reference => reference !== undefined),
      memberName,
      preview,
    });
  }

  private async designArgumentCompletions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.CompletionList | undefined> {
    const document = [...this.documents.values()].find(
      candidate => candidate.model === model,
    );
    if (!document) return undefined;
    const source = model.getValue();
    const offset = model.getOffsetAt(position);
    const annotation = code3dAnnotations(source).find(
      candidate =>
        candidate.name === 'arguments' &&
        candidate.valueStart < offset &&
        offset <= candidate.valueEnd,
    );
    if (!annotation) return undefined;
    const context = this.designArguments.find(
      candidate =>
        candidate.annotationRef.file === document.path &&
        candidate.annotationRef.start === annotation.start,
    );
    const site = context ? {annotation, context} : undefined;
    if (!site) return undefined;
    const virtualCall = designArgumentVirtualCall(source, site, offset);
    if (!virtualCall) return undefined;

    const virtualModel = this.designArgumentModel(
      document.path,
      model.getLanguageId(),
      virtualCall.source,
    );
    const workerFactory = await (model.getLanguageId() === 'javascript'
      ? typeScriptLanguage.getJavaScriptWorker()
      : typeScriptLanguage.getTypeScriptWorker());
    if (token.isCancellationRequested) return undefined;
    const worker = await workerFactory(virtualModel.uri);
    const completions = (await worker.getCompletionsAtPosition(
      virtualModel.uri.toString(),
      virtualCall.offset,
    )) as {entries?: TypeScriptCompletionEntry[]} | undefined;
    if (!completions?.entries || token.isCancellationRequested) {
      return undefined;
    }
    return {
      suggestions: completions.entries.map(entry => ({
        label: entry.name,
        kind: typeScriptCompletionItemKind(entry.kind),
        detail: entry.kind,
        insertText: entry.insertText ?? entry.name,
        sortText: entry.sortText,
        tags: entry.kindModifiers?.includes('deprecated')
          ? [monaco.languages.CompletionItemTag.Deprecated]
          : undefined,
        range: completionRange(
          model,
          position,
          site,
          virtualCall.argumentsStart,
          virtualCall.argumentsEnd,
          entry.replacementSpan,
        ),
      })),
    };
  }

  private designArgumentModel(
    path: string,
    language: string,
    source: string,
  ): monaco.editor.ITextModel {
    const existing = this.designArgumentModels.get(path);
    if (existing) {
      if (existing.getValue() !== source) existing.setValue(source);
      return existing;
    }
    const uri = designArgumentModelUri(this.requireDocument(path).model.uri);
    const model = monaco.editor.createModel(source, language, uri);
    this.designArgumentModels.set(path, model);
    return model;
  }

  private addDocument(path: string, source: string): void {
    const normalized = normalizeProjectPath(path);
    const model = monaco.editor.createModel(
      source,
      languageForPath(normalized),
      monaco.Uri.parse(`file:///workspace${normalized}`),
    );
    this.refreshAnnotationDecorations(normalized, model);
    const document: ProjectDocument = {
      path: normalized,
      model,
      subscription: model.onDidChangeContent(event => {
        const origin: ContentChangeOrigin = event.isUndoing
          ? 'undo'
          : event.isRedoing
            ? 'redo'
            : this.contentChangeOrigin;
        if (origin !== 'tool') this.sourceEditUndoGroups.delete(normalized);
        this.rebaseTrackedSourceRefs(normalized, event.changes);
        this.refreshAnnotationDecorations(normalized, model);
        this.revision += 1;
        this.emitChange({
          kind: 'content',
          path: normalized,
          source: model.getValue(),
          origin,
        });
      }),
    };
    this.documents.set(normalized, document);
  }

  private removeDocument(path: string): void {
    const document = this.requireDocument(path);
    this.pendingToolFormats.delete(path);
    this.sourceEditUndoGroups.delete(path);
    for (const [key, sourceRef] of this.trackedSourceRefs) {
      if (sourceRef.file === path) this.trackedSourceRefs.delete(key);
    }
    this.designArgumentModels.get(path)?.dispose();
    this.designArgumentModels.delete(path);
    document.subscription.dispose();
    document.model.dispose();
    this.annotationDecorations.delete(path);
    this.documents.delete(path);
  }

  private rebaseTrackedSourceRefs(
    path: string,
    changes: readonly monaco.editor.IModelContentChange[],
  ): void {
    for (const [key, sourceRef] of this.trackedSourceRefs) {
      if (sourceRef.file !== path) continue;
      const rebased = rebaseSourceRef(sourceRef, changes);
      if (rebased) {
        this.trackedSourceRefs.set(key, rebased);
      } else {
        this.trackedSourceRefs.delete(key);
      }
    }
  }

  private refreshAnnotationDecorations(
    path: string,
    model: monaco.editor.ITextModel,
  ): void {
    this.annotationDecorations.set(
      path,
      model.deltaDecorations(
        this.annotationDecorations.get(path) ?? [],
        annotationDecorations(path, model),
      ),
    );
  }

  private activeModel(): monaco.editor.ITextModel {
    return this.requireDocument(this.activePath).model;
  }

  private requireDocument(path: string): ProjectDocument {
    const normalized = normalizeProjectPath(path);
    const document = this.documents.get(normalized);
    if (!document) throw new Error(`Project file not found: ${normalized}`);
    return document;
  }

  private emitChange(change: ProjectEditorChange): void {
    this.changeListeners.forEach(listener => listener(change));
  }

  private emitCompletionFocus(focus: CompletionFocus | undefined): void {
    this.completionFocusListeners.forEach(listener => listener(focus));
  }

  private emitActiveFile(reason: ActiveFileChangeReason): void {
    this.activeFileListeners.forEach(listener =>
      listener(this.activePath, reason),
    );
  }

  private emitEditorActivation(): void {
    this.editorActivationListeners.forEach(listener => listener());
  }

  private openProjectResource(
    resource: monaco.Uri,
    selectionOrPosition?: monaco.IRange | monaco.IPosition,
  ): boolean {
    const target = [...this.documents.values()].find(
      document => document.model.uri.toString() === resource.toString(),
    );
    if (!target) return false;

    this.switchFile(target.path);
    this.sourceDecoration.clear();
    this.withSuppressedCursorEvents(() => {
      if (monaco.Range.isIRange(selectionOrPosition)) {
        const range = monaco.Range.lift(selectionOrPosition);
        this.editor.setSelection(range);
        this.editor.revealRangeInCenterIfOutsideViewport(range);
      } else if (selectionOrPosition) {
        this.editor.setPosition(selectionOrPosition);
        this.editor.revealPositionInCenterIfOutsideViewport(
          selectionOrPosition,
        );
      }
      this.editor.focus();
    });
    const position = this.editor.getPosition();
    if (position) this.emitCursorPosition(position);
    return true;
  }

  private emitCursorPosition(position: monaco.IPosition): void {
    const offset = this.activeModel().getOffsetAt(position);
    this.cursorListeners.forEach(listener =>
      listener({file: this.activePath, offset}),
    );
  }

  private async formatFile(
    path: string,
    options: FormatOptions = {},
  ): Promise<boolean> {
    const document = this.requireDocument(path);
    const {model} = document;
    const source = model.getValue();
    const version = model.getVersionId();
    let cursorOffset = this.activeCursorOffset(model);
    let result = await formatTypeScriptWithCursor(source, cursorOffset ?? 0);
    while (model.getVersionId() === version) {
      if (result.formatted === source) return true;
      const currentCursorOffset = this.activeCursorOffset(model);
      if (
        currentCursorOffset !== undefined &&
        currentCursorOffset !== cursorOffset
      ) {
        cursorOffset = currentCursorOffset;
        result = await formatTypeScriptWithCursor(source, cursorOffset);
        continue;
      }
      this.withContentChangeOrigin(options.origin ?? 'user', () =>
        this.withSuppressedCursorEvents(() => {
          this.pushSourceEdits(
            path,
            [
              {
                range: model.getFullModelRange(),
                text: result.formatted,
                forceMoveMarkers: true,
              },
            ],
            options.undoGroup,
          );
          if (
            currentCursorOffset !== undefined &&
            this.editor.getModel() === model
          ) {
            this.editor.setPosition(model.getPositionAt(result.cursorOffset));
          }
        }),
      );
      return true;
    }
    return false;
  }

  private activeCursorOffset(
    model: monaco.editor.ITextModel,
  ): number | undefined {
    if (this.editor.getModel() !== model) return undefined;
    const position = this.editor.getPosition();
    return position ? model.getOffsetAt(position) : undefined;
  }

  private withContentChangeOrigin<T>(
    origin: 'user' | 'tool',
    action: () => T,
  ): T {
    const previous = this.contentChangeOrigin;
    this.contentChangeOrigin = origin;
    try {
      return action();
    } finally {
      this.contentChangeOrigin = previous;
    }
  }

  private pushSourceEdits(
    path: string,
    edits: readonly monaco.editor.IIdentifiedSingleEditOperation[],
    undoGroup?: string,
  ): void {
    const model = this.requireDocument(path).model;
    if (
      undoGroup &&
      this.sourceEditUndoGroups.get(path) === undoGroup &&
      model.canUndo()
    ) {
      model.popStackElement();
    } else {
      model.pushStackElement();
    }
    model.pushEditOperations([], [...edits], () => null);
    model.pushStackElement();
    if (undoGroup) {
      this.sourceEditUndoGroups.set(path, undoGroup);
    } else {
      this.sourceEditUndoGroups.delete(path);
    }
  }

  private withSuppressedCursorEvents(action: () => void): void {
    this.suppressCursorEvent = true;
    try {
      action();
    } finally {
      queueMicrotask(() => {
        this.suppressCursorEvent = false;
      });
    }
  }
}

function sourceRange(
  model: monaco.editor.ITextModel,
  sourceRef: SourceRef,
): monaco.Range {
  const start = model.getPositionAt(sourceRef.start);
  const end = model.getPositionAt(sourceRef.end);
  return new monaco.Range(
    start.lineNumber,
    start.column,
    end.lineNumber,
    end.column,
  );
}

function modelDiagnosticMarker(
  model: monaco.editor.ITextModel,
  diagnostic: ModelDiagnostic,
  sourceRef: SourceRef,
): monaco.editor.IMarkerData {
  const sourceLength = model.getValueLength();
  const startOffset = Math.min(sourceLength, Math.max(0, sourceRef.start));
  const endOffset = Math.min(
    sourceLength,
    Math.max(startOffset, sourceRef.end),
  );
  const start = model.getPositionAt(startOffset);
  const end = model.getPositionAt(endOffset);
  return {
    severity: monaco.MarkerSeverity.Error,
    source: 'code3d',
    code: diagnostic.kind,
    message: diagnostic.details
      ? `${diagnostic.summary}\n\n${diagnostic.details}`
      : diagnostic.summary,
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

function sourceRefKey(sourceRef: SourceRef): string {
  return `${sourceRef.file}:${sourceRef.start}:${sourceRef.end}`;
}

function rebaseSourceRef(
  sourceRef: SourceRef,
  changes: readonly monaco.editor.IModelContentChange[],
): SourceRef | undefined {
  let shift = 0;
  let internalDelta = 0;
  for (const change of [...changes].sort(
    (left, right) => left.rangeOffset - right.rangeOffset,
  )) {
    const changeStart = change.rangeOffset;
    const changeEnd = changeStart + change.rangeLength;
    const delta = change.text.length - change.rangeLength;
    if (change.rangeLength === 0 && changeStart === sourceRef.start) {
      internalDelta += delta;
    } else if (changeEnd <= sourceRef.start) {
      shift += delta;
    } else if (changeStart >= sourceRef.end) {
      if (change.rangeLength === 0 && changeStart === sourceRef.end) {
        internalDelta += delta;
      }
    } else if (changeStart === sourceRef.start && changeEnd === sourceRef.end) {
      const start = sourceRef.start + shift;
      return {
        file: sourceRef.file,
        start,
        end: start + change.text.length,
      };
    } else if (sourceRef.start <= changeStart && changeEnd <= sourceRef.end) {
      internalDelta += delta;
    } else {
      return undefined;
    }
  }
  return {
    file: sourceRef.file,
    start: sourceRef.start + shift,
    end: sourceRef.end + shift + internalDelta,
  };
}

function validEdits(
  model: monaco.editor.ITextModel,
  edits: readonly SourceTextEdit[],
): boolean {
  const ordered = [...edits].sort(
    (left, right) => left.sourceRef.start - right.sourceRef.start,
  );
  return ordered.every((edit, index) => {
    const previous = ordered[index - 1];
    return (
      (!previous || previous.sourceRef.end <= edit.sourceRef.start) &&
      model.getValueInRange(sourceRange(model, edit.sourceRef)) ===
        edit.expectedText
    );
  });
}

function groupEditsByFile(
  edits: readonly SourceTextEdit[],
): Map<string, SourceTextEdit[]> {
  const grouped = new Map<string, SourceTextEdit[]>();
  for (const edit of edits) {
    const fileEdits = grouped.get(edit.sourceRef.file) ?? [];
    fileEdits.push(edit);
    grouped.set(edit.sourceRef.file, fileEdits);
  }
  return grouped;
}

function sourceEditExcerpts(
  source: string,
  edits: readonly SourceTextEdit[],
  file: string,
): SourceEditExcerpt[] {
  let offsetDelta = 0;
  return [...edits]
    .sort((left, right) => left.sourceRef.start - right.sourceRef.start)
    .map(edit => {
      const start = edit.sourceRef.start + offsetDelta;
      const end = start + edit.text.length;
      offsetDelta +=
        edit.text.length - (edit.sourceRef.end - edit.sourceRef.start);
      const lineStart = source.lastIndexOf('\n', start - 1) + 1;
      const followingLineBreak = source.indexOf('\n', end);
      const lineEnd =
        followingLineBreak === -1 ? source.length : followingLineBreak;
      const lineNumber = source.slice(0, lineStart).split('\n').length;
      const rawSource = source.slice(lineStart, lineEnd);
      const contentStart = rawSource.length - rawSource.trimStart().length;
      const contentEnd = rawSource.trimEnd().length;
      return {
        file,
        lineNumber,
        source: rawSource.slice(contentStart, contentEnd),
        changedStart: start - lineStart - contentStart,
        changedEnd: end - lineStart - contentStart,
        sourceRef: {file, start, end},
      };
    });
}

function completionProject(
  project: ModelProject,
  file: string,
  model: monaco.editor.ITextModel,
  position: monaco.IPosition,
  suggestion: FocusedSuggestion,
  insertMode: 'insert' | 'replace',
  sourceVersion: number,
): CompletionFocus['preview'] {
  const {completion} = suggestion;
  if (
    (completion.insertTextRules ?? 0) &
    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
  ) {
    return undefined;
  }
  const editEnd =
    insertMode === 'replace'
      ? suggestion.editReplaceEnd
      : suggestion.editInsertEnd;
  const columnDelta = position.column - suggestion.requestedPosition.column;
  if (
    position.lineNumber !== suggestion.requestedPosition.lineNumber ||
    columnDelta < 0
  ) {
    return undefined;
  }
  const primaryRange = new monaco.Range(
    suggestion.editStart.lineNumber,
    suggestion.editStart.column,
    editEnd.lineNumber,
    editEnd.column + columnDelta,
  );
  const edits = [
    {
      start: model.getOffsetAt(primaryRange.getStartPosition()),
      end: model.getOffsetAt(primaryRange.getEndPosition()),
      text: completion.insertText,
      primary: true,
    },
    ...(completion.additionalTextEdits ?? []).map(edit => ({
      start: model.getOffsetAt(
        monaco.Range.lift(edit.range).getStartPosition(),
      ),
      end: model.getOffsetAt(monaco.Range.lift(edit.range).getEndPosition()),
      text: edit.text,
      primary: false,
    })),
  ].sort((left, right) => left.start - right.start || left.end - right.end);
  if (
    edits.some((edit, index) => index > 0 && edits[index - 1].end > edit.start)
  ) {
    return undefined;
  }

  const source = model.getValue();
  let completedSource = '';
  let consumed = 0;
  let projectedCursor = 0;
  for (const edit of edits) {
    completedSource += source.slice(consumed, edit.start) + edit.text;
    consumed = edit.end;
    if (edit.primary) projectedCursor = completedSource.length;
  }
  completedSource += source.slice(consumed);
  return {
    project: {
      ...project,
      files: project.files.map(projectFile =>
        projectFile.path === file
          ? {...projectFile, source: completedSource}
          : projectFile,
      ),
    },
    cursor: {file, offset: projectedCursor},
    sourceVersion,
  };
}

function completionReceiver(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  file: string,
): SourceRef | undefined {
  const source = model.getValue();
  const word = model.getWordUntilPosition(position);
  const wordStart = model.getOffsetAt({
    lineNumber: position.lineNumber,
    column: word.startColumn,
  });
  if (source[wordStart - 1] !== '.') return undefined;
  let end = wordStart - 1;
  while (end > 0 && /\s/.test(source[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[\w$]/.test(source[start - 1])) start -= 1;
  return start < end ? {file, start, end} : undefined;
}

function definitionSourceRef(
  definition: Readonly<{
    fileName: string;
    textSpan: Readonly<{start: number; length: number}>;
  }>,
): SourceRef | undefined {
  const uri = monaco.Uri.parse(definition.fileName);
  const workspacePrefix = '/workspace';
  if (uri.scheme !== 'file' || !uri.path.startsWith(`${workspacePrefix}/`)) {
    return undefined;
  }
  return {
    file: normalizeProjectPath(uri.path.slice(workspacePrefix.length)),
    start: definition.textSpan.start,
    end: definition.textSpan.start + definition.textSpan.length,
  };
}

function completionLabel(
  label: monaco.languages.CompletionItem['label'],
): string {
  return typeof label === 'string' ? label : label.label;
}

type DesignArgumentVirtualCall = Readonly<{
  source: string;
  offset: number;
  argumentsStart: number;
  argumentsEnd: number;
}>;

type DesignArgumentCompletionSite = Readonly<{
  annotation: Code3dAnnotation;
  context: DesignArgumentContext;
}>;

function designArgumentVirtualCall(
  source: string,
  site: DesignArgumentCompletionSite,
  cursorOffset: number,
): DesignArgumentVirtualCall | undefined {
  const {annotation, context} = site;
  if (!annotation.value.startsWith('[')) return undefined;
  const valueEnd = annotation.value.endsWith(']')
    ? annotation.value.length - 1
    : annotation.value.length;
  const cursorInValue = cursorOffset - annotation.valueStart;
  if (cursorInValue < 1 || cursorInValue > valueEnd) return undefined;
  const argumentsSource = annotation.value.slice(1, valueEnd);
  const helperName = `__code3dArguments${annotation.start}`;
  const callPrefix = `\nfunction ${helperName}${context.signature.typeParametersSource}(${context.signature.parametersSource}) {}\n${helperName}(`;
  const argumentsStart = source.length + callPrefix.length;
  return {
    source: `${source}${callPrefix}${argumentsSource});\n`,
    offset: argumentsStart + cursorInValue - 1,
    argumentsStart,
    argumentsEnd: argumentsStart + argumentsSource.length,
  };
}

function designArgumentModelUri(original: monaco.Uri): monaco.Uri {
  const slash = original.path.lastIndexOf('/');
  return original.with({
    path: `${original.path.slice(0, slash + 1)}.__code3d-intellisense-${original.path.slice(slash + 1)}`,
  });
}

function completionRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  site: DesignArgumentCompletionSite,
  argumentsStart: number,
  argumentsEnd: number,
  replacementSpan?: Readonly<{start: number; length: number}>,
): monaco.IRange {
  if (
    replacementSpan &&
    argumentsStart <= replacementSpan.start &&
    replacementSpan.start + replacementSpan.length <= argumentsEnd
  ) {
    const start =
      site.annotation.valueStart + 1 + replacementSpan.start - argumentsStart;
    const end = start + replacementSpan.length;
    return monaco.Range.fromPositions(
      model.getPositionAt(start),
      model.getPositionAt(end),
    );
  }
  const word = model.getWordUntilPosition(position);
  return new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
}

function annotationDecorations(
  path: string,
  model: monaco.editor.ITextModel,
): monaco.editor.IModelDeltaDecoration[] {
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];
  for (const annotation of code3dAnnotations(model.getValue())) {
    decorations.push({
      range: sourceRange(model, {
        file: path,
        start: annotation.start,
        end: annotation.end,
      }),
      options: annotationDecorationOptions('code3d-annotation'),
    });
    if (annotation.name !== 'arguments' || annotation.value.length === 0) {
      continue;
    }

    const tokens = monaco.editor.tokenize(annotation.value, 'typescript')[0];
    if (!tokens || tokens.length === 0) {
      decorations.push({
        range: sourceRange(model, {
          file: path,
          start: annotation.valueStart,
          end: annotation.valueEnd,
        }),
        options: annotationDecorationOptions('code3d-annotation-value'),
      });
      continue;
    }
    tokens.forEach((token, index) => {
      const nextOffset = tokens[index + 1]?.offset ?? annotation.value.length;
      decorations.push({
        range: sourceRange(model, {
          file: path,
          start: annotation.valueStart + token.offset,
          end: annotation.valueStart + nextOffset,
        }),
        options: annotationDecorationOptions(
          `code3d-annotation-value code3d-annotation-value-${annotationTokenKind(token.type)}`,
        ),
      });
    });
  }
  return decorations;
}

function annotationDecorationOptions(
  inlineClassName: string,
): monaco.editor.IModelDecorationOptions {
  return {
    inlineClassName,
    inlineClassNameAffectsLetterSpacing: false,
  };
}

function annotationTokenKind(tokenType: string): string {
  if (tokenType.includes('string')) return 'string';
  if (tokenType.includes('number')) return 'number';
  if (tokenType.includes('keyword')) return 'keyword';
  return 'plain';
}

function languageForPath(path: string): string {
  return /\.[cm]?jsx?$/.test(path) ? 'javascript' : 'typescript';
}

async function formatTypeScript(source: string): Promise<string> {
  const {prettier, plugins} = await loadPrettier();
  return prettier.format(source, {...modelPrettierOptions, plugins});
}

async function formatTypeScriptWithCursor(
  source: string,
  cursorOffset: number,
) {
  const {prettier, plugins} = await loadPrettier();
  const options: CursorOptions = {
    ...modelPrettierOptions,
    plugins,
    cursorOffset,
  };
  return prettier.formatWithCursor(source, options);
}

async function loadPrettier() {
  const [prettier, typescriptPlugin, estreePlugin] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/estree'),
  ]);
  return {prettier, plugins: [typescriptPlugin, estreePlugin]};
}

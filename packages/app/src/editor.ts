import * as monaco from 'monaco-editor/editor';
import {AgentError} from '@code3d/agent';
import {diffChars} from 'diff';
import {randomAgentColor} from './agent/colors';
import {projectTypeScriptWorker} from './monaco/typescript-worker-client';
import type {CursorTypeInfo} from './monaco/type-info';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/typescript/register';
import {language as typeScriptTokens} from 'monaco-editor/languages/definitions/typescript/typescript';
import 'monaco-editor/languages/definitions/javascript/register';
import {language as javaScriptTokens} from 'monaco-editor/languages/definitions/javascript/javascript';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/features/json/register';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/yaml/register';
import type {ProjectFileReader} from './project/file-reader';
import {decodeProjectFile} from './project/file-reader';
import * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import ProjectTypeScriptWorker from './monaco/typescript.worker?worker';
import type {CursorOptions, Options} from 'prettier';
import {
  code3dCodeColors,
  code3dCodeFocusColors,
  code3dEditorWidgetColors,
} from './code-theme';
import type {ProjectLanguage} from './project/project-language';
import {
  observeSuggestionFocus,
  type FocusedSuggestion,
} from './monaco/suggestion-focus';
import {
  registerProjectTypeScriptCompletions,
  typeScriptCompletionItemKind,
} from './monaco/typescript-completions';
import type {TypeScriptCompletionEntry} from './monaco/typescript-protocol';
import {registerProjectTypeScriptSelectionRanges} from './monaco/typescript-selection-ranges';
import {EmbeddedCodeProjection} from './monaco/embedded-code';
import {code3dAnnotations, type Code3dAnnotation} from './model/annotations';
import type {DesignArgumentContext} from './model/compiler';
import type {ModelDiagnostic} from './model/diagnostic';
import type {SourceRef} from '@code3d/core/tooling';
import {
  normalizeProjectPath,
  isSourceFile,
  isReadonlyProjectFile,
  projectPathIsWithin,
  type ModelProject,
} from './project/project';
import type {SourceTextEdit, ToolCommitOptions} from './tools/tool-system';
import {rebaseSourceRef} from './tools/source-ref';
import {sourceEditDiff, type SourceEditDiff} from './source-edit-diff';

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

export type AgentLocation = Readonly<{
  id: string;
  name: string;
  file: string;
  color: number;
}>;

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

export type EditorCursor = Readonly<{file: string; offset: number}>;

type ProjectDocument = {
  path: string;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState | null;
  subscription: monaco.IDisposable;
};

type ContentChangeOrigin = 'user' | 'tool' | 'agent' | 'undo' | 'redo';

type FormatOptions = Readonly<{
  origin?: 'user' | 'tool';
  undoGroup?: string;
  cursor?: EditorCursor & Readonly<{selectionVersion: number}>;
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
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') {
      return new ProjectTypeScriptWorker();
    }
    return new EditorWorker();
  },
};

const languageCompilerOptions = {
  target: typeScriptLanguage.ScriptTarget.ESNext,
  lib: ['lib.esnext.d.ts'],
  module: 199 as typeScriptLanguage.ModuleKind,
  moduleResolution: 99 as typeScriptLanguage.ModuleResolutionKind,
  allowNonTsExtensions: true,
  allowImportingTsExtensions: true,
  strict: true,
  skipLibCheck: true,
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
let projectPackageSpecifiers: readonly string[] = [];
registerProjectTypeScriptCompletions(
  projectLanguageSelector,
  () => projectPackageSpecifiers,
);
registerProjectTypeScriptSelectionRanges(projectLanguageSelector);

monaco.editor.addKeybindingRule({
  keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
  command: 'editor.action.quickCommand',
  when: 'editorFocus',
});

monaco.languages.registerDocumentFormattingEditProvider('typescript', {
  async provideDocumentFormattingEdits(model) {
    const source = model.getValue();
    const text = await formatTypeScript(source, prettierEndOfLine(model));
    return formattingEdits(model, source, text);
  },
});

// Monaco's built-in identifier rules only cover ASCII. Extend the shared
// grammar so legal Unicode names stay whole, including inside templates.
for (const [languageId, definition] of [
  ['typescript', typeScriptTokens],
  ['javascript', javaScriptTokens],
] as const) {
  monaco.languages.setMonarchTokensProvider(languageId, {
    ...definition,
    unicode: true,
    tokenizer: {
      ...definition.tokenizer,
      common: [
        [
          /#?[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*/u,
          {
            cases: {
              '@keywords': 'keyword',
              '[A-Z].*': 'type.identifier',
              '@default': 'identifier',
            },
          },
        ],
        ...definition.tokenizer.common,
      ],
    },
  });
}

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
    foreground: code3dCodeColors.foreground,
    focusBorder: code3dEditorWidgetColors.accent,
    'selection.background': code3dEditorWidgetColors.selectionBackground,
    'textLink.foreground': code3dEditorWidgetColors.accent,
    'textLink.activeForeground': code3dEditorWidgetColors.accent,
    'input.background': code3dCodeColors.background,
    'input.foreground': code3dCodeColors.foreground,
    'input.border': code3dEditorWidgetColors.border,
    'inputOption.activeBorder': code3dEditorWidgetColors.accent,
    'inputOption.activeBackground': code3dEditorWidgetColors.selectedBackground,
    'inputOption.activeForeground': code3dEditorWidgetColors.accent,
    'inputOption.hoverBackground': code3dEditorWidgetColors.hoverBackground,
    'list.activeSelectionBackground':
      code3dEditorWidgetColors.selectedBackground,
    'list.activeSelectionForeground': code3dCodeColors.foreground,
    'list.focusBackground': code3dEditorWidgetColors.selectedBackground,
    'list.focusForeground': code3dCodeColors.foreground,
    'list.inactiveSelectionBackground':
      code3dEditorWidgetColors.selectedBackground,
    'list.inactiveSelectionForeground': code3dCodeColors.foreground,
    'list.inactiveFocusBackground': code3dEditorWidgetColors.hoverBackground,
    'list.hoverBackground': code3dEditorWidgetColors.hoverBackground,
    'list.highlightForeground': code3dEditorWidgetColors.accent,
    'list.focusHighlightForeground': code3dEditorWidgetColors.accent,
    'pickerGroup.foreground': code3dEditorWidgetColors.accent,
    'pickerGroup.border': code3dEditorWidgetColors.border,
    'menu.background': code3dEditorWidgetColors.background,
    'menu.foreground': code3dCodeColors.foreground,
    'menu.border': code3dEditorWidgetColors.border,
    'menu.selectionBackground': code3dEditorWidgetColors.selectedBackground,
    'menu.selectionForeground': code3dCodeColors.foreground,
    'button.background': code3dEditorWidgetColors.accent,
    'button.foreground': code3dCodeColors.background,
    'progressBar.background': code3dEditorWidgetColors.accent,
    'editor.background': code3dCodeColors.background,
    'editor.foreground': code3dCodeColors.foreground,
    'editorLineNumber.foreground': '#4e514a',
    'editorLineNumber.activeForeground': '#b9beaf',
    'editorCursor.foreground': code3dCodeFocusColors.cursor,
    'editor.selectionBackground': code3dEditorWidgetColors.selectionBackground,
    'editor.inactiveSelectionBackground':
      code3dEditorWidgetColors.inactiveSelectionBackground,
    'editor.selectionHighlightBackground': code3dCodeFocusColors.relatedSymbol,
    'editor.wordHighlightBackground': code3dCodeFocusColors.relatedSymbol,
    'editor.wordHighlightStrongBackground': code3dCodeFocusColors.currentSymbol,
    'editor.wordHighlightTextBackground': code3dCodeFocusColors.relatedSymbol,
    'editor.findMatchBackground': code3dCodeFocusColors.currentSymbol,
    'editor.findMatchBorder': code3dEditorWidgetColors.accentBorder,
    'editor.findMatchHighlightBackground': code3dCodeFocusColors.relatedSymbol,
    'editor.findRangeHighlightBackground': code3dCodeFocusColors.relatedSymbol,
    'editor.hoverHighlightBackground': code3dCodeFocusColors.relatedSymbol,
    'editor.rangeHighlightBackground': code3dCodeFocusColors.relatedSymbol,
    'editorLink.activeForeground': code3dEditorWidgetColors.accent,
    'editorBracketMatch.background': code3dCodeFocusColors.relatedSymbol,
    'editorBracketMatch.border': code3dCodeFocusColors.bracketMatch,
    'editorOverviewRuler.selectionHighlightForeground':
      code3dCodeFocusColors.overviewMarker,
    'editorOverviewRuler.wordHighlightForeground':
      code3dCodeFocusColors.overviewMarker,
    'editorOverviewRuler.wordHighlightStrongForeground':
      code3dCodeFocusColors.overviewMarker,
    'editorOverviewRuler.wordHighlightTextForeground':
      code3dCodeFocusColors.overviewMarker,
    'editorOverviewRuler.findMatchForeground':
      code3dCodeFocusColors.overviewMarker,
    'editor.lineHighlightBackground': code3dCodeFocusColors.currentLine,
    'editorIndentGuide.background1': '#272923',
    'editorIndentGuide.activeBackground1': '#555a4e',
    'editorWidget.background': code3dEditorWidgetColors.background,
    'editorWidget.foreground': code3dCodeColors.foreground,
    'editorWidget.border': code3dEditorWidgetColors.border,
    'editorWidget.resizeBorder': code3dEditorWidgetColors.accent,
    'editorHoverWidget.statusBarBackground':
      code3dEditorWidgetColors.hoverBackground,
    'peekView.border': code3dEditorWidgetColors.accentBorder,
    'peekViewTitle.background': code3dEditorWidgetColors.background,
    'peekViewTitleLabel.foreground': code3dCodeColors.foreground,
    'peekViewTitleDescription.foreground':
      code3dEditorWidgetColors.mutedForeground,
    'peekViewResult.background': code3dEditorWidgetColors.background,
    'peekViewResult.lineForeground': code3dCodeColors.foreground,
    'peekViewResult.fileForeground': code3dCodeColors.foreground,
    'peekViewResult.selectionBackground':
      code3dEditorWidgetColors.selectedBackground,
    'peekViewResult.selectionForeground': code3dCodeColors.foreground,
    'peekViewResult.matchHighlightBackground':
      code3dCodeFocusColors.currentSymbol,
    'peekViewEditor.background': code3dCodeColors.background,
    'peekViewEditorGutter.background': code3dCodeColors.background,
    'peekViewEditorStickyScroll.background': code3dCodeColors.background,
    'peekViewEditorStickyScrollGutter.background': code3dCodeColors.background,
    'peekViewEditor.matchHighlightBackground':
      code3dCodeFocusColors.currentSymbol,
    'peekViewEditor.matchHighlightBorder':
      code3dEditorWidgetColors.accentBorder,
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
  fileReader?: ProjectFileReader;
  private projectLanguage?: ProjectLanguage;
  private navigationFiles = new Map<string, string>();

  isModelFile(path: string): boolean {
    return (
      isSourceFile(path) &&
      !/\.d\.[cm]?ts$/.test(path) &&
      !isReadonlyProjectFile(path)
    );
  }

  async openFile(path: string, takeFocus = true): Promise<void> {
    if (!this.documents.has(path)) {
      const bytes = await this.fileReader?.readFile(path);
      const source =
        bytes === undefined
          ? this.navigationFiles.get(path)
          : decodeProjectFile(bytes);
      if (source === undefined) throw new Error(`File not found: ${path}`);
      this.addDocument(path, source);
    }
    this.switchFile(path, takeFocus);
  }

  async refreshPackageInstallation(
    directory: string,
    files: ProjectFileReader,
  ): Promise<void> {
    const modules = normalizeProjectPath(directory + '/node_modules');
    const lock = normalizeProjectPath(directory + '/code3d-lock.json');
    const affected = (path: string) =>
      path === lock || projectPathIsWithin(path, modules);
    const updates = await Promise.all(
      [...this.documents.values()]
        .filter(document => affected(document.path))
        .map(async document => ({
          document,
          bytes: await files.readFile(document.path),
        })),
    );
    // Remove stale fallback sources and TypeScript extra libraries, including
    // paths that were only opened by Peek. The next compile supplies new types.
    if (this.projectLanguage)
      this.setProjectLanguage({
        ...this.projectLanguage,
        files: this.projectLanguage.files.filter(file => !affected(file.path)),
        realPaths: Object.fromEntries(
          Object.entries(this.projectLanguage.realPaths ?? {}).filter(
            ([from, to]) => !affected(from) && !affected(to),
          ),
        ),
      });
    for (const path of this.navigationFiles.keys())
      if (affected(path)) this.navigationFiles.delete(path);
    for (const {document, bytes} of updates) {
      if (this.documents.get(document.path) !== document) continue;
      if (bytes === undefined) {
        this.closeFile(document.path);
        this.removeDocument(document.path);
        continue;
      }
      const source = decodeProjectFile(bytes);
      if (document.model.getValue() === source) continue;
      const active = document.path === this.activePath;
      const view = active ? this.editor.saveViewState() : undefined;
      this.withSuppressedCursorEvents(() => {
        document.model.setValue(source);
        if (view) this.editor.restoreViewState(view);
      });
    }
  }

  setProjectLanguage(language: ProjectLanguage): void {
    this.projectLanguage = language;
    projectPackageSpecifiers = language.packageSpecifiers;
    this.navigationFiles = new Map(
      language.files.map(file => [file.path, file.source]),
    );
    const extraLibs = language.files.map(file => ({
      filePath: monaco.Uri.file('/workspace' + file.path).toString(),
      content: file.source,
    }));
    extraLibs.push({
      filePath: 'file:///workspace/.__code3d-realpaths.json',
      content: JSON.stringify(
        Object.fromEntries(
          Object.entries(language.realPaths ?? {}).map(([from, to]) => [
            '/workspace' + from,
            '/workspace' + to,
          ]),
        ),
      ),
    });
    // Monaco forwards these options to the project's TypeScript worker.
    const options = {
      ...languageCompilerOptions,
      ...language.compilerOptions,
    } as typeScriptLanguage.CompilerOptions;
    for (const defaults of [
      typeScriptLanguage.typescriptDefaults,
      typeScriptLanguage.javascriptDefaults,
    ]) {
      // Monaco restarts the worker on every options update, even when equal.
      // Compilation and completion previews routinely publish the same setup.
      if (
        JSON.stringify(defaults.getCompilerOptions()) !==
        JSON.stringify(options)
      ) {
        defaults.setCompilerOptions(options);
      }
      const installed = defaults.getExtraLibs();
      if (
        Object.keys(installed).length !== extraLibs.length ||
        extraLibs.some(lib => installed[lib.filePath]?.content !== lib.content)
      ) {
        defaults.setExtraLibs(extraLibs);
      }
    }
  }

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
  private readonly cursorListeners = new Set<(source: EditorCursor) => void>();
  private readonly agentLocationListeners = new Set<
    (locations: readonly AgentLocation[]) => void
  >();
  private readonly activeFileListeners = new Set<
    (path: string | undefined, reason: ActiveFileChangeReason) => void
  >();
  private readonly editorActivationListeners = new Set<
    (cursor: EditorCursor | undefined) => void
  >();
  private readonly completionFocusListeners = new Set<
    (focus: CompletionFocus | undefined) => void
  >();
  private readonly pendingToolFormats = new Map<string, string | undefined>();
  private completionFocusVersion = 0;
  private contentChangeOrigin: 'user' | 'tool' | 'agent' = 'user';
  private readonly sourceEditUndoGroups = new Map<string, string>();
  private readonly sourceDecoration: monaco.editor.IEditorDecorationsCollection;
  private activePath: string | undefined;
  private cursorSelectionVersion = 0;
  private pointerActivatingEditor = false;
  private revision = 1;
  private focusToolParameter?: () => boolean;
  private operationReadOnly = false;
  private suppressCursorEventDepth = 0;
  private queuedChanges?: ProjectEditorChange[];
  private readonly agentCursors = new Map<
    string,
    {
      name: string;
      color: number;
      label: HTMLElement;
      activity: HTMLTimeElement;
      widget: monaco.editor.IContentWidget;
      ref?: SourceRef;
      invalid: boolean;
      decorations: string[];
      decoratedFile?: string;
    }
  >();

  constructor(
    private readonly container: HTMLElement,
    project: ModelProject,
    initialPath: string | undefined,
  ) {
    this.activePath =
      initialPath === undefined ? undefined : normalizeProjectPath(initialPath);
    for (const file of project.files) {
      this.addDocument(file.path, file.source);
    }
    const active = this.activePath
      ? this.requireDocument(this.activePath)
      : undefined;
    if (this.activePath) this.openPaths.push(this.activePath);
    this.editor = monaco.editor.create(container, {
      model: active?.model ?? null,
      readOnly: this.readOnly,
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
    this.editor.addCommand(
      monaco.KeyCode.Tab,
      () => {
        if (!this.focusToolParameter?.())
          this.editor.trigger('keyboard', 'tab', {});
      },
      `editorId == '${this.editor.getId()}' && editorTextFocus && !editorReadonly && !editorHasSelection && !editorHasMultipleSelections && !suggestWidgetVisible && !inSnippetMode && !inlineSuggestionVisible && !editorTabMovesFocus`,
    );
    this.editor.onDidChangeModel(() => {
      this.editor.updateOptions({readOnly: this.readOnly});
      for (const cursor of this.agentCursors.values()) {
        this.editor.layoutContentWidget(cursor.widget);
      }
    });
    this.editor.onDidChangeConfiguration(event => {
      if (
        event.hasChanged(monaco.editor.EditorOption.lineHeight) ||
        event.hasChanged(monaco.editor.EditorOption.cursorWidth) ||
        event.hasChanged(monaco.editor.EditorOption.fontInfo) ||
        event.hasChanged(monaco.editor.EditorOption.pixelRatio)
      ) {
        for (const cursor of this.agentCursors.values())
          this.editor.layoutContentWidget(cursor.widget);
      }
    });
    this.editor.onDidChangeCursorSelection(({selection, reason}) => {
      this.cursorSelectionVersion += 1;
      // History and marker recovery move Monaco's cursor without the user
      // leaving the source target currently being edited by a viewport tool.
      if (
        this.suppressCursorEventDepth > 0 ||
        reason === monaco.editor.CursorChangeReason.RecoverFromMarkers ||
        reason === monaco.editor.CursorChangeReason.Undo ||
        reason === monaco.editor.CursorChangeReason.Redo
      ) {
        return;
      }
      this.sourceDecoration.clear();
      this.emitCursorPosition(selection.getPosition());
    });
    // Focus arrives before Monaco finishes placing a pointer caret. Use the
    // position reported by Monaco when the gesture completes as the formatting
    // anchor instead of relying on browser event scheduling.
    this.container.addEventListener(
      'pointerdown',
      () => {
        this.pointerActivatingEditor = true;
      },
      {capture: true},
    );
    this.editor.onMouseUp(({target}) => {
      if (!this.pointerActivatingEditor) return;
      this.pointerActivatingEditor = false;
      this.emitEditorActivation(target.position ?? undefined);
    });
    window.addEventListener('pointerup', () => {
      if (!this.pointerActivatingEditor) return;
      this.pointerActivatingEditor = false;
      this.emitEditorActivation();
    });
    window.addEventListener(
      'pointercancel',
      () => {
        this.pointerActivatingEditor = false;
      },
      {capture: true},
    );
    this.editor.onDidFocusEditorText(() => {
      if (!this.pointerActivatingEditor) this.emitEditorActivation();
    });
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
    const activityTimer = window.setInterval(
      () => this.refreshAgentActivity(),
      10_000,
    );
    window.addEventListener(
      'pagehide',
      () => window.clearInterval(activityTimer),
      {once: true},
    );
  }

  project(): ModelProject {
    return {
      files: [...this.documents.values()]
        .filter(document => !isReadonlyProjectFile(document.path))
        .map(({path, model}) => ({path, source: model.getValue()}))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  currentFile(): string | undefined {
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

  loadFile(path: string, source: string): void {
    const normalized = normalizeProjectPath(path);
    if (this.documents.has(normalized)) return;
    this.addDocument(normalized, source);
    this.revision++;
  }

  setReadOnly(readOnly: boolean): void {
    this.operationReadOnly = readOnly;
    this.editor.updateOptions({readOnly: this.readOnly});
  }

  private get readOnly(): boolean {
    return (
      this.operationReadOnly ||
      (!!this.activePath && isReadonlyProjectFile(this.activePath))
    );
  }

  moveFiles(from: string, to: string): void {
    const source = normalizeProjectPath(from);
    const target = normalizeProjectPath(to);
    for (const path of this.filePaths().filter(path =>
      projectPathIsWithin(path, source),
    )) {
      this.renameFile(path, target + path.slice(source.length));
    }
  }

  switchFile(path: string | undefined, takeFocus = false): void {
    const normalized =
      path === undefined ? undefined : normalizeProjectPath(path);
    if (normalized === this.activePath) {
      if (takeFocus) this.editor.focus();
      return;
    }
    const next = normalized ? this.requireDocument(normalized) : undefined;
    if (this.activePath) {
      this.requireDocument(this.activePath).viewState =
        this.editor.saveViewState();
    }
    this.activePath = normalized;
    if (!normalized) this.openPaths.length = 0;
    if (normalized && !this.openPaths.includes(normalized))
      this.openPaths.push(normalized);
    this.withSuppressedCursorEvents(() => {
      this.sourceDecoration.clear();
      this.editor.setModel(next?.model ?? null);
      if (next?.viewState) this.editor.restoreViewState(next.viewState);
      if (takeFocus) this.editor.focus();
    });
    this.emitActiveFile('switch');
  }

  closeFile(path: string): void {
    const normalized = normalizeProjectPath(path);
    const index = this.openPaths.indexOf(normalized);
    if (index === -1) return;
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
    const viewState = wasActive
      ? this.editor.saveViewState()
      : this.requireDocument(sourcePath).viewState;
    const agents = [...this.agentCursors].flatMap(([id, cursor]) =>
      cursor.ref?.file === sourcePath
        ? [{id, name: cursor.name, ref: {...cursor.ref, file: targetPath}}]
        : [],
    );
    const openIndex = this.openPaths.indexOf(sourcePath);
    this.removeDocument(sourcePath);
    this.addDocument(targetPath, source);
    this.requireDocument(targetPath).viewState = viewState;
    if (openIndex >= 0) this.openPaths.splice(openIndex, 1, targetPath);
    if (wasActive) {
      this.activePath = targetPath;
      this.editor.setModel(this.requireDocument(targetPath).model);
      if (viewState) this.editor.restoreViewState(viewState);
    }
    for (const agent of agents)
      this.setAgentCursor(agent.id, agent.name, agent.ref);
    this.revision += 1;
    this.emitChange({kind: 'rename', from: sourcePath, to: targetPath});
    if (wasActive) this.emitActiveFile('rename');
  }

  deleteFile(path: string): void {
    const normalized = normalizeProjectPath(path);
    const wasActive = normalized === this.activePath;
    const openIndex = this.openPaths.indexOf(normalized);
    if (wasActive) {
      const nextPath =
        this.openPaths.find(candidate => candidate !== normalized) ??
        [...this.documents.keys()].find(candidate => candidate !== normalized);
      this.activePath = nextPath;
      if (nextPath && !this.openPaths.includes(nextPath))
        this.openPaths.push(nextPath);
      this.withSuppressedCursorEvents(() => {
        this.sourceDecoration.clear();
        this.editor.setModel(
          nextPath ? this.requireDocument(nextPath).model : null,
        );
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
    const loadedPaths = new Set(this.documents.keys());
    const activeDocumentReplaced =
      this.activePath !== undefined &&
      projectPathIsWithin(this.activePath, normalizedDirectory);

    this.sourceDecoration.clear();
    this.trackedSourceRefs.clear();
    [...this.documents.keys()]
      .filter(path => projectPathIsWithin(path, normalizedDirectory))
      .forEach(path => this.removeDocument(path));
    for (const path of this.navigationFiles.keys()) {
      if (projectPathIsWithin(path, normalizedDirectory))
        this.navigationFiles.delete(path);
    }
    for (const file of replacementFiles) {
      this.navigationFiles.set(file.path, file.source);
      if (loadedPaths.has(file.path)) this.addDocument(file.path, file.source);
    }

    const retainedOpenPaths = this.openPaths.filter(
      path =>
        !projectPathIsWithin(path, normalizedDirectory) ||
        replacementPaths.has(path),
    );
    this.openPaths.splice(0, this.openPaths.length, ...retainedOpenPaths);
    if (activeDocumentReplaced && this.activePath) {
      if (!replacementPaths.has(this.activePath)) {
        this.activePath =
          replacementFiles[0]?.path ?? [...this.documents.keys()][0];
      }
      if (this.activePath && !this.openPaths.includes(this.activePath)) {
        this.openPaths.push(this.activePath);
      }
      this.editor.setModel(
        this.activePath ? this.requireDocument(this.activePath).model : null,
      );
    }
    this.revision += 1;
    this.emitActiveFile('reset');
  }

  sourceVersion(): number {
    return this.revision;
  }

  fileState(path: string): {content: string; version: string} | undefined {
    const model = this.documents.get(path)?.model;
    return model
      ? {
          content: model.getValue(),
          version: `${model.id}:${model.getVersionId()}`,
        }
      : undefined;
  }

  /** Called only after the project service has checked the complete proposed batch. */
  applyFiles(files: readonly {path: string; content: string | null}[]): void {
    const changes: ProjectEditorChange[] = [];
    this.queuedChanges = changes;
    try {
      this.withSuppressedCursorEvents(() =>
        this.withContentChangeOrigin('agent', () => {
          for (const file of files) {
            if (file.content === null) continue;
            const document = this.documents.get(file.path);
            if (!document) {
              this.addDocument(file.path, file.content);
              this.revision++;
              this.emitChange({
                kind: 'create',
                path: file.path,
                source: file.content,
              });
            } else {
              const before = document.model.getValue();
              if (before === file.content) continue;
              let start = 0;
              while (
                start < before.length &&
                start < file.content.length &&
                before[start] === file.content[start]
              )
                start++;
              let oldEnd = before.length;
              let newEnd = file.content.length;
              while (
                oldEnd > start &&
                newEnd > start &&
                before[oldEnd - 1] === file.content[newEnd - 1]
              ) {
                oldEnd--;
                newEnd--;
              }
              this.pushSourceEdits(file.path, [
                {
                  range: sourceRange(document.model, {
                    file: file.path,
                    start,
                    end: oldEnd,
                  }),
                  text: file.content.slice(start, newEnd),
                  forceMoveMarkers: true,
                },
              ]);
            }
          }
          for (const file of files)
            if (file.content === null && this.documents.has(file.path))
              this.deleteFile(file.path);
        }),
      );
    } finally {
      this.queuedChanges = undefined;
    }
    for (const change of changes) this.emitChange(change);
  }

  setAgentCursor(
    id: string,
    name: string,
    ref?: SourceRef,
    color?: number,
  ): void {
    let cursor = this.agentCursors.get(id);
    if (!cursor) {
      color ??= randomAgentColor();
      const caret = document.createElement('div');
      caret.className = `agent-caret agent-color-${color}`;
      const label = document.createElement('div');
      label.className = 'agent-cursor-label';
      const nameLabel = document.createElement('span');
      const activity = document.createElement('time');
      activity.hidden = true;
      label.append(nameLabel, activity);
      caret.append(label);
      const widget: monaco.editor.IContentWidget = {
        getId: () => `agent-cursor-${id}`,
        getDomNode: () => caret,
        beforeRender: () => {
          const options = monaco.editor.EditorOption;
          const ratio = this.editor.getOption(options.pixelRatio);
          const lineWidth =
            Math.min(
              this.editor.getOption(options.cursorWidth),
              this.editor.getOption(options.fontInfo)
                .typicalHalfwidthCharacterWidth,
            ) || 2;
          // Match Monaco's normal line caret, including physical pixel rounding.
          const width = Math.max(1, Math.floor(lineWidth * ratio)) / ratio;
          const height = this.editor.getOption(options.lineHeight);
          caret.style.width = `${width}px`;
          caret.style.height = `${height}px`;
          const ref = this.agentCursors.get(id)?.ref;
          const column =
            ref &&
            this.documents.get(ref.file)?.model.getPositionAt(ref.start).column;
          caret.style.transform =
            width >= 2 && column && column > 1 ? 'translateX(-1px)' : '';
          return {width, height};
        },
        getPosition: () => {
          const ref = this.agentCursors.get(id)?.ref;
          const model = this.editor.getModel();
          return ref && model && this.documents.get(ref.file)?.model === model
            ? {
                position: model.getPositionAt(ref.start),
                preference: [
                  monaco.editor.ContentWidgetPositionPreference.EXACT,
                ],
              }
            : null;
        },
        suppressMouseDown: true,
      };
      cursor = {
        name,
        color,
        label: nameLabel,
        activity,
        widget,
        invalid: false,
        decorations: [],
      };
      this.agentCursors.set(id, cursor);
      this.editor.addContentWidget(widget);
    }
    cursor.name = name;
    cursor.label.textContent = name;
    cursor.ref = ref;
    cursor.invalid = false;
    this.refreshAgentCursor(id);
  }

  setAgentActivity(id: string, at: string): void {
    const activity = this.agentCursors.get(id)!.activity;
    activity.dateTime = at;
    activity.title = 'Last active ' + new Date(at).toLocaleString();
    activity.hidden = false;
    this.refreshAgentActivity();
  }

  private refreshAgentActivity(): void {
    for (const {activity} of this.agentCursors.values()) {
      if (activity.hidden) continue;
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - Date.parse(activity.dateTime)) / 1000),
      );
      activity.textContent =
        seconds < 10
          ? 'just now'
          : seconds < 60
            ? `${seconds}s ago`
            : seconds < 3600
              ? `${Math.floor(seconds / 60)}m ago`
              : seconds < 86400
                ? `${Math.floor(seconds / 3600)}h ago`
                : `${Math.floor(seconds / 86400)}d ago`;
    }
  }

  agentCursor(id: string): {ref?: SourceRef; invalid: boolean} {
    const cursor = this.agentCursors.get(id);
    return {ref: cursor?.ref, invalid: cursor?.invalid ?? false};
  }

  async inspectType(ref: SourceRef): Promise<CursorTypeInfo | null> {
    if (!this.sourceDocument(ref.file)) {
      const bytes = await this.fileReader?.readFile(ref.file);
      if (bytes) this.addDocument(ref.file, decodeProjectFile(bytes));
    }
    const model = this.requireDocument(ref.file).model;
    const version = this.revision;
    const worker = await projectTypeScriptWorker(
      model.getLanguageId(),
      model.uri,
    );
    const info = await worker.getProjectTypeInfo(
      model.uri.toString(),
      ref.start,
      ref.end,
    );
    if (model.isDisposed() || version !== this.revision)
      throw new AgentError(
        'observation_superseded',
        'Project changed during type inspection. Request a new observation.',
      );
    return info
      ? {...info, sourceRef: {...info.sourceRef, file: ref.file}}
      : null;
  }

  removeAgentCursor(id: string): void {
    const cursor = this.agentCursors.get(id);
    if (!cursor) return;
    if (cursor.decoratedFile)
      this.documents
        .get(cursor.decoratedFile)
        ?.model.deltaDecorations(cursor.decorations, []);
    this.editor.removeContentWidget(cursor.widget);
    this.agentCursors.delete(id);
    this.emitAgentLocations();
  }

  private refreshAgentCursor(id: string): void {
    const cursor = this.agentCursors.get(id)!;
    if (cursor.decoratedFile)
      this.documents
        .get(cursor.decoratedFile)
        ?.model.deltaDecorations(cursor.decorations, []);
    const model = cursor.ref && this.documents.get(cursor.ref.file)?.model;
    cursor.decoratedFile = model ? cursor.ref!.file : undefined;
    cursor.decorations = model
      ? model.deltaDecorations(
          [],
          [
            {
              range: sourceRange(model, cursor.ref!),
              options: {
                className: `agent-selection agent-color-${cursor.color}`,
                hoverMessage: {value: cursor.name, isTrusted: false},
                stickiness:
                  monaco.editor.TrackedRangeStickiness
                    .NeverGrowsWhenTypingAtEdges,
              },
            },
          ],
        )
      : [];
    this.editor.layoutContentWidget(cursor.widget);
    this.emitAgentLocations();
  }

  private emitAgentLocations(): void {
    const locations = [...this.agentCursors].flatMap(([id, cursor]) =>
      cursor.ref
        ? [
            {
              id,
              name: cursor.name,
              file: cursor.ref.file,
              color: cursor.color,
            },
          ]
        : [],
    );
    for (const listener of this.agentLocationListeners) listener(locations);
  }

  ownsFocus(): boolean {
    return this.container.contains(document.activeElement);
  }

  setParameterFocusHandler(handler: () => boolean): void {
    this.focusToolParameter = handler;
  }

  runHistoryAction(action: 'undo' | 'redo'): void {
    const model = this.editor.getModel();
    if (!model) return;
    if (action === 'undo') {
      if (model.canUndo()) void model.undo();
    } else if (model.canRedo()) {
      void model.redo();
    }
  }

  cursorSource(): EditorCursor | undefined {
    const position = this.editor.getPosition();
    return this.cursorAt(position);
  }

  private cursorAt(
    position: monaco.IPosition | null | undefined,
  ): EditorCursor | undefined {
    const model = this.editor.getModel();
    return position && model && this.activePath
      ? {
          file: this.activePath,
          offset: model.getOffsetAt(position),
        }
      : undefined;
  }

  selectedSource(): SourceRef | undefined {
    const selection = this.editor.getSelection();
    const model = this.editor.getModel();
    if (!selection || !model || !this.activePath) return undefined;
    return {
      file: this.activePath,
      start: model.getOffsetAt(selection.getStartPosition()),
      end: model.getOffsetAt(selection.getEndPosition()),
    };
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
      const model = this.sourceDocument(path)?.model;
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

  async formatPendingToolEdits(cursor?: EditorCursor): Promise<void> {
    const pending = [...this.pendingToolFormats];
    this.pendingToolFormats.clear();
    await Promise.all(
      pending.map(async ([path, undoGroup]) => {
        try {
          await this.formatFile(path, {
            origin: 'tool',
            undoGroup,
            cursor:
              cursor?.file === path
                ? {...cursor, selectionVersion: this.cursorSelectionVersion}
                : undefined,
          });
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

  sourceEditDiffs(edits: readonly SourceTextEdit[]): SourceEditDiff[] {
    return [...groupEditsByFile(edits)].map(([file, fileEdits]) => {
      const source = this.requireDocument(file).model.getValue();
      return sourceEditDiff(file, source, fileEdits);
    });
  }

  onChange(listener: (change: ProjectEditorChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onAgentLocations(
    listener: (locations: readonly AgentLocation[]) => void,
  ): () => void {
    this.agentLocationListeners.add(listener);
    return () => this.agentLocationListeners.delete(listener);
  }

  onCursorOffset(
    listener: (source: Readonly<{file: string; offset: number}>) => void,
  ): () => void {
    this.cursorListeners.add(listener);
    return () => this.cursorListeners.delete(listener);
  }

  onActiveFile(
    listener: (
      path: string | undefined,
      reason: ActiveFileChangeReason,
    ) => void,
  ): () => void {
    this.activeFileListeners.add(listener);
    return () => this.activeFileListeners.delete(listener);
  }

  onEditorActivation(
    listener: (cursor: EditorCursor | undefined) => void,
  ): () => void {
    this.editorActivationListeners.add(listener);
    return () => this.editorActivationListeners.delete(listener);
  }

  onCompletionFocus(
    listener: (focus: CompletionFocus | undefined) => void,
  ): () => void {
    this.completionFocusListeners.add(listener);
    return () => this.completionFocusListeners.delete(listener);
  }

  revealSource(
    sourceRef: SourceRef,
    takeFocus = false,
    cursorAt: 'start' | 'end' = 'end',
  ): void {
    this.switchFile(sourceRef.file);
    const range = sourceRange(
      this.requireDocument(sourceRef.file).model,
      sourceRef,
    );
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
      this.editor.setSelection(
        cursorAt === 'start'
          ? new monaco.Selection(
              range.endLineNumber,
              range.endColumn,
              range.startLineNumber,
              range.startColumn,
            )
          : range,
      );
      this.editor.revealRangeInCenterIfOutsideViewport(range);
      if (takeFocus) this.editor.focus();
    });
  }

  clearSourceHighlight(): void {
    this.sourceDecoration.clear();
  }

  setModelDiagnostics(diagnostics: readonly ModelDiagnostic[] = []): void {
    for (const document of this.documents.values()) {
      const markers = diagnostics.flatMap(diagnostic =>
        diagnostic.sourceRef?.file === document.path
          ? [
              modelDiagnosticMarker(
                document.model,
                diagnostic,
                diagnostic.sourceRef,
              ),
            ]
          : [],
      );
      monaco.editor.setModelMarkers(
        document.model,
        modelDiagnosticOwner,
        markers,
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
      virtualCall.toGeneratedOffset(offset),
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
          virtualCall,
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
    const uri = monaco.Uri.file('/workspace' + normalized);
    const model =
      monaco.editor.getModel(uri) ??
      monaco.editor.createModel(source, languageForPath(normalized), uri);
    this.refreshAnnotationDecorations(normalized, model);
    let previousSource = model.getValue();
    const document: ProjectDocument = {
      path: normalized,
      model,
      subscription: model.onDidChangeContent(event => {
        if (isReadonlyProjectFile(normalized)) return;
        const origin: ContentChangeOrigin = event.isUndoing
          ? 'undo'
          : event.isRedoing
            ? 'redo'
            : this.contentChangeOrigin;
        if (origin !== 'tool') this.sourceEditUndoGroups.delete(normalized);
        this.rebaseTrackedSourceRefs(
          normalized,
          event.changes,
          origin,
          previousSource,
        );
        previousSource = model.getValue();
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
    this.navigationFiles.delete(path);
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
    for (const [id, cursor] of this.agentCursors) {
      if (cursor.ref?.file === path) {
        cursor.ref = undefined;
        cursor.invalid = true;
        this.refreshAgentCursor(id);
      }
    }
  }

  private rebaseTrackedSourceRefs(
    path: string,
    changes: readonly monaco.editor.IModelContentChange[],
    origin: ContentChangeOrigin,
    previousSource: string,
  ): void {
    // Monaco coalesces adjacent edits in undo/redo. Recover their local differences
    // so replacing a quote beside whitespace does not swallow a cursor boundary.
    const agentChanges = changes.flatMap(change =>
      minimalTextChanges(
        previousSource.slice(
          change.rangeOffset,
          change.rangeOffset + change.rangeLength,
        ),
        change.text,
      ).map(edit => ({
        ...edit,
        rangeOffset: edit.rangeOffset + change.rangeOffset,
      })),
    );
    for (const [id, cursor] of this.agentCursors) {
      if (cursor.ref?.file !== path) continue;
      if (cursor.ref.start === cursor.ref.end) {
        // A collaboration caret stays empty. Insertions move it forward; a
        // replacement keeps its start boundary or collapses an interior caret.
        let offset = cursor.ref.start;
        for (const change of [...agentChanges].sort(
          (a, b) => b.rangeOffset - a.rangeOffset,
        )) {
          if (change.rangeOffset > offset) continue;
          if (change.rangeOffset === offset && change.rangeLength > 0) continue;
          offset =
            Math.max(change.rangeOffset, offset - change.rangeLength) +
            change.text.length;
        }
        cursor.ref = {...cursor.ref, start: offset, end: offset};
        this.refreshAgentCursor(id);
        continue;
      }
      const deleted = agentChanges.some(
        change =>
          change.rangeLength > 0 &&
          !change.text &&
          change.rangeOffset <= cursor.ref!.start &&
          change.rangeOffset + change.rangeLength >= cursor.ref!.end,
      );
      cursor.ref = deleted
        ? undefined
        : rebaseSourceRef(cursor.ref, agentChanges, false);
      cursor.invalid = !cursor.ref;
      this.refreshAgentCursor(id);
    }
    for (const [key, sourceRef] of this.trackedSourceRefs) {
      if (sourceRef.file !== path) continue;
      const rebased = rebaseSourceRef(sourceRef, changes, origin === 'user');
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

  /** Promote an already compiled source only when an interaction needs a document. */
  private sourceDocument(path: string): ProjectDocument | undefined {
    const normalized = normalizeProjectPath(path);
    if (!this.documents.has(normalized)) {
      const source = this.navigationFiles.get(normalized);
      if (source !== undefined) this.addDocument(normalized, source);
    }
    return this.documents.get(normalized);
  }

  private requireDocument(path: string): ProjectDocument {
    const document = this.sourceDocument(path);
    if (!document)
      throw new Error(`Project file not found: ${normalizeProjectPath(path)}`);
    return document;
  }

  private emitChange(change: ProjectEditorChange): void {
    if (this.queuedChanges) {
      this.queuedChanges.push(change);
      return;
    }
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

  private emitEditorActivation(position = this.editor.getPosition()): void {
    const cursor = this.cursorAt(position);
    this.editorActivationListeners.forEach(listener => listener(cursor));
  }

  private async openProjectResource(
    resource: monaco.Uri,
    selectionOrPosition?: monaco.IRange | monaco.IPosition,
  ): Promise<boolean> {
    let target = [...this.documents.values()].find(
      document => document.model.uri.toString() === resource.toString(),
    );
    if (
      !target &&
      resource.scheme === 'file' &&
      resource.path.startsWith('/workspace/')
    ) {
      const path = resource.path.slice('/workspace'.length);
      try {
        await this.openFile(path, false);
      } catch {
        return false;
      }
      target = this.documents.get(path);
    }
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
    const cursor = this.cursorAt(position);
    if (cursor) this.cursorListeners.forEach(listener => listener(cursor));
  }

  private async formatFile(
    path: string,
    options: FormatOptions = {},
  ): Promise<boolean> {
    if (!this.isModelFile(path)) return false;
    const document = this.requireDocument(path);
    const {model} = document;
    const source = model.getValue();
    const version = model.getVersionId();
    const endOfLine = prettierEndOfLine(model);
    let cursorSelectionVersion =
      options.cursor?.selectionVersion ?? this.cursorSelectionVersion;
    let cursorOffset = options.cursor?.offset ?? this.activeCursorOffset(model);
    let result = await formatTypeScriptWithCursor(
      source,
      cursorOffset ?? 0,
      endOfLine,
    );
    while (model.getVersionId() === version) {
      if (result.formatted === source) return true;
      const currentCursorOffset = this.activeCursorOffset(model);
      if (
        currentCursorOffset !== undefined &&
        this.cursorSelectionVersion !== cursorSelectionVersion
      ) {
        cursorSelectionVersion = this.cursorSelectionVersion;
        if (currentCursorOffset !== cursorOffset) {
          cursorOffset = currentCursorOffset;
          result = await formatTypeScriptWithCursor(
            source,
            cursorOffset,
            endOfLine,
          );
          continue;
        }
      }
      this.withContentChangeOrigin(options.origin ?? 'user', () =>
        this.withSuppressedCursorEvents(() => {
          this.pushSourceEdits(
            path,
            formattingEdits(model, source, result.formatted),
            options.undoGroup,
          );
          if (cursorOffset !== undefined && this.editor.getModel() === model) {
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
    origin: 'user' | 'tool' | 'agent',
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
    if (isReadonlyProjectFile(path))
      throw new Error('This project file is read-only.');
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
    this.suppressCursorEventDepth += 1;
    try {
      action();
    } finally {
      this.suppressCursorEventDepth -= 1;
    }
  }
}

/** Preserve tracked ranges and undo positions by editing only formatting differences. */
function formattingEdits(
  model: monaco.editor.ITextModel,
  source: string,
  formatted: string,
): (monaco.editor.IIdentifiedSingleEditOperation & {text: string})[] {
  return minimalTextChanges(source, formatted).map(change => ({
    range: monaco.Range.fromPositions(
      model.getPositionAt(change.rangeOffset),
      model.getPositionAt(change.rangeOffset + change.rangeLength),
    ),
    text: change.text,
    forceMoveMarkers: true,
  }));
}

function minimalTextChanges(
  source: string,
  target: string,
): {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}[] {
  const changes: {rangeOffset: number; rangeLength: number; text: string}[] =
    [];
  let offset = 0;
  let pending: {start: number; end: number; text: string} | undefined;
  const flush = () => {
    if (!pending) return;
    const removed = source.slice(pending.start, pending.end);
    // Separate surrounding whitespace from token replacements in both directions,
    // e.g. ="value" <-> = 'value', keeping selected quotes inside their range.
    if (removed.trim() && pending.text.trim()) {
      const leading = /^\s*/.exec(removed)![0].length;
      const insertedLeading = /^\s*/.exec(pending.text)![0];
      if (leading || insertedLeading) {
        changes.push({
          rangeOffset: pending.start,
          rangeLength: leading,
          text: insertedLeading,
        });
        pending.start += leading;
        pending.text = pending.text.slice(insertedLeading.length);
      }
      const trailing = /\s*$/.exec(removed)![0].length;
      const insertedTrailing = /\s*$/.exec(pending.text)![0];
      if (trailing || insertedTrailing) {
        changes.push({
          rangeOffset: pending.end - trailing,
          rangeLength: trailing,
          text: insertedTrailing,
        });
        pending.end -= trailing;
        pending.text = pending.text.slice(
          0,
          pending.text.length - insertedTrailing.length,
        );
      }
    }
    changes.push({
      rangeOffset: pending.start,
      rangeLength: pending.end - pending.start,
      text: pending.text,
    });
    pending = undefined;
  };
  for (const change of diffChars(source, target)) {
    if (change.added || change.removed) {
      pending ??= {start: offset, end: offset, text: ''};
      if (change.added) pending.text += change.value;
      else pending.end = offset += change.value.length;
    } else {
      flush();
      offset += change.value.length;
    }
  }
  flush();
  return changes;
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
    severity:
      diagnostic.severity === 'warning'
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Error,
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

type DesignArgumentCompletionSite = Readonly<{
  annotation: Code3dAnnotation;
  context: DesignArgumentContext;
}>;

function designArgumentVirtualCall(
  source: string,
  site: DesignArgumentCompletionSite,
  cursorOffset: number,
): EmbeddedCodeProjection | undefined {
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
  return new EmbeddedCodeProjection(
    {start: annotation.valueStart + 1, text: argumentsSource},
    source + callPrefix,
    ');\n',
  );
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
  projection: EmbeddedCodeProjection,
  replacementSpan?: Readonly<{start: number; length: number}>,
): monaco.IRange {
  const span = replacementSpan && projection.toSourceSpan(replacementSpan);
  if (span) {
    return monaco.Range.fromPositions(
      model.getPositionAt(span.start),
      model.getPositionAt(span.start + span.length),
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
    if (annotation.value.length === 0) {
      continue;
    }

    const tokenLines = monaco.editor.tokenize(annotation.value, 'typescript');
    let lineStart = annotation.valueStart;
    annotation.value.split('\n').forEach((line, lineIndex) => {
      const tokens = tokenLines[lineIndex] ?? [];
      tokens.forEach((token, index) => {
        const nextOffset = tokens[index + 1]?.offset ?? line.length;
        const text = line.slice(token.offset, nextOffset);
        if (!text.trim()) return;
        decorations.push({
          range: sourceRange(model, {
            file: path,
            start:
              lineStart + token.offset + text.length - text.trimStart().length,
            end: lineStart + token.offset + text.trimEnd().length,
          }),
          options: annotationDecorationOptions(
            `code3d-annotation-value code3d-annotation-value-${annotationTokenKind(token.type)}`,
          ),
        });
      });
      lineStart += line.length + 1;
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
  if (/\.map$/i.test(path)) return 'json';
  if (isSourceFile(path))
    return /\.[cm]?jsx?$/i.test(path) ? 'javascript' : 'typescript';
  const filename = path.split('/').at(-1)!.toLowerCase();
  return (
    monaco.languages
      .getLanguages()
      .find(language =>
        language.filenames?.some(name => name.toLowerCase() === filename),
      )?.id ??
    monaco.languages
      .getLanguages()
      .find(language =>
        language.extensions?.some(extension =>
          filename.endsWith(extension.toLowerCase()),
        ),
      )?.id ??
    'plaintext'
  );
}

function prettierEndOfLine(model: monaco.editor.ITextModel): 'lf' | 'crlf' {
  return model.getEOL() === '\r\n' ? 'crlf' : 'lf';
}

async function formatTypeScript(
  source: string,
  endOfLine: 'lf' | 'crlf',
): Promise<string> {
  const {prettier, plugins} = await loadPrettier();
  return prettier.format(source, {
    ...modelPrettierOptions,
    plugins,
    endOfLine,
  });
}

async function formatTypeScriptWithCursor(
  source: string,
  cursorOffset: number,
  endOfLine: 'lf' | 'crlf',
) {
  const {prettier, plugins} = await loadPrettier();
  const options: CursorOptions = {
    ...modelPrettierOptions,
    plugins,
    cursorOffset,
    endOfLine,
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

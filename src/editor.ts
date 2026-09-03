import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/typescript/register';
import * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import type {CursorOptions, Options} from 'prettier';
import {authoringTypes, type SourceRef} from './model/runtime';
import {normalizeProjectPath, type ModelProject} from './project/project';
import type {SourceTextEdit} from './tools/tool-system';
import type {SourceEditExcerpt} from './ui/source-edit-popover';

type MonacoEnvironment = typeof self & {
  MonacoEnvironment: {
    getWorker(_moduleId: string, label: string): Worker;
  };
};

export type ProjectEditorChange =
  | Readonly<{kind: 'content'; path: string; source: string}>
  | Readonly<{kind: 'create'; path: string; source: string}>
  | Readonly<{kind: 'rename'; from: string; to: string}>
  | Readonly<{kind: 'delete'; path: string}>;

type ProjectDocument = {
  path: string;
  model: monaco.editor.ITextModel;
  viewState?: monaco.editor.ICodeEditorViewState | null;
  subscription: monaco.IDisposable;
};

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

(self as MonacoEnvironment).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'typescript' || label === 'javascript') {
      return new TypeScriptWorker();
    }
    return new EditorWorker();
  },
};

const languageCompilerOptions = {
  target: typeScriptLanguage.ScriptTarget.ESNext,
  module: typeScriptLanguage.ModuleKind.ESNext,
  moduleResolution: typeScriptLanguage.ModuleResolutionKind.NodeJs,
  allowNonTsExtensions: true,
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
typeScriptLanguage.typescriptDefaults.addExtraLib(
  authoringTypes,
  'file:///node_modules/code3d/index.d.ts',
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
    {token: 'comment', foreground: '6f756b'},
    {token: 'keyword', foreground: 'd8ff3e'},
    {token: 'string', foreground: 'e8bd76'},
    {token: 'number', foreground: '8ed5d1'},
    {token: 'type.identifier', foreground: 'aebcff'},
  ],
  colors: {
    'editor.background': '#11110f',
    'editor.foreground': '#e7e8df',
    'editorLineNumber.foreground': '#4e514a',
    'editorLineNumber.activeForeground': '#b9beaf',
    'editorCursor.foreground': '#d8ff3e',
    'editor.selectionBackground': '#53651566',
    'editor.inactiveSelectionBackground': '#53651533',
    'editor.lineHighlightBackground': '#1a1b17',
    'editorIndentGuide.background1': '#272923',
    'editorIndentGuide.activeBackground1': '#555a4e',
    'editorWidget.background': '#1a1b17',
    'editorHoverWidget.background': '#1a1b17',
    'editorSuggestWidget.background': '#1a1b17',
    'editorSuggestWidget.selectedBackground': '#303527',
  },
});

export class CodeEditor {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly documents = new Map<string, ProjectDocument>();
  private readonly openPaths: string[] = [];
  private readonly changeListeners = new Set<
    (change: ProjectEditorChange) => void
  >();
  private readonly cursorListeners = new Set<
    (source: Readonly<{file: string; offset: number}>) => void
  >();
  private readonly activeFileListeners = new Set<(path: string) => void>();
  private readonly sourceDecoration: monaco.editor.IEditorDecorationsCollection;
  private activePath: string;
  private revision = 1;
  private suppressCursorEvent = false;

  constructor(
    private readonly container: HTMLElement,
    private entryPath: string,
    project: ModelProject,
  ) {
    this.entryPath = normalizeProjectPath(entryPath);
    this.activePath = this.entryPath;
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
      suggest: {preview: true, showWords: false},
      quickSuggestions: {other: true, comments: false, strings: false},
      tabSize: 2,
    });
    this.sourceDecoration = this.editor.createDecorationsCollection();
    this.editor.onDidChangeCursorPosition(({position}) => {
      if (this.suppressCursorEvent) return;
      this.emitCursorPosition(position);
    });
    monaco.editor.registerEditorOpener({
      openCodeEditor: (source, resource, selectionOrPosition) =>
        source === this.editor &&
        this.openProjectResource(resource, selectionOrPosition),
    });
  }

  project(): ModelProject {
    return {
      entryPath: this.entryPath,
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
    this.activeFileListeners.forEach(listener => listener(normalized));
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
    if (sourcePath === this.entryPath) {
      throw new Error('The entry file cannot be renamed yet.');
    }
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
  }

  deleteFile(path: string): void {
    const normalized = normalizeProjectPath(path);
    if (normalized === this.entryPath) {
      throw new Error('The entry file cannot be deleted.');
    }
    const wasActive = normalized === this.activePath;
    const openIndex = this.openPaths.indexOf(normalized);
    if (wasActive) {
      const nextPath =
        this.openPaths.find(candidate => candidate !== normalized) ??
        this.entryPath;
      this.activePath = nextPath;
      this.withSuppressedCursorEvents(() => {
        this.sourceDecoration.clear();
        this.editor.setModel(this.requireDocument(nextPath).model);
      });
      this.activeFileListeners.forEach(listener => listener(nextPath));
    }
    this.removeDocument(normalized);
    if (openIndex >= 0) this.openPaths.splice(openIndex, 1);
    this.revision += 1;
    this.emitChange({kind: 'delete', path: normalized});
  }

  reset(project: ModelProject): void {
    this.sourceDecoration.clear();
    [...this.documents.keys()].forEach(path => this.removeDocument(path));
    this.openPaths.length = 0;
    this.entryPath = normalizeProjectPath(project.entryPath);
    this.activePath = this.entryPath;
    project.files.forEach(file => this.addDocument(file.path, file.source));
    this.openPaths.push(this.entryPath);
    this.editor.setModel(this.requireDocument(this.entryPath).model);
    this.revision += 1;
  }

  sourceVersion(): number {
    return this.revision;
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

  applySourceEdits(
    baseVersion: number,
    edits: readonly SourceTextEdit[],
  ): boolean {
    if (this.revision !== baseVersion || edits.length === 0) return false;
    const grouped = groupEditsByFile(edits);
    for (const [path, fileEdits] of grouped) {
      const model = this.documents.get(path)?.model;
      if (!model || !validEdits(model, fileEdits)) return false;
    }
    for (const [path, fileEdits] of grouped) {
      const model = this.requireDocument(path).model;
      model.pushStackElement();
      model.pushEditOperations(
        [],
        [...fileEdits]
          .sort((left, right) => right.sourceRef.start - left.sourceRef.start)
          .map(edit => ({
            range: sourceRange(model, edit.sourceRef),
            text: edit.text,
            forceMoveMarkers: true,
          })),
        () => null,
      );
      model.pushStackElement();
    }
    void Promise.all(
      [...grouped.keys()].map(path => this.formatFile(path)),
    ).catch(error =>
      console.error('Prettier failed after a code3d source edit.', error),
    );
    return true;
  }

  async format(): Promise<boolean> {
    return this.formatFile(this.activePath);
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

  onActiveFile(listener: (path: string) => void): () => void {
    this.activeFileListeners.add(listener);
    return () => this.activeFileListeners.delete(listener);
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

  private addDocument(path: string, source: string): void {
    const normalized = normalizeProjectPath(path);
    const model = monaco.editor.createModel(
      source,
      languageForPath(normalized),
      monaco.Uri.parse(`file:///workspace${normalized}`),
    );
    const document: ProjectDocument = {
      path: normalized,
      model,
      subscription: model.onDidChangeContent(() => {
        this.revision += 1;
        this.emitChange({
          kind: 'content',
          path: normalized,
          source: model.getValue(),
        });
      }),
    };
    this.documents.set(normalized, document);
  }

  private removeDocument(path: string): void {
    const document = this.requireDocument(path);
    document.subscription.dispose();
    document.model.dispose();
    this.documents.delete(path);
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

  private async formatFile(path: string): Promise<boolean> {
    const document = this.requireDocument(path);
    const {model} = document;
    const source = model.getValue();
    const version = model.getVersionId();
    const active = path === this.activePath;
    const position = active ? this.editor.getPosition() : null;
    const cursorOffset = position ? model.getOffsetAt(position) : 0;
    const result = await formatTypeScriptWithCursor(source, cursorOffset);
    if (model.getVersionId() !== version || result.formatted === source) {
      return model.getVersionId() === version;
    }
    this.withSuppressedCursorEvents(() => {
      model.pushStackElement();
      model.pushEditOperations(
        [],
        [
          {
            range: model.getFullModelRange(),
            text: result.formatted,
            forceMoveMarkers: true,
          },
        ],
        () => null,
      );
      if (active)
        this.editor.setPosition(model.getPositionAt(result.cursorOffset));
      model.pushStackElement();
    });
    return true;
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
      };
    });
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

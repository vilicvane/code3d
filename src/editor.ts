import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/typescript/register';
import * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TypeScriptWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import type {CursorOptions, Options} from 'prettier';
import {authoringTypes, type SourceRef} from './model/runtime';
import type {SourceTextEdit} from './tools/tool-system';
import type {SourceEditExcerpt} from './ui/source-edit-popover';

type MonacoEnvironment = typeof self & {
  MonacoEnvironment: {
    getWorker(_moduleId: string, label: string): Worker;
  };
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

typeScriptLanguage.typescriptDefaults.setCompilerOptions({
  target: typeScriptLanguage.ScriptTarget.ESNext,
  module: typeScriptLanguage.ModuleKind.ESNext,
  moduleResolution: typeScriptLanguage.ModuleResolutionKind.NodeJs,
  allowNonTsExtensions: true,
  strict: true,
  noEmit: true,
});
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
  private readonly model: monaco.editor.ITextModel;
  private readonly sourceDecoration: monaco.editor.IEditorDecorationsCollection;
  private suppressCursorEvent = false;

  constructor(container: HTMLElement, source: string) {
    this.model = monaco.editor.createModel(
      source,
      'typescript',
      monaco.Uri.parse('file:///workspace/model.ts'),
    );
    this.editor = monaco.editor.create(container, {
      model: this.model,
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
  }

  getValue(): string {
    return this.model.getValue();
  }

  setValue(source: string): void {
    this.model.setValue(source);
  }

  sourceVersion(): number {
    return this.model.getVersionId();
  }

  cursorOffset(): number | undefined {
    const position = this.editor.getPosition();
    return position ? this.model.getOffsetAt(position) : undefined;
  }

  readSource(sourceRef: SourceRef): string {
    const start = this.model.getPositionAt(sourceRef.start);
    const end = this.model.getPositionAt(sourceRef.end);
    const range = new monaco.Range(
      start.lineNumber,
      start.column,
      end.lineNumber,
      end.column,
    );
    return this.model.getValueInRange(range);
  }

  applySourceEdits(
    baseVersion: number,
    edits: readonly SourceTextEdit[],
  ): boolean {
    if (this.model.getVersionId() !== baseVersion || edits.length === 0) {
      return false;
    }
    const ordered = [...edits].sort(
      (left, right) => left.sourceRef.start - right.sourceRef.start,
    );
    if (
      ordered.some(
        (edit, index) =>
          index > 0 && ordered[index - 1].sourceRef.end > edit.sourceRef.start,
      )
    ) {
      return false;
    }

    const operations = ordered.map(edit => {
      const start = this.model.getPositionAt(edit.sourceRef.start);
      const end = this.model.getPositionAt(edit.sourceRef.end);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      );
      return {edit, range};
    });
    if (
      operations.some(
        ({edit, range}) =>
          this.model.getValueInRange(range) !== edit.expectedText,
      )
    ) {
      return false;
    }

    this.withSuppressedCursorEvents(() => {
      this.editor.pushUndoStop();
      this.editor.executeEdits(
        'code3d.tool',
        operations.map(({edit, range}) => ({
          range,
          text: edit.text,
          forceMoveMarkers: true,
        })),
      );
      this.editor.pushUndoStop();
    });
    void this.format().catch(error => {
      console.error('Prettier failed after a code3d source edit.', error);
    });
    return true;
  }

  async format(): Promise<boolean> {
    const source = this.model.getValue();
    const version = this.model.getVersionId();
    const position = this.editor.getPosition();
    const cursorOffset = position ? this.model.getOffsetAt(position) : 0;
    const result = await formatTypeScriptWithCursor(source, cursorOffset);
    if (this.model.getVersionId() !== version) {
      return false;
    }
    if (result.formatted === source) {
      return true;
    }

    this.withSuppressedCursorEvents(() => {
      this.editor.pushUndoStop();
      this.editor.executeEdits('code3d.prettier', [
        {
          range: this.model.getFullModelRange(),
          text: result.formatted,
          forceMoveMarkers: true,
        },
      ]);
      this.editor.setPosition(this.model.getPositionAt(result.cursorOffset));
      this.editor.pushUndoStop();
    });
    return true;
  }

  sourceEditExcerpts(edits: readonly SourceTextEdit[]): SourceEditExcerpt[] {
    return sourceEditExcerpts(this.model.getValue(), edits);
  }

  onChange(listener: () => void): monaco.IDisposable {
    return this.model.onDidChangeContent(listener);
  }

  onCursorOffset(listener: (offset: number) => void): monaco.IDisposable {
    return this.editor.onDidChangeCursorPosition(({position}) => {
      if (!this.suppressCursorEvent) {
        listener(this.model.getOffsetAt(position));
      }
    });
  }

  revealSource(sourceRef: SourceRef, takeFocus = false): void {
    const start = this.model.getPositionAt(sourceRef.start);
    const end = this.model.getPositionAt(sourceRef.end);
    const range = new monaco.Range(
      start.lineNumber,
      start.column,
      end.lineNumber,
      end.column,
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
      this.editor.setSelection(range);
      this.editor.revealRangeInCenterIfOutsideViewport(range);
      if (takeFocus) {
        this.editor.focus();
      }
    });
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

  clearSourceHighlight(): void {
    this.sourceDecoration.clear();
  }
}

function sourceEditExcerpts(
  source: string,
  edits: readonly SourceTextEdit[],
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
        lineNumber,
        source: rawSource.slice(contentStart, contentEnd),
        changedStart: start - lineStart - contentStart,
        changedEnd: end - lineStart - contentStart,
      };
    });
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

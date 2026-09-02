import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/typescript/register";
import * as typeScriptLanguage from "monaco-editor/languages/features/typescript/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { authoringTypes, type SourceRef } from "./model/runtime";
import type { SourceTextEdit } from "./tools/tool-system";

type MonacoEnvironment = typeof self & {
  MonacoEnvironment: {
    getWorker(_moduleId: string, label: string): Worker;
  };
};

(self as MonacoEnvironment).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "typescript" || label === "javascript") {
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
  "file:///node_modules/code3d/index.d.ts",
);

monaco.editor.defineTheme("code3d-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6f756b" },
    { token: "keyword", foreground: "d8ff3e" },
    { token: "string", foreground: "e8bd76" },
    { token: "number", foreground: "8ed5d1" },
    { token: "type.identifier", foreground: "aebcff" },
  ],
  colors: {
    "editor.background": "#11110f",
    "editor.foreground": "#e7e8df",
    "editorLineNumber.foreground": "#4e514a",
    "editorLineNumber.activeForeground": "#b9beaf",
    "editorCursor.foreground": "#d8ff3e",
    "editor.selectionBackground": "#53651566",
    "editor.inactiveSelectionBackground": "#53651533",
    "editor.lineHighlightBackground": "#1a1b17",
    "editorIndentGuide.background1": "#272923",
    "editorIndentGuide.activeBackground1": "#555a4e",
    "editorWidget.background": "#1a1b17",
    "editorHoverWidget.background": "#1a1b17",
    "editorSuggestWidget.background": "#1a1b17",
    "editorSuggestWidget.selectedBackground": "#303527",
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
      "typescript",
      monaco.Uri.parse("file:///workspace/model.ts"),
    );
    this.editor = monaco.editor.create(container, {
      model: this.model,
      theme: "code3d-dark",
      automaticLayout: true,
      fontFamily: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: 13,
      lineHeight: 22,
      fontLigatures: true,
      minimap: { enabled: false },
      padding: { top: 18, bottom: 18 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorSmoothCaretAnimation: "on",
      renderLineHighlight: "line",
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      suggest: { preview: true, showWords: false },
      quickSuggestions: { other: true, comments: false, strings: false },
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

    const operations = ordered.map((edit) => {
      const start = this.model.getPositionAt(edit.sourceRef.start);
      const end = this.model.getPositionAt(edit.sourceRef.end);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        end.lineNumber,
        end.column,
      );
      return { edit, range };
    });
    if (
      operations.some(
        ({ edit, range }) => this.model.getValueInRange(range) !== edit.expectedText,
      )
    ) {
      return false;
    }

    this.editor.pushUndoStop();
    this.editor.executeEdits(
      "code3d.tool",
      operations.map(({ edit, range }) => ({
        range,
        text: edit.text,
        forceMoveMarkers: true,
      })),
    );
    this.editor.pushUndoStop();
    return true;
  }

  onChange(listener: () => void): monaco.IDisposable {
    return this.model.onDidChangeContent(listener);
  }

  onCursorOffset(listener: (offset: number) => void): monaco.IDisposable {
    return this.editor.onDidChangeCursorPosition(({ position }) => {
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

    this.suppressCursorEvent = true;
    this.sourceDecoration.set([
      {
        range,
        options: {
          className: "code3d-source-selection",
          inlineClassName: "code3d-source-selection-inline",
          overviewRuler: {
            color: "#d8ff3e88",
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
    queueMicrotask(() => {
      this.suppressCursorEvent = false;
    });
  }

  clearSourceHighlight(): void {
    this.sourceDecoration.clear();
  }
}

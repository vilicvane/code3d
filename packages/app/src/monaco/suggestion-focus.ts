import * as monaco from 'monaco-editor/editor';

type SuggestionItem = Readonly<{
  completion: monaco.languages.CompletionItem;
  position: monaco.IPosition;
  editStart: monaco.IPosition;
  editInsertEnd: monaco.IPosition;
  editReplaceEnd: monaco.IPosition;
}>;

export type FocusedSuggestion = Readonly<{
  completion: monaco.languages.CompletionItem;
  requestedPosition: monaco.IPosition;
  editStart: monaco.IPosition;
  editInsertEnd: monaco.IPosition;
  editReplaceEnd: monaco.IPosition;
}>;

type SuggestionWidget = Readonly<{
  onDidFocus(
    listener: (event: Readonly<{item: SuggestionItem}>) => void,
  ): monaco.IDisposable;
}>;

type SuggestionController = Readonly<{
  widget: Readonly<{value: SuggestionWidget}>;
  model: Readonly<{
    onDidCancel(
      listener: (event: Readonly<{retrigger: boolean}>) => void,
    ): monaco.IDisposable;
  }>;
}>;

/**
 * Monaco exposes completion providers publicly, but not the focused item in its
 * suggest widget. Keep the single version-coupled bridge at this boundary.
 */
export function observeSuggestionFocus(
  editor: monaco.editor.IStandaloneCodeEditor,
  listener: (item: FocusedSuggestion | undefined) => void,
): monaco.IDisposable {
  const controller = editor.getContribution(
    'editor.contrib.suggestController',
  ) as unknown as SuggestionController;
  const focus = controller.widget.value.onDidFocus(({item}) =>
    listener({
      completion: item.completion,
      requestedPosition: item.position,
      editStart: item.editStart,
      editInsertEnd: item.editInsertEnd,
      editReplaceEnd: item.editReplaceEnd,
    }),
  );
  const cancel = controller.model.onDidCancel(({retrigger}) => {
    if (!retrigger) listener(undefined);
  });
  const modelChange = editor.onDidChangeModel(() => listener(undefined));
  return {
    dispose() {
      focus.dispose();
      cancel.dispose();
      modelChange.dispose();
    },
  };
}

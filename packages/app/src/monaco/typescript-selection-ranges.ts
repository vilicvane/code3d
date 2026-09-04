import * as monaco from 'monaco-editor/editor';
import type {TypeScriptSelectionRange} from './typescript-protocol';
import {projectTypeScriptWorker} from './typescript-worker-client';

export function registerProjectTypeScriptSelectionRanges(
  selector: monaco.languages.LanguageSelector,
): monaco.IDisposable {
  return monaco.languages.registerSelectionRangeProvider(selector, {
    async provideSelectionRanges(model, positions, token) {
      const offsets = positions.map(position => model.getOffsetAt(position));
      const worker = await projectTypeScriptWorker(
        model.getLanguageId(),
        model.uri,
      );
      if (token.isCancellationRequested || model.isDisposed()) return undefined;
      const selections = await worker.getProjectSelectionRanges(
        model.uri.toString(),
        offsets,
      );
      if (token.isCancellationRequested || model.isDisposed()) return undefined;
      return selections.map(selection => selectionRangeChain(model, selection));
    },
  });
}

function selectionRangeChain(
  model: monaco.editor.ITextModel,
  selection: TypeScriptSelectionRange,
): monaco.languages.SelectionRange[] {
  const ranges: monaco.languages.SelectionRange[] = [];
  for (
    let current: TypeScriptSelectionRange | undefined = selection;
    current;
    current = current.parent
  ) {
    ranges.push({
      range: monaco.Range.fromPositions(
        model.getPositionAt(current.textSpan.start),
        model.getPositionAt(current.textSpan.start + current.textSpan.length),
      ),
    });
  }
  return ranges;
}

import * as monaco from 'monaco-editor/editor';
import * as typeScriptLanguage from 'monaco-editor/languages/features/typescript/register';
import type {
  TypeScriptCompletionEntry,
  TypeScriptCompletionEntryDetails,
} from './typescript-protocol';
import {projectTypeScriptWorker} from './typescript-worker-client';

type ProjectCompletionItem = monaco.languages.CompletionItem &
  Readonly<{
    uri?: monaco.Uri;
    offset?: number;
    entry?: TypeScriptCompletionEntry;
  }>;

type ModuleSpecifierSite = Readonly<{
  range: monaco.Range;
}>;

export function registerProjectTypeScriptCompletions(
  selector: monaco.languages.LanguageSelector,
  packageSpecifiers: () => readonly string[],
): monaco.IDisposable {
  disableBuiltInCompletions(typeScriptLanguage.typescriptDefaults);
  disableBuiltInCompletions(typeScriptLanguage.javascriptDefaults);

  return monaco.languages.registerCompletionItemProvider(selector, {
    triggerCharacters: ['.', "'", '"', '/', '@'],
    async provideCompletionItems(model, position, _context, token) {
      const uri = model.uri;
      const offset = model.getOffsetAt(position);
      const worker = await projectTypeScriptWorker(model.getLanguageId(), uri);
      if (token.isCancellationRequested || model.isDisposed()) return undefined;
      const info = await worker.getProjectCompletions(uri.toString(), offset);
      if (token.isCancellationRequested || model.isDisposed()) return undefined;

      const suggestions: ProjectCompletionItem[] = (info?.entries ?? []).map(
        entry => ({
          uri,
          offset,
          entry,
          label: completionLabel(entry),
          kind: typeScriptCompletionItemKind(entry.kind),
          detail: entry.kind,
          insertText: entry.insertText ?? entry.name,
          insertTextRules: entry.isSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          filterText: entry.filterText,
          sortText: entry.sortText,
          commitCharacters: entry.commitCharacters,
          tags: entry.kindModifiers?.includes('deprecated')
            ? [monaco.languages.CompletionItemTag.Deprecated]
            : undefined,
          range: completionRange(model, position, entry.replacementSpan),
        }),
      );

      const moduleSite = moduleSpecifierSite(model, position);
      if (moduleSite) {
        const existing = new Set(
          suggestions.map(suggestion => completionItemLabel(suggestion.label)),
        );
        for (const specifier of packageSpecifiers()) {
          if (existing.has(specifier)) continue;
          suggestions.push({
            label: specifier,
            kind: monaco.languages.CompletionItemKind.Module,
            detail: 'project dependency',
            insertText: specifier,
            filterText: specifier,
            sortText: `0-${specifier}`,
            range: moduleSite.range,
          });
        }
      }

      return {
        suggestions,
        incomplete: info?.isIncomplete,
      };
    },
    async resolveCompletionItem(item, token) {
      const completion = item as ProjectCompletionItem;
      if (
        !completion.entry ||
        !completion.uri ||
        completion.offset === undefined
      ) {
        return item;
      }
      const worker = await projectTypeScriptWorker(
        completion.uri.path.endsWith('.js') ||
          completion.uri.path.endsWith('.jsx')
          ? 'javascript'
          : 'typescript',
        completion.uri,
      );
      if (token.isCancellationRequested) return item;
      const details = await worker.getProjectCompletionDetails(
        completion.uri.toString(),
        completion.offset,
        completion.entry.name,
        completion.entry.source,
        completion.entry.data,
      );
      if (token.isCancellationRequested || !details) return item;
      return {
        ...item,
        label: completionLabel(completion.entry, details),
        kind: typeScriptCompletionItemKind(details.kind),
        detail: displayParts(details.displayParts),
        documentation: completionDocumentation(details),
        additionalTextEdits: completionAdditionalTextEdits(
          completion.uri,
          details,
        ),
      };
    },
  });
}

export function typeScriptCompletionItemKind(
  kind: string,
): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'keyword':
    case 'primitive type':
      return monaco.languages.CompletionItemKind.Keyword;
    case 'const':
    case 'let':
    case 'var':
    case 'local var':
      return monaco.languages.CompletionItemKind.Variable;
    case 'method':
    case 'function':
    case 'construct':
    case 'call':
    case 'index':
      return monaco.languages.CompletionItemKind.Function;
    case 'class':
      return monaco.languages.CompletionItemKind.Class;
    case 'interface':
      return monaco.languages.CompletionItemKind.Interface;
    case 'module':
      return monaco.languages.CompletionItemKind.Module;
    case 'enum':
      return monaco.languages.CompletionItemKind.Enum;
    default:
      return monaco.languages.CompletionItemKind.Property;
  }
}

function disableBuiltInCompletions(
  defaults: typeScriptLanguage.LanguageServiceDefaults,
): void {
  defaults.setModeConfiguration({
    ...defaults.modeConfiguration,
    completionItems: false,
  });
}

function completionRange(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  replacementSpan?: Readonly<{start: number; length: number}>,
): monaco.Range {
  if (replacementSpan) {
    return monaco.Range.fromPositions(
      model.getPositionAt(replacementSpan.start),
      model.getPositionAt(replacementSpan.start + replacementSpan.length),
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

function completionLabel(
  entry: TypeScriptCompletionEntry,
  details?: TypeScriptCompletionEntryDetails,
): monaco.languages.CompletionItemLabel {
  const description =
    displayParts(entry.sourceDisplay) || displayParts(details?.sourceDisplay);
  if (
    !entry.labelDetails?.detail &&
    !entry.labelDetails?.description &&
    !description
  ) {
    return {label: entry.name};
  }
  return {
    label: entry.name,
    detail: entry.labelDetails?.detail,
    description: entry.labelDetails?.description ?? description,
  };
}

function moduleSpecifierSite(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): ModuleSpecifierSite | undefined {
  const line = model.getLineContent(position.lineNumber);
  const cursor = position.column - 1;
  const openQuote = lastUnescapedQuote(line, cursor);
  if (openQuote === -1) return undefined;
  const prefix = line.slice(0, openQuote);
  if (
    !/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)$/.test(
      prefix,
    )
  ) {
    return undefined;
  }
  const quote = line[openQuote];
  const closeQuote = nextUnescapedQuote(line, cursor, quote);
  return {
    range: new monaco.Range(
      position.lineNumber,
      openQuote + 2,
      position.lineNumber,
      closeQuote === -1 ? position.column : closeQuote + 1,
    ),
  };
}

function lastUnescapedQuote(source: string, end: number): number {
  for (let index = end - 1; index >= 0; index -= 1) {
    if (
      (source[index] === "'" || source[index] === '"') &&
      !isEscaped(source, index)
    ) {
      return index;
    }
  }
  return -1;
}

function nextUnescapedQuote(
  source: string,
  start: number,
  quote: string,
): number {
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === quote && !isEscaped(source, index)) return index;
  }
  return -1;
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === '\\';
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function completionAdditionalTextEdits(
  uri: monaco.Uri,
  details: TypeScriptCompletionEntryDetails,
): monaco.languages.TextEdit[] | undefined {
  const changes = details.codeActions?.flatMap(action => action.changes);
  if (!changes || changes.some(change => !sameResource(change.fileName, uri))) {
    return undefined;
  }
  const edits = changes.flatMap(change =>
    change.textChanges.map(textChange => ({
      range: monaco.Range.fromPositions(
        monacoPosition(uri, textChange.span.start),
        monacoPosition(uri, textChange.span.start + textChange.span.length),
      ),
      text: textChange.newText,
    })),
  );
  return edits && edits.length > 0 ? edits : undefined;
}

function monacoPosition(uri: monaco.Uri, offset: number): monaco.Position {
  const model = monaco.editor.getModel(uri);
  if (!model) throw new Error(`Completion model not found: ${uri.toString()}`);
  return model.getPositionAt(offset);
}

function sameResource(fileName: string, uri: monaco.Uri): boolean {
  return monaco.Uri.parse(fileName).toString() === uri.toString();
}

function completionDocumentation(
  details: TypeScriptCompletionEntryDetails,
): monaco.IMarkdownString | undefined {
  let value = displayParts(details.documentation);
  for (const tag of details.tags ?? []) {
    const tagText = Array.isArray(tag.text)
      ? tag.text.map(part => part.text).join('')
      : tag.text;
    value += `${value ? '\n\n' : ''}*@${tag.name}*${tagText ? ` — ${tagText}` : ''}`;
  }
  return value ? {value} : undefined;
}

function displayParts(
  parts: readonly Readonly<{text: string}>[] | undefined,
): string {
  return parts?.map(part => part.text).join('') ?? '';
}

function completionItemLabel(
  label: monaco.languages.CompletionItem['label'],
): string {
  return typeof label === 'string' ? label : label.label;
}

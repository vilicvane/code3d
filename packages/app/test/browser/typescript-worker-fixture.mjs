import * as monaco from 'monaco-editor/editor';
import * as language from 'monaco-editor/languages/features/typescript/register';

export async function inspectWorkerFiles() {
  const declarationFile =
    'file:///workspace/node_modules/@code3d/core/bld/library/runtime.d.ts';
  const declaration =
    monaco.editor.getModel(monaco.Uri.parse(declarationFile)) ??
    monaco.editor.createModel(
      language.typescriptDefaults.getExtraLibs()[declarationFile].content,
      'typescript',
      monaco.Uri.parse(declarationFile),
    );
  const source = [
    "import {box} from '@code3d/core';",
    "/** @code3d.param radius {kind: 'length'} */",
    'export function sleeve(radius: number) {return box(radius, 10, 10);}',
    'const part = sleeve(5);',
    'part;',
  ].join('\n');
  const model = monaco.editor.createModel(
    source,
    'typescript',
    monaco.Uri.file('/workspace/@examples/尺寸 box.ts'),
  );
  const worker = await (
    await language.getTypeScriptWorker()
  )(declaration.uri, model.uri);
  const declarationUri = declaration.uri.toString();
  const modelUri = model.uri.toString();
  const diagnostics = await Promise.all([
    worker.getSyntacticDiagnostics(declarationUri),
    worker.getSemanticDiagnostics(declarationUri),
    worker.getSuggestionDiagnostics(declarationUri),
    worker.getSyntacticDiagnostics(modelUri),
    worker.getSemanticDiagnostics(modelUri),
  ]);
  const partOffset = source.lastIndexOf('part') + 2;
  const result = {
    declarationFile,
    declarationUri,
    diagnostics,
    files: await worker.getScriptFileNames(),
    navigation: await worker.getNavigationTree(declarationUri),
    selection: await worker.getProjectSelectionRanges(modelUri, [
      source.indexOf('length') + 2,
    ]),
    completions: await worker.getProjectCompletions(
      modelUri,
      source.indexOf('length') + 2,
    ),
    highlights: await worker.getDocumentHighlights(modelUri, partOffset, [
      modelUri,
    ]),
    definition: await worker.getDefinitionAtPosition(
      modelUri,
      source.lastIndexOf('box(') + 2,
    ),
  };
  model.dispose();
  return result;
}

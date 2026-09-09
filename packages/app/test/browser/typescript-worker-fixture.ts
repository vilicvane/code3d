import type {ProjectTypeScriptWorker} from '../../src/monaco/typescript-protocol.ts';
import * as monaco from 'monaco-editor/editor';
import * as language from 'monaco-editor/languages/features/typescript/register';

export async function inspectWorkerFiles() {
  const declarationFile =
    '/workspace/node_modules/@code3d/core/bld/library/runtime.d.ts';
  const declarationResource = monaco.Uri.file(declarationFile);
  const declaration =
    monaco.editor.getModel(declarationResource) ??
    monaco.editor.createModel(
      language.typescriptDefaults.getExtraLibs()[declarationResource.toString()]
        .content,
      'typescript',
      declarationResource,
    );
  const source = [
    "import {box} from '@code3d/core';",
    "import {count} from './part%40.js';",
    "/** @code3d.param radius {kind: 'length'} */",
    'export function sleeve(radius: number) {return box(radius, 10, 10);}',
    'const part = sleeve(count);',
    'part;',
  ].join('\n');
  const model = monaco.editor.createModel(
    source,
    'typescript',
    monaco.Uri.file('/workspace/@examples/尺寸 %23 box.ts'),
  );
  const dependency = monaco.editor.createModel(
    'export const count = 5;',
    'typescript',
    monaco.Uri.file('/workspace/@examples/part%40.ts'),
  );
  const worker = (await (
    await language.getTypeScriptWorker()
  )(declaration.uri, model.uri, dependency.uri)) as ProjectTypeScriptWorker & {
    getScriptFileNames(): Promise<string[]>;
  };
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
    modelUri,
    dependencyUri: dependency.uri.toString(),
    diagnostics,
    files: await worker.getScriptFileNames(),
    navigation: (await worker.getNavigationTree(
      declarationUri,
    )) as import('@typescript/typescript6').NavigationTree,
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
    dependencyDefinition: await worker.getDefinitionAtPosition(
      modelUri,
      source.lastIndexOf('count') + 2,
    ),
  };
  model.dispose();
  dependency.dispose();
  return result;
}

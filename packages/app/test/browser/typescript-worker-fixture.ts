import type {ProjectTypeScriptWorker} from '../../src/monaco/typescript-protocol.ts';
import * as monaco from 'monaco-editor/editor';
import * as language from 'monaco-editor/languages/features/typescript/register';

export function mainEditor() {
  return monaco.editor
    .getEditors()
    .find(editor => editor.getDomNode()?.closest('#editor-host'))!;
}

export async function inspectIdentifierTokens() {
  const names = [
    '宽度',
    'box宽度2',
    'const宽度',
    'Box宽度',
    '$宽度',
    '_宽度',
    'café',
    'e\u0301',
    '𠮷野',
    'a\u200cb',
    'a\u200db',
  ];
  const source = names.map(name => `const ${name} = 1;`).join('\n');
  const samples = [
    ...names,
    '#宽度',
    'const',
    'interface',
    '10.5',
    '0xff',
    '// 中文注释',
    '"中文字符串"',
    '`尺寸${box宽度2}`',
    '/宽度+/u',
    '💥',
    '\u0301',
  ];
  const results = [];
  for (const languageId of ['typescript', 'javascript']) {
    await monaco.editor.colorize(source, languageId, {});
    const model = monaco.editor.createModel(
      source,
      languageId,
      monaco.Uri.file(
        `/workspace/unicode.${languageId === 'typescript' ? 'ts' : 'js'}`,
      ),
    );
    try {
      const factory = await (languageId === 'typescript'
        ? language.getTypeScriptWorker()
        : language.getJavaScriptWorker());
      const worker = await factory(model.uri);
      const uri = model.uri.toString();
      results.push({
        languageId,
        tokens: Object.fromEntries(
          samples.map(sample => [
            sample,
            monaco.editor.tokenize(sample, languageId)[0].map(token => ({
              offset: token.offset,
              type: token.type.replace(/\.(ts|js)$/, ''),
            })),
          ]),
        ),
        diagnostics: [
          ...(await worker.getSyntacticDiagnostics(uri)),
          ...(await worker.getSemanticDiagnostics(uri)),
        ],
      });
    } finally {
      model.dispose();
    }
  }
  return {names, results};
}

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

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
  const worker = (await (
    await language.getTypeScriptWorker()
  )(declaration.uri, model.uri)) as ProjectTypeScriptWorker & {
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
  };
  model.dispose();
  return result;
}

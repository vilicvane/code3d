import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import ts from '@typescript/typescript6';
import {createAppTestServer} from './vite-test-server.mjs';

let server;
let annotations;
let annotationNames;
let diagnostics;
let readParameters;
let languageService;
let nativeLanguageService;
let EmbeddedCodeProjection;
let files;
let version = 0;
const preferences = {
  quotePreference: 'single',
  includeCompletionsWithInsertText: true,
};

before(async () => {
  server = await createAppTestServer();
  ({code3dAnnotations: annotations, code3dAnnotationNames: annotationNames} =
    await server.ssrLoadModule('/src/model/annotations.ts'));
  const shared = await server.ssrLoadModule(
    '/src/model/tool-parameter-annotations.ts',
  );
  diagnostics = file =>
    shared.parameterAnnotationDiagnostics(
      file,
      programFor(file).getTypeChecker(),
    );
  readParameters = declaration => {
    const checker = programFor(declaration.getSourceFile()).getTypeChecker();
    return shared.readToolParameterAnnotations(
      declaration,
      shared.signatureParameters(
        checker.getSignatureFromDeclaration(declaration),
        checker,
        declaration,
      ),
    );
  };
  const {AnnotationLanguageService} = await server.ssrLoadModule(
    '/src/monaco/annotation-language-service.ts',
  );
  ({EmbeddedCodeProjection} = await server.ssrLoadModule(
    '/src/monaco/embedded-code.ts',
  ));
  const {injectedPackageFiles} = await server.ssrLoadModule(
    '/src/monaco/injected-packages.ts',
  );
  files = new Map(
    injectedPackageFiles.map(file => [file.filePath, file.content]),
  );
  const readFile = name => files.get(name) ?? ts.sys.readFile(name);
  const host = {
    getCompilationSettings: () => ({
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }),
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: () => String(version),
    getScriptSnapshot: name => {
      const source = readFile(name);
      return source === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(source);
    },
    getCurrentDirectory: () => '',
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: name => readFile(name) !== undefined,
    readFile,
  };
  languageService = new AnnotationLanguageService(host);
  nativeLanguageService = ts.createLanguageService(host);
});

after(async () => {
  await server?.close();
});

function sourceFile(source) {
  return ts.createSourceFile(
    'file:///workspace/model.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
}

function programFor(file) {
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (name, ...args) =>
    name === file.fileName ? file : getSourceFile(name, ...args);
  return ts.createProgram([file.fileName], {}, host);
}

function declaration(value, parameters = 'width: number, edges?: number[]') {
  return `/** @code3d.param ${value} */\nfunction model(${parameters}) {return width;}`;
}

function complete(marked) {
  const result = markedSource(marked);
  return {
    ...result,
    info: languageService.completions(
      result.file,
      result.position,
      preferences,
    ),
  };
}

function markedSource(marked) {
  const position = marked.indexOf('|');
  assert.notEqual(position, -1);
  const source = marked.replace('|', '');
  files.set('file:///workspace/model.ts', source);
  version += 1;
  const file = languageService.sourceFile('file:///workspace/model.ts');
  return {
    source,
    position,
    file,
  };
}

function selectionSpans(selection) {
  const result = [];
  for (let current = selection; current; current = current.parent)
    result.push(current.textSpan);
  return result;
}

function select(marked) {
  const result = markedSource(marked);
  const outer = nativeLanguageService.getSmartSelectionRange(
    result.file.fileName,
    result.position,
  );
  const selection = languageService.selectionRange(
    result.file,
    result.position,
    outer,
  );
  const spans = selectionSpans(selection);
  for (const [index, span] of spans.entries()) {
    assert.ok(
      span.start >= 0 && span.start + span.length <= result.source.length,
    );
    assert.ok(
      span.start <= result.position &&
        result.position <= span.start + span.length,
    );
    if (index) {
      const inner = spans[index - 1];
      assert.ok(
        span.start <= inner.start &&
          span.start + span.length >= inner.start + inner.length,
      );
      assert.notDeepEqual(span, inner);
    }
  }
  return {
    ...result,
    outer,
    selection,
    spans,
    texts: spans.map(span =>
      result.source.slice(span.start, span.start + span.length),
    ),
  };
}

function names(result) {
  return result.info?.entries.map(entry => entry.name).sort();
}

test('reads real JSDoc only and keeps multiline offsets in the original source', () => {
  const source = [
    'const text = "/** @code3d.param fake {} */";',
    '// @code3d.param fake {}',
    '/** 🌍',
    ' * @code3d.param width {',
    " *   kind: 'length',",
    ' *   constraints: {min: 1}',
    ' * }',
    ' * @code3d.arguments [10]',
    ' * @returns a model',
    ' */',
    'function model(width: number) {return width;}',
  ].join('\r\n');
  const result = annotations(source);
  assert.deepEqual(
    result.map(annotation => annotation.name),
    ['param', 'arguments'],
  );
  const param = result[0];
  assert.equal(param.value.length, param.valueEnd - param.valueStart);
  assert.equal(
    param.valueStart + param.value.indexOf('constraints'),
    source.indexOf('constraints'),
  );
  assert.equal(result[1].value, '[10]');
  assert.deepEqual(diagnostics(sourceFile(source)), []);
});

test('recognizes only param and arguments, leaving former variable tags as ordinary comments', () => {
  assert.deepEqual([...annotationNames], ['arguments', 'param']);
  const source = [
    '/**',
    ' * @code3d.label Custom width',
    ' * @code3d.description Width metadata',
    ' * @code3d.kind length',
    ' * @code3d.unit mm',
    ' * @code3d.min 10',
    ' * @code3d.max 100',
    ' * @code3d.step 1',
    ' */',
    'const width = 40;',
    '/**',
    " * @code3d.param size {kind: 'length'}",
    ' * @code3d.arguments [width]',
    ' */',
    'function model(size: number) {}',
  ].join('\n');
  assert.deepEqual(
    annotations(source).map(annotation => annotation.name),
    ['param', 'arguments'],
  );
  assert.deepEqual(diagnostics(sourceFile(source)), []);
  const result = select(source.replace('Custom width', 'Custom wi|dth'));
  assert.deepEqual(result.selection, result.outer);
});

test('validates unused functions, methods and overloads independently', () => {
  const source = [
    declaration("width {kind: 'length', constraints: {exclusiveMin: 0}}"),
    'interface Shape {',
    "/** @code3d.param ids {kind: 'edge', actions: [{action: 'remove-argument', label: 'Use all'}]} */",
    'edges(ids?: number[]): void;',
    '}',
    "/** @code3d.param size {kind: 'length'} */",
    'function item(size: number): number;',
    "/** @code3d.param size {kind: 'scalar'} */",
    'function item(size: number) {return size;}',
  ].join('\n');
  assert.deepEqual(diagnostics(sourceFile(source)), []);
  const invalid = declaration("missing {kind: 'length'}");
  const [issue] = diagnostics(sourceFile(invalid));
  assert.match(issue.messageText, /unknown parameter: missing/);
  assert.equal(
    invalid.slice(issue.start, issue.start + issue.length),
    'missing',
  );
});

test('uses the same static configuration validation for editing and compilation', () => {
  const invalid = [
    "width {kind: 'unknown'}",
    "width {kind: 'length', label: 2}",
    "width {kind: 'edge', constraints: {min: 0}}",
    "width {kind: 'length', constraints: {min: 'zero'}}",
    "width {kind: 'length', constraints: {min: 1e999}}",
    "width {kind: 'length', constraints: {step: 1}}",
    "width {kind: 'length', extra: 1}",
    "width {kind: 'edge', actions: [{action: 'other', label: 'Go'}]}",
    "width {kind: 'edge', actions: [{action: 'remove-argument', label: ''}]}",
    "width {kind: 'length', label: getLabel()}",
    "width {kind: 'length', ...options}",
    "width {kind: 'length', ['label']: 'Width'}",
    "width {kind: 'length', kind: 'angle'}",
    "width {kind: 'length'",
  ];
  for (const value of invalid) {
    const file = sourceFile(declaration(value));
    const [issue] = diagnostics(file);
    assert.ok(issue, value);
    assert.ok(issue.start >= file.text.indexOf(value));
    assert.ok(issue.start + issue.length <= file.text.indexOf('*/'));
    assert.throws(
      () => readParameters(file.statements[0]),
      error => error.message === issue.messageText,
      value,
    );
  }
});

test('reports duplicate parameter tags and annotations on unsupported declarations', () => {
  const source =
    '/**\n * @code3d.param width {kind: "length"}\n * @code3d.param width {kind: "angle"}\n */\nfunction model(width: number) {}';
  assert.match(
    diagnostics(sourceFile(source))[0].messageText,
    /more than once/,
  );
  assert.match(
    diagnostics(
      sourceFile('/** @code3d.param width {} */\nconst width = 1;'),
    )[0].messageText,
    /callable declaration/,
  );
});

test('completes parameter names with replacement ranges, including an empty name', () => {
  for (const fragment of ['|', 'wi|', 'wi|dth']) {
    const result = complete(declaration(fragment));
    assert.deepEqual(names(result), ['edges', 'width']);
    const width = result.info.entries.find(entry => entry.name === 'width');
    const {start, length} = width.replacementSpan;
    const replaced =
      result.source.slice(0, start) +
      width.name +
      result.source.slice(start + length);
    assert.match(replaced, /@code3d\.param width \*\//);
  }
});

test('completes config fields, kind values, numeric constraints and actions from actual types', () => {
  assert.deepEqual(names(complete(declaration('width {|}'))), [
    'actions',
    'constraints',
    'kind',
    'label',
  ]);
  assert.deepEqual(names(complete(declaration("width {kind: '|'}"))), [
    'angle',
    'count',
    'edge',
    'length',
    'ratio',
    'scalar',
    'surface',
    'vertex',
  ]);
  assert.deepEqual(
    names(complete(declaration("width {kind: 'length', constraints: {|}}"))),
    ['exclusiveMax', 'exclusiveMin', 'max', 'min'],
  );
  assert.deepEqual(
    names(complete(declaration("edges {kind: 'edge', actions: [{|}]}"))),
    ['action', 'label'],
  );
  assert.deepEqual(
    names(
      complete(declaration("edges {kind: 'edge', actions: [{action: '|'}]}")),
    ),
    ['remove-argument'],
  );
  assert.ok(
    !names(complete(declaration("edges {kind: 'edge', |}"))).includes(
      'constraints',
    ),
  );
});

test('maps string completions and details back into multiline configuration', () => {
  const result = complete(
    '/**\r\n * @code3d.param width {\r\n *   kind: "le|ngth",\r\n * }\r\n */\r\nfunction model(width: number) {}',
  );
  const entry = result.info.entries.find(entry => entry.name === 'length');
  assert.equal(
    result.source.slice(
      entry.replacementSpan.start,
      entry.replacementSpan.start + entry.replacementSpan.length,
    ),
    'length',
  );
  const details = languageService.details(
    result.file,
    result.position,
    'length',
    {},
    preferences,
  );
  assert.equal(details.name, 'length');
});

test('does not offer parameter config completions in arguments or ordinary source', () => {
  assert.equal(
    complete('/** @code3d.arguments [|] */\nfunction model(width: number) {}')
      .info,
    undefined,
  );
  assert.equal(
    complete(declaration("width {kind: 'length'}") + '\nconst value = |').info,
    undefined,
  );
});

test('completes and validates inferred callable parameter names before any call', () => {
  const source = [
    "import {definePrimitive} from '@code3d/core/replicad';",
    '/** @code3d.param r| */',
    'const knob = definePrimitive((radius: number, twist = 60) => {throw new Error("unused");});',
  ].join('\n');
  const result = complete(source);
  assert.deepEqual(names(result), ['radius', 'twist']);
  complete(source.replace('r|', "radius {kind: 'length'}|"));
  assert.deepEqual(languageService.diagnostics(result.file.fileName), []);
  const invalid = complete(source.replace('r|', "missing {kind: 'length'}|"));
  const [issue] = languageService.diagnostics(invalid.file.fileName);
  assert.match(issue.messageText, /unknown parameter: missing/);
  assert.equal(
    invalid.source.slice(issue.start, issue.start + issue.length),
    'missing',
  );
});

test('uses named tuple parameters of emitted callable declarations', () => {
  const result = complete(
    [
      '/** @code3d.param | */',
      'export declare const knob: (...args: [radius: number, twist?: number]) => unknown;',
    ].join('\n'),
  );
  assert.deepEqual(names(result), ['radius', 'twist']);
});

test('projects offsets and spans independently of annotation syntax', () => {
  const text = '{label: "Width 🌍",\r\n  size: 10}';
  const prefix = 'export const demo = (';
  const projection = new EmbeddedCodeProjection(
    {start: 123, text},
    prefix,
    ');',
  );
  assert.equal(projection.source, prefix + text + ');');
  for (let offset = 0; offset <= text.length; offset++) {
    const generated = projection.toGeneratedOffset(123 + offset);
    assert.equal(generated, prefix.length + offset);
    assert.deepEqual(projection.toSourceSpan({start: generated, length: 0}), {
      start: 123 + offset,
      length: 0,
    });
  }
  assert.equal(
    projection.toSourceSpan({start: prefix.length - 1, length: 1}),
    undefined,
  );
  assert.equal(
    projection.toSourceSpan({start: prefix.length, length: text.length + 1}),
    undefined,
  );
});

test('expands param strings through native syntax and embedding boundaries', () => {
  const result = select(declaration("width {kind: 'le|ngth'}"));
  assert.deepEqual(result.texts.slice(0, 5), [
    'length',
    "'length'",
    "kind: 'length'",
    "{kind: 'length'}",
    "width {kind: 'length'}",
  ]);
  assert.ok(result.texts.includes("@code3d.param width {kind: 'length'}"));
  assert.ok(
    result.texts.includes("/** @code3d.param width {kind: 'length'} */"),
  );
  assert.equal(result.texts.at(-1), result.source);
});

test('uses the same expansion pipeline for arguments calls and arrays', () => {
  const result = select(
    "/** @code3d.arguments [box(10, 2|0, 30), {color: 'red'}] */\nfunction model(value: unknown) {}",
  );
  assert.deepEqual(result.texts.slice(0, 5), [
    '20',
    '10, 20, 30',
    'box(10, 20, 30)',
    "box(10, 20, 30), {color: 'red'}",
    "[box(10, 20, 30), {color: 'red'}]",
  ]);
  assert.ok(
    result.texts.includes(
      "@code3d.arguments [box(10, 20, 30), {color: 'red'}]",
    ),
  );
  assert.equal(result.texts.at(-1), result.source);
});

test('matches native TypeScript object selections for both annotation kinds', () => {
  const marked = "{constraints: {min: 1|0, max: 100}, label: 'Width'}";
  const text = marked.replace('|', '');
  const prefix = 'const value = (';
  const reference = 'file:///workspace/reference.ts';
  files.set(reference, prefix + text + ');');
  version += 1;
  const native = nativeLanguageService.getSmartSelectionRange(
    reference,
    prefix.length + marked.indexOf('|'),
  );
  const expected = selectionSpans(native)
    .filter(
      span =>
        span.start >= prefix.length &&
        span.start + span.length <= prefix.length + text.length,
    )
    .map(span =>
      files.get(reference).slice(span.start, span.start + span.length),
    );
  for (const tag of ['param width', 'arguments']) {
    const result = select(
      `/** @code3d.${tag} ${marked} */\nfunction model(width: number) {}`,
    );
    assert.deepEqual(result.texts.slice(0, expected.length), expected);
  }
  files.delete(reference);
  version += 1;
});

test('expands a parameter name without exposing generated helper declarations', () => {
  const result = select(declaration("wi|dth {kind: 'length'}"));
  assert.deepEqual(result.texts.slice(0, 3), [
    'width',
    "width {kind: 'length'}",
    "@code3d.param width {kind: 'length'}",
  ]);
});

test('keeps CRLF, Unicode and JSDoc prefixes at exact source positions', () => {
  const result = select(
    [
      '/** 🌍',
      ' * @code3d.param width {',
      " *   kind: 'length',",
      " *   label: 'Wi|dth 🌍',",
      ' *   constraints: {min: 1}',
      ' * }',
      ' * @code3d.arguments [40]',
      ' */',
      'function model(width: number) {}',
    ].join('\r\n'),
  );
  assert.deepEqual(result.texts.slice(0, 3), [
    'Width 🌍',
    "'Width 🌍'",
    "label: 'Width 🌍'",
  ]);
  assert.ok(
    result.texts.includes(
      "{\r\n *   kind: 'length',\r\n *   label: 'Width 🌍',\r\n *   constraints: {min: 1}\r\n * }",
    ),
  );
  const tag = result.texts.find(text => text.startsWith('@code3d.param'));
  assert.ok(tag);
  assert.ok(!tag.includes('@code3d.arguments'));
});

test('keeps useful selections while an embedded expression is incomplete', () => {
  for (const marked of [
    declaration("width {kind: 'length', constraints: {min: 1|0"),
    '/** @code3d.arguments [box(10, 2|0 */\nfunction model(value: unknown) {}',
  ]) {
    const result = select(marked);
    assert.match(result.texts[0], /^(10|20)$/);
    assert.equal(result.texts.at(-1), result.source);
  }
});

test('retains ordinary TypeScript selections outside embedded code', () => {
  for (const marked of [
    '/** @code3d.arguments | */\nfunction model() {}',
    declaration("width {kind: 'length'}   |"),
    declaration("width {kind: 'length'}") + '\nconst x = model(1|0);',
    '/** A comment about a bo|x. */\nfunction model() {}',
    'const text = "/** @code3d.param width {kind: \'le|ngth\'} */";',
  ]) {
    const result = select(marked);
    assert.deepEqual(result.selection, result.outer);
  }
});

test('handles empty embedded objects and arrays without selecting wrappers', () => {
  assert.ok(select(declaration('width {|}')).texts.includes('{}'));
  assert.ok(
    select('/** @code3d.arguments [|] */\nfunction model() {}').texts.includes(
      '[]',
    ),
  );
});

test('keeps independent selection chains across multiple annotation positions', () => {
  const marked =
    "/**\n * @code3d.param width {kind: 'le|ngth'}\n * @code3d.arguments [40, 20]\n */\nfunction model(width: number, depth: number) {}";
  const result = markedSource(marked);
  const positions = [
    result.position,
    result.source.indexOf('20') + 1,
    result.position,
  ];
  const selections = positions.map(position =>
    languageService.selectionRange(
      result.file,
      position,
      nativeLanguageService.getSmartSelectionRange(
        result.file.fileName,
        position,
      ),
    ),
  );
  const texts = selections.map(selection =>
    selectionSpans(selection).map(span =>
      result.source.slice(span.start, span.start + span.length),
    ),
  );
  assert.equal(texts[0][0], 'length');
  assert.equal(texts[1][0], '20');
  assert.deepEqual(texts[0], texts[2]);
});

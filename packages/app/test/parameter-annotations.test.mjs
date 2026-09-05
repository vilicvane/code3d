import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import ts from '@typescript/typescript6';
import {createAppTestServer} from './vite-test-server.mjs';

let server;
let annotations;
let diagnostics;
let readParameters;
let languageService;
let files;
let version = 0;
const preferences = {
  quotePreference: 'single',
  includeCompletionsWithInsertText: true,
};

before(async () => {
  server = await createAppTestServer();
  ({code3dAnnotations: annotations} = await server.ssrLoadModule(
    '/src/model/annotations.ts',
  ));
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
  const {ParameterAnnotationLanguageService} = await server.ssrLoadModule(
    '/src/monaco/parameter-annotation-language-service.ts',
  );
  const {injectedPackageFiles} = await server.ssrLoadModule(
    '/src/monaco/injected-packages.ts',
  );
  files = new Map(
    injectedPackageFiles.map(file => [file.filePath, file.content]),
  );
  const readFile = name => files.get(name) ?? ts.sys.readFile(name);
  languageService = new ParameterAnnotationLanguageService({
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
  });
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
    info: languageService.completions(file, position, preferences),
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

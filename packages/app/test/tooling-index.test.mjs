import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import ts from '@typescript/typescript6';
import {createAppTestServer} from './vite-test-server.mjs';

let server;
let resolveProjectTooling;
let sourceNodeKey;

before(async () => {
  server = await createAppTestServer();
  ({resolveProjectTooling, sourceNodeKey} = await server.ssrLoadModule(
    '/src/model/tool-schema.ts',
  ));
});

after(async () => {
  await server?.close();
});

test('follows unique property, alias, destructuring, and re-export definitions', () => {
  const settings = [
    'export const base = 40;',
    'export interface Dimensions {width: number; nested: {depth: number}}',
    'export const dimensions: Dimensions = {width: base, nested: {depth: 20}};',
  ].join('\n');
  const bridge = 'export {dimensions} from "./settings";';
  const model = [
    'import {box} from "@code3d/core";',
    'import {dimensions} from "./bridge";',
    'const alias = dimensions.width;',
    'const {nested: {depth}} = dimensions;',
    'const key = "width" as const;',
    'box(alias, depth, dimensions[key]);',
    'box(dimensions.nested.depth, 10, 10);',
  ].join('\n');
  const definitions = indexDefinitions([
    {path: 'settings.ts', source: settings},
    {path: 'bridge.ts', source: bridge},
    {path: 'model.ts', source: model},
  ]);

  assertTarget(definitions, model, 'alias', settings, '40');
  assertTarget(
    definitions,
    model,
    'depth',
    settings,
    '20',
    'box(alias, depth, dimensions[key])',
  );
  assertTarget(definitions, model, 'dimensions[key]', settings, '40');
  assertTarget(definitions, model, 'dimensions.nested.depth', settings, '20');
});

test('uses the concrete object definition even when a type declares the property', () => {
  const source = [
    'import {box} from "@code3d/core";',
    'interface Dimensions {width: number}',
    'const dimensions: Dimensions = {width: 40};',
    'box(dimensions.width, 10, 10);',
  ].join('\n');
  const definitions = indexDefinitions([{path: 'model.ts', source}]);

  assertTarget(definitions, source, 'dimensions.width', source, '40');
});

test('keeps concrete properties distinct across objects with the same type', () => {
  const source = [
    'import {box} from "@code3d/core";',
    'interface Dimensions {width: number}',
    'const first: Dimensions = {width: 40};',
    'const second: Dimensions = {width: 50};',
    'box(first.width, 10, 10);',
    'box(second.width, 10, 10);',
  ].join('\n');
  const definitions = indexDefinitions([{path: 'model.ts', source}]);

  assertTarget(definitions, source, 'first.width', source, '40');
  assertTarget(definitions, source, 'second.width', source, '50');
});

test('does not choose a property from a runtime-ambiguous receiver', () => {
  const source = [
    'import {box} from "@code3d/core";',
    'const a = {width: 40};',
    'const b = {width: 50};',
    'const dimensions = Math.random() > 0.5 ? a : b;',
    'box(dimensions.width, 10, 10);',
  ].join('\n');
  const definitions = indexDefinitions([{path: 'model.ts', source}]);

  assert.equal(targetAt(definitions, source, 'dimensions.width'), undefined);
  assert.equal(definitions.size, 0);
});

test('does not fall back to a same-named outer binding', () => {
  const source = [
    'import {box} from "@code3d/core";',
    'const width = 40;',
    'function use(width: number) { return box(width, 10, 10); }',
  ].join('\n');
  const definitions = indexDefinitions([{path: 'model.ts', source}]);

  assert.equal(targetAt(definitions, source, 'width'), undefined);
});

test('ignores variable annotation metadata while preserving the resolved source', () => {
  const source = [
    'import {box} from "@code3d/core";',
    '/**',
    ' * @code3d.label Cabinet width',
    ' * @code3d.description Shared outer width.',
    ' * @code3d.kind length',
    ' * @code3d.unit mm',
    ' * @code3d.min 20',
    ' * @code3d.max 80',
    ' * @code3d.step 0.5',
    ' */',
    'const width = 40;',
    'const dimensions = {width};',
    'box(dimensions.width, 10, 10);',
  ].join('\n');
  const definitions = indexDefinitions([{path: 'model.ts', source}]);

  const target = targetAt(definitions, source, 'dimensions.width');
  assert.deepEqual(Object.keys(target).sort(), ['label', 'sourceRef', 'value']);
  assert.equal(target.label, 'Width');
  assert.equal(target.value, 40);
  assert.equal(
    source.slice(target.sourceRef.start, target.sourceRef.end),
    '40',
  );
});

test('keeps coil turn counts fractional in the tool panel', () => {
  const source = 'import {coil} from "@code3d/core"; coil(5, 0.75, 4, 0.25);';
  const calls = resolveProjectTooling({
    files: [{path: 'model.ts', source}],
  }).toolCalls.get('/model.ts');
  const schema = toolSchemaAt(calls, source, 'coil(5, 0.75, 4, 0.25)');
  assert.deepEqual(
    schema.parameters.map(parameter => parameter.name),
    ['coilRadius', 'wireRadius', 'pitch', 'turns'],
  );
  assert.equal(schema.parameters[3].kind, 'scalar');
  assert.deepEqual(schema.parameters[3].constraints, {exclusiveMin: 0});
});

test('resolves tool schemas from layered model capabilities', () => {
  const source = [
    'import {box, circle} from "@code3d/core";',
    'const solid = box(10, 20, 30);',
    'const face = circle(4);',
    'solid.fillet(2, [1]);',
    'solid.edge(1);',
    'solid.scaled(2);',
    'face.surface(1);',
  ].join('\n');
  const calls = resolveProjectTooling({
    files: [{path: 'model.ts', source}],
  }).toolCalls.get('/model.ts');

  assert.deepEqual(
    toolSchemaAt(calls, source, 'solid.fillet(2, [1])')?.parameters,
    [
      {
        index: 0,
        name: 'radius',
        optional: false,
        label: 'Fillet radius',
        actions: [],
        kind: 'length',
        constraints: {exclusiveMin: 0},
      },
      {
        index: 1,
        name: 'edgeIds',
        optional: true,
        label: 'Edge Ids',
        actions: [{label: 'Use all', action: 'remove-argument'}],
        kind: 'edge',
        multiple: true,
      },
    ],
  );
  assert.deepEqual(toolSchemaAt(calls, source, 'solid.edge(1)')?.parameters, [
    {
      index: 0,
      name: 'id',
      optional: false,
      label: 'Edge',
      actions: [],
      kind: 'edge',
      multiple: false,
    },
  ]);
  assert.equal(
    toolSchemaAt(calls, source, 'solid.scaled(2)')?.parameters[0]?.kind,
    'ratio',
  );
  assert.equal(
    toolSchemaAt(calls, source, 'face.surface(1)')?.parameters[0]?.kind,
    'surface',
  );
});

const primitiveSource = [
  'import {definePrimitive, replicad} from "@code3d/core/replicad";',
  '/**',
  ' * @code3d.param radius {kind: "length", label: "Outer radius"}',
  ' * @code3d.param y {kind: "length", constraints: {exclusiveMin: 0}}',
  ' */',
  'export const sleeve = definePrimitive((radius: number, y = 4) =>',
  '  replicad.makeCylinder(radius, y),',
  ');',
].join('\n');

test('keeps an unannotated resolved overload separate from its annotated peers', () => {
  const source = [
    'import {ISO4762} from "@code3d/screws";',
    'ISO4762.clearanceHole("M6", 10);',
    'ISO4762.clearanceHole("M6", {depth: 10});',
  ].join('\n');
  const calls = resolveProjectTooling({
    files: [{path: 'model.ts', source}],
  }).toolCalls.get('/model.ts');
  assert.equal(
    toolSchemaAt(calls, source, 'ISO4762.clearanceHole("M6", 10)')
      ?.parameters[0].name,
    'depth',
  );
  assert.equal(
    toolSchemaAt(calls, source, 'ISO4762.clearanceHole("M6", {depth: 10})'),
    undefined,
  );
});

for (const declarationOnly of [false, true]) {
  test(`reads primitive annotations through imports and aliases from ${declarationOnly ? 'emitted declarations' : 'source'}`, () => {
    const source = [
      'import {sleeve as imported} from "./bridge";',
      'import * as library from "./library.js";',
      'const renamed = imported;',
      'const radius = 6;',
      'renamed(radius);',
      'library.sleeve(8, 12);',
    ].join('\n');
    const index = resolveProjectTooling({
      files: [
        {
          path: declarationOnly ? 'library.d.ts' : 'library.ts',
          source: declarationOnly
            ? emitPrimitiveDeclaration(primitiveSource)
            : primitiveSource,
        },
        {path: 'bridge.ts', source: 'export {sleeve} from "./library.js";'},
        {path: 'model.ts', source},
      ],
    });
    const calls = index.toolCalls.get('/model.ts');
    const schema = toolSchemaAt(calls, source, 'renamed(radius)');
    assert.equal(schema?.name, 'sleeve');
    assert.deepEqual(
      schema?.parameters.map(({name, index, optional, label}) => ({
        name,
        index,
        optional,
        label,
      })),
      [
        {name: 'radius', index: 0, optional: false, label: 'Outer radius'},
        {name: 'y', index: 1, optional: true, label: 'Y'},
      ],
    );
    assert.deepEqual(
      toolSchemaAt(calls, source, 'library.sleeve(8, 12)')?.parameters,
      schema.parameters,
    );
    assertTarget(
      index.parameterDefinitions.get('/model.ts'),
      source,
      'radius',
      source,
      '6',
      'renamed(radius)',
    );
  });
}

test('does not share annotations between callable variables with the same type', () => {
  const source = [
    'import {definePrimitive, replicad} from "@code3d/core/replicad";',
    'const builder = (radius: number) => replicad.makeCylinder(radius, 4);',
    '/** @code3d.param radius {kind: "length", label: "First radius"} */',
    'const first = definePrimitive(builder);',
    '/** @code3d.param radius {kind: "length", label: "Second radius"} */',
    'const second = definePrimitive(builder);',
    'first(2);',
    'second(3);',
  ].join('\n');
  const calls = resolveProjectTooling({
    files: [{path: 'model.ts', source}],
  }).toolCalls.get('/model.ts');
  assert.equal(
    toolSchemaAt(calls, source, 'first(2)')?.parameters[0].label,
    'First radius',
  );
  assert.equal(
    toolSchemaAt(calls, source, 'second(3)')?.parameters[0].label,
    'Second radius',
  );
});

test('reports annotations naming a parameter missing from the returned signature', () => {
  const source =
    primitiveSource.replace('@code3d.param radius', '@code3d.param missing') +
    '\nsleeve(2);';
  assert.throws(
    () => resolveProjectTooling({files: [{path: 'model.ts', source}]}),
    /unknown parameter: missing/,
  );
});

function emitPrimitiveDeclaration(source) {
  const fileName = fileURLToPath(
    new URL('./primitive-fixture.ts', import.meta.url),
  );
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    declaration: true,
    emitDeclarationOnly: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, ...args) =>
    path === fileName
      ? ts.createSourceFile(path, source, options.target, true)
      : getSourceFile(path, ...args);
  const program = ts.createProgram([fileName], options, host);
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .map(diagnostic =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ),
    [],
  );
  let declaration;
  program.emit(undefined, (path, text) => {
    if (path.endsWith('primitive-fixture.d.ts')) declaration = text;
  });
  assert.ok(declaration?.includes('@code3d.param radius'));
  return declaration;
}

function indexDefinitions(files) {
  return resolveProjectTooling({files}).parameterDefinitions.get('/model.ts');
}

function toolSchemaAt(calls, source, call) {
  const start = source.indexOf(call);
  assert.notEqual(start, -1, `missing call fixture: ${call}`);
  return calls?.get(sourceNodeKey(start, start + call.length));
}

function targetAt(definitions, source, reference, context = reference) {
  const contextStart = source.lastIndexOf(context);
  assert.notEqual(contextStart, -1, `missing fixture context: ${context}`);
  const referenceOffset = context.indexOf(reference);
  assert.notEqual(referenceOffset, -1, `missing ${reference} in ${context}`);
  const start = contextStart + referenceOffset;
  return definitions.get(sourceNodeKey(start, start + reference.length));
}

function assertTarget(
  definitions,
  source,
  reference,
  targetSource,
  expected,
  context,
) {
  const target = targetAt(definitions, source, reference, context);
  assert.ok(target, `missing definition for ${reference}`);
  assert.equal(
    targetSource.slice(target.sourceRef.start, target.sourceRef.end),
    expected,
  );
}

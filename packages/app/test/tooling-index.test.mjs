import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
let server;
let resolveProjectTooling;
let sourceNodeKey;

before(async () => {
  server = await createServer({
    root: appRoot,
    appType: 'custom',
    logLevel: 'error',
    server: {middlewareMode: true},
  });
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

test('preserves parameter metadata at the resolved definition', () => {
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
  assert.deepEqual(
    {
      label: target?.label,
      description: target?.description,
      kind: target?.kind,
      unit: target?.unit,
      min: target?.min,
      max: target?.max,
      step: target?.step,
    },
    {
      label: 'Cabinet width',
      description: 'Shared outer width.',
      kind: 'length',
      unit: 'mm',
      min: 20,
      max: 80,
      step: 0.5,
    },
  );
});

function indexDefinitions(files) {
  return resolveProjectTooling({files}).parameterDefinitions.get('/model.ts');
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

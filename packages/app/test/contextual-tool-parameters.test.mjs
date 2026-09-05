import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';
import {
  createTestProjectCompiler,
  importTestModule,
} from './project-test-files.mjs';
import {transform} from 'esbuild';

let server;
let compiler;
let contextualToolParameters;
let contextualParameterView;
let contextualParameterIntent;
let ToolEngine;

before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({
    contextualToolParameters,
    contextualParameterView,
    contextualParameterIntent,
  } = await server.ssrLoadModule('/src/tools/contextual-tool-parameters.ts'));
  ({ToolEngine} = await server.ssrLoadModule('/src/tools/tool-system.ts'));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

for (const [expression, value] of [
  ['Math.PI', Math.PI],
  ['i * 8', 32],
  ['(i - 2) * 8', 16],
  ['(i - 2) * 8 + 3', 19],
  ['first + second', 10],
]) {
  test(`${expression}: show a placeholder and replace the entire expression, even with the same value`, async () => {
    const result = await parametersFor(expression);
    const parameter = result.parameters.get('x');
    const view = contextualParameterView(parameter);
    assert.equal(view.value, undefined);
    assert.equal(view.placeholder, String(Number(value.toFixed(3))));
    assert.equal(view.disabled, false);
    assert.equal(view.invalid, false);
    assert.equal(contextualParameterIntent(parameter), undefined);
    parameter.value = value;
    const intent = contextualParameterIntent(parameter);
    assert.equal(intent.kind, 'argument.set');
    const source = replaceWithIntent(result.source, intent);
    assert.equal(
      source,
      result.source.replace(
        `box(${expression},`,
        `box(${Number(value.toPrecision(12))},`,
      ),
    );
    assert.equal(contextualParameterView(parameter).placeholder, undefined);
  });
}

test('literal arguments remain values and a unique upstream parameter retains inverse editing', async () => {
  for (const expression of ['16', 'spacing * 2', 'settings.spacing * 2']) {
    const result = await parametersFor(expression);
    const parameter = result.parameters.get('x');
    assert.equal(contextualParameterView(parameter).value, 16);
    assert.equal(contextualParameterView(parameter).placeholder, undefined);
    parameter.value = 20;
    const intent = contextualParameterIntent(parameter);
    assert.equal(intent.kind, 'parameter.set');
    const source = replaceWithIntent(result.source, intent);
    assert.equal(
      source,
      expression === '16'
        ? result.source.replace('box(16,', 'box(20,')
        : expression === 'spacing * 2'
          ? result.source.replace('const spacing = 8;', 'const spacing = 10;')
          : result.source.replace('spacing: 8', 'spacing: 10'),
    );
  }
});

test('omitted arguments have no placeholder and only the next argument is writable', async () => {
  const {parameters} = await parametersFor('Math.PI', true);
  assert.equal(
    contextualParameterView(parameters.get('x')).placeholder,
    '3.142',
  );
  const y = parameters.get('y');
  const z = parameters.get('z');
  for (const parameter of [y, z]) {
    assert.equal(contextualParameterView(parameter).value, undefined);
    assert.equal(contextualParameterView(parameter).placeholder, undefined);
  }
  assert.equal(contextualParameterView(y).disabled, false);
  assert.equal(contextualParameterView(z).disabled, true);
  y.value = 8;
  assert.equal(contextualParameterIntent(y).target.kind, 'omitted');
});

test('expression replacement uses the same numeric constraints as parameter editing', async () => {
  const {parameters} = await parametersFor('Math.PI');
  const parameter = parameters.get('x');
  for (const value of [undefined, NaN, Infinity, 0, -1]) {
    parameter.value = value;
    assert.equal(contextualParameterIntent(parameter), undefined);
  }
  parameter.value = 1;
  assert.equal(contextualParameterIntent(parameter).kind, 'argument.set');
});

const defaultParameterSource = [
  "import {box} from '@code3d/core';",
  '/**',
  " * @code3d.param x {kind: 'length', default: 12, constraints: {exclusiveMin: 0}}",
  " * @code3d.param y {kind: 'count', default: 4, constraints: {min: 1}}",
  " * @code3d.param z {kind: 'length', default: 0}",
  " * @code3d.param twist {kind: 'angle', default: -30}",
  ' */',
  'function block(x = 12, y = 4, z = 0, twist = -30) {return box(x, y, z + 1);}',
].join('\n');

test('omitted defaults are placeholders and only the next argument can be written', async () => {
  for (const call of ['block()', 'block(12,)', 'block(12, 4)']) {
    const result = await compileParameters(
      `${defaultParameterSource}\n${call};`,
      'block',
    );
    const omitted = call === 'block()' ? 0 : call === 'block(12,)' ? 1 : 2;
    for (const [index, [name, value]] of [
      ['x', 12],
      ['y', 4],
      ['z', 0],
      ['twist', -30],
    ].entries()) {
      const parameter = result.parameters.get(name);
      const view = contextualParameterView(parameter);
      assert.equal(view.value, index < omitted ? value : undefined);
      assert.equal(
        view.placeholder,
        index < omitted ? undefined : String(value),
      );
      assert.equal(view.disabled, index > omitted);
      assert.equal(view.invalid, false);
      if (index >= omitted)
        assert.equal(contextualParameterIntent(parameter), undefined);
    }
    const next = [...result.parameters.values()][omitted];
    next.value = next.schema.default;
    const intent = contextualParameterIntent(next);
    assert.equal(intent.kind, 'argument.set');
    assert.equal(intent.target.kind, 'omitted');
    const source = replaceWithIntent(result.source, intent);
    const expected = ['block(12)', 'block(12,4)', 'block(12, 4, 0)'][omitted];
    assert.equal(source, result.source.replace(call, expected));
    const written = await compileParameters(source, 'block');
    assert.equal(
      contextualParameterView(written.parameters.get(next.schema.name)).value,
      next.value,
    );
  }
});

test('explicit arguments never use an annotation default, even without an evaluated number', async () => {
  for (const [expression, value, placeholder] of [
    ['7', 7, undefined],
    ['Math.PI', undefined, '3.142'],
    ['undefined', undefined, undefined],
    ['void 0', undefined, undefined],
    ['(() => undefined)()', undefined, undefined],
    ['missingValue()', undefined, undefined],
  ]) {
    const result = await compileParameters(
      `${defaultParameterSource}\nblock(${expression});`,
      'block',
    );
    const view = contextualParameterView(result.parameters.get('x'));
    assert.equal(view.value, value, expression);
    assert.equal(view.placeholder, placeholder, expression);
    assert.equal(view.disabled, false);
  }
});

test('defaults do not supply edit values or bypass numeric validation', async () => {
  const {parameters} = await compileParameters(
    `${defaultParameterSource}\nblock(12);`,
    'block',
  );
  const y = parameters.get('y');
  for (const value of [undefined, NaN, Infinity, 0, -1, 1.5]) {
    y.value = value;
    assert.equal(contextualParameterIntent(y), undefined);
  }
  y.value = 5;
  assert.equal(contextualParameterIntent(y).expression.value, 5);
});

test('spread arguments never masquerade as omitted positional defaults', async () => {
  for (const call of [
    'block(...[12, 4, 0, -30] as const)',
    'block(12, ...[4, 0] as const)',
  ]) {
    const {parameters} = await compileParameters(
      `${defaultParameterSource}\n${call};`,
      'block',
    );
    for (const name of ['y', 'z', 'twist']) {
      const parameter = parameters.get(name);
      const view = contextualParameterView(parameter);
      assert.equal(view.value, undefined);
      assert.equal(view.placeholder, undefined);
      assert.equal(view.disabled, true);
      parameter.value = 10;
      assert.equal(contextualParameterIntent(parameter), undefined);
    }
    assert.equal(
      contextualParameterView(parameters.get('x')).disabled,
      call.startsWith('block(...'),
    );
  }
});

test('annotations describe display defaults without changing interactive or ordinary execution', async () => {
  const source = [
    "/** @code3d.param twist {kind: 'angle', default: 60} */",
    'export function angle(twist = 75) {return [twist, arguments.length];}',
    'export const omitted = angle();',
    'export const explicit = angle(30);',
    'export const explicitUndefined = angle(undefined);',
    'if (omitted[0] !== 75 || omitted[1] !== 0 || explicit[0] !== 30 || explicit[1] !== 1 || explicitUndefined[0] !== 75 || explicitUndefined[1] !== 1) throw Error("call semantics changed");',
  ].join('\n');
  const {code} = await transform(source, {loader: 'ts', format: 'esm'});
  const native = await importTestModule(code);
  const {module, parameters} = await compileParameters(
    `import {box} from '@code3d/core';\n${source}\nbox(1, 1, 1);`,
    'angle',
  );
  for (const [name, expected] of [
    ['omitted', [75, 0]],
    ['explicit', [30, 1]],
    ['explicitUndefined', [75, 1]],
  ]) {
    assert.deepEqual(native[name], expected);
  }
  assert.equal(module.diagnostic, undefined);
  assert.equal(
    contextualParameterView(parameters.get('twist')).placeholder,
    '60',
  );
});

async function parametersFor(expression, omit = false) {
  const source = [
    "import {box} from '@code3d/core';",
    'const spacing = 8;',
    'const settings = {spacing: 8};',
    'const first = 8, second = 2;',
    `function item(i: number) {return box(${expression}${omit ? '' : ', 8, 4'});}`,
    'export default item(4);',
  ].join('\n');
  return compileParameters(source, 'box');
}

async function compileParameters(source, name) {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  const target = module.sourceTargets.find(
    target => target.tool?.signature.name === name,
  );
  assert.ok(target);
  const evaluation = target.evaluations[0];
  return {
    module,
    source,
    parameters: contextualToolParameters(
      target.tool.signature,
      target.tool.arguments,
      target.sourceRef,
      evaluation.parameters ?? [],
      evaluation.toolArguments,
    ),
  };
}

function replaceWithIntent(source, intent) {
  const engine = new ToolEngine({
    sourceVersion: () => 1,
    resolveSourceRef: ref => ref,
    readSource: ref => source.slice(ref.start, ref.end),
  });
  const result = engine.resolve('panel', intent);
  assert.equal(result.status, 'ready');
  for (const edit of [...result.plan.edits].sort(
    (a, b) => b.sourceRef.start - a.sourceRef.start,
  )) {
    assert.equal(
      source.slice(edit.sourceRef.start, edit.sourceRef.end),
      edit.expectedText,
    );
    source =
      source.slice(0, edit.sourceRef.start) +
      edit.text +
      source.slice(edit.sourceRef.end);
  }
  return source;
}

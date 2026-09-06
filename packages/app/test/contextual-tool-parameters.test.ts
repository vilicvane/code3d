import type {ToolIntent, ToolHost} from '../src/tools/tool-system.ts';
import {defined} from '../../../test/assert.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {
  createTestProjectCompiler,
  importTestModule,
} from './project-test-files.ts';
import {transform} from 'esbuild';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestProjectCompiler>>;
let contextualToolParameters: (typeof import('../src/tools/contextual-tool-parameters.ts'))['contextualToolParameters'];
let contextualParameterView: (typeof import('../src/tools/contextual-tool-parameters.ts'))['contextualParameterView'];
let contextualParameterIntent: (typeof import('../src/tools/contextual-tool-parameters.ts'))['contextualParameterIntent'];
let ToolEngine: (typeof import('../src/tools/tool-system.ts'))['ToolEngine'];

before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({
    contextualToolParameters,
    contextualParameterView,
    contextualParameterIntent,
  } = await server.ssrLoadModule<
    typeof import('../src/tools/contextual-tool-parameters.ts')
  >('/src/tools/contextual-tool-parameters.ts'));
  ({ToolEngine} = await server.ssrLoadModule<
    typeof import('../src/tools/tool-system.ts')
  >('/src/tools/tool-system.ts'));
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
] as const) {
  test(`${expression}: show a placeholder and replace the entire expression, even with the same value`, async () => {
    const result = await parametersFor(expression);
    const parameter = result.parameters.get('x');
    const view = contextualParameterView(defined(parameter));
    assert.equal(view.value, undefined);
    assert.equal(view.placeholder, String(Number(value.toFixed(3))));
    assert.equal(view.disabled, false);
    assert.equal(view.invalid, false);
    assert.equal(contextualParameterIntent(defined(parameter)), undefined);
    defined(parameter).value = value;
    const intent = contextualParameterIntent(defined(parameter));
    assert.ok(defined(intent).kind === 'argument.set');
    const source = replaceWithIntent(result.source, defined(intent));
    assert.equal(
      source,
      result.source.replace(
        `box(${expression},`,
        `box(${Number(value.toPrecision(12))},`,
      ),
    );
    assert.equal(
      contextualParameterView(defined(parameter)).placeholder,
      undefined,
    );
  });
}

test('literal arguments remain values and a unique upstream parameter retains inverse editing', async () => {
  for (const expression of [
    '16',
    'spacing * 2',
    'settings.spacing * 2',
  ] as const) {
    const result = await parametersFor(expression);
    const parameter = result.parameters.get('x');
    assert.equal(contextualParameterView(defined(parameter)).value, 16);
    assert.equal(
      contextualParameterView(defined(parameter)).placeholder,
      undefined,
    );
    defined(parameter).value = 20;
    const intent = contextualParameterIntent(defined(parameter));
    assert.ok(defined(intent).kind === 'parameter.set');
    const source = replaceWithIntent(result.source, defined(intent));
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
    contextualParameterView(defined(parameters.get('x'))).placeholder,
    '3.142',
  );
  const y = parameters.get('y');
  const z = parameters.get('z');
  for (const parameter of [y, z] as const) {
    assert.equal(contextualParameterView(defined(parameter)).value, undefined);
    assert.equal(
      contextualParameterView(defined(parameter)).placeholder,
      undefined,
    );
  }
  assert.equal(contextualParameterView(defined(y)).disabled, false);
  assert.equal(contextualParameterView(defined(z)).disabled, true);
  defined(y).value = 8;
  const intent = defined(contextualParameterIntent(defined(y)));
  assert.ok(intent.kind === 'argument.set');
  assert.ok(intent.target.kind === 'omitted');
});

test('expression replacement uses the same numeric constraints as parameter editing', async () => {
  const {parameters} = await parametersFor('Math.PI');
  const parameter = parameters.get('x');
  for (const value of [undefined, NaN, Infinity, 0, -1] as const) {
    defined(parameter).value = value;
    assert.equal(contextualParameterIntent(defined(parameter)), undefined);
  }
  defined(parameter).value = 1;
  assert.ok(
    defined(contextualParameterIntent(defined(parameter))).kind ===
      'argument.set',
  );
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
  for (const call of ['block()', 'block(12,)', 'block(12, 4)'] as const) {
    const result = await compileParameters(
      `${defaultParameterSource}\n${call};`,
      'block',
    );
    const omitted = call === 'block()' ? 0 : call === 'block(12,)' ? 1 : 2;
    for (const [index, [name, value]] of (
      [
        ['x', 12],
        ['y', 4],
        ['z', 0],
        ['twist', -30],
      ] as const
    ).entries()) {
      const parameter = result.parameters.get(name);
      const view = contextualParameterView(defined(parameter));
      assert.equal(view.value, index < omitted ? value : undefined);
      assert.equal(
        view.placeholder,
        index < omitted ? undefined : String(value),
      );
      assert.equal(view.disabled, index > omitted);
      assert.equal(view.invalid, false);
      if (index >= omitted)
        assert.equal(contextualParameterIntent(defined(parameter)), undefined);
    }
    const next = [...result.parameters.values()][omitted];
    next.value = next.schema.default;
    const intent = defined(contextualParameterIntent(next));
    assert.ok(intent.kind === 'argument.set');
    assert.ok(intent.target.kind === 'omitted');
    const source = replaceWithIntent(result.source, defined(intent));
    const expected = ['block(12)', 'block(12,4)', 'block(12, 4, 0)'][omitted];
    assert.equal(source, result.source.replace(call, expected));
    const written = await compileParameters(source, 'block');
    assert.equal(
      contextualParameterView(defined(written.parameters.get(next.schema.name)))
        .value,
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
  ] as const) {
    const result = await compileParameters(
      `${defaultParameterSource}\nblock(${expression});`,
      'block',
    );
    const view = contextualParameterView(defined(result.parameters.get('x')));
    assert.equal(view.value, value, defined(expression));
    assert.equal(view.placeholder, placeholder, defined(expression));
    assert.equal(view.disabled, false);
  }
});

test('defaults do not supply edit values or bypass numeric validation', async () => {
  const {parameters} = await compileParameters(
    `${defaultParameterSource}\nblock(12);`,
    'block',
  );
  const y = parameters.get('y');
  for (const value of [undefined, NaN, Infinity, 0, -1, 1.5] as const) {
    defined(y).value = value;
    assert.equal(contextualParameterIntent(defined(y)), undefined);
  }
  defined(y).value = 5;
  const intent = defined(contextualParameterIntent(defined(y)));
  assert.ok(intent.kind === 'argument.set');
  assert.ok(intent.expression.kind === 'number');
  assert.equal(intent.expression.value, 5);
});

test('spread arguments never masquerade as omitted positional defaults', async () => {
  for (const call of [
    'block(...[12, 4, 0, -30] as const)',
    'block(12, ...[4, 0] as const)',
  ] as const) {
    const {parameters} = await compileParameters(
      `${defaultParameterSource}\n${call};`,
      'block',
    );
    for (const name of ['y', 'z', 'twist'] as const) {
      const parameter = parameters.get(name);
      const view = contextualParameterView(defined(parameter));
      assert.equal(view.value, undefined);
      assert.equal(view.placeholder, undefined);
      assert.equal(view.disabled, true);
      defined(parameter).value = 10;
      assert.equal(contextualParameterIntent(defined(parameter)), undefined);
    }
    assert.equal(
      contextualParameterView(defined(parameters.get('x'))).disabled,
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
  ] as const) {
    assert.deepEqual(native[name], expected);
  }
  assert.equal(module.diagnostic, undefined);
  assert.equal(
    contextualParameterView(defined(parameters.get('twist'))).placeholder,
    '60',
  );
});

async function parametersFor(expression: string, omit = false) {
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

async function compileParameters(source: string, name: string) {
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
      defined(target.tool).signature,
      defined(target.tool).arguments,
      target.sourceRef,
      evaluation.parameters ?? [],
      evaluation.toolArguments,
    ),
  };
}

function replaceWithIntent(source: string, intent: ToolIntent) {
  const engine = new ToolEngine({
    sourceVersion: () => 1,
    resolveSourceRef: ref => ref,
    readSource: ref => source.slice(ref.start, ref.end),
    applySourceEdits() {
      assert.fail('Resolution must not commit edits');
    },
    applyPreview() {
      assert.fail('Resolution must not render a preview');
    },
    commitPreview() {
      assert.fail('Resolution must not commit a preview');
    },
    clearPreview() {
      assert.fail('Resolution must not clear a preview');
    },
  });
  const result = engine.resolve('panel', intent);
  assert.ok(result.status === 'ready');
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

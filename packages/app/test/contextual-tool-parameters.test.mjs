import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestProjectCompiler} from './project-test-files.mjs';

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

async function parametersFor(expression, omit = false) {
  const source = [
    "import {box} from '@code3d/core';",
    'const spacing = 8;',
    'const settings = {spacing: 8};',
    'const first = 8, second = 2;',
    `function item(i: number) {return box(${expression}${omit ? '' : ', 8, 4'});}`,
    'export default item(4);',
  ].join('\n');
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  const target = module.sourceTargets.find(
    target => target.tool?.signature.name === 'box',
  );
  assert.ok(target);
  const evaluation = target.evaluations[0];
  return {
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

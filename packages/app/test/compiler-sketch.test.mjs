import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestProjectCompiler} from './project-test-files.mjs';

let server, compiler, ModelViewport;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({ModelViewport} = await server.ssrLoadModule('/src/viewport.ts'));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

async function compile(source, files = []) {
  const module = await compiler.compile(
    {
      files: [
        {
          path: '/model.ts',
          source: `import {sketch} from '@code3d/core';\n${source}`,
        },
        ...files,
      ],
    },
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  return module;
}

test('named sketches are selectable without a 3D model and retain layer-local identities', async () => {
  const source = `import {sketch} from '@code3d/core';
const width = 20;
let sketch1 = sketch([['point', 1, [0, 0]], ['point', 2, [width, 0]], ['line', 3, [1, 2]]]);
let sketch2 = sketch1.derive([['point', 1, [10, 10]], ['line', 2, [sketch1.point(2), 1]]]);`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  assert.equal(module.sketches.size, 2);
  const [base, derived] = [...module.sketches.values()];
  assert.equal(derived.base, base.id);
  assert.equal(derived.references[base.id], 'sketch1');
  assert.equal(
    source.slice(derived.definitionRef.start, derived.definitionRef.end),
    "[['point', 1, [10, 10]], ['line', 2, [sketch1.point(2), 1]]]",
  );
  for (const [binding, value] of [
    ['sketch1 =', base],
    ['sketch2 =', derived],
  ]) {
    const target = ModelViewport.prototype.sourceTargetAt.call(
      {module},
      '/model.ts',
      source.indexOf(binding) + 3,
    );
    assert.deepEqual(target.evaluations[0].sketchIds, [value.id]);
  }
});

test('grandparent references use visible bindings without relative-depth syntax', async () => {
  const module = await compile(`const base = sketch([['point', 1, [0, 0]]]);
const middle = base.derive([]);
const end = middle.derive([]);`);
  const [base, middle, end] = [...module.sketches.values()];
  assert.equal(end.references[base.id], 'base');
  assert.equal(end.references[middle.id], 'middle');
});

test('receiver parameters are valid names, shadowed and reassigned ancestors are not guessed', async () => {
  const module = await compile(`let base = sketch([['point', 1, [0, 0]]]);
const middle = base.derive([]);
base = sketch([]);
function derive(input) { const base = 42; return input.derive([]); }
const end = derive(middle);`);
  const layers = [...module.sketches.values()];
  const end = layers.at(-1);
  assert.equal(end.references[end.base], 'input');
  assert.equal(end.references[layers[0].id], undefined);
});

test('computed arrays remain visible without pretending they have an editable tuple source', async () => {
  const module = await compile(
    `const entries = [['point', 1, [0, 0]]]; const value = sketch(entries);`,
  );
  const value = [...module.sketches.values()][0];
  assert.equal(value.definitionRef, undefined);
  assert.equal(value.entities.length, 1);
});

test('argument-side reassignment does not turn the receiver name into a false upstream reference', async () => {
  const module = await compile(`let base = sketch([['point', 1, [0,0]]]);
const original = base;
const other = sketch([]);
const result = base.derive([['point', 1, [(base = other, 0), 0]]]);`);
  const [base, , result] = [...module.sketches.values()];
  assert.equal(result.references[base.id], 'original');
});

test('import aliases and repeated compilation preserve authored identities', async () => {
  const source =
    "import {base as upstream} from './base.ts'; const derived = upstream.derive([]);";
  const files = [
    {
      path: '/base.ts',
      source:
        "import {sketch} from '@code3d/core'; export const base = sketch([['point', 7, [0,0]]]);",
    },
  ];
  const first = await compile(source, files),
    second = await compile(source, files);
  assert.deepEqual([...second.sketches.keys()], [...first.sketches.keys()]);
  const [base, derived] = [...first.sketches.values()];
  assert.equal(derived.references[base.id], 'upstream');
});

test('receiver tracing preserves optional chain short circuiting and evaluates receivers once', async () => {
  await compile(`let calls = 0;
function get() { calls++; return {child: {method() { return this; }}}; }
const none = undefined;
none?.child.method();
none?.child?.method();
get().child.method();
if (calls !== 1) throw new Error('Repeated receiver evaluation');
const value = sketch([]);`);
});

import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ModelDiagnostic} from '../src/model/diagnostic.ts';
import type {CompiledSketch} from '../src/model/sketch-trace.ts';
import type {TestModelPipeline} from './model-pipeline.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer, type AppTestServer} from './vite-test-server.ts';

let server: AppTestServer;
let compiler: TestModelPipeline;
let viewportDiagnostic: (typeof import('../src/model/viewport-diagnostic.ts'))['viewportDiagnostic'];
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
  ({viewportDiagnostic} = await server.ssrLoadModule<
    typeof import('../src/model/viewport-diagnostic.ts')
  >('/src/model/viewport-diagnostic.ts'));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});
const entries =
  "[['point', 1, [0,0]], ['point', 2, [40,0]], ['line', 3, [1,2]]]";
const options = (length = 40) =>
  `{constraints: [['length', 3, 40], ['length', 3, ${length}]]}`;
const compile = (source: string) =>
  compiler.compile(
    {
      files: [
        {
          path: '/model.ts',
          source: "import {sketch, box} from '@code3d/core';\n" + source,
        },
      ],
    },
    '/model.ts',
  );
const layers = (
  values: ReadonlyMap<string, CompiledSketch>,
  value: CompiledSketch,
) => {
  const result = [value];
  for (let base = value.base; base; base = values.get(base)!.base)
    result.unshift(values.get(base)!);
  return result;
};

test('sketch errors belong to the defining execution, never to its receiver or unrelated sketches', async () => {
  const source = (length = 40) => `
const base = sketch(${entries});
const sibling = sketch([]);
const child = base.derive(${entries}, ${options(length)});`;
  const good = await compile(source());
  assert.equal(good.diagnostic, undefined);
  const [base, sibling, child] = [...good.sketches.values()];
  const bad = await compile(source(50));
  const diagnostic = bad.diagnostic;
  assert.ok(diagnostic);
  assert.equal(diagnostic.kind, 'evaluation');
  assert.ok(diagnostic.failedEvaluationIds?.includes(child.evaluationId!));
  assert.equal(viewportDiagnostic(diagnostic, [base]), undefined);
  assert.equal(viewportDiagnostic(diagnostic, [sibling]), undefined);
  assert.equal(
    viewportDiagnostic(diagnostic, layers(good.sketches, child)),
    undefined,
  );
  assert.equal(viewportDiagnostic(diagnostic, undefined), undefined);
});

test('a retained derived sketch includes a failed upstream definition but not unrelated model errors', async () => {
  const source = (length = 40) => `
const base = sketch(${entries}, ${options(length)});
const child = base.derive([]);
const solid = box(10, 10, 10);
`;
  const good = await compile(source());
  const child = [...good.sketches.values()].at(-1)!;
  const scope = layers(good.sketches, child);
  const bad = await compile(source(50));
  assert.ok(bad.diagnostic);
  assert.equal(viewportDiagnostic(bad.diagnostic, scope), undefined);
  const modelFailure = await compile(source() + 'solid.fillet(2, [999]);');
  assert.ok(modelFailure.diagnostic?.relatedModelNodeIds?.length);
  assert.equal(viewportDiagnostic(modelFailure.diagnostic, scope), undefined);
  assert.equal(
    viewportDiagnostic(modelFailure.diagnostic, undefined),
    undefined,
  );
});

test('repeated factory evaluations with shared source locations retain distinct sketch error scopes', async () => {
  const source = (length = 40) => `
function create(length) { return sketch(${entries}, {constraints: [['length', 3, 40], ['length', 3, length]]}); }
const first = create(40);
const second = create(${length});`;
  const good = await compile(source());
  const [first, second] = [...good.sketches.values()];
  assert.notEqual(first.evaluationId, second.evaluationId);
  assert.deepEqual(first.definitionRef, second.definitionRef);
  const bad = await compile(source(50));
  assert.ok(bad.diagnostic);
  assert.equal(viewportDiagnostic(bad.diagnostic, [first]), undefined);
  assert.equal(viewportDiagnostic(bad.diagnostic, [second]), undefined);
});

test('viewport excludes ordinary preview, syntax and evaluation failures', () => {
  const scope = [{id: 'current-sketch', evaluationId: 'current'}];
  const preview: ModelDiagnostic = {
    kind: 'evaluation',
    summary: '3D preview error',
  };
  const unowned: ModelDiagnostic = {kind: 'evaluation', summary: 'unowned'};
  const syntax: ModelDiagnostic = {
    kind: 'syntax',
    summary: 'Syntax error',
    sourceRef: {file: '/model.ts', start: 0, end: 10},
  };
  for (const diagnostic of [preview, unowned, syntax, undefined]) {
    assert.equal(viewportDiagnostic(diagnostic, scope), undefined);
    assert.equal(viewportDiagnostic(diagnostic, undefined), undefined);
  }
});

test('model-linked JavaScript failures do not opt into viewport cards', () => {
  const diagnostic: ModelDiagnostic = {
    kind: 'evaluation',
    summary: '__code3d.receiver(...).cut is not a function',
    relatedModelNodeIds: ['body'],
    relatedSketchIds: ['sketch'],
    failedEvaluationIds: ['call'],
  };
  assert.equal(viewportDiagnostic(diagnostic, undefined), undefined);
  assert.equal(viewportDiagnostic(diagnostic, [{id: 'sketch'}]), undefined);
});

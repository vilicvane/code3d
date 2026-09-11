import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestModelPipeline} from './project-test-files.ts';

let server,
  compiler,
  SketchEditResolver,
  analyzeSketchSource,
  viewportDiagnostic,
  sketchSourceDiagnostics;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
  ({SketchEditResolver, analyzeSketchSource} = await server.ssrLoadModule(
    '/src/tools/sketch-source.ts',
  ));
  ({viewportDiagnostic} = await server.ssrLoadModule(
    '/src/model/viewport-diagnostic.ts',
  ));
  ({sketchSourceDiagnostics} = await server.ssrLoadModule(
    '/src/tools/sketch-diagnostics.ts',
  ));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

const imports = "import {sketch} from '@code3d/core';\n";
const line = (length = 'size', x = '20') => `sketch(
  [['point', 1, [0, 0]], ['point', 2, [${x}, 0]], ['line', 3, [1, 2]]],
  {constraints: [['fixed', 1], ['horizontal', 3], ['length', 3, ${length}]]},
)`;
async function compile(source, files = []) {
  const result = await compiler.compile(
    {files: [{path: '/model.ts', source}, ...files]},
    '/model.ts',
  );
  assert.equal(result.diagnostic, undefined);
  return result;
}
function fix(source, action) {
  const result = new SketchEditResolver().resolve(action.intent, {
    toolId: 'diagnostic-fix',
    baseVersion: 1,
    resolveSourceRef: ref => ref,
    readSource: ref => source.slice(ref.start, ref.end),
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.plan.edits.length, 1);
  const edit = result.plan.edits[0];
  return (
    source.slice(0, edit.sourceRef.start) +
    edit.text +
    source.slice(edit.sourceRef.end)
  );
}

test('successful constraint solves warn at source and expose an atomic geometry-only repair', async () => {
  const source = imports + `const size = 30; const s = ${line()};`;
  const result = await compile(source);
  assert.equal(result.warnings.length, 1);
  const [warning] = result.warnings;
  assert.equal(warning.severity, 'warning');
  assert.equal(warning.sourceRef.file, '/model.ts');
  assert.equal(
    source.slice(warning.sourceRef.start, warning.sourceRef.end),
    "[['fixed', 1], ['horizontal', 3], ['length', 3, size]]",
  );
  const [sketch] = result.sketches.values();
  assert.deepEqual(warning.relatedSketchIds, [sketch.id]);
  assert.deepEqual(sketch.data[1].parameters, [20, 0]);
  assert.ok(Math.abs(sketch.entities[1].position[0] - 30) < 1e-8);
  const edited = fix(source, warning.actions[0]);
  assert.match(edited, /\['length', 3, size\]/);
  assert.match(edited, /\['fixed', 1\]/);
  assert.match(edited, /\['point', 1, \[0, 0\]\]/);
  const replay = await compile(edited);
  assert.deepEqual(replay.warnings, []);
  assert.deepEqual([...replay.sketches.values()][0].entities, sketch.entities);
  const stale = new SketchEditResolver().resolve(warning.actions[0].intent, {
    toolId: 'diagnostic-fix',
    baseVersion: 2,
    resolveSourceRef: ref => ref,
    readSource: ref => edited.slice(ref.start, ref.end),
  });
  assert.equal(stale.status, 'conflict');
});

test('expression-driven geometry warns without overwriting expressions', async () => {
  const source =
    imports +
    `const size = 30; const width = 20; const s = ${line('size', 'width')};`;
  const {warnings} = await compile(source);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].actions, undefined);
  assert.match(warnings[0].details, /expressions/);
});

test('computed tuple arrays still warn at the call without pretending to be source-editable', async () => {
  const source =
    imports +
    `const entries = [['point',1,[0,0]],['point',2,[20,0]],['line',3,[1,2]]];
const s = sketch(entries, {constraints: [['fixed',1],['horizontal',3],['length',3,30]]});`;
  const result = await compile(source);
  const [warning] = result.warnings;
  assert.equal(result.warnings.length, 1);
  assert.equal(warning.actions, undefined);
  assert.match(warning.details, /explicit/);
  assert.match(
    source.slice(warning.sourceRef.start, warning.sourceRef.end),
    /^sketch\(entries/,
  );
});

test('repeated definitions warn only for changed executions and cannot rewrite a shared input', async () => {
  const source =
    imports +
    `function make(size) { return ${line()}; }
const first = make(20); const second = make(30);`;
  const result = await compile(source);
  const [first, second] = result.sketches.values();
  const [warning] = result.warnings;
  assert.equal(result.warnings.length, 1);
  assert.equal(warning.actions, undefined);
  assert.match(warning.details, /more than once/);
  assert.deepEqual(warning.relatedSketchIds, [second.id]);
  assert.equal(viewportDiagnostic(warning, [first]), undefined);
  assert.equal(viewportDiagnostic(warning, [second]), warning);
});

test('warnings follow owning sketches and upstreams, never siblings or the 3D viewport', async () => {
  const source =
    imports +
    `const size = 30; const base = ${line()};
const child = base.derive([]); const sibling = sketch([]);`;
  const result = await compile(source);
  const [base, child, sibling] = result.sketches.values();
  const [warning] = result.warnings;
  assert.equal(viewportDiagnostic(warning, [base]), warning);
  assert.equal(viewportDiagnostic(warning, [base, child]), warning);
  assert.equal(viewportDiagnostic(warning, [sibling]), undefined);
  assert.equal(viewportDiagnostic(warning, undefined), undefined);
  const edited = fix(source, warning.actions[0]);
  assert.ok(
    edited.endsWith(
      'const child = base.derive([]); const sibling = sketch([]);',
    ),
  );
});

test('imported sketch warnings use the imported source file and radius data can be repaired', async () => {
  const source =
    imports +
    `const radius = 15; export const s = sketch(
    [['point', 1, [0, 0]], ['circle', 2, [1, 10]]],
    {constraints: [['radius', 2, radius]]},
  );`;
  const result = await compile("import {s} from './profile.ts'; s;", [
    {path: '/profile.ts', source},
  ]);
  const [warning] = result.warnings;
  assert.equal(warning.sourceRef.file, '/profile.ts');
  const edited = fix(source, warning.actions[0]);
  assert.match(edited, /\['radius', 2, radius\]/);
  const replay = await compile("import {s} from './profile.ts'; s;", [
    {path: '/profile.ts', source: edited},
  ]);
  assert.deepEqual(replay.warnings, []);
});

test('shared geometric tolerance ignores roundoff at different feature scales but not actual changes', () => {
  for (const scale of [1e-8, 1, 1e8]) {
    const source = `[['point',1,[0,0]],['point',2,[${scale},0]],['line',3,[1,2]],['point',4,[0,0]],['circle',5,[4,1e15]]]`;
    const sketch = {
      id: 'local',
      references: {},
      constraints: [],
      definitionRef: {file: '/model.ts', start: 0, end: source.length},
      callRef: {file: '/model.ts', start: 0, end: source.length},
      data: [
        {id: 1, parameters: [0, 0]},
        {id: 2, parameters: [scale, 0]},
        {id: 4, parameters: [0, 0]},
        {id: 5, parameters: [1e15]},
      ],
      entities: [
        {kind: 'point', id: 1, position: [0, 0]},
        {
          kind: 'point',
          id: 2,
          position: [scale + scale * 1e-11, scale * 1e-11],
        },
        {
          kind: 'line',
          id: 3,
          points: [
            {layer: 'local', id: 1},
            {layer: 'local', id: 2},
          ],
        },
        {kind: 'point', id: 4, position: [0, 0]},
        {kind: 'circle', id: 5, center: {layer: 'local', id: 4}, radius: 1e15},
      ],
    };
    const sketches = new Map([['local', sketch]]);
    const parsed = analyzeSketchSource(source);
    const sites = new Map([
      [
        `/model.ts:0:${source.length}`,
        {
          diagnostics: {
            sourceRef: sketch.definitionRef,
            source,
            editable: [...parsed.editable],
            reason: parsed.reason,
          },
        },
      ],
    ]);
    assert.deepEqual(sketchSourceDiagnostics(sketches, sites), []);
    sketch.entities[1].position = [scale * 1.01, 0];
    assert.equal(sketchSourceDiagnostics(sketches, sites).length, 1);
  }
});

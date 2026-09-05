import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';
import {createTestProjectCompiler} from './project-test-files.mjs';

let server,
  compiler,
  spatialBindings,
  spatialIntent,
  ToolEngine,
  offsetExpression;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({spatialBindings, spatialIntent} = await server.ssrLoadModule(
    '/src/tools/model-spatial-tool.ts',
  ));
  ({ToolEngine} = await server.ssrLoadModule('/src/tools/tool-system.ts'));
  ({offsetExpression} = await server.ssrLoadModule(
    '/src/tools/source-expression.ts',
  ));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

const near = (actual, expected) =>
  actual.forEach((x, i) =>
    assert.ok(Math.abs(x - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );

async function build(source, name) {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const target = module.sourceTargets.find(
    target =>
      (target.tool?.signature.name === name ||
        (target.operation?.kind === name &&
          target.kind === 'operation-output')) &&
      target.evaluations[0].operationId,
  );
  assert.ok(target, `No operation scope for ${name}`);
  const evaluation = target.evaluations[0];
  const node = module.objects.get(evaluation.nodeIds[0]);
  const occurrence = {key: 'source/0', node, placement: 'standalone'};
  const bindings = spatialBindings(
    module,
    {target, evaluation},
    occurrence,
    [occurrence],
    new Map(),
    new Map(),
  );
  return {module, target, evaluation, node, occurrence, bindings};
}

function hostFor(source) {
  const host = {
    sourceVersion: () => 1,
    resolveSourceRef: ref => ref,
    readSource: ref => source.slice(ref.start, ref.end),
    applySourceEdits: (_version, edits) => {
      for (const edit of [...edits].sort(
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
      return true;
    },
    applyPreview() {},
    commitPreview() {},
    clearPreview() {},
  };
  return {host, source: () => source};
}

test('originCenter without parameters displays its center and drags by appending an offset', async () => {
  const source =
    'import {box} from "@code3d/core"; const part = box(8, 6, 4).originVertex(3).rotate(0, 0, 90).originCenter();';
  const {node, target, evaluation, bindings, module} = await build(
    source,
    'originCenter',
  );
  assert.equal(target.tool, undefined);
  assert.equal(target.kind, 'operation-output');
  assert.equal(
    source.slice(target.sourceRef.start, target.sourceRef.end),
    'originCenter()',
  );
  assert.equal(bindings.length, 3);
  near(
    bindings[0].frame.position,
    node.elements.find(e => e.name === 'center').transform.position,
  );
  const {originSourceDecoration} = await server.ssrLoadModule(
    '/src/model/origin-decorations.ts',
  );
  near(
    originSourceDecoration.decorations({module, target, evaluation})[0]
      .transform.position,
    node.origin,
  );
  const intent = spatialIntent(bindings[0], 2);
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('center');
  assert.equal(session.preview(intent).status, 'ready');
  assert.equal(host.source(), source);
  assert.equal(session.commit(intent).status, 'committed');
  assert.match(host.source(), /originCenter\(\)\.originOffset\(2, 0, 0\)/);
  const {node: next} = await build(host.source(), 'originOffset');
  near(
    next.origin,
    node.origin.map((value, axis) => value + (axis === 0 ? 2 : 0)),
  );
  near([...next.mesh.topologyVertices], [...node.mesh.topologyVertices]);
});

test('originVertex exposes the output origin and retains its input for vertex selection', async () => {
  const source =
    'import {box} from "@code3d/core"; const part = box(8, 6, 4).originVertex(3);';
  const {node, target, evaluation, bindings} = await build(
    source,
    'originVertex',
  );
  assert.equal(target.kind, 'topology-selection');
  assert.notEqual(evaluation.selection.inputNodeId, node.nodeId);
  assert.deepEqual(evaluation.selection.ids, [3]);
  assert.equal(bindings.length, 3);
  near(bindings[0].frame.position, node.origin);
  const intent = spatialIntent(bindings[0], 2);
  const host = hostFor(source);
  const result = new ToolEngine(host.host).begin('origin-test').commit(intent);
  assert.equal(result.status, 'committed');
  assert.match(host.source(), /originVertex\(3\)\.originOffset\(2, 0, 0\)/);
  near(intent.preview.objects[0].spatial.origin, [
    node.origin[0] + 2,
    node.origin[1],
    node.origin[2],
  ]);
});

test('rotation edits an upstream angle and preview matches recomputed B-Rep vertices', async () => {
  const source =
    'import {box} from "@code3d/core"; const angle = 25; const part = box(8, 6, 4).origin(1, 2, 3).rotate(angle, 35, 10);';
  const {node, bindings} = await build(source, 'rotate');
  const binding = bindings.find(binding => binding.axis === 'x');
  assert.equal(binding.spatial.source.kind, 'parameter');
  const intent = spatialIntent(binding, 55);
  const host = hostFor(source);
  const engine = new ToolEngine(host.host);
  const session = engine.begin('rotation-test');
  assert.equal(session.preview(intent).status, 'ready');
  assert.equal(host.source(), source);
  assert.equal(session.commit(intent).status, 'committed');
  assert.match(host.source(), /const angle = 55/);
  const {node: next} = await build(host.source(), 'rotate');
  const {rotateVector} = await import('../../core/bld/tooling/index.js');
  const transform = intent.preview.objects[0].transform;
  const before = node.mesh.topologyVertices;
  const after = next.mesh.topologyVertices;
  for (let i = 0; i < before.length; i += 3) {
    const rotated = rotateVector(
      [...before.slice(i, i + 3)],
      transform.quaternion,
    ).map((x, axis) => x + transform.position[axis]);
    near(rotated, [...after.slice(i, i + 3)]);
  }
});

test('shared size and angle parameters keep the size expression while editing this angle', async () => {
  const source =
    'import {box} from "@code3d/core"; const size = 8; box(size, 6, 4).rotate(size, 35, 10);';
  const {bindings} = await build(source, 'rotate');
  const binding = bindings[0];
  assert.equal(binding.spatial.source.kind, 'argument');
  const host = hostFor(source);
  const result = new ToolEngine(host.host)
    .begin('angle')
    .commit(spatialIntent(binding, 18));
  assert.equal(result.status, 'committed');
  assert.match(host.source(), /const size = 8/);
  assert.match(host.source(), /rotate\(size \+ 10, 35, 10\)/);
});

test('originOffset drag accumulates on the selected offset and cancel preserves source', async () => {
  const source =
    'import {box} from "@code3d/core"; box(8, 6, 4).origin(1, 2, 3).originOffset(4, 0, 0);';
  const {node, bindings} = await build(source, 'originOffset');
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('offset');
  const intent = spatialIntent(bindings[0], 7);
  near(intent.preview.objects[0].spatial.origin, [8, 2, 3]);
  session.preview(intent);
  session.cancel();
  assert.equal(host.source(), source);
  near(node.origin, [5, 2, 3]);
});

test('numeric adjustment folds repeated deltas while preserving expressions', () => {
  assert.equal(offsetExpression('2', 3), '5');
  assert.equal(offsetExpression('Math.sin(t)', 3), 'Math.sin(t) + 3');
  assert.equal(offsetExpression('Math.sin(t) + 3', 4), 'Math.sin(t) + 7');
  assert.equal(offsetExpression('size - 5', 5), 'size');
  assert.equal(offsetExpression('size * 2', -3), 'size * 2 - 3');
});

test('origin offset editing reuses the outer call and retains authored comments', async () => {
  const {offsetCallSource} = await server.ssrLoadModule(
    '/src/tools/source-expression.ts',
  );
  const source = 'originCenter().originOffset(/* x */ (size + 2), 0, 0)';
  const changed = offsetCallSource(source, 'originOffset', [2, 0, 0]);
  assert.equal(
    changed,
    'originCenter().originOffset(/* x */ (size + 4), 0, 0)',
  );
  assert.equal(
    offsetCallSource(changed, 'originOffset', [-4, 0, 0]),
    'originCenter().originOffset(/* x */ (size), 0, 0)',
  );
});

import {Matrix4, Object3D, Quaternion, Vector3} from 'three';
import type {ViewportDecoration} from '../src/viewport-decoration.ts';
import type {ToolHost} from '../src/tools/tool-system.ts';
import {defined} from '../../../test/assert.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>,
  compiler: Awaited<ReturnType<typeof createTestProjectCompiler>>,
  spatialBindings: (typeof import('../src/tools/model-spatial-tool.ts'))['spatialBindings'],
  spatialIntent: (typeof import('../src/tools/model-spatial-tool.ts'))['spatialIntent'],
  ToolEngine: (typeof import('../src/tools/tool-system.ts'))['ToolEngine'],
  offsetExpression: (typeof import('../src/tools/source-expression.ts'))['offsetExpression'];
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
  ({spatialBindings, spatialIntent} = await server.ssrLoadModule<
    typeof import('../src/tools/model-spatial-tool.ts')
  >('/src/tools/model-spatial-tool.ts'));
  ({ToolEngine} = await server.ssrLoadModule<
    typeof import('../src/tools/tool-system.ts')
  >('/src/tools/tool-system.ts'));
  ({offsetExpression} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts'));
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((x, i) =>
    assert.ok(Math.abs(x - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );

test('a group axis includes its child geometry without model-unit padding', async () => {
  const source = `import {box,group,line} from '@code3d/core'; export default group([line([0,10,0],[0,20,0]), line([0,-4,0],[0,-3,0])]).expose({guide: box(1,1,1).axis});`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const node = defined(module.fallback);
  const {namedElementDecorations} = await server.ssrLoadModule<
    typeof import('../src/model/element-decorations.ts')
  >('/src/model/element-decorations.ts');
  const element = defined(
    node.elements.find(element => element.name === 'guide'),
  );
  const axis = namedElementDecorations(node, element).find(
    decoration => decoration.kind === 'anchor',
  );
  assert.ok(axis?.elementKind === 'line');
  near(
    [axis.span.negative, axis.span.positive],
    [4 + element.transform.position[1], 20 - element.transform.position[1]],
  );
});

async function build(source: string, name: string) {
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
  const node = defined(module.objects.get(evaluation.nodeIds[0]));
  const occurrence = {key: 'source/0', node, placement: 'standalone' as const};
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

function hostFor(source: string) {
  const host: ToolHost = {
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

for (const [call, operation, expected, value, axis = 'z'] of [
  ['rotate()', 'rotate', 'rotate(0, 0, 15)', 15],
  ['rotate()', 'rotate', 'rotate(15, 0, 0)', 15, 'x'],
  ['rotate()', 'rotate', 'rotate(0, 15, 0)', 15, 'y'],
  ['rotate(12, /* rest */)', 'rotate', 'rotate(15, /* rest */0, 0)', 15, 'x'],
  ['originOffset()', 'originOffset', 'originOffset(5, 0, 0)', 5, 'x'],
  ['rotate(12, /* next */)', 'rotate', 'rotate(12, /* next */0, 15)', 15],
  ['rotate(...angles)', 'rotate', 'rotate(20, 30, 15)', 15],
  ['rotate(20, 30, undefined)', 'rotate', 'rotate(20, 30, 15)', 15],
  ['originOffset()', 'originOffset', 'originOffset(0, 0, 5)', 5],
] as const) {
  test(`${call} exposes every axis and completes defaults on ${axis} commit`, async () => {
    const source = `import {box} from '@code3d/core'; const angles = [20, 30, 40] as const; box(8, 6, 4).${call};`;
    const {node, bindings} = await build(source, operation);
    assert.equal(bindings.length, 3);
    const binding = defined(bindings.find(binding => binding.axis === axis));
    const host = hostFor(source);
    const engine = new ToolEngine(host.host);
    const intent = spatialIntent(binding, value);
    const session = engine.begin('default-axis');
    assert.equal(session.preview(intent).status, 'ready');
    assert.equal(host.source(), source);
    session.cancel();
    assert.equal(host.source(), source);
    const unchanged = engine.resolve(
      'unchanged',
      spatialIntent(binding, binding.value),
    );
    assert.equal(unchanged.status, 'ready');
    if (unchanged.status === 'ready')
      assert.ok(
        unchanged.plan.edits.every(edit => edit.text === edit.expectedText),
      );
    assert.equal(
      engine.begin('default-axis').commit(intent).status,
      'committed',
    );
    assert.equal(host.source(), source.replace(call, expected));
    const {node: next} = await build(host.source(), operation);
    const {committedSpatialObject} = await server.ssrLoadModule<
      typeof import('../src/tools/spatial-edit.ts')
    >('/src/tools/spatial-edit.ts');
    const preview = committedSpatialObject(intent.preview.objects[0]);
    const transform = new Matrix4().compose(
      new Vector3(...preview.transform.position),
      new Quaternion(...preview.transform.quaternion),
      new Vector3(1, 1, 1),
    );
    const before = defined(node.mesh).topologyVertices;
    const after = defined(next.mesh).topologyVertices;
    for (let i = 0; i < before.length; i += 3)
      near(
        new Vector3().fromArray(before, i).applyMatrix4(transform).toArray(),
        [...after.slice(i, i + 3)],
      );
  });
}

for (const call of ['rotate()', 'originOffset()']) {
  test(`group ${call} exposes all default axes`, async () => {
    const {bindings} = await build(
      `import {box, group} from '@code3d/core'; group([box(8,6,4)]).${call};`,
      call.split('(')[0],
    );
    assert.equal(bindings.length, 3);
    assert.deepEqual(
      bindings.map(binding => binding.value),
      [0, 0, 0],
    );
  });
}

for (const operation of ['rotate', 'originOffset'] as const) {
  test(`materializing ${operation} inputs previews every execution of the call`, async () => {
    const source = `import {box, group} from '@code3d/core'; function part(i: number) {const coords = [i * 2, i * 3, i * 4] as const; return box(8, 6, 4).${operation}(...coords);} group([part(1), part(2)]);`;
    const result = await build(source, operation);
    const occurrences = result.target.evaluations.map((evaluation, index) => ({
      key: `part/${index}`,
      node: defined(result.module.objects.get(evaluation.nodeIds[0])),
      placement: 'standalone' as const,
    }));
    assert.equal(occurrences.length, 2);
    const bindings = spatialBindings(
      result.module,
      result,
      occurrences[0],
      occurrences,
      new Map(),
      new Map(),
    );
    const binding = defined(bindings.find(binding => binding.axis === 'z'));
    const unchanged = spatialIntent(binding, binding.value);
    for (const preview of unchanged.preview.objects) {
      near(preview.transform.position, [0, 0, 0]);
      near(preview.transform.quaternion, [0, 0, 0, 1]);
    }
    const intent = spatialIntent(binding, 9);
    assert.equal(intent.preview.objects.length, 2);
    const host = hostFor(source);
    assert.equal(
      new ToolEngine(host.host).begin('shared-call').commit(intent).status,
      'committed',
    );
    const next = await build(host.source(), operation);
    const {committedSpatialObject} = await server.ssrLoadModule<
      typeof import('../src/tools/spatial-edit.ts')
    >('/src/tools/spatial-edit.ts');
    for (const [index, occurrence] of occurrences.entries()) {
      const preview = committedSpatialObject(intent.preview.objects[index]);
      const transform = new Matrix4().compose(
        new Vector3(...preview.transform.position),
        new Quaternion(...preview.transform.quaternion),
        new Vector3(1, 1, 1),
      );
      const before = defined(occurrence.node.mesh).topologyVertices;
      const after = defined(
        defined(
          next.module.objects.get(next.target.evaluations[index].nodeIds[0]),
        ).mesh,
      ).topologyVertices;
      for (let i = 0; i < before.length; i += 3)
        near(
          new Vector3().fromArray(before, i).applyMatrix4(transform).toArray(),
          [...after.slice(i, i + 3)],
        );
    }
  });
}

test('incomplete relation offsets fill their existing call and preserve expressions', async () => {
  const {offsetCallSource} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts');
  assert.equal(
    offsetCallSource('self.on(base.up).offset()', 'offset', [0, 0, 5]),
    'self.on(base.up).offset(0, 0, 5)',
  );
  assert.equal(
    offsetCallSource(
      'self.on(base.up).offset(size, /* next */)',
      'offset',
      [0, 2, 0],
    ),
    'self.on(base.up).offset(size, /* next */2, 0)',
  );
  assert.equal(
    offsetCallSource('self.on(base.up).offset()', 'offset', [0, 0, 0]),
    'self.on(base.up).offset()',
  );
});

test('originCenter without parameters displays its center and drags by appending an offset', async () => {
  const source =
    'import {box} from "@code3d/core"; const part = box(8, 6, 4).originVertex(3).rotate(0, 0, 90).originCenter();';
  const {node, target, evaluation, bindings, module} = await build(
    source,
    'originCenter',
  );
  assert.equal(target.tool, undefined);
  assert.ok(target.kind === 'operation-output');
  assert.equal(
    source.slice(target.sourceRef.start, target.sourceRef.end),
    'originCenter()',
  );
  assert.equal(bindings.length, 3);
  near(
    bindings[0].frame.position,
    defined(defined(node).elements.find(e => e.name === 'center')).transform
      .position,
  );
  const {originSourceDecoration} = await server.ssrLoadModule<
    typeof import('../src/model/origin-decorations.ts')
  >('/src/model/origin-decorations.ts');
  near(
    anchorDecoration(
      originSourceDecoration.decorations({module, target, evaluation})[0],
    ).transform.position,
    defined(node).origin,
  );
  const intent = spatialIntent(bindings[0], 2);
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('center');
  assert.ok(session.preview(intent).status === 'ready');
  assert.equal(host.source(), source);
  assert.ok(session.commit(intent).status === 'committed');
  assert.match(host.source(), /originCenter\(\)\.originOffset\(2, 0, 0\)/);
  const {node: next} = await build(host.source(), 'originOffset');
  near(defined(next).origin, [0, 0, 0]);
  near(
    [...defined(defined(next).mesh).topologyVertices],
    [...defined(defined(node).mesh).topologyVertices].map(
      (v, i) => v - (i % 3 === 0 ? 2 : 0),
    ),
  );
});

test('originVertex exposes the output origin and retains its input for vertex selection', async () => {
  const source =
    'import {box} from "@code3d/core"; const part = box(8, 6, 4).originVertex(3);';
  const {node, target, evaluation, bindings} = await build(
    source,
    'originVertex',
  );
  assert.ok(target.kind === 'topology-selection');
  assert.notEqual(
    defined(evaluation.selection).inputNodeId,
    defined(node).nodeId,
  );
  assert.deepEqual(defined(evaluation.selection).ids, [3]);
  assert.equal(bindings.length, 3);
  near(bindings[0].frame.position, defined(node).origin);
  const intent = spatialIntent(bindings[0], 2);
  const host = hostFor(source);
  const result = new ToolEngine(host.host).begin('origin-test').commit(intent);
  assert.ok(result.status === 'committed');
  assert.match(host.source(), /originVertex\(3\)\.originOffset\(2, 0, 0\)/);
  near(intent.preview.objects[0].spatial.origin, [
    defined(node).origin[0] + 2,
    defined(node).origin[1],
    defined(node).origin[2],
  ]);
});

test('originVertex candidates map from input topology to the displayed result after earlier transforms', async () => {
  for (const prefix of [
    '',
    '.originOffset(5, -2, 3).rotate(15, 35, 10).scaled(2)',
  ]) {
    for (const id of [3, 6]) {
      const {module, node, evaluation} = await build(
        `import {box} from '@code3d/core'; box(8, 6, 4)${prefix}.originVertex(${id});`,
        'originVertex',
      );
      const selection = defined(evaluation.selection);
      const scope = defined(selection.scope);
      assert.equal(scope.geometryNodeId, selection.inputNodeId);
      const input = defined(
        defined(module.objects.get(scope.geometryNodeId)).mesh,
      );
      const output = defined(node.mesh);
      assert.deepEqual(scope.availableIds, input.vertexIds);
      assert.deepEqual(output.vertexIds, input.vertexIds);
      const transform = new Matrix4().compose(
        new Vector3(...scope.transform.position),
        new Quaternion(...scope.transform.quaternion),
        new Vector3(...scope.transform.scale),
      );
      input.vertexIds.forEach((vertexId, i) => {
        const candidate = new Vector3()
          .fromArray(input.topologyVertices, i * 3)
          .applyMatrix4(transform);
        const actual = new Vector3().fromArray(output.topologyVertices, i * 3);
        assert.ok(
          candidate.distanceTo(actual) < 1e-5,
          `V${vertexId} must stay on the output geometry`,
        );
        if (vertexId === id) near(actual.toArray(), [0, 0, 0]);
      });
    }
  }
});

for (const call of ['rotate(angle, 35, 10)', 'rotate(angle /* angle */)']) {
  test(`${call} edits the upstream angle, completes defaults and matches recomputed B-Rep vertices`, async () => {
    const source = `import {box} from "@code3d/core"; const angle = 25; const part = box(8, 6, 4).originOffset(1, 2, 3).${call};`;
    const {node, bindings} = await build(source, 'rotate');
    const binding = bindings.find(binding => binding.axis === 'x');
    assert.ok(defined(binding).spatial.source.kind === 'parameter');
    const intent = spatialIntent(defined(binding), 55);
    const host = hostFor(source);
    const engine = new ToolEngine(host.host);
    const session = engine.begin('rotation-test');
    assert.ok(session.preview(intent).status === 'ready');
    assert.equal(host.source(), source);
    assert.ok(session.commit(intent).status === 'committed');
    assert.equal(
      host.source(),
      source
        .replace('const angle = 25', 'const angle = 55')
        .replace(
          'rotate(angle /* angle */)',
          'rotate(angle /* angle */, 0, 0)',
        ),
    );
    const {node: next} = await build(host.source(), 'rotate');
    const {rotateVector} = await import('../../core/bld/tooling/index.js');
    const transform = intent.preview.objects[0].transform;
    const before = defined(defined(node).mesh).topologyVertices;
    const after = defined(defined(next).mesh).topologyVertices;
    for (let i = 0; i < before.length; i += 3) {
      const rotated = rotateVector(
        [before[i], before[i + 1], before[i + 2]],
        transform.quaternion,
      ).map((x, axis) => x + transform.position[axis]);
      near(rotated, [...after.slice(i, i + 3)]);
    }
  });
}

test('shared size and angle parameters keep the size expression while editing this angle', async () => {
  const source =
    'import {box} from "@code3d/core"; const size = 8; box(size, 6, 4).rotate(size, 35, 10);';
  const {bindings} = await build(source, 'rotate');
  const binding = bindings[0];
  assert.ok(binding.spatial.source.kind === 'argument');
  const host = hostFor(source);
  const result = new ToolEngine(host.host)
    .begin('angle')
    .commit(spatialIntent(binding, 18));
  assert.ok(result.status === 'committed');
  assert.match(host.source(), /const size = 8/);
  assert.match(host.source(), /rotate\(size \+ 10, 35, 10\)/);
});

test('group rotation tools preview the same assembly poses as committed XYZ angle edits', async () => {
  const source = `import {box, group} from '@code3d/core';
const base = box(10, 10, 10);
const cap = box(2, 2, 2).relate(self => self.on(base.up));
const angle = 25;
export default group([base, cap]).originPoint(cap.center).rotate(angle, 35, 10);`;
  const {node, bindings} = await build(source, 'rotate');
  assert.equal(bindings.length, 3);
  const binding = defined(bindings.find(binding => binding.axis === 'x'));
  assert.equal(binding.spatial.source.kind, 'parameter');
  const intent = spatialIntent(binding, 55);
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('group-rotation');
  assert.equal(session.preview(intent).status, 'ready');
  assert.equal(host.source(), source);
  assert.equal(session.commit(intent).status, 'committed');
  assert.match(host.source(), /const angle = 55/);
  const {node: next} = await build(host.source(), 'rotate');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  for (let i = 0; i < node.children.length; i++) {
    const expected = composeTransforms(
      intent.preview.objects[0].transform,
      node.children[i].transform,
    );
    near(next.children[i].transform.position, expected.position);
    near(next.children[i].transform.quaternion, expected.quaternion);
    assert.deepEqual(next.children[i].mesh, node.children[i].mesh);
  }
  near(next.origin, [0, 0, 0]);
});

test('originOffset drag accumulates on the selected offset and cancel preserves source', async () => {
  const source =
    'import {box} from "@code3d/core"; box(8, 6, 4).originVertex(3).originOffset(4, 0, 0);';
  const {node, bindings} = await build(source, 'originOffset');
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('offset');
  const intent = spatialIntent(bindings[0], 7);
  near(intent.preview.objects[0].spatial.origin, [3, 0, 0]);
  session.preview(intent);
  session.cancel();
  assert.equal(host.source(), source);
  near(defined(node).origin, [0, 0, 0]);
});

test('numeric adjustment folds repeated deltas while preserving expressions', () => {
  assert.equal(offsetExpression('2', 3), '5');
  assert.equal(offsetExpression('Math.sin(t)', 3), 'Math.sin(t) + 3');
  assert.equal(offsetExpression('Math.sin(t) + 3', 4), 'Math.sin(t) + 7');
  assert.equal(offsetExpression('size - 5', 5), 'size');
  assert.equal(offsetExpression('size * 2', -3), 'size * 2 - 3');
});

test('origin offset editing reuses the outer call and retains authored comments', async () => {
  const {offsetCallSource} = await server.ssrLoadModule<
    typeof import('../src/tools/source-expression.ts')
  >('/src/tools/source-expression.ts');
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

async function relationTool(source: string, name: string) {
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined, JSON.stringify(module.diagnostic));
  const target = module.sourceTargets.find(
    target =>
      target.kind === 'constraint' &&
      (target.tool?.signature.name === name ||
        target.evaluations[0].constraintSpatial?.kind === name) &&
      target.evaluations[0].constraintSpatial,
  );
  assert.ok(target, `No relation tool for ${name}`);
  const evaluation = target.evaluations[0];
  const node = {
    ...defined(
      module.objects.get(defined(evaluation.constraintSpatial).nodeId),
    ),
    ...evaluation.constraintPreview,
  };
  const occurrence = {
    key: 'source/self',
    node,
    placement: 'composition' as const,
  };
  const bindings = spatialBindings(
    module,
    {target, evaluation},
    occurrence,
    [occurrence],
    new Map(),
    new Map(),
  );
  return {module, target, evaluation, node, bindings};
}

for (const [chain, name, expected, axis = 'z'] of [
  [
    'pivot().rotate(25, 35, 10)',
    'pivot',
    'pivot([0, 0, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot([2]).rotate(25, 35, 10)',
    'pivot',
    'pivot([2, 0, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot(coords).rotate(25, 35, 10)',
    'pivot',
    'pivot([2, 3, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot([...coords]).rotate(25, 35, 10)',
    'pivot',
    'pivot([2, 3, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot(undefined).rotate(25, 35, 10)',
    'pivot',
    'pivot([0, 0, 7]).rotate(25, 35, 10)',
  ],
  [
    'pivot().rotate(25, 35, 10)',
    'pivot',
    'pivot([7, 0, 0]).rotate(25, 35, 10)',
    'x',
  ],
  [
    'pivot([2, /* rest */]).rotate(25, 35, 10)',
    'pivot',
    'pivot([7, /* rest */0, 0]).rotate(25, 35, 10)',
    'x',
  ],
  [
    'pivot([, 2]).rotate(25, 35, 10)',
    'pivot',
    'pivot([0, 7, 0]).rotate(25, 35, 10)',
    'y',
  ],
  ['rotate()', 'rotate', 'rotate(7, 0, 0)', 'x'],
  ['rotate()', 'rotate', 'rotate(0, 0, 7)'],
  ['around(base.axis).rotate()', 'rotate', 'around(base.axis).rotate(7)'],
] as const) {
  test(`relation ${chain} provides ${axis} tools from its rendered pose`, async () => {
    const source = `import {box} from '@code3d/core'; const coords = [2, 3, 4] as const; const base = box(20, 10, 30); box(8, 6, 4).relate(self => self.on(base.up).${chain});`;
    const {node, bindings} = await relationTool(source, name);
    assert.equal(bindings.length, chain.startsWith('around') ? 1 : 3);
    const binding = defined(
      bindings.find(
        binding => binding.axis === (chain.startsWith('around') ? 'y' : axis),
      ),
    );
    const intent = spatialIntent(binding, 7);
    const host = hostFor(source);
    const engine = new ToolEngine(host.host);
    const session = engine.begin('rendered-pivot');
    assert.equal(session.preview(intent).status, 'ready');
    session.cancel();
    assert.equal(host.source(), source);
    assert.equal(
      engine.begin('rendered-pivot').commit(intent).status,
      'committed',
    );
    assert.equal(host.source(), source.replace(chain, expected));
    const {node: next} = await relationTool(host.source(), name);
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    const preview = composeTransforms(
      node.compositionTransform,
      intent.preview.objects[0].transform,
    );
    near(preview.position, next.compositionTransform.position);
    near(preview.quaternion, next.compositionTransform.quaternion);
  });
}

for (const reverse of [false, true] as const) {
  test(`relation rotation previews and edits self with ${reverse ? 'reversed' : 'forward'} on syntax`, async () => {
    const source = `import {box} from '@code3d/core'; const angle = 25; const base = box(20, 10, 30); const part = box(8, 6, 4).relate(self => ${reverse ? 'base.on(self.up)' : 'self.on(base.up)'}.pivot([1, 2, 3]).rotate(angle, 35, 10));`;
    const {node, bindings, evaluation} = await relationTool(source, 'rotate');
    assert.equal(bindings.length, 3);
    assert.equal(evaluation.constraintOwnerNodeId, defined(node).nodeId);
    const binding = bindings[0];
    assert.ok(binding.spatial.source.kind === 'parameter');
    const intent = spatialIntent(binding, 55);
    const host = hostFor(source);
    const session = new ToolEngine(host.host).begin('relation-rotate');
    assert.ok(session.preview(intent).status === 'ready');
    session.cancel();
    assert.equal(host.source(), source);
    assert.equal(
      new ToolEngine(host.host).begin('relation-rotate').commit(intent).status,
      'committed',
    );
    const {node: next} = await relationTool(host.source(), 'rotate');
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    const preview = composeTransforms(
      defined(node).compositionTransform,
      intent.preview.objects[0].transform,
    );
    near(preview.position, defined(next).compositionTransform.position);
    near(preview.quaternion, defined(next).compositionTransform.quaternion);
    assert.deepEqual(
      defined(defined(node).mesh).topologyVertices,
      defined(defined(next).mesh).topologyVertices,
    );
  });
}

test('pivot coordinates have an independent drag and preserve the local frame', async () => {
  const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const part = box(8, 6, 4).originOffset(1, 2, 3).rotate(10, 20, 30).relate(self => self.on(base.up).pivot([5, 0, 0]).rotate(25, 35, 10));`;
  const {node, bindings} = await relationTool(source, 'pivot');
  assert.equal(bindings.length, 3);
  const intent = spatialIntent(bindings[0], 8);
  const host = hostFor(source);
  assert.equal(
    new ToolEngine(host.host).begin('pivot').commit(intent).status,
    'committed',
  );
  assert.match(host.source(), /pivot\(\[8, 0, 0\]\)/);
  const {node: next} = await relationTool(host.source(), 'pivot');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  const preview = composeTransforms(
    defined(node).compositionTransform,
    intent.preview.objects[0].transform,
  );
  near(preview.position, defined(next).compositionTransform.position);
  near(preview.quaternion, defined(next).compositionTransform.quaternion);
});

for (const [geometry, id] of [
  ['box(8, 6, 4)', 3],
  ['box(8, 6, 4).shell(1)', [1, 3]],
] as const) {
  test(`pivotVertex selects self topology ${JSON.stringify(id)} when self is the target of on`, async () => {
    const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const part = ${geometry}.relate(self => base.on(self.up).pivotVertex(${JSON.stringify(id)}).rotate(0, 0, 45));`;
    const {module, node, target, evaluation, bindings} = await relationTool(
      source,
      'pivotVertex',
    );
    assert.equal(bindings.length, 0);
    const selection = module.sourceTargets.find(
      target =>
        target.kind === 'topology-selection' &&
        target.tool?.signature.name === 'pivotVertex',
    );
    assert.equal(
      defined(defined(selection).evaluations[0].selection).inputNodeId,
      defined(node).nodeId,
    );
    assert.deepEqual(defined(defined(selection).evaluations[0].selection).ids, [
      id,
    ]);
    const {originSourceDecoration} = await server.ssrLoadModule<
      typeof import('../src/model/origin-decorations.ts')
    >('/src/model/origin-decorations.ts');
    const markers = originSourceDecoration.decorations({
      module,
      target,
      evaluation,
    });
    assert.equal(anchorDecoration(markers[0]).elementKind, 'point');
  });
}

test('around exposes a positioned axis and a single angle ring', async () => {
  const source = `import {box, point} from '@code3d/core'; const base = box(20, 10, 30); const axis = box(2, 2, 2).relate(self => self.center.on(point([10, 20, 30]).up).offset(0, 0, 0)); const part = box(8, 6, 4).relate(self => self.on(base.up).around(axis.axis).rotate(25).pivot([2, 3, 4]).rotate(10, 20, 30).offset(7, 0, 0));`;
  const {node, bindings} = await relationTool(source, 'rotate');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].axis, 'y');
  const intent = spatialIntent(bindings[0], 55);
  const host = hostFor(source);
  new ToolEngine(host.host).begin('around').commit(intent);
  assert.match(host.source(), /\.rotate\(55\)/);
  const {node: next} = await relationTool(host.source(), 'rotate');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  const preview = composeTransforms(
    defined(node).compositionTransform,
    intent.preview.objects[0].transform,
  );
  near(preview.position, defined(next).compositionTransform.position);
  near(preview.quaternion, defined(next).compositionTransform.quaternion);
  const {
    module,
    target,
    evaluation,
    bindings: axisBindings,
  } = await relationTool(source, 'around');
  assert.equal(axisBindings.length, 0);
  const {originSourceDecoration} = await server.ssrLoadModule<
    typeof import('../src/model/origin-decorations.ts')
  >('/src/model/origin-decorations.ts');
  assert.equal(
    anchorDecoration(
      originSourceDecoration.decorations({module, target, evaluation})[0],
    ).elementKind,
    'line',
  );
});

for (const reverse of [false, true] as const) {
  test(`align rotation edits self and preserves preview consistency with ${reverse ? 'reversed' : 'forward'} source`, async () => {
    const source = `import {box, point} from '@code3d/core'; const base = point([20, 10, 30]); const part = box(8, 6, 4).relate(self => ${reverse ? 'base.align(self.center)' : 'self.center.align(base)'}.offset(2, 3, 4).pivot([1, 2, 3]).rotate(25, 35, 10).around(box(1, 1, 1).axis).rotate(45).offset(7, 0, 0));`;
    const {node, bindings} = await relationTool(source, 'rotate');
    const intent = spatialIntent(bindings[0], 55),
      host = hostFor(source);
    const cancelled = new ToolEngine(host.host).begin('align-rotate');
    cancelled.preview(intent);
    cancelled.cancel();
    assert.equal(host.source(), source);
    new ToolEngine(host.host).begin('align-rotate').commit(intent);
    const {node: next} = await relationTool(host.source(), 'rotate');
    const {composeTransforms} = await import('../../core/bld/tooling/index.js');
    const preview = composeTransforms(
      defined(node).compositionTransform,
      intent.preview.objects[0].transform,
    );
    near(preview.position, defined(next).compositionTransform.position);
    near(preview.quaternion, defined(next).compositionTransform.quaternion);
  });
}

test('a reversed around axis previews the authored signed angle', async () => {
  const source = `import {box, point} from '@code3d/core'; const base=point([20,10,30]); const axis=box(1,1,1).axis.reverse(); const part=box(8,6,4).relate(self=>self.center.align(base).around(axis).rotate(25));`;
  const {node, bindings} = await relationTool(source, 'rotate');
  assert.equal(bindings.length, 1);
  const intent = spatialIntent(bindings[0], 55),
    host = hostFor(source);
  new ToolEngine(host.host).begin('reverse-axis').commit(intent);
  const {node: next} = await relationTool(host.source(), 'rotate');
  const {composeTransforms} = await import('../../core/bld/tooling/index.js');
  const preview = composeTransforms(
    defined(node).compositionTransform,
    intent.preview.objects[0].transform,
  );
  near(preview.position, defined(next).compositionTransform.position);
  near(preview.quaternion, defined(next).compositionTransform.quaternion);
});

test('a bound selection renders each computed plane once across named and relation previews', async () => {
  const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const part = box(8, 6, 4).rotate(0, 0, 30).relate(self => self.on(base.up));`;
  const module = await compiler.compile(
    {files: [{path: '/model.ts', source}]},
    '/model.ts',
  );
  assert.equal(module.diagnostic, undefined);
  const target = module.sourceTargets.find(
    target =>
      target.kind === 'element' &&
      source.slice(target.sourceRef.start, target.sourceRef.end) === 'up',
  );
  assert.ok(defined(defined(target).evaluations[0].element).bound);
  const {elementSourceDecoration, relationSourceDecoration} =
    await server.ssrLoadModule<
      typeof import('../src/model/element-decorations.ts')
    >('/src/model/element-decorations.ts');
  assert.ok(target);
  const scope = {module, target, evaluation: defined(target).evaluations[0]};
  const named = elementSourceDecoration.decorations(scope);
  assert.equal(named.length, 0);
  const contacts = relationSourceDecoration.decorations(scope);
  const targetMesh = contacts.find(
    decoration =>
      decoration.kind === 'surface' && decoration.id.includes(':target:'),
  );
  assert.ok(targetMesh?.kind === 'surface');
  assert.equal(targetMesh.mesh.vertices.length, 12);
  assert.deepEqual(targetMesh.mesh.surfaceGroups, []);
  const combined = [...named, ...contacts];
  assert.equal(new Set(combined.map(item => item.id)).size, combined.length);
  assert.equal(
    combined.filter(decoration => decoration.kind === 'surface').length,
    2,
  );
  const relationTarget = module.sourceTargets.find(
    target =>
      target.kind === 'constraint' && target.evaluations[0].constraintId,
  );
  const relation = relationSourceDecoration.decorations({
    module,
    target: defined(relationTarget),
    evaluation: defined(relationTarget).evaluations[0],
  });
  assert.equal(relation.filter(item => item.kind === 'surface').length, 2);
  const bounds = relation.filter(item => item.kind === 'bounds');
  assert.equal(bounds.length, 1);
  near(bounds[0].size, [
    8 * Math.cos(Math.PI / 6) + 6 * Math.sin(Math.PI / 6),
    8 * Math.sin(Math.PI / 6) + 6 * Math.cos(Math.PI / 6),
    4,
  ]);
  const sourcePlane = relation.find(
    item => item.kind === 'surface' && item.nodeId === bounds[0].nodeId,
  );
  assert.ok(sourcePlane);
  assert.equal(sourcePlane.appearance.color, bounds[0].appearance.color);
});

for (const [call, kind] of [
  ['pivot([5, 0, 0])', 'point'],
  ['around(axis.axis)', 'line'],
] as const) {
  test(`an unfinished ${call} retains a source reference and visible marker`, async () => {
    const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const axis = box(2, 2, 2); const part = box(8, 6, 4).relate(self => self.on(base.up).${call});`;
    const module = await compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
    );
    assert.match(defined(module.diagnostic).summary, /completed Constraint/);
    const target = module.sourceTargets.find(
      target =>
        target.kind === 'constraint' &&
        target.evaluations[0].constraintSpatial?.kind === call.split('(')[0],
    );
    assert.ok(target);
    const evaluation = target.evaluations[0];
    const {originSourceDecoration} = await server.ssrLoadModule<
      typeof import('../src/model/origin-decorations.ts')
    >('/src/model/origin-decorations.ts');
    const markers = originSourceDecoration.decorations({
      module,
      target,
      evaluation,
    });
    assert.equal(anchorDecoration(markers[0]).elementKind, kind);
    assert.equal(markers[0].nodeId, evaluation.constraintOwnerNodeId);
  });
}

test('completing an upstream offset preserves preceding displacements', async () => {
  const source = `import {box} from '@code3d/core';
const amount = 2;
const base = box(20, 10, 30);
box(8, 6, 4).relate(self => self.on(base.up).offset(0, 3, 4).offset(amount /* x */));`;
  const compile = (source: string) =>
    compiler.compile({files: [{path: '/model.ts', source}]}, '/model.ts');
  const module = await compile(source);
  assert.equal(module.diagnostic, undefined);
  const node = defined(module.fallback);
  const occurrence = {
    object: new Object3D(),
    depth: 0,
    view: 'source' as const,
    node,
    key: 'part',
    placement: 'composition' as const,
  };
  const {positionBindings} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    );
  const binding = defined(
    positionBindings(occurrence, [occurrence], null).find(
      binding => binding.axis === 'x',
    ),
  );
  assert.equal(binding.kind, 'parameter');
  if (binding.kind !== 'parameter') return;
  const host = hostFor(source);
  const result = new ToolEngine(host.host).begin('offset').commit({
    kind: 'parameter.set',
    target: binding.target,
    value: 7,
    completeArguments: binding.completeArguments,
  });
  assert.equal(result.status, 'committed');
  assert.equal(
    host.source(),
    source
      .replace('const amount = 2', 'const amount = 7')
      .replace('offset(amount /* x */)', 'offset(amount /* x */, 0, 0)'),
  );
  const next = await compile(host.source());
  assert.equal(next.diagnostic, undefined);
  assert.deepEqual(
    defined(next.fallback).constraints.at(-1)?.offset,
    [7, 3, 4],
  );
});

test('a constraint expression previews its own chain before sibling constraints are committed', async () => {
  const source = `import {box} from '@code3d/core'; const base=box(20,10,20); const part=box(2,2,2).relate(self=>[self.axis.align(base.axis).rotate(0,25,0),self.on(base.up)]);`;
  const {bindings, target} = await relationTool(source, 'rotate');
  assert.equal(bindings.length, 3);
  assert.equal(defined(target.tool).signature.name, 'rotate');
  const {positionBindings} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    );
  const {module, node, evaluation} = await relationTool(source, 'rotate');
  const occurrence = {
    object: new Object3D(),
    depth: 0,
    view: 'source' as const,
    node,
    key: 'coupled',
    placement: 'composition' as const,
  };
  assert.equal(node.constraints.length, 1);
  const final = defined(module.objects.get(node.nodeId));
  assert.equal(final.constraints.length, 2);
  const finalOccurrence = {...occurrence, node: final};
  assert.deepEqual(
    positionBindings(
      finalOccurrence,
      [finalOccurrence],
      defined(evaluation.constraintId),
    ),
    [],
  );
  const changed = source.replace('25', '55');
  const {node: next} = await relationTool(changed, 'rotate');
  near(
    defined(next).compositionTransform.position,
    defined(node).compositionTransform.position,
  );
  assert.notDeepEqual(
    defined(next).compositionTransform.quaternion,
    defined(node).compositionTransform.quaternion,
  );
  assert.equal(module.diagnostic, undefined);
});

function anchorDecoration(decoration: ViewportDecoration) {
  assert.ok(decoration.kind === 'anchor');
  return decoration;
}

test('origin drag uses its initial snapshot and switches to result coordinates on commit', async () => {
  const source = `import {point} from '@code3d/core'; point([10, 20, 30]).originOffset(2, 3, 4);`;
  const {node, bindings} = await build(source, 'originOffset');
  const {committedSpatialObject} = await server.ssrLoadModule<
    typeof import('../src/tools/spatial-edit.ts')
  >('/src/tools/spatial-edit.ts');
  const binding = defined(bindings.find(binding => binding.axis === 'x'));
  const host = hostFor(source);
  const session = new ToolEngine(host.host).begin('origin-snapshot');
  const first = spatialIntent(binding, 5);
  const second = spatialIntent(binding, 7);
  session.preview(first);
  session.preview(second);
  near(first.preview.objects[0].spatial.origin, [3, 0, 0]);
  near(second.preview.objects[0].spatial.origin, [5, 0, 0]);
  near(second.preview.objects[0].transform.position, [0, 0, 0]);
  near([...defined(defined(node).mesh).topologyVertices], [8, 17, 26]);
  session.cancel();
  assert.equal(host.source(), source);
  const result = new ToolEngine(host.host)
    .begin('origin-commit')
    .commit(second);
  assert.equal(result.status, 'committed');
  const committed = committedSpatialObject(second.preview.objects[0]);
  near(committed.spatial.origin, [0, 0, 0]);
  near(committed.transform.position, [-5, 0, 0]);
  const {node: next} = await build(host.source(), 'originOffset');
  near([...defined(defined(next).mesh).topologyVertices], [3, 17, 26]);
  near(defined(next).origin, [0, 0, 0]);
});

test('originPoint on geometry and groups appends an offset and preserves point references through preview and commit', async () => {
  for (const expression of [
    'base.originPoint(base.vertex(3))',
    'group([base, cap]).originPoint(cap.center)',
  ]) {
    const source = `import {box, group} from '@code3d/core';
const base = box(10, 10, 10);
const cap = box(2, 2, 2).relate(self => self.on(base.up));
export default ${expression};`;
    const {node, bindings} = await build(source, 'originPoint');
    assert.equal(bindings.length, 3);
    near(bindings[0].frame.position, [0, 0, 0]);
    const intent = spatialIntent(bindings[0], 2);
    const host = hostFor(source);
    const session = new ToolEngine(host.host).begin('point-origin');
    assert.equal(session.preview(intent).status, 'ready');
    assert.equal(host.source(), source);
    near(intent.preview.objects[0].transform.position, [0, 0, 0]);
    assert.equal(session.commit(intent).status, 'committed');
    assert.ok(host.source().includes(`${expression}.originOffset(2, 0, 0)`));
    const {node: next} = await build(host.source(), 'originOffset');
    near(next.origin, [0, 0, 0]);
    if (node.kind === 'group') {
      for (let i = 0; i < node.children.length; i++)
        near(
          next.children[i].transform.position,
          node.children[i].transform.position.map(
            (v, axis) => v - (axis === 0 ? 2 : 0),
          ),
        );
    } else {
      near(
        [...defined(next.mesh).topologyVertices],
        [...defined(node.mesh).topologyVertices].map(
          (v, i) => v - (i % 3 === 0 ? 2 : 0),
        ),
      );
    }
  }
});

import {Object3D} from 'three';
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
  near(
    defined(next).origin,
    defined(node).origin.map((value, axis) => value + (axis === 0 ? 2 : 0)),
  );
  near(
    [...defined(defined(next).mesh).topologyVertices],
    [...defined(defined(node).mesh).topologyVertices],
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

test('rotation edits an upstream angle and preview matches recomputed B-Rep vertices', async () => {
  const source =
    'import {box} from "@code3d/core"; const angle = 25; const part = box(8, 6, 4).origin(1, 2, 3).rotate(angle, 35, 10);';
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
  assert.match(host.source(), /const angle = 55/);
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
  near(defined(node).origin, [5, 2, 3]);
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

for (const reverse of [false, true] as const) {
  test(`relation rotation previews and edits self with ${reverse ? 'reversed' : 'forward'} on syntax`, async () => {
    const source = `import {box} from '@code3d/core'; const angle = 25; const base = box(20, 10, 30); const part = box(8, 6, 4).relate(self => ${reverse ? 'base.on(self.up)' : 'self.on(base.up)'}.pivot(1, 2, 3).rotate(angle, 35, 10));`;
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
  const source = `import {box} from '@code3d/core'; const base = box(20, 10, 30); const part = box(8, 6, 4).origin(1, 2, 3).rotate(10, 20, 30).relate(self => self.on(base.up).pivot(5, 0, 0).rotate(25, 35, 10));`;
  const {node, bindings} = await relationTool(source, 'pivot');
  assert.equal(bindings.length, 3);
  const intent = spatialIntent(bindings[0], 8);
  const host = hostFor(source);
  assert.equal(
    new ToolEngine(host.host).begin('pivot').commit(intent).status,
    'committed',
  );
  assert.match(host.source(), /pivot\(8, 0, 0\)/);
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
  const source = `import {box, point} from '@code3d/core'; const base = box(20, 10, 30); const axis = box(2, 2, 2).relate(self => self.center.on(point([10, 20, 30]).up).offset(0, 0, 0)); const part = box(8, 6, 4).relate(self => self.on(base.up).around(axis.axis).rotate(25).pivot(2, 3, 4).rotate(10, 20, 30).offset(7, 0, 0));`;
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
    const source = `import {box, point} from '@code3d/core'; const base = point([20, 10, 30]); const part = box(8, 6, 4).relate(self => ${reverse ? 'base.align(self.center)' : 'self.center.align(base)'}.offset(2, 3, 4).pivot(1, 2, 3).rotate(25, 35, 10).around(box(1, 1, 1).axis).rotate(45).offset(7, 0, 0));`;
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
  ['pivot(5, 0, 0)', 'point'],
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

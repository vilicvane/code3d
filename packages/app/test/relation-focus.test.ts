import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {defined} from '../../../test/assert.ts';
import type {ModelModule} from '../src/model/compiler.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestModelPipeline>>;
let ModelViewport: typeof import('../src/viewport.ts').ModelViewport;
let decorations: typeof import('../src/model/element-decorations.ts');
let context: typeof import('../src/model/constraint-context.ts');
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
  ({ModelViewport} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    ));
  decorations = await server.ssrLoadModule<typeof decorations>(
    '/src/model/element-decorations.ts',
  );
  context = await server.ssrLoadModule<typeof context>(
    '/src/model/constraint-context.ts',
  );
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

async function compile(source: string) {
  const module = await compiler.compile(
    {files: [{path: '/main.ts', source}]},
    '/main.ts',
  );
  assert.equal(module.diagnostic, undefined);
  return module;
}

function at(module: ModelModule, source: string, token: string) {
  assert.ok(source.includes(token), token);
  const target = defined(
    ModelViewport.prototype['sourceTargetAt'].call(
      {module},
      '/main.ts',
      source.indexOf(token) + 1,
    ),
  );
  const evaluation = target.evaluations[0];
  const constraint = context.evaluatedConstraint(module.objects, evaluation)!;
  return {module, target, evaluation, constraint};
}

for (const method of ['on', 'align'] as const) {
  for (const reverse of [false, true]) {
    test(`${method} ${reverse ? 'reverse' : 'forward'} scopes focus the argument and return to self along the chain`, async () => {
      const receiver = reverse
        ? method === 'on'
          ? 'base'
          : 'base.axis'
        : method === 'on'
          ? 'self'
          : 'self.axis';
      const argument = `${reverse ? 'self' : 'base'}.${method === 'on' ? 'up.flip()' : 'axis.reverse()'}`;
      const source = `import {box, group, offset, axisLine} from '@code3d/core';
        const base = box(20,10,30); const axis = box(2,2,2);
        const part = box(8,6,4).relate(self => [${receiver}.${method}(
          /* target-start */ ${argument} /* target-end */
        ), offset(1,2,3), axisLine(axis.axis).rotate(20)]); export default group([base,part]);`;
      const module = await compile(source);
      for (const token of [
        `${method}(`,
        'offset(',
        '1,2,3',
        'axisLine(',
        'axis.axis',
        'rotate(',
        '20)',
      ]) {
        const scope = at(module, source, token);
        assert.deepEqual(
          scope.evaluation.focusNodeIds,
          [scope.evaluation.relationOwnerNodeId],
          token,
        );
        if (scope.evaluation.transformationId) {
          assert.equal(scope.constraint, undefined, token);
          assert.equal(scope.evaluation.constraintFocus, undefined, token);
        } else {
          assert.equal(scope.evaluation.constraintFocus, 'self', token);
          assert.equal(
            context.focusedConstraintSide(scope.evaluation, scope.constraint),
            reverse ? 'target' : 'source',
            token,
          );
        }
      }
      for (const token of [
        '/* target-start */',
        argument,
        method === 'on' ? 'flip()' : 'reverse()',
        '/* target-end */',
      ]) {
        const scope = at(module, source, token);
        assert.equal(scope.evaluation.constraintFocus, 'target', token);
        assert.deepEqual(
          scope.evaluation.focusNodeIds,
          [scope.constraint.target.nodeId],
          token,
        );
      }
      const axisScope = at(module, source, 'axis.axis');
      assert.equal(axisScope.evaluation.relationSpatial?.kind, 'rotate');
      assert.equal(
        axisScope.target.id,
        at(module, source, 'rotate(').target.id,
      );
    });
  }
}

test('relate distinguishes the new self from its original receiver alias in source focus', async () => {
  const source = `import {box, group, offset} from '@code3d/core';
    const side = box(2, 250, 250);
    const leftSide = side;
    const rightSide = side.relate(self => [
      self.on(leftSide.right), offset(160, 0, 0)
    ]);
    export default group([leftSide, rightSide]);`;
  const module = await compile(source);
  const own = at(module, source, 'on(');
  const other = at(module, source, 'leftSide.right');
  const selfId = own.constraint.source.nodeId;
  const originalId = own.constraint.target.nodeId;
  assert.notEqual(selfId, originalId);
  assert.deepEqual(own.evaluation.focusNodeIds, [selfId]);
  assert.deepEqual(other.evaluation.focusNodeIds, [originalId]);
  assert.equal(own.evaluation.relationOwnerNodeId, selfId);
  assert.equal(other.evaluation.relationOwnerNodeId, selfId);
  assert.equal(own.evaluation.relationPreviewDiagnostic, undefined);
  assert.equal(other.evaluation.relationPreviewDiagnostic, undefined);
  assert.deepEqual(
    defined(own.evaluation.relationPreview).compositionTransform.position,
    [2, 0, 0],
  );
  const shift = at(module, source, 'offset(160');
  assert.deepEqual(shift.evaluation.focusNodeIds, [selfId]);
  assert.deepEqual(
    defined(shift.evaluation.relationPreview).compositionTransform.position,
    [162, 0, 0],
  );
  const scene = await inspect(source, 'relate(self');
  assert.equal(scene.target.length, 1);
  assert.equal(scene.ambient.length, 1);
  const self = scene.target[0],
    original = scene.ambient[0];
  assert.equal(self.kind, 'model');
  assert.equal(original.kind, 'model');
  if (self.kind !== 'model' || original.kind !== 'model') return;
  assert.deepEqual(self.model.children[0].transform.position, [162, 0, 0]);
  assert.deepEqual(original.model.children[0].transform.position, [0, 0, 0]);
  const constraintScene = await inspect(source, 'leftSide.right');
  assert.deepEqual(
    constraintScene.target.flatMap(item =>
      item.kind === 'model' ? [item.model.children[0].transform.position] : [],
    ),
    [
      [2, 0, 0],
      [0, 0, 0],
    ],
  );
});

async function inspect(source: string, token: string) {
  return defined(
    await compiler.executor.inspect({
      file: '/main.ts',
      offset: source.indexOf(token) + (token === 'base.up' ? 6 : 1),
    }),
  );
}

test('relation inspection declares directed references, exact bounds and explicit focus without duplicate named providers', async () => {
  const source = `import {box,group,offset} from '@code3d/core'; const base=group([box(20,10,30)]); const part=group([box(8,6,4)]).relate(self=>[self.on(base.up), offset(2,0,0)]); export default group([base,part]);`;
  const module = await compile(source);
  for (const token of ['on(', 'base.up']) {
    const scene = await inspect(source, token);
    const anchors = scene.target.filter(item => item.kind === 'anchor');
    assert.equal(anchors.length, 2);
    assert.ok(anchors.every(item => item.direction === 'forward'));
    assert.equal(
      anchors.filter(item => item.focused).length,
      token === 'on(' ? 0 : 1,
    );
    const bounds = scene.target.filter(item => item.kind === 'bounds');
    assert.equal(bounds.length, 1);
    const planes = anchors
      .flatMap(item =>
        item.elements.flatMap(element =>
          decorations.previewElementDecorations(
            {...module, objects: scene.objects},
            item.model,
            element,
            item.direction,
          ),
        ),
      )
      .filter(item => item.kind === 'surface');
    assert.equal(planes.length, 2);
    assert.ok(planes.every(item => item.appearance.color === '#d8ff3e'));
  }
});

for (const [geometry, receiver, argument] of [
  ['box(8,6,4)', 'self.axis', 'base.axis.reverse()'],
  ['line([0,0,0],[10,5,0])', 'self', 'base.reverse()'],
  ['box(8,6,4)', 'self.surface(1)', 'base.surface(2).flip()'],
  ['point()', 'self', 'base'],
] as const) {
  test(`align uses the public anchor annotations for ${receiver}`, async () => {
    const source = `import {box,line,point,group} from '@code3d/core'; const base=${geometry}; const part=${geometry}.relate(self=>${receiver}.align( /* target */ ${argument} )); export default group([base,part]);`;
    await compile(source);
    for (const token of ['align(', '/* target */']) {
      const scene = await inspect(source, token);
      const anchors = scene.target.filter(item => item.kind === 'anchor');
      assert.equal(anchors.length, 2);
      assert.ok(anchors.every(item => item.direction === 'forward'));
      assert.equal(
        anchors.filter(item => item.focused).length,
        token === 'align(' ? 0 : 1,
      );
      assert.equal(
        scene.target.filter(item => item.kind === 'bounds').length,
        0,
      );
    }
  });
}

test('member completion uses its actual reference receiver when the tool context focuses self', async () => {
  const source = `import {axisLine, box} from '@code3d/core'; const base=box(20,10,30); const axis=box(2,4,6); const part=box(8,6,4).relate(self=>[self.on(base.up), axisLine(axis.axis).rotate(20)]);`;
  const module = await compile(source);
  const original = defined(
    module.sourceTargets.find(
      target =>
        target.kind === 'element' &&
        target.receiverRef?.start === source.indexOf('axis.axis'),
    ),
  );
  const evaluation = original.evaluations[0];
  const receiver = defined(evaluation.valueNodeIds?.[0]);
  assert.notEqual(receiver, evaluation.focusNodeIds?.[0]);
  let preview:
    import('../src/model/inspection-snapshot').InspectionSnapshot | undefined;
  const host = {
    module,
    previewCompletedProject(_module: unknown, scene: typeof preview) {
      preview = scene;
    },
  };
  const target = {
    ...original,
    evaluations: [{...evaluation, element: undefined}],
  };
  assert.ok(
    ModelViewport.prototype.previewCompletion.call(
      host as unknown as InstanceType<typeof ModelViewport>,
      target,
      0,
      'up',
    ),
  );
  const item = defined(preview).target[0];
  assert.equal(item.kind, 'anchor');
  if (item.kind !== 'anchor') return;
  assert.equal(item.model.nodeId, receiver);
  assert.ok(item.elements[0].bound);
  assert.deepEqual(defined(preview).ambient, []);
});

test('joint placement draws only the selected relation and keeps unrelated values out of its scene', async () => {
  const source = `import {box,group,offset,pivot} from '@code3d/core'; const extra=box(50,50,50); const base=box(20,10,30); const part=box(8,6,4).relate(self=>[self.axis.align(base.axis),self.on(base.up),offset(3,0,0),pivot([1,0,0]).rotate(0,0,20)]); export default group([base,part,extra]);`;
  await compile(source);
  for (const token of ['align(', 'on(', 'base.axis', 'base.up']) {
    const scene = await inspect(source, token);
    assert.equal(
      scene.target.filter(item => item.kind === 'anchor').length,
      2,
      token,
    );
    assert.equal(scene.ambient.length, 0, token);
  }
  for (const token of ['offset(3', 'pivot([', 'rotate(']) {
    const scene = await inspect(source, token);
    assert.ok(
      scene.target.every(item => item.kind === 'model'),
      token,
    );
    assert.equal(scene.ambient.length, 1, token);
  }
});

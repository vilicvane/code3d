import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {defined} from '../../../test/assert.ts';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestProjectCompiler} from './project-test-files.ts';
import type {ModelModule} from '../src/model/compiler.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestProjectCompiler>>;
let ModelViewport: typeof import('../src/viewport.ts').ModelViewport;
let decorations: typeof import('../src/model/element-decorations.ts');
let context: typeof import('../src/model/constraint-context.ts');
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestProjectCompiler(server);
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
  const constraint = defined(
    context.evaluatedConstraint(module.objects, evaluation),
  );
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
      const source = `import {box, group} from '@code3d/core';
        const base = box(20,10,30); const axis = box(2,2,2);
        const part = box(8,6,4).relate(self => ${receiver}.${method}(
          /* target-start */ ${argument} /* target-end */
        ).offset(1,2,3).around(axis.axis).rotate(20)); export default group([base,part]);`;
      const module = await compile(source);
      for (const token of [
        `${method}(`,
        'offset(',
        '1,2,3',
        'around(',
        'axis.axis',
        'rotate(',
        '20)',
      ]) {
        const scope = at(module, source, token);
        assert.equal(scope.evaluation.constraintFocus, 'self', token);
        assert.deepEqual(
          scope.evaluation.focusNodeIds,
          [scope.evaluation.constraintOwnerNodeId],
          token,
        );
        assert.equal(
          context.focusedConstraintSide(scope.evaluation, scope.constraint),
          reverse ? 'target' : 'source',
          token,
        );
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
      assert.equal(axisScope.evaluation.constraintSpatial?.kind, 'around');
      assert.equal(axisScope.evaluation.nodeIds.length, 3);
    });
  }
}

test('on applies one opacity factor to complete source and target groups without named duplicates', async () => {
  const source = `import {box,group} from '@code3d/core'; const base=group([box(20,10,30)]); const part=group([box(8,6,4)]).relate(self=>self.on( base.up ).offset(2,0,0)); export default group([base,part]);`;
  const module = await compile(source);
  for (const token of ['on(', 'base.up', 'offset(']) {
    const scope = at(module, source, token);
    assert.deepEqual(
      decorations.elementSourceDecoration.decorations(scope),
      [],
    );
    const items = decorations.relationSourceDecoration.decorations(scope);
    assert.equal(new Set(items.map(item => item.id)).size, items.length);
    const primary = token === 'base.up' ? 'target' : 'source';
    for (const side of ['source', 'target'] as const) {
      const factor = side === primary ? 1 : 0.7;
      const group = items.filter(item =>
        item.id.startsWith(`${scope.constraint.id}:${side}:`),
      );
      assert.equal(
        group.filter(item => item.kind === 'bounds').length,
        side === 'source' ? 1 : 0,
      );
      assert.equal(group.filter(item => item.kind === 'surface').length, 1);
      for (const item of group) {
        assert.equal(item.appearance.color, '#d8ff3e');
        assert.equal(
          item.appearance.opacity,
          (item.kind === 'surface' ? 0.18 : 0.85) * factor,
        );
      }
    }
  }
});

for (const [geometry, receiver, argument, baseOpacity] of [
  ['box(8,6,4)', 'self.axis', 'base.axis.reverse()', 0.98],
  ['line([0,0,0],[10,5,0])', 'self', 'base.reverse()', 0.98],
  ['box(8,6,4)', 'self.surface(1)', 'base.surface(2).flip()', 0.66],
  ['point()', 'self', 'base', 0.92],
] as const) {
  test(`align fades all ${receiver} geometry and directions together`, async () => {
    const source = `import {box,line,point,group} from '@code3d/core'; const base=${geometry}; const part=${geometry}.relate(self=>${receiver}.align( /* target */ ${argument} )); export default group([base,part]);`;
    const module = await compile(source);
    for (const [token, primary] of [
      ['align(', 'source'],
      ['/* target */', 'target'],
    ] as const) {
      const scope = at(module, source, token);
      const items = decorations.relationSourceDecoration.decorations(scope);
      for (const side of ['source', 'target'] as const) {
        const factor = side === primary ? 1 : 0.7;
        const group = items.filter(item => item.id.includes(`:${side}:`));
        assert.ok(group.length > 0);
        assert.ok(group.some(item => item.kind === 'anchor'));
        for (const item of group) {
          assert.equal(item.appearance.opacity, baseOpacity * factor);
          if (item.appearance.edgeColor)
            assert.equal(item.appearance.edgeOpacity, factor);
        }
      }
    }
  });
}

test('two relation elements on the same node keep distinct focus and decoration identities', async () => {
  const source = `import {point} from '@code3d/core'; export default point().relate(self=>self.align( /* target */ self ));`;
  const module = await compile(source);
  for (const [token, primary] of [
    ['align(', 'source'],
    ['/* target */', 'target'],
  ] as const) {
    const scope = at(module, source, token);
    assert.equal(
      scope.constraint.source.nodeId,
      scope.constraint.target.nodeId,
    );
    assert.equal(
      context.focusedConstraintSide(scope.evaluation, scope.constraint),
      primary,
    );
    const items = decorations.relationSourceDecoration.decorations(scope);
    assert.equal(items.length, 2);
    assert.equal(new Set(items.map(item => item.id)).size, 2);
    assert.equal(
      defined(items.find(item => item.id.includes(`:${primary}:`))).appearance
        .opacity,
      0.92,
    );
    assert.equal(
      defined(items.find(item => !item.id.includes(`:${primary}:`))).appearance
        .opacity,
      0.92 * 0.7,
    );
  }
});

test('member previews retain their reference receiver when a chain focuses self', async () => {
  const source = `import {box} from '@code3d/core'; const base=box(20,10,30); const axis=box(2,4,6); const part=box(8,6,4).relate(self=>self.on(base.up).around(axis.axis).rotate(20));`;
  const module = await compile(source);
  const scope = at(module, source, 'axis.axis');
  const receiver = defined(scope.evaluation.valueNodeIds?.[0]);
  assert.notEqual(receiver, scope.evaluation.focusNodeIds?.[0]);
  let preview:
    import('../src/model/compiler.ts').SourceTargetEvaluation | undefined;
  const host = {
    module,
    captureTransientPreviewRestore() {},
    renderSourceScene(_target: unknown, evaluation: typeof preview) {
      preview = evaluation;
    },
  };
  // Complete the receiver value `axis` to a directional bound.
  const target = {
    ...scope.target,
    evaluations: [{...scope.evaluation, element: undefined}],
  };
  assert.ok(
    ModelViewport.prototype.previewCompletion.call(
      host as unknown as InstanceType<typeof ModelViewport>,
      target,
      0,
      'up',
    ),
  );
  assert.equal(defined(defined(preview).element).nodeId, receiver);
  assert.ok(defined(defined(preview).element).bound);
  assert.equal(defined(preview).constraintId, undefined);
  assert.ok(
    decorations.elementSourceDecoration.decorations({
      module,
      target,
      evaluation: defined(preview),
    }).length > 0,
  );
  assert.deepEqual(
    decorations.relationSourceDecoration.decorations({
      module,
      target,
      evaluation: defined(preview),
    }),
    [],
  );
});

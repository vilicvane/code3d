import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ModelModule} from '../src/model/compiler.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestModelPipeline>>;
let ModelViewport: typeof import('../src/viewport.ts').ModelViewport;
let provider: typeof import('../src/model/measurement-decorations.ts').measurementSourceDecoration;
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
  ({ModelViewport} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    ));
  ({measurementSourceDecoration: provider} = await server.ssrLoadModule<
    typeof import('../src/model/measurement-decorations.ts')
  >('/src/model/measurement-decorations.ts'));
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
  const target = ModelViewport.prototype['sourceTargetAt'].call(
    {module},
    '/main.ts',
    source.indexOf(token) + 1,
  )!;
  assert.ok(target.evaluations[0].measurement, token);
  return {module, target, evaluation: target.evaluations[0]};
}

test('distance retains its solved context while arguments focus their own models and elements', async () => {
  const source = `import {box,distance,group,offset} from '@code3d/core';
    const a=box(8,30,32); const b=box(8,30,32).relate(self=>[self.on(a.right),offset(60,0,0)]);
    const gap=distance(a.right, /* second */ b.left, 'x');
    export default group([a,b,box(gap,2,2)]);`;
  const module = await compile(source);
  const scope = at(module, source, 'distance(a.right');
  assert.equal(scope.target.tool, undefined);
  for (const token of ['/* second */', "'x'"])
    assert.equal(at(module, source, token).target.id, scope.target.id);
  const measurement = scope.evaluation.measurement!;
  assert.equal(measurement.value, 60);
  assert.equal(scope.evaluation.nodeIds.length, 2);
  assert.equal(measurement.end[0] - measurement.start[0], 60);
  assert.ok(
    measurement.placements.some(value => value.transform.position[0] === 68),
  );
  const drawings = provider.decorations(scope);
  assert.equal(
    drawings.filter(value => value.kind === 'measurement').length,
    1,
  );
  assert.equal(drawings.filter(value => value.kind === 'surface').length, 2);
  assert.deepEqual(scope.target.contextTargetIds, []);
  for (const [token, operand, kind] of [
    ['a.right,', 0, 'value'],
    ['right,', 0, 'element'],
    ['b.left,', 1, 'value'],
    ['left,', 1, 'element'],
  ] as const) {
    const focused = at(module, source, token);
    assert.equal(focused.target.kind, kind, token);
    assert.deepEqual(focused.evaluation.focusNodeIds, [
      measurement.operands[operand].nodeId,
    ]);
    assert.deepEqual(focused.evaluation.measurement, measurement);
    assert.deepEqual(focused.target.contextTargetIds, []);
    const surfaces = provider
      .decorations(focused)
      .filter(d => d.kind === 'surface');
    assert.equal(surfaces.length, 2, token);
    for (const surface of surfaces)
      assert.equal(
        surface.appearance.opacity,
        0.18 *
          (surface.nodeId === measurement.operands[operand].nodeId ? 1 : 0.7),
      );
    const directions = provider
      .decorations(focused)
      .filter(d => d.kind === 'anchor');
    assert.equal(directions.length, kind === 'element' ? 1 : 0, token);
    if (kind === 'element')
      assert.equal(directions[0].nodeId, measurement.operands[operand].nodeId);
  }
});

test('whole-solid distance arguments use model focus without redundant face highlights', async () => {
  const source = `import {box,distance,group} from '@code3d/core';
    const left=box(8,30,32), right=box(8,30,32).originOffset(-68,0,0);
    distance(left, right); export default group([left,right]);`;
  const module = await compile(source);
  for (const [token, operand] of [
    ['left, right', 0],
    ['right);', 1],
  ] as const) {
    const scope = at(module, source, token);
    assert.equal(scope.target.kind, 'value', token);
    const measurement = scope.evaluation.measurement!;
    assert.deepEqual(
      scope.evaluation.focusNodeIds,
      [measurement.operands[operand].nodeId],
      token,
    );
    assert.ok(measurement.operands.every(value => value.whole));
    assert.equal(
      provider.decorations(scope).filter(d => d.kind === 'mesh').length,
      0,
    );
  }
});

test('equal results and repeated calls keep distinct participants and runtime evaluations', async () => {
  const source = `import {point,distance,group} from '@code3d/core';
    const a=point(), b=point([3,4,0]), c=point([0,0,5]);
    const d1=distance(a,b); const d2=distance(a,c);
    const values=[b,c].map(p=>distance(a,p)); export default group([a,b,c]);`;
  const module = await compile(source);
  const first = at(module, source, 'distance(a,b)'),
    second = at(module, source, 'distance(a,c)');
  assert.equal(
    first.evaluation.measurement!.value,
    second.evaluation.measurement!.value,
  );
  assert.notEqual(
    first.evaluation.measurement!.operands[1].nodeId,
    second.evaluation.measurement!.operands[1].nodeId,
  );
  const loop = at(module, source, 'distance(a,p)');
  assert.equal(loop.target.evaluations.length, 2);
  assert.equal(
    new Set(
      loop.target.evaluations.map(
        value => value.measurement!.operands[1].nodeId,
      ),
    ).size,
    2,
  );
  const argument = at(module, source, 'a,p)');
  assert.equal(argument.target.evaluations.length, 2);
  for (const [index, evaluation] of argument.target.evaluations.entries()) {
    assert.deepEqual(
      evaluation.measurement,
      loop.target.evaluations[index].measurement,
    );
    assert.deepEqual(evaluation.focusNodeIds, [
      evaluation.measurement!.operands[0].nodeId,
    ]);
  }
  const current = {
    ...loop,
    evaluation: loop.target.evaluations[1],
    evaluationIndex: 1,
  };
  const selected = ModelViewport.prototype.sourceEvaluationAt.call(
    {
      module,
      sourceContext: current,
      selectedViewTarget: {
        kind: 'source',
        targetId: loop.target.id,
        evaluationIndex: 1,
      },
      sourceTargetAt: ModelViewport.prototype['sourceTargetAt'],
    } as unknown as InstanceType<typeof ModelViewport>,
    module,
    '/main.ts',
    source.indexOf('a,p)') + 1,
  );
  assert.equal(selected?.evaluationIndex, 1);
  assert.equal(
    selected?.evaluation.measurement,
    current.evaluation.measurement,
  );
});

test('measured references preserve distinct primary elements on the same owner and through aliases', async () => {
  const source = `import {box,distance} from '@code3d/core';
    const a=box(8,30,32); const ref=a.right;
    distance(a.left,a.right,'x'); distance(a.surface(1),a.surface(2));
    distance(a.left,ref,'x'); export default a;`;
  const module = await compile(source);
  for (const token of ['left,a.right', 'surface(1),', "ref,'x'"]) {
    const scope = at(module, source, token);
    assert.equal(scope.evaluation.focusNodeIds?.length, 1);
    const drawings = provider
      .decorations(scope)
      .filter(d => d.kind === 'surface' || d.kind === 'mesh');
    assert.equal(drawings.length, 2, token);
    const base = drawings[0].kind === 'mesh' ? 0.66 : 0.18;
    assert.deepEqual(
      drawings.map(d => d.appearance.opacity).sort(),
      [base * 0.7, base],
      token,
    );
  }
});

test('whole and exposed nested groups preserve actual part topology for highlighting', async () => {
  const source = `import {box,group,distance,point} from '@code3d/core';
    const pair=group([box(2,2,2), box(2,2,2).originOffset(-6,0,0)]);
    const outer=group([pair]).expose({cluster:pair}); const target=point([12,0,0]);
    distance(outer.cluster,target); distance(outer,target); export default outer;`;
  const module = await compile(source);
  for (const token of ['distance(outer.cluster', 'distance(outer,target)']) {
    const scope = at(module, source, token);
    const measurement = scope.evaluation.measurement!;
    assert.equal(measurement.value, 5);
    assert.equal(measurement.operands[0].elements.length, 2);
    const drawings = provider.decorations(scope);
    assert.equal(
      drawings.filter(value => value.kind === 'mesh').length,
      token.includes('.cluster') ? 2 : 0,
    );
    assert.ok(
      drawings.some(
        value => value.kind === 'anchor' && value.elementKind === 'point',
      ),
    );
  }
  const focused = at(module, source, 'cluster,target');
  const meshes = provider.decorations(focused).filter(d => d.kind === 'mesh');
  assert.equal(meshes.length, 2);
  assert.ok(meshes.every(d => d.appearance.opacity === 0.66));
});

test('failed measurements do not fabricate traces and a later execution starts clean', async () => {
  const failed = await compiler.compile(
    {
      files: [
        {
          path: '/main.ts',
          source: `import {box,distance} from '@code3d/core'; const a=box(2,2,2); distance(a.axis,a); export default a;`,
        },
      ],
    },
    '/main.ts',
  );
  assert.ok(failed.diagnostic);
  assert.equal(
    failed.sourceTargets.filter(value => value.kind === 'measurement').length,
    0,
  );
  const next = await compile(
    `import {box} from '@code3d/core'; export default box(2,2,2);`,
  );
  assert.equal(
    next.sourceTargets.filter(value => value.kind === 'measurement').length,
    0,
  );
});

test('axis references and transitive relation participants join the call-time dim context', async () => {
  const source = `import {box,distance,offset} from '@code3d/core';
    const base=box(2,2,2); const a=box(2,2,2).relate(self=>[self.on(base.up),offset(0,3,0)]);
    const b=box(2,2,2).relate(self=>[self.on(a.up),offset(0,7,0)]);
    const axis=box(1,1,1); distance(a.up,b.down,axis.axis); export default b;`;
  const module = await compile(source);
  const scope = at(module, source, 'distance(a.up');
  assert.equal(scope.evaluation.nodeIds.length, 4);
  assert.equal(scope.evaluation.measurement!.value, 7);
  assert.deepEqual(scope.evaluation.measurement!.axis, [0, 1, 0]);
  assert.equal(
    provider.decorations(scope).filter(value => value.kind === 'surface')
      .length,
    2,
  );
  const axis = at(module, source, 'axis);');
  assert.equal(axis.evaluation.element?.kind, 'line');
  const drawings = provider.decorations(axis);
  assert.equal(
    drawings.filter(d => d.kind === 'anchor' && d.elementKind === 'line')
      .length,
    1,
  );
  assert.ok(
    drawings
      .filter(d => d.kind === 'surface')
      .every(d => d.appearance.opacity === 0.18 * 0.7),
  );
});

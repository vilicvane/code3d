import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ModelModule} from '../src/model/compiler.ts';
import type {InspectionSnapshot} from '../src/model/inspection-snapshot.ts';
import {defined} from '../../../test/assert.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let pipeline: Awaited<ReturnType<typeof createTestModelPipeline>>;
let ModelViewport: typeof import('../src/viewport.ts').ModelViewport;
before(async () => {
  server = await createAppTestServer();
  pipeline = await createTestModelPipeline(server);
  ({ModelViewport} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    ));
});
after(async () => {
  await pipeline?.dispose();
  await server?.close();
});
async function compile(source: string) {
  const module = await pipeline.compile(
    {files: [{path: '/main.ts', source}]},
    '/main.ts',
  );
  assert.equal(module.diagnostic, undefined, module.diagnostic?.summary);
  return module;
}
function scopeAt(
  module: ModelModule,
  source: string,
  token: string,
  index = 0,
) {
  const offset = source.indexOf(token) + 1;
  const target = defined(
    ModelViewport.prototype['sourceTargetAt'].call(
      {module},
      '/main.ts',
      offset,
    ),
  );
  return {
    target,
    offset,
    evaluation: target.evaluations[index],
    evaluationIndex: index,
  };
}
async function inspect(
  module: ModelModule,
  source: string,
  token: string,
  index = 0,
) {
  const scope = scopeAt(module, source, token, index);
  return defined(
    await pipeline.executor.inspect({
      file: '/main.ts',
      offset: scope.offset,
      contextId: scope.evaluation.contextId,
      order: scope.evaluation.runtime.order,
      callId: scope.evaluation.inspectCallId,
    }),
  );
}
function dimension(scene: InspectionSnapshot) {
  const value = defined(scene.target.find(item => item.kind === 'dimension'));
  assert.equal(value.kind, 'dimension');
  assert.ok('start' in value);
  return value;
}

test('distance preserves its measured frame and keeps parameter focus separate from scalar consumers', async () => {
  const source = `import {on, box,distance,group,offset} from '@code3d/core';
    const a=box(8,30,32); const b=box(8,30,32).relate(self=>[on(self, a.right),offset(60,0,0)]);
    const gap=distance(a.right, /* second */ b.left, 'x');
    export default group([a,b,box(gap,2,2)]);`;
  const module = await compile(source);
  const scene = await inspect(module, source, 'distance(a.right');
  const measured = dimension(scene);
  assert.equal(measured.value, 60);
  assert.equal(measured.end[0] - measured.start[0], 60);
  assert.ok(
    scene.ambient.some(
      item =>
        item.kind === 'model' &&
        item.model.children[0]?.transform.position[0] === 68,
    ),
  );
  for (const token of ['right,', 'left,']) {
    const focused = await inspect(module, source, token);
    const refs = focused.target.filter(item => item.kind === 'anchor');
    assert.equal(refs.length, 2);
    assert.equal(refs.filter(item => item.focused).length, 1);
    assert.equal(refs.filter(item => item.direction === 'none').length, 1);
    assert.equal(dimension(focused).value, 60);
  }
  const at = source.indexOf('gap,2,2') + 1;
  const consumer = defined(
    await pipeline.executor.inspect({file: '/main.ts', offset: at}),
  );
  assert.equal(consumer.ambient.length, 0);
  assert.equal(consumer.target.length, 2);
  const ownDimension = defined(
    consumer.target.find(item => item.kind === 'dimension'),
  );
  assert.ok(
    'candidates' in ownDimension,
    'box consumes the scalar through its own parameter inspector',
  );
  assert.equal(ownDimension.value, 60);
});

test('whole solids partition target and ambient without redundant topology overlays', async () => {
  const source = `import {box,distance,group} from '@code3d/core';
    const left=box(8,30,32), right=box(8,30,32).originOffset(-68,0,0);
    distance(left, right); export default group([left,right]);`;
  const module = await compile(source);
  for (const token of ['left, right', 'right);']) {
    const scene = await inspect(module, source, token);
    assert.equal(scene.target.filter(item => item.kind === 'model').length, 1);
    assert.equal(scene.ambient.filter(item => item.kind === 'model').length, 1);
    assert.equal(scene.target.filter(item => item.kind === 'anchor').length, 0);
    assert.equal(scene.target.filter(item => item.focused).length, 1);
  }
});

test('equal scalar results and repeated calls retain their actual call identity across argument navigation', async () => {
  const source = `import {point,distance,group} from '@code3d/core';
    const a=point(), b=point([3,4,0]), c=point([0,0,5]);
    const d1=distance(a,b); const d2=distance(a,c);
    const values=[b,c].map(p=>distance(a,p)); export default group([a,b,c]);`;
  const module = await compile(source);
  const first = dimension(await inspect(module, source, 'distance(a,b)'));
  const second = dimension(await inspect(module, source, 'distance(a,c)'));
  assert.equal(first.value, second.value);
  assert.notDeepEqual(first.end, second.end);
  const loop = scopeAt(module, source, 'distance(a,p)', 1);
  assert.equal(loop.target.evaluations.length, 2);
  assert.notEqual(
    loop.target.evaluations[0].inspectCallId,
    loop.target.evaluations[1].inspectCallId,
  );
  const firstLoop = dimension(
    await inspect(module, source, 'distance(a,p)', 0),
  );
  const secondLoop = dimension(
    await inspect(module, source, 'distance(a,p)', 1),
  );
  // Source evaluations present the most recent execution first.
  assert.deepEqual(firstLoop.end, [0, 0, 5]);
  assert.deepEqual(secondLoop.end, [3, 4, 0]);
  const selected = defined(
    ModelViewport.prototype.sourceEvaluationAt.call(
      {
        module,
        sourceContext: loop,
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
    ),
  );
  assert.equal(selected.evaluationIndex, 1);
  assert.equal(
    selected.evaluation.inspectCallId,
    loop.evaluation.inspectCallId,
  );
  assert.deepEqual(
    dimension(await inspect(module, source, 'a,p)', 1)).end,
    [3, 4, 0],
  );
});

test('references on one owner and exposed nested groups retain individual focus and topology', async () => {
  const source = `import {box,group,distance,point} from '@code3d/core';
    const a=box(8,30,32), ref=a.right;
    distance(a.left,a.right,'x'); distance(a.surface(1),a.surface(2)); distance(a.left,ref,'x');
    const pair=group([box(2,2,2), box(2,2,2).originOffset(-6,0,0)]);
    const outer=group([pair]).expose({cluster:pair}); const target=point([12,0,0]);
    distance(outer.cluster,target); distance(outer,target); export default outer;`;
  const module = await compile(source);
  for (const token of ['left,a.right', 'surface(1),', "ref,'x'"]) {
    const scene = await inspect(module, source, token);
    const refs = scene.target.filter(item => item.kind === 'anchor');
    assert.equal(refs.length, 2, token);
    assert.equal(refs.filter(item => item.focused).length, 1, token);
    assert.equal(new Set(refs.map(item => item.model.nodeId)).size, 1);
  }
  const exposed = await inspect(module, source, 'distance(outer.cluster');
  assert.equal(dimension(exposed).value, 5);
  const ref = exposed.target.find(item => item.kind === 'anchor');
  assert.equal(ref?.kind, 'anchor');
  if (ref?.kind === 'anchor') {
    assert.equal(ref.elements.length, 2);
    assert.ok(
      ref.elements.every(
        element =>
          element.topology &&
          exposed.objects.has(element.topology.geometryNodeId),
      ),
    );
  }
  const whole = await inspect(module, source, 'distance(outer,target)');
  assert.equal(dimension(whole).value, 5);
  assert.equal(whole.target.filter(item => item.kind === 'anchor').length, 0);
});

test('failed calls retain an inspect target without inventing measurements and later executions start clean', async () => {
  const failed = await pipeline.compile(
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
  const target = defined(
    failed.sourceTargets.find(value => value.kind === 'inspect'),
  );
  assert.equal(target.evaluations[0].runtime.outcome, 'failed');
  assert.equal(
    await pipeline.executor.inspect({
      file: '/main.ts',
      offset: target.sourceRef.start,
    }),
    undefined,
  );
  const next = await compile(
    `import {box} from '@code3d/core'; export default box(2,2,2);`,
  );
  assert.equal(
    next.sourceTargets.filter(value => value.kind === 'inspect').length,
    0,
  );
});

test('axis references and transitive solve participants remain in the captured distance scene', async () => {
  const source = `import {on, box,distance,offset} from '@code3d/core';
    const base=box(2,2,2); const a=box(2,2,2).relate(self=>[on(self, base.up),offset(0,3,0)]);
    const b=box(2,2,2).relate(self=>[on(self, a.up),offset(0,7,0)]);
    const axis=box(1,1,1); distance(a.up,b.down,axis.axis); export default b;`;
  const module = await compile(source);
  const scene = await inspect(module, source, 'distance(a.up');
  assert.equal(scene.ambient.length, 4);
  assert.equal(dimension(scene).value, 7);
  assert.equal(dimension(scene).axisLabel, 'axis');
  const selected = await inspect(module, source, 'axis);');
  assert.ok(
    selected.target.some(
      item =>
        item.kind === 'anchor' &&
        item.focused &&
        item.elements[0].kind === 'line',
    ),
  );
});

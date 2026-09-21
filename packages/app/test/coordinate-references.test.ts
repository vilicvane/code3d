import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {defined} from '../../../test/assert.ts';
import {createTestModelPipeline} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let compiler: Awaited<ReturnType<typeof createTestModelPipeline>>;
let ModelViewport: typeof import('../src/viewport.ts').ModelViewport;
let context: typeof import('../src/model/constraint-context.ts');
before(async () => {
  server = await createAppTestServer();
  compiler = await createTestModelPipeline(server);
  ({ModelViewport} =
    await server.ssrLoadModule<typeof import('../src/viewport.ts')>(
      '/src/viewport.ts',
    ));
  context = await server.ssrLoadModule<typeof context>(
    '/src/model/constraint-context.ts',
  );
});
after(async () => {
  compiler?.dispose();
  await server?.close();
});

for (const [receiver, argument, kind] of [
  ['self.frame', 'space.frame', 'frame'],
  ['self.origin', 'space.frame.origin', 'point'],
] as const) {
  test(`${receiver} alignment retains coordinate references in source focus and preview`, async () => {
    const source = `import {align, on, box, group, point, rotate} from '@code3d/core';
const space = box(30, 20, 10).relate(base => [align(base.origin, point([20, 10, 5])), rotate(20, 30, 40)]);
const part = group([box(2, 4, 6)]).relate(self => align(${receiver}, /* target */ ${argument}));
export default group([point(), part]);`;
    const module = await compiler.compile(
      {files: [{path: '/main.ts', source}]},
      '/main.ts',
    );
    assert.equal(module.diagnostic, undefined);
    for (const token of [`align(${receiver}`, '/* target */']) {
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
      assert.equal(constraint.sourceElement.kind, kind);
      assert.equal(constraint.targetElement.kind, kind);
      assert.equal(constraint.sourceElement.topology, undefined);
      assert.equal(constraint.targetElement.topology, undefined);
      const scene = defined(
        await compiler.executor.inspect({
          file: '/main.ts',
          offset: source.indexOf(token) + 1,
        }),
      );
      const anchors = scene.target.filter(item => item.kind === 'anchor');
      assert.equal(anchors.length, 2);
      assert.ok(
        anchors.every(
          item => item.elements.length === 1 && item.elements[0].kind === kind,
        ),
      );
    }
  });
}

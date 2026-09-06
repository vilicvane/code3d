import {modelGeometry} from '../../core/test/model-test.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as esbuild from 'esbuild';
import {createAppTestServer} from './vite-test-server.ts';
import {createTestEvaluator, packageTestFiles} from './project-test-files.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectBuilder: (typeof import('../src/project/project-builder.ts'))['ProjectBuilder'];
let ProjectRuntime: (typeof import('../src/model/project-runtime.ts'))['ProjectRuntime'];
before(async () => {
  server = await createAppTestServer();
  ({ProjectBuilder} = await server.ssrLoadModule<
    typeof import('../src/project/project-builder.ts')
  >('/src/project/project-builder.ts'));
  ({ProjectRuntime} = await server.ssrLoadModule<
    typeof import('../src/model/project-runtime.ts')
  >('/src/model/project-runtime.ts'));
});
after(async () => server?.close());

test('runs installed package artifacts in their own kernel and retains screw caches between source evaluations', async () => {
  const builder = new ProjectBuilder(packageTestFiles, esbuild);
  const runtime = await ProjectRuntime.create(
    packageTestFiles,
    builder,
    await createTestEvaluator(server),
  );
  const evaluator = await createTestEvaluator(server);
  const source =
    'import {ISO4762} from "@code3d/screws"; export const screw = ISO4762.screw("M6", 18);';
  try {
    await runtime.loadDependencies(builder, source);
    const bundle = await builder.build(source, {
      runtimeFiles: runtime.formats,
    });
    const contexts = {__code3dModules: runtime.modules};
    const first = await evaluator.evaluate(
      'code3d-project:/model.ts',
      bundle.source,
      contexts,
    );
    assert.ok(runtime.tooling.isModelObject(first.screw));
    const identity = modelGeometry(first.screw).id;
    const mesh = runtime.tooling.createModelSnapshotter()(first.screw).mesh;
    runtime.tooling.disposeModelObjects([first.screw]);
    const second = await evaluator.evaluate(
      'code3d-project:/model.ts',
      bundle.source,
      contexts,
    );
    assert.equal(modelGeometry(second.screw).id, identity);
    assert.deepEqual(
      runtime.tooling.createModelSnapshotter()(second.screw).mesh,
      mesh,
    );
    runtime.tooling.disposeModelObjects([second.screw]);
  } finally {
    evaluator.dispose();
    runtime.dispose();
  }
  assert.equal(typeof globalThis.process?.platform, 'string');
});

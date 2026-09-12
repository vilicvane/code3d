import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {modelGeometry} from '../../core/test/model-test.ts';
import {
  buildTestDependencies,
  createTestEvaluator,
  evaluateTestBundle,
  packageTestFiles,
} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectAssets: (typeof import('../src/project/project-assets.ts'))['ProjectAssets'];
let ProjectBuilder: (typeof import('../src/project/project-builder.ts'))['ProjectBuilder'];
let ProjectRuntime: (typeof import('../src/model/project-runtime.ts'))['ProjectRuntime'];
before(async () => {
  server = await createAppTestServer();
  ({ProjectAssets} = await server.ssrLoadModule<
    typeof import('../src/project/project-assets.ts')
  >('/src/project/project-assets.ts'));
  ({ProjectBuilder} = await server.ssrLoadModule<
    typeof import('../src/project/project-builder.ts')
  >('/src/project/project-builder.ts'));
  ({ProjectRuntime} = await server.ssrLoadModule<
    typeof import('../src/model/project-runtime.ts')
  >('/src/model/project-runtime.ts'));
});
after(async () => server?.close());

test('runs installed package artifacts in their own kernel and retains screw caches between source evaluations', async () => {
  const assets = new ProjectAssets(packageTestFiles);
  const builder = new ProjectBuilder(packageTestFiles, esbuild, assets);
  const artifact = await buildTestDependencies(
    server,
    packageTestFiles,
    builder,
    assets,
    'void import("@code3d/screws"); void import("@code3d/screws/iso10642");',
  );
  const runtime = await ProjectRuntime.create(
    artifact,
    await createTestEvaluator(server),
  );
  const evaluator = await createTestEvaluator(server);
  const source =
    'import {ISO10642 as aggregate} from "@code3d/screws"; import * as ISO10642 from "@code3d/screws/iso10642"; export const same = aggregate.screw === ISO10642.screw; export const screw = ISO10642.screw("M6", 18);';
  try {
    for (const specifier of ['@code3d/screws', '@code3d/screws/iso10642']) {
      const path = await builder.resolve(specifier);
      assert.ok(path);
      await runtime.importModule(path);
    }
    const bundle = await builder.build(source, {
      runtimeFiles: artifact.formats,
    });
    const contexts = {__code3dModules: runtime.modules};
    const first = await evaluateTestBundle(
      server,
      evaluator,
      bundle.source,
      contexts,
    );
    assert.equal(first.same, true);
    assert.ok(runtime.tooling.isModelObject(first.screw));
    const identity = modelGeometry(first.screw).id;
    const mesh = runtime.tooling.createModelSnapshotter()(first.screw).mesh;
    runtime.tooling.disposeModelObjects([first.screw]);
    const second = await evaluateTestBundle(
      server,
      evaluator,
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
    assets.dispose();
    await builder.dispose();
  }
  assert.equal(typeof globalThis.process?.platform, 'string');
});

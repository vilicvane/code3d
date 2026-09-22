import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {ArtifactChannel} from '../src/model/compiler-protocol.ts';
import {createTestEvaluator, packageTestFiles} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectCompiler: typeof import('../src/model/project-compiler.ts').ProjectCompiler;
let ProjectExecutor: typeof import('../src/model/project-executor.ts').ProjectExecutor;

before(async () => {
  server = await createAppTestServer();
  ({ProjectCompiler} = await server.ssrLoadModule<
    typeof import('../src/model/project-compiler.ts')
  >('/src/model/project-compiler.ts'));
  ({ProjectExecutor} = await server.ssrLoadModule<
    typeof import('../src/model/project-executor.ts')
  >('/src/model/project-executor.ts'));
});
after(async () => server?.close());

test('package ownership preserves dependency identity when switching files and restoring the same scope', async () => {
  const compiler = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
  );
  const restored = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
  );
  const project = {
    files: ['a', 'b'].map(name => ({
      path: `/${name}.ts`,
      source: 'import {box} from "@code3d/core"; export default box(1, 2, 3);',
    })),
  };
  try {
    const first = await compiler.compile(project, '/a.ts');
    const next = await compiler.compile(project, '/b.ts');
    assert.equal(
      next.dependencies.id,
      first.dependencies.id,
      'changing only the author file must retain the initialized dependency runtime',
    );
    assert.deepEqual(
      next.dependencies.packageResolutions,
      first.dependencies.packageResolutions,
    );
    const adopted = await restored.compile(
      project,
      '/b.ts',
      undefined,
      undefined,
      undefined,
      undefined,
      async () => first.dependencies,
    );
    assert.equal(
      adopted.dependencies.id,
      first.dependencies.id,
      'adoption and new resolutions use the same ownership key',
    );
  } finally {
    await compiler.dispose();
    await restored.dispose();
  }
});

test('switching author subdirectories preserves the unchanged dependency runtime', async () => {
  const compiler = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
  );
  const project = {
    files: ['/a.ts', '/parts/b.ts'].map(path => ({
      path,
      source: 'import {box} from "@code3d/core"; export default box(1, 2, 3);',
    })),
  };
  const executor = new ProjectExecutor(await createTestEvaluator(server));
  const sender = new ArtifactChannel();
  const receiver = new ArtifactChannel();
  let initializations = 0;
  const execute = (artifact: Parameters<typeof executor.execute>[0]) =>
    executor.execute(artifact, phase => {
      if (phase === 'initializing-runtime') initializations++;
    });
  try {
    const first = await compiler.compile(project, '/a.ts');
    await execute(receiver.decode(structuredClone(sender.encode(first))));
    assert.equal(initializations, 1);
    const scope = compiler.dependencyScope;
    const next = await compiler.compile(project, '/parts/b.ts');
    assert.equal(compiler.dependencyScope, scope);
    assert.equal(next.dependencies.source, first.dependencies.source);
    assert.notDeepEqual(
      next.dependencies.packageResolutions,
      first.dependencies.packageResolutions,
    );
    assert.notEqual(
      next.dependencies.id,
      first.dependencies.id,
      'persisted snapshots must retain their distinct ownership records',
    );
    assert.equal(
      next.dependencies.executionIdentity,
      first.dependencies.executionIdentity,
    );
    const message = sender.encode(next);
    assert.ok(
      message.dependency,
      'new provenance still crosses the Worker boundary',
    );
    const transferred = receiver.decode(structuredClone(message));
    assert.deepEqual(
      transferred.dependencies.packageResolutions,
      next.dependencies.packageResolutions,
    );
    await execute(transferred);
    assert.equal(
      initializations,
      1,
      'provenance does not reinitialize the runtime',
    );

    project.files[1].source = [
      'import range from "just-range";',
      'import {box} from "@code3d/core";',
      'export const values = range(3);',
      'export default box(1, 2, 3);',
    ].join('\n');
    const changed = await compiler.compile(project, '/parts/b.ts');
    assert.notEqual(changed.dependencies.source, next.dependencies.source);
    assert.notEqual(
      changed.dependencies.executionIdentity,
      next.dependencies.executionIdentity,
      'changed executable dependencies require a new runtime',
    );
    await execute(receiver.decode(structuredClone(sender.encode(changed))));
    assert.equal(initializations, 2);
  } finally {
    executor.dispose();
    await compiler.dispose();
  }
});

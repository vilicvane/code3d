import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {packageTestFiles} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectCompiler: typeof import('../src/model/project-compiler.ts').ProjectCompiler;

before(async () => {
  server = await createAppTestServer();
  ({ProjectCompiler} = await server.ssrLoadModule<
    typeof import('../src/model/project-compiler.ts')
  >('/src/model/project-compiler.ts'));
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

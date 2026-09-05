import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';

test('watches published package bytes without linking them into the Studio module graph', async () => {
  const server = await createAppTestServer();
  try {
    const client = server.environments.client;
    const result = await client.transformRequest(
      'virtual:code3d-browser-packages',
    );
    assert.match(
      result.code,
      /\/node_modules\/@code3d\/core\/bld\/tooling\/index\.js/,
    );
    assert.match(result.code, /\/__code3d-packages\/[a-f0-9]+\.js/);
    const module = client.moduleGraph.getModuleById(
      '\0virtual:code3d-browser-packages',
    );
    // Vite associates load-hook watch files only after the module node exists.
    // Exercise a rebuild, not just the initial cold request.
    client.moduleGraph.invalidateModule(module);
    await client.transformRequest('virtual:code3d-browser-packages');
    assert.deepEqual(
      [...module.importedModules].map(dependency => dependency.id),
      [],
    );
  } finally {
    await server.close();
  }
});

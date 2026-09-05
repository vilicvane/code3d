import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

/** Keep concurrent test loaders independent from each other and the dev server. */
export async function createAppTestServer() {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'code3d-app-test-'));
  try {
    const server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      cacheDir,
      appType: 'custom',
      logLevel: 'error',
      server: {middlewareMode: true, hmr: false, ws: false},
    });
    return {
      ssrLoadModule: server.ssrLoadModule.bind(server),
      async close() {
        try {
          await server.close();
        } finally {
          await rm(cacheDir, {recursive: true, force: true});
        }
      },
    };
  } catch (error) {
    await rm(cacheDir, {recursive: true, force: true});
    throw error;
  }
}

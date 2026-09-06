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
      // These loaders execute SSR modules only; do not launch a client crawl
      // that can still be writing its prebundle while close removes the cache.
      optimizeDeps: {noDiscovery: true, include: []},
      server: {middlewareMode: true, hmr: false, ws: false},
    });
    return {
      environments: server.environments,
      async ssrLoadModule<Module extends object>(url: string): Promise<Module> {
        return (await server.ssrLoadModule(url)) as Module;
      },
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

export type AppTestServer = Awaited<ReturnType<typeof createAppTestServer>>;

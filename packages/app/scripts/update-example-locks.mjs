import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAppTestServer} from '../test/vite-test-server.ts';
import {releaseArtifacts} from '../../../scripts/publish-packages.mjs';

const app = fileURLToPath(new URL('..', import.meta.url));
const examples = join(app, 'examples');
const artifacts = await releaseArtifacts();
const server = await createAppTestServer();
try {
  const {NpmRegistry} = await server.ssrLoadModule(
    '/src/project/npm-registry.ts',
  );
  const {resolveBrowserPackages} = await server.ssrLoadModule(
    '/src/project/jspm-package-resolver.ts',
  );
  const registry = new NpmRegistry(async (url, options) => {
    for (const artifact of artifacts) {
      const base =
        'https://registry.npmjs.org/' + encodeURIComponent(artifact.name);
      const metadata = {
        ...artifact.manifest,
        dist: {tarball: artifact.tarball, integrity: artifact.integrity},
      };
      if (url === base)
        return Response.json({
          versions: {[artifact.version]: metadata},
          'dist-tags': {latest: artifact.version},
        });
      if (url === base + '/' + artifact.version) return Response.json(metadata);
    }
    return fetch(url, {...options, signal: AbortSignal.timeout(30_000)});
  });
  for (const path of await readdir(examples, {recursive: true})) {
    if (!path.endsWith('/package.json') || path.includes('node_modules/'))
      continue;
    const manifest = JSON.parse(await readFile(join(examples, path), 'utf8'));
    const lock = await resolveBrowserPackages(manifest, registry);
    assert.equal(lock.workspace, undefined);
    await writeFile(
      join(examples, path.replace(/package\.json$/, 'code3d-lock.json')),
      JSON.stringify(lock, null, 2) + '\n',
    );
    console.log('Updated public example lock:', path);
  }
} finally {
  await server.close();
}

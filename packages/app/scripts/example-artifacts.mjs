import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ArtifactRegistry} from '../../../scripts/artifact-registry.mjs';
import {
  publicPackages,
  verifiedArtifacts,
} from '../../../scripts/package-artifacts.mjs';
import {createAppTestServer} from '../test/vite-test-server.ts';

export const appDirectory = resolve(
  fileURLToPath(new URL('..', import.meta.url)),
);
const examples = join(appDirectory, 'examples');

/** Test-only manifests and locks are resolved from one complete current package batch. */
export async function prepareExampleArtifacts() {
  const artifacts = (await verifiedArtifacts(await publicPackages())).map(
    ({name, version, filename, tarball, integrity, manifest}) => ({
      name,
      version,
      filename,
      tarball,
      integrity,
      manifest,
    }),
  );
  const registry = new ArtifactRegistry(artifacts);
  const server = await createAppTestServer();
  const projects = [];
  try {
    const {NpmRegistry} = await server.ssrLoadModule(
      '/src/project/npm-registry.ts',
    );
    const {resolveBrowserPackages} = await server.ssrLoadModule(
      '/src/project/jspm-package-resolver.ts',
    );
    const npm = new NpmRegistry(registry.fetch);
    for (const path of await readdir(examples, {recursive: true})) {
      if (!path.endsWith('/package.json') || path.includes('node_modules/'))
        continue;
      const manifest = JSON.parse(await readFile(join(examples, path), 'utf8'));
      for (const field of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
      ])
        for (const name of Object.keys(manifest[field] ?? {})) {
          const artifact = artifacts.find(item => item.name === name);
          if (artifact) manifest[field][name] = artifact.version;
        }
      const lock = await resolveBrowserPackages(manifest, npm);
      assert.equal(lock.workspace, undefined);
      for (const pkg of Object.values(lock.packages)) {
        if (!pkg.name.startsWith('@code3d/')) continue;
        const artifact = artifacts.find(item => item.name === pkg.name);
        assert.ok(artifact, `Missing current artifact: ${pkg.name}`);
        assert.equal(pkg.version, artifact.version, pkg.name);
        assert.equal(pkg.integrity, artifact.integrity, pkg.name);
      }
      projects.push({
        directory: path.slice(0, -'/package.json'.length),
        manifest,
        lock,
      });
    }
    return {artifacts, projects};
  } finally {
    await server.close();
  }
}

export function exampleArtifactFiles(projects) {
  return Object.fromEntries(
    projects.flatMap(({directory, manifest, lock}) => [
      [
        '/examples/' + directory + '/package.json',
        JSON.stringify(manifest, null, 2) + '\n',
      ],
      [
        '/examples/' + directory + '/code3d-lock.json',
        JSON.stringify(lock, null, 2) + '\n',
      ],
    ]),
  );
}

/** Preserve the App's production install path when tests use a development server. */
export async function useExampleArtifacts(context, prepared) {
  await new ArtifactRegistry(prepared.artifacts).route(context);
  await context.route('**/*virtual*code3d-browser-packages*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const offset = source.indexOf('export const workspaces =');
    assert.ok(
      offset >= 0,
      'The package environment must expose workspace metadata',
    );
    await route.fulfill({
      response,
      body: source.slice(0, offset) + 'export const workspaces = {};',
    });
  });
  const files = exampleArtifactFiles(prepared.projects);
  await context.route('**/src/project/bundled-examples.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nconst artifactFiles = ' +
        JSON.stringify(files) +
        '; for (const file of bundledExamples.files) if (artifactFiles[file.path]) file.source = artifactFiles[file.path];' +
        ' bundledExamples.revision = sourceRevision(bundledExamples.files);',
    });
  });
}

/** Apply the same input files to a separate production build used for screenshots. */
export function exampleArtifactsPlugin(projects) {
  const files = exampleArtifactFiles(projects);
  return {
    name: 'code3d-example-artifacts',
    enforce: 'pre',
    load(id) {
      const [path, query] = id.split('?');
      if (!new URLSearchParams(query).has('raw')) return;
      const source = files[path.slice(appDirectory.length)];
      if (source !== undefined)
        return 'export default ' + JSON.stringify(source);
    },
  };
}

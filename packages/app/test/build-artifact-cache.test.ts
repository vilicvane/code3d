import type {KernelArtifactStore} from '@code3d/core/tooling';
import * as esbuild from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {ArtifactChannel} from '../src/model/compiler-protocol.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import {packageTestFiles} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectCompiler: typeof import('../src/model/project-compiler.ts').ProjectCompiler;
let BuildArtifactCache: typeof import('../src/model/build-artifact-cache.ts').BuildArtifactCache;
let projectArtifactIdentity: typeof import('../src/model/build-artifact-cache.ts').projectArtifactIdentity;
let buildEntryKey: typeof import('../src/model/build-artifact-cache.ts').buildEntryKey;
before(async () => {
  server = await createAppTestServer();
  ({ProjectCompiler} = await server.ssrLoadModule<
    typeof import('../src/model/project-compiler.ts')
  >('/src/model/project-compiler.ts'));
  ({BuildArtifactCache, buildEntryKey, projectArtifactIdentity} =
    await server.ssrLoadModule<
      typeof import('../src/model/build-artifact-cache.ts')
    >('/src/model/build-artifact-cache.ts'));
});
after(async () => server?.close());

function recordStore() {
  const records = new Map<string, Uint8Array>();
  const store: KernelArtifactStore = {
    get: id => records.get(id),
    set: (id, bytes) => {
      records.set(id, bytes);
    },
    delete: id => {
      records.delete(id);
    },
    touch: id => records.has(id),
    getMany(ids: readonly string[]) {
      return ids.map(id => this.get(id));
    },
    touchMany: (ids: readonly string[]) => ids.map(id => records.has(id)),
    flush() {},
  };
  const publish = (
    key: string,
    value: {stamp: number; artifact: string},
    required: readonly string[],
  ) => {
    const old = records.get(key);
    if (old && JSON.parse(new TextDecoder().decode(old)).stamp > value.stamp)
      return false;
    if (!required.every(id => records.has(id))) return false;
    records.set(key, new TextEncoder().encode(JSON.stringify(value)));
    return true;
  };
  return {records, store, publish};
}

const project = {
  files: [
    {
      path: '/a.ts',
      source: 'import {value} from "./b.ts"; export const doubled = value * 2;',
    },
    {path: '/b.ts', source: 'export const value = 3;'},
  ],
};

test('each opened file has its own complete latest artifact, including entries without models', async () => {
  const compiler = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
  );
  const {store, records, publish} = recordStore();
  const cache = new BuildArtifactCache(store, publish);
  try {
    const a = await compiler.compile(project, '/a.ts');
    const b = await compiler.compile(project, '/b.ts');
    const aKey = await buildEntryKey('project', '/nested/../a.ts');
    const bKey = await buildEntryKey('project', '/b.ts');
    await cache.save(aKey, a, 10, () => {});
    await cache.save(bKey, b, 20, () => {});
    assert.equal(a.dependencies.id, b.dependencies.id);
    const sender = new ArtifactChannel(),
      receiver = new ArtifactChannel();
    const firstMessage = sender.encode(a);
    assert.equal('language' in firstMessage.artifact, false);
    assert.ok(firstMessage.dependency);
    const firstTransfer = receiver.decode(structuredClone(firstMessage));
    const nextMessage = sender.encode(b);
    assert.equal(nextMessage.dependency, undefined);
    const nextTransfer = receiver.decode(structuredClone(nextMessage));
    assert.equal(
      nextTransfer.dependencies === firstTransfer.dependencies,
      true,
    );
    assert.deepEqual(nextTransfer.model.files, b.model.files);
    sender.reset();
    assert.ok(
      sender.encode(b).dependency,
      'a restarted executor receives the complete dependency again',
    );

    const fresh = new BuildArtifactCache(store, publish);
    const restoredA = fresh.restore(aKey)!;
    const restoredB = fresh.restore(bKey)!;
    assert.equal(
      await projectArtifactIdentity(restoredA),
      a.id,
      'restoring an artifact does not hash its stored identity or resource statistics',
    );
    const changedMetadata = {
      ...restoredA,
      id: 'old identity',
      resourceStats: {
        ...restoredA.resourceStats,
        networkRequests: restoredA.resourceStats.networkRequests + 1,
      },
    };
    assert.equal(await projectArtifactIdentity(changedMetadata), a.id);
    assert.equal(restoredA.model.rootPath, '/a.ts');
    assert.equal(restoredB.model.rootPath, '/b.ts');
    assert.deepEqual(restoredA.model.files, a.model.files);
    assert.deepEqual(restoredA.model.sketches, a.model.sketches);
    assert.equal(records.has('dependency:' + a.dependencies.id), true);
    assert.equal(
      [...records.keys()].filter(key => key.startsWith('dependency:')).length,
      1,
    );
    assert.equal(
      fresh.restore(await buildEntryKey('another project', '/a.ts')),
      undefined,
    );
    const cancelled = new Error('superseded');
    await assert.rejects(
      cache.save(aKey, b, 30, () => {
        throw cancelled;
      }),
      error => error === cancelled,
    );
    assert.equal(new BuildArtifactCache(store).restore(aKey)?.id, a.id);
    // A second cache connection finishing older work cannot move the persisted pointer back.
    await new BuildArtifactCache(store, publish).save(aKey, b, 5, () => {});
    assert.equal(new BuildArtifactCache(store).restore(aKey)?.id, a.id);
    await cache.succeeded(aKey, a.id, 10);
    const changed = await compiler.compile(
      {
        files: project.files.map(file =>
          file.path === '/a.ts'
            ? {...file, source: file.source.replace('* 2', '* 4')}
            : file,
        ),
      },
      '/a.ts',
    );
    await cache.save(aKey, changed, 40, () => {});
    assert.equal(new BuildArtifactCache(store).restore(aKey)?.id, changed.id);
    assert.equal(
      new BuildArtifactCache(store).restore(aKey, 'successful')?.id,
      a.id,
      'an unconfirmed execution does not replace the last successful result',
    );
    await cache.succeeded(aKey, changed.id, 40);
    assert.equal(
      new BuildArtifactCache(store).restore(aKey, 'successful')?.id,
      changed.id,
    );
    const binary = [...records.keys()].find(key => key.startsWith('binary:'))!;
    records.delete(binary);
    assert.equal(new BuildArtifactCache(store).restore(aKey), undefined);
  } finally {
    await compiler.dispose();
  }
});

test('restored dependency output is validated with metadata and avoids reading the whole runtime source tree', async () => {
  const reads: string[] = [];
  const files: ProjectFileReader = {
    stat: packageTestFiles.stat,
    async readFile(path) {
      reads.push(path);
      return packageTestFiles.readFile(path);
    },
  };
  const first = new ProjectCompiler(files, files, esbuild);
  const second = new ProjectCompiler(files, files, esbuild);
  let originalLanguage!: import('../src/project/project-language.ts').ProjectLanguage;
  let restoredLanguage!: typeof originalLanguage;
  try {
    const artifact = await first.compile(
      project,
      '/a.ts',
      undefined,
      language => {
        originalLanguage = language;
      },
    );
    const coldReads = reads.filter(path => /\.[cm]?js$/.test(path)).length;
    reads.length = 0;
    second.restoreDependencies(structuredClone(artifact.dependencies));
    const rebuilt = await second.compile(
      project,
      '/a.ts',
      undefined,
      language => {
        restoredLanguage = language;
      },
    );
    assert.equal(rebuilt.dependencies.id, artifact.dependencies.id);
    assert.equal(restoredLanguage.files.length, originalLanguage.files.length);
    const declarations = new Map(
      originalLanguage.files.map(file => [file.path, file.source]),
    );
    assert.ok(
      restoredLanguage.files.every(
        file => declarations.get(file.path) === file.source,
      ),
      'declaration contents are unchanged',
    );
    assert.equal(rebuilt.id, artifact.id);
    const restoredReads = reads.filter(path => /\.[cm]?js$/.test(path)).length;
    assert.ok(
      coldReads > 100,
      'the cold build reaches the actual runtime graph',
    );
    assert.ok(
      restoredReads < coldReads / 10,
      `dependency restore read ${restoredReads} JS files after ${coldReads} cold reads`,
    );
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

test('the executor module graph contains no TypeScript parser or compiler', async () => {
  const result = await esbuild.build({
    entryPoints: ['src/model/executor.worker.ts'],
    absWorkingDir: new URL('..', import.meta.url).pathname,
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    metafile: true,
    plugins: [
      {
        name: 'vite-resources',
        setup(build) {
          build.onResolve({filter: /\?(?:worker|url|raw)$/}, args => ({
            path: args.path,
            external: true,
          }));
        },
      },
    ],
  });
  assert.deepEqual(
    Object.keys(result.metafile!.inputs).filter(path =>
      path.includes('/typescript'),
    ),
    [],
  );
});

test('a new entry restores the whole dependency scope independently of older model artifacts', async () => {
  const first = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
  );
  const second = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
  );
  const {store, records, publish} = recordStore();
  const cache = new BuildArtifactCache(store, publish);
  try {
    const artifact = await first.compile(project, '/a.ts');
    const entry = await buildEntryKey('scope-project', '/a.ts');
    const scope = await buildEntryKey('scope-project', first.dependencyScope);
    await cache.save(entry, artifact, 10, () => {}, 'latest', scope);
    records.delete('model:' + artifact.id);
    const fresh = new BuildArtifactCache(store, publish);
    assert.equal(fresh.restore(entry), undefined);
    assert.equal(
      fresh.restoreDependencies(scope)?.id,
      artifact.dependencies.id,
    );
    assert.equal(
      fresh.restoreDependencies(
        await buildEntryKey('other-project', first.dependencyScope),
      ),
      undefined,
    );
    const phases: string[] = [];
    const result = await second.compile(
      project,
      '/b.ts',
      undefined,
      undefined,
      phase => phases.push(phase),
      () => {},
      async directory =>
        fresh.restoreDependencies(
          await buildEntryKey('scope-project', directory),
        ),
    );
    assert.equal(result.dependencies.id, artifact.dependencies.id);
    assert.equal(phases.includes('loading-runtime'), false);
    const binary = [...records.keys()].find(key => key.startsWith('binary:'))!;
    records.delete(binary);
    assert.equal(
      new BuildArtifactCache(store).restoreDependencies(scope),
      undefined,
    );
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

test('opening an unrelated document updates language without changing the executable artifact', async () => {
  const compiler = new ProjectCompiler(
    packageTestFiles,
    packageTestFiles,
    esbuild,
  );
  const languages: import('../src/project/project-language.ts').ProjectLanguage[] =
    [];
  try {
    const first = await compiler.compile(
      project,
      '/a.ts',
      undefined,
      language => languages.push(language),
    );
    const second = await compiler.compile(
      {
        files: [
          ...project.files,
          {
            path: '/unrelated.ts',
            source:
              "import {box} from '@code3d/core'; export default box(3, 4, 5);",
          },
        ],
      },
      '/a.ts',
      undefined,
      language => languages.push(language),
    );
    assert.ok(languages[1].rootPaths?.includes('/unrelated.ts'));
    assert.equal(second.id, first.id);
  } finally {
    await compiler.dispose();
  }
});

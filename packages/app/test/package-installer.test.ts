import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  stat,
  readdir,
  rename,
  rm,
  symlink,
  realpath,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {packTar} from 'modern-tar';
import * as esbuild from 'esbuild';
import type {BrowserProjectFileSystem} from '../src/project/filesystem.ts';
import type {NpmMetadata} from '../src/project/npm-registry.ts';
import type {PackageManifest} from '../src/project/package-manifest.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let BrowserPackageManager: typeof import('../src/project/browser-package-manager.ts').BrowserPackageManager;
let NpmRegistry: typeof import('../src/project/npm-registry.ts').NpmRegistry;
let extractNpmArchive: typeof import('../src/project/npm-registry.ts').extractNpmArchive;
let manifests: typeof import('../src/project/package-manifest.ts');
let ProjectBuilder: typeof import('../src/project/project-builder.ts').ProjectBuilder;
let ProjectLanguageLoader: typeof import('../src/project/project-language.ts').ProjectLanguageLoader;
let copyProjectEntry: typeof import('../src/project/file-operations.ts').copyProjectEntry;
before(async () => {
  server = await createAppTestServer();
  manifests = await server.ssrLoadModule<
    typeof import('../src/project/package-manifest.ts')
  >('/src/project/package-manifest.ts');
  ({BrowserPackageManager} = await server.ssrLoadModule<
    typeof import('../src/project/browser-package-manager.ts')
  >('/src/project/browser-package-manager.ts'));
  ({NpmRegistry, extractNpmArchive} = await server.ssrLoadModule<
    typeof import('../src/project/npm-registry.ts')
  >('/src/project/npm-registry.ts'));
  ({ProjectBuilder} = await server.ssrLoadModule<
    typeof import('../src/project/project-builder.ts')
  >('/src/project/project-builder.ts'));
  ({ProjectLanguageLoader} = await server.ssrLoadModule<
    typeof import('../src/project/project-language.ts')
  >('/src/project/project-language.ts'));
  ({copyProjectEntry} = await server.ssrLoadModule<
    typeof import('../src/project/file-operations.ts')
  >('/src/project/file-operations.ts'));
});
after(async () => server?.close());

async function diskFiles() {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'code3d-package-install-'),
  );
  const disk = (file: string) => directory + file;
  const absent = (error: unknown) =>
    ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
  const files: BrowserProjectFileSystem = {
    async readFile(file) {
      try {
        return new Uint8Array(await readFile(disk(file)));
      } catch (error) {
        if (absent(error) || (error as NodeJS.ErrnoException).code === 'EISDIR')
          return;
        throw error;
      }
    },
    async stat(file) {
      try {
        const info = await stat(disk(file));
        return {
          kind: info.isDirectory() ? 'directory' : 'file',
          version: info.mtimeMs + ':' + info.size,
          realPath: (await realpath(disk(file))).slice(directory.length) || '/',
        };
      } catch (error) {
        if (absent(error)) return;
        throw error;
      }
    },
    async list(file) {
      return Promise.all(
        (await readdir(disk(file))).map(async name => ({
          name,
          kind: (await stat(disk(file + '/' + name))).isDirectory()
            ? ('directory' as const)
            : ('file' as const),
        })),
      );
    },
    async createDirectory(file) {
      await mkdir(disk(file), {recursive: true});
    },
    async writeFile(file, content) {
      await mkdir(path.dirname(disk(file)), {recursive: true});
      await writeFile(disk(file), content);
    },
    async rename(from, to) {
      if (await files.stat(to))
        throw new Error(`Project destination already exists: ${to}`);
      await rename(disk(from), disk(to));
    },
    async replaceFile(from, to) {
      await rename(disk(from), disk(to));
    },
    async remove(file) {
      await rm(disk(file), {recursive: true});
    },
    async symlink(target, file) {
      await mkdir(path.dirname(disk(file)), {recursive: true});
      await symlink(target, disk(file));
    },
    async initialize() {},
    async syncDirectory() {},
    async resetDirectory() {},
  };
  return {files, dispose: () => rm(directory, {recursive: true, force: true})};
}
async function archive(files: Record<string, string | Uint8Array>) {
  const encoder = new TextEncoder();
  const tar = await packTar(
    Object.entries(files).map(([name, source]) => {
      const body = typeof source === 'string' ? encoder.encode(source) : source;
      return {header: {name, type: 'file', size: body.length}, body};
    }),
  );
  return new Uint8Array(
    await new Response(
      new Blob([tar]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );
}
async function registryFixture() {
  const versions = new Map<string, Record<string, NpmMetadata>>();
  const archives = new Map<string, Uint8Array>();
  const requests: string[] = [];
  let offline = false;
  let corrupt = false;
  async function add(
    name: string,
    version: string,
    config: PackageManifest = {},
    sources: Record<string, string | Uint8Array> = {},
  ) {
    const manifest = {
      name,
      version,
      type: 'module',
      main: './index.js',
      types: './index.d.ts',
      ...config,
    };
    const tarball = `https://registry.npmjs.org/${name}/-/${version}.tgz`;
    const bytes = await archive(
      Object.fromEntries(
        Object.entries({
          'package.json': JSON.stringify(manifest),
          'index.js': `export const value = ${JSON.stringify(version)};`,
          'index.d.ts': `export declare const value: ${JSON.stringify(version)};`,
          ...sources,
        }).map(([file, source]) => ['package/' + file, source]),
      ),
    );
    const hash = await crypto.subtle.digest('SHA-512', bytes);
    const metadata = {
      ...manifest,
      dist: {
        tarball,
        integrity: 'sha512-' + Buffer.from(hash).toString('base64'),
      },
    };
    const all = versions.get(name) ?? {};
    all[version] = metadata;
    versions.set(name, all);
    archives.set(tarball, bytes);
  }
  const request: typeof fetch = async input => {
    const url = String(input);
    requests.push(url);
    if (offline) throw new Error('offline');
    if (archives.has(url))
      return new Response(
        new Uint8Array(corrupt ? [1, 2, 3] : archives.get(url)!),
      );
    const [name, version] = url
      .slice('https://registry.npmjs.org/'.length)
      .split('/')
      .map(decodeURIComponent);
    const all = versions.get(name);
    if (!all || (version && !all[version]))
      return new Response('missing', {status: 404});
    return Response.json(
      version
        ? all[version]
        : {versions: all, 'dist-tags': {latest: Object.keys(all).at(-1)}},
    );
  };
  return {
    add,
    requests,
    registry: () => new NpmRegistry(request),
    setOffline: (value: boolean) => (offline = value),
    setCorrupt: (value: boolean) => (corrupt = value),
  };
}

test('subprojects install exact versions, all package files, types, sources, assets and cyclic dependencies', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await registry.add('shared', '2.0.0');
    await registry.add('cycle-a', '1.0.0', {dependencies: {'cycle-b': '1'}});
    await registry.add('cycle-b', '1.0.0', {dependencies: {'cycle-a': '1'}});
    await registry.add(
      '@types/extra',
      '1.0.0',
      {main: undefined},
      {'index.d.ts': 'export interface Extra {count: number}'},
    );
    await registry.add(
      'tool',
      '1.0.0',
      {dependencies: {shared: '^1', 'cycle-a': '1', '@types/extra': '1'}},
      {
        'index.js': "export {value} from 'shared';",
        'index.d.ts':
          "import type {Extra} from '@types/extra'; export declare const value: '1.0.0'; export declare const extra: Extra;\n//# sourceMappingURL=index.d.ts.map",
        'index.d.ts.map': JSON.stringify({
          version: 3,
          file: 'index.d.ts',
          sourceRoot: '',
          sources: ['src/index.ts'],
          names: [],
          mappings: '',
        }),
        'src/index.ts': "export const value = '1.0.0';",
        'kernel.wasm': new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
      },
    );
    const source = "import {value} from 'tool'; export default value;";
    await disk.files.writeFile(
      '/a/package.json',
      JSON.stringify({type: 'module', dependencies: {tool: '^1'}}),
    );
    await disk.files.writeFile('/a/model.ts', source);
    await disk.files.writeFile(
      '/b/package.json',
      JSON.stringify({type: 'module', dependencies: {shared: '^2'}}),
    );
    await disk.files.writeFile(
      '/b/model.ts',
      "import {value} from 'shared'; export default value;",
    );
    const installer = new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    );
    await installer.prepare('/a/model.ts');
    assert.equal(
      await disk.files.stat('/b/node_modules'),
      undefined,
      'unreached subproject stays uninstalled',
    );
    const builder = new ProjectBuilder(installer.dependencies, esbuild);
    const tool = await builder.resolve('tool', '/a/model.ts');
    assert.ok(tool);
    assert.ok(tool.includes('/a/node_modules/.code3d/'));
    const aShared = await builder.resolve('shared', tool);
    assert.ok(aShared);
    assert.match(
      new TextDecoder().decode(await disk.files.readFile(aShared)),
      /1.0.0/,
    );
    const a = await builder.resolve('cycle-a', tool);
    assert.ok(a);
    const b = await builder.resolve('cycle-b', a);
    assert.ok(b);
    assert.equal(
      await builder.resolve('cycle-a', b),
      a,
      'cycle returns one canonical package instance',
    );
    assert.deepEqual(
      await disk.files.readFile(path.posix.dirname(tool) + '/kernel.wasm'),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    );
    const language = await new ProjectLanguageLoader(
      installer.dependencies,
    ).load(
      {
        files: [
          {path: '/a/model.ts', source},
          {path: '/b/model.ts', source: 'export {}'},
        ],
      },
      [],
      '/a/model.ts',
    );
    assert.ok(language.files.some(file => file.path.endsWith('/src/index.ts')));
    assert.ok(
      language.files.some(
        file =>
          file.path.includes('@types/extra') && file.path.endsWith('.d.ts'),
      ),
    );
    assert.ok(
      !language.files.some(file => file.path.startsWith('/b/node_modules')),
    );
    await installer.prepare('/b/model.ts');
    const bShared = await new ProjectBuilder(
      installer.dependencies,
      esbuild,
    ).resolve('shared', '/b/model.ts');
    assert.ok(bShared);
    assert.match(
      new TextDecoder().decode(await disk.files.readFile(bShared)),
      /2.0.0/,
    );
    const calls = registry.requests.length;
    registry.setOffline(true);
    await new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    ).prepare('/a/model.ts');
    assert.equal(
      registry.requests.length,
      calls,
      'reopening installed lock performs no network request',
    );
  } finally {
    await disk.dispose();
  }
});

test('copying an installed project restores its lock without traversing cyclic packages; moving preserves installation', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('cycle-a', '1.0.0', {dependencies: {'cycle-b': '1'}});
    await registry.add('cycle-b', '1.0.0', {dependencies: {'cycle-a': '1'}});
    await disk.files.writeFile(
      '/source/package.json',
      JSON.stringify({dependencies: {'cycle-a': '1'}}),
    );
    await disk.files.writeFile('/source/model.ts', "import 'cycle-a';");
    const installer = new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    );
    await installer.prepare('/source/model.ts');
    await disk.files.writeFile('/source/.code3d/private.json', '{}');
    await disk.files.writeFile('/source/.git/HEAD', 'private');
    const lock = await disk.files.readFile('/source/code3d-lock.json');
    await copyProjectEntry(disk.files, '/source', '/copy');
    assert.deepEqual(await disk.files.readFile('/copy/code3d-lock.json'), lock);
    for (const name of ['node_modules', '.code3d', '.git']) {
      assert.equal(await disk.files.stat('/copy/' + name), undefined);
      assert.ok(await disk.files.stat('/source/' + name));
    }
    await installer.prepare('/copy/model.ts');
    assert.deepEqual(await disk.files.readFile('/copy/code3d-lock.json'), lock);
    const builder = new ProjectBuilder(installer.dependencies, esbuild);
    const copied = await builder.resolve('cycle-a', '/copy/model.ts');
    assert.ok(copied);
    assert.ok(copied.startsWith('/copy/node_modules/'));
    await disk.files.rename('/source', '/moved');
    for (const name of ['node_modules', '.code3d', '.git'])
      assert.ok(await disk.files.stat('/moved/' + name));
    assert.deepEqual(
      await disk.files.readFile('/moved/code3d-lock.json'),
      lock,
    );
    registry.setOffline(true);
    await new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    ).prepare('/moved/model.ts');
    assert.ok(await disk.files.stat('/moved/node_modules/cycle-a/index.js'));
  } finally {
    await disk.dispose();
  }
});

test('manifest edits retain unchanged locked versions, remove old dependencies and preserve installation after a failed download', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await registry.add('extra', '1.0.0');
    const write = (dependencies: Record<string, string>) =>
      disk.files.writeFile(
        '/package.json',
        JSON.stringify({type: 'module', dependencies}),
      );
    const installer = new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    );
    await write({shared: '^1'});
    await installer.prepare('/model.ts');
    const before = await disk.files.readFile('/code3d-lock.json');
    await registry.add('shared', '1.1.0');
    await write({shared: '^1', extra: '1'});
    registry.setCorrupt(true);
    await assert.rejects(
      installer.prepare('/model.ts'),
      /Integrity check failed/,
    );
    assert.deepEqual(await disk.files.readFile('/code3d-lock.json'), before);
    assert.ok(await disk.files.readFile('/node_modules/shared/index.js'));
    registry.setCorrupt(false);
    await installer.prepare('/model.ts');
    assert.match(
      new TextDecoder().decode(
        await disk.files.readFile('/node_modules/shared/index.js'),
      ),
      /1.0.0/,
    );
    await write({extra: '1'});
    await installer.prepare('/model.ts');
    assert.equal(await disk.files.stat('/node_modules/shared'), undefined);
    assert.ok(await disk.files.readFile('/node_modules/extra/index.js'));
  } finally {
    await disk.dispose();
  }
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return {promise, resolve};
}

test(
  'downloads overlap with a 15-job limit while extraction writes one package at a time',
  {timeout: 20_000},
  async t => {
    const disk = await diskFiles();
    const fixture = await registryFixture();
    const names = Array.from({length: 20}, (_, index) => `parallel-${index}`);
    for (const name of names) await fixture.add(name, '1.0.0');
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({
        dependencies: Object.fromEntries(names.map(name => [name, '1'])),
      }),
    );
    const downloads = signal();
    const full = signal();
    const writing = signal();
    const writes = signal();
    let install: Promise<void> | undefined;
    t.after(async () => {
      downloads.resolve();
      writes.resolve();
      await install?.catch(() => {});
      await disk.dispose();
    });
    let started = 0;
    let active = 0;
    let peak = 0;
    let activeWrites = 0;
    let peakWrites = 0;
    const client = fixture.registry();
    const archive = client.archive.bind(client);
    t.mock.method(
      client,
      'archive',
      async (pkg: Parameters<typeof archive>[0]) => {
        started++;
        peak = Math.max(peak, ++active);
        if (active === 15) full.resolve();
        try {
          await downloads.promise;
          return await archive(pkg);
        } finally {
          active--;
        }
      },
    );
    const write = disk.files.writeFile.bind(disk.files);
    t.mock.method(
      disk.files,
      'writeFile',
      async (...args: Parameters<typeof write>) => {
        peakWrites = Math.max(peakWrites, ++activeWrites);
        writing.resolve();
        try {
          await writes.promise;
          return await write(...args);
        } finally {
          activeWrites--;
        }
      },
    );
    const installer = new BrowserPackageManager(
      disk.files,
      undefined,
      () => client,
    );
    install = installer.prepare('/model.ts');
    await full.promise;
    assert.equal(started, 15, 'the initial download batch fills all 15 slots');
    downloads.resolve();
    await writing.promise;
    await nextTurn();
    assert.equal(
      started,
      15,
      'slow extraction bounds queued archives instead of downloading the whole graph',
    );
    assert.equal(
      peakWrites,
      1,
      'extraction does not write multiple packages at once',
    );
    writes.resolve();
    await install;
    assert.equal(started, 20);
    assert.equal(peak, 15);
    assert.equal(peakWrites, 1);
    for (const name of names)
      assert.ok(await disk.files.readFile(`/node_modules/${name}/index.js`));
  },
);

for (const failure of ['download', 'extraction'])
  test(
    `a concurrent ${failure} failure settles active work before cleanup and preserves the previous install`,
    {timeout: 20_000},
    async t => {
      const disk = await diskFiles();
      const fixture = await registryFixture();
      await fixture.add('stable', '1.0.0');
      const client = fixture.registry();
      const installer = new BrowserPackageManager(
        disk.files,
        undefined,
        () => client,
      );
      await disk.files.writeFile(
        '/package.json',
        JSON.stringify({dependencies: {stable: '1'}}),
      );
      await installer.prepare('/model.ts');
      const oldLock = await disk.files.readFile('/code3d-lock.json');
      const oldMarker = await disk.files.readFile(
        '/node_modules/.code3d-install.json',
      );
      const names = Array.from({length: 20}, (_, index) => `failing-${index}`);
      for (const name of names) await fixture.add(name, '1.0.0');
      await disk.files.writeFile(
        '/package.json',
        JSON.stringify({
          dependencies: Object.fromEntries(names.map(name => [name, '1'])),
        }),
      );
      const writing = signal();
      const writes = signal();
      const failed = signal();
      let install: Promise<void> | undefined;
      t.after(async () => {
        writes.resolve();
        await install?.catch(() => {});
        await disk.dispose();
      });
      let started = 0;
      let writeAfterCleanup = false;
      let cleaned = false;
      const archive = client.archive.bind(client);
      const archiveMock = t.mock.method(
        client,
        'archive',
        async (pkg: Parameters<typeof archive>[0]) => {
          started++;
          // Fail a download only after another package is actively writing.
          if (failure === 'download' && started === 2) {
            await writing.promise;
            failed.resolve();
            throw new Error('simulated installation failure');
          }
          return archive(pkg);
        },
      );
      const write = disk.files.writeFile.bind(disk.files);
      const writeMock = t.mock.method(
        disk.files,
        'writeFile',
        async (...args: Parameters<typeof write>) => {
          writing.resolve();
          await writes.promise;
          writeAfterCleanup ||= cleaned;
          if (failure === 'extraction')
            throw new Error('simulated installation failure');
          return write(...args);
        },
      );
      const remove = disk.files.remove.bind(disk.files);
      const removeMock = t.mock.method(
        disk.files,
        'remove',
        async (file: string) => {
          if (file === '/.code3d/package-install') cleaned = true;
          return remove(file);
        },
      );
      install = installer.prepare('/model.ts');
      const rejected = assert.rejects(
        install,
        /simulated installation failure/,
      );
      await writing.promise;
      if (failure === 'download') await failed.promise;
      await nextTurn();
      assert.equal(started, 15, 'extraction bounds outstanding downloads');
      assert.equal(cleaned, false, 'cleanup waits for active writes');
      writes.resolve();
      await rejected;
      assert.equal(
        started,
        15,
        'queued downloads are not started after failure',
      );
      assert.equal(writeAfterCleanup, false);
      assert.equal(
        await disk.files.stat('/.code3d/package-install'),
        undefined,
      );
      assert.deepEqual(await disk.files.readFile('/code3d-lock.json'), oldLock);
      assert.deepEqual(
        await disk.files.readFile('/node_modules/.code3d-install.json'),
        oldMarker,
      );
      assert.ok(await disk.files.readFile('/node_modules/stable/index.js'));
      archiveMock.mock.restore();
      writeMock.mock.restore();
      removeMock.mock.restore();
      await installer.prepare('/model.ts');
      for (const name of names)
        assert.ok(await disk.files.readFile(`/node_modules/${name}/index.js`));
    },
  );

test('new transitive versions do not upgrade locked root dependencies outside their ranges', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await registry.add('shared', '2.0.0');
    await registry.add('tool', '1.0.0', {dependencies: {shared: '^2'}});
    const installer = new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    );
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {shared: '^1'}}),
    );
    await installer.prepare('/model.ts');
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {shared: '^1', tool: '1'}}),
    );
    await installer.prepare('/model.ts');
    assert.match(
      new TextDecoder().decode(
        await disk.files.readFile('/node_modules/shared/index.js'),
      ),
      /1.0.0/,
    );
    const builder = new ProjectBuilder(installer.dependencies, esbuild);
    const tool = await builder.resolve('tool', '/model.ts');
    assert.ok(tool);
    const shared = await builder.resolve('shared', tool);
    assert.ok(shared);
    assert.match(
      new TextDecoder().decode(await disk.files.readFile(shared)),
      /2.0.0/,
    );
  } finally {
    await disk.dispose();
  }
});

test('a dependency on an older version of the same package resolves separately', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await registry.add('shared', '2.0.0', {dependencies: {shared: '^1'}});
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {shared: '^2'}}),
    );
    const installer = new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    );
    await installer.prepare('/model.ts');
    const builder = new ProjectBuilder(installer.dependencies, esbuild);
    const entry = await builder.resolve('shared', '/model.ts');
    assert.ok(entry);
    const older = await builder.resolve('shared', entry);
    assert.ok(older);
    assert.notEqual(entry, older);
    assert.match(
      new TextDecoder().decode(await disk.files.readFile(older)),
      /1.0.0/,
    );
  } finally {
    await disk.dispose();
  }
});

test('committed installs survive cleanup errors and the next preparation collects their backups', async t => {
  const disk = await diskFiles();
  t.after(disk.dispose);
  const fixture = await registryFixture();
  await fixture.add('tool', '1.0.0');
  await disk.files.writeFile(
    '/package.json',
    JSON.stringify({dependencies: {tool: 'latest'}}),
  );
  const states: string[] = [];
  let installed = 0;
  const installer = new BrowserPackageManager(
    disk.files,
    progress => states.push(progress.state),
    fixture.registry,
    () => installed++,
  );
  await installer.prepare('/model.ts');
  await fixture.add('tool', '2.0.0');
  const remove = disk.files.remove.bind(disk.files);
  let failed = false;
  const removeMock = t.mock.method(
    disk.files,
    'remove',
    async (file: string) => {
      if (file === '/.code3d/package-install' && !failed) {
        failed = true;
        throw new Error('temporary cleanup failure');
      }
      return remove(file);
    },
  );
  await installer.update('/');
  assert.equal(states.at(-1), 'ready');
  assert.equal(
    installed,
    2,
    'a committed installation publishes completion despite cleanup failure',
  );
  assert.match(
    new TextDecoder().decode(
      await disk.files.readFile('/node_modules/tool/index.js'),
    ),
    /2.0.0/,
  );
  assert.ok(await disk.files.stat('/.code3d/package-install/previous'));
  removeMock.mock.restore();
  fixture.setOffline(true);
  const requests = fixture.requests.length;
  await installer.prepare('/model.ts');
  assert.equal(await disk.files.stat('/.code3d/package-install'), undefined);
  assert.equal(
    fixture.requests.length,
    requests,
    'cleanup retries do not reinstall or resolve dependencies',
  );
  assert.equal(installed, 2);
});

test('failed rollback preserves recovery files until a later preparation restores the old installation', async t => {
  const disk = await diskFiles();
  t.after(disk.dispose);
  const fixture = await registryFixture();
  await fixture.add('tool', '1.0.0');
  await disk.files.writeFile(
    '/package.json',
    JSON.stringify({dependencies: {tool: 'latest'}}),
  );
  const installer = new BrowserPackageManager(
    disk.files,
    undefined,
    fixture.registry,
  );
  await installer.prepare('/model.ts');
  const lock = await disk.files.readFile('/code3d-lock.json');
  await fixture.add('tool', '2.0.0');
  const replaceMock = t.mock.method(disk.files, 'replaceFile', async () => {
    throw new Error('lock commit failed');
  });
  const remove = disk.files.remove.bind(disk.files);
  const removeMock = t.mock.method(
    disk.files,
    'remove',
    async (file: string) => {
      if (file === '/node_modules') throw new Error('rollback failed');
      return remove(file);
    },
  );
  await assert.rejects(installer.update('/'), /Recovery files were preserved/);
  assert.ok(
    await disk.files.readFile(
      '/.code3d/package-install/previous/tool/index.js',
    ),
  );
  assert.deepEqual(await disk.files.readFile('/code3d-lock.json'), lock);
  replaceMock.mock.restore();
  removeMock.mock.restore();
  fixture.setOffline(true);
  await installer.prepare('/model.ts');
  assert.match(
    new TextDecoder().decode(
      await disk.files.readFile('/node_modules/tool/index.js'),
    ),
    /1.0.0/,
  );
  assert.equal(await disk.files.stat('/.code3d/package-install'), undefined);
});

test('an interrupted first installation is rolled back before attempting new resolution', async t => {
  const disk = await diskFiles();
  t.after(disk.dispose);
  const fixture = await registryFixture();
  await fixture.add('tool', '1.0.0');
  await disk.files.writeFile(
    '/package.json',
    JSON.stringify({dependencies: {tool: '1'}}),
  );
  await new BrowserPackageManager(
    disk.files,
    undefined,
    fixture.registry,
  ).prepare('/model.ts');
  await disk.files.createDirectory('/.code3d/package-install');
  // Recreate the point after renaming the first package tree but before committing its lock.
  await disk.files.rename(
    '/code3d-lock.json',
    '/.code3d/package-install/lock.json',
  );
  fixture.setOffline(true);
  await assert.rejects(
    new BrowserPackageManager(disk.files, undefined, fixture.registry).prepare(
      '/model.ts',
    ),
    /offline/,
  );
  assert.equal(await disk.files.stat('/node_modules'), undefined);
  assert.equal(await disk.files.stat('/code3d-lock.json'), undefined);
  assert.equal(await disk.files.stat('/.code3d/package-install'), undefined);
});

test('an interrupted swap restores the prior directory before reuse', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {shared: '1'}}),
    );
    await new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    ).prepare('/model.ts');
    await disk.files.createDirectory('/.code3d/package-install');
    await disk.files.rename(
      '/node_modules',
      '/.code3d/package-install/previous',
    );
    registry.setOffline(true);
    await new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    ).prepare('/model.ts');
    assert.ok(await disk.files.readFile('/node_modules/shared/index.js'));
  } finally {
    await disk.dispose();
  }
});

test('readable scoped package paths replace an outdated installation without changing the lock', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('@demo/tool', '1.0.0');
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {'@demo/tool': '1'}}),
    );
    const installer = new BrowserPackageManager(
      disk.files,
      () => {},
      registry.registry,
    );
    await installer.prepare('/model.ts');
    const readable = '/node_modules/.code3d/@demo+tool@1.0.0';
    const encoded = '/node_modules/.code3d/%40demo%2Ftool%401.0.0';
    const entry = '/node_modules/@demo/tool/index.js';
    assert.equal(
      (await disk.files.stat(entry))?.realPath,
      readable + '/node_modules/@demo/tool/index.js',
    );
    const lock = await disk.files.readFile('/code3d-lock.json');
    assert.ok(lock);
    // Reproduce a persisted installation created before readable filesystem names.
    await disk.files.rename(readable, encoded);
    await disk.files.remove('/node_modules/@demo/tool');
    await disk.files.symlink(
      '../.code3d/%40demo%2Ftool%401.0.0/node_modules/@demo/tool',
      '/node_modules/@demo/tool',
    );
    await disk.files.writeFile('/node_modules/.code3d-install.json', lock);
    assert.ok(await disk.files.readFile(entry));
    const requests = registry.requests.length;
    registry.setCorrupt(true);
    await assert.rejects(
      installer.prepare('/model.ts'),
      /Integrity check failed/,
    );
    assert.ok(
      await disk.files.readFile(entry),
      'failed reconstruction leaves the old installation usable',
    );
    assert.deepEqual(await disk.files.readFile('/code3d-lock.json'), lock);
    registry.setCorrupt(false);
    await installer.prepare('/model.ts');
    assert.equal(await disk.files.stat(encoded), undefined);
    assert.equal(
      (await disk.files.stat(entry))?.realPath,
      readable + '/node_modules/@demo/tool/index.js',
    );
    assert.deepEqual(await disk.files.readFile('/code3d-lock.json'), lock);
    assert.ok(
      registry.requests.slice(requests).every(url => url.endsWith('.tgz')),
      'reconstruction uses locked archives without resolving versions again',
    );
    registry.setOffline(true);
    const after = registry.requests.length;
    await installer.prepare('/model.ts');
    assert.equal(
      registry.requests.length,
      after,
      'the current layout reopens without downloads',
    );
  } finally {
    await disk.dispose();
  }
});

test('archive traversal is rejected before it can escape the package directory', async () => {
  const bytes = await archive({'package/../../model.ts': 'overwrite'});
  const written: string[] = [];
  await assert.rejects(
    extractNpmArchive(bytes, async path => {
      written.push(path);
    }),
    /archive path|Unsafe|traversal/i,
  );
  assert.deepEqual(written, []);
});

test('Install package creates a local scope and escapes nested installed package manifests', async () => {
  const disk = await diskFiles();
  try {
    await disk.files.writeFile('/package.json', '{"private":true}');
    await disk.files.writeFile(
      '/models/panel/package.json',
      '{"name":"panel"}',
    );
    await disk.files.writeFile(
      '/models/panel/node_modules/tool/package.json',
      '{"name":"tool"}',
    );
    await disk.files.writeFile(
      '/models/panel/node_modules/tool/node_modules/helper/package.json',
      '{"name":"helper"}',
    );
    const target = (directory: string) =>
      manifests.packageInstallDirectory(disk.files, directory);
    assert.equal(
      await target('/models/other'),
      '/models/other',
      'ordinary folders create their own manifest even when an ancestor has one',
    );
    assert.equal(await target('/models/panel'), '/models/panel');
    assert.equal(await target('/models/panel/node_modules'), '/models/panel');
    assert.equal(
      await target('/models/panel/node_modules/tool/src'),
      '/models/panel',
    );
    assert.equal(
      await target('/models/panel/node_modules/tool/node_modules/helper'),
      '/models/panel',
    );
    assert.equal(
      await target(
        '/models/panel/node_modules/.code3d/@scope+tool@1/node_modules/@scope/tool',
      ),
      '/models/panel',
    );
    assert.equal(
      await target('/models/unowned/node_modules/tool'),
      '/',
      'continue upward to a project manifest outside node_modules',
    );
    assert.equal(
      await target('/models/node_modules-copy'),
      '/models/node_modules-copy',
    );
  } finally {
    await disk.dispose();
  }
});

test('Install package adds core only to new manifests and preserves existing dependency choices', () => {
  const created = manifests.addPackageDependency(undefined, 'just-range@4.2.0');
  assert.deepEqual(created, {
    private: true,
    type: 'module',
    dependencies: {'@code3d/core': 'latest', 'just-range': '4.2.0'},
  });
  assert.deepEqual(
    manifests.addPackageDependency(undefined, '@code3d/core@alpha')
      .dependencies,
    {'@code3d/core': 'alpha'},
  );
  const original = {
    name: 'panel',
    scripts: {build: 'custom'},
    devDependencies: {tool: '^1'},
    dependencies: {'@code3d/core': 'custom-version'},
  };
  assert.deepEqual(manifests.addPackageDependency(original, 'tool@2'), {
    ...original,
    devDependencies: {tool: '2'},
  });
  assert.deepEqual(
    original.devDependencies,
    {tool: '^1'},
    'do not mutate the source manifest',
  );
  assert.deepEqual(
    manifests.addPackageDependency({private: true}, '@scope/tool').dependencies,
    {'@scope/tool': 'latest'},
  );
  assert.deepEqual(manifests.parsePackageSpecifier('@scope/tool@^2'), {
    name: '@scope/tool',
    range: '^2',
  });
  assert.throws(() => manifests.parsePackageSpecifier('tool@'), /version/);
  assert.throws(
    () => manifests.parsePackageSpecifier('../tool'),
    /package name/,
  );
});

test('source edits reuse prepared dependencies while manifest changes and removed installations invalidate them', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('tool', '1.0.0');
    await registry.add('tool', '2.0.0');
    await disk.files.writeFile(
      '/a/package.json',
      JSON.stringify({dependencies: {tool: '1.0.0'}}),
    );
    let preparations = 0;
    const installer = new BrowserPackageManager(disk.files, undefined, () => {
      preparations++;
      return registry.registry();
    });
    await installer.prepare('/a/model.ts');
    const requests = registry.requests.length;
    await disk.files.writeFile('/a/model.ts', 'export default 2;');
    await installer.prepare('/a/model.ts');
    await installer.prepare('/a/another.ts');
    assert.equal(
      preparations,
      1,
      'ordinary source edits do not re-enter dependency installation',
    );
    assert.equal(registry.requests.length, requests);
    await disk.files.writeFile(
      '/a/package.json',
      JSON.stringify({dependencies: {tool: '2.0.0'}}),
    );
    await installer.prepare('/a/model.ts');
    assert.equal(preparations, 2);
    assert.match(
      new TextDecoder().decode(
        await installer.dependencies.readFile('/a/node_modules/tool/index.js'),
      ),
      /2.0.0/,
    );
    await disk.files.remove('/a/node_modules');
    await installer.prepare('/a/model.ts');
    assert.equal(
      preparations,
      3,
      'missing node_modules still restores the locked installation',
    );
    assert.ok(await disk.files.stat('/a/node_modules/tool/index.js'));
  } finally {
    await disk.dispose();
  }
});

test('concurrent model preparations share one download for each installed version', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('tool', '1.0.0');
    await registry.add('tool', '2.0.0');
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {tool: '1.0.0'}}),
    );
    let preparations = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const downloading = new Promise<void>(resolve => {
      started = resolve;
    });
    const installer = new BrowserPackageManager(disk.files, undefined, () => {
      preparations++;
      const client = registry.registry();
      const archive = client.archive.bind(client);
      client.archive = async pkg => {
        started();
        await gate;
        return archive(pkg);
      };
      return client;
    });
    const first = installer.prepare('/model.ts');
    await downloading;
    const second = installer.prepare('/another.ts');
    release();
    await Promise.all([first, second]);
    assert.equal(preparations, 1);
    // Simulate an editor save immediately after the previous swap completed.
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {tool: '2.0.0'}}),
    );
    await Promise.all([
      installer.prepare('/model.ts'),
      installer.prepare('/another.ts'),
    ]);
    assert.equal(preparations, 2);
    assert.match(
      new TextDecoder().decode(
        await installer.dependencies.readFile('/node_modules/tool/index.js'),
      ),
      /2.0.0/,
    );
  } finally {
    await disk.dispose();
  }
});

test('installed file metadata and misses are reused until the installation changes', async t => {
  const disk = await diskFiles();
  t.after(() => disk.dispose());
  const registry = await registryFixture();
  await registry.add('tool', '1.0.0');
  await registry.add(
    'tool',
    '2.0.0',
    {},
    {'added.ts': 'export const added = true;'},
  );
  const manifest = (version: string) =>
    JSON.stringify({dependencies: {tool: version}});
  await disk.files.writeFile('/a/package.json', manifest('1.0.0'));
  const installer = new BrowserPackageManager(
    disk.files,
    undefined,
    registry.registry,
  );
  await installer.prepare('/a/model.ts');
  const paths = [
    '/a/node_modules/tool/index.d.ts',
    '/a/node_modules/tool/added.ts',
  ];
  const cold = await installer.dependencies.statMany!(paths);
  assert.ok(cold[0]);
  assert.equal(cold[1], undefined);
  const checked: string[] = [];
  const stat = disk.files.stat.bind(disk.files);
  t.mock.method(disk.files, 'stat', async (path: string) => {
    checked.push(path);
    return stat(path);
  });
  await disk.files.writeFile('/a/model.ts', 'export const size = 5;');
  await installer.prepare('/a/model.ts');
  assert.deepEqual(await installer.dependencies.statMany!(paths), cold);
  assert.ok(
    !checked.some(path => paths.includes(path)),
    'warm edits only check installation metadata, including cached misses',
  );
  await installer.dependencies.stat('/a/model.ts');
  assert.ok(
    checked.includes('/a/model.ts'),
    'ordinary source files still read their current version',
  );
  const unmanaged = '/a/nested/node_modules/manual/index.ts';
  await disk.files.writeFile(unmanaged, 'export const value = 1;');
  const beforeUnmanaged = await installer.dependencies.stat(unmanaged);
  await disk.files.writeFile(unmanaged, 'export const value = 12345;');
  assert.notEqual(
    (await installer.dependencies.stat(unmanaged))?.version,
    beforeUnmanaged?.version,
    'an ancestor installation must not cache a different, unmanaged node_modules tree',
  );
  await disk.files.writeFile('/a/package.json', manifest('2.0.0'));
  await installer.prepare('/a/model.ts');
  const updated = await installer.dependencies.statMany!(paths);
  assert.ok(updated[1], 'a previously missing package file becomes visible');
  assert.notEqual(updated[0]?.realPath, cold[0]?.realPath);
  await disk.files.remove('/a/node_modules');
  await installer.prepare('/a/model.ts');
  assert.ok(
    (await installer.dependencies.statMany!(paths))[1],
    'restoring the locked tree invalidates cached metadata',
  );
});

test('failed package preparation reports the package name and recovers when its manifest is removed', async t => {
  const disk = await diskFiles();
  t.after(() => disk.dispose());
  const registry = await registryFixture();
  await disk.files.writeFile(
    '/package.json',
    '{"dependencies":{"wrong-package-name":"*"}}',
  );
  const progress: import('../src/project/browser-package-manager.ts').PackageInstallationProgress[] =
    [];
  const installer = new BrowserPackageManager(
    disk.files,
    value => progress.push(value),
    registry.registry,
  );
  await assert.rejects(
    installer.prepare('/model.ts'),
    /npm package not found: wrong-package-name/,
  );
  assert.equal(progress.at(-1)?.state, 'error');
  await disk.files.remove('/package.json');
  await installer.prepare('/model.ts');
  assert.deepEqual(progress.at(-1), {
    directory: '/',
    state: 'ready',
    message: 'Packages ready',
  });
  registry.setOffline(true);
  await assert.rejects(
    registry.registry().packument('mistyped-package'),
    /Unable to fetch npm package mistyped-package.*offline/,
  );
});

test('explicit updates resolve direct and transitive ranges without old locks and preserve other scopes', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await registry.add('tool', '1.0.0', {dependencies: {shared: '^1'}});
    await registry.add('pinned', '1.0.0');
    const source =
      JSON.stringify({dependencies: {tool: '^1', pinned: '1.0.0'}}, null, 2) +
      '\n';
    await disk.files.writeFile('/a/package.json', source);
    await disk.files.writeFile('/b/package.json', source);
    let installations = 0;
    const installer = new BrowserPackageManager(
      disk.files,
      undefined,
      registry.registry,
      () => installations++,
    );
    await installer.prepare('/a/model.ts');
    await installer.prepare('/b/model.ts');
    const oldLock = await disk.files.readFile('/a/code3d-lock.json');
    const otherLock = await disk.files.readFile('/b/code3d-lock.json');
    const oldInfo = await installer.dependencies.stat(
      '/a/node_modules/tool/index.js',
    );
    await registry.add('shared', '1.2.0');
    await registry.add('shared', '2.0.0');
    await registry.add('tool', '1.1.0', {dependencies: {shared: '^1'}});
    await registry.add('tool', '2.0.0');
    await registry.add('pinned', '1.1.0');
    const before = registry.requests.length;
    await installer.prepare('/a/model.ts');
    assert.equal(
      registry.requests.length,
      before,
      'ordinary preparation retains the lock',
    );
    await installer.update('/a');
    const lockBytes = await disk.files.readFile('/a/code3d-lock.json');
    assert.notDeepEqual(lockBytes, oldLock);
    const lock = JSON.parse(new TextDecoder().decode(lockBytes));
    assert.deepEqual(
      Object.values(lock.packages)
        .map((pkg: any) => `${pkg.name}@${pkg.version}`)
        .sort(),
      ['pinned@1.0.0', 'shared@1.2.0', 'tool@1.1.0'],
    );
    assert.equal(
      new TextDecoder().decode(await disk.files.readFile('/a/package.json')),
      source,
    );
    assert.deepEqual(
      await disk.files.readFile('/b/code3d-lock.json'),
      otherLock,
    );
    assert.match(
      new TextDecoder().decode(
        await disk.files.readFile('/b/node_modules/tool/index.js'),
      ),
      /1.0.0/,
    );
    assert.notEqual(
      (await installer.dependencies.stat('/a/node_modules/tool/index.js'))
        ?.realPath,
      oldInfo?.realPath,
    );
    assert.match(
      new TextDecoder().decode(
        await installer.dependencies.readFile('/a/node_modules/tool/index.js'),
      ),
      /1.1.0/,
    );
    const after = registry.requests.length;
    const installed = installations;
    await installer.update('/a');
    assert.ok(
      registry.requests.length > after,
      'even an unchanged installation explicitly rechecks the registry',
    );
    assert.equal(
      installations,
      installed,
      'identical resolutions do not replace installed files',
    );
    assert.equal(
      registry.requests.slice(after).filter(url => url.endsWith('.tgz')).length,
      0,
    );
  } finally {
    await disk.dispose();
  }
});

test('explicit update failures preserve installed files and locks, and updates can replace a malformed lock', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('tool', '1.0.0');
    const source = '{"dependencies":{"tool":"latest"}}';
    await disk.files.writeFile('/package.json', source);
    const installer = new BrowserPackageManager(
      disk.files,
      undefined,
      registry.registry,
    );
    await installer.prepare('/model.ts');
    const oldLock = await disk.files.readFile('/code3d-lock.json');
    const oldMarker = await disk.files.readFile(
      '/node_modules/.code3d-install.json',
    );
    await registry.add('tool', '2.0.0');
    registry.setCorrupt(true);
    await assert.rejects(installer.update('/'), /Integrity check failed/);
    assert.deepEqual(await disk.files.readFile('/code3d-lock.json'), oldLock);
    assert.deepEqual(
      await disk.files.readFile('/node_modules/.code3d-install.json'),
      oldMarker,
    );
    assert.match(
      new TextDecoder().decode(
        await disk.files.readFile('/node_modules/tool/index.js'),
      ),
      /1.0.0/,
    );
    assert.equal(await disk.files.stat('/.code3d/package-install'), undefined);
    registry.setOffline(true);
    await installer.prepare('/model.ts');
    registry.setOffline(false);
    registry.setCorrupt(false);
    await disk.files.writeFile('/code3d-lock.json', '{ invalid lock');
    await installer.update('/');
    const lock = JSON.parse(
      new TextDecoder().decode(await disk.files.readFile('/code3d-lock.json')),
    );
    assert.ok(lock.packages['https://registry.npmjs.org/tool/2.0.0/']);
    assert.match(
      new TextDecoder().decode(
        await installer.dependencies.readFile('/node_modules/tool/index.js'),
      ),
      /2.0.0/,
    );
    assert.equal(
      new TextDecoder().decode(await disk.files.readFile('/package.json')),
      source,
    );
  } finally {
    await disk.dispose();
  }
});

test('an explicit update queued behind preparation still resolves fresh versions', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('tool', '1.0.0');
    await disk.files.writeFile(
      '/package.json',
      '{"dependencies":{"tool":"latest"}}',
    );
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let started!: () => void;
    const downloading = new Promise<void>(resolve => {
      started = resolve;
    });
    const installer = new BrowserPackageManager(disk.files, undefined, () => {
      const client = registry.registry();
      const archive = client.archive.bind(client);
      client.archive = async pkg => {
        if (pkg.version === '1.0.0') {
          started();
          await gate;
        }
        return archive(pkg);
      };
      return client;
    });
    const preparing = installer.prepare('/model.ts');
    await downloading;
    await registry.add('tool', '2.0.0');
    const updating = installer.update('/');
    const observing = installer.prepare('/another.ts');
    release();
    await Promise.all([preparing, updating, observing]);
    const lock = JSON.parse(
      new TextDecoder().decode(await disk.files.readFile('/code3d-lock.json')),
    );
    assert.ok(lock.packages['https://registry.npmjs.org/tool/2.0.0/']);
    assert.deepEqual(
      registry.requests.filter(url => url.endsWith('.tgz')),
      [
        'https://registry.npmjs.org/tool/-/1.0.0.tgz',
        'https://registry.npmjs.org/tool/-/2.0.0.tgz',
      ],
    );
  } finally {
    await disk.dispose();
  }
});

for (const next of ['prepare', 'update'] as const)
  test(
    `a failed download does not discard a queued ${next} for the corrected manifest`,
    {timeout: 20_000},
    async t => {
      const disk = await diskFiles();
      const fixture = await registryFixture();
      await fixture.add('tool', '1.0.0');
      await fixture.add('tool', '2.0.0');
      await disk.files.writeFile(
        '/package.json',
        JSON.stringify({dependencies: {tool: '1.0.0'}}),
      );
      const started = signal();
      const release = signal();
      let requests = 0;
      const client = fixture.registry();
      const archive = client.archive.bind(client);
      t.mock.method(
        client,
        'archive',
        async (pkg: Parameters<typeof archive>[0]) => {
          if (++requests === 1) {
            started.resolve();
            await release.promise;
            throw new Error('old download failed');
          }
          return archive(pkg);
        },
      );
      const states: string[] = [];
      const manager = new BrowserPackageManager(
        disk.files,
        progress => states.push(progress.state),
        () => client,
      );
      const first = assert.rejects(
        manager.prepare('/model.ts'),
        /old download failed/,
      );
      let queued: Promise<void> | undefined;
      t.after(async () => {
        release.resolve();
        await Promise.allSettled([first, queued]);
        await disk.dispose();
      });
      await started.promise;
      await disk.files.writeFile(
        '/package.json',
        JSON.stringify({dependencies: {tool: '2.0.0'}}),
      );
      queued =
        next === 'update' ? manager.update('/') : manager.prepare('/model.ts');
      await nextTurn();
      release.resolve();
      await first;
      await queued;
      assert.equal(requests, 2);
      assert.equal(states.filter(state => state === 'error').length, 1);
      assert.equal(states.at(-1), 'ready');
      assert.match(
        new TextDecoder().decode(
          await manager.files.readFile('/node_modules/tool/index.js'),
        ),
        /2.0.0/,
      );
    },
  );

test('ordinary package reads never install while dependency reads lazily prepare the reached scope', async t => {
  const disk = await diskFiles();
  t.after(disk.dispose);
  const fixture = await registryFixture();
  await fixture.add('tool', '1.0.0');
  await disk.files.writeFile(
    '/nested/package.json',
    JSON.stringify({dependencies: {tool: '1'}}),
  );
  const manager = new BrowserPackageManager(
    disk.files,
    undefined,
    fixture.registry,
  );
  const file = '/nested/node_modules/tool/index.js';
  assert.equal(await manager.files.readFile(file), undefined);
  assert.equal(await manager.files.stat(file), undefined);
  assert.equal(fixture.requests.length, 0);
  assert.ok(await manager.dependencies.readFile(file));
  assert.ok(await disk.files.stat('/nested/code3d-lock.json'));
  assert.equal(await disk.files.stat('/node_modules'), undefined);
});

test('malformed manifests report one package failure and recover after correction', async t => {
  const disk = await diskFiles();
  t.after(disk.dispose);
  await disk.files.writeFile('/nested/package.json', '{ malformed');
  const states: import('../src/project/browser-package-manager.ts').PackageInstallationProgress[] =
    [];
  const manager = new BrowserPackageManager(disk.files, progress =>
    states.push(progress),
  );
  await assert.rejects(manager.prepare('/nested/model.ts'), {
    name: 'PackageInstallationError',
  });
  assert.equal(states.length, 1);
  assert.equal(states[0].directory, '/nested');
  assert.equal(states[0].state, 'error');
  await disk.files.writeFile('/nested/package.json', '{}');
  await manager.prepare('/nested/model.ts');
  assert.equal(states.at(-1)?.state, 'ready');
});

test('package refresh failures retain committed state and retry notification without reinstalling', async t => {
  const disk = await diskFiles();
  t.after(disk.dispose);
  const fixture = await registryFixture();
  await fixture.add('tool', '1.0.0');
  await disk.files.writeFile(
    '/package.json',
    JSON.stringify({dependencies: {tool: '1'}}),
  );
  const states: string[] = [];
  const changes: import('../src/project/browser-package-manager.ts').PackageInstallationChange[] =
    [];
  let failRefresh = true;
  const manager = new BrowserPackageManager(
    disk.files,
    progress => states.push(progress.state),
    fixture.registry,
    async change => {
      changes.push(change);
      assert.ok(await manager.files.stat('/node_modules/tool/index.js'));
      if (failRefresh) throw new Error('editor refresh unavailable');
    },
  );
  await assert.rejects(manager.prepare('/model.ts'), {
    name: 'Error',
    message: 'Unable to refresh changed package files.',
  });
  assert.equal(states.at(-1), 'ready');
  assert.ok(!states.includes('error'));
  assert.ok(await disk.files.stat('/code3d-lock.json'));
  const requests = fixture.requests.length;
  failRefresh = false;
  await manager.prepare('/model.ts');
  assert.equal(fixture.requests.length, requests);
  assert.deepEqual(changes[1], changes[0]);
  await manager.prepare('/model.ts');
  assert.equal(
    changes.length,
    2,
    'ordinary edits do not publish unchanged installations',
  );
});

test('recovery publishes restored files even when resolving the corrected installation fails', async t => {
  const disk = await diskFiles();
  t.after(disk.dispose);
  const fixture = await registryFixture();
  await fixture.add('tool', '1.0.0');
  await disk.files.writeFile(
    '/package.json',
    JSON.stringify({dependencies: {tool: '1'}}),
  );
  const changes: string[] = [];
  const manager = new BrowserPackageManager(
    disk.files,
    undefined,
    fixture.registry,
    change => {
      changes.push(change.generation);
    },
  );
  await manager.prepare('/model.ts');
  const scratch = '/.code3d/package-install';
  await disk.files.createDirectory(scratch);
  await disk.files.rename('/node_modules', scratch + '/previous');
  await disk.files.createDirectory('/node_modules');
  await disk.files.writeFile(
    '/node_modules/.code3d-install.json',
    'uncommitted',
  );
  await disk.files.writeFile(
    '/package.json',
    JSON.stringify({dependencies: {tool: '2'}}),
  );
  // First observe the interrupted files as a new manager (as after a reload).
  const restored: string[] = [];
  const reloaded = new BrowserPackageManager(
    disk.files,
    undefined,
    fixture.registry,
    change => {
      restored.push(change.generation);
    },
  );
  fixture.setOffline(true);
  await assert.rejects(reloaded.prepare('/model.ts'), /offline/);
  assert.equal(restored.length, 1);
  assert.match(
    new TextDecoder().decode(
      await reloaded.files.readFile('/node_modules/tool/index.js'),
    ),
    /1.0.0/,
  );
});

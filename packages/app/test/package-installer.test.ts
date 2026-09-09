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
import {packTar} from 'modern-tar';
import * as esbuild from 'esbuild';
import type {BrowserProjectFileSystem} from '../src/project/filesystem.ts';
import type {NpmMetadata} from '../src/project/npm-registry.ts';
import type {PackageManifest} from '../src/project/package-manifest.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let BrowserPackageInstaller: typeof import('../src/project/browser-package-installer.ts').BrowserPackageInstaller;
let NpmRegistry: typeof import('../src/project/npm-registry.ts').NpmRegistry;
let extractNpmArchive: typeof import('../src/project/npm-registry.ts').extractNpmArchive;
let ProjectBuilder: typeof import('../src/project/project-builder.ts').ProjectBuilder;
let loadProjectLanguage: typeof import('../src/project/project-language.ts').loadProjectLanguage;
let copyProjectEntry: typeof import('../src/project/file-operations.ts').copyProjectEntry;
before(async () => {
  server = await createAppTestServer();
  ({BrowserPackageInstaller} = await server.ssrLoadModule<
    typeof import('../src/project/browser-package-installer.ts')
  >('/src/project/browser-package-installer.ts'));
  ({NpmRegistry, extractNpmArchive} = await server.ssrLoadModule<
    typeof import('../src/project/npm-registry.ts')
  >('/src/project/npm-registry.ts'));
  ({ProjectBuilder} = await server.ssrLoadModule<
    typeof import('../src/project/project-builder.ts')
  >('/src/project/project-builder.ts'));
  ({loadProjectLanguage} = await server.ssrLoadModule<
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
    const installer = new BrowserPackageInstaller(
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
    const builder = new ProjectBuilder(installer, esbuild);
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
    const language = await loadProjectLanguage(
      installer,
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
    const bShared = await new ProjectBuilder(installer, esbuild).resolve(
      'shared',
      '/b/model.ts',
    );
    assert.ok(bShared);
    assert.match(
      new TextDecoder().decode(await disk.files.readFile(bShared)),
      /2.0.0/,
    );
    const calls = registry.requests.length;
    registry.setOffline(true);
    await new BrowserPackageInstaller(
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
    const installer = new BrowserPackageInstaller(
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
    const builder = new ProjectBuilder(installer, esbuild);
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
    await new BrowserPackageInstaller(
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
    const installer = new BrowserPackageInstaller(
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

test('new transitive versions do not upgrade locked root dependencies outside their ranges', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await registry.add('shared', '2.0.0');
    await registry.add('tool', '1.0.0', {dependencies: {shared: '^2'}});
    const installer = new BrowserPackageInstaller(
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
    const builder = new ProjectBuilder(installer, esbuild);
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
    const installer = new BrowserPackageInstaller(
      disk.files,
      () => {},
      registry.registry,
    );
    await installer.prepare('/model.ts');
    const builder = new ProjectBuilder(installer, esbuild);
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

test('an interrupted swap restores the prior directory before reuse', async () => {
  const disk = await diskFiles();
  try {
    const registry = await registryFixture();
    await registry.add('shared', '1.0.0');
    await disk.files.writeFile(
      '/package.json',
      JSON.stringify({dependencies: {shared: '1'}}),
    );
    await new BrowserPackageInstaller(
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
    await new BrowserPackageInstaller(
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
    const installer = new BrowserPackageInstaller(
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

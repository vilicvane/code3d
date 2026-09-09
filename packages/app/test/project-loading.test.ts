import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {createAppTestServer} from './vite-test-server.ts';
import type {ProjectFileSystem} from '../src/project/filesystem.ts';
import {mapProjectIO} from '../src/project/io.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let operations: typeof import('../src/project/file-operations.ts');
before(async () => {
  server = await createAppTestServer();
  operations = await server.ssrLoadModule('/src/project/file-operations.ts');
});
after(async () => server?.close());

function workspace(): {
  fs: ProjectFileSystem;
  files: Map<string, Uint8Array>;
  directories: Set<string>;
} {
  const files = new Map<string, Uint8Array>();
  const directories = new Set(['/']);
  const fs: ProjectFileSystem = {
    async initialize(seed) {
      await seed();
    },
    async syncDirectory() {},
    async resetDirectory() {},
    async readFile(path) {
      return files.get(path);
    },
    async stat(path) {
      return directories.has(path)
        ? {kind: 'directory', version: ''}
        : files.has(path)
          ? {kind: 'file', version: '', size: files.get(path)!.length}
          : undefined;
    },
    async list(path) {
      const prefix = path === '/' ? '/' : path + '/';
      const result: {name: string; kind: 'file' | 'directory'}[] = [];
      for (const entry of [...directories, ...files.keys()]) {
        if (!entry.startsWith(prefix)) continue;
        const name = entry.slice(prefix.length);
        if (name && !name.includes('/'))
          result.push({
            name,
            kind: directories.has(entry) ? 'directory' : 'file',
          });
      }
      return result;
    },
    async createDirectory(path) {
      const segments = path.split('/').filter(Boolean);
      for (let depth = 1; depth <= segments.length; depth++)
        directories.add('/' + segments.slice(0, depth).join('/'));
    },
    async writeFile(path, source) {
      await fs.createDirectory(path.slice(0, path.lastIndexOf('/')) || '/');
      files.set(
        path,
        typeof source === 'string' ? new TextEncoder().encode(source) : source,
      );
    },
    async rename() {
      throw new Error('Unexpected rename');
    },
    async remove() {
      throw new Error('Unexpected remove');
    },
  };
  return {fs, files, directories};
}

test('copying into an empty local workspace includes unopened and binary files with bounded parallel reads', async () => {
  const source = workspace(),
    target = workspace();
  for (let index = 0; index < 48; index++)
    await source.fs.writeFile(
      `/unopened/${index}.ts`,
      `export const value = ${index};`,
    );
  await source.fs.writeFile('/assets/data.bin', new Uint8Array([0, 255, 128]));
  await source.fs.createDirectory('/assets/empty');
  await source.fs.writeFile('/package.json', '{}');
  await source.fs.writeFile('/code3d-lock.json', '{}');
  for (const directory of ['node_modules', '.code3d', '.git'])
    await source.fs.writeFile(`/${directory}/generated`, 'do not copy');
  let active = 0,
    peak = 0;
  const read = source.fs.readFile;
  source.fs.readFile = async path => {
    peak = Math.max(peak, ++active);
    try {
      await setImmediate();
      return await read(path);
    } finally {
      active--;
    }
  };
  await operations.copyProjectWorkspace(source.fs, target.fs);
  assert.ok(peak > 1 && peak <= 16, `parallel reads: ${peak}`);
  assert.equal(target.files.size, 51);
  assert.deepEqual(
    target.files.get('/assets/data.bin'),
    new Uint8Array([0, 255, 128]),
  );
  assert.ok(target.directories.has('/assets/empty'));
  for (const directory of ['node_modules', '.code3d', '.git'])
    assert.ok(!target.directories.has('/' + directory));
});

test('name search follows npm aliases without looping through cyclic dependencies or reading contents', async () => {
  const {fs} = workspace();
  const listed: string[] = [];
  fs.stat = async path => ({
    kind: 'directory',
    version: '',
    realPath: path.endsWith('/a')
      ? '/store/a'
      : path.endsWith('/b')
        ? '/store/b'
        : path,
  });
  fs.list = async path => {
    listed.push(path);
    if (path === '/')
      return [
        {name: 'node_modules', kind: 'directory'},
        {name: '.git', kind: 'directory'},
      ];
    if (path === '/node_modules') return [{name: 'a', kind: 'directory'}];
    return [
      {name: path.endsWith('/a') ? 'b' : 'a', kind: 'directory'},
      {name: 'index.js', kind: 'file'},
    ];
  };
  fs.readFile = async () => {
    throw new Error('Search must not read contents');
  };
  const found: string[] = [];
  await operations.searchProjectEntries(
    fs,
    () => false,
    entries => found.push(...entries.map(entry => entry.path)),
  );
  assert.deepEqual(listed, [
    '/',
    '/node_modules',
    '/node_modules/a',
    '/node_modules/a/b',
  ]);
  assert.ok(found.includes('/node_modules/a/index.js'));
  assert.ok(!found.includes('/.git'));
  listed.length = 0;
  let cancelled = false;
  await operations.searchProjectEntries(
    fs,
    () => cancelled,
    () => {
      cancelled = true;
    },
  );
  assert.deepEqual(listed, ['/']);
});

test('failed parallel work settles active writes before cleanup can begin', async () => {
  let active = 0;
  const started: number[] = [];
  const failure = new Error('Disk denied');
  await assert.rejects(
    mapProjectIO(
      Array.from({length: 100}, (_, i) => i),
      async index => {
        started.push(index);
        active++;
        try {
          await setImmediate();
          if (index === 0) throw failure;
        } finally {
          active--;
        }
      },
    ),
    error => error === failure,
  );
  assert.equal(active, 0);
  assert.ok(started.length <= 16);
});

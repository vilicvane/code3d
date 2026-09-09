import {defined} from '../../../test/assert.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let openDirectoryProjectFileSystem: (typeof import('../src/project/filesystem.ts'))['openDirectoryProjectFileSystem'];
let server: Awaited<ReturnType<typeof createAppTestServer>>,
  DirectoryFileReader: (typeof import('../src/project/file-reader.ts'))['DirectoryFileReader'];
before(async () => {
  server = await createAppTestServer();
  ({DirectoryFileReader} = await server.ssrLoadModule<
    typeof import('../src/project/file-reader.ts')
  >('/src/project/file-reader.ts'));
  ({openDirectoryProjectFileSystem} = await server.ssrLoadModule<
    typeof import('../src/project/filesystem.ts')
  >('/src/project/filesystem.ts'));
});
after(async () => server?.close());

type DirectoryEntries = {[name: string]: File | DirectoryEntries | undefined};
type AccessCall =
  | ['directory', string, FileSystemGetDirectoryOptions?]
  | ['file', string]
  | ['list', string];
function directory(
  entries: DirectoryEntries,
  calls: AccessCall[] = [],
  prefix = '',
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: prefix,
    async getDirectoryHandle(
      name: string,
      options?: FileSystemGetDirectoryOptions,
    ) {
      calls.push(['directory', prefix + '/' + name, options]);
      if (!entries[name] && options?.create) entries[name] = {};
      const value = entries[name];
      if (!value) throw new DOMException('Missing directory', 'NotFoundError');
      if (value instanceof File)
        throw new DOMException('Expected directory', 'TypeMismatchError');
      return directory(value, calls, prefix + '/' + name);
    },
    async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
      calls.push(['file', prefix + '/' + name]);
      if (!entries[name] && options?.create) entries[name] = new File([], name);
      const value = entries[name];
      if (!value) throw new DOMException('Missing file', 'NotFoundError');
      if (!(value instanceof File))
        throw new DOMException('Expected file', 'TypeMismatchError');
      return {
        async getFile() {
          return value;
        },
        async createWritable() {
          let content: string | Blob = '';
          return {
            async write(next: string | Blob) {
              content = next;
            },
            async close() {
              entries[name] = new File([content], name);
            },
            async abort() {},
          };
        },
      } as FileSystemFileHandle;
    },
    async *values() {
      calls.push(['list', prefix || '/']);
      for (const [name, value] of Object.entries(entries)) {
        if (value)
          yield {name, kind: value instanceof File ? 'file' : 'directory'};
      }
    },
  } as unknown as FileSystemDirectoryHandle;
}

test('reads reached package files lazily and observes directory replacements and file changes', async () => {
  const first = new File(['export const value=1'], 'index.js', {
    lastModified: 100,
  });
  const entries: {node_modules: {value?: {'index.js': File}; unreached: {}}} = {
    node_modules: {value: {'index.js': first}, unreached: {}},
  };
  const calls: AccessCall[] = [];
  const reader = new DirectoryFileReader(directory(entries, calls));
  assert.ok(defined(await reader.stat('/node_modules')).kind === 'directory');
  assert.equal(
    new TextDecoder().decode(
      await reader.readFile('/node_modules/value/index.js'),
    ),
    await first.text(),
  );
  assert.equal(
    defined(await reader.stat('/node_modules/value/index.js')).version,
    `100:${first.size}`,
  );
  assert.equal(
    await reader.readFile('/node_modules/value/missing.js'),
    undefined,
  );
  const next = new File(['export const value=2'], 'index.js', {
    lastModified: 200,
  });
  entries.node_modules.value = {'index.js': next};
  assert.equal(
    defined(await reader.stat('/node_modules/value/index.js')).version,
    `200:${next.size}`,
  );
  assert.equal(
    new TextDecoder().decode(
      await reader.readFile('/node_modules/value/index.js'),
    ),
    await next.text(),
  );
  delete entries.node_modules.value;
  assert.equal(await reader.stat('/node_modules/value/index.js'), undefined);
  assert.ok(calls.every(call => !call[1].includes('unreached')));
  assert.ok(
    calls
      .filter(call => call[0] === 'directory')
      .every(call => defined(call[2]).create === false),
  );
});

test('propagates permission and unreadable-link errors instead of treating them as missing files', async () => {
  for (const name of [
    'NotAllowedError',
    'SecurityError',
    'UnknownError',
  ] as const) {
    const failure = new DOMException('Cannot access entry', name);
    const reader = new DirectoryFileReader({
      kind: 'directory',
      name: '',
      async getFileHandle() {
        throw failure;
      },
    } as unknown as FileSystemDirectoryHandle);
    await assert.rejects(
      reader.readFile('/file.ts'),
      error => error === failure,
    );
    await assert.rejects(reader.stat('/file.ts'), error => error === failure);
  }
});

test('initialization and unchanged examples never enumerate or read project sources', async () => {
  const calls: AccessCall[] = [];
  const entries: DirectoryEntries = {
    '.code3d': {
      'project.json': new File(
        [
          JSON.stringify({
            version: 2,
            managedDirectories: {'/examples': 'current'},
          }),
        ],
        'project.json',
      ),
    },
    'model.ts': new File(['export default 1'], 'model.ts'),
    unopened: Object.fromEntries(
      Array.from({length: 2000}, (_, index) => [
        `${index}.ts`,
        new File(['unopened'], `${index}.ts`),
      ]),
    ),
  };
  const fs = await openDirectoryProjectFileSystem(directory(entries, calls));
  await fs.initialize(async () => {
    throw new Error('Existing project must not be seeded');
  });
  await fs.syncDirectory({
    directory: '/examples',
    revision: 'current',
    files: [],
  });
  assert.ok(
    calls.every(call => call[0] !== 'list' && call[1].startsWith('/.code3d')),
  );
  calls.length = 0;
  const names = await fs.list('/');
  assert.ok(names.some(entry => entry.name === 'unopened'));
  assert.deepEqual(calls, [['list', '/']]);
  calls.length = 0;
  assert.equal(
    new TextDecoder().decode(await fs.readFile('/model.ts')),
    'export default 1',
  );
  assert.deepEqual(calls, [['file', '/model.ts']]);
});

test('a non-source file prevents seeding an existing directory', async () => {
  const entries: DirectoryEntries = {
    'README.md': new File(['User documentation'], 'README.md'),
  };
  const fs = await openDirectoryProjectFileSystem(directory(entries));
  await fs.initialize(async () => {
    throw new Error('Must preserve the existing workspace');
  });
  assert.equal(
    new TextDecoder().decode(await fs.readFile('/README.md')),
    'User documentation',
  );
  assert.equal(await fs.stat('/model.ts'), undefined);
});

test('parallel reads share in-flight parent handles and file snapshots without stale caching', async () => {
  const calls: AccessCall[] = [];
  const entries = {
    src: {'a.ts': new File(['a'], 'a.ts'), 'b.ts': new File(['b'], 'b.ts')},
  };
  const reader = new DirectoryFileReader(directory(entries, calls));
  const [a, b, info] = await Promise.all([
    reader.readFile('/src/a.ts'),
    reader.readFile('/src/b.ts'),
    reader.stat('/src/a.ts'),
  ]);
  assert.equal(new TextDecoder().decode(a), 'a');
  assert.equal(new TextDecoder().decode(b), 'b');
  assert.equal(info?.kind, 'file');
  assert.equal(calls.filter(call => call[0] === 'directory').length, 1);
  assert.equal(calls.filter(call => call[0] === 'file').length, 2);
  entries.src['a.ts'] = new File(['changed'], 'a.ts');
  assert.equal(
    new TextDecoder().decode(await reader.readFile('/src/a.ts')),
    'changed',
  );
});

import {defined} from '../../../test/assert.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>,
  DirectoryFileReader: (typeof import('../src/project/file-reader.ts'))['DirectoryFileReader'];
before(async () => {
  server = await createAppTestServer();
  ({DirectoryFileReader} = await server.ssrLoadModule<
    typeof import('../src/project/file-reader.ts')
  >('/src/project/file-reader.ts'));
});
after(async () => server?.close());

type DirectoryEntries = {[name: string]: File | DirectoryEntries | undefined};
type AccessCall =
  ['directory', string, FileSystemGetDirectoryOptions?] | ['file', string];
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
      const value = entries[name];
      if (!value) throw new DOMException('Missing directory', 'NotFoundError');
      if (value instanceof File)
        throw new DOMException('Expected directory', 'TypeMismatchError');
      return directory(value, calls, prefix + '/' + name);
    },
    async getFileHandle(name: string) {
      calls.push(['file', prefix + '/' + name]);
      const value = entries[name];
      if (!value) throw new DOMException('Missing file', 'NotFoundError');
      if (!(value instanceof File))
        throw new DOMException('Expected file', 'TypeMismatchError');
      return {
        async getFile() {
          return value;
        },
      } as FileSystemFileHandle;
    },
    values() {
      throw new Error('Reader must not enumerate directories');
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

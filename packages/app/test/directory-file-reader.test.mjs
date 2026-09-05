import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createAppTestServer} from './vite-test-server.mjs';

let server, DirectoryFileReader;
before(async () => {
  server = await createAppTestServer();
  ({DirectoryFileReader} = await server.ssrLoadModule(
    '/src/project/file-reader.ts',
  ));
});
after(async () => server?.close());

function directory(entries, calls = [], prefix = '') {
  return {
    async getDirectoryHandle(name, options) {
      calls.push(['directory', prefix + '/' + name, options]);
      const value = entries[name];
      if (!value) throw new DOMException('Missing directory', 'NotFoundError');
      if (value instanceof File)
        throw new DOMException('Expected directory', 'TypeMismatchError');
      return directory(value, calls, prefix + '/' + name);
    },
    async getFileHandle(name) {
      calls.push(['file', prefix + '/' + name]);
      const value = entries[name];
      if (!value) throw new DOMException('Missing file', 'NotFoundError');
      if (!(value instanceof File))
        throw new DOMException('Expected file', 'TypeMismatchError');
      return {
        async getFile() {
          return entries[name];
        },
      };
    },
    values() {
      throw new Error('Reader must not enumerate directories');
    },
  };
}

test('reads reached package files lazily and observes directory replacements and file changes', async () => {
  const first = new File(['export const value=1'], 'index.js', {
    lastModified: 100,
  });
  const entries = {node_modules: {value: {'index.js': first}, unreached: {}}};
  const calls = [];
  const reader = new DirectoryFileReader(directory(entries, calls));
  assert.equal((await reader.stat('/node_modules')).kind, 'directory');
  assert.equal(
    new TextDecoder().decode(
      await reader.readFile('/node_modules/value/index.js'),
    ),
    await first.text(),
  );
  assert.equal(
    (await reader.stat('/node_modules/value/index.js')).version,
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
    (await reader.stat('/node_modules/value/index.js')).version,
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
      .every(call => call[2].create === false),
  );
});

test('propagates permission and unreadable-link errors instead of treating them as missing files', async () => {
  for (const name of ['NotAllowedError', 'SecurityError', 'UnknownError']) {
    const failure = new DOMException('Cannot access entry', name);
    const reader = new DirectoryFileReader({
      async getFileHandle() {
        throw failure;
      },
    });
    await assert.rejects(
      reader.readFile('/file.ts'),
      error => error === failure,
    );
    await assert.rejects(reader.stat('/file.ts'), error => error === failure);
  }
});

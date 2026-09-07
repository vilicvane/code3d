import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {SourceRef} from '@code3d/core/tooling';
import type {AgentResponse, ApplyInput} from '@code3d/agent';
import type {ProjectFileSystem} from '../src/project/filesystem.ts';
import type {AgentProjectEditor} from '../src/agent/project-session.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let AgentProjectSession: typeof import('../src/agent/project-session.ts').AgentProjectSession;
let resolveAgentCursor: typeof import('../src/agent/cursor.ts').resolveAgentCursor;
before(async () => {
  server = await createAppTestServer();
  ({AgentProjectSession} = await server.ssrLoadModule<
    typeof import('../src/agent/project-session.ts')
  >('/src/agent/project-session.ts'));
  ({resolveAgentCursor} = await server.ssrLoadModule<
    typeof import('../src/agent/cursor.ts')
  >('/src/agent/cursor.ts'));
});
after(async () => server?.close());

function fixture(
  options: {
    resolve?: (
      source: string,
      cursor: Parameters<typeof resolveAgentCursor>[1],
    ) => Promise<ReturnType<typeof resolveAgentCursor>>;
    observe?: () => Promise<AgentResponse>;
  } = {},
) {
  const disk = new Map([
    ['/model.ts', 'const model = 1;'],
    ['/lib.ts', 'export const value = 2;'],
  ]);
  const documents = new Map(
    [...disk].map(([path, content]) => [path, {content, version: '1'}]),
  );
  const cursors = new Map<string, SourceRef>();
  const writes: string[] = [];
  const failing = new Set<string>();
  const errors: string[] = [];
  let clock = 1;
  const fileSystem: ProjectFileSystem = {
    async readFile(path) {
      const text = disk.get(path);
      return text === undefined ? undefined : new TextEncoder().encode(text);
    },
    async stat(path) {
      if (disk.has(path))
        return {
          kind: 'file',
          version: 'disk',
          size: new TextEncoder().encode(disk.get(path)).length,
        };
      if (
        path === '/' ||
        [...disk.keys()].some(file => file.startsWith(path + '/'))
      )
        return {kind: 'directory', version: ''};
      return undefined;
    },
    async list(path) {
      const prefix = path === '/' ? '/' : path + '/';
      const entries = new Map<string, 'file' | 'directory'>();
      for (const file of disk.keys())
        if (file.startsWith(prefix)) {
          const tail = file.slice(prefix.length);
          entries.set(
            tail.split('/')[0],
            tail.includes('/') ? 'directory' : 'file',
          );
        }
      return [...entries].map(([name, kind]) => ({name, kind}));
    },
    async writeFile(path, content) {
      if (failing.has(path)) throw new Error('Disk denied write.');
      writes.push(path);
      disk.set(path, content);
    },
    async remove(path) {
      if (failing.has(path)) throw new Error('Disk denied removal.');
      writes.push(path);
      disk.delete(path);
    },
    async rename(from, to) {
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    },
    async initialize() {
      return editor.project();
    },
    async syncDirectory() {
      return editor.project();
    },
    async resetDirectory() {
      return editor.project();
    },
    async createDirectory() {},
  };
  const editor: AgentProjectEditor = {
    project: () => ({
      files: [...documents].map(([path, value]) => ({
        path,
        source: value.content,
      })),
    }),
    fileState: path => documents.get(path),
    applyFiles(files) {
      for (const file of files) {
        if (file.content === null) {
          documents.delete(file.path);
          session.recordEditorChange({kind: 'delete', path: file.path});
        } else {
          documents.set(file.path, {
            content: file.content,
            version: String(++clock),
          });
          session.recordEditorChange({
            kind: 'content',
            path: file.path,
            source: file.content,
            origin: 'agent',
          });
        }
      }
    },
    setAgentCursor(id, _name, ref) {
      if (ref) cursors.set(id, ref);
      else cursors.delete(id);
    },
    agentCursor: id => ({ref: cursors.get(id), invalid: false}),
  };
  const session = new AgentProjectSession(
    fileSystem,
    editor,
    options.observe ?? (async () => ({ok: true, data: {model: 'observed'}})),
    () => {},
    error => errors.push(error.message),
    options.resolve ??
      (async (source, cursor) => resolveAgentCursor(source, cursor)),
  );
  return {
    disk,
    documents,
    writes,
    errors,
    failing,
    cursors,
    session,
    apply: (input: ApplyInput, agent = 'alice') =>
      session.handle(agent, agent, {operation: 'apply', input}),
    read: async (path: string) =>
      body(
        await session.handle('alice', 'Alice', {operation: 'fs.read', path}),
      ),
    edit(path: string, content: string) {
      documents.set(path, {content, version: String(++clock)});
      session.recordEditorChange({
        kind: 'content',
        path,
        source: content,
        origin: 'user',
      });
    },
  };
}
function body(response: AgentResponse): {
  content: string;
  version: string;
  saved: boolean;
} {
  assert.equal(response.ok, true, JSON.stringify(response));
  return (response as Extract<AgentResponse, {ok: true}>).data as ReturnType<
    typeof body
  >;
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return {promise, resolve};
}

test('two agents sharing a file version cannot silently overwrite each other', async () => {
  const f = fixture();
  const {version} = await f.read('/model.ts');
  const first = await f.apply({
    files: [{path: '/model.ts', version, content: 'const model = 3;'}],
  });
  assert.ok(first.ok);
  const second = await f.apply(
    {files: [{path: '/model.ts', version, content: 'const model = 4;'}]},
    'bob',
  );
  assert.ok(!second.ok && second.error.code === 'version_conflict');
  assert.equal(f.disk.get('/model.ts'), 'const model = 3;');
  assert.deepEqual(f.writes, ['/model.ts']);
});

test('unrelated file edits do not invalidate a file version', async () => {
  const f = fixture();
  const {version} = await f.read('/model.ts');
  f.edit('/lib.ts', 'export const value = 8;');
  assert.ok(
    (
      await f.apply({
        files: [{path: '/model.ts', version, content: 'const model = 5;'}],
      })
    ).ok,
  );
});

test('user edits during asynchronous cursor preflight reject the entire batch', async () => {
  const started = gate<void>();
  const finish = gate<void>();
  const f = fixture({
    resolve: async (source, cursor) => {
      started.resolve();
      await finish.promise;
      return resolveAgentCursor(source, cursor);
    },
  });
  const original = await f.read('/model.ts');
  const pending = f.apply({
    files: [
      {
        path: '/model.ts',
        version: original.version,
        content: 'const model = 9;',
      },
      {path: '/new.ts', version: null, content: 'export const created = true;'},
    ],
    cursor: {file: '/model.ts', regex: '(model)'},
  });
  await started.promise;
  f.edit('/model.ts', 'const model = 12;');
  finish.resolve();
  const result = await pending;
  assert.ok(!result.ok && result.error.code === 'version_conflict');
  await f.session.flush();
  assert.equal(f.disk.get('/model.ts'), 'const model = 12;');
  assert.ok(!f.disk.has('/new.ts'));
});

test('ambiguous post-change cursor rejects file writes, while a new-file cursor resolves', async () => {
  const f = fixture();
  const failed = await f.apply({
    files: [{path: '/new.ts', version: null, content: 'model; model;'}],
    cursor: {file: '/new.ts', regex: '(model)'},
  });
  assert.ok(
    !failed.ok && failed.error.code === 'cursor_ambiguous',
    JSON.stringify(failed),
  );
  assert.deepEqual(f.writes, []);
  assert.ok(
    (
      await f.apply({
        files: [{path: '/new.ts', version: null, content: 'const model = 1;'}],
        cursor: {file: '/new.ts', regex: '(model)'},
      })
    ).ok,
  );
  assert.deepEqual(f.cursors.get('alice'), {
    file: '/new.ts',
    start: 6,
    end: 11,
  });
});

test('partial persistence preserves pending contents and explicit retry saves them', async () => {
  const f = fixture();
  const model = await f.read('/model.ts');
  const lib = await f.read('/lib.ts');
  f.failing.add('/lib.ts');
  const result = await f.apply({
    files: [
      {path: '/model.ts', version: model.version, content: 'const model = 5;'},
      {
        path: '/lib.ts',
        version: lib.version,
        content: 'export const value = 6;',
      },
    ],
  });
  assert.ok(!result.ok && result.error.code === 'save_failed');
  assert.equal((result.error.details as {accepted: boolean}).accepted, true);
  assert.equal((await f.read('/lib.ts')).content, 'export const value = 6;');
  assert.equal((await f.read('/lib.ts')).saved, false);
  assert.equal(f.disk.get('/model.ts'), 'const model = 5;');
  await assert.rejects(f.session.flush());
  f.failing.clear();
  await f.session.retrySaves();
  assert.equal(f.disk.get('/lib.ts'), 'export const value = 6;');
  assert.equal(f.session.hasUnsaved, false);
});

test('external disk changes are detected even when timestamp and byte length agree', async () => {
  const f = fixture();
  const {version} = await f.read('/model.ts');
  f.disk.set('/model.ts', 'const model = 2;');
  const result = await f.apply({
    files: [{path: '/model.ts', version, content: 'const model = 3;'}],
  });
  assert.ok(!result.ok && result.error.code === 'version_conflict');
  assert.deepEqual(f.writes, []);
});

test('create, move and delete validate targets and retain an editable project', async () => {
  const f = fixture();
  const original = await f.read('/model.ts');
  const moved = await f.apply({
    files: [
      {path: '/model.ts', version: original.version, content: null},
      {path: '/nested/model.ts', version: null, content: original.content},
    ],
  });
  assert.ok(moved.ok);
  assert.equal(f.disk.get('/nested/model.ts'), original.content);
  assert.ok(!f.disk.has('/model.ts'));
  const result = await f.apply({
    files: [{path: '/nested', version: null, content: 'no'}],
  });
  assert.ok(!result.ok && result.error.code === 'version_conflict');
  assert.ok(
    !(
      await f.apply({
        files: [{path: '/.code3d/project.json', version: null, content: '{}'}],
      })
    ).ok,
  );
});

test('non-source text files can be read, versioned and updated without entering the source project', async () => {
  const f = fixture();
  assert.ok(
    (
      await f.apply({
        files: [{path: '/data.json', version: null, content: '{"size":10}'}],
      })
    ).ok,
  );
  const file = await f.read('/data.json');
  assert.equal(file.content, '{"size":10}');
  assert.ok(
    (
      await f.apply({
        files: [
          {path: '/data.json', version: file.version, content: '{"size":20}'},
        ],
      })
    ).ok,
  );
  assert.ok(!f.documents.has('/data.json'));
});

test('model observation failures preserve the successful file acceptance result', async () => {
  const f = fixture({
    observe: async () => ({
      ok: false,
      error: {code: 'model_failed', message: 'Invalid geometry.'},
    }),
  });
  const original = await f.read('/model.ts');
  const result = await f.apply({
    files: [
      {
        path: '/model.ts',
        version: original.version,
        content: 'const model = 0;',
      },
    ],
    cursor: {file: '/model.ts', regex: '(model)'},
    render: true,
  });
  assert.ok(!result.ok && result.error.code === 'model_failed');
  assert.equal((result.error.details as {saved: boolean}).saved, true);
  assert.equal(f.disk.get('/model.ts'), 'const model = 0;');
});

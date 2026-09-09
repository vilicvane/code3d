import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {SourceRef} from '@code3d/core/tooling';
import type {AgentCursor, AgentResponse, ApplyInput} from '@code3d/agent';
import type {ProjectFileSystem} from '../src/project/filesystem.ts';
import type {
  AgentProjectEditor,
  AgentUpdate,
} from '../src/agent/project-session.ts';
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
      disk.set(
        path,
        typeof content === 'string'
          ? content
          : new TextDecoder().decode(content),
      );
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
    async initialize() {},
    async syncDirectory() {},
    async resetDirectory() {},
    async createDirectory() {},
  };
  const editor: AgentProjectEditor = {
    currentFile: () => '/model.ts',
    filePaths: () => [...documents.keys()],
    selectedSource: () => undefined,
    project: () => ({
      files: [...documents].map(([path, value]) => ({
        path,
        source: value.content,
      })),
    }),
    fileState: path => documents.get(path),
    moveFiles(from, to) {
      for (const [path, document] of [...documents])
        if (path === from || path.startsWith(from + '/')) {
          documents.delete(path);
          documents.set(to + path.slice(from.length), document);
          session.recordEditorChange({
            kind: 'rename',
            from: path,
            to: to + path.slice(from.length),
          });
        }
    },
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
    inspectType: async () => null,
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
    editor,
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

test('follow updates describe accepted edits before observation and exclude reads and rejected changes', async () => {
  const observed = gate<AgentResponse>();
  const observing = gate<void>();
  const f = fixture({
    observe: () => {
      observing.resolve();
      return observed.promise;
    },
  });
  const updates: AgentUpdate[] = [];
  const unsubscribe = f.session.onAgentUpdate(update => updates.push(update));
  await f.read('/model.ts');
  await f.session.handle('alice', 'Alice', {operation: 'context'});
  const rejected = await f.apply({
    files: [{path: '/model.ts', version: 'wrong', content: 'const model = 3;'}],
  });
  assert.equal(rejected.ok, false);
  assert.equal(updates.length, 0);
  const pending = f.apply({
    cursor: {file: '/model.ts', regex: 'const (model)'},
    render: {view: 'top'},
  });
  await observing.promise;
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].cursor, {file: '/model.ts', start: 6, end: 11});
  assert.equal(updates[0].agentId, 'alice');
  observed.resolve({ok: true, data: {}});
  await pending;
  await f.apply({type: true});
  assert.equal(updates.length, 1);
  unsubscribe();
  await f.apply({cursor: {file: '/model.ts', regex: '(1)'}});
  assert.equal(updates.length, 1);
});

test('context reads the current user target without adopting it or modifying files', async () => {
  const f = fixture({
    observe: async () => {
      throw new Error('Context must not evaluate models.');
    },
  });
  const first = await f.session.handle('alice', 'Alice', {
    operation: 'context',
  });
  assert.deepEqual(first, {
    ok: true,
    data: {file: '/model.ts', revision: 1, cursor: null},
  });
  f.cursors.set('alice', {file: '/model.ts', start: 6, end: 11});
  const selection = {file: '/lib.ts', start: 13, end: 18};
  f.editor.currentFile = () => '/lib.ts';
  f.editor.selectedSource = () => selection;
  const next = await f.session.handle('alice', 'Alice', {operation: 'context'});
  assert.ok(next.ok);
  const data = next.data as {file: string; cursor: AgentCursor};
  assert.equal(data.file, '/lib.ts');
  const resolved = resolveAgentCursor(
    f.documents.get('/lib.ts')!.content,
    data.cursor,
  );
  assert.equal(resolved.text, 'value');
  assert.deepEqual(f.cursors.get('alice'), {
    file: '/model.ts',
    start: 6,
    end: 11,
  });
  assert.deepEqual(f.editor.selectedSource(), selection);
  f.editor.currentFile = () => undefined;
  f.editor.selectedSource = () => undefined;
  assert.deepEqual(
    await f.session.handle('alice', 'Alice', {operation: 'context'}),
    {
      ok: true,
      data: {file: null, revision: 1, cursor: null},
    },
  );
  assert.deepEqual(f.writes, []);
});

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
  const entryUpdates: string[] = [];
  f.session.onEntriesChange(reason => entryUpdates.push(reason));
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
  assert.deepEqual(f.session.unsavedFilePaths(), ['/lib.ts']);
  assert.deepEqual(entryUpdates, ['save']);
  await assert.rejects(f.session.flush());
  f.failing.clear();
  await f.session.retrySaves();
  assert.equal(f.disk.get('/lib.ts'), 'export const value = 6;');
  assert.equal(f.session.hasUnsaved, false);
  assert.deepEqual(f.session.unsavedFilePaths(), []);
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

test('JSON files share the editor revision and agent save path', async () => {
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
  assert.equal(f.documents.get('/data.json')?.content, '{"size":20}');
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

test('explorer moves wait for queued saves and do not enqueue duplicate editor writes', async () => {
  const f = fixture();
  let entriesChanged = 0;
  f.session.onEntriesChange(() => entriesChanged++);
  f.edit('/model.ts', 'const model = 42;');
  await f.session.changeEntries({
    kind: 'move',
    entries: [{from: '/model.ts', to: '/renamed.ts'}],
  });
  await f.session.flush();
  assert.equal(f.disk.get('/renamed.ts'), 'const model = 42;');
  assert.equal(f.documents.get('/renamed.ts')?.content, 'const model = 42;');
  assert.equal(f.disk.has('/model.ts'), false);
  assert.equal(f.documents.has('/model.ts'), false);
  assert.deepEqual(f.writes, ['/model.ts']);
  assert.equal(entriesChanged, 1);
});

test('explorer preflight rejects an entire batch before overwriting a destination', async () => {
  const f = fixture();
  await assert.rejects(
    f.session.changeEntries({
      kind: 'move',
      entries: [
        {from: '/model.ts', to: '/new.ts'},
        {from: '/lib.ts', to: '/model.ts'},
      ],
    }),
    /already exists/,
  );
  assert.deepEqual([...f.disk.keys()], ['/model.ts', '/lib.ts']);
  assert.deepEqual([...f.documents.keys()], ['/model.ts', '/lib.ts']);
});

test('a partial filesystem failure keeps completed moves aligned and remaining sources intact', async () => {
  const f = fixture();
  const rename = f.session.fileSystem.rename.bind(f.session.fileSystem);
  f.session.fileSystem.rename = (from, to) => {
    if (from === '/lib.ts') return Promise.reject(new Error('Move denied'));
    return rename(from, to);
  };
  let entriesChanged = 0;
  f.session.onEntriesChange(() => entriesChanged++);
  await assert.rejects(
    f.session.changeEntries({
      kind: 'move',
      entries: [
        {from: '/model.ts', to: '/moved.ts'},
        {from: '/lib.ts', to: '/library.ts'},
      ],
    }),
    /Move denied/,
  );
  assert.equal(f.disk.has('/model.ts'), false);
  assert.equal(f.documents.has('/model.ts'), false);
  assert.equal(f.disk.get('/moved.ts'), f.documents.get('/moved.ts')?.content);
  assert.equal(f.disk.get('/lib.ts'), f.documents.get('/lib.ts')?.content);
  assert.equal(f.disk.has('/library.ts'), false);
  assert.equal(entriesChanged, 1);
  await f.session.flush();
});

test('unsaved edits block explorer deletion until saving succeeds', async () => {
  const f = fixture();
  f.failing.add('/model.ts');
  f.edit('/model.ts', 'const model = 99;');
  await assert.rejects(f.session.flush(), /unsaved/);
  await assert.rejects(
    f.session.changeEntries({kind: 'remove', paths: ['/model.ts']}),
    /Save pending/,
  );
  assert.equal(f.documents.get('/model.ts')?.content, 'const model = 99;');
  assert.equal(f.disk.get('/model.ts'), 'const model = 1;');
  f.failing.clear();
  await f.session.retrySaves();
  await f.session.changeEntries({
    kind: 'remove',
    paths: ['/model.ts', '/lib.ts'],
  });
  assert.equal(f.disk.size, 0);
  assert.equal(f.documents.size, 0);
});

test('agent changes update open non-source documents and allow removing the last source', async () => {
  const f = fixture();
  f.disk.set('/README.md', '# Before');
  f.documents.set('/README.md', {content: '# Before', version: '1'});
  const version = (await f.read('/README.md')).version;
  const changed = await f.apply({
    files: [{path: '/README.md', version, content: '# After'}],
  });
  assert.equal(changed.ok, true);
  assert.equal(f.documents.get('/README.md')?.content, '# After');
  const files = await Promise.all(
    ['/model.ts', '/lib.ts'].map(async path => ({
      path,
      version: (await f.read(path)).version,
      content: null,
    })),
  );
  assert.equal((await f.apply({files})).ok, true);
  assert.deepEqual([...f.disk.keys()], ['/README.md']);
});

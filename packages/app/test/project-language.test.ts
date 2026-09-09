import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ModelProject} from '../src/project/project.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectLanguageLoader: typeof import('../src/project/project-language.ts').ProjectLanguageLoader;
let ProjectFileCache: typeof import('../src/project/file-cache.ts').ProjectFileCache;
let ProjectPackages: typeof import('../src/project/project-packages.ts').ProjectPackages;
before(async () => {
  server = await createAppTestServer();
  ({ProjectLanguageLoader} = await server.ssrLoadModule<
    typeof import('../src/project/project-language.ts')
  >('/src/project/project-language.ts'));
  ({ProjectFileCache} = await server.ssrLoadModule<
    typeof import('../src/project/file-cache.ts')
  >('/src/project/file-cache.ts'));
  ({ProjectPackages} = await server.ssrLoadModule<
    typeof import('../src/project/project-packages.ts')
  >('/src/project/project-packages.ts'));
});
after(async () => server?.close());

function fixture(extra: Record<string, string> = {}) {
  const files = new Map(
    Object.entries({
      '/package.json': '{"type":"module"}',
      '/node_modules/@code3d/core/package.json':
        '{"type":"module","exports":{"./tooling":"./tooling.d.ts"}}',
      '/node_modules/@code3d/core/tooling.d.ts': 'export {};',
      ...Object.fromEntries(
        ['one', 'two'].flatMap(name => [
          [
            `/node_modules/${name}/package.json`,
            '{"type":"module","types":"index.d.ts"}',
          ],
          [
            `/node_modules/${name}/index.d.ts`,
            `export declare const value: "${name}";\n//# sourceMappingURL=index.d.ts.map`,
          ],
          [
            `/node_modules/${name}/index.d.ts.map`,
            '{"sources":["src/index.ts"]}',
          ],
          [
            `/node_modules/${name}/src/index.ts`,
            `export const value = "${name}";`,
          ],
        ]),
      ),
      ...extra,
    }),
  );
  const reads: string[] = [];
  const reader: ProjectFileReader = {
    async readFile(path) {
      reads.push(path);
      const source = files.get(path);
      return source === undefined
        ? undefined
        : new TextEncoder().encode(source);
    },
    async stat(path) {
      const source = files.get(path);
      return source === undefined ? undefined : {kind: 'file', version: source};
    },
  };
  const cache = new ProjectFileCache(reader);
  const packages = new ProjectPackages(cache, cache);
  const loader = new ProjectLanguageLoader(packages);
  return {
    files,
    reads,
    reader,
    loader,
    async load(source: string, extra: ModelProject['files'] = []) {
      const project = {files: [{path: '/model.ts', source}, ...extra]};
      const changed = await cache.refresh();
      if (await packages.update(project)) loader.reset();
      loader.invalidate(changed);
      let preparations = 0;
      const language = await loader.load(
        project,
        [],
        '/model.ts',
        () => preparations++,
      );
      return {language, preparations};
    },
  };
}

test('source edits reuse parsed dependencies and maps; new imports prepare once and removed imports leave the closure', async () => {
  const state = fixture();
  const source = 'import {value} from "one"; export const size = 1;';
  const cold = await state.load(source);
  assert.equal(cold.preparations, 1);
  assert.ok(
    cold.language.files.some(
      file => file.path === '/node_modules/one/src/index.ts',
    ),
  );
  const declaration = state.loader['program']!.getSourceFile(
    '/node_modules/one/index.d.ts',
  );
  assert.ok(declaration);
  const reads = state.reads.length;
  const warm = await state.load(
    source.replace('size = 1', 'size = value.length + 2'),
  );
  assert.equal(warm.preparations, 0);
  assert.equal(state.reads.length, reads, 'unchanged files are not read again');
  assert.equal(
    state.loader['program']!.getSourceFile('/node_modules/one/index.d.ts'),
    declaration,
    'unchanged dependency syntax is reused',
  );

  const expanded = source + '\nexport {value as second} from "two";';
  const added = await state.load(expanded);
  assert.equal(added.preparations, 1);
  assert.ok(
    added.language.files.some(
      file => file.path === '/node_modules/two/src/index.ts',
    ),
  );
  assert.equal(
    state.loader['program']!.getSourceFile('/node_modules/one/index.d.ts'),
    declaration,
  );
  const removed = await state.load(source);
  assert.equal(removed.preparations, 0);
  assert.ok(
    !removed.language.files.some(
      file => file.path === '/node_modules/two/index.d.ts',
    ),
  );
  assert.ok(
    !removed.language.files.some(
      file => file.path === '/node_modules/two/src/index.ts',
    ),
  );
  assert.equal(
    (await state.load(expanded)).preparations,
    0,
    'an already loaded import reuses its closure',
  );
});

test('external source edits and previously missing files refresh the declaration closure', async () => {
  const state = fixture({'/helper.ts': 'export {value} from "one";'});
  const source =
    'export {value} from "./helper.ts"; export * from "./later.ts";';
  await state.load(source);
  state.files.set('/helper.ts', 'export {value} from "two";');
  state.files.set('/later.ts', 'export const added = 3;');
  const changed = await state.load(source);
  assert.equal(changed.preparations, 1);
  assert.ok(
    changed.language.files.some(
      file => file.path === '/node_modules/two/index.d.ts',
    ),
  );
  assert.ok(
    !changed.language.files.some(
      file => file.path === '/node_modules/one/index.d.ts',
    ),
  );
  assert.ok(
    changed.language.files.some(
      file => file.path === '/later.ts' && file.source.includes('added'),
    ),
  );
  assert.equal((await state.load(source)).preparations, 0);
  state.files.delete('/later.ts');
  const removed = await state.load(source);
  assert.ok(!removed.language.files.some(file => file.path === '/later.ts'));
});

test('declaration and navigation source replacements become visible before the next warm edit', async () => {
  const state = fixture();
  const source = 'export {value} from "one";';
  await state.load(source);
  state.files.set(
    '/node_modules/one/index.d.ts',
    'export declare const value: 42;\n//# sourceMappingURL=index.d.ts.map',
  );
  state.files.set('/node_modules/one/src/index.ts', 'export const value = 42;');
  const changed = await state.load(source);
  assert.equal(changed.preparations, 1);
  assert.ok(
    changed.language.files.some(
      file =>
        file.path.endsWith('/one/index.d.ts') && file.source.includes('42'),
    ),
  );
  assert.ok(
    changed.language.files.some(
      file =>
        file.path.endsWith('/one/src/index.ts') && file.source.includes('42'),
    ),
  );
  assert.equal(
    (await state.load(source + '\nexport const size = 4;')).preparations,
    0,
  );
});

test('changes to an extended config and unsaved tsconfig select the current path mapping', async () => {
  const config = (path: string) =>
    JSON.stringify({compilerOptions: {paths: {shape: [path]}}});
  const state = fixture({
    '/tsconfig.json': '{"extends":"./config.json"}',
    '/config.json': config('./first.ts'),
    '/first.ts': 'export const value = 1;',
    '/second.ts': 'export const value = 2;',
  });
  const source = 'export {value} from "shape";';
  const first = await state.load(source);
  assert.ok(first.language.files.some(file => file.path === '/first.ts'));
  state.files.set('/config.json', config('./second.ts'));
  const second = await state.load(source);
  assert.equal(second.preparations, 1);
  assert.ok(second.language.files.some(file => file.path === '/second.ts'));
  assert.ok(!second.language.files.some(file => file.path === '/first.ts'));
  assert.equal((await state.load(source)).preparations, 0);
  const unsaved = await state.load(source, [
    {path: '/tsconfig.json', source: config('./first.ts')},
  ]);
  assert.ok(unsaved.language.files.some(file => file.path === '/first.ts'));
  assert.ok(!unsaved.language.files.some(file => file.path === '/second.ts'));
  const reverted = await state.load(source);
  assert.ok(reverted.language.files.some(file => file.path === '/second.ts'));
  assert.ok(!reverted.language.files.some(file => file.path === '/first.ts'));
});

test('a failed lazy declaration read is retried without discarding unchanged parsed dependencies', async t => {
  const state = fixture();
  const source = 'export {value} from "one";';
  await state.load(source);
  const original = state.reader.readFile;
  let fail = true;
  t.mock.method(state.reader, 'readFile', async (path: string) => {
    if (path === '/node_modules/two/index.d.ts' && fail) {
      fail = false;
      throw new Error('Temporary type download failure');
    }
    return original(path);
  });
  const expanded = source + '\nexport {value as second} from "two";';
  await assert.rejects(state.load(expanded), /Temporary type download failure/);
  const retried = await state.load(expanded);
  assert.equal(retried.preparations, 1);
  assert.ok(
    retried.language.files.some(
      file => file.path === '/node_modules/two/index.d.ts',
    ),
  );
  assert.equal((await state.load(expanded)).preparations, 0);
});

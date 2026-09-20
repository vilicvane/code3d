import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import type {ModelProject} from '../src/project/project.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectLanguageLoader: typeof import('../src/project/project-language.ts').ProjectLanguageLoader;
let ProjectFileCache: typeof import('../src/project/file-cache.ts').ProjectFileCache;
let ProjectPackages: typeof import('../src/project/project-packages.ts').ProjectPackages;
let ProjectAutoImportLoader: typeof import('../src/project/project-auto-imports.ts').ProjectAutoImportLoader;
before(async () => {
  server = await createAppTestServer();
  ({ProjectLanguageLoader} = await server.ssrLoadModule<
    typeof import('../src/project/project-language.ts')
  >('/src/project/project-language.ts'));
  ({ProjectAutoImportLoader} = await server.ssrLoadModule<
    typeof import('../src/project/project-auto-imports.ts')
  >('/src/project/project-auto-imports.ts'));
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
    index: new ProjectAutoImportLoader(reader, reader),
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
      return {language, preparations, project};
    },
  };
}

test('allows emitted TypeScript syntax while respecting a project opting into erasable syntax', async () => {
  const state = fixture();
  const source = `export function part(width: number) { return width; }
    export namespace part { export const size = 12; }
    enum Size { Small = 12 }
    class Dimensions { constructor(readonly width: number) {} }
    export const result = part(new Dimensions(Size.Small).width) + part.size;`;
  await state.load(source);
  const program = state.loader.typeScriptProgram;
  const file = program.getSourceFile('/model.ts')!;
  assert.deepEqual(program.getSyntacticDiagnostics(file), []);
  assert.deepEqual(program.getSemanticDiagnostics(file), []);

  await state.load(source, [
    {
      path: '/tsconfig.json',
      source: JSON.stringify({compilerOptions: {erasableSyntaxOnly: true}}),
    },
  ]);
  const restricted = state.loader.typeScriptProgram;
  assert.ok(
    restricted
      .getSemanticDiagnostics(restricted.getSourceFile('/model.ts'))
      .some(diagnostic => diagnostic.code === 1294),
  );
});

test('source edits reuse parsed dependencies and maps; new imports prepare once and removed imports leave the closure', async () => {
  const state = fixture();
  const source = 'import {value} from "one"; export const size = 1;';
  const cold = await state.load(source);
  assert.equal(cold.preparations, 1);
  assert.ok(
    cold.language.navigationFiles.some(
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
    added.language.navigationFiles.some(
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
    !removed.language.navigationFiles.some(
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
    changed.language.navigationFiles.some(
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

test('declaration-map sources remain outside the dependency graph until directly imported', async () => {
  const implementation = '/node_modules/one/src/index.ts';
  const state = fixture({
    [implementation]: 'export const value: number = "wrong";',
  });
  const mapped = (await state.load('import {value} from "one"; value;'))
    .language;
  assert.ok(
    mapped.files.some(file => file.path === '/node_modules/one/index.d.ts'),
  );
  assert.ok(mapped.navigationFiles.some(file => file.path === implementation));
  assert.ok(!mapped.files.some(file => file.path === implementation));
  assert.ok(!mapped.rootPaths.includes(implementation));
  assert.equal(
    state.loader['program']!.getSourceFile(implementation),
    undefined,
  );
  const direct = (
    await state.load(
      'import {value} from "./node_modules/one/src/index.ts"; value;',
    )
  ).language;
  assert.ok(direct.files.some(file => file.path === implementation));
  assert.ok(!direct.navigationFiles.some(file => file.path === implementation));
  assert.ok(
    !direct.rootPaths.includes(implementation),
    'an imported source is a dependency, not another root',
  );
  const program = state.loader['program']!;
  assert.ok(
    program
      .getSemanticDiagnostics(program.getSourceFile(implementation)!)
      .some(diagnostic => diagnostic.code === 2322),
  );
});

test('optional export discovery stays isolated, reuses files and follows dependency changes', async () => {
  const state = fixture({
    '/package.json': '{"type":"module","dependencies":{"one":"1"}}',
    '/node_modules/one/index.d.ts':
      'export declare const part: number; declare global { interface String { packageGlobal: number; } }',
  });
  const source = 'export const result = "".packageGlobal;';
  const loadIndex = async () => {
    const {language, project} = await state.load(source);
    return (await state.index.load(project, '/model.ts', language))!;
  };
  const first = await loadIndex();
  assert.ok(first.root.source.includes('"one"'));
  assert.ok(
    first.files.some(file => file.path === '/node_modules/one/index.d.ts'),
  );
  const program = state.loader.typeScriptProgram;
  assert.equal(
    program.getSourceFile('/node_modules/one/index.d.ts'),
    undefined,
  );
  assert.ok(
    program
      .getSemanticDiagnostics(program.getSourceFile('/model.ts'))
      .some(d => d.code === 2339),
  );
  const readCount = () =>
    state.reads.filter(path => path.endsWith('/one/index.d.ts')).length;
  const reads = readCount();
  await loadIndex();
  assert.equal(readCount(), reads, 'warm exports reuse package declarations');
  state.files.set(
    '/package.json',
    '{"type":"module","dependencies":{"two":"1"}}',
  );
  const changed = await loadIndex();
  assert.ok(!changed.root.source.includes('"one"'));
  assert.ok(
    changed.files.some(file => file.path === '/node_modules/two/index.d.ts'),
  );
  assert.ok(
    !changed.files.some(file => file.path === '/node_modules/one/index.d.ts'),
  );
});

test('unused failing and delayed declarations never block mandatory language loading; index failures retry', async t => {
  const state = fixture({
    '/package.json': '{"type":"module","dependencies":{"one":"1","two":"1"}}',
  });
  const original = state.reader.readFile;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  let fail = true;
  t.mock.method(state.reader, 'readFile', async (path: string) => {
    if (path === '/node_modules/one/index.d.ts' && fail) {
      entered();
      await gate;
      throw new Error('Unavailable optional package');
    }
    return original(path);
  });
  const {project, language} = await state.load('export const value = 1;');
  const pending = state.index.load(project, '/model.ts', language);
  await started;
  await state.load('export const value = 2;');
  release();
  const partial = (await pending)!;
  assert.ok(
    partial.failures.some(failure =>
      /Unavailable optional package/.test(failure.message),
    ),
  );
  assert.ok(
    partial.files.some(file => file.path === '/node_modules/two/index.d.ts'),
  );
  // A real dependency must still fail through the mandatory path.
  await assert.rejects(
    state.load('export {value} from "one";'),
    /Unavailable optional package/,
  );
  fail = false;
  const recovered = (await state.index.load(project, '/model.ts', language))!;
  assert.deepEqual(recovered.failures, []);
  assert.ok(
    recovered.files.some(file => file.path === '/node_modules/one/index.d.ts'),
  );
});

test('indexes public subpaths using TypeScript conditions and excludes null or unavailable exports', async () => {
  const state = fixture({
    '/package.json': '{"type":"module","dependencies":{"one":"1"}}',
    '/node_modules/one/package.json': JSON.stringify({
      type: 'module',
      exports: {
        './feature': {
          browser: {types: './browser.d.ts', default: './browser.js'},
          default: './server.d.ts',
        },
        './blocked': null,
        './server': {node: './server.d.ts'},
      },
    }),
    '/node_modules/one/browser.d.ts':
      'export declare const browserPart: number;',
    '/node_modules/one/server.d.ts': 'export declare const serverPart: number;',
  });
  const {project, language} = await state.load('export const value = 1;');
  const index = (await state.index.load(project, '/model.ts', language))!;
  assert.ok(index.root.source.includes('"one/feature"'));
  assert.ok(!index.root.source.includes('"one"'));
  assert.ok(!index.root.source.includes('"one/blocked"'));
  assert.ok(
    index.files.some(file => file.path === '/node_modules/one/browser.d.ts'),
  );
  assert.ok(
    !index.files.some(file => file.path === '/node_modules/one/server.d.ts'),
  );
});

test('superseded export reads cannot publish after a package scope change or reset', async t => {
  const state = fixture({
    '/package.json': '{"type":"module","dependencies":{"one":"1"}}',
    '/nested/package.json': '{"type":"module","dependencies":{"two":"1"}}',
  });
  const original = state.reader.readFile;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  t.mock.method(state.reader, 'readFile', async (path: string) => {
    if (path === '/node_modules/one/index.d.ts') {
      entered();
      await gate;
    }
    return original(path);
  });
  const {project, language} = await state.load('export const value = 1;');
  const obsolete = state.index.load(project, '/model.ts', language);
  await started;
  state.index.reset();
  const latest = state.index.load({files: []}, '/nested/model.ts', {
    ...language,
    packageSpecifiers: ['two'],
  });
  release();
  assert.equal(await obsolete, undefined);
  const result = (await latest)!;
  assert.equal(result.root.path, '/nested/.__code3d-auto-imports.ts');
  assert.ok(
    result.files.some(file => file.path === '/node_modules/two/index.d.ts'),
  );
  assert.ok(
    !result.files.some(file => file.path === '/node_modules/one/index.d.ts'),
  );
});

test('an index cancelled during refresh preserves invalidation for its successor', async t => {
  const state = fixture({
    '/package.json': '{"type":"module","dependencies":{"one":"1"}}',
  });
  const {project, language} = await state.load('export const value = 1;');
  await state.index.load(project, '/model.ts', language);
  const path = '/node_modules/one/index.d.ts';
  state.files.set(path, 'export declare const replacement: 42;');
  const original = state.reader.stat;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  t.mock.method(state.reader, 'stat', async (file: string) => {
    if (file === path) {
      entered();
      await gate;
    }
    return original(file);
  });
  const obsolete = state.index.load(project, '/model.ts', language);
  await started;
  const latest = state.index.load(project, '/model.ts', language);
  release();
  assert.equal(await obsolete, undefined);
  const result = (await latest)!;
  assert.equal(
    result.files.find(file => file.path === path)?.source,
    'export declare const replacement: 42;',
  );
});

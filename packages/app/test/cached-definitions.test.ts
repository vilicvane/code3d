import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {defined} from '../../../test/assert.ts';
import type {ProjectFileReader} from '../src/project/file-reader.ts';
import {
  createTestModelPipeline,
  packageTestFiles,
} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let CachedDefinitionCompiler: (typeof import('../src/project/cached-definitions.ts'))['CachedDefinitionCompiler'];
before(async () => {
  server = await createAppTestServer();
  ({CachedDefinitionCompiler} = await server.ssrLoadModule<
    typeof import('../src/project/cached-definitions.ts')
  >('/src/project/cached-definitions.ts'));
});
after(async () => server?.close());

async function fingerprints(
  source: string,
  additional: Record<string, string> = {},
) {
  const files: Record<string, string> = {
    '/model.ts': source,
    '/core.js': 'export const cached = () => {};',
    '/replicad.js': 'export const definePrimitive = () => {};',
    ...additional,
  };
  const reader: ProjectFileReader = {
    async readFile(path) {
      const text = files[path];
      return text === undefined ? undefined : new TextEncoder().encode(text);
    },
    async stat() {
      return undefined;
    },
  };
  const compiler = new CachedDefinitionCompiler(
    reader,
    async (specifier, importer) => {
      if (specifier === '@code3d/core') return '/core.js';
      if (specifier === '@code3d/core/replicad') return '/replicad.js';
      return new URL(specifier, 'file://' + importer).pathname;
    },
  );
  return [...(await compiler.definitions('/model.ts', source)).values()];
}

test('fingerprints exclude export/position/unused edits and include transitive local helpers', async () => {
  const source = `import {cached} from '@code3d/core';
const scale = 2;
function helper(input: number) {return input * scale;}
export const run = cached((value: number) => helper(value));
const unrelated = 1;`;
  const expected = await fingerprints(source);
  assert.equal(expected.length, 1);
  assert.deepEqual(
    await fingerprints(
      '\n// position change\n' +
        source.replace('export ', '').replace('unrelated = 1', 'unrelated = 4'),
    ),
    expected,
  );
  assert.notDeepEqual(
    await fingerprints(source.replace('scale = 2', 'scale = 3')),
    expected,
  );
  assert.notDeepEqual(
    await fingerprints(source.replace('input * scale', 'input + scale')),
    expected,
  );
});

test('aliases, namespaces and barrels resolve cache factories without matching shadowed names', async () => {
  const sources = [
    `import {cached as memo} from '@code3d/core'; const fn = memo((x: number) => x * 2);`,
    `import * as core from '@code3d/core'; const fn = core.cached((x: number) => x * 2);`,
    `import {cached} from '@code3d/core'; const memo = cached; const fn = memo((x: number) => x * 2);`,
    `import {memo} from './barrel.js'; const fn = memo((x: number) => x * 2);`,
    `import {definePrimitive as primitive} from '@code3d/core/replicad'; const fn = primitive(() => 42);`,
    `const {cached: memo} = require('@code3d/core'); const fn = memo((x: number) => x * 2);`,
    `const core = require('@code3d/core'); const fn = core.cached((x: number) => x * 2);`,
  ];
  for (const source of sources)
    assert.equal(
      (
        await fingerprints(source, {
          '/barrel.js': `export {cached as memo} from '@code3d/core';`,
        })
      ).length,
      1,
    );
  assert.equal(
    (
      await fingerprints(
        `import {cached} from '@code3d/core'; function f(cached: Function) {return cached(() => 42);}`,
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await fingerprints(
        `import {cached} from '@code3d/core'; function f(fn: Function) {return cached(fn);}`,
      )
    ).length,
    0,
  );
});

test('imported static functions resolve through barrels while factory results remain memory-only', async () => {
  const source = `import {cached} from '@code3d/core'; import {build} from './barrel.js'; const fn = cached(build);`;
  const files = {
    '/barrel.js': `export {build} from './build.js';`,
    '/build.js': 'export function build(x) {return x * 2;}',
  };
  assert.equal((await fingerprints(source, files)).length, 1);
  assert.equal(
    (
      await fingerprints(source, {
        ...files,
        '/build.js': 'export const build = createDynamicFunction();',
      })
    ).length,
    0,
  );
  assert.equal(
    (
      await fingerprints(
        `import {cached} from '@code3d/core'; import build from './build.js'; const fn = cached(build);`,
        {'/build.js': 'export default function build(x) {return x * 2;}'},
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await fingerprints(
        `import {memo} from './barrel.js'; const fn = memo(() => 42);`,
        {
          '/barrel.js': `import {cached} from '@code3d/core'; export {cached as memo};`,
        },
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await fingerprints(
        `import {memo} from './barrel.js'; const fn = memo(() => 42);`,
        {
          '/barrel.js': `import {cached} from '@code3d/core'; export const memo = cached;`,
        },
      )
    ).length,
    1,
  );
});

test('captured function and loop environments keep independent memory identities', async () => {
  for (const body of [
    'function make(factor: number) {return cached((x: number) => x * factor);}',
    'function make({factor}: {factor: number}) {return cached((x: number) => x * factor);}',
    'function make(factor: number) {const scale = factor * 2; return cached((x: number) => x * scale);}',
    'for (const factor of [2, 3]) {cached((x: number) => x * factor);}',
  ])
    assert.equal(
      (await fingerprints(`import {cached} from '@code3d/core'; ${body}`))
        .length,
      0,
    );
});

test('static import graph, local codecs and named builders contribute to identity', async () => {
  const source = `import {cached} from '@code3d/core'; import {helper} from './helper.js';
function build(x: number) {return helper(x);}
const encode = (x: number) => new Uint8Array([x]);
const decode = (x: Uint8Array) => x[0];
const fn = cached(build, {encoder: encode, decoder: decode});`;
  const dependencies = {
    '/helper.js': `import {factor} from './factor.js'; export function helper(x) {return factor * x;}`,
    '/factor.js': 'export const factor = 2;',
  };
  const expected = await fingerprints(source, dependencies);
  assert.equal(expected.length, 1);
  assert.notDeepEqual(
    await fingerprints(source, {
      ...dependencies,
      '/factor.js': 'export const factor = 3;',
    }),
    expected,
  );
  assert.notDeepEqual(
    await fingerprints(source.replace('=> x[0]', '=> x[0] + 1'), dependencies),
    expected,
  );
});

test('the prebundled Screws package retains its primitive cache definition', async () => {
  const source = new TextDecoder().decode(
    await packageTestFiles.readFile('/packages/screws/bld/library/index.js'),
  );
  const definitions = await fingerprints(source);
  assert.equal(definitions.length, 1);
  assert.deepEqual(
    await fingerprints('// shifted bundle\n' + source),
    definitions,
  );
});

test('compiled cached/primitive definitions reuse across edits and restore from persistent artifacts', async () => {
  const compiler = await createTestModelPipeline(server);
  const base = `import {cached} from '@code3d/core';
import {definePrimitive, replicad} from '@code3d/core/replicad';
const factor = 2;
function radius(x: number) {return x * factor;}
const data = cached((x: number) => ({radius: radius(x)}), {
  encoder: (value) => new Uint8Array([value.radius]),
  decoder: (bytes) => ({radius: bytes[0]}),
});
const primitive = definePrimitive((r: number) => replicad.makeCylinder(r, 4));
export const part = primitive(data(2).radius);
const unrelated = 1;`;
  let store: import('@code3d/core/tooling').KernelArtifactStore | undefined;
  const compile = (source: string) =>
    compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
      undefined,
      undefined,
      stage => {
        if (stage === 'evaluating-model' && store)
          defined(compiler['runtime']).tooling.setKernelArtifactStore(store);
      },
    );
  try {
    const first = await compile(base);
    assert.equal(first.diagnostic, undefined);
    const tooling = defined(compiler['runtime']).tooling;
    const before = tooling.kernelOperationCacheStats();
    const repeat = await compile(
      '// move\n' +
        base
          .replace('export const part', 'const part')
          .replace('unrelated = 1', 'unrelated = 9'),
    );
    assert.equal(repeat.diagnostic, undefined);
    assert.equal(tooling.kernelOperationCacheStats().misses, before.misses);
    assert.ok(tooling.kernelOperationCacheStats().hits > before.hits);
    const records = new Map<string, Uint8Array>();
    store = {
      get: id => records.get(id),
      set(id, bytes) {
        records.set(id, bytes);
      },
      touch: id => records.has(id),
      getMany(ids: readonly string[]) {
        return ids.map(id => this.get(id));
      },
      touchMany: (ids: readonly string[]) => ids.map(id => records.has(id)),
      delete(id) {
        records.delete(id);
      },
      flush() {},
    };
    await compile(base);
    assert.ok(records.size > 0);
    tooling.clearKernelOperationCache();
    const restored = await compile(base);
    assert.equal(restored.diagnostic, undefined);
    assert.equal(tooling.kernelOperationCacheStats().misses, 0);
    assert.ok(tooling.kernelOperationCacheStats().persistentHits >= 2);
    const changed = await compile(base.replace('factor = 2', 'factor = 3'));
    assert.equal(changed.diagnostic, undefined);
    assert.ok(tooling.kernelOperationCacheStats().misses > 0);
    assert.notDeepEqual(
      changed.fallback?.mesh?.vertices,
      first.fallback?.mesh?.vertices,
    );
  } finally {
    await compiler.dispose();
  }
});

test('CommonJS cached libraries keep their module format and invalidate changed transitive dependencies', async () => {
  const files = new Map(
    Object.entries({
      '/node_modules/radii/package.json': JSON.stringify({
        main: 'index.cjs',
        types: 'index.d.ts',
      }),
      '/node_modules/radii/index.cjs': `const {cached} = require('@code3d/core');
const factor = require('./factor.json'); exports.radius = cached((x) => x * factor);`,
      '/node_modules/radii/index.d.ts':
        'export function radius(value: number): number;',
      '/node_modules/radii/factor.json': '2',
    }),
  );
  const reader: ProjectFileReader = {
    async readFile(path) {
      const source = files.get(path);
      return source === undefined
        ? packageTestFiles.readFile(path)
        : new TextEncoder().encode(source);
    },
    async stat(path) {
      if (files.has(path)) return {kind: 'file', version: files.get(path)!};
      if ([...files.keys()].some(file => file.startsWith(path + '/')))
        return {kind: 'directory', version: 'fixture'};
      return packageTestFiles.stat(path);
    },
  };
  const compiler = await createTestModelPipeline(server, reader);
  const source = `import {box} from '@code3d/core'; import {radius} from 'radii'; export default box(radius(2), 3, 4);`;
  const records = new Map<string, Uint8Array>();
  const store: import('@code3d/core/tooling').KernelArtifactStore = {
    get: id => records.get(id),
    set(id, bytes) {
      records.set(id, bytes);
    },
    touch: id => records.has(id),
    getMany(ids: readonly string[]) {
      return ids.map(id => this.get(id));
    },
    touchMany: (ids: readonly string[]) => ids.map(id => records.has(id)),
    delete(id) {
      records.delete(id);
    },
    flush() {},
  };
  const compile = () =>
    compiler.compile(
      {files: [{path: '/model.ts', source}]},
      '/model.ts',
      undefined,
      undefined,
      stage => {
        if (stage === 'evaluating-model')
          defined(compiler['runtime']).tooling.setKernelArtifactStore(store);
      },
    );
  try {
    const first = await compile();
    assert.equal(first.diagnostic, undefined);
    const runtime = defined(compiler['runtime']);
    assert.equal(
      compiler.artifact!.dependencies.formats.get(
        '/node_modules/radii/index.cjs',
      ),
      'cjs',
    );
    const misses = runtime.tooling.kernelOperationCacheStats().misses;
    assert.equal((await compile()).diagnostic, undefined);
    assert.equal(runtime.tooling.kernelOperationCacheStats().misses, misses);
    assert.ok(records.size > 0);
    files.set('/node_modules/radii/factor.json', '3');
    assert.deepEqual(
      (await compile()).fallback?.mesh?.vertices,
      first.fallback?.mesh?.vertices,
    );
    compiler.compiler.refreshDependencies();
    const changed = await compile();
    assert.equal(changed.diagnostic, undefined);
    assert.notDeepEqual(
      first.fallback?.mesh?.vertices,
      changed.fallback?.mesh?.vertices,
    );
  } finally {
    await compiler.dispose();
  }
});

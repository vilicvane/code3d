import type {ProjectFileReader} from '../src/project/file-reader.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as esbuild from 'esbuild';
import {createAppTestServer} from './vite-test-server.ts';
import {
  importTestModule,
  assertModelDiagnosticError,
} from './project-test-files.ts';

let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ProjectBuilder: (typeof import('../src/project/project-builder.ts'))['ProjectBuilder'];
let ModuleEvaluator: (typeof import('../src/model/module-evaluator.ts'))['ModuleEvaluator'];
before(async () => {
  server = await createAppTestServer();
  ({ProjectBuilder} = await server.ssrLoadModule<
    typeof import('../src/project/project-builder.ts')
  >('/src/project/project-builder.ts'));
  ({ModuleEvaluator} = await server.ssrLoadModule<
    typeof import('../src/model/module-evaluator.ts')
  >('/src/model/module-evaluator.ts'));
});
after(async () => server?.close());

test('builds and executes a reached ESM/CommonJS/JSON dependency graph', async () => {
  const files = new Map(
    Object.entries({
      '/package.json': '{"type":"module"}',
      '/model.ts':
        'import {number} from "value"; import clamp from "clamp"; export const result = await Promise.resolve(clamp(number, 0, 50));',
      '/node_modules/value/package.json':
        '{"exports":{"browser":"./index.js","node":"./node.js"},"type":"module"}',
      '/node_modules/value/index.js':
        'import data from "./data.json"; export const number = data.value;',
      '/node_modules/value/data.json': '{"value":42}',
      '/node_modules/clamp/package.json': '{"main":"index.cjs"}',
      '/node_modules/clamp/index.cjs':
        'module.exports = (x, min, max) => Math.max(min, Math.min(max, x));',
    }),
  );
  const reads = new Set();
  const reader: ProjectFileReader = {
    async readFile(path) {
      reads.add(path);
      const source = files.get(path);
      return source === undefined
        ? undefined
        : new TextEncoder().encode(source);
    },
    async stat(path) {
      if (files.has(path)) return {kind: 'file', version: files.get(path)!};
      if (
        [...files.keys()].some(file =>
          file.startsWith(path === '/' ? '/' : path + '/'),
        )
      )
        return {kind: 'directory', version: ''};
      return undefined;
    },
  };
  const builder = new ProjectBuilder(reader, esbuild);
  const bundle = await builder.build('export * from "/model.ts";');
  const evaluator = new ModuleEvaluator(importTestModule);
  try {
    assert.equal(
      (await evaluator.evaluate('code3d-project:/model.ts', bundle.source))
        .result,
      42,
    );
    assert.ok(bundle.files.includes('/node_modules/value/data.json'));
    assert.ok(!reads.has('/node_modules/value/node.js'));
  } finally {
    evaluator.dispose();
  }
});

test('conditional bare Node builtins remain conditional instead of resolving as npm dependencies', async () => {
  const source =
    'export async function browser(useNode = false) { if (useNode) { return await import("module"); } return 42; }';
  const reader: ProjectFileReader = {
    async readFile(path) {
      if (path === '/model.ts') return new TextEncoder().encode(source);
      return undefined;
    },
    async stat(path) {
      if (path === '/model.ts') return {kind: 'file', version: source};
      if (path === '/') return {kind: 'directory', version: ''};
      return undefined;
    },
  };
  const bundle = await new ProjectBuilder(reader, esbuild).build(
    'export * from "/model.ts"',
  );
  const evaluator = new ModuleEvaluator(importTestModule);
  try {
    const result = await evaluator.evaluate(
      'code3d-project:/model.ts',
      bundle.source,
    );
    assert.equal(await result.browser(), 42);
    await assert.rejects(
      result.browser(true),
      /Node built-in node:module.*browser/,
    );
  } finally {
    evaluator.dispose();
  }
});

test('directory URL bases are not read as file assets, while static files still get managed URLs', async () => {
  const {ProjectAssets} = await server.ssrLoadModule<
    typeof import('../src/project/project-assets.ts')
  >('/src/project/project-assets.ts');
  const assets = new ProjectAssets({
    async stat(path) {
      return path === '/pkg'
        ? {kind: 'directory', version: ''}
        : path === '/pkg/solver.wasm'
          ? {kind: 'file', version: '1'}
          : undefined;
    },
    async readFile(path) {
      assert.equal(path, '/pkg/solver.wasm');
      return new Uint8Array([0]);
    },
  });
  try {
    const result = await assets.rewrite(
      '/pkg/solver.js',
      'const base = new URL("./", import.meta.url); const wasm = new URL("solver.wasm", import.meta.url);',
    );
    assert.match(result, /new URL\("\.\/", import.meta.url\)/);
    assert.match(result, /new URL\("blob:/);
  } finally {
    assets.dispose();
  }
});

test('prepared assets deduplicate concurrent reads and release obsolete resource bytes', async () => {
  const {ProjectAssets} = await server.ssrLoadModule<
    typeof import('../src/project/project-assets.ts')
  >('/src/project/project-assets.ts');
  let version = 1,
    reads = 0;
  const assets = new ProjectAssets({
    async stat() {
      return {kind: 'file', version: String(version)};
    },
    async readFile() {
      reads++;
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Uint8Array([version]);
    },
  });
  try {
    const [first, duplicate] = await Promise.all([
      assets.url('/font.ttf'),
      assets.url('/font.ttf'),
    ]);
    assert.equal(first, duplicate);
    assert.equal(reads, 1);
    assert.deepEqual(assets.read(new URL(first)), new Uint8Array([1]));
    version++;
    const second = await assets.url('/font.ttf');
    assert.notEqual(first, second);
    assert.equal(assets.read(new URL(first)), undefined);
    assert.deepEqual(assets.read(new URL(second)), new Uint8Array([2]));
    assets.dispose();
    assert.equal(assets.read(new URL(second)), undefined);
  } finally {
    assets.dispose();
  }
});

test('HTTP assets deduplicate per compilation, refresh bytes and retain their public URLs', async () => {
  const {ProjectAssets} = await server.ssrLoadModule<
    typeof import('../src/project/project-assets.ts')
  >('/src/project/project-assets.ts');
  let reads = 0,
    revision = 1;
  const assets = new ProjectAssets(
    {
      async stat() {
        throw new Error('Remote URLs must not access the project filesystem');
      },
      async readFile() {
        throw new Error('Remote URLs must not access the project filesystem');
      },
    },
    async (input, options) => {
      assert.equal(String(input), 'https://fonts.example/test.ttf');
      assert.equal(options?.mode, 'cors');
      assert.equal(options?.credentials, 'omit');
      reads++;
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Response(new Uint8Array([revision]));
    },
  );
  const url = new URL('https://fonts.example/test.ttf');
  const source = `const resource = new URL('${url}');`;
  try {
    const results = await Promise.all([
      assets.rewrite('/model.ts', source),
      assets.rewrite(
        '/font.ts',
        `const resource = new URL('${url}', import.meta.url);`,
      ),
    ]);
    assert.equal(reads, 1);
    assert.equal(results[0], results[1]);
    assert.match(results[0], /https:\/\/fonts.example\/test.ttf/);
    assert.deepEqual(assets.read(url), new Uint8Array([1]));
    await assets.rewrite('/other.ts', source);
    assert.equal(reads, 1);
    revision++;
    assets.beginCompilation();
    assert.equal(assets.read(url), undefined);
    await assets.rewrite('/model.ts', source);
    assert.equal(reads, 2);
    assert.deepEqual(assets.read(url), new Uint8Array([2]));
    assets.dispose();
    assert.equal(assets.read(url), undefined);
  } finally {
    assets.dispose();
  }
});

test('HTTP asset failures are located and retryable; cancellation aborts the download', async () => {
  const {ProjectAssets} = await server.ssrLoadModule<
    typeof import('../src/project/project-assets.ts')
  >('/src/project/project-assets.ts');
  let fail = true,
    cancelled = false,
    aborted = false,
    hold = true;
  const source = 'const resource = new URL("https://fonts.example/test.ttf");';
  const files = {
    async stat() {
      return undefined;
    },
    async readFile() {
      return undefined;
    },
  };
  const assets = new ProjectAssets(files, async () =>
    fail ? new Response('', {status: 404}) : new Response(new Uint8Array([1])),
  );
  try {
    await assert.rejects(assets.rewrite('/model.ts', source), error => {
      assertModelDiagnosticError(error);
      assert.match(
        error.diagnostic.summary,
        /https:\/\/fonts.example\/test.ttf.*HTTP 404/,
      );
      assert.deepEqual(error.diagnostic.sourceRef, {
        file: '/model.ts',
        start: 17,
        end: source.length - 1,
      });
      return true;
    });
    fail = false;
    await assets.rewrite('/model.ts', source);
    assert.deepEqual(
      assets.read(new URL('https://fonts.example/test.ttf')),
      new Uint8Array([1]),
    );
  } finally {
    assets.dispose();
  }

  let downloadStarted!: () => void;
  const started = new Promise<void>(resolve => {
    downloadStarted = resolve;
  });
  const pending = new ProjectAssets(files, async (_input, options) => {
    downloadStarted();
    if (!hold) return new Response(new Uint8Array([2]));
    return new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(options!.signal!.reason);
        },
        {once: true},
      );
    });
  });
  pending.beginCompilation(() => {
    if (cancelled) throw new Error('Cancelled');
  });
  try {
    const loading = pending.rewrite('/model.ts', source);
    await started;
    cancelled = true;
    await assert.rejects(loading, /Cancelled/);
    assert.equal(aborted, true);
    assert.equal(
      pending.read(new URL('https://fonts.example/test.ttf')),
      undefined,
    );
    hold = cancelled = false;
    pending.beginCompilation();
    await pending.rewrite('/model.ts', source);
    assert.deepEqual(
      pending.read(new URL('https://fonts.example/test.ttf')),
      new Uint8Array([2]),
    );
  } finally {
    pending.dispose();
  }
});

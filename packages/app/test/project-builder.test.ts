import type {ProjectFileReader} from '../src/project/file-reader.ts';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as esbuild from 'esbuild';
import {createAppTestServer} from './vite-test-server.ts';
import {importTestModule} from './project-test-files.ts';

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

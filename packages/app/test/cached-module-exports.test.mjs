import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as esbuild from 'esbuild';
import {createAppTestServer} from './vite-test-server.mjs';
import {importTestModule} from './project-test-files.mjs';

let server;
let ProjectBuilder;
let ModuleEvaluator;
before(async () => {
  server = await createAppTestServer();
  ({ProjectBuilder} = await server.ssrLoadModule(
    '/src/project/project-builder.ts',
  ));
  ({ModuleEvaluator} = await server.ssrLoadModule(
    '/src/model/module-evaluator.ts',
  ));
});
after(async () => server?.close());

function projectFiles(entries) {
  const files = new Map(Object.entries(entries));
  return {
    async readFile(path) {
      const source = files.get(path);
      return source === undefined
        ? undefined
        : new TextEncoder().encode(source);
    },
    async stat(path) {
      if (files.has(path)) return {kind: 'file', version: files.get(path)};
      if (
        [...files.keys()].some(file =>
          file.startsWith(path === '/' ? '/' : path + '/'),
        )
      )
        return {kind: 'directory', version: ''};
    },
  };
}

for (const extension of ['js', 'mjs', 'mts']) {
  test(`retains a cached .mjs default, live bindings and re-exports when imported from .${extension}`, async () => {
    const packagePath = '/node_modules/range/index.mjs';
    const sourcePath = '/model.' + extension;
    const files = projectFiles({
      '/package.json': '{"type":"module"}',
      '/node_modules/range/package.json':
        '{"type":"module","exports":"./index.mjs"}',
      [packagePath]:
        'export let count = 0; export function increment() { count++; range = (n) => Array.from({length:n}, (_, i) => i); } let range = (n) => Array.from({length:n}, (_, i) => i); export {range as default};',
      '/reexport.mjs':
        'export {default as range, count, increment} from "range";',
      [sourcePath]: [
        'import range, {count, increment} from "range";',
        'import * as namespace from "range";',
        'import {range as reexported, count as reexportedCount} from "./reexport.mjs";',
        'const before = count; increment();',
        'export const result = [range(3), before, count, namespace.count, reexportedCount, range === reexported, range === namespace.default];',
        'export const read = () => count;',
      ].join('\n'),
    });
    const builder = new ProjectBuilder(files, esbuild);
    const initial = await builder.build('export * as entry from "range";');
    const evaluator = new ModuleEvaluator(importTestModule);
    try {
      const {entry} = await evaluator.evaluate('dependency.js', initial.source);
      const modules = new Map([[packagePath, entry]]);
      const bundle = await builder.build(
        `export * from ${JSON.stringify(sourcePath)};`,
        {runtimeFiles: initial.formats},
      );
      assert.deepEqual(bundle.staticPackages, [packagePath]);
      let previous;
      for (let revision = 0; revision < 2; revision++) {
        const result = await evaluator.evaluate('model.js', bundle.source, {
          __code3dModules: modules,
        });
        assert.deepEqual(result.result, [
          [0, 1, 2],
          revision,
          revision + 1,
          revision + 1,
          revision + 1,
          true,
          true,
        ]);
        assert.equal(result.read(), revision + 1);
        assert.equal(previous?.read(), revision ? revision + 1 : undefined);
        previous = result;
      }
    } finally {
      evaluator.dispose();
    }
  });
}

for (const source of [
  'export default function range() {return 7;}',
  'export default () => 7;',
  'export {default} from "./child.mjs";',
  'export {value as default} from "./child.mjs";',
  'export * from "./child.mjs";',
]) {
  test(`preserves the default export shape for cached ESM: ${source}`, async () => {
    const packagePath = '/node_modules/exports/index.mjs';
    const files = projectFiles({
      '/node_modules/exports/package.json':
        '{"type":"module","exports":"./index.mjs"}',
      [packagePath]: source,
      '/node_modules/exports/child.mjs':
        'export const value = () => 7; export default value;',
      '/model.mjs': 'export * as entry from "exports";',
    });
    const builder = new ProjectBuilder(files, esbuild);
    const initial = await builder.build('export * as entry from "exports";');
    const evaluator = new ModuleEvaluator(importTestModule);
    try {
      const {entry} = await evaluator.evaluate('initial.js', initial.source);
      const bundle = await builder.build('export * from "/model.mjs";', {
        runtimeFiles: initial.formats,
      });
      const cached = await evaluator.evaluate('cached.js', bundle.source, {
        __code3dModules: new Map([[packagePath, entry]]),
      });
      assert.deepEqual(
        Object.keys(cached.entry).sort(),
        Object.keys(entry).sort(),
      );
      for (const name of Object.keys(entry))
        assert.equal(cached.entry[name], entry[name]);
    } finally {
      evaluator.dispose();
    }
  });
}

test('retains Node-style CommonJS default imports for .mjs consumers', async () => {
  const packagePath = '/node_modules/cjs/index.cjs';
  const files = projectFiles({
    '/node_modules/cjs/package.json': '{"main":"./index.cjs"}',
    [packagePath]: 'module.exports = {__esModule:true, default:7, value:9};',
    '/model.mjs': 'import value from "cjs"; export {value};',
  });
  const builder = new ProjectBuilder(files, esbuild);
  const initial = await builder.build('export * as entry from "cjs";');
  const evaluator = new ModuleEvaluator(importTestModule);
  try {
    const modules = new Map();
    const captured = await builder.build('import "cjs";', {
      captureModules: initial.formats,
    });
    await evaluator.evaluate('initial.js', captured.source, {
      __code3dModules: modules,
      __code3dRecordModule: (path, namespace) => modules.set(path, namespace),
    });
    const original = await builder.build('export * from "/model.mjs";');
    const expected = await evaluator.evaluate('original.js', original.source);
    const bundle = await builder.build('export * from "/model.mjs";', {
      runtimeFiles: initial.formats,
    });
    const actual = await evaluator.evaluate('cached.js', bundle.source, {
      __code3dModules: modules,
    });
    assert.deepEqual(actual.value, expected.value);
    assert.equal(actual.value.default, 7);
    assert.equal(actual.value.value, 9);
  } finally {
    evaluator.dispose();
  }
});

import {transform} from 'esbuild';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {importTestModule} from './project-test-files.ts';
import {createAppTestServer} from './vite-test-server.ts';
let server: Awaited<ReturnType<typeof createAppTestServer>>;
let ModuleEvaluator: (typeof import('../src/model/module-evaluator.ts'))['ModuleEvaluator'];
before(async () => {
  server = await createAppTestServer();
  const {ModuleEvaluator: Evaluator} = await server.ssrLoadModule<
    typeof import('../src/model/module-evaluator.ts')
  >('/src/model/module-evaluator.ts');
  ModuleEvaluator = class extends Evaluator {
    constructor() {
      super(importTestModule);
    }
    override async evaluate(source: string) {
      const {code} = await transform(source, {format: 'esm', target: 'es2022'});
      const {executableModuleSource} = await server.ssrLoadModule<
        typeof import('../src/model/executable-module.ts')
      >('/src/model/executable-module.ts');
      return super.evaluate(executableModuleSource('test.js', code, []));
    }
  };
});
after(async () => server?.close());

test('preserves module-scope object rest destructuring', async () => {
  const evaluator = new ModuleEvaluator();
  try {
    const module = await evaluator.evaluate(
      'export const {x, ...rest} = await Promise.resolve({x: 1, y: 2});',
    );
    assert.equal(module.x, 1);
    assert.deepEqual(module.rest, {y: 2});
  } finally {
    evaluator.dispose();
  }
});

test('evaluates top-level await, live bindings and fresh execution scopes through native ESM', async () => {
  const evaluator = new ModuleEvaluator();
  const url = 'code3d-project:/model.ts';
  const first = await evaluator.evaluate(
    'export let count = await Promise.resolve(1); export function increment() {count++} export const url = import.meta.url;',
  );
  assert.equal(first.count, 1);
  first.increment();
  assert.equal(first.count, 2);
  assert.ok(first.url.startsWith('data:text/javascript'));
  const next = await evaluator.evaluate('export let count = 10;');
  assert.equal(next.count, 10);
  assert.equal(first.count, 2);
  const bytes = evaluator.compiledBytes;
  const repeated = await evaluator.evaluate('export let count = 10;');
  assert.equal(repeated.count, 10);
  assert.equal(evaluator.compiledBytes, bytes);
  evaluator.dispose();
});

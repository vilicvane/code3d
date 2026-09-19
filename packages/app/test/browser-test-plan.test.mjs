import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  browserTestPlan,
  exclusiveBrowserTests,
  positiveInteger,
} from '../scripts/browser-test-plan.mjs';

test('browser test groups are complete, disjoint and keep examples separate', async () => {
  const directory = fileURLToPath(new URL('browser/', import.meta.url));
  const plan = await browserTestPlan(directory);
  assert.deepEqual(plan.examples, ['test/browser/examples.test.ts']);
  assert.deepEqual(plan.isolated, [
    'test/browser/agent-persistence.test.ts',
    'test/browser/agent-workflow.test.ts',
  ]);
  assert.equal(plan.exclusive.length, exclusiveBrowserTests.size);
  const all = [
    ...plan.regular,
    ...plan.exclusive,
    ...plan.examples,
    ...plan.isolated,
  ];
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(
    all.sort(),
    (await readdir(directory))
      .filter(file => /\.test\.(?:mjs|ts)$/.test(file))
      .map(file => `test/browser/${file}`)
      .sort(),
  );
  assert.ok(plan.regular.length > plan.exclusive.length);
  assert.ok(!plan.regular.includes('test/browser/compiler-progress.test.ts'));
});

test('browser concurrency accepts only positive integers', () => {
  assert.equal(positiveInteger('2', 'concurrency'), 2);
  for (const value of ['0', '-1', '1.5', 'many'])
    assert.throws(
      () => positiveInteger(value, 'concurrency'),
      /concurrency must be a positive integer/,
    );
});

import assert from 'node:assert/strict';
import type {SuiteContext, TestContext} from 'node:test';

/** Admit computations in storage/ownership tests without relying on wall-clock speed. */
export function mockComputationTime(context: TestContext | SuiteContext): void {
  assert.ok('mock' in context, 'Install the computation clock inside a test');
  let milliseconds = 0;
  context.mock.method(performance, 'now', () => (milliseconds += 10));
}

import assert from 'node:assert/strict';

/** Require a value that the test scenario promises to produce. */
export function defined<T>(value: T | undefined | null): T {
  assert.ok(value !== undefined && value !== null);
  return value;
}

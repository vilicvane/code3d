import {readdir} from 'node:fs/promises';
import path from 'node:path';

const exampleTest = 'examples.test.ts';
export const isolatedBrowserTests = new Set([
  'agent-persistence.test.ts',
  'agent-workflow.test.ts',
]);

// These tests deliberately exercise wall-clock deadlines, process lifetimes,
// persistent storage, focus-sensitive viewport input, or unusually large browser
// workloads. Running them in a separate serial lane keeps those assertions
// meaningful while ordinary files use bounded parallelism.
export const exclusiveBrowserTests = new Set([
  'animation.test.ts',
  'inputs.test.ts',
  'agent-cancellation.test.ts',
  'agent-follow.test.ts',
  'agent-panel.test.ts',
  'agent-presence.test.ts',
  'agent-render-mode.test.ts',
  'agent-renders.test.ts',
  'agent-serve.test.ts',
  'agent-sketch.test.ts',
  'artifact-store.test.ts',
  'build-artifacts.test.ts',
  'compiler-progress.test.ts',
  'coordinate-semantics.test.ts',
  'large-model-visibility.test.ts',
  'package-install.test.ts',
  'parallel-snapshot.test.ts',
  'persistent-cache.test.ts',
  'viewport-memory.test.ts',
]);

const isBrowserTest = file => /\.test\.(?:mjs|ts)$/.test(file);

export async function browserTestPlan(directory) {
  const all = (await readdir(directory)).filter(isBrowserTest).sort();
  const known = new Set(all);
  for (const file of [
    exampleTest,
    ...isolatedBrowserTests,
    ...exclusiveBrowserTests,
  ]) {
    if (!known.has(file))
      throw new Error(`Browser test classification references missing ${file}`);
  }
  const relative = file => path.posix.join('test/browser', file);
  return {
    regular: all
      .filter(
        file =>
          file !== exampleTest &&
          !isolatedBrowserTests.has(file) &&
          !exclusiveBrowserTests.has(file),
      )
      .map(relative),
    exclusive: all
      .filter(file => exclusiveBrowserTests.has(file))
      .map(relative),
    examples: [relative(exampleTest)],
    isolated: all.filter(file => isolatedBrowserTests.has(file)).map(relative),
  };
}

export function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`${name} must be a positive integer, received ${value}`);
  return number;
}

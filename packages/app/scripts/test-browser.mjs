import process from 'node:process';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {browserTestPlan, positiveInteger} from './browser-test-plan.mjs';
import {
  runBrowserTestGroup,
  writeBrowserTimingReport,
} from './browser-test-runner.mjs';
import {runExampleBrowserTests} from './test-examples.mjs';

const modes = new Set(['regular', 'exclusive', 'isolated', 'full']);

export async function runBrowserTests(mode = 'regular', names = []) {
  if (!modes.has(mode))
    throw new Error(
      `Unknown browser test mode ${mode}; expected regular, exclusive, isolated, or full`,
    );
  if (mode === 'full' && names.length)
    throw new Error(
      'Select individual files with regular, exclusive, or isolated mode',
    );
  const plan = await browserTestPlan(
    fileURLToPath(new URL('../test/browser/', import.meta.url)),
  );
  const regularConcurrency = positiveInteger(
    process.env.CODE3D_BROWSER_TEST_CONCURRENCY ?? '2',
    'CODE3D_BROWSER_TEST_CONCURRENCY',
  );
  const failFast = process.env.CODE3D_BROWSER_TEST_FAIL_FAST !== '0';
  const select = files => {
    if (!names.length) return files;
    const selected = files.filter(file => names.includes(path.basename(file)));
    if (selected.length !== new Set(names).size)
      throw new Error(
        `Selected browser files must belong to ${mode}: ${names}`,
      );
    return selected;
  };
  const regularFiles =
    mode === 'regular' || mode === 'full' ? select(plan.regular) : [];
  const exclusiveFiles =
    mode === 'exclusive' || mode === 'full' ? select(plan.exclusive) : [];
  const isolatedFiles =
    mode === 'isolated' || mode === 'full' ? select(plan.isolated) : [];
  const groups = [];
  const externalWebSocket = process.env.CODE3D_PLAYWRIGHT_WS;
  const cdpEndpoint = externalWebSocket
    ? undefined
    : (process.env.CODE3D_CDP_URL ??
      (process.env.CI ? undefined : 'http://localhost:9222'));
  let sharedBrowser;
  try {
    if (mode !== 'isolated' && !externalWebSocket && !cdpEndpoint)
      sharedBrowser = await chromium.launchServer({headless: true});
    const endpoint = sharedBrowser?.wsEndpoint() ?? externalWebSocket;
    const env = {
      ...(endpoint ? {CODE3D_PLAYWRIGHT_WS: endpoint} : {}),
      ...(cdpEndpoint ? {CODE3D_CDP_URL: cdpEndpoint} : {}),
    };
    if (mode === 'regular' || mode === 'full')
      groups.push(
        await runBrowserTestGroup({
          name: 'regular',
          files: regularFiles,
          concurrency: regularConcurrency,
          failFast,
          env,
        }),
      );
    if (
      (mode === 'exclusive' || mode === 'full') &&
      groups.every(group => group.passed)
    )
      groups.push(
        await runBrowserTestGroup({
          name: 'exclusive',
          files: exclusiveFiles,
          concurrency: 1,
          failFast,
          env,
        }),
      );
    if (mode === 'full' && groups.every(group => group.passed))
      groups.push(
        await runExampleBrowserTests({
          webSocketEndpoint: endpoint,
          cdpEndpoint,
        }),
      );
  } finally {
    await sharedBrowser?.close();
  }
  if (
    (mode === 'isolated' || mode === 'full') &&
    groups.every(group => group.passed)
  ) {
    const isolatedBrowser = await chromium.launchServer({headless: true});
    try {
      groups.push(
        await runBrowserTestGroup({
          name: 'isolated',
          files: isolatedFiles,
          concurrency: 1,
          failFast,
          env: {
            CODE3D_ISOLATED_BROWSER: '1',
            CODE3D_PLAYWRIGHT_WS: isolatedBrowser.wsEndpoint(),
          },
        }),
      );
    } finally {
      await isolatedBrowser.close();
    }
  }
  const report = await writeBrowserTimingReport(groups);
  if (!report.passed) process.exitCode = 1;
  return report;
}

const main =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (main) await runBrowserTests(process.argv[2], process.argv.slice(3));

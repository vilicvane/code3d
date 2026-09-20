import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {prepareExampleArtifacts} from './example-artifacts.mjs';
import {
  appRoot,
  runBrowserTestGroup,
  writeBrowserTimingReport,
} from './browser-test-runner.mjs';

export async function runExampleBrowserTests({
  webSocketEndpoint,
  cdpEndpoint,
} = {}) {
  let server, browser;
  const prepared = await prepareExampleArtifacts();
  try {
    let url = process.env.CODE3D_TEST_URL;
    let endpoint = webSocketEndpoint ?? process.env.CODE3D_PLAYWRIGHT_WS;
    const cdp = endpoint
      ? undefined
      : (cdpEndpoint ??
        process.env.CODE3D_CDP_URL ??
        (process.env.CI ? undefined : 'http://localhost:9222'));
    if (!url) {
      if (!process.env.CI)
        throw new Error(
          'Set CODE3D_TEST_URL to the reserved development server.',
        );
      server = await createServer({
        root: appRoot,
        server: {host: '127.0.0.1', port: 0},
      });
      await server.listen();
      url = server.resolvedUrls.local[0];
    }
    if (!endpoint && !cdp) {
      browser = await chromium.launchServer({headless: true});
      endpoint = browser.wsEndpoint();
    }
    return await runBrowserTestGroup({
      name: 'examples',
      files: ['test/browser/examples.test.ts'],
      concurrency: 1,
      env: {
        CODE3D_TEST_URL: url,
        CODE3D_EXAMPLE_ARTIFACTS: JSON.stringify(prepared),
        ...(endpoint ? {CODE3D_PLAYWRIGHT_WS: endpoint} : {}),
        ...(cdp ? {CODE3D_CDP_URL: cdp} : {}),
      },
    });
  } finally {
    await browser?.close();
    await server?.close();
  }
}

const main =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (main) {
  const group = await runExampleBrowserTests();
  await writeBrowserTimingReport([group]);
  if (!group.passed) process.exitCode = 1;
}

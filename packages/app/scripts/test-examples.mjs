import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {releaseArtifacts} from '../../../scripts/publish-packages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let server, browser;
const artifacts = await releaseArtifacts();
try {
  let url = process.env.CODE3D_TEST_URL;
  let endpoint;
  if (!url) {
    if (!process.env.CI)
      throw new Error(
        'Set CODE3D_TEST_URL to the reserved development server; local tests use host Chrome.',
      );
    server = await createServer({root, server: {host: '127.0.0.1', port: 0}});
    await server.listen();
    url = server.resolvedUrls.local[0];
    browser = await chromium.launchServer({headless: true});
    endpoint = browser.wsEndpoint();
  }
  const status = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', 'test/browser/examples.test.ts'],
      {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          CODE3D_TEST_URL: url,
          CODE3D_EXAMPLE_ARTIFACTS: JSON.stringify(
            artifacts.map(({name, version, tarball, filename, integrity}) => ({
              name,
              version,
              tarball,
              filename,
              integrity,
            })),
          ),
          ...(endpoint ? {CODE3D_PLAYWRIGHT_WS: endpoint} : {}),
        },
      },
    );
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  process.exitCode = status;
} finally {
  await browser?.close();
  await server?.close();
}

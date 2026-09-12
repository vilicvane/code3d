import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  packedApp: {
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
    projectFileSystem: import('../../src/project/filesystem.ts').BrowserProjectFileSystem;
  };
};

test(
  'installed npm tarballs load Core chunks, native assets, text and Screws in a fresh browser',
  {timeout: 180_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const root = new URL('../../../../', import.meta.url);
    const artifacts: {
      name: string;
      version: string;
      filename: string;
      integrity: string;
      directory: string;
    }[] = JSON.parse(
      await readFile(new URL('dist/packages/manifest.json', root), 'utf8'),
    );
    const registry = new Map();
    for (const artifact of artifacts) {
      const manifest = JSON.parse(
        await readFile(
          new URL(artifact.directory + '/package.json', root),
          'utf8',
        ),
      );
      const tarball = `https://registry.npmjs.org/${artifact.name}/-/${artifact.filename}`;
      registry.set('/' + artifact.name, {
        manifest: {...manifest, dist: {tarball, integrity: artifact.integrity}},
        tarball,
        bytes: await readFile(
          new URL('dist/packages/' + artifact.filename, root),
        ),
      });
    }
    const core = registry.get('/@code3d/core').manifest;
    const screws = registry.get('/@code3d/screws').manifest;
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://registry.npmjs.org/**', async route => {
      requests.push(route.request().url());
      const pathname = decodeURIComponent(
        new URL(route.request().url()).pathname,
      ).replace(/\/$/, '');
      for (const [name, item] of registry) {
        if (route.request().url() === item.tarball) {
          await route.fulfill({
            body: item.bytes,
            contentType: 'application/octet-stream',
            headers: {'Access-Control-Allow-Origin': '*'},
          });
          return;
        }
        if (
          pathname === name ||
          pathname === `${name}/${item.manifest.version}`
        ) {
          const metadata =
            pathname === name
              ? {
                  name: item.manifest.name,
                  versions: {[item.manifest.version]: item.manifest},
                  'dist-tags': {latest: item.manifest.version},
                }
              : item.manifest;
          await route.fulfill({
            json: metadata,
            headers: {'Access-Control-Allow-Origin': '*'},
          });
          return;
        }
      }
      await route.continue();
    });
    const fontUrl = new URL('/packed-font.ttf', process.env.CODE3D_TEST_URL)
      .href;
    const fontBytes = await readFile(
      new URL('packages/app/examples/fonts/DejaVuSans.ttf', root),
    );
    await context.route(fontUrl, route =>
      route.fulfill({
        body: fontBytes,
        contentType: 'font/ttf',
        headers: {'Cross-Origin-Resource-Policy': 'same-origin'},
      }),
    );
    const source = `import {font, text, extrude, group} from '@code3d/core';
import {ISO14583 as aggregate} from '@code3d/screws';
import * as ISO14583 from '@code3d/screws/iso14583';
if (aggregate.screw !== ISO14583.screw) throw new Error('Screws subpath identity differs');
export default group([...extrude(text('B8i', font(new URL(${JSON.stringify(fontUrl)})), 10), 2), ISO14583.screw('M3', 8)]);`;
    await context.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body:
          'export const defaultProject = ' +
          JSON.stringify({
            files: [
              {
                path: '/package.json',
                source: JSON.stringify({
                  type: 'module',
                  dependencies: {
                    '@code3d/core': core.version,
                    '@code3d/screws': screws.version,
                  },
                }),
              },
              {path: '/model.ts', source},
            ],
          }) +
          ';',
      }),
    );
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.packedApp = {previewState, projectFileSystem};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    const ready = () =>
      page.waitForFunction(
        () => {
          if (window.packedApp?.previewState.diagnostic)
            throw new Error(
              JSON.stringify(window.packedApp.previewState.diagnostic),
            );
          return (
            document.querySelector('#viewport-status')?.textContent?.trim() ===
            'Ready'
          );
        },
        undefined,
        {timeout: 120_000},
      );
    await ready();
    const installed = await page.evaluate(async () => {
      const files = window.packedApp.projectFileSystem;
      const lock = JSON.parse(
        new TextDecoder().decode(await files.readFile('/code3d-lock.json')),
      );
      return {
        records: Object.values(lock.packages) as {workspace?: string}[],
        entry: new TextDecoder().decode(
          await files.readFile(
            '/node_modules/@code3d/core/bld/library/index.js',
          ),
        ),
      };
    });
    assert.ok(
      installed.records.every(record => !record.workspace),
      'exact versions use installed tarballs, not development substitutions',
    );
    assert.match(installed.entry, /chunks\//);
    assert.ok(
      requests.some(url => url === registry.get('/@code3d/core').tarball),
    );
    assert.ok(requests.every(url => !url.includes('flo-boolean')));
    const count = requests.length;
    await page.reload();
    await ready();
    assert.equal(
      requests.length,
      count,
      'reload reuses the installed lock and package bytes',
    );
    assert.deepEqual(errors, []);
  },
);

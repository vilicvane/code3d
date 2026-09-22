import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after, before, test, type TestContext} from 'node:test';
import {gzipSync} from 'node:zlib';
import {packTar} from 'modern-tar';
import type {PackageManifest} from '../../src/project/package-manifest.ts';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from './browser-connection.ts';

declare const window: Window & {
  compatibilityApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
    projectFileSystem: import('../../src/project/filesystem.ts').ProjectFileSystem;
  };
};

const oldVersion = '0.0.0-upgrade-fixture.1';
const source =
  "import {box} from '@code3d/core';\nexport default box(10, 8, 6);\n";
const authorNotes = '# Keep these project notes\n';
const mismatchName = 'Code3D package version mismatch';
const repository = new URL('../../../../', import.meta.url);
let browser: Browser;

before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL);
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

async function fixture(t: TestContext): Promise<Page> {
  const context = await browser.newContext({
    viewport: {width: 1440, height: 900},
  });
  t.after(() => context.close());
  context.setDefaultTimeout(15_000);
  const errors: string[] = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (
        ['warning', 'error'].includes(message.type()) &&
        /mobx/i.test(message.text())
      )
        errors.push(message.text());
    });
  });
  t.after(() => assert.deepEqual(errors, []));
  await context.route('**/src/project/bundled-examples.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export const bundledExamples = {directory: "/examples", revision: "compatibility-test", files: []};',
    }),
  );
  await context.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.compatibilityApp = {codeEditor, compiler, previewState, projectFileSystem};',
    });
  });
  return context.newPage();
}

async function seed(
  page: Page,
  files: {path: string; source: string}[],
): Promise<void> {
  await page.context().route('**/src/project/default-project.ts*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export const defaultProject = ${JSON.stringify({files})};`,
    }),
  );
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = window.compatibilityApp;
      if (!app) return false;
      if (
        app.previewState.diagnostic &&
        !app.previewState.diagnostic.packageCompatibility
      )
        throw new Error(JSON.stringify(app.previewState.diagnostic));
      return (
        !app.previewState.diagnostic &&
        document.querySelector('#viewport-status')?.textContent?.trim() ===
          'Ready'
      );
    },
    undefined,
    {timeout: 120_000},
  );
  assert.equal(
    await page.getByRole('alert', {name: mismatchName, exact: true}).count(),
    0,
  );
}

async function openMismatchDetails(page: Page, screenshot: string) {
  const notice = page.getByRole('alert', {name: mismatchName, exact: true});
  await notice.waitFor({timeout: 90_000});
  assert.equal(
    await page
      .locator('#project-explorer')
      .getByRole('status', {name: 'Packages', exact: true})
      .getByRole('alert', {name: mismatchName, exact: true})
      .count(),
    1,
    'package compatibility belongs to the shared file explorer package status',
  );
  assert.equal(
    await page
      .locator('#viewport-feedback-stack .package-compatibility-notice')
      .count(),
    0,
  );
  assert.equal(
    await notice
      .locator('details')
      .evaluate(element => element.hasAttribute('open')),
    false,
    'the initial package status keeps details collapsed',
  );
  assert.equal(
    await notice.locator('.package-version').first().isVisible(),
    false,
  );
  if (process.env.CODE3D_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.CODE3D_TEST_SCREENSHOT_DIR}/${screenshot}.png`,
    });
  await notice.getByText('Details', {exact: true}).click();
  await notice.locator('.package-version').first().waitFor();
  if (process.env.CODE3D_TEST_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.CODE3D_TEST_SCREENSHOT_DIR}/${screenshot}-details.png`,
    });
  return notice;
}

type RegistryEntry = {
  manifest: PackageManifest & {name: string; version: string};
  tarball: string;
  bytes: Buffer;
  integrity: string;
};

// Use this build's real published artifacts for recovery. Only the incompatible
// installation is synthetic: it lacks tooling so version detection must happen
// before an old runtime can fail with an unrelated missing-export diagnostic.
async function registryFixture(context: BrowserContext) {
  const artifacts: {
    name: string;
    version: string;
    filename: string;
    integrity: string;
    directory: string;
  }[] = JSON.parse(
    await readFile(new URL('dist/packages/manifest.json', repository), 'utf8'),
  );
  const entries: RegistryEntry[] = await Promise.all(
    artifacts.map(async artifact => ({
      manifest: JSON.parse(
        await readFile(
          new URL(artifact.directory + '/package.json', repository),
          'utf8',
        ),
      ),
      tarball: `https://registry.npmjs.org/${artifact.name}/-/${artifact.filename}`,
      bytes: await readFile(
        new URL('dist/packages/' + artifact.filename, repository),
      ),
      integrity: artifact.integrity,
    })),
  );
  const versions = Object.fromEntries(
    entries.map(entry => [entry.manifest.name, entry.manifest.version]),
  );
  const latest: Record<string, string> = {
    ...versions,
    '@code3d/core': oldVersion,
    '@code3d/materials': oldVersion,
  };
  const coreTags: string[] = [];
  let failCoreDownload = false;
  for (const name of ['@code3d/core', '@code3d/materials']) {
    const manifest = {name, version: oldVersion, type: 'module' as const};
    const body = new TextEncoder().encode(JSON.stringify(manifest));
    const bytes = gzipSync(
      await packTar([
        {
          header: {
            name: 'package/package.json',
            type: 'file',
            size: body.length,
          },
          body,
        },
      ]),
    );
    entries.push({
      manifest,
      tarball: `https://registry.npmjs.org/${name}/-/upgrade-fixture.tgz`,
      bytes,
      integrity:
        'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    });
  }
  await context.route('https://registry.npmjs.org/**', async route => {
    const url = route.request().url();
    const headers = {'Access-Control-Allow-Origin': '*'};
    const archive = entries.find(entry => entry.tarball === url);
    if (archive) {
      if (
        failCoreDownload &&
        archive.manifest.name === '@code3d/core' &&
        archive.manifest.version === versions['@code3d/core']
      ) {
        await route.fulfill({
          status: 503,
          body: 'Temporarily unavailable',
          headers,
        });
        return;
      }
      await route.fulfill({
        body: archive.bytes,
        contentType: 'application/octet-stream',
        headers,
      });
      return;
    }
    const pathname = decodeURIComponent(new URL(url).pathname).replace(
      /\/$/,
      '',
    );
    const metadata = (entry: RegistryEntry) => ({
      ...entry.manifest,
      dist: {tarball: entry.tarball, integrity: entry.integrity},
    });
    const exact = entries.find(
      entry => pathname === `/${entry.manifest.name}/${entry.manifest.version}`,
    );
    if (exact) {
      await route.fulfill({json: metadata(exact), headers});
      return;
    }
    const packages = entries.filter(
      entry => pathname === '/' + entry.manifest.name,
    );
    if (packages.length) {
      const name = packages[0].manifest.name;
      if (name === '@code3d/core') coreTags.push(latest[name]);
      await route.fulfill({
        json: {
          name,
          versions: Object.fromEntries(
            packages.map(entry => [entry.manifest.version, metadata(entry)]),
          ),
          'dist-tags': {latest: latest[name]},
        },
        headers,
      });
      return;
    }
    await route.continue();
  });
  return {
    versions,
    coreTags,
    publishCurrent() {
      Object.assign(latest, versions);
    },
    failCoreDownload(fail: boolean) {
      failCoreDownload = fail;
    },
  };
}

test(
  'browser package updates resolve a new latest tag without pinning it or losing author files and dependency fields',
  {timeout: 240_000},
  async t => {
    const page = await fixture(t);
    // Keep Vite's real bundled package reader, but use production's empty
    // workspace catalog so latest is resolved by the actual npm installer.
    await page.context().route('**/src/project/browser-packages.ts*', route => {
      if (
        new URL(route.request().url()).searchParams.has(
          'compatibility-original',
        )
      )
        return route.continue();
      return route.fulfill({
        contentType: 'text/javascript',
        body: `
          export * from '/src/project/browser-packages.ts?compatibility-original';
          export const developmentWorkspaces = {};
        `,
      });
    });
    const registry = await registryFixture(page.context());
    const {versions} = registry;
    const manifest = {
      name: 'authors-project',
      private: true,
      type: 'module',
      scripts: {check: 'tsc --noEmit'},
      dependencies: {'@code3d/core': 'latest'},
      devDependencies: {'@code3d/materials': 'latest'},
    };
    await seed(page, [
      {path: '/package.json', source: JSON.stringify(manifest, null, 2) + '\n'},
      {path: '/model.ts', source},
      {path: '/README.md', source: authorNotes},
    ]);
    await page.goto(process.env.CODE3D_TEST_URL!);
    const notice = await openMismatchDetails(page, 'browser-package-mismatch');
    const rows = await notice.locator('.package-version').allTextContents();
    for (const name of ['@code3d/core', '@code3d/materials']) {
      assert.ok(
        rows.some(
          row =>
            row.includes(name) &&
            row.includes(oldVersion) &&
            row.includes(versions[name]),
        ),
      );
    }
    assert.match(await notice.innerText(), /Installed[\s\S]*Required/);
    assert.match(await notice.innerText(), /\/package\.json/);
    assert.match(await notice.innerText(), /does not upgrade packages/);
    await notice
      .getByRole('button', {name: 'Clear build cache', exact: true})
      .click();
    await page
      .locator('.package-compatibility-notice[aria-busy="false"]')
      .waitFor();
    assert.match(
      await notice.innerText(),
      new RegExp(oldVersion.replaceAll('.', '\\.')),
    );
    const afterClear = await page.evaluate(async () => {
      const files = window.compatibilityApp.projectFileSystem;
      const text = async (path: string) =>
        new TextDecoder().decode(await files.readFile(path));
      return {
        manifest: JSON.parse(await text('/package.json')),
        notes: await text('/README.md'),
        source: await text('/model.ts'),
      };
    });
    assert.deepEqual(afterClear, {manifest, notes: authorNotes, source});

    registry.publishCurrent();
    registry.failCoreDownload(true);
    await notice
      .getByRole('button', {name: 'Update Code3D packages', exact: true})
      .click();
    // The notice owns the command failure. A build can retain the original
    // mismatch diagnostic, so its summary is not the download-error signal.
    // Installation drains in-flight package downloads before rolling back,
    // so wait within the package-operation budget rather than the UI timeout.
    try {
      await notice
        .locator('.package-compatibility-status[data-error="true"]')
        .waitFor({timeout: 120_000});
    } finally {
      t.diagnostic(
        JSON.stringify(
          await page.evaluate(() => {
            const notice = document.querySelector<HTMLElement>(
              '.package-compatibility-notice',
            );
            const status = notice?.querySelector<HTMLElement>(
              '.package-compatibility-status',
            );
            return {
              diagnostic: window.compatibilityApp.previewState.diagnostic,
              notice: {
                hidden: notice?.hidden,
                busy: notice?.getAttribute('aria-busy'),
                text: notice?.textContent,
                status: status?.textContent,
                statusHidden: status?.hidden,
                error: status?.dataset.error,
              },
              compilerPhase: window.compatibilityApp.compiler.phase,
            };
          }),
        ),
      );
    }
    await page
      .locator('.package-compatibility-notice[aria-busy="false"]')
      .waitFor();
    assert.ok(
      await page.evaluate(
        () =>
          window.compatibilityApp.previewState.diagnostic?.packageCompatibility,
      ),
      'installation failures keep the actionable version mismatch context',
    );
    assert.match(
      await notice.locator('.package-compatibility-status').innerText(),
      /Unable to download @code3d\/core@.*HTTP 503/,
    );
    assert.equal(
      await notice
        .getByRole('button', {name: 'Update Code3D packages', exact: true})
        .isEnabled(),
      true,
    );
    const afterFailure = await page.evaluate(async () => {
      const files = window.compatibilityApp.projectFileSystem;
      const text = async (path: string) =>
        new TextDecoder().decode(await files.readFile(path));
      return {
        source: await text('/model.ts'),
        notes: await text('/README.md'),
        core: JSON.parse(await text('/node_modules/@code3d/core/package.json'))
          .version,
        materials: JSON.parse(
          await text('/node_modules/@code3d/materials/package.json'),
        ).version,
      };
    });
    assert.deepEqual(afterFailure, {
      source,
      notes: authorNotes,
      core: oldVersion,
      materials: oldVersion,
    });
    if (process.env.CODE3D_TEST_SCREENSHOT_DIR)
      await page.screenshot({
        path:
          process.env.CODE3D_TEST_SCREENSHOT_DIR +
          '/browser-package-update-failed.png',
      });
    registry.failCoreDownload(false);
    await notice
      .getByRole('button', {name: 'Update Code3D packages', exact: true})
      .click();
    await ready(page);
    const updated = await page.evaluate(async () => {
      const files = window.compatibilityApp.projectFileSystem;
      const text = async (path: string) =>
        new TextDecoder().decode(await files.readFile(path));
      return {
        manifest: JSON.parse(await text('/package.json')),
        notes: await text('/README.md'),
        source: await text('/model.ts'),
        core: JSON.parse(await text('/node_modules/@code3d/core/package.json'))
          .version,
        materials: JSON.parse(
          await text('/node_modules/@code3d/materials/package.json'),
        ).version,
      };
    });
    assert.deepEqual(updated, {
      manifest,
      notes: authorNotes,
      source,
      core: versions['@code3d/core'],
      materials: versions['@code3d/materials'],
    });
    assert.deepEqual(
      [...new Set(registry.coreTags)],
      [oldVersion, versions['@code3d/core']],
    );
    await page.reload();
    await ready(page);
    assert.equal(
      await page.evaluate(async () => {
        const bytes =
          await window.compatibilityApp.projectFileSystem.readFile(
            '/package.json',
          );
        return JSON.parse(new TextDecoder().decode(bytes)).dependencies[
          '@code3d/core'
        ];
      }),
      'latest',
    );
  },
);

test(
  'local package mismatches identify the owning manifest and recover after external installation and Refresh',
  {timeout: 180_000},
  async t => {
    const page = await fixture(t);
    await seed(page, [
      {path: '/model.ts', source},
      {path: '/README.md', source: authorNotes},
    ]);
    // Use real directory reads and writes with a fresh handle per document.
    // Chrome can crash when an OPFS handle is deserialized from IndexedDB.
    await page.context().route('**/src/project/directory-access.ts*', route => {
      if (
        new URL(route.request().url()).searchParams.has(
          'compatibility-original',
        )
      )
        return route.continue();
      return route.fulfill({
        contentType: 'text/javascript',
        body: `
          export * from '/src/project/directory-access.ts?compatibility-original';
          export async function storedProjectDirectory(workspaceId) {
            return (await navigator.storage.getDirectory()).getDirectoryHandle(workspaceId, {create: true});
          }
        `,
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL!);
    await ready(page);
    const expected = await page.evaluate(
      async ({source, authorNotes, oldVersion}) => {
        const {openDirectoryProjectFileSystem} =
          await import('/src/project/filesystem.ts');
        const {browserPackageFiles} =
          await import('/src/project/browser-packages.ts');
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('compatibility-local', {create: true});
        const files = await openDirectoryProjectFileSystem(root);
        await files.initialize(async () => {});
        await files.writeFile(
          '/parts/package.json',
          JSON.stringify({
            type: 'module',
            dependencies: {'@code3d/core': oldVersion},
          }),
        );
        await files.writeFile('/parts/model.ts', source);
        await files.writeFile('/README.md', authorNotes);
        await files.writeFile(
          '/parts/node_modules/@code3d/core/package.json',
          JSON.stringify({
            name: '@code3d/core',
            version: oldVersion,
            type: 'module',
          }),
        );
        return JSON.parse(
          new TextDecoder().decode(
            await browserPackageFiles.readFile(
              '/node_modules/@code3d/core/package.json',
            ),
          ),
        ).version as string;
      },
      {source, authorNotes, oldVersion},
    );
    const url = new URL(process.env.CODE3D_TEST_URL!);
    url.searchParams.set('workspace', 'compatibility-local');
    url.hash = '/file/parts/model.ts';
    await page.goto(url.href);
    const notice = await openMismatchDetails(page, 'local-package-mismatch');
    const text = await notice.innerText();
    assert.match(text, /@code3d\/core/);
    assert.ok(text.includes(oldVersion));
    assert.ok(text.includes(expected));
    assert.match(text, /\/parts\/package\.json/);
    assert.match(text, /package manager/);
    assert.match(text, /latest/);
    assert.match(text, /Refresh/);
    assert.equal(
      await notice
        .getByRole('button', {name: 'Update Code3D packages', exact: true})
        .count(),
      0,
    );
    await notice
      .getByRole('button', {name: 'Open package.json', exact: true})
      .click();
    await page.waitForFunction(
      () =>
        window.compatibilityApp.codeEditor.currentFile() ===
        '/parts/package.json',
    );
    await page.evaluate(() =>
      window.compatibilityApp.codeEditor.openFile('/parts/model.ts'),
    );
    await notice.waitFor();

    // Development's latest declaration selects the built workspace closure.
    // Replacing the effective local install exercises Refresh without copying
    // thousands of third-party/native files into this directory fixture.
    await page.evaluate(async () => {
      const files = window.compatibilityApp.projectFileSystem;
      await files.writeFile(
        '/parts/package.json',
        JSON.stringify({
          type: 'module',
          dependencies: {'@code3d/core': 'latest'},
        }),
      );
    });
    await notice.getByRole('button', {name: 'Refresh', exact: true}).click();
    await ready(page);
    assert.deepEqual(
      await page.evaluate(async () => {
        const files = window.compatibilityApp.projectFileSystem;
        return {
          source: new TextDecoder().decode(
            await files.readFile('/parts/model.ts'),
          ),
          notes: new TextDecoder().decode(await files.readFile('/README.md')),
        };
      }),
      {source, notes: authorNotes},
    );
  },
);

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {after, before, test, type TestContext} from 'node:test';
import {gunzipSync, gzipSync} from 'node:zlib';
import {packTar, unpackTar} from 'modern-tar';
import {normalizedModelSnapshot} from '../model-snapshot.ts';
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
  compatibilityMarkers(): import('monaco-editor/editor').editor.IMarker[];
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
  await context.route('**/src/editor.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.compatibilityMarkers = () => monaco.editor.getModelMarkers({owner:"code3d-model"});',
    });
  });
  // Keep the bundled reader, but use the production workspace catalog so
  // installed latest declarations are never replaced by development builds.
  await context.route('**/src/project/browser-packages.ts*', route => {
    if (
      new URL(route.request().url()).searchParams.has('compatibility-original')
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

async function ready(page: Page, warning = false): Promise<void> {
  await page.waitForFunction(
    warning => {
      const app = window.compatibilityApp;
      if (!app) return false;
      if (app.previewState.diagnostic)
        throw new Error(JSON.stringify(app.previewState.diagnostic));
      return (
        !app.previewState.diagnostic &&
        document.querySelector('#viewport-status')?.textContent?.trim() ===
          'Ready' &&
        app.compiler.warnings.some(item => item.packageCompatibility) ===
          warning
      );
    },
    warning,
    {timeout: 120_000},
  );
  assert.equal(
    await page.getByRole('note', {name: mismatchName, exact: true}).count(),
    Number(warning),
  );
  if (warning) {
    assert.ok(
      await page.evaluate(
        () => window.compatibilityApp.previewState.module?.objects.size,
      ),
      'version warnings do not prevent rendering a model',
    );
    await page.waitForFunction(() =>
      window
        .compatibilityMarkers()
        .some(
          marker =>
            marker.message.includes('Code3D package version mismatch') &&
            marker.severity === 4,
        ),
    );
    assert.equal(
      await page.evaluate(() =>
        window.compatibilityMarkers().some(marker => marker.severity === 8),
      ),
      false,
      'the editor represents the mismatch as a warning, not an error',
    );
  }
}

async function openMismatchDetails(page: Page, screenshot: string) {
  const notice = page.getByRole('note', {name: mismatchName, exact: true});
  await notice.waitFor({timeout: 90_000});
  assert.equal(
    await page
      .locator('#project-explorer')
      .getByRole('status', {name: 'Packages', exact: true})
      .getByRole('note', {name: mismatchName, exact: true})
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

// Both versions contain real published code. Changing only the package metadata
// isolates version detection from actual compiler/runtime incompatibilities.
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
    const current = entries.find(entry => entry.manifest.name === name)!;
    const manifest = {
      ...current.manifest,
      version: oldVersion,
      ...(name === '@code3d/materials'
        ? {peerDependencies: {'@code3d/core': oldVersion}}
        : {}),
    };
    const body = new TextEncoder().encode(JSON.stringify(manifest));
    const contents = await unpackTar(gunzipSync(current.bytes));
    const bytes = gzipSync(
      await packTar(
        contents.map(entry => {
          const data =
            entry.header.name === 'package/package.json' ? body : entry.data;
          return {
            header: {...entry.header, size: data?.length ?? 0},
            body: data,
          };
        }),
      ),
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
    entries,
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
  'browser version warnings permit renders, edits, cached previews and real errors while updates preserve latest declarations',
  {timeout: 240_000},
  async t => {
    const page = await fixture(t);
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
    await ready(page, true);
    const original = normalizedModelSnapshot(
      await page.evaluate(() =>
        JSON.stringify([
          ...window.compatibilityApp.previewState.module!.objects,
        ]),
      ),
    );
    await page.evaluate(() =>
      window.compatibilityApp.codeEditor.editor
        .getModel()!
        .setValue(
          window.compatibilityApp.codeEditor.editor
            .getModel()!
            .getValue()
            .replace('box(10,', 'box(14,'),
        ),
    );
    await page.waitForFunction(
      () =>
        !window.compatibilityApp.previewState.busy &&
        window.compatibilityApp.previewState.sourceVersion ===
          window.compatibilityApp.codeEditor.sourceVersion(),
    );
    await ready(page, true);
    assert.notEqual(
      normalizedModelSnapshot(
        await page.evaluate(() =>
          JSON.stringify([
            ...window.compatibilityApp.previewState.module!.objects,
          ]),
        ),
      ),
      original,
    );
    await page.evaluate(
      source =>
        window.compatibilityApp.codeEditor.editor.getModel()!.setValue(source),
      source,
    );
    await page.waitForFunction(
      () =>
        !window.compatibilityApp.previewState.busy &&
        window.compatibilityApp.previewState.sourceVersion ===
          window.compatibilityApp.codeEditor.sourceVersion(),
    );
    await ready(page, true);

    // Let the saved preview arrive before background compilation completes, so
    // this verifies restoration instead of merely rebuilding after a reload.
    await page
      .context()
      .route('**/src/model/compiler.worker.ts*', async route => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            `
        const compatibilityPost = self.postMessage.bind(self);
        self.postMessage = (message, ...rest) => {
          if (message.kind === 'compiled') setTimeout(() => compatibilityPost(message, ...rest), 1500);
          else compatibilityPost(message, ...rest);
        };
      `,
        });
      });
    await page.reload();
    await ready(page, true);
    assert.ok(
      await page.evaluate(
        () => window.compatibilityApp.compiler.restored?.module.objects.size,
      ),
      'unchanged installed packages with a different version still restore their cached preview',
    );
    await page.evaluate(() =>
      window.compatibilityApp.codeEditor.editor
        .getModel()!
        .setValue(
          'import {missingCompatibilityFixtureExport} from "@code3d/core"; export default missingCompatibilityFixtureExport();',
        ),
    );
    await page.waitForFunction(
      () => !!window.compatibilityApp.previewState.diagnostic,
    );
    assert.match(
      await page.evaluate(
        () => window.compatibilityApp.previewState.diagnostic!.summary,
      ),
      /missingCompatibilityFixtureExport/,
    );
    assert.ok(
      await page.evaluate(() =>
        window.compatibilityApp.compiler.warnings.some(
          warning => warning.packageCompatibility,
        ),
      ),
    );
    await page.evaluate(
      source =>
        window.compatibilityApp.codeEditor.editor.getModel()!.setValue(source),
      source,
    );
    await page.waitForFunction(
      () =>
        !window.compatibilityApp.previewState.busy &&
        window.compatibilityApp.previewState.sourceVersion ===
          window.compatibilityApp.codeEditor.sourceVersion(),
    );
    await ready(page, true);
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
    assert.match(await notice.innerText(), /Installed[\s\S]*App version/);
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
    // The download failure and version warning are independent of model errors.
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
      await page.evaluate(() =>
        window.compatibilityApp.compiler.warnings.some(
          warning => warning.packageCompatibility,
        ),
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
  'local warnings show npm alias update instructions and clear after refreshing an actual installation',
  {timeout: 180_000},
  async t => {
    const page = await fixture(t);
    // Deliver an old request's warning once more immediately after a newer
    // entry reports no warnings, reproducing an in-flight Worker response.
    await page
      .context()
      .route('**/src/model/compiler.worker.ts*', async route => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            `
        const compatibilityPost = self.postMessage.bind(self);
        let previousCompatibilityWarnings;
        self.postMessage = (message, ...rest) => {
          compatibilityPost(message, ...rest);
          if (message.kind !== 'warnings') return;
          if (message.warnings.length) previousCompatibilityWarnings = message;
          else if (previousCompatibilityWarnings && previousCompatibilityWarnings.id !== message.id)
            compatibilityPost(previousCompatibilityWarnings);
        };
      `,
        });
      });
    const registry = await registryFixture(page.context());
    const archive = registry.entries.find(
      entry =>
        entry.manifest.name === '@code3d/materials' &&
        entry.manifest.version === oldVersion,
    )!;
    const installedFiles = (await unpackTar(gunzipSync(archive.bytes))).flatMap(
      entry =>
        entry.data
          ? [
              {
                path:
                  '/parts/node_modules/surface/' +
                  entry.header.name.replace(/^package\//, ''),
                bytes: Array.from(entry.data),
              },
            ]
          : [],
    );
    const localSource = `import {box} from '@code3d/core';
import {plastic} from 'surface';
export default box(10, 8, 6).material(plastic());
`;
    const manifest = {
      type: 'module',
      dependencies: {surface: 'npm:@code3d/materials@latest'},
    };
    await seed(page, [{path: '/model.ts', source}]);
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
    await page.evaluate(
      async ({installedFiles, localSource, authorNotes, manifest, source}) => {
        const {openDirectoryProjectFileSystem} =
          await import('/src/project/filesystem.ts');
        const root = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('compatibility-local', {create: true});
        const files = await openDirectoryProjectFileSystem(root);
        await files.initialize(async () => {});
        await files.writeFile('/parts/package.json', JSON.stringify(manifest));
        await files.writeFile('/parts/model.ts', localSource);
        await files.writeFile('/model.ts', source);
        await files.writeFile('/README.md', authorNotes);
        for (const file of installedFiles)
          await files.writeFile(file.path, new Uint8Array(file.bytes));
      },
      {installedFiles, localSource, authorNotes, manifest, source},
    );
    const url = new URL(process.env.CODE3D_TEST_URL!);
    url.searchParams.set('workspace', 'compatibility-local');
    url.hash = '/file/parts/model.ts';
    await page.goto(url.href);
    await ready(page, true);
    assert.deepEqual(
      await page.evaluate(() =>
        window
          .compatibilityMarkers()
          .filter(marker =>
            marker.message.includes('Code3D package version mismatch'),
          )
          .map(marker => ({
            file: marker.resource.path,
            line: marker.startLineNumber,
          })),
      ),
      [{file: '/workspace/parts/model.ts', line: 2}],
      'the warning belongs to the surface alias import, not the compatible Core import',
    );
    const notice = await openMismatchDetails(page, 'local-package-mismatch');
    const text = await notice.innerText();
    assert.match(text, /@code3d\/materials/);
    assert.ok(text.includes(oldVersion));
    assert.ok(text.includes(registry.versions['@code3d/materials']));
    assert.match(text, /\/parts\/package\.json/);
    assert.match(text, /npm/);
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

    await page.evaluate(() =>
      window.compatibilityApp.codeEditor.openFile('/model.ts'),
    );
    await page.waitForFunction(
      () =>
        !window.compatibilityApp.previewState.busy &&
        window.compatibilityApp.previewState.file === '/model.ts',
    );
    await ready(page);
    assert.deepEqual(
      await page.evaluate(() => window.compatibilityApp.compiler.warnings),
      [],
      'an old Worker warning cannot contaminate the newly selected entry',
    );
    assert.equal(
      await page.evaluate(() =>
        window
          .compatibilityMarkers()
          .some(marker => marker.resource.path === '/workspace/model.ts'),
      ),
      false,
    );
    await page.evaluate(() =>
      window.compatibilityApp.codeEditor.openFile('/parts/model.ts'),
    );
    await ready(page, true);

    // The package's code is already valid: replacing installed metadata models
    // an external npm update without changing latest or using a dev overlay.
    await page.evaluate(async version => {
      const files = window.compatibilityApp.projectFileSystem;
      const path = '/parts/node_modules/surface/package.json';
      const installed = JSON.parse(
        new TextDecoder().decode(await files.readFile(path)),
      );
      await files.writeFile(path, JSON.stringify({...installed, version}));
    }, registry.versions['@code3d/materials']);
    await notice.getByRole('button', {name: 'Refresh', exact: true}).click();
    await ready(page);
    assert.deepEqual(
      await page.evaluate(async () => {
        const files = window.compatibilityApp.projectFileSystem;
        const text = async (path: string) =>
          new TextDecoder().decode(await files.readFile(path));
        return {
          source: await text('/parts/model.ts'),
          notes: await text('/README.md'),
          manifest: JSON.parse(await text('/parts/package.json')),
        };
      }),
      {source: localSource, notes: authorNotes, manifest},
    );
  },
);

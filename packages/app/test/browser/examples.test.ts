import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {
  chromium,
  type Page,
  type BrowserContext,
  type Browser,
} from 'playwright-core';
import {sourceTokenOffset} from '../../render-samples/source-focus.ts';
import {
  exampleEntries,
  renderSamples,
  sourceContextSets,
} from '../../render-samples/catalog.ts';

declare const window: Window & {
  exampleExport?: number[];
  exampleApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
    sketchEditor: import('../../src/tools/sketch-editor-controller.ts').SketchEditorController;
    viewport: import('../../src/viewport.ts').ModelViewport;
  };
};
let browser: Browser;
const artifacts: {
  name: string;
  version: string;
  tarball: string;
  filename: string;
  integrity: string;
}[] = JSON.parse(process.env.CODE3D_EXAMPLE_ARTIFACTS ?? '[]');
before(async () => {
  assert.ok(process.env.CODE3D_TEST_URL, 'Set CODE3D_TEST_URL');
  browser = process.env.CODE3D_PLAYWRIGHT_WS
    ? await chromium.connect(process.env.CODE3D_PLAYWRIGHT_WS)
    : await chromium.connectOverCDP(
        process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
      );
});
after(async () => browser?.close());
for (const {file} of exampleEntries) {
  test(`App example link: ${file}`, {timeout: 120_000}, async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    if (file.startsWith('npm/') || file.startsWith('assemblies/screw-box/'))
      await useRegistryPackages(context);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => {
      // Monaco cancels its pending tree reveal when a Peek result opens a tab.
      if (
        error.message === 'Canceled' &&
        error.stack?.includes('Delayer.cancel') &&
        error.stack.includes('ReferenceWidget.dispose')
      )
        return;
      errors.push(error.message);
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.exampleApp = {codeEditor, viewport, previewState, sketchEditor};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL + '#/file/examples/' + file);
    await page.waitForFunction(
      () => window.exampleApp && !window.exampleApp.previewState.busy,
      undefined,
      {timeout: 90_000},
    );
    const diagnostic = await page.evaluate(
      () => window.exampleApp.previewState.diagnostic,
    );
    if (diagnostic) console.error(file, diagnostic);
    assert.equal(diagnostic, undefined);
    const result = await page.evaluate(() => {
      const {codeEditor, viewport} = window.exampleApp;
      const module = viewport['module'];
      return {
        file: codeEditor.currentFile(),
        diagnostic: module?.diagnostic,
        hasModule: !!module,
      };
    });
    assert.equal(result.file, '/examples/' + file);
    assert.equal(result.hasModule, true);
    assert.equal(result.diagnostic, undefined);
    const source = await page.evaluate(() =>
      window.exampleApp.codeEditor.editor.getValue(),
    );
    for (const sample of renderSamples.filter(sample => sample.file === file)) {
      for (const focus of [
        sample.focus,
        ...(sourceContextSets[sample.id] ?? []).map(context => context.focus),
      ]) {
        const offset = sourceTokenOffset(source, focus);
        assert.equal(
          await page.evaluate(
            ({file, offset}) =>
              window.exampleApp.viewport.selectBySourceOffset(
                '/examples/' + file,
                offset,
              ),
            {file, offset},
          ),
          true,
          sample.id + ': ' + focus.context,
        );
      }
    }
    if (file.startsWith('npm/') || file.startsWith('assemblies/screw-box/')) {
      const installed = await page.evaluate(async file => {
        const {openBrowserProjectFileSystem} =
          await import('/src/project/filesystem.ts');
        const files = await openBrowserProjectFileSystem();
        const root = '/examples/' + file.slice(0, file.lastIndexOf('/'));
        const lock = JSON.parse(
          new TextDecoder().decode(
            await files.readFile(root + '/code3d-lock.json'),
          ),
        );
        return {
          workspace: lock.workspace,
          core: !!(await files.stat(
            root + '/node_modules/@code3d/core/bld/library/index.d.ts',
          )),
        };
      }, file);
      assert.equal(installed.workspace, undefined);
      assert.equal(
        installed.core,
        true,
        'Published Core definitions are installed into browser storage',
      );
    }
    if (file === 'projects/phone-stand.ts') {
      await page.evaluate(() => {
        const editor = window.exampleApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(editor.getValue().lastIndexOf('phoneStand()') + 2),
        );
        editor.focus();
      });
      for (const [name, value] of [
        ['width', '70'],
        ['angle', '20'],
      ]) {
        const input = page.locator(`input[data-parameter="${name}"]`);
        await input.waitFor();
        assert.equal(await input.inputValue(), '');
        assert.equal(await input.getAttribute('placeholder'), value);
      }
    }
    await editAndUndo(page, file, file === 'sketches/constraints.ts');
    if (file === 'projects/phone-stand.ts') await editAndUndo(page, file, true);
    if (file === 'sketches/mounting-plate.ts') {
      await editAndUndo(page, file, true);
      await verifySketchPresets(page);
    }
    if (file === 'npm/model.ts') await verifyPackageNavigation(page);
    if (file === 'projects/desktop-controller/model.ts')
      await verifyControllerExports(page);
    if (file === 'operations/intersect.ts' || file === 'operations/loft.ts')
      await verifyOperationRecovery(page, file);
    assert.deepEqual(errors, []);
  });
}

async function geometrySignature(page: Page) {
  return page.evaluate(() => {
    const module = window.exampleApp.viewport['module']!;
    // The traced object graph also contains contextual sketch frames. Compare
    // exported geometry recursively, not which helper frames were evaluated.
    const geometry = (
      node: import('@code3d/core/tooling').ModelSnapshotObject,
    ): unknown => ({
      kind: node.kind,
      vertices: node.mesh?.vertices,
      edges: node.mesh?.edges,
      points: node.mesh?.topologyVertices,
      pose: node.compositionTransform,
      children: node.children.map(geometry),
    });
    return JSON.stringify(
      [...module.exports].map(([name, id]) => [
        name,
        geometry(module.objects.get(id)!),
      ]),
    );
  });
}

async function editAndUndo(page: Page, file: string, preferSketch = false) {
  const original = await page.evaluate(() =>
    window.exampleApp.codeEditor.editor.getValue(),
  );
  const geometry = await geometrySignature(page);
  const parameterNames: Record<string, string[]> = {
    box: ['x', 'y', 'z'],
    cylinder: ['radius', 'y'],
    sphere: ['radius'],
    circle: ['radius'],
    rectangle: ['x', 'z'],
    regularPolygon: ['radius', 'sides', 'rotation'],
    regularPrism: ['radius', 'y', 'sides', 'rotation'],
    spacer: ['height', 'radius', 'sides'],
    screwBox: ['gap'],
    screw: ['input', 'length'],
    extrude: ['face', 'distance'],
  };
  const calls = [
    ...original.matchAll(
      new RegExp(
        `(${Object.keys(parameterNames).join('|')})\\(([^()\\n]+)\\)`,
        'g',
      ),
    ),
  ];
  let edit: {offset: number; parameter: string; value: number} | undefined;
  for (const call of preferSketch ? [] : calls) {
    const args = call[2].split(',');
    const index = args.findIndex(arg => /^\s*\d+(?:\.\d+)?\s*$/.test(arg));
    if (index < 0) continue;
    edit = {
      offset:
        call.index! +
        call[1].length +
        1 +
        args.slice(0, index).reduce((n, a) => n + a.length + 1, 0),
      parameter:
        call[1] === 'extrude' && original[call.index! - 1] === '.'
          ? 'distance'
          : parameterNames[call[1]][index],
      value: Number(args[index]),
    };
    break;
  }
  if (edit) {
    await page.evaluate(offset => {
      const editor = window.exampleApp.codeEditor.editor;
      editor.setPosition(editor.getModel()!.getPositionAt(offset));
      editor.focus();
    }, edit.offset);
    const input = page.locator(`input[data-parameter="${edit.parameter}"]`);
    await input.waitFor();
    await input.fill(String(edit.value + 1));
    await input.press('Enter');
  } else {
    assert.ok(
      [
        'sketches/constraints.ts',
        'sketches/mounting-plate.ts',
        'projects/phone-stand.ts',
      ].includes(file),
      'New interactive examples need a representative edit',
    );
    await page.evaluate(() => {
      const editor = window.exampleApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().search(/\bsketch\s*\(/) + 2),
      );
      editor.focus();
    });
    const pointId =
      file === 'sketches/constraints.ts'
        ? 3
        : file === 'projects/phone-stand.ts'
          ? 2
          : 1;
    const point = page.locator(
      `.sketch-canvas circle.local[data-id="${pointId}"]`,
    );
    await point.waitFor();
    const bounds = await point.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 20,
      bounds.y + bounds.height / 2 + 10,
      {steps: 5},
    );
    await page.mouse.up();
  }
  await page.waitForFunction(
    source => window.exampleApp.codeEditor.editor.getValue() !== source,
    original,
  );
  await page.waitForFunction(
    () =>
      !window.exampleApp.previewState.busy &&
      window.exampleApp.previewState.sourceVersion ===
        window.exampleApp.codeEditor.sourceVersion(),
  );
  assert.equal(
    await page.evaluate(() => window.exampleApp.previewState.diagnostic),
    undefined,
  );
  if (edit || preferSketch)
    assert.notEqual(
      await geometrySignature(page),
      geometry,
      'The parameter edit must change geometry',
    );
  await page.evaluate(() => window.exampleApp.codeEditor.editor.focus());
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    source => window.exampleApp.codeEditor.editor.getValue() === source,
    original,
  );
  await page.waitForFunction(
    () =>
      !window.exampleApp.previewState.busy &&
      window.exampleApp.previewState.sourceVersion ===
        window.exampleApp.codeEditor.sourceVersion(),
  );
  assert.equal(
    await page.evaluate(() => window.exampleApp.previewState.diagnostic),
    undefined,
  );
  assert.equal(
    await geometrySignature(page),
    geometry,
    'Undo restores geometry as well as source',
  );
}

test(
  'mounting plate supports agent render, versioned handoff and user Undo',
  {timeout: 120_000},
  async t => {
    const {AgentClient} = await import('@code3d/agent');
    const {createLocalBridge} = await import('../../../cli/src/bridge.ts');
    const {reserveLocalPort} = await import('./local-port.ts');
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.exampleApp = {codeEditor, viewport, previewState, sketchEditor};',
      });
    });
    const path = '/examples/sketches/mounting-plate.ts';
    await page.goto(process.env.CODE3D_TEST_URL + '#/file' + path);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const lease = await reserveLocalPort(t);
    await page.locator('#agents-button').click();
    await page.getByLabel('Local port', {exact: true}).fill(String(lease.port));
    await page.getByLabel('Agent name', {exact: true}).fill('Plate designer');
    await page
      .getByRole('button', {name: 'Add agent & copy prompt', exact: true})
      .click();
    const prompt = await page
      .getByLabel('Agent prompt', {exact: true})
      .inputValue();
    const config = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)![1]);
    await lease.release();
    const bridge = await createLocalBridge(config);
    t.after(() => bridge.close());
    await page.locator('.agent-status[data-state="online"]').waitFor();
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await page
      .getByRole('button', {name: 'Follow Plate designer', exact: true})
      .click();
    const client = await AgentClient.create(config);
    async function request(input: unknown) {
      const {response} = await client.request(input);
      assert.equal(response.ok, true, JSON.stringify(response));
      return (response as {ok: true; data: any}).data;
    }
    const before = await request({operation: 'fs.read', path});
    const content = before.content.replace('box(64, 6, 36)', 'box(72, 6, 36)');
    assert.notEqual(content, before.content);
    const applied = await request({
      operation: 'apply',
      input: {
        files: [{path, version: before.version, content}],
        cursor: {file: path, regex: '(mountingPlate);'},
        render: true,
      },
    });
    assert.ok(applied.observation, 'The agent observes the changed plate');
    const current = await request({operation: 'fs.read', path});
    assert.equal(current.content, content);
    const stale = await client.request({
      operation: 'apply',
      input: {
        files: [{path, version: before.version, content: before.content}],
      },
    });
    assert.equal(
      stale.response.ok,
      false,
      'An old agent version cannot overwrite user work',
    );
    await page.evaluate(() => {
      const editor = window.exampleApp.codeEditor.editor;
      editor.setPosition(
        editor.getModel()!.getPositionAt(editor.getValue().indexOf('72, 6')),
      );
      editor.focus();
    });
    const width = page.locator('input[data-parameter="x"]');
    await width.waitFor();
    await width.fill('80');
    await width.press('Enter');
    await page.waitForFunction(
      () =>
        window.exampleApp.codeEditor.editor
          .getValue()
          .includes('box(80, 6, 36)') && !window.exampleApp.previewState.busy,
    );
    const user = await request({operation: 'fs.read', path});
    assert.ok(user.content.includes('box(80, 6, 36)'));
    assert.notEqual(user.version, current.version);
    await page.evaluate(() => window.exampleApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      source => window.exampleApp.codeEditor.editor.getValue() === source,
      content,
    );
  },
);

async function useRegistryPackages(context: BrowserContext) {
  // A release run supplies the exact archives that passed package validation.
  // URLs and locked integrity stay identical to their eventual public artifacts.
  for (const artifact of artifacts) {
    await context.route(artifact.tarball, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        headers: {'access-control-allow-origin': '*'},
        body: await readFile(artifact.filename),
      });
    });
  }
  // Exercise production resolution while retaining the dev server's inspection
  // hooks. Built-in files stay available; only local npm replacement metadata
  // is removed, so declared packages follow the production registry installation path.
  await context.route('**/*virtual*code3d-browser-packages*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const offset = source.indexOf('export const workspaces =');
    assert.ok(
      offset >= 0,
      'The package environment must expose workspace metadata',
    );
    await route.fulfill({
      response,
      body: source.slice(0, offset) + 'export const workspaces = {};',
    });
  });
}

async function verifyControllerExports(page: Page) {
  await page.evaluate(() => {
    const {codeEditor, viewport} = window.exampleApp;
    const source = codeEditor.editor.getValue();
    viewport.selectBySourceOffset(
      codeEditor.currentFile()!,
      source.indexOf('export default group(') + 'export default '.length,
    );
  });
  for (const format of ['step', 'stl', '3mf'] as const) {
    await page.locator('#viewport-host canvas').focus();
    await page.keyboard.press('Shift+F10');
    await page
      .getByRole('menuitem', {name: 'Export model…', exact: true})
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Export model',
      exact: true,
    });
    await dialog.getByLabel('Format', {exact: true}).selectOption(format);
    await dialog.getByLabel('Up axis', {exact: true}).selectOption('y');
    await page.evaluate(() => {
      window.exampleExport = undefined;
      document.addEventListener(
        'click',
        function capture(event) {
          const link = event.target;
          if (!(link instanceof HTMLAnchorElement) || !link.download) return;
          event.preventDefault();
          document.removeEventListener('click', capture, true);
          // Capture the actual generated file at the download boundary. A remote
          // Windows Chrome cannot write Playwright's Linux artifact directory.
          void fetch(link.href)
            .then(response => response.arrayBuffer())
            .then(bytes => {
              window.exampleExport = Array.from(new Uint8Array(bytes));
            });
        },
        true,
      );
    });
    await dialog
      .getByRole('button', {
        name: 'Export ' + format.toUpperCase(),
        exact: true,
      })
      .click();
    await page.waitForFunction(() => window.exampleExport !== undefined);
    const bytes = Buffer.from(await page.evaluate(() => window.exampleExport!));
    assert.ok(bytes.length > 1000);
    if (format === 'step') {
      assert.match(bytes.toString(), /SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
      const {replicad} = await import('@code3d/core/replicad');
      const shape = await replicad.importSTEP(new Blob([bytes]));
      try {
        const bounds = shape.boundingBox.bounds;
        assert.ok(
          Math.abs(bounds[1][0] - bounds[0][0] - 100) < 1e-3,
          `STEP preserves controller width in millimeters: ${JSON.stringify(bounds)}`,
        );
      } finally {
        shape.delete();
      }
    } else if (format === 'stl') {
      const {STLLoader} = await import('three/addons/loaders/STLLoader.js');
      const geometry = new STLLoader().parse(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
      try {
        geometry.computeBoundingBox();
        assert.ok(
          Math.abs(
            geometry.boundingBox!.max.x - geometry.boundingBox!.min.x - 100,
          ) < 1e-3,
        );
      } finally {
        geometry.dispose();
      }
    } else {
      const {unzipSync, strFromU8} = await import('fflate');
      const xml = strFromU8(unzipSync(bytes)['3D/3dmodel.model']);
      assert.match(xml, /unit="millimeter"/);
      assert.ok((xml.match(/<object\b/g) ?? []).length >= 17);
    }
  }
}

async function verifyOperationRecovery(page: Page, file: string) {
  const original = await page.evaluate(() =>
    window.exampleApp.codeEditor.editor.getValue(),
  );
  const altered = file.endsWith('intersect.ts')
    ? original.replace('originOffset(-7, 0, 0)', 'originOffset(-100, 0, 0)')
    : original.replace('loft([start, via, end])', 'loft([start])');
  assert.notEqual(altered, original);
  await page.evaluate(source => {
    const editor = window.exampleApp.codeEditor.editor;
    editor.executeEdits('example-recovery', [
      {range: editor.getModel()!.getFullModelRange(), text: source},
    ]);
    editor.pushUndoStop();
  }, altered);
  await page.waitForFunction(
    () =>
      !window.exampleApp.previewState.busy &&
      !!window.exampleApp.previewState.diagnostic,
  );
  const diagnostic = await page.evaluate(
    () => window.exampleApp.previewState.diagnostic!,
  );
  assert.match(
    diagnostic.summary,
    file.endsWith('intersect.ts')
      ? /intersect|common|empty/i
      : /loft|section|profile|two|2/i,
  );
  await page.evaluate(
    token => {
      const editor = window.exampleApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf(token) + token.length),
      );
      editor.focus();
    },
    file.endsWith('intersect.ts') ? 'intersect([' : 'loft([',
  );
  // Select the actual argument: a failed operation has no result to inspect.
  assert.deepEqual(
    await page.evaluate(() => {
      const {codeEditor, viewport} = window.exampleApp;
      const source = viewport.sourceContext?.target.sourceRef;
      return {
        input:
          source &&
          codeEditor.editor.getValue().slice(source.start, source.end),
        renderable: viewport.hasRenderableGeometry(),
      };
    }),
    {
      input: file.endsWith('intersect.ts') ? 'blank' : 'start',
      renderable: true,
    },
    'Inputs remain inspectable after the operation fails',
  );
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    source =>
      window.exampleApp.codeEditor.editor.getValue() === source &&
      !window.exampleApp.previewState.busy &&
      !window.exampleApp.previewState.diagnostic,
    original,
  );
}

test(
  'default project and legacy links run without installation and preserve user files',
  {timeout: 120_000},
  async t => {
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.exampleApp = {codeEditor, viewport, previewState, sketchEditor};',
      });
    });
    const registry: string[] = [];
    page.on('request', request => {
      if (request.url().startsWith('https://registry.npmjs.org/'))
        registry.push(request.url());
    });
    await page.goto(process.env.CODE3D_TEST_URL!);
    await page.waitForFunction(
      () => window.exampleApp && !window.exampleApp.previewState.busy,
      undefined,
      {timeout: 60_000},
    );
    assert.equal(
      await page.evaluate(() => window.exampleApp.previewState.diagnostic),
      undefined,
    );
    assert.match(
      await page.evaluate(() => window.exampleApp.codeEditor.editor.getValue()),
      /phoneStand/,
    );
    assert.deepEqual(registry, []);
    await page.goto(
      process.env.CODE3D_TEST_URL + '#/file/examples/website/first-model.ts',
    );
    await page.waitForFunction(
      () =>
        window.exampleApp.codeEditor.currentFile() ===
          '/examples/primitives/primitives.ts' &&
        !window.exampleApp.previewState.busy,
    );
    const source =
      "import {box} from '@code3d/core';\nexport default box(1, 2, 3);\n";
    await page.evaluate(async source => {
      const {openBrowserProjectFileSystem} =
        await import('/src/project/filesystem.ts');
      const files = await openBrowserProjectFileSystem();
      await files.writeFile(
        '/examples/website/first-model.ts',
        new TextEncoder().encode(source),
      );
    }, source);
    await page.reload();
    await page.waitForFunction(
      () => window.exampleApp && !window.exampleApp.previewState.busy,
    );
    // The route may have been canonicalized; request the original path again.
    await page.goto(
      process.env.CODE3D_TEST_URL + '#/file/examples/website/first-model.ts',
    );
    await page.waitForFunction(
      () =>
        window.exampleApp.codeEditor.currentFile() ===
          '/examples/website/first-model.ts' &&
        !window.exampleApp.previewState.busy,
    );
    assert.equal(
      await page.evaluate(() => window.exampleApp.codeEditor.editor.getValue()),
      source,
    );
    assert.equal(
      await page.evaluate(() => window.exampleApp.previewState.diagnostic),
      undefined,
    );
  },
);

async function verifyPackageNavigation(page: Page) {
  await page.evaluate(() => {
    const editor = window.exampleApp.codeEditor.editor;
    editor.setPosition(
      editor
        .getModel()!
        .getPositionAt(editor.getValue().indexOf('import range') + 8),
    );
    editor.focus();
  });
  await page.keyboard.press('F12');
  await page
    .locator('.reference-zone-widget .monaco-list-row')
    .filter({hasText: 'function range'})
    .first()
    .dblclick();
  await page.waitForFunction(() =>
    window.exampleApp.codeEditor
      .currentFile()
      ?.endsWith('/just-range/index.d.ts'),
  );
  assert.match(
    await page.evaluate(() => window.exampleApp.codeEditor.editor.getValue()),
    /declare function range/,
  );
  await page.evaluate(() =>
    window.exampleApp.codeEditor.openFile(
      '/examples/npm/node_modules/just-range/index.mjs',
    ),
  );
  await page.waitForFunction(() =>
    window.exampleApp.codeEditor
      .currentFile()
      ?.endsWith('/just-range/index.mjs'),
  );
  assert.match(
    await page.evaluate(() => window.exampleApp.codeEditor.editor.getValue()),
    /function range/,
  );
  assert.equal(
    await page.evaluate(
      () => window.exampleApp.codeEditor.editor.getRawOptions().readOnly,
    ),
    true,
  );
}

async function verifySketchPresets(page: Page) {
  const source = await page.evaluate(() =>
    window.exampleApp.codeEditor.editor.getValue(),
  );
  await page.evaluate(() => {
    const editor = window.exampleApp.codeEditor.editor;
    editor.setPosition(
      editor
        .getModel()!
        .getPositionAt(editor.getValue().indexOf('return sketch([') + 9),
    );
    editor.focus();
  });
  await page.locator('#design-arguments-panel').waitFor();
  assert.equal(await page.locator('#design-arguments-count').innerText(), '2');
  await page.keyboard.press('Alt+1');
  const options = page.locator('.design-argument-option');
  await options.nth(1).click();
  await page.waitForFunction(() => {
    const arc = window.exampleApp.sketchEditor.diagnosticScope
      ?.at(-1)
      ?.entities.find(e => e.kind === 'arc' && e.id === 8);
    return (
      arc?.kind === 'arc' &&
      arc.radius === 6 &&
      !window.exampleApp.previewState.busy
    );
  });
  assert.equal(
    await page.evaluate(() => window.exampleApp.codeEditor.editor.getValue()),
    source,
    'Arguments inspect another invocation without rewriting the source',
  );
  await options.nth(0).click();
  await page.waitForFunction(() => {
    const arc = window.exampleApp.sketchEditor.diagnosticScope
      ?.at(-1)
      ?.entities.find(e => e.kind === 'arc' && e.id === 8);
    return (
      arc?.kind === 'arc' &&
      arc.radius === 4 &&
      !window.exampleApp.previewState.busy
    );
  });
}

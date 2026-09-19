import type {Page} from './browser-connection.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';
declare const window: Window & {
  shellViewport: import('../../src/viewport.ts').ModelViewport;
};

test(
  'shell face picking, failed thickness correction and source undo work in the App',
  {timeout: 120_000},
  async t => {
    const appUrl = process.env.CODE3D_TEST_URL;
    assert.ok(appUrl, 'Set CODE3D_TEST_URL to the task development server');
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // Capture the actual instance; Vite can serve timestamped module instances
    // after edits, so importing and patching a second prototype misses the App.
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()) + '\nwindow.shellViewport = viewport;\n',
      });
    });
    await page.goto(appUrl!);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
    // All source edits and picks below go through the real App event handlers.
    const source =
      "import {box} from '@code3d/core';\nconst body = box(40,24,30).shell(1.5);\nexport default body;";
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(source);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const thickness = page.locator('[data-parameter=thickness]');
    await thickness.waitFor();
    await waitSelection(page, []);
    assert.equal(
      await page.locator('.contextual-tool-field output').innerText(),
      'None',
    );
    assert.equal(
      await page.getByRole('button', {name: 'Close all openings'}).isDisabled(),
      true,
    );

    await pickFace(page, 4);
    await waitCall(page, 'shell(1.5, [4])');
    await waitSelection(page, [4]);
    await thickness.fill('100');
    await page.keyboard.press('Enter');
    await page.getByText('Model error', {exact: true}).waitFor();
    await waitSelection(page, [4]);
    await thickness.fill('2');
    await page.keyboard.press('Enter');
    await waitCall(page, 'shell(2, [4])');
    await page.getByText('Ready', {exact: true}).waitFor();
    await page.keyboard.press('Control+z');
    await waitCall(page, 'shell(1.5)');
    await waitSelection(page, []);
    await page.keyboard.press('Control+Shift+z');
    await waitCall(page, 'shell(2, [4])');
    await waitSelection(page, [4]);

    // A removed face remains pickable using input topology.
    await pickFace(page, 4);
    await waitCall(page, 'shell(2, [])');
    await waitSelection(page, []);
    await page.getByRole('button', {name: 'Close all openings'}).click();
    await waitCall(page, 'shell(2)');
    await waitSelection(page, []);

    // Omission has the query's runtime meaning, independent of shell defaults.
    await page.locator('.monaco-editor .view-lines').first().click();
    await page.keyboard.press('Control+a');
    await page.keyboard.insertText(
      "import {box} from '@code3d/core';\nconst faces = box(40,24,30).surfaces();",
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await waitSelection(page, [1, 2, 3, 4, 5, 6]);
    assert.equal(
      await page.locator('.contextual-tool-field output').innerText(),
      'All surfaces',
    );
    await pickFace(page, 4);
    await waitCall(page, 'surfaces([1, 2, 3, 5, 6])');
    await waitSelection(page, [1, 2, 3, 5, 6]);
    assert.deepEqual(errors, []);
  },
);

async function waitCall(page: Page, call: string) {
  await page.waitForFunction(
    expected =>
      document
        .querySelector('.monaco-editor .view-lines')
        ?.textContent.replace(/\s/g, '')
        .includes(expected.replace(/\s/g, '')),
    call,
  );
}

async function waitSelection(page: Page, ids: number[]) {
  await page.waitForFunction(expected => {
    const viewport = window.shellViewport;
    const state = viewport?.['topologySelection'];
    const actual = [...(state?.selectedIds ?? [])].sort((a, b) => {
      if (typeof a !== 'number' || typeof b !== 'number')
        throw new Error('Expected box face IDs');
      return a - b;
    });
    const available = new Set(
      state?.mesh.surfaceGroups.map(group => group.surfaceId),
    );
    return (
      state?.kind === 'surface' &&
      available.size === 6 &&
      JSON.stringify(actual) === JSON.stringify(expected)
    );
  }, ids);
}

async function pickFace(page: Page, id: number) {
  const point = await page.evaluate(id => {
    const viewport = window.shellViewport;
    const selection = viewport['topologySelection']!;
    const {mesh, guide} = selection;
    const group = mesh.surfaceGroups.find(group => group.surfaceId === id);
    guide.updateWorldMatrix(true, true);
    viewport['camera'].updateWorldMatrix(true, false);
    const rect = viewport['renderer'].domElement.getBoundingClientRect();
    const vertex = guide.position.clone();
    const weights = [
      [1 / 3, 1 / 3, 1 / 3],
      [0.6, 0.2, 0.2],
      [0.2, 0.6, 0.2],
      [0.2, 0.2, 0.6],
    ];
    for (let i = group!.start; i < group!.start + group!.count; i += 3) {
      const corners = [0, 1, 2].map(j =>
        vertex.clone().fromArray(mesh.vertices, mesh.triangles[i + j] * 3),
      );
      for (const weight of weights) {
        const point = vertex
          .clone()
          .set(0, 0, 0)
          .addScaledVector(corners[0], weight[0])
          .addScaledVector(corners[1], weight[1])
          .addScaledVector(corners[2], weight[2])
          .applyMatrix4(guide.matrixWorld)
          .project(viewport['camera']);
        const position = {
          x: ((point.x + 1) * rect.width) / 2,
          y: ((1 - point.y) * rect.height) / 2,
        };
        const clientX = rect.left + position.x;
        const clientY = rect.top + position.y;
        if (
          document.elementFromPoint(clientX, clientY) ===
            viewport['renderer'].domElement &&
          viewport['pickTopology']({clientX, clientY}) === id
        )
          return position;
      }
    }
    throw new Error(`No unobscured point on S${id}`);
  }, id);
  await page.locator('.viewport-canvas').click({position: point});
}

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(appUrl);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
    // Capture the running viewport through its public selection entry point.
    // All source edits and picks below go through the real App event handlers.
    await page.evaluate(async () => {
      const {ModelViewport} = await import('/src/viewport.ts');
      const begin = ModelViewport.prototype.beginTopologySelection;
      ModelViewport.prototype.beginTopologySelection = function (...args) {
        window.shellViewport = this;
        return begin.apply(this, args);
      };
    });
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

async function waitCall(page, call) {
  await page.waitForFunction(
    expected =>
      document
        .querySelector('.monaco-editor .view-lines')
        ?.textContent.replace(/\s/g, '')
        .includes(expected.replace(/\s/g, '')),
    call,
  );
}

async function waitSelection(page, ids) {
  await page.waitForFunction(expected => {
    const viewport = window.shellViewport;
    const state = viewport?.topologySelection;
    const actual = [...(state?.selectedIds ?? [])].sort((a, b) => a - b);
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

async function pickFace(page, id) {
  const point = await page.evaluate(id => {
    const viewport = window.shellViewport;
    const selection = viewport.topologySelection;
    const {mesh, guide} = selection;
    const group = mesh.surfaceGroups.find(group => group.surfaceId === id);
    const center = guide.position.clone().set(0, 0, 0);
    const vertex = center.clone();
    for (let i = group.start; i < group.start + group.count; i++) {
      center.add(vertex.fromArray(mesh.vertices, mesh.triangles[i] * 3));
    }
    center.divideScalar(group.count);
    guide.updateWorldMatrix(true, true);
    viewport.camera.updateWorldMatrix(true, false);
    center.applyMatrix4(guide.matrixWorld).project(viewport.camera);
    const rect = viewport.renderer.domElement.getBoundingClientRect();
    const point = {
      clientX: rect.left + ((center.x + 1) * rect.width) / 2,
      clientY: rect.top + ((1 - center.y) * rect.height) / 2,
    };
    if (viewport.pickTopology(point) !== id)
      throw new Error(`S${id} is not visible at its center`);
    return point;
  }, id);
  await page.mouse.click(point.clientX, point.clientY);
}

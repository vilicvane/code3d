import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';

let browser;
const appUrl = process.env.CODE3D_TEST_URL;
before(async () => {
  assert.ok(appUrl, 'Set CODE3D_TEST_URL to the development server');
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

const sourceFor =
  expression => `import {loft, point, rectangle} from '@code3d/core';
const base = rectangle(28, 20);
const top = rectangle(18, 12).relate(p => p.on(point([0, 32, 0]).up));
const body = loft([base, top]);
${expression};`;

async function openApp(t, expression) {
  const context = await browser.newContext({
    viewport: {width: 1400, height: 950},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20_000);
  // Expose the running app only in this test response, without product debug hooks.
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.topologyTestApp = {codeEditor, viewport};\n',
    });
  });
  await page.goto(appUrl);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 40_000});
  await page.evaluate(source => {
    const {editor} = window.topologyTestApp.codeEditor;
    const model = editor.getModel();
    model.setValue(source);
    editor.setPosition(model.getPositionAt(source.length - 2));
    editor.focus();
  }, sourceFor(expression));
  await page.waitForFunction(() =>
    Boolean(window.topologyTestApp.viewport.topologySelection),
  );
  return {page, errors};
}

async function clickId(page, id) {
  const position = await page.evaluate(id => {
    const {viewport} = window.topologyTestApp;
    const selection = viewport.topologySelection;
    const {mesh, guide, kind} = selection;
    const same = value => JSON.stringify(value) === JSON.stringify(id);
    guide.updateWorldMatrix(true, true);
    viewport.camera.updateWorldMatrix(true, false);
    const points = [];
    if (kind === 'vertex') {
      const index = mesh.vertexIds.findIndex(same);
      points.push(
        guide.position.clone().fromArray(mesh.topologyVertices, index * 3),
      );
    } else if (kind === 'edge') {
      const group = mesh.edgeGroups.find(group => same(group.edgeId));
      for (
        let index = group.start * 3;
        index < (group.start + group.count) * 3;
        index += 6
      ) {
        points.push(
          guide.position
            .clone()
            .fromArray(mesh.edges, index)
            .add(guide.position.clone().fromArray(mesh.edges, index + 3))
            .multiplyScalar(0.5),
        );
      }
    } else {
      const group = mesh.surfaceGroups.find(group => same(group.surfaceId));
      for (
        let index = group.start;
        index < group.start + group.count;
        index += 3
      ) {
        const point = guide.position.clone().set(0, 0, 0);
        for (let corner = 0; corner < 3; corner++)
          point.add(
            guide.position
              .clone()
              .fromArray(mesh.vertices, mesh.triangles[index + corner] * 3),
          );
        points.push(point.multiplyScalar(1 / 3));
      }
    }
    const rect = viewport.renderer.domElement.getBoundingClientRect();
    for (const point of points) {
      point.applyMatrix4(guide.matrixWorld).project(viewport.camera);
      const position = {
        clientX: rect.left + ((point.x + 1) * rect.width) / 2,
        clientY: rect.top + ((1 - point.y) * rect.height) / 2,
      };
      if (same(viewport.pickTopology(position))) return position;
    }
    throw new Error(`No visible pick point for ${kind} ${JSON.stringify(id)}`);
  }, id);
  await page.mouse.click(position.clientX, position.clientY);
}

async function expectExpression(page, expression) {
  await page.waitForFunction(
    expression =>
      window.topologyTestApp.codeEditor.editor
        .getModel()
        .getValue()
        .includes(expression),
    expression,
  );
  await page.getByText('Ready', {exact: true}).waitFor();
}

for (const kind of ['surface', 'edge', 'vertex']) {
  test(
    `${kind} picks write one path and survive recompilation and Undo/Redo`,
    {timeout: 90_000},
    async t => {
      const initial = `body.${kind}([1, 1])`;
      const changed = `body.${kind}([2, 1])`;
      const {page, errors} = await openApp(t, initial);
      assert.equal(
        await page.evaluate(
          () => window.topologyTestApp.viewport.topologySelection.multiple,
        ),
        false,
      );
      await clickId(page, [2, 1]);
      await expectExpression(page, changed);
      await page.waitForFunction(() =>
        window.topologyTestApp.viewport.topologySelection.selectedIds.has([
          2, 1,
        ]),
      );
      const prefix = {surface: 'S', edge: 'E', vertex: 'V'}[kind];
      assert.ok(
        (
          await page.locator('.contextual-tool-panel output').innerText()
        ).includes(`${prefix}[2,1]`),
      );
      await page.evaluate(() =>
        window.topologyTestApp.codeEditor.editor.focus(),
      );
      await page.keyboard.press('Control+z');
      await expectExpression(page, initial);
      await page.keyboard.press('Control+Shift+z');
      await expectExpression(page, changed);
      assert.deepEqual(errors, []);
    },
  );
}

test(
  'multiple selection toggles reconstructed paths alongside new numeric IDs',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t, 'body.edges([[2, 1]])');
    assert.equal(
      await page.evaluate(
        () => window.topologyTestApp.viewport.topologySelection.multiple,
      ),
      true,
    );
    await clickId(page, 1);
    await expectExpression(page, 'body.edges([1, [2, 1]])');
    await clickId(page, [2, 1]);
    await expectExpression(page, 'body.edges([1])');
    await clickId(page, [2, 1]);
    await expectExpression(page, 'body.edges([1, [2, 1]])');
    assert.deepEqual(errors, []);
  },
);

test(
  'fillet selection writes inherited edge paths and can return to all edges',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t, 'body.fillet(0.5, [[1, 1]])');
    await clickId(page, [2, 1]);
    await expectExpression(page, 'body.fillet(0.5, [[1, 1], [2, 1]])');
    await clickId(page, [2, 1]);
    await expectExpression(page, 'body.fillet(0.5, [[1, 1]])');
    await page.getByRole('button', {name: 'Use all', exact: true}).click();
    await expectExpression(page, 'body.fillet(0.5)');
    assert.deepEqual(errors, []);
  },
);

test(
  'a failed path selection retains the receiver for repair by picking',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t, 'body.chamfer(0.5, [[9, 9]])');
    await clickId(page, [2, 1]);
    await expectExpression(page, 'body.chamfer(0.5, [[2, 1]])');
    assert.deepEqual(errors, []);
  },
);

test(
  'shell picks loft cap paths and keeps them while editing thickness',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t, 'body.shell(1)');
    await clickId(page, [2, 1]);
    await expectExpression(page, 'body.shell(1, [[2, 1]])');
    const thickness = page.locator('[data-parameter=thickness]');
    await thickness.fill('0.5');
    await page.keyboard.press('Enter');
    await expectExpression(page, 'body.shell(0.5, [[2, 1]])');
    await page.getByRole('button', {name: 'Close all openings'}).click();
    await expectExpression(page, 'body.shell(0.5)');
    assert.deepEqual(errors, []);
  },
);

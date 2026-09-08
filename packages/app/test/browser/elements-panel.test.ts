import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  elementsTestApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    elementsPanel: import('../../src/ui/elements-panel.ts').ElementsPanel;
    previousModule?: import('../../src/model/compiler.ts').ModelModule | null;
  };
};

async function setSource(page: Page, source: string) {
  await page.evaluate(source => {
    window.elementsTestApp.previousModule =
      window.elementsTestApp.viewport['module'];
    const editor = window.elementsTestApp.codeEditor.editor;
    editor.getModel()!.setValue(source);
    editor.setPosition(editor.getModel()!.getPositionAt(source.length - 2));
    editor.focus();
  }, source);
  await page.waitForFunction(
    () =>
      window.elementsTestApp.viewport['module'] !==
      window.elementsTestApp.previousModule,
  );
  await page.getByText('Ready', {exact: true}).waitFor();
}

test(
  'element tabs browse topology and references with scoped previews and keyboard navigation',
  {timeout: 120_000},
  async t => {
    const appUrl = process.env.CODE3D_TEST_URL;
    assert.ok(appUrl, 'Set CODE3D_TEST_URL to the task development server');
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1400, height: 950},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20_000);
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.elementsTestApp = {codeEditor, viewport, elementsPanel};\n',
      });
    });
    await page.goto(appUrl);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 40_000});
    await setSource(
      page,
      `import {box} from '@code3d/core';
const body = box(20, 30, 40);
body;`,
    );
    await page.locator('#elements-handle').click();
    const topology = page.getByRole('tab', {name: 'Topology', exact: true});
    const references = page.getByRole('tab', {name: 'References', exact: true});
    const tabTop = (await topology.boundingBox())!.y;
    assert.equal(await topology.getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#elements-count').textContent(), '26');
    assert.deepEqual(
      await page.locator('.element-kind-label').allTextContents(),
      [
        ...Array(6).fill('SURFACE'),
        ...Array(12).fill('EDGE'),
        ...Array(8).fill('VERTEX'),
      ],
    );
    const preview = () =>
      page.evaluate(() => {
        const viewport = window.elementsTestApp.viewport;
        const instances =
          viewport['decorationLayers'].get('elements-panel') ?? [];
        return instances.map(instance => ({
          occurrenceKey: instance.occurrenceKey,
          selectedKey: viewport.getSelected()!.key,
          type: instance.object.children[0].type,
          color:
            (instance.object.children[0] as import('three').Mesh)
              .material instanceof Array
              ? undefined
              : (
                  (instance.object.children[0] as import('three').Mesh)
                    .material as import('three').MeshBasicMaterial
                ).color.getHexString(),
        }));
      });
    for (const [name, type] of [
      ['S1, surface', 'Mesh'],
      ['E1, edge', 'LineSegments2'],
      ['V1, vertex', 'Points'],
    ]) {
      const row = page.getByRole('listitem', {name, exact: true});
      await row.hover();
      const rendered = await preview();
      assert.equal(rendered.length, 1);
      assert.equal(rendered[0].occurrenceKey, rendered[0].selectedKey);
      assert.equal(rendered[0].type, type);
      assert.equal(rendered[0].color, '63dcff');
      await topology.hover();
      assert.deepEqual(await preview(), []);
      await row.focus();
      assert.equal((await preview()).length, 1);
      await references.click();
      assert.equal((await topology.boundingBox())!.y, tabTop);
      assert.deepEqual(await preview(), []);
      await topology.click();
    }
    await references.click();
    const expectedReferences = await page.evaluate(
      () => window.elementsTestApp.viewport.getSelected()!.node.elements.length,
    );
    assert.equal(
      await page.locator('#elements-count').textContent(),
      String(expectedReferences),
    );
    await page
      .getByRole('listitem', {name: 'center, point', exact: true})
      .hover();
    assert.equal(
      await page.evaluate(
        () =>
          window.elementsTestApp.viewport['decorationLayers'].get(
            'elements-panel',
          )?.length,
      ),
      1,
    );
    await references.hover();
    await references.focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await topology.getAttribute('aria-selected'), 'true');
    assert.equal(
      await topology.evaluate(tab => tab === document.activeElement),
      true,
    );
    assert.deepEqual(await preview(), []);
    await page.keyboard.press('End');
    assert.equal(await references.getAttribute('aria-selected'), 'true');
    await setSource(
      page,
      `import {box} from '@code3d/core';
const body = box(12, 14, 16);
body.center;`,
    );
    assert.equal(await references.getAttribute('aria-selected'), 'true');
    assert.equal(
      await page
        .locator('.element-row.source-active .element-name')
        .textContent(),
      'center',
    );
    await page.getByRole('listitem', {name: 'up, face', exact: true}).hover();
    assert.equal(
      await page.evaluate(() =>
        window.elementsTestApp.viewport['decorationLayers'].has(
          'source-context:named-element',
        ),
      ),
      false,
    );
    await topology.click();
    assert.equal(
      await page.evaluate(() =>
        window.elementsTestApp.viewport['decorationLayers'].has(
          'source-context:named-element',
        ),
      ),
      true,
    );
    await setSource(
      page,
      `import {loft, point, rectangle} from '@code3d/core';
const base = rectangle(28, 20);
const top = rectangle(18, 12).relate(p => p.on(point([0, 32, 0]).up));
const body = loft([base, top]);
body;`,
    );
    const path = page.getByRole('listitem', {
      name: 'E[1,1], edge',
      exact: true,
    });
    await path.hover();
    assert.equal((await preview())[0].type, 'LineSegments2');
    assert.equal(
      await page
        .locator('.element-name')
        .evaluateAll(
          rows =>
            new Set(rows.map(row => row.textContent)).size === rows.length,
        ),
      true,
    );
    await setSource(
      page,
      `import {box, group} from '@code3d/core';
const assembly = group([box(10, 20, 30)]);
assembly;`,
    );
    assert.equal(await page.locator('#elements-count').textContent(), '0');
    assert.equal(
      await page.locator('.elements-empty').textContent(),
      'This model has no surface, edge or vertex topology.',
    );
    await references.click();
    assert.ok((await page.getByRole('listitem').count()) > 0);
    await page.evaluate(() => window.elementsTestApp.elementsPanel.render());
    assert.equal(await page.locator('#elements-count').textContent(), '0');
    assert.deepEqual(await preview(), []);
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.deepEqual(errors, []);
  },
);

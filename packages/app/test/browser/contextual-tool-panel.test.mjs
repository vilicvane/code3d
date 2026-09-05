import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';

// Run against this task's dev server and host Chrome, in isolated contexts:
// CODE3D_TEST_URL=http://127.0.0.1:5175 npm run test:browser:tool-panel -w @code3d/app
const appUrl = process.env.CODE3D_TEST_URL;
let browser;

before(async () => {
  assert.ok(appUrl, 'Set CODE3D_TEST_URL to the development server URL');
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});

after(async () => browser?.close());

async function createPage(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return page;
}

async function createPanel(t) {
  const page = await createPage(t);
  const url = new URL('/__tool-panel-test__', appUrl).href;
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<button id="before">Before</button><main></main><button id="after">After</button>',
    }),
  );
  await page.goto(url);
  await page.evaluate(async () => {
    const {ContextualToolPanel} =
      await import('/src/ui/contextual-tool-panel.ts');
    window.commits = [];
    window.acceptCommit = true;
    window.panel = new ContextualToolPanel(document.querySelector('main'), {
      onParameterInput() {},
      onParameterCommit(name, value) {
        window.commits.push({name, value});
        return window.acceptCommit;
      },
      onAction() {},
    });
    window.showPanel = (disabled = ['y', 'z'], id = 'box') => {
      window.panel.show({
        id,
        title: 'Box',
        parameters: ['x', 'y', 'z'].map(name => ({
          name,
          label: name,
          step: 1,
          value: name === 'x' ? 10 : undefined,
          disabled: disabled.includes(name),
        })),
        actions: [],
      });
    };
    window.showPanel();
  });
  await page.locator('[data-parameter=x]').focus();
  return page;
}

async function assertFocus(page, parameter) {
  await page.waitForFunction(
    name =>
      document.hasFocus() && document.activeElement?.dataset.parameter === name,
    parameter,
  );
}

test('Tab commits before navigation and enters the newly available parameter', async t => {
  const page = await createPanel(t);
  await page.keyboard.press('Tab');
  await assertFocus(page, 'x');
  assert.deepEqual(await page.evaluate(() => window.commits), [
    {name: 'x', value: 10},
  ]);
  await page.evaluate(() => window.showPanel(['z']));
  await assertFocus(page, 'y');
});

test('available controls and panel boundaries retain native Tab order', async t => {
  const page = await createPanel(t);
  await page.evaluate(() => window.showPanel([]));
  await page.keyboard.press('Tab');
  await assertFocus(page, 'y');
  await page.keyboard.press('Shift+Tab');
  await assertFocus(page, 'x');
  await page.keyboard.press('Shift+Tab');
  assert.equal(
    await page.locator('#before').evaluate(el => el === document.activeElement),
    true,
  );
  await page.locator('[data-parameter=z]').focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.locator('#after').evaluate(el => el === document.activeElement),
    true,
  );
});

test('rejected or unchanged settled commits do not defer Tab', async t => {
  const page = await createPanel(t);
  await page.evaluate(() => {
    window.acceptCommit = false;
  });
  await page.keyboard.press('Tab');
  await page.evaluate(() => window.showPanel(['z']));
  assert.equal(
    await page.locator('#after').evaluate(el => el === document.activeElement),
    true,
  );
});

for (const [name, cancel] of [
  ['typing', page => page.keyboard.type('2')],
  ['Escape', page => page.keyboard.press('Escape')],
  ['reverse Tab', page => page.keyboard.press('Shift+Tab')],
  ['another Tab', page => page.keyboard.press('Tab')],
  ['pointer interaction', page => page.locator('#after').click()],
  ['focus leaving the input', page => page.locator('#after').focus()],
  [
    'window blur',
    page => page.evaluate(() => window.dispatchEvent(new Event('blur'))),
  ],
  ['hiding the tool', page => page.evaluate(() => window.panel.hide())],
  [
    'switching tools',
    page => page.evaluate(() => window.showPanel(['y', 'z'], 'other')),
  ],
]) {
  test(`${name} cancels deferred navigation without stealing focus later`, async t => {
    const page = await createPanel(t);
    await page.keyboard.press('Tab');
    await assertFocus(page, 'x');
    await cancel(page);
    await page.evaluate(() => window.showPanel(['z']));
    assert.notEqual(
      await page.evaluate(() => document.activeElement?.dataset.parameter),
      'y',
    );
  });
}

test('a refresh that leaves the next field disabled expires the navigation request', async t => {
  const page = await createPanel(t);
  await page.keyboard.press('Tab');
  await page.evaluate(() => window.showPanel());
  await page.evaluate(() => window.showPanel(['z']));
  await assertFocus(page, 'x');
});

for (const timing of ['before debounce', 'after debounce']) {
  test(
    `box() can be filled sequentially with Tab ${timing}`,
    {timeout: 60_000},
    async t => {
      const page = await createPage(t);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(appUrl);
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
      await page.locator('.monaco-editor .view-lines').first().click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText(
        "import {box} from '@code3d/core';\nbox();",
      );
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.locator('[data-parameter=x]').click();
      for (const [value, next] of [
        ['10', 'y'],
        ['20', 'z'],
      ]) {
        await page.keyboard.type(value);
        if (timing === 'after debounce') {
          await page.waitForFunction(
            text =>
              document
                .querySelector('.monaco-editor .view-lines')
                ?.textContent.includes(text),
            value,
          );
        }
        await page.keyboard.press('Tab');
        await assertFocus(page, next);
      }
      await page.keyboard.type('30');
      await page.keyboard.press('Enter');
      await page.getByText('Ready', {exact: true}).waitFor();
      assert.match(
        await page.locator('.monaco-editor .view-lines').innerText(),
        /box\(10,\s*20,\s*30\)/,
      );
      assert.deepEqual(errors, []);
    },
  );
}

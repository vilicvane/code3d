import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  parameterTabApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    viewport: import('../../src/viewport.ts').ModelViewport;
    contextualToolPanel: import('../../src/ui/contextual-tool-panel.ts').ContextualToolPanel;
  };
};

const source = `import {box, point, pivotVertex} from '@code3d/core';
const size = 12;
const body = box(size, size + 4, 30);
const reference = point([1, 2, 3]);
const rounded = body.fillet(2, [1]);
`;

async function openApp(t: TestContext) {
  assert.ok(process.env.CODE3D_TEST_URL);
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
    reducedMotion: 'reduce',
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  const reactiveErrors: string[] = [];
  page.on('console', message => {
    if (
      /mobx|reaction/i.test(message.text()) &&
      ['error', 'warning'].includes(message.type())
    )
      reactiveErrors.push(message.text());
  });
  t.after(() => assert.deepEqual(reactiveErrors, []));
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.parameterTabApp = {codeEditor, viewport, contextualToolPanel};',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL);
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  return page;
}

async function setSource(page: Page, value = source, token = 'size,') {
  await page.evaluate(
    ({value, token}) => {
      const editor = window.parameterTabApp.codeEditor.editor;
      editor.getModel()!.setValue(value);
      editor.setPosition(
        editor.getModel()!.getPositionAt(value.indexOf(token)),
      );
      editor.focus();
    },
    {value, token},
  );
  await page.waitForFunction(
    () =>
      !window.parameterTabApp.contextualToolPanel.root.hidden &&
      window.parameterTabApp.viewport.sourceContext?.target.tool?.signature
        .name === 'box',
  );
  await page.getByText('Ready', {exact: true}).waitFor();
}

async function focus(page: Page, token: string, delta = 0) {
  await page.evaluate(
    ({token, delta}) => {
      const editor = window.parameterTabApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf(token) + delta),
      );
      editor.focus();
    },
    {token, delta},
  );
}

async function sourceValue(page: Page) {
  return page.evaluate(() =>
    window.parameterTabApp.codeEditor.editor.getValue(),
  );
}

async function focusedInput(page: Page) {
  return page.evaluate(
    () => (document.activeElement as HTMLElement)?.dataset.parameter,
  );
}

test(
  'Tab focuses the exact writable argument and selects its text for editing',
  {timeout: 120_000},
  async t => {
    const page = await openApp(t);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await setSource(page);
    for (const [token, delta, parameter] of [
      ['size,', 3, 'x'],
      ['size + 4', 5, 'y'],
      ['30)', 1, 'z'],
      ['[1, 2, 3]', 4, 'y'],
      ['fillet(2', 7, 'radius'],
    ] as const) {
      await focus(page, token, delta);
      await page.waitForFunction(
        parameter =>
          document
            .querySelector('input.source-active')
            ?.getAttribute('data-parameter') === parameter,
        parameter,
      );
      assert.ok(
        await page.evaluate(() =>
          window.parameterTabApp.codeEditor.editor.hasTextFocus(),
        ),
      );
      const hint = page.locator(
        `input[data-parameter="${parameter}"] + .contextual-tool-tab-hint`,
      );
      assert.equal(await hint.isVisible(), true);
      const placement = await hint.evaluate(hint => {
        const badge = hint.getBoundingClientRect();
        const field = hint.parentElement!.getBoundingClientRect();
        return {
          inside:
            badge.right < field.right &&
            badge.left > field.left &&
            badge.top > field.top &&
            badge.bottom < field.bottom,
          color: getComputedStyle(hint).backgroundColor,
        };
      });
      const insets = await hint.evaluate(hint => {
        const badge = hint.getBoundingClientRect();
        const field = hint.parentElement!.getBoundingClientRect();
        const style = getComputedStyle(hint.parentElement!);
        return [
          badge.top - field.top - parseFloat(style.borderTopWidth),
          field.bottom - badge.bottom - parseFloat(style.borderBottomWidth),
          field.right - badge.right - parseFloat(style.borderRightWidth),
        ];
      });
      assert.ok(
        insets.every(inset => Math.abs(inset - 8.5) < 0.1),
        JSON.stringify(insets),
      );
      assert.deepEqual(placement, {inside: true, color: 'rgb(216, 255, 62)'});
      const before = await sourceValue(page);
      await page.keyboard.press('Tab');
      assert.equal(await focusedInput(page), parameter);
      assert.equal(await hint.isVisible(), false);
      assert.equal(await page.locator('input.source-active').count(), 0);
      assert.equal(await sourceValue(page), before);
    }
    await focus(page, 'size,', 1);
    await page.waitForFunction(
      () =>
        document
          .querySelector('input.source-active')
          ?.getAttribute('data-parameter') === 'x',
    );
    await page.evaluate(() => {
      const editor = window.parameterTabApp.codeEditor.editor;
      const start = editor.getPosition()!;
      editor.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: start.lineNumber,
        endColumn: start.column + 2,
      });
    });
    assert.equal(await page.locator('input.source-active').count(), 0);
    await focus(page, '30)', 1);
    await page.keyboard.press('Tab');
    await page.keyboard.insertText('42');
    assert.equal(
      await page.locator('input[data-parameter="z"]').inputValue(),
      '42',
    );
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      /box\(size, size \+ 4, 42\)/.test(
        window.parameterTabApp.codeEditor.editor.getValue(),
      ),
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'Tab keeps ordinary editor behavior for unavailable inputs, selections and completion',
  {timeout: 180_000},
  async t => {
    const page = await openApp(t);
    for (const state of ['disabled', 'readOnly', 'hidden', 'render'] as const) {
      await setSource(page);
      await focus(page, '30)', 1);
      await page.evaluate(state => {
        const {viewport, contextualToolPanel} = window.parameterTabApp;
        const input = contextualToolPanel.root.querySelector<HTMLInputElement>(
          'input[data-parameter="z"]',
        )!;
        if (state === 'disabled') input.disabled = true;
        if (state === 'readOnly') input.readOnly = true;
        if (state === 'hidden') contextualToolPanel.root.hidden = true;
        if (state === 'render') viewport.setRenderMode('render');
      }, state);
      const before = await sourceValue(page);
      await page.keyboard.press('Tab');
      assert.equal(await focusedInput(page), undefined, state);
      assert.notEqual(await sourceValue(page), before, state);
      await page.evaluate(() =>
        window.parameterTabApp.viewport.setRenderMode('modeling'),
      );
    }

    await setSource(page);
    await focus(page, '[1]);', 2);
    await page.waitForFunction(
      () =>
        document
          .querySelector('output.source-active')
          ?.getAttribute('data-parameter') === 'edgeIds',
    );
    assert.equal(await page.locator('input.source-active').count(), 0);
    await page.keyboard.press('Tab');
    assert.equal(
      await focusedInput(page),
      undefined,
      'A topology output is not an editable text field',
    );

    await setSource(page);
    await page.evaluate(() => {
      const editor = window.parameterTabApp.codeEditor.editor;
      const model = editor.getModel()!;
      const start = model.getPositionAt(editor.getValue().indexOf('size,'));
      editor.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: start.lineNumber,
        endColumn: start.column + 4,
      });
    });
    await page.keyboard.press('Tab');
    assert.equal(
      await focusedInput(page),
      undefined,
      'Selection indentation stays in the editor',
    );

    await setSource(page);
    await page.evaluate(() => {
      const editor = window.parameterTabApp.codeEditor.editor;
      const model = editor.getModel()!;
      editor.setSelections(
        ['size,', '30)'].map(token => {
          const position = model.getPositionAt(
            editor.getValue().indexOf(token),
          );
          return {
            selectionStartLineNumber: position.lineNumber,
            selectionStartColumn: position.column,
            positionLineNumber: position.lineNumber,
            positionColumn: position.column,
          };
        }),
      );
    });
    assert.equal(await page.locator('input.source-active').count(), 0);
    const beforeMultiple = await sourceValue(page);
    await page.keyboard.press('Tab');
    assert.equal(await focusedInput(page), undefined);
    assert.notEqual(await sourceValue(page), beforeMultiple);
    assert.equal(
      await page.evaluate(
        () => window.parameterTabApp.codeEditor.editor.getSelections()!.length,
      ),
      2,
    );

    await setSource(page);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focusedInput(page), undefined);
    assert.ok(
      await page.evaluate(() =>
        window.parameterTabApp.codeEditor.editor.hasTextFocus(),
      ),
    );

    await setSource(page);
    await focus(page, 'size,', 2);
    await page.evaluate(() =>
      window.parameterTabApp.codeEditor.editor.trigger(
        'test',
        'editor.action.triggerSuggest',
        {},
      ),
    );
    await page.locator('.suggest-widget.visible').waitFor();
    await page.keyboard.press('Tab');
    await page.locator('.suggest-widget.visible').waitFor({state: 'hidden'});
    assert.equal(
      await focusedInput(page),
      undefined,
      'Tab accepts the completion',
    );
    assert.ok(
      await page.evaluate(() =>
        window.parameterTabApp.codeEditor.editor.hasTextFocus(),
      ),
    );
  },
);

test(
  'Tab can enter an omitted writable parameter and preserves snippet tab stops',
  {timeout: 120_000},
  async t => {
    const page = await openApp(t);
    await setSource(
      page,
      "import {box} from '@code3d/core';\nconst body = box();",
      ');',
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('input.source-active')
          ?.getAttribute('data-parameter') === 'x',
    );
    await page.keyboard.press('Tab');
    assert.equal(await focusedInput(page), 'x');
    await page.keyboard.insertText('12');
    await page.keyboard.press('Tab');
    await page.waitForFunction(
      () => (document.activeElement as HTMLElement)?.dataset.parameter === 'y',
    );
    assert.equal(await focusedInput(page), 'y');

    await setSource(page);
    await page.evaluate(() => {
      const editor = window.parameterTabApp.codeEditor.editor;
      const start = editor
        .getModel()!
        .getPositionAt(editor.getValue().indexOf('size,'));
      editor.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: start.lineNumber,
        endColumn: start.column + 4,
      });
      editor
        .getContribution<{dispose(): void; insert(template: string): void}>(
          'snippetController2',
        )!
        .insert('${1:size}${2:}$0');
    });
    await page.keyboard.press('Tab');
    assert.equal(await focusedInput(page), undefined);
    await page.keyboard.press('Tab');
    assert.equal(await focusedInput(page), undefined);
    assert.ok(
      await page.evaluate(() =>
        window.parameterTabApp.codeEditor.editor.hasTextFocus(),
      ),
    );
  },
);

test(
  'source highlighting includes single, multiple and operation topology selectors',
  {timeout: 120_000},
  async t => {
    const page = await openApp(t);
    await setSource(page);
    const calls = [
      ['vertex(1)', 'id'],
      ['edge(1)', 'id'],
      ['surface(1)', 'id'],
      ['originVertex(1)', 'id'],
      ['vertices([1])', 'ids'],
      ['edges([1])', 'ids'],
      ['surfaces([1])', 'ids'],
      ['fillet(1, [1])', 'edgeIds'],
      ['chamfer(1, [1])', 'edgeIds'],
      ['shell(1, [1])', 'removedSurfaceIds'],
      [
        'relate(self => [self.on(point([0,0,0]).up), pivotVertex(1).rotate(0,0,20)])',
        'id',
      ],
      ['edge()', 'id'],
    ];
    for (const [call, parameter] of calls) {
      await page.evaluate(call => {
        const editor = window.parameterTabApp.codeEditor.editor;
        const source = `import {box, point, pivotVertex} from '@code3d/core';\nconst body = box(20, 20, 20);\nbody.${call};`;
        editor.getModel()!.setValue(source);
        const offset = call.includes('pivotVertex')
          ? source.indexOf('pivotVertex(1)') + 'pivotVertex('.length
          : source.lastIndexOf(')');
        editor.setPosition(editor.getModel()!.getPositionAt(offset));
        editor.focus();
      }, call);
      await page.waitForFunction(
        ({call, parameter}) => {
          const {viewport} = window.parameterTabApp;
          const scope = viewport.sourceContext;
          return (
            scope?.target.tool?.signature.name ===
              (call.includes('pivotVertex')
                ? 'pivotVertex'
                : call.split('(')[0]) &&
            document
              .querySelector('output.source-active')
              ?.getAttribute('data-parameter') === parameter
          );
        },
        {call, parameter},
      );
      const borders = await page.evaluate(() => {
        const panel = getComputedStyle(
          document.querySelector('.contextual-tool-panel')!,
        );
        const selection = getComputedStyle(
          document.querySelector('output.source-active')!,
        );
        return {
          panel: panel.borderTopColor,
          width: panel.borderTopWidth,
          selection: selection.borderTopColor,
        };
      });
      assert.deepEqual(
        borders,
        {
          panel: 'rgb(102, 117, 44)',
          width: '1px',
          selection: 'rgb(216, 255, 62)',
        },
        call,
      );
      assert.equal(await page.locator('input.source-active').count(), 0, call);
      assert.equal(await focusedInput(page), undefined, call);
      await page.evaluate(() =>
        window.parameterTabApp.codeEditor.editor.setPosition({
          lineNumber: 1,
          column: 1,
        }),
      );
      await page.waitForFunction(
        () => !document.querySelector('.source-active'),
      );
    }
  },
);

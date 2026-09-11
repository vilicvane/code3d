import assert from 'node:assert/strict';
import {after, before, test, type TestContext} from 'node:test';
import {chromium, type Browser, type Page} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';
import {code3dCodeColors} from '../../src/code-theme.ts';

declare const window: Window & {
  tokenEditor: import('../../src/editor.ts').CodeEditor;
  tokenizationTestModel: {
    tokenization: {getLineTokens(line: number): {getCount(): number}};
    _attachedViews: {_views: Set<unknown>};
  };
};

let browser: Browser;
before(async () => {
  assert.ok(
    process.env.CODE3D_TEST_URL,
    'Set CODE3D_TEST_URL to the task server',
  );
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

const initialSource = "const 宽度 = 12;\nconst 名称 = 'code3d';\n// 中文注释";
// Every heading is farther apart than the viewport height. Jumping to a
// function body therefore leaves its heading outside the foreground range.
const longSource = Array.from({length: 15}, (_, index) =>
  [
    `function sideCapsule${index}(width: number, label = 'capsule') {`,
    ...Array.from(
      {length: 60},
      (_, line) => `  const 宽度${line} = width + ${line};`,
    ),
    '  return width;',
    '}',
    '',
  ].join('\n'),
).join('\n');

async function fixture(t: TestContext, source = initialSource) {
  const context = await browser.newContext({
    viewport: {width: 1400, height: 900},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  t.after(() => assert.deepEqual(errors, []));
  // Model execution can occupy the main thread long enough to starve idle
  // tokenization. Keep idle work pending without blocking rendering or workers.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
    window.cancelIdleCallback = () => {};
  });
  await page.route('**/editor-tokenization.html', route =>
    route.fulfill({
      contentType: 'text/html',
      headers: appIsolationHeaders,
      body: `<html><head><meta charset="utf-8"></head><body style="margin:0">
      <div id="editor" style="width:1400px;height:900px"></div>
      <script type="module">
        import {CodeEditor} from '/src/editor.ts';
        window.tokenEditor = new CodeEditor(document.querySelector('#editor'),
          {files: [{path: '/initial.ts', source: ${JSON.stringify(source)}}]}, '/initial.ts');
      </script></body></html>`,
    }),
  );
  await page.goto(
    new URL('/editor-tokenization.html', process.env.CODE3D_TEST_URL).href,
  );
  await page.waitForFunction(() => !!window.tokenEditor, undefined, {
    timeout: 60_000,
  });
  return page;
}

async function openFile(page: Page, path: string, source: string) {
  await page.evaluate(
    async ({path, source}) => {
      window.tokenEditor.fileReader = {
        readFile: async () => new TextEncoder().encode(source),
        stat: async () => ({kind: 'file', version: source}),
      };
      // A newly read document has no saved view state and must not need a
      // focus, pointer or scroll event to establish foreground tokenization.
      await window.tokenEditor.openFile(path, false);
    },
    {path, source},
  );
}

async function expectColor(
  page: Page,
  text: string,
  color: string,
  selector = '.view-lines .view-line',
) {
  const rgb = `rgb(${color
    .slice(1)
    .match(/../g)!
    .map(hex => parseInt(hex, 16))
    .join(', ')})`;
  await page.waitForFunction(
    ({text, rgb, selector}) =>
      [...document.querySelectorAll(`${selector} span`)].some(
        span =>
          span.children.length === 0 &&
          span.textContent?.replaceAll('\u00a0', ' ').trim() === text &&
          getComputedStyle(span).color === rgb,
      ),
    {text, rgb, selector},
  );
}

async function expectSourceColors(page: Page) {
  await expectColor(page, 'const', code3dCodeColors.keyword);
  await expectColor(page, '宽度', code3dCodeColors.foreground);
  await expectColor(page, '12', code3dCodeColors.number);
  await expectColor(page, "'code3d'", code3dCodeColors.string);
  await expectColor(page, '// 中文注释', code3dCodeColors.comment);
}

test(
  'initial and newly opened TS/JS documents render syntax colors without idle callbacks or interaction',
  {timeout: 90_000},
  async t => {
    const page = await fixture(t);
    await expectSourceColors(page);
    for (const path of ['/new.ts', '/new.js', '/another.ts']) {
      await openFile(page, path, initialSource);
      await expectSourceColors(page);
    }
    await openFile(page, '/single.ts', "const 单行 = 'single';");
    await expectColor(page, 'const', code3dCodeColors.keyword);
    await expectColor(page, "'single'", code3dCodeColors.string);
    // Reopening a previous tab uses its saved view state and retains its model.
    await page.evaluate(() =>
      window.tokenEditor.openFile('/initial.ts', false),
    );
    await expectSourceColors(page);
    await page.evaluate(() => {
      const editor = window.tokenEditor.editor;
      editor.executeEdits('tokenization-test', [
        {
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 6,
          },
          text: 'let',
        },
      ]);
    });
    await expectColor(page, 'let', code3dCodeColors.keyword);
    await page.evaluate(() => {
      const editor = window.tokenEditor.editor;
      editor.executeEdits('tokenization-test', [
        {
          range: {
            startLineNumber: 3,
            startColumn: 1,
            endLineNumber: 3,
            endColumn: editor.getModel()!.getLineMaxColumn(3),
          },
          text: "const 尾行 = 'last';",
        },
      ]);
    });
    await expectColor(page, "'last'", code3dCodeColors.string);
  },
);

test(
  'sticky headings outside the tokenized viewport keep syntax colors through jumps and edits',
  {timeout: 90_000},
  async t => {
    const page = await fixture(t, longSource);
    await page.evaluate(async () => {
      const editor = window.tokenEditor.editor;
      editor.updateOptions({
        foldingStrategy: 'indentation',
        stickyScroll: {enabled: true, defaultModel: 'indentationModel'},
      });
      // Contributions also initialize during idle time. Instantiate these two
      // explicitly so the test isolates tokenization, independent of the TS worker.
      editor.getContribution('store.contrib.stickyScrollController');
      const folding = editor.getContribution(
        'editor.contrib.folding',
      ) as unknown as {
        getFoldingModel(): Promise<unknown>;
      };
      await folding.getFoldingModel();
      window.tokenizationTestModel =
        editor.getModel() as unknown as typeof window.tokenizationTestModel;
    });
    for (const index of [5, 10, 2]) {
      await page.evaluate(index => {
        const editor = window.tokenEditor.editor;
        const line = index * 64 + 20;
        editor.setScrollTop(editor.getTopForLineNumber(line), 1);
      }, index);
      const sticky = '.sticky-line-content';
      await page.waitForFunction(
        index =>
          document
            .querySelector('.sticky-line-content')
            ?.textContent?.includes(`sideCapsule${index}(`),
        index,
      );
      await expectColor(page, 'function', code3dCodeColors.keyword, sticky);
      await expectColor(page, 'number', code3dCodeColors.keyword, sticky);
      await expectColor(page, "'capsule'", code3dCodeColors.string, sticky);
      await expectColor(page, 'const', code3dCodeColors.keyword);
      if (index === 5) {
        assert.equal(
          await page.evaluate(() =>
            window.tokenizationTestModel.tokenization
              .getLineTokens(2 * 64 + 1)
              .getCount(),
          ),
          1,
          'A distant sticky heading must not synchronously tokenize the unrelated prefix',
        );
      }
    }
    await page.evaluate(() => {
      const editor = window.tokenEditor.editor;
      const line = 2 * 64 + 1;
      editor.executeEdits('tokenization-test', [
        {
          range: {
            startLineNumber: line,
            startColumn: 1,
            endLineNumber: line,
            endColumn: editor.getModel()!.getLineMaxColumn(line),
          },
          text: 'function sideCapsule2(width: number, label = 42) {',
        },
      ]);
    });
    await expectColor(
      page,
      '42',
      code3dCodeColors.number,
      '.sticky-line-content',
    );
    assert.equal(
      await page.evaluate(
        () => window.tokenizationTestModel._attachedViews._views.size,
      ),
      2,
    );
    await page.evaluate(() =>
      window.tokenEditor.editor.updateOptions({stickyScroll: {enabled: false}}),
    );
    await page.waitForFunction(
      () => window.tokenizationTestModel._attachedViews._views.size === 1,
    );
    await page.evaluate(() =>
      window.tokenEditor.editor.updateOptions({stickyScroll: {enabled: true}}),
    );
    await expectColor(
      page,
      '42',
      code3dCodeColors.number,
      '.sticky-line-content',
    );
    await openFile(page, '/replacement.ts', initialSource);
    await expectSourceColors(page);
    assert.equal(
      await page.evaluate(
        () => window.tokenizationTestModel._attachedViews._views.size,
      ),
      0,
    );
    await page.evaluate(() =>
      window.tokenEditor.openFile('/initial.ts', false),
    );
    await expectColor(
      page,
      '42',
      code3dCodeColors.number,
      '.sticky-line-content',
    );
    await page.evaluate(() => window.tokenEditor.editor.dispose());
    assert.equal(
      await page.evaluate(
        () => window.tokenizationTestModel._attachedViews._views.size,
      ),
      0,
    );
  },
);

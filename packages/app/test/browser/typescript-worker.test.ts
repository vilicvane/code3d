import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'Unicode identifiers retain complete tokens and valid TypeScript and JavaScript syntax',
  {timeout: 60_000},
  async () => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.CODE3D_TEST_URL);
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
      const {names, results} = await page.evaluate(async () => {
        const {inspectIdentifierTokens} =
          await import('/test/browser/typescript-worker-fixture.ts');
        return inspectIdentifierTokens();
      });
      for (const {languageId, tokens, diagnostics} of results) {
        assert.deepEqual(diagnostics, [], languageId);
        for (const name of [...names, '#宽度']) {
          assert.deepEqual(tokens[name], [
            {
              offset: 0,
              type: name === 'Box宽度' ? 'type.identifier' : 'identifier',
            },
          ]);
        }
        for (const [sample, type] of [
          ['const', 'keyword'],
          ['interface', languageId === 'typescript' ? 'keyword' : 'identifier'],
          ['10.5', 'number.float'],
          ['0xff', 'number.hex'],
          ['// 中文注释', 'comment'],
          ['"中文字符串"', 'string'],
          ['💥', 'invalid'],
          ['\u0301', 'invalid'],
        ]) {
          assert.deepEqual(tokens[sample], [{offset: 0, type}]);
        }
        assert.ok(
          tokens['`尺寸${box宽度2}`'].some(
            token => token.offset === 5 && token.type === 'identifier',
          ),
        );
        assert.deepEqual(tokens['/宽度+/u'], [
          {offset: 0, type: 'regexp'},
          {offset: 3, type: 'regexp.escape.control'},
          {offset: 4, type: 'regexp'},
          {offset: 5, type: 'keyword.other'},
        ]);
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
    }
  },
);

test(
  'F2 input has readable unselected text and renames all Chinese symbol references',
  {timeout: 60_000},
  async () => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.CODE3D_TEST_URL);
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
      const editor = await page.evaluateHandle(async () => {
        const {mainEditor} =
          await import('/test/browser/typescript-worker-fixture.ts');
        const editor = mainEditor();
        editor.setValue('const 宽度 = 10;\nconst area = 宽度 * 宽度;\narea;');
        editor.setPosition({lineNumber: 1, column: 8});
        editor.focus();
        return editor;
      });
      await page.keyboard.press('F2');
      const input = page.locator('.rename-box .rename-input');
      await input.waitFor({state: 'visible'});
      await input.press('ArrowRight');
      const style = await input.evaluate((node: HTMLInputElement) => ({
        color: getComputedStyle(node).color,
        background: getComputedStyle(node).backgroundColor,
        containerColor: getComputedStyle(node.closest('.rename-box')!).color,
        selected: node.selectionStart !== node.selectionEnd,
      }));
      assert.equal(style.selected, false);
      assert.equal(style.color, 'rgb(231, 232, 223)');
      assert.equal(style.color, style.containerColor);
      assert.equal(style.background, 'rgb(17, 17, 15)');
      await input.fill('新的宽度2');
      await input.press('Enter');
      await input.waitFor({state: 'hidden'});
      // Closing the widget precedes the language worker's asynchronous edits.
      await page.waitForFunction(
        editor => editor.getValue().includes('const 新的宽度2 ='),
        editor,
      );
      const source = await editor.evaluate(editor => editor.getValue());
      assert.equal(
        source,
        'const 新的宽度2 = 10;\nconst area = 新的宽度2 * 新的宽度2;\narea;',
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
    }
  },
);

test(
  'native and annotation language features share scoped-package file identities',
  {timeout: 60_000},
  async () => {
    assert.ok(
      process.env.CODE3D_TEST_URL,
      'Set CODE3D_TEST_URL to the development server URL',
    );
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.CODE3D_TEST_URL!);
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
      const result = await page.evaluate(async () => {
        const {inspectWorkerFiles} =
          await import('/test/browser/typescript-worker-fixture.ts');
        return inspectWorkerFiles();
      });
      assert.ok(result.declarationUri.includes('%40code3d'));
      assert.ok(result.diagnostics.every(group => group.length === 0));
      assert.equal(
        result.files.filter(file => file === result.declarationFile).length,
        1,
      );
      assert.ok(!result.files.includes(result.declarationUri));
      assert.ok(
        result.navigation.childItems!.some(item => item.text === 'box'),
      );
      assert.ok(result.selection[0].parent);
      assert.ok(
        result.completions!.entries.some(entry => entry.name === 'length'),
      );
      assert.equal(result.highlights![0].highlightSpans.length, 2);
      assert.ok(
        result.definition!.some(
          entry => entry.fileName === result.declarationFile,
        ),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
    }
  },
);

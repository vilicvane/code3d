import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

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
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.CODE3D_TEST_URL);
      await page.getByText('Ready', {exact: true}).waitFor({timeout: 30_000});
      const result = await page.evaluate(async () => {
        const {inspectWorkerFiles} =
          await import('/test/browser/typescript-worker-fixture.mjs');
        return inspectWorkerFiles();
      });
      assert.ok(result.declarationUri.includes('%40code3d'));
      assert.ok(result.diagnostics.every(group => group.length === 0));
      assert.equal(
        result.files.filter(file => file === result.declarationFile).length,
        1,
      );
      assert.ok(!result.files.includes(result.declarationUri));
      assert.ok(result.navigation.childItems.some(item => item.text === 'box'));
      assert.ok(result.selection[0].parent);
      assert.ok(
        result.completions.entries.some(entry => entry.name === 'length'),
      );
      assert.equal(result.highlights[0].highlightSpans.length, 2);
      assert.ok(
        result.definition.some(
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

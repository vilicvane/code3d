import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import type {AgentResponse} from '@code3d/agent';

declare const window: Window & {
  cancellationEditor: import('../../src/editor.ts').CodeEditor;
  cancellationSession: import('../../src/agent/project-session.ts').AgentProjectSession;
  evaluations: number;
  Worker: typeof Worker;
  cancelledResponse?: AgentResponse;
};

test(
  'user and agent edits interrupt stuck App and agent evaluations; type queries remain independent',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1440, height: 900},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.addInitScript(() => {
      window.evaluations = 0;
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', ({data}) => {
            if (data.kind === 'progress' && data.phase === 'evaluating-model')
              window.evaluations++;
          });
        }
      };
    });
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.cancellationEditor = codeEditor; window.cancellationSession = agentProject;\n',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    for (const origin of ['user', 'agent']) {
      await page.evaluate(async () => {
        const session = window.cancellationSession;
        const file = window.cancellationEditor.currentFile();
        const read = await session.handle('test', 'Test', {
          operation: 'fs.read',
          path: file,
        });
        if (!read.ok) throw new Error(read.error.message);
        window.evaluations = 0;
        window.cancelledResponse = undefined;
        void session
          .handle('test', 'Test', {
            operation: 'apply',
            input: {
              files: [
                {
                  path: file,
                  version: (read.data as {version: string}).version,
                  content:
                    "import {box} from '@code3d/core';\nexport const value = 42;\nwhile (true) {}\nexport default box(1, 1, 1);",
                },
              ],
              cursor: {file, regex: '(box\\(1, 1, 1\\))'},
              render: true,
            },
          })
          .then(response => {
            window.cancelledResponse = response;
          });
      });
      await page.waitForFunction(() => window.evaluations >= 2);
      const type = await page.evaluate(() =>
        window.cancellationSession.handle('test', 'Test', {
          operation: 'apply',
          input: {
            type: true,
            cursor: {
              file: window.cancellationEditor.currentFile(),
              regex: 'const (value) =',
            },
          },
        }),
      );
      assert.ok(type.ok, JSON.stringify(type));
      assert.equal(
        (type.data as {observation: {type: {type: string}}}).observation.type
          .type,
        '42',
      );
      await page.evaluate(async origin => {
        const editor = window.cancellationEditor;
        const content =
          "import {box} from '@code3d/core';\nexport const value = 43;\nexport default box(2, 3, 4);";
        if (origin === 'user') {
          editor.editor.executeEdits('test-user', [
            {
              range: editor.editor.getModel()!.getFullModelRange(),
              text: content,
            },
          ]);
        } else {
          const session = window.cancellationSession;
          const file = editor.currentFile();
          const read = await session.handle('test', 'Test', {
            operation: 'fs.read',
            path: file,
          });
          if (!read.ok) throw new Error(read.error.message);
          const applied = await session.handle('test', 'Test', {
            operation: 'apply',
            input: {
              files: [
                {
                  path: file,
                  version: (read.data as {version: string}).version,
                  content,
                },
              ],
            },
          });
          if (!applied.ok) throw new Error(applied.error.message);
        }
      }, origin);
      await page.waitForFunction(() => !!window.cancelledResponse);
      const cancelled = await page.evaluate(() => window.cancelledResponse!);
      assert.ok(!cancelled.ok);
      assert.equal(cancelled.error.code, 'observation_superseded');
      assert.equal(
        (cancelled.error.details as {accepted: boolean}).accepted,
        true,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      const recovered = await page.evaluate(() =>
        window.cancellationSession.handle('test', 'Test', {
          operation: 'apply',
          input: {
            topology: true,
            cursor: {
              file: window.cancellationEditor.currentFile(),
              regex: '(box\\(2, 3, 4\\))',
            },
          },
        }),
      );
      assert.ok(recovered.ok, JSON.stringify(recovered));
      const size = (
        recovered.data as {observation: {topology: {bounds: {size: number[]}}}}
      ).observation.topology.bounds.size;
      assert.ok(size.every((value, i) => Math.abs(value - (i + 2)) < 1e-5));
    }
  },
);

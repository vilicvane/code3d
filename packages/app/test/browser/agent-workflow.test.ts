import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {AgentClient, type AgentConfig} from '@code3d/agent';
import {createLocalBridge} from '../../../cli/bld/bridge.js';
import {reserveLocalPort} from './local-port.ts';

declare const window: Window & {
  agentTestEditor: import('../../src/editor.ts').CodeEditor;
  agentTestCamera: import('three').PerspectiveCamera;
};

for (const storage of ['browser', 'directory'] as const)
  test(
    `App prompts drive CLI transactions, cursors, renders, topology and recovery in ${storage} storage`,
    {timeout: 180_000},
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
      page.setDefaultTimeout(15_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/src/main.ts*', async route => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body:
            (await response.text()) +
            '\nwindow.agentTestEditor = codeEditor; window.agentTestCamera = viewport.camera;\n',
        });
      });
      const appUrl = new URL(process.env.CODE3D_TEST_URL);
      if (storage === 'directory') {
        const setupUrl = new URL('/__agent-directory-setup__', appUrl).href;
        await page.route(setupUrl, route =>
          route.fulfill({
            contentType: 'text/html',
            body: '<main>Directory setup</main>',
          }),
        );
        await page.goto(setupUrl);
        await page.evaluate(async () => {
          const directory = await (
            await navigator.storage.getDirectory()
          ).getDirectoryHandle('agent-workflow', {create: true});
          const file = await directory.getFileHandle('model.ts', {
            create: true,
          });
          const writer = await file.createWritable();
          await writer.write(
            "import {box} from '@code3d/core';\nexport default box(10, 6, 8);\n",
          );
          await writer.close();
          const {storeProjectDirectory} =
            await import('/src/project/directory-access.ts');
          await storeProjectDirectory('agent-workflow-test', directory);
        });
        appUrl.searchParams.set('workspace', 'agent-workflow-test');
      }
      await page.goto(appUrl.href);
      await page.locator('#agents-button').click();
      const configs: AgentConfig[] = [];
      for (const name of ['Alice', 'Bob']) {
        const lease = await reserveLocalPort(t);
        await page
          .getByLabel('Local port', {exact: true})
          .fill(String(lease.port));
        await page.getByLabel('Agent name', {exact: true}).fill(name);
        await page
          .getByRole('button', {name: 'Add agent & copy prompt', exact: true})
          .click();
        await page.waitForFunction(name => {
          const value = document.querySelector<HTMLTextAreaElement>(
            'textarea[aria-label="Agent prompt"]',
          )?.value;
          return value?.includes(`"name": "${name}"`);
        }, name);
        const prompt = await page
          .getByLabel('Agent prompt', {exact: true})
          .inputValue();
        assert.ok(prompt.includes('/docs/guides/agents.md'));
        assert.ok(prompt.includes('project.c3d.json context'));
        assert.ok(!prompt.includes('Pinned observation'));
        configs.push(
          JSON.parse(
            prompt.match(/```json\n([\s\S]*?)\n```/)![1],
          ) as AgentConfig,
        );
        await lease.release();
        const bridge = await createLocalBridge(configs.at(-1)!);
        t.after(() => bridge.close());
      }
      assert.notEqual(configs[0].port, configs[1].port);
      await page.locator('.agent-status[data-state="online"]').waitFor();
      await page
        .locator('.agent-row')
        .filter({hasText: 'Alice'})
        .getByRole('button', {name: 'Copy update', exact: true})
        .click();
      const update = await page
        .getByLabel('Agent prompt', {exact: true})
        .inputValue();
      assert.ok(update.includes('/docs/guides/agents.md'));
      assert.ok(update.includes('project.c3d.json context'));
      assert.ok(update.includes(configs[0].key));
      await page.getByRole('button', {name: 'Close', exact: true}).click();
      const directory = await mkdtemp(join(tmpdir(), 'c3d-browser-'));
      t.after(() => rm(directory, {recursive: true, force: true}));
      for (const [index, config] of configs.entries())
        await writeFile(
          join(directory, `${index}.json`),
          JSON.stringify(config),
          {mode: 0o600},
        );
      async function cli(agent: number, args: string[], input?: object) {
        const child = spawn(
          process.execPath,
          [
            fileURLToPath(new URL('../../../cli/bld/main.js', import.meta.url)),
            join(directory, `${agent}.json`),
            '--output-dir',
            directory,
            ...args,
          ],
          {stdio: ['pipe', 'pipe', 'pipe']},
        );
        let stdout = '',
          stderr = '';
        child.stdout.on('data', chunk => {
          stdout += String(chunk);
        });
        child.stderr.on('data', chunk => {
          stderr += String(chunk);
        });
        child.stdin.end(
          input === undefined ? undefined : JSON.stringify(input),
        );
        const [code] = await once(child, 'close');
        const result = JSON.parse(stdout);
        assert.ok(!stderr.includes(configs[agent].key));
        return {code, result};
      }
      const listed = await cli(0, ['fs', 'list', '/']);
      assert.equal(listed.code, 0);
      const path = '/agent-model.ts';
      const source =
        "import {box} from '@code3d/core';\nconst width = 10;\n/** @code3d.arguments [6] */\nfunction design(size = 4) { return box(size, 6, 8).fillet(0.5, [1]); }\nexport default design(10);\n";
      const first = await cli(
        0,
        ['--request-id', 'create-model', 'apply', '--input', '-'],
        {
          files: [{path, version: null, content: source}],
          cursor: {
            file: path,
            regex: '(fillet\\(0.5, \\[1\\]\\))',
            arguments: '[width]',
          },
        },
      );
      assert.equal(first.code, 0, JSON.stringify(first.result));
      await page.evaluate(path => {
        const editor = window.agentTestEditor;
        editor.switchFile(path, true);
        const model = editor.editor.getModel()!;
        const start = model.getValue().indexOf('fillet(0.5, [1])');
        const from = model.getPositionAt(start);
        const to = model.getPositionAt(start + 'fillet(0.5, [1])'.length);
        editor.editor.setSelection({
          startLineNumber: from.lineNumber,
          startColumn: from.column,
          endLineNumber: to.lineNumber,
          endColumn: to.column,
        });
      }, path);
      const userCursor = await page.evaluate(() =>
        window.agentTestEditor.cursorSource(),
      );
      const liveContext = await cli(0, ['context']);
      assert.equal(liveContext.code, 0, JSON.stringify(liveContext.result));
      assert.equal(liveContext.result.data.file, path);
      assert.ok(liveContext.result.data.cursor);
      const read = await cli(0, ['fs', 'read', path]);
      assert.equal(read.result.data.content, source);
      const version = read.result.data.version;
      const inspect = await cli(
        0,
        ['apply', '--input', '-', '--render', '--topology', '--type'],
        {
          cursor: {
            ...liveContext.result.data.cursor,
            arguments: '[width]',
          },
        },
      );
      assert.equal(inspect.code, 0, JSON.stringify(inspect.result));
      assert.ok(
        inspect.result.data.observation.type.members.some(
          (member: {name: string}) => member.name === 'fillet',
        ),
        JSON.stringify(inspect.result.data.observation.type),
      );
      assert.equal(
        inspect.result.data.observation.models[0].role,
        'operation-input',
      );
      assert.equal(inspect.result.data.observation.topology.counts.edge, 12);
      assert.equal(
        inspect.result.data.observation.topology.items[0].selectable,
        true,
      );
      assert.ok(
        inspect.result.data.observation.topology.items.every(
          (item: {unavailable?: string}) => !item.unavailable,
        ),
      );
      assert.ok(
        Math.abs(inspect.result.data.observation.topology.bounds.size[0] - 10) <
          1e-5,
      );
      assert.deepEqual(
        await page.evaluate(() => window.agentTestEditor.cursorSource()),
        userCursor,
      );
      assert.ok(await page.locator('.agent-caret').count());
      const aliceLabel = page
        .locator('.agent-cursor-label')
        .filter({hasText: /^Alice$/});
      const bobLabel = page
        .locator('.agent-cursor-label')
        .filter({hasText: /^Bob$/});
      await aliceLabel.waitFor();
      const image = await readFile(inspect.result.artifacts[0].path);
      assert.equal(image.subarray(1, 4).toString(), 'PNG');
      assert.equal(image.readUInt32BE(16), 960);
      assert.equal(image.readUInt32BE(20), 720);
      await writeFile('/tmp/code3d-agent-workflow-render.png', image);
      const snapshotId = inspect.result.data.observation.snapshotId;
      const cameraBefore = await page.evaluate(() => ({
        position: window.agentTestCamera.position.toArray(),
        quaternion: window.agentTestCamera.quaternion.toArray(),
      }));
      const front = await cli(0, ['apply', '--input', '-', '--view', 'front'], {
        topology: {snapshotId, model: 'm0', kind: 'edge', limit: 1},
      });
      const top = await cli(0, ['apply', '--input', '-', '--render'], {
        render: {view: {direction: [0, 2, 0], up: [0, 0, -1]}},
        topology: {snapshotId, model: 'm0', kind: 'edge', limit: 1},
      });
      assert.equal(front.code, 0, JSON.stringify(front.result));
      assert.equal(top.code, 0, JSON.stringify(top.result));
      assert.deepEqual(
        front.result.data.observation.render.view.direction,
        [0, 0, 1],
      );
      assert.deepEqual(
        top.result.data.observation.render.view.direction,
        [0, 1, 0],
      );
      const frontImage = await readFile(front.result.artifacts[0].path);
      const topImage = await readFile(top.result.artifacts[0].path);
      assert.notDeepEqual(frontImage, topImage);
      await writeFile('/tmp/code3d-agent-front.png', frontImage);
      await writeFile('/tmp/code3d-agent-top.png', topImage);
      assert.deepEqual(
        await page.evaluate(() => ({
          position: window.agentTestCamera.position.toArray(),
          quaternion: window.agentTestCamera.quaternion.toArray(),
        })),
        cameraBefore,
      );
      const pageResult = await cli(0, ['apply', '--input', '-', '--topology'], {
        topology: {snapshotId, model: 'm0', kind: 'edge', offset: 3, limit: 2},
      });
      assert.equal(pageResult.code, 0, JSON.stringify(pageResult.result));
      assert.equal(pageResult.result.data.observation.topology.items.length, 2);
      const fallback = await cli(0, ['apply', '--input', '-', '--topology'], {
        cursor: {file: path, regex: '(fillet\\(0.5, \\[1\\]\\))'},
      });
      assert.equal(fallback.code, 0, JSON.stringify(fallback.result));
      assert.ok(
        Math.abs(fallback.result.data.observation.topology.bounds.size[0] - 6) <
          1e-5,
      );
      const bob = await cli(1, ['apply', '--input', '-'], {
        cursor: {file: path, regex: '(box\\(size, 6, 8\\))'},
      });
      assert.equal(bob.code, 0);
      await bobLabel.waitFor();
      assert.equal(
        await page.evaluate(
          id => window.agentTestEditor.agentCursor(id).ref?.file,
          configs[1].agentId,
        ),
        path,
      );
      const alternateFile = await page.evaluate(path => {
        const editor = window.agentTestEditor;
        const alternate = editor.filePaths().find(file => file !== path)!;
        editor.switchFile(alternate);
        return alternate;
      }, path);
      assert.notEqual(alternateFile, path);
      await aliceLabel.waitFor({state: 'hidden'});
      await bobLabel.waitFor({state: 'hidden'});
      await page.evaluate(
        path => window.agentTestEditor.switchFile(path),
        path,
      );
      await aliceLabel.waitFor();
      await bobLabel.waitFor();
      await page.screenshot({path: '/tmp/code3d-agent-cursor-labels.png'});
      const labelTop = (await aliceLabel.boundingBox())!.y;
      const modified =
        '// Revised by Alice\n' + source.replace('width = 10', 'width = 12');
      const changed = await cli(
        0,
        ['--request-id', 'edit-model', 'apply', '--input', '-'],
        {files: [{path, version, content: modified}]},
      );
      assert.equal(changed.code, 0, JSON.stringify(changed.result));
      await page.waitForFunction(top => {
        const label = [
          ...document.querySelectorAll('.agent-cursor-label'),
        ].find(node => node.textContent === 'Alice');
        return (
          label && Math.abs(label.getBoundingClientRect().y - top - 22) < 1
        );
      }, labelTop);
      if (storage === 'directory')
        assert.equal(
          await page.evaluate(async () => {
            const directory = await (
              await navigator.storage.getDirectory()
            ).getDirectoryHandle('agent-workflow');
            return (
              await (await directory.getFileHandle('agent-model.ts')).getFile()
            ).text();
          }),
          modified,
        );
      const conflict = await cli(1, ['apply', '--input', '-'], {
        files: [{path, version, content: source}],
      });
      assert.equal(conflict.code, 1);
      assert.equal(conflict.result.error.code, 'version_conflict');
      const receipt = await cli(0, ['result', 'edit-model']);
      assert.deepEqual(receipt.result.data, changed.result.data);
      const expired = await cli(0, ['apply', '--input', '-'], {
        topology: {snapshotId, model: 'm0'},
      });
      assert.equal(expired.code, 1);
      assert.equal(expired.result.error.code, 'snapshot_expired');
      const current = await cli(0, ['fs', 'read', path]);
      const shell = await cli(0, ['apply', '--input', '-', '--topology'], {
        files: [
          {
            path: '/agent-shell.ts',
            version: null,
            content:
              "import {box} from '@code3d/core';\nexport default box(20, 12, 16).shell(1, [4]);\n",
          },
        ],
        cursor: {file: '/agent-shell.ts', regex: '(shell\\(1, \\[4\\]\\))'},
      });
      assert.equal(shell.code, 0, JSON.stringify(shell.result));
      assert.equal(
        shell.result.data.observation.models[0].role,
        'operation-input',
      );
      assert.equal(shell.result.data.observation.topology.counts.surface, 6);
      assert.ok(
        shell.result.data.observation.topology.items.some(
          (item: {id: number; selectable: boolean}) =>
            item.id === 4 && item.selectable,
        ),
      );
      const syntax = await cli(0, ['apply', '--input', '-', '--topology'], {
        cursor: {
          file: path,
          regex: '(box\\(size, 6, 8\\))',
          arguments: '[',
        },
      });
      assert.equal(syntax.code, 1);
      assert.equal(syntax.result.error.code, 'model_failed');
      assert.equal(syntax.result.error.details.accepted, true);
      assert.equal(syntax.result.error.details.saved, true);
      assert.equal(syntax.result.error.details.observation.kind, 'syntax');
      assert.equal(
        syntax.result.error.details.observation.sourceRef.file,
        path,
      );
      assert.equal(
        syntax.result.error.details.observation.summary,
        syntax.result.error.message,
      );
      const bad = await cli(0, ['apply', '--input', '-', '--render'], {
        files: [
          {
            path,
            version: current.result.data.version,
            content: modified.replace('box(size, 6, 8)', 'box(-1, 6, 8)'),
          },
        ],
        cursor: {file: path, regex: '(box\\(-1, 6, 8\\))'},
      });
      assert.equal(bad.code, 1);
      assert.equal(bad.result.error.code, 'model_failed');
      assert.equal(bad.result.error.details.accepted, true);
      assert.equal(bad.result.error.details.saved, true);
      assert.equal(bad.result.error.details.observation.kind, 'evaluation');
      assert.equal(bad.result.error.details.observation.sourceRef.file, path);
      // Static types remain available when the model fails at runtime.
      const staticType = await cli(0, ['apply', '--input', '-', '--type'], {
        cursor: {file: path, regex: 'const (width) ='},
      });
      assert.equal(staticType.code, 0, JSON.stringify(staticType.result));
      assert.equal(staticType.result.data.observation.type.type, '12');
      assert.equal(staticType.result.data.observation.models, undefined);
      // Restore Alice's label to the model expression for the remaining UI checks.
      await cli(0, ['apply', '--input', '-'], {
        cursor: {file: path, regex: '(box\\(-1, 6, 8\\))'},
      });
      await page.locator('#agents-button').click();
      await page
        .locator('.agent-row')
        .filter({hasText: 'Bob'})
        .getByRole('button', {name: 'Revoke'})
        .click();
      await bobLabel.waitFor({state: 'detached'});
      await aliceLabel.waitFor();
      await assert.rejects(
        () =>
          AgentClient.create(configs[1]).then(client =>
            client.request({operation: 'fs.list', path: '/'}),
          ),
        {code: 'app_disconnected'},
      );
      await page.screenshot({path: '/tmp/code3d-agent-workflow-panel.png'});
      await page.reload();
      await page.locator('#agents-button').waitFor();
      await page.waitForFunction(
        () =>
          document
            .querySelector('.agent-status')
            ?.getAttribute('data-state') === 'online',
      );
      assert.equal(
        await page
          .locator('.agent-dialog')
          .evaluate(dialog => dialog.hasAttribute('open')),
        false,
      );
      const recovered = await cli(0, ['result', 'create-model']);
      assert.equal(recovered.code, 0);
      assert.deepEqual(recovered.result.data, first.result.data);
      const duplicate = await cli(
        0,
        ['--request-id', 'create-model', 'apply', '--input', '-'],
        {
          files: [{path, version: null, content: source}],
          cursor: {
            file: path,
            regex: '(fillet\\(0.5, \\[1\\]\\))',
            arguments: '[width]',
          },
        },
      );
      assert.deepEqual(duplicate.result, first.result);
      assert.equal(
        (await cli(0, ['fs', 'read', path])).result.data.content,
        modified.replace('box(size, 6, 8)', 'box(-1, 6, 8)'),
      );
      await assert.rejects(
        () =>
          AgentClient.create(configs[1]).then(client =>
            client.request({operation: 'fs.list', path: '/'}),
          ),
        {code: 'app_disconnected'},
      );
      const otherTab = await context.newPage();
      await otherTab.goto(page.url());
      await otherTab.locator('#agents-button').click();
      await otherTab
        .getByText(
          'Agents are active in another tab for this project. Close that tab and reload this page to take over.',
          {exact: true},
        )
        .waitFor();
      assert.equal((await cli(0, ['fs', 'list', '/'])).code, 0);
      await otherTab.close();
      await page.locator('#agents-button').click();
      assert.equal(await page.locator('.agent-row').count(), 1);
      await page.getByLabel('Local agent connections', {exact: true}).click();
      await page.getByRole('button', {name: 'Revoke all', exact: true}).click();
      await page.locator('.agent-row').waitFor({state: 'detached'});
      await page.reload();
      await page.locator('#agents-button').waitFor();
      await assert.rejects(
        () =>
          AgentClient.create(configs[0]).then(client =>
            client.request({operation: 'fs.list', path: '/'}),
          ),
        {code: 'app_disconnected'},
      );
      assert.deepEqual(errors, []);
    },
  );

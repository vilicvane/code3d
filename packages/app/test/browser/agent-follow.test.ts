import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {AgentClient, type AgentConfig, type ApplyInput} from '@code3d/agent';
import {createLocalBridge} from '../../../cli/bld/bridge.js';
import {reserveLocalPort} from './local-port.ts';

declare const window: Window & {
  followApp: {
    codeEditor: import('../../src/editor.ts').CodeEditor;
    viewport: import('../../src/viewport.ts').ModelViewport;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    module: import('../../src/model/compiler.ts').ModelModule | null;
    releaseCompile?: () => void;
    compilationHeld?: boolean;
  };
};

test(
  'following applies agent targets once and keeps user navigation, arguments and sketch editing available',
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
    await context.addInitScript(() =>
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: async () => {},
      }),
    );
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
          '\nwindow.followApp = {codeEditor, viewport, compiler, get module(){return currentModule}};\n',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL);
    await page.waitForFunction(() => !!window.followApp);
    const connect = page.getByRole('button', {
      name: 'Connect Agent',
      exact: true,
    });
    assert.equal(
      await connect.evaluate(element =>
        element.classList.contains('button-primary'),
      ),
      true,
    );
    await connect.click();
    const dialog = page.getByRole('dialog', {
      name: 'Connect Agent',
      exact: true,
    });
    const clients: AgentClient[] = [];
    const configs: AgentConfig[] = [];
    for (const name of ['Euler', 'Gauss']) {
      const port = await reserveLocalPort(t);
      await dialog.getByLabel('Agent name', {exact: true}).fill(name);
      await dialog
        .getByLabel('Local port', {exact: true})
        .fill(String(port.port));
      await dialog
        .getByRole('button', {name: 'Add agent & copy prompt', exact: true})
        .click();
      await page.waitForFunction(
        name =>
          document
            .querySelector<HTMLTextAreaElement>('[aria-label="Agent prompt"]')
            ?.value.includes(`"name": "${name}"`),
        name,
      );
      const prompt = await dialog
        .getByLabel('Agent prompt', {exact: true})
        .inputValue();
      const config = JSON.parse(
        prompt.match(/```json\n([\s\S]*?)\n```/)![1],
      ) as AgentConfig;
      configs.push(config);
      await port.release();
      const bridge = await createLocalBridge(config);
      t.after(() => bridge.close());
      clients.push(await AgentClient.create(config));
    }
    await dialog.locator('.agent-status[data-state="online"]').waitFor();
    await dialog.getByRole('button', {name: 'Close', exact: true}).click();
    assert.equal(
      await connect.evaluate(element =>
        element.classList.contains('button-primary'),
      ),
      false,
    );
    assert.equal(await connect.locator('svg').count(), 1);
    const apply = async (input: ApplyInput, agent = 0) => {
      const {response} = await clients[agent].request({
        operation: 'apply',
        input,
      });
      assert.equal(response.ok, true, JSON.stringify(response));
      return response;
    };
    const ready = () =>
      page.waitForFunction(
        () =>
          document
            .querySelector('#viewport-status')
            ?.getAttribute('data-state') === 'ready',
      );
    const file = '/follow.ts';
    const source =
      "import {box, sketch} from '@code3d/core';\n/** @code3d.arguments [4] */\nexport function shape(width: number) {\n  return box(width, 6, 8);\n}\nconst profile = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 5]]]);\nexport default box(2, 3, 4);\n";
    const cursor = {file, regex: 'return (box\\(width, 6, 8\\));'};
    const original = await page.evaluate(() =>
      window.followApp.codeEditor.currentFile(),
    );
    await apply({
      files: [{path: file, version: null, content: source}],
      cursor,
    });
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      original,
    );
    const euler = page
      .locator('.agent-nav .agent-badge')
      .filter({hasText: 'Euler'});
    const gauss = page
      .locator('.agent-nav .agent-badge')
      .filter({hasText: 'Gauss'});
    await euler.click();
    assert.equal(await euler.getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      original,
    );
    await clients[0].request({operation: 'context'});
    await apply({type: true});
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      original,
    );
    await apply({
      cursor: {...cursor, arguments: '[12]'},
      render: {view: 'top'},
    });
    await ready();
    const followed = await page.evaluate(() => {
      const {codeEditor, viewport, module} = window.followApp;
      return {
        file: codeEditor.currentFile(),
        selection: codeEditor.selectedSource(),
        cursor: codeEditor.cursorSource(),
        context: module?.activeDesignContextId,
        position: viewport['camera'].position
          .clone()
          .sub(viewport['controls'].focus)
          .normalize()
          .toArray(),
        up: viewport['camera'].up.toArray(),
        vertices: [...(viewport.getSelected()?.node.mesh?.vertices ?? [])],
      };
    });
    assert.equal(followed.file, file);
    assert.equal(followed.selection?.start, source.indexOf('box(width'));
    assert.equal(followed.cursor?.offset, followed.selection?.start);
    assert.equal(followed.context, '/follow.ts:function:shape:temporary');
    const xs = followed.vertices.filter((_, i) => i % 3 === 0);
    assert.equal(Math.max(...xs) - Math.min(...xs), 12);
    assert.ok(Math.abs(followed.position[1] - 1) < 1e-6);
    assert.ok(Math.abs(followed.up[2] + 1) < 1e-6);
    const {response: read} = await clients[0].request({
      operation: 'fs.read',
      path: file,
    });
    assert.ok(read.ok);
    const updatedSource = '// Agent source update\n' + source;
    await apply({
      files: [
        {
          path: file,
          version: (read.data as {version: string}).version,
          content: updatedSource,
        },
      ],
      cursor: {...cursor, arguments: '[14]'},
    });
    await ready();
    const updated = await page.evaluate(() => {
      const vertices =
        window.followApp.viewport.getSelected()!.node.mesh!.vertices;
      const xs = [...vertices].filter((_, i) => i % 3 === 0);
      return {
        selection: window.followApp.codeEditor.selectedSource(),
        width: Math.max(...xs) - Math.min(...xs),
      };
    });
    assert.equal(updated.selection?.start, updatedSource.indexOf('box(width'));
    assert.equal(updated.width, 14);
    // User movement does not stop following or trigger another jump.
    await page.evaluate(
      original => window.followApp.codeEditor.switchFile(original),
      original,
    );
    await ready();
    await clients[0].request({operation: 'context'});
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      original,
    );
    assert.equal(await euler.getAttribute('aria-pressed'), 'true');
    await apply({cursor});
    await ready();
    assert.equal(
      await page.evaluate(() => window.followApp.module?.activeDesignContextId),
      '/follow.ts:function:shape:arguments:0',
    );
    await gauss.click();
    assert.equal(await euler.getAttribute('aria-pressed'), 'false');
    await page.evaluate(
      original => window.followApp.codeEditor.switchFile(original),
      original,
    );
    await apply({cursor});
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      original,
    );
    await apply(
      {cursor: {file, regex: 'const profile = (sketch\\([\\s\\S]*?\\));'}},
      1,
    );
    await ready();
    await page.locator('.sketch-editor:not([hidden])').waitFor();
    await gauss.click();
    await page.evaluate(
      original => window.followApp.codeEditor.switchFile(original),
      original,
    );
    await apply({cursor}, 1);
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      original,
    );
    // A camera request waiting on compilation cannot overwrite a newer user gesture.
    await euler.click();
    await page.evaluate(() => {
      const app = window.followApp;
      const compile = app.compiler.compile.bind(app.compiler);
      app.compiler.compile = async (...args) => {
        const module = await compile(...args);
        app.compiler.compile = compile;
        app.compilationHeld = true;
        await new Promise<void>(resolve => {
          app.releaseCompile = resolve;
        });
        return module;
      };
    });
    const pending = apply({cursor, render: {view: 'left'}});
    await page.waitForFunction(() => window.followApp.compilationHeld);
    await page.locator('#viewport-mode-modeling').click();
    const rotation = await page.evaluate(() => {
      const {viewport} = window.followApp;
      viewport['camera'].position
        .copy(viewport['controls'].focus)
        .add({x: 30, y: 20, z: 40} as import('three').Vector3);
      viewport['camera'].up.set(0, 1, 0);
      viewport['camera'].lookAt(viewport['controls'].focus);
      viewport['controls'].syncCamera();
      const rotation = viewport['camera'].quaternion.toArray();
      window.followApp.releaseCompile!();
      return rotation;
    });
    await pending;
    await ready();
    const finalRotation = await page.evaluate(() =>
      window.followApp.viewport['camera'].quaternion.toArray(),
    );
    finalRotation.forEach((value, i) =>
      assert.ok(Math.abs(value - rotation[i]) < 1e-12),
    );
    assert.equal(await euler.getAttribute('aria-pressed'), 'true');
    await page.screenshot({path: '/tmp/code3d-agent-follow-app.png'});
    await connect.click();
    await dialog
      .locator('.agent-row')
      .filter({hasText: 'Euler'})
      .getByRole('button', {name: 'Revoke', exact: true})
      .click();
    await euler.waitFor({state: 'detached'});
    await dialog.getByRole('button', {name: 'Close', exact: true}).click();
    assert.deepEqual(errors, []);
  },
);

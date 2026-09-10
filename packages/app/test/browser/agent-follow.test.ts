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
    projectFileSystem: import('../../src/project/filesystem.ts').ProjectFileSystem;
    projectDirectory: import('../../src/ui/project-tree.ts').ProjectTree;
    module: import('../../src/model/compiler.ts').ModelModule | null;
    releaseCompile?: () => void;
    compilationHeld?: boolean;
    navigationHeld?: boolean;
    releaseNavigation?: () => void;
    navigationReleased?: boolean;
  };
};

test(
  'following synchronizes agent edits and filesystem navigation without locking user controls',
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
          '\nwindow.followApp = {codeEditor, viewport, compiler, projectFileSystem, projectDirectory, get module(){return previewState.module}};\n',
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
      cursor: {...cursor, arguments: '[12]'},
      render: {view: 'top'},
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
    // An agent with no target can be followed without moving the user's view.
    await gauss.click();
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      original,
    );
    await euler.click();
    assert.equal(await euler.getAttribute('aria-pressed'), 'true');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      file,
    );
    await clients[0].request({operation: 'context'});
    await apply({type: true});
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      file,
    );
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
    // Re-entering follow uses Monaco's rebased selection and restores agent state.
    await euler.click();
    await page.evaluate(file => {
      const editor = window.followApp.codeEditor;
      editor.applyFiles([
        {
          path: file,
          content: '// User edit\n' + editor.fileState(file)!.content,
        },
      ]);
      editor.switchFile('/model.ts');
    }, file);
    await ready();
    await euler.click();
    await ready();
    const resumed = await page.evaluate(() => {
      const {codeEditor, viewport} = window.followApp;
      const vertices = [...viewport.getSelected()!.node.mesh!.vertices];
      const xs = vertices.filter((_, i) => i % 3 === 0);
      return {
        selection: codeEditor.selectedSource(),
        source: codeEditor.fileState(codeEditor.currentFile()!)!.content,
        width: Math.max(...xs) - Math.min(...xs),
        direction: viewport['camera'].position
          .clone()
          .sub(viewport['controls'].focus)
          .normalize()
          .toArray(),
      };
    });
    assert.equal(resumed.selection?.start, resumed.source.indexOf('box(width'));
    assert.equal(resumed.width, 14);
    assert.ok(Math.abs(resumed.direction[1] - 1) < 1e-6);
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
    await apply(
      {cursor: {file, regex: 'const profile = (sketch\\([\\s\\S]*?\\));'}},
      1,
    );
    await gauss.click();
    await ready();
    await page.locator('.sketch-editor:not([hidden])').waitFor();
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
    await ready();
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

    const fs = async (
      operation: 'fs.read' | 'fs.list' | 'fs.stat',
      path: string,
      agent = 0,
    ) => {
      const {response} = await clients[agent].request({operation, path});
      assert.equal(response.ok, true, JSON.stringify(response));
      return response;
    };
    const focusedTab = (path: string) =>
      page.waitForFunction(path => {
        const tab = document.querySelector('.editor-tab.active > button');
        return (
          tab?.getAttribute('title') === path && document.activeElement === tab
        );
      }, path);
    const directory = (path: string) =>
      page.locator(`#project-tree [data-item-path="${path.slice(1)}/"]`);
    const focusedDirectory = async (path: string) => {
      await directory(path).waitFor();
      await page.waitForFunction(path => {
        const tree = window.followApp.projectDirectory['tree'];
        const row = document
          .querySelector('#project-tree')!
          .shadowRoot!.querySelector<HTMLElement>(
            `[data-item-path="${path.slice(1)}/"]`,
          );
        return (
          tree.getFocusedPath() === path.slice(1) + '/' &&
          tree.getItem(path.slice(1) + '/')?.isSelected() &&
          row?.matches(':focus') &&
          row.dataset.itemFocused === 'true'
        );
      }, path);
      assert.equal(await directory(path).getAttribute('aria-expanded'), 'true');
      assert.equal(
        await directory(path).evaluate(element => element.matches(':focus')),
        true,
      );
      const visible = await directory(path).evaluate(element => {
        const row = element.getBoundingClientRect();
        const scroll = element
          .closest('[data-file-tree-virtualized-scroll]')!
          .getBoundingClientRect();
        return (
          row.top >= scroll.top &&
          row.bottom <= scroll.bottom &&
          getComputedStyle(element, '::before').outlineStyle === 'solid'
        );
      });
      assert.equal(
        visible,
        true,
        `${path} has a visible focus ring in the tree`,
      );
    };
    const notes = '/browse/deep/notes.md';
    await page.evaluate(async notes => {
      const fs = window.followApp.projectFileSystem;
      await fs.writeFile(notes, '# Agent notes\n');
      await fs.writeFile('/browse/other.txt', 'Other file\n');
      await fs.writeFile('/slow.md', 'Delayed navigation\n');
      await fs.createDirectory('/empty');
      for (let index = 0; index < 80; index++)
        await fs.createDirectory(
          `/scroll/entry-${String(index).padStart(3, '0')}`,
        );
      await fs.writeFile(
        '/compact/parent/leaf/note.md',
        '# Compact directory\n',
      );
    }, notes);
    const modelingCursor = await page.evaluate(
      id => window.followApp.codeEditor.agentCursor(id),
      configs[0].agentId,
    );
    await fs('fs.read', notes, 1);
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      file,
    );
    const readNotes = await fs('fs.read', notes);
    await focusedTab(notes);
    await apply({
      files: [
        {
          path: notes,
          version: (readNotes.data as {version: string}).version,
          content: '# Updated agent notes\n',
        },
      ],
    });
    await page.evaluate(() => window.followApp.codeEditor.editor.focus());
    await fs('fs.read', notes);
    await focusedTab(notes);
    assert.deepEqual(
      await page.evaluate(
        id => window.followApp.codeEditor.agentCursor(id),
        configs[0].agentId,
      ),
      modelingCursor,
    );

    await page.locator('[data-file-tree-search-input]').fill('model.ts');
    await page
      .getByRole('button', {name: 'Hide file explorer', exact: true})
      .click();
    await fs('fs.list', '/browse/deep');
    await focusedDirectory('/browse/deep');
    assert.equal(await page.locator('#project-explorer').isVisible(), true);
    assert.equal(
      await page.locator('[data-file-tree-search-input]').inputValue(),
      '',
    );
    await page.getByRole('treeitem', {name: 'notes.md', exact: true}).waitFor();
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      notes,
    );
    await fs('fs.list', '/empty');
    await focusedDirectory('/empty');

    // Scroll from outside the tree to a virtual row that has not been mounted.
    await fs('fs.list', '/scroll');
    await focusedDirectory('/scroll');
    await fs('fs.read', notes);
    await focusedTab(notes);
    assert.equal(await directory('/scroll/entry-079').count(), 0);
    await fs('fs.list', '/scroll/entry-079');
    await focusedDirectory('/scroll/entry-079');
    await fs('fs.list', '/scroll/entry-000');
    await focusedDirectory('/scroll/entry-000');

    // A listed parent can be a segment of a compact directory row.
    await fs('fs.list', '/compact/parent/leaf');
    await focusedDirectory('/compact/parent/leaf');
    await fs('fs.list', '/scroll/entry-079');
    await focusedDirectory('/scroll/entry-079');
    await fs('fs.list', '/compact/parent');
    await focusedDirectory('/compact/parent/leaf');
    await fs('fs.list', '/compact');
    await focusedDirectory('/compact/parent/leaf');
    await fs('fs.list', '/scroll/entry-079');
    await focusedDirectory('/scroll/entry-079');
    await fs('fs.list', '/');
    await page.waitForFunction(() => {
      const root = document.querySelector('#project-tree')!.shadowRoot!;
      return (
        document.activeElement?.id === 'project-tree' &&
        root.activeElement === null &&
        root.querySelector('[data-file-tree-virtualized-scroll]')!.scrollTop ===
          0
      );
    });
    assert.notEqual(
      await page
        .locator('#project-tree [role="tree"]')
        .evaluate(element => getComputedStyle(element).boxShadow),
      'none',
    );

    for (const key of ['End', 'ArrowDown']) {
      const expected = await page.evaluate(last => {
        const tree = window.followApp.projectDirectory['tree'];
        const index = last ? tree.getVisibleCount() - 1 : 0;
        return tree.getVisibleRows(index, index)[0].path;
      }, key === 'End');
      await page.locator('#project-tree').press(key);
      await page.waitForFunction(
        path =>
          document
            .querySelector('#project-tree')!
            .shadowRoot!.activeElement?.getAttribute('data-item-path') === path,
        expected,
      );
      await fs('fs.list', '/');
      await page.waitForFunction(
        () =>
          document.activeElement?.id === 'project-tree' &&
          document.querySelector('#project-tree')!.shadowRoot!.activeElement ===
            null,
      );
    }
    await page.screenshot({path: '/tmp/code3d-agent-follow-root.png'});

    // Failed requests, stat and other agents leave the current selection alone.
    await fs('fs.stat', file);
    await fs('fs.list', '/browse/deep', 1);
    const failed = await clients[0].request({
      operation: 'fs.read',
      path: '/missing.txt',
    });
    assert.equal(failed.response.ok, false);
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      'project-tree',
    );
    await gauss.click();
    await focusedDirectory('/browse/deep');
    await euler.click();
    await page.waitForFunction(
      () => document.activeElement?.id === 'project-tree',
    );
    await fs('fs.read', notes);
    await focusedTab(notes);
    await euler.click();
    await fs('fs.read', '/browse/other.txt');
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      notes,
    );
    await euler.click();
    await focusedTab('/browse/other.txt');

    // The agent request can finish before the App has loaded its editor document.
    // A newer user action must cancel the delayed switch and tab focus.
    await page.evaluate(() => {
      const app = window.followApp;
      const reader = app.codeEditor.fileReader!;
      const read = reader.readFile.bind(reader);
      reader.readFile = async path => {
        if (path === '/slow.md') {
          reader.readFile = read;
          app.navigationHeld = true;
          await new Promise<void>(resolve => {
            app.releaseNavigation = resolve;
          });
          app.navigationReleased = true;
        }
        return read(path);
      };
    });
    await fs('fs.read', '/slow.md');
    await page.waitForFunction(() => window.followApp.navigationHeld);
    await page
      .locator('.editor-tab > button')
      .filter({hasText: 'follow.ts'})
      .click();
    await page.evaluate(() => window.followApp.releaseNavigation!());
    await page.waitForFunction(() => window.followApp.navigationReleased);
    await ready();
    assert.equal(
      await page.evaluate(() => window.followApp.codeEditor.currentFile()),
      file,
    );
    assert.equal(await euler.getAttribute('aria-pressed'), 'true');
    await fs('fs.read', notes);
    await focusedTab(notes);
    await fs('fs.list', '/browse/deep');
    await focusedDirectory('/browse/deep');
    await page.screenshot({path: '/tmp/code3d-agent-follow-files.png'});
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

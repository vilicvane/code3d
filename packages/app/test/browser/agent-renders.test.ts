import {appIsolationHeaders} from '../../build/isolation.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium, type Locator} from 'playwright-core';
import {runCli, startServe} from '../../../cli/test/process.ts';
import {reserveLocalPort} from './local-port.ts';

declare const window: Window & {
  agentTestEditor: import('../../src/editor.ts').CodeEditor;
  agentTestCamera: import('three').PerspectiveCamera;
  agentTestHistory: import('../../src/agent/render-history.ts').AgentRenderHistory;
};

test(
  'render history shows exact CLI images, pins selection, restores and revokes per agent',
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
    await context.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: async () => {},
      });
    });
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
    await page.goto(process.env.CODE3D_TEST_URL);
    const temp = await mkdtemp(join(tmpdir(), 'c3d-render-history-'));
    t.after(() => rm(temp, {recursive: true, force: true}));
    const configs: string[] = [];
    const agentIds: string[] = [];
    const servers: Awaited<ReturnType<typeof startServe>>[] = [];
    await page.locator('#agents-button').click();
    for (const name of ['Euler', 'Noether']) {
      const port = await reserveLocalPort(t);
      await page
        .getByLabel('Local port', {exact: true})
        .fill(String(port.port));
      await page.getByLabel('Agent name', {exact: true}).fill(name);
      await page
        .getByRole('button', {name: 'Add agent & copy prompt', exact: true})
        .click();
      await page.waitForFunction(
        name =>
          document
            .querySelector<HTMLTextAreaElement>('[aria-label="Agent prompt"]')
            ?.value.includes(`"name": "${name}"`),
        name,
      );
      const prompt = await page
        .getByLabel('Agent prompt', {exact: true})
        .inputValue();
      const guide = await page.request.get(
        prompt.match(/https?:\/\/\S+\/guides\/agents\.md/)![0],
      );
      assert.equal(guide.status(), 200);
      assert.ok(
        (await guide.text()).includes('View agent snapshots in the App'),
      );
      const config = JSON.parse(prompt.match(/```json\n([\s\S]*?)\n```/)![1]);
      const file = join(temp, `${name}.json`);
      await writeFile(file, JSON.stringify(config), {mode: 0o600});
      configs.push(file);
      agentIds.push(config.agentId);
      await port.release();
      servers.push(await startServe(t, file));
    }
    await page
      .locator('.agent-status[data-state="online"]')
      .waitFor({state: 'attached'});
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    const cli = async (
      agent: number,
      request: unknown,
      code = 0,
      requestId?: string,
    ) => {
      const result = await runCli(
        [
          configs[agent],
          '--output-dir',
          temp,
          ...(requestId ? ['--request-id', requestId] : []),
        ],
        JSON.stringify(request),
      );
      assert.equal(result.code, code, result.stdout + result.stderr);
      return JSON.parse(result.stdout);
    };
    const apply = (agent: number, id: string, input: object, code = 0) =>
      cli(agent, {operation: 'apply', input}, code, id);
    const preview = page.locator('.agent-render-preview');
    const viewportInset = await page
      .locator('#viewport-host')
      .evaluate(element =>
        parseFloat(
          getComputedStyle(element).getPropertyValue('--viewport-inset'),
        ),
      );
    const viewer = page.locator('.agent-render-viewer');
    const image = page.locator('.agent-render-image img');
    const thumbnails = page
      .getByRole('listbox', {name: 'Render timeline'})
      .getByRole('option');
    const count = page.locator('.agent-render-count');
    const waitCount = (value: string) =>
      page.waitForFunction(
        value =>
          document.querySelector('.agent-render-count')?.textContent === value,
        value,
      );
    const assertImage = async (element: Locator, path: string) => {
      const bytes = await element.evaluate(async element => [
        ...new Uint8Array(
          await (await fetch((element as HTMLImageElement).src)).arrayBuffer(),
        ),
      ]);
      assert.deepEqual(Buffer.from(bytes), await readFile(path));
    };
    const liveState = () =>
      page.evaluate(() => ({
        selection: window.agentTestEditor.editor.getSelection(),
        file: window.agentTestEditor.editor.getModel()?.uri.toString(),
        camera: window.agentTestCamera.position.toArray(),
        rotation: window.agentTestCamera.quaternion.toArray(),
      }));
    const file = '/snapshots.ts';
    const source =
      "import {box, sketch} from '@code3d/core';\nconst profile = sketch([['point', 1, [0, 0]], ['circle', 2, [1, 5]]]);\nexport default box(10, 6, 8);\n";
    const cursor = {file, regex: '(box\\(10, 6, 8\\))'};
    await apply(0, 'create', {
      files: [{path: file, version: null, content: source}],
      cursor,
    });
    assert.equal(await preview.isVisible(), false);
    const model = await apply(0, 'model', {cursor, topology: true, type: true});
    assert.equal(await preview.isVisible(), false);
    const render = {
      topology: {snapshotId: model.data.observation.snapshotId},
      render: {view: 'front'},
    };
    const first = await apply(0, 'front', render);
    await preview.waitFor();
    const firstUrl = await preview.locator('img').getAttribute('src');
    await assertImage(preview.locator('img'), first.artifacts[0].path);
    assert.equal(
      await preview.locator('time').getAttribute('datetime'),
      first.data.observation.render.capturedAt,
    );
    const coordinate = (await page
      .locator('#viewport-host > .viewport-coordinate-reference')
      .boundingBox())!;
    const corner = (await preview.boundingBox())!;
    assert.ok(
      Math.abs(corner.y - coordinate.y - coordinate.height - viewportInset) < 1,
    );
    await page.locator('#viewport-mode-render').click();
    assert.equal(await preview.isVisible(), false);
    await page.locator('#viewport-mode-modeling').click();
    assert.equal(await preview.isVisible(), true);
    assert.equal(await preview.locator('img').getAttribute('src'), firstUrl);
    await page.screenshot({path: '/tmp/code3d-agent-render-preview.png'});
    const before = await liveState();
    await preview.click();
    await waitCount('1 / 1');
    assert.deepEqual(
      await viewer.boundingBox(),
      await page.locator('#viewport-host').boundingBox(),
    );
    assert.equal(
      await page
        .locator('#viewport-host > .viewport-canvas')
        .evaluate(element => (element as HTMLElement).inert),
      true,
    );
    assert.equal(
      await page
        .locator('.monaco-editor')
        .first()
        .evaluate(element => Boolean(element.closest('[inert]'))),
      false,
    );
    // A real service disconnect dims every live identity indicator, even for
    // a pinned historical image. Reconnection must not alter that image.
    const badge = page
      .locator('.agent-nav .agent-badge')
      .filter({hasText: 'Euler'});
    const dotOpacity = (label: Locator, pseudo = false) =>
      label.evaluate(
        (element, pseudo) =>
          getComputedStyle(element, pseudo ? '::before' : null).opacity,
        pseudo,
      );
    const caption = viewer.locator('figcaption .agent-render-agent');
    const previewLabel = preview.locator('.agent-render-agent');
    assert.equal(await dotOpacity(badge.locator('.agent-badge-dot')), '1');
    assert.equal(await dotOpacity(caption, true), '1');
    const pinnedImage = await image.getAttribute('src');
    const scroll = await page
      .locator('.agent-render-timeline')
      .evaluate(element => element.scrollLeft);
    await servers[0].stop();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.agent-nav .agent-badge')].some(
        element =>
          element.textContent === 'Euler' &&
          (element as HTMLElement).dataset.active === 'false',
      ),
    );
    assert.equal(await dotOpacity(badge.locator('.agent-badge-dot')), '0.4');
    assert.equal(await dotOpacity(caption, true), '0.4');
    assert.equal(await dotOpacity(previewLabel, true), '0.4');
    assert.equal(await image.getAttribute('src'), pinnedImage);
    assert.equal(await count.textContent(), '1 / 1');
    assert.equal(
      await page
        .locator('.agent-render-timeline')
        .evaluate(element => element.scrollLeft),
      scroll,
    );
    await page.screenshot({path: '/tmp/code3d-agent-dot-offline.png'});
    await page.locator('#agents-button').click();
    const row = page.locator('.agent-row').filter({hasText: 'Euler'});
    assert.equal(await dotOpacity(row.locator('.agent-badge-dot')), '0.4');
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    servers[0] = await startServe(t, configs[0]);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.agent-nav .agent-badge')].some(
        element =>
          element.textContent === 'Euler' &&
          (element as HTMLElement).dataset.active === 'true',
      ),
    );
    assert.equal(await dotOpacity(caption, true), '1');
    assert.equal(await dotOpacity(previewLabel, true), '1');
    assert.equal(await image.getAttribute('src'), pinnedImage);
    const second = await apply(0, 'top', {...render, render: {view: 'top'}});
    await waitCount('2 / 2');
    assert.equal(
      second.data.observation.snapshotId,
      first.data.observation.snapshotId,
    );
    assert.notEqual(
      second.data.observation.render.capturedAt,
      first.data.observation.render.capturedAt,
    );
    await page
      .getByRole('button', {name: 'Previous snapshot', exact: true})
      .click();
    await waitCount('1 / 2');
    await assertImage(image, first.artifacts[0].path);
    const sketch = await apply(1, 'sketch', {
      cursor: {file, regex: '(sketch\\()'},
      render: true,
    });
    await waitCount('1 / 3');
    await assertImage(image, first.artifacts[0].path);
    await assertImage(preview.locator('img'), sketch.artifacts[0].path);
    const sketchPixels = await preview
      .locator('img')
      .evaluate(async element => {
        const bitmap = await createImageBitmap(element as HTMLImageElement);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let visible = 0;
        for (let offset = 0; offset < pixels.length; offset += 4)
          if (
            pixels[offset] > 120 &&
            pixels[offset + 1] > 120 &&
            pixels[offset + 2] < 160
          )
            visible++;
        bitmap.close();
        return visible;
      });
    assert.ok(
      sketchPixels > 300,
      `Expected a visible circle, found ${sketchPixels} foreground pixels`,
    );
    assert.equal(
      await preview.locator('.agent-render-agent').textContent(),
      'Noether',
    );
    await cli(0, {operation: 'result', requestId: 'front'});
    await apply(0, 'front', render);
    assert.equal(await count.textContent(), '1 / 3');
    const failed = await apply(
      1,
      'failed',
      {cursor: {file, regex: '(missing_expression)'}, render: true},
      1,
    );
    assert.equal(failed.ok, false);
    assert.equal(await count.textContent(), '1 / 3');
    await page
      .getByRole('button', {name: 'Show latest snapshot', exact: true})
      .click();
    await waitCount('3 / 3');
    await assertImage(image, sketch.artifacts[0].path);
    await page.screenshot({path: '/tmp/code3d-agent-render-viewer.png'});
    await page
      .getByLabel('Filter snapshots by agent')
      .selectOption(agentIds[0]);
    await waitCount('2 / 2');
    await assertImage(image, second.artifacts[0].path);
    // Keyboard selection keeps DOM focus, even when a new receipt updates the list.
    const selected = page.locator('.agent-render-thumb[aria-selected="true"]');
    await selected.focus();
    await page.keyboard.press('Home');
    await waitCount('1 / 2');
    await apply(1, 'another-sketch', {render: true});
    assert.equal(
      await selected.evaluate(element => element === document.activeElement),
      true,
    );
    await page.keyboard.press('ArrowRight');
    await waitCount('2 / 2');
    await page.getByLabel('Filter snapshots by agent').selectOption('');
    await waitCount('4 / 4');
    assert.deepEqual(await liveState(), before);
    await page.keyboard.press('Escape');
    assert.equal(await viewer.isVisible(), false);
    assert.equal(
      await preview.evaluate(element => element === document.activeElement),
      true,
    );
    assert.equal(
      await page
        .locator('#viewport-host > .viewport-canvas')
        .evaluate(element => (element as HTMLElement).inert),
      false,
    );

    // The preview stacks directly below visible sketch controls as focus changes.
    await page.evaluate(
      ({file, source}) => {
        const start = source.indexOf('sketch([');
        window.agentTestEditor.revealSource(
          {file, start, end: start + 6},
          true,
        );
      },
      {file, source},
    );
    const liveSketch = page.locator(
      '#viewport-host > .sketch-editor:not([hidden])',
    );
    await liveSketch.waitFor();
    const thumbnailBounds = (await preview.boundingBox())!;
    const toolbarBounds = (await liveSketch
      .locator('.sketch-toolbar')
      .first()
      .boundingBox())!;
    assert.ok(
      Math.abs(
        thumbnailBounds.y -
          toolbarBounds.y -
          toolbarBounds.height -
          viewportInset,
      ) < 1,
    );
    assert.ok(
      Math.abs(
        thumbnailBounds.x +
          thumbnailBounds.width -
          toolbarBounds.x -
          toolbarBounds.width,
      ) < 1,
    );
    await page.screenshot({
      path: '/tmp/code3d-agent-render-sketch-preview.png',
    });
    await liveSketch
      .locator('.sketch-canvas circle.local[data-id="1"]')
      .click();
    const constraints = liveSketch.locator('.sketch-constraint-tools');
    await constraints.waitFor();
    const constraintBounds = (await constraints.boundingBox())!;
    const pushedPreview = (await preview.boundingBox())!;
    assert.ok(
      Math.abs(
        pushedPreview.y -
          constraintBounds.y -
          constraintBounds.height -
          viewportInset,
      ) < 1,
    );
    await page.setViewportSize({width: 1050, height: 720});
    const narrowControls = (await constraints.boundingBox())!;
    const narrowPreview = (await preview.boundingBox())!;
    const narrowToolbar = (await liveSketch
      .locator('.sketch-toolbar')
      .first()
      .boundingBox())!;
    const header = (await page.locator('.viewport-header').boundingBox())!;
    assert.ok(narrowToolbar.y >= header.y + header.height + viewportInset - 1);
    assert.ok(
      Math.abs(
        narrowPreview.y -
          narrowControls.y -
          narrowControls.height -
          viewportInset,
      ) < 1,
    );
    await page.screenshot({path: '/tmp/code3d-agent-render-sketch-stack.png'});
    await page.keyboard.press('Escape');
    await constraints.waitFor({state: 'hidden'});
    const collapsed = (await preview.boundingBox())!;
    assert.ok(
      Math.abs(
        collapsed.y - narrowToolbar.y - narrowToolbar.height - viewportInset,
      ) < 1,
    );
    await page.setViewportSize({width: 1440, height: 900});
    const sketchState = await liveState();
    await preview.click();
    assert.equal(
      await liveSketch.evaluate(element => (element as HTMLElement).inert),
      true,
    );
    await page
      .getByRole('button', {name: 'Previous snapshot', exact: true})
      .click();
    assert.deepEqual(await liveState(), sketchState);
    await page.keyboard.press('Escape');
    assert.equal(
      await liveSketch.evaluate(element => (element as HTMLElement).inert),
      false,
    );

    await page.reload();
    await preview.waitFor();
    assert.equal(await dotOpacity(previewLabel, true), '0.4');
    await page
      .locator('.agent-status[data-state="online"]')
      .waitFor({state: 'attached'});
    await cli(1, {operation: 'context'});
    assert.equal(await dotOpacity(previewLabel, true), '1');
    await preview.click();
    await waitCount('4 / 4');
    assert.equal(await thumbnails.count(), 4);
    // A narrower layout stays inside the visualization pane and scrolls its timeline.
    await page.setViewportSize({width: 1050, height: 720});
    assert.deepEqual(
      await viewer.boundingBox(),
      await page.locator('#viewport-host').boundingBox(),
    );
    await page.screenshot({path: '/tmp/code3d-agent-render-narrow.png'});
    await page
      .getByRole('button', {name: 'Previous snapshot', exact: true})
      .click();
    await waitCount('3 / 4');
    const staleUrl = await image.getAttribute('src');
    await page.locator('#agents-button').click();
    await page
      .locator('.agent-row')
      .filter({hasText: 'Noether'})
      .getByRole('button', {name: 'Revoke', exact: true})
      .click();
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    await waitCount('2 / 2');
    assert.equal(await thumbnails.count(), 2);
    assert.equal(
      await page.evaluate(async url => {
        try {
          await fetch(url!);
          return false;
        } catch {
          return true;
        }
      }, staleUrl),
      true,
    );
    assert.notEqual(await image.getAttribute('src'), firstUrl);
    // Removing a pinned agent falls back to following the remaining agent's latest.
    await viewer
      .getByRole('button', {name: 'Back to live view', exact: true})
      .click();
    const dismiss = page.getByRole('button', {
      name: 'Dismiss snapshot preview',
      exact: true,
    });
    await dismiss.click();
    assert.equal(await preview.isVisible(), false);
    assert.equal(await dismiss.isVisible(), false);
    await cli(0, {operation: 'context'});
    await cli(0, {operation: 'result', requestId: 'front'});
    assert.equal(await preview.isVisible(), false);
    await apply(0, 'after-revoke', {cursor, render: true});
    await preview.waitFor();
    assert.equal(await dismiss.isVisible(), true);
    await preview.click();
    await waitCount('3 / 3');
    await page.reload();
    await preview.waitFor();
    assert.equal(await dotOpacity(previewLabel, true), '0.4');
    await page
      .locator('.agent-status[data-state="online"]')
      .waitFor({state: 'attached'});
    await cli(0, {operation: 'context'});
    assert.equal(await dotOpacity(previewLabel, true), '1');
    await preview.click();
    await waitCount('3 / 3');
    await page.locator('#agents-button').click();
    await page.getByLabel('Local agent connections', {exact: true}).click();
    await page.getByRole('button', {name: 'Revoke all', exact: true}).click();
    await page.getByRole('button', {name: 'Close', exact: true}).click();
    assert.equal(await page.locator('.agent-renders').isVisible(), false);
    await page.reload();
    await page.locator('#agents-button').waitFor();
    assert.equal(await preview.isVisible(), false);
    assert.deepEqual(errors, []);
  },
);

test(
  'gallery preserves pinned scroll and can resume following after revocation or eviction',
  {timeout: 30_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, []));
    const url = new URL(
      '/__agent-render-gallery__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<link rel="stylesheet" href="/src/style.css"><main id="viewport-host" class="viewport-host" style="width:360px;height:500px"></main>',
      }),
    );
    await page.goto(url);
    await page.evaluate(async () => {
      const {AgentRenderHistory} = await import('/src/agent/render-history.ts');
      const {AgentRenderView} = await import('/src/ui/agent-renders.ts');
      window.agentTestHistory = new AgentRenderHistory();
      new AgentRenderView(
        document.querySelector<HTMLElement>('main')!,
        window.agentTestHistory,
      );
    });
    const add = (start: number, end: number, agent = 'Euler') =>
      page.evaluate(
        ({start, end, agent}) => {
          for (let index = start; index <= end; index++)
            window.agentTestHistory.record(
              {id: agent, name: agent, color: 0},
              {
                requestId: String(index),
                fingerprint: String(index),
                response: {
                  ok: true,
                  data: {
                    observation: {
                      render: {
                        capturedAt: new Date(
                          Date.UTC(2026, 8, 8, 0, 0, index),
                        ).toISOString(),
                      },
                    },
                  },
                  artifacts: [
                    {
                      name: 'render.png',
                      mimeType: 'image/png',
                      base64:
                        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8_x8AAwMCAO-a6XcAAAAASUVORK5CYII',
                    },
                  ],
                },
              },
            );
        },
        {start, end, agent},
      );
    const count = page.locator('.agent-render-count');
    const latest = page.getByRole('button', {
      name: 'Show latest snapshot',
      exact: true,
    });
    await add(1, 2);
    await add(3, 3, 'Noether');
    await page.locator('.agent-render-preview').click();
    await page
      .getByRole('button', {name: 'Previous snapshot', exact: true})
      .click();
    await page.evaluate(() => window.agentTestHistory.remove('Noether'));
    assert.equal(await count.textContent(), '2 / 2');
    assert.equal(await latest.isEnabled(), true);
    await latest.click();
    await add(4, 4);
    assert.equal(await count.textContent(), '3 / 3');
    await add(5, 15);
    await page.locator('.agent-render-thumb[aria-selected="true"]').focus();
    await page.keyboard.press('Home');
    const image = page.locator('.agent-render-image img');
    const pinnedUrl = await image.getAttribute('src');
    const timeline = page.getByRole('listbox', {name: 'Render timeline'});
    const scrolled = await timeline.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      return element.scrollLeft;
    });
    assert.ok(scrolled > 0);
    await add(16, 16);
    assert.equal(
      await timeline.evaluate(element => element.scrollLeft),
      scrolled,
    );
    assert.equal(await image.getAttribute('src'), pinnedUrl);
    // Evicting the pinned frame returns to the latest and releases its object URL.
    await add(17, 120);
    assert.equal(await count.textContent(), '100 / 100');
    assert.equal(await latest.isEnabled(), false);
    assert.equal(await timeline.getByRole('option').count(), 100);
    assert.equal(
      await page.evaluate(async url => {
        try {
          await fetch(url!);
          return false;
        } catch {
          return true;
        }
      }, pinnedUrl),
      true,
    );
    await add(121, 121);
    assert.equal(await count.textContent(), '100 / 100');
    await page.evaluate(() => window.agentTestHistory.clear());
    assert.equal(await page.locator('.agent-renders').isVisible(), false);
    // Removing a dismissed frame does not reopen the preview; a newly received
    // frame does, including a concurrent render captured earlier but delivered late.
    await add(2, 2);
    await add(3, 3, 'Noether');
    await page
      .getByRole('button', {name: 'Dismiss snapshot preview', exact: true})
      .click();
    await page.evaluate(() => window.agentTestHistory.remove('Noether'));
    assert.equal(
      await page.locator('.agent-render-preview').isVisible(),
      false,
    );
    await add(1, 1);
    assert.equal(await page.locator('.agent-render-preview').isVisible(), true);
  },
);

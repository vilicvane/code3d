import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {appIsolationHeaders} from '../../build/isolation.ts';

test(
  'agent modes match GUI captures and reset defaults across snapshots and agents',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({reducedMotion: 'reduce'});
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(
      '/__agent-render-mode-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<link rel="stylesheet" href="/src/style.css"><main style="width:960px;height:720px"></main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {AgentObserver} = await import('/src/agent/observer.ts');
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const {sourceDecorationProviders} =
        await import('/src/model/source-decorations.ts');
      const source = `import {box} from '@code3d/core';
const shape = box(10, 6, 8).material('#e65b38');
export default shape;`;
      const project = {files: [{path: '/model.ts', source}]};
      const cursor = {
        file: '/model.ts',
        start: source.indexOf('material('),
        end: source.indexOf(';\nexport'),
      };
      const observer = new AgentObserver(browserPackageFiles, () => 1);
      const observe = async (
        input: import('@code3d/agent').ApplyInput,
        agentId = 'euler',
      ) => {
        const response = await observer.observe({
          agentId,
          revision: 1,
          project,
          cursor,
          input,
        });
        if (!response.ok) throw new Error(JSON.stringify(response));
        return {
          data: response.data as {
            snapshotId: string;
            models: unknown[];
            topology: unknown;
            render: {
              mode: string;
              view: import('../../src/rendering/image-camera.ts').ImageView;
            };
          },
          png: response.artifacts![0].base64,
        };
      };
      const modeling = await observe({render: true, topology: true});
      const topology = {snapshotId: modeling.data.snapshotId};
      const rendered = await observe({topology, render: {mode: 'render'}});
      const restored = await observe({topology, render: {}});
      const front = await observe({
        topology,
        render: {mode: 'render', view: 'front'},
      });
      // Recompilation restores scene state too; neither agent inherits that mode.
      const otherAgent = await observe({render: true}, 'noether');
      await observe({render: {mode: 'render'}});
      const recompiled = await observe({render: {mode: 'modeling'}});

      const compiler = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main')!, {
        animateViewChanges: false,
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
        sourceDecorationProviders,
      });
      const bytes = async (blob: Blob) =>
        Array.from(new Uint8Array(await blob.arrayBuffer()));
      try {
        const module = await compiler.compile(project, '/model.ts', {
          file: cursor.file,
          offset: cursor.start,
        });
        viewport.renderModule(module);
        viewport.selectBySourceOffset(
          cursor.file,
          cursor.start,
          undefined,
          module.activeDesignContextId,
        );
        const guiModeling = await bytes(
          await viewport.captureImage(960, 720, modeling.data.render.view),
        );
        viewport.setRenderMode('render');
        const guiRendered = await bytes(
          await viewport.captureImage(960, 720, rendered.data.render.view),
        );
        return {
          modeling,
          rendered,
          guiModeling,
          guiRendered,
          modes: [
            modeling,
            rendered,
            restored,
            front,
            otherAgent,
            recompiled,
          ].map(item => item.data.render.mode),
          sameSnapshot: [rendered, restored, front].every(
            item => item.data.snapshotId === modeling.data.snapshotId,
          ),
          sameTopology:
            JSON.stringify(modeling.data.topology) ===
            JSON.stringify(rendered.data.topology),
          restored: restored.png === modeling.png,
          isolated:
            otherAgent.png === modeling.png && recompiled.png === modeling.png,
          viewChanged: front.png !== rendered.png,
        };
      } finally {
        compiler.dispose();
        viewport['renderer'].dispose();
        viewport['controls'].dispose();
      }
    });
    assert.deepEqual(result.modes, [
      'modeling',
      'render',
      'modeling',
      'render',
      'modeling',
      'modeling',
    ]);
    assert.notEqual(result.modeling.png, result.rendered.png);
    assert.equal(result.sameSnapshot, true);
    assert.equal(result.sameTopology, true);
    assert.equal(result.restored, true);
    assert.equal(result.isolated, true);
    assert.equal(result.viewChanged, true);
    // Protocol images use unpadded base64url; compare the actual PNG bytes.
    assert.deepEqual(
      Buffer.from(result.guiModeling),
      Buffer.from(result.modeling.png, 'base64url'),
    );
    assert.deepEqual(
      Buffer.from(result.guiRendered),
      Buffer.from(result.rendered.png, 'base64url'),
    );
    for (const [name, image] of [
      ['modeling', result.modeling],
      ['render', result.rendered],
    ] as const) {
      const png = Buffer.from(image.png, 'base64');
      assert.equal(png.readUInt32BE(16), 960);
      assert.equal(png.readUInt32BE(20), 720);
      await writeFile(`/tmp/code3d-agent-mode-${name}.png`, png);
    }
    assert.deepEqual(errors, []);
  },
);

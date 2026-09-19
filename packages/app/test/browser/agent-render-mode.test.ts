import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';
import {appIsolationHeaders} from '../../build/response-headers.ts';

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
        const scope = viewport.sourceEvaluationAt(
          module,
          cursor.file,
          cursor.start,
          module.activeDesignContextId,
        );
        const selection = {
          file: cursor.file,
          offset: cursor.start,
          contextId:
            scope?.evaluation.contextId ?? module.activeDesignContextId,
          order: scope?.evaluation.runtime.order,
          callId: scope?.evaluation.inspectCallId,
        };
        const scene = await compiler.inspect(module, selection);
        if (!scene) throw new Error('Missing inspection');
        viewport.renderInspection(module, scene, selection);
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

test(
  'observe captures mixed inspect scenes and pages generated geometry and local sketch topology',
  {timeout: 120_000},
  async t => {
    assert.ok(process.env.CODE3D_TEST_URL);
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(
      '/__agent-mixed-inspect-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<link rel="stylesheet" href="/src/style.css">',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {AgentObserver} = await import('/src/agent/observer.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const source = `import {box, sketch} from '@code3d/core';
const stock = box(20,20,20);
const base = sketch([['point', 1, [2,3]], ['point', 2, [15,0]], ['line', 3, [1,2]]]);
const profile = base.relate(s => s.plane.align(stock.up));
const side = base.relate(s => s.plane.align(stock.right));
/** @code3d.inspect show.inspect */
function show() { return stock; }
namespace show { export function inspect() { return {ambient: [stock], target: [box(7,3,4), profile, side]}; } }
export default show();`;
      const observer = new AgentObserver(browserPackageFiles, () => 1);
      const observe = async (
        input: import('@code3d/agent').ApplyInput,
        offset = source.lastIndexOf('show();'),
      ) => {
        const response = await observer.observe({
          agentId: 'mixed',
          revision: 1,
          project: {files: [{path: '/model.ts', source}]},
          cursor: {
            file: '/model.ts',
            start: offset,
            end: source.length,
          },
          input,
        });
        if (!response.ok) throw new Error(JSON.stringify(response));
        return {
          data: response.data as any,
          png: response.artifacts?.[0].base64,
        };
      };
      const first = await observe({render: {view: 'front'}, topology: true});
      const snapshotId = first.data.snapshotId;
      const sketch = await observe({
        render: {view: 'front'},
        topology: {snapshotId, model: 's0'},
      });
      const side = await observe({topology: {snapshotId, model: 's1'}});
      const ambient = await observe({topology: {snapshotId, model: 'm1'}});
      const custom = await observe({
        render: {view: {direction: [2, 3, 4], up: [0, 1, 0]}},
        topology: {snapshotId},
      });
      const relate = await observe(
        {topology: true},
        source.indexOf('base.relate(') + 5,
      );
      return {
        relate,
        first,
        sketch,
        side,
        ambient,
        differentView: first.png !== custom.png,
      };
    });
    assert.equal(result.relate.data.topology.kind, 'sketch');
    assert.equal(result.relate.data.models[0].kind, 'sketch');
    assert.ok(
      result.relate.data.models.some(
        (model: {kind: string}) => model.kind === 'solid',
      ),
    );
    assert.equal(result.first.data.modelsTotal, 4);
    assert.deepEqual(
      result.first.data.models.map((m: {key: string}) => m.key),
      ['m0', 's0', 's1', 'm1'],
    );
    assert.ok(Math.abs(result.first.data.topology.bounds.size[0] - 7) < 1e-5);
    assert.ok(
      Math.abs(result.ambient.data.topology.bounds.size[0] - 20) < 1e-5,
    );
    assert.equal(result.sketch.data.topology.coordinates.space, 'sketch-local');
    assert.deepEqual(result.sketch.data.topology.items[0].position, [2, 3]);
    assert.notDeepEqual(
      result.sketch.data.models[0].geometryToScene.quaternion,
      result.side.data.models[0].geometryToScene.quaternion,
    );
    assert.equal(result.sketch.png, result.first.png);
    assert.equal(result.differentView, true);
    await writeFile(
      '/tmp/code3d-180-observe-mixed.png',
      Buffer.from(result.first.png!, 'base64url'),
    );
    assert.deepEqual(errors, []);
  },
);

import {appIsolationHeaders} from '../../build/isolation.ts';
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium} from 'playwright-core';

declare const window: Window & {
  decorationTest: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
  };
};

test(
  'Boolean regions stay in the primary input frame when the result solves to a different position',
  {timeout: 120_000},
  async t => {
    const page = await openViewport(t);
    const results = await page.evaluate(async () => {
      const {viewport, compiler} = window.decorationTest;
      const results = [];
      for (const kind of ['cut', 'union', 'intersect'] as const) {
        const source = `import {box, point, cut, union, intersect} from '@code3d/core';
const base = box(20, 20, 20).relate(self => self.on(point().up)${kind === 'intersect' ? '.rotate(0, 0, 25)' : ''});
const cutter = box(30, 10, 30).originOffset(0, ${kind === 'cut' ? '-5' : kind === 'intersect' ? '-20' : '0'}, 0);
export default ${kind === 'cut' ? 'cut(base, [cutter])' : `${kind}([base, cutter])`};`;
        const module = await compiler.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        const operation = [...module.operations.values()].find(
          op => op.kind === kind,
        )!;
        const receiver = module.objects.get(operation.inputs[0].nodeId)!;
        const output = module.objects.get(operation.outputNodeId)!;
        for (const role of [
          'receiver',
          kind === 'cut' ? 'tool' : 'operand',
        ] as const) {
          const target = module.sourceTargets.find(
            target =>
              target.kind === 'operation-input' &&
              target.evaluations.some(
                e =>
                  e.operationId === operation.id &&
                  e.operationInput?.role === role,
              ),
          )!;
          viewport['renderSourceTarget'](
            target,
            target.evaluations.findIndex(e => e.operationId === operation.id),
          );
          const occurrence = [
            ...viewport['occurrences'].values(),
            ...viewport['contextOccurrences'].values(),
          ].find(o => o.node.nodeId === receiver.nodeId)!;
          occurrence.object.updateWorldMatrix(true, true);
          const layers = viewport['decorationLayers'].get(
            'source-context:boolean-operation-regions',
          )!;
          const distances = layers.map(({object}) => {
            let mesh: import('three').Mesh | undefined;
            object.traverse(child => {
              if ((child as import('three').Mesh).isMesh && !mesh)
                mesh = child as import('three').Mesh;
            });
            mesh!.updateWorldMatrix(true, false);
            const point = mesh!.position
              .clone()
              .fromBufferAttribute(mesh!.geometry.getAttribute('position'), 0);
            return point
              .clone()
              .applyMatrix4(mesh!.matrixWorld)
              .distanceTo(point.applyMatrix4(occurrence.object.matrixWorld));
          });
          results.push({
            kind,
            role,
            distances,
            receiverPose: receiver.compositionTransform,
            outputPose: output.compositionTransform,
          });
        }
      }
      return results;
    });
    for (const result of results) {
      assert.notDeepEqual(
        result.receiverPose,
        result.outputPose,
        `The fixture must distinguish the two frames: ${JSON.stringify(result)}`,
      );
      assert.ok(result.distances.length > 0);
      assert.ok(
        result.distances.every(distance => distance < 1e-6),
        JSON.stringify(result),
      );
    }
    if (process.env.CODE3D_DECORATION_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_DECORATION_SCREENSHOT});
  },
);

test(
  'loft argument results follow the first section frame and hide during input previews',
  {timeout: 120_000},
  async t => {
    const page = await openViewport(t);
    const results = await page.evaluate(async () => {
      const {viewport, compiler} = window.decorationTest;
      const source = `import {circle, loft, point, rectangle} from '@code3d/core';
const start = circle(12).relate(s => s.on(point([17, 8, -13]).up).rotate(0, 0, 25));
const end = rectangle(18, 18).relate(s => s.on(start.up).offset(0, 30, 0));
export default loft([start, end]);`;
      const module = await compiler.compile(
        {files: [{path: '/main.ts', source}]},
        '/main.ts',
      );
      if (module.diagnostic) throw new Error(module.diagnostic.summary);
      viewport.renderModule(module);
      const operation = [...module.operations.values()].find(
        op => op.kind === 'loft',
      )!;
      const results = [];
      for (const word of ['start', 'end']) {
        viewport.selectBySourceOffset('/main.ts', source.lastIndexOf(word) + 1);
        const occurrences = [
          ...viewport['occurrences'].values(),
          ...viewport['contextOccurrences'].values(),
        ];
        const receiver = occurrences.find(
          o => o.node.nodeId === operation.inputs[0].nodeId,
        )!;
        receiver.object.updateWorldMatrix(true, true);
        const layers = viewport['decorationLayers'].get(
          'source-context:loft-result',
        )!;
        const distances = layers.map(({object}) => {
          let mesh: import('three').Mesh | undefined;
          object.traverse(child => {
            if ((child as import('three').Mesh).isMesh && !mesh)
              mesh = child as import('three').Mesh;
          });
          mesh!.updateWorldMatrix(true, false);
          const point = mesh!.position
            .clone()
            .fromBufferAttribute(mesh!.geometry.getAttribute('position'), 0);
          return point
            .clone()
            .applyMatrix4(mesh!.matrixWorld)
            .distanceTo(point.applyMatrix4(receiver.object.matrixWorld));
        });
        viewport.hideSourceDecorationsDuringPreview();
        const hidden = !viewport['decorationLayers'].has(
          'source-context:loft-result',
        );
        viewport.restoreSourceDecorations();
        results.push({
          word,
          distances,
          count: occurrences.length,
          hidden,
          restored: viewport['decorationLayers'].get(
            'source-context:loft-result',
          )?.length,
          receiverPosition: receiver.object.position.toArray(),
        });
      }
      return results;
    });
    for (const result of results) {
      assert.equal(result.count, 2);
      assert.equal(result.distances.length, 1);
      assert.ok(result.distances[0] < 1e-6, JSON.stringify(result));
      assert.ok(
        result.receiverPosition.some(value => Math.abs(value) > 1),
        'Fixture must have a nonzero first section pose',
      );
      assert.equal(result.hidden, true);
      assert.equal(result.restored, 1);
    }
  },
);

test(
  'origin markers stay at local zero between commit and recompilation and during a second drag',
  {timeout: 120_000},
  async t => {
    const page = await openViewport(t);
    const result = await page.evaluate(async () => {
      const {viewport, compiler} = window.decorationTest;
      const {spatialIntent} = await import('/src/tools/model-spatial-tool.ts');
      const {originDecoration} =
        await import('/src/model/origin-decorations.ts');
      const source =
        "import {box} from '@code3d/core'; export default box(20, 10, 30).originOffset(2, 3, 4);";
      const module = await compiler.compile(
        {files: [{path: '/main.ts', source}]},
        '/main.ts',
      );
      if (module.diagnostic) throw new Error(module.diagnostic.summary);
      viewport.renderModule(module);
      viewport.selectBySourceOffset(
        '/main.ts',
        source.indexOf('originOffset') + 2,
      );
      const marker = (owner: string) => {
        const anchor = viewport['decorationLayers'].get(owner)![0].anchor!;
        return anchor.getWorldPosition(anchor.position.clone()).toArray();
      };
      const intent = (delta: number) => {
        const binding = viewport['transformGizmo']['axes'][0].binding!;
        if (binding.kind !== 'spatial') throw new Error('No origin handle');
        return spatialIntent(binding, binding.value + delta);
      };
      const first = intent(5);
      viewport.hideSourceDecorationsDuringPreview();
      viewport.setSpatialPreview(first.preview.objects);
      viewport.setDecorations(
        'spatial-preview',
        first.preview.objects.map(object =>
          originDecoration(object.nodeId, object.spatial.origin),
        ),
      );
      const dragging = marker('spatial-preview');
      viewport.commitSpatialPreview(
        first.preview.objects,
        first.preview.parameter,
      );
      viewport.clearSpatialPreview(first.preview.objects);
      viewport.clearDecorations('spatial-preview');
      viewport.restoreSourceDecorations();
      const committed = marker('source-context:model-origin');
      const second = intent(3);
      viewport.hideSourceDecorationsDuringPreview();
      viewport.setSpatialPreview(second.preview.objects);
      viewport.setDecorations(
        'spatial-preview',
        second.preview.objects.map(object =>
          originDecoration(object.nodeId, object.spatial.origin),
        ),
      );
      const draggingAgain = marker('spatial-preview');
      viewport.clearSpatialPreview(second.preview.objects);
      viewport.clearDecorations('spatial-preview');
      viewport.restoreSourceDecorations();
      return {
        dragging,
        committed,
        draggingAgain,
        cancelled: marker('source-context:model-origin'),
      };
    });
    assert.deepEqual(result.dragging, [5, 0, 0]);
    assert.deepEqual(result.committed, [0, 0, 0]);
    assert.deepEqual(result.draggingAgain, [3, 0, 0]);
    assert.deepEqual(result.cancelled, [0, 0, 0]);
  },
);

test(
  'fillet and chamfer comparisons follow each repeated result occurrence through previews',
  {timeout: 120_000},
  async t => {
    const page = await openViewport(t);
    const results = await page.evaluate(async () => {
      const {viewport, compiler} = window.decorationTest;
      const {edgeModificationSourceDecoration} =
        await import('/src/model/operation-decorations.ts');
      const results = [];
      for (const kind of ['fillet', 'chamfer'] as const) {
        const source = `import {box, group, point} from '@code3d/core';
const part = box(20, 10, 30).originVertex(3).rotate(10, 25, 0).${kind}(0.5, [1]);
const assembly = group([part]);
const moved = assembly.relate(self => self.on(point([40, 0, 0]).up));
export default group([assembly, moved]);`;
        const module = await compiler.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        const operation = [...module.operations.values()].find(
          op => op.kind === kind,
        )!;
        const target = module.sourceTargets.find(
          target =>
            target.kind === 'operation-output' &&
            target.evaluations[0].operationId === operation.id,
        )!;
        viewport.setDecorations(
          'comparison',
          edgeModificationSourceDecoration.decorations({
            module,
            target,
            evaluation: target.evaluations[0],
          }),
        );
        const occurrences = [...viewport['occurrences'].values()].filter(
          o => o.node.nodeId === operation.outputNodeId,
        );
        const check = () =>
          viewport['decorationLayers'].get('comparison')!.map(instance => {
            const occurrence = occurrences.find(
              o => o.key === instance.occurrenceKey,
            )!;
            instance.object.updateWorldMatrix(true, true);
            occurrence.object.updateWorldMatrix(true, true);
            return instance.object.matrixWorld.elements.every(
              (value, i) =>
                Math.abs(value - occurrence.object.matrixWorld.elements[i]) <
                1e-6,
            );
          });
        const before = check();
        viewport.setOccurrenceTranslationPreview(
          [occurrences[1].key],
          [7, 8, 9],
        );
        const during = check();
        viewport.clearOccurrenceTranslationPreview([occurrences[1].key]);
        results.push({
          kind,
          occurrences: occurrences.length,
          before,
          during,
          cancelled: check(),
        });
      }
      return results;
    });
    for (const result of results) {
      assert.equal(result.occurrences, 2);
      for (const phase of [result.before, result.during, result.cancelled]) {
        assert.equal(phase.length, 4, result.kind);
        assert.ok(phase.every(Boolean), result.kind);
      }
    }
  },
);

test(
  'pivotVertex candidates and markers use the current relation stage after origin and rotation edits',
  {timeout: 120_000},
  async t => {
    const page = await openViewport(t);
    const results = await page.evaluate(async () => {
      const {viewport, compiler} = window.decorationTest;
      const results = [];
      for (const reversed of [false, true]) {
        const source = `import {box} from '@code3d/core';
const base = box(60, 2, 40);
export default box(20, 10, 30).originVertex(3).rotate(10, 25, 15).relate(self => ${reversed ? 'base.on(self.up)' : 'self.on(base.up)'}.rotate(0, 45, 0).pivotVertex(6).rotate(0, 0, 90).offset(20, 0, 0));`;
        const module = await compiler.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        viewport.selectBySourceOffset(
          '/main.ts',
          source.indexOf('pivotVertex') + 2,
        );
        const selection = viewport.sourceEvaluation()!.evaluation.selection!;
        if (selection.kind === 'edges')
          throw new Error('Expected vertex selection');
        const occurrence = viewport.getSelected()!;
        viewport.beginTopologySelection(
          occurrence.key,
          selection.inputNodeId,
          selection.kind,
          false,
          selection.ids,
          selection.scope,
        );
        const candidates = viewport['topologySelection']!;
        occurrence.object.updateWorldMatrix(true, true);
        candidates.guide.updateWorldMatrix(true, true);
        const mesh = occurrence.node.mesh!;
        const marker = viewport['decorationLayers'].get(
          'source-context:model-origin',
        )![0].anchor!;
        const pivot = occurrence.object.position
          .clone()
          .fromArray(mesh.topologyVertices, mesh.vertexIds.indexOf(6) * 3)
          .applyMatrix4(occurrence.object.matrixWorld);
        results.push({
          reversed,
          count: candidates.mesh.vertexIds.length,
          markerDistance: marker
            .getWorldPosition(marker.position.clone())
            .distanceTo(pivot),
          distances: candidates.mesh.vertexIds.map((id, i) => {
            const candidate = candidates.guide.position
              .clone()
              .fromArray(candidates.mesh.topologyVertices, i * 3)
              .applyMatrix4(candidates.guide.matrixWorld);
            const vertex = candidate
              .clone()
              .fromArray(mesh.topologyVertices, mesh.vertexIds.indexOf(id) * 3)
              .applyMatrix4(occurrence.object.matrixWorld);
            return candidate.distanceTo(vertex);
          }),
        });
      }
      return results;
    });
    for (const result of results) {
      assert.equal(result.count, 8);
      assert.ok(result.markerDistance < 1e-5, JSON.stringify(result));
      assert.ok(
        result.distances.every(distance => distance < 1e-5),
        JSON.stringify(result),
      );
    }
  },
);

async function openViewport(t: TestContext) {
  assert.ok(process.env.CODE3D_TEST_URL);
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  const context = await browser.newContext({
    viewport: {width: 1000, height: 800},
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => {
    try {
      await page.evaluate(() => window.decorationTest?.compiler.dispose());
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
      await browser.close();
    }
  });
  const url = new URL(
    '/__decoration-coordinates-test__',
    process.env.CODE3D_TEST_URL,
  ).href;
  await page.route(url, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: appIsolationHeaders,
      body: '<main style="width:980px;height:780px"></main>',
    }),
  );
  await page.goto(url);
  await page.evaluate(async () => {
    const {ModelCompilerClient} = await import('/src/model/compiler-client.ts');
    const {browserPackageFiles} =
      await import('/src/project/browser-packages.ts');
    const {ModelViewport} = await import('/src/viewport.ts');
    const {sourceDecorationProviders} =
      await import('/src/model/source-decorations.ts');
    window.decorationTest = {
      compiler: new ModelCompilerClient(browserPackageFiles),
      viewport: new ModelViewport(document.querySelector('main')!, {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
        sourceDecorationProviders,
      }),
    };
  });
  return page;
}

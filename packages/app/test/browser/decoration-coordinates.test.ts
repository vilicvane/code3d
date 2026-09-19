import {appIsolationHeaders} from '../../build/response-headers.ts';
import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium} from './browser-connection.ts';

declare const window: Window & {
  decorationTest: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
  };
};

test(
  'Boolean argument scenes render the original operands and generated regions in the common frame',
  {timeout: 120_000},
  async t => {
    const page = await openViewport(t);
    const results = await page.evaluate(async () => {
      const {inspectSource} =
        await import('/test/browser/inspection-fixture.ts');
      const {viewport, compiler} = window.decorationTest;
      const results = [];
      for (const kind of ['cut', 'union', 'intersect'] as const) {
        const source = `import {box, point, cut, union, intersect, rotate} from '@code3d/core';
const base = box(20, 20, 20).relate(self => [self.on(point().up), rotate(0, 0, 25)]);
const cutter = box(30, 10, 30).originOffset(0, -5, 0);
export default ${kind === 'cut' ? 'cut(base, [cutter])' : `${kind}([base, cutter])`};`;
        const module = await compiler.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        for (const token of ['base', 'cutter']) {
          await inspectSource(
            compiler,
            viewport,
            module,
            '/main.ts',
            source.lastIndexOf(token) + 1,
          );
          const scene = viewport['inspectionScene']!;
          const bodies = [...scene.target, ...scene.ambient].filter(
            item => item.kind === 'model',
          );
          results.push({
            kind,
            token,
            target: scene.target.length,
            ambient: scene.ambient.length,
            focused: scene.target.filter(item => item.focused).length,
            matrices: bodies.map(({model}) => {
              const occurrence = viewport
                .renderedOccurrences()
                .find(value => value.renderedNodeId === model.nodeId)!;
              occurrence.object.updateWorldMatrix(true, true);
              const pose = model.transform;
              return {
                actual: occurrence.object.matrixWorld.toArray(),
                expected: occurrence.object.matrix
                  .clone()
                  .compose(
                    occurrence.object.position.clone().fromArray(pose.position),
                    occurrence.object.quaternion
                      .clone()
                      .fromArray(pose.quaternion),
                    occurrence.object.scale.clone().fromArray(pose.scale),
                  )
                  .toArray(),
              };
            }),
          });
        }
      }
      return results;
    });
    for (const result of results) {
      assert.equal(
        result.target,
        result.kind === 'cut' && result.token === 'base' ? 1 : 2,
        JSON.stringify(result),
      );
      assert.equal(result.ambient, result.kind === 'union' ? 0 : 1);
      assert.equal(result.focused, 1);
      for (const matrix of result.matrices)
        matrix.actual.forEach((value, i) =>
          assert.ok(Math.abs(value - matrix.expected[i]) < 1e-6),
        );
    }
  },
);

test(
  'loft argument previews retain the placed sections and a separately rendered result',
  {timeout: 120_000},
  async t => {
    const page = await openViewport(t);
    const results = await page.evaluate(async () => {
      const {inspectSource} =
        await import('/test/browser/inspection-fixture.ts');
      const {viewport, compiler} = window.decorationTest;
      const source = `import {rotate, offset, circle, loft, point, rectangle} from '@code3d/core';
const start = circle(12).relate(s => [s.on(point([17, 8, -13]).up), rotate(0, 0, 25)]);
const end = rectangle(18, 18).relate(s => [s.on(start.up), offset(0, 30, 0)]);
export default loft([start, end]);`;
      const module = await compiler.compile(
        {files: [{path: '/main.ts', source}]},
        '/main.ts',
      );
      if (module.diagnostic) throw new Error(module.diagnostic.summary);
      const results = [];
      for (const word of ['start', 'end']) {
        await inspectSource(
          compiler,
          viewport,
          module,
          '/main.ts',
          source.lastIndexOf(word) + 1,
        );
        const scene = viewport['inspectionScene']!;
        const sections = scene.target.filter(item => item.kind === 'model');
        const result = scene.ambient.find(item => item.kind === 'model')!;
        results.push({
          word,
          target: sections.length,
          ambient: scene.ambient.length,
          focus: sections.filter(item => item.focused).length,
          count: viewport
            .renderedOccurrences()
            .filter(value => value.object.parent === viewport['root']).length,
          firstPose: sections[0].model.children[0].transform,
          resultPose: result.model.children[0].transform,
        });
      }
      return results;
    });
    for (const result of results) {
      assert.equal(result.target, 2);
      assert.equal(result.ambient, 1);
      assert.equal(result.count, 3);
      assert.equal(result.focus, 1);
      assert.deepEqual(result.firstPose, result.resultPose);
      assert.ok(result.firstPose.position.some(value => Math.abs(value) > 1));
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
      const {inspectSource} =
        await import('/test/browser/inspection-fixture.ts');
      const {spatialIntent} = await import('/src/tools/model-spatial-tool.ts');
      const source =
        "import {box} from '@code3d/core'; export default box(20, 10, 30).originOffset(2, 3, 4);";
      const module = await compiler.compile(
        {files: [{path: '/main.ts', source}]},
        '/main.ts',
      );
      if (module.diagnostic) throw new Error(module.diagnostic.summary);
      viewport.renderModule(module);
      await inspectSource(
        compiler,
        viewport,
        module,
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
      viewport.setSpatialPreview(first.preview.objects);
      const dragging = marker('source-context:model-origin');
      viewport.commitSpatialPreview(
        first.preview.objects,
        first.preview.parameter,
      );
      viewport.clearSpatialPreview(first.preview.objects);
      const committed = marker('source-context:model-origin');
      const second = intent(3);
      viewport.setSpatialPreview(second.preview.objects);
      const draggingAgain = marker('source-context:model-origin');
      viewport.clearSpatialPreview(second.preview.objects);
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
        const preview = {
          key: occurrences[1].key,
          nodeId: occurrences[1].node.nodeId,
          transform: {
            position: [7, 8, 9] as const,
            quaternion: [0, 0, 0, 1] as const,
          },
          spatial: {
            origin: [0, 0, 0] as const,
            vector: [0, 0, 0] as const,
            frame: {
              position: [0, 0, 0] as const,
              quaternion: [0, 0, 0, 1] as const,
            },
          },
        };
        viewport.setSpatialPreview([preview]);
        const during = check();
        viewport.clearSpatialPreview([preview]);
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
      const {inspectSource} =
        await import('/test/browser/inspection-fixture.ts');
      const results = [];
      for (const reversed of [false, true]) {
        const source = `import {box, rotate, pivotVertex, offset} from '@code3d/core';
const base = box(60, 2, 40);
export default box(20, 10, 30).originVertex(3).rotate(10, 25, 15).relate(self => [${reversed ? 'base.on(self.up)' : 'self.on(base.up)'}, rotate(0, 45, 0), pivotVertex(6).rotate(0, 0, 90), offset(20, 0, 0)]);`;
        const module = await compiler.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        if (
          !(await inspectSource(
            compiler,
            viewport,
            module,
            '/main.ts',
            source.lastIndexOf('pivotVertex(') + 'pivotVertex('.length,
          ))
        )
          throw new Error('Pivot argument has no inspection scene');
        const occurrence = viewport.getSelected()!;
        viewport.beginTopologySelection(
          occurrence.key,
          occurrence.node.nodeId,
          'vertex',
          false,
          [6],
        );
        const candidates = viewport['topologySelection']!;
        occurrence.object.updateWorldMatrix(true, true);
        candidates.guide.updateWorldMatrix(true, true);
        const mesh = occurrence.node.mesh!;
        const marker = viewport['decorationLayers'].get(
          'source-context:model-origin',
        )?.[0]?.anchor;
        if (!marker)
          throw new Error(
            JSON.stringify({
              kind: viewport.sourceContext?.target.kind,
              tool: viewport.sourceContext?.target.tool?.signature.name,
              spatial: viewport.sourceContext?.evaluation.relationSpatial,
              layers: [...viewport['decorationLayers'].keys()],
              node: occurrence.node.nodeId,
              relationOwner:
                viewport.sourceContext?.evaluation.relationOwnerNodeId,
            }),
          );
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

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'directional boundaries and each rotation-chain scope render in the host browser',
  {timeout: 120_000},
  async t => {
    const appUrl = process.env.CODE3D_TEST_URL;
    assert.ok(appUrl, 'Set CODE3D_TEST_URL to the task development server');
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const url = new URL('/__bound-rotation-test__', appUrl).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main style="width:900px;height:700px"></main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const {elementSourceDecoration, boundRelationSourceDecoration} =
        await import('/src/model/element-decorations.ts');
      const {originSourceDecoration} =
        await import('/src/model/origin-decorations.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main'), {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
        sourceDecorationProviders: [
          elementSourceDecoration,
          boundRelationSourceDecoration,
          originSourceDecoration,
        ],
      });
      const scopes = [];
      try {
        const source = (await import('/examples/bound-rotation.ts?raw'))
          .default;
        const compile = async source => {
          const module = await client.compile(
            {files: [{path: '/main.ts', source}]},
            '/main.ts',
          );
          if (module.diagnostic)
            throw new Error(JSON.stringify(module.diagnostic));
          viewport.renderModule(module);
          return module;
        };
        const inspect = (module, source, text) => {
          viewport.selectBySourceOffset(
            '/main.ts',
            source.indexOf(text) + (text.includes('(') ? 2 : text.length - 1),
          );
          const {target, evaluation} = viewport.sourceEvaluation();
          const selected = viewport.getSelected();
          const bindings = viewport.transformGizmo.axes.flatMap(axis =>
            axis.binding ? [axis.binding] : [],
          );
          scopes.push({
            text,
            kind: target.kind,
            owner: evaluation.constraintOwnerNodeId,
            selected: selected?.node.nodeId,
            modes: bindings.map(binding => binding.mode),
            axes: bindings.map(binding => binding.axis),
            spatialKind: evaluation.constraintSpatial?.kind,
          });
          return {target, evaluation, selected, bindings};
        };
        const module = await compile(source);
        inspect(module, source, 'pivot(50, 0, 0)');
        inspect(module, source, 'rotate(0, 0, 45)');
        const bound = inspect(module, source, 'start.up');
        const boundScope = {
          module,
          target: bound.target,
          evaluation: bound.evaluation,
        };
        const boundDecorations = [
          ...elementSourceDecoration.decorations(boundScope),
          ...boundRelationSourceDecoration.decorations(boundScope),
        ];
        const source2 = `import {box, group} from '@code3d/core'; const base = box(20, 10, 30); const part = box(8, 6, 4).relate(self => base.on(self.up).pivotVertex(3).rotate(0, 0, 45)); export default group([base, part]);`;
        const module2 = await compile(source2);
        const vertex = inspect(module2, source2, 'pivotVertex(3)');
        const selection = vertex.evaluation.selection;
        const vertexIds = viewport.beginTopologySelection(
          vertex.selected.key,
          selection.inputNodeId,
          'vertex',
          false,
          selection.ids,
        );
        const source3 = `import {box, group} from '@code3d/core'; const base = box(20, 10, 30); const part = box(8, 6, 4).relate(self => self.on(base.up).around(base.axis).rotate(35)); export default group([base, part]);`;
        const module3 = await compile(source3);
        inspect(module3, source3, 'around(base.axis)');
        inspect(module3, source3, 'rotate(35)');
        return {
          scopes,
          vertexIds,
          boundaryIds: boundDecorations.map(item => item.id),
          boundarySurfaces: boundDecorations
            .filter(item => item.kind === 'surface')
            .map(item => ({
              vertices: item.mesh.vertices.length,
              topology: item.mesh.surfaceGroups.length,
            })),
        };
      } finally {
        client.dispose();
      }
    });
    const [pivot, rotate, , vertex, around, axisRotate] = result.scopes;
    assert.equal(pivot.spatialKind, 'pivot');
    assert.deepEqual(pivot.modes, ['translate', 'translate', 'translate']);
    assert.equal(pivot.selected, pivot.owner);
    assert.deepEqual(rotate.modes, ['rotate', 'rotate', 'rotate']);
    assert.equal(rotate.selected, rotate.owner);
    assert.equal(vertex.selected, vertex.owner);
    assert.ok(result.vertexIds.includes(3));
    assert.equal(around.spatialKind, 'around');
    assert.deepEqual(around.axes, []);
    assert.deepEqual(axisRotate.modes, ['rotate']);
    assert.deepEqual(axisRotate.axes, ['y']);
    assert.equal(new Set(result.boundaryIds).size, result.boundaryIds.length);
    assert.deepEqual(result.boundarySurfaces, [
      {vertices: 12, topology: 0},
      {vertices: 12, topology: 0},
    ]);
  },
);

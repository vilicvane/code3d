import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'on renders the full source box once and restores ordinary selection bounds',
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
    const url = new URL(
      '/__on-source-bounds-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main style="width:900px;height:700px"></main>',
      }),
    );
    await page.goto(url);
    const results = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const {elementSourceDecoration, relationSourceDecoration} =
        await import('/src/model/element-decorations.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main'), {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
        sourceDecorationProviders: [
          elementSourceDecoration,
          relationSourceDecoration,
        ],
      });
      const cases = [
        {
          geometry: 'box(8, 6, 4).rotate(0, 0, 30)',
          relation: 'self.on(base.up)',
          edges: 12,
        },
        {
          geometry: 'group([box(8, 6, 4).rotate(0, 0, 30)])',
          relation: 'self.on(base.up)',
          edges: 12,
        },
        {
          geometry: 'group([box(8, 6, 4).rotate(0, 0, 30)])',
          relation: 'base.on(self.up)',
          edges: 12,
        },
        {
          geometry: 'box(8, 6, 4).rotate(0, 0, 30)',
          relation: 'self.center.on(base.up)',
          edges: 0,
        },
      ];
      const results = [];
      try {
        for (const spec of cases) {
          const source = `import {box, group} from '@code3d/core'; const base = box(20, 10, 30).rotate(0, 0, 15); const part = ${spec.geometry}.relate(self => ${spec.relation}.rotate(0, 0, 25)); export default group([base, part]);`;
          const module = await client.compile(
            {files: [{path: '/main.ts', source}]},
            '/main.ts',
          );
          if (module.diagnostic)
            throw new Error(JSON.stringify(module.diagnostic));
          viewport.renderModule(module);
          viewport.selectBySourceOffset('/main.ts', source.indexOf('.on(') + 2);
          const evaluation = viewport.sourceEvaluation().evaluation;
          const constraint = evaluation.constraintPreview.constraints.find(
            c => c.id === evaluation.constraintId,
          );
          const drawn = [];
          const callbacks = new WeakMap();
          const collect = (object, kind, nodeId) =>
            object.traverse(part => {
              if (!part.material) return;
              const before = callbacks.get(part) ?? part.onBeforeRender;
              callbacks.set(part, before);
              part.onBeforeRender = function (...args) {
                before.apply(this, args);
                drawn.push({
                  kind,
                  nodeId,
                  segments: part.geometry.instanceCount,
                  opacity: part.material.opacity,
                  color: (
                    part.material.color ?? part.material.uniforms.color.value
                  ).getHexString(),
                });
              };
            });
          for (const instances of viewport.decorationLayers.values()) {
            for (const instance of instances) {
              const decoration =
                instance.object.children[0].userData.decoration;
              if (decoration)
                collect(instance.object, decoration.kind, decoration.nodeId);
            }
          }
          if (viewport.selectionHighlight)
            collect(
              viewport.selectionHighlight,
              'selection',
              viewport.getSelected().node.nodeId,
            );
          viewport.rendering.renderFrame();
          const groupBoxBefore = viewport.selectionHighlight?.visible;
          viewport.clearDecorations('source-context:relation-geometry');
          results.push({
            spec,
            drawn: [...drawn],
            sourceId: constraint.source.nodeId,
            targetId: constraint.target.nodeId,
            groupBoxBefore,
            groupBoxAfter: viewport.selectionHighlight?.visible,
            selectedId: viewport.getSelected().node.nodeId,
          });
        }
        return results;
      } finally {
        client.dispose();
      }
    });
    for (const result of results) {
      const {drawn, sourceId, targetId, spec} = result;
      const source = drawn.filter(part => part.nodeId === sourceId);
      const target = drawn.filter(part => part.nodeId === targetId);
      assert.equal(
        source.filter(part => part.kind === 'bounds').length,
        spec.edges ? 1 : 0,
        JSON.stringify(result),
      );
      if (spec.edges)
        assert.equal(
          source.find(part => part.kind === 'bounds').segments,
          spec.edges * 2,
        );
      assert.equal(source.filter(part => part.kind === 'edges').length, 0);
      assert.equal(source.filter(part => part.kind === 'surface').length, 1);
      assert.equal(target.filter(part => part.kind === 'bounds').length, 0);
      assert.equal(target.filter(part => part.kind === 'surface').length, 1);
      assert.ok(
        source
          .filter(part => part.kind !== 'selection')
          .every(part => part.color === 'd8ff3e'),
      );
      assert.equal(
        source.find(part => part.kind === 'surface').opacity,
        0.18 * (sourceId === result.selectedId ? 1 : 0.7),
      );
      if (spec.geometry.startsWith('group') && sourceId === result.selectedId) {
        assert.equal(result.groupBoxBefore, false);
        assert.equal(result.groupBoxAfter, true);
      }
    }
  },
);

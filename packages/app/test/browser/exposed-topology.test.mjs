import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'exposed faces and chained vertices render and pick in the assembly frame',
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
    const url = new URL('/__exposed-topology-test__', appUrl).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main style="width:800px;height:600px"></main>',
      }),
    );
    await page.goto(url);
    const result = await page.evaluate(async () => {
      const {ModelCompilerClient} =
        await import('/src/model/compiler-client.ts');
      const {browserPackageFiles} =
        await import('/src/project/browser-packages.ts');
      const {ModelViewport} = await import('/src/viewport.ts');
      const {elementSourceDecoration} =
        await import('/src/model/element-decorations.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main'), {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
        sourceDecorationProviders: [elementSourceDecoration],
      });
      const source = `import {box, group, point} from '@code3d/core';
const part = box(10, 20, 30);
const shifted = group([part]).expose({body: part}).relate(self => self.body.center.on(point([40, 50, 60])));
const assembly = group([shifted]).expose({mount: shifted.body.surface(1), body: shifted.body});
const outline = assembly.mount.edges();
const ends = assembly.mount.edge(1).vertices();
const center = assembly.mount.center;
export default assembly;`;
      try {
        const module = await client.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        viewport.renderModule(module);
        const checks = [];
        for (const [expression, expectedCount] of [
          ['assembly.mount.edges()', 4],
          ['assembly.mount.edge(1).vertices()', 2],
        ]) {
          viewport.selectBySourceOffset(
            '/main.ts',
            source.indexOf(expression) + expression.length - 1,
          );
          const {evaluation, target} = viewport.sourceEvaluation();
          const selection = evaluation.selection;
          if (!selection)
            throw new Error(`No selection for ${expression} (${target.kind})`);
          const occurrence = [...viewport.occurrences.values()].find(
            occurrence => occurrence.node.nodeId === selection.inputNodeId,
          );
          const available = viewport.beginTopologySelection(
            occurrence.key,
            selection.inputNodeId,
            selection.kind,
            true,
            selection.ids,
            selection.scope,
          );
          const guide = viewport.topologySelection.guide;
          guide.updateWorldMatrix(true, true);
          viewport.camera.updateWorldMatrix(true, false);
          const mesh = viewport.topologySelection.mesh;
          const sample = guide.position.clone();
          if (selection.kind === 'vertex')
            sample.fromArray(mesh.topologyVertices, 0);
          else
            sample
              .fromArray(mesh.edges, 0)
              .add(guide.position.clone().fromArray(mesh.edges, 3))
              .multiplyScalar(0.5);
          sample.applyMatrix4(guide.matrixWorld).project(viewport.camera);
          const rect = viewport.renderer.domElement.getBoundingClientRect();
          const picked = viewport.pickTopology({
            clientX: rect.left + ((sample.x + 1) * rect.width) / 2,
            clientY: rect.top + ((1 - sample.y) * rect.height) / 2,
          });
          checks.push({
            expectedCount,
            available,
            kind: selection.kind,
            guidePosition: guide
              .getWorldPosition(guide.position.clone())
              .toArray(),
            meshIds:
              selection.kind === 'edge'
                ? viewport.topologySelection.mesh.edgeGroups.map(
                    group => group.edgeId,
                  )
                : viewport.topologySelection.mesh.vertexIds,
            ownerKind: occurrence.node.kind,
            selectedIds: [...viewport.topologySelection.selectedIds],
            picked,
          });
          viewport.endTopologySelection();
        }
        viewport.selectBySourceOffset(
          '/main.ts',
          source.indexOf('const outline') + 'const out'.length,
        );
        const outlineEvaluation = viewport.sourceEvaluation().evaluation;
        const owner = [...viewport.occurrences.values()].find(
          occurrence =>
            occurrence.node.nodeId ===
            outlineEvaluation.topologyReferences[0].nodeId,
        );
        const highlights = owner.object.children.filter(
          child => child.renderOrder === 24,
        );
        viewport.selectBySourceOffset(
          '/main.ts',
          source.indexOf('assembly.mount.center') +
            'assembly.mount.center'.length -
            1,
        );
        const center = viewport.sourceEvaluation().evaluation.element;
        const markers =
          viewport.decorationLayers.get('source-context:named-element')
            ?.length ?? 0;
        return {
          checks,
          highlightCount: highlights.length,
          highlightPositions: highlights.map(highlight =>
            highlight.position.toArray(),
          ),
          center: center.transform.position,
          markers,
        };
      } finally {
        viewport.renderer.dispose();
        viewport.controls.dispose();
        client.dispose();
      }
    });
    for (const check of result.checks) {
      assert.equal(check.available.length, check.expectedCount);
      assert.deepEqual(check.available, check.meshIds);
      assert.deepEqual(check.selectedIds, check.available);
      assert.equal(check.ownerKind, 'group');
      assert.deepEqual(check.guidePosition, [40, 50, 60]);
      assert.equal(check.picked, check.available[0]);
    }
    assert.equal(result.highlightCount, 4);
    assert.ok(
      result.highlightPositions.every(position =>
        position.every((value, index) => value === [40, 50, 60][index]),
      ),
    );
    assert.deepEqual(result.center, [35, 50, 60]);
    assert.ok(result.markers > 0);
  },
);

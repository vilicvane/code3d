import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'relation anchors render their owner, peer context, and selectable topology together',
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
    const url = new URL('/__relation-anchor-preview-test__', appUrl).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main style="width:800px;height:600px"></main>',
      }),
    );
    await page.goto(url);
    const results = await page.evaluate(async () => {
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
      const results = [];
      try {
        for (const [sourceAnchor, targetAnchor] of [
          ['self.edge(3)', 'base.left'],
          ['self.surface(2)', 'base.up'],
          ['self.vertex(2)', 'base.up'],
          ['self.up', 'base.down'],
        ]) {
          const source = `import {box, group} from '@code3d/core';
          const base = box(10, 10, 10);
          const part = box(20, 20, 20).relate(self => ${sourceAnchor}.on(${targetAnchor}));
          const peer = box(3, 3, 3).relate(self => self.down.on(base.up).offset(20, 0, 0));
          export default group([base, part, peer]);`;
          const module = await client.compile(
            {files: [{path: '/main.ts', source}]},
            '/main.ts',
          );
          if (module.diagnostic) throw new Error(module.diagnostic.message);
          viewport.renderModule(module);
          for (const anchor of [sourceAnchor, targetAnchor]) {
            viewport.selectBySourceOffset(
              '/main.ts',
              source.indexOf(anchor) + anchor.length - 1,
            );
            const {target, evaluation} = viewport.sourceEvaluation();
            const selected = viewport.getSelected();
            const rendered = [
              ...viewport.occurrences.values(),
              ...viewport.contextOccurrences.values(),
            ];
            const selection = evaluation.selection;
            let availableIds;
            if (selection) {
              availableIds = viewport.beginTopologySelection(
                selected.key,
                selection.inputNodeId,
                selection.kind,
                false,
                selection.ids,
              );
            }
            results.push({
              anchor,
              expectedContextCount: 2,
              expectedFocusCount: 1,
              hasOverlay: true,
              kind: target.kind,
              focusCount: viewport.occurrences.size,
              contextCount: viewport.contextOccurrences.size,
              ownerSelected:
                selected.node.nodeId ===
                (selection?.inputNodeId ?? evaluation.element.nodeId),
              correctPlacements: rendered.every(
                ({node, object, placement}) =>
                  placement === 'composition' &&
                  object.position
                    .toArray()
                    .every(
                      (value, index) =>
                        Math.abs(
                          value - node.compositionTransform.position[index],
                        ) < 1e-6,
                    ),
              ),
              availableIds,
              selectedIds: selection
                ? [...viewport.topologySelection.selectedIds]
                : undefined,
              overlayCount: selection
                ? viewport.topologySelectionOverlay?.children.length
                : viewport.decorationLayers.get('source-context:named-element')
                    ?.length,
              toolArgument: evaluation.toolArguments?.[0],
            });
            viewport.endTopologySelection();
          }
        }
        for (const compose of [true, false]) {
          const source = `import {box, circle, loft, rectangle} from '@code3d/core';
            const model = (() => {
              const ref = box(100, 100, 100);
              const start = circle(20).relate(circle => circle.on(ref.down));
              const end = rectangle(40, 40).relate(circle => circle.on(ref.up));
              ${compose ? 'return loft([start, end]);' : ''}
            })();`;
          const module = await client.compile(
            {files: [{path: '/main.ts', source}]},
            '/main.ts',
          );
          if (module.diagnostic) throw new Error(module.diagnostic.message);
          viewport.renderModule(module);
          for (const id of ['down', 'up']) {
            const callback = `circle => circle.on(ref.${id})`;
            const start = source.indexOf(callback);
            for (const [site, offset] of [
              ['parameter', 'cir'.length],
              ['receiver', 'circle => cir'.length],
              ['constraint', 'circle => circle.o'.length],
              [
                'anchor',
                callback.indexOf(`ref.${id}`) + `ref.${id}`.length - 1,
              ],
            ]) {
              viewport.selectBySourceOffset('/main.ts', start + offset);
              const {target, evaluation} = viewport.sourceEvaluation();
              const rendered = [
                ...viewport.occurrences.values(),
                ...viewport.contextOccurrences.values(),
              ];
              results.push({
                anchor: `${compose ? 'loft' : 'uncomposed'} surface(${id}) ${site}`,
                focusCount: viewport.occurrences.size,
                contextCount: viewport.contextOccurrences.size,
                expectedFocusCount: 1,
                expectedContextCount: (compose ? 3 : 2) - 1,
                ownerSelected:
                  viewport.getSelected().node.nodeId ===
                  (site === 'anchor'
                    ? evaluation.element.nodeId
                    : evaluation.constraintOwnerNodeId),
                correctPlacements: rendered.every(
                  ({node, object, placement}) =>
                    placement === 'composition' &&
                    object.position
                      .toArray()
                      .every(
                        (value, index) =>
                          Math.abs(
                            value - node.compositionTransform.position[index],
                          ) < 1e-6,
                      ) &&
                    object.quaternion
                      .toArray()
                      .every(
                        (value, index) =>
                          Math.abs(
                            value - node.compositionTransform.quaternion[index],
                          ) < 1e-6,
                      ),
                ),
                separated: rendered
                  .filter(({node}) => node.kind === 'face')
                  .every(({object}) => object.position.length() > 49),
              });
            }
          }
        }
        return results;
      } finally {
        client.dispose();
      }
    });
    assert.equal(results.length, 24);
    for (const result of results) {
      assert.equal(result.focusCount, result.expectedFocusCount, result.anchor);
      assert.equal(
        result.contextCount,
        result.expectedContextCount,
        result.anchor,
      );
      assert.equal(result.ownerSelected, true, result.anchor);
      assert.equal(result.correctPlacements, true, result.anchor);
      if (result.hasOverlay) assert.ok(result.overlayCount > 0, result.anchor);
      if (result.separated !== undefined)
        assert.equal(result.separated, true, result.anchor);
      if (result.kind === 'topology-selection') {
        assert.deepEqual(result.selectedIds, [result.toolArgument]);
        assert.ok(result.availableIds.includes(result.toolArgument));
      }
    }
  },
);

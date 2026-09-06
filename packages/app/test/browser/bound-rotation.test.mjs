import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'bound fills share the box style and corners follow each occurrence selection',
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
    const url = new URL('/__bound-highlight-test__', appUrl).href;
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
      const {namedElementDecorations} =
        await import('/src/model/element-decorations.ts');
      const client = new ModelCompilerClient(browserPackageFiles);
      const viewport = new ModelViewport(document.querySelector('main'), {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
      });
      try {
        const source = `import {box, group} from '@code3d/core';
        const solid = box(20, 10, 30);
        const assembly = group([solid]);
        export default group([assembly, assembly]);`;
        const module = await client.compile(
          {files: [{path: '/main.ts', source}]},
          '/main.ts',
        );
        if (module.diagnostic)
          throw new Error(JSON.stringify(module.diagnostic));
        viewport.renderModule(module);
        const groups = [...viewport.occurrences.values()].filter(
          item => item.node.kind === 'group' && item.depth === 1,
        );
        const solid = [...viewport.occurrences.values()].find(
          item => item.node.mesh,
        );
        const group = groups[0];
        const bound = group.node.elements.find(
          element => element.name === 'up',
        );
        viewport.setDecorations(
          'group-bound',
          namedElementDecorations(group.node, bound),
        );
        viewport.setDecorations(
          'solid-bound',
          namedElementDecorations(
            solid.node,
            solid.node.elements.find(element => element.name === 'up'),
          ),
          {occurrenceKeys: [solid.key]},
        );
        const renderCallbacks = new WeakMap();
        const inspect = key => {
          viewport.selectKey(key, false);
          const drawn = [];
          const collect = (owner, occurrenceKey, object) => {
            object.traverse(part => {
              if (!part.material) return;
              const beforeRender =
                renderCallbacks.get(part) ?? part.onBeforeRender;
              renderCallbacks.set(part, beforeRender);
              part.onBeforeRender = function (...args) {
                beforeRender.apply(this, args);
                drawn.push({
                  owner,
                  occurrenceKey,
                  color: (
                    part.material.color ?? part.material.uniforms.color.value
                  ).getHexString(),
                  opacity: part.material.opacity,
                  line:
                    object.children[0]?.userData.decoration?.kind === 'edges',
                });
              };
            });
          };
          for (const [owner, instances] of viewport.decorationLayers) {
            for (const instance of instances)
              collect(owner, instance.occurrenceKey, instance.object);
          }
          if (viewport.selectionHighlight)
            collect('box', key, viewport.selectionHighlight);
          viewport.rendering.renderFrame();
          return drawn;
        };
        return {
          keys: groups.map(item => item.key),
          frames: [
            ...groups.map(item => inspect(item.key)),
            inspect(solid.key),
            inspect(group.key),
          ],
        };
      } finally {
        client.dispose();
      }
    });
    assert.equal(results.keys.length, 2);
    for (const [index, frame] of results.frames.entries()) {
      const selectedGroup = [
        results.keys[0],
        results.keys[1],
        undefined,
        results.keys[0],
      ][index];
      const boxes = frame.filter(item => item.owner === 'box');
      assert.equal(boxes.length, selectedGroup ? 1 : 0);
      const color = boxes[0]?.color ?? 'd8ff3e';
      for (const key of results.keys) {
        const parts = frame.filter(
          item => item.owner === 'group-bound' && item.occurrenceKey === key,
        );
        assert.equal(
          parts.filter(item => item.line).length,
          key === selectedGroup ? 0 : 1,
        );
        assert.equal(parts.filter(item => item.opacity === 0.18).length, 1);
        assert.ok(parts.every(item => item.color === color));
        assert.ok(
          parts.filter(item => item.line).every(item => item.opacity === 0.85),
        );
      }
      const solidParts = frame.filter(item => item.owner === 'solid-bound');
      assert.equal(solidParts.filter(item => item.line).length, 1);
      assert.equal(solidParts.filter(item => item.opacity === 0.18).length, 1);
      assert.ok(solidParts.every(item => item.color === color));
    }
  },
);

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
      const {elementSourceDecoration, relationSourceDecoration} =
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
          relationSourceDecoration,
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
          ...relationSourceDecoration.decorations(boundScope),
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

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from 'playwright-core';

test(
  'caret stages render their own pose, reference geometry and tools',
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
    const url = new URL('/__constraint-stages-test__', appUrl).href;
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
      let diagnostic;
      const viewport = new ModelViewport(document.querySelector('main'), {
        onSelect() {},
        onDrillDown() {},
        onNavigateSource() {},
        onPositionTool() {},
        onTopologySelection() {},
        onSourcePreviewDiagnostic(value) {
          diagnostic = value;
        },
        sourceDecorationProviders: [
          elementSourceDecoration,
          relationSourceDecoration,
          originSourceDecoration,
        ],
      });
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
      const inspect = (source, text) => {
        viewport.selectBySourceOffset('/main.ts', source.indexOf(text) + 2);
        const scope = viewport.sourceEvaluation();
        const selected = viewport.getSelected();
        selected?.object.updateWorldMatrix(true, false);
        return {
          text,
          preview: scope.evaluation.constraintPreview,
          spatial: scope.evaluation.constraintSpatial,
          node: selected && {
            nodeId: selected.node.nodeId,
            pose: selected.node.compositionTransform,
          },
          matrix: selected?.object.matrixWorld.toArray(),
          context: [...viewport.contextOccurrences.values()].map(
            o => o.node.nodeId,
          ),
          bindings: viewport.transformGizmo.axes.flatMap(axis =>
            axis.binding
              ? [{mode: axis.binding.mode, value: axis.binding.value}]
              : [],
          ),
          diagnostic,
        };
      };
      try {
        const source = `import {box, group} from '@code3d/core';
        const base = box(20, 10, 30);
        const part = box(8, 6, 4).relate(self => self.on(base.up)
          .offset(10, 0, 0).pivot(5, 0, 0).rotate(0, 0, 90)
          .around(base.axis).rotate(30).offset(7, 0, 0));
        export default group([base, part]);`;
        const module = await compile(source);
        const finalPose = module.fallback.children[1].compositionTransform;
        const stages = [
          'on(base.up)',
          'offset(10',
          'pivot(5',
          'rotate(0',
          'around(base.axis)',
          'rotate(30)',
          'offset(7',
        ].map(text => inspect(source, text));
        const target = inspect(source, 'base.up');
        const ownerInContext = [...viewport.contextOccurrences.values()].find(
          o => o.node.nodeId === target.preview.nodeId,
        );
        const contextStagePose = ownerInContext?.node.compositionTransform;
        const plainSource = `import {box} from '@code3d/core'; export default box(8,6,4).rotate(0,0,45).rotate(0,0,90);`;
        await compile(plainSource);
        const plain = ['rotate(0,0,45)', 'rotate(0,0,90)'].map(text =>
          inspect(plainSource, text),
        );
        const aliasSource = `import {box,group} from '@code3d/core';
        const base = box(20,10,30);
        const part = box(8,6,4).relate(self => {
          const contact = self.on(base.up).offset(10,0,0);
          return contact.rotate(0,0,90).rotate(0,45,0);
        });
        export default group([base,part]);`;
        await compile(aliasSource);
        const aliases = [
          'contact =',
          'contact.rotate',
          'rotate(0,0,90)',
          'rotate(0,45,0)',
        ].map(text => inspect(aliasSource, text));
        const invalidSource = `import {box,group} from '@code3d/core';
        const base=box(20,10,20);
        const higher=box(20,10,20).relate(s=>s.on(base.up));
        const original=box(2,2,2).relate(s=>s.on(base.up));
        const part=original.relate(s=>s.on(higher.up).offset(0,-10,0));
        export default group([base,higher,part]);`;
        await compile(invalidSource);
        const invalid = inspect(invalidSource, 'on(higher.up)');
        const recovered = inspect(invalidSource, 'offset(0,-10,0)');
        return {
          stages,
          finalPose,
          contextStagePose,
          plain,
          aliases,
          invalid,
          recovered,
        };
      } finally {
        client.dispose();
      }
    });
    const near = (a, b) =>
      a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${a} != ${b}`));
    const {stages} = result;
    for (const stage of stages) {
      assert.equal(stage.diagnostic, undefined);
      assert.equal(stage.node.nodeId, stage.preview.nodeId);
      assert.deepEqual(stage.node.pose, stage.preview.compositionTransform);
      near(stage.matrix.slice(12, 15), stage.node.pose.position);
      assert.ok(stage.context.length > 0);
    }
    assert.deepEqual(stages[1].node.pose, stages[2].node.pose);
    assert.deepEqual(stages[3].node.pose, stages[4].node.pose);
    assert.notDeepEqual(
      stages[0].node.pose.position,
      stages[1].node.pose.position,
    );
    assert.notDeepEqual(
      stages[2].node.pose.quaternion,
      stages[3].node.pose.quaternion,
    );
    assert.notDeepEqual(
      stages[4].node.pose.quaternion,
      stages[5].node.pose.quaternion,
    );
    assert.deepEqual(stages[6].node.pose, result.finalPose);
    assert.deepEqual(result.contextStagePose, stages[0].node.pose);
    assert.equal(stages[3].bindings.length, 3);
    assert.equal(stages[5].bindings.length, 1);
    assert.equal(stages[5].bindings[0].value, 30);
    assert.equal(stages[4].bindings.length, 0);
    assert.notEqual(result.plain[0].node.nodeId, result.plain[1].node.nodeId);
    assert.deepEqual(result.aliases[0].node.pose, result.aliases[1].node.pose);
    near(result.aliases[0].node.pose.quaternion, [0, 0, 0, 1]);
    assert.notDeepEqual(
      result.aliases[1].node.pose,
      result.aliases[2].node.pose,
    );
    assert.notDeepEqual(
      result.aliases[2].node.pose,
      result.aliases[3].node.pose,
    );
    assert.match(
      result.invalid.diagnostic.details,
      /Conflicting bound positions/,
    );
    assert.equal(result.invalid.node, undefined);
    assert.equal(result.recovered.diagnostic, undefined);
    assert.ok(result.recovered.node);
  },
);

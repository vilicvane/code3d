import type {Browser} from 'playwright-core';
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {chromium} from 'playwright-core';

const appUrl = process.env.CODE3D_TEST_URL;
let browser: Browser;
before(async () => {
  assert.ok(appUrl, 'Set CODE3D_TEST_URL to the task development server');
  browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
});
after(async () => browser?.close());

for (const installed of [false, true] as const) {
  test(
    `solves assemblies and sketches in the Worker with ${installed ? 'project' : 'built-in'} packages`,
    {timeout: 120_000},
    async t => {
      const context = await browser.newContext();
      t.after(() => context.close());
      const page = await context.newPage();
      const url = new URL('/__constraint-solver-test__', appUrl).href;
      await page.route(url, route =>
        route.fulfill({
          contentType: 'text/html',
          body: '<main>Constraint solver integration test</main>',
        }),
      );
      await page.goto(url);
      const result = await page.evaluate(async installed => {
        const {ModelCompilerClient} =
          await import('/src/model/compiler-client.ts');
        const {browserPackageFiles} =
          await import('/src/project/browser-packages.ts');
        const client = new ModelCompilerClient(
          installed
            ? browserPackageFiles
            : {
                async readFile() {},
                async stat(path) {
                  return path === '/'
                    ? {kind: 'directory', version: ''}
                    : undefined;
                },
              },
        );
        const source = `import {box, group} from '@code3d/core';
        const first = box(10, 10, 10);
        const second = box(20, 20, 20).relate(self => [
          self.edge(3).on(first.left),
          self.up.on(first.down),
        ]);
        export default group([first, second]);`;
        const compile = (text: string) =>
          client.compile(
            {
              files: [
                {path: '/main.ts', source: text},
                ...(installed
                  ? [
                      {
                        path: '/package.json',
                        source: JSON.stringify({
                          type: 'module',
                          dependencies: {'@code3d/core': '*'},
                        }),
                      },
                    ]
                  : []),
              ],
            },
            '/main.ts',
          );
        const root = (
          module: import('../../src/model/compiler.ts').ModelModule,
        ) => module.objects.get(module.exports.get('default')!);
        try {
          const first = await compile(source);
          const shifted = await compile(
            source.replace(
              'self.up.on(first.down)',
              'self.up.on(first.down).offset(5, 0, 7)',
            ),
          );
          let conflict;
          try {
            const conflicting = await compile(
              source.replace(
                'self.up.on(first.down)',
                'self.up.on(first.down).offset(0, 0, 0)',
              ),
            );
            conflict = conflicting.diagnostic?.summary;
          } catch (error) {
            if (!(error instanceof Error)) throw error;
            conflict = error.message;
          }
          const restored = await compile(source);
          const sketchModule =
            await compile(`import {sketch} from '@code3d/core';
            const value = sketch([['point', 1, [0,0]], ['point', 2, [38,2]], ['line', 3, [1,2]]],
              {constraints: [['horizontal', 3], ['length', [3, 40]]]});`);
          const sketch = [...sketchModule.sketches.values()][0];
          const gesture: import('../../src/model/sketch-drag.ts').SketchDrag = {
            id: 2,
            position: [60, 20],
            editable: new Map([
              [1, [true, true]],
              [2, [true, true]],
            ]),
            data: sketch.data,
          };
          const moved = await client.previewSketchDrag([sketch], gesture);
          const pending = client.previewSketchDrag([sketch], gesture).then(
            () => 'unexpected completion',
            error => error.message,
          );
          client.cancel();
          const cancelled = await pending;
          const next = await client.previewSketchDrag([sketch], {
            ...gesture,
            position: [70, 30],
          });
          return {
            firstDiagnostic: first.diagnostic,
            first: root(first)?.children[1].transform.position,
            shiftedDiagnostic: shifted.diagnostic,
            shifted: root(shifted)?.children[1].transform.position,
            offset: root(shifted)?.children[1].constraints[1].offset,
            constraintSource:
              root(shifted)?.children[1].constraints[1].sourceRefs.at(-1)?.file,
            conflict,
            restored: root(restored)?.children[1].transform.position,
            sketchDiagnostic: sketchModule.diagnostic,
            originalSketch: sketch,
            moved,
            cancelled,
            next,
          };
        } finally {
          client.dispose();
        }
      }, installed);
      assert.equal(
        result.firstDiagnostic,
        undefined,
        JSON.stringify(result.firstDiagnostic),
      );
      assert.equal(
        result.shiftedDiagnostic,
        undefined,
        JSON.stringify(result.shiftedDiagnostic),
      );
      for (const [actual, expected] of [
        [result.first, [5, -15, 0]],
        [result.shifted, [5, -15, -7]],
        [result.restored, [5, -15, 0]],
      ] as const) {
        actual!.forEach((value, index) =>
          assert.ok(
            Math.abs(value - expected[index]) < 1e-6,
            JSON.stringify(result),
          ),
        );
      }
      assert.deepEqual(result.offset, [5, 0, 7]);
      assert.equal(result.constraintSource, '/main.ts');
      assert.match(result.conflict!, /Conflicting bound positions/);
      assert.equal(result.sketchDiagnostic, undefined);
      assert.match(result.cancelled, /superseded/);
      const originalPoints = result.originalSketch.entities.filter(
        e => e.kind === 'point',
      );
      for (const snapshot of [result.moved.snapshot, result.next.snapshot]) {
        const [a, b] = snapshot.entities
          .filter(e => e.kind === 'point')
          .map(e => e.position);
        for (const [index, p] of [a, b].entries())
          p.forEach((v, axis) =>
            assert.ok(
              Math.abs(v - originalPoints[index].position[axis]) < 1e-6,
            ),
          );
        assert.ok(Math.abs(b[0] - a[0] - 40) < 1e-6);
        assert.ok(Math.abs(b[1] - a[1]) < 1e-6);
        assert.equal(snapshot.degreesOfFreedom, 2);
      }
    },
  );
}

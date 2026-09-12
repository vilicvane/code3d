import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  coordinateApp: {
    previewState: import('../../src/model/preview-state.ts').ModelPreviewState;
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    compiler: import('../../src/model/compiler-client.ts').ModelCompilerClient;
    runModel(): Promise<void>;
    selectCompiledEvaluationContext(
      contextId: string,
      design: boolean,
    ): boolean;
    resumeCompilation?: (fail?: boolean) => void;
    finishStatusObservation?: () => {
      hidden: boolean;
      label: string;
      state?: string;
    }[];
  };
};

for (const [label, expression, method, expected] of [
  [
    'omitted origin',
    'box(24, 16, 14).originOffset()',
    'originOffset',
    /originOffset\(-?[\d.]+, 0, 0\)/,
  ],
  [
    'omitted rotation',
    'box(24, 16, 14).rotate()',
    'rotate',
    /rotate\(-?[\d.]+, 0, 0\)/,
  ],
  [
    'omitted pivot',
    'box(24, 16, 14).relate(self => [self.on(base.up), pivot().rotate(0, 0, 25)])',
    'pivot',
    /pivot\(\[-?[\d.]+, 0, 0\]\)/,
  ],
  [
    'opaque pivot',
    'box(24, 16, 14).relate(self => [self.on(base.up), pivot(coords).rotate(0, 0, 25)])',
    'pivot',
    /pivot\(\[-?[\d.]+, 2, 3\]\)/,
  ],
  [
    'omitted offset',
    'box(24, 16, 14).relate(self => [self.on(base.up), offset()])',
    'offset',
    /\boffset\(-?[\d.]+, 0, 0\)/,
  ],
  [
    'partial upstream offset',
    'box(24, 16, 14).relate(self => [self.on(base.up), offset(amount /* x */)])',
    'offset',
    /\boffset\(amount \/\* x \*\/, 0, 0\)/,
  ],
] as const) {
  test(
    `rendered ${label} gizmos support pointer preview, cancel, commit and undo`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box, group} from '@code3d/core';
const coords = [1, 2, 3] as const;
const amount = 2;
const base = box(40, 10, 30);
const part = ${expression};
group([base, part]);`;
      await setSource(page, source, method);
      await cameraIdle(page);
      if (method === 'pivot') await page.keyboard.down('Alt');
      const before = await state(page);
      assert.equal(
        before.bindings.filter(
          binding =>
            binding.mode === (method === 'rotate' ? 'rotate' : 'translate') &&
            (method === 'pivot'
              ? binding.kind === 'spatial' &&
                binding.spatial.source.kind === 'reference-offset'
              : !(
                  binding.kind === 'spatial' &&
                  binding.spatial.source.kind === 'reference-offset'
                )),
        ).length,
        3,
      );
      assert.equal(before.source, source);
      const handle =
        method === 'rotate'
          ? await rotationHandle(page, 0)
          : await xHandle(page);
      const drag = async () => {
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(
          handle.x + handle.dx * 40,
          handle.y + handle.dy * 40,
          {steps: 5},
        );
        const preview = await state(page);
        assert.equal(preview.active, true);
        assert.equal(preview.source, source);
        const readout = page.locator('.tool-drag-preview');
        assert.equal(await readout.isVisible(), true);
        const values = await page.evaluate(
          () => window.coordinateApp.viewport.dragPreview,
        );
        assert.ok(values && values.values[0].value !== values.values[0].start);
        assert.equal(
          values.values[0].label,
          method === 'rotate'
            ? 'Rotate X'
            : method === 'originOffset'
              ? 'Origin ΔX'
              : method === 'pivot'
                ? 'Pivot X'
                : 'ΔX',
        );
        assert.ok(
          (await readout.innerText()).includes(`${values.values[0].label}:`),
        );
        assert.equal(
          await readout.locator('.tool-drag-delta').innerText(),
          `${values.values[0].value - values.values[0].start < 0 ? '−' : '+'} ${Number(Math.abs(values.values[0].value - values.values[0].start).toPrecision(6))}`,
        );
        const panel = page.locator('.contextual-tool-panel');
        if (await panel.isVisible()) {
          const bounds = (await panel.boundingBox())!;
          assert.equal((await readout.boundingBox())!.width, bounds.width);
          const narrowWidths = await page.evaluate(() => {
            const stack = document
              .querySelector('.viewport-tool-stack')!
              .cloneNode(true) as HTMLElement;
            stack.style.width = '180px';
            stack.style.visibility = 'hidden';
            document.querySelector('.viewport-host')!.append(stack);
            const widths = ['.contextual-tool-panel', '.tool-drag-preview'].map(
              selector =>
                stack.querySelector(selector)!.getBoundingClientRect().width,
            );
            stack.remove();
            return widths;
          });
          assert.deepEqual(narrowWidths, [180, 180]);
          assert.deepEqual(
            await page.evaluate(() => {
              const styles = [
                '.contextual-tool-panel',
                '.tool-drag-preview',
              ].map(selector => {
                const style = getComputedStyle(
                  document.querySelector(selector)!,
                );
                return [
                  'backgroundColor',
                  'backdropFilter',
                  'boxShadow',
                  'border',
                  'borderRadius',
                  'padding',
                ].map(key => style[key as keyof CSSStyleDeclaration]);
              });
              return styles[0];
            }),
            await readout.evaluate(element => {
              const style = getComputedStyle(element);
              return [
                'backgroundColor',
                'backdropFilter',
                'boxShadow',
                'border',
                'borderRadius',
                'padding',
              ].map(key => style[key as keyof CSSStyleDeclaration]);
            }),
          );
          assert.equal(
            (await readout.boundingBox())!.y,
            bounds.y + bounds.height + 10,
          );
        }
        await page.screenshot({path: `/tmp/code3d-drag-${method}.png`});
      };
      await drag();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await page.locator('.tool-drag-preview').isVisible(), false);
      assert.equal((await state(page)).source, source);
      assert.equal((await state(page)).active, false);
      await drag();
      await page.mouse.up();
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() !== source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      const committed = (await state(page)).source;
      assert.match(committed, expected);
      const identifier = method === 'pivot' ? 'pivot' : method;
      assert.equal(
        await page.evaluate(identifier => {
          const editor = window.coordinateApp.codeEditor.editor;
          const offset = editor.getModel()!.getOffsetAt(editor.getPosition()!);
          return editor
            .getValue()
            .slice(offset - identifier.length, offset + 1);
        }, identifier),
        `${identifier}(`,
      );
      if (label === 'partial upstream offset') {
        assert.doesNotMatch(committed, /const amount = 2;/);
        assert.match(committed, /const amount = -?[\d.]+;/);
      }
      if (process.env.CODE3D_DEFAULT_GIZMO_SCREENSHOT && method === 'rotate')
        await page.screenshot({
          path: process.env.CODE3D_DEFAULT_GIZMO_SCREENSHOT,
        });
      await page.keyboard.up('Alt');
      await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      assert.equal((await state(page)).bindings.length, before.bindings.length);
      assert.deepEqual(errors, []);
    },
  );
}

test(
  'position grid snapping freezes the drag frame and stays enabled with Alt',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source =
      "import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box} from '@code3d/core';\nconst shift = 0.3;\nexport const part = box(24, 6, 14).rotate(17, 23, 11).originOffset(shift * -2, 0, 0);";
    await setSource(page, source, 'originOffset');
    const input = page.locator('input[data-parameter="dx"]');
    await input.waitFor();
    const inputStep = await input.getAttribute('step');
    const inspect = () =>
      page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        const grid = viewport['rendering'].grid;
        const active = viewport['transformGizmo']['active'];
        viewport['rendering'].renderFrame();
        return {
          source: codeEditor.editor.getValue(),
          frame: {
            step: grid.step,
            plane: grid.plane,
            axisOffset: grid.material.uniforms.axisOffset.value.toArray(),
            forward: grid.material.uniforms.forward.value.toArray(),
          },
          locked: grid['locked'],
          active: active && {
            value: active.value,
            initial: active.binding.value,
            sensitivity: active.binding.sensitivity,
            delta: active.delta,
          },
        };
      });
    const handle = await xHandle(page);
    const before = await inspect();
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.dx * 57,
      handle.y + handle.dy * 57,
      {steps: 4},
    );
    const snapped = await inspect();
    assert.ok(snapped.locked && snapped.active);
    assert.equal(snapped.active.sensitivity, -2);
    const displacement =
      (snapped.active.value - snapped.active.initial) *
      snapped.active.sensitivity;
    assert.ok(Math.abs(displacement) > 0);
    assert.ok(
      Math.abs(
        displacement / before.frame.step -
          Math.round(displacement / before.frame.step),
      ) < 1e-9,
    );
    assert.deepEqual(snapped.frame, before.frame);
    assert.equal(snapped.source, source);
    await page.keyboard.down('Alt');
    const withAlt = await inspect();
    assert.deepEqual(withAlt.active, snapped.active);
    assert.deepEqual(withAlt.frame, snapped.frame);
    assert.equal(await input.getAttribute('step'), inputStep);
    await page.keyboard.up('Alt');
    assert.equal((await inspect()).active?.value, snapped.active.value);
    const bytes = await page.evaluate(async () => {
      const viewport = window.coordinateApp.viewport;
      return (await viewport.captureImage(1200, 800)).size;
    });
    assert.ok(bytes > 1000);
    assert.deepEqual((await inspect()).frame, before.frame);
    if (process.env.CODE3D_GRID_SNAP_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_GRID_SNAP_SCREENSHOT});
    await page.mouse.up();
    await page.waitForFunction(
      original =>
        window.coordinateApp.codeEditor.editor.getValue() !== original,
      source,
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal((await inspect()).locked, false);
    assert.match((await inspect()).source, /originOffset\(shift \* -2, 0, 0\)/);
    await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      original =>
        window.coordinateApp.codeEditor.editor.getValue() === original,
      source,
    );
    await page.getByText('Ready', {exact: true}).waitFor();

    await input.focus();
    const oldValue = Number(await input.inputValue());
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.up('Alt');
    const incremented = Number(await input.inputValue());
    assert.ok(Math.abs(incremented - oldValue - Number(inputStep)) < 1e-10);
    assert.equal(await input.getAttribute('step'), inputStep);
    await page.keyboard.press('ArrowUp');
    assert.ok(
      Math.abs(
        Number(await input.inputValue()) - incremented - Number(inputStep),
      ) < 1e-10,
    );
    assert.equal((await inspect()).locked, false);
    assert.deepEqual(errors, []);
  },
);

test(
  'new spatial arguments wait for a model while unchanged gestures remain available',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source =
      "import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box} from '@code3d/core';\nexport const part = box(24, 6, 14).originOffset();";
    await setSource(page, source, 'originOffset');
    await cameraIdle(page);
    const handles = () =>
      page.evaluate(() => {
        const gizmo = window.coordinateApp.viewport['transformGizmo'];
        return gizmo['axes'].filter(
          axis => axis.controls.enabled && axis.controls.getHelper().visible,
        ).length;
      });
    const delayCompilation = () =>
      page.evaluate(() => {
        const app = window.coordinateApp;
        const compile = app.compiler.compile.bind(app.compiler);
        const gate = new Promise<void>((resolve, reject) => {
          app.resumeCompilation = fail => {
            app.compiler.compile = compile;
            app.resumeCompilation = undefined;
            if (fail) reject(new Error('Test model update failure'));
            else resolve();
          };
        });
        app.compiler.compile = async (...args) => {
          const [module] = await Promise.all([compile(...args), gate]);
          return module;
        };
      });
    const handle = await xHandle(page);
    const drag = async () => {
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 57,
        handle.y + handle.dy * 57,
        {steps: 4},
      );
    };
    assert.equal(await handles(), 3);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.up();
    assert.equal(
      await handles(),
      3,
      'A click without an edit keeps the handles available',
    );
    await drag();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(
      await handles(),
      3,
      'Cancellation keeps the handles available',
    );
    assert.equal((await state(page)).source, source);

    const geometryBefore = (await state(page)).geometry;
    await delayCompilation();
    await drag();
    const expected = await page.evaluate(() =>
      window.coordinateApp.viewport['transformGizmo'][
        'axes'
      ][0].proxy.position.toArray(),
    );
    await page.mouse.up();
    await page.waitForFunction(
      source => window.coordinateApp.codeEditor.editor.getValue() !== source,
      source,
    );
    assert.equal(
      await handles(),
      0,
      'Source commit immediately hides the old handles',
    );
    // Selection can still rebuild bindings from the retained model.
    await page.evaluate(() => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('box(24') + 2),
      );
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('originOffset') + 2),
      );
    });
    assert.equal(
      await handles(),
      0,
      'Selecting the old snapshot cannot restore stale handles',
    );
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    assert.equal(
      (await state(page)).active,
      false,
      'Hidden handles cannot capture a new drag',
    );
    await page.mouse.up();
    const draws = await page.evaluate(() => {
      const viewport = window.coordinateApp.viewport;
      let draws = 0;
      const restore: (() => void)[] = [];
      for (const axis of viewport['transformGizmo']['axes'])
        axis.controls.getHelper().traverse(object => {
          const original = object.onAfterRender;
          object.onAfterRender = function (...args) {
            draws++;
            original.apply(this, args);
          };
          restore.push(() => (object.onAfterRender = original));
        });
      try {
        viewport['rendering'].renderFrame();
      } finally {
        restore.forEach(callback => callback());
      }
      return draws;
    });
    assert.equal(
      draws,
      0,
      'No gizmo geometry is actually drawn while awaiting the model',
    );
    await page.screenshot({path: '/tmp/code3d-gizmo-awaiting-model.png'});
    await page.evaluate(() => window.coordinateApp.resumeCompilation!());
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(await handles(), 3);
    const actual = await page.evaluate(() =>
      window.coordinateApp.viewport['transformGizmo'][
        'axes'
      ][0].proxy.position.toArray(),
    );
    // Origin editing changes the model's coordinates: the new origin is zero
    // and the geometry is re-expressed relative to the dragged point.
    assert.deepEqual(actual, [0, 0, 0]);
    const geometryAfter = (await state(page)).geometry;
    geometryAfter.forEach((value, index) =>
      assert.ok(
        Math.abs(value - geometryBefore[index] + expected[index % 3]) < 1e-7,
      ),
    );
    await page.screenshot({path: '/tmp/code3d-gizmo-model-updated.png'});

    // Numeric tool edits use the same handover; a failed build keeps old tools hidden.
    await delayCompilation();
    const input = page.locator('input[data-parameter="dx"]');
    await input.fill('7.3');
    await input.press('Enter');
    await page.waitForFunction(() =>
      window.coordinateApp.codeEditor.editor
        .getValue()
        .includes('originOffset(7.3,'),
    );
    assert.equal(await handles(), 0);
    await page.evaluate(() => window.coordinateApp.resumeCompilation!(true));
    await page.getByText('Test model update failure', {exact: true}).waitFor();
    assert.equal(
      await handles(),
      0,
      'A retained model after failure still has stale bindings',
    );
    await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(
      await handles(),
      3,
      'A subsequent successful model restores the tools',
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'relationship offset dragging keeps its grid still while the selected occurrence moves',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, offset, box, group} from '@code3d/core';
const base = box(24, 6, 14);
const part = box(6, 8, 4).rotate(0, 27, 0).relate(s => [s.on(base.up), offset(1.3, 0, 0)]);
export const assembly = group([base, part]);`;
    await setSource(page, source, 'offset');
    const inspect = () =>
      page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        const selected = viewport.getSelected()!.object;
        viewport['rendering'].renderFrame();
        const grid = viewport['rendering'].grid;
        return {
          source: codeEditor.editor.getValue(),
          selected: selected
            .getWorldPosition(selected.position.clone())
            .toArray(),
          grid: {
            axisOffset: grid.material.uniforms.axisOffset.value.toArray(),
            forward: grid.material.uniforms.forward.value.toArray(),
            step: grid.step,
          },
          locked: grid['locked'],
        };
      });
    const handle = await xHandle(page);
    const before = await inspect();
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.dx * 57,
      handle.y + handle.dy * 57,
      {steps: 4},
    );
    const moved = await inspect();
    assert.ok(moved.locked);
    const displacement = Math.hypot(
      ...moved.selected.map((value, i) => value - before.selected[i]),
    );
    assert.ok(displacement > 0);
    assert.ok(
      Math.abs(
        displacement / before.grid.step -
          Math.round(displacement / before.grid.step),
      ) < 1e-8,
    );
    assert.deepEqual(moved.grid, before.grid);
    assert.equal(moved.source, before.source);
    await page.keyboard.down('Alt');
    const free = await inspect();
    assert.deepEqual(free.selected, moved.selected);
    assert.deepEqual(free.grid, before.grid);
    await page.keyboard.up('Alt');
    near((await inspect()).selected, moved.selected);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const cancelled = await inspect();
    assert.equal(cancelled.locked, false);
    near(cancelled.selected, before.selected);
    assert.equal(cancelled.source, before.source);
    assert.deepEqual(errors, []);
  },
);

test(
  'a downstream loft failure keeps the current section editable through drag, cancel and undo',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    page.on('console', message => {
      if (/\[mobx\]/i.test(message.text())) errors.push(message.text());
    });
    const source = `import {rotate, pivotVertex, pivotPoint, axisLine, axisEdge, pivot, offset, circle, group, loft, rectangle, regularPolygon} from '@code3d/core';
const start = circle(20);
const via = regularPolygon(20, 8).relate(self => [self.on(start.up), pivot([50, 0, 0]).rotate(0, 0, 45), offset(0, 0, 0)]);
const end = rectangle(40, 40).relate(self => [self.on(start.up), pivot([50, 0, 0]).rotate(0, 0, 90)]);
export const sections = group([start, via, end], 'Loft sections');
export default loft([start, via, end]).material('#d8ff3e');`;
    await setSource(page, source, 'offset');
    const inspect = () =>
      page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        const selected = viewport.getSelected()!;
        return {
          source: codeEditor.editor.getValue(),
          position: selected.object
            .getWorldPosition(selected.object.position.clone())
            .toArray(),
          offset: selected.node.transformations!.at(-1)!.offsets.at(-1)!.value,
          active: !!viewport['transformGizmo']['active'],
        };
      });
    // Keep these positions on the 5 mm grid at this camera scale.
    const before = await inspect();
    const drag = async (value: number) => {
      const handle = await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      assert.equal((await inspect()).active, true);
      const destination = await page.evaluate(value => {
        const viewport = window.coordinateApp.viewport;
        const axis = viewport['transformGizmo']['axes'][0];
        const controls = axis.controls as typeof axis.controls & {
          pointStart: import('three').Vector3;
          worldPositionStart: import('three').Vector3;
        };
        const point = controls.pointStart
          .clone()
          .add(controls.worldPositionStart)
          .add(
            axis.proxy.position
              .clone()
              .set(value - axis.binding!.value, 0, 0)
              .applyQuaternion(axis.proxy.quaternion),
          )
          .project(viewport['camera']);
        const rect = viewport['renderer'].domElement.getBoundingClientRect();
        return {
          x: rect.left + ((point.x + 1) * rect.width) / 2,
          y: rect.top + ((1 - point.y) * rect.height) / 2,
        };
      }, value);
      await page.mouse.move(destination.x, destination.y, {steps: 5});
      const preview = await inspect();
      near(preview.position, [
        before.position[0] + value,
        ...before.position.slice(1),
      ]);
      return preview;
    };
    const waitOffset = (value: number) =>
      page.waitForFunction(
        value =>
          window.coordinateApp.viewport
            .getSelected()
            ?.node.transformations?.at(-1)
            ?.offsets.at(-1)!.value[0] === value,
        value,
      );

    const invalid = await drag(-20);
    assert.equal(invalid.source, before.source);
    await page.mouse.up();
    await page.locator('#viewport-status[data-state=error]').waitFor();
    await waitOffset(-20);
    near((await inspect()).position, invalid.position);
    assert.match((await inspect()).source, /offset\(-20, 0, 0\)/);
    assert.match(
      await page.evaluate(
        () => window.coordinateApp.viewport['module']!.diagnostic!.summary,
      ),
      /Could not construct a solid loft/,
    );
    const broken = await inspect();
    await drag(-10);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(await inspect(), broken);

    const valid = await drag(-10);
    await page.mouse.up();
    await waitOffset(-10);
    await page.getByText('Ready', {exact: true}).waitFor();
    near((await inspect()).position, valid.position);
    assert.match((await inspect()).source, /offset\(-10, 0, 0\)/);
    await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await waitOffset(-20);
    await page.locator('#viewport-status[data-state=error]').waitFor();
    near((await inspect()).position, invalid.position);
    await page.keyboard.press('Control+Shift+z');
    await waitOffset(-10);
    await page.getByText('Ready', {exact: true}).waitFor();
    near((await inspect()).position, valid.position);
    if (process.env.CODE3D_LOFT_RECOVERY_SCREENSHOT)
      await page.screenshot({
        path: process.env.CODE3D_LOFT_RECOVERY_SCREENSHOT,
      });
    assert.deepEqual(errors, []);
  },
);

test(
  'loft arguments show the result on success and all editable sections after failure',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    for (const offset of [0, -18, -8]) {
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, circle, loft, rectangle, regularPolygon} from '@code3d/core';
const start = circle(20);
const via = regularPolygon(20, 8).relate(self => [self.on(start.up), pivot([50, 0, 0]).rotate(0, 0, 45), offset(${offset}, 0, 0)]);
const end = rectangle(40, 40).relate(self => [self.on(start.up), pivot([50, 0, 0]).rotate(0, 0, 90)]);
export default loft([start, via, end]).material('#d8ff3e');`;
      await page.evaluate(source => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.getModel()!.setValue(source);
        editor.setPosition(
          editor.getModel()!.getPositionAt(source.lastIndexOf('via') + 1),
        );
      }, source);
      await page.waitForFunction(offset => {
        const viewport = window.coordinateApp.viewport;
        return (
          viewport.getSelected()?.node.transformations?.at(-1)?.offsets.at(-1)!
            .value[0] === offset &&
          Boolean(viewport['module']?.diagnostic) === (offset === -18)
        );
      }, offset);
      const displayed = await page.evaluate(() => {
        const viewport = window.coordinateApp.viewport;
        viewport.fit();
        return {
          count:
            viewport['occurrences'].size + viewport['contextOccurrences'].size,
          result:
            viewport['decorationLayers'].get('source-context:loft-result')
              ?.length ?? 0,
          relative: viewport.hasRelativePositionContext(),
          tools: viewport.positionTools.availableTools,
          positions: [
            ...viewport['occurrences'].values(),
            ...viewport['contextOccurrences'].values(),
          ].map(o => ({
            actual: o.object.position.toArray(),
            expected: o.node.compositionTransform.position,
          })),
        };
      });
      assert.equal(displayed.count, 3);
      assert.equal(displayed.result, offset === -18 ? 0 : 1);
      assert.equal(displayed.relative, true);
      assert.ok(displayed.tools.includes('translate'));
      assert.ok(displayed.tools.includes('rotate-point'));
      for (const position of displayed.positions)
        near(position.actual, position.expected);
      await cameraIdle(page);
      if (process.env.CODE3D_LOFT_ARGUMENT_SCREENSHOT)
        await page.screenshot({
          path: `${process.env.CODE3D_LOFT_ARGUMENT_SCREENSHOT}-${offset}.png`,
        });
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'batch extrusion input focus, shared distance edits and failure recovery use the whole call',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {pivot, pivotVertex, pivotPoint, axisLine, axisEdge, offset, rotate, circle, rectangle, extrude as grow} from '@code3d/core';
const a = circle(10);
const b = rectangle(12, 12).relate(s => [s.on(a.up), offset(30, 0, 0), rotate(0, 0, 30)]);
export default grow([a, b], 20);`;
    await page.evaluate(source => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.getModel()!.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.lastIndexOf('a, b')),
      );
    }, source);
    await page.waitForFunction(
      () =>
        window.coordinateApp.viewport['decorationLayers'].get(
          'source-context:extrude-result',
        )?.length === 2,
    );
    const inspect = () =>
      page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        const layers =
          viewport['decorationLayers'].get('source-context:extrude-result') ??
          [];
        return {
          source: codeEditor.editor.getValue(),
          count:
            viewport['occurrences'].size + viewport['contextOccurrences'].size,
          results: layers.map(({object}) => {
            let decoration:
              | Extract<
                  import('../../src/viewport-decoration.ts').ViewportDecoration,
                  {kind: 'mesh'}
                >
              | undefined;
            object.traverse(child => {
              if (child.userData.decoration?.kind === 'mesh')
                decoration = child.userData.decoration;
            });
            return {
              nodeId: decoration!.nodeId,
              opacity: decoration!.appearance?.opacity,
            };
          }),
          focus: viewport.sourceContext?.evaluation.nodeIds,
          lengths: [...viewport['module']!.operations.values()]
            .filter(op => op.kind === 'extrude')
            .map(op => Math.hypot(...op.dimensions!.distance.vector)),
        };
      });
    const initial = await inspect();
    if (process.env.CODE3D_BATCH_EXTRUDE_SCREENSHOT) {
      await page.evaluate(() => window.coordinateApp.viewport.fit());
      await cameraIdle(page);
      await page.screenshot({
        path: `${process.env.CODE3D_BATCH_EXTRUDE_SCREENSHOT}.input.png`,
      });
    }
    assert.equal(initial.count, 2);
    assert.equal(initial.results.length, 2);
    assert.equal(
      initial.results.filter(result => result.opacity === 0.94).length,
      1,
    );
    assert.ok(
      initial.results.find(result => result.opacity === 0.94)?.nodeId ===
        initial.focus![0],
    );
    const distance = page.locator('[data-parameter=distance]');
    await distance.fill('30');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      [...window.coordinateApp.viewport['module']!.operations.values()]
        .filter(op => op.kind === 'extrude')
        .every(
          op =>
            Math.abs(Math.hypot(...op.dimensions!.distance.vector) - 30) < 1e-6,
        ),
    );
    assert.deepEqual((await inspect()).lengths, [30, 30]);
    assert.match((await inspect()).source, /grow\(\[a, b\], 30\)/);
    await page.evaluate(() => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setPosition(
        editor.getModel()!.getPositionAt(editor.getValue().lastIndexOf('b]')),
      );
    });
    const second = await inspect();
    assert.notDeepEqual(second.focus, initial.focus);
    assert.ok(
      second.results.find(result => result.opacity === 0.94)?.nodeId ===
        second.focus![0],
    );
    await distance.fill('0');
    await page.keyboard.press('Enter');
    await page.locator('#viewport-status[data-state=error]').waitFor();
    assert.equal((await inspect()).count, 2);
    assert.equal((await inspect()).results.length, 0);
    await distance.fill('12');
    await page.keyboard.press('Enter');
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.deepEqual((await inspect()).lengths, [12, 12]);
    await page.evaluate(() => {
      const {viewport, codeEditor} = window.coordinateApp;
      const editor = codeEditor.editor;
      editor.setPosition(
        editor.getModel()!.getPositionAt(editor.getValue().lastIndexOf('12')),
      );
      viewport.fit();
    });
    await page.waitForFunction(
      () =>
        window.coordinateApp.viewport['decorationLayers'].get(
          'source-context:parameter-geometry',
        )?.length === 2,
    );
    await cameraIdle(page);
    if (process.env.CODE3D_BATCH_EXTRUDE_SCREENSHOT)
      await page.screenshot({
        path: process.env.CODE3D_BATCH_EXTRUDE_SCREENSHOT,
      });
    assert.deepEqual(errors, []);
  },
);

test(
  'intersection previews include both inputs inside inline primitive arguments',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    await page.evaluate(() => {
      const editor = window.coordinateApp.codeEditor.editor;
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box, intersect, sphere} from '@code3d/core';
export default intersect([sphere(8), box(12, 12, 12)]);`;
      editor.getModel()!.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.lastIndexOf('intersect') + 2),
      );
    });
    await page.waitForFunction(() => {
      const target = window.coordinateApp.viewport.sourceContext?.target;
      return (
        (target?.tool?.signature.name ?? target?.operation?.kind) ===
        'intersect'
      );
    });
    await page.getByText('Ready', {exact: true}).waitFor();
    for (const call of ['sphere(8)', 'box(12, 12, 12)']) {
      await page.evaluate(call => {
        const editor = window.coordinateApp.codeEditor.editor;
        const offset = editor.getValue().indexOf(call) + call.indexOf('(') + 1;
        editor.setPosition(editor.getModel()!.getPositionAt(offset));
        editor.revealPositionInCenter(editor.getPosition()!);
        editor.focus();
      }, call);
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport['decorationLayers'].get(
            'source-context:boolean-operation-regions',
          )?.length === 1,
      );
      const state = await page.evaluate(() => {
        const viewport = window.coordinateApp.viewport;
        const scope = viewport.sourceContext!;
        viewport.fit();
        return {
          tool: scope.target.tool?.signature.name,
          operation: viewport['module']!.operations.get(
            scope.evaluation.operationInput!.operationId,
          )!.kind,
          count:
            viewport['occurrences'].size + viewport['contextOccurrences'].size,
        };
      });
      assert.equal(state.tool, call.slice(0, call.indexOf('(')));
      assert.equal(state.operation, 'intersect');
      assert.equal(state.count, 2);
      await cameraIdle(page);
      if (process.env.CODE3D_INLINE_INTERSECT_SCREENSHOT)
        await page.screenshot({
          path: `${process.env.CODE3D_INLINE_INTERSECT_SCREENSHOT}-${state.tool}.png`,
        });
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'intersect arguments retain three inputs and recover their common result after an empty intersection',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    for (const offset of [8, 50, 4]) {
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box, intersect as common} from '@code3d/core';
const a = box(20, 20, 20);
const b = box(20, 20, 20).relate(s => [s.on(a.up), offset(${offset}, -10, 0)]);
const c = box(14, 14, 14).originOffset(-4, 0, 0);
export default common([a, b, c]);`;
      await page.evaluate(source => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.getModel()!.setValue(source);
        editor.setPosition(
          editor.getModel()!.getPositionAt(source.lastIndexOf('b, c') + 1),
        );
      }, source);
      await page.waitForFunction(offset => {
        const viewport = window.coordinateApp.viewport;
        return (
          viewport.getSelected()?.node.transformations?.at(-1)?.offsets.at(-1)!
            .value[0] === offset &&
          Boolean(viewport['module']?.diagnostic) === (offset === 50)
        );
      }, offset);
      const result = await page.evaluate(() => {
        const viewport = window.coordinateApp.viewport;
        viewport.fit();
        const owner = 'source-context:boolean-operation-regions';
        const count = viewport['decorationLayers'].get(owner)?.length ?? 0;
        viewport.setParameterPreview('test-preview', 1);
        const hidden = !viewport['decorationLayers'].has(owner);
        viewport.clearParameterPreview('test-preview');
        return {
          count,
          hidden,
          restored: viewport['decorationLayers'].get(owner)?.length ?? 0,
          inputs:
            viewport['occurrences'].size + viewport['contextOccurrences'].size,
          bindings: viewport['transformGizmo']['axes'].filter(
            axis => axis.binding,
          ).length,
          diagnostic: viewport['module']?.diagnostic?.summary,
        };
      });
      assert.equal(result.inputs, 3);
      assert.equal(result.bindings, 6);
      assert.equal(result.count, offset === 50 ? 0 : 1);
      assert.equal(result.restored, result.count);
      assert.equal(result.hidden, true);
      if (offset === 50)
        assert.match(result.diagnostic!, /no common solid volume/);
      await cameraIdle(page);
      if (process.env.CODE3D_INTERSECT_SCREENSHOT)
        await page.screenshot({
          path: `${process.env.CODE3D_INTERSECT_SCREENSHOT}-${offset}.png`,
        });
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'a failed compilation retains geometry but prevents dragging stale spatial bindings',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source =
      "import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box} from '@code3d/core';\nexport const part = box(24, 6, 14).originOffset(2, 3, 4);";
    await setSource(page, source, 'originOffset');
    const before = await state(page);
    const handle = await xHandle(page);
    const broken = source + '\nconst incomplete = ;';
    await page.evaluate(source => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.getModel()!.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.indexOf('originOffset') + 1),
      );
    }, broken);
    await page.locator('#viewport-status[data-state=error]').waitFor();
    assert.equal(
      await page.evaluate(() =>
        window.coordinateApp.viewport.positionTools['axes'].some(
          control => control.controls.getHelper().visible,
        ),
      ),
      false,
    );
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    const pressed = await state(page);
    await page.mouse.move(
      handle.x + handle.dx * 30,
      handle.y + handle.dy * 30,
      {steps: 4},
    );
    await page.mouse.up();
    assert.equal(pressed.active, false);
    const after = await state(page);
    assert.equal(after.source, broken);
    assert.equal(after.preview, undefined);
    assert.deepEqual(after.geometry, before.geometry);
    await setSource(page, source, 'originOffset');
    const recovered = await xHandle(page);
    await page.mouse.move(recovered.x, recovered.y);
    await page.mouse.down();
    assert.equal((await state(page)).active, true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal((await state(page)).source, source);
    assert.deepEqual(errors, []);
  },
);

test(
  'origin drags freeze their input frame, commit coordinates and support cancellation and undo',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source =
      "import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box} from '@code3d/core';\nexport const part = box(24, 6, 14).originOffset(2, 3, 4);";
    await setSource(page, source, 'originOffset');
    const before = await state(page);
    if (process.env.CODE3D_ORIGIN_LAYER_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_ORIGIN_LAYER_SCREENSHOT});
    await assertOriginForeground(page);
    assert.deepEqual(before.origin, [0, 0, 0]);
    assert.equal(before.bindings.length, 3);
    const handle = await xHandle(page);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.dx * 30,
      handle.y + handle.dy * 30,
      {steps: 4},
    );
    const first = await state(page);
    await assertOriginForeground(page);
    assert.ok(first.active, 'The visible X arrow must receive the pointer');
    assert.equal(first.source, source);
    assert.ok(first.preview && first.preview.spatial.origin[0] !== 0);
    assert.deepEqual(first.preview.transform.position, [0, 0, 0]);
    await page.mouse.move(
      handle.x + handle.dx * 60,
      handle.y + handle.dy * 60,
      {steps: 4},
    );
    const second = await state(page);
    assert.ok(
      second.preview &&
        Math.abs(second.preview.spatial.origin[0]) >
          Math.abs(first.preview.spatial.origin[0]),
    );
    assert.deepEqual(second.geometry, before.geometry);
    assert.equal(second.source, source);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const cancelled = await state(page);
    await assertOriginForeground(page);
    assert.equal(cancelled.source, source);
    assert.equal(cancelled.active, false);
    assert.equal(cancelled.preview, undefined);
    assert.deepEqual(cancelled.geometry, before.geometry);

    const retry = await xHandle(page);
    await page.mouse.move(retry.x, retry.y);
    await page.mouse.down();
    await page.mouse.move(retry.x + retry.dx * 45, retry.y + retry.dy * 45, {
      steps: 5,
    });
    const drag = await state(page);
    const delta = drag.preview!.spatial.origin[0];
    await page.mouse.up();
    await page.waitForFunction(
      original =>
        window.coordinateApp.codeEditor.editor.getValue() !== original,
      source,
    );
    await page.waitForFunction(expected => {
      const node = window.coordinateApp.viewport.getSelected()?.node;
      return (
        node?.mesh && Math.abs(node.mesh.topologyVertices[0] - expected) < 1e-5
      );
    }, before.geometry[0] - delta);
    const committed = await state(page);
    await assertOriginForeground(page);
    assert.deepEqual(committed.origin, [0, 0, 0]);
    committed.geometry.forEach((v, i) =>
      assert.ok(
        Math.abs(v - before.geometry[i] + (i % 3 === 0 ? delta : 0)) < 1e-5,
      ),
    );
    assert.ok(
      committed.bindings.every(binding =>
        binding.frame.position.every(v => Math.abs(v) < 1e-6),
      ),
    );
    await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      original =>
        window.coordinateApp.codeEditor.editor.getValue() === original,
      source,
    );
    await page.waitForFunction(
      first =>
        window.coordinateApp.viewport.getSelected()?.node.mesh
          ?.topologyVertices[0] === first,
      before.geometry[0],
    );

    const pivotSource =
      "import {offset, rotate, pivotVertex, pivotPoint, axisLine, axisEdge, pivot, box, point} from '@code3d/core';\nexport const part = box(24, 6, 14).relate(self => [self.center.align(point()), pivot([5, 0, 0]).rotate(0, 90, 0)]);";
    await setSource(page, pivotSource, 'pivot');
    await assertOriginForeground(page);
    assert.equal((await state(page)).bindings.length, 3);
    const input = page.locator('[data-parameter=x]');
    await input.fill('8');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      window.coordinateApp.codeEditor.editor
        .getValue()
        .includes('pivot([8, 0, 0])'),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    if (process.env.CODE3D_TEST_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_TEST_SCREENSHOT});
    assert.deepEqual(errors, []);
  },
);

test(
  'originVertex candidates stay on the rebased box through picking, previews and undo',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    for (const prefix of [
      '',
      '.originOffset(4, -2, 6).rotate(15, 35, 10).scaled(2)',
    ]) {
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box} from '@code3d/core';\nexport const part = box(24, 6, 14).material('#8ed5d1')${prefix}.originVertex(3);`;
      await setSource(page, source, 'originVertex');
      await waitVertexSelection(page, 3);
      const before = await vertexState(page);
      assertVertexAlignment(before);
      assert.ok(
        before.vertices
          .find(v => v.id === 3)!
          .actual.every(v => Math.abs(v) < 1e-5),
      );

      // Click the physical corner, independently of where the candidate was drawn.
      const corner = before.vertices.find(v => v.id === 6)!;
      assert.equal(corner.picked, 6);
      assert.equal(corner.gizmo, false);
      await page.mouse.move(corner.x, corner.y);
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport['topologySelection']?.hoveredId === 6,
      );
      await page.mouse.click(corner.x, corner.y);
      await waitVertexSelection(page, 6);
      const selected = await vertexState(page);
      assertVertexAlignment(selected);
      assert.match(selected.source, /originVertex\(6\)/);
      assert.ok(
        selected.vertices
          .find(v => v.id === 6)!
          .actual.every(v => Math.abs(v) < 1e-5),
      );
      if (!prefix && process.env.CODE3D_VERTEX_SCREENSHOT)
        await page.screenshot({path: process.env.CODE3D_VERTEX_SCREENSHOT});

      await page.evaluate(() => {
        const {viewport} = window.coordinateApp;
        viewport.setSpatialPreview([
          {
            key: viewport['topologySelection']!.occurrenceKey,
            nodeId: viewport.getSelected()!.node.nodeId,
            transform: {position: [7, 8, 9], quaternion: [0, 0, 0, 1]},
            spatial: {
              origin: [0, 0, 0],
              vector: [0, 0, 0],
              frame: {position: [0, 0, 0], quaternion: [0, 0, 0, 1]},
            },
          },
        ]);
      });
      const preview = await vertexState(page);
      assertVertexAlignment(preview);
      assert.ok(
        preview.vertices[0].actual.every(
          (v, axis) =>
            Math.abs(v - selected.vertices[0].actual[axis] - [7, 8, 9][axis]) <
            1e-5,
        ),
      );
      await page.evaluate(() => {
        const {viewport} = window.coordinateApp;
        viewport.clearSpatialPreview([...viewport['spatialPreviews'].values()]);
      });

      const handle = await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 40,
        handle.y + handle.dy * 40,
        {steps: 4},
      );
      assert.ok((await state(page)).active);
      assertVertexAlignment(await vertexState(page));
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await waitVertexSelection(page, 6);
      assertVertexAlignment(await vertexState(page));

      // Keep the viewport active while undoing the vertex edit.
      await page.keyboard.press('Control+z');
      await waitVertexSelection(page, 3);
      assertVertexAlignment(await vertexState(page));
      await page.keyboard.press('Control+Shift+z');
      await waitVertexSelection(page, 6);
      assertVertexAlignment(await vertexState(page));
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'group originPoint drags keep assembly geometry rigid and support cancellation, commit and undo',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box, group} from '@code3d/core';
const base = box(24, 6, 14).material('#8ed5d1');
const cap = box(8, 4, 8).material('#d9b478').relate(self => self.on(base.up));
export const assembly = group([base, cap]).originPoint(cap.center);`;
    await setSource(page, source, 'originPoint');
    const before = await groupState(page);
    assert.equal(before.origins.length, 2);
    assert.equal(before.geometry.length, 16);
    near(before.origins[0], [0, -5, 0]);
    near(before.origins[1], [0, 0, 0]);
    assert.equal(before.bindings, 3);
    await assertOriginForeground(page);
    if (process.env.CODE3D_GROUP_ORIGIN_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_GROUP_ORIGIN_SCREENSHOT});

    const drag = async () => {
      const handle = await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 40,
        handle.y + handle.dy * 40,
        {steps: 5},
      );
      const current = await groupState(page);
      assert.ok(
        current.active && current.delta && Math.abs(current.delta[0]) > 0.1,
      );
      assert.deepEqual(current.geometry, before.geometry);
      assert.equal(current.source, source);
      return current.delta[0];
    };
    await drag();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const cancelled = await groupState(page);
    assert.equal(cancelled.source, source);
    assert.deepEqual(cancelled.geometry, before.geometry);
    assert.equal(cancelled.active, false);

    const delta = await drag();
    await page.mouse.up();
    await page.waitForFunction(() =>
      window.coordinateApp.codeEditor.editor
        .getValue()
        .includes('.originPoint(cap.center).originOffset('),
    );
    await page.waitForFunction(delta => {
      const node = window.coordinateApp.viewport.getSelected()?.node;
      return (
        node?.kind === 'group' &&
        Math.abs(node.children[1].transform.position[0] + delta) < 1e-5
      );
    }, delta);
    const committed = await groupState(page);
    near(committed.origin, [0, 0, 0]);
    for (let i = 0; i < before.geometry.length; i++)
      near(
        committed.geometry[i],
        before.geometry[i].map((v, axis) => v - (axis === 0 ? delta : 0)),
      );
    near(
      committed.origins[1].map((v, i) => v - committed.origins[0][i]),
      [0, 5, 0],
    );
    await assertOriginForeground(page);
    await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      original =>
        window.coordinateApp.codeEditor.editor.getValue() === original,
      source,
    );
    await page.waitForFunction(
      () =>
        Math.abs(
          window.coordinateApp.viewport.getSelected()?.node.children[1]
            .transform.position[0] ?? Infinity,
        ) < 1e-5,
    );
    assert.deepEqual((await groupState(page)).geometry, before.geometry);
    assert.deepEqual(errors, []);
  },
);

function near(actual: readonly number[], expected: readonly number[]) {
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) < 1e-5, `${actual} != ${expected}`),
  );
}

for (const projection of ['perspective', 'orthographic'] as const)
  test(
    `group rotation rings support cancel, commit and undo in ${projection}`,
    {timeout: 120_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box, group} from '@code3d/core';
const base = box(24, 6, 14).material('#8ed5d1');
const cap = box(8, 4, 8).material('#d9b478').relate(self => self.on(base.up));
export const assembly = group([base, cap]).originPoint(cap.center).rotate(0, 0, 0);`;
      await setSource(page, source, 'rotate');
      if (projection === 'orthographic') {
        await page
          .getByRole('button', {name: 'View from +Z', exact: true})
          .press('Enter');
        await page.waitForFunction(
          () => !window.coordinateApp.viewport['controls']['transition'],
        );
      }
      const before = await groupState(page);
      assert.equal(before.bindings, 3);
      assert.equal(before.geometry.length, 16);
      const drag = async () => {
        const handle = await rotationHandle(page);
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(
          handle.x + handle.dx * 40,
          handle.y + handle.dy * 40,
          {steps: 5},
        );
        const preview = await groupState(page);
        assert.ok(preview.active);
        assert.equal(
          await page.evaluate(
            () =>
              window.coordinateApp.viewport['controls'].capturePose()
                .projection,
          ),
          projection,
          'Model rotation must not change camera projection',
        );
        assert.equal(preview.source, source);
        assert.ok(
          preview.geometry.some((point, i) =>
            point.some(
              (v, axis) => Math.abs(v - before.geometry[i][axis]) > 0.1,
            ),
          ),
        );
        // All corners, including corners from different members, keep their spacing.
        for (let i = 0; i < before.geometry.length; i++)
          for (let j = i + 1; j < before.geometry.length; j++)
            near(
              [
                Math.hypot(
                  ...preview.geometry[i].map(
                    (v, axis) => v - preview.geometry[j][axis],
                  ),
                ),
              ],
              [
                Math.hypot(
                  ...before.geometry[i].map(
                    (v, axis) => v - before.geometry[j][axis],
                  ),
                ),
              ],
            );
        return preview;
      };
      await drag();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      const cancelled = await groupState(page);
      assert.equal(cancelled.source, source);
      assert.deepEqual(cancelled.geometry, before.geometry);
      assert.equal(cancelled.active, false);
      const preview = await drag();
      await page.mouse.up();
      await page.waitForFunction(
        original =>
          window.coordinateApp.codeEditor.editor.getValue() !== original,
        source,
      );
      await page.waitForFunction(
        () =>
          Math.abs(
            window.coordinateApp.viewport.getSelected()?.node.children[0]
              .transform.position[0] ?? 0,
          ) > 0.1,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      const committed = await groupState(page);
      committed.geometry.forEach((point, i) =>
        near(point, preview.geometry[i]),
      );
      near(committed.origin, [0, 0, 0]);
      near(committed.origins[1], [0, 0, 0]);
      if (process.env.CODE3D_GROUP_ROTATION_SCREENSHOT)
        await page.screenshot({
          path: process.env.CODE3D_GROUP_ROTATION_SCREENSHOT,
        });
      await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        original =>
          window.coordinateApp.codeEditor.editor.getValue() === original,
        source,
      );
      await page.waitForFunction(
        () =>
          Math.abs(
            window.coordinateApp.viewport.getSelected()?.node.children[0]
              .transform.position[0] ?? Infinity,
          ) < 1e-5,
      );
      assert.deepEqual((await groupState(page)).geometry, before.geometry);
      assert.deepEqual(errors, []);
    },
  );

for (const grouped of [false, true])
  test(
    `default relate tools expose translation and rotation on a selected ${grouped ? 'group' : 'solid'}`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box, group} from '@code3d/core'; const base=box(30,8,25); const part=${grouped ? 'group([box(12,10,8)])' : 'box(12,10,8)'}.relate(self=>self.on(base.up)); export default group([base,part]);`;
      await page.evaluate(source => {
        const {codeEditor} = window.coordinateApp;
        const e = codeEditor.editor;
        e.getModel()!.setValue(source);
        e.setPosition(
          e.getModel()!.getPositionAt(source.lastIndexOf('part])') + 1),
        );
      }, source);
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport['transformGizmo']['axes'].filter(
            control => control.binding,
          ).length >= 6,
      );
      await page.evaluate(() => window.coordinateApp.viewport.fit());
      await cameraIdle(page);
      assert.deepEqual(
        await page.evaluate(() =>
          window.coordinateApp.viewport['transformGizmo']['axes']
            .filter(
              c =>
                !(
                  c.binding?.kind === 'spatial' &&
                  c.binding.spatial.source.kind === 'reference-offset'
                ),
            )
            .map(control => control.binding?.mode),
        ),
        ['translate', 'translate', 'translate', 'rotate', 'rotate', 'rotate'],
      );
      const visibleModes = () =>
        page.evaluate(() =>
          window.coordinateApp.viewport['transformGizmo']['axes']
            .filter(control => control.controls.getHelper().visible)
            .map(control => control.binding?.mode),
        );
      assert.deepEqual(await visibleModes(), []);
      await page.getByRole('button', {name: 'Translate', exact: true}).click();
      assert.deepEqual(await visibleModes(), [
        'translate',
        'translate',
        'translate',
      ]);
      await page.keyboard.down('Alt');
      assert.deepEqual(await visibleModes(), [
        'translate',
        'translate',
        'translate',
      ]);
      await page.keyboard.up('Alt');
      assert.deepEqual(await visibleModes(), [
        'translate',
        'translate',
        'translate',
      ]);
      const drag = async () => {
        await page
          .getByRole('button', {name: 'Rotate about point', exact: true})
          .click();
        const handle = await rotationHandle(page, 2);
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        assert.deepEqual(await visibleModes(), ['rotate', 'rotate', 'rotate']);
        await page.mouse.move(
          handle.x + handle.dx * 35,
          handle.y + handle.dy * 35,
          {steps: 5},
        );
      };
      await drag();
      const readout = page.locator('.tool-drag-preview');
      assert.equal(await readout.isVisible(), true);
      assert.equal(
        await page.locator('.contextual-tool-panel').isVisible(),
        false,
      );
      assert.ok(
        (await readout.boundingBox())!.y >
          (await page.locator('.spatial-toolbar').boundingBox())!.y,
      );
      assert.equal(
        await page.evaluate(
          () => window.coordinateApp.viewport.dragPreview?.values[0].start,
        ),
        0,
      );

      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.deepEqual(await visibleModes(), ['rotate', 'rotate', 'rotate']);
      assert.equal(
        await page.evaluate(() =>
          window.coordinateApp.codeEditor.editor.getValue(),
        ),
        source,
      );
      await drag();
      await page.mouse.up();
      await page.waitForFunction(() =>
        /\brotate\(/.test(window.coordinateApp.codeEditor.editor.getValue()),
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      assert.match(
        await page.evaluate(() =>
          window.coordinateApp.codeEditor.editor.getValue(),
        ),
        /self\.on\(base\.up\),\s*rotate\(0, 0, -?[\d.]+\)/,
      );
      for (const [mode, rotations, offsets] of [
        ['translate', 1, 1],
        ['rotate', 2, 1],
        ['translate', 2, 2],
      ] as const) {
        const before = await page.evaluate(() =>
          window.coordinateApp.codeEditor.editor.getValue(),
        );
        if (mode === 'rotate') await drag();
        else {
          await page
            .getByRole('button', {name: 'Translate', exact: true})
            .click();
          const handle = await xHandle(page);
          await page.mouse.move(handle.x, handle.y);
          await page.mouse.down();
          await page.mouse.move(
            handle.x + handle.dx * 30,
            handle.y + handle.dy * 30,
            {steps: 5},
          );
        }
        await page.mouse.up();
        await page.waitForFunction(
          before =>
            window.coordinateApp.codeEditor.editor.getValue() !== before,
          before,
        );
        await page.getByText('Ready', {exact: true}).waitFor();
        const current = await page.evaluate(() =>
          window.coordinateApp.codeEditor.editor.getValue(),
        );
        assert.equal((current.match(/\brotate\(/g) ?? []).length, rotations);
        assert.equal((current.match(/\boffset\(/g) ?? []).length, offsets);
      }
      if (process.env.CODE3D_RELATE_ROTATE_SCREENSHOT)
        await page.screenshot({
          path: process.env.CODE3D_RELATE_ROTATE_SCREENSHOT,
        });
      await page.evaluate(() => {
        const e = window.coordinateApp.codeEditor.editor;
        e.focus();
        for (let i = 0; i < 4; i++) e.trigger('test', 'undo', null);
      });
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      assert.deepEqual(errors, []);
    },
  );

test(
  'pivot rotations survive material derivation and edit the selected Boolean composition member',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {rotate, pivotVertex, pivotPoint, axisLine, axisEdge, offset, pivot, box, cut, cylinder, group, intersect, sphere, union} from '@code3d/core';
const accent = '#d8ff3e';
const neutral = '#30352f';
const stockHeight = 8;
const bossHeight = 6;
const stock = box(30, stockHeight, 20).material(neutral);
const bore = cylinder(3, 12);
const drilled = cut(stock, [bore]).material(neutral);
const boss = cylinder(5, bossHeight)
  .originOffset(-7, -(stockHeight + bossHeight) / 2, 0)
  .material(accent);
const joined = union([drilled, boss]).material(neutral);
const lens = intersect([sphere(8), box(12, 12, 12)])
  .relate(part => [part.on(joined.right), offset(0, 1, 3), pivot([-10, 0, 0]).rotate(0, 0, -31)])
  .material(accent);
export const booleanOperationsExample = group([joined, lens], 'Boolean operations');`;
    await page.evaluate(source => {
      const e = window.coordinateApp.codeEditor.editor;
      e.getModel()!.setValue(source);
      e.setPosition(
        e.getModel()!.getPositionAt(source.lastIndexOf('lens]') + 1),
      );
    }, source);
    await page.waitForFunction(
      () =>
        window.coordinateApp.viewport['transformGizmo']['axes'].filter(
          c => c.binding,
        ).length >= 6,
    );
    await page.evaluate(() => window.coordinateApp.viewport.fit());
    await cameraIdle(page);
    assert.equal(
      await page
        .locator('.spatial-toolbar button[aria-pressed="true"]')
        .count(),
      0,
    );
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    await assertTranslationOrigin(page);
    await page
      .getByRole('button', {name: 'Rotate about point', exact: true})
      .click();
    assert.deepEqual(
      await page.evaluate(() =>
        window.coordinateApp.viewport['transformGizmo']['axes']
          .filter(c => c.controls.getHelper().visible)
          .map(c => c.binding?.mode),
      ),
      ['rotate', 'rotate', 'rotate'],
    );
    const pivot = await page.evaluate(() => {
      const viewport = window.coordinateApp.viewport;
      const selected = viewport.getSelected()!;
      const marker = viewport['decorationLayers']
        .get('source-context:model-origin')
        ?.find(instance => instance.occurrenceKey === selected.key)?.anchor;
      const control = viewport['transformGizmo']['axes'].find(
        c => c.binding?.mode === 'rotate',
      )!;
      if (!marker) return undefined;
      marker.updateWorldMatrix(true, false);
      return {
        visible: marker.visible && marker.parent!.visible,
        distance: marker
          .getWorldPosition(control.proxy.position.clone())
          .distanceTo(control.proxy.position),
      };
    });
    assert.ok(pivot, 'Selected composition member displays its pivot');
    assert.equal(pivot.visible, true);
    assert.ok(pivot.distance < 1e-6, JSON.stringify(pivot));
    await focusSource(page, 'offset(0, 1, 3)', 6);
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    await assertTranslationOrigin(page);
    await assertOriginForeground(page);
    const offsetHandle = await xHandle(page);
    await page.mouse.move(offsetHandle.x, offsetHandle.y);
    await page.mouse.down();
    await page.mouse.move(
      offsetHandle.x + offsetHandle.dx * 35,
      offsetHandle.y + offsetHandle.dy * 35,
      {steps: 5},
    );
    assert.equal((await state(page)).active, true);
    await assertTranslationOrigin(page);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await assertTranslationOrigin(page);
    assert.equal((await state(page)).source, source);
    await page.screenshot({path: '/tmp/code3d-offset-origin.png'});
    await page
      .getByRole('button', {name: 'Rotate about point', exact: true})
      .click();
    if (process.env.CODE3D_RELATE_ROTATE_SCREENSHOT) {
      await page.screenshot({
        path: process.env.CODE3D_RELATE_ROTATE_SCREENSHOT,
      });
    }
    const handle = await rotationHandle(page, 2);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.dx * 35,
      handle.y + handle.dy * 35,
      {steps: 5},
    );
    await page.mouse.up();
    await page.waitForFunction(
      source => window.coordinateApp.codeEditor.editor.getValue() !== source,
      source,
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    const changed = await page.evaluate(() =>
      window.coordinateApp.codeEditor.editor.getValue(),
    );
    assert.equal((changed.match(/\brotate\(/g) ?? []).length, 1);
    assert.ok(changed.includes('pivot([-10, 0, 0])'));
    assert.ok(changed.includes('.material(accent)'));
    await page.evaluate(() => {
      const e = window.coordinateApp.codeEditor.editor;
      e.setPosition(
        e.getModel()!.getPositionAt(e.getValue().indexOf('.rotate(') + 2),
      );
    });
    await page.waitForFunction(() =>
      window.coordinateApp.viewport['transformGizmo']['axes']
        .filter(c => c.controls.getHelper().visible)
        .every(c => c.binding?.mode === 'rotate'),
    );
    await cameraIdle(page);
    await rotationHandle(page, 2);
    assert.deepEqual(errors, []);
  },
);

async function rotationHandle(page: Page, axisIndex = 2) {
  return page.evaluate(axisIndex => {
    const viewport = window.coordinateApp.viewport;
    const gizmo = viewport['transformGizmo'];
    const control = gizmo['axes'].find(
      control =>
        control.binding?.mode === 'rotate' &&
        control.binding.axis === ['x', 'y', 'z'][axisIndex] &&
        control.controls.getHelper().visible,
    )!;
    const camera = viewport['camera'];
    const rect = viewport['renderer'].domElement.getBoundingClientRect();
    control.controls.getHelper().updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const center = control.proxy.position.clone().project(camera);
    for (const object of control.gizmo.gizmo.rotate.children) {
      if (!object.visible || object.name !== ['X', 'Y', 'Z'][axisIndex])
        continue;
      const positions = (object as import('three').Mesh).geometry.getAttribute(
        'position',
      );
      for (let i = 0; i < positions.count; i++) {
        const projected = control.proxy.position
          .clone()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(object.matrixWorld)
          .project(camera);
        const x = rect.left + ((projected.x + 1) * rect.width) / 2;
        const y = rect.top + ((1 - projected.y) * rect.height) / 2;
        if (
          gizmo['pickAxis'](
            new PointerEvent('pointermove', {clientX: x, clientY: y}),
          ) !== control
        )
          continue;
        // An oblique axis ring responds along axis × view direction.
        // A screen-space tangent at its silhouette can instead snap to zero.
        const direction = control.proxy.position
          .clone()
          .set(0, 0, 0)
          .setComponent(axisIndex, 1)
          .applyQuaternion(control.proxy.quaternion)
          .cross(
            camera.position.clone().sub(control.proxy.position).normalize(),
          )
          .normalize()
          .add(control.proxy.position)
          .project(camera)
          .sub(center);
        const dx = direction.x * rect.width;
        const dy = -direction.y * rect.height;
        const length = Math.hypot(dx, dy);
        if (length > 0) return {x, y, dx: dx / length, dy: dy / length};
      }
    }
    throw new Error('No visible rotation ring pick point');
  }, axisIndex);
}

async function groupState(page: Page) {
  return page.evaluate(() => {
    const {viewport, codeEditor} = window.coordinateApp;
    const selected = viewport.getSelected()!;
    const children = [...viewport['occurrences'].values()].filter(
      occurrence =>
        selected.node.children.some(
          child => child.nodeId === occurrence.node.nodeId,
        ) && occurrence.key.startsWith(selected.key + '/'),
    );
    const geometry = children.flatMap(occurrence => {
      occurrence.object.updateWorldMatrix(true, false);
      const vertices = occurrence.node.mesh!.topologyVertices;
      return Array.from({length: vertices.length / 3}, (_, i) =>
        occurrence.object.position
          .clone()
          .fromArray(vertices, i * 3)
          .applyMatrix4(occurrence.object.matrixWorld)
          .toArray(),
      );
    });
    const preview = [...viewport['spatialPreviews'].values()][0];
    return {
      source: codeEditor.editor.getValue(),
      origin: selected.node.origin,
      origins: selected.node.children.map(child => child.transform.position),
      geometry,
      bindings: viewport['transformGizmo']['axes'].filter(axis => axis.binding)
        .length,
      active: Boolean(viewport['transformGizmo']['active']),
      delta: preview?.spatial.origin,
    };
  });
}

async function waitVertexSelection(page: Page, id: number) {
  await page
    .waitForFunction(id => {
      const {viewport} = window.coordinateApp;
      const scope = viewport.sourceContext;
      return (
        scope?.target.tool?.signature.name === 'originVertex' &&
        scope.evaluation.selection?.ids[0] === id &&
        viewport['topologySelection']?.selectedIds.has(id)
      );
    }, id)
    .catch(async error => {
      const actual = await page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        const scope = viewport.sourceContext;
        return {
          source: codeEditor.editor.getValue(),
          method: scope?.target.tool?.signature.name,
          selection: scope?.evaluation.selection,
          selectedIds: [...(viewport['topologySelection']?.selectedIds ?? [])],
          active: Boolean(viewport['transformGizmo']['active']),
        };
      });
      throw new Error(
        `Waiting for originVertex(${id}): ${JSON.stringify(actual)}`,
        {cause: error},
      );
    });
  await page.getByText('Ready', {exact: true}).waitFor();
}

async function vertexState(page: Page) {
  await cameraIdle(page);
  return page.evaluate(() => {
    const {viewport, codeEditor} = window.coordinateApp;
    const selection = viewport['topologySelection']!;
    const occurrence = viewport['occurrences'].get(selection.occurrenceKey)!;
    const camera = viewport['camera'];
    const rect = viewport['renderer'].domElement.getBoundingClientRect();
    occurrence.object.updateWorldMatrix(true, true);
    selection.guide.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    const output = occurrence.node.mesh!;
    return {
      source: codeEditor.editor.getValue(),
      origin: occurrence.node.origin,
      vertices: selection.mesh.vertexIds.map((id, i) => {
        const candidate = selection.guide.position
          .clone()
          .fromArray(selection.mesh.topologyVertices, i * 3)
          .applyMatrix4(selection.guide.matrixWorld);
        const actual = candidate
          .clone()
          .fromArray(output.topologyVertices, output.vertexIds.indexOf(id) * 3)
          .applyMatrix4(occurrence.object.matrixWorld);
        const projected = actual.clone().project(camera);
        const x = rect.left + ((projected.x + 1) * rect.width) / 2;
        const y = rect.top + ((1 - projected.y) * rect.height) / 2;
        const event = new PointerEvent('pointermove', {clientX: x, clientY: y});
        return {
          id,
          candidate: candidate.toArray(),
          actual: actual.toArray(),
          x,
          y,
          clickable:
            viewport['renderer'].domElement === document.elementFromPoint(x, y),
          picked: viewport['pickTopology'](event),
          gizmo: Boolean(viewport['transformGizmo']['pickAxis'](event)),
        };
      }),
    };
  });
}

function assertVertexAlignment(value: Awaited<ReturnType<typeof vertexState>>) {
  assert.deepEqual(value.origin, [0, 0, 0]);
  assert.equal(value.vertices.length, 8);
  for (const vertex of value.vertices) {
    assert.ok(
      vertex.candidate.every(
        (v, axis) => Math.abs(v - vertex.actual[axis]) < 1e-5,
      ),
      `V${vertex.id}: candidate ${vertex.candidate} must match physical corner ${vertex.actual}`,
    );
  }
}

async function sourceMarks(page: Page) {
  return page.evaluate(() => {
    const editor = window.coordinateApp.codeEditor.editor;
    const model = editor.getModel()!;
    const marks = model.getAllDecorations();
    return {
      tool: marks
        .filter(
          mark =>
            mark.options.inlineClassName === 'code3d-active-tool-source-inline',
        )
        .map(mark => model.getValueInRange(mark.range)),
      word: marks
        .filter(mark => mark.options.inlineClassName === 'code3d-context-word')
        .map(mark => model.getValueInRange(mark.range)),
      caret: marks
        .filter(
          mark =>
            mark.options.beforeContentClassName === 'code3d-context-caret',
        )
        .map(mark => model.getOffsetAt(mark.range.getStartPosition())),
      selection: editor.getSelection(),
      focused: editor.hasTextFocus(),
    };
  });
}

async function focusSource(page: Page, text: string, delta = 1) {
  await page.evaluate(
    ({text, delta}) => {
      const editor = window.coordinateApp.codeEditor.editor;
      const offset = editor.getValue().indexOf(text);
      if (offset < 0) throw new Error(`Missing ${text}`);
      editor.setPosition(editor.getModel()!.getPositionAt(offset + delta));
      editor.focus();
    },
    {text, delta},
  );
}

async function assertMarkedSourceVisible(page: Page) {
  await page.waitForFunction(() => {
    const editor = window.coordinateApp.codeEditor.editor;
    const model = editor.getModel()!;
    const mark = model
      .getAllDecorations()
      .find(
        mark =>
          mark.options.inlineClassName === 'code3d-active-tool-source-inline',
      );
    if (!mark) return false;
    const position = editor.getScrolledVisiblePosition(
      mark.range.getEndPosition(),
    );
    const layout = editor.getLayoutInfo();
    return (
      !!position &&
      position.left >= layout.contentLeft &&
      position.left < layout.width - layout.verticalScrollbarWidth &&
      position.top >= 0 &&
      position.top + position.height <= layout.height
    );
  });
}

async function setSource(page: Page, source: string, method: string) {
  await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source);
  await page.evaluate(method => {
    const editor = window.coordinateApp.codeEditor.editor;
    const offset = editor.getValue().indexOf(`${method}(`);
    if (offset < 0) throw new Error(`Missing source call: ${method}`);
    editor.setPosition(editor.getModel()!.getPositionAt(offset + 2));
  }, method);
  await page.waitForFunction(method => {
    const target = window.coordinateApp.viewport.sourceContext?.target;
    const expected =
      [
        'pivot',
        'pivotVertex',
        'pivotOffset',
        'axisOffset',
        'axisLine',
      ].includes(method) && target?.rotationSelectorIds
        ? 'rotate'
        : method;
    return (
      (target?.tool?.signature.name ?? target?.operation?.kind) === expected
    );
  }, method);
  await page.getByText('Ready', {exact: true}).waitFor();
  // Scene memory intentionally retains zoom across geometry edits. These
  // picking tests need every corner inside the canvas, including scaled inputs.
  await page.evaluate(() => window.coordinateApp.viewport.fit());
}

async function state(page: Page) {
  return page.evaluate(() => {
    const {viewport, codeEditor} = window.coordinateApp;
    const node = viewport.getSelected()!.node;
    return {
      source: codeEditor.editor.getValue(),
      origin: node.origin,
      geometry: [...(node.mesh?.topologyVertices ?? [])],
      active: Boolean(viewport['transformGizmo']['active']),
      preview: [...viewport['spatialPreviews'].values()][0],
      bindings: viewport['transformGizmo']['axes'].flatMap(axis =>
        axis.binding ? [axis.binding] : [],
      ),
    };
  });
}

async function selectAxisEdge(page: Page) {
  const candidate = await page.evaluate(() => {
    const viewport = window.coordinateApp.viewport;
    const selection = viewport['topologySelection']!;
    const canvas = viewport['renderer'].domElement;
    const rect = canvas.getBoundingClientRect();
    selection.guide.updateWorldMatrix(true, false);
    for (const group of selection.mesh.edgeGroups) {
      const point = selection.guide.position
        .clone()
        .fromArray(selection.mesh.edges, group.start * 3);
      const end = point
        .clone()
        .fromArray(selection.mesh.edges, (group.start + 1) * 3);
      point
        .add(end)
        .multiplyScalar(0.5)
        .applyMatrix4(selection.guide.matrixWorld)
        .project(viewport['camera']);
      const event = {
        clientX: rect.left + ((point.x + 1) * rect.width) / 2,
        clientY: rect.top + ((1 - point.y) * rect.height) / 2,
      };
      if (
        document.elementFromPoint(event.clientX, event.clientY) !== canvas ||
        viewport.positionTools['pickAxis'](
          new PointerEvent('pointermove', event),
        )
      )
        continue;
      const picked = viewport['pickTopology'](event);
      if (JSON.stringify(picked) === JSON.stringify(group.edgeId))
        return {...event, id: group.edgeId};
    }
    return undefined;
  });
  assert.ok(candidate, 'A selectable straight edge must be visible');
  await page.mouse.click(candidate.clientX, candidate.clientY);
  return candidate.id;
}

async function spatialMarkers(page: Page) {
  return page.evaluate(() => {
    const viewport = window.coordinateApp.viewport;
    const selected = viewport.getSelected()!;
    return [...viewport['decorationLayers']].flatMap(([owner, instances]) =>
      instances.flatMap(instance => {
        if (instance.occurrenceKey !== selected.key || !instance.anchor)
          return [];
        if (
          owner !== 'source-context:model-origin' &&
          owner !== 'spatial-preview'
        )
          return [];
        const marker = instance.anchor;
        return [
          {
            owner,
            decoration: marker.userData.decoration,
            position: marker
              .getWorldPosition(marker.position.clone())
              .toArray(),
          },
        ];
      }),
    );
  });
}

async function assertTranslationOrigin(page: Page) {
  const markers = await page.evaluate(() => {
    const viewport = window.coordinateApp.viewport;
    const selected = viewport.getSelected()!;
    selected.object.updateWorldMatrix(true, true);
    const origin = selected.object.localToWorld(
      selected.object.position.clone().fromArray(selected.node.origin),
    );
    return ['source-context:model-origin', 'spatial-preview'].flatMap(owner =>
      (viewport['decorationLayers'].get(owner) ?? []).flatMap(instance => {
        if (instance.occurrenceKey !== selected.key || !instance.anchor)
          return [];
        const marker = instance.anchor;
        marker.updateWorldMatrix(true, false);
        return [
          {
            owner,
            kind: marker.userData.decoration.elementKind,
            visible: marker.visible && marker.parent!.visible,
            distance: marker
              .getWorldPosition(origin.clone())
              .distanceTo(origin),
          },
        ];
      }),
    );
  });
  assert.equal(markers.length, 1, JSON.stringify(markers));
  assert.equal(markers[0].kind, 'point');
  assert.equal(markers[0].visible, true);
  assert.ok(markers[0].distance < 1e-6, JSON.stringify(markers));
}

async function assertOriginForeground(page: Page) {
  const draws = await page.evaluate(() => {
    const viewport = window.coordinateApp.viewport;
    const draws: string[] = [];
    const restore: (() => void)[] = [];
    const observe = (root: import('three').Object3D, layer: string) => {
      root.traverse(object => {
        if (!('material' in object)) return;
        const original = object.onAfterRender;
        object.onAfterRender = function (...args) {
          original.apply(this, args);
          draws.push(layer);
        };
        restore.push(() => (object.onAfterRender = original));
      });
    };
    for (const instances of viewport['decorationLayers'].values()) {
      for (const {anchor} of instances) {
        if (anchor?.userData.decoration.layer === 'foreground')
          observe(anchor, 'origin');
      }
    }
    for (const axis of viewport['transformGizmo']['axes'])
      observe(axis.controls.getHelper(), 'gizmo');
    try {
      viewport['rendering'].renderFrame();
    } finally {
      restore.forEach(callback => callback());
    }
    return draws;
  });
  assert.ok(draws.includes('origin') && draws.includes('gizmo'));
  assert.ok(
    draws.indexOf('origin') > draws.lastIndexOf('gizmo'),
    `Every origin glyph must draw above the gizmo: ${draws.join(', ')}`,
  );
}

async function cameraIdle(page: Page) {
  await page.waitForFunction(() => {
    const controls = window.coordinateApp.viewport['controls'];
    return !controls['transition'] && controls['_animationId'] === -1;
  });
}

async function xHandle(page: Page) {
  await cameraIdle(page);
  return page.evaluate(() => {
    const viewport = window.coordinateApp.viewport;
    const gizmo = viewport['transformGizmo'];
    const control = gizmo['axes'].find(
      control =>
        control.binding?.mode === 'translate' &&
        control.binding.axis === 'x' &&
        control.controls.getHelper().visible,
    )!;
    const camera = viewport['camera'];
    const rect = viewport['renderer'].domElement.getBoundingClientRect();
    control.controls.getHelper().updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const origin = control.proxy.position.clone().project(camera);
    const direction = control.proxy.position
      .clone()
      .set(1, 0, 0)
      .applyQuaternion(control.proxy.quaternion)
      .add(control.proxy.position)
      .project(camera)
      .sub(origin);
    const length = Math.hypot(
      direction.x * rect.width,
      direction.y * rect.height,
    );
    const candidates = control.gizmo.picker.translate.children.filter(
      object => object.name === 'X' && object.visible,
    );
    for (const object of candidates) {
      const mesh = object as import('three').Mesh;
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox!.getCenter(
        control.proxy.position.clone(),
      );
      center.applyMatrix4(object.matrixWorld).project(camera);
      const x = rect.left + ((center.x + 1) * rect.width) / 2;
      const y = rect.top + ((1 - center.y) * rect.height) / 2;
      if (
        gizmo['pickAxis'](
          new PointerEvent('pointermove', {clientX: x, clientY: y}),
        ) === control
      )
        return {
          x,
          y,
          dx: (direction.x * rect.width) / length,
          dy: (-direction.y * rect.height) / length,
        };
    }
    throw new Error('No visible X handle pick point');
  });
}

async function openApp(t: TestContext) {
  assert.ok(process.env.CODE3D_TEST_URL);
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (/\[MobX\]/i.test(message.text())) errors.push(message.text());
  });
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.coordinateApp = {viewport, codeEditor, compiler, previewState, runModel, selectCompiledEvaluationContext};\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL!, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page
    .getByText('Ready', {exact: true})
    .waitFor({timeout: 60_000})
    .catch(async error => {
      console.error(await page.locator('body').innerText(), errors);
      throw error;
    });
  return {page, errors};
}

for (const [selection, mode] of [
  ['self', 'translate'],
  ['self', 'rotate'],
  ['offset', 'rotate'],
  ['rotate', 'translate'],
] as const) {
  test(
    `ordered transformation gizmo ${selection} / ${mode} matches commit and Undo`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {pivot, pivotVertex, pivotPoint, axisLine, axisEdge, offset, rotate, box,group} from '@code3d/core'; const base=box(40,10,30); const part=box(24,16,14).relate(self=>[self.on(base.up), offset(3,2,1), rotate(10,20,30), offset(5,0,2), rotate(20,10,5)]); group([base,part]);`;
      await setSource(
        page,
        source,
        selection === 'self' ? 'offset' : selection,
      );
      if (selection === 'self') {
        await page.evaluate(() => {
          const editor = window.coordinateApp.codeEditor.editor;
          editor.setPosition(
            editor
              .getModel()!
              .getPositionAt(editor.getValue().indexOf('self.on') + 1),
          );
        });
        await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
        assert.equal(
          await page
            .locator('.spatial-toolbar button[aria-pressed="true"]')
            .count(),
          0,
        );
      }
      await cameraIdle(page);
      const matrix = () =>
        page.evaluate(() => {
          const object = window.coordinateApp.viewport.getSelected()!.object;
          object.updateWorldMatrix(true, false);
          return object.matrixWorld.toArray();
        });
      await page
        .getByRole('button', {
          name: mode === 'rotate' ? 'Rotate about point' : 'Translate',
          exact: true,
        })
        .click();
      const before = await matrix();
      const handle =
        mode === 'rotate' ? await rotationHandle(page, 0) : await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 40,
        handle.y + handle.dy * 40,
        {steps: 5},
      );
      const preview = await matrix();
      assert.ok(
        preview.some((value, index) => Math.abs(value - before[index]) > 1e-4),
      );
      assert.equal((await state(page)).source, source);
      await page.mouse.up();
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() !== source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      await cameraIdle(page);
      const committed = await matrix();
      assert.ok(
        committed.every(
          (value, index) => Math.abs(value - preview[index]) < 1e-5,
        ),
        `preview ${preview} != committed ${committed}`,
      );
      const changed = (await state(page)).source;
      assert.equal((changed.match(/\boffset\(/g) ?? []).length, 2);
      assert.equal(
        (changed.match(/\brotate\(/g) ?? []).length,
        selection === 'self' && mode === 'rotate' ? 3 : 2,
      );
      if (selection === 'self' && mode === 'rotate')
        assert.match(
          changed,
          /\.on\(base\.up\),\s*rotate\([^)]+\),\s*offset\(3,2,1\), rotate\(10,20,30\)/,
        );
      else if (selection === 'rotate')
        assert.match(
          changed,
          /offset\(3,2,1\), rotate\(10,20,30\), offset\([^)]+\), rotate\(20,10,5\)/,
        );
      else assert.ok(changed.includes('offset(5,0,2), rotate(20,10,5)'));
      await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      assert.deepEqual(errors, []);
    },
  );
}

for (const [selected, mode] of [
  ['self', 'translate'],
  ['self', 'rotate'],
  ['offset', 'rotate'],
  ['rotate', 'translate'],
] as const) {
  test(
    `independent loop gizmo ${selected} / ${mode} previews every instance and commits one undoable source edit`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const extras =
        selected === 'self'
          ? ''
          : selected === 'offset'
            ? ',offset(2,3,4),rotate(10,20,30)'
            : ',rotate(10,20,30),offset(2,3,4)';
      const source = `import {box,group${selected === 'self' ? '' : ',offset,rotate'}} from '@code3d/core';
const holes=[[-20,-20],[20,-20],[-20,20],[20,20]].map(([x,z])=>box(24,6,24).originOffset(-x,0,-z));
const parts=holes.map(hole=>box(14,12,10).relate(part=>[part.axis.align(hole.axis),part.on(hole.up)${extras}]));
group([...holes,...parts]);`;
      await setSource(page, source, 'originOffset');
      await page.evaluate(selected => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(
              editor
                .getValue()
                .indexOf(
                  selected === 'self'
                    ? 'part.axis'
                    : selected === 'offset'
                      ? 'offset(2,3,4)'
                      : 'rotate(10,20,30)',
                ) + 2,
            ),
        );
      }, selected);
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport.positionTools.currentBindings.length >=
          6,
      );
      await cameraIdle(page);
      const matrices = () =>
        page.evaluate(() =>
          window.coordinateApp.viewport['renderedOccurrences']()
            .filter(value => value.node.constraints.length === 2)
            .map(value => {
              value.object.updateWorldMatrix(true, false);
              return value.object.matrixWorld.toArray();
            }),
        );
      const selectedBefore = await matrices();
      if (selected === 'offset') {
        for (const matrix of selectedBefore)
          assert.deepEqual(
            matrix.slice(0, 12),
            [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
            'Every loop instance shows the selected offset before the later rotation',
          );
      }
      assert.equal(selectedBefore.length, 4);
      await page
        .getByRole('button', {
          name: mode === 'rotate' ? 'Rotate about point' : 'Translate',
          exact: true,
        })
        .click();
      const before = await matrices();
      const handle =
        mode === 'rotate' ? await rotationHandle(page, 0) : await xHandle(page);
      const drag = async () => {
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(
          handle.x + handle.dx * 35,
          handle.y + handle.dy * 35,
          {steps: 5},
        );
      };
      await drag();
      const preview = await matrices();
      assert.ok(
        preview.every((matrix, i) =>
          matrix.some((value, j) => Math.abs(value - before[i][j]) > 1e-5),
        ),
      );
      assert.equal((await state(page)).source, source);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal((await state(page)).source, source);
      (await matrices()).forEach((matrix, i) =>
        assert.ok(
          matrix.every((value, j) => Math.abs(value - before[i][j]) < 1e-5),
        ),
      );
      await drag();
      const committedPreview = await matrices();
      await page.mouse.up();
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() !== source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      await cameraIdle(page);
      const changed = (await state(page)).source;
      assert.match(
        changed,
        selected === 'offset'
          ? /offset\(2,3,4\),\s*rotate\(/
          : selected === 'rotate'
            ? /rotate\(10,20,30\),\s*offset\(/
            : mode === 'rotate'
              ? /part\.on\(hole\.up\), rotate\(/
              : /part\.on\(hole\.up\), offset\(/,
      );
      const after = await matrices();
      assert.equal(after.length, 4);
      after.forEach((matrix, i) =>
        assert.ok(
          matrix.every(
            (value, j) => Math.abs(value - committedPreview[i][j]) < 1e-5,
          ),
          `${matrix} != ${committedPreview[i]}`,
        ),
      );
      await page.screenshot({
        path: `/tmp/code3d-independent-${selected}-${mode}.png`,
      });
      await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      assert.deepEqual(errors, []);
    },
  );
}

test(
  'rotation toolbar keeps reference movement separate and commits a pivot offset',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {offset, rotate, pivot, pivotPoint, axisLine, axisEdge, box, group, pivotVertex} from '@code3d/core';
const base=box(40,8,30); const part=box(24,16,14).relate(self=>[self.on(base.up),pivotVertex(1).rotate(10,20,30)]); group([base,part]);`;
    await setSource(page, source, 'rotate');
    await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
    await page
      .getByRole('button', {name: 'Rotate about point', exact: true})
      .click();
    await cameraIdle(page);
    await page.keyboard.down('Alt');
    const handle = await xHandle(page);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.dx * 40,
      handle.y + handle.dy * 40,
      {steps: 5},
    );
    assert.equal((await state(page)).source, source);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForFunction(() =>
      window.coordinateApp.codeEditor.editor
        .getValue()
        .includes('.pivotOffset('),
    );
    await page
      .getByText('Ready', {exact: true})
      .waitFor()
      .catch(async error => {
        console.error(
          await page.locator('body').innerText(),
          errors,
          await state(page),
        );
        throw error;
      });
    assert.match(
      (await state(page)).source,
      /pivotVertex\(1\)\.pivotOffset\([^)]*\)\.rotate\(10,20,30\)/,
    );
    await page.waitForFunction(
      () => !!window.coordinateApp.viewport['topologySelection'],
    );
    assert.ok(
      await page.evaluate(
        () => !!window.coordinateApp.viewport['topologySelection'],
      ),
    );
    await page.keyboard.up('Alt');
    assert.equal(
      await page.evaluate(
        () => !!window.coordinateApp.viewport['topologySelection'],
      ),
      true,
    );
    const candidate = (await vertexState(page)).vertices.find(
      vertex => vertex.id !== 1 && vertex.id === vertex.picked,
    )!;
    assert.ok(candidate);
    await page.mouse.click(candidate.x, candidate.y);
    await page.keyboard.up('Alt');
    await page.getByText('Ready', {exact: true}).waitFor();
    await page.waitForFunction(
      id =>
        window.coordinateApp.codeEditor.editor
          .getValue()
          .includes(`pivotVertex(${JSON.stringify(id)})`),
      candidate.id,
    );
    assert.equal(
      await page.evaluate(
        () => !!window.coordinateApp.viewport['topologySelection'],
      ),
      true,
    );
    const beforeAxis = (await state(page)).source;
    await page
      .getByRole('button', {name: 'Rotation tools', exact: true})
      .click();
    await page
      .getByRole('menuitemradio', {name: 'Rotate about axis', exact: true})
      .click();
    assert.equal((await state(page)).source, beforeAxis);
    const edge = await selectAxisEdge(page);
    await page.waitForFunction(
      id =>
        window.coordinateApp.codeEditor.editor
          .getValue()
          .includes(`axisEdge(${JSON.stringify(id)}).rotate(0)`),
      edge,
    );
    const withAxis = (await state(page)).source;
    assert.ok(
      withAxis.includes(
        beforeAxis.match(
          /pivotVertex\([^)]*\)\.pivotOffset\([^)]*\)\.rotate\(10,20,30\)/,
        )![0],
      ),
    );
    assert.equal((withAxis.match(/\brotate\(/g) ?? []).length, 2);
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.equal(
      await page
        .getByRole('button', {name: 'Rotate about axis', exact: true})
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page.locator('.contextual-tool-panel').isVisible(),
      true,
    );
    const focusedRotation = await page.evaluate(() => {
      const {viewport, codeEditor} = window.coordinateApp;
      const target = viewport.sourceContext?.target;
      return (
        target && codeEditor.readSource(target.callRef ?? target.sourceRef)
      );
    });
    assert.match(focusedRotation ?? '', /axisEdge\(.+?\)\.rotate\(0\)/);
    await page.screenshot({path: '/tmp/code3d-spatial-toolbar.png'});
    assert.deepEqual(errors, []);
  },
);

for (const [name, body] of [
  ['empty array', '[]'],
  ['single constraint', 'self.on(base.up)'],
  ['after a rotation', '[self.on(base.up), pivot([4,0,0]).rotate(0,0,25), ]'],
] as const)
  test(
    `new point rotation shows its pivot before writing from ${name}`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {box,group,pivot} from '@code3d/core'; const base=box(32,14,24); const part=box(32,3,24).relate(self=>${body}); group([base,part]);`;
      await setSource(page, source, 'relate');
      if (body.startsWith('[')) await focusSource(page, ']); group', 0);
      const assertPivot = async () => {
        const markers = await spatialMarkers(page);
        assert.equal(markers.length, 1);
        assert.equal(markers[0].decoration.spatialReference, 'pivot');
        assert.equal(markers[0].decoration.appearance.color, '#ffad4d');
        return markers[0];
      };
      await page
        .getByRole('button', {name: 'Rotate about point', exact: true})
        .click();
      await page.evaluate(() => window.coordinateApp.viewport.fit());
      await cameraIdle(page);
      const before = await assertPivot();
      near(before.decoration.transform.position, [0, 0, 0]);
      for (let i = 0; i < 2; i++) {
        await page.keyboard.down('Alt');
        near((await assertPivot()).position, before.position);
        await page.keyboard.up('Alt');
        near((await assertPivot()).position, before.position);
      }
      assert.equal((await state(page)).source, source);
      await page.keyboard.down('Alt');
      const handle = await xHandle(page);
      const drag = async () => {
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(
          handle.x + handle.dx * 35,
          handle.y + handle.dy * 35,
          {steps: 5},
        );
        await assertPivot();
      };
      await drag();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      near((await assertPivot()).position, before.position);
      assert.equal((await state(page)).source, source);
      await drag();
      const moved = await assertPivot();
      await page.mouse.up();
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() !== source,
        source,
      );
      await page.waitForFunction(() => !window.coordinateApp.previewState.busy);
      near((await assertPivot()).position, moved.position);
      await page.keyboard.up('Alt');
      await assertPivot();
      await page.screenshot({
        path: `/tmp/code3d-new-pivot-${name.replaceAll(' ', '-')}.png`,
      });
      await page.evaluate(() =>
        window.coordinateApp.codeEditor.runHistoryAction('undo'),
      );
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      assert.deepEqual(errors, []);
    },
  );

for (const [name, expression, method, reference, rotationAxis] of [
  [
    'offset',
    'core.box(24,16,14).relate(self=>[self.on(base.up),core.offset(0.35,0,0)])',
    'offset',
    false,
    undefined,
  ],
  [
    'origin',
    'core.box(24,16,14).originOffset(0.35,0,0)',
    'originOffset',
    false,
    undefined,
  ],
  [
    'pivot',
    'core.box(24,16,14).relate(self=>[self.on(base.up),core.pivot([0.35,3,4]).rotate(10,20,30)])',
    'pivot',
    true,
    undefined,
  ],
  [
    'axis offset',
    'core.box(24,16,14).relate(self=>[self.on(base.up),core.axisLine(base.axis).axisOffset(0.35,3,4).rotate(35)])',
    'axisOffset',
    true,
    undefined,
  ],
  [
    'point rotation',
    'core.box(24,16,14).relate(self=>[self.on(base.up),core.pivot([2,3,4]).rotate(7,20,30)])',
    'rotate',
    false,
    0,
  ],
  [
    'axis rotation',
    'core.box(24,16,14).relate(self=>[self.on(base.up),core.axisLine(base.axis).rotate(7)])',
    'rotate',
    false,
    1,
  ],
] as const)
  test(
    `Shift gizmo ${name} snaps, switches mid-drag, commits and cancels`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import * as core from '@code3d/core'; const base=core.box(40,8,30); const part=${expression}; core.group([base,part]);`;
      await setSource(page, source, method);
      await cameraIdle(page);
      if (reference) await page.keyboard.down('Alt');
      const matrix = () =>
        page.evaluate(() => {
          const object = window.coordinateApp.viewport.getSelected()!.object;
          object.updateWorldMatrix(true, false);
          return object.matrixWorld.toArray();
        });
      const dragState = () =>
        page.evaluate(() => {
          const viewport = window.coordinateApp.viewport;
          const active = viewport['transformGizmo']['active']!;
          return {
            delta: active.delta,
            start: active.binding.value,
            value: active.value,
            sensitivity: active.binding.sensitivity,
            grid: active.gridStep,
            label: active.binding.label,
            mode: active.binding.mode,
            preview: viewport.dragPreview!.values[0].value,
          };
        });
      const grid = await page.evaluate(
        () => window.coordinateApp.viewport.gridStep,
      );
      assert.ok(grid);
      assert.match(
        (await page.locator('.viewport-grid-scale').getAttribute('title')) ??
          '',
        /5 cells per major interval/,
      );
      const handle =
        rotationAxis === undefined
          ? await xHandle(page)
          : await rotationHandle(page, rotationAxis);
      const before = await matrix();
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 70,
        handle.y + handle.dy * 70,
        {steps: 6},
      );
      const fine = await dragState();
      assert.ok(Math.abs(fine.delta) > 0);
      assert.equal(fine.preview, fine.value);
      const coarseStep = rotationAxis === undefined ? grid * 5 : 15;
      let coarse = fine;
      for (let i = 0; i < 2; i++) {
        await page.keyboard.down('Shift');
        coarse = await dragState();
        assert.equal(
          coarse.delta,
          fine.delta,
          'Changing snap does not alter raw drag distance',
        );
        const expected =
          fine.start +
          (Math.round(fine.delta / coarseStep) * coarseStep) / fine.sensitivity;
        assert.ok(
          Math.abs(coarse.value - expected) < 1e-8,
          JSON.stringify({fine, coarse, coarseStep, expected}),
        );
        assert.equal(coarse.preview, coarse.value);
        if (rotationAxis === undefined) assert.equal(coarse.grid, grid);
        await page.keyboard.up('Shift');
        assert.equal((await dragState()).value, fine.value);
      }
      await page.keyboard.down('Shift');
      assert.notEqual(
        coarse.value,
        coarse.start,
        'Fixture must cross a major increment',
      );
      // Playwright's keyboard tracks one Shift flag for both physical keys.
      // CDP lets the key-up event retain Shift while the other key stays down.
      const keyboard = await page.context().newCDPSession(page);
      const shift = (type: 'rawKeyDown' | 'keyUp', right: boolean) =>
        keyboard.send('Input.dispatchKeyEvent', {
          type,
          key: 'Shift',
          code: right ? 'ShiftRight' : 'ShiftLeft',
          windowsVirtualKeyCode: 16,
          location: right ? 2 : 1,
          modifiers: 8,
        });
      await shift('rawKeyDown', true);
      await shift('keyUp', false);
      assert.equal(
        (await dragState()).value,
        coarse.value,
        'The other Shift key still holds coarse snapping',
      );
      await shift('rawKeyDown', false);
      await shift('keyUp', true);
      await keyboard.detach();
      const preview = await matrix();
      assert.equal((await state(page)).source, source);
      await page.mouse.up();
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() !== source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      await page.keyboard.up('Shift');
      const committedValue = await page.evaluate(
        ({label, mode}) =>
          window.coordinateApp.viewport['transformGizmo'].currentBindings.find(
            binding => binding.label === label && binding.mode === mode,
          )?.value,
        coarse,
      );
      assert.equal(
        committedValue,
        coarse.value,
        'Source writeback retains the snapped value',
      );
      const committed = await matrix();
      assert.ok(
        committed.every((value, i) => Math.abs(value - preview[i]) < 1e-6),
        'Committed geometry matches the drag preview',
      );
      if (reference) await page.keyboard.up('Alt');
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      if (reference) await page.keyboard.down('Alt');
      await page.keyboard.down('Shift');
      const retry =
        rotationAxis === undefined
          ? await xHandle(page)
          : await rotationHandle(page, rotationAxis);
      await page.mouse.move(retry.x, retry.y);
      await page.mouse.down();
      await page.mouse.move(retry.x + retry.dx * 70, retry.y + retry.dy * 70, {
        steps: 4,
      });
      const restarted = await dragState();
      assert.ok(
        Math.abs(
          ((restarted.value - restarted.start) * restarted.sensitivity) /
            coarseStep -
            Math.round(restarted.delta / coarseStep),
        ) < 1e-8,
      );
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.keyboard.up('Shift');
      if (reference) await page.keyboard.up('Alt');
      assert.equal((await state(page)).source, source);
      assert.equal((await state(page)).active, false);
      assert.ok(
        (await matrix()).every(
          (value, i) => Math.abs(value - before[i]) < 1e-6,
        ),
      );
      assert.deepEqual(errors, []);
    },
  );

for (const mode of ['offset', 'rotate', 'pivot', 'axisOffset'] as const)
  test(
    `authored ${mode} supports consecutive gizmo edits before model replacement`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const expression =
        mode === 'pivot'
          ? 'core.pivot([2,3,4]).rotate(10,20,30)'
          : mode === 'axisOffset'
            ? 'core.axisLine(base.axis).axisOffset(2,3,4).rotate(35)'
            : `core.${mode}(0,0,0)`;
      const source = `import * as core from '@code3d/core'; const base=core.box(40,8,30); const part=core.box(24,16,14).relate(self=>[self.on(base.up),${expression}]); core.group([base,part]);`;
      await setSource(page, source, mode);
      await cameraIdle(page);
      if (mode === 'pivot' || mode === 'axisOffset')
        await page.keyboard.down('Alt');
      await page.evaluate(() => {
        const app = window.coordinateApp;
        const compile = app.compiler.compile.bind(app.compiler);
        const gate = new Promise<void>(resolve => {
          app.resumeCompilation = () => {
            app.compiler.compile = compile;
            app.resumeCompilation = undefined;
            resolve();
          };
        });
        app.compiler.compile = async (...args) => {
          const [module] = await Promise.all([compile(...args), gate]);
          return module;
        };
      });
      await page.evaluate(() => {
        const status = document.querySelector<HTMLElement>('#viewport-status')!;
        const samples: {hidden: boolean; label: string; state?: string}[] = [];
        const observer = new MutationObserver(() =>
          samples.push({
            hidden: !!status.hidden,
            label: status.textContent!.trim(),
            state: status.dataset.state,
          }),
        );
        observer.observe(status, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        window.coordinateApp.finishStatusObservation = () => {
          observer.disconnect();
          return samples;
        };
      });
      const matrices = () =>
        page.evaluate(() => {
          const occurrence = window.coordinateApp.viewport.getSelected()!;
          occurrence.object.updateWorldMatrix(true, false);
          return occurrence.object.matrixWorld.toArray();
        });
      const expectedReference =
        mode === 'offset' ? 'origin' : mode === 'axisOffset' ? 'axis' : 'pivot';
      const assertMarker = async () => {
        const markers = await spatialMarkers(page);
        assert.equal(markers.length, 1, JSON.stringify(markers));
        const marker = markers[0];
        assert.equal(marker.decoration.spatialReference, expectedReference);
        assert.equal(
          marker.decoration.appearance.color,
          mode === 'offset' ? '#d8ff3e' : '#ffad4d',
        );
        return marker.position;
      };
      await assertMarker();
      let preview: number[] = [];
      let markerPosition: number[] = [];
      for (let i = 0; i < 2; i++) {
        const handle =
          mode === 'rotate'
            ? await rotationHandle(page, 2)
            : await xHandle(page);
        await page.mouse.move(handle.x, handle.y);
        await page.mouse.down();
        await page.mouse.move(
          handle.x + handle.dx * 35,
          handle.y + handle.dy * 35,
          {steps: 5},
        );
        preview = await matrices();
        markerPosition = await assertMarker();
        if (mode === 'offset') await assertTranslationOrigin(page);
        const previous = (await state(page)).source;
        await page.mouse.up();
        await page.waitForFunction(
          previous =>
            window.coordinateApp.codeEditor.editor.getValue() !== previous,
          previous,
        );
        const next = await matrices();
        near(await assertMarker(), markerPosition);
        if (mode === 'offset') await assertTranslationOrigin(page);
        assert.ok(
          next.every((v, j) => Math.abs(v - preview[j]) < 1e-6),
          'Committing preserves the preview pose',
        );
        assert.ok(
          await page.evaluate(() =>
            window.coordinateApp.viewport.positionTools['axes'].some(
              axis =>
                axis.controls.enabled && axis.controls.getHelper().visible,
            ),
          ),
          'A supported authored edit stays available',
        );
      }
      // Cancelling a third gesture restores the committed reference while the
      // replacement model is still withheld, including after releasing Alt.
      const handle =
        mode === 'rotate' ? await rotationHandle(page, 2) : await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 25,
        handle.y + handle.dy * 25,
        {steps: 4},
      );
      await assertMarker();
      await page.keyboard.press('Escape');
      await page.mouse.up();
      near(await assertMarker(), markerPosition);
      await page.keyboard.up('Alt');
      near(await assertMarker(), markerPosition);
      if (mode === 'offset' || mode === 'pivot')
        await page.screenshot({
          path: `/tmp/code3d-reference-${mode}-pending.png`,
        });
      const status = page.locator('#viewport-status');
      assert.equal(await status.isVisible(), true);
      assert.equal(await status.getAttribute('data-state'), 'busy');
      await page.evaluate(() => window.coordinateApp.resumeCompilation!());
      await page.getByText('Ready', {exact: true}).waitFor();
      const samples = await page.evaluate(() =>
        window.coordinateApp.finishStatusObservation!(),
      );
      assert.ok(samples.some(sample => sample.state === 'busy'));
      assert.ok(
        samples.every(sample => !sample.hidden && sample.label),
        JSON.stringify(samples),
      );
      await page.keyboard.up('Alt');
      await cameraIdle(page);
      if (mode === 'offset') await assertTranslationOrigin(page);
      near(await assertMarker(), markerPosition);
      const next = await matrices();
      assert.ok(
        next.every((v, j) => Math.abs(v - preview[j]) < 1e-5),
        JSON.stringify({next, preview}),
      );
      assert.deepEqual(errors, []);
    },
  );

test(
  'axis rotation Alt moves its reference and retains the angle when replacing the axis',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisEdge, box,group,axisLine} from '@code3d/core'; const base=box(40,8,30); const part=box(24,16,14).relate(self=>[self.on(base.up),axisLine(base.axis).rotate(35)]); group([base,part]);`;
    await setSource(page, source, 'rotate');
    const rotationId = await page.evaluate(
      () => window.coordinateApp.viewport.sourceContext?.target.id,
    );
    await page.evaluate(() => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('axisLine(base') + 2),
      );
    });
    assert.equal(
      await page.evaluate(
        () => window.coordinateApp.viewport.sourceContext?.target.id,
      ),
      rotationId,
    );
    assert.equal(await page.locator('.contextual-tool-panel input').count(), 1);
    await page.evaluate(() => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(
            editor.getValue().indexOf('axisLine(base.axis)') +
              'axisLine(base.'.length,
          ),
      );
    });
    assert.equal(
      await page.evaluate(
        () => window.coordinateApp.viewport.sourceContext?.target.id,
      ),
      rotationId,
    );
    await page
      .getByRole('button', {name: 'Rotate about axis', exact: true})
      .waitFor();
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    await assertTranslationOrigin(page);
    // Translate focuses an insertion after this rotation. Revisit the authored
    // rotation to edit its reference instead of creating a new rotation there.
    await page.evaluate(() => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('axisLine(base') + 2),
      );
    });
    await page
      .getByRole('button', {name: 'Rotate about axis', exact: true})
      .click();
    assert.equal((await state(page)).source, source);
    assert.equal(
      await page.evaluate(
        () =>
          window.coordinateApp.viewport['decorationLayers'].get(
            'source-context:model-origin',
          )?.[0].anchor?.userData.decoration.elementKind,
      ),
      'line',
    );
    await page.keyboard.down('Alt');
    const handle = await xHandle(page);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.dx * 35,
      handle.y + handle.dy * 35,
      {steps: 4},
    );
    await page.keyboard.up('Alt');
    assert.equal(
      await page.evaluate(
        () =>
          window.coordinateApp.viewport.positionTools['active']?.binding
            .kind === 'spatial' &&
          window.coordinateApp.viewport.positionTools['active']?.binding.spatial
            .operation,
      ),
      'axisOffset',
    );
    await page.mouse.up();
    await page.waitForFunction(() =>
      window.coordinateApp.codeEditor.editor
        .getValue()
        .includes('.axisOffset('),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.match(
      (await state(page)).source,
      /axisLine\(base.axis\)\.axisOffset\([^)]*\)\.rotate\(35\)/,
    );
    await page.evaluate(() => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('axisOffset(') + 2),
      );
    });
    await page
      .locator('.contextual-tool-panel input[data-parameter="axisOffset.x"]')
      .waitFor();
    assert.equal(await page.locator('.contextual-tool-panel input').count(), 4);
    assert.equal(
      await page.evaluate(
        () =>
          window.coordinateApp.viewport['topologySelection']?.mesh.edgeGroups
            .length,
      ),
      12,
    );
    const edge = await selectAxisEdge(page);
    await page.waitForFunction(
      id =>
        window.coordinateApp.codeEditor.editor
          .getValue()
          .includes(`axisEdge(${JSON.stringify(id)})`),
      edge,
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.match(
      (await state(page)).source,
      /axisEdge\([^)]*\)\.axisOffset\([^)]*\)\.rotate\(35\)/,
    );
    assert.deepEqual(errors, []);
  },
);

for (const grouped of [false, true])
  test(
    `a rotation pivot can be positioned before the first rotation is authored (${grouped ? 'group' : 'solid'})`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box,group} from '@code3d/core'; const base=box(40,8,30).rotate(10,0,0); const part=${grouped ? 'group([box(24,16,14)])' : 'box(24,16,14)'}.relate(self=>self.on(base.up)); group([base,part]);`;
      await setSource(page, source, 'rotate');
      await page.evaluate(() => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(editor.getValue().indexOf('self.on') + 1),
        );
      });
      await page
        .getByRole('button', {name: 'Rotate about point', exact: true})
        .click();
      await page.keyboard.down('Alt');
      const handle = await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 35,
        handle.y + handle.dy * 35,
        {steps: 4},
      );
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await page.waitForFunction(() =>
        window.coordinateApp.codeEditor.editor.getValue().includes('pivot(['),
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      assert.match(
        (await state(page)).source,
        /self\.on\(base.up\),\s*pivot\(\[[^\]]*\]\)\.rotate\(0, 0, 0\)/,
      );
      assert.deepEqual(errors, []);
    },
  );

{
  test(
    'pivot and rotation share one tool and panel',
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import * as core from '@code3d/core'; const base=core.box(40,8,30); const part=core.box(24,16,14).relate(self=>[self.on(base.up),core.pivot([2,3,4]).rotate(10,20,30)]); core.group([base,part]);`;
      await setSource(page, source, 'pivot');
      const panel = page.locator('.contextual-tool-panel');
      await panel.locator('input[data-parameter="pivot.x"]').waitFor();
      assert.equal(await panel.locator('input').count(), 6);
      const tool = () =>
        page.evaluate(
          () => window.coordinateApp.viewport.sourceContext?.target.id,
        );
      const originalTool = await tool();
      assert.equal(
        await page.evaluate(
          () => window.coordinateApp.viewport.positionTools.tool,
        ),
        'rotate-point',
      );
      await page.evaluate(() => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(editor.getValue().indexOf('rotate(10') + 2),
        );
      });
      assert.equal(await tool(), originalTool);
      const input = panel.locator('input[data-parameter="pivot.x"]');
      await input.fill('6');
      await input.press('Enter');
      await page.waitForFunction(() =>
        window.coordinateApp.codeEditor.editor
          .getValue()
          .includes('pivot([6,3,4])'),
      );
      await page.getByText('Ready', {exact: true}).waitFor();
      await page.keyboard.down('Alt');
      assert.ok(
        await page.evaluate(
          () => !!window.coordinateApp.viewport['topologySelection'],
        ),
      );
      await page.evaluate(() => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(editor.getValue().indexOf('pivot([') + 2),
        );
      });
      assert.ok(
        await page.evaluate(
          () => !!window.coordinateApp.viewport['topologySelection'],
        ),
      );
      const handle = await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 40,
        handle.y + handle.dy * 40,
        {steps: 5},
      );
      assert.equal((await state(page)).active, true);
      await page.mouse.up();
      await page.keyboard.up('Alt');
      await page.getByText('Ready', {exact: true}).waitFor();
      const edited = (await state(page)).source;
      assert.match(edited, /pivot\(\[(?!6,)[^\]]+\]\)\.rotate\(10,20,30\)/);
      assert.equal(edited.includes('pivotOffset'), false);
      await page.screenshot({path: '/tmp/code3d-rotation-panel.png'});
      assert.equal(
        await page.evaluate(
          () => !!window.coordinateApp.viewport['topologySelection'],
        ),
        true,
      );
      assert.deepEqual(errors, []);
    },
  );
}

test(
  'Alt leaves the translate tool unchanged with no reference candidates',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    await setSource(
      page,
      `import * as core from '@code3d/core'; const base=core.box(40,8,30); const part=core.box(24,16,14).relate(self=>[self.on(base.up), core.offset(0,0,0), core.rotate(10,20,30)]); core.group([base,part]);`,
      'offset',
    );
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    await page.keyboard.down('Alt');
    assert.equal(
      await page.evaluate(() =>
        window.coordinateApp.viewport.positionTools['axes']
          .filter(c => c.controls.getHelper().visible)
          .every(c => c.binding?.mode === 'translate'),
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => !!window.coordinateApp.viewport['topologySelection'],
      ),
      false,
    );
    await xHandle(page);
    await page.keyboard.up('Alt');
    assert.deepEqual(errors, []);
  },
);

for (const [selector, axis, suffix] of [
  ['pivotVertex()', false, '.rotate(0, 0, 0)'],
  [
    'pivotVertex().pivotOffset(2,0,0)',
    false,
    '.pivotOffset(2,0,0).rotate(0, 0, 0)',
  ],
  ['pivotVertex().rotate(0,0,15)', false, '.rotate(0,0,15)'],
  [
    'pivot([1,2,3]).pivotOffset(2,0,0)',
    false,
    '.pivotOffset(2,0,0).rotate(0, 0, 0)',
  ],
  ['axisLine()', true, '.rotate(0)'],
  ['axisEdge()', true, '.rotate(0)'],
  ['pivotPoint()', false, '.rotate(0, 0, 0)'],
  ['axisLine(self.edge())', true, '.rotate(0)'],
  ['core.axisLine().axisOffset(2,0,0)', true, '.axisOffset(2,0,0).rotate(0)'],
  [
    'axisLine().axisOffset(2,0,0).rotate(23)',
    true,
    '.axisOffset(2,0,0).rotate(23)',
  ],
] as const)
  test(
    `draft ${selector} reference picking completes rotation, shows a gizmo and undoes once`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      try {
        const source = `import * as core from '@code3d/core'; import {offset, rotate, box,group,pivot,pivotVertex,pivotPoint,axisEdge,axisLine} from '@code3d/core'; const base=box(32,14,24); const cover=box(32,3,24).relate(self=>[self.axis.align(base.axis),self.on(base.up),pivotVertex(8).rotate(0,0,49),${selector}]); group([base,cover]);`;
        await page.evaluate(
          ({source, selector}) => {
            const editor = window.coordinateApp.codeEditor.editor;
            editor.getModel()!.setValue(source);
            editor.setPosition(
              editor
                .getModel()!
                .getPositionAt(
                  source.lastIndexOf(selector) + selector.indexOf('(') + 1,
                ),
            );
          },
          {source, selector},
        );
        await page.waitForFunction(
          () =>
            !!window.coordinateApp.viewport.sourceContext?.target
              .rotationSelection &&
            !!window.coordinateApp.viewport['topologySelection'],
        );
        await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
        assert.equal(
          await page
            .getByRole('button', {
              name: axis ? 'Rotate about axis' : 'Rotate about point',
              exact: true,
            })
            .getAttribute('aria-pressed'),
          'true',
        );
        assert.equal((await state(page)).source, source);
        const panel = page.locator('.contextual-tool-panel');
        await panel.getByText('Rotate', {exact: true}).waitFor();
        for (const name of axis ? ['angle'] : ['x', 'y', 'z']) {
          const input = panel.locator(`input[data-parameter="${name}"]`);
          assert.equal(await input.count(), 1);
          if (!selector.includes('.rotate(')) {
            assert.equal(await input.isEnabled(), true);
            assert.equal(await input.getAttribute('placeholder'), '0');
          }
        }
        await page.evaluate(() => window.coordinateApp.viewport.fit());
        await cameraIdle(page);
        let reference: string;
        if (axis) {
          const edge = await selectAxisEdge(page);
          reference = JSON.stringify(edge);
        } else {
          const vertices = await vertexState(page);
          assert.equal(vertices.vertices.length, 8);
          const candidate = vertices.vertices.find(
            vertex => vertex.clickable && vertex.id === vertex.picked,
          )!;
          assert.ok(candidate);
          reference = JSON.stringify(candidate.id);
          await page.mouse.click(candidate.x, candidate.y);
        }
        const selected = `${selector.startsWith('core.') ? 'core.' : ''}${axis ? 'axisEdge' : 'pivotVertex'}(${reference})${suffix}`;
        await page.waitForFunction(
          selected =>
            window.coordinateApp.codeEditor.editor
              .getValue()
              .includes(selected),
          selected,
        );
        await page.getByText('Ready', {exact: true}).waitFor();
        assert.equal(
          await page.evaluate(() => {
            const editor = window.coordinateApp.codeEditor.editor;
            const offset = editor
              .getModel()!
              .getOffsetAt(editor.getPosition()!);
            return (
              editor.getValue()[offset] === '(' &&
              /(?:pivotVertex|axisEdge)$/.test(
                editor.getValue().slice(0, offset),
              )
            );
          }),
          true,
          'Reference picking focuses its selector, not rotate or the last argument',
        );
        assert.equal(
          (await state(page)).source.match(/\brotate\(/g)?.length,
          2,
        );
        assert.ok(
          (await state(page)).source.includes('pivotVertex(8).rotate(0,0,49)'),
        );
        await rotationHandle(page, axis ? 1 : 0);
        if (axis) {
          const colors = await page.evaluate(() => {
            const controls =
              window.coordinateApp.viewport['transformGizmo']['axes'];
            return controls
              .filter(
                control =>
                  control.binding?.mode === 'rotate' &&
                  control.controls.getHelper().visible,
              )
              .flatMap(control =>
                control.gizmo.gizmo.rotate.children
                  .filter(
                    object =>
                      object.visible &&
                      object.name === control.binding!.axis.toUpperCase(),
                  )
                  .map(object =>
                    (
                      (object as import('three').Mesh)
                        .material as import('three').MeshBasicMaterial
                    ).color.getHexString(),
                  ),
              );
          });
          assert.ok(colors.length > 0);
          assert.ok(
            colors.every(color => color === 'ffad4d'),
            JSON.stringify(colors),
          );
        }
        await page
          .locator('.contextual-tool-panel')
          .getByText('Rotate', {exact: true})
          .waitFor();
        assert.equal(
          await page.locator('.contextual-tool-panel output').textContent(),
          `${axis ? 'E' : 'V'}${reference}`,
        );
        if (selector === 'axisLine()' || selector === 'axisEdge()')
          await page.screenshot({path: '/tmp/code3d-axis-completed.png'});
        if (selector === 'pivotVertex()')
          await page.screenshot({path: '/tmp/code3d-pivot-completed.png'});
        await page.evaluate(() =>
          window.coordinateApp.codeEditor.editor.focus(),
        );
        await page.keyboard.press('Control+z');
        await page.waitForFunction(
          source =>
            window.coordinateApp.codeEditor.editor.getValue() === source,
          source,
        );
        assert.deepEqual(errors, []);
      } catch (error) {
        console.error(
          await page.evaluate(() => ({
            source: window.coordinateApp.codeEditor.editor.getValue(),
            target: window.coordinateApp.viewport.sourceContext?.target,
            body: document.body.innerText,
          })),
          errors,
        );
        throw error;
      }
    },
  );

for (const [selector, axis, valid] of [
  ['pivot([1,2,3])', false, true],
  ['pivotVertex()', false, false],
  ['pivotPoint(base.center)', false, true],
  ['axisEdge()', true, false],
  ['axisLine(base.axis)', true, true],
] as const)
  test(
    `draft ${selector} panel edits rotation before picking and undoes once`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {offset, rotate, box,group,pivot,pivotVertex,pivotPoint,axisEdge,axisLine} from '@code3d/core'; const base=box(32,14,24); const cover=box(32,3,24).relate(self=>[self.on(base.up),${selector}]); group([base,cover]);`;
      await page.evaluate(
        ({source, selector}) => {
          const editor = window.coordinateApp.codeEditor.editor;
          editor.getModel()!.setValue(source);
          editor.setPosition(
            editor
              .getModel()!
              .getPositionAt(
                source.lastIndexOf(selector) + selector.indexOf('(') + 1,
              ),
          );
        },
        {source, selector},
      );
      const panel = page.locator('.contextual-tool-panel');
      await panel.getByText('Rotate', {exact: true}).waitFor();
      const input = panel.locator(
        `input[data-parameter="${axis ? 'angle' : 'x'}"]`,
      );
      await input.fill('30');
      await input.press('Enter');
      const selected = `${selector}.rotate(${axis ? '30' : '30, 0, 0'})`;
      await page.waitForFunction(
        selected =>
          window.coordinateApp.codeEditor.editor.getValue().includes(selected),
        selected,
      );
      assert.equal((await state(page)).source.match(/\brotate\(/g)?.length, 1);
      if (valid) {
        await page.getByText('Ready', {exact: true}).waitFor();
        await cameraIdle(page);
        await rotationHandle(page, axis ? 1 : 0);
      } else {
        await page.waitForFunction(
          () => !!window.coordinateApp.viewport['topologySelection'],
        );
        const angles = page.locator(
          `.contextual-tool-panel input[data-parameter="${axis ? 'angle' : 'x'}"]`,
        );
        await angles.waitFor();
        assert.ok(
          (await angles.inputValue()) === '30' ||
            (await angles.getAttribute('placeholder')) === '30',
        );
      }
      await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      assert.deepEqual(errors, []);
    },
  );

test(
  'failed selector tools remain available after compilation completes with the cursor elsewhere',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {offset, rotate, pivot, pivotPoint, axisLine, axisEdge, box,pivotVertex} from '@code3d/core'; box(20,8,12).relate(self=>[pivotVertex()]);
// outside the model`;
    await page.evaluate(source => {
      const app = window.coordinateApp;
      const compile = app.compiler.compile.bind(app.compiler);
      app.compiler.compile = async (...args) => {
        const result = await compile(...args);
        await new Promise<void>(resolve => {
          app.resumeCompilation = () => resolve();
        });
        app.compiler.compile = compile;
        app.resumeCompilation = undefined;
        return result;
      };
      const editor = app.codeEditor.editor;
      editor.getModel()!.setValue(source);
      editor.setPosition(editor.getModel()!.getPositionAt(source.length));
    }, source);
    await page.waitForFunction(() => !!window.coordinateApp.resumeCompilation);
    await page.evaluate(() => window.coordinateApp.resumeCompilation!());
    await page.getByText('Model error', {exact: true}).waitFor();
    await page.evaluate(source => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(
            source.lastIndexOf('pivotVertex(') + 'pivotVertex('.length,
          ),
      );
    }, source);
    const state = await page.evaluate(() => ({
      current: window.coordinateApp.codeEditor.sourceVersion(),
      accepted: window.coordinateApp.previewState.sourceVersion,
      target:
        window.coordinateApp.viewport.sourceContext?.target.rotationSelection,
      toolbar: document.querySelector<HTMLElement>('.spatial-toolbar')?.hidden,
      panel: document.querySelector<HTMLElement>('.contextual-tool-panel')
        ?.hidden,
    }));
    assert.equal(state.accepted, state.current, JSON.stringify(state));
    assert.ok(state.target, JSON.stringify(state));
    assert.equal(state.toolbar, false);
    assert.equal(state.panel, false);
    assert.deepEqual(errors, []);
  },
);

for (const selector of ['pivotVertex', 'axisEdge'] as const) {
  test(
    `${selector} source arguments highlight the unified rotation panel reference`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {box,${selector}} from '@code3d/core'; box(20,8,12).relate(self=>[${selector}(1).rotate(${selector === 'axisEdge' ? '20' : '0,0,20'})]);`;
      await page.evaluate(source => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.getModel()!.setValue(source);
        editor.setPosition(
          editor.getModel()!.getPositionAt(source.lastIndexOf('rotate(') + 2),
        );
      }, source);
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport.sourceContext?.target.tool?.signature
            .name === 'rotate',
      );
      await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
      const reference = page.locator(
        `.contextual-tool-panel output[data-parameter="${selector}.id"]`,
      );
      for (let index = 0; index < 3; index++) {
        await page.evaluate(selector => {
          const editor = window.coordinateApp.codeEditor.editor;
          const offset =
            editor.getValue().lastIndexOf(`${selector}(`) + selector.length + 1;
          editor.setPosition(editor.getModel()!.getPositionAt(offset));
        }, selector);
        await page.waitForFunction(
          selector =>
            document
              .querySelector(`output[data-parameter="${selector}.id"]`)
              ?.classList.contains('source-active'),
          selector,
        );
        assert.equal(
          await reference.innerText(),
          selector === 'axisEdge' ? 'E1' : 'V1',
        );
        await page.evaluate(() => {
          const editor = window.coordinateApp.codeEditor.editor;
          editor.setPosition(
            editor
              .getModel()!
              .getPositionAt(editor.getValue().lastIndexOf('rotate(') + 7),
          );
        });
        assert.equal(
          await reference.evaluate(element =>
            element.classList.contains('source-active'),
          ),
          false,
        );
      }
      await page.evaluate(selector => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(editor.getValue().lastIndexOf(`${selector}(`) + 2),
        );
      }, selector);
      assert.equal(
        await page.locator('.contextual-tool-panel .source-active').count(),
        0,
      );
      assert.equal(
        await page.locator('.contextual-tool-panel').isVisible(),
        true,
      );
      assert.deepEqual(errors, []);
    },
  );
}

for (const contents of [
  '',
  'self.axis.align(base.axis), self.on(base.up),\n  ',
  'self.axis.align(base.axis), self.on(base.up), offset(3, 0, 0),\n  ',
]) {
  test(
    `relate array whitespace provides self tools for ${contents.includes('offset(') ? 'a transformed joint stage' : contents ? 'a joint constraint stage' : 'an empty array'}`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box,group,offset} from '@code3d/core'; const base=box(32,14,24); const cover=box(32,3,24).relate(self=>[${contents}]); group([base,cover]);`;
      await page.evaluate(source => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.getModel()!.setValue(source);
        editor.setPosition(
          editor.getModel()!.getPositionAt(source.indexOf(']); group')),
        );
      }, source);
      await page.waitForFunction(
        () =>
          !!window.coordinateApp.viewport.sourceContext?.target.relationArray,
      );
      await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
      const scope = await page.evaluate(() => {
        const {viewport} = window.coordinateApp;
        return {
          owner: viewport.sourceContext?.evaluation.relationOwnerNodeId,
          selected: viewport.getSelected()?.node.nodeId,
          count: viewport.positionTools['bindings'].length,
        };
      });
      assert.equal(scope.owner, scope.selected);
      assert.ok(scope.count >= 6, JSON.stringify(scope));
      await page
        .getByRole('button', {name: 'Rotation tools', exact: true})
        .click();
      await page
        .getByRole('menuitemradio', {name: 'Rotate about axis', exact: true})
        .click();
      await selectAxisEdge(page);
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport.sourceContext?.target.tool?.signature
            .name === 'rotate',
      );
      assert.equal(
        await page.locator('.contextual-tool-panel').isVisible(),
        true,
      );
      assert.match((await state(page)).source, /axisEdge\(.+?\)\.rotate\(0\)/);
      await page.evaluate(() =>
        window.coordinateApp.codeEditor.runHistoryAction('undo'),
      );
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      assert.deepEqual(errors, []);
    },
  );
}

test(
  'XYZ input steps follow the live small grid without replacing focused drafts',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {offset, rotate, pivot, pivotVertex, pivotPoint, axisLine, axisEdge, box} from '@code3d/core'; const shift=2; box(20,10,12).originOffset(shift*2,0,0);`;
    await setSource(page, source, 'originOffset');
    await cameraIdle(page);
    const fields = page.locator('.contextual-tool-panel input');
    const before = await page.evaluate(() => {
      const viewport = window.coordinateApp.viewport;
      const fields = [
        ...document.querySelectorAll<HTMLInputElement>(
          '.contextual-tool-panel input',
        ),
      ];
      return {
        grid: viewport.gridStep,
        steps: fields.map(input => Number(input.step)),
      };
    });
    assert.ok(before.grid);
    assert.deepEqual(before.steps, [before.grid, before.grid, before.grid]);
    await fields.first().focus();
    await page.evaluate(() => {
      const input = document.activeElement as HTMLInputElement;
      input.dataset.testRetained = 'true';
      input.value = '123.456';
      const viewport = window.coordinateApp.viewport;
      const controls = viewport['controls'];
      const pose = controls.capturePose();
      controls.restorePose({
        ...pose,
        distance: pose.distance * 20,
        viewHeight: pose.viewHeight * 20,
      });
    });
    await page.waitForFunction(
      before => window.coordinateApp.viewport.gridStep !== before,
      before.grid,
    );
    const after = await page.evaluate(() => ({
      grid: window.coordinateApp.viewport.gridStep,
      fields: [
        ...document.querySelectorAll<HTMLInputElement>(
          '.contextual-tool-panel input',
        ),
      ].map(input => ({
        step: Number(input.step),
        value: input.value,
        retained: input.dataset.testRetained,
        focused: document.activeElement === input,
      })),
    }));
    assert.deepEqual(
      after.fields.map(field => field.step),
      [after.grid, after.grid, after.grid],
    );
    assert.equal(after.fields[0].value, '123.456');
    assert.equal(after.fields[0].retained, 'true');
    assert.equal(after.fields[0].focused, true);
    assert.equal((await state(page)).source, source);
    await fields.first().press('ArrowUp');
    assert.ok(
      Math.abs(
        Number(await fields.first().inputValue()) - (123.456 + after.grid!),
      ) < 1e-9,
    );
    await page.waitForFunction(expected => {
      const source = window.coordinateApp.codeEditor.editor.getValue();
      const match = /const shift\s*=\s*([\d.]+)/.exec(source);
      return !!match && Math.abs(Number(match[1]) - expected / 2) < 1e-9;
    }, 123.456 + after.grid!);
    assert.deepEqual(errors, []);
  },
);

test(
  'toolbar highlight follows source calls and retains an insertion choice while recompiling',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import * as core from '@code3d/core';
const part = core.box(24,16,14).relate(self => [
  core.offset(2,0,0),
  core.pivot([1,2,3]).rotate(0,0,30),
  core.axisEdge(1).rotate(20),
]);
part;`;
    await setSource(page, source, 'offset');
    const expectTool = async (name: string) => {
      const pressed = page.locator(
        '.spatial-toolbar button[aria-pressed="true"]',
      );
      assert.equal(await pressed.count(), 1);
      assert.equal(await pressed.getAttribute('aria-label'), name);
    };
    const focus = async (text: string) =>
      page.evaluate(text => {
        const editor = window.coordinateApp.codeEditor.editor;
        const offset = editor.getValue().indexOf(text);
        if (offset < 0) throw new Error(`Missing ${text}`);
        editor.setPosition(editor.getModel()!.getPositionAt(offset + 2));
        editor.focus();
      }, text);
    const chooseAxis = async () => {
      await page
        .getByRole('button', {name: 'Rotation tools', exact: true})
        .click();
      await page
        .getByRole('menuitemradio', {name: 'Rotate about axis', exact: true})
        .click();
    };
    await expectTool('Translate');
    await chooseAxis();
    await expectTool('Rotate about axis');
    await focus('pivot([1');
    await expectTool('Rotate about point');
    await focus('rotate(0,0,30)');
    await expectTool('Rotate about point');
    await chooseAxis();
    await expectTool('Rotate about axis');
    await page.evaluate(() => window.coordinateApp.runModel());
    await expectTool('Rotate about axis');
    await page.keyboard.down('Alt');
    await expectTool('Rotate about axis');
    await page.keyboard.up('Alt');
    await focus('pivot([1');
    await expectTool('Rotate about point');
    await focus('offset(2');
    await expectTool('Translate');
    await focus('axisEdge(1)');
    await expectTool('Rotate about axis');
    assert.equal(
      await page.evaluate(
        () =>
          window.coordinateApp.viewport.sourceContext?.target.tool?.signature
            .name,
      ),
      'rotate',
    );
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    await expectTool('Translate');
    await focus('pivot([1');
    await chooseAxis();
    await focus('import *');
    assert.equal(await page.locator('.spatial-toolbar').isVisible(), false);
    await focus('pivot([1');
    await expectTool('Rotate about point');
    assert.equal(
      (await state(page)).source.replace(/\s/g, ''),
      source.replace(/\s/g, ''),
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'starting a translation gizmo after an orthographic orbit preserves the camera pose',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    await setSource(
      page,
      `import * as core from '@code3d/core'; core.box(24,16,14).relate(self=>[core.offset(2,0,0)]);`,
      'offset',
    );
    await cameraIdle(page);
    await page.getByRole('button', {name: 'View from +Y', exact: true}).click();
    await cameraIdle(page);
    const canvas = (await page.locator('.viewport-canvas').boundingBox())!;
    await page.mouse.move(
      canvas.x + canvas.width * 0.8,
      canvas.y + canvas.height * 0.75,
    );
    await page.mouse.down();
    await page.mouse.move(
      canvas.x + canvas.width * 0.8 + 65,
      canvas.y + canvas.height * 0.75 - 55,
      {steps: 10},
    );
    await page.mouse.up();
    await cameraIdle(page);
    const sample = () =>
      page.evaluate(() => {
        const viewport = window.coordinateApp.viewport;
        const camera = viewport['camera'];
        const pose = viewport['controls'].capturePose();
        return {
          position: camera.position.toArray(),
          orientation: camera.quaternion.toArray(),
          focus: pose.focus.toArray(),
          viewHeight: pose.viewHeight,
          projection: pose.projection,
        };
      });
    const before = await sample();
    assert.equal(before.projection, 'perspective');
    const handle = await xHandle(page);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    assert.equal(
      await page.evaluate(
        () => !!window.coordinateApp.viewport.positionTools['active'],
      ),
      true,
    );
    const after = await sample();
    for (const key of ['position', 'orientation', 'focus'] as const)
      assert.ok(
        after[key].every((v, i) => Math.abs(v - before[key][i]) < 1e-6),
        JSON.stringify({key, before, after}),
      );
    assert.ok(
      Math.abs(after.viewHeight - before.viewHeight) < 1e-6,
      JSON.stringify({before, after}),
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.deepEqual(errors, []);
  },
);

test(
  'toolbar activates the authored step and keeps source location visible',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import * as core from '@code3d/core';
const amount = 2;
const base = core.box(40,10,30);
const part = core.box(24,16,14).relate(self => [
  self.on(base.up),
  core.offset(amount,0,0),
  core.pivot([1,2,3]).rotate(0,0,30),
]);
core.group([base, part]);`;
    await setSource(page, source, 'offset');
    assert.deepEqual((await sourceMarks(page)).tool, ['offset(amount,0,0)']);
    const originalSource = (await state(page)).source;
    await focusSource(page, 'self.on');
    await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
    assert.equal(
      await page
        .locator('.spatial-toolbar button[aria-pressed="true"]')
        .count(),
      0,
    );
    assert.deepEqual((await sourceMarks(page)).tool, []);
    const before = await sourceMarks(page);
    const pose = () =>
      page.evaluate(() => {
        const object = window.coordinateApp.viewport.getSelected()!.object;
        object.updateWorldMatrix(true, false);
        return object.matrixWorld.toArray();
      });
    const finalPose = await pose();
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    const translated = await sourceMarks(page);
    assert.equal(translated.focused, false);
    assert.notDeepEqual(translated.selection, before.selection);
    assert.deepEqual(translated.word, []);
    assert.deepEqual(translated.caret, [
      originalSource.indexOf('offset(') + 'offset(amount,0,0)'.length,
    ]);
    assert.deepEqual(translated.tool, ['offset(amount,0,0)']);
    const offsetPose = await pose();
    assert.notDeepEqual(offsetPose, finalPose);
    assert.equal((await state(page)).source, originalSource);
    const handle = await xHandle(page);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    assert.equal((await state(page)).active, true);
    assert.deepEqual(
      await pose(),
      offsetPose,
      'Pointer down keeps the activated step',
    );
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await focusSource(page, 'offset(amount,0,0)', 'offset(amount,0,0)'.length);
    await page
      .getByRole('button', {name: 'Rotate about point', exact: true})
      .click();
    assert.deepEqual((await sourceMarks(page)).tool, [
      'pivot([1,2,3]).rotate(0,0,30)',
    ]);
    await page.evaluate(() => window.coordinateApp.runModel());
    assert.deepEqual((await sourceMarks(page)).tool, [
      'pivot([1,2,3]).rotate(0,0,30)',
    ]);
    assert.deepEqual((await sourceMarks(page)).word, []);
    assert.deepEqual(await pose(), finalPose);
    await assertMarkedSourceVisible(page);
    await page.screenshot({path: '/tmp/code3d-viewport-source-marks.png'});
    await focusSource(page, ']);', -1);
    assert.equal(
      await page
        .locator('.spatial-toolbar button[aria-pressed="true"]')
        .count(),
      0,
    );
    assert.deepEqual((await sourceMarks(page)).tool, []);
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    assert.equal(
      (await sourceMarks(page)).caret.length,
      1,
      'Array gaps retain a static caret',
    );
    await focusSource(page, 'import *');
    assert.deepEqual((await sourceMarks(page)).tool, []);
    assert.deepEqual((await sourceMarks(page)).word, []);
    await focusSource(page, 'box(40');
    assert.deepEqual(
      (await sourceMarks(page)).tool,
      ['box(40,10,30)'],
      'Parameter tools use the same source markers',
    );
    await page.evaluate(() =>
      window.coordinateApp.codeEditor.createFile(
        '/other.ts',
        'const other = 1;',
      ),
    );
    assert.deepEqual((await sourceMarks(page)).tool, []);
    assert.deepEqual((await sourceMarks(page)).word, []);
    assert.deepEqual(errors, []);
  },
);

test(
  'inserted spatial calls gain a source marker and undo restores the unselected context',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import * as core from '@code3d/core';
const base = core.box(40,10,30);
const part = core.box(24,16,14).relate(self => [self.on(base.up)]);
core.group([base, part]);`;
    await setSource(page, source, 'box');
    await focusSource(page, 'self.on');
    await page.getByRole('button', {name: 'Translate', exact: true}).click();
    const before = await sourceMarks(page);
    assert.deepEqual(
      before.tool,
      [],
      'A missing offset must not underline its insertion anchor',
    );
    const handle = await xHandle(page);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.dx * 40,
      handle.y + handle.dy * 40,
      {steps: 5},
    );
    await page.mouse.up();
    await page.waitForFunction(() =>
      window.coordinateApp.codeEditor.editor.getValue().includes('offset('),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    const after = await sourceMarks(page);
    assert.equal(after.tool.length, 1);
    assert.match(after.tool[0], /^offset\(/);
    assert.deepEqual(after.word, ['offset']);
    assert.equal(after.focused, false);
    await assertMarkedSourceVisible(page);
    await page.evaluate(() =>
      window.coordinateApp.codeEditor.editor.setScrollLeft(0),
    );
    await page.evaluate(() => window.coordinateApp.runModel());
    assert.equal(
      await page.evaluate(() =>
        window.coordinateApp.codeEditor.editor.getScrollLeft(),
      ),
      0,
      'Recompiling unchanged source must not reset manual scrolling',
    );
    await page.evaluate(() =>
      window.coordinateApp.codeEditor.runHistoryAction('undo'),
    );
    await page.waitForFunction(
      () =>
        !window.coordinateApp.codeEditor.editor.getValue().includes('offset('),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.deepEqual((await sourceMarks(page)).tool, []);
    assert.deepEqual((await sourceMarks(page)).selection, before.selection);
    assert.equal(
      await page
        .locator('.spatial-toolbar button[aria-pressed="true"]')
        .count(),
      0,
    );
    await page.evaluate(() =>
      window.coordinateApp.codeEditor.runHistoryAction('redo'),
    );
    await page.waitForFunction(() =>
      window.coordinateApp.codeEditor.editor.getValue().includes('offset('),
    );
    await page.getByText('Ready', {exact: true}).waitFor();
    await page.waitForFunction(
      () =>
        window.coordinateApp.previewState.sourceVersion ===
        window.coordinateApp.codeEditor.sourceVersion(),
    );
    assert.deepEqual((await sourceMarks(page)).tool, after.tool);
    assert.deepEqual((await sourceMarks(page)).selection, after.selection);
    assert.equal((await sourceMarks(page)).focused, false);
    await assertMarkedSourceVisible(page);
    assert.deepEqual(errors, []);
  },
);

test(
  'new rotation tools activate the real insertion predecessor in the selected loop instance',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import * as core from '@code3d/core';
const base = core.box(40,10,30);
const parts = [0, 35].map(x => core.box(24,16,14).relate(self => [
  self.on(base.up),
  core.rotate(0,0,30),
  core.offset(20+x,0,0),
]));
core.group([base, ...parts]);`;
    await setSource(page, source, 'offset');
    await focusSource(page, 'self.on');
    const contextId = await page.evaluate(() => {
      const app = window.coordinateApp;
      const scope = app.viewport.sourceContext!;
      const contextId = scope.target.evaluations[1].contextId;
      if (!app.selectCompiledEvaluationContext(contextId, false))
        throw new Error('Cannot select second loop instance');
      return contextId;
    });
    const poses = () =>
      page.evaluate(() => {
        const viewport = window.coordinateApp.viewport;
        return viewport['renderedOccurrences']().map(occurrence => {
          occurrence.object.updateWorldMatrix(true, false);
          return [
            occurrence.node.nodeId,
            occurrence.object.matrixWorld.toArray(),
          ];
        });
      });
    const finalPoses = await poses();
    await focusSource(page, 'rotate(0,0,30)');
    const beforeInsertion = await poses();
    assert.notDeepEqual(beforeInsertion, finalPoses);
    await focusSource(page, 'rotate(0,0,30)', 'rotate(0,0,30)'.length);
    const original = (await state(page)).source;
    const revision = await page.evaluate(() =>
      window.coordinateApp.codeEditor.sourceVersion(),
    );
    await page
      .getByRole('button', {name: 'Rotation tools', exact: true})
      .click();
    await page
      .getByRole('menuitemradio', {name: 'Rotate about axis', exact: true})
      .click();
    assert.deepEqual(
      await poses(),
      beforeInsertion,
      'All instances show the insertion prefix, excluding the later offset',
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        return {
          contextId: viewport.sourceContext?.evaluation.contextId,
          tool: viewport.positionTools.tool,
          method: viewport.sourceContext?.target.tool?.signature.name,
          revision: codeEditor.sourceVersion(),
        };
      }),
      {contextId, tool: 'rotate-axis', method: undefined, revision},
    );
    const marks = await sourceMarks(page);
    assert.equal(marks.focused, false);
    assert.deepEqual(marks.word, []);
    assert.deepEqual(marks.caret, [original.indexOf('core.offset(20+x')]);
    assert.deepEqual(
      marks.tool,
      [],
      'The predecessor is not an authored axis rotation',
    );
    assert.equal((await state(page)).source, original);
    await selectAxisEdge(page);
    await page.waitForFunction(() => {
      const {previewState, codeEditor} = window.coordinateApp;
      return (
        codeEditor.editor.getValue().includes('core.axisEdge(') &&
        previewState.sourceVersion === codeEditor.sourceVersion()
      );
    });
    const changed = (await state(page)).source;
    assert.match(
      changed,
      /core\.rotate\(0,0,30\),\s*core\.axisEdge\([^)]+\)\.rotate\(0\),\s*core\.offset\(20\+x,0,0\)/,
    );
    assert.deepEqual((await sourceMarks(page)).word, ['axisEdge']);
    assert.equal(
      await page.evaluate(
        () => window.coordinateApp.viewport.sourceContext?.evaluation.contextId,
      ),
      contextId,
    );
    assert.deepEqual(errors, []);
  },
);

{
  for (const axisFirst of [false, true]) {
    test(
      `toolbar activates adjacent rotation families (axis first ${axisFirst})`,
      {timeout: 90_000},
      async t => {
        const {page, errors} = await openApp(t);
        const point = 'pivotVertex(1).rotate(10,20,30)';
        const axis = 'axisEdge(1).rotate(25)';
        const rotations = axisFirst ? [axis, point] : [point, axis];
        const expression = `[self.on(base.up), ${rotations.map(value => `core.${value}`).join(', ')}, core.offset(8,0,0)]`;
        const source = `import * as core from '@code3d/core';
const base=core.box(40,10,30);
const parts=[0,1].map(i=>core.box(24+i,16,14).relate(self=>${expression}));
core.group([base,...parts]);`;
        await setSource(page, source, 'box');
        await focusSource(page, 'self.on');
        const contextId = await page.evaluate(() => {
          const app = window.coordinateApp;
          const id =
            app.viewport.sourceContext!.target.evaluations[1].contextId;
          if (!app.selectCompiledEvaluationContext(id, false))
            throw new Error('Missing loop context');
          return id;
        });
        for (const tool of ['rotate-point', 'rotate-axis'] as const) {
          const requested = tool === 'rotate-point' ? point : axis;
          if (rotations[0] === requested) await focusSource(page, 'self.on');
          else {
            const preceding = rotations[0];
            await focusSource(page, preceding, preceding.length);
          }
          const name =
            tool === 'rotate-point'
              ? 'Rotate about point'
              : 'Rotate about axis';
          const button = page.getByRole('button', {name, exact: true});
          if (await button.count()) await button.click();
          else {
            await page
              .getByRole('button', {name: 'Rotation tools', exact: true})
              .click();
            await page.getByRole('menuitemradio', {name, exact: true}).click();
          }
          const picked = await page.evaluate(() => {
            const {viewport, codeEditor} = window.coordinateApp;
            const scope = viewport.sourceContext!;
            const binding = viewport.positionTools.rotationBinding!;
            return {
              contextId: scope.evaluation.contextId,
              tool: viewport.positionTools.tool,
              axisOnly: !!scope.evaluation.relationSpatial?.spatial.axisOnly,
              bindingAxisOnly: !!binding.spatial.objects[0].spatial.axisOnly,
              picker: viewport['topologySelection']?.kind,
              cursor: codeEditor.editor
                .getModel()!
                .getOffsetAt(codeEditor.editor.getPosition()!),
              source: codeEditor.editor.getValue(),
            };
          });
          assert.equal(picked.contextId, contextId);
          assert.equal(picked.tool, tool);
          assert.equal(
            picked.axisOnly,
            tool === 'rotate-axis',
            JSON.stringify(picked),
          );
          assert.equal(
            picked.bindingAxisOnly,
            tool === 'rotate-axis',
            JSON.stringify(picked),
          );
          assert.equal(
            picked.picker,
            tool === 'rotate-axis' ? 'edge' : 'vertex',
          );
          const call =
            tool === 'rotate-axis' ? 'rotate(25)' : 'rotate(10,20,30)';
          assert.equal(
            picked.cursor,
            picked.source.indexOf(call) + call.length,
          );
          assert.ok(
            (await sourceMarks(page)).tool[0].includes(
              tool === 'rotate-axis' ? 'axisEdge(1)' : 'pivotVertex(1)',
            ),
          );
          assert.deepEqual((await sourceMarks(page)).word, []);
        }
        assert.deepEqual(errors, []);
      },
    );
  }
}

test(
  'new tools put the caret in the array insertion gap with or without a trailing comma',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    for (const array of [
      '[]',
      '[core.offset(3,0,0)]',
      '[core.offset(3,0,0),]',
      '[core.offset(3,0,0),\n]',
    ]) {
      const source = `import * as core from '@code3d/core';\nconst part=core.box(24,16,14).relate(self=>${array});\npart;`;
      await setSource(page, source, 'box');
      await focusSource(
        page,
        array === '[]' ? '[]' : 'offset(3',
        array === '[]' ? 1 : 2,
      );
      const original = (await state(page)).source;
      await page
        .getByRole('button', {name: 'Rotate about point', exact: true})
        .click();
      const marks = await sourceMarks(page);
      assert.equal(marks.focused, false);
      assert.deepEqual(marks.word, [], JSON.stringify({array, marks}));
      assert.deepEqual(marks.tool, []);
      assert.deepEqual(marks.caret, [original.indexOf(']')]);
      assert.equal((await state(page)).source, original);
      assert.deepEqual(
        await page.evaluate(() => {
          const {viewport} = window.coordinateApp;
          return {
            gap: !!viewport.sourceContext?.target.relationArray,
            tool: viewport.positionTools.tool,
            position:
              viewport.getSelected()!.node.compositionTransform.position,
          };
        }),
        {
          gap: true,
          tool: 'rotate-point',
          position: array === '[]' ? [0, 0, 0] : [3, 0, 0],
        },
      );
      await page.evaluate(() => window.coordinateApp.runModel());
      assert.equal(
        await page.evaluate(
          () =>
            !!window.coordinateApp.viewport.sourceContext?.target.relationArray,
        ),
        true,
        'Recompilation retains insertion intent at the shared expression boundary',
      );
      const handle = await rotationHandle(page, 0);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      assert.equal((await state(page)).active, true);
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    assert.deepEqual(errors, []);
  },
);

test(
  'expression boundaries activate self or the complete authored tool',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import * as core from '@code3d/core';
const base=core.box(40,10,30);
const part=core.box(24,16,14).relate(self=>[
  self.axis.align(base.axis),
  core.offset(3,0,0),
  core.axisEdge(1).rotate(25)]);
core.group([base,part]);`;
    await setSource(page, source, 'box');
    const original = (await state(page)).source;
    for (const tool of ['translate', 'rotate-axis'] as const) {
      await focusSource(page, 'self.axis.align', 0);
      await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            !!window.coordinateApp.viewport.sourceContext?.target.relationArray,
        ),
        false,
      );
      if (tool === 'translate')
        await page
          .getByRole('button', {name: 'Translate', exact: true})
          .click();
      else {
        await focusSource(page, 'offset(3,0,0)', 'offset(3,0,0)'.length);
        await page
          .getByRole('button', {name: 'Rotation tools', exact: true})
          .click();
        await page
          .getByRole('menuitemradio', {name: 'Rotate about axis', exact: true})
          .click();
      }
      const call =
        tool === 'translate' ? 'offset(3,0,0)' : 'axisEdge(1).rotate(25)';
      for (const recompile of [false, true]) {
        if (recompile)
          await page.evaluate(() => window.coordinateApp.runModel());
        const marks = await sourceMarks(page);
        assert.deepEqual(marks.caret, [original.indexOf(call) + call.length]);
        assert.ok(marks.tool.includes(call));
        assert.deepEqual(marks.word, []);
        const context = await page.evaluate(() => {
          const {viewport} = window.coordinateApp;
          return {
            gap: !!viewport.sourceContext?.target.relationArray,
            method: viewport.sourceContext?.target.tool?.signature.name,
            tool: viewport.positionTools.tool,
            axes: viewport.positionTools['axes'].length,
            panel: document.querySelector('.contextual-tool-panel')
              ?.textContent,
          };
        });
        assert.equal(context.gap, false);
        assert.equal(
          context.method,
          tool === 'translate' ? 'offset' : 'rotate',
        );
        assert.equal(context.tool, tool);
        assert.ok(context.axes > 0, JSON.stringify(context));
      }
    }
    assert.equal((await state(page)).source, original);
    assert.deepEqual(errors, []);
  },
);

test(
  'toolbar activates the adjacent axis rotation from an offset expression end',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {rotate, pivot, pivotVertex, pivotPoint, axisLine, box, group, offset, axisEdge} from '@code3d/core';
const base=box(32,14,24);
const cover = box(32, 3, 24)
  .material('#d8ff3e')
  .relate(self => [
    self.axis.align(base.axis),
    self.on(base.up),
    offset(0, 0, 10.5),
    axisEdge(10).rotate(61),
    offset(0, 0, -11),
  ]);
group([base,cover]);`;
    await page.evaluate(source => {
      const app = window.coordinateApp;
      app.codeEditor.editor.getModel()!.setValue(source);
      return app.runModel();
    }, source);
    await page.evaluate(() => window.coordinateApp.viewport.fit());
    await focusSource(page, 'offset(0, 0, 10.5)', 'offset(0, 0, 10.5)'.length);
    await page
      .getByRole('button', {name: 'Rotation tools', exact: true})
      .click();
    await page
      .getByRole('menuitemradio', {name: 'Rotate about axis', exact: true})
      .click();
    const original = (await state(page)).source;
    const call = 'axisEdge(10).rotate(61)';
    for (const recompile of [false, true]) {
      if (recompile) await page.evaluate(() => window.coordinateApp.runModel());
      const marks = await sourceMarks(page);
      assert.deepEqual(marks.caret, [original.indexOf(call) + call.length]);
      assert.deepEqual(marks.tool, [call]);
      assert.equal(
        await page.evaluate(
          () =>
            window.coordinateApp.viewport.positionTools.rotationBinding?.value,
        ),
        61,
      );
    }
    const axis = await page.evaluate(
      () => window.coordinateApp.viewport.positionTools.rotationBinding!.axis,
    );
    const handle = await rotationHandle(page, ['x', 'y', 'z'].indexOf(axis));
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    assert.equal((await state(page)).active, true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal((await state(page)).source, original);
    assert.deepEqual(errors, []);
  },
);

test(
  'toolbar does not skip a mismatched transformation and inserts before it',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import * as core from '@code3d/core';
const base=core.box(32,14,24);
const cover=core.box(32,3,24).relate(self=>[
 self.axis.align(base.axis),self.on(base.up),
 core.offset(0,0,10.5),
 core.pivotVertex(1).rotate(0,0,20),
 core.axisEdge(10).rotate(61),
 core.offset(0,0,-11),
]); core.group([base,cover]);`;
    await setSource(page, source, 'offset');
    await focusSource(page, 'offset(0,0,10.5)', 'offset(0,0,10.5)'.length);
    await page
      .getByRole('button', {name: 'Rotation tools', exact: true})
      .click();
    await page
      .getByRole('menuitemradio', {name: 'Rotate about axis', exact: true})
      .click();
    const original = (await state(page)).source;
    assert.deepEqual((await sourceMarks(page)).tool, []);
    assert.deepEqual((await sourceMarks(page)).caret, [
      original.indexOf('core.pivotVertex(1)'),
    ]);
    assert.equal(
      await page.evaluate(
        () =>
          !!window.coordinateApp.viewport.sourceContext?.target.relationArray,
      ),
      true,
    );
    await selectAxisEdge(page);
    await page.waitForFunction(() => {
      const {codeEditor, previewState} = window.coordinateApp;
      return (
        (codeEditor.editor.getValue().match(/axisEdge\(/g)?.length ?? 0) ===
          2 && previewState.sourceVersion === codeEditor.sourceVersion()
      );
    });
    const changed = (await state(page)).source;
    assert.match(
      changed,
      /offset\(0,0,10\.5\),\s*core\.axisEdge\([^)]+\)\.rotate\(0\),\s*core\.pivotVertex\(1\)\.rotate\(0,0,20\),\s*core\.axisEdge\(10\)\.rotate\(61\)/,
    );
    await page.evaluate(() =>
      window.coordinateApp.codeEditor.runHistoryAction('undo'),
    );
    await page.waitForFunction(() => {
      const {codeEditor, previewState} = window.coordinateApp;
      return previewState.sourceVersion === codeEditor.sourceVersion();
    });
    assert.equal((await state(page)).source, original);
    assert.deepEqual(errors, []);
  },
);

for (const [expression, tool, parameter] of [
  ['offset(3, 0, 0)', 'offset', 'x'],
  ['rotate(0, 0, 20)', 'rotate', 'z'],
  ['pivot().rotate(0, 0, 20)', 'rotate', 'pivot.x'],
  ['pivotVertex()', 'pivotVertex', 'x'],
  ['axisEdge()', 'axisEdge', 'angle'],
] as const) {
  test(
    `single relate return keeps the ${expression} panel and edits its own call`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import * as core from '@code3d/core';
const part = core.box(24, 16, 14).relate(self => core.${expression});
export default part;`;
      await page.evaluate(
        ({source, expression}) => {
          const editor = window.coordinateApp.codeEditor.editor;
          editor.setValue(source);
          editor.setPosition(
            editor.getModel()!.getPositionAt(source.indexOf(expression) + 2),
          );
        },
        {source, expression},
      );
      await page.waitForFunction(tool => {
        const {viewport, previewState, codeEditor} = window.coordinateApp;
        return (
          previewState.sourceVersion === codeEditor.sourceVersion() &&
          viewport.sourceContext?.target.tool?.signature.name === tool
        );
      }, tool);
      await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
      const panel = page.locator('.contextual-tool-panel');
      await panel.waitFor();
      const input = panel.locator(`input[data-parameter="${parameter}"]`);
      await input.fill('12');
      await input.press('Enter');
      await page.waitForFunction(source => {
        const {codeEditor} = window.coordinateApp;
        return codeEditor.editor.getValue() !== source;
      }, source);
      assert.equal(await panel.isVisible(), true);
      const edited = await page.evaluate(() =>
        window.coordinateApp.codeEditor.editor.getValue(),
      );
      assert.match(edited, /12/);
      assert.doesNotMatch(edited, /self\s*=>\s*\[/);
      if (expression === 'pivotVertex()' || expression === 'axisEdge()')
        assert.match(edited, /\.rotate\(/);
      await page.evaluate(() =>
        window.coordinateApp.codeEditor.runHistoryAction('undo'),
      );
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      assert.deepEqual(errors, []);
    },
  );
}

for (const entry of ['self', 'relate', 'self.axis', 'base.axis'] as const) {
  test(
    `single align ${entry} exposes spatial tools and wraps its return when edited`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import {box, group} from '@code3d/core';
const base = box(32, 14, 24);
const cover = box(32, 3, 24)
  .material('#d8ff3e')
  .relate(self => self.axis.align(base.axis));
export default group([base, cover]);`;
      await page.evaluate(
        ({source, entry}) => {
          const editor = window.coordinateApp.codeEditor.editor;
          editor.setValue(source);
          const at =
            entry === 'relate'
              ? source.indexOf('relate(') + 3
              : source.indexOf(entry === 'self' ? 'self.axis' : entry) +
                entry.length;
          editor.setPosition(editor.getModel()!.getPositionAt(at));
        },
        {source, entry},
      );
      await page.waitForFunction(
        () =>
          window.coordinateApp.previewState.sourceVersion ===
          window.coordinateApp.codeEditor.sourceVersion(),
      );
      await page.getByRole('toolbar', {name: 'Position tools'}).waitFor();
      assert.equal(
        await page.locator('.spatial-toolbar [aria-pressed="true"]').count(),
        0,
      );
      await page.getByRole('button', {name: 'Translate', exact: true}).click();
      await page.waitForFunction(
        () => window.coordinateApp.viewport.positionTools.tool === 'translate',
      );
      await page.evaluate(() => window.coordinateApp.viewport.fit());
      await cameraIdle(page);
      const handle = await xHandle(page);
      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.dx * 35,
        handle.y + handle.dy * 35,
        {steps: 5},
      );
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport.sourceContext?.target.tool?.signature
            .name === 'offset',
      );
      await page
        .locator('.contextual-tool-panel input[data-parameter="x"]')
        .waitFor();
      const edited = await page.evaluate(() =>
        window.coordinateApp.codeEditor.editor.getValue(),
      );
      assert.match(
        edited,
        /self\s*=>\s*\[self\.axis\.align\(base\.axis\),\s*offset\(/,
      );
      await page.waitForFunction(() => !window.coordinateApp.previewState.busy);
      await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(
        source => window.coordinateApp.codeEditor.editor.getValue() === source,
        source,
      );
      assert.deepEqual(errors, []);
    },
  );
}

test(
  'toolbar stays available across a relate body while expression panels and references keep focus',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {box, group, offset, rotate} from '@code3d/core';
const base = box(32, 14, 24);
const cover = box(32, 3, 24).relate(self => {
  const reference = box(4, 4, 4).relate(inner => inner.on(base.up));
  return [self.axis.align(base.axis), self.on(reference.up), offset(3, 0, 0), rotate(0, 0, 20)];
});
export default group([base, cover]);`;
    await page.evaluate(source => {
      const editor = window.coordinateApp.codeEditor.editor;
      editor.setValue(source);
      editor.setPosition(
        editor.getModel()!.getPositionAt(source.indexOf('self.axis') + 9),
      );
    }, source);
    await page.waitForFunction(() => {
      const {codeEditor, previewState} = window.coordinateApp;
      return previewState.sourceVersion === codeEditor.sourceVersion();
    });
    const missing = await page.evaluate(source => {
      const {codeEditor, viewport} = window.coordinateApp;
      const editor = codeEditor.editor;
      const missing: object[] = [];
      for (
        let at = source.indexOf('relate(');
        at <= source.indexOf('\n});') + 3;
        at++
      ) {
        editor.setPosition(editor.getModel()!.getPositionAt(at));
        const toolbar =
          document.querySelector<HTMLElement>('.spatial-toolbar')!;
        if (toolbar.hidden || viewport.availablePositionTools.length !== 3) {
          missing.push({
            at,
            near: source.slice(at - 10, at) + '|' + source.slice(at, at + 15),
            target: viewport.sourceContext?.target.id,
          });
        }
      }
      return missing;
    }, source);
    assert.deepEqual(missing, []);
    for (const focus of ['self.axis', 'base.axis', 'box(4, 4, 4)']) {
      await page.evaluate(focus => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.setPosition(
          editor
            .getModel()!
            .getPositionAt(editor.getValue().indexOf(focus) + focus.length - 1),
        );
      }, focus);
      if (focus.startsWith('box')) {
        await page.locator('.contextual-tool-panel input').first().waitFor();
        assert.equal(
          await page.evaluate(
            () =>
              window.coordinateApp.viewport.sourceContext?.target.tool
                ?.signature.name,
          ),
          'box',
        );
      } else {
        assert.equal(
          await page.evaluate(
            () =>
              window.coordinateApp.viewport.sourceContext?.evaluation
                .constraintFocus,
          ),
          focus === 'base.axis' ? 'target' : 'source',
        );
      }
      assert.equal(
        await page.locator('.spatial-toolbar [aria-pressed="true"]').count(),
        0,
      );
      await page.getByRole('button', {name: 'Translate', exact: true}).click();
      await page.waitForFunction(
        () =>
          window.coordinateApp.viewport.sourceContext?.target.tool?.signature
            .name === 'offset',
      );
      const state = await page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        return {
          source: codeEditor.editor.getValue(),
          selected: viewport.getSelected()?.node.nodeId,
          owner: viewport.sourceContext?.evaluation.relationOwnerNodeId,
          tool: viewport.positionTools.tool,
        };
      });
      assert.equal(state.source, source);
      assert.equal(state.selected, state.owner);
      assert.equal(state.tool, 'translate');
    }
    await page.screenshot({path: '/tmp/code3d-relate-full-toolbar.png'});
    assert.deepEqual(errors, []);
  },
);

test(
  'toolbar navigation from an inner expression preserves the selected relation instance',
  {timeout: 90_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {box, group, offset} from '@code3d/core';
const covers = [0, 10].map(x => box(8, 2, 6).relate(self => {
  const reference = box(4, 4, 4).originOffset(x, 0, 0);
  return [self.on(reference.up), offset(3, 0, 0)];
})); export default group(covers);`;
    await setSource(page, source, 'originOffset');
    const instances = await page.evaluate(() => {
      const {viewport, previewState} = window.coordinateApp;
      return viewport.sourceContext!.target.evaluations.map(evaluation => ({
        targetId: viewport.sourceContext!.target.id,
        nodeId: previewState.module!.operations.get(evaluation.operationId!)!
          .outputNodeId,
      }));
    });
    assert.equal(instances.length, 2);
    for (const instance of instances) {
      await focusSource(page, 'originOffset');
      const expected = await page.evaluate(({targetId, nodeId}) => {
        const {viewport, previewState} = window.coordinateApp;
        viewport['selectSourceTarget'](targetId, nodeId);
        return [...previewState.module!.objects.values()].find(
          node =>
            node.transformations?.length &&
            node.constraints.some(
              constraint => constraint.target.nodeId === nodeId,
            ),
        )!.nodeId;
      }, instance);
      await page.getByRole('button', {name: 'Translate', exact: true}).click();
      const actual = await page.evaluate(() => ({
        tool: window.coordinateApp.viewport.sourceContext?.target.tool
          ?.signature.name,
        owner:
          window.coordinateApp.viewport.sourceContext?.evaluation
            .relationOwnerNodeId,
        selected: window.coordinateApp.viewport.getSelected()?.node.nodeId,
      }));
      assert.equal(actual.tool, 'offset');
      assert.equal(actual.owner, expected);
      assert.equal(actual.selected, expected);
    }
    assert.deepEqual(errors, []);
  },
);

for (const body of [
  '[]',
  '[self.on(base.up), core.offset(7, 0, 0), core.rotate(0, 0, 30)]',
]) {
  test(
    `relate result activates the ${body === '[]' ? 'empty insertion' : 'first matching transformation'}`,
    {timeout: 90_000},
    async t => {
      const {page, errors} = await openApp(t);
      const source = `import * as core from '@code3d/core'; const base = core.box(32,14,24); const cover = core.box(32,3,24).relate(self => ${body}); export default core.group([base,cover]);`;
      await page.evaluate(source => {
        const editor = window.coordinateApp.codeEditor.editor;
        editor.setValue(source);
        editor.setPosition(
          editor.getModel()!.getPositionAt(source.indexOf('relate(') + 2),
        );
      }, source);
      await page.waitForFunction(
        () =>
          window.coordinateApp.previewState.sourceVersion ===
          window.coordinateApp.codeEditor.sourceVersion(),
      );
      await page.getByRole('button', {name: 'Translate', exact: true}).click();
      await page.waitForFunction(
        () => window.coordinateApp.viewport.positionTools.tool === 'translate',
      );
      const target = await page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        return {
          source: codeEditor.editor.getValue(),
          array: !!viewport.sourceContext?.target.relationArray,
          tool: viewport.sourceContext?.target.tool?.signature.name,
        };
      });
      assert.equal(target.source, source);
      if (body === '[]') assert.equal(target.array, true);
      else {
        assert.equal(target.tool, 'offset');
        await page
          .locator('.contextual-tool-panel input[data-parameter="x"]')
          .waitFor();
      }
      assert.deepEqual(errors, []);
    },
  );
}

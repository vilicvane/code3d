import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';

declare const window: Window & {
  inputTest: {
    animation: import('../../src/model/animation.ts').ModelAnimation;
    inputs: import('../../src/model/inputs.ts').ModelInputs;
    editor: import('../../src/editor.ts').CodeEditor;
    preview: import('../../src/model/preview-state.ts').ModelPreviewState;
  };
};

test(
  'inputs update geometry while focused and dragging, coalesce rapid changes and preserve controls',
  {timeout: 120_000},
  async t => {
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1400, height: 900},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[MobX\]|reaction.*error/i.test(message.text()))
        errors.push(message.text());
    });
    const source =
      (await readFile(
        new URL('../../examples/inputs.ts', import.meta.url),
        'utf8',
      )) +
      "\nawait new Promise(resolve => setTimeout(resolve, 80));\nif (width === 99) throw new Error('Unavailable width');\n";
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify({
          files: [
            {path: '/model.ts', source},
            {
              path: '/other.ts',
              source:
                "import {box} from '@code3d/core'; export default box(8, 8, 8);",
            },
          ],
        })};`,
      }),
    );
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.inputTest = {animation, inputs: modelInputs, editor: codeEditor, preview: previewState};',
      });
    });
    await page.goto(process.env.CODE3D_TEST_URL!);
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    const panel = page.getByRole('complementary', {name: 'Model inputs'});
    const width = panel.getByLabel('Width', {exact: true});
    const height = panel.getByLabel('Height', {exact: true});
    assert.equal(
      await panel.getByRole('button', {name: 'Apply', exact: true}).count(),
      0,
    );
    const reset = panel.getByRole('button', {name: 'Reset inputs'});
    const widthSlider = panel.getByRole('slider', {name: 'Width slider'});
    const heightSlider = panel.getByRole('slider', {name: 'Height slider'});
    const dimensions = () =>
      page.evaluate(() => {
        const vertices =
          window.inputTest.preview.module!.fallback!.mesh!.vertices;
        return [0, 1, 2].map(axis => {
          const values = Array.from(vertices).filter(
            (_, index) => index % 3 === axis,
          );
          return Math.max(...values) - Math.min(...values);
        });
      });
    const waitForWidth = (value: number) =>
      page.waitForFunction(expected => {
        const vertices =
          window.inputTest.preview.module?.fallback?.mesh?.vertices;
        if (!vertices) return false;
        const xs = Array.from(vertices).filter((_, index) => index % 3 === 0);
        return Math.abs(Math.max(...xs) - Math.min(...xs) - expected) < 0.001;
      }, value);
    await page.evaluate(() => {
      const editor = window.inputTest.editor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf("input('Width'") + 2),
      );
      editor.focus();
    });
    await panel.locator('input[name="Width"].source-active').waitFor();
    assert.equal(
      await panel.locator('.dock-panel-handle').getAttribute('aria-expanded'),
      'true',
    );
    assert.equal(
      await page.evaluate(() => window.inputTest.editor.editor.hasTextFocus()),
      true,
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await width.evaluate(input => document.activeElement === input),
      true,
    );
    await page.keyboard.type('52');
    assert.equal(
      await width.inputValue(),
      '52',
      'Tab selects the entire number for replacement',
    );
    await waitForWidth(52);
    assert.equal(
      await width.evaluate(input => document.activeElement === input),
      true,
      'typing updates geometry before blur',
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await height.evaluate(input => document.activeElement === input),
      true,
    );
    await page.keyboard.press('Shift+Tab');
    assert.equal(
      await width.evaluate(input => document.activeElement === input),
      true,
    );
    assert.equal(await widthSlider.inputValue(), '52');
    assert.equal(await width.getAttribute('min'), '4');
    assert.equal(await width.getAttribute('max'), '100');
    assert.equal(await height.getAttribute('step'), '0.5');
    const track = (await widthSlider.boundingBox())!;
    await page.mouse.move(
      track.x + track.width / 2,
      track.y + track.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      track.x + track.width * 0.7,
      track.y + track.height / 2,
      {steps: 6},
    );
    const intermediate = Number(await width.inputValue());
    assert.ok(intermediate > 52 && intermediate < 100);
    await waitForWidth(intermediate);
    assert.equal(
      await widthSlider.evaluate(input => document.activeElement === input),
      true,
    );
    await page.mouse.move(
      track.x + track.width - 2,
      track.y + track.height / 2,
      {steps: 8},
    );
    await waitForWidth(100);
    // Both intermediate and final geometry were observed while the pointer stayed down.
    await page.mouse.up();
    assert.equal(await width.inputValue(), '100');
    assert.equal(await widthSlider.inputValue(), '100');
    assert.deepEqual(
      await dimensions(),
      [100, 16, 24],
      'drag updates the model before release',
    );
    await heightSlider.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await height.inputValue(), '16.5');
    await reset.click();
    await waitForWidth(40);
    assert.equal(await widthSlider.inputValue(), '40');
    assert.equal(await heightSlider.inputValue(), '16');
    // Reset is also a draft command when the model is already at its defaults.
    await width.fill('');
    assert.equal(await width.getAttribute('aria-invalid'), 'true');
    await reset.click();
    assert.equal(await width.inputValue(), '40');
    assert.equal(await widthSlider.inputValue(), '40');
    assert.equal(await width.getAttribute('aria-invalid'), 'false');
    await width.fill('4e1');
    assert.equal(await width.inputValue(), '4e1');
    const sourceMutations = await page.evaluate(async () => {
      const mutations: string[] = [];
      const observer = new MutationObserver(records => {
        mutations.push(...records.map(record => record.attributeName!));
      });
      document.querySelectorAll('#model-inputs input').forEach(control =>
        observer.observe(control, {
          attributes: true,
          attributeFilter: ['min', 'max', 'step', 'value', 'aria-invalid'],
        }),
      );
      const editor = window.inputTest.editor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf("input('Height'") + 2),
      );
      editor.focus();
      await new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      observer.disconnect();
      return mutations;
    });
    assert.deepEqual(
      sourceMutations,
      [],
      'source highlighting does not rewrite form controls',
    );
    assert.equal(
      await width.inputValue(),
      '4e1',
      'source focus preserves the accepted text',
    );
    await reset.click();
    await page.evaluate(() => {
      const editor = window.inputTest.editor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf("input('Height'") + 2),
      );
      editor.focus();
    });
    await panel.locator('input[name="Height"].source-active').waitFor();
    assert.equal(
      await width.evaluate(input => input.classList.contains('source-active')),
      false,
    );
    // Keep the panel pinned while testing form and animation state below.
    await panel.locator('.dock-panel-handle').click();
    assert.equal(await width.inputValue(), '40');
    assert.equal(await height.inputValue(), '16');
    await width.fill('60');
    await height.fill('20');
    await page.waitForFunction(
      () =>
        window.inputTest.preview.module?.inputs.length === 2 &&
        window.inputTest.inputs.values.Height === 20,
    );
    await waitForWidth(60);
    await page.waitForFunction(() => {
      const ys = Array.from(
        window.inputTest.preview.module!.fallback!.mesh!.vertices,
      ).filter((_, i) => i % 3 === 1);
      return Math.abs(Math.max(...ys) - Math.min(...ys) - 20) < 0.001;
    });
    assert.deepEqual(await dimensions(), [60, 20, 24]);
    assert.equal(
      await page.evaluate(() => window.inputTest.editor.editor.getValue()),
      source,
    );

    await width.fill('');
    assert.equal(
      await width.evaluate(input => (input as HTMLInputElement).validity.valid),
      false,
    );
    assert.deepEqual(await dimensions(), [60, 20, 24]);
    await height.fill('21.5');
    await page.waitForFunction(() => {
      const ys = Array.from(
        window.inputTest.preview.module!.fallback!.mesh!.vertices,
      ).filter((_, i) => i % 3 === 1);
      return Math.abs(Math.max(...ys) - Math.min(...ys) - 21.5) < 0.001;
    });
    assert.equal(await width.inputValue(), '');
    await width.fill('-1');
    assert.equal(
      await width.evaluate(
        input => (input as HTMLInputElement).validity.rangeUnderflow,
      ),
      true,
    );
    assert.deepEqual(await dimensions(), [60, 21.5, 24]);
    await height.fill('20.25');
    assert.equal(
      await height.evaluate(
        input => (input as HTMLInputElement).validity.stepMismatch,
      ),
      true,
    );
    await height.fill('20');
    await width.fill('99');
    await page.getByText('Model error', {exact: true}).waitFor();
    assert.equal(await width.inputValue(), '99');
    await reset.click();
    await waitForWidth(40);
    await page.getByText('Ready', {exact: true}).waitFor();
    assert.deepEqual(await dimensions(), [40, 16, 24]);
    assert.equal(await width.inputValue(), '40');

    await page.evaluate(() => {
      const editor = window.inputTest.editor.editor;
      editor.setValue(
        editor
          .getValue()
          .replace('{box, input}', '{box, input, timeOffset}')
          .replace('box(width,', 'box(width + timeOffset(),'),
      );
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().indexOf('box(width') + 4),
      );
    });
    await page.getByRole('button', {name: 'Play animation'}).waitFor();
    await page.getByText('Ready', {exact: true}).waitFor();
    await width.fill('80');
    await waitForWidth(80);
    await width.fill('');
    const originalInput = await width.elementHandle();
    const originalSlider = await widthSlider.elementHandle();
    await page.getByRole('button', {name: 'Play animation'}).click();
    await page.waitForFunction(() => window.inputTest.animation.time > 0.15);
    assert.equal(
      await width.inputValue(),
      '',
      'new frames leave unfinished text intact',
    );
    assert.equal(
      await width.evaluate(
        (node, original) => node === original,
        originalInput,
      ),
      true,
    );
    assert.equal(
      await widthSlider.evaluate(
        (node, original) => node === original,
        originalSlider,
      ),
      true,
    );
    assert.equal(await widthSlider.inputValue(), '80');
    assert.equal(
      await page.evaluate(() => window.inputTest.inputs.fields[0].value),
      80,
    );
    await width.fill('84');
    assert.equal(
      await page.evaluate(() => window.inputTest.animation.playing),
      false,
      'editing pauses playback',
    );
    await page.waitForFunction(() => {
      const xs = Array.from(
        window.inputTest.preview.module!.fallback!.mesh!.vertices,
      ).filter((_, index) => index % 3 === 0);
      return Math.max(...xs) - Math.min(...xs) > 84;
    });
    assert.equal(
      await page.evaluate(() => window.inputTest.inputs.values.Width),
      84,
    );
    assert.ok((await dimensions())[0] > 84);
    assert.equal(
      await width.evaluate(input => document.activeElement === input),
      true,
    );

    await page.evaluate(() => window.inputTest.editor.openFile('/other.ts'));
    await page.waitForFunction(
      () =>
        window.inputTest.preview.file === '/other.ts' &&
        !window.inputTest.preview.busy,
    );
    assert.equal(await panel.isVisible(), false);
    await page.evaluate(() => window.inputTest.editor.openFile('/model.ts'));
    await waitForWidth(40);
    assert.equal(await width.inputValue(), '40');
    assert.equal(await page.evaluate(() => window.inputTest.animation.time), 0);
    await page.evaluate(() => {
      const editor = window.inputTest.editor.editor;
      editor.setValue(
        editor
          .getValue()
          .replace(', {min: 4, max: 100, step: 1}', ', {min: 4}')
          .replace(', {min: 2, max: 60, step: 0.5}', ''),
      );
    });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>(
          'input[type="number"][name="Width"]',
        )?.step === 'any',
    );
    assert.equal(
      await widthSlider.isVisible(),
      false,
      'a one-sided bound has no slider',
    );
    assert.equal(
      await heightSlider.isVisible(),
      false,
      'unbounded fields remain numeric inputs',
    );
    assert.equal(await width.getAttribute('min'), '4');
    assert.equal(await height.getAttribute('min'), '');
    assert.deepEqual(errors, []);
  },
);

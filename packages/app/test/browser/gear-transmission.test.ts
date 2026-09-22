import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from './browser-connection.ts';
import {appIsolationHeaders} from '../../build/response-headers.ts';

declare const window: Window & {
  transmissionTest: {
    preview: import('../../src/model/preview-state.ts').ModelPreviewState;
    codeEditor: import('../../src/editor.ts').CodeEditor;
    viewport: import('../../src/viewport.ts').ModelViewport;
  };
};

test(
  'dragging one external crank drives both compound gear stages before release',
  {timeout: 120_000},
  async t => {
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext({
      viewport: {width: 1500, height: 1000},
    });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (/\[MobX\]|reaction.*error/i.test(message.text()))
        errors.push(message.text());
    });
    const source = await readFile(
      new URL('../../examples/packages/gears/transmission.ts', import.meta.url),
      'utf8',
    );
    await page.route('**/src/project/default-project.ts*', route =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export const defaultProject = ${JSON.stringify({files: [{path: '/model.ts', source}]})};`,
      }),
    );
    await page.route('**/src/main.ts*', async route => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          '\nwindow.transmissionTest = {preview: previewState, codeEditor, viewport};',
      });
    });
    // A cold development package manifest enumerates published dependencies.
    await page.goto(process.env.CODE3D_TEST_URL!, {timeout: 60_000});
    await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
    // The assembly contains only actual parts; its frame is a separate reference.
    for (const [token, focused] of [
      ['inputCrank, ...gears', [0]],
      ['gears, middleShaft', [1, 2, 3, 4]],
      ['middleShaft, outputCrank', [5]],
      ['outputCrank],', [6]],
    ] as const) {
      await page.evaluate(
        ({source, token}) => {
          const editor = window.transmissionTest.codeEditor.editor;
          editor.setPosition(
            editor.getModel()!.getPositionAt(source.lastIndexOf(token) + 1),
          );
        },
        {source, token},
      );
      await page.waitForFunction((focused: readonly number[]) => {
        const {preview, viewport} = window.transmissionTest;
        const scene = viewport['inspectionScene'];
        return (
          !preview.inspecting &&
          (!!preview.inspectionDiagnostic ||
            (scene?.target.length === 7 &&
              scene.target.every(
                (item, index) => !!item.focused === focused.includes(index),
              )))
        );
      }, focused);
      assert.equal(
        await page.evaluate(
          () => window.transmissionTest.preview.inspectionDiagnostic,
        ),
        undefined,
        token,
      );
    }
    await page.evaluate(() => {
      const editor = window.transmissionTest.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(
            editor.getValue().lastIndexOf('frame: base') + 'frame: '.length + 1,
          ),
      );
    });
    await page.waitForFunction(() => {
      const {preview, viewport} = window.transmissionTest;
      const scene = viewport['inspectionScene'];
      return (
        !preview.inspecting &&
        !preview.inspectionDiagnostic &&
        scene?.target.length === 1 &&
        scene.target[0].kind === 'anchor' &&
        scene.target[0].focused &&
        scene.ambient.length === 7
      );
    });
    // Blank source retains the previous scene; select the complete group to
    // restore the assembly view before exercising its input.
    await page.evaluate(() => {
      const editor = window.transmissionTest.codeEditor.editor;
      editor.setPosition(
        editor
          .getModel()!
          .getPositionAt(editor.getValue().lastIndexOf('group(') + 1),
      );
    });
    await page.waitForFunction(() => {
      const {preview, viewport} = window.transmissionTest;
      const scene = viewport['inspectionScene'];
      return (
        !preview.inspecting &&
        !preview.inspectionDiagnostic &&
        scene?.kind === 'preview' &&
        scene.target.length === 1 &&
        scene.target[0].kind === 'model' &&
        scene.target[0].model.children.length === 7
      );
    });
    const panel = page.getByRole('complementary', {name: 'Model inputs'});
    const handle = panel.locator('.dock-panel-handle');
    if ((await handle.getAttribute('aria-expanded')) !== 'true')
      await handle.click();
    const input = panel.getByLabel('Drive angle', {exact: true});
    const slider = panel.getByRole('slider', {name: 'Drive angle slider'});
    const initial = await page.evaluate(() =>
      window.transmissionTest.preview.module!.fallback!.children.map(
        child => child.transform,
      ),
    );
    const waitForAngle = (angle: number) =>
      page.waitForFunction(
        ({angle, initial}) => {
          const nodes =
            window.transmissionTest.preview.module?.fallback?.children;
          if (!nodes || nodes.length !== 7) return false;
          const yaw = (q: readonly number[]) =>
            Math.atan2(
              2 * (q[0] * q[2] + q[3] * q[1]),
              1 - 2 * (q[1] ** 2 + q[2] ** 2),
            );
          return [
            [0, 1],
            [1, 1],
            [2, -2 / 3],
            [3, -2 / 3],
            [4, 0.3],
            [5, -2 / 3],
            [6, 0.3],
          ].every(([index, ratio]) => {
            const expected =
              yaw(initial[index].quaternion) + (angle * ratio * Math.PI) / 180;
            const actual = yaw(nodes[index].transform.quaternion);
            return (
              Math.abs(Math.cos(actual) - Math.cos(expected)) < 1e-5 &&
              Math.abs(Math.sin(actual) - Math.sin(expected)) < 1e-5 &&
              nodes[index].transform.position.every(
                (v, i) => Math.abs(v - initial[index].position[i]) < 1e-5,
              )
            );
          });
        },
        {angle, initial},
      );
    // One input revolution turns the compound train's output by 108°.
    for (const angle of [359, 360, 361, -720]) {
      await input.fill(String(angle));
      await waitForAngle(angle);
      assert.equal(
        await input.evaluate(el => document.activeElement === el),
        true,
      );
    }
    const track = (await slider.boundingBox())!;
    await page.mouse.move(
      track.x + track.width / 2,
      track.y + track.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      track.x + track.width * 0.64,
      track.y + track.height / 2,
      {steps: 5},
    );
    const draggedAngle = Number(await input.inputValue());
    assert.ok(draggedAngle > 0 && draggedAngle < 1080);
    await waitForAngle(draggedAngle);
    assert.equal(
      await slider.evaluate(el => document.activeElement === el),
      true,
    );
    await page.screenshot({path: '/tmp/code3d-231-transmission.png'});
    await page.mouse.up();
    assert.deepEqual(errors, []);
  },
);

test(
  'implicit-self coupling survives Worker source inspection',
  {timeout: 60_000},
  async t => {
    const browser = await chromium.connectOverCDP(
      process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
    );
    t.after(() => browser.close());
    const context = await browser.newContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(
      '/__coupling-inspection-test__',
      process.env.CODE3D_TEST_URL,
    ).href;
    await page.route(url, route =>
      route.fulfill({
        contentType: 'text/html',
        headers: appIsolationHeaders,
        body: '<main></main>',
      }),
    );
    await page.goto(url);
    const results = await page.evaluate(async () => {
      const clientPath = '/src/model/compiler-client.ts';
      const packagesPath = '/src/project/browser-packages.ts';
      const {
        ModelCompilerClient,
      }: typeof import('../../src/model/compiler-client.ts') = await import(
        clientPath
      );
      const {
        browserPackageFiles,
      }: typeof import('../../src/project/browser-packages.ts') = await import(
        packagesPath
      );
      const client = new ModelCompilerClient(browserPackageFiles);
      try {
        const source = `import {axisLine, coupleRotation, box, offset} from '@code3d/core';
const driver = box(4, 3, 2).relate(self => axisLine(self.axis).rotate(725));
export default box(6, 3, 2).relate(self => [
  coupleRotation(driver, {ratio: -0.5}),
  offset(20, 0, 0),
]);`;
        const module = await client.compile(
          {files: [{path: '/model.ts', source}]},
          '/model.ts',
        );
        if (module.diagnostic) throw new Error(module.diagnostic.summary);
        const samples = [];
        for (const token of ['coupleRotation(driver', 'driver,']) {
          const scene = await client.inspect(module, {
            file: '/model.ts',
            offset: source.indexOf(token) + 1,
          });
          if (!scene) throw new Error('Missing coupling inspection');
          samples.push({
            kind: scene.kind,
            token,
            models: scene.target
              .filter(item => item.kind === 'model')
              .flatMap(item =>
                item.model.children.map(child => child.transform),
              ),
            focusedModels: scene.target
              .filter(item => item.kind === 'model')
              .map(item => item.focused),
            anchors: scene.target
              .filter(item => item.kind === 'anchor')
              .map(item => ({
                direction: item.direction,
                kinds: item.elements.map(element => element.kind),
              })),
            ambientCount: scene.ambient.length,
          });
        }
        return samples;
      } finally {
        client.dispose();
      }
    });
    for (const result of results) {
      assert.equal(result.kind, 'inspect');
      // Inspectors intentionally detach placement programs and display their
      // solved stage as child poses. The later offset must not enter this scene.
      assert.equal(result.models.length, 2);
      assert.equal(result.ambientCount, 0);
      assert.deepEqual(result.focusedModels, [
        false,
        result.token === 'driver,',
      ]);
      assert.deepEqual(result.anchors, [
        {direction: 'forward', kinds: ['line']},
        {direction: 'forward', kinds: ['line']},
      ]);
      for (const [index, pose] of result.models.entries()) {
        assert.deepEqual(pose.position, [0, 0, 0]);
        const q = pose.quaternion;
        const expected = ((index === 0 ? -362.5 : 725) * Math.PI) / 180;
        assert.ok(Math.abs(1 - 2 * q[1] ** 2 - Math.cos(expected)) < 1e-7);
        assert.ok(Math.abs(2 * q[1] * q[3] - Math.sin(expected)) < 1e-7);
      }
    }
    assert.deepEqual(errors, []);
  },
);

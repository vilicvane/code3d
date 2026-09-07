import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  navigationApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
};

test(
  'camera freely crosses poles, pans, restores orientation and zooms beyond the old distance limits',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    await setSource(
      page,
      "import {box} from '@code3d/core'; export default box(24, 6, 14).paint('#8ed5d1');",
    );
    await page.evaluate(() => {
      const viewport = window.navigationApp.viewport;
      viewport['camera'].position.set(0, 0, 60);
      viewport['camera'].up.set(0, 1, 0);
      viewport['controls'].focus.set(0, 0, 0);
      viewport['controls'].syncCamera();
    });
    let previous = await cameraState(page);
    const initialDistance = previous.distance;
    const positions = [];
    for (let i = 0; i < 6; i++) {
      await rotate(page);
      const current = await cameraState(page);
      assert.ok(
        Math.abs(
          current.quaternion.reduce(
            (sum, v, axis) => sum + v * previous.quaternion[axis],
            0,
          ),
        ) < 0.95,
        'Every drag must continue turning past the poles',
      );
      near(current.distance, initialDistance);
      positions.push(current);
      previous = current;
    }
    assert.ok(
      positions.some(state => state.up[1] < -0.5),
      'The camera must turn upside down',
    );
    assert.ok(
      positions.some(state => state.position[2] < -10),
      'The camera must pass behind its original view',
    );
    assert.ok(positions.some(state => state.position[1] > 10));
    assert.ok(positions.some(state => state.position[1] < -10));

    const rect = await canvasRect(page);
    await page.mouse.move(
      rect.x + rect.width * 0.8,
      rect.y + rect.height * 0.65,
    );
    await page.mouse.down({button: 'right'});
    await page.mouse.move(
      rect.x + rect.width * 0.8 + 60,
      rect.y + rect.height * 0.65 + 30,
      {steps: 5},
    );
    await page.mouse.up({button: 'right'});
    const panned = await cameraState(page);
    assert.ok(
      Math.hypot(...panned.target.map((v, i) => v - previous.target[i])) > 1,
    );
    near(panned.distance, previous.distance);
    panned.up.forEach((v, i) => near(v, previous.up[i]));

    // Completion previews can temporarily change the camera, including its up vector.
    const restored = await page.evaluate(() => {
      const viewport = window.navigationApp.viewport;
      viewport['captureTransientPreviewRestore']();
      viewport['camera'].up.set(0, 1, 0);
      viewport['camera'].position.set(100, 100, 100);
      viewport['controls'].syncCamera();
      viewport.restoreTransientPreview();
      return {
        position: viewport['camera'].position.toArray(),
        up: viewport['camera'].up.toArray(),
      };
    });
    restored.position.forEach((v, i) => near(v, panned.position[i]));
    restored.up.forEach((v, i) => near(v, panned.up[i]));

    await page.setViewportSize({width: 1100, height: 700});
    await page.waitForFunction(() => {
      const viewport = window.navigationApp.viewport;
      const canvas = viewport['renderer'].domElement;
      return (
        Math.abs(
          viewport['camera'].aspect - canvas.clientWidth / canvas.clientHeight,
        ) < 1e-6
      );
    });
    await rotate(page);
    const resized = await cameraState(page);
    assert.ok(
      Math.abs(
        resized.quaternion.reduce(
          (sum, v, i) => sum + v * panned.quaternion[i],
          0,
        ),
      ) < 0.95,
    );

    await setSource(
      page,
      "import {box} from '@code3d/core'; export default box(0.02, 0.04, 0.06).paint('#8ed5d1');",
    );
    await page.evaluate(() => window.navigationApp.viewport.fit());
    const fitted = await cameraState(page);
    assert.ok(
      fitted.distance < 0.2,
      'Fitting small geometry must not impose a fixed distance floor',
    );
    await zoomUntil(page, -1200, distance => distance < 0.09);
    const close = await cameraState(page);
    assert.ok(close.distance < 0.09 && close.distance > 0);
    assert.ok(close.near < 0.001);
    if (process.env.CODE3D_CAMERA_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_CAMERA_SCREENSHOT});
    await zoomUntil(page, 1600, distance => distance > 2000);
    const distant = await cameraState(page);
    assert.ok(distant.distance > 2000);
    assert.ok(distant.far > distant.distance);
    assert.ok(
      distant.fogNear > distant.distance,
      'Distance fog must not hide the focused model',
    );
    assert.ok(
      [...distant.position, ...distant.quaternion].every(Number.isFinite),
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'cursor zoom preserves its anchor and Arcball keeps a stable focus through framing and tool pauses',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    await setSource(
      page,
      "import {box} from '@code3d/core'; export default box(24, 6, 14).paint('#8ed5d1');",
    );
    await rotate(page);
    const before = await cameraState(page);
    const rect = await canvasRect(page);
    const cursor = {
      x: Math.round(rect.x + rect.width * 0.7),
      y: Math.round(rect.y + rect.height * 0.6),
    };
    const anchor = await page.evaluate(({x, y}) => {
      const viewport = window.navigationApp.viewport;
      const camera = viewport['camera'];
      const rect = viewport['renderer'].domElement.getBoundingClientRect();
      camera.updateMatrixWorld();
      const direction = camera.position
        .clone()
        .set(
          ((x - rect.x) / rect.width) * 2 - 1,
          1 - ((y - rect.y) / rect.height) * 2,
          0,
        )
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      const normal = camera.getWorldDirection(camera.position.clone());
      const depth = viewport['controls'].focus
        .clone()
        .sub(camera.position)
        .dot(normal);
      return camera.position
        .clone()
        .addScaledVector(direction, depth / direction.dot(normal))
        .toArray();
    }, cursor);
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.wheel(0, -250);
    await page.waitForFunction(distance => {
      const viewport = window.navigationApp.viewport;
      return (
        viewport['camera'].position.distanceTo(viewport['controls'].focus) <
        distance * 0.9
      );
    }, before.distance);
    const zoomed = await cameraState(page);
    assert.ok(
      Math.hypot(...zoomed.target.map((v, i) => v - before.target[i])) > 1,
    );
    const projected = await page.evaluate(anchor => {
      const viewport = window.navigationApp.viewport;
      const camera = viewport['camera'];
      camera.updateMatrixWorld();
      const p = camera.position.clone().fromArray(anchor).project(camera);
      const rect = viewport['renderer'].domElement.getBoundingClientRect();
      return {
        x: rect.x + ((p.x + 1) / 2) * rect.width,
        y: rect.y + ((1 - p.y) / 2) * rect.height,
      };
    }, anchor);
    near(projected.x, cursor.x);
    near(projected.y, cursor.y);

    await page.mouse.wheel(0, 250);
    await page.waitForFunction(distance => {
      const viewport = window.navigationApp.viewport;
      return (
        Math.abs(
          viewport['camera'].position.distanceTo(viewport['controls'].focus) -
            distance,
        ) < 1e-6
      );
    }, before.distance);
    const returned = await cameraState(page);
    returned.position.forEach((v, i) => near(v, before.position[i]));
    returned.target.forEach((v, i) => near(v, before.target[i]));

    await page.mouse.move(100, 300); // Editor: wheel input must not navigate the viewport.
    await page.mouse.wheel(0, -500);
    await settleAnimation(page);
    assert.deepEqual(await cameraState(page), returned);

    // A gesture returning to its start restores orientation before release inertia.
    const center = {
      x: rect.x + rect.width * 0.5,
      y: rect.y + rect.height * 0.5,
    };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 100, center.y - 80, {steps: 6});
    await page.mouse.move(center.x, center.y, {steps: 6});
    const looped = await cameraState(page);
    looped.quaternion.forEach((v, i) => near(v, returned.quaternion[i]));
    // Pause in the same event as release, before Arcball's first inertia frame.
    await page.evaluate(() =>
      window.addEventListener(
        'pointerup',
        () =>
          window.navigationApp.viewport['controls'].setNavigationEnabled(false),
        {once: true},
      ),
    );
    await page.mouse.up();
    const paused = await cameraState(page);
    await settleAnimation(page);
    assert.deepEqual(await cameraState(page), paused);
    await page.evaluate(() =>
      window.navigationApp.viewport['controls'].setNavigationEnabled(true),
    );

    await page.evaluate(() => window.navigationApp.viewport.fit());
    const framed = await cameraState(page);
    await rotate(page);
    const turned = await cameraState(page);
    near(turned.distance, framed.distance);
    turned.target.forEach((v, i) => near(v, framed.target[i]));
    if (process.env.CODE3D_CAMERA_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_CAMERA_SCREENSHOT});
    assert.deepEqual(errors, []);
  },
);

test(
  'coordinate indicator selects six local views, flips the facing axis and resets the view without editing the model',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    const source =
      "import {box} from '@code3d/core'; export default box(24, 6, 14).paint('#8ed5d1');";
    await setSource(page, source);
    const initial = await cameraState(page);
    // An occurrence's local frame can differ from world axes inside an assembly.
    const frame = await page.evaluate(() => {
      const viewport = window.navigationApp.viewport;
      const occurrence = viewport.getSelected()!;
      occurrence.object.rotation.set(0.3, 0.5, 0.2);
      occurrence.object.updateWorldMatrix(true, true);
      const quaternion = viewport['camera'].quaternion.clone();
      occurrence.object.getWorldQuaternion(quaternion);
      viewport['controls'].focus.set(3, 4, 5);
      viewport['controls'].syncCamera();
      return quaternion.toArray();
    });
    const before = await cameraState(page);
    const indicator = page.locator('.viewport-coordinate-reference');
    const rect = (await indicator.boundingBox())!;
    const background = {x: rect.x + 19, y: rect.y + 19};
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const sign of [1, -1]) {
        // Reset to an oblique view where both ends have distinct hit targets.
        await page.mouse.dblclick(background.x, background.y);
        await waitForViewTransition(page);
        const framed = await cameraState(page);
        const end = indicator.locator(
          `[data-axis="${axis}"][data-direction="${sign === 1 ? 'positive' : 'negative'}"]`,
        );
        const hit = end.locator('.viewport-coordinate-hit-area');
        await hit.click();
        await assertLocalView(page, axis, sign, frame);
        const aligned = await cameraState(page);
        near(aligned.distance, framed.distance);
        aligned.target.forEach((v, i) => near(v, framed.target[i]));
        // The projected front/back endpoints coincide: clicking the front flips.
        const center = {x: rect.x + 44, y: rect.y + 44};
        await page.mouse.click(center.x, center.y);
        await assertLocalView(page, axis, -sign, frame);
      }
    }

    // Keyboard users can choose a direction even when its endpoint is behind another.
    const positiveY = indicator.getByRole('button', {
      name: 'View from +Y',
      exact: true,
    });
    await positiveY.focus();
    await positiveY.press('Enter');
    await assertLocalView(page, 'y', 1, frame);
    await positiveY.press('Space');
    await assertLocalView(page, 'y', -1, frame);

    // Double-click directly on an endpoint as well as the background.
    await page.mouse.dblclick(rect.x + 44, rect.y + 44);
    await waitForViewTransition(page);
    const reset = await cameraState(page);
    const expectedDirection = await page.evaluate(
      ({initial, frame}) => {
        const camera = window.navigationApp.viewport['camera'];
        return camera.position
          .clone()
          .fromArray(initial.position)
          .sub(camera.position.clone().fromArray(initial.target))
          .normalize()
          .applyQuaternion(camera.quaternion.clone().fromArray(frame))
          .toArray();
      },
      {initial, frame},
    );
    const resetDirection = reset.position.map(
      (v, i) => (v - reset.target[i]) / reset.distance,
    );
    resetDirection.forEach((v, i) => near(v, expectedDirection[i]));
    assert.ok(
      Math.hypot(...reset.target.map((v, i) => v - before.target[i])) > 1,
    );
    await settleAnimation(page);
    assert.deepEqual(await cameraState(page), reset);

    const currentSource = await page.evaluate(() =>
      window.navigationApp.codeEditor.editor.getValue(),
    );
    assert.equal(currentSource, source);
    await rotate(page);
    const turned = await cameraState(page);
    near(turned.distance, reset.distance);
    turned.target.forEach((v, i) => near(v, reset.target[i]));
    if (process.env.CODE3D_INDICATOR_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_INDICATOR_SCREENSHOT});
    assert.deepEqual(errors, []);
  },
);

async function assertLocalView(
  page: Page,
  axis: 'x' | 'y' | 'z',
  sign: number,
  frame: number[],
) {
  await waitForViewTransition(page);
  const actual = await page.evaluate(
    ({frame}) => {
      const viewport = window.navigationApp.viewport;
      const camera = viewport['camera'];
      const inverseFrame = camera.quaternion.clone().fromArray(frame).invert();
      return {
        direction: camera.position
          .clone()
          .sub(viewport['controls'].focus)
          .normalize()
          .applyQuaternion(inverseFrame)
          .toArray(),
        up: camera.up.clone().applyQuaternion(inverseFrame).toArray(),
      };
    },
    {frame},
  );
  const index = {x: 0, y: 1, z: 2}[axis];
  actual.direction.forEach((v, i) => near(v, i === index ? sign : 0));
  const expectedUp = axis === 'y' ? [0, 0, -sign] : [0, 1, 0];
  actual.up.forEach((v, i) => near(v, expectedUp[i]));
}

test(
  'view transitions orbit smoothly, can be interrupted or retargeted and respect reduced motion',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    await setSource(
      page,
      "import {box} from '@code3d/core'; export default box(24, 6, 14).paint('#8ed5d1');",
    );
    const sampled = await page.evaluate(async () => {
      const viewport = window.navigationApp.viewport;
      const camera = viewport['camera'];
      const controls = viewport['controls'];
      const before = camera.quaternion.clone();
      const distance = camera.position.distanceTo(controls.focus);
      const focus = controls.focus.toArray();
      const samples: {
        angle: number;
        distance: number;
        x: number;
        focus: number[];
      }[] = [];
      document
        .querySelector('[data-axis="x"][data-direction="positive"]')!
        .dispatchEvent(new MouseEvent('click', {bubbles: true}));
      await new Promise<void>(resolve => {
        const sample = () => {
          samples.push({
            angle: camera.quaternion.angleTo(before),
            distance: camera.position.distanceTo(controls.focus),
            x: camera.position.clone().sub(controls.focus).normalize().x,
            focus: controls.focus.toArray(),
          });
          if (controls['transition']) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      return {distance, focus, samples};
    });
    assert.ok(
      sampled.samples.some(sample => sample.angle > 0.01 && sample.x < 0.99),
      'Rotation must include intermediate orientations',
    );
    near(sampled.samples.at(-1)!.x, 1);
    for (const sample of sampled.samples) {
      near(sample.distance, sampled.distance);
      sample.focus.forEach((v, i) => near(v, sampled.focus[i]));
    }

    const indicator = page.locator('.viewport-coordinate-reference');
    const yButton = indicator.getByRole('button', {
      name: 'View from +Y',
      exact: true,
    });
    await yButton.press('Enter');
    const rect = await canvasRect(page);
    await page.mouse.move(
      rect.x + rect.width * 0.6,
      rect.y + rect.height * 0.5,
    );
    await page.mouse.down();
    const grabbed = await cameraState(page);
    await settleAnimation(page, 400);
    assert.deepEqual(
      await cameraState(page),
      grabbed,
      'Pointer down must immediately stop a view transition',
    );
    await page.mouse.up();

    await yButton.press('Enter');
    const beforeWheel = await cameraState(page);
    await page.mouse.wheel(0, -125);
    await page.waitForFunction(distance => {
      const viewport = window.navigationApp.viewport;
      return (
        viewport['camera'].position.distanceTo(viewport['controls'].focus) <
        distance * 0.99
      );
    }, beforeWheel.distance);
    const wheeled = await cameraState(page);
    await settleAnimation(page, 400);
    assert.deepEqual(
      await cameraState(page),
      wheeled,
      'Wheel zoom must take over without resuming the transition',
    );

    // A new direction starts from the current displayed pose, even mid-transition.
    const retargeted = await page.evaluate(async () => {
      const viewport = window.navigationApp.viewport;
      const camera = viewport['camera'];
      const click = (axis: string) =>
        document
          .querySelector(`[data-axis="${axis}"][data-direction="positive"]`)!
          .dispatchEvent(new MouseEvent('click', {bubbles: true}));
      click('x');
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const pose = camera.quaternion.clone();
      const position = camera.position.clone();
      click('y');
      return {
        angle: camera.quaternion.angleTo(pose),
        movement: camera.position.distanceTo(position),
      };
    });
    near(retargeted.angle, 0);
    near(retargeted.movement, 0);
    await assertLocalView(page, 'y', 1, [0, 0, 0, 1]);

    await indicator
      .getByRole('button', {name: 'View from +Z', exact: true})
      .press('Enter');
    await page.evaluate(() =>
      window.navigationApp.viewport['controls'].setNavigationEnabled(false),
    );
    const paused = await cameraState(page);
    await settleAnimation(page, 400);
    assert.deepEqual(
      await cameraState(page),
      paused,
      'Spatial tools must pause transitions too',
    );
    await page.evaluate(() =>
      window.navigationApp.viewport['controls'].setNavigationEnabled(true),
    );

    await page.emulateMedia({reducedMotion: 'reduce'});
    await indicator
      .getByRole('button', {name: 'View from +X', exact: true})
      .press('Enter');
    const reduced = await cameraState(page);
    near((reduced.position[0] - reduced.target[0]) / reduced.distance, 1);
    assert.equal(
      await page.evaluate(
        () =>
          window.navigationApp.viewport['controls']['transition'] === undefined,
      ),
      true,
    );
    if (process.env.CODE3D_INDICATOR_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_INDICATOR_SCREENSHOT});
    assert.deepEqual(errors, []);
  },
);

async function waitForViewTransition(page: Page) {
  await page.waitForFunction(
    () => window.navigationApp.viewport['controls']['transition'] === undefined,
  );
}

async function openNavigationPage(t: TestContext) {
  assert.ok(process.env.CODE3D_TEST_URL);
  const browser = await chromium.connectOverCDP(
    process.env.CODE3D_CDP_URL ?? 'http://localhost:9222',
  );
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: {width: 1440, height: 1000},
    reducedMotion: 'no-preference',
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.navigationApp = {viewport, codeEditor};\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL, {waitUntil: 'domcontentloaded'});
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  return {page, errors};
}

async function setSource(page: Page, source: string) {
  await page.evaluate(() => window.navigationApp.codeEditor.editor.focus());
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source);
  await page.getByText('Ready', {exact: true}).waitFor();
  await page.waitForFunction(
    width => {
      const vertices =
        window.navigationApp.viewport['module']?.fallback?.mesh
          ?.topologyVertices;
      if (!vertices) return false;
      const xs = [...vertices].filter((_, i) => i % 3 === 0);
      return Math.abs(Math.max(...xs) - Math.min(...xs) - width) < 1e-6;
    },
    Number(source.match(/box\(([\d.]+)/)![1]),
  );
}

async function cameraState(page: Page) {
  return page.evaluate(() => {
    const viewport = window.navigationApp.viewport;
    const camera = viewport['camera'];
    const target = viewport['controls'].focus;
    const fog = viewport['scene'].fog as import('three').Fog;
    return {
      position: camera.position.toArray(),
      up: camera.up.toArray(),
      quaternion: camera.quaternion.toArray(),
      target: target.toArray(),
      distance: camera.position.distanceTo(target),
      near: camera.near,
      far: camera.far,
      fogNear: fog.near,
    };
  });
}

async function canvasRect(page: Page) {
  return (await page.locator('.viewport-canvas').boundingBox())!;
}

async function rotate(page: Page) {
  const rect = await canvasRect(page);
  const x = rect.x + rect.width * 0.5;
  await page.mouse.move(x, rect.y + rect.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(x, rect.y + rect.height * 0.2, {steps: 12});
  await page.mouse.up();
  await settleAnimation(page);
}

async function settleAnimation(page: Page, duration = 250) {
  await page.evaluate(
    duration =>
      new Promise<void>(resolve => {
        const end = performance.now() + duration;
        const frame = () =>
          performance.now() >= end ? resolve() : requestAnimationFrame(frame);
        requestAnimationFrame(frame);
      }),
    duration,
  );
}

async function zoomUntil(
  page: Page,
  delta: number,
  done: (distance: number) => boolean,
) {
  const rect = await canvasRect(page);
  await page.mouse.move(rect.x + rect.width * 0.8, rect.y + rect.height * 0.65);
  for (let i = 0; i < 45; i++) {
    const before = await cameraState(page);
    if (done(before.distance)) return;
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(distance => {
      const viewport = window.navigationApp.viewport;
      return (
        Math.abs(
          viewport['camera'].position.distanceTo(viewport['controls'].focus) -
            distance,
        ) >
        distance * 0.01
      );
    }, before.distance);
  }
  assert.fail('Zoom did not reach the requested range');
}

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
}

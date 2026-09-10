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
      "import {box} from '@code3d/core'; export default box(24, 6, 14).material('#8ed5d1');",
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
          viewport['camera'].projectionMatrix.elements[5] /
            viewport['camera'].projectionMatrix.elements[0] -
            canvas.clientWidth / canvas.clientHeight,
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
      "import {box} from '@code3d/core'; export default box(0.02, 0.04, 0.06).material('#8ed5d1');",
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
      "import {box} from '@code3d/core'; export default box(24, 6, 14).material('#8ed5d1');",
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
      "import {box} from '@code3d/core'; export default box(24, 6, 14).material('#8ed5d1');";
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
        assert.equal(aligned.projection, 'orthographic');
        near(aligned.viewHeight, framed.viewHeight);
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
    assert.equal(reset.projection, 'perspective');
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
      "import {box} from '@code3d/core'; export default box(24, 6, 14).material('#8ed5d1');",
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
          const camera = viewport['camera'];
          samples.push({
            angle: camera.quaternion.angleTo(before),
            distance: controls.capturePose().distance,
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
    await page.waitForFunction(viewHeight => {
      const viewport = window.navigationApp.viewport;
      return viewport['controls'].capturePose().viewHeight < viewHeight * 0.99;
    }, beforeWheel.viewHeight);
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

test(
  'orthographic views keep zoom, pan, picking and export until the user orbits',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    const source =
      "import {box} from '@code3d/core'; export default box(24, 6, 14).material('#8ed5d1');";
    await setSource(page, source);
    await page
      .getByRole('button', {name: 'View from +Z', exact: true})
      .press('Enter');
    await waitForViewTransition(page);
    const aligned = await cameraState(page);
    assert.equal(aligned.projection, 'orthographic');
    const rect = await canvasRect(page);
    const cursor = {
      x: Math.round(rect.x + rect.width * 0.75),
      y: Math.round(rect.y + rect.height * 0.65),
    };
    // The same world point must remain under the cursor through orthographic zoom.
    const anchor = await page.evaluate(({x, y}) => {
      const viewport = window.navigationApp.viewport;
      const camera = viewport['camera'];
      const rect = viewport['renderer'].domElement.getBoundingClientRect();
      const ndc = viewport['pointer'].set(
        ((x - rect.x) / rect.width) * 2 - 1,
        1 - ((y - rect.y) / rect.height) * 2,
      );
      viewport['raycaster'].setFromCamera(ndc, camera);
      const ray = viewport['raycaster'].ray;
      const normal = camera.getWorldDirection(camera.position.clone());
      const distance =
        viewport['controls'].focus.clone().sub(ray.origin).dot(normal) /
        ray.direction.dot(normal);
      return ray.at(distance, camera.position.clone()).toArray();
    }, cursor);
    await page.mouse.move(cursor.x, cursor.y);
    await page.mouse.wheel(0, -250);
    await page.waitForFunction(
      height =>
        window.navigationApp.viewport['controls'].capturePose().viewHeight <
        height * 0.9,
      aligned.viewHeight,
    );
    assert.equal((await cameraState(page)).projection, 'orthographic');
    const projected = await page.evaluate(anchor => {
      const viewport = window.navigationApp.viewport;
      const point = viewport['camera'].position
        .clone()
        .fromArray(anchor)
        .project(viewport['camera']);
      const rect = viewport['renderer'].domElement.getBoundingClientRect();
      return {
        x: rect.x + ((point.x + 1) / 2) * rect.width,
        y: rect.y + ((1 - point.y) / 2) * rect.height,
      };
    }, anchor);
    near(projected.x, cursor.x);
    near(projected.y, cursor.y);
    await page.mouse.down({button: 'right'});
    await page.mouse.move(cursor.x - 40, cursor.y + 30, {steps: 5});
    await page.mouse.up({button: 'right'});
    const panned = await cameraState(page);
    assert.equal(panned.projection, 'orthographic');
    assert.notDeepEqual(panned.target, aligned.target);
    await page.setViewportSize({width: 1250, height: 850});
    await page.waitForFunction(() => {
      const viewport = window.navigationApp.viewport;
      const p = viewport['camera'].projectionMatrix.elements;
      const canvas = viewport['renderer'].domElement;
      return (
        Math.abs(p[5] / p[0] - canvas.clientWidth / canvas.clientHeight) < 1e-6
      );
    });
    near((await cameraState(page)).viewHeight, panned.viewHeight);
    await page.evaluate(() => window.navigationApp.viewport.fit());
    const fitted = await cameraState(page);
    assert.equal(fitted.projection, 'orthographic');
    // Click a visible face; picking must use the active orthographic camera.
    const face = await page.evaluate(() => {
      const viewport = window.navigationApp.viewport;
      const point = viewport['camera'].position
        .clone()
        .set(0, 0, 7)
        .project(viewport['camera']);
      const rect = viewport['renderer'].domElement.getBoundingClientRect();
      return {
        x: rect.x + ((point.x + 1) / 2) * rect.width,
        y: rect.y + ((1 - point.y) / 2) * rect.height,
      };
    });
    await page.mouse.click(face.x, face.y);
    assert.equal((await cameraState(page)).projection, 'orthographic');
    const image = await page.evaluate(async () => {
      const viewport = window.navigationApp.viewport;
      const live = viewport['camera'];
      let exported: {type: string; scale: number; aspect: number} | undefined;
      const mesh = viewport['root'].getObjectsByProperty('type', 'Mesh')[0];
      const before = mesh.onBeforeRender;
      mesh.onBeforeRender = function (
        renderer,
        scene,
        camera,
        geometry,
        material,
        group,
      ) {
        if (camera !== live)
          exported = {
            type: camera.type,
            scale: camera.projectionMatrix.elements[5],
            aspect:
              camera.projectionMatrix.elements[5] /
              camera.projectionMatrix.elements[0],
          };
        before.call(this, renderer, scene, camera, geometry, material, group);
      };
      const png = await viewport.captureImage(720, 480);
      mesh.onBeforeRender = before;
      return {
        exported,
        bytes: png.size,
        liveScale: live.projectionMatrix.elements[5],
      };
    });
    assert.ok(image.bytes > 1000);
    assert.equal(image.exported?.type, 'OrthographicCamera');
    near(image.exported!.scale, image.liveScale);
    near(image.exported!.aspect, 1.5);
    if (process.env.CODE3D_PROJECTION_SCREENSHOT)
      await page.screenshot({path: process.env.CODE3D_PROJECTION_SCREENSHOT});
    const beforeOrbit = await cameraState(page);
    const canvas = await canvasRect(page);
    await page.mouse.move(
      canvas.x + canvas.width * 0.8,
      canvas.y + canvas.height * 0.8,
    );
    await page.mouse.down();
    assert.equal(
      (await cameraState(page)).projection,
      'orthographic',
      'Pointer down alone does not change projection',
    );
    await page.mouse.move(
      canvas.x + canvas.width * 0.8 + 20,
      canvas.y + canvas.height * 0.8 - 15,
    );
    const orbiting = await cameraState(page);
    assert.equal(orbiting.projection, 'perspective');
    near(orbiting.viewHeight, beforeOrbit.viewHeight);
    orbiting.target.forEach((value, index) =>
      near(value, beforeOrbit.target[index]),
    );
    await page.mouse.up();
    await settleAnimation(page);
    assert.notDeepEqual(
      (await cameraState(page)).quaternion,
      beforeOrbit.quaternion,
    );
    assert.deepEqual(errors, []);
  },
);

test(
  'touch pan and pinch retain orthographic projection; orbit and twist restore perspective',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await setSource(
      page,
      "import {box} from '@code3d/core'; export default box(24, 6, 14);",
    );
    const cdp = await page.context().newCDPSession(page);
    const rect = await canvasRect(page);
    const x = Math.round(rect.x + rect.width * 0.65);
    const y = Math.round(rect.y + rect.height * 0.65);
    const touch = async (
      type: 'touchStart' | 'touchMove' | 'touchEnd',
      points: number[][],
    ) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y], id) => ({id, x, y})),
      });
    };
    for (const gesture of ['pan', 'pinch', 'twist', 'orbit']) {
      await page
        .getByRole('button', {name: 'View from +Z', exact: true})
        .press('Enter');
      const before = await cameraState(page);
      assert.equal(before.projection, 'orthographic');
      await touch(
        'touchStart',
        gesture === 'orbit'
          ? [[x, y]]
          : [
              [x - 50, y],
              [x + 50, y],
            ],
      );
      for (let step = 1; step <= 10; step++) {
        const delta = step * 3;
        const points =
          gesture === 'pan'
            ? [
                [x - 50 + delta, y + delta],
                [x + 50 + delta, y + delta],
              ]
            : gesture === 'pinch'
              ? [
                  [x - 50 - delta, y],
                  [x + 50 + delta, y],
                ]
              : gesture === 'twist'
                ? [
                    [x - 50, y - delta],
                    [x + 50, y + delta],
                  ]
                : [[x + delta, y - delta]];
        await touch('touchMove', points);
        if (gesture === 'pan' || gesture === 'pinch')
          assert.equal(
            (await cameraState(page)).projection,
            'orthographic',
            gesture,
          );
      }
      await touch('touchEnd', []);
      const after = await cameraState(page);
      if (gesture === 'pan') assert.notDeepEqual(after.target, before.target);
      else if (gesture === 'pinch')
        assert.ok(after.viewHeight < before.viewHeight);
      else assert.equal(after.projection, 'perspective', gesture);
    }
    await cdp.detach();
    assert.deepEqual(errors, []);
  },
);

test(
  'projection transitions flatten depth continuously and let an ongoing orbit control orientation',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    await setSource(
      page,
      "import {box} from '@code3d/core'; export default box(24, 6, 14);",
    );
    await page.emulateMedia({reducedMotion: 'no-preference'});
    const samples = await page.evaluate(async () => {
      const viewport = window.navigationApp.viewport;
      const controls = viewport['controls'];
      controls.object.position.set(0, 0, 60);
      controls.focus.set(0, 0, 0);
      controls.object.up.set(0, 1, 0);
      controls.syncCamera();
      const sample = () => {
        const camera = viewport['camera'];
        const front = camera.position.clone().set(10, 0, 7).project(camera);
        const back = camera.position.clone().set(10, 0, -7).project(camera);
        return {
          depthRatio: front.x / back.x,
          viewHeight: controls.capturePose().viewHeight,
          distance: camera.position.distanceTo(controls.focus),
          type: camera.type,
        };
      };
      const samples = [sample()];
      controls.setViewDirection(
        controls.focus.clone().set(0, 0, 1),
        controls.object.up,
      );
      await new Promise<void>(resolve => {
        const frame = () => {
          samples.push(sample());
          if (controls['transition']) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return samples;
    });
    assert.ok(samples.length >= 4);
    assert.equal(samples[0].type, 'PerspectiveCamera');
    assert.equal(samples.at(-1)!.type, 'OrthographicCamera');
    assert.ok(
      samples.some(
        s => s.depthRatio < samples[0].depthRatio - 0.02 && s.depthRatio > 1.02,
      ),
      'Depth must change before the final camera handoff',
    );
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i].depthRatio <= samples[i - 1].depthRatio + 1e-8);
      near(samples[i].viewHeight, samples[0].viewHeight);
    }
    near(samples.at(-1)!.depthRatio, 1);
    assert.ok(
      Math.max(...samples.map(s => s.distance)) > samples[0].distance * 3,
      'Dolly and lens changes happen together',
    );
    const rect = await canvasRect(page);
    const x = rect.x + rect.width * 0.8;
    const y = rect.y + rect.height * 0.75;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 15, y - 15);
    const started = await page.evaluate(() => {
      const pose = window.navigationApp.viewport['controls'].capturePose();
      return {
        projection: pose.projection,
        projectionMix: pose.projectionMix,
        orientation: pose.orientation.toArray(),
      };
    });
    assert.equal(started.projection, 'perspective');
    assert.ok(
      started.projectionMix < 1,
      'Orbit starts a lens transition instead of jumping straight to perspective',
    );
    await page.mouse.move(x + 55, y - 45, {steps: 8});
    const moved = await cameraState(page);
    assert.notDeepEqual(moved.quaternion, started.orientation);
    const saved = await page.evaluate(() => {
      const controls = window.navigationApp.viewport['controls'];
      return {
        current: controls.capturePose().orientation.toArray(),
        saved: controls.savedPose().orientation.toArray(),
      };
    });
    assert.deepEqual(
      saved.saved,
      saved.current,
      'Scene memory must retain the live orbit while its lens is transitioning',
    );
    await page.mouse.up();
    await waitForViewTransition(page);
    assert.equal(
      await page.evaluate(
        () =>
          window.navigationApp.viewport['controls'].capturePose().projectionMix,
      ),
      1,
    );
    assert.equal((await cameraState(page)).projection, 'perspective');
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
      projection: viewport['controls'].capturePose().projection,
      viewHeight: viewport['controls'].capturePose().viewHeight,
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

test(
  'adaptive work-plane grids follow all six local axis views, scale, pan and render mode',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openNavigationPage(t);
    await setSource(
      page,
      "import {box} from '@code3d/core'; export default box(24, 6, 14);",
    );
    const state = () =>
      page.evaluate(() => {
        const viewport = window.navigationApp.viewport;
        const grid = viewport['rendering'].grid;
        return {
          plane: grid.plane,
          step: grid.step,
        };
      });
    // The same selected occurrence drives both the indicator and grid, including
    // instance placement and live transform previews.
    await page.evaluate(() => {
      const viewport = window.navigationApp.viewport;
      const target = viewport['occurrences'].get(
        viewport['selectedKey'],
      )!.object;
      target.position.set(12, -4, 7);
      target.quaternion.setFromAxisAngle(
        target.position.clone().set(0, 1, 0),
        Math.PI / 5,
      );
      viewport['coordinateReference']!.update();
    });
    for (const [axis, plane] of [
      ['x', 'YZ'],
      ['y', 'XZ'],
      ['z', 'XY'],
    ] as const) {
      for (const sign of ['positive', 'negative']) {
        await page
          .locator(
            `.viewport-coordinate-axis[data-axis="${axis}"][data-direction="${sign}"]`,
          )
          .dispatchEvent('click', {detail: 1});
        await page.waitForFunction(
          () => !window.navigationApp.viewport['controls']['transition'],
        );
        assert.equal((await state()).plane, plane);
      }
    }
    for (const span of [0.002, 0.2, 20, 2000, 2e6]) {
      const result = await page.evaluate(async span => {
        const viewport = window.navigationApp.viewport;
        const controls = viewport['controls'];
        const pose = controls.capturePose();
        controls.restorePose({
          ...pose,
          distance: span * 2,
          viewHeight: span,
          focus: pose.focus.set(1000, 2000, 3000),
        });
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => resolve()),
        );
        const grid = viewport['rendering'].grid;
        const canvas = viewport['renderer'].domElement;
        const label = document.querySelector(
          '.viewport-grid-scale-value',
        )!.textContent!;
        const distance = Number(label.split(' ')[0]);
        return {
          label,
          distance,
          barWidth: document
            .querySelector('.viewport-grid-scale-bar')!
            .getBoundingClientRect().width,
          step: grid.step,
          scale: canvas.clientHeight / span,
          focus: grid.focus.toArray(),
        };
      }, span);
      assert.ok(
        result.step * result.scale >= 8 - 1e-8 &&
          result.step * result.scale <= 20 + 1e-8,
      );
      assert.deepEqual(result.focus, [1000, 2000, 3000]);
      assert.ok(result.label.endsWith(' unit'));
      assert.ok(Math.abs(result.distance / result.step - 1) < 1e-8);
      assert.equal(result.barWidth, 60);
    }
    await rotate(page);
    assert.equal((await state()).plane, 'XZ');
    await page.evaluate(() =>
      window.navigationApp.viewport.setRenderMode('render'),
    );
    assert.equal(
      await page.locator('.viewport-coordinate-reference').isVisible(),
      false,
    );
    assert.equal(await page.locator('.viewport-grid-scale').isVisible(), false);
    await page.evaluate(() =>
      window.navigationApp.viewport.setRenderMode('modeling'),
    );
    assert.equal(await page.locator('.viewport-grid-scale').isVisible(), true);
    assert.deepEqual(errors, []);
  },
);

test('the shared grid legend follows sketch zoom and restores the 3D display on exit', async t => {
  const {page, errors} = await openNavigationPage(t);
  await page.evaluate(() => {
    const editor = window.navigationApp.codeEditor.editor;
    const source = [
      "import {box, sketch} from '@code3d/core';",
      'export const solid = box(24, 6, 14);',
      "export const outline = sketch([['point', 1, [0, 0]], ['point', 2, [20, 0]], ['line', 3, [1, 2]]]);",
    ].join('\n');
    editor.getModel()!.setValue(source);
    editor.setPosition(
      editor.getModel()!.getPositionAt(source.indexOf('box(24') + 2),
    );
  });
  await page.waitForFunction(
    () => window.navigationApp.viewport['module']?.sketches.size === 1,
  );
  await page.evaluate(() => {
    window.navigationApp.viewport.setRenderMode('render');
    const editor = window.navigationApp.codeEditor.editor;
    editor.setPosition(
      editor
        .getModel()!
        .getPositionAt(editor.getValue().indexOf('sketch([') + 2),
    );
  });
  await page.locator('.sketch-editor:not([hidden])').waitFor();
  await page.evaluate(() =>
    window.navigationApp.viewport.setRenderMode('render'),
  );
  const legend = page.locator('.viewport-grid-scale');
  assert.equal(await legend.count(), 1);
  assert.equal(
    await legend.isVisible(),
    true,
    'sketch has its own grid even in 3D Render mode',
  );
  const canvas = await page.locator('.sketch-canvas').boundingBox();
  assert.ok(canvas);
  await page.mouse.move(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  const scales: number[] = [];
  for (const delta of [0, -900, 1800, -2400, -4000, 14000, -10000]) {
    if (delta) {
      const before = await legend.innerText();
      await page.mouse.wheel(0, delta);
      await page.waitForFunction(
        before =>
          document.querySelector('.viewport-grid-scale')!.textContent !==
          before,
        before,
      );
    }
    const measured = await page.evaluate(() => {
      const svg = document.querySelector('.sketch-canvas')!;
      const x = (id: number) =>
        Number(
          svg
            .querySelector(`circle.local[data-id="${id}"]`)!
            .getAttribute('cx'),
        );
      const scale = (x(2) - x(1)) / 20;
      const vertical = [...svg.querySelectorAll('line.grid')]
        .filter(line => line.getAttribute('x1') === line.getAttribute('x2'))
        .map(line => Number(line.getAttribute('x1')))
        .sort((a, b) => a - b);
      return {
        scale,
        cellLength: (vertical[1]! - vertical[0]!) / scale,
        label: Number(
          document
            .querySelector('.viewport-grid-scale-value')!
            .textContent!.split(' ')[0],
        ),
      };
    });
    assert.ok(Math.abs(measured.label / measured.cellLength - 1) < 1e-7);
    scales.push(measured.scale);
  }
  assert.ok(Math.min(...scales) < 0.05, 'zoom out beyond the former minimum');
  assert.ok(Math.max(...scales) > 1000, 'zoom in beyond the former maximum');
  await page.evaluate(() => {
    const editor = window.navigationApp.codeEditor.editor;
    editor.setPosition(
      editor.getModel()!.getPositionAt(editor.getValue().indexOf('box(24') + 2),
    );
  });
  await page.locator('.sketch-editor:not([hidden])').waitFor({state: 'hidden'});
  assert.equal(
    await legend.isVisible(),
    false,
    'returning to 3D restores Render mode',
  );
  await page.evaluate(() =>
    window.navigationApp.viewport.setRenderMode('modeling'),
  );
  assert.equal(await legend.isVisible(), true);
  await page.waitForFunction(
    () =>
      Number(
        document
          .querySelector('.viewport-grid-scale-value')!
          .textContent!.split(' ')[0],
      ) === window.navigationApp.viewport['rendering'].grid.step,
  );
  assert.deepEqual(errors, []);
});

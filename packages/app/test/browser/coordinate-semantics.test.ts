import assert from 'node:assert/strict';
import {test, type TestContext} from 'node:test';
import {chromium, type Page} from 'playwright-core';

declare const window: Window & {
  coordinateApp: {
    viewport: import('../../src/viewport.ts').ModelViewport;
    codeEditor: import('../../src/editor.ts').CodeEditor;
  };
};

test(
  'origin drags freeze their input frame, commit coordinates and support cancellation and undo',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source =
      "import {box} from '@code3d/core';\nexport const part = box(24, 6, 14).originOffset(2, 3, 4);";
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
      "import {box, point} from '@code3d/core';\nexport const part = box(24, 6, 14).relate(self => self.center.align(point()).pivot([5, 0, 0]).rotate(0, 90, 0));";
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
      const source = `import {box} from '@code3d/core';\nexport const part = box(24, 6, 14).material('#8ed5d1')${prefix}.originVertex(3);`;
      await setSource(page, source, 'originVertex');
      await waitVertexSelection(page, 3);
      const before = await vertexState(page);
      assertVertexAlignment(before);
      assert.deepEqual(before.gridOrigin, [0, 0, 0]);
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
        viewport.setOccurrenceTranslationPreview(
          [viewport['topologySelection']!.occurrenceKey],
          [7, 8, 9],
        );
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
        viewport.clearOccurrenceTranslationPreview([
          viewport['topologySelection']!.occurrenceKey,
        ]);
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
    const source = `import {box, group} from '@code3d/core';
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

test(
  'group rotation rings turn the assembly about its selected origin and support cancel, commit and undo',
  {timeout: 120_000},
  async t => {
    const {page, errors} = await openApp(t);
    const source = `import {box, group} from '@code3d/core';
const base = box(24, 6, 14).material('#8ed5d1');
const cap = box(8, 4, 8).material('#d9b478').relate(self => self.on(base.up));
export const assembly = group([base, cap]).originPoint(cap.center).rotate(0, 0, 0);`;
    await setSource(page, source, 'rotate');
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
      assert.equal(preview.source, source);
      assert.ok(
        preview.geometry.some((point, i) =>
          point.some((v, axis) => Math.abs(v - before.geometry[i][axis]) > 0.1),
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
    committed.geometry.forEach((point, i) => near(point, preview.geometry[i]));
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

async function rotationHandle(page: Page) {
  return page.evaluate(() => {
    const viewport = window.coordinateApp.viewport;
    const gizmo = viewport['transformGizmo'];
    const control = gizmo['axes'][2];
    const camera = viewport['camera'];
    const rect = viewport['renderer'].domElement.getBoundingClientRect();
    control.controls.getHelper().updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const center = control.proxy.position.clone().project(camera);
    for (const object of control.gizmo.gizmo.rotate.children) {
      if (!object.visible || object.name !== 'Z') continue;
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
          .set(0, 0, 1)
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
    throw new Error('No visible Z rotation ring pick point');
  });
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
      const scope = viewport.sourceEvaluation();
      return (
        scope?.target.tool?.signature.name === 'originVertex' &&
        scope.evaluation.selection?.ids[0] === id &&
        viewport['topologySelection']?.selectedIds.has(id)
      );
    }, id)
    .catch(async error => {
      const actual = await page.evaluate(() => {
        const {viewport, codeEditor} = window.coordinateApp;
        const scope = viewport.sourceEvaluation();
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
    const grid = viewport['scene'].children.find(
      child => child.type === 'GridHelper',
    )!;
    return {
      source: codeEditor.editor.getValue(),
      origin: occurrence.node.origin,
      gridOrigin: grid.getWorldPosition(grid.position.clone()).toArray(),
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

async function setSource(page: Page, source: string, method: string) {
  await page.evaluate(() => window.coordinateApp.codeEditor.editor.focus());
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(source);
  await page.evaluate(method => {
    const editor = window.coordinateApp.codeEditor.editor;
    editor.setPosition(
      editor.getModel()!.getPositionAt(editor.getValue().indexOf(method) + 2),
    );
  }, method);
  await page.waitForFunction(method => {
    const target = window.coordinateApp.viewport.sourceEvaluation()?.target;
    return (target?.tool?.signature.name ?? target?.operation?.kind) === method;
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
      geometry: [...node.mesh!.topologyVertices],
      active: Boolean(viewport['transformGizmo']['active']),
      preview: [...viewport['spatialPreviews'].values()][0],
      bindings: viewport['transformGizmo']['axes'].flatMap(axis =>
        axis.binding ? [axis.binding] : [],
      ),
    };
  });
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
    const control = gizmo['axes'][0];
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
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        '\nwindow.coordinateApp = {viewport, codeEditor};\n',
    });
  });
  await page.goto(process.env.CODE3D_TEST_URL!, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.getByText('Ready', {exact: true}).waitFor({timeout: 60_000});
  return {page, errors};
}

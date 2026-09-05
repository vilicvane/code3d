import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import * as THREE from 'three';
import {createAppTestServer} from './vite-test-server.mjs';

let server, TransformGizmo;
before(async () => {
  server = await createAppTestServer();
  ({TransformGizmo} = await server.ssrLoadModule(
    '/src/tools/transform-gizmo.ts',
  ));
});
after(async () => server?.close());

for (const end of ['commit', 'cancel']) {
  test(`translation keeps all axes together through snapping and ${end}`, () => {
    const scene = new THREE.Scene();
    const object = new THREE.Object3D();
    scene.add(object);
    const element = Object.assign(new EventTarget(), {style: {}});
    const events = [];
    const navigation = [];
    const gizmo = new TransformGizmo(
      scene,
      new THREE.PerspectiveCamera(),
      element,
      enabled => navigation.push(enabled),
      event => {
        events.push(event);
        if (event.kind === 'preview') gizmo.updateAnchor();
      },
    );
    const origin = new THREE.Vector3(1, 2, 3);
    const orientations = [0.6, -0.2, 0.4].map(angle =>
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        angle,
      ),
    );
    gizmo.attach(
      object,
      ['x', 'y', 'z'].map((axis, i) => ({
        kind: 'expression',
        receiver: {sourceRef: {file: '/model.ts', start: 0, end: 4}},
        occurrenceKeys: ['part'],
        mode: 'translate',
        axis,
        label: axis,
        value: 5,
        sensitivity: 2,
        step: 0.5,
        anchor: 'frame',
        frame: {
          position: origin.toArray(),
          quaternion: orientations[i].toArray(),
          scale: [1, 1, 1],
        },
      })),
    );
    const active = gizmo.axes[0];
    const direction = new THREE.Vector3(1, 0, 0).applyQuaternion(
      orientations[0],
    );
    const positionsAre = expected => {
      for (const [i, {proxy}] of gizmo.axes.entries()) {
        assert.ok(proxy.position.distanceTo(expected) < 1e-10);
        assert.ok(
          proxy.getWorldPosition(new THREE.Vector3()).distanceTo(expected) <
            1e-10,
        );
        assert.ok(proxy.quaternion.angleTo(orientations[i]) < 1e-7);
      }
    };
    try {
      active.controls.dispatchEvent({type: 'mouseDown'});
      assert.deepEqual(
        gizmo.axes.map(axis => axis.controls.axis),
        ['X', null, null],
      );
      for (const [distance, expectedDistance, value] of [
        [3.2, 3, 6.5],
        [-1.2, -1, 4.5],
      ]) {
        active.proxy.position.copy(origin).addScaledVector(direction, distance);
        active.controls.dispatchEvent({type: 'objectChange'});
        positionsAre(
          origin.clone().addScaledVector(direction, expectedDistance),
        );
        assert.equal(events.at(-1).kind, 'preview');
        assert.equal(events.at(-1).value, value);
      }
      if (end === 'cancel') {
        assert.equal(gizmo.cancel(), true);
        positionsAre(origin);
      } else {
        active.controls.dispatchEvent({type: 'mouseUp'});
        positionsAre(origin.clone().addScaledVector(direction, -1));
        assert.equal(events.at(-1).value, 4.5);
      }
      assert.equal(events.at(-1).kind, end);
      assert.deepEqual(navigation, [false, true]);
      assert.ok(gizmo.axes.every(axis => axis.controls.axis === null));
    } finally {
      gizmo.dispose();
    }
  });
}

test('overlapping pickers highlight only the nearest axis and lock it for the owning pointer', t => {
  const {gizmo, camera, send, events, captured} = pointerFixture(t);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(), camera);
  const hits = gizmo.axes
    .flatMap(axis => {
      const hit = ray
        .intersectObject(axis.gizmo.picker.translate, true)
        .find(hit => hit.object.visible);
      return hit ? [{axis, distance: hit.distance}] : [];
    })
    .sort((a, b) => a.distance - b.distance);
  assert.ok(hits.length > 1, 'fixture must hit overlapping axes');
  send('pointermove');
  const selected = hits[0].axis;
  assert.deepEqual(
    gizmo.axes.filter(axis => axis.controls.axis !== null),
    [selected],
  );
  send('pointerdown');
  assert.deepEqual(
    gizmo.axes.filter(axis => axis.controls.dragging),
    [selected],
  );
  assert.ok(captured.has(1));
  const count = events.length;
  send('pointermove', {pointerId: 2, clientX: 520});
  send('pointerup', {pointerId: 2});
  send('pointerup', {button: 2});
  assert.equal(events.length, count);
  send('pointermove', {clientX: 460});
  send('pointermove', {clientX: 480, clientY: 340});
  assert.ok(events.some(event => event.kind === 'preview'));
  assert.ok(
    events.every(event => event.binding.axis === selected.binding.axis),
  );
  assert.deepEqual(
    gizmo.axes.filter(axis => axis.controls.axis !== null),
    [selected],
  );
  send('pointerup');
  assert.equal(events.at(-1).kind, 'commit');
  assert.equal(events.filter(event => event.kind === 'commit').length, 1);
  assert.ok(
    gizmo.axes.every(
      axis => !axis.controls.dragging && axis.controls.axis === null,
    ),
  );
  assert.equal(captured.size, 0);
});

for (const interruption of ['cancel', 'pointercancel', 'lostpointercapture']) {
  test(`${interruption} releases the pointer and all axis interaction state`, t => {
    const {gizmo, send, events, captured} = pointerFixture(t);
    send('pointerdown');
    send('pointermove', {clientX: 450});
    assert.ok(gizmo.axes[0].proxy.position.length() > 0);
    if (interruption === 'cancel') assert.equal(gizmo.cancel(), true);
    else {
      if (interruption === 'lostpointercapture') captured.clear();
      send(interruption);
    }
    assert.equal(events.at(-1).kind, 'cancel');
    assert.equal(events.filter(event => event.kind === 'cancel').length, 1);
    assert.equal(captured.size, 0);
    assert.equal(gizmo.isPointerActive(), false);
    assert.ok(
      gizmo.axes.every(
        axis =>
          !axis.controls.dragging &&
          axis.controls.axis === null &&
          axis.proxy.position.length() === 0,
      ),
    );
    send('pointerup');
    assert.equal(events.at(-1).kind, 'cancel');
    send('pointerdown');
    assert.equal(events.at(-1).kind, 'begin');
    assert.equal(gizmo.axes.filter(axis => axis.controls.dragging).length, 1);
  });
}

test('pointer leave, detach and disposal clear hover and release listeners', t => {
  const {gizmo, send, element} = pointerFixture(t);
  send('pointermove');
  assert.equal(gizmo.isPointerActive(), true);
  send('pointerleave');
  assert.equal(gizmo.isPointerActive(), false);
  send('pointermove');
  gizmo.detach();
  assert.equal(gizmo.isPointerActive(), false);
  send('pointermove');
  assert.equal(gizmo.isPointerActive(), false);
  t.after(() => {
    let canvasReads = 0;
    const getBoundingClientRect = element.getBoundingClientRect;
    element.getBoundingClientRect = () => {
      canvasReads++;
      return getBoundingClientRect();
    };
    send('pointermove');
    send('pointerdown');
    assert.equal(canvasReads, 0);
    assert.equal(gizmo.isPointerActive(), false);
    assert.equal(element.style.touchAction, 'pan-y');
  });
});

function pointerFixture(t) {
  const scene = new THREE.Scene();
  const object = new THREE.Object3D();
  scene.add(object);
  const camera = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 100);
  camera.position.set(8, 6, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const captured = new Set();
  const element = Object.assign(new EventTarget(), {
    style: {touchAction: 'pan-y'},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 800, height: 600}),
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => {
      captured.delete(id);
      send('lostpointercapture', {pointerId: id});
    },
  });
  const send = (type, overrides = {}) =>
    element.dispatchEvent(
      Object.assign(new Event(type), {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 400,
        clientY: 300,
        ...overrides,
      }),
    );
  const events = [];
  const gizmo = new TransformGizmo(
    scene,
    camera,
    element,
    () => {},
    event => events.push(event),
  );
  t.after(() => gizmo.dispose());
  gizmo.attach(
    object,
    ['x', 'y', 'z'].map(axis => ({
      kind: 'expression',
      receiver: {sourceRef: {file: '/model.ts', start: 0, end: 4}},
      occurrenceKeys: ['part'],
      mode: 'translate',
      axis,
      label: axis,
      value: 0,
      sensitivity: 1,
      anchor: 'frame',
      frame: {position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1]},
    })),
  );
  scene.updateMatrixWorld(true);
  return {gizmo, camera, element, send, events, captured};
}

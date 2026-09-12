import type {Transformation} from '@code3d/core';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  offset,
  pivot,
  pivotVertex,
  rotate,
  box,
  group,
  loft,
  rectangle,
  sketch,
  type Sketch,
  type Model,
} from '@code3d/core';
import {replicad} from '@code3d/core/replicad';
import {
  relationPreview,
  isModelObject,
  modelElementReference,
  sketchDefinition,
  sketchFrame,
  sketchSource,
  snapshotSketch,
  rotateVector,
} from '@code3d/core/tooling';
import {defined} from '../../../test/assert.ts';
import {createModelSnapshotter, modelGeometry} from './model-test.ts';

const snapshot = createModelSnapshotter();
const pose = (s: Sketch) => sketchFrame(s).snapshot().compositionTransform;
const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.forEach((v, i) =>
    assert.ok(Math.abs(v - expected[i]) < 1e-6, `${actual} != ${expected}`),
  );
const volume = (model: Model) =>
  replicad.measureVolume(modelGeometry(model).value.shape.asShape3D());
const disk = () =>
  sketch([
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 2]],
  ]);

test('empty and open sketches relate without a B-Rep face or changed geometry', () => {
  const host = rectangle(2, 2).originOffset(-50, -10, -70);
  for (const original of [
    sketch(),
    sketch([
      ['point', 1, [3, 4]],
      ['point', 2, [5, 6]],
      ['line', 3, [1, 2]],
    ]),
  ]) {
    const before = snapshotSketch(original, () => 's');
    const placed = original.relate(self => self.plane.align(host.plane));
    assert.equal(isModelObject(placed), false);
    assert.equal(sketchDefinition(placed), sketchDefinition(original));
    assert.equal(sketchSource(placed), original);
    assert.deepEqual(
      snapshotSketch(placed, () => 's'),
      before,
    );
    assert.deepEqual(
      snapshotSketch(original, () => 's'),
      before,
    );
    near(pose(placed).position, [0, 10, 0]);
    near(pose(original).position, [0, 0, 0]);
    assert.throws(() => placed.face(), /closed|open/i);
    assert.equal(sketchFrame(placed).toSnapshot().kind, 'reference');
    assert.equal(sketchFrame(placed).toSnapshot().mesh, undefined);
  }
});

test('plane relations rebind the original receiver and accept either written side', () => {
  const original = sketch();
  const target = rectangle(20, 20).originOffset(0, -7, 0);
  for (const build of [
    (s: Sketch) => s.plane.align(target),
    (s: Sketch) => target.align(s.plane),
    () => original.plane.align(target),
  ])
    near(pose(original.relate(build)).position, [0, 7, 0]);
  assert.throws(
    () => original.relate(() => target.align(rectangle(1, 1))),
    /involve self/,
  );
});

test('directed planes, target-frame offset and pivot rotations reuse the model relation solver', () => {
  const target = rectangle(30, 30).rotate(0, 0, 45).originOffset(0, -8, 0);
  const builds = [
    (s: {plane: typeof target.plane}) => s.plane.align(target.plane),
    (s: {plane: typeof target.plane}) => [
      s.plane.align(target.plane.flip()),
      offset(3, 4, 5),
    ],
    (s: {plane: typeof target.plane}) => [
      s.plane.align(target.plane),
      pivot([1, 2, 3]).rotate(0, 15, 0),
    ],
  ];
  for (const build of builds) {
    const frame = sketch().relate(build);
    const face = rectangle(4, 4).relate(build);
    near(pose(frame).position, snapshot(face).compositionTransform.position);
    near(
      pose(frame).quaternion,
      snapshot(face).compositionTransform.quaternion,
    );
  }
});

test('constraint stage previews operate on empty sketches and leave final data immutable', () => {
  let relation!: Transformation;
  const host = rectangle(10, 10).originOffset(0, -6, 0);
  const placed = sketch().relate(s => [
    s.plane.align(host),
    (relation = offset(2, 0, 0)),
  ]);
  const preview = defined(relationPreview(relation));
  assert.equal(preview.object.nodeId, sketchFrame(placed).nodeId);
  near(preview.object.compositionTransform.position, pose(placed).position);
  assert.equal(preview.object.constraints.length, 1);
  assert.throws(
    () =>
      pose(
        sketch().relate(s => [
          s.plane.align(host),
          pivotVertex(1).rotate(0, 20, 0),
        ]),
      ),
    /requires model topology/,
  );
  assert.throws(
    () => sketch().relate(s => s.plane.on(box(10, 10, 10).up)),
    /no finite geometry/,
  );
});

test('faces and extrusion inherit sketch relations without baking placement into geometry', () => {
  const host = box(30, 20, 30);
  const source = disk();
  const placed = source.relate(s => s.plane.align(host.up));
  const face = placed.face();
  const solid = face.extrude(-5);
  near(snapshot(face).compositionTransform.position, [0, 10, 0]);
  near(snapshot(solid).compositionTransform.position, [0, 10, 0]);
  near(snapshot(solid).transform.position, [0, 0, 0]);
  near(modelGeometry(face).value.localBounds.flat(), [-2, 0, -2, 2, 0, 2]);
  near([volume(host.cut([solid]))], [18000 - Math.PI * 4 * 5]);
  near(pose(source).position, [0, 0, 0]);
  assert.equal(
    snapshot(face).constraints[0].source.nodeId,
    snapshot(face).nodeId,
  );
  assert.equal(
    snapshot(solid).constraints[0].source.nodeId,
    snapshot(solid).nodeId,
  );
});

test('spatial copies retain point identities and derived layers inherit relations', () => {
  const source = sketch([
    ['point', 1, [0, 0]],
    ['point', 2, [10, 0]],
    ['line', 3, [1, 2]],
  ]);
  const target = rectangle(20, 20).originOffset(0, -8, 0);
  const placed = source.relate(s => s.plane.align(target));
  const child = placed.derive([
    ['point', 1, [0, 10]],
    ['line', 2, [source.point(2), 1]],
    ['line', 3, [1, placed.point(1)]],
  ]);
  const snapshotChild = snapshotSketch(child, s =>
    s === placed ? 'base' : 'child',
  );
  assert.equal(snapshotChild.base, 'base');
  assert.deepEqual(snapshotChild.entities[1], {
    kind: 'line',
    id: 2,
    points: [
      {layer: 'base', id: 2},
      {layer: 'child', id: 1},
    ],
  });
  near(pose(child).position, [0, 8, 0]);
  near([volume(child.face().extrude(2))], [100]);
  near(snapshot(child.face()).compositionTransform.position, [0, 8, 0]);
});

test('multiple faces and loft reuse the same frame while disconnected regions remain separate', () => {
  const plane = rectangle(20, 20).originOffset(0, -8, 0);
  const placed = sketch([
    ['point', 1, [0, 0]],
    ['circle', 2, [1, 2]],
    ['point', 3, [10, 0]],
    ['circle', 4, [3, 2]],
  ]).relate(s => s.plane.align(plane));
  assert.throws(() => placed.face(), /exactly one/);
  const faces = placed.faces();
  assert.equal(faces.length, 2);
  for (const f of faces)
    near(snapshot(f).compositionTransform.position, [0, 8, 0]);
  const lower = disk();
  const upper = lower.relate(s => s.plane.align(plane));
  const solid = loft([lower.face(), upper.face()]);
  near([volume(solid)], [Math.PI * 4 * 8]);
});

test('references bind immutable host values, with explicit occurrence references for assemblies', () => {
  const host = box(20, 10, 20);
  const placed = disk().relate(s => s.plane.align(host.up));
  const moved = host.rotate(0, 0, 90);
  near(pose(placed).position, [0, 5, 0]);
  const hostRef = defined(modelElementReference(placed.plane));
  assert.equal(hostRef.model, sketchFrame(placed));
  assert.notEqual(host, moved);
  const first = host.relate(s => [
    s.down.on(box(60, 10, 60).up),
    offset(-15, 0, 0),
  ]);
  const second = host.relate(s => [
    s.down.on(box(60, 10, 60).up),
    offset(15, 0, 0),
  ]);
  const assembly = group([first, second]).expose({first, second});
  const left = disk().relate(s => s.plane.align(assembly.first.up));
  const right = disk().relate(s => s.plane.align(assembly.second.up));
  // Plane alignment does not silently center either sketch on the finite occurrence.
  near(pose(left).position, pose(right).position);
  near(rotateVector([0, 1, 0], pose(left).quaternion), [0, 1, 0]);
});

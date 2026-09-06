import {
  defined,
  createModelSnapshotter,
  disposeModelObjects,
} from './model-test.ts';
import type {ModelSnapshotObject} from '@code3d/core/tooling';

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box, circle, group, line, point} from '@code3d/core';
import {
  modelElementReference,
  modelTopologyReference,
} from '@code3d/core/tooling';

const colors = (snapshot: ModelSnapshotObject): (string | undefined)[] => [
  snapshot.color,
  ...snapshot.children.flatMap(colors),
];

test('group paint recursively overrides existing colors on every geometry dimension', () => {
  const solid = box(2, 4, 6).paint('#ff0000');
  const face = circle(1);
  const curve = line([0, 0, 0], [1, 0, 0]);
  const vertex = point([0, 0, 0]);
  const inner = group([solid, face]).paint('#00ff00');
  const original = group([inner, curve, vertex]);
  const painted = original.paint('#0000ff');
  const repainted = painted.paint('#ffffff');
  try {
    const snapshot = createModelSnapshotter();
    const before = snapshot(original);
    const originalColors = [
      undefined,
      '#00ff00',
      '#00ff00',
      '#00ff00',
      undefined,
      undefined,
    ];
    assert.deepEqual(colors(before), originalColors);
    assert.deepEqual(colors(snapshot(painted)), Array(6).fill('#0000ff'));
    assert.deepEqual(colors(snapshot(repainted)), Array(6).fill('#ffffff'));
    assert.deepEqual(colors(snapshot(painted)), Array(6).fill('#0000ff'));
    assert.deepEqual(colors(before), originalColors);
    assert.deepEqual(colors(snapshot(original)), originalColors);
    assert.equal(snapshot(solid).color, '#ff0000');
    assert.equal(snapshot(face).color, undefined);
  } finally {
    disposeModelObjects([
      solid,
      face,
      curve,
      vertex,
      inner,
      original,
      painted,
      repainted,
    ]);
  }
});

test('shared children keep independent appearance in differently painted groups', () => {
  const child = box(2, 4, 6).paint('#00ff00');
  const red = group([child]).paint('#ff0000');
  const blue = group([child]).paint('#0000ff');
  const assembly = group([red, blue, child]);
  try {
    const snapshot = createModelSnapshotter();
    const result = snapshot(assembly);
    const copies = [
      result.children[0].children[0],
      result.children[1].children[0],
      result.children[2],
    ];
    assert.deepEqual(
      copies.map(copy => copy.color),
      ['#ff0000', '#0000ff', '#00ff00'],
    );
    for (const copy of copies) {
      assert.equal(copy.nodeId, result.children[2].nodeId);
      assert.equal(copy.mesh, result.children[2].mesh);
    }
    assert.equal(snapshot(child).color, '#00ff00');
  } finally {
    disposeModelObjects([child, red, blue, assembly]);
  }
});

test('painting a related assembly preserves member identities and exposed topology', () => {
  const base = box(10, 10, 10);
  const cap = box(4, 2, 4).relate(self => self.on(base.up));
  const assembly = group([base, cap]).expose({part: cap, mount: base.down});
  const painted = assembly.paint('#aabbcc');
  try {
    const snapshot = createModelSnapshotter();
    const before = snapshot(assembly);
    const after = snapshot(painted);
    assert.deepEqual(
      after.children,
      before.children.map(child => ({...child, color: '#aabbcc'})),
    );
    const [x, y, z] = after.children[1].transform.position;
    assert.ok(Math.hypot(x, y - 6, z) < 1e-8);
    assert.deepEqual(
      defined(modelElementReference(painted.mount)).transform,
      defined(modelElementReference(assembly.mount)).transform,
    );
    assert.equal(defined(modelTopologyReference(painted.part)).model, painted);
    assert.equal(defined(modelTopologyReference(painted.part)).geometry, cap);
    assert.deepEqual(
      painted.part.edges().map(edge => edge.id),
      cap.edges().map(edge => edge.id),
    );
    assert.equal(snapshot(cap).color, undefined);
  } finally {
    disposeModelObjects([base, cap, assembly, painted]);
  }
});

test('empty groups can be painted without inventing geometry', () => {
  const empty = group([]);
  const painted = empty.paint('#ff0000');
  try {
    const snapshot = createModelSnapshotter();
    assert.deepEqual(snapshot(painted).children, []);
    assert.equal(snapshot(painted).mesh, undefined);
    assert.equal(snapshot(painted).color, '#ff0000');
    assert.equal(snapshot(empty).color, undefined);
  } finally {
    disposeModelObjects([empty, painted]);
  }
});

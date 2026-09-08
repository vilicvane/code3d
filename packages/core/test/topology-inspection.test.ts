import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box, cylinder, sphere} from '../bld/node/index.js';
import {
  retainModelGeometry,
  createModelSnapshotter,
  rotateVector,
  modelObjectRuntimeInfo,
  modelTopologyIds,
  xyzRotation,
  type TopologyInspectionOptions,
} from '../bld/tooling/index.js';
import {modelObject, disposeModelObjects} from './model-test.ts';

test('retained topology reports exact IDs, native measurements and incidence after author values are released', () => {
  const model = box(10, 6, 8);
  const nodeId = modelObjectRuntimeInfo(modelObject(model)).nodeId;
  const geometry = retainModelGeometry([modelObject(model)]);
  disposeModelObjects([model]);
  try {
    const result = geometry.inspect(nodeId, {limit: 100});
    assert.deepEqual(result.counts, {vertex: 8, edge: 12, surface: 6});
    assert.equal(result.items.length, 26);
    assert.ok(result.items.every(item => !item.unavailable));
    const faces = result.items.filter(item => item.kind === 'surface');
    assert.ok(
      Math.abs(
        faces.reduce((sum, face) => sum + face.geometry!.area!, 0) - 376,
      ) < 1e-7,
    );
    assert.ok(
      faces.every(
        face =>
          face.edges?.length === 4 &&
          Math.abs(Math.hypot(...face.geometry!.normal!) - 1) < 1e-10,
      ),
    );
    assert.ok(
      result.items
        .filter(item => item.kind === 'edge')
        .every(
          edge => edge.vertices?.length === 2 && edge.surfaces?.length === 2,
        ),
    );
    assert.ok(
      result.items
        .filter(item => item.kind === 'vertex')
        .every(vertex => vertex.edges?.length === 3),
    );
    const first = geometry.inspect(nodeId, {kind: 'edge', limit: 5});
    const next = geometry.inspect(nodeId, {
      kind: 'edge',
      offset: first.nextOffset!,
      limit: 200,
    });
    assert.deepEqual(
      [...first.items, ...next.items].map(item => item.id),
      result.items.filter(item => item.kind === 'edge').map(item => item.id),
    );
    assert.throws(
      () => geometry.inspect(nodeId, {kind: 'edge', ids: [999]}),
      /absent/,
    );
  } finally {
    geometry.dispose();
  }
  assert.throws(() => geometry.inspect(nodeId), /unavailable/);
});

test('rounded topology preserves number and path IDs and applies the same scene transform to geometry', () => {
  const base = box(10, 6, 8);
  const rounded = base.fillet(0.5, [1]);
  const shifted = base.originOffset(2, 0, 0);
  const models = [base, rounded, shifted].map(modelObject);
  const geometry = retainModelGeometry(models);
  try {
    const nodeId = modelObjectRuntimeInfo(models[1]).nodeId;
    const edges = geometry.inspect(nodeId, {kind: 'edge', limit: 200});
    assert.deepEqual(
      edges.items.map(edge => edge.id),
      modelTopologyIds(rounded, 'edge'),
    );
    assert.ok(edges.items.some(edge => Array.isArray(edge.id)));
    const id = modelObjectRuntimeInfo(models[2]).nodeId;
    const transform: TopologyInspectionOptions['transform'] = {
      position: [20, 0, 0],
      quaternion: xyzRotation([0, 90, 0]),
    };
    const moved = geometry.inspect(id, {kind: 'vertex', transform});
    assert.ok(moved.items.every(vertex => !vertex.unavailable));
    const mesh = createModelSnapshotter()(models[2]).mesh!;
    for (const [index, vertex] of moved.items.entries()) {
      const expected = rotateVector(
        [
          mesh.topologyVertices[index * 3],
          mesh.topologyVertices[index * 3 + 1],
          mesh.topologyVertices[index * 3 + 2],
        ],
        transform.quaternion,
      ).map((value, axis) => value + transform.position[axis]);
      assert.ok(
        vertex.geometry!.position!.every(
          (value, axis) => Math.abs(value - expected[axis]) < 1e-8,
        ),
      );
    }
  } finally {
    geometry.dispose();
    disposeModelObjects(models);
  }
});

test('analytic circles, cylinders and spheres expose axes and radii without pretending sampled normals are constant', () => {
  const models = [cylinder(3, 10), sphere(4)].map(modelObject);
  const geometry = retainModelGeometry(models);
  try {
    const tube = geometry.inspect(modelObjectRuntimeInfo(models[0]).nodeId, {
      limit: 100,
    });
    const curved = tube.items.find(item => item.geometry?.type === 'CYLINDER');
    assert.ok(curved, JSON.stringify(tube.items));
    assert.equal(curved.geometry!.radius, 3);
    assert.ok(curved.geometry!.axis);
    assert.equal(curved.geometry!.normal, undefined);
    assert.ok(curved.geometry!.normalSample);
    const circles = tube.items.filter(item => item.geometry?.type === 'CIRCLE');
    assert.equal(circles.length, 2);
    assert.ok(
      circles.every(
        circle =>
          Math.abs(circle.geometry!.length! - 6 * Math.PI) < 1e-7 &&
          circle.geometry!.radius === 3,
      ),
    );
    const ball = geometry.inspect(modelObjectRuntimeInfo(models[1]).nodeId, {
      kind: 'surface',
    });
    assert.equal(ball.items[0].geometry?.type, 'SPHERE');
    assert.equal(ball.items[0].geometry?.radius, 4);
    assert.ok(Math.abs(ball.items[0].geometry!.area! - 64 * Math.PI) < 1e-7);
  } finally {
    geometry.dispose();
    disposeModelObjects(models);
  }
});

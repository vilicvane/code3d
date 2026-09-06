import assert from 'node:assert/strict';
import test from 'node:test';

import {bezier, loft, rectangle} from '../bld/node/index.js';
import {disposeModelObjects} from '../bld/tooling/index.js';
import {clearKernelOperationCache} from '../bld/library/kernel-cache.js';
import * as replicad from 'replicad';
import {replicad as authorReplicad} from '../bld/node/replicad.js';
import {
  castOwnedShape3D,
  centeredBoxShape,
  shapeSubshapes,
} from '../bld/library/kernel-shapes.js';
import {
  filletEdges,
  initialShapeTopology,
  preserveShapeTopology,
  stableVertexData,
  topologyChildren,
} from '../bld/library/topology.js';

test('box construction releases temporary native points', t => {
  const oc = replicad.getOC();
  const points = [];
  t.mock.method(
    oc,
    'gp_Pnt',
    new Proxy(oc.gp_Pnt, {
      construct(target, args) {
        const point = Reflect.construct(target, args);
        points.push(point);
        return point;
      },
    }),
  );
  const shape = centeredBoxShape(30, 20, 4);
  try {
    assert.equal(points.length, 1);
    assert.ok(points[0].isDeleted());
    assert.equal(shape.mesh().triangles.length, 36);
  } finally {
    shape.delete();
  }
});

test('B-Rep deserialization releases its original handle while retaining independent geometry', t => {
  const oc = replicad.getOC();
  const source = replicad.makeBox([0, 0, 0], [30, 20, 4]);
  const handles = [];
  const read = oc.BRepToolsWrapper.Read;
  t.mock.method(oc.BRepToolsWrapper, 'Read', (...args) => {
    const result = read(...args);
    handles.push(result);
    return result;
  });
  try {
    const brep = source.serialize();
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const shape = authorReplicad.deserializeShape(brep);
      try {
        assert.ok(handles.at(-1).isDeleted());
        assert.equal(shape.mesh().triangles.length, 36);
      } finally {
        shape.delete();
      }
    }
  } finally {
    source.delete();
    for (const handle of handles) if (!handle.isDeleted()) handle.delete();
  }
});

test('topology traversal releases every native explorer result, including duplicates', t => {
  const oc = replicad.getOC();
  const shape = replicad.makeBox([0, 0, 0], [30, 20, 4]);
  const handles = [];
  const current = oc.TopExp_Explorer.prototype.Current;
  t.mock.method(oc.TopExp_Explorer.prototype, 'Current', function (...args) {
    const handle = current.apply(this, args);
    handles.push(handle);
    return handle;
  });
  let rounded;
  try {
    const topology = initialShapeTopology(shape);
    assert.equal(topology.vertices.ids.length, 8);
    assert.equal(topology.edges.ids.length, 12);
    assert.equal(topology.surfaces.ids.length, 6);
    const faceEdges = topologyChildren(
      shape,
      topology,
      {kind: 'surface', id: topology.surfaces.ids[0]},
      'edge',
    );
    assert.equal(faceEdges.length, 4);
    assert.equal(
      topologyChildren(
        shape,
        topology,
        {kind: 'edge', id: faceEdges[0]},
        'vertex',
      ).length,
      2,
    );
    assert.deepEqual(preserveShapeTopology(shape, topology), topology);
    rounded = filletEdges(shape, topology, 1);
    const points = stableVertexData(rounded.shape, rounded.topology.vertices);
    assert.ok(points.positions.length > 0);
    assert.ok(rounded.shape.mesh().triangles.length > 0);
    assert.ok(
      handles.length > 100,
      'exercise repeated native topology handles',
    );
    assert.equal(handles.filter(handle => !handle.isDeleted()).length, 0);
  } finally {
    rounded?.shape.delete();
    shape.delete();
    // Keep a failing regression from leaking the native objects it detects.
    for (const handle of handles) if (!handle.isDeleted()) handle.delete();
  }
});

test('failed topology traversal releases its partial result and explorer', t => {
  const oc = replicad.getOC();
  const shape = replicad.makeBox([0, 0, 0], [30, 20, 4]);
  const handles = [];
  const vertices = [];
  let explorer;
  let visits = 0;
  const current = oc.TopExp_Explorer.prototype.Current;
  const vertex = oc.TopoDS.Vertex;
  t.mock.method(oc.TopExp_Explorer.prototype, 'Current', function (...args) {
    explorer = this;
    if (++visits === 5) throw new Error('Interrupted traversal');
    const handle = current.apply(this, args);
    handles.push(handle);
    return handle;
  });
  t.mock.method(oc.TopoDS, 'Vertex', (...args) => {
    const result = vertex(...args);
    vertices.push(result);
    return result;
  });
  try {
    assert.throws(
      () => shapeSubshapes(shape, 'vertex'),
      /Interrupted traversal/,
    );
    assert.ok(vertices.length > 0);
    for (const handle of [...handles, ...vertices, explorer]) {
      assert.ok(handle.isDeleted());
    }
    assert.ok(shape.mesh().triangles.length > 0);
  } finally {
    shape.delete();
  }
});

test('failed solid casting releases both acquired handles and preserves borrowed geometry', t => {
  const oc = replicad.getOC();
  const shape = replicad.makeBox([0, 0, 0], [30, 20, 4]);
  const faces = shapeSubshapes(shape, 'face');
  const raw = faces[0].wrapped.clone();
  const face = oc.TopoDS.Face;
  let casted;
  t.mock.method(oc.TopoDS, 'Face', (...args) => (casted = face(...args)));
  try {
    assert.throws(() => castOwnedShape3D(raw), /not a 3D shape/);
    assert.ok(raw.isDeleted());
    assert.ok(casted.isDeleted());
    assert.ok(faces[0].mesh().triangles.length > 0);
  } finally {
    faces.forEach(face => face.delete());
    shape.delete();
  }
});

for (const failHistory of [false, true]) {
  test(`loft releases cap and generated history handles${failHistory ? ' on failure' : ''}`, t => {
    clearKernelOperationCache();
    const spine = bezier([
      [0, 0, 0],
      [0, 8, 0],
      [10, 16, 0],
      [10, 24, 0],
    ]);
    const start = rectangle(6, 4).relate(p => p.plane.on(spine.start).flip());
    const end = rectangle(4, 3).relate(p => p.plane.on(spine.end).flip());
    const oc = replicad.getOC();
    const handles = [];
    let generatedCalls = 0;
    const prototype = oc.BRepOffsetAPI_MakePipeShell.prototype;
    for (const method of [
      'Shape',
      'FirstShape',
      'LastShape',
      'Modified',
      'Generated',
    ]) {
      const original = prototype[method];
      t.mock.method(prototype, method, function (...args) {
        if (method === 'Generated' && failHistory && ++generatedCalls === 2)
          throw new Error('Interrupted loft history');
        const result = original.apply(this, args);
        handles.push(result);
        if (method === 'Modified' || method === 'Generated') {
          const first = result.First;
          result.First = function () {
            const handle = first.call(this);
            handles.push(handle);
            return handle;
          };
        }
        return result;
      });
    }
    let result;
    try {
      if (failHistory)
        assert.throws(
          () => loft([start, end], {spine}),
          /Interrupted loft history/,
        );
      else {
        result = loft([start, end], {spine});
        assert.deepEqual(result.surface([1, 1]).id, [1, 1]);
        assert.ok(result.geometry.value.shape.mesh().triangles.length > 0);
      }
      assert.ok(handles.length > 5);
      assert.ok(handles.every(handle => handle.isDeleted()));
      assert.ok(start.geometry.value.shape.mesh().triangles.length > 0);
      assert.ok(end.geometry.value.shape.mesh().triangles.length > 0);
    } finally {
      disposeModelObjects([spine, start, end, ...(result ? [result] : [])]);
      clearKernelOperationCache();
      for (const handle of handles) if (!handle.isDeleted()) handle.delete();
    }
  });
}

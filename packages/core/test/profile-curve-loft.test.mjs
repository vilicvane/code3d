import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  bezier,
  circle,
  group,
  line,
  loft,
  point,
  rectangle,
  regularPolygon,
} from '../bld/node/index.js';
import {disposeModelObjects} from '../bld/tooling/index.js';

test('constructs renderable planar profiles, curves, and points', () => {
  const models = [
    circle(4),
    rectangle(8, 5),
    regularPolygon(5, 6, 30),
    line([0, 0, 0], [3, 4, 0]),
    point([1, 2, 3]),
  ];

  try {
    const [
      circleSnapshot,
      rectangleSnapshot,
      polygonSnapshot,
      lineSnapshot,
      pointSnapshot,
    ] = models.map(model => model.toSnapshot());
    assert.equal(circleSnapshot.kind, 'face');
    assert.ok(circleSnapshot.mesh.triangles.length > 0);
    assert.equal(rectangleSnapshot.kind, 'face');
    assert.ok(rectangleSnapshot.mesh.triangles.length > 0);
    assert.equal(polygonSnapshot.kind, 'face');
    assert.ok(polygonSnapshot.mesh.triangles.length > 0);
    assert.equal(lineSnapshot.kind, 'edge');
    assert.equal(lineSnapshot.mesh.triangles.length, 0);
    assert.ok(lineSnapshot.mesh.edges.length > 0);
    assert.equal(pointSnapshot.kind, 'vertex');
    assert.deepEqual([...pointSnapshot.mesh.topologyVertices], [1, 2, 3]);
  } finally {
    disposeModelObjects(models);
  }
});

test('uses face, edge, and vertex topology as relation anchors', () => {
  const face = circle(5);
  const edge = line([0, 0, 0], [6, 2, 0]);
  const vertex = point([2, 3, 4]);
  const faceRelated = circle(2).relate(self => self.on(face.surface(1)).flip());
  const edgeRelated = line(1, 0, 0).relate(self =>
    self.on(edge.edge(1)).flip(),
  );
  const vertexRelated = point().relate(self =>
    self.on(vertex.vertex(1)).flip(),
  );

  try {
    const constraints = [faceRelated, edgeRelated, vertexRelated].map(
      model => model.toSnapshot().constraints[0],
    );
    assert.deepEqual(
      constraints.map(constraint => constraint.target.kind),
      ['face', 'line', 'point'],
    );
    assert.deepEqual(
      constraints.map(constraint => constraint.source.kind),
      ['face', 'line', 'point'],
    );
    assert.deepEqual(
      constraints.map(constraint => constraint.target.name),
      ['S1', 'E1', 'V1'],
    );
    const relatedSnapshot = vertexRelated.toSnapshot();
    assert.deepEqual(relatedSnapshot.transform.position, [0, 0, 0]);
    assert.deepEqual(relatedSnapshot.compositionTransform.position, [2, 3, 4]);
  } finally {
    disposeModelObjects([
      face,
      edge,
      vertex,
      faceRelated,
      edgeRelated,
      vertexRelated,
    ]);
  }
});

test('resolves relation placement only inside a composition', () => {
  const target = point([2, 3, 4]);
  const related = point().relate(self => self.on(target.vertex(1)).flip());
  const assembly = group([target, related]);

  try {
    const standalone = related.toSnapshot();
    const assemblySnapshot = assembly.toSnapshot();
    assert.deepEqual(standalone.transform.position, [0, 0, 0]);
    assert.deepEqual(standalone.compositionTransform.position, [2, 3, 4]);
    assert.deepEqual(assemblySnapshot.transform.position, [0, 0, 0]);
    assert.deepEqual(
      assemblySnapshot.children[1].transform.position,
      [2, 3, 4],
    );
  } finally {
    disposeModelObjects([target, related, assembly]);
  }
});

test('lofts nonparallel planar profiles along a curved spine', () => {
  const spine = bezier([
    [0, 0, 0],
    [12, 7, 0],
    [10, 20, 9],
    [4, 28, 14],
  ]);
  const start = circle(4).relate(profile =>
    profile.plane.on(spine.start).flip(),
  );
  const end = rectangle(7, 4).relate(profile =>
    profile.plane.on(spine.end).flip(),
  );
  const result = loft([start, end], {spine});

  try {
    const startSnapshot = start.toSnapshot();
    const endSnapshot = end.toSnapshot();
    const resultSnapshot = result.toSnapshot();
    assert.deepEqual(startSnapshot.transform.quaternion, [0, 0, 0, 1]);
    assert.deepEqual(endSnapshot.transform.quaternion, [0, 0, 0, 1]);
    assert.notDeepEqual(
      startSnapshot.compositionTransform.quaternion,
      endSnapshot.compositionTransform.quaternion,
    );
    assert.equal(resultSnapshot.kind, 'solid');
    assert.equal(resultSnapshot.operation.kind, 'loft');
    assert.deepEqual(
      resultSnapshot.operation.inputs.map(input => input.role),
      ['receiver', 'section', 'spine'],
    );
    assert.ok(resultSnapshot.mesh.triangles.length > 0);
    assert.ok(resultSnapshot.mesh.surfaceGroups.length >= 3);
  } finally {
    disposeModelObjects([spine, start, end, result]);
  }
});

test('lofts planar sections without a spine', () => {
  const base = circle(4);
  const location = point([0, 12, 0]);
  const top = rectangle(5, 3).relate(profile =>
    profile.plane.on(location).flip(),
  );
  const result = loft([base, top]);

  try {
    assert.ok(result.toSnapshot().mesh.triangles.length > 0);
  } finally {
    disposeModelObjects([base, location, top, result]);
  }
});

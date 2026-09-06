import assert from 'node:assert/strict';
import {test} from 'node:test';
import {bezier, box, circle, group, line, point} from '../bld/node/index.js';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelElementReference,
  modelTopologyReference,
  modelTopologyIds,
  rotateVector,
  transformsAreEquivalent,
} from '../bld/tooling/index.js';

const position = anchor => modelElementReference(anchor).transform.position;
const ids = elements => elements.map(element => element.id);
const near = (actual, expected) =>
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-5,
      `${actual} != ${expected}`,
    ),
  );

test('subtopology navigation preserves original IDs and restricts membership', () => {
  const body = box(10, 20, 30);
  try {
    const face = body.surface(1);
    assert.equal(face.edges().length, 4);
    assert.equal(face.vertices().length, 4);
    const edge = face.edges()[0];
    assert.equal(edge.vertices().length, 2);
    assert.deepEqual(ids(edge.edges()), [edge.id]);
    const vertex = edge.vertices()[0];
    assert.deepEqual(ids(vertex.vertices()), [vertex.id]);
    assert.deepEqual(ids(face.surfaces()), [face.id]);
    assert.deepEqual(modelTopologyIds(face, 'edge'), ids(face.edges()));
    const [first, second] = face.edges();
    assert.deepEqual(ids(face.edges([second.id, first.id, second.id])), [
      second.id,
      first.id,
      second.id,
    ]);
    assert.deepEqual(face.edges([]), []);
    const outside = body
      .edges()
      .find(candidate => !ids(face.edges()).includes(candidate.id));
    assert.throws(() => face.edge(outside.id), /does not belong/);
    assert.throws(() => face.edge(999), /Unknown or retired edge/);
    assert.equal(modelTopologyReference(face.edge(first.id)).geometry, body);
  } finally {
    disposeModelObjects([body]);
  }
});

test('geometry models expose queryable topology without model operations', () => {
  const models = [
    box(10, 20, 30),
    circle(4),
    line([1, 2, 3], [4, 6, 8]),
    point([3, 4, 5]),
  ];
  const assembly = group(models).expose({
    body: models[0],
    profile: models[1],
    path: models[2],
    location: models[3],
  });
  try {
    for (const [name, kind, model] of [
      ['body', 'solid', models[0]],
      ['profile', 'surface', models[1]],
      ['path', 'edge', models[2]],
      ['location', 'vertex', models[3]],
    ]) {
      const value = assembly[name];
      assert.equal(value.kind, kind);
      assert.equal(modelTopologyReference(value).model, assembly);
      assert.equal(modelTopologyReference(value).geometry, model);
      near(position(value.center), position(model.center));
      for (const method of [
        'relate',
        'expose',
        'paint',
        'origin',
        'rotate',
        'scaled',
        'fillet',
        'shell',
      ])
        assert.equal(value[method], undefined);
    }
    assert.equal(assembly.body.surfaces().length, 6);
    assert.equal(assembly.profile.edges().length, 1);
    near(position(assembly.path.start), [1, 2, 3]);
    near(position(assembly.path.end), [4, 6, 8]);
    assert.equal(modelElementReference(assembly.body.top).model, assembly);
  } finally {
    disposeModelObjects([...models, assembly]);
  }
});

test('nested exposure and chained constraints move the containing assembly', () => {
  const body = box(10, 20, 30);
  const inner = group([body]).expose({body});
  const target = point([40, 50, 60]);
  const moved = inner.relate(self => self.body.center.on(target));
  const outer = group([moved]).expose({
    mount: moved.body.surface(1),
    component: moved,
  });
  const anchor = point([10, 0, 0]);
  const placed = outer.relate(self => self.mount.center.on(anchor));
  try {
    near(position(outer.mount.center), [35, 50, 60]);
    near(position(outer.component.body.center), [40, 50, 60]);
    const edge = outer.mount.edges()[0];
    assert.equal(modelTopologyReference(edge).model, outer);
    assert.equal(modelTopologyReference(edge).geometry, body);
    assert.equal(modelElementReference(edge.midpoint).model, outer);
    const snapshot = createModelSnapshotter()(placed);
    near(snapshot.compositionTransform.position, [-25, -50, -60]);
    assert.equal(snapshot.constraints[0].source.nodeId, snapshot.nodeId);
  } finally {
    disposeModelObjects([body, inner, target, moved, outer, anchor, placed]);
  }
});

test('the same geometry retains independent placement in two exposed occurrences', () => {
  const body = box(10, 20, 30);
  const part = group([body]).expose({body});
  const leftTarget = point([-20, 0, 0]);
  const rightTarget = point([20, 0, 0]);
  const left = part.relate(self => self.body.center.on(leftTarget));
  const right = part.relate(self => self.body.center.on(rightTarget));
  const assembly = group([left, right]).expose({
    leftBody: left.body,
    rightBody: right.body,
  });
  try {
    const a = assembly.leftBody.surface(1);
    const b = assembly.rightBody.surface(1);
    assert.equal(a.id, b.id);
    assert.equal(
      modelTopologyReference(a).geometry,
      modelTopologyReference(b).geometry,
    );
    near(position(a.center), [-25, 0, 0]);
    near(position(b.center), [15, 0, 0]);
    assert.throws(
      () => group([left, right]).expose({ambiguous: body}),
      /multiple occurrences/,
    );
  } finally {
    disposeModelObjects([
      body,
      part,
      leftTarget,
      rightTarget,
      left,
      right,
      assembly,
    ]);
  }
});

test('closed edges have their actual topology vertices and distinct sampled points', () => {
  const profile = circle(4);
  try {
    const edge = profile.edge(1);
    assert.equal(edge.vertices().length, 1);
    near(position(edge.start), position(edge.end));
    near(position(edge.center), [0, 0, 0]);
    assert.ok(Math.hypot(...position(edge.midpoint)) > 3.9);
  } finally {
    disposeModelObjects([profile]);
  }
});

test('exposed model members retain overrides without colliding with reference internals', () => {
  const location = point([10, 20, 30]);
  const path = line([0, 0, 0], [5, 0, 0]).expose({
    start: location.center,
    reference: location.center,
    topology: location.center,
  });
  const assembly = group([path]).expose({path});
  try {
    for (const name of ['start', 'reference', 'topology']) {
      near(position(assembly.path[name]), [10, 20, 30]);
      assert.equal(modelElementReference(assembly.path[name]).model, assembly);
    }
    near(position(assembly.path.edge(1).start), [0, 0, 0]);
    assert.equal(modelTopologyReference(assembly.path).geometry, path);
  } finally {
    disposeModelObjects([location, path, assembly]);
  }
});

test('centers and chained geometry follow rotation and scaling without changing their basis', () => {
  const path = bezier([
    [0, 0, 0],
    [20, 4, 0],
    [3, 9, 2],
  ]);
  const rotated = path.rotate(20, 35, 70).scaled(2);
  const exposed = path.expose({path}).rotate(20, 35, 70).scaled(2);
  try {
    const original = path.edge(1).center;
    const frame = modelElementReference(rotated.edge(1).center).transform;
    near(
      position(rotated.edge(1).center),
      rotateVector(position(original), frame.quaternion).map(
        value => value * 2,
      ),
    );
    near(position(exposed.path.center), position(rotated.center));
    near(
      position(exposed.path.edge(1).center),
      position(rotated.edge(1).center),
    );
    near(position(exposed.path.end), position(rotated.end));
    assert.notDeepEqual(
      position(path.edge(1).center),
      position(path.edge(1).midpoint),
    );
  } finally {
    disposeModelObjects([path, rotated, exposed]);
  }
});

test('a cached transformed geometry retains its center basis after previous values are disposed', () => {
  const create = () =>
    bezier([
      [0, 0, 0],
      [12, 4, 0],
      [3, 9, 2],
    ])
      .rotate(20, 35, 70)
      .scaled(2);
  const first = create();
  const expected = position(first.edge(1).center);
  disposeModelObjects([first]);
  const second = create();
  try {
    near(position(second.edge(1).center), expected);
  } finally {
    disposeModelObjects([second]);
  }
});

test('querying before or after a geometry transform preserves the same anchor frames', () => {
  const body = box(10, 20, 30);
  const selected = body.expose({
    mount: body.surface(1),
    rim: body.edge(1),
    corner: body.vertex(1),
  });
  const before = selected.rotate(20, 35, 70).scaled(2);
  const after = body.rotate(20, 35, 70).scaled(2);
  try {
    for (const [a, b] of [
      [before.mount, after.surface(1)],
      [before.rim, after.edge(1)],
      [before.corner, after.vertex(1)],
      [before.rim.start, after.edge(1).start],
      [before.mount.center, after.surface(1).center],
    ])
      assert.ok(
        transformsAreEquivalent(
          modelElementReference(a).transform,
          modelElementReference(b).transform,
        ),
      );
  } finally {
    disposeModelObjects([body, selected, before, after]);
  }
});

test('exposing a model uses the same geometric anchor as its topology element', () => {
  const profile = circle(4).origin(0, 10, 0);
  const path = bezier([
    [0, 0, 0],
    [12, 4, 0],
    [3, 9, 2],
  ]).origin(8, 8, 8);
  const location = point([1, 2, 3]).origin(9, 9, 9);
  const assembly = group([profile, path, location]).expose({
    profile,
    path,
    location,
  });
  try {
    for (const [exposed, selected] of [
      [assembly.profile, profile.surface(1)],
      [assembly.path, path.edge(1)],
      [assembly.location, location.vertex(1)],
    ]) {
      assert.ok(
        transformsAreEquivalent(
          modelElementReference(exposed).transform,
          modelElementReference(selected).transform,
        ),
      );
    }
  } finally {
    disposeModelObjects([profile, path, location, assembly]);
  }
});

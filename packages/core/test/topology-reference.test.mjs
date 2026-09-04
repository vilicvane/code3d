import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box} from '../bld/node/index.js';
import {
  disposeModelObjects,
  modelTopologyReference,
} from '../bld/tooling/index.js';

test('resolves stable vertex, edge, and surface references', () => {
  const base = box(20, 10, 15);
  const scaled = base.scaled(2);
  const rounded = base.fillet(1, [1]);

  try {
    assert.deepEqual(modelTopologyReference(base.vertex(1)), {
      model: base,
      kind: 'vertex',
      id: 1,
    });
    assert.deepEqual(modelTopologyReference(base.edge(1)), {
      model: base,
      kind: 'edge',
      id: 1,
    });
    assert.deepEqual(modelTopologyReference(base.surface(1)), {
      model: base,
      kind: 'surface',
      id: 1,
    });
    assert.throws(() => base.vertex(9), /Unknown or retired vertex V9/);
    assert.throws(() => base.edge(13), /Unknown or retired edge E13/);
    assert.throws(() => base.surface(7), /Unknown or retired surface S7/);

    const baseSnapshot = base.toSnapshot();
    const scaledSnapshot = scaled.toSnapshot();
    const roundedSnapshot = rounded.toSnapshot();
    assert.deepEqual(topologyIds(scaledSnapshot), topologyIds(baseSnapshot));
    assert.deepEqual(vertexIds(baseSnapshot), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(vertexIds(roundedSnapshot).some(id => id > 8));
    assert.deepEqual(surfaceIds(baseSnapshot), [1, 2, 3, 4, 5, 6]);
    assert.ok(surfaceIds(roundedSnapshot).some(id => id > 6));
    assert.deepEqual(
      referenceIds(rounded.vertices()),
      vertexIds(roundedSnapshot),
    );
    assert.deepEqual(referenceIds(rounded.edges()), edgeIds(roundedSnapshot));
    assert.deepEqual(
      referenceIds(rounded.surfaces()),
      surfaceIds(roundedSnapshot),
    );
  } finally {
    disposeModelObjects([base, scaled, rounded]);
  }
});

test('resolves plural topology references in authored order', () => {
  const model = box(20, 10, 15);

  try {
    assert.deepEqual(model.vertices([3, 1]).map(modelTopologyReference), [
      {model, kind: 'vertex', id: 3},
      {model, kind: 'vertex', id: 1},
    ]);
    assert.deepEqual(model.edges([4, 2]).map(modelTopologyReference), [
      {model, kind: 'edge', id: 4},
      {model, kind: 'edge', id: 2},
    ]);
    assert.deepEqual(model.surfaces([6, 1]).map(modelTopologyReference), [
      {model, kind: 'surface', id: 6},
      {model, kind: 'surface', id: 1},
    ]);
    assert.deepEqual(referenceIds(model.vertices()), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(
      referenceIds(model.edges()),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    assert.deepEqual(referenceIds(model.surfaces()), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(model.vertices([]), []);
    assert.deepEqual(model.edges([]), []);
    assert.deepEqual(model.surfaces([]), []);
    assert.throws(() => model.vertices([9]), /Unknown or retired vertex V9/);
    assert.throws(() => model.edges([13]), /Unknown or retired edge E13/);
    assert.throws(() => model.surfaces([7]), /Unknown or retired surface S7/);
  } finally {
    disposeModelObjects([model]);
  }
});

function topologyIds(snapshot) {
  return {
    vertices: vertexIds(snapshot),
    edges: edgeIds(snapshot),
    surfaces: surfaceIds(snapshot),
  };
}

function referenceIds(references) {
  return references.map(reference => modelTopologyReference(reference)?.id);
}

function vertexIds(snapshot) {
  return [...snapshot.mesh.vertexIds];
}

function edgeIds(snapshot) {
  return [...new Set(snapshot.mesh.edgeGroups.map(group => group.edgeId))];
}

function surfaceIds(snapshot) {
  return [
    ...new Set(snapshot.mesh.surfaceGroups.map(group => group.surfaceId)),
  ];
}

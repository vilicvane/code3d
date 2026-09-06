import type {ModelSnapshotObject} from '@code3d/core/tooling';
import type {Anchor} from '@code3d/core';
import {defined} from '../../../test/assert.ts';
import {
  createModelSnapshotter,
  disposeModelObjects,
  modelGeometry,
} from './model-test.ts';

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box, cylinder, sphere} from '../bld/node/index.js';
import {modelTopologyReference} from '../bld/tooling/index.js';

test('resolves stable vertex, edge, and surface references', () => {
  const snapshotModel = createModelSnapshotter();
  const base = box(20, 10, 15);
  const scaled = base.scaled(2);
  const rounded = base.fillet(1, [1]);

  try {
    assert.deepEqual(modelTopologyReference(base.vertex(1)), {
      model: base,
      geometry: base,
      transform: identityTransform,
      kind: 'vertex',
      id: 1,
    });
    assert.deepEqual(modelTopologyReference(base.edge(1)), {
      model: base,
      geometry: base,
      transform: identityTransform,
      kind: 'edge',
      id: 1,
    });
    assert.deepEqual(modelTopologyReference(base.surface(1)), {
      model: base,
      geometry: base,
      transform: identityTransform,
      kind: 'surface',
      id: 1,
    });
    assert.throws(() => base.vertex(9), /Unknown or retired vertex V9/);
    assert.throws(() => base.edge(13), /Unknown or retired edge E13/);
    assert.throws(() => base.surface(7), /Unknown or retired surface S7/);

    const baseSnapshot = snapshotModel(base);
    const scaledSnapshot = snapshotModel(scaled);
    const roundedSnapshot = snapshotModel(rounded);
    assert.deepEqual(topologyIds(scaledSnapshot), topologyIds(baseSnapshot));
    assert.deepEqual(vertexIds(baseSnapshot), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(vertexIds(roundedSnapshot).some(id => typeof id === 'number'));
    assert.ok(vertexIds(roundedSnapshot).some(Array.isArray));
    assert.deepEqual(surfaceIds(baseSnapshot), [1, 2, 3, 4, 5, 6]);
    assert.ok(surfaceIds(roundedSnapshot).some(id => id === 1));
    assert.ok(surfaceIds(roundedSnapshot).some(Array.isArray));
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
      {
        model,
        geometry: model,
        transform: identityTransform,
        kind: 'vertex',
        id: 3,
      },
      {
        model,
        geometry: model,
        transform: identityTransform,
        kind: 'vertex',
        id: 1,
      },
    ]);
    assert.deepEqual(model.edges([4, 2]).map(modelTopologyReference), [
      {
        model,
        geometry: model,
        transform: identityTransform,
        kind: 'edge',
        id: 4,
      },
      {
        model,
        geometry: model,
        transform: identityTransform,
        kind: 'edge',
        id: 2,
      },
    ]);
    assert.deepEqual(model.surfaces([6, 1]).map(modelTopologyReference), [
      {
        model,
        geometry: model,
        transform: identityTransform,
        kind: 'surface',
        id: 6,
      },
      {
        model,
        geometry: model,
        transform: identityTransform,
        kind: 'surface',
        id: 1,
      },
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

test('resolves curved face anchors even when their centroids are off-surface', () => {
  const models = [cylinder(6, 12), sphere(6)];
  try {
    for (const model of models) {
      const surfaces = model.surfaces();
      const expectedIds = modelGeometry(model).value.topology.surfaces.ids;
      assert.deepEqual(referenceIds(surfaces), expectedIds);
      const exposed = model.expose(
        Object.fromEntries(
          surfaces.map(surface => [`surface${surface.id}`, surface]),
        ),
      );
      const snapshot = createModelSnapshotter()(exposed);
      for (const id of expectedIds) {
        const element = snapshot.elements.find(
          element => element.name === `surface${id}`,
        );
        assert.ok(element);
        assert.ok(element.transform.position.every(Number.isFinite));
        assert.ok(element.transform.quaternion.every(Number.isFinite));
      }
    }
  } finally {
    disposeModelObjects(models);
  }
});

function topologyIds(snapshot: ModelSnapshotObject) {
  return {
    vertices: vertexIds(snapshot),
    edges: edgeIds(snapshot),
    surfaces: surfaceIds(snapshot),
  };
}

function referenceIds(references: readonly Anchor[]) {
  return references.map(reference => {
    const value = defined(modelTopologyReference(reference));
    assert.notEqual(value.kind, 'solid');
    assert.ok('id' in value);
    return value.id;
  });
}

function vertexIds(snapshot: ModelSnapshotObject) {
  return [...defined(snapshot.mesh).vertexIds];
}

function edgeIds(snapshot: ModelSnapshotObject) {
  return [
    ...new Set(defined(snapshot.mesh).edgeGroups.map(group => group.edgeId)),
  ];
}

function surfaceIds(snapshot: ModelSnapshotObject) {
  return [
    ...new Set(
      defined(snapshot.mesh).surfaceGroups.map(group => group.surfaceId),
    ),
  ];
}

const identityTransform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

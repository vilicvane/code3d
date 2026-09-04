import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box} from '../bld/node/index.js';
import {
  disposeModelObjects,
  modelTopologyReference,
} from '../bld/tooling/index.js';

test('resolves stable edge and surface references', () => {
  const base = box(20, 10, 15);
  const scaled = base.scaled(2);
  const rounded = base.fillet(1, [1]);

  try {
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
    assert.throws(() => base.edge(13), /Unknown or retired edge E13/);
    assert.throws(() => base.surface(7), /Unknown or retired surface S7/);

    const baseSnapshot = base.toSnapshot();
    const scaledSnapshot = scaled.toSnapshot();
    const roundedSnapshot = rounded.toSnapshot();
    assert.deepEqual(
      topologyIds(scaledSnapshot),
      topologyIds(baseSnapshot),
    );
    assert.deepEqual(surfaceIds(baseSnapshot), [1, 2, 3, 4, 5, 6]);
    assert.ok(surfaceIds(roundedSnapshot).some(id => id > 6));
  } finally {
    disposeModelObjects([base, scaled, rounded]);
  }
});

function topologyIds(snapshot) {
  return {
    edges: [...new Set(snapshot.mesh.edgeGroups.map(group => group.edgeId))],
    surfaces: surfaceIds(snapshot),
  };
}

function surfaceIds(snapshot) {
  return [
    ...new Set(snapshot.mesh.surfaceGroups.map(group => group.surfaceId)),
  ];
}

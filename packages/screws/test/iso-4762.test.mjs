import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createModelSnapshotter,
  disposeModelObjects,
} from '@code3d/core/tooling';

import * as screws from '../bld/library/index.js';

const {ISO4762} = screws;

test('keeps the thread primitive private to the screws package', () => {
  assert.deepEqual(Object.keys(screws), ['ISO4762']);
  assert.equal('helicalThread' in screws, false);
});

test('ISO 4762 screws build through the package-local thread primitive', () => {
  const screw = ISO4762.screw('M6', 18);

  try {
    const snapshot = createModelSnapshotter()(screw);
    assert.equal(snapshot.kind, 'solid');
    assert.ok(snapshot.mesh.triangles.length > 0);
  } finally {
    disposeModelObjects([screw]);
  }
});

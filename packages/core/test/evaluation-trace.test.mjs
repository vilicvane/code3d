import assert from 'node:assert/strict';
import {test} from 'node:test';
import {box} from '../bld/node/index.js';
import {
  beginModelEvaluation,
  createModelSnapshotter,
  disposeModelObjects,
  instrumentConstraint,
  instrumentModelOperation,
} from '../bld/tooling/index.js';

function instrumentation(start) {
  const sourceRef = {file: '/model.ts', start, end: start + 10};
  return {
    siteId: `site-${start}`,
    execution: 1,
    order: 1,
    sourceRef,
    parameters: [
      {
        operation: 'box',
        argument: 'width',
        value: 10,
        operationRef: sourceRef,
        expressionRef: sourceRef,
        target: {
          id: `parameter-${start}`,
          label: 'width',
          kind: 'length',
          value: 10,
          sourceRef,
        },
        sensitivity: 1,
      },
    ],
  };
}

test('starts fresh provenance for a retained model without changing its geometry or snapshots', () => {
  beginModelEvaluation();
  const model = box(10, 12, 14);
  try {
    const firstTrace = instrumentation(0);
    instrumentModelOperation(model, firstTrace);
    const first = createModelSnapshotter()(model);
    assert.deepEqual(first.sourceRefs, [firstTrace.sourceRef]);
    assert.deepEqual(first.parameters, firstTrace.parameters);

    beginModelEvaluation();
    const fresh = createModelSnapshotter()(model);
    assert.deepEqual(fresh.sourceRefs, []);
    assert.deepEqual(fresh.parameters, []);
    assert.equal(fresh.operation.sourceRef, undefined);
    assert.equal(fresh.operation.siteId, undefined);
    assert.equal(fresh.nodeId, first.nodeId);
    assert.deepEqual(fresh.mesh, first.mesh);

    const secondTrace = instrumentation(100);
    instrumentModelOperation(model, secondTrace);
    const second = createModelSnapshotter()(model);
    assert.deepEqual(second.sourceRefs, [secondTrace.sourceRef]);
    assert.deepEqual(second.parameters, secondTrace.parameters);
    assert.equal(second.operation.siteId, secondTrace.siteId);
    assert.deepEqual(first.sourceRefs, [firstTrace.sourceRef]);
    assert.deepEqual(first.operation.sourceRef, firstTrace.sourceRef);
  } finally {
    disposeModelObjects([model]);
  }
});

test('clears cached constraint provenance without losing the stored relation or offset', () => {
  beginModelEvaluation();
  const base = box(10, 12, 14);
  const target = box(20, 24, 28);
  const trace = instrumentation(10);
  let constraint;
  const related = base.relate(copy => {
    constraint = copy.on(target.down).offset(2, 3, 4);
    instrumentConstraint(constraint, trace.sourceRef, trace.parameters);
    return constraint;
  });
  try {
    const first = createModelSnapshotter()(related);
    assert.deepEqual(first.constraints[0].sourceRefs, [trace.sourceRef]);
    assert.deepEqual(first.parameters, trace.parameters);

    beginModelEvaluation();
    const second = createModelSnapshotter()(related);
    assert.deepEqual(second.constraints[0].sourceRefs, []);
    assert.deepEqual(second.constraints[0].parameters, []);
    assert.deepEqual(second.parameters, []);
    assert.deepEqual(second.compositionTransform, first.compositionTransform);
    assert.deepEqual(second.constraints[0].offset, [2, 3, 4]);
    assert.deepEqual(second.mesh, first.mesh);
    // A cached Constraint also copies only the current evaluation's metadata.
    const shifted = constraint.offset(1, 0, 0);
    assert.deepEqual(shifted.sourceRefs, []);
    assert.deepEqual(shifted.parameters, []);
  } finally {
    disposeModelObjects([base, target, related]);
  }
});

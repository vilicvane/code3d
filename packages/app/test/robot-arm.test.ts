import assert from 'node:assert/strict';
import {test} from 'node:test';
import {replicad} from '@code3d/core/replicad';
import type {Shape3D} from 'replicad';
import {
  beginModelInputs,
  composeTransforms,
  createModelSnapshotter,
  disposeModelObjects,
  quaternionAxisAngle,
  type ModelObject,
  type ModelSnapshotObject,
  type RigidTransform,
} from '@code3d/core/tooling';
import {modelGeometry} from '../../core/test/model-test.ts';

const identity: RigidTransform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
};

test('robot arm solids stay clear at default and combined travel limits', async () => {
  const retained: ModelObject[] = [];
  const poses = [
    {},
    ...[-45, 0, 45].flatMap(Shoulder =>
      [-110, -50, 10].flatMap(Elbow =>
        [-65, 0, 65].map((Wrist, index) => ({
          Shoulder,
          Elbow,
          Wrist,
          'Base yaw': index * 180 - 180,
          'Grip opening': index % 2 ? 4 : 28,
        })),
      ),
    ),
  ];
  let intersections = 0;
  try {
    for (const [index, inputs] of poses.entries()) {
      const scope = beginModelInputs(inputs);
      let model: ModelObject;
      try {
        ({default: model} = await import(
          new URL(
            `../examples/assemblies/robot-arm.ts?pose=${index}`,
            import.meta.url,
          ).href
        ));
        retained.push(model);
        assert.equal(
          scope.definitions.size,
          5,
          'Each pose re-evaluates the example inputs',
        );
      } finally {
        scope.finish();
      }
      const solids: Array<{
        path: string;
        shape: Shape3D;
        bounds: Shape3D['boundingBox']['bounds'];
      }> = [];
      function visit(
        value: ModelObject,
        node: ModelSnapshotObject,
        parent: RigidTransform,
        path: string,
      ) {
        const transform = composeTransforms(parent, node.transform);
        if (node.kind === 'solid') {
          const {axis, angleDegrees} = quaternionAxisAngle(
            transform.quaternion,
          );
          const shape = modelGeometry(value)
            .value.shape.asShape3D()
            .clone()
            .rotate(angleDegrees, [0, 0, 0], [...axis])
            .translate([...transform.position]);
          const box = shape.boundingBox;
          solids.push({path, shape, bounds: box.bounds});
          box.delete();
        }
        const children = Reflect.get(
          value,
          'children',
        ) as readonly ModelObject[];
        children.forEach((child, i) =>
          visit(
            child,
            node.children[i],
            transform,
            `${path}/${node.children[i].name}[${i}]`,
          ),
        );
      }
      try {
        visit(model, createModelSnapshotter()(model), identity, 'Robot arm');
        assert.equal(solids.length, 23);
        for (let a = 0; a < solids.length; a++) {
          for (let b = a + 1; b < solids.length; b++) {
            const first = solids[a],
              second = solids[b];
            if (
              [0, 1, 2].some(
                axis =>
                  Math.min(first.bounds[1][axis], second.bounds[1][axis]) -
                    Math.max(first.bounds[0][axis], second.bounds[0][axis]) <
                  1e-5,
              )
            )
              continue;
            const common = first.shape.intersect(second.shape);
            try {
              const volume = replicad.measureVolume(common);
              assert.ok(
                volume < 1e-5,
                `${JSON.stringify(inputs)}: ${first.path} intersects ${second.path} by ${volume}`,
              );
              intersections++;
            } finally {
              common.delete();
            }
          }
        }
      } finally {
        solids.forEach(solid => solid.shape.delete());
      }
    }
    assert.ok(
      intersections > 0,
      'Use native intersection checks, including pin/bore pairs',
    );
  } finally {
    disposeModelObjects(retained);
  }
});

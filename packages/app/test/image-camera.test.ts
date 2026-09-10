import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Box3, Vector3} from 'three';
import {createViewCamera} from '../src/rendering/view-camera.ts';
import {renderViewNames, resolveRenderView} from '@code3d/agent';
import {orientImageCamera} from '../src/rendering/image-camera.ts';

test('image cameras fit translated scene bounds for every direction and image aspect', () => {
  const bounds = new Box3(new Vector3(90, -8, 40), new Vector3(130, 12, 42));
  const center = bounds.getCenter(new Vector3());
  for (const projection of ['perspective', 'orthographic'] as const) {
    for (const aspect of [0.5, 4 / 3, 3]) {
      for (const view of [
        ...renderViewNames,
        {direction: [2, -3, 1] as const, up: [0, 0, 1] as const},
      ]) {
        const camera = createViewCamera(projection, aspect);
        const resolved = resolveRenderView(view);
        orientImageCamera(camera, bounds, resolved);
        assert.ok(
          camera.position
            .clone()
            .sub(center)
            .normalize()
            .distanceTo(new Vector3(...resolved.direction)) < 1e-10,
        );
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z]) {
              const projected = new Vector3(x, y, z).project(camera);
              assert.ok(
                Math.abs(projected.x) < 1 &&
                  Math.abs(projected.y) < 1 &&
                  Math.abs(projected.z) < 1,
              );
            }
      }
    }
  }
});

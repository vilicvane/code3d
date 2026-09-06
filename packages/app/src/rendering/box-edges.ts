import type {Vec3} from '@code3d/core/tooling';

/** Write distinct box edges and return their count (at most twelve). */
export function writeBoxEdges(
  positions: Float32Array,
  min: Vec3,
  max: Vec3,
): number {
  let offset = 0;
  for (let axis = 0; axis < 3; axis++) {
    if (min[axis] === max[axis]) continue;
    const a = (axis + 1) % 3;
    const b = (axis + 2) % 3;
    for (const first of new Set([min[a], max[a]])) {
      for (const second of new Set([min[b], max[b]])) {
        for (const end of [min[axis], max[axis]]) {
          for (let component = 0; component < 3; component++) {
            positions[offset++] =
              component === axis ? end : component === a ? first : second;
          }
        }
      }
    }
  }
  positions.fill(0, offset);
  return offset / 6;
}

import type {SketchSnapshot, SketchPointAddress} from '@code3d/core/tooling';

export function deletedSketchConstraints(
  local: SketchSnapshot,
  ids: readonly number[],
): number[] {
  const pointDeleted = (point: SketchPointAddress) =>
    point.layer === local.id && ids.includes(point.id);
  return local.constraints.flatMap(([kind, data], index) => {
    let deleted: boolean;
    switch (kind) {
      case 'fixed':
        deleted = pointDeleted(data);
        break;
      case 'horizontal':
      case 'vertical':
        deleted = ids.includes(data);
        break;
      case 'coincident':
      case 'midpoint':
        deleted = data.some(pointDeleted);
        break;
      case 'x':
      case 'y':
        deleted = pointDeleted(data);
        break;
      case 'length':
      case 'angle':
      case 'radius':
      case 'sweep':
        deleted = ids.includes(data);
        break;
    }
    return deleted ? [index] : [];
  });
}

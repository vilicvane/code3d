import type {
  SketchSnapshot,
  SketchPointAddress,
  SketchConstraint,
} from '@code3d/core/tooling';

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
      case 'radius':
      case 'sweep':
        deleted = ids.includes(data);
        break;
      case 'pointOn':
        deleted = pointDeleted(data[0]) || ids.includes(data[1]);
        break;
      case 'equalLength':
      case 'equalRadius':
      case 'tangent':
      case 'parallel':
      case 'perpendicular':
        deleted = data.some(id => ids.includes(id));
        break;
      case 'angle':
        deleted =
          typeof data === 'number'
            ? ids.includes(data)
            : data.some(id => ids.includes(id));
        break;
    }
    return deleted ? [index] : [];
  });
}

/** Relation identity uses canonical point addresses and symmetric curve pairs.
 * Dimension values are edited in place and do not create a second relation. */
export function sketchConstraintIdentity(
  [kind, data, value]: SketchConstraint<SketchPointAddress>,
  resolvePoint: (point: SketchPointAddress) => SketchPointAddress,
): string {
  const key = (p: SketchPointAddress) => JSON.stringify(resolvePoint(p));
  if (kind === 'fixed') return `${kind}:${key(data)}`;
  if (kind === 'coincident') return `${kind}:${data.map(key).sort().join(':')}`;
  if (kind === 'midpoint')
    return `${kind}:${key(data[0])}:${data.slice(1).map(key).sort().join(':')}`;
  if (kind === 'x' || kind === 'y') return `${kind}:${key(data)}`;
  if (kind === 'pointOn') return `${kind}:${key(data[0])}:${data[1]}`;
  if (kind === 'tangent')
    return `${kind}:${value ?? 'external'}:${[...data].sort((a, b) => a - b).join(':')}`;
  if (
    kind === 'parallel' ||
    kind === 'perpendicular' ||
    kind === 'equalLength' ||
    kind === 'equalRadius'
  )
    return `${kind}:${[...data].sort((a, b) => a - b).join(':')}`;
  return `${kind}:${data}`;
}

import {
  sketchCurveGeometry,
  sketchCurveClosestParameter,
  sketchCurveIntersections,
  sketchCurvePosition,
  sketchCurveTolerance,
  sketchPointResolver,
  type SketchPointAddress,
  type SketchConstraint,
  type SketchCurve,
  type SketchPosition,
  type SketchSnapshot,
} from '@code3d/core/tooling';

export type SketchPoint = SketchPointAddress & {position: SketchPosition};
/** An accepted hint carries intent until its point/line gets an authored identity. */
export type SketchSnapRelation =
  | readonly [kind: 'pointOn' | 'tangent', curve: number]
  | readonly [
      kind: 'midpoint',
      points: readonly [SketchPointAddress, SketchPointAddress],
    ]
  | readonly [kind: 'horizontal' | 'vertical'];
export type SketchEndpoint = (
  {point: SketchPoint} | {position: SketchPosition}
) & {relations?: readonly SketchSnapRelation[]};
export type SketchAxis = 'x' | 'y';
export type SketchDirection =
  {kind: 'angle'; degrees: number} | {kind: 'axis'; axis: SketchAxis};
export type SketchInputGeometry =
  | {kind: 'cartesian'; x?: number; y?: number}
  | {
      kind: 'polar';
      origin: SketchPosition;
      length?: number;
      direction?: SketchDirection;
      /** Only a real line creates direction and tangency relations. */
      line?: boolean;
    };
export type SketchSnap = {
  endpoint: SketchEndpoint;
  hint?:
    | 'Point'
    | 'Origin'
    | 'Horizontal'
    | 'Vertical'
    | 'Grid'
    | 'On curve'
    | 'Tangent'
    | SketchSnapFeature['hint'];
};
export type SketchSnapFeature = {
  position: SketchPosition;
  hint: 'Intersection' | 'Midpoint' | 'On curve';
  relations?: readonly SketchSnapRelation[];
};
export type SketchSnapContext = {
  points: readonly SketchPoint[];
  features: readonly SketchSnapFeature[];
  curves?: readonly {id: number; curve: SketchCurve}[];
  scale: number;
  gridStep: number;
  enabled: boolean;
};

/** Model-space features, independent of the pointer and view scale. */
export function sketchSnapTargets(
  layers: readonly SketchSnapshot[],
  excluded?: SketchPointAddress,
): Pick<SketchSnapContext, 'points' | 'features' | 'curves'> {
  const allPoints = layers.flatMap(layer =>
    layer.entities.flatMap(entity =>
      entity.kind === 'point'
        ? [{layer: layer.id, id: entity.id, position: entity.position}]
        : [],
    ),
  );
  const resolve = sketchPointResolver(layers);
  const excludedPoint =
    excluded && allPoints.some(point => sameSketchPoint(point, excluded))
      ? resolve(excluded)
      : undefined;
  const excludes = (point: SketchPointAddress) =>
    !!excludedPoint && sameSketchPoint(resolve(point), excludedPoint);
  const curves = layers.flatMap(layer =>
    layer.entities.flatMap(entity => {
      if (
        (excluded &&
          sameSketchPoint(excluded, {layer: layer.id, id: entity.id})) ||
        (entity.kind === 'line' && entity.points.some(excludes)) ||
        (entity.kind === 'arc' &&
          (excludes(entity.center) || entity.points.some(excludes))) ||
        (entity.kind === 'circle' && excludes(entity.center))
      )
        return [];
      const curve = sketchCurveGeometry(
        entity,
        ref => allPoints.find(point => sameSketchPoint(point, ref))!.position,
      );
      return curve ? [{id: entity.id, layer: layer.id, entity, curve}] : [];
    }),
  );
  const local = layers.at(-1)?.id;
  const localCurves = curves.filter(curve => curve.layer === local);
  const features: SketchSnapFeature[] = [];
  localCurves.forEach(({id, curve}, index) => {
    for (const other of localCurves.slice(index + 1))
      for (const contact of sketchCurveIntersections(curve, other.curve))
        features.push({
          position: contact.position,
          hint: 'Intersection',
          relations: [
            ['pointOn', id],
            ['pointOn', other.id],
          ],
        });
  });
  for (const {id, layer, entity, curve} of curves) {
    if (entity.kind === 'line') {
      features.push({
        position: sketchCurvePosition(curve, 0.5),
        hint: 'Midpoint',
        relations: [['midpoint', entity.points]],
      });
    } else if (layer === local) {
      // These are convenient locations on a curve, not unrepresentable
      // quadrant/arc-midpoint promises. The visible hint names what persists.
      const positions: SketchPosition[] =
        curve.kind === 'circle'
          ? [
              [curve.center[0] + curve.radius, curve.center[1]],
              [curve.center[0], curve.center[1] + curve.radius],
              [curve.center[0] - curve.radius, curve.center[1]],
              [curve.center[0], curve.center[1] - curve.radius],
            ]
          : [sketchCurvePosition(curve, 0.5)];
      for (const position of positions)
        features.push({
          position,
          hint: 'On curve',
          relations: [['pointOn', id]],
        });
    }
  }
  // Actual point identities (including curve endpoints and centers) win ties.
  return {
    points: allPoints.filter(point => !excludes(point)).reverse(),
    features,
    curves: localCurves.map(({id, curve}) => ({id, curve})),
  };
}

/** Bind only the relationships the user actually accepted, never coordinate coincidences. */
export function sketchSnapPointConstraints(
  endpoint: SketchEndpoint,
  point: SketchPointAddress,
): SketchConstraint<SketchPointAddress>[] {
  return (endpoint.relations ?? []).flatMap<
    SketchConstraint<SketchPointAddress>
  >(relation => {
    if (relation[0] === 'pointOn') return [['pointOn', [point, relation[1]]]];
    if (relation[0] === 'midpoint')
      return [['midpoint', [point, ...relation[1]]]];
    return [];
  });
}

export function sketchSnapLineConstraints(
  endpoint: SketchEndpoint,
  line: number,
): SketchConstraint<SketchPointAddress>[] {
  return (endpoint.relations ?? []).flatMap<
    SketchConstraint<SketchPointAddress>
  >(relation => {
    if (relation[0] === 'tangent') return [['tangent', [line, relation[1]]]];
    if (relation[0] === 'horizontal' || relation[0] === 'vertical')
      return [[relation[0], line]];
    return [];
  });
}

export const endpointPosition = (endpoint: SketchEndpoint): SketchPosition =>
  'point' in endpoint ? endpoint.point.position : endpoint.position;

export function sameSketchPoint(
  a: SketchPointAddress | undefined,
  b: SketchPointAddress,
): boolean {
  return a?.layer === b.layer && a.id === b.id;
}

export function sketchDistance(a: SketchPosition, b: SketchPosition): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polarPoint(
  origin: SketchPosition,
  length: number,
  angle: number,
): SketchPosition {
  const radians = ((angle % 360) * Math.PI) / 180;
  const clean = (value: number) => (Math.abs(value) < 1e-15 ? 0 : value);
  return [
    origin[0] + length * clean(Math.cos(radians)),
    origin[1] + length * clean(Math.sin(radians)),
  ];
}

/** Explicit dimensions/directions are authoritative, even when snapping is off. */
export function snapSketchPointer(
  pointer: SketchPosition,
  geometry: SketchInputGeometry,
  context: SketchSnapContext,
): SketchSnap {
  const project = (point: SketchPosition): SketchPosition => {
    if (geometry.kind === 'cartesian')
      return [geometry.x ?? point[0], geometry.y ?? point[1]];
    if (geometry.direction?.kind === 'axis') {
      const axis = geometry.direction.axis === 'x' ? 0 : 1;
      const position: [number, number] = [...geometry.origin];
      position[axis] =
        geometry.length === undefined
          ? point[axis]
          : geometry.origin[axis] +
            Math.sign(point[axis] - geometry.origin[axis] || 1) *
              geometry.length;
      return position;
    }
    if (geometry.length === undefined && geometry.direction === undefined)
      return point;
    const angle =
      geometry.direction?.degrees ??
      (Math.atan2(
        point[1] - geometry.origin[1],
        point[0] - geometry.origin[0],
      ) *
        180) /
        Math.PI;
    return polarPoint(
      geometry.origin,
      geometry.length ?? sketchDistance(point, geometry.origin),
      angle,
    );
  };
  const position = project(pointer);
  const raw: SketchSnap = {endpoint: {position}};
  if (!context.enabled) return raw;
  const tolerance = 9 / context.scale;
  const close = (candidate: SketchPosition) =>
    sketchDistance(position, candidate) <= tolerance;
  const compatible = (candidate: SketchPosition) => {
    if (geometry.kind === 'cartesian')
      return (
        (geometry.x === undefined || geometry.x === candidate[0]) &&
        (geometry.y === undefined || geometry.y === candidate[1])
      );
    if (geometry.direction?.kind === 'axis') {
      const fixed = geometry.direction.axis === 'x' ? 1 : 0;
      if (candidate[fixed] !== geometry.origin[fixed]) return false;
    }
    return (
      sketchDistance(candidate, project(candidate)) <=
      1e-10 * Math.max(1, sketchDistance(candidate, geometry.origin))
    );
  };

  // Caller orders coincident points local-first. Never manufacture an upstream
  // reference from a coordinate match after projecting incompatible input.
  const point = context.points
    .filter(point => close(point.position) && compatible(point.position))
    .sort(
      (a, b) =>
        sketchDistance(position, a.position) -
        sketchDistance(position, b.position),
    )[0];
  if (point) return {endpoint: {point}, hint: 'Point'};
  const endpointAt = (
    candidate: SketchPosition,
    relations?: readonly SketchSnapRelation[],
  ): SketchEndpoint => {
    return {position: candidate, ...(relations?.length ? {relations} : {})};
  };
  if (geometry.kind === 'polar' && geometry.line) {
    const tangentCandidates: {
      position: SketchPosition;
      relations: SketchSnapRelation[];
    }[] = [];
    for (const {id, curve} of context.curves ?? []) {
      if (curve.kind === 'line') continue;
      const [ox, oy] = geometry.origin;
      const dx = ox - curve.center[0],
        dy = oy - curve.center[1];
      const squared = dx * dx + dy * dy;
      const radiusSquared = curve.radius * curve.radius;
      const radialDistance = Math.sqrt(squared);
      const curveTolerance = sketchCurveTolerance(curve);
      if (radialDistance < curve.radius - curveTolerance || squared === 0)
        continue;
      const onCircle =
        Math.abs(radialDistance - curve.radius) <= curveTolerance;
      const root = Math.sqrt(Math.max(0, squared - radiusSquared));
      for (const sign of onCircle ? [1] : [-1, 1]) {
        const contact: SketchPosition = onCircle
          ? geometry.origin
          : [
              curve.center[0] +
                (radiusSquared * dx - sign * curve.radius * dy * root) /
                  squared,
              curve.center[1] +
                (radiusSquared * dy + sign * curve.radius * dx * root) /
                  squared,
            ];
        if (
          sketchDistance(
            contact,
            sketchCurvePosition(
              curve,
              sketchCurveClosestParameter(curve, contact),
            ),
          ) > curveTolerance
        )
          continue;
        const vx = onCircle ? -dy : contact[0] - ox;
        const vy = onCircle ? dx : contact[1] - oy;
        const denominator = vx * vx + vy * vy;
        const projected =
          ((position[0] - ox) * vx + (position[1] - oy) * vy) / denominator;
        const t =
          geometry.length === undefined
            ? projected
            : (Math.sign(projected || 1) * geometry.length) /
              Math.sqrt(denominator);
        const atContact = !onCircle && close(contact) && compatible(contact);
        if (!onCircle && t < 1 && !atContact) continue;
        const candidate: SketchPosition = atContact
          ? contact
          : [ox + t * vx, oy + t * vy];
        if (
          sketchDistance(candidate, geometry.origin) === 0 ||
          !close(candidate) ||
          !compatible(candidate)
        )
          continue;
        tangentCandidates.push({
          position: candidate,
          relations: [
            ['tangent', id],
            ...(atContact ? [['pointOn', id] as const] : []),
          ],
        });
      }
    }
    tangentCandidates.sort(
      (a, b) =>
        sketchDistance(position, a.position) -
        sketchDistance(position, b.position),
    );
    const tangent = tangentCandidates[0];
    if (tangent)
      return {
        endpoint: endpointAt(tangent.position, tangent.relations),
        hint: 'Tangent',
      };
  }

  const feature = context.features
    .filter(feature => close(feature.position) && compatible(feature.position))
    .sort(
      (a, b) =>
        sketchDistance(position, a.position) -
        sketchDistance(position, b.position),
    )[0];
  if (feature)
    return {
      endpoint: endpointAt(feature.position, feature.relations),
      hint: feature.hint,
    };
  const onCurve = (context.curves ?? [])
    .map(({id, curve}) => ({
      id,
      position: sketchCurvePosition(
        curve,
        sketchCurveClosestParameter(curve, position),
      ),
    }))
    .filter(
      candidate => close(candidate.position) && compatible(candidate.position),
    )
    .sort(
      (a, b) =>
        sketchDistance(position, a.position) -
        sketchDistance(position, b.position),
    )[0];
  if (onCurve)
    return {
      endpoint: endpointAt(onCurve.position, [['pointOn', onCurve.id]]),
      hint: 'On curve',
    };
  if (close([0, 0]) && compatible([0, 0]))
    return {endpoint: {position: [0, 0]}, hint: 'Origin'};

  if (
    geometry.kind === 'polar' &&
    geometry.direction === undefined &&
    geometry.line
  ) {
    const {origin, length} = geometry;
    const candidates = [
      {
        position: [
          length === undefined
            ? position[0]
            : origin[0] + Math.sign(position[0] - origin[0] || 1) * length,
          origin[1],
        ] as SketchPosition,
        hint: 'Horizontal' as const,
      },
      {
        position: [
          origin[0],
          length === undefined
            ? position[1]
            : origin[1] + Math.sign(position[1] - origin[1] || 1) * length,
        ] as SketchPosition,
        hint: 'Vertical' as const,
      },
    ]
      .filter(candidate => close(candidate.position))
      .sort(
        (a, b) =>
          sketchDistance(position, a.position) -
          sketchDistance(position, b.position),
      );
    if (candidates[0]) {
      const candidate = candidates[0];
      if (length === undefined) {
        const axis = candidate.hint === 'Horizontal' ? 0 : 1;
        const grid: [number, number] = [...candidate.position];
        grid[axis] =
          Math.round(grid[axis] / context.gridStep) * context.gridStep;
        if (close(grid)) candidate.position = grid;
      }
      return {
        endpoint: {
          position: candidate.position,
          relations: [
            [candidate.hint === 'Horizontal' ? 'horizontal' : 'vertical'],
          ],
        },
        hint: candidate.hint,
      };
    }
  }
  // Snap the free coordinate of an axis lock, but never move off an entered
  // radius/arbitrary angle merely to display a grid snap indicator.
  if (
    geometry.kind === 'cartesian' ||
    (geometry.length === undefined && geometry.direction?.kind !== 'angle')
  ) {
    const grid = project([
      Math.round(position[0] / context.gridStep) * context.gridStep,
      Math.round(position[1] / context.gridStep) * context.gridStep,
    ]);
    if (close(grid)) return {endpoint: {position: grid}, hint: 'Grid'};
  }
  return raw;
}
